/**
 * OBD-II PID Registry
 *
 * Each PID defines how to decode the raw hex response from the ECU.
 * All PIDs are Mode 01 (current data) unless noted.
 */

export const PIDS = {
  '0C': {
    name: 'RPM',
    description: 'Engine RPM',
    unit: 'rpm',
    bytes: 2,
    min: 0,
    max: 8000,
    warnAbove: 6500,
    formula: (A, B) => ((A * 256) + B) / 4,
  },
  '0D': {
    name: 'Speed',
    description: 'Vehicle Speed',
    unit: 'km/h',
    bytes: 1,
    min: 0,
    max: 220,
    warnAbove: null,
    formula: (A) => A,
  },
  '05': {
    name: 'Coolant',
    description: 'Engine Coolant Temperature',
    unit: '°C',
    bytes: 1,
    min: -40,
    max: 150,
    warnAbove: 110,
    formula: (A) => A - 40,
  },
  '0B': {
    name: 'Boost',
    description: 'Intake Manifold Pressure',
    unit: 'kPa',
    bytes: 1,
    min: 0,
    max: 255,
    warnAbove: 200,
    formula: (A) => A,
  },
  '04': {
    name: 'Load',
    description: 'Calculated Engine Load',
    unit: '%',
    bytes: 1,
    min: 0,
    max: 100,
    warnAbove: null,
    formula: (A) => (A / 255) * 100,
  },
  '11': {
    name: 'Throttle',
    description: 'Throttle Position',
    unit: '%',
    bytes: 1,
    min: 0,
    max: 100,
    warnAbove: null,
    formula: (A) => (A / 255) * 100,
  },
  '0F': {
    name: 'IAT',
    description: 'Intake Air Temperature',
    unit: '°C',
    bytes: 1,
    min: -40,
    max: 215,
    warnAbove: 60,
    formula: (A) => A - 40,
  },
  '06': {
    name: 'STFT B1',
    description: 'Short Term Fuel Trim — Bank 1',
    unit: '%',
    bytes: 1,
    min: -100,
    max: 99.2,
    warnAbove: 25,
    formula: (A) => ((A / 128) - 1) * 100,
  },
  '07': {
    name: 'LTFT B1',
    description: 'Long Term Fuel Trim — Bank 1',
    unit: '%',
    bytes: 1,
    min: -100,
    max: 99.2,
    warnAbove: 25,
    formula: (A) => ((A / 128) - 1) * 100,
  },
  '10': {
    name: 'MAF',
    description: 'MAF Air Flow Rate',
    unit: 'g/s',
    bytes: 2,
    min: 0,
    max: 655.35,
    warnAbove: null,
    formula: (A, B) => ((A * 256) + B) / 100,
  },
};

/** PIDs polled on the dashboard (fast loop). */
export const DASHBOARD_PIDS = ['0C', '0D', '05', '0B'];

/** PIDs shown in detail cards. */
export const DETAIL_PIDS = ['04', '11', '0F', '06', '07', '10'];

/** All PIDs we request (combined). */
export const ALL_PIDS = [...DASHBOARD_PIDS, ...DETAIL_PIDS];

/**
 * Decode a raw hex response for a given PID.
 * @param {string} pid - The PID code (e.g. '0C')
 * @param {number[]} dataBytes - Parsed data bytes (after mode+pid echo)
 * @returns {{ value: number, unit: string, warn: boolean } | null}
 */
export function decodePID(pid, dataBytes) {
  const def = PIDS[pid];
  if (!def) return null;
  if (dataBytes.length < def.bytes) return null;

  const value = def.formula(...dataBytes.slice(0, def.bytes));
  const warn = def.warnAbove !== null && value > def.warnAbove;

  return {
    value: Math.round(value * 100) / 100,
    unit: def.unit,
    warn,
    name: def.name,
    description: def.description,
    min: def.min,
    max: def.max,
  };
}

/**
 * Parse a hex response string into data bytes.
 * Strips the mode+pid echo (first 2 bytes in the response).
 * E.g. "41 0C 1A F8" → [0x1A, 0xF8]
 */
export function parseResponseBytes(response) {
  const parts = response.trim().split(/\s+/);
  // Skip first two parts (echo of mode + pid)
  return parts.slice(2).map((hex) => parseInt(hex, 16)).filter((n) => !isNaN(n));
}
