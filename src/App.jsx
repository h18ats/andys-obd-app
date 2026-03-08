import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Pulse, ErrorBoundary, COLORS, Badge } from './components/shared.jsx';
import { scanForAdapters, connect, disconnect, isConnected } from './obd/ble-transport.js';
import { initAdapter, queryPIDs, readStoredDTCs, readPendingDTCs, readPermanentDTCs, readVIN, readBatteryVoltage, querySupportedPIDs, readMonitorStatus, readCVMDTCs, clearQueue } from './obd/elm327.js';
import { ALL_PIDS, PIDS } from './obd/obd-pids.js';
import { ADAPTER_PROFILES, getAllProfiles, loadCustomProfiles, saveCustomProfile, deleteCustomProfile } from './obd/adapter-profiles.js';
import { decodeVIN } from './obd/vin-decoder.js';
import { getAllCatalogPIDs } from './obd/pid-catalog.js';
import ConnectView from './views/ConnectView.jsx';
import DashboardView from './views/DashboardView.jsx';
import CustomDashboardView from './views/CustomDashboardView.jsx';
import DiagnosticsView from './views/DiagnosticsView.jsx';
import RoofView from './views/RoofView.jsx';
import VehicleView from './views/VehicleView.jsx';
import AddVehicleModal from './views/AddVehicleModal.jsx';
import WidgetConfigModal from './components/WidgetConfigModal.jsx';
import CustomProfileModal from './components/CustomProfileModal.jsx';

// --- Views ---
const VIEWS = {
  CONNECT: 'connect',
  DASHBOARD: 'dashboard',
  CUSTOM: 'custom',
  DIAGNOSTICS: 'diagnostics',
  ROOF: 'roof',
  VEHICLE: 'vehicle',
};

const TAB_ICONS = {
  [VIEWS.CONNECT]: '⚡',
  [VIEWS.DASHBOARD]: '◎',
  [VIEWS.CUSTOM]: '▣',
  [VIEWS.DIAGNOSTICS]: '⚠',
  [VIEWS.ROOF]: '▽',
  [VIEWS.VEHICLE]: '🚗',
};

