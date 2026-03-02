import React, { useState } from 'react';
import { Badge, COLORS } from '../components/shared.jsx';

// --- DVLA VRN Lookup ---
// TODO: Replace with real DVLA VES API call when API key arrives:
//   POST https://driver-vehicle-licensing.api.gov.uk/vehicle-enquiry/v1/vehicles
//   Headers: { 'x-api-key': DVLA_API_KEY, 'Content-Type': 'application/json' }
//   Body: { registrationNumber: vrn }
async function lookupVRN(vrn) {
  // Simulate network delay
  await new Promise(r => setTimeout(r, 800));
  const cleaned = vrn.replace(/\s/g, '').toUpperCase();
  if (cleaned.length < 2 || cleaned.length > 8) {
    return { error: 'Invalid registration number' };
  }
  // Mock response matching DVLA VES API shape
  return {
    registrationNumber: cleaned,
    make: 'MINI',
    colour: 'WHITE',
    yearOfManufacture: 2012,
    engineCapacity: 1598,
    fuelType: 'PETROL',
    motStatus: 'Valid',
    motExpiryDate: '2026-08-15',
    taxStatus: 'Taxed',
    taxDueDate: '2026-11-01',
    co2Emissions: 136,
  };
}

export default function AddVehicleModal({ onAdd, onClose }) {
  const [nickname, setNickname] = useState('');
  const [vinInput, setVinInput] = useState('');
  const [vrnInput, setVrnInput] = useState('');
  const [vrnLooking, setVrnLooking] = useState(false);
  const [dvlaResult, setDvlaResult] = useState(null);
  const [vrnError, setVrnError] = useState(null);

  const handleLookup = async () => {
    const cleaned = vrnInput.trim();
    if (!cleaned) return;
    setVrnLooking(true);
    setVrnError(null);
    setDvlaResult(null);
    try {
      const result = await lookupVRN(cleaned);
      if (result.error) {
        setVrnError(result.error);
      } else {
        setDvlaResult(result);
        if (!nickname.trim()) {
          setNickname(`${result.make} ${result.colour.charAt(0)}${result.colour.slice(1).toLowerCase()}`);
        }
      }
    } catch {
      setVrnError('Lookup failed — try again later');
    } finally {
      setVrnLooking(false);
    }
  };

  const handleSubmit = () => {
    if (!nickname.trim()) return;
    const vrn = vrnInput.replace(/\s/g, '').toUpperCase() || null;
    onAdd(nickname.trim(), vinInput.trim() || null, vrn, dvlaResult);
  };

  const inputStyle = {
    width: '100%', padding: '10px 12px', borderRadius: '10px',
    background: '#0f172a', color: COLORS.text,
    border: `1px solid ${COLORS.bgCardBorder}`,
    fontSize: '14px', outline: 'none', boxSizing: 'border-box',
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
          Add Vehicle
        </h2>

        {/* VRN Lookup */}
        <label style={{ fontSize: '12px', color: COLORS.textDim, fontWeight: 600, display: 'block', marginBottom: '6px' }}>
          Registration (optional)
        </label>
        <div style={{ display: 'flex', gap: '8px', marginBottom: '4px' }}>
          <input
            type="text"
            value={vrnInput}
            onChange={e => setVrnInput(e.target.value.toUpperCase())}
            onKeyDown={e => e.key === 'Enter' && handleLookup()}
            placeholder="AB12 CDE"
            maxLength={10}
            autoFocus
            style={{
              ...inputStyle,
              fontFamily: 'monospace', fontWeight: 700,
              letterSpacing: '2px', textTransform: 'uppercase',
              flex: 1,
            }}
          />
          <button
            onClick={handleLookup}
            disabled={!vrnInput.trim() || vrnLooking}
            style={{
              padding: '10px 16px', borderRadius: '10px', border: 'none',
              background: (!vrnInput.trim() || vrnLooking) ? '#334155' : COLORS.accent,
              color: '#fff', fontSize: '13px', fontWeight: 700,
              cursor: (!vrnInput.trim() || vrnLooking) ? 'not-allowed' : 'pointer',
              opacity: (!vrnInput.trim() || vrnLooking) ? 0.6 : 1,
              whiteSpace: 'nowrap',
            }}
          >
            {vrnLooking ? '...' : 'Look Up'}
          </button>
        </div>

        {vrnError && (
          <p style={{ fontSize: '12px', color: COLORS.fault, margin: '4px 0 8px' }}>{vrnError}</p>
        )}

        {dvlaResult && (
          <div style={{
            background: '#0f172a', borderRadius: '10px',
            border: `1px solid ${COLORS.ok}30`,
            padding: '10px 12px', marginTop: '4px', marginBottom: '12px',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
              <span style={{ fontSize: '14px', fontWeight: 700, color: COLORS.text }}>
                {dvlaResult.make} — {dvlaResult.colour.charAt(0)}{dvlaResult.colour.slice(1).toLowerCase()}
              </span>
              <Badge label={dvlaResult.yearOfManufacture.toString()} variant="info" />
            </div>
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '6px' }}>
              <Badge label={dvlaResult.fuelType} variant="info" />
              <Badge label={`${dvlaResult.engineCapacity}cc`} variant="info" />
              {dvlaResult.co2Emissions && <Badge label={`${dvlaResult.co2Emissions}g CO₂`} variant="info" />}
            </div>
            <div style={{ display: 'flex', gap: '12px' }}>
              <span style={{ fontSize: '11px', color: dvlaResult.motStatus === 'Valid' ? COLORS.ok : COLORS.fault }}>
                MOT: {dvlaResult.motStatus}
              </span>
              <span style={{ fontSize: '11px', color: dvlaResult.taxStatus === 'Taxed' ? COLORS.ok : COLORS.fault }}>
                Tax: {dvlaResult.taxStatus}
              </span>
            </div>
          </div>
        )}

        {!dvlaResult && !vrnError && (
          <p style={{ fontSize: '11px', color: COLORS.textMuted, margin: '0 0 12px', lineHeight: 1.3 }}>
            Enter a UK registration to look up make, model, MOT &amp; tax status.
          </p>
        )}

        {/* Nickname */}
        <label style={{ fontSize: '12px', color: COLORS.textDim, fontWeight: 600, display: 'block', marginBottom: '6px' }}>
          Nickname *
        </label>
        <input
          type="text"
          value={nickname}
          onChange={e => setNickname(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSubmit()}
          placeholder="e.g. Betty, Daily Driver"
          style={{ ...inputStyle, marginBottom: '12px' }}
        />

        {/* VIN */}
        <label style={{ fontSize: '12px', color: COLORS.textDim, fontWeight: 600, display: 'block', marginBottom: '6px' }}>
          VIN (optional)
        </label>
        <input
          type="text"
          value={vinInput}
          onChange={e => setVinInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSubmit()}
          placeholder="17-character VIN"
          maxLength={17}
          style={{
            ...inputStyle,
            fontFamily: 'monospace', letterSpacing: '1px',
            marginBottom: '16px',
          }}
        />
        <p style={{ fontSize: '11px', color: COLORS.textMuted, margin: '-12px 0 16px', lineHeight: 1.3 }}>
          If provided, the VIN will be decoded to identify your vehicle. You can also read the VIN from the car later.
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
            onClick={handleSubmit}
            disabled={!nickname.trim()}
            style={{
              flex: 1, padding: '12px', borderRadius: '10px', border: 'none',
              background: !nickname.trim() ? '#334155' : COLORS.accent,
              color: '#fff', fontSize: '14px', fontWeight: 700,
              cursor: !nickname.trim() ? 'not-allowed' : 'pointer',
              opacity: !nickname.trim() ? 0.6 : 1,
            }}
          >
            Add Vehicle
          </button>
        </div>
      </div>
    </div>
  );
}
