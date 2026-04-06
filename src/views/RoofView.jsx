import React, { useState } from 'react';
import { Card, Badge, InfoRow, ProgressCard, Pulse, COLORS } from '../components/shared.jsx';
import { ROOF_CODES, ROOF_CCID_CODES, ROOF_FAILURE_POINTS, lookupRoofCode, lookupCCID } from '../obd/roof-codes.js';
import { CVM_SWITCHES, SWITCH_GROUP, GROUP_LABELS, getSwitch } from '../obd/cvm-status.js';

// --- Switch indicator dot ---
function SwitchDot({ state, hasFault, transitioning }) {
  if (state === null || state === undefined) {
    return <span style={{ fontSize: '14px', color: COLORS.textMuted }}>?</span>;
  }
  if (hasFault) {
    return <span style={{ width: 10, height: 10, borderRadius: '50%', background: COLORS.fault, display: 'inline-block', animation: 'pulse 1.5s infinite' }} />;
  }
  if (transitioning) {
    return <span style={{ width: 10, height: 10, borderRadius: '50%', background: COLORS.warn, display: 'inline-block', animation: 'pulse 0.8s infinite' }} />;
  }
  return (
    <span style={{
      width: 10, height: 10, borderRadius: '50%', display: 'inline-block',
      background: state ? COLORS.ok : 'transparent',
      border: state ? 'none' : `2px solid ${COLORS.textMuted}`,
      boxSizing: 'border-box',
    }} />
  );
}

// --- Switch row ---
function SwitchRow({ sw, value, activeDTCs, expanded, onToggle }) {
  const hasFault = sw.faultCode && activeDTCs?.some(d => d.code === sw.faultCode && d.active);
  const stateLabel = value === null || value === undefined
    ? 'UNKNOWN'
    : sw.isAnalog
      ? `${value}%`
      : value ? (sw.closedMeaning?.split(' ')[0] || 'CLOSED') : (sw.openMeaning?.split(' ')[0] || 'OPEN');

  return (
    <div>
      <div
        onClick={onToggle}
        style={{
          display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 0',
          cursor: 'pointer', userSelect: 'none',
        }}
      >
        {sw.isAnalog ? (
          <div style={{ width: 60, height: 8, borderRadius: 4, background: '#1e293b', overflow: 'hidden', flexShrink: 0 }}>
            <div style={{ width: `${Math.min(100, value || 0)}%`, height: '100%', background: COLORS.accent, borderRadius: 4, transition: 'width 0.3s' }} />
          </div>
        ) : (
          <SwitchDot state={value} hasFault={hasFault} />
        )}
        <span style={{ fontSize: '12px', fontWeight: 600, color: COLORS.text, flex: 1 }}>{sw.label}</span>
        <span style={{ fontSize: '11px', color: value ? COLORS.ok : COLORS.textDim, fontFamily: 'monospace', fontWeight: 600 }}>
          {stateLabel}
        </span>
        {hasFault && (
          <span style={{ fontSize: '9px', padding: '1px 5px', borderRadius: 4, background: `${COLORS.fault}20`, color: COLORS.fault, fontWeight: 700 }}>
            {sw.faultCode}
          </span>
        )}
      </div>
      {expanded && (
        <div style={{ paddingLeft: 18, paddingBottom: 6 }}>
          <div style={{ fontSize: '10px', color: COLORS.textMuted, lineHeight: 1.4 }}>
            <div>{sw.location}</div>
            {!sw.isAnalog && <div>Closed = {sw.closedMeaning} | Open = {sw.openMeaning}</div>}
            {sw.faultCode && <div>Fault code: {sw.faultCode}</div>}
          </div>
        </div>
      )}
    </div>
  );
}

// --- Switch group card ---
function SwitchGroupCard({ groupKey, switches, switchStates, analogValues, activeDTCs, expandedId, setExpandedId }) {
  return (
    <Card>
      <div style={{ fontSize: '11px', fontWeight: 700, color: COLORS.textDim, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '6px' }}>
        {GROUP_LABELS[groupKey]}
      </div>
      {switches.map(sw => {
        const value = sw.isAnalog
          ? (analogValues?.[sw.id === 'pillarAngle' ? 'pillarAngle' : sw.id] ?? null)
          : (switchStates?.[sw.id] ?? null);
        return (
          <SwitchRow
            key={sw.id}
            sw={sw}
            value={value}
            activeDTCs={activeDTCs}
            expanded={expandedId === sw.id}
            onToggle={() => setExpandedId(expandedId === sw.id ? null : sw.id)}
          />
        );
      })}
    </Card>
  );
}

