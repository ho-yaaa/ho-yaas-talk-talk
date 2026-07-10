# KO JA Live Interpreter

한국어와 일본어 사용자가 의전, 스몰토크, 간단한 비즈니스 미팅, 테이블 회의, 행사에서 사용할 수 있도록 만든 초저지연 실시간 통역 웹앱 로컬 데모입니다.

## 비용 원칙

이 프로젝트는 기본값으로 유료 API, 유료 DB, 유료 호스팅, Firebase, Supabase, OpenAI, Gemini, Google Cloud를 호출하지 않습니다. 기본 provider는 `mock-local`이며 브라우저 `SpeechRecognition`, `SpeechSynthesis`, IndexedDB, 로컬 WebSocket만 사용합니다.

외부 AI 번역이나 요약을 연결하는 순간 비용이 발생할 수 있습니다. 실제 연결 전에는 공급자의 최신 공식 문서, 요금, 개인정보 전송 범위를 확인하고, API 키는 프론트엔드 번들에 넣지 말고 서버/서버리스 환경변수로만 주입해야 합니다.

## 실행

```bash
pnpm install
pnpm dev:all
```

앱: `http://127.0.0.1:5173`  
로컬 행사 서버: `ws://127.0.0.1:8788`

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

## Provider 확장

`.env.example`에는 다음 구조만 제공합니다.

```env
TRANSLATION_PROVIDER=mock
SUMMARY_PROVIDER=rules
REALTIME_SERVER_URL=ws://127.0.0.1:8787
```

`TRANSLATION_PROVIDER=openai` 또는 `gemini` 같은 실제 adapter를 추가할 때는 최신 공식 문서를 확인한 뒤 백엔드에서만 키를 읽도록 구현하세요. 현재 코드는 비용 승인 없이 외부 API를 호출하지 않도록 placeholder가 오류를 던집니다.

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
