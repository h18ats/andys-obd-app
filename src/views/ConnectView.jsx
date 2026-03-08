import React from 'react';
import { Card, Badge, ActionButton, InfoRow, COLORS, SignalBars } from '../components/shared.jsx';
import { ADAPTER_PROFILES, OBD_PROTOCOLS } from '../obd/adapter-profiles.js';

export default function ConnectView({ scanning, devices, connecting, connected, connectionError, connectStatus, selectedProfile, selectedProtocol, customProfiles, adapterInfo, onScan, onConnect, onDisconnect, onProfileChange, onProtocolChange, onShowCustomProfile, onDeleteCustomProfile, onDemoMode }) {
  const selectStyle = {
    width: '100%', padding: '10px 12px', borderRadius: '10px',
    background: '#1e293b', color: COLORS.text, border: `1px solid ${COLORS.bgCardBorder}`,
    fontSize: '14px', outline: 'none',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', paddingTop: '8px' }}>
      {/* Profile selector */}
      <Card>
        <label style={{ fontSize: '12px', color: COLORS.textDim, fontWeight: 600, marginBottom: '8px', display: 'block' }}>
          Adapter Profile
        </label>
        <select
          value={selectedProfile}
          onChange={(e) => onProfileChange(e.target.value)}
          disabled={connected}
          style={selectStyle}
        >
          <option value="auto">Auto-detect</option>
          {Object.entries(ADAPTER_PROFILES).map(([key, p]) => (
            <option key={key} value={key}>{p.name}</option>
          ))}
          {customProfiles.length > 0 && (
            <optgroup label="Custom Profiles">
              {customProfiles.map(cp => (
                <option key={cp.id} value={cp.id}>{cp.name}</option>
              ))}
            </optgroup>
          )}
        </select>

        {/* Custom profile cards */}
        {customProfiles.length > 0 && (
          <div style={{ marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {customProfiles.map(cp => (
              <div key={cp.id} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '8px 10px', borderRadius: '8px', background: '#0f172a',
                border: `1px solid ${COLORS.bgCardBorder}`,
              }}>
                <div>
                  <div style={{ fontSize: '13px', fontWeight: 600, color: COLORS.text }}>{cp.name}</div>
                  <div style={{ fontSize: '10px', color: COLORS.textMuted, fontFamily: 'monospace', marginTop: '2px' }}>
                    {cp.serviceUUID} / MTU {cp.mtu}
                  </div>
                </div>
                <button
                  onClick={() => onDeleteCustomProfile(cp.id)}
                  disabled={connected}
                  style={{
                    padding: '4px 8px', borderRadius: '6px', border: 'none',
                    background: `${COLORS.fault}20`, color: COLORS.fault,
                    fontSize: '11px', fontWeight: 600, cursor: connected ? 'not-allowed' : 'pointer',
                    opacity: connected ? 0.4 : 1,
                  }}
                >
                  Delete
                </button>
              </div>
            ))}
          </div>
        )}

        {!connected && (
          <button
            onClick={onShowCustomProfile}
            style={{
              marginTop: '10px', padding: '6px 0', width: '100%',
              background: 'none', border: 'none',
              color: COLORS.accent, fontSize: '13px', fontWeight: 600,
              cursor: 'pointer', textAlign: 'center',
            }}
          >
            + Custom Profile
          </button>
        )}
      </Card>

      {/* Protocol selector */}
      <Card>
        <label style={{ fontSize: '12px', color: COLORS.textDim, fontWeight: 600, marginBottom: '8px', display: 'block' }}>
          OBD Protocol
        </label>
        <select
          value={selectedProtocol}
          onChange={(e) => onProtocolChange(e.target.value)}
          disabled={connected}
          style={selectStyle}
        >
          {OBD_PROTOCOLS.map(p => (
            <option key={p.code} value={p.code}>
              {p.label} ({p.desc})
            </option>
          ))}
        </select>
        {selectedProtocol === '0' && (
          <p style={{ fontSize: '11px', color: COLORS.textMuted, margin: '6px 0 0' }}>
            Auto-detect tries all protocols. Slower initial connect (~10s).
          </p>
        )}
      </Card>

      {/* Scan / Disconnect button */}
      {connected ? (
        <ActionButton label="Disconnect" color={COLORS.fault} onClick={onDisconnect} />
      ) : (
        <ActionButton
          label={scanning ? 'Scanning...' : 'Scan for Adapters'}
          color={COLORS.accent}
          onClick={onScan}
          disabled={scanning || connecting}
        />
      )}

      {/* Connection progress */}
      {connecting && connectStatus && (
        <Card style={{ borderColor: `${COLORS.accent}40` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{ width: '16px', height: '16px', border: `2px solid ${COLORS.accent}`, borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
            <p style={{ color: COLORS.accent, fontSize: '13px', margin: 0 }}>{connectStatus}</p>
          </div>
        </Card>
      )}

      {/* Connection error */}
      {connectionError && (
        <Card style={{ borderColor: `${COLORS.fault}40` }}>
          <p style={{ color: COLORS.fault, fontSize: '13px', margin: 0 }}>{connectionError}</p>
        </Card>
      )}

      {/* Discovered devices */}
      {devices.length > 0 && !connected && (
        <Card>
          <p style={{ fontSize: '12px', color: COLORS.textDim, fontWeight: 600, marginBottom: '10px' }}>
            Discovered Adapters ({devices.length})
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {devices.map((device) => (
              <button
                key={device.deviceId}
                onClick={() => onConnect(device)}
                disabled={connecting}
                style={{
                  padding: '12px',
                  borderRadius: '10px',
                  background: '#1e293b',
                  border: `1px solid ${COLORS.bgCardBorder}`,
                  cursor: connecting ? 'wait' : 'pointer',
                  textAlign: 'left',
                  color: COLORS.text,
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <div>
                  <div style={{ fontSize: '14px', fontWeight: 600 }}>{device.name}</div>
                  <div style={{ fontSize: '11px', color: COLORS.textMuted, marginTop: '2px' }}>
                    {device.deviceId.substring(0, 17)}...
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <SignalBars rssi={device.rssi} />
                  <span style={{ fontSize: '11px', color: COLORS.textMuted }}>{device.rssi} dBm</span>
                </div>
              </button>
            ))}
          </div>
        </Card>
      )}

      {/* Connected adapter info */}
      {connected && adapterInfo && (
        <Card>
          <p style={{ fontSize: '12px', color: COLORS.textDim, fontWeight: 600, marginBottom: '10px' }}>
            Connected Adapter
          </p>
          <InfoRow label="Device" value={adapterInfo.deviceName} />
          <InfoRow label="ELM327" value={adapterInfo.elmVersion} />
          <InfoRow label="Protocol" value={adapterInfo.protocol} />
          {adapterInfo.ecuReachable === false && (
            <p style={{ fontSize: '11px', color: COLORS.warn, marginTop: '8px' }}>
              ECU not responding — check ignition is ON (engine off)
            </p>
          )}
          {adapterInfo.diagLog?.length > 0 && (
            <details style={{ marginTop: '10px' }}>
              <summary style={{ fontSize: '11px', color: COLORS.textMuted, cursor: 'pointer' }}>
                Init log ({adapterInfo.diagLog.length} commands)
              </summary>
              <div style={{
                marginTop: '6px', padding: '8px', borderRadius: '6px',
                background: 'rgba(0,0,0,0.3)', fontSize: '10px', fontFamily: 'monospace',
                color: COLORS.textDim, maxHeight: '200px', overflow: 'auto',
                whiteSpace: 'pre-wrap', wordBreak: 'break-all',
              }}>
                {adapterInfo.diagLog.map((d, i) => (
                  <div key={i} style={{ marginBottom: '4px', color: d.threw ? COLORS.fault : COLORS.textDim }}>
                    <span style={{ color: COLORS.accent }}>{d.command}</span>
                    {' → '}
                    {d.raw === null ? <span style={{ color: COLORS.warn }}>TIMEOUT</span> : `"${d.raw}"`}
                    {d.cleaned !== d.raw && d.cleaned !== null && ` → "${d.cleaned}"`}
                    {d.threw && ' ✗'}
                  </div>
                ))}
              </div>
            </details>
          )}
        </Card>
      )}

      {/* Scanning empty state */}
      {scanning && devices.length === 0 && (
        <div style={{ textAlign: 'center', padding: '40px 0', color: COLORS.textMuted }}>
          <div style={{ fontSize: '32px', marginBottom: '12px', animation: 'pulse 1.5s infinite' }}>📡</div>
          <p style={{ fontSize: '14px' }}>Scanning for BLE adapters...</p>
          <p style={{ fontSize: '11px', marginTop: '4px' }}>Make sure your adapter is powered on</p>
        </div>
      )}

      {/* Initial empty state */}
      {!scanning && devices.length === 0 && !connected && (
        <div style={{ textAlign: 'center', padding: '40px 0', color: COLORS.textMuted }}>
          <div style={{ fontSize: '48px', marginBottom: '12px' }}>🔌</div>
          <p style={{ fontSize: '14px' }}>Plug in your OBD adapter and tap Scan</p>
          <p style={{ fontSize: '11px', marginTop: '6px', maxWidth: '260px', margin: '6px auto 0' }}>
            Supports Vgate iCar Pro, OBDLink CX, Veepeak, and generic ELM327 BLE adapters
          </p>
          {onDemoMode && (
            <button
              onClick={onDemoMode}
              style={{
                marginTop: '24px', padding: '10px 24px', borderRadius: '10px',
                background: 'none', border: `1px solid ${COLORS.textMuted}40`,
                color: COLORS.textDim, fontSize: '13px', fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Try Demo Mode
            </button>
          )}
        </div>
      )}
    </div>
  );
}
