/**
 * 新手提示：每个阶段第一次轮到你时，在操作栏顶上说一句这一步要做什么。看过就不再出现。
 * 记在浏览器里；读写失败（无痕模式等）就当没看过，照常显示。
 */

export type TipKey =
  | "arena" | "place" | "peek" | "bet" | "operate" | "draft" | "vote" | "bid" | "marketPick" | "marketRemove" | "battle";

const TIPS: Record<TipKey, [string, string]> = {
  arena: ["选场地", "场地会改变整场战斗。筹码少的一方从两张里挑一张；一样多时由非庄家挑。"],
  place: ["布阵", "从 4 张手牌里拖 3 名到 1、2、3 号位，再点其中一名设为亮出——对手只看得到这一名。每人打对面同号位的敌人；剩下那张本手不上场。"],
  peek: ["窥视", "你的窥视者可以偷看对手一张暗牌，再决定要不要交换自己两名暗置人物的位置。对手不会知道。"],
  bet: ["下注", "和德州扑克一样：过牌、跟注、加注或弃牌。弃牌会输掉已经投入的筹码。第 1 轮下注后翻开胜利规则和公共效果。"],
  operate: ["操作", "可以付操作费，从 3 件装备里挑 1 件。装备装在谁身上，对手看得到。"],
  draft: ["挑装备", "先选一件装备，再点你场上的一名人物装给他。"],
  vote: ["公共效果表决", "公共效果要双方都同意才生效。双方暗投，投得不一样就进入暗标。"],
  bid: ["暗标", "双方暗中出价，出价高的一方决定公共效果生不生效，只付自己的出价。"],
  marketPick: ["市场", "每手打完，双方从市场挑一名人物放进牌池，输家先挑。挑了谁对手看得到。"],
  marketRemove: ["整理牌池", "可以从牌池里移除一名人物，让以后的发牌更集中。对手看不到你移除了谁。"],
  battle: ["战斗", "双方轮流出手，每人打同号位的敌人。每次攻击都是碰撞：被打的人会把自己的攻打回来。先达成胜利规则的一方赢下奖池。"],
};

const KEY = "sinsquad.tips.v1";

function load(): { seen: string[]; off: boolean } {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (v && Array.isArray(v.seen)) return { seen: v.seen, off: !!v.off };
  } catch { /* 读不到就当没看过 */ }
  return { seen: [], off: false };
}

let state = load();

function store() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* 存不了就算了，只影响下次 */ }
}

/** 这个阶段还没看过提示时，返回提示的 HTML；否则空串。 */
export function tipHtml(key: TipKey): string {
  if (state.off || state.seen.includes(key)) return "";
  const [title, text] = TIPS[key];
  return `<div class="tip" role="note">
    <span class="tip-mark">?</span>
    <div class="tip-body"><b>${title}</b>${text}</div>
    <div class="tip-actions">
      <button data-act="tipOk" data-arg="${key}" class="tip-ok">知道了</button>
      <button data-act="tipOff" class="tip-off">不再提示</button>
    </div>
  </div>`;
}

export function dismissTip(key: string) {
  if (!state.seen.includes(key)) state.seen.push(key);
  store();
}

export function disableTips() {
  state.off = true;
  store();
}

/** 规则页里“重新显示新手提示”。 */
export function resetTips() {
  state = { seen: [], off: false };
  store();
}
