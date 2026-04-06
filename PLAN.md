# Plan: Live R57 Roof Microswitch Status Monitor

## Problem Statement

The app can currently read CVM **fault codes** (UDS `19 02 FF` — ReadDTCInformation), which tells you what has gone wrong *in the past*. But it **cannot** read the **live state** of the microswitches and hall sensors — the most critical diagnostic data for roof troubleshooting.

When a roof operation stalls, you need to see *right now*: "Which switch is open? Which is closed? Where is the roof stuck?" — not "the CVM logged fault A692 at some point."

## Game Theory & Failure Mode Analysis

Before writing any code, every failure mode must be mapped and a strategy chosen for each.

### Adversarial conditions (things that will go wrong)

| # | Failure Mode | Probability | Impact | Mitigation Strategy |
|---|---|---|---|---|
| 1 | **Adapter can't reach CVM** — cheap ELM327 clones only support standard OBD-II, not body bus modules | HIGH (~50% of adapters) | Total: no data | **Detect on first attempt, show clear "adapter not compatible" message. Never silently fail.** Fall back to DTC-only mode. |
| 2 | **UDS 0x22 not supported by CVM** — some R57 firmware versions may not expose ReadDataByIdentifier | LOW (~10%) | Total: no live data | **Probe with a known-safe DID first. If NRC (Negative Response Code) 0x11 (serviceNotSupported), disable live monitoring and explain why.** |
| 3 | **DID returns unexpected format** — byte count or encoding differs from expected | MEDIUM | Corrupt display | **Validate response length and format before parsing. Show raw hex alongside decoded values for transparency.** |
| 4 | **BLE latency masks rapid state changes** — switch toggles between polls | MEDIUM | Missed transients | **Log every poll result with timestamp. Show "last changed" indicator. Use fastest safe poll interval (~1s).** |
| 5 | **Polling CVM while engine PID polling is active** — serial queue contention | CERTAIN | Slower updates | **Interleave CVM reads into the polling loop rather than running a separate loop. One queue, one bus.** |
| 6 | **CVM goes to sleep** — module may power down if ignition off | MEDIUM | Timeout errors | **Detect NO DATA/timeout, show "CVM sleeping" state, auto-retry when data returns.** |
| 7 | **Roof is mid-operation** — switches are transitioning rapidly | LOW (manual trigger) | Display flutter | **Add debounce on UI transitions. Show "MOVING" state when multiple switches change within 500ms.** |
| 8 | **User drives away with monitoring active** — safety concern | MEDIUM | Battery drain, bus noise | **Auto-stop CVM polling when speed > 0 or dashboard polling detects driving.** |

### Key Principle: Never Guess, Always Verify

Every DID we attempt to read will be **probed first** with a single read. If the CVM returns a Negative Response Code (NRC), we know exactly what's supported. No guessing, no hardcoded assumptions about firmware versions.

## Technical Approach

### The Protocol: UDS Service 0x22 (ReadDataByIdentifier)

This is the standard UDS service for reading live data from ECU modules. The CVM (like all BMW modules on K-CAN) supports a set of DIDs that expose internal state.

**Command format:** `22 [DID_HI] [DID_LO]`
**Positive response:** `62 [DID_HI] [DID_LO] [DATA...]`
**Negative response:** `7F 22 [NRC]` (where NRC = error code)

### BMW R57 CVM Architecture — What We're Reading

The R57 CVM monitors these physical inputs:

| Switch/Sensor | Physical Location | What It Detects | Expected DID Category |
|---|---|---|---|
| **Coupling lock microswitch LEFT** | Behind left rear quarter panel | Left tonneau cover coupling locked/unlocked | Digital input (1 bit) |
| **Coupling lock microswitch RIGHT** | Behind right rear quarter panel | Right tonneau cover coupling locked/unlocked | Digital input (1 bit) |
| **Front header latch LEFT** | Windscreen frame, left | Roof locked to windscreen left | Digital input (1 bit) |
| **Front header latch RIGHT** | Windscreen frame, right | Roof locked to windscreen right | Digital input (1 bit) |
| **Hall sensor — erected position** | Hydraulic ram | Roof pack fully up (erected) | Digital/analog |
| **Hall sensor — stowed position** | Rear compartment | Roof pack fully stowed | Digital/analog |
| **Hall sensor — rear module open** | Rear module hinge | Compartment lid open | Digital/analog |
| **Compartment lid locked** | Boot area | Tonneau cover secured | Digital input (1 bit) |
| **Hydraulic pump motor** | Behind rear seats | Pump running/stopped | Status bit |
| **Roof position (computed)** | CVM internal | Overall: Closed / Open / Moving / Error | Status register |

### DID Discovery Strategy

BMW CVM DIDs follow patterns established across the E-generation platform (R56/R57 share the E-generation CVM with E93/E88):

**Phase 1 — Probe known BMW CVM status DIDs:**

We will attempt a systematic probe of candidate DIDs. The approach is:

