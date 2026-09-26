import { runBattle, type BattleResult } from "../battle/engine.js";
import { CHARACTERS, character } from "../content/characters.js";
import { ARENAS, EQUIPMENT, PUBLIC_EFFECTS, RULES, SLOT_EFFECTS } from "../content/tables.js";
import { Rng } from "../rng.js";
import { other, SEATS, type EatChoice, type MarketStage, type Seat, type TeamSetup } from "../types.js";
import type { Action, Phase } from "./actions.js";

/**
 * 一张牌桌：你和同一个对手 1 对 1，一手接一手打到一方输光。
 *
 * 一手的顺序：
 *   底注 → 翻 2 张场地，筹码少的一方选 1 张 → 从各自牌池发 4 张
 *   → 非庄家布阵并亮 1 名 → 庄家布阵并亮 1 名 →（窥视者偷看）
 *   → 第 1 轮下注 →（操作：拿装备）→ 翻胜利规则 + 1 张公共效果 → 表决 /（暗标）
 *   → 第 2 轮下注 →（操作）→ 揭队战斗 → 结算 → 输家先挑人进牌池 → 各自可移除 1 名。
 */

export interface TableOptions {
  seed?: number;
  buyIn?: number;
  baseAnte?: number;
  /** 每几手底注翻倍。 */
  blindEvery?: number;
  initialPoolSize?: number;
  minPoolSize?: number;
  minBet?: number;
  /** 调试用：固定发牌、规则、场地等，方便测试某张牌。不影响正常游戏。 */
  rig?: TableRig;
}

/**
 * 调试用的固定项。没给的项照常随机；给了的项每一手都生效。
 * 随机数照常消耗，所以同一个种子下，没固定的部分和不开调试时一样。
 */
export interface TableRig {
  /** 每手固定发给某一方的人物（最多 4 名，不够的从牌池随机补）；不需要在牌池里。 */
  deal?: [string[] | null, string[] | null];
  ruleId?: string;
  publicEffectId?: string;
  arenaOptions?: [string, string];
  /** 第一手的庄家。 */
  dealer?: Seat;
  /** 每手市场翻出的人物。 */
  market?: string[];
}

export interface Placement {
  /** 3 个位置上的人物；被吞掉的位置为 null。 */
  slots: (string | null)[];
  eat: EatChoice | null;
  /** 被饕餮吞掉的人物（没有吞噬时为 null）。 */
  eatenId: string | null;
  reveal: number;
}

type DraftCard = string;

export interface BetStats {
  betOrRaise: number;
  checks: number;
  opsPaid: number;
}

export interface HandState {
  no: number;
  dealer: Seat;
  ante: number;
  arenaOptions: [string, string];
  arenaChooser: Seat;
  arenaId: string | null;
  /** 开局就抽好，但翻开前对双方保密。 */
  ruleId: string;
  publicEffectId: string;
  ruleRevealed: boolean;
  peRevealed: boolean;
  peActive: boolean;
  dealt: [string[], string[]];
  placing: Seat | null;
  placement: [Placement | null, Placement | null];
  equipment: [(string | null)[], (string | null)[]];
  slotEffects: [(string | null)[], (string | null)[]];
  peekPending: [boolean, boolean];
  peek: [{ pos: number; characterId: string } | null, { pos: number; characterId: string } | null];
  pot: number;
  invested: [number, number];
  stats: [BetStats, BetStats];
  betRound: 1 | 2;
  roundBet: [number, number];
  target: number;
  minRaise: number;
  acted: [boolean, boolean];
  actor: Seat;
  allIn: boolean;
  opFee: number;
  opCommit: [boolean | null, boolean | null];
  offers: [string[] | null, string[] | null];
  draftChoice: [{ offerIndex: number; pos: number } | null, { offerIndex: number; pos: number } | null];
  votes: [boolean | null, boolean | null];
  bids: [number | null, number | null];
  bidCap: number;
  folded: Seat | null;
  battle: BattleResult | null;
  outcome: { winner: Seat | null; by: "fold" | "battle"; pot: number } | null;
  market: string[];
  marketOrder: [Seat, Seat];
  marketStep: 0 | 1;
  removeDone: [boolean, boolean];
}

