import { character } from "../content/characters.js";
import { other, type EatChoice, type Seat } from "../types.js";
import type { Action, Phase } from "./actions.js";
import type { Table } from "./table.js";

/**
 * 某个座位此刻能看到的全部信息。
 * 对手的暗置人物、候选装备、未提交的表决与出价、未翻开的规则和公共效果都不会出现在这里。
 */
export interface Observation {
  seat: Seat;
  handNo: number;
  phase: Phase;
  toAct: Seat[];
  dealer: Seat;
  ante: number;
  stacks: [number, number];
  pot: number;
  invested: [number, number];
  arenaOptions: [string, string];
  arenaId: string | null;
  ruleId: string | null;
  publicEffectId: string | null;
  publicEffectActive: boolean | null;
  me: {
    pool: string[];
    dealt: string[];
    placement: { slots: (string | null)[]; reveal: number; eat: EatChoice | null } | null;
    equipment: (string | null)[];
    slotEffects: (string | null)[];
    offers: string[] | null;
    peek: { pos: number; characterId: string } | null;
    vote: boolean | null;
    bid: number | null;
  };
  opponent: {
    poolSize: number;
    publicPicks: string[];
    removedCount: number;
    placed: boolean;
    /** 亮出的那名（布完阵才有）。 */
    revealed: { pos: number; characterId: string } | null;
    /** 空出来的位置（被饕餮吞掉）是公开的。 */
    emptyPositions: number[];
    equipment: (string | null)[];
    slotEffects: (string | null)[];
    submitted: boolean;
  };
  betting: {
    round: 1 | 2;
    roundBet: [number, number];
    target: number;
    toCall: number;
    minRaiseTo: number;
    canFold: boolean;
    betOrRaiseCount: [number, number];
    checkCount: [number, number];
    opsPaid: [number, number];
  };
  opFee: number;
  bidCap: number;
  market: string[];
  /** 本手结算后才有：完整战斗结果（此时双方队伍都已揭开）。 */
  outcome: Table["hand"]["outcome"];
}

export function observe(t: Table, seat: Seat): Observation {
  const h = t.hand;
  const o = other(seat);
  const myPl = h.placement[seat];
  const foePl = h.placement[o];
  const phase = t.phase;
  const foeSubmitted =
    (phase === "operate" && h.opCommit[o] !== null) ||
    (phase === "draft" && (h.offers[o] === null || h.draftChoice[o] !== null)) ||
    (phase === "vote" && h.votes[o] !== null) ||
    (phase === "bid" && h.bids[o] !== null) ||
    (phase === "marketRemove" && h.removeDone[o]);
  return {
    seat, handNo: h.no, phase, toAct: t.toAct(), dealer: h.dealer, ante: h.ante,
    stacks: [t.stacks[0], t.stacks[1]], pot: h.pot, invested: [h.invested[0], h.invested[1]],
    arenaOptions: h.arenaOptions, arenaId: h.arenaId,
    ruleId: h.ruleRevealed ? h.ruleId : null,
    publicEffectId: h.peRevealed ? h.publicEffectId : null,
    publicEffectActive: h.peRevealed && phase !== "vote" && phase !== "bid" ? h.peActive : null,
    me: {
      pool: t.pools[seat].slice(),
      dealt: h.dealt[seat].slice(),
      placement: myPl ? { slots: myPl.slots.slice(), reveal: myPl.reveal, eat: myPl.eat } : null,
      equipment: h.equipment[seat].slice(),
      slotEffects: h.slotEffects[seat].slice(),
      offers: h.offers[seat] ? h.offers[seat]!.slice() : null,
      peek: h.peek[seat],
      vote: h.votes[seat],
      bid: h.bids[seat],
    },
    opponent: {
      poolSize: t.pools[o].length,
      publicPicks: t.publicPicks[o].slice(),
      removedCount: t.removedCount[o],
      placed: !!foePl,
      revealed: foePl ? { pos: foePl.reveal, characterId: foePl.slots[foePl.reveal]! } : null,
      emptyPositions: foePl ? foePl.slots.flatMap((c, i) => (c === null ? [i] : [])) : [],
      equipment: h.equipment[o].slice(),
      slotEffects: h.slotEffects[o].slice(),
      submitted: foeSubmitted,
    },
    betting: {
      round: h.betRound,
      roundBet: [h.roundBet[0], h.roundBet[1]],
      target: h.target,
      toCall: Math.max(0, h.target - h.roundBet[seat]),
      minRaiseTo: h.target + h.minRaise,
      canFold: t.canFold(seat),
      betOrRaiseCount: [h.stats[0].betOrRaise, h.stats[1].betOrRaise],
      checkCount: [h.stats[0].checks, h.stats[1].checks],
      opsPaid: [h.stats[0].opsPaid, h.stats[1].opsPaid],
    },
    opFee: h.opFee,
    bidCap: h.bidCap,
    market: h.market.slice(),
    outcome: h.outcome,
  };
}

