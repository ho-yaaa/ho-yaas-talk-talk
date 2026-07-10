import type { TranslationProvider, TranslationRequest } from './interfaces';

export class ServerTranslationProvider implements TranslationProvider {
  name = 'gpt-server-proxy';

  constructor(
    private endpoint = import.meta.env.VITE_TRANSLATION_API_URL ??
      'http://127.0.0.1:8788/api/translate',
  ) {}

  async translate(request: TranslationRequest): Promise<string> {
    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        text: request.text,
        sourceLang: request.sourceLang,
        targetLang: request.targetLang,
        briefing: request.briefing,
        glossary: request.glossary,
        recentContext: request.recentContext,
        isFinal: request.isFinal,
      }),
      signal: request.signal,
    });

    const data = (await response.json()) as { translatedText?: string; error?: string };
    if (!response.ok) {
      throw new Error(data.error ?? 'GPT translation request failed');
    }
    return data.translatedText ?? '';
  }
}
