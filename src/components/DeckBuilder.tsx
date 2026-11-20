import { useMemo, useState } from 'react';
import {
  CATEGORIES,
  computeDeckCost,
  createDefaultDeck,
  DECK_BUDGET_LIMIT,
  getFactionUnits,
  SPECIALIZATIONS,
  validateDeck,
} from '../game/catalog';
import type { BattlegroupDeck, FactionId, SpecializationId, UnitCategory } from '../game/types';

interface DeckBuilderProps {
  deck: BattlegroupDeck;
  onSave: (deck: BattlegroupDeck) => void;
  onBack: () => void;
}

const EMBLEMS: Record<FactionId, string> = {
  coalition: './src/assets/images/faction_coalition_emblem_1795203888707.jpg',
  vanguard: './src/assets/images/faction_vanguard_emblem_1795204002879.jpg',
};

export function DeckBuilder({ deck, onSave, onBack }: DeckBuilderProps) {
  const [draft, setDraft] = useState<BattlegroupDeck>(() => ({
    ...deck,
    entries: deck.entries.map((e) => ({ ...e })),
    specs: [...deck.specs] as [SpecializationId, SpecializationId],
  }));
  const [activeCategory, setActiveCategory] = useState<UnitCategory>('armor');

  const factionUnits = useMemo(() => getFactionUnits(draft.faction), [draft.faction]);
  const visibleUnits = useMemo(
    () => factionUnits.filter((u) => u.category === activeCategory),
    [factionUnits, activeCategory]
  );

  const validation = useMemo(() => validateDeck(draft), [draft]);
  const totalCost = useMemo(() => computeDeckCost(draft), [draft]);
  const totalUnits = useMemo(
    () => draft.entries.reduce((sum, e) => sum + e.count, 0),
    [draft.entries]
  );

  const getCount = (templateId: string) =>
    draft.entries.find((e) => e.templateId === templateId)?.count ?? 0;

  const setCount = (templateId: string, nextCount: number) => {
    setDraft((prev) => {
      const exists = prev.entries.some((e) => e.templateId === templateId);
      const entries = exists
        ? prev.entries.map((e) =>
            e.templateId === templateId ? { ...e, count: Math.max(0, nextCount) } : e
          )
        : [...prev.entries, { templateId, count: Math.max(0, nextCount) }];
      return { ...prev, entries };
    });
  };

  const handleFactionSwitch = (faction: FactionId) => {
    if (faction === draft.faction) return;
    setDraft(createDefaultDeck(faction));
  };

  const toggleSpec = (specId: SpecializationId) => {
    setDraft((prev) => {
      if (prev.specs.includes(specId)) return prev;
      return { ...prev, specs: [prev.specs[1], specId] };
    });
  };

  return (
    <main className="flex h-screen w-screen flex-col bg-[#0d1317] text-[#e6ecea] overflow-hidden">
      {/* Top command header */}
      <div className="flex items-center justify-between gap-6 border-b border-white/10 bg-[#121a1f] px-8 py-4 shrink-0">
        <div className="flex items-center gap-4">
          <img
            src={EMBLEMS[draft.faction]}
            alt={draft.faction === 'coalition' ? 'Coalition emblem' : 'Vanguard emblem'}
            referrerPolicy="no-referrer"
            className="h-11 w-11 rounded object-cover border border-white/15"
          />
          <div>
            <h1 className="font-display text-3xl font-bold leading-none tracking-wide text-white">
              BATTLEGROUP ARSENAL
            </h1>
            <p className="mt-1 text-xs text-[#94a8b3]">
              Customize combined-arms requisition allocation · Budget {DECK_BUDGET_LIMIT.toLocaleString()} pts
            </p>
          </div>
        </div>

        <div className="flex items-center gap-6">
          <div className="text-right">
            <div className="text-xs font-medium text-[#94a8b3]">Deployment Budget</div>
            <div
              className={`font-mono-tabular text-xl font-semibold ${
                totalCost > DECK_BUDGET_LIMIT ? 'text-[#f87171]' : 'text-[#eab308]'
              }`}
            >
              {totalCost.toLocaleString()} / {DECK_BUDGET_LIMIT.toLocaleString()} pts
            </div>
          </div>

          <div className="text-right">
            <div className="text-xs font-medium text-[#94a8b3]">Force Size</div>
            <div className="font-mono-tabular text-xl font-semibold text-white">
              {totalUnits} units
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={onBack}
              className="rounded border border-white/15 bg-[#182228] px-4 py-2 text-sm font-medium text-[#d4dfe4] transition-colors hover:bg-[#223038] whitespace-nowrap"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!validation.valid}
              onClick={() => onSave(draft)}
              className="rounded bg-[#2563eb] px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#1d4ed8] disabled:cursor-not-allowed disabled:opacity-45 whitespace-nowrap"
            >
              Save Battlegroup
            </button>
          </div>
        </div>
      </div>

      {/* Main 2-column arsenal workspace */}
      <div className="grid flex-1 grid-cols-1 overflow-hidden lg:grid-cols-12">
        {/* Left column: Faction, Name, Specializations */}
        <aside className="flex flex-col gap-6 overflow-y-auto border-r border-white/10 bg-[#10171b] p-6 lg:col-span-4">
          <div>
            <label
              htmlFor="deck-name-input"
              className="block text-xs font-semibold tracking-wider text-[#94a8b3] uppercase"
            >
              Battlegroup Designation
            </label>
            <input
              id="deck-name-input"
              type="text"
              value={draft.name}
              maxLength={40}
              onChange={(e) => setDraft((prev) => ({ ...prev, name: e.target.value }))}
              className="mt-2 w-full rounded border border-white/15 bg-[#162026] px-3 py-2 text-sm font-medium text-white focus:border-[#60a5fa] focus:outline-none"
            />
          </div>

          <div>
            <span className="block text-xs font-semibold tracking-wider text-[#94a8b3] uppercase">
              Faction Doctrine
            </span>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {(['coalition', 'vanguard'] as FactionId[]).map((fac) => (
                <button
                  key={fac}
                  type="button"
                  onClick={() => handleFactionSwitch(fac)}
                  className={`flex items-center gap-2.5 rounded border p-2.5 text-left transition-colors ${
                    draft.faction === fac
                      ? fac === 'coalition'
                        ? 'border-[#3b82f6] bg-[#172638] text-white'
                        : 'border-[#ef4444] bg-[#2e191b] text-white'
                      : 'border-white/10 bg-[#151e23] text-[#9cb0ba] hover:border-white/25'
                  }`}
                >
                  <img
                    src={EMBLEMS[fac]}
                    alt=""
                    referrerPolicy="no-referrer"
                    className="h-9 w-9 rounded object-cover"
                  />
                  <div>
                    <div className="font-display text-lg font-bold leading-tight">
                      {fac === 'coalition' ? 'Coalition' : 'Vanguard'}
                    </div>
                    <div className="text-xs text-[#92a6b0]">
                      {fac === 'coalition' ? 'NATO Armor & Air' : 'Guards Mechanized'}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div>
            <span className="block text-xs font-semibold tracking-wider text-[#94a8b3] uppercase">
              Active Specializations (Pick 2)
            </span>
            <div className="mt-2 space-y-2">
              {SPECIALIZATIONS.map((sp) => {
                const active = draft.specs.includes(sp.id);
                return (
                  <button
                    key={sp.id}
                    type="button"
                    onClick={() => toggleSpec(sp.id)}
                    className={`w-full rounded border p-3 text-left transition-colors ${
                      active
                        ? 'border-[#60a5fa] bg-[#182836] text-white'
                        : 'border-white/10 bg-[#141c21] text-[#9eb1bb] hover:border-white/20'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold">{sp.name}</span>
                      <span className="text-xs font-medium text-[#93c5fd]">
                        {active ? 'Active' : 'Select'}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-[#8ba0aa]">{sp.summary}</p>
                  </button>
                );
              })}
            </div>
          </div>

          {!validation.valid && (
            <div className="rounded border border-[#ef4444]/50 bg-[#2a1517] p-3 text-xs text-[#fecaca]">
              {validation.errors.map((err) => (
                <p key={err}>{err}</p>
              ))}
            </div>
          )}
        </aside>

        {/* Right column: Unit Category Tabs + Unit Cards */}
        <section className="flex flex-col overflow-hidden p-6 lg:col-span-8">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-4">
            <div className="flex items-center gap-1 rounded bg-[#141d22] p-1 border border-white/10">
              {CATEGORIES.map((cat) => (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => setActiveCategory(cat.id)}
                  className={`rounded px-3.5 py-1.5 text-sm font-semibold whitespace-nowrap transition-colors ${
                    activeCategory === cat.id
                      ? 'bg-[#2563eb] text-white'
                      : 'text-[#9ab0ba] hover:text-white'
                  }`}
                >
                  {cat.label}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={() => setDraft(createDefaultDeck(draft.faction))}
              className="rounded border border-white/15 bg-[#151e24] px-3 py-1.5 text-xs font-medium text-[#b8c7cf] hover:bg-[#1e2b33]"
            >
              Reset to Standard Loadout
            </button>
          </div>

          <div className="mt-5 grid flex-1 grid-cols-1 content-start items-start gap-4 overflow-y-auto pr-1 md:grid-cols-2">
            {visibleUnits.map((unit) => {
              const count = getCount(unit.id);
              const isSpecMatch = draft.specs.includes(unit.spec);
              const effectiveMax = isSpecMatch ? unit.maxStock : Math.max(1, unit.maxStock - 1);
              return (
                <div
                  key={unit.id}
                  className="flex flex-col justify-between rounded border border-white/12 bg-[#141c21] p-4"
                >
                  <div>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h3 className="font-display text-2xl font-bold leading-tight text-white">
                          {unit.name}
                        </h3>
                        <p className="mt-0.5 text-xs text-[#94a8b3]">{unit.roleClue}</p>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="font-mono-tabular text-lg font-semibold text-[#eab308]">
                          {unit.cost} pts
                        </div>
                        <div className="text-xs text-[#8ba0aa]">per unit</div>
                      </div>
                    </div>

                    <div className="mt-3 grid grid-cols-3 gap-2 border-y border-white/10 py-2.5 text-xs">
                      <div>
                        <span className="text-[#859aa4]">Armor F/S/R</span>
                        <div className="font-mono-tabular font-semibold text-white">
                          {unit.armorFront}/{unit.armorSide}/{unit.armorRear}
                        </div>
                      </div>
                      <div>
                        <span className="text-[#859aa4]">HP / Speed</span>
                        <div className="font-mono-tabular font-semibold text-white">
                          {unit.hp} · {unit.speed}
                        </div>
                      </div>
                      <div>
                        <span className="text-[#859aa4]">Optics / APS</span>
                        <div className="font-mono-tabular font-semibold text-white">
                          {unit.optics}m · {unit.apsCharges}
                        </div>
                      </div>
                    </div>

                    <div className="mt-2.5 space-y-1 text-xs text-[#b4c4cc]">
                      {unit.weapons.length > 0 ? (
                        unit.weapons.map((w) => (
                          <div key={w.id} className="flex items-center justify-between">
                            <span className="truncate">{w.name}</span>
                            <span className="font-mono-tabular text-[#8fa4ae] shrink-0">
                              RNG {w.range} · DMG {w.damage} · PEN {w.penetration}
                            </span>
                          </div>
                        ))
                      ) : (
                        <div className="text-[#4ade80]">
                          Logistics Aura · 600 Supply Pool (Ammo & Field Repair)
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="mt-4 flex items-center justify-between pt-2">
                    <span className="text-xs text-[#8ba0aa]">
                      Availability: <strong className="font-mono-tabular text-white">{count} / {effectiveMax}</strong>
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        aria-label={`Remove ${unit.name}`}
                        disabled={count <= 0}
                        onClick={() => setCount(unit.id, count - 1)}
                        className="h-8 w-8 rounded border border-white/15 bg-[#1b262c] font-mono-tabular text-base font-bold text-white hover:bg-[#27363e] disabled:opacity-35"
                      >
                        −
                      </button>
                      <button
                        type="button"
                        aria-label={`Add ${unit.name}`}
                        disabled={count >= effectiveMax || totalCost + unit.cost > DECK_BUDGET_LIMIT}
                        onClick={() => setCount(unit.id, count + 1)}
                        className="h-8 w-8 rounded bg-[#2563eb] font-mono-tabular text-base font-bold text-white hover:bg-[#1d4ed8] disabled:opacity-35"
                      >
                        +
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Combined-arms category allocation overview */}
          <div className="mt-4 grid grid-cols-3 gap-2 border-t border-white/10 pt-4 sm:grid-cols-6">
            {CATEGORIES.map((cat) => {
              const catUnits = factionUnits.filter((u) => u.category === cat.id);
              const catCount = catUnits.reduce((sum, u) => sum + getCount(u.id), 0);
              const catPts = catUnits.reduce((sum, u) => sum + getCount(u.id) * u.cost, 0);
              return (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => setActiveCategory(cat.id)}
                  className={`rounded border px-3 py-2 text-left transition-colors ${
                    activeCategory === cat.id
                      ? 'border-[#3b82f6] bg-[#162433]'
                      : 'border-white/10 bg-[#121a1f] hover:border-white/20'
                  }`}
                >
                  <div className="text-[11px] font-semibold text-[#94a8b3]">{cat.label}</div>
                  <div className="mt-0.5 font-mono-tabular text-sm font-bold text-white">
                    {catCount} <span className="text-[11px] font-normal text-[#8ba0aa]">· {catPts}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </section>
      </div>
    </main>
  );
}
