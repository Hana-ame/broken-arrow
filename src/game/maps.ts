import type { TacticalMap, Vec2 } from './types';

export const TACTICAL_MAPS: TacticalMap[] = [
  {
    id: 'baltic_port',
    name: 'Baltic River Approaches',
    region: 'Kaliningrad Sector · 2.4 × 1.5 km',
    description:
      'A winding coastal river bisects three fortified bridges, dense pine ridgelines, and an industrial port town.',
    width: 2400,
    height: 1500,
    blueSpawn: { x: 40, y: 240, w: 210, h: 1020 },
    redSpawn: { x: 2150, y: 240, w: 210, h: 1020 },
    rivers: [
      {
        width: 82,
        points: [
          { x: 1180, y: 0 },
          { x: 1240, y: 310 },
          { x: 1150, y: 690 },
          { x: 1235, y: 1080 },
          { x: 1170, y: 1500 },
        ],
      },
    ],
    roads: [
      // North highway across North Bridge
      {
        width: 34,
        points: [
          { x: 0, y: 330 },
          { x: 640, y: 310 },
          { x: 1220, y: 295 },
          { x: 1760, y: 325 },
          { x: 2400, y: 320 },
        ],
      },
      // Central arterial road across Center Bridge
      {
        width: 40,
        points: [
          { x: 0, y: 750 },
          { x: 560, y: 740 },
          { x: 1165, y: 745 },
          { x: 1840, y: 745 },
          { x: 2400, y: 750 },
        ],
      },
      // South logistics highway across South Bridge
      {
        width: 34,
        points: [
          { x: 0, y: 1180 },
          { x: 690, y: 1190 },
          { x: 1220, y: 1170 },
          { x: 1780, y: 1180 },
          { x: 2400, y: 1185 },
        ],
      },
      // West & East cross-connectors
      {
        width: 24,
        points: [
          { x: 640, y: 310 },
          { x: 560, y: 740 },
          { x: 690, y: 1190 },
        ],
      },
      {
        width: 24,
        points: [
          { x: 1760, y: 325 },
          { x: 1840, y: 745 },
          { x: 1780, y: 1180 },
        ],
      },
    ],
    features: [
      // Strategic Bridges across river
      { id: 'br_north', x: 1125, y: 255, w: 185, h: 80, kind: 'bridge', label: 'North Bridge' },
      { id: 'br_center', x: 1075, y: 705, w: 185, h: 86, kind: 'bridge', label: 'Central Bridge' },
      { id: 'br_south', x: 1125, y: 1130, w: 185, h: 80, kind: 'bridge', label: 'South Bridge' },
      // Forests (stealth + cover)
      { id: 'f_nw', x: 380, y: 100, w: 300, h: 170, kind: 'forest' },
      { id: 'f_ne', x: 1700, y: 95, w: 310, h: 175, kind: 'forest' },
      { id: 'f_mid_w1', x: 760, y: 420, w: 240, h: 200, kind: 'forest' },
      { id: 'f_mid_e1', x: 1380, y: 430, w: 250, h: 190, kind: 'forest' },
      { id: 'f_mid_w2', x: 780, y: 865, w: 235, h: 205, kind: 'forest' },
      { id: 'f_mid_e2', x: 1390, y: 860, w: 245, h: 200, kind: 'forest' },
      { id: 'f_sw', x: 350, y: 1240, w: 310, h: 170, kind: 'forest' },
      { id: 'f_se', x: 1720, y: 1245, w: 300, h: 170, kind: 'forest' },
      // Urban industrial districts (strong infantry cover)
      { id: 'u_west_depot', x: 520, y: 635, w: 170, h: 210, kind: 'urban', label: 'West Depot' },
      { id: 'u_east_depot', x: 1705, y: 635, w: 170, h: 210, kind: 'urban', label: 'East Yard' },
      { id: 'u_north_town', x: 960, y: 150, w: 145, h: 120, kind: 'urban' },
      { id: 'u_south_port', x: 1320, y: 1215, w: 155, h: 125, kind: 'urban' },
      // Elevated ridges
      { id: 'h_w', x: 330, y: 440, w: 165, h: 150, kind: 'hill' },
      { id: 'h_e', x: 1900, y: 450, w: 165, h: 150, kind: 'hill' },
    ],
    zones: [
      { id: 'z_alpha', code: 'A', name: 'Alpha Crossing', x: 1215, y: 295, radius: 130 },
      { id: 'z_bravo', code: 'B', name: 'Bravo Depot', x: 645, y: 745, radius: 130 },
      { id: 'z_charlie', code: 'C', name: 'Charlie Bridgehead', x: 1170, y: 745, radius: 145 },
      { id: 'z_delta', code: 'D', name: 'Delta Rail Yard', x: 1755, y: 745, radius: 130 },
      { id: 'z_echo', code: 'E', name: 'Echo Port', x: 1215, y: 1175, radius: 130 },
    ],
  },
  {
    id: 'suwalki_corridor',
    name: 'Suwalki Highway Corridor',
    region: 'Baltic Gap · 2.4 × 1.5 km',
    description:
      'Open armored maneuver plains framed by twin fortified towns and wooded flanking ridges ideal for combined-arms encirclements.',
    width: 2400,
    height: 1500,
    blueSpawn: { x: 40, y: 200, w: 210, h: 1100 },
    redSpawn: { x: 2150, y: 200, w: 210, h: 1100 },
    rivers: [],
    roads: [
      {
        width: 44,
        points: [
          { x: 0, y: 750 },
          { x: 750, y: 745 },
          { x: 1200, y: 750 },
          { x: 1650, y: 755 },
          { x: 2400, y: 750 },
        ],
      },
      {
        width: 28,
        points: [
          { x: 400, y: 750 },
          { x: 840, y: 310 },
          { x: 1560, y: 310 },
          { x: 2000, y: 750 },
        ],
      },
      {
        width: 28,
        points: [
          { x: 400, y: 750 },
          { x: 840, y: 1190 },
          { x: 1560, y: 1190 },
          { x: 2000, y: 750 },
        ],
      },
    ],
    features: [
      { id: 's_u1', x: 1100, y: 660, w: 200, h: 180, kind: 'urban', label: 'Crossroads' },
      { id: 's_u2', x: 760, y: 230, w: 180, h: 140, kind: 'urban' },
      { id: 's_u3', x: 1460, y: 230, w: 180, h: 140, kind: 'urban' },
      { id: 's_u4', x: 760, y: 1120, w: 180, h: 140, kind: 'urban' },
      { id: 's_u5', x: 1460, y: 1120, w: 180, h: 140, kind: 'urban' },
      { id: 's_f1', x: 1050, y: 120, w: 300, h: 180, kind: 'forest' },
      { id: 's_f2', x: 1050, y: 1200, w: 300, h: 180, kind: 'forest' },
      { id: 's_f3', x: 520, y: 450, w: 220, h: 170, kind: 'forest' },
      { id: 's_f4', x: 1660, y: 450, w: 220, h: 170, kind: 'forest' },
      { id: 's_f5', x: 520, y: 880, w: 220, h: 170, kind: 'forest' },
      { id: 's_f6', x: 1660, y: 880, w: 220, h: 170, kind: 'forest' },
      { id: 's_h1', x: 880, y: 480, w: 150, h: 130, kind: 'hill' },
      { id: 's_h2', x: 1370, y: 890, w: 150, h: 130, kind: 'hill' },
    ],
    zones: [
      { id: 'sz_a', code: 'A', name: 'North Ridge', x: 1200, y: 260, radius: 135 },
      { id: 'sz_b', code: 'B', name: 'West Hamlet', x: 760, y: 750, radius: 130 },
      { id: 'sz_c', code: 'C', name: 'Highway Junction', x: 1200, y: 750, radius: 145 },
      { id: 'sz_d', code: 'D', name: 'East Hamlet', x: 1640, y: 750, radius: 130 },
      { id: 'sz_e', code: 'E', name: 'South Pines', x: 1200, y: 1240, radius: 135 },
    ],
  },
];