export type TableEvent =
  | { type: "handStart"; no: number; dealer: Seat; ante: number; arenaOptions: [string, string]; chooser: Seat }
  | { type: "arenaChosen"; seat: Seat; arenaId: string }
  | { type: "placed"; seat: Seat; revealPos: number; characterId: string; eaten: number | null }
  | { type: "betAction"; seat: Seat; round: 1 | 2; action: string; amount: number; stack: number; pot: number }
  | { type: "refund"; seat: Seat; amount: number }
  | { type: "operate"; round: 1 | 2; fee: number; drafted: [boolean, boolean] }
  | { type: "installed"; seat: Seat; pos: number; cardId: string; slotKind: "equipment" | "effect" }
  | { type: "reveal"; ruleId: string; publicEffectId: string | null }
  | { type: "votes"; votes: [boolean, boolean] }
  | { type: "bids"; bids: [number, number]; peActive: boolean }
  | { type: "peResult"; publicEffectId: string; active: boolean }
  | { type: "fold"; seat: Seat }
  | { type: "battle"; winner: Seat | null; reason: string; teams: [Placement, Placement]; equipment: [(string | null)[], (string | null)[]] }
  | { type: "settle"; winner: Seat | null; pot: number; stacks: [number, number] }
  | { type: "market"; candidates: string[]; firstPicker: Seat }
  | { type: "marketPick"; seat: Seat; characterId: string }
  | { type: "marketRemove"; seat: Seat; removed: boolean }
  | { type: "tableOver"; winner: Seat };

const GRAND_ID = "GL2"; // 饕餮
const PEEKER_ID = "EN1"; // 窥视者
const CROWN_ID = "PR3"; // 冠冕者

export class Table {
  readonly options: Required<Omit<TableOptions, "rig">>;
  readonly rig: TableRig;
  rng: Rng;
  stacks: [number, number];
  pools: [string[], string[]];
  /** 从市场挑进来的人物（公开）。 */
  publicPicks: [string[], string[]] = [[], []];
  removedCount: [number, number] = [0, 0];
  handNo = 0;
  hand!: HandState;
  phase: Phase = "arena";
  winner: Seat | null = null;
  readonly log: TableEvent[] = [];
  private readonly total: number;

  constructor(options: TableOptions = {}) {
    this.options = {
      seed: options.seed ?? 1,
      buyIn: options.buyIn ?? 100,
      baseAnte: options.baseAnte ?? 5,
      blindEvery: options.blindEvery ?? 5,
      initialPoolSize: options.initialPoolSize ?? 8,
      minPoolSize: options.minPoolSize ?? 6,
      minBet: options.minBet ?? 5,
    };
    this.rig = options.rig ?? {};
    checkRig(this.rig);
    this.rng = new Rng(this.options.seed);
    this.stacks = [this.options.buyIn, this.options.buyIn];
    this.total = this.options.buyIn * 2;
    const ids = CHARACTERS.map((c) => c.id);
    this.pools = [this.rng.sample(ids, this.options.initialPoolSize), this.rng.sample(ids, this.options.initialPoolSize)];
    const dealer = this.rng.int(2) as Seat;
    this.startHand(this.rig.dealer ?? dealer);
  }

  // ───────────────────────── 查询 ─────────────────────────

  /** 当前需要行动的座位。 */
  toAct(): Seat[] {
    const h = this.hand;
    switch (this.phase) {
      case "arena": return [h.arenaChooser];
      case "place": return h.placing === null ? [] : [h.placing];
      case "peek": return SEATS.filter((s) => h.peekPending[s]);
      case "bet": return [h.actor];
      case "operate": return SEATS.filter((s) => h.opCommit[s] === null);
      case "draft": return SEATS.filter((s) => h.offers[s] !== null && h.draftChoice[s] === null);
      case "vote": return SEATS.filter((s) => h.votes[s] === null);
      case "bid": return SEATS.filter((s) => h.bids[s] === null);
      case "marketPick": return [h.marketOrder[h.marketStep]];
      case "marketRemove": return SEATS.filter((s) => !h.removeDone[s]);
      case "over": return [];
    }
  }

  /** 筹码守恒：双方桌上筹码 + 奖池 = 开桌总额。 */
  checkInvariant(): void {
    const sum = this.stacks[0] + this.stacks[1] + this.hand.pot;
    if (sum !== this.total) throw new Error(`筹码不守恒：${sum} ≠ ${this.total}`);
    if (this.stacks.some((x) => x < 0) || this.hand.pot < 0) throw new Error("出现负数筹码");
  }

