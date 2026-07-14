import type { GlossaryTerm, Lang, Mode } from './types';

export const LANG_LABELS: Record<Lang, string> = {
  ko: '한국어',
  ja: '日本語',
  en: 'English',
  zh: '中文',
};

export const MODES: Array<{ id: Mode; label: string; description: string }> = [
  { id: 'earbud', label: '이어폰', description: '두 사람이 한 기기와 이어폰 한 쌍으로 사용' },
  { id: 'table', label: '회의', description: '큰 자막을 함께 보는 회의/식사 자리' },
  { id: 'auto', label: '자동', description: '켜둔 상태로 지속 듣기와 중간 번역' },
  { id: 'event', label: '행사', description: '발표자와 참석자 로컬 WebSocket 데모' },
];

export const BRIEFING_PRESETS = [
  '의전 및 스몰토크',
  '미용 교육 미팅',
  '바이어 상담',
  '제품 소개',
  '행사 운영 미팅',
  '세미나 진행',
  '일반 미팅',
];

export const DEFAULT_GLOSSARY: GlossaryTerm[] = [
  { id: 'cut', source: '커트', target: 'カット' },
  { id: 'perm', source: '열펌', target: 'デジタルパーマ / 熱パーマ' },
  { id: 'owner', source: '원장', target: 'オーナースタイリスト / 店長' },
  { id: 'designer', source: '디자이너', target: 'スタイリスト' },
  { id: 'student', source: '교육생', target: '受講生' },
  { id: 'buyer', source: '바이어', target: 'バイヤー' },
  { id: 'venue', source: '행사장', target: 'イベント会場' },
  { id: 'seminar', source: '세미나', target: 'セミナー' },
  { id: 'booth', source: '부스', target: 'ブース' },
  { id: 'reception', source: '리셉션', target: 'レセプション' },
  { id: 'model', source: '모델 섭외', target: 'モデル手配' },
  { id: 'fee', source: '강사료', target: '講師料' },
];
