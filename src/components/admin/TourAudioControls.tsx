"use client";

import { useEffect, useRef, useState } from 'react';
import { Headphones, Loader2, MessageCircle, Mic, MicOff, PhoneOff, SlidersHorizontal, Volume2 } from 'lucide-react';

type Props = {
  connected: boolean; connecting: boolean; stage: string; textOnly: boolean; muted: boolean;
  speaking: boolean; disabled: boolean; compact: boolean;
  connect(textOnly: boolean): void; disconnect(): void; toggleMute(): void;
  inputLevel(): number; outputLevel(): number; setVolume(volume: number): void;
  changeInput(deviceId: string): Promise<void>; onError(error: unknown): void;
};
const control = 'inline-flex min-h-9 items-center justify-center gap-2 rounded-lg border border-foreground/10 px-3 text-xs font-medium transition hover:bg-foreground/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)] disabled:cursor-not-allowed disabled:opacity-40';

/** Voice controls stay reachable while a walkthrough minimizes the guide. */
export default function TourAudioControls(props: Props) {
  const { connected, connecting, textOnly, muted, speaking, compact } = props;
  const [volume, setVolume] = useState(0.85);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [device, setDevice] = useState('');
  const [switching, setSwitching] = useState(false);
  const bars = useRef<HTMLDivElement>(null);
  const latest = useRef(props); latest.current = props;
  useEffect(() => {
    if (!connected || textOnly) return;
    latest.current.setVolume(volume);
    setDevice('');
    let alive = true;
    const media = navigator.mediaDevices;
    const refresh = () => { void media?.enumerateDevices().then(list => { if (alive) setDevices(list.filter(d => d.kind === 'audioinput')); }).catch(() => {}); };
    refresh(); media?.addEventListener('devicechange', refresh);
    return () => { alive = false; media?.removeEventListener('devicechange', refresh); };
  }, [connected, textOnly]);
  useEffect(() => {
    if (!connected || textOnly) return;
    const update = () => {
      const current = latest.current;
      const level = Math.max(0, Math.min(1, current.speaking ? current.outputLevel() : current.muted ? 0 : current.inputLevel()));
      // Real signal level, not a decorative indication that the mic is working.
      const count = Math.ceil(Math.sqrt(level || 0) * 16);
      bars.current?.querySelectorAll<HTMLElement>('[data-level]').forEach((bar, i) => { bar.style.opacity = i < count ? '1' : '0.15'; });
    };
    const timer = setInterval(update, 100);
    return () => clearInterval(timer);
  }, [connected, textOnly]);
  const status = connecting ? props.stage : connected ? textOnly ? 'Text chat connected' : speaking ? 'Guide speaking' : muted ? 'Microphone muted' : 'Listening to you' : 'Your personal guide';

  return <div className="space-y-3 border-b border-foreground/10 bg-foreground/[0.025] px-4 py-3" aria-label="Tour audio controls">
    <div className="flex items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-2">
        {connecting ? <Loader2 size={14} className="shrink-0 motion-safe:animate-spin" /> : <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${connected ? 'bg-[var(--primary)]' : 'bg-foreground/30'}`} />}
        <span role="status" className="truncate text-xs text-foreground/70">{status}</span>
      </div>
      {connected && !textOnly && <div ref={bars} className="flex h-4 shrink-0 items-center gap-[2px]" aria-hidden="true">{Array.from({ length: 16 }, (_, i) => <span data-level key={i} className="w-[3px] rounded-full bg-[var(--primary)]" style={{ height: 5 + Math.sin(i / 15 * Math.PI) * 11, opacity: 0.15 }} />)}</div>}
    </div>
    <div className="flex flex-wrap gap-2">
      {!connected && !connecting && <>
        <button type="button" className={control} disabled={props.disabled} onClick={() => props.connect(false)}><Headphones size={14} />Connect voice guide</button>
        <button type="button" className={control} disabled={props.disabled} onClick={() => props.connect(true)}><MessageCircle size={14} />Text chat</button>
      </>}
      {connected && !textOnly && <button type="button" className={control} aria-pressed={muted} onClick={props.toggleMute}>{muted ? <MicOff size={14} /> : <Mic size={14} />}{muted ? 'Unmute' : 'Mute'}</button>}
      {(connected || connecting) && <button type="button" className={control} onClick={props.disconnect}><PhoneOff size={14} />{connecting ? 'Cancel' : 'Disconnect'}</button>}
    </div>
    {!connected && !connecting && !compact && <p className="text-[11px] leading-relaxed text-foreground/50">Voice uses your microphone. Choose Text chat to ask questions without it.</p>}
    {connected && !textOnly && !compact && <details className="text-xs">
      <summary className="flex cursor-pointer list-none items-center gap-2 text-foreground/60"><SlidersHorizontal size={13} />Audio settings</summary>
      <div className="mt-3 space-y-3 rounded-xl border border-foreground/10 p-3">
        <label className="flex items-center gap-3"><Volume2 size={15} /><span className="sr-only">Guide volume</span><input aria-label="Guide volume" type="range" min="0" max="1" step="0.05" value={volume} className="min-w-0 flex-1 accent-[var(--primary)]" onChange={e => { const value = Number(e.target.value); setVolume(value); props.setVolume(value); }} /><span className="w-9 text-right tabular-nums">{Math.round(volume * 100)}%</span></label>
        <label className="block text-foreground/60">Microphone
          <select value={device} disabled={switching || muted} className="mt-1 w-full rounded-lg border border-foreground/10 bg-background p-2 text-foreground disabled:opacity-50" onChange={async e => {
            const selected = e.target.value; setSwitching(true);
            try { await props.changeInput(selected); setDevice(selected); } catch (error) { props.onError(error); } finally { setSwitching(false); }
          }}><option value="">System default</option>{devices.filter(d => d.deviceId !== 'default').map((d, i) => <option key={d.deviceId} value={d.deviceId}>{d.label || `Microphone ${i + 1}`}</option>)}</select>
        </label>
        {muted && <p className="text-[11px] text-foreground/50">Unmute to change your microphone.</p>}
        <p className="text-[11px] leading-relaxed text-foreground/50">Speak naturally to interrupt the guide. Use headphones to reduce echo. Sound plays through your system’s selected output.</p>
      </div>
    </details>}
  </div>;
}
