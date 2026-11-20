import { UNIT_BY_ID } from './catalog';
import { getMapById } from './maps';
import type { CombatEvent, MatchState, TacticalMap, TeamId, UnitState, UnitTemplate, Vec2 } from './types';

export interface CameraState {
  x: number; // world center X
  y: number; // world center Y
  zoom: number; // 0.45..1.65
  shakeTrauma: number;
}

interface Particle {
  active: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  grow: number;
  color: string;
  ring?: boolean;
}

interface FloatingCallout {
  x: number;
  y: number;
  text: string;
  color: string;
  life: number;
  maxLife: number;
}

interface TracerBeam {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
  width: number;
  life: number;
  maxLife: number;
}

export interface RenderInteractionOverlay {
  selectedIds: Set<string>;
  dragBox: { x1: number; y1: number; x2: number; y2: number } | null;
  commandMode: 'normal' | 'attack_move' | 'barrage' | 'airstrike' | 'ping' | 'deploy';
  cursorWorld: Vec2 | null;
  deployTemplateId: string | null;
  viewerTeam: TeamId;
}

const PARTICLE_POOL_SIZE = 420;

export class TacticalRenderer {
  private particles: Particle[] = [];
  private particleCursor = 0;
  private callouts: FloatingCallout[] = [];
  private tracers: TracerBeam[] = [];
  private animTime = 0;
  private terrainCache: { mapId: string; canvas: HTMLCanvasElement } | null = null;
  private minimapBgCache: { mapId: string; w: number; h: number; canvas: HTMLCanvasElement } | null = null;

  constructor() {
    for (let i = 0; i < PARTICLE_POOL_SIZE; i++) {
      this.particles.push({
        active: false,
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
        life: 0,
        maxLife: 1,
        size: 4,
        grow: 0,
        color: '#ffffff',
      });
    }
  }

  private spawnParticle(
    x: number,
    y: number,
    vx: number,
    vy: number,
    life: number,
    size: number,
    grow: number,
    color: string,
    ring = false
  ): void {
    const p = this.particles[this.particleCursor];
    this.particleCursor = (this.particleCursor + 1) % PARTICLE_POOL_SIZE;
    p.active = true;
    p.x = x;
    p.y = y;
    p.vx = vx;
    p.vy = vy;
    p.life = life;
    p.maxLife = life;
    p.size = size;
    p.grow = grow;
    p.color = color;
    p.ring = ring;
  }

  public ingestEvents(events: CombatEvent[], camera: CameraState): void {
    for (const ev of events) {
      if (ev.type === 'shot' && ev.x2 !== undefined && ev.y2 !== undefined) {
        const isHeavy = ev.weaponType === 'kinetic' || ev.weaponType === 'artillery';
        this.tracers.push({
          x1: ev.x,
          y1: ev.y,
          x2: ev.x + (ev.x2 - ev.x) * (isHeavy ? 0.35 : 0.6),
          y2: ev.y + (ev.y2 - ev.y) * (isHeavy ? 0.35 : 0.6),
          color:
            ev.weaponType === 'kinetic'
              ? '#fde68a'
              : ev.weaponType === 'atgm' || ev.weaponType === 'sam'
              ? '#fb923c'
              : '#fef3c7',
          width: isHeavy ? 2.8 : 1.4,
          life: isHeavy ? 0.16 : 0.1,
          maxLife: isHeavy ? 0.16 : 0.1,
        });
        for (let i = 0; i < (isHeavy ? 5 : 2); i++) {
          const ang = Math.atan2(ev.y2 - ev.y, ev.x2 - ev.x) + (Math.random() - 0.5) * 0.7;
          const spd = 28 + Math.random() * 60;
          this.spawnParticle(
            ev.x,
            ev.y,
            Math.cos(ang) * spd,
            Math.sin(ang) * spd,
            0.25 + Math.random() * 0.2,
            isHeavy ? 5 : 3,
            10,
            isHeavy ? '#f59e0b' : '#cbd5e1'
          );
        }
      } else if (ev.type === 'explosion' || ev.type === 'unit_destroyed') {
        const count = ev.type === 'unit_destroyed' ? 22 : Math.round(10 * ev.intensity);
        camera.shakeTrauma = Math.min(1, camera.shakeTrauma + 0.14 * ev.intensity);
        this.spawnParticle(ev.x, ev.y, 0, 0, 0.36, 10 * ev.intensity, 125 * ev.intensity, '#fb923c', true);
        for (let i = 0; i < count; i++) {
          const ang = Math.random() * Math.PI * 2;
          const spd = (25 + Math.random() * 105) * ev.intensity;
          const isFire = i % 2 === 0;
          this.spawnParticle(
            ev.x,
            ev.y,
            Math.cos(ang) * spd,
            Math.sin(ang) * spd,
            (isFire ? 0.32 : 0.72) + Math.random() * 0.35,
            isFire ? 5 * ev.intensity : 7 * ev.intensity,
            isFire ? 8 : 20,
            isFire ? '#f97316' : '#374151'
          );
        }
        if (ev.text) {
          this.callouts.push({
            x: ev.x,
            y: ev.y - 18,
            text: ev.text,
            color: ev.team === 'blue' ? '#93c5fd' : '#fca5a5',
            life: 1.6,
            maxLife: 1.6,
          });
        }
      } else if (ev.type === 'aps_intercept') {
        this.spawnParticle(ev.x, ev.y, 0, 0, 0.26, 8, 90, '#38bdf8', true);
        for (let i = 0; i < 8; i++) {
          const ang = Math.random() * Math.PI * 2;
          this.spawnParticle(ev.x, ev.y, Math.cos(ang) * 90, Math.sin(ang) * 90, 0.24, 3, 2, '#e0f2fe');
        }
        this.callouts.push({
          x: ev.x,
          y: ev.y - 22,
          text: ev.text ?? 'APS INTERCEPT',
          color: '#7dd3fc',
          life: 1.25,
          maxLife: 1.25,
        });
      } else if (ev.type === 'smoke') {
        for (let i = 0; i < 10; i++) {
          const ang = Math.random() * Math.PI * 2;
          this.spawnParticle(ev.x, ev.y, Math.cos(ang) * 35, Math.sin(ang) * 35, 0.9, 12, 26, '#cbd5e1');
        }
      } else if (ev.type === 'zone_captured' && ev.text) {
        this.callouts.push({
          x: ev.x,
          y: ev.y - 26,
          text: ev.text,
          color: ev.team === 'blue' ? '#60a5fa' : '#f87171',
          life: 2.2,
          maxLife: 2.2,
        });
      } else if (ev.type === 'airstrike_inbound' && ev.text) {
        this.spawnParticle(ev.x, ev.y, 0, 0, 0.9, 24, 85, '#eab308', true);
        this.callouts.push({
          x: ev.x,
          y: ev.y - 24,
          text: ev.text,
          color: '#fde047',
          life: 2.0,
          maxLife: 2.0,
        });
      } else if (ev.type === 'resupply') {
        this.spawnParticle(ev.x, ev.y - 10, 0, -24, 0.55, 4, 2, '#4ade80');
      }
    }
  }

