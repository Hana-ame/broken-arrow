import { useCallback, useEffect, useRef, useState } from 'react';
import { BattlefieldView } from './components/BattlefieldView';
import { DeckBuilder } from './components/DeckBuilder';
import { MultiplayerLobby } from './components/MultiplayerLobby';
import { TitleScreen } from './components/TitleScreen';
import { createDefaultDeck, validateDeck } from './game/catalog';
import { createMatchState } from './game/engine';
import { TACTICAL_MAPS } from './game/maps';
import { mpClient } from './game/multiplayer';
import type {
  BattlegroupDeck,
  ChatMessage,
  CombatEvent,
  FactionId,
  MatchState,
  RoomDetail,
  RoomSummary,
} from './game/types';

type ScreenMode = 'title' | 'deck' | 'lobby' | 'playing';

const DECK_STORAGE_KEY = 'broken_arrow_decks_v1';

function loadSavedDecks(): Record<FactionId, BattlegroupDeck> {
  const defaults: Record<FactionId, BattlegroupDeck> = {
    coalition: createDefaultDeck('coalition'),
    vanguard: createDefaultDeck('vanguard'),
  };
  try {
    const raw = localStorage.getItem(DECK_STORAGE_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Partial<Record<FactionId, BattlegroupDeck>>;
    if (parsed.coalition && validateDeck(parsed.coalition).valid) {
      defaults.coalition = parsed.coalition;
    }
    if (parsed.vanguard && validateDeck(parsed.vanguard).valid) {
      defaults.vanguard = parsed.vanguard;
    }
  } catch {
    // ignore storage errors
  }
  return defaults;
}

export default function App() {
  const [screen, setScreen] = useState<ScreenMode>('title');
  const [selectedMapId, setSelectedMapId] = useState<string>(TACTICAL_MAPS[0].id);
  const [selectedFaction, setSelectedFaction] = useState<FactionId>('coalition');
  const [decks, setDecks] = useState<Record<FactionId, BattlegroupDeck>>(loadSavedDecks);

  // Solo match state
  const [soloMatch, setSoloMatch] = useState<MatchState | null>(null);
  const [matchMode, setMatchMode] = useState<'solo' | 'multiplayer'>('solo');

  // Multiplayer WebSocket state
  const [mpConnected, setMpConnected] = useState(false);
  const [mpPlayerId, setMpPlayerId] = useState<string | null>(null);
  const [playerName, setPlayerName] = useState(() => `Commander-${Math.floor(100 + Math.random() * 900)}`);
  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  const [activeRoom, setActiveRoom] = useState<RoomDetail | null>(null);
  const [mpError, setMpError] = useState<string | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [initialRoomCode, setInitialRoomCode] = useState<string | undefined>(undefined);

  const mpInitialMatchRef = useRef<MatchState | null>(null);
  const mpLiveStateRef = useRef<MatchState | null>(null);
  const mpLiveEventsRef = useRef<CombatEvent[]>([]);

  const activeDeck = decks[selectedFaction];

  const startSoloSkirmish = useCallback(() => {
    const enemyFaction: FactionId = selectedFaction === 'coalition' ? 'vanguard' : 'coalition';
    const match = createMatchState(`solo_${Date.now()}`, selectedMapId, [
      {
        id: 'human_p1',
        name: playerName,
        team: 'blue',
        faction: selectedFaction,
        isAI: false,
        deck: decks[selectedFaction],
      },
      {
        id: 'ai_enemy',
        name: enemyFaction === 'vanguard' ? 'Vanguard Command AI' : 'Coalition Command AI',
        team: 'red',
        faction: enemyFaction,
        isAI: true,
        deck: createDefaultDeck(enemyFaction),
      },
    ]);
    setMatchMode('solo');
    setSoloMatch(match);
    document.body.dataset.state = 'playing';
    setScreen('playing');
  }, [selectedFaction, selectedMapId, playerName, decks]);

  // Support ?autostart=1 and ?room=CODE query parameters on initial load
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('autostart') === '1') {
      startSoloSkirmish();
      return;
    }
    const roomParam = params.get('room');
    if (roomParam) {
      setInitialRoomCode(roomParam.toUpperCase());
      mpClient.connect();
      setScreen('lobby');
    } else {
      document.body.dataset.state = 'title';
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep body data-state accurate outside playing view
  useEffect(() => {
    if (screen !== 'playing') {
      document.body.dataset.state = 'title';
    }
  }, [screen]);

  // Subscribe to WebSocket server events
  useEffect(() => {
    const unsubStatus = mpClient.onStatus((conn) => {
      setMpConnected(conn);
      if (conn) setMpError(null);
    });

    const unsubMsg = mpClient.onMessage((msg) => {
      switch (msg.type) {
        case 'session:init':
          setMpPlayerId(msg.playerId);
          setRooms(msg.rooms);
          break;
        case 'rooms:list':
          setRooms(msg.rooms);
          break;
        case 'room:joined':
        case 'room:update':
          setActiveRoom(msg.room);
          setChatMessages(msg.room.chat);
          setMpError(null);
          break;
        case 'room:left':
          setActiveRoom(null);
          setChatMessages([]);
          break;
        case 'chat:message':
          setChatMessages((prev) => [...prev.slice(-49), msg.message]);
          setActiveRoom((prev) =>
            prev ? { ...prev, chat: [...prev.chat.slice(-49), msg.message] } : prev
          );
          break;
        case 'match:started':
          setActiveRoom(msg.room);
          mpInitialMatchRef.current = msg.state;
          mpLiveStateRef.current = msg.state;
          mpLiveEventsRef.current = [];
          setMatchMode('multiplayer');
          document.body.dataset.state = 'playing';
          setScreen('playing');
          break;
        case 'match:state':
          mpLiveStateRef.current = msg.state;
          if (msg.events.length > 0) {
            mpLiveEventsRef.current.push(...msg.events);
          }
          break;
        case 'error':
        case 'command:rejected':
          setMpError('message' in msg ? msg.message : msg.error);
          break;
      }
    });

    return () => {
      unsubStatus();
      unsubMsg();
    };
  }, []);

  const handleSaveDeck = (updated: BattlegroupDeck) => {
    setSelectedFaction(updated.faction);
    setDecks((prev) => {
      const next = { ...prev, [updated.faction]: updated };
      try {
        localStorage.setItem(DECK_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // ignore storage errors
      }
      return next;
    });
    setScreen('title');
  };

  if (screen === 'deck') {
    return (
      <DeckBuilder
        deck={activeDeck}
        onSave={handleSaveDeck}
        onBack={() => setScreen('title')}
      />
    );
  }

  if (screen === 'lobby') {
    return (
      <MultiplayerLobby
        connected={mpConnected}
        playerId={mpPlayerId}
        playerName={playerName}
        onChangePlayerName={setPlayerName}
        rooms={rooms}
        activeRoom={activeRoom}
        errorMsg={mpError}
        activeDeck={activeDeck}
        selectedFaction={selectedFaction}
        initialRoomCode={initialRoomCode}
        onBack={() => {
          setMpError(null);
          setScreen('title');
        }}
      />
    );
  }

  if (screen === 'playing') {
    const initialMatch = matchMode === 'solo' ? soloMatch : mpInitialMatchRef.current;
    const currentPlayerId = matchMode === 'solo' ? 'human_p1' : mpPlayerId ?? 'human_p1';

    if (initialMatch) {
      return (
        <BattlefieldView
          mode={matchMode}
          initialState={initialMatch}
          playerId={currentPlayerId}
          externalStateRef={mpLiveStateRef}
          externalEventsRef={mpLiveEventsRef}
          chatMessages={chatMessages}
          roomCode={matchMode === 'multiplayer' ? activeRoom?.code : undefined}
          onRestartSolo={startSoloSkirmish}
          onReturnToLobby={
            matchMode === 'multiplayer'
              ? () => {
                  mpClient.rematch();
                  setScreen('lobby');
                }
              : undefined
          }
          onExitToTitle={() => {
            if (matchMode === 'multiplayer') {
              mpClient.leaveRoom();
            }
            setScreen('title');
          }}
        />
      );
    }
  }

  return (
    <TitleScreen
      selectedMapId={selectedMapId}
      onSelectMap={setSelectedMapId}
      selectedFaction={selectedFaction}
      onSelectFaction={setSelectedFaction}
      activeDeck={activeDeck}
      onStartSkirmish={startSoloSkirmish}
      onOpenMultiplayer={() => {
        mpClient.connect();
        setScreen('lobby');
      }}
      onOpenDeckBuilder={() => setScreen('deck')}
    />
  );
}
