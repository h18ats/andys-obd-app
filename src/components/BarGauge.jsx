import React from 'react';
import { COLORS } from './shared.jsx';

export default function BarGauge({ value, min = 0, max = 100, unit = '', label = '', warn = false }) {
  const clamped = Math.max(min, Math.min(max, value ?? min));
  const fraction = max === min ? 0 : (clamped - min) / (max - min);
  const color = warn ? COLORS.fault : fraction > 0.85 ? COLORS.warn : COLORS.accent;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span style={{ fontSize: '11px', color: COLORS.textDim, fontWeight: 600 }}>{label}</span>
        <span style={{ fontSize: '18px', fontWeight: 700, color: warn ? COLORS.fault : COLORS.text }}>
          {value !== null && value !== undefined ? Math.round(value * 10) / 10 : '—'}
          <span style={{ fontSize: '11px', color: COLORS.textMuted, fontWeight: 500, marginLeft: '3px' }}>{unit}</span>
        </span>
      </div>
      <div style={{
        height: '8px',
        borderRadius: '4px',
        background: COLORS.bgCardBorder,
        overflow: 'hidden',
      }}>
        <div style={{
          height: '100%',
          width: `${fraction * 100}%`,
          borderRadius: '4px',
          background: color,
          transition: 'width 0.3s ease, background 0.3s ease',
        }} />
      </div>
    </div>
  );
}
