import { other, type Seat } from "../types.js";
import { health, type Unit } from "./unit.js";

/**
 * 胜利规则判定。
 *
 * “保持 N 轮”的含义：条件成立的那一轮算起，再保持 N 轮，
 * 也就是需要连续 N+1 个轮末都成立。
 * 所以“保持 1 轮”= 连续 2 个轮末；“轮末时成立即胜”= 1 个轮末就够。
 * 不需要“保持”的规则（击倒类、关键人物）在每次攻击后都会检查，达成就立刻结束。
 */

export interface KeyUnits {
  /** 旗手：基础血最高（并列取小编号）。 */
  flag: Unit | null;
  /** 核心：基础攻最高。 */
  core: Unit | null;
  /** 弱点：基础血最低。 */
  weak: Unit | null;
  /** 剪断双核的第二目标：与旗手是同一人时取剩余里攻最高的。 */
  secondCore: Unit | null;
  /** 众目所向：亮出的那名。 */
  revealed: Unit | null;
}

export interface VictoryState {
  ruleId: string;
  keys: [KeyUnits, KeyUnits];
  streak: [number, number];
  /** 绝境突围的窗口。 */
  window: { lone: Seat; openedAt: number; enemyDeathsAtOpen: number } | null;
}

const existing = (team: Unit[]) => team.filter((u) => u.exists);
const alive = (team: Unit[]) => team.filter((u) => u.alive);
export const teamHealth = (team: Unit[]) => existing(team).reduce((s, u) => s + health(u), 0);
const deaths = (team: Unit[]) => existing(team).filter((u) => !u.alive).length;

function pickBy(team: Unit[], score: (u: Unit) => number): Unit | null {
  let best: Unit | null = null;
  for (const u of existing(team)) {
    if (!best || score(u) > score(best)) best = u; // 并列时保留小编号
  }
  return best;
}

export function setupVictory(ruleId: string, teams: [Unit[], Unit[]], revealedPos: [number, number]): VictoryState {
  const keysFor = (seat: Seat): KeyUnits => {
    const team = teams[seat];
    const flag = pickBy(team, (u) => u.def!.hp);
    const core = pickBy(team, (u) => u.def!.atk);
    const weak = pickBy(team, (u) => -u.def!.hp);
    const secondCore = core !== flag ? core : pickBy(team.filter((u) => u !== flag), (u) => u.def!.atk);
    const r = team[revealedPos[seat]];
    return { flag, core, weak, secondCore, revealed: r && r.exists ? r : flag };
  };
  return { ruleId, keys: [keysFor(0), keysFor(1)], streak: [0, 0], window: null };
}

const dead = (u: Unit | null) => !!u && !u.alive;

/** 随时成立就立刻获胜的条件（每次攻击后都检查）：全灭，以及不需要“保持”的规则。 */
export function instantClaims(st: VictoryState, teams: [Unit[], Unit[]]): [boolean, boolean] {
  return [instantFor(st, teams, 0), instantFor(st, teams, 1)];
}

function instantFor(st: VictoryState, teams: [Unit[], Unit[]], seat: Seat): boolean {
  const foe = teams[other(seat)];
  if (existing(foe).length > 0 && alive(foe).length === 0) return true; // 全灭永远有效
  return condition(st, teams, seat);
}

function condition(st: VictoryState, teams: [Unit[], Unit[]], seat: Seat): boolean {
  const me = teams[seat];
  const foe = teams[other(seat)];
  const foeKeys = st.keys[other(seat)];
  switch (st.ruleId) {
    case "V02": return deaths(foe) >= 1;
    case "V03": return deaths(foe) >= 2;
    case "V04": return alive(me).length >= 2 && alive(foe).length === 1;
    case "V05": return existing(foe).every((u) => health(u) <= 0.5);
    case "V06": return existing(foe).filter((u) => health(u) <= 0.25).length >= 2;
    case "V07": return dead(foeKeys.flag);
    case "V08": return dead(foeKeys.core);
    case "V09": return dead(foeKeys.weak);
    case "V10": return dead(foeKeys.flag) && dead(foeKeys.secondCore);
    case "V11": return dead(foeKeys.flag) && deaths(foe) >= 2;
    case "V12": return dead(foeKeys.revealed);
    case "V17": return deaths(foe) >= 1 && existing(me).every((u) => u.alive && health(u) > 0.5);
    case "V20": return deaths(foe) >= 2;
    default: return false;
  }
}

/** 一轮结束时，双方各自是否达成胜利条件（包括需要连续保持的规则）。 */
export function roundEndClaims(st: VictoryState, teams: [Unit[], Unit[]], round: number): [boolean, boolean] {
  const claims = instantClaims(st, teams);

  // 维持压制：连续轮末计数
  const streakCondition = (seat: Seat): boolean | null => {
    const me = teams[seat];
    const foe = teams[other(seat)];
    switch (st.ruleId) {
      case "V13": return teamHealth(me) - teamHealth(foe) >= 0.75;
      case "V14": return alive(me).length > alive(foe).length;
      case "V15": {
        const mine = st.keys[seat].flag;
        const theirs = st.keys[other(seat)].flag;
        return !!mine && !!theirs && health(theirs) <= 0.3 && health(mine) > 0.3;
      }
      case "V16": return lanesLeading(me, foe, 0.25) >= 2;
      default: return null;
    }
  };
  const need = st.ruleId === "V13" || st.ruleId === "V14" ? 2 : 1;

  for (const seat of [0, 1] as Seat[]) {
    const sc = streakCondition(seat);
    if (sc !== null) {
      st.streak[seat] = sc ? st.streak[seat] + 1 : 0;
      if (st.streak[seat] >= need) claims[seat] = true;
    }
  }

  if (st.ruleId === "V18") applyBreakoutWindow(st, teams, round, claims);
  return claims;
}

