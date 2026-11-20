import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Volume2, VolumeX, Pause, MessageSquare, Crosshair, Flame, Shield, EyeOff, Undo2, MapPin } from 'lucide-react';
import { tacticalAudio } from '../game/audio';
import { CATEGORIES, getFactionUnits, UNIT_BY_ID } from '../game/catalog';
import { applyCommand, stepMatch } from '../game/engine';
import { getMapById } from '../game/maps';
import { mpClient } from '../game/multiplayer';
import { CameraState, RenderInteractionOverlay, TacticalRenderer } from '../game/renderer';
import type {
  ChatMessage,
  CombatEvent,
  GameCommand,
  MatchState,
  TeamId,
  UnitCategory,
  UnitState,
  Vec2,
} from '../game/types';

interface BattlefieldViewProps {
  mode: 'solo' | 'multiplayer';
  initialState: MatchState;
  playerId: string;
  externalStateRef: React.MutableRefObject<MatchState | null>;
  externalEventsRef: React.MutableRefObject<CombatEvent[]>;
  chatMessages: ChatMessage[];
  roomCode?: string;
  onRestartSolo: () => void;
  onExitToTitle: () => void;
  onReturnToLobby?: () => void;
}

type CommandMode = RenderInteractionOverlay['commandMode'];

interface HudSnapshot {
  blueVp: number;
  redVp: number;
  vpTarget: number;
  elapsedSec: number;
  durationSec: number;
  requisition: number;
  incomePerSec: number;
  airstrikeCooldown: number;
  stock: Record<string, number>;
  zones: { code: string; owner: TeamId | 'neutral'; contested: boolean }[];
  selectedUnits: {
    id: string;
    templateId: string;
    hp: number;
    maxHp: number;
    ammoSummary: string;
    apsCharges: number;
    smokeCharges: number;
    holdFire: boolean;
    inCover: boolean;
    hasIndirect: boolean;
  }[];
  status: MatchState['status'];
  winReason?: string;
  unitsDestroyed: number;
  unitsLost: number;
  damageDealt: number;
}

