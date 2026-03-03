import React, { useState, useEffect } from 'react';
import { Card, Badge, COLORS, ActionButton, InfoRow } from '../components/shared.jsx';
import { getDatabaseSize } from '../obd/dtc-database.js';
import { getAuditLog } from '../obd/command-safety.js';
import { getRoofDatabaseSize } from '../obd/roof-codes.js';
import { PIDS } from '../obd/obd-pids.js';

const SERVICE_TYPES = [
  'Oil Change', 'Tyres', 'Brake Pads', 'Brake Discs',
  'Air Filter', 'Spark Plugs', 'Coolant', 'Other',
];

export default function VehicleView({ connected, vinData, batteryVoltage, supportedPIDs, adapterInfo, readingVehicle, onReadVehicle, vehicles, activeVehicle, onSelectVehicle, onShowAddVehicle, onAddCurrentVehicle, onEditVehicle, onDeleteVehicle, onUpdateDtcStatus, expiryWarnings, onAddService, onDeleteService }) {
  const [editingNickname, setEditingNickname] = useState(false);
  const [nicknameInput, setNicknameInput] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [shareStatus, setShareStatus] = useState(null);
  const [addingService, setAddingService] = useState(false);
  const [serviceType, setServiceType] = useState(SERVICE_TYPES[0]);
  const [serviceDate, setServiceDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [serviceMileage, setServiceMileage] = useState('');
  const [serviceNotes, setServiceNotes] = useState('');
  const [serviceNextDate, setServiceNextDate] = useState('');
  const [serviceNextMileage, setServiceNextMileage] = useState('');

  const severityColor = { info: COLORS.accent, warning: COLORS.warn, critical: COLORS.fault };
  const statusColor = { active: COLORS.fault, explored: COLORS.warn, fixed: COLORS.ok };

  // Reset edit/delete state when active vehicle changes
  useEffect(() => {
    setEditingNickname(false);
    setConfirmDelete(false);
  }, [activeVehicle?.id]);

  const startEdit = () => {
    setNicknameInput(activeVehicle?.nickname || '');
    setEditingNickname(true);
  };
  const saveEdit = () => {
    if (nicknameInput.trim() && activeVehicle) {
      onEditVehicle(activeVehicle.id, nicknameInput.trim());
    }
    setEditingNickname(false);
  };

  const handleShareReport = async () => {
    if (!activeVehicle) return;
    const v = activeVehicle;
    const lines = [`Vehicle Report: ${v.nickname}`, ''];
    if (v.vrn) lines.push(`Registration: ${v.vrn}`);
    if (v.dvlaData) {
      const d = v.dvlaData;
      lines.push(`Make: ${d.make}`, `Colour: ${d.colour}`, `Year: ${d.yearOfManufacture}`);
      if (d.engineCapacity) lines.push(`Engine: ${d.engineCapacity}cc ${d.fuelType}`);
      lines.push(`MOT: ${d.motStatus}${d.motExpiryDate ? ` (expires ${d.motExpiryDate})` : ''}`);
      lines.push(`Tax: ${d.taxStatus}${d.taxDueDate ? ` (due ${d.taxDueDate})` : ''}`);
    }
    if (v.vinData?.valid) {
      lines.push('', `VIN: ${v.vinData.vin}`);
      if (v.vinData.model) lines.push(`Model: MINI ${v.vinData.model}`);
      if (v.vinData.chassis) lines.push(`Chassis: ${v.vinData.chassis}`);
    }
    if (batteryVoltage) lines.push('', `Battery: ${batteryVoltage}`);
    if (v.dtcHistory?.length > 0) {
      lines.push('', `Fault History (${v.dtcHistory.length}):`);
      v.dtcHistory.forEach(d => lines.push(`  ${d.code} — ${d.desc} [${d.status}] x${d.occurrences}`));
    }
    const log = v.serviceLog || [];
    if (log.length > 0) {
      lines.push('', `Service Log (${log.length}):`);
      [...log].sort((a, b) => b.date.localeCompare(a.date)).forEach(s => {
        lines.push(`  ${s.date} — ${s.type}${s.mileage ? ` @ ${s.mileage} mi` : ''}${s.notes ? ` — ${s.notes}` : ''}`);
      });
    }
    const text = lines.join('\n');
    try {
      if (navigator.share) {
        await navigator.share({ title: `${v.nickname} Report`, text });
        setShareStatus('Shared!');
      } else {
        await navigator.clipboard.writeText(text);
        setShareStatus('Copied!');
      }
    } catch {
      setShareStatus('Share failed');
    }
    setTimeout(() => setShareStatus(null), 2500);
  };

  const handleSubmitService = () => {
    if (!activeVehicle || !serviceDate) return;
    const entry = {
      id: `svc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      type: serviceType,
      date: serviceDate,
      mileage: serviceMileage ? Number(serviceMileage) : null,
      notes: serviceNotes.trim() || null,
      nextDueDate: serviceNextDate || null,
      nextDueMileage: serviceNextMileage ? Number(serviceNextMileage) : null,
    };
    onAddService(activeVehicle.id, entry);
    setAddingService(false);
    setServiceType(SERVICE_TYPES[0]);
    setServiceDate(new Date().toISOString().split('T')[0]);
    setServiceMileage('');
    setServiceNotes('');
    setServiceNextDate('');
    setServiceNextMileage('');
  };

  // Filter warnings for active vehicle
  const vehicleWarnings = activeVehicle ? expiryWarnings.filter(w => w.vehicleId === activeVehicle.id) : [];
  const serviceLog = [...(activeVehicle?.serviceLog || [])].sort((a, b) => b.date.localeCompare(a.date));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', paddingTop: '8px' }}>
      {/* Vehicle switcher strip */}
      <div style={{
        display: 'flex', gap: '8px', overflowX: 'auto', paddingBottom: '4px',
        WebkitOverflowScrolling: 'touch', scrollbarWidth: 'none',
      }}>
        {vehicles.map(v => (
          <button
            key={v.id}
            onClick={() => onSelectVehicle(v.id)}
            style={{
              padding: '6px 14px', borderRadius: '16px', border: 'none',
              background: v.id === activeVehicle?.id ? COLORS.accent : '#1e293b',
              color: v.id === activeVehicle?.id ? '#fff' : COLORS.textDim,
              fontSize: '12px', fontWeight: 600, cursor: 'pointer',
              whiteSpace: 'nowrap', flexShrink: 0,
              transition: 'all 0.2s',
            }}
          >
            {v.nickname}
          </button>
        ))}
        <button
          onClick={onShowAddVehicle}
          style={{
            padding: '6px 14px', borderRadius: '16px',
            border: `1px dashed ${COLORS.accent}60`,
            background: 'transparent', color: COLORS.accent,
            fontSize: '12px', fontWeight: 600, cursor: 'pointer',
            whiteSpace: 'nowrap', flexShrink: 0,
          }}
        >
          + Add
        </button>
        {connected && (
          <button
            onClick={onAddCurrentVehicle}
            disabled={readingVehicle}
            style={{
              padding: '6px 14px', borderRadius: '16px',
              border: `1px solid ${COLORS.ok}60`,
              background: `${COLORS.ok}15`, color: COLORS.ok,
              fontSize: '12px', fontWeight: 600,
              cursor: readingVehicle ? 'not-allowed' : 'pointer',
              opacity: readingVehicle ? 0.5 : 1,
              whiteSpace: 'nowrap', flexShrink: 0,
            }}
          >
            {readingVehicle ? '⟳ Reading...' : '⚡ Add Current'}
          </button>
        )}
      </div>

      {/* Expiry warnings */}
      {vehicleWarnings.length > 0 && (
        <Card style={{ borderColor: vehicleWarnings.some(w => w.expired) ? `${COLORS.fault}40` : `${COLORS.warn}40` }}>
          <p style={{ fontSize: '12px', color: COLORS.textDim, fontWeight: 600, marginBottom: '8px' }}>Expiry Warnings</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {vehicleWarnings.map(w => (
              <div key={`${w.type}-${w.vehicleId}`} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '8px 10px', borderRadius: '8px',
                background: w.expired ? `${COLORS.fault}12` : `${COLORS.warn}12`,
                borderLeft: `3px solid ${w.expired ? COLORS.fault : COLORS.warn}`,
              }}>
                <div>
                  <span style={{ fontSize: '13px', fontWeight: 600, color: COLORS.text }}>{w.type}</span>
                  <span style={{ fontSize: '11px', color: COLORS.textMuted, marginLeft: '8px' }}>{w.date}</span>
                </div>
                <Badge
                  label={w.expired ? 'EXPIRED' : `${w.daysRemaining}d`}
                  variant={w.expired ? 'fault' : 'warn'}
                />
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Read Vehicle Info — only when connected */}
      {connected && (
        <ActionButton
          label={readingVehicle ? 'Reading...' : 'Read Vehicle Info'}
          color={COLORS.accent}
          onClick={onReadVehicle}
          disabled={readingVehicle}
        />
      )}
      {!connected && vehicles.length === 0 && (
        <div style={{ textAlign: 'center', padding: '30px 0', color: COLORS.textMuted }}>
          <div style={{ fontSize: '40px', marginBottom: '12px' }}>🔌</div>
          <p style={{ fontSize: '15px', fontWeight: 600, color: COLORS.textDim }}>Not Connected</p>
          <p style={{ fontSize: '12px', marginTop: '4px' }}>Connect to read vehicle info, or tap "+ Add" to add a vehicle manually</p>
        </div>
      )}

      {/* Active vehicle nickname + edit/delete */}
      {activeVehicle && (
        <Card>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            {editingNickname ? (
              <div style={{ display: 'flex', gap: '6px', flex: 1 }}>
                <input
                  type="text"
                  value={nicknameInput}
                  onChange={e => setNicknameInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && saveEdit()}
                  autoFocus
                  style={{
                    flex: 1, padding: '6px 10px', borderRadius: '8px',
                    background: '#1e293b', color: COLORS.text,
                    border: `1px solid ${COLORS.accent}`,
                    fontSize: '14px', outline: 'none',
                  }}
                />
                <button onClick={saveEdit} style={{
                  padding: '6px 12px', borderRadius: '8px', border: 'none',
                  background: COLORS.ok, color: '#fff', fontSize: '12px', fontWeight: 600, cursor: 'pointer',
                }}>Save</button>
                <button onClick={() => setEditingNickname(false)} style={{
                  padding: '6px 12px', borderRadius: '8px', border: 'none',
                  background: '#334155', color: COLORS.textDim, fontSize: '12px', fontWeight: 600, cursor: 'pointer',
                }}>Cancel</button>
              </div>
            ) : (
              <>
                <div>
                  <p style={{ fontSize: '16px', fontWeight: 700, color: COLORS.text, margin: 0 }}>
                    {activeVehicle.nickname}
                  </p>
                  <p style={{ fontSize: '11px', color: COLORS.textMuted, margin: '2px 0 0' }}>
                    Added {new Date(activeVehicle.addedAt).toLocaleDateString()}
                  </p>
                </div>
                <div style={{ display: 'flex', gap: '6px' }}>
                  <button onClick={startEdit} style={{
                    padding: '6px 10px', borderRadius: '8px', border: 'none',
                    background: '#1e293b', color: COLORS.textDim, fontSize: '12px', cursor: 'pointer',
                  }}>✏️</button>
                  {confirmDelete ? (
                    <>
                      <button onClick={() => { onDeleteVehicle(activeVehicle.id); setConfirmDelete(false); }} style={{
                        padding: '6px 10px', borderRadius: '8px', border: 'none',
                        background: COLORS.fault, color: '#fff', fontSize: '11px', fontWeight: 600, cursor: 'pointer',
                      }}>Confirm</button>
                      <button onClick={() => setConfirmDelete(false)} style={{
                        padding: '6px 10px', borderRadius: '8px', border: 'none',
                        background: '#334155', color: COLORS.textDim, fontSize: '11px', fontWeight: 600, cursor: 'pointer',
                      }}>Cancel</button>
                    </>
                  ) : (
                    <button onClick={() => setConfirmDelete(true)} style={{
                      padding: '6px 10px', borderRadius: '8px', border: 'none',
                      background: '#1e293b', color: COLORS.textDim, fontSize: '12px', cursor: 'pointer',
                    }}>🗑️</button>
                  )}
                </div>
              </>
            )}
          </div>
        </Card>
      )}

      {/* VIN */}
      {vinData && vinData.valid && (
        <Card>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
            <p style={{ fontSize: '12px', color: COLORS.textDim, fontWeight: 600, margin: 0 }}>Vehicle Identification</p>
            {vinData.isR56 && <Badge label="R56 Hatchback" variant="ok" />}
            {vinData.isR57 && <Badge label="R57 Convertible" variant="ok" />}
            {vinData.isMini && !vinData.isR56 && !vinData.isR57 && vinData.chassis && <Badge label={vinData.chassis} variant="info" />}
            {vinData.isMini && !vinData.chassis && <Badge label="MINI" variant="info" />}
          </div>
          <div style={{
            padding: '10px', borderRadius: '8px', background: '#1e293b',
            fontFamily: 'monospace', fontSize: '15px', fontWeight: 700,
            color: COLORS.accent, textAlign: 'center', letterSpacing: '2px',
            marginBottom: '10px',
          }}>
            {vinData.vin}
          </div>
          <InfoRow label="Manufacturer" value={vinData.manufacturer} />
          {vinData.model && <InfoRow label="Model" value={`MINI ${vinData.model}`} />}
          {vinData.chassis && <InfoRow label="Chassis" value={vinData.chassis} />}
          {vinData.bodyType && <InfoRow label="Body" value={vinData.bodyType} />}
          {vinData.modelYear && <InfoRow label="Model Year" value={vinData.modelYear} />}
          <InfoRow label="Serial" value={vinData.serial} />
        </Card>
      )}

      {vinData && !vinData.valid && (
        <Card style={{ borderColor: `${COLORS.warn}40` }}>
          <p style={{ color: COLORS.warn, fontSize: '13px', margin: 0 }}>
            VIN read failed: {vinData.error}
          </p>
        </Card>
      )}

      {/* DVLA Data */}
      {activeVehicle?.dvlaData && (
        <Card>
          <p style={{ fontSize: '12px', color: COLORS.textDim, fontWeight: 600, marginBottom: '10px' }}>DVLA Vehicle Data</p>
          <div style={{
            padding: '10px', borderRadius: '8px', background: '#1e293b',
            fontFamily: 'monospace', fontSize: '17px', fontWeight: 700,
            color: COLORS.accent, textAlign: 'center', letterSpacing: '3px',
            marginBottom: '10px',
          }}>
            {activeVehicle.dvlaData.registrationNumber}
          </div>
          <InfoRow label="Make" value={activeVehicle.dvlaData.make} />
          <InfoRow label="Colour" value={activeVehicle.dvlaData.colour} />
          <InfoRow label="Year" value={activeVehicle.dvlaData.yearOfManufacture} />
          <InfoRow label="Engine" value={activeVehicle.dvlaData.engineCapacity ? `${activeVehicle.dvlaData.engineCapacity}cc` : null} />
          <InfoRow label="Fuel" value={activeVehicle.dvlaData.fuelType} />
          {activeVehicle.dvlaData.co2Emissions && (
            <InfoRow label="CO₂" value={`${activeVehicle.dvlaData.co2Emissions} g/km`} />
          )}
          <div style={{ marginTop: '8px', display: 'flex', gap: '12px' }}>
            <div style={{ flex: 1 }}>
              <p style={{ fontSize: '11px', color: COLORS.textMuted, margin: '0 0 2px' }}>MOT</p>
              <p style={{
                fontSize: '13px', fontWeight: 600, margin: 0,
                color: activeVehicle.dvlaData.motStatus === 'Valid' ? COLORS.ok : COLORS.fault,
              }}>
                {activeVehicle.dvlaData.motStatus}
              </p>
              {activeVehicle.dvlaData.motExpiryDate && (
                <p style={{ fontSize: '11px', color: COLORS.textMuted, margin: '2px 0 0' }}>
                  Expires {activeVehicle.dvlaData.motExpiryDate}
                </p>
              )}
            </div>
            <div style={{ flex: 1 }}>
              <p style={{ fontSize: '11px', color: COLORS.textMuted, margin: '0 0 2px' }}>Tax</p>
              <p style={{
                fontSize: '13px', fontWeight: 600, margin: 0,
                color: activeVehicle.dvlaData.taxStatus === 'Taxed' ? COLORS.ok : COLORS.fault,
              }}>
                {activeVehicle.dvlaData.taxStatus}
              </p>
              {activeVehicle.dvlaData.taxDueDate && (
                <p style={{ fontSize: '11px', color: COLORS.textMuted, margin: '2px 0 0' }}>
                  Due {activeVehicle.dvlaData.taxDueDate}
                </p>
              )}
            </div>
          </div>
        </Card>
      )}

      {/* Service Log */}
      {activeVehicle && (
        <Card>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
            <p style={{ fontSize: '12px', color: COLORS.textDim, fontWeight: 600, margin: 0 }}>Service Log</p>
            {serviceLog.length > 0 && <Badge label={`${serviceLog.length}`} variant="info" />}
          </div>

          {/* Add service button / form */}
          {addingService ? (
            <div style={{
              padding: '12px', borderRadius: '10px', background: '#0f172a',
              border: `1px solid ${COLORS.bgCardBorder}`, marginBottom: '10px',
              display: 'flex', flexDirection: 'column', gap: '8px',
            }}>
              <select
                value={serviceType}
                onChange={e => setServiceType(e.target.value)}
                style={{
                  width: '100%', padding: '8px 10px', borderRadius: '8px',
                  background: '#1e293b', color: COLORS.text, border: `1px solid ${COLORS.bgCardBorder}`,
                  fontSize: '13px', outline: 'none',
                }}
              >
                {SERVICE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
              <div style={{ display: 'flex', gap: '6px' }}>
                <input type="date" value={serviceDate} onChange={e => setServiceDate(e.target.value)}
                  style={{
                    flex: 1, padding: '8px 10px', borderRadius: '8px',
                    background: '#1e293b', color: COLORS.text, border: `1px solid ${COLORS.bgCardBorder}`,
                    fontSize: '13px', outline: 'none',
                  }}
                />
                <input type="number" value={serviceMileage} onChange={e => setServiceMileage(e.target.value)}
                  placeholder="Mileage"
                  style={{
                    width: '100px', padding: '8px 10px', borderRadius: '8px',
                    background: '#1e293b', color: COLORS.text, border: `1px solid ${COLORS.bgCardBorder}`,
                    fontSize: '13px', outline: 'none',
                  }}
                />
              </div>
              <input type="text" value={serviceNotes} onChange={e => setServiceNotes(e.target.value)}
                placeholder="Notes (optional)"
                style={{
                  width: '100%', padding: '8px 10px', borderRadius: '8px', boxSizing: 'border-box',
                  background: '#1e293b', color: COLORS.text, border: `1px solid ${COLORS.bgCardBorder}`,
                  fontSize: '13px', outline: 'none',
                }}
              />
              <p style={{ fontSize: '11px', color: COLORS.textDim, fontWeight: 600, margin: '4px 0 0' }}>Next Due (optional)</p>
              <div style={{ display: 'flex', gap: '6px' }}>
                <input type="date" value={serviceNextDate} onChange={e => setServiceNextDate(e.target.value)}
                  style={{
                    flex: 1, padding: '8px 10px', borderRadius: '8px',
                    background: '#1e293b', color: COLORS.text, border: `1px solid ${COLORS.bgCardBorder}`,
                    fontSize: '13px', outline: 'none',
                  }}
                />
                <input type="number" value={serviceNextMileage} onChange={e => setServiceNextMileage(e.target.value)}
                  placeholder="Next mileage"
                  style={{
                    width: '110px', padding: '8px 10px', borderRadius: '8px',
                    background: '#1e293b', color: COLORS.text, border: `1px solid ${COLORS.bgCardBorder}`,
                    fontSize: '13px', outline: 'none',
                  }}
                />
              </div>
              <div style={{ display: 'flex', gap: '6px' }}>
                <button onClick={handleSubmitService} style={{
                  flex: 1, padding: '10px', borderRadius: '8px', border: 'none',
                  background: COLORS.ok, color: '#fff', fontSize: '13px', fontWeight: 600, cursor: 'pointer',
                }}>Save</button>
                <button onClick={() => setAddingService(false)} style={{
                  padding: '10px 16px', borderRadius: '8px', border: 'none',
                  background: '#334155', color: COLORS.textDim, fontSize: '13px', fontWeight: 600, cursor: 'pointer',
                }}>Cancel</button>
              </div>
            </div>
          ) : (
            <button onClick={() => setAddingService(true)} style={{
              width: '100%', padding: '10px', borderRadius: '10px',
              border: `1px dashed ${COLORS.accent}60`, background: 'transparent',
              color: COLORS.accent, fontSize: '13px', fontWeight: 600,
              cursor: 'pointer', marginBottom: serviceLog.length > 0 ? '10px' : 0,
            }}>
              + Add Service
            </button>
          )}

          {/* Service list */}
          {serviceLog.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {serviceLog.map(s => {
                const now = new Date();
                let dueBadge = null;
                if (s.nextDueDate) {
                  const dueDate = new Date(s.nextDueDate);
                  const daysUntil = Math.ceil((dueDate - now) / (1000 * 60 * 60 * 24));
                  if (daysUntil < 0) dueBadge = { label: 'OVERDUE', variant: 'fault' };
                  else if (daysUntil <= 30) dueBadge = { label: 'DUE SOON', variant: 'warn' };
                }
                return (
                  <div key={s.id} style={{
                    padding: '8px 10px', borderRadius: '8px', background: '#0f172a',
                    borderLeft: `3px solid ${dueBadge?.variant === 'fault' ? COLORS.fault : dueBadge?.variant === 'warn' ? COLORS.warn : COLORS.accent}`,
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span style={{ fontSize: '13px', fontWeight: 600, color: COLORS.text }}>{s.type}</span>
                        {dueBadge && <Badge label={dueBadge.label} variant={dueBadge.variant} />}
                      </div>
                      <button onClick={() => onDeleteService(activeVehicle.id, s.id)} style={{
                        padding: '2px 6px', borderRadius: '4px', border: 'none',
                        background: 'transparent', color: COLORS.textMuted, fontSize: '12px',
                        cursor: 'pointer',
                      }}>✕</button>
                    </div>
                    <div style={{ fontSize: '11px', color: COLORS.textMuted, marginTop: '2px', display: 'flex', gap: '10px' }}>
                      <span>{s.date}</span>
                      {s.mileage && <span>{s.mileage.toLocaleString()} mi</span>}
                    </div>
                    {s.notes && <p style={{ fontSize: '11px', color: COLORS.textDim, margin: '3px 0 0' }}>{s.notes}</p>}
                    {(s.nextDueDate || s.nextDueMileage) && (
                      <p style={{ fontSize: '10px', color: COLORS.textMuted, margin: '3px 0 0' }}>
                        Next: {s.nextDueDate || ''}{s.nextDueDate && s.nextDueMileage ? ' / ' : ''}{s.nextDueMileage ? `${s.nextDueMileage.toLocaleString()} mi` : ''}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          {serviceLog.length === 0 && !addingService && (
            <p style={{ fontSize: '12px', color: COLORS.textMuted, margin: '8px 0 0' }}>
              No services logged yet.
            </p>
          )}
        </Card>
      )}

      {/* Battery voltage */}
      {batteryVoltage && (
        <Card>
          <p style={{ fontSize: '12px', color: COLORS.textDim, fontWeight: 600, marginBottom: '8px' }}>Battery</p>
          <div style={{ fontSize: '28px', fontWeight: 700, color: COLORS.text }}>
            {batteryVoltage}
          </div>
        </Card>
      )}

      {/* DTC History */}
      {activeVehicle && (
        <Card>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
            <p style={{ fontSize: '12px', color: COLORS.textDim, fontWeight: 600, margin: 0 }}>Fault History</p>
            {activeVehicle.dtcHistory?.length > 0 && (
              <Badge label={`${activeVehicle.dtcHistory.length}`} variant="info" />
            )}
          </div>
          {(!activeVehicle.dtcHistory || activeVehicle.dtcHistory.length === 0) ? (
            <p style={{ fontSize: '12px', color: COLORS.textMuted, margin: 0 }}>
              No fault history yet. Read DTCs on the Diagnostics tab to start tracking.
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {[...activeVehicle.dtcHistory]
                .sort((a, b) => (a.status === 'fixed' ? 1 : 0) - (b.status === 'fixed' ? 1 : 0))
                .map(dtc => (
                  <div key={dtc.id} style={{
                    padding: '10px', borderRadius: '8px',
                    background: `${severityColor[dtc.severity] || COLORS.accent}08`,
                    borderLeft: `3px solid ${statusColor[dtc.status] || COLORS.fault}`,
                    opacity: dtc.status === 'fixed' ? 0.5 : 1,
                    transition: 'opacity 0.2s',
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '14px', fontWeight: 700, fontFamily: 'monospace', color: COLORS.text }}>
                        {dtc.code}
                      </span>
                      <div style={{ display: 'flex', gap: '4px' }}>
                        <Badge label={dtc.severity} variant={dtc.severity === 'critical' ? 'fault' : dtc.severity === 'warning' ? 'warn' : 'info'} />
                        <Badge label={dtc.source} variant="info" />
                      </div>
                    </div>
                    <p style={{ fontSize: '12px', color: COLORS.textDim, margin: '4px 0' }}>{dtc.desc}</p>
                    <div style={{ fontSize: '10px', color: COLORS.textMuted, display: 'flex', gap: '12px', marginBottom: '6px' }}>
                      <span>First: {new Date(dtc.firstSeen).toLocaleDateString()}</span>
                      <span>Last: {new Date(dtc.lastSeen).toLocaleDateString()}</span>
                      <span>×{dtc.occurrences}</span>
                    </div>
                    <div style={{ display: 'flex', gap: '4px' }}>
                      {['active', 'explored', 'fixed'].map(s => (
                        <button
                          key={s}
                          onClick={() => onUpdateDtcStatus(activeVehicle.id, dtc.id, s)}
                          style={{
                            flex: 1, padding: '5px 8px', borderRadius: '6px', border: 'none',
                            background: dtc.status === s ? statusColor[s] : '#1e293b',
                            color: dtc.status === s ? '#fff' : COLORS.textMuted,
                            fontSize: '10px', fontWeight: 600, cursor: 'pointer',
                            textTransform: 'capitalize', transition: 'all 0.2s',
                          }}
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
            </div>
          )}
        </Card>
      )}

      {/* Supported PIDs grid */}
      {supportedPIDs.size > 0 && (
        <Card>
          <p style={{ fontSize: '12px', color: COLORS.textDim, fontWeight: 600, marginBottom: '10px' }}>
            Supported PIDs ({supportedPIDs.size})
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
            {[...supportedPIDs].sort().map((pid) => {
              const def = PIDS[pid];
              return (
                <span key={pid} style={{
                  padding: '4px 8px', borderRadius: '6px', fontSize: '11px',
                  fontFamily: 'monospace', fontWeight: 600,
                  background: def ? `${COLORS.ok}20` : `${COLORS.accent}15`,
                  color: def ? COLORS.ok : COLORS.textDim,
                }} title={def?.description || 'Unknown PID'}>
                  {pid}
                </span>
              );
            })}
          </div>
        </Card>
      )}

      {/* Adapter info */}
      {adapterInfo && (
        <Card>
          <p style={{ fontSize: '12px', color: COLORS.textDim, fontWeight: 600, marginBottom: '8px' }}>Adapter</p>
          <InfoRow label="Device" value={adapterInfo.deviceName} />
          <InfoRow label="ELM327" value={adapterInfo.elmVersion} />
          <InfoRow label="Protocol" value={adapterInfo.protocol} />
        </Card>
      )}

      {/* Share report */}
      {activeVehicle && (
        <ActionButton
          label={shareStatus || 'Share Vehicle Report'}
          color={shareStatus === 'Share failed' ? COLORS.fault : shareStatus ? COLORS.ok : COLORS.accent}
          onClick={handleShareReport}
          disabled={!!shareStatus}
        />
      )}

      {/* DB stats */}
      <Card>
        <p style={{ fontSize: '12px', color: COLORS.textDim, fontWeight: 600, marginBottom: '8px' }}>Database</p>
        <InfoRow label="Known DTCs" value={getDatabaseSize()} />
        <InfoRow label="R57 Roof Codes" value={getRoofDatabaseSize()} />
        <InfoRow label="Tracked PIDs" value={Object.keys(PIDS).length} />
        <InfoRow label="Safety audit log" value={`${getAuditLog().length} entries`} />
      </Card>

      {/* Empty state — no vehicles at all */}
      {vehicles.length === 0 && !readingVehicle && (
        <div style={{ textAlign: 'center', padding: '30px 0', color: COLORS.textMuted }}>
          <div style={{ fontSize: '36px', marginBottom: '8px' }}>🚗</div>
          <p style={{ fontSize: '13px' }}>Add a vehicle or connect to read your VIN</p>
        </div>
      )}
    </div>
  );
}
