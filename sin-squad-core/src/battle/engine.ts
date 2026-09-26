import { character } from "../content/characters.js";
import { gear } from "../content/tables.js";
import { other, type BetContext, type Seat, type TeamSetup } from "../types.js";
import {
  armorOf, emptyUnit, health, MAX_BARRIER, snapshot, unitFrom,
  type Unit, type UnitSnapshot,
} from "./unit.js";
import { instantClaims, roundEndClaims, setupVictory, timeoutWinner, type VictoryState } from "./victory.js";

/**
 * 回合制战斗。完全确定：同样的输入永远得到同样的结果。
 *
 * 每轮双方轮流出手（同一方按 1→2→3 号位），奇数轮由 first 先手，偶数轮换另一方。
 * 每次攻击都是一次碰撞：守护改写目标 → 连击分两段 → 被打的人反击 → 屏障挡段、护甲减段
 * → 双方一起扣血 → 吸血 → 移除倒下的人 → 触发“有人倒下”的能力 → 检查能立刻获胜的规则。
 * 轮末再结算场地效果和需要“保持”的规则。
 */

export interface BattleInput {
  teams: [TeamSetup, TeamSetup];
  ruleId: string;
  arenaId: string;
  /** 本手生效的公共效果；没有生效则为 null。 */
  publicEffectId: string | null;
  /** 本手奖池（赌徒酒窖用）。 */
  pot: number;
  /** 第 1 轮先出手的一方（牌桌上是非庄家）；之后每轮轮换。默认 0。 */
  firstSeat?: Seat;
}

/** 回放的一帧：一次出手（或轮初、轮末效果）里发生的事件，以及之后的样子。 */
export interface BattleFrame {
  round: number;
  events: BattleEvent[];
  after: [UnitSnapshot[], UnitSnapshot[]];
}

export type BattleEvent =
  | { round: number; type: "attack"; seat: Seat; pos: number; targetSeat: Seat; targetPos: number; segments: number[] }
  /** 碰撞：被打的人把自己的攻打回攻击者。 */
  | { round: number; type: "recoil"; seat: Seat; pos: number; targetSeat: Seat; targetPos: number; amount: number }
  | { round: number; type: "blocked"; seat: Seat; pos: number }
  | { round: number; type: "damage"; seat: Seat; pos: number; amount: number; hpAfter: number }
  | { round: number; type: "heal"; seat: Seat; pos: number; amount: number }
  | { round: number; type: "switch"; seat: Seat; pos: number; remaining: number }
  | { round: number; type: "death"; seat: Seat; pos: number }
  /** 能力、场地、公共效果在某人身上生效（给画面播放用；round 0 = 开战时）。 */
  | { round: number; type: "trigger"; seat: Seat; pos: number; name: string; text: string }
  | { round: number; type: "note"; text: string };

export interface BattleResult {
  /** null = 平局。 */
  winner: Seat | null;
  reason: "达成规则" | "到时比较" | "平局";
  rounds: number;
  events: BattleEvent[];
  final: [UnitSnapshot[], UnitSnapshot[]];
  /** 开战准备做完、第 1 轮之前的快照，给回放用。 */
  start: [UnitSnapshot[], UnitSnapshot[]];
  /** 每一轮结束后的快照（提前结束的那一轮取结束时）。 */
  timeline: Array<[UnitSnapshot[], UnitSnapshot[]]>;
  /** 逐次出手的回放帧。 */
  frames: BattleFrame[];
  /** 第 1 轮先出手的一方。 */
  first: Seat;
}

export function runBattle(input: BattleInput): BattleResult {
  return new Battle(input).run();
}

class Battle {
  private readonly teams: [Unit[], Unit[]];
  private readonly env: Set<string>;
  private readonly bet: [BetContext, BetContext];
  private readonly events: BattleEvent[] = [];
  private readonly timeline: Array<[UnitSnapshot[], UnitSnapshot[]]> = [];
  private readonly start: [UnitSnapshot[], UnitSnapshot[]];
  private readonly victory: VictoryState;
  private readonly maxRounds: number;
  private round = 0;
  private firstDeathDone: [boolean, boolean] = [false, false];
  private loneTriggered: [boolean, boolean] = [false, false];
  private wingUsed: [boolean, boolean] = [false, false];
  private readonly first: Seat;
  private readonly frames: BattleFrame[] = [];
  private frameMark = 0;
  /** 这一轮不出手的人。 */
  private readonly idle = new Set<Unit>();
  /** 这一轮每人被谁打过（集火回响用）。 */
  private readonly hitThisRound = new Map<Unit, Set<Unit>>();
  /** 夺势者 → 它盯住的敌方攻最高者（开战时定下），那人倒下时夺势者全队攻 +2。 */
  private readonly mightTarget = new Map<Unit, Unit>();
  /** 复仇印：上一次打中它的敌人，和已经叠了几层。 */
  private readonly lastHitBy = new Map<Unit, Unit>();
  private readonly revenge = new Map<Unit, number>();
  /** 缓行者：哪几轮攻 +2（每轮被打中后的下一轮）。存成一组轮数：同一轮里先被打又出手时，不能把这一轮的加成覆盖掉。 */
  private readonly slowBoost = new Map<Unit, Set<number>>();

  constructor(private readonly input: BattleInput) {
    this.env = new Set([input.arenaId, ...(input.publicEffectId ? [input.publicEffectId] : [])]);
    this.first = input.firstSeat ?? 0;
    this.bet = [input.teams[0].bet, input.teams[1].bet];
    this.teams = [this.buildTeam(0), this.buildTeam(1)];
    this.setupBattle();
    this.victory = setupVictory(input.ruleId, this.teams, [this.bet[0].revealedPos, this.bet[1].revealedPos]);
    this.maxRounds = maxRoundsFor(input.ruleId);
    this.start = [this.teams[0].map(snapshot), this.teams[1].map(snapshot)];
  }

  // ───────────────────────── 开战前 ─────────────────────────

