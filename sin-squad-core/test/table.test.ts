import { describe, expect, it } from "vitest";
import { HeuristicAgent, playTable, RandomAgent } from "../src/ai/agents.js";
import type { Action, Phase } from "../src/game/actions.js";
import { Table } from "../src/game/table.js";
import { legalActions, observe } from "../src/game/view.js";
import type { Seat } from "../src/types.js";
import { CHARACTERS } from "../src/content/characters.js";
import { SLOT_EFFECTS } from "../src/content/tables.js";

/** 被动策略：能过牌就过牌、要跟就跟，其余取第一个合法动作。 */
function passive(t: Table, seat: Seat): Action {
  const acts = legalActions(t, seat);
  const find = (type: Action["type"]) => acts.find((a) => a.type === type);
  switch (t.phase) {
    case "bet": return find("check") ?? find("call")!;
    case "operate": return { type: "operate", draft: false };
    case "vote": return { type: "vote", activate: true };
    case "marketRemove": return { type: "marketRemove", poolIndex: null };
    default: return acts[0];
  }
}

function driveUntil(t: Table, phase: Phase, policy = passive) {
  for (let i = 0; i < 500 && t.phase !== phase; i++) {
    for (const s of t.toAct()) if (t.toAct().includes(s)) t.apply(s, policy(t, s));
  }
  expect(t.phase).toBe(phase);
}

describe("整张牌桌", () => {
  it("扩展人物池为每罪 8 人，槽位效果减半为 25 张", () => {
    expect(CHARACTERS).toHaveLength(56);
    for (const sin of ["愤怒", "贪婪", "暴食", "嫉妒", "怠惰", "傲慢", "色欲"]) {
      expect(CHARACTERS.filter((c) => c.sin === sin)).toHaveLength(8);
    }
    expect(SLOT_EFFECTS).toHaveLength(25);
    expect(new Set(SLOT_EFFECTS.map((x) => x.id)).size).toBe(25);
  });

  it("随机对手打几百张牌桌：不卡死、筹码守恒、最后有人赢", () => {
    for (let seed = 1; seed <= 300; seed++) {
      const t = new Table({ seed });
      playTable(t, [new RandomAgent(seed), new RandomAgent(seed + 1000)]);
      expect(t.phase).toBe("over");
      expect(t.stacks[0] + t.stacks[1]).toBe(200);
      expect(t.winner).not.toBeNull();
    }
  });

  it("启发式对手也能正常打完", () => {
    for (let seed = 1; seed <= 5; seed++) {
      const t = new Table({ seed });
      playTable(t, [new HeuristicAgent("cautious", seed), new HeuristicAgent("bluff", seed + 1)]);
      expect(t.phase).toBe("over");
    }
  });

  it("同一个种子、同样的动作，得到完全相同的牌桌", () => {
    const run = () => {
      const t = new Table({ seed: 77 });
      playTable(t, [new RandomAgent(1), new RandomAgent(2)]);
      return JSON.stringify(t.log);
    };
    expect(run()).toBe(run());
  });
});

describe("下注与操作费", () => {
  it("操作费按有效筹码封顶", () => {
    const t = new Table({ seed: 3 });
    t.stacks = [140, 50]; // 底注后奖池 10，总额仍为 200
    driveUntil(t, "bet");
    const first = t.toAct()[0];
    t.apply(first, { type: "bet", amount: 30 });
    t.apply(t.toAct()[0], { type: "call" });
    expect(t.phase).toBe("operate");
    expect(t.hand.opFee).toBe(20); // 短码跟注后只剩 20
  });

  it("全押时退回本轮对方跟不上的部分", () => {
    const t = new Table({ seed: 4 });
    t.stacks = [140, 50];
    driveUntil(t, "bet");
    const first = t.toAct()[0];
    if (first === 0) {
      t.apply(0, { type: "bet", amount: 100 });
      t.apply(1, { type: "allIn" });
    } else {
      t.apply(1, { type: "allIn" });
      t.apply(0, { type: "call" });
    }
    expect(t.hand.allIn).toBe(true);
    expect(t.hand.invested[0]).toBe(t.hand.invested[1]);
    t.checkInvariant();
  });

  it("弃牌：奖池归对方，不打战斗", () => {
    const t = new Table({ seed: 5 });
    driveUntil(t, "bet");
    const folder = t.toAct()[0];
    expect(t.canFold(folder)).toBe(true);
    t.apply(folder, { type: "fold" });
    expect(t.hand.outcome?.by).toBe("fold");
    expect(t.hand.battle).toBeNull();
    expect(t.stacks[folder]).toBe(95);
    expect(t.phase).toBe("marketPick");
    expect(t.toAct()).toEqual([folder]); // 输家先挑
  });

  it("冠冕者被亮出时，对手第 1 轮不能弃牌", () => {
    const t = new Table({ seed: 1, rig: { dealer: 1, deal: [["PR3"], null] } }); // 你（座位 0）先布阵
    driveUntil(t, "place");
    t.apply(0, { type: "place", picks: [0, 1, 2], eat: null, reveal: 0 }); // 冠冕者在 1 号位亮出
    driveUntil(t, "bet");
    expect(t.canFold(1)).toBe(false);
    expect(legalActions(t, 1).some((a) => a.type === "fold")).toBe(false);
  });
});

