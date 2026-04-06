/**
 * CVM (Convertible Top Module) Live Status
 *
 * Reads real-time microswitch and hall sensor states from the R57 CVM
 * via UDS ReadDataByIdentifier (service 0x22). Provides:
 *  - Switch/sensor definitions with physical locations and fault code mappings
 *  - DID probe logic to discover which DIDs the CVM supports
 *  - Response parsers for status bitmasks
 *  - Roof operation phase inference from switch state combinations
 *
 * IMPORTANT: UDS 0x22 is only attempted when the CVM has already been
 * reached successfully via 0x19 (DTC scan). This module never introduces
 * new adapter compatibility failures.
 */

// ---------------------------------------------------------------------------
// Switch & Sensor Definitions
// ---------------------------------------------------------------------------

export const SWITCH_TYPE = { MICRO: 'microswitch', HALL: 'hallSensor' };

export const SWITCH_GROUP = {
  FRONT: 'frontHeader',
  ROOF: 'roofPack',
  REAR: 'rearModule',
  HYDRAULIC: 'hydraulic',
};

export const GROUP_LABELS = {
  [SWITCH_GROUP.FRONT]: 'Front Header',
  [SWITCH_GROUP.ROOF]: 'Roof Pack',
  [SWITCH_GROUP.REAR]: 'Rear Module',
  [SWITCH_GROUP.HYDRAULIC]: 'Hydraulic',
};

/**
 * All known CVM switches and sensors.
 * Order within each group matches the physical top-to-bottom layout.
 */