  private has(id: string) {
    return this.env.has(id);
  }

  /** 记一条“某人身上有东西生效了”，给画面播放用。 */
  private trig(u: Unit, name: string, text: string) {
    this.events.push({ round: this.round, type: "trigger", seat: u.seat, pos: u.pos, name, text });
  }

  /** 静默书库：第 1 轮所有人物能力失效，开战时能力也不发动。 */
  private abilityOn(u: Unit, name: string): boolean {
    if (!u.def || u.def.name !== name) return false;
    if (this.has("A08") && this.round <= 1) return false;
    return true;
  }

  private buildTeam(seat: Seat): Unit[] {
    const setup = this.input.teams[seat];
    const team = setup.slots.map((s, pos) =>
      s.characterId ? unitFrom(character(s.characterId), seat, pos) : emptyUnit(seat, pos),
    );
    team.forEach((u, i) => {
      const e = setup.slots[i].equipmentId;
      if (u.exists && e) u.equipmentIds.push(e);
      const fx = setup.slots[i].effectId;
      if (u.exists && fx) u.equipmentIds.push(fx);
    });
    if (setup.eat) {
      const eater = team[setup.eat.eater];
      const eaten = team[setup.eat.eaten];
      if (!eater.def || eater.def.name !== "饕餮" || !eaten.exists || eater === eaten) {
        throw new Error("非法的吞噬：只有饕餮能吞掉一名在场队友");
      }
      eater.atk += eaten.def!.atk;
      eater.hp += eaten.def!.hp;
      this.trig(eater, "饕餮", `吞掉${eaten.def!.name}：+${eaten.def!.atk}/+${eaten.def!.hp}`);
      team[setup.eat.eaten] = emptyUnit(seat, setup.eat.eaten);
    }
    return team;
  }

