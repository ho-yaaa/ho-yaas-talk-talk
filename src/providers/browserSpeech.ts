import type { AppError, Lang } from '../types';
import type { SpeechToTextProvider } from './interfaces';

type BrowserRecognition = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((event: MinimalSpeechRecognitionEvent) => void) | null;
  onerror: ((event: MinimalSpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

type MinimalSpeechRecognitionResult = {
  readonly isFinal: boolean;
  readonly 0: { transcript: string };
};

type MinimalSpeechRecognitionEvent = Event & {
  readonly resultIndex: number;
  readonly results: {
    readonly length: number;
    readonly [index: number]: MinimalSpeechRecognitionResult;
  };
};

type MinimalSpeechRecognitionErrorEvent = Event & {
  readonly error: string;
  readonly message?: string;
};

declare global {
  interface Window {
    SpeechRecognition?: new () => BrowserRecognition;
    webkitSpeechRecognition?: new () => BrowserRecognition;
  }
}

function toRecognitionLang(lang: Lang): string {
  return lang === 'ja' ? 'ja-JP' : lang === 'ko' ? 'ko-KR' : lang;
}

function mapSpeechError(error: MinimalSpeechRecognitionErrorEvent): AppError {
  const code = error.error || 'unknown';
  const messages: Record<string, string> = {
    'not-allowed': '마이크 권한이 거절되었습니다. 브라우저 주소창의 권한 설정을 확인해 주세요.',
    'service-not-allowed': '이 브라우저의 음성인식 서비스가 현재 허용되지 않습니다.',
    'no-speech': '음성이 감지되지 않았습니다. 계속 듣기를 유지합니다.',
    'audio-capture': '마이크 장치를 찾을 수 없습니다.',
    network: '음성인식 네트워크 오류입니다. 텍스트 입력은 계속 사용할 수 있습니다.',
    aborted: '음성인식이 중단되었습니다.',
    'language-not-supported': '선택한 언어가 이 브라우저 음성인식에서 지원되지 않습니다.',
  };
  return {
    id: crypto.randomUUID(),
    area: 'speech',
    code,
    message: messages[code] ?? `음성인식 오류: ${code}`,
    raw: {
      error: error.error,
        message: error.message ?? '',
      type: error.type,
      timestamp: Date.now(),
      isTrusted: error.isTrusted,
    },
    timestamp: Date.now(),
  };
}

export class BrowserSpeechRecognitionProvider implements SpeechToTextProvider {
  name = 'browser-speech-recognition';
  private recognition?: BrowserRecognition;
  private running = false;

  isSupported(): boolean {
    return Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);
  }

  async start(options: Parameters<SpeechToTextProvider['start']>[0]): Promise<void> {
    if (this.running) return;
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) {
      options.onError({
        id: crypto.randomUUID(),
        area: 'speech',
        code: 'unsupported',
        message: '이 브라우저는 SpeechRecognition을 지원하지 않습니다. 텍스트 입력 모드를 사용하세요.',
        timestamp: Date.now(),
      });
      return;
    }

    const recognition = new Recognition();
    recognition.lang = toRecognitionLang(options.lang);
    recognition.interimResults = options.interimResults;
    recognition.continuous = true;
    recognition.onresult = (event: MinimalSpeechRecognitionEvent) => {
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        options.onResult({
          text: result[0]?.transcript ?? '',
          isFinal: result.isFinal,
          raw: result,
        });
      }
    };
    recognition.onerror = (event) => options.onError(mapSpeechError(event));
    recognition.onend = () => {
      this.running = false;
      options.onEnd();
    };
    this.recognition = recognition;
    try {
      recognition.start();
      this.running = true;
    } catch (error) {
      this.running = false;
      options.onError({
        id: crypto.randomUUID(),
        area: 'speech',
        code: 'start-failed',
        message: '음성인식 시작에 실패했습니다. 잠시 후 다시 시도해 주세요.',
        raw: error,
        timestamp: Date.now(),
      });
    }
  }

  stop(): void {
    if (!this.recognition || !this.running) return;
    this.running = false;
    this.recognition.stop();
  }
}
