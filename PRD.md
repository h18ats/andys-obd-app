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
- One-tap connect/disconnect
- Connection status with signal quality indicator
- Adapter info display (firmware, protocol, voltage)

### 2. Live Data Dashboard (Dashboard Tab)

- Real-time PID gauges: RPM, speed, coolant temp, intake temp, MAF, throttle, fuel pressure, timing advance, engine load
- SVG circular arc gauges with colour-coded thresholds (blue → amber → red)
- Sparkline mini-charts showing recent history per PID
- Configurable polling interval

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

### Persistence
- `obd_vehicles` — vehicle array
- `obd_active_vehicle` — active vehicle ID
- Legacy `obd_vin` auto-migrated on first load

## UI Architecture

- 5-tab bottom navigation: Connect, Live, DTCs, Roof, Vehicle
- Dark theme (glassmorphic cards, blue accent #3b82f6)
- Shared components: Gauge, Card, Badge, Sparkline, Pulse, ErrorBoundary, ActionButton, InfoRow
- iOS safe-area handled by tab bar (single owner)
- No routing library — view state managed by `activeView` string

## File Structure

```
src/App.jsx           — ~1463 lines (Connect, Dashboard, Diagnostics, Roof views + tab bar + state)
src/views/VehicleView.jsx — ~628 lines (Vehicle tab)
src/components/shared.jsx — ~249 lines (shared components + COLORS)
src/obd/*.js          — 8 modules (BLE, ELM327, PIDs, adapters, safety, DTCs, roof, VIN)
```

## Known Limitations

- DVLA VRN lookup is currently mock data (real DVLA VES API pending API key)
- iOS Simulator doesn't support `navigator.share()` — clipboard fallback only
- No cloud sync — all data is device-local in localStorage
- No TypeScript — runtime crashes possible from undefined JSX variables
- No automated tests

## Roadmap

1. Real DVLA VES API integration (when API key arrives)
2. Odometer/mileage tracking from OBD PID 0x31 (auto-populate service mileage)
3. Extract remaining views from App.jsx (Dashboard, Diagnostics, Roof)
4. DTC history export/share
5. Notes field on DTC history entries
6. Cloud sync (iCloud or Supabase) for cross-device persistence
