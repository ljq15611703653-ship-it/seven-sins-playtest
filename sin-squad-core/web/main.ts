import { HeuristicAgent, type Style } from "../src/ai/agents.js";
import { splitMulti, type BattleEvent, type BattleResult } from "../src/battle/engine.js";
import type { UnitSnapshot } from "../src/battle/unit.js";
import { CHARACTERS, character } from "../src/content/characters.js";
import { ARENAS, EQUIPMENT, PUBLIC_EFFECTS, RULES, SLOT_EFFECTS, arena, gear, publicEffect, rule } from "../src/content/tables.js";
import type { Action } from "../src/game/actions.js";
import { Table, validatePlacement, type Placement, type TableRig } from "../src/game/table.js";
import { legalActions, observe, type Observation } from "../src/game/view.js";
import type { AttackShape, Seat } from "../src/types.js";
import {
  AI, CARD_TEXT, HOW_TO_PLAY, HUMAN, REASON_TEXT, SIN_COLOR, battleLine, esc, logLine, num, posName, shapeName,
} from "./text.js";
import { Gate, type Opening, type SaveInfo } from "./intro.js";
import { morph } from "./morph.js";
import {
  bubble as hudBubble, collect, crumble, discoverExit, flip, floater as hudFloater, laneShift, measure, pulse, reducedMotion, shake, shatter, strike, type Snapshot,
} from "./motion.js";
import { isMuted, setScene, toggleMuted } from "./music.js";
import { SIN_LATIN, installSigil } from "./sigil.js";
import { installTilt } from "./tilt.js";
import { disableTips, dismissTip, resetTips, tipHtml } from "./tips.js";

/**
 * 网页 demo：你（座位 0）对电脑（座位 1）。
 * 规则全部由核心驱动；这里只负责显示、收集点击、控制电脑出手的节奏和战斗动画。
 *
 * 画面是一张固定在一屏里的牌桌：上面对手，中间桌面（场地 / 规则 / 公共效果、奖池），下面我方，
 * 最底下是操作栏。战斗直接在桌面上演。
 *
 * 每次状态变化都重新生成整页 HTML，但不是整页替换：morph 只改变化的部分，带 data-key 的牌是持久的元素，
 * 换位置时滑过去、翻面时真的翻过去、出手时冲出去再落回来。桌面用 CSS 3D 斜放。
 */

// ───────────────────────── 状态 ─────────────────────────

interface Playback {
  result: BattleResult;
  teams: [Placement, Placement];
  equipment: [(string | null)[], (string | null)[]];
  ruleId: string;
  arenaId: string;
  peId: string | null;
  /** 画面上此刻显示的双方样子。 */
  snap: [UnitSnapshot[], UnitSnapshot[]];
  /** 当前播到第几轮（0 = 开战前）。 */
  round: number;
  /** 正在出手的人（seat-pos），高亮用。 */
  actor: string | null;
  started: boolean;
  paused: boolean;
  speed: 1 | 2;
  caption: string[];
  done: boolean;
  /** 转线中、还没出手的人（seat-pos → 往哪边转：-1 左、1 右）。 */
  switching: Map<string, number>;
}

type Sheet =
  | { kind: "help" }
  | { kind: "card"; id: string; equip: string[] }
  | { kind: "env"; which: "arena" | "rule" | "pe" }
  | { kind: "log" }
  | { kind: "pool" }
  | { kind: "debug" };

interface Ui {
  /** 布阵：slots[i] = 放在 i 号位的发牌序号。 */
  place: { slots: (number | null)[]; reveal: number | null; eaten: number | null };
  betAmount: number | null;
  draft: { offer: number | null; pos: number | null };
  bid: number;
  removeIdx: number | null;
  notice: { text: string; good: boolean | null } | null;
  error: string | null;
  battle: Playback | null;
  sheet: Sheet | null;
  helpTab: "play" | "chars" | "rules" | "arenas" | "effects" | "equip";
  /** 本手打完的战斗（市场阶段继续在桌上摆出双方最后的样子）。 */
  lastBattle: { hand: number; result: BattleResult; teams: [Placement, Placement]; equipment: [(string | null)[], (string | null)[]] } | null;
}

/** 有立绘的人物（打包时由 scripts/build-web.mjs 根据 web/art/ 填入）。 */
declare const __ART_IDS__: string[];
const ART = new Set<string>(typeof __ART_IDS__ === "undefined" ? [] : __ART_IDS__);

/** 场地 / 胜利规则 / 公共效果的插画（和立绘放在同一个目录，按编号命名）。 */
const artUrl = (id: string | null | undefined) => (id && ART.has(id) ? `art/${id}.webp` : null);
const artStyle = (id: string | null | undefined) => (artUrl(id) ? ` style="--art:url('${artUrl(id)}')"` : "");

const STYLE_NAME: Record<Style, string> = { cautious: "谨慎", aggressive: "激进", bluff: "爱诈唬" };

let table: Table | null = null;
let agent: HeuristicAgent;
let style: Style = "cautious";
let seed = 0;
let logLines: string[] = [];
let logCursor = 0;
let aiTimer: number | null = null;
let battleToken = 0;
/** 胜利规则 / 公共效果刚翻开时的揭晓卡（画在牌桌外面单独一层，重画牌桌不影响它的动画）。 */
let revealTimer: number | null = null;
const revealLayer = document.createElement("div");
revealLayer.id = "reveal";
document.body.appendChild(revealLayer);

/**
 * 翻开时：两张有厚度的大牌从桌面上立起来、在空中翻到正面；点一下（或几秒后）飞回桌上对应的那块长条牌，落下时那块牌震一下。
 */
function showReveal(ruleId: string, peId: string | null) {
  const r = rule(ruleId);
  const pe = peId ? publicEffect(peId) : null;
  const hand = table?.hand.no ?? 0;
  const face = (label: string, which: string, id: string, name: string, sub: string, text: string, i: number) => `
    <div class="card rv" data-target="h${hand}-env-${which}" style="--i:${i}">
      <div class="lift"><div class="flip">
        <i class="edge top"></i><i class="edge bottom"></i><i class="edge left"></i><i class="edge right"></i>
        <div class="face front">
          <div class="reveal-art"${artStyle(id)}></div>
          <div class="reveal-body"><span class="reveal-label">${label}</span><b>${name}</b><small>${sub}</small><p>${text}</p></div>
        </div>
        <div class="face back"></div>
      </div></div>
    </div>`;
  revealLeaving = false;
  revealLayer.innerHTML = `<div class="reveal-pop" role="dialog" aria-label="规则揭晓">
    <div class="reveal-title">翻开<small>REVELATIO</small></div>
    <div class="reveal-cards">
      ${face("胜利规则", "rule", r.id, r.name, `${r.family} · 最多 ${r.maxRounds} 轮`, r.text, 0)}
      ${pe ? face("公共效果", "pe", pe.id, pe.name, `${pe.kind} · 双方表决要不要生效`, pe.text, 1) : ""}
    </div>
    <small class="reveal-hint">点一下继续</small>
  </div>`;
  if (!reducedMotion()) {
    revealLayer.querySelectorAll<HTMLElement>(".card.rv").forEach((el, i) => {
      const t = { duration: 900, delay: 120 + i * 260, fill: "backwards" as const };
      // 从桌面上立起来（平躺、很小、在下方）→ 冲过头一点 → 停在眼前
      el.animate([
        { transform: "translateY(42vh) rotateX(64deg) scale(.42)" },
        { transform: "translateY(-22px) rotateX(-6deg) scale(1.05)", offset: 0.7 },
        { transform: "none" },
      ], { ...t, easing: "cubic-bezier(.2,.7,.3,1)" });
      // 起来的途中从背面翻到正面
      el.querySelector(".flip")?.animate([
        { transform: "rotateY(180deg)" },
        { transform: "rotateY(180deg)", offset: 0.22 },
        { transform: "rotateY(-12deg)", offset: 0.8 },
        { transform: "rotateY(0deg)" },
      ], { ...t, easing: "ease-in-out" });
    });
  }
  if (revealTimer !== null) clearTimeout(revealTimer);
  revealTimer = window.setTimeout(hideReveal, 4600);
}

let revealLeaving = false;
function hideReveal() {
  if (revealTimer !== null) clearTimeout(revealTimer);
  revealTimer = null;
  if (!revealLayer.innerHTML || revealLeaving) return;
  const done = () => {
    revealLeaving = false;
    revealLayer.innerHTML = "";
    scheduleAi();
  };
  const cards = [...revealLayer.querySelectorAll<HTMLElement>(".card.rv")];
  if (reducedMotion() || !cards.length) return done();
  revealLeaving = true;
  revealLayer.querySelector(".reveal-pop")?.classList.add("leaving");
  const tilt = parseFloat(getComputedStyle(app).getPropertyValue("--tilt")) || 0;
  const flights = cards.map((el, i) => {
    el.getAnimations().forEach((x) => x.finish());
    const tile = app.querySelector<HTMLElement>(`[data-key="${el.dataset.target}"]`);
    const a = el.getBoundingClientRect();
    const b = tile?.getBoundingClientRect();
    const opts = { duration: 560, delay: i * 90, easing: "cubic-bezier(.5,0,.3,1)", fill: "forwards" as const };
    if (!b || !b.width) {
      return el.animate([{ transform: "none" }, { transform: "translateY(30vh) scale(.4)", visibility: "hidden" }], opts).finished;
    }
    // 缩到桌上那块牌的大小、按桌面的倾斜躺下去，落在它上面
    const k = Math.min(b.width / a.width, b.height / a.height) * 1.15;
    const dx = b.left + b.width / 2 - (a.left + a.width / 2);
    const dy = b.top + b.height / 2 - (a.top + a.height / 2);
    return el.animate([
      { transform: "none" },
      { transform: `translate(${dx * 0.55}px, ${dy * 0.45}px) translateZ(60px) rotateX(${tilt * 0.5}deg) scale(${(k + 1) / 2})`, offset: 0.55 },
      { transform: `translate(${dx}px, ${dy}px) rotateX(${tilt + 40}deg) scale(${k})`, visibility: "hidden" },
    ], opts).finished.then(() => { if (tile) pulse(tile, "fx-proc", 900); });
  });
  Promise.all(flights).then(done, done);
}
revealLayer.addEventListener("click", hideReveal);

/** 本桌双方做过的每一步（存档用：同一个种子照着重放就回到原样）。 */
let record: Array<[Seat, Action]> = [];
/** 这次打开页面后亲眼看过战斗动画的那一手（种子-手数）；读档摆出来的战斗不算，不放胜负曲。 */
let watchedBattle: string | null = null;

const ui: Ui = {
  place: { slots: [null, null, null], reveal: null, eaten: null },
  betAmount: null,
  draft: { offer: null, pos: null },
  bid: 0,
  removeIdx: null,
  notice: null,
  error: null,
  battle: null,
  sheet: null,
  helpTab: "play",
  lastBattle: null,
};

const app = document.getElementById("app")!;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function resetInputs() {
  ui.place = { slots: [null, null, null], reveal: null, eaten: null };
  ui.betAmount = null;
  ui.draft = { offer: null, pos: null };
  ui.bid = 0;
  ui.removeIdx = null;
  ui.error = null;
}

// ───────────────────────── 调试模式 ─────────────────────────
//
// 网址加 ?debug 打开，例如：?debug&me=EN1,GL2,PR3,WR3&foe=LU1&rule=V02&arena=A08,A02&pe=P10&dealer=foe&seed=42&ai=bluff
//   me / foe   每手固定发给你 / 电脑的人物（最多 4 名，不够的随机补）
//   rule / pe  固定胜利规则 / 公共效果；arena 固定两张候选场地；market 固定市场
//   dealer     第一手谁坐庄（me / foe）；seed 固定随机种子；ai 电脑风格