  private setupBattle() {
    const [A, B] = this.teams;
    const all = [...A, ...B].filter((u) => u.exists);
    const startAbilities = !this.has("A08");
    const opp = (u: Unit) => this.teams[other(u.seat)][u.pos];
    if (!startAbilities) this.events.push({ round: 0, type: "note", text: "静默书库：开战时的能力都不发动" });

    // 夺装者：同时拿走对位的装备
    if (startAbilities) {
      const before = new Map(all.map((u) => [u, u.equipmentIds.slice()]));
      for (const u of all) {
        const o = opp(u);
        if (u.def?.name === "夺装者" && o.exists) {
          u.equipmentIds.push(...before.get(o)!);
          o.equipmentIds = o.equipmentIds.filter((id) => !before.get(o)!.includes(id));
          if (before.get(o)!.length) {
            this.trig(u, "夺装者", `夺走「${before.get(o)!.map((id) => gear(id).name).join("、")}」`);
            this.trig(o, "夺装者", "装备被夺走");
          }
        }
      }
    }
    for (const u of all) for (const id of u.equipmentIds) this.applyEquipment(u, id);

    // 下注层能力
    if (startAbilities) {
      for (const seat of [0, 1] as Seat[]) {
        const me = this.bet[seat];
        const foe = this.bet[other(seat)];
        for (const u of this.teams[seat].filter((x) => x.exists)) {
          const name = u.def!.name;
          switch (name) {
            case "挑衅者": {
              const n = foe.betOrRaiseCount;
              if (n) { u.atk += 2 * n; this.trig(u, name, `对手加注 ${n} 次：攻 +${2 * n}`); }
              break;
            }
            case "金主": {
              const k = Math.min(4, Math.floor(me.invested / 10));
              if (k) { u.atk += k; u.hp += k; this.trig(u, name, `投入 ${me.invested}：+${k}/+${k}`); }
              break;
            }
            case "盾税官": {
              const n = Math.min(2, me.opsPaid);
              if (n) { this.addBarrier(u, n, false); this.trig(u, name, `付过 ${me.opsPaid} 次操作费：屏障 +${n}`); }
              break;
            }
            case "瞌睡客":
              if (me.checkCount) { u.hp += 4 * me.checkCount; this.trig(u, name, `过牌 ${me.checkCount} 次：血 +${4 * me.checkCount}`); }
              break;
            case "沉眠巨像":
              if (me.checkCount) { u.atk += 2 * me.checkCount; this.trig(u, name, `过牌 ${me.checkCount} 次：攻 +${2 * me.checkCount}`); }
              break;
            case "炫耀者":
              if (me.revealedPos === u.pos) { u.atk += 3; u.hp += 4; this.trig(u, name, "被亮出：+3/+4"); }
              break;
            case "利滚利":
              if (me.opsPaid) { u.atk += me.opsPaid; this.trig(u, name, `付过 ${me.opsPaid} 次操作费：攻 +${me.opsPaid}`); }
              break;
            case "金库守卫":
              if ((me.stack ?? 0) > (foe.stack ?? 0)) { this.addBarrier(u, 1, false); this.trig(u, name, "筹码领先：屏障 +1"); }
              break;
            case "赌徒":
              if (me.betOrRaiseCount) { u.atk += 2; this.trig(u, name, "本手下注或加注过：攻 +2"); }
              break;
            case "宝库主":
              if (me.invested > 30) { u.atk += 3; this.trig(u, name, `投入 ${me.invested}：攻 +3`); }
              break;
            case "躺赢者":
              if (!me.betOrRaiseCount) { u.atk += 2; u.hp += 3; this.trig(u, name, "本手没下注：+2/+3"); }
              break;
            case "偷心者": {
              const o = opp(u);
              if (o.exists && o.equipmentIds.length) { u.atk += 2; this.trig(u, name, "对位带着装备：攻 +2"); }
              break;
            }
          }
        }
        // 全队加成
        const mine = this.teams[seat].filter((x) => x.exists);
        for (const u of mine) {
          const name = u.def!.name;
          if (name === "战吼者") {
            for (const x of mine) x.atk += 1;
            this.trig(u, name, "开场战吼：全队攻 +1");
          }
          if (name === "首席" && me.revealedPos === u.pos) {
            for (const x of mine) x.atk += 1;
            this.trig(u, name, "被亮出：全队攻 +1");
          }
          if (name === "双生誓" && u.pos === 1 && this.teams[seat][0].exists && this.teams[seat][2].exists) {
            for (const x of mine) x.hp += 2;
            this.trig(u, name, "两侧都有队友：全队血 +2");
          }
        }
        const healer = this.teams[seat].find((u) => u.exists && u.def!.name === "静息药师");
        if (me.opsPaid === 0 && healer) {
          for (const u of this.teams[seat]) if (u.exists) u.hp += 5;
          this.trig(healer, "静息药师", "没付操作费：全队血 +5");
        }
      }
      // 摹拳客：看的是对位此刻的攻和形状
      const copy = all.filter((u) => u.def!.name === "摹拳客" && opp(u).exists).map((u) => [u, opp(u).atk, opp(u).shape] as const);
      for (const [u, atk, shape] of copy) {
        u.atk = Math.max(u.atk, atk);
        u.shape = shape;
        this.trig(u, "摹拳客", `复制对位：攻 ${u.atk}，${shape === "heavy" ? "重击" : "连击"}`);
      }
    }

    // 场地的开战效果
    for (const team of this.teams) {
      const here = team.filter((u) => u.exists);
      if (here.length === 0) continue;
      if (this.has("A19")) { const lo = minBy(here, (u) => u.hp); lo.atk += 2; lo.hp += 3; this.trig(lo, "陋巷", "血最低：+2/+3"); }
      if (this.has("A20")) { const hi = maxBy(here, (u) => u.atk); hi.atk = Math.max(0, hi.atk - 3); this.trig(hi, "高塔倾覆", "攻最高：攻 -3"); }
      if (this.has("A13")) {
        const b = Math.floor(this.input.pot / 40);
        if (b) for (const u of here) { u.atk += b; this.trig(u, "赌徒酒窖", `攻 +${b}`); }
      }
      if (this.has("A22")) {
        const avg = Math.floor(here.reduce((s, u) => s + u.hp, 0) / here.length);
        for (const u of here) { u.hp = avg; this.trig(u, "均摊之厅", `血改为 ${avg}`); }
      }
      if (this.has("A14")) for (const u of here) { this.addBarrier(u, 1, false); this.trig(u, "石柱庭院", "屏障 +1"); }
      if (this.has("A16")) { const hi = maxBy(here, (u) => u.atk); this.addBarrier(hi, 1, false); this.trig(hi, "镜面冷库", "攻最高：屏障 +1"); }
      if (this.has("P02")) for (const u of here) { u.armorBase += 2; this.trig(u, "铁幕", "护甲 +2"); }
    }
    for (const u of all) { u.startHp = u.hp; u.maxHp = u.hp; }
    // 开场审判是开战后的伤害，不改变开战血量
    if (this.has("P29")) {
      for (const team of this.teams) {
        const here = team.filter((u) => u.exists);
        if (here.length) {
          const u = maxBy(here, (x) => armorOf(x));
          u.hp -= 3;
          this.trig(u, "开场审判", "护甲最高：受到 3 伤害");
        }
      }
    }

    // 缔结、魅惑、沉眠、复写、镜像（复写和镜像看的是开战这一刻对位的样子，互相复写也不连锁）
    const atkAt = new Map(all.map((u) => [u, u.atk]));
    const armorAt = new Map(all.map((u) => [u, armorOf(u)]));
    const barrierAt = new Map(all.map((u) => [u, u.barrier]));
    for (const u of all) {
      const o = opp(u);
      if (u.def!.name === "沉眠巨像") u.skipRounds = 1;
      if (!startAbilities || !o.exists) continue;
      if (u.def!.name === "牵线人") {
        u.bonded = true;
        o.bonded = true;
        this.trig(u, "牵线人", "与对位缔结：双方本场都不出手");
        this.trig(o, "牵线人", "被缔结：本场不出手");
      }
      if (u.def!.name === "魅惑者") { o.charmed = true; this.trig(o, "魅惑者", "被魅惑：第一轮打自己人"); }
      if (u.def!.name === "复写匠") {
        const arm = armorAt.get(o)!;
        const bar = barrierAt.get(o)!;
        if (arm > 0 && arm >= bar) { u.armorBase += arm; this.trig(u, "复写匠", `复写对位的护甲 ${arm}`); }
        else if (bar > 0) { this.addBarrier(u, bar, false); this.trig(u, "复写匠", `复写对位的屏障 ${bar}`); }
      }
      if (u.def!.name === "镜狱") {
        const k = Math.min(3, atkAt.get(o)!);
        if (k > 0) { u.atk += k; this.trig(u, "镜狱", `对位攻 ${atkAt.get(o)}：攻 +${k}`); }
      }
    }

    // 夺势者：记下敌方开战时攻最高的那一个
    for (const u of all) {
      if (u.def!.name !== "夺势者") continue;
      const foes = this.teams[other(u.seat)].filter((x) => x.exists);
      if (foes.length) this.mightTarget.set(u, maxBy(foes, (x) => x.atk));
    }

    // 屏障回声：开战就带屏障的人也算“第一次获得”
    if (this.has("P08")) for (const u of all) if (u.barrier > 0) this.echoBarrier(u);
  }

  private applyEquipment(u: Unit, id: string) {
    const definition = gear(id).effect;
    const e = definition;
    switch (e.kind) {
      case "stat": u.atk += e.atk; u.hp += e.hp; u.eqAtk += e.atk; u.eqHp += e.hp; break;
      case "shape": u.shape = e.shape; u.atk += e.atk; u.eqAtk += e.atk; break;
      case "armor": u.armorEquip += e.armor; u.hp += e.hp; u.eqHp += e.hp; break;
      case "barrier": u.barrier = Math.min(MAX_BARRIER, u.barrier + e.barrier); u.atk += e.atk; u.eqAtk += e.atk; break;
    }
  }

