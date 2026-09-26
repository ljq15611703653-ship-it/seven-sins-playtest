import type { Sin } from "../src/types.js";
import { SIN_COLOR } from "./text.js";

/**
 * 七罪的纹章：七芒星（{7/3} 星形）套在双环里，七个角上各嵌一颗罪色宝石，中间写 VII。
 * 宝石按大格里高利的七罪次序排：傲慢在顶上，顺时针贪婪、色欲、嫉妒、暴食、愤怒、怠惰。
 * 生成一张 SVG，作为 CSS 变量 --sigil 给牌背、长条牌背、标题页用。
 */

/** 七罪的拉丁名（卡面水印、详情页、装饰文字）。 */
export const SIN_LATIN: Record<Sin, string> = {
  傲慢: "SUPERBIA",
  贪婪: "AVARITIA",
  色欲: "LUXURIA",
  嫉妒: "INVIDIA",
  暴食: "GULA",
  愤怒: "IRA",
  怠惰: "ACEDIA",
};

const ORDER: Sin[] = ["傲慢", "贪婪", "色欲", "嫉妒", "暴食", "愤怒", "怠惰"];

const pt = (r: number, i: number, n = 7, turn = 0) => {
  const a = -Math.PI / 2 + ((i + turn) * 2 * Math.PI) / n;
  return [r * Math.cos(a), r * Math.sin(a)].map((v) => v.toFixed(2)).join(" ");
};

/** {7/k} 星形的路径。 */
const star = (r: number, k: number) => `M${Array.from({ length: 7 }, (_, i) => pt(r, (i * k) % 7)).join("L")}Z`;

export function sigilSvg(): string {
  const gems = ORDER.map((sin, i) => {
    const [x, y] = pt(84, i).split(" ").map(Number);
    return `<circle cx='${x}' cy='${y}' r='8.5' fill='${SIN_COLOR[sin]}' stroke='url(#g)' stroke-width='2.2'/>` +
      `<circle cx='${(x - 2.6).toFixed(2)}' cy='${(y - 2.6).toFixed(2)}' r='2.6' fill='#fff' fill-opacity='.55'/>`;
  }).join("");
  const dots = Array.from({ length: 21 }, (_, i) => {
    const [x, y] = pt(93.5, i, 21, 0.5).split(" ");
    return `<circle cx='${x}' cy='${y}' r='1.4'/>`;
  }).join("");
  return `<svg xmlns='http://www.w3.org/2000/svg' viewBox='-100 -100 200 200'>` +
    `<defs><linearGradient id='g' x1='0' y1='0' x2='0' y2='1'><stop offset='0' stop-color='#fff0c0'/><stop offset='.45' stop-color='#d9b25f'/><stop offset='1' stop-color='#8a6424'/></linearGradient>` +
    `<radialGradient id='d'><stop offset='0' stop-color='#4a1426'/><stop offset='1' stop-color='#14060c'/></radialGradient></defs>` +
    `<circle r='97' fill='none' stroke='url(#g)' stroke-width='3'/>` +
    `<circle r='90' fill='none' stroke='url(#g)' stroke-width='1.1' stroke-opacity='.85'/>` +
    `<g fill='#d9b25f'>${dots}</g>` +
    `<path d='${star(84, 2)}' fill='none' stroke='#d9b25f' stroke-opacity='.35' stroke-width='1.1'/>` +
    `<path d='${star(84, 3)}' fill='none' stroke='url(#g)' stroke-width='3.2' stroke-linejoin='round'/>` +
    `<circle r='31' fill='url(#d)' stroke='url(#g)' stroke-width='2.2'/>` +
    `<text y='9.5' text-anchor='middle' font-family='Georgia, Palatino, serif' font-size='27' font-weight='bold' letter-spacing='1' fill='url(#g)'>VII</text>` +
    gems +
    `</svg>`;
}

const f = (n: number) => n.toFixed(2);
const GOLD = `<linearGradient id='g' x1='0' y1='0' x2='0' y2='1'><stop offset='0' stop-color='#f6e2a8'/><stop offset='.5' stop-color='#d4ac5a'/><stop offset='1' stop-color='#8a6424'/></linearGradient>`;

