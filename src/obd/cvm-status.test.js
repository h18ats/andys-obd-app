/**
 * Tests for cvm-status.js — pure functions that parse UDS responses,
 * decode bitmasks, infer roof phases, and diff calibration data.
 */
import { describe, it, expect } from 'vitest';
import {
  parseReadDIDResponse,
  decodeSwitchBitmask,
  inferRoofPhase,
  diffBytes,
  extractAnalogValue,
  simulateSwitchStates,
  CVM_SWITCHES,
  SWITCH_GROUP,
  ROOF_PHASES,
  CANDIDATE_DIDS,
} from './cvm-status.js';

// ============================================================
// parseReadDIDResponse
// ============================================================
describe('parseReadDIDResponse', () => {
  it('parses a positive response with data bytes', () => {
    const r = parseReadDIDResponse('62 20 00 3F 82', 0x2000);
    expect(r.ok).toBe(true);
    expect(r.data).toEqual([0x3F, 0x82]);
  });

  it('parses a positive response with extra whitespace and newlines', () => {
    const r = parseReadDIDResponse('  62 20 00 FF\r\n01 > ', 0x2000);
    expect(r.ok).toBe(true);
    expect(r.data).toEqual([0xFF, 0x01]);
  });

  it('parses a negative response with known NRC', () => {
    const r = parseReadDIDResponse('7F 22 31', 0x2000);
    expect(r.ok).toBe(false);
    expect(r.nrc).toBe(0x31);
    expect(r.nrcDesc).toContain('Request out of range');
  });

  it('parses a negative response with unknown NRC', () => {
    const r = parseReadDIDResponse('7F 22 99', 0x2000);
    expect(r.ok).toBe(false);
    expect(r.nrc).toBe(0x99);
    expect(r.nrcDesc).toContain('Unknown NRC');
  });

  it('returns error for null/undefined input', () => {
    expect(parseReadDIDResponse(null, 0x2000).ok).toBe(false);
    expect(parseReadDIDResponse(undefined, 0x2000).ok).toBe(false);
    expect(parseReadDIDResponse('', 0x2000).ok).toBe(false);
  });

  it('returns error for non-hex garbage', () => {
    const r = parseReadDIDResponse('NO DATA', 0x2000);
    expect(r.ok).toBe(false);
    expect(r.error).toBeTruthy();
  });

  it('rejects response with wrong DID echo', () => {
    // Response says DID 0x2001 but we asked for 0x2000
    const r = parseReadDIDResponse('62 20 01 FF', 0x2000);
    expect(r.ok).toBe(false);
  });

  it('handles response with CAN header prefix bytes', () => {
    // Some adapters return header bytes before the UDS response
    const r = parseReadDIDResponse('6E0 08 62 20 00 AB CD', 0x2000);
    expect(r.ok).toBe(true);
    expect(r.data).toEqual([0xAB, 0xCD]);
  });

  it('handles zero-length data (DID exists but returns no payload)', () => {
    const r = parseReadDIDResponse('62 20 00', 0x2000);
    expect(r.ok).toBe(true);
    expect(r.data).toEqual([]);
  });

  it('handles response with mixed case hex', () => {
    const r = parseReadDIDResponse('62 20 00 aB cD', 0x2000);
    expect(r.ok).toBe(true);
    expect(r.data).toEqual([0xAB, 0xCD]);
  });

  it('handles DID 0xF100 (identification)', () => {
    const r = parseReadDIDResponse('62 F1 00 42 4D 57', 0xF100);
    expect(r.ok).toBe(true);
    expect(r.data).toEqual([0x42, 0x4D, 0x57]); // "BMW" in ASCII
  });

  it('prioritises negative response over malformed positive', () => {
    // Both patterns present — negative should be caught first
    const r = parseReadDIDResponse('7F 22 11 62 20 00 FF', 0x2000);
    expect(r.ok).toBe(false);
    expect(r.nrc).toBe(0x11);
  });

  it('strips SEARCHING... prefix from adapter', () => {
    const r = parseReadDIDResponse('SEARCHING...\r\n62 20 00 AB', 0x2000);
    expect(r.ok).toBe(true);
    expect(r.data).toEqual([0xAB]);
  });

  it('strips ? timeout markers', () => {
    const r = parseReadDIDResponse('62 20 00 FF ?', 0x2000);
    expect(r.ok).toBe(true);
    expect(r.data).toEqual([0xFF]);
  });

  it('detects BUFFER FULL error', () => {
    const r = parseReadDIDResponse('BUFFER FULL', 0x2000);
    expect(r.ok).toBe(false);
    expect(r.error).toContain('Buffer full');
  });

  it('detects CAN ERROR', () => {
    const r = parseReadDIDResponse('CAN ERROR', 0x2000);
    expect(r.ok).toBe(false);
    expect(r.error).toContain('CAN');
  });

  it('detects UNABLE TO CONNECT', () => {
    const r = parseReadDIDResponse('UNABLE TO CONNECT', 0x2000);
    expect(r.ok).toBe(false);
  });

  it('strips BUS INIT: OK prefix', () => {
    const r = parseReadDIDResponse('BUS INIT: OK\r\n62 20 00 CC', 0x2000);
    expect(r.ok).toBe(true);
    expect(r.data).toEqual([0xCC]);
  });
});

