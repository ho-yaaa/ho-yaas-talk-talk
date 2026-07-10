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
const openAiModel = process.env.OPENAI_TRANSLATION_MODEL || 'gpt-4.1-mini';

function makeCode() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

function send(socket: WebSocket, message: Record<string, unknown>) {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
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
      openaiConfigured: Boolean(process.env.OPENAI_API_KEY),
      openAiModel,
    });
    return;
  }

  if (request.url === '/api/translate' && request.method === 'POST') {
    try {
      const payload = await readJsonBody(request);
      const translatedText = await translateWithOpenAi(payload);
      sendJson(response, 200, { translatedText, provider: 'openai', model: openAiModel });
    } catch (error) {
      sendJson(response, 500, {
        error: error instanceof Error ? error.message : 'Translation failed',
        provider: 'openai',
      });
    }
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