  public stepEffects(dt: number, camera: CameraState): void {
    this.animTime += dt;
    if (camera.shakeTrauma > 0) {
      camera.shakeTrauma = Math.max(0, camera.shakeTrauma - dt * 1.9);
    }

    for (let i = 0; i < PARTICLE_POOL_SIZE; i++) {
      const p = this.particles[i];
      if (!p.active) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.active = false;
        continue;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.94;
      p.vy *= 0.94;
      p.size += p.grow * dt;
    }

    for (const t of this.tracers) t.life -= dt;
    this.tracers = this.tracers.filter((t) => t.life > 0);

    for (const c of this.callouts) {
      c.life -= dt;
      c.y -= 18 * dt;
    }
    this.callouts = this.callouts.filter((c) => c.life > 0);
  }

  public renderBattlefield(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    state: MatchState,
    camera: CameraState,
    overlay: RenderInteractionOverlay
  ): void {
    const map = getMapById(state.mapId);
    ctx.save();
    ctx.fillStyle = '#0e1518';
    ctx.fillRect(0, 0, width, height);

    const shake = camera.shakeTrauma * camera.shakeTrauma * 12;
    const shakeX = shake > 0.1 ? (Math.sin(this.animTime * 57) * shake) : 0;
    const shakeY = shake > 0.1 ? (Math.cos(this.animTime * 49) * shake) : 0;

    ctx.translate(width * 0.5 + shakeX, height * 0.5 + shakeY);
    ctx.scale(camera.zoom, camera.zoom);
    ctx.translate(-camera.x, -camera.y);

    this.drawCachedTerrain(ctx, map, camera, width, height);
    this.drawCaptureZones(ctx, state);
    this.drawOrderLines(ctx, state, overlay);
    this.drawWrecksAndGroundUnits(ctx, state, overlay);
    this.drawSmokes(ctx, state);
    this.drawAirUnits(ctx, state, overlay);
    this.drawProjectilesAndEffects(ctx, state);
    this.drawPingsAndReticles(ctx, state, overlay);

    ctx.restore();

    // Screen-space drag selection marquee
    if (overlay.dragBox) {
      const { x1, y1, x2, y2 } = overlay.dragBox;
      const rx = Math.min(x1, x2);
      const ry = Math.min(y1, y2);
      const rw = Math.abs(x2 - x1);
      const rh = Math.abs(y2 - y1);
      ctx.save();
      ctx.fillStyle = 'rgba(59, 130, 246, 0.14)';
      ctx.strokeStyle = 'rgba(96, 165, 250, 0.9)';
      ctx.lineWidth = 1.5;
      ctx.fillRect(rx, ry, rw, rh);
      ctx.strokeRect(rx, ry, rw, rh);
      ctx.restore();
    }
  }