// ============================================================
// decodeSwitchBitmask
// ============================================================
describe('decodeSwitchBitmask', () => {
  it('decodes all-ones as all switches closed', () => {
    const r = decodeSwitchBitmask([0xFF, 0xFF]);
    expect(r.switches.cowlLocked).toBe(true);
    expect(r.switches.cowlUnlocked).toBe(true);
    expect(r.switches.couplingLeft).toBe(true);
    expect(r.switches.couplingRight).toBe(true);
    expect(r.switches.pumpMotor).toBe(true);
  });

  it('decodes all-zeros as all switches open', () => {
    const r = decodeSwitchBitmask([0x00, 0x00]);
    expect(r.switches.cowlLocked).toBe(false);
    expect(r.switches.hallErected).toBe(false);
    expect(r.switches.parcelShelf).toBe(false);
  });

  it('decodes specific bit pattern correctly', () => {
    // Byte 0: 0b10010000 = cowlLocked + hallErected
    const r = decodeSwitchBitmask([0x90, 0x00]);
    expect(r.switches.cowlLocked).toBe(true);
    expect(r.switches.cowlUnlocked).toBe(false);
    expect(r.switches.cowlReached).toBe(false);
    expect(r.switches.hallErected).toBe(true);
    expect(r.switches.hallStowed).toBe(false);
  });

  it('reports unknown bits beyond the mapping', () => {
    const r = decodeSwitchBitmask([0x00, 0x01]); // bit 0 of byte 1 is unmapped
    expect(r.unknownBits[15]).toBe(true); // flat index 15
  });

  it('handles extra data bytes beyond 2', () => {
    const r = decodeSwitchBitmask([0xFF, 0xFF, 0xAA]);
    // Should decode bytes 0-1 normally and put byte 2 bits in unknownBits
    expect(r.switches.cowlLocked).toBe(true);
    expect(Object.keys(r.unknownBits).length).toBeGreaterThan(0);
  });

  it('handles single byte input', () => {
    const r = decodeSwitchBitmask([0x04]); // bit 2 = couplingLeft
    expect(r.switches.couplingLeft).toBe(true);
    expect(r.switches.couplingRight).toBe(false);
  });

  it('handles empty input', () => {
    const r = decodeSwitchBitmask([]);
    expect(Object.keys(r.switches)).toHaveLength(0);
    expect(r.raw).toBe('');
  });

  it('uses custom bitMap when provided', () => {
    const customMap = ['mySwitch', null, null, null, null, null, null, null];
    const r = decodeSwitchBitmask([0x80], customMap);
    expect(r.switches.mySwitch).toBe(true);
    expect(r.switches.cowlLocked).toBeUndefined(); // default map not used
  });

  it('produces correct raw hex string', () => {
    const r = decodeSwitchBitmask([0x3F, 0x82]);
    expect(r.raw).toBe('3F 82');
  });
});

