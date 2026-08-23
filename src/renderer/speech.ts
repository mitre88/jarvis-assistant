/** Text-to-speech for Jarvis replies, via the Web Speech API. */

let enabled = false;
let speaking = false;
let currentDone: (() => void) | null = null;

export function setTtsEnabled(on: boolean): void {
  enabled = on;
  if (!on) stopSpeaking();
}

export function isSpeaking(): boolean {
  return speaking;
}

/** Cancel any in-flight speech (barge-in / Esc). Its onDone still fires. */
export function stopSpeaking(): void {
  speechSynthesis.cancel();
  finish();
}

function finish(): void {
  speaking = false;
  const done = currentDone;
  currentDone = null;
  done?.();
}

function pickVoice(): SpeechSynthesisVoice | null {
  const voices = speechSynthesis.getVoices();
  return (
    voices.find((v) => v.lang === "en-GB") ??
    voices.find((v) => v.lang.startsWith("en")) ??
    null
  );
}

/**
 * Speak a reply. `onDone` fires exactly once — after playback, on error, on
 * cancel, or immediately when TTS is disabled or the text is empty.
 */
export function speak(text: string, onDone?: () => void): void {
  stopSpeaking();
  // Strip code blocks; reading source aloud helps no one.
  const spoken = text.replace(/```[\s\S]*?```/g, " code omitted. ").trim();
  if (!enabled || !spoken) {
    onDone?.();
    return;
  }
  speaking = true;
  currentDone = onDone ?? null;
  const utterance = new SpeechSynthesisUtterance(spoken);
  utterance.lang = "en-GB";
  const voice = pickVoice();
  if (voice) utterance.voice = voice;
  utterance.rate = 1.05;
  utterance.onend = finish;
  utterance.onerror = finish;
  speechSynthesis.speak(utterance);
}
