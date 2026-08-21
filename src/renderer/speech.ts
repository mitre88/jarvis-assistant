/** Optional text-to-speech for Jarvis replies, via the Web Speech API. */

let enabled = false;

export function setTtsEnabled(on: boolean): void {
  enabled = on;
  if (!on) speechSynthesis.cancel();
}

function pickVoice(): SpeechSynthesisVoice | null {
  const voices = speechSynthesis.getVoices();
  return (
    voices.find((v) => v.lang === "en-GB") ??
    voices.find((v) => v.lang.startsWith("en")) ??
    null
  );
}

export function speak(text: string): void {
  if (!enabled || !text.trim()) return;
  speechSynthesis.cancel();
  // Strip code blocks; reading source aloud helps no one.
  const spoken = text.replace(/```[\s\S]*?```/g, " code omitted. ");
  const utterance = new SpeechSynthesisUtterance(spoken);
  utterance.lang = "en-GB";
  const voice = pickVoice();
  if (voice) utterance.voice = voice;
  utterance.rate = 1.05;
  speechSynthesis.speak(utterance);
}
