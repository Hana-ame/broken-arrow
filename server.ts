import express from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocket, WebSocketServer } from 'ws';
import { createDefaultDeck, validateDeck } from './src/game/catalog';
import { applyCommand, createMatchState, stepMatch } from './src/game/engine';
import { TACTICAL_MAPS } from './src/game/maps';
import type {
  BattlegroupDeck,
  ChatMessage,
  FactionId,
  GameCommand,
  LobbyPlayer,
  MatchState,
  RoomDetail,
  RoomSummary,
  TeamId,
} from './src/game/types';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface ClientSession {
  id: string;
  ws: WebSocket;
  roomCode: string | null;
}

interface GameRoom {
  code: string;
  name: string;
  mapId: string;
  maxPlayers: number;
  fillWithAI: boolean;
  status: 'lobby' | 'playing' | 'finished';
  players: LobbyPlayer[];
  chat: ChatMessage[];
  match: MatchState | null;
  interval: ReturnType<typeof setInterval> | null;
  createdAt: number;
}

const rooms = new Map<string, GameRoom>();
const sessions = new Map<string, ClientSession>();

let seq = 1;
function uid(prefix: string): string {
  seq += 1;
  return `${prefix}_${Date.now().toString(36)}_${seq}`;
}

function generateRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (let attempt = 0; attempt < 20; attempt++) {
    let code = '';
    for (let i = 0; i < 4; i++) {
      code += chars[Math.floor(Math.random() * chars.length)];
    }
    if (!rooms.has(code)) return code;
  }
  return `R${Date.now().toString(36).slice(-3).toUpperCase()}`;
}

function summarizeRoom(room: GameRoom): RoomSummary {
  return {
    code: room.code,
    name: room.name,
    mapId: room.mapId,
    playerCount: room.players.length,
    maxPlayers: room.maxPlayers,
    status: room.status,
    fillWithAI: room.fillWithAI,
  };
}

function detailRoom(room: GameRoom): RoomDetail {
  return {
    ...summarizeRoom(room),
    players: room.players,
    chat: room.chat.slice(-40),
  };
}

function sendJson(ws: WebSocket, payload: unknown): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function broadcastRoom(room: GameRoom, payload: unknown): void {
  const text = JSON.stringify(payload);
  for (const s of sessions.values()) {
    if (s.roomCode === room.code && s.ws.readyState === WebSocket.OPEN) {
      s.ws.send(text);
    }
  }
}

function broadcastRoomList(): void {
  const list = Array.from(rooms.values())
    .filter((r) => r.status !== 'finished')
    .map(summarizeRoom);
  const text = JSON.stringify({ type: 'rooms:list', rooms: list });
  for (const s of sessions.values()) {
    if (s.ws.readyState === WebSocket.OPEN) {
      s.ws.send(text);
    }
  }
}

function stopRoomLoop(room: GameRoom): void {
  if (room.interval) {
    clearInterval(room.interval);
    room.interval = null;
  }
}

function leaveCurrentRoom(session: ClientSession): void {
  if (!session.roomCode) return;
  const room = rooms.get(session.roomCode);
  session.roomCode = null;
  if (!room) return;

  const leaving = room.players.find((p) => p.id === session.id);
  room.players = room.players.filter((p) => p.id !== session.id);

  if (room.players.length === 0) {
    stopRoomLoop(room);
    rooms.delete(room.code);
    broadcastRoomList();
    return;
  }

  // Reassign host if host left
  if (!room.players.some((p) => p.isHost)) {
    room.players[0].isHost = true;
  }

  if (leaving) {
    room.chat.push({
      id: uid('msg'),
      sender: 'Command Net',
      text: `${leaving.name} left the operation.`,
      timestamp: Date.now(),
    });
  }

  broadcastRoom(room, { type: 'room:update', room: detailRoom(room) });
  broadcastRoomList();
}

