import type { Lang } from '../types';
import type { TextToSpeechProvider } from './interfaces';

function toSpeechLang(lang: Lang): string {
  return lang === 'ja' ? 'ja-JP' : lang === 'ko' ? 'ko-KR' : lang;
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

  async speak(text: string, lang: Lang, options?: { signal?: AbortSignal }): Promise<void> {
    if (!this.isSupported() || !text.trim()) return;
    const key = `${lang}:${text.trim()}`;
    if (key === this.lastSpoken) return;
    this.lastSpoken = key;
    window.speechSynthesis.cancel();

    await new Promise<void>((resolve, reject) => {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = toSpeechLang(lang);
      const voices = this.getVoices();
      utterance.voice =
        voices.find((voice) => voice.lang.toLowerCase().startsWith(lang)) ??
        voices.find((voice) => voice.lang === toSpeechLang(lang)) ??
        null;
      utterance.rate = 1.05;
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
