import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';

function loadLocalEnv() {
  for (const file of ['.env', '.env.local']) {
    const filePath = path.join(process.cwd(), file);
    if (!fs.existsSync(filePath)) continue;
    const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
      const [rawKey, ...rawValue] = trimmed.split('=');
      const key = rawKey.trim();
      const value = rawValue.join('=').trim().replace(/^["']|["']$/g, '');
      if (key && process.env[key] === undefined) process.env[key] = value;
    }
  }
}

loadLocalEnv();

type Message = {
  type: 'create-session' | 'join' | 'speaker-text' | 'ping';
  sessionCode?: string;
  roomMode?: 'event' | 'personal';
  role?: 'host' | 'guest';
  text?: string;
  sourceLang?: string;
  targetLang?: string;
  translatedText?: string;
  sentAt?: number;
};

type GeminiInteractionResponse = {
  output_text?: string;
  steps?: Array<{
    content?: Array<{
      type?: string;
      text?: string;
    }>;
  }>;
  error?: { message?: string };
};

type RoomMode = 'event' | 'personal';
type RoomRole = 'host' | 'guest';

type RoomParticipant = {
  role: RoomRole;
};

type Room = {
  mode: RoomMode;
  participants: Map<WebSocket, RoomParticipant>;
};

const maxPersonalParticipants = 4;
const sessions = new Map<string, Room>();
const openAiModel = process.env.OPENAI_TRANSLATION_MODEL || 'gpt-4.1-mini';
const geminiModel = process.env.GEMINI_TRANSLATION_MODEL || 'gemini-3.5-flash';
const translationProvider = (process.env.TRANSLATION_PROVIDER || 'mock').toLowerCase();
const port = Number(process.env.PORT || 8788);
const host = process.env.HOST || '0.0.0.0';
const distDir = path.join(process.cwd(), 'dist');

function makeCode() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

function send(socket: WebSocket, message: Record<string, unknown>) {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
}

function broadcastRoomState(sessionCode: string, room: Room) {
  room.participants.forEach((_participant, peer) =>
    send(peer, {
      type: 'room-state',
      sessionCode,
      roomMode: room.mode,
      participantCount: room.participants.size,
      maxParticipants: room.mode === 'personal' ? maxPersonalParticipants : undefined,
      sentAt: Date.now(),
    }),
  );
}

function readJsonBody(request: http.IncomingMessage) {
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    let body = '';
    request.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1024 * 128) {
        reject(new Error('Request body too large'));
        request.destroy();
      }
    });
    request.on('end', () => {
      try {
        resolve(body ? (JSON.parse(body) as Record<string, unknown>) : {});
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
    request.on('error', reject);
  });
}

function cors(response: http.ServerResponse) {
  response.setHeader('access-control-allow-origin', '*');
  response.setHeader('access-control-allow-methods', 'GET,POST,OPTIONS');
  response.setHeader('access-control-allow-headers', 'content-type');
}

function sendJson(response: http.ServerResponse, status: number, payload: Record<string, unknown>) {
  cors(response);
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(payload));
}

function contentTypeFor(filePath: string) {
  const ext = path.extname(filePath);
  if (ext === '.html') return 'text/html; charset=utf-8';
  if (ext === '.js') return 'text/javascript; charset=utf-8';
  if (ext === '.css') return 'text/css; charset=utf-8';
  if (ext === '.json' || ext === '.webmanifest') return 'application/json; charset=utf-8';
  if (ext === '.svg') return 'image/svg+xml';
  if (ext === '.png') return 'image/png';
  if (ext === '.ico') return 'image/x-icon';
  return 'application/octet-stream';
}

function serveStatic(request: http.IncomingMessage, response: http.ServerResponse) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return false;
  if (!fs.existsSync(distDir)) return false;

  const requestUrl = new URL(request.url || '/', 'http://localhost');
  const safePath = path.normalize(decodeURIComponent(requestUrl.pathname)).replace(/^(\.\.[/\\])+/, '');
  const candidatePath = path.join(distDir, safePath === '/' ? 'index.html' : safePath);
  const filePath = candidatePath.startsWith(distDir) && fs.existsSync(candidatePath) && fs.statSync(candidatePath).isFile()
    ? candidatePath
    : path.join(distDir, 'index.html');

  if (!fs.existsSync(filePath)) return false;
  response.writeHead(200, { 'content-type': contentTypeFor(filePath) });
  if (request.method === 'HEAD') {
    response.end();
    return true;
  }
  fs.createReadStream(filePath).pipe(response);
  return true;
}

function languageName(value: unknown) {
  if (value === 'ko') return 'Korean';
  if (value === 'ja') return 'Japanese';
  if (value === 'en') return 'English';
  if (value === 'zh') return 'Chinese';
  return 'the source language';
}

