import type {
  BattlegroupDeck,
  ChatMessage,
  CombatEvent,
  FactionId,
  GameCommand,
  MatchState,
  RoomDetail,
  RoomSummary,
} from './types';

export type ServerMessage =
  | { type: 'session:init'; playerId: string; rooms: RoomSummary[] }
  | { type: 'rooms:list'; rooms: RoomSummary[] }
  | { type: 'room:joined'; room: RoomDetail }
  | { type: 'room:update'; room: RoomDetail }
  | { type: 'room:left' }
  | { type: 'chat:message'; message: ChatMessage }
  | { type: 'match:started'; room: RoomDetail; state: MatchState }
  | { type: 'match:state'; state: MatchState; events: CombatEvent[] }
  | { type: 'command:rejected'; error: string }
  | { type: 'error'; message: string };

type MessageListener = (msg: ServerMessage) => void;
type StatusListener = (connected: boolean) => void;

export class MultiplayerClient {
  private ws: WebSocket | null = null;
  private listeners = new Set<MessageListener>();
  private statusListeners = new Set<StatusListener>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private shouldReconnect = false;
  public playerId: string | null = null;
  public connected = false;

  public connect(): void {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }
    this.shouldReconnect = true;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${protocol}//${window.location.host}/ws`;

    try {
      const ws = new WebSocket(url);
      this.ws = ws;

      ws.onopen = () => {
        this.connected = true;
        this.statusListeners.forEach((fn) => fn(true));
      };

      ws.onmessage = (ev) => {
        try {
          const parsed = JSON.parse(String(ev.data)) as ServerMessage;
          if (parsed.type === 'session:init') {
            this.playerId = parsed.playerId;
          }
          this.listeners.forEach((fn) => fn(parsed));
        } catch {
          // ignore malformed messages
        }
      };

      ws.onclose = () => {
        this.connected = false;
        this.statusListeners.forEach((fn) => fn(false));
        this.ws = null;
        if (this.shouldReconnect) {
          this.reconnectTimer = setTimeout(() => this.connect(), 1800);
        }
      };

      ws.onerror = () => {
        // onclose handles reconnect
      };
    } catch {
      this.connected = false;
    }
  }

  public disconnect(): void {
    this.shouldReconnect = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.connected = false;
  }

  public onMessage(fn: MessageListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  public onStatus(fn: StatusListener): () => void {
    this.statusListeners.add(fn);
    return () => this.statusListeners.delete(fn);
  }

  private send(payload: Record<string, unknown>): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    }
  }

  public requestRoomList(): void {
    this.send({ type: 'rooms:list' });
  }

  public createRoom(params: {
    playerName: string;
    roomName: string;
    mapId: string;
    maxPlayers: number;
    fillWithAI: boolean;
    faction: FactionId;
    deck: BattlegroupDeck;
  }): void {
    this.send({ type: 'room:create', ...params });
  }

  public joinRoom(code: string, playerName: string, deck: BattlegroupDeck): void {
    this.send({ type: 'room:join', code, playerName, deck });
  }

  public leaveRoom(): void {
    this.send({ type: 'room:leave' });
  }

  public switchTeam(): void {
    this.send({ type: 'room:switch_team' });
  }

  public toggleReady(): void {
    this.send({ type: 'room:ready' });
  }

  public setMap(mapId: string): void {
    this.send({ type: 'room:set_map', mapId });
  }

  public toggleAI(): void {
    this.send({ type: 'room:toggle_ai' });
  }

  public startMatch(): void {
    this.send({ type: 'room:start' });
  }

  public rematch(): void {
    this.send({ type: 'room:rematch' });
  }

  public sendChat(text: string): void {
    this.send({ type: 'chat:send', text });
  }

  public sendCommand(command: GameCommand): void {
    this.send({ type: 'game:command', command });
  }
}

export const mpClient = new MultiplayerClient();
