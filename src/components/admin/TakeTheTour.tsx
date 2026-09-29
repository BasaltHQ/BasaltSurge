"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useConversation } from "@elevenlabs/react";
import { ArrowRight, Check, ChevronDown, Compass, Headphones, MessageCircle, Play, Sparkles, X } from "lucide-react";
import { buildTour, getLesson, tourRoles, type TourMode, type TourNavigation, type TourStop } from "@/lib/admin-tour/catalog";
import { TourInterface, type TourAction } from "@/lib/admin-tour/interface";
import { NEUTRAL_TOUR_BRAND, tourSessionVariables } from '@/lib/admin-tour/branding';
import { useTourContent } from '@/hooks/useTourContent';
import { stepsForMode, type TourStep } from '@/lib/admin-tour/steps';
import { TourNarration } from '@/lib/admin-tour/narration';
import { prepareTourMicrophone, tourAudioError, tourSessionError } from '@/lib/admin-tour/audio';
import TourAudioControls from './TourAudioControls';
import TourWelcomeDialog from './TourWelcomeDialog';
import { cleanTourName, tourIntroduction } from '@/lib/admin-tour/learner';

interface Props { navigation: TourNavigation | null; activeTab: string; wallet: string; ready: boolean; }
type Phase = "teaching" | "questions" | "complete";
type Pending = { action: TourAction; label: string; stopId: string };
const button = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)] rounded-xl border border-foreground/15 px-3 py-2 text-sm transition hover:bg-foreground/10 disabled:opacity-40 disabled:cursor-not-allowed";