async function translateWithOpenAi(payload: Record<string, unknown>) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      'OPENAI_API_KEY is not configured. ChatGPT Plus does not include API usage; set an API key only after approving API billing.',
    );
  }

  const text = String(payload.text ?? '').trim();
  if (!text) throw new Error('Text is required');

  const glossary = Array.isArray(payload.glossary)
    ? payload.glossary
        .slice(0, 30)
        .map((item) => {
          const term = item as { source?: string; target?: string };
          return term.source && term.target ? `${term.source}=>${term.target}` : '';
        })
        .filter(Boolean)
        .join(', ')
    : '';
  const recentContext = Array.isArray(payload.recentContext)
    ? payload.recentContext.slice(-6).join('\n')
    : '';

  const prompt = [
    `Translate immediately from ${languageName(payload.sourceLang)} to ${languageName(payload.targetLang)}.`,
    'Return only the translated utterance. No quotes, no notes, no explanations.',
    'Prefer natural spoken business interpretation over literal translation.',
    payload.briefing ? `Meeting context: ${String(payload.briefing).slice(0, 800)}` : '',
    glossary ? `Glossary: ${glossary}` : '',
    recentContext ? `Recent context:\n${recentContext}` : '',
    `Speech: ${text}`,
  ]
    .filter(Boolean)
    .join('\n\n');

  const apiResponse = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: openAiModel,
      input: prompt,
      max_output_tokens: 220,
      temperature: 0.2,
    }),
  });

  const data = (await apiResponse.json()) as {
    output_text?: string;
    error?: { message?: string };
  };
  if (!apiResponse.ok) {
    throw new Error(data.error?.message ?? `OpenAI API error ${apiResponse.status}`);
  }
  return data.output_text?.trim() ?? '';
}

function buildTranslationPrompt(payload: Record<string, unknown>) {
  const text = String(payload.text ?? '').trim();
  if (!text) throw new Error('Text is required');

  const glossary = Array.isArray(payload.glossary)
    ? payload.glossary
        .slice(0, 30)
        .map((item) => {
          const term = item as { source?: string; target?: string };
          return term.source && term.target ? `${term.source}=>${term.target}` : '';
        })
        .filter(Boolean)
        .join(', ')
    : '';
  const recentContext = Array.isArray(payload.recentContext)
    ? payload.recentContext.slice(-6).join('\n')
    : '';

  return [
    `Translate immediately from ${languageName(payload.sourceLang)} to ${languageName(payload.targetLang)}.`,
    'Return only the translated utterance. No quotes, no notes, no explanations.',
    'Prefer natural spoken business interpretation over literal translation.',
    'Use concise, polite, meeting-appropriate language.',
    'Translate the complete speech. Do not omit, summarize, or stop before the sentence is complete.',
    payload.briefing ? `Meeting context: ${String(payload.briefing).slice(0, 800)}` : '',
    glossary ? `Glossary: ${glossary}` : '',
    recentContext ? `Recent context:\n${recentContext}` : '',
    `Speech: ${text}`,
  ]
    .filter(Boolean)
    .join('\n\n');
}

async function translateWithGemini(payload: Record<string, unknown>) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured. Create a key in Google AI Studio and set it in .env.');
  }

  const prompt = buildTranslationPrompt(payload);
  const apiResponse = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
    method: 'POST',
    headers: {
      'x-goog-api-key': apiKey,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: geminiModel,
      input: prompt,
      system_instruction:
        'You are a low-latency Korean-Japanese business meeting interpreter. Output only the translation.',
      generation_config: {
        temperature: 0.2,
        max_output_tokens: 220,
        thinking_level: 'low',
      },
    }),
  });

  const data = (await apiResponse.json()) as GeminiInteractionResponse;
  if (!apiResponse.ok) {
    throw new Error(data.error?.message ?? `Gemini API error ${apiResponse.status}`);
  }
  const stepText =
    data.steps
      ?.flatMap((step) => step.content ?? [])
      .filter((content) => content.type === 'text' && content.text)
      .map((content) => content.text)
      .join('')
      .trim() ?? '';
  const translatedText = data.output_text?.trim() || stepText;
  if (!translatedText) {
    throw new Error('Gemini returned an empty translation response.');
  }
  return translatedText;
}

async function translateWithConfiguredProvider(payload: Record<string, unknown>) {
  if (translationProvider === 'gemini') {
    return { translatedText: await translateWithGemini(payload), provider: 'gemini', model: geminiModel };
  }
  if (translationProvider === 'openai' || translationProvider === 'gpt') {
    return { translatedText: await translateWithOpenAi(payload), provider: 'openai', model: openAiModel };
  }
  throw new Error('Server AI proxy is running, but TRANSLATION_PROVIDER is not gemini/openai/gpt.');
}