interface DebugConfig { rig: TableRig; seed: number | null; style: Style | null }

function parseDebug(search: string): DebugConfig | null {
  const q = new URLSearchParams(search);
  if (!q.has("debug")) return null;
  const list = (k: string) => q.get(k)?.split(",").map((x) => x.trim().toUpperCase()).filter(Boolean);
  const rig: TableRig = {};
  const me = list("me");
  const foe = list("foe");
  if (me || foe) rig.deal = [me ?? null, foe ?? null];
  if (q.get("rule")) rig.ruleId = q.get("rule")!.toUpperCase();
  if (q.get("pe")) rig.publicEffectId = q.get("pe")!.toUpperCase();
  const arenas = list("arena");
  if (arenas) rig.arenaOptions = [arenas[0], arenas[1] ?? arenas[0]];
  if (list("market")) rig.market = list("market");
  if (q.get("dealer")) rig.dealer = q.get("dealer") === "foe" ? AI : HUMAN;
  const ai = q.get("ai");
  return {
    rig,
    seed: q.get("seed") ? Number(q.get("seed")) : null,
    style: ai === "cautious" || ai === "aggressive" || ai === "bluff" ? ai : null,
  };
}

let debug = parseDebug(location.search);
/** 调试面板里输入的参数（不带 ?debug）。 */
let debugText = location.search.replace(/^\?/, "").replace(/(^|&)debug(=[^&]*)?/, "").replace(/^&/, "");

function newTable(s: Style) {
  initTable(s, debug?.seed ?? Math.floor(Math.random() * 1e9));
  saveGame();
  afterApply();
}

/** 按种子开桌（新开或读档），不推进、不重画。 */
function initTable(s: Style, tableSeed: number) {
  if (aiTimer !== null) clearTimeout(aiTimer);
  aiTimer = null;
  battleToken++;
  style = s;
  seed = tableSeed;
  record = [];
  try {
    table = new Table({ seed, rig: debug?.rig });
  } catch (err) {
    // 调试参数写错了：提示出来，照常开一桌
    alert(`调试参数有误：${err instanceof Error ? err.message : String(err)}`);
    debug = null;
    table = new Table({ seed });
  }
  agent = new HeuristicAgent(style, seed + 1);
  logLines = [];
  logCursor = 0;
  ui.battle = null;
  ui.notice = null;
  ui.lastBattle = null;
  ui.sheet = null;
  resetInputs();
}

// ───────────────────────── 存档 ─────────────────────────
//
// 牌桌完全由种子决定，所以只存种子、电脑风格、调试固定项和双方的每一步；读档时照着重放。

const SAVE_KEY = "sinsquad.save.v1";
interface SaveData { seed: number; style: Style; rig: TableRig | null; debugText: string; actions: Array<[Seat, Action]> }

function saveGame() {
  try {
    if (!table || table.phase === "over") localStorage.removeItem(SAVE_KEY);
    else localStorage.setItem(SAVE_KEY, JSON.stringify({ seed, style, rig: debug?.rig ?? null, debugText, actions: record } satisfies SaveData));
  } catch { /* 存不了就算了：只是下次不能继续 */ }
}

function readSave(): SaveData | null {
  try {
    const v = JSON.parse(localStorage.getItem(SAVE_KEY) ?? "null") as SaveData | null;
    return v && typeof v.seed === "number" && Array.isArray(v.actions) ? v : null;
  } catch {
    return null;
  }
}

/** 读档：重开同一张桌，把记录的每一步照做一遍（电脑那边也照样“想”一遍，让它的随机数接得上）。 */
function resumeGame(): boolean {
  const sv = readSave();
  if (!sv) return false;
  debug = sv.rig ? { rig: sv.rig, seed: sv.seed, style: sv.style } : null;
  debugText = sv.debugText ?? "";
  try {
    initTable(sv.style, sv.seed);
    for (const [seat, a] of sv.actions) {
      if (seat === AI) agent.act(table!, AI);
      table!.apply(seat, a);
      record.push([seat, a]);
    }
  } catch (err) {
    // 规则改过、存档对不上了：丢掉存档
    console.error(err);
    try { localStorage.removeItem(SAVE_KEY); } catch { /* 无所谓 */ }
    table = null;
    return false;
  }
  consumeLog(false);
  render();
  scheduleAi();
  return true;
}

function saveInfo(): SaveInfo | null {
  const sv = readSave();
  if (!sv) return null;
  // 只为了显示“第几手、多少筹码”，在一张临时桌上重放
  try {
    const t = new Table({ seed: sv.seed, rig: sv.rig ?? undefined });
    for (const [seat, a] of sv.actions) t.apply(seat, a);
    if (t.phase === "over") return null;
    return { handNo: t.handNo, stacks: [t.stacks[0], t.stacks[1]], style: sv.style };
  } catch {
    return null;
  }
}

/** 双方提交动作都走这里：记下来、存档。 */
function applyAction(seat: Seat, action: Action) {
  table!.apply(seat, action);
  record.push([seat, action]);
  saveGame();
}

// ───────────────────────── 推进 ─────────────────────────

/** 每次有人提交动作后：读新增的牌桌记录，必要时开始战斗动画，然后重画并安排电脑。 */
function afterApply() {
  const pending = consumeLog(true);
  // 全押直接开打时不弹揭晓卡，免得挡住战斗
  if (pending.reveal && !ui.battle) showReveal(pending.reveal.ruleId, pending.reveal.publicEffectId);
  render();
  if (ui.battle && !ui.battle.started) { ui.battle.started = true; void playBattle(ui.battle); }
  scheduleAi();
}

/** 读新增的牌桌记录。play = false 时（读档）不播战斗，只把最后的样子摆在桌上。 */
function consumeLog(play: boolean): { reveal: { ruleId: string; publicEffectId: string | null } | null } {
  const t = table!;
  let reveal: { ruleId: string; publicEffectId: string | null } | null = null;
  const fresh = t.log.slice(logCursor);
  logCursor = t.log.length;
  for (const e of fresh) {
    const line = logLine(e);
    if (line) logLines.push(line);
    if (e.type === "reveal" && play) reveal = { ruleId: e.ruleId, publicEffectId: e.publicEffectId };
    if (e.type === "marketPick") lastPick = { seat: e.seat, id: e.characterId };
    if (e.type === "handStart") {
      ui.notice = null;
      ui.lastBattle = null;
      resetInputs();
    }
    if (e.type === "battle" && t.hand.battle) {
      const h = t.hand;
      ui.lastBattle = { hand: h.no, result: h.battle!, teams: e.teams, equipment: e.equipment };
      if (play) watchedBattle = `${seed}-${h.no}`;
      if (play) ui.battle = {
        result: h.battle!, teams: e.teams, equipment: e.equipment,
        ruleId: h.ruleId, arenaId: h.arenaId!, peId: h.peActive ? h.publicEffectId : null,
        snap: h.battle!.start, round: 0, actor: null, started: false,
        paused: false, speed: 1, caption: ["揭开双方队伍"], done: false, switching: new Map(),
      };
    }
    if (e.type === "settle") {
      const pot = e.pot;
      if (t.hand.outcome?.by === "fold") {
        ui.notice = e.winner === HUMAN ? { text: `对手弃牌 · 你拿下奖池 ${pot}`, good: true } : { text: `你弃牌 · 对手拿下奖池 ${pot}`, good: false };
      } else {
        ui.notice = e.winner === null ? { text: "平局 · 双方拿回投入", good: null }
          : e.winner === HUMAN ? { text: `你赢下战斗 · 拿下奖池 ${pot}`, good: true } : { text: `对手赢下战斗 · 拿走奖池 ${pot}`, good: false };
      }
    }
  }
  return { reveal };
}

function scheduleAi() {
  const t = table;
  if (!t || aiTimer !== null || ui.battle || gate.open || revealTimer !== null || t.phase === "over") return;
  if (!t.toAct().includes(AI)) return;
  const delay = t.phase === "bet" ? 800 : t.phase === "place" ? 700 : 500;
  aiTimer = window.setTimeout(() => {
    aiTimer = null;
    if (ui.battle || gate.open || revealTimer !== null || !t.toAct().includes(AI) || t !== table) return;
    try {
      applyAction(AI, agent.act(t, AI));
    } catch (err) {
      // 电脑出错时退回第一个合法动作，保证牌桌能继续
      console.error(err);
      applyAction(AI, legalActions(t, AI)[0]);
    }
    afterApply();
  }, delay);
}

function act(action: Action) {
  try {
    applyAction(HUMAN, action);
  } catch (err) {
    ui.error = err instanceof Error ? err.message : String(err);
    render();
    return;
  }
  resetInputs();
  afterApply();
}

// ───────────────────────── 战斗动画 ─────────────────────────

const unitEl = (seat: Seat, pos: number) => app.querySelector<HTMLElement>(`[data-unit="${seat}-${pos}"]`);
const stageEl = () => app.querySelector<HTMLElement>(".stage");

function floater(seat: Seat, pos: number, text: string, cls: string, delay = 0) {
  hudFloater(unitEl(seat, pos), text, cls, delay);
}

function unitNames(b: Playback) {
  return (seat: Seat, pos: number) => {
    const id = b.result.start[seat][pos].characterId;
    return id ? character(id).name : "空位";
  };
}

/** 一帧的字幕：出手、反击、屏障、转线、能力生效、倒下。 */
function frameCaption(b: Playback, evs: BattleEvent[]): string[] {
  const names = unitNames(b);
  const shown = evs.filter((e) => ["attack", "recoil", "blocked", "switch", "trigger", "death", "note"].includes(e.type));
  return shown.map((e) => battleLine(e, names));
}

/** 能力 / 场地 / 公共效果生效：卡片抬起闪一下，头上冒出说明气泡。 */
function bubble(e: Extract<BattleEvent, { type: "trigger" }>, own: boolean) {
  const el = unitEl(e.seat, e.pos);
  if (!el) return;
  pulse(el, "fx-proc", 900);
  hudBubble(el, own ? esc(e.text) : `<small>${esc(e.name)}</small>${esc(e.text)}`, !own, e.seat === AI);
}

/**
 * 转线往哪边：往后找这个人下一次出手打的是谁（引擎在出手那一刻才选目标，血量到时可能已经变了，所以不能现在猜）。
 * 转线之后没再出手（战斗先结束、先倒下）就退回猜法：敌方活着的人里血最少的那一个。
 */
function laneDir(b: Playback, seat: Seat, pos: number, frame: number): number {
  for (const f of b.result.frames.slice(frame + 1)) {
    const hit = f.events.find((e) => e.type === "attack" && e.seat === seat && e.pos === pos);
    if (hit?.type === "attack" && hit.targetPos !== pos) return Math.sign(hit.targetPos - pos);
    if (f.events.some((e) => e.type === "death" && e.seat === seat && e.pos === pos)) break;
  }
  const foes = b.snap[seat === HUMAN ? AI : HUMAN].filter((u) => u.alive && u.characterId);
  if (!foes.length) return pos === 0 ? 1 : -1;
  const t = foes.reduce((best, u) => (u.hp < best.hp ? u : best));
  return t.pos === pos ? (pos === 0 ? 1 : -1) : Math.sign(t.pos - pos);
}

/** 第 r 轮谁先手。 */
function firstOf(b: Playback, r: number): Seat {
  return r % 2 === 1 ? b.result.first : (b.result.first === 0 ? 1 : 0);
}

