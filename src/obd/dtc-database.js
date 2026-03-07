/**
 * DTC (Diagnostic Trouble Code) Database
 *
 * Generic P0xxx codes + BMW MINI R56-specific P1xxx/P2xxx codes.
 * Severity: 'info' (monitor), 'warning' (service soon), 'critical' (stop driving).
 */

export const SEVERITY = {
  INFO: 'info',
  WARNING: 'warning',
  CRITICAL: 'critical',
};

// --- Generic OBD-II codes (P0xxx) ---
const GENERIC_DTCS = {
  // Fuel and air metering
  P0100: { desc: 'MAF sensor circuit malfunction', severity: SEVERITY.WARNING },
  P0101: { desc: 'MAF sensor circuit range/performance', severity: SEVERITY.WARNING },
  P0102: { desc: 'MAF sensor circuit low input', severity: SEVERITY.WARNING },
  P0103: { desc: 'MAF sensor circuit high input', severity: SEVERITY.WARNING },
  P0104: { desc: 'MAF sensor circuit intermittent', severity: SEVERITY.WARNING },
  P0105: { desc: 'MAP sensor circuit malfunction', severity: SEVERITY.WARNING },
  P0106: { desc: 'MAP sensor circuit range/performance', severity: SEVERITY.WARNING },
  P0107: { desc: 'MAP sensor circuit low input', severity: SEVERITY.WARNING },
  P0108: { desc: 'MAP sensor circuit high input', severity: SEVERITY.WARNING },
  P0110: { desc: 'Intake air temperature sensor circuit malfunction', severity: SEVERITY.INFO },
  P0111: { desc: 'IAT sensor circuit range/performance', severity: SEVERITY.INFO },
  P0112: { desc: 'IAT sensor circuit low input', severity: SEVERITY.INFO },
  P0113: { desc: 'IAT sensor circuit high input', severity: SEVERITY.INFO },
  P0115: { desc: 'Engine coolant temperature sensor circuit malfunction', severity: SEVERITY.WARNING },
  P0116: { desc: 'ECT sensor circuit range/performance', severity: SEVERITY.WARNING },
  P0117: { desc: 'ECT sensor circuit low input', severity: SEVERITY.WARNING },
  P0118: { desc: 'ECT sensor circuit high input', severity: SEVERITY.WARNING },
  P0120: { desc: 'Throttle position sensor circuit malfunction', severity: SEVERITY.WARNING },
  P0121: { desc: 'TPS circuit range/performance', severity: SEVERITY.WARNING },
  P0122: { desc: 'TPS circuit low input', severity: SEVERITY.WARNING },
  P0123: { desc: 'TPS circuit high input', severity: SEVERITY.WARNING },
  P0125: { desc: 'Insufficient coolant temperature for closed loop', severity: SEVERITY.INFO },
  P0128: { desc: 'Coolant thermostat below regulating temperature', severity: SEVERITY.WARNING },
  P0130: { desc: 'O2 sensor circuit malfunction (Bank 1 Sensor 1)', severity: SEVERITY.WARNING },
  P0131: { desc: 'O2 sensor circuit low voltage (B1S1)', severity: SEVERITY.WARNING },
  P0132: { desc: 'O2 sensor circuit high voltage (B1S1)', severity: SEVERITY.WARNING },
  P0133: { desc: 'O2 sensor circuit slow response (B1S1)', severity: SEVERITY.WARNING },
  P0134: { desc: 'O2 sensor circuit no activity detected (B1S1)', severity: SEVERITY.WARNING },
  P0135: { desc: 'O2 sensor heater circuit malfunction (B1S1)', severity: SEVERITY.WARNING },
  P0136: { desc: 'O2 sensor circuit malfunction (Bank 1 Sensor 2)', severity: SEVERITY.WARNING },
  P0137: { desc: 'O2 sensor circuit low voltage (B1S2)', severity: SEVERITY.WARNING },
  P0138: { desc: 'O2 sensor circuit high voltage (B1S2)', severity: SEVERITY.WARNING },
  P0139: { desc: 'O2 sensor circuit slow response (B1S2)', severity: SEVERITY.WARNING },
  P0140: { desc: 'O2 sensor circuit no activity detected (B1S2)', severity: SEVERITY.WARNING },
  P0141: { desc: 'O2 sensor heater circuit malfunction (B1S2)', severity: SEVERITY.WARNING },

  // Fuel system
  P0170: { desc: 'Fuel trim malfunction (Bank 1)', severity: SEVERITY.WARNING },
  P0171: { desc: 'System too lean (Bank 1)', severity: SEVERITY.WARNING },
  P0172: { desc: 'System too rich (Bank 1)', severity: SEVERITY.WARNING },
  P0174: { desc: 'System too lean (Bank 2)', severity: SEVERITY.WARNING },
  P0175: { desc: 'System too rich (Bank 2)', severity: SEVERITY.WARNING },

  // Ignition system / misfire
  P0300: { desc: 'Random/multiple cylinder misfire detected', severity: SEVERITY.CRITICAL },
  P0301: { desc: 'Cylinder 1 misfire detected', severity: SEVERITY.CRITICAL },
  P0302: { desc: 'Cylinder 2 misfire detected', severity: SEVERITY.CRITICAL },
  P0303: { desc: 'Cylinder 3 misfire detected', severity: SEVERITY.CRITICAL },
  P0304: { desc: 'Cylinder 4 misfire detected', severity: SEVERITY.CRITICAL },
  P0305: { desc: 'Cylinder 5 misfire detected', severity: SEVERITY.CRITICAL },
  P0306: { desc: 'Cylinder 6 misfire detected', severity: SEVERITY.CRITICAL },
  P0313: { desc: 'Misfire detected with low fuel', severity: SEVERITY.CRITICAL },
  P0316: { desc: 'Misfire detected on startup (first 1000 revolutions)', severity: SEVERITY.WARNING },
  P0325: { desc: 'Knock sensor 1 circuit malfunction', severity: SEVERITY.WARNING },
  P0326: { desc: 'Knock sensor 1 circuit range/performance', severity: SEVERITY.WARNING },
  P0327: { desc: 'Knock sensor 1 circuit low input', severity: SEVERITY.WARNING },
  P0328: { desc: 'Knock sensor 1 circuit high input', severity: SEVERITY.WARNING },
  P0335: { desc: 'Crankshaft position sensor circuit malfunction', severity: SEVERITY.CRITICAL },
  P0336: { desc: 'Crankshaft position sensor circuit range/performance', severity: SEVERITY.CRITICAL },
  P0340: { desc: 'Camshaft position sensor circuit malfunction', severity: SEVERITY.CRITICAL },
  P0341: { desc: 'Camshaft position sensor circuit range/performance', severity: SEVERITY.WARNING },
  P0342: { desc: 'Camshaft position sensor circuit low input', severity: SEVERITY.WARNING },
  P0343: { desc: 'Camshaft position sensor circuit high input', severity: SEVERITY.WARNING },

  // Emission controls
  P0400: { desc: 'EGR flow malfunction', severity: SEVERITY.WARNING },
  P0401: { desc: 'EGR insufficient flow detected', severity: SEVERITY.WARNING },
  P0402: { desc: 'EGR excessive flow detected', severity: SEVERITY.WARNING },
  P0410: { desc: 'Secondary air injection system malfunction', severity: SEVERITY.WARNING },
  P0411: { desc: 'Secondary air injection system incorrect flow', severity: SEVERITY.WARNING },
  P0420: { desc: 'Catalyst system efficiency below threshold (Bank 1)', severity: SEVERITY.WARNING },
  P0430: { desc: 'Catalyst system efficiency below threshold (Bank 2)', severity: SEVERITY.WARNING },
  P0440: { desc: 'EVAP emission control system malfunction', severity: SEVERITY.INFO },
  P0441: { desc: 'EVAP system incorrect purge flow', severity: SEVERITY.INFO },
  P0442: { desc: 'EVAP system leak detected (small leak)', severity: SEVERITY.INFO },
  P0443: { desc: 'EVAP purge control valve circuit malfunction', severity: SEVERITY.INFO },
  P0446: { desc: 'EVAP vent control circuit malfunction', severity: SEVERITY.INFO },
  P0450: { desc: 'EVAP pressure sensor malfunction', severity: SEVERITY.INFO },
  P0452: { desc: 'EVAP pressure sensor low input', severity: SEVERITY.INFO },
  P0453: { desc: 'EVAP pressure sensor high input', severity: SEVERITY.INFO },
  P0455: { desc: 'EVAP system leak detected (large leak)', severity: SEVERITY.WARNING },
  P0456: { desc: 'EVAP system leak detected (very small leak)', severity: SEVERITY.INFO },

  // Vehicle speed / idle control
  P0500: { desc: 'Vehicle speed sensor malfunction', severity: SEVERITY.WARNING },
  P0501: { desc: 'Vehicle speed sensor range/performance', severity: SEVERITY.WARNING },
  P0505: { desc: 'Idle control system malfunction', severity: SEVERITY.WARNING },
  P0506: { desc: 'Idle control system RPM lower than expected', severity: SEVERITY.INFO },
  P0507: { desc: 'Idle control system RPM higher than expected', severity: SEVERITY.INFO },

  // Transmission
  P0700: { desc: 'Transmission control system malfunction', severity: SEVERITY.WARNING },
  P0710: { desc: 'Transmission fluid temperature sensor malfunction', severity: SEVERITY.WARNING },
  P0715: { desc: 'Input/turbine speed sensor circuit malfunction', severity: SEVERITY.WARNING },
  P0720: { desc: 'Output speed sensor circuit malfunction', severity: SEVERITY.WARNING },
  P0730: { desc: 'Incorrect gear ratio', severity: SEVERITY.WARNING },
  P0740: { desc: 'Torque converter clutch circuit malfunction', severity: SEVERITY.WARNING },
  P0750: { desc: 'Shift solenoid A malfunction', severity: SEVERITY.WARNING },
  P0755: { desc: 'Shift solenoid B malfunction', severity: SEVERITY.WARNING },

  // Powertrain / general
  P0560: { desc: 'System voltage malfunction', severity: SEVERITY.WARNING },
  P0562: { desc: 'System voltage low', severity: SEVERITY.WARNING },
  P0563: { desc: 'System voltage high', severity: SEVERITY.WARNING },
  P0600: { desc: 'Serial communication link malfunction', severity: SEVERITY.WARNING },
  P0601: { desc: 'Internal control module memory check sum error', severity: SEVERITY.CRITICAL },
  P0602: { desc: 'Control module programming error', severity: SEVERITY.CRITICAL },

  // Additional common codes
  P0010: { desc: 'Intake camshaft position actuator circuit (Bank 1)', severity: SEVERITY.WARNING },
  P0011: { desc: 'Intake camshaft position timing over-advanced (B1)', severity: SEVERITY.WARNING },
  P0012: { desc: 'Intake camshaft position timing over-retarded (B1)', severity: SEVERITY.WARNING },
  P0013: { desc: 'Exhaust camshaft position actuator circuit (Bank 1)', severity: SEVERITY.WARNING },
  P0014: { desc: 'Exhaust camshaft position timing over-advanced (B1)', severity: SEVERITY.WARNING },
  P0015: { desc: 'Exhaust camshaft position timing over-retarded (B1)', severity: SEVERITY.WARNING },
  P0016: { desc: 'Crankshaft/camshaft position correlation (B1 Sensor A)', severity: SEVERITY.CRITICAL },
  P0017: { desc: 'Crankshaft/camshaft position correlation (B1 Sensor B)', severity: SEVERITY.CRITICAL },
  P0019: { desc: 'Crankshaft/camshaft position correlation (B2 Sensor B)', severity: SEVERITY.CRITICAL },
  P0020: { desc: 'Intake camshaft position actuator circuit (Bank 2)', severity: SEVERITY.WARNING },
  P0021: { desc: 'Intake camshaft position timing over-advanced (B2)', severity: SEVERITY.WARNING },
  P0022: { desc: 'Intake camshaft position timing over-retarded (B2)', severity: SEVERITY.WARNING },

  // Boost / turbo
  P0234: { desc: 'Turbocharger overboost condition', severity: SEVERITY.CRITICAL },
  P0235: { desc: 'Turbocharger boost sensor A circuit malfunction', severity: SEVERITY.WARNING },
  P0236: { desc: 'Turbocharger boost sensor A circuit range/performance', severity: SEVERITY.WARNING },
  P0237: { desc: 'Turbocharger boost sensor A circuit low', severity: SEVERITY.WARNING },
  P0238: { desc: 'Turbocharger boost sensor A circuit high', severity: SEVERITY.WARNING },
  P0243: { desc: 'Turbocharger wastegate solenoid A malfunction', severity: SEVERITY.WARNING },
  P0244: { desc: 'Turbocharger wastegate solenoid A range/performance', severity: SEVERITY.WARNING },
  P0245: { desc: 'Turbocharger wastegate solenoid A low', severity: SEVERITY.WARNING },
  P0246: { desc: 'Turbocharger wastegate solenoid A high', severity: SEVERITY.WARNING },
  P0299: { desc: 'Turbocharger/supercharger underboost', severity: SEVERITY.WARNING },

  // Fuel injectors
  P0201: { desc: 'Injector circuit malfunction — Cylinder 1', severity: SEVERITY.CRITICAL },
  P0202: { desc: 'Injector circuit malfunction — Cylinder 2', severity: SEVERITY.CRITICAL },
  P0203: { desc: 'Injector circuit malfunction — Cylinder 3', severity: SEVERITY.CRITICAL },
  P0204: { desc: 'Injector circuit malfunction — Cylinder 4', severity: SEVERITY.CRITICAL },
  P0261: { desc: 'Cylinder 1 injector circuit low', severity: SEVERITY.WARNING },
  P0262: { desc: 'Cylinder 1 injector circuit high', severity: SEVERITY.WARNING },
  P0264: { desc: 'Cylinder 2 injector circuit low', severity: SEVERITY.WARNING },
  P0265: { desc: 'Cylinder 2 injector circuit high', severity: SEVERITY.WARNING },
  P0267: { desc: 'Cylinder 3 injector circuit low', severity: SEVERITY.WARNING },
  P0268: { desc: 'Cylinder 3 injector circuit high', severity: SEVERITY.WARNING },
  P0270: { desc: 'Cylinder 4 injector circuit low', severity: SEVERITY.WARNING },
  P0271: { desc: 'Cylinder 4 injector circuit high', severity: SEVERITY.WARNING },
};

