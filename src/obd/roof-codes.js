/**
 * BMW MINI R57 Convertible Roof Diagnostic Reference
 *
 * IMPORTANT: These codes are BMW-specific hex codes stored in the CVM
 * (Convertible Top Module) on the K-CAN body bus. They are NOT accessible
 * via standard OBD-II (Mode 03/07) through an ELM327 adapter.
 *
 * This module serves as a reference database for looking up codes that
 * come from BMW-specific tools (BimmerLink, ISTA, Carly, INPA).
 *
 * To read these codes from the vehicle, you need:
 *  - BimmerLink app (~$30) with a compatible OBD adapter, OR
 *  - Carly for BMW app (~$50/yr), OR
 *  - BMW ISTA-D with a DCAN cable, OR
 *  - INPA/EDIABAS with a K+DCAN cable
 */

export const ROOF_SEVERITY = {
  INFO: 'info',         // Monitor — may self-resolve
  WARNING: 'warning',   // Service soon — roof may still operate
  CRITICAL: 'critical', // Roof inoperable or unsafe
};

/**
 * CVM (Convertible Top Module) fault codes.
 * Format: BMW hex code → description + severity + common cause + fix hint.
 */
export const ROOF_CODES = {
  // --- Hall sensors & microswitches ---
  A689: {
    desc: 'Hall sensor — roof pack erected position',
    severity: ROOF_SEVERITY.CRITICAL,
    cause: 'Hall sensor on hydraulic ram failed or wiring damaged',
    fix: 'Check hall sensor connector at roof ram. Replace sensor if open-circuit.',
    component: 'Hall Sensor',
  },
  A68A: {
    desc: 'Hall sensor — roof pack stowed position',
    severity: ROOF_SEVERITY.CRITICAL,
    cause: 'Hall sensor not detecting roof in stowed position',
    fix: 'Inspect sensor at rear of roof compartment. Check for water ingress.',
    component: 'Hall Sensor',
  },
  A68D: {
    desc: 'Soft top locking system sensor fault',
    severity: ROOF_SEVERITY.CRITICAL,
    cause: 'Front header latch microswitch failure or misalignment',
    fix: 'Check front latch microswitches. Adjust latch alignment or replace switch.',
    component: 'Latch Sensor',
  },
  A68E: {
    desc: 'Roof operation stalls / roof system fault',
    severity: ROOF_SEVERITY.CRITICAL,
    cause: 'General roof mechanism fault — could be hydraulic, electrical, or mechanical',
    fix: 'Check hydraulic fluid level. Inspect for obstructions. Read sub-codes for specifics.',
    component: 'System',
  },
  A690: {
    desc: 'Microswitch — rear-end module closed, LEFT',
    severity: ROOF_SEVERITY.WARNING,
    cause: 'Left coupling lock microswitch corrosion or mechanical wear',
    fix: 'Access behind upper rear quarter panel trim. Clean or replace microswitch.',
    component: 'Microswitch',
  },
  A691: {
    desc: 'Hall sensor — rear-end module open',
    severity: ROOF_SEVERITY.CRITICAL,
    cause: 'Hall sensor at rear module not detecting open position',
    fix: 'Inspect sensor mounting. Check wiring from sensor to CVM.',
    component: 'Hall Sensor',
  },
  A692: {
    desc: 'Microswitch — rear-end module closed, RIGHT / compartment lid locked',
    severity: ROOF_SEVERITY.WARNING,
    cause: 'Right coupling lock microswitch failure. Very common on R57.',
    fix: 'Access behind right rear quarter panel. Clean contacts or replace switch.',
    component: 'Microswitch',
  },
  A693: {
    desc: 'Sensor — roof pack erected confirmation',
    severity: ROOF_SEVERITY.WARNING,
    cause: 'Secondary confirmation sensor not reading correctly',
    fix: 'Check sensor alignment and wiring continuity.',
    component: 'Position Sensor',
  },
  A69A: {
    desc: 'Solenoid valve — retractable top hydraulic control',
    severity: ROOF_SEVERITY.CRITICAL,
    cause: 'Hydraulic solenoid valve stuck or electrical fault',
    fix: 'Test solenoid resistance (should be 5–15 ohms). Replace if out of spec.',
    component: 'Solenoid Valve',
  },
  A69D: {
    desc: 'Roof position detection fault',
    severity: ROOF_SEVERITY.CRITICAL,
    cause: 'CVM cannot determine current roof position',
    fix: 'May need roof position re-learn procedure via ISTA. Check all Hall sensors.',
    component: 'System',
  },
  A69F: {
    desc: 'Relay fault affecting roof opening/closing',
    severity: ROOF_SEVERITY.CRITICAL,
    cause: 'Internal CVM relay failure or external relay issue',
    fix: 'Check relay clicks when operating roof. CVM may need replacement if internal.',
    component: 'Relay',
  },

  // --- Hydraulic system ---
  A6A0: {
    desc: 'Relay 2 — hardtop/roof drive motor',
    severity: ROOF_SEVERITY.CRITICAL,
    cause: 'Roof drive motor relay fault',
    fix: 'Test relay independently. Replace CVM if internal relay.',
    component: 'Relay',
  },
  A6A1: {
    desc: 'Hardtop/roof not locked',
    severity: ROOF_SEVERITY.CRITICAL,
    cause: 'Locking mechanism not confirming locked state',
    fix: 'Inspect front header latches. Check for bent latch pins or worn catches.',
    component: 'Lock Mechanism',
  },
  A6A3: {
    desc: 'Hydraulic fluid temperature sensor',
    severity: ROOF_SEVERITY.WARNING,
    cause: 'Fluid temperature out of range — may indicate pump overwork or sensor fault',
    fix: 'Check hydraulic fluid level and condition. Sensor is in the hydraulic pump assembly.',
    component: 'Hydraulic',
  },
  A6A4: {
    desc: 'Soft top unlocked / locking system fault',
    severity: ROOF_SEVERITY.CRITICAL,
    cause: 'Roof not securely latched — driving hazard',
    fix: 'Do not drive with roof unlocked. Check front latches manually. Inspect for debris.',
    component: 'Lock Mechanism',
  },

  // --- Power supply ---
  '93D0': {
    desc: 'CVM supply voltage too low',
    severity: ROOF_SEVERITY.WARNING,
    cause: 'Battery voltage dropped during roof operation (high current draw)',
    fix: 'Test battery and charging system. Roof pump draws ~30A.',
    component: 'Electrical',
  },

  // --- CAN communication ---
  E72C: {
    desc: 'CAN message position — signal implausible',
    severity: ROOF_SEVERITY.WARNING,
    cause: 'CVM detecting corrupted CAN messages from window/door modules',
    fix: 'Check K-CAN bus wiring. May indicate a failing window regulator module.',
    component: 'CAN Bus',
  },
};