const PERMS3OF4: Array<[number, number, number]> = (() => {
  const out: Array<[number, number, number]> = [];
  for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++) for (let c = 0; c < 4; c++) {
    if (a !== b && a !== c && b !== c) out.push([a, b, c]);
  }
  return out;
})();

/**
 * 当前座位可以提交的动作（下注金额只给出一组常用档位；
 * 任意合法金额也可以直接提交给 Table.apply）。
 */
export function legalActions(t: Table, seat: Seat): Action[] {
  if (!t.toAct().includes(seat)) return [];
  const h = t.hand;
  const stack = t.stacks[seat];
  switch (t.phase) {
    case "arena":
      return [{ type: "chooseArena", index: 0 }, { type: "chooseArena", index: 1 }];
    case "place": {
      const dealt = h.dealt[seat];
      const out: Action[] = [];
      for (const picks of PERMS3OF4) {
        const slots = picks.map((i) => dealt[i]);
        const eats: Array<EatChoice | null> = [null];
        slots.forEach((c, eater) => {
          if (c === "GL2") for (let eaten = 0; eaten < 3; eaten++) if (eaten !== eater) eats.push({ eater, eaten });
        });
        for (const eat of eats) {
          for (let reveal = 0; reveal < 3; reveal++) {
            if (eat && eat.eaten === reveal) continue;
            out.push({ type: "place", picks, eat, reveal });
          }
        }
      }
      return out;
    }
    case "peek": {
      if (!h.peek[seat]) {
        const foe = h.placement[other(seat)]!;
        return foe.slots.flatMap((c, pos) => (c !== null && pos !== foe.reveal ? [{ type: "peek", pos } as Action] : []));
      }
      const mine = h.placement[seat]!;
      const hidden = [0, 1, 2].filter((p) => mine.slots[p] !== null && p !== mine.reveal);
      const out: Action[] = [{ type: "peekSwap", swap: null }];
      for (let i = 0; i < hidden.length; i++) {
        for (let j = i + 1; j < hidden.length; j++) out.push({ type: "peekSwap", swap: [hidden[i], hidden[j]] });
      }
      return out;
    }
    case "bet": {
      const out: Action[] = [];
      const me = h.roundBet[seat];
      const minBet = t.options.minBet;
      if (me === h.target) out.push({ type: "check" });
      if (h.target > me) out.push({ type: "call" });
      if (t.canFold(seat)) out.push({ type: "fold" });
      if (stack > 0) out.push({ type: "allIn" });
      const sizes = new Set<number>();
      if (h.target === 0) {
        for (const x of [minBet, 10, 20, Math.floor(h.pot / 2), h.pot]) if (x >= minBet && x < stack) sizes.add(x);
        for (const x of [...sizes].sort((a, b) => a - b)) out.push({ type: "bet", amount: x });
      } else {
        const minTo = h.target + h.minRaise;
        for (const to of [minTo, h.target * 2, h.target + h.pot]) if (to >= minTo && to - me < stack) sizes.add(to);
        for (const to of [...sizes].sort((a, b) => a - b)) out.push({ type: "raise", to });
      }
      return out;
    }
    case "operate":
      return [{ type: "operate", draft: false }, { type: "operate", draft: true }];
    case "draft": {
      const out: Action[] = [];
      const slots = h.placement[seat]!.slots;
      for (let offerIndex = 0; offerIndex < 3; offerIndex++) {
        for (let pos = 0; pos < 3; pos++) if (slots[pos] !== null) out.push({ type: "draft", offerIndex, pos });
      }
      return out;
    }
    case "vote":
      return [{ type: "vote", activate: true }, { type: "vote", activate: false }];
    case "bid": {
      const cap = h.bidCap;
      const amounts = new Set([0, 5, 10, 20, Math.floor(cap / 2), cap].filter((x) => x >= 0 && x <= cap));
      return [...amounts].sort((a, b) => a - b).map((amount) => ({ type: "bid", amount }));
    }
    case "marketPick":
      return h.market.map((_, index) => ({ type: "marketPick", index }));
    case "marketRemove": {
      const out: Action[] = [{ type: "marketRemove", poolIndex: null }];
      if (t.pools[seat].length - 1 >= t.options.minPoolSize) {
        t.pools[seat].forEach((_, poolIndex) => out.push({ type: "marketRemove", poolIndex }));
      }
      return out;
    }
    case "over":
      return [];
  }
}

/** 调试用：把观察里的人物编号换成名字。 */
export function describeSlots(slots: (string | null)[]): string {
  return slots.map((c, i) => `${i + 1}号 ${c ? character(c).name : "（空）"}`).join("，");
}
