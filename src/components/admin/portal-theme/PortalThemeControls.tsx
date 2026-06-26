"use client";

import React, { useState } from "react";
import type { PortalModeTheme, WidgetOverrides, PortalThemeConfig } from "./types";
import { FONT_PRESETS, SHADOW_MAP } from "./types";
import { THEME_REGISTRY } from "@/lib/themes/registry";

// ── Reusable control primitives ──

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="color"
        value={value.startsWith('#') ? value : '#888888'}
        onChange={(e) => onChange(e.target.value)}
        className="w-8 h-8 rounded-md border border-white/10 cursor-pointer bg-transparent p-0 shrink-0"
        style={{ WebkitAppearance: 'none' }}
      />
      <div className="flex-1 min-w-0">
        <label className="text-[10px] uppercase tracking-wider text-white/40 font-medium">{label}</label>
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="block w-full h-7 px-2 text-xs font-mono bg-white/[0.04] border border-white/10 rounded text-white/80"
        />
      </div>
    </div>
  );
}

function SliderField({ label, value, min, max, step, unit, onChange }: {
  label: string; value: number; min: number; max: number; step: number; unit?: string;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <label className="text-[10px] uppercase tracking-wider text-white/40 font-medium">{label}</label>
        <span className="text-xs font-mono text-white/60">{value}{unit || ''}</span>
      </div>
      <input
        type="range"
        min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full h-1.5 rounded-full appearance-none bg-white/10 accent-emerald-500"
      />
    </div>
  );
}

function SelectField({ label, value, options, onChange }: {
  label: string; value: string; options: { label: string; value: string }[]; onChange: (v: string) => void;
}) {
  return (
    <div>
      <label className="text-[10px] uppercase tracking-wider text-white/40 font-medium block mb-1">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full h-8 px-2 text-xs bg-white/[0.04] border border-white/10 rounded text-white/80"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value} className="bg-[#1a1a2e] text-white/90">{o.label}</option>
        ))}
      </select>
    </div>
  );
}

function Section({ title, children, defaultOpen = true }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-white/5 last:border-0">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between py-3 px-1 text-xs font-semibold uppercase tracking-wider text-white/60 hover:text-white/80 transition-colors"
      >
        {title}
        <span className={`transition-transform text-[10px] ${open ? 'rotate-0' : '-rotate-90'}`}>▼</span>
      </button>
      {open && <div className="pb-4 space-y-3 px-1">{children}</div>}
    </div>
  );
}

// ── Main Controls Component ──

type Props = {
  config: PortalThemeConfig;
  onChange: (cfg: PortalThemeConfig) => void;
};

