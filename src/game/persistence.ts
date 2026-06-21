import { BOONS, CARDS, DIFFICULTIES, ENEMIES, POTIONS, POWER_LABELS, RELICS } from "./data";
import { isEventId } from "./events";
import type {
  BoonId,
  BoonOffer,
  CardInstance,
  CardOffer,
  CombatState,
  DifficultyKey,
  EnemyDef,
  EnemyEffect,
  EnemyMove,
  EnemyState,
  EventOption,
  EventState,
  MapNode,
  NodeType,
  Phase,
  PlayerState,
  PotionInstance,
  PotionOffer,
  PowerMap,
  RelicOffer,
  RewardState,
  RunStats,
  RunState,
  ShopState,
} from "./types";

export const ACTIVE_RUN_SAVE_KEY = "spire-rogue:active-run:v1";

export type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function isActiveRun(run: Pick<RunState, "phase">): boolean {
  return !["title", "victory", "defeat"].includes(run.phase);
}

export function saveRun(run: RunState, storage = getDefaultStorage()): boolean {
  if (!storage || !isActiveRun(run)) {
    return false;
  }

  try {
    storage.setItem(ACTIVE_RUN_SAVE_KEY, JSON.stringify(run));
    return true;
  } catch {
    return false;
  }
}

export function clearSavedRun(storage = getDefaultStorage()): boolean {
  if (!storage) {
    return false;
  }

  try {
    storage.removeItem(ACTIVE_RUN_SAVE_KEY);
    return true;
  } catch {
    return false;
  }
}

export function loadSavedRun(storage = getDefaultStorage()): RunState | undefined {
  if (!storage) {
    return undefined;
  }

  try {
    const raw = storage.getItem(ACTIVE_RUN_SAVE_KEY);
    if (!raw) {
      return undefined;
    }

    const parsed = JSON.parse(raw) as SavedRunDraft;
    if (!isValidSavedRun(parsed)) {
      clearSavedRun(storage);
      return undefined;
    }

    return normalizeSavedRun(parsed);
  } catch {
    clearSavedRun(storage);
    return undefined;
  }
}

type SavedRunDraft = Partial<Omit<RunState, "player" | "stats" | "combat" | "reward" | "shop">> & {
  player?: Partial<PlayerState>;
  stats?: Partial<RunStats>;
  combat?: Partial<CombatState>;
  reward?: Partial<RewardState>;
  shop?: Partial<ShopState>;
  act?: number;
};

const DEFAULT_STATS: RunStats = {
  fights: 0,
  elites: 0,
  bosses: 0,
  cardsPlayed: 0,
  damageDealt: 0,
  goldEarned: 0,
  nodesCleared: 0,
};
const ACTIVE_PHASES: Phase[] = ["map", "combat", "reward", "rest", "shop", "event"];
const NODE_TYPES: NodeType[] = ["fight", "elite", "rest", "shop", "event", "boss"];
const ENEMY_INTENTS: EnemyMove["intent"][] = ["attack", "defend", "buff", "debuff", "mixed", "unknown"];
const CARD_DESTINATIONS: Array<Extract<EnemyEffect, { type: "createCard" }>["destination"]> = ["hand", "draw", "discard"];