  static marketStageFor(handNo: number, blindEvery = 5): MarketStage {
    if (handNo <= blindEvery) return 1;
    if (handNo <= blindEvery * 2) return 2;
    return 3;
  }

  // ───────────────────────── 一手的开始 ─────────────────────────

  private startHand(dealer: Seat) {
    this.handNo++;
    const level = Math.floor((this.handNo - 1) / this.options.blindEvery);
    const ante = this.options.baseAnte * 2 ** level;
    const arenaOptions = pickOr(this.rng.sample(ARENAS.map((a) => a.id), 2) as [string, string], this.rig.arenaOptions);
    const chooser: Seat =
      this.stacks[0] === this.stacks[1] ? other(dealer) : this.stacks[0] < this.stacks[1] ? 0 : 1;
    this.hand = {
      no: this.handNo, dealer, ante,
      arenaOptions, arenaChooser: chooser, arenaId: null,
      ruleId: pickOr(this.rng.pick(RULES).id, this.rig.ruleId),
      publicEffectId: pickOr(this.rng.pick(PUBLIC_EFFECTS).id, this.rig.publicEffectId),
      ruleRevealed: false, peRevealed: false, peActive: false,
      dealt: [[], []], placing: null, placement: [null, null],
      equipment: [[null, null, null], [null, null, null]],
      slotEffects: [[null, null, null], [null, null, null]],
      peekPending: [false, false], peek: [null, null],
      pot: 0, invested: [0, 0],
      stats: [{ betOrRaise: 0, checks: 0, opsPaid: 0 }, { betOrRaise: 0, checks: 0, opsPaid: 0 }],
      betRound: 1, roundBet: [0, 0], target: 0, minRaise: this.options.minBet, acted: [false, false], actor: other(dealer),
      allIn: false, opFee: 0, opCommit: [null, null], offers: [null, null], draftChoice: [null, null],
      votes: [null, null], bids: [null, null], bidCap: 0,
      folded: null, battle: null, outcome: null,
      market: [], marketOrder: [0, 1], marketStep: 0, removeDone: [false, false],
    };
    // 底注：不够时双方都按较少者交
    const paid = Math.min(ante, this.stacks[0], this.stacks[1]);
    for (const s of SEATS) this.pay(s, paid);
    if (this.stacks[0] === 0 || this.stacks[1] === 0) this.hand.allIn = true;
    this.log.push({ type: "handStart", no: this.handNo, dealer, ante: paid, arenaOptions, chooser });
    this.phase = "arena";
  }

  private pay(seat: Seat, amount: number) {
    if (amount < 0 || amount > this.stacks[seat]) throw new Error(`付款金额非法：${amount}`);
    this.stacks[seat] -= amount;
    this.hand.pot += amount;
    this.hand.invested[seat] += amount;
  }

  // ───────────────────────── 动作 ─────────────────────────

  /** 提交动作；非法时抛错且状态不变。 */
  apply(seat: Seat, action: Action): void {
    if (!this.toAct().includes(seat)) throw new Error(`现在不是座位 ${seat} 行动（阶段：${this.phase}）`);
    switch (action.type) {
      case "chooseArena": return this.onArena(seat, action.index);
      case "place": return this.onPlace(seat, action.picks, action.eat, action.reveal);
      case "peek": return this.onPeek(seat, action.pos);
      case "peekSwap": return this.onPeekSwap(seat, action.swap);
      case "check": case "bet": case "call": case "raise": case "allIn": case "fold":
        return this.onBet(seat, action);
      case "operate": return this.onOperate(seat, action.draft);
      case "draft": return this.onDraft(seat, action.offerIndex, action.pos);
      case "vote": return this.onVote(seat, action.activate);
      case "bid": return this.onBid(seat, action.amount);
      case "marketPick": return this.onMarketPick(seat, action.index);
      case "marketRemove": return this.onMarketRemove(seat, action.poolIndex);
    }
  }

  private expect(phase: Phase) {
    if (this.phase !== phase) throw new Error(`阶段不对：现在是 ${this.phase}，这个动作属于 ${phase}`);
  }

