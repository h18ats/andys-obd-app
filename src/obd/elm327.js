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
import { parseCVMResponse } from './roof-codes.js';
import { parseReadDIDResponse } from './cvm-status.js';
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

// --- Diagnostic log (ring buffer, last 30 commands) ---
const diagLog = [];
const DIAG_MAX = 30;

function logDiag(command, rawResponse, cleaned, threw) {
  diagLog.push({ ts: Date.now(), command, raw: rawResponse, cleaned, threw });
  if (diagLog.length > DIAG_MAX) diagLog.shift();
}

/** Get the diagnostic log for debugging connection issues. */
export function getDiagLog() { return [...diagLog]; }

/**
 * Send a command through the queue WITHOUT error checking.
 * Used for init AT commands where any response (even garbage) means the adapter is alive.
 * Still goes through the safety gate.
 * @returns {Promise<string|null>} response or null on timeout
 */
async function sendLenientCommand(command, timeoutMs = 3000) {
  const result = validateCommand(command);
  if (!result.allowed) return null;
  if (!isConnected()) return null;

  const rawResponse = await enqueue(command.trim(), timeoutMs);
  const response = cleanResponse(rawResponse, command);
  logDiag(command, rawResponse, response, false);
  return response;
}

// --- Response cleaning (strips noise before error detection) ---
function cleanResponse(raw, sentCommand) {
  if (!raw) return raw;
  const lines = raw.split('\n');
  // Normalise command for echo comparison: strip spaces so "010C" matches "01 0C"
  const cmdNorm = sentCommand ? sentCommand.trim().toUpperCase().replace(/\s+/g, '') : '';
  const cleaned = lines.filter(line => {
    const trimmed = line.trim().toUpperCase();
    if (!trimmed) return false;                          // blank lines
    if (trimmed.startsWith('SEARCHING')) return false;   // SEARCHING...
    if (trimmed.startsWith('BUS INIT')) return false;    // BUS INIT: ...
    if (/^\xFF+$/.test(line.trim())) return false;       // 0xFF garbage
    // Strip echo of sent command — compare with spaces stripped so
    // "010C" matches echo "01 0C" (adapters may format echo differently)
    if (cmdNorm && trimmed.replace(/\s+/g, '') === cmdNorm) return false;
    return true;
  });
  return cleaned.join('\n').trim();
}

// --- ELM327 error detection ---
const ELM_ERRORS = [
  'NO DATA',
  'UNABLE TO CONNECT',
  'BUS INIT',
  'BUS ERROR',
  'CAN ERROR',
  // Note: standalone 'ERROR' removed — too broad, catches 'CAN ERROR' etc. via includes()
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
  const upper = response.toUpperCase().trim();
  // '?' must be an exact match (not includes) — prevents false positives on
  // version strings or other responses that happen to contain '?'
  return ELM_ERRORS.some((err) =>
    err === '?' ? upper === '?' : upper.includes(err)
  );
}

// --- Retry logic for transient CAN bus errors ---
const RETRYABLE_ERRORS = ['NO DATA', 'CAN ERROR', 'BUS INIT', 'BUS ERROR'];
const NON_RETRYABLE_ERRORS = ['UNABLE TO CONNECT', '?', 'LV RESET'];
const RETRY_DELAYS = [200, 500];

function isRetryable(errorMessage) {
  const upper = (errorMessage || '').toUpperCase();
  if (NON_RETRYABLE_ERRORS.some(e => upper.includes(e))) return false;
  return RETRYABLE_ERRORS.some(e => upper.includes(e));
}

/**
 * Send a command with automatic retry on transient errors.
 * Non-retryable errors throw immediately.
 */
