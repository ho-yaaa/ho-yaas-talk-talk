export type Lang = 'ko' | 'ja' | 'en' | 'zh';
export type Mode = 'earbud' | 'table' | 'auto' | 'event';
export type SessionStatus =
  | 'idle'
  | 'listening'
  | 'recognizing'
  | 'translating'
  | 'speaking'
  | 'paused'
  | 'mic-blocked'
  | 'error';

export interface GlossaryTerm {
  id: string;
  source: string;
  target: string;
  note?: string;
}

export interface GlossarySuggestion extends GlossaryTerm {
  occurrences: number;
  example?: string;
}

export interface TranscriptEntry {
  id: string;
  mode: Mode;
  sourceLang: Lang;
  targetLang: Lang;
  sourceText: string;
  translatedText: string;
  isFinal: boolean;
  createdAt: number;
  latency: LatencySnapshot;
}

export interface LatencyMarks {
  micStart?: number;
  firstSourceCaption?: number;
  firstTranslationRequest?: number;
  firstTranslationResult?: number;
  firstSpeechOutput?: number;
  finalTranslation?: number;
}

export interface LatencySnapshot extends LatencyMarks {
  sttMs?: number;
  translationMs?: number;
  ttsMs?: number;
  totalMs?: number;
  delayed: boolean;
}

export interface AppError {
  id: string;
  area: 'speech' | 'translation' | 'tts' | 'websocket' | 'storage' | 'app';
  code: string;
  message: string;
  raw?: unknown;
  timestamp: number;
}

export interface MeetingRecord {
  id: string;
  title: string;
  startedAt: number;
  endedAt?: number;
  mode: Mode;
  languages: Lang[];
  briefing: string;
  entries: TranscriptEntry[];
  errors: AppError[];
}
