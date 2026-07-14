import {
  ArrowLeft,
  BookOpen,
  CalendarDays,
  Check,
  Download,
  Ear,
  Eraser,
  Globe,
  Languages,
  Lightbulb,
  LogOut,
  Maximize2,
  Minimize2,
  Moon,
  Pause,
  Play,
  QrCode,
  RotateCcw,
  Save,
  Send,
  Sparkles,
  Square,
  SwitchCamera,
  Tablet,
  Trash2,
  User,
  Users,
  Volume2,
  VolumeX,
} from 'lucide-react';
import QRCode from 'qrcode';
import { type CSSProperties, useEffect, useMemo, useRef, useState } from 'react';
import { BRIEFING_PRESETS, DEFAULT_GLOSSARY, LANG_LABELS, MODES } from './constants';
import { calculateLatency } from './core/latency';
import { decideDirection } from './core/language';
import { shouldTranslateInterim } from './core/transcript';
import { createProviders } from './providers/providerRegistry';
import { RealtimeClient, type EventMessage, type RealtimeRole } from './realtime/client';
import { clearMeetings, getGlossary, listMeetings, saveGlossary, saveMeeting } from './storage/meetings';
import type {
  AppError,
  GlossarySuggestion,
  GlossaryTerm,
  Lang,
  LatencyMarks,
  MeetingRecord,
  Mode,
  SessionStatus,
  TranscriptEntry,
  VoiceGender,
} from './types';

type GoogleCredentialResponse = {
  credential?: string;
  select_by?: string;
};

type GoogleAccounts = {
  id: {
    initialize: (config: { client_id: string; callback: (response: GoogleCredentialResponse) => void }) => void;
    renderButton: (
      parent: HTMLElement,
      options: {
        theme?: 'outline' | 'filled_blue' | 'filled_black';
        size?: 'large' | 'medium' | 'small';
        text?: 'signin_with' | 'signup_with' | 'continue_with' | 'signin';
        shape?: 'rectangular' | 'pill' | 'circle' | 'square';
        width?: number;
        locale?: string;
      },
    ) => void;
    cancel: () => void;
  };
};

declare global {
  interface Window {
    google?: { accounts: GoogleAccounts };
    webkitAudioContext?: typeof AudioContext;
  }
}

const statusLabel: Record<SessionStatus, string> = {
  idle: '대기 중',
  listening: '듣는 중',
  recognizing: '인식 중',
  translating: '번역 중',
  speaking: '출력 중',
  paused: '일시정지',
  'mic-blocked': '마이크 권한 필요',
  error: '오류',
};

const providers = createProviders();
const translationApiEndpoint = import.meta.env.VITE_TRANSLATION_API_URL ?? 'http://127.0.0.1:8788/api/translate';
const realtimeEndpoint = toRealtimeEndpoint(import.meta.env.VITE_REALTIME_WS_URL ?? translationApiEndpoint);
const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID ?? '';
const emptyGlossaryDraft = { source: '', target: '', note: '' };
const maxPersonalRoomParticipants = 4;
const boardFontSizes = {
  1: 'clamp(1.35rem, 2.2vw, 2.6rem)',
  2: 'clamp(1.55rem, 2.7vw, 3.2rem)',
  3: 'clamp(1.75rem, 3.5vw, 4rem)',
  4: 'clamp(2rem, 4.1vw, 4.8rem)',
  5: 'clamp(2.25rem, 4.8vw, 5.6rem)',
} as const;
const beautySuggestionSeeds: Array<Omit<GlossarySuggestion, 'id' | 'occurrences'>> = [
  { source: '레이어드 컷', target: 'レイヤーカット', note: '미용 시술 용어' },
  { source: '두피 보호제', target: '頭皮保護剤', note: '미용 시술 용어' },
  { source: '애쉬 브라운', target: 'アッシュブラウン', note: '헤어 컬러 용어' },
  { source: '소프트 애쉬', target: 'ソフトアッシュ', note: '헤어 컬러 용어' },
  { source: '다운펌', target: 'ダウンパーマ', note: '미용 시술 용어' },
  { source: '뿌리 염색', target: 'リタッチカラー', note: '미용 시술 용어' },
  { source: '클리닉', target: 'ヘアトリートメント', note: '미용 시술 용어' },
  { source: '손상모', target: 'ダメージヘア', note: '미용 상담 용어' },
];

function now() {
  return performance.now();
}

function toRealtimeEndpoint(endpoint: string) {
  try {
    const url = new URL(endpoint, window.location.origin);
    if (url.protocol === 'ws:' || url.protocol === 'wss:') {
      return url.toString().replace(/\/$/, '');
    }
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.pathname = '';
    url.search = '';
    url.hash = '';
    return url.toString().replace(/\/$/, '');
  } catch {
    return 'ws://127.0.0.1:8788';
  }
}

function makeLocalSessionCode() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

function getPersonalSessionFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const session = params.get('session')?.trim().toUpperCase() ?? '';
  return params.get('room') === 'personal' && session ? session : '';
}

function estimatePitch(buffer: Float32Array, sampleRate: number) {
  const minLag = Math.floor(sampleRate / 320);
  const maxLag = Math.floor(sampleRate / 80);
  let bestLag = -1;
  let bestCorrelation = 0;
  for (let lag = minLag; lag <= maxLag; lag += 1) {
    let correlation = 0;
    for (let i = 0; i < buffer.length - lag; i += 1) {
      correlation += buffer[i] * buffer[i + lag];
    }
    if (correlation > bestCorrelation) {
      bestCorrelation = correlation;
      bestLag = lag;
    }
  }
  return bestLag > 0 ? sampleRate / bestLag : 0;
}

async function sampleSpeakerVoiceGender(): Promise<VoiceGender> {
  if (!navigator.mediaDevices?.getUserMedia) return 'neutral';
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  const audioContext = new AudioContextClass();
  const source = audioContext.createMediaStreamSource(stream);
  const analyser = audioContext.createAnalyser();
  analyser.fftSize = 2048;
  source.connect(analyser);
  const buffer = new Float32Array(analyser.fftSize);
  const pitches: number[] = [];
  const startedAt = performance.now();

  while (performance.now() - startedAt < 850) {
    analyser.getFloatTimeDomainData(buffer);
    const rms = Math.sqrt(buffer.reduce((sum, value) => sum + value * value, 0) / buffer.length);
    const pitch = rms > 0.012 ? estimatePitch(buffer, audioContext.sampleRate) : 0;
    if (pitch >= 80 && pitch <= 320) pitches.push(pitch);
    await new Promise((resolve) => window.setTimeout(resolve, 90));
  }

  stream.getTracks().forEach((track) => track.stop());
  await audioContext.close().catch(() => undefined);
  if (pitches.length < 2) return 'neutral';
  const averagePitch = pitches.reduce((sum, pitch) => sum + pitch, 0) / pitches.length;
  if (averagePitch < 165) return 'male';
  if (averagePitch > 185) return 'female';
  return 'neutral';
}

function loadGoogleIdentityScript() {
  return new Promise<void>((resolve, reject) => {
    if (window.google?.accounts?.id) {
      resolve();
      return;
    }
    const existing = document.querySelector<HTMLScriptElement>('script[src="https://accounts.google.com/gsi/client"]');
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error('Google Identity Services script failed to load')), { once: true });
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Google Identity Services script failed to load'));
    document.head.appendChild(script);
  });
}

function serializeError(raw: unknown) {
  if (raw instanceof Error) {
    return {
      name: raw.name,
      message: raw.message,
      stack: raw.stack,
    };
  }
  return raw;
}

function makeError(area: AppError['area'], code: string, message: string, raw?: unknown): AppError {
  return { id: crypto.randomUUID(), area, code, message, raw: serializeError(raw), timestamp: Date.now() };
}

function voiceGenderLabel(gender: VoiceGender) {
  if (gender === 'male') return '남성 톤';
  if (gender === 'female') return '여성 톤';
  return '기본 톤';
}

