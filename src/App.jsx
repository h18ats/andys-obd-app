import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Gauge, Card, Badge, Sparkline, Pulse, ErrorBoundary, COLORS } from './components/shared.jsx';
import { scanForAdapters, stopScan, connect, disconnect, isConnected, getConnectionInfo } from './obd/ble-transport.js';
import { initAdapter, queryPIDs, readStoredDTCs, readPendingDTCs, readPermanentDTCs, readVIN, readBatteryVoltage, querySupportedPIDs, readMonitorStatus, sendSafeCommand, clearQueue } from './obd/elm327.js';
import { DASHBOARD_PIDS, DETAIL_PIDS, ALL_PIDS, PIDS } from './obd/obd-pids.js';
import { ADAPTER_PROFILES } from './obd/adapter-profiles.js';
import { getDatabaseSize } from './obd/dtc-database.js';
import { getAuditLog } from './obd/command-safety.js';

// --- Views ---
const VIEWS = {
  CONNECT: 'connect',
  DASHBOARD: 'dashboard',
  DIAGNOSTICS: 'diagnostics',
  VEHICLE: 'vehicle',
};

const TAB_ICONS = {
  [VIEWS.CONNECT]: '⚡',
  [VIEWS.DASHBOARD]: '◎',
  [VIEWS.DIAGNOSTICS]: '⚠',
  [VIEWS.VEHICLE]: '🚗',
};

const TAB_LABELS = {
  [VIEWS.CONNECT]: 'Connect',
  [VIEWS.DASHBOARD]: 'Live',
  [VIEWS.DIAGNOSTICS]: 'DTCs',
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

  // Vehicle
  const [vinData, setVinData] = useState(loadState('vin', null));
  const [batteryVoltage, setBatteryVoltage] = useState(null);
  const [supportedPIDs, setSupportedPIDs] = useState(new Set());
  const [readingVehicle, setReadingVehicle] = useState(false);

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
    } catch (err) {
      console.warn('DTC read error:', err.message);
    }
    setReadingDTCs(false);
  }, []);

  // --- Read vehicle info ---
  const handleReadVehicle = useCallback(async () => {
    setReadingVehicle(true);
    try {
      const [vin, voltage, pids] = await Promise.all([
        readVIN(),
        readBatteryVoltage(),
        querySupportedPIDs(),
      ]);
      setVinData(vin);
      setBatteryVoltage(voltage);
      setSupportedPIDs(pids);
      if (vin?.valid) saveState('vin', vin);
    } catch (err) {
      console.warn('Vehicle read error:', err.message);
    }
    setReadingVehicle(false);
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
          <div>
            <h1 style={{ fontSize: '18px', fontWeight: 700, color: COLORS.text, margin: 0 }}>
              OBD Diagnostics
            </h1>
            <span style={{ fontSize: '11px', color: COLORS.textMuted }}>MINI R56</span>
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
          {view === VIEWS.VEHICLE && (
            <VehicleView
              connected={connected}
              vinData={vinData}
              batteryVoltage={batteryVoltage}
              supportedPIDs={supportedPIDs}
              adapterInfo={adapterInfo}
              readingVehicle={readingVehicle}
              onReadVehicle={handleReadVehicle}
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
function VehicleView({ connected, vinData, batteryVoltage, supportedPIDs, adapterInfo, readingVehicle, onReadVehicle }) {
  if (!connected) return <NotConnected />;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', paddingTop: '8px' }}>
      <ActionButton
        label={readingVehicle ? 'Reading...' : 'Read Vehicle Info'}
        color={COLORS.accent}
        onClick={onReadVehicle}
        disabled={readingVehicle}
      />

      {/* VIN */}
      {vinData && vinData.valid && (
        <Card>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
            <p style={{ fontSize: '12px', color: COLORS.textDim, fontWeight: 600, margin: 0 }}>Vehicle Identification</p>
            {vinData.isR56 && <Badge label="R56 Confirmed" variant="ok" />}
            {vinData.isMini && !vinData.isR56 && <Badge label="MINI" variant="info" />}
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
        <InfoRow label="Tracked PIDs" value={Object.keys(PIDS).length} />
        <InfoRow label="Safety audit log" value={`${getAuditLog().length} entries`} />
      </Card>

      {/* Empty state */}
      {!vinData && !readingVehicle && (
        <div style={{ textAlign: 'center', padding: '30px 0', color: COLORS.textMuted }}>
          <div style={{ fontSize: '36px', marginBottom: '8px' }}>🚗</div>
          <p style={{ fontSize: '13px' }}>Tap "Read Vehicle Info" to identify your car</p>
        </div>
      )}
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
