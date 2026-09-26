import { describe, expect, it } from "vitest";
import { runBattle, splitMulti } from "../src/battle/engine.js";
import { character } from "../src/content/characters.js";
import { randomBattle } from "../src/sim/sampler.js";
import { Rng } from "../src/rng.js";
import { afterHit, battle, team } from "./helpers.js";

/** 这一场里某个能力有没有发动过。 */
const fired = (r: ReturnType<typeof battle>, name: string) => r.events.some((e) => e.type === "trigger" && e.name === name);
const solo = (id: string, b = {}) => team([id, null, null], [null, null, null], b);
/** 人物卡面上的攻 / 血 / 护甲（测试不写死身材，调数值时不用跟着改）。 */
const atk = (id: string) => character(id).atk;
const hp = (id: string) => character(id).hp;
const arm = (id: string) => character(id).armor;
/** 一次攻击打在护甲上的伤害（连击每段减护甲，整次至少 1）。 */
const dealt = (id: string, d: number, armor: number) => {
  const parts = character(id).shape === "multi" ? splitMulti(d) : [d];
  return Math.max(1, parts.reduce((s, p) => s + Math.max(0, p - armor), 0));
};
/** 随机一场（双方随机 3 人、随机规则场地），直接打完。 */
const randomRun = (rng: Rng) => runBattle(randomBattle(rng).input);

describe("新人物：开战时的能力", () => {
  it("利滚利：每付一次操作费，攻 +1", () => {
    expect(battle(solo("GR4", { opsPaid: 2 }), solo("SL7")).start[0][0].atk).toBe(4);
  });

  it("赌徒：本手下注或加注过，攻 +2", () => {
    expect(battle(solo("GR6", { betOrRaiseCount: 1 }), solo("SL7")).start[0][0].atk).toBe(6);
    expect(battle(solo("GR6"), solo("SL7")).start[0][0].atk).toBe(4);
  });

  it("宝库主：本手投入超过 30，攻 +3", () => {
    expect(battle(solo("GR8", { invested: 31 }), solo("SL7")).start[0][0].atk).toBe(8);
    expect(battle(solo("GR8", { invested: 30 }), solo("SL7")).start[0][0].atk).toBe(5);
  });

  it("躺赢者：没下注也没加注，+2/+3", () => {
    const idle = battle(solo("SL5"), solo("SL7")).start[0][0];
    expect([idle.atk, idle.hp]).toEqual([3, 13]);
    const bet = battle(solo("SL5", { betOrRaiseCount: 1 }), solo("SL7")).start[0][0];
    expect([bet.atk, bet.hp]).toEqual([1, 10]);
  });

  it("金库守卫：筹码领先才得屏障", () => {
    expect(battle(solo("GR5", { stack: 80 }), solo("SL7", { stack: 60 })).start[0][0].barrier).toBe(1);
    expect(battle(solo("GR5", { stack: 60 }), solo("SL7", { stack: 80 })).start[0][0].barrier).toBe(0);
  });

  it("战吼者：全队攻 +1；首席被亮出时全队攻 +1", () => {
    const shout = battle(team(["WR7", "GR4", null]), solo("SL7")).start[0];
    expect([shout[0].atk, shout[1].atk]).toEqual([atk("WR7") + 1, atk("GR4") + 1]);
    const lead = battle(team(["GR4", "PR5", null], [null, null, null], { revealedPos: 1 }), solo("SL7")).start[0];
    expect([lead[0].atk, lead[1].atk]).toEqual([atk("GR4") + 1, atk("PR5") + 1]);
    const hidden = battle(team(["GR4", "PR5", null], [null, null, null], { revealedPos: 0 }), solo("SL7")).start[0];
    expect(hidden[0].atk).toBe(atk("GR4"));
  });

  it("双生誓：站在 2 号位、两侧都有队友，全队血 +2", () => {
    const mid = battle(team(["GR4", "LU8", "GR4"]), solo("SL7")).start[0];
    expect(mid.map((u) => u.hp)).toEqual([hp("GR4") + 2, hp("LU8") + 2, hp("GR4") + 2]);
    const side = battle(team(["LU8", "GR4", "GR4"]), solo("SL7")).start[0];
    expect(side.map((u) => u.hp)).toEqual([hp("LU8"), hp("GR4"), hp("GR4")]);
  });

  it("复写匠复制对位的护甲，镜狱获得对位的攻（最多 +3）", () => {
    expect(battle(solo("EN5"), solo("GR5")).start[0][0].armor).toBe(arm("EN5") + arm("GR5"));
    expect(battle(solo("EN8"), solo("WR3")).start[0][0].atk).toBe(atk("EN8") + Math.min(3, atk("WR3")));
    expect(battle(solo("EN8"), solo("GR4")).start[0][0].atk).toBe(atk("EN8") + Math.min(3, atk("GR4")));
  });

  it("偷心者：对位带着装备或效果牌开战，攻 +2", () => {
    expect(battle(solo("EN4"), team(["SL7", null, null], ["E09"])).start[0][0].atk).toBe(atk("EN4") + 2);
    expect(battle(solo("EN4"), solo("SL7")).start[0][0].atk).toBe(atk("EN4"));
  });
});

