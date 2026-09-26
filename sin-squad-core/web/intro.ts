import type { Style } from "../src/ai/agents.js";
import { character } from "../src/content/characters.js";
import type { Seat, Sin } from "../src/types.js";
import { turnCard } from "./motion.js";
import { isMuted, toggleMuted } from "./music.js";
import { SIN_LATIN } from "./sigil.js";
import { HUMAN, SIN_COLOR } from "./text.js";

/**
 * 进入牌桌之前的几屏：标题 → 选对手 → 起始牌池 → 抛筹码定庄 → 入座。
 * 画在牌桌外面单独的一层（#gate），只通过 hooks 和牌桌打交道。
 */

export interface SaveInfo { handNo: number; stacks: [number, number]; style: Style }

export interface Opening {
  pool: string[];
  foePoolSize: number;
  dealer: Seat;
  ante: number;
  buyIn: number;
  blindEvery: number;
  style: Style;
}

export interface GateHooks {
  /** 画一张人物牌（用牌桌那边同一套有厚度的 3D 卡面）；down = 背面朝上。 */
  card(id: string, cls?: string, down?: boolean): string;
  back(cls?: string): string;
  save(): SaveInfo | null;
  /** 开一张新桌，返回开局信息（牌池、庄家等）。 */
  start(style: Style): Opening;
  resume(): void;
  /** 打开牌桌那边的弹层：规则 / 人物图鉴 / 调试。 */
  sheet(kind: "help" | "chars" | "debug"): void;
  /** 入场流程结束，把画面交给牌桌。 */
  done(): void;
  /** 从牌桌里点“新桌”进来时，可以回到原来的牌桌。 */
  canReturn(): boolean;
}

/** 对手：每种电脑风格一名，立绘是 web/art/foe-<风格>.webp 的半身像。 */
export const OPPONENTS: Record<Style, { title: string; sin: Sin; quote: string; about: string; level: string }> = {
  cautious: {
    title: "谨慎的税官", sin: "贪婪", quote: "不见兔子不撒鹰。",
    about: "很少诈唬，拿到好牌才加注，形势不对就弃牌。", level: "适合第一次玩",
  },
  aggressive: {
    title: "激进的挑衅者", sin: "愤怒", quote: "跟，还是不跟？",
    about: "频繁下注、加注，逼你做决定；但她的牌不一定好。", level: "压力大",
  },
  bluff: {
    title: "爱诈唬的魅惑者", sin: "色欲", quote: "你猜我亮的是真的吗？",
    about: "常用弱牌下大注，也会拿着好牌装弱。", level: "最难读",
  },
};

/** 标题页上七罪各一名的代表人物。 */
const HEROES = ["WR3", "GR3", "GL2", "EN1", "SL2", "PR3", "LU3"];

type Screen =
  | { kind: "title" }
  | { kind: "opponent" }
  | { kind: "pool"; open: Opening }
  | { kind: "toss"; open: Opening; landed: boolean }
  | { kind: "seat"; open: Opening };

const FAST_KEY = "sinsquad.fastStart.v1";
function readFast(): boolean {
  try { return localStorage.getItem(FAST_KEY) === "1"; } catch { return false; }
}
function writeFast(v: boolean) {
  try { localStorage.setItem(FAST_KEY, v ? "1" : "0"); } catch { /* 存不了只影响下次 */ }
}

export class Gate {
  private screen: Screen | null = null;
  private fast = readFast();
  private timer: number | null = null;
  private readonly root: HTMLElement;
  private readonly art: Set<string>;

