# Plan: Live R57 Roof Microswitch Status Monitor

## Problem Statement

The app can currently read CVM **fault codes** (UDS `19 02 FF` — ReadDTCInformation), which tells you what has gone wrong *in the past*. But it **cannot** read the **live state** of the microswitches and hall sensors — the most critical diagnostic data for roof troubleshooting.

When a roof operation stalls, you need to see *right now*: "Which switch is open? Which is closed? Where is the roof stuck?" — not "the CVM logged fault A692 at some point."

## R57 CVM Hardware Architecture (from BMW research)

The R57 shares its CVM architecture with the BMW E88 (1 Series Convertible). The CVM sits on the **K-CAN body bus (100 kbit/s)**, behind the **JBE (Junction Box Electronics) gateway**. The OBD port connects to the D-CAN (500 kbit/s); the JBE bridges diagnostic requests to K-CAN.

### Confirmed Physical Sensors

**Microswitches (digital — open/closed):**

| Switch | BMW Designation | Location | Detects | Fault Code |
|---|---|---|---|---|
| Coupling lock LEFT | I01197-type | Behind left rear quarter panel trim | Left coupling ring buckle locked | A690 |
| Coupling lock RIGHT | I01202-type | Behind right rear quarter panel trim | Right coupling ring buckle locked | A692 |
| Cowl panel LOCKED | S142 equivalent | Front header bow / windscreen frame | Roof locked to windscreen | A68D, A68E |
| Cowl panel UNLOCKED | S145 equivalent | Front header bow / windscreen frame | Front latches released | A68F |
| Parcel shelf | Boot microswitch | Left rear corner of parcel shelf | Shelf positioned for stowing | — |
| Cowl panel reached | Intermediate | Header bow travel | Intermediate position during close | A694 |

**Hall sensors (analog/digital):**

| Sensor | Location | Detects | Fault Code |
|---|---|---|---|
| Roof pack ERECTED | Hydraulic ram (right side) | Roof fully up and closed | A689 |
| Roof pack STOWED | Rear of roof compartment | Roof fully down in boot | A68A |
| Main pillar ANGLE | Right main bearing | Angular position (continuous, ~0-180 deg) | A68B, A68C |
| Tensioning bow angle | Tensioning bow mechanism | Fabric tension state | — |
| Rear module / comp. lid | Boot partition area | Compartment lid position | A691 |

**The main pillar angle sensor is critical** — the CVM uses it to determine fold-cycle percentage. The compartment floor unlocks at approximately 107 degrees.

### Roof Operation Sequence (switch state transitions)

| Step | Coupling L | Coupling R | Cowl Locked | Cowl Unlocked | Parcel Shelf | Boot Lid |
|---|---|---|---|---|---|---|
| Start (closed) | LOCKED | LOCKED | CLOSED | OPEN | CLOSED | CLOSED |
| Unlatch front | LOCKED | LOCKED | OPEN | CLOSED | CLOSED | CLOSED |
| Fold beginning | OPEN | OPEN | OPEN | CLOSED | CLOSED | CLOSED |
| Boot opening | OPEN | OPEN | OPEN | CLOSED | CLOSED | OPEN |
| Stowing | OPEN | OPEN | OPEN | CLOSED | CLOSED | OPEN |
| Complete (open) | OPEN | OPEN | OPEN | OPEN | CLOSED | CLOSED |

This table is the **ground truth** for validating live readings — if we see a state combination that shouldn't exist at any step, we know we have a fault or a misread.

### Missing Fault Codes (to add to roof-codes.js)

The current database is missing these intermediate codes discovered in research:
- **A68B** — Hall sensor, roof shell position (partially open)
- **A68C** — Hall sensor, roof shell position (partially closed)
- **A68E** — Microswitch, cowl panel locked (distinct from A68D locking system)
- **A68F** — Microswitch, cowl panel unlocked
- **A694** — Microswitch, cowl panel reached (intermediate position)

## Game Theory & Failure Mode Analysis

Before writing any code, every failure mode must be mapped and a strategy chosen for each.

### Adversarial conditions (things that will go wrong)