describe("新人物：攻击时的加值", () => {
  it("窥伺刀：打被亮出的敌人攻 +2", () => {
    // 靶子用金库守卫（12 血、护甲 2）；休眠守卫每轮开始会自己加屏障，挡掉第一下
    const seen = battle(solo("EN6"), team(["GR5", null, null], [null, null, null], { revealedPos: 0 }));
    const hidden = battle(solo("EN6"), team(["GR5", null, null], [null, null, null], { revealedPos: 1 }));
    expect(afterHit(seen, 1)[1][0].hp).toBe(hp("GR5") - dealt("EN6", atk("EN6") + 2, arm("GR5")));
    expect(afterHit(hidden, 1)[1][0].hp).toBe(hp("GR5") - dealt("EN6", atk("EN6"), arm("GR5")));
  });

  it("饥饿猎犬：打血比自己少的人攻 +2", () => {
    // 对方血更多：不加；对方血更少：加
    expect(hp("GR5")).toBeGreaterThanOrEqual(hp("GL6"));
    expect(afterHit(battle(solo("GL6"), solo("GR5")), 1)[1][0].hp).toBe(hp("GR5") - dealt("GL6", atk("GL6"), arm("GR5")));
    expect(hp("GR1")).toBeLessThan(hp("GL6"));
    expect(fired(battle(solo("GL6"), solo("GR1")), "饥饿猎犬")).toBe(true);
  });

  it("终餐者：敌方只剩一人时攻 +4", () => {
    expect(afterHit(battle(solo("GL8"), solo("GR5")), 1)[1][0].hp).toBe(hp("GR5") - dealt("GL8", atk("GL8") + 4, arm("GR5")));
    expect(afterHit(battle(solo("GL8"), team(["GR5", "GR5", null])), 1)[1][0].hp).toBe(hp("GR5") - dealt("GL8", atk("GL8"), arm("GR5")));
  });

  it("优越者：对位攻比自己低时攻 +2", () => {
    expect(atk("GR5")).toBeLessThan(atk("PR7"));
    expect(afterHit(battle(solo("PR7"), solo("GR5")), 1)[1][0].hp).toBe(hp("GR5") - dealt("PR7", atk("PR7") + 2, arm("GR5")));
  });

  it("共鸣者：相邻队友攻比自己高时攻 +2", () => {
    const r = battle(team([null, "LU6", "GL8"]), team([null, "SL7", "SL7"]));
    expect(fired(r, "共鸣者")).toBe(true);
  });

  it("终止符：第三轮起才加攻", () => {
    const rng = new Rng(7);
    for (let i = 0; i < 300; i++) {
      const r = randomRun(rng);
      for (const e of r.events) if (e.type === "trigger" && e.name === "终止符") expect(e.round).toBeGreaterThanOrEqual(3);
    }
  });
});

