import type { ArenaDef, EquipmentDef, PublicEffectDef, RuleDef, SlotEffectDef } from "../types.js";

/** 装备：约一半是身材牌，另一半改变攻击形状或防御。 */
export const EQUIPMENT: readonly EquipmentDef[] = [
  { id: "E01", name: "校准刃", text: "+3/+0", effect: { kind: "stat", atk: 3, hp: 0 } },
  { id: "E02", name: "厚衬背心", text: "+0/+6", effect: { kind: "stat", atk: 0, hp: 6 } },
  { id: "E03", name: "轻摆齿轮", text: "+1/+4", effect: { kind: "stat", atk: 1, hp: 4 } },
  { id: "E04", name: "铁拳套", text: "+2/+3", effect: { kind: "stat", atk: 2, hp: 3 } },
  { id: "E05", name: "行军斗篷", text: "+1/+5", effect: { kind: "stat", atk: 1, hp: 5 } },
  { id: "E06", name: "猎刀", text: "+2/+1", effect: { kind: "stat", atk: 2, hp: 1 } },
  { id: "E07", name: "双刃", text: "攻击改为连击", effect: { kind: "shape", shape: "multi", atk: 0 } },
  { id: "E08", name: "磨刀石", text: "攻击改为重击，攻 +1", effect: { kind: "shape", shape: "heavy", atk: 1 } },
  { id: "E09", name: "铁衬", text: "护甲 +1", effect: { kind: "armor", armor: 1, hp: 0 } },
  { id: "E10", name: "链甲", text: "护甲 +1，血 +3", effect: { kind: "armor", armor: 1, hp: 3 } },
  { id: "E11", name: "护符", text: "屏障 +1", effect: { kind: "barrier", barrier: 1, atk: 0 } },
  { id: "E12", name: "镜符", text: "屏障 +1，攻 +1", effect: { kind: "barrier", barrier: 1, atk: 1 } },
];

/**
 * 原设计 FX01-FX50 的减半版：保留前 25 张的识别度，先以新版攻/血/防御
 * 模型可直接结算的静态修正落地。血量和装备一样按本核心的比例换算（×0.6 取整，至少 1）。触发型原文仍保存在设计稿，不在这里冒充
 * 已完成的事件引擎。
 */
export const SLOT_EFFECTS: readonly SlotEffectDef[] = [
  { id: "FX01", name: "发令手", text: "攻 +2", effect: { kind: "stat", atk: 2, hp: 0 } },
  { id: "FX02", name: "受伤报信", text: "血 +5", effect: { kind: "stat", atk: 0, hp: 5 } },
  { id: "FX03", name: "碎壳回援", text: "护甲 +1，血 +2", effect: { kind: "armor", armor: 1, hp: 2 } },
  { id: "FX04", name: "三拍接棒", text: "攻 +1，血 +2", effect: { kind: "stat", atk: 1, hp: 2 } },
  { id: "FX05", name: "分一口", text: "血 +4", effect: { kind: "stat", atk: 0, hp: 4 } },
  { id: "FX06", name: "盾边搭手", text: "屏障 +1", effect: { kind: "barrier", barrier: 1, atk: 0 } },
  { id: "FX07", name: "替我出手", text: "攻 +3", effect: { kind: "stat", atk: 3, hp: 0 } },
  { id: "FX08", name: "共担警讯", text: "血 +3，护甲 +1", effect: { kind: "armor", armor: 1, hp: 3 } },
  { id: "FX09", name: "净身传递", text: "攻 +2，屏障 +1", effect: { kind: "barrier", barrier: 1, atk: 2 } },
  { id: "FX10", name: "低血托底", text: "血 +6", effect: { kind: "stat", atk: 0, hp: 6 } },
  { id: "FX11", name: "撞盾示意", text: "攻 +2，护甲 +1", effect: { kind: "armor", armor: 1, hp: 0 } },
  { id: "FX12", name: "开口同饮", text: "血 +4，屏障 +1", effect: { kind: "barrier", barrier: 1, atk: 0 } },
  { id: "FX13", name: "空击护送", text: "屏障 +2", effect: { kind: "barrier", barrier: 2, atk: 0 } },
  { id: "FX14", name: "传火", text: "攻 +3", effect: { kind: "stat", atk: 3, hp: 0 } },
  { id: "FX15", name: "踩着冷拍", text: "攻 +1，血 +3", effect: { kind: "stat", atk: 1, hp: 3 } },
  { id: "FX16", name: "毒口回甘", text: "血 +5", effect: { kind: "stat", atk: 0, hp: 5 } },
  { id: "FX17", name: "以战止血", text: "护甲 +1，血 +2", effect: { kind: "armor", armor: 1, hp: 2 } },
  { id: "FX18", name: "无声接班", text: "攻 +2，血 +2", effect: { kind: "stat", atk: 2, hp: 2 } },
  { id: "FX19", name: "绊住也有人接", text: "攻 +2", effect: { kind: "stat", atk: 2, hp: 0 } },
  { id: "FX20", name: "双症救援", text: "血 +4，屏障 +1", effect: { kind: "barrier", barrier: 1, atk: 0 } },
  { id: "FX21", name: "咬住一处", text: "攻 +2，血 +1", effect: { kind: "stat", atk: 2, hp: 1 } },
  { id: "FX22", name: "过桥护送", text: "护甲 +1，血 +4", effect: { kind: "armor", armor: 1, hp: 4 } },
  { id: "FX23", name: "胜势分盾", text: "屏障 +2", effect: { kind: "barrier", barrier: 2, atk: 0 } },
  { id: "FX24", name: "最后一面帆", text: "血 +7", effect: { kind: "stat", atk: 0, hp: 7 } },
  { id: "FX25", name: "留下一击", text: "攻 +3，血 +2", effect: { kind: "stat", atk: 3, hp: 2 } },
];

