import {
  BOON_POOL,
  BOONS,
  CARDS,
  DIFFICULTIES,
  ENCOUNTERS,
  ENEMIES,
  POTION_POOL,
  POTIONS,
  RELIC_POOL,
  RELICS,
  REWARD_CARD_IDS,
} from "./data";
import { EVENT_IDS, isEventId, type EventId } from "./events";
import type {
  BoonId,
  BoonOffer,
  CardDef,
  CardEffect,
  CardInstance,
  CardLevel,
  CardOffer,
  CardType,
  CombatState,
  DifficultyConfig,
  DifficultyKey,
  EnemyEffect,
  EnemyMove,
  EnemyState,
  EventState,
  ExhaustCardsEffect,
  MapNode,
  MapRouteKind,
  NodeType,
  Phase,
  PotionEffect,
  PotionInstance,
  PotionOffer,
  PowerKey,
  PowerMap,
  RelicOffer,
  RewardState,
  RunState,
  ShopState,
} from "./types";

const STARTER_DECK = [
  "strike",
  "strike",
  "strike",
  "strike",
  "defend",
  "defend",
  "defend",
  "bash",
  "quick_stab",
  "deep_cut",
  "expose_weakness",
];

const TEMPORARY_POWERS: PowerKey[] = ["vulnerable", "weak", "frail"];
const MAX_LOG_LINES = 9;
const MAX_HAND_SIZE = 10;
const FINAL_ACT = 2;
const ACT_MAP_SEED_STEP = 8191;
const MAP_ROUTE_FLOORS = 11;
const MAP_VIRTUAL_LANES = 7;
const INVALID_CARD_DEF: CardDef = {
  id: "invalid_card",
  name: "失效卡牌",
  type: "Status",
  rarity: "status",
  base: {
    cost: 0,
    text: "这张牌来自旧数据，无法打出。",
    unplayable: true,
    effects: [],
  },
  upgraded: {
    cost: 0,
    text: "这张牌来自旧数据，无法打出。",
    unplayable: true,
    effects: [],
  },
};

export function createInitialRun(
  seed = Date.now(),
  phase: Phase = "title",
  difficulty: DifficultyKey = "standard",
): RunState {
  const normalizedSeed = seed >>> 0;
  const config = DIFFICULTIES[difficulty];
  return {
    phase,
    seed: normalizedSeed,
    rng: normalizedSeed || 1,
    runId: makeUid("run"),
    difficulty,
    act: 1,
    floor: 0,
    player: {
      hp: config.startingHp,
      maxHp: config.startingHp,
      gold: config.startingGold,
      deck: STARTER_DECK.map((cardId) => makeCardInstance(cardId)),
      relics: ["ember_core"],
      boons: [],
      potions: [],
      potionSlots: 3,
    },
    map: generateMap(mapSeedForAct(normalizedSeed || 1, 1)),
    stats: {
      fights: 0,
      elites: 0,
      bosses: 0,
      cardsPlayed: 0,
      damageDealt: 0,
      goldEarned: 0,
      nodesCleared: 0,
    },
  };
}

export function getCardDef(cardId: string): CardDef {
  return CARDS[cardId] ?? INVALID_CARD_DEF;
}

export function getCardLevel(card: CardInstance): CardLevel {
  const def = getCardDef(card.cardId);
  return card.upgraded ? def.upgraded : def.base;
}

function cardAppliesSelfPower(card: CardInstance, power: PowerKey): boolean {
  return getCardLevel(card).effects.some(
    (effect) => effect.type === "applyPower" && effect.target === "self" && effect.power === power && effect.amount > 0,
  );
}

export function makeCardInstance(cardId: string, upgraded = false): CardInstance {
  return {
    uid: makeUid("card"),
    cardId,
    upgraded,
  };
}

export function cardNeedsTarget(card: CardInstance): boolean {
  return getCardLevel(card).effects.some(effectTargetsSingleEnemy);
}

function effectTargetsSingleEnemy(effect: CardEffect | PotionEffect): boolean {
  return "target" in effect && effect.target === "enemy";
}

export function canPlayCard(run: RunState, card: CardInstance): boolean {
  if (run.phase !== "combat" || !run.combat) {
    return false;
  }
  if (getCardLevel(card).unplayable) {
    return false;
  }
  return run.combat.energy >= getCardLevel(card).cost;
}

export function makePotionInstance(potionId: string): PotionInstance {
  return {
    uid: makeUid("potion"),
    potionId,
  };
}

export function potionNeedsTarget(potion: PotionInstance): boolean {
  return Boolean(POTIONS[potion.potionId]?.effects.some(effectTargetsSingleEnemy));
}

export function getAvailableNodeIds(run: RunState): string[] {
  if (!run.currentNodeId) {
    return recoverAvailableNodeIds(run);
  }

  const current = run.map.find((node) => node.id === run.currentNodeId);
  if (!current) {
    return recoverAvailableNodeIds(run);
  }

  if (!current?.completed) {
    return [];
  }

  return getOpenChildren(run, current);
}

function recoverAvailableNodeIds(run: RunState): string[] {
  const completed = run.map.filter((node) => node.completed);
  if (completed.length === 0) {
    return run.map.filter((node) => node.floor === 0 && !node.completed).map((node) => node.id);
  }

  const deepestFloor = Math.max(...completed.map((node) => node.floor));
  const routeTips = completed.filter((node) => node.floor === deepestFloor);
  return uniqueStrings(routeTips.flatMap((node) => getOpenChildren(run, node)));
}

