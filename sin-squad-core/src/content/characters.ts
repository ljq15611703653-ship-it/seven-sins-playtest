import type { CharacterDef } from "../types.js";

/**
 * 21 名人物。面板形状各走极端，效果越强面板越弱。
 * 能力的具体结算写在 battle/engine.ts（战斗层）和 game/table.ts（下注、信息层）。
 */
export const CHARACTERS: readonly CharacterDef[] = [
  // 愤怒
  { id: "WR1", name: "挑衅者", sin: "愤怒", atk: 2, hp: 7, shape: "multi", armor: 0, barrier: 0,
    ability: "对手本手每下注或加注一次，攻 +2", tag: "反加注", stage: 1 },
  { id: "WR2", name: "蓄痛拳手", sin: "愤怒", atk: 1, hp: 10, shape: "heavy", armor: 0, barrier: 0,
    ability: "战斗中每受到一段伤害，攻 +1", tag: "越打越痛", stage: 1 },
  { id: "WR3", name: "清算者", sin: "愤怒", atk: 5, hp: 4, shape: "heavy", armor: 0, barrier: 0,
    ability: "若对手本手加注过，第一轮攻击翻倍", tag: "首轮爆发", stage: 2 },
  // 贪婪
  { id: "GR1", name: "金主", sin: "贪婪", atk: 1, hp: 5, shape: "heavy", armor: 0, barrier: 0,
    ability: "你本手每投入 10 筹码，+1/+1（最多 +4/+4）", tag: "花钱养成", stage: 2 },
  { id: "GR2", name: "盾税官", sin: "贪婪", atk: 3, hp: 8, shape: "heavy", armor: 0, barrier: 0,
    ability: "你本手每付一次操作费，开战时得一层屏障（最多 2）", tag: "花钱买护盾", stage: 1 },
  { id: "GR3", name: "收藏家", sin: "贪婪", atk: 4, hp: 7, shape: "heavy", armor: 0, barrier: 0,
    ability: "击倒敌人后，攻 +2 并拿走对方的装备加成", tag: "收割者", stage: 1 },
  // 暴食
  { id: "GL1", name: "嚼盾兽", sin: "暴食", atk: 3, hp: 8, shape: "multi", armor: 0, barrier: 0,
    ability: "吸血：自己攻击每打中一段，回复 1 血（反击不算）", tag: "破盾续航", stage: 1 },
  { id: "GL2", name: "饕餮", sin: "暴食", atk: 3, hp: 8, shape: "heavy", armor: 0, barrier: 0,
    ability: "布阵时可以吞掉一名队友，获得它的攻和血（该位置空出）", tag: "三合一", stage: 2 },
  { id: "GL3", name: "残羹客", sin: "暴食", atk: 2, hp: 7, shape: "heavy", armor: 0, barrier: 0,
    ability: "每有一名人物倒下（不论敌我），+1/+3", tag: "血战养成", stage: 1 },
  // 嫉妒
  { id: "EN1", name: "窥视者", sin: "嫉妒", atk: 3, hp: 8, shape: "multi", armor: 0, barrier: 0,
    ability: "亮牌后，暗中查看对手一名暗置人物，然后可以交换自己两名暗置人物的位置（对手不会知道）", tag: "情报", stage: 1 },
  { id: "EN2", name: "摹拳客", sin: "嫉妒", atk: 1, hp: 10, shape: "heavy", armor: 0, barrier: 0,
    ability: "开战时，攻和攻击形状变得与对位敌人相同（取较高攻）", tag: "镜子", stage: 2 },
  { id: "EN3", name: "夺装者", sin: "嫉妒", atk: 3, hp: 7, shape: "heavy", armor: 0, barrier: 0,
    ability: "开战时，拿走对位敌人的装备", tag: "抢装备", stage: 1 },
  // 怠惰
  { id: "SL1", name: "瞌睡客", sin: "怠惰", atk: 1, hp: 9, shape: "heavy", armor: 1, barrier: 0,
    ability: "你本手每过牌一次，+0/+4", tag: "慢打肉盾", stage: 1 },
  { id: "SL2", name: "沉眠巨像", sin: "怠惰", atk: 3, hp: 7, shape: "heavy", armor: 1, barrier: 0,
    ability: "第一轮不出手；你本手每过牌一次，攻 +2", tag: "慢热巨像", stage: 2 },
  { id: "SL3", name: "静息药师", sin: "怠惰", atk: 2, hp: 8, shape: "heavy", armor: 0, barrier: 0,
    ability: "若你本手没付过操作费，开战时全队 +0/+5", tag: "不操作的奖励", stage: 1 },
  // 傲慢
  { id: "PR1", name: "炫耀者", sin: "傲慢", atk: 2, hp: 7, shape: "heavy", armor: 0, barrier: 0,
    ability: "被亮出时 +3/+4", tag: "爱被看见", stage: 1 },
  { id: "PR2", name: "无瑕刺客", sin: "傲慢", atk: 3, hp: 3, shape: "heavy", armor: 0, barrier: 1,
    ability: "满血时攻击翻倍", tag: "满血就疼", stage: 2 },
  { id: "PR3", name: "冠冕者", sin: "傲慢", atk: 3, hp: 7, shape: "heavy", armor: 1, barrier: 0,
    ability: "被亮出时，对手在第 1 轮下注不能弃牌", tag: "逼对手摊牌", stage: 2 },
  // 色欲
  { id: "LU1", name: "同行药袋", sin: "色欲", atk: 3, hp: 12, shape: "heavy", armor: 0, barrier: 0,
    ability: "守护：相邻队友受到的攻击改由它承受", tag: "保镖", stage: 1 },
  { id: "LU2", name: "牵线人", sin: "色欲", atk: 2, hp: 7, shape: "heavy", armor: 0, barrier: 0,
    ability: "开战时与对位敌人缔结，两者本场都不出手（仍可被攻击）", tag: "一换一", stage: 2 },
  { id: "LU3", name: "魅惑者", sin: "色欲", atk: 3, hp: 5, shape: "heavy", armor: 0, barrier: 0,
    ability: "开战时，对位敌人第一轮改打它自己的相邻队友", tag: "让敌人内讧", stage: 2 },

  // 每罪新增 5 人：身材按本核心的比例换算（攻不变、最高 5；血 ×0.58 取整，限 3–13），能力里的回复 / 加血数字同样换算。
  { id: "WR4", name: "怒潮", sin: "愤怒", atk: 3, hp: 8, shape: "multi", armor: 0, barrier: 0, ability: "生命低于一半时攻 +2", tag: "濒死增压", stage: 1 },
  { id: "WR5", name: "破阵者", sin: "愤怒", atk: 4, hp: 6, shape: "heavy", armor: 0, barrier: 0, ability: "第一次击破屏障后攻 +2", tag: "破盾", stage: 1 },
  { id: "WR6", name: "复仇印", sin: "愤怒", atk: 2, hp: 10, shape: "heavy", armor: 0, barrier: 0, ability: "每被同一敌人连续命中一次，攻 +1（最多 +3）", tag: "记仇", stage: 1 },
  { id: "WR7", name: "战吼者", sin: "愤怒", atk: 2, hp: 6, shape: "multi", armor: 0, barrier: 0, ability: "开战时己方全队攻 +1", tag: "开场战吼", stage: 2 },
  { id: "WR8", name: "断头台", sin: "愤怒", atk: 5, hp: 6, shape: "heavy", armor: 0, barrier: 0, ability: "攻击生命低于 30% 的目标时攻 +3", tag: "处决", stage: 2 },
  { id: "GR4", name: "利滚利", sin: "贪婪", atk: 2, hp: 9, shape: "heavy", armor: 0, barrier: 0, ability: "每付一次操作费，攻 +1", tag: "复利", stage: 1 },
  { id: "GR5", name: "金库守卫", sin: "贪婪", atk: 2, hp: 9, shape: "heavy", armor: 1, barrier: 0, ability: "开战时筹码领先：屏障 +1", tag: "守财", stage: 1 },
  { id: "GR6", name: "赌徒", sin: "贪婪", atk: 4, hp: 6, shape: "multi", armor: 0, barrier: 0, ability: "本手下注或加注过时攻 +2", tag: "押注", stage: 1 },
  { id: "GR7", name: "掠夺商", sin: "贪婪", atk: 3, hp: 6, shape: "heavy", armor: 0, barrier: 1, ability: "击倒敌人后为自己获得屏障 +1", tag: "战利品", stage: 2 },
  { id: "GR8", name: "宝库主", sin: "贪婪", atk: 5, hp: 5, shape: "heavy", armor: 0, barrier: 0, ability: "本手投入超过 30 时攻 +3", tag: "豪掷", stage: 2 },
  { id: "GL4", name: "吞光者", sin: "暴食", atk: 3, hp: 10, shape: "heavy", armor: 0, barrier: 0, ability: "每击倒一名敌人回复 2 血", tag: "进食", stage: 1 },
  { id: "GL5", name: "酸液兽", sin: "暴食", atk: 3, hp: 8, shape: "multi", armor: 0, barrier: 0, ability: "命中护甲目标时使其护甲 -1（每人一次）", tag: "腐蚀", stage: 1 },
  { id: "GL6", name: "饥饿猎犬", sin: "暴食", atk: 4, hp: 7, shape: "heavy", armor: 0, barrier: 0, ability: "攻击生命比自己低的目标时攻 +2", tag: "追食", stage: 1 },
  { id: "GL7", name: "胃囊巨人", sin: "暴食", atk: 1, hp: 13, shape: "heavy", armor: 1, barrier: 0, ability: "受到治疗时额外回复 1", tag: "储能", stage: 2 },
  { id: "GL8", name: "终餐者", sin: "暴食", atk: 4, hp: 7, shape: "multi", armor: 0, barrier: 0, ability: "敌方只剩一人时攻 +4", tag: "终餐", stage: 2 },
  { id: "EN4", name: "偷心者", sin: "嫉妒", atk: 3, hp: 9, shape: "multi", armor: 0, barrier: 0, ability: "对位敌人带着装备或效果牌开战：攻 +2", tag: "眼红", stage: 1 },
  { id: "EN5", name: "复写匠", sin: "嫉妒", atk: 2, hp: 8, shape: "heavy", armor: 0, barrier: 1, ability: "开战时复制对位敌人护甲或屏障中较高的一项", tag: "复写", stage: 1 },
  { id: "EN6", name: "窥伺刀", sin: "嫉妒", atk: 4, hp: 7, shape: "heavy", armor: 0, barrier: 0, ability: "攻击被亮出的敌人时攻 +2", tag: "看穿", stage: 1 },
  { id: "EN7", name: "夺势者", sin: "嫉妒", atk: 3, hp: 8, shape: "multi", armor: 0, barrier: 0, ability: "敌方攻最高者倒下后全队攻 +2", tag: "夺势", stage: 2 },
  { id: "EN8", name: "镜狱", sin: "嫉妒", atk: 1, hp: 8, shape: "heavy", armor: 0, barrier: 0, ability: "开战时获得和对位敌人等量的攻（最多 +3）", tag: "镜牢", stage: 2 },
  { id: "SL4", name: "慢钟", sin: "怠惰", atk: 2, hp: 8, shape: "heavy", armor: 1, barrier: 0, ability: "第一轮受到伤害 -2（最低 1）", tag: "拖延", stage: 1 },
  { id: "SL5", name: "躺赢者", sin: "怠惰", atk: 1, hp: 10, shape: "multi", armor: 0, barrier: 1, ability: "本手没有下注或加注时，攻 +2、血 +3", tag: "躺赢", stage: 1 },
  { id: "SL6", name: "缓行者", sin: "怠惰", atk: 3, hp: 8, shape: "heavy", armor: 0, barrier: 0, ability: "每轮第一次受到攻击后下一轮攻 +2", tag: "蓄力", stage: 1 },
  { id: "SL7", name: "休眠守卫", sin: "怠惰", atk: 2, hp: 8, shape: "heavy", armor: 1, barrier: 0, ability: "每轮开始时满血且没有屏障：屏障 +1", tag: "守眠", stage: 2 },
  { id: "SL8", name: "终止符", sin: "怠惰", atk: 4, hp: 8, shape: "heavy", armor: 0, barrier: 0, ability: "第三轮起攻 +3", tag: "晚钟", stage: 2 },
  { id: "PR4", name: "镀金者", sin: "傲慢", atk: 3, hp: 6, shape: "heavy", armor: 0, barrier: 1, ability: "满血时护甲 +1", tag: "自矜", stage: 1 },
  { id: "PR5", name: "首席", sin: "傲慢", atk: 3, hp: 8, shape: "multi", armor: 0, barrier: 0, ability: "自己亮牌时己方全队攻 +1", tag: "领衔", stage: 1 },
  { id: "PR6", name: "不屈冠军", sin: "傲慢", atk: 2, hp: 9, shape: "heavy", armor: 0, barrier: 0, ability: "第一次低于一半生命时获得屏障 +1", tag: "不屈", stage: 1 },
  { id: "PR7", name: "优越者", sin: "傲慢", atk: 5, hp: 5, shape: "heavy", armor: 0, barrier: 0, ability: "对位敌人攻低于自己时攻 +2", tag: "压制", stage: 2 },
  { id: "PR8", name: "终局王", sin: "傲慢", atk: 3, hp: 8, shape: "multi", armor: 0, barrier: 0, ability: "己方存活人数更多时攻 +2", tag: "王座", stage: 2 },
  { id: "LU4", name: "缠绵者", sin: "色欲", atk: 2, hp: 10, shape: "heavy", armor: 0, barrier: 1, ability: "对位敌人被击倒时，相邻队友各回复 2", tag: "余温", stage: 1 },
  { id: "LU5", name: "护心人", sin: "色欲", atk: 1, hp: 12, shape: "heavy", armor: 0, barrier: 0, ability: "相邻队友受到攻击时自己获得屏障 +1", tag: "护心", stage: 1 },
  { id: "LU6", name: "共鸣者", sin: "色欲", atk: 3, hp: 9, shape: "multi", armor: 0, barrier: 0, ability: "相邻队友攻高于自己时，自己攻 +2", tag: "共鸣", stage: 1 },
  { id: "LU7", name: "诱导者", sin: "色欲", atk: 3, hp: 6, shape: "heavy", armor: 0, barrier: 1, ability: "嘲讽：转线后的敌人优先攻击它", tag: "诱敌", stage: 2 },
  { id: "LU8", name: "双生誓", sin: "色欲", atk: 3, hp: 9, shape: "multi", armor: 0, barrier: 0, ability: "站在 2 号位、两侧都有队友时，开战全队血 +2", tag: "连结", stage: 2 },
];

const BY_ID = new Map(CHARACTERS.map((c) => [c.id, c]));

export function character(id: string): CharacterDef {
  const c = BY_ID.get(id);
  if (!c) throw new Error(`未知人物：${id}`);
  return c;
}

export const CHARACTER_IDS: readonly string[] = CHARACTERS.map((c) => c.id);
