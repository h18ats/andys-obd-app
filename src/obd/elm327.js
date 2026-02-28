/**
 * ELM327 Protocol Layer
 *
 * Serial command queue with safety gate enforcement. Every command passes
 * through validateCommand() before reaching the BLE transport.
 *
 * Provides high-level methods: init, query PID, read DTCs, read VIN, etc.
 */

import { validateCommand } from './command-safety.js';
import { sendCommand, isConnected, disconnect } from './ble-transport.js';
import { decodePID, parseResponseBytes, PIDS } from './obd-pids.js';
import { parseDTCResponse } from './dtc-database.js';
import { parseVINResponse, decodeVIN } from './vin-decoder.js';

// --- Command queue (serial, one-at-a-time) ---
let queue = [];
let processing = false;

function enqueue(command, timeoutMs) {
  return new Promise((resolve, reject) => {
    queue.push({ command, timeoutMs, resolve, reject });
    processQueue();
  });
}

async function processQueue() {
  if (processing || queue.length === 0) return;
  processing = true;

  while (queue.length > 0) {
    const { command, timeoutMs, resolve, reject } = queue.shift();
    try {
      const response = await sendCommand(command, timeoutMs);
      resolve(response);
    } catch (err) {
      reject(err);
    }
  }

  processing = false;
}

// --- ELM327 error detection ---
const ELM_ERRORS = [
  'NO DATA',
  'UNABLE TO CONNECT',
  'BUS INIT',
  'BUS ERROR',
  'CAN ERROR',
  'ERROR',
  'BUFFER FULL',
  'DATA ERROR',
  '?',
  'STOPPED',
  'FB ERROR',
  'ACT ALERT',
  'LV RESET',
  'LP ALERT',
];

function isELMError(response) {
  if (!response) return true;
  const upper = response.toUpperCase();
  return ELM_ERRORS.some((err) => upper.includes(err));
}

/**
 * Send a command through the safety gate + command queue.
 * This is the ONLY way to send commands. No bypass exists.
 *
 * @param {string} command - AT or OBD command
 * @param {number} [timeoutMs=5000] - response timeout
 * @returns {Promise<string>} response string
 * @throws if command is blocked or adapter returns error
 */
export async function sendSafeCommand(command, timeoutMs = 5000) {
  // SAFETY GATE — every command validated
  const result = validateCommand(command);
  if (!result.allowed) {
    throw new Error(`Command blocked: ${result.reason}`);
  }

  if (!isConnected()) {
    throw new Error('Not connected to adapter');
  }

  const response = await enqueue(command.trim(), timeoutMs);

  if (isELMError(response)) {
    throw new Error(`ELM327 error: ${response || 'no response'}`);
  }

  return response;
}

/**
 * Initialise the ELM327 adapter.
 * Runs the standard init sequence to configure for OBD-II CAN protocol.
 *
 * @returns {Promise<{ elmVersion: string, protocol: string }>}
 */
export async function initAdapter() {
  // Reset
  const resetResp = await sendSafeCommand('ATZ', 3000);

  // Identify
  const version = await sendSafeCommand('ATI');

  // Configure for clean OBD-II communication
  await sendSafeCommand('ATE0');   // Echo off
  await sendSafeCommand('ATL0');   // Linefeeds off
  await sendSafeCommand('ATS0');   // Spaces off (we'll parse raw hex)
  await sendSafeCommand('ATH0');   // Headers off
  await sendSafeCommand('ATSP6');  // Protocol 6 = ISO 15765-4 CAN (11-bit, 500 kbaud) — R56 default

  // Re-enable spaces for easier parsing
  await sendSafeCommand('ATS1');

  // Describe the detected protocol
  const protocol = await sendSafeCommand('ATDP');

  return {
    elmVersion: version || 'Unknown',
    protocol: protocol || 'Unknown',
  };
}

/**
 * Query a single PID and decode the result.
 * @param {string} pid - PID code (e.g. '0C' for RPM)
 * @returns {Promise<{ value, unit, warn, name, description, min, max } | null>}
 */
export async function queryPID(pid) {
  const command = `01${pid}`;
  try {
    const response = await sendSafeCommand(command, 3000);
    const dataBytes = parseResponseBytes(response);
    return decodePID(pid, dataBytes);
  } catch (err) {
    console.warn(`PID query failed for ${pid}:`, err.message);
    return null;
  }
}

/**
 * Query multiple PIDs in sequence.
 * @param {string[]} pids - array of PID codes
 * @returns {Promise<Record<string, { value, unit, warn, name } | null>>}
 */
export async function queryPIDs(pids) {
  const results = {};
  for (const pid of pids) {
    results[pid] = await queryPID(pid);
  }
  return results;
}

/**
 * Read stored DTCs (Mode 03).
 * @returns {Promise<Array<{ code, desc, severity }>>}
 */
export async function readStoredDTCs() {
  try {
    const response = await sendSafeCommand('03', 5000);
    return parseDTCResponse(response);
  } catch (err) {
    console.warn('Failed to read stored DTCs:', err.message);
    return [];
  }
}

/**
 * Read pending DTCs (Mode 07).
 * @returns {Promise<Array<{ code, desc, severity }>>}
 */