  private onArena(seat: Seat, index: 0 | 1) {
    this.expect("arena");
    if (index !== 0 && index !== 1) throw new Error("场地序号只能是 0 或 1");
    const h = this.hand;
    h.arenaId = h.arenaOptions[index];
    this.log.push({ type: "arenaChosen", seat, arenaId: h.arenaId });
    for (const s of SEATS) {
      const idx = this.rng.sample([...this.pools[s].keys()], 4);
      h.dealt[s] = idx.map((i) => this.pools[s][i]);
      const forced = this.rig.deal?.[s];
      if (forced?.length) {
        const rest = h.dealt[s].filter((id) => !forced.includes(id));
        h.dealt[s] = [...forced, ...rest].slice(0, 4);
      }
    }
    h.placing = other(h.dealer);
    this.phase = "place";
  }

  private onPlace(seat: Seat, picks: number[], eat: EatChoice | null, reveal: number) {
    this.expect("place");
    const h = this.hand;
    const placement = validatePlacement(h.dealt[seat], picks, eat, reveal);
    h.placement[seat] = placement;
    this.log.push({ type: "placed", seat, revealPos: reveal, characterId: placement.slots[reveal]!, eaten: eat?.eaten ?? null });
    if (seat === other(h.dealer)) {
      h.placing = h.dealer;
      return;
    }
    h.placing = null;
    // 窥视者
    for (const s of SEATS) {
      const mine = h.placement[s]!;
      const foe = h.placement[other(s)]!;
      const hasPeeker = mine.slots.includes(PEEKER_ID);
      const hidden = foe.slots.some((c, i) => c !== null && i !== foe.reveal);
      h.peekPending[s] = hasPeeker && hidden;
    }
    if (h.peekPending[0] || h.peekPending[1]) this.phase = "peek";
    else this.afterPlacement();
  }

  private onPeek(seat: Seat, pos: number) {
    this.expect("peek");
    const h = this.hand;
    const foe = h.placement[other(seat)]!;
    if (!Number.isInteger(pos) || pos < 0 || pos > 2 || foe.slots[pos] === null || pos === foe.reveal) {
      throw new Error("只能查看对手一个暗置的位置");
    }
    if (h.peek[seat]) throw new Error("已经偷看过了");
    // 暗中进行：不写进公开的牌桌记录
    h.peek[seat] = { pos, characterId: foe.slots[pos]! };
  }

  /** 偷看之后，可以交换自己两名暗置人物的位置（亮出的那名和空位不能动）。同样暗中进行。 */
  private onPeekSwap(seat: Seat, swap: [number, number] | null) {
    this.expect("peek");
    const h = this.hand;
    if (!h.peek[seat]) throw new Error("先偷看，再决定要不要换位");
    const pl = h.placement[seat]!;
    if (swap) {
      const [a, b] = swap;
      const movable = (p: number) => Number.isInteger(p) && p >= 0 && p <= 2 && pl.slots[p] !== null && p !== pl.reveal;
      if (a === b || !movable(a) || !movable(b)) throw new Error("只能交换自己两名暗置人物的位置");
      [pl.slots[a], pl.slots[b]] = [pl.slots[b], pl.slots[a]];
      if (pl.eat) {
        if (pl.eat.eater === a) pl.eat = { ...pl.eat, eater: b };
        else if (pl.eat.eater === b) pl.eat = { ...pl.eat, eater: a };
      }
      // 对手要是也偷看过被换走的人，他看到的跟着这名人物走
      const theirs = h.peek[other(seat)];
      if (theirs && (theirs.pos === a || theirs.pos === b)) {
        h.peek[other(seat)] = { ...theirs, pos: pl.slots.indexOf(theirs.characterId) };
      }
    }
    h.peekPending[seat] = false;
    if (!h.peekPending[0] && !h.peekPending[1]) this.afterPlacement();
  }

  private afterPlacement() {
    if (this.hand.allIn) return this.revealRule();
    this.startBetRound(1);
  }

  private startBetRound(round: 1 | 2) {
    const h = this.hand;
    h.betRound = round;
    h.roundBet = [0, 0];
    h.target = 0;
    h.minRaise = this.options.minBet;
    h.acted = [false, false];
    h.actor = round === 1 ? other(h.dealer) : h.dealer;
    this.phase = "bet";
  }

