import {
  BookOpen,
  CalendarDays,
  Download,
  Ear,
  Eraser,
  Globe,
  Languages,
  Lightbulb,
  LogOut,
  Moon,
  Pause,
  Play,
  QrCode,
  RotateCcw,
  Send,
  Sparkles,
  Square,
  Tablet,
  User,
  Users,
  Volume2,
  VolumeX,
} from 'lucide-react';
import QRCode from 'qrcode';
import { useEffect, useMemo, useRef, useState } from 'react';
import { BRIEFING_PRESETS, DEFAULT_GLOSSARY, LANG_LABELS, MODES } from './constants';
import { calculateLatency } from './core/latency';
import { decideDirection } from './core/language';
import { shouldTranslateInterim } from './core/transcript';
import { createProviders } from './providers/providerRegistry';
import { RealtimeClient, type EventMessage } from './realtime/client';
import { clearMeetings, getGlossary, listMeetings, saveGlossary, saveMeeting } from './storage/meetings';
import type { AppError, GlossaryTerm, Lang, LatencyMarks, MeetingRecord, Mode, SessionStatus, TranscriptEntry } from './types';

const statusLabel: Record<SessionStatus, string> = {
  idle: '대기 중',
  listening: '듣는 중',
  recognizing: '인식 중',
  translating: '번역 중',
  speaking: '출력 중',
  paused: '일시정지',
  error: '오류',
};

const providers = createProviders();

function now() {
  return performance.now();
}

function makeError(area: AppError['area'], code: string, message: string, raw?: unknown): AppError {
  return { id: crypto.randomUUID(), area, code, message, raw, timestamp: Date.now() };
}