function normalizeSavedRun(run: SavedRunDraft): RunState {
  const difficulty = normalizeDifficulty(run.difficulty);
  const seed = finiteNumber(run.seed, Date.now()) >>> 0;
  const map = normalizeMap(run.map);
  const act = typeof run.act === "number" && Number.isInteger(run.act) && run.act > 0 ? run.act : 1;
  const normalized: RunState = {
    ...run,
    phase: normalizePhase(run.phase),
    seed,
    rng: finiteNumber(run.rng, seed || 1) >>> 0 || 1,
    runId: typeof run.runId === "string" && run.runId ? run.runId : `legacy-${seed || Date.now()}`,
    difficulty,
    act,
    floor: Math.max(0, Math.floor(finiteNumber(run.floor, 0))),
    player: normalizePlayer(run.player, difficulty),
    map,
    currentNodeId:
      typeof run.currentNodeId === "string" && map.some((node) => node.id === run.currentNodeId)
        ? run.currentNodeId
        : undefined,
    combat: run.combat ? normalizeCombat(run.combat) : undefined,
    reward: run.reward ? normalizeReward(run.reward, difficulty) : undefined,
    shop: run.shop ? normalizeShop(run.shop, difficulty) : undefined,
    event: run.event ? normalizeEvent(run.event) : undefined,
    message: typeof run.message === "string" ? run.message : undefined,
    stats: normalizeStats(run.stats),
  };

  if (
    normalized.phase === "combat" &&
    (!normalized.combat || normalized.combat.enemies.length === 0 || normalized.combat.enemies.every((enemy) => enemy.hp <= 0))
  ) {
    normalized.phase = "map";
    normalized.combat = undefined;
  }
  if (normalized.phase === "reward" && !normalized.reward) {
    normalized.phase = "map";
  }
  if (normalized.phase === "shop" && !normalized.shop) {
    normalized.phase = "map";
  }
  if (normalized.phase === "event" && !normalized.event) {
    normalized.phase = "map";
  }

  if (normalized.phase === "map" && normalized.currentNodeId) {
    const current = normalized.map.find((node) => node.id === normalized.currentNodeId);
    if (current && !current.completed) {
      normalized.currentNodeId = inferRouteTipNodeId(normalized.map);
    }
  }

  return normalized;
}

function normalizePlayer(player: Partial<PlayerState> | undefined, difficulty: DifficultyKey): PlayerState {
  const config = DIFFICULTIES[difficulty];
  const maxHp = Math.max(1, Math.floor(finiteNumber(player?.maxHp, config.startingHp)));
  const hp = clamp(Math.floor(finiteNumber(player?.hp, maxHp)), 1, maxHp);
  const potions = normalizePotions(player?.potions).slice(0, 5);
  const boons = normalizeBoons(player?.boons);
  const boonPotionSlots = boons.includes("bottle_rack") ? 4 : 3;
  const potionSlotCap = 5;
  const potionSlots = Math.min(
    potionSlotCap,
    Math.max(boonPotionSlots, potions.length, Math.floor(finiteNumber(player?.potionSlots, 3))),
  );

  return {
    hp,
    maxHp,
    gold: Math.max(0, Math.floor(finiteNumber(player?.gold, config.startingGold))),
    deck: normalizeCards(player?.deck),
    relics: normalizeRelics(player?.relics),
    boons,
    potions,
    potionSlots,
  };
}

function normalizeStats(stats: Partial<RunStats> | undefined): RunStats {
  return {
    fights: Math.max(0, Math.floor(finiteNumber(stats?.fights, DEFAULT_STATS.fights))),
    elites: Math.max(0, Math.floor(finiteNumber(stats?.elites, DEFAULT_STATS.elites))),
    bosses: Math.max(0, Math.floor(finiteNumber(stats?.bosses, DEFAULT_STATS.bosses))),
    cardsPlayed: Math.max(0, Math.floor(finiteNumber(stats?.cardsPlayed, DEFAULT_STATS.cardsPlayed))),
    damageDealt: Math.max(0, Math.floor(finiteNumber(stats?.damageDealt, DEFAULT_STATS.damageDealt))),
    goldEarned: Math.max(0, Math.floor(finiteNumber(stats?.goldEarned, DEFAULT_STATS.goldEarned))),
    nodesCleared: Math.max(0, Math.floor(finiteNumber(stats?.nodesCleared, DEFAULT_STATS.nodesCleared))),
  };
}