  /** 冠冕者：被亮出时，对手在第 1 轮下注不能弃牌。 */
  canFold(seat: Seat): boolean {
    const h = this.hand;
    const foe = h.placement[other(seat)];
    return !(h.betRound === 1 && foe && foe.slots[foe.reveal] === CROWN_ID);
  }

  private onBet(seat: Seat, action: Action) {
    this.expect("bet");
    const h = this.hand;
    const me = h.roundBet[seat];
    const stack = this.stacks[seat];
    const minBet = this.options.minBet;
    let label: string = action.type;
    let putIn = 0;
    let aggressive = false;

    switch (action.type) {
      case "check":
        if (me !== h.target) throw new Error("有未跟的下注，不能过牌");
        h.stats[seat].checks++;
        break;
      case "bet":
        if (h.target !== 0) throw new Error("已经有人下注，只能跟注、加注或弃牌");
        if (!Number.isInteger(action.amount) || action.amount <= 0 || action.amount > stack) throw new Error("下注金额非法");
        if (action.amount < minBet && action.amount !== stack) throw new Error(`下注至少 ${minBet}，不足时只能全押`);
        putIn = action.amount;
        aggressive = true;
        break;
      case "call":
        if (h.target <= me) throw new Error("没有需要跟的下注");
        putIn = Math.min(h.target - me, stack);
        break;
      case "raise": {
        if (h.target === 0) throw new Error("还没有人下注，请用下注");
        const to = action.to;
        if (!Number.isInteger(to) || to - me > stack) throw new Error("加注金额超过可用筹码");
        if (to - h.target < h.minRaise && to - me !== stack) throw new Error(`加注至少要比当前多 ${h.minRaise}`);
        if (to <= h.target) throw new Error("加注必须高于当前下注");
        putIn = to - me;
        aggressive = true;
        break;
      }
      case "allIn":
        if (stack === 0) throw new Error("已经没有筹码");
        putIn = stack;
        aggressive = me + stack > h.target;
        break;
      case "fold":
        if (!this.canFold(seat)) throw new Error("对手亮出了冠冕者，第 1 轮下注不能弃牌");
        h.folded = seat;
        this.log.push({ type: "fold", seat });
        return this.settleFold(seat);
      default:
        throw new Error("不是下注动作");
    }

    this.pay(seat, putIn);
    h.roundBet[seat] += putIn;
    h.acted[seat] = true;
    if (aggressive) {
      const increment = h.roundBet[seat] - h.target;
      if (increment >= h.minRaise) h.minRaise = increment;
      h.target = h.roundBet[seat];
      h.acted[other(seat)] = false;
      h.stats[seat].betOrRaise++;
      if (action.type === "allIn") label = "allIn";
    }
    this.log.push({ type: "betAction", seat, round: h.betRound, action: label, amount: putIn, stack: this.stacks[seat], pot: h.pot });
    this.checkInvariant();

    const o = other(seat);
    const matched = h.roundBet[0] === h.roundBet[1];
    const someoneBroke = this.stacks[0] === 0 || this.stacks[1] === 0;
    if (h.acted[0] && h.acted[1] && matched) return this.endBetRound();
    // 有人全押：只要另一方已经回应、且全押者跟不上，本轮结束并退回超额
    if (someoneBroke) {
      const broke: Seat = this.stacks[seat] === 0 ? seat : o;
      const rich = other(broke);
      if (h.acted[rich] && h.roundBet[rich] >= h.roundBet[broke]) return this.endBetRound();
      if (this.stacks[rich] === 0) return this.endBetRound();
    }
    h.actor = o;
  }

  private endBetRound() {
    const h = this.hand;
    // 退回本轮无法匹配的超额
    const low = Math.min(h.roundBet[0], h.roundBet[1]);
    for (const s of SEATS) {
      const excess = h.roundBet[s] - low;
      if (excess > 0) {
        this.stacks[s] += excess;
        h.pot -= excess;
        h.invested[s] -= excess;
        h.roundBet[s] = low;
        this.log.push({ type: "refund", seat: s, amount: excess });
      }
    }
    this.checkInvariant();
    if (this.stacks[0] === 0 || this.stacks[1] === 0) h.allIn = true;
    const B = low;
    if (B > 0 && !h.allIn) {
      h.opFee = Math.min(B, this.stacks[0], this.stacks[1]);
      h.opCommit = [null, null];
      h.offers = [null, null];
      h.draftChoice = [null, null];
      this.phase = "operate";
      return;
    }
    this.afterOperations();
  }