  private addBarrier(u: Unit, n: number, echo = true) {
    if (n <= 0 || !u.alive) return;
    u.barrier = Math.min(MAX_BARRIER, u.barrier + n);
    if (echo && this.has("P08")) this.echoBarrier(u);
  }

  /** 屏障回声：第一次获得屏障时，队友各得一层；由回声得到的不再连锁。 */
  private echoBarrier(u: Unit) {
    if (u.barrierEchoed) return;
    u.barrierEchoed = true;
    for (const t of this.teams[u.seat]) {
      if (t !== u && t.alive) {
        t.barrierEchoed = true;
        t.barrier = Math.min(MAX_BARRIER, t.barrier + 1);
        this.trig(t, "屏障回声", "屏障 +1");
      }
    }
  }

  // ───────────────────────── 战斗 ─────────────────────────

  run(): BattleResult {
    this.pushFrame(); // 开战时的效果
    for (this.round = 1; this.round <= this.maxRounds; this.round++) {
      const decided = this.playRound();
      if (decided) return decided;
      const claims = roundEndClaims(this.victory, this.teams, this.round);
      const done = this.decide(claims);
      if (done) return done;
      this.timeline.push([this.teams[0].map(snapshot), this.teams[1].map(snapshot)]);
    }
    this.round = this.maxRounds;
    const w = timeoutWinner(this.victory, this.teams);
    return this.finish(w, w === null ? "平局" : "到时比较");
  }

  /** 有人达成胜利条件就结束；双方同时达成（例如同归于尽）算平局。 */
  private decide(claims: [boolean, boolean]): BattleResult | null {
    if (!claims[0] && !claims[1]) return null;
    if (claims[0] && claims[1]) return this.finish(null, "平局");
    return this.finish(claims[0] ? 0 : 1, "达成规则");
  }

  private finish(winner: Seat | null, reason: BattleResult["reason"]): BattleResult {
    this.pushFrame();
    if (this.timeline.length < this.round) this.timeline.push([this.teams[0].map(snapshot), this.teams[1].map(snapshot)]);
    return {
      winner, reason, rounds: this.round, events: this.events, start: this.start, timeline: this.timeline,
      frames: this.frames, first: this.first,
      final: [this.teams[0].map(snapshot), this.teams[1].map(snapshot)],
    };
  }

  /** 把上一帧之后新发生的事件记成一帧，并附上此刻的快照。 */
  private pushFrame() {
    if (this.frameMark >= this.events.length) return;
    this.frames.push({
      round: this.round,
      events: this.events.slice(this.frameMark),
      after: [this.teams[0].map(snapshot), this.teams[1].map(snapshot)],
    });
    this.frameMark = this.events.length;
  }

  private alive(seat: Seat) {
    return this.teams[seat].filter((u) => u.alive);
  }

  /**
   * 进行一轮：双方轮流出手，同一方按 1→2→3 号位的顺序，每人一次。
   * 奇数轮由 first 先手，偶数轮换另一方先手。每次攻击后立刻结算，并检查能立刻获胜的规则。
   */
  private playRound(): BattleResult | null {
    const r = this.round;

    // 轮初效果
    if (this.has("P06") && (r === 2 || r === 4 || r === 6)) {
      for (const seat of [0, 1] as Seat[]) {
        const al = this.alive(seat);
        if (al.length) { const u = minBy(al, health); this.addBarrier(u, 1); this.trig(u, "庇护潮", "屏障 +1"); }
      }
    }
    if (this.has("P30") && r === 2) {
      for (const u of [...this.alive(0), ...this.alive(1)]) {
        if (u.lostTotal === 0) { this.addBarrier(u, 1); this.trig(u, "迟到的庇护", "屏障 +1"); }
      }
    }

    // 休眠守卫：满血时补一层屏障
    for (const u of this.livingAll()) {
      if (this.abilityOn(u, "休眠守卫") && u.hp >= u.maxHp && u.barrier === 0) { this.addBarrier(u, 1); this.trig(u, "休眠守卫", "满血：屏障 +1"); }
    }

    // 这一轮不出手的人（也不反击）
    this.idle.clear();
    this.hitThisRound.clear();
    for (const seat of [0, 1] as Seat[]) {
      const actors = this.alive(seat);
      const lowest = actors.length ? minBy(actors, (u) => u.hp) : null;
      for (const u of actors) {
        if (u.bonded) this.idle.add(u);
        else if (r <= u.skipRounds) { this.idle.add(u); this.trig(u, "沉眠巨像", "沉睡中，不出手"); }
        else if (this.has("A06") && r === 1) this.idle.add(u);
        else if (this.has("A21") && r === 1 && u !== lowest) this.idle.add(u);
        else if (u.skipNext) { u.skipNext = false; this.idle.add(u); this.trig(u, "沉重后坐", "这一轮不出手"); }
      }
    }
    this.pushFrame();

    const queue: [Unit[], Unit[]] = [this.alive(0), this.alive(1)];
    let side: Seat = r % 2 === 1 ? this.first : other(this.first);
    while (queue[0].length || queue[1].length) {
      if (!queue[side].length) side = other(side);
      const u = queue[side].shift()!;
      side = other(side);
      if (!u.alive || this.idle.has(u)) continue;
      this.takeTurn(u);
      this.pushFrame();
      const done = this.decide(instantClaims(this.victory, this.teams));
      if (done) return done;
    }

    // 轮末效果
    if (this.has("A11") && (r === 2 || r === 4 || r === 6)) for (const u of this.livingAll()) this.loseHp(u, 2);
    if (this.has("A15") && (r === 2 || r === 4)) for (const u of this.livingAll()) u.armorBase = Math.max(0, u.armorBase - 1);
    if (this.has("P24")) for (const u of this.livingAll()) if (u.regenRounds > 0 && u.hp > 0) { u.regenRounds--; this.heal(u, 2); }
    this.resolveDeaths(new Map());
    this.pushFrame();
    return null;
  }