const server = http.createServer(async (request, response) => {
  cors(response);
  if (request.method === 'OPTIONS') {
    response.writeHead(204);
    response.end();
    return;
  }

  if (request.url === '/health') {
    sendJson(response, 200, {
      ok: true,
      translationProvider,
      geminiConfigured: Boolean(process.env.GEMINI_API_KEY),
      geminiModel,
      openaiConfigured: Boolean(process.env.OPENAI_API_KEY),
      openAiModel,
    });
    return;
  }

  if (request.url === '/api/translate' && request.method === 'POST') {
    try {
      const payload = await readJsonBody(request);
      sendJson(response, 200, await translateWithConfiguredProvider(payload));
    } catch (error) {
      console.error('Translation failed:', error);
      sendJson(response, 500, {
        error: error instanceof Error ? error.message : 'Translation failed',
        provider: translationProvider,
      });
    }
    return;
  }

  if (!serveStatic(request, response)) {
    response.writeHead(404);
    response.end();
  }
});

const wss = new WebSocketServer({ server });

wss.on('connection', (socket) => {
  let currentSession: string | undefined;

  socket.on('message', (data) => {
    const message = JSON.parse(String(data)) as Message;
    if (message.type === 'create-session') {
      currentSession = (message.sessionCode || makeCode()).toUpperCase();
      const roomMode = message.roomMode === 'personal' ? 'personal' : 'event';
      const role: RoomRole = roomMode === 'personal' ? 'host' : message.role === 'guest' ? 'guest' : 'host';
      const room: Room = {
        mode: roomMode,
        participants: new Map([[socket, { role }]]),
      };
      sessions.set(currentSession, room);
      send(socket, {
        type: 'session-created',
        sessionCode: currentSession,
        roomMode,
        role,
        participantCount: room.participants.size,
        maxParticipants: roomMode === 'personal' ? maxPersonalParticipants : undefined,
        sentAt: Date.now(),
      });
      broadcastRoomState(currentSession, room);
      return;
    }

    if (message.type === 'join' && message.sessionCode) {
      currentSession = message.sessionCode.toUpperCase();
      const existingRoom = sessions.get(currentSession);
      if (!existingRoom) {
        send(socket, {
          type: 'error',
          sessionCode: currentSession,
          message: '세션을 찾지 못했습니다. 호스트가 먼저 방을 생성해야 합니다.',
          sentAt: Date.now(),
        });
        return;
      }
      if (existingRoom.mode === 'personal' && existingRoom.participants.size >= maxPersonalParticipants) {
        send(socket, {
          type: 'error',
          sessionCode: currentSession,
          roomMode: existingRoom.mode,
          message: '개인 통역방은 호스트 포함 최대 4명까지만 입장할 수 있습니다.',
          sentAt: Date.now(),
        });
        return;
      }
      const role: RoomRole = existingRoom.mode === 'personal' ? 'guest' : message.role === 'host' ? 'host' : 'guest';
      existingRoom.participants.set(socket, { role });
      send(socket, {
        type: 'joined',
        sessionCode: currentSession,
        roomMode: existingRoom.mode,
        role,
        participantCount: existingRoom.participants.size,
        maxParticipants: existingRoom.mode === 'personal' ? maxPersonalParticipants : undefined,
        sentAt: Date.now(),
      });
      broadcastRoomState(currentSession, existingRoom);
      return;
    }

    if (message.type === 'speaker-text' && currentSession) {
      const room = sessions.get(currentSession);
      if (!room) return;
      room.participants.forEach((_participant, peer) => {
        if (room.mode === 'personal' && peer === socket) return;
        send(peer, {
          type: 'caption',
          sessionCode: currentSession,
          roomMode: room.mode,
          text: message.text,
          sourceLang: message.sourceLang,
          targetLang: message.targetLang,
          translatedText: message.translatedText,
          sentAt: Date.now(),
        });
      });
      return;
    }

    if (message.type === 'ping') send(socket, { type: 'pong', sentAt: Date.now() });
  });

  socket.on('close', () => {
    if (!currentSession) return;
    const room = sessions.get(currentSession);
    room?.participants.delete(socket);
    if (!room || room.participants.size === 0) {
      sessions.delete(currentSession);
      return;
    }
    room.participants.forEach((_participant, peer) =>
      send(peer, {
        type: 'peer-left',
        sessionCode: currentSession,
        roomMode: room.mode,
        participantCount: room.participants.size,
        maxParticipants: room.mode === 'personal' ? maxPersonalParticipants : undefined,
        sentAt: Date.now(),
      }),
    );
    broadcastRoomState(currentSession, room);
  });
});

server.listen(port, host, () => {
  console.log(`Realtime server listening on http://${host}:${port}`);
});
