/**
 * 牌桌上的动作：牌换位置时滑过去（FLIP）、新牌发进来、出手冲撞、震屏，以及浮在最上层的伤害数字、气泡、碎片。
 *
 * 桌面是斜放的（CSS 3D），屏幕上的位移和元素自己坐标里的位移不一样，
 * 所以先试着挪一下量出比例（calibrate），再按比例换算，斜桌和平放的手牌区都能对准。
 */

export const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

type Rects = Map<string, DOMRect>;

/** 重画前每张牌的样子：屏幕位置、在哪个父元素的第几个、是不是背面朝上；桌上的牌还记下它在桌面坐标里的位置（收牌用）。 */
interface Seen { rect: DOMRect; parent: Element | null; index: number; down: boolean; box: Box | null }
interface Box { left: number; top: number; w: number; h: number }
export type Snapshot = Map<string, Seen>;

const indexIn = (el: Element) => (el.parentElement ? [...el.parentElement.children].indexOf(el) : -1);

/** 记下所有带 key 的牌此刻的样子。 */
export function measure(root: Element): Snapshot {
  const m: Snapshot = new Map();
  for (const el of root.querySelectorAll<HTMLElement>("[data-key]")) {
    m.set(el.dataset.key!, {
      rect: el.getBoundingClientRect(), parent: el.parentElement, index: indexIn(el), down: el.classList.contains("down"),
      box: tableBox(el),
    });
  }
  return m;
}

/**
 * 牌在桌面坐标里的位置（不含任何 transform）；不在桌上就是 null。
 * 带 3D 变换的行（.row、.center）在 Chrome 里也算 offsetParent，所以一层层往上加到 .table 为止。
 */
function tableBox(el: HTMLElement): Box | null {
  let left = 0;
  let top = 0;
  let n: HTMLElement | null = el;
  while (n && !n.classList.contains("table")) {
    left += n.offsetLeft;
    top += n.offsetTop;
    n = n.offsetParent as HTMLElement | null;
  }
  return n ? { left, top, w: el.offsetWidth, h: el.offsetHeight } : null;
}

const center = (r: DOMRect) => [r.left + r.width / 2, r.top + r.height / 2] as const;

/** 屏幕上要挪 (dx, dy)，元素自己的坐标里该挪多少。 */
export function localOffset(el: HTMLElement, dx: number, dy: number): [number, number] {
  const prev = el.style.transform;
  const a = center(el.getBoundingClientRect());
  el.style.transform = `translate(${dx}px, ${dy}px)`;
  const b = center(el.getBoundingClientRect());
  el.style.transform = prev;
  const sx = b[0] - a[0];
  const sy = b[1] - a[1];
  const kx = Math.abs(sx) > 0.5 ? dx / sx : 1;
  const ky = Math.abs(sy) > 0.5 ? dy / sy : 1;
  // 比例异常（元素被压扁、不可见）时就按原样挪
  const ok = (k: number) => Number.isFinite(k) && k > 0.2 && k < 5;
  return [dx * (ok(kx) ? kx : 1), dy * (ok(ky) ? ky : 1)];
}

const cancel = (el: Element, id: string) => el.getAnimations().forEach((a) => { if (a.id === id) a.cancel(); });

/**
 * 重画之后调用：换了位置的牌从旧位置滑到新位置，新出现的牌按顺序发进来，正反面变了的牌先抬起来再翻面。
 * 还在同一个位置（同一个父元素的同一格）的牌不滑：它们只是因为整桌缩放、操作栏变高而挪了挪，
 * 这时候全体滑一下看起来就是整桌在闪。
 * from 可以覆盖某张牌的起点（例如拖动松手时牌在鼠标下）。
 */