  /** 对位已倒下、这一轮还要花时间转线的人。 */
  private switching(u: Unit): boolean {
    if (this.teams[other(u.seat)][u.pos].alive) return false;
    if (u.charmed && this.round === 1) return false;
    return (u.switchRemaining ?? this.switchCost(u.pos)) > 0;
  }

  /** 被打时会不会把攻打回去：这一轮不出手、正在转线的人不反击。 */
  private retaliates(t: Unit): boolean {
    return t.alive && t.atk > 0 && !this.idle.has(t) && !this.switching(t);
  }

  /** 一个人的回合：选目标（或花时间转线），然后攻击。 */
  private takeTurn(u: Unit) {
    const r = this.round;
    const seat = u.seat;
    let target: Unit | null = null;
    let opposite = false;
    const o = this.teams[other(seat)][u.pos];
    if (u.charmed && r === 1) {
      const adj = this.teams[seat].filter((x) => x.alive && Math.abs(x.pos - u.pos) === 1);
      if (adj.length) { target = minBy(adj, (x) => x.hp); this.trig(u, "魅惑者", "被魅惑：攻击队友"); }
    }
    if (!target) {
      if (o.alive) {
        target = o;
        opposite = true;
      } else {
        if (u.switchRemaining === null) u.switchRemaining = this.switchCost(u.pos);
        if (u.switchRemaining > 0) {
          u.switchRemaining--;
          u.switched = true;
          this.events.push({ round: r, type: "switch", seat, pos: u.pos, remaining: u.switchRemaining });
          return;
        }
        u.switched = true;
        const foes = this.alive(other(seat));
        if (!foes.length) return;
        // 诱导者嘲讽：转线过来的敌人先打它，否则打血最少的
        const taunt = foes.find((x) => this.abilityOn(x, "诱导者"));
        if (taunt) this.trig(taunt, "诱导者", "嘲讽：转线的敌人改打它");
        target = taunt ?? minBy(foes, (x) => x.hp);
      }
    }
    const times = this.has("P13") && r === 3 && u.attacks < 2 ? 2 : 1;
    for (let k = 0; k < times; k++) {
      if (!u.alive || !target.alive) break;
      this.strike(u, target, opposite);
    }
  }