function normalizeCombat(combat: Partial<CombatState>): CombatState {
  return {
    nodeType: normalizeNodeType(combat.nodeType, "fight"),
    encounterName: typeof combat.encounterName === "string" && combat.encounterName ? combat.encounterName : "遭遇战",
    enemies: normalizeEnemies(combat.enemies),
    drawPile: normalizeCards(combat.drawPile, "draw"),
    hand: normalizeCards(combat.hand, "hand"),
    discardPile: normalizeCards(combat.discardPile, "discard"),
    exhaustPile: normalizeCards(combat.exhaustPile, "exhaust"),
    energy: Math.max(0, Math.floor(finiteNumber(combat.energy, 3))),
    maxEnergy: Math.max(0, Math.floor(finiteNumber(combat.maxEnergy, 3))),
    turn: Math.max(0, Math.floor(finiteNumber(combat.turn, 0))),
    playerBlock: Math.max(0, Math.floor(finiteNumber(combat.playerBlock, 0))),
    playerPowers: normalizePowers(combat.playerPowers),
    cardsPlayedThisTurn: Math.max(0, Math.floor(finiteNumber(combat.cardsPlayedThisTurn, 0))),
    cardsPlayedLastTurn: Math.max(0, Math.floor(finiteNumber(combat.cardsPlayedLastTurn, 0))),
    attackCount: Math.max(0, Math.floor(finiteNumber(combat.attackCount, 0))),
    attacksPlayedThisTurn: Math.max(0, Math.floor(finiteNumber(combat.attacksPlayedThisTurn, 0))),
    log: arrayOrEmpty(combat.log),
  };
}

function normalizeReward(reward: Partial<RewardState>, difficulty: DifficultyKey): RewardState {
  return {
    nodeType: normalizeNodeType(reward.nodeType, "fight"),
    title: typeof reward.title === "string" && reward.title ? reward.title : "战利品",
    gold: Math.max(0, Math.floor(finiteNumber(reward.gold, 0))),
    cards: normalizeCardOffers(reward.cards),
    relicId: isKnownRelic(reward.relicId) ? reward.relicId : undefined,
    potionId: isKnownPotion(reward.potionId) ? reward.potionId : undefined,
    boons: normalizeBoonOffers(reward.boons),
    cardResolved: reward.cardResolved,
    boonResolved: reward.boonResolved,
    rerollPrice: positivePrice(reward.rerollPrice, 24, difficulty),
    rerolled: reward.rerolled,
  };
}

function normalizeShop(shop: Partial<ShopState>, difficulty: DifficultyKey): ShopState {
  return {
    cards: normalizeCardOffers(shop.cards),
    relics: normalizeRelicOffers(shop.relics),
    potions: normalizePotionOffers(shop.potions),
    boons: normalizeBoonOffers(shop.boons),
    healPrice: positivePrice(shop.healPrice, 45, difficulty),
    healSold: shop.healSold,
    removePrice: positivePrice(shop.removePrice, 75, difficulty),
    removeSold: shop.removeSold,
    restockPrice: positivePrice(shop.restockPrice, 55, difficulty),
    restocked: shop.restocked,
  };
}

function normalizeEvent(event: Partial<EventState>): EventState | undefined {
  if (!isEventId(event.id)) {
    return undefined;
  }

  const options = arrayOrEmpty(event.options)
    .map((option) => normalizeEventOption(option))
    .filter((option): option is EventOption => Boolean(option));

  return {
    id: event.id,
    title: typeof event.title === "string" && event.title ? event.title : "事件",
    text: typeof event.text === "string" ? event.text : "",
    options: options.length > 0 ? options : [{ id: "leave", label: "离开", text: "不发生任何事。" }],
  };
}

function normalizeEventOption(option: Partial<EventOption>): EventOption | undefined {
  if (typeof option.id !== "string" || !option.id) {
    return undefined;
  }

  return {
    id: option.id,
    label: typeof option.label === "string" && option.label ? option.label : "选择",
    text: typeof option.text === "string" ? option.text : "",
    disabled: Boolean(option.disabled),
    disabledReason: typeof option.disabledReason === "string" ? option.disabledReason : undefined,
  };
}

function normalizeCards(cards: CardInstance[] | undefined, prefix = "card"): CardInstance[] {
  return arrayOrEmpty(cards)
    .filter((card) => isKnownCard(card.cardId))
    .map((card, index) => ({
      uid: typeof card.uid === "string" && card.uid ? card.uid : `legacy-${prefix}-${index}-${card.cardId}`,
      cardId: card.cardId,
      upgraded: Boolean(card.upgraded),
    }));
}