export function flip(root: Element, before: Snapshot, from: Rects = new Map(), deal = true) {
  if (reducedMotion()) return;
  let dealt = 0;
  for (const el of root.querySelectorAll<HTMLElement>("[data-key]")) {
    const key = el.dataset.key!;
    const seen = before.get(key);
    if (seen && seen.down !== el.classList.contains("down")) turnOver(el, seen.down);
    const stayed = seen && seen.parent === el.parentElement && seen.index === indexIn(el);
    if (stayed && !from.has(key)) continue;
    const old = from.get(key) ?? seen?.rect;
    if (!old) {
      // “发现”里的牌有自己的出场动画（CSS），不走发牌
      if (!deal || el.closest(".discover")) continue;
      cancel(el, "flip");
      // 不用 opacity 淡入：3D 里的牌一改 opacity 就会被压平，动画结束再恢复立体，整桌会闪一下。
      // 用 visibility（等待期间藏着，开始飞时出现），它不影响 3D。
      const a = el.animate(
        [
          { transform: "translate(0, -70px) translateZ(110px) rotateZ(-8deg) scale(.85)", visibility: "hidden" },
          { transform: "translate(0, -64px) translateZ(100px) rotateZ(-7deg) scale(.86)", visibility: "visible", offset: 0.02 },
          { transform: "none", visibility: "visible" },
        ],
        { duration: 420, delay: 70 * dealt++, easing: "cubic-bezier(.2,.8,.3,1.1)", fill: "backwards" },
      );
      a.id = "flip";
      continue;
    }
    const now = el.getBoundingClientRect();
    const [ox, oy] = center(old);
    const [nx, ny] = center(now);
    const sdx = ox - nx;
    const sdy = oy - ny;
    const grow = old.width / Math.max(1, now.width);
    if (Math.abs(sdx) < 1 && Math.abs(sdy) < 1 && Math.abs(grow - 1) < 0.02) continue;
    cancel(el, "flip");
    const [dx, dy] = localOffset(el, sdx, sdy);
    const dist = Math.hypot(sdx, sdy);
    // 走得远的牌中途抬起来一点，像被拿起来再放下
    const lift = Math.min(60, dist * 0.18);
    const a = el.animate(
      [
        { transform: `translate(${dx}px, ${dy}px) scale(${grow})` },
        { transform: `translate(${dx * 0.45}px, ${dy * 0.45}px) translateZ(${lift}px) scale(${(grow + 1) / 2 + 0.04})`, offset: 0.55 },
        { transform: "none" },
      ],
      { duration: Math.min(520, 240 + dist * 0.5), easing: "cubic-bezier(.3,.7,.35,1)" },
    );
    a.id = "flip";
  }
}

/**
 * 翻面：先把牌抬起来（离桌面超过半张牌宽，转到侧面时才不会插进桌面），在空中翻过去，再落回桌面。
 * .flip 的最终角度由 .card.down 决定，这里只补中间的弧线；wasDown 是翻之前的朝向。
 * 横放的长条牌（.tile：场地、规则、公共效果）绕水平轴翻，只需要抬起半个牌高。
 */
function turnOver(el: HTMLElement, wasDown: boolean, delayMs?: number) {
  const f = el.querySelector<HTMLElement>(":scope > .lift > .flip");
  if (!f) return;
  cancel(f, "turn");
  const tile = el.classList.contains("tile");
  const axis = tile ? "X" : "Y";
  const reach = tile ? el.offsetHeight : el.offsetWidth;
  const a = wasDown ? 180 : 0;
  const b = wasDown ? 0 : 180;
  const at = (k: number) => a + (b - a) * k;
  const delay = delayMs ?? (parseFloat(getComputedStyle(el).getPropertyValue("--flip-delay")) || 0);
  // 翻的时候远端那条边也会转到眼前，平时藏着的上沿先露出来
  el.classList.add("fx-turning");
  const anim = f.animate(
    [
      { transform: `translateZ(0) rotate${axis}(${a}deg)` },
      { transform: `translateZ(${reach * 0.62}px) rotate${axis}(${at(0.06)}deg)`, offset: 0.28, easing: "cubic-bezier(.45,0,.55,1)" },
      { transform: `translateZ(${reach * 0.66}px) rotate${axis}(${at(0.94)}deg)`, offset: 0.72, easing: "cubic-bezier(.6,0,.9,.5)" },
      { transform: `translateZ(0) rotate${axis}(${b}deg)` },
    ],
    { duration: 820, delay, easing: "cubic-bezier(.3,0,.3,1)", fill: "backwards" },
  );
  anim.id = "turn";
  const done = () => el.classList.remove("fx-turning");
  anim.finished.then(done, done);
}

/** 牌桌外面（入场的牌池等）直接翻一张牌：切换 .down，并播抬起再翻的弧线。 */
export function turnCard(el: HTMLElement, toDown: boolean, delayMs = 0) {
  if (el.classList.contains("down") === toDown) return;
  el.classList.toggle("down", toDown);
  if (!reducedMotion()) turnOver(el, !toDown, delayMs);
}

