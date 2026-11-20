import { useEffect, useState } from 'react';
import { TACTICAL_MAPS } from '../game/maps';
import { mpClient } from '../game/multiplayer';
import type { BattlegroupDeck, FactionId, RoomDetail, RoomSummary } from '../game/types';

interface MultiplayerLobbyProps {
  connected: boolean;
  playerId: string | null;
  playerName: string;
  onChangePlayerName: (name: string) => void;
  rooms: RoomSummary[];
  activeRoom: RoomDetail | null;
  errorMsg: string | null;
  activeDeck: BattlegroupDeck;
  selectedFaction: FactionId;
  initialRoomCode?: string;
  onBack: () => void;
}

export function MultiplayerLobby({
  connected,
  playerId,
  playerName,
  onChangePlayerName,
  rooms,
  activeRoom,
  errorMsg,
  activeDeck,
  selectedFaction,
  initialRoomCode,
  onBack,
}: MultiplayerLobbyProps) {
  const [joinCode, setJoinCode] = useState(initialRoomCode ?? '');
  const [roomName, setRoomName] = useState('Baltic Combined Arms');
  const [mapId, setMapId] = useState(TACTICAL_MAPS[0].id);
  const [maxPlayers, setMaxPlayers] = useState<2 | 4>(2);
  const [fillWithAI, setFillWithAI] = useState(true);
  const [chatDraft, setChatDraft] = useState('');
  const [copiedCode, setCopiedCode] = useState(false);

  useEffect(() => {
    if (connected && !activeRoom) {
      mpClient.requestRoomList();
    }
  }, [connected, activeRoom]);

  const handleCreateRoom = (e: React.FormEvent) => {
    e.preventDefault();
    mpClient.createRoom({
      playerName: playerName.trim() || 'Commander',
      roomName: roomName.trim() || 'Combined Arms Op',
      mapId,
      maxPlayers,
      fillWithAI,
      faction: selectedFaction,
      deck: activeDeck,
    });
  };

  const handleJoinByCode = (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = joinCode.trim().toUpperCase();
    if (!cleaned) return;
    mpClient.joinRoom(cleaned, playerName.trim() || 'Commander', activeDeck);
  };

  const handleSendChat = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = chatDraft.trim();
    if (!trimmed) return;
    mpClient.sendChat(trimmed);
    setChatDraft('');
  };

  const handleCopyInvite = () => {
    if (!activeRoom) return;
    const url = `${window.location.origin}${window.location.pathname}?room=${activeRoom.code}`;
    navigator.clipboard?.writeText(url).catch(() => {});
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  const me = activeRoom?.players.find((p) => p.id === playerId);
  const isHost = Boolean(me?.isHost);
  const bluePlayers = activeRoom?.players.filter((p) => p.team === 'blue') ?? [];
  const redPlayers = activeRoom?.players.filter((p) => p.team === 'red') ?? [];

  return (
    <main className="flex h-screen w-screen flex-col bg-[#0d1317] text-[#e6ecea] overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between gap-6 border-b border-white/10 bg-[#121a1f] px-8 py-4 shrink-0">
        <div>
          <h1 className="font-display text-3xl font-bold leading-none tracking-wide text-white">
            MULTIPLAYER OPERATIONS
          </h1>
          <p className="mt-1 text-xs text-[#94a8b3]">
            {connected
              ? 'Connected to live tactical server · Host a room or join with a 4-letter code'
              : 'Connecting to tactical multiplayer server...'}
          </p>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <label htmlFor="callsign-input" className="text-xs font-medium text-[#94a8b3]">
              Callsign
            </label>
            <input
              id="callsign-input"
              type="text"
              maxLength={22}
              value={playerName}
              onChange={(e) => onChangePlayerName(e.target.value)}
              disabled={Boolean(activeRoom)}
              className="w-40 rounded border border-white/15 bg-[#162026] px-2.5 py-1.5 text-sm font-medium text-white focus:border-[#60a5fa] focus:outline-none disabled:opacity-60"
            />
          </div>

          <button
            type="button"
            onClick={() => {
              if (activeRoom) mpClient.leaveRoom();
              onBack();
            }}
            className="rounded border border-white/15 bg-[#182228] px-4 py-2 text-sm font-medium text-[#d4dfe4] hover:bg-[#223038] whitespace-nowrap"
          >
            Back to Title
          </button>
        </div>
      </div>

      {errorMsg && (
        <div
          role="alert"
          className="border-b border-[#ef4444]/40 bg-[#2a1517] px-8 py-2.5 text-sm text-[#fecaca]"
        >
          {errorMsg}
        </div>
      )}

      {/* Room Staging View vs Room Browser */}
      {activeRoom ? (
        <div className="grid flex-1 grid-cols-1 overflow-hidden lg:grid-cols-12">
          {/* Left 8 cols: Teams & Settings */}
          <section className="flex flex-col justify-between overflow-y-auto p-8 lg:col-span-8">
            <div className="space-y-6">
              <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 pb-5">
                <div>
                  <div className="text-xs font-semibold tracking-wider text-[#94a8b3] uppercase">
                    Operation Room · {TACTICAL_MAPS.find((m) => m.id === activeRoom.mapId)?.name}
                  </div>
                  <h2 className="mt-1 font-display text-4xl font-bold text-white">
                    {activeRoom.name}
                  </h2>
                </div>

                <div className="flex items-center gap-3">
                  <div className="rounded border border-white/15 bg-[#141e24] px-4 py-2 text-center">
                    <div className="text-[11px] font-medium text-[#8ba0aa] uppercase">Room Code</div>
                    <div
                      data-testid="room-code"
                      className="font-mono-tabular text-2xl font-bold tracking-widest text-[#eab308]"
                    >
                      {activeRoom.code}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={handleCopyInvite}
                    className="rounded border border-white/15 bg-[#18242b] px-4 py-3 text-xs font-semibold text-white hover:bg-[#21313a] whitespace-nowrap"
                  >
                    {copiedCode ? 'Invite Link Copied' : 'Copy Invite Link'}
                  </button>
                </div>
              </div>

              {/* Blue vs Red Team Rosters */}
              <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                <div className="rounded border border-[#3b82f6]/35 bg-[#111b24] p-5">
                  <div className="flex items-center justify-between border-b border-white/10 pb-3">
                    <h3 className="font-display text-2xl font-bold text-[#60a5fa]">
                      COALITION (BLUE)
                    </h3>
                    <span className="font-mono-tabular text-xs text-[#94a8b3]">
                      {bluePlayers.length} / {activeRoom.maxPlayers / 2}
                    </span>
                  </div>
                  <ul className="mt-3 space-y-2">
                    {bluePlayers.map((p) => (
                      <li
                        key={p.id}
                        className="flex items-center justify-between rounded bg-[#162430] px-3 py-2.5 text-sm"
                      >
                        <div>
                          <span className="font-semibold text-white">{p.name}</span>
                          <span className="ml-2 text-xs text-[#8fa4ae]">
                            {p.isHost ? 'Host' : 'Player'} · {p.deck.name}
                          </span>
                        </div>
                        <span
                          className={`text-xs font-semibold ${
                            p.ready ? 'text-[#4ade80]' : 'text-[#94a8b3]'
                          }`}
                        >
                          {p.ready ? 'Ready' : 'Preparing'}
                        </span>
                      </li>
                    ))}
                    {bluePlayers.length === 0 && (
                      <li className="rounded border border-dashed border-white/10 px-3 py-3 text-xs text-[#8ba0aa]">
                        {activeRoom.fillWithAI
                          ? 'Coalition Command AI will fill this slot on launch'
                          : 'Waiting for Coalition commander...'}
                      </li>
                    )}
                  </ul>
                </div>

                <div className="rounded border border-[#ef4444]/35 bg-[#201417] p-5">
                  <div className="flex items-center justify-between border-b border-white/10 pb-3">
                    <h3 className="font-display text-2xl font-bold text-[#f87171]">
                      VANGUARD (RED)
                    </h3>
                    <span className="font-mono-tabular text-xs text-[#94a8b3]">
                      {redPlayers.length} / {activeRoom.maxPlayers / 2}
                    </span>
                  </div>
                  <ul className="mt-3 space-y-2">
                    {redPlayers.map((p) => (
                      <li
                        key={p.id}
                        className="flex items-center justify-between rounded bg-[#2b1a1e] px-3 py-2.5 text-sm"
                      >
                        <div>
                          <span className="font-semibold text-white">{p.name}</span>
                          <span className="ml-2 text-xs text-[#b59a9f]">
                            {p.isHost ? 'Host' : 'Player'} · {p.deck.name}
                          </span>
                        </div>
                        <span
                          className={`text-xs font-semibold ${
                            p.ready ? 'text-[#4ade80]' : 'text-[#94a8b3]'
                          }`}
                        >
                          {p.ready ? 'Ready' : 'Preparing'}
                        </span>
                      </li>
                    ))}
                    {redPlayers.length === 0 && (
                      <li className="rounded border border-dashed border-white/10 px-3 py-3 text-xs text-[#b89fa3]">
                        {activeRoom.fillWithAI
                          ? 'Vanguard Command AI will fill this slot on launch'
                          : 'Waiting for Vanguard opponent...'}
                      </li>
                    )}
                  </ul>
                </div>
              </div>

              {/* Host Configuration Controls */}
              {isHost && (
                <div className="flex flex-wrap items-center gap-6 rounded border border-white/10 bg-[#131c21] p-4">
                  <div className="flex items-center gap-3">
                    <label htmlFor="lobby-map-select" className="text-xs font-semibold text-[#94a8b3] uppercase">
                      Theater Map
                    </label>
                    <select
                      id="lobby-map-select"
                      value={activeRoom.mapId}
                      onChange={(e) => mpClient.setMap(e.target.value)}
                      className="rounded border border-white/15 bg-[#1a262d] px-3 py-1.5 text-sm text-white"
                    >
                      {TACTICAL_MAPS.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <label className="flex cursor-pointer items-center gap-2 text-sm text-[#cbd5e1]">
                    <input
                      type="checkbox"
                      checked={activeRoom.fillWithAI}
                      onChange={() => mpClient.toggleAI()}
                      className="h-4 w-4 accent-[#2563eb]"
                    />
                    Fill empty opposing side with AI Commander
                  </label>
                </div>
              )}
            </div>

            {/* Bottom Staging Action Bar */}
            <div className="mt-6 flex flex-wrap items-center justify-between gap-4 border-t border-white/10 pt-5">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => mpClient.leaveRoom()}
                  className="rounded border border-white/15 bg-[#182228] px-4 py-2.5 text-sm font-medium text-[#d4dfe4] hover:bg-[#223038]"
                >
                  Leave Room
                </button>
                <button
                  type="button"
                  onClick={() => mpClient.switchTeam()}
                  className="rounded border border-white/15 bg-[#182228] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#223038]"
                >
                  Switch Side
                </button>
                <button
                  type="button"
                  onClick={() => mpClient.toggleReady()}
                  className={`rounded px-4 py-2.5 text-sm font-semibold transition-colors ${
                    me?.ready
                      ? 'bg-[#166534] text-white hover:bg-[#15803d]'
                      : 'border border-white/15 bg-[#1b272e] text-white hover:bg-[#25353e]'
                  }`}
                >
                  {me?.ready ? 'Ready Confirmed' : 'Mark Ready'}
                </button>
              </div>

              {isHost ? (
                <button
                  type="button"
                  onClick={() => mpClient.startMatch()}
                  className="rounded bg-[#2563eb] px-7 py-3 font-display text-2xl font-bold tracking-wide text-white hover:bg-[#1d4ed8]"
                >
                  LAUNCH OPERATION
                </button>
              ) : (
                <span className="text-sm text-[#94a8b3]">Waiting for host to launch operation...</span>
              )}
            </div>
          </section>

          {/* Right 4 cols: Live Room Comms Chat */}
          <aside className="flex flex-col border-l border-white/10 bg-[#10171b] lg:col-span-4 overflow-hidden">
            <div className="border-b border-white/10 px-5 py-3.5 text-xs font-semibold tracking-wider text-[#94a8b3] uppercase">
              Operation Comms Net
            </div>
            <div className="flex-1 space-y-2.5 overflow-y-auto p-5 text-sm">
              {activeRoom.chat.map((m) => (
                <div key={m.id} className="leading-snug">
                  <span
                    className={`font-semibold ${
                      m.team === 'blue'
                        ? 'text-[#60a5fa]'
                        : m.team === 'red'
                        ? 'text-[#f87171]'
                        : 'text-[#eab308]'
                    }`}
                  >
                    {m.sender}:{' '}
                  </span>
                  <span className="text-[#d4dfe4]">{m.text}</span>
                </div>
              ))}
            </div>
            <form onSubmit={handleSendChat} className="flex gap-2 border-t border-white/10 p-4">
              <input
                type="text"
                placeholder="Send tactical message..."
                value={chatDraft}
                onChange={(e) => setChatDraft(e.target.value)}
                className="flex-1 rounded border border-white/15 bg-[#162026] px-3 py-2 text-sm text-white placeholder-[#6f838e] focus:border-[#60a5fa] focus:outline-none"
              />
              <button
                type="submit"
                className="rounded bg-[#2563eb] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1d4ed8]"
              >
                Send
              </button>
            </form>
          </aside>
        </div>
      ) : (
        <div className="grid flex-1 grid-cols-1 gap-8 overflow-y-auto p-8 lg:grid-cols-12">
          {/* Left 7 cols: Active Server Rooms + Join by Code */}
          <section className="space-y-6 lg:col-span-7">
            <form
              onSubmit={handleJoinByCode}
              className="flex flex-wrap items-end gap-3 rounded border border-white/12 bg-[#131c21] p-5"
            >
              <div className="flex-1 min-w-[200px]">
                <label
                  htmlFor="join-code-input"
                  className="block text-xs font-semibold tracking-wider text-[#94a8b3] uppercase"
                >
                  Join by Room Code
                </label>
                <input
                  id="join-code-input"
                  type="text"
                  maxLength={6}
                  placeholder="Enter 4-letter code (e.g. K7M4)"
                  value={joinCode}
                  onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                  className="mt-1.5 w-full rounded border border-white/15 bg-[#19242b] px-3.5 py-2.5 font-mono-tabular text-base font-semibold tracking-widest text-white uppercase placeholder-[#667a85] focus:border-[#60a5fa] focus:outline-none"
                />
              </div>
              <button
                type="submit"
                disabled={!connected || joinCode.trim().length < 3}
                className="rounded bg-[#2563eb] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#1d4ed8] disabled:opacity-45"
              >
                Join Room
              </button>
            </form>

            <div>
              <div className="flex items-center justify-between">
                <h2 className="font-display text-2xl font-bold tracking-wide text-white">
                  ACTIVE OPERATION ROOMS
                </h2>
                <button
                  type="button"
                  onClick={() => mpClient.requestRoomList()}
                  className="text-xs font-semibold text-[#60a5fa] hover:underline"
                >
                  Refresh List
                </button>
              </div>

              <div className="mt-3 space-y-2.5">
                {rooms.length === 0 ? (
                  <div className="rounded border border-dashed border-white/12 bg-[#11181c] p-8 text-center">
                    <p className="text-sm font-medium text-[#cbd5e1]">No open operation rooms yet</p>
                    <p className="mt-1 text-xs text-[#8499a3]">
                      Create an operation on the right and share the 4-letter room code with friends to play 1v1 PvP or 2v2 Co-op.
                    </p>
                  </div>
                ) : (
                  rooms.map((r) => (
                    <div
                      key={r.code}
                      className="flex items-center justify-between gap-4 rounded border border-white/12 bg-[#141d22] px-5 py-3.5"
                    >
                      <div>
                        <div className="flex items-center gap-2.5">
                          <span className="font-mono-tabular text-sm font-bold text-[#eab308]">
                            {r.code}
                          </span>
                          <span className="text-base font-semibold text-white">{r.name}</span>
                        </div>
                        <div className="mt-0.5 text-xs text-[#8ba0aa]">
                          {TACTICAL_MAPS.find((m) => m.id === r.mapId)?.name ?? r.mapId} ·{' '}
                          <span className="font-mono-tabular">
                            {r.playerCount}/{r.maxPlayers} players
                          </span>{' '}
                          · {r.status === 'lobby' ? 'Open Lobby' : 'In Combat'}
                        </div>
                      </div>
                      <button
                        type="button"
                        disabled={r.status !== 'lobby' || r.playerCount >= r.maxPlayers}
                        onClick={() =>
                          mpClient.joinRoom(r.code, playerName.trim() || 'Commander', activeDeck)
                        }
                        className="rounded bg-[#2563eb] px-4 py-2 text-xs font-semibold text-white hover:bg-[#1d4ed8] disabled:opacity-40"
                      >
                        {r.status === 'lobby' ? 'Join' : 'In Progress'}
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          </section>

          {/* Right 5 cols: Create Operation Room */}
          <section className="lg:col-span-5">
            <form
              onSubmit={handleCreateRoom}
              className="space-y-4 rounded border border-white/12 bg-[#131c21] p-6"
            >
              <h2 className="font-display text-2xl font-bold tracking-wide text-white">
                CREATE OPERATION ROOM
              </h2>

              <div>
                <label htmlFor="create-room-name" className="block text-xs font-semibold text-[#94a8b3] uppercase">
                  Operation Name
                </label>
                <input
                  id="create-room-name"
                  type="text"
                  maxLength={36}
                  value={roomName}
                  onChange={(e) => setRoomName(e.target.value)}
                  className="mt-1.5 w-full rounded border border-white/15 bg-[#19242b] px-3 py-2 text-sm text-white focus:border-[#60a5fa] focus:outline-none"
                />
              </div>

              <div>
                <label htmlFor="create-room-map" className="block text-xs font-semibold text-[#94a8b3] uppercase">
                  Theater Map
                </label>
                <select
                  id="create-room-map"
                  value={mapId}
                  onChange={(e) => setMapId(e.target.value)}
                  className="mt-1.5 w-full rounded border border-white/15 bg-[#19242b] px-3 py-2 text-sm text-white"
                >
                  {TACTICAL_MAPS.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name} ({m.region})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <span className="block text-xs font-semibold text-[#94a8b3] uppercase">
                  Match Format
                </span>
                <div className="mt-1.5 grid grid-cols-2 gap-2">
                  {([2, 4] as const).map((cap) => (
                    <button
                      key={cap}
                      type="button"
                      onClick={() => setMaxPlayers(cap)}
                      className={`rounded border px-3 py-2 text-sm font-semibold ${
                        maxPlayers === cap
                          ? 'border-[#3b82f6] bg-[#17283b] text-white'
                          : 'border-white/12 bg-[#182228] text-[#9ab0ba]'
                      }`}
                    >
                      {cap === 2 ? '1v1 Duel' : '2v2 Combined Arms'}
                    </button>
                  ))}
                </div>
              </div>

              <label className="flex cursor-pointer items-center gap-2.5 pt-1 text-sm text-[#cbd5e1]">
                <input
                  type="checkbox"
                  checked={fillWithAI}
                  onChange={(e) => setFillWithAI(e.target.checked)}
                  className="h-4 w-4 accent-[#2563eb]"
                />
                Fill empty opposing team with Tactical AI
              </label>

              <button
                type="submit"
                disabled={!connected}
                className="mt-2 w-full rounded bg-[#2563eb] py-3 font-display text-2xl font-bold tracking-wide text-white hover:bg-[#1d4ed8] disabled:opacity-45"
              >
                CREATE ROOM
              </button>
            </form>
          </section>
        </div>
      )}
    </main>
  );
}
