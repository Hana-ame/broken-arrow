export type FactionId = 'coalition' | 'vanguard';
export type TeamId = 'blue' | 'red';
export type SpecializationId = 'armored' | 'airborne' | 'mechanized' | 'support';
export type UnitCategory = 'recon' | 'infantry' | 'armor' | 'support' | 'helicopters' | 'air';
export type DomainType = 'infantry' | 'vehicle' | 'helicopter' | 'jet';

export interface WeaponSpec {
  id: string;
  name: string;
  type: 'kinetic' | 'autocannon' | 'atgm' | 'small_arms' | 'artillery' | 'sam' | 'bomb';
  range: number; // world units
  minRange?: number;
  damage: number;
  penetration: number; // compares against target armor
  splashRadius: number;
  reloadSec: number;
  burstCount: number;
  projectileSpeed: number;
  maxAmmo: number;
  canTargetGround: boolean;
  canTargetHeli: boolean;
  canTargetJet: boolean;
  guided?: boolean;
  indirect?: boolean;
}

export interface UnitTemplate {
  id: string;
  name: string;
  shortName: string;
  faction: FactionId;
  category: UnitCategory;
  spec: SpecializationId;
  domain: DomainType;
  roleClue: string;
  cost: number;
  maxStock: number;
  hp: number;
  speed: number; // world units / sec
  armorFront: number;
  armorSide: number;
  armorRear: number;
  optics: number; // detection radius
  stealth: number; // 0..1 reduces enemy detection radius
  hasSmoke: boolean;
  smokeCharges: number;
  apsCharges: number; // intercepts ATGMs (ground) or flares (air)
  isSupply?: boolean;
  supplyCapacity?: number;
  weapons: WeaponSpec[];
  symbol: 'recon' | 'infantry' | 'atgm' | 'manpads' | 'tank' | 'ifv' | 'artillery' | 'sam' | 'supply' | 'heli_atk' | 'heli_recon' | 'jet_strike';
}

export interface DeckEntry {
  templateId: string;
  count: number;
}

export interface BattlegroupDeck {
  id: string;
  name: string;
  faction: FactionId;
  specs: [SpecializationId, SpecializationId];
  entries: DeckEntry[];
}

export interface Vec2 {
  x: number;
  y: number;
}

export interface RectFeature {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  kind: 'forest' | 'urban' | 'bridge' | 'hill';
  label?: string;
}

export interface RiverSegment {
  points: Vec2[];
  width: number;
}

export interface RoadSegment {
  points: Vec2[];
  width: number;
}

export interface CaptureZoneDef {
  id: string;
  code: string;
  name: string;
  x: number;
  y: number;
  radius: number;
}

export interface TacticalMap {
  id: string;
  name: string;
  region: string;
  description: string;
  width: number;
  height: number;
  blueSpawn: { x: number; y: number; w: number; h: number };
  redSpawn: { x: number; y: number; w: number; h: number };
  rivers: RiverSegment[];
  roads: RoadSegment[];
  features: RectFeature[];
  zones: CaptureZoneDef[];
}

export type OrderType = 'idle' | 'move' | 'attack_move' | 'attack_target' | 'barrage' | 'retreat';

export interface UnitOrder {
  type: OrderType;
  targetPos?: Vec2;
  targetUnitId?: string;
}

export interface UnitState {
  id: string;
  templateId: string;
  ownerId: string;
  team: TeamId;
  x: number;
  y: number;
  vx: number;
  vy: number;
  facing: number; // radians
  turretFacing: number;
  hp: number;
  maxHp: number;
  ammo: number[]; // per weapon index
  reloadTimers: number[];
  apsCharges: number;
  apsCooldown: number;
  smokeCharges: number;
  smokeCooldown: number;
  supplyRemaining: number;
  holdFire: boolean;
  inCover: boolean;
  spottedByEnemy: boolean;
  hitFlash: number; // 0..1
  order: UnitOrder;
  alive: boolean;
  koTimer: number; // lingers as burning wreck before fading
  retreatRefunded?: boolean;
  altitude: number; // 0 ground, 1 heli, 2 jet
  jetExitPos?: Vec2;
  jetBombDropped?: boolean;
}

