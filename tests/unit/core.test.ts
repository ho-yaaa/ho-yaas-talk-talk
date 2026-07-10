import { describe, expect, it, vi } from 'vitest';
import { debounceAsync } from '../../src/core/debounce';
import { TranslationDedupe } from '../../src/core/dedupe';
import { applyGlossary } from '../../src/core/glossary';
import { calculateLatency } from '../../src/core/latency';
import { decideDirection } from '../../src/core/language';
import { transitionSession } from '../../src/core/stateMachine';
import { mergeInterimTranscript, shouldTranslateInterim } from '../../src/core/transcript';

describe('interpreter core', () => {
  it('decides Korean to Japanese direction', () => {
    expect(decideDirection('안녕하세요', true, 'ja')).toEqual({ sourceLang: 'ko', targetLang: 'ja' });
  });

  it('decides Japanese to Korean direction', () => {
    expect(decideDirection('こんにちは', true, 'ko')).toEqual({ sourceLang: 'ja', targetLang: 'ko' });
  });

  it('merges interim transcript by preferring the longer continuous result', () => {
    expect(mergeInterimTranscript('오늘 회의', '오늘 회의 시작')).toBe('오늘 회의 시작');
  });

  it('prevents duplicate translation emission', () => {
    const dedupe = new TranslationDedupe();
    expect(dedupe.shouldEmit('a', 'b')).toBe(true);
    expect(dedupe.shouldEmit('a', 'b')).toBe(false);
  });

  it('debounces and aborts earlier requests', async () => {
    vi.useFakeTimers();
    const calls: string[] = [];
    const debounced = debounceAsync(async (_signal, value: string) => {
      calls.push(value);
      return value;
    }, 100);
    const first = debounced('first').catch((error) => error.name);
    const second = debounced('second');
    await vi.advanceTimersByTimeAsync(120);
    await expect(first).resolves.toBe('AbortError');
    await expect(second).resolves.toBe('second');
    expect(calls).toEqual(['second']);
    vi.useRealTimers();
  });

  it('supports request cancellation policy checks', () => {
    expect(shouldTranslateInterim('안', '')).toBe(false);
    expect(shouldTranslateInterim('안녕하세요', '')).toBe(true);
    expect(shouldTranslateInterim('안녕하세요', '안녕하세요')).toBe(false);
  });

  it('transitions session states without invalid jumps', () => {
    expect(transitionSession('idle', 'START')).toBe('listening');
    expect(transitionSession('listening', 'TRANSLATE')).toBe('translating');
    expect(transitionSession('paused', 'INTERIM')).toBe('paused');
  });

  it('calculates latency marks', () => {
    expect(
      calculateLatency({
        micStart: 10,
        firstSourceCaption: 30,
        firstTranslationRequest: 40,
        firstTranslationResult: 140,
        firstSpeechOutput: 180,
      }),
    ).toMatchObject({ sttMs: 20, translationMs: 100, ttsMs: 40, totalMs: 130, delayed: false });
  });

  it('applies glossary terms before provider translation', () => {
    expect(applyGlossary('오늘 커트 세미나', [{ id: '1', source: '커트', target: 'カット' }])).toBe(
      '오늘 カット 세미나',
    );
  });
});