// --- BMW MINI R56-specific codes ---
const BMW_DTCS = {
  // VANOS (variable valve timing)
  P1014: { desc: 'VANOS exhaust position actuator over-retarded (cold start)', severity: SEVERITY.WARNING },
  P1015: { desc: 'VANOS exhaust camshaft position not reachable', severity: SEVERITY.WARNING },
  P1016: { desc: 'VANOS intake camshaft position deviation', severity: SEVERITY.WARNING },
  P1017: { desc: 'VANOS exhaust camshaft position deviation', severity: SEVERITY.WARNING },
  P1023: { desc: 'VANOS inlet slow response', severity: SEVERITY.WARNING },
  P1024: { desc: 'VANOS exhaust slow response', severity: SEVERITY.WARNING },
  P1025: { desc: 'VANOS inlet position control fault', severity: SEVERITY.WARNING },
  P1026: { desc: 'VANOS exhaust position control fault', severity: SEVERITY.WARNING },
  P1030: { desc: 'Valvetronic eccentric shaft sensor reference malfunction', severity: SEVERITY.CRITICAL },
  P1031: { desc: 'Valvetronic eccentric shaft sensor signal malfunction', severity: SEVERITY.CRITICAL },
  P1032: { desc: 'Valvetronic eccentric shaft position control deviation', severity: SEVERITY.CRITICAL },
  P1033: { desc: 'Valvetronic motor relay circuit malfunction', severity: SEVERITY.CRITICAL },
  P1034: { desc: 'Valvetronic motor overcurrent', severity: SEVERITY.CRITICAL },
  P1035: { desc: 'Valvetronic servo motor position adaptation', severity: SEVERITY.WARNING },

  // Turbo / boost (R56 Cooper S N14/N18)
  P1055: { desc: 'Turbo boost control valve open circuit', severity: SEVERITY.WARNING },
  P1056: { desc: 'Turbo boost control valve short to ground', severity: SEVERITY.WARNING },
  P1057: { desc: 'Turbo boost control valve short to B+', severity: SEVERITY.WARNING },
  P1058: { desc: 'Wastegate stuck closed', severity: SEVERITY.CRITICAL },
  P1059: { desc: 'Wastegate stuck open', severity: SEVERITY.WARNING },

  // Electric water pump (common R56 failure)
  P1060: { desc: 'Electric water pump control circuit', severity: SEVERITY.CRITICAL },
  P1061: { desc: 'Electric water pump circuit low', severity: SEVERITY.CRITICAL },
  P1062: { desc: 'Electric water pump circuit high', severity: SEVERITY.CRITICAL },
  P1063: { desc: 'Electric water pump insufficient performance', severity: SEVERITY.CRITICAL },

  // High-pressure fuel pump (HPFP — notorious R56 Cooper S failure)
  P1073: { desc: 'High pressure fuel system — pressure too low', severity: SEVERITY.CRITICAL },
  P1074: { desc: 'High pressure fuel system — pressure too high', severity: SEVERITY.CRITICAL },
  P1075: { desc: 'High pressure fuel pump mechanical malfunction', severity: SEVERITY.CRITICAL },
  P1076: { desc: 'HPFP volume control valve electrical malfunction', severity: SEVERITY.CRITICAL },

  // Oil condition
  P1080: { desc: 'Engine oil condition sensor signal', severity: SEVERITY.WARNING },
  P1081: { desc: 'Engine oil condition sensor circuit malfunction', severity: SEVERITY.WARNING },
  P1082: { desc: 'Engine oil level too low', severity: SEVERITY.CRITICAL },
  P1083: { desc: 'Engine oil pressure too low', severity: SEVERITY.CRITICAL },

  // Ignition coils
  P1340: { desc: 'Ignition coil 1 secondary circuit malfunction', severity: SEVERITY.CRITICAL },
  P1341: { desc: 'Ignition coil 2 secondary circuit malfunction', severity: SEVERITY.CRITICAL },
  P1342: { desc: 'Ignition coil 3 secondary circuit malfunction', severity: SEVERITY.CRITICAL },
  P1343: { desc: 'Ignition coil 4 secondary circuit malfunction', severity: SEVERITY.CRITICAL },
  P1344: { desc: 'Multiple ignition coil faults detected', severity: SEVERITY.CRITICAL },

  // Timing chain
  P1350: { desc: 'Timing chain stretched — intake camshaft out of range', severity: SEVERITY.CRITICAL },
  P1351: { desc: 'Timing chain stretched — exhaust camshaft out of range', severity: SEVERITY.CRITICAL },
  P1352: { desc: 'Timing chain tensioner control malfunction', severity: SEVERITY.CRITICAL },

  // Carbon build-up / intake
  P1400: { desc: 'Intake manifold runner control stuck closed', severity: SEVERITY.WARNING },
  P1401: { desc: 'Intake manifold runner control stuck open', severity: SEVERITY.WARNING },
  P1402: { desc: 'Intake manifold runner control circuit malfunction', severity: SEVERITY.WARNING },

  // Thermostat (electric on R56)
  P1480: { desc: 'Electric thermostat control circuit malfunction', severity: SEVERITY.WARNING },
  P1481: { desc: 'Electric thermostat stuck closed', severity: SEVERITY.WARNING },
  P1482: { desc: 'Electric thermostat stuck open', severity: SEVERITY.WARNING },

  // DME (Digital Motor Electronics)
  P1500: { desc: 'DME internal fault — watchdog reset', severity: SEVERITY.CRITICAL },
  P1501: { desc: 'DME internal fault — EEPROM malfunction', severity: SEVERITY.CRITICAL },
  P1502: { desc: 'DME internal fault — ROM checksum error', severity: SEVERITY.CRITICAL },

  // Electric power steering
  P1600: { desc: 'Electric power steering — system malfunction', severity: SEVERITY.WARNING },
  P1601: { desc: 'Electric power steering — motor overcurrent', severity: SEVERITY.WARNING },
  P1602: { desc: 'Electric power steering — torque sensor malfunction', severity: SEVERITY.WARNING },

  // P2xxx BMW-specific
  P2096: { desc: 'Post catalyst fuel trim system too lean (B1)', severity: SEVERITY.WARNING },
  P2097: { desc: 'Post catalyst fuel trim system too rich (B1)', severity: SEVERITY.WARNING },
  P2177: { desc: 'System too lean off idle (Bank 1)', severity: SEVERITY.WARNING },
  P2178: { desc: 'System too rich off idle (Bank 1)', severity: SEVERITY.WARNING },
  P2187: { desc: 'System too lean at idle (Bank 1)', severity: SEVERITY.WARNING },
  P2188: { desc: 'System too rich at idle (Bank 1)', severity: SEVERITY.WARNING },
  P2191: { desc: 'System too lean at higher load (Bank 1)', severity: SEVERITY.WARNING },
  P2192: { desc: 'System too rich at higher load (Bank 1)', severity: SEVERITY.WARNING },
  P2270: { desc: 'O2 sensor signal stuck lean (B1S2)', severity: SEVERITY.WARNING },
  P2271: { desc: 'O2 sensor signal biased/stuck rich (B1S2)', severity: SEVERITY.WARNING },

  // High pressure fuel rail
  P2293: { desc: 'Fuel pressure regulator 2 performance', severity: SEVERITY.WARNING },
  P2294: { desc: 'Fuel pressure regulator 2 control circuit', severity: SEVERITY.WARNING },
  P2295: { desc: 'Fuel pressure regulator 2 circuit low', severity: SEVERITY.WARNING },

  // Charge air
  P2261: { desc: 'Turbo bypass valve — mechanical fault', severity: SEVERITY.WARNING },
  P2262: { desc: 'Turbo boost pressure not detected — mechanical fault', severity: SEVERITY.CRITICAL },
  P2263: { desc: 'Turbo boost system performance', severity: SEVERITY.WARNING },
  P2264: { desc: 'Water in fuel sensor circuit', severity: SEVERITY.WARNING },

  // Timing / VANOS extended
  P2610: { desc: 'ECM/PCM internal engine off timer performance', severity: SEVERITY.INFO },
  P2611: { desc: 'Intake valve control solenoid circuit (B1)', severity: SEVERITY.WARNING },

  // N14/N18 specific
  P2BAE: { desc: 'NOx sensor circuit (B1) — voltage below expected', severity: SEVERITY.WARNING },
  P2BAF: { desc: 'NOx sensor circuit (B1) — voltage above expected', severity: SEVERITY.WARNING },
};