/**
 * 逐帧播放：每一帧是一次出手（或轮初、轮末的效果）。
 * 出手的人先抬起来，冲向目标；撞上的一刻双方受击、屏障碎裂、震屏，同时换成这一帧结束时的样子、飘伤害数字；
 * 最后播结算后才生效的能力。
 */
async function playBattle(b: Playback) {
  const token = ++battleToken;
  const alive = () => token === battleToken && ui.battle === b;
  const wait = async (ms: number) => {
    await sleep(ms / b.speed);
    while (alive() && b.paused) await sleep(100);
  };
  const names = unitNames(b);
  const isOwn = (e: Extract<BattleEvent, { type: "trigger" }>) => names(e.seat, e.pos) === e.name;
  render();
  await wait(1000); // 翻牌

  for (const [fi, f] of b.result.frames.entries()) {
    if (!alive()) return;
    const setup = f.round === 0;
    if (f.round !== b.round) {
      b.round = f.round;
      if (!setup) {
        b.caption = [`第 ${f.round} 轮 · ${firstOf(b, f.round) === HUMAN ? "你" : "对手"}先手`];
        b.actor = null;
        render();
        await wait(650);
      }
    }
    const attack = f.events.find((e) => e.type === "attack" || e.type === "switch");
    b.actor = attack ? `${attack.seat}-${attack.pos}` : null;
    b.caption = [setup ? "开战" : `第 ${f.round} 轮`, ...frameCaption(b, f.events)];
    render();

    const firstHit = f.events.findIndex((e) => e.type === "damage" || e.type === "death" || e.type === "heal");
    const cut = firstHit < 0 ? f.events.length : firstHit;
    let struck = false;
    for (const e of f.events.slice(0, cut)) {
      if (!alive()) return;
      if (e.type === "trigger") {
        bubble(e, isOwn(e));
        if (!struck) await wait(setup ? 850 : 380);
      }
      if (e.type === "attack") {
        // 转过线的人出手时回到自己的位置再冲出去
        if (b.switching.delete(`${e.seat}-${e.pos}`)) render();
        // 抬起 → 蓄力 → 冲过去；await 在撞上的那一刻返回
        await strike(unitEl(e.seat, e.pos), unitEl(e.targetSeat, e.targetPos), 680 / b.speed);
        if (!alive()) return;
        struck = true;
        pulse(unitEl(e.targetSeat, e.targetPos), "fx-hit", 500);
      }
      if (e.type === "recoil") {
        // 碰撞：被打的人顶回去
        void strike(unitEl(e.seat, e.pos), unitEl(e.targetSeat, e.targetPos), 300 / b.speed, 0.14, true);
        pulse(unitEl(e.targetSeat, e.targetPos), "fx-hit", 500);
        floater(e.seat, e.pos, "反击", "recoil");
      }
      if (e.type === "blocked") {
        shatter(unitEl(e.seat, e.pos));
        floater(e.seat, e.pos, "屏障破碎", "block");
      }
      if (e.type === "switch") {
        // 对位倒下：侧身滑向要去打的那一边（敌方血最少的人），停在偏出去的位置，直到出手
        const dir = laneDir(b, e.seat, e.pos, fi);
        b.switching.set(`${e.seat}-${e.pos}`, dir);
        render();
        laneShift(unitEl(e.seat, e.pos), dir, 650 / b.speed, e.seat === AI ? -1 : 1);
        floater(e.seat, e.pos, dir < 0 ? "← 转线" : "转线 →", "switch");
        await wait(650);
      }
      if (e.type === "note") await wait(600);
    }
    if (!alive()) return;

    // 换成这一帧结束时的样子，再飘数字、震屏
    b.snap = f.after;
    render();
    const dmg = new Map<string, number>();
    for (const e of f.events) {
      if (e.type === "damage") dmg.set(`${e.seat}-${e.pos}`, (dmg.get(`${e.seat}-${e.pos}`) ?? 0) + e.amount);
    }
    let total = 0;
    for (const [k, v] of dmg) {
      const [s, p] = k.split("-").map(Number);
      floater(s as Seat, p, `-${num(v)}`, "dmg");
      if (!struck) pulse(unitEl(s as Seat, p), "fx-hit", 500);
      total = Math.max(total, v);
    }
    const deaths = f.events.filter((e) => e.type === "death");
    for (const e of f.events) {
      if (e.type === "heal") floater(e.seat, e.pos, `+${num(e.amount)}`, "heal", 250);
      if (e.type === "death") {
        b.switching.delete(`${e.seat}-${e.pos}`);
        pulse(unitEl(e.seat, e.pos), "fx-dying", 1100);
        crumble(unitEl(e.seat, e.pos));
      }
    }
    if (total > 0 || deaths.length) shake(stageEl(), deaths.length ? 2 : Math.min(1.6, 0.5 + total / 5));
    const after = f.events.slice(cut).filter((e): e is Extract<BattleEvent, { type: "trigger" }> => e.type === "trigger");
    await wait(dmg.size ? 650 : 300);
    for (const e of after) {
      if (!alive()) return;
      bubble(e, isOwn(e));
      await wait(500);
    }
    if (f.events.some((e) => e.type === "death")) await wait(400);
  }
  if (!alive()) return;
  b.actor = null;
  b.done = true;
  render();
}

function skipBattle() {
  const b = ui.battle;
  if (!b) return;
  battleToken++;
  b.snap = b.result.final;
  b.round = b.result.rounds;
  b.actor = null;
  b.switching.clear();
  const last = b.result.frames.at(-1);
  b.caption = [`第 ${b.round} 轮`, ...(last ? frameCaption(b, last.events) : [])];
  b.done = true;
  render();
}

function closeBattle() {
  battleToken++;
  ui.battle = null;
  render();
  scheduleAi();
}

// ───────────────────────── 卡牌 ─────────────────────────

interface Body {
  atk: number;
  hp: number;
  startHp: number;
  shape: AttackShape;
  armor: number;
  barrier: number;
}

/**
 * 卡面数值：人物面板 + 身上的装备和效果槽牌（和战斗引擎的结算一致）。开战时的能力加成要等战斗里才看得到。
 */
function bodyOf(id: string, gearIds: string[]): Body {
  const c = character(id);
  const b: Body = { atk: c.atk, hp: c.hp, startHp: c.hp, shape: c.shape, armor: c.armor, barrier: c.barrier };
  for (const g of gearIds) {
    const e = gear(g).effect;
    switch (e.kind) {
      case "stat": b.atk += e.atk; b.hp += e.hp; break;
      case "shape": b.shape = e.shape; b.atk += e.atk; break;
      case "armor": b.armor += e.armor; b.hp += e.hp; break;
      case "barrier": b.barrier = Math.min(2, b.barrier + e.barrier); b.atk += e.atk; break;
    }
  }
  b.startHp = b.hp;
  return b;
}

/** 某个位置身上的牌：装备一件 + 效果槽牌一张（都可能没有）。 */
const gearAt = (equipment: (string | null)[], effects: (string | null)[], pos: number) =>
  [equipment[pos], effects[pos]].filter((x): x is string => !!x);

interface CardOpts {
  /** 身上的装备和效果槽牌（战斗中夺装者可能让一人带更多）。 */
  equipList?: string[];
  body?: Body;
  dead?: boolean;
  flag?: string;
  cls?: string;
  act?: string;
  arg?: string | number;
  unit?: string;
  /** 持久元素的 key：同一张牌在各次重画之间是同一个元素（换位置滑过去、翻面真的翻）。 */
  key?: string | null;
  /** 背面朝上。 */
  down?: boolean;
  /** 背面上的说明文字。 */
  backText?: string;
  /** 正在出手：抬起来。 */
  acting?: boolean;
  /** 手牌扇形里的位置（相对中间，可以是小数）。 */
  fan?: number;
  /** 翻面延迟（毫秒），几张牌依次翻开。 */
  flipDelay?: number;
  /** 转线中：往哪边偏（-1 左、1 右）。 */
  lane?: number;
  /** 可以拖动：hand:发牌序号 / slot:位置。 */
  drag?: string;
  /** 可以放下：hand / slot:位置。 */
  drop?: string;
}

function attrs(o: { act?: string; arg?: string | number; drag?: string; drop?: string }) {
  const dnd = (o.drag ? ` data-drag="${o.drag}"` : "") + (o.drop ? ` data-drop="${o.drop}"` : "");
  return dnd + (o.act ? ` data-act="${o.act}"${o.arg !== undefined ? ` data-arg="${o.arg}"` : ""} role="button" tabindex="0"` : "");
}

/** 连击直接写出两段各打多少，比如“连击 1+2”。 */
function shapeLabel(shape: AttackShape, atk: number): string {
  return shape === "multi" ? `${shapeName(shape)} ${splitMulti(Math.max(0, atk)).join("+")}` : shapeName(shape);
}

/** 卡面底栏用：小卡上连击只写分段（“1+2”），名字可以藏起来。 */
function shapeTag(shape: AttackShape, atk: number): string {
  return shape === "multi"
    ? `<i class="shape-name">${shapeName(shape)} </i>${splitMulti(Math.max(0, atk)).join("+")}`
    : shapeName(shape);
}

/** 正面：立绘窗、名牌、能力、底栏（攻 · 攻击形状 · 血），护甲和屏障是立绘左上角的小标。 */
function cardFront(id: string, o: CardOpts) {
  const c = character(id);
  const ids = o.equipList ?? [];
  const b = o.body ?? bodyOf(id, ids);
  const atkCls = b.atk > c.atk ? "up" : b.atk < c.atk ? "down" : "";
  const hpCls = b.hp < b.startHp ? "hurt" : b.hp > c.hp ? "up" : "";
  const eqs = ids.map((x) => gear(x));
  const defs = (b.armor ? `<span class="def armor" title="护甲 ${b.armor}">${b.armor}</span>` : "") +
    (b.barrier ? `<span class="def barrier" title="屏障 ${b.barrier}">${b.barrier}</span>` : "");
  return `<div class="art ${ART.has(id) ? "has-portrait" : ""}"><span class="glyph">${SIN_LATIN[c.sin]}</span>${ART.has(id) ? `<img class="portrait" src="art/${id}.webp" alt="" draggable="false">` : ""}
      ${defs ? `<div class="defs">${defs}</div>` : ""}
      ${eqs.length ? `<div class="equip" title="${esc(eqs.map((e) => `${e.name}：${e.text}`).join("；"))}">${eqs.map((e) => e.name).join("、")}</div>` : ""}
    </div>
    <div class="plate"><span>${c.name}</span></div>
    <div class="text">${CARD_TEXT[id] ?? esc(c.ability)}</div>
    <div class="stats">
      <span class="stat atk ${atkCls}" title="攻">${num(b.atk)}</span>
      <span class="shape ${b.shape}" title="${shapeLabel(b.shape, b.atk)}">${shapeTag(b.shape, b.atk)}</span>
      <span class="stat hp ${hpCls}" title="血">${num(Math.max(0, b.hp))}</span>
    </div>
    ${o.dead ? `<span class="dead-mark">倒下</span>` : ""}
    <button class="info-btn" data-act="inspect" data-arg="${id}|${ids.join("+")}" aria-label="查看${c.name}">?</button>`;
}

/**
 * 一张牌：外层负责在桌上的位置（滑动、冲撞），shade 是落在桌面上的影子，
 * lift 负责抬起 / 扇形 / 悬停，flip 负责翻面。flip 里是一块有厚度的长方形：正反两面隔着牌的厚度，四条鎏金侧边围起来。
 * id 为 null 是看不到正面的暗牌。
 */
