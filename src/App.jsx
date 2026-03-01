import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Gauge, Card, Badge, Sparkline, Pulse, ErrorBoundary, COLORS } from './components/shared.jsx';
import { scanForAdapters, stopScan, connect, disconnect, isConnected, getConnectionInfo } from './obd/ble-transport.js';
import { initAdapter, queryPIDs, readStoredDTCs, readPendingDTCs, readPermanentDTCs, readVIN, readBatteryVoltage, querySupportedPIDs, readMonitorStatus, sendSafeCommand, clearQueue } from './obd/elm327.js';
import { DASHBOARD_PIDS, DETAIL_PIDS, ALL_PIDS, PIDS } from './obd/obd-pids.js';
import { ADAPTER_PROFILES } from './obd/adapter-profiles.js';
import { getDatabaseSize } from './obd/dtc-database.js';
import { getAuditLog } from './obd/command-safety.js';
import { ROOF_CODES, ROOF_CCID_CODES, ROOF_FAILURE_POINTS, lookupRoofCode, lookupCCID, getRoofDatabaseSize } from './obd/roof-codes.js';
import { decodeVIN } from './obd/vin-decoder.js';

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

  const handleAddVehicle = useCallback((nickname, vinString) => {
    const vinResult = vinString ? decodeVIN(vinString) : null;
    const vehicle = {
      id: `v_${Date.now()}`,
      nickname: nickname || 'New Vehicle',
      vinData: vinResult?.valid ? vinResult : null,
      addedAt: new Date().toISOString(),
      lastConnected: null,
      dtcHistory: [],
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
              }}
            >
              <span style={{ fontSize: '18px' }}>{TAB_ICONS[v]}</span>
              <span style={{ fontSize: '10px', fontWeight: 600, letterSpacing: '0.03em' }}>
                {TAB_LABELS[v]}
              </span>
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

// ==================== CONNECT VIEW ====================
function ConnectView({ scanning, devices, connecting, connected, connectionError, selectedProfile, adapterInfo, onScan, onConnect, onDisconnect, onProfileChange }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', paddingTop: '8px' }}>
      {/* Profile selector */}
      <Card>
        <label style={{ fontSize: '12px', color: COLORS.textDim, fontWeight: 600, marginBottom: '8px', display: 'block' }}>
          Adapter Profile
        </label>
        <select
          value={selectedProfile}
          onChange={(e) => onProfileChange(e.target.value)}
          disabled={connected}
          style={{
            width: '100%', padding: '10px 12px', borderRadius: '10px',
            background: '#1e293b', color: COLORS.text, border: `1px solid ${COLORS.bgCardBorder}`,
            fontSize: '14px', outline: 'none',
          }}
        >
          <option value="auto">Auto-detect</option>
          {Object.entries(ADAPTER_PROFILES).map(([key, p]) => (
            <option key={key} value={key}>{p.name}</option>
          ))}
        </select>
      </Card>

      {/* Scan / Disconnect button */}
      {connected ? (
        <ActionButton label="Disconnect" color={COLORS.fault} onClick={onDisconnect} />
      ) : (
        <ActionButton
          label={scanning ? 'Scanning...' : 'Scan for Adapters'}
          color={COLORS.accent}
          onClick={onScan}
          disabled={scanning || connecting}
        />
      )}

      {/* Connection error */}
      {connectionError && (
        <Card style={{ borderColor: `${COLORS.fault}40` }}>
          <p style={{ color: COLORS.fault, fontSize: '13px', margin: 0 }}>{connectionError}</p>
        </Card>
      )}

      {/* Discovered devices */}
      {devices.length > 0 && !connected && (
        <Card>
          <p style={{ fontSize: '12px', color: COLORS.textDim, fontWeight: 600, marginBottom: '10px' }}>
            Discovered Adapters ({devices.length})
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {devices.map((device) => (
              <button
                key={device.deviceId}
                onClick={() => onConnect(device)}
                disabled={connecting}
                style={{
                  padding: '12px',
                  borderRadius: '10px',
                  background: '#1e293b',
                  border: `1px solid ${COLORS.bgCardBorder}`,
                  cursor: connecting ? 'wait' : 'pointer',
                  textAlign: 'left',
                  color: COLORS.text,
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <div>
                  <div style={{ fontSize: '14px', fontWeight: 600 }}>{device.name}</div>
                  <div style={{ fontSize: '11px', color: COLORS.textMuted, marginTop: '2px' }}>
                    {device.deviceId.substring(0, 17)}...
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <SignalBars rssi={device.rssi} />
                  <span style={{ fontSize: '11px', color: COLORS.textMuted }}>{device.rssi} dBm</span>
                </div>
              </button>
            ))}
          </div>
        </Card>
      )}

      {/* Connected adapter info */}
      {connected && adapterInfo && (
        <Card>
          <p style={{ fontSize: '12px', color: COLORS.textDim, fontWeight: 600, marginBottom: '10px' }}>
            Connected Adapter
          </p>
          <InfoRow label="Device" value={adapterInfo.deviceName} />
          <InfoRow label="ELM327" value={adapterInfo.elmVersion} />
          <InfoRow label="Protocol" value={adapterInfo.protocol} />
        </Card>
      )}

      {/* Scanning empty state */}
      {scanning && devices.length === 0 && (
        <div style={{ textAlign: 'center', padding: '40px 0', color: COLORS.textMuted }}>
          <div style={{ fontSize: '32px', marginBottom: '12px', animation: 'pulse 1.5s infinite' }}>📡</div>
          <p style={{ fontSize: '14px' }}>Scanning for BLE adapters...</p>
          <p style={{ fontSize: '11px', marginTop: '4px' }}>Make sure your adapter is powered on</p>
        </div>
      )}

      {/* Initial empty state */}
      {!scanning && devices.length === 0 && !connected && (
        <div style={{ textAlign: 'center', padding: '40px 0', color: COLORS.textMuted }}>
          <div style={{ fontSize: '48px', marginBottom: '12px' }}>🔌</div>
          <p style={{ fontSize: '14px' }}>Plug in your OBD adapter and tap Scan</p>
          <p style={{ fontSize: '11px', marginTop: '6px', maxWidth: '260px', margin: '6px auto 0' }}>
            Supports Vgate iCar Pro, OBDLink CX, Veepeak, and generic ELM327 BLE adapters
          </p>
        </div>
      )}
    </div>
  );
}

// ==================== DASHBOARD VIEW ====================
function DashboardView({ connected, liveData, polling, history, onStartPolling, onStopPolling }) {
  if (!connected) return <NotConnected />;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', paddingTop: '8px' }}>
      {/* Polling control */}
      <ActionButton
        label={polling ? 'Stop Live Data' : 'Start Live Data'}
        color={polling ? COLORS.warn : COLORS.ok}
        onClick={polling ? onStopPolling : onStartPolling}
      />

      {/* Main gauges — 2x2 grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: '12px',
      }}>
        {DASHBOARD_PIDS.map((pid) => {
          const def = PIDS[pid];
          const data = liveData[pid];
          return (
            <Card key={pid} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '12px' }}>
              <Gauge
                value={data?.value ?? null}
                min={def.min}
                max={def.max}
                unit={def.unit}
                label={def.name}
                warn={data?.warn}
                size={130}
              />
            </Card>
          );
        })}
      </div>

      {/* Detail cards with sparklines */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
        {DETAIL_PIDS.map((pid) => {
          const def = PIDS[pid];
          const data = liveData[pid];
          const histData = history.get(pid);
          const color = data?.warn ? COLORS.fault : COLORS.accent;

          return (
            <Card key={pid} style={{ padding: '12px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <div style={{ fontSize: '11px', color: COLORS.textDim, fontWeight: 600, marginBottom: '4px' }}>
                    {def.name}
                  </div>
                  <div style={{ fontSize: '22px', fontWeight: 700, color: data?.warn ? COLORS.fault : COLORS.text }}>
                    {data?.value !== undefined ? data.value.toFixed(1) : '—'}
                  </div>
                  <div style={{ fontSize: '10px', color: COLORS.textMuted }}>{def.unit}</div>
                </div>
                <Sparkline data={histData} width={60} height={28} color={color} />
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

// ==================== DIAGNOSTICS VIEW ====================
function DiagnosticsView({ connected, storedDTCs, pendingDTCs, permanentDTCs, readingDTCs, monitorStatus, onReadDTCs }) {
  if (!connected) return <NotConnected />;

  const totalDTCs = storedDTCs.length + pendingDTCs.length + permanentDTCs.length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', paddingTop: '8px' }}>
      <ActionButton
        label={readingDTCs ? 'Reading...' : 'Read Fault Codes'}
        color={COLORS.accent}
        onClick={onReadDTCs}
        disabled={readingDTCs}
      />

      {/* MIL status */}
      {monitorStatus && (
        <Card style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{
            width: '40px', height: '40px', borderRadius: '50%',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: monitorStatus.milOn ? `${COLORS.fault}30` : `${COLORS.ok}20`,
            fontSize: '20px',
          }}>
            {monitorStatus.milOn ? '🔴' : '✅'}
          </div>
          <div>
            <div style={{ fontSize: '14px', fontWeight: 600, color: monitorStatus.milOn ? COLORS.fault : COLORS.ok }}>
              {monitorStatus.milOn ? 'Check Engine Light ON' : 'No Warning Lights'}
            </div>
            <div style={{ fontSize: '12px', color: COLORS.textDim }}>
              {monitorStatus.dtcCount} fault code{monitorStatus.dtcCount !== 1 ? 's' : ''} reported by ECU
            </div>
          </div>
        </Card>
      )}

      {/* DTC lists */}
      <DTCList title="Stored Faults" dtcs={storedDTCs} emptyText="No stored faults" />
      <DTCList title="Pending Faults" dtcs={pendingDTCs} emptyText="No pending faults" />
      <DTCList title="Permanent Faults" dtcs={permanentDTCs} emptyText="No permanent faults" />

      {/* Monitor readiness grid */}
      {monitorStatus && (
        <Card>
          <p style={{ fontSize: '12px', color: COLORS.textDim, fontWeight: 600, marginBottom: '10px' }}>
            Monitor Readiness
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
            {Object.entries(monitorStatus.monitors).map(([key, mon]) => {
              if (!mon.supported) return null;
              return (
                <div key={key} style={{
                  display: 'flex', alignItems: 'center', gap: '8px',
                  padding: '6px 8px', borderRadius: '8px',
                  background: mon.complete ? `${COLORS.ok}10` : `${COLORS.warn}10`,
                }}>
                  <span style={{
                    width: '8px', height: '8px', borderRadius: '50%',
                    background: mon.complete ? COLORS.ok : COLORS.warn,
                  }} />
                  <span style={{ fontSize: '11px', color: COLORS.text, textTransform: 'capitalize' }}>
                    {key.replace(/([A-Z])/g, ' $1').trim()}
                  </span>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {/* Empty state */}
      {totalDTCs === 0 && !readingDTCs && !monitorStatus && (
        <div style={{ textAlign: 'center', padding: '30px 0', color: COLORS.textMuted }}>
          <div style={{ fontSize: '36px', marginBottom: '8px' }}>🔍</div>
          <p style={{ fontSize: '13px' }}>Tap "Read Fault Codes" to scan for DTCs</p>
        </div>
      )}
    </div>
  );
}

function DTCList({ title, dtcs, emptyText }) {
  if (dtcs.length === 0) return null;

  const severityColor = { info: COLORS.accent, warning: COLORS.warn, critical: COLORS.fault };

  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
        <p style={{ fontSize: '12px', color: COLORS.textDim, fontWeight: 600, margin: 0 }}>{title}</p>
        <Badge label={`${dtcs.length}`} variant={dtcs.some((d) => d.severity === 'critical') ? 'fault' : 'warn'} />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {dtcs.map((dtc, i) => (
          <div key={`${dtc.code}-${i}`} style={{
            padding: '10px',
            borderRadius: '8px',
            background: `${severityColor[dtc.severity] || COLORS.accent}08`,
            borderLeft: `3px solid ${severityColor[dtc.severity] || COLORS.accent}`,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '14px', fontWeight: 700, fontFamily: 'monospace', color: COLORS.text }}>
                {dtc.code}
              </span>
              <Badge label={dtc.severity} variant={dtc.severity === 'critical' ? 'fault' : dtc.severity === 'warning' ? 'warn' : 'info'} />
            </div>
            <p style={{ fontSize: '12px', color: COLORS.textDim, margin: '4px 0 0' }}>{dtc.desc}</p>
          </div>
        ))}
      </div>
    </Card>
  );
}

// ==================== VEHICLE VIEW ====================
function VehicleView({ connected, vinData, batteryVoltage, supportedPIDs, adapterInfo, readingVehicle, onReadVehicle, vehicles, activeVehicle, onSelectVehicle, onShowAddVehicle, onEditVehicle, onDeleteVehicle, onUpdateDtcStatus }) {
  const [editingNickname, setEditingNickname] = useState(false);
  const [nicknameInput, setNicknameInput] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  const severityColor = { info: COLORS.accent, warning: COLORS.warn, critical: COLORS.fault };
  const statusColor = { active: COLORS.fault, explored: COLORS.warn, fixed: COLORS.ok };

  const startEdit = () => {
    setNicknameInput(activeVehicle?.nickname || '');
    setEditingNickname(true);
  };
  const saveEdit = () => {
    if (nicknameInput.trim() && activeVehicle) {
      onEditVehicle(activeVehicle.id, nicknameInput.trim());
    }
    setEditingNickname(false);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', paddingTop: '8px' }}>
      {/* Vehicle switcher strip */}
      <div style={{
        display: 'flex', gap: '8px', overflowX: 'auto', paddingBottom: '4px',
        WebkitOverflowScrolling: 'touch', scrollbarWidth: 'none',
      }}>
        {vehicles.map(v => (
          <button
            key={v.id}
            onClick={() => onSelectVehicle(v.id)}
            style={{
              padding: '6px 14px', borderRadius: '16px', border: 'none',
              background: v.id === activeVehicle?.id ? COLORS.accent : '#1e293b',
              color: v.id === activeVehicle?.id ? '#fff' : COLORS.textDim,
              fontSize: '12px', fontWeight: 600, cursor: 'pointer',
              whiteSpace: 'nowrap', flexShrink: 0,
              transition: 'all 0.2s',
            }}
          >
            {v.nickname}
          </button>
        ))}
        <button
          onClick={onShowAddVehicle}
          style={{
            padding: '6px 14px', borderRadius: '16px',
            border: `1px dashed ${COLORS.accent}60`,
            background: 'transparent', color: COLORS.accent,
            fontSize: '12px', fontWeight: 600, cursor: 'pointer',
            whiteSpace: 'nowrap', flexShrink: 0,
          }}
        >
          + Add
        </button>
      </div>

      {/* Read Vehicle Info — only when connected */}
      {connected && (
        <ActionButton
          label={readingVehicle ? 'Reading...' : 'Read Vehicle Info'}
          color={COLORS.accent}
          onClick={onReadVehicle}
          disabled={readingVehicle}
        />
      )}
      {!connected && vehicles.length === 0 && (
        <div style={{ textAlign: 'center', padding: '30px 0', color: COLORS.textMuted }}>
          <div style={{ fontSize: '40px', marginBottom: '12px' }}>🔌</div>
          <p style={{ fontSize: '15px', fontWeight: 600, color: COLORS.textDim }}>Not Connected</p>
          <p style={{ fontSize: '12px', marginTop: '4px' }}>Connect to read vehicle info, or tap "+ Add" to add a vehicle manually</p>
        </div>
      )}

      {/* Active vehicle nickname + edit/delete */}
      {activeVehicle && (
        <Card>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            {editingNickname ? (
              <div style={{ display: 'flex', gap: '6px', flex: 1 }}>
                <input
                  type="text"
                  value={nicknameInput}
                  onChange={e => setNicknameInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && saveEdit()}
                  autoFocus
                  style={{
                    flex: 1, padding: '6px 10px', borderRadius: '8px',
                    background: '#1e293b', color: COLORS.text,
                    border: `1px solid ${COLORS.accent}`,
                    fontSize: '14px', outline: 'none',
                  }}
                />
                <button onClick={saveEdit} style={{
                  padding: '6px 12px', borderRadius: '8px', border: 'none',
                  background: COLORS.ok, color: '#fff', fontSize: '12px', fontWeight: 600, cursor: 'pointer',
                }}>Save</button>
                <button onClick={() => setEditingNickname(false)} style={{
                  padding: '6px 12px', borderRadius: '8px', border: 'none',
                  background: '#334155', color: COLORS.textDim, fontSize: '12px', fontWeight: 600, cursor: 'pointer',
                }}>Cancel</button>
              </div>
            ) : (
              <>
                <div>
                  <p style={{ fontSize: '16px', fontWeight: 700, color: COLORS.text, margin: 0 }}>
                    {activeVehicle.nickname}
                  </p>
                  <p style={{ fontSize: '11px', color: COLORS.textMuted, margin: '2px 0 0' }}>
                    Added {new Date(activeVehicle.addedAt).toLocaleDateString()}
                  </p>
                </div>
                <div style={{ display: 'flex', gap: '6px' }}>
                  <button onClick={startEdit} style={{
                    padding: '6px 10px', borderRadius: '8px', border: 'none',
                    background: '#1e293b', color: COLORS.textDim, fontSize: '12px', cursor: 'pointer',
                  }}>✏️</button>
                  {confirmDelete ? (
                    <>
                      <button onClick={() => { onDeleteVehicle(activeVehicle.id); setConfirmDelete(false); }} style={{
                        padding: '6px 10px', borderRadius: '8px', border: 'none',
                        background: COLORS.fault, color: '#fff', fontSize: '11px', fontWeight: 600, cursor: 'pointer',
                      }}>Confirm</button>
                      <button onClick={() => setConfirmDelete(false)} style={{
                        padding: '6px 10px', borderRadius: '8px', border: 'none',
                        background: '#334155', color: COLORS.textDim, fontSize: '11px', fontWeight: 600, cursor: 'pointer',
                      }}>Cancel</button>
                    </>
                  ) : (
                    <button onClick={() => setConfirmDelete(true)} style={{
                      padding: '6px 10px', borderRadius: '8px', border: 'none',
                      background: '#1e293b', color: COLORS.textDim, fontSize: '12px', cursor: 'pointer',
                    }}>🗑️</button>
                  )}
                </div>
              </>
            )}
          </div>
        </Card>
      )}

      {/* VIN */}
      {vinData && vinData.valid && (
        <Card>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
            <p style={{ fontSize: '12px', color: COLORS.textDim, fontWeight: 600, margin: 0 }}>Vehicle Identification</p>
            {vinData.isR56 && <Badge label="R56 Hatchback" variant="ok" />}
            {vinData.isR57 && <Badge label="R57 Convertible" variant="ok" />}
            {vinData.isMini && !vinData.isR56 && !vinData.isR57 && vinData.chassis && <Badge label={vinData.chassis} variant="info" />}
            {vinData.isMini && !vinData.chassis && <Badge label="MINI" variant="info" />}
          </div>
          <div style={{
            padding: '10px', borderRadius: '8px', background: '#1e293b',
            fontFamily: 'monospace', fontSize: '15px', fontWeight: 700,
            color: COLORS.accent, textAlign: 'center', letterSpacing: '2px',
            marginBottom: '10px',
          }}>
            {vinData.vin}
          </div>
          <InfoRow label="Manufacturer" value={vinData.manufacturer} />
          {vinData.model && <InfoRow label="Model" value={`MINI ${vinData.model}`} />}
          {vinData.chassis && <InfoRow label="Chassis" value={vinData.chassis} />}
          {vinData.bodyType && <InfoRow label="Body" value={vinData.bodyType} />}
          {vinData.modelYear && <InfoRow label="Model Year" value={vinData.modelYear} />}
          <InfoRow label="Serial" value={vinData.serial} />
        </Card>
      )}

      {vinData && !vinData.valid && (
        <Card style={{ borderColor: `${COLORS.warn}40` }}>
          <p style={{ color: COLORS.warn, fontSize: '13px', margin: 0 }}>
            VIN read failed: {vinData.error}
          </p>
        </Card>
      )}

      {/* Battery voltage */}
      {batteryVoltage && (
        <Card>
          <p style={{ fontSize: '12px', color: COLORS.textDim, fontWeight: 600, marginBottom: '8px' }}>Battery</p>
          <div style={{ fontSize: '28px', fontWeight: 700, color: COLORS.text }}>
            {batteryVoltage}
          </div>
        </Card>
      )}

      {/* DTC History */}
      {activeVehicle && (
        <Card>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
            <p style={{ fontSize: '12px', color: COLORS.textDim, fontWeight: 600, margin: 0 }}>Fault History</p>
            {activeVehicle.dtcHistory?.length > 0 && (
              <Badge label={`${activeVehicle.dtcHistory.length}`} variant="info" />
            )}
          </div>
          {(!activeVehicle.dtcHistory || activeVehicle.dtcHistory.length === 0) ? (
            <p style={{ fontSize: '12px', color: COLORS.textMuted, margin: 0 }}>
              No fault history yet. Read DTCs on the Diagnostics tab to start tracking.
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {[...activeVehicle.dtcHistory]
                .sort((a, b) => (a.status === 'fixed' ? 1 : 0) - (b.status === 'fixed' ? 1 : 0))
                .map(dtc => (
                  <div key={dtc.id} style={{
                    padding: '10px', borderRadius: '8px',
                    background: `${severityColor[dtc.severity] || COLORS.accent}08`,
                    borderLeft: `3px solid ${statusColor[dtc.status] || COLORS.fault}`,
                    opacity: dtc.status === 'fixed' ? 0.5 : 1,
                    transition: 'opacity 0.2s',
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '14px', fontWeight: 700, fontFamily: 'monospace', color: COLORS.text }}>
                        {dtc.code}
                      </span>
                      <div style={{ display: 'flex', gap: '4px' }}>
                        <Badge label={dtc.severity} variant={dtc.severity === 'critical' ? 'fault' : dtc.severity === 'warning' ? 'warn' : 'info'} />
                        <Badge label={dtc.source} variant="info" />
                      </div>
                    </div>
                    <p style={{ fontSize: '12px', color: COLORS.textDim, margin: '4px 0' }}>{dtc.desc}</p>
                    <div style={{ fontSize: '10px', color: COLORS.textMuted, display: 'flex', gap: '12px', marginBottom: '6px' }}>
                      <span>First: {new Date(dtc.firstSeen).toLocaleDateString()}</span>
                      <span>Last: {new Date(dtc.lastSeen).toLocaleDateString()}</span>
                      <span>×{dtc.occurrences}</span>
                    </div>
                    <div style={{ display: 'flex', gap: '4px' }}>
                      {['active', 'explored', 'fixed'].map(s => (
                        <button
                          key={s}
                          onClick={() => onUpdateDtcStatus(activeVehicle.id, dtc.id, s)}
                          style={{
                            flex: 1, padding: '5px 8px', borderRadius: '6px', border: 'none',
                            background: dtc.status === s ? statusColor[s] : '#1e293b',
                            color: dtc.status === s ? '#fff' : COLORS.textMuted,
                            fontSize: '10px', fontWeight: 600, cursor: 'pointer',
                            textTransform: 'capitalize', transition: 'all 0.2s',
                          }}
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
            </div>
          )}
        </Card>
      )}

      {/* Supported PIDs grid */}
      {supportedPIDs.size > 0 && (
        <Card>
          <p style={{ fontSize: '12px', color: COLORS.textDim, fontWeight: 600, marginBottom: '10px' }}>
            Supported PIDs ({supportedPIDs.size})
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
            {[...supportedPIDs].sort().map((pid) => {
              const def = PIDS[pid];
              return (
                <span key={pid} style={{
                  padding: '4px 8px', borderRadius: '6px', fontSize: '11px',
                  fontFamily: 'monospace', fontWeight: 600,
                  background: def ? `${COLORS.ok}20` : `${COLORS.accent}15`,
                  color: def ? COLORS.ok : COLORS.textDim,
                }} title={def?.description || 'Unknown PID'}>
                  {pid}
                </span>
              );
            })}
          </div>
        </Card>
      )}

      {/* Adapter info */}
      {adapterInfo && (
        <Card>
          <p style={{ fontSize: '12px', color: COLORS.textDim, fontWeight: 600, marginBottom: '8px' }}>Adapter</p>
          <InfoRow label="Device" value={adapterInfo.deviceName} />
          <InfoRow label="ELM327" value={adapterInfo.elmVersion} />
          <InfoRow label="Protocol" value={adapterInfo.protocol} />
        </Card>
      )}

      {/* DB stats */}
      <Card>
        <p style={{ fontSize: '12px', color: COLORS.textDim, fontWeight: 600, marginBottom: '8px' }}>Database</p>
        <InfoRow label="Known DTCs" value={getDatabaseSize()} />
        <InfoRow label="R57 Roof Codes" value={getRoofDatabaseSize()} />
        <InfoRow label="Tracked PIDs" value={Object.keys(PIDS).length} />
        <InfoRow label="Safety audit log" value={`${getAuditLog().length} entries`} />
      </Card>

      {/* Empty state — no vehicles at all */}
      {vehicles.length === 0 && !readingVehicle && (
        <div style={{ textAlign: 'center', padding: '30px 0', color: COLORS.textMuted }}>
          <div style={{ fontSize: '36px', marginBottom: '8px' }}>🚗</div>
          <p style={{ fontSize: '13px' }}>Add a vehicle or connect to read your VIN</p>
        </div>
      )}
    </div>
  );
}

// ==================== ROOF VIEW ====================
function RoofView({ vinData }) {
  const [searchCode, setSearchCode] = useState('');
  const [searchResult, setSearchResult] = useState(null);
  const [activeSection, setActiveSection] = useState('lookup'); // lookup | failures | ccid

  const handleSearch = () => {
    const code = searchCode.trim().toUpperCase();
    if (!code) return;

    // Try CVM hex code first
    const roofResult = lookupRoofCode(code);
    if (roofResult) {
      setSearchResult({ type: 'roof', code, ...roofResult });
      return;
    }

    // Try CC-ID
    const ccidResult = lookupCCID(code);
    if (ccidResult) {
      setSearchResult({ type: 'ccid', code, ...ccidResult });
      return;
    }

    setSearchResult({ type: 'unknown', code, desc: 'Code not found in roof database' });
  };

  const isR57 = vinData?.isR57;
  const severityColor = { info: COLORS.accent, warning: COLORS.warn, critical: COLORS.fault };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', paddingTop: '8px' }}>
      {/* R57 detection banner */}
      <Card style={{ borderColor: isR57 ? `${COLORS.ok}40` : `${COLORS.accent}30` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: '24px' }}>{isR57 ? '✅' : 'ℹ️'}</span>
          <div>
            <div style={{ fontSize: '14px', fontWeight: 600, color: isR57 ? COLORS.ok : COLORS.text }}>
              {isR57 ? 'R57 Convertible Detected' : 'Roof Diagnostics Reference'}
            </div>
            <div style={{ fontSize: '11px', color: COLORS.textDim, marginTop: '2px' }}>
              {isR57
                ? 'Your MINI has a convertible roof system with CVM module.'
                : vinData?.valid
                  ? `Your vehicle is a ${vinData.chassis || 'MINI'} — roof codes still available as reference.`
                  : 'Read your VIN on the Vehicle tab to auto-detect R57.'
              }
            </div>
          </div>
        </div>
      </Card>

      {/* Important notice */}
      <Card style={{ borderColor: `${COLORS.warn}30` }}>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
          <span style={{ fontSize: '16px', flexShrink: 0 }}>⚠️</span>
          <div>
            <div style={{ fontSize: '12px', fontWeight: 600, color: COLORS.warn, marginBottom: '4px' }}>
              BMW-Specific Codes
            </div>
            <div style={{ fontSize: '11px', color: COLORS.textDim, lineHeight: 1.4 }}>
              Roof fault codes (A68x–A6Ax) are stored in the CVM module on the body CAN bus,
              not accessible via standard OBD-II. Use this as a lookup reference for codes
              from BimmerLink, Carly, or ISTA.
            </div>
          </div>
        </div>
      </Card>

      {/* Section tabs */}
      <div style={{ display: 'flex', gap: '6px' }}>
        {[
          { key: 'lookup', label: 'Code Lookup' },
          { key: 'failures', label: 'Common Failures' },
          { key: 'ccid', label: 'Dashboard Warnings' },
        ].map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setActiveSection(key)}
            style={{
              flex: 1, padding: '8px 4px', borderRadius: '8px', border: 'none',
              background: activeSection === key ? COLORS.accent : '#1e293b',
              color: activeSection === key ? '#fff' : COLORS.textDim,
              fontSize: '11px', fontWeight: 600, cursor: 'pointer',
              transition: 'all 0.2s',
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Code lookup */}
      {activeSection === 'lookup' && (
        <>
          <Card>
            <label style={{ fontSize: '12px', color: COLORS.textDim, fontWeight: 600, marginBottom: '8px', display: 'block' }}>
              Enter BMW Hex Code or CC-ID
            </label>
            <div style={{ display: 'flex', gap: '8px' }}>
              <input
                type="text"
                value={searchCode}
                onChange={(e) => setSearchCode(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                placeholder="e.g. A692 or 270"
                style={{
                  flex: 1, padding: '10px 12px', borderRadius: '10px',
                  background: '#1e293b', color: COLORS.text,
                  border: `1px solid ${COLORS.bgCardBorder}`,
                  fontSize: '14px', fontFamily: 'monospace', outline: 'none',
                }}
              />
              <button
                onClick={handleSearch}
                style={{
                  padding: '10px 16px', borderRadius: '10px',
                  background: COLORS.accent, color: '#fff', border: 'none',
                  fontSize: '13px', fontWeight: 600, cursor: 'pointer',
                }}
              >
                Look Up
              </button>
            </div>
          </Card>

          {searchResult && (
            <Card style={{ borderColor: `${severityColor[searchResult.severity] || COLORS.accent}40` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <span style={{ fontSize: '18px', fontWeight: 700, fontFamily: 'monospace', color: COLORS.text }}>
                  {searchResult.type === 'ccid' ? `CC-ID ${searchResult.code}` : searchResult.code}
                </span>
                {searchResult.severity && (
                  <Badge
                    label={searchResult.severity}
                    variant={searchResult.severity === 'critical' ? 'fault' : searchResult.severity === 'warning' ? 'warn' : 'info'}
                  />
                )}
              </div>
              <p style={{ fontSize: '13px', color: COLORS.text, margin: '0 0 8px', fontWeight: 500 }}>
                {searchResult.desc}
              </p>
              {searchResult.component && (
                <InfoRow label="Component" value={searchResult.component} />
              )}
              {searchResult.cause && (
                <InfoRow label="Common Cause" value={searchResult.cause} />
              )}
              {searchResult.fix && (
                <div style={{ marginTop: '8px', padding: '8px 10px', borderRadius: '8px', background: `${COLORS.ok}10` }}>
                  <span style={{ fontSize: '11px', color: COLORS.ok, fontWeight: 600 }}>Fix: </span>
                  <span style={{ fontSize: '11px', color: COLORS.textDim }}>{searchResult.fix}</span>
                </div>
              )}
              {searchResult.type === 'unknown' && (
                <p style={{ fontSize: '11px', color: COLORS.textMuted, marginTop: '6px' }}>
                  Try the DTCs tab for standard OBD-II P-codes.
                </p>
              )}
            </Card>
          )}

          {/* All CVM codes reference */}
          <Card>
            <p style={{ fontSize: '12px', color: COLORS.textDim, fontWeight: 600, marginBottom: '10px' }}>
              All CVM Fault Codes ({Object.keys(ROOF_CODES).length})
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {Object.entries(ROOF_CODES).map(([code, info]) => (
                <button
                  key={code}
                  onClick={() => { setSearchCode(code); setSearchResult({ type: 'roof', code, ...info }); }}
                  style={{
                    padding: '8px 10px', borderRadius: '8px', border: 'none',
                    background: `${severityColor[info.severity]}08`,
                    borderLeft: `3px solid ${severityColor[info.severity]}`,
                    cursor: 'pointer', textAlign: 'left',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  }}
                >
                  <div>
                    <span style={{ fontSize: '12px', fontWeight: 700, fontFamily: 'monospace', color: COLORS.text }}>
                      {code}
                    </span>
                    <span style={{ fontSize: '11px', color: COLORS.textDim, marginLeft: '8px' }}>
                      {info.desc}
                    </span>
                  </div>
                  <span style={{
                    width: '6px', height: '6px', borderRadius: '50%',
                    background: severityColor[info.severity], flexShrink: 0,
                  }} />
                </button>
              ))}
            </div>
          </Card>
        </>
      )}

      {/* Common failures */}
      {activeSection === 'failures' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {ROOF_FAILURE_POINTS.map((fp, i) => (
            <Card key={i}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                <span style={{ fontSize: '13px', fontWeight: 700, color: COLORS.text }}>{fp.component}</span>
                <Badge label={fp.frequency} variant={fp.frequency === 'Very common' ? 'fault' : fp.frequency === 'Common' || fp.frequency === 'Common (age-related)' ? 'warn' : 'info'} />
              </div>
              <p style={{ fontSize: '12px', color: COLORS.textDim, margin: '0 0 8px', lineHeight: 1.4 }}>
                {fp.description}
              </p>
              <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                {fp.codes.map((code) => (
                  <span key={code} style={{
                    padding: '2px 8px', borderRadius: '4px', fontSize: '11px',
                    fontFamily: 'monospace', fontWeight: 600,
                    background: `${COLORS.accent}15`, color: COLORS.accent,
                  }}>
                    {code}
                  </span>
                ))}
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* CC-ID dashboard warnings */}
      {activeSection === 'ccid' && (
        <Card>
          <p style={{ fontSize: '12px', color: COLORS.textDim, fontWeight: 600, marginBottom: '10px' }}>
            Dashboard Warning Codes ({Object.keys(ROOF_CCID_CODES).length})
          </p>
          <p style={{ fontSize: '11px', color: COLORS.textMuted, marginBottom: '10px', lineHeight: 1.3 }}>
            CC-ID codes appear as dashboard warning messages. Note the number shown on your dashboard.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {Object.entries(ROOF_CCID_CODES).map(([ccid, info]) => (
              <div
                key={ccid}
                style={{
                  padding: '8px 10px', borderRadius: '8px',
                  background: `${severityColor[info.severity]}08`,
                  borderLeft: `3px solid ${severityColor[info.severity]}`,
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                }}
              >
                <div>
                  <span style={{ fontSize: '13px', fontWeight: 700, fontFamily: 'monospace', color: COLORS.text }}>
                    {ccid}
                  </span>
                  <span style={{ fontSize: '11px', color: COLORS.textDim, marginLeft: '8px' }}>
                    {info.desc}
                  </span>
                </div>
                <span style={{
                  width: '6px', height: '6px', borderRadius: '50%',
                  background: severityColor[info.severity], flexShrink: 0,
                }} />
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Tools recommendation */}
      <Card>
        <p style={{ fontSize: '12px', color: COLORS.textDim, fontWeight: 600, marginBottom: '8px' }}>
          Tools for Reading CVM Codes
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <InfoRow label="BimmerLink" value="App — reads all ECU modules" />
          <InfoRow label="Carly for BMW" value="App — body module support" />
          <InfoRow label="BMW ISTA-D" value="Dealer software + DCAN cable" />
          <InfoRow label="INPA/EDIABAS" value="Free BMW diag + K+DCAN cable" />
        </div>
      </Card>
    </div>
  );
}

// ==================== SHARED COMPONENTS ====================
function NotConnected() {
  return (
    <div style={{ textAlign: 'center', padding: '60px 20px', color: COLORS.textMuted }}>
      <div style={{ fontSize: '40px', marginBottom: '12px' }}>🔌</div>
      <p style={{ fontSize: '15px', fontWeight: 600, color: COLORS.textDim }}>Not Connected</p>
      <p style={{ fontSize: '12px', marginTop: '4px' }}>Go to the Connect tab to pair with your OBD adapter</p>
    </div>
  );
}

function ActionButton({ label, color, onClick, disabled }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        width: '100%',
        padding: '14px',
        borderRadius: '12px',
        background: disabled ? '#334155' : color,
        color: '#fff',
        border: 'none',
        fontSize: '15px',
        fontWeight: 700,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.6 : 1,
        transition: 'all 0.2s',
        letterSpacing: '0.02em',
      }}
    >
      {label}
    </button>
  );
}

function InfoRow({ label, value }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: `1px solid ${COLORS.bgCardBorder}` }}>
      <span style={{ fontSize: '12px', color: COLORS.textMuted }}>{label}</span>
      <span style={{ fontSize: '12px', color: COLORS.text, fontWeight: 500, textAlign: 'right', maxWidth: '60%', wordBreak: 'break-word' }}>
        {value ?? '—'}
      </span>
    </div>
  );
}

function SignalBars({ rssi }) {
  const bars = rssi > -50 ? 4 : rssi > -60 ? 3 : rssi > -70 ? 2 : 1;
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: '1px', height: '14px' }}>
      {[1, 2, 3, 4].map((i) => (
        <div key={i} style={{
          width: '3px',
          height: `${i * 3 + 2}px`,
          borderRadius: '1px',
          background: i <= bars ? COLORS.ok : COLORS.textMuted + '40',
        }} />
      ))}
    </div>
  );
}

// ==================== ADD VEHICLE MODAL ====================
function AddVehicleModal({ onAdd, onClose }) {
  const [nickname, setNickname] = useState('');
  const [vinInput, setVinInput] = useState('');

  const handleSubmit = () => {
    if (!nickname.trim()) return;
    onAdd(nickname.trim(), vinInput.trim() || null);
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 100,
      background: 'rgba(0, 0, 0, 0.7)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '20px',
    }} onClick={onClose}>
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: '360px',
          background: '#1a2235', borderRadius: '16px',
          border: `1px solid ${COLORS.bgCardBorder}`,
          padding: '20px',
        }}
      >
        <h2 style={{ fontSize: '16px', fontWeight: 700, color: COLORS.text, margin: '0 0 16px' }}>
          Add Vehicle
        </h2>

        <label style={{ fontSize: '12px', color: COLORS.textDim, fontWeight: 600, display: 'block', marginBottom: '6px' }}>
          Nickname *
        </label>
        <input
          type="text"
          value={nickname}
          onChange={e => setNickname(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSubmit()}
          placeholder="e.g. Betty, Daily Driver"
          autoFocus
          style={{
            width: '100%', padding: '10px 12px', borderRadius: '10px',
            background: '#0f172a', color: COLORS.text,
            border: `1px solid ${COLORS.bgCardBorder}`,
            fontSize: '14px', outline: 'none', boxSizing: 'border-box',
            marginBottom: '12px',
          }}
        />

        <label style={{ fontSize: '12px', color: COLORS.textDim, fontWeight: 600, display: 'block', marginBottom: '6px' }}>
          VIN (optional)
        </label>
        <input
          type="text"
          value={vinInput}
          onChange={e => setVinInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSubmit()}
          placeholder="17-character VIN"
          maxLength={17}
          style={{
            width: '100%', padding: '10px 12px', borderRadius: '10px',
            background: '#0f172a', color: COLORS.text,
            border: `1px solid ${COLORS.bgCardBorder}`,
            fontSize: '14px', fontFamily: 'monospace', outline: 'none',
            boxSizing: 'border-box', letterSpacing: '1px',
            marginBottom: '16px',
          }}
        />
        <p style={{ fontSize: '11px', color: COLORS.textMuted, margin: '-12px 0 16px', lineHeight: 1.3 }}>
          If provided, the VIN will be decoded to identify your vehicle. You can also read the VIN from the car later.
        </p>

        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            onClick={onClose}
            style={{
              flex: 1, padding: '12px', borderRadius: '10px', border: 'none',
              background: '#334155', color: COLORS.textDim,
              fontSize: '14px', fontWeight: 600, cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!nickname.trim()}
            style={{
              flex: 1, padding: '12px', borderRadius: '10px', border: 'none',
              background: !nickname.trim() ? '#334155' : COLORS.accent,
              color: '#fff', fontSize: '14px', fontWeight: 700,
              cursor: !nickname.trim() ? 'not-allowed' : 'pointer',
              opacity: !nickname.trim() ? 0.6 : 1,
            }}
          >
            Add Vehicle
          </button>
        </div>
      </div>
    </div>
  );
}
