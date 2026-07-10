import { applyGlossary } from '../core/glossary';
import type { TranslationProvider, TranslationRequest } from './interfaces';

const koToJa = new Map([
  ['안녕하세요', 'こんにちは'],
  ['감사합니다', 'ありがとうございます'],
  ['오늘', '本日'],
  ['회의', 'ミーティング'],
  ['일정', '日程'],
  ['교육비', '受講料'],
  ['부산', '釜山'],
  ['논의', '相談'],
  ['좋습니다', 'いいですね'],
  ['확인', '確認'],
]);

const jaToKo = new Map([
  ['こんにちは', '안녕하세요'],
  ['ありがとうございます', '감사합니다'],
  ['本日', '오늘'],
  ['ミーティング', '회의'],
  ['日程', '일정'],
  ['受講料', '교육비'],
  ['釜山', '부산'],
  ['相談', '논의'],
  ['確認', '확인'],
]);

export class MockTranslationProvider implements TranslationProvider {
  name = 'mock-local';

  async translate(request: TranslationRequest): Promise<string> {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(resolve, request.isFinal ? 160 : 90);
      request.signal?.addEventListener(
        'abort',
        () => {
          clearTimeout(timeout);
          reject(new DOMException('Translation aborted', 'AbortError'));
        },
        { once: true },
      );
    });

    const glossaryApplied = applyGlossary(request.text, request.glossary);
    const dictionary = request.sourceLang === 'ko' ? koToJa : jaToKo;
    let translated = glossaryApplied;
    dictionary.forEach((target, source) => {
      translated = translated.replaceAll(source, target);
    });

    if (translated === request.text) {
      translated =
        request.targetLang === 'ja'
          ? `【デモ翻訳】${glossaryApplied}`
          : `[데모 번역] ${glossaryApplied}`;
    }
    return request.isFinal ? translated : `${translated}`;
  }
}

export class PlaceholderPaidProvider implements TranslationProvider {
  constructor(public name: string) {}
  async translate(): Promise<string> {
    throw new Error(
      `${this.name} adapter is intentionally disabled. Check the latest official provider docs and connect only through a trusted backend after cost approval.`,
    );
  }
}