/**
 * Check Control (CC-ID) codes that appear as dashboard warnings
 * related to the convertible roof.
 */
export const ROOF_CCID_CODES = {
  267: { desc: 'Rear window drive fault', severity: ROOF_SEVERITY.WARNING },
  268: { desc: 'Luggage compartment position error', severity: ROOF_SEVERITY.WARNING },
  270: { desc: 'Convertible top not locked', severity: ROOF_SEVERITY.CRITICAL },
  271: { desc: 'Convertible top — vehicle speed warning', severity: ROOF_SEVERITY.INFO },
  272: { desc: 'Convertible top failure', severity: ROOF_SEVERITY.CRITICAL },
  401: { desc: 'Roof mechanism failure', severity: ROOF_SEVERITY.CRITICAL },
  416: { desc: 'Luggage compartment partition fault', severity: ROOF_SEVERITY.WARNING },
  432: { desc: 'Roof drive overload', severity: ROOF_SEVERITY.CRITICAL },
  445: { desc: 'Vehicle not level (for roof operation)', severity: ROOF_SEVERITY.INFO },
  516: { desc: 'Roof operation cancelled', severity: ROOF_SEVERITY.INFO },
  518: { desc: 'Convertible top not locked', severity: ROOF_SEVERITY.CRITICAL },
  519: { desc: 'Roof operation not possible', severity: ROOF_SEVERITY.CRITICAL },
  558: { desc: 'Roof position detection failure', severity: ROOF_SEVERITY.CRITICAL },
  559: { desc: 'Roof drive overheated', severity: ROOF_SEVERITY.WARNING },
  560: { desc: 'Roof operation not possible', severity: ROOF_SEVERITY.CRITICAL },
  561: { desc: 'Roof emergency operation active', severity: ROOF_SEVERITY.WARNING },
  562: { desc: 'Roof unlocked', severity: ROOF_SEVERITY.CRITICAL },
};

/**
 * Common R57 roof failure points — reference for troubleshooting.
 */