function card(id: string | null, o: CardOpts = {}) {
  const c = id ? character(id) : null;
  const down = o.down ?? !id;
  const b = id ? (o.body ?? bodyOf(id, o.equipList ?? [])) : null;
  const eqs = (o.equipList ?? []).map((x) => gear(x));
  const style = [
    c ? `--sin:${SIN_COLOR[c.sin]}` : "", o.fan !== undefined ? `--fan:${o.fan}` : "", o.flipDelay ? `--flip-delay:${o.flipDelay}ms` : "",
    o.lane ? `--lane:${o.lane}` : "",
  ].filter(Boolean).join(";");
  const cls = [
    "card", o.cls ?? "", down ? "down" : "", o.dead ? "dead" : "", o.act ? "clickable" : "", b?.barrier && !down ? "shielded" : "",
    o.fan !== undefined ? "fanned" : "", o.lane ? "switching" : "",
  ].filter(Boolean).join(" ");
  return `<div class="${cls}"${style ? ` style="${style}"` : ""}${o.key ? ` data-key="${o.key}"` : ""}${o.unit ? ` data-unit="${o.unit}"` : ""}${o.acting ? " data-acting" : ""}${attrs(o)}${c && !down ? ` title="${esc(`${c.name}（${c.sin}）：${c.ability}`)}"` : ""}>
    <div class="shade"></div>
    <div class="lift"><div class="flip">
      <i class="edge top"></i><i class="edge bottom"></i><i class="edge left"></i><i class="edge right"></i>
      <div class="face front">${id ? cardFront(id, o) : ""}</div>
      <div class="face back">${o.backText ? `<div class="back-text">${o.backText}</div>` : ""}${eqs.length ? `<div class="equip" title="${esc(eqs.map((e) => `${e.name}：${e.text}`).join("；"))}">${eqs.map((e) => e.name).join("、")}</div>` : ""}</div>
    </div>${o.flag ? `<span class="flag">${o.flag}</span>` : ""}${o.lane ? `<span class="lane-tag">${o.lane < 0 ? "← 转线" : "转线 →"}</span>` : ""}</div>
  </div>`;
}

function slot(text: string, o: CardOpts = {}) {
  return `<div class="card slot ${o.cls ?? ""} ${o.act ? "clickable" : ""}"${o.key ? ` data-key="${o.key}"` : ""}${o.unit ? ` data-unit="${o.unit}"` : ""}${attrs(o)}><span>${text}</span></div>`;
}

/** 本手我方每张发到的牌的 key（按发牌序号）；同名人物也能分开。 */
const dealtKey = (o: Observation, i: number) => `h${o.handNo}-d${i}`;
/** 场上 / 战斗里我方各位置对应的发牌 key。 */
function myKeys(o: Observation, ids: (string | null)[]): (string | null)[] {
  const used = new Set<number>();
  return ids.map((id) => {
    const i = id ? o.me.dealt.findIndex((d, j) => d === id && !used.has(j)) : -1;
    if (i < 0) return null;
    used.add(i);
    return dealtKey(o, i);
  });
}
const foeKey = (o: Observation, pos: number) => `h${o.handNo}-f${pos}`;

function btn(label: string, act: string, arg?: string | number, cls = "") {
  return `<button data-act="${act}"${arg !== undefined ? ` data-arg="${arg}"` : ""} class="${cls}">${label}</button>`;
}

// ───────────────────────── 画面 ─────────────────────────

/** 市场里最近被挑走的那一名：它的牌从“发现”里飞向挑它的人。 */
let lastPick: { seat: Seat; id: string } | null = null;

/** 这次重画里被收走的第几张牌（收牌动画一张接一张）。 */
let leaving = 0;

/**
 * 一手结束、进入市场（挑新人物、整理牌池）时，桌上的牌全部收走，只留空位。
 * 战斗一算完牌桌就已经在市场阶段了，但战斗还要播：播完、点“继续”关掉之后才收。
 */
const tableCleared = (o: Observation) => !ui.battle && (o.phase === "marketPick" || o.phase === "marketRemove");
const emptyRow = () => [0, 1, 2].map(() => slot("")).join("");

/** 下一次重画时某些牌的起点（拖动松手时牌在鼠标下，而不是在原来的位置）。 */
let flipFrom = new Map<string, DOMRect>();

/** animate = false 时不播滑动和发牌（例如窗口改变大小，牌只是跟着布局变位置）。 */
function render(animate = true) {
  musicScene();
  const before: Snapshot = animate ? measure(app) : new Map();
  if (!table) {
    morph(app, sheetView());
    return;
  }
  const o = observe(table, HUMAN);
  morph(app, `
    ${topBar(o)}
    <section class="stage"><div class="table">
      ${seatBar(o, AI)}
      <div class="row foe">${ui.battle ? battleRow(ui.battle, AI, o) : foeRow(o)}</div>
      ${center(o)}
      <div class="row me">${ui.battle ? battleRow(ui.battle, HUMAN, o) : myRow(o)}</div>
      ${seatBar(o, HUMAN)}
    </div>${discoverView(o)}</section>
    <section class="dock">${ui.error ? `<div class="error">${esc(ui.error)}</div>` : ""}${ui.battle ? battleDock(ui.battle) : dock(o)}</section>
    ${sheetView()}
  `, (el) => animate && leave(el as HTMLElement, before));
  leaving = 0;
  fitTable();
  if (animate) flip(app, before, flipFrom);
  flipFrom = new Map();
}

/**
 * 这次重画里要消失的牌怎么退场：桌上的牌收走；“发现”里被挑走的那张飞向挑它的人，剩下的沉下去。
 */
function leave(el: HTMLElement, before: Snapshot): boolean {
  const seen = before.get(el.dataset.key!);
  if (el.closest(".discover")) {
    const id = el.dataset.pick;
    let target: Element | null = null;
    if (lastPick && id === lastPick.id) {
      target = app.querySelector(lastPick.seat === HUMAN ? ".seat.bottom .avatar" : ".seat.top .avatar");
      lastPick = null;
    }
    return discoverExit(el, seen?.rect, target, leaving++);
  }
  return collect(el, seen, leaving++);
}

/**
 * 市场“发现”：候选人物浮在牌桌上方正中（桌面压暗），像炉石的发现。轮到你时点一张放进牌池；
 * 对手挑的时候也摆出来，看得到她挑了谁。这一层一直在（没开时是空的），牌才能从里面飞走、沉下去。
 */
function discoverView(o: Observation): string {
  const open = !ui.battle && o.phase === "marketPick";
  // 开着、关着都用同一个模板（标题、牌、提示三层，中间不留空白）：增量更新按位置对上，
  // 关的时候里面的牌才会一张张走退场动画，否则装牌的那一层会被整个换掉、牌直接消失
  const view = (cls: string, title: string, cards: string, hint: string) =>
    `<div class="discover${cls}"><div class="discover-title">${title}</div><div class="discover-cards">${cards}</div><div class="discover-hint">${hint}</div></div>`;
  if (!open) return view("", "", "", "");
  const mine = o.toAct.includes(HUMAN);
  const stage = Table.marketStageFor(o.handNo, table!.options.blindEvery);
  const seen = new Map<string, number>();
  const cards = o.market.map((id, i) => {
    const n = (seen.get(id) ?? 0) + 1;
    seen.set(id, n);
    // 牌直接放在 .discover-cards 里（不包格子）：挑走一张时剩下的牌原地不动，只滑过去补位
    return card(id, {
      key: `h${o.handNo}-mk-${id}${n > 1 ? `#${n}` : ""}`, act: mine ? "marketPick" : undefined, arg: i,
    }).replace("<div ", `<div data-pick="${id}" `);
  }).join("");
  return view(` open ${mine ? "mine" : "theirs"}`, `发现<small>INVENTIO · 市场阶段 ${stage}</small>`, cards,
    mine ? "挑一名放进你的牌池 · 本手输家先挑，挑了谁对手看得到" : "对手在挑人……挑了谁你看得到");
}

/** 按当前画面选背景音乐：入场各屏放菜单曲，牌桌 / 战斗 / 胜负各有一首。 */
function musicScene() {
  const t = table;
  if (!t || gate.open) return setScene("menu");
  const id = `${seed}`;
  const b = ui.battle;
  if (t.phase === "over" && (!b || b.done)) return setScene(t.winner === HUMAN ? "win" : "lose", `over-${id}`);
  if (b && !b.done) return setScene("battle", `battle-${id}-${t.handNo}`);
  const bet = { track: "bet" as const, key: `bet-${id}` };
  const lb = ui.lastBattle && ui.lastBattle.hand === t.handNo ? ui.lastBattle : null;
  if (lb && lb.result.winner !== null && watchedBattle === `${id}-${lb.hand}`) return setScene(lb.result.winner === HUMAN ? "win" : "lose", `result-${id}-${lb.hand}`, bet);
  setScene(bet.track, bet.key);
}

/**
 * 牌桌放不下时把卡缩小一点，保证一屏装下、不用滚动。
 * 按各行的布局高度算，不用 scrollHeight：正在播的动画（发牌、滑动、3D 侧边）会把 scrollHeight 撑大，卡就被无故缩小。
 */
function fitTable() {
  const tb = app.querySelector<HTMLElement>(".table");
  if (!tb) return;
  const need = () => {
    const cs = getComputedStyle(tb);
    // 只算排版里的几行：正在收走的牌（data-fx，绝对定位挂在桌面上）不占位置，算进去会让整桌一下缩到最小
    const kids = ([...tb.children] as HTMLElement[]).filter((k) => !k.hasAttribute("data-fx"));
    return kids.reduce((sum, k) => sum + k.offsetHeight, 0) + (parseFloat(cs.rowGap) || 0) * (kids.length - 1) +
      parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
  };
  let f = 1;
  app.style.setProperty("--fit", "1");
  while (f > 0.5 && need() > tb.clientHeight + 1) {
    f -= 0.05;
    app.style.setProperty("--fit", f.toFixed(2));
  }
}

/** 战斗动画播放时，筹码还停在结算之前，免得提前看出胜负。 */
function shownMoney(o: Observation): { stacks: [number, number]; pot: number } {
  const out = table!.hand.outcome;
  if (!ui.battle || !out || out.by !== "battle") return { stacks: o.stacks, pot: o.pot };
  const stacks: [number, number] = [o.stacks[0], o.stacks[1]];
  if (out.winner === null) {
    stacks[0] -= o.invested[0];
    stacks[1] -= o.invested[1];
  } else {
    stacks[out.winner] -= out.pot;
  }
  return { stacks, pot: out.pot };
}

function topBar(o: Observation) {
  return `<header class="top">
    <div class="brand">七罪暗队<small>v0.3 试玩</small></div>
    ${debug ? btn("调试", "sheet", "debug", "debug-chip") : ""}
    <div class="hand-no">第 ${o.handNo} 手 · 底注 ${o.ante}${o.handNo % 5 === 0 ? " · 下手升盲" : ""}</div>
    <nav>${musicBtn()}${btn("记录", "sheet", "log")}${btn("牌池", "sheet", "pool")}${btn("规则", "sheet", "help")}${btn("新桌", "newTable")}</nav>
  </header>`;
}

function musicBtn() {
  const off = isMuted();
  return `<button data-act="music" class="music-btn ${off ? "" : "on"}" aria-pressed="${!off}" title="${off ? "打开音乐" : "关闭音乐"}">${off ? "♪ 关" : "♪ 开"}</button>`;
}

function chipStack(n: number) {
  const k = n <= 0 ? 0 : n < 20 ? 1 : n < 60 ? 2 : 3;
  return `<span class="chips c${k}"><i></i><i></i><i></i></span>`;
}