  constructor(private readonly hooks: GateHooks, art: Set<string>) {
    this.art = art;
    this.root = document.createElement("div");
    this.root.id = "gate";
    document.body.appendChild(this.root);
    this.root.addEventListener("click", (ev) => {
      const el = (ev.target as HTMLElement).closest<HTMLElement>("[data-go]");
      if (el) this.go(el.dataset.go!, el.dataset.arg);
    });
    this.root.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape" && this.screen?.kind === "opponent") return this.go("back");
      if (ev.key !== "Enter" && ev.key !== " ") return;
      const el = (ev.target as HTMLElement).closest<HTMLElement>("[data-go][role=button]");
      if (el) { ev.preventDefault(); this.go(el.dataset.go!, el.dataset.arg); }
    });
  }

  get open(): boolean { return this.screen !== null; }

  show(kind: "title" | "opponent") {
    this.screen = { kind };
    this.draw();
  }

  hide() {
    this.clearTimer();
    this.screen = null;
    this.draw();
  }

  private clearTimer() {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  private go(what: string, arg?: string) {
    if (what === "music") {
      // 只换按钮本身：不清计时器、不重画（抛筹码转到一半重画会从头再转，入座横幅也会停住）
      toggleMuted();
      const b = this.root.querySelector<HTMLElement>(".gate-music");
      if (b) b.outerHTML = this.musicButton();
      return;
    }
    this.clearTimer();
    const s = this.screen;
    switch (what) {
      case "play": this.screen = { kind: "opponent" }; break;
      case "resume": this.hide(); this.hooks.resume(); return;
      case "help": case "chars": case "debug": this.hooks.sheet(what); return;
      case "back":
        if (this.hooks.canReturn()) { this.hide(); this.hooks.done(); return; }
        this.screen = { kind: "title" };
        break;
      case "fast": this.fast = !this.fast; writeFast(this.fast); break;
      case "pick": {
        const open = this.hooks.start(arg as Style);
        if (this.fast) { this.hide(); this.hooks.done(); return; }
        this.screen = { kind: "pool", open };
        break;
      }
      case "toss":
        if (s?.kind === "pool") this.screen = { kind: "toss", open: s.open, landed: false };
        break;
      case "seat":
        if (s?.kind === "toss" || s?.kind === "pool") this.screen = { kind: "seat", open: s.open };
        break;
      case "skip": case "sit": this.hide(); this.hooks.done(); return;
    }
    this.draw();
    const now = this.screen;
    // 筹码转完再显示结果；入座横幅停一会儿自动进牌桌
    if (now?.kind === "toss" && !now.landed) {
      // 只改结果和按钮，不重画（重画会让筹码从头再转一遍）
      this.timer = window.setTimeout(() => {
        now.landed = true;
        this.root.querySelector(".toss-result")?.classList.add("shown");
        const seat = this.root.querySelector<HTMLElement>("[data-go=seat]");
        seat?.classList.remove("disabled");
        seat?.focus();
      }, 1900);
    }
    // 起始牌池：8 张牌背面朝上发到小桌垫上，再一张接一张抬起来翻开
    if (now?.kind === "pool") {
      this.root.querySelectorAll<HTMLElement>(".pool-cards .card").forEach((el, i) => {
        window.setTimeout(() => { if (this.screen === now) turnCard(el, false); }, 450 + i * 150);
      });
    }
    if (now?.kind === "seat") {
      this.timer = window.setTimeout(() => { if (this.screen === now) this.go("sit"); }, 2600);
    }
  }

  private draw() {
    const s = this.screen;
    document.body.classList.toggle("gated", !!s);
    if (!s) { this.root.innerHTML = ""; return; }
    this.root.className = `gate-${s.kind}`;
    this.root.innerHTML = this.view(s) + this.musicButton();
    this.root.querySelector<HTMLElement>("[autofocus]")?.focus();
  }

  private musicButton() {
    const off = isMuted();
    return `<button class="gate-music music-btn ${off ? "" : "on"}" data-go="music" aria-pressed="${!off}" title="${off ? "打开音乐" : "关闭音乐"}">${off ? "♪ 关" : "♪ 开"}</button>`;
  }

  private portrait(id: string, cls = "") {
    return this.figure(id, character(id).sin, cls);
  }

  private foeFace(style: Style, cls = "") {
    return this.figure(`foe-${style}`, OPPONENTS[style].sin, `bust ${cls}`);
  }

  private figure(art: string, sin: Sin, cls: string) {
    return `<div class="hero ${cls}" style="--sin:${SIN_COLOR[sin]}">
      <span class="hero-glyph">${SIN_LATIN[sin]}</span>
      ${this.art.has(art) ? `<img src="art/${art}.webp" alt="" draggable="false">` : ""}
    </div>`;
  }

  private view(s: Screen): string {
    switch (s.kind) {
      case "title": return this.titleView();
      case "opponent": return this.opponentView();
      case "pool": return this.poolView(s.open);
      case "toss": return this.tossView(s.open, s.landed);
      case "seat": return this.seatView(s.open);
    }
  }

  private titleView() {
    const save = this.hooks.save();
    const heroes = HEROES.map((id, i) => this.portrait(id, `h${i}`)).join("");
    return `<div class="title-stage">
      <div class="heroes" data-tilt="5">${heroes}</div>
      <div class="logo-latin">SEPTEM · PECCATA · MORTALIA</div>
      <h1 class="logo">七罪暗队</h1>
      <p class="tagline">德州扑克的下注 × 酒馆战棋的自动战斗<br><small>只亮一张牌，剩下的全靠你讲故事</small></p>
      <div class="gate-actions">
        ${save ? `<button class="primary big" data-go="resume" autofocus>继续牌桌<small>第 ${save.handNo} 手 · 你 ${save.stacks[HUMAN]} 筹码 · 对手${OPPONENTS[save.style].title}</small></button>` : ""}
        <button class="${save ? "" : "primary"} big" data-go="play" ${save ? "" : "autofocus"}>${save ? "开一张新桌" : "开始对局"}</button>
        <div class="gate-row">
          <button data-go="help">规则</button>
          <button data-go="chars">人物图鉴</button>
        </div>
      </div>
      <button class="gate-debug" data-go="debug">调试开局</button>
      <div class="gate-version">v0.3 试玩</div>
    </div>`;
  }

  private opponentView() {
    const cards = (Object.keys(OPPONENTS) as Style[]).map((k) => {
      const o = OPPONENTS[k];
      return `<div class="foe-card" data-go="pick" data-arg="${k}" role="button" tabindex="0" data-tilt="12">
        ${this.foeFace(k, "foe-face")}
        <div class="foe-info">
          <b>${o.title}</b>
          <q>${o.quote}</q>
          <p>${o.about}</p>
          <span class="foe-level">${o.level}</span>
        </div>
      </div>`;
    }).join("");
    const warn = this.hooks.canReturn() ? `<p class="gate-warn">开新桌会放弃当前这张牌桌</p>` : "";
    return `<div class="gate-panel">
      <button class="gate-back" data-go="back" aria-label="返回">‹ ${this.hooks.canReturn() ? "回到牌桌" : "返回"}</button>
      <h2>选择对手</h2>
      <p class="gate-sub">你和对手各带 100 筹码入座，赢光对方就赢下牌桌。</p>
      ${warn}
      <div class="foe-list">${cards}</div>
      <label class="gate-check" data-go="fast" role="button" tabindex="0">
        <span class="box ${this.fast ? "on" : ""}"></span>快速开局：跳过牌池展示和定庄
      </label>
    </div>`;
  }

  private poolView(open: Opening) {
    const cards = open.pool.map((id, i) => `<div class="pool-slot" style="--i:${i}">${this.hooks.card(id, "small", true)}</div>`).join("");
    const sins = new Map<string, number>();
    let multi = 0;
    for (const id of open.pool) {
      const c = character(id);
      sins.set(c.sin, (sins.get(c.sin) ?? 0) + 1);
      if (c.shape === "multi") multi++;
    }
    const by = (f: (id: string) => number) => open.pool.reduce((a, b) => (f(b) > f(a) ? b : a));
    const hitter = character(by((id) => character(id).atk));
    const tank = character(by((id) => character(id).hp));
    const n = open.pool.length;
    const sinChips = [...sins].sort((a, b) => b[1] - a[1])
      .map(([sin, k]) => `<span class="sin-chip" style="--sin:${SIN_COLOR[sin as keyof typeof SIN_COLOR]}">${sin} ×${k}</span>`).join("");
    const foe = Array.from({ length: Math.min(open.foePoolSize, 8) }, () => `<i></i>`).join("");
    return `<div class="gate-panel wide">
      <h2>你的起始牌池</h2>
      <p class="gate-sub">从全部人物里随机抽了 ${n} 名。每手从这里随机发 4 名，挑 3 名上场。</p>
      <div class="pool-mat"><div class="pool-cards">${cards}</div></div>
      <div class="pool-sum" style="--delay:${n * 120 + 500}ms">
        <div class="sin-chips">${sinChips}</div>
        <div class="pool-stats">攻最高 <b>${hitter.name} ${hitter.atk}</b> · 血最厚 <b>${tank.name} ${tank.hp}</b> · 连击 ${multi} 名 · 重击 ${n - multi} 名</div>
        <div class="foe-pool"><span class="mini-backs">${foe}</span>对手也有 ${open.foePoolSize} 名——你一个都看不到，她也看不到你的。</div>
      </div>
      <div class="gate-actions row">
        <button data-go="skip">跳过，直接开局</button>
        <button class="primary big" data-go="toss" autofocus>定庄 ›</button>
      </div>
    </div>`;
  }

  private tossView(open: Opening, landed: boolean) {
    const mine = open.dealer === HUMAN;
    return `<div class="gate-panel">
      <h2>抛筹码定庄</h2>
      <div class="coin-stage">
        <div class="coin ${mine ? "lands-me" : "lands-foe"}">
          ${Array.from({ length: 9 }, (_, i) => `<i class="coin-rim" style="--z:${(i - 4) * 1.25}px"></i>`).join("")}
          <div class="coin-face me">你</div>
          <div class="coin-face foe">${this.foeFace(open.style, "coin-hero")}</div>
        </div>
        <div class="coin-shadow"></div>
      </div>
      <div class="toss-result ${landed ? "shown" : ""}">
        <b>${mine ? "你是第 1 手的庄家" : `${OPPONENTS[open.style].title}是第 1 手的庄家`}</b>
        <p>庄家<em>后布阵</em>，能先看到对手亮出的那一名再做决定；非庄家在战斗里<em>先出手</em>。之后每手轮换。</p>
      </div>
      <div class="gate-actions row">
        <button data-go="skip">跳过</button>
        <button class="primary big ${landed ? "" : "disabled"}" data-go="seat" ${landed ? "autofocus" : ""}>入座 ›</button>
      </div>
    </div>`;
  }

  private seatView(open: Opening) {
    return `<div class="seat-banner" data-go="sit" role="button" tabindex="0" autofocus>
      <div class="seat-hand">第 1 手</div>
      <div class="seat-lines">
        <span>各 <b>${open.buyIn}</b> 筹码</span>
        <span>底注 <b>${open.ante}</b></span>
        <span>每 <b>${open.blindEvery}</b> 手升盲</span>
      </div>
      <div class="seat-goal">赢光对方的筹码，就赢下这张牌桌</div>
      <small>点一下开始</small>
    </div>`;
  }
}