/** 27 条胜利规则。没写回合数的最多打 8 轮。 */
export const RULES: readonly RuleDef[] = [
  { id: "V01", name: "歼灭战", family: "快速击破", maxRounds: 8, text: "全灭对方即胜" },
  { id: "V02", name: "第一滴血", family: "快速击破", maxRounds: 8, text: "先击倒一名敌人即胜" },
  { id: "V03", name: "连续击破", family: "快速击破", maxRounds: 8, text: "先击倒两名敌人即胜" },
  { id: "V04", name: "双人包围", family: "快速击破", maxRounds: 8, text: "己方至少 2 人存活、敌方只剩 1 人时即胜" },
  { id: "V05", name: "全线破甲", family: "快速击破", maxRounds: 8, text: "敌方三人健康度同时 ≤ 50% 即胜" },
  { id: "V06", name: "重创双翼", family: "快速击破", maxRounds: 8, text: "敌方任意两人健康度同时 ≤ 25% 即胜" },
  { id: "V07", name: "斩旗", family: "关键人物", maxRounds: 8, text: "血最高者为旗手，击倒敌旗手即胜" },
  { id: "V08", name: "掐灭火力", family: "关键人物", maxRounds: 8, text: "攻最高者为核心，击倒敌核心即胜" },
  { id: "V09", name: "薄弱环节", family: "关键人物", maxRounds: 8, text: "血最低者为弱点，击倒敌弱点即胜" },
  { id: "V10", name: "剪断双核", family: "关键人物", maxRounds: 8, text: "旗手和核心都被击倒即胜" },
  { id: "V11", name: "破门取旗", family: "关键人物", maxRounds: 8, text: "击倒敌旗手，且至少再击倒一名敌人即胜" },
  { id: "V12", name: "众目所向", family: "关键人物", maxRounds: 8, text: "亮出的那名就是旗手，击倒敌旗手即胜" },
  { id: "V13", name: "持续优势", family: "维持压制", maxRounds: 8, text: "整队健康度领先 75% 以上，并保持 1 轮即胜" },
  { id: "V14", name: "人数压制", family: "维持压制", maxRounds: 8, text: "存活人数领先，并保持 1 轮即胜" },
  { id: "V15", name: "旗手围困", family: "维持压制", maxRounds: 8, text: "轮末时敌旗手健康度 ≤ 30% 且己旗手 > 30% 即胜" },
  { id: "V16", name: "两线推进", family: "维持压制", maxRounds: 8, text: "轮末时三组对位里至少两组健康度领先 25% 即胜；到时先比赢下的对位组数" },
  { id: "V17", name: "无缺口阵线", family: "维持压制", maxRounds: 8, text: "敌方已有一人倒下，且己方三人健康度都 > 50% 即胜" },
  { id: "V18", name: "绝境突围", family: "维持压制", maxRounds: 8, text: "一方只剩 1 人、另一方至少 2 人时进入突围：孤身者 1 轮内击倒一人就继续打，否则人多者胜" },
  { id: "V19", name: "短兵相接", family: "限时作战", maxRounds: 3, text: "只打 3 轮；比整队健康，再比存活人数" },
  { id: "V20", name: "持久战", family: "限时作战", maxRounds: 12, text: "最多打 12 轮；己方第二人倒下即输" },
  { id: "V21", name: "整队撤出", family: "限时作战", maxRounds: 3, text: "只打 3 轮；先比存活人数，再比存活者中最低的健康度" },
  { id: "V22", name: "双人撤出", family: "限时作战", maxRounds: 3, text: "只打 3 轮；先比是否至少 2 人存活，再比健康度最高的两人之和" },
  { id: "V23", name: "最后的堡垒", family: "限时作战", maxRounds: 3, text: "只打 3 轮；比各方最高的健康度" },
  { id: "V24", name: "双重火力网", family: "限时作战", maxRounds: 3, text: "只打 3 轮；比对方健康度最低两人之和，打得更低的一方胜" },
  { id: "V25", name: "全面压进", family: "限时作战", maxRounds: 4, text: "只打 4 轮；先比是否让敌方所有人健康度 < 75%，再比整队健康" },
  { id: "V26", name: "终场护旗", family: "限时作战", maxRounds: 4, text: "只打 4 轮，旗手倒下不立即结束；先比旗手是否存活，再比旗手与最健康队友的健康度之和" },
  { id: "V27", name: "不留后患", family: "限时作战", maxRounds: 4, text: "只打 4 轮；比敌方健康度仍 > 50% 的人数，较少者对应的一方胜" },
];