function normalizePotions(potions: PotionInstance[] | undefined): PotionInstance[] {
  return arrayOrEmpty(potions)
    .filter((potion) => isKnownPotion(potion.potionId))
    .map((potion, index) => ({
      uid: typeof potion.uid === "string" && potion.uid ? potion.uid : `legacy-potion-${index}-${potion.potionId}`,
      potionId: potion.potionId,
    }));
}

function normalizeBoons(boons: BoonId[] | undefined): BoonId[] {
  const seen = new Set<BoonId>();
  const normalized: BoonId[] = [];
  for (const boonId of arrayOrEmpty(boons)) {
    if (isKnownBoon(boonId) && !seen.has(boonId)) {
      seen.add(boonId);
      normalized.push(boonId);
    }
  }
  return normalized;
}

function normalizeRelics(relics: string[] | undefined): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const relicId of arrayOrEmpty(relics)) {
    if (isKnownRelic(relicId) && !seen.has(relicId)) {
      seen.add(relicId);
      normalized.push(relicId);
    }
  }
  return normalized;
}

function normalizeCardOffers(offers: CardOffer[] | undefined): CardOffer[] {
  return arrayOrEmpty(offers)
    .filter((offer) => isKnownCard(offer.cardId))
    .map((offer) => ({
      cardId: offer.cardId,
      upgraded: Boolean(offer.upgraded),
      price: Number.isFinite(offer.price) ? Math.max(1, Math.round(offer.price!)) : undefined,
      sold: offer.sold,
    }));
}

function normalizeRelicOffers(offers: RelicOffer[] | undefined): RelicOffer[] {
  return arrayOrEmpty(offers)
    .filter((offer) => isKnownRelic(offer.relicId))
    .map((offer) => ({
      relicId: offer.relicId,
      price: Math.max(1, Math.round(finiteNumber(offer.price, 1))),
      sold: offer.sold,
    }));
}

function normalizePotionOffers(offers: PotionOffer[] | undefined): PotionOffer[] {
  return arrayOrEmpty(offers)
    .filter((offer) => isKnownPotion(offer.potionId))
    .map((offer) => ({
      potionId: offer.potionId,
      price: Math.max(1, Math.round(finiteNumber(offer.price, 1))),
      sold: offer.sold,
    }));
}

function normalizeBoonOffers(offers: BoonOffer[] | undefined): BoonOffer[] {
  return arrayOrEmpty(offers)
    .filter((offer) => isKnownBoon(offer.boonId))
    .map((offer) => ({
      boonId: offer.boonId,
      price: Number.isFinite(offer.price) ? Math.max(1, Math.round(offer.price!)) : undefined,
      sold: offer.sold,
    }));
}

function normalizePowers(powers: PowerMap | undefined): PowerMap {
  const normalized: PowerMap = {};
  for (const [power, value] of Object.entries(powers ?? {})) {
    if (isKnownPower(power) && Number.isFinite(value) && value > 0) {
      normalized[power] = Math.floor(value);
    }
  }
  return normalized;
}

function normalizeEnemies(enemies: EnemyState[] | undefined): EnemyState[] {
  return arrayOrEmpty(enemies)
    .map((enemy, index) => normalizeEnemy(enemy, index))
    .filter((enemy): enemy is EnemyState => Boolean(enemy));
}

function normalizeEnemy(enemy: Partial<EnemyState>, index: number): EnemyState | undefined {
  if (!isKnownEnemy(enemy.defId)) {
    return undefined;
  }

  const def = ENEMIES[enemy.defId];
  const maxHp = Math.max(1, Math.floor(finiteNumber(enemy.maxHp, def.maxHp[1])));
  const hp = clamp(Math.floor(finiteNumber(enemy.hp, maxHp)), 0, maxHp);
  const lastMoveId =
    typeof enemy.lastMoveId === "string" && def.moves.some((move) => move.id === enemy.lastMoveId)
      ? enemy.lastMoveId
      : undefined;

  return {
    uid: typeof enemy.uid === "string" && enemy.uid ? enemy.uid : `legacy-enemy-${index}-${def.id}`,
    defId: def.id,
    name: typeof enemy.name === "string" && enemy.name ? enemy.name : def.name,
    maxHp,
    hp,
    block: Math.max(0, Math.floor(finiteNumber(enemy.block, 0))),
    powers: normalizePowers(enemy.powers),
    intent: normalizeEnemyMove(enemy.intent, def),
    moveIndex: Math.max(0, Math.floor(finiteNumber(enemy.moveIndex, 0))),
    lastMoveId,
  };
}