  private onOperate(seat: Seat, draft: boolean) {
    this.expect("operate");
    const h = this.hand;
    h.opCommit[seat] = draft;
    if (h.opCommit[0] === null || h.opCommit[1] === null) return;
    const drafted = [h.opCommit[0], h.opCommit[1]] as [boolean, boolean];
    this.log.push({ type: "operate", round: h.betRound, fee: h.opFee, drafted });
    for (const s of SEATS) {
      if (!drafted[s]) continue;
      this.pay(s, h.opFee);
      h.stats[s].opsPaid++;
      h.offers[s] = this.rng.sample([...EQUIPMENT.map((e) => e.id), ...SLOT_EFFECTS.map((e) => e.id)], 3);
    }
    this.checkInvariant();
    if (drafted[0] || drafted[1]) this.phase = "draft";
    else this.afterOperations();
  }

  private onDraft(seat: Seat, offerIndex: number, pos: number) {
    this.expect("draft");
    const h = this.hand;
    const offers = h.offers[seat]!;
    const placement = h.placement[seat]!;
    if (!Number.isInteger(offerIndex) || offerIndex < 0 || offerIndex >= offers.length) throw new Error("候选序号非法");
    if (!Number.isInteger(pos) || pos < 0 || pos > 2 || placement.slots[pos] === null) throw new Error("只能装到在场的人物身上");
    h.draftChoice[seat] = { offerIndex, pos };
    if (SEATS.some((s) => h.offers[s] !== null && h.draftChoice[s] === null)) return;
    // 双方都选完，一起公开安装结果
    for (const s of SEATS) {
      const c = h.draftChoice[s];
      if (!c) continue;
      const id = h.offers[s]![c.offerIndex];
      if (id.startsWith("FX")) h.slotEffects[s][c.pos] = id;
      else h.equipment[s][c.pos] = id;
      this.log.push({ type: "installed", seat: s, pos: c.pos, cardId: id, slotKind: id.startsWith("FX") ? "effect" : "equipment" });
    }
    h.offers = [null, null];
    if (this.stacks[0] === 0 || this.stacks[1] === 0) h.allIn = true;
    this.afterOperations();
  }

  private afterOperations() {
    const h = this.hand;
    if (h.allIn) {
      if (!h.ruleRevealed) return this.revealRule();
      return this.fight();
    }
    if (h.betRound === 1) return this.revealRule();
    return this.fight();
  }

  private revealRule() {
    const h = this.hand;
    h.ruleRevealed = true;
    if (h.allIn) {
      // 全押：尚未翻开的公共效果不生效
      this.log.push({ type: "reveal", ruleId: h.ruleId, publicEffectId: null });
      return this.fight();
    }
    h.peRevealed = true;
    this.log.push({ type: "reveal", ruleId: h.ruleId, publicEffectId: h.publicEffectId });
    h.votes = [null, null];
    this.phase = "vote";
  }

  private onVote(seat: Seat, activate: boolean) {
    this.expect("vote");
    const h = this.hand;
    h.votes[seat] = !!activate;
    if (h.votes[0] === null || h.votes[1] === null) return;
    const votes = [h.votes[0], h.votes[1]] as [boolean, boolean];
    this.log.push({ type: "votes", votes });
    if (votes[0] === votes[1]) {
      h.peActive = votes[0];
      this.log.push({ type: "peResult", publicEffectId: h.publicEffectId, active: h.peActive });
      return this.startBetRound(2);
    }
    h.bids = [null, null];
    h.bidCap = Math.min(this.stacks[0], this.stacks[1]);
    this.phase = "bid";
  }

