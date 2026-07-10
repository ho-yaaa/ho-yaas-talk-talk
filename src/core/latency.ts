import type { LatencyMarks, LatencySnapshot } from '../types';

export function calculateLatency(marks: LatencyMarks): LatencySnapshot {
  const sttMs =
    marks.micStart && marks.firstSourceCaption ? marks.firstSourceCaption - marks.micStart : undefined;
  const translationMs =
    marks.firstTranslationRequest && marks.firstTranslationResult
      ? marks.firstTranslationResult - marks.firstTranslationRequest
      : undefined;
  const ttsMs =
    marks.firstTranslationResult && marks.firstSpeechOutput
      ? marks.firstSpeechOutput - marks.firstTranslationResult
      : undefined;
  const terminal = marks.finalTranslation ?? marks.firstTranslationResult ?? marks.firstSpeechOutput;
  const totalMs = marks.micStart && terminal ? terminal - marks.micStart : undefined;
  return { ...marks, sttMs, translationMs, ttsMs, totalMs, delayed: (totalMs ?? 0) > 3000 };
}