describe("窥视者", () => {
  /** 固定发牌：座位 0 先布阵，把窥视者暗置在 2 号位；对手没有窥视者。 */
  function toPeek() {
    const t = new Table({ seed: 3, rig: { dealer: 1, deal: [["WR3", "EN1", "GR2", "SL1"], ["LU1", "GR3", "PR1", "WR2"]] } });
    driveUntil(t, "place");
    t.apply(0, { type: "place", picks: [0, 1, 2], eat: null, reveal: 0 });
    t.apply(1, { type: "place", picks: [0, 1, 2], eat: null, reveal: 0 });
    expect(t.phase).toBe("peek");
    expect(t.toAct()).toEqual([0]);
    return { t, seat: 0 as Seat };
  }

  it("偷看是暗中进行的：不写进公开的牌桌记录", () => {
    const { t, seat } = toPeek();
    const before = t.log.length;
    t.apply(seat, { type: "peek", pos: 1 });
    expect(t.log.length).toBe(before);
    expect(observe(t, seat).me.peek?.pos).toBe(1);
    expect(observe(t, seat === 0 ? 1 : 0).me.peek).toBeNull();
  });

  it("偷看后可以交换自己两名暗置人物；亮出的那名不能动", () => {
    const { t, seat } = toPeek();
    t.apply(seat, { type: "peek", pos: 2 });
    const slots = t.hand.placement[seat]!.slots.slice();
    expect(() => t.apply(seat, { type: "peekSwap", swap: [0, 1] })).toThrow(); // 0 号位是亮出的
    expect(legalActions(t, seat)).toContainEqual({ type: "peekSwap", swap: [1, 2] });
    t.apply(seat, { type: "peekSwap", swap: [1, 2] });
    expect(t.hand.placement[seat]!.slots).toEqual([slots[0], slots[2], slots[1]]);
    expect(t.phase).toBe("bet");
  });
});

describe("调试固定项", () => {
  it("固定发牌、规则、公共效果、场地、庄家；没固定的照常随机", () => {
    const rig = { deal: [["EN1", "GL2"], null] as [string[], null], ruleId: "V02", publicEffectId: "P10", arenaOptions: ["A08", "A02"] as [string, string], dealer: 0 as Seat };
    const t = new Table({ seed: 9, rig });
    expect(t.hand.dealer).toBe(0);
    expect(t.hand.arenaOptions).toEqual(["A08", "A02"]);
    expect(t.hand.ruleId).toBe("V02");
    expect(t.hand.publicEffectId).toBe("P10");
    driveUntil(t, "place");
    expect(t.hand.dealt[0].slice(0, 2)).toEqual(["EN1", "GL2"]);
    expect(t.hand.dealt[0]).toHaveLength(4);
    expect(new Table({ seed: 9 }).pools).toEqual(t.pools); // 随机数照常消耗
  });

  it("编号写错会立刻报错", () => {
    expect(() => new Table({ rig: { deal: [["XX9"], null] } })).toThrow();
    expect(() => new Table({ rig: { ruleId: "V99" } })).toThrow();
  });
});

describe("公共效果暗标", () => {
  function toBid(seed: number) {
    const t = new Table({ seed });
    driveUntil(t, "vote");
    t.apply(0, { type: "vote", activate: true });
    t.apply(1, { type: "vote", activate: false });
    expect(t.phase).toBe("bid");
    return t;
  }

  it("出价高的一方决定去留，只付自己的出价", () => {
    const t = toBid(6);
    const before = [t.stacks[0], t.stacks[1]];
    t.apply(0, { type: "bid", amount: 15 });
    t.apply(1, { type: "bid", amount: 10 });
    expect(t.hand.peActive).toBe(true);
    expect(t.stacks[0]).toBe(before[0] - 15);
    expect(t.stacks[1]).toBe(before[1]);
    expect(t.phase).toBe("bet");
  });

  it("出价相同：不生效，谁都不付钱", () => {
    const t = toBid(6);
    const before = [t.stacks[0], t.stacks[1]];
    t.apply(0, { type: "bid", amount: 10 });
    t.apply(1, { type: "bid", amount: 10 });
    expect(t.hand.peActive).toBe(false);
    expect([t.stacks[0], t.stacks[1]]).toEqual(before);
  });

  it("出价不能超过有效筹码", () => {
    const t = toBid(6);
    expect(() => t.apply(0, { type: "bid", amount: t.hand.bidCap + 1 })).toThrow();
  });
});