function formatClock(seconds: number): string {
  const clamped = Math.max(0, Math.floor(seconds));
  const m = Math.floor(clamped / 60);
  const s = clamped % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function BattlefieldView({
  mode,
  initialState,
  playerId,
  externalStateRef,
  externalEventsRef,
  chatMessages,
  roomCode,
  onRestartSolo,
  onExitToTitle,
  onReturnToLobby,
}: BattlefieldViewProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const minimapRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const matchRef = useRef<MatchState>(initialState);
  const rendererRef = useRef<TacticalRenderer>(new TacticalRenderer());

  const myInitialPlayer = initialState.players[playerId];
  const viewerTeam: TeamId = myInitialPlayer?.team ?? 'blue';
  const viewerFaction = myInitialPlayer?.faction ?? 'coalition';

  const cameraRef = useRef<CameraState>({
    x: viewerTeam === 'blue' ? 760 : 1640,
    y: 750,
    zoom: 0.78,
    shakeTrauma: 0,
  });

  const selectedIdsRef = useRef<Set<string>>(new Set());
  const dragBoxRef = useRef<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
  const isPanningRef = useRef(false);
  const panAnchorRef = useRef<Vec2>({ x: 0, y: 0 });
  const keysHeldRef = useRef<Set<string>>(new Set());
  const cursorWorldRef = useRef<Vec2 | null>(null);
  const commandModeRef = useRef<CommandMode>('normal');
  const deployTemplateRef = useRef<string | null>(null);
  const pausedRef = useRef(false);
  const outcomePlayedRef = useRef(false);

  const [paused, setPaused] = useState(false);
  const [muted, setMuted] = useState(false);
  const [activeCategory, setActiveCategory] = useState<UnitCategory>('armor');
  const [commandMode, setCommandModeState] = useState<CommandMode>('normal');
  const [deployTemplateId, setDeployTemplateIdState] = useState<string | null>(null);
  const [commsOpen, setCommsOpen] = useState(false);
  const [chatDraft, setChatDraft] = useState('');
  const [statusNotice, setStatusNotice] = useState<string | null>(null);

  const setCommandMode = useCallback((nextMode: CommandMode, tplId: string | null = null) => {
    commandModeRef.current = nextMode;
    deployTemplateRef.current = tplId;
    setCommandModeState(nextMode);
    setDeployTemplateIdState(tplId);
  }, []);

  const flashNotice = useCallback((msg: string) => {
    setStatusNotice(msg);
    setTimeout(() => {
      setStatusNotice((curr) => (curr === msg ? null : curr));
    }, 2400);
  }, []);

  const buildHudSnapshot = useCallback(
    (state: MatchState): HudSnapshot => {
      const p = state.players[playerId];
      const selUnits = state.units
        .filter((u) => u.alive && selectedIdsRef.current.has(u.id))
        .map((u) => {
          const tpl = UNIT_BY_ID[u.templateId];
          const primaryAmmo = tpl && tpl.weapons.length > 0 ? `${u.ammo[0]}/${tpl.weapons[0].maxAmmo}` : 'LOGI';
          return {
            id: u.id,
            templateId: u.templateId,
            hp: Math.round(u.hp),
            maxHp: u.maxHp,
            ammoSummary: primaryAmmo,
            apsCharges: u.apsCharges,
            smokeCharges: u.smokeCharges,
            holdFire: u.holdFire,
            inCover: u.inCover,
            hasIndirect: Boolean(tpl?.weapons.some((w) => w.indirect)),
          };
        });

      return {
        blueVp: Math.round(state.blueVp),
        redVp: Math.round(state.redVp),
        vpTarget: state.vpTarget,
        elapsedSec: state.elapsedSec,
        durationSec: state.durationSec,
        requisition: Math.round(p?.requisition ?? 0),
        incomePerSec: p?.incomePerSec ?? 0,
        airstrikeCooldown: p?.airstrikeCooldown ?? 0,
        stock: { ...(p?.stock ?? {}) },
        zones: state.zones.map((z) => ({ code: z.code, owner: z.owner, contested: z.contested })),
        selectedUnits: selUnits,
        status: state.status,
        winReason: state.winReason,
        unitsDestroyed: p?.unitsDestroyed ?? 0,
        unitsLost: p?.unitsLost ?? 0,
        damageDealt: Math.round(p?.damageDealt ?? 0),
      };
    },
    [playerId]
  );

  const [hud, setHud] = useState<HudSnapshot>(() => buildHudSnapshot(initialState));

  // Sync matchRef when initialState changes (e.g. solo restart)
  useEffect(() => {
    matchRef.current = initialState;
    selectedIdsRef.current.clear();
    outcomePlayedRef.current = false;
    pausedRef.current = false;
    setPaused(false);
    setCommandMode('normal', null);
    cameraRef.current = {
      x: viewerTeam === 'blue' ? 760 : 1640,
      y: 750,
      zoom: 0.78,
      shakeTrauma: 0,
    };
    setHud(buildHudSnapshot(initialState));
  }, [initialState, viewerTeam, buildHudSnapshot, setCommandMode]);

  // Sync document.body.dataset.state for game shell discipline
  useEffect(() => {
    if (hud.status !== 'playing') {
      document.body.dataset.state = 'gameover';
      if (!outcomePlayedRef.current) {
        outcomePlayedRef.current = true;
        const won =
          (viewerTeam === 'blue' && hud.status === 'victory_blue') ||
          (viewerTeam === 'red' && hud.status === 'victory_red');
        tacticalAudio.playOutcome(won);
      }
    } else if (paused) {
      document.body.dataset.state = 'paused';
    } else {
      document.body.dataset.state = 'playing';
    }
  }, [hud.status, paused, viewerTeam]);

  const dispatchCommand = useCallback(
    (cmd: GameCommand) => {
      if (mode === 'multiplayer') {
        mpClient.sendCommand(cmd);
        tacticalAudio.playOrderConfirm();
      } else {
        const res = applyCommand(matchRef.current, playerId, cmd);
        if (res.ok) {
          tacticalAudio.playOrderConfirm();
          setHud(buildHudSnapshot(matchRef.current));
        } else if (res.error) {
          flashNotice(res.error);
        }
      }
    },
    [mode, playerId, buildHudSnapshot, flashNotice]
  );

  const screenToWorld = useCallback((clientX: number, clientY: number): Vec2 => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const sx = clientX - rect.left;
    const sy = clientY - rect.top;
    const cam = cameraRef.current;
    return {
      x: (sx - rect.width * 0.5) / cam.zoom + cam.x,
      y: (sy - rect.height * 0.5) / cam.zoom + cam.y,
    };
  }, []);

  // Main 60 FPS animation + clamped simulation loop mounted once
  useEffect(() => {
    let rafId = 0;
    let lastTs = performance.now();
    let hudAccumulator = 0;
    let frameCount = 0;

    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const getDpr = () => Math.min(window.devicePixelRatio || 1, 1.5);

    const syncCanvasSize = () => {
      const rect = container.getBoundingClientRect();
      const dpr = getDpr();
      canvas.width = Math.max(1, Math.floor(rect.width * dpr));
      canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    };
    syncCanvasSize();
    const ro = new ResizeObserver(syncCanvasSize);
    ro.observe(container);

    const frame = (now: number) => {
      const rawDt = (now - lastTs) / 1000;
      lastTs = now;
      const dt = Math.min(Math.max(rawDt, 0.001), 0.05);
      frameCount += 1;

      // Pull latest authoritative state in multiplayer
      if (mode === 'multiplayer' && externalStateRef.current) {
        matchRef.current = externalStateRef.current;
        if (externalEventsRef.current.length > 0) {
          const evs = externalEventsRef.current.splice(0, externalEventsRef.current.length);
          rendererRef.current.ingestEvents(evs, cameraRef.current);
          evs.forEach((ev) => tacticalAudio.playCombatEvent(ev));
        }
      } else if (mode === 'solo' && !pausedRef.current && matchRef.current.status === 'playing') {
        const events = stepMatch(matchRef.current, dt);
        if (events.length > 0) {
          rendererRef.current.ingestEvents(events, cameraRef.current);
          events.forEach((ev) => tacticalAudio.playCombatEvent(ev));
        }
      }

      // Smooth keyboard camera panning
      const keys = keysHeldRef.current;
      const map = getMapById(matchRef.current.mapId);
      const cam = cameraRef.current;
      const panSpeed = 620 / cam.zoom;
      if (keys.has('KeyW') || keys.has('ArrowUp')) cam.y -= panSpeed * dt;
      if (keys.has('KeyS') || keys.has('ArrowDown')) cam.y += panSpeed * dt;
      if (keys.has('KeyA') || keys.has('ArrowLeft')) cam.x -= panSpeed * dt;
      if (keys.has('KeyD') || keys.has('ArrowRight')) cam.x += panSpeed * dt;
      cam.x = Math.max(120, Math.min(map.width - 120, cam.x));
      cam.y = Math.max(100, Math.min(map.height - 100, cam.y));

      rendererRef.current.stepEffects(dt, cam);

      // Render main battlefield canvas
      const dpr = getDpr();
      const cssW = canvas.width / dpr;
      const cssH = canvas.height / dpr;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.save();
        ctx.scale(dpr, dpr);
        rendererRef.current.renderBattlefield(ctx, cssW, cssH, matchRef.current, cam, {
          selectedIds: selectedIdsRef.current,
          dragBox: dragBoxRef.current,
          commandMode: commandModeRef.current,
          cursorWorld: cursorWorldRef.current,
          deployTemplateId: deployTemplateRef.current,
          viewerTeam,
        });
        ctx.restore();
      }

      // Render tactical minimap every 3rd frame (~20Hz)
      if (frameCount % 3 === 1) {
        const mini = minimapRef.current;
        if (mini) {
          const mctx = mini.getContext('2d');
          if (mctx) {
            rendererRef.current.renderMinimap(
              mctx,
              mini.width,
              mini.height,
              matchRef.current,
              cam,
              cssW,
              cssH,
              viewerTeam
            );
          }
        }
      }

      // Throttled HUD React reconciliation (~5Hz)
      hudAccumulator += dt;
      if (hudAccumulator >= 0.2) {
        hudAccumulator = 0;
        setHud(buildHudSnapshot(matchRef.current));
      }

      rafId = requestAnimationFrame(frame);
    };

    rafId = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(rafId);
      ro.disconnect();
    };
  }, [mode, viewerTeam, externalStateRef, externalEventsRef, buildHudSnapshot]);

  // Unified keyboard shortcuts & focus-loss release hygiene
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const targetTag = (e.target as HTMLElement | null)?.tagName;
      if (targetTag === 'INPUT' || targetTag === 'TEXTAREA') return;

      if (e.code === 'Escape') {
        e.preventDefault();
        if (commandModeRef.current !== 'normal') {
          setCommandMode('normal', null);
        } else if (matchRef.current.status === 'playing') {
          pausedRef.current = !pausedRef.current;
          setPaused(pausedRef.current);
        }
        return;
      }

      if (e.code === 'KeyP') {
        e.preventDefault();
        if (matchRef.current.status === 'playing') {
          pausedRef.current = !pausedRef.current;
          setPaused(pausedRef.current);
        }
        return;
      }

      if (e.code === 'KeyM') {
        e.preventDefault();
        const nextMuted = !tacticalAudio.isMuted();
        tacticalAudio.setMuted(nextMuted);
        setMuted(nextMuted);
        return;
      }

      keysHeldRef.current.add(e.code);

      if (e.repeat) return;

      // Category tabs 1-6
      const digitMap: Record<string, UnitCategory> = {
        Digit1: 'recon',
        Digit2: 'infantry',
        Digit3: 'armor',
        Digit4: 'support',
        Digit5: 'helicopters',
        Digit6: 'air',
      };
      if (digitMap[e.code]) {
        setActiveCategory(digitMap[e.code]);
        return;
      }

      if (e.code === 'KeyQ' && selectedIdsRef.current.size > 0) {
        setCommandMode('attack_move', null);
      } else if (e.code === 'KeyF' && selectedIdsRef.current.size > 0) {
        setCommandMode('barrage', null);
      } else if (e.code === 'KeyG' && selectedIdsRef.current.size > 0) {
        dispatchCommand({ type: 'smoke', unitIds: Array.from(selectedIdsRef.current) });
      } else if (e.code === 'KeyH' && selectedIdsRef.current.size > 0) {
        dispatchCommand({ type: 'toggle_hold_fire', unitIds: Array.from(selectedIdsRef.current) });
      } else if (e.code === 'KeyR' && selectedIdsRef.current.size > 0) {
        dispatchCommand({ type: 'retreat', unitIds: Array.from(selectedIdsRef.current) });
      } else if (e.code === 'KeyT') {
        setCommandMode('ping', null);
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      keysHeldRef.current.delete(e.code);
    };

    const clearHeld = () => {
      keysHeldRef.current.clear();
      isPanningRef.current = false;
      dragBoxRef.current = null;
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', clearHeld);
    document.addEventListener('visibilitychange', clearHeld);

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', clearHeld);
      document.removeEventListener('visibilitychange', clearHeld);
    };
  }, [dispatchCommand, setCommandMode]);

  // Canvas mouse interaction handlers
  const handleCanvasMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const world = screenToWorld(e.clientX, e.clientY);
    const rect = e.currentTarget.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;

    if (e.button === 1) {
      e.preventDefault();
      isPanningRef.current = true;
      panAnchorRef.current = { x: e.clientX, y: e.clientY };
      return;
    }

    if (e.button === 2) {
      e.preventDefault();
      if (commandModeRef.current !== 'normal') {
        setCommandMode('normal', null);
        return;
      }
      const selected = Array.from(selectedIdsRef.current);
      if (selected.length === 0) return;

      // Check if right-clicked on a spotted enemy unit
      const clickedEnemy = matchRef.current.units.find(
        (u) =>
          u.alive &&
          u.team !== viewerTeam &&
          u.spottedByEnemy &&
          Math.hypot(u.x - world.x, u.y - world.y) <= 28
      );
      if (clickedEnemy) {
        dispatchCommand({
          type: 'attack_target',
          unitIds: selected,
          targetUnitId: clickedEnemy.id,
        });
      } else {
        dispatchCommand({ type: 'move', unitIds: selected, targetPos: world });
      }
      return;
    }

    if (e.button === 0) {
      // Armed command modes
      if (commandModeRef.current === 'deploy' && deployTemplateRef.current) {
        dispatchCommand({
          type: 'deploy',
          templateId: deployTemplateRef.current,
          targetPos: world,
        });
        setCommandMode('normal', null);
        return;
      }
      if (commandModeRef.current === 'airstrike' && deployTemplateRef.current) {
        dispatchCommand({
          type: 'airstrike',
          templateId: deployTemplateRef.current,
          targetPos: world,
        });
        setCommandMode('normal', null);
        return;
      }
      if (commandModeRef.current === 'attack_move' && selectedIdsRef.current.size > 0) {
        dispatchCommand({
          type: 'attack_move',
          unitIds: Array.from(selectedIdsRef.current),
          targetPos: world,
        });
        setCommandMode('normal', null);
        return;
      }
      if (commandModeRef.current === 'barrage' && selectedIdsRef.current.size > 0) {
        dispatchCommand({
          type: 'barrage',
          unitIds: Array.from(selectedIdsRef.current),
          targetPos: world,
        });
        setCommandMode('normal', null);
        return;
      }
      if (commandModeRef.current === 'ping') {
        dispatchCommand({ type: 'ping', targetPos: world, label: 'Priority Target' });
        setCommandMode('normal', null);
        return;
      }

      // Start box selection
      dragBoxRef.current = { x1: sx, y1: sy, x2: sx, y2: sy };
    }
  };

  const handleCanvasMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    cursorWorldRef.current = screenToWorld(e.clientX, e.clientY);

    if (isPanningRef.current) {
      const dx = (e.clientX - panAnchorRef.current.x) / cameraRef.current.zoom;
      const dy = (e.clientY - panAnchorRef.current.y) / cameraRef.current.zoom;
      cameraRef.current.x -= dx;
      cameraRef.current.y -= dy;
      panAnchorRef.current = { x: e.clientX, y: e.clientY };
      return;
    }

    if (dragBoxRef.current) {
      const rect = e.currentTarget.getBoundingClientRect();
      dragBoxRef.current = {
        ...dragBoxRef.current,
        x2: e.clientX - rect.left,
        y2: e.clientY - rect.top,
      };
    }
  };

  const handleCanvasMouseUp = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (e.button === 1) {
      isPanningRef.current = false;
      return;
    }
    if (e.button === 0 && dragBoxRef.current) {
      const box = dragBoxRef.current;
      dragBoxRef.current = null;
      const rect = e.currentTarget.getBoundingClientRect();
      const dragDist = Math.hypot(box.x2 - box.x1, box.y2 - box.y1);

      const nextSet = e.shiftKey ? new Set(selectedIdsRef.current) : new Set<string>();
      const myUnits = matchRef.current.units.filter(
        (u) => u.alive && u.ownerId === playerId && u.altitude < 2
      );

      if (dragDist < 8) {
        // Point click select
        const world = screenToWorld(e.clientX, e.clientY);
        let closest: UnitState | null = null;
        let closestD = 30;
        for (const u of myUnits) {
          const d = Math.hypot(u.x - world.x, u.y - world.y);
          if (d < closestD) {
            closestD = d;
            closest = u;
          }
        }
        if (closest) nextSet.add(closest.id);
      } else {
        // Box drag select
        const p1 = screenToWorld(rect.left + Math.min(box.x1, box.x2), rect.top + Math.min(box.y1, box.y2));
        const p2 = screenToWorld(rect.left + Math.max(box.x1, box.x2), rect.top + Math.max(box.y1, box.y2));
        for (const u of myUnits) {
          if (u.x >= p1.x && u.x <= p2.x && u.y >= p1.y && u.y <= p2.y) {
            nextSet.add(u.id);
          }
        }
      }

      selectedIdsRef.current = nextSet;
      setHud(buildHudSnapshot(matchRef.current));
    }
  };

  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    const factor = e.deltaY < 0 ? 1.1 : 0.91;
    cameraRef.current.zoom = Math.max(0.48, Math.min(1.55, cameraRef.current.zoom * factor));
  };

  const handleMinimapInteract = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const fx = (e.clientX - rect.left) / rect.width;
    const fy = (e.clientY - rect.top) / rect.height;
    const map = getMapById(matchRef.current.mapId);
    cameraRef.current.x = fx * map.width;
    cameraRef.current.y = fy * map.height;
  };

  const categoryUnits = useMemo(
    () => getFactionUnits(viewerFaction).filter((u) => u.category === activeCategory),
    [viewerFaction, activeCategory]
  );

  const handleUnitCardClick = (templateId: string, isJet: boolean) => {
    tacticalAudio.playUiClick();
    if (isJet) {
      setCommandMode('airstrike', templateId);
      flashNotice('Click target location on battlefield for precision air strike');
    } else {
      setCommandMode('deploy', templateId);
      flashNotice('Click battlefield rally point to deploy unit (or double-click card for immediate deploy)');
    }
  };

  const handleUnitCardDoubleClick = (templateId: string, isJet: boolean) => {
    if (isJet) return;
    dispatchCommand({ type: 'deploy', templateId });
    setCommandMode('normal', null);
  };

  const primarySelected = hud.selectedUnits[0];
  const primaryTemplate = primarySelected ? UNIT_BY_ID[primarySelected.templateId] : null;

  const isVictory =
    (viewerTeam === 'blue' && hud.status === 'victory_blue') ||
    (viewerTeam === 'red' && hud.status === 'victory_red');

  const handleSendChat = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = chatDraft.trim();
    if (!trimmed) return;
    mpClient.sendChat(trimmed);
    setChatDraft('');
  };

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-[#0c1114] select-none">
      {/* Isolated full-viewport tactical canvas container */}
      <div ref={containerRef} className="absolute inset-0">
        <canvas
          ref={canvasRef}
          data-testid="battlefield-canvas"
          onMouseDown={handleCanvasMouseDown}
          onMouseMove={handleCanvasMouseMove}
          onMouseUp={handleCanvasMouseUp}
          onWheel={handleWheel}
          onContextMenu={(e) => e.preventDefault()}
          className={`h-full w-full block ${
            commandMode === 'normal' ? 'cursor-default' : 'cursor-crosshair'
          }`}
        />
      </div>

      {/* Pointer pass-through HUD wrapper */}
      <div className="pointer-events-none fixed inset-0 flex flex-col justify-between p-3">
        {/* TOP PERIMETER TELEMETRY BAR */}
        <div className="flex items-start justify-between gap-3">
          {/* Left: Requisition Economy */}
          <div className="pointer-events-auto flex items-center gap-4 rounded border border-white/12 bg-[#0f161a]/92 px-4 py-2 shadow-lg">
            <div>
              <div className="text-[10px] font-semibold tracking-wider text-[#90a4ae] uppercase">
                Requisition
              </div>
              <div
                data-testid="requisition-value"
                className="font-mono-tabular text-2xl font-bold leading-none text-[#eab308]"
              >
                {hud.requisition}
              </div>
            </div>
            <div className="h-7 w-px bg-white/10" />
            <div>
              <div className="text-[10px] font-semibold tracking-wider text-[#90a4ae] uppercase">
                Income
              </div>
              <div className="font-mono-tabular text-sm font-semibold text-[#4ade80]">
                +{hud.incomePerSec.toFixed(1)}/s
              </div>
            </div>
            {roomCode && (
              <>
                <div className="h-7 w-px bg-white/10" />
                <div>
                  <div className="text-[10px] font-semibold tracking-wider text-[#90a4ae] uppercase">
                    Room
                  </div>
                  <div className="font-mono-tabular text-sm font-semibold text-[#cbd5e1]">
                    {roomCode}
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Center: Scoreboard & Sector Control Strip */}
          <div className="pointer-events-auto flex items-center gap-4 rounded border border-white/12 bg-[#0f161a]/92 px-5 py-2 shadow-lg">
            {/* Blue VP */}
            <div className="flex items-center gap-2.5">
              <div className="text-right">
                <div className="text-[10px] font-semibold tracking-wider text-[#93c5fd] uppercase">
                  Coalition
                </div>
                <div className="font-mono-tabular text-2xl font-bold leading-none text-white">
                  {hud.blueVp}
                </div>
              </div>
              <div className="h-2.5 w-24 overflow-hidden rounded-sm bg-[#1c2830]">
                <div
                  className="h-full bg-[#3b82f6] transition-transform duration-150 origin-left"
                  style={{ transform: `scaleX(${Math.min(1, hud.blueVp / hud.vpTarget)})` }}
                />
              </div>
            </div>

            {/* Clock + Sector Indicators */}
            <div className="flex flex-col items-center px-1">
              <div className="font-mono-tabular text-sm font-semibold text-white">
                {formatClock(hud.durationSec - hud.elapsedSec)}
              </div>
              <div className="mt-1 flex items-center gap-1.5">
                {hud.zones.map((z) => (
                  <span
                    key={z.code}
                    title={`Sector ${z.code}: ${z.contested ? 'Contested' : z.owner}`}
                    className={`flex h-4 w-4 items-center justify-center rounded-sm font-mono-tabular text-[10px] font-bold ${
                      z.contested
                        ? 'bg-[#eab308] text-[#0c1114]'
                        : z.owner === 'blue'
                        ? 'bg-[#2563eb] text-white'
                        : z.owner === 'red'
                        ? 'bg-[#dc2626] text-white'
                        : 'bg-[#25323a] text-[#9eb1bb]'
                    }`}
                  >
                    {z.code}
                  </span>
                ))}
              </div>
            </div>

            {/* Red VP */}
            <div className="flex items-center gap-2.5">
              <div className="h-2.5 w-24 overflow-hidden rounded-sm bg-[#1c2830]">
                <div
                  className="h-full bg-[#ef4444] transition-transform duration-150 origin-right"
                  style={{ transform: `scaleX(${Math.min(1, hud.redVp / hud.vpTarget)})` }}
                />
              </div>
              <div className="text-left">
                <div className="text-[10px] font-semibold tracking-wider text-[#fca5a5] uppercase">
                  Vanguard
                </div>
                <div className="font-mono-tabular text-2xl font-bold leading-none text-white">
                  {hud.redVp}
                </div>
              </div>
            </div>
          </div>

          {/* Right: Compact Utility Controls */}
          <div className="pointer-events-auto flex items-center gap-1.5">
            {mode === 'multiplayer' && (
              <button
                type="button"
                tabIndex={-1}
                aria-label="Toggle multiplayer chat"
                onClick={(e) => {
                  e.currentTarget.blur();
                  setCommsOpen((v) => !v);
                }}
                className={`flex h-9 w-9 items-center justify-center rounded border border-white/12 bg-[#0f161a]/92 text-[#cbd5e1] hover:bg-[#1a262d] ${
                  commsOpen ? 'border-[#60a5fa] text-white' : ''
                }`}
              >
                <MessageSquare className="h-4 w-4" />
              </button>
            )}
            <button
              type="button"
              tabIndex={-1}
              aria-label={muted ? 'Unmute audio [M]' : 'Mute audio [M]'}
              onClick={(e) => {
                e.currentTarget.blur();
                const next = !muted;
                tacticalAudio.setMuted(next);
                setMuted(next);
              }}
              className="flex h-9 w-9 items-center justify-center rounded border border-white/12 bg-[#0f161a]/92 text-[#cbd5e1] hover:bg-[#1a262d]"
            >
              {muted ? <VolumeX className="h-4 w-4 text-[#f87171]" /> : <Volume2 className="h-4 w-4" />}
            </button>
            <button
              type="button"
              tabIndex={-1}
              aria-label="Pause match [P]"
              onClick={(e) => {
                e.currentTarget.blur();
                pausedRef.current = !pausedRef.current;
                setPaused(pausedRef.current);
              }}
              className="flex h-9 w-9 items-center justify-center rounded border border-white/12 bg-[#0f161a]/92 text-[#cbd5e1] hover:bg-[#1a262d]"
            >
              <Pause className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Transient tactical feedback banner (non-blocking) */}
        {statusNotice && (
          <div className="mx-auto rounded border border-[#eab308]/40 bg-[#141c21]/95 px-4 py-1.5 text-xs font-semibold text-[#fde047]">
            {statusNotice}
          </div>
        )}

        {/* Collapsible Multiplayer Comms Drawer */}
        {mode === 'multiplayer' && commsOpen && (
          <div className="pointer-events-auto ml-auto w-72 rounded border border-white/12 bg-[#0f161a]/95 shadow-xl">
            <div className="border-b border-white/10 px-3 py-2 text-xs font-semibold text-[#94a8b3] uppercase">
              Battlefield Comms
            </div>
            <div className="h-40 space-y-1.5 overflow-y-auto p-3 text-xs">
              {chatMessages.map((m) => (
                <div key={m.id}>
                  <span className="font-semibold text-[#60a5fa]">{m.sender}: </span>
                  <span className="text-[#dce5e9]">{m.text}</span>
                </div>
              ))}
            </div>
            <form onSubmit={handleSendChat} className="flex gap-1.5 border-t border-white/10 p-2">
              <input
                type="text"
                value={chatDraft}
                onChange={(e) => setChatDraft(e.target.value)}
                placeholder="Radio message..."
                className="flex-1 rounded border border-white/12 bg-[#162026] px-2 py-1 text-xs text-white focus:outline-none"
              />
              <button
                type="submit"
                className="rounded bg-[#2563eb] px-2.5 py-1 text-xs font-semibold text-white"
              >
                Send
              </button>
            </form>
          </div>
        )}

        {/* BOTTOM UNIFIED PERIMETER COMMAND DOCK */}
        <div className="flex items-end justify-between gap-3">
          {/* Left: Selected Unit Telemetry & Tactical Orders */}
          <div className="pointer-events-auto w-72 rounded border border-white/12 bg-[#0f161a]/94 p-3 shadow-lg">
            {primarySelected && primaryTemplate ? (
              <div className="space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="truncate font-display text-xl font-bold leading-none text-white">
                    {hud.selectedUnits.length > 1
                      ? `${hud.selectedUnits.length} Units Selected`
                      : primaryTemplate.name}
                  </div>
                  <span className="font-mono-tabular text-xs font-semibold text-[#4ade80]">
                    {primarySelected.hp}/{primarySelected.maxHp} HP
                  </span>
                </div>

                <div className="flex items-center justify-between text-[11px] text-[#94a8b3]">
                  <span>
                    ARM <strong className="font-mono-tabular text-white">{primaryTemplate.armorFront}/{primaryTemplate.armorSide}/{primaryTemplate.armorRear}</strong>
                  </span>
                  <span>
                    AMMO <strong className="font-mono-tabular text-white">{primarySelected.ammoSummary}</strong>
                  </span>
                  <span>
                    APS <strong className="font-mono-tabular text-white">{primarySelected.apsCharges}</strong>
                  </span>
                  <span>
                    SMK <strong className="font-mono-tabular text-white">{primarySelected.smokeCharges}</strong>
                  </span>
                </div>

                {/* Tactical Order Action Strip */}
                <div className="grid grid-cols-3 gap-1.5 pt-1">
                  <button
                    type="button"
                    onClick={() => setCommandMode('attack_move', null)}
                    className={`flex items-center justify-center gap-1 rounded border px-2 py-1.5 text-[11px] font-semibold ${
                      commandMode === 'attack_move'
                        ? 'border-[#ef4444] bg-[#7f1d1d] text-white'
                        : 'border-white/12 bg-[#172228] text-[#d4dfe4] hover:bg-[#203038]'
                    }`}
                  >
                    <Crosshair className="h-3.5 w-3.5" />
                    <span>[Q] Atk</span>
                  </button>

                  <button
                    type="button"
                    disabled={!hud.selectedUnits.some((u) => u.hasIndirect)}
                    onClick={() => setCommandMode('barrage', null)}
                    className={`flex items-center justify-center gap-1 rounded border px-2 py-1.5 text-[11px] font-semibold disabled:opacity-35 ${
                      commandMode === 'barrage'
                        ? 'border-[#f59e0b] bg-[#78350f] text-white'
                        : 'border-white/12 bg-[#172228] text-[#d4dfe4] hover:bg-[#203038]'
                    }`}
                  >
                    <Flame className="h-3.5 w-3.5" />
                    <span>[F] Arty</span>
                  </button>

                  <button
                    type="button"
                    disabled={!hud.selectedUnits.some((u) => u.smokeCharges > 0)}
                    onClick={() =>
                      dispatchCommand({ type: 'smoke', unitIds: Array.from(selectedIdsRef.current) })
                    }
                    className="flex items-center justify-center gap-1 rounded border border-white/12 bg-[#172228] px-2 py-1.5 text-[11px] font-semibold text-[#d4dfe4] hover:bg-[#203038] disabled:opacity-35"
                  >
                    <Shield className="h-3.5 w-3.5" />
                    <span>[G] Smk</span>
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      dispatchCommand({
                        type: 'toggle_hold_fire',
                        unitIds: Array.from(selectedIdsRef.current),
                      })
                    }
                    className={`flex items-center justify-center gap-1 rounded border px-2 py-1.5 text-[11px] font-semibold ${
                      primarySelected.holdFire
                        ? 'border-[#eab308] bg-[#422006] text-[#fde047]'
                        : 'border-white/12 bg-[#172228] text-[#d4dfe4] hover:bg-[#203038]'
                    }`}
                  >
                    <EyeOff className="h-3.5 w-3.5" />
                    <span>[H] Hold</span>
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      dispatchCommand({ type: 'retreat', unitIds: Array.from(selectedIdsRef.current) })
                    }
                    className="flex items-center justify-center gap-1 rounded border border-white/12 bg-[#172228] px-2 py-1.5 text-[11px] font-semibold text-[#d4dfe4] hover:bg-[#203038]"
                  >
                    <Undo2 className="h-3.5 w-3.5" />
                    <span>[R] RTB</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setCommandMode('ping', null)}
                    className={`flex items-center justify-center gap-1 rounded border px-2 py-1.5 text-[11px] font-semibold ${
                      commandMode === 'ping'
                        ? 'border-[#38bdf8] bg-[#0c4a6e] text-white'
                        : 'border-white/12 bg-[#172228] text-[#d4dfe4] hover:bg-[#203038]'
                    }`}
                  >
                    <MapPin className="h-3.5 w-3.5" />
                    <span>[T] Ping</span>
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-2 py-1">
                <div className="font-display text-lg font-bold text-white">NO UNITS SELECTED</div>
                <p className="text-xs text-[#8fa4ae]">
                  Left-click or drag to select friendly units. Right-click terrain to move or enemy contacts to engage.
                </p>
                <button
                  type="button"
                  onClick={() => setCommandMode('ping', null)}
                  className="inline-flex items-center gap-1.5 rounded border border-white/12 bg-[#172228] px-2.5 py-1 text-[11px] font-semibold text-[#d4dfe4] hover:bg-[#203038]"
                >
                  <MapPin className="h-3.5 w-3.5" />
                  <span>[T] Tactical Map Ping</span>
                </button>
              </div>
            )}
          </div>

          {/* Center: Combined-Arms Deployment Dock */}
          <div className="pointer-events-auto flex-1 max-w-2xl rounded border border-white/12 bg-[#0f161a]/94 p-2.5 shadow-lg">
            {/* Category tabs */}
            <div className="flex items-center justify-between gap-2 border-b border-white/10 pb-2">
              <div className="flex items-center gap-1">
                {CATEGORIES.map((cat) => (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => {
                      tacticalAudio.playUiClick();
                      setActiveCategory(cat.id);
                    }}
                    className={`rounded px-2.5 py-1 text-xs font-semibold whitespace-nowrap transition-colors ${
                      activeCategory === cat.id
                        ? 'bg-[#2563eb] text-white'
                        : 'bg-[#172228] text-[#9eb1bb] hover:text-white'
                    }`}
                  >
                    <span className="mr-1 font-mono-tabular text-[10px] opacity-75">[{cat.hotkey}]</span>
                    {cat.label}
                  </button>
                ))}
              </div>
              {commandMode !== 'normal' && (
                <button
                  type="button"
                  onClick={() => setCommandMode('normal', null)}
                  className="text-xs font-semibold text-[#eab308] hover:underline whitespace-nowrap"
                >
                  Cancel {commandMode.replace('_', ' ')} (Esc)
                </button>
              )}
            </div>

            {/* Unit deploy cards */}
            <div className="mt-2 flex items-stretch gap-2 overflow-x-auto">
              {categoryUnits.map((tpl) => {
                const stock = hud.stock[tpl.id] ?? 0;
                const isJet = tpl.domain === 'jet';
                const jetCd = isJet && hud.airstrikeCooldown > 0;
                const affordable = hud.requisition >= tpl.cost && stock > 0 && !jetCd;
                const armed = deployTemplateId === tpl.id;
                return (
                  <button
                    key={tpl.id}
                    type="button"
                    disabled={!affordable}
                    onClick={() => handleUnitCardClick(tpl.id, isJet)}
                    onDoubleClick={() => handleUnitCardDoubleClick(tpl.id, isJet)}
                    className={`flex min-w-[162px] flex-1 flex-col justify-between rounded border px-3 py-2 text-left transition-colors ${
                      armed
                        ? 'border-[#eab308] bg-[#2a2414]'
                        : affordable
                        ? 'border-white/12 bg-[#162026] hover:border-[#60a5fa] hover:bg-[#1c2a32]'
                        : 'border-white/8 bg-[#12191d] opacity-45 cursor-not-allowed'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-display text-base font-bold leading-tight text-white truncate">
                        {tpl.shortName}
                      </span>
                      <span className="font-mono-tabular text-xs font-bold text-[#eab308]">
                        {tpl.cost}
                      </span>
                    </div>
                    <div className="mt-0.5 text-[11px] text-[#98acb6] truncate">{tpl.roleClue}</div>
                    <div className="mt-1.5 flex items-center justify-between text-[10px] font-mono-tabular text-[#cbd5e1]">
                      <span>{jetCd ? `CD ${hud.airstrikeCooldown.toFixed(0)}s` : `STOCK ${stock}`}</span>
                      <span className="text-[#8ba0aa]">{isJet ? 'STRIKE' : 'DEPLOY'}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Right: Interactive Live Tactical Minimap */}
          <div className="pointer-events-auto rounded border border-white/15 bg-[#0f161a]/95 p-1.5 shadow-lg">
            <canvas
              ref={minimapRef}
              width={216}
              height={135}
              onClick={handleMinimapInteract}
              onMouseMove={(e) => {
                if (e.buttons === 1) handleMinimapInteract(e);
              }}
              className="block cursor-pointer rounded-sm"
            />
          </div>
        </div>
      </div>

      {/* PAUSE MODAL */}
      {paused && hud.status === 'playing' && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-[#090d10]/80">
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Match paused"
            className="w-full max-w-sm rounded border border-white/15 bg-[#121a1f] p-7 shadow-2xl"
          >
            <h2 className="font-display text-4xl font-bold tracking-wide text-white">
              OPERATION PAUSED
            </h2>
            <p className="mt-1 text-xs text-[#94a8b3]">
              {mode === 'multiplayer'
                ? 'Multiplayer simulation continues live on the server.'
                : 'Tactical simulation frozen.'}
            </p>
            <div className="mt-6 flex flex-col gap-2.5">
              <button
                type="button"
                onClick={() => {
                  pausedRef.current = false;
                  setPaused(false);
                }}
                className="rounded bg-[#2563eb] py-2.5 font-display text-xl font-bold tracking-wide text-white hover:bg-[#1d4ed8]"
              >
                RESUME COMMAND
              </button>
              {mode === 'solo' && (
                <button
                  type="button"
                  onClick={onRestartSolo}
                  className="rounded border border-white/15 bg-[#19242b] py-2.5 text-sm font-semibold text-white hover:bg-[#23323b]"
                >
                  Restart Skirmish
                </button>
              )}
              <button
                type="button"
                onClick={onExitToTitle}
                className="rounded border border-white/12 bg-[#141c21] py-2.5 text-sm font-medium text-[#b8c7cf] hover:bg-[#1d282f]"
              >
                Exit to Title
              </button>
            </div>
          </div>
        </div>
      )}

      {/* VICTORY / DEFEAT MODAL */}
      {hud.status !== 'playing' && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-[#090d10]/85">
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Operation outcome"
            className="w-full max-w-md rounded border border-white/15 bg-[#121a1f] p-8 shadow-2xl"
          >
            <div
              className={`font-display text-5xl font-bold tracking-wide ${
                isVictory ? 'text-[#60a5fa]' : 'text-[#f87171]'
              }`}
            >
              {hud.status === 'draw' ? 'TACTICAL DRAW' : isVictory ? 'OPERATION VICTORY' : 'OPERATION DEFEAT'}
            </div>
            <p className="mt-1.5 text-sm text-[#a6b8c2]">{hud.winReason}</p>

            <div className="mt-6 grid grid-cols-3 gap-3 border-y border-white/10 py-4">
              <div>
                <div className="text-[11px] font-medium text-[#8ba0aa] uppercase">Final VP</div>
                <div className="mt-0.5 font-mono-tabular text-xl font-bold text-white">
                  {hud.blueVp} – {hud.redVp}
                </div>
              </div>
              <div>
                <div className="text-[11px] font-medium text-[#8ba0aa] uppercase">Destroyed</div>
                <div className="mt-0.5 font-mono-tabular text-xl font-bold text-[#4ade80]">
                  {hud.unitsDestroyed}
                </div>
              </div>
              <div>
                <div className="text-[11px] font-medium text-[#8ba0aa] uppercase">Losses</div>
                <div className="mt-0.5 font-mono-tabular text-xl font-bold text-[#f87171]">
                  {hud.unitsLost}
                </div>
              </div>
            </div>

            <div className="mt-6 flex flex-col gap-2.5">
              {mode === 'solo' ? (
                <button
                  type="button"
                  data-start="true"
                  onClick={onRestartSolo}
                  className="rounded bg-[#2563eb] py-3 font-display text-2xl font-bold tracking-wide text-white hover:bg-[#1d4ed8]"
                >
                  PLAY AGAIN
                </button>
              ) : (
                onReturnToLobby && (
                  <button
                    type="button"
                    data-start="true"
                    onClick={onReturnToLobby}
                    className="rounded bg-[#2563eb] py-3 font-display text-2xl font-bold tracking-wide text-white hover:bg-[#1d4ed8]"
                  >
                    RETURN TO ROOM LOBBY
                  </button>
                )
              )}
              <button
                type="button"
                onClick={onExitToTitle}
                className="rounded border border-white/15 bg-[#182228] py-2.5 text-sm font-semibold text-[#d4dfe4] hover:bg-[#23323b]"
              >
                Return to Title
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
