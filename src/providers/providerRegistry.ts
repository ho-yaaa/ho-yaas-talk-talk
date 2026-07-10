import { BrowserSpeechRecognitionProvider } from './browserSpeech';
import { MockTranslationProvider, PlaceholderPaidProvider } from './mockTranslation';
import { ServerTranslationProvider } from './serverTranslation';
import { BrowserSpeechSynthesisProvider } from './speechSynthesis';

export function createProviders() {
  const selected = import.meta.env.VITE_TRANSLATION_PROVIDER ?? 'mock';
  const translation =
    selected === 'mock'
      ? new MockTranslationProvider()
      : selected === 'gpt' || selected === 'openai' || selected === 'gemini'
        ? new ServerTranslationProvider()
      : new PlaceholderPaidProvider(String(selected));

  return {
    speech: new BrowserSpeechRecognitionProvider(),
    translation,
    tts: new BrowserSpeechSynthesisProvider(),
  };
}