export default function PortalThemeControls({ config, onChange }: Props) {
  const mode = config.activeMode;
  const modeTheme = config[mode];
  const widget = config.widget;

  // Update current mode's theme
  const setMode = (patch: Partial<PortalModeTheme>) => {
    onChange({ ...config, [mode]: { ...modeTheme, ...patch } });
  };

  const setWidget = (patch: Partial<WidgetOverrides>) => {
    onChange({ ...config, widget: { ...widget, ...patch } });
  };

  return (
    <div className="h-full flex flex-col bg-[#0a0a12] border-r border-white/5">
      {/* Mode Toggle */}
      <div className="p-4 border-b border-white/5">
        <div className="flex gap-1 p-1 bg-white/[0.03] rounded-lg">
          <button
            onClick={() => onChange({ ...config, activeMode: 'dark' })}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-md text-xs font-semibold transition-all ${
              mode === 'dark'
                ? 'bg-white/10 text-white shadow-sm'
                : 'text-white/40 hover:text-white/60'
            }`}
          >
            <span>🌙</span> Dark
          </button>
          <button
            onClick={() => onChange({ ...config, activeMode: 'light' })}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-md text-xs font-semibold transition-all ${
              mode === 'light'
                ? 'bg-white/10 text-white shadow-sm'
                : 'text-white/40 hover:text-white/60'
            }`}
          >
            <span>☀️</span> Light
          </button>
        </div>
      </div>

      {/* Scrollable Controls */}
      <div className="flex-1 overflow-y-auto px-4 scrollbar-hide">
        {/* Touchpoint Preset */}
        <Section title="Theme Preset">
          <div className="grid grid-cols-2 gap-1.5">
            {Object.values(THEME_REGISTRY).map((t) => (
              <button
                key={t.id}
                onClick={() => {
                  // Presets only change structural/styling — NOT colors
                  // pageBg/surfaceBg/borderColor from registry are dark-mode only,
                  // so skip them when the user is in light mode
                  const structural: Record<string, any> = {
                    borderRadius: t.borderRadius,
                    glassOpacity: t.glassOpacity,
                    blurStrength: t.blurStrength,
                    shadowIntensity: t.shadowIntensity,
                  };
                  if (mode === 'dark') {
                    structural.pageBg = t.primaryBg;
                    structural.surfaceBg = t.surfaceBg;
                    structural.borderColor = t.borderColor;
                  }
                  onChange({ ...config, touchpointThemeId: t.id, [mode]: {
                    ...modeTheme,
                    ...structural,
                  }, widget: { ...widget, buttonRadius: t.buttonStyle } });
                }}
                className={`px-2 py-2 rounded-md text-[11px] font-medium border transition-all ${
                  config.touchpointThemeId === t.id
                    ? 'bg-white/10 border-white/20 text-white'
                    : 'bg-white/[0.02] border-white/5 text-white/50 hover:border-white/15 hover:text-white/70'
                }`}
              >
                <div className="flex items-center gap-1.5">
                  <div className="w-3 h-3 shrink-0 border border-white/30" style={{ borderRadius: t.borderRadius, background: 'rgba(255,255,255,0.1)' }} />
                  {t.name}
                </div>
              </button>
            ))}
          </div>
        </Section>

        {/* Brand Colors */}
        <Section title="Brand Colors">
          <ColorField label="Primary" value={modeTheme.primaryColor} onChange={(v) => setMode({ primaryColor: v })} />
          <ColorField label="Secondary" value={modeTheme.secondaryColor} onChange={(v) => setMode({ secondaryColor: v })} />
        </Section>

        {/* Background & Surfaces */}
        <Section title="Background & Surfaces" defaultOpen={false}>
          <ColorField label="Page Background" value={modeTheme.pageBg} onChange={(v) => setMode({ pageBg: v })} />
          <ColorField label="Surface / Card" value={modeTheme.surfaceBg} onChange={(v) => setMode({ surfaceBg: v })} />
          <SliderField label="Glass Opacity" value={Math.round(modeTheme.glassOpacity * 100)} min={0} max={100} step={5} unit="%" onChange={(v) => setMode({ glassOpacity: v / 100 })} />
          <SliderField label="Blur Strength" value={parseInt(modeTheme.blurStrength) || 0} min={0} max={30} step={2} unit="px" onChange={(v) => setMode({ blurStrength: `${v}px` })} />
        </Section>

        {/* Left-Pane Gradient */}
        <Section title="Left-Pane Gradient" defaultOpen={false}>
          <div className="flex items-center justify-between mb-2">
            <label className="text-[10px] uppercase tracking-wider text-white/40 font-medium">Enable Gradient</label>
            <button
              type="button"
              onClick={() => onChange({ ...config, portalGradientEnabled: !config.portalGradientEnabled })}
              className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                config.portalGradientEnabled ? "bg-emerald-500" : "bg-zinc-700"
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                  config.portalGradientEnabled ? "translate-x-4" : "translate-x-0"
                }`}
              />
            </button>
          </div>
          {config.portalGradientEnabled && (
            <div className="space-y-3 pt-1 animate-in fade-in slide-in-from-top-1 duration-200">
              <ColorField
                label="Gradient Start"
                value={config.portalGradientStart || modeTheme.primaryColor || "#10b981"}
                onChange={(v) => onChange({ ...config, portalGradientStart: v })}
              />
              <ColorField
                label="Gradient End"
                value={config.portalGradientEnd || modeTheme.secondaryColor || "#6366f1"}
                onChange={(v) => onChange({ ...config, portalGradientEnd: v })}
              />
            </div>
          )}
        </Section>

        {/* Typography */}
        <Section title="Typography" defaultOpen={false}>
          <SelectField
            label="Font Family"
            value={modeTheme.fontFamily}
            options={FONT_PRESETS}
            onChange={(v) => setMode({ fontFamily: v })}
          />
          <ColorField label="Header Text" value={modeTheme.headerTextColor} onChange={(v) => setMode({ headerTextColor: v })} />
          <ColorField label="Body Text" value={modeTheme.bodyTextColor} onChange={(v) => setMode({ bodyTextColor: v })} />
          <ColorField label="Muted Text" value={modeTheme.mutedTextColor} onChange={(v) => setMode({ mutedTextColor: v })} />
        </Section>

        {/* Borders & Effects */}
        <Section title="Borders & Effects" defaultOpen={false}>
          <ColorField label="Border Color" value={modeTheme.borderColor} onChange={(v) => setMode({ borderColor: v })} />
          <SliderField label="Border Radius" value={parseInt(modeTheme.borderRadius) || 8} min={0} max={24} step={2} unit="px" onChange={(v) => setMode({ borderRadius: `${v}px` })} />
          <SelectField
            label="Shadow Intensity"
            value={modeTheme.shadowIntensity}
            options={[
              { label: 'None', value: 'none' },
              { label: 'Soft', value: 'soft' },
              { label: 'Medium', value: 'medium' },
              { label: 'Strong', value: 'strong' },
            ]}
            onChange={(v) => setMode({ shadowIntensity: v as any })}
          />
        </Section>

        {/* Checkout Widget */}
        <Section title="Checkout Widget" defaultOpen={false}>
          <div>
            <label className="text-[10px] uppercase tracking-wider text-white/40 font-medium block mb-1.5">Button Style</label>
            <div className="flex gap-1.5">
              {(['rounded', 'pill', 'sharp'] as const).map((style) => (
                <button
                  key={style}
                  onClick={() => setWidget({ buttonRadius: style })}
                  className={`flex-1 py-2 text-[11px] font-medium border transition-all ${
                    widget.buttonRadius === style
                      ? 'bg-white/10 border-white/20 text-white'
                      : 'bg-white/[0.02] border-white/5 text-white/40 hover:border-white/15'
                  }`}
                  style={{
                    borderRadius: style === 'pill' ? '9999px' : style === 'sharp' ? '4px' : '8px',
                  }}
                >
                  {style.charAt(0).toUpperCase() + style.slice(1)}
                </button>
              ))}
            </div>
          </div>
          <ColorField label="Button Background" value={widget.buttonBg || modeTheme.primaryColor} onChange={(v) => setWidget({ buttonBg: v })} />
          <ColorField label="Button Text" value={widget.buttonTextColor || '#ffffff'} onChange={(v) => setWidget({ buttonTextColor: v })} />
          <ColorField label="Card Background" value={widget.cardBg || modeTheme.surfaceBg} onChange={(v) => setWidget({ cardBg: v })} />
          <ColorField label="Card Border" value={widget.cardBorderColor || modeTheme.borderColor} onChange={(v) => setWidget({ cardBorderColor: v })} />
          <ColorField label="Input Background" value={widget.inputBg || 'rgba(0,0,0,0.2)'} onChange={(v) => setWidget({ inputBg: v })} />
          <ColorField label="Input Border" value={widget.inputBorderColor || modeTheme.borderColor} onChange={(v) => setWidget({ inputBorderColor: v })} />
          <ColorField label="Accent Color" value={widget.accentColor || modeTheme.secondaryColor} onChange={(v) => setWidget({ accentColor: v })} />
        </Section>

        {/* Logo */}
        <Section title="Portal Logo" defaultOpen={false}>
          <div>
            <label className="text-[10px] uppercase tracking-wider text-white/40 font-medium block mb-1">Logo URL</label>
            <input
              type="text"
              value={modeTheme.portalLogoUrl}
              onChange={(e) => setMode({ portalLogoUrl: e.target.value })}
              placeholder="https://... or /logo.png"
              className="w-full h-8 px-2 text-xs bg-white/[0.04] border border-white/10 rounded text-white/80 placeholder:text-white/20"
            />
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wider text-white/40 font-medium block mb-1.5">Shape</label>
            <div className="flex gap-2">
              {(['circle', 'square'] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setMode({ logoShape: s })}
                  className={`flex-1 py-2 text-[11px] font-medium rounded-md border transition-all ${
                    modeTheme.logoShape === s
                      ? 'bg-white/10 border-white/20 text-white'
                      : 'bg-white/[0.02] border-white/5 text-white/40'
                  }`}
                >
                  {s === 'circle' ? '⬤ Circle' : '⬜ Square'}
                </button>
              ))}
            </div>
          </div>
        </Section>
      </div>
    </div>
  );
}