  private onBid(seat: Seat, amount: number) {
    this.expect("bid");
    const h = this.hand;
    if (!Number.isInteger(amount) || amount < 0 || amount > h.bidCap) throw new Error(`出价必须是 0 到 ${h.bidCap} 的整数`);
    h.bids[seat] = amount;
    if (h.bids[0] === null || h.bids[1] === null) return;
    const bids = [h.bids[0], h.bids[1]] as [number, number];
    if (bids[0] === bids[1]) {
      h.peActive = false;
    } else {
      const w: Seat = bids[0] > bids[1] ? 0 : 1;
      h.peActive = h.votes[w]!;
      this.pay(w, bids[w]);
    }
    this.log.push({ type: "bids", bids, peActive: h.peActive });
    this.log.push({ type: "peResult", publicEffectId: h.publicEffectId, active: h.peActive });
    this.checkInvariant();
    if (this.stacks[0] === 0 || this.stacks[1] === 0) {
      h.allIn = true;
      return this.fight();
    }
    this.startBetRound(2);
  }

  // ───────────────────────── 结算 ─────────────────────────

  /** 战斗要用的双方配置。 */
  teamSetup(seat: Seat): TeamSetup {
    const h = this.hand;
    const p = h.placement[seat]!;
    return {
      slots: p.slots.map((c, i) => ({ characterId: c, equipmentId: c ? h.equipment[seat][i] : null, effectId: c ? h.slotEffects[seat][i] : null })),
      eat: null, // 吞噬已经体现在 slots 里：被吞的位置为空，吞噬加成见 battleTeams()
      bet: {
        invested: h.invested[seat],
        betOrRaiseCount: h.stats[seat].betOrRaise,
        checkCount: h.stats[seat].checks,
        opsPaid: h.stats[seat].opsPaid,
        revealedPos: p.reveal,
        stack: this.stacks[seat],
      },
    };
  }

  private battleTeams(): [TeamSetup, TeamSetup] {
    return SEATS.map((s) => {
      const t = this.teamSetup(s);
      const p = this.hand.placement[s]!;
      if (p.eat) {
        // 战斗引擎自己处理吞噬：把被吞的人物放回原位，交给引擎移除并加成
        const slots = t.slots.map((x) => ({ ...x }));
        slots[p.eat.eaten] = { characterId: p.eatenId, equipmentId: null, effectId: null };
        return { ...t, slots, eat: p.eat };
      }
      return t;
    }) as [TeamSetup, TeamSetup];
  }

  private fight() {
    const h = this.hand;
    const result = runBattle({
      teams: this.battleTeams(),
      ruleId: h.ruleId,
      arenaId: h.arenaId!,
      publicEffectId: h.peActive ? h.publicEffectId : null,
      pot: h.pot,
      firstSeat: other(h.dealer), // 非庄家先手：庄家后布阵、有信息优势
    });
    h.battle = result;
    this.log.push({
      type: "battle", winner: result.winner, reason: result.reason,
      teams: [h.placement[0]!, h.placement[1]!], equipment: [h.equipment[0].slice(), h.equipment[1].slice()],
    });
    const pot = h.pot;
    if (result.winner === null) {
      for (const s of SEATS) this.stacks[s] += h.invested[s];
    } else {
      this.stacks[result.winner] += pot;
    }
    h.pot = 0;
    h.outcome = { winner: result.winner, by: "battle", pot };
    this.log.push({ type: "settle", winner: result.winner, pot, stacks: [this.stacks[0], this.stacks[1]] });
    this.checkInvariant();
    if (this.endIfBroke()) return;
    this.openMarket(result.winner === null ? other(h.dealer) : other(result.winner));
  }

  private settleFold(folder: Seat) {
    const h = this.hand;
    const winner = other(folder);
    const pot = h.pot;
    this.stacks[winner] += pot;
    h.pot = 0;
    h.outcome = { winner, by: "fold", pot };
    this.log.push({ type: "settle", winner, pot, stacks: [this.stacks[0], this.stacks[1]] });
    this.checkInvariant();
    if (this.endIfBroke()) return;
    this.openMarket(folder);
  }

  /** 结算后有人筹码归零：牌桌当场结束，不再进市场。 */
  private endIfBroke(): boolean {
    if (this.stacks[0] > 0 && this.stacks[1] > 0) return false;
    this.winner = this.stacks[0] === 0 ? 1 : 0;
    this.phase = "over";
    this.log.push({ type: "tableOver", winner: this.winner });
    return true;
  }

  // ───────────────────────── 市场 ─────────────────────────

