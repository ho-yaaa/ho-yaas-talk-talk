import type { Lang, VoiceGender } from '../types';
import type { TextToSpeechProvider } from './interfaces';

function toSpeechLang(lang: Lang): string {
  return lang === 'ja' ? 'ja-JP' : lang === 'ko' ? 'ko-KR' : lang;
}

function genderVoiceScore(voice: SpeechSynthesisVoice, gender: VoiceGender) {
  if (gender === 'neutral') return 0;
  const name = `${voice.name} ${voice.voiceURI}`.toLowerCase();
  const femaleHints = ['female', 'woman', 'girl', 'feminine', 'kyoko', 'yuna', 'samantha', 'karen'];
  const maleHints = ['male', 'man', 'boy', 'masculine', 'otoya', 'tarik', 'daniel', 'alex'];
  const hints = gender === 'female' ? femaleHints : maleHints;
  return hints.some((hint) => name.includes(hint)) ? 2 : 0;
}

function voicePitchFor(gender: VoiceGender) {
  if (gender === 'male') return 0.82;
  if (gender === 'female') return 1.18;
  return 1;
}

export class BrowserSpeechSynthesisProvider implements TextToSpeechProvider {
  name = 'browser-speech-synthesis';
  private lastSpoken = '';

  isSupported(): boolean {
    return 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
  }

  getVoices(): SpeechSynthesisVoice[] {
    return this.isSupported() ? window.speechSynthesis.getVoices() : [];
  }

  stop(): void {
    if (this.isSupported()) window.speechSynthesis.cancel();
  }

  async speak(text: string, lang: Lang, options?: { signal?: AbortSignal; voiceGender?: VoiceGender }): Promise<void> {
    if (!this.isSupported() || !text.trim()) return;
    const key = `${lang}:${text.trim()}`;
    if (key === this.lastSpoken) return;
    this.lastSpoken = key;
    window.speechSynthesis.cancel();

    await new Promise<void>((resolve, reject) => {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = toSpeechLang(lang);
      const voices = this.getVoices();
      const matchingVoices = voices.filter(
        (voice) => voice.lang.toLowerCase().startsWith(lang) || voice.lang === toSpeechLang(lang),
      );
      const voiceGender = options?.voiceGender ?? 'neutral';
      utterance.voice =
        matchingVoices.sort((a, b) => genderVoiceScore(b, voiceGender) - genderVoiceScore(a, voiceGender))[0] ??
        null;
      utterance.pitch = voicePitchFor(voiceGender);
      utterance.rate = voiceGender === 'male' ? 0.98 : 1.05;
      utterance.onend = () => resolve();
      utterance.onerror = (event) => reject(event);
      options?.signal?.addEventListener(
        'abort',
        () => {
          window.speechSynthesis.cancel();
          reject(new DOMException('Speech aborted', 'AbortError'));
        },
        { once: true },
      );
      window.speechSynthesis.speak(utterance);
    });
  }
}