// ============================================================
// inferRoofPhase
// ============================================================
describe('inferRoofPhase', () => {
  it('identifies fully closed roof', () => {
    const states = {
      cowlLocked: true, cowlUnlocked: false, cowlReached: true,
      hallErected: true, hallStowed: false,
      couplingLeft: true, couplingRight: true,
      hallRearOpen: false, parcelShelf: true, pumpMotor: false,
    };
    const { phase, confidence } = inferRoofPhase(states);
    expect(phase.id).toBe('closed');
    expect(confidence).toBe(1);
  });

  it('identifies fully open roof', () => {
    const states = {
      cowlLocked: false, cowlUnlocked: true, cowlReached: false,
      hallErected: false, hallStowed: true,
      couplingLeft: false, couplingRight: false,
      hallRearOpen: false, parcelShelf: true, pumpMotor: false,
    };
    const { phase, confidence } = inferRoofPhase(states);
    expect(phase.id).toBe('open');
    expect(confidence).toBe(1);
  });

  it('returns null for empty states', () => {
    const { phase, confidence } = inferRoofPhase({});
    expect(phase).toBeNull();
    expect(confidence).toBe(0);
  });

  it('returns null for null input', () => {
    const { phase } = inferRoofPhase(null);
    expect(phase).toBeNull();
  });

  it('handles partial data gracefully', () => {
    // Only two switches known
    const { phase, confidence } = inferRoofPhase({ cowlLocked: true, hallErected: true });
    expect(phase).not.toBeNull();
    expect(confidence).toBeGreaterThan(0);
    expect(confidence).toBeLessThanOrEqual(1);
  });

  it('reduces confidence when states partially match', () => {
    // Mostly closed but pump is running (shouldn't be for closed)
    const states = {
      cowlLocked: true, cowlUnlocked: false, cowlReached: true,
      hallErected: true, hallStowed: false,
      couplingLeft: true, couplingRight: true,
      hallRearOpen: false, parcelShelf: true, pumpMotor: true, // ← wrong for closed
    };
    const { phase, confidence } = inferRoofPhase(states);
    expect(confidence).toBeLessThan(1);
    expect(confidence).toBeGreaterThan(0.5); // Should still mostly match closed
  });
});

// ============================================================
// diffBytes
// ============================================================
describe('diffBytes', () => {
  it('detects no changes for identical bytes', () => {
    expect(diffBytes([0xFF, 0x00], [0xFF, 0x00])).toEqual([]);
  });

  it('detects single bit change', () => {
    const changes = diffBytes([0x00], [0x01]);
    expect(changes).toHaveLength(1);
    expect(changes[0].bitIndex).toBe(0);
    expect(changes[0].before).toBe(false);
    expect(changes[0].after).toBe(true);
  });

  it('detects multiple bit changes', () => {
    const changes = diffBytes([0xFF], [0x00]);
    expect(changes).toHaveLength(8); // All 8 bits flipped
  });

  it('handles different length arrays', () => {
    const changes = diffBytes([0x00], [0x00, 0xFF]);
    expect(changes).toHaveLength(8); // 8 new bits in byte 1
    expect(changes[0].byteIndex).toBe(1);
  });

  it('handles empty arrays', () => {
    expect(diffBytes([], [])).toEqual([]);
  });

  it('calculates correct flatIndex', () => {
    // Flip MSB of byte 1 → flatIndex should be 8 (byte1 * 8 + (7 - 7))
    const changes = diffBytes([0x00, 0x00], [0x00, 0x80]);
    expect(changes).toHaveLength(1);
    expect(changes[0].flatIndex).toBe(8);
    expect(changes[0].byteIndex).toBe(1);
    expect(changes[0].bitIndex).toBe(7);
  });
});

