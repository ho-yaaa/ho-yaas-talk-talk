import type { Lang } from '../types';

const koPattern = /[가-힣]/;
const jaPattern = /[\u3040-\u30ff\u3400-\u9fff]/;

export function detectLanguage(text: string, fallback: Lang = 'ko'): Lang {
  const ko = (text.match(/[가-힣]/g) || []).length;
  const ja = (text.match(/[\u3040-\u30ff]/g) || []).length;
  if (ko === 0 && ja === 0) return fallback;
  return ko >= ja ? 'ko' : 'ja';
}

export function decideDirection(
  text: string,
  autoDetect: boolean,
  fixedLang: Lang,
): { sourceLang: Lang; targetLang: Lang } {
  const sourceLang = autoDetect ? detectLanguage(text, fixedLang) : fixedLang;
  return { sourceLang, targetLang: sourceLang === 'ko' ? 'ja' : 'ko' };
}

export function isSupportedPrimaryLanguage(text: string): boolean {
  return koPattern.test(text) || jaPattern.test(text);
}
