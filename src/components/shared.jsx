import React, { Component } from 'react';

// --- Theme colours ---
const COLORS = {
  bg: '#0a0f1a',
  bgCard: 'rgba(15, 23, 42, 0.7)',
  bgCardBorder: 'rgba(59, 130, 246, 0.15)',
  accent: '#3b82f6',
  accentDim: 'rgba(59, 130, 246, 0.3)',
  ok: '#22c55e',
  warn: '#f59e0b',
  fault: '#ef4444',
  text: '#e2e8f0',
  textDim: '#94a3b8',
  textMuted: '#64748b',
};

// --- Gauge (SVG circular arc) ---
export function Gauge({ value, min = 0, max = 100, unit = '', label = '', warn = false, size = 140 }) {
  const radius = (size - 16) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const circumference = 2 * Math.PI * radius;
  const startAngle = 135;
  const totalAngle = 270;

  const clamped = Math.max(min, Math.min(max, value ?? min));
  const fraction = max === min ? 0 : (clamped - min) / (max - min);
  const arcLength = circumference * (totalAngle / 360);
  const dashOffset = arcLength * (1 - fraction);

  const color = warn ? COLORS.fault : fraction > 0.85 ? COLORS.warn : COLORS.accent;

  const style = {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '2px',
  };

  return (
    <div style={style}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {/* Background arc */}
        <circle
          cx={cx} cy={cy} r={radius}
          fill="none"
          stroke={COLORS.bgCardBorder}
          strokeWidth="8"
          strokeDasharray={`${arcLength} ${circumference}`}
          strokeDashoffset="0"
          strokeLinecap="round"
          transform={`rotate(${startAngle} ${cx} ${cy})`}
        />
        {/* Value arc */}
        <circle
          cx={cx} cy={cy} r={radius}
          fill="none"
          stroke={color}
          strokeWidth="8"
          strokeDasharray={`${arcLength} ${circumference}`}
          strokeDashoffset={dashOffset}
          strokeLinecap="round"
          transform={`rotate(${startAngle} ${cx} ${cy})`}
          style={{ transition: 'stroke-dashoffset 0.3s ease, stroke 0.3s ease' }}
        />
        {/* Value text */}
        <text x={cx} y={cy - 4} textAnchor="middle" fill={COLORS.text} fontSize="24" fontWeight="700">
          {value !== null && value !== undefined ? Math.round(value) : '—'}
        </text>
        <text x={cx} y={cy + 16} textAnchor="middle" fill={COLORS.textDim} fontSize="11">
          {unit}
        </text>
      </svg>
      <span style={{ fontSize: '12px', color: COLORS.textDim, fontWeight: 500 }}>{label}</span>
    </div>
  );
}

// --- Card (glassmorphic panel) ---
export function Card({ children, style: extraStyle, onClick }) {
  const style = {
    background: COLORS.bgCard,
    border: `1px solid ${COLORS.bgCardBorder}`,
    borderRadius: '16px',
    padding: '16px',
    backdropFilter: 'blur(12px)',
    WebkitBackdropFilter: 'blur(12px)',
    ...extraStyle,
  };

  return <div style={style} onClick={onClick}>{children}</div>;
}

// --- Badge (status indicator) ---
export function Badge({ label, variant = 'info' }) {
  const colorMap = {
    info: COLORS.accent,
    ok: COLORS.ok,
    warn: COLORS.warn,
    fault: COLORS.fault,
  };
  const color = colorMap[variant] || COLORS.accent;

  const style = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    padding: '4px 10px',
    borderRadius: '20px',
    background: `${color}20`,
    color: color,
    fontSize: '12px',
    fontWeight: 600,
    letterSpacing: '0.02em',
  };

  return (
    <span style={style}>
      <span style={{
        width: '6px', height: '6px', borderRadius: '50%',
        background: color,
      }} />
      {label}
    </span>
  );
}

// --- Sparkline (SVG mini line chart) ---
export function Sparkline({ data = [], width = 80, height = 30, color = COLORS.accent }) {
  if (data.length < 2) return <div style={{ width, height }} />;

  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const padding = 2;

  const points = data.map((v, i) => {
    const x = padding + (i / (data.length - 1)) * (width - padding * 2);
    const y = padding + (1 - (v - min) / range) * (height - padding * 2);
    return `${x},${y}`;
  }).join(' ');

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// --- Pulse (animated dot) ---
export function Pulse({ color = COLORS.ok, size = 10 }) {
  const style = {
    width: size,
    height: size,
    borderRadius: '50%',
    background: color,
    boxShadow: `0 0 ${size}px ${color}`,
    animation: 'pulse 2s ease-in-out infinite',
  };

  return (
    <>
      <style>{`@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }`}</style>
      <span style={style} />
    </>
  );
}

// --- ErrorBoundary ---
export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <Card style={{ margin: '20px', textAlign: 'center' }}>
          <p style={{ color: COLORS.fault, fontWeight: 600, marginBottom: '8px' }}>Something went wrong</p>
          <p style={{ color: COLORS.textDim, fontSize: '13px' }}>{this.state.error.message}</p>
          <button
            onClick={() => this.setState({ error: null })}
            style={{
              marginTop: '12px', padding: '8px 16px', borderRadius: '8px',
              background: COLORS.accent, color: '#fff', border: 'none',
              fontSize: '13px', fontWeight: 600, cursor: 'pointer',
            }}
          >
            Try Again
          </button>
        </Card>
      );
    }
    return this.props.children;
  }
}

// --- ActionButton (full-width CTA) ---
export function ActionButton({ label, color, onClick, disabled }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        width: '100%',
        padding: '14px',
        borderRadius: '12px',
        background: disabled ? '#334155' : color,
        color: '#fff',
        border: 'none',
        fontSize: '15px',
        fontWeight: 700,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.6 : 1,
        transition: 'all 0.2s',
        letterSpacing: '0.02em',
      }}
    >
      {label}
    </button>
  );
}

// --- InfoRow (label/value pair) ---
export function InfoRow({ label, value }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: `1px solid ${COLORS.bgCardBorder}` }}>
      <span style={{ fontSize: '12px', color: COLORS.textMuted }}>{label}</span>
      <span style={{ fontSize: '12px', color: COLORS.text, fontWeight: 500, textAlign: 'right', maxWidth: '60%', wordBreak: 'break-word' }}>
        {value ?? '—'}
      </span>
    </div>
  );
}

export { COLORS };
