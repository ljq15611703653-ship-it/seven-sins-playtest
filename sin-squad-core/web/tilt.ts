/**
 * 鼠标跟随的 3D 倾斜：带 data-tilt 的元素（选对手的卡、场地候选、标题页人物）随鼠标位置朝玩家侧过来，
 * 上面一层高光跟着鼠标走。data-tilt 的值是最大倾斜角度（默认 10）。
 * 只写 --rx / --ry / --gx / --gy 四个 CSS 变量，样式在 style.css 的 [data-tilt]。触屏不倾斜。
 */

let current: HTMLElement | null = null;

function reset(el: HTMLElement | null) {
  if (!el) return;
  el.style.removeProperty("--rx");
  el.style.removeProperty("--ry");
}

export function installTilt(root: Document | HTMLElement = document) {
  root.addEventListener("pointermove", (ev) => {
    const e = ev as PointerEvent;
    if (e.pointerType !== "mouse") return;
    const el = (e.target as HTMLElement | null)?.closest?.<HTMLElement>("[data-tilt]") ?? null;
    if (el !== current) { reset(current); current = el; }
    if (!el) return;
    const r = el.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    const y = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
    const max = Number(el.dataset.tilt) || 10;
    el.style.setProperty("--ry", `${((x - 0.5) * 2 * max).toFixed(2)}deg`);
    el.style.setProperty("--rx", `${(-(y - 0.5) * 2 * max).toFixed(2)}deg`);
    el.style.setProperty("--gx", `${(x * 100).toFixed(1)}%`);
    el.style.setProperty("--gy", `${(y * 100).toFixed(1)}%`);
  });
  // pointerleave 不冒泡：在捕获阶段接住，只处理离开的正是当前那个元素
  root.addEventListener("pointerleave", (ev) => {
    if (ev.target !== current) return;
    reset(current);
    current = null;
  }, true);
}
