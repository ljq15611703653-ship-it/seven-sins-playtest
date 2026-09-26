import { CHARACTERS } from "../content/characters.js";
import { ARENAS, EQUIPMENT, PUBLIC_EFFECTS, RULES } from "../content/tables.js";
import type { BattleInput } from "../battle/engine.js";
import { Rng } from "../rng.js";
import type { BetContext, TeamSetup } from "../types.js";

/** 随机的一方下注行为（模拟用）。 */
export function randomBet(rng: Rng, revealedPos: number): BetContext {
  return {
    invested: rng.pick([10, 20, 30, 40, 50]),
    betOrRaiseCount: rng.pick([0, 0, 1, 1, 2]),
    checkCount: rng.pick([0, 1, 1, 2]),
    opsPaid: rng.pick([0, 1, 1, 2]),
    revealedPos,
    stack: rng.pick([30, 60, 90, 120]),
  };
}

/** 随机组一支队伍：3 名人物、按付费次数随机装备、随机亮牌；饕餮有一半概率吞掉最弱的队友。 */
export function randomTeam(rng: Rng, ids?: string[]): TeamSetup {
  const chars = ids ?? rng.sample(CHARACTERS.map((c) => c.id), 3);
  const revealedPos = rng.int(3);
  const bet = randomBet(rng, revealedPos);
  const slots = chars.map((c) => ({ characterId: c, equipmentId: null as string | null }));
  for (let i = 0; i < bet.opsPaid; i++) slots[rng.int(3)].equipmentId = rng.pick(EQUIPMENT).id;
  let eat: TeamSetup["eat"] = null;
  const g = chars.indexOf("GL2");
  if (g >= 0 && rng.next() < 0.5) {
    const others = [0, 1, 2].filter((i) => i !== g);
    const weakest = others.reduce((a, b) => (power(chars[a]) <= power(chars[b]) ? a : b));
    eat = { eater: g, eaten: weakest };
    if (bet.revealedPos === weakest) bet.revealedPos = g;
  }
  return { slots, eat, bet };
}

function power(id: string) {
  const c = CHARACTERS.find((x) => x.id === id)!;
  return c.atk * c.hp;
}

export interface RandomBattle {
  input: BattleInput;
  ids: [string[], string[]];
}

/** 随机一场战斗：双方随机队伍、随机规则与场地，公共效果一半概率生效。 */
export function randomBattle(rng: Rng, fixedA?: string[], arenaId?: string): RandomBattle {
  const a = randomTeam(rng, fixedA);
  const b = randomTeam(rng);
  return {
    input: {
      teams: [a, b],
      ruleId: rng.pick(RULES).id,
      arenaId: arenaId ?? rng.pick(ARENAS).id,
      publicEffectId: rng.next() < 0.5 ? rng.pick(PUBLIC_EFFECTS).id : null,
      pot: a.bet.invested + b.bet.invested,
      firstSeat: rng.int(2) as 0 | 1,
    },
    ids: [a.slots.map((s) => s.characterId!), b.slots.map((s) => s.characterId!)],
  };
}