function lanesLeading(me: Unit[], foe: Unit[], margin: number): number {
  let n = 0;
  for (let i = 0; i < 3; i++) if (health(me[i]) - health(foe[i]) >= margin) n++;
  return n;
}

function applyBreakoutWindow(st: VictoryState, teams: [Unit[], Unit[]], round: number, claims: [boolean, boolean]) {
  const a = alive(teams[0]).length;
  const b = alive(teams[1]).length;
  if (!st.window) {
    const lone: Seat | null = a === 1 && b >= 2 ? 0 : b === 1 && a >= 2 ? 1 : null;
    if (lone !== null) st.window = { lone, openedAt: round, enemyDeathsAtOpen: deaths(teams[other(lone)]) };
    return;
  }
  const { lone, openedAt, enemyDeathsAtOpen } = st.window;
  if (deaths(teams[other(lone)]) > enemyDeathsAtOpen) {
    st.window = null; // 孤身者反杀成功，继续打
    return;
  }
  if (round - openedAt >= 1) {
    const many = alive(teams[other(lone)]).length > alive(teams[lone]).length ? other(lone) : null;
    if (many !== null) claims[many] = true;
    st.window = null;
  }
}

/** 打满回合数后的比较。返回胜者，null 为平局。 */
export function timeoutWinner(st: VictoryState, teams: [Unit[], Unit[]]): Seat | null {
  const [A, B] = teams;
  const cmp = (a: number, b: number): Seat | null | undefined =>
    Math.abs(a - b) < 1e-9 ? undefined : a > b ? 0 : 1;
  const chain = (...steps: Array<() => Seat | null | undefined>): Seat | null => {
    for (const s of steps) {
      const r = s();
      if (r !== undefined) return r;
    }
    return null;
  };
  const byAlive = () => cmp(alive(A).length, alive(B).length);
  const byTotalHp = () => cmp(sumHp(A), sumHp(B));
  const byTeamHealth = () => cmp(teamHealth(A), teamHealth(B));
  const standard = [byAlive, byTotalHp];

  switch (st.ruleId) {
    case "V16":
      return chain(() => cmp(lanesLeading(A, B, 1e-9), lanesLeading(B, A, 1e-9)), ...standard);
    case "V19":
      return chain(byTeamHealth, byAlive);
    case "V21":
      return chain(byAlive, () => cmp(minHealth(A), minHealth(B)), byTeamHealth);
    case "V22":
      return chain(
        () => cmp(alive(A).length >= 2 ? 1 : 0, alive(B).length >= 2 ? 1 : 0),
        () => (alive(A).length >= 2 ? cmp(topTwo(A), topTwo(B)) : undefined),
        ...standard,
      );
    case "V23":
      return chain(() => cmp(maxHealth(A), maxHealth(B)), byAlive, byTeamHealth);
    case "V24":
      // 把对方最低两人打得更低的一方胜：比较“对方最低两人之和”，小者胜
      return chain(() => cmp(lowTwo(A), lowTwo(B)), ...standard);
    case "V25": {
      const made = (foe: Unit[]) => (existing(foe).every((u) => health(u) < 0.75) ? 1 : 0);
      return chain(() => cmp(made(B), made(A)), byTeamHealth);
    }
    case "V26": {
      const f = st.keys.map((k) => k.flag) as [Unit | null, Unit | null];
      const flagScore = (team: Unit[], flag: Unit | null) => {
        if (!flag || !flag.alive) return 0;
        const best = Math.max(0, ...existing(team).filter((u) => u !== flag).map(health));
        return health(flag) + best;
      };
      return chain(
        () => cmp(f[0]?.alive ? 1 : 0, f[1]?.alive ? 1 : 0),
        () => (f[0]?.alive && f[1]?.alive ? cmp(flagScore(A, f[0]), flagScore(B, f[1])) : undefined),
        ...standard,
      );
    }
    case "V27": {
      const standing = (foe: Unit[]) => existing(foe).filter((u) => health(u) > 0.5).length;
      return chain(() => cmp(standing(A), standing(B)), ...standard); // 我方站着的人越多，对手越差
    }
    default:
      return chain(...standard);
  }
}

const sumHp = (team: Unit[]) => alive(team).reduce((s, u) => s + u.hp, 0);
const minHealth = (team: Unit[]) => Math.min(...alive(team).map(health), 1);
const maxHealth = (team: Unit[]) => Math.max(0, ...existing(team).map(health));
const topTwo = (team: Unit[]) => existing(team).map(health).sort((x, y) => y - x).slice(0, 2).reduce((s, x) => s + x, 0);
/** 该队健康度最低两人之和（越低说明对手打得越好）。 */
const lowTwo = (team: Unit[]) => existing(team).map(health).sort((x, y) => x - y).slice(0, 2).reduce((s, x) => s + x, 0);