// Merged database
const DTC_DATABASE = { ...GENERIC_DTCS, ...BMW_DTCS };

/**
 * Look up a DTC code.
 * @param {string} code - e.g. "P0300"
 * @returns {{ code, desc, severity } | null}
 */
export function lookupDTC(code) {
  const normalised = code.toUpperCase().trim();
  const entry = DTC_DATABASE[normalised];
  if (!entry) return { code: normalised, desc: 'Unknown fault code', severity: SEVERITY.INFO };
  return { code: normalised, ...entry };
}

/**
 * Decode raw DTC bytes from Mode 03/07/0A response.
 *
 * Each DTC is encoded as 2 bytes:
 *   High nibble of byte 1 → first character (P/C/B/U)
 *   Remaining nibbles → 4 hex digits
 *
 * E.g. bytes [0x01, 0x33] → P0133
 */
export function decodeDTCBytes(dataBytes) {
  const codes = [];
  const TYPE_MAP = { 0: 'P', 1: 'C', 2: 'B', 3: 'U' };

  for (let i = 0; i < dataBytes.length - 1; i += 2) {
    const b1 = dataBytes[i];
    const b2 = dataBytes[i + 1];
    if (b1 === 0 && b2 === 0) continue; // padding

    const typeIdx = (b1 >> 6) & 0x03;
    const prefix = TYPE_MAP[typeIdx] || 'P';
    const digit1 = (b1 >> 4) & 0x03;
    const digit2 = b1 & 0x0F;
    const digit3 = (b2 >> 4) & 0x0F;
    const digit4 = b2 & 0x0F;

    const code = `${prefix}${digit1}${digit2.toString(16).toUpperCase()}${digit3.toString(16).toUpperCase()}${digit4.toString(16).toUpperCase()}`;
    codes.push(lookupDTC(code));
  }

  return codes;
}

/**
 * Parse a raw Mode 03/07/0A response string into DTCs.
 * Strips the mode echo byte.
 * E.g. "43 01 33 02 00 00 00" → [{ code: 'P0133', ... }]
 */
export function parseDTCResponse(response) {
  const parts = response.trim().split(/\s+/);
  if (parts.length < 2) return [];

  // First byte is mode echo (43, 47, or 4A), second is DTC count
  const dataBytes = parts.slice(2).map((h) => parseInt(h, 16)).filter((n) => !isNaN(n));
  return decodeDTCBytes(dataBytes);
}

/** Total number of known DTCs. */
export function getDatabaseSize() {
  return Object.keys(DTC_DATABASE).length;
}