export default function App() {
  const [mode, setMode] = useState<Mode>('earbud');
  const [view, setView] = useState<'setup' | 'live'>('setup');
  const [meetingTitle, setMeetingTitle] = useState('Abridge 실시간 통역 세션');
  const [status, setStatus] = useState<SessionStatus>('idle');
  const [theme] = useState<'dark' | 'light'>('dark');
  const [autoDetect, setAutoDetect] = useState(true);
  const [fixedLang, setFixedLang] = useState<Lang>('ko');
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [briefing, setBriefing] = useState(BRIEFING_PRESETS[0]);
  const [manualText, setManualText] = useState('');
  const [sourceCaption, setSourceCaption] = useState('');
  const [translationCaption, setTranslationCaption] = useState('');
  const [entries, setEntries] = useState<TranscriptEntry[]>([]);
  const [errors, setErrors] = useState<AppError[]>([]);
  const [glossary, setGlossary] = useState<GlossaryTerm[]>(DEFAULT_GLOSSARY);
  const [meetings, setMeetings] = useState<MeetingRecord[]>([]);
  const [marks, setMarks] = useState<LatencyMarks>({});
  const [isFinalCaption, setIsFinalCaption] = useState(false);
  const [wsStatus, setWsStatus] = useState<'disconnected' | 'connecting' | 'connected'>('disconnected');
  const [sessionCode, setSessionCode] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [qr, setQr] = useState('');
  const [flipped, setFlipped] = useState(false);
  const [wakeLockState, setWakeLockState] = useState('미사용');
  const [online, setOnline] = useState(navigator.onLine);
  const realtime = useRef<RealtimeClient | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const lastTranslationRequest = useRef('');
  const meetingStart = useRef(Date.now());
  const userStopped = useRef(false);

  const latency = useMemo(() => calculateLatency(marks), [marks]);
  const speechSupported = providers.speech.isSupported();
  const ttsSupported = providers.tts.isSupported();
  const browserInfo = `${navigator.userAgent}`;

  useEffect(() => {
    getGlossary().then(setGlossary).catch(() => setGlossary(DEFAULT_GLOSSARY));
    listMeetings().then(setMeetings).catch(() => undefined);
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
    saveGlossary(glossary).catch((error) =>
      setErrors((prev) => [makeError('storage', 'glossary-save', '용어 사전 저장 실패', error), ...prev]),
    );
  }, [glossary]);

  async function translateText(text: string, isFinal: boolean) {
    if (!shouldTranslateInterim(text, lastTranslationRequest.current) && !isFinal) return;
    lastTranslationRequest.current = text;
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    const direction = decideDirection(text, autoDetect, fixedLang);
    const requestMark = now();
    setMarks((prev) => ({ ...prev, firstTranslationRequest: prev.firstTranslationRequest ?? requestMark }));
    setStatus('translating');
    try {
      const translatedText = await providers.translation.translate({
        text,
        ...direction,
        briefing,
        glossary,
        recentContext: entries.slice(-4).flatMap((entry) => [entry.sourceText, entry.translatedText]),
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
      broadcastCaption(entry);

      if (voiceEnabled && translatedText.trim()) {
        setStatus('speaking');
        setMarks((prev) => ({ ...prev, firstSpeechOutput: prev.firstSpeechOutput ?? now() }));
        providers.tts.speak(translatedText, direction.targetLang).catch((error) => {
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
    const firstCaption = marks.firstSourceCaption ?? now();
    setMarks((prev) => ({ ...prev, firstSourceCaption: prev.firstSourceCaption ?? firstCaption }));
    setSourceCaption(trimmed);
    setStatus(isFinal ? 'translating' : 'recognizing');
    window.setTimeout(() => translateText(trimmed, isFinal), isFinal ? 0 : 420);
  }

  async function startListening() {
    userStopped.current = false;
    setMarks({ micStart: now() });
    setStatus('listening');
    if (!speechSupported) {
      setErrors((prev) => [
        makeError('speech', 'unsupported', '이 브라우저는 음성인식을 지원하지 않습니다. 텍스트 입력으로 데모를 확인하세요.'),
        ...prev,
      ]);
      return;
    }
    await providers.speech.start({
      lang: fixedLang,
      interimResults: true,
      onResult: (chunk) => handleSpeechText(chunk.text, chunk.isFinal),
      onError: (error) => {
        setErrors((prev) => [error, ...prev]);
        setStatus(error.code === 'no-speech' ? 'listening' : 'error');
      },
      onEnd: () => {
        if (!userStopped.current && mode === 'auto') {
          window.setTimeout(() => startListening(), 800);
        } else {
          setStatus((prev) => (prev === 'paused' ? prev : 'idle'));
        }
      },
    });
  }

  function startMeetingSession() {
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
      'ws://127.0.0.1:8788',
      (message) => handleRealtimeMessage(message),
      setWsStatus,
      (error) => setErrors((prev) => [makeError('websocket', 'ws-error', '행사 서버 연결 오류', error), ...prev]),
    );
    realtime.current = client;
    client.connect();
  }

  function handleRealtimeMessage(message: EventMessage) {
    if (message.type === 'session-created' && message.sessionCode) {
      setSessionCode(message.sessionCode);
      QRCode.toDataURL(`${location.origin}?session=${message.sessionCode}`).then(setQr).catch(() => undefined);
    }
    if (message.type === 'caption' && message.text && message.translatedText) {
      setSourceCaption(message.text);
      setTranslationCaption(message.translatedText);
    }
  }

  function createEventSession() {
    connectRealtime();
    window.setTimeout(() => realtime.current?.send({ type: 'create-session' } as EventMessage), 150);
  }

  function joinEventSession() {
    connectRealtime();
    window.setTimeout(() => realtime.current?.send({ type: 'join', sessionCode: joinCode.toUpperCase() } as EventMessage), 150);
  }

  function broadcastCaption(entry: TranscriptEntry) {
    if (mode !== 'event') return;
    realtime.current?.send({
      type: 'speaker-text',
      sessionCode,
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
      id: 'earbud',
      title: '개인 통역 모드',
      badge: 'EARBUDS',
      body: '블루투스 이어폰을 나누어 끼고 대화하는 의전, 간단 미팅 시 실시간 통역',
      icon: Ear,
    },
    {
      id: 'table',
      title: '태블릿 테이블 모드',
      badge: 'TABLET',
      body: '테이블 가운데 두고 다수가 함께 큰 글씨 원문/번역 자막 대화창 누적 모드',
      icon: Tablet,
    },
    {
      id: 'auto',
      title: '세미나 모드',
      badge: 'SEMINAR',
      body: '별도 조작 없이 대화를 계속 듣고, 짧은 문장을 빠르게 잘라서 통역',
      icon: Sparkles,
    },
    {
      id: 'event',
      title: '행사 모드',
      badge: 'EVENT',
      body: '발표자의 발화를 다국어 자막으로 즉시 전송하여 참석자들이 QR로 감상',
      icon: Users,
    },
  ];

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
            <User /> 게스트 사용자
          </span>
          <button aria-label="logout placeholder">
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
            <button onClick={() => setGlossary((prev) => [...prev, { id: crypto.randomUUID(), source: '', target: '' }])}>
              용어 사전 관리하기
            </button>
          </section>

          <button className="launch-button" onClick={startMeetingSession}>
            <Play /> 실시간 AI 통역 미팅 개시 <Send />
          </button>

          {view === 'live' && (
          <section className="live-console">
            <div className="console-toolbar">
              <span className={`status ${latency.delayed ? 'warn' : ''}`}>{statusLabel[status]}</span>
              <label><input type="checkbox" checked={autoDetect} onChange={(e) => setAutoDetect(e.target.checked)} /> 자동 언어 감지</label>
              <label><input type="checkbox" checked={voiceEnabled} onChange={(e) => setVoiceEnabled(e.target.checked)} /> 음성 합성</label>
              <button onClick={() => setStatus('paused')}><Pause /> 일시정지</button>
              <button onClick={stopListening}><Square /> 종료</button>
            </div>

            <form
              className="manual"
              onSubmit={(event) => {
                event.preventDefault();
                setMarks({ micStart: now(), firstSourceCaption: now() });
                handleSpeechText(manualText, true);
              }}
            >
              <input value={manualText} onChange={(e) => setManualText(e.target.value)} placeholder="오류 확인용 텍스트 대체 입력" />
              <button type="submit"><Send /> 번역</button>
            </form>

            <section className={`caption-stage ${mode}`}>
              <div className="caption source">
                <span>{LANG_LABELS[decideDirection(sourceCaption || manualText, autoDetect, fixedLang).sourceLang]}</span>
                <p>{sourceCaption || '통역 화면에서 마이크 사용 허용을 누르면 바로 대화 인식을 시작합니다.'}</p>
              </div>
              <div className={`caption translated ${isFinalCaption ? 'final' : 'interim'}`}>
                <span>{LANG_LABELS[decideDirection(sourceCaption || manualText, autoDetect, fixedLang).targetLang]} {isFinalCaption ? '최종' : '중간'}</span>
                <p>{translationCaption || '브라우저가 STT를 지원하지 않으면 이 텍스트 입력으로 흐름을 테스트하세요.'}</p>
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
                <strong>{sessionCode || '세션 코드 없음'}</strong>
                {qr && <img src={qr} alt="session qr" />}
                <input value={joinCode} onChange={(e) => setJoinCode(e.target.value)} placeholder="참석자 코드 입력" />
                <button onClick={joinEventSession}><Users /> 참석자 연결</button>
              </div>
            )}
          </section>
          )}
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
