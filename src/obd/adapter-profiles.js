/**
 * BLE GATT profiles for common ELM327-compatible OBD adapters.
 *
 * Each adapter exposes a GATT service with a write characteristic (app → adapter)
 * and a notify characteristic (adapter → app). UUIDs vary by manufacturer.
 */

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
  for (const profile of Object.values(ADAPTER_PROFILES)) {
    if (profile.serviceUUID.toLowerCase() === uuid) return profile;
  }
  return ADAPTER_PROFILES.generic;
}