  private drawCachedTerrain(
    ctx: CanvasRenderingContext2D,
    map: TacticalMap,
    camera: CameraState,
    viewW: number,
    viewH: number
  ): void {
    const cacheScale = 0.5;
    if (typeof document === 'undefined') {
      this.drawTerrain(ctx, map);
      return;
    }
    if (!this.terrainCache || this.terrainCache.mapId !== map.id) {
      const off = document.createElement('canvas');
      off.width = Math.round(map.width * cacheScale);
      off.height = Math.round(map.height * cacheScale);
      const octx = off.getContext('2d');
      if (octx) {
        octx.scale(cacheScale, cacheScale);
        this.drawTerrain(octx, map);
      }
      this.terrainCache = { mapId: map.id, canvas: off };
    }

    const halfW = (viewW * 0.5) / camera.zoom + 60;
    const halfH = (viewH * 0.5) / camera.zoom + 60;
    const wx0 = Math.max(0, Math.floor(camera.x - halfW));
    const wy0 = Math.max(0, Math.floor(camera.y - halfH));
    const wx1 = Math.min(map.width, Math.ceil(camera.x + halfW));
    const wy1 = Math.min(map.height, Math.ceil(camera.y + halfH));
    const ww = wx1 - wx0;
    const wh = wy1 - wy0;
    if (ww > 0 && wh > 0) {
      ctx.drawImage(
        this.terrainCache.canvas,
        wx0 * cacheScale,
        wy0 * cacheScale,
        ww * cacheScale,
        wh * cacheScale,
        wx0,
        wy0,
        ww,
        wh
      );
    }
  }