const TAB_LABELS = {
  [VIEWS.CONNECT]: 'Connect',
  [VIEWS.DASHBOARD]: 'Live',
  [VIEWS.CUSTOM]: 'Custom',
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
  try { localStorage.setItem(`obd_${key}`, JSON.stringify(value)); } catch (e) {
    console.warn(`Failed to save obd_${key}:`, e);
  }
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
  const [selectedProtocol, setSelectedProtocol] = useState(() => loadState('protocol', '0'));
  const [customProfiles, setCustomProfiles] = useState(() => loadCustomProfiles());
  const [showCustomProfile, setShowCustomProfile] = useState(false);

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
  const [dtcScanSteps, setDtcScanSteps] = useState([]);

  // CVM roof scan
  const [cvmDTCs, setCvmDTCs] = useState(() => loadState('cvmDTCs', []));
  const [readingCVM, setReadingCVM] = useState(false);
  const [cvmScanAttempted, setCvmScanAttempted] = useState(() => loadState('cvmScanAttempted', false));
  const [cvmReachable, setCvmReachable] = useState(() => loadState('cvmReachable', true));
  const [cvmScanSteps, setCvmScanSteps] = useState([]);

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
  const [addVehicleVin, setAddVehicleVin] = useState(null);
  const [batteryVoltage, setBatteryVoltage] = useState(null);
  const [supportedPIDs, setSupportedPIDs] = useState(new Set());
  const [readingVehicle, setReadingVehicle] = useState(false);
  const [vehicleReadError, setVehicleReadError] = useState(null);
  const [vehicleReadSteps, setVehicleReadSteps] = useState([]);

  // Custom dashboard widgets
  const [customWidgets, setCustomWidgets] = useState(() => {
    const stored = loadState('custom_widgets', null);
    return stored?.version === 1 ? stored : { widgets: [], version: 1 };
  });
  const [showWidgetConfig, setShowWidgetConfig] = useState(false);

  // Derived: active PID set = original 10 + custom widget PIDs
  const activePids = useMemo(() => {
    const pids = new Set(ALL_PIDS);
    for (const w of customWidgets.widgets) pids.add(w.pid);
    return [...pids];
  }, [customWidgets.widgets]);

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
  const [connectStatus, setConnectStatus] = useState(null);
  const handleConnect = useCallback(async (device) => {
    setConnecting(true);
    setConnectionError(null);
    setConnectStatus('Connecting...');
    try {
      const profile = selectedProfile === 'auto' ? undefined : getAllProfiles()[selectedProfile];
      await connect(device.deviceId, device.name, profile, setConnectStatus);

      setConnectStatus('Initialising adapter...');
      const info = await initAdapter(selectedProtocol);
      setAdapterInfo({ ...info, deviceName: device.name });
      setConnected(true);
      setView(VIEWS.DASHBOARD);
    } catch (err) {
      setConnectionError(err.message);
      try { await disconnect(); } catch {}
    }
    setConnecting(false);
    setConnectStatus(null);
  }, [selectedProfile, selectedProtocol]);

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

    let consecutiveFailures = 0;
    while (pollingRef.current && isConnected()) {
      try {
        const results = await queryPIDs(activePidsRef.current);
        setLiveData(results);
        consecutiveFailures = 0;
        for (const [pid, data] of Object.entries(results)) {
          if (data?.value !== undefined) history.push(pid, data.value);
        }
      } catch (err) {
        consecutiveFailures++;
        console.warn(`Poll error (${consecutiveFailures}/3):`, err.message);
        // Heartbeat: if 3+ consecutive failures, adapter is likely gone
        if (consecutiveFailures >= 3) {
          console.warn('Adapter unresponsive — forcing disconnect');
          try { await disconnect(); } catch {}
          break;
        }
      }
      // ~500ms between polls
      await new Promise((r) => setTimeout(r, 500));
    }

    // Detect BLE disconnect that terminated the loop
    if (!isConnected()) {
      setConnected(false);
      setAdapterInfo(null);
      setConnectionError('Adapter disconnected');
    }

    setPolling(false);
  }, [activePids]);

  const stopPolling = useCallback(() => {
    pollingRef.current = false;
    setPolling(false);
  }, []);

  // --- Read DTCs ---
  const handleReadDTCs = useCallback(async () => {
    setReadingDTCs(true);
    const steps = [
      { label: 'Reading stored DTCs...', status: 'active' },
      { label: 'Reading pending DTCs...', status: 'pending' },
      { label: 'Reading permanent DTCs...', status: 'pending' },
      { label: 'Checking monitor readiness...', status: 'pending' },
    ];
    setDtcScanSteps([...steps]);

    try {
      // Step 1: Stored DTCs
      let stored, pending, permanent, monitor;
      try {
        stored = await readStoredDTCs();
        steps[0] = { label: `Stored DTCs${stored.length > 0 ? ` (${stored.length} found)` : ' — clear'}`, status: 'done' };
      } catch { stored = []; steps[0] = { label: 'Stored DTCs — failed', status: 'failed' }; }
      steps[1] = { ...steps[1], status: 'active' };
      setDtcScanSteps([...steps]);

      // Step 2: Pending DTCs
      try {
        pending = await readPendingDTCs();
        steps[1] = { label: `Pending DTCs${pending.length > 0 ? ` (${pending.length} found)` : ' — clear'}`, status: 'done' };
      } catch { pending = []; steps[1] = { label: 'Pending DTCs — failed', status: 'failed' }; }
      steps[2] = { ...steps[2], status: 'active' };
      setDtcScanSteps([...steps]);

      // Step 3: Permanent DTCs
      try {
        permanent = await readPermanentDTCs();
        steps[2] = { label: `Permanent DTCs${permanent.length > 0 ? ` (${permanent.length} found)` : ' — clear'}`, status: 'done' };
      } catch { permanent = []; steps[2] = { label: 'Permanent DTCs — failed', status: 'failed' }; }
      steps[3] = { ...steps[3], status: 'active' };
      setDtcScanSteps([...steps]);

      // Step 4: Monitor readiness
      try {
        monitor = await readMonitorStatus();
        steps[3] = { label: 'Monitor readiness — done', status: 'done' };
      } catch { monitor = null; steps[3] = { label: 'Monitor readiness — failed', status: 'failed' }; }
      setDtcScanSteps([...steps]);

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

  // --- Scan CVM roof module ---
  const handleScanCVM = useCallback(async () => {
    setReadingCVM(true);
    const steps = [
      { label: 'Setting CVM headers...', status: 'active' },
      { label: 'Scanning roof module...', status: 'pending' },
      { label: 'Restoring OBD mode...', status: 'pending' },
    ];
    setCvmScanSteps([...steps]);

    const onProgress = (stage) => {
      for (let i = 0; i < steps.length; i++) {
        if (i < stage) steps[i] = { ...steps[i], status: 'done' };
        else if (i === stage) steps[i] = { ...steps[i], status: 'active' };
        else steps[i] = { ...steps[i], status: 'pending' };
      }
      setCvmScanSteps([...steps]);
    };

    try {
      const result = await readCVMDTCs(onProgress);
      steps.forEach((_, i) => { steps[i] = { ...steps[i], status: 'done' }; });
      setCvmScanSteps([...steps]);
      setCvmDTCs(result.dtcs);
      setCvmScanAttempted(true);
      setCvmReachable(result.reachable);
      saveState('cvmDTCs', result.dtcs);
      saveState('cvmScanAttempted', true);
      saveState('cvmReachable', result.reachable);
    } catch (err) {
      console.warn('CVM scan error:', err.message);
      const activeIdx = steps.findIndex(s => s.status === 'active');
      if (activeIdx >= 0) steps[activeIdx] = { ...steps[activeIdx], status: 'failed' };
      setCvmScanSteps([...steps]);
      setCvmScanAttempted(true);
      setCvmReachable(false);
      saveState('cvmScanAttempted', true);
      saveState('cvmReachable', false);
    }
    setReadingCVM(false);
  }, []);

  // --- Read vehicle info ---
  const handleReadVehicle = useCallback(async () => {
    setReadingVehicle(true);
    setVehicleReadError(null);
    const steps = [
      { label: 'Reading VIN...', status: 'active' },
      { label: 'Checking battery...', status: 'pending' },
      { label: 'Querying supported PIDs...', status: 'pending' },
    ];
    setVehicleReadSteps([...steps]);

    try {
      // Step 1: VIN
      let vin;
      try {
        vin = await readVIN();
        steps[0] = { label: vin?.valid ? `VIN — ${vin.vin}` : `VIN — ${vin?.error || 'no response'}`, status: vin?.valid ? 'done' : 'failed' };
      } catch (err) { vin = { valid: false, error: err.message }; steps[0] = { label: `VIN — ${err.message}`, status: 'failed' }; }
      steps[1] = { ...steps[1], status: 'active' };
      setVehicleReadSteps([...steps]);

      // Step 2: Battery voltage
      let voltage;
      try {
        voltage = await readBatteryVoltage();
        steps[1] = { label: voltage ? `Battery — ${voltage}` : 'Battery — no response', status: voltage ? 'done' : 'failed' };
      } catch { voltage = null; steps[1] = { label: 'Battery — failed', status: 'failed' }; }
      steps[2] = { ...steps[2], status: 'active' };
      setVehicleReadSteps([...steps]);

      // Step 3: Supported PIDs
      let pids;
      try {
        pids = await querySupportedPIDs();
        steps[2] = { label: pids.size > 0 ? `Supported PIDs — ${pids.size} found` : 'Supported PIDs — no response', status: pids.size > 0 ? 'done' : 'failed' };
      } catch { pids = new Set(); steps[2] = { label: 'Supported PIDs — failed', status: 'failed' }; }
      setVehicleReadSteps([...steps]);

      setBatteryVoltage(voltage);
      setSupportedPIDs(pids);

      // Build error from step failures
      const failedSteps = steps.filter(s => s.status === 'failed');
      if (failedSteps.length === 3) {
        setVehicleReadError('Adapter connected but vehicle not responding. Try turning ignition to ON (engine off) and scan again.');
      } else if (failedSteps.length > 0) {
        setVehicleReadError(failedSteps.map(s => s.label).join(' · '));
      }

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
      setVehicleReadError(`Read failed: ${err.message}`);
    }
    setReadingVehicle(false);
  }, []);

  // --- Read VIN then open Add Vehicle modal ---
  const handleReadAndAddVehicle = useCallback(async () => {
    setReadingVehicle(true);
    try {
      const vinRaw = await readVIN();
      if (vinRaw?.valid) {
        setAddVehicleVin(vinRaw);
        setShowAddVehicle(true);
      } else {
        setConnectionError(vinRaw?.error || 'Could not read VIN from adapter');
      }
    } catch (err) {
      setConnectionError(err.message || 'VIN read failed');
    }
    setReadingVehicle(false);
  }, []);

  // --- Vehicle management handlers ---
  const handleSelectVehicle = useCallback((id) => {
    setActiveVehicleId(id);
    saveState('active_vehicle', id);
  }, []);

  const handleAddVehicle = useCallback((nickname, vinString, vrn, dvlaData) => {
    const vinResult = addVehicleVin || (vinString ? decodeVIN(vinString) : null);
    const vehicle = {
      id: `v_${Date.now()}`,
      nickname: nickname || 'New Vehicle',
      vinData: vinResult?.valid ? vinResult : null,
      vrn: vrn || null,
      dvlaData: dvlaData || null,
      addedAt: new Date().toISOString(),
      lastConnected: addVehicleVin ? new Date().toISOString() : null,
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
    setAddVehicleVin(null);
  }, [addVehicleVin]);

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

  // --- Custom widget handlers ---
  const handleAddWidget = useCallback(({ pid, display, size }) => {
    setCustomWidgets(prev => {
      const next = {
        ...prev,
        widgets: [
          ...prev.widgets,
          {
            id: `w_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            pid,
            display,
            size,
            order: prev.widgets.length,
          },
        ],
      };
      saveState('custom_widgets', next);
      return next;
    });
    setShowWidgetConfig(false);
  }, []);

  const handleRemoveWidget = useCallback((widgetId) => {
    setCustomWidgets(prev => {
      const filtered = prev.widgets.filter(w => w.id !== widgetId);
      const reordered = filtered.map((w, i) => ({ ...w, order: i }));
      const next = { ...prev, widgets: reordered };
      saveState('custom_widgets', next);
      return next;
    });
  }, []);

  // --- Protocol + custom profile handlers ---
  const handleProtocolChange = useCallback((code) => {
    setSelectedProtocol(code);
    saveState('protocol', code);
  }, []);

  const handleSaveCustomProfile = useCallback((profile) => {
    const updated = saveCustomProfile(profile);
    setCustomProfiles(updated);
    setShowCustomProfile(false);
  }, []);

  const handleDeleteCustomProfile = useCallback((id) => {
    const updated = deleteCustomProfile(id);
    setCustomProfiles(updated);
    if (selectedProfile === id) setSelectedProfile('auto');
  }, [selectedProfile]);

  // --- Demo mode ---
  const demoRef = useRef(null);
  const activePidsRef = useRef(activePids);
  activePidsRef.current = activePids;

  const generateDemoData = useCallback((base, pidsToGenerate) => {
    const jitter = (v, range) => Math.max(0, v + (Math.random() - 0.5) * range);

    // Hardcoded base values for the original 10 PIDs
    const DEFAULTS = {
      '0C': 2200, '0D': 45, '05': 88, '0B': 101, '04': 32,
      '11': 18, '0F': 28, '06': 2.3, '07': -1.5, '10': 8.4,
    };

    const result = {};
    const pids = pidsToGenerate || ALL_PIDS;
    for (const pid of pids) {
      const def = PIDS[pid];
      if (!def) continue;
      const defaultVal = DEFAULTS[pid] ?? ((def.min + def.max) / 2);
      const baseVal = base?.[pid]?.value ?? defaultVal;
      const range = Math.max(1, (def.max - def.min) * 0.05);
      const value = jitter(baseVal, range);
      const warn = def.warnAbove !== null && value > def.warnAbove;
      result[pid] = { value, unit: def.unit, warn, name: def.name };
    }
    return result;
  }, []);

  const handleDemoMode = useCallback(() => {
    // Set connected state
    setConnected(true);
    setAdapterInfo({ deviceName: 'Demo Adapter', elmVersion: 'ELM327 v2.1 (Demo)', protocol: 'ISO 15765-4 CAN' });
    setView(VIEWS.DASHBOARD);

    // Create a demo vehicle
    const demoVehicle = {
      id: 'v_demo',
      nickname: 'Betty',
      vinData: {
        valid: true, vin: 'WMWSS3C56CT123456',
        make: 'MINI', model: 'Cooper S', body: 'Convertible',
        chassis: 'R57', year: 2012, isR57: true,
      },
      vrn: 'AB12CDE',
      dvlaData: {
        registrationNumber: 'AB12CDE', make: 'MINI', colour: 'WHITE',
        yearOfManufacture: 2012, engineCapacity: 1598, fuelType: 'PETROL',
        motStatus: 'Valid', motExpiryDate: '2026-08-15',
        taxStatus: 'Taxed', taxDueDate: '2026-11-01', co2Emissions: 136,
      },
      addedAt: new Date().toISOString(),
      lastConnected: new Date().toISOString(),
      dtcHistory: [],
      serviceLog: [],
    };
    setVehicles([demoVehicle]);
    setActiveVehicleId('v_demo');
    setBatteryVoltage(12.6);
    setSupportedPIDs(new Set(getAllCatalogPIDs()));

    // Mock DTCs
    setStoredDTCs([
      { code: 'P0171', desc: 'System Too Lean (Bank 1)', severity: 'warning' },
      { code: 'P0420', desc: 'Catalyst System Efficiency Below Threshold', severity: 'info' },
    ]);
    setPendingDTCs([
      { code: 'P0301', desc: 'Cylinder 1 Misfire Detected', severity: 'critical' },
    ]);
    setPermanentDTCs([]);
    setMonitorStatus({
      milOn: true, dtcCount: 3,
      monitors: {
        catalyst: { supported: true, complete: true },
        heatedCatalyst: { supported: false, complete: false },
        evaporativeSystem: { supported: true, complete: false },
        secondaryAirSystem: { supported: false, complete: false },
        acRefrigerant: { supported: false, complete: false },
        oxygenSensor: { supported: true, complete: true },
        oxygenSensorHeater: { supported: true, complete: true },
        egrSystem: { supported: true, complete: false },
        misfire: { supported: true, complete: true },
        fuelSystem: { supported: true, complete: true },
        components: { supported: true, complete: true },
      },
    });

    // Start fake polling
    const initialData = generateDemoData(null, activePids);
    setLiveData(initialData);
    for (const [pid, data] of Object.entries(initialData)) {
      if (data?.value !== undefined) history.push(pid, data.value);
    }
    setPolling(true);

    demoRef.current = setInterval(() => {
      setLiveData(prev => {
        const next = generateDemoData(prev, activePidsRef.current);
        for (const [pid, data] of Object.entries(next)) {
          if (data?.value !== undefined) history.push(pid, data.value);
        }
        return next;
      });
    }, 600);
  }, [generateDemoData, history, activePids]);

  const handleExitDemo = useCallback(() => {
    if (demoRef.current) {
      clearInterval(demoRef.current);
      demoRef.current = null;
    }
    setPolling(false);
    setConnected(false);
    setAdapterInfo(null);
    setLiveData({});
    history.clear();
    setStoredDTCs([]);
    setPendingDTCs([]);
    setPermanentDTCs([]);
    setMonitorStatus(null);
    setCvmDTCs([]);
    setCvmScanAttempted(false);
    setCvmReachable(true);
    setVehicleReadError(null);
    setDtcScanSteps([]);
    setVehicleReadSteps([]);
    setCvmScanSteps([]);
    setVehicles([]);
    setActiveVehicleId(null);
    setBatteryVoltage(null);
    setSupportedPIDs(new Set());
    setView(VIEWS.CONNECT);
  }, [history]);

  // Cleanup demo interval on unmount
  useEffect(() => {
    return () => { if (demoRef.current) clearInterval(demoRef.current); };
  }, []);

  const isDemo = demoRef.current !== null;

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
            {isDemo && <Badge label="DEMO" variant="warn" />}
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
              connectStatus={connectStatus}
              selectedProfile={selectedProfile}
              selectedProtocol={selectedProtocol}
              customProfiles={customProfiles}
              adapterInfo={adapterInfo}
              onScan={handleScan}
              onConnect={handleConnect}
              onDisconnect={isDemo ? handleExitDemo : handleDisconnect}
              onProfileChange={setSelectedProfile}
              onProtocolChange={handleProtocolChange}
              onShowCustomProfile={() => setShowCustomProfile(true)}
              onDeleteCustomProfile={handleDeleteCustomProfile}
              onDemoMode={handleDemoMode}
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
          {view === VIEWS.CUSTOM && (
            <CustomDashboardView
              connected={connected}
              liveData={liveData}
              polling={polling}
              history={history}
              widgets={customWidgets.widgets}
              onAddWidget={handleAddWidget}
              onRemoveWidget={handleRemoveWidget}
              onShowConfig={() => setShowWidgetConfig(true)}
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
              dtcScanSteps={dtcScanSteps}
              onReadDTCs={handleReadDTCs}
            />
          )}
          {view === VIEWS.ROOF && (
            <RoofView
              vinData={vinData}
              connected={connected}
              cvmDTCs={cvmDTCs}
              readingCVM={readingCVM}
              cvmScanAttempted={cvmScanAttempted}
              cvmReachable={cvmReachable}
              cvmScanSteps={cvmScanSteps}
              onScanCVM={handleScanCVM}
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
              vehicleReadError={vehicleReadError}
              vehicleReadSteps={vehicleReadSteps}
              onReadVehicle={handleReadVehicle}
              vehicles={vehicles}
              activeVehicle={activeVehicle}
              onSelectVehicle={handleSelectVehicle}
              onShowAddVehicle={() => setShowAddVehicle(true)}
              onAddCurrentVehicle={handleReadAndAddVehicle}
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
            onClose={() => { setShowAddVehicle(false); setAddVehicleVin(null); }}
            prefillVin={addVehicleVin}
          />
        )}

        {/* Widget Config Modal */}
        {showWidgetConfig && (
          <WidgetConfigModal
            onAdd={handleAddWidget}
            onClose={() => setShowWidgetConfig(false)}
            existingPIDs={customWidgets.widgets.map(w => w.pid)}
            supportedPIDs={supportedPIDs}
          />
        )}

        {/* Custom Adapter Profile Modal */}
        {showCustomProfile && (
          <CustomProfileModal
            onSave={handleSaveCustomProfile}
            onClose={() => setShowCustomProfile(false)}
          />
        )}
      </div>
    </ErrorBoundary>
  );
}

