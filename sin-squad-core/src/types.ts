/** 共用类型。规则说明以《七罪暗队 · 规则草案 v0.3》为准。 */

export type Sin = "愤怒" | "贪婪" | "暴食" | "嫉妒" | "怠惰" | "傲慢" | "色欲";

/** 攻击形状：重击 = 单段；连击 = 每次攻击分两段，每段一半。 */
export type AttackShape = "heavy" | "multi";

/** 两名玩家的座位编号。 */
export type Seat = 0 | 1;
export const SEATS: readonly Seat[] = [0, 1];
export const other = (s: Seat): Seat => (s === 0 ? 1 : 0);

/** 市场阶段：1 = 朴素，2 = 极端，3 = 罪王（尚未设计）。 */
export type MarketStage = 1 | 2 | 3;

export interface CharacterDef {
  id: string;
  name: string;
  sin: Sin;
  atk: number;
  hp: number;
  shape: AttackShape;
  armor: number;
  barrier: number;
  /** 能力说明（玩家看到的一句话）。 */
  ability: string;
  /** 一眼该认出的特点。 */
  tag: string;
  stage: MarketStage;
}

export type EquipmentEffect =
  | { kind: "stat"; atk: number; hp: number }
  | { kind: "shape"; shape: AttackShape; atk: number }
  | { kind: "armor"; armor: number; hp: number }
  | { kind: "barrier"; barrier: number; atk: number };

export interface EquipmentDef {
  id: string;
  name: string;
  text: string;
  effect: EquipmentEffect;
}

/** 效果槽牌。当前核心将可验证的静态效果映射到新版攻/血面板。 */
export type SlotEffect =
  | { kind: "stat"; atk: number; hp: number }
  | { kind: "armor"; armor: number; hp: number }
  | { kind: "barrier"; barrier: number; atk: number }
  | { kind: "shape"; shape: AttackShape; atk: number };

export interface SlotEffectDef {
  id: string;
  name: string;
  text: string;
  effect: SlotEffect;
}

export type RuleFamily = "快速击破" | "关键人物" | "维持压制" | "限时作战";

export interface RuleDef {
  id: string;
  name: string;
  family: RuleFamily;
  text: string;
  /** 本规则最多打几轮。 */
  maxRounds: number;
}

export interface ArenaDef {
  id: string;
  name: string;
  text: string;
  kind: "转线" | "节奏" | "伤害" | "下注" | "形状" | "逆转";
}

export interface PublicEffectDef {
  id: string;
  name: string;
  text: string;
  kind: "防护与形状" | "节奏" | "生命与资源" | "阵位";
}

/** 一名人物上场时的配置（位置固定为 0/1/2，对应 1/2/3 号位）。 */
export interface SlotSetup {
  characterId: string | null; // null = 空位（例如被饕餮吞掉）
  equipmentId: string | null;
  effectId?: string | null;
}

/** 饕餮在布阵时吞掉队友：eater、eaten 都是位置编号。 */
export interface EatChoice {
  eater: number;
  eaten: number;
}

/** 一方在本手里、会影响战力的下注行为。 */
export interface BetContext {
  /** 本手投入：底注 + 下注 + 操作费 + 暗标出价。 */
  invested: number;
  /** 本方主动下注或加注的次数。 */
  betOrRaiseCount: number;
  /** 本方在无人下注时过牌的次数。 */
  checkCount: number;
  /** 本方付过操作费的次数。 */
  opsPaid: number;
  /** 本方亮出的位置。 */
  revealedPos: number;
  /** 开战时本方剩下的筹码（金库守卫比谁领先用）；没给就当 0。 */
  stack?: number;
}

export interface TeamSetup {
  slots: SlotSetup[]; // 长度 3
  eat: EatChoice | null;
  bet: BetContext;
}
