import type { EatChoice } from "../types.js";

/** 玩家能提交的所有动作。 */
export type Action =
  /** 落后方从两张场地里选一张。 */
  | { type: "chooseArena"; index: 0 | 1 }
  /** 从发到的 4 名里挑 3 名布阵：picks[i] 是放在 i 号位的那张（发牌序号）。 */
  | { type: "place"; picks: [number, number, number]; eat: EatChoice | null; reveal: number }
  /** 窥视者：暗中查看对手一个暗置位置。 */
  | { type: "peek"; pos: number }
  /** 窥视者偷看之后：交换自己两名暗置人物的位置（null = 不交换）。对手不会知道。 */
  | { type: "peekSwap"; swap: [number, number] | null }
  | { type: "check" }
  | { type: "bet"; amount: number }
  | { type: "call" }
  /** 加注到本轮总额 to。 */
  | { type: "raise"; to: number }
  | { type: "allIn" }
  | { type: "fold" }
  /** 下注匹配后，是否付操作费拿装备。 */
  | { type: "operate"; draft: boolean }
  /** 从三张候选装备里选一张，装到 pos 号位。 */
  | { type: "draft"; offerIndex: number; pos: number }
  /** 公共效果：投生效 / 不生效。 */
  | { type: "vote"; activate: boolean }
  /** 公共效果暗标出价。 */
  | { type: "bid"; amount: number }
  /** 结算后从市场挑一名人物进牌池。 */
  | { type: "marketPick"; index: number }
  /** 从自己牌池移除一名（null 表示不移除）。 */
  | { type: "marketRemove"; poolIndex: number | null };

export type Phase =
  | "arena"
  | "place"
  | "peek"
  | "bet"
  | "operate"
  | "draft"
  | "vote"
  | "bid"
  | "marketPick"
  | "marketRemove"
  | "over";