export const ARENAS: readonly ArenaDef[] = [
  { id: "A01", name: "断桥", kind: "转线", text: "转线后攻击 -2（最少 1）" },
  { id: "A02", name: "圆形斗场", kind: "转线", text: "转线不花时间" },
  { id: "A03", name: "结冰渡口", kind: "转线", text: "转线要花两轮" },
  { id: "A04", name: "重力阶梯", kind: "转线", text: "1 号位转线多花一轮；3 号位转线不花时间" },
  { id: "A05", name: "废弃射廊", kind: "转线", text: "打对位时攻击 +1" },
  { id: "A06", name: "积雪内院", kind: "节奏", text: "所有人第 1 轮不出手" },
  { id: "A07", name: "高压深井", kind: "节奏", text: "每人在第一次出手之前，受到的伤害减半" },
  { id: "A08", name: "静默书库", kind: "节奏", text: "第 1 轮所有人物能力失效，装备照常" },
  { id: "A09", name: "保险金库", kind: "节奏", text: "前 2 轮，每段伤害最多扣开战血量的 1/4" },
  { id: "A10", name: "淹水机房", kind: "伤害", text: "每次伤害额外溅射 1 点到目标相邻的人" },
  { id: "A11", name: "余烬长街", kind: "伤害", text: "第 2、4、6 轮轮末，所有人受 2 伤害" },
  { id: "A12", name: "荆棘回廊", kind: "伤害", text: "每人每第 3 次攻击后，自己失去 3 血" },
  { id: "A13", name: "赌徒酒窖", kind: "下注", text: "本手奖池每满 40，所有人攻 +1" },
  { id: "A14", name: "石柱庭院", kind: "形状", text: "每人开战获得一层屏障" },
  { id: "A15", name: "锈蚀检修库", kind: "形状", text: "第 2、4 轮轮末，所有人护甲 -1（最低 0，装备给的不受影响）" },
  { id: "A16", name: "镜面冷库", kind: "形状", text: "开战时各方攻最高的人获得一层屏障" },
  { id: "A17", name: "渗血祭台", kind: "逆转", text: "每人第一次健康度降到 50% 以下时，获得一层屏障" },
  { id: "A18", name: "余光站台", kind: "逆转", text: "每队第一个倒下的人，给其余队友各一层屏障" },
  { id: "A19", name: "陋巷", kind: "逆转", text: "开战时各方血最低的人物 +2/+3" },
  { id: "A20", name: "高塔倾覆", kind: "逆转", text: "开战时各方攻最高的人物，本场攻 -3" },
  { id: "A21", name: "暗巷", kind: "逆转", text: "第 1 轮只有各方血最低的人出手" },
  { id: "A22", name: "均摊之厅", kind: "逆转", text: "开战时，每方所有人的血改为本方平均值" },
];