describe("新人物：受击、击倒与过线", () => {
  it("镀金者：满血时护甲 +1", () => {
    // 怒潮连击 1+2：第一段被镀金者的屏障挡掉，第二段 2 − 满血护甲（0 + 1）= 1
    expect(afterHit(battle(solo("WR4"), solo("PR4")), 1)[1][0].hp).toBe(hp("PR4") - 1);
  });

  it("慢钟：第一轮每段伤害 -2，最少 1", () => {
    expect(afterHit(battle(solo("WR8"), solo("SL4")), 1)[1][0].hp).toBe(hp("SL4") - Math.max(1, atk("WR8") - arm("SL4") - 2));
  });

  it("酸液兽：打中带护甲的人，腐蚀掉 1 点护甲（每人一次）", () => {
    const r = battle(solo("GL5"), solo("GR5"));
    expect(afterHit(r, 1)[1][0].armor).toBe(arm("GR5") - 1);
    expect(r.events.filter((e) => e.type === "trigger" && e.name === "酸液兽")).toHaveLength(1);
  });

  it("破阵者：第一次打破屏障，攻 +2", () => {
    const r = battle(solo("WR5"), solo("PR2"));
    expect(fired(r, "破阵者")).toBe(true);
    expect(afterHit(r, 1)[0][0].atk).toBe(atk("WR5") + 2);
  });

  it("掠夺商击倒敌人得屏障，吞光者击倒敌人回血", () => {
    expect(fired(battle(solo("GR7"), solo("GR1")), "掠夺商")).toBe(true);
    expect(fired(battle(solo("GL4"), solo("GR1")), "吞光者")).toBe(true);
  });

  it("怒潮、不屈冠军：第一次低于一半生命时各触发一次", () => {
    const rage = battle(solo("WR4"), solo("WR3"));
    expect(rage.events.filter((e) => e.type === "trigger" && e.name === "怒潮").length).toBeLessThanOrEqual(1);
    expect(fired(battle(solo("PR6"), solo("WR3")), "不屈冠军")).toBe(true);
  });

  it("诱导者：转线的敌人优先打它", () => {
    // 我方 1 号位的对位是空的，转线后本该打血最少的金主，被诱导者嘲讽
    const r = battle(solo("WR8"), team([null, "GR1", "LU7"]));
    const first = r.events.find((e) => e.type === "attack" && e.seat === 0);
    expect(first?.type === "attack" && first.targetPos).toBe(2);
    expect(fired(r, "诱导者")).toBe(true);
  });

  it("缓行者：被打中后，下一轮攻 +2", () => {
    // 对手是攻 1 的护心人：缓行者能活到第二轮再出手
    const r = battle(solo("SL6"), solo("LU5"));
    const hit = r.events.find((e) => e.type === "trigger" && e.name === "缓行者" && e.text.startsWith("蓄力"));
    expect(hit && hit.round).toBeGreaterThanOrEqual(2);
  });

  it("复仇印：被同一个敌人连续打中，攻 +1", () => {
    expect(fired(battle(solo("WR6"), solo("SL7")), "复仇印")).toBe(true);
  });

  it("护心人：相邻队友被攻击时得屏障", () => {
    expect(fired(battle(solo("WR8"), team(["SL7", "LU5", null])), "护心人")).toBe(true);
  });

  it("夺势者：敌方开战时攻最高的人倒下，全队攻 +2", () => {
    // 敌方攻最高的是清算者（攻 5、血 4），我方断头台第一下就把它打倒；夺势者在 2 号位活着
    expect(atk("WR8")).toBeGreaterThanOrEqual(hp("WR3"));
    const r = battle(team(["WR8", "EN7", null]), team(["WR3", "GR1", null]));
    expect(fired(r, "夺势者")).toBe(true);
  });

  it("缠绵者：对位敌人被击倒，相邻队友回复", () => {
    const rng = new Rng(11);
    let seen = false;
    for (let i = 0; i < 400 && !seen; i++) seen = fired(randomRun(rng), "缠绵者");
    expect(seen).toBe(true);
  });

  it("胃囊巨人：受到治疗时额外回复 1", () => {
    // 血泉：每失去 5 血回复 2
    expect(fired(battle(solo("GL7"), solo("WR8"), { publicEffectId: "P21" }), "胃囊巨人")).toBe(true);
  });
});

describe("新人物：大量随机对局", () => {
  it("56 名人物混打几千场：不出错、血量和攻都是整数", () => {
    const rng = new Rng(2026);
    for (let i = 0; i < 3000; i++) {
      const r = randomRun(rng);
      for (const side of r.final) for (const u of side) {
        expect(Number.isInteger(u.hp)).toBe(true);
        expect(Number.isInteger(u.atk)).toBe(true);
      }
    }
  });
});
