"use client";

import React, { useState, useEffect, useCallback } from "react";
import type { PortalThemeConfig } from "./types";
import { defaultPortalTheme } from "./types";
import PortalThemeControls from "./PortalThemeControls";
import PortalMockPreview from "./PortalMockPreview";

type Props = {
  wallet: string;
  brandKey: string;
  shopConfig: any; // ShopConfig from shop page
  onSave: (cfg?: any) => Promise<void>;
  saving: boolean;
  onConfigUpdate?: (portalTheme: any) => void;
};

export default function PortalThemePlayground({ wallet, brandKey, shopConfig, onSave, saving, onConfigUpdate }: Props) {
  // Initialize from saved portalTheme, or seed from current shopConfig.theme
  const [config, setConfig] = useState<PortalThemeConfig>(() => {
    const base = defaultPortalTheme();

    // Seed from current shop theme so controls reflect what the merchant already has
    const st = shopConfig?.theme;
    if (st) {
      const shopSeed = {
        primaryColor: st.primaryColor || base.dark.primaryColor,
        secondaryColor: st.secondaryColor || base.dark.secondaryColor,
        fontFamily: st.fontFamily || base.dark.fontFamily,
        portalLogoUrl: st.brandLogoUrl || '',
        logoShape: (st.logoShape === 'circle' ? 'circle' : 'square') as 'circle' | 'square',
      };
      base.dark = { ...base.dark, ...shopSeed };
      base.light = { ...base.light, ...shopSeed };
      base.portalGradientEnabled = st.portalGradientEnabled ?? false;
      base.portalGradientStart = st.portalGradientStart || '';
      base.portalGradientEnd = st.portalGradientEnd || '';
    }

    // If merchant already saved a portalTheme, overlay it on top
    if (shopConfig?.portalTheme && typeof shopConfig.portalTheme === 'object') {
      const saved = shopConfig.portalTheme;
      return {
        activeMode: saved.activeMode || base.activeMode,
        dark: { ...base.dark, ...(saved.dark || {}) },
        light: { ...base.light, ...(saved.light || {}) },
        widget: { ...base.widget, ...(saved.widget || {}) },
        touchpointThemeId: saved.touchpointThemeId || base.touchpointThemeId,
        portalGradientEnabled: saved.portalGradientEnabled !== undefined ? saved.portalGradientEnabled : base.portalGradientEnabled,
        portalGradientStart: saved.portalGradientStart !== undefined ? saved.portalGradientStart : base.portalGradientStart,
        portalGradientEnd: saved.portalGradientEnd !== undefined ? saved.portalGradientEnd : base.portalGradientEnd,
      };
    }

    return base;
  });

  const [hasChanges, setHasChanges] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  // Track changes
  const handleChange = useCallback((newConfig: PortalThemeConfig) => {
    setConfig(newConfig);
    setHasChanges(true);
    setSaveStatus('idle');
  }, []);

  // Save handler
  const handleSave = useCallback(async () => {
    try {
      setSaveStatus('saving');

      const body = {
        ...shopConfig,
        theme: {
          ...shopConfig.theme,
          portalGradientEnabled: config.portalGradientEnabled,
          portalGradientStart: config.portalGradientStart,
          portalGradientEnd: config.portalGradientEnd,
        },
        portalTheme: config,
      };

      const r = await fetch('/api/shop/config', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-wallet': wallet,
        },
        body: JSON.stringify(body),
      });

      if (r.ok) {
        if (onConfigUpdate) onConfigUpdate(config);
        setSaveStatus('saved');
        setHasChanges(false);
        setTimeout(() => setSaveStatus('idle'), 2500);
      } else {
        setSaveStatus('error');
      }
    } catch {
      setSaveStatus('error');
    }
  }, [config, shopConfig, wallet]);

  // Reset handler
  const handleReset = useCallback(() => {
    setConfig(defaultPortalTheme());
    setHasChanges(true);
  }, []);

  return (
    <div className="flex flex-col h-full bg-[#050510]">
      {/* Header Bar */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-white/5 bg-[#0a0a12]/80 backdrop-blur shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-violet-500 shadow-[0_0_8px_rgba(139,92,246,0.5)]" />
            <h2 className="text-sm font-semibold text-white/90">Portal Theme Playground</h2>
          </div>
          {hasChanges && (
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20 font-medium">
              Unsaved
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleReset}
            className="px-3 py-1.5 text-xs text-white/40 hover:text-white/70 transition-colors"
          >
            Reset
          </button>
          <button
            onClick={handleSave}
            disabled={saving || saveStatus === 'saving'}
            className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
              saveStatus === 'saved'
                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                : saveStatus === 'error'
                ? 'bg-red-500/20 text-red-400 border border-red-500/30'
                : 'bg-white/10 text-white border border-white/10 hover:bg-white/15 hover:border-white/20'
            }`}
          >
            {saveStatus === 'saving' && (
              <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            )}
            {saveStatus === 'saving' ? 'Saving...' : saveStatus === 'saved' ? '✓ Saved' : saveStatus === 'error' ? 'Error' : 'Save Theme'}
          </button>
        </div>
      </div>

      {/* Split Pane */}
      <div className="flex-1 flex min-h-0">
        {/* Controls (Left) */}
        <div className="w-[360px] shrink-0 overflow-hidden">
          <PortalThemeControls config={config} onChange={handleChange} />
        </div>

        {/* Preview (Right) */}
        <div className="flex-1 min-w-0 bg-[#050510] p-4">
          <PortalMockPreview
            config={config}
            shopName={shopConfig?.name || shopConfig?.slug || ''}
            shopLogo={shopConfig?.theme?.brandLogoUrl || ''}
            wallet={wallet}
          />
        </div>
      </div>
    </div>
  );
}