function startRoomMatch(room: GameRoom): void {
  stopRoomLoop(room);
  const configs = room.players.map((p) => ({
    id: p.id,
    name: p.name,
    team: p.team,
    faction: p.faction,
    isAI: false,
    deck: p.deck,
  }));

  const blueCount = configs.filter((c) => c.team === 'blue').length;
  const redCount = configs.filter((c) => c.team === 'red').length;

  if (room.fillWithAI) {
    if (redCount === 0) {
      configs.push({
        id: `ai_red_${room.code}`,
        name: 'Vanguard Command AI',
        team: 'red',
        faction: 'vanguard',
        isAI: true,
        deck: createDefaultDeck('vanguard'),
      });
    }
    if (blueCount === 0) {
      configs.push({
        id: `ai_blue_${room.code}`,
        name: 'Coalition Command AI',
        team: 'blue',
        faction: 'coalition',
        isAI: true,
        deck: createDefaultDeck('coalition'),
      });
    }
  }

  room.match = createMatchState(`match_${room.code}_${Date.now()}`, room.mapId, configs);
  room.status = 'playing';

  broadcastRoom(room, {
    type: 'match:started',
    room: detailRoom(room),
    state: room.match,
  });
  broadcastRoomList();

  // Authoritative 10Hz simulation tick
  room.interval = setInterval(() => {
    if (!room.match) return;
    const events = stepMatch(room.match, 0.1);
    broadcastRoom(room, {
      type: 'match:state',
      state: room.match,
      events,
    });
    if (room.match.status !== 'playing') {
      room.status = 'finished';
      stopRoomLoop(room);
      broadcastRoom(room, { type: 'room:update', room: detailRoom(room) });
      broadcastRoomList();
    }
  }, 100);
}