  private drawTerrain(ctx: CanvasRenderingContext2D, map: TacticalMap): void {
    // Base muted olive-drab Baltic landmass
    ctx.fillStyle = '#253129';
    ctx.fillRect(0, 0, map.width, map.height);

    // Subtle elevation patches & contour rings
    ctx.fillStyle = '#2b392f';
    for (let x = 180; x < map.width; x += 480) {
      for (let y = 160; y < map.height; y += 390) {
        ctx.beginPath();
        ctx.ellipse(x, y, 210, 130, (x + y) * 0.001, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Fine MGRS tactical grid
    ctx.strokeStyle = 'rgba(203, 213, 225, 0.05)';
    ctx.lineWidth = 1;
    for (let x = 0; x <= map.width; x += 200) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, map.height);
      ctx.stroke();
    }
    for (let y = 0; y <= map.height; y += 200) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(map.width, y);
      ctx.stroke();
    }

    // Spawn corridors
    const drawSpawn = (rect: { x: number; y: number; w: number; h: number }, color: string, label: string) => {
      ctx.save();
      ctx.fillStyle = color;
      ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
      ctx.strokeStyle = label.includes('COALITION') ? 'rgba(59,130,246,0.45)' : 'rgba(239,68,68,0.45)';
      ctx.lineWidth = 2;
      ctx.setLineDash([10, 6]);
      ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(226,232,240,0.45)';
      ctx.font = '600 13px "Barlow Condensed", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(label, rect.x + rect.w * 0.5, rect.y + 22);
      ctx.restore();
    };
    drawSpawn(map.blueSpawn, 'rgba(37, 99, 235, 0.09)', 'COALITION DEPLOYMENT');
    drawSpawn(map.redSpawn, 'rgba(220, 38, 38, 0.09)', 'VANGUARD DEPLOYMENT');

    // Rivers
    for (const r of map.rivers) {
      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      // Riverbank mud edge
      ctx.strokeStyle = '#383d32';
      ctx.lineWidth = r.width + 18;
      ctx.beginPath();
      r.points.forEach((pt, i) => (i === 0 ? ctx.moveTo(pt.x, pt.y) : ctx.lineTo(pt.x, pt.y)));
      ctx.stroke();
      // Deep slate-blue water
      ctx.strokeStyle = '#1b3848';
      ctx.lineWidth = r.width;
      ctx.stroke();
      // Subtle water current highlight
      ctx.strokeStyle = 'rgba(125, 211, 252, 0.12)';
      ctx.lineWidth = r.width * 0.35;
      ctx.setLineDash([28, 22]);
      ctx.lineDashOffset = -this.animTime * 14;
      ctx.stroke();
      ctx.restore();
    }

    // Roads
    for (const rd of map.roads) {
      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = '#333b3c';
      ctx.lineWidth = rd.width;
      ctx.beginPath();
      rd.points.forEach((pt, i) => (i === 0 ? ctx.moveTo(pt.x, pt.y) : ctx.lineTo(pt.x, pt.y)));
      ctx.stroke();

      ctx.strokeStyle = 'rgba(203, 213, 225, 0.2)';
      ctx.lineWidth = 2;
      ctx.setLineDash([14, 14]);
      ctx.stroke();
      ctx.restore();
    }

    // Terrain Features (hills, forests, urban, bridges)
    for (const f of map.features) {
      if (f.kind === 'hill') {
        ctx.save();
        ctx.strokeStyle = 'rgba(180, 198, 175, 0.18)';
        ctx.lineWidth = 1.5;
        for (let ring = 0; ring < 3; ring++) {
          ctx.beginPath();
          ctx.ellipse(
            f.x + f.w * 0.5,
            f.y + f.h * 0.5,
            f.w * (0.5 - ring * 0.14),
            f.h * (0.5 - ring * 0.14),
            0,
            0,
            Math.PI * 2
          );
          ctx.stroke();
        }
        ctx.restore();
      } else if (f.kind === 'forest') {
        ctx.save();
        ctx.fillStyle = 'rgba(22, 41, 26, 0.85)';
        ctx.beginPath();
        ctx.roundRect(f.x, f.y, f.w, f.h, 24);
        ctx.fill();
        ctx.strokeStyle = 'rgba(74, 117, 78, 0.32)';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Deterministic pine canopy cluster
        const cols = Math.max(3, Math.floor(f.w / 34));
        const rows = Math.max(2, Math.floor(f.h / 34));
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            const jx = ((r * 31 + c * 17) % 11) - 5;
            const jy = ((r * 13 + c * 29) % 11) - 5;
            const cx = f.x + 20 + c * ((f.w - 40) / Math.max(1, cols - 1)) + jx;
            const cy = f.y + 20 + r * ((f.h - 40) / Math.max(1, rows - 1)) + jy;
            ctx.fillStyle = (r + c) % 2 === 0 ? '#1d3a24' : '#264a2e';
            ctx.beginPath();
            ctx.arc(cx, cy, 13, 0, Math.PI * 2);
            ctx.fill();
          }
        }
        ctx.restore();
      } else if (f.kind === 'urban') {
        ctx.save();
        ctx.fillStyle = '#2d3336';
        ctx.fillRect(f.x, f.y, f.w, f.h);
        ctx.strokeStyle = 'rgba(148, 163, 184, 0.25)';
        ctx.lineWidth = 1;
        ctx.strokeRect(f.x, f.y, f.w, f.h);

        // Industrial concrete buildings inside block
        const bxCount = Math.max(2, Math.floor(f.w / 52));
        const byCount = Math.max(2, Math.floor(f.h / 52));
        for (let by = 0; by < byCount; by++) {
          for (let bx = 0; bx < bxCount; bx++) {
            const rx = f.x + 10 + bx * ((f.w - 20) / bxCount);
            const ry = f.y + 10 + by * ((f.h - 20) / byCount);
            const rw = (f.w - 20) / bxCount - 10;
            const rh = (f.h - 20) / byCount - 10;
            ctx.fillStyle = '#1b2023';
            ctx.fillRect(rx + 3, ry + 3, rw, rh);
            ctx.fillStyle = (bx + by) % 2 === 0 ? '#454e54' : '#3a4247';
            ctx.fillRect(rx, ry, rw, rh);
            ctx.strokeStyle = 'rgba(226, 232, 240, 0.16)';
            ctx.strokeRect(rx, ry, rw, rh);
          }
        }
        ctx.restore();
      } else if (f.kind === 'bridge') {
        ctx.save();
        ctx.fillStyle = '#474f52';
        ctx.fillRect(f.x, f.y, f.w, f.h);
        ctx.strokeStyle = '#94a3b8';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(f.x, f.y + 3);
        ctx.lineTo(f.x + f.w, f.y + 3);
        ctx.moveTo(f.x, f.y + f.h - 3);
        ctx.lineTo(f.x + f.w, f.y + f.h - 3);
        ctx.stroke();
        ctx.restore();
      }
    }

    // Outer map border
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.35)';
    ctx.lineWidth = 3;
    ctx.strokeRect(0, 0, map.width, map.height);
  }

  private drawCaptureZones(ctx: CanvasRenderingContext2D, state: MatchState): void {
    for (const z of state.zones) {
      ctx.save();
      const baseColor =
        z.owner === 'blue' ? '#3b82f6' : z.owner === 'red' ? '#ef4444' : '#cbd5e1';
      const fillTint =
        z.owner === 'blue'
          ? 'rgba(59, 130, 246, 0.12)'
          : z.owner === 'red'
          ? 'rgba(239, 68, 68, 0.12)'
          : 'rgba(203, 213, 225, 0.06)';

      ctx.fillStyle = fillTint;
      ctx.beginPath();
      ctx.arc(z.x, z.y, z.radius, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = z.contested ? '#eab308' : baseColor;
      ctx.lineWidth = 2.5;
      ctx.setLineDash([12, 8]);
      ctx.beginPath();
      ctx.arc(z.x, z.y, z.radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);

      // Radial capture progress arc
      if (Math.abs(z.captureProgress) > 1) {
        const frac = Math.abs(z.captureProgress) / 100;
        ctx.strokeStyle = z.captureProgress > 0 ? '#60a5fa' : '#f87171';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(z.x, z.y, z.radius - 6, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac);
        ctx.stroke();
      }

      // Sector center marker
      ctx.fillStyle = '#10161a';
      ctx.strokeStyle = z.contested ? '#eab308' : baseColor;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(z.x, z.y, 20, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#f8fafc';
      ctx.font = '700 18px "Barlow Condensed", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(z.code, z.x, z.y + 1);

      ctx.fillStyle = z.contested ? '#fde047' : 'rgba(226, 232, 240, 0.85)';
      ctx.font = '600 12px "Public Sans", sans-serif';
      ctx.fillText(z.contested ? 'CONTESTED' : z.name.toUpperCase(), z.x, z.y + 33);
      ctx.restore();
    }
  }

  private drawOrderLines(
    ctx: CanvasRenderingContext2D,
    state: MatchState,
    overlay: RenderInteractionOverlay
  ): void {
    for (const u of state.units) {
      if (!u.alive || u.team !== overlay.viewerTeam) continue;
      const isSelected = overlay.selectedIds.has(u.id);
      if (!isSelected && u.order.type !== 'barrage') continue;

      if (u.order.targetPos) {
        ctx.save();
        const color =
          u.order.type === 'barrage'
            ? '#f59e0b'
            : u.order.type === 'attack_move'
            ? '#ef4444'
            : u.order.type === 'retreat'
            ? '#94a3b8'
            : '#4ade80';
        ctx.strokeStyle = color;
        ctx.lineWidth = isSelected ? 2 : 1.25;
        ctx.setLineDash([7, 5]);
        ctx.beginPath();
        ctx.moveTo(u.x, u.y);
        ctx.lineTo(u.order.targetPos.x, u.order.targetPos.y);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.strokeStyle = color;
        ctx.beginPath();
        ctx.arc(u.order.targetPos.x, u.order.targetPos.y, u.order.type === 'barrage' ? 42 : 7, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      } else if (u.order.type === 'attack_target' && u.order.targetUnitId) {
        const tgt = state.units.find((t) => t.id === u.order.targetUnitId && t.alive);
        if (tgt && tgt.spottedByEnemy) {
          ctx.save();
          ctx.strokeStyle = 'rgba(239, 68, 68, 0.85)';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(u.x, u.y);
          ctx.lineTo(tgt.x, tgt.y);
          ctx.stroke();
          ctx.restore();
        }
      }
    }
  }

  private drawUnitBody(
    ctx: CanvasRenderingContext2D,
    u: UnitState,
    tpl: UnitTemplate,
    isSelected: boolean
  ): void {
    const isBlue = u.team === 'blue';
    const primary = isBlue ? '#3b82f6' : '#ef4444';
    const hullColor = u.hitFlash > 0.2 ? '#ffffff' : isBlue ? '#4b6577' : '#65514a';
    const accent = isBlue ? '#93c5fd' : '#fca5a5';

    ctx.save();
    ctx.translate(u.x, u.y);

    // Selection & weapon range rings
    if (isSelected) {
      ctx.strokeStyle = '#60a5fa';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, 22, 0, Math.PI * 2);
      ctx.stroke();

      const maxRange = Math.max(0, ...tpl.weapons.map((w) => w.range));
      if (maxRange > 0) {
        ctx.strokeStyle = tpl.symbol === 'sam' ? 'rgba(56, 189, 248, 0.28)' : 'rgba(148, 163, 184, 0.2)';
        ctx.lineWidth = 1.25;
        ctx.setLineDash([6, 6]);
        ctx.beginPath();
        ctx.arc(0, 0, maxRange, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      if (tpl.isSupply) {
        ctx.strokeStyle = 'rgba(74, 222, 128, 0.32)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(0, 0, 135, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    // Silhouette by domain
    if (tpl.domain === 'infantry') {
      const dots = [
        { x: -6, y: -5 },
        { x: 6, y: -3 },
        { x: -1, y: 6 },
      ];
      for (const d of dots) {
        ctx.fillStyle = '#0f172a';
        ctx.beginPath();
        ctx.arc(d.x + 1, d.y + 1, 4.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = u.hitFlash > 0.2 ? '#ffffff' : primary;
        ctx.beginPath();
        ctx.arc(d.x, d.y, 3.6, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (tpl.domain === 'vehicle') {
      ctx.save();
      ctx.rotate(u.facing);
      // Ground shadow
      ctx.fillStyle = 'rgba(0, 0, 0, 0.42)';
      ctx.fillRect(-14, -8, 28, 18);
      // Tracks / hull
      const len = tpl.symbol === 'tank' ? 26 : tpl.symbol === 'artillery' ? 24 : 22;
      const wid = tpl.symbol === 'tank' ? 16 : 13;
      ctx.fillStyle = '#1e2629';
      ctx.fillRect(-len * 0.5, -wid * 0.5 - 1.5, len, 3);
      ctx.fillRect(-len * 0.5, wid * 0.5 - 1.5, len, 3);
      ctx.fillStyle = hullColor;
      ctx.fillRect(-len * 0.5 + 1, -wid * 0.5 + 1, len - 2, wid - 2);
      ctx.strokeStyle = primary;
      ctx.lineWidth = 1.2;
      ctx.strokeRect(-len * 0.5 + 1, -wid * 0.5 + 1, len - 2, wid - 2);
      ctx.restore();

      // Turret / radar
      ctx.save();
      ctx.rotate(u.turretFacing);
      if (tpl.symbol === 'sam') {
        // Rotating radar dish
        ctx.rotate(this.animTime * 2.4 - u.turretFacing);
        ctx.strokeStyle = accent;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(-7, 0);
        ctx.lineTo(7, 0);
        ctx.stroke();
      } else if (!tpl.isSupply) {
        ctx.fillStyle = '#2d3b42';
        ctx.beginPath();
        ctx.arc(0, 0, tpl.symbol === 'tank' ? 6.5 : 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#cbd5e1';
        ctx.lineWidth = tpl.symbol === 'tank' || tpl.symbol === 'artillery' ? 2.6 : 1.7;
        ctx.beginPath();
        ctx.moveTo(2, 0);
        ctx.lineTo(tpl.symbol === 'artillery' ? 20 : tpl.symbol === 'tank' ? 18 : 13, 0);
        ctx.stroke();
      }
      ctx.restore();
    } else if (tpl.domain === 'helicopter') {
      // Offset ground shadow
      ctx.save();
      ctx.translate(14, 18);
      ctx.rotate(u.facing);
      ctx.fillStyle = 'rgba(0,0,0,0.28)';
      ctx.beginPath();
      ctx.ellipse(0, 0, 14, 5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      ctx.save();
      ctx.rotate(u.facing);
      ctx.fillStyle = hullColor;
      ctx.beginPath();
      ctx.ellipse(2, 0, 14, 4.5, 0, 0, Math.PI * 2);
      ctx.fill();
      // Stub weapon wings
      ctx.fillRect(-2, -10, 5, 20);
      // Tail boom
      ctx.fillRect(-16, -1.5, 10, 3);
      ctx.strokeStyle = primary;
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.restore();

      // Spinning rotor blades
      ctx.save();
      ctx.rotate(this.animTime * 19 + u.x);
      ctx.strokeStyle = 'rgba(226, 232, 240, 0.72)';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(-16, 0);
      ctx.lineTo(16, 0);
      ctx.moveTo(0, -16);
      ctx.lineTo(0, 16);
      ctx.stroke();
      ctx.restore();
    } else if (tpl.domain === 'jet') {
      // Stealth fighter swept wing silhouette
      ctx.save();
      ctx.rotate(u.facing);
      // Contrails
      ctx.strokeStyle = 'rgba(226, 232, 240, 0.35)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-16, -9);
      ctx.lineTo(-65, -9);
      ctx.moveTo(-16, 9);
      ctx.lineTo(-65, 9);
      ctx.stroke();
      // Afterburner glow
      ctx.fillStyle = '#fb923c';
      ctx.beginPath();
      ctx.ellipse(-18, 0, 6, 2.5, 0, 0, Math.PI * 2);
      ctx.fill();
      // Delta airframe
      ctx.fillStyle = '#334155';
      ctx.strokeStyle = primary;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(22, 0);
      ctx.lineTo(-4, -17);
      ctx.lineTo(-14, -14);
      ctx.lineTo(-10, -4);
      ctx.lineTo(-17, 0);
      ctx.lineTo(-10, 4);
      ctx.lineTo(-14, 14);
      ctx.lineTo(-4, 17);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }

    // Compact NATO unit tactical tag & HP bar above unit
    const tagY = -27;
    const tagW = 46;
    const tagH = 15;
    ctx.fillStyle = 'rgba(12, 17, 20, 0.88)';
    ctx.fillRect(-tagW * 0.5, tagY, tagW, tagH);
    ctx.strokeStyle = isSelected ? '#93c5fd' : primary;
    ctx.lineWidth = isSelected ? 1.6 : 1.1;
    ctx.strokeRect(-tagW * 0.5, tagY, tagW, tagH);

    // Team side bar inside NATO plate
    ctx.fillStyle = primary;
    ctx.fillRect(-tagW * 0.5, tagY, 4, tagH);

    ctx.fillStyle = '#f1f5f9';
    ctx.font = '700 9px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(tpl.shortName, 2, tagY + 8);

    // HP bar underneath plate
    const hpRatio = Math.max(0, u.hp / u.maxHp);
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(-tagW * 0.5, tagY + tagH + 1, tagW, 3.5);
    ctx.fillStyle = hpRatio > 0.55 ? '#22c55e' : hpRatio > 0.28 ? '#eab308' : '#ef4444';
    ctx.fillRect(-tagW * 0.5, tagY + tagH + 1, tagW * hpRatio, 3.5);

    // Micro-indicators: Cover shield / Hold fire / APS
    if (u.inCover && tpl.domain === 'infantry') {
      ctx.fillStyle = '#4ade80';
      ctx.beginPath();
      ctx.arc(tagW * 0.5 + 5, tagY + 7, 3, 0, Math.PI * 2);
      ctx.fill();
    }
    if (u.holdFire) {
      ctx.fillStyle = '#eab308';
      ctx.font = '700 8px "JetBrains Mono", monospace';
      ctx.fillText('HOLD', 0, tagY - 6);
    }

    ctx.restore();
  }

  private drawWrecksAndGroundUnits(
    ctx: CanvasRenderingContext2D,
    state: MatchState,
    overlay: RenderInteractionOverlay
  ): void {
    // Draw burning wrecks first
    for (const u of state.units) {
      if (u.alive || u.koTimer <= 0) continue;
      ctx.save();
      ctx.globalAlpha = Math.min(1, u.koTimer / 4);
      ctx.translate(u.x, u.y);
      ctx.rotate(u.facing);
      ctx.fillStyle = '#18181b';
      ctx.fillRect(-11, -7, 22, 14);
      ctx.fillStyle = 'rgba(249, 115, 22, 0.7)';
      ctx.beginPath();
      ctx.arc(0, 0, 4 + Math.sin(this.animTime * 12 + u.x) * 1.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // Draw live ground units (respecting Fog of War for enemy units)
    for (const u of state.units) {
      if (!u.alive || u.altitude > 0) continue;
      if (u.team !== overlay.viewerTeam && !u.spottedByEnemy) continue;
      const tpl = UNIT_BY_ID[u.templateId];
      if (!tpl) continue;
      this.drawUnitBody(ctx, u, tpl, overlay.selectedIds.has(u.id));
    }
  }

  private drawAirUnits(
    ctx: CanvasRenderingContext2D,
    state: MatchState,
    overlay: RenderInteractionOverlay
  ): void {
    for (const u of state.units) {
      if (!u.alive || u.altitude === 0) continue;
      if (u.team !== overlay.viewerTeam && !u.spottedByEnemy) continue;
      const tpl = UNIT_BY_ID[u.templateId];
      if (!tpl) continue;
      this.drawUnitBody(ctx, u, tpl, overlay.selectedIds.has(u.id));
    }
  }

  private drawSmokes(ctx: CanvasRenderingContext2D, state: MatchState): void {
    for (const s of state.smokes) {
      const alpha = Math.min(0.75, (s.remainingSec / s.maxSec) * 1.15);
      ctx.save();
      ctx.fillStyle = `rgba(203, 213, 225, ${alpha * 0.55})`;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = `rgba(226, 232, 240, ${alpha * 0.45})`;
      ctx.beginPath();
      ctx.arc(s.x - 18, s.y - 10, s.radius * 0.65, 0, Math.PI * 2);
      ctx.arc(s.x + 20, s.y + 12, s.radius * 0.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  private drawProjectilesAndEffects(ctx: CanvasRenderingContext2D, state: MatchState): void {
    // Muzzle tracers
    for (const t of this.tracers) {
      ctx.save();
      ctx.globalAlpha = t.life / t.maxLife;
      ctx.strokeStyle = t.color;
      ctx.lineWidth = t.width;
      ctx.beginPath();
      ctx.moveTo(t.x1, t.y1);
      ctx.lineTo(t.x2, t.y2);
      ctx.stroke();
      ctx.restore();
    }

    // Active projectiles (missiles, kinetic rounds, arcing artillery shells)
    for (const pr of state.projectiles) {
      ctx.save();
      const ang = Math.atan2(pr.targetY - pr.y, pr.targetX - pr.x);
      if (pr.indirect) {
        // High-arc artillery shell + ground impact telegraph ring
        const arcLift = Math.sin(pr.progress * Math.PI) * 58;
        ctx.strokeStyle = 'rgba(245, 158, 11, 0.45)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(pr.targetX, pr.targetY, pr.splashRadius * 0.55, 0, Math.PI * 2);
        ctx.stroke();

        ctx.fillStyle = '#fde047';
        ctx.beginPath();
        ctx.arc(pr.x, pr.y - arcLift, 3.5, 0, Math.PI * 2);
        ctx.fill();
      } else if (pr.weaponType === 'atgm' || pr.weaponType === 'sam') {
        // Smoke trail behind missile
        ctx.strokeStyle = pr.weaponType === 'sam' ? 'rgba(186, 230, 253, 0.7)' : 'rgba(254, 215, 170, 0.7)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(pr.x, pr.y);
        ctx.lineTo(pr.x - Math.cos(ang) * 26, pr.y - Math.sin(ang) * 26);
        ctx.stroke();

        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(pr.x, pr.y, 2.8, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.strokeStyle = pr.weaponType === 'kinetic' ? '#fde68a' : '#fef08a';
        ctx.lineWidth = pr.weaponType === 'kinetic' ? 2.5 : 1.5;
        ctx.beginPath();
        ctx.moveTo(pr.x, pr.y);
        ctx.lineTo(pr.x - Math.cos(ang) * 14, pr.y - Math.sin(ang) * 14);
        ctx.stroke();
      }
      ctx.restore();
    }

    // Pooled particles
    for (let i = 0; i < PARTICLE_POOL_SIZE; i++) {
      const p = this.particles[i];
      if (!p.active) continue;
      const alpha = Math.max(0, p.life / p.maxLife);
      ctx.save();
      ctx.globalAlpha = alpha;
      if (p.ring) {
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 2.5 * alpha;
        ctx.beginPath();
        ctx.arc(p.x, p.y, Math.max(1, p.size), 0, Math.PI * 2);
        ctx.stroke();
      } else {
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, Math.max(1, p.size), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    // Floating callouts
    for (const c of this.callouts) {
      ctx.save();
      ctx.globalAlpha = Math.min(1, (c.life / c.maxLife) * 1.4);
      ctx.font = '700 12px "Barlow Condensed", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#090d10';
      ctx.fillText(c.text, c.x + 1, c.y + 1);
      ctx.fillStyle = c.color;
      ctx.fillText(c.text, c.x, c.y);
      ctx.restore();
    }
  }

  private drawPingsAndReticles(
    ctx: CanvasRenderingContext2D,
    state: MatchState,
    overlay: RenderInteractionOverlay
  ): void {
    // Multiplayer tactical map pings
    for (const p of state.pings) {
      const pulse = 1 + Math.sin(this.animTime * 9) * 0.25;
      ctx.save();
      ctx.strokeStyle = p.team === 'blue' ? '#60a5fa' : '#f87171';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 18 * pulse, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = '#0c1114';
      ctx.fillRect(p.x - 44, p.y - 38, 88, 18);
      ctx.fillStyle = '#f8fafc';
      ctx.font = '600 11px "Public Sans", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(p.label, p.x, p.y - 26);
      ctx.restore();
    }

    // Active command targeting reticle under cursor
    if (overlay.cursorWorld && overlay.commandMode !== 'normal') {
      const { x, y } = overlay.cursorWorld;
      ctx.save();
      const color =
        overlay.commandMode === 'airstrike'
          ? '#eab308'
          : overlay.commandMode === 'barrage'
          ? '#f97316'
          : overlay.commandMode === 'attack_move'
          ? '#ef4444'
          : overlay.commandMode === 'ping'
          ? '#38bdf8'
          : '#4ade80';
      const radius =
        overlay.commandMode === 'airstrike' ? 96 : overlay.commandMode === 'barrage' ? 64 : 24;

      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);

      // Crosshair ticks
      ctx.beginPath();
      ctx.moveTo(x - 10, y);
      ctx.lineTo(x + 10, y);
      ctx.moveTo(x, y - 10);
      ctx.lineTo(x, y + 10);
      ctx.stroke();
      ctx.restore();
    }
  }

  public renderMinimap(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    state: MatchState,
    camera: CameraState,
    viewportW: number,
    viewportH: number,
    viewerTeam: TeamId
  ): void {
    const map = getMapById(state.mapId);
    const sx = w / map.width;
    const sy = h / map.height;

    if (
      typeof document !== 'undefined' &&
      (!this.minimapBgCache ||
        this.minimapBgCache.mapId !== map.id ||
        this.minimapBgCache.w !== w ||
        this.minimapBgCache.h !== h)
    ) {
      const bg = document.createElement('canvas');
      bg.width = w;
      bg.height = h;
      const bctx = bg.getContext('2d');
      if (bctx) {
        bctx.fillStyle = '#141e19';
        bctx.fillRect(0, 0, w, h);

        bctx.strokeStyle = '#1e4254';
        bctx.lineWidth = Math.max(3, 82 * sx);
        for (const r of map.rivers) {
          bctx.beginPath();
          r.points.forEach((p, i) => (i === 0 ? bctx.moveTo(p.x * sx, p.y * sy) : bctx.lineTo(p.x * sx, p.y * sy)));
          bctx.stroke();
        }

        bctx.strokeStyle = '#334155';
        bctx.lineWidth = 1.5;
        for (const r of map.roads) {
          bctx.beginPath();
          r.points.forEach((p, i) => (i === 0 ? bctx.moveTo(p.x * sx, p.y * sy) : bctx.lineTo(p.x * sx, p.y * sy)));
          bctx.stroke();
        }

        for (const f of map.features) {
          bctx.fillStyle =
            f.kind === 'forest'
              ? 'rgba(34, 68, 41, 0.85)'
              : f.kind === 'urban'
              ? 'rgba(100, 116, 139, 0.7)'
              : f.kind === 'bridge'
              ? '#94a3b8'
              : 'rgba(148, 163, 184, 0.15)';
          bctx.fillRect(f.x * sx, f.y * sy, f.w * sx, f.h * sy);
        }
      }
      this.minimapBgCache = { mapId: map.id, w, h, canvas: bg };
    }

    if (this.minimapBgCache) {
      ctx.drawImage(this.minimapBgCache.canvas, 0, 0);
    } else {
      ctx.fillStyle = '#141e19';
      ctx.fillRect(0, 0, w, h);
    }

    // Zones
    for (const z of state.zones) {
      ctx.strokeStyle = z.owner === 'blue' ? '#3b82f6' : z.owner === 'red' ? '#ef4444' : '#94a3b8';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(z.x * sx, z.y * sy, z.radius * sx, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Units
    for (const u of state.units) {
      if (!u.alive) continue;
      if (u.team !== viewerTeam && !u.spottedByEnemy) continue;
      ctx.fillStyle = u.team === 'blue' ? '#60a5fa' : '#f87171';
      ctx.fillRect(u.x * sx - 2, u.y * sy - 2, 4, 4);
    }

    // Live camera frustum rectangle
    const viewWorldW = viewportW / camera.zoom;
    const viewWorldH = viewportH / camera.zoom;
    const vx = (camera.x - viewWorldW * 0.5) * sx;
    const vy = (camera.y - viewWorldH * 0.5) * sy;
    ctx.strokeStyle = '#f8fafc';
    ctx.lineWidth = 1.25;
    ctx.strokeRect(vx, vy, viewWorldW * sx, viewWorldH * sy);
  }
}
