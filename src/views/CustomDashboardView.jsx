import React, { useState } from 'react';
import { Card, Gauge, Sparkline, NotConnected, NumberReadout, COLORS } from '../components/shared.jsx';
import BarGauge from '../components/BarGauge.jsx';
import { PIDS } from '../obd/obd-pids.js';

const MAX_WIDGETS = 20;

export default function CustomDashboardView({
  connected,
  liveData,
  polling,
  history,
  widgets,
  onAddWidget,
  onRemoveWidget,
  onShowConfig,
}) {
  const [editMode, setEditMode] = useState(false);

  if (!connected) return <NotConnected />;

  const sorted = [...widgets].sort((a, b) => a.order - b.order);
  const canAdd = widgets.length < MAX_WIDGETS;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', paddingTop: '8px' }}>
      {/* Header row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: '13px', fontWeight: 600, color: COLORS.textDim }}>
          {widgets.length} / {MAX_WIDGETS} widgets
        </span>
        {widgets.length > 0 && (
          <button
            onClick={() => setEditMode(!editMode)}
            style={{
              padding: '6px 14px', borderRadius: '10px', border: 'none',
              background: editMode ? COLORS.fault + '30' : COLORS.accent + '20',
              color: editMode ? COLORS.fault : COLORS.accent,
              fontSize: '12px', fontWeight: 600, cursor: 'pointer',
            }}
          >
            {editMode ? 'Done' : 'Edit'}
          </button>
        )}
      </div>

      {/* Empty state */}
      {widgets.length === 0 && (
        <Card style={{ textAlign: 'center', padding: '40px 20px' }}>
          <div style={{ fontSize: '40px', marginBottom: '12px' }}>▣</div>
          <p style={{ fontSize: '15px', fontWeight: 600, color: COLORS.textDim, margin: '0 0 6px' }}>
            No widgets yet
          </p>
          <p style={{ fontSize: '12px', color: COLORS.textMuted, margin: '0 0 16px' }}>
            Add PIDs you want to monitor
          </p>
          <button
            onClick={onShowConfig}
            style={{
              padding: '10px 24px', borderRadius: '10px', border: 'none',
              background: COLORS.accent, color: '#fff',
              fontSize: '14px', fontWeight: 700, cursor: 'pointer',
            }}
          >
            + Add Widget
          </button>
        </Card>
      )}

      {/* Widget grid */}
      {widgets.length > 0 && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '10px',
        }}>
          {sorted.map((w) => (
            <WidgetCard
              key={w.id}
              widget={w}
              liveData={liveData}
              history={history}
              editMode={editMode}
              onRemove={() => onRemoveWidget(w.id)}
            />
          ))}

          {/* Add Widget card */}
          {canAdd && (
            <Card
              onClick={onShowConfig}
              style={{
                display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center',
                padding: '20px', cursor: 'pointer',
                border: `2px dashed ${COLORS.bgCardBorder}`,
                background: 'transparent',
                minHeight: '100px',
                gridColumn: 'span 1',
              }}
            >
              <span style={{ fontSize: '28px', color: COLORS.textMuted, lineHeight: 1 }}>+</span>
              <span style={{ fontSize: '11px', color: COLORS.textMuted, fontWeight: 600, marginTop: '4px' }}>
                Add Widget
              </span>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}

function WidgetCard({ widget, liveData, history, editMode, onRemove }) {
  const { pid, display, size } = widget;
  const def = PIDS[pid];
  const data = liveData[pid];
  const histData = history.get(pid);
  const label = def?.name || pid;
  const unit = def?.unit || '';
  const value = data?.value ?? null;
  const warn = data?.warn || false;

  return (
    <Card style={{
      padding: '12px',
      position: 'relative',
      gridColumn: size === 2 ? 'span 2' : 'span 1',
    }}>
      {/* Delete button in edit mode */}
      {editMode && (
        <button
          onClick={onRemove}
          style={{
            position: 'absolute', top: '6px', right: '6px', zIndex: 2,
            width: '22px', height: '22px', borderRadius: '50%',
            background: COLORS.fault, color: '#fff',
            border: 'none', fontSize: '13px', fontWeight: 700,
            cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
            lineHeight: 1,
          }}
        >
          ×
        </button>
      )}

      {display === 'gauge' && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <Gauge
            value={value}
            min={def?.min ?? 0}
            max={def?.max ?? 100}
            unit={unit}
            label={label}
            warn={warn}
            size={size === 2 ? 140 : 120}
          />
        </div>
      )}

      {display === 'number' && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '8px 0' }}>
          <NumberReadout value={value} unit={unit} label={label} warn={warn} />
        </div>
      )}

      {display === 'sparkline' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={{ fontSize: '11px', color: COLORS.textDim, fontWeight: 600, marginBottom: '4px' }}>
                {label}
              </div>
              <div style={{ fontSize: '22px', fontWeight: 700, color: warn ? COLORS.fault : COLORS.text }}>
                {value !== null ? (Math.round(value * 10) / 10) : '—'}
              </div>
              <div style={{ fontSize: '10px', color: COLORS.textMuted }}>{unit}</div>
            </div>
            <Sparkline
              data={histData}
              width={size === 2 ? 120 : 60}
              height={28}
              color={warn ? COLORS.fault : COLORS.accent}
            />
          </div>
        </div>
      )}

      {display === 'bar' && (
        <BarGauge
          value={value}
          min={def?.min ?? 0}
          max={def?.max ?? 100}
          unit={unit}
          label={label}
          warn={warn}
        />
      )}
    </Card>
  );
}