| # | Failure Mode | Probability | Impact | Mitigation Strategy |
|---|---|---|---|---|
| 1 | **Adapter can't reach CVM** — BMW uses ISO-TP Extended Addressing (requests on 0x6F1 with target module byte, not simple ATSH). Most cheap ELM327 clones don't support this. The JBE gateway may also reject requests. | HIGH (~50-70% of adapters) | Total: no data | **Detect on first DTC scan attempt (existing code). If CVM reachable=true, the adapter handles BMW addressing — proceed with 0x22. If not, fall back to reference-only mode. Never attempt 0x22 if 0x19 already failed.** |
| 2 | **UDS 0x22 not supported by CVM** — some firmware may not expose ReadDataByIdentifier, or may require a non-default diagnostic session | LOW (~10%) | No live data | **Probe with a known-safe DID first. If NRC 0x11 (serviceNotSupported), try `10 01` (default session reset) then retry. If still fails, disable live monitoring with explanation.** |
| 3 | **DID returns unexpected format** — byte count or encoding differs from expected | MEDIUM | Corrupt display | **Validate response length and format before parsing. Show raw hex alongside decoded values for transparency.** |
| 4 | **BLE latency masks rapid state changes** — switch toggles between polls | MEDIUM | Missed transients | **Log every poll result with timestamp. Show "last changed" indicator. Use fastest safe poll interval (~1s).** |
| 5 | **Polling CVM while engine PID polling is active** — serial queue contention | CERTAIN | Slower updates | **Interleave CVM reads into the polling loop rather than running a separate loop. One queue, one bus.** |
| 6 | **CVM goes to sleep** — module may power down if ignition off | MEDIUM | Timeout errors | **Detect NO DATA/timeout, show "CVM sleeping" state, auto-retry when data returns.** |
| 7 | **Roof is mid-operation** — switches are transitioning rapidly | LOW (manual trigger) | Display flutter | **Add debounce on UI transitions. Show "MOVING" state when multiple switches change within 500ms.** |
| 8 | **User drives away with monitoring active** — safety concern | MEDIUM | Battery drain, bus noise | **Auto-stop CVM polling when speed > 0 or dashboard polling detects driving.** |
| 9 | **BMW extended addressing mismatch** — the current ATSH 660 / ATCRA 6E0 is an approximation. Real BMW addressing uses 0x6F1 with module byte in data[0]. Some adapters transparently handle this, others don't. | MEDIUM | Wrong module or no response | **If ATSH 660 works for 0x19, it will work for 0x22 — same addressing, different service. The adapter already proved it can reach the CVM.** |

### Key Principle: Never Guess, Always Verify

Every DID we attempt to read will be **probed first** with a single read. If the CVM returns a Negative Response Code (NRC), we know exactly what's supported. No guessing, no hardcoded assumptions about firmware versions.

**Critical gate:** UDS 0x22 is only attempted on adapters where `cvmReachable === true` (proven by existing DTC scan). This means the adapter has already demonstrated it can talk to the CVM — we don't introduce a new failure mode, we extend an existing working path.

## Technical Approach

### The Protocol: UDS Service 0x22 (ReadDataByIdentifier)

This is the standard UDS service for reading live data from ECU modules. The CVM (like all BMW modules on K-CAN) supports a set of DIDs that expose internal state.

**Command format:** `22 [DID_HI] [DID_LO]`
**Positive response:** `62 [DID_HI] [DID_LO] [DATA...]`
**Negative response:** `7F 22 [NRC]` (where NRC = error code)

### BMW EDIABAS Jobs → UDS Mapping

BMW's diagnostic tools (ISTA/INPA) use named "jobs" that map to UDS commands. The key CVM jobs are:

| EDIABAS Job | UDS Service | What It Returns |
|---|---|---|
| `STATUS_LESEN` | 0x22 (ReadDataByID) | Aggregate status of all microswitches and hall sensors |
| `STATUS_HALLSENSOREN` | 0x22 (ReadDataByID) | Individual hall sensor states + angle values |
| `STATUS_MIKROSCHALTER` | 0x22 (ReadDataByID) | Individual microswitch states |
| `IDENTIFIKATION` | 0x22 (ReadDataByID) | Module hardware/software version, part number |
| `FS_LESEN` | 0x19 (ReadDTCInfo) | Stored fault codes (already implemented) |

The exact DID numbers are embedded in BMW's SGBD files (e.g. `D_CVM.PRG`) which are proprietary. Third-party scanners like Foxwell NT510 Elite read and display: microswitch states (Closed/Not Closed), coupling lock states (Locked/Unlocked), roof position, and hall sensor readings — confirming these DIDs exist and are readable.