export const CVM_SWITCHES = [
  // --- Front header ---
  {
    id: 'cowlLocked',
    label: 'Cowl Locked',
    location: 'Front header bow / windscreen frame',
    group: SWITCH_GROUP.FRONT,
    type: SWITCH_TYPE.MICRO,
    faultCode: 'A68E',
    closedMeaning: 'Roof latched to windscreen',
    openMeaning: 'Latch not engaged',
    expectedWhenClosed: true,
    expectedWhenOpen: false,
  },
  {
    id: 'cowlUnlocked',
    label: 'Cowl Unlocked',
    location: 'Front header bow / windscreen frame',
    group: SWITCH_GROUP.FRONT,
    type: SWITCH_TYPE.MICRO,
    faultCode: 'A68F',
    closedMeaning: 'Latch released (ready to fold)',
    openMeaning: 'Latch not in released detent',
    expectedWhenClosed: false,
    expectedWhenOpen: true,
  },
  {
    id: 'cowlReached',
    label: 'Cowl Reached',
    location: 'Header bow travel limit',
    group: SWITCH_GROUP.FRONT,
    type: SWITCH_TYPE.MICRO,
    faultCode: 'A694',
    closedMeaning: 'Header at windscreen (close complete)',
    openMeaning: 'Header not yet at windscreen',
    expectedWhenClosed: true,
    expectedWhenOpen: false,
  },

  // --- Roof pack ---
  {
    id: 'hallErected',
    label: 'Erected Hall',
    location: 'Hydraulic ram, right side',
    group: SWITCH_GROUP.ROOF,
    type: SWITCH_TYPE.HALL,
    faultCode: 'A689',
    closedMeaning: 'Roof pack fully up',
    openMeaning: 'Roof not in erected position',
    expectedWhenClosed: true,
    expectedWhenOpen: false,
  },
  {
    id: 'hallStowed',
    label: 'Stowed Hall',
    location: 'Rear of roof compartment',
    group: SWITCH_GROUP.ROOF,
    type: SWITCH_TYPE.HALL,
    faultCode: 'A68A',
    closedMeaning: 'Roof pack fully stowed in boot',
    openMeaning: 'Roof not in stowed position',
    expectedWhenClosed: false,
    expectedWhenOpen: true,
  },
  {
    id: 'pillarAngle',
    label: 'Pillar Angle',
    location: 'Right main convertible top bearing',
    group: SWITCH_GROUP.ROOF,
    type: SWITCH_TYPE.HALL,
    faultCode: 'A68B',
    closedMeaning: null, // Analog — not boolean
    openMeaning: null,
    isAnalog: true,
    expectedWhenClosed: null,
    expectedWhenOpen: null,
  },

  // --- Rear module ---
  {
    id: 'couplingLeft',
    label: 'Coupling LEFT',
    location: 'Behind left rear quarter panel trim',
    group: SWITCH_GROUP.REAR,
    type: SWITCH_TYPE.MICRO,
    faultCode: 'A690',
    closedMeaning: 'Left coupling ring buckle locked',
    openMeaning: 'Left coupling unlocked',
    expectedWhenClosed: true,
    expectedWhenOpen: false,
  },
  {
    id: 'couplingRight',
    label: 'Coupling RIGHT',
    location: 'Behind right rear quarter panel trim',
    group: SWITCH_GROUP.REAR,
    type: SWITCH_TYPE.MICRO,
    faultCode: 'A692',
    closedMeaning: 'Right coupling ring buckle locked',
    openMeaning: 'Right coupling unlocked',
    expectedWhenClosed: true,
    expectedWhenOpen: false,
  },
  {
    id: 'hallRearOpen',
    label: 'Rear Open Hall',
    location: 'Boot partition area',
    group: SWITCH_GROUP.REAR,
    type: SWITCH_TYPE.HALL,
    faultCode: 'A691',
    closedMeaning: 'Compartment lid open',
    openMeaning: 'Compartment lid closed',
    expectedWhenClosed: false,
    expectedWhenOpen: false, // Lid closes after stowing
  },
  {
    id: 'parcelShelf',
    label: 'Parcel Shelf',
    location: 'Left rear corner of parcel shelf',
    group: SWITCH_GROUP.REAR,
    type: SWITCH_TYPE.MICRO,
    faultCode: null,
    closedMeaning: 'Shelf in correct position for stowing',
    openMeaning: 'Shelf not positioned',
    expectedWhenClosed: true,
    expectedWhenOpen: true,
  },

  // --- Hydraulic ---
  {
    id: 'pumpMotor',
    label: 'Pump Motor',
    location: 'Behind rear seats',
    group: SWITCH_GROUP.HYDRAULIC,
    type: SWITCH_TYPE.HALL,
    faultCode: null,
    closedMeaning: 'Pump running',
    openMeaning: 'Pump off',
    expectedWhenClosed: false,
    expectedWhenOpen: false,
  },
];

// Quick lookup by ID
const switchById = new Map(CVM_SWITCHES.map(s => [s.id, s]));
export function getSwitch(id) { return switchById.get(id) || null; }

// ---------------------------------------------------------------------------
// Roof Operation Phases
// ---------------------------------------------------------------------------

/**
 * Expected switch states at each phase of roof operation.
 * null = don't care / transitioning. true = CLOSED. false = OPEN.
 */
