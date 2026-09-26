/**
 * 把新的 HTML 增量套到已有的 DOM 上：只改变化的属性和文字，元素本身尽量留着。
 *
 * - 带 data-key 的元素按 key 认领，可以跨父元素移动（手牌拖上场、揭牌、换位时还是同一个元素），
 *   所以 CSS 过渡、正在播的动画、已经载入的图片都不会被打断。
 * - 不带 key 的元素按位置和标签名复用。
 * - 带 data-fx 的元素是动画临时挂上去的（伤害数字、气泡、碎片），morph 不碰它们，由动画自己删除。
 * - class 里以 fx- 开头的是动画临时加的，morph 保留它们。
 * - 这次没人认领、要删掉的带 key 元素先交给 onExit：它返回 true 就由它自己播完退场动画再删（例如对局结束把牌收走）。
 */

const isFx = (n: Node | null): boolean => n instanceof Element && n.hasAttribute("data-fx");
const skipFx = (n: ChildNode | null): ChildNode | null => {
  while (n && isFx(n)) n = n.nextSibling;
  return n;
};
const keyOf = (n: Node): string | null => (n instanceof Element ? n.getAttribute("data-key") : null);
/** a 在 b 后面（同一个父元素里）。 */
const isAfter = (a: Node, b: Node) => !!(b.compareDocumentPosition(a) & Node.DOCUMENT_POSITION_FOLLOWING);

export function morph(root: Element, html: string, onExit?: (el: Element) => boolean) {
  const tpl = document.createElement("template");
  tpl.innerHTML = html;
  const pool = new Map<string, Element>();
  for (const el of root.querySelectorAll("[data-key]")) pool.set(el.getAttribute("data-key")!, el);
  const leftovers: Element[] = [];

  function compatible(a: ChildNode, b: Node): boolean {
    if (a.nodeType !== b.nodeType) return false;
    if (!(a instanceof Element)) return true;
    return !a.hasAttribute("data-key") && a.tagName === (b as Element).tagName;
  }

  function update(el: ChildNode, to: Node) {
    if (!(el instanceof Element)) {
      if (el.nodeValue !== to.nodeValue) el.nodeValue = to.nodeValue;
      return;
    }
    const next = to as Element;
    for (const { name } of [...el.attributes]) {
      if (!next.hasAttribute(name) && name !== "class") el.removeAttribute(name);
    }
    for (const { name, value } of [...next.attributes]) {
      if (name === "class") continue;
      if (el.getAttribute(name) !== value) el.setAttribute(name, value);
    }
    const fx = [...el.classList].filter((c) => c.startsWith("fx-"));
    const cls = [next.getAttribute("class") ?? "", ...fx].join(" ").replace(/\s+/g, " ").trim();
    if ((el.getAttribute("class") ?? "") !== cls) {
      if (cls) el.setAttribute("class", cls);
      else el.removeAttribute("class");
    }
    // 输入框的当前值在属性之外；正在操作的那个不去动它
    if (el instanceof HTMLInputElement && el !== document.activeElement) {
      const v = next.getAttribute("value") ?? "";
      if (el.value !== v) el.value = v;
    }
    patch(el, next);
  }

  function patch(from: Element, to: Element) {
    let cursor = skipFx(from.firstChild);
    for (const n of [...to.childNodes]) {
      const key = keyOf(n);
      let match: ChildNode | null = null;
      if (key) {
        const hit = pool.get(key);
        if (hit && hit.tagName === (n as Element).tagName) {
          match = hit;
          pool.delete(key);
        }
      } else if (cursor && compatible(cursor, n)) {
        match = cursor;
      }
      if (match && match !== cursor && match.parentNode === from && cursor && isAfter(match, cursor)) {
        // 认领到的是同一行里更靠后的元素（中间有元素被拿走了）：跳过中间那些，不去搬动它。
        // 搬动 DOM 会让元素上的 CSS 动画从头重播（例如“发现”里剩下的牌又从隐藏开始出场一遍）
        while (cursor && cursor !== match) {
          const nx = skipFx(cursor.nextSibling);
          if (keyOf(cursor)) leftovers.push(cursor as Element);
          else cursor.remove();
          cursor = nx;
        }
      }
      if (match) {
        if (match === cursor) cursor = skipFx(cursor.nextSibling);
        else from.insertBefore(match, cursor);
        update(match, n);
      } else {
        const fresh = n.cloneNode(false) as ChildNode;
        from.insertBefore(fresh, cursor);
        if (fresh instanceof Element) patch(fresh, n as Element);
      }
    }
    while (cursor) {
      const nx = skipFx(cursor.nextSibling);
      // 带 key 的先留着，别处可能还要认领；最后没人要再删
      if (keyOf(cursor)) leftovers.push(cursor as Element);
      else cursor.remove();
      cursor = nx;
    }
  }

  patch(root, tpl.content as unknown as Element);
  for (const el of leftovers) {
    if (!pool.has(el.getAttribute("data-key")!)) continue;
    if (!onExit?.(el)) el.remove();
  }
}
