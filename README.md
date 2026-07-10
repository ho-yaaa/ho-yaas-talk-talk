# KO JA Live Interpreter

한국어와 일본어 사용자가 의전, 스몰토크, 간단한 비즈니스 미팅, 테이블 회의, 행사에서 사용할 수 있도록 만든 초저지연 실시간 통역 웹앱 로컬 데모입니다.

## 비용 원칙

이 프로젝트는 기본값으로 유료 API, 유료 DB, 유료 호스팅, Firebase, Supabase, OpenAI, Gemini, Google Cloud를 호출하지 않습니다. 기본 provider는 `mock-local`이며 브라우저 `SpeechRecognition`, `SpeechSynthesis`, IndexedDB, 로컬 WebSocket만 사용합니다.

외부 AI 번역이나 요약을 연결하는 순간 비용이 발생할 수 있습니다. 실제 연결 전에는 공급자의 최신 공식 문서, 요금, 개인정보 전송 범위를 확인하고, API 키는 프론트엔드 번들에 넣지 말고 서버/서버리스 환경변수로만 주입해야 합니다.

ChatGPT Plus 구독은 ChatGPT 앱 사용권이며 OpenAI API 사용량 과금과 별도입니다. GPT API 통역을 켜려면 OpenAI API 키와 API billing이 필요할 수 있습니다.

## 실행

```bash
pnpm install
pnpm dev:all
```

앱: `http://127.0.0.1:5173`  
로컬 행사 서버: `ws://127.0.0.1:8788`

브라우저에서 앱을 테스트하려면 반드시 `http://127.0.0.1:5173/`을 여세요.  
`http://127.0.0.1:8788/api/translate`는 화면이 뜨는 사이트가 아니라 번역 요청을 받는 API 주소입니다.

## GPT API 통역 켜기

기본은 무료 mock provider입니다. GPT API를 사용하려면 실제 키를 `.env`에만 넣고, 프론트엔드 코드나 Git에는 절대 커밋하지 마세요.

```env
VITE_TRANSLATION_PROVIDER=gpt
VITE_TRANSLATION_API_URL=http://127.0.0.1:8788/api/translate
OPENAI_API_KEY=sk-...
OPENAI_TRANSLATION_MODEL=gpt-4.1-mini
```

그 다음 앱 서버와 로컬 proxy 서버를 같이 실행합니다.

```bash
pnpm dev:all
```

GPT translation은 `/api/translate` 로컬 서버 proxy를 통해서만 호출됩니다. 브라우저 번들에는 API 키가 들어가지 않습니다. OpenAI Responses API는 공식 문서의 text generation 및 Responses API 기준으로 구현했습니다.

## Gemini API 통역 켜기

사용량이 적은 일정에서는 Gemini API를 비용 효율적으로 쓸 수 있지만, 무료 한도/유료 과금/지역/모델 제한은 Google 정책에 따라 달라질 수 있습니다. 실제 키를 `.env`에만 넣고 Git에는 커밋하지 마세요.

```env
VITE_TRANSLATION_PROVIDER=gemini
VITE_TRANSLATION_API_URL=http://127.0.0.1:8788/api/translate
TRANSLATION_PROVIDER=gemini
GEMINI_API_KEY=...
GEMINI_TRANSLATION_MODEL=gemini-3.5-flash
```

그 다음 앱 서버와 로컬 proxy 서버를 같이 실행합니다.

```bash
pnpm dev:all
```

Gemini 호출도 브라우저에서 직접 하지 않고 `/api/translate` 로컬 서버 proxy를 거칩니다. Google 공식 Gemini API 문서의 Interactions API REST 형식과 가격 안내를 기준으로 구현했습니다.

## 테스트

```bash
pnpm test
pnpm build
pnpm test:e2e
```

## 구현 범위

- React, TypeScript, Vite, PWA 앱 셸
- 모바일/태블릿 반응형 다크 모드 UI와 라이트 모드
- 이어폰 통역, 태블릿 테이블, 자동 통역, 행사 모드
- 브라우저 SpeechRecognition interimResults 지원
- SpeechRecognition 미지원 시 텍스트 대체 입력
- 브라우저 SpeechSynthesis 기반 한국어/일본어 음성 출력
- provider 인터페이스: STT, 번역, TTS, 행사 세션, 요약 확장 구조
- mock 번역 provider와 유료 provider placeholder
- AbortController 기반 이전 번역 요청 취소
- 중복 번역/중복 음성 재생 방지
- `performance.now()` 기반 STT, 번역, TTS, 전체 지연시간 측정
- 3초 이상 지연 표시
- SpeechRecognition 오류 세부 기록과 개발자 진단 패널
- 온라인/오프라인, WebSocket 상태, provider, 브라우저 정보 표시
- IndexedDB 회의 기록 저장/불러오기/삭제
- JSON/TXT 내보내기
- 용어 사전 로컬 저장
- 행사 모드 로컬 WebSocket 발표자/참석자 데모
- 화면 꺼짐 방지 Wake Lock 지원 가능 범위 처리