export const ROOF_PHASES = [
  {
    id: 'closed',
    label: 'Closed (all latched)',
    states: {
      cowlLocked: true, cowlUnlocked: false, cowlReached: true,
      hallErected: true, hallStowed: false,
      couplingLeft: true, couplingRight: true,
      hallRearOpen: false, parcelShelf: true, pumpMotor: false,
    },
  },
  {
    id: 'unlatching',
    label: 'Unlatching front header',
    states: {
      cowlLocked: false, cowlUnlocked: true,
      hallErected: true, hallStowed: false,
      couplingLeft: true, couplingRight: true,
      hallRearOpen: false, pumpMotor: true,
    },
  },
  {
    id: 'foldBeginning',
    label: 'Fold beginning',
    states: {
      cowlLocked: false, cowlUnlocked: true, cowlReached: false,
      hallErected: false, hallStowed: false,
      couplingLeft: false, couplingRight: false,
      hallRearOpen: false, pumpMotor: true,
    },
  },
  {
    id: 'bootOpening',
    label: 'Boot opening',
    states: {
      cowlLocked: false,
      hallErected: false, hallStowed: false,
      couplingLeft: false, couplingRight: false,
      hallRearOpen: true, pumpMotor: true,
    },
  },
  {
    id: 'stowing',
    label: 'Stowing into boot',
    states: {
      cowlLocked: false,
      hallErected: false, hallStowed: false,
      couplingLeft: false, couplingRight: false,
      hallRearOpen: true, pumpMotor: true,
    },
  },
  {
    id: 'open',
    label: 'Open (stowed)',
    states: {
      cowlLocked: false, cowlUnlocked: true, cowlReached: false,
      hallErected: false, hallStowed: true,
      couplingLeft: false, couplingRight: false,
      hallRearOpen: false, parcelShelf: true, pumpMotor: false,
    },
  },
];

/**
 * Infer the most likely roof phase from current switch states.
 * Returns { phase, confidence } where confidence is 0-1 (fraction of matching switches).
 */
export function inferRoofPhase(switchStates) {
  if (!switchStates || Object.keys(switchStates).length === 0) {
    return { phase: null, confidence: 0 };
  }

  let bestPhase = null;
  let bestScore = -1;

  for (const phase of ROOF_PHASES) {
    let matches = 0;
    let total = 0;

    for (const [switchId, expected] of Object.entries(phase.states)) {
      if (expected === null) continue; // Don't care
      const actual = switchStates[switchId];
      if (actual === undefined || actual === null) continue; // No data
      total++;
      if (actual === expected) matches++;
    }

    const score = total > 0 ? matches / total : 0;
    if (score > bestScore) {
      bestScore = score;
      bestPhase = phase;
    }
  }

  return { phase: bestPhase, confidence: bestScore };
}

// ---------------------------------------------------------------------------
// DID Candidate List
// ---------------------------------------------------------------------------

/**
 * Candidate DIDs to probe, ordered by likelihood.
 * BMW CVM DIDs are proprietary — we probe to discover which are supported.
 */
export const CANDIDATE_DIDS = [
  // ECU identification — confirms 0x22 works at all
  { did: 0xF100, name: 'ECU identification', category: 'id' },
  { did: 0xF101, name: 'ECU hardware number', category: 'id' },

  // Status registers — most likely to contain switch bitmasks
  { did: 0x2000, name: 'General status register', category: 'status' },
  { did: 0x2001, name: 'Extended status register', category: 'status' },
  { did: 0x2002, name: 'Status register 3', category: 'status' },
  { did: 0x2003, name: 'Status register 4', category: 'status' },
  { did: 0x2010, name: 'Digital input status word', category: 'status' },
  { did: 0x2011, name: 'Digital input status word 2', category: 'status' },
  { did: 0x2020, name: 'Analog input status', category: 'status' },

  // ISTA-style component status blocks
  { did: 0xD000, name: 'Component status block', category: 'ista' },
  { did: 0xD001, name: 'Component status block 2', category: 'ista' },
  { did: 0xD002, name: 'Component status block 3', category: 'ista' },
  { did: 0xD010, name: 'Hall sensor status (STATUS_HALLSENSOREN)', category: 'ista' },
  { did: 0xD020, name: 'Microswitch status (STATUS_MIKROSCHALTER)', category: 'ista' },
  { did: 0xD030, name: 'Actuator status', category: 'ista' },

  // IO status registers
  { did: 0x3000, name: 'IO status register', category: 'io' },
  { did: 0x3001, name: 'IO status register 2', category: 'io' },

  // BMW-specific low-range
  { did: 0x0001, name: 'Module status 1', category: 'low' },
  { did: 0x0002, name: 'Module status 2', category: 'low' },
  { did: 0x0100, name: 'System status', category: 'low' },
];