function normalizeEnemyMove(move: Partial<EnemyMove> | undefined, def: EnemyDef): EnemyMove {
  const template = def.moves.find((candidate) => candidate.id === move?.id) ?? def.moves[0];
  return {
    id: template.id,
    name: typeof move?.name === "string" && move.name ? move.name : template.name,
    intent: isEnemyIntent(move?.intent) ? move.intent : template.intent,
    weight: Math.max(1, Math.round(finiteNumber(move?.weight, template.weight))),
    effects: normalizeEnemyEffects(move?.effects, template.effects),
  };
}

function normalizeEnemyEffects(effects: EnemyEffect[] | undefined, fallback: EnemyEffect[]): EnemyEffect[] {
  const normalized = arrayOrEmpty(effects)
    .map((effect) => normalizeEnemyEffect(effect))
    .filter((effect): effect is EnemyEffect => Boolean(effect));
  return normalized.length > 0 ? normalized : copyEnemyEffects(fallback);
}

function normalizeEnemyEffect(effect: Partial<EnemyEffect> | undefined): EnemyEffect | undefined {
  if (!effect || typeof effect.type !== "string") {
    return undefined;
  }

  if (effect.type === "damage") {
    const amount = Math.max(0, Math.floor(finiteNumber(effect.amount, 0)));
    const hits = Math.max(1, Math.floor(finiteNumber(effect.hits, 1)));
    return hits > 1 ? { type: "damage", amount, hits } : { type: "damage", amount };
  }

  if (effect.type === "block") {
    return { type: "block", amount: Math.max(0, Math.floor(finiteNumber(effect.amount, 0))) };
  }

  if (effect.type === "applyPower" && isKnownPower(effect.power) && (effect.target === "player" || effect.target === "self")) {
    return {
      type: "applyPower",
      power: effect.power,
      amount: Math.max(0, Math.floor(finiteNumber(effect.amount, 0))),
      target: effect.target,
    };
  }

  if (effect.type === "summon" && isKnownEnemy(effect.enemyId)) {
    return { type: "summon", enemyId: effect.enemyId };
  }

  if (effect.type === "createCard" && isKnownCard(effect.cardId) && isCardDestination(effect.destination)) {
    return {
      type: "createCard",
      cardId: effect.cardId,
      destination: effect.destination,
      upgraded: Boolean(effect.upgraded),
    };
  }

  return undefined;
}

function copyEnemyEffects(effects: EnemyEffect[]): EnemyEffect[] {
  return effects.map((effect) => ({ ...effect }));
}

function normalizeMap(map: MapNode[] | undefined): MapNode[] {
  const normalized: MapNode[] = [];
  const seen = new Set<string>();
  for (const node of arrayOrEmpty(map)) {
    if (typeof node.id !== "string" || !node.id || seen.has(node.id) || !isNodeType(node.type)) {
      continue;
    }
    seen.add(node.id);
    normalized.push({
      id: node.id,
      floor: Math.max(0, Math.floor(finiteNumber(node.floor, 0))),
      lane: clamp(Math.floor(finiteNumber(node.lane, 1)), 0, 6),
      x: finiteNumber(node.x, 0),
      y: finiteNumber(node.y, 0),
      type: node.type,
      children: arrayOrEmpty(node.children).filter((childId) => typeof childId === "string" && childId),
      completed: Boolean(node.completed),
    });
  }

  const ids = new Set(normalized.map((node) => node.id));
  for (const node of normalized) {
    node.children = node.children.filter((childId) => ids.has(childId));
  }
  return normalized;
}

function inferRouteTipNodeId(map: MapNode[]): string | undefined {
  const completed = map.filter((node) => node.completed);
  if (completed.length === 0) {
    return undefined;
  }

  const deepestFloor = Math.max(...completed.map((node) => node.floor));
  return completed.find((node) => node.floor === deepestFloor)?.id;
}

