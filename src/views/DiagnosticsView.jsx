import React, { useState } from 'react';
import { Card, Badge, ActionButton, NotConnected, ProgressCard, ScanVisual, COLORS } from '../components/shared.jsx';

const SEVERITY_COLOR = { info: COLORS.accent, warning: COLORS.warn, critical: COLORS.fault };

function DTCCategory({ title, icon, dtcs, hasScanned }) {
  const count = dtcs.length;
  const hasCritical = dtcs.some(d => d.severity === 'critical');

  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: count > 0 ? '10px' : 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '16px' }}>{icon}</span>
          <span style={{ fontSize: '13px', fontWeight: 600, color: COLORS.text }}>{title}</span>
        </div>
        {hasScanned ? (
          count > 0
            ? <Badge label={`${count} fault${count !== 1 ? 's' : ''}`} variant={hasCritical ? 'fault' : 'warn'} />
            : <span style={{ fontSize: '11px', fontWeight: 600, color: COLORS.ok, background: `${COLORS.ok}15`, padding: '3px 8px', borderRadius: '6px' }}>All clear</span>
        ) : (
          <span style={{ fontSize: '11px', color: COLORS.textMuted }}>Not scanned</span>
        )}
      </div>

      {count > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {dtcs.map((dtc, i) => (
            <div key={`${dtc.code}-${i}`} style={{
              padding: '10px',
              borderRadius: '8px',
              background: `${SEVERITY_COLOR[dtc.severity] || COLORS.accent}08`,
              borderLeft: `3px solid ${SEVERITY_COLOR[dtc.severity] || COLORS.accent}`,
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
      )}
    </Card>
  );
}

function SummaryBar({ stored, pending, permanent, hasScanned }) {
  if (!hasScanned) return null;
  const total = stored + pending + permanent;

  return (
    <Card style={{
      background: total > 0 ? `${COLORS.fault}10` : `${COLORS.ok}10`,
      borderColor: total > 0 ? `${COLORS.fault}30` : `${COLORS.ok}30`,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <div style={{
          width: '44px', height: '44px', borderRadius: '50%',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: total > 0 ? `${COLORS.fault}20` : `${COLORS.ok}20`,
          fontSize: '22px', flexShrink: 0,
        }}>
          {total > 0 ? '⚠️' : '✅'}
        </div>
        <div>
          <div style={{ fontSize: '15px', fontWeight: 700, color: total > 0 ? COLORS.fault : COLORS.ok }}>
            {total > 0 ? `${total} Fault Code${total !== 1 ? 's' : ''} Found` : 'No Fault Codes'}
          </div>
          <div style={{ fontSize: '12px', color: COLORS.textDim, marginTop: '2px' }}>
            {total > 0
              ? `${stored} stored, ${pending} pending, ${permanent} permanent`
              : 'All three DTC categories scanned — vehicle is clean'}
          </div>
        </div>
      </div>
    </Card>
  );
}

function MonitorGrid({ monitorStatus }) {
  if (!monitorStatus) return null;

  const monitors = Object.entries(monitorStatus.monitors);
  const supported = monitors.filter(([, m]) => m.supported);
  const complete = supported.filter(([, m]) => m.complete).length;
  const incomplete = supported.length - complete;

  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '16px' }}>📊</span>
          <span style={{ fontSize: '13px', fontWeight: 600, color: COLORS.text }}>Monitor Readiness</span>
        </div>
        <span style={{ fontSize: '11px', color: COLORS.textDim }}>
          {complete}/{supported.length} ready
        </span>
      </div>

      {/* MIL status */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: '10px',
        padding: '8px 10px', borderRadius: '8px', marginBottom: '10px',
        background: monitorStatus.milOn ? `${COLORS.fault}12` : `${COLORS.ok}10`,
        border: `1px solid ${monitorStatus.milOn ? COLORS.fault : COLORS.ok}20`,
      }}>
        <span style={{
          width: '10px', height: '10px', borderRadius: '50%',
          background: monitorStatus.milOn ? COLORS.fault : COLORS.ok,
          boxShadow: monitorStatus.milOn ? `0 0 6px ${COLORS.fault}` : 'none',
        }} />
        <div>
          <div style={{ fontSize: '12px', fontWeight: 600, color: monitorStatus.milOn ? COLORS.fault : COLORS.ok }}>
            {monitorStatus.milOn ? 'Check Engine Light ON' : 'Check Engine Light OFF'}
          </div>
          <div style={{ fontSize: '11px', color: COLORS.textDim }}>
            ECU reports {monitorStatus.dtcCount} code{monitorStatus.dtcCount !== 1 ? 's' : ''}
          </div>
        </div>
      </div>

      {/* Monitor grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
        {supported.map(([key, mon]) => (
          <div key={key} style={{
            display: 'flex', alignItems: 'center', gap: '8px',
            padding: '7px 8px', borderRadius: '8px',
            background: mon.complete ? `${COLORS.ok}10` : `${COLORS.warn}10`,
          }}>
            <span style={{
              width: '8px', height: '8px', borderRadius: '50%', flexShrink: 0,
              background: mon.complete ? COLORS.ok : COLORS.warn,
            }} />
            <span style={{ fontSize: '11px', color: COLORS.text }}>
              {formatMonitorName(key)}
            </span>
            <span style={{ fontSize: '9px', color: mon.complete ? COLORS.ok : COLORS.warn, marginLeft: 'auto', fontWeight: 600 }}>
              {mon.complete ? 'OK' : 'INC'}
            </span>
          </div>
        ))}
      </div>

      {incomplete > 0 && (
        <p style={{ fontSize: '10px', color: COLORS.textMuted, margin: '8px 0 0', lineHeight: '1.4' }}>
          INC = Incomplete. {incomplete} monitor{incomplete !== 1 ? 's haven\'t' : ' hasn\'t'} finished self-testing since last reset. Drive normally to complete.
        </p>
      )}
    </Card>
  );
}

function formatMonitorName(key) {
  const names = {
    misfire: 'Misfire',
    fuelSystem: 'Fuel System',
    components: 'Components',
    catalyst: 'Catalyst',
    heatedCatalyst: 'Heated Cat',
    evapSystem: 'EVAP System',
    secondaryAir: 'Secondary Air',
    oxygenSensor: 'O2 Sensor',
    oxygenSensorHeater: 'O2 Heater',
    egr: 'EGR/VVT',
  };
  return names[key] || key.replace(/([A-Z])/g, ' $1').trim();
}

export default function DiagnosticsView({ connected, storedDTCs, pendingDTCs, permanentDTCs, readingDTCs, monitorStatus, dtcScanSteps, onReadDTCs }) {
  if (!connected) return <NotConnected />;

  const hasScanned = monitorStatus !== null || storedDTCs.length > 0 || pendingDTCs.length > 0 || permanentDTCs.length > 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', paddingTop: '8px' }}>
      <ActionButton
        label={readingDTCs ? 'Scanning...' : hasScanned ? 'Scan Again' : 'Scan for Fault Codes'}
        color={COLORS.accent}
        onClick={onReadDTCs}
        disabled={readingDTCs}
      />

      {readingDTCs && (
        <>
          <ScanVisual />
          {dtcScanSteps.length > 0 && <ProgressCard steps={dtcScanSteps} />}
        </>
      )}

      {/* Overall summary */}
      <SummaryBar
        stored={storedDTCs.length}
        pending={pendingDTCs.length}
        permanent={permanentDTCs.length}
        hasScanned={hasScanned && !readingDTCs}
      />

      {/* DTC categories — always visible after scan */}
      {hasScanned && !readingDTCs && (
        <>
          <DTCCategory title="Stored Faults" icon="💾" dtcs={storedDTCs} hasScanned={hasScanned} />
          <DTCCategory title="Pending Faults" icon="⏳" dtcs={pendingDTCs} hasScanned={hasScanned} />
          <DTCCategory title="Permanent Faults" icon="🔒" dtcs={permanentDTCs} hasScanned={hasScanned} />
        </>
      )}

      {/* Monitor readiness */}
      <MonitorGrid monitorStatus={monitorStatus} />

      {/* Initial empty state */}
      {!hasScanned && !readingDTCs && (
        <div style={{ textAlign: 'center', padding: '30px 0', color: COLORS.textMuted }}>
          <div style={{ fontSize: '36px', marginBottom: '8px' }}>🔍</div>
          <p style={{ fontSize: '13px' }}>Tap "Scan for Fault Codes" to check your vehicle</p>
          <p style={{ fontSize: '11px', marginTop: '4px', maxWidth: '240px', margin: '4px auto 0', lineHeight: '1.4' }}>
            Reads stored, pending, and permanent DTCs plus emission monitor readiness status
          </p>
        </div>
      )}
    </div>
  );
}