  /** 一次攻击 = 一次碰撞：攻击者打出自己的攻，同时吃下被打那一方的攻。 */
  private strike(a: Unit, target: Unit, opposite: boolean) {
    const r = this.round;
    let t = target;

    // 守护改写目标
    if (t.seat !== a.seat) {
      const guard = this.teams[t.seat].find(
        (g) => g.alive && g !== t && Math.abs(g.pos - t.pos) === 1 && this.abilityOn(g, "同行药袋"),
      );
      if (guard) {
        this.trig(guard, "同行药袋", `守护：替${t.def!.name}挡下`);
        t = guard;
        opposite = false;
      }
    }

    // 集火回响：同一轮被第二个人攻击时，先得一层屏障
    if (t.seat !== a.seat) {
      const by = this.hitThisRound.get(t) ?? this.hitThisRound.set(t, new Set()).get(t)!;
      by.add(a);
      if (this.has("P14") && by.size >= 2 && !t.focusEchoUsed) {
        t.focusEchoUsed = true;
        this.addBarrier(t, 1);
        this.trig(t, "集火回响", "屏障 +1");
      }
    }

    // 算出伤害并拆段
    /** 一次攻击：护甲按段减到 0 为止，但整次攻击只要有一段打中，至少扣 1。 */
    interface Hit { a: Unit; t: Unit; sum: number; landed: boolean; minOne: boolean; segs: number }
    /** 一段伤害：a 是伤害来源，t 是承受者；recoil = 碰撞反伤。 */
    interface Seg { a: Unit; t: Unit; amount: number; hit: Hit; recoil: boolean }
    const segs: Seg[] = [];
    const hitList: Hit[] = [];
    const no = ++a.attacks;
    let d = a.atk + a.pendingBonus;
    a.pendingBonus = 0;
    if (a.huntTarget === t) { d += 2; a.huntTarget = null; }
    if (this.has("P10") && r === 1) d += 2;
    if (this.has("P16") && opposite) d += 1;
    if (this.has("A05") && opposite) d += 1;
    if (this.has("P18") && r >= 4) d += 1;
    if (this.has("A01") && a.switched && !opposite) d = Math.max(1, d - 2);
    if (this.has("P23") && health(a) < 0.3) d += Math.max(1, Math.floor(d * 0.25));
    // 人物能力的攻击加值（先加，再按下面的翻倍类效果乘）
    const foe = t.seat !== a.seat;
    const bonus = (name: string, n: number, text: string) => { d += n; this.trig(a, name, text); };
    const facing = this.teams[other(a.seat)][a.pos];
    if (foe && this.abilityOn(a, "断头台") && health(t) < 0.3) bonus("断头台", 3, "处决：攻 +3");
    if (foe && this.abilityOn(a, "饥饿猎犬") && t.hp < a.hp) bonus("饥饿猎犬", 2, "追食：攻 +2");
    if (this.abilityOn(a, "终餐者") && this.alive(other(a.seat)).length === 1) bonus("终餐者", 4, "终餐：攻 +4");
    if (foe && this.abilityOn(a, "窥伺刀") && this.bet[t.seat].revealedPos === t.pos) bonus("窥伺刀", 2, "看穿亮牌：攻 +2");
    if (this.abilityOn(a, "缓行者") && this.slowBoost.get(a)?.has(r)) bonus("缓行者", 2, "蓄力：攻 +2");
    if (this.abilityOn(a, "终止符") && r >= 3) bonus("终止符", 3, "晚钟：攻 +3");
    if (this.abilityOn(a, "优越者") && facing.alive && facing.atk < a.atk) bonus("优越者", 2, "压制：攻 +2");
    if (this.abilityOn(a, "终局王") && this.alive(a.seat).length > this.alive(other(a.seat)).length) bonus("终局王", 2, "王座：攻 +2");
    if (this.abilityOn(a, "共鸣者") && this.teams[a.seat].some((x) => x.alive && Math.abs(x.pos - a.pos) === 1 && x.atk > a.atk)) {
      bonus("共鸣者", 2, "共鸣：攻 +2");
    }
    if (this.abilityOn(a, "无瑕刺客") && a.hp >= a.maxHp) { d *= 2; this.trig(a, "无瑕刺客", "满血：攻击翻倍"); }
    if (this.abilityOn(a, "清算者") && r === 1 && this.bet[other(a.seat)].betOrRaiseCount > 0) { d *= 2; this.trig(a, "清算者", "对手加过注：首轮翻倍"); }
    if (this.has("P11") && (no === 3 || no === 6)) d *= 2;
    if (this.has("P26") && a.pos === 1) d = Math.round(d * 1.25);
    const parts = a.shape === "multi" ? splitMulti(d) : [d];
    this.events.push({ round: r, type: "attack", seat: a.seat, pos: a.pos, targetSeat: t.seat, targetPos: t.pos, segments: parts });
    const hit: Hit = { a, t, sum: 0, landed: false, minOne: true, segs: 0 };
    hitList.push(hit);
    for (const p of parts) segs.push({ a, t, amount: p, hit, recoil: false });
    if (this.has("P09") && r >= 2) {
      // 深夜霜降：独立的一段 1 点伤害，护甲可以挡掉
      const frost: Hit = { a, t, sum: 0, landed: false, minOne: false, segs: 0 };
      hitList.push(frost);
      segs.push({ a, t, amount: 1, hit: frost, recoil: false });
    }
    // 碰撞：被打的人把自己的攻整段打回来（这一轮不出手、正在转线的人除外）
    if (this.retaliates(t)) {
      this.events.push({ round: r, type: "recoil", seat: t.seat, pos: t.pos, targetSeat: a.seat, targetPos: a.pos, amount: t.atk });
      const back: Hit = { a: t, t: a, sum: 0, landed: false, minOne: true, segs: 0 };
      hitList.push(back);
      segs.push({ a: t, t: a, amount: t.atk, hit: back, recoil: true });
    }

    // 结算每一段（先记账，再一起扣血）
    const dmg = new Map<Unit, number>();
    const hits = new Map<Unit, number>();
    const hitters = new Map<Unit, Set<Unit>>();
    const armorBreaks = new Map<Unit, number>();
    const add = <K>(m: Map<K, number>, k: K, v: number) => m.set(k, (m.get(k) ?? 0) + v);

    for (const s of segs) {
      const { a: src, t: dst } = s;
      if (dst.barrier > 0) {
        dst.barrier--;
        this.events.push({ round: r, type: "blocked", seat: dst.seat, pos: dst.pos });
        this.onBarrierBroken(dst, src, dmg);
        continue;
      }
      let armor = armorOf(dst);
      if (this.abilityOn(dst, "镀金者") && dst.hp >= dst.maxHp) armor += 1; // 满血时护甲 +1
      if (this.has("P04") && health(dst) > 0.75) armor = Math.floor(armor / 2);
      let real = Math.max(0, s.amount - armor);
      s.hit.landed = true;
      // 酸液兽：打中带护甲的人，腐蚀掉它 1 点护甲（每人只被腐蚀一次；这一段还按原来的护甲算）
      if (src.seat !== dst.seat && armorOf(dst) > 0 && !dst.flags.has("酸蚀") && this.abilityOn(src, "酸液兽")) {
        dst.flags.add("酸蚀");
        if (dst.armorBase > 0) dst.armorBase--;
        else dst.armorEquip--;
        this.trig(src, "酸液兽", `腐蚀：${dst.def!.name}护甲 -1`);
      }
      // 所有伤害都是整数：减半向下取整，+25% 四舍五入
      if (this.has("A07") && dst.attacks === 0) real = Math.floor(real / 2);
      if (this.has("A09") && r <= 2) real = Math.min(real, Math.max(1, Math.floor(dst.startHp / 4)));
      if (this.has("P26") && dst.pos === 1) real = Math.round(real * 1.25);
      if (this.has("P27") && dst.pos !== 1 && src.pos === 1 && src.seat !== dst.seat && !dst.sideCoverUsed) { dst.sideCoverUsed = true; real = Math.floor(real / 2); }
      // 慢钟：第一轮每段伤害 -2，最少 1
      if (r === 1 && real > 0 && this.abilityOn(dst, "慢钟")) {
        real = Math.max(1, real - 2);
        if (!dst.flags.has("拖延")) { dst.flags.add("拖延"); this.trig(dst, "慢钟", "拖延：第一轮受到的伤害 -2"); }
      }
      s.hit.sum += real;
      if (real <= 0) continue;
      s.hit.segs++;
      add(dmg, dst, real);
      add(hits, dst, 1);
      (hitters.get(dst) ?? hitters.set(dst, new Set()).get(dst)!).add(src);
      if (this.has("P03") && real >= 6) add(armorBreaks, dst, 1);
      if (this.has("P12") && real >= 8 && !s.recoil) src.skipNext = true;
      if (this.has("A10")) {
        for (const x of this.teams[dst.seat]) if (x.alive && Math.abs(x.pos - dst.pos) === 1) add(dmg, x, 1);
      }
    }

    // 每次攻击（和每次反击）至少扣 1；被屏障整段挡掉的不算打中
    for (const h of hitList) {
      if (!h.landed || !h.minOne || h.sum >= 1) continue;
      const top = 1 - h.sum;
      if (h.sum === 0) {
        h.segs = 1;
        add(hits, h.t, 1);
        (hitters.get(h.t) ?? hitters.set(h.t, new Set()).get(h.t)!).add(h.a);
      }
      add(dmg, h.t, top);
    }

    // 碰撞双方同时扣血
    for (const [u, v] of dmg) this.loseHp(u, v);

    // 吸血：自己主动攻击每打中一段回 1（反击不算）
    const bites = hit.segs;
    if (bites > 0 && a.hp > 0 && this.abilityOn(a, "嚼盾兽")) {
      let heal = bites;
      if (this.has("P19")) heal -= 1;
      if (this.has("P18") && r >= 4) heal -= 1;
      if (heal > 0) {
        if (a.hp < a.maxHp) this.trig(a, "嚼盾兽", `吸血 +${heal}`);
        this.heal(a, heal);
      }
    }
    // 蓄痛、裂甲
    for (const [u, n] of hits) {
      if (u.hp > 0 && this.abilityOn(u, "蓄痛拳手")) { u.atk += n; this.trig(u, "蓄痛拳手", `攻 +${n}`); }
    }
    for (const [u, n] of armorBreaks) u.armorBase = Math.max(0, u.armorBase - n);
    for (const [u, set] of hitters) {
      if (u.hp <= 0) continue;
      // 缓行者：每轮第一次被打中，下一轮攻 +2
      if (this.abilityOn(u, "缓行者")) {
        const rounds = this.slowBoost.get(u) ?? this.slowBoost.set(u, new Set()).get(u)!;
        if (!rounds.has(r + 1)) { rounds.add(r + 1); this.trig(u, "缓行者", "下一轮攻 +2"); }
      }
      // 复仇印：被同一个敌人连续打中，攻 +1（最多 +3）
      if (this.abilityOn(u, "复仇印")) {
        for (const src of set) {
          if (src.seat === u.seat) continue;
          const n = this.revenge.get(u) ?? 0;
          if (this.lastHitBy.get(u) === src && n < 3) {
            u.atk += 1;
            this.revenge.set(u, n + 1);
            this.trig(u, "复仇印", `记仇：攻 +1（${n + 1}/3）`);
          }
          this.lastHitBy.set(u, src);
        }
      }
    }
    // 护心人：相邻队友被敌人攻击时，自己得 1 层屏障
    if (t.seat !== a.seat) {
      for (const g of this.teams[t.seat]) {
        if (g !== t && g.alive && g.hp > 0 && Math.abs(g.pos - t.pos) === 1 && g.barrier < MAX_BARRIER && this.abilityOn(g, "护心人")) {
          this.addBarrier(g, 1);
          this.trig(g, "护心人", `${t.def!.name}被攻击：屏障 +1`);
        }
      }
    }

    // 攻击带来的自损
    if (this.has("A12") && no % 3 === 0) this.loseHp(a, 3);
    if (this.has("P22") && (no === 2 || no === 4 || no === 6)) { this.loseHp(a, 2); a.pendingBonus += 3; }

    // 移除倒下的人，并处理“有人倒下”
    this.resolveDeaths(hitters);
  }