async function sendWithRetry(command, timeoutMs = 5000, maxRetries = 2) {
  let lastErr;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await sendSafeCommand(command, timeoutMs);
    } catch (err) {
      lastErr = err;
      if (attempt < maxRetries && isRetryable(err.message)) {
        await new Promise(r => setTimeout(r, RETRY_DELAYS[attempt] || 500));
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
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

  const rawResponse = await enqueue(command.trim(), timeoutMs);
  const response = cleanResponse(rawResponse, command);

  if (isELMError(response)) {
    logDiag(command, rawResponse, response, true);
    throw new Error(`ELM327 error: ${response || 'no response'}`);
  }

  logDiag(command, rawResponse, response, false);
  return response;
}

// CAN protocols cover >95% of vehicles (2008+). Legacy only if CAN fails.
const CAN_PROTOCOLS = ['6', '7', '8', '9'];
const LEGACY_PROTOCOLS = ['3', '4', '5'];

/**
 * Test whether the current protocol can talk to the ECU.
 * Uses PID 0100 (supported PIDs) — every OBD-II vehicle must respond to this.
 * Retries once to handle transient CAN bus collisions.
 * @returns {Promise<boolean>}
 */
async function probeECU() {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const resp = await sendSafeCommand('0100', 8000);
      if (resp && !isELMError(resp)) return true;
    } catch {}
    if (attempt === 0) await new Promise(r => setTimeout(r, 300));
  }
  return false;
}

/**
 * Initialise the ELM327 adapter.
 * Runs the standard init sequence, then verifies ECU communication.
 * If the selected protocol fails, tries CAN protocols 6-9, then legacy 3-5.
 *
 * @param {string} [protocolCode='0'] - ELM327 protocol code (0-9). '0' = auto-detect.
 * @param {(status: string) => void} [onProgress] - optional status callback for UI
 * @returns {Promise<{ elmVersion: string, protocol: string, protocolCode: string }>}
 */
/**
 * Send an AT config command and verify it was accepted.
 * Returns true if the adapter responded with 'OK' (or version string for ATI).
 * Retries once on failure. Logs all results to diag log.
 */
async function sendVerifiedAT(command, timeoutMs = 3000) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const resp = await sendLenientCommand(command, timeoutMs);
    const upper = (resp || '').toUpperCase().trim();

    // AT commands respond with 'OK', ATI responds with version string,
    // ATDP responds with protocol name — all are non-empty non-error
    if (upper && upper !== '?' && !upper.includes('ERROR')) {
      return resp;
    }

    // Retry after brief pause — adapter may have been busy
    if (attempt === 0) {
      await new Promise(r => setTimeout(r, 300));
    }
  }

  console.warn(`AT command failed after retry: ${command}`);
  return null;
}

export async function initAdapter(protocolCode = '0', onProgress) {
  // Clear diagnostic log for this session
  diagLog.length = 0;

  // Soft reset — ATD (defaults) + ATWS (warm start) instead of ATZ.
  // ATZ reboots the chip which kills BLE notifications on many adapters.
  // ATD resets settings, ATWS restarts the interpreter without a full reboot.
  onProgress?.('Resetting adapter...');
  await sendLenientCommand('ATD', 3000);
  await sendLenientCommand('ATWS', 3000);

  // Wait for warm start to complete — strict adapters (Carista, OBDLink) need
  // up to 2s to reboot the interpreter and become ready for commands.
  // Cheap clones typically restart instantly but tolerate the longer delay.
  await new Promise(r => setTimeout(r, 2000));

  // Configure — verify each command was accepted.
  // Strict adapters will reject commands sent while still initialising.
  onProgress?.('Configuring adapter...');
  await sendVerifiedAT('ATE0', 3000);  // Echo OFF
  await sendVerifiedAT('ATL0', 3000);  // Linefeeds OFF
  await sendVerifiedAT('ATS1', 3000);  // Spaces ON
  await sendVerifiedAT('ATH0', 3000);  // Headers OFF

  // Identify — lenient, don't reject valid version strings
  let version = await sendVerifiedAT('ATI', 5000) || 'Unknown';

  // Set protocol + adaptive timing
  await sendVerifiedAT(`ATSP${protocolCode}`, 3000);
  await sendVerifiedAT('ATAT2', 3000);

  // Probe ECU with selected protocol — use generous timeout for protocol negotiation
  onProgress?.('Testing ECU connection...');
  let activeCode = protocolCode;
  let ecuReachable = await probeECU();

  // If auto-detect or selected protocol failed, try CAN protocols then legacy
  if (!ecuReachable) {
    const fallbacks = [...CAN_PROTOCOLS, ...LEGACY_PROTOCOLS].filter(c => c !== protocolCode);
    for (const code of fallbacks) {
      onProgress?.(`Trying protocol ${code}...`);
      await sendVerifiedAT(`ATSP${code}`, 3000);
      await new Promise(r => setTimeout(r, 500));
      if (await probeECU()) {
        activeCode = code;
        ecuReachable = true;
        break;
      }
    }
  }

  // Describe the active protocol
  let protocol = await sendVerifiedAT('ATDP', 5000) || 'Unknown';

  return {
    elmVersion: version,
    protocol,
    protocolCode: activeCode,
    ecuReachable,
  };
}