export default function App() {
  const [mode, setMode] = useState<Mode>('earbud');
  const [view, setView] = useState<'auth' | 'setup' | 'live' | 'glossary'>('auth');
  const [authMode, setAuthMode] = useState<'guest' | 'google' | null>(null);
  const [authError, setAuthError] = useState('');
  const [googleButtonReady, setGoogleButtonReady] = useState(false);
  const [meetingTitle, setMeetingTitle] = useState('Abridge 실시간 통역 세션');
  const [status, setStatus] = useState<SessionStatus>('idle');
  const [theme] = useState<'dark' | 'light'>('dark');
  const [autoDetect, setAutoDetect] = useState(true);
  const [fixedLang, setFixedLang] = useState<Lang>('ko');
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [speakerVoiceGender, setSpeakerVoiceGender] = useState<VoiceGender>('neutral');
  const [briefing, setBriefing] = useState(BRIEFING_PRESETS[0]);
  const [manualText, setManualText] = useState('');
  const [sourceCaption, setSourceCaption] = useState('');
  const [translationCaption, setTranslationCaption] = useState('');
  const [entries, setEntries] = useState<TranscriptEntry[]>([]);
  const [errors, setErrors] = useState<AppError[]>([]);
  const [glossary, setGlossary] = useState<GlossaryTerm[]>(DEFAULT_GLOSSARY);
  const [glossarySuggestions, setGlossarySuggestions] = useState<GlossarySuggestion[]>([]);
  const [selectedGlossaryId, setSelectedGlossaryId] = useState('');
  const [glossaryDraft, setGlossaryDraft] = useState(emptyGlossaryDraft);
  const [meetings, setMeetings] = useState<MeetingRecord[]>([]);
  const [marks, setMarks] = useState<LatencyMarks>({});
  const [isFinalCaption, setIsFinalCaption] = useState(false);
  const [wsStatus, setWsStatus] = useState<'disconnected' | 'connecting' | 'connected'>('disconnected');
  const [sessionCode, setSessionCode] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [qr, setQr] = useState('');
  const [roomRole, setRoomRole] = useState<RealtimeRole | null>(null);
  const [roomMode, setRoomMode] = useState<'event' | 'personal' | null>(null);
  const [participantCount, setParticipantCount] = useState(0);
  const [roomNotice, setRoomNotice] = useState('');
  const [flipped, setFlipped] = useState(false);
  const [wakeLockState, setWakeLockState] = useState('미사용');
  const [online, setOnline] = useState(navigator.onLine);
  const [boardMode, setBoardMode] = useState(false);
  const [boardSwapped, setBoardSwapped] = useState(false);
  const [boardFontScale, setBoardFontScale] = useState<keyof typeof boardFontSizes>(3);
  const [exitDialogOpen, setExitDialogOpen] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const realtime = useRef<RealtimeClient | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const lastTranslationRequest = useRef('');
  const lastConfirmedLang = useRef<Lang>('ko');
  const activeSpeechLang = useRef<Lang>('ko');
  const speechRestartTimer = useRef<number | undefined>(undefined);
  const googleButtonRef = useRef<HTMLDivElement | null>(null);
  const googleCredentialHandler = useRef<(response: GoogleCredentialResponse) => void>(() => undefined);
  const speakerVoiceGenderRef = useRef<VoiceGender>('neutral');
  const voiceSamplingRef = useRef(false);
  const meetingStart = useRef(Date.now());
  const userStopped = useRef(false);

  const latency = useMemo(() => calculateLatency(marks), [marks]);
  const speechSupported = providers.speech.isSupported();
  const ttsSupported = providers.tts.isSupported();
  const browserInfo = `${navigator.userAgent}`;
  const selectedProvider = import.meta.env.VITE_TRANSLATION_PROVIDER ?? 'mock';
  const micPermissionError = errors.find((error) => error.area === 'speech' && error.code === 'not-allowed');
  const rememberedContext = useMemo(
    () =>
      meetings
        .slice(0, 3)
        .flatMap((meeting) => meeting.entries.slice(-6))
        .flatMap((entry) => [entry.sourceText, entry.translatedText])
        .filter(Boolean)
        .slice(-18),
    [meetings],
  );
  const liveDirection = decideDirection(sourceCaption || manualText, autoDetect, fixedLang, {
    previousLang: lastConfirmedLang.current,
    glossaryHints: glossary,
  });
  const koreanBoardText =
    liveDirection.sourceLang === 'ko'
      ? sourceCaption || '한국어 음성을 대기하고 있습니다. 말씀을 시작하면 즉시 통역 자막이 번역됩니다.'
      : translationCaption || '한국어 번역 자막을 대기하고 있습니다. 일본어 발화가 들어오면 이곳에 표시됩니다.';
  const japaneseBoardText =
    liveDirection.sourceLang === 'ja'
      ? sourceCaption || '日本語の音声を待機しています。お話しいただくと、すぐに翻訳字幕が表示されます。'
      : translationCaption || '日本語の翻訳字幕を待機しています。韓国語の発話が入ると、ここに表示されます。';
  const boardCaptions = boardSwapped
    ? [
        { lang: 'ja', className: 'target-board', pillClass: 'ja-pill', label: '🇯🇵 日本語 / JAPANESE', text: japaneseBoardText },
        { lang: 'ko', className: 'source-board', pillClass: 'ko-pill', label: '🇰🇷 한국어 / KOREAN', text: koreanBoardText },
      ]
    : [
        { lang: 'ko', className: 'source-board', pillClass: 'ko-pill', label: '🇰🇷 한국어 / KOREAN', text: koreanBoardText },
        { lang: 'ja', className: 'target-board', pillClass: 'ja-pill', label: '🇯🇵 日本語 / JAPANESE', text: japaneseBoardText },
      ];
  const seminarEntries = entries.filter((entry) => entry.mode === 'auto').slice(-20);

  useEffect(() => {
    getGlossary().then(setGlossary).catch(() => setGlossary(DEFAULT_GLOSSARY));
    listMeetings().then(setMeetings).catch(() => undefined);
    const urlSessionCode = getPersonalSessionFromUrl();
    if (urlSessionCode) {
      setMode('earbud');
      setJoinCode(urlSessionCode);
      setFixedLang('ja');
      setAutoDetect(false);
      setRoomMode('personal');
      setRoomNotice('개인 통역방 초대 링크가 감지되었습니다. 게스트 모드로 시작하면 바로 입장할 수 있습니다.');
    }
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    if (mode !== 'auto') return;
    setAutoDetect(false);
    activeSpeechLang.current = fixedLang;
  }, [fixedLang, mode]);

  useEffect(() => {
    saveGlossary(glossary).catch((error) =>
      setErrors((prev) => [makeError('storage', 'glossary-save', '용어 사전 저장 실패', error), ...prev]),
    );
  }, [glossary]);

  useEffect(() => {
    if (view !== 'live') return undefined;
    const timer = window.setInterval(() => {
      setElapsedSeconds(Math.max(0, Math.floor((Date.now() - meetingStart.current) / 1000)));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [view]);

  useEffect(
    () => () => {
      if (speechRestartTimer.current) window.clearTimeout(speechRestartTimer.current);
    },
    [],
  );

  googleCredentialHandler.current = (response) => {
    void finishGoogleSignIn(response);
  };

  useEffect(() => {
    if (view !== 'auth' || !googleButtonRef.current) return undefined;
    if (!googleClientId) {
      setGoogleButtonReady(false);
      setAuthError('Google Client ID가 설정되지 않았습니다. .env에 VITE_GOOGLE_CLIENT_ID를 추가해주세요.');
      return undefined;
    }

    let active = true;
    setGoogleButtonReady(false);
    loadGoogleIdentityScript()
      .then(() => {
        if (!active || !googleButtonRef.current || !window.google?.accounts?.id) return;
        window.google.accounts.id.initialize({
          client_id: googleClientId,
          callback: (response) => {
            googleCredentialHandler.current(response);
          },
        });
        googleButtonRef.current.innerHTML = '';
        window.google.accounts.id.renderButton(googleButtonRef.current, {
          theme: 'outline',
          size: 'large',
          text: 'continue_with',
          shape: 'rectangular',
          width: 390,
          locale: 'ko',
        });
        setGoogleButtonReady(true);
      })
      .catch((error) => {
        if (!active) return;
        setGoogleButtonReady(false);
        setAuthError('Google 로그인 모듈을 불러오지 못했습니다. 네트워크 상태를 확인한 뒤 새로고침해주세요.');
        setErrors((prev) => [makeError('app', 'google-script-load', 'Google 로그인 모듈 로딩 실패', error), ...prev]);
      });

    return () => {
      active = false;
    };
  }, [view]);

  function oppositeLang(lang: Lang): Lang {
    return lang === 'ja' ? 'ko' : 'ja';
  }

  function setListeningLanguage(lang: Lang, lock = true) {
    setFixedLang(lang);
    activeSpeechLang.current = lang;
    if (lock) setAutoDetect(false);
    if (view === 'live' && status !== 'idle' && status !== 'paused' && status !== 'mic-blocked') {
      providers.speech.stop();
      speechRestartTimer.current = window.setTimeout(() => startListening(lang), 220);
    }
  }

  function useAutoLanguageDetection() {
    setAutoDetect(true);
    if (view === 'live' && status !== 'idle' && status !== 'paused' && status !== 'mic-blocked') {
      providers.speech.stop();
      speechRestartTimer.current = window.setTimeout(() => startListening(lastConfirmedLang.current), 220);
    }
  }

  function queueSuggestedTerms(sourceText: string) {
    for (const seed of beautySuggestionSeeds) {
      if (!sourceText.includes(seed.source)) continue;
      if (glossary.some((term) => term.source === seed.source)) continue;
      setGlossarySuggestions((prev) => {
        const existing = prev.find((term) => term.source === seed.source);
        if (existing) {
          return prev.map((term) =>
            term.source === seed.source
              ? { ...term, occurrences: term.occurrences + 1, example: sourceText }
              : term,
          );
        }
        return [
          ...prev,
          {
            id: crypto.randomUUID(),
            ...seed,
            occurrences: 1,
            example: sourceText,
          },
        ];
      });
    }
  }

  async function translateText(text: string, isFinal: boolean) {
    if (!shouldTranslateInterim(text, lastTranslationRequest.current) && !isFinal) return;
    lastTranslationRequest.current = text;
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    const direction = decideDirection(text, autoDetect, fixedLang, {
      previousLang: lastConfirmedLang.current,
      glossaryHints: glossary,
    });
    const requestMark = now();
    setMarks((prev) => ({ ...prev, firstTranslationRequest: prev.firstTranslationRequest ?? requestMark }));
    setStatus('translating');
    try {
      const translatedText = await providers.translation.translate({
        text,
        ...direction,
        briefing,
        glossary,
        recentContext: [
          ...rememberedContext,
          ...entries.slice(-4).flatMap((entry) => [entry.sourceText, entry.translatedText]),
        ].slice(-20),
        isFinal,
        signal: abortRef.current.signal,
      });
      const resultMark = now();
      setMarks((prev) => ({
        ...prev,
        firstTranslationResult: prev.firstTranslationResult ?? resultMark,
        finalTranslation: isFinal ? resultMark : prev.finalTranslation,
      }));
      setTranslationCaption(translatedText);
      setIsFinalCaption(isFinal);

      const entry: TranscriptEntry = {
        id: crypto.randomUUID(),
        mode,
        sourceLang: direction.sourceLang,
        targetLang: direction.targetLang,
        sourceText: text,
        translatedText,
        isFinal,
        createdAt: Date.now(),
        latency: calculateLatency({
          ...marks,
          firstTranslationRequest: marks.firstTranslationRequest ?? requestMark,
          firstTranslationResult: marks.firstTranslationResult ?? resultMark,
          finalTranslation: isFinal ? resultMark : marks.finalTranslation,
        }),
      };
      setEntries((prev) => [...prev.filter((old) => old.isFinal || isFinal), entry].slice(-80));
      if (isFinal) {
        lastConfirmedLang.current = direction.sourceLang;
        queueSuggestedTerms(text);
      }
      broadcastCaption(entry);

      const shouldSpeakLocally =
        voiceEnabled && translatedText.trim() && !(mode === 'earbud' && roomMode === 'personal' && roomRole);
      if (shouldSpeakLocally) {
        setStatus('speaking');
        setMarks((prev) => ({ ...prev, firstSpeechOutput: prev.firstSpeechOutput ?? now() }));
        providers.tts
          .speak(translatedText, direction.targetLang, {
            voiceGender: mode === 'earbud' ? speakerVoiceGenderRef.current : 'neutral',
          })
          .catch((error) => {
            setErrors((prev) => [makeError('tts', 'speak-failed', '음성 출력 실패', error), ...prev]);
          });
      } else {
        setStatus('listening');
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      setStatus('error');
      setErrors((prev) => [makeError('translation', 'translate-failed', '번역 처리 실패', error), ...prev]);
    }
  }

  function handleSpeechText(text: string, isFinal: boolean) {
    const trimmed = text.trim();
    if (!trimmed) return;
    const speechDirection = decideDirection(trimmed, autoDetect, fixedLang, {
      previousLang: lastConfirmedLang.current,
      glossaryHints: glossary,
    });
    const firstCaption = marks.firstSourceCaption ?? now();
    setMarks((prev) => ({ ...prev, firstSourceCaption: prev.firstSourceCaption ?? firstCaption }));
    setSourceCaption(trimmed);
    setStatus(isFinal ? 'translating' : 'recognizing');
    if (isFinal && speechDirection.confidence >= 0.45) {
      lastConfirmedLang.current = speechDirection.sourceLang;
    }
    window.setTimeout(() => translateText(trimmed, isFinal), isFinal ? 0 : 420);
  }

  function submitManualTranslation() {
    const trimmed = manualText.trim();
    if (!trimmed) return;
    const firstCaption = now();
    setMarks({ micStart: firstCaption, firstSourceCaption: firstCaption });
    setSourceCaption(trimmed);
    setTranslationCaption('');
    setIsFinalCaption(false);
    void translateText(trimmed, true);
  }

  async function startListening(langOverride?: Lang) {
    userStopped.current = false;
    setMarks({ micStart: now() });
    setStatus('listening');
    if (mode === 'earbud' && !voiceSamplingRef.current) {
      voiceSamplingRef.current = true;
      sampleSpeakerVoiceGender()
        .then((gender) => {
          speakerVoiceGenderRef.current = gender;
          setSpeakerVoiceGender(gender);
        })
        .catch(() => {
          speakerVoiceGenderRef.current = 'neutral';
          setSpeakerVoiceGender('neutral');
        })
        .finally(() => {
          voiceSamplingRef.current = false;
        });
    }
    const listeningLang = langOverride ?? (autoDetect ? activeSpeechLang.current : fixedLang);
    activeSpeechLang.current = listeningLang;
    if (!speechSupported) {
      setErrors((prev) => [
        makeError('speech', 'unsupported', '이 브라우저는 음성인식을 지원하지 않습니다. 텍스트 입력으로 데모를 확인하세요.'),
        ...prev,
      ]);
      return;
    }
    await providers.speech.start({
      lang: listeningLang,
      interimResults: true,
      onResult: (chunk) => handleSpeechText(chunk.text, chunk.isFinal),
      onError: (error) => {
        setErrors((prev) => [error, ...prev]);
        if (autoDetect && (mode === 'earbud' || mode === 'table' || mode === 'auto') && error.code === 'no-speech') {
          activeSpeechLang.current = oppositeLang(activeSpeechLang.current);
        }
        setStatus(error.code === 'not-allowed' ? 'mic-blocked' : error.code === 'no-speech' ? 'listening' : 'error');
      },
      onEnd: () => {
        if (!userStopped.current && (mode === 'auto' || autoDetect)) {
          speechRestartTimer.current = window.setTimeout(
            () => startListening(activeSpeechLang.current),
            autoDetect ? 420 : 800,
          );
        } else {
          setStatus((prev) => (prev === 'paused' || prev === 'mic-blocked' || prev === 'error' ? prev : 'idle'));
        }
      },
    });
  }

  function startMeetingSession() {
    resetLiveSession();
    meetingStart.current = Date.now();
    setElapsedSeconds(0);
    setView('live');
    void startListening();
  }

  function stopListening() {
    userStopped.current = true;
    providers.speech.stop();
    providers.tts.stop();
    abortRef.current?.abort();
    setStatus('idle');
  }

  async function requestLoginMicrophoneAccess() {
    if (!navigator.mediaDevices?.getUserMedia) {
      setAuthError('이 브라우저에서는 마이크 권한 요청을 사용할 수 없습니다. Chrome에서 다시 시도해주세요.');
      return false;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
      setAuthError('');
      return true;
    } catch (error) {
      setAuthError('마이크 권한을 허용해야 Google 계정으로 시작할 수 있습니다. 브라우저 권한에서 마이크를 허용한 뒤 다시 시도해주세요.');
      setErrors((prev) => [makeError('speech', 'login-mic-denied', '로그인 전 마이크 권한 요청이 거부되었습니다.', error), ...prev]);
      return false;
    }
  }

  async function finishGoogleSignIn(response: GoogleCredentialResponse) {
    if (!response.credential) {
      setAuthError('Google 로그인 응답을 확인하지 못했습니다. 다시 시도해주세요.');
      return;
    }
    const allowed = await requestLoginMicrophoneAccess();
    if (!allowed) return;
    setAuthMode('google');
    if (joinPersonalRoomFromInvite()) return;
    setView('setup');
  }

  function startWithGoogle() {
    setAuthError(googleButtonReady ? 'Google 버튼을 눌러 계정을 선택해주세요.' : 'Google 로그인 모듈을 준비하는 중입니다. 잠시 후 다시 시도해주세요.');
  }

  function startAsGuest() {
    setAuthMode('guest');
    setAuthError('');
    if (joinPersonalRoomFromInvite()) return;
    setView('setup');
  }

  function exitToAuth() {
    stopListening();
    realtime.current?.close();
    realtime.current = null;
    setWsStatus('disconnected');
    setSessionCode('');
    setQr('');
    setRoomRole(null);
    setRoomMode(null);
    setParticipantCount(0);
    setRoomNotice('');
    setBoardMode(false);
    setView('auth');
    setAuthMode(null);
  }

  function exitLivePage() {
    stopListening();
    realtime.current?.close();
    realtime.current = null;
    setWsStatus('disconnected');
    setRoomRole(null);
    setRoomMode(null);
    setParticipantCount(0);
    setBoardMode(false);
    setView('setup');
  }

  function resetLiveSession() {
    setSourceCaption('');
    setTranslationCaption('');
    setManualText('');
    setEntries([]);
    setMarks({});
    setIsFinalCaption(false);
    setLastTranslationRequest('');
  }

  function setLastTranslationRequest(value: string) {
    lastTranslationRequest.current = value;
  }

  function requestExitLivePage() {
    stopListening();
    setExitDialogOpen(true);
  }

  function discardAndExitLivePage() {
    resetLiveSession();
    setExitDialogOpen(false);
    exitLivePage();
  }

  function saveTranscriptTxtAndExit() {
    exportText('txt');
    resetLiveSession();
    setExitDialogOpen(false);
    exitLivePage();
  }

  function renderExitDialog() {
    if (!exitDialogOpen) return null;
    const finalEntries = entries.filter((entry) => entry.isFinal);
    return (
      <div className="exit-dialog-backdrop" role="alertdialog" aria-modal="true" aria-labelledby="exit-dialog-title">
        <section className="exit-dialog">
          <div>
            <span className="exit-dialog-kicker">통역 세션 종료</span>
            <h2 id="exit-dialog-title">현재 번역 기록을 어떻게 할까요?</h2>
            <p>
              저장하지 않고 소멸하면 현재 화면의 원문, 번역문, 대화 로그가 모두 비워집니다.
              저장하면 TXT 파일로 내려받은 뒤 세션을 종료합니다.
            </p>
            <small>저장 대상 문장: {finalEntries.length}개</small>
          </div>
          <div className="exit-dialog-actions">
            <button className="discard-button" onClick={discardAndExitLivePage}>
              <Trash2 /> 소멸
            </button>
            <button className="save-txt-button" onClick={saveTranscriptTxtAndExit}>
              <Download /> 저장
            </button>
          </div>
        </section>
      </div>
    );
  }

  function enterBoardMode() {
    setBoardMode(true);
    document.documentElement.requestFullscreen?.().catch(() => undefined);
  }

  function exitBoardMode() {
    setBoardMode(false);
    if (document.fullscreenElement) {
      document.exitFullscreen?.().catch(() => undefined);
    }
  }

  function formatElapsed(seconds: number) {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`;
  }

  async function saveCurrentMeeting() {
    const record: MeetingRecord = {
      id: crypto.randomUUID(),
      title: meetingTitle,
      startedAt: meetingStart.current,
      endedAt: Date.now(),
      mode,
      languages: ['ko', 'ja'],
      briefing,
      entries: entries.filter((entry) => entry.isFinal),
      errors,
    };
    await saveMeeting(record);
    setMeetings(await listMeetings());
  }

  function selectGlossaryTerm(term: GlossaryTerm) {
    setSelectedGlossaryId(term.id);
    setGlossaryDraft({
      source: term.source,
      target: term.target,
      note: term.note ?? '',
    });
  }

  function resetGlossaryDraft() {
    setSelectedGlossaryId('');
    setGlossaryDraft(emptyGlossaryDraft);
  }

  function saveGlossaryDraft() {
    const source = glossaryDraft.source.trim();
    const target = glossaryDraft.target.trim();
    const note = glossaryDraft.note.trim();
    if (!source || !target) {
      setErrors((prev) => [
        makeError('app', 'glossary-required', '원어와 번역어를 모두 입력해야 합니다.'),
        ...prev,
      ]);
      return;
    }

    if (selectedGlossaryId) {
      setGlossary((prev) =>
        prev.map((term) =>
          term.id === selectedGlossaryId ? { ...term, source, target, note: note || undefined } : term,
        ),
      );
      return;
    }

    setGlossary((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        source,
        target,
        note: note || undefined,
      },
    ]);
    resetGlossaryDraft();
  }

  function removeSelectedGlossaryTerm() {
    if (!selectedGlossaryId) return;
    setGlossary((prev) => prev.filter((term) => term.id !== selectedGlossaryId));
    resetGlossaryDraft();
  }

  function acceptGlossarySuggestion(suggestion: GlossarySuggestion) {
    if (!glossary.some((term) => term.source === suggestion.source)) {
      setGlossary((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          source: suggestion.source,
          target: suggestion.target,
          note: suggestion.note,
        },
      ]);
    }
    setGlossarySuggestions((prev) => prev.filter((term) => term.id !== suggestion.id));
  }

  function ignoreGlossarySuggestion(id: string) {
    setGlossarySuggestions((prev) => prev.filter((term) => term.id !== id));
  }

  function exportText(kind: 'json' | 'txt') {
    const payload =
      kind === 'json'
        ? JSON.stringify({ briefing, entries, errors }, null, 2)
        : entries.map((entry) => `${entry.sourceText}\n${entry.translatedText}`).join('\n\n');
    const blob = new Blob([payload], { type: kind === 'json' ? 'application/json' : 'text/plain' });
    const anchor = document.createElement('a');
    anchor.href = URL.createObjectURL(blob);
    anchor.download = `ko-ja-interpreter.${kind}`;
    anchor.click();
    URL.revokeObjectURL(anchor.href);
  }

  async function requestWakeLock() {
    const nav = navigator as Navigator & { wakeLock?: { request: (type: 'screen') => Promise<{ release: () => Promise<void> }> } };
    if (!nav.wakeLock) {
      setWakeLockState('브라우저 미지원');
      return;
    }
    try {
      await nav.wakeLock.request('screen');
      setWakeLockState('화면 꺼짐 방지 활성');
    } catch {
      setWakeLockState('권한 또는 환경 제한');
    }
  }

  function connectRealtime() {
    if (realtime.current) return;
    const client = new RealtimeClient(
      realtimeEndpoint,
      (message) => handleRealtimeMessage(message),
      setWsStatus,
      (error) => setErrors((prev) => [makeError('websocket', 'ws-error', '행사 서버 연결 오류', error), ...prev]),
    );
    realtime.current = client;
    client.connect();
  }

  function sendRealtimeSoon(message: EventMessage) {
    window.setTimeout(() => realtime.current?.send(message), 180);
    window.setTimeout(() => realtime.current?.send(message), 780);
  }

  function setRealtimeSessionCode(nextSessionCode: string, nextRoomMode: 'event' | 'personal') {
    const normalizedCode = nextSessionCode.toUpperCase();
    setSessionCode(normalizedCode);
    const sessionUrl =
      nextRoomMode === 'personal'
        ? `${location.origin}?room=personal&session=${normalizedCode}`
        : `${location.origin}?session=${normalizedCode}`;
    QRCode.toDataURL(sessionUrl, { margin: 1, width: 320 })
      .then(setQr)
      .catch(() => undefined);
  }

  function handleRealtimeMessage(message: EventMessage) {
    if (message.type === 'session-created' && message.sessionCode) {
      const nextRoomMode = message.roomMode ?? 'event';
      setRealtimeSessionCode(message.sessionCode, nextRoomMode);
      setRoomMode(nextRoomMode);
      setRoomRole(message.role ?? null);
      setParticipantCount(message.participantCount ?? 1);
      setRoomNotice(nextRoomMode === 'personal' ? '개인 통역방이 생성되었습니다. QR로 게스트를 초대하세요.' : '');
    }
    if (message.type === 'joined' && message.sessionCode) {
      const nextRoomMode = message.roomMode ?? 'event';
      setRealtimeSessionCode(message.sessionCode, nextRoomMode);
      setRoomMode(nextRoomMode);
      setRoomRole(message.role ?? null);
      setParticipantCount(message.participantCount ?? 1);
      setRoomNotice(nextRoomMode === 'personal' ? '개인 통역방에 입장했습니다. 상대방 발화는 번역 음성으로 재생됩니다.' : '참석자 연결이 완료되었습니다.');
    }
    if ((message.type === 'room-state' || message.type === 'peer-left') && message.sessionCode) {
      setParticipantCount(message.participantCount ?? 0);
      if (message.type === 'peer-left') setRoomNotice('참여자 1명이 방에서 나갔습니다.');
    }
    if (message.type === 'error') {
      setRoomNotice(message.message ?? '실시간 세션 연결 중 오류가 발생했습니다.');
      setErrors((prev) => [makeError('websocket', 'room-error', message.message ?? '실시간 세션 오류', message), ...prev]);
    }
    if (message.type === 'caption' && message.text && message.translatedText) {
      setSourceCaption(message.text);
      setTranslationCaption(message.translatedText);
      if (message.roomMode === 'personal' && message.sourceLang && message.targetLang) {
        const remoteEntry: TranscriptEntry = {
          id: crypto.randomUUID(),
          mode: 'earbud',
          sourceLang: message.sourceLang,
          targetLang: message.targetLang,
          sourceText: message.text,
          translatedText: message.translatedText,
          isFinal: true,
          createdAt: Date.now(),
          latency: calculateLatency({}),
        };
        setEntries((prev) => [...prev, remoteEntry].slice(-80));
        if (voiceEnabled) {
          setStatus('speaking');
          providers.tts
            .speak(message.translatedText, message.targetLang)
            .catch((error) => {
              setErrors((prev) => [makeError('tts', 'remote-speak-failed', '상대방 통역 음성 출력 실패', error), ...prev]);
            })
            .finally(() => setStatus('listening'));
        }
      }
    }
  }

  function createEventSession() {
    const nextSessionCode = makeLocalSessionCode();
    setRealtimeSessionCode(nextSessionCode, 'event');
    setRoomMode('event');
    setRoomRole('host');
    setParticipantCount(1);
    connectRealtime();
    sendRealtimeSoon({ type: 'create-session', sessionCode: nextSessionCode, roomMode: 'event', role: 'host' } as EventMessage);
  }

  function joinEventSession() {
    connectRealtime();
    sendRealtimeSoon({ type: 'join', sessionCode: joinCode.toUpperCase(), roomMode: 'event', role: 'guest' } as EventMessage);
  }

  function createPersonalRoom() {
    const nextSessionCode = makeLocalSessionCode();
    setRealtimeSessionCode(nextSessionCode, 'personal');
    setRoomMode('personal');
    setRoomRole('host');
    setParticipantCount(1);
    setFixedLang('ko');
    setAutoDetect(false);
    connectRealtime();
    sendRealtimeSoon({ type: 'create-session', sessionCode: nextSessionCode, roomMode: 'personal', role: 'host' } as EventMessage);
  }

  function joinPersonalRoom(nextJoinCode = joinCode) {
    const normalizedJoinCode = nextJoinCode.trim().toUpperCase();
    if (!normalizedJoinCode) {
      setRoomNotice('입장할 개인 통역방 코드를 입력해주세요.');
      return;
    }
    setJoinCode(normalizedJoinCode);
    setRoomMode('personal');
    setRoomRole('guest');
    setFixedLang('ja');
    setAutoDetect(false);
    connectRealtime();
    sendRealtimeSoon({ type: 'join', sessionCode: normalizedJoinCode, roomMode: 'personal', role: 'guest' } as EventMessage);
  }

  function joinPersonalRoomFromInvite() {
    const urlSessionCode = getPersonalSessionFromUrl();
    if (!urlSessionCode) return false;
    meetingStart.current = Date.now();
    setElapsedSeconds(0);
    setMode('earbud');
    setView('live');
    window.setTimeout(() => {
      joinPersonalRoom(urlSessionCode);
      void startListening('ja');
    }, 250);
    return true;
  }

  function broadcastCaption(entry: TranscriptEntry) {
    if (mode !== 'event' && !(mode === 'earbud' && roomMode === 'personal' && roomRole)) return;
    if (mode === 'earbud' && !entry.isFinal) return;
    realtime.current?.send({
      type: 'speaker-text',
      sessionCode,
      roomMode: mode === 'earbud' ? 'personal' : 'event',
      text: entry.sourceText,
      sourceLang: entry.sourceLang,
      targetLang: entry.targetLang,
      translatedText: entry.translatedText,
    } as EventMessage);
  }

  const currentMode = MODES.find((item) => item.id === mode)!;
  const modeCards: Array<{
    id: Mode;
    title: string;
    badge: string;
    body: string;
    icon: typeof Ear;
  }> = [
    {
      id: 'auto',
      title: '세미나 모드',
      badge: 'SEMINAR',
      body: '별도 조작 없이 대화를 계속 듣고, 짧은 문장을 빠르게 잘라서 통역',
      icon: Sparkles,
    },
    {
      id: 'earbud',
      title: '개인 통역 모드',
      badge: 'EARBUDS',
      body: '블루투스 이어폰을 나누어 끼고 대화하는 의전, 간단 미팅 시 실시간 통역',
      icon: Ear,
    },
    {
      id: 'table',
      title: '회의 모드',
      badge: 'TABLE MEETING',
      body: '태블릿 테이블 모드처럼 테이블 가운데 두고 다수가 함께 큰 글씨 원문/번역 자막을 보는 회의 모드',
      icon: Tablet,
    },
    {
      id: 'event',
      title: '행사 모드',
      badge: 'EVENT',
      body: '발표자의 발화를 다국어 자막으로 즉시 전송하여 참석자들이 QR로 감상',
      icon: Users,
    },
  ];

  if (view === 'auth') {
    return (
      <main className="auth-screen">
        <section className="auth-card" aria-label="시작 방식 선택">
          <div className="auth-logo">
            <Globe />
          </div>
          <h1>
            ho_ya&apos;s Talk-Talk <span>PRO</span>
          </h1>
          <p className="auth-copy">글로벌 미용 전문 통역시스템</p>

          <div className="auth-actions">
            <div className="google-login-slot">
              <div ref={googleButtonRef} className="google-official-button" />
              {!googleButtonReady && (
                <button className="google-login-button" onClick={startWithGoogle}>
                  <span className="google-mark" aria-hidden="true">G</span>
                  Google 계정으로 시작하기
                </button>
              )}
            </div>
            <button className="guest-login-button" onClick={startAsGuest}>
              <User /> 게스트 모드로 즉시 시작하기
            </button>
          </div>

          {authError && <p className="auth-error">{authError}</p>}
          <p className="auth-footnote">© 2026 Abridge AI. Secure, sandbox environment.</p>
        </section>
      </main>
    );
  }

  if (view === 'glossary') {
    const selectedTerm = glossary.find((term) => term.id === selectedGlossaryId);

    return (
      <main className="app glossary-page">
        <header className="brand-bar glossary-brand">
          <button className="back-button" onClick={() => setView('setup')}>
            <ArrowLeft /> 설정으로
          </button>
          <div className="live-title">
            <strong>전문 용어 사전</strong>
            <span>현재 등록된 특수 용어 {glossary.length}개</span>
          </div>
          <button className="secondary-button" onClick={resetGlossaryDraft}>
            <Eraser /> 새 용어
          </button>
        </header>

        <section className="glossary-manager">
          <section className="setup-card glossary-list-panel">
            <div className="section-heading">
              <h2>등록된 용어</h2>
              <span className="count-badge">{glossary.length}개</span>
            </div>
            <div className="glossary-list" aria-label="등록된 전문 용어 목록">
              {glossary.length === 0 ? (
                <div className="empty-archive">
                  <BookOpen />
                  <strong>아직 등록된 용어가 없습니다.</strong>
                  <span>오른쪽 입력창에서 자주 쓰는 원어와 번역어를 등록하세요.</span>
                </div>
              ) : (
                glossary.map((term) => (
                  <button
                    key={term.id}
                    className={term.id === selectedGlossaryId ? 'selected' : ''}
                    onClick={() => selectGlossaryTerm(term)}
                  >
                    <span>{term.source}</span>
                    <strong>{term.target}</strong>
                    {term.note && <small>{term.note}</small>}
                  </button>
                ))
              )}
            </div>

            <div className="suggestion-panel">
              <div className="section-heading">
                <h2>추천 용어 후보</h2>
                <span className="count-badge">{glossarySuggestions.length}개</span>
              </div>
              {glossarySuggestions.length === 0 ? (
                <p className="muted">회의 중 발견한 미용 업계 용어 후보가 이곳에 쌓입니다.</p>
              ) : (
                <div className="suggestion-list">
                  {glossarySuggestions.map((suggestion) => (
                    <article key={suggestion.id}>
                      <div>
                        <strong>{suggestion.source}</strong>
                        <span>{suggestion.target}</span>
                        <small>{suggestion.note} · {suggestion.occurrences}회 감지</small>
                      </div>
                      <div>
                        <button onClick={() => acceptGlossarySuggestion(suggestion)}><Check /> 사전에 추가</button>
                        <button onClick={() => ignoreGlossarySuggestion(suggestion.id)}><Eraser /> 무시</button>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </div>
          </section>

          <section className="setup-card glossary-editor-panel">
            <div className="section-heading">
              <h2>{selectedTerm ? '용어 수정' : '용어 등록'}</h2>
              {selectedTerm && <span className="count-badge">선택됨</span>}
            </div>

            <label className="field-label">원어</label>
            <input
              value={glossaryDraft.source}
              onChange={(event) => setGlossaryDraft((prev) => ({ ...prev, source: event.target.value }))}
              placeholder="예: 커트"
            />

            <label className="field-label">번역어</label>
            <input
              value={glossaryDraft.target}
              onChange={(event) => setGlossaryDraft((prev) => ({ ...prev, target: event.target.value }))}
              placeholder="예: カット"
            />

            <label className="field-label">메모</label>
            <textarea
              value={glossaryDraft.note}
              onChange={(event) => setGlossaryDraft((prev) => ({ ...prev, note: event.target.value }))}
              placeholder="상황, 발음, 사용처 등을 적어둘 수 있습니다."
            />

            <div className="glossary-actions">
              <button onClick={saveGlossaryDraft}>
                {selectedTerm ? <Save /> : <Check />}
                {selectedTerm ? '용어 수정' : '용어 등록'}
              </button>
              <button onClick={removeSelectedGlossaryTerm} disabled={!selectedTerm}>
                <Trash2 /> 용어 제거
              </button>
              <button onClick={resetGlossaryDraft}>
                <Eraser /> 입력 초기화
              </button>
            </div>
          </section>
        </section>
      </main>
    );
  }

  if (view === 'live') {
    if (boardMode) {
      return (
        <main
          className="app broadcast-board"
          style={{ '--board-caption-font-size': boardFontSizes[boardFontScale] } as CSSProperties}
        >
          <header className="board-header">
            <div className="board-title">
              <div className="board-icon"><Tablet /></div>
              <div>
                <span>실시간 세미나 양방향 자막 중계보드</span>
                <strong>{meetingTitle || 'Abridge 실시간 통역 세션'}</strong>
              </div>
            </div>

            <div className="board-controls" aria-label="전체화면 통역 설정">
              {mode !== 'auto' && (
                <button
                  className={autoDetect ? 'active' : ''}
                  onClick={useAutoLanguageDetection}
                >
                  <Globe /> 자동 언어 감지
                </button>
              )}
              <div className="board-language-switch" aria-label="발화 언어 선택">
                <button
                  className={!autoDetect && fixedLang === 'ko' ? 'active ko' : 'ko'}
                  onClick={() => setListeningLanguage('ko')}
                >
                  🇰🇷 한국어
                </button>
                <button
                  className={!autoDetect && fixedLang === 'ja' ? 'active ja' : 'ja'}
                  onClick={() => setListeningLanguage('ja')}
                >
                  🇯🇵 日本語
                </button>
              </div>
              {mode !== 'auto' && (
                <button onClick={() => setBoardSwapped((value) => !value)}>
                  <SwitchCamera /> 좌우 전환
                </button>
              )}
              <div className="board-font-switch" aria-label="자막 글자 크기">
                <span>글자</span>
                {([1, 2, 3, 4, 5] as const).map((level) => (
                  <button
                    key={level}
                    className={boardFontScale === level ? 'active' : ''}
                    onClick={() => setBoardFontScale(level)}
                    aria-pressed={boardFontScale === level}
                  >
                    {level}
                  </button>
                ))}
              </div>
              <span className="board-live-state">
                <span />
                {autoDetect ? '자동 감지 중' : `${LANG_LABELS[fixedLang]} 발화 수신 중`}
              </span>
              <button className="board-exit" onClick={exitBoardMode}>
                <Minimize2 /> 전체화면 종료
              </button>
              <button className="board-exit" onClick={requestExitLivePage}>
                <LogOut /> 나가기
              </button>
            </div>
          </header>

          {mode === 'auto' ? (
            <section className="board-stage seminar-board-stage" aria-label="세미나 전체화면 통역 대본">
              <article className="board-caption seminar-board-caption">
                <div className="seminar-transcript-header board-seminar-header">
                  <span>{LANG_LABELS[fixedLang]} 입력</span>
                  <strong>{LANG_LABELS[oppositeLang(fixedLang)]} 번역</strong>
                </div>
                <div className="board-seminar-lines">
                  {seminarEntries.length === 0 ? (
                    <p className="seminar-placeholder board-seminar-placeholder">
                      마이크로 말하거나 텍스트를 입력하면 원문과 번역문이 한 박스 안에 순서대로 쌓입니다.
                    </p>
                  ) : (
                    seminarEntries.map((entry) => (
                      <section key={entry.id} className={entry.isFinal ? 'done' : 'live'}>
                        <p className="board-source-line">{entry.sourceText}</p>
                        <p className="board-translation-line">{entry.translatedText}</p>
                      </section>
                    ))
                  )}
                </div>
              </article>
            </section>
          ) : (
            <section className="board-stage" aria-label="전체화면 번역 자막">
              {boardCaptions.map((caption) => (
                <article key={caption.lang} className={`board-caption ${caption.className}`}>
                  <div className={`board-pill ${caption.pillClass}`}>{caption.label}</div>
                  <p>{caption.text}</p>
                </article>
              ))}
            </section>
          )}

          <footer className="board-footer">
            <span>경과 시간: <strong>{formatElapsed(elapsedSeconds)}</strong></span>
            <span>중계 모드: {currentMode.label} / 대형 자막 실시간 중계 대시보드</span>
            <span>PREMIUM REAL-TIME TRANSLATOR ENGINE</span>
          </footer>
          {renderExitDialog()}
        </main>
      );
    }

    return (
      <main className={`app live-page ${flipped ? 'flipped' : ''}`}>
        <header className="brand-bar live-brand">
          <button className="back-button" onClick={exitLivePage}>
            <ArrowLeft /> 설정으로
          </button>
          <div className="live-title">
            <strong>{meetingTitle || 'Abridge 실시간 통역 세션'}</strong>
            <span>{currentMode.label} 모드 · {selectedProvider === 'mock' ? '로컬 데모 번역' : selectedProvider.toUpperCase()}</span>
          </div>
          <button className="danger-button" onClick={requestExitLivePage}>
            <Square /> 종료
          </button>
        </header>

        <section className="live-shell">
          <button
            className="launch-button live-launch"
            onClick={() => {
              resetLiveSession();
              void startListening();
            }}
          >
            <Play /> 실시간 AI 통역 미팅 개시 <Send />
          </button>

          <section className="live-console live-console-full">
            <div className="console-toolbar">
              <span className={`status ${latency.delayed ? 'warn' : ''}`}>{statusLabel[status]}</span>
              <div className="quick-language-controls" aria-label="빠른 발화 언어 선택">
                {mode !== 'auto' && (
                  <button className={autoDetect ? 'active' : ''} onClick={useAutoLanguageDetection}>
                    <Globe /> 자동 감지
                  </button>
                )}
                <button className={!autoDetect && fixedLang === 'ko' ? 'active ko' : 'ko'} onClick={() => setListeningLanguage('ko')}>
                  🇰🇷 {mode === 'auto' ? '한국어 입력' : '한국어 고정'}
                </button>
                <button className={!autoDetect && fixedLang === 'ja' ? 'active ja' : 'ja'} onClick={() => setListeningLanguage('ja')}>
                  🇯🇵 {mode === 'auto' ? '日本語 입력' : '日本語 고정'}
                </button>
              </div>
              <label><input type="checkbox" checked={voiceEnabled} onChange={(e) => setVoiceEnabled(e.target.checked)} /> 음성 합성</label>
              {mode === 'earbud' && voiceEnabled && (
                <span className="voice-tone-badge">통역 음성: {voiceGenderLabel(speakerVoiceGender)}</span>
              )}
              <button onClick={enterBoardMode}><Maximize2 /> 전체화면 보드</button>
              <button onClick={() => setStatus('paused')}><Pause /> 일시정지</button>
              <button onClick={saveCurrentMeeting}><Save /> 기록 저장</button>
              <button onClick={requestExitLivePage}><Square /> 종료</button>
            </div>

            {selectedProvider === 'mock' && (
              <div className="provider-warning">
                현재는 API 키 없이 동작하는 로컬 데모 번역입니다. 실제 Gemini 번역은 `.env`에 `VITE_TRANSLATION_PROVIDER=gemini`, `TRANSLATION_PROVIDER=gemini`, `GEMINI_API_KEY`를 설정한 뒤 서버를 다시 켜야 합니다.
              </div>
            )}

            {micPermissionError && (
              <div className="provider-warning mic-warning">
                마이크 권한이 차단되어 음성 인식이 시작되지 않았습니다. 주소창의 권한 설정에서 마이크를 허용하거나, 아래 텍스트 입력으로 번역을 테스트하세요.
              </div>
            )}

            <form
              className="manual"
              onSubmit={(event) => {
                event.preventDefault();
                submitManualTranslation();
              }}
            >
              <input value={manualText} onChange={(e) => setManualText(e.target.value)} placeholder="오류 확인용 텍스트 대체 입력" />
              <button type="submit"><Send /> 번역</button>
            </form>

            {mode === 'earbud' && (
              <div className="personal-room-box" aria-label="개인 통역 음성 채팅방">
                <div className="personal-room-summary">
                  <strong>개인 통역 음성 채팅방</strong>
                  <span>
                    {roomRole === 'host' ? '호스트' : roomRole === 'guest' ? '게스트' : '미연결'} · {participantCount || 0}/{maxPersonalRoomParticipants}명
                  </span>
                  <small>
                    내 발화는 상대 기기에서 번역 음성으로 재생되고, 상대 발화는 내 기기에서 번역 음성으로 재생됩니다.
                  </small>
                </div>
                <button onClick={createPersonalRoom}>
                  <QrCode /> 통역방 생성
                </button>
                <div className="event-session-card personal-session-card">
                  {qr && roomMode === 'personal' ? (
                    <img src={qr} alt="personal room qr" />
                  ) : (
                    <span className="event-qr-placeholder"><QrCode /></span>
                  )}
                  <div>
                    <strong>{roomMode === 'personal' && sessionCode ? sessionCode : '통역방 코드 없음'}</strong>
                    <small>
                      {roomMode === 'personal' && sessionCode
                        ? `입장 코드: ${sessionCode}`
                        : '통역방 생성 버튼을 누르면 게스트 초대 QR이 표시됩니다.'}
                    </small>
                  </div>
                </div>
                <input
                  value={joinCode}
                  onChange={(e) => setJoinCode(e.target.value)}
                  placeholder="게스트 입장 코드 입력"
                />
                <button onClick={() => joinPersonalRoom()}>
                  <Users /> 통역방 입장
                </button>
                {roomNotice && <p className="room-notice">{roomNotice}</p>}
              </div>
            )}

            {mode === 'auto' ? (
              <section className="seminar-transcript" aria-label="세미나 통역 대본">
                <div className="seminar-transcript-header">
                  <span>{LANG_LABELS[fixedLang]} 입력</span>
                  <strong>{LANG_LABELS[oppositeLang(fixedLang)]} 번역</strong>
                </div>
                <div className="seminar-transcript-lines">
                  {seminarEntries.length === 0 ? (
                    <p className="seminar-placeholder">
                      마이크로 말하거나 텍스트를 입력하면 원문과 번역문이 한 박스 안에 순서대로 쌓입니다.
                    </p>
                  ) : (
                    seminarEntries.map((entry) => (
                      <article key={entry.id} className={entry.isFinal ? 'done' : 'live'}>
                        <p className="source-line">{entry.sourceText}</p>
                        <p className="translation-line">{entry.translatedText}</p>
                      </article>
                    ))
                  )}
                </div>
              </section>
            ) : (
              <section className={`caption-stage ${mode}`}>
                <div className="caption source">
                  <span>{LANG_LABELS[decideDirection(sourceCaption || manualText, autoDetect, fixedLang).sourceLang]}</span>
                  <p>{sourceCaption || '통역 화면에서 마이크 사용 허용을 누르면 바로 대화 인식을 시작합니다.'}</p>
                </div>
                <div className={`caption translated ${isFinalCaption ? 'final' : 'interim'}`}>
                  <span>{LANG_LABELS[decideDirection(sourceCaption || manualText, autoDetect, fixedLang).targetLang]} {isFinalCaption ? '최종' : '중간'}</span>
                  <p>{translationCaption || '텍스트를 입력하거나 마이크로 말하면 번역 결과가 여기에 표시됩니다.'}</p>
                </div>
                <div className="log" aria-label="conversation log">
                  {entries.map((entry) => (
                    <article key={entry.id} className={entry.isFinal ? 'done' : 'live'}>
                      <small>{new Date(entry.createdAt).toLocaleTimeString()} · {entry.latency.totalMs ? Math.round(entry.latency.totalMs) : '-'}ms</small>
                      <p>{entry.sourceText}</p>
                      <strong>{entry.translatedText}</strong>
                    </article>
                  ))}
                </div>
              </section>
            )}

            {mode === 'table' && (
              <div className="primary-actions">
                <button onClick={() => document.documentElement.requestFullscreen?.()}><Tablet /> 전체화면</button>
                <button onClick={() => setFlipped((value) => !value)}><RotateCcw /> 180도</button>
                <button onClick={requestWakeLock}><Moon /> {wakeLockState}</button>
              </div>
            )}

            {mode === 'event' && (
              <div className="event-box">
                <button onClick={createEventSession}><QrCode /> 세션 생성</button>
                <div className="event-session-card">
                  {qr ? (
                    <img src={qr} alt="session qr" />
                  ) : (
                    <span className="event-qr-placeholder"><QrCode /></span>
                  )}
                  <div>
                    <strong>{sessionCode || '세션 코드 없음'}</strong>
                    <small>{sessionCode ? `${location.origin}?session=${sessionCode}` : '세션 생성 버튼을 누르면 참석자용 QR이 표시됩니다.'}</small>
                  </div>
                </div>
                <input value={joinCode} onChange={(e) => setJoinCode(e.target.value)} placeholder="참석자 코드 입력" />
                <button onClick={joinEventSession}><Users /> 참석자 연결</button>
              </div>
            )}
          </section>

          <aside className="live-diagnostics diagnostics compact-diagnostics">
            <h2>오류/성능 진단</h2>
            <dl>
              <div><dt>STT</dt><dd>{latency.sttMs ? `${Math.round(latency.sttMs)}ms` : '-'}</dd></div>
              <div><dt>번역</dt><dd>{latency.translationMs ? `${Math.round(latency.translationMs)}ms` : '-'}</dd></div>
              <div><dt>전체</dt><dd>{latency.totalMs ? `${Math.round(latency.totalMs)}ms` : '-'}</dd></div>
              <div><dt>Provider</dt><dd>{providers.translation.name}</dd></div>
              <div><dt>설정</dt><dd>{selectedProvider}</dd></div>
              <div><dt>STT 지원</dt><dd>{speechSupported ? '지원' : '미지원'}</dd></div>
            </dl>
            <details>
              <summary>최근 오류와 브라우저 정보</summary>
              <pre>{JSON.stringify({ browserInfo, online, ttsSupported, errors: errors.slice(0, 8) }, null, 2)}</pre>
            </details>
            <div className="live-archive">
              <h2>저장된 기록</h2>
              {meetings.length === 0 ? (
                <p className="muted">아직 저장된 기록이 없습니다.</p>
              ) : (
                <div className="archive-list">
                  {meetings.slice(0, 3).map((meeting) => (
                    <article key={meeting.id}>
                      <strong>{meeting.title}</strong>
                      <span>{new Date(meeting.startedAt).toLocaleString()} · {meeting.entries.length}개 문장</span>
                    </article>
                  ))}
                </div>
              )}
            </div>
          </aside>
        </section>
        {renderExitDialog()}
      </main>
    );
  }

  return (
    <main className={`app setup-shell ${flipped ? 'flipped' : ''}`}>
      <header className="brand-bar">
        <div className="brand-mark">
          <Globe />
        </div>
        <div className="brand-copy">
          <h1>
            ho_ya&apos;s Talk-Talk <span>PRO</span>
          </h1>
          <p>Bilingual meeting hub</p>
        </div>
        <div className="brand-user">
          <span>
            <User /> {authMode === 'google' ? 'Google 사용자' : '게스트 사용자'}
          </span>
          <button onClick={exitToAuth} aria-label="나가기">
            <LogOut />
          </button>
        </div>
      </header>

      <section className="setup-layout">
        <div className="setup-main">
          <section className="setup-card">
            <h2>1. 미팅 정보 설정</h2>
            <label className="field-label">미팅 세션 제목</label>
            <input value={meetingTitle} onChange={(event) => setMeetingTitle(event.target.value)} />
          </section>

          <section className="setup-card">
            <h2>2. 실시간 통역 모드 선택</h2>
            <div className="mode-card-grid" aria-label="mode">
              {modeCards.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    className={`mode-card ${mode === item.id ? 'selected' : ''}`}
                    key={item.id}
                    onClick={() => setMode(item.id)}
                  >
                    <span className="mode-icon"><Icon /></span>
                    <span className="mode-badge">{item.badge}</span>
                    <strong>{item.title}</strong>
                    <small>{item.body}</small>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="setup-card compact">
            <h2>3. 통역 대상 언어 설정</h2>
            <div className="language-pills">
              {(['ko', 'ja'] as Lang[]).map((lang) => (
                <button key={lang} className={fixedLang === lang ? 'active' : ''} onClick={() => setFixedLang(lang)}>
                  <Languages /> {LANG_LABELS[lang]} ({lang.toUpperCase()})
                </button>
              ))}
            </div>
            <p className="muted">* 개인/테이블/자동 통역은 한국어와 일본어 간 다이렉트 자동 순환 통역으로 작동합니다.</p>
          </section>

          <section className="setup-card">
            <div className="section-heading">
              <h2>4. 사전 브리핑 설정 (GEMINI 최적화)</h2>
              <span>컨텍스트 매칭</span>
            </div>
            <p className="muted">
              미팅의 목표 and 성격을 선택하시면 번역 프롬프트에 자동으로 결합되어 직역이 아닌 문맥에 맞는 정중하고 정확한 번역을 제공합니다.
            </p>
            <div className="briefing-chips">
              {BRIEFING_PRESETS.map((preset) => (
                <button className={briefing === preset ? 'active' : ''} key={preset} onClick={() => setBriefing(preset)}>
                  {preset}
                </button>
              ))}
              <button onClick={() => setBriefing('')}>직접 입력</button>
            </div>
            <label className="field-label">적용되는 사전 브리핑 전문</label>
            <textarea
              value={briefing}
              onChange={(event) => setBriefing(event.target.value)}
              placeholder="오늘은 한일 VIP 의전 및 환담 시간입니다. 정중하고 예의 바른 구존칭 표현을 사용하여 상대방을 배려하며 스몰토크를 진행하는 일정입니다."
            />
          </section>

          <section className="setup-card glossary-strip">
            <div>
              <BookOpen />
              <div>
                <h2>전문 용어 사전</h2>
                <p>현재 등록된 특수 용어: <strong>{glossary.length}개</strong></p>
              </div>
            </div>
            <button onClick={() => setView('glossary')}>
              용어 사전 관리하기
            </button>
          </section>

          <button className="launch-button" onClick={startMeetingSession}>
            <Play /> 실시간 AI 통역 미팅 개시 <Send />
          </button>
        </div>

        <aside className="setup-aside">
          <section className="archive-card">
            <div className="section-heading">
              <h2>지난 미팅 아카이브</h2>
              <button onClick={saveCurrentMeeting}>기록 보관소</button>
            </div>
            {meetings.length === 0 ? (
              <div className="empty-archive">
                <CalendarDays />
                <strong>아직 저장된 통역 기록이 없습니다.</strong>
                <span>미팅 종료 시 대화 내역과 AI 요약이 자동으로 이곳에 기록됩니다.</span>
              </div>
            ) : (
              <div className="archive-list">
                {meetings.slice(0, 5).map((meeting) => (
                  <article key={meeting.id}>
                    <strong>{meeting.title}</strong>
                    <span>{new Date(meeting.startedAt).toLocaleString()} · {meeting.entries.length}개 문장</span>
                  </article>
                ))}
              </div>
            )}
          </section>

          <section className="tips-card">
            <h2><Lightbulb /> 이용 안내 및 팁</h2>
            <ul>
              <li>통역 화면에서 마이크 사용 허용을 누르면 바로 대화 인식을 시작합니다.</li>
              <li>상황에 맞는 음성 자동 합성을 켜거나 꺼서 소음을 관리할 수 있습니다.</li>
              <li>블루투스 이어폰을 기기에 연결하시면 개인 통역 모드를 더욱 프라이빗하게 이용 가능합니다.</li>
              <li>회의 중 추가되는 발화는 실시간으로 로컬 기록에 저장되며, 종료 시 요약 생성에 반영됩니다.</li>
            </ul>
          </section>

          <section className="diagnostics compact-diagnostics">
            <h2>오류/성능 진단</h2>
            <dl>
              <div><dt>STT</dt><dd>{latency.sttMs ? `${Math.round(latency.sttMs)}ms` : '-'}</dd></div>
              <div><dt>번역</dt><dd>{latency.translationMs ? `${Math.round(latency.translationMs)}ms` : '-'}</dd></div>
              <div><dt>전체</dt><dd>{latency.totalMs ? `${Math.round(latency.totalMs)}ms` : '-'}</dd></div>
              <div><dt>WebSocket</dt><dd>{wsStatus}</dd></div>
              <div><dt>Provider</dt><dd>{providers.translation.name}</dd></div>
              <div><dt>STT 지원</dt><dd>{speechSupported ? '지원' : '미지원'}</dd></div>
            </dl>
            {latency.delayed && <p className="delay">3초 이상 지연이 측정되었습니다.</p>}
            <details>
              <summary>최근 오류와 브라우저 정보</summary>
              <pre>{JSON.stringify({ browserInfo, online, ttsSupported, errors: errors.slice(0, 8) }, null, 2)}</pre>
            </details>
            <div className="export-row">
              <button onClick={() => exportText('json')}><Download /> JSON</button>
              <button onClick={() => exportText('txt')}><Download /> TXT</button>
              <button onClick={async () => { await clearMeetings(); setMeetings([]); }}><Eraser /> 전체 삭제</button>
            </div>
          </section>
        </aside>
      </section>

      <footer>
        <span>{voiceEnabled ? <Volume2 /> : <VolumeX />} 이어폰 연결 여부는 브라우저 보안 제한상 완벽히 감지할 수 없습니다.</span>
        <span>{currentMode.label} 모드 · AI 요약은 외부 provider 연결 전에는 규칙 기반/비활성 상태입니다.</span>
      </footer>
    </main>
  );
}
