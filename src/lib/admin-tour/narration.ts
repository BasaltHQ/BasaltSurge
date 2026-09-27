type State = { connected: boolean; enabled: boolean; textOnly: boolean; stopId?: string; phase: string; nextStepId?: string };
type Pending = {
  stopId: string; preparedAt: number; responded: boolean; interrupted: boolean;
  firstAudioAt?: number; lastAudioAt?: number; speechFloorMs: number; readingUntil: number;
};

export const TOUR_PACING = {
  quietMs: 2000,
  minimumViewMs: 5000,
  voiceWordsPerMinute: 145,
  readingWordsPerMinute: 210,
} as const;

/** WebRTC has no `ended` event for an individual utterance. Use rendered-audio
 * activity, a conservative transcript-length floor, and a quiet tail together.
 * Speaking/listening includes sentence pauses and must never advance the tour.
 * Without audio evidence, leave the step available for manual navigation. */
export class TourNarration {
  private pending?: Pending;
  private timer?: ReturnType<typeof setTimeout>;
  constructor(private state: () => State, private request: (nextStepId?: string) => void) {}
  get waiting() { return !!this.pending; }
  pause() { clearTimeout(this.timer); this.timer = undefined; }
  reset() { this.pause(); this.pending = undefined; }
  prepare(stopId: string) {
    this.reset();
    this.pending = { stopId, preparedAt: Date.now(), responded: false, interrupted: false, speechFloorMs: 0, readingUntil: 0 };
  }
  /** Discard the interrupted utterance's timing; wait for the answer's audio. */
  interrupt() {
    this.pause();
    if (this.pending) Object.assign(this.pending, { responded: false, interrupted: true, firstAudioAt: undefined, lastAudioAt: undefined, speechFloorMs: 0, readingUntil: 0 });
  }
  response(text = '') {
    const pending = this.pending;
    if (!pending) return;
    const words = text.trim().split(/\s+/).filter(Boolean).length;
    pending.responded = true;
    pending.interrupted = false;
    pending.speechFloorMs = Math.max(pending.speechFloorMs, words * 60000 / TOUR_PACING.voiceWordsPerMinute);
    pending.readingUntil = Date.now() + Math.max(TOUR_PACING.minimumViewMs, words * 60000 / TOUR_PACING.readingWordsPerMinute + TOUR_PACING.quietMs);
    this.schedule();
  }
  /** onAudio in the installed WebRTC SDK samples audible remote playback. */
  audioActivity() {
    const pending = this.pending;
    if (!pending || pending.interrupted) return;
    const now = Date.now();
    pending.firstAudioAt ??= now;
    pending.lastAudioAt = now;
    this.schedule();
  }
  resume() { this.schedule(); }
  private schedule() {
    this.pause();
    const pending = this.pending;
    const state = this.state();
    if (!pending?.responded || pending.interrupted || !state.enabled) return;
    if (!state.textOnly && (pending.firstAudioAt === undefined || pending.lastAudioAt === undefined)) return;
    const earliest = state.textOnly
      ? pending.readingUntil
      : Math.max(pending.preparedAt + TOUR_PACING.minimumViewMs,
        pending.firstAudioAt! + pending.speechFloorMs + TOUR_PACING.quietMs,
        pending.lastAudioAt! + TOUR_PACING.quietMs);
    this.timer = setTimeout(() => {
      const current = this.state();
      if (pending !== this.pending || !current.connected || !current.enabled || current.phase !== 'teaching' || current.stopId !== pending.stopId) return;
      this.pending = undefined;
      this.request(current.nextStepId);
    }, Math.max(0, earliest - Date.now()));
  }
}