/**
 * 转线：牌抬起来，侧身滑向要去的那条线（dir = -1 往左、1 往右），停在偏出去的位置；
 * facing：牌的前沿朝哪（我方 1 是上沿，对手 -1 是下沿），侧身方向跟着反过来。
 * 偏出去的样子由 .card.switching 保持，这里只补抬起和落下的弧线。
 */
export function laneShift(el: HTMLElement | null, dir: number, ms: number, facing = 1) {
  if (!el || reducedMotion()) return;
  const w = el.offsetWidth;
  const anim = el.animate(
    [
      { transform: "none" },
      { transform: `translateZ(${w * 0.25}px) rotateY(${dir * facing * -14}deg)`, offset: 0.35 },
      { transform: `translateZ(${w * 0.18}px) rotateY(${dir * facing * -6}deg)`, offset: 0.7 },
      { transform: "none" },
    ],
    { duration: ms, easing: "ease-in-out" },
  );
  anim.id = "lane";
}

/**
 * 出手：抬起、后仰蓄力、冲向目标、砸下去、回到原位。
 * reach = 1 冲到两张牌刚好碰上，小于 1 只冲一部分（反击）。
 * 返回撞上目标的那一刻，调用方在这时播受击、震屏、伤害数字。
 */
export function strike(from: HTMLElement | null, to: HTMLElement | null, ms: number, reach = 1, recoil = false): Promise<void> {
  if (!from || !to || reducedMotion()) return new Promise((r) => setTimeout(r, ms * 0.5));
  cancel(from, "flip");
  cancel(from, "strike");
  const [ax, ay] = center(from.getBoundingClientRect());
  const tr = to.getBoundingClientRect();
  const [bx, by] = center(tr);
  const len = Math.hypot(bx - ax, by - ay) || 1;
  // 停在两张牌刚好碰上的地方
  const stop = Math.max(0, len - tr.height * 0.62) / len;
  const [dx, dy] = localOffset(from, (bx - ax) * stop * reach, (by - ay) * stop * reach);
  const hit = 0.58;
  // 撞上的那一刻也不落回桌面：牌的后半截这时还悬在中间那一行（场地 / 规则 / 公共效果）上方，
  // 落到 0 会插进那几块牌里；停在 CLEAR 高度，底面同时高过中间那一行和被打的那张牌
  const CLEAR = 14;
  // 反击：被打的人贴着桌面往前顶一下（最多抬 4px），不能像出手那样跳起来——攻击者这时正悬在它上方
  const frames: Keyframe[] = recoil ? [
    { transform: "none", zIndex: 8 },
    { transform: `translate(${dx}px, ${dy}px) translateZ(4px)`, offset: hit, easing: "ease-out", zIndex: 8 },
    { transform: "none", zIndex: 8 },
  ] : [
    { transform: "none", zIndex: 9 },
    { transform: `translate(${-dx * 0.08}px, ${-dy * 0.08}px) translateZ(46px) rotateX(${dy > 0 ? -10 : 10}deg)`, offset: 0.26, easing: "cubic-bezier(.5,0,.9,.4)", zIndex: 9 },
    { transform: `translate(${dx}px, ${dy}px) translateZ(${CLEAR + 18}px)`, offset: hit - 0.04, zIndex: 9 },
    { transform: `translate(${dx * 0.94}px, ${dy * 0.94}px) translateZ(${CLEAR}px)`, offset: hit, easing: "ease-out", zIndex: 9 },
    { transform: `translate(${dx * 0.9}px, ${dy * 0.9}px) translateZ(${CLEAR + 4}px)`, offset: 0.7, easing: "cubic-bezier(.4,0,.2,1)", zIndex: 9 },
    { transform: "none", zIndex: 9 },
  ];
  const a = from.animate(
    frames,
    { duration: ms },
  );
  a.id = "strike";
  return new Promise((r) => setTimeout(r, ms * hit));
}