### DID Discovery Strategy

BMW CVM DIDs follow patterns from the E-generation platform. The exact addresses are proprietary, so we must **probe and discover**.

**Phase 1 — Probe high-likelihood BMW DID ranges:**

BMW modules use manufacturer-specific DID ranges:
- **0xF100-0xF1FF**: ECU identification (part number, HW/SW versions)
- **0xD000-0xD0FF**: Dynamic sensor data (ISTA-style component status)
- **0x2000-0x20FF**: Status registers (digital input bitmasks)
- **0x3000-0x30FF**: IO status registers

**Concrete probe sequence (ordered by likelihood):**

```
22 F1 00  — ECU identification (confirms 0x22 works at all)
22 20 00  — General status register (digital inputs packed as bitmask)
22 20 01  — Extended status register
22 20 10  — Digital input status word
22 D0 00  — Component status block (ISTA STATUS_LESEN style)
22 D0 01  — Component status block 2
22 D0 10  — Hall sensor status block (STATUS_HALLSENSOREN)
22 D0 20  — Microswitch status block (STATUS_MIKROSCHALTER)
22 30 00  — IO status register
```

Each probe: send command, check for `62 XX XX [DATA]` (positive) vs `7F 22 [NRC]` (negative). Record byte lengths and raw data.

**Phase 2 — Targeted range scan if Phase 1 finds 0x22 support:**

If Phase 1 confirms 0x22 is supported (at least one positive response) but we haven't found switch status DIDs, systematically scan:
- `0x2000–0x203F` (64 DIDs, ~1 minute) — most likely status range
- `0xD000–0xD03F` (64 DIDs, ~1 minute) — ISTA dynamic data range
- Report all responding DIDs with raw hex for analysis

**Phase 3 — Interpret and map response data:**

Once status DID(s) are found, decode the bitmask. BMW typically packs digital inputs as:
- Bit = 0: switch OPEN (circuit broken)
- Bit = 1: switch CLOSED (circuit made)

The bit-to-switch mapping uses two strategies:
1. **Known mappings** from community research and cross-referencing with the operation sequence table above
2. **Manual calibration mode** — user operates a specific switch, we diff the before/after bytes to identify which bit changed. This is the ultimate fallback and produces verified mappings.

## Implementation Plan

### Step 1: Whitelist UDS 0x22 in command-safety.js

**File:** `src/obd/command-safety.js`

Add `'22'` to `ALLOWED_MODES`. This is a **read-only** UDS service (ReadDataByIdentifier) — it cannot modify anything. It's the same safety class as `'19'` which is already whitelisted.

Also add `'10'` (DiagnosticSessionControl) for `10 01` only (default session) — some CVM firmware requires an explicit session reset before accepting 0x22 requests. The blocklist already catches non-default sessions (`/^10\s*0[^1]/i`), so `10 01` (return to default session) is safe.

**Safety analysis:** UDS 0x22 is universally read-only across all ECU implementations (ISO 14229-1 §11.3). It cannot write data, clear faults, actuate components, or modify calibration. It is blocked by the ECU itself if security access (0x27) would be required. Adding it is strictly equivalent to adding another "read" command.

### Step 2: Create CVM status module — `src/obd/cvm-status.js`

New file containing:

- **`CVM_SWITCHES`** — Constant defining all known switches/sensors with:
  - `id`: machine name (e.g. `'couplingLockLeft'`)
  - `label`: human name (e.g. `'Coupling Lock LEFT'`)
  - `location`: physical location description
  - `faultCode`: associated DTC (e.g. `'A690'`)
  - `group`: which UI section ('frontHeader', 'roofPack', 'rearModule', 'hydraulic')
  - `type`: 'microswitch' or 'hallSensor'
  - `closedMeaning`: what CLOSED means for this switch (e.g. 'Roof locked to windscreen')
  - `openMeaning`: what OPEN means (e.g. 'Latch released')
  - `expectedWhenClosed`: expected state when roof is closed (true/false)
  - `expectedWhenOpen`: expected state when roof is open (true/false)