// ============================================================
// extractAnalogValue
// ============================================================
describe('extractAnalogValue', () => {
  it('extracts single byte value', () => {
    expect(extractAnalogValue([0x00, 0x7F, 0xFF], 1)).toBe(0x7F);
  });

  it('extracts two-byte big-endian value', () => {
    expect(extractAnalogValue([0x01, 0x00], 0, 2)).toBe(0x0100);
  });

  it('returns null for out-of-bounds offset', () => {
    expect(extractAnalogValue([0xFF], 5)).toBeNull();
  });

  it('falls back to single byte when two-byte offset is at edge', () => {
    // Offset 2, length 2, but only 3 bytes available — 2nd byte exists at index 3? No.
    // Array [0, 1, 2] offset=2 length=2 → need index 2 and 3, but 3 doesn't exist
    // Actually byteOffset + 1 = 3, 3 < 3 is false, so falls through to single byte
    expect(extractAnalogValue([0x00, 0x01, 0xFF], 2, 2)).toBe(0xFF);
  });
});

// ============================================================
// simulateSwitchStates
// ============================================================
describe('simulateSwitchStates', () => {
  it('returns closed state at t=0', () => {
    const s = simulateSwitchStates(0);
    expect(s.phase.id).toBe('closed');
    expect(s.switches.cowlLocked).toBe(true);
    expect(s.switches.hallErected).toBe(true);
  });

  it('cycles through phases over time', () => {
    // Phase 1 starts at 3000ms
    const s = simulateSwitchStates(3500);
    expect(s.phase.id).toBe('unlatching');
  });

  it('wraps around to start after full cycle', () => {
    const cycleDuration = ROOF_PHASES.length * 3000; // 18s
    const s = simulateSwitchStates(cycleDuration + 100);
    expect(s.phase.id).toBe('closed');
  });

  it('includes analog pillar angle values', () => {
    const s = simulateSwitchStates(0);
    expect(s.analogValues.pillarAngle).toBeDefined();
    expect(typeof s.analogValues.pillarAngle).toBe('number');
  });

  it('does not include analog switches in boolean map', () => {
    const s = simulateSwitchStates(0);
    expect(s.switches.pillarAngle).toBeUndefined();
  });
});

// ============================================================
// Data integrity checks
// ============================================================
describe('CVM_SWITCHES integrity', () => {
  it('all switches have required fields', () => {
    for (const sw of CVM_SWITCHES) {
      expect(sw.id).toBeTruthy();
      expect(sw.label).toBeTruthy();
      expect(sw.location).toBeTruthy();
      expect(Object.values(SWITCH_GROUP)).toContain(sw.group);
      expect(typeof sw.expectedWhenClosed).not.toBe('undefined');
      expect(typeof sw.expectedWhenOpen).not.toBe('undefined');
    }
  });

  it('all switch IDs are unique', () => {
    const ids = CVM_SWITCHES.map(s => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('all referenced fault codes exist in known code ranges', () => {
    for (const sw of CVM_SWITCHES) {
      if (sw.faultCode) {
        expect(sw.faultCode).toMatch(/^[A-F0-9]{4}$/);
      }
    }
  });
});

describe('ROOF_PHASES integrity', () => {
  it('all phases have unique IDs', () => {
    const ids = ROOF_PHASES.map(p => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('all phase state keys reference valid switch IDs', () => {
    const validIds = new Set(CVM_SWITCHES.map(s => s.id));
    for (const phase of ROOF_PHASES) {
      for (const key of Object.keys(phase.states)) {
        expect(validIds.has(key)).toBe(true);
      }
    }
  });

  it('first phase is closed, last is open', () => {
    expect(ROOF_PHASES[0].id).toBe('closed');
    expect(ROOF_PHASES[ROOF_PHASES.length - 1].id).toBe('open');
  });
});

describe('CANDIDATE_DIDS integrity', () => {
  it('all DIDs are valid 16-bit values', () => {
    for (const d of CANDIDATE_DIDS) {
      expect(d.did).toBeGreaterThanOrEqual(0);
      expect(d.did).toBeLessThanOrEqual(0xFFFF);
      expect(d.name).toBeTruthy();
    }
  });

  it('no duplicate DIDs', () => {
    const dids = CANDIDATE_DIDS.map(d => d.did);
    expect(new Set(dids).size).toBe(dids.length);
  });
});