export async function readPendingDTCs() {
  try {
    const response = await sendSafeCommand('07', 5000);
    return parseDTCResponse(response);
  } catch (err) {
    console.warn('Failed to read pending DTCs:', err.message);
    return [];
  }
}

/**
 * Read permanent DTCs (Mode 0A).
 * @returns {Promise<Array<{ code, desc, severity }>>}
 */
export async function readPermanentDTCs() {
  try {
    const response = await sendSafeCommand('0A', 5000);
    return parseDTCResponse(response);
  } catch (err) {
    console.warn('Failed to read permanent DTCs:', err.message);
    return [];
  }
}

/**
 * Read VIN (Mode 09 PID 02).
 * @returns {Promise<object>} decoded VIN object
 */
export async function readVIN() {
  try {
    const response = await sendSafeCommand('0902', 8000);
    const lines = response.split('\n').filter((l) => l.trim());
    const vinStr = parseVINResponse(lines);
    if (!vinStr) return { valid: false, error: 'could not parse VIN response' };
    return decodeVIN(vinStr);
  } catch (err) {
    console.warn('Failed to read VIN:', err.message);
    return { valid: false, error: err.message };
  }
}

/**
 * Read battery voltage (AT command, not an OBD PID).
 * @returns {Promise<string|null>} e.g. "12.4V"
 */
export async function readBatteryVoltage() {
  try {
    const response = await sendSafeCommand('ATRV', 3000);
    return response;
  } catch (err) {
    console.warn('Failed to read battery voltage:', err.message);
    return null;
  }
}

/**
 * Query supported PIDs (Mode 01 PID 00).
 * Returns a set of supported PID codes.
 * @returns {Promise<Set<string>>}
 */
export async function querySupportedPIDs() {
  const supported = new Set();

  try {
    // PID 00 returns a 4-byte bitmask of PIDs 01-20
    const resp00 = await sendSafeCommand('0100', 3000);
    const bytes00 = parseResponseBytes(resp00);
    decodeSupportedBitmask(bytes00, 0x01, supported);

    // If PID 20 is supported, query next range
    if (supported.has('20')) {
      const resp20 = await sendSafeCommand('0120', 3000);
      const bytes20 = parseResponseBytes(resp20);
      decodeSupportedBitmask(bytes20, 0x21, supported);
    }

    // If PID 40 is supported, query next range
    if (supported.has('40')) {
      const resp40 = await sendSafeCommand('0140', 3000);
      const bytes40 = parseResponseBytes(resp40);
      decodeSupportedBitmask(bytes40, 0x41, supported);
    }
  } catch (err) {
    console.warn('Failed to query supported PIDs:', err.message);
  }

  return supported;
}

/**
 * Decode a 4-byte bitmask into individual PID codes.
 */
function decodeSupportedBitmask(bytes, startPID, supported) {
  if (bytes.length < 4) return;

  for (let byteIdx = 0; byteIdx < 4; byteIdx++) {
    for (let bit = 7; bit >= 0; bit--) {
      if (bytes[byteIdx] & (1 << bit)) {
        const pid = startPID + (byteIdx * 8) + (7 - bit);
        supported.add(pid.toString(16).toUpperCase().padStart(2, '0'));
      }
    }
  }
}

/**
 * Read monitor readiness status (Mode 01 PID 01).
 * Returns which emission monitors are complete/incomplete.
 * @returns {Promise<object|null>}
 */
export async function readMonitorStatus() {
  try {
    const response = await sendSafeCommand('0101', 3000);
    const bytes = parseResponseBytes(response);
    if (bytes.length < 4) return null;

    const milOn = (bytes[0] & 0x80) !== 0;
    const dtcCount = bytes[0] & 0x7F;

    // Byte B bits indicate which monitors are supported
    // Byte C bits indicate which are complete (0=complete, 1=incomplete)
    const monitors = {
      misfire: { supported: !!(bytes[1] & 0x01), complete: !(bytes[1] & 0x10) },
      fuelSystem: { supported: !!(bytes[1] & 0x02), complete: !(bytes[1] & 0x20) },
      components: { supported: !!(bytes[1] & 0x04), complete: !(bytes[1] & 0x40) },
      catalyst: { supported: !!(bytes[2] & 0x01), complete: !(bytes[3] & 0x01) },
      heatedCatalyst: { supported: !!(bytes[2] & 0x02), complete: !(bytes[3] & 0x02) },
      evapSystem: { supported: !!(bytes[2] & 0x04), complete: !(bytes[3] & 0x04) },
      secondaryAir: { supported: !!(bytes[2] & 0x08), complete: !(bytes[3] & 0x08) },
      oxygenSensor: { supported: !!(bytes[2] & 0x20), complete: !(bytes[3] & 0x20) },
      oxygenSensorHeater: { supported: !!(bytes[2] & 0x40), complete: !(bytes[3] & 0x40) },
      egr: { supported: !!(bytes[2] & 0x80), complete: !(bytes[3] & 0x80) },
    };

    return { milOn, dtcCount, monitors };
  } catch (err) {
    console.warn('Failed to read monitor status:', err.message);
    return null;
  }
}

/**
 * Drain the command queue (e.g. on disconnect).
 */
export function clearQueue() {
  for (const item of queue) {
    item.reject(new Error('Queue cleared'));
  }
  queue = [];
  processing = false;
}