- **`CANDIDATE_DIDS`** — Ordered list of DIDs to probe, with metadata (name, expected category, byte length hint)
- **`probeCVMCapabilities(readFn)`** — Probes each candidate DID via provided read function, returns `{ supported: Map<did, {bytes, raw}>, service22Available: boolean }`
- **`parseCVMStatusResponse(did, bytes)`** — Attempts to decode a DID response into named switch states. Returns `{ switches: Map<switchId, boolean|number>, raw: string, confidence: 'known'|'inferred'|'raw' }`
- **`ROOF_STATES`** — Expected switch state combinations for each phase of the roof operation sequence (the table above). Used for validation: "this combination of states means the roof is in phase X"
- **`inferRoofPhase(switchStates)`** — Given current switch states, returns the most likely roof operation phase by matching against ROOF_STATES
- **`diffSwitchStates(before, after)`** — Returns which switches changed between two readings (for manual calibration mode)

### Step 3: Add CVM DID reading functions to elm327.js

**File:** `src/obd/elm327.js`

Add `readCVMDID(did)` — single DID read, used during probing:
```
1. ATSH 660       — address CVM (reuses existing proven addressing)
2. ATCRA 6E0      — filter CVM responses
3. 22 [HI] [LO]   — ReadDataByIdentifier
4. Parse response:
   - "62 [HI] [LO] [DATA...]" = success → return { data: bytes, raw: hex }
   - "7F 22 [NRC]" = negative response → return { error: NRC, errorDesc: '...' }
   - NO DATA / CAN ERROR → return { error: 'unreachable' }
5. Restore normal OBD mode
```

Add `readCVMStatusBatch(dids)` — optimised batch version that sets CVM headers **once**, reads multiple DIDs sequentially, then restores. This minimises header-switching overhead during polling. Critical for live monitoring where we may read 2-3 DIDs per cycle.

```
1. ATSH 660 + ATCRA 6E0    — set headers once
2. For each DID:
   a. 22 [HI] [LO]         — read DID
   b. Parse response        — accumulate results
3. ATH0 + ATAR + ATD + ATSP0  — restore OBD mode once
```

**Key design decision:** Reuse the exact same addressing (ATSH 660 / ATCRA 6E0) that already works for DTC scanning. If an adapter can reach the CVM for `19 02 FF`, it can reach it for `22 XX XX`. This is the same CAN ID, same module, different UDS service.

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

**File:** `src/views/RoofView.jsx` — extend with new "Live Status" section at the top of the page (above existing DTC scan)

**Visual design — the "Switch Map":**

```
┌─────────────────────────────────────────┐
│  ROOF SWITCH STATUS          ● LIVE     │
│  Last updated: 2s ago                   │
│                                         │
│  Roof Phase: CLOSED (all latched)       │
│                                         │
│  ┌─ FRONT HEADER ─────────────────┐    │
│  │  Cowl Locked    ● CLOSED        │    │
│  │  Cowl Unlocked  ○ OPEN          │    │
│  │  Cowl Reached   ● YES           │    │
│  └────────────────────────────────┘    │
│                                         │
│  ┌─ ROOF PACK ────────────────────┐    │
│  │  Erected Hall   ● ACTIVE        │    │
│  │  Stowed Hall    ○ INACTIVE      │    │
│  │  Pillar Angle   ▓▓▓░░ 67%      │    │  ← bar for analog sensor
│  │  Tension Bow    ▓▓▓▓░ 85%      │    │
│  └────────────────────────────────┘    │
│                                         │
│  ┌─ REAR MODULE ──────────────────┐    │
│  │  Coupling LEFT  ● LOCKED   ⚠A690│   │  ← fault badge if DTC active
│  │  Coupling RIGHT ● LOCKED       │    │
│  │  Rear Open Hall ○ INACTIVE     │    │
│  │  Parcel Shelf   ● CLOSED       │    │
│  └────────────────────────────────┘    │
│                                         │
│  ┌─ HYDRAULIC ────────────────────┐    │
│  │  Pump Motor     ○ OFF          │    │
│  └────────────────────────────────┘    │
│                                         │
│  [Start Monitoring]  [Stop]             │
│                                         │
│  Raw: 62 D0 00 3F 82 01 A0 ...        │  ← always show raw hex
└─────────────────────────────────────────┘
```

**Switch indicator states (5 possible):**
| Visual | Meaning | When |
|---|---|---|
| Green filled dot (●) | CLOSED / ACTIVE / LOCKED | Switch is making contact |
| Grey hollow dot (○) | OPEN / INACTIVE / UNLOCKED | Switch is not making contact |
| Red pulsing dot (●) | FAULT — switch has active DTC | Associated fault code is in the active DTC list |
| Amber animated dot | TRANSITIONING | Value changed in last 500ms |
| Grey question mark (?) | UNKNOWN | Read failed or data ambiguous — never fake a state |