/** 震屏：power 1 是普通一击，2 是重击或倒下。 */
export function shake(el: HTMLElement | null, power = 1) {
  if (!el || reducedMotion()) return;
  const p = 3 * power;
  const k = (x: number, y: number, r = 0) => ({ transform: `translate(${x * p}px, ${y * p}px) rotate(${r * power * 0.25}deg)` });
  el.animate([k(0, 0), k(-1, 0.8, -1), k(1, -0.6, 1), k(-0.6, -0.4), k(0.5, 0.5, 0.5), k(-0.2, 0.2), k(0, 0)], { duration: 260 + 60 * power, easing: "ease-out" });
}

/** 给元素加一个一次性的 fx- 动画 class，ms 后摘掉（morph 不会误删 fx- class）。 */
export function pulse(el: Element | null, cls: string, ms: number) {
  if (!el) return;
  el.classList.remove(cls);
  void (el as HTMLElement).offsetWidth;
  el.classList.add(cls);
  setTimeout(() => el.classList.remove(cls), ms);
}

// ───────── 最上层的平面特效：不跟着桌面倾斜，字始终正对玩家 ─────────

function hud(): HTMLElement {
  let layer = document.querySelector<HTMLElement>(".fx-layer");
  if (!layer) {
    layer = document.createElement("div");
    layer.className = "fx-layer";
    layer.setAttribute("data-fx", "");
    layer.setAttribute("aria-hidden", "true");
    document.body.appendChild(layer);
  }
  return layer;
}

/** 牌停在原位时的位置：正在冲撞 / 滑动的牌，按动画结束（回到原位）那一刻量。 */
function homeRect(el: Element): DOMRect {
  const moving = el.getAnimations().filter((a) => a.id === "strike" || a.id === "flip" || a.id === "lane");
  const saved = moving.map((a) => a.currentTime);
  for (const a of moving) a.currentTime = Number(a.effect?.getComputedTiming().endTime ?? 0) - 1;
  const r = el.getBoundingClientRect();
  moving.forEach((a, i) => { a.currentTime = saved[i]; });
  return r;
}

function place(target: Element, cls: string, html: string, ms: number, at: "center" | "top" | "bottom" = "center", delay = 0) {
  const r = homeRect(target);
  const d = document.createElement("div");
  d.className = cls;
  d.innerHTML = html;
  d.style.left = `${r.left + r.width / 2}px`;
  d.style.top = `${at === "top" ? r.top : at === "bottom" ? r.bottom : r.top + r.height * 0.42}px`;
  d.style.setProperty("--cw", `${r.width}px`);
  if (delay) d.style.animationDelay = `${delay}ms`;
  hud().appendChild(d);
  setTimeout(() => d.remove(), ms + delay);
  return d;
}

/** 飘字：伤害、治疗、反击、转线等。 */
export function floater(target: Element | null, text: string, cls: string, delay = 0) {
  if (!target) return;
  const html = cls === "dmg" ? `<b>${text}</b>` : text;
  place(target, `floater ${cls}`, html, 1400, "center", delay);
}

/** 能力、场地、公共效果生效时冒出的说明气泡。 */
export function bubble(target: Element | null, html: string, env: boolean, below: boolean) {
  if (!target) return;
  place(target, `bubble ${env ? "env" : "own"} ${below ? "below" : "above"}`, html, 1900, below ? "bottom" : "top");
}

/** 屏障碎裂：一圈光环炸开，碎片四散。 */
export function shatter(target: Element | null) {
  if (!target) return;
  let shards = "";
  for (let i = 0; i < 12; i++) {
    const ang = (i / 12) * Math.PI * 2 + Math.random() * 0.4;
    const dist = 50 + Math.random() * 45;
    shards += `<i style="--x:${(Math.cos(ang) * dist).toFixed(0)}px;--y:${(Math.sin(ang) * dist).toFixed(0)}px;--r:${Math.floor(Math.random() * 540 - 270)}deg;--s:${(0.6 + Math.random() * 0.8).toFixed(2)}"></i>`;
  }
  place(target, "shatter", `<span class="ring"></span>${shards}`, 900);
}

/** 倒下：碎成几块往下掉。 */
export function crumble(target: Element | null) {
  if (!target) return;
  place(target, "crumble", "<i></i><i></i><i></i><i></i><i></i><i></i>", 1100);
}

/**
 * 收牌：一手结束后，桌上的牌（两排人物和中间三块）一张接一张抬起来、在空中翻到背面，滑到桌子右边摞起来后消失。
 * 牌从原来那一行里拿出来，直接挂在桌面上、钉在原来的位置，所以动画还在斜桌的 3D 里，也不影响新画面的排版。
 * 返回 false 表示不收（不在桌上、或者系统要求减少动态效果），调用方直接删掉。
 */
