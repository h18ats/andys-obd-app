/**
 * Command Safety Gate
 *
 * Dual-gate (whitelist + blocklist) safety layer. Every command sent to the
 * ELM327 adapter MUST pass through validateCommand(). No bypass exists.
 *
 * INVARIANT: This app NEVER sends write commands to the vehicle ECU.
 */

// --- Whitelist: only these OBD mode prefixes are allowed ---
const ALLOWED_MODES = new Set([
  '01', // Show current data (live PIDs)
  '02', // Show freeze frame data
  '03', // Show stored DTCs
  '06', // Test results (on-board monitoring)
  '07', // Show pending DTCs
  '09', // Request vehicle information (VIN, calibration IDs)
  '0A', // Show permanent DTCs
  '10', // UDS DiagnosticSessionControl (blocklist catches non-default sessions)
  '19', // UDS ReadDTCInformation (read-only diagnostic query)
  '22', // UDS ReadDataByIdentifier (read-only — live sensor/switch status)
]);

// --- Whitelist: only these AT command prefixes are allowed ---
const ALLOWED_AT_PREFIXES = [
  'ATZ',   // Reset
  'ATI',   // Identify
  'ATE',   // Echo on/off
  'ATL',   // Linefeeds on/off
  'ATS',   // Spaces on/off
  'ATH',   // Headers on/off
  'ATSP',  // Set protocol
  'ATRV',  // Read battery voltage
  'ATDP',  // Describe protocol
  'ATST',  // Set timeout
  'ATCAF', // CAN auto formatting
  'ATD',   // Set defaults
  'ATWS',  // Warm start
  'AT@1',  // Device description
  'ATSH',  // Set CAN header (tx address) — read-only, routes commands
  'ATCRA', // Set CAN receive address filter — read-only, filters responses
  'ATAR',  // Auto-set receive address — restores normal rx filtering
  'ATAT',  // Adaptive timing control — configures ECU response wait times
  'ATTP',  // Try protocol without persisting — non-destructive protocol test
];

// --- Blocklist: these are ALWAYS rejected, even if they somehow pass the whitelist ---
const BLOCKED_PATTERNS = [
  /^04/,       // Mode 04 — Clear/reset DTCs and MIL
  /^08/,       // Mode 08 — Request control of on-board system/test/component
  /^2E/i,      // UDS WriteDataByIdentifier
  /^27/i,      // UDS SecurityAccess
  /^31/i,      // UDS RoutineControl
  /^14/i,      // UDS ClearDiagnosticInformation
  /^2F/i,      // UDS InputOutputControlByIdentifier
  /^3E/i,      // UDS TesterPresent (session keepalive — unnecessary for read-only)
  /^10\s*0[^1]/i, // UDS DiagnosticSessionControl to non-default sessions
  /^ATPP/i,    // Programmable parameters (writes to ELM327 EEPROM)
  /^AT@3/i,    // Store device identifier (writes to ELM327 EEPROM)
  /^ATMA/i,    // Monitor all — floods CAN bus, can cause instability
  /^STDI/i,    // STN extended commands (write-capable on some clones)
];

// Audit log — kept in memory, capped at 100 entries
const auditLog = [];
const AUDIT_MAX = 100;

function logBlocked(raw, reason) {
  const entry = { ts: Date.now(), command: raw, reason };
  auditLog.push(entry);
  if (auditLog.length > AUDIT_MAX) auditLog.shift();
  console.warn(`[SAFETY] BLOCKED: "${raw}" — ${reason}`);
}

/**
 * Validate a command before it reaches the ELM327/ECU.
 * Returns { allowed: true } or { allowed: false, reason: string }.
 */
export function validateCommand(raw) {
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    logBlocked(raw, 'empty or non-string');
    return { allowed: false, reason: 'empty or non-string command' };
  }

  const cmd = raw.trim().toUpperCase().replace(/\s+/g, '');

  // Gate 1: Blocklist — reject known dangerous patterns first
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(cmd)) {
      logBlocked(raw, `blocklist match: ${pattern}`);
      return { allowed: false, reason: `blocked by safety rule: ${pattern}` };
    }
  }

  // Gate 2: AT commands — must start with a whitelisted prefix
  if (cmd.startsWith('AT')) {
    const isAllowed = ALLOWED_AT_PREFIXES.some((prefix) =>
      cmd.startsWith(prefix.replace(/\s+/g, ''))
    );
    if (!isAllowed) {
      logBlocked(raw, 'AT command not in whitelist');
      return { allowed: false, reason: `AT command not whitelisted: ${cmd}` };
    }
    return { allowed: true };
  }

  // Gate 3: OBD mode — first two hex chars must be in the allowed set
  const mode = cmd.substring(0, 2);
  if (!ALLOWED_MODES.has(mode)) {
    logBlocked(raw, `mode ${mode} not whitelisted`);
    return { allowed: false, reason: `OBD mode not whitelisted: ${mode}` };
  }

  return { allowed: true };
}

/** Get a copy of the blocked-command audit log. */
export function getAuditLog() {
  return [...auditLog];
}

/** Clear the audit log (for testing). */
export function clearAuditLog() {
  auditLog.length = 0;
}
