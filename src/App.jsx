import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Pulse, ErrorBoundary, COLORS, Badge } from './components/shared.jsx';
import { scanForAdapters, connect, disconnect, isConnected } from './obd/ble-transport.js';
import { initAdapter, queryPIDs, readStoredDTCs, readPendingDTCs, readPermanentDTCs, readVIN, readBatteryVoltage, querySupportedPIDs, readMonitorStatus, clearQueue } from './obd/elm327.js';
import { ALL_PIDS } from './obd/obd-pids.js';
import { ADAPTER_PROFILES } from './obd/adapter-profiles.js';
import { decodeVIN } from './obd/vin-decoder.js';
import ConnectView from './views/ConnectView.jsx';
import DashboardView from './views/DashboardView.jsx';
import DiagnosticsView from './views/DiagnosticsView.jsx';
import RoofView from './views/RoofView.jsx';
import VehicleView from './views/VehicleView.jsx';
import AddVehicleModal from './views/AddVehicleModal.jsx';

// --- Views ---
const VIEWS = {
  CONNECT: 'connect',
  DASHBOARD: 'dashboard',
  DIAGNOSTICS: 'diagnostics',
  ROOF: 'roof',
  VEHICLE: 'vehicle',
};

const TAB_ICONS = {
  [VIEWS.CONNECT]: '⚡',
  [VIEWS.DASHBOARD]: '◎',
  [VIEWS.DIAGNOSTICS]: '⚠',
  [VIEWS.ROOF]: '▽',
  [VIEWS.VEHICLE]: '🚗',
};

const TAB_LABELS = {
  [VIEWS.CONNECT]: 'Connect',
  [VIEWS.DASHBOARD]: 'Live',
  [VIEWS.DIAGNOSTICS]: 'DTCs',
  [VIEWS.ROOF]: 'Roof',
  [VIEWS.VEHICLE]: 'Vehicle',
};

// --- MOT/Tax expiry warning helper ---
function getExpiryWarnings(vehicles) {
  const now = new Date();
  const warnings = [];
  for (const v of vehicles) {
    const dvla = v.dvlaData;
    if (!dvla) continue;
    const checks = [
      { type: 'MOT', date: dvla.motExpiryDate, label: 'MOT' },
      { type: 'Tax', date: dvla.taxDueDate, label: 'Tax' },
    ];
    for (const { type, date, label } of checks) {
      if (!date) continue;
      const expiry = new Date(date);
      const diffMs = expiry - now;
      const daysRemaining = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
      if (daysRemaining <= 30) {
        warnings.push({
          vehicleId: v.id,
          vehicleName: v.nickname,
          type: label,
          date,
          daysRemaining,
          expired: daysRemaining < 0,
        });
      }
    }
  }
  return warnings;
}

// --- History buffer for sparklines ---
const HISTORY_SIZE = 30;

function useHistory() {
  const ref = useRef({});
  return {
    push(pid, value) {
      if (!ref.current[pid]) ref.current[pid] = [];
      ref.current[pid].push(value);
      if (ref.current[pid].length > HISTORY_SIZE) ref.current[pid].shift();
    },
    get(pid) { return ref.current[pid] || []; },
    clear() { ref.current = {}; },
  };
}

// --- Persist/restore state ---
function loadState(key, fallback) {
  try {
    const v = localStorage.getItem(`obd_${key}`);
    return v ? JSON.parse(v) : fallback;
  } catch { return fallback; }
}
function saveState(key, value) {
  try { localStorage.setItem(`obd_${key}`, JSON.stringify(value)); } catch {}
}