  private switchCost(pos: number): number {
    if (this.has("A02")) return 0;
    if (this.has("A03")) return 2;
    if (this.has("A04")) return pos === 0 ? 2 : pos === 2 ? 0 : 1;
    return 1;
  }

  private livingAll() {
    return [...this.teams[0], ...this.teams[1]].filter((u) => u.alive && u.hp > 0);
  }

  private loseHp(u: Unit, v: number) {
    if (v <= 0 || !u.alive) return;
    u.hp = u.hp - v;
    u.lostTotal += v;
    this.events.push({ round: this.round, type: "damage", seat: u.seat, pos: u.pos, amount: v, hpAfter: u.hp });
    if (this.has("P21") && u.hp > 0) {
      u.bloodSpringAcc += v;
      while (u.bloodSpringAcc >= 5) { u.bloodSpringAcc -= 5; this.heal(u, 2); }
    }
  }

  private heal(u: Unit, v: number) {
    if (v <= 0 || u.hp <= 0) return;
    const room = u.maxHp - u.hp;
    const real = Math.min(room, v);
    if (real > 0) {
      // 胃囊巨人：受到治疗时额外回复 1（也不超过上限）
      const extra = this.abilityOn(u, "胃囊巨人") ? Math.min(1, room - real) : 0;
      u.hp = u.hp + real + extra;
      this.events.push({ round: this.round, type: "heal", seat: u.seat, pos: u.pos, amount: real + extra });
      if (extra) this.trig(u, "胃囊巨人", "储能：额外回复 1");
    }
    if (this.has("P20") && v - real > 0 && u.barrier < 1) this.addBarrier(u, 1);
    if (this.has("P25") && real > 0) {
      u.healAcc += real;
      while (u.healAcc >= 4) {
        u.healAcc -= 4;
        const o = this.teams[other(u.seat)][u.pos];
        if (o.alive) this.loseHp(o, 2);
      }
    }
  }

  private onBarrierBroken(t: Unit, attacker: Unit, dmg: Map<Unit, number>) {
    // 破阵者：第一次打破敌人的屏障，攻 +2
    if (attacker.seat !== t.seat && !attacker.flags.has("破阵") && this.abilityOn(attacker, "破阵者")) {
      attacker.flags.add("破阵");
      attacker.atk += 2;
      this.trig(attacker, "破阵者", "破盾：攻 +2");
    }
    if (this.has("P01")) t.pendingBonus += 3;
    if (this.has("P05")) dmg.set(t, (dmg.get(t) ?? 0) + 1);
    if (this.has("P07") && attacker.seat !== t.seat) dmg.set(t, (dmg.get(t) ?? 0) + 2);
    if (this.has("P28") && t.pos !== 1 && !this.wingUsed[t.seat]) {
      const otherWing = this.teams[t.seat][t.pos === 0 ? 2 : 0];
      if (otherWing.alive && t.alive) { this.wingUsed[t.seat] = true; this.addBarrier(otherWing, 1); }
    }
  }

