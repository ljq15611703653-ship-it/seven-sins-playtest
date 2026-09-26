/**
 * 背景音乐：画面每次重画时告诉这里「现在是什么场景」，这里负责换曲和交叉淡入淡出。
 *
 * 曲子放在 web/audio/<曲名>.mp3（Suno 生成，已统一响度），打包时复制到 sin-squad-v3/audio/。
 * 菜单、牌桌、战斗三首循环播放：快到结尾时从头再起一份，和旧的交叉淡化，听不出接缝。
 * 胜利、失败只播一次，播完就安静，等下一次换场景。
 * 浏览器要等玩家第一次点击后才允许出声，所以在第一次点击时才真正开始播。
 */

export type Track = "menu" | "bet" | "battle" | "win" | "lose";

const LOOP: Record<Track, boolean> = { menu: true, bet: true, battle: true, win: false, lose: false };
/** 各曲的音量：牌桌那首是思考时的铺底，压低一些。 */
const LEVEL: Record<Track, number> = { menu: 0.55, bet: 0.4, battle: 0.55, win: 0.6, lose: 0.6 };
const FADE_MS = 900;
/** 循环曲在结尾前多少秒开始接下一遍。 */
const LOOP_OVERLAP_S = 2.5;
const STORAGE_KEY = "sinsquad-music-muted";

interface Deck {
  track: Track;
  audio: HTMLAudioElement;
  /** 0–1 的淡入淡出系数，乘上曲子音量和总开关。 */
  gain: number;
  target: number;
  onFaded?: () => void;
}

let muted = readMuted();
let unlocked = false;
/** 当前应该在放的场景；key 用来区分「同一首曲子但是新的一次」（比如又一场胜利）。 */
interface Scene { track: Track | null; key: string }
let want: Scene & { after?: Scene } = { track: null, key: "" };
let playingKey = "";
/** 放过（或放到一半被打断）的胜负曲：同一场不再重放。 */
const oneShotsPlayed = new Set<string>();
let decks: Deck[] = [];
let raf = 0;
let last = 0;

function readMuted(): boolean {
  try { return localStorage.getItem(STORAGE_KEY) === "1"; } catch { return false; }
}

function makeDeck(track: Track): Deck {
  const audio = new Audio(`audio/${track}.mp3`);
  audio.preload = "auto";
  audio.volume = 0;
  const deck: Deck = { track, audio, gain: 0, target: 1 };
  if (LOOP[track]) {
    const onTime = () => {
      if (!audio.duration || audio.currentTime < audio.duration - LOOP_OVERLAP_S) return;
      audio.removeEventListener("timeupdate", onTime);
      if (!decks.includes(deck)) return;
      // 接下一遍：新的一份从头淡入，这一份淡出
      const next = makeDeck(track);
      decks.push(next);
      void next.audio.play().catch(() => {});
      fadeOut(deck);
    };
    audio.addEventListener("timeupdate", onTime);
  }
  audio.addEventListener("ended", () => {
    const current = decks.includes(deck) && deck.target > 0;
    drop(deck);
    // 胜负曲放完：场景没变的话，接上指定的下一首（比如回到牌桌音乐）
    if (current && want.after && playingKey === want.key) {
      want = want.after;
      apply();
    }
  });
  return deck;
}

function drop(deck: Deck) {
  deck.audio.pause();
  deck.audio.removeAttribute("src");
  decks = decks.filter((d) => d !== deck);
}

function fadeOut(deck: Deck) {
  deck.target = 0;
  deck.onFaded = () => drop(deck);
  tick();
}

function tick() {
  if (raf) return;
  last = performance.now();
  const step = (now: number) => {
    const dt = (now - last) / FADE_MS;
    last = now;
    let moving = false;
    for (const d of [...decks]) {
      if (d.gain !== d.target) {
        d.gain = d.target > d.gain ? Math.min(d.target, d.gain + dt) : Math.max(d.target, d.gain - dt);
        moving = true;
      }
      d.audio.volume = muted ? 0 : d.gain * d.gain * LEVEL[d.track];
      if (d.gain === 0 && d.target === 0 && d.onFaded) d.onFaded();
    }
    raf = moving ? requestAnimationFrame(step) : 0;
  };
  raf = requestAnimationFrame(step);
}

function apply() {
  if (!unlocked || muted) return;
  // 胜负曲只放一次：比如中途去了开新桌的界面又回来，直接接后面的曲子
  if (want.track && !LOOP[want.track] && oneShotsPlayed.has(want.key) && want.key !== playingKey) {
    if (!want.after) return;
    want = want.after;
  }
  if (want.key === playingKey) return;
  playingKey = want.key;
  for (const d of decks) fadeOut(d);
  if (!want.track) return;
  if (!LOOP[want.track]) oneShotsPlayed.add(want.key);
  const deck = makeDeck(want.track);
  decks.push(deck);
  void deck.audio.play().catch(() => {});
  tick();
}

/**
 * 每次重画时调用：告诉音乐现在的场景。key 和正在放的一样就什么都不做。
 * after：只播一次的曲子放完后接着放什么（它的 key 和之后场景的 key 一致，就不会重头再放）。
 */
export function setScene(track: Track | null, key: string = track ?? "", after?: Scene) {
  want = { track, key, after };
  apply();
}

export function isMuted() {
  return muted;
}

export function toggleMuted() {
  muted = !muted;
  try { localStorage.setItem(STORAGE_KEY, muted ? "1" : "0"); } catch { /* 存不了就只在这次有效 */ }
  if (muted) {
    // 静音时直接停掉，重新打开时从当前场景开头放
    for (const d of [...decks]) drop(d);
    playingKey = "";
  } else {
    apply();
  }
}

// 浏览器要求先有一次用户操作才能出声
const unlock = () => {
  if (unlocked) return;
  unlocked = true;
  window.removeEventListener("pointerdown", unlock, true);
  window.removeEventListener("keydown", unlock, true);
  apply();
};
window.addEventListener("pointerdown", unlock, true);
window.addEventListener("keydown", unlock, true);

// 切到别的标签页时暂停，回来接着放
document.addEventListener("visibilitychange", () => {
  for (const d of decks) {
    if (document.hidden) d.audio.pause();
    else void d.audio.play().catch(() => {});
  }
});
