import { describe, expect, it } from "vitest";
import { runBattle, splitMulti } from "../src/battle/engine.js";
import { randomBattle } from "../src/sim/sampler.js";
import { Rng } from "../src/rng.js";
import { afterHit, battle, hpAfter, team } from "./helpers.js";

describe("形状克制环", () => {
  it("效果槽牌会按新版攻/血面板参与战斗", () => {
    const base = battle(team(["GR3", null, null]), team(["SL1", null, null]));
    const boosted = battle({ ...team(["GR3", null, null]), slots: [{ characterId: "GR3", equipmentId: null, effectId: "FX01" }, { characterId: null, equipmentId: null }, { characterId: null, equipmentId: null }] }, team(["SL1", null, null]));
    // 看开战那一刻的面板：第 1 轮结束时收藏家可能已经击倒敌人、又拿了 +2
    expect(boosted.start[0][0].atk).toBe(base.start[0][0].atk + 2);
  });

  it("重击打护甲：每下减去护甲", () => {
    const r = battle(team(["GR3", null, null]), team(["SL1", null, null]));
    const hit = afterHit(r, 1); // 收藏家先手打瞌睡客
    expect(hit[1][0].hp).toBe(9 - 3); // 4 − 护甲 1
    expect(hit[0][0].hp).toBe(7 - 1); // 瞌睡客反击 1
  });

  it("护甲克连击：每段都被减，但整次攻击至少扣 1", () => {
    const low = battle(team(["WR1", null, null]), team(["SL1", null, null]));
    expect(afterHit(low, 1)[1][0].hp).toBe(8); // 两段各 1，全被护甲吃掉，补到 1

    const multi = battle(team(["GR3", null, null], ["E07"]), team(["SL1", null, null]));
    const heavy = battle(team(["GR3", null, null]), team(["SL1", null, null]));
    expect(afterHit(multi, 1)[1][0].hp).toBe(9 - 2); // 连击 4：2 + 2，各减 1 → 2
    expect(afterHit(heavy, 1)[1][0].hp).toBe(9 - 3); // 重击 4：4 − 1 → 3
  });

  it("屏障克重击、连击克屏障", () => {
    const vsHeavy = battle(team(["GR3", null, null]), team(["PR2", null, null]));
    expect(afterHit(vsHeavy, 1)[1][0].hp).toBe(3); // 整下被挡
    const vsMulti = battle(team(["WR1", null, null]), team(["PR2", null, null]));
    expect(afterHit(vsMulti, 1)[1][0].hp).toBe(2); // 第一段被挡，第二段打中
  });
});

describe("对位、转线与守护", () => {
  it("对位空着时，先花一轮转线", () => {
    const a = team(["GR3", null, null]);
    const b = team([null, "SL1", null]);
    const normal = battle(a, b);
    expect(hpAfter(normal, 1, 1, 1)).toBe(9); // 双方第 1 轮都在转线
    expect(hpAfter(normal, 2, 1, 1)).toBe(9 - 3 - 3); // 第 2 轮互相碰撞两次

    const arena02 = battle(a, b, { arenaId: "A02" }); // 圆形斗场：转线不花时间
    expect(hpAfter(arena02, 1, 1, 1)).toBe(3);

    const arena03 = battle(a, b, { arenaId: "A03" }); // 结冰渡口：转线要花两轮
    expect(hpAfter(arena03, 2, 1, 1)).toBe(9);
    expect(hpAfter(arena03, 3, 1, 1)).toBe(3);
  });

  it("守护：相邻队友受到的攻击改由同行药袋承受", () => {
    const r = battle(team(["GR3", null, null]), team(["WR2", "LU1", null]));
    const hit = afterHit(r, 1);
    expect(hit[1][1].hp).toBe(12 - 4); // 收藏家的 4 打在药袋身上
    expect(hit[1][0].hp).toBe(10); // 蓄痛拳手没挨打
    expect(hit[0][0].hp).toBe(7); // 药袋这一轮在转线，不反击
  });
});