  private resolveDeaths(hitters: Map<Unit, Set<Unit>>) {
    const r = this.round;
    let newlyDead = [...this.teams[0], ...this.teams[1]].filter((u) => u.alive && u.hp <= 0);
    for (const u of newlyDead) { u.alive = false; u.deathRound = r; }

    // 碎裂终章：只触发一次，不连锁
    if (this.has("P31") && r >= 3) {
      for (const u of newlyDead) {
        const o = this.teams[other(u.seat)][u.pos];
        if (o.alive) this.loseHp(o, 3);
      }
      const extra = [...this.teams[0], ...this.teams[1]].filter((u) => u.alive && u.hp <= 0);
      for (const u of extra) { u.alive = false; u.deathRound = r; }
      newlyDead = [...newlyDead, ...extra];
    }
    for (const u of newlyDead) this.events.push({ round: r, type: "death", seat: u.seat, pos: u.pos });

    if (newlyDead.length) {
      for (const u of this.livingAll()) {
        if (this.abilityOn(u, "残羹客")) {
          const n = newlyDead.length;
          u.atk += n; u.hp += 3 * n; u.maxHp += 3 * n;
          this.trig(u, "残羹客", `+${n}/+${3 * n}`);
        }
      }
      for (const v of newlyDead) {
        for (const k of hitters.get(v) ?? []) {
          if (k.alive && k.seat !== v.seat && this.abilityOn(k, "收藏家")) {
            k.atk += 2 + v.eqAtk; k.hp += v.eqHp; k.maxHp += v.eqHp;
            this.trig(k, "收藏家", `击倒${v.def!.name}：攻 +${2 + v.eqAtk}${v.eqHp ? `，血 +${v.eqHp}` : ""}`);
          }
        }
      }
      for (const v of newlyDead) {
        for (const k of hitters.get(v) ?? []) {
          if (!k.alive || k.seat === v.seat) continue;
          if (this.abilityOn(k, "掠夺商")) { this.addBarrier(k, 1); this.trig(k, "掠夺商", `击倒${v.def!.name}：屏障 +1`); }
          if (this.abilityOn(k, "吞光者")) { this.trig(k, "吞光者", `击倒${v.def!.name}：回复 2`); this.heal(k, 2); }
        }
        // 缠绵者：对位的敌人被击倒，相邻队友各回复 2
        const lover = this.teams[other(v.seat)][v.pos];
        if (lover.alive && this.abilityOn(lover, "缠绵者")) {
          const near = this.teams[lover.seat].filter((x) => x.alive && Math.abs(x.pos - lover.pos) === 1);
          if (near.length) this.trig(lover, "缠绵者", "余温：相邻队友回复 2");
          for (const x of near) this.heal(x, 2);
        }
      }
      // 夺势者：敌方开战时攻最高的那人倒下，全队攻 +2
      for (const [u, target] of [...this.mightTarget]) {
        if (!u.alive || !newlyDead.includes(target) || !this.abilityOn(u, "夺势者")) continue;
        this.mightTarget.delete(u);
        for (const x of this.alive(u.seat)) x.atk += 2;
        this.trig(u, "夺势者", `${target.def!.name}倒下：全队攻 +2`);
      }
      for (const seat of [0, 1] as Seat[]) {
        if (this.firstDeathDone[seat] || !newlyDead.some((u) => u.seat === seat)) continue;
        this.firstDeathDone[seat] = true;
        for (const u of this.alive(seat)) {
          if (this.has("A18")) { this.addBarrier(u, 1); this.trig(u, "余光站台", "队友倒下：屏障 +1"); }
          if (this.has("P15")) { u.pendingBonus += 2; this.trig(u, "重整", "下一次攻击 +2"); }
        }
      }
    }
    if (this.has("P24")) {
      for (const seat of [0, 1] as Seat[]) {
        const al = this.alive(seat);
        if (al.length === 1 && !this.loneTriggered[seat]) {
          this.loneTriggered[seat] = true;
          this.addBarrier(al[0], 1);
          al[0].regenRounds = 2;
          this.trig(al[0], "孤身余粮", "屏障 +1，接下来 2 轮回血");
        }
      }
    }
    // 第一次低于一半生命：怒潮攻 +2，不屈冠军屏障 +1
    for (const u of this.livingAll()) {
      if (health(u) >= 0.5) continue;
      if (!u.flags.has("怒潮") && this.abilityOn(u, "怒潮")) { u.flags.add("怒潮"); u.atk += 2; this.trig(u, "怒潮", "濒死增压：攻 +2"); }
      if (!u.flags.has("不屈") && this.abilityOn(u, "不屈冠军")) { u.flags.add("不屈"); this.addBarrier(u, 1); this.trig(u, "不屈冠军", "不屈：屏障 +1"); }
    }
    if (this.has("A17")) {
      for (const u of this.livingAll()) {
        if (!u.halfHealthTriggered && health(u) <= 0.5) { u.halfHealthTriggered = true; this.addBarrier(u, 1); this.trig(u, "渗血祭台", "屏障 +1"); }
      }
    }
    if (this.has("P17")) {
      for (const [t, set] of hitters) {
        if (!t.alive || health(t) > 0.25) continue;
        for (const a of set) if (!a.huntUsed && a.seat !== t.seat) { a.huntUsed = true; a.huntTarget = t; }
      }
    }
  }
}

/** 连击：伤害拆成两段整数，奇数时后一段多 1（屏障先挡掉小的那段）；0 的那段不算。 */
export function splitMulti(d: number): number[] {
  const first = Math.floor(d / 2);
  return first > 0 ? [first, d - first] : [d];
}

function minBy<T>(items: T[], f: (x: T) => number): T {
  let best = items[0];
  for (const x of items) if (f(x) < f(best)) best = x;
  return best;
}

function maxBy<T>(items: T[], f: (x: T) => number): T {
  let best = items[0];
  for (const x of items) if (f(x) > f(best)) best = x;
  return best;
}

export function maxRoundsFor(ruleId: string): number {
  switch (ruleId) {
    case "V19": return 3;
    case "V20": return 12;
    case "V21": case "V22": case "V23": case "V24": return 3;
    case "V25": case "V26": case "V27": return 4;
    default: return 8;
  }
}