// ==================== APP ====================
export default function App() {
  // Navigation
  const [view, setView] = useState(() => {
    const hash = window.location.hash.replace('#', '');
    return Object.values(VIEWS).includes(hash) ? hash : VIEWS.CONNECT;
  });

  // Connection
  const [scanning, setScanning] = useState(false);
  const [devices, setDevices] = useState([]);
  const [connecting, setConnecting] = useState(false);
  const [connected, setConnected] = useState(false);
  const [adapterInfo, setAdapterInfo] = useState(null);
  const [connectionError, setConnectionError] = useState(null);
  const [selectedProfile, setSelectedProfile] = useState('auto');

  // Live data
  const [liveData, setLiveData] = useState({});
  const [polling, setPolling] = useState(false);
  const pollingRef = useRef(false);
  const history = useHistory();

  // Diagnostics
  const [storedDTCs, setStoredDTCs] = useState([]);
  const [pendingDTCs, setPendingDTCs] = useState([]);
  const [permanentDTCs, setPermanentDTCs] = useState([]);
  const [readingDTCs, setReadingDTCs] = useState(false);
  const [monitorStatus, setMonitorStatus] = useState(null);

  // Vehicle management
  const [vehicles, setVehicles] = useState(() => {
    const stored = loadState('vehicles', null);
    if (stored) return stored;
    // Migration: convert legacy single VIN to vehicle record
    const legacyVin = loadState('vin', null);
    if (legacyVin?.valid) {
      const vehicle = {
        id: `v_${Date.now()}`,
        nickname: legacyVin.model ? `MINI ${legacyVin.model}` : 'My Vehicle',
        vinData: legacyVin,
        addedAt: new Date().toISOString(),
        lastConnected: null,
        dtcHistory: [],
      };
      saveState('vehicles', [vehicle]);
      saveState('active_vehicle', vehicle.id);
      localStorage.removeItem('obd_vin');
      return [vehicle];
    }
    return [];
  });
  const [activeVehicleId, setActiveVehicleId] = useState(() => loadState('active_vehicle', null));
  const [showAddVehicle, setShowAddVehicle] = useState(false);
  const [batteryVoltage, setBatteryVoltage] = useState(null);
  const [supportedPIDs, setSupportedPIDs] = useState(new Set());
  const [readingVehicle, setReadingVehicle] = useState(false);

  // Derived state (backward-compatible)
  const activeVehicle = vehicles.find(v => v.id === activeVehicleId) || vehicles[0] || null;
  const vinData = activeVehicle?.vinData || null;

  // Hash routing
  useEffect(() => {
    window.location.hash = view;
    const onHash = () => {
      const h = window.location.hash.replace('#', '');
      if (Object.values(VIEWS).includes(h)) setView(h);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, [view]);

  // --- BLE Scan ---
  const handleScan = useCallback(async () => {
    setScanning(true);
    setDevices([]);
    setConnectionError(null);
    try {
      await scanForAdapters((device) => {
        setDevices((prev) => {
          if (prev.some((d) => d.deviceId === device.deviceId)) return prev;
          return [...prev, device];
        });
      }, 10000);
    } catch (err) {
      setConnectionError(err.message);
    }
    setScanning(false);
  }, []);

  // --- Connect to adapter ---
  const handleConnect = useCallback(async (device) => {
    setConnecting(true);
    setConnectionError(null);
    try {
      const profile = selectedProfile === 'auto' ? undefined : ADAPTER_PROFILES[selectedProfile];
      await connect(device.deviceId, device.name, profile);

      const info = await initAdapter();
      setAdapterInfo({ ...info, deviceName: device.name });
      setConnected(true);
      setView(VIEWS.DASHBOARD);
    } catch (err) {
      setConnectionError(err.message);
      try { await disconnect(); } catch {}
    }
    setConnecting(false);
  }, [selectedProfile]);

  // --- Disconnect ---
  const handleDisconnect = useCallback(async () => {
    pollingRef.current = false;
    setPolling(false);
    clearQueue();
    try { await disconnect(); } catch {}
    setConnected(false);
    setAdapterInfo(null);
    setLiveData({});
    history.clear();
    setView(VIEWS.CONNECT);
  }, []);

  // --- Polling loop ---
  const startPolling = useCallback(async () => {
    if (pollingRef.current) return;
    pollingRef.current = true;
    setPolling(true);

    while (pollingRef.current && isConnected()) {
      try {
        const results = await queryPIDs(ALL_PIDS);
        setLiveData(results);
        for (const [pid, data] of Object.entries(results)) {
          if (data?.value !== undefined) history.push(pid, data.value);
        }
      } catch (err) {
        console.warn('Poll error:', err.message);
      }
      // ~500ms between polls
      await new Promise((r) => setTimeout(r, 500));
    }

    // Detect BLE disconnect that terminated the loop
    if (!isConnected()) {
      setConnected(false);
      setAdapterInfo(null);
    }

    setPolling(false);
  }, []);

  const stopPolling = useCallback(() => {
    pollingRef.current = false;
    setPolling(false);
  }, []);

  // --- Read DTCs ---
  const handleReadDTCs = useCallback(async () => {
    setReadingDTCs(true);
    try {
      const [stored, pending, permanent, monitor] = await Promise.all([
        readStoredDTCs(),
        readPendingDTCs(),
        readPermanentDTCs(),
        readMonitorStatus(),
      ]);
      setStoredDTCs(stored);
      setPendingDTCs(pending);
      setPermanentDTCs(permanent);
      setMonitorStatus(monitor);

      // Merge into active vehicle's DTC history
      const targetId = activeVehicle?.id;
      if (targetId) {
        const now = new Date().toISOString();
        const allDtcs = [
          ...stored.map(d => ({ ...d, source: 'stored' })),
          ...pending.map(d => ({ ...d, source: 'pending' })),
          ...permanent.map(d => ({ ...d, source: 'permanent' })),
        ];
        if (allDtcs.length > 0) {
          // Pre-compute IDs outside updater to keep it pure
          let idCounter = 0;
          const dtcIds = allDtcs.map(() => `dtc_${Date.now()}_${(idCounter++).toString(36)}_${Math.random().toString(36).slice(2, 6)}`);
          setVehicles(prev => {
            const next = prev.map(v => {
              if (v.id !== targetId) return v;
              const history = [...(v.dtcHistory || [])];
              for (let i = 0; i < allDtcs.length; i++) {
                const dtc = allDtcs[i];
                const idx = history.findIndex(h => h.code === dtc.code);
                if (idx >= 0) {
                  history[idx] = { ...history[idx], lastSeen: now, occurrences: (history[idx].occurrences || 1) + 1, source: dtc.source };
                } else {
                  history.push({
                    id: dtcIds[i],
                    code: dtc.code, desc: dtc.desc, severity: dtc.severity, source: dtc.source,
                    firstSeen: now, lastSeen: now, occurrences: 1,
                    status: 'active', statusChangedAt: null, notes: '',
                  });
                }
              }
              return { ...v, dtcHistory: history };
            });
            saveState('vehicles', next);
            return next;
          });
        }
      }
    } catch (err) {
      console.warn('DTC read error:', err.message);
    }
    setReadingDTCs(false);
  }, [activeVehicle?.id]);

  // --- Read vehicle info ---
  const handleReadVehicle = useCallback(async () => {
    setReadingVehicle(true);
    try {
      const [vin, voltage, pids] = await Promise.all([
        readVIN(),
        readBatteryVoltage(),
        querySupportedPIDs(),
      ]);
      setBatteryVoltage(voltage);
      setSupportedPIDs(pids);

      if (vin?.valid) {
        // Pre-compute values outside updater to keep it pure
        const now = new Date().toISOString();
        const newVehicleId = `v_${Date.now()}`;
        let newActiveId = null;
        setVehicles(prev => {
          const existing = prev.find(v => v.vinData?.vin === vin.vin);
          if (existing) {
            newActiveId = existing.id;
            const next = prev.map(v => v.id === existing.id
              ? { ...v, vinData: vin, lastConnected: now }
              : v
            );
            saveState('vehicles', next);
            return next;
          }
          const vehicle = {
            id: newVehicleId,
            nickname: vin.model ? `MINI ${vin.model}` : 'My Vehicle',
            vinData: vin,
            addedAt: now,
            lastConnected: now,
            dtcHistory: [],
          };
          newActiveId = vehicle.id;
          const next = [...prev, vehicle];
          saveState('vehicles', next);
          return next;
        });
        if (newActiveId) {
          setActiveVehicleId(newActiveId);
          saveState('active_vehicle', newActiveId);
        }
      }
    } catch (err) {
      console.warn('Vehicle read error:', err.message);
    }
    setReadingVehicle(false);
  }, []);

  // --- Vehicle management handlers ---
  const handleSelectVehicle = useCallback((id) => {
    setActiveVehicleId(id);
    saveState('active_vehicle', id);
  }, []);

  const handleAddVehicle = useCallback((nickname, vinString, vrn, dvlaData) => {
    const vinResult = vinString ? decodeVIN(vinString) : null;
    const vehicle = {
      id: `v_${Date.now()}`,
      nickname: nickname || 'New Vehicle',
      vinData: vinResult?.valid ? vinResult : null,
      vrn: vrn || null,
      dvlaData: dvlaData || null,
      addedAt: new Date().toISOString(),
      lastConnected: null,
      dtcHistory: [],
      serviceLog: [],
    };
    setVehicles(prev => {
      const next = [...prev, vehicle];
      saveState('vehicles', next);
      return next;
    });
    setActiveVehicleId(vehicle.id);
    saveState('active_vehicle', vehicle.id);
    setShowAddVehicle(false);
  }, []);

  const handleEditVehicle = useCallback((id, nickname) => {
    setVehicles(prev => {
      const next = prev.map(v => v.id === id ? { ...v, nickname } : v);
      saveState('vehicles', next);
      return next;
    });
  }, []);

  const handleDeleteVehicle = useCallback((id) => {
    setVehicles(prev => {
      const next = prev.filter(v => v.id !== id);
      saveState('vehicles', next);
      // Derive new active ID from the updated list, not a stale closure
      setActiveVehicleId(currentActive => {
        if (currentActive === id) {
          const newId = next[0]?.id || null;
          saveState('active_vehicle', newId);
          return newId;
        }
        return currentActive;
      });
      return next;
    });
  }, []);

  const handleUpdateDtcStatus = useCallback((vehicleId, dtcId, status) => {
    setVehicles(prev => {
      const next = prev.map(v => {
        if (v.id !== vehicleId) return v;
        return {
          ...v,
          dtcHistory: v.dtcHistory.map(d =>
            d.id === dtcId ? { ...d, status, statusChangedAt: new Date().toISOString() } : d
          ),
        };
      });
      saveState('vehicles', next);
      return next;
    });
  }, []);

  // --- Service log handlers ---
  const handleAddService = useCallback((vehicleId, entry) => {
    setVehicles(prev => {
      const next = prev.map(v => {
        if (v.id !== vehicleId) return v;
        return { ...v, serviceLog: [...(v.serviceLog || []), entry] };
      });
      saveState('vehicles', next);
      return next;
    });
  }, []);

  const handleDeleteService = useCallback((vehicleId, serviceId) => {
    setVehicles(prev => {
      const next = prev.map(v => {
        if (v.id !== vehicleId) return v;
        return { ...v, serviceLog: (v.serviceLog || []).filter(s => s.id !== serviceId) };
      });
      saveState('vehicles', next);
      return next;
    });
  }, []);

  // --- Expiry warnings (derived) ---
  const expiryWarnings = getExpiryWarnings(vehicles);
  const hasExpiryWarning = expiryWarnings.length > 0;
  const hasExpired = expiryWarnings.some(w => w.expired);

  // ==================== RENDER ====================
  return (
    <ErrorBoundary>
      <div style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: 'linear-gradient(180deg, #0a0f1a 0%, #0f172a 50%, #131b30 100%)',
      }}>
        {/* Header */}
        <div style={{
          padding: '12px 16px 8px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div>
              <h1 style={{ fontSize: '18px', fontWeight: 700, color: COLORS.text, margin: 0 }}>
                OBD Diagnostics
              </h1>
              <span style={{ fontSize: '11px', color: COLORS.textMuted }}>
                {activeVehicle ? (activeVehicle.vinData?.chassis || activeVehicle.nickname) : 'No vehicle'}
              </span>
            </div>
            {activeVehicle && (
              <button
                onClick={() => setView(VIEWS.VEHICLE)}
                style={{
                  padding: '4px 10px', borderRadius: '12px',
                  background: `${COLORS.accent}20`, border: `1px solid ${COLORS.accent}40`,
                  color: COLORS.accent, fontSize: '11px', fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                {activeVehicle.nickname}
              </button>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {connected && <Pulse color={COLORS.ok} size={8} />}
            <Badge
              label={connected ? 'Connected' : 'Disconnected'}
              variant={connected ? 'ok' : 'info'}
            />
          </div>
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflow: 'auto', padding: '0 12px 12px' }}>
          {view === VIEWS.CONNECT && (
            <ConnectView
              scanning={scanning}
              devices={devices}
              connecting={connecting}
              connected={connected}
              connectionError={connectionError}
              selectedProfile={selectedProfile}
              adapterInfo={adapterInfo}
              onScan={handleScan}
              onConnect={handleConnect}
              onDisconnect={handleDisconnect}
              onProfileChange={setSelectedProfile}
            />
          )}
          {view === VIEWS.DASHBOARD && (
            <DashboardView
              connected={connected}
              liveData={liveData}
              polling={polling}
              history={history}
              onStartPolling={startPolling}
              onStopPolling={stopPolling}
            />
          )}
          {view === VIEWS.DIAGNOSTICS && (
            <DiagnosticsView
              connected={connected}
              storedDTCs={storedDTCs}
              pendingDTCs={pendingDTCs}
              permanentDTCs={permanentDTCs}
              readingDTCs={readingDTCs}
              monitorStatus={monitorStatus}
              onReadDTCs={handleReadDTCs}
            />
          )}
          {view === VIEWS.ROOF && (
            <RoofView vinData={vinData} />
          )}
          {view === VIEWS.VEHICLE && (
            <VehicleView
              connected={connected}
              vinData={vinData}
              batteryVoltage={batteryVoltage}
              supportedPIDs={supportedPIDs}
              adapterInfo={adapterInfo}
              readingVehicle={readingVehicle}
              onReadVehicle={handleReadVehicle}
              vehicles={vehicles}
              activeVehicle={activeVehicle}
              onSelectVehicle={handleSelectVehicle}
              onShowAddVehicle={() => setShowAddVehicle(true)}
              onEditVehicle={handleEditVehicle}
              onDeleteVehicle={handleDeleteVehicle}
              onUpdateDtcStatus={handleUpdateDtcStatus}
              expiryWarnings={expiryWarnings}
              onAddService={handleAddService}
              onDeleteService={handleDeleteService}
            />
          )}
        </div>

        {/* Bottom tab bar */}
        <div style={{
          display: 'flex',
          borderTop: `1px solid ${COLORS.bgCardBorder}`,
          background: 'rgba(10, 15, 26, 0.95)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          paddingBottom: 'env(safe-area-inset-bottom)',
        }}>
          {Object.values(VIEWS).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              style={{
                flex: 1,
                padding: '10px 0 8px',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '2px',
                color: view === v ? COLORS.accent : COLORS.textMuted,
                transition: 'color 0.2s',
                position: 'relative',
              }}
            >
              <span style={{ fontSize: '18px' }}>{TAB_ICONS[v]}</span>
              <span style={{ fontSize: '10px', fontWeight: 600, letterSpacing: '0.03em' }}>
                {TAB_LABELS[v]}
              </span>
              {v === VIEWS.VEHICLE && hasExpiryWarning && (
                <span style={{
                  position: 'absolute', top: '6px', right: 'calc(50% - 16px)',
                  width: '8px', height: '8px', borderRadius: '50%',
                  background: hasExpired ? COLORS.fault : COLORS.warn,
                }} />
              )}
            </button>
          ))}
        </div>

        {/* Add Vehicle Modal */}
        {showAddVehicle && (
          <AddVehicleModal
            onAdd={handleAddVehicle}
            onClose={() => setShowAddVehicle(false)}
          />
        )}
      </div>
    </ErrorBoundary>
  );
}