/**
 * 牌背：一扇哥特教堂的玫瑰窗。七片大花瓣是彩色玻璃，各是一种罪的颜色（次序同纹章），金色的铅条和窗棂，
 * 中心一个小七芒星，外圈一圈放射线；双金框、四角花饰，上下一行拉丁字 SEPTEM / PECCATA，旋转对称。
 * viewBox 和牌一样是 100 × 142。
 */
export function cardBackSvg(): string {
  const cx = 50;
  const cy = 71;
  const at = (r: number, deg: number) => [cx + r * Math.cos((deg * Math.PI) / 180), cy + r * Math.sin((deg * Math.PI) / 180)];
  const rays = Array.from({ length: 56 }, (_, i) => {
    const d = (i * 360) / 56;
    const [x1, y1] = at(33.5, d);
    const [x2, y2] = at(i % 2 ? 37 : 40.5, d);
    return `<line x1='${f(x1)}' y1='${f(y1)}' x2='${f(x2)}' y2='${f(y2)}'/>`;
  }).join("");
  // 大花瓣（尖拱形），尖朝外；从正上方开始顺时针
  const big = `M-4.6,-12 Q-6,-22 0,-29.2 Q6,-22 4.6,-12 Q0,-10.4 -4.6,-12Z`;
  const small = `M-2.1,-13.2 Q-2.9,-19.5 0,-24.5 Q2.9,-19.5 2.1,-13.2 Q0,-12.4 -2.1,-13.2Z`;
  const petals = ORDER.map((sin, i) => {
    const deg = (i * 360) / 7;
    return `<path d='${big}' transform='translate(${cx} ${cy}) rotate(${f(deg)})' fill='${SIN_COLOR[sin]}' fill-opacity='.62' stroke='url(#g)' stroke-width='.7'/>` +
      `<path d='${big}' transform='translate(${cx} ${cy}) rotate(${f(deg)}) scale(.62) translate(0 -7)' fill='#fff' fill-opacity='.10'/>` +
      `<path d='${small}' transform='translate(${cx} ${cy}) rotate(${f(deg + 360 / 14)})' fill='none' stroke='url(#g)' stroke-width='.45'/>`;
  }).join("");
  const tracery = Array.from({ length: 14 }, (_, i) => {
    const [x, y] = at(31, -90 + (i * 360) / 14 + 360 / 28);
    return `<circle cx='${f(x)}' cy='${f(y)}' r='.75'/>`;
  }).join("");
  const hepta = `M${Array.from({ length: 7 }, (_, i) => { const [x, y] = at(8.6, -90 + ((i * 3) % 7) * 360 / 7); return `${f(x)} ${f(y)}`; }).join("L")}Z`;
  // 四角花饰：一段内凹的弧 + 一颗小菱形 + 一个点
  const corner = `<g id='c'><path d='M7.2 17 Q8.4 8.4 17 7.2' fill='none' stroke='url(#g)' stroke-width='.55'/><path d='M11 9.2 L12.8 11 L11 12.8 L9.2 11Z' fill='url(#g)'/><circle cx='15.2' cy='15.2' r='.7' fill='#d4ac5a'/></g>`;
  const band = (y: number, word: string, flip: boolean) =>
    `<g${flip ? ` transform='rotate(180 50 71)'` : ""}><path d='M26 ${y - 1.3}H40M60 ${y - 1.3}H74' stroke='url(#g)' stroke-width='.35'/>` +
    `<text x='50' y='${y}' text-anchor='middle' font-family='Georgia, Palatino, serif' font-size='3.6' letter-spacing='1.3' fill='#d4ac5a'>${word}</text></g>`;
  return `<svg xmlns='http://www.w3.org/2000/svg' xmlns:xlink='http://www.w3.org/1999/xlink' viewBox='0 0 100 142' preserveAspectRatio='none'>` +
    `<defs>${GOLD}<radialGradient id='bg' cx='.5' cy='.5' r='.72'><stop offset='0' stop-color='#5c1528'/><stop offset='.55' stop-color='#2e0d19'/><stop offset='1' stop-color='#12050a'/></radialGradient>` +
    `<radialGradient id='glow' cx='.5' cy='.5' r='.5'><stop offset='0' stop-color='#f6d58c' stop-opacity='.22'/><stop offset='1' stop-color='#f6d58c' stop-opacity='0'/></radialGradient>` +
    `<pattern id='lat' width='5' height='5' patternUnits='userSpaceOnUse' patternTransform='rotate(45)'><path d='M0 0H5M0 0V5' stroke='#d4ac5a' stroke-opacity='.07' stroke-width='.35'/></pattern></defs>` +
    `<rect width='100' height='142' fill='url(#bg)'/>` +
    `<rect x='7' y='7' width='86' height='128' fill='url(#lat)'/>` +
    `<circle cx='${cx}' cy='${cy}' r='44' fill='url(#glow)'/>` +
    `<rect x='3.6' y='3.6' width='92.8' height='134.8' rx='2.4' fill='none' stroke='url(#g)' stroke-width='.9'/>` +
    `<rect x='6' y='6' width='88' height='130' rx='1.4' fill='none' stroke='url(#g)' stroke-width='.35'/>` +
    corner +
    `<use xlink:href='#c' href='#c' transform='translate(100 0) scale(-1 1)'/>` +
    `<use xlink:href='#c' href='#c' transform='translate(0 142) scale(1 -1)'/>` +
    `<use xlink:href='#c' href='#c' transform='translate(100 142) scale(-1 -1)'/>` +
    band(25, "SEPTEM", false) + band(25, "PECCATA", true) +
    `<g stroke='#d4ac5a' stroke-opacity='.55' stroke-width='.3'>${rays}</g>` +
    `<circle cx='${cx}' cy='${cy}' r='32.4' fill='#14060b' fill-opacity='.55' stroke='url(#g)' stroke-width='.9'/>` +
    `<circle cx='${cx}' cy='${cy}' r='30' fill='none' stroke='url(#g)' stroke-width='.3'/>` +
    petals +
    `<g fill='#d4ac5a'>${tracery}</g>` +
    `<circle cx='${cx}' cy='${cy}' r='11' fill='#1a070e' stroke='url(#g)' stroke-width='.7'/>` +
    `<path d='${hepta}' fill='none' stroke='url(#g)' stroke-width='.6' stroke-linejoin='round'/>` +
    `<circle cx='${cx}' cy='${cy}' r='1.5' fill='url(#g)'/>` +
    `</svg>`;
}