1. **Status register DID (0x2000-0x20FF range)** — BMW modules commonly expose a "status overview" DID that packs all digital inputs into a bitmask
2. **Individual sensor DIDs (0xD000-0xDFFF range)** — BMW ISTA uses this range for component-level status
3. **IO status DID (0x3000-0x30FF range)** — Digital input/output status registers

**Concrete probe sequence (ordered by likelihood):**

```
22 20 00  — General status register (very common across BMW modules)
22 20 01  — Extended status register
22 20 10  — Digital input status word
22 D0 00  — Component status block (ISTA-style)
22 D0 01  — Component status block 2
22 30 00  — IO status register
22 00 01  — Module identification (confirms UDS 0x22 support)
```

Each probe: send command, check for `62 XX XX` (positive) vs `7F 22 XX` (negative). Map supported DIDs. Parse response byte layouts.

**Phase 2 — If standard DIDs fail, brute-force scan a narrow range:**

If Phase 1 finds that 0x22 is supported (we get at least one positive response) but none of our candidate DIDs return switch status, we scan:
- `0x2000–0x20FF` (256 DIDs, ~4 minutes at 1/second)
- Report all responding DIDs with raw hex data for analysis

**Phase 3 — Interpret response data:**

Once we find the status DID(s), we decode the bitmask. BMW typically packs digital inputs as:
- Bit = 0: switch OPEN (circuit broken)
- Bit = 1: switch CLOSED (circuit made)

The bit-to-switch mapping will be documented from testing and community data, with an "unknown bits" display for any bits we can't yet identify.

## Implementation Plan

### Step 1: Whitelist UDS 0x22 in command-safety.js

**File:** `src/obd/command-safety.js`

Add `'22'` to `ALLOWED_MODES`. This is a **read-only** UDS service (ReadDataByIdentifier) — it cannot modify anything. It's the same safety class as `'19'` which is already whitelisted.

Also add `'10'` (DiagnosticSessionControl) for `10 01` only (default session) — needed because some CVM firmware requires an explicit session start. The blocklist already catches non-default sessions (`/^10\s*0[^1]/i`), so `10 01` is safe.

### Step 2: Create CVM status module — `src/obd/cvm-status.js`

New file containing:

- **`CVM_DIDS`** — Map of candidate DIDs with metadata (name, expected byte length, decoder function)
- **`probeCVMCapabilities()`** — Sends each candidate DID, returns which are supported
- **`readCVMStatus(supportedDids)`** — Reads all supported status DIDs in one pass, returns decoded switch states
- **`parseSwitchBitmask(bytes)`** — Decodes the status bitmask into named switch states
- **`CVM_SWITCHES`** — Constant defining all known switches with:
  - `id`: machine name (e.g. `'couplingLockLeft'`)
  - `label`: human name (e.g. `'Coupling Lock LEFT'`)
  - `location`: physical location description
  - `faultCode`: associated DTC (e.g. `'A690'`)
  - `bitIndex`: position in status bitmask (null until discovered)
  - `expectedState`: what "normal" looks like for roof-closed and roof-open

### Step 3: Create DID probe function in elm327.js

**File:** `src/obd/elm327.js`

Add `readCVMDID(did)` function:
```
1. ATSH 660       — address CVM
2. ATCRA 6E0      — filter CVM responses
3. 22 [HI] [LO]   — ReadDataByIdentifier
4. Parse response: 62 [HI] [LO] [DATA...] = success, 7F 22 [NRC] = not supported
5. Restore normal OBD mode
```

Add `readCVMStatusLive(dids)` — optimised batch version that sets CVM headers once, reads multiple DIDs, then restores. This minimises header-switching overhead during polling.

### Step 4: Integrate CVM polling into App.jsx polling loop

**File:** `src/App.jsx`

Modify the existing polling loop (lines 325-369) to optionally interleave CVM status reads:

- When `cvmMonitoring` is enabled AND CVM was confirmed reachable:
  - Every N-th poll cycle (configurable, default every 2 cycles = ~1.5s), insert a CVM status read
  - This shares the serial command queue — no contention
  - Store results in `cvmLiveStatus` state
  - Track `cvmLastPoll` timestamp for freshness display