export default function RoofView({
  vinData, connected, cvmDTCs, readingCVM, cvmScanAttempted, cvmReachable, cvmScanSteps, onScanCVM,
  cvmLiveStatus, cvmMonitoring, cvmProbing, cvmProbeProgress, cvmProbeResults, cvmDiscoveredDids,
  onProbeCVM, onStartMonitoring, onStopMonitoring, isDemo,
}) {
  const [searchCode, setSearchCode] = useState('');
  const [searchResult, setSearchResult] = useState(null);
  const [activeSection, setActiveSection] = useState('lookup'); // lookup | failures | ccid
  const [expandedSwitch, setExpandedSwitch] = useState(null);

  const handleSearch = () => {
    const code = searchCode.trim().toUpperCase();
    if (!code) return;

    const roofResult = lookupRoofCode(code);
    if (roofResult) {
      setSearchResult({ type: 'roof', code, ...roofResult });
      return;
    }

    const ccidResult = lookupCCID(code);
    if (ccidResult) {
      setSearchResult({ type: 'ccid', code, ...ccidResult });
      return;
    }

    setSearchResult({ type: 'unknown', code, desc: 'Code not found in roof database' });
  };

  const isR57 = vinData?.isR57;
  const severityColor = { info: COLORS.accent, warning: COLORS.warn, critical: COLORS.fault };
  const hasFaults = cvmDTCs && cvmDTCs.length > 0;
  const canProbe = connected && cvmReachable && cvmScanAttempted && !cvmProbing && !readingCVM;
  const canMonitor = cvmDiscoveredDids && cvmDiscoveredDids.length > 0 && connected;
  const staleSec = cvmLiveStatus?.timestamp ? Math.round((Date.now() - cvmLiveStatus.timestamp) / 1000) : null;

  // Group switches for display
  const switchGroups = {};
  for (const sw of CVM_SWITCHES) {
    if (!switchGroups[sw.group]) switchGroups[sw.group] = [];
    switchGroups[sw.group].push(sw);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', paddingTop: '8px' }}>

      {/* ========== LIVE SWITCH STATUS ========== */}
      {(cvmMonitoring || cvmLiveStatus) && (
        <>
          <Card style={{ borderColor: `${COLORS.accent}40` }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '14px', fontWeight: 700, color: COLORS.text }}>Roof Switch Status</span>
                {cvmMonitoring && <Pulse color={COLORS.ok} size={8} />}
                {cvmMonitoring && <span style={{ fontSize: '10px', color: COLORS.ok, fontWeight: 600 }}>LIVE</span>}
              </div>
              {staleSec !== null && (
                <span style={{ fontSize: '10px', color: staleSec > 5 ? COLORS.warn : COLORS.textMuted }}>
                  {staleSec > 5 ? `Stale (${staleSec}s ago)` : `${staleSec}s ago`}
                </span>
              )}
            </div>

            {/* Roof phase */}
            {cvmLiveStatus?.phase && (
              <div style={{
                padding: '6px 10px', borderRadius: '8px', marginBottom: '8px',
                background: `${COLORS.accent}10`, borderLeft: `3px solid ${COLORS.accent}`,
              }}>
                <span style={{ fontSize: '11px', color: COLORS.textDim, fontWeight: 600 }}>Phase: </span>
                <span style={{ fontSize: '12px', color: COLORS.text, fontWeight: 700 }}>
                  {cvmLiveStatus.phase.label}
                </span>
                {cvmLiveStatus.phase.confidence < 0.8 && (
                  <span style={{ fontSize: '10px', color: COLORS.warn, marginLeft: '6px' }}>
                    ({Math.round(cvmLiveStatus.phase.confidence * 100)}% match)
                  </span>
                )}
              </div>
            )}

            {/* Monitoring controls */}
            <div style={{ display: 'flex', gap: '8px' }}>
              {!cvmMonitoring ? (
                <button
                  onClick={onStartMonitoring}
                  disabled={!canMonitor}
                  style={{
                    flex: 1, padding: '8px', borderRadius: '8px', border: 'none',
                    background: canMonitor ? COLORS.ok : '#334155', color: '#fff',
                    fontSize: '12px', fontWeight: 600, cursor: canMonitor ? 'pointer' : 'default',
                    opacity: canMonitor ? 1 : 0.5,
                  }}
                >
                  Start Monitoring
                </button>
              ) : (
                <button
                  onClick={onStopMonitoring}
                  style={{
                    flex: 1, padding: '8px', borderRadius: '8px', border: 'none',
                    background: COLORS.fault, color: '#fff',
                    fontSize: '12px', fontWeight: 600, cursor: 'pointer',
                  }}
                >
                  Stop Monitoring
                </button>
              )}
            </div>
          </Card>

          {/* Switch groups */}
          {cvmLiveStatus && Object.entries(switchGroups).map(([groupKey, switches]) => (
            <SwitchGroupCard
              key={groupKey}
              groupKey={groupKey}
              switches={switches}
              switchStates={cvmLiveStatus.switches}
              analogValues={cvmLiveStatus.analogValues}
              activeDTCs={cvmDTCs}
              expandedId={expandedSwitch}
              setExpandedId={setExpandedSwitch}
            />
          ))}

          {/* Raw hex display */}
          {cvmLiveStatus?.raw && cvmLiveStatus.raw !== 'DEMO' && (
            <Card>
              <div style={{ fontSize: '10px', color: COLORS.textMuted, fontWeight: 600, marginBottom: '4px' }}>Raw Response</div>
              <div style={{ fontSize: '11px', fontFamily: 'monospace', color: COLORS.textDim, wordBreak: 'break-all' }}>
                {cvmLiveStatus.raw}
              </div>
            </Card>
          )}
        </>
      )}

      {/* ========== R57 DETECTION BANNER ========== */}
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

      {/* ========== CVM PROBE SECTION ========== */}
      {cvmScanAttempted && cvmReachable && (
        <Card>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontSize: '13px', fontWeight: 600, color: COLORS.text }}>CVM Live Diagnostics</div>
              <div style={{ fontSize: '11px', color: COLORS.textDim, marginTop: '2px' }}>
                {cvmProbeResults
                  ? cvmProbeResults.service22
                    ? `${cvmProbeResults.supported.length} status DID${cvmProbeResults.supported.length !== 1 ? 's' : ''} found`
                    : 'UDS 0x22 not supported by this CVM'
                  : 'Probe CVM to discover live data capabilities'
                }
              </div>
            </div>
            <button
              onClick={onProbeCVM}
              disabled={!canProbe}
              style={{
                padding: '10px 18px', borderRadius: '10px', border: 'none',
                background: cvmProbing ? `${COLORS.accent}40` : canProbe ? COLORS.accent : '#334155',
                color: '#fff', fontSize: '13px', fontWeight: 600, cursor: canProbe ? 'pointer' : 'default',
                opacity: canProbe ? 1 : 0.5, transition: 'all 0.2s',
              }}
            >
              {cvmProbing ? 'Probing...' : cvmProbeResults ? 'Re-probe' : 'Probe CVM'}
            </button>
          </div>

          {/* Probe progress */}
          {cvmProbing && cvmProbeProgress && (
            <div style={{ marginTop: '10px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: COLORS.textDim, marginBottom: '4px' }}>
                <span>DID 0x{cvmProbeProgress.current?.did?.toString(16).toUpperCase().padStart(4, '0')}</span>
                <span>{cvmProbeProgress.index}/{cvmProbeProgress.total}</span>
              </div>
              <div style={{ height: 4, borderRadius: 2, background: '#1e293b', overflow: 'hidden' }}>
                <div style={{
                  width: `${(cvmProbeProgress.index / cvmProbeProgress.total) * 100}%`,
                  height: '100%', background: COLORS.accent, borderRadius: 2, transition: 'width 0.2s',
                }} />
              </div>
              <div style={{ fontSize: '10px', color: cvmProbeProgress.current?.ok ? COLORS.ok : COLORS.textMuted, marginTop: '4px' }}>
                {cvmProbeProgress.current?.ok
                  ? `Supported! (${cvmProbeProgress.current.data?.length || '?'} bytes)`
                  : cvmProbeProgress.current?.nrcDesc || cvmProbeProgress.current?.error || 'Not supported'
                }
              </div>
            </div>
          )}

          {/* Probe results */}
          {cvmProbeResults && cvmProbeResults.supported.length > 0 && (
            <div style={{ marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {cvmProbeResults.supported.map(d => (
                <div key={d.did} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 8px', borderRadius: '6px', background: `${COLORS.ok}08` }}>
                  <span style={{ fontSize: '11px', fontFamily: 'monospace', color: COLORS.ok, fontWeight: 600 }}>
                    0x{d.did.toString(16).toUpperCase().padStart(4, '0')}
                  </span>
                  <span style={{ fontSize: '10px', color: COLORS.textDim }}>{d.name} ({d.data?.length || 0}B)</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {/* ========== SCAN BUTTON ========== */}
      <Card>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: '13px', fontWeight: 600, color: COLORS.text }}>CVM Fault Scan</div>
            <div style={{ fontSize: '11px', color: COLORS.textDim, marginTop: '2px' }}>
              Read fault codes directly from the roof module
            </div>
          </div>
          <button
            onClick={onScanCVM}
            disabled={!connected || readingCVM}
            style={{
              padding: '10px 18px', borderRadius: '10px', border: 'none',
              background: readingCVM ? `${COLORS.accent}40` : connected ? COLORS.accent : '#334155',
              color: '#fff', fontSize: '13px', fontWeight: 600, cursor: connected && !readingCVM ? 'pointer' : 'default',
              opacity: connected ? 1 : 0.5, transition: 'all 0.2s',
            }}
          >
            {readingCVM ? 'Scanning...' : cvmScanAttempted ? 'Scan Again' : 'Scan Roof Module'}
          </button>
        </div>
        {!connected && (
          <div style={{ fontSize: '11px', color: COLORS.textMuted, marginTop: '8px' }}>
            Connect to your OBD adapter first.
          </div>
        )}
      </Card>

      {/* CVM scan progress */}
      {readingCVM && cvmScanSteps.length > 0 && (
        <ProgressCard steps={cvmScanSteps} />
      )}

      {/* Scan result summary */}
      {cvmScanAttempted && !readingCVM && cvmReachable && (
        <Card style={{ borderColor: hasFaults ? `${COLORS.fault}40` : `${COLORS.ok}40` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '24px' }}>{hasFaults ? '🔴' : '🟢'}</span>
            <div>
              <div style={{ fontSize: '14px', fontWeight: 700, color: hasFaults ? COLORS.fault : COLORS.ok }}>
                {hasFaults ? `${cvmDTCs.length} Roof Fault${cvmDTCs.length > 1 ? 's' : ''} Found` : 'No Roof Faults'}
              </div>
              <div style={{ fontSize: '11px', color: COLORS.textDim, marginTop: '2px' }}>
                {hasFaults ? 'Active faults detected in CVM module' : 'CVM module reports no stored fault codes'}
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* CVM not reachable notice */}
      {cvmScanAttempted && !readingCVM && !cvmReachable && (
        <Card style={{ borderColor: `${COLORS.warn}30` }}>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
            <span style={{ fontSize: '16px', flexShrink: 0 }}>⚠️</span>
            <div>
              <div style={{ fontSize: '12px', fontWeight: 600, color: COLORS.warn, marginBottom: '4px' }}>
                CVM Module Not Reachable
              </div>
              <div style={{ fontSize: '11px', color: COLORS.textDim, lineHeight: 1.4, marginBottom: '8px' }}>
                Your adapter responded but the CVM roof module did not. This is common with
                basic ELM327 adapters that only support standard OBD-II and cannot address
                body-bus modules. The reference lookup below is still fully functional.
              </div>
              <div style={{ fontSize: '11px', color: COLORS.textDim, lineHeight: 1.4 }}>
                For direct CVM scanning, try BimmerLink, Carly for BMW, or a DCAN cable with ISTA.
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* Active scan results — each fault as a card */}
      {cvmScanAttempted && !readingCVM && cvmReachable && hasFaults && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {cvmDTCs.map((dtc, i) => (
            <Card key={i} style={{ borderColor: `${severityColor[dtc.severity] || COLORS.accent}40` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '16px', fontWeight: 700, fontFamily: 'monospace', color: COLORS.text }}>
                    {dtc.code}
                  </span>
                  {dtc.active && (
                    <span style={{
                      padding: '2px 6px', borderRadius: '4px', fontSize: '9px', fontWeight: 700,
                      background: `${COLORS.fault}20`, color: COLORS.fault, textTransform: 'uppercase',
                    }}>Active</span>
                  )}
                </div>
                <Badge
                  label={dtc.severity}
                  variant={dtc.severity === 'critical' ? 'fault' : dtc.severity === 'warning' ? 'warn' : 'info'}
                />
              </div>
              <p style={{ fontSize: '13px', color: COLORS.text, margin: '0 0 6px', fontWeight: 500 }}>
                {dtc.desc}
              </p>
              {dtc.component && <InfoRow label="Component" value={dtc.component} />}
              {dtc.cause && <InfoRow label="Cause" value={dtc.cause} />}
              {dtc.fix && (
                <div style={{ marginTop: '6px', padding: '8px 10px', borderRadius: '8px', background: `${COLORS.ok}10` }}>
                  <span style={{ fontSize: '11px', color: COLORS.ok, fontWeight: 600 }}>Fix: </span>
                  <span style={{ fontSize: '11px', color: COLORS.textDim }}>{dtc.fix}</span>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

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
          Alternative Tools for CVM Codes
        </p>
        <p style={{ fontSize: '11px', color: COLORS.textMuted, marginBottom: '8px', lineHeight: 1.3 }}>
          This app attempts a direct CVM scan via UDS. If your adapter doesn't support body-bus access, these dedicated tools will:
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