/** 桌上三块长条牌的小图标：场地是哥特拱门，胜利规则是王冠，公共效果是全视之眼。 */
export function tileIconSvg(kind: "arena" | "rule" | "pe"): string {
  const body = {
    arena: `<path d='M-7.5 9V-1.5Q-7.5-8 0-10.5Q7.5-8 7.5-1.5V9Z'/><path d='M-3.6 9V1.2Q-3.6-3 0-4.6Q3.6-3 3.6 1.2V9'/><path d='M-10 9H10M-7.5-1.5H7.5'/>`,
    rule: `<path d='M-8.5 5.5V-4.5L-4.2 0L0-7.5L4.2 0L8.5-4.5V5.5Z'/><path d='M-8.5 8.5H8.5'/><circle cx='0' cy='-9.2' r='1.2'/><circle cx='-8.5' cy='-6.2' r='1'/><circle cx='8.5' cy='-6.2' r='1'/>`,
    pe: `<path d='M-10 0Q0-8.5 10 0Q0 8.5-10 0Z'/><circle r='3.4'/><circle r='1.3' fill='url(#g)'/><path d='M0-8V-11M-5-6.8L-6.6-9.2M5-6.8L6.6-9.2M0 8V11'/>`,
  }[kind];
  return `<svg xmlns='http://www.w3.org/2000/svg' viewBox='-12 -12 24 24'><defs>${GOLD}</defs>` +
    `<g fill='none' stroke='url(#g)' stroke-width='1.3' stroke-linejoin='round' stroke-linecap='round'>${body}</g></svg>`;
}

const dataUrl = (svg: string) => `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;

/** 把纹章、牌背、长条牌图标挂到根元素的 CSS 变量上（--sigil、--card-back、--icon-arena / rule / pe）。 */
export function installSigil() {
  const root = document.documentElement.style;
  root.setProperty("--sigil", dataUrl(sigilSvg()));
  root.setProperty("--card-back", dataUrl(cardBackSvg()));
  for (const k of ["arena", "rule", "pe"] as const) root.setProperty(`--icon-${k}`, dataUrl(tileIconSvg(k)));
}
