import { createDefaultDeck, UNIT_BY_ID } from './catalog';
import {
  findNearestBridgeCenter,
  getMapById,
  isInCover,
  isOnRoad,
  isWaterBlocked,
} from './maps';
import type {
  BattlegroupDeck,
  CombatEvent,
  FactionId,
  GameCommand,
  MatchState,
  PlayerMatchState,
  ProjectileState,
  SmokeCloud,
  TacticalMap,
  TeamId,
  UnitState,
  UnitTemplate,
  Vec2,
  WeaponSpec,
} from './types';

export interface PlayerInitConfig {
  id: string;
  name: string;
  team: TeamId;
  faction: FactionId;
  isAI: boolean;
  deck?: BattlegroupDeck;
}

let idCounter = 1;
function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}_${idCounter}`;
}

export function resetIdCounterForTest(): void {
  idCounter = 1;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function angleDiff(a: number, b: number): number {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export function computeDirectionalArmor(
  template: UnitTemplate,
  targetFacing: number,
  incomingAngle: number
): { armor: number; arc: 'front' | 'side' | 'rear' } {
  // incomingAngle is direction from attacker -> target; impact hits front when opposite to targetFacing
  const impactFrom = incomingAngle + Math.PI;
  const diff = Math.abs(angleDiff(impactFrom, targetFacing));
  if (diff <= (55 * Math.PI) / 180) {
    return { armor: template.armorFront, arc: 'front' };
  }
  if (diff <= (130 * Math.PI) / 180) {
    return { armor: template.armorSide, arc: 'side' };
  }
  return { armor: template.armorRear, arc: 'rear' };
}

export function computeWeaponDamage(
  weapon: WeaponSpec,
  targetTemplate: UnitTemplate,
  targetUnit: UnitState,
  attackerPos: Vec2
): number {
  const incomingAngle = Math.atan2(targetUnit.y - attackerPos.y, targetUnit.x - attackerPos.x);
  const { armor, arc } = computeDirectionalArmor(targetTemplate, targetUnit.facing, incomingAngle);

  let mult = 1.0;
  if (targetTemplate.domain === 'vehicle') {
    const ratio = weapon.penetration / Math.max(1, armor);
    if (ratio >= 1.35) {
      mult = arc === 'rear' ? 1.45 : 1.2;
    } else if (ratio >= 0.9) {
      mult = 0.95 + (ratio - 0.9) * 0.5;
    } else if (ratio >= 0.45) {
      mult = 0.35 + (ratio - 0.45) * 1.1;
    } else {
      mult = 0.14;
    }
  } else if (targetTemplate.domain === 'infantry') {
    if (weapon.type === 'kinetic') mult = 0.55;
    if (targetUnit.inCover && !weapon.indirect) {
      mult *= 0.5;
    }
  }

  return Math.max(2, Math.round(weapon.damage * mult));
}

export function isSegmentBlockedBySmoke(smokes: SmokeCloud[], a: Vec2, b: Vec2): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  for (const s of smokes) {
    if (s.remainingSec <= 0) continue;
    let distSq: number;
    if (lenSq === 0) {
      distSq = (s.x - a.x) ** 2 + (s.y - a.y) ** 2;
    } else {
      const t = clamp(((s.x - a.x) * dx + (s.y - a.y) * dy) / lenSq, 0, 1);
      const px = a.x + t * dx;
      const py = a.y + t * dy;
      distSq = (s.x - px) ** 2 + (s.y - py) ** 2;
    }
    if (distSq <= s.radius * s.radius) {
      return true;
    }
  }
  return false;
}

function buildStockFromDeck(deck: BattlegroupDeck): Record<string, number> {
  const stock: Record<string, number> = {};
  for (const e of deck.entries) {
    if (UNIT_BY_ID[e.templateId] && e.count > 0) {
      stock[e.templateId] = (stock[e.templateId] ?? 0) + e.count;
    }
  }
  return stock;
}

function createUnitInstance(
  template: UnitTemplate,
  ownerId: string,
  team: TeamId,
  x: number,
  y: number,
  order: UnitState['order'] = { type: 'idle' }
): UnitState {
  const facing = team === 'blue' ? 0 : Math.PI;
  const altitude = template.domain === 'jet' ? 2 : template.domain === 'helicopter' ? 1 : 0;
  return {
    id: nextId('u'),
    templateId: template.id,
    ownerId,
    team,
    x,
    y,
    vx: 0,
    vy: 0,
    facing,
    turretFacing: facing,
    hp: template.hp,
    maxHp: template.hp,
    ammo: template.weapons.map((w) => w.maxAmmo),
    reloadTimers: template.weapons.map(() => 0),
    apsCharges: template.apsCharges,
    apsCooldown: 0,
    smokeCharges: template.smokeCharges,
    smokeCooldown: 0,
    supplyRemaining: template.supplyCapacity ?? 0,
    holdFire: false,
    inCover: false,
    spottedByEnemy: false,
    hitFlash: 0,
    order,
    alive: true,
    koTimer: 0,
    altitude,
  };
}

export function createMatchState(
  matchId: string,
  mapId: string,
  playerConfigs: PlayerInitConfig[],
  options?: { vpTarget?: number; durationSec?: number; startingRequisition?: number }
): MatchState {
  const map = getMapById(mapId);
  const players: Record<string, PlayerMatchState> = {};
  const units: UnitState[] = [];

  const startingReq = options?.startingRequisition ?? 650;

  for (let idx = 0; idx < playerConfigs.length; idx++) {
    const cfg = playerConfigs[idx];
    const deck = cfg.deck ?? createDefaultDeck(cfg.faction);
    const stock = buildStockFromDeck(deck);

    players[cfg.id] = {
      id: cfg.id,
      name: cfg.name,
      team: cfg.team,
      faction: cfg.faction,
      isAI: cfg.isAI,
      requisition: startingReq,
      incomePerSec: 18,
      stock,
      unitsLost: 0,
      unitsDestroyed: 0,
      damageDealt: 0,
      airstrikeCooldown: 0,
    };

    // Deploy an opening vanguard force in open clear space so combat starts swiftly
    const spawnRect = cfg.team === 'blue' ? map.blueSpawn : map.redSpawn;
    const baseX = cfg.team === 'blue' ? spawnRect.x + spawnRect.w + 90 : spawnRect.x - 90;
    const yOffset = (idx % 2) * 140 - 70;
    const baseY = map.height * 0.5 + yOffset;

    const starterIds =
      cfg.faction === 'coalition'
        ? ['us_abrams', 'us_bradley', 'us_rifles', 'us_lav_recon']
        : ['ru_t90m', 'ru_bmp3', 'ru_motostrelki', 'ru_btr_recon'];

    const offsets: Vec2[] = [
      { x: 0, y: -45 },
      { x: 0, y: 45 },
      { x: cfg.team === 'blue' ? -55 : 55, y: 0 },
      { x: cfg.team === 'blue' ? 65 : -65, y: -115 },
    ];

    starterIds.forEach((tid, i) => {
      const tpl = UNIT_BY_ID[tid];
      if (!tpl) return;
      const sx = clamp(baseX + offsets[i].x, 60, map.width - 60);
      const sy = clamp(baseY + offsets[i].y, 60, map.height - 60);
      const u = createUnitInstance(tpl, cfg.id, cfg.team, sx, sy, { type: 'idle' });
      u.inCover = isInCover(map, { x: sx, y: sy });
      units.push(u);
      if ((players[cfg.id].stock[tid] ?? 0) > 1) {
        players[cfg.id].stock[tid] -= 1;
      }
    });
  }

  return {
    id: matchId,
    mapId: map.id,
    tick: 0,
    elapsedSec: 0,
    durationSec: options?.durationSec ?? 900, // 15 minutes
    vpTarget: options?.vpTarget ?? 1000,
    blueVp: 0,
    redVp: 0,
    status: 'playing',
    players,
    zones: map.zones.map((z) => ({
      ...z,
      owner: 'neutral',
      captureProgress: 0,
      contested: false,
    })),
    units,
    projectiles: [],
    smokes: [],
    pings: [],
    events: [],
  };
}

export function getSpawnPoint(map: TacticalMap, team: TeamId, desiredPos?: Vec2): Vec2 {
  const rect = team === 'blue' ? map.blueSpawn : map.redSpawn;
  const x = team === 'blue' ? rect.x + rect.w * 0.65 : rect.x + rect.w * 0.35;
  const y = desiredPos
    ? clamp(desiredPos.y, rect.y + 40, rect.y + rect.h - 40)
    : rect.y + rect.h * 0.5;
  return { x, y };
}

export function applyCommand(
  state: MatchState,
  playerId: string,
  command: GameCommand
): { ok: boolean; error?: string } {
  if (state.status !== 'playing') {
    return { ok: false, error: 'Match has ended.' };
  }
  const player = state.players[playerId];
  if (!player) {
    return { ok: false, error: 'Unknown player.' };
  }
  const map = getMapById(state.mapId);

  switch (command.type) {
    case 'deploy': {
      const tpl = UNIT_BY_ID[command.templateId];
      if (!tpl) return { ok: false, error: 'Invalid unit template.' };
      if (tpl.domain === 'jet') {
        return { ok: false, error: 'Use airstrike command for jets.' };
      }
      const remainingStock = player.stock[tpl.id] ?? 0;
      if (remainingStock <= 0) return { ok: false, error: 'No units remaining in stock.' };
      if (player.requisition < tpl.cost) return { ok: false, error: 'Insufficient requisition.' };

      const spawn = getSpawnPoint(map, player.team, command.targetPos);
      // Add slight deterministic scatter so stacked deploys spread out
      const scatter = ((state.units.length * 37) % 5 - 2) * 18;
      const sx = clamp(spawn.x, 45, map.width - 45);
      const sy = clamp(spawn.y + scatter, 55, map.height - 55);

      const order: UnitState['order'] = command.targetPos
        ? {
            type: 'attack_move',
            targetPos: {
              x: clamp(command.targetPos.x, 40, map.width - 40),
              y: clamp(command.targetPos.y, 40, map.height - 40),
            },
          }
        : {
            type: 'move',
            targetPos: {
              x: clamp(sx + (player.team === 'blue' ? 240 : -240), 60, map.width - 60),
              y: sy,
            },
          };

      const unit = createUnitInstance(tpl, playerId, player.team, sx, sy, order);
      unit.inCover = isInCover(map, { x: sx, y: sy });
      player.requisition -= tpl.cost;
      player.stock[tpl.id] = remainingStock - 1;
      state.units.push(unit);
      return { ok: true };
    }

    case 'airstrike': {
      const tpl = UNIT_BY_ID[command.templateId];
      if (!tpl || tpl.domain !== 'jet') return { ok: false, error: 'Invalid air strike unit.' };
      const remainingStock = player.stock[tpl.id] ?? 0;
      if (remainingStock <= 0) return { ok: false, error: 'No sorties available.' };
      if (player.airstrikeCooldown > 0) return { ok: false, error: 'Air sortie on cooldown.' };
      if (player.requisition < tpl.cost) return { ok: false, error: 'Insufficient requisition.' };

      const targetX = clamp(command.targetPos.x, 80, map.width - 80);
      const targetY = clamp(command.targetPos.y, 80, map.height - 80);
      const startX = player.team === 'blue' ? 20 : map.width - 20;
      const exitX = player.team === 'blue' ? map.width + 120 : -120;

      const jet = createUnitInstance(tpl, playerId, player.team, startX, targetY, {
        type: 'attack_move',
        targetPos: { x: targetX, y: targetY },
      });
      jet.jetExitPos = { x: exitX, y: targetY };
      jet.jetBombDropped = false;

      player.requisition -= tpl.cost;
      player.stock[tpl.id] = remainingStock - 1;
      player.airstrikeCooldown = 14;
      state.units.push(jet);
      state.events.push({
        id: nextId('ev'),
        type: 'airstrike_inbound',
        x: targetX,
        y: targetY,
        team: player.team,
        intensity: 1.2,
        text: `${tpl.shortName} INBOUND`,
      });
      return { ok: true };
    }

    case 'move':
    case 'attack_move': {
      const tx = clamp(command.targetPos.x, 30, map.width - 30);
      const ty = clamp(command.targetPos.y, 30, map.height - 30);
      const owned = state.units.filter(
        (u) => u.alive && u.ownerId === playerId && command.unitIds.includes(u.id) && u.altitude < 2
      );
      if (owned.length === 0) return { ok: false, error: 'No controllable units selected.' };
      const cols = Math.ceil(Math.sqrt(owned.length));
      owned.forEach((u, idx) => {
        const row = Math.floor(idx / cols);
        const col = idx % cols;
        const offsetX = (col - (cols - 1) * 0.5) * 38;
        const offsetY = (row - Math.floor((owned.length - 1) / cols) * 0.5) * 38;
        u.order = {
          type: command.type,
          targetPos: {
            x: clamp(tx + offsetX, 30, map.width - 30),
            y: clamp(ty + offsetY, 30, map.height - 30),
          },
        };
      });
      return { ok: true };
    }

    case 'attack_target': {
      const target = state.units.find((u) => u.id === command.targetUnitId && u.alive);
      if (!target || target.team === player.team) return { ok: false, error: 'Invalid target.' };
      const owned = state.units.filter(
        (u) => u.alive && u.ownerId === playerId && command.unitIds.includes(u.id) && u.altitude < 2
      );
      for (const u of owned) {
        u.order = { type: 'attack_target', targetUnitId: target.id };
      }
      return { ok: true };
    }

    case 'barrage': {
      const tx = clamp(command.targetPos.x, 40, map.width - 40);
      const ty = clamp(command.targetPos.y, 40, map.height - 40);
      const owned = state.units.filter(
        (u) => u.alive && u.ownerId === playerId && command.unitIds.includes(u.id)
      );
      for (const u of owned) {
        const tpl = UNIT_BY_ID[u.templateId];
        if (tpl?.weapons.some((w) => w.indirect)) {
          u.order = { type: 'barrage', targetPos: { x: tx, y: ty } };
        }
      }
      return { ok: true };
    }

    case 'smoke': {
      const owned = state.units.filter(
        (u) => u.alive && u.ownerId === playerId && command.unitIds.includes(u.id)
      );
      let deployedAny = false;
      for (const u of owned) {
        if (u.smokeCharges > 0 && u.smokeCooldown <= 0) {
          u.smokeCharges -= 1;
          u.smokeCooldown = 16;
          const sx = u.x + Math.cos(u.facing) * 26;
          const sy = u.y + Math.sin(u.facing) * 26;
          state.smokes.push({
            id: nextId('smk'),
            x: sx,
            y: sy,
            radius: 74,
            remainingSec: 13,
            maxSec: 13,
          });
          state.events.push({
            id: nextId('ev'),
            type: 'smoke',
            x: sx,
            y: sy,
            team: u.team,
            intensity: 0.7,
          });
          deployedAny = true;
        }
      }
      return deployedAny ? { ok: true } : { ok: false, error: 'No smoke charges ready.' };
    }

    case 'toggle_hold_fire': {
      const owned = state.units.filter(
        (u) => u.alive && u.ownerId === playerId && command.unitIds.includes(u.id)
      );
      if (owned.length === 0) return { ok: false, error: 'No units selected.' };
      const nextHold = !owned.every((u) => u.holdFire);
      for (const u of owned) {
        u.holdFire = nextHold;
      }
      return { ok: true };
    }

    case 'retreat': {
      const owned = state.units.filter(
        (u) => u.alive && u.ownerId === playerId && command.unitIds.includes(u.id) && u.altitude < 2
      );
      const spawn = getSpawnPoint(map, player.team);
      for (const u of owned) {
        u.order = { type: 'retreat', targetPos: { x: spawn.x, y: clamp(u.y, 160, map.height - 160) } };
      }
      return { ok: true };
    }

    case 'ping': {
      state.pings.push({
        id: nextId('png'),
        team: player.team,
        playerName: player.name,
        x: clamp(command.targetPos.x, 40, map.width - 40),
        y: clamp(command.targetPos.y, 40, map.height - 40),
        label: command.label.slice(0, 28) || 'Tactical Ping',
        remainingSec: 6.5,
      });
      return { ok: true };
    }
  }
}

function canWeaponTargetUnit(weapon: WeaponSpec, targetTpl: UnitTemplate): boolean {
  if (targetTpl.domain === 'jet') return weapon.canTargetJet;
  if (targetTpl.domain === 'helicopter') return weapon.canTargetHeli;
  return weapon.canTargetGround;
}

function updateVisibility(state: MatchState, map: TacticalMap): void {
  const aliveUnits = state.units.filter((u) => u.alive);
  for (const u of aliveUnits) {
    u.inCover = u.altitude === 0 ? isInCover(map, u) : false;
    u.spottedByEnemy = false;
  }

  for (const observer of aliveUnits) {
    const obsTpl = UNIT_BY_ID[observer.templateId];
    if (!obsTpl) continue;
    for (const target of aliveUnits) {
      if (target.team === observer.team) continue;
      const tgtTpl = UNIT_BY_ID[target.templateId];
      if (!tgtTpl) continue;

      const dist = Math.hypot(target.x - observer.x, target.y - observer.y);
      const coverFactor = target.inCover ? 0.85 : 0.4;
      let detectRange = obsTpl.optics * (1 - tgtTpl.stealth * coverFactor);
      if (target.altitude >= 1) {
        detectRange = Math.max(detectRange, obsTpl.optics * 1.15);
      }
      if (dist <= detectRange) {
        if (target.altitude === 0 && isSegmentBlockedBySmoke(state.smokes, observer, target)) {
          continue;
        }
        target.spottedByEnemy = true;
      }
    }
  }
}

function stepUnitMovement(unit: UnitState, tpl: UnitTemplate, map: TacticalMap, state: MatchState, dt: number): void {
  // Jet special straight-line bombing run
  if (tpl.domain === 'jet') {
    const target = unit.order.targetPos ?? unit.jetExitPos ?? { x: map.width * 0.5, y: unit.y };
    const dest = unit.jetBombDropped && unit.jetExitPos ? unit.jetExitPos : target;
    const dx = dest.x - unit.x;
    const dy = dest.y - unit.y;
    const dist = Math.hypot(dx, dy);
    if (dist > 1) {
      unit.facing = Math.atan2(dy, dx);
      unit.turretFacing = unit.facing;
      const step = tpl.speed * dt;
      unit.vx = (dx / dist) * tpl.speed;
      unit.vy = (dy / dist) * tpl.speed;
      unit.x += (dx / dist) * Math.min(step, dist);
      unit.y += (dy / dist) * Math.min(step, dist);
    }

    // Drop precision JDAM when over target
    if (!unit.jetBombDropped && unit.order.targetPos) {
      const distToTarget = Math.hypot(unit.order.targetPos.x - unit.x, unit.order.targetPos.y - unit.y);
      if (distToTarget <= 75) {
        unit.jetBombDropped = true;
        const bomb = tpl.weapons[0];
        if (bomb) {
          detonateSplash(state, unit.team, unit.ownerId, unit.order.targetPos.x, unit.order.targetPos.y, bomb);
        }
      }
    }

    // Remove jet once off-map & refund stock partially so sorties can return later
    if (unit.jetBombDropped && (unit.x < -60 || unit.x > map.width + 60)) {
      unit.alive = false;
      unit.koTimer = 0;
      const p = state.players[unit.ownerId];
      if (p) {
        p.stock[unit.templateId] = Math.min(tpl.maxStock, (p.stock[unit.templateId] ?? 0) + 1);
      }
    }
    return;
  }

  // Retreat arrival refund
  if (unit.order.type === 'retreat' && unit.order.targetPos) {
    const spawnRect = unit.team === 'blue' ? map.blueSpawn : map.redSpawn;
    const insideSpawn =
      unit.x >= spawnRect.x - 10 &&
      unit.x <= spawnRect.x + spawnRect.w + 15 &&
      unit.y >= spawnRect.y - 20 &&
      unit.y <= spawnRect.y + spawnRect.h + 20;
    if (insideSpawn && !unit.retreatRefunded) {
      unit.retreatRefunded = true;
      unit.alive = false;
      unit.koTimer = 0;
      const p = state.players[unit.ownerId];
      if (p) {
        const hpRatio = unit.hp / unit.maxHp;
        p.requisition += Math.round(tpl.cost * 0.75 * hpRatio);
        p.stock[unit.templateId] = Math.min(tpl.maxStock, (p.stock[unit.templateId] ?? 0) + 1);
      }
      return;
    }
  }

  let goal: Vec2 | null = null;
  if (unit.order.type === 'move' || unit.order.type === 'attack_move' || unit.order.type === 'retreat') {
    goal = unit.order.targetPos ?? null;
  } else if (unit.order.type === 'attack_target' && unit.order.targetUnitId) {
    const tgt = state.units.find((u) => u.id === unit.order.targetUnitId && u.alive);
    if (!tgt) {
      unit.order = { type: 'idle' };
    } else {
      const maxRange = Math.max(120, ...tpl.weapons.map((w) => w.range));
      const d = Math.hypot(tgt.x - unit.x, tgt.y - unit.y);
      if (d > maxRange * 0.85) {
        goal = { x: tgt.x, y: tgt.y };
      }
    }
  }

  if (!goal) {
    unit.vx = 0;
    unit.vy = 0;
    return;
  }

  // For attack_move, stop briefly when an enemy is comfortably within firing range
  if (unit.order.type === 'attack_move' && !unit.holdFire && tpl.weapons.length > 0) {
    const maxDirectRange = Math.max(0, ...tpl.weapons.filter((w) => !w.indirect).map((w) => w.range));
    if (maxDirectRange > 0) {
      const hasTargetInRange = state.units.some((other) => {
        if (!other.alive || other.team === unit.team || !other.spottedByEnemy) return false;
        const otherTpl = UNIT_BY_ID[other.templateId];
        if (!otherTpl) return false;
        if (!tpl.weapons.some((w) => !w.indirect && canWeaponTargetUnit(w, otherTpl))) return false;
        return Math.hypot(other.x - unit.x, other.y - unit.y) <= maxDirectRange * 0.88;
      });
      if (hasTargetInRange) {
        unit.vx = 0;
        unit.vy = 0;
        return;
      }
    }
  }

  // River bridge routing for ground units
  let moveTarget = goal;
  if (unit.altitude === 0 && map.rivers.length > 0) {
    const mid: Vec2 = { x: (unit.x + goal.x) * 0.5, y: (unit.y + goal.y) * 0.5 };
    const crossingNeeded =
      (unit.x < 1140 && goal.x > 1250) ||
      (unit.x > 1250 && goal.x < 1140) ||
      isWaterBlocked(map, mid);
    if (crossingNeeded) {
      const bridge = findNearestBridgeCenter(map, unit, goal);
      if (bridge && Math.hypot(bridge.x - unit.x, bridge.y - unit.y) > 48) {
        moveTarget = bridge;
      }
    }
  }

  const dx = moveTarget.x - unit.x;
  const dy = moveTarget.y - unit.y;
  const dist = Math.hypot(dx, dy);

  if (dist < 10) {
    if (moveTarget === goal) {
      unit.order = { type: 'idle' };
    }
    unit.vx = 0;
    unit.vy = 0;
    return;
  }

  const roadBonus = unit.altitude === 0 && isOnRoad(map, unit) ? 1.24 : 1.0;
  const retreatBonus = unit.order.type === 'retreat' ? 1.15 : 1.0;
  const speed = tpl.speed * roadBonus * retreatBonus;

  const desiredAngle = Math.atan2(dy, dx);
  const turnDelta = angleDiff(desiredAngle, unit.facing);
  const maxTurn = (tpl.domain === 'infantry' ? 9 : 4.2) * dt;
  unit.facing += clamp(turnDelta, -maxTurn, maxTurn);

  const stepDist = Math.min(speed * dt, dist);
  const nx = clamp(unit.x + (dx / dist) * stepDist, 24, map.width - 24);
  const ny = clamp(unit.y + (dy / dist) * stepDist, 24, map.height - 24);

  if (unit.altitude === 0 && isWaterBlocked(map, { x: nx, y: ny })) {
    // Slide along riverbank toward nearest bridge
    const bridge = findNearestBridgeCenter(map, unit, goal);
    if (bridge) {
      const by = bridge.y - unit.y;
      const slideY = clamp(unit.y + Math.sign(by) * speed * dt, 24, map.height - 24);
      if (!isWaterBlocked(map, { x: unit.x, y: slideY })) {
        unit.y = slideY;
      }
    }
    unit.vx = 0;
    unit.vy = 0;
  } else {
    unit.vx = (nx - unit.x) / Math.max(dt, 0.001);
    unit.vy = (ny - unit.y) / Math.max(dt, 0.001);
    unit.x = nx;
    unit.y = ny;
  }
}

function applyUnitSeparation(state: MatchState, map: TacticalMap): void {
  const units = state.units;
  for (let i = 0; i < units.length; i++) {
    const a = units[i];
    if (!a.alive || a.altitude === 2) continue;
    for (let j = i + 1; j < units.length; j++) {
      const b = units[j];
      if (!b.alive || b.altitude !== a.altitude) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.hypot(dx, dy);
      const minSep = 26;
      if (dist > 0.01 && dist < minSep) {
        const push = (minSep - dist) * 0.25;
        const ux = dx / dist;
        const uy = dy / dist;
        const ax = clamp(a.x - ux * push, 24, map.width - 24);
        const ay = clamp(a.y - uy * push, 24, map.height - 24);
        const bx = clamp(b.x + ux * push, 24, map.width - 24);
        const by = clamp(b.y + uy * push, 24, map.height - 24);
        if (a.altitude > 0 || !isWaterBlocked(map, { x: ax, y: ay })) {
          a.x = ax;
          a.y = ay;
        }
        if (b.altitude > 0 || !isWaterBlocked(map, { x: bx, y: by })) {
          b.x = bx;
          b.y = by;
        }
      }
    }
  }
}

function stepCombatAndWeapons(state: MatchState, dt: number): void {
  for (const unit of state.units) {
    if (!unit.alive) continue;
    const tpl = UNIT_BY_ID[unit.templateId];
    if (!tpl || tpl.domain === 'jet') continue;

    if (unit.apsCooldown > 0) unit.apsCooldown = Math.max(0, unit.apsCooldown - dt);
    if (unit.smokeCooldown > 0) unit.smokeCooldown = Math.max(0, unit.smokeCooldown - dt);
    if (unit.hitFlash > 0) unit.hitFlash = Math.max(0, unit.hitFlash - dt * 4.5);

    for (let wi = 0; wi < unit.reloadTimers.length; wi++) {
      if (unit.reloadTimers[wi] > 0) {
        unit.reloadTimers[wi] = Math.max(0, unit.reloadTimers[wi] - dt);
      }
    }

    // Supply truck logistics aura
    if (tpl.isSupply && unit.supplyRemaining > 0) {
      for (const ally of state.units) {
        if (!ally.alive || ally.id === unit.id || ally.team !== unit.team || ally.altitude === 2) continue;
        const dist = Math.hypot(ally.x - unit.x, ally.y - unit.y);
        if (dist <= 135) {
          const allyTpl = UNIT_BY_ID[ally.templateId];
          if (!allyTpl) continue;
          let resupplied = false;
          // Field repair
          if (ally.hp < ally.maxHp && unit.supplyRemaining > 0) {
            const heal = Math.min(ally.maxHp - ally.hp, 14 * dt);
            ally.hp += heal;
            unit.supplyRemaining = Math.max(0, unit.supplyRemaining - heal * 0.6);
            resupplied = true;
          }
          // Ammo refill
          for (let wi = 0; wi < allyTpl.weapons.length; wi++) {
            const maxAmmo = allyTpl.weapons[wi].maxAmmo;
            if (ally.ammo[wi] < maxAmmo && unit.supplyRemaining > 0 && state.tick % 10 === 0) {
              ally.ammo[wi] = Math.min(maxAmmo, ally.ammo[wi] + Math.max(1, Math.ceil(maxAmmo * 0.2)));
              unit.supplyRemaining = Math.max(0, unit.supplyRemaining - 12);
              resupplied = true;
            }
          }
          if (resupplied && state.tick % 25 === 0) {
            state.events.push({
              id: nextId('ev'),
              type: 'resupply',
              x: ally.x,
              y: ally.y,
              team: ally.team,
              intensity: 0.4,
            });
          }
        }
      }
      continue;
    }

    if (unit.holdFire || unit.order.type === 'retreat') continue;

    // Indirect artillery barrage order
    if (unit.order.type === 'barrage' && unit.order.targetPos) {
      const artyIdx = tpl.weapons.findIndex((w) => w.indirect);
      if (artyIdx >= 0) {
        const w = tpl.weapons[artyIdx];
        const dist = Math.hypot(unit.order.targetPos.x - unit.x, unit.order.targetPos.y - unit.y);
        if (
          unit.reloadTimers[artyIdx] <= 0 &&
          unit.ammo[artyIdx] > 0 &&
          dist <= w.range &&
          dist >= (w.minRange ?? 0)
        ) {
          unit.turretFacing = Math.atan2(unit.order.targetPos.y - unit.y, unit.order.targetPos.x - unit.x);
          unit.reloadTimers[artyIdx] = w.reloadSec;
          unit.ammo[artyIdx] -= 1;
          const scatterAngle = ((state.tick * 73 + unit.x) % 360) * (Math.PI / 180);
          const scatterR = 24;
          const tx = unit.order.targetPos.x + Math.cos(scatterAngle) * scatterR;
          const ty = unit.order.targetPos.y + Math.sin(scatterAngle) * scatterR;
          state.projectiles.push({
            id: nextId('pr'),
            team: unit.team,
            sourceUnitId: unit.id,
            weaponType: w.type,
            x: unit.x,
            y: unit.y,
            startX: unit.x,
            startY: unit.y,
            targetX: tx,
            targetY: ty,
            speed: w.projectileSpeed,
            damage: w.damage,
            penetration: w.penetration,
            splashRadius: w.splashRadius,
            guided: false,
            indirect: true,
            progress: 0,
            alive: true,
          });
          unit.spottedByEnemy = true;
          state.events.push({
            id: nextId('ev'),
            type: 'shot',
            x: unit.x,
            y: unit.y,
            x2: tx,
            y2: ty,
            team: unit.team,
            weaponType: w.type,
            intensity: 1.0,
          });
        }
      }
      continue;
    }

    // Direct fire weapons
    for (let wi = 0; wi < tpl.weapons.length; wi++) {
      const weapon = tpl.weapons[wi];
      if (weapon.indirect) continue;
      if (unit.reloadTimers[wi] > 0 || unit.ammo[wi] <= 0) continue;

      let chosen: UnitState | null = null;
      // Prefer explicit target order if valid & in range
      if (unit.order.type === 'attack_target' && unit.order.targetUnitId) {
        const explicit = state.units.find((u) => u.id === unit.order.targetUnitId && u.alive);
        if (explicit && explicit.spottedByEnemy) {
          const eTpl = UNIT_BY_ID[explicit.templateId];
          const d = Math.hypot(explicit.x - unit.x, explicit.y - unit.y);
          if (
            eTpl &&
            canWeaponTargetUnit(weapon, eTpl) &&
            d <= weapon.range &&
            (explicit.altitude > 0 || !isSegmentBlockedBySmoke(state.smokes, unit, explicit))
          ) {
            chosen = explicit;
          }
        }
      }

      if (!chosen) {
        let bestScore = Infinity;
        for (const other of state.units) {
          if (!other.alive || other.team === unit.team || !other.spottedByEnemy) continue;
          const otherTpl = UNIT_BY_ID[other.templateId];
          if (!otherTpl || !canWeaponTargetUnit(weapon, otherTpl)) continue;
          const d = Math.hypot(other.x - unit.x, other.y - unit.y);
          if (d > weapon.range) continue;
          if (other.altitude === 0 && isSegmentBlockedBySmoke(state.smokes, unit, other)) continue;
          // Prioritize armor for ATGM/kinetic, air for SAM
          const priorityBonus =
            weapon.type === 'atgm' && otherTpl.domain === 'vehicle'
              ? -120
              : weapon.type === 'sam' && otherTpl.domain !== 'infantry'
              ? -150
              : 0;
          const score = d + priorityBonus;
          if (score < bestScore) {
            bestScore = score;
            chosen = other;
          }
        }
      }

      if (chosen) {
        unit.turretFacing = Math.atan2(chosen.y - unit.y, chosen.x - unit.x);
        unit.reloadTimers[wi] = weapon.reloadSec;
        unit.ammo[wi] = Math.max(0, unit.ammo[wi] - 1);
        unit.spottedByEnemy = true; // firing breaks stealth

        state.projectiles.push({
          id: nextId('pr'),
          team: unit.team,
          sourceUnitId: unit.id,
          weaponType: weapon.type,
          x: unit.x,
          y: unit.y,
          startX: unit.x,
          startY: unit.y,
          targetX: chosen.x,
          targetY: chosen.y,
          targetUnitId: chosen.id,
          speed: weapon.projectileSpeed,
          damage: weapon.damage,
          penetration: weapon.penetration,
          splashRadius: weapon.splashRadius,
          guided: Boolean(weapon.guided),
          indirect: false,
          progress: 0,
          alive: true,
        });

        state.events.push({
          id: nextId('ev'),
          type: 'shot',
          x: unit.x,
          y: unit.y,
          x2: chosen.x,
          y2: chosen.y,
          team: unit.team,
          weaponType: weapon.type,
          intensity: weapon.type === 'kinetic' || weapon.type === 'atgm' || weapon.type === 'sam' ? 0.9 : 0.45,
        });
      }
    }
  }
}

function registerUnitKill(state: MatchState, victim: UnitState, attackerOwnerId?: string): void {
  if (!victim.alive) return;
  victim.alive = false;
  victim.hp = 0;
  victim.koTimer = 14; // burning wreck lingers on battlefield
  const victimPlayer = state.players[victim.ownerId];
  if (victimPlayer) victimPlayer.unitsLost += 1;
  if (attackerOwnerId && state.players[attackerOwnerId]) {
    state.players[attackerOwnerId].unitsDestroyed += 1;
  }
  const tpl = UNIT_BY_ID[victim.templateId];
  state.events.push({
    id: nextId('ev'),
    type: 'unit_destroyed',
    x: victim.x,
    y: victim.y,
    team: victim.team,
    intensity: tpl?.domain === 'vehicle' || tpl?.domain === 'helicopter' ? 1.35 : 0.8,
    text: tpl ? `${tpl.shortName} DESTROYED` : undefined,
  });
}

function detonateSplash(
  state: MatchState,
  team: TeamId,
  attackerOwnerId: string | undefined,
  x: number,
  y: number,
  weapon: Pick<WeaponSpec, 'damage' | 'penetration' | 'splashRadius' | 'type' | 'indirect'>
): void {
  state.events.push({
    id: nextId('ev'),
    type: 'explosion',
    x,
    y,
    team,
    weaponType: weapon.type,
    intensity: weapon.splashRadius >= 60 ? 1.45 : 0.95,
  });

  const radius = Math.max(24, weapon.splashRadius);
  for (const unit of state.units) {
    if (!unit.alive || unit.team === team || unit.altitude === 2) continue;
    const d = Math.hypot(unit.x - x, unit.y - y);
    if (d > radius) continue;
    const falloff = 1 - (d / radius) * 0.65;
    const dmg = Math.max(6, Math.round(weapon.damage * falloff));
    unit.hp -= dmg;
    unit.hitFlash = 1.0;
    if (attackerOwnerId && state.players[attackerOwnerId]) {
      state.players[attackerOwnerId].damageDealt += dmg;
    }
    if (unit.hp <= 0) {
      registerUnitKill(state, unit, attackerOwnerId);
    }
  }
}

function stepProjectiles(state: MatchState, dt: number): void {
  for (const pr of state.projectiles) {
    if (!pr.alive) continue;

    // Guided missiles track live target unless blocked by smoke
    if (pr.guided && pr.targetUnitId) {
      const tgt = state.units.find((u) => u.id === pr.targetUnitId && u.alive);
      if (tgt) {
        if (tgt.altitude === 0 && isSegmentBlockedBySmoke(state.smokes, pr, tgt)) {
          pr.guided = false; // smoke broke lock!
        } else {
          pr.targetX = tgt.x;
          pr.targetY = tgt.y;
        }
      }
    }

    const dx = pr.targetX - pr.x;
    const dy = pr.targetY - pr.y;
    const dist = Math.hypot(dx, dy);
    const totalDist = Math.max(1, Math.hypot(pr.targetX - pr.startX, pr.targetY - pr.startY));
    const step = pr.speed * dt;

    if (dist <= step + 8) {
      pr.x = pr.targetX;
      pr.y = pr.targetY;
      pr.alive = false;

      const sourceUnit = state.units.find((u) => u.id === pr.sourceUnitId);
      const attackerOwnerId = sourceUnit?.ownerId;

      if (pr.indirect) {
        detonateSplash(state, pr.team, attackerOwnerId, pr.x, pr.y, {
          damage: pr.damage,
          penetration: pr.penetration,
          splashRadius: pr.splashRadius,
          type: pr.weaponType,
          indirect: true,
        });
        continue;
      }

      const tgt = pr.targetUnitId
        ? state.units.find((u) => u.id === pr.targetUnitId && u.alive)
        : undefined;

      if (tgt && Math.hypot(tgt.x - pr.x, tgt.y - pr.y) <= Math.max(36, pr.splashRadius + 22)) {
        const tgtTpl = UNIT_BY_ID[tgt.templateId];
        if (!tgtTpl) continue;

        // APS / Flares check
        const canIntercept =
          (pr.weaponType === 'atgm' && tgtTpl.domain === 'vehicle') ||
          (pr.weaponType === 'sam' && (tgtTpl.domain === 'helicopter' || tgtTpl.domain === 'jet'));

        if (canIntercept && tgt.apsCharges > 0 && tgt.apsCooldown <= 0) {
          tgt.apsCharges -= 1;
          tgt.apsCooldown = tgtTpl.domain === 'vehicle' ? 6.0 : 5.0;
          state.events.push({
            id: nextId('ev'),
            type: 'aps_intercept',
            x: tgt.x,
            y: tgt.y,
            team: tgt.team,
            intensity: 0.75,
            text: tgtTpl.domain === 'vehicle' ? 'APS INTERCEPT' : 'FLARES',
          });
          continue;
        }

        const dmg = computeWeaponDamage(
          {
            id: 'impact',
            name: 'impact',
            type: pr.weaponType,
            range: 0,
            damage: pr.damage,
            penetration: pr.penetration,
            splashRadius: pr.splashRadius,
            reloadSec: 1,
            burstCount: 1,
            projectileSpeed: pr.speed,
            maxAmmo: 1,
            canTargetGround: true,
            canTargetHeli: true,
            canTargetJet: true,
            indirect: pr.indirect,
          },
          tgtTpl,
          tgt,
          { x: pr.startX, y: pr.startY }
        );

        tgt.hp -= dmg;
        tgt.hitFlash = 1.0;
        if (attackerOwnerId && state.players[attackerOwnerId]) {
          state.players[attackerOwnerId].damageDealt += dmg;
        }

        if (pr.weaponType === 'kinetic' || pr.weaponType === 'atgm' || pr.weaponType === 'sam') {
          state.events.push({
            id: nextId('ev'),
            type: 'explosion',
            x: tgt.x,
            y: tgt.y,
            team: pr.team,
            weaponType: pr.weaponType,
            intensity: 0.75,
          });
        }

        if (tgt.hp <= 0) {
          registerUnitKill(state, tgt, attackerOwnerId);
        }
      } else if (pr.splashRadius >= 12) {
        detonateSplash(state, pr.team, attackerOwnerId, pr.x, pr.y, {
          damage: pr.damage * 0.7,
          penetration: pr.penetration,
          splashRadius: pr.splashRadius,
          type: pr.weaponType,
          indirect: false,
        });
      }
    } else {
      pr.x += (dx / dist) * step;
      pr.y += (dy / dist) * step;
      const traveled = Math.hypot(pr.x - pr.startX, pr.y - pr.startY);
      pr.progress = clamp(traveled / totalDist, 0, 1);
    }
  }

  state.projectiles = state.projectiles.filter((p) => p.alive);
}

function stepZonesAndEconomy(state: MatchState, dt: number): void {
  let blueZones = 0;
  let redZones = 0;

  for (const zone of state.zones) {
    let blueWeight = 0;
    let redWeight = 0;
    for (const u of state.units) {
      if (!u.alive || u.altitude >= 1) continue; // only ground units capture zones
      const d = Math.hypot(u.x - zone.x, u.y - zone.y);
      if (d <= zone.radius) {
        const tpl = UNIT_BY_ID[u.templateId];
        const weight = tpl?.category === 'infantry' ? 2.2 : tpl?.category === 'recon' ? 1.5 : 1.3;
        if (u.team === 'blue') blueWeight += weight;
        else redWeight += weight;
      }
    }

    zone.contested = blueWeight > 0 && redWeight > 0;
    const prevOwner = zone.owner;
    if (!zone.contested) {
      if (blueWeight > 0) {
        zone.captureProgress = clamp(zone.captureProgress + (10 + blueWeight * 4) * dt, -100, 100);
      } else if (redWeight > 0) {
        zone.captureProgress = clamp(zone.captureProgress - (10 + redWeight * 4) * dt, -100, 100);
      }
    }

    if (zone.captureProgress >= 100) zone.owner = 'blue';
    else if (zone.captureProgress <= -100) zone.owner = 'red';
    else if (Math.abs(zone.captureProgress) < 15) zone.owner = 'neutral';

    if (zone.owner !== prevOwner && zone.owner !== 'neutral') {
      state.events.push({
        id: nextId('ev'),
        type: 'zone_captured',
        x: zone.x,
        y: zone.y,
        team: zone.owner,
        intensity: 1.0,
        text: `SECTOR ${zone.code} SECURED`,
      });
    }

    if (zone.owner === 'blue') blueZones += 1;
    else if (zone.owner === 'red') redZones += 1;
  }

  // Victory point ticking: holding more zones than enemy ticks VP rapidly, plus steady points per zone
  if (blueZones > redZones) {
    state.blueVp += (blueZones - redZones) * 4.5 * dt;
  } else if (redZones > blueZones) {
    state.redVp += (redZones - blueZones) * 4.5 * dt;
  }
  state.blueVp += blueZones * 0.6 * dt;
  state.redVp += redZones * 0.6 * dt;

  // Requisition economy with upkeep
  for (const player of Object.values(state.players)) {
    if (player.airstrikeCooldown > 0) {
      player.airstrikeCooldown = Math.max(0, player.airstrikeCooldown - dt);
    }
    const teamZones = player.team === 'blue' ? blueZones : redZones;
    const fieldCost = state.units
      .filter((u) => u.alive && u.ownerId === player.id)
      .reduce((acc, u) => acc + (UNIT_BY_ID[u.templateId]?.cost ?? 0), 0);
    const upkeepPenalty = Math.min(10, fieldCost / 260);
    player.incomePerSec = Math.max(9, Math.round((15 + teamZones * 3.5 - upkeepPenalty) * 10) / 10);
    player.requisition = Math.min(2500, player.requisition + player.incomePerSec * dt);
  }

  // Win conditions
  if (state.blueVp >= state.vpTarget) {
    state.blueVp = state.vpTarget;
    state.status = 'victory_blue';
    state.winReason = 'Coalition secured theater dominance (1,000 VP)';
  } else if (state.redVp >= state.vpTarget) {
    state.redVp = state.vpTarget;
    state.status = 'victory_red';
    state.winReason = 'Vanguard secured theater dominance (1,000 VP)';
  } else if (state.elapsedSec >= state.durationSec) {
    if (state.blueVp > state.redVp) {
      state.status = 'victory_blue';
      state.winReason = 'Coalition held higher Victory Points at time expiry';
    } else if (state.redVp > state.blueVp) {
      state.status = 'victory_red';
      state.winReason = 'Vanguard held higher Victory Points at time expiry';
    } else {
      state.status = 'draw';
      state.winReason = 'Tactical stalemate at match timer expiry';
    }
  }
}

function stepAICommanders(state: MatchState): void {
  // Run AI tactical decisions every 1.2s (12 ticks at 10Hz)
  if (state.tick % 12 !== 0) return;

  for (const player of Object.values(state.players)) {
    if (!player.isAI) continue;

    const myUnits = state.units.filter((u) => u.alive && u.ownerId === player.id && u.altitude < 2);
    const spottedEnemies = state.units.filter(
      (u) => u.alive && u.team !== player.team && u.spottedByEnemy
    );

    // 1. Deploy reinforcements with combined-arms balance
    const desiredRoster =
      player.faction === 'coalition'
        ? ['us_rifles', 'us_bradley', 'us_abrams', 'us_lav_recon', 'us_javelin', 'us_patriot', 'us_apache', 'us_paladin']
        : ['ru_motostrelki', 'ru_bmp3', 'ru_t90m', 'ru_btr_recon', 'ru_kornet', 'ru_tor', 'ru_ka52', 'ru_msta'];

    if (player.requisition >= 150 && myUnits.length < 13) {
      // Pick first affordable unit that we have stock for and need
      const pick = desiredRoster.find((tid) => {
        const tpl = UNIT_BY_ID[tid];
        if (!tpl) return false;
        const ownedCount = myUnits.filter((u) => u.templateId === tid).length;
        const cap = tpl.category === 'support' || tpl.category === 'helicopters' ? 2 : 3;
        return (player.stock[tid] ?? 0) > 0 && player.requisition >= tpl.cost && ownedCount < cap;
      });

      if (pick) {
        const priorityZones = state.zones.filter((z) => z.owner !== player.team);
        const zone =
          priorityZones.length > 0
            ? priorityZones[(state.tick / 12 + myUnits.length) % priorityZones.length]
            : state.zones[Math.floor(state.zones.length / 2)];
        const tpl = UNIT_BY_ID[pick];
        const targetPos =
          tpl?.symbol === 'artillery' || tpl?.symbol === 'sam'
            ? {
                x: player.team === 'blue' ? 540 : 1860,
                y: zone.y,
              }
            : { x: zone.x, y: zone.y };
        applyCommand(state, player.id, { type: 'deploy', templateId: pick, targetPos });
      }
    }

    // 2. Issue distinct policies per unit archetype
    for (const u of myUnits) {
      const tpl = UNIT_BY_ID[u.templateId];
      if (!tpl) continue;

      // Pop smoke when critically damaged
      if (u.hp < u.maxHp * 0.45 && u.smokeCharges > 0 && u.smokeCooldown <= 0) {
        applyCommand(state, player.id, { type: 'smoke', unitIds: [u.id] });
      }

      // Artillery shells spotted enemy clusters
      if (tpl.symbol === 'artillery' && spottedEnemies.length > 0) {
        const target = spottedEnemies[0];
        const dist = Math.hypot(target.x - u.x, target.y - u.y);
        if (dist <= 900 && dist >= 220) {
          applyCommand(state, player.id, {
            type: 'barrage',
            unitIds: [u.id],
            targetPos: { x: target.x, y: target.y },
          });
        }
        continue;
      }

      // SAM holds rear defense behind friendly front
      if (tpl.symbol === 'sam') {
        if (u.order.type === 'idle') {
          const safeX = player.team === 'blue' ? 680 : 1720;
          if (Math.abs(u.x - safeX) > 220) {
            applyCommand(state, player.id, {
              type: 'move',
              unitIds: [u.id],
              targetPos: { x: safeX, y: 745 },
            });
          }
        }
        continue;
      }

      // Attack helicopter hunts exposed enemy armor on flanks
      if (tpl.domain === 'helicopter') {
        const enemyArmor = spottedEnemies.find((e) => UNIT_BY_ID[e.templateId]?.category === 'armor');
        if (enemyArmor && u.order.type === 'idle') {
          applyCommand(state, player.id, {
            type: 'attack_target',
            unitIds: [u.id],
            targetUnitId: enemyArmor.id,
          });
        } else if (u.order.type === 'idle') {
          const z = state.zones[0];
          applyCommand(state, player.id, {
            type: 'attack_move',
            unitIds: [u.id],
            targetPos: { x: z.x, y: z.y },
          });
        }
        continue;
      }

      // Recon probes flank sectors; Armor/Infantry contest unowned zones
      if (u.order.type === 'idle') {
        const unowned = state.zones.filter((z) => z.owner !== player.team);
        const candidates = unowned.length > 0 ? unowned : state.zones;
        let chosenZone = candidates[0];
        if (tpl.category === 'recon') {
          chosenZone = candidates[candidates.length - 1];
        } else {
          // Nearest unowned zone
          chosenZone = candidates.reduce((best, z) => {
            const db = Math.hypot(best.x - u.x, best.y - u.y);
            const dz = Math.hypot(z.x - u.x, z.y - u.y);
            return dz < db ? z : best;
          }, candidates[0]);
        }
        const distToZone = Math.hypot(chosenZone.x - u.x, chosenZone.y - u.y);
        if (distToZone > chosenZone.radius * 0.65) {
          applyCommand(state, player.id, {
            type: 'attack_move',
            unitIds: [u.id],
            targetPos: { x: chosenZone.x, y: chosenZone.y },
          });
        }
      }
    }
  }
}

export function stepMatch(state: MatchState, rawDt: number): CombatEvent[] {
  if (state.status !== 'playing') {
    state.events = [];
    return [];
  }

  const dt = Math.min(Math.max(rawDt, 0.001), 0.1);
  const map = getMapById(state.mapId);
  state.tick += 1;
  state.elapsedSec += dt;
  state.events = [];

  // Decay smokes & pings
  for (const s of state.smokes) s.remainingSec -= dt;
  state.smokes = state.smokes.filter((s) => s.remainingSec > 0);

  for (const p of state.pings) p.remainingSec -= dt;
  state.pings = state.pings.filter((p) => p.remainingSec > 0);

  // Decay dead wrecks
  for (const u of state.units) {
    if (!u.alive && u.koTimer > 0) {
      u.koTimer = Math.max(0, u.koTimer - dt);
    }
  }
  state.units = state.units.filter((u) => u.alive || u.koTimer > 0);

  // Move units
  for (const u of state.units) {
    if (!u.alive) continue;
    const tpl = UNIT_BY_ID[u.templateId];
    if (!tpl) continue;
    stepUnitMovement(u, tpl, map, state, dt);
  }

  applyUnitSeparation(state, map);
  updateVisibility(state, map);
  stepCombatAndWeapons(state, dt);
  stepProjectiles(state, dt);
  stepZonesAndEconomy(state, dt);
  stepAICommanders(state);

  return state.events;
}
