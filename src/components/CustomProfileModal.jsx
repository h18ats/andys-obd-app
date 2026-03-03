import React, { useState } from 'react';
import { COLORS } from './shared.jsx';

const UUID_SHORT = /^[0-9a-f]{4}$/i;
const UUID_LONG = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isValidUUID(v) { return UUID_SHORT.test(v) || UUID_LONG.test(v); }

export default function CustomProfileModal({ onSave, onClose }) {
  const [name, setName] = useState('');
  const [serviceUUID, setServiceUUID] = useState('');
  const [writeUUID, setWriteUUID] = useState('');
  const [notifyUUID, setNotifyUUID] = useState('');
  const [mtu, setMtu] = useState('20');
  const [error, setError] = useState(null);

  const handleSave = () => {
    if (!name.trim()) { setError('Name is required'); return; }
    if (!isValidUUID(serviceUUID)) { setError('Service UUID: use 4-char hex or full 128-bit format'); return; }
    if (!isValidUUID(writeUUID)) { setError('Write UUID: use 4-char hex or full 128-bit format'); return; }
    if (!isValidUUID(notifyUUID)) { setError('Notify UUID: use 4-char hex or full 128-bit format'); return; }
    const mtuNum = parseInt(mtu, 10);
    if (isNaN(mtuNum) || mtuNum < 20 || mtuNum > 512) { setError('MTU must be 20\u2013512'); return; }

    onSave({
      id: `cp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      name: name.trim(),
      serviceUUID: serviceUUID.toLowerCase(),
      writeUUID: writeUUID.toLowerCase(),
      notifyUUID: notifyUUID.toLowerCase(),
      mtu: mtuNum,
    });
  };

  const inputStyle = {
    width: '100%', padding: '10px 12px', borderRadius: '10px',
    background: '#0f172a', color: COLORS.text,
    border: `1px solid ${COLORS.bgCardBorder}`,
    fontSize: '14px', outline: 'none', boxSizing: 'border-box',
  };

  const uuidInputStyle = {
    ...inputStyle,
    fontFamily: 'monospace', fontSize: '13px', letterSpacing: '0.5px',
  };

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
          maxHeight: '90vh', overflowY: 'auto',
        }}
      >
        <h2 style={{ fontSize: '16px', fontWeight: 700, color: COLORS.text, margin: '0 0 16px' }}>
          Custom Adapter Profile
        </h2>

        {error && (
          <p style={{ fontSize: '12px', color: COLORS.fault, margin: '0 0 10px' }}>{error}</p>
        )}

        <label style={{ fontSize: '12px', color: COLORS.textDim, fontWeight: 600, display: 'block', marginBottom: '6px' }}>
          Name *
        </label>
        <input
          type="text"
          value={name}
          onChange={e => { setName(e.target.value); setError(null); }}
          placeholder="e.g. My Adapter"
          autoFocus
          style={{ ...inputStyle, marginBottom: '12px' }}
        />

        <label style={{ fontSize: '12px', color: COLORS.textDim, fontWeight: 600, display: 'block', marginBottom: '6px' }}>
          Service UUID *
        </label>
        <input
          type="text"
          value={serviceUUID}
          onChange={e => { setServiceUUID(e.target.value); setError(null); }}
          placeholder="ffe0 or full 128-bit UUID"
          style={{ ...uuidInputStyle, marginBottom: '12px' }}
        />

        <label style={{ fontSize: '12px', color: COLORS.textDim, fontWeight: 600, display: 'block', marginBottom: '6px' }}>
          Write UUID *
        </label>
        <input
          type="text"
          value={writeUUID}
          onChange={e => { setWriteUUID(e.target.value); setError(null); }}
          placeholder="ffe1 or full 128-bit UUID"
          style={{ ...uuidInputStyle, marginBottom: '12px' }}
        />

        <label style={{ fontSize: '12px', color: COLORS.textDim, fontWeight: 600, display: 'block', marginBottom: '6px' }}>
          Notify UUID *
        </label>
        <input
          type="text"
          value={notifyUUID}
          onChange={e => { setNotifyUUID(e.target.value); setError(null); }}
          placeholder="ffe2 or full 128-bit UUID"
          style={{ ...uuidInputStyle, marginBottom: '12px' }}
        />

        <label style={{ fontSize: '12px', color: COLORS.textDim, fontWeight: 600, display: 'block', marginBottom: '6px' }}>
          MTU (bytes)
        </label>
        <input
          type="number"
          value={mtu}
          onChange={e => { setMtu(e.target.value); setError(null); }}
          min={20} max={512}
          style={{ ...inputStyle, marginBottom: '6px' }}
        />
        <p style={{ fontSize: '11px', color: COLORS.textMuted, margin: '0 0 16px' }}>
          20 for most adapters, 512 for OBDLink CX
        </p>

        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            onClick={onClose}
            style={{
              flex: 1, padding: '12px', borderRadius: '10px', border: 'none',
              background: '#334155', color: COLORS.textDim,
              fontSize: '14px', fontWeight: 600, cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            style={{
              flex: 1, padding: '12px', borderRadius: '10px', border: 'none',
              background: COLORS.accent, color: '#fff',
              fontSize: '14px', fontWeight: 700, cursor: 'pointer',
            }}
          >
            Save Profile
          </button>
        </div>
      </div>
    </div>
  );
}
