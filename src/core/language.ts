import type { Lang } from '../types';

const koPattern = /[가-힣]/;
const jaPattern = /[\u3040-\u30ff\u3400-\u9fff]/;
const kanaPattern = /[\u3040-\u30ff]/g;
const hangulPattern = /[가-힣]/g;
const cjkPattern = /[\u3400-\u9fff]/g;
const shortKoReplies = new Set(['네', '예', '응', '아', '음', '좋아요', '맞아요']);
const shortJaReplies = new Set(['はい', 'ええ', 'うん', 'そう', 'ですね', 'そうですね']);

export type LanguageAnalysis = {
  lang: Lang;
  confidence: number;
  reason: string;
  scores: { ko: number; ja: number };
};

function countMatches(text: string, pattern: RegExp) {
  return (text.match(pattern) || []).length;
}

function normalizeSpeech(text: string) {
  return text.trim().replace(/[。、,.!?！？\s]/g, '');
}

export function analyzeLanguage(
  text: string,
  options: {
    fallback?: Lang;
    previousLang?: Lang;
    glossaryHints?: Array<{ source: string; target: string }>;
  } = {},
): LanguageAnalysis {
  const fallback = options.fallback ?? 'ko';
  const normalized = normalizeSpeech(text);
  const hangul = countMatches(text, hangulPattern);
  const kana = countMatches(text, kanaPattern);
  const cjk = countMatches(text, cjkPattern);
  const totalLetters = Math.max(1, hangul + kana + cjk);
  let koScore = hangul * 3;
  let jaScore = kana * 4 + cjk * 0.7;

  if (shortKoReplies.has(normalized)) koScore += 5;
  if (shortJaReplies.has(normalized)) jaScore += 5;

  for (const term of options.glossaryHints ?? []) {
    if (term.source && text.includes(term.source)) koScore += hangul > 0 ? 2 : 0.5;
    if (term.target && text.includes(term.target)) jaScore += kana > 0 || cjk > 0 ? 2 : 0.5;
  }

  if (normalized.length <= 3 && options.previousLang) {
    if (options.previousLang === 'ko') koScore += 2.5;
    if (options.previousLang === 'ja') jaScore += 2.5;
  }

  if (hangul === 0 && kana === 0 && cjk > 0 && options.previousLang) {
    if (options.previousLang === 'ko') koScore += 1.5;
    if (options.previousLang === 'ja') jaScore += 1.5;
  }

  if (hangul === 0 && kana === 0 && cjk === 0) {
    return {
      lang: fallback,
      confidence: 0.2,
      reason: 'fallback-no-primary-script',
      scores: { ko: koScore, ja: jaScore },
    };
  }

  const lang = koScore >= jaScore ? 'ko' : 'ja';
  const winner = Math.max(koScore, jaScore);
  const loser = Math.min(koScore, jaScore);
  const confidence = Math.min(0.99, Math.max(0.35, (winner - loser + winner / totalLetters) / 8));

  return {
    lang,
    confidence,
    reason: `hangul:${hangul},kana:${kana},cjk:${cjk}`,
    scores: { ko: koScore, ja: jaScore },
  };
}

export function detectLanguage(text: string, fallback: Lang = 'ko', previousLang?: Lang): Lang {
  return analyzeLanguage(text, { fallback, previousLang }).lang;
}

export function decideDirection(
  text: string,
  autoDetect: boolean,
  fixedLang: Lang,
  options: { previousLang?: Lang; glossaryHints?: Array<{ source: string; target: string }> } = {},
): { sourceLang: Lang; targetLang: Lang; confidence: number; reason: string } {
  const analysis = autoDetect
    ? analyzeLanguage(text, { fallback: fixedLang, ...options })
    : { lang: fixedLang, confidence: 1, reason: 'manual-fixed' };
  const sourceLang = analysis.lang;
  return {
    sourceLang,
    targetLang: sourceLang === 'ko' ? 'ja' : 'ko',
    confidence: analysis.confidence,
    reason: analysis.reason,
  };
}

export function isSupportedPrimaryLanguage(text: string): boolean {
  return koPattern.test(text) || jaPattern.test(text);
}