**Roof Phase indicator** at the top uses `inferRoofPhase()` to show the overall state:
- "CLOSED (all latched)" / "OPENING — step 3: fold beginning" / "OPEN (stowed)" / "ERROR — unexpected state combination"

**Each switch row is tappable** — expands to show:
- Physical location description
- Associated fault code and its status
- Last state change timestamp
- "Normally X when roof closed, Y when roof open"

### Step 6: DID Discovery/Probe UI

**File:** `src/views/RoofView.jsx` — add "Probe CVM" section

This is the first-run experience and also available for re-probing:

1. **Gate check:** Only enabled if `cvmReachable === true` (adapter already proved it can talk to CVM via DTC scan)
2. "Probe CVM Capabilities" button — runs the probe sequence
3. Shows progress: "Probing DID 0xF100... supported! (12 bytes)" / "DID 0x2000... not supported (NRC 0x31)"
4. Stores discovered DIDs + their byte lengths in localStorage keyed by vehicle VIN
5. Once probe completes:
   - If status DIDs found → enable "Start Monitoring" button
   - If no status DIDs found but 0x22 works → offer "Extended Scan" (Phase 2 range scan)
   - If 0x22 not supported at all → show explanation, keep DTC-only mode
6. **Manual calibration mode** (advanced): "Press a switch and tap 'Capture' to identify which bit changed" — reads a DID, waits for user action, reads again, diffs the bytes

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

**Highest risk: DID discovery.** We don't have a published list of which DIDs the R57 CVM exposes — BMW keeps this proprietary in SGBD files. The probe approach mitigates this entirely:
- Best case: we find the status DIDs on first probe and get live switch states immediately
- Middle case: we find 0x22 is supported but need the extended range scan to locate the right DIDs
- Worst case: 0x22 is not supported — we fall back to periodic DTC reads (0x19) which still tell us *which* switches have faulted, plus the reference database

**Mitigation for DID uncertainty:** The manual calibration mode is the ultimate fallback. User operates a switch, we diff the bytes, we identify the bit. This produces verified mappings that can be shared to the community and hardcoded in future versions.

**Medium risk: Adapter compatibility.** ~50-70% of cheap ELM327 BLE clones cannot reach the CVM at all. But this is already a known limitation — the existing DTC scan (`19 02 FF`) faces the same issue. We never attempt 0x22 unless 0x19 already succeeded, so we don't introduce new failures.

**Lowest risk: Transport layer.** Everything in the ELM327/BLE stack is proven. CVM communication already works for DTCs using the exact same addressing (ATSH 660 / ATCRA 6E0). We're sending a different UDS service byte (0x22 vs 0x19) over the same path.

## Research Sources

- [R57 convertible top problems guide — mini2.com](https://www.mini2.com/threads/my-complete-guide-to-the-convertible-top-problems.299769/)
- [R57 convertible electrical drawings — mini2.com](https://www.mini2.com/threads/convertible-electrical-drawing-for-switches-relays-cvm.370128/)
- [Roof micro switches and hall sensors — z4-forum.com](https://z4-forum.com/forum/viewtopic.php?t=95385)
- [BMW CVM Training Document (E46) — Internet Archive](https://ia800902.us.archive.org/26/items/BMWTechnicalTrainingDocuments/ST034%20E46%20Complete%20Vehicle/5%20CVM%20and%20Convertible%20Top.pdf)
- [BMW E93 Complete Vehicle Workbook (ST701) — Internet Archive](https://ia600902.us.archive.org/26/items/BMWTechnicalTrainingDocuments/ST701%20E93%20Complete%20Vehicle%20Workbook/ST701%2520E93%2520Complete%2520Vehicle_WB_web.pdf)
- [Deep OBD / ediabaslib — GitHub](https://github.com/uholeschak/ediabaslib)
- [BMW F-Series diagnostic addressing — Project Gus](https://www.projectgus.com/2022/06/bmw-f-series-gear-selector-part-two-breakthrough/)
- [SmartTOP for BMW E88/MINI R57 — mods4cars](https://www.mods4cars.com/sms/db/smarttop/ext/support/manuals/bmw/STLFBW4/install_1er/en.php)
