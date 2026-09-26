import type { AttackShape, CharacterDef, Seat } from "../types.js";

/** 战斗中的一名人物。位置 pos = 0/1/2 对应 1/2/3 号位。 */
export interface Unit {
  seat: Seat;
  pos: number;
  /** 空位（没人或被饕餮吞掉）时为 null。 */
  def: CharacterDef | null;
  exists: boolean;
  alive: boolean;
  atk: number;
  hp: number;
  /** 开战血量：健康度的分母。 */
  startHp: number;
  /** 回复上限。 */
  maxHp: number;
  shape: AttackShape;
  /** 人物与环境给的护甲（会被锈蚀、裂甲削减）。 */
  armorBase: number;
  /** 装备给的护甲（不受锈蚀影响）。 */
  armorEquip: number;
  barrier: number;
  equipmentIds: string[];
  /** 装备带来的攻 / 血，收藏家击倒它时拿走。 */
  eqAtk: number;
  eqHp: number;

  bonded: boolean;
  charmed: boolean;
  /** 前 N 轮不出手（沉眠巨像）。 */
  skipRounds: number;
  /** 下一轮不出手（沉重后坐）。 */
  skipNext: boolean;
  /** 转线：null = 还没开始转线；数字 = 还要花几轮。 */
  switchRemaining: number | null;
  /** 是否已经转过线（断桥用）。 */
  switched: boolean;
  attacks: number;
  /** 下一次攻击的加值（碎盾节、重整、燃命）。 */
  pendingBonus: number;
  huntTarget: Unit | null;
  huntUsed: boolean;
  lostTotal: number;
  bloodSpringAcc: number;
  healAcc: number;
  halfHealthTriggered: boolean;
  focusEchoUsed: boolean;
  sideCoverUsed: boolean;
  barrierEchoed: boolean;
  regenRounds: number;
  deathRound: number | null;
  /** 只触发一次、或者按条件开关的人物能力状态（例如“第一次低于一半生命”）。 */
  flags: Set<string>;
}

export const MAX_BARRIER = 2;

export function armorOf(u: Unit): number {
  return u.armorBase + u.armorEquip;
}

/** 健康度 = 当前血 ÷ 开战血，最高 1；倒下为 0。 */
export function health(u: Unit): number {
  if (!u.exists || !u.alive) return 0;
  return Math.min(1, Math.max(0, u.hp) / u.startHp);
}

export function emptyUnit(seat: Seat, pos: number): Unit {
  return {
    seat, pos, def: null, exists: false, alive: false,
    atk: 0, hp: 0, startHp: 1, maxHp: 1, shape: "heavy",
    armorBase: 0, armorEquip: 0, barrier: 0, equipmentIds: [], eqAtk: 0, eqHp: 0,
    bonded: false, charmed: false, skipRounds: 0, skipNext: false,
    switchRemaining: null, switched: false, attacks: 0, pendingBonus: 0,
    huntTarget: null, huntUsed: false, lostTotal: 0, bloodSpringAcc: 0, healAcc: 0,
    halfHealthTriggered: false, focusEchoUsed: false, sideCoverUsed: false,
    barrierEchoed: false, regenRounds: 0, deathRound: null, flags: new Set(),
  };
}

export function unitFrom(def: CharacterDef, seat: Seat, pos: number): Unit {
  return {
    ...emptyUnit(seat, pos),
    def, exists: true, alive: true,
    atk: def.atk, hp: def.hp, startHp: def.hp, maxHp: def.hp,
    shape: def.shape, armorBase: def.armor, barrier: def.barrier,
  };
}

/** 给画面和测试用的只读快照。 */
export interface UnitSnapshot {
  seat: Seat;
  pos: number;
  characterId: string | null;
  alive: boolean;
  atk: number;
  hp: number;
  startHp: number;
  shape: AttackShape;
  armor: number;
  barrier: number;
  /** 身上的装备（夺装者会改变它）。 */
  equipment: string[];
}

export function snapshot(u: Unit): UnitSnapshot {
  return {
    seat: u.seat, pos: u.pos, characterId: u.def?.id ?? null, alive: u.alive,
    atk: u.atk, hp: u.hp, startHp: u.startHp, shape: u.shape,
    armor: armorOf(u), barrier: u.barrier, equipment: u.equipmentIds.slice(),
  };
}

