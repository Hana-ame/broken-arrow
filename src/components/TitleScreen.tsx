import { useEffect, useState } from 'react';
import { TACTICAL_MAPS } from '../game/maps';
import type { BattlegroupDeck, FactionId } from '../game/types';

interface TitleScreenProps {
  selectedMapId: string;
  onSelectMap: (mapId: string) => void;
  selectedFaction: FactionId;
  onSelectFaction: (faction: FactionId) => void;
  activeDeck: BattlegroupDeck;
  onStartSkirmish: () => void;
  onOpenMultiplayer: () => void;
  onOpenDeckBuilder: () => void;
}

const KEY_ART_URL = './src/assets/images/title_key_art_1795203886857.jpg';

export function TitleScreen({
  selectedMapId,
  onSelectMap,
  selectedFaction,
  onSelectFaction,
  activeDeck,
  onStartSkirmish,
  onOpenMultiplayer,
  onOpenDeckBuilder,
}: TitleScreenProps) {
  const [imgFailed, setImgFailed] = useState(false);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        const tag = (e.target as HTMLElement | null)?.tagName;
        if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || tag === 'BUTTON') return;
        e.preventDefault();
        onStartSkirmish();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onStartSkirmish]);

  return (
    <main className="relative h-screen w-screen overflow-hidden bg-[#0c1114] text-[#e6ecea] select-none">
      {/* Full-bleed illustrated key-art backdrop */}
      {!imgFailed ? (
        <img
          src={KEY_ART_URL}
          alt="Armored column and attack helicopters advancing across a misty Baltic river valley"
          referrerPolicy="no-referrer"
          onError={() => setImgFailed(true)}
          className="absolute inset-0 h-full w-full object-cover object-right opacity-90"
        />
      ) : (
        <div className="absolute inset-0 bg-gradient-to-br from-[#141f24] via-[#1c2b27] to-[#0c1114]" />
      )}

      {/* Smooth directional scrim anchoring left negative space and blending horizon seamlessly */}
      <div
        aria-hidden="true"
        className="absolute inset-0"
        style={{
          background:
            'linear-gradient(95deg, #0b1013 0%, rgba(11,16,19,0.96) 28%, rgba(11,16,19,0.72) 48%, rgba(11,16,19,0.18) 76%, rgba(11,16,19,0.35) 100%)',
        }}
      />
      <div
        aria-hidden="true"
        className="absolute inset-x-0 bottom-0 h-32"
        style={{
          background: 'linear-gradient(0deg, rgba(11,16,19,0.95) 0%, rgba(11,16,19,0) 100%)',
        }}
      />

      {/* Left-third negative-space command composition */}
      <div className="relative z-10 flex h-full flex-col justify-between px-10 py-10 md:px-16 md:py-12">
        <div />

        <div className="max-w-lg space-y-8">
          {/* Custom inline SVG Broken Arrow Crest + Display Lockup */}
          <div className="space-y-3">
            <div className="flex items-center gap-4">
              <svg
                viewBox="0 0 64 64"
                className="h-14 w-14 shrink-0"
                aria-hidden="true"
              >
                <polygon
                  points="32,4 58,18 58,46 32,60 6,46 6,18"
                  fill="#121a1e"
                  stroke="#60a5fa"
                  strokeWidth="2.2"
                />
                <polygon
                  points="32,12 46,31 37,31 34,27 29,34 25,31"
                  fill="#e6ecea"
                />
                <polygon
                  points="31,37 38,33 38,51 26,51 26,41"
                  fill="#eab308"
                />
                <line
                  x1="18"
                  y1="38"
                  x2="46"
                  y2="29"
                  stroke="#0b1013"
                  strokeWidth="3.5"
                />
              </svg>
              <div>
                <h1 className="font-display text-6xl font-bold leading-none tracking-tight text-white md:text-7xl">
                  BROKEN ARROW
                </h1>
                <p className="mt-1.5 text-sm font-medium tracking-wide text-[#a8b8c0]">
                  Modern Combined-Arms Real-Time Tactical Warfare
                </p>
              </div>
            </div>
          </div>

          {/* Compact Theater & Faction Selection Strip */}
          <div className="grid grid-cols-1 gap-4 border-y border-white/10 py-5 sm:grid-cols-2">
            <div>
              <label
                htmlFor="theater-select"
                className="block text-xs font-semibold tracking-wider text-[#92a4ad] uppercase"
              >
                Theater Map
              </label>
              <select
                id="theater-select"
                value={selectedMapId}
                onChange={(e) => onSelectMap(e.target.value)}
                className="mt-1.5 w-full rounded bg-[#141d22] px-3 py-2 text-sm font-medium text-white border border-white/15 focus:border-[#60a5fa] focus:outline-none"
              >
                {TACTICAL_MAPS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <span className="block text-xs font-semibold tracking-wider text-[#92a4ad] uppercase">
                Command Faction
              </span>
              <div className="mt-1.5 grid grid-cols-2 gap-1.5 rounded bg-[#141d22] p-1 border border-white/15">
                <button
                  type="button"
                  onClick={() => onSelectFaction('coalition')}
                  className={`rounded px-2.5 py-1.5 text-xs font-semibold whitespace-nowrap transition-colors ${
                    selectedFaction === 'coalition'
                      ? 'bg-[#2563eb] text-white'
                      : 'text-[#9db0ba] hover:text-white'
                  }`}
                >
                  Coalition
                </button>
                <button
                  type="button"
                  onClick={() => onSelectFaction('vanguard')}
                  className={`rounded px-2.5 py-1.5 text-xs font-semibold whitespace-nowrap transition-colors ${
                    selectedFaction === 'vanguard'
                      ? 'bg-[#dc2626] text-white'
                      : 'text-[#9db0ba] hover:text-white'
                  }`}
                >
                  Vanguard
                </button>
              </div>
            </div>
          </div>

          {/* Primary Menu Actions (3 focused actions) */}
          <div className="flex flex-col gap-3 sm:max-w-sm">
            <button
              type="button"
              data-start="true"
              onClick={onStartSkirmish}
              className="flex items-center justify-between rounded bg-[#2563eb] px-6 py-3.5 text-left font-display text-2xl font-bold tracking-wide text-white transition-colors hover:bg-[#1d4ed8] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#60a5fa]"
            >
              <span>DEPLOY SKIRMISH</span>
              <span className="font-sans text-xs font-semibold tracking-wider text-blue-100 uppercase">
                Solo vs AI
              </span>
            </button>

            <button
              type="button"
              onClick={onOpenMultiplayer}
              className="flex items-center justify-between rounded bg-[#162026] px-6 py-3.5 text-left font-display text-2xl font-bold tracking-wide text-white border border-white/15 transition-colors hover:bg-[#1e2c34] hover:border-[#60a5fa]/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#60a5fa]"
            >
              <span>MULTIPLAYER LOBBY</span>
              <span className="font-sans text-xs font-semibold tracking-wider text-[#9db0ba] uppercase">
                PvP / Co-op
              </span>
            </button>

            <button
              type="button"
              onClick={onOpenDeckBuilder}
              className="flex items-center justify-between rounded bg-[#12191d] px-6 py-3 text-left font-display text-xl font-bold tracking-wide text-[#d4dfe4] border border-white/10 transition-colors hover:bg-[#1a252b] hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#60a5fa]"
            >
              <span>BATTLEGROUP DECK</span>
              <span className="font-sans text-xs font-medium text-[#8ba0aa] truncate max-w-[170px]">
                {activeDeck.name}
              </span>
            </button>
          </div>
        </div>

        {/* Single flat borderless control hint line */}
        <p className="text-xs font-medium tracking-wide text-[#8ea1ab]">
          Left-Drag Select · Right-Click Move or Attack · 1–6 Deploy Units · Q Attack-Move · F Artillery · G Smoke · WASD Pan · Wheel Zoom · Esc Pause
        </p>
      </div>
    </main>
  );
}
