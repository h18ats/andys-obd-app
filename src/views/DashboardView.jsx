import React from 'react';
import { Card, Gauge, Sparkline, ActionButton, NotConnected, COLORS } from '../components/shared.jsx';
import { DASHBOARD_PIDS, DETAIL_PIDS, PIDS } from '../obd/obd-pids.js';

export default function DashboardView({ connected, liveData, polling, history, onStartPolling, onStopPolling }) {
  if (!connected) return <NotConnected />;

  const hasStaleData = !polling && Object.keys(liveData).length > 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', paddingTop: '8px' }}>
      {/* Polling control */}
      <ActionButton
        label={polling ? 'Stop Live Data' : 'Start Live Data'}
        color={polling ? COLORS.warn : COLORS.ok}
        onClick={polling ? onStopPolling : onStartPolling}
      />

      {/* Disconnect / stale-data banner */}
      {hasStaleData && (
        <Card style={{
          borderColor: `${COLORS.warn}40`,
          background: `${COLORS.warn}10`,
          display: 'flex', alignItems: 'center', gap: '10px',
        }}>
          <span style={{ fontSize: '20px' }}>⏸</span>
          <div>
            <div style={{ fontSize: '13px', fontWeight: 600, color: COLORS.warn }}>
              Live data paused
            </div>
            <div style={{ fontSize: '11px', color: COLORS.textDim }}>
              Tap Start to resume polling
            </div>
          </div>
        </Card>
      )}

      {/* Main gauges — 2x2 grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: '12px',
      }}>
        {DASHBOARD_PIDS.map((pid) => {
          const def = PIDS[pid];
          const data = liveData[pid];
          return (
            <Card key={pid} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '12px' }}>
              <Gauge
                value={data?.value ?? null}
                min={def.min}
                max={def.max}
                unit={def.unit}
                label={def.name}
                warn={data?.warn}
                size={130}
              />
            </Card>
          );
        })}
      </div>

      {/* Detail cards with sparklines */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
        {DETAIL_PIDS.map((pid) => {
          const def = PIDS[pid];
          const data = liveData[pid];
          const histData = history.get(pid);
          const color = data?.warn ? COLORS.fault : COLORS.accent;

          return (
            <Card key={pid} style={{ padding: '12px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <div style={{ fontSize: '11px', color: COLORS.textDim, fontWeight: 600, marginBottom: '4px' }}>
                    {def.name}
                  </div>
                  <div style={{ fontSize: '22px', fontWeight: 700, color: data?.warn ? COLORS.fault : COLORS.text }}>
                    {data?.value !== undefined ? data.value.toFixed(1) : '—'}
                  </div>
                  <div style={{ fontSize: '10px', color: COLORS.textMuted }}>{def.unit}</div>
                </div>
                <Sparkline data={histData} width={60} height={28} color={color} />
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