function seatBar(o: Observation, seat: Seat) {
  const acting = !ui.battle && o.phase !== "over" && o.toAct.includes(seat);
  const name = seat === HUMAN ? "你" : `电脑 · ${STYLE_NAME[style]}`;
  const roundBet = o.phase === "bet" ? o.betting.roundBet[seat] : 0;
  const stack = shownMoney(o).stacks[seat];
  const extra = seat === AI
    ? `<span class="meta">牌池 ${o.opponent.poolSize}${o.opponent.publicPicks.length ? ` · 挑入 ${o.opponent.publicPicks.length}` : ""}</span>`
    : `<span class="meta">牌池 ${o.me.pool.length}</span>`;
  const submitted = seat === AI && o.opponent.submitted && ["operate", "draft", "vote", "bid", "marketRemove"].includes(o.phase);
  return `<div class="seat ${seat === AI ? "top" : "bottom"} ${acting ? "acting" : ""}">
    <span class="avatar">${seat === HUMAN ? "你" : "机"}</span>
    <span class="who">${name}</span>
    ${o.dealer === seat ? `<span class="dealer" title="庄家">庄</span>` : ""}
    <span class="stack">${chipStack(stack)}<b>${stack}</b>${stack === 0 && o.phase !== "over" ? `<span class="allin-tag" title="筹码全在奖池里，赢下这手就拿回来">全押</span>` : ""}</span>
    ${extra}
    <span class="status">${acting ? (seat === HUMAN ? "轮到你" : "思考中…") : submitted ? "已决定" : ""}</span>
    ${roundBet ? `<span class="bet-pill">${chipStack(roundBet)}${roundBet}</span>` : ""}
  </div>`;
}

/**
 * 场地 / 胜利规则 / 公共效果：横放在桌上的三块有厚度的长条牌。没翻开时背面朝上，翻开时抬起来绕水平轴翻过去。
 * 每手一组新的（key 带手数），新一手会重新发到桌上。
 */
const TILE_LATIN = { arena: "ARENA", rule: "LEX", pe: "OMEN" } as const;

function envTile(o: Observation, which: "arena" | "rule" | "pe", title: string, name: string | null, text: string, hint: string, state = "", art: string | null = null) {
  const down = !name;
  const pic = name ? artUrl(art) : null;
  const cls = ["card", "tile", `t-${which}`, down ? "down" : "", state, pic ? "has-art" : ""].filter(Boolean).join(" ");
  return `<div class="${cls}" data-key="h${o.handNo}-env-${which}"${pic ? ` style="--art:url('${pic}')"` : ""} data-act="sheet" data-arg="env:${which}" role="button" tabindex="0">
    <div class="shade"></div>
    <div class="lift"><div class="flip">
      <i class="edge top"></i><i class="edge bottom"></i><i class="edge left"></i><i class="edge right"></i>
      <div class="face front"><span class="tile-icon"></span><span class="tile-text"><span class="env-title">${title}</span><span class="env-name">${name ?? ""}</span><span class="env-text">${text}</span></span></div>
      <div class="face back"><span class="tile-seal"></span><span class="tile-back"><span class="env-title">${title}<i class="tile-latin">${TILE_LATIN[which]}</i></span><span class="env-text">${hint}</span></span></div>
    </div></div>
  </div>`;
}

function center(o: Observation) {
  const a = o.arenaId ? arena(o.arenaId) : null;
  const r = o.ruleId ? rule(o.ruleId) : null;
  const pe = o.publicEffectId ? publicEffect(o.publicEffectId) : null;
  const peState = o.publicEffectActive === null ? (pe ? "voting" : "") : o.publicEffectActive ? "on" : "off";
  const peLabel = pe ? `${pe.name}${o.publicEffectActive === null ? "" : o.publicEffectActive ? " ✓" : " ✗"}` : null;
  const tiles = tableCleared(o) ? `<div class="tile-slot"></div>`.repeat(3) : envTile(o, "arena", "场地", a?.name ?? null, a?.text ?? "", `候选：${o.arenaOptions.map((x) => arena(x).name).join(" / ")}`, "", o.arenaId) +
    envTile(o, "rule", "胜利规则", r ? r.name : null, r ? `${r.text}（最多 ${r.maxRounds} 轮）` : "", "第 1 轮下注后翻开", "", o.ruleId) +
    envTile(o, "pe", "公共效果", peLabel, pe ? pe.text : "", r ? "已全押，本手没有" : "和规则一起翻开", peState, o.publicEffectId);
  let status = phaseLabel(o);
  if (ui.battle) {
    const b = ui.battle;
    status = b.round === 0 ? "揭开队伍" : `战斗 · 第 ${b.round} 轮 / 最多 ${rule(b.ruleId).maxRounds} 轮 · ${firstOf(b, b.round) === HUMAN ? "你" : "对手"}先手`;
  }
  return `<div class="center">
    <div class="envs">${tiles}</div>
    <div class="pot-line">
      <div class="pot">${chipStack(shownMoney(o).pot)}<b>${shownMoney(o).pot}</b><small>奖池</small></div>
      ${ui.notice && !ui.battle ? `<div class="notice ${ui.notice.good === true ? "good" : ui.notice.good === false ? "bad" : ""}">${ui.notice.text}</div>` : `<div class="phase">${status}</div>`}
    </div>
  </div>`;
}

function phaseLabel(o: Observation): string {
  switch (o.phase) {
    case "arena": return "选场地";
    case "place": return "布阵";
    case "peek": return o.toAct.includes(HUMAN) ? "窥视" : "布阵完成";
    case "bet": return `第 ${o.betting.round} 轮下注`;
    case "operate": return "操作：拿装备？";
    case "draft": return "挑装备";
    case "vote": return "公共效果表决";
    case "bid": return "暗标";
    case "marketPick": return "市场";
    case "marketRemove": return "整理牌池";
    case "over": return "牌桌结束";
  }
}

function foeRow(o: Observation): string {
  if (tableCleared(o)) return emptyRow();
  const opp = o.opponent;
  const lb = ui.lastBattle && ui.lastBattle.hand === o.handNo ? ui.lastBattle : null;
  if (lb) return battleUnits(lb.result.final[AI], lb.teams[AI].reveal, o);
  const peeking = o.phase === "peek" && o.toAct.includes(HUMAN) && !o.me.peek; // 偷看过一次就不能再点
  return [0, 1, 2].map((pos) => {
    const eq = gearAt(opp.equipment, opp.slotEffects, pos);
    const base = { unit: `${AI}-${pos}`, key: foeKey(o, pos) };
    if (!opp.placed) return card(null, { ...base, backText: o.phase === "arena" ? "" : "布阵中…" });
    if (opp.emptyPositions.includes(pos)) return slot("空位<br><small>被饕餮吞掉</small>", { unit: base.unit });
    if (opp.revealed?.pos === pos) return card(opp.revealed.characterId, { ...base, equipList: eq, flag: "亮" });
    if (o.me.peek?.pos === pos) return card(o.me.peek.characterId, { ...base, equipList: eq, flag: "偷看" });
    if (peeking) return card(null, { ...base, equipList: eq, backText: "点这里偷看", act: "peek", arg: pos, cls: "target" });
    return card(null, { ...base, equipList: eq });
  }).join("");
}

function myRow(o: Observation): string {
  if (tableCleared(o)) return emptyRow();
  const lb = ui.lastBattle && ui.lastBattle.hand === o.handNo ? ui.lastBattle : null;
  if (lb) return battleUnits(lb.result.final[HUMAN], lb.teams[HUMAN].reveal, o);
  const placing = o.phase === "place" && o.toAct.includes(HUMAN);
  if (placing) {
    const dealt = o.me.dealt;
    return [0, 1, 2].map((pos) => {
      const i = ui.place.slots[pos];
      const drop = `slot:${pos}`;
      if (i === null) return slot(`${posName(pos)}<br><small>拖到这里</small>`, { drop });
      if (ui.place.eaten === pos) return slot(`被饕餮吞掉<br><small>${character(dealt[i]).name}</small>`, { act: "eat", arg: -1, drop });
      const rev = ui.place.reveal === pos;
      return card(dealt[i], { key: dealtKey(o, i), flag: rev ? "亮" : "暗", act: "reveal", arg: pos, cls: rev ? "selected" : "target", drag: drop, drop });
    }).join("");
  }
  const pl = o.me.placement;
  if (!pl) return [0, 1, 2].map((pos) => slot(posName(pos))).join("");
  const drafting = o.phase === "draft" && !!o.me.offers && o.toAct.includes(HUMAN) && ui.draft.offer !== null;
  const keys = myKeys(o, pl.slots);
  return pl.slots.map((id, pos) => {
    if (!id) return slot("空位<br><small>被吞掉</small>");
    const eqs = [...o.me.equipment];
    const fxs = [...o.me.slotEffects];
    let cls = "";
    if (drafting) {
      cls = ui.draft.pos === pos ? "selected" : "target";
      // 预览：挑中的牌装上去的样子（效果槽牌进效果槽，装备顶替原来的装备）
      if (ui.draft.pos === pos) {
        const pick = o.me.offers![ui.draft.offer!];
        if (pick.startsWith("FX")) fxs[pos] = pick;
        else eqs[pos] = pick;
      }
    }
    return card(id, {
      key: keys[pos], unit: `${HUMAN}-${pos}`, equipList: gearAt(eqs, fxs, pos), flag: pos === pl.reveal ? "亮" : "暗", cls,
      act: drafting ? "draftPos" : undefined, arg: pos,
    });
  }).join("");
}

function battleUnits(snaps: UnitSnapshot[], reveal: number, o: Observation, acting: string | null = null, lanes: Map<string, number> = new Map()) {
  const seat = snaps[0]?.seat ?? HUMAN;
  const keys = seat === HUMAN ? myKeys(o, snaps.map((u) => u.characterId)) : snaps.map((u) => foeKey(o, u.pos));
  return snaps.map((u, i) => {
    const unit = `${u.seat}-${u.pos}`;
    if (!u.characterId) return slot("空位", { unit });
    const body: Body = { atk: u.atk, hp: u.hp, startHp: u.startHp, shape: u.shape, armor: u.armor, barrier: u.barrier };
    return card(u.characterId, {
      key: keys[i], equipList: u.equipment, body, dead: !u.alive, unit, acting: acting === unit, lane: u.alive ? lanes.get(unit) : undefined,
      flag: u.pos === reveal ? "亮" : undefined, flipDelay: seat === AI ? 150 + 260 * u.pos : 0,
    });
  }).join("");
}

function battleRow(b: Playback, seat: Seat, o: Observation) {
  return battleUnits(b.snap[seat], b.teams[seat].reveal, o, b.actor, b.switching);
}

// ───────────────────────── 操作栏 ─────────────────────────

function prompt(text: string, sub = "") {
  return `<div class="prompt">${text}${sub ? `<small>${sub}</small>` : ""}</div>`;
}

function waiting(text: string) {
  return `<div class="prompt waiting">${text}<span class="dots"><i></i><i></i><i></i></span></div>`;
}

function dock(o: Observation): string {
  const mine = o.toAct.includes(HUMAN);
  const tip = mine && o.phase !== "over" ? tipHtml(o.phase) : "";
  return tip + phaseDock(o, mine);
}

