import type { Lang } from '../types';

export interface EventMessage {
  type: 'create-session' | 'session-created' | 'join' | 'speaker-text' | 'caption' | 'error' | 'pong';
  sessionCode?: string;
  text?: string;
  sourceLang?: Lang;
  targetLang?: Lang;
  translatedText?: string;
  sentAt?: number;
}

export class RealtimeClient {
  socket?: WebSocket;
  status: 'disconnected' | 'connecting' | 'connected' = 'disconnected';
  latencyMs?: number;

  constructor(
    private url: string,
    private onMessage: (message: EventMessage) => void,
    private onStatus: (status: RealtimeClient['status']) => void,
    private onError: (error: Event) => void,
  ) {}

  connect() {
    if (this.status !== 'disconnected') return;
    this.status = 'connecting';
    this.onStatus(this.status);
    this.socket = new WebSocket(this.url);
    this.socket.onopen = () => {
      this.status = 'connected';
      this.onStatus(this.status);
    };
    this.socket.onmessage = (event) => {
      const parsed = JSON.parse(event.data) as EventMessage;
      if (parsed.sentAt) this.latencyMs = performance.now() - parsed.sentAt;
      this.onMessage(parsed);
    };
    this.socket.onerror = (error) => this.onError(error);
    this.socket.onclose = () => {
      this.status = 'disconnected';
      this.onStatus(this.status);
    };
  }

  send(message: EventMessage) {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({ ...message, sentAt: performance.now() }));
    }
  }

  close() {
    this.socket?.close();
  }
}