  private openMarket(firstPicker: Seat) {
    const h = this.hand;
    const stage = Table.marketStageFor(this.handNo, this.options.blindEvery);
    let ids = CHARACTERS.filter((c) => c.stage === stage).map((c) => c.id);
    if (ids.length < 3) ids = CHARACTERS.filter((c) => c.stage === 2).map((c) => c.id); // 罪王级还没设计
    h.market = pickOr(this.rng.sample(ids, 3), this.rig.market?.slice(0, 3));
    h.marketOrder = [firstPicker, other(firstPicker)];
    h.marketStep = 0;
    h.removeDone = [false, false];
    this.log.push({ type: "market", candidates: h.market.slice(), firstPicker });
    this.phase = "marketPick";
  }

  private onMarketPick(seat: Seat, index: number) {
    this.expect("marketPick");
    const h = this.hand;
    if (!Number.isInteger(index) || index < 0 || index >= h.market.length) throw new Error("市场序号非法");
    const id = h.market.splice(index, 1)[0];
    this.pools[seat].push(id);
    this.publicPicks[seat].push(id);
    this.log.push({ type: "marketPick", seat, characterId: id });
    if (h.marketStep === 0) {
      h.marketStep = 1;
      return;
    }
    this.phase = "marketRemove";
  }

  private onMarketRemove(seat: Seat, poolIndex: number | null) {
    this.expect("marketRemove");
    const h = this.hand;
    const pool = this.pools[seat];
    if (poolIndex !== null) {
      if (!Number.isInteger(poolIndex) || poolIndex < 0 || poolIndex >= pool.length) throw new Error("牌池序号非法");
      if (pool.length - 1 < this.options.minPoolSize) throw new Error(`牌池至少保留 ${this.options.minPoolSize} 名`);
      pool.splice(poolIndex, 1);
      this.removedCount[seat]++;
    }
    h.removeDone[seat] = true;
    this.log.push({ type: "marketRemove", seat, removed: poolIndex !== null });
    if (!h.removeDone[0] || !h.removeDone[1]) return;
    this.startHand(other(h.dealer));
  }
}

/** 调试固定项：给了就用给的，没给就用随机结果（随机数照常消耗）。 */
function pickOr<T>(random: T, fixed: T | undefined): T {
  return fixed ?? random;
}

/** 调试固定项里的编号必须存在，写错了立刻报错。 */
function checkRig(rig: TableRig) {
  for (const list of rig.deal ?? []) {
    if (list && list.length > 4) throw new Error("每手最多固定发 4 名");
    for (const id of list ?? []) character(id);
  }
  for (const id of rig.market ?? []) character(id);
  if (rig.ruleId && !RULES.some((r) => r.id === rig.ruleId)) throw new Error(`未知胜利规则：${rig.ruleId}`);
  if (rig.publicEffectId && !PUBLIC_EFFECTS.some((p) => p.id === rig.publicEffectId)) throw new Error(`未知公共效果：${rig.publicEffectId}`);
  for (const id of rig.arenaOptions ?? []) if (!ARENAS.some((a) => a.id === id)) throw new Error(`未知场地：${id}`);
}

/** 检查布阵是否合法，返回布好的阵容。 */
export function validatePlacement(dealt: string[], picks: number[], eat: EatChoice | null, reveal: number): Placement {
  if (!Array.isArray(picks) || picks.length !== 3) throw new Error("要挑 3 名排到 1、2、3 号位");
  if (new Set(picks).size !== 3 || picks.some((i) => !Number.isInteger(i) || i < 0 || i >= dealt.length)) {
    throw new Error("挑人序号非法或重复");
  }
  const slots: (string | null)[] = picks.map((i) => dealt[i]);
  let eatenId: string | null = null;
  if (eat) {
    const { eater, eaten } = eat;
    if (![eater, eaten].every((x) => Number.isInteger(x) && x >= 0 && x <= 2) || eater === eaten) throw new Error("吞噬位置非法");
    if (slots[eater] !== GRAND_ID) throw new Error("只有饕餮能吞噬队友");
    eatenId = slots[eaten]!;
    slots[eaten] = null;
  }
  if (!Number.isInteger(reveal) || reveal < 0 || reveal > 2 || slots[reveal] === null) throw new Error("必须亮出一名在场的人物");
  return { slots, eat, eatenId, reveal };
}

export function characterName(id: string | null): string {
  return id ? character(id).name : "（空）";
}
