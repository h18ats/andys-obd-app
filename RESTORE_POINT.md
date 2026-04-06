# Restore Point: v1.0.18

**Date:** 2026-04-06
**Commit:** 0b2df0a
**Branch:** main

## What's in v1.0.18 (since v1.0.17)

### CVM Live Microswitch Monitoring
- Real-time switch/sensor status via UDS ReadDataByIdentifier (0x22)
- 11 switches/sensors: cowl locked/unlocked/reached, hall erected/stowed, pillar angle, coupling L/R, rear open, parcel shelf, pump motor
- Roof phase inference (closed → unlatching → folding → boot opening → stowing → open)
- DID probe-and-discover for BMW's proprietary DID addresses
- Raw hex explorer with bit-level breakdown for unknown DIDs
- Standalone CVM polling loop (independent of dashboard PID polling)
- Auto-stops on vehicle moving (speed > 0) or 3 consecutive failures

### Hardened UDS Parser
- Handles SEARCHING..., BUFFER FULL, CAN ERROR, BUS INIT, timeout markers
- Multi-frame response boundary detection
- 56 unit tests (vitest)

### PWA Support
- manifest.json, service worker, icons
- Installable on Android via Chrome "Add to Home Screen"
- Offline caching

### Vercel Ready
- Base path: `/` for Vercel, `/andys-obd-app/` for GitHub Pages
- Build: `npm run build` → `dist/`

## To restore to this point
```bash
git checkout main
git reset --hard 0b2df0a
```

## Files changed (vs v1.0.17)
- src/obd/cvm-status.js (new — 639 lines)
- src/obd/cvm-status.test.js (new — 56 tests)
- src/obd/elm327.js (CVM DID read/probe methods)
- src/obd/command-safety.js (allow UDS 0x22, 0x10)
- src/obd/roof-codes.js (4 new fault codes)
- src/App.jsx (standalone CVM polling loop)
- src/views/RoofView.jsx (live switch UI, hex explorer)
- vite.config.js (base path)
- package.json (v1.0.18, vitest)
- public/manifest.json, public/sw.js, public/icon-*.png (PWA)
- docs/ (GitHub Pages deploy)
- .github/workflows/deploy-pages.yml
