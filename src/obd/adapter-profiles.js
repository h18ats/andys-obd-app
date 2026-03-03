/**
 * BLE GATT profiles for common ELM327-compatible OBD adapters.
 *
 * Each adapter exposes a GATT service with a write characteristic (app → adapter)
 * and a notify characteristic (adapter → app). UUIDs vary by manufacturer.
 */

/** ELM327 protocol codes (AT SP command). */
export const OBD_PROTOCOLS = [
  { code: '0', label: 'Auto-detect', desc: 'Tries all protocols' },
  { code: '1', label: 'SAE J1850 PWM', desc: '41.6 kbaud' },
  { code: '2', label: 'SAE J1850 VPW', desc: '10.4 kbaud' },
  { code: '3', label: 'ISO 9141-2', desc: '5 baud init' },
  { code: '4', label: 'ISO 14230-4 KWP', desc: '5 baud init' },
  { code: '5', label: 'ISO 14230-4 KWP', desc: 'Fast init' },
  { code: '6', label: 'ISO 15765-4 CAN', desc: '11-bit 500k' },
  { code: '7', label: 'ISO 15765-4 CAN', desc: '29-bit 500k' },
  { code: '8', label: 'ISO 15765-4 CAN', desc: '11-bit 250k' },
  { code: '9', label: 'ISO 15765-4 CAN', desc: '29-bit 250k' },
];

export const ADAPTER_PROFILES = {
  vgate: {
    name: 'Vgate iCar Pro',
    serviceUUID: 'e7810a71-73ae-499d-8c15-faa9aef0c3f2',
    writeUUID: 'bef8d6c9-9c21-4c9e-b632-bd58c1009f9f',
    notifyUUID: 'bef8d6c9-9c21-4c9e-b632-bd58c1009f9f', // same characteristic
    mtu: 20,
  },
  obdlink: {
    name: 'OBDLink CX',
    serviceUUID: 'fff0',
    writeUUID: 'fff1',
    notifyUUID: 'fff2',
    mtu: 512,
  },
  veepeak: {
    name: 'Veepeak OBDCheck',
    serviceUUID: '0000fff0-0000-1000-8000-00805f9b34fb',
    writeUUID: '0000fff1-0000-1000-8000-00805f9b34fb',
    notifyUUID: '0000fff2-0000-1000-8000-00805f9b34fb',
    mtu: 20,
  },
  generic: {
    name: 'Generic ELM327 BLE',
    serviceUUID: '0000fff0-0000-1000-8000-00805f9b34fb',
    writeUUID: '0000fff1-0000-1000-8000-00805f9b34fb',
    notifyUUID: '0000fff2-0000-1000-8000-00805f9b34fb',
    mtu: 20,
  },
};

/** All service UUIDs to scan for during BLE discovery. */
export const SCAN_SERVICE_UUIDS = [
  ...new Set(Object.values(ADAPTER_PROFILES).map((p) => p.serviceUUID)),
];

/**
 * Match a discovered BLE device to an adapter profile by name heuristics.
 * Falls back to 'generic' if no match.
 */
export function matchProfile(deviceName) {
  const name = (deviceName || '').toLowerCase();
  if (name.includes('vgate') || name.includes('icar')) return ADAPTER_PROFILES.vgate;
  if (name.includes('obdlink') || name.includes('obd link')) return ADAPTER_PROFILES.obdlink;
  if (name.includes('veepeak')) return ADAPTER_PROFILES.veepeak;
  return ADAPTER_PROFILES.generic;
}

/**
 * Match by advertised service UUID.
 */
export function matchProfileByService(serviceUUID) {
  const uuid = serviceUUID.toLowerCase();
  for (const profile of Object.values(getAllProfiles())) {
    if (profile.serviceUUID.toLowerCase() === uuid) return profile;
  }
  return ADAPTER_PROFILES.generic;
}

// --- Custom adapter profiles (localStorage CRUD) ---

const CUSTOM_PROFILES_KEY = 'obd_custom_profiles';

export function loadCustomProfiles() {
  try {
    const raw = localStorage.getItem(CUSTOM_PROFILES_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

export function saveCustomProfile(profile) {
  const profiles = loadCustomProfiles();
  const idx = profiles.findIndex(p => p.id === profile.id);
  if (idx >= 0) {
    profiles[idx] = profile;
  } else {
    profiles.push(profile);
  }
  localStorage.setItem(CUSTOM_PROFILES_KEY, JSON.stringify(profiles));
  return profiles;
}

export function deleteCustomProfile(id) {
  const profiles = loadCustomProfiles().filter(p => p.id !== id);
  localStorage.setItem(CUSTOM_PROFILES_KEY, JSON.stringify(profiles));
  return profiles;
}

/** Merge built-in + custom profiles into one object keyed by profile key/id. */
export function getAllProfiles() {
  const all = { ...ADAPTER_PROFILES };
  for (const cp of loadCustomProfiles()) {
    all[cp.id] = cp;
  }
  return all;
}

/** Dynamic scan UUIDs — includes custom profile service UUIDs. */
export function getScanServiceUUIDs() {
  const uuids = new Set(Object.values(ADAPTER_PROFILES).map(p => p.serviceUUID));
  for (const cp of loadCustomProfiles()) {
    uuids.add(cp.serviceUUID);
  }
  return [...uuids];
}