export interface ProjectileState {
  id: string;
  team: TeamId;
  sourceUnitId: string;
  weaponType: WeaponSpec['type'];
  x: number;
  y: number;
  startX: number;
  startY: number;
  targetX: number;
  targetY: number;
  targetUnitId?: string;
  speed: number;
  damage: number;
  penetration: number;
  splashRadius: number;
  guided: boolean;
  indirect: boolean;
  progress: number; // 0..1 for indirect arc
  alive: boolean;
}

export interface SmokeCloud {
  id: string;
  x: number;
  y: number;
  radius: number;
  remainingSec: number;
  maxSec: number;
}

export interface ZoneState {
  id: string;
  code: string;
  name: string;
  x: number;
  y: number;
  radius: number;
  owner: TeamId | 'neutral';
  captureProgress: number; // -100 (red) .. +100 (blue)
  contested: boolean;
}

export interface MapPing {
  id: string;
  team: TeamId;
  playerName: string;
  x: number;
  y: number;
  label: string;
  remainingSec: number;
}

export interface CombatEvent {
  id: string;
  type: 'shot' | 'explosion' | 'aps_intercept' | 'smoke' | 'unit_destroyed' | 'zone_captured' | 'airstrike_inbound' | 'resupply';
  x: number;
  y: number;
  x2?: number;
  y2?: number;
  team?: TeamId;
  weaponType?: WeaponSpec['type'];
  intensity: number; // 0.3..1.5
  text?: string;
}

export interface PlayerMatchState {
  id: string;
  name: string;
  team: TeamId;
  faction: FactionId;
  isAI: boolean;
  requisition: number;
  incomePerSec: number;
  stock: Record<string, number>;
  unitsLost: number;
  unitsDestroyed: number;
  damageDealt: number;
  airstrikeCooldown: number;
}

export interface MatchState {
  id: string;
  mapId: string;
  tick: number;
  elapsedSec: number;
  durationSec: number;
  vpTarget: number;
  blueVp: number;
  redVp: number;
  status: 'playing' | 'victory_blue' | 'victory_red' | 'draw';
  winReason?: string;
  players: Record<string, PlayerMatchState>;
  zones: ZoneState[];
  units: UnitState[];
  projectiles: ProjectileState[];
  smokes: SmokeCloud[];
  pings: MapPing[];
  events: CombatEvent[]; // cleared every tick on server / consumed by client
}

export type GameCommand =
  | { type: 'deploy'; templateId: string; targetPos?: Vec2 }
  | { type: 'move'; unitIds: string[]; targetPos: Vec2 }
  | { type: 'attack_move'; unitIds: string[]; targetPos: Vec2 }
  | { type: 'attack_target'; unitIds: string[]; targetUnitId: string }
  | { type: 'barrage'; unitIds: string[]; targetPos: Vec2 }
  | { type: 'smoke'; unitIds: string[] }
  | { type: 'toggle_hold_fire'; unitIds: string[] }
  | { type: 'retreat'; unitIds: string[] }
  | { type: 'airstrike'; templateId: string; targetPos: Vec2 }
  | { type: 'ping'; targetPos: Vec2; label: string };

export interface LobbyPlayer {
  id: string;
  name: string;
  team: TeamId;
  faction: FactionId;
  ready: boolean;
  isHost: boolean;
  deck: BattlegroupDeck;
}

export interface RoomSummary {
  code: string;
  name: string;
  mapId: string;
  playerCount: number;
  maxPlayers: number;
  status: 'lobby' | 'playing' | 'finished';
  fillWithAI: boolean;
}

export interface RoomDetail extends RoomSummary {
  players: LobbyPlayer[];
  chat: ChatMessage[];
}

export interface ChatMessage {
  id: string;
  sender: string;
  team?: TeamId;
  text: string;
  timestamp: number;
}