function isValidSavedRun(run: SavedRunDraft | undefined): run is SavedRunDraft {
  return Boolean(run?.player && hasValidMapShape(run.map) && isActivePhase(run.phase));
}

function getDefaultStorage(): StorageLike | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }

  return window.localStorage;
}

function normalizeDifficulty(difficulty: unknown): DifficultyKey {
  return typeof difficulty === "string" && Object.prototype.hasOwnProperty.call(DIFFICULTIES, difficulty)
    ? (difficulty as DifficultyKey)
    : "standard";
}

function normalizePhase(phase: unknown): Phase {
  return isActivePhase(phase) ? phase : "map";
}

function normalizeNodeType(nodeType: unknown, fallback: NodeType): NodeType {
  return isNodeType(nodeType) ? nodeType : fallback;
}

function isActivePhase(phase: unknown): phase is Phase {
  return typeof phase === "string" && ACTIVE_PHASES.includes(phase as Phase);
}

function isNodeType(nodeType: unknown): nodeType is NodeType {
  return typeof nodeType === "string" && NODE_TYPES.includes(nodeType as NodeType);
}

function hasValidMapShape(map: unknown): map is MapNode[] {
  if (!Array.isArray(map)) {
    return false;
  }

  const nodes = map.filter((node) => node && typeof node.id === "string" && isNodeType(node.type)) as MapNode[];
  const ids = new Set(nodes.map((node) => node.id));
  const starts = nodes.filter((node) => Math.floor(finiteNumber(node.floor, -1)) === 0);
  const bossIds = new Set(nodes.filter((node) => node.type === "boss").map((node) => node.id));
  if (starts.length === 0 || bossIds.size === 0) {
    return false;
  }

  const queue = starts.map((node) => node.id);
  const seen = new Set(queue);
  while (queue.length > 0) {
    const nodeId = queue.shift()!;
    if (bossIds.has(nodeId)) {
      return true;
    }
    const node = nodes.find((item) => item.id === nodeId);
    for (const childId of Array.isArray(node?.children) ? node.children : []) {
      if (typeof childId === "string" && ids.has(childId) && !seen.has(childId)) {
        seen.add(childId);
        queue.push(childId);
      }
    }
  }

  return false;
}

function isKnownCard(cardId: unknown): cardId is string {
  return typeof cardId === "string" && Object.prototype.hasOwnProperty.call(CARDS, cardId);
}

function isKnownPotion(potionId: unknown): potionId is string {
  return typeof potionId === "string" && Object.prototype.hasOwnProperty.call(POTIONS, potionId);
}

function isKnownRelic(relicId: unknown): relicId is string {
  return typeof relicId === "string" && Object.prototype.hasOwnProperty.call(RELICS, relicId);
}

function isKnownBoon(boonId: unknown): boonId is BoonId {
  return typeof boonId === "string" && Object.prototype.hasOwnProperty.call(BOONS, boonId);
}

function isKnownEnemy(enemyId: unknown): enemyId is string {
  return typeof enemyId === "string" && Object.prototype.hasOwnProperty.call(ENEMIES, enemyId);
}

function isKnownPower(power: unknown): power is keyof typeof POWER_LABELS {
  return typeof power === "string" && Object.prototype.hasOwnProperty.call(POWER_LABELS, power);
}

function isEnemyIntent(intent: unknown): intent is EnemyMove["intent"] {
  return typeof intent === "string" && ENEMY_INTENTS.includes(intent as EnemyMove["intent"]);
}

function isCardDestination(destination: unknown): destination is Extract<EnemyEffect, { type: "createCard" }>["destination"] {
  return typeof destination === "string" && CARD_DESTINATIONS.includes(destination as Extract<EnemyEffect, { type: "createCard" }>["destination"]);
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function positivePrice(value: unknown, basePrice: number, difficulty: DifficultyKey): number {
  const fallback = Math.round(basePrice * DIFFICULTIES[difficulty].shopPriceMultiplier);
  return Math.max(1, Math.round(finiteNumber(value, fallback)));
}

function arrayOrEmpty<T>(value: T[] | undefined): T[] {
  return Array.isArray(value) ? value : [];
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