- **Auto-stop conditions:**
  - Speed PID > 0 (vehicle moving — don't poll body modules while driving)
  - 3 consecutive CVM timeouts (module went to sleep)
  - User manually stops

### Step 5: Build the Switch Status UI component

**File:** `src/views/RoofView.jsx` — extend with new "Live Status" section

**Visual design — the "Switch Map":**

```
┌─────────────────────────────────────────┐
│  ROOF SWITCH STATUS          ● LIVE     │
│  Last updated: 2s ago                   │
│                                         │
│  ┌─ FRONT HEADER ─────────────────┐    │
│  │  LEFT LATCH    ● CLOSED        │    │
│  │  RIGHT LATCH   ● CLOSED        │    │
│  └────────────────────────────────┘    │
│                                         │
│  ┌─ ROOF PACK ────────────────────┐    │
│  │  ERECTED HALL   ● ACTIVE       │    │
│  │  STOWED HALL    ○ INACTIVE     │    │
│  │  POSITION       CLOSED (UP)    │    │
│  └────────────────────────────────┘    │
│                                         │
│  ┌─ REAR MODULE ──────────────────┐    │
│  │  COUPLING LEFT  ● LOCKED       │    │
│  │  COUPLING RIGHT ● LOCKED       │    │
│  │  REAR OPEN HALL ○ INACTIVE     │    │
│  │  COMP. LID      ● LOCKED       │    │
│  └────────────────────────────────┘    │
│                                         │
│  ┌─ HYDRAULIC ────────────────────┐    │
│  │  PUMP MOTOR     ○ OFF          │    │
│  └────────────────────────────────┘    │
│                                         │
│  [Start Monitoring]  [Stop]             │
└─────────────────────────────────────────┘
```

Each switch shows:
- **Name** with physical location hint (tap to expand details)
- **State indicator**: Green filled dot = CLOSED/ACTIVE, Grey hollow dot = OPEN/INACTIVE, Red pulsing dot = FAULT (associated DTC is active), Amber animated dot = TRANSITIONING
- **Freshness**: "last changed" timestamp per switch
- **Associated fault code**: if DTC A690/A692/etc is stored, show warning badge next to the switch

### Step 6: DID Discovery/Probe UI

**File:** `src/views/RoofView.jsx` — add "Probe CVM" section

For first-time use or when DIDs are unknown:

1. "Probe CVM Capabilities" button — runs the probe sequence
2. Shows progress: "Probing DID 0x2000... supported! (4 bytes)" / "DID 0x2001... not supported (NRC 0x31)"
3. Stores discovered DIDs in localStorage per vehicle
4. Once probe completes, automatically enables the Live Status section

### Step 7: Demo mode support

Extend demo mode to simulate:
- CVM switch states cycling through a roof-open sequence
- Realistic timing (2-3 seconds per phase)
- Allows UI testing without a real adapter

### Step 8: Robustness guarantees

**Data integrity:**
- Every CVM response validated for correct service ID (0x62) and DID echo
- Byte length validated against expected length for each DID
- Raw hex always preserved alongside decoded values
- "Unknown" bits displayed (not hidden) for transparency

**Communication resilience:**
- CVM header switch (`ATSH 660` / `ATCRA 6E0`) wrapped in try/finally to ALWAYS restore normal OBD mode
- If CVM read fails mid-poll, skip CVM for that cycle, retry next cycle
- After 3 consecutive CVM failures, pause CVM monitoring with user notification
- Exponential backoff on CVM retries (1s, 2s, 4s)

**UX resilience:**
- "Stale data" indicator if last successful read > 5 seconds ago
- Clear distinction between "switch is OPEN" (known state) vs "switch state UNKNOWN" (read failed)
- Never show OPEN/CLOSED if the data is ambiguous — show "?" with explanation

## File Change Summary

| File | Change Type | What Changes |
|---|---|---|
| `src/obd/command-safety.js` | Edit | Add `'22'` to ALLOWED_MODES |
| `src/obd/cvm-status.js` | **New** | CVM DID database, probe logic, status parser, switch definitions |
| `src/obd/elm327.js` | Edit | Add `readCVMDID()`, `readCVMStatusLive()`, `probeCVMCapabilities()` |
| `src/obd/roof-codes.js` | Edit | Add switch-to-DTC cross-reference mapping |
| `src/views/RoofView.jsx` | Edit | Add Live Status section, probe UI, switch map display |
| `src/App.jsx` | Edit | Integrate CVM polling into main loop, add cvmLiveStatus state |
| `src/components/shared.jsx` | Edit (minor) | Add SwitchIndicator component if needed |

## Order of Implementation

1. **command-safety.js** — whitelist 0x22 (1 line change, unlocks everything)
2. **cvm-status.js** — DID database + probe + parser (new module, core logic)
3. **elm327.js** — readCVMDID() + readCVMStatusLive() (transport layer)
4. **App.jsx** — CVM polling integration + state management
5. **RoofView.jsx** — Live Status UI + probe UI
6. **roof-codes.js** — switch-to-DTC cross-references
7. **Demo mode** — simulated switch states
8. **Testing & edge cases** — verify all failure modes

## Risk Assessment

**Highest risk:** DID discovery. We don't have a guaranteed list of which DIDs the R57 CVM exposes. The probe approach mitigates this — worst case, we find 0x22 is supported but can't find the right DIDs, and we fall back to periodic DTC reads (0x19) which still tell us *which* switches have faulted, just not their current state.

**Mitigation for DID uncertainty:** The probe UI shows raw hex for every responding DID. Even if we can't auto-decode the bitmask, a user can manually operate each switch and observe which bytes change — effectively a manual calibration mode. This data can then be shared to improve the mapping over time.

**Lowest risk:** Everything in the ELM327/BLE transport layer is proven (CVM communication already works for DTCs). We're using the exact same addressing (0x660/0x6E0) with a different UDS service (0x22 instead of 0x19).