export default function TakeTheTour({ navigation, activeTab, wallet, ready: workspaceReady }: Props) {
  const [running, setRunning] = useState(false);
  const [learnerName, setLearnerName] = useState('');
  const [welcomeRequest, setWelcomeRequest] = useState<{ resume: boolean } | null>(null);
  const content = useTourContent(activeTab === 'takeTour' || running);
  const brand = navigation?.brand || NEUTRAL_TOUR_BRAND;
  const ready = workspaceReady && brand.ready && !!content.lessons;
  const itinerary = useMemo(() => buildTour(navigation?.stops || [], content.lessons || {}), [navigation, content.lessons]);
  const roles = tourRoles(itinerary);
  const [mode, setMode] = useState<TourMode>("brief");
  const [currentId, setCurrentId] = useState("");
  const [completed, setCompleted] = useState<string[]>([]);
  const [visited, setVisited] = useState<string[]>([]);
  const [phase, setPhase] = useState<Phase>("teaching");
  const [pending, setPending] = useState<Pending | null>(null);
  const [requestedStop, setRequestedStop] = useState("");
  const [error, setError] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [audioStage, setAudioStage] = useState('Connecting to your guide');
  const [muted, setMuted] = useState(false);
  const [textOnly, setTextOnly] = useState(false);
  const [compact, setCompact] = useState(false);
  const [question, setQuestion] = useState("");
  const [transcript, setTranscript] = useState<{ source: string; message: string }[]>([]);
  const [restored, setRestored] = useState(false);
  const [stepResults, setStepResults] = useState<Record<string, { status: 'shown' | 'unavailable' | 'skipped'; reason?: string }>>({});
  const [shownStep, setShownStep] = useState<TourStep | null>(null);
  const [stepBusy, setStepBusy] = useState(false);
  const [autoPaused, setAutoPaused] = useState(false);
  const walkthrough = useRef({ epoch: 0, busy: false, results: {} as typeof stepResults });
  const index = itinerary.findIndex(s => s.id === currentId);
  const current = itinerary[index];
  const lesson = current ? getLesson(current, content.lessons || {}, brand) : null;
  const steps = stepsForMode(lesson?.steps, mode);
  const nextStep = steps.find(step => !stepResults[step.id]);
  const storageKey = `pp:admin-tour:v2:${brand.key}:${wallet}`;
  const session = useRef<{ id?: string; started?: number; timer?: ReturnType<typeof setTimeout> } | null>(null);
  const attempt = useRef(0);
  const connectionRequest = useRef<AbortController | null>(null);
  const startingSDK = useRef(false);
  const intentionalDisconnect = useRef(false);
  const mounted = useRef(true);
  const interfaceRef = useRef<TourInterface | null>(null);
  const latest = useRef({ itinerary, current, mode, phase, running, visited, ready, activeTab, navigation, brand, learnerName, lessons: content.lessons, textOnly, autoPaused });
  latest.current = { itinerary, current, mode, phase, running, visited, ready, activeTab, navigation, brand, learnerName, lessons: content.lessons, textOnly, autoPaused };
  const narration = useRef<TourNarration | null>(null);
  if (!narration.current) narration.current = new TourNarration(() => {
    const state = latest.current;
    return { connected: conversationRef.current.status === 'connected', enabled: state.running && state.ready && !state.autoPaused &&
      state.activeTab === (state.current?.panel === 'developers' ? 'tourDevelopers' : state.current?.panel),
      textOnly: state.textOnly, stopId: state.current?.id, phase: state.phase, nextStepId: context().walkthrough.nextStepId };
  }, () => { void advanceWalkthrough(); });

  function finishUsage() {
    const usage = session.current;
    session.current = null;
    if (!usage) return;
    clearTimeout(usage.timer);
    if (usage.id) void fetch('/api/voice/usage/commit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, keepalive: true,
      body: JSON.stringify({ id: usage.id, seconds: usage.started ? Math.ceil((Date.now() - usage.started) / 1000) : 0 }) }).catch(() => {});
  }

  function panelInterface() {
    if (!interfaceRef.current) interfaceRef.current = new TourInterface(() => {
      const root = document.getElementById('admin-tour-panel');
      // The developer portal remains inside the admin tour so the session survives.
      const frame = root?.querySelector<HTMLIFrameElement>('iframe[data-tour-developers]');
      try { return frame?.contentDocument?.body || root; } catch { return root; }
    });
    return interfaceRef.current;
  }

  function context() {
    const state = latest.current;
    const currentLesson = state.current ? getLesson(state.current, state.lessons || {}, state.brand) : null;
    const sequence = stepsForMode(currentLesson?.steps, state.mode);
    return { roles: tourRoles(state.itinerary), mode: state.mode, phase: state.phase, current: state.current,
      brand: state.brand, learner: { preferredName: state.learnerName },
      lesson: currentLesson, itinerary: state.itinerary,
      walkthrough: { driver: 'application', results: walkthrough.current.results, nextStepId: sequence.find(step => !walkthrough.current.results[step.id])?.id,
        busy: walkthrough.current.busy, narrating: narration.current?.waiting || false, paused: state.autoPaused },
      canContinue: state.phase === 'questions',
      instruction: 'The application opens each highlight and sends APP_WALKTHROUGH_STEP. Explain only that step, without asking questions or requesting Continue. The application sends APP_QUESTION_BREAK after the last explanation; only then invite questions. Answer interruptions and then let the application resume.' };
  }

  function resetSteps() {
    narration.current?.reset(); setAutoPaused(false);
    walkthrough.current = { epoch: walkthrough.current.epoch + 1, busy: false, results: {} };
    setStepResults({}); setShownStep(null); setStepBusy(false);
    interfaceRef.current?.reset();
  }

  async function runStep(stopId: string, stepId: string) {
    const state = latest.current;
    if (!state.running || !state.ready || state.phase !== 'teaching' || state.current?.id !== stopId ||
      state.activeTab !== (state.current.panel === 'developers' ? 'tourDevelopers' : state.current.panel)) throw new Error('Return to the current tour panel before starting a step.');
    if (walkthrough.current.busy) throw new Error('A walkthrough step is already in progress. Wait for its result.');
    if (state.autoPaused) throw new Error('The learner interrupted the walkthrough. Answer their question and wait for Resume walkthrough.');
    const sequence = stepsForMode(getLesson(state.current, state.lessons || {}, state.brand).steps, state.mode);
    const expected = sequence.find(step => !walkthrough.current.results[step.id]);
    if (!expected || expected.id !== stepId) throw new Error('Use the next step ID from getTourContext. Steps cannot be skipped by the guide.');
    const epoch = walkthrough.current.epoch;
    walkthrough.current.busy = true; setStepBusy(true); setError(''); setPending(null);
    narration.current?.reset();
    try {
      const result = await panelInterface().walkthrough(expected);
      if (epoch !== walkthrough.current.epoch || !latest.current.running || latest.current.current?.id !== stopId) throw new Error('The walkthrough changed. Get the current context again.');
      walkthrough.current.results = { ...walkthrough.current.results, [stepId]: result };
      setStepResults(walkthrough.current.results); setShownStep(expected); setCompact(true);
      narration.current?.prepare(stopId);
      const remaining = sequence.filter(step => !walkthrough.current.results[step.id]);
      return { ...result, title: expected.title, explanation: state.mode === 'extended' ? expected.extended : expected.brief,
        stopId, nextStepId: remaining[0]?.id, remainingSteps: remaining.length,
        instruction: (result.status === 'shown' ? 'Explain only this highlighted view. ' : 'Briefly explain why this view is unavailable; do not claim it opened. ') +
          'End your turn after the explanation, without a question, permission check, apology, or instruction to click Continue. The application advances after your audio finishes, including opening the final question break.' };
    } finally {
      if (epoch === walkthrough.current.epoch) { walkthrough.current.busy = false; setStepBusy(false); }
    }
  }

  async function showNextStep() {
    if (!current || !nextStep) return;
    latest.current.autoPaused = false; setAutoPaused(false);
    try {
      const result = await runStep(current.id, nextStep.id);
      if (conversationRef.current.status === 'connected') narrateStep(result);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not show this step.'); }
  }

  function narrateStep(result: Awaited<ReturnType<typeof runStep>>, welcome = false) {
    conversationRef.current.sendUserMessage('APP_WALKTHROUGH_STEP ' + JSON.stringify({ ...result,
      mode: latest.current.mode, brand: latest.current.brand, learner: { preferredName: latest.current.learnerName }, welcome,
      introduction: welcome ? tourIntroduction(latest.current.brand, latest.current.learnerName) : undefined,
      instruction: result.instruction + (welcome ? ' Begin with the supplied personal introduction, then explain the displayed step in the same turn. Do not ask for the name again; the welcome form has already collected it.' : '') }));
  }

  function enterQuestions() {
    const state = latest.current;
    if (!state.current) return;
    narration.current?.reset(); latest.current.phase = 'questions';
    setPhase('questions'); setCompact(false); setAutoPaused(false);
    setCompleted(old => [...new Set([...old, state.current!.id])]);
  }

  async function advanceWalkthrough(welcome = false) {
    const state = latest.current;
    const epoch = walkthrough.current.epoch;
    if (!state.running || !state.ready || state.autoPaused || state.phase !== 'teaching' || !state.current ||
      state.activeTab !== (state.current.panel === 'developers' ? 'tourDevelopers' : state.current.panel) || walkthrough.current.busy) return;
    const nextId = context().walkthrough.nextStepId;
    if (!nextId) {
      enterQuestions();
      conversationRef.current.sendUserMessage('APP_QUESTION_BREAK All authored steps and their explanations are complete. The Continue button is now enabled. Invite questions once, then wait. Do not repeat the overview or navigate.');
      return;
    }
    try { narrateStep(await runStep(state.current.id, nextId), welcome); }
    catch (error) {
      // A stale DOM job must not pause the new panel or restart a disconnected guide.
      if (walkthrough.current.epoch !== epoch || latest.current.current?.id !== state.current.id || !latest.current.running) return;
      narration.current?.reset(); latest.current.autoPaused = true; setAutoPaused(true);
      setError(error instanceof Error ? error.message : 'This highlight could not open. Retry or skip it.');
    }
  }

  function resumeWalkthrough() {
    latest.current.autoPaused = false; setAutoPaused(false); setError('');
    if (conversationRef.current.status === 'connected' && narration.current?.waiting) narration.current.resume();
    else if (conversationRef.current.status === 'connected') void advanceWalkthrough();
    else void showNextStep();
  }

  function openStop(stop: TourStop) {
    if (!latest.current.ready || !latest.current.navigation?.navigate(stop.id)) { setError('This panel is no longer available. Refresh your tour.'); return false; }
    setCurrentId(stop.id); setVisited(old => [...new Set([...old, stop.id])]);
    setPhase('teaching'); setPending(null); setRequestedStop(''); setError('');
    resetSteps();
    return true;
  }

  const tools = useMemo(() => {
    const safe = (fn: (parameters: Record<string, unknown>) => unknown, allowBusy = false) => (parameters: Record<string, unknown>) => {
      const state = latest.current;
      if (!state.running || !state.ready || !state.current || state.phase === 'complete') return JSON.stringify({ error: 'The tour is not active.' });
      const panel = state.current.panel === 'developers' ? 'tourDevelopers' : state.current.panel;
      if (state.activeTab !== panel) return JSON.stringify({ error: 'User navigated away. Ask them to return to the tour panel before using tools.' });
      if (walkthrough.current.busy && !allowBusy) return JSON.stringify({ error: 'A walkthrough step is in progress. Wait for its result.' });
      try { return JSON.stringify(fn(parameters)); } catch (e) { return JSON.stringify({ error: e instanceof Error ? e.message : 'Interface action failed' }); }
    };
    return {
      getTourContext: safe(() => context(), true),
      // The model cannot race the audio completion coordinator or batch highlights.
      runTourStep: safe(() => ({ status: 'application_managed', walkthrough: context().walkthrough,
        instruction: 'The app controls step changes. Explain the current APP_WALKTHROUGH_STEP and end your turn. No apology or question is needed. Do not request Continue during teaching.' }), true),
      inspectPanel: safe(() => ({ controls: panelInterface().inspect() })),
      highlightControl: safe(p => {
        const result = panelInterface().highlight(String(p.controlId));
        setShownStep(null); setCompact(true);
        return { result, instruction: 'The guide is minimized so the learner can see the highlighted control. Voice remains connected.' };
      }),
      proposeInterfaceAction: safe(p => {
        if (p.action !== 'click' && p.action !== 'fill') throw new Error('Unsupported action');
        const action: TourAction = { controlId: String(p.controlId), action: p.action, value: typeof p.value === 'string' ? p.value : undefined };
        const label = panelInterface().describe(action);
        setPending({ action, label, stopId: latest.current.current!.id });
        return { status: 'awaiting_user_review', instruction: 'The user must Apply or Dismiss the action in the guide. Do not claim success.' };
      }),
      navigateTour: safe(p => {
        const target = latest.current.itinerary.find(s => s.id === p.stopId);
        if (!target) throw new Error('That panel is not in the accessible sidebar.');
        if (target.id === latest.current.current?.id) return { status: 'already_here', instruction: 'Keep explaining the current step; do not restart the panel.' };
        // Even a model that ignores its prompt cannot skip the learner's question break.
        if (!latest.current.visited.includes(target.id)) {
          setRequestedStop(target.id);
          return { status: 'awaiting_user_navigation', instruction: latest.current.phase === 'questions'
            ? 'The user can choose Open requested panel or Continue.'
            : 'The current walkthrough is still in progress. Do not ask for Continue; the application will open the question break after the remaining explanations.' };
        }
        return { opened: openStop(target) };
      }),
      finishSegment: safe(p => {
        if (p.stopId !== latest.current.current?.id) throw new Error('The current panel changed. Get the current context again.');
        if (walkthrough.current.busy || context().walkthrough.nextStepId || narration.current?.waiting) return {
          status: 'walkthrough_in_progress', canContinue: false,
          instruction: 'The application is still presenting this panel. This is a normal status, not an error. Finish the current explanation without apologizing, asking questions or requesting Continue. The app opens the question break automatically.' };
        enterQuestions();
        return { status: 'questions', canContinue: true, instruction: 'Ask for questions once and wait. Do not navigate until the user chooses to continue.' };
      }, true),
    };
  }, []);

  const conversation = useConversation({
    clientTools: tools, micMuted: muted,
    workletPaths: { rawAudioProcessor: '/elevenlabs/rawAudioProcessor.js', audioConcatProcessor: '/elevenlabs/audioConcatProcessor.js' },
    onMessage: event => {
      setTranscript(old => [...old.slice(-79), { source: event.source, message: event.message }]);
      if (event.source === 'ai') narration.current?.response(event.message);
      else narration.current?.interrupt();
    },
    // WebRTC mode is a speaker-activity hint, not utterance playback completion.
    onAudio: () => narration.current?.audioActivity(),
    onInterruption: () => narration.current?.interrupt(),
    onError: message => {
      narration.current?.reset();
      if (mounted.current && !intentionalDisconnect.current) { setError(tourAudioError({ message })); void disconnect(); }
    },
    onDisconnect: () => {
      narration.current?.reset();
      if (mounted.current && !intentionalDisconnect.current && session.current?.started) setError('The guide disconnected. Reconnect to continue; your tour progress is saved.');
      finishUsage();
    },
  });
  const conversationRef = useRef(conversation);
  conversationRef.current = conversation;
  const connected = conversation.status === 'connected';
  const currentIsOpen = !!current && activeTab === (current.panel === 'developers' ? 'tourDevelopers' : current.panel);

  useEffect(() => {
    if (!connected || textOnly) return;
    // The SDK's WebRTC capture worklet can be unavailable while its remote
    // output analyser still works. Observe playback, never microphone volume.
    const timer = setInterval(() => {
      if (conversationRef.current.getOutputVolume() > 0.008) narration.current?.audioActivity();
    }, 100);
    return () => clearInterval(timer);
  }, [connected, textOnly]);

  async function disconnect() {
    attempt.current++;
    intentionalDisconnect.current = true;
    connectionRequest.current?.abort();
    narration.current?.reset();
    walkthrough.current.epoch++; walkthrough.current.busy = false; setStepBusy(false); interfaceRef.current?.reset();
    setConnecting(false); setPending(null);
    await conversationRef.current.endSession().catch(() => {});
    finishUsage();
  }

  async function connect(asText: boolean) {
    if (connecting || connected || !latest.current.ready) return;
    if (startingSDK.current) { setError('The previous connection is still closing. Please retry in a moment.'); return; }
    const ticket = ++attempt.current;
    const controller = new AbortController(); connectionRequest.current = controller;
    intentionalDisconnect.current = false;
    setConnecting(true); setError(''); setTextOnly(asText);
    setAudioStage(asText ? 'Connecting to your guide' : 'Waiting for microphone permission');
    let sdkStarted = false;
    try {
      if (!asText) await prepareTourMicrophone();
      if (ticket !== attempt.current || !mounted.current) return;
      setAudioStage('Connecting to your guide'); setMuted(false);
      const response = await fetch('/api/voice/elevenlabs/signed-url', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(25000)]),
        body: JSON.stringify({ persona: 'tour', connectionType: asText ? 'websocket' : 'webrtc' }) });
      const data = await response.json();
      if (!response.ok) { if (ticket === attempt.current && mounted.current) setError(tourSessionError(response.status, data.error)); return; }
      if (ticket !== attempt.current || !mounted.current) {
        if (data.usageDocId) void fetch('/api/voice/usage/commit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: data.usageDocId, seconds: 0 }), keepalive: true }).catch(() => {});
        return;
      }
      session.current = { id: data.usageDocId };
      startingSDK.current = true; sdkStarted = true;
      await conversationRef.current.startSession({ ...(asText ? { signedUrl: data.signedUrl, connectionType: 'websocket' as const } : { conversationToken: data.conversationToken, connectionType: 'webrtc' as const }), textOnly: asText,
        dynamicVariables: tourSessionVariables(latest.current.brand, latest.current.learnerName) });
      if (ticket !== attempt.current || !mounted.current) { await conversationRef.current.endSession(); finishUsage(); return; }
      if (session.current) session.current.started = Date.now();
      if (session.current) session.current.timer = setTimeout(() => { void disconnect(); setError('This session reached its time limit. Your tour progress is saved.'); }, Math.min(Number(data.maxDurationSec) || 7200, 7200) * 1000);
      if (latest.current.phase === 'questions') {
        conversationRef.current.sendUserMessage('APP_QUESTION_BREAK The learner reconnected at the question break. Invite their questions once and wait. Continue is enabled.');
      } else { latest.current.autoPaused = false; setAutoPaused(false); await advanceWalkthrough(true); }
    } catch (e) {
      if (mounted.current && ticket === attempt.current) setError(tourAudioError(e));
      if (sdkStarted) { intentionalDisconnect.current = true; await conversationRef.current.endSession().catch(() => {}); finishUsage(); }
    } finally {
      if (sdkStarted) startingSDK.current = false;
      if (connectionRequest.current === controller) connectionRequest.current = null;
      if (mounted.current && ticket === attempt.current) setConnecting(false);
    }
  }

  useEffect(() => {
    // Names belong only to this wallet/workspace in memory, never saved progress.
    setLearnerName(''); latest.current.learnerName = ''; setWelcomeRequest(null); setTranscript([]);
    if (latest.current.running) { latest.current.running = false; setRunning(false); void disconnect(); }
  }, [wallet, brand.key]);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || 'null');
      if (saved?.version === 1) {
        setMode(saved.mode === 'extended' ? 'extended' : 'brief');
        if (typeof saved.currentId === 'string') setCurrentId(saved.currentId);
        if (Array.isArray(saved.completed)) setCompleted(saved.completed.filter((id: unknown) => typeof id === 'string'));
      }
    } catch { /* Storage may be disabled. */ }
    setRestored(true);
  }, [storageKey]);

  useEffect(() => {
    if (!restored) return;
    try { localStorage.setItem(storageKey, JSON.stringify({ version: 1, mode, currentId, completed })); } catch { /* Optional persistence. */ }
  }, [storageKey, restored, mode, currentId, completed]);

  useEffect(() => {
    if (!running || !connected || !currentIsOpen) return;
    // Defer until the mode/panel reset effect below invalidates the previous DOM job.
    const timer = setTimeout(() => {
      conversationRef.current.sendContextualUpdate(JSON.stringify(context()));
      void advanceWalkthrough();
    }, 0);
    return () => clearTimeout(timer);
  }, [currentId, mode, currentIsOpen]); // Connection startup sends its own introduction.

  useEffect(() => {
    if (connected) {
      void disconnect();
      setError('The workspace branding changed. Reconnect to continue with the updated guide.');
    }
  }, [brand.name, brand.platformName]);

  useEffect(() => {
    setPending(null); interfaceRef.current?.reset();
    if (running && (!ready || !itinerary.some(s => s.id === currentId))) {
      setRunning(false); void disconnect(); setError('Your available panels changed. Start again with your current access.');
    }
  }, [navigation, ready]);

  useEffect(() => {
    setPending(null); interfaceRef.current?.reset();
    if (running && connected && !currentIsOpen) conversationRef.current.sendContextualUpdate('The user has navigated away from the tour stop. Pause teaching and wait for them to return.');
  }, [activeTab]);

  useEffect(() => {
    // A changed mode or panel invalidates pending DOM work and starts a fresh sequence.
    resetSteps();
  }, [currentId, mode, activeTab]);

  useEffect(() => {
    mounted.current = true;
    const stop = () => { narration.current?.reset(); attempt.current++; intentionalDisconnect.current = true; connectionRequest.current?.abort(); void conversationRef.current.endSession(); finishUsage(); };
    window.addEventListener('pagehide', stop);
    return () => { mounted.current = false; window.removeEventListener('pagehide', stop); stop(); interfaceRef.current?.reset(); };
  }, []);

  function start(resume: boolean, preferredName: string) {
    const name = cleanTourName(preferredName);
    if (!name || !ready || running) return;
    const stop = (resume && itinerary.find(s => s.id === currentId)) || itinerary[0];
    if (!stop) return;
    setLearnerName(name); latest.current.learnerName = name; setWelcomeRequest(null);
    if (!resume) setCompleted([]);
    setVisited(resume ? completed.filter(id => itinerary.some(s => s.id === id)) : []);
    setTranscript([]); setRunning(true); setCompact(false);
    openStop(stop);
  }

  function next() {
    if (!current) return;
    setCompleted(old => [...new Set([...old, current.id])]);
    const remaining = itinerary.find(s => s.id !== current.id && !completed.includes(s.id));
    const following = itinerary.slice(index + 1).find(s => !completed.includes(s.id)) || remaining;
    if (following) openStop(following);
    else { setPhase('complete'); void disconnect(); }
  }

  function approve() {
    if (!pending || pending.stopId !== currentId || !currentIsOpen || !ready) return;
    try {
      panelInterface().apply(pending.action);
      if (connected) conversation.sendContextualUpdate(`User applied the proposed action: ${pending.label}. Inspect the panel again before making further claims.`);
      setPending(null);
    } catch (e) { setPending(null); setError(e instanceof Error ? e.message : 'Action failed.'); }
  }

  const completedCount = itinerary.filter(s => completed.includes(s.id)).length;
  const sections = [...new Set(itinerary.map(s => s.section))];

  return <>
    {welcomeRequest && activeTab === 'takeTour' && ready && <TourWelcomeDialog brand={brand} initialName={learnerName} resume={welcomeRequest.resume}
      onCancel={() => setWelcomeRequest(null)} onBegin={name => start(welcomeRequest.resume, name)} />}
    {activeTab === 'takeTour' && <section className="relative overflow-hidden rounded-2xl border border-foreground/10 bg-background/95 backdrop-blur-xl p-6 text-foreground md:p-10" aria-labelledby="tour-title">
      <div className="pointer-events-none absolute -right-20 -top-32 h-96 w-96 rounded-full bg-[var(--primary)]/10 blur-3xl" />
      <div className="relative max-w-3xl space-y-6">
        <span className="inline-flex items-center gap-2 rounded-full border border-[var(--primary)]/20 bg-[var(--primary)]/10 px-3 py-1 text-xs text-[var(--primary)]"><Sparkles size={14} /> YOUR WORKSPACE, EXPLAINED</span>
        <h1 id="tour-title" className="text-3xl font-semibold tracking-tight md:text-4xl">Take The Tour</h1>
        <p className="text-lg font-medium text-[var(--primary)]">Welcome to {brand.name}.</p>
        <p className="max-w-2xl text-base leading-relaxed text-foreground/75">A personal guide to everything you can do here. Explore your real workspace with an AI trainer, ask questions along the way, and learn at your own pace.</p>
        <div className="flex flex-wrap gap-2" aria-label="Detected sidebar roles">{roles.map(role => <span key={role} className="rounded-full border border-foreground/15 px-3 py-1 text-xs capitalize">{role}</span>)}</div>
        <div className="grid gap-3 sm:grid-cols-2">
          {(['brief', 'extended'] as const).map(choice => <button key={choice} type="button" aria-pressed={mode === choice} onClick={() => setMode(choice)} className={`rounded-2xl border p-5 text-left transition ${mode === choice ? 'border-[var(--primary)]/60 bg-[var(--primary)]/10' : 'border-foreground/10 hover:border-foreground/30'}`}>
            <div className="mb-2 flex items-center justify-between text-lg font-medium capitalize">{choice} {mode === choice && <Check size={18} className="text-[var(--primary)]" />}</div>
            <p className="text-sm leading-relaxed text-foreground/75">{choice === 'brief' ? 'The essentials: what each panel does, where to begin, and one useful takeaway.' : 'A deeper walkthrough with practical examples, key controls, and a chance to check your understanding.'}</p>
            <p className="mt-3 text-xs text-foreground/60">{choice === 'brief' ? 'Short explanations of each main view' : 'Detailed explanations and additional highlights'} + your questions</p>
          </button>)}
        </div>
        <div className="flex flex-wrap gap-3">
          <button type="button" className="flex items-center gap-2 rounded-xl bg-[var(--primary)] px-5 py-3 font-semibold text-[var(--primary-foreground)] disabled:opacity-40" disabled={!ready || !itinerary.length || running || !restored} onClick={() => setWelcomeRequest({ resume: false })}><Play size={17} /> Start my tour</button>
          {!!current && !running && <button type="button" className={button} disabled={!ready} onClick={() => setWelcomeRequest({ resume: true })}>Resume · {completedCount}/{itinerary.length} covered</button>}
        </div>
        {!ready && !content.error && <p role="status" className="text-sm text-amber-300">{!workspaceReady ? 'Waiting for your signed-in workspace and permissions…' : !brand.ready ? 'Loading your workspace branding…' : 'Loading your panel guides…'}</p>}
        {content.error && <p role="alert" className="text-sm text-amber-300">{content.error} <button type="button" onClick={content.retry} className="underline">Retry</button></p>}
        <div className="flex flex-wrap gap-5 text-xs text-foreground/60"><span><Headphones className="mr-1 inline" size={14} /> Voice or text chat</span><span><MessageCircle className="mr-1 inline" size={14} /> Questions after every panel</span><span><Compass className="mr-1 inline" size={14} /> {itinerary.length} panels · {sections.length} sections</span></div>
        <p className="text-xs leading-relaxed text-foreground/50">Your route follows the sections in your sidebar. The guide can spotlight controls and prepare actions for you to review. Voice and chat use ElevenLabs; field values and credentials are not sent by the interface tools.</p>
      </div>
      <div className="relative mt-10 border-t border-foreground/10 pt-6">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-widest text-foreground/60">Your learning path</h2>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{sections.map((section, sectionIndex) => <details key={section} className="rounded-2xl border border-foreground/10 p-4">
          <summary className="cursor-pointer text-sm font-medium"><span className="mr-2 text-[var(--primary)]">{String(sectionIndex + 1).padStart(2, '0')}</span>{section}<span className="ml-2 text-foreground/50">{itinerary.filter(s => s.section === section).length}</span></summary>
          <ol className="mt-3 space-y-2 text-sm text-foreground/60">{itinerary.filter(s => s.section === section).map(s => <li key={s.id} className="flex items-center gap-2">{completed.includes(s.id) && <Check size={13} className="text-[var(--primary)]" />}{s.title}</li>)}</ol>
        </details>)}</div>
      </div>
      {error && <p role="alert" className="mt-4 text-sm text-amber-300">{error}</p>}
    </section>}

    {running && current && <aside aria-label="Take The Tour guide" className="fixed bottom-3 right-3 z-[90] flex max-h-[calc(100dvh-1.5rem)] flex-col [&>div]:shrink-0 [&>div.min-h-0]:shrink w-[calc(100%-1.5rem)] max-w-md overflow-hidden rounded-2xl border border-[var(--primary)]/25 bg-background/95 backdrop-blur-xl text-foreground shadow-2xl shadow-black/40 md:bottom-5 md:right-5">
      <div className="flex items-center gap-3 border-b border-foreground/10 p-4">
        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--primary)]/15 text-[var(--primary)] ${conversation.isSpeaking ? 'motion-safe:animate-pulse' : ''}`}><Sparkles size={20} /></div>
        <div className="min-w-0 flex-1"><p className="truncate text-xs text-[var(--primary)]">{brand.name} · Take The Tour · {mode}</p><p className="truncate text-sm font-medium">{current.title}</p></div>
        <button type="button" className="p-2 text-foreground/60 hover:text-foreground" aria-label={compact ? 'Expand guide' : 'Minimize guide'} onClick={() => setCompact(!compact)}><ChevronDown size={17} className={compact ? 'rotate-180' : ''} /></button>
        <button type="button" className="p-2 text-foreground/60 hover:text-foreground" aria-label="End tour and save progress" onClick={() => { setRunning(false); void disconnect(); interfaceRef.current?.reset(); }}><X size={17} /></button>
      </div>
      <div className="h-1 bg-foreground/5" role="progressbar" aria-label="Panels covered" aria-valuemin={0} aria-valuemax={itinerary.length} aria-valuenow={completedCount}><div className="h-full bg-[var(--primary)] transition-all" style={{ width: `${completedCount / Math.max(1, itinerary.length) * 100}%` }} /></div>
      {phase !== 'complete' && <TourAudioControls connected={connected} connecting={connecting} stage={audioStage} textOnly={textOnly} muted={muted}
        speaking={conversation.isSpeaking} disabled={!currentIsOpen || !ready} compact={compact}
        connect={connect} disconnect={disconnect} toggleMute={() => setMuted(value => !value)}
        inputLevel={() => conversationRef.current.getInputVolume()} outputLevel={() => conversationRef.current.getOutputVolume()}
        setVolume={volume => conversationRef.current.setVolume({ volume })}
        changeInput={inputDeviceId => conversationRef.current.changeInputDevice({ inputDeviceId: inputDeviceId || undefined, format: 'pcm', sampleRate: 16000 })}
        onError={error => setError(tourAudioError(error))} />}
      {error && <div role="alert" className="max-h-28 overflow-y-auto border-b border-amber-400/20 bg-amber-400/10 px-4 py-3 text-xs leading-relaxed text-foreground">{error}</div>}
      {connected && phase === 'teaching' && <div className="px-4 py-2">
        <button type="button" className="text-xs text-foreground/60 underline underline-offset-4" onClick={() => {
          if (autoPaused) resumeWalkthrough();
          else { latest.current.autoPaused = true; setAutoPaused(true); narration.current?.pause(); conversation.sendContextualUpdate('The learner paused automatic walkthrough progression. Answer questions if asked; do not ask them to click Continue.'); }
        }}>{autoPaused ? 'Resume walkthrough' : 'Pause walkthrough'}</button>
      </div>}
      {compact && shownStep && <div className="space-y-2 p-3" aria-live="polite">
        <p className="text-xs font-medium text-[var(--primary)]">{shownStep.title} · {Object.keys(stepResults).length}/{steps.length}</p>
        <p className="max-h-24 overflow-y-auto text-xs leading-relaxed text-foreground/75">{stepResults[shownStep.id]?.status !== 'shown' ? stepResults[shownStep.id]?.reason : mode === 'extended' ? shownStep.extended : shownStep.brief}</p>
        {phase === 'teaching' && nextStep && <button type="button" className={button} disabled={stepBusy || !currentIsOpen} onClick={() => void showNextStep()}>{stepBusy ? 'Opening view…' : 'Next highlight'}</button>}
        {(!nextStep || phase === 'questions') && <button type="button" className={button} onClick={() => setCompact(false)}>Questions and panel navigation</button>}
        {autoPaused && !connected && <button type="button" className={button} onClick={resumeWalkthrough}>Retry highlight</button>}
      </div>}
      {!compact && <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        {phase === 'complete' ? <div className="space-y-3 py-4 text-center"><Check className="mx-auto text-[var(--primary)]" size={32} /><h2 className="text-xl font-semibold">You’ve explored your workspace.</h2><p className="text-sm text-foreground/60">{completedCount} panels across {sections.length} sections. Come back whenever you need a refresher.</p><button className={button} type="button" onClick={() => { setRunning(false); }}>Finish tour</button></div> : <>
          <div className="flex items-center justify-between text-xs text-foreground/60"><span>{current.section}</span><span>{index + 1} of {itinerary.length}</span></div>
          {!currentIsOpen && <div className="rounded-xl border border-amber-400/30 bg-amber-400/10 p-3 text-sm"><p>You’re exploring another panel. The guide is paused here.</p><button type="button" className={`${button} mt-2`} onClick={() => openStop(current)}>Return to {current.title}</button></div>}
          <p className="text-sm leading-relaxed text-foreground/90">{lesson?.summary}</p>
          {autoPaused && phase === 'teaching' && <p className="text-xs text-[var(--primary)]">Automatic walkthrough progression is paused. Resume when you are ready, or open the next highlight.</p>}
          {!!steps.length && <div className="space-y-3 rounded-xl border border-[var(--primary)]/25 bg-[var(--primary)]/5 p-3" aria-label="Panel walkthrough">
            <div className="flex justify-between text-xs text-[var(--primary)]"><span>Guided highlights</span><span>{Object.keys(stepResults).length}/{steps.length}</span></div>
            {shownStep && <div aria-live="polite"><p className="text-sm font-semibold">{shownStep.title}</p><p className="mt-1 text-sm leading-relaxed text-foreground/75">{stepResults[shownStep.id]?.status !== 'shown' ? stepResults[shownStep.id]?.reason : mode === 'extended' ? shownStep.extended : shownStep.brief}</p></div>}
            {phase === 'teaching' && nextStep && <>
              <button type="button" className={button} disabled={stepBusy || !currentIsOpen} onClick={() => void showNextStep()}>{stepBusy ? 'Opening view…' : `${shownStep ? 'Next highlight' : 'Show me'}: ${nextStep.title}`}</button>
              <button type="button" className="block text-xs text-foreground/50 underline" disabled={stepBusy || !currentIsOpen} onClick={() => {
                walkthrough.current.results = { ...walkthrough.current.results, [nextStep.id]: { status: 'skipped', reason: 'Skipped by the learner.' } };
                setStepResults(walkthrough.current.results); setShownStep(nextStep); interfaceRef.current?.reset();
                narration.current?.reset();
                if (connected) { conversation.sendContextualUpdate(`The learner skipped step ${nextStep.id}. Do not claim it was demonstrated.`); resumeWalkthrough(); }
              }}>Skip this highlight</button>
            </>}
            {!nextStep && <p className="text-xs text-[var(--primary)]">{connected && phase === 'teaching' ? 'Finishing the final explanation…' : 'Panel walkthrough finished. Ready for your questions.'}</p>}
            {Object.values(stepResults).some(result => result.status !== 'shown') && <p className="text-xs text-foreground/60">{Object.values(stepResults).filter(result => result.status === 'unavailable').length} unavailable · {Object.values(stepResults).filter(result => result.status === 'skipped').length} skipped</p>}
          </div>}
          {mode === 'extended' && <ol className="space-y-2 text-sm leading-relaxed text-foreground/60">{lesson?.explore.map((point, i) => <li key={point}><span className="mr-2 text-[var(--primary)]">{i + 1}.</span>{point}</li>)}</ol>}
          <p className="rounded-xl bg-foreground/5 p-3 text-sm text-foreground/75"><span className="mb-1 block text-[10px] uppercase tracking-wider text-[var(--primary)]">Your takeaway</span>{lesson?.takeaway}</p>
          {lesson?.documentationHref && <a href={lesson.documentationHref} target="_blank" rel="noopener noreferrer" className="inline-block text-xs text-[var(--primary)] underline underline-offset-4">Read this panel’s guide</a>}
          {!!transcript.length && <details><summary className="cursor-pointer text-xs text-foreground/60">Conversation transcript</summary><div className="mt-2 max-h-40 space-y-2 overflow-y-auto text-xs" aria-live="polite">{transcript.map((line, i) => <p key={i} className={line.source === 'user' ? 'text-foreground/60' : 'text-foreground/90'}><strong>{line.source === 'user' ? 'You' : 'Guide'}:</strong> {line.message}</p>)}</div></details>}
          {pending && <div className="space-y-2 rounded-xl border border-amber-400/30 bg-amber-400/10 p-3 text-sm"><p className="font-medium">Review interface action</p><p>{pending.label}</p>{pending.action.action === 'fill' && <p className="break-words text-xs text-foreground/75">Text: {pending.action.value}</p>}<p className="text-xs text-foreground/60">This operates the live panel.</p><button type="button" className={button} onClick={approve} disabled={!currentIsOpen}>Apply action</button><button type="button" className={`${button} ml-2`} onClick={() => { setPending(null); if (connected) conversation.sendContextualUpdate('The user dismissed the proposed action. It was not executed.'); }}>Dismiss</button></div>}
          <form className="flex gap-2" onSubmit={e => { e.preventDefault(); if (!connected || !question.trim()) return; narration.current?.interrupt(); conversation.sendUserMessage(question.trim()); setQuestion(''); }}>
            <input aria-label="Ask your tour guide" value={question} onChange={e => { setQuestion(e.target.value); if (connected) conversation.sendUserActivity(); }} disabled={!connected || !currentIsOpen} maxLength={2000} placeholder={connected ? 'Ask anything about this panel…' : 'Connect voice or text to ask questions'} className="min-w-0 flex-1 rounded-xl border border-foreground/15 bg-foreground/5 px-3 py-2 text-sm placeholder:text-foreground/50" />
            <button type="submit" className={button} disabled={!connected || !question.trim() || !currentIsOpen} aria-label="Send question"><ArrowRight size={16} /></button>
          </form>
          {phase === 'questions' ? <div className="rounded-xl border border-[var(--primary)]/20 bg-[var(--primary)]/10 p-3"><p className="text-sm font-medium text-[var(--primary)]">Your questions, your pace.</p><p className="mt-1 text-xs text-foreground/75">Ask as many as you like. We’ll stay here until you choose to continue.</p></div> : <button type="button" className="text-xs text-foreground/60 underline underline-offset-4" disabled={!currentIsOpen || stepBusy} onClick={() => {
            const results = { ...walkthrough.current.results };
            for (const step of steps) if (!results[step.id]) results[step.id] = { status: 'skipped', reason: 'Learner chose the question break.' };
            walkthrough.current.results = results; setStepResults(results);
            enterQuestions(); interfaceRef.current?.reset();
            if (connected) conversation.sendContextualUpdate('The learner chose the question break. Remaining steps were skipped by the learner, not demonstrated. Stop the introduction and wait for questions.');
          }}>{nextStep ? 'Skip remaining highlights and ask questions' : 'Open the question break'}</button>}
          {!!requestedStop && <button type="button" className={button} onClick={() => { const target = itinerary.find(s => s.id === requestedStop); if (target) openStop(target); }}>Open requested panel: {itinerary.find(s => s.id === requestedStop)?.title}</button>}
          <div className="flex gap-2"><button type="button" className={button} disabled={index <= 0} onClick={() => openStop(itinerary[index - 1])}>Back</button><button type="button" className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-[var(--primary-foreground)] disabled:opacity-40" disabled={phase !== 'questions' || !currentIsOpen} onClick={next}>{completedCount >= itinerary.length ? 'Finish tour' : 'Continue'}<ArrowRight size={16} /></button></div>
          <label className="block text-xs text-foreground/50">Jump to a chapter<select aria-label="Tour chapter" className="mt-1 w-full rounded-xl border border-foreground/10 bg-background p-2 text-xs text-foreground/75" value={currentId} onChange={e => { const target = itinerary.find(s => s.id === e.target.value); if (target) openStop(target); }}>{itinerary.map(s => <option key={s.id} value={s.id}>{completed.includes(s.id) ? '✓ ' : ''}{s.section} · {s.title}</option>)}</select></label>
        </>}
      </div>}
    </aside>}
  </>;
}