/**
 * Query a single PID and decode the result.
 * @param {string} pid - PID code (e.g. '0C' for RPM)
 * @returns {Promise<{ value, unit, warn, name, description, min, max } | null>}
 */
// First few PID queries use a longer timeout to allow for protocol negotiation
// (strict adapters like Carista may need SEARCHING... time on first contact)
let pidQueryCount = 0;

export async function queryPID(pid) {
  const command = `01${pid}`;
  // First 20 queries (roughly 2 poll cycles) get 6s timeout for protocol settling
  const timeout = pidQueryCount < 20 ? 6000 : 3000;
  pidQueryCount++;
  try {
    const response = await sendWithRetry(command, timeout);
    // Log first few responses for diagnostics
    if (pidQueryCount <= 10) {
      console.log(`[PID ${pid}] raw response: "${response}"`);
    }
    const dataBytes = parseResponseBytes(response);
    return decodePID(pid, dataBytes);
  } catch (err) {
    if (pidQueryCount <= 10) {
      console.warn(`[PID ${pid}] failed: ${err.message}`);
    }
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
    const response = await sendWithRetry('03', 5000);
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
    const response = await sendWithRetry('07', 5000);
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
    const response = await sendWithRetry('0A', 5000);
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
    const response = await sendWithRetry('0902', 8000);
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
    const response = await sendWithRetry('ATRV', 3000);
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
    const resp00 = await sendWithRetry('0100', 3000);
    const bytes00 = parseResponseBytes(resp00);
    decodeSupportedBitmask(bytes00, 0x01, supported);

    // If PID 20 is supported, query next range
    if (supported.has('20')) {
      const resp20 = await sendWithRetry('0120', 3000);
      const bytes20 = parseResponseBytes(resp20);
      decodeSupportedBitmask(bytes20, 0x21, supported);
    }

    // If PID 40 is supported, query next range
    if (supported.has('40')) {
      const resp40 = await sendWithRetry('0140', 3000);
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
    const response = await sendWithRetry('0101', 3000);
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
 * Read CVM (Convertible Top Module) DTCs via UDS protocol.
 *
 * Switches ELM327 headers to address the CVM module (tx 0x660 / rx 0x6E0),
 * sends a UDS ReadDTCInformation request (19 02 FF), then restores normal
 * OBD-II mode. All commands go through the safety gate — no bypass.
 *
 * @returns {Promise<{ dtcs: Array, reachable: boolean, raw: string }>}
 */
/**
 * Addressing schemes for reaching the CVM from the OBD port.
 *
 * Scheme 1 (BMW standard): The OBD port connects to D-CAN. The JBE gateway
 * routes requests to K-CAN body modules. Tester address 0x6F1 with the
 * module's physical address as the target. CVM responds on 0x660.
 *
 * Scheme 2 (direct): Send directly to CVM CAN ID 0x660, filter responses
 * from 0x6E0. Works on some adapters/vehicles where the gateway is transparent.
 *
 * Scheme 3 (flow control): Same as scheme 1 but with explicit ISO-TP flow
 * control setup — required by adapters that follow the ELM327 spec strictly
 * (e.g. Carista, OBDLink) for multi-frame UDS responses.
 */
const CVM_ADDRESSING = [
  {
    name: 'BMW gateway (flow control)',
    setup: async () => {
      await sendSafeCommand('ATH1', 3000);
      await sendSafeCommand('ATSH 6F1', 3000);   // Standard BMW diagnostic tester address
      await sendSafeCommand('ATCRA 660', 3000);   // CVM responds on 0x660
      await sendSafeCommand('ATCFC1', 3000);       // Enable flow control
      await sendSafeCommand('ATFCSH 6F1', 3000);   // Flow control header = tester
      await sendSafeCommand('ATFCSD 30 00 00', 3000); // Continue-to-send, no delay
      await sendSafeCommand('ATFCSM 1', 3000);     // Flow control mode 1 (user-defined)
    },
  },
  {
    name: 'BMW gateway (no flow control)',
    setup: async () => {
      await sendSafeCommand('ATH1', 3000);
      await sendSafeCommand('ATSH 6F1', 3000);
      await sendSafeCommand('ATCRA 660', 3000);
    },
  },
  {
    name: 'Direct CVM addressing',
    setup: async () => {
      await sendSafeCommand('ATH1', 3000);
      await sendSafeCommand('ATSH 660', 3000);
      await sendSafeCommand('ATCRA 6E0', 3000);
    },
  },
];

export async function readCVMDTCs(onProgress) {
  const result = { dtcs: [], reachable: false, raw: '', addressingScheme: null };

  try {
    if (onProgress) onProgress(0); // Setting CVM headers

    // Try each addressing scheme until one gets a response
    for (const scheme of CVM_ADDRESSING) {
      try {
        // Restore clean state before each attempt
        try { await sendLenientCommand('ATAR', 3000); } catch {}
        try { await sendLenientCommand('ATCFC0', 3000); } catch {}

        await scheme.setup();

        if (onProgress) onProgress(1); // Scanning roof module

        const rawResponse = await enqueue('19 02 FF', 8000);
        const response = cleanResponse(rawResponse, '19 02 FF');

        if (response && !isELMError(response)) {
          result.reachable = true;
          result.addressingScheme = scheme.name;
          const parsed = parseCVMResponse(response);
          result.dtcs = parsed.dtcs;
          result.raw = parsed.raw;
          console.log(`CVM reached via: ${scheme.name}`);
          break;
        }
      } catch (err) {
        console.warn(`CVM scheme "${scheme.name}" failed:`, err.message);
        // Try next scheme
      }
    }

    if (!result.reachable) {
      console.warn('CVM scan: module not reachable on any addressing scheme');
    }
  } finally {
    // ALWAYS restore normal OBD-II mode
    if (onProgress) onProgress(2); // Restoring OBD mode
    try { await sendSafeCommand('ATCFC0', 3000); } catch {} // Disable flow control
    try { await sendSafeCommand('ATH0', 3000); } catch {}
    try { await sendSafeCommand('ATAR', 3000); } catch {}
    try { await sendSafeCommand('ATD', 3000); } catch {}
    try { await sendSafeCommand('ATSP0', 5000); } catch {}
  }

  return result;
}

// ---------------------------------------------------------------------------
// CVM Live Status — UDS ReadDataByIdentifier (0x22)
// ---------------------------------------------------------------------------

// Track which addressing scheme worked (set by readCVMDTCs, reused by DID reads)
let activeCVMScheme = null;

/** Set the active CVM addressing scheme (called from App.jsx after scan). */
export function setCVMAddressingScheme(schemeName) {
  activeCVMScheme = CVM_ADDRESSING.find(s => s.name === schemeName) || null;
}

/**
 * Helper: set ELM327 headers to address the CVM module.
 * Reuses the same addressing scheme that was proven by readCVMDTCs.
 * Falls back to direct addressing if no scheme has been proven yet.
 */
async function enterCVMMode() {
  if (activeCVMScheme) {
    try { await sendLenientCommand('ATAR', 3000); } catch {}
    try { await sendLenientCommand('ATCFC0', 3000); } catch {}
    await activeCVMScheme.setup();
  } else {
    // Default fallback
    await sendSafeCommand('ATH1', 3000);
    await sendSafeCommand('ATSH 660', 3000);
    await sendSafeCommand('ATCRA 6E0', 3000);
  }
}

/**
 * Helper: restore normal OBD-II mode after CVM communication.
 * Always called in a finally block — individual failures are swallowed.
 */
async function exitCVMMode() {
  try { await sendSafeCommand('ATCFC0', 3000); } catch {}
  try { await sendSafeCommand('ATH0', 3000); } catch {}
  try { await sendSafeCommand('ATAR', 3000); } catch {}
  try { await sendSafeCommand('ATD', 3000); } catch {}
  try { await sendSafeCommand('ATSP0', 5000); } catch {}
}

/**
 * Read a single DID from the CVM module via UDS 0x22.
 * Used during DID probing to discover which DIDs are supported.
 *
 * @param {number} did - 16-bit DID (e.g. 0x2000)
 * @returns {Promise<{ ok: boolean, data?: number[], raw?: string, nrc?: number, nrcDesc?: string, error?: string }>}
 */
export async function readCVMDID(did) {
  const didHi = ((did >> 8) & 0xFF).toString(16).toUpperCase().padStart(2, '0');
  const didLo = (did & 0xFF).toString(16).toUpperCase().padStart(2, '0');

  try {
    await enterCVMMode();

    const cmd = `22 ${didHi} ${didLo}`;
    let rawResponse;
    try {
      rawResponse = await enqueue(cmd, 5000);
    } catch (err) {
      return { ok: false, error: err.message };
    }

    const response = cleanResponse(rawResponse, cmd);
    if (!response || isELMError(response)) {
      return { ok: false, error: response || 'No response' };
    }

    // Parse the response using cvm-status parser
    return parseReadDIDResponse(response, did);
  } finally {
    await exitCVMMode();
  }
}

/**
 * Probe a list of candidate DIDs to discover CVM capabilities.
 * Sets CVM headers once, sends all probes, restores once.
 *
 * @param {Array<{did: number, name: string}>} candidates - DIDs to probe
 * @param {function} [onProgress] - Called with (index, total, result) for each probe
 * @returns {Promise<{ supported: Array<{did: number, name: string, data: number[], raw: string}>, service22: boolean }>}
 */
export async function probeCVMDIDs(candidates, onProgress) {
  const supported = [];
  let service22 = false;

  try {
    await enterCVMMode();

    for (let i = 0; i < candidates.length; i++) {
      const { did, name } = candidates[i];
      const didHi = ((did >> 8) & 0xFF).toString(16).toUpperCase().padStart(2, '0');
      const didLo = (did & 0xFF).toString(16).toUpperCase().padStart(2, '0');

      let result = { ok: false, error: 'No response' };
      const cmd = `22 ${didHi} ${didLo}`;

      try {
        const rawResponse = await enqueue(cmd, 5000);
        const response = cleanResponse(rawResponse, cmd);
        if (response && !isELMError(response)) {
          result = parseReadDIDResponse(response, did);
        }
      } catch (err) {
        result = { ok: false, error: err.message };
      }

      if (result.ok) {
        service22 = true;
        supported.push({ did, name, data: result.data, raw: result.raw });
      }

      if (onProgress) onProgress(i, candidates.length, { did, name, ...result });

      // Small delay between probes to avoid flooding the CVM
      await new Promise(r => setTimeout(r, 100));
    }
  } finally {
    await exitCVMMode();
  }

  return { supported, service22 };
}

/**
 * Read multiple DIDs from the CVM in a single session.
 * Sets CVM headers once, reads all DIDs, restores once.
 * Used for live monitoring polling.
 *
 * @param {number[]} dids - Array of 16-bit DIDs to read
 * @returns {Promise<{ results: Map<number, {ok: boolean, data?: number[], error?: string}>, reachable: boolean }>}
 */
export async function readCVMStatusBatch(dids) {
  const results = new Map();
  let reachable = false;

  try {
    await enterCVMMode();

    for (const did of dids) {
      const didHi = ((did >> 8) & 0xFF).toString(16).toUpperCase().padStart(2, '0');
      const didLo = (did & 0xFF).toString(16).toUpperCase().padStart(2, '0');
      const cmd = `22 ${didHi} ${didLo}`;

      try {
        const rawResponse = await enqueue(cmd, 5000);
        const response = cleanResponse(rawResponse, cmd);
        if (response && !isELMError(response)) {
          reachable = true;
          results.set(did, parseReadDIDResponse(response, did));
        } else {
          results.set(did, { ok: false, error: response || 'No response' });
        }
      } catch (err) {
        results.set(did, { ok: false, error: err.message });
      }
    }
  } finally {
    await exitCVMMode();
  }

  return { results, reachable };
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
  pidQueryCount = 0; // Reset timeout boost for next connection
}
