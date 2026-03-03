# Andy's OBD App — Product Requirements Document

## Product Overview

A native iOS app for BMW MINI OBD-II vehicle diagnostics, built as a Capacitor-wrapped Vite+React SPA. Connects to the vehicle's OBD-II port via BLE ELM327 adapter to read live engine data, fault codes, and vehicle information. Supports multi-vehicle management with persistent history.

## Target Vehicle

BMW MINI R56/R57 (2006–2013). R57 convertible roof diagnostics are a first-class feature.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | React 18, Vite |
| Native | Capacitor 6 (iOS) |
| BLE | `@capacitor-community/bluetooth-le` |
| Styling | Inline styles (no CSS framework) |
| Persistence | localStorage |
| Deployment | Xcode / iOS Simulator (no Vercel) |

## Features

### 1. BLE Adapter Connection (Connect Tab)

- Scan for BLE OBD-II adapters with known adapter profile matching
- **Multi-protocol selection**: All 10 ELM327 protocols (ATSP0–9) — CAN, K-line, J1850, KWP. Default: protocol 6 (ISO 15765-4 CAN 11-bit 500k). Auto-detect (ATSP0) available with 10s timeout.
- **Custom adapter profiles**: User-defined GATT profiles for adapters with non-standard UUIDs. CRUD with UUID validation (4-char short hex or 36-char 128-bit). Persisted as `obd_custom_profiles` in localStorage. Custom profiles appear in adapter profile dropdown and are included in BLE scan service UUIDs.
- One-tap connect/disconnect
- Connection status with signal quality indicator
- Adapter info display (firmware, protocol, voltage)
- **Demo mode**: Simulated adapter with fake live data, mock DTCs, and a pre-populated demo vehicle (Betty, R57 Cooper S)

### 2. Live Data Dashboard (Dashboard Tab)

- Real-time PID gauges: RPM, speed, coolant temp, intake temp, MAF, throttle, fuel pressure, timing advance, engine load
- SVG circular arc gauges with colour-coded thresholds (blue → amber → red)
- Sparkline mini-charts showing recent history per PID
- Configurable polling interval

### 2b. Custom Dashboard (Custom Tab)

- User-configurable widgets for any supported PID
- Three display types: gauge, number readout, bar gauge
- Widget sizes: small, medium, large
- Full PID catalog (all standard OBD-II PIDs) available for widget selection
- Add/remove widgets, persisted as `obd_custom_widgets` in localStorage
- Custom widget PIDs automatically included in polling cycle

### 3. Diagnostic Trouble Codes (Diagnostics Tab)

- Read stored DTCs (Mode 03)
- Read pending DTCs (Mode 07)
- Read permanent DTCs (Mode 0A)
- Built-in DTC database with human-readable descriptions
- Clear DTCs with two-tap confirmation (Mode 04)
- Monitor readiness status (Mode 01 PID 01)

### 4. R57 Convertible Roof (Roof Tab)

- Roof fault code lookup (MINI-specific codes)
- CCID (Condition Code ID) lookup
- Roof failure point database with descriptions
- Database size stats

### 5. Vehicle Management (Vehicle Tab)

#### 5a. Multi-Vehicle Support
- Add vehicles manually (nickname + optional VIN)
- **Add current vehicle**: Read VIN from connected adapter, display decoded VIN summary card (model, chassis, year, body), pre-fill nickname
- Add vehicles via DVLA VRN lookup (auto-populates make, model, colour, MOT/tax dates)
- Horizontal scrollable chip strip for vehicle switching
- Inline edit nickname, inline delete with two-tap confirmation
- Legacy migration: existing `obd_vin` auto-migrates to new multi-vehicle model

#### 5b. Vehicle Information
- VIN decode from OBD read (WMI, VDS, VIS structure)
- DVLA data card (make, model, colour, fuel, MOT expiry, tax due, year, engine)
- Battery voltage with sparkline history

#### 5c. DTC History (per vehicle)
- Persistent fault code history across sessions
- Tracks first seen, last seen, occurrence count
- Status toggles: Active / Explored / Fixed
- Auto-dedup on subsequent scans

#### 5d. MOT/Tax Expiry Warnings
- Checks MOT expiry and tax due dates from DVLA data
- Warning card: amber for within 30 days, red for expired
- Warning dot on Vehicle tab icon (red if any expired, amber if approaching)
- Days remaining or "EXPIRED" badge

#### 5e. Service Reminder Tracker
- 8 service types: Oil Change, Tyres, Brake Pads, Brake Discs, Air Filter, Spark Plugs, Coolant, Other
- Inline add form: type dropdown, date, mileage, notes, next due date/mileage
- Service list sorted by date descending
- OVERDUE / DUE SOON badges when nextDueDate is past or within 30 days
- Delete per entry

#### 5f. Share Vehicle Report
- Compiles plain-text report: nickname, VRN, DVLA data, VIN data, battery voltage, DTC history, service log
- Uses `navigator.share()` Web Share API with clipboard fallback
- Feedback toast: "Copied!" / "Shared!" / "Share failed"

