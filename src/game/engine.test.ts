import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyCommand,
  computeDirectionalArmor,
  computeWeaponDamage,
  createMatchState,
  isSegmentBlockedBySmoke,
  resetIdCounterForTest,
  stepMatch,
} from './engine';
import { createDefaultDeck, DECK_BUDGET_LIMIT, UNIT_BY_ID, validateDeck } from './catalog';

test('default battlegroup decks are valid and within 10,000 point budget', () => {
  const usDeck = createDefaultDeck('coalition');
  const ruDeck = createDefaultDeck('vanguard');
  const usVal = validateDeck(usDeck);
  const ruVal = validateDeck(ruDeck);

  assert.equal(usVal.valid, true, usVal.errors.join(', '));
  assert.equal(ruVal.valid, true, ruVal.errors.join(', '));
  assert.ok(usVal.totalCost <= DECK_BUDGET_LIMIT);
  assert.ok(ruVal.totalCost <= DECK_BUDGET_LIMIT);
});

test('deploy command deducts requisition, decrements stock, and spawns unit', () => {
  resetIdCounterForTest();
  const state = createMatchState('m1', 'baltic_port', [
    { id: 'p1', name: 'Commander', team: 'blue', faction: 'coalition', isAI: false },
    { id: 'ai1', name: 'Vanguard AI', team: 'red', faction: 'vanguard', isAI: true },
  ]);

  const initialUnits = state.units.length;
  const initialReq = state.players.p1.requisition;
  const initialStock = state.players.p1.stock.us_rifles;

  const res = applyCommand(state, 'p1', {
    type: 'deploy',
    templateId: 'us_rifles',
    targetPos: { x: 645, y: 745 },
  });

  assert.equal(res.ok, true);
  assert.equal(state.units.length, initialUnits + 1);
  assert.equal(state.players.p1.requisition, initialReq - UNIT_BY_ID.us_rifles.cost);
  assert.equal(state.players.p1.stock.us_rifles, initialStock - 1);
});

test('directional armor deals significantly more damage to tank rear than front', () => {
  const abrams = UNIT_BY_ID.us_abrams;
  const weapon = UNIT_BY_ID.ru_bmp3.weapons[0]; // 30mm autocannon (pen 18)

  const targetUnit = {
    id: 'u_test',
    templateId: 'us_abrams',
    ownerId: 'p1',
    team: 'blue' as const,
    x: 500,
    y: 500,
    vx: 0,
    vy: 0,
    facing: 0, // facing east (+X)
    turretFacing: 0,
    hp: 360,
    maxHp: 360,
    ammo: [28, 80],
    reloadTimers: [0, 0],
    apsCharges: 0,
    apsCooldown: 0,
    smokeCharges: 0,
    smokeCooldown: 0,
    supplyRemaining: 0,
    holdFire: false,
    inCover: false,
    spottedByEnemy: true,
    hitFlash: 0,
    order: { type: 'idle' as const },
    alive: true,
    koTimer: 0,
    altitude: 0,
  };

  // Attacker directly in front (east) vs directly behind (west)
  const frontInfo = computeDirectionalArmor(abrams, 0, Math.PI);
  const rearInfo = computeDirectionalArmor(abrams, 0, 0);
  assert.equal(frontInfo.arc, 'front');
  assert.equal(rearInfo.arc, 'rear');

  const frontDmg = computeWeaponDamage(weapon, abrams, targetUnit, { x: 700, y: 500 });
  const rearDmg = computeWeaponDamage(weapon, abrams, targetUnit, { x: 300, y: 500 });
  assert.ok(rearDmg > frontDmg * 2, `Expected rear damage (${rearDmg}) > 2x front damage (${frontDmg})`);
});

test('smoke cloud blocks line-of-sight between opposing units', () => {
  const blocked = isSegmentBlockedBySmoke(
    [{ id: 's1', x: 500, y: 500, radius: 70, remainingSec: 10, maxSec: 13 }],
    { x: 350, y: 500 },
    { x: 650, y: 500 }
  );
  const clear = isSegmentBlockedBySmoke(
    [{ id: 's1', x: 500, y: 800, radius: 70, remainingSec: 10, maxSec: 13 }],
    { x: 350, y: 500 },
    { x: 650, y: 500 }
  );

  assert.equal(blocked, true);
  assert.equal(clear, false);
});

test('capturing a zone ticks Victory Points and reaches victory condition cleanly', () => {
  resetIdCounterForTest();
  const state = createMatchState(
    'm_vp',
    'baltic_port',
    [
      { id: 'p1', name: 'Blue', team: 'blue', faction: 'coalition', isAI: false },
      { id: 'p2', name: 'Red', team: 'red', faction: 'vanguard', isAI: false },
    ],
    { vpTarget: 50 }
  );

  // Place a blue rifle squad directly inside Bravo zone
  const bravo = state.zones.find((z) => z.code === 'B')!;
  const blueUnit = state.units.find((u) => u.team === 'blue')!;
  blueUnit.x = bravo.x;
  blueUnit.y = bravo.y;

  // Step simulation forward in 0.1s increments until Blue captures & wins
  for (let i = 0; i < 300 && state.status === 'playing'; i++) {
    stepMatch(state, 0.1);
  }

  assert.equal(bravo.owner, 'blue');
  assert.equal(state.status, 'victory_blue');
  assert.equal(state.blueVp, 50);
});

test('AI commander autonomously orders units toward capture zones', () => {
  resetIdCounterForTest();
  const state = createMatchState('m_ai', 'baltic_port', [
    { id: 'p1', name: 'Player', team: 'blue', faction: 'coalition', isAI: false },
    { id: 'ai1', name: 'AI', team: 'red', faction: 'vanguard', isAI: true },
  ]);

  const redStartX = state.units.filter((u) => u.team === 'red').map((u) => u.x);
  for (let i = 0; i < 60; i++) {
    stepMatch(state, 0.1);
  }
  const redEndX = state.units.filter((u) => u.team === 'red').map((u) => u.x);

  const anyMovedWest = redEndX.some((x, i) => x < (redStartX[i] ?? x) - 20);
  assert.equal(anyMovedWest, true, 'Expected AI vanguard units to advance west toward objectives');
});
