import type { SessionStatus } from '../types';

export type SessionEvent =
  | 'START'
  | 'INTERIM'
  | 'TRANSLATE'
  | 'SPEAK'
  | 'PAUSE'
  | 'RESUME'
  | 'STOP'
  | 'ERROR'
  | 'RECOVER';

const transitions: Record<SessionStatus, Partial<Record<SessionEvent, SessionStatus>>> = {
  idle: { START: 'listening', ERROR: 'error' },
  listening: {
    INTERIM: 'recognizing',
    TRANSLATE: 'translating',
    PAUSE: 'paused',
    STOP: 'idle',
    ERROR: 'error',
  },
  recognizing: {
    INTERIM: 'recognizing',
    TRANSLATE: 'translating',
    PAUSE: 'paused',
    STOP: 'idle',
    ERROR: 'error',
  },
  translating: {
    INTERIM: 'recognizing',
    SPEAK: 'speaking',
    PAUSE: 'paused',
    STOP: 'idle',
    ERROR: 'error',
  },
  speaking: {
    INTERIM: 'recognizing',
    TRANSLATE: 'translating',
    PAUSE: 'paused',
    STOP: 'idle',
    ERROR: 'error',
  },
  paused: { RESUME: 'listening', STOP: 'idle', ERROR: 'error' },
  error: { RECOVER: 'listening', STOP: 'idle' },
};

export function transitionSession(current: SessionStatus, event: SessionEvent): SessionStatus {
  return transitions[current][event] ?? current;
}
