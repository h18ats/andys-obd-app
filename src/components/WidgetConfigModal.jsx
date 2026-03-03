import React, { useState } from 'react';
import { COLORS } from './shared.jsx';
import { PIDS } from '../obd/obd-pids.js';
import { getPIDsByCategory } from '../obd/pid-catalog.js';

const DISPLAY_TYPES = [
  { key: 'gauge', label: 'Gauge', icon: '◎', desc: 'Circular arc' },
  { key: 'number', label: 'Number', icon: '##', desc: 'Large readout' },
  { key: 'sparkline', label: 'Sparkline', icon: '〜', desc: 'Trend line' },
  { key: 'bar', label: 'Bar', icon: '▬', desc: 'Progress bar' },
];

const SIZE_OPTIONS = [
  { key: 1, label: 'Half', desc: '1 column' },
  { key: 2, label: 'Full', desc: '2 columns' },
];

const DEFAULT_SIZE = {
  gauge: 1,
  number: 1,
  sparkline: 1,
  bar: 2,
};

export default function WidgetConfigModal({ onAdd, onClose, existingPIDs, supportedPIDs }) {
  const [step, setStep] = useState(1);
  const [selectedPID, setSelectedPID] = useState(null);
  const [selectedDisplay, setSelectedDisplay] = useState(null);
  const [selectedSize, setSelectedSize] = useState(null);
  const [expandedCat, setExpandedCat] = useState(null);

  const categories = getPIDsByCategory();
  const existingSet = new Set(existingPIDs || []);
  const supportedSet = supportedPIDs instanceof Set ? supportedPIDs : new Set();
  const hasSupported = supportedSet.size > 0;

  const handleSelectPID = (pid) => {
    setSelectedPID(pid);
    setStep(2);
  };

  const handleSelectDisplay = (display) => {
    setSelectedDisplay(display);
    setSelectedSize(DEFAULT_SIZE[display] || 1);
    setStep(3);
  };

  const handleConfirm = () => {
    if (!selectedPID || !selectedDisplay || !selectedSize) return;
    onAdd({ pid: selectedPID, display: selectedDisplay, size: selectedSize });
  };

  const handleBack = () => {
    if (step === 3) { setStep(2); return; }
    if (step === 2) { setStep(1); setSelectedPID(null); return; }
    onClose();
  };

  const def = selectedPID ? PIDS[selectedPID] : null;

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 100,
      background: 'rgba(0, 0, 0, 0.7)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '20px',
    }} onClick={onClose}>
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: '360px',
          background: '#1a2235', borderRadius: '16px',
          border: `1px solid ${COLORS.bgCardBorder}`,
          padding: '20px',
          maxHeight: '80vh', overflowY: 'auto',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <button
            onClick={handleBack}
            style={{
              padding: '4px 10px', borderRadius: '8px', border: 'none',
              background: '#334155', color: COLORS.textDim,
              fontSize: '12px', fontWeight: 600, cursor: 'pointer',
            }}
          >
            {step === 1 ? 'Cancel' : '← Back'}
          </button>
          <span style={{ fontSize: '13px', fontWeight: 600, color: COLORS.textDim }}>
            Step {step} of 3
          </span>
        </div>

        {/* Step 1: Pick PID */}
        {step === 1 && (
          <div>
            <h3 style={{ fontSize: '16px', fontWeight: 700, color: COLORS.text, margin: '0 0 12px' }}>
              Choose a PID
            </h3>
            {Object.entries(categories).map(([catKey, cat]) => {
              if (cat.pids.length === 0) return null;
              const isExpanded = expandedCat === catKey;
              return (
                <div key={catKey} style={{ marginBottom: '4px' }}>
                  <button
                    onClick={() => setExpandedCat(isExpanded ? null : catKey)}
                    style={{
                      width: '100%', padding: '10px 12px',
                      borderRadius: '10px', border: 'none',
                      background: isExpanded ? COLORS.accent + '15' : '#0f172a',
                      color: COLORS.text, fontSize: '13px', fontWeight: 600,
                      cursor: 'pointer', textAlign: 'left',
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    }}
                  >
                    <span>{cat.icon}  {cat.label}</span>
                    <span style={{ fontSize: '11px', color: COLORS.textMuted }}>
                      {cat.pids.length} {isExpanded ? '▲' : '▼'}
                    </span>
                  </button>
                  {isExpanded && (
                    <div style={{ padding: '4px 0 4px 8px' }}>
                      {cat.pids.map(({ pid, name, description, unit }) => {
                        const added = existingSet.has(pid);
                        const unsupported = hasSupported && !supportedSet.has(pid);
                        return (
                          <button
                            key={pid}
                            onClick={() => !added && handleSelectPID(pid)}
                            disabled={added}
                            style={{
                              width: '100%', padding: '8px 10px',
                              borderRadius: '8px', border: 'none',
                              background: added ? '#334155' : 'transparent',
                              color: added ? COLORS.textMuted : COLORS.text,
                              fontSize: '12px', cursor: added ? 'default' : 'pointer',
                              textAlign: 'left', display: 'flex', justifyContent: 'space-between',
                              alignItems: 'center', gap: '8px',
                              opacity: added ? 0.5 : 1,
                              marginBottom: '2px',
                            }}
                          >
                            <div style={{ flex: 1 }}>
                              <div style={{ fontWeight: 600, marginBottom: '1px' }}>
                                {name}
                                {added && <span style={{ fontSize: '10px', marginLeft: '6px', color: COLORS.textMuted }}>(added)</span>}
                                {unsupported && !added && (
                                  <span style={{ fontSize: '10px', marginLeft: '6px', color: COLORS.warn }}>(?)</span>
                                )}
                              </div>
                              <div style={{ fontSize: '10px', color: COLORS.textMuted }}>{description}</div>
                            </div>
                            {unit && (
                              <span style={{
                                padding: '2px 6px', borderRadius: '6px',
                                background: COLORS.accent + '20', color: COLORS.accent,
                                fontSize: '10px', fontWeight: 600, whiteSpace: 'nowrap',
                              }}>
                                {unit}
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Step 2: Choose display type */}
        {step === 2 && def && (
          <div>
            <h3 style={{ fontSize: '16px', fontWeight: 700, color: COLORS.text, margin: '0 0 4px' }}>
              Display type
            </h3>
            <p style={{ fontSize: '12px', color: COLORS.textMuted, margin: '0 0 12px' }}>
              {def.name} — {def.description}
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
              {DISPLAY_TYPES.map(({ key, label, icon, desc }) => (
                <button
                  key={key}
                  onClick={() => handleSelectDisplay(key)}
                  style={{
                    padding: '16px 12px', borderRadius: '12px',
                    border: `1px solid ${COLORS.bgCardBorder}`,
                    background: '#0f172a', color: COLORS.text,
                    cursor: 'pointer', textAlign: 'center',
                  }}
                >
                  <div style={{ fontSize: '24px', marginBottom: '6px' }}>{icon}</div>
                  <div style={{ fontSize: '13px', fontWeight: 600 }}>{label}</div>
                  <div style={{ fontSize: '10px', color: COLORS.textMuted, marginTop: '2px' }}>{desc}</div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Step 3: Choose size */}
        {step === 3 && def && (
          <div>
            <h3 style={{ fontSize: '16px', fontWeight: 700, color: COLORS.text, margin: '0 0 4px' }}>
              Widget size
            </h3>
            <p style={{ fontSize: '12px', color: COLORS.textMuted, margin: '0 0 12px' }}>
              {def.name} — {selectedDisplay}
            </p>
            <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
              {SIZE_OPTIONS.map(({ key, label, desc }) => (
                <button
                  key={key}
                  onClick={() => setSelectedSize(key)}
                  style={{
                    flex: 1, padding: '14px', borderRadius: '12px',
                    border: `2px solid ${selectedSize === key ? COLORS.accent : COLORS.bgCardBorder}`,
                    background: selectedSize === key ? COLORS.accent + '15' : '#0f172a',
                    color: COLORS.text, cursor: 'pointer', textAlign: 'center',
                  }}
                >
                  <div style={{ fontSize: '14px', fontWeight: 600 }}>{label}</div>
                  <div style={{ fontSize: '10px', color: COLORS.textMuted, marginTop: '2px' }}>{desc}</div>
                </button>
              ))}
            </div>
            <button
              onClick={handleConfirm}
              style={{
                width: '100%', padding: '14px', borderRadius: '12px',
                border: 'none', background: COLORS.accent, color: '#fff',
                fontSize: '15px', fontWeight: 700, cursor: 'pointer',
              }}
            >
              Add Widget
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