## 브라우저 제한

- iOS Safari는 Web Speech Recognition 지원이 제한적입니다. 이 경우 텍스트 입력 데모를 사용하세요.
- Chrome 계열 브라우저가 마이크 STT 테스트에 가장 적합합니다.
- 마이크, SpeechRecognition, PWA 설치, Wake Lock은 브라우저와 HTTPS 정책의 영향을 받습니다. 로컬 `localhost`/`127.0.0.1`은 개발 예외로 동작할 수 있지만 실제 배포는 HTTPS가 필요합니다.
- 한 기기와 한 마이크로 두 화자를 완벽히 분리할 수 없습니다. 이 앱은 자동 언어 감지와 현재 발화 언어 고정으로 보조하지만, 화자 분리나 완벽한 방향 판별을 과장하지 않습니다.
- 이어폰 연결 여부와 출력 장치 선택은 브라우저 보안 정책 때문에 완전 자동 감지가 어렵습니다.

## 자주 뜨는 오류와 해결

- `SpeechRecognition` 또는 `webkitSpeechRecognition` 미지원: MDN 기준 SpeechRecognition 오류 이벤트는 일부 주요 브라우저에서 동작하지 않는 제한 기능입니다. Chrome 계열 브라우저에서 `http://127.0.0.1:5173` 또는 HTTPS로 실행하세요.
- `not-allowed`: 마이크 권한이 거절된 상태입니다. 브라우저 주소창의 사이트 설정에서 마이크를 허용하고 새로고침하세요.
- `service-not-allowed`: 브라우저나 OS 정책상 음성인식 서비스가 차단된 상태입니다. Chrome 최신 버전에서 다시 확인하고, 회사/학교 관리 브라우저라면 정책 제한을 확인하세요.
- `audio-capture`: 마이크 장치를 찾지 못했습니다. macOS 시스템 설정 > 개인정보 보호 및 보안 > 마이크에서 브라우저 권한을 확인하세요.
- `network`: 브라우저 음성인식 엔진이 네트워크 기반으로 동작하는 경우 발생할 수 있습니다. 텍스트 대체 입력은 계속 작동합니다.
- WebSocket `disconnected`: 행사 모드 서버가 꺼진 상태입니다. `pnpm server` 또는 `pnpm dev:all`로 `http://127.0.0.1:8788/health`가 `{"ok":true}`인지 확인하세요.
- GitHub push 실패: `gh auth status`로 로그인 상태를 확인하고, 저장소 생성/push 승인이 필요합니다. 원격 URL이 있으면 `git remote add origin <URL>` 후 `git push -u origin main`을 실행합니다.

## Provider 확장

`.env.example`에는 다음 구조만 제공합니다.

```env
VITE_TRANSLATION_PROVIDER=mock
VITE_TRANSLATION_API_URL=http://127.0.0.1:8788/api/translate
TRANSLATION_PROVIDER=mock
SUMMARY_PROVIDER=rules
REALTIME_SERVER_URL=ws://127.0.0.1:8788
```

`VITE_TRANSLATION_PROVIDER=gpt`, `openai`, 또는 `gemini`를 설정하면 로컬 서버 proxy를 통해 실제 AI 번역 provider를 사용합니다. mock provider는 API 키 없이 UI와 흐름 검증용으로 유지됩니다.

## 수동 점검 체크리스트

- Chrome에서 시작 버튼 클릭 시 마이크 권한 요청 확인
- 권한 거절 시 진단 패널에 `not-allowed` 기록 확인
- 한국어 발화 중 원문 중간 자막 표시 확인
- 첫 번역 자막 지연시간이 실제 측정값으로 표시되는지 확인
- 번역 음성 ON/OFF가 동작하는지 확인
- 이어폰 사용 시 스피커 음성이 마이크로 재입력되는지 환경별 확인
- 태블릿 모드에서 가로/세로 레이아웃, 전체 화면, 180도 보기 확인
- 행사 모드에서 로컬 WebSocket 서버 실행 후 세션 생성/참석자 연결 확인

## 알려진 제한

- mock provider는 실제 번역 품질을 목표로 하지 않습니다. API 키 없이 자막 흐름, 취소, 지연 측정, 기록 저장을 확인하기 위한 로컬 데모입니다.
- SpeechRecognition의 실제 지연은 브라우저 구현과 네트워크 상태에 좌우됩니다.
- 행사 모드는 로컬 개발 서버 데모입니다. 외부 공개 배포에는 별도 인프라와 보안 검토가 필요하며 비용이 발생할 수 있습니다.
- AI 요약은 외부 provider 연결 전에는 “연결 필요” 상태로 남겨둡니다.
