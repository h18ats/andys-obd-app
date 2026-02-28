/**
 * VIN Decoder
 *
 * Parses 17-character VIN strings. Identifies MINI vehicles (WMW prefix)
 * and decodes model year.
 */

// Model year code → year (standard VIN position 10)
const YEAR_CODES = {
  A: 2010, B: 2011, C: 2012, D: 2013, E: 2014, F: 2015,
  G: 2016, H: 2017, J: 2018, K: 2019, L: 2020, M: 2021,
  N: 2022, P: 2023, R: 2024, S: 2025, T: 2026, V: 2027,
  W: 2028, X: 2029, Y: 2030,
  1: 2001, 2: 2002, 3: 2003, 4: 2004, 5: 2005,
  6: 2006, 7: 2007, 8: 2008, 9: 2009,
};

// MINI model codes (VIN positions 4-7 patterns)
const MINI_MODELS = {
  FE: 'Cooper',
  FG: 'Cooper S',
  FH: 'Cooper D',
  FL: 'One',
  FM: 'John Cooper Works',
  MF: 'Cooper',
  MG: 'Cooper S',
  ML: 'One',
};

/**
 * Decode a 17-character VIN string.
 * @returns {{ valid, vin, wmi, vds, vis, manufacturer, isMini, isR56, modelYear, modelYearCode, model, serial } | { valid: false, error }}
 */
export function decodeVIN(raw) {
  if (typeof raw !== 'string') return { valid: false, error: 'not a string' };

  const vin = raw.trim().toUpperCase().replace(/[^A-HJ-NPR-Z0-9]/g, '');
  if (vin.length !== 17) return { valid: false, error: `invalid length: ${vin.length}` };

  const wmi = vin.substring(0, 3);   // World Manufacturer Identifier
  const vds = vin.substring(3, 9);   // Vehicle Descriptor Section
  const vis = vin.substring(9, 17);  // Vehicle Identifier Section

  const isMini = wmi === 'WMW';      // WMW = MINI (BMW Group plant Oxford/etc.)
  const modelYearCode = vin[9];
  const modelYear = YEAR_CODES[modelYearCode] || null;

  // R56 = second-gen MINI hatchback, produced 2006–2013
  const isR56 = isMini && modelYear !== null && modelYear >= 2006 && modelYear <= 2013;

  // Attempt model identification from VDS
  const modelKey = vds.substring(0, 2);
  const model = MINI_MODELS[modelKey] || null;

  const serial = vin.substring(11, 17);

  return {
    valid: true,
    vin,
    wmi,
    vds,
    vis,
    manufacturer: isMini ? 'MINI (BMW Group)' : wmi,
    isMini,
    isR56,
    modelYear,
    modelYearCode,
    model,
    serial,
  };
}

/**
 * Parse VIN from Mode 09 PID 02 response.
 * Response is typically multiple lines of hex, VIN is ASCII encoded.
 * E.g. "49 02 01 57 4D 57 ..." → "WMW..."
 */
export function parseVINResponse(lines) {
  // Collect all hex bytes from response lines, skip headers
  const allBytes = [];
  for (const line of lines) {
    const parts = line.trim().split(/\s+/);
    // Skip lines that are just prompts or metadata
    if (parts.length < 3) continue;
    // First response line has "49 02 01", subsequent have "49 02 0N"
    // Data starts after first 3 bytes on first line, after 1 byte on continuation lines
    const isFirst = parts[0] === '49' && parts[1] === '02';
    const dataStart = isFirst ? 3 : 1;
    for (let i = dataStart; i < parts.length; i++) {
      const byte = parseInt(parts[i], 16);
      if (!isNaN(byte) && byte >= 0x20) allBytes.push(byte);
    }
  }

  const vinStr = String.fromCharCode(...allBytes).replace(/[^A-HJ-NPR-Z0-9]/g, '');
  return vinStr.length >= 17 ? vinStr.substring(0, 17) : null;
}