describe("轮流出手与碰撞", () => {
  it("每次攻击都是一次碰撞：双方各吃对方的攻", () => {
    const r = battle(team(["GR3", null, null]), team(["GR2", null, null]));
    const first = afterHit(r, 1);
    expect(first[1][0].hp).toBe(8 - 4);
    expect(first[0][0].hp).toBe(7 - 3);
    // 盾税官还手这一下，再碰撞一次：盾税官倒下，收藏家剩 1
    expect(r.winner).toBe(0);
    expect(r.rounds).toBe(1);
    expect(r.final[0][0].hp).toBe(1);
  });

  it("第 1 轮由指定的一方先手，之后每轮轮换", () => {
    const r = battle(team(["SL1", null, null]), team(["SL1", null, null]), { firstSeat: 1 });
    const firstAttacker = (round: number) => r.events.find((e) => e.type === "attack" && e.round === round)!;
    expect(firstAttacker(1)).toMatchObject({ seat: 1 });
    expect(firstAttacker(2)).toMatchObject({ seat: 0 });
    expect(firstAttacker(3)).toMatchObject({ seat: 1 });
  });

  it("屏障也挡碰撞", () => {
    // 无瑕刺客 3/3 带 1 层屏障，满血翻倍打盾税官；盾税官的 3 点反击被屏障挡掉
    const r = battle(team(["PR2", null, null]), team(["GR2", null, null]));
    const hit = afterHit(r, 1);
    expect(hit[1][0].hp).toBe(8 - 6);
    expect(hit[0][0].hp).toBe(3);
    expect(hit[0][0].barrier).toBe(0);
  });

  it("这一轮不出手的人不反击", () => {
    // 沉眠巨像第一轮沉睡：收藏家打它，它不还手
    const r = battle(team(["GR3", null, null]), team(["SL2", null, null]));
    const hit = afterHit(r, 1);
    expect(hit[0][0].hp).toBe(7);
    expect(hit[1][0].hp).toBe(7 - 3);
    expect(r.events.some((e) => e.type === "recoil" && e.round === 1)).toBe(false);
    // 第二轮醒来，它先手打收藏家，收藏家照常反击
    const wake = afterHit(r, 2);
    expect(wake[0][0].hp).toBe(7 - 3);
    expect(wake[1][0].hp).toBe(4 - 3);
  });

  it("吸血：自己攻击每打中一段回 1，反击打出的伤害不回血", () => {
    const r = battle(team(["GL1", null, null]), team(["LU1", null, null]));
    // 嚼盾兽 3/8 连击 1+2 打同行药袋 3/12：两段都打中，回 2；同时吃药袋 3 点反击
    expect(afterHit(r, 1)[0][0].hp).toBe(8 - 3 + 2);
    expect(afterHit(r, 1)[1][0].hp).toBe(12 - 3);
    // 药袋回打：嚼盾兽挨 3，它的反击也打出 3，但不回血
    expect(afterHit(r, 2)[0][0].hp).toBe(7 - 3);
    expect(afterHit(r, 2)[1][0].hp).toBe(9 - 3);
  });

  it("吸血按打中的段数算：护甲吃掉一段就少回 1", () => {
    // 瞌睡客护甲 1：连击 1+2 → 第一段被吃光，只有第二段打中，回 1
    const r = battle(team(["GL1", null, null]), team(["SL1", null, null]));
    const hp0 = r.start[0][0].startHp;
    expect(afterHit(r, 1)[0][0].hp).toBe(hp0 - 1 + 1);
  });

  it("连击拆成两段整数：奇数时后一段多 1", () => {
    expect(splitMulti(3)).toEqual([1, 2]);
    expect(splitMulti(4)).toEqual([2, 2]);
    expect(splitMulti(1)).toEqual([1]);
  });

  it("每一帧都附带当时的快照，给回放用", () => {
    const r = battle(team(["GR3", null, null]), team(["SL1", null, null]));
    expect(r.frames.length).toBeGreaterThan(1);
    expect(r.frames.at(-1)!.after).toEqual(r.final);
  });
});

