"use client";

import React, { useRef, useState } from 'react';
import { Sparkles, ArrowRight } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import type { TourBrand } from '@/lib/admin-tour/branding';
import { cleanTourName } from '@/lib/admin-tour/learner';

export default function TourWelcomeDialog({ brand, initialName, resume, onCancel, onBegin }: {
  brand: TourBrand; initialName: string; resume: boolean;
  onCancel: () => void; onBegin: (name: string) => void;
}) {
  const [name, setName] = useState(initialName);
  const [error, setError] = useState('');
  const trigger = useRef<HTMLElement | null>(typeof document !== 'undefined' ? document.activeElement as HTMLElement : null);
  return <Dialog open onOpenChange={open => { if (!open) onCancel(); }}>
    <DialogContent className="w-[calc(100%-2rem)] max-w-md rounded-2xl border-foreground/15 bg-background p-6 text-foreground sm:p-8"
      onCloseAutoFocus={event => { event.preventDefault(); if (trigger.current?.isConnected) trigger.current.focus(); }}>
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--primary)]/10 text-[var(--primary)]"><Sparkles size={24} /></div>
      <p className="text-xs font-medium uppercase tracking-widest text-[var(--primary)]">{brand.name} · Take The Tour</p>
      <DialogTitle className="text-2xl font-semibold tracking-tight">Hello, I’m Daniel.</DialogTitle>
      <DialogDescription className="text-sm leading-relaxed text-foreground/70">
        I’m your AI guide to {brand.platformName}. We’ll explore your workspace together, one panel at a time, with highlights along the way and time for your questions.
      </DialogDescription>
      <form className="mt-2 space-y-5" onSubmit={event => {
        event.preventDefault();
        const preferredName = cleanTourName(name);
        if (!preferredName) {
          setError('Please enter the name you’d like Daniel to use.');
          (event.currentTarget.elements.namedItem('preferredName') as HTMLInputElement | null)?.focus();
          return;
        }
        onBegin(preferredName);
      }}>
        <div className="space-y-2">
          <label htmlFor="tour-preferred-name" className="block text-sm font-medium">What would you like me to call you?</label>
          <input id="tour-preferred-name" name="preferredName" autoComplete="given-name" autoFocus maxLength={60}
            value={name} onChange={event => { setName(event.target.value); setError(''); }}
            aria-invalid={!!error} aria-describedby={`tour-name-help${error ? ' tour-name-error' : ''}`}
            placeholder="Your preferred name" className="w-full rounded-xl border border-foreground/20 bg-foreground/5 px-4 py-3 text-sm outline-none placeholder:text-foreground/40 focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20" />
          <p id="tour-name-help" className="text-xs leading-relaxed text-foreground/55">A first name or nickname is perfect. Daniel will use it during this tour; it won’t change your account profile. Voice and text chat share it with ElevenLabs.</p>
          {error && <p id="tour-name-error" role="alert" className="text-sm text-foreground">{error}</p>}
        </div>
        <div className="flex items-center justify-end gap-3">
          <button type="button" onClick={onCancel} className="rounded-xl px-4 py-3 text-sm text-foreground/65 hover:bg-foreground/5 focus-visible:outline-2 focus-visible:outline-[var(--primary)]">Cancel</button>
          <button type="submit" className="inline-flex items-center gap-2 rounded-xl bg-[var(--primary)] px-5 py-3 text-sm font-semibold text-[var(--primary-foreground)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]">{resume ? 'Resume my tour' : 'Begin my tour'}<ArrowRight size={16} /></button>
        </div>
      </form>
    </DialogContent>
  </Dialog>;
}
