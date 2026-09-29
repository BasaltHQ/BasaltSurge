/** Request permission from the learner's click, before reserving a paid session. */
export async function prepareTourMicrophone(): Promise<void> {
  if (!window.isSecureContext) throw Object.assign(new Error(), { name: 'InsecureContextError' });
  const policy = (document as Document & { permissionsPolicy?: { allowsFeature(feature: string): boolean }; featurePolicy?: { allowsFeature(feature: string): boolean } });
  if ((policy.permissionsPolicy || policy.featurePolicy)?.allowsFeature('microphone') === false) {
    throw Object.assign(new Error(), { name: 'MicrophonePolicyError' });
  }
  if (!navigator.mediaDevices?.getUserMedia) throw Object.assign(new Error(), { name: 'AudioUnsupportedError' });
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
  // The SDK owns the actual call stream. Never leave a second microphone running.
  stream.getTracks().forEach(track => track.stop());
}

export function tourAudioError(error: unknown): string {
  const e = error as { name?: string; message?: string } | null;
  switch (e?.name) {
    case 'MicrophonePolicyError': return 'This page blocks microphone access. Reload the admin workspace after the microphone policy update. If embedded, open the workspace in its own browser tab.';
    case 'InsecureContextError': return 'Voice needs a secure connection. Open this workspace using HTTPS, then try again. Text chat is available now.';
    case 'AudioUnsupportedError': return 'This browser does not support microphone access. Try a current browser or use text chat.';
    case 'NotAllowedError': case 'PermissionDeniedError': return 'Microphone access was denied. Open the site controls beside your browser’s address bar, allow Microphone, then retry. If it is still blocked, check your device’s microphone privacy settings. You can also use text chat.';
    case 'NotFoundError': case 'DevicesNotFoundError': return 'No microphone was found. Connect a microphone or headset, then retry, or use text chat.';
    case 'NotReadableError': case 'TrackStartError': return 'Your microphone could not start. Check your device’s privacy settings or close another app using it, then retry.';
    case 'TimeoutError': case 'AbortError': return 'The guide could not connect in time. Check your connection and retry, or use text chat.';
  }
  if (/permission denied|notallowed/i.test(e?.message || String(error))) return tourAudioError({ name: 'NotAllowedError' });
  return 'The guide connection was interrupted. Retry, or use text chat. Your tour progress is saved.';
}

/** Only known, actionable server failures reach the UI; credentials never do. */
export function tourSessionError(status: number, code?: string): string {
  if (status === 401) return 'Sign in to connect your AI guide.';
  if (status === 403) return 'Your session could not be verified. Reload this workspace in its own tab and sign in again.';
  if (status === 429) return code === 'rate_limited' ? 'Too many connection attempts. Please wait before reconnecting; the written tour is still available.' : 'Your voice usage limit has been reached. Continue with the written tour.';
  if (code === 'tour_not_configured') return 'The voice guide is not configured on this deployment yet. The written tour is ready to use.';
  return 'The AI guide is temporarily unavailable. Retry, or continue with the written tour.';
}