// ---------------------------------------------------------------------------
// UDS Response Parsing
// ---------------------------------------------------------------------------

/** UDS Negative Response Codes relevant to 0x22 */
const NRC_DESCRIPTIONS = {
  0x11: 'Service not supported',
  0x12: 'Sub-function not supported',
  0x13: 'Incorrect message length',
  0x14: 'Response too long',
  0x22: 'Conditions not correct',
  0x31: 'Request out of range (DID not found)',
  0x33: 'Security access denied',
  0x72: 'General programming failure',
  0x78: 'Response pending',
};

/**
 * Parse a UDS 0x22 response string from the ELM327.
 *
 * Positive: "62 [DID_HI] [DID_LO] [DATA...]"
 * Negative: "7F 22 [NRC]"
 * Error:    "NO DATA", "CAN ERROR", etc.
 *
 * @param {string} response - Raw hex response from ELM327
 * @param {number} expectedDid - The DID we requested (for validation)
 * @returns {{ ok: boolean, data?: number[], raw?: string, nrc?: number, nrcDesc?: string, error?: string }}
 */
export function parseReadDIDResponse(response, expectedDid) {
  if (!response || typeof response !== 'string') {
    return { ok: false, error: 'No response' };
  }

  // Strip ELM327 noise: prompts, echo, SEARCHING, and timeout markers
  const cleaned = response
    .replace(/[\r\n>]/g, ' ')
    .replace(/SEARCHING\.\.\./gi, '')
    .replace(/\?/g, '')
    .replace(/BUS INIT:\s*(OK|ERROR)/gi, '')
    .trim();

  // Detect fatal adapter errors before byte parsing
  const upperCleaned = cleaned.toUpperCase();
  if (upperCleaned.includes('BUFFER FULL')) {
    return { ok: false, error: 'Buffer full — response too long for adapter' };
  }
  if (upperCleaned.includes('CAN ERROR')) {
    return { ok: false, error: 'CAN bus error' };
  }
  if (upperCleaned.includes('NO DATA') || upperCleaned === 'UNABLE TO CONNECT') {
    return { ok: false, error: cleaned };
  }

  const bytes = cleaned.split(/\s+/).filter(b => /^[0-9A-Fa-f]{2}$/.test(b));

  if (bytes.length === 0) {
    return { ok: false, error: cleaned || 'Empty response' };
  }

  // Check for negative response: 7F 22 [NRC]
  for (let i = 0; i <= bytes.length - 3; i++) {
    if (bytes[i].toUpperCase() === '7F' && bytes[i + 1].toUpperCase() === '22') {
      const nrc = parseInt(bytes[i + 2], 16);
      return { ok: false, nrc, nrcDesc: NRC_DESCRIPTIONS[nrc] || `Unknown NRC 0x${nrc.toString(16)}`, raw: cleaned };
    }
  }

  // Check for positive response: 62 [DID_HI] [DID_LO] [DATA...]
  const didHi = ((expectedDid >> 8) & 0xFF).toString(16).toUpperCase().padStart(2, '0');
  const didLo = (expectedDid & 0xFF).toString(16).toUpperCase().padStart(2, '0');

  for (let i = 0; i <= bytes.length - 3; i++) {
    if (bytes[i].toUpperCase() === '62' &&
        bytes[i + 1].toUpperCase() === didHi &&
        bytes[i + 2].toUpperCase() === didLo) {
      // Collect data bytes up to the next response marker (62 or 7F) to handle
      // multi-frame responses where another response follows in the same string
      const dataBytes = [];
      for (let j = i + 3; j < bytes.length; j++) {
        const upper = bytes[j].toUpperCase();
        // Stop if we hit another positive or negative response header
        if (upper === '62' || upper === '7F') break;
        dataBytes.push(parseInt(bytes[j], 16));
      }
      return { ok: true, data: dataBytes, raw: cleaned };
    }
  }

  return { ok: false, error: 'Unexpected response format', raw: cleaned };
}

