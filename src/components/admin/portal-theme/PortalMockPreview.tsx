"use client";

import React, { useMemo, useState, useCallback, useRef, useEffect } from "react";
import { SHADOW_MAP } from "./types";
import type { PortalThemeConfig, PortalModeTheme } from "./types";

/**
 * Live portal preview via iframe.
 * Uses PostMessage bridge for real-time theme updates (no iframe reloads).
 * Supports compact, wide, and invoice layouts + shipping toggle.
 */

type Props = {
  config: PortalThemeConfig;
  shopName: string;
  shopLogo: string;
  wallet: string;
};

type LayoutMode = 'compact' | 'wide' | 'invoice';

export default function PortalMockPreview({ config, shopName, shopLogo, wallet }: Props) {
  const mode = config.activeMode;
  const t: PortalModeTheme = config[mode];
  const [layoutMode, setLayoutMode] = useState<LayoutMode>('compact');
  const [showShipping, setShowShipping] = useState(false);
  const [iframeKey, setIframeKey] = useState(0);
  const [preferredHeight, setPreferredHeight] = useState<number | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  // Build portal URL — only includes layout + recipient (theme applied via PostMessage)
  const portalUrl = useMemo(() => {
    const params = new URLSearchParams();
    if (wallet) params.set('recipient', wallet);

    // Layout mode
    if (layoutMode === 'wide') params.set('layout', 'wide');
    else if (layoutMode === 'invoice') params.set('invoice', '1');

    const receiptId = showShipping ? 'playground-shipping' : 'playground';
    return `/portal/${receiptId}?${params.toString()}`;
  }, [wallet, layoutMode, showShipping]);

  // Listen for portal dynamic height requests
  useEffect(() => {
    const handleMessage = (e: MessageEvent) => {
      if (e.data?.type === 'gateway-preferred-height' && typeof e.data.height === 'number') {
        setPreferredHeight(e.data.height);
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  // Send live theme updates to iframe via PostMessage
  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe?.contentWindow) return;

    const msg = {
      type: 'pp-playground-theme',
      theme: {
        ...t,
        portalGradientEnabled: config.portalGradientEnabled,
        portalGradientStart: config.portalGradientStart,
        portalGradientEnd: config.portalGradientEnd,
      },
      widget: { ...config.widget },
    };

    // Small delay to ensure iframe has loaded
    const timer = setTimeout(() => {
      try {
        iframe.contentWindow?.postMessage(msg, '*');
      } catch { }
    }, 100);

    return () => clearTimeout(timer);
  }, [t, config.widget, config.portalGradientEnabled, config.portalGradientStart, config.portalGradientEnd]);

  // Also send on iframe load
  const handleIframeLoad = useCallback(() => {
    const iframe = iframeRef.current;
    if (!iframe?.contentWindow) return;

    // Staggered sends to catch async renders
    const send = () => {
      try {
        iframe.contentWindow?.postMessage({
          type: 'pp-playground-theme',
          theme: {
            ...t,
            portalGradientEnabled: config.portalGradientEnabled,
            portalGradientStart: config.portalGradientStart,
            portalGradientEnd: config.portalGradientEnd,
          },
          widget: { ...config.widget },
        }, '*');
      } catch { }
    };

    send();
    setTimeout(send, 300);
    setTimeout(send, 800);
    setTimeout(send, 1500);
  }, [t, config.widget, config.portalGradientEnabled, config.portalGradientStart, config.portalGradientEnd]);

  const handleLayoutChange = useCallback((newLayout: LayoutMode) => {
    setLayoutMode(newLayout);
    setIframeKey(k => k + 1);
  }, []);

  const handleShippingToggle = useCallback(() => {
    setShowShipping(s => !s);
    setIframeKey(k => k + 1);
  }, []);

  // Container sizing per layout mode
  const containerStyle = useMemo((): React.CSSProperties => {
    const baseStyle: React.CSSProperties = {
      overflow: 'hidden',
      transform: 'translateZ(0)',
      borderRadius: layoutMode !== 'invoice' ? (t.borderRadius || '12px') : 0,
      boxShadow: layoutMode !== 'invoice' ? (SHADOW_MAP[t.shadowIntensity] || 'none') : 'none',
    };

    switch (layoutMode) {
      case 'compact':
        return { ...baseStyle, width: '100%', maxWidth: 420, height: preferredHeight ? `${preferredHeight}px` : '80vh', maxHeight: 850, minHeight: 400 };
      case 'wide':
        return { ...baseStyle, width: '100%', maxWidth: 800, height: preferredHeight ? `${preferredHeight}px` : '80vh', maxHeight: 850, minHeight: 400 };
      case 'invoice':
        return { ...baseStyle, width: '100%', height: '100%' };
    }
  }, [layoutMode, preferredHeight, t.borderRadius, t.shadowIntensity]);

  return (
    <div className="h-full flex flex-col overflow-hidden rounded-t-xl border border-white/10 border-b-0">
      {/* Browser Chrome + Layout Tabs */}
      <div className="h-10 bg-[#1a1a2e] border-b border-white/10 flex items-center px-3 gap-3 shrink-0 select-none rounded-t-xl">
        <div className="flex gap-1.5">
          <div className="w-2.5 h-2.5 rounded-full bg-[#ff5f57]" />
          <div className="w-2.5 h-2.5 rounded-full bg-[#febc2e]" />
          <div className="w-2.5 h-2.5 rounded-full bg-[#28c840]" />
        </div>

        {/* URL bar */}
        <div className="flex-1 max-w-[220px] mx-auto h-6 rounded-md bg-black/40 border border-white/5 flex items-center justify-center text-[9px] font-mono text-white/40 gap-1.5 px-2 overflow-hidden">
          <span className="text-emerald-400">🔒</span>
          <span className="truncate">portal/{shopName || 'preview'}</span>
        </div>

        {/* Layout mode tabs */}
        <div className="flex gap-0.5 p-0.5 bg-black/30 rounded-md">
          {([
            { key: 'compact' as LayoutMode, label: 'Compact', icon: '📱' },
            { key: 'wide' as LayoutMode, label: 'Wide', icon: '🖥' },
            { key: 'invoice' as LayoutMode, label: 'Invoice', icon: '📄' },
          ]).map(({ key, label, icon }) => (
            <button
              key={key}
              onClick={() => handleLayoutChange(key)}
              className={`px-2 py-1 rounded text-[10px] font-medium transition-all flex items-center gap-1 ${
                layoutMode === key
                  ? 'bg-white/10 text-white'
                  : 'text-white/35 hover:text-white/60'
              }`}
            >
              <span className="text-[9px]">{icon}</span>
              {label}
            </button>
          ))}
        </div>

        {/* Shipping toggle */}
        <button
          onClick={handleShippingToggle}
          className={`px-2 py-1 rounded text-[10px] font-medium transition-all flex items-center gap-1 ${
            showShipping
              ? 'bg-amber-500/15 text-amber-400 border border-amber-500/20'
              : 'bg-white/5 text-white/35 border border-white/5 hover:text-white/60'
          }`}
        >
          📦 {showShipping ? 'Shipping On' : 'Shipping'}
        </button>

        {/* Mode badge */}
        <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-white/5 border border-white/10 text-white/50">
          {mode === 'dark' ? '🌙 Dark' : '☀️ Light'}
        </span>
      </div>

      {/* Live Portal iframe */}
      <div className={`flex-1 relative bg-[#0a0a14] overflow-hidden ${layoutMode !== 'invoice' ? 'flex items-center justify-center p-6' : ''}`}>
        <div style={containerStyle} className="transition-all duration-300 relative">
          <iframe
            ref={iframeRef}
            key={`${iframeKey}-${portalUrl}`}
            src={portalUrl}
            className="w-full h-full border-0"
            title="Portal Theme Preview"
            sandbox="allow-scripts allow-same-origin allow-forms"
            onLoad={handleIframeLoad}
          />
        </div>
      </div>
    </div>
  );
}