function phaseDock(o: Observation, mine: boolean): string {
  switch (o.phase) {
    case "over": {
      const won = table!.winner === HUMAN;
      return `<div class="result ${won ? "good" : "bad"}">${won ? "你赢下了这张牌桌！" : "对手赢下了这张牌桌"}<small>共 ${table!.handNo} 手</small></div>
        <div class="actions">${btn("再开一桌", "newTable", undefined, "primary big")}</div>`;
    }
    case "arena": return arenaDock(o, mine);
    case "place": return placeDock(o, mine);
    case "peek": return mine ? peekDock(o) : waiting("等待对手");
    case "bet": return mine ? betDock(o) : waiting(`对手在考虑第 ${o.betting.round} 轮下注`);
    case "operate": return mine ? operateDock(o) : waiting("等对手决定要不要拿装备");
    case "draft": return mine && o.me.offers ? draftDock(o) : waiting("对手在挑装备");
    case "vote": return mine ? voteDock(o) : waiting("等对手表决");
    case "bid": return mine ? bidDock(o) : waiting("等对手暗标出价");
    case "marketPick": return marketDock(o, mine);
    case "marketRemove": return mine ? removeDock(o) : waiting("等对手整理牌池");
  }
}

function arenaDock(o: Observation, mine: boolean) {
  const tiles = o.arenaOptions.map((id, i) => {
    const a = arena(id);
    const pic = artUrl(id) ? `<div class="option-art"${artStyle(id)}></div>` : "";
    return `<div class="option ${pic ? "with-art" : ""} ${mine ? "clickable" : ""}"${mine ? attrs({ act: "arena", arg: i }) + ` data-tilt="8"` : ""}>${pic}<b>${a.name}</b><small>${a.kind}</small><p>${a.text}</p></div>`;
  }).join("");
  return (mine ? prompt("选一张场地", "你筹码较少（或一样多且你不是庄家）") : waiting("对手在选场地")) + `<div class="tray options">${tiles}</div>`;
}

function placeDock(o: Observation, mine: boolean) {
  const dealt = o.me.dealt;
  // 手牌：已经放上场的牌离开手牌；可以拖到场上，也可以点一下放到第一个空位
  const placedKeys = new Set(o.me.placement ? myKeys(o, o.me.placement.slots) : []);
  const tray = (mineNow: boolean) => {
    const inHand = dealt.map((id, i) => [id, i] as const)
      .filter(([, i]) => (mineNow ? !ui.place.slots.includes(i) : !placedKeys.has(dealtKey(o, i))));
    const mid = (inHand.length - 1) / 2;
    const cards = inHand.map(([id, i], k) => card(id, {
      key: dealtKey(o, i), cls: "small", fan: k - mid, act: mineNow ? "pick" : undefined, arg: i, drag: mineNow ? `hand:${i}` : undefined,
    }));
    return `<div class="tray hand fan"${mineNow ? ` data-drop="hand"` : ""}>${cards.join("")}</div>`;
  };
  if (!mine) {
    return waiting(o.dealer === HUMAN ? "对手先布阵、先亮牌" : "对手是庄家，看过你亮的牌再布阵") + tray(false);
  }
  const filled = ui.place.slots.every((x) => x !== null);
  const ids = ui.place.slots.map((i) => (i === null ? null : dealt[i]));
  const gl2 = ids.indexOf("GL2");
  let ok = false;
  let why = "";
  if (!filled) why = "把手牌拖到 1、2、3 号位（点一下也能放上去；拖回手牌区就收回）";
  else if (ui.place.reveal === null) why = "点场上你的一张牌，把它设为亮出";
  else {
    try {
      validatePlacement(dealt, ui.place.slots as number[], ui.place.eaten !== null ? { eater: gl2, eaten: ui.place.eaten } : null, ui.place.reveal);
      ok = true;
    } catch (err) {
      why = err instanceof Error ? err.message : String(err);
    }
  }
  const head = ok
    ? prompt(`亮出 ${posName(ui.place.reveal!)} ${character(ids[ui.place.reveal!]!).name}`, "点场上的牌换一名亮出；拖动可以换位，手里剩下的那张本手不上场")
    : prompt(o.dealer === HUMAN ? "你是庄家，后布阵" : "你先布阵：对手会看到你亮的那一名", why);
  let eat = "";
  if (gl2 >= 0 && filled) {
    eat = `<div class="actions compact"><span class="label">饕餮吞队友：</span>${btn("不吞", "eat", -1, ui.place.eaten === null ? "on" : "")}
      ${[0, 1, 2].filter((p) => p !== gl2).map((p) => btn(`${posName(p)} ${character(ids[p]!).name}`, "eat", p, ui.place.eaten === p ? "on" : "")).join("")}</div>`;
  }
  return head + tray(true) + eat + `<div class="actions">
    ${btn("清空", "clearPlace", undefined, ui.place.slots.some((x) => x !== null) ? "big" : "big disabled")}
    ${btn("确认布阵", "place", undefined, `primary big ${ok ? "" : "disabled"}`)}</div>`;
}

/** 窥视者：先暗中偷看，再决定要不要交换自己两名暗置人物。 */
function peekDock(o: Observation) {
  if (!o.me.peek) return prompt("你的窥视者可以暗中偷看一张暗牌", "点对手的一张暗牌；对手不会知道你看过");
  const pl = o.me.placement!;
  const seen = `${posName(o.me.peek.pos)} 是 ${character(o.me.peek.characterId).name}`;
  const swaps = legalActions(table!, HUMAN).flatMap((a) => (a.type === "peekSwap" && a.swap ? [a.swap] : []));
  const label = ([a, b]: [number, number]) => `${posName(a)} ${character(pl.slots[a]!).name} ⇄ ${posName(b)} ${character(pl.slots[b]!).name}`;
  return prompt(`偷看到：对手${seen}`, swaps.length ? "要不要交换你两名暗置人物的位置？对手不会知道" : "你只有一名暗置人物，没法换位") +
    `<div class="actions compact">${swaps.map((sw) => btn(label(sw), "peekSwap", `${sw[0]}-${sw[1]}`)).join("")}</div>
    <div class="actions">${btn("不交换，开始下注", "peekSwap", "-1", "primary big")}</div>`;
}

function betDock(o: Observation) {
  const b = o.betting;
  const stack = o.stacks[HUMAN];
  const me = b.roundBet[HUMAN];
  const acts = legalActions(table!, HUMAN);
  const has = (t: Action["type"]) => acts.some((a) => a.type === t);
  const opening = b.target === 0;
  const min = opening ? table!.options.minBet : b.minRaiseTo;
  const max = opening ? stack - 1 : me + stack - 1;
  const canSize = min <= max;
  if (canSize && (ui.betAmount === null || ui.betAmount < min || ui.betAmount > max)) ui.betAmount = min;
  const quick = acts.flatMap((a) => (a.type === "bet" ? [a.amount] : a.type === "raise" ? [a.to] : []));
  const verb = opening ? "下注" : "加注到";
  const toCall = Math.min(b.toCall, stack);
  const sub = b.canFold ? "" : "对手亮出了冠冕者：第 1 轮不能弃牌";
  return prompt(toCall ? `对手下注，你要跟 ${toCall}` : `第 ${b.round} 轮下注`, sub) +
    (canSize ? `<div class="sizer">
      ${quick.map((x) => btn(String(x), "setBet", x, `chip-btn ${x === ui.betAmount ? "on" : ""}`)).join("")}
      <input type="range" min="${min}" max="${max}" step="1" value="${ui.betAmount}" data-input="bet" aria-label="金额">
      <input type="number" min="${min}" max="${max}" step="1" value="${ui.betAmount}" data-input="bet" aria-label="金额">
    </div>` : "") +
    `<div class="actions poker">
      ${has("fold") ? btn("弃牌", "fold", undefined, "fold big") : ""}
      ${has("check") ? btn("过牌", "check", undefined, "call big") : ""}
      ${has("call") ? btn(`跟注 ${toCall}`, "call", undefined, "call big") : ""}
      ${canSize ? btn(`${verb} <b data-bind="bet">${ui.betAmount}</b>`, "betSized", undefined, "raise big") : ""}
      ${has("allIn") ? btn(`全押 ${stack}`, "allIn", undefined, "allin big") : ""}
    </div>`;
}

function operateDock(o: Observation) {
  return prompt(`付 ${o.opFee} 操作费，从 3 件装备里挑 1 件？`, "装备装在谁身上对手看得到") +
    `<div class="actions">${btn("不拿", "operate", 0, "big")}${btn(`付 ${o.opFee} 拿装备`, "operate", 1, "primary big")}</div>`;
}

function draftDock(o: Observation) {
  const offers = o.me.offers!;
  const tiles = offers.map((id, i) => {
    const e = gear(id);
    const fx = id.startsWith("FX");
    return `<div class="option clickable ${fx ? "fx" : ""} ${ui.draft.offer === i ? "selected" : ""}"${attrs({ act: "draftOffer", arg: i })}><b>${fx ? "✦" : "⚙"} ${e.name}</b><small>${fx ? "效果" : "装备"}</small><p>${e.text}</p></div>`;
  }).join("");
  const ready = ui.draft.offer !== null && ui.draft.pos !== null;
  const sub = ui.draft.offer === null ? "先选一件" : ui.draft.pos === null ? "再点上面你的一张牌，装给它" : `装到 ${posName(ui.draft.pos)}`;
  return prompt("挑一张：装备或效果", sub) + `<div class="tray options three">${tiles}</div>
    <div class="actions">${btn("确认装备", "draft", undefined, `primary big ${ready ? "" : "disabled"}`)}</div>`;
}

function voteDock(o: Observation) {
  const pe = publicEffect(o.publicEffectId!);
  return prompt(`公共效果「${pe.name}」要不要生效？`, `${pe.text}。双方暗投；不一致就暗标。`) +
    `<div class="actions">${btn("不生效", "vote", 0, "big")}${btn("生效", "vote", 1, "primary big")}</div>`;
}

function bidDock(o: Observation) {
  const cap = o.bidCap;
  if (ui.bid > cap) ui.bid = cap;
  const quick = [...new Set([0, 5, 10, 20, Math.floor(cap / 2), cap].filter((x) => x <= cap))].sort((a, b) => a - b);
  return prompt(`暗标：你投了${o.me.vote ? "生效" : "不生效"}，对手相反`, `出价高的一方说了算，只付自己的出价；一样多则不生效。最多 ${cap}`) +
    `<div class="sizer">
      ${quick.map((x) => btn(String(x), "setBid", x, `chip-btn ${x === ui.bid ? "on" : ""}`)).join("")}
      <input type="range" min="0" max="${cap}" step="1" value="${ui.bid}" data-input="bid" aria-label="出价">
      <input type="number" min="0" max="${cap}" step="1" value="${ui.bid}" data-input="bid" aria-label="出价">
    </div>
    <div class="actions">${btn(`出价 <b data-bind="bid">${ui.bid}</b>`, "bid", undefined, "primary big")}</div>`;
}

function marketDock(o: Observation, mine: boolean) {
  // 候选人物浮在牌桌上方（discoverView），操作栏只留一句说明
  return mine ? prompt("市场：从上方挑一名放进你的牌池", "本手输家先挑，挑了谁对手看得到") : waiting("对手在市场挑人");
}

function removeDock(o: Observation) {
  const pool = o.me.pool;
  const min = table!.options.minPoolSize;
  const canRemove = pool.length - 1 >= min;
  const sel = ui.removeIdx;
  return prompt("要从牌池移除一名吗？", canRemove ? `对手看不到你移除了谁 · 牌池至少留 ${min} 名` : `牌池已经只剩 ${min} 名，不能再移除`) +
    (canRemove ? `<div class="tray hand scroll">${pool.map((id, i) => card(id, { cls: `small ${sel === i ? "selected" : ""}`, act: "pickRemove", arg: i })).join("")}</div>` : "") +
    `<div class="actions">${btn("不移除", "remove", -1, sel === null ? "primary big" : "big")}
      ${sel !== null ? btn(`移除 ${character(pool[sel]).name}`, "remove", sel, "fold big") : ""}</div>`;
}