function getOpenChildren(run: RunState, node: MapNode): string[] {
  return node.children.filter((nodeId) => {
    const child = run.map.find((item) => item.id === nodeId);
    return child && !child.completed;
  });
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

export function enterNode(run: RunState, nodeId: string): RunState {
  if (!getAvailableNodeIds(run).includes(nodeId)) {
    return withMessage(run, "这条路线暂时不可进入。");
  }

  const next = clone(run);
  const node = next.map.find((item) => item.id === nodeId);
  if (!node) {
    return withMessage(run, "地图节点不存在。");
  }

  next.currentNodeId = nodeId;
  next.message = undefined;

  if (node.type === "fight" || node.type === "elite" || node.type === "boss") {
    return startCombat(next, node.type);
  }

  if (node.type === "rest") {
    next.phase = "rest";
    return next;
  }

  if (node.type === "shop") {
    if (hasRelic(next, "meal_ticket")) {
      healPlayer(next, 8);
      next.message = "餐券触发：进入商店回复 8 点生命。";
    }
    next.shop = createShop(next);
    next.phase = "shop";
    return next;
  }

  next.event = createEvent(next);
  next.phase = "event";
  return next;
}

export function playCard(run: RunState, cardUid: string, targetUid?: string): RunState {
  if (run.phase !== "combat" || !run.combat) {
    return run;
  }

  const next = clone(run);
  const combat = next.combat!;
  const handIndex = combat.hand.findIndex((card) => card.uid === cardUid);
  if (handIndex < 0) {
    return run;
  }

  const card = combat.hand[handIndex];
  const def = getCardDef(card.cardId);
  const level = getCardLevel(card);

  if (level.unplayable) {
    return withMessage(run, "这张牌不能打出。");
  }

  if (combat.energy < level.cost) {
    return withMessage(run, "能量不足。");
  }

  let target: EnemyState | undefined;
  if (cardNeedsTarget(card)) {
    target = combat.enemies.find((enemy) => enemy.uid === targetUid && enemy.hp > 0);
    if (!target) {
      return withMessage(run, "请选择一个有效目标。");
    }
  }

  combat.hand.splice(handIndex, 1);
  combat.energy -= level.cost;
  combat.cardsPlayedThisTurn += 1;
  next.stats.cardsPlayed += 1;

  if (def.type === "Attack") {
    combat.attackCount += 1;
    combat.attacksPlayedThisTurn += 1;
    addPower(combat.playerPowers, "combo", 1);
  }
  if (def.type === "Skill") {
    addPower(combat.playerPowers, "charge", 1);
  }

  addLog(combat, `打出 ${displayCardName(card)}。`);
  if (def.type === "Skill") {
    addLog(combat, "技能蓄能：获得 1 层蓄能。");
  }
  if (hasBoon(next, "rhythm_meter") && combat.cardsPlayedThisTurn === 2) {
    addPower(combat.playerPowers, "charge", 1);
    if (def.type === "Attack") {
      addPower(combat.playerPowers, "combo", 1);
      addLog(combat, "节拍器：本回合第 2 张牌获得 1 层蓄能，并因攻击额外获得 1 层连击。");
    } else {
      addLog(combat, "节拍器：本回合第 2 张牌获得 1 层蓄能。");
    }
  }
  if (hasBoon(next, "chain_manual") && combat.cardsPlayedThisTurn === 3) {
    combat.energy += 1;
    addPower(combat.playerPowers, "combo", 1);
    addLog(combat, "连锁手册：本回合第 3 张牌获得 1 点能量和 1 层连击。");
  }
  for (const effect of level.effects) {
    executeCardEffect(next, effect, target);
    if (isPlayerDead(next)) {
      return defeat(next, "你倒在了自己的代价之下。");
    }
    if (allEnemiesDefeated(next)) {
      movePlayedCard(combat, card, level, def);
      return finishCombat(next);
    }
  }

  if (def.type === "Attack" && hasRelic(next, "kunai") && combat.attackCount % 3 === 0) {
    addPower(combat.playerPowers, "dexterity", 1);
    addLog(combat, "苦无触发：获得 1 点敏捷。");
  }

  movePlayedCard(combat, card, level, def);
  if (allEnemiesDefeated(next)) {
    return finishCombat(next);
  }

  return next;
}

export function usePotion(run: RunState, potionUid: string, targetUid?: string): RunState {
  if (run.phase !== "combat" || !run.combat) {
    return run;
  }

  const next = clone(run);
  const combat = next.combat!;
  const potionIndex = next.player.potions.findIndex((potion) => potion.uid === potionUid);
  if (potionIndex < 0) {
    return run;
  }

  const potion = next.player.potions[potionIndex];
  const def = POTIONS[potion.potionId];
  if (!def) {
    next.player.potions.splice(potionIndex, 1);
    next.message = "这瓶药水已经失效，已丢弃。";
    return next;
  }
  let target: EnemyState | undefined;

  if (potionNeedsTarget(potion)) {
    target = combat.enemies.find((enemy) => enemy.uid === targetUid && enemy.hp > 0);
    if (!target) {
      return withMessage(run, "请选择一个药水目标。");
    }
  }

  next.player.potions.splice(potionIndex, 1);
  addLog(combat, `使用 ${def.name}。`);

  for (const effect of def.effects) {
    executePotionEffect(next, effect, target);
    if (isPlayerDead(next)) {
      return defeat(next, "你倒在了药水的副作用里。");
    }
    if (allEnemiesDefeated(next)) {
      return finishCombat(next);
    }
  }

  if (hasBoon(next, "potion_catalyst") && next.phase === "combat" && next.combat) {
    addPower(next.combat.playerPowers, "charge", 1);
    addLog(next.combat, "催化腰包：使用药水后获得 1 层蓄能。");
  }

  if (hasRelic(next, "alchemy_stone") && next.phase === "combat" && next.combat) {
    next.combat.energy += 1;
    drawCards(next, 1);
    addLog(next.combat, "炼金石触发：使用药水后获得 1 点能量并抽 1 张牌。");
  }

  return next;
}

export function discardPotion(run: RunState, potionUid: string): RunState {
  if (!["map", "reward", "rest", "shop", "event"].includes(run.phase)) {
    return run;
  }

  const potionIndex = run.player.potions.findIndex((potion) => potion.uid === potionUid);
  if (potionIndex < 0) {
    return run;
  }

  const next = clone(run);
  const [potion] = next.player.potions.splice(potionIndex, 1);
  next.message = POTIONS[potion.potionId] ? `丢弃药水：${POTIONS[potion.potionId].name}。` : "丢弃失效药水。";
  return next;
}

export function endTurn(run: RunState): RunState {
  if (run.phase !== "combat" || !run.combat) {
    return run;
  }

  const next = clone(run);
  const combat = next.combat!;
  combat.cardsPlayedLastTurn = combat.cardsPlayedThisTurn;
  combat.cardsPlayedThisTurn = 0;
  combat.attacksPlayedThisTurn = 0;
  if ((combat.playerPowers.combo ?? 0) > 0) {
    delete combat.playerPowers.combo;
    addLog(combat, "连击在回合结束时清空。");
  }
  if ((combat.playerPowers.charge ?? 0) > 0) {
    addPower(combat.playerPowers, "charge", -1);
    addLog(combat, "蓄能在回合结束时衰减 1 层。");
  }

  const retained: CardInstance[] = [];
  for (const card of combat.hand) {
    const level = getCardLevel(card);

    if (level.endTurnDamage) {
      takePlayerHpLoss(next, level.endTurnDamage);
      addLog(combat, `${displayCardName(card)} 造成 ${level.endTurnDamage} 点伤害。`);
      if (isPlayerDead(next)) {
        return defeat(next, "状态牌的伤害击败了你。");
      }
    }

    if (level.ethereal) {
      combat.exhaustPile.push(card);
      addLog(combat, `${displayCardName(card)} 因虚无被消耗。`);
    } else if (level.retain) {
      retained.push(card);
    } else {
      combat.discardPile.push(card);
    }
  }
  combat.hand = retained;
  addLog(combat, retained.length > 0 ? `结束回合，保留 ${retained.length} 张牌。` : "结束回合，弃掉手牌。");

  for (const enemy of combat.enemies) {
    if (enemy.hp > 0) {
      enemy.block = 0;
    }
  }

  for (const enemy of combat.enemies) {
    if (enemy.hp <= 0) {
      continue;
    }

    addLog(combat, `${enemy.name} 使用 ${enemy.intent.name}。`);
    for (const effect of enemy.intent.effects) {
      executeEnemyEffect(next, enemy, effect);
      if (isPlayerDead(next)) {
        return defeat(next, `${enemy.name} 击败了你。`);
      }
    }
  }

  for (const enemy of combat.enemies) {
    if (enemy.hp <= 0) {
      continue;
    }
    const ritual = enemy.powers.ritual ?? 0;
    if (ritual > 0) {
      addPower(enemy.powers, "strength", ritual);
      addLog(combat, `${enemy.name} 的仪式生效，获得 ${ritual} 点力量。`);
    }
  }

  decrementPowers(combat.playerPowers, TEMPORARY_POWERS);
  for (const enemy of combat.enemies) {
    decrementPowers(enemy.powers, TEMPORARY_POWERS);
  }

  if (allEnemiesDefeated(next)) {
    return finishCombat(next);
  }

  assignEnemyIntents(next);
  return startPlayerTurn(next, true);
}

export function claimRewardCard(run: RunState, offerIndex?: number): RunState {
  if (run.phase !== "reward" || !run.reward) {
    return run;
  }

  const next = clone(run);
  const reward = next.reward!;

  if (reward.cardResolved) {
    const skipped: string[] = [];
    if (reward.potionId) {
      skipped.push("药水");
    }
    if (reward.boons?.length && !reward.boonResolved) {
      skipped.push("常驻提升");
    }
    next.message = skipped.length > 0 ? `跳过${skipped.join("、")}奖励。` : "继续前进。";
    return finishReward(next);
  }

  if (typeof offerIndex === "number") {
    const offer = reward.cards[offerIndex];
    if (offer && CARDS[offer.cardId]) {
      next.player.deck.push(makeCardInstance(offer.cardId, offer.upgraded));
      next.message = `获得卡牌：${CARDS[offer.cardId].name}${offer.upgraded ? "+" : ""}。`;
    } else {
      return withMessage(run, "这张奖励牌不存在。");
    }
  } else {
    const gold = scaleGold(next, 8);
    next.player.gold += gold;
    next.stats.goldEarned += gold;
    next.message = `跳过卡牌奖励，获得 ${gold} 金币。`;
  }

  reward.cardResolved = true;
  if (isRewardComplete(reward)) {
    return finishReward(next);
  }

  return next;
}

export function claimRewardPotion(run: RunState): RunState {
  if (run.phase !== "reward" || !run.reward?.potionId) {
    return run;
  }

  const potionId = run.reward.potionId;
  const next = clone(run);
  if (!POTIONS[potionId]) {
    next.reward!.potionId = undefined;
    next.message = "这瓶奖励药水已经失效。";
    if (isRewardComplete(next.reward!)) {
      return finishReward(next);
    }
    return next;
  }
  if (!grantPotion(next, potionId)) {
    return withMessage(run, "药水槽已满。");
  }

  next.reward!.potionId = undefined;
  next.message = `获得药水：${POTIONS[potionId].name}。`;
  if (isRewardComplete(next.reward!)) {
    return finishReward(next);
  }

  return next;
}

export function claimRewardBoon(run: RunState, offerIndex: number): RunState {
  if (run.phase !== "reward" || !run.reward?.boons?.length || run.reward.boonResolved) {
    return run;
  }

  const next = clone(run);
  const reward = next.reward!;
  const offer = reward.boons?.[offerIndex];
  if (!offer || !BOONS[offer.boonId]) {
    return withMessage(run, "这个常驻提升不存在。");
  }

  const potionCountBefore = next.player.potions.length;
  if (!grantBoon(next, offer.boonId)) {
    reward.boons = reward.boons?.filter((item) => item.boonId !== offer.boonId) ?? [];
    next.message = `已拥有常驻提升：${BOONS[offer.boonId].name}。`;
    if (reward.boons.length === 0) {
      reward.boonResolved = true;
    }
  } else {
    reward.boonResolved = true;
    next.message = `获得常驻提升：${BOONS[offer.boonId].name}${boonBonusText(next, offer.boonId, potionCountBefore)}。`;
  }

  if (isRewardComplete(reward)) {
    return finishReward(next);
  }

  return next;
}

export function rerollRewardCards(run: RunState): RunState {
  if (run.phase !== "reward" || !run.reward || run.reward.cardResolved || run.reward.rerolled) {
    return run;
  }

  const next = clone(run);
  const reward = next.reward!;
  const requestedPrice = reward.rerollPrice ?? scaleShopPrice(next, 24);
  const price = isUsableShopPrice(requestedPrice) ? requestedPrice : scaleShopPrice(next, 24);
  if (next.player.gold < price) {
    return withMessage(run, "金币不足。");
  }

  next.player.gold -= price;
  reward.cards = createCardRewards(next, reward.nodeType);
  reward.rerolled = true;
  reward.rerollPrice = price;
  next.message = `花费 ${price} 金币，重掷卡牌奖励。`;
  return next;
}

export function restHeal(run: RunState): RunState {
  if (run.phase !== "rest") {
    return run;
  }

  const next = clone(run);
  if (next.player.hp >= next.player.maxHp) {
    const gold = scaleGold(next, 6);
    next.player.gold += gold;
    next.stats.goldEarned += gold;
    next.message = `营火整备：生命已满，获得 ${gold} 金币。`;
    completeCurrentNode(next);
    next.phase = "map";
    return next;
  }

  const amount = Math.ceil(next.player.maxHp * 0.3);
  const hpBefore = next.player.hp;
  healPlayer(next, amount);
  next.message = `休息回复 ${next.player.hp - hpBefore} 点生命。`;
  completeCurrentNode(next);
  next.phase = "map";
  return next;
}

export function restUpgrade(run: RunState, cardUid: string): RunState {
  if (run.phase !== "rest") {
    return run;
  }

  const next = clone(run);
  const card = next.player.deck.find((item) => item.uid === cardUid);
  if (!card || card.upgraded) {
    return withMessage(run, "这张牌不能再升级。");
  }

  card.upgraded = true;
  next.message = `锻造升级：${CARDS[card.cardId].name}+。`;
  completeCurrentNode(next);
  next.phase = "map";
  return next;
}

export function restBrewPotion(run: RunState): RunState {
  if (run.phase !== "rest") {
    return run;
  }

  if (run.player.potions.length >= run.player.potionSlots) {
    return withMessage(run, "药水槽已满。");
  }

  const next = clone(run);
  const potionId = randomPotion(next);
  if (!potionId || !grantPotion(next, potionId)) {
    return withMessage(run, "药水槽已满。");
  }

  next.message = `营火调配：获得药水 ${POTIONS[potionId].name}。`;
  completeCurrentNode(next);
  next.phase = "map";
  return next;
}

export function restCleanseStatus(run: RunState): RunState {
  if (run.phase !== "rest") {
    return run;
  }

  const next = clone(run);
  const removed = removeRandomDeckCard(next, (card) => CARDS[card.cardId].type === "Status");
  if (!removed) {
    return withMessage(run, "没有状态牌可以清理。");
  }

  next.message = `营火清理：移除 ${displayCardName(removed)}。`;
  completeCurrentNode(next);
  next.phase = "map";
  return next;
}

export function buyShopCard(run: RunState, index: number): RunState {
  if (run.phase !== "shop" || !run.shop) {
    return run;
  }

  const next = clone(run);
  const offer = next.shop!.cards[index];
  if (!offer || offer.sold || !CARDS[offer.cardId] || !isUsableShopPrice(offer.price)) {
    return run;
  }

  if (next.player.gold < offer.price) {
    return withMessage(run, "金币不足。");
  }

  next.player.gold -= offer.price;
  next.player.deck.push(makeCardInstance(offer.cardId, offer.upgraded));
  offer.sold = true;
  next.message = `购买卡牌：${CARDS[offer.cardId].name}${offer.upgraded ? "+" : ""}。`;
  return next;
}

export function buyShopRelic(run: RunState, index: number): RunState {
  if (run.phase !== "shop" || !run.shop) {
    return run;
  }

  const next = clone(run);
  const offer = next.shop!.relics[index];
  if (!offer || offer.sold || !RELICS[offer.relicId] || !isUsableShopPrice(offer.price)) {
    return run;
  }

  if (next.player.gold < offer.price) {
    return withMessage(run, "金币不足。");
  }

  if (next.player.relics.includes(offer.relicId)) {
    offer.sold = true;
    return withMessage(next, "已经拥有这个遗物。");
  }

  next.player.gold -= offer.price;
  grantRelic(next, offer.relicId);
  offer.sold = true;
  next.message = `购买遗物：${RELICS[offer.relicId].name}。`;
  return next;
}

export function buyShopBoon(run: RunState, index: number): RunState {
  if (run.phase !== "shop" || !run.shop) {
    return run;
  }

  const next = clone(run);
  const offer = next.shop!.boons[index];
  if (!offer || offer.sold || !BOONS[offer.boonId] || !isUsableShopPrice(offer.price)) {
    return run;
  }

  if (next.player.gold < offer.price) {
    return withMessage(run, "金币不足。");
  }

  const potionCountBefore = next.player.potions.length;
  if (!grantBoon(next, offer.boonId)) {
    offer.sold = true;
    return withMessage(next, "已经拥有这个常驻提升。");
  }

  next.player.gold -= offer.price;
  offer.sold = true;
  next.message = `购买常驻提升：${BOONS[offer.boonId].name}${boonBonusText(next, offer.boonId, potionCountBefore)}。`;
  return next;
}

export function buyShopHeal(run: RunState): RunState {
  if (run.phase !== "shop" || !run.shop) {
    return run;
  }

  const next = clone(run);
  if (next.shop!.healSold || !isUsableShopPrice(next.shop!.healPrice)) {
    return run;
  }

  if (next.player.hp >= next.player.maxHp) {
    return withMessage(run, "生命已满。");
  }

  if (next.player.gold < next.shop!.healPrice) {
    return withMessage(run, "金币不足。");
  }

  next.player.gold -= next.shop!.healPrice;
  healPlayer(next, 14);
  next.shop!.healSold = true;
  next.message = "购买治疗：回复 14 点生命。";
  return next;
}

export function buyShopPotion(run: RunState, index: number): RunState {
  if (run.phase !== "shop" || !run.shop) {
    return run;
  }

  const next = clone(run);
  const offer = next.shop!.potions[index];
  if (!offer || offer.sold || !POTIONS[offer.potionId] || !isUsableShopPrice(offer.price)) {
    return run;
  }

  if (next.player.gold < offer.price) {
    return withMessage(run, "金币不足。");
  }

  if (!grantPotion(next, offer.potionId)) {
    return withMessage(run, "药水槽已满。");
  }

  next.player.gold -= offer.price;
  offer.sold = true;
  next.message = `购买药水：${POTIONS[offer.potionId].name}。`;
  return next;
}

export function buyShopRemove(run: RunState, cardUid: string): RunState {
  if (run.phase !== "shop" || !run.shop) {
    return run;
  }

  const next = clone(run);
  if (next.shop!.removeSold) {
    return run;
  }

  if (next.player.deck.length <= 1) {
    return withMessage(run, "牌组不能再减少。");
  }

  if (!isUsableShopPrice(next.shop!.removePrice)) {
    return run;
  }

  if (next.player.gold < next.shop!.removePrice) {
    return withMessage(run, "金币不足。");
  }

  const index = next.player.deck.findIndex((card) => card.uid === cardUid);
  if (index < 0) {
    return withMessage(run, "这张牌不在牌组中。");
  }

  const [removed] = next.player.deck.splice(index, 1);
  next.player.gold -= next.shop!.removePrice;
  next.shop!.removeSold = true;
  next.message = `移除卡牌：${displayCardName(removed)}。`;
  return next;
}

export function restockShop(run: RunState): RunState {
  if (run.phase !== "shop" || !run.shop) {
    return run;
  }

  const next = clone(run);
  const shop = next.shop!;
  if (shop.restocked) {
    return withMessage(run, "这个商店已经刷新过库存。");
  }

  const price = shop.restockPrice ?? scaleShopPrice(next, 55);
  if (!isUsableShopPrice(price)) {
    return run;
  }

  if (next.player.gold < price) {
    return withMessage(run, "金币不足。");
  }

  next.player.gold -= price;
  const fresh = createShop(next);
  next.shop = {
    ...shop,
    cards: fresh.cards,
    relics: fresh.relics,
    potions: fresh.potions,
    boons: fresh.boons,
    restockPrice: price,
    restocked: true,
  };
  next.message = `支付 ${price} 金币，刷新商店库存。`;
  return next;
}

export function leaveShop(run: RunState): RunState {
  if (run.phase !== "shop") {
    return run;
  }

  const next = clone(run);
  completeCurrentNode(next);
  next.shop = undefined;
  next.phase = "map";
  next.message = next.message ?? "离开商店。";
  return next;
}

export function chooseEventOption(run: RunState, optionId: string): RunState {
  if (run.phase !== "event" || !run.event) {
    return run;
  }

  const next = clone(run);
  const refreshedEvent = getCurrentEvent(next);
  if (!refreshedEvent) {
    return withMessage(run, "这个事件已经失效。");
  }
  next.event = refreshedEvent;
  const event = next.event!;
  const option = event.options.find((item) => item.id === optionId);
  if (!option) {
    return withMessage(next, "这个选择现在不可用。");
  }
  if (option.disabled) {
    return withMessage(next, option.disabledReason ? `这个选择现在不可用：${option.disabledReason}。` : "这个选择现在不可用。");
  }

  if (event.id === "blood_shrine" && optionId === "offer") {
    const relicId = randomRelic(next);
    if (relicId) {
      next.player.hp = Math.max(1, next.player.hp - 8);
      grantRelic(next, relicId);
      next.message = `献祭 8 点生命，获得遗物：${RELICS[relicId].name}。`;
    } else {
      next.message = "泉眼里已经没有新的遗物回响。";
    }
  }

  if (event.id === "blood_shrine" && optionId === "sip") {
    healPlayer(next, 12);
    next.message = "你浅尝泉水，回复 12 点生命。";
  }

  if (event.id === "forgotten_armory" && optionId === "weapon") {
    const cardId = randomCard(next, (card) => card.type === "Attack");
    next.player.deck.push(makeCardInstance(cardId, true));
    next.message = `获得升级攻击牌：${CARDS[cardId].name}+。`;
  }

  if (event.id === "forgotten_armory" && optionId === "armor") {
    next.player.maxHp += 5;
    healPlayer(next, 5);
    next.message = "修补护甲：最大生命 +5，并回复 5 点生命。";
  }

  if (event.id === "merchant_cache" && optionId === "take_gold") {
    const gold = scaleGold(next, 65);
    next.player.gold += gold;
    next.stats.goldEarned += gold;
    next.message = `打开暗格：获得 ${gold} 金币。`;
  }

  if (event.id === "merchant_cache" && optionId === "invest") {
    next.player.gold -= 40;
    const upgraded = upgradeRandomCards(next, 2);
    next.message = `支付 40 金币，升级 ${upgraded} 张牌。`;
  }

  if (event.id === "alchemist_table" && optionId === "brew") {
    const potionId = randomPotion(next);
    if (potionId && grantPotion(next, potionId)) {
      next.message = `调制成功：获得药水 ${POTIONS[potionId].name}。`;
    }
  }

  if (event.id === "alchemist_table" && optionId === "distill") {
    next.player.hp = Math.max(1, next.player.hp - 5);
    let gained = 0;
    for (let i = 0; i < 2; i += 1) {
      const potionId = randomPotion(next);
      if (potionId && grantPotion(next, potionId)) {
        gained += 1;
      }
    }
    next.message = `用血蒸馏：失去 5 点生命，获得 ${gained} 瓶药水。`;
  }

  if (event.id === "alchemist_table" && optionId === "rack") {
    if (next.player.potionSlots >= 5) {
      next.message = "药水槽已达上限。";
    } else {
      next.player.gold -= 55;
      next.player.potionSlots += 1;
      next.message = "购买折叠瓶架：药水槽永久 +1。";
    }
  }

  if (event.id === "static_obelisk" && optionId === "attune") {
    if (grantBoon(next, "static_attunement")) {
      next.player.hp = Math.max(1, next.player.hp - 6);
      next.message = `静电灌入骨髓：获得常驻提升 ${BOONS.static_attunement.name}。`;
    } else {
      next.message = `已拥有常驻提升：${BOONS.static_attunement.name}。`;
    }
  }

  if (event.id === "static_obelisk" && optionId === "blade") {
    next.player.hp = Math.max(1, next.player.hp - 7);
    next.player.deck.push(makeCardInstance("arc_blade", true));
    next.player.deck.push(makeCardInstance("dazed"));
    next.message = "拔出弧光残刃：获得弧光刃+，并将 1 张晕眩加入牌组。";
  }

  if (event.id === "static_obelisk" && optionId === "bottle") {
    if (grantPotion(next, "charge_potion")) {
      next.message = `收集余电：获得药水 ${POTIONS.charge_potion.name}。`;
    }
  }

  if (event.id === "storm_chest" && optionId === "socket") {
    next.player.deck.push(makeCardInstance("capacitor", true));
    const gainedPotion = grantPotion(next, "charge_potion");
    next.message = gainedPotion
      ? `嵌入电容：获得电容器+ 和 ${POTIONS.charge_potion.name}。`
      : "嵌入电容：获得电容器+。";
  }

  if (event.id === "storm_chest" && optionId === "overload") {
    next.player.hp = Math.max(1, next.player.hp - 6);
    next.player.deck.push(makeCardInstance("discharge", true));
    next.player.deck.push(makeCardInstance("dazed"));
    next.message = "过载核心：失去 6 点生命，获得放电+，并将 1 张晕眩加入牌组。";
  }

  if (event.id === "storm_chest" && optionId === "sell_core") {
    const gold = scaleGold(next, 45);
    next.player.gold += gold;
    next.stats.goldEarned += gold;
    next.player.deck.push(makeCardInstance("wound"));
    next.message = `拆卖线圈：获得 ${gold} 金币，并将 1 张伤口加入牌组。`;
  }

  if (event.id === "living_mirror" && optionId === "copy") {
    next.player.hp = Math.max(1, next.player.hp - 6);
    const copied = duplicateRandomDeckCard(next, (card) => CARDS[card.cardId].rarity !== "starter");
    next.message = copied
      ? `镜面复制：失去 6 点生命，复制 ${displayCardName(copied)}。`
      : "镜面没有找到值得复制的牌。";
  }

  if (event.id === "living_mirror" && optionId === "transmute") {
    const result = transformRandomDeckCard(next);
    next.message = result
      ? `镜面重塑：${displayCardName(result.oldCard)} 变为 ${displayCardName(result.newCard)}。`
      : "没有可以重塑的牌。";
  }

  if (event.id === "living_mirror" && optionId === "shatter") {
    next.player.hp = Math.max(1, next.player.hp - 4);
    const removed = removeRandomDeckCard(next, (card) => card.cardId === "strike" || card.cardId === "defend");
    next.message = removed
      ? `击碎倒影：失去 4 点生命，移除 ${displayCardName(removed)}。`
      : "镜片碎裂，但没有基础牌可以移除。";
  }

  if (event.id === "boon_carver" && optionId === "commission") {
    const boonId = randomBoon(next);
    const potionCountBefore = next.player.potions.length;
    if (boonId && grantBoon(next, boonId)) {
      next.player.gold -= 50;
      next.message = `支付刻纹：获得常驻提升 ${BOONS[boonId].name}${boonBonusText(next, boonId, potionCountBefore)}。`;
    } else {
      next.message = "刻纹师已经没有新的常驻提升可以刻下。";
    }
  }

  if (event.id === "boon_carver" && optionId === "blood_mark") {
    const boonId = randomBoon(next);
    const potionCountBefore = next.player.potions.length;
    if (boonId && grantBoon(next, boonId)) {
      next.player.hp = Math.max(1, next.player.hp - 8);
      next.message = `血刻：失去 8 点生命，获得常驻提升 ${BOONS[boonId].name}${boonBonusText(next, boonId, potionCountBefore)}。`;
    } else {
      next.message = "刻纹师已经没有新的常驻提升可以刻下。";
    }
  }

  if (event.id === "boon_carver" && optionId === "chip") {
    next.player.hp = Math.max(1, next.player.hp - 3);
    const removed = removeRandomDeckCard(
      next,
      (card) => CARDS[card.cardId].rarity === "status" || card.cardId === "strike" || card.cardId === "defend",
    );
    next.message = removed
      ? `刮除旧纹：失去 3 点生命，移除 ${displayCardName(removed)}。`
      : "刻刀落空，没有可刮除的牌。";
  }

  if (event.id === "cursed_archive" && optionId === "read") {
    const cardId = randomCard(next, (card) => card.rarity === "rare");
    next.player.deck.push(makeCardInstance(cardId));
    next.player.deck.push(makeCardInstance("burn"));
    next.message = `读完禁页：获得 ${CARDS[cardId].name}，并将 1 张灼烧加入牌组。`;
  }

  if (event.id === "cursed_archive" && optionId === "erase") {
    next.player.hp = Math.max(1, next.player.hp - 6);
    const removed = removeRandomDeckCard(next);
    next.message = removed
      ? `墨迹吞字：失去 6 点生命，移除 ${displayCardName(removed)}。`
      : "没有可以移除的牌。";
  }

  if (event.id === "cursed_archive" && optionId === "seal") {
    const boonId = randomBoon(next);
    const potionCountBefore = next.player.potions.length;
    if (boonId && grantBoon(next, boonId)) {
      next.player.deck.push(makeCardInstance("wound"));
      next.message = `封印低语：获得常驻提升 ${BOONS[boonId].name}${boonBonusText(next, boonId, potionCountBefore)}，并将 1 张伤口加入牌组。`;
    } else {
      next.message = "档案室已经没有新的常驻提升可以封存。";
    }
  }

  if (event.id === "wandering_trainer" && optionId === "lesson") {
    next.player.gold -= 35;
    const upgraded = upgradeRandomCards(next, 1);
    next.message = `支付 35 金币，训练升级 ${upgraded} 张牌。`;
  }

  if (event.id === "wandering_trainer" && optionId === "spar") {
    next.player.hp = Math.max(1, next.player.hp - 7);
    const cardId = randomCard(next, (card) => card.type === "Attack" || card.type === "Skill");
    next.player.deck.push(makeCardInstance(cardId, true));
    next.message = `实战切磋：失去 7 点生命，获得 ${CARDS[cardId].name}+。`;
  }

  if (event.id === "wandering_trainer" && optionId === "breathe") {
    healPlayer(next, 8);
    next.message = "调整呼吸：回复 8 点生命。";
  }

  if (event.id === "crystal_garden" && optionId === "harvest") {
    const gold = scaleGold(next, 35);
    next.player.gold += gold;
    next.stats.goldEarned += gold;
    next.player.deck.push(makeCardInstance("poison_dart"));
    next.message = `采下晶簇：获得 ${gold} 金币和淬毒飞镖。`;
  }

  if (event.id === "crystal_garden" && optionId === "rest") {
    healPlayer(next, 14);
    next.message = "在晶簇旁休息：回复 14 点生命。";
  }

  if (event.id === "crystal_garden" && optionId === "root") {
    next.player.maxHp += 3;
    healPlayer(next, 3);
    next.message = "吞下根晶：最大生命 +3，并回复 3 点生命。";
  }

  if (event.id === "quiet_clinic" && optionId === "cleanse") {
    next.player.gold -= 30;
    const removed = removeRandomDeckCard(next, (card) => CARDS[card.cardId].rarity === "status");
    next.message = removed ? `清创完成：移除 ${displayCardName(removed)}。` : "没有状态牌可以清创。";
  }

  if (event.id === "quiet_clinic" && optionId === "serum") {
    const potionId = randomPotion(next);
    if (potionId && grantPotion(next, potionId)) {
      healPlayer(next, 4);
      next.message = `取血清：获得药水 ${POTIONS[potionId].name}，并回复 4 点生命。`;
    }
  }

  if (event.id === "quiet_clinic" && optionId === "stitch") {
    healPlayer(next, 16);
    next.message = "静默缝合：回复 16 点生命。";
  }

  if (event.id === "memory_well" && optionId === "dredge") {
    next.player.gold -= 35;
    next.player.deck.push(makeCardInstance("salvage", true));
    const removed = removeRandomDeckCard(next, (card) => CARDS[card.cardId].rarity === "status");
    next.message = removed
      ? `记忆打捞：支付 35 金币，获得战场回收+，并移除 ${displayCardName(removed)}。`
      : "记忆打捞：支付 35 金币，获得战场回收+。";
  }

  if (event.id === "memory_well" && optionId === "echo") {
    next.player.hp = Math.max(1, next.player.hp - 5);
    next.player.deck.push(makeCardInstance("memory_hook", true));
    next.message = "取走回声：失去 5 点生命，获得记忆钩索+。";
  }

  if (event.id === "memory_well" && optionId === "siphon") {
    const potionId = randomPotion(next);
    const gained = potionId ? grantPotion(next, potionId) : false;
    healPlayer(next, 3);
    next.message = gained && potionId ? `虹吸井水：获得药水 ${POTIONS[potionId].name}，并回复 3 点生命。` : "虹吸井水：回复 3 点生命。";
  }

  if (event.id === "rune_forge" && optionId === "etch") {
    next.player.gold -= 45;
    const upgraded = upgradeRandomCards(next, 2);
    next.message = `符文刻蚀：支付 45 金币，升级 ${upgraded} 张牌。`;
  }

  if (event.id === "rune_forge" && optionId === "reforge") {
    next.player.hp = Math.max(1, next.player.hp - 6);
    const result = transformRandomDeckCard(next);
    if (result) {
      result.newCard.upgraded = true;
      next.message = `高温重铸：失去 6 点生命，${displayCardName(result.oldCard)} 变为 ${displayCardName(result.newCard)}。`;
    } else {
      next.message = "高温重铸失败：没有可重铸的牌。";
    }
  }

  if (event.id === "rune_forge" && optionId === "quench") {
    next.player.deck.push(makeCardInstance("plated_guard", true));
    next.player.deck.push(makeCardInstance("burn"));
    next.message = "冷却护具：获得镀层防守+，并将 1 张灼烧加入牌组。";
  }

  if (event.id === "venom_greenhouse" && optionId === "coat_blade") {
    if (grantBoon(next, "blade_oil")) {
      next.player.gold -= 30;
      next.message = `涂刃仪式：支付 30 金币，获得常驻提升 ${BOONS.blade_oil.name}。`;
    } else {
      next.message = `已拥有常驻提升：${BOONS.blade_oil.name}。`;
    }
  }

  if (event.id === "venom_greenhouse" && optionId === "distill_venom") {
    next.player.deck.push(makeCardInstance("venom_stance", true));
    next.player.deck.push(makeCardInstance("dazed"));
    next.message = "萃取毒囊：获得毒刃架势+，并将 1 张晕眩加入牌组。";
  }

  if (event.id === "venom_greenhouse" && optionId === "take_sample") {
    const gainedPotion = grantPotion(next, "poison_potion");
    next.player.deck.push(makeCardInstance("poison_dart"));
    next.message = gainedPotion ? "采走样本：获得毒药水和淬毒飞镖。" : "采走样本：获得淬毒飞镖。";
  }

  if (event.id === "plated_sanctum" && optionId === "train_plate") {
    if (grantBoon(next, "plate_training")) {
      next.player.gold -= 45;
      next.message = `镀层演练：支付 45 金币，获得常驻提升 ${BOONS.plate_training.name}。`;
    } else {
      next.message = `已拥有常驻提升：${BOONS.plate_training.name}。`;
    }
  }

  if (event.id === "plated_sanctum" && optionId === "forge_guard") {
    next.player.hp = Math.max(1, next.player.hp - 4);
    next.player.deck.push(makeCardInstance("plated_guard", true));
    next.message = "铸造护势：失去 4 点生命，获得镀层防守+。";
  }

  if (event.id === "plated_sanctum" && optionId === "patch_armor") {
    healPlayer(next, 10);
    next.message = "修补甲片：回复 10 点生命。";
  }

  if (event.id === "bottled_spirit" && optionId === "release") {
    const boonId = randomBoon(next);
    const potionCountBefore = next.player.potions.length - 1;
    const consumed = boonId ? removeRandomPotion(next) : undefined;
    if (consumed && boonId && grantBoon(next, boonId)) {
      next.message = `释放瓶中精魂：消耗 ${POTIONS[consumed.potionId].name}，获得常驻提升 ${BOONS[boonId].name}${boonBonusText(next, boonId, potionCountBefore)}。`;
    } else {
      next.message = "瓶中精魂沉寂，没有发生变化。";
    }
  }

  if (event.id === "bottled_spirit" && optionId === "decant") {
    const consumed = removeRandomPotion(next);
    const gold = scaleGold(next, 42);
    if (consumed) {
      next.player.gold += gold;
      next.stats.goldEarned += gold;
      next.message = `倒卖精粹：消耗 ${POTIONS[consumed.potionId].name}，获得 ${gold} 金币。`;
    }
  }

  if (event.id === "bottled_spirit" && optionId === "stabilize") {
    if (next.player.potionSlots >= 5) {
      next.message = "药水槽已达上限。";
    } else {
      next.player.gold -= 35;
      next.player.potionSlots += 1;
      next.message = "稳定瓶架：支付 35 金币，药水槽永久 +1。";
    }
  }

  if (event.id === "path_scout" && optionId === "chart_rest") {
    const node = convertNextRouteNode(next, "rest");
    if (node) {
      next.player.gold -= 30;
      next.message = "绘制安全路线：支付 30 金币，将一个下一层节点改为休息点。";
    } else {
      next.message = "没有可改写的下一层路线。";
    }
  }

  if (event.id === "path_scout" && optionId === "mark_elite") {
    const node = convertNextRouteNode(next, "elite");
    if (node) {
      next.player.hp = Math.max(1, next.player.hp - 5);
      next.message = "标记高危猎物：失去 5 点生命，将一个下一层节点改为精英。";
    } else {
      next.message = "没有可标记的下一层路线。";
    }
  }

  if (event.id === "path_scout" && optionId === "take_rations") {
    healPlayer(next, 8);
    const gold = scaleGold(next, 18);
    next.player.gold += gold;
    next.stats.goldEarned += gold;
    next.message = `拿走补给：回复 8 点生命，获得 ${gold} 金币。`;
  }

  if (event.id === "flask_gambit" && optionId === "transfuse") {
    const boonId = randomBoon(next);
    const potionCountBefore = next.player.potions.length - 1;
    const consumed = boonId ? removeRandomPotion(next) : undefined;
    if (consumed && boonId && grantBoon(next, boonId)) {
      next.message = `药剂转注：消耗 ${POTIONS[consumed.potionId].name}，获得常驻提升 ${BOONS[boonId].name}${boonBonusText(next, boonId, potionCountBefore)}。`;
    } else {
      next.message = "玻璃管里没有新的常驻提升可以凝结。";
    }
  }

  if (event.id === "flask_gambit" && optionId === "overbrew") {
    if (next.player.gold < 28 || next.player.potions.length >= next.player.potionSlots) {
      next.message = next.player.gold < 28 ? "金币不足。" : "药水槽已满。";
    } else {
      next.player.gold -= 28;
      let gained = 0;
      while (next.player.potions.length < next.player.potionSlots) {
        const potionId = randomPotion(next);
        if (!potionId || !grantPotion(next, potionId)) {
          break;
        }
        gained += 1;
      }
      next.message = `过量调配：支付 28 金币，补充 ${gained} 瓶药水。`;
    }
  }

  if (event.id === "flask_gambit" && optionId === "crack_case") {
    if (next.player.potionSlots >= 5) {
      next.message = "药水槽已达上限。";
    } else {
      next.player.potionSlots += 1;
      next.player.deck.push(makeCardInstance("slimed"));
      next.message = "敲开瓶匣：药水槽永久 +1，并将 1 张黏液加入牌组。";
    }
  }

  if (event.id === "relic_tinker" && optionId === "tune") {
    next.player.gold -= 55;
    const relicId = randomRelic(next);
    if (relicId) {
      grantRelic(next, relicId);
      const upgraded = upgradeRandomCards(next, 1);
      next.message = `校准遗物：支付 55 金币，获得遗物 ${RELICS[relicId].name}，并升级 ${upgraded} 张牌。`;
    } else {
      next.player.gold += 55;
      next.message = "没有新的遗物可以校准。";
    }
  }

  if (event.id === "relic_tinker" && optionId === "pawn") {
    const removed = removeRandomRelic(next);
    if (removed) {
      const gold = scaleGold(next, 85);
      next.player.gold += gold;
      next.stats.goldEarned += gold;
      const upgraded = upgradeRandomCards(next, 2);
      next.message = `典当遗物：失去 ${RELICS[removed].name}，获得 ${gold} 金币，并升级 ${upgraded} 张牌。`;
    } else {
      next.message = "没有可典当的非初始遗物。";
    }
  }

  if (event.id === "relic_tinker" && optionId === "polish") {
    const upgraded = upgradeRandomCards(next, 1);
    healPlayer(next, 6);
    next.message = `精修护具：升级 ${upgraded} 张牌，并回复 6 点生命。`;
  }

  if (event.id === "fracture_gate" && optionId === "step_through") {
    next.player.hp = Math.max(1, next.player.hp - 9);
    next.player.deck.push(makeCardInstance("fracture_thrust", true));
    const gainedPotion = grantPotion(next, "fracture_potion");
    next.message = gainedPotion
      ? `穿过门扉：失去 9 点生命，获得裂隙突刺+ 和 ${POTIONS.fracture_potion.name}。`
      : "穿过门扉：失去 9 点生命，获得裂隙突刺+。";
  }

  if (event.id === "fracture_gate" && optionId === "map_cracks") {
    if (grantBoon(next, "weakpoint_chart")) {
      next.player.gold -= 35;
      next.message = `描摹裂纹：支付 35 金币，获得常驻提升 ${BOONS.weakpoint_chart.name}。`;
    } else {
      next.message = `已拥有常驻提升：${BOONS.weakpoint_chart.name}。`;
    }
  }

  if (event.id === "fracture_gate" && optionId === "seal_gate") {
    healPlayer(next, 10);
    next.player.deck.push(makeCardInstance("dazed"));
    next.message = "封住门扉：回复 10 点生命，并将 1 张晕眩加入牌组。";
  }

  if (event.id === "catalyst_lab" && optionId === "learn_pattern") {
    if (grantBoon(next, "catalyst_training")) {
      next.player.gold -= 40;
      next.message = `记录催化谱：支付 40 金币，获得常驻提升 ${BOONS.catalyst_training.name}。`;
    } else {
      next.message = `已拥有常驻提升：${BOONS.catalyst_training.name}。`;
    }
  }

  if (event.id === "catalyst_lab" && optionId === "take_vial") {
    if (grantPotion(next, "catalyst_potion")) {
      next.message = `拿走试剂：获得药水 ${POTIONS.catalyst_potion.name}。`;
    } else {
      next.message = "药水槽已满。";
    }
  }

  if (event.id === "catalyst_lab" && optionId === "record_formula") {
    next.player.hp = Math.max(1, next.player.hp - 6);
    next.player.deck.push(makeCardInstance("blood_catalyst", true));
    next.player.deck.push(makeCardInstance("burn"));
    next.message = "抄录血毒配方：失去 6 点生命，获得血毒催化+，并将 1 张灼烧加入牌组。";
  }

  if (event.id === "coil_workbench" && optionId === "plate_cache") {
    next.player.gold -= 35;
    next.player.deck.push(makeCardInstance("alloy_shell", true));
    const gainedPotion = grantPotion(next, "alloy_potion");
    next.message = gainedPotion
      ? `拿走防护匣：支付 35 金币，获得合金壳+ 和 ${POTIONS.alloy_potion.name}。`
      : "拿走防护匣：支付 35 金币，获得合金壳+。";
  }

  if (event.id === "coil_workbench" && optionId === "wind_coil") {
    next.player.hp = Math.max(1, next.player.hp - 5);
    next.player.deck.push(makeCardInstance("coil_lash", true));
    const gainedPotion = grantPotion(next, "overcharge_potion");
    next.message = gainedPotion
      ? `缠绕过载线圈：失去 5 点生命，获得线圈鞭击+ 和 ${POTIONS.overcharge_potion.name}。`
      : "缠绕过载线圈：失去 5 点生命，获得线圈鞭击+。";
  }

  if (event.id === "coil_workbench" && optionId === "temper_shell") {
    if (grantBoon(next, "tempered_shell")) {
      next.player.gold -= 45;
      next.message = `淬火外壳：支付 45 金币，获得常驻提升 ${BOONS.tempered_shell.name}。`;
    } else {
      next.message = `已拥有常驻提升：${BOONS.tempered_shell.name}。`;
    }
  }

  if (event.id === "black_contract" && optionId === "underwrite") {
    const relicId = randomRelic(next);
    if (relicId) {
      next.player.gold -= 55;
      grantRelic(next, relicId);
      next.message = `黑市担保：支付 55 金币，获得遗物 ${RELICS[relicId].name}。`;
    } else {
      next.message = "掮客收起契约：已经没有新的遗物。";
    }
  }

  if (event.id === "black_contract" && optionId === "blood_clause") {
    next.player.maxHp = Math.max(1, next.player.maxHp - 6);
    next.player.hp = Math.min(next.player.hp, next.player.maxHp);
    const cardId = randomCard(next, (card) => card.rarity === "rare");
    next.player.deck.push(makeCardInstance(cardId));
    const upgraded = upgradeRandomCards(next, 1);
    next.message = `签下血契：最大生命 -6，获得 ${CARDS[cardId].name}，并升级 ${upgraded} 张牌。`;
  }

  if (event.id === "black_contract" && optionId === "contraband") {
    next.player.deck.push(makeCardInstance("alloy_shell"));
    next.player.deck.push(makeCardInstance("wound"));
    let gained = 0;
    for (let i = 0; i < 2; i += 1) {
      const potionId = randomPotion(next);
      if (!potionId || !grantPotion(next, potionId)) {
        break;
      }
      gained += 1;
    }
    next.message = `拿走违禁补给：获得合金壳和 ${gained} 瓶药水，并将 1 张伤口加入牌组。`;
  }

  if (event.id === "strategy_table" && optionId === "manual") {
    next.player.gold -= 32;
    next.player.deck.push(makeCardInstance("field_tactics", true));
    next.message = "收起预案：支付 32 金币，获得战地预案+。";
  }

  if (event.id === "strategy_table" && optionId === "kit") {
    if (grantPotion(next, "tactics_potion")) {
      next.player.gold -= 24;
      next.message = `拿走战术药剂：支付 24 金币，获得 ${POTIONS.tactics_potion.name}。`;
    } else {
      next.message = "药水槽已满。";
    }
  }

  if (event.id === "strategy_table" && optionId === "protocol") {
    if (grantBoon(next, "field_protocol")) {
      next.player.gold -= 48;
      next.message = `签下协议：支付 48 金币，获得常驻提升 ${BOONS.field_protocol.name}。`;
    } else {
      next.message = `已拥有常驻提升：${BOONS.field_protocol.name}。`;
    }
  }

  if (event.id === "old_warbanner" && optionId === "take_banner") {
    next.player.gold -= 34;
    next.player.deck.push(makeCardInstance("battle_rhythm", true));
    next.message = "取下旧战旗：支付 34 金币，获得战斗节拍+。";
  }

  if (event.id === "old_warbanner" && optionId === "rally_dose") {
    if (grantPotion(next, "tactics_potion")) {
      next.player.gold -= 24;
      next.message = `喝下军剂：支付 24 金币，获得 ${POTIONS.tactics_potion.name}。`;
    } else {
      next.message = "药水槽已满。";
    }
  }

  if (event.id === "old_warbanner" && optionId === "learn_drill") {
    if (grantBoon(next, "banner_drill")) {
      next.player.gold -= 48;
      next.message = `默记操典：支付 48 金币，获得常驻提升 ${BOONS.banner_drill.name}。`;
    } else {
      next.message = `已拥有常驻提升：${BOONS.banner_drill.name}。`;
    }
  }

  if (event.id === "field_infirmary" && optionId === "manual") {
    next.player.gold -= 30;
    next.player.deck.push(makeCardInstance("trauma_recycler", true));
    next.message = "收下清创手册：支付 30 金币，获得创伤回收+。";
  }

  if (event.id === "field_infirmary" && optionId === "salve") {
    if (grantPotion(next, "triage_potion")) {
      next.player.gold -= 24;
      next.message = `拿走清创剂：支付 24 金币，获得 ${POTIONS.triage_potion.name}。`;
    } else {
      next.message = "药水槽已满。";
    }
  }

  if (event.id === "field_infirmary" && optionId === "doctrine") {
    if (grantBoon(next, "triage_doctrine")) {
      next.player.gold -= 50;
      next.message = `记下战伤教范：支付 50 金币，获得常驻提升 ${BOONS.triage_doctrine.name}。`;
    } else {
      next.message = `已拥有常驻提升：${BOONS.triage_doctrine.name}。`;
    }
  }

  if (event.id === "ash_archive" && optionId === "ward") {
    next.player.gold -= 32;
    next.player.deck.push(makeCardInstance("ash_ward", true));
    next.message = "翻出护幕残页：支付 32 金币，获得余烬护幕+。";
  }

  if (event.id === "ash_archive" && optionId === "bottle") {
    if (grantPotion(next, "ash_potion")) {
      next.player.gold -= 24;
      next.message = `装瓶余烬：支付 24 金币，获得 ${POTIONS.ash_potion.name}。`;
    } else {
      next.message = "药水槽已满。";
    }
  }

  if (event.id === "ash_archive" && optionId === "ledger") {
    if (grantBoon(next, "ash_ledger")) {
      next.player.gold -= 50;
      next.message = `抄下账本：支付 50 金币，获得常驻提升 ${BOONS.ash_ledger.name}。`;
    } else {
      next.message = `已拥有常驻提升：${BOONS.ash_ledger.name}。`;
    }
  }

  if (event.id === "rhythm_metronome" && optionId === "calibrate") {
    next.player.gold -= 28;
    next.player.deck.push(makeCardInstance("rhythm_battery", true));
    next.message = "校准节拍：支付 28 金币，获得节拍电池+。";
  }

  if (event.id === "rhythm_metronome" && optionId === "drink") {
    if (grantPotion(next, "tempo_potion")) {
      next.player.gold -= 22;
      next.message = `喝下节拍剂：支付 22 金币，获得 ${POTIONS.tempo_potion.name}。`;
    } else {
      next.message = "药水槽已满。";
    }
  }

  if (event.id === "rhythm_metronome" && optionId === "meter") {
    if (grantBoon(next, "rhythm_meter")) {
      next.player.gold -= 48;
      next.message = `带走节拍器：支付 48 金币，获得常驻提升 ${BOONS.rhythm_meter.name}。`;
    } else {
      next.message = `已拥有常驻提升：${BOONS.rhythm_meter.name}。`;
    }
  }

  if (event.id === "chain_hourglass" && optionId === "bind") {
    next.player.gold -= 30;
    next.player.deck.push(makeCardInstance("chain_guard", true));
    next.message = "装订连锁页：支付 30 金币，获得连锁护法+。";
  }

  if (event.id === "chain_hourglass" && optionId === "dose") {
    if (grantPotion(next, "chain_potion")) {
      next.player.gold -= 24;
      next.message = `喝下连锁剂：支付 24 金币，获得 ${POTIONS.chain_potion.name}。`;
    } else {
      next.message = "药水槽已满。";
    }
  }

  if (event.id === "chain_hourglass" && optionId === "manual") {
    if (grantBoon(next, "chain_manual")) {
      next.player.gold -= 50;
      next.message = `抄下手册：支付 50 金币，获得常驻提升 ${BOONS.chain_manual.name}。`;
    } else {
      next.message = `已拥有常驻提升：${BOONS.chain_manual.name}。`;
    }
  }

  if (event.id === "cooling_station" && optionId === "plate") {
    next.player.gold -= 32;
    next.player.deck.push(makeCardInstance("heat_sink", true));
    next.message = "拆下散热片：支付 32 金币，获得散热片+。";
  }

  if (event.id === "cooling_station" && optionId === "coolant") {
    if (grantPotion(next, "coolant_potion")) {
      next.player.gold -= 24;
      next.message = `灌装冷却剂：支付 24 金币，获得 ${POTIONS.coolant_potion.name}。`;
    } else {
      next.message = "药水槽已满。";
    }
  }

  if (event.id === "cooling_station" && optionId === "regulator") {
    if (grantBoon(next, "heat_regulator")) {
      next.player.gold -= 52;
      next.message = `抄下热控铭文：支付 52 金币，获得常驻提升 ${BOONS.heat_regulator.name}。`;
    } else {
      next.message = `已拥有常驻提升：${BOONS.heat_regulator.name}。`;
    }
  }

  if (event.id === "triage_station" && optionId === "card_crate") {
    next.player.gold -= 25;
    const cardId = randomCard(next, (card) => card.rarity !== "starter" && card.rarity !== "status" && card.rarity !== "rare");
    const upgraded = randomFloat(next) < 0.35;
    next.player.deck.push(makeCardInstance(cardId, upgraded));
    next.message = `打开卡牌箱：支付 25 金币，获得 ${CARDS[cardId].name}${upgraded ? "+" : ""}。`;
  }

  if (event.id === "triage_station" && optionId === "potion_crate") {
    next.player.gold -= 20;
    let gained = 0;
    for (let i = 0; i < 2; i += 1) {
      const potionId = randomPotion(next);
      if (!potionId || !grantPotion(next, potionId)) {
        break;
      }
      gained += 1;
    }
    next.message = `打开药水箱：支付 20 金币，获得 ${gained} 瓶药水。`;
  }

  if (event.id === "triage_station" && optionId === "boon_token") {
    const boonId = randomBoon(next);
    const potionCountBefore = next.player.potions.length;
    if (boonId && grantBoon(next, boonId)) {
      next.player.hp = Math.max(1, next.player.hp - 5);
      next.message = `捏碎刻纹令牌：失去 5 点生命，获得常驻提升 ${BOONS[boonId].name}${boonBonusText(next, boonId, potionCountBefore)}。`;
    } else {
      next.message = "刻纹令牌已经没有新的常驻提升可以唤醒。";
    }
  }

  if (optionId === "leave") {
    next.message = "你没有冒险，继续前进。";
  }

  completeCurrentNode(next);
  next.event = undefined;
  next.phase = "map";
  return next;
}

export function getCurrentEvent(run: RunState): EventState | undefined {
  if (run.phase !== "event" || !run.event) {
    return undefined;
  }
  return createEventById(run, run.event.id);
}

export function abandonToTitle(run: RunState): RunState {
  return createInitialRun(run.seed + 1, "title", run.difficulty);
}

function startCombat(run: RunState, nodeType: NodeType): RunState {
  const encounter = pickEncounter(run, nodeType);
  const enemies = encounter.enemies.map((enemyId) => createEnemy(run, enemyId));
  const maxEnergy = 3 + (hasRelic(run, "star_orb") ? 1 : 0);
  const drawPile = shuffleCards(run, run.player.deck.map((card) => ({ ...card })));

  run.combat = {
    nodeType,
    encounterName: encounter.name,
    enemies,
    drawPile,
    hand: [],
    discardPile: [],
    exhaustPile: [],
    energy: maxEnergy,
    maxEnergy,
    turn: 0,
    playerBlock: 0,
    playerPowers: {},
    cardsPlayedThisTurn: 0,
    cardsPlayedLastTurn: 0,
    attackCount: 0,
    attacksPlayedThisTurn: 0,
    log: [`遭遇战：${encounter.name}。`],
  };

  if (hasRelic(run, "anchor")) {
    run.combat.playerBlock += 10;
    addLog(run.combat, "船锚触发：开局获得 10 点格挡。");
  }

  if (hasRelic(run, "bronze_scales")) {
    addPower(run.combat.playerPowers, "thorns", 3);
    addLog(run.combat, "青铜鳞片触发：获得 3 层尖刺。");
  }

  if (hasRelic(run, "red_skull") && run.player.hp <= Math.floor(run.player.maxHp / 2)) {
    addPower(run.combat.playerPowers, "strength", 3);
    addLog(run.combat, "红头骨触发：获得 3 点力量。");
  }

  if (hasRelic(run, "whetstone")) {
    addPower(run.combat.playerPowers, "strength", 1);
    addLog(run.combat, "磨刀石触发：获得 1 点力量。");
  }

  if (hasRelic(run, "threaded_needle")) {
    addPower(run.combat.playerPowers, "platedArmor", 1);
    addLog(run.combat, "穿线针触发：获得 1 层金属化。");
  }

  if (hasRelic(run, "charged_plate")) {
    run.combat.playerBlock += 5;
    addPower(run.combat.playerPowers, "charge", 2);
    addLog(run.combat, "充能甲片触发：获得 5 点格挡和 2 层蓄能。");
  }

  if (hasRelic(run, "storm_needle")) {
    addPower(run.combat.playerPowers, "platedArmor", 1);
    for (const enemy of run.combat.enemies) {
      addPower(enemy.powers, "spark", 1);
    }
    addLog(run.combat, "风暴针触发：获得 1 层金属化，所有敌人获得 1 层电弧。");
  }

  if (hasBoon(run, "blade_oil")) {
    addPower(run.combat.playerPowers, "strength", 1);
    addLog(run.combat, "刃油准备：开局获得 1 点力量。");
  }

  if (hasBoon(run, "banner_drill")) {
    addPower(run.combat.playerPowers, "strength", 1);
    for (const enemy of run.combat.enemies) {
      addPower(enemy.powers, "mark", 1);
    }
    addLog(run.combat, "战旗操典：开局获得 1 点力量，所有敌人获得 1 层破绽。");
  }

  if (hasBoon(run, "recovery_mantra")) {
    addPower(run.combat.playerPowers, "regen", 2);
    addLog(run.combat, "复苏默念：开局获得 2 层再生。");
  }

  if (hasRelic(run, "metronome")) {
    addPower(run.combat.playerPowers, "combo", 2);
    addLog(run.combat, "节拍器触发：获得 2 层连击。");
  }

  if (hasRelic(run, "serrated_edge")) {
    for (const enemy of run.combat.enemies) {
      addPower(enemy.powers, "bleed", 2);
    }
    addLog(run.combat, "锯齿刃触发：所有敌人获得 2 层流血。");
  }

  if (hasRelic(run, "toxic_vial")) {
    for (const enemy of run.combat.enemies) {
      addPower(enemy.powers, "poison", 2);
    }
    addLog(run.combat, "毒液小瓶触发：所有敌人获得 2 层中毒。");
  }

  if (hasRelic(run, "fracture_lens")) {
    for (const enemy of run.combat.enemies) {
      addPower(enemy.powers, "mark", 2);
    }
    addLog(run.combat, "裂纹透镜触发：所有敌人获得 2 层破绽。");
  }

  if (hasRelic(run, "echo_bell")) {
    run.combat.drawPile.unshift(makeCardInstance("memory_hook", true));
    addLog(run.combat, "回声铃触发：记忆钩索+被放到抽牌堆顶。");
  }

  if (hasBoon(run, "spark_conduit")) {
    for (const enemy of run.combat.enemies) {
      addPower(enemy.powers, "spark", 1);
    }
    addLog(run.combat, "导电脉络：所有敌人获得 1 层电弧。");
  }

  if (hasBoon(run, "bleed_edge")) {
    for (const enemy of run.combat.enemies) {
      addPower(enemy.powers, "bleed", 1);
    }
    addLog(run.combat, "刃口习惯：所有敌人获得 1 层流血。");
  }

  if (hasBoon(run, "venom_prep")) {
    for (const enemy of run.combat.enemies) {
      addPower(enemy.powers, "poison", 2);
    }
    addLog(run.combat, "毒囊预备：所有敌人获得 2 层中毒。");
  }

  if (hasBoon(run, "weakpoint_chart")) {
    for (const enemy of run.combat.enemies) {
      addPower(enemy.powers, "mark", 1);
    }
    addLog(run.combat, "破绽图谱：所有敌人获得 1 层破绽。");
  }

  if (hasBoon(run, "catalyst_training")) {
    for (const enemy of run.combat.enemies) {
      addPower(enemy.powers, "poison", 2);
      addPower(enemy.powers, "bleed", 1);
      addPower(enemy.powers, "mark", 1);
    }
    addLog(run.combat, "催化训练：所有敌人获得 2 层中毒、1 层流血和 1 层破绽。");
  }

  if (hasBoon(run, "scavenger_kit")) {
    run.combat.drawPile.unshift(makeCardInstance("salvage"));
    addLog(run.combat, "拾荒套件：战场回收被放到抽牌堆顶。");
  }

  if (hasBoon(run, "field_protocol")) {
    run.combat.drawPile.unshift(makeCardInstance("field_tactics"));
    addLog(run.combat, "战地协议：战地预案被放到抽牌堆顶。");
  }

  if (hasBoon(run, "triage_doctrine")) {
    run.combat.drawPile.unshift(makeCardInstance("trauma_recycler"));
    if (run.player.deck.some((card) => CARDS[card.cardId]?.type === "Status")) {
      addPower(run.combat.playerPowers, "charge", 1);
      addLog(run.combat, "战伤教范：创伤回收被放到抽牌堆顶，并因状态牌获得 1 层蓄能。");
    } else {
      addLog(run.combat, "战伤教范：创伤回收被放到抽牌堆顶。");
    }
  }

  if (hasBoon(run, "ash_ledger")) {
    run.combat.drawPile.unshift(makeCardInstance("ash_ward"));
    if (run.player.deck.some((card) => CARDS[card.cardId]?.type === "Status")) {
      run.combat.playerBlock += 3;
      addLog(run.combat, "余烬账本：余烬护幕被放到抽牌堆顶，并因状态牌获得 3 点格挡。");
    } else {
      addLog(run.combat, "余烬账本：余烬护幕被放到抽牌堆顶。");
    }
  }

  if (hasBoon(run, "heat_regulator")) {
    run.combat.drawPile.unshift(makeCardInstance("heat_sink"));
    if (run.player.deck.some((card) => cardAppliesSelfPower(card, "bleed"))) {
      addPower(run.combat.playerPowers, "charge", 1);
      addLog(run.combat, "热控铭文：散热片被放到抽牌堆顶，并因过载牌获得 1 层蓄能。");
    } else {
      addLog(run.combat, "热控铭文：散热片被放到抽牌堆顶。");
    }
  }

  if (hasBoon(run, "opening_guard")) {
    run.combat.playerBlock += 3;
    addLog(run.combat, "起手护势：开局获得 3 点格挡。");
  }

  if (hasBoon(run, "combo_discipline")) {
    addPower(run.combat.playerPowers, "combo", 1);
    addLog(run.combat, "连击纪律：开局获得 1 层连击。");
  }

  if (hasBoon(run, "rhythm_meter")) {
    addPower(run.combat.playerPowers, "combo", 1);
    addPower(run.combat.playerPowers, "charge", 1);
    addLog(run.combat, "节拍器：开局获得 1 层连击和 1 层蓄能。");
  }

  if (hasBoon(run, "static_attunement")) {
    addPower(run.combat.playerPowers, "charge", 2);
    addLog(run.combat, "静电调谐：开局获得 2 层蓄能。");
  }

  if (hasBoon(run, "plate_training")) {
    addPower(run.combat.playerPowers, "platedArmor", 1);
    addLog(run.combat, "镀层训练：开局获得 1 层金属化。");
  }

  if (hasBoon(run, "tempered_shell")) {
    addPower(run.combat.playerPowers, "platedArmor", 1);
    addPower(run.combat.playerPowers, "thorns", 2);
    addLog(run.combat, "淬火外壳：开局获得 1 层金属化和 2 层尖刺。");
  }

  if (hasBoon(run, "coil_training")) {
    addPower(run.combat.playerPowers, "charge", 1);
    addPower(run.combat.playerPowers, "combo", 1);
    addLog(run.combat, "线圈训练：开局获得 1 层蓄能和 1 层连击。");
  }

  assignEnemyIntents(run);
  run.phase = "combat";
  return startPlayerTurn(run, false);
}

function startPlayerTurn(run: RunState, resetBlock: boolean): RunState {
  const combat = run.combat;
  if (!combat) {
    return run;
  }

  combat.turn += 1;
  if (resetBlock) {
    combat.playerBlock = 0;
  }
  combat.attacksPlayedThisTurn = 0;

  tickOngoingPowers(run);
  if (isPlayerDead(run)) {
    return defeat(run, "持续伤害击败了你。");
  }
  if (allEnemiesDefeated(run)) {
    return finishCombat(run);
  }

  combat.energy = combat.maxEnergy;
  if (combat.turn === 1 && hasRelic(run, "ember_core")) {
    combat.energy += 1;
    addLog(combat, "余烬核心触发：本回合额外获得 1 点能量。");
  }
  if (combat.turn === 1 && hasBoon(run, "reserve_battery")) {
    combat.energy += 1;
    addPower(combat.playerPowers, "charge", 1);
    addLog(combat, "备用电池：第一回合额外获得 1 点能量和 1 层蓄能。");
  }
  if (combat.turn % 3 === 0 && hasRelic(run, "flower")) {
    combat.energy += 1;
    addLog(combat, "日轮花触发：本回合额外获得 1 点能量。");
  }

  const pocketDraw = hasRelic(run, "pocket_watch") && combat.turn > 1 && combat.cardsPlayedLastTurn <= 3 ? 2 : 0;
  if (pocketDraw > 0) {
    addLog(combat, "怀表触发：多抽 2 张牌。");
  }

  const focusDraw = hasBoon(run, "battle_focus") && combat.turn === 1 ? 1 : 0;
  if (focusDraw > 0) {
    addLog(combat, "战斗专注：第一回合多抽 1 张牌。");
  }

  drawCards(run, 5 + pocketDraw + focusDraw);
  addLog(combat, `第 ${combat.turn} 回合开始。`);
  return run;
}

function executeCardEffect(run: RunState, effect: CardEffect, target?: EnemyState): void {
  const combat = run.combat!;
  if (effect.type === "damage") {
    const targets = effect.target === "allEnemies" ? livingEnemies(combat) : target ? [target] : [];
    for (const enemy of targets) {
      for (let hit = 0; hit < (effect.hits ?? 1); hit += 1) {
        dealDamageToEnemy(run, enemy, effect.amount);
      }
    }
    return;
  }

  if (effect.type === "damageFromBlock") {
    if (target) {
      dealDamageToEnemy(run, target, Math.floor(combat.playerBlock * effect.multiplier));
    }
    return;
  }

  if (effect.type === "damagePerAttackPlayed") {
    const damage = effect.amount * Math.max(1, combat.attacksPlayedThisTurn);
    const targets = effect.target === "allEnemies" ? livingEnemies(combat) : target ? [target] : [];
    for (const enemy of targets) {
      dealDamageToEnemy(run, enemy, damage);
    }
    return;
  }

  if (effect.type === "damagePerPower") {
    const targets = effect.target === "allEnemies" ? livingEnemies(combat) : target ? [target] : [];
    if (effect.powerTarget === "self") {
      const available = combat.playerPowers[effect.power] ?? 0;
      const stacks = Math.max(effect.minimum ?? 0, available);
      const damage = effect.amount * stacks;
      for (const enemy of targets) {
        dealDamageToEnemy(run, enemy, damage);
      }
      if (effect.consume && available > 0) {
        delete combat.playerPowers[effect.power];
        addLog(combat, `消耗所有${powerName(effect.power)}。`);
      }
      return;
    }

    for (const enemy of targets) {
      const available = enemy.powers[effect.power] ?? 0;
      const stacks = Math.max(effect.minimum ?? 0, available);
      dealDamageToEnemy(run, enemy, effect.amount * stacks);
      if (effect.consume && available > 0) {
        delete enemy.powers[effect.power];
        addLog(combat, `${enemy.name} 的${powerName(effect.power)}被清除。`);
      }
    }
    return;
  }

  if (effect.type === "spendPowerDamage") {
    const available = combat.playerPowers[effect.power] ?? 0;
    const spent = Math.min(available, effect.consume ?? available);
    const stacks = Math.max(effect.minimum ?? 0, spent);
    const damage = effect.amount * stacks;
    const targets = effect.target === "allEnemies" ? livingEnemies(combat) : target ? [target] : [];
    for (const enemy of targets) {
      dealDamageToEnemy(run, enemy, damage);
    }
    if (spent > 0) {
      addPower(combat.playerPowers, effect.power, -spent);
      addLog(combat, `消耗 ${spent} 层${powerName(effect.power)}。`);
    }
    return;
  }

  if (effect.type === "block") {
    const block = calculatePlayerBlock(combat, effect.amount);
    combat.playerBlock += block;
    addLog(combat, `获得 ${block} 点格挡。`);
    return;
  }

  if (effect.type === "blockPerPower") {
    const available = combat.playerPowers[effect.power] ?? 0;
    const spent = Math.min(available, effect.consume ?? available);
    const stacks = Math.max(effect.minimum ?? 0, spent);
    const block = calculatePlayerBlock(combat, effect.amount * stacks);
    combat.playerBlock += block;
    if (spent > 0) {
      addPower(combat.playerPowers, effect.power, -spent);
      addLog(combat, `消耗 ${spent} 层${powerName(effect.power)}。`);
    }
    addLog(combat, `获得 ${block} 点格挡。`);
    return;
  }

  if (effect.type === "blockPerExhaustedCard") {
    const stacks = exhaustedCardStacks(combat, effect.cap, effect.minimum);
    const block = calculatePlayerBlock(combat, effect.amount * stacks);
    combat.playerBlock += block;
    addLog(combat, stacks > 0 ? `消耗堆回响：获得 ${block} 点格挡。` : "消耗堆还没有可回响的牌。");
    return;
  }

  if (effect.type === "gainPowerPerPower") {
    const stacks = selfPowerStacks(combat, effect.sourcePower, effect.cap, effect.minimum);
    const amount = effect.amount * stacks;
    if (amount > 0) {
      addPower(combat.playerPowers, effect.gainedPower, amount);
      addLog(combat, `${powerName(effect.sourcePower)}共振：获得 ${amount} 层${powerName(effect.gainedPower)}。`);
    } else {
      addLog(combat, `没有${powerName(effect.sourcePower)}可共振。`);
    }
    return;
  }

  if (effect.type === "gainPowerPerCardPlayed") {
    const stacks = cardPlayedStacks(combat, effect.cap, effect.minimum);
    const amount = effect.amount * stacks;
    if (amount > 0) {
      addPower(combat.playerPowers, effect.power, amount);
      addLog(combat, `连锁 ${stacks}：获得 ${amount} 层${powerName(effect.power)}。`);
    } else {
      addLog(combat, "连锁尚未启动。");
    }
    return;
  }

  if (effect.type === "cleansePower") {
    executeCleansePowerEffect(run, effect, "card");
    return;
  }

  if (effect.type === "applyPower") {
    if (effect.target === "self") {
      addPower(combat.playerPowers, effect.power, effect.amount);
      addLog(combat, `你获得 ${effect.amount} 层${powerName(effect.power)}。`);
      return;
    }

    const targets = effect.target === "allEnemies" ? livingEnemies(combat) : target ? [target] : [];
    for (const enemy of targets) {
      addPower(enemy.powers, effect.power, effect.amount);
      addLog(combat, `${enemy.name} 获得 ${effect.amount} 层${powerName(effect.power)}。`);
    }
    return;
  }

  if (effect.type === "amplifyPower") {
    if (effect.target === "self") {
      const gained = amplifyPowerStacks(combat.playerPowers, effect.power, effect.multiplier, effect.minimum);
      addLog(combat, gained > 0 ? `你的${powerName(effect.power)}被催化，增加 ${gained} 层。` : `没有${powerName(effect.power)}可催化。`);
      return;
    }

    const targets = effect.target === "allEnemies" ? livingEnemies(combat) : target ? [target] : [];
    for (const enemy of targets) {
      const gained = amplifyPowerStacks(enemy.powers, effect.power, effect.multiplier, effect.minimum);
      addLog(combat, gained > 0 ? `${enemy.name} 的${powerName(effect.power)}被催化，增加 ${gained} 层。` : `${enemy.name} 没有${powerName(effect.power)}可催化。`);
    }
    return;
  }

  if (effect.type === "draw") {
    drawCards(run, effect.amount);
    addLog(combat, `抽 ${effect.amount} 张牌。`);
    return;
  }

  if (effect.type === "gainEnergy") {
    combat.energy += effect.amount;
    addLog(combat, `获得 ${effect.amount} 点能量。`);
    return;
  }

  if (effect.type === "heal") {
    healPlayer(run, effect.amount);
    addLog(combat, `回复 ${effect.amount} 点生命。`);
    return;
  }

  if (effect.type === "cleanseDebuffs") {
    const removed = cleansePlayerDebuffs(combat);
    addLog(combat, removed > 0 ? `净化 ${removed} 种负面状态。` : "没有负面状态可净化。");
    return;
  }

  if (effect.type === "exhaustCards") {
    executeExhaustCardsEffect(run, effect, "card");
    return;
  }

  if (effect.type === "returnFromDiscard") {
    const recovered = recoverFromDiscard(combat, effect.amount, effect.cardType, effect.excludeStatus);
    addLog(
      combat,
      recovered.length > 0
        ? `从弃牌堆回收 ${recovered.map((card) => displayCardName(card)).join("、")}。`
        : "弃牌堆没有可回收的牌。",
    );
    return;
  }

  const created = makeCardInstance(effect.cardId, effect.upgraded);
  if (effect.destination === "hand") {
    addCardToHandOrDiscard(combat, created);
  }
  if (effect.destination === "draw") {
    combat.drawPile.unshift(created);
  }
  if (effect.destination === "discard") {
    combat.discardPile.push(created);
  }
  addLog(combat, `生成 ${displayCardName(created)}。`);
}

function executeEnemyEffect(run: RunState, enemy: EnemyState, effect: EnemyEffect): void {
  const combat = run.combat!;
  if (effect.type === "damage") {
    for (let hit = 0; hit < (effect.hits ?? 1); hit += 1) {
      if (enemy.hp <= 0) {
        return;
      }
      dealDamageToPlayer(run, enemy, effect.amount);
    }
    return;
  }

  if (effect.type === "block") {
    enemy.block += effect.amount;
    addLog(combat, `${enemy.name} 获得 ${effect.amount} 点格挡。`);
    return;
  }

  if (effect.type === "applyPower") {
    const powers = effect.target === "self" ? enemy.powers : combat.playerPowers;
    addPower(powers, effect.power, effect.amount);
    const targetName = effect.target === "self" ? enemy.name : "你";
    addLog(combat, `${targetName} 获得 ${effect.amount} 层${powerName(effect.power)}。`);
    return;
  }

  if (effect.type === "createCard") {
    const created = makeCardInstance(effect.cardId, effect.upgraded);
    if (effect.destination === "hand") {
      addCardToHandOrDiscard(combat, created);
    }
    if (effect.destination === "draw") {
      combat.drawPile.unshift(created);
    }
    if (effect.destination === "discard") {
      combat.discardPile.push(created);
    }
    addLog(combat, `${enemy.name} 将 ${displayCardName(created)} 加入${destinationName(effect.destination)}。`);
    return;
  }

  if (livingEnemies(combat).length >= 5) {
    addLog(combat, `${enemy.name} 的召唤失败了。`);
    return;
  }
  const summoned = createEnemy(run, effect.enemyId);
  combat.enemies.push(summoned);
  summoned.intent = chooseEnemyMove(run, summoned);
  addLog(combat, `${enemy.name} 召唤了 ${summoned.name}。`);
}

function executePotionEffect(run: RunState, effect: PotionEffect, target?: EnemyState): void {
  const combat = run.combat!;

  if (effect.type === "damage") {
    const targets = effect.target === "allEnemies" ? livingEnemies(combat) : target ? [target] : [];
    for (const enemy of targets) {
      dealDirectDamageToEnemy(run, enemy, effect.amount, "药水");
    }
    return;
  }

  if (effect.type === "block") {
    const block = calculatePlayerBlock(combat, effect.amount);
    combat.playerBlock += block;
    addLog(combat, `药水提供 ${block} 点格挡。`);
    return;
  }

  if (effect.type === "blockPerExhaustedCard") {
    const stacks = exhaustedCardStacks(combat, effect.cap, effect.minimum);
    const block = calculatePlayerBlock(combat, effect.amount * stacks);
    combat.playerBlock += block;
    addLog(combat, stacks > 0 ? `药水引燃消耗堆，提供 ${block} 点格挡。` : "药水没有找到可引燃的消耗堆。");
    return;
  }

  if (effect.type === "gainPowerPerPower") {
    const stacks = selfPowerStacks(combat, effect.sourcePower, effect.cap, effect.minimum);
    const amount = effect.amount * stacks;
    if (amount > 0) {
      addPower(combat.playerPowers, effect.gainedPower, amount);
      addLog(combat, `药水引发${powerName(effect.sourcePower)}共振，获得 ${amount} 层${powerName(effect.gainedPower)}。`);
    } else {
      addLog(combat, `药水没有找到可共振的${powerName(effect.sourcePower)}。`);
    }
    return;
  }

  if (effect.type === "gainPowerPerCardPlayed") {
    const stacks = cardPlayedStacks(combat, effect.cap, effect.minimum);
    const amount = effect.amount * stacks;
    if (amount > 0) {
      addPower(combat.playerPowers, effect.power, amount);
      addLog(combat, `药水延展连锁 ${stacks}：获得 ${amount} 层${powerName(effect.power)}。`);
    } else {
      addLog(combat, "药水没有找到可延展的连锁。");
    }
    return;
  }

  if (effect.type === "cleansePower") {
    executeCleansePowerEffect(run, effect, "potion");
    return;
  }

  if (effect.type === "applyPower") {
    if (effect.target === "self") {
      addPower(combat.playerPowers, effect.power, effect.amount);
      addLog(combat, `你获得 ${effect.amount} 层${powerName(effect.power)}。`);
      return;
    }

    const targets = effect.target === "allEnemies" ? livingEnemies(combat) : target ? [target] : [];
    for (const enemy of targets) {
      addPower(enemy.powers, effect.power, effect.amount);
      addLog(combat, `${enemy.name} 获得 ${effect.amount} 层${powerName(effect.power)}。`);
    }
    return;
  }

  if (effect.type === "amplifyPower") {
    if (effect.target === "self") {
      const gained = amplifyPowerStacks(combat.playerPowers, effect.power, effect.multiplier, effect.minimum);
      addLog(combat, gained > 0 ? `药水催化你的${powerName(effect.power)}，增加 ${gained} 层。` : `药水没有找到可催化的${powerName(effect.power)}。`);
      return;
    }

    const targets = effect.target === "allEnemies" ? livingEnemies(combat) : target ? [target] : [];
    for (const enemy of targets) {
      const gained = amplifyPowerStacks(enemy.powers, effect.power, effect.multiplier, effect.minimum);
      addLog(combat, gained > 0 ? `药水催化 ${enemy.name} 的${powerName(effect.power)}，增加 ${gained} 层。` : `药水没有找到 ${enemy.name} 的${powerName(effect.power)}。`);
    }
    return;
  }

  if (effect.type === "draw") {
    drawCards(run, effect.amount);
    addLog(combat, `药水抽 ${effect.amount} 张牌。`);
    return;
  }

  if (effect.type === "gainEnergy") {
    combat.energy += effect.amount;
    addLog(combat, `药水提供 ${effect.amount} 点能量。`);
    return;
  }

  if (effect.type === "heal") {
    healPlayer(run, effect.amount);
    addLog(combat, `药水回复 ${effect.amount} 点生命。`);
    return;
  }

  if (effect.type === "cleanseDebuffs") {
    const removed = cleansePlayerDebuffs(combat);
    addLog(combat, removed > 0 ? `药水净化 ${removed} 种负面状态。` : "药水没有找到负面状态。");
    return;
  }

  if (effect.type === "exhaustCards") {
    executeExhaustCardsEffect(run, effect, "potion");
    return;
  }

  if (effect.type === "returnFromDiscard") {
    const recovered = recoverFromDiscard(combat, effect.amount, effect.cardType, effect.excludeStatus);
    addLog(
      combat,
      recovered.length > 0
        ? `药水从弃牌堆回收 ${recovered.map((card) => displayCardName(card)).join("、")}。`
        : "药水没有找到可回收的牌。",
    );
  }
}

function executeExhaustCardsEffect(run: RunState, effect: ExhaustCardsEffect, source: "card" | "potion"): void {
  const combat = run.combat!;
  const zones =
    effect.zone === "handAndDiscard"
      ? [combat.hand, combat.discardPile]
      : effect.zone === "hand"
        ? [combat.hand]
        : [combat.discardPile];
  const exhausted: CardInstance[] = [];

  for (const zone of zones) {
    for (let i = zone.length - 1; i >= 0 && exhausted.length < effect.amount; i -= 1) {
      const candidate = zone[i];
      const def = CARDS[candidate.cardId];
      if (!def || (effect.cardType && def.type !== effect.cardType)) {
        continue;
      }
      exhausted.push(candidate);
      zone.splice(i, 1);
      combat.exhaustPile.push(candidate);
    }
  }

  if (exhausted.length === 0) {
    addLog(combat, source === "potion" ? "药水没有找到可消耗的牌。" : "没有可消耗的牌。");
    return;
  }

  addLog(combat, `${source === "potion" ? "药水" : ""}消耗 ${exhausted.length} 张牌。`);
  if (effect.gainBlockPerCard) {
    const block = calculatePlayerBlock(combat, effect.gainBlockPerCard * exhausted.length);
    combat.playerBlock += block;
    addLog(combat, `${source === "potion" ? "药水提供" : "获得"} ${block} 点格挡。`);
  }
  if (effect.drawPerCard) {
    const draw = effect.drawPerCard * exhausted.length;
    drawCards(run, draw);
    addLog(combat, `${source === "potion" ? "药水抽" : "抽"} ${draw} 张牌。`);
  }
  if (effect.gainEnergyPerCard) {
    const energy = effect.gainEnergyPerCard * exhausted.length;
    combat.energy += energy;
    addLog(combat, `${source === "potion" ? "药水提供" : "获得"} ${energy} 点能量。`);
  }
  if (effect.gainPowerPerCard) {
    const amount = effect.gainPowerPerCard.amount * exhausted.length;
    addPower(combat.playerPowers, effect.gainPowerPerCard.power, amount);
    addLog(combat, `获得 ${amount} 层${powerName(effect.gainPowerPerCard.power)}。`);
  }
  if (hasBoon(run, "ash_ledger")) {
    const block = calculatePlayerBlock(combat, exhausted.length);
    combat.playerBlock += block;
    addLog(combat, `余烬账本：消耗牌后获得 ${block} 点格挡。`);
  }
}

function exhaustedCardStacks(combat: CombatState, cap?: number, minimum = 0): number {
  const limit = Number.isFinite(cap) && cap !== undefined ? Math.max(0, Math.floor(cap)) : combat.exhaustPile.length;
  return Math.max(Math.max(0, Math.floor(minimum)), Math.min(combat.exhaustPile.length, limit));
}

function selfPowerStacks(combat: CombatState, power: PowerKey, cap?: number, minimum = 0): number {
  const available = Math.max(0, Math.floor(combat.playerPowers[power] ?? 0));
  const limit = Number.isFinite(cap) && cap !== undefined ? Math.max(0, Math.floor(cap)) : available;
  return Math.max(Math.max(0, Math.floor(minimum)), Math.min(available, limit));
}

function cardPlayedStacks(combat: CombatState, cap?: number, minimum = 0): number {
  const played = Math.max(0, Math.floor(combat.cardsPlayedThisTurn));
  const limit = Number.isFinite(cap) && cap !== undefined ? Math.max(0, Math.floor(cap)) : played;
  return Math.max(Math.max(0, Math.floor(minimum)), Math.min(played, limit));
}

function executeCleansePowerEffect(run: RunState, effect: Extract<CardEffect, { type: "cleansePower" }>, source: "card" | "potion"): void {
  const combat = run.combat!;
  const available = Math.max(0, Math.floor(combat.playerPowers[effect.power] ?? 0));
  const removed = Math.min(available, Math.max(0, Math.floor(effect.amount)));
  const sourceName = source === "potion" ? "药水" : "";

  if (removed <= 0) {
    addLog(combat, `${sourceName}没有可散热的${powerName(effect.power)}。`);
    return;
  }

  addPower(combat.playerPowers, effect.power, -removed);
  addLog(combat, `${sourceName}散热：移除 ${removed} 层${powerName(effect.power)}。`);

  if (effect.gainBlockPerStack) {
    const block = calculatePlayerBlock(combat, effect.gainBlockPerStack * removed);
    combat.playerBlock += block;
    addLog(combat, `${sourceName}散热提供 ${block} 点格挡。`);
  }
  if (effect.gainPowerPerStack) {
    const amount = effect.gainPowerPerStack.amount * removed;
    addPower(combat.playerPowers, effect.gainPowerPerStack.power, amount);
    addLog(combat, `${sourceName}散热获得 ${amount} 层${powerName(effect.gainPowerPerStack.power)}。`);
  }
  if (effect.gainEnergyPerStack) {
    const energy = effect.gainEnergyPerStack * removed;
    combat.energy += energy;
    addLog(combat, `${sourceName}散热提供 ${energy} 点能量。`);
  }
}

function finishCombat(run: RunState): RunState {
  const combat = run.combat;
  if (!combat) {
    return run;
  }

  if (hasRelic(run, "blood_vial")) {
    healPlayer(run, 2);
    addLog(combat, "血瓶触发：战斗结束回复 2 点生命。");
  }

  const nodeType = combat.nodeType;
  if (nodeType === "fight") {
    run.stats.fights += 1;
  }
  if (nodeType === "elite") {
    run.stats.elites += 1;
  }
  if (nodeType === "boss") {
    run.stats.bosses += 1;
  }

  const rawGold = nodeType === "boss" ? randomInt(run, 70, 95) : nodeType === "elite" ? randomInt(run, 38, 58) : randomInt(run, 16, 31);
  const gold = scaleGold(run, rawGold);
  run.player.gold += gold;
  run.stats.goldEarned += gold;

  const relicChance = nodeType === "boss" || nodeType === "elite" ? 1 : randomFloat(run) < 0.28 ? 1 : 0;
  const relicId = nodeType === "boss" && !hasRelic(run, "star_orb") ? "star_orb" : relicChance ? randomRelic(run) : undefined;
  if (relicId) {
    grantRelic(run, relicId);
  }
  const potionChance = nodeType === "boss" ? 0.64 : nodeType === "elite" ? 0.52 : 0.34;
  const potionId = randomFloat(run) < potionChance ? randomPotion(run) : undefined;
  const boonChance = nodeType === "boss" || randomFloat(run) < (nodeType === "elite" ? 0.5 : 0.06) ? 1 : 0;
  const boons = boonChance ? createBoonRewards(run, nodeType) : [];

  const reward: RewardState = {
    nodeType,
    title: nodeType === "boss" ? "Boss奖励" : nodeType === "elite" ? "精英奖励" : "战斗奖励",
    gold,
    cards: createCardRewards(run, nodeType),
    relicId,
    potionId,
    boons,
    rerollPrice: scaleShopPrice(run, 24),
  };

  completeCurrentNode(run);
  run.reward = reward;
  run.combat = undefined;
  run.phase = "reward";
  run.message = undefined;
  return run;
}

function finishReward(run: RunState): RunState {
  const reward = run.reward;
  run.reward = undefined;
  if (reward?.nodeType === "boss") {
    if (currentAct(run) < FINAL_ACT) {
      return advanceToNextAct(run);
    }
    run.phase = "victory";
    run.message = "裂隙心核崩解，你完成了这次尖塔攀登。";
    return run;
  }
  run.phase = "map";
  return run;
}

function advanceToNextAct(run: RunState): RunState {
  const nextAct = currentAct(run) + 1;
  const healAmount = Math.ceil(run.player.maxHp * 0.28);
  const hpBefore = run.player.hp;

  run.act = nextAct;
  run.floor = 0;
  run.currentNodeId = undefined;
  run.map = generateMap(mapSeedForAct(run.seed, nextAct));
  run.combat = undefined;
  run.shop = undefined;
  run.event = undefined;
  healPlayer(run, healAmount);
  run.phase = "map";

  const healed = run.player.hp - hpBefore;
  const healText = healed > 0 ? `回复 ${healed} 点生命` : "生命已满";
  run.message = `第 ${nextAct} 幕开启：${healText}，敌人获得新的强度修正。`;
  return run;
}

function isRewardComplete(reward: RewardState): boolean {
  return Boolean(
    reward.cardResolved &&
      !reward.potionId &&
      (reward.boonResolved || !reward.boons || reward.boons.length === 0),
  );
}

function defeat(run: RunState, message: string): RunState {
  run.phase = "defeat";
  run.message = message;
  return run;
}

function completeCurrentNode(run: RunState): void {
  const node = run.map.find((item) => item.id === run.currentNodeId);
  if (!node || node.completed) {
    return;
  }

  node.completed = true;
  run.floor = Math.max(run.floor, node.floor + 1);
  run.stats.nodesCleared += 1;
}

function createCardRewards(run: RunState, nodeType: NodeType): CardOffer[] {
  const offers: CardOffer[] = [];
  const used = new Set<string>();

  while (offers.length < 3 && used.size < REWARD_CARD_IDS.length) {
    const cardId = rollRewardCard(run, nodeType);
    if (used.has(cardId)) {
      continue;
    }
    used.add(cardId);
    const upgradeChance = clamp01((nodeType === "boss" ? 0.46 : nodeType === "elite" ? 0.24 : 0.12) + difficultyConfig(run).rewardUpgradeBonus);
    offers.push({
      cardId,
      upgraded: randomFloat(run) < upgradeChance,
    });
  }

  return offers;
}

function createBoonRewards(run: RunState, nodeType: NodeType): BoonOffer[] {
  const offers: BoonOffer[] = [];
  const used = new Set<BoonId>();
  const offerCount = 2;

  while (offers.length < offerCount && run.player.boons.length + used.size < BOON_POOL.length) {
    const boonId = randomBoon(run, used);
    if (!boonId) {
      break;
    }
    used.add(boonId);
    offers.push({ boonId });
  }

  return offers;
}

function createShop(run: RunState): ShopState {
  const cards: CardOffer[] = [];
  const usedCards = new Set<string>();

  while (cards.length < 5 && usedCards.size < REWARD_CARD_IDS.length) {
    const cardId = rollRewardCard(run, "fight");
    if (usedCards.has(cardId)) {
      continue;
    }
    usedCards.add(cardId);
    const rarity = CARDS[cardId].rarity;
    const basePrice = rarity === "rare" ? 112 : rarity === "uncommon" ? 78 : 52;
    cards.push({
      cardId,
      upgraded: randomFloat(run) < 0.15,
      price: scaleShopPrice(run, basePrice + randomInt(run, -8, 14)),
    });
  }

  const relics: RelicOffer[] = [];
  const usedRelics = new Set<string>();
  while (relics.length < 2) {
    const relicId = randomRelic(run, usedRelics);
    if (!relicId) {
      break;
    }
    usedRelics.add(relicId);
    const rarity = RELICS[relicId].rarity;
    relics.push({
      relicId,
      price: scaleShopPrice(run, rarity === "rare" ? 185 : rarity === "uncommon" ? 150 : 125),
    });
  }

  const potions: PotionOffer[] = [];
  const usedPotions = new Set<string>();
  while (potions.length < 3 && usedPotions.size < POTION_POOL.length) {
    const potionId = randomPotion(run, usedPotions);
    if (!potionId) {
      break;
    }
    usedPotions.add(potionId);
    const rarity = POTIONS[potionId].rarity;
    const basePrice = rarity === "rare" ? 78 : rarity === "uncommon" ? 64 : 48;
    potions.push({
      potionId,
      price: scaleShopPrice(run, basePrice + randomInt(run, -6, 8)),
    });
  }

  const boons: BoonOffer[] = [];
  const usedBoons = new Set<BoonId>();
  while (boons.length < 1 && run.player.boons.length + usedBoons.size < BOON_POOL.length) {
    const boonId = randomBoon(run, usedBoons);
    if (!boonId) {
      break;
    }
    usedBoons.add(boonId);
    const rarity = BOONS[boonId].rarity;
    const basePrice = rarity === "rare" ? 260 : rarity === "uncommon" ? 210 : 175;
    boons.push({
      boonId,
      price: scaleShopPrice(run, basePrice + randomInt(run, -8, 12)),
    });
  }

  return {
    cards,
    relics,
    potions,
    boons,
    healPrice: scaleShopPrice(run, 45),
    removePrice: scaleShopPrice(run, 75),
    restockPrice: scaleShopPrice(run, 55),
  };
}

function createEvent(run: RunState): EventState {
  const id = EVENT_IDS[randomInt(run, 0, EVENT_IDS.length - 1)];
  return buildEvent(run, id);
}

function createEventById(run: RunState, eventId: string): EventState | undefined {
  if (!isEventId(eventId)) {
    return undefined;
  }
  return buildEvent(run, eventId);
}

function buildEvent(run: RunState, id: EventId): EventState {
  const cacheGold = scaleGold(run, 65);

  if (id === "blood_shrine") {
    return {
      id,
      title: "血色泉眼",
      text: "一口旧泉在石缝中低鸣。水面映出的不是你的脸，而是一件陌生遗物的轮廓。",
      options: [
        {
          id: "offer",
          label: "献祭",
          text: "失去 8 点生命，获得 1 件随机遗物。",
          disabled: run.player.hp <= 8 || !hasRelicPoolSpace(run),
          disabledReason: run.player.hp <= 8 ? "生命不足" : "遗物已满",
        },
        {
          id: "sip",
          label: "浅尝",
          text: "回复 12 点生命。",
        },
        {
          id: "leave",
          label: "离开",
          text: "不发生任何事。",
        },
      ],
    };
  }

  if (id === "forgotten_armory") {
    return {
      id,
      title: "遗忘军械库",
      text: "半埋在灰烬里的兵器仍有余温。这里的东西不新，但都还能咬人。",
      options: [
        {
          id: "weapon",
          label: "拿走武器",
          text: "获得 1 张随机升级攻击牌。",
        },
        {
          id: "armor",
          label: "修补护甲",
          text: "最大生命 +5，回复 5 点生命。",
        },
        {
          id: "leave",
          label: "离开",
          text: "不发生任何事。",
        },
      ],
    };
  }

  if (id === "merchant_cache") {
    return {
      id,
      title: "商人的暗格",
      text: "一只无人看管的铁匣藏在旧柜台后方，锁扣已经松动，旁边还有一张未完成的强化委托。",
      options: [
        {
          id: "take_gold",
          label: "拿走金币",
          text: `获得 ${cacheGold} 金币。`,
        },
        {
          id: "invest",
          label: "完成委托",
          text: "支付 40 金币，随机升级 2 张牌。",
          disabled: run.player.gold < 40 || run.player.deck.every((card) => card.upgraded),
          disabledReason: run.player.gold < 40 ? "金币不足" : "没有可升级牌",
        },
        {
          id: "leave",
          label: "离开",
          text: "不发生任何事。",
        },
      ],
    };
  }

  if (id === "alchemist_table") {
    const potionSpace = run.player.potions.length < run.player.potionSlots;
    return {
      id,
      title: "裂瓶炼金桌",
      text: "瓶底残留着不同颜色的沉淀。桌边的铜管还在发热，只要给一点代价，它就会继续工作。",
      options: [
        {
          id: "brew",
          label: "调制",
          text: "获得 1 瓶随机药水。",
          disabled: !potionSpace,
          disabledReason: "药水槽已满",
        },
        {
          id: "distill",
          label: "血蒸馏",
          text: "失去 5 点生命，获得最多 2 瓶随机药水。",
          disabled: run.player.hp <= 5 || !potionSpace,
          disabledReason: run.player.hp <= 5 ? "生命不足" : "药水槽已满",
        },
        {
          id: "rack",
          label: "买瓶架",
          text: "支付 55 金币，药水槽永久 +1。",
          disabled: run.player.gold < 55 || run.player.potionSlots >= 5,
          disabledReason: run.player.gold < 55 ? "金币不足" : "药水槽已达上限",
        },
        {
          id: "leave",
          label: "离开",
          text: "不发生任何事。",
        },
      ],
    };
  }

  if (id === "static_obelisk") {
    return {
      id,
      title: "静电方碑",
      text: "一块黑色方碑悬在半空，表面像坏掉的星图一样跳闪。靠近时，你的牌边缘开始发光。",
      options: [
        {
          id: "attune",
          label: "调谐",
          text: "失去 6 点生命，获得常驻提升：静电调谐。",
          disabled: run.player.hp <= 6 || run.player.boons.includes("static_attunement"),
          disabledReason: run.player.hp <= 6 ? "生命不足" : "已拥有",
        },
        {
          id: "blade",
          label: "拔出残刃",
          text: "失去 7 点生命，获得弧光刃+，并将 1 张晕眩加入牌组。",
          disabled: run.player.hp <= 7,
          disabledReason: "生命不足",
        },
        {
          id: "bottle",
          label: "收集余电",
          text: "获得 1 瓶蓄能药水。",
          disabled: run.player.potions.length >= run.player.potionSlots,
          disabledReason: "药水槽已满",
        },
        {
          id: "leave",
          label: "离开",
          text: "不发生任何事。",
        },
      ],
    };
  }

  if (id === "living_mirror") {
    const hasNonStarter = run.player.deck.some((card) => CARDS[card.cardId].rarity !== "starter");
    const hasBasic = run.player.deck.some((card) => card.cardId === "strike" || card.cardId === "defend");
    return {
      id,
      title: "活镜回廊",
      text: "镜子里的你比现实慢半拍。它伸手触碰一张牌，玻璃内侧立刻长出一张相同的影子。",
      options: [
        {
          id: "copy",
          label: "复制影牌",
          text: "失去 6 点生命，复制 1 张随机非初始牌。",
          disabled: run.player.hp <= 6 || !hasNonStarter,
          disabledReason: run.player.hp <= 6 ? "生命不足" : "没有非初始牌",
        },
        {
          id: "transmute",
          label: "重塑倒影",
          text: "随机变换 1 张非状态牌。",
          disabled: !run.player.deck.some((card) => CARDS[card.cardId].rarity !== "status"),
          disabledReason: "没有可重塑牌",
        },
        {
          id: "shatter",
          label: "击碎倒影",
          text: "失去 4 点生命，移除 1 张随机打击或防御。",
          disabled: run.player.hp <= 4 || !hasBasic,
          disabledReason: run.player.hp <= 4 ? "生命不足" : "没有基础牌",
        },
        {
          id: "leave",
          label: "离开",
          text: "不发生任何事。",
        },
      ],
    };
  }

  if (id === "storm_chest") {
    return {
      id,
      title: "风暴匣",
      text: "一只青铜匣被电弧缝在地上。每次开合，匣内都传出纸牌翻动和玻璃瓶碰撞的声音。",
      options: [
        {
          id: "socket",
          label: "嵌入电容",
          text: "获得电容器+。若有空槽，获得 1 瓶蓄能药水。",
        },
        {
          id: "overload",
          label: "过载核心",
          text: "失去 6 点生命，获得放电+，并将 1 张晕眩加入牌组。",
          disabled: run.player.hp <= 6,
          disabledReason: "生命不足",
        },
        {
          id: "sell_core",
          label: "拆卖线圈",
          text: `获得 ${scaleGold(run, 45)} 金币，并将 1 张伤口加入牌组。`,
        },
        {
          id: "leave",
          label: "离开",
          text: "不发生任何事。",
        },
      ],
    };
  }

  if (id === "boon_carver") {
    const hasBoonSpace = run.player.boons.length < BOON_POOL.length;
    const hasCarvableCard = run.player.deck.some(
      (card) => CARDS[card.cardId].rarity === "status" || card.cardId === "strike" || card.cardId === "defend",
    );
    return {
      id,
      title: "刻纹师",
      text: "披着灰布的人坐在断桥边，手中刻刀没有影子。他说真正的提升应当留在骨头上，而不是牌面上。",
      options: [
        {
          id: "commission",
          label: "支付刻纹",
          text: "支付 50 金币，获得 1 个随机常驻提升。",
          disabled: run.player.gold < 50 || !hasBoonSpace,
          disabledReason: run.player.gold < 50 ? "金币不足" : "常驻提升已满",
        },
        {
          id: "blood_mark",
          label: "血刻",
          text: "失去 8 点生命，获得 1 个随机常驻提升。",
          disabled: run.player.hp <= 8 || !hasBoonSpace,
          disabledReason: run.player.hp <= 8 ? "生命不足" : "常驻提升已满",
        },
        {
          id: "chip",
          label: "刮除旧纹",
          text: "失去 3 点生命，随机移除 1 张状态、打击或防御。",
          disabled: run.player.hp <= 3 || run.player.deck.length <= 1 || !hasCarvableCard,
          disabledReason: run.player.hp <= 3 ? "生命不足" : "没有可刮除牌",
        },
        {
          id: "leave",
          label: "离开",
          text: "不发生任何事。",
        },
      ],
    };
  }

  if (id === "cursed_archive") {
    return {
      id,
      title: "封蜡档案室",
      text: "书脊上没有名字，只有一排排封蜡。每撕开一枚印记，房间就更冷一点。",
      options: [
        {
          id: "read",
          label: "读禁页",
          text: "获得 1 张随机稀有牌，并将 1 张灼烧加入牌组。",
        },
        {
          id: "erase",
          label: "抹去旧字",
          text: "失去 6 点生命，随机移除 1 张牌。",
          disabled: run.player.hp <= 6 || run.player.deck.length <= 1,
          disabledReason: run.player.hp <= 6 ? "生命不足" : "牌组过少",
        },
        {
          id: "seal",
          label: "封印低语",
          text: "获得 1 个随机常驻提升，并将 1 张伤口加入牌组。",
          disabled: run.player.boons.length >= BOON_POOL.length,
          disabledReason: "常驻提升已满",
        },
        {
          id: "leave",
          label: "离开",
          text: "不发生任何事。",
        },
      ],
    };
  }

  if (id === "wandering_trainer") {
    return {
      id,
      title: "流浪教官",
      text: "披着旧披风的教官把木剑插进地面。她不问你来自哪里，只问你还剩多少力气。",
      options: [
        {
          id: "lesson",
          label: "付费训练",
          text: "支付 35 金币，随机升级 1 张牌。",
          disabled: run.player.gold < 35 || run.player.deck.every((card) => card.upgraded),
          disabledReason: run.player.gold < 35 ? "金币不足" : "没有可升级牌",
        },
        {
          id: "spar",
          label: "实战切磋",
          text: "失去 7 点生命，获得 1 张随机升级攻击或技能牌。",
          disabled: run.player.hp <= 7,
          disabledReason: "生命不足",
        },
        {
          id: "breathe",
          label: "调整呼吸",
          text: "回复 8 点生命。",
        },
        {
          id: "leave",
          label: "离开",
          text: "不发生任何事。",
        },
      ],
    };
  }

  if (id === "quiet_clinic") {
    const hasStatus = run.player.deck.some((card) => CARDS[card.cardId].rarity === "status");
    const potionSpace = run.player.potions.length < run.player.potionSlots;
    return {
      id,
      title: "静默诊所",
      text: "白布后的器械自己排列成行。这里没有医生，只有一张写着价码的空病历。",
      options: [
        {
          id: "cleanse",
          label: "清创",
          text: "支付 30 金币，随机移除 1 张状态牌。",
          disabled: run.player.gold < 30 || !hasStatus,
          disabledReason: run.player.gold < 30 ? "金币不足" : "没有状态牌",
        },
        {
          id: "serum",
          label: "取血清",
          text: "获得 1 瓶随机药水，并回复 4 点生命。",
          disabled: !potionSpace,
          disabledReason: "药水槽已满",
        },
        {
          id: "stitch",
          label: "缝合",
          text: "回复 16 点生命。",
        },
        {
          id: "leave",
          label: "离开",
          text: "不发生任何事。",
        },
      ],
    };
  }

  if (id === "memory_well") {
    const hasPotionSpace = run.player.potions.length < run.player.potionSlots;
    return {
      id,
      title: "记忆井",
      text: "井水倒映着刚刚打出的牌。水面下漂着旧战斗的残片，伸手进去会带出一点力量，也会带出一点噪声。",
      options: [
        {
          id: "dredge",
          label: "记忆打捞",
          text: "支付 35 金币，获得战场回收+。若牌组有状态牌，随机移除 1 张。",
          disabled: run.player.gold < 35,
          disabledReason: "金币不足",
        },
        {
          id: "echo",
          label: "取走回声",
          text: "失去 5 点生命，获得记忆钩索+。",
          disabled: run.player.hp <= 5,
          disabledReason: "生命不足",
        },
        {
          id: "siphon",
          label: "虹吸井水",
          text: "获得 1 瓶随机药水，并回复 3 点生命。",
          disabled: !hasPotionSpace,
          disabledReason: "药水槽已满",
        },
        {
          id: "leave",
          label: "离开",
          text: "不发生任何事。",
        },
      ],
    };
  }

  if (id === "rune_forge") {
    const hasUpgradeable = run.player.deck.some((card) => !card.upgraded);
    const hasTransformable = run.player.deck.some((card) => CARDS[card.cardId].rarity !== "status");
    return {
      id,
      title: "符文熔炉",
      text: "炉膛里没有火，只有一圈圈亮起的符文。铁砧要求你付出一种资源，再把另一种资源敲进牌里。",
      options: [
        {
          id: "etch",
          label: "符文刻蚀",
          text: "支付 45 金币，随机升级 2 张牌。",
          disabled: run.player.gold < 45 || !hasUpgradeable,
          disabledReason: run.player.gold < 45 ? "金币不足" : "没有可升级牌",
        },
        {
          id: "reforge",
          label: "高温重铸",
          text: "失去 6 点生命，随机变换 1 张非状态牌并升级它。",
          disabled: run.player.hp <= 6 || !hasTransformable,
          disabledReason: run.player.hp <= 6 ? "生命不足" : "没有可重铸牌",
        },
        {
          id: "quench",
          label: "冷却护具",
          text: "获得镀层防守+，并将 1 张灼烧加入牌组。",
        },
        {
          id: "leave",
          label: "离开",
          text: "不发生任何事。",
        },
      ],
    };
  }

  if (id === "venom_greenhouse") {
    const hasPotionSpace = run.player.potions.length < run.player.potionSlots;
    return {
      id,
      title: "毒剂温室",
      text: "玻璃棚里爬满绿色细管，毒液沿着管壁一滴滴回流。这里适合给刀刃找一条更长的尾巴。",
      options: [
        {
          id: "coat_blade",
          label: "涂刃仪式",
          text: "支付 30 金币，获得常驻提升：刃油预涂。",
          disabled: run.player.gold < 30 || run.player.boons.includes("blade_oil"),
          disabledReason: run.player.gold < 30 ? "金币不足" : "已拥有",
        },
        {
          id: "distill_venom",
          label: "萃取毒囊",
          text: "获得毒刃架势+，并将 1 张晕眩加入牌组。",
        },
        {
          id: "take_sample",
          label: "采走样本",
          text: "获得毒药水和淬毒飞镖。",
          disabled: !hasPotionSpace,
          disabledReason: "药水槽已满",
        },
        {
          id: "leave",
          label: "离开",
          text: "不发生任何事。",
        },
      ],
    };
  }

  if (id === "plated_sanctum") {
    return {
      id,
      title: "镀层圣坛",
      text: "石台上摆着一排薄甲片，每片都刻着旧伤的形状。它们不够华丽，但会在下一次冲击前先醒来。",
      options: [
        {
          id: "train_plate",
          label: "镀层演练",
          text: "支付 45 金币，获得常驻提升：镀层训练。",
          disabled: run.player.gold < 45 || run.player.boons.includes("plate_training"),
          disabledReason: run.player.gold < 45 ? "金币不足" : "已拥有",
        },
        {
          id: "forge_guard",
          label: "铸造护势",
          text: "失去 4 点生命，获得镀层防守+。",
          disabled: run.player.hp <= 4,
          disabledReason: "生命不足",
        },
        {
          id: "patch_armor",
          label: "修补甲片",
          text: "回复 10 点生命。",
        },
        {
          id: "leave",
          label: "离开",
          text: "不发生任何事。",
        },
      ],
    };
  }

  if (id === "bottled_spirit") {
    const hasPotion = run.player.potions.length > 0;
    const hasBoonSpace = run.player.boons.length < BOON_POOL.length;
    return {
      id,
      title: "瓶中精魂",
      text: "一排瓶子悬在空中，瓶塞下面有微小的人影敲击玻璃。它们愿意交换，但只接受药水作为语言。",
      options: [
        {
          id: "release",
          label: "释放精魂",
          text: "消耗 1 瓶随机药水，获得 1 个随机常驻提升。",
          disabled: !hasPotion || !hasBoonSpace,
          disabledReason: !hasPotion ? "没有药水" : "常驻提升已满",
        },
        {
          id: "decant",
          label: "倒卖精粹",
          text: `消耗 1 瓶随机药水，获得 ${scaleGold(run, 42)} 金币。`,
          disabled: !hasPotion,
          disabledReason: "没有药水",
        },
        {
          id: "stabilize",
          label: "稳定瓶架",
          text: "支付 35 金币，药水槽永久 +1。",
          disabled: run.player.gold < 35 || run.player.potionSlots >= 5,
          disabledReason: run.player.gold < 35 ? "金币不足" : "药水槽已达上限",
        },
        {
          id: "leave",
          label: "离开",
          text: "不发生任何事。",
        },
      ],
    };
  }

  if (id === "path_scout") {
    const canChartRest = canConvertNextRouteNode(run, "rest");
    const canMarkElite = canConvertNextRouteNode(run, "elite");
    return {
      id,
      title: "岔路侦察",
      text: "一名哨探把下一层的路径画在盾牌背面。她不能改变尖塔的方向，但可以替你改写一个岔口的性质。",
      options: [
        {
          id: "chart_rest",
          label: "绘制安全路线",
          text: "支付 30 金币，将一个下一层节点改为休息点。",
          disabled: run.player.gold < 30 || !canChartRest,
          disabledReason: run.player.gold < 30 ? "金币不足" : "没有可改写路线",
        },
        {
          id: "mark_elite",
          label: "标记高危猎物",
          text: "失去 5 点生命，将一个下一层节点改为精英。",
          disabled: run.player.hp <= 5 || !canMarkElite,
          disabledReason: run.player.hp <= 5 ? "生命不足" : "没有可标记路线",
        },
        {
          id: "take_rations",
          label: "拿走补给",
          text: `回复 8 点生命，获得 ${scaleGold(run, 18)} 金币。`,
        },
        {
          id: "leave",
          label: "离开",
          text: "不发生任何事。",
        },
      ],
    };
  }

  if (id === "flask_gambit") {
    const hasPotion = run.player.potions.length > 0;
    const emptySlots = Math.max(0, run.player.potionSlots - run.player.potions.length);
    const hasBoonSpace = run.player.boons.length < BOON_POOL.length;
    return {
      id,
      title: "瓶匣赌局",
      text: "三只透明瓶匣在桌面上转动。每一只都能把药水变成别的东西，但没有一只会把代价写在正面。",
      options: [
        {
          id: "transfuse",
          label: "药剂转注",
          text: "消耗 1 瓶随机药水，获得 1 个随机常驻提升。",
          disabled: !hasPotion || !hasBoonSpace,
          disabledReason: !hasPotion ? "没有药水" : "常驻提升已满",
        },
        {
          id: "overbrew",
          label: "过量调配",
          text: "支付 28 金币，补满空药水槽。",
          disabled: run.player.gold < 28 || emptySlots <= 0,
          disabledReason: run.player.gold < 28 ? "金币不足" : "药水槽已满",
        },
        {
          id: "crack_case",
          label: "敲开瓶匣",
          text: "药水槽永久 +1，并将 1 张黏液加入牌组。",
          disabled: run.player.potionSlots >= 5,
          disabledReason: "药水槽已达上限",
        },
        {
          id: "leave",
          label: "离开",
          text: "不发生任何事。",
        },
      ],
    };
  }

  if (id === "relic_tinker") {
    const hasUpgradeable = run.player.deck.some((card) => !card.upgraded);
    const hasRelicSpace = hasRelicPoolSpace(run);
    const hasPawnableRelic = run.player.relics.some(
      (relicId) => RELICS[relicId]?.rarity !== "starter" && RELICS[relicId]?.rarity !== "boss",
    );
    return {
      id,
      title: "遗物修理工",
      text: "修理工把遗物拆成齿轮、骨片和一句句旧祷词。她说好遗物不怕重装，只怕你舍不得付账。",
      options: [
        {
          id: "tune",
          label: "校准遗物",
          text: "支付 55 金币，获得 1 件随机遗物，并随机升级 1 张牌。",
          disabled: run.player.gold < 55 || !hasRelicSpace,
          disabledReason: run.player.gold < 55 ? "金币不足" : "遗物已满",
        },
        {
          id: "pawn",
          label: "典当遗物",
          text: `失去 1 件随机非初始遗物，获得 ${scaleGold(run, 85)} 金币，并随机升级 2 张牌。`,
          disabled: !hasPawnableRelic || !hasUpgradeable,
          disabledReason: !hasPawnableRelic ? "没有可典当遗物" : "没有可升级牌",
        },
        {
          id: "polish",
          label: "精修护具",
          text: "随机升级 1 张牌，并回复 6 点生命。",
          disabled: !hasUpgradeable,
          disabledReason: "没有可升级牌",
        },
        {
          id: "leave",
          label: "离开",
          text: "不发生任何事。",
        },
      ],
    };
  }

  if (id === "fracture_gate") {
    return {
      id,
      title: "裂纹门扉",
      text: "门后不是房间，而是一条尚未发生的伤口。裂纹沿着地面爬向你的牌组，像在寻找第一张愿意被打开的牌。",
      options: [
        {
          id: "step_through",
          label: "穿过门扉",
          text: "失去 9 点生命，获得裂隙突刺+。若有空槽，获得 1 瓶裂纹药水。",
          disabled: run.player.hp <= 9,
          disabledReason: "生命不足",
        },
        {
          id: "map_cracks",
          label: "描摹裂纹",
          text: "支付 35 金币，获得常驻提升：破绽图谱。",
          disabled: run.player.gold < 35 || run.player.boons.includes("weakpoint_chart"),
          disabledReason: run.player.gold < 35 ? "金币不足" : "已拥有",
        },
        {
          id: "seal_gate",
          label: "封住门扉",
          text: "回复 10 点生命，并将 1 张晕眩加入牌组。",
          disabled: run.player.hp >= run.player.maxHp,
          disabledReason: "生命已满",
        },
        {
          id: "leave",
          label: "离开",
          text: "不发生任何事。",
        },
      ],
    };
  }

  if (id === "catalyst_lab") {
    return {
      id,
      title: "催化实验台",
      text: "玻璃皿里的毒、血和裂纹互相追逐。台面上的公式没有结尾，只留下一个越写越深的乘号。",
      options: [
        {
          id: "learn_pattern",
          label: "记录催化谱",
          text: "支付 40 金币，获得常驻提升：催化训练。",
          disabled: run.player.gold < 40 || run.player.boons.includes("catalyst_training"),
          disabledReason: run.player.gold < 40 ? "金币不足" : "已拥有",
        },
        {
          id: "take_vial",
          label: "拿走试剂",
          text: "获得 1 瓶催化药水。",
          disabled: run.player.potions.length >= run.player.potionSlots,
          disabledReason: "药水槽已满",
        },
        {
          id: "record_formula",
          label: "抄录配方",
          text: "失去 6 点生命，获得血毒催化+，并将 1 张灼烧加入牌组。",
          disabled: run.player.hp <= 6,
          disabledReason: "生命不足",
        },
        {
          id: "leave",
          label: "离开",
          text: "不发生任何事。",
        },
      ],
    };
  }

  if (id === "coil_workbench") {
    return {
      id,
      title: "线圈工作台",
      text: "一张工作台被铜线、甲片和小型电容塞满。不同抽屉里放着完全不同的答案：牌、药水，或能留到下一场战斗的刻纹。",
      options: [
        {
          id: "plate_cache",
          label: "拿防护匣",
          text: "支付 35 金币，获得合金壳+。若有空槽，获得 1 瓶合金药水。",
          disabled: run.player.gold < 35,
          disabledReason: "金币不足",
        },
        {
          id: "wind_coil",
          label: "缠绕过载线圈",
          text: "失去 5 点生命，获得线圈鞭击+。若有空槽，获得 1 瓶过载药水。",
          disabled: run.player.hp <= 5,
          disabledReason: "生命不足",
        },
        {
          id: "temper_shell",
          label: "淬火外壳",
          text: "支付 45 金币，获得常驻提升：淬火外壳。",
          disabled: run.player.gold < 45 || run.player.boons.includes("tempered_shell"),
          disabledReason: run.player.gold < 45 ? "金币不足" : "已拥有",
        },
        {
          id: "leave",
          label: "离开",
          text: "不发生任何事。",
        },
      ],
    };
  }

  if (id === "black_contract") {
    const hasRelicSpace = hasRelicPoolSpace(run);
    return {
      id,
      title: "黑市契约",
      text: "一个没有脸的掮客把三份契约摊在箱盖上。墨水像活物一样缩成小字：钱可以买遗物，血可以买牌，麻烦可以买一整袋补给。",
      options: [
        {
          id: "underwrite",
          label: "担保遗物",
          text: "支付 55 金币，获得 1 件随机遗物。",
          disabled: run.player.gold < 55 || !hasRelicSpace,
          disabledReason: run.player.gold < 55 ? "金币不足" : "遗物已满",
        },
        {
          id: "blood_clause",
          label: "签血契",
          text: "最大生命 -6，获得 1 张随机稀有牌，并随机升级 1 张牌。",
          disabled: run.player.maxHp <= 50,
          disabledReason: "最大生命过低",
        },
        {
          id: "contraband",
          label: "拿违禁补给",
          text: "获得合金壳和最多 2 瓶随机药水，并将 1 张伤口加入牌组。",
        },
        {
          id: "leave",
          label: "离开",
          text: "不发生任何事。",
        },
      ],
    };
  }

  if (id === "strategy_table") {
    const hasPotionSpace = run.player.potions.length < run.player.potionSlots;
    return {
      id,
      title: "战术沙盘",
      text: "沙盘上摆着三枚不同颜色的旗子：一枚写着牌组调度，一枚装着速效药剂，一枚刻着能带进下一场战斗的协议。",
      options: [
        {
          id: "manual",
          label: "收起预案",
          text: "支付 32 金币，获得战地预案+。",
          disabled: run.player.gold < 32,
          disabledReason: "金币不足",
        },
        {
          id: "kit",
          label: "拿战术药剂",
          text: "支付 24 金币，获得 1 瓶战术药水。",
          disabled: run.player.gold < 24 || !hasPotionSpace,
          disabledReason: run.player.gold < 24 ? "金币不足" : "药水槽已满",
        },
        {
          id: "protocol",
          label: "签下协议",
          text: "支付 48 金币，获得常驻提升：战地协议。",
          disabled: run.player.gold < 48 || run.player.boons.includes("field_protocol"),
          disabledReason: run.player.gold < 48 ? "金币不足" : "已拥有",
        },
        {
          id: "leave",
          label: "离开",
          text: "不发生任何事。",
        },
      ],
    };
  }

  if (id === "old_warbanner") {
    const hasPotionSpace = run.player.potions.length < run.player.potionSlots;
    return {
      id,
      title: "旧战旗",
      text: "一面破旧战旗插在石阶上，旗面仍会随着不存在的号角起伏。它留下三种东西：牌面上的战斗节拍、瓶中的战术兴奋剂，以及刻进骨头里的操典。",
      options: [
        {
          id: "take_banner",
          label: "取下旗帜",
          text: "支付 34 金币，获得战斗节拍+。",
          disabled: run.player.gold < 34,
          disabledReason: "金币不足",
        },
        {
          id: "rally_dose",
          label: "喝下军剂",
          text: "支付 24 金币，获得 1 瓶战术药水。",
          disabled: run.player.gold < 24 || !hasPotionSpace,
          disabledReason: run.player.gold < 24 ? "金币不足" : "药水槽已满",
        },
        {
          id: "learn_drill",
          label: "默记操典",
          text: "支付 48 金币，获得常驻提升：战旗操典。",
          disabled: run.player.gold < 48 || run.player.boons.includes("banner_drill"),
          disabledReason: run.player.gold < 48 ? "金币不足" : "已拥有",
        },
        {
          id: "leave",
          label: "离开",
          text: "不发生任何事。",
        },
      ],
    };
  }

  if (id === "field_infirmary") {
    const hasPotionSpace = run.player.potions.length < run.player.potionSlots;
    return {
      id,
      title: "野战医帐",
      text: "帐篷里没有安稳的床，只有一排写满战伤处理步骤的木板。医官把代价分成三栏：牌、药水、常驻教范。",
      options: [
        {
          id: "manual",
          label: "收下清创手册",
          text: "支付 30 金币，获得创伤回收+。",
          disabled: run.player.gold < 30,
          disabledReason: "金币不足",
        },
        {
          id: "salve",
          label: "拿走清创剂",
          text: "支付 24 金币，获得 1 瓶清创药水。",
          disabled: run.player.gold < 24 || !hasPotionSpace,
          disabledReason: run.player.gold < 24 ? "金币不足" : "药水槽已满",
        },
        {
          id: "doctrine",
          label: "记下教范",
          text: "支付 50 金币，获得常驻提升：战伤教范。",
          disabled: run.player.gold < 50 || run.player.boons.includes("triage_doctrine"),
          disabledReason: run.player.gold < 50 ? "金币不足" : "已拥有",
        },
        {
          id: "leave",
          label: "离开",
          text: "不发生任何事。",
        },
      ],
    };
  }

  if (id === "ash_archive") {
    const hasPotionSpace = run.player.potions.length < run.player.potionSlots;
    return {
      id,
      title: "余烬档案",
      text: "一摞焦黑账页还在发热。每页都记录着被消耗的牌如何变成护幕、药剂，或下一场战斗的开局安排。",
      options: [
        {
          id: "ward",
          label: "翻出护幕残页",
          text: "支付 32 金币，获得余烬护幕+。",
          disabled: run.player.gold < 32,
          disabledReason: "金币不足",
        },
        {
          id: "bottle",
          label: "装瓶余烬",
          text: "支付 24 金币，获得 1 瓶余烬药水。",
          disabled: run.player.gold < 24 || !hasPotionSpace,
          disabledReason: run.player.gold < 24 ? "金币不足" : "药水槽已满",
        },
        {
          id: "ledger",
          label: "抄下账本",
          text: "支付 50 金币，获得常驻提升：余烬账本。",
          disabled: run.player.gold < 50 || run.player.boons.includes("ash_ledger"),
          disabledReason: run.player.gold < 50 ? "金币不足" : "已拥有",
        },
        {
          id: "leave",
          label: "离开",
          text: "不发生任何事。",
        },
      ],
    };
  }

  if (id === "rhythm_metronome") {
    const hasPotionSpace = run.player.potions.length < run.player.potionSlots;
    return {
      id,
      title: "错拍节拍器",
      text: "一只铜制节拍器在石桌上左右摆动。每一次摆动都像把连击拆开，再把余音塞进蓄能线圈。",
      options: [
        {
          id: "calibrate",
          label: "校准节拍",
          text: "支付 28 金币，获得节拍电池+。",
          disabled: run.player.gold < 28,
          disabledReason: "金币不足",
        },
        {
          id: "drink",
          label: "喝下节拍剂",
          text: "支付 22 金币，获得 1 瓶节拍药水。",
          disabled: run.player.gold < 22 || !hasPotionSpace,
          disabledReason: run.player.gold < 22 ? "金币不足" : "药水槽已满",
        },
        {
          id: "meter",
          label: "带走节拍器",
          text: "支付 48 金币，获得常驻提升：随身节拍器。",
          disabled: run.player.gold < 48 || run.player.boons.includes("rhythm_meter"),
          disabledReason: run.player.gold < 48 ? "金币不足" : "已拥有",
        },
        {
          id: "leave",
          label: "离开",
          text: "不发生任何事。",
        },
      ],
    };
  }

  if (id === "chain_hourglass") {
    const hasPotionSpace = run.player.potions.length < run.player.potionSlots;
    return {
      id,
      title: "连锁沙漏",
      text: "沙漏里的砂粒不会往下落，而是按你本回合打出的牌数一格格亮起。桌面上分成三摞：可加入牌组的护法页、短效药剂，以及会记住第三张牌的手册。",
      options: [
        {
          id: "bind",
          label: "装订护法页",
          text: "支付 30 金币，获得连锁护法+。",
          disabled: run.player.gold < 30,
          disabledReason: "金币不足",
        },
        {
          id: "dose",
          label: "喝下连锁剂",
          text: "支付 24 金币，获得 1 瓶连锁药水。",
          disabled: run.player.gold < 24 || !hasPotionSpace,
          disabledReason: run.player.gold < 24 ? "金币不足" : "药水槽已满",
        },
        {
          id: "manual",
          label: "抄下手册",
          text: "支付 50 金币，获得常驻提升：连锁手册。",
          disabled: run.player.gold < 50 || run.player.boons.includes("chain_manual"),
          disabledReason: run.player.gold < 50 ? "金币不足" : "已拥有",
        },
        {
          id: "leave",
          label: "离开",
          text: "不发生任何事。",
        },
      ],
    };
  }

  if (id === "cooling_station") {
    const hasPotionSpace = run.player.potions.length < run.player.potionSlots;
    return {
      id,
      title: "冷却站",
      text: "一台废弃冷却机还在低声运转，水槽里漂着蓝白色的药剂。墙上的铭文把过载分成三种处理方式：拆下散热片，灌装冷却剂，或学会把热量提前导走。",
      options: [
        {
          id: "plate",
          label: "拆下散热片",
          text: "支付 32 金币，获得散热片+。",
          disabled: run.player.gold < 32,
          disabledReason: "金币不足",
        },
        {
          id: "coolant",
          label: "灌装冷却剂",
          text: "支付 24 金币，获得 1 瓶冷却药水。",
          disabled: run.player.gold < 24 || !hasPotionSpace,
          disabledReason: run.player.gold < 24 ? "金币不足" : "药水槽已满",
        },
        {
          id: "regulator",
          label: "抄下铭文",
          text: "支付 52 金币，获得常驻提升：热控铭文。",
          disabled: run.player.gold < 52 || run.player.boons.includes("heat_regulator"),
          disabledReason: run.player.gold < 52 ? "金币不足" : "已拥有",
        },
        {
          id: "leave",
          label: "离开",
          text: "不发生任何事。",
        },
      ],
    };
  }

  if (id === "triage_station") {
    const hasPotionSpace = run.player.potions.length < run.player.potionSlots;
    const hasBoonSpace = run.player.boons.length < BOON_POOL.length;
    return {
      id,
      title: "分拣补给站",
      text: "三只补给箱被整齐地摆在路边：一只塞满牌套，一只晃着药水，一只刻着会发热的纹章。每只箱子只认一种代价。",
      options: [
        {
          id: "card_crate",
          label: "开卡牌箱",
          text: "支付 25 金币，获得 1 张随机非稀有牌，可能已升级。",
          disabled: run.player.gold < 25,
          disabledReason: "金币不足",
        },
        {
          id: "potion_crate",
          label: "开药水箱",
          text: "支付 20 金币，获得最多 2 瓶随机药水。",
          disabled: run.player.gold < 20 || !hasPotionSpace,
          disabledReason: run.player.gold < 20 ? "金币不足" : "药水槽已满",
        },
        {
          id: "boon_token",
          label: "捏碎令牌",
          text: "失去 5 点生命，获得 1 个随机常驻提升。",
          disabled: run.player.hp <= 5 || !hasBoonSpace,
          disabledReason: run.player.hp <= 5 ? "生命不足" : "常驻提升已满",
        },
        {
          id: "leave",
          label: "离开",
          text: "不发生任何事。",
        },
      ],
    };
  }

  return {
    id,
    title: "晶体花园",
    text: "透明根须从石缝里探出，像在听你的心跳。每一簇晶花都折射出不同的道路。",
    options: [
      {
        id: "harvest",
        label: "采下晶簇",
        text: `获得 ${scaleGold(run, 35)} 金币和 1 张淬毒飞镖。`,
      },
      {
        id: "rest",
        label: "靠近休息",
        text: "回复 14 点生命。",
      },
      {
        id: "root",
        label: "吞下根晶",
        text: "最大生命 +3，回复 3 点生命。",
      },
      {
        id: "leave",
        label: "离开",
        text: "不发生任何事。",
      },
    ],
  };
}

function generateMap(seed: number): MapNode[] {
  let localSeed = seed || 1;
  const nodes: MapNode[] = [];
  const roll = () => {
    const [nextSeed, value] = nextRandom(localSeed);
    localSeed = nextSeed;
    return value;
  };
  const randomIntLocal = (min: number, max: number) => Math.floor(roll() * (max - min + 1)) + min;
  const floorCounts = randomMapFloorCounts(() => roll());

  for (let floor = 0; floor < MAP_ROUTE_FLOORS; floor += 1) {
    const count = floorCounts[floor] ?? randomMapFloorNodeCount(floor, roll());
    const lanes = randomMapLanes(count, () => roll());
    const floorTypes = randomMapFloorTypes(floor, count, () => roll());

    for (let index = 0; index < count; index += 1) {
      const lane = lanes[index];
      const type = floorTypes[index];
      const xJitter = floor === 0 || floor === MAP_ROUTE_FLOORS - 1 ? 0 : (roll() - 0.5) * 3.2;
      const yJitter = floor === 0 || floor === MAP_ROUTE_FLOORS - 1 ? 0 : (roll() - 0.5) * 1.2;
      nodes.push({
        id: `n-${floor}-${index}`,
        floor,
        lane,
        x: clamp(10, 90, 12 + (lane / (MAP_VIRTUAL_LANES - 1)) * 76 + xJitter),
        y: clamp(10, 92, 91 - floor * 7.6 + yJitter),
        type,
        zone: mapZoneForNode(floor, lane, type, () => roll()),
        children: [],
      });
    }
  }

  ensureMapTypeMinimums(nodes, () => roll());
  refreshMapZones(nodes, () => roll());

  nodes.push({
    id: "boss",
    floor: MAP_ROUTE_FLOORS,
    lane: Math.floor(MAP_VIRTUAL_LANES / 2),
    x: 50,
    y: 5,
    type: "boss",
    zone: "heart",
    children: [],
  });

  for (let floor = 0; floor < MAP_ROUTE_FLOORS; floor += 1) {
    const currentFloor = nodes.filter((node) => node.floor === floor);
    const nextFloor = nodes.filter((node) => node.floor === floor + 1);

    for (const node of currentFloor) {
      if (floor === MAP_ROUTE_FLOORS - 1) {
        node.children = ["boss"];
        continue;
      }

      const candidates = nextFloor
        .map((child) => ({ child, distance: Math.abs(child.lane - node.lane) }))
        .filter(({ distance }) => distance <= 3)
        .sort((a, b) => a.distance - b.distance || a.child.lane - b.child.lane);
      const pool = candidates.length > 0 ? candidates : nextFloor.map((child) => ({ child, distance: 99 }));
      const children = new Set<string>();
      const primaryChild = pool[Math.min(pool.length - 1, Math.floor(roll() * Math.min(2, pool.length)))].child;
      pullMapNodeTowardParent(primaryChild, node, () => roll());
      children.add(primaryChild.id);

      const branchChance = floor < 2 ? 0.48 : floor > 8 ? 0.3 : 0.58;
      if (pool.length > 1 && roll() < branchChance) {
        const child = weightedMapChild(pool, () => roll());
        pullMapNodeTowardParent(child, node, () => roll());
        children.add(child.id);
      }
      if (pool.length > 2 && floor >= 3 && floor <= 8 && roll() < 0.16) {
        const child = weightedMapChild(pool, () => roll());
        pullMapNodeTowardParent(child, node, () => roll());
        children.add(child.id);
      }

      node.children = [...children];
    }

    if (floor < MAP_ROUTE_FLOORS - 1) {
      for (const child of nextFloor) {
        const parents = currentFloor.filter((node) => node.children.includes(child.id));
        if (parents.length > 0) {
          continue;
        }
        const nearestParents = currentFloor
          .map((node) => ({ node, distance: Math.abs(node.lane - child.lane) }))
          .sort((a, b) => a.distance - b.distance || a.node.lane - b.node.lane);
        const parent = nearestParents[Math.min(nearestParents.length - 1, randomIntLocal(0, Math.min(1, nearestParents.length - 1)))].node;
        pullMapNodeTowardParent(child, parent, () => roll());
        parent.children.push(child.id);
      }
    }
  }

  annotateMapRouteKinds(nodes);
  return nodes;
}

function randomMapFloorCounts(roll: () => number): number[] {
  const profiles = [
    [3, 4, 5, 4, 2, 4, 5, 3, 4, 5, 3],
    [4, 3, 5, 2, 4, 4, 5, 2, 4, 3, 3],
    [3, 5, 4, 3, 5, 2, 4, 5, 3, 2, 4],
    [4, 5, 3, 4, 2, 5, 4, 3, 5, 4, 3],
    [3, 4, 3, 5, 4, 2, 5, 3, 4, 5, 2],
  ];
  const counts = [...profiles[Math.floor(roll() * profiles.length)]];
  counts[0] = roll() < 0.24 ? 4 : 3;
  counts[MAP_ROUTE_FLOORS - 1] = roll() < 0.22 ? 2 : roll() < 0.76 ? 3 : 4;

  for (let floor = 1; floor < MAP_ROUTE_FLOORS - 1; floor += 1) {
    if (roll() < 0.28) {
      counts[floor] = clamp(2, 5, counts[floor] + (roll() < 0.5 ? -1 : 1));
    }
  }

  const chokeFloor = 3 + Math.floor(roll() * 6);
  counts[chokeFloor] = 2;
  if (roll() < 0.46) {
    const secondChoke = 4 + Math.floor(roll() * 5);
    if (Math.abs(secondChoke - chokeFloor) > 1) {
      counts[secondChoke] = 2;
    }
  }

  const wideFloor = 2 + Math.floor(roll() * 7);
  counts[wideFloor] = Math.max(counts[wideFloor], 5);

  for (let floor = 2; floor < MAP_ROUTE_FLOORS - 1; floor += 1) {
    if (counts[floor] === 2 && counts[floor - 1] === 2) {
      counts[floor] = 3;
    }
  }

  return counts;
}

function randomMapFloorNodeCount(floor: number, roll: number): number {
  if (floor === 0) {
    return roll < 0.24 ? 4 : 3;
  }
  if (floor === MAP_ROUTE_FLOORS - 1) {
    return roll < 0.22 ? 2 : roll < 0.76 ? 3 : 4;
  }
  if ((floor === 4 || floor === 7 || floor === 9) && roll < 0.16) {
    return 2;
  }
  if (roll < 0.18) {
    return 3;
  }
  if (roll < 0.74) {
    return 4;
  }
  return 5;
}

function randomMapLanes(count: number, roll: () => number): number[] {
  const lanes = Array.from({ length: MAP_VIRTUAL_LANES }, (_, index) => index);
  for (let index = lanes.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(roll() * (index + 1));
    [lanes[index], lanes[swapIndex]] = [lanes[swapIndex], lanes[index]];
  }
  return lanes.slice(0, count).sort((a, b) => a - b);
}

function randomMapFloorTypes(floor: number, count: number, roll: () => number): NodeType[] {
  if (floor === 0) {
    return Array.from({ length: count }, () => "fight");
  }

  const types: NodeType[] = [];
  for (let index = 0; index < count; index += 1) {
    types.push(weightedMapNodeType(mapNodeWeightsForFloor(floor, types, count), roll()));
  }

  if (floor >= 3 && floor <= 8 && !types.includes("elite") && roll() < 0.48) {
    types[Math.floor(roll() * types.length)] = "elite";
  }

  if (floor === MAP_ROUTE_FLOORS - 1 && !types.includes("rest")) {
    types[Math.floor(roll() * types.length)] = "rest";
  }

  if (new Set(types).size === 1 && types[0] !== "fight") {
    types[Math.floor(roll() * types.length)] = "fight";
  }

  return shuffleMapTypes(types, roll);
}

function mapZoneForNode(floor: number, lane: number, type: NodeType, roll: () => number): MapNode["zone"] {
  if (type === "boss") {
    return "heart";
  }
  if (floor <= 1) {
    return "outer";
  }
  if (type === "rest" || type === "shop") {
    return roll() < 0.72 ? "sanctum" : floor >= 8 ? "rift" : "forge";
  }
  if (type === "elite") {
    return floor >= 8 || roll() < 0.36 ? "rift" : "forge";
  }
  if (type === "event") {
    return floor >= 7 || roll() < 0.48 ? "rift" : lane <= 2 ? "wild" : "outer";
  }
  if (floor <= 4) {
    return lane <= 2 ? "wild" : lane >= 4 ? "forge" : roll() < 0.58 ? "wild" : "forge";
  }
  if (floor <= 7) {
    return lane <= 1 ? "wild" : lane >= 5 ? "rift" : roll() < 0.62 ? "forge" : "wild";
  }
  return roll() < 0.62 ? "rift" : "forge";
}

function refreshMapZones(nodes: MapNode[], roll: () => number): void {
  for (const node of nodes) {
    node.zone = mapZoneForNode(node.floor, node.lane, node.type, roll);
  }
}

function annotateMapRouteKinds(nodes: MapNode[]): void {
  const parentIdsByNode = new Map<string, string[]>();
  const nodeCountByFloor = new Map<number, number>();
  for (const node of nodes) {
    nodeCountByFloor.set(node.floor, (nodeCountByFloor.get(node.floor) ?? 0) + 1);
    for (const childId of node.children) {
      parentIdsByNode.set(childId, [...(parentIdsByNode.get(childId) ?? []), node.id]);
    }
  }

  for (const node of nodes) {
    const parents = parentIdsByNode.get(node.id) ?? [];
    node.routeKind = mapRouteKindForNode(node, parents.length, nodeCountByFloor.get(node.floor) ?? 0);
  }
}

function mapRouteKindForNode(node: MapNode, parentCount: number, floorCount: number): MapRouteKind {
  if (node.type === "boss") {
    return "summit";
  }
  if (node.floor === 0) {
    return "start";
  }
  if (node.children.length >= 2 && parentCount >= 2) {
    return "crossroad";
  }
  if (node.children.length >= 2) {
    return "branch";
  }
  if (parentCount >= 2) {
    return "converge";
  }
  if (floorCount <= 2) {
    return "choke";
  }
  return "choke";
}

function ensureMapTypeMinimums(nodes: MapNode[], roll: () => number): void {
  const minimums: Array<{ type: NodeType; count: number; minFloor: number; maxFloor: number }> = [
    { type: "event", count: 4, minFloor: 1, maxFloor: 9 },
    { type: "elite", count: 2, minFloor: 3, maxFloor: 8 },
    { type: "rest", count: 2, minFloor: 2, maxFloor: MAP_ROUTE_FLOORS - 1 },
    { type: "shop", count: 1, minFloor: 2, maxFloor: MAP_ROUTE_FLOORS - 1 },
  ];

  for (const rule of minimums) {
    while (nodes.filter((node) => node.type === rule.type).length < rule.count) {
      const candidates = nodes.filter(
        (node) =>
          node.floor >= rule.minFloor &&
          node.floor <= rule.maxFloor &&
          node.type !== rule.type &&
          node.type !== "boss" &&
          !(rule.type === "elite" && node.type === "rest"),
      );
      if (candidates.length === 0) {
        break;
      }
      candidates[Math.floor(roll() * candidates.length)].type = rule.type;
    }
  }
}

function mapNodeWeightsForFloor(floor: number, currentTypes: NodeType[], count: number): Array<[NodeType, number]> {
  const eliteCount = currentTypes.filter((type) => type === "elite").length;
  const shopCount = currentTypes.filter((type) => type === "shop").length;
  const restCount = currentTypes.filter((type) => type === "rest").length;
  const eventCount = currentTypes.filter((type) => type === "event").length;
  const duplicatePenalty = (type: NodeType, weight: number) => {
    const existing = currentTypes.filter((item) => item === type).length;
    if (existing === 0) {
      return weight;
    }
    return Math.max(1, Math.round(weight / (existing + 1.7)));
  };

  if (floor === 1) {
    return [
      ["fight", duplicatePenalty("fight", 68)],
      ["event", duplicatePenalty("event", 32)],
    ];
  }

  if (floor === 2) {
    return [
      ["fight", duplicatePenalty("fight", 42)],
      ["event", duplicatePenalty("event", 28)],
      ["shop", shopCount >= Math.max(1, Math.floor(count / 3)) ? 0 : 14],
      ["rest", restCount >= 1 ? 0 : 16],
    ];
  }

  if (floor === MAP_ROUTE_FLOORS - 1) {
    return [
      ["rest", duplicatePenalty("rest", 50)],
      ["shop", shopCount >= 1 ? 4 : 18],
      ["event", eventCount >= 1 ? 8 : 20],
      ["fight", 12],
    ];
  }

  if (floor >= 8) {
    return [
      ["fight", duplicatePenalty("fight", 28)],
      ["elite", eliteCount >= 1 ? 3 : 12],
      ["event", duplicatePenalty("event", 28)],
      ["shop", shopCount >= 1 ? 5 : 18],
      ["rest", restCount >= 1 ? 6 : 18],
    ];
  }

  return [
    ["fight", duplicatePenalty("fight", 36)],
    ["elite", eliteCount >= 2 ? 0 : 18],
    ["event", duplicatePenalty("event", 25)],
    ["shop", shopCount >= 1 ? 4 : 10],
    ["rest", restCount >= 1 ? 5 : 11],
  ];
}

function weightedMapNodeType(weights: Array<[NodeType, number]>, roll: number): NodeType {
  const total = weights.reduce((sum, [, weight]) => sum + Math.max(0, weight), 0);
  let remaining = roll * Math.max(1, total);
  for (const [type, weight] of weights) {
    remaining -= Math.max(0, weight);
    if (remaining <= 0) {
      return type;
    }
  }
  return "fight";
}

function shuffleMapTypes(types: NodeType[], roll: () => number): NodeType[] {
  const shuffled = [...types];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(roll() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
}

function weightedMapChild(candidates: Array<{ child: MapNode; distance: number }>, roll: () => number): MapNode {
  const weighted = candidates.map((candidate) => ({
    child: candidate.child,
    weight: Math.max(1, 10 - candidate.distance * 3),
  }));
  const total = weighted.reduce((sum, item) => sum + item.weight, 0);
  let remaining = roll() * total;
  for (const item of weighted) {
    remaining -= item.weight;
    if (remaining <= 0) {
      return item.child;
    }
  }
  return weighted[0].child;
}

function pullMapNodeTowardParent(child: MapNode, parent: MapNode, roll: () => number): void {
  const delta = child.lane - parent.lane;
  if (Math.abs(delta) <= 3) {
    return;
  }

  child.lane = clamp(0, MAP_VIRTUAL_LANES - 1, parent.lane + Math.sign(delta) * 3);
  child.x = clamp(10, 90, 12 + (child.lane / (MAP_VIRTUAL_LANES - 1)) * 76 + (roll() - 0.5) * 2.4);
}

function mapSeedForAct(seed: number, act: number): number {
  return ((seed || 1) + (Math.max(1, act) - 1) * ACT_MAP_SEED_STEP) >>> 0 || 1;
}

function assignEnemyIntents(run: RunState): void {
  const combat = run.combat;
  if (!combat) {
    return;
  }

  for (const enemy of combat.enemies) {
    if (enemy.hp <= 0) {
      continue;
    }
    enemy.intent = chooseEnemyMove(run, enemy);
  }
}

function addCardToHandOrDiscard(combat: CombatState, card: CardInstance): void {
  if (combat.hand.length >= MAX_HAND_SIZE) {
    combat.discardPile.push(card);
    addLog(combat, `手牌已满，${displayCardName(card)} 进入弃牌堆。`);
    return;
  }
  combat.hand.push(card);
}

function chooseEnemyMove(run: RunState, enemy: EnemyState): EnemyMove {
  const def = ENEMIES[enemy.defId];
  if (def.pattern?.length) {
    const moveId = def.pattern[enemy.moveIndex % def.pattern.length];
    enemy.moveIndex += 1;
    enemy.lastMoveId = moveId;
    return scaleEnemyMove(run, clone(def.moves.find((move) => move.id === moveId) ?? def.moves[0]));
  }

  const moves = def.moves.length > 1 ? def.moves.filter((move) => move.id !== enemy.lastMoveId) : def.moves;
  const total = moves.reduce((sum, move) => sum + move.weight, 0);
  let roll = randomFloat(run) * total;
  for (const move of moves) {
    roll -= move.weight;
    if (roll <= 0) {
      enemy.lastMoveId = move.id;
      return scaleEnemyMove(run, clone(move));
    }
  }
  enemy.lastMoveId = moves[0].id;
  return scaleEnemyMove(run, clone(moves[0]));
}

function createEnemy(run: RunState, enemyId: string): EnemyState {
  const def = ENEMIES[enemyId];
  const maxHp = scaleEnemyStat(run, randomInt(run, def.maxHp[0], def.maxHp[1]), "enemyHpMultiplier");
  return {
    uid: makeUid("enemy"),
    defId: enemyId,
    name: def.name,
    maxHp,
    hp: maxHp,
    block: 0,
    powers: {},
    intent: scaleEnemyMove(run, clone(def.moves[0])),
    moveIndex: 0,
  };
}

function pickEncounter(run: RunState, nodeType: NodeType) {
  const type = nodeType === "boss" ? "boss" : nodeType === "elite" ? "elite" : "fight";
  const act = currentAct(run);
  const candidates = ENCOUNTERS.filter((encounter) => {
    return (
      encounter.type === type &&
      (encounter.minFloor ?? 0) <= run.floor &&
      (encounter.minAct ?? 1) <= act &&
      (encounter.maxAct ?? Number.POSITIVE_INFINITY) >= act
    );
  });
  return candidates[randomInt(run, 0, candidates.length - 1)];
}

function drawCards(run: RunState, count: number): void {
  const combat = run.combat!;
  for (let i = 0; i < count; i += 1) {
    if (combat.drawPile.length === 0 && combat.discardPile.length > 0) {
      combat.drawPile = shuffleCards(run, combat.discardPile);
      combat.discardPile = [];
      addLog(combat, "弃牌堆洗入抽牌堆。");
    }

    const card = combat.drawPile.shift();
    if (!card) {
      return;
    }
    if (combat.hand.length >= MAX_HAND_SIZE) {
      combat.discardPile.push(card);
      addLog(combat, `手牌已满，${displayCardName(card)} 进入弃牌堆。`);
      continue;
    }
    combat.hand.push(card);
  }
}

function recoverFromDiscard(
  combat: CombatState,
  amount: number,
  cardType?: CardType,
  excludeStatus?: boolean,
): CardInstance[] {
  const recovered: CardInstance[] = [];
  for (let i = combat.discardPile.length - 1; i >= 0 && recovered.length < amount; i -= 1) {
    if (combat.hand.length >= MAX_HAND_SIZE) {
      break;
    }
    const candidate = combat.discardPile[i];
    const def = CARDS[candidate.cardId];
    if (cardType && def.type !== cardType) {
      continue;
    }
    if (excludeStatus && def.type === "Status") {
      continue;
    }
    recovered.push(candidate);
    combat.discardPile.splice(i, 1);
    combat.hand.push(candidate);
  }
  return recovered;
}

function movePlayedCard(combat: CombatState, card: CardInstance, level: CardLevel, def: CardDef): void {
  if (level.exhaust || def.type === "Power") {
    combat.exhaustPile.push(card);
  } else {
    combat.discardPile.push(card);
  }
}

function dealDamageToEnemy(run: RunState, enemy: EnemyState, baseDamage: number): void {
  const combat = run.combat!;
  if (enemy.hp <= 0) {
    return;
  }

  let damage = Math.max(0, baseDamage + (combat.playerPowers.strength ?? 0));
  const mark = enemy.powers.mark ?? 0;
  if (mark > 0 && damage > 0) {
    damage += mark * 2;
    addPower(enemy.powers, "mark", -1);
    addLog(combat, `${enemy.name} 的破绽使本次攻击额外造成 ${mark * 2} 点伤害。`);
  }
  if ((combat.playerPowers.weak ?? 0) > 0) {
    damage = Math.floor(damage * 0.75);
  }
  if ((enemy.powers.vulnerable ?? 0) > 0) {
    damage = Math.ceil(damage * 1.5);
  }

  const blocked = Math.min(enemy.block, damage);
  enemy.block -= blocked;
  const hpLoss = Math.max(0, damage - blocked);
  const actualHpLoss = takeEnemyHpLoss(run, enemy, hpLoss);
  addLog(combat, `${enemy.name} 受到 ${actualHpLoss} 点伤害。`);

  if (actualHpLoss > 0) {
    chipPlatedArmor(combat, enemy.powers, enemy.name);
    triggerSparkOnEnemy(run, enemy);
    triggerBleedOnEnemy(run, enemy);
  }

  const thorns = enemy.powers.thorns ?? 0;
  if (thorns > 0 && hpLoss > 0) {
    takePlayerHpLoss(run, thorns);
    addLog(combat, `${enemy.name} 的尖刺反伤 ${thorns} 点。`);
  }
}

function dealDirectDamageToEnemy(run: RunState, enemy: EnemyState, baseDamage: number, source: string): void {
  const combat = run.combat!;
  if (enemy.hp <= 0) {
    return;
  }

  const damage = Math.max(0, baseDamage);
  const blocked = Math.min(enemy.block, damage);
  enemy.block -= blocked;
  const hpLoss = Math.max(0, damage - blocked);
  const actualHpLoss = takeEnemyHpLoss(run, enemy, hpLoss);
  addLog(combat, `${enemy.name} 受到 ${actualHpLoss} 点${source}伤害。`);
}

function dealDamageToPlayer(run: RunState, enemy: EnemyState, baseDamage: number): void {
  const combat = run.combat!;
  let damage = Math.max(0, baseDamage + (enemy.powers.strength ?? 0));
  const mark = combat.playerPowers.mark ?? 0;
  if (mark > 0 && damage > 0) {
    damage += mark * 2;
    addPower(combat.playerPowers, "mark", -1);
    addLog(combat, `你的破绽使本次攻击额外造成 ${mark * 2} 点伤害。`);
  }
  if ((enemy.powers.weak ?? 0) > 0) {
    damage = Math.floor(damage * 0.75);
  }
  if ((combat.playerPowers.vulnerable ?? 0) > 0) {
    damage = Math.ceil(damage * 1.5);
  }

  const blocked = Math.min(combat.playerBlock, damage);
  combat.playerBlock -= blocked;
  const hpLoss = Math.max(0, damage - blocked);
  run.player.hp = Math.max(0, run.player.hp - hpLoss);
  addLog(combat, `你受到 ${hpLoss} 点伤害。`);

  if (hpLoss > 0) {
    chipPlatedArmor(combat, combat.playerPowers, "你的");
    triggerBleedOnPlayer(run);
  }

  const thorns = combat.playerPowers.thorns ?? 0;
  if (thorns > 0 && damage > 0 && enemy.hp > 0) {
    const actualHpLoss = takeEnemyHpLoss(run, enemy, thorns);
    addLog(combat, `尖刺对 ${enemy.name} 造成 ${actualHpLoss} 点反伤。`);
  }
}

function takePlayerHpLoss(run: RunState, amount: number): void {
  run.player.hp = Math.max(0, run.player.hp - amount);
}

function takeEnemyHpLoss(run: RunState, enemy: EnemyState, amount: number): number {
  const actualHpLoss = Math.min(enemy.hp, Math.max(0, amount));
  enemy.hp -= actualHpLoss;
  run.stats.damageDealt += actualHpLoss;
  return actualHpLoss;
}

function triggerBleedOnEnemy(run: RunState, enemy: EnemyState): void {
  const combat = run.combat!;
  const bleed = enemy.powers.bleed ?? 0;
  if (bleed <= 0 || enemy.hp <= 0) {
    return;
  }

  const actualHpLoss = takeEnemyHpLoss(run, enemy, bleed);
  addPower(enemy.powers, "bleed", -1);
  addLog(combat, `${enemy.name} 的流血爆开，失去 ${actualHpLoss} 点生命。`);
}

function triggerSparkOnEnemy(run: RunState, enemy: EnemyState): void {
  const combat = run.combat!;
  const spark = enemy.powers.spark ?? 0;
  if (spark <= 0) {
    return;
  }

  const targets = livingEnemies(combat);
  if (targets.length === 0) {
    return;
  }

  for (const target of targets) {
    dealDirectDamageToEnemy(run, target, spark, "电弧");
  }
  addPower(enemy.powers, "spark", -1);
  addLog(combat, `${enemy.name} 的电弧弹射 ${spark} 点伤害。`);
}

function triggerBleedOnPlayer(run: RunState): void {
  const combat = run.combat!;
  const bleed = combat.playerPowers.bleed ?? 0;
  if (bleed <= 0 || run.player.hp <= 0) {
    return;
  }

  takePlayerHpLoss(run, bleed);
  addPower(combat.playerPowers, "bleed", -1);
  addLog(combat, `流血爆开，你失去 ${bleed} 点生命。`);
}

function chipPlatedArmor(combat: CombatState, powers: PowerMap, ownerName: string): void {
  if ((powers.platedArmor ?? 0) <= 0) {
    return;
  }

  addPower(powers, "platedArmor", -1);
  addLog(combat, `${ownerName}金属化被削减 1 层。`);
}

function calculatePlayerBlock(combat: CombatState, baseBlock: number): number {
  let block = Math.max(0, baseBlock + (combat.playerPowers.dexterity ?? 0));
  if ((combat.playerPowers.frail ?? 0) > 0) {
    block = Math.floor(block * 0.75);
  }
  return block;
}

function tickOngoingPowers(run: RunState): void {
  const combat = run.combat!;

  const playerPlatedArmor = combat.playerPowers.platedArmor ?? 0;
  if (playerPlatedArmor > 0) {
    combat.playerBlock += playerPlatedArmor;
    addLog(combat, `金属化提供 ${playerPlatedArmor} 点格挡。`);
  }

  const playerPoison = combat.playerPowers.poison ?? 0;
  if (playerPoison > 0) {
    takePlayerHpLoss(run, playerPoison);
    addPower(combat.playerPowers, "poison", -1);
    addLog(combat, `中毒造成 ${playerPoison} 点伤害。`);
  }

  const playerRegen = combat.playerPowers.regen ?? 0;
  if (playerRegen > 0) {
    healPlayer(run, playerRegen);
    addPower(combat.playerPowers, "regen", -1);
    addLog(combat, `再生回复 ${playerRegen} 点生命。`);
  }

  for (const enemy of combat.enemies) {
    if (enemy.hp <= 0) {
      continue;
    }

    const platedArmor = enemy.powers.platedArmor ?? 0;
    if (platedArmor > 0) {
      enemy.block += platedArmor;
      addLog(combat, `${enemy.name} 的金属化提供 ${platedArmor} 点格挡。`);
    }

    const poison = enemy.powers.poison ?? 0;
    if (poison > 0) {
      const actualHpLoss = takeEnemyHpLoss(run, enemy, poison);
      addPower(enemy.powers, "poison", -1);
      addLog(combat, `${enemy.name} 因中毒失去 ${actualHpLoss} 点生命。`);
    }

    const regen = enemy.powers.regen ?? 0;
    if (regen > 0 && enemy.hp > 0) {
      enemy.hp = Math.min(enemy.maxHp, enemy.hp + regen);
      addPower(enemy.powers, "regen", -1);
      addLog(combat, `${enemy.name} 再生回复 ${regen} 点生命。`);
    }
  }
}

function allEnemiesDefeated(run: RunState): boolean {
  return Boolean(run.combat && run.combat.enemies.every((enemy) => enemy.hp <= 0));
}

function livingEnemies(combat: CombatState): EnemyState[] {
  return combat.enemies.filter((enemy) => enemy.hp > 0);
}

function isPlayerDead(run: RunState): boolean {
  return run.player.hp <= 0;
}

function addPower(powers: PowerMap, power: PowerKey, amount: number): void {
  const nextValue = (powers[power] ?? 0) + amount;
  if (nextValue <= 0) {
    delete powers[power];
  } else {
    powers[power] = nextValue;
  }
}

function amplifyPowerStacks(powers: PowerMap, power: PowerKey, multiplier: number, minimum = 0): number {
  const current = Math.max(0, powers[power] ?? 0);
  const scaledIncrease = Math.floor(current * Math.max(0, multiplier - 1));
  const gained = Math.max(0, scaledIncrease, minimum);
  if (gained > 0) {
    addPower(powers, power, gained);
  }
  return gained;
}

const PLAYER_DEBUFFS: PowerKey[] = ["vulnerable", "weak", "frail", "poison", "bleed", "mark"];

function cleansePlayerDebuffs(combat: CombatState): number {
  let removed = 0;
  for (const power of PLAYER_DEBUFFS) {
    if ((combat.playerPowers[power] ?? 0) > 0) {
      delete combat.playerPowers[power];
      removed += 1;
    }
  }
  return removed;
}

function decrementPowers(powers: PowerMap, keys: PowerKey[]): void {
  for (const key of keys) {
    if ((powers[key] ?? 0) > 0) {
      addPower(powers, key, -1);
    }
  }
}

function healPlayer(run: RunState, amount: number): void {
  run.player.hp = Math.min(run.player.maxHp, run.player.hp + amount);
}

function difficultyConfig(run: RunState): DifficultyConfig {
  return DIFFICULTIES[run.difficulty];
}

function scaleEnemyMove(run: RunState, move: EnemyMove): EnemyMove {
  const config = difficultyConfig(run);
  const damageMultiplier = config.enemyDamageMultiplier * actEnemyMultiplier(run, "enemyDamageMultiplier");
  const blockMultiplier = config.enemyBlockMultiplier * actEnemyMultiplier(run, "enemyBlockMultiplier");
  return {
    ...move,
    effects: move.effects.map((effect) => {
      if (effect.type === "damage") {
        return {
          ...effect,
          amount: Math.max(1, Math.round(effect.amount * damageMultiplier)),
        };
      }

      if (effect.type === "block") {
        return {
          ...effect,
          amount: Math.max(1, Math.round(effect.amount * blockMultiplier)),
        };
      }

      return effect;
    }),
  };
}

function scaleEnemyStat(
  run: RunState,
  value: number,
  multiplier: "enemyHpMultiplier" | "enemyDamageMultiplier" | "enemyBlockMultiplier",
): number {
  return Math.max(1, Math.round(value * difficultyConfig(run)[multiplier] * actEnemyMultiplier(run, multiplier)));
}

function scaleGold(run: RunState, value: number): number {
  return Math.max(1, Math.round(value * difficultyConfig(run).rewardGoldMultiplier * actGoldMultiplier(run)));
}

function scaleShopPrice(run: RunState, value: number): number {
  return Math.max(1, Math.round(value * difficultyConfig(run).shopPriceMultiplier));
}

function isUsableShopPrice(price: unknown): price is number {
  return typeof price === "number" && Number.isFinite(price) && price >= 0;
}

function currentAct(run: Pick<RunState, "act">): number {
  return Math.max(1, run.act || 1);
}

function actEnemyMultiplier(
  run: RunState,
  multiplier: "enemyHpMultiplier" | "enemyDamageMultiplier" | "enemyBlockMultiplier",
): number {
  const depth = currentAct(run) - 1;
  if (multiplier === "enemyHpMultiplier") {
    return 1 + depth * 0.18;
  }
  if (multiplier === "enemyDamageMultiplier") {
    return 1 + depth * 0.12;
  }
  return 1 + depth * 0.1;
}

function actGoldMultiplier(run: RunState): number {
  return 1 + (currentAct(run) - 1) * 0.08;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function clamp(min: number, max: number, value: number): number {
  return Math.max(min, Math.min(max, value));
}

function grantPotion(run: RunState, potionId: string): boolean {
  if (run.player.potions.length >= run.player.potionSlots) {
    return false;
  }
  run.player.potions.push(makePotionInstance(potionId));
  return true;
}

function grantRelic(run: RunState, relicId: string): void {
  if (run.player.relics.includes(relicId)) {
    return;
  }
  run.player.relics.push(relicId);
  if (relicId === "ancient_coin") {
    run.player.gold += 80;
    run.stats.goldEarned += 80;
  }
}

function grantBoon(run: RunState, boonId: BoonId): boolean {
  if (run.player.boons.includes(boonId)) {
    return false;
  }

  run.player.boons.push(boonId);
  if (boonId === "vitality") {
    run.player.maxHp += 4;
    healPlayer(run, 4);
  }
  if (boonId === "bottle_rack") {
    run.player.potionSlots = Math.min(5, run.player.potionSlots + 1);
  }
  if (boonId === "armory_drill") {
    upgradeRandomCards(run, 1);
  }
  if (boonId === "field_alchemy") {
    const potionId = randomPotion(run);
    if (potionId) {
      grantPotion(run, potionId);
    }
  }
  return true;
}

function boonBonusText(run: RunState, boonId: BoonId, potionCountBefore: number): string {
  const gainedPotion = boonId === "field_alchemy" ? run.player.potions[potionCountBefore] : undefined;
  if (!gainedPotion) {
    return "";
  }

  return `，并获得药水 ${POTIONS[gainedPotion.potionId].name}`;
}

function hasRelic(run: RunState, relicId: string): boolean {
  return run.player.relics.includes(relicId);
}

function hasBoon(run: RunState, boonId: BoonId): boolean {
  return run.player.boons.includes(boonId);
}

function rollRewardCard(run: RunState, nodeType: NodeType): string {
  const rareBonus = nodeType === "boss" ? 0.16 : nodeType === "elite" ? 0.06 : 0;
  const roll = randomFloat(run);
  const uncommonThreshold = nodeType === "boss" ? 0.62 : 0.36;
  const rarity = roll < 0.08 + rareBonus ? "rare" : roll < uncommonThreshold ? "uncommon" : "common";
  const candidates = REWARD_CARD_IDS.filter((cardId) => CARDS[cardId].rarity === rarity);
  return candidates[randomInt(run, 0, candidates.length - 1)];
}

function randomCard(run: RunState, predicate: (card: CardDef) => boolean = () => true): string {
  const candidates = REWARD_CARD_IDS.filter((cardId) => predicate(CARDS[cardId]));
  return candidates[randomInt(run, 0, candidates.length - 1)];
}

function removeRandomDeckCard(run: RunState, predicate: (card: CardInstance) => boolean = () => true): CardInstance | undefined {
  const candidates = run.player.deck
    .map((card, index) => ({ card, index }))
    .filter(({ card }) => predicate(card));
  if (candidates.length === 0) {
    return undefined;
  }

  const picked = candidates[randomInt(run, 0, candidates.length - 1)];
  run.player.deck.splice(picked.index, 1);
  return picked.card;
}

function removeRandomPotion(run: RunState): PotionInstance | undefined {
  if (run.player.potions.length === 0) {
    return undefined;
  }
  const index = randomInt(run, 0, run.player.potions.length - 1);
  const [potion] = run.player.potions.splice(index, 1);
  return potion;
}

function removeRandomRelic(run: RunState): string | undefined {
  const candidates = run.player.relics
    .map((relicId, index) => ({ relicId, index }))
    .filter(({ relicId }) => RELICS[relicId]?.rarity !== "starter" && RELICS[relicId]?.rarity !== "boss");
  if (candidates.length === 0) {
    return undefined;
  }

  const picked = candidates[randomInt(run, 0, candidates.length - 1)];
  run.player.relics.splice(picked.index, 1);
  return picked.relicId;
}

function hasRelicPoolSpace(run: RunState): boolean {
  return RELIC_POOL.some((relicId) => !run.player.relics.includes(relicId));
}

function canConvertNextRouteNode(run: RunState, type: NodeType): boolean {
  return Boolean(findConvertibleNextRouteNodes(run, type).length);
}

function convertNextRouteNode(run: RunState, type: NodeType): MapNode | undefined {
  const candidates = findConvertibleNextRouteNodes(run, type);
  if (candidates.length === 0) {
    return undefined;
  }
  const node = candidates[randomInt(run, 0, candidates.length - 1)];
  node.type = type;
  return node;
}

function findConvertibleNextRouteNodes(run: RunState, type: NodeType): MapNode[] {
  const current = run.map.find((node) => node.id === run.currentNodeId);
  if (!current) {
    return [];
  }

  return current.children
    .map((nodeId) => run.map.find((node) => node.id === nodeId))
    .filter((node): node is MapNode => Boolean(node && node.type !== "boss" && !node.completed && node.type !== type));
}

function duplicateRandomDeckCard(run: RunState, predicate: (card: CardInstance) => boolean = () => true): CardInstance | undefined {
  const candidates = run.player.deck.filter((card) => predicate(card));
  if (candidates.length === 0) {
    return undefined;
  }

  const source = candidates[randomInt(run, 0, candidates.length - 1)];
  const copy = makeCardInstance(source.cardId, source.upgraded);
  run.player.deck.push(copy);
  return copy;
}

function transformRandomDeckCard(run: RunState): { oldCard: CardInstance; newCard: CardInstance } | undefined {
  const candidates = run.player.deck
    .map((card, index) => ({ card, index }))
    .filter(({ card }) => CARDS[card.cardId].rarity !== "status");
  if (candidates.length === 0) {
    return undefined;
  }

  const picked = candidates[randomInt(run, 0, candidates.length - 1)];
  const allowRare = randomFloat(run) < 0.18;
  const newCardId = randomCard(run, (card) => allowRare || card.rarity !== "rare");
  const newCard = makeCardInstance(newCardId, picked.card.upgraded);
  run.player.deck[picked.index] = newCard;
  return { oldCard: picked.card, newCard };
}

function randomRelic(run: RunState, extraExclusions = new Set<string>()): string | undefined {
  const candidates = RELIC_POOL.filter((relicId) => !run.player.relics.includes(relicId) && !extraExclusions.has(relicId));
  if (candidates.length === 0) {
    return undefined;
  }
  return candidates[randomInt(run, 0, candidates.length - 1)];
}

function randomBoon(run: RunState, extraExclusions = new Set<BoonId>()): BoonId | undefined {
  const candidates = BOON_POOL.filter((boonId) => !run.player.boons.includes(boonId) && !extraExclusions.has(boonId));
  if (candidates.length === 0) {
    return undefined;
  }

  const roll = randomFloat(run);
  const rarity = roll < 0.1 ? "rare" : roll < 0.44 ? "uncommon" : "common";
  const rarityCandidates = candidates.filter((boonId) => BOONS[boonId].rarity === rarity);
  const pool = rarityCandidates.length > 0 ? rarityCandidates : candidates;
  return pool[randomInt(run, 0, pool.length - 1)];
}

function randomPotion(run: RunState, extraExclusions = new Set<string>()): string | undefined {
  const candidates = POTION_POOL.filter((potionId) => !extraExclusions.has(potionId));
  if (candidates.length === 0) {
    return undefined;
  }

  const roll = randomFloat(run);
  const rarity = roll < 0.12 ? "rare" : roll < 0.38 ? "uncommon" : "common";
  const rarityCandidates = candidates.filter((potionId) => POTIONS[potionId].rarity === rarity);
  const pool = rarityCandidates.length > 0 ? rarityCandidates : candidates;
  return pool[randomInt(run, 0, pool.length - 1)];
}

function upgradeRandomCards(run: RunState, count: number): number {
  let upgraded = 0;
  for (let i = 0; i < count; i += 1) {
    const candidates = run.player.deck.filter((card) => !card.upgraded);
    if (candidates.length === 0) {
      break;
    }
    const card = candidates[randomInt(run, 0, candidates.length - 1)];
    card.upgraded = true;
    upgraded += 1;
  }
  return upgraded;
}

function shuffleCards(run: RunState, cards: CardInstance[]): CardInstance[] {
  const copy = [...cards];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = randomInt(run, 0, i);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function randomFloat(run: RunState): number {
  const [nextSeed, value] = nextRandom(run.rng);
  run.rng = nextSeed;
  return value;
}

function randomInt(run: RunState, min: number, max: number): number {
  const value = randomFloat(run);
  return Math.floor(value * (max - min + 1)) + min;
}

function nextRandom(seed: number): [number, number] {
  const nextSeed = (seed * 1664525 + 1013904223) >>> 0;
  return [nextSeed, nextSeed / 0x100000000];
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function makeUid(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}-${Date.now().toString(36)}`;
}

function withMessage(run: RunState, message: string): RunState {
  return {
    ...run,
    message,
  };
}

function addLog(combat: CombatState, line: string): void {
  combat.log.push(line);
  if (combat.log.length > MAX_LOG_LINES) {
    combat.log = combat.log.slice(-MAX_LOG_LINES);
  }
}

function displayCardName(card: CardInstance): string {
  const def = getCardDef(card.cardId);
  return `${def.name}${card.upgraded && def !== INVALID_CARD_DEF ? "+" : ""}`;
}

function powerName(power: PowerKey): string {
  const labels: Record<PowerKey, string> = {
    strength: "力量",
    dexterity: "敏捷",
    vulnerable: "易伤",
    weak: "虚弱",
    frail: "脆弱",
    poison: "中毒",
    regen: "再生",
    thorns: "尖刺",
    ritual: "仪式",
    bleed: "流血",
    mark: "破绽",
    platedArmor: "金属化",
    combo: "连击",
    charge: "蓄能",
    spark: "电弧",
  };
  return labels[power];
}

function destinationName(destination: "hand" | "draw" | "discard"): string {
  if (destination === "hand") {
    return "手牌";
  }
  if (destination === "draw") {
    return "抽牌堆顶部";
  }
  return "弃牌堆";
}
