import React, { Component } from 'react';

// --- Shared keyframes (injected once at app root via <AnimationStyles />) ---
export function AnimationStyles() {
  return (
    <style>{`
      @keyframes spin { to { transform: rotate(360deg); } }
      @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
      @keyframes scanLine {
        0% { transform: translateX(-10px); opacity: 0; }
        10% { opacity: 1; }
        90% { opacity: 1; }
        100% { transform: translateX(110px); opacity: 0; }
      }
    `}</style>
  );
}

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

  return <span style={style} />;
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

// --- NotConnected (empty state for views requiring BLE) ---
export function NotConnected() {
  return (
    <div style={{ textAlign: 'center', padding: '60px 20px', color: COLORS.textMuted }}>
      <div style={{ fontSize: '40px', marginBottom: '12px' }}>🔌</div>
      <p style={{ fontSize: '15px', fontWeight: 600, color: COLORS.textDim }}>Not Connected</p>
      <p style={{ fontSize: '12px', marginTop: '4px' }}>Go to the Connect tab to pair with your OBD adapter</p>
    </div>
  );
}

// --- NumberReadout (large numeric display) ---
export function NumberReadout({ value, unit = '', label = '', warn = false }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px' }}>
      <span style={{ fontSize: '11px', color: COLORS.textDim, fontWeight: 600 }}>{label}</span>
      <span style={{ fontSize: '32px', fontWeight: 700, color: warn ? COLORS.fault : COLORS.text, lineHeight: 1.1 }}>
        {value !== null && value !== undefined ? Math.round(value * 10) / 10 : '—'}
      </span>
      <span style={{ fontSize: '11px', color: COLORS.textMuted }}>{unit}</span>
    </div>
  );
}

// --- SignalBars (BLE RSSI indicator) ---
export function SignalBars({ rssi }) {
  const bars = rssi > -50 ? 4 : rssi > -60 ? 3 : rssi > -70 ? 2 : 1;
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: '1px', height: '14px' }}>
      {[1, 2, 3, 4].map((i) => (
        <div key={i} style={{
          width: '3px',
          height: `${i * 3 + 2}px`,
          borderRadius: '1px',
          background: i <= bars ? COLORS.ok : COLORS.textMuted + '40',
        }} />
      ))}
    </div>
  );
}

// --- ProgressCard (step checklist for scan/read operations) ---
export function ProgressCard({ steps }) {
  return (
    <Card>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {steps.map((step, i) => {
          const icon = step.status === 'done' ? '✓'
            : step.status === 'failed' ? '✕'
            : step.status === 'active' ? null
            : '·';
          const color = step.status === 'done' ? COLORS.ok
            : step.status === 'failed' ? COLORS.fault
            : step.status === 'active' ? COLORS.accent
            : COLORS.textMuted;

          return (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              {step.status === 'active' ? (
                <span style={{
                  width: '14px', height: '14px', borderRadius: '50%',
                  border: `2px solid ${COLORS.accent}`, borderTopColor: 'transparent',
                  animation: 'spin 0.8s linear infinite', flexShrink: 0,
                }} />
              ) : (
                <span style={{
                  width: '18px', height: '18px', borderRadius: '50%',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: step.status === 'pending' ? '16px' : '11px',
                  fontWeight: 700, color,
                  background: step.status === 'pending' ? 'none' : `${color}15`,
                  flexShrink: 0,
                }}>
                  {icon}
                </span>
              )}
              <span style={{
                fontSize: '12px', fontWeight: step.status === 'active' ? 600 : 400,
                color: step.status === 'pending' ? COLORS.textMuted : COLORS.text,
              }}>
                {step.label}
              </span>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

// --- ScanVisual (animated car silhouette with scan line for DTC view) ---
export function ScanVisual() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '8px 0' }}>
      <svg width="120" height="60" viewBox="0 0 120 60" fill="none">
        {/* Car body silhouette */}
        <path
          d="M15 42 L20 42 L22 38 L30 28 L42 22 L52 20 L68 20 L82 22 L92 28 L98 38 L100 42 L105 42"
          stroke={COLORS.textMuted}
          strokeWidth="1.5"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {/* Roof line */}
        <path
          d="M42 22 L42 28 L30 28 M82 22 L82 28 L92 28"
          stroke={COLORS.textMuted}
          strokeWidth="1"
          fill="none"
          opacity="0.5"
        />
        {/* Wheels */}
        <circle cx="32" cy="44" r="6" stroke={COLORS.textMuted} strokeWidth="1.5" fill="none" />
        <circle cx="32" cy="44" r="2.5" fill={COLORS.textMuted} opacity="0.3" />
        <circle cx="88" cy="44" r="6" stroke={COLORS.textMuted} strokeWidth="1.5" fill="none" />
        <circle cx="88" cy="44" r="2.5" fill={COLORS.textMuted} opacity="0.3" />
        {/* Ground line */}
        <line x1="10" y1="50" x2="110" y2="50" stroke={COLORS.textMuted} strokeWidth="0.5" opacity="0.3" />
        {/* Scan line (animated) */}
        <rect
          x="0" y="14" width="3" height="38" rx="1.5"
          fill={COLORS.accent}
          opacity="0.9"
          style={{ animation: 'scanLine 2s ease-in-out infinite' }}
        >
          <animate attributeName="opacity" values="0;0.9;0.9;0" dur="2s" repeatCount="indefinite" />
        </rect>
        {/* Scan glow */}
        <rect
          x="-2" y="12" width="7" height="42" rx="3.5"
          fill={COLORS.accent}
          opacity="0.15"
          style={{ animation: 'scanLine 2s ease-in-out infinite' }}
        />
      </svg>
    </div>
  );
}

export { COLORS };
