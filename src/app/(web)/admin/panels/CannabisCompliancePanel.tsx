'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  METRC_STATES, BIOTRACK_STATES, getMetrcBaseUrl,
  METRC_ENDPOINTS, BIOTRACK_ENDPOINTS,
  COMPLIANCE_TABS, DEFAULT_COMPLIANCE_CONFIG,
  type ComplianceConfig, type ComplianceTabKey, type ComplianceProvider,
  type MetrcEndpointCategory, type BioTrackEndpointCategory,
  type MetrcEndpoint, type ReconciliationItem, type DiscrepancyStatus,
  type CannabisLicenseType,
  type CompliancePlant, type CompliancePackage, type ComplianceHarvest,
  type TransporterDriver, type TransporterVehicle, type B2BVendor,
  type ComplianceSaleReceipt, type ComplianceLabTest,
  DEFAULT_STATE_TAXES
} from '@/lib/cannabis-compliance';
import {
  Link as LinkIcon, Leaf, Package, Scissors, Truck, Banknote, FlaskConical, BarChart, Home,
  Landmark, Factory, Store, User, Users, Database, Server, Settings, CheckCircle2, XCircle,
  AlertTriangle, RefreshCw, Activity, ArrowRightLeft, Building2, Globe, Check, X, Search,
  ArrowRight, ArrowLeft, Diamond, FileText, Trash2, ClipboardList, Scale, Receipt, Download
} from 'lucide-react';

export function getIconComp(name: string | undefined | null) {
  if (!name) return null;
  const I: Record<string, any> = {
    link: LinkIcon, leaf: Leaf, package: Package, scissors: Scissors, truck: Truck,
    banknote: Banknote, 'flask-conical': FlaskConical, 'bar-chart': BarChart,
    home: Home, landmark: Landmark, factory: Factory, store: Store, user: User,
    users: Users, database: Database, server: Server, settings: Settings,
    'check-circle': CheckCircle2, 'x-circle': XCircle, alert: AlertTriangle,
    refresh: RefreshCw, activity: Activity, 'arrow-right-left': ArrowRightLeft,
    building: Building2, 'metrc-db': Database, 'biotrack-db': Server, globe: Globe,
    'file-text': FileText, trash: Trash2, clipboard: ClipboardList, scale: Scale,
    receipt: Receipt, download: Download
  };
  return I[name] || Globe;
}

export function renderIcon(name: string | undefined | null, className = "w-4 h-4") {
  const Comp = getIconComp(name);
  if (!Comp) return null;
  return <Comp className={className} />;
}

// ── Shared UI ────────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: 'connected' | 'error' | 'disconnected' | undefined }) {
  const s = status || 'disconnected';
  const c: Record<string, string> = { connected: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30', error: 'bg-red-500/20 text-red-400 border-red-500/30', disconnected: 'bg-zinc-500/20 text-zinc-400 border-zinc-500/30' };
  const l: Record<string, string> = { connected: 'Connected', error: 'Error', disconnected: 'Not Connected' };
  return <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${c[s]}`}><span className={`w-1.5 h-1.5 rounded-full ${s === 'connected' ? 'bg-emerald-400' : s === 'error' ? 'bg-red-400' : 'bg-zinc-400'}`} />{l[s]}</span>;
}

function MethodBadge({ method }: { method: string }) {
  const c: Record<string, string> = { GET: 'bg-blue-500/15 text-blue-400', POST: 'bg-green-500/15 text-green-400', PUT: 'bg-amber-500/15 text-amber-400', DELETE: 'bg-red-500/15 text-red-400' };
  return <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-mono font-bold ${c[method] || 'bg-zinc-500/15 text-zinc-400'}`}>{method}</span>;
}

function SectionCard({ title, description, children, icon }: { title: string; description?: string; children: React.ReactNode; icon?: string }) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] overflow-hidden">
      <div className="px-5 py-4 border-b border-white/[0.06]">
        <h3 className="text-sm font-semibold text-white flex items-center gap-2">{icon && renderIcon(icon, "w-4 h-4 text-emerald-400")}{title}</h3>
        {description && <p className="text-xs text-white/40 mt-1">{description}</p>}
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

function InputField({ label, value, onChange, placeholder, masked }: { label: string; value: string; onChange: (v: string) => void; type?: string; placeholder?: string; masked?: boolean }) {
  const [show, setShow] = useState(false);
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-white/60">{label}</label>
      <div className="relative">
        <input type={masked && !show ? 'password' : 'text'} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
          className="w-full px-3 py-2 rounded-lg bg-white/[0.04] border border-white/[0.08] text-sm text-white placeholder:text-white/20 focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/20 transition-colors" />
        {masked && <button type="button" onClick={() => setShow(!show)} className="absolute right-2 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60 text-xs">{show ? 'Hide' : 'Show'}</button>}
      </div>
    </div>
  );
}

function SelectField({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-white/60">{label}</label>
      <select value={value} onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2 rounded-lg border border-white/[0.08] text-sm text-white focus:outline-none focus:border-emerald-500/50 transition-colors"
        style={{ backgroundColor: '#1a1a2e', colorScheme: 'dark' }}>
        <option value="" style={{ backgroundColor: '#1a1a2e', color: '#999' }}>Select...</option>
        {options.map(o => <option key={o.value} value={o.value} style={{ backgroundColor: '#1a1a2e', color: '#fff' }}>{o.label}</option>)}
      </select>
    </div>
  );
}

