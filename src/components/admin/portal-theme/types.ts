/**
 * Portal Theme Playground — Type Definitions & Defaults
 */

export type PortalModeTheme = {
  primaryColor: string;
  secondaryColor: string;
  pageBg: string;
  surfaceBg: string;
  headerTextColor: string;
  bodyTextColor: string;
  mutedTextColor: string;
  borderColor: string;
  borderRadius: string;
  glassOpacity: number;
  blurStrength: string;
  shadowIntensity: 'none' | 'soft' | 'medium' | 'strong';
  fontFamily: string;
  portalLogoUrl: string;
  logoShape: 'square' | 'circle';
};

export type WidgetOverrides = {
  buttonRadius: 'pill' | 'rounded' | 'sharp';
  buttonBg: string;
  buttonTextColor: string;
  cardBg: string;
  cardBorderColor: string;
  cardBorderRadius: string;
  inputBorderColor: string;
  inputBg: string;
  accentColor: string;
};

export type PortalThemeConfig = {
  activeMode: 'dark' | 'light';
  dark: PortalModeTheme;
  light: PortalModeTheme;
  widget: WidgetOverrides;
  touchpointThemeId: string;
  portalGradientEnabled?: boolean;
  portalGradientStart?: string;
  portalGradientEnd?: string;
};

// ── Defaults ──

export const DEFAULT_DARK: PortalModeTheme = {
  primaryColor: '#10b981',
  secondaryColor: '#6366f1',
  pageBg: '#050510',
  surfaceBg: 'rgba(16, 14, 24, 0.82)',
  headerTextColor: '#ffffff',
  bodyTextColor: '#e5e7eb',
  mutedTextColor: '#9ca3af',
  borderColor: 'rgba(99, 102, 241, 0.2)',
  borderRadius: '12px',
  glassOpacity: 0.5,
  blurStrength: '12px',
  shadowIntensity: 'medium',
  fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif',
  portalLogoUrl: '',
  logoShape: 'circle',
};

export const DEFAULT_LIGHT: PortalModeTheme = {
  primaryColor: '#0ea5e9',
  secondaryColor: '#8b5cf6',
  pageBg: '#f8fafc',
  surfaceBg: 'rgba(255, 255, 255, 0.9)',
  headerTextColor: '#0f172a',
  bodyTextColor: '#334155',
  mutedTextColor: '#94a3b8',
  borderColor: 'rgba(148, 163, 184, 0.3)',
  borderRadius: '12px',
  glassOpacity: 0.3,
  blurStrength: '8px',
  shadowIntensity: 'soft',
  fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif',
  portalLogoUrl: '',
  logoShape: 'circle',
};

export const DEFAULT_WIDGET: WidgetOverrides = {
  buttonRadius: 'rounded',
  buttonBg: '',
  buttonTextColor: '',
  cardBg: '',
  cardBorderColor: '',
  cardBorderRadius: '12px',
  inputBorderColor: '',
  inputBg: '',
  accentColor: '',
};

export function defaultPortalTheme(): PortalThemeConfig {
  return {
    activeMode: 'dark',
    dark: { ...DEFAULT_DARK },
    light: { ...DEFAULT_LIGHT },
    widget: { ...DEFAULT_WIDGET },
    touchpointThemeId: 'modern',
    portalGradientEnabled: false,
    portalGradientStart: '',
    portalGradientEnd: '',
  };
}

// ── Font Presets ──

export const FONT_PRESETS: { label: string; value: string }[] = [
  { label: 'Inter (Default)', value: 'Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif' },
  { label: 'Roboto', value: 'Roboto, Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, Helvetica, Arial, sans-serif' },
  { label: 'Poppins', value: 'Poppins, Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, Helvetica, Arial, sans-serif' },
  { label: 'Space Grotesk', value: 'Space Grotesk, Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, Helvetica, Arial, sans-serif' },
  { label: 'Merriweather (Serif)', value: 'Merriweather, Georgia, Cambria, Times New Roman, Times, serif' },
  { label: 'Georgia (Serif)', value: "Georgia, 'Times New Roman', serif" },
  { label: 'System (SF/Segoe)', value: 'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif' },
];

export const SHADOW_MAP: Record<string, string> = {
  none: 'none',
  soft: '0 4px 16px rgba(0,0,0,0.18)',
  medium: '0 8px 28px rgba(0,0,0,0.3)',
  strong: '0 12px 40px rgba(0,0,0,0.45), 0 4px 12px rgba(0,0,0,0.2)',
};