export const MAP_BY_ID: Record<string, TacticalMap> = Object.fromEntries(
  TACTICAL_MAPS.map((m) => [m.id, m])
);

export function getMapById(mapId: string): TacticalMap {
  return MAP_BY_ID[mapId] ?? TACTICAL_MAPS[0];
}

function distToSegmentSq(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return (p.x - a.x) ** 2 + (p.y - a.y) ** 2;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
  const px = a.x + t * dx;
  const py = a.y + t * dy;
  return (p.x - px) ** 2 + (p.y - py) ** 2;
}

export function isOnBridge(map: TacticalMap, pos: Vec2): boolean {
  for (const f of map.features) {
    if (f.kind !== 'bridge') continue;
    if (pos.x >= f.x && pos.x <= f.x + f.w && pos.y >= f.y && pos.y <= f.y + f.h) {
      return true;
    }
  }
  return false;
}

export function isWaterBlocked(map: TacticalMap, pos: Vec2): boolean {
  if (map.rivers.length === 0) return false;
  if (isOnBridge(map, pos)) return false;
  for (const r of map.rivers) {
    const halfW = r.width * 0.5;
    const halfWSq = halfW * halfW;
    for (let i = 0; i < r.points.length - 1; i++) {
      if (distToSegmentSq(pos, r.points[i], r.points[i + 1]) <= halfWSq) {
        return true;
      }
    }
  }
  return false;
}

export function isInCover(map: TacticalMap, pos: Vec2): boolean {
  for (const f of map.features) {
    if (f.kind !== 'forest' && f.kind !== 'urban') continue;
    if (pos.x >= f.x && pos.x <= f.x + f.w && pos.y >= f.y && pos.y <= f.y + f.h) {
      return true;
    }
  }
  return false;
}

export function isOnRoad(map: TacticalMap, pos: Vec2): boolean {
  for (const r of map.roads) {
    const halfW = r.width * 0.65;
    const halfWSq = halfW * halfW;
    for (let i = 0; i < r.points.length - 1; i++) {
      if (distToSegmentSq(pos, r.points[i], r.points[i + 1]) <= halfWSq) {
        return true;
      }
    }
  }
  return false;
}

/** Find nearest bridge center when crossing a river */
export function findNearestBridgeCenter(map: TacticalMap, from: Vec2, to: Vec2): Vec2 | null {
  const bridges = map.features.filter((f) => f.kind === 'bridge');
  if (bridges.length === 0) return null;
  let best: Vec2 | null = null;
  let bestScore = Infinity;
  for (const b of bridges) {
    const cx = b.x + b.w * 0.5;
    const cy = b.y + b.h * 0.5;
    const score = Math.hypot(cx - from.x, cy - from.y) + Math.hypot(to.x - cx, to.y - cy);
    if (score < bestScore) {
      bestScore = score;
      best = { x: cx, y: cy };
    }
  }
  return best;
}