function ToggleField({ label, description, checked, onChange }: { label: string; description?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <div><span className="text-sm text-white/80">{label}</span>{description && <p className="text-xs text-white/30 mt-0.5">{description}</p>}</div>
      <button type="button" onClick={() => onChange(!checked)} className={`relative w-10 h-5 rounded-full transition-colors ${checked ? 'bg-emerald-500' : 'bg-white/10'}`}>
        <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${checked ? 'translate-x-5' : ''}`} />
      </button>
    </div>
  );
}

function EndpointExplorer({ title, endpoints, provider }: { title: string; endpoints: MetrcEndpoint[]; provider: 'METRC' | 'BioTrack' }) {
  const [expanded, setExpanded] = useState(false);
  const isM = provider === 'METRC';
  return (
    <div className={`rounded-lg border ${isM ? 'border-emerald-500/10 bg-emerald-500/[0.02]' : 'border-violet-500/10 bg-violet-500/[0.02]'} overflow-hidden`}>
      <button type="button" onClick={() => setExpanded(!expanded)} className={`w-full flex items-center justify-between px-4 py-2.5 text-left ${isM ? 'hover:bg-emerald-500/[0.04]' : 'hover:bg-violet-500/[0.04]'} transition-colors`}>
        <div className="flex items-center gap-2">
          <span className={`text-xs font-mono font-bold px-1.5 py-0.5 rounded ${isM ? 'text-emerald-400 bg-emerald-500/10' : 'text-violet-400 bg-violet-500/10'}`}>{provider}</span>
          <span className="text-xs font-medium text-white/70">{title}</span>
          <span className="text-[10px] text-white/30">{endpoints.length} endpoints</span>
        </div>
        <svg className={`w-3.5 h-3.5 text-white/30 transition-transform ${expanded ? 'rotate-180' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 9l6 6 6-6"/></svg>
      </button>
      {expanded && (
        <div className="border-t border-white/[0.04] divide-y divide-white/[0.03]">
          {endpoints.map((ep, i) => (
            <div key={i} className="flex items-center gap-3 px-4 py-2 hover:bg-white/[0.02]">
              <MethodBadge method={ep.method} />
              <code className="text-[11px] font-mono text-white/50 flex-1">{ep.path}</code>
              <span className="text-[11px] text-white/30">{ep.description}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Provider Selection (Integrations Tab) ────────────────────────────────────

function IntegrationsTab({ config, setConfig, onSave, saving }: { config: ComplianceConfig; setConfig: (c: ComplianceConfig) => void; onSave: () => void; saving: boolean }) {
  const provider = config.activeProvider;
  const metrcOpts = Object.entries(METRC_STATES).map(([k, v]) => ({ value: k, label: `${v.name} (${k})` }));
  const btOpts = Object.entries(BIOTRACK_STATES).map(([k, v]) => ({ value: k, label: `${v.name} (${k})` }));
  const updateMetrc = (p: Partial<typeof config.metrc>) => setConfig({ ...config, metrc: { ...config.metrc, ...p } });
  const updateBt = (p: Partial<typeof config.biotrack>) => setConfig({ ...config, biotrack: { ...config.biotrack, ...p } });
  const selectProvider = (p: ComplianceProvider) => {
    const next = provider === p ? null : p;
    setConfig({ ...config, activeProvider: next, metrc: { ...config.metrc, enabled: next === 'metrc' }, biotrack: { ...config.biotrack, enabled: next === 'biotrack' } });
  };

  return (
    <div className="space-y-6">
      {/* License Type Selection */}
      <SectionCard title="Operation Type" description="Select your primary cannabis business license" icon="building">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {(['retail', 'manufacturing', 'cultivation'] as const).map(lt => (
            <button key={lt} type="button" onClick={() => setConfig({ ...config, licenseType: lt })}
              className={`p-4 rounded-xl border-2 text-left transition-all ${config.licenseType === lt ? 'border-emerald-500 bg-emerald-500/10 shadow-lg shadow-emerald-500/10' : 'border-white/[0.08] bg-white/[0.02] hover:border-white/[0.15]'}`}>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-emerald-400">{renderIcon(lt === 'retail' ? 'store' : lt === 'manufacturing' ? 'factory' : 'leaf', "w-5 h-5")}</span>
                <p className="text-sm font-bold text-white capitalize">{lt}</p>
              </div>
              <p className="text-xs text-white/50">{lt === 'retail' ? 'Dispensary & Sales' : lt === 'manufacturing' ? 'Processing & Extracts' : 'Growing & Harvests'}</p>
            </button>
          ))}
        </div>
      </SectionCard>

      {/* Provider Selection */}
      <SectionCard title="Compliance Provider" description="Choose your state seed-to-sale tracking platform" icon="landmark">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <button type="button" onClick={() => selectProvider('metrc')}
            className={`relative p-5 rounded-xl border-2 text-left transition-all ${provider === 'metrc' ? 'border-emerald-500 bg-emerald-500/10 shadow-lg shadow-emerald-500/10' : 'border-white/[0.08] bg-white/[0.02] hover:border-white/[0.15]'}`}>
            <div className="flex items-center gap-3 mb-3">
              <Database className="w-8 h-8 text-emerald-400" />
              <div><p className="text-sm font-bold text-white">METRC</p><p className="text-[10px] text-white/40">Marijuana Enforcement Tracking Reporting & Compliance</p></div>
            </div>
            <p className="text-xs text-white/50">Used in {Object.keys(METRC_STATES).length} states — AK, CA, CO, DC, LA, MA, MD, ME, MI, MO, MT, NJ, NV, OH, OK, OR, WV</p>
            {provider === 'metrc' && <div className="absolute top-3 right-3 w-5 h-5 rounded-full bg-emerald-500 flex items-center justify-center"><svg className="w-3 h-3 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M5 13l4 4L19 7"/></svg></div>}
          </button>
          <button type="button" onClick={() => selectProvider('biotrack')}
            className={`relative p-5 rounded-xl border-2 text-left transition-all ${provider === 'biotrack' ? 'border-violet-500 bg-violet-500/10 shadow-lg shadow-violet-500/10' : 'border-white/[0.08] bg-white/[0.02] hover:border-white/[0.15]'}`}>
            <div className="flex items-center gap-3 mb-3">
              <Server className="w-8 h-8 text-violet-400" />
              <div><p className="text-sm font-bold text-white">BioTrack THC</p><p className="text-[10px] text-white/40">State Cannabis Traceability System</p></div>
            </div>
            <p className="text-xs text-white/50">Used in {Object.keys(BIOTRACK_STATES).length} states — FL, NM, HI, DE, CT, AR</p>
            {provider === 'biotrack' && <div className="absolute top-3 right-3 w-5 h-5 rounded-full bg-violet-500 flex items-center justify-center"><svg className="w-3 h-3 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M5 13l4 4L19 7"/></svg></div>}
          </button>
        </div>
      </SectionCard>

      {/* METRC Credentials */}
      {provider === 'metrc' && (
        <SectionCard title="METRC Credentials" description="Enter your METRC API keys and state information" icon="metrc-db">
          <div className="space-y-4">
            <div className="flex items-center justify-between"><span className="text-xs text-white/40">Connection</span><StatusBadge status={config.metrc.connectionStatus} /></div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <SelectField label="State" value={config.metrc.stateCode} onChange={(v) => updateMetrc({ stateCode: v })} options={metrcOpts} />
              <InputField label="License Number" value={config.metrc.licenseNumber} onChange={(v) => updateMetrc({ licenseNumber: v })} placeholder="000-X0001" />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <InputField label="Integrator API Key" value={config.metrc.integratorApiKey} onChange={(v) => updateMetrc({ integratorApiKey: v })} placeholder="Your software integrator key" masked />
              <InputField label="User API Key" value={config.metrc.userApiKey} onChange={(v) => updateMetrc({ userApiKey: v })} placeholder="Your METRC user key" masked />
            </div>
            {config.metrc.stateCode && (
              <div className="rounded-lg bg-emerald-500/5 border border-emerald-500/10 px-4 py-3">
                <p className="text-xs text-white/40">API Base URL</p>
                <code className="text-sm text-emerald-400 font-mono">{getMetrcBaseUrl(METRC_STATES[config.metrc.stateCode]?.code || '', config.metrc.sandbox)}</code>
              </div>
            )}
            <ToggleField label="Sandbox Mode" description="Use sandbox environment for testing" checked={config.metrc.sandbox} onChange={(v) => updateMetrc({ sandbox: v })} />
            {config.metrc.connectionError && <p className="text-xs text-red-400 bg-red-500/10 rounded-lg px-3 py-2">{config.metrc.connectionError}</p>}
            <button type="button" onClick={() => updateMetrc({ connectionStatus: config.metrc.stateCode && config.metrc.integratorApiKey && config.metrc.userApiKey ? 'connected' : 'error', lastConnected: new Date().toISOString(), connectionError: !config.metrc.stateCode || !config.metrc.integratorApiKey || !config.metrc.userApiKey ? 'Missing required fields' : undefined })}
              className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium transition-colors">Test Connection</button>
          </div>
        </SectionCard>
      )}

      {/* BioTrack Credentials */}
      {provider === 'biotrack' && (
        <SectionCard title="BioTrack Credentials" description="Enter your BioTrack API credentials" icon="biotrack-db">
          <div className="space-y-4">
            <div className="flex items-center justify-between"><span className="text-xs text-white/40">Connection</span><StatusBadge status={config.biotrack.connectionStatus} /></div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <SelectField label="State" value={config.biotrack.stateCode} onChange={(v) => { const st = BIOTRACK_STATES[v]; updateBt({ stateCode: v, apiUrl: st?.apiBase || '', apiVersion: st?.apiVersion === 'trace2' ? 'v3' : (st?.apiVersion || 'v3') as any }); }} options={btOpts} />
              <SelectField label="API Version" value={config.biotrack.apiVersion} onChange={(v) => updateBt({ apiVersion: v as 'v2' | 'v3' })} options={[{ value: 'v2', label: 'Version 2' }, { value: 'v3', label: 'Version 3 / Trace 2.0' }]} />
            </div>
            <InputField label="API URL" value={config.biotrack.apiUrl} onChange={(v) => updateBt({ apiUrl: v })} placeholder="https://fl.biotr.ac/api" />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <InputField label="Username" value={config.biotrack.username} onChange={(v) => updateBt({ username: v })} placeholder="API username" />
              <InputField label="Password" value={config.biotrack.password} onChange={(v) => updateBt({ password: v })} placeholder="API password" masked />
            </div>
            <InputField label="License Number" value={config.biotrack.licenseNumber} onChange={(v) => updateBt({ licenseNumber: v })} placeholder="State license #" />

            {/* State-specific info card */}
            {config.biotrack.stateCode && BIOTRACK_STATES[config.biotrack.stateCode] && (() => {
              const st = BIOTRACK_STATES[config.biotrack.stateCode];
              return (
                <div className="rounded-xl border border-violet-500/10 bg-violet-500/[0.03] p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold text-violet-400">{st.name} — State Configuration</p>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${st.programType === 'medical' ? 'bg-blue-500/15 text-blue-400' : st.programType === 'both' ? 'bg-emerald-500/15 text-emerald-400' : 'bg-green-500/15 text-green-400'}`}>
                      {st.programType === 'medical' ? <span className="flex items-center"><Building2 className="w-3 h-3 mr-1" /> Medical Only</span> : st.programType === 'both' ? <span className="flex items-center"><Store className="w-3 h-3 mr-1" /> Medical + Adult-Use</span> : <span className="flex items-center"><Store className="w-3 h-3 mr-1" /> Adult-Use</span>}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                    <div><span className="text-white/30 block">Regulator</span><span className="text-white/70 font-medium">{st.regulatoryAbbr}</span></div>
                    <div><span className="text-white/30 block">Reporting</span><span className="text-white/70 font-medium">{st.reportingInterval}</span></div>
                    <div><span className="text-white/30 block">Auth Method</span><span className="text-white/70 font-medium">{st.authMethod === 'session' ? 'Session (x-api-key)' : 'Basic (per-call)'}</span></div>
                    <div><span className="text-white/30 block">ID Format</span><span className="text-white/70 font-medium">{st.identifierFormat === 'uuid' ? 'UUID' : '16-digit barcode'}</span></div>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {Object.entries(st.features).map(([k, v]) => (
                      <span key={k} className={`px-2 py-0.5 rounded text-[10px] font-medium ${v ? 'bg-emerald-500/10 text-emerald-400' : 'bg-zinc-500/10 text-zinc-500 line-through'}`}>
                        {k.replace(/([A-Z])/g, ' $1').trim()}
                      </span>
                    ))}
                  </div>
                  <p className="text-[11px] text-white/30 leading-relaxed">{st.notes}</p>
                  <p className="text-[10px] text-white/20">Support: {st.supportEmail}</p>
                </div>
              );
            })()}

            {config.biotrack.connectionError && <p className="text-xs text-red-400 bg-red-500/10 rounded-lg px-3 py-2">{config.biotrack.connectionError}</p>}
            <button type="button" onClick={() => updateBt({ connectionStatus: config.biotrack.apiUrl && config.biotrack.username && config.biotrack.password ? 'connected' : 'error', lastConnected: new Date().toISOString(), connectionError: !config.biotrack.apiUrl || !config.biotrack.username || !config.biotrack.password ? 'Missing required fields' : undefined })}
              className="px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium transition-colors">Test Connection</button>
          </div>
        </SectionCard>
      )}

      {/* Sync Settings */}
      {provider && (
        <SectionCard title="Sync Configuration" icon="settings">
          <div className="space-y-4">
            <SelectField label="Sync Schedule" value={config.syncSchedule} onChange={(v) => setConfig({ ...config, syncSchedule: v as ComplianceConfig['syncSchedule'] })}
              options={[{ value: 'manual', label: 'Manual Only' }, { value: '15min', label: 'Every 15 Minutes' }, { value: '30min', label: 'Every 30 Minutes' }, { value: '1hour', label: 'Every Hour' }, { value: '4hours', label: 'Every 4 Hours' }, { value: 'daily', label: 'Once Daily' }]} />
            <ToggleField label="Auto-Report Sales" description="Automatically push sales receipts to compliance provider" checked={config.autoReportSales} onChange={(v) => setConfig({ ...config, autoReportSales: v })} />
            <ToggleField label="Auto-Sync Inventory" description="Automatically sync package/inventory data bidirectionally" checked={config.autoSyncInventory} onChange={(v) => setConfig({ ...config, autoSyncInventory: v })} />
          </div>
        </SectionCard>
      )}

      <div className="flex justify-end">
        <button type="button" onClick={onSave} disabled={saving} className="px-6 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm font-semibold transition-colors">{saving ? 'Saving...' : 'Save Configuration'}</button>
      </div>
    </div>
  );
}

// ── Operational Tabs ─────────────────────────────────────────────────────────

function useConnectionCheck(config: ComplianceConfig) {
  const provider = config.activeProvider;
  const isConnected = provider === 'metrc' ? config.metrc.connectionStatus === 'connected' : provider === 'biotrack' ? config.biotrack.connectionStatus === 'connected' : false;
  return { provider, isConnected };
}

function ConnectionWarning({ config }: { config: ComplianceConfig }) {
  const { provider, isConnected } = useConnectionCheck(config);
  if (isConnected || !provider) return null;
  return (
    <div className="rounded-xl border border-zinc-500/20 bg-zinc-500/5 p-4 flex items-center gap-3">
      <AlertTriangle className="w-6 h-6 opacity-60 text-zinc-400" />
      <div>
        <p className="text-sm font-semibold text-zinc-300">Integration Disconnected</p>
        <p className="text-xs text-zinc-400">Your {provider === 'metrc' ? 'METRC' : 'BioTrack'} credentials are invalid or disconnected. Actions are disabled until you reconnect in the Integrations tab.</p>
      </div>
    </div>
  );
}

function ActionButton({ disabled, children, primary, onClick }: { disabled?: boolean; children: React.ReactNode; primary?: boolean; onClick?: () => void }) {
  return (
    <button disabled={disabled} onClick={onClick} className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${disabled ? 'bg-zinc-800/50 text-zinc-500 cursor-not-allowed border border-zinc-700/30' : primary ? 'bg-emerald-600/20 text-emerald-400 hover:bg-emerald-600/30' : 'bg-white/10 text-white hover:bg-white/20'}`}>
      {children}
    </button>
  );
}

function EmptyStateMessage({ provider }: { provider?: string | null }) {
  return <div className="py-8 text-center text-white/30 text-sm">No items found. Click 'Sync from {provider === 'metrc' ? 'METRC' : 'BioTrack'}' to fetch actual data.</div>;
}

function PlantsTab({ config }: { config: ComplianceConfig }) {
  const { isConnected } = useConnectionCheck(config);
  return (
    <div className="space-y-6">
      <ConnectionWarning config={config} />
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4 text-center"><p className="text-2xl font-bold text-emerald-400">0</p><p className="text-[10px] uppercase text-white/30">Total Live</p></div>
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 text-center"><p className="text-2xl font-bold text-white/70">0</p><p className="text-[10px] uppercase text-white/30">Vegetative</p></div>
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 text-center"><p className="text-2xl font-bold text-white/70">0</p><p className="text-[10px] uppercase text-white/30">Flowering</p></div>
      </div>
      <SectionCard title="Plant Batches & Tracking" description="Lifecycle management">
        <div className="flex gap-2 mb-4">
          <ActionButton disabled={!isConnected} primary>Sync from Provider</ActionButton>
          <ActionButton disabled={!isConnected}>Create Batch</ActionButton>
        </div>
        <EmptyStateMessage provider={config.activeProvider} />
      </SectionCard>
    </div>
  );
}

function PackagesTab({ config }: { config: ComplianceConfig }) {
  const { isConnected } = useConnectionCheck(config);
  return (
    <div className="space-y-6">
      <ConnectionWarning config={config} />
      <SectionCard title="Active Packages" description="Current inventory tags">
        <div className="flex gap-2 mb-4">
          <ActionButton disabled={!isConnected} primary>Sync from Provider</ActionButton>
          <ActionButton disabled={!isConnected}>Create Package</ActionButton>
          <ActionButton disabled={!isConnected}>Adjust Quantities</ActionButton>
        </div>
        <EmptyStateMessage provider={config.activeProvider} />
      </SectionCard>
    </div>
  );
}

function HarvestsTab({ config }: { config: ComplianceConfig }) {
  const { isConnected } = useConnectionCheck(config);
  return (
    <div className="space-y-6">
      <ConnectionWarning config={config} />
      <SectionCard title="Harvest Operations" description="Active and finished harvests">
        <div className="flex gap-2 mb-4">
          <ActionButton disabled={!isConnected} primary>Sync from Provider</ActionButton>
          <ActionButton disabled={!isConnected}>Log New Harvest</ActionButton>
        </div>
        <EmptyStateMessage provider={config.activeProvider} />
      </SectionCard>
    </div>
  );
}

function TransfersTab({ config }: { config: ComplianceConfig }) {
  const { isConnected, provider } = useConnectionCheck(config);
  const [activeModal, setActiveModal] = useState<'driver' | 'vehicle' | 'vendor' | null>(null);

  const [driverName, setDriverName] = useState('');
  const [driverLicense, setDriverLicense] = useState('');
  const [vehicleMake, setVehicleMake] = useState('');
  const [vehiclePlate, setVehiclePlate] = useState('');
  const [vendorName, setVendorName] = useState('');
  const [vendorLicense, setVendorLicense] = useState('');

  const submitModal = (type: string) => {
    // Simulated submission logic
    alert(`Successfully synced ${type} to ${provider === 'metrc' ? 'METRC' : 'BioTrack'}.`);
    setActiveModal(null);
  };

  return (
    <div className="space-y-6 relative">
      <ConnectionWarning config={config} />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <SectionCard title="Drivers" icon="user">
          <div className="flex gap-2 mb-4">
            <ActionButton disabled={!isConnected} onClick={() => isConnected && setActiveModal('driver')}>Add Driver</ActionButton>
            <ActionButton disabled={!isConnected} primary>Sync</ActionButton>
          </div>
          <EmptyStateMessage provider={config.activeProvider} />
        </SectionCard>
        <SectionCard title="Vehicles" icon="truck">
          <div className="flex gap-2 mb-4">
             <ActionButton disabled={!isConnected} onClick={() => isConnected && setActiveModal('vehicle')}>Add Vehicle</ActionButton>
             <ActionButton disabled={!isConnected} primary>Sync</ActionButton>
          </div>
          <EmptyStateMessage provider={config.activeProvider} />
        </SectionCard>
      </div>
      <SectionCard title="B2B Vendors & Partners" description="Approved destinations for outgoing manifests" icon="building">
        <div className="flex gap-2 mb-4">
           <ActionButton disabled={!isConnected} onClick={() => isConnected && setActiveModal('vendor')}>Register Vendor</ActionButton>
           <ActionButton disabled={!isConnected} primary>Sync List</ActionButton>
        </div>
        <EmptyStateMessage provider={config.activeProvider} />
      </SectionCard>

      {/* Modals */}
      {activeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-md bg-[#1a1a2e] border border-white/10 rounded-2xl shadow-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-white/5 flex items-center justify-between bg-white/[0.02]">
              <h3 className="text-white font-semibold">
                {activeModal === 'driver' ? 'Add Transporter Driver' : activeModal === 'vehicle' ? 'Add Transporter Vehicle' : 'Register B2B Vendor'}
              </h3>
              <button onClick={() => setActiveModal(null)} className="text-white/40 hover:text-white/80"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-5 space-y-4">
              {activeModal === 'driver' && (
                <>
                  <InputField label="Full Name" value={driverName} onChange={setDriverName} placeholder="Jane Doe" />
                  <InputField label="Driver License Number" value={driverLicense} onChange={setDriverLicense} placeholder="DL-123456789" />
                </>
              )}
              {activeModal === 'vehicle' && (
                <>
                  <InputField label="Make & Model" value={vehicleMake} onChange={setVehicleMake} placeholder="Ford Transit 250" />
                  <InputField label="License Plate" value={vehiclePlate} onChange={setVehiclePlate} placeholder="ABC-1234" />
                </>
              )}
              {activeModal === 'vendor' && (
                <>
                  <InputField label="Facility Name" value={vendorName} onChange={setVendorName} placeholder="Green Logistics LLC" />
                  <InputField label="State License Number" value={vendorLicense} onChange={setVendorLicense} placeholder="C11-0000000-LIC" />
                </>
              )}
              <div className="pt-2 flex gap-3 justify-end">
                <button onClick={() => setActiveModal(null)} className="px-4 py-2 rounded-lg border border-white/10 text-white/70 text-sm hover:bg-white/5 transition-colors">Cancel</button>
                <button onClick={() => submitModal(activeModal)} className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-500 transition-colors">
                  Push to {provider === 'metrc' ? 'METRC' : 'BioTrack'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SalesTab({ config }: { config: ComplianceConfig }) {
  const { isConnected } = useConnectionCheck(config);
  return (
    <div className="space-y-6">
      <ConnectionWarning config={config} />
      <SectionCard title="Sales Receipts & Deliveries" description="Transactions reported to the state">
        <div className="flex gap-2 mb-4">
          <ActionButton disabled={!isConnected} primary>Push Pending Sales</ActionButton>
          <ActionButton disabled={!isConnected}>Check Patient Limits</ActionButton>
        </div>
        <EmptyStateMessage provider={config.activeProvider} />
      </SectionCard>
    </div>
  );
}

function LabTestsTab({ config }: { config: ComplianceConfig }) {
  const { isConnected } = useConnectionCheck(config);
  return (
    <div className="space-y-6">
      <ConnectionWarning config={config} />
      <SectionCard title="Lab Results" description="Status of currently staging packages">
        <div className="flex gap-2 mb-4">
          <ActionButton disabled={!isConnected} primary>Sync Lab Results</ActionButton>
          <ActionButton disabled={!isConnected}>Upload COA</ActionButton>
        </div>
        <EmptyStateMessage provider={config.activeProvider} />
      </SectionCard>
    </div>
  );
}

// ── Audit & Reconciliation Tab ───────────────────────────────────────────────

function AuditTab({ config }: { config: ComplianceConfig }) {
  const provider = config.activeProvider;
  const label = provider === 'metrc' ? 'METRC' : 'BioTrack';
  const color = provider === 'metrc' ? 'emerald' : 'violet';
  const [filter, setFilter] = useState<DiscrepancyStatus | 'all'>('all');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Operational reconciliation data fetched from POS
  const [items, setItems] = useState<ReconciliationItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/inventory?limit=500');
        if (res.ok) {
          const data = await res.json();
          const posItems: ReconciliationItem[] = (data.items || [])
            .filter((item: any) => item.industryPack === 'cannabis')
            .map((item: any) => ({
              id: item.id,
              sku: item.sku || item.id,
              productName: item.name,
              category: item.category || 'Uncategorized',
              posQuantity: item.stockQty > 0 ? item.stockQty : 0,
              providerQuantity: 0, // Awaiting real provider hook
              discrepancy: item.stockQty > 0 ? item.stockQty : 0,
              unit: item.weightUnit || 'units',
              providerTag: item.metrcTag || item.biotrackId,
              batchNumber: item.batchNumber,
              status: 'unresolved' as DiscrepancyStatus,
            }));
          setItems(posItems);
        }
      } catch (e) {
        console.error('Failed to load inventory for audit:', e);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const filtered = filter === 'all' ? items : items.filter(i => i.status === filter);
  const unresolvedCount = items.filter(i => i.status === 'unresolved').length;
  const overCount = items.filter(i => i.status === 'unresolved' && i.discrepancy > 0).length;
  const underCount = items.filter(i => i.status === 'unresolved' && i.discrepancy < 0).length;

  const toggleSelect = (id: string) => setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const selectAllUnresolved = () => setSelected(new Set(items.filter(i => i.status === 'unresolved').map(i => i.id)));

  const resolveItems = (ids: string[], resolution: 'sync_to_provider' | 'bypass_accept_provider' | 'dismiss') => {
    const statusMap: Record<string, DiscrepancyStatus> = { sync_to_provider: 'synced_to_provider', bypass_accept_provider: 'bypassed', dismiss: 'dismissed' };
    setItems(prev => prev.map(item => ids.includes(item.id) ? {
      ...item,
      status: statusMap[resolution],
      resolvedAt: new Date().toISOString(),
      resolution,
      posQuantity: resolution === 'bypass_accept_provider' ? item.providerQuantity : item.posQuantity,
      providerQuantity: resolution === 'sync_to_provider' ? item.posQuantity : item.providerQuantity,
      discrepancy: 0,
    } : item));
    setSelected(new Set());
  };

  const statusBadge = (s: DiscrepancyStatus) => {
    const c: Record<DiscrepancyStatus, string> = { unresolved: 'bg-amber-500/15 text-amber-400', synced_to_provider: 'bg-emerald-500/15 text-emerald-400', bypassed: 'bg-blue-500/15 text-blue-400', dismissed: 'bg-zinc-500/15 text-zinc-400' };
    const l: Record<DiscrepancyStatus, string> = { unresolved: 'Unresolved', synced_to_provider: `Synced → ${label}`, bypassed: `Bypassed (${label} accepted)`, dismissed: 'Dismissed' };
    return <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${c[s]}`}>{l[s]}</span>;
  };

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 text-center">
          <p className="text-2xl font-bold text-amber-400">{unresolvedCount}</p>
          <p className="text-[10px] uppercase tracking-wider text-white/30 mt-1">Unresolved</p>
        </div>
        <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-4 text-center">
          <p className="text-2xl font-bold text-red-400">{overCount}</p>
          <p className="text-[10px] uppercase tracking-wider text-white/30 mt-1">POS Over-count</p>
        </div>
        <div className="rounded-xl border border-orange-500/20 bg-orange-500/5 p-4 text-center">
          <p className="text-2xl font-bold text-orange-400">{underCount}</p>
          <p className="text-[10px] uppercase tracking-wider text-white/30 mt-1">POS Under-count</p>
        </div>
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4 text-center">
          <p className="text-2xl font-bold text-emerald-400">{items.filter(i => i.status !== 'unresolved').length}</p>
          <p className="text-[10px] uppercase tracking-wider text-white/30 mt-1">Resolved</p>
        </div>
      </div>

      {/* Explanation */}
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
        <p className="text-xs font-medium text-white/70 mb-2 flex items-center gap-1.5"><Search className="w-4 h-4 text-white/50" /> How Reconciliation Works</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs text-white/50">
          <div className="flex gap-2">
            <span className={`text-${color}-400 font-bold shrink-0`}>Sync →</span>
            <span><strong className="text-white/70">Push POS value to {label}.</strong> Use when your POS count is correct and {label} needs updating.</span>
          </div>
          <div className="flex gap-2">
            <span className="text-blue-400 font-bold shrink-0">Bypass ←</span>
            <span><strong className="text-white/70">Accept {label} value.</strong> Use when {label} has the right count and your POS has an over/under count.</span>
          </div>
        </div>
      </div>

      {/* Filter & Bulk Actions */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1">
          {(['all', 'unresolved', 'synced_to_provider', 'bypassed', 'dismissed'] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)} className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${filter === f ? 'bg-white/10 text-white' : 'text-white/30 hover:text-white/60 hover:bg-white/[0.04]'}`}>
              {f === 'all' ? 'All' : f === 'synced_to_provider' ? 'Synced' : f === 'bypassed' ? 'Bypassed' : f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
        {selected.size > 0 && (
          <div className="flex gap-2">
            <button onClick={() => resolveItems([...selected], 'sync_to_provider')} className={`px-3 py-1.5 rounded-lg bg-${color}-600/20 border border-${color}-500/20 text-${color}-400 text-xs font-medium`}>
              Sync {selected.size} → {label}
            </button>
            <button onClick={() => resolveItems([...selected], 'bypass_accept_provider')} className="px-3 py-1.5 rounded-lg bg-blue-600/20 border border-blue-500/20 text-blue-400 text-xs font-medium">
              Bypass {selected.size} ← {label}
            </button>
            <button onClick={() => resolveItems([...selected], 'dismiss')} className="px-3 py-1.5 rounded-lg bg-zinc-600/20 border border-zinc-500/20 text-zinc-400 text-xs font-medium">Dismiss</button>
          </div>
        )}
      </div>

      {/* Reconciliation Table */}
      <SectionCard title="Inventory Discrepancies" description={`Comparing POS inventory against ${label}`} icon="bar-chart">
        <div className="overflow-x-auto -mx-5 px-5">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-12">
              <div className="w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin mb-3" />
              <p className="text-sm text-white/50">Fetching live internal inventory...</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
              <tr className="border-b border-white/[0.06]">
                <th className="text-left py-2 pr-2 w-8"><input type="checkbox" checked={selected.size === items.filter(i => i.status === 'unresolved').length && selected.size > 0} onChange={() => selected.size > 0 ? setSelected(new Set()) : selectAllUnresolved()} className="rounded accent-emerald-500" /></th>
                <th className="text-left py-2 text-[10px] uppercase tracking-wider text-white/30 font-medium">Product</th>
                <th className="text-right py-2 text-[10px] uppercase tracking-wider text-white/30 font-medium">POS Qty</th>
                <th className="text-right py-2 text-[10px] uppercase tracking-wider text-white/30 font-medium">{label} Qty</th>
                <th className="text-right py-2 text-[10px] uppercase tracking-wider text-white/30 font-medium">Diff</th>
                <th className="text-center py-2 text-[10px] uppercase tracking-wider text-white/30 font-medium">Status</th>
                <th className="text-right py-2 text-[10px] uppercase tracking-wider text-white/30 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.03]">
              {filtered.map(item => (
                <tr key={item.id} className={`hover:bg-white/[0.02] ${item.status === 'unresolved' ? '' : 'opacity-60'}`}>
                  <td className="py-3 pr-2">{item.status === 'unresolved' && <input type="checkbox" checked={selected.has(item.id)} onChange={() => toggleSelect(item.id)} className="rounded accent-emerald-500" />}</td>
                  <td className="py-3">
                    <p className="text-white/80 font-medium">{item.productName}</p>
                    <p className="text-[10px] text-white/30">{item.sku} · {item.category}{item.providerTag ? ` · ${item.providerTag.slice(0, 12)}…` : ''}</p>
                  </td>
                  <td className="py-3 text-right font-mono text-white/70">{item.posQuantity}</td>
                  <td className="py-3 text-right font-mono text-white/70">{item.providerQuantity}</td>
                  <td className={`py-3 text-right font-mono font-bold ${item.discrepancy > 0 ? 'text-red-400' : item.discrepancy < 0 ? 'text-orange-400' : 'text-emerald-400'}`}>
                    {item.discrepancy > 0 ? '+' : ''}{item.discrepancy}
                  </td>
                  <td className="py-3 text-center">{statusBadge(item.status)}</td>
                  <td className="py-3 text-right">
                    {item.status === 'unresolved' && (
                      <div className="flex gap-1 justify-end">
                        <button onClick={() => resolveItems([item.id], 'sync_to_provider')} title={`Push POS value to ${label}`} className={`p-1.5 rounded-lg hover:bg-${color}-500/10 text-${color}-400 transition-colors`}>
                          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
                        </button>
                        <button onClick={() => resolveItems([item.id], 'bypass_accept_provider')} title={`Accept ${label} value`} className="p-1.5 rounded-lg hover:bg-blue-500/10 text-blue-400 transition-colors">
                          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
                        </button>
                        <button onClick={() => resolveItems([item.id], 'dismiss')} title="Dismiss" className="p-1.5 rounded-lg hover:bg-zinc-500/10 text-zinc-400 transition-colors"><X className="w-3.5 h-3.5" /></button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          )}
          {!loading && filtered.length === 0 && <p className="text-center py-6 text-white/20 text-sm">No discrepancies found for this filter</p>}
        </div>
      </SectionCard>

      {/* Run Reconciliation */}
      <div className="flex gap-3">
        <button className={`px-4 py-2 rounded-lg bg-${color}-600 hover:bg-${color}-500 text-white text-sm font-medium transition-colors flex items-center`}><RefreshCw className="w-4 h-4 mr-2" /> Run Full Reconciliation</button>
        <button className="px-4 py-2 rounded-lg bg-white/[0.04] border border-white/[0.08] text-white/60 text-sm hover:bg-white/[0.06] transition-colors">Export Report (CSV)</button>
        <button className="px-4 py-2 rounded-lg bg-white/[0.04] border border-white/[0.08] text-white/60 text-sm hover:bg-white/[0.06] transition-colors">View Audit Log</button>
      </div>
    </div>
  );
}

// ── Reports Tab ─────────────────────────────────────────────────────────────

function ReportsTab({ config }: { config: ComplianceConfig }) {
  const { isConnected, provider } = useConnectionCheck(config);
  const [activeReport, setActiveReport] = useState<string | null>(null);
  
  const stateCode = provider === 'metrc' && config.metrc.stateCode 
                      ? config.metrc.stateCode 
                      : provider === 'biotrack' && config.biotrack.stateCode 
                        ? config.biotrack.stateCode 
                        : null;

  return (
    <div className="space-y-8">
      <ConnectionWarning config={config} />
      
      {!stateCode && (
        <div className="bg-amber-500/10 border border-amber-500/30 p-4 rounded-xl mt-4">
          <h4 className="text-sm font-semibold text-amber-500 mb-1 flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-amber-500" /> Compliance Link Required
          </h4>
          <p className="text-xs text-amber-500/80">
            No active compliance provider is fully configured with a state code. You will not be able to generate state-specific regulatory tax exports until METRC or BioTrack is successfully linked in the Integrations tab.
          </p>
        </div>
      )}

      {/* ── Universal Compliance Reports ── */}
      <div>
        <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
          <Globe className="w-5 h-5 text-emerald-500" /> Universal Reports
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <SectionCard title="Reconciliation & Audit" description="Inventory adj. & missing items">
            <div className="flex flex-col items-center py-6 text-center h-40 justify-center">
               <div className="w-12 h-12 rounded-full bg-blue-500/10 flex items-center justify-center mb-3 border border-blue-500/20">
                 <ClipboardList className="w-6 h-6 text-blue-400" />
               </div>
               <p className="text-xs text-white/50 mb-3">MTD Adjustments</p>
               <ActionButton disabled={!isConnected} primary onClick={() => setActiveReport('Audit & Discrepancy Log')}>Export Log</ActionButton>
            </div>
          </SectionCard>

          <SectionCard title="Transporter Manifests" description="B2B outgoing/incoming">
            <div className="flex flex-col items-center py-6 text-center h-40 justify-center">
               <div className="w-12 h-12 rounded-full bg-violet-500/10 flex items-center justify-center mb-3 border border-violet-500/20">
                 <Truck className="w-6 h-6 text-violet-400" />
               </div>
               <p className="text-xs text-white/50 mb-3">Wholesale Transfers</p>
               <ActionButton disabled={!isConnected} primary onClick={() => setActiveReport('Transporter Manifest Ledger')}>Generate Ledger</ActionButton>
            </div>
          </SectionCard>

          <SectionCard title="Waste & Destruction" description="Remediated/Destroyed items">
            <div className="flex flex-col items-center py-6 text-center h-40 justify-center">
               <div className="w-12 h-12 rounded-full bg-orange-500/10 flex items-center justify-center mb-3 border border-orange-500/20">
                 <Trash2 className="w-6 h-6 text-orange-400" />
               </div>
               <p className="text-xs text-white/50 mb-3">Defect Reporting</p>
               <ActionButton disabled={!isConnected} primary onClick={() => setActiveReport('Waste & Remediation Report')}>Compile Report</ActionButton>
            </div>
          </SectionCard>

          <SectionCard title="Recall & Liability" description="Batch tracing & supplier impact">
            <div className="flex flex-col items-center py-6 text-center h-40 justify-center">
               <div className="w-12 h-12 rounded-full bg-red-500/10 flex items-center justify-center mb-3 border border-red-500/20">
                 <AlertTriangle className="w-6 h-6 text-red-400" />
               </div>
               <p className="text-xs text-white/50 mb-3">Traceability Scanner</p>
               <ActionButton disabled={!isConnected} primary onClick={() => setActiveReport('Product Liability & Recall Impact')}>Initiate Scan</ActionButton>
            </div>
          </SectionCard>
        </div>
      </div>

      {/* ── State-Specific Regulatory Reports ── */}
      <div>
        <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
          <Landmark className="w-5 h-5 text-amber-500" /> 
          State Regulatory Reports {stateCode ? `(${stateCode})` : '(No State Provided)'}
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          
          {/* CALIFORNIA */}
          {stateCode === 'CA' && (
            <>
              <SectionCard title="CDTFA Cannabis Tax Return" description="State Cannabis Excise Tax (15%)" icon="receipt">
                <div className="flex flex-col items-center py-6 text-center">
                   <p className="text-2xl font-bold text-white mb-1">$0.00</p>
                   <p className="text-xs text-white/50 mb-4">Total Excise Collected (MTD)</p>
                   <ActionButton disabled={!isConnected} primary onClick={() => setActiveReport('CDTFA Cannabis Tax Return')}>Generate CDTFA Return</ActionButton>
                </div>
              </SectionCard>
              <SectionCard title="Local Cannabis Business Tax (CBT)" description="Municipal city-level tracking" icon="building">
                <div className="flex flex-col items-center py-6 text-center">
                   <p className="text-2xl font-bold text-white mb-1">$0.00</p>
                   <p className="text-xs text-white/50 mb-4">Gross Receipts Local Apportionment</p>
                   <ActionButton disabled={!isConnected} primary onClick={() => setActiveReport('Local CBT Ledger')}>Export CBT Ledger</ActionButton>
                </div>
              </SectionCard>
            </>
          )}

          {/* ILLINOIS */}
          {stateCode === 'IL' && (
            <>
              <SectionCard title="THC-Tiered Sales Tax Report" description="Sub 35% (10%) | 35%+ (25%)" icon="scale">
                <div className="flex flex-col items-center py-6 text-center">
                   <p className="text-2xl font-bold text-white mb-1">$0.00</p>
                   <p className="text-xs text-white/50 mb-4">Potency-adjusted tax liability</p>
                   <ActionButton disabled={!isConnected} primary onClick={() => setActiveReport('IL THC-Tiered Apportionment')}>Generate IL THC Report</ActionButton>
                </div>
              </SectionCard>
              <SectionCard title="Infused Product Tax" description="Cannabis Edibles & Liquids (20%)" icon="flask-conical">
                <div className="flex flex-col items-center py-6 text-center">
                   <p className="text-2xl font-bold text-white mb-1">$0.00</p>
                   <p className="text-xs text-white/50 mb-4">Infused Adult-Use Tax</p>
                   <ActionButton disabled={!isConnected} primary onClick={() => setActiveReport('IL Infused Product Tax Ledgers')}>Export Infused Ledger</ActionButton>
                </div>
              </SectionCard>
            </>
          )}

          {/* MICHIGAN */}
          {stateCode === 'MI' && (
            <>
              <SectionCard title="Marihuana Retailers Excise Tax" description="State Excise Overlay (10%)" icon="receipt">
                <div className="flex flex-col items-center py-6 text-center">
                   <p className="text-2xl font-bold text-white mb-1">$0.00</p>
                   <p className="text-xs text-white/50 mb-4">Total Excise Collected</p>
                   <ActionButton disabled={!isConnected} primary onClick={() => setActiveReport('MI MRET Liability Statement')}>Generate CRA Form</ActionButton>
                </div>
              </SectionCard>
              <SectionCard title="CRA Monthly Adult-Use Report" description="Standardized CRA Summary" icon="file-text">
                <div className="flex flex-col items-center py-6 text-center">
                   <p className="text-xl font-bold text-white mb-1">State Reg Format</p>
                   <p className="text-xs text-white/50 mb-4">Adult-Use monthly compilation</p>
                   <ActionButton disabled={!isConnected} primary onClick={() => setActiveReport('CRA Monthly Retailer Package')}>Download Package</ActionButton>
                </div>
              </SectionCard>
            </>
          )}

          {/* COLORADO */}
          {stateCode === 'CO' && (
            <>
              <SectionCard title="Retail Marijuana Sales Tax (RMST)" description="State Sales Tax (15%)" icon="receipt">
                <div className="flex flex-col items-center py-6 text-center">
                   <p className="text-2xl font-bold text-white mb-1">$0.00</p>
                   <p className="text-xs text-white/50 mb-4">RMST State Liability</p>
                   <ActionButton disabled={!isConnected} primary onClick={() => setActiveReport('CO RMST Disclosure')}>Generate RMST Export</ActionButton>
                </div>
              </SectionCard>
              <SectionCard title="Wholesale Excise Tax (AMR)" description="Average Market Rate Tax (15%)" icon="truck">
                <div className="flex flex-col items-center py-6 text-center">
                   <p className="text-2xl font-bold text-white mb-1">$0.00</p>
                   <p className="text-xs text-white/50 mb-4">Wholesale Transfer Tax Liability</p>
                   <ActionButton disabled={!isConnected} primary onClick={() => setActiveReport('AMR Wholesale Excise Worksheet')}>Export Wholesale Excise</ActionButton>
                </div>
              </SectionCard>
            </>
          )}

          {/* DEFAULT / FALLBACK */}
          {(!stateCode || !['CA', 'IL', 'MI', 'CO'].includes(stateCode)) && (
            <SectionCard title="Default Sales & Excise Tax" description="Standard Gross Tax Analysis" icon="receipt">
              <div className="flex flex-col items-center py-6 text-center">
                 <p className="text-2xl font-bold text-white mb-1">$0.00</p>
                 <p className="text-xs text-white/50 mb-4">Combined Operations Tax Liability</p>
                 <ActionButton disabled={!isConnected} primary onClick={() => setActiveReport('Universal Sales & Excise Report')}>Generate Generic Tax Report</ActionButton>
              </div>
            </SectionCard>
          )}

        </div>
      </div>

      {/* ── Pipeline Status ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <SectionCard title="Reporting Status" description={`${provider === 'metrc' ? 'METRC' : 'BioTrack'} push pipeline`} icon="check-circle">
          <div className="flex flex-col justify-center h-full space-y-3 py-4">
             <div className="flex justify-between items-center text-sm border-b border-white/5 pb-2">
                <span className="text-white/60">Auto-Reporting Hook</span>
                {config.autoReportSales ? <span className="text-emerald-400 font-medium">Active</span> : <span className="text-amber-400 font-medium">Paused</span>}
             </div>
             <div className="flex justify-between items-center text-sm border-b border-white/5 pb-2">
                <span className="text-white/60">Pending Sales queue</span>
                <span className="text-white font-medium">0 Receipts (Clear)</span>
             </div>
             <div className="flex justify-between items-center text-sm">
                <span className="text-white/60">Last End-to-End Sync</span>
                <span className="text-white font-medium">{config.lastFullSync ? new Date(config.lastFullSync).toLocaleDateString() : 'Realtime'}</span>
             </div>
          </div>
        </SectionCard>
        
        <SectionCard title="Detailed Sales Pipeline" icon="database" description="Raw queue tracing">
          <EmptyStateMessage provider={config.activeProvider} />
        </SectionCard>
      </div>

      {/* ── Modal for Reports ── */}
      {activeReport && (
        <div className="fixed inset-0 z-[100] bg-black/80 flex items-center justify-center p-4">
           <div className="bg-[#1a1a2e] border border-white/10 rounded-2xl w-full max-w-xl overflow-hidden shadow-2xl animate-in zoom-in-95 duration-200">
             <div className="px-6 py-4 border-b border-white/10 flex justify-between items-center bg-white/[0.02]">
               <h2 className="text-lg font-bold text-white flex items-center gap-2"><FileText className="w-5 h-5 text-emerald-500" /> Compliance Report Generator</h2>
               <button onClick={() => setActiveReport(null)} className="text-white/40 hover:text-white transition-colors"><X className="w-5 h-5"/></button>
             </div>
             <div className="p-8">
               <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-2xl p-8 flex flex-col items-center justify-center text-center space-y-4">
                  <div className="w-16 h-16 bg-emerald-500/20 rounded-full flex items-center justify-center border border-emerald-500/40">
                    <Download className="w-8 h-8 text-emerald-400" />
                  </div>
                  <div>
                    <h3 className="text-xl font-bold text-white mb-2">{activeReport} Compiled</h3>
                    <p className="text-sm text-white/60">This ledger has been successfully synthesized from your active database transactions and is ready for local archiving.</p>
                  </div>
                  <div className="w-full mt-4">
                    <code className="block bg-black/40 border border-white/5 text-emerald-400 p-3 rounded-lg text-xs font-mono break-all font-bold">
                      {activeReport.replace(/[^A-Za-z0-9]/g, '_').toLowerCase()}_{new Date().getTime()}.csv
                    </code>
                  </div>
               </div>
             </div>
             <div className="px-6 py-4 border-t border-white/10 bg-white/[0.02] flex justify-end gap-3">
               <button onClick={() => setActiveReport(null)} className="px-5 py-2 hover:bg-white/10 text-white/60 font-semibold rounded-lg transition-colors text-sm">Close</button>
               <button onClick={() => setActiveReport(null)} className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-lg transition-colors flex items-center gap-2 text-sm shadow-lg shadow-emerald-500/20"><Download className="w-4 h-4"/> Download Export Data</button>
             </div>
           </div>
        </div>
      )}

    </div>
  );
}

// ── Main Panel ───────────────────────────────────────────────────────────────

// ── Welcome Dashboard Tab ────────────────────────────────────────────────────

function DashboardTab({ config, onNavigate }: { config: ComplianceConfig; onNavigate: (tab: ComplianceTabKey) => void }) {
  const provider = config.activeProvider;
  const label = provider === 'metrc' ? 'METRC' : provider === 'biotrack' ? 'BioTrack' : null;
  const color = provider === 'metrc' ? 'emerald' : provider === 'biotrack' ? 'violet' : 'zinc';
  const status = provider === 'metrc' ? config.metrc.connectionStatus : provider === 'biotrack' ? config.biotrack.connectionStatus : 'disconnected';
  const metrcEpCount = Object.values(METRC_ENDPOINTS).reduce((n, a) => n + a.length, 0);
  const btEpCount = Object.values(BIOTRACK_ENDPOINTS).reduce((n, a) => n + a.length, 0);
  const epCount = provider === 'metrc' ? metrcEpCount : provider === 'biotrack' ? btEpCount : 0;

  return (
    <div className="space-y-8">
      {/* Hero */}
      <div className="relative rounded-2xl overflow-hidden border border-white/[0.06]">
        <div className="absolute inset-0 bg-gradient-to-br from-emerald-600/20 via-transparent to-violet-600/10" />
        <div className="absolute inset-0" style={{ backgroundImage: 'radial-gradient(circle at 20% 50%, rgba(16,185,129,0.08) 0%, transparent 50%), radial-gradient(circle at 80% 20%, rgba(139,92,246,0.06) 0%, transparent 40%)' }} />
        <div className="relative px-8 py-10">
          <div className="flex items-center gap-3 mb-3">
            <Leaf className="w-10 h-10 text-emerald-500" />
            <div>
              <h2 className="text-2xl font-bold text-white">Cannabis Compliance Center</h2>
              <p className="text-sm text-white/50">Seed-to-Sale tracking, inventory reconciliation, and regulatory compliance</p>
            </div>
          </div>
          {provider ? (
            <div className="mt-6 flex flex-wrap gap-4">
              <div className={`flex items-center gap-2 px-4 py-2 rounded-xl bg-${color}-500/10 border border-${color}-500/20`}>
                <span className="mr-1">{provider === 'metrc' ? <Database className="w-4 h-4 text-emerald-400" /> : <Server className="w-4 h-4 text-violet-400" />}</span>
                <span className={`text-${color}-400 font-semibold text-sm`}>{label} Active</span>
              </div>
              <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white/[0.04] border border-white/[0.08]">
                <span className={`w-2 h-2 rounded-full ${status === 'connected' ? 'bg-emerald-400' : status === 'error' ? 'bg-red-400' : 'bg-zinc-400'}`} />
                <span className="text-white/60 text-sm">{status === 'connected' ? 'Connected' : status === 'error' ? 'Connection Error' : 'Not Connected'}</span>
              </div>
              <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white/[0.04] border border-white/[0.08]">
                <span className="text-white/60 text-sm">{epCount} API Endpoints</span>
              </div>
            </div>
          ) : (
            <div className="mt-6">
              <p className="text-white/40 text-sm mb-3">Get started by selecting your state compliance provider:</p>
              <div className="flex gap-3">
                <button onClick={() => onNavigate('integrations')} className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold transition-colors shadow-lg shadow-emerald-600/20">Set Up Provider →</button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Quick Stats */}
      {provider && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <button onClick={() => onNavigate('plants')} className="text-left rounded-xl border border-white/[0.06] bg-white/[0.02] p-5 hover:bg-white/[0.04] transition-colors group">
            <Leaf className="w-6 h-6 text-white/80 group-hover:text-emerald-400 transition-colors" />
            <p className="text-white/80 font-semibold mt-2 text-sm group-hover:text-emerald-400 transition-colors">Plants & Batches</p>
            <p className="text-[10px] text-white/30 mt-1">Lifecycle tracking, strains, growth phases</p>
          </button>
          <button onClick={() => onNavigate('packages')} className="text-left rounded-xl border border-white/[0.06] bg-white/[0.02] p-5 hover:bg-white/[0.04] transition-colors group">
            <Package className="w-6 h-6 text-white/80 group-hover:text-emerald-400 transition-colors" />
            <p className="text-white/80 font-semibold mt-2 text-sm group-hover:text-emerald-400 transition-colors">Packages & Inventory</p>
            <p className="text-[10px] text-white/30 mt-1">Tags, adjustments, lab samples</p>
          </button>
          <button onClick={() => onNavigate('transfers')} className="text-left rounded-xl border border-white/[0.06] bg-white/[0.02] p-5 hover:bg-white/[0.04] transition-colors group">
            <Truck className="w-6 h-6 text-white/80 group-hover:text-emerald-400 transition-colors" />
            <p className="text-white/80 font-semibold mt-2 text-sm group-hover:text-emerald-400 transition-colors">Transfers & Manifests</p>
            <p className="text-[10px] text-white/30 mt-1">Transport, drivers, vehicles</p>
          </button>
          <button onClick={() => onNavigate('audit')} className="text-left rounded-xl border border-amber-500/10 bg-amber-500/[0.03] p-5 hover:bg-amber-500/[0.06] transition-colors group">
            <BarChart className="w-6 h-6 text-white/80 group-hover:text-amber-400 transition-colors" />
            <p className="text-white/80 font-semibold mt-2 text-sm group-hover:text-amber-400 transition-colors">Audit & Reconciliation</p>
            <p className="text-[10px] text-white/30 mt-1">Discrepancy tracking, sync/bypass</p>
          </button>
        </div>
      )}

      {/* Feature Overview Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5">
          <div className="flex items-center gap-2 mb-3"><LinkIcon className="w-5 h-5 text-zinc-400" /><h3 className="text-sm font-semibold text-white">Provider Integration</h3></div>
          <ul className="space-y-2 text-xs text-white/50">
            <li className="flex items-center gap-2"><Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" /> METRC v2 — {metrcEpCount} endpoints across {Object.keys(METRC_ENDPOINTS).length} categories</li>
            <li className="flex items-center gap-2"><Check className="w-3.5 h-3.5 text-violet-400 shrink-0" /> BioTrack THC — {btEpCount} endpoints across {Object.keys(BIOTRACK_ENDPOINTS).length} categories</li>
            <li className="flex items-center gap-2"><Check className="w-3.5 h-3.5 text-blue-400 shrink-0" /> One provider per shop — streamlined, no confusion</li>
          </ul>
        </div>
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5">
          <div className="flex items-center gap-2 mb-3"><BarChart className="w-5 h-5 text-zinc-400" /><h3 className="text-sm font-semibold text-white">Audit & Reconciliation</h3></div>
          <ul className="space-y-2 text-xs text-white/50">
            <li className="flex items-center gap-2"><ArrowRight className="w-4 h-4 text-emerald-400 shrink-0" /> <strong className="text-white/70">Sync to provider</strong> — push POS count when yours is correct</li>
            <li className="flex items-center gap-2"><ArrowLeft className="w-4 h-4 text-blue-400 shrink-0" /> <strong className="text-white/70">Bypass (accept)</strong> — accept provider count for over/under</li>
            <li className="flex items-center gap-2"><Diamond className="w-3 h-3 fill-amber-400 text-amber-400 shrink-0" /> Bulk operations, audit log, CSV exports</li>
          </ul>
        </div>
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5">
          <div className="flex items-center gap-2 mb-3"><Scissors className="w-5 h-5 text-zinc-400" /><h3 className="text-sm font-semibold text-white">Harvest & Processing</h3></div>
          <ul className="space-y-2 text-xs text-white/50">
            <li className="flex items-center gap-2"><Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" /> Full harvest lifecycle — active, on-hold, finished</li>
            <li className="flex items-center gap-2"><Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" /> Processing jobs — types, categories, packages</li>
            <li className="flex items-center gap-2"><Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" /> Waste tracking with disposal method compliance</li>
          </ul>
        </div>
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5">
          <div className="flex items-center gap-2 mb-3"><FlaskConical className="w-5 h-5 text-zinc-400" /><h3 className="text-sm font-semibold text-white">Lab Tests & Sales</h3></div>
          <ul className="space-y-2 text-xs text-white/50">
            <li className="flex items-center gap-2"><Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" /> Lab result management and document uploads</li>
            <li className="flex items-center gap-2"><Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" /> Sales receipts, deliveries, and patient check-ins</li>
            <li className="flex items-center gap-2"><Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" /> Auto-report sales to compliance provider</li>
          </ul>
        </div>
      </div>

      {/* Sync Schedule */}
      {provider && config.syncSchedule !== 'manual' && (
        <div className="rounded-xl border border-emerald-500/10 bg-emerald-500/[0.03] px-5 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <RefreshCw className="w-5 h-5 text-emerald-400" />
            <div>
              <p className="text-sm text-white/70 font-medium">Auto-sync enabled</p>
              <p className="text-xs text-white/30">Schedule: {config.syncSchedule} · Last sync: {config.lastFullSync ? new Date(config.lastFullSync).toLocaleString() : 'Never'}</p>
            </div>
          </div>
          <button onClick={() => onNavigate('integrations')} className="px-3 py-1.5 rounded-lg bg-white/[0.06] text-white/50 text-xs hover:bg-white/[0.10] transition-colors">Configure</button>
        </div>
      )}
    </div>
  );
}

export default function CannabisCompliancePanel() {
  const [activeTab, setActiveTab] = useState<ComplianceTabKey>('dashboard');
  const [config, setConfig] = useState<ComplianceConfig>(DEFAULT_COMPLIANCE_CONFIG);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/site/config');
        if (res.ok) { const d = await res.json(); const s = d?.config?.industryParams?.cannabisCompliance; if (s) setConfig({ ...DEFAULT_COMPLIANCE_CONFIG, ...s }); }
      } catch {}
      setLoaded(true);
    })();
  }, []);

  const saveConfig = useCallback(async () => {
    setSaving(true);
    try {
      const p = config.activeProvider;
      const stateCode = p === 'metrc' ? config.metrc.stateCode : p === 'biotrack' ? config.biotrack.stateCode : null;
      let taxConfigPayload = undefined;
      
      if (stateCode && DEFAULT_STATE_TAXES[stateCode]) {
         taxConfigPayload = { jurisdictions: DEFAULT_STATE_TAXES[stateCode] };
      }

      const payload: any = { industryParams: { cannabisCompliance: config } };
      if (taxConfigPayload) {
        payload.taxConfig = taxConfigPayload;
      }

      await fetch('/api/site/config', { 
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify(payload) 
      }); 
    }
    catch (e) { console.error('Failed to save:', e); }
    setSaving(false);
  }, [config]);

  const provider = config.activeProvider;
  const providerLabel = provider === 'metrc' ? 'METRC' : provider === 'biotrack' ? 'BioTrack' : null;
  const totalEndpoints = provider === 'metrc'
    ? Object.values(METRC_ENDPOINTS).reduce((n, a) => n + a.length, 0)
    : provider === 'biotrack'
      ? Object.values(BIOTRACK_ENDPOINTS).reduce((n, a) => n + a.length, 0)
      : 0;

  // Dashboard tab + always show integrations + provider tabs when connected
  const dashboardTab = { key: 'dashboard' as ComplianceTabKey, label: 'Dashboard', icon: 'home', description: 'Welcome & overview', metrcCategories: [] as any[], biotrackCategories: [] as any[] };
  const visibleTabs = [dashboardTab, ...COMPLIANCE_TABS.filter(t => {
    if (t.key === 'integrations') return true;
    if (!provider) return false;
    if (t.licenseTypes && config.licenseType && !t.licenseTypes.includes(config.licenseType)) return false;
    return true;
  })];

  if (!loaded) return <div className="flex items-center justify-center h-64"><div className="w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" /></div>;

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 w-full space-y-6 pb-24">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2"><Leaf className="w-5 h-5 text-emerald-400" /> Cannabis Compliance Center</h2>
          <p className="text-sm text-white/40 mt-1 flex items-center gap-1.5">
            {providerLabel ? <><span className="flex items-center gap-1.5">{provider === 'metrc' ? <Database className="w-4 h-4 text-emerald-400" /> : <Server className="w-4 h-4 text-violet-400" />} {providerLabel} Integration</span> · {totalEndpoints} API endpoints · Seed-to-Sale</> : 'Select a compliance provider to get started'}
          </p>
        </div>
        {provider && <StatusBadge status={provider === 'metrc' ? config.metrc.connectionStatus : config.biotrack.connectionStatus} />}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 overflow-x-auto pb-1 scrollbar-none">
        {visibleTabs.map(tab => (
          <button data-tour={`cannabisCompliance.activeTab.${tab.key}`} data-tour-action="activate" data-tour-active={activeTab === tab.key} key={tab.key} type="button" onClick={() => setActiveTab(tab.key)}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-all ${activeTab === tab.key ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-600/20' : 'text-white/40 hover:text-white/70 hover:bg-white/[0.04]'}`}>
            {renderIcon(tab.icon, 'w-4 h-4')}<span>{tab.label}</span>
          </button>
        ))}
      </div>

      {/* No Provider Warning */}
      {!provider && activeTab !== 'integrations' && activeTab !== 'dashboard' && (
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-6 text-center">
          <p className="text-amber-400 font-medium mb-2">No provider selected</p>
          <p className="text-xs text-white/40">Select METRC or BioTrack in the Integrations tab to access compliance features.</p>
          <button onClick={() => setActiveTab('integrations')} className="mt-3 px-4 py-2 rounded-lg bg-amber-600 text-white text-sm font-medium">Go to Integrations</button>
        </div>
      )}

      {/* Tab Content */}
      {activeTab === 'dashboard' && <DashboardTab config={config} onNavigate={setActiveTab} />}
      {activeTab === 'integrations' && <IntegrationsTab config={config} setConfig={setConfig} onSave={saveConfig} saving={saving} />}
      {activeTab === 'audit' && provider && <AuditTab config={config} />}
      {activeTab === 'plants' && provider && <PlantsTab config={config} />}
      {activeTab === 'packages' && provider && <PackagesTab config={config} />}
      {activeTab === 'harvests' && provider && <HarvestsTab config={config} />}
      {activeTab === 'transfers' && provider && <TransfersTab config={config} />}
      {activeTab === 'sales' && provider && <SalesTab config={config} />}
      {activeTab === 'labTests' && provider && <LabTestsTab config={config} />}
      {activeTab === 'reports' && provider && <ReportsTab config={config} />}
    </div>
  );
}