export const ROOF_FAILURE_POINTS = [
  {
    component: 'Coupling Lock Microswitches',
    codes: ['A690', 'A692'],
    frequency: 'Very common',
    description: 'Left/right coupling lock microswitches corrode or wear mechanically. Located behind upper rear quarter panel trim.',
  },
  {
    component: 'Hall Sensors',
    codes: ['A689', 'A68A', 'A691'],
    frequency: 'Common',
    description: 'Mounted on hydraulic rams. Detect roof position (erected/stowed). Fail from vibration or water exposure.',
  },
  {
    component: 'Hydraulic Pump Seals',
    codes: ['A68E', 'A6A3'],
    frequency: 'Common (age-related)',
    description: 'Internal seals wear over time, reducing pressure. Causes slow or incomplete roof movements. Check fluid level first.',
  },
  {
    component: 'CVM Water Ingress',
    codes: ['A68E', 'A69D'],
    frequency: 'Common',
    description: 'CVM module behind rear seats is exposed to water intrusion. Causes PCB corrosion and intermittent faults.',
  },
  {
    component: 'Boot Wiring Loom',
    codes: ['E72C'],
    frequency: 'Moderate',
    description: 'Repeated roof cycling chafes wiring at hinge points. Causes intermittent electrical faults.',
  },
  {
    component: 'Solenoid Valves',
    codes: ['A69A'],
    frequency: 'Moderate',
    description: 'Control hydraulic flow direction. Resistance should be 5–15 ohms. Failure prevents specific roof movements.',
  },
  {
    component: 'Front Header Latches',
    codes: ['A68D', 'A6A1', 'A6A4'],
    frequency: 'Moderate',
    description: 'Microswitches in front latches fail to confirm locked state. Check for bent pins or worn catches.',
  },
  {
    component: 'CVM Internal Relays',
    codes: ['A69F', 'A6A0'],
    frequency: 'Less common',
    description: 'Internal relays in the CVM module fail. Usually requires CVM replacement.',
  },
];

/**
 * Look up a roof fault code (BMW hex format).
 * @param {string} code - e.g. "A692" or "93D0"
 * @returns {object|null}
 */
export function lookupRoofCode(code) {
  const normalised = code.toUpperCase().trim();
  return ROOF_CODES[normalised] || null;
}

/**
 * Look up a CC-ID roof warning code.
 * @param {number|string} ccid - e.g. 270 or "270"
 * @returns {object|null}
 */
export function lookupCCID(ccid) {
  return ROOF_CCID_CODES[Number(ccid)] || null;
}

/** Get total number of known roof codes. */
export function getRoofDatabaseSize() {
  return Object.keys(ROOF_CODES).length + Object.keys(ROOF_CCID_CODES).length;
}

/**
 * Parse a raw UDS CVM response into structured DTC objects.
 *
 * UDS ReadDTCInformation (19 02 FF) response format:
 *   59 02 FF [DTC_HI] [DTC_LO] [SUB] [STATUS] ...
 * Each DTC is 4 bytes. First 2 bytes = BMW hex code (e.g. A6 92 → "A692").
 *
 * @param {string} responseStr - Raw ELM327 response (hex bytes, space-separated)
 * @returns {{ dtcs: Array<{ code, desc, severity, cause, fix, component }>, raw: string }}
 */
export function parseCVMResponse(responseStr) {
  if (!responseStr || typeof responseStr !== 'string') {
    return { dtcs: [], raw: responseStr || '' };
  }

  // Strip any line breaks, prompt chars, and normalise spacing
  const cleaned = responseStr.replace(/[\r\n>]/g, ' ').trim();
  const bytes = cleaned.split(/\s+/).filter(b => /^[0-9A-Fa-f]{2}$/.test(b));

  // Find the 59 02 FF prefix (positive response to 19 02 FF)
  let startIdx = -1;
  for (let i = 0; i <= bytes.length - 3; i++) {
    if (bytes[i].toUpperCase() === '59' &&
        bytes[i + 1].toUpperCase() === '02' &&
        bytes[i + 2].toUpperCase() === 'FF') {
      startIdx = i + 3;
      break;
    }
  }

  if (startIdx < 0 || startIdx >= bytes.length) {
    return { dtcs: [], raw: cleaned };
  }

  // Each DTC is 4 bytes: [HI] [LO] [SUB] [STATUS]
  const dtcBytes = bytes.slice(startIdx);
  const dtcs = [];

  for (let i = 0; i + 3 < dtcBytes.length; i += 4) {
    const hi = dtcBytes[i].toUpperCase();
    const lo = dtcBytes[i + 1].toUpperCase();
    const code = `${hi}${lo}`;
    const statusByte = parseInt(dtcBytes[i + 3], 16);

    // Skip null DTCs (00 00)
    if (code === '0000') continue;

    const known = ROOF_CODES[code];
    dtcs.push({
      code,
      desc: known?.desc || 'Unknown CVM fault',
      severity: known?.severity || ROOF_SEVERITY.WARNING,
      cause: known?.cause || null,
      fix: known?.fix || null,
      component: known?.component || 'CVM',
      statusByte,
      active: (statusByte & 0x01) !== 0,
    });
  }

  return { dtcs, raw: cleaned };
}