// ---------------------------------------------------------------------------
// Status Bitmask Decoding
// ---------------------------------------------------------------------------

/**
 * Default bit-to-switch mapping. This is our best-guess based on BMW patterns.
 * Indices refer to bit positions across the data bytes (byte0.bit7 = index 0, etc.)
 *
 * This mapping will be refined through:
 * 1. Community testing on real R57 vehicles
 * 2. Manual calibration mode (diff before/after switch operation)
 *
 * null entries = bit position not yet mapped to a switch
 */
const DEFAULT_BIT_MAP = [
  // Byte 0
  'cowlLocked',    // bit 7 (MSB)
  'cowlUnlocked',  // bit 6
  'cowlReached',   // bit 5
  'hallErected',   // bit 4
  'hallStowed',    // bit 3
  'couplingLeft',  // bit 2
  'couplingRight', // bit 1
  'hallRearOpen',  // bit 0

  // Byte 1
  'parcelShelf',   // bit 7
  'pumpMotor',     // bit 6
  null,            // bit 5 — unknown
  null,            // bit 4 — unknown
  null,            // bit 3 — unknown
  null,            // bit 2 — unknown
  null,            // bit 1 — unknown
  null,            // bit 0 — unknown
];

/**
 * Decode a status bitmask into named switch states.
 *
 * @param {number[]} dataBytes - Raw data bytes from DID response
 * @param {string[]|null} bitMap - Custom bit mapping (from calibration), or null for default
 * @returns {{ switches: Object<string, boolean>, unknownBits: Object<number, boolean>, raw: string }}
 */
export function decodeSwitchBitmask(dataBytes, bitMap = null) {
  const map = bitMap || DEFAULT_BIT_MAP;
  const switches = {};
  const unknownBits = {};

  for (let byteIdx = 0; byteIdx < dataBytes.length; byteIdx++) {
    for (let bitIdx = 7; bitIdx >= 0; bitIdx--) {
      const flatIdx = byteIdx * 8 + (7 - bitIdx);
      const value = (dataBytes[byteIdx] & (1 << bitIdx)) !== 0;

      if (flatIdx < map.length && map[flatIdx]) {
        switches[map[flatIdx]] = value;
      } else {
        unknownBits[flatIdx] = value;
      }
    }
  }

  const raw = dataBytes.map(b => b.toString(16).toUpperCase().padStart(2, '0')).join(' ');
  return { switches, unknownBits, raw };
}

/**
 * Try to extract an analog value (e.g. pillar angle) from data bytes.
 * BMW hall sensors typically report as a single byte (0-255) or two bytes (0-65535).
 *
 * @param {number[]} dataBytes - Subset of response relevant to this sensor
 * @param {number} byteOffset - Start byte
 * @param {number} byteLength - 1 or 2
 * @returns {number} Raw value (0-255 or 0-65535)
 */
export function extractAnalogValue(dataBytes, byteOffset, byteLength = 1) {
  if (byteOffset >= dataBytes.length) return null;
  if (byteLength === 2 && byteOffset + 1 < dataBytes.length) {
    return (dataBytes[byteOffset] << 8) | dataBytes[byteOffset + 1];
  }
  return dataBytes[byteOffset];
}

// ---------------------------------------------------------------------------
// DID Probe Results Management
// ---------------------------------------------------------------------------

const STORAGE_KEY_PREFIX = 'cvmDids_';

/**
 * Save discovered DIDs for a vehicle (by VIN).
 */
export function saveDiscoveredDids(vin, discoveredDids) {
  try {
    const key = STORAGE_KEY_PREFIX + (vin || 'unknown');
    localStorage.setItem(key, JSON.stringify({
      timestamp: Date.now(),
      dids: discoveredDids,
    }));
  } catch {}
}