export const PUBLIC_EFFECTS: readonly PublicEffectDef[] = [
  { id: "P01", name: "碎盾节", kind: "防护与形状", text: "屏障被打破时，持有者下一次攻击 +3" },
  { id: "P02", name: "铁幕", kind: "防护与形状", text: "所有人护甲 +2" },
  { id: "P03", name: "裂甲", kind: "防护与形状", text: "单段打出至少 6 伤害时，目标护甲 -1（最低 0）" },
  { id: "P04", name: "穿心", kind: "防护与形状", text: "攻击健康度高于 75% 的目标时，无视其一半护甲" },
  { id: "P05", name: "脆弱屏障", kind: "防护与形状", text: "屏障挡下伤害后，持有者自己失去 1 血" },
  { id: "P06", name: "庇护潮", kind: "防护与形状", text: "第 2、4、6 轮开始时，各方健康度最低的人获得一层屏障" },
  { id: "P07", name: "余震", kind: "防护与形状", text: "攻击被屏障挡下时，攻击者对同一目标补 2 点伤害" },
  { id: "P08", name: "屏障回声", kind: "防护与形状", text: "每人第一次获得屏障时，其余队友各获得一层屏障（不连锁）" },
  { id: "P09", name: "深夜霜降", kind: "防护与形状", text: "第 2 轮起，每次攻击额外附带独立的一段 1 点伤害" },
  { id: "P10", name: "急行号", kind: "节奏", text: "第 1 轮所有人攻 +2" },
  { id: "P11", name: "连击节拍", kind: "节奏", text: "每人第 3、6 次攻击的伤害翻倍" },
  { id: "P12", name: "沉重后坐", kind: "节奏", text: "单段打出至少 8 伤害后，攻击者下一轮不出手" },
  { id: "P13", name: "返场时刻", kind: "节奏", text: "第 3 轮，攻击次数少于 2 次的人本轮攻击两次" },
  { id: "P14", name: "集火回响", kind: "节奏", text: "同一轮被两人以上攻击时，获得一层屏障（每人一次）" },
  { id: "P15", name: "重整", kind: "节奏", text: "每队第一个人倒下后，其余队友下一次攻击 +2" },
  { id: "P16", name: "对位决斗", kind: "节奏", text: "对位双方都活着时，互打伤害 +1" },
  { id: "P17", name: "狩猎窗口", kind: "节奏", text: "第一次把目标打到健康度 25% 以下后，下一次攻击它 +2" },
  { id: "P18", name: "终场冲刺", kind: "节奏", text: "第 4 轮起所有人攻 +1，吸血每次少回 1" },
  { id: "P19", name: "枯水", kind: "生命与资源", text: "吸血每次少回 1" },
  { id: "P20", name: "丰沛", kind: "生命与资源", text: "吸血溢出的部分变成一层屏障（最多 1 层）" },
  { id: "P21", name: "血泉", kind: "生命与资源", text: "每人每累计失去 5 血，回复 2 血" },
  { id: "P22", name: "燃命", kind: "生命与资源", text: "每人第 2、4、6 次攻击后自己失去 2 血，下一次攻击 +3" },
  { id: "P23", name: "背水", kind: "生命与资源", text: "健康度低于 30% 的人攻击 +25%（至少 +1）" },
  { id: "P24", name: "孤身余粮", kind: "生命与资源", text: "一方只剩一人时，它获得一层屏障，并在接下来 2 轮每轮回复 2 血" },
  { id: "P25", name: "疗愈震波", kind: "生命与资源", text: "每累计回复 4 血，对对位敌人造成 2 伤害" },
  { id: "P26", name: "中央聚光", kind: "阵位", text: "2 号位造成和受到的伤害都 +25%" },
  { id: "P27", name: "侧翼掩护", kind: "阵位", text: "1、3 号位第一次受到对方 2 号位的攻击时，伤害减半" },
  { id: "P28", name: "双翼传灯", kind: "阵位", text: "1、3 号位都活着时，一侧屏障被打破会给另一侧一层屏障（一次）" },
  { id: "P29", name: "开场审判", kind: "阵位", text: "开战时各方护甲最高的人受到 3 伤害（不经护甲）" },
  { id: "P30", name: "迟到的庇护", kind: "阵位", text: "第 2 轮开始时，还没掉过血的人获得一层屏障" },
  { id: "P31", name: "碎裂终章", kind: "阵位", text: "第 3 轮起，倒下的人对对位敌人造成 3 伤害" },
];

function indexById<T extends { id: string }>(items: readonly T[], label: string) {
  const map = new Map(items.map((x) => [x.id, x]));
  return (id: string): T => {
    const v = map.get(id);
    if (!v) throw new Error(`未知${label}：${id}`);
    return v;
  };
}

export const equipment = indexById(EQUIPMENT, "装备");
export const slotEffect = indexById(SLOT_EFFECTS, "槽位效果");
/** 装在人物身上的一张牌：装备（E..）或效果槽牌（FX..）。两者名字、说明、效果的结构一样。 */
export const gear = (id: string): EquipmentDef | SlotEffectDef => (id.startsWith("FX") ? slotEffect(id) : equipment(id));
export const rule = indexById(RULES, "胜利规则");
export const arena = indexById(ARENAS, "场地");
export const publicEffect = indexById(PUBLIC_EFFECTS, "公共效果");
