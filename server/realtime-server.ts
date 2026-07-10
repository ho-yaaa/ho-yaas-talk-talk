import http from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';

type Message = {
  type: 'create-session' | 'join' | 'speaker-text' | 'ping';
  sessionCode?: string;
  text?: string;
  sourceLang?: string;
  targetLang?: string;
  translatedText?: string;
  sentAt?: number;
};

const sessions = new Map<string, Set<WebSocket>>();

function makeCode() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

function send(socket: WebSocket, message: Record<string, unknown>) {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
}

const server = http.createServer((request, response) => {
  if (request.url === '/health') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ ok: true }));
    return;
  }
  response.writeHead(404);
  response.end();
});

const wss = new WebSocketServer({ server });

wss.on('connection', (socket) => {
  let currentSession: string | undefined;

  socket.on('message', (data) => {
    const message = JSON.parse(String(data)) as Message;
    if (message.type === 'create-session') {
      currentSession = makeCode();
      sessions.set(currentSession, new Set([socket]));
      send(socket, { type: 'session-created', sessionCode: currentSession, sentAt: Date.now() });
      return;
    }

    if (message.type === 'join' && message.sessionCode) {
      currentSession = message.sessionCode.toUpperCase();
      const peers = sessions.get(currentSession) ?? new Set<WebSocket>();
      peers.add(socket);
      sessions.set(currentSession, peers);
      send(socket, { type: 'join', sessionCode: currentSession, sentAt: Date.now() });
      return;
    }

    if (message.type === 'speaker-text' && currentSession) {
      const peers = sessions.get(currentSession) ?? new Set<WebSocket>();
      peers.forEach((peer) =>
        send(peer, {
          type: 'caption',
          sessionCode: currentSession,
          text: message.text,
          sourceLang: message.sourceLang,
          targetLang: message.targetLang,
          translatedText: message.translatedText,
          sentAt: Date.now(),
        }),
      );
      return;
    }

    if (message.type === 'ping') send(socket, { type: 'pong', sentAt: Date.now() });
  });

  socket.on('close', () => {
    if (!currentSession) return;
    const peers = sessions.get(currentSession);
    peers?.delete(socket);
    if (peers?.size === 0) sessions.delete(currentSession);
  });
});

server.listen(8788, '127.0.0.1', () => {
  console.log('Local realtime server listening on http://127.0.0.1:8788');
});