async function bootstrap() {
  const app = express();
  app.use(express.json());

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, rooms: rooms.size });
  });

  app.get('/api/rooms', (_req, res) => {
    const list = Array.from(rooms.values())
      .filter((r) => r.status !== 'finished')
      .map(summarizeRoom);
    res.json({ rooms: list });
  });

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws) => {
    const session: ClientSession = {
      id: uid('pl'),
      ws,
      roomCode: null,
    };
    sessions.set(session.id, session);

    sendJson(ws, {
      type: 'session:init',
      playerId: session.id,
      rooms: Array.from(rooms.values())
        .filter((r) => r.status !== 'finished')
        .map(summarizeRoom),
    });

    ws.on('message', (raw) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }

      const type = String(msg.type ?? '');

      if (type === 'rooms:list') {
        sendJson(ws, {
          type: 'rooms:list',
          rooms: Array.from(rooms.values())
            .filter((r) => r.status !== 'finished')
            .map(summarizeRoom),
        });
        return;
      }

      if (type === 'room:create') {
        leaveCurrentRoom(session);
        const playerName = String(msg.playerName ?? 'Commander').trim().slice(0, 22) || 'Commander';
        const roomName = String(msg.roomName ?? `${playerName}'s Operation`).trim().slice(0, 36);
        const mapId = TACTICAL_MAPS.some((m) => m.id === msg.mapId)
          ? String(msg.mapId)
          : TACTICAL_MAPS[0].id;
        const maxPlayers = msg.maxPlayers === 4 ? 4 : 2;
        const fillWithAI = msg.fillWithAI !== false;
        const faction: FactionId = msg.faction === 'vanguard' ? 'vanguard' : 'coalition';
        const rawDeck = msg.deck as BattlegroupDeck | undefined;
        const deck = rawDeck && validateDeck(rawDeck).valid ? rawDeck : createDefaultDeck(faction);

        const code = generateRoomCode();
        const room: GameRoom = {
          code,
          name: roomName,
          mapId,
          maxPlayers,
          fillWithAI,
          status: 'lobby',
          players: [
            {
              id: session.id,
              name: playerName,
              team: 'blue',
              faction: deck.faction,
              ready: true,
              isHost: true,
              deck,
            },
          ],
          chat: [
            {
              id: uid('msg'),
              sender: 'Command Net',
              text: `Operation room ${code} created. Share code ${code} to invite commanders.`,
              timestamp: Date.now(),
            },
          ],
          match: null,
          interval: null,
          createdAt: Date.now(),
        };

        rooms.set(code, room);
        session.roomCode = code;
        sendJson(ws, { type: 'room:joined', room: detailRoom(room) });
        broadcastRoomList();
        return;
      }

      if (type === 'room:join') {
        const code = String(msg.code ?? '').trim().toUpperCase();
        const room = rooms.get(code);
        if (!room) {
          sendJson(ws, { type: 'error', message: `Room "${code}" not found.` });
          return;
        }
        if (room.status !== 'lobby') {
          sendJson(ws, { type: 'error', message: `Room ${code} is already in combat.` });
          return;
        }
        if (room.players.length >= room.maxPlayers) {
          sendJson(ws, { type: 'error', message: `Room ${code} is full.` });
          return;
        }

        leaveCurrentRoom(session);
        const playerName = String(msg.playerName ?? 'Commander').trim().slice(0, 22) || 'Commander';
        const blueCount = room.players.filter((p) => p.team === 'blue').length;
        const redCount = room.players.filter((p) => p.team === 'red').length;
        const team: TeamId = redCount < blueCount ? 'red' : 'blue';
        const defaultFaction: FactionId = team === 'blue' ? 'coalition' : 'vanguard';
        const rawDeck = msg.deck as BattlegroupDeck | undefined;
        const deck =
          rawDeck && validateDeck(rawDeck).valid ? rawDeck : createDefaultDeck(defaultFaction);

        room.players.push({
          id: session.id,
          name: playerName,
          team,
          faction: deck.faction,
          ready: false,
          isHost: false,
          deck,
        });
        room.chat.push({
          id: uid('msg'),
          sender: 'Command Net',
          text: `${playerName} joined ${team === 'blue' ? 'Blue Coalition' : 'Red Vanguard'}.`,
          timestamp: Date.now(),
        });

        session.roomCode = code;
        sendJson(ws, { type: 'room:joined', room: detailRoom(room) });
        broadcastRoom(room, { type: 'room:update', room: detailRoom(room) });
        broadcastRoomList();
        return;
      }

      if (type === 'room:leave') {
        leaveCurrentRoom(session);
        sendJson(ws, { type: 'room:left' });
        return;
      }

      const room = session.roomCode ? rooms.get(session.roomCode) : undefined;
      if (!room) return;
      const lobbyPlayer = room.players.find((p) => p.id === session.id);
      if (!lobbyPlayer) return;

      if (type === 'room:switch_team' && room.status === 'lobby') {
        const nextTeam: TeamId = lobbyPlayer.team === 'blue' ? 'red' : 'blue';
        const nextFaction: FactionId = nextTeam === 'blue' ? 'coalition' : 'vanguard';
        lobbyPlayer.team = nextTeam;
        lobbyPlayer.faction = nextFaction;
        lobbyPlayer.deck = createDefaultDeck(nextFaction);
        broadcastRoom(room, { type: 'room:update', room: detailRoom(room) });
        return;
      }

      if (type === 'room:ready' && room.status === 'lobby') {
        lobbyPlayer.ready = !lobbyPlayer.ready;
        broadcastRoom(room, { type: 'room:update', room: detailRoom(room) });
        return;
      }

      if (type === 'room:set_map' && room.status === 'lobby' && lobbyPlayer.isHost) {
        if (TACTICAL_MAPS.some((m) => m.id === msg.mapId)) {
          room.mapId = String(msg.mapId);
          broadcastRoom(room, { type: 'room:update', room: detailRoom(room) });
          broadcastRoomList();
        }
        return;
      }

      if (type === 'room:toggle_ai' && room.status === 'lobby' && lobbyPlayer.isHost) {
        room.fillWithAI = !room.fillWithAI;
        broadcastRoom(room, { type: 'room:update', room: detailRoom(room) });
        broadcastRoomList();
        return;
      }

      if (type === 'room:start' && room.status === 'lobby' && lobbyPlayer.isHost) {
        startRoomMatch(room);
        return;
      }

      if (type === 'room:rematch' && room.status === 'finished' && lobbyPlayer.isHost) {
        room.status = 'lobby';
        room.match = null;
        broadcastRoom(room, { type: 'room:update', room: detailRoom(room) });
        broadcastRoomList();
        return;
      }

      if (type === 'chat:send') {
        const text = String(msg.text ?? '').trim().slice(0, 180);
        if (!text) return;
        const chatMsg: ChatMessage = {
          id: uid('msg'),
          sender: lobbyPlayer.name,
          team: lobbyPlayer.team,
          text,
          timestamp: Date.now(),
        };
        room.chat.push(chatMsg);
        if (room.chat.length > 60) room.chat.shift();
        broadcastRoom(room, { type: 'chat:message', message: chatMsg });
        return;
      }

      if (type === 'game:command' && room.status === 'playing' && room.match) {
        const cmd = msg.command as GameCommand | undefined;
        if (!cmd || typeof cmd.type !== 'string') return;
        const result = applyCommand(room.match, session.id, cmd);
        if (!result.ok && result.error) {
          sendJson(ws, { type: 'command:rejected', error: result.error });
        }
        return;
      }
    });

    ws.on('close', () => {
      leaveCurrentRoom(session);
      sessions.delete(session.id);
    });
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  const port = Number(process.env.PORT) || 3000;
  server.listen(port, '0.0.0.0', () => {
    console.log(`Broken Arrow Tactical Command server listening on http://localhost:${port}`);
  });
}

bootstrap();