describe("隐藏信息", () => {
  it("规则和公共效果翻开前看不到；对手的暗置人物不在观察里", () => {
    const t = new Table({ seed: 8 });
    driveUntil(t, "bet");
    for (const s of [0, 1] as Seat[]) {
      const obs = observe(t, s);
      expect(obs.ruleId).toBeNull();
      expect(obs.publicEffectId).toBeNull();
      const foe = t.hand.placement[s === 0 ? 1 : 0]!;
      expect(obs.opponent.revealed?.characterId).toBe(foe.slots[foe.reveal]);
      expect("placement" in obs.opponent).toBe(false);
      expect("dealt" in obs.opponent).toBe(false);
    }
  });

  it("表决和出价在双方都提交前不公开", () => {
    const t = new Table({ seed: 6 });
    driveUntil(t, "vote");
    t.apply(0, { type: "vote", activate: true });
    const obs = observe(t, 1);
    expect(obs.opponent.submitted).toBe(true);
    expect(JSON.stringify(obs)).not.toContain('"vote":true');
  });
});

describe("牌桌层", () => {
  it("筹码少的一方选场地", () => {
    const t = new Table({ seed: 9 });
    driveUntil(t, "bet");
    const folder = t.toAct()[0];
    expect(t.canFold(folder)).toBe(true);
    t.apply(folder, { type: "fold" });
    driveUntil(t, "arena");
    expect(t.hand.arenaChooser).toBe(folder);
  });

  it("每 5 手底注翻倍；市场按阶段升级", () => {
    expect(Table.marketStageFor(5)).toBe(1);
    expect(Table.marketStageFor(6)).toBe(2);
    expect(Table.marketStageFor(11)).toBe(3);
  });

  it("移除后牌池不能少于下限", () => {
    const t = new Table({ seed: 10, initialPoolSize: 6, minPoolSize: 7 });
    driveUntil(t, "marketRemove", (tt, s) => (tt.phase === "bet" && tt.canFold(s) ? { type: "fold" } : passive(tt, s)));
    const seat = t.toAct()[0];
    expect(t.pools[seat].length).toBe(7);
    expect(() => t.apply(seat, { type: "marketRemove", poolIndex: 0 })).toThrow();
    expect(legalActions(t, seat)).toEqual([{ type: "marketRemove", poolIndex: null }]);
  });
});

describe("存档重放", () => {
  it("同一个种子照着记录的动作重放，回到一模一样的局面", () => {
    const seed = 2024;
    const t = new Table({ seed });
    const agents = [new HeuristicAgent("aggressive", 1), new HeuristicAgent("bluff", 2)];
    const record: Array<[Seat, Action]> = [];
    for (let i = 0; i < 400 && t.phase !== "over"; i++) {
      const seat = t.toAct()[0];
      const a = agents[seat].act(t, seat);
      t.apply(seat, a);
      record.push([seat, JSON.parse(JSON.stringify(a))]); // 和存进浏览器一样走一遍 JSON
    }
    const r = new Table({ seed });
    for (const [seat, a] of record) r.apply(seat, a);
    expect(r.handNo).toBe(t.handNo);
    expect(r.phase).toBe(t.phase);
    expect(r.stacks).toEqual(t.stacks);
    expect(r.log).toEqual(t.log);
    expect(observe(r, 0)).toEqual(observe(t, 0));
  });
});

describe("牌桌结束", () => {
  it("有人筹码输光，结算后立刻结束，不再进市场", () => {
    for (let seed = 1; seed <= 30; seed++) {
      const t = new Table({ seed });
      const agents = [new HeuristicAgent("aggressive", seed), new HeuristicAgent("aggressive", seed + 100)];
      for (let i = 0; i < 2000 && t.phase !== "over"; i++) {
        const seat = t.toAct()[0];
        t.apply(seat, agents[seat].act(t, seat));
        if (t.phase === "marketPick" || t.phase === "marketRemove") {
          expect(t.stacks[0]).toBeGreaterThan(0);
          expect(t.stacks[1]).toBeGreaterThan(0);
        }
      }
      expect(t.phase).toBe("over");
      expect(t.stacks[t.winner!]).toBe(200);
      const last = t.log.slice(-2).map((e) => e.type);
      expect(last).toEqual(["settle", "tableOver"]);
    }
  });
});
