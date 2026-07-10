import type { AppError, GlossaryTerm, Lang } from '../types';

export interface SpeechChunk {
  text: string;
  isFinal: boolean;
  lang?: Lang;
  raw?: unknown;
}

export interface SpeechToTextProvider {
  name: string;
  isSupported(): boolean;
  start(options: {
    lang: Lang;
    interimResults: boolean;
    onResult: (chunk: SpeechChunk) => void;
    onError: (error: AppError) => void;
    onEnd: () => void;
  }): Promise<void>;
  stop(): void;
}

export interface TranslationRequest {
  text: string;
  sourceLang: Lang;
  targetLang: Lang;
  briefing: string;
  glossary: GlossaryTerm[];
  recentContext: string[];
  isFinal: boolean;
  signal?: AbortSignal;
}

export interface TranslationProvider {
  name: string;
  translate(request: TranslationRequest): Promise<string>;
}

export interface TextToSpeechProvider {
  name: string;
  isSupported(): boolean;
  speak(text: string, lang: Lang, options?: { signal?: AbortSignal }): Promise<void>;
  stop(): void;
  getVoices(): SpeechSynthesisVoice[];
}

export interface MeetingSummaryProvider {
  name: string;
  summarize(entries: Array<{ sourceText: string; translatedText: string }>): Promise<string>;
}
