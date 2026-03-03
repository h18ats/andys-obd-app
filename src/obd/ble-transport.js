/**
 * BLE Transport Layer
 *
 * Handles BLE scanning, connection, and raw byte I/O with ELM327 adapters
 * via @capacitor-community/bluetooth-le.
 *
 * Response buffering: ELM327 sends data in fragments via BLE notifications.
 * We accumulate bytes until we see the '>' prompt character, which signals
 * the adapter is ready for the next command.
 */

import { getScanServiceUUIDs, matchProfile } from './adapter-profiles.js';

let BleClient = null;
let bleLoadError = null;

// Lazy-load BLE — resolves on first use, not at import time
let bleLoadPromise = null;
function loadBLE() {
  if (!bleLoadPromise) {
    bleLoadPromise = import('@capacitor-community/bluetooth-le')
      .then((mod) => { BleClient = mod.BleClient; })
      .catch((err) => { bleLoadError = err; });
  }
  return bleLoadPromise;
}

async function requireBLE() {
  await loadBLE();
  if (!BleClient) throw new Error('BLE not available in this environment. Use a real device.');
}

const PROMPT_CHAR = 0x3E; // '>'
const SCAN_TIMEOUT_MS = 10000;

let connectedDeviceId = null;
let activeProfile = null;
let responseBuffer = [];
let responseResolve = null;
let responseTimeout = null;
let initialised = false;

/**
 * Initialise the BLE client. Must be called once before scanning.
 */
export async function initialiseBLE() {
  if (initialised) return;
  await requireBLE();
  await BleClient.initialize({ androidNeverForLocation: true });
  initialised = true;
}

/**
 * Scan for nearby BLE OBD adapters.
 * @param {(device: { deviceId, name, rssi }) => void} onDeviceFound - callback per discovered device
 * @param {number} [timeoutMs=10000] - scan duration
 * @returns {Promise<void>} resolves when scan completes
 */
export async function scanForAdapters(onDeviceFound, timeoutMs = SCAN_TIMEOUT_MS) {
  await initialiseBLE();

  return new Promise((resolve) => {
    const timer = setTimeout(async () => {
      try { await BleClient.stopLEScan(); } catch (_) {}
      resolve();
    }, timeoutMs);

    BleClient.requestLEScan(
      { services: getScanServiceUUIDs(), allowDuplicates: false },
      (result) => {
        onDeviceFound({
          deviceId: result.device.deviceId,
          name: result.device.name || result.localName || 'Unknown OBD Adapter',
          rssi: result.rssi,
        });
      }
    ).catch(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}

/**
 * Stop an active BLE scan.
 */
export async function stopScan() {
  try { await BleClient.stopLEScan(); } catch (_) {}
}

/**
 * Connect to a BLE OBD adapter.
 * @param {string} deviceId - BLE device ID from scan results
 * @param {string} [deviceName] - device name for profile matching
 * @param {object} [profile] - override adapter profile (otherwise auto-detected from name)
 * @returns {Promise<{ deviceId, profile }>}
 */
export async function connect(deviceId, deviceName, profile) {
  await initialiseBLE();

  if (connectedDeviceId) {
    await disconnect();
  }

  await BleClient.connect(deviceId, () => {
    // Disconnection callback
    connectedDeviceId = null;
    activeProfile = null;
  });

  activeProfile = profile || matchProfile(deviceName);
  connectedDeviceId = deviceId;

  // Start listening for notifications (adapter → app)
  await BleClient.startNotifications(
    deviceId,
    activeProfile.serviceUUID,
    activeProfile.notifyUUID,
    handleNotification
  );

  return { deviceId, profile: activeProfile };
}

/**
 * Disconnect from the current adapter.
 */
export async function disconnect() {
  if (!connectedDeviceId) return;

  try {
    await BleClient.stopNotifications(
      connectedDeviceId,
      activeProfile.serviceUUID,
      activeProfile.notifyUUID
    );
  } catch (_) {}

  try {
    await BleClient.disconnect(connectedDeviceId);
  } catch (_) {}

  connectedDeviceId = null;
  activeProfile = null;
  responseBuffer = [];
  if (responseResolve) {
    responseResolve(null);
    responseResolve = null;
  }
  if (responseTimeout) {
    clearTimeout(responseTimeout);
    responseTimeout = null;
  }
}

/**
 * Send a raw command string to the adapter and wait for the full response.
 * Does NOT validate the command — that's command-safety.js's job.
 *
 * @param {string} command - raw AT/OBD command (e.g. "ATZ", "010C")
 * @param {number} [timeoutMs=5000] - response timeout
 * @returns {Promise<string|null>} the complete response, or null on timeout/error
 */
export async function sendCommand(command, timeoutMs = 5000) {
  if (!connectedDeviceId || !activeProfile) {
    throw new Error('Not connected to any adapter');
  }

  // Clear any stale buffer
  responseBuffer = [];

  // Encode command + carriage return
  const cmdStr = command.trim() + '\r';
  const bytes = new TextEncoder().encode(cmdStr);
  const dataView = new DataView(bytes.buffer);

  // Chunk writes to respect MTU
  const mtu = activeProfile.mtu || 20;
  for (let offset = 0; offset < bytes.length; offset += mtu) {
    const chunkLength = Math.min(mtu, bytes.length - offset);
    const chunk = new DataView(bytes.buffer, offset, chunkLength);

    await BleClient.write(
      connectedDeviceId,
      activeProfile.serviceUUID,
      activeProfile.writeUUID,
      chunk
    );
  }

  // Wait for response (notifications accumulate into responseBuffer)
  return new Promise((resolve) => {
    responseResolve = resolve;
    responseTimeout = setTimeout(() => {
      const partial = drainBuffer();
      responseResolve = null;
      responseTimeout = null;
      resolve(partial || null);
    }, timeoutMs);
  });
}

/**
 * Handle a BLE notification (data fragment from adapter).
 */
function handleNotification(value) {
  const bytes = new Uint8Array(value.buffer);

  for (const byte of bytes) {
    responseBuffer.push(byte);

    // '>' prompt means the adapter has finished sending
    if (byte === PROMPT_CHAR && responseResolve) {
      const response = drainBuffer();
      clearTimeout(responseTimeout);
      const resolve = responseResolve;
      responseResolve = null;
      responseTimeout = null;
      resolve(response);
      return;
    }
  }
}

/**
 * Drain the response buffer into a cleaned string.
 * Strips echo, prompt char, null bytes, and normalises whitespace.
 */
function drainBuffer() {
  const raw = new TextDecoder().decode(new Uint8Array(responseBuffer));
  responseBuffer = [];

  return raw
    .replace(/>/g, '')      // strip prompt
    .replace(/\x00/g, '')   // strip nulls
    .replace(/\r\n/g, '\n') // normalise line endings
    .replace(/\r/g, '\n')
    .trim();
}

/** Check if currently connected. */
export function isConnected() {
  return connectedDeviceId !== null;
}

/** Get the current connection info. */
export function getConnectionInfo() {
  return connectedDeviceId
    ? { deviceId: connectedDeviceId, profile: activeProfile }
    : null;
}
