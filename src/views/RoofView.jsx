import React, { useState } from 'react';
import { Card, Badge, InfoRow, COLORS } from '../components/shared.jsx';
import { ROOF_CODES, ROOF_CCID_CODES, ROOF_FAILURE_POINTS, lookupRoofCode, lookupCCID } from '../obd/roof-codes.js';

export default function RoofView({ vinData }) {
  const [searchCode, setSearchCode] = useState('');
  const [searchResult, setSearchResult] = useState(null);
  const [activeSection, setActiveSection] = useState('lookup'); // lookup | failures | ccid

  const handleSearch = () => {
    const code = searchCode.trim().toUpperCase();
    if (!code) return;

    // Try CVM hex code first
    const roofResult = lookupRoofCode(code);
    if (roofResult) {
      setSearchResult({ type: 'roof', code, ...roofResult });
      return;
    }

    // Try CC-ID
    const ccidResult = lookupCCID(code);
    if (ccidResult) {
      setSearchResult({ type: 'ccid', code, ...ccidResult });
      return;
    }

    setSearchResult({ type: 'unknown', code, desc: 'Code not found in roof database' });
  };

  const isR57 = vinData?.isR57;
  const severityColor = { info: COLORS.accent, warning: COLORS.warn, critical: COLORS.fault };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', paddingTop: '8px' }}>
      {/* R57 detection banner */}
      <Card style={{ borderColor: isR57 ? `${COLORS.ok}40` : `${COLORS.accent}30` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: '24px' }}>{isR57 ? '✅' : 'ℹ️'}</span>
          <div>
            <div style={{ fontSize: '14px', fontWeight: 600, color: isR57 ? COLORS.ok : COLORS.text }}>
              {isR57 ? 'R57 Convertible Detected' : 'Roof Diagnostics Reference'}
            </div>
            <div style={{ fontSize: '11px', color: COLORS.textDim, marginTop: '2px' }}>
              {isR57
                ? 'Your MINI has a convertible roof system with CVM module.'
                : vinData?.valid
                  ? `Your vehicle is a ${vinData.chassis || 'MINI'} — roof codes still available as reference.`
                  : 'Read your VIN on the Vehicle tab to auto-detect R57.'
              }
            </div>
          </div>
        </div>
      </Card>

      {/* Important notice */}
      <Card style={{ borderColor: `${COLORS.warn}30` }}>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
          <span style={{ fontSize: '16px', flexShrink: 0 }}>⚠️</span>
          <div>
            <div style={{ fontSize: '12px', fontWeight: 600, color: COLORS.warn, marginBottom: '4px' }}>
              BMW-Specific Codes
            </div>
            <div style={{ fontSize: '11px', color: COLORS.textDim, lineHeight: 1.4 }}>
              Roof fault codes (A68x–A6Ax) are stored in the CVM module on the body CAN bus,
              not accessible via standard OBD-II. Use this as a lookup reference for codes
              from BimmerLink, Carly, or ISTA.
            </div>
          </div>
        </div>
      </Card>

      {/* Section tabs */}
      <div style={{ display: 'flex', gap: '6px' }}>
        {[
          { key: 'lookup', label: 'Code Lookup' },
          { key: 'failures', label: 'Common Failures' },
          { key: 'ccid', label: 'Dashboard Warnings' },
        ].map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setActiveSection(key)}
            style={{
              flex: 1, padding: '8px 4px', borderRadius: '8px', border: 'none',
              background: activeSection === key ? COLORS.accent : '#1e293b',
              color: activeSection === key ? '#fff' : COLORS.textDim,
              fontSize: '11px', fontWeight: 600, cursor: 'pointer',
              transition: 'all 0.2s',
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Code lookup */}
      {activeSection === 'lookup' && (
        <>
          <Card>
            <label style={{ fontSize: '12px', color: COLORS.textDim, fontWeight: 600, marginBottom: '8px', display: 'block' }}>
              Enter BMW Hex Code or CC-ID
            </label>
            <div style={{ display: 'flex', gap: '8px' }}>
              <input
                type="text"
                value={searchCode}
                onChange={(e) => setSearchCode(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                placeholder="e.g. A692 or 270"
                style={{
                  flex: 1, padding: '10px 12px', borderRadius: '10px',
                  background: '#1e293b', color: COLORS.text,
                  border: `1px solid ${COLORS.bgCardBorder}`,
                  fontSize: '14px', fontFamily: 'monospace', outline: 'none',
                }}
              />
              <button
                onClick={handleSearch}
                style={{
                  padding: '10px 16px', borderRadius: '10px',
                  background: COLORS.accent, color: '#fff', border: 'none',
                  fontSize: '13px', fontWeight: 600, cursor: 'pointer',
                }}
              >
                Look Up
              </button>
            </div>
          </Card>

          {searchResult && (
            <Card style={{ borderColor: `${severityColor[searchResult.severity] || COLORS.accent}40` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <span style={{ fontSize: '18px', fontWeight: 700, fontFamily: 'monospace', color: COLORS.text }}>
                  {searchResult.type === 'ccid' ? `CC-ID ${searchResult.code}` : searchResult.code}
                </span>
                {searchResult.severity && (
                  <Badge
                    label={searchResult.severity}
                    variant={searchResult.severity === 'critical' ? 'fault' : searchResult.severity === 'warning' ? 'warn' : 'info'}
                  />
                )}
              </div>
              <p style={{ fontSize: '13px', color: COLORS.text, margin: '0 0 8px', fontWeight: 500 }}>
                {searchResult.desc}
              </p>
              {searchResult.component && (
                <InfoRow label="Component" value={searchResult.component} />
              )}
              {searchResult.cause && (
                <InfoRow label="Common Cause" value={searchResult.cause} />
              )}
              {searchResult.fix && (
                <div style={{ marginTop: '8px', padding: '8px 10px', borderRadius: '8px', background: `${COLORS.ok}10` }}>
                  <span style={{ fontSize: '11px', color: COLORS.ok, fontWeight: 600 }}>Fix: </span>
                  <span style={{ fontSize: '11px', color: COLORS.textDim }}>{searchResult.fix}</span>
                </div>
              )}
              {searchResult.type === 'unknown' && (
                <p style={{ fontSize: '11px', color: COLORS.textMuted, marginTop: '6px' }}>
                  Try the DTCs tab for standard OBD-II P-codes.
                </p>
              )}
            </Card>
          )}

          {/* All CVM codes reference */}
          <Card>
            <p style={{ fontSize: '12px', color: COLORS.textDim, fontWeight: 600, marginBottom: '10px' }}>
              All CVM Fault Codes ({Object.keys(ROOF_CODES).length})
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {Object.entries(ROOF_CODES).map(([code, info]) => (
                <button
                  key={code}
                  onClick={() => { setSearchCode(code); setSearchResult({ type: 'roof', code, ...info }); }}
                  style={{
                    padding: '8px 10px', borderRadius: '8px', border: 'none',
                    background: `${severityColor[info.severity]}08`,
                    borderLeft: `3px solid ${severityColor[info.severity]}`,
                    cursor: 'pointer', textAlign: 'left',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  }}
                >
                  <div>
                    <span style={{ fontSize: '12px', fontWeight: 700, fontFamily: 'monospace', color: COLORS.text }}>
                      {code}
                    </span>
                    <span style={{ fontSize: '11px', color: COLORS.textDim, marginLeft: '8px' }}>
                      {info.desc}
                    </span>
                  </div>
                  <span style={{
                    width: '6px', height: '6px', borderRadius: '50%',
                    background: severityColor[info.severity], flexShrink: 0,
                  }} />
                </button>
              ))}
            </div>
          </Card>
        </>
      )}

      {/* Common failures */}
      {activeSection === 'failures' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {ROOF_FAILURE_POINTS.map((fp, i) => (
            <Card key={i}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                <span style={{ fontSize: '13px', fontWeight: 700, color: COLORS.text }}>{fp.component}</span>
                <Badge label={fp.frequency} variant={fp.frequency === 'Very common' ? 'fault' : fp.frequency === 'Common' || fp.frequency === 'Common (age-related)' ? 'warn' : 'info'} />
              </div>
              <p style={{ fontSize: '12px', color: COLORS.textDim, margin: '0 0 8px', lineHeight: 1.4 }}>
                {fp.description}
              </p>
              <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                {fp.codes.map((code) => (
                  <span key={code} style={{
                    padding: '2px 8px', borderRadius: '4px', fontSize: '11px',
                    fontFamily: 'monospace', fontWeight: 600,
                    background: `${COLORS.accent}15`, color: COLORS.accent,
                  }}>
                    {code}
                  </span>
                ))}
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* CC-ID dashboard warnings */}
      {activeSection === 'ccid' && (
        <Card>
          <p style={{ fontSize: '12px', color: COLORS.textDim, fontWeight: 600, marginBottom: '10px' }}>
            Dashboard Warning Codes ({Object.keys(ROOF_CCID_CODES).length})
          </p>
          <p style={{ fontSize: '11px', color: COLORS.textMuted, marginBottom: '10px', lineHeight: 1.3 }}>
            CC-ID codes appear as dashboard warning messages. Note the number shown on your dashboard.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {Object.entries(ROOF_CCID_CODES).map(([ccid, info]) => (
              <div
                key={ccid}
                style={{
                  padding: '8px 10px', borderRadius: '8px',
                  background: `${severityColor[info.severity]}08`,
                  borderLeft: `3px solid ${severityColor[info.severity]}`,
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                }}
              >
                <div>
                  <span style={{ fontSize: '13px', fontWeight: 700, fontFamily: 'monospace', color: COLORS.text }}>
                    {ccid}
                  </span>
                  <span style={{ fontSize: '11px', color: COLORS.textDim, marginLeft: '8px' }}>
                    {info.desc}
                  </span>
                </div>
                <span style={{
                  width: '6px', height: '6px', borderRadius: '50%',
                  background: severityColor[info.severity], flexShrink: 0,
                }} />
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Tools recommendation */}
      <Card>
        <p style={{ fontSize: '12px', color: COLORS.textDim, fontWeight: 600, marginBottom: '8px' }}>
          Tools for Reading CVM Codes
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <InfoRow label="BimmerLink" value="App — reads all ECU modules" />
          <InfoRow label="Carly for BMW" value="App — body module support" />
          <InfoRow label="BMW ISTA-D" value="Dealer software + DCAN cable" />
          <InfoRow label="INPA/EDIABAS" value="Free BMW diag + K+DCAN cable" />
        </div>
      </Card>
    </div>
  );
}