describe("胜负判定", () => {
  it("同一次碰撞里同时达成（同归于尽）算平局，谁打得多都一样", () => {
    const draw = battle(team(["WR3", null, null]), team(["WR3", null, null]));
    expect(draw.winner).toBeNull();
    expect(draw.reason).toBe("平局");

    const lopsided = battle(team(["WR3", null, null], ["E01"]), team(["WR3", null, null]));
    // 带校准刃的清算者打出 8、对面只打出 5，但两人同时倒下，照样是平局
    expect(lopsided.winner).toBeNull();
    expect(lopsided.reason).toBe("平局");
    expect(lopsided.rounds).toBe(1);
  });

  it("众目所向：击倒对方亮出的那名就立刻赢，哪怕他还有人站着", () => {
    const r = battle(
      team(["WR3", null, "SL1"], [null, null, null], { revealedPos: 0 }),
      team(["SL1", null, "SL1"], [null, null, null], { revealedPos: 0 }),
      { ruleId: "V12" },
    );
    expect(r.winner).toBe(0);
    expect(r.reason).toBe("达成规则");
    expect(r.rounds).toBe(2); // 第 2 轮瞌睡客打清算者时吃了反击倒下，当场结束
    expect(r.final[1][2].alive).toBe(true);
  });

  it("限时规则按自带的回合数结束", () => {
    const r = battle(team(["SL1", null, null]), team(["SL1", null, null]), { ruleId: "V19" });
    expect(r.rounds).toBe(3);
  });
});

describe("开战时的能力", () => {
  it("夺装者拿走对位的装备；静默书库让它失效", () => {
    const a = team(["EN3", null, null]);
    const b = team(["GR3", null, null], ["E02"]);
    const stolen = battle(a, b);
    expect(stolen.start[0][0].startHp).toBe(7 + 6);
    expect(stolen.start[1][0].startHp).toBe(7);
    const silenced = battle(a, b, { arenaId: "A08" });
    expect(silenced.start[0][0].startHp).toBe(7);
    expect(silenced.start[1][0].startHp).toBe(7 + 6);
  });

  it("饕餮吞掉队友：得到它的攻和血，那个位置空出来", () => {
    const r = battle(team(["GL2", "SL1", null], [null, null, null], {}, { eater: 0, eaten: 1 }), team(["LU1", null, null]));
    const me = r.start[0];
    expect(me[0].atk).toBe(3 + 1);
    expect(me[0].startHp).toBe(8 + 9);
    expect(me[1].characterId).toBeNull();
  });

  it("下注层能力：金主按投入成长，挑衅者按对手加注成长", () => {
    const r = battle(
      team(["GR1", "WR1", null], [null, null, null], { invested: 35 }),
      team(["LU1", "LU1", null], [null, null, null], { betOrRaiseCount: 2 }),
    );
    const me = r.start[0];
    expect(me[0].atk).toBe(1 + 3);
    expect(me[0].startHp).toBe(5 + 3);
    expect(me[1].atk).toBe(2 + 2 * 2);
  });
});

describe("触发事件", () => {
  it("开战时和战斗中生效的能力都会记下来，给画面播放", () => {
    const r = battle(
      team(["PR1", "WR2", null], [null, null, null], { revealedPos: 0 }),
      team(["GR3", "GR2", null]),
    );
    const trig = r.events.filter((e) => e.type === "trigger");
    expect(trig).toContainEqual({ round: 0, type: "trigger", seat: 0, pos: 0, name: "炫耀者", text: "被亮出：+3/+4" });
    expect(trig.some((e) => e.round === 1 && e.name === "蓄痛拳手")).toBe(true);
  });
});

describe("确定性", () => {
  it("同样的输入永远得到同样的结果", () => {
    const rng = new Rng(42);
    for (let i = 0; i < 200; i++) {
      const { input } = randomBattle(rng);
      expect(runBattle(input)).toEqual(runBattle(input));
    }
  });

  it("所有结算都是整数：血量、伤害、回复没有小数", () => {
    const rng = new Rng(5);
    for (let i = 0; i < 2000; i++) {
      const r = runBattle(randomBattle(rng).input);
      for (const e of r.events) {
        if (e.type === "damage") expect(Number.isInteger(e.amount) && Number.isInteger(e.hpAfter)).toBe(true);
        if (e.type === "heal") expect(Number.isInteger(e.amount)).toBe(true);
        if (e.type === "attack") expect(e.segments.every(Number.isInteger)).toBe(true);
      }
    }
  });

  it("随机战斗全部能正常结束", () => {
    const rng = new Rng(9);
    for (let i = 0; i < 3000; i++) {
      const r = runBattle(randomBattle(rng).input);
      expect(r.rounds).toBeGreaterThan(0);
      expect(r.rounds).toBeLessThanOrEqual(12);
    }
  });
});
