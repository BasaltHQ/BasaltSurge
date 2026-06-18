"use client";

import React, { useEffect, useRef, useState } from "react";
import { useActiveAccount } from "thirdweb/react";
import { CheckCircle, Plus, X } from "lucide-react";

type TipConfig = {
  presets: number[];
  defaultTip: number | null;
  allowCustom: boolean;
  enabled?: boolean;
};

const DEFAULT_PRESETS = [0, 10, 15, 20];

type TipSettingsProps = {
  walletOverride?: string;
};

export function TipSettings({ walletOverride }: TipSettingsProps) {
  const account = useActiveAccount();
  const effectiveWallet = walletOverride || account?.address || "";

  const [presets, setPresets] = useState<number[]>(DEFAULT_PRESETS);
  const [defaultTip, setDefaultTip] = useState<number | null>(null);
  const [allowCustom, setAllowCustom] = useState(true);
  const [enabled, setEnabled] = useState(true);
  const [newPreset, setNewPreset] = useState<string>("");

  // Baselines for unsaved change detection
  const [lastSaved, setLastSaved] = useState<TipConfig>({
    presets: DEFAULT_PRESETS,
    defaultTip: null,
    allowCustom: true,
    enabled: true,
  });

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [savedPulse, setSavedPulse] = useState(false);
  const saveDebounceRef = useRef<number | null>(null);

  // Load existing tip config
  useEffect(() => {
    if (!effectiveWallet) return;
    setLoading(true);
    fetch("/api/site/config", {
      headers: { "x-wallet": effectiveWallet },
    })
      .then((r) => r.json())
      .then((j) => {
        const cfg = j?.config?.tipConfig;
        if (cfg && typeof cfg === "object") {
          if (Array.isArray(cfg.presets) && cfg.presets.length > 0) {
            const p = cfg.presets
              .map((v: any) => Number(v))
              .filter((v: number) => Number.isFinite(v) && v >= 0 && v <= 100);
            if (p.length > 0) setPresets(p);
            setLastSaved((prev) => ({ ...prev, presets: p.length > 0 ? p : prev.presets }));
          }
          if (typeof cfg.defaultTip === "number" && Number.isFinite(cfg.defaultTip)) {
            setDefaultTip(cfg.defaultTip);
            setLastSaved((prev) => ({ ...prev, defaultTip: cfg.defaultTip }));
          }
          if (typeof cfg.allowCustom === "boolean") {
            setAllowCustom(cfg.allowCustom);
            setLastSaved((prev) => ({ ...prev, allowCustom: cfg.allowCustom }));
          }
          if (typeof cfg.enabled === "boolean") {
            setEnabled(cfg.enabled);
            setLastSaved((prev) => ({ ...prev, enabled: cfg.enabled }));
          } else {
            setEnabled(true);
            setLastSaved((prev) => ({ ...prev, enabled: true }));
          }
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [effectiveWallet]);

  async function saveTipConfig(config: TipConfig) {
    try {
      setSaving(true);
      setError("");
      const r = await fetch("/api/site/config", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-wallet": effectiveWallet,
        },
        body: JSON.stringify({ tipConfig: config }),
      });
      if (r.ok) {
        setLastSaved({ ...config });
        setSavedPulse(true);
        try {
          setTimeout(() => setSavedPulse(false), 1200);
        } catch {}
      } else {
        const j = await r.json().catch(() => ({}));
        setError(j?.error || "Failed to save");
      }
    } catch (e: any) {
      setError(e?.message || "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  function scheduleSave(config: TipConfig) {
    if (saveDebounceRef.current) clearTimeout(saveDebounceRef.current as any);
    saveDebounceRef.current = window.setTimeout(() => {
      saveTipConfig(config);
    }, 400) as any;
  }

  function addPreset() {
    const val = Number(newPreset);
    if (!Number.isFinite(val) || val < 0 || val > 100) return;
    if (presets.includes(val)) return;
    if (presets.length >= 6) return;
    const next = [...presets, val].sort((a, b) => a - b);
    setPresets(next);
    setNewPreset("");
    scheduleSave({ presets: next, defaultTip, allowCustom, enabled });
  }

  function removePreset(val: number) {
    const next = presets.filter((p) => p !== val);
    const newDefault = defaultTip === val ? null : defaultTip;
    setPresets(next);
    setDefaultTip(newDefault);
    scheduleSave({ presets: next, defaultTip: newDefault, allowCustom, enabled });
  }

  function handleDefaultChange(val: string) {
    const next = val === "none" ? null : Number(val);
    setDefaultTip(next);
    scheduleSave({ presets, defaultTip: next, allowCustom, enabled });
  }

  function handleCustomToggle(checked: boolean) {
    setAllowCustom(checked);
    scheduleSave({ presets, defaultTip, allowCustom: checked, enabled });
  }

  function handleEnabledToggle(checked: boolean) {
    setEnabled(checked);
    scheduleSave({ presets, defaultTip, allowCustom, enabled: checked });
  }

  function resetToDefaults() {
    setPresets(DEFAULT_PRESETS);
    setDefaultTip(null);
    setAllowCustom(true);
    setEnabled(true);
    saveTipConfig({ presets: DEFAULT_PRESETS, defaultTip: null, allowCustom: true, enabled: true });
  }

  if (loading) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-10 bg-muted/20 rounded-md w-full" />
        <div className="h-10 bg-muted/20 rounded-md w-full" />
        <div className="h-10 bg-muted/20 rounded-md w-full" />
      </div>
    );
  }

  const hasChanges =
    JSON.stringify(presets) !== JSON.stringify(lastSaved.presets) ||
    defaultTip !== lastSaved.defaultTip ||
    allowCustom !== lastSaved.allowCustom ||
    enabled !== lastSaved.enabled;

  return (
    <div className="grid grid-cols-1 md:grid-cols-12 gap-6 md:gap-8">
      {/* Header Area */}
      <div className="md:col-span-12 flex flex-col md:flex-row md:items-center justify-between shrink-0 gap-4 mb-2">
        <div>
           <h3 className="text-[10px] uppercase font-bold tracking-[0.2em] text-muted-foreground flex items-center gap-2">
             <div className="w-1.5 h-1.5 rounded-full bg-[var(--pp-secondary)]" /> 
             Tip Settings
           </h3>
           <div className="text-[9px] text-muted-foreground/60 uppercase font-semibold tracking-wider mt-1">Configure tip presets and default gratuity options.</div>
        </div>
        <div className="flex justify-end h-8">
          {savedPulse && (
            <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 text-emerald-500 px-4 py-1.5 text-[9px] font-bold uppercase tracking-wider inline-flex items-center gap-2 shadow-sm animate-in fade-in zoom-in duration-300">
              <CheckCircle className="h-3 w-3" /> Saved successfully
            </div>
          )}
        </div>
      </div>

      {/* Enable Tipping Switch Panel */}
      <div className="md:col-span-12 rounded-3xl border border-foreground/[0.04] bg-foreground/[0.02] p-6 md:p-8 flex items-center justify-between shadow-sm relative overflow-hidden">
        {enabled && <div className="absolute top-0 right-0 w-48 h-48 bg-[var(--pp-secondary)] opacity-5 blur-[60px] pointer-events-none" />}
        <div>
          <label className="text-[10px] md:text-xs uppercase font-bold tracking-wider text-foreground mb-2 block ml-1 relative z-10">Enable Tipping</label>
          <div className="text-[8px] md:text-[9px] text-muted-foreground/60 uppercase font-bold tracking-wider ml-1 leading-relaxed relative z-10">
            Show or hide the tipping section completely from the customer payment portal.
          </div>
        </div>
        <div className="flex justify-end relative z-10">
          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            onClick={() => handleEnabledToggle(!enabled)}
            className={`relative w-14 h-7 rounded-full transition-colors ${
              enabled ? "bg-[var(--pp-secondary)] shadow-[0_0_15px_var(--pp-secondary)]/30" : "bg-foreground/20"
            }`}
          >
            <span
              className={`absolute top-1 left-1 w-5 h-5 rounded-full bg-white shadow transition-transform ${
                enabled ? "translate-x-7" : "translate-x-0"
              }`}
            />
          </button>
        </div>
      </div>

      {/* Tip Presets Panel */}
      <div className={`md:col-span-12 rounded-3xl border border-foreground/[0.04] bg-foreground/[0.02] p-6 md:p-8 flex flex-col gap-6 shadow-sm transition-opacity duration-200 ${!enabled ? "opacity-40 pointer-events-none" : ""}`}>
        <div>
          <label className="text-[10px] md:text-xs uppercase font-bold tracking-wider text-foreground mb-2 block ml-1">Tip Presets</label>
          <div className="text-[8px] md:text-[9px] text-muted-foreground/60 uppercase font-bold tracking-wider ml-1">
            Configure the tip percentage options shown to customers. Up to 6 presets allowed.
          </div>
        </div>
        
        <div className="flex flex-wrap items-center gap-3">
          {presets.map((p) => (
            <div
              key={p}
              className={`group flex items-center gap-2 h-12 px-5 rounded-xl border text-xs font-bold transition-all shadow-sm ${
                defaultTip === p
                  ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-500"
                  : "bg-foreground/[0.03] border-foreground/[0.05] text-foreground/90 hover:bg-foreground/[0.05] hover:border-foreground/10"
              }`}
            >
              <span className="tabular-nums tracking-wide">{p}%</span>
              <button
                type="button"
                onClick={() => removePreset(p)}
                className="opacity-0 group-hover:opacity-100 hover:text-red-400 transition-opacity ml-1 -mr-2 p-1"
                title={`Remove ${p}%`}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
          {presets.length < 6 && (
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={0}
                max={100}
                step={1}
                value={newPreset}
                onChange={(e) => setNewPreset(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addPreset();
                  }
                }}
                placeholder="%"
                className="h-12 px-4 rounded-xl border border-foreground/5 bg-foreground/[0.03] focus:bg-foreground/[0.05] focus:ring-1 focus:ring-[var(--pp-secondary)] focus:outline-none text-xs font-bold w-20 tabular-nums transition-all"
                title="New preset percentage"
              />
              <button
                type="button"
                onClick={addPreset}
                disabled={!newPreset}
                className="h-12 px-5 rounded-xl border border-foreground/5 bg-foreground/[0.03] hover:bg-foreground/[0.06] flex items-center justify-center transition-all disabled:opacity-30 text-[9px] font-bold uppercase tracking-wider text-muted-foreground hover:text-foreground shadow-sm"
                title="Add preset"
              >
                <Plus className="h-4 w-4 mr-1.5" /> Add
              </button>
            </div>
          )}
        </div>
      </div>

      <div className={`md:col-span-12 lg:col-span-6 rounded-3xl border border-foreground/[0.04] bg-foreground/[0.02] p-6 md:p-8 flex flex-col gap-4 shadow-sm transition-opacity duration-200 ${!enabled ? "opacity-40 pointer-events-none" : ""}`}>
        <div>
          <label className="text-[10px] md:text-xs uppercase font-bold tracking-wider text-foreground mb-2 block ml-1">Default Tip</label>
          <div className="text-[8px] md:text-[9px] text-muted-foreground/60 uppercase font-bold tracking-wider ml-1 mb-4 leading-relaxed">
            Pre-selects this tip percentage for buyers when they open the payment portal.
          </div>
        </div>
        <select
          className="w-full h-12 px-4 rounded-xl bg-foreground/[0.03] border border-foreground/5 focus:bg-foreground/[0.05] focus:ring-1 focus:ring-[var(--pp-secondary)] focus:outline-none transition-all text-xs font-medium"
          value={defaultTip === null ? "none" : String(defaultTip)}
          onChange={(e) => handleDefaultChange(e.target.value)}
        >
          <option value="none">None (no pre-selection)</option>
          {presets.map((p) => (
            <option key={p} value={String(p)}>
              {p}%
            </option>
          ))}
        </select>
      </div>

      <div className={`md:col-span-12 lg:col-span-6 rounded-3xl border border-foreground/[0.04] bg-foreground/[0.02] p-6 md:p-8 flex flex-col justify-between shadow-sm relative overflow-hidden transition-opacity duration-200 ${!enabled ? "opacity-40 pointer-events-none" : ""}`}>
        {allowCustom && <div className="absolute top-0 right-0 w-48 h-48 bg-[var(--pp-secondary)] opacity-5 blur-[60px] pointer-events-none" />}
        <div>
          <label className="text-[10px] md:text-xs uppercase font-bold tracking-wider text-foreground mb-2 block ml-1 relative z-10">Allow Custom Tip</label>
          <div className="text-[8px] md:text-[9px] text-muted-foreground/60 uppercase font-bold tracking-wider ml-1 leading-relaxed relative z-10">
            Lets buyers enter their own tip percentage during checkout.
          </div>
        </div>
        <div className="flex justify-end mt-4 md:mt-0 relative z-10">
          <button
            type="button"
            role="switch"
            aria-checked={allowCustom}
            onClick={() => handleCustomToggle(!allowCustom)}
            className={`relative w-14 h-7 rounded-full transition-colors ${
              allowCustom ? "bg-[var(--pp-secondary)] shadow-[0_0_15px_var(--pp-secondary)]/30" : "bg-foreground/20"
            }`}
          >
            <span
              className={`absolute top-1 left-1 w-5 h-5 rounded-full bg-white shadow transition-transform ${
                allowCustom ? "translate-x-7" : "translate-x-0"
              }`}
            />
          </button>
        </div>
      </div>

      {error && (
        <div className="md:col-span-12 text-[10px] uppercase font-bold tracking-wider text-red-500 mt-2 px-2">
          {error}
        </div>
      )}

      {/* Actions */}
      <div className="md:col-span-12 flex flex-col sm:flex-row items-center justify-between pt-6 border-t border-foreground/5 gap-4">
        <button
          type="button"
          onClick={resetToDefaults}
          className="px-6 py-3 rounded-xl border border-foreground/[0.05] bg-foreground/[0.02] hover:bg-foreground/[0.05] text-[9px] font-bold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-all w-full sm:w-auto"
        >
          Reset to Defaults
        </button>
        <button
          onClick={() => saveTipConfig({ presets, defaultTip, allowCustom, enabled })}
          disabled={saving || !hasChanges}
          className="px-8 py-3 bg-[var(--pp-secondary)] hover:bg-[var(--pp-secondary)]/90 text-white rounded-xl text-[9px] md:text-[10px] font-bold uppercase tracking-[0.15em] shadow-[0_0_20px_var(--pp-secondary)]/30 transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:shadow-none w-full sm:w-auto"
        >
          {saving ? "Saving..." : "Save Tip Settings"}
        </button>
      </div>
    </div>
  );
}