## Data Model

### Vehicle Record
```
{
  id, nickname, vrn,
  vinData: { wmi, vds, vis, year, manufacturer, ... },
  dvlaData: { registrationNumber, make, model, colour, fuelType, motExpiryDate, taxDueDate, yearOfManufacture, engineCapacity },
  dtcHistory: [{ code, description, status, occurrences, firstSeen, lastSeen }],
  serviceLog: [{ id, type, date, mileage, notes, nextDueMileage, nextDueDate }],
  batteryHistory: [],
  lastBatteryVoltage,
  createdAt
}
```

### Custom Adapter Profile
```
{
  id, name,
  serviceUUID,   // 4-char short hex or 36-char 128-bit
  writeUUID,
  notifyUUID,
  mtu            // 20–512
}
```

### Custom Widget
```
{
  id, pid,       // OBD PID code (e.g. '0C')
  display,       // 'gauge' | 'number' | 'bar'
  size,          // 'sm' | 'md' | 'lg'
  order          // position index
}
```

### Persistence
- `obd_vehicles` — vehicle array
- `obd_active_vehicle` — active vehicle ID
- `obd_protocol` — ELM327 protocol code ('0'–'9', default '6')
- `obd_custom_profiles` — custom BLE adapter profiles array
- `obd_custom_widgets` — `{ widgets: [...], version: 1 }`
- Legacy `obd_vin` auto-migrated on first load

## UI Architecture

- 6-tab bottom navigation: Connect, Live, Custom, DTCs, Roof, Vehicle
- Dark theme (glassmorphic cards, blue accent #3b82f6)
- Shared components: Gauge, Card, Badge, Sparkline, Pulse, ErrorBoundary, ActionButton, InfoRow, NumberReadout, SignalBars
- iOS safe-area handled by tab bar (single owner)
- Hash-based routing (`#connect`, `#dashboard`, `#custom`, `#diagnostics`, `#roof`, `#vehicle`)

## File Structure

```
src/App.jsx                        — Main app. State, handlers, tab bar, modal orchestration.
src/views/
  ConnectView.jsx                  — Connect tab: scan, profile/protocol selection, custom profiles
  DashboardView.jsx                — Live data tab: PID gauges, sparklines
  CustomDashboardView.jsx          — Custom dashboard tab: configurable widgets
  DiagnosticsView.jsx              — DTCs tab: stored/pending/permanent DTCs, monitor status
  RoofView.jsx                     — Roof tab: R57 fault codes, CCID lookup
  VehicleView.jsx                  — Vehicle tab: multi-vehicle, DVLA, service log, share report
  AddVehicleModal.jsx              — Add vehicle modal with VRN lookup + prefill VIN
src/components/
  shared.jsx                       — Shared UI components + COLORS constant
  BarGauge.jsx                     — Horizontal bar gauge widget
  WidgetConfigModal.jsx            — Widget configuration modal for custom dashboard
  CustomProfileModal.jsx           — Custom BLE adapter profile modal
src/obd/
  ble-transport.js                 — BLE scanning, connect, disconnect, characteristic I/O
  elm327.js                        — ELM327 AT commands, PID queries, DTC read/clear, VIN read
  obd-pids.js                      — Core PID definitions and decoders
  pid-catalog.js                   — Full OBD-II PID catalog for widget selection
  adapter-profiles.js              — Adapter profiles, OBD protocols, custom profile CRUD
  command-safety.js                — Command whitelist/safety classification
  dtc-database.js                  — DTC code → description lookup
  roof-codes.js                    — R57 convertible roof fault codes, CCID codes
  vin-decoder.js                   — VIN structure decode (WMI, VDS, VIS)
```

## Known Limitations

- DVLA VRN lookup is currently mock data (real DVLA VES API pending API key)
- iOS Simulator doesn't support `navigator.share()` — clipboard fallback only
- No cloud sync — all data is device-local in localStorage
- No TypeScript — runtime crashes possible from undefined JSX variables
- No automated tests

## Roadmap

- [x] ~~Extract remaining views from App.jsx~~ — Done (Connect, Dashboard, Custom, Diagnostics, Roof all extracted)
- [x] ~~Multi-protocol support~~ — Done (ATSP0–9, auto-detect with extended timeout)
- [x] ~~Custom adapter profiles~~ — Done (CRUD, UUID validation, dynamic scan UUIDs)
- [x] ~~Custom dashboard with configurable widgets~~ — Done (gauge/number/bar, full PID catalog)
- [x] ~~Demo mode~~ — Done (simulated live data, mock DTCs, demo vehicle)
- [x] ~~Add current vehicle from adapter~~ — Done (VIN read + prefill modal)
- [ ] Real DVLA VES API integration (when API key arrives)
- [ ] Odometer/mileage tracking from OBD PID 0x31 (auto-populate service mileage)
- [ ] DTC history export/share
- [ ] Notes field on DTC history entries
- [ ] Cloud sync (iCloud or Supabase) for cross-device persistence