function battleDock(b: Playback) {
  const r = b.result;
  const lines = b.caption;
  const tip = tipHtml("battle");
  const cap = tip + `<div class="caption"><b>${lines[0]}</b>${lines.slice(1).map((l) => `<span>${esc(l)}</span>`).join("")}</div>`;
  if (b.done) {
    const cls = r.winner === HUMAN ? "good" : r.winner === null ? "" : "bad";
    const text = r.winner === null ? "平局" : r.winner === HUMAN ? "你赢了这场战斗" : "对手赢了这场战斗";
    return cap + `<div class="result ${cls}">${text}<small>${REASON_TEXT[r.reason]} · 规则「${rule(b.ruleId).name}」</small></div>
      <div class="actions">${btn("继续", "bClose", undefined, "primary big")}</div>`;
  }
  return cap + `<div class="actions">
    ${btn(b.paused ? "▶ 继续" : "❚❚ 暂停", "bPause", undefined, "big")}
    ${btn(b.speed === 1 ? "加速 ×2" : "正常速度", "bSpeed", undefined, "big")}
    ${btn("跳到结果", "bSkip", undefined, "big")}</div>`;
}

// ───────────────────────── 弹层 ─────────────────────────

function sheetView(): string {
  const s = ui.sheet;
  if (!s) return "";
  const wrap = (cls: string, inner: string, closable = true) =>
    `<div class="overlay" ${closable ? `data-act="closeSheet"` : ""}><div class="sheet ${cls}" data-stop="1" role="dialog">
      ${closable ? `<button class="close" data-act="closeSheet" aria-label="关闭">×</button>` : ""}${inner}</div></div>`;
  switch (s.kind) {
    case "help": {
      const tabs: Array<[Ui["helpTab"], string]> = [["play", "玩法"], ["chars", "人物"], ["equip", "装备"], ["rules", "胜利规则"], ["arenas", "场地"], ["effects", "公共效果"]];
      let body = "";
      switch (ui.helpTab) {
        case "play": body = HOW_TO_PLAY + `<div class="actions">${btn("重新显示新手提示", "tipsReset")}</div>`; break;
        case "chars": body = `<p class="muted">开桌时每人的牌池从全部人物里随机 8 名。市场里，第 1–5 手只出第一阶段人物，第 6 手起只出标“二”的人物。点卡上的 ? 看能力。</p>
          <div class="gallery">${CHARACTERS.map((c) => card(c.id, { cls: "small", flag: c.stage === 2 ? "二" : undefined })).join("")}</div>`; break;
        case "equip": body = `<h3>装备</h3>${refTable(EQUIPMENT.map((e) => [`⚙ ${e.name}`, e.text]))}
          <h3>效果槽牌</h3><p class="muted">操作时从装备和效果槽牌混在一起的牌里挑。每人身上一件装备、一张效果槽牌，互不顶替。</p>
          ${refTable(SLOT_EFFECTS.map((e) => [`✦ ${e.name}`, e.text]))}`; break;
        case "rules": body = refTable(RULES.map((r) => [`${r.name}<small>${r.family} · 最多 ${r.maxRounds} 轮</small>`, r.text, r.id])); break;
        case "arenas": body = refTable(ARENAS.map((a) => [`${a.name}<small>${a.kind}</small>`, a.text, a.id])); break;
        case "effects": body = refTable(PUBLIC_EFFECTS.map((p) => [`${p.name}<small>${p.kind}</small>`, p.text, p.id])); break;
      }
      return wrap("help", `<div class="tabs">${tabs.map(([k, l]) => btn(l, "tab", k, ui.helpTab === k ? "on" : "")).join("")}</div>
        <div class="sheet-body">${body}</div>`);
    }
    case "card": {
      const c = character(s.id);
      const eqs = s.equip.map((x) => gear(x));
      return wrap("card-sheet", `${ART.has(s.id) ? `<img class="full-portrait" src="art/${s.id}.webp" alt="${c.name}立绘">` : ""}<div class="big-card">${card(s.id, { equipList: s.equip, cls: "large" })}</div>
        <div class="card-info"><h2>${c.name}<small><span class="latin">${SIN_LATIN[c.sin]}</span> ${c.sin} · ${c.tag}${c.stage === 2 ? " · 第二阶段" : ""}</small></h2>
        <p class="stats">攻 <b>${c.atk}</b> · 血 <b>${c.hp}</b> · ${shapeLabel(c.shape, c.atk)}${c.armor ? ` · 护甲 ${c.armor}` : ""}${c.barrier ? ` · 屏障 ${c.barrier}` : ""}</p>
        <p class="ability">${esc(c.ability)}</p>
        ${eqs.map((e, i) => `<p class="equip-line">${s.equip[i].startsWith("FX") ? "✦" : "⚙"} ${e.name}：${e.text}</p>`).join("")}
        <p class="muted">重击 → 护甲 → 连击 → 屏障 → 重击：前者克后者。</p></div>`);
    }
    case "env": {
      const o = observe(table!, HUMAN);
      let title = "";
      let body = "";
      if (s.which === "arena") {
        title = "场地";
        body = o.arenaId ? `${envArt(o.arenaId)}<h2>${arena(o.arenaId).name}</h2><p>${arena(o.arenaId).text}</p>`
          : o.arenaOptions.map((id) => `${envArt(id, "small")}<h3>${arena(id).name}</h3><p>${arena(id).text}</p>`).join("");
      } else if (s.which === "rule") {
        title = "胜利规则";
        const r = o.ruleId ? rule(o.ruleId) : null;
        body = r ? `${envArt(r.id)}<h2>${r.name}<small>${r.family} · 最多 ${r.maxRounds} 轮</small></h2><p>${r.text}</p>` : "<p>第 1 轮下注结束后翻开。</p>";
      } else {
        title = "公共效果";
        const pe = o.publicEffectId ? publicEffect(o.publicEffectId) : null;
        body = pe ? `${envArt(pe.id)}<h2>${pe.name}<small>${o.publicEffectActive === null ? "表决中" : o.publicEffectActive ? "生效" : "不生效"}</small></h2><p>${pe.text}</p>`
          : "<p>和胜利规则一起翻开。双方暗投要不要生效，不一致就暗标。</p>";
      }
      return wrap("env-sheet", `<div class="label">${title}</div>${body}`);
    }
    case "debug": {
      const r = debug?.rig ?? {};
      const names = (ids?: string[] | null) => (ids?.length ? ids.map((id) => `${id} ${character(id).name}`).join("、") : "随机");
      const rows: Array<[string, string]> = [
        ["你的手牌", names(r.deal?.[HUMAN])], ["电脑手牌", names(r.deal?.[AI])],
        ["胜利规则", r.ruleId ? `${r.ruleId} ${rule(r.ruleId).name}` : "随机"],
        ["候选场地", r.arenaOptions ? r.arenaOptions.map((a) => `${a} ${arena(a).name}`).join(" / ") : "随机"],
        ["公共效果", r.publicEffectId ? `${r.publicEffectId} ${publicEffect(r.publicEffectId).name}` : "随机"],
        ["市场", names(r.market)], ["第一手庄家", r.dealer === undefined ? "随机" : r.dealer === HUMAN ? "你" : "电脑"],
        ["种子", String(seed)],
      ];
      const ids = CHARACTERS.map((c) => `<code>${c.id}</code> ${c.name}`).join("　");
      return wrap("help", `<h2>调试模式</h2>
        <div class="debug-form"><input type="text" data-input="debugText" value="${esc(debugText)}" placeholder="me=EN1,GL2,PR3,WR3&amp;rule=V02&amp;dealer=foe" aria-label="调试参数">
        ${btn("按这些参数开新桌", "applyDebug", undefined, "primary")}</div>
        ${debug ? refTable(rows) : `<p class="muted">现在没有开调试。填上参数、点按钮，就会按这些固定项开一桌。</p>`}
        <h3>用法</h3><p class="muted">在网址后面加参数，例如 <code>?debug&amp;me=EN1,GL2,PR3,WR3&amp;foe=LU1&amp;rule=V02&amp;arena=A08,A02&amp;pe=P10&amp;dealer=foe&amp;seed=42&amp;ai=bluff</code>。
        me / foe 是每手固定发给你 / 电脑的人物（最多 4 名，不够的随机补）；rule、pe、arena、market 分别固定胜利规则、公共效果、两张候选场地、市场；dealer 是第一手庄家（me / foe）；seed 固定随机种子；ai 是电脑风格（cautious / aggressive / bluff）。</p>
        <h3>人物编号</h3><p class="muted">${ids}</p>
        <p class="muted">规则、场地、公共效果的编号见“规则”里的列表顺序：V01–V27、A01–A22、P01–P31。</p>`);
    }
    case "log": {
      const lines = logLines.slice(-120).reverse();
      return wrap("drawer", `<h2>牌桌记录</h2><ol class="log">${lines.map((l) => `<li class="${l.startsWith("——") ? "sep" : ""}">${esc(l)}</li>`).join("")}</ol>`);
    }
    case "pool": {
      const o = observe(table!, HUMAN);
      const picks = o.opponent.publicPicks;
      return wrap("drawer", `<h2>我的牌池<small>${o.me.pool.length} 名 · 每手从这里随机发 4 名</small></h2>
        <div class="gallery">${o.me.pool.map((id) => card(id, { cls: "small" })).join("")}</div>
        <h2>对手<small>牌池 ${o.opponent.poolSize} 名${o.opponent.removedCount ? ` · 移除过 ${o.opponent.removedCount} 名` : ""}</small></h2>
        ${picks.length ? `<p class="muted">从市场公开挑入：</p><div class="gallery">${picks.map((id) => card(id, { cls: "small" })).join("")}</div>` : `<p class="muted">还没从市场挑过人；其余都是未知的。</p>`}`);
    }
  }
}

function refTable(rows: Array<[string, string, string?]>) {
  const pic = (id?: string) => (artUrl(id) ? `<td class="ref-pic"><img src="${artUrl(id)}" alt="" loading="lazy"></td>` : "");
  return `<table class="ref">${rows.map(([a, b, id]) => `<tr>${pic(id)}<th>${a}</th><td>${b}</td></tr>`).join("")}</table>`;
}

/** 弹层里的大幅插画。 */
function envArt(id: string, cls = "") {
  return artUrl(id) ? `<img class="env-art ${cls}" src="${artUrl(id)}" alt="">` : "";
}

// ───────────────────────── 输入 ─────────────────────────