/**
 * Load previously discovered DIDs for a vehicle.
 * Returns null if no stored data or data is older than 30 days.
 */
export function loadDiscoveredDids(vin) {
  try {
    const key = STORAGE_KEY_PREFIX + (vin || 'unknown');
    const stored = localStorage.getItem(key);
    if (!stored) return null;
    const parsed = JSON.parse(stored);
    // Expire after 30 days (DID support doesn't change, but firmware updates might)
    if (Date.now() - parsed.timestamp > 30 * 24 * 60 * 60 * 1000) return null;
    return parsed.dids;
  } catch {
    return null;
  }
}

/**
 * Save a custom bit mapping discovered through manual calibration.
 */
export function saveBitMap(vin, did, bitMap) {
  try {
    const key = `cvmBitMap_${vin || 'unknown'}_${did.toString(16)}`;
    localStorage.setItem(key, JSON.stringify(bitMap));
  } catch {}
}

/**
 * Load a custom bit mapping.
 */
export function loadBitMap(vin, did) {
  try {
    const key = `cvmBitMap_${vin || 'unknown'}_${did.toString(16)}`;
    const stored = localStorage.getItem(key);
    return stored ? JSON.parse(stored) : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Diff for Manual Calibration
// ---------------------------------------------------------------------------

/**
 * Diff two sets of raw data bytes to find which bits changed.
 * Used in manual calibration mode: read before → user operates switch → read after → diff.
 *
 * @param {number[]} before - Data bytes before switch operation
 * @param {number[]} after - Data bytes after switch operation
 * @returns {Array<{ byteIndex: number, bitIndex: number, flatIndex: number, before: boolean, after: boolean }>}
 */
export function diffBytes(before, after) {
  const changes = [];
  const len = Math.max(before.length, after.length);

  for (let byteIdx = 0; byteIdx < len; byteIdx++) {
    const b = before[byteIdx] || 0;
    const a = after[byteIdx] || 0;
    const xor = b ^ a;

    for (let bitIdx = 7; bitIdx >= 0; bitIdx--) {
      if (xor & (1 << bitIdx)) {
        changes.push({
          byteIndex: byteIdx,
          bitIndex: bitIdx,
          flatIndex: byteIdx * 8 + (7 - bitIdx),
          before: (b & (1 << bitIdx)) !== 0,
          after: (a & (1 << bitIdx)) !== 0,
        });
      }
    }
  }

  return changes;
}

// ---------------------------------------------------------------------------
// Demo Mode Simulation
// ---------------------------------------------------------------------------

/**
 * Generate simulated switch states for demo mode.
 * Cycles through the roof operation phases over time.
 *
 * @param {number} elapsedMs - Time since monitoring started
 * @returns {{ switches: Object<string, boolean>, phase: object, analogValues: Object<string, number> }}
 */
export function simulateSwitchStates(elapsedMs) {
  // Full cycle: 18 seconds (3s per phase × 6 phases)
  const PHASE_DURATION = 3000;
  const cycleMs = elapsedMs % (ROOF_PHASES.length * PHASE_DURATION);
  const phaseIndex = Math.floor(cycleMs / PHASE_DURATION);
  const phase = ROOF_PHASES[phaseIndex];

  const switches = {};
  for (const sw of CVM_SWITCHES) {
    if (sw.isAnalog) continue;
    const expected = phase.states[sw.id];
    switches[sw.id] = expected !== undefined && expected !== null ? expected : false;
  }

  // Simulate pillar angle: 0% when closed, ramps up during opening, 100% when open
  const anglePercent = Math.min(100, Math.max(0, (phaseIndex / (ROOF_PHASES.length - 1)) * 100));
  // Add slight jitter for realism
  const jitter = Math.sin(elapsedMs / 200) * 2;

  return {
    switches,
    phase,
    analogValues: {
      pillarAngle: Math.round(anglePercent + jitter),
    },
  };
}