export function collect(el: HTMLElement, seen: Seen | undefined, order: number): boolean {
  const table = el.closest<HTMLElement>(".table");
  if (!table || !seen?.box || reducedMotion()) return false;
  const b = seen.box;
  el.removeAttribute("data-key");
  for (const k of ["data-act", "data-arg", "data-drag", "data-drop", "data-unit", "role", "tabindex"]) el.removeAttribute(k);
  el.setAttribute("data-fx", "");
  el.classList.add("fx-collect");
  Object.assign(el.style, { position: "absolute", left: `${b.left}px`, top: `${b.top}px`, width: `${b.w}px`, height: `${b.h}px`, margin: "0" });
  table.appendChild(el);
  const delay = order * 70;
  if (!el.classList.contains("down")) {
    el.classList.add("down");
    turnOver(el, false, delay);
  }
  // 桌面坐标里直接算：牌挂在 .table 上，平移就是沿着斜放的桌面走
  const dx = table.clientWidth - 34 - (b.left + b.w / 2);
  const dy = table.clientHeight * 0.5 - (b.top + b.h / 2);
  const spin = (order % 2 ? 1 : -1) * (6 + (order % 3) * 4);
  el.animate([
    { transform: "none" },
    { transform: "translateZ(30px)", offset: 0.4, easing: "cubic-bezier(.4,0,.2,1)" },
    { transform: `translate(${dx}px, ${dy}px) translateZ(${14 + order}px) rotate(${spin}deg) scale(.62)`, offset: 0.88 },
    { transform: `translate(${dx}px, ${dy}px) translateZ(${14 + order}px) rotate(${spin}deg) scale(.6)`, visibility: "hidden" },
  ], { duration: 1150, delay, easing: "cubic-bezier(.45,0,.3,1)", fill: "forwards" }).finished.then(() => el.remove(), () => el.remove());
  return true;
}

/**
 * “发现”里的牌退场：被挑走的那张先抬起来一亮，再缩小飞向挑它的人（target 是座位头像）；
 * 没人要的沉下去消失。牌从原来的格子里拿出来钉在发现层上，不影响剩下的牌重新排开。
 */
export function discoverExit(el: HTMLElement, rect: DOMRect | undefined, target: Element | null, order: number): boolean {
  const layer = el.closest<HTMLElement>(".discover");
  if (!layer || !rect || reducedMotion()) return false;
  const L = layer.getBoundingClientRect();
  el.removeAttribute("data-key");
  for (const k of ["data-act", "data-arg", "role", "tabindex"]) el.removeAttribute(k);
  el.setAttribute("data-fx", "");
  el.classList.add("fx-leave");
  Object.assign(el.style, {
    position: "absolute", left: `${rect.left - L.left}px`, top: `${rect.top - L.top}px`,
    width: `${rect.width}px`, height: `${rect.height}px`, margin: "0", animation: "none",
  });
  layer.appendChild(el);
  let anim: Animation;
  if (target) {
    const t = target.getBoundingClientRect();
    const dx = t.left + t.width / 2 - (rect.left + rect.width / 2);
    const dy = t.top + t.height / 2 - (rect.top + rect.height / 2);
    anim = el.animate([
      { transform: "none" },
      { transform: "translateZ(60px) scale(1.12)", offset: 0.3, easing: "cubic-bezier(.4,0,.2,1)" },
      { transform: `translate(${dx * 0.4}px, ${dy * 0.4}px) translateZ(40px) scale(.7) rotate(${dx > 0 ? 8 : -8}deg)`, offset: 0.6 },
      { transform: `translate(${dx}px, ${dy}px) scale(.16)`, visibility: "hidden" },
    ], { duration: 900, easing: "cubic-bezier(.5,0,.3,1)", fill: "forwards" });
  } else {
    anim = el.animate([
      { transform: "none" },
      { transform: "translateY(70px) scale(.7) rotateX(30deg)", visibility: "hidden" },
    ], { duration: 480, delay: order * 70, easing: "cubic-bezier(.5,0,.8,.4)", fill: "forwards" });
  }
  anim.finished.then(() => el.remove(), () => el.remove());
  return true;
}
