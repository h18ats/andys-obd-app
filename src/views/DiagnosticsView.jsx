import React from 'react';
import { Card, Badge, ActionButton, NotConnected, COLORS } from '../components/shared.jsx';

function DTCList({ title, dtcs }) {
  if (dtcs.length === 0) return null;

  const severityColor = { info: COLORS.accent, warning: COLORS.warn, critical: COLORS.fault };

  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
        <p style={{ fontSize: '12px', color: COLORS.textDim, fontWeight: 600, margin: 0 }}>{title}</p>
        <Badge label={`${dtcs.length}`} variant={dtcs.some((d) => d.severity === 'critical') ? 'fault' : 'warn'} />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {dtcs.map((dtc, i) => (
          <div key={`${dtc.code}-${i}`} style={{
            padding: '10px',
            borderRadius: '8px',
            background: `${severityColor[dtc.severity] || COLORS.accent}08`,
            borderLeft: `3px solid ${severityColor[dtc.severity] || COLORS.accent}`,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '14px', fontWeight: 700, fontFamily: 'monospace', color: COLORS.text }}>
                {dtc.code}
              </span>
              <Badge label={dtc.severity} variant={dtc.severity === 'critical' ? 'fault' : dtc.severity === 'warning' ? 'warn' : 'info'} />
            </div>
            <p style={{ fontSize: '12px', color: COLORS.textDim, margin: '4px 0 0' }}>{dtc.desc}</p>
          </div>
        ))}
      </div>
    </Card>
  );
}

export default function DiagnosticsView({ connected, storedDTCs, pendingDTCs, permanentDTCs, readingDTCs, monitorStatus, onReadDTCs }) {
  if (!connected) return <NotConnected />;

  const totalDTCs = storedDTCs.length + pendingDTCs.length + permanentDTCs.length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', paddingTop: '8px' }}>
      <ActionButton
        label={readingDTCs ? 'Reading...' : 'Read Fault Codes'}
        color={COLORS.accent}
        onClick={onReadDTCs}
        disabled={readingDTCs}
      />

      {/* MIL status */}
      {monitorStatus && (
        <Card style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{
            width: '40px', height: '40px', borderRadius: '50%',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: monitorStatus.milOn ? `${COLORS.fault}30` : `${COLORS.ok}20`,
            fontSize: '20px',
          }}>
            {monitorStatus.milOn ? '🔴' : '✅'}
          </div>
          <div>
            <div style={{ fontSize: '14px', fontWeight: 600, color: monitorStatus.milOn ? COLORS.fault : COLORS.ok }}>
              {monitorStatus.milOn ? 'Check Engine Light ON' : 'No Warning Lights'}
            </div>
            <div style={{ fontSize: '12px', color: COLORS.textDim }}>
              {monitorStatus.dtcCount} fault code{monitorStatus.dtcCount !== 1 ? 's' : ''} reported by ECU
            </div>
          </div>
        </Card>
      )}

      {/* DTC lists */}
      <DTCList title="Stored Faults" dtcs={storedDTCs} />
      <DTCList title="Pending Faults" dtcs={pendingDTCs} />
      <DTCList title="Permanent Faults" dtcs={permanentDTCs} />

      {/* Monitor readiness grid */}
      {monitorStatus && (
        <Card>
          <p style={{ fontSize: '12px', color: COLORS.textDim, fontWeight: 600, marginBottom: '10px' }}>
            Monitor Readiness
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
            {Object.entries(monitorStatus.monitors).map(([key, mon]) => {
              if (!mon.supported) return null;
              return (
                <div key={key} style={{
                  display: 'flex', alignItems: 'center', gap: '8px',
                  padding: '6px 8px', borderRadius: '8px',
                  background: mon.complete ? `${COLORS.ok}10` : `${COLORS.warn}10`,
                }}>
                  <span style={{
                    width: '8px', height: '8px', borderRadius: '50%',
                    background: mon.complete ? COLORS.ok : COLORS.warn,
                  }} />
                  <span style={{ fontSize: '11px', color: COLORS.text, textTransform: 'capitalize' }}>
                    {key.replace(/([A-Z])/g, ' $1').trim()}
                  </span>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {/* Empty state */}
      {totalDTCs === 0 && !readingDTCs && !monitorStatus && (
        <div style={{ textAlign: 'center', padding: '30px 0', color: COLORS.textMuted }}>
          <div style={{ fontSize: '36px', marginBottom: '8px' }}>🔍</div>
          <p style={{ fontSize: '13px' }}>Tap "Read Fault Codes" to scan for DTCs</p>
        </div>
      )}
    </div>
  );
}
