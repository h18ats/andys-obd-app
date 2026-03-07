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

import { getScanServiceUUIDs, matchProfile, matchProfileByService, expandUUID, ADAPTER_PROFILES } from './adapter-profiles.js';

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
 * First tries filtered scan (by known service UUIDs). If that finds nothing,
 * retries with no UUID filter — needed on Android where many cheap ELM327
 * adapters don't advertise service UUIDs in their advertisement packets.
 *
 * @param {(device: { deviceId, name, rssi }) => void} onDeviceFound - callback per discovered device
 * @param {number} [timeoutMs=10000] - scan duration
 * @returns {Promise<void>} resolves when scan completes
 */
export async function scanForAdapters(onDeviceFound, timeoutMs = SCAN_TIMEOUT_MS) {
  await initialiseBLE();

  let foundCount = 0;
  const wrappedCallback = (result) => {
    foundCount++;
    onDeviceFound({
      deviceId: result.device.deviceId,
      name: result.device.name || result.localName || 'Unknown OBD Adapter',
      rssi: result.rssi,
    });
  };

  // First pass: filtered by known service UUIDs
  await runScan({ services: getScanServiceUUIDs(), allowDuplicates: false }, wrappedCallback, timeoutMs);

  // If filtered scan found nothing, retry unfiltered (catches adapters that
  // don't advertise service UUIDs in their advertisement packet — common on Android)
  if (foundCount === 0) {
    await runScan({ allowDuplicates: false }, wrappedCallback, timeoutMs);
  }
}

async function runScan(scanOptions, onResult, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(async () => {
      try { await BleClient.stopLEScan(); } catch (_) {}
      resolve();
    }, timeoutMs);

    BleClient.requestLEScan(scanOptions, onResult).catch((err) => {
      clearTimeout(timer);
      reject(err);
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
const CONNECT_TIMEOUT_MS = 10000;
const MAX_CONNECT_RETRIES = 2;

export async function connect(deviceId, deviceName, profile) {
  await initialiseBLE();

  if (connectedDeviceId) {
    await disconnect();
  }

  // Clean up any stale GATT state from previous attempts
  try { await BleClient.disconnect(deviceId); } catch {}
  await new Promise(r => setTimeout(r, 300));

  // Connect with timeout + retry — Android BLE is flaky
  let lastError;
  for (let attempt = 1; attempt <= MAX_CONNECT_RETRIES; attempt++) {
    try {
      await withTimeout(
        BleClient.connect(deviceId, () => {
          connectedDeviceId = null;
          activeProfile = null;
        }),
        CONNECT_TIMEOUT_MS,
        `Connection timed out (attempt ${attempt}/${MAX_CONNECT_RETRIES})`
      );
      lastError = null;
      break;
    } catch (err) {
      lastError = err;
      console.warn(`Connect attempt ${attempt} failed:`, err.message);
      try { await BleClient.disconnect(deviceId); } catch {}
      if (attempt < MAX_CONNECT_RETRIES) {
        await new Promise(r => setTimeout(r, 1000));
      }
    }
  }
  if (lastError) throw lastError;

  connectedDeviceId = deviceId;

  // Delay after connect — Android BLE stacks need time before service discovery
  await new Promise(r => setTimeout(r, 800));

  // Discover actual GATT services on the device
  activeProfile = profile || await discoverProfile(deviceId, deviceName);

  // Start listening for notifications (adapter → app)
  await BleClient.startNotifications(
    deviceId,
    activeProfile.serviceUUID,
    activeProfile.notifyUUID,
    handleNotification
  );

  return { deviceId, profile: activeProfile };
}

function withTimeout(promise, ms, message) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (val) => { clearTimeout(timer); resolve(val); },
      (err) => { clearTimeout(timer); reject(err); }
    );
  });
}

/**
 * Discover the correct GATT profile by inspecting the device's actual services.
 * Uses exact UUIDs from the device's GATT table — no expansion or transformation.
 * Android BLE stack requires UUIDs to match exactly what getServices() returns.
 * Falls back to name-based matching if service discovery fails.
 */
async function discoverProfile(deviceId, deviceName) {
  try {
    const services = await BleClient.getServices(deviceId);

    // Standard BLE service UUID prefixes to skip
    const SKIP = ['00001800', '00001801', '0000180a', '0000180f'];

    for (const svc of services) {
      const svcLower = svc.uuid.toLowerCase();
      if (SKIP.some(prefix => svcLower.startsWith(prefix))) continue;

      let writeChar = null;
      let writeType = 'write';
      let notifyChar = null;

      for (const ch of svc.characteristics) {
        const props = ch.properties;
        // Prefer writeWithoutResponse (most cheap ELM327 adapters need it)
        if (!writeChar) {
          if (props.writeWithoutResponse) {
            writeChar = ch.uuid;
            writeType = 'writeWithoutResponse';
          } else if (props.write) {
            writeChar = ch.uuid;
            writeType = 'write';
          }
        }
        if ((props.notify || props.indicate) && !notifyChar) {
          notifyChar = ch.uuid;
        }
      }

      if (writeChar && notifyChar) {
        return {
          name: `Discovered (${deviceName || 'Unknown'})`,
          serviceUUID: svc.uuid,
          writeUUID: writeChar,
          notifyUUID: notifyChar,
          writeType,
          mtu: 20,
        };
      }
    }
  } catch (err) {
    console.warn('Service discovery failed, falling back to name match:', err);
  }

  // Last resort: guess from device name
  return matchProfile(deviceName);
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

  // Chunk writes to respect MTU
  const mtu = activeProfile.mtu || 20;
  const useWriteWithoutResponse = activeProfile.writeType === 'writeWithoutResponse';

  for (let offset = 0; offset < bytes.length; offset += mtu) {
    const chunkLength = Math.min(mtu, bytes.length - offset);
    const chunk = new DataView(bytes.buffer, offset, chunkLength);

    if (useWriteWithoutResponse) {
      await BleClient.writeWithoutResponse(
        connectedDeviceId,
        activeProfile.serviceUUID,
        activeProfile.writeUUID,
        chunk
      );
    } else {
      await BleClient.write(
        connectedDeviceId,
        activeProfile.serviceUUID,
        activeProfile.writeUUID,
        chunk
      );
    }
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
  if (!value || !value.buffer) return;
  // Use byteOffset + byteLength to handle DataViews that are slices of a larger buffer
  const bytes = new Uint8Array(value.buffer, value.byteOffset || 0, value.byteLength || value.buffer.byteLength);

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