function onAct(name: string, arg: string | undefined) {
  const n = arg === undefined ? NaN : Number(arg);
  const o = table && table.phase !== "over" ? observe(table, HUMAN) : null;
  switch (name) {
    case "sheet": {
      if (arg?.startsWith("env:")) ui.sheet = { kind: "env", which: arg.slice(4) as "arena" | "rule" | "pe" };
      else ui.sheet = { kind: arg as "help" | "log" | "pool" | "debug" };
      return render();
    }
    case "music": toggleMuted(); return render();
    case "closeSheet": ui.sheet = null; render(); return scheduleAi();
    case "newTable": ui.sheet = null; render(); gate.show("opponent"); return musicScene();
    case "tipOk": dismissTip(arg ?? ""); return render();
    case "tipOff": disableTips(); return render();
    case "tipsReset": resetTips(); ui.sheet = null; return render();
    case "inspect": {
      const [id, eq] = (arg ?? "").split("|");
      ui.sheet = { kind: "card", id, equip: eq ? eq.split("+") : [] };
      return render();
    }
    case "tab": ui.helpTab = arg as Ui["helpTab"]; return render();
    case "applyDebug": {
      debug = parseDebug(`?debug&${debugText}`);
      gate.hide();
      return newTable(debug?.style ?? style);
    }
    case "arena": return act({ type: "chooseArena", index: n as 0 | 1 });
    case "pick": {
      const at = ui.place.slots.indexOf(n);
      if (at >= 0) {
        ui.place.slots[at] = null;
        if (ui.place.reveal === at) ui.place.reveal = null;
      } else {
        const free = ui.place.slots.indexOf(null);
        if (free < 0) { ui.error = "3 个位置都放满了，先点一张已放上去的牌取回"; return render(); }
        ui.place.slots[free] = n;
      }
      ui.place.eaten = null;
      ui.error = null;
      return render();
    }
    case "reveal": ui.place.reveal = n; ui.error = null; return render();
    case "eat": ui.place.eaten = n < 0 ? null : n; if (ui.place.reveal === ui.place.eaten) ui.place.reveal = null; return render();
    case "clearPlace": resetInputs(); return render();
    case "place": {
      const slots = ui.place.slots as number[];
      const gl2 = slots.findIndex((i) => o!.me.dealt[i] === "GL2");
      return act({
        type: "place", picks: [slots[0], slots[1], slots[2]], reveal: ui.place.reveal!,
        eat: ui.place.eaten !== null ? { eater: gl2, eaten: ui.place.eaten } : null,
      });
    }
    case "peek": return act({ type: "peek", pos: n });
    case "peekSwap": {
      if (arg === "-1") return act({ type: "peekSwap", swap: null });
      const [a, b] = (arg ?? "").split("-").map(Number);
      return act({ type: "peekSwap", swap: [a, b] });
    }
    case "check": return act({ type: "check" });
    case "call": return act({ type: "call" });
    case "fold": return act({ type: "fold" });
    case "allIn": return act({ type: "allIn" });
    case "setBet": ui.betAmount = n; return render();
    case "betSized": {
      const amount = ui.betAmount!;
      return act(o!.betting.target === 0 ? { type: "bet", amount } : { type: "raise", to: amount });
    }
    case "operate": return act({ type: "operate", draft: n === 1 });
    case "draftOffer": ui.draft.offer = n; return render();
    case "draftPos": ui.draft.pos = n; return render();
    case "draft": return act({ type: "draft", offerIndex: ui.draft.offer!, pos: ui.draft.pos! });
    case "vote": return act({ type: "vote", activate: n === 1 });
    case "setBid": ui.bid = n; return render();
    case "bid": return act({ type: "bid", amount: ui.bid });
    case "marketPick": return act({ type: "marketPick", index: n });
    case "pickRemove": ui.removeIdx = ui.removeIdx === n ? null : n; return render();
    case "remove": return act({ type: "marketRemove", poolIndex: n < 0 ? null : n });
    case "bPause": if (ui.battle) ui.battle.paused = !ui.battle.paused; return render();
    case "bSpeed": if (ui.battle) ui.battle.speed = ui.battle.speed === 1 ? 2 : 1; return render();
    case "bSkip": return skipBattle();
    case "bClose": return closeBattle();
  }
}

// ───────────────────────── 拖动布阵 ─────────────────────────

/** 手牌 → 场上：放进那个位置（原来在那儿的牌回到手牌）；场上 → 场上：互换；场上 → 手牌：收回。亮出跟着牌走。 */
function dropCard(src: string, dst: string) {
  const [sk, sv] = src.split(":");
  const [dk, dv] = dst.split(":");
  const slots = ui.place.slots;
  const p = Number(dv);
  const q = Number(sv);
  if (sk === "hand" && dk === "slot") {
    slots[p] = q;
    if (ui.place.reveal === p) ui.place.reveal = null;
  } else if (sk === "slot" && dk === "slot") {
    [slots[q], slots[p]] = [slots[p], slots[q]];
    if (ui.place.reveal === q) ui.place.reveal = p;
    else if (ui.place.reveal === p) ui.place.reveal = q;
  } else if (sk === "slot" && dk === "hand") {
    slots[q] = null;
    if (ui.place.reveal === q) ui.place.reveal = null;
  } else {
    return;
  }
  ui.place.eaten = null;
  ui.error = null;
  render();
}

interface Drag {
  src: string; el: HTMLElement; ghost: HTMLElement | null; x0: number; y0: number; dx: number; dy: number; over: HTMLElement | null;
  /** 跟手倾斜：上一次的位置、时间和平滑后的速度。 */
  x: number; y: number; t: number; vx: number; vy: number; raf: number;
}
let dragging: Drag | null = null;
let suppressClickAt = 0;

app.addEventListener("pointerdown", (ev) => {
  const t = ev.target as HTMLElement;
  if (ev.button !== 0 || t.closest(".info-btn")) return;
  const el = t.closest<HTMLElement>("[data-drag]");
  if (!el) return;
  const r = el.getBoundingClientRect();
  dragging = {
    src: el.dataset.drag!, el, ghost: null, x0: ev.clientX, y0: ev.clientY, dx: ev.clientX - r.left, dy: ev.clientY - r.top, over: null,
    x: ev.clientX, y: ev.clientY, t: performance.now(), vx: 0, vy: 0, raf: 0,
  };
});

/** 拖着的牌：跟着手移动，按手的速度往移动方向倾斜，停下来慢慢摆正。 */
function poseGhost(d: Drag) {
  if (!d.ghost) return;
  const clamp = (v: number) => Math.max(-22, Math.min(22, v));
  const ry = clamp(d.vx * 1.6);
  const rx = clamp(-d.vy * 1.6);
  d.ghost.style.transform = `translate(${d.x - d.dx}px, ${d.y - d.dy}px) perspective(700px) rotateX(${rx}deg) rotateY(${ry}deg) rotate(${clamp(d.vx * 0.6)}deg) scale(1.1)`;
  d.vx *= 0.86;
  d.vy *= 0.86;
  d.raf = requestAnimationFrame(() => poseGhost(d));
}

window.addEventListener("pointermove", (ev) => {
  const d = dragging;
  if (!d) return;
  if (!d.ghost) {
    if (Math.hypot(ev.clientX - d.x0, ev.clientY - d.y0) < 6) return; // 没动就当成点击
    const r = d.el.getBoundingClientRect();
    const g = d.el.cloneNode(true) as HTMLElement;
    for (const k of ["data-key", "data-unit", "data-drag", "data-drop", "data-act", "data-acting"]) g.removeAttribute(k);
    g.setAttribute("data-fx", "");
    g.classList.add("drag-ghost");
    g.style.setProperty("--cw", `${r.width}px`);
    g.style.transformOrigin = `${d.dx}px ${d.dy}px`;
    app.appendChild(g);
    d.ghost = g;
    d.el.classList.add("fx-drag-src");
    app.classList.add("dragging");
    poseGhost(d);
  }
  ev.preventDefault();
  const now = performance.now();
  const dt = Math.max(8, now - d.t);
  // 速度按每 16ms 的位移算，再和之前的平滑一下
  d.vx = d.vx * 0.6 + ((ev.clientX - d.x) / dt) * 16 * 0.4;
  d.vy = d.vy * 0.6 + ((ev.clientY - d.y) / dt) * 16 * 0.4;
  d.x = ev.clientX;
  d.y = ev.clientY;
  d.t = now;
  const under = document.elementFromPoint(ev.clientX, ev.clientY)?.closest<HTMLElement>("[data-drop]") ?? null;
  if (under !== d.over) {
    d.over?.classList.remove("fx-drop-hover");
    under?.classList.add("fx-drop-hover");
    d.over = under;
  }
});

function endDrag(commit: boolean) {
  const d = dragging;
  dragging = null;
  if (!d || !d.ghost) return;
  cancelAnimationFrame(d.raf);
  // 松手后，牌从手上的位置飞到落点（或者飞回原处）
  const key = d.el.dataset.key;
  if (key) flipFrom.set(key, d.ghost.getBoundingClientRect());
  d.ghost.remove();
  d.el.classList.remove("fx-drag-src");
  d.over?.classList.remove("fx-drop-hover");
  app.classList.remove("dragging");
  suppressClickAt = Date.now();
  if (commit && d.over && d.over.dataset.drop && d.over.dataset.drop !== d.src) dropCard(d.src, d.over.dataset.drop);
  else render();
}
window.addEventListener("pointerup", () => endDrag(true));
window.addEventListener("pointercancel", () => endDrag(false));

app.addEventListener("click", (ev) => {
  if (Date.now() - suppressClickAt < 300) return; // 刚拖完，不算点击
  const target = ev.target as HTMLElement;
  const el = target.closest<HTMLElement>("[data-act]");
  if (!el || el.classList.contains("disabled")) return;
  // 点弹层内容本身不关闭弹层
  if (el.classList.contains("overlay") && target.closest("[data-stop]")) return;
  onAct(el.dataset.act!, el.dataset.arg);
});

app.addEventListener("keydown", (ev) => {
  if (ev.key === "Escape" && ui.sheet && table) return onAct("closeSheet", undefined);
  if (ev.key !== "Enter" && ev.key !== " ") return;
  const el = (ev.target as HTMLElement).closest<HTMLElement>("[data-act][role=button]");
  if (!el) return;
  ev.preventDefault();
  onAct(el.dataset.act!, el.dataset.arg);
});

// 滑块和数字框：只更新数字，不整页重画（否则拖动会中断）
app.addEventListener("input", (ev) => {
  const el = ev.target as HTMLInputElement;
  const key = el.dataset.input;
  if (!key) return;
  if (key === "debugText") { debugText = el.value.trim().replace(/^\?/, ""); return; }
  const v = Math.round(Number(el.value));
  if (!Number.isFinite(v)) return;
  if (key === "bet") ui.betAmount = v;
  if (key === "bid") ui.bid = v;
  app.querySelectorAll<HTMLInputElement>(`[data-input="${key}"]`).forEach((x) => { if (x !== el) x.value = String(v); });
  app.querySelectorAll(`[data-bind="${key}"]`).forEach((x) => { x.textContent = String(v); });
  app.querySelectorAll<HTMLElement>(".chip-btn").forEach((x) => x.classList.toggle("on", Number(x.dataset.arg) === v));
});

// ───────────────────────── 入场 ─────────────────────────

installSigil();
const gate = new Gate({
  card: (id, cls, down) => card(id, { cls, down }),
  back: (cls) => card(null, { cls }),
  save: saveInfo,
  start(s): Opening {
    debug = parseDebug(location.search);
    initTable(s, debug?.seed ?? Math.floor(Math.random() * 1e9));
    saveGame();
    consumeLog(true);
    render();
    const o = observe(table!, HUMAN);
    return {
      pool: o.me.pool.slice(), foePoolSize: o.opponent.poolSize, dealer: o.dealer, ante: o.ante,
      buyIn: table!.options.buyIn, blindEvery: table!.options.blindEvery, style: s,
    };
  },
  resume() { if (!resumeGame()) gate.show("title"); },
  sheet(kind) {
    if (kind === "chars") { ui.helpTab = "chars"; ui.sheet = { kind: "help" }; } else ui.sheet = { kind };
    render();
  },
  done() { render(); scheduleAi(); },
  canReturn: () => !!table && table.phase !== "over",
}, ART);

window.addEventListener("resize", () => render(false));
installTilt();
// 调试模式：直接开桌，跳过入场
if (debug) newTable(debug.style ?? "cautious");
else { render(); gate.show("title"); }

// 给自动化测试用：读当前牌桌（不影响游戏）
(window as unknown as { __sinSquad: unknown }).__sinSquad = {
  get table() { return table; },
  get ui() { return ui; },
};
