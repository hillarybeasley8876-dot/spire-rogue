import { BOON_POOL, BOONS, CARDS, DIFFICULTIES, ENCOUNTERS, ENEMIES, POTION_POOL, POTIONS, RELIC_POOL, RELICS, REWARD_CARD_IDS } from "../src/game/data";
import { EVENT_IDS } from "../src/game/events";
import {
  buyShopBoon,
  buyShopHeal,
  buyShopPotion,
  buyShopRelic,
  buyShopRemove,
  canPlayCard,
  cardNeedsTarget,
  chooseEventOption,
  claimRewardBoon,
  claimRewardCard,
  claimRewardPotion,
  createInitialRun,
  discardPotion,
  endTurn,
  enterNode,
  getAvailableNodeIds,
  getCurrentEvent,
  getCardTarget,
  makeCardInstance,
  makePotionInstance,
  playCard,
  potionNeedsTarget,
  restBrewPotion,
  restCleanseStatus,
  restHeal,
  restockShop,
  rerollRewardCards,
  usePotion,
} from "../src/game/engine";
import {
  ACTIVE_RUN_SAVE_KEY,
  clearSavedRun,
  loadSavedRun,
  saveRun,
  type StorageLike,
} from "../src/game/persistence";
import type { ActionTarget, CardLevel, MapNode, NodeType, RunState } from "../src/game/types";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function effectTargetsClickedEnemy(effect: { target?: unknown }): boolean {
  return effect.target === "enemy";
}

function effectTargetsAllEnemies(effect: { target?: unknown }): boolean {
  return effect.target === "allEnemies";
}

function inferActionTarget(level: CardLevel): ActionTarget {
  if (level.effects.some(effectTargetsClickedEnemy)) {
    return "enemy";
  }
  if (level.effects.some(effectTargetsAllEnemies)) {
    return "allEnemies";
  }
  if (level.unplayable || level.effects.length === 0) {
    return "none";
  }
  return "self";
}

class MemoryStorage implements StorageLike {
  private values = new Map<string, string>();

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }

  removeItem(key: string) {
    this.values.delete(key);
  }
}

function livingEnemyUid(run: RunState): string {
  const enemy = run.combat?.enemies.find((item) => item.hp > 0);
  assert(enemy, "expected a living enemy");
  return enemy.uid;
}

function firstPlayableCard(run: RunState, cardId?: string) {
  const card = run.combat?.hand.find((item) => canPlayCard(run, item) && (!cardId || item.cardId === cardId));
  assert(card, `expected playable card${cardId ? ` ${cardId}` : ""}`);
  return card;
}

function createEventAuditRun(seed: number, eventId: string): RunState {
  const run = createInitialRun(seed, "map", "standard");
  run.phase = "event";
  run.event = {
    id: eventId,
    title: "事件遍历",
    text: "",
    options: [{ id: "leave", label: "离开", text: "" }],
  };
  run.player.hp = run.player.maxHp;
  run.player.gold = 999;
  run.player.potionSlots = 5;
  run.player.potions = [makePotionInstance("fire_potion")];
  run.player.relics = ["ember_core", "blood_vial"];
  run.player.deck.push(makeCardInstance("burn"), makeCardInstance("quick_stab"), makeCardInstance("defend"));
  return run;
}

function validateMap(run: RunState) {
  assert(run.map.length >= 33 && run.map.length <= 54, "map should have a variable but bounded number of route nodes");
  const ids = new Set(run.map.map((node) => node.id));
  assert(ids.size === run.map.length, "map ids should be unique");
  const startingNodeIds = getAvailableNodeIds(run);
  assert(startingNodeIds.length >= 3 && startingNodeIds.length <= 4, "map should begin with 3-4 available nodes");
  for (const floor of Array.from({ length: 11 }, (_, index) => index)) {
    const floorCount = run.map.filter((node) => node.floor === floor).length;
    assert(floorCount >= 2 && floorCount <= 5, `floor ${floor} should have a variable node count`);
  }

  for (const node of run.map.filter((item) => item.id !== "boss")) {
    assert(node.lane >= 0 && node.lane <= 6, "map lanes should stay inside the virtual lane range");
    assert(node.x >= 8 && node.x <= 92 && node.y >= 4 && node.y <= 94, "map nodes should stay inside the canvas");
    assert(
      ["outer", "wild", "forge", "sanctum", "rift"].includes(String(node.zone)),
      "generated route nodes should carry a readable map zone",
    );
    assert(
      ["start", "branch", "converge", "choke", "crossroad"].includes(String(node.routeKind)),
      "generated route nodes should carry a readable route kind",
    );
    const children = node.children.map((childId) => run.map.find((item) => item.id === childId));
    assert(children.every(Boolean), "map connections should point to real nodes");
    assert(children.length >= 1 && children.length <= 4, "map nodes should offer a readable number of route choices");
    for (const child of children) {
      assert(child!.floor === node.floor + 1, "map connections should only go to next floor");
      assert(child!.type === "boss" || Math.abs(child!.lane - node.lane) <= 3, "map connections should not jump across the whole map");
    }
  }

  const typeCounts = countNodeTypes(run.map);
  const zoneCount = new Set(run.map.filter((node) => node.id !== "boss").map((node) => node.zone)).size;
  const floorCounts = Array.from({ length: 11 }, (_, floor) => run.map.filter((node) => node.floor === floor).length);
  const routeKinds = run.map.reduce<Record<string, number>>((counts, node) => {
    counts[String(node.routeKind)] = (counts[String(node.routeKind)] ?? 0) + 1;
    return counts;
  }, {});
  assert(zoneCount >= 3, "map should include multiple visual route zones");
  assert(floorCounts.some((count) => count === 2), "map should include at least one narrow bottleneck floor");
  assert(floorCounts.some((count) => count >= 5), "map should include at least one wide branch floor");
  assert((routeKinds.branch ?? 0) + (routeKinds.crossroad ?? 0) >= 4, "map should include visible branch route nodes");
  assert((routeKinds.converge ?? 0) + (routeKinds.crossroad ?? 0) >= 2, "map should include visible merge route nodes");
  assert((routeKinds.choke ?? 0) >= 2, "map should include visible choke route nodes");
  assert(run.map.find((node) => node.id === "boss")?.routeKind === "summit", "boss node should be marked as the summit");
  assert(typeCounts.event >= 4, "map should include enough event nodes");
  assert(typeCounts.elite >= 2, "map should include elite route pressure");
  assert(typeCounts.rest >= 2, "map should include rest opportunities");
  assert(typeCounts.shop >= 1, "map should include at least one shop");

  const reachable = new Set<string>();
  const stack = [...startingNodeIds];
  while (stack.length > 0) {
    const nodeId = stack.pop()!;
    if (reachable.has(nodeId)) {
      continue;
    }
    reachable.add(nodeId);
    const node = run.map.find((item) => item.id === nodeId);
    if (node) {
      stack.push(...node.children);
    }
  }
  assert(reachable.has("boss"), "boss should be reachable from the starting routes");
  assert(
    run.map.filter((node) => node.type !== "boss").every((node) => reachable.has(node.id)),
    "all generated route nodes should be reachable from the start",
  );
}

function countNodeTypes(map: MapNode[]): Record<NodeType, number> {
  return map.reduce<Record<NodeType, number>>(
    (counts, node) => {
      counts[node.type] += 1;
      return counts;
    },
    { fight: 0, elite: 0, rest: 0, shop: 0, event: 0, boss: 0 },
  );
}

const mapValidationSeeds = [
  ...Array.from({ length: 48 }, (_, index) => index + 1),
  12345,
  24680,
  424242,
  99999,
  123456789,
];
for (const seed of mapValidationSeeds) {
  validateMap(createInitialRun(seed, "map", "standard"));
}

const mapShapeSignatures = new Set(
  mapValidationSeeds.slice(0, 12).map((seed) => {
    const run = createInitialRun(seed, "map", "standard");
    const countsByFloor = Array.from({ length: 11 }, (_, floor) => run.map.filter((node) => node.floor === floor).length).join("-");
    const typeCounts = countNodeTypes(run.map);
    return `${countsByFloor}|${typeCounts.fight}/${typeCounts.event}/${typeCounts.elite}/${typeCounts.rest}/${typeCounts.shop}`;
  }),
);
assert(mapShapeSignatures.size >= 6, "different seeds should produce meaningfully different map shapes");

let unavailableNodeRun = createInitialRun(4320, "map", "standard");
const unavailableNode = unavailableNodeRun.map.find((node) => node.floor > 0 && !getAvailableNodeIds(unavailableNodeRun).includes(node.id));
assert(unavailableNode, "expected an unavailable map node");
unavailableNodeRun = enterNode(unavailableNodeRun, unavailableNode.id);
assert(unavailableNodeRun.phase === "map", "entering an unavailable node should keep the run on the map");
assert(unavailableNodeRun.message?.includes("不可进入"), "entering an unavailable node should explain route availability");

let missingCurrentMapRun = createInitialRun(4321, "map", "standard");
const recoveredRouteTip = missingCurrentMapRun.map.find((node) => node.floor === 0)!;
recoveredRouteTip.completed = true;
missingCurrentMapRun.currentNodeId = undefined;
const recoveredFromMissingCurrent = getAvailableNodeIds(missingCurrentMapRun);
assert(!recoveredFromMissingCurrent.includes(recoveredRouteTip.id), "missing current route should not reopen completed start nodes");
assert(
  recoveredRouteTip.children.every((childId) => recoveredFromMissingCurrent.includes(childId)),
  "missing current route should recover from the deepest completed node",
);
missingCurrentMapRun.currentNodeId = "missing-node";
const recoveredFromInvalidCurrent = getAvailableNodeIds(missingCurrentMapRun);
assert(
  recoveredFromInvalidCurrent.length === recoveredFromMissingCurrent.length &&
    recoveredFromInvalidCurrent.every((nodeId) => recoveredFromMissingCurrent.includes(nodeId)),
  "invalid current node should recover the same available route",
);

for (const [cardId, card] of Object.entries(CARDS)) {
  assert(card.id === cardId, `card key ${cardId} should match its id`);
  assert(card.name.length > 0, `card ${cardId} should have a name`);
  assert(card.base.text.length > 0 && card.upgraded.text.length > 0, `card ${cardId} should have rules text`);
  assert(card.base.cost >= 0 && card.upgraded.cost >= 0, `card ${cardId} should not have a negative cost`);
}
for (const [potionId, potion] of Object.entries(POTIONS)) {
  assert(potion.id === potionId, `potion key ${potionId} should match its id`);
  assert(potion.name.length > 0 && potion.text.length > 0, `potion ${potionId} should have name and text`);
  assert(potion.effects.length > 0, `potion ${potionId} should define at least one effect`);
}
for (const [enemyId, enemy] of Object.entries(ENEMIES)) {
  assert(enemy.id === enemyId, `enemy key ${enemyId} should match its id`);
  assert(enemy.name.length > 0, `enemy ${enemyId} should have a name`);
}
for (const [boonId, boon] of Object.entries(BOONS)) {
  assert(boon.id === boonId, `boon key ${boonId} should match its id`);
  assert(boon.name.length > 0 && boon.text.length > 0, `boon ${boonId} should have name and text`);
}
for (const [relicId, relic] of Object.entries(RELICS)) {
  assert(relic.id === relicId, `relic key ${relicId} should match its id`);
}
assert(Object.keys(CARDS).length >= 71, "card pool should keep the expanded prototype content floor");
assert(POTION_POOL.length >= 27, "potion pool should keep the expanded prototype content floor");
assert(BOON_POOL.length >= 28, "boon pool should keep the expanded prototype content floor");
assert(Object.keys(RELICS).length >= 21, "relic pool should keep the expanded prototype content floor");
assert(Object.keys(ENEMIES).length >= 28, "enemy roster should keep the expanded prototype content floor");
assert(ENCOUNTERS.length >= 27, "encounter pool should keep the expanded prototype content floor");
assert(EVENT_IDS.length >= 32, "event pool should keep the expanded prototype content floor");
for (const eventId of EVENT_IDS) {
  const eventRun = createInitialRun(17000 + EVENT_IDS.indexOf(eventId), "map", "standard");
  eventRun.phase = "event";
  eventRun.event = { id: eventId, title: "事件池测试", text: "", options: [{ id: "leave", label: "离开", text: "" }] };
  const rebuiltEvent = getCurrentEvent(eventRun);
  assert(rebuiltEvent?.id === eventId, `event ${eventId} should be rebuildable from the shared event pool`);
  assert(rebuiltEvent.options.length > 0, `event ${eventId} should expose at least one option`);
  const optionIds = new Set<string>();
  for (const option of rebuiltEvent.options) {
    assert(option.id.length > 0, `event ${eventId} should not expose an option without id`);
    assert(!optionIds.has(option.id), `event ${eventId} should not expose duplicate option ${option.id}`);
    optionIds.add(option.id);
    assert(option.label.length > 0 && option.text.length > 0, `event ${eventId}.${option.id} should have label and text`);
    assert(!option.disabled || Boolean(option.disabledReason), `event ${eventId}.${option.id} should explain disabled state`);
  }
}
for (const eventId of EVENT_IDS) {
  const auditRun = createEventAuditRun(17100 + EVENT_IDS.indexOf(eventId), eventId);
  const rebuiltEvent = getCurrentEvent(auditRun);
  assert(rebuiltEvent, `event ${eventId} should be available for option traversal`);
  for (const option of rebuiltEvent.options) {
    const optionRun = createEventAuditRun(17200 + EVENT_IDS.indexOf(eventId) * 10 + rebuiltEvent.options.indexOf(option), eventId);
    const currentEvent = getCurrentEvent(optionRun);
    const currentOption = currentEvent?.options.find((item) => item.id === option.id);
    if (!currentOption || currentOption.disabled) {
      continue;
    }
    const result = chooseEventOption(optionRun, option.id);
    assert(result.phase === "map", `event ${eventId}.${option.id} should resolve back to map when available`);
    assert(result.event === undefined, `event ${eventId}.${option.id} should clear event state`);
  }
}
for (const cardId of REWARD_CARD_IDS) {
  assert(CARDS[cardId], `reward card ${cardId} should exist`);
}
for (const card of Object.values(CARDS)) {
  assert(card.base.target === inferActionTarget(card.base), `${card.id} base target should match its level effects`);
  assert(card.upgraded.target === inferActionTarget(card.upgraded), `${card.id} upgraded target should match its level effects`);
  assert(
    cardNeedsTarget(makeCardInstance(card.id)) === card.base.effects.some(effectTargetsClickedEnemy),
    `${card.id} base target helper should match its effects`,
  );
  assert(
    cardNeedsTarget(makeCardInstance(card.id, true)) === card.upgraded.effects.some(effectTargetsClickedEnemy),
    `${card.id} upgraded target helper should match its effects`,
  );
  for (const level of [card.base, card.upgraded]) {
    for (const effect of level.effects) {
      if (effect.type === "createCard") {
        assert(CARDS[effect.cardId], `${card.id} should create existing card ${effect.cardId}`);
      }
      if (effect.type === "blockPerExhaustedCard") {
        assert(effect.amount > 0, `${card.id} exhausted-card block effect should have positive amount`);
        assert(effect.cap === undefined || effect.cap > 0, `${card.id} exhausted-card block effect should have a positive cap`);
      }
      if (effect.type === "gainPowerPerPower") {
        assert(effect.amount > 0, `${card.id} power resonance effect should have positive amount`);
        assert(effect.cap === undefined || effect.cap > 0, `${card.id} power resonance effect should have a positive cap`);
        assert(effect.sourcePower !== effect.gainedPower, `${card.id} power resonance effect should convert between different powers`);
      }
      if (effect.type === "gainPowerPerCardPlayed") {
        assert(effect.amount > 0, `${card.id} chain effect should have positive amount`);
        assert(effect.cap === undefined || effect.cap > 0, `${card.id} chain effect should have a positive cap`);
        assert(effect.minimum === undefined || effect.minimum >= 0, `${card.id} chain effect should have a nonnegative minimum`);
      }
      if (effect.type === "cleansePower") {
        assert(effect.amount > 0, `${card.id} cleanse power effect should remove a positive amount`);
        assert(
          Boolean(effect.gainBlockPerStack || effect.gainPowerPerStack || effect.gainEnergyPerStack),
          `${card.id} cleanse power effect should have a payoff`,
        );
      }
    }
  }
}
for (const potionId of POTION_POOL) {
  const potionDef = POTIONS[potionId];
  assert(potionDef, `potion ${potionId} should exist`);
  assert(
    potionNeedsTarget(makePotionInstance(potionId)) === potionDef.effects.some(effectTargetsClickedEnemy),
    `${potionId} target helper should match its effects`,
  );
  for (const effect of potionDef.effects) {
    if (effect.type === "blockPerExhaustedCard") {
      assert(effect.amount > 0, `${potionId} exhausted-card block effect should have positive amount`);
      assert(effect.cap === undefined || effect.cap > 0, `${potionId} exhausted-card block effect should have a positive cap`);
    }
    if (effect.type === "gainPowerPerPower") {
      assert(effect.amount > 0, `${potionId} power resonance effect should have positive amount`);
      assert(effect.cap === undefined || effect.cap > 0, `${potionId} power resonance effect should have a positive cap`);
      assert(effect.sourcePower !== effect.gainedPower, `${potionId} power resonance effect should convert between different powers`);
    }
    if (effect.type === "gainPowerPerCardPlayed") {
      assert(effect.amount > 0, `${potionId} chain effect should have positive amount`);
      assert(effect.cap === undefined || effect.cap > 0, `${potionId} chain effect should have a positive cap`);
      assert(effect.minimum === undefined || effect.minimum >= 0, `${potionId} chain effect should have a nonnegative minimum`);
    }
    if (effect.type === "cleansePower") {
      assert(effect.amount > 0, `${potionId} cleanse power effect should remove a positive amount`);
      assert(
        Boolean(effect.gainBlockPerStack || effect.gainPowerPerStack || effect.gainEnergyPerStack),
        `${potionId} cleanse power effect should have a payoff`,
      );
    }
  }
}
assert(potionNeedsTarget(makePotionInstance("fire_potion")), "enemy potions should require a target");
assert(!potionNeedsTarget(makePotionInstance("explosive_potion")), "all-enemy potions should not require a clicked target");
assert(!potionNeedsTarget(makePotionInstance("recall_potion")), "self potions should not require a clicked target");
assert(!potionNeedsTarget(makePotionInstance("missing_potion")), "missing potion target helper should fail closed");
assert(cardNeedsTarget(makeCardInstance("blood_catalyst")), "single-target amplification cards should require a target");
assert(!cardNeedsTarget(makeCardInstance("blood_catalyst", true)), "upgraded all-enemy amplification cards should not require a target");
assert(getCardTarget(makeCardInstance("defend")) === "self", "defend should explicitly target self");
assert(getCardTarget(makeCardInstance("strike")) === "enemy", "strike should explicitly target a single enemy");
assert(!cardNeedsTarget(makeCardInstance("missing_card")), "missing card target helper should fail closed");
for (const boonId of BOON_POOL) {
  assert(BOONS[boonId], `boon ${boonId} should exist`);
}
for (const encounter of ENCOUNTERS) {
  assert(encounter.enemies.length > 0, `encounter ${encounter.id} should contain enemies`);
  assert(encounter.minFloor === undefined || encounter.minFloor >= 0, `encounter ${encounter.id} should not use a negative floor gate`);
  assert(encounter.minAct === undefined || encounter.minAct >= 1, `encounter ${encounter.id} should not use an invalid act gate`);
  assert(
    encounter.maxAct === undefined || encounter.minAct === undefined || encounter.maxAct >= encounter.minAct,
    `encounter ${encounter.id} max act should not be lower than min act`,
  );
  for (const enemyId of encounter.enemies) {
    assert(ENEMIES[enemyId], `encounter ${encounter.id} should reference existing enemy ${enemyId}`);
    if (encounter.type === "elite") {
      assert(ENEMIES[enemyId].tier === "elite", `elite encounter ${encounter.id} should not contain non-elite ${enemyId}`);
    }
    if (encounter.type === "boss") {
      assert(ENEMIES[enemyId].tier === "boss", `boss encounter ${encounter.id} should not contain non-boss ${enemyId}`);
    }
  }
}
for (const enemy of Object.values(ENEMIES)) {
  assert(enemy.maxHp[0] > 0 && enemy.maxHp[1] >= enemy.maxHp[0], `${enemy.id} should have a valid hp range`);
  assert(enemy.moves.length > 0, `${enemy.id} should define at least one move`);
  for (const move of enemy.moves) {
    assert(move.weight > 0, `${enemy.id}.${move.id} should have a positive move weight`);
    for (const effect of move.effects) {
      if (effect.type === "summon") {
        assert(ENEMIES[effect.enemyId], `${enemy.id}.${move.id} should summon existing enemy ${effect.enemyId}`);
      }
      if (effect.type === "createCard") {
        assert(CARDS[effect.cardId], `${enemy.id}.${move.id} should create existing card ${effect.cardId}`);
      }
    }
  }
}

const storage = new MemoryStorage();
const savedMapRun = createInitialRun(4242, "map", "hard");
assert(savedMapRun.act === 1, "new runs should start in act 1");
assert(saveRun(savedMapRun, storage), "active map run should be saved");
assert(storage.getItem(ACTIVE_RUN_SAVE_KEY), "saved run should exist in storage");
assert(loadSavedRun(storage)?.runId === savedMapRun.runId, "saved run should load with the same id");
const legacySavedRun: Partial<RunState> = { ...savedMapRun };
delete legacySavedRun.act;
storage.setItem(ACTIVE_RUN_SAVE_KEY, JSON.stringify(legacySavedRun));
assert(loadSavedRun(storage)?.act === 1, "legacy saves without act should be migrated to act 1");
storage.setItem(ACTIVE_RUN_SAVE_KEY, JSON.stringify({ ...savedMapRun, difficulty: "toString" }));
assert(loadSavedRun(storage)?.difficulty === "standard", "legacy saves with invalid difficulty should fall back to standard");

const legacyPlayer = { ...savedMapRun.player } as Partial<RunState["player"]>;
delete legacyPlayer.boons;
delete legacyPlayer.potions;
delete legacyPlayer.potionSlots;
const legacyCombatRun: Partial<RunState> = {
  ...savedMapRun,
  phase: "combat",
  player: legacyPlayer as RunState["player"],
  stats: { fights: 1 } as RunState["stats"],
  combat: {
    nodeType: "fight",
    encounterName: "旧遭遇",
    enemies: [
      {
        uid: "",
        defId: "acid_slime",
        name: "",
        maxHp: Number.NaN,
        hp: 999,
        block: -2,
        powers: { strength: 1, missing_power: 4 } as NonNullable<RunState["combat"]>["playerPowers"],
        intent: {
          id: "missing_move",
          name: "",
          intent: "broken",
          weight: -1,
          effects: [{ type: "applyPower", power: "missing_power", amount: 2, target: "player" }],
        } as unknown as NonNullable<RunState["combat"]>["enemies"][number]["intent"],
        moveIndex: -5,
        lastMoveId: "missing_move",
      },
      {
        uid: "bad-enemy",
        defId: "missing_enemy",
        name: "坏敌人",
        maxHp: 10,
        hp: 10,
        block: 0,
        powers: {},
        intent: ENEMIES.acid_slime.moves[0],
        moveIndex: 0,
      },
    ] as NonNullable<RunState["combat"]>["enemies"],
    drawPile: [],
    hand: [],
    discardPile: [],
    energy: 1,
    maxEnergy: 3,
    turn: 2,
    playerBlock: 0,
    playerPowers: { strength: 2, missing_power: 9 } as NonNullable<RunState["combat"]>["playerPowers"],
    cardsPlayedThisTurn: 1,
  } as NonNullable<RunState["combat"]>,
};
storage.setItem(ACTIVE_RUN_SAVE_KEY, JSON.stringify(legacyCombatRun));
const migratedCombatRun = loadSavedRun(storage);
const migratedLegacyEnemy = migratedCombatRun?.combat?.enemies[0];
assert(migratedCombatRun?.player.potionSlots === 3, "legacy saves should restore missing potion slots");
assert(Array.isArray(migratedCombatRun?.player.boons), "legacy saves should restore missing boons");
assert(Array.isArray(migratedCombatRun?.player.potions), "legacy saves should restore missing potions");
assert(migratedCombatRun?.stats.damageDealt === 0, "legacy saves should restore missing stat fields");
assert(Array.isArray(migratedCombatRun?.combat?.exhaustPile), "legacy combat saves should restore exhaust pile");
assert(migratedCombatRun?.combat?.cardsPlayedLastTurn === 0, "legacy combat saves should restore last-turn card count");
assert(migratedCombatRun?.combat?.attacksPlayedThisTurn === 0, "legacy combat saves should restore turn attack count");
assert(Array.isArray(migratedCombatRun?.combat?.log), "legacy combat saves should restore log");
assert(migratedCombatRun?.combat?.playerPowers.strength === 2, "legacy combat saves should preserve valid powers");
assert(!("missing_power" in (migratedCombatRun?.combat?.playerPowers ?? {})), "legacy combat saves should drop invalid powers");
assert(migratedCombatRun?.combat?.enemies.length === 1, "legacy combat saves should drop invalid enemies");
assert(migratedLegacyEnemy?.uid.startsWith("legacy-enemy"), "legacy combat saves should repair missing enemy uid");
assert(migratedLegacyEnemy?.name === ENEMIES.acid_slime.name, "legacy combat saves should restore enemy name");
assert(migratedLegacyEnemy?.maxHp === ENEMIES.acid_slime.maxHp[1], "legacy combat saves should restore invalid max hp");
assert(migratedLegacyEnemy?.hp === migratedLegacyEnemy?.maxHp, "legacy combat saves should clamp enemy hp");
assert(migratedLegacyEnemy?.block === 0, "legacy combat saves should clamp enemy block");
assert(migratedLegacyEnemy?.powers.strength === 1, "legacy combat saves should preserve valid enemy powers");
assert(!("missing_power" in (migratedLegacyEnemy?.powers ?? {})), "legacy combat saves should drop invalid enemy powers");
assert(migratedLegacyEnemy?.intent.id === ENEMIES.acid_slime.moves[0].id, "legacy combat saves should restore invalid enemy intent");
assert(migratedLegacyEnemy?.moveIndex === 0, "legacy combat saves should clamp enemy move index");
assert(migratedLegacyEnemy?.lastMoveId === undefined, "legacy combat saves should clear invalid last enemy move");

const legacyBottleRackPlayer = { ...savedMapRun.player, boons: ["bottle_rack"] } as Partial<RunState["player"]>;
delete legacyBottleRackPlayer.potionSlots;
storage.setItem(
  ACTIVE_RUN_SAVE_KEY,
  JSON.stringify({
    ...savedMapRun,
    player: legacyBottleRackPlayer,
  }),
);
assert(loadSavedRun(storage)?.player.potionSlots === 4, "legacy bottle rack saves should keep the extra potion slot");

storage.setItem(
  ACTIVE_RUN_SAVE_KEY,
  JSON.stringify({
    ...savedMapRun,
    player: { ...savedMapRun.player, potionSlots: 99 },
  }),
);
assert(loadSavedRun(storage)?.player.potionSlots === 5, "legacy saves should clamp excessive potion slots");

storage.setItem(
  ACTIVE_RUN_SAVE_KEY,
  JSON.stringify({
    ...savedMapRun,
    player: {
      ...savedMapRun.player,
      potionSlots: 7,
      potions: [
        makePotionInstance("fire_potion"),
        makePotionInstance("block_potion"),
        makePotionInstance("energy_potion"),
        makePotionInstance("poison_potion"),
        makePotionInstance("bleed_potion"),
        makePotionInstance("mark_potion"),
      ],
    },
  }),
);
const migratedPotionOverflowRun = loadSavedRun(storage);
assert(migratedPotionOverflowRun?.player.potions.length === 5, "legacy saves should trim excessive potions");
assert(migratedPotionOverflowRun?.player.potionSlots === 5, "legacy saves should keep potion slots at cap after trimming");

const invalidResourceRun: Partial<RunState> = {
  ...savedMapRun,
  player: {
    ...savedMapRun.player,
    deck: [
      { uid: "", cardId: "strike", upgraded: false },
      { uid: "bad-card", cardId: "missing_card", upgraded: false },
    ],
    relics: ["ember_core", "missing_relic", "ember_core"],
    boons: ["opening_guard", "missing_boon", "opening_guard"] as RunState["player"]["boons"],
    potions: [
      { uid: "", potionId: "fire_potion" },
      { uid: "bad-potion", potionId: "missing_potion" },
    ],
  },
  reward: {
    nodeType: "fight",
    title: "坏奖励",
    gold: 0,
    cards: [{ cardId: "missing_card", upgraded: false }, { cardId: "defend", upgraded: true }],
    relicId: "missing_relic",
    potionId: "missing_potion",
    boons: [{ boonId: "missing_boon" as RunState["player"]["boons"][number] }, { boonId: "opening_guard" }],
  },
  shop: {
    cards: [{ cardId: "missing_card", upgraded: false, price: 1 }, { cardId: "strike", upgraded: false, price: 1 }],
    relics: [{ relicId: "missing_relic", price: 1 }, { relicId: "anchor", price: 1 }],
    potions: [{ potionId: "missing_potion", price: 1 }, { potionId: "fire_potion", price: 1 }],
    boons: [{ boonId: "missing_boon" as RunState["player"]["boons"][number], price: 1 }, { boonId: "opening_guard", price: 1 }],
    healPrice: 45,
    removePrice: 75,
    restockPrice: 55,
  },
};
storage.setItem(ACTIVE_RUN_SAVE_KEY, JSON.stringify(invalidResourceRun));
const migratedInvalidResourceRun = loadSavedRun(storage);
assert(migratedInvalidResourceRun?.player.deck.length === 1, "invalid saved cards should be filtered");
assert(migratedInvalidResourceRun?.player.deck[0].uid.startsWith("legacy-card"), "missing card uid should be repaired");
assert(migratedInvalidResourceRun?.player.relics.length === 1, "invalid or duplicate relics should be filtered");
assert(migratedInvalidResourceRun?.player.boons.length === 1, "invalid or duplicate boons should be filtered");
assert(migratedInvalidResourceRun?.player.potions.length === 1, "invalid saved potions should be filtered");
assert(migratedInvalidResourceRun?.player.potions[0].uid.startsWith("legacy-potion"), "missing potion uid should be repaired");
assert(migratedInvalidResourceRun?.reward?.cards.length === 1, "invalid reward card offers should be filtered");
assert(migratedInvalidResourceRun?.reward?.relicId === undefined, "invalid reward relic should be cleared");
assert(migratedInvalidResourceRun?.reward?.potionId === undefined, "invalid reward potion should be cleared");
assert(migratedInvalidResourceRun?.reward?.boons?.length === 1, "invalid reward boons should be filtered");
assert(migratedInvalidResourceRun?.shop?.cards.length === 1, "invalid shop cards should be filtered");
assert(migratedInvalidResourceRun?.shop?.relics.length === 1, "invalid shop relics should be filtered");
assert(migratedInvalidResourceRun?.shop?.potions.length === 1, "invalid shop potions should be filtered");
assert(migratedInvalidResourceRun?.shop?.boons.length === 1, "invalid shop boons should be filtered");

const legacyRewardRun: Partial<RunState> = {
  ...savedMapRun,
  phase: "reward",
  reward: {
    nodeType: "fight",
    title: "旧奖励",
    gold: 5,
    cards: [],
  } as RunState["reward"],
};
storage.setItem(ACTIVE_RUN_SAVE_KEY, JSON.stringify(legacyRewardRun));
const migratedRewardRun = loadSavedRun(storage);
assert(Array.isArray(migratedRewardRun?.reward?.boons), "legacy reward saves should restore boon offers");
assert(migratedRewardRun?.reward?.rerollPrice === 24, "legacy reward saves should restore reroll price");

const missingStateRun: Partial<RunState> = {
  ...savedMapRun,
  phase: "combat",
  combat: undefined,
};
storage.setItem(ACTIVE_RUN_SAVE_KEY, JSON.stringify(missingStateRun));
assert(loadSavedRun(storage)?.phase === "map", "legacy saves missing phase state should fall back to map");

const staleCurrentRun = createInitialRun(4243, "map", "standard");
const staleCompletedNode = staleCurrentRun.map.find((node) => node.floor === 0)!;
staleCompletedNode.completed = true;
staleCurrentRun.currentNodeId = staleCompletedNode.children[0];
storage.setItem(ACTIVE_RUN_SAVE_KEY, JSON.stringify(staleCurrentRun));
const migratedStaleCurrentRun = loadSavedRun(storage);
assert(migratedStaleCurrentRun?.currentNodeId === staleCompletedNode.id, "map saves pointing at an unfinished node should recover the last completed route tip");
assert(
  getAvailableNodeIds(migratedStaleCurrentRun!).includes(staleCompletedNode.children[0]),
  "recovered stale map saves should still expose the intended next node",
);

storage.setItem(
  ACTIVE_RUN_SAVE_KEY,
  JSON.stringify({
    ...legacyCombatRun,
    combat: { ...legacyCombatRun.combat, enemies: [] },
  }),
);
const migratedEmptyCombatRun = loadSavedRun(storage);
assert(migratedEmptyCombatRun?.phase === "map", "legacy combat saves without enemies should fall back to map");
assert(migratedEmptyCombatRun?.combat === undefined, "legacy combat saves without enemies should clear combat state");

storage.setItem(
  ACTIVE_RUN_SAVE_KEY,
  JSON.stringify({
    ...legacyCombatRun,
    combat: {
      ...legacyCombatRun.combat,
      enemies: [{ ...legacyCombatRun.combat?.enemies?.[0], hp: 0 }],
    },
  }),
);
assert(loadSavedRun(storage)?.phase === "map", "legacy combat saves with defeated enemies should fall back to map");

storage.setItem(ACTIVE_RUN_SAVE_KEY, JSON.stringify({ ...savedMapRun, phase: "unknown_phase" }));
assert(loadSavedRun(storage) === undefined, "saves with unknown phases should not be loadable");
assert(storage.getItem(ACTIVE_RUN_SAVE_KEY) === null, "saves with unknown phases should be cleared");
storage.setItem(
  ACTIVE_RUN_SAVE_KEY,
  JSON.stringify({
    ...savedMapRun,
    map: [{ id: "bad-node", floor: 0, lane: 1, x: 0, y: 0, type: "missing_type", children: ["ghost"] }],
  }),
);
assert(loadSavedRun(storage) === undefined, "saves without a valid map node should not be loadable");
assert(storage.getItem(ACTIVE_RUN_SAVE_KEY) === null, "saves with invalid map shape should be cleared");
storage.setItem(
  ACTIVE_RUN_SAVE_KEY,
  JSON.stringify({
    ...savedMapRun,
    map: savedMapRun.map.filter((node) => node.type !== "boss"),
  }),
);
assert(loadSavedRun(storage) === undefined, "saves without a boss node should not be loadable");
storage.setItem(
  ACTIVE_RUN_SAVE_KEY,
  JSON.stringify({
    ...savedMapRun,
    map: savedMapRun.map.map((node) => (node.floor === 0 ? { ...node, children: [] } : node)),
  }),
);
assert(loadSavedRun(storage) === undefined, "saves without a route from start to boss should not be loadable");

const legacyShopRun: Partial<RunState> = {
  ...savedMapRun,
  phase: "shop",
  shop: {
    cards: [],
    relics: [],
    potions: [],
    healPrice: 45,
    removePrice: 75,
  } as RunState["shop"],
};
storage.setItem(ACTIVE_RUN_SAVE_KEY, JSON.stringify(legacyShopRun));
const migratedShopRun = loadSavedRun(storage);
assert(migratedShopRun?.shop?.restockPrice === 54, "legacy shop saves should get a restock price");
assert(Array.isArray(migratedShopRun?.shop?.boons), "legacy shop saves should restore boon shelf");

const legacyEventRun: Partial<RunState> = {
  ...savedMapRun,
  phase: "event",
  event: {
    id: "blood_shrine",
    title: "",
    text: 42,
    options: [
      { id: "", label: "坏选项", text: "" },
      { id: "go", label: "", text: 7, disabled: 1, disabledReason: 9 },
    ],
  } as unknown as RunState["event"],
};
storage.setItem(ACTIVE_RUN_SAVE_KEY, JSON.stringify(legacyEventRun));
const migratedEventRun = loadSavedRun(storage);
assert(migratedEventRun?.event?.title === "事件", "legacy event saves should restore missing title");
assert(migratedEventRun?.event?.text === "", "legacy event saves should restore invalid text");
assert(migratedEventRun?.event?.options.length === 1, "legacy event saves should drop invalid event options");
assert(migratedEventRun?.event?.options[0].label === "选择", "legacy event saves should restore missing option label");
assert(migratedEventRun?.event?.options[0].disabled === true, "legacy event saves should normalize disabled flag");
assert(migratedEventRun?.event?.options[0].disabledReason === undefined, "legacy event saves should clear invalid disabled reason");

const unknownEventRun: Partial<RunState> = {
  ...savedMapRun,
  phase: "event",
  event: {
    id: "legacy_event",
    title: "旧事件",
    text: "",
    options: [{ id: "go", label: "走", text: "" }],
  } as RunState["event"],
};
storage.setItem(ACTIVE_RUN_SAVE_KEY, JSON.stringify(unknownEventRun));
const migratedUnknownEventRun = loadSavedRun(storage);
assert(migratedUnknownEventRun?.phase === "map", "unknown legacy event saves should return to map");
assert(migratedUnknownEventRun?.event === undefined, "unknown legacy event saves should clear event state");

const titleRun = createInitialRun(4243, "title", "standard");
assert(!saveRun(titleRun, storage), "title run should not overwrite an active save");
assert(loadSavedRun(storage)?.runId === savedMapRun.runId, "title phase should leave the active save readable");
storage.setItem(ACTIVE_RUN_SAVE_KEY, JSON.stringify({ ...savedMapRun, phase: "victory" }));
assert(loadSavedRun(storage) === undefined, "victory save should not be loadable");
assert(storage.getItem(ACTIVE_RUN_SAVE_KEY) === null, "invalid or completed save should be cleared");
assert(saveRun(savedMapRun, storage), "active run should save again after clearing");
assert(clearSavedRun(storage), "manual clear should report success");
assert(storage.getItem(ACTIVE_RUN_SAVE_KEY) === null, "manual clear should remove the saved run");

let run = createInitialRun(12345, "map", "standard");
assert(run.player.hp === 82, "standard difficulty should set starting hp");
assert(run.player.potionSlots === 3, "player should start with 3 potion slots");

run = enterNode(run, getAvailableNodeIds(run)[0]);
assert(run.phase === "combat", "entering first node should start combat");
assert(run.combat?.hand.length === 5, "combat should draw opening hand");
assert(run.combat.energy === 4, "starter relic should grant first-turn energy");

let relicTriggerRun = createInitialRun(12346, "map", "standard");
relicTriggerRun.player.relics.push("whetstone", "threaded_needle", "toxic_vial", "fracture_lens", "echo_bell", "charged_plate", "storm_needle");
relicTriggerRun = enterNode(relicTriggerRun, getAvailableNodeIds(relicTriggerRun)[0]);
assert((relicTriggerRun.combat!.playerPowers.strength ?? 0) >= 1, "whetstone should grant starting strength");
assert((relicTriggerRun.combat!.playerPowers.platedArmor ?? 0) >= 2, "threaded needle and storm needle should grant plated armor");
assert((relicTriggerRun.combat!.playerPowers.charge ?? 0) >= 2, "charged plate should grant starting charge");
assert(relicTriggerRun.combat!.playerBlock >= 1, "threaded needle plated armor should block on turn start");
assert(
  relicTriggerRun.combat!.enemies.every((enemy) => enemy.hp <= 0 || (enemy.powers.poison ?? 0) >= 1),
  "toxic vial should seed poison on enemies",
);
assert(
  relicTriggerRun.combat!.enemies.every((enemy) => enemy.hp <= 0 || (enemy.powers.mark ?? 0) >= 2),
  "fracture lens should seed mark on enemies",
);
assert(
  relicTriggerRun.combat!.enemies.every((enemy) => enemy.hp <= 0 || (enemy.powers.spark ?? 0) >= 1),
  "storm needle should seed spark on enemies",
);
assert(
  relicTriggerRun.combat!.hand.some((card) => card.cardId === "memory_hook" && card.upgraded),
  "echo bell should put memory hook+ into opening hand",
);

let invalidCardCombatRun = createInitialRun(12349, "map", "standard");
invalidCardCombatRun = enterNode(invalidCardCombatRun, getAvailableNodeIds(invalidCardCombatRun)[0]);
const invalidCombatCard = makeCardInstance("missing_card");
invalidCardCombatRun.combat!.hand = [invalidCombatCard];
invalidCardCombatRun.combat!.energy = 3;
assert(!canPlayCard(invalidCardCombatRun, invalidCombatCard), "missing combat cards should not be playable");
invalidCardCombatRun = playCard(invalidCardCombatRun, invalidCombatCard.uid);
assert(invalidCardCombatRun.phase === "combat", "playing a missing combat card should keep combat stable");
assert(invalidCardCombatRun.message?.includes("不能打出"), "playing a missing combat card should explain it is unplayable");
invalidCardCombatRun = endTurn(invalidCardCombatRun);
assert(invalidCardCombatRun.phase === "combat", "ending a turn with a missing combat card should not crash");

let illegalCardTargetRun = createInitialRun(12350, "map", "standard");
illegalCardTargetRun = enterNode(illegalCardTargetRun, getAvailableNodeIds(illegalCardTargetRun)[0]);
const illegalDefend = makeCardInstance("defend");
illegalCardTargetRun.combat!.hand = [illegalDefend];
illegalCardTargetRun.combat!.energy = 3;
const illegalCardEnemyUid = livingEnemyUid(illegalCardTargetRun);
const illegalCardBlockBefore = illegalCardTargetRun.combat!.playerBlock;
illegalCardTargetRun = playCard(illegalCardTargetRun, illegalDefend.uid, illegalCardEnemyUid);
assert(illegalCardTargetRun.combat!.playerBlock === illegalCardBlockBefore, "self cards should not resolve when an enemy target is forced");
assert(illegalCardTargetRun.combat!.hand.some((card) => card.uid === illegalDefend.uid), "rejected self card should stay in hand");
assert(illegalCardTargetRun.message?.includes("不需要选择敌人目标"), "rejected self card should explain the target rule");

let illegalPotionTargetRun = createInitialRun(12351, "map", "standard");
illegalPotionTargetRun = enterNode(illegalPotionTargetRun, getAvailableNodeIds(illegalPotionTargetRun)[0]);
illegalPotionTargetRun.player.potions = [makePotionInstance("energy_potion")];
const illegalPotion = illegalPotionTargetRun.player.potions[0];
const illegalPotionEnemyUid = livingEnemyUid(illegalPotionTargetRun);
illegalPotionTargetRun = usePotion(illegalPotionTargetRun, illegalPotion.uid, illegalPotionEnemyUid);
assert(illegalPotionTargetRun.player.potions.length === 1, "self potions should not be consumed when an enemy target is forced");
assert(illegalPotionTargetRun.message?.includes("不需要选择敌人目标"), "rejected self potion should explain the target rule");

const strike = firstPlayableCard(run, "strike");
run = playCard(run, strike.uid, livingEnemyUid(run));
assert(run.phase === "combat", "playing strike should stay in combat unless fight ends");
assert(run.stats.cardsPlayed === 1, "card play stat should increment");

let damageStatRun = createInitialRun(12347, "map", "standard");
damageStatRun = enterNode(damageStatRun, getAvailableNodeIds(damageStatRun)[0]);
for (const enemy of damageStatRun.combat!.enemies.slice(1)) {
  enemy.hp = 0;
}
const lowHpEnemy = damageStatRun.combat!.enemies[0];
lowHpEnemy.hp = 1;
lowHpEnemy.block = 0;
const damageStatBefore = damageStatRun.stats.damageDealt;
const statStrike = makeCardInstance("strike", true);
damageStatRun.combat!.hand = [statStrike];
damageStatRun.combat!.energy = 3;
damageStatRun = playCard(damageStatRun, statStrike.uid, lowHpEnemy.uid);
assert(damageStatRun.stats.damageDealt - damageStatBefore === 1, "damage stats should count actual enemy hp loss only");

run.player.potions.push(makePotionInstance("fire_potion"));
const potion = run.player.potions[0];
run = usePotion(run, potion.uid, livingEnemyUid(run));
assert(run.player.potions.length === 0, "using potion should consume it");

let combatDiscardRun = createInitialRun(12348, "map", "standard");
combatDiscardRun = enterNode(combatDiscardRun, getAvailableNodeIds(combatDiscardRun)[0]);
combatDiscardRun.player.potions.push(makePotionInstance("energy_potion"));
const combatDiscardUid = combatDiscardRun.player.potions[0].uid;
combatDiscardRun = discardPotion(combatDiscardRun, combatDiscardUid);
assert(combatDiscardRun.player.potions.length === 1, "discard potion should be disabled during combat");

let potionRun = createInitialRun(24680, "map", "standard");
potionRun = enterNode(potionRun, getAvailableNodeIds(potionRun)[0]);
const potionTarget = potionRun.combat!.enemies.find((item) => item.hp > 0)!;
potionTarget.hp = 100;
potionTarget.maxHp = 100;
potionTarget.powers.vulnerable = 3;
potionTarget.powers.thorns = 50;
potionRun.combat!.playerPowers.strength = 99;
potionRun.player.potions.push(makePotionInstance("fire_potion"));
const fixedPotionHp = potionRun.player.hp;
potionRun = usePotion(potionRun, potionRun.player.potions[0].uid, potionTarget.uid);
assert(potionRun.combat!.enemies[0].hp === 80, "fire potion should deal fixed direct damage");
assert(potionRun.player.hp === fixedPotionHp, "potion damage should not trigger enemy thorns");

let missingPotionRun = createInitialRun(24681, "map", "standard");
missingPotionRun = enterNode(missingPotionRun, getAvailableNodeIds(missingPotionRun)[0]);
missingPotionRun.player.potions.push(makePotionInstance("missing_potion"));
missingPotionRun = usePotion(missingPotionRun, missingPotionRun.player.potions[0].uid);
assert(missingPotionRun.phase === "combat", "missing potion use should stay in combat");
assert(!missingPotionRun.player.potions.some((item) => item.potionId === "missing_potion"), "missing potion should be discarded safely");
assert(missingPotionRun.message?.includes("失效"), "missing potion should explain stale potion");

run.combat!.hand.push(makeCardInstance("burn"));
run = endTurn(run);
assert(run.player.hp < run.player.maxHp, "burn should damage player at end of turn");

let exhaustRun = createInitialRun(13579, "map", "standard");
exhaustRun = enterNode(exhaustRun, getAvailableNodeIds(exhaustRun)[0]);
const slimed = makeCardInstance("slimed");
exhaustRun.combat!.hand = [slimed];
exhaustRun = endTurn(exhaustRun);
assert(
  exhaustRun.combat!.discardPile.some((card) => card.uid === slimed.uid),
  "unplayed exhaust cards should discard at end of turn",
);
assert(
  !exhaustRun.combat!.exhaustPile.some((card) => card.uid === slimed.uid),
  "unplayed exhaust cards should not auto-exhaust",
);

let retainRun = createInitialRun(13580, "map", "standard");
retainRun = enterNode(retainRun, getAvailableNodeIds(retainRun)[0]);
for (const enemy of retainRun.combat!.enemies) {
  enemy.intent = { id: "wait", name: "等待", intent: "unknown", weight: 1, effects: [] };
}
const holdGuard = makeCardInstance("hold_guard");
retainRun.combat!.hand = [holdGuard];
retainRun = endTurn(retainRun);
assert(retainRun.combat!.hand.some((card) => card.uid === holdGuard.uid), "retain cards should stay in hand at end turn");

let etherealRun = createInitialRun(13581, "map", "standard");
etherealRun = enterNode(etherealRun, getAvailableNodeIds(etherealRun)[0]);
for (const enemy of etherealRun.combat!.enemies) {
  enemy.intent = { id: "wait", name: "等待", intent: "unknown", weight: 1, effects: [] };
}
const dazed = makeCardInstance("dazed");
etherealRun.combat!.hand = [dazed];
etherealRun = endTurn(etherealRun);
assert(etherealRun.combat!.exhaustPile.some((card) => card.uid === dazed.uid), "ethereal cards should exhaust at end turn");

let handLimitRun = createInitialRun(97531, "map", "standard");
handLimitRun = enterNode(handLimitRun, getAvailableNodeIds(handLimitRun)[0]);
const drawCard = makeCardInstance("battle_trance");
handLimitRun.combat!.hand = [
  drawCard,
  makeCardInstance("defend"),
  makeCardInstance("defend"),
  makeCardInstance("defend"),
  makeCardInstance("defend"),
  makeCardInstance("defend"),
  makeCardInstance("defend"),
  makeCardInstance("defend"),
  makeCardInstance("defend"),
  makeCardInstance("defend"),
];
handLimitRun.combat!.drawPile = [makeCardInstance("strike"), makeCardInstance("strike"), makeCardInstance("strike")];
handLimitRun = playCard(handLimitRun, drawCard.uid);
assert(handLimitRun.combat!.hand.length === 10, "hand size should cap at 10 after drawing");
assert(handLimitRun.combat!.discardPile.length === 2, "overflow draws should go to discard pile");

let createLimitRun = createInitialRun(97533, "map", "standard");
createLimitRun = enterNode(createLimitRun, getAvailableNodeIds(createLimitRun)[0]);
for (const enemy of createLimitRun.combat!.enemies.slice(1)) {
  enemy.hp = 0;
}
createLimitRun.combat!.hand = Array.from({ length: 10 }, () => makeCardInstance("hold_guard"));
createLimitRun.combat!.drawPile = [];
createLimitRun.combat!.discardPile = [];
createLimitRun.combat!.enemies[0].intent = {
  id: "stuff_hand",
  name: "塞牌",
  intent: "debuff",
  weight: 1,
  effects: [{ type: "createCard", cardId: "defend", destination: "hand", upgraded: true }],
};
createLimitRun = endTurn(createLimitRun);
assert(createLimitRun.combat!.hand.length === 10, "created cards should respect max hand size");
assert(
  createLimitRun.combat!.discardPile.some((card) => card.cardId === "defend" && card.upgraded),
  "created cards should go to discard when hand is full",
);

let poisonStatRun = createInitialRun(97532, "map", "standard");
poisonStatRun = enterNode(poisonStatRun, getAvailableNodeIds(poisonStatRun)[0]);
for (const enemy of poisonStatRun.combat!.enemies.slice(1)) {
  enemy.hp = 0;
}
const poisonedEnemy = poisonStatRun.combat!.enemies[0];
poisonedEnemy.hp = 1;
poisonedEnemy.powers.poison = 5;
poisonedEnemy.intent = { id: "wait", name: "等待", intent: "defend", weight: 1, effects: [] };
poisonStatRun.combat!.hand = [];
poisonStatRun.combat!.drawPile = [];
poisonStatRun.combat!.discardPile = [];
const poisonDamageBefore = poisonStatRun.stats.damageDealt;
poisonStatRun = endTurn(poisonStatRun);
assert(poisonStatRun.stats.damageDealt - poisonDamageBefore === 1, "poison stats should count actual enemy hp loss only");

let recoverRun = createInitialRun(13583, "map", "standard");
recoverRun = enterNode(recoverRun, getAvailableNodeIds(recoverRun)[0]);
const salvage = makeCardInstance("salvage", true);
const recoverStrike = makeCardInstance("strike");
const recoverBurn = makeCardInstance("burn");
const recoverDefend = makeCardInstance("defend");
recoverRun.combat!.hand = [salvage];
recoverRun.combat!.discardPile = [recoverStrike, recoverBurn, recoverDefend];
recoverRun.combat!.energy = 3;
recoverRun = playCard(recoverRun, salvage.uid);
assert(recoverRun.combat!.playerBlock >= 8, "salvage+ should grant block");
assert(recoverRun.combat!.hand.some((card) => card.uid === recoverDefend.uid), "salvage+ should recover a non-status card");
assert(recoverRun.combat!.hand.some((card) => card.uid === recoverStrike.uid), "salvage+ should recover up to two non-status cards");
assert(recoverRun.combat!.discardPile.some((card) => card.uid === recoverBurn.uid), "salvage+ should not recover status cards");

let hookRun = createInitialRun(13584, "map", "standard");
hookRun = enterNode(hookRun, getAvailableNodeIds(hookRun)[0]);
const memoryHook = makeCardInstance("memory_hook", true);
const hookStrike = makeCardInstance("strike");
hookRun.combat!.hand = [memoryHook];
hookRun.combat!.discardPile = [makeCardInstance("defend"), hookStrike];
hookRun.combat!.energy = 3;
hookRun = playCard(hookRun, memoryHook.uid);
assert(hookRun.combat!.hand.some((card) => card.uid === hookStrike.uid), "memory hook should recover an attack card");
assert((hookRun.combat!.playerPowers.combo ?? 0) >= 2, "memory hook+ should grant combo");

let newCardRun = createInitialRun(13585, "map", "standard");
newCardRun = enterNode(newCardRun, getAvailableNodeIds(newCardRun)[0]);
for (const enemy of newCardRun.combat!.enemies.slice(1)) {
  enemy.hp = 0;
}
const newCardEnemy = newCardRun.combat!.enemies[0];
newCardEnemy.hp = 220;
newCardEnemy.maxHp = 220;
const fractureThrust = makeCardInstance("fracture_thrust", true);
const venomCut = makeCardInstance("venom_cut", true);
const bulwarkEngine = makeCardInstance("bulwark_engine", true);
const shieldRecall = makeCardInstance("shield_recall", true);
const chargeShield = makeCardInstance("charge_shield", true);
const ruptureFinish = makeCardInstance("rupture_finish", true);
const venomBattery = makeCardInstance("venom_battery", true);
const recallSkill = makeCardInstance("defend");
newCardRun.combat!.hand = [fractureThrust, venomCut, bulwarkEngine, chargeShield, venomBattery, ruptureFinish, shieldRecall];
newCardRun.combat!.discardPile = [recallSkill];
newCardRun.combat!.energy = 12;
newCardRun = playCard(newCardRun, fractureThrust.uid, newCardEnemy.uid);
assert((newCardRun.combat!.enemies[0].powers.mark ?? 0) >= 3, "fracture thrust+ should apply mark");
newCardRun = playCard(newCardRun, venomCut.uid, newCardEnemy.uid);
assert((newCardRun.combat!.enemies[0].powers.poison ?? 0) >= 3, "venom cut+ should apply poison");
assert((newCardRun.combat!.enemies[0].powers.bleed ?? 0) >= 2, "venom cut+ should apply bleed");
newCardRun = playCard(newCardRun, bulwarkEngine.uid);
assert((newCardRun.combat!.playerPowers.platedArmor ?? 0) >= 3, "bulwark engine+ should grant plated armor");
assert((newCardRun.combat!.playerPowers.charge ?? 0) >= 3, "bulwark engine+ should grant charge");
const chargeShieldBlockBefore = newCardRun.combat!.playerBlock;
newCardRun = playCard(newCardRun, chargeShield.uid);
assert(newCardRun.combat!.playerBlock >= chargeShieldBlockBefore + 13, "charge shield+ should turn charge into block");
assert((newCardRun.combat!.playerPowers.charge ?? 0) <= 1, "charge shield+ should spend charge stacks");
newCardRun = playCard(newCardRun, venomBattery.uid);
assert((newCardRun.combat!.playerPowers.charge ?? 0) >= 3, "venom battery+ should grant charge");
assert((newCardRun.combat!.enemies[0].powers.poison ?? 0) >= 6, "venom battery+ should stack poison");
assert((newCardRun.combat!.enemies[0].powers.spark ?? 0) >= 2, "venom battery+ should stack spark");
const ruptureHpBefore = newCardRun.combat!.enemies[0].hp;
newCardRun = playCard(newCardRun, ruptureFinish.uid, newCardEnemy.uid);
assert(newCardRun.combat!.enemies[0].hp < ruptureHpBefore, "rupture finish+ should spend combo for damage");
assert(!newCardRun.combat!.playerPowers.combo, "rupture finish+ should consume combo");
newCardRun = playCard(newCardRun, shieldRecall.uid);
assert(newCardRun.combat!.hand.some((card) => card.uid === recallSkill.uid), "shield recall+ should recover a skill card");

let amplifyRun = createInitialRun(13586, "map", "standard");
amplifyRun = enterNode(amplifyRun, getAvailableNodeIds(amplifyRun)[0]);
if (amplifyRun.combat!.enemies.length < 2) {
  amplifyRun.combat!.enemies.push({
    ...amplifyRun.combat!.enemies[0],
    uid: "amplify-test-enemy",
    hp: 100,
    maxHp: 100,
    block: 0,
    powers: {},
  });
}
for (const enemy of amplifyRun.combat!.enemies.slice(2)) {
  enemy.hp = 0;
}
const amplifyTarget = amplifyRun.combat!.enemies[0];
const amplifyOther = amplifyRun.combat!.enemies[1];
amplifyTarget.hp = 100;
amplifyTarget.maxHp = 100;
amplifyTarget.powers.poison = 3;
amplifyTarget.powers.bleed = 4;
amplifyTarget.powers.mark = 2;
amplifyTarget.powers.spark = 2;
amplifyOther.hp = 100;
amplifyOther.maxHp = 100;
amplifyOther.powers.spark = 0;
const faultResonance = makeCardInstance("fault_resonance");
const bloodCatalyst = makeCardInstance("blood_catalyst");
const sparkCascade = makeCardInstance("spark_cascade");
amplifyRun.combat!.hand = [faultResonance, bloodCatalyst, sparkCascade];
amplifyRun.combat!.energy = 5;
amplifyRun = playCard(amplifyRun, faultResonance.uid, amplifyTarget.uid);
assert(amplifyRun.combat!.enemies[0].powers.mark === 8, "fault resonance should apply then amplify mark");
amplifyRun = playCard(amplifyRun, bloodCatalyst.uid, amplifyTarget.uid);
assert(amplifyRun.combat!.enemies[0].powers.poison === 6, "blood catalyst should amplify poison");
assert(amplifyRun.combat!.enemies[0].powers.bleed === 8, "blood catalyst should amplify bleed");
assert(amplifyRun.combat!.exhaustPile.some((card) => card.uid === bloodCatalyst.uid), "blood catalyst should exhaust after use");
amplifyRun = playCard(amplifyRun, sparkCascade.uid);
assert(amplifyRun.combat!.enemies[0].powers.spark === 2, "spark cascade should amplify spark after its attack trigger");
assert(amplifyRun.combat!.enemies[1].powers.spark === 1, "spark cascade should seed spark through minimum amplification");

let catalystVialRun = createInitialRun(13587, "map", "standard");
catalystVialRun = enterNode(catalystVialRun, getAvailableNodeIds(catalystVialRun)[0]);
for (const enemy of catalystVialRun.combat!.enemies.slice(1)) {
  enemy.hp = 0;
}
const catalystVialTarget = catalystVialRun.combat!.enemies[0];
catalystVialTarget.hp = 100;
catalystVialTarget.maxHp = 100;
catalystVialTarget.powers.poison = 2;
catalystVialTarget.powers.mark = 3;
catalystVialRun.player.potions.push(makePotionInstance("catalyst_potion"));
catalystVialRun = usePotion(catalystVialRun, catalystVialRun.player.potions[0].uid, catalystVialTarget.uid);
assert(catalystVialRun.combat!.enemies[0].powers.poison === 4, "catalyst potion should amplify poison");
assert(catalystVialRun.combat!.enemies[0].powers.bleed === 1, "catalyst potion should seed missing bleed");
assert(catalystVialRun.combat!.enemies[0].powers.mark === 6, "catalyst potion should amplify mark");

let catalystBoonRun = createInitialRun(13588, "map", "standard");
catalystBoonRun.player.boons.push("catalyst_training");
catalystBoonRun = enterNode(catalystBoonRun, getAvailableNodeIds(catalystBoonRun)[0]);
assert(
  catalystBoonRun.combat!.enemies.every(
    (enemy) => (enemy.powers.poison ?? 0) >= 1 && (enemy.powers.bleed ?? 0) >= 1 && (enemy.powers.mark ?? 0) >= 1,
  ),
  "catalyst training should seed poison, bleed, and mark on all enemies",
);

let thornsRun = createInitialRun(86420, "map", "standard");
thornsRun = enterNode(thornsRun, getAvailableNodeIds(thornsRun)[0]);
const thornEnemy = thornsRun.combat!.enemies[0];
for (const enemy of thornsRun.combat!.enemies.slice(1)) {
  enemy.hp = 0;
}
thornEnemy.hp = 20;
thornsRun.combat!.playerBlock = 99;
thornsRun.combat!.playerPowers.thorns = 3;
thornsRun.combat!.hand = [];
thornsRun.combat!.discardPile = [];
thornsRun.combat!.drawPile = [];
thornsRun.combat!.enemies[0].intent = {
  id: "poke",
  name: "测试攻击",
  intent: "attack",
  weight: 1,
  effects: [{ type: "damage", amount: 1 }],
};
const thornsHpBefore = thornsRun.player.hp;
thornsRun = endTurn(thornsRun);
assert(thornsRun.player.hp === thornsHpBefore, "blocked attack should not damage player");
assert(thornsRun.combat!.enemies[0].hp === 17, "blocked attack should still trigger player thorns");

let stackRun = createInitialRun(11223, "map", "standard");
stackRun = enterNode(stackRun, getAvailableNodeIds(stackRun)[0]);
const stackEnemy = stackRun.combat!.enemies[0];
for (const enemy of stackRun.combat!.enemies.slice(1)) {
  enemy.hp = 0;
}
stackEnemy.hp = 100;
stackEnemy.maxHp = 100;
stackEnemy.powers.mark = 3;
stackEnemy.powers.bleed = 4;
const stackStrike = makeCardInstance("strike");
stackRun.combat!.hand = [stackStrike];
stackRun.combat!.energy = 3;
stackRun = playCard(stackRun, stackStrike.uid, stackEnemy.uid);
assert(stackRun.combat!.enemies[0].hp === 84, "mark and bleed should stack into attack damage");
assert(stackRun.combat!.enemies[0].powers.mark === 2, "mark should lose 1 stack after an attack");
assert(stackRun.combat!.enemies[0].powers.bleed === 3, "bleed should lose 1 stack after triggering");

let comboRun = createInitialRun(11224, "map", "standard");
comboRun = enterNode(comboRun, getAvailableNodeIds(comboRun)[0]);
const comboEnemy = comboRun.combat!.enemies[0];
for (const enemy of comboRun.combat!.enemies.slice(1)) {
  enemy.hp = 0;
}
comboEnemy.hp = 100;
comboEnemy.maxHp = 100;
const tempo = makeCardInstance("tempo_shift");
const finisher = makeCardInstance("finisher");
comboRun.combat!.hand = [tempo, finisher];
comboRun.combat!.energy = 4;
comboRun = playCard(comboRun, tempo.uid);
comboRun = playCard(comboRun, finisher.uid, comboEnemy.uid);
assert(comboRun.combat!.enemies[0].hp === 82, "finisher should consume combo for damage");
assert(!comboRun.combat!.playerPowers.combo, "finisher should clear combo stacks");

let tempoStatRun = createInitialRun(11229, "map", "standard");
tempoStatRun = enterNode(tempoStatRun, getAvailableNodeIds(tempoStatRun)[0]);
for (const enemy of tempoStatRun.combat!.enemies.slice(1)) {
  enemy.hp = 0;
}
tempoStatRun.combat!.enemies[0].hp = 100;
tempoStatRun.combat!.enemies[0].maxHp = 100;
tempoStatRun.combat!.enemies[0].intent = {
  id: "wait",
  name: "等待",
  intent: "unknown",
  weight: 1,
  effects: [],
};
const tempoStrike = makeCardInstance("strike");
tempoStatRun.combat!.hand = [tempoStrike];
tempoStatRun.combat!.energy = 3;
tempoStatRun = playCard(tempoStatRun, tempoStrike.uid, tempoStatRun.combat!.enemies[0].uid);
assert(tempoStatRun.combat!.cardsPlayedThisTurn === 1, "tempo stats should count cards played this turn");
assert(tempoStatRun.combat!.attacksPlayedThisTurn === 1, "tempo stats should count attacks this turn");
assert(tempoStatRun.combat!.attackCount === 1, "tempo stats should count total attacks");
tempoStatRun = endTurn(tempoStatRun);
assert(tempoStatRun.combat!.cardsPlayedLastTurn === 1, "tempo stats should preserve last turn card count");
assert(tempoStatRun.combat!.cardsPlayedThisTurn === 0, "tempo stats should reset cards played after end turn");

let platedRun = createInitialRun(11225, "map", "standard");
platedRun = enterNode(platedRun, getAvailableNodeIds(platedRun)[0]);
for (const enemy of platedRun.combat!.enemies.slice(1)) {
  enemy.hp = 0;
}
platedRun.combat!.enemies[0].intent = {
  id: "wait",
  name: "等待",
  intent: "unknown",
  weight: 1,
  effects: [],
};
const platedGuard = makeCardInstance("plated_guard");
platedRun.combat!.hand = [platedGuard];
platedRun.combat!.energy = 3;
platedRun = playCard(platedRun, platedGuard.uid);
assert(platedRun.combat!.playerPowers.platedArmor === 2, "plated guard should grant plated armor");
platedRun = endTurn(platedRun);
assert(platedRun.combat!.playerBlock === 2, "plated armor should grant block at next turn start");

let cleanseRun = createInitialRun(11230, "map", "standard");
cleanseRun = enterNode(cleanseRun, getAvailableNodeIds(cleanseRun)[0]);
for (const enemy of cleanseRun.combat!.enemies.slice(1)) {
  enemy.hp = 0;
}
cleanseRun.combat!.playerPowers.weak = 2;
cleanseRun.combat!.playerPowers.frail = 1;
cleanseRun.combat!.playerPowers.strength = 3;
const clearMind = makeCardInstance("clear_mind");
cleanseRun.combat!.hand = [clearMind];
cleanseRun.combat!.energy = 3;
cleanseRun = playCard(cleanseRun, clearMind.uid);
assert(!cleanseRun.combat!.playerPowers.weak, "clear mind should cleanse weak");
assert(!cleanseRun.combat!.playerPowers.frail, "clear mind should cleanse frail");
assert(cleanseRun.combat!.playerPowers.strength === 3, "clear mind should not remove positive powers");

let cleansePotionRun = createInitialRun(11231, "map", "standard");
cleansePotionRun = enterNode(cleansePotionRun, getAvailableNodeIds(cleansePotionRun)[0]);
cleansePotionRun.combat!.playerPowers.vulnerable = 2;
cleansePotionRun.combat!.playerPowers.dexterity = 2;
cleansePotionRun.player.potions.push(makePotionInstance("cleanse_potion"));
cleansePotionRun = usePotion(cleansePotionRun, cleansePotionRun.player.potions[0].uid);
assert(!cleansePotionRun.combat!.playerPowers.vulnerable, "cleanse potion should cleanse vulnerable");
assert(cleansePotionRun.combat!.playerPowers.dexterity === 2, "cleanse potion should not remove dexterity");

let recallPotionRun = createInitialRun(11232, "map", "standard");
recallPotionRun = enterNode(recallPotionRun, getAvailableNodeIds(recallPotionRun)[0]);
const recallStrike = makeCardInstance("strike");
const recallBurn = makeCardInstance("burn");
const recallDefend = makeCardInstance("defend");
recallPotionRun.combat!.hand = [];
recallPotionRun.combat!.discardPile = [recallStrike, recallBurn, recallDefend];
recallPotionRun.combat!.energy = 0;
recallPotionRun.player.potions.push(makePotionInstance("recall_potion"));
recallPotionRun = usePotion(recallPotionRun, recallPotionRun.player.potions[0].uid);
assert(recallPotionRun.combat!.energy === 2, "recall potion should grant energy");
assert(recallPotionRun.combat!.hand.some((card) => card.uid === recallDefend.uid), "recall potion should recover a non-status card");
assert(recallPotionRun.combat!.hand.some((card) => card.uid === recallStrike.uid), "recall potion should recover up to two cards");
assert(recallPotionRun.combat!.discardPile.some((card) => card.uid === recallBurn.uid), "recall potion should not recover status cards");

let catalystPotionRun = createInitialRun(11233, "map", "standard");
catalystPotionRun.player.boons.push("potion_catalyst");
catalystPotionRun = enterNode(catalystPotionRun, getAvailableNodeIds(catalystPotionRun)[0]);
catalystPotionRun.player.potions.push(makePotionInstance("block_potion"));
catalystPotionRun = usePotion(catalystPotionRun, catalystPotionRun.player.potions[0].uid);
assert((catalystPotionRun.combat!.playerPowers.charge ?? 0) >= 1, "potion catalyst should grant charge after using a potion");

let alchemyStoneRun = createInitialRun(11234, "map", "standard");
alchemyStoneRun.player.relics.push("alchemy_stone");
alchemyStoneRun = enterNode(alchemyStoneRun, getAvailableNodeIds(alchemyStoneRun)[0]);
const alchemyStoneDraw = makeCardInstance("strike");
alchemyStoneRun.combat!.hand = [];
alchemyStoneRun.combat!.drawPile = [alchemyStoneDraw];
alchemyStoneRun.player.potions.push(makePotionInstance("block_potion"));
const alchemyStoneEnergyBefore = alchemyStoneRun.combat!.energy;
alchemyStoneRun = usePotion(alchemyStoneRun, alchemyStoneRun.player.potions[0].uid);
assert(alchemyStoneRun.combat!.energy === alchemyStoneEnergyBefore + 1, "alchemy stone should grant energy after using a potion");
assert(alchemyStoneRun.combat!.hand.some((card) => card.uid === alchemyStoneDraw.uid), "alchemy stone should draw after using a potion");

let sparkRun = createInitialRun(11226, "map", "standard");
sparkRun = enterNode(sparkRun, getAvailableNodeIds(sparkRun)[0]);
if (sparkRun.combat!.enemies.length < 2) {
  sparkRun.combat!.enemies.push({
    ...sparkRun.combat!.enemies[0],
    uid: "spark-test-enemy",
    hp: 100,
    maxHp: 100,
    block: 0,
    powers: {},
  });
}
const sparkTarget = sparkRun.combat!.enemies[0];
const sparkOther = sparkRun.combat!.enemies[1];
sparkTarget.hp = 100;
sparkTarget.maxHp = 100;
sparkOther.hp = 100;
sparkOther.maxHp = 100;
sparkTarget.powers.spark = 3;
const sparkStrike = makeCardInstance("strike");
sparkRun.combat!.hand = [sparkStrike];
sparkRun.combat!.energy = 3;
sparkRun = playCard(sparkRun, sparkStrike.uid, sparkTarget.uid);
assert(sparkRun.combat!.enemies[0].hp === 91, "spark should arc back into the hit enemy when it survives");
assert(sparkRun.combat!.enemies[1].hp === 97, "spark should arc into other living enemies");
assert(sparkRun.combat!.enemies[0].powers.spark === 2, "spark should lose 1 stack after arcing");

let chargeRun = createInitialRun(11227, "map", "standard");
chargeRun = enterNode(chargeRun, getAvailableNodeIds(chargeRun)[0]);
if (chargeRun.combat!.enemies.length < 2) {
  chargeRun.combat!.enemies.push({
    ...chargeRun.combat!.enemies[0],
    uid: "charge-test-enemy",
    hp: 100,
    maxHp: 100,
    block: 0,
    powers: {},
  });
}
for (const enemy of chargeRun.combat!.enemies.slice(2)) {
  enemy.hp = 0;
}
chargeRun.combat!.enemies[0].hp = 100;
chargeRun.combat!.enemies[0].maxHp = 100;
chargeRun.combat!.enemies[1].hp = 100;
chargeRun.combat!.enemies[1].maxHp = 100;
const capacitor = makeCardInstance("capacitor");
const discharge = makeCardInstance("discharge");
chargeRun.combat!.hand = [capacitor, discharge];
chargeRun.combat!.energy = 4;
chargeRun = playCard(chargeRun, capacitor.uid);
assert(chargeRun.combat!.playerPowers.charge === 2, "skill cards and capacitor should stack charge");
chargeRun = playCard(chargeRun, discharge.uid);
assert(!chargeRun.combat!.playerPowers.charge, "discharge should consume charge");
assert(chargeRun.combat!.enemies[0].hp === 91, "discharge should spend charge for area damage");
assert(chargeRun.combat!.enemies[1].hp === 91, "discharge should hit every living enemy");

let rewardRun = createInitialRun(777, "map", "standard");
rewardRun.reward = {
  nodeType: "fight",
  title: "测试奖励",
  gold: 0,
  cards: [{ cardId: "purge", upgraded: false }],
  potionId: "poison_potion",
};
rewardRun.phase = "reward";
rewardRun = claimRewardCard(rewardRun, 0);
assert(rewardRun.phase === "reward", "claiming card should keep reward open when potion remains");
assert(rewardRun.player.deck.some((card) => card.cardId === "purge"), "reward card should enter deck");
assert(!rewardRun.player.potions.some((item) => item.potionId === "poison_potion"), "reward potion should not be auto-picked with card");
rewardRun = claimRewardPotion(rewardRun);
assert(rewardRun.phase === "map", "claiming remaining potion should return to map after card is resolved");
assert(rewardRun.player.potions.some((item) => item.potionId === "poison_potion"), "reward potion should enter belt when claimed");

let potionFirstRun = createInitialRun(778, "map", "standard");
potionFirstRun.reward = {
  nodeType: "fight",
  title: "测试奖励",
  gold: 0,
  cards: [{ cardId: "iron_wave", upgraded: true }],
  potionId: "block_potion",
};
potionFirstRun.phase = "reward";
potionFirstRun = claimRewardPotion(potionFirstRun);
assert(potionFirstRun.phase === "reward", "claiming potion first should keep card reward open");
assert(potionFirstRun.reward?.potionId === undefined, "claimed potion should be removed from reward");
potionFirstRun = claimRewardCard(potionFirstRun, 0);
assert(potionFirstRun.phase === "map", "claiming card after potion should return to map");

let boonRewardRun = createInitialRun(780, "map", "standard");
boonRewardRun.reward = {
  nodeType: "fight",
  title: "测试奖励",
  gold: 0,
  cards: [{ cardId: "second_wind", upgraded: false }],
  boons: [{ boonId: "vitality" }, { boonId: "opening_guard" }],
};
boonRewardRun.phase = "reward";
const boonMaxHpBefore = boonRewardRun.player.maxHp;
boonRewardRun = claimRewardCard(boonRewardRun, 0);
assert(boonRewardRun.phase === "reward", "claiming card should keep reward open when boon remains");
boonRewardRun = claimRewardBoon(boonRewardRun, 0);
assert(boonRewardRun.phase === "map", "claiming remaining boon should return to map after card is resolved");
assert(boonRewardRun.player.boons.includes("vitality"), "reward boon should enter permanent boon list");
assert(boonRewardRun.player.maxHp === boonMaxHpBefore + 4, "vitality boon should increase max hp");
assert(BOONS.vitality.name === "生命训练", "boon data should define permanent upgrades");

let boonFirstRun = createInitialRun(781, "map", "standard");
boonFirstRun.reward = {
  nodeType: "fight",
  title: "测试奖励",
  gold: 0,
  cards: [{ cardId: "iron_wave", upgraded: false }],
  boons: [{ boonId: "bottle_rack" }],
};
boonFirstRun.phase = "reward";
boonFirstRun = claimRewardBoon(boonFirstRun, 0);
assert(boonFirstRun.phase === "reward", "claiming boon first should keep card reward open");
assert(boonFirstRun.player.potionSlots === 4, "bottle rack should increase potion slots");
boonFirstRun = claimRewardCard(boonFirstRun, 0);
assert(boonFirstRun.phase === "map", "claiming card after boon should return to map");

let duplicateBoonRewardRun = createInitialRun(785, "map", "standard");
duplicateBoonRewardRun.reward = {
  nodeType: "fight",
  title: "测试重复常驻",
  gold: 0,
  cards: [],
  cardResolved: true,
  boons: [{ boonId: "opening_guard" }, { boonId: "catalyst_training" }],
};
duplicateBoonRewardRun.player.boons.push("opening_guard");
duplicateBoonRewardRun.phase = "reward";
duplicateBoonRewardRun = claimRewardBoon(duplicateBoonRewardRun, 0);
assert(duplicateBoonRewardRun.phase === "reward", "duplicate reward boon should not close reward while another boon remains");
assert(!duplicateBoonRewardRun.reward?.boonResolved, "duplicate reward boon should keep boon reward unresolved when alternatives remain");
duplicateBoonRewardRun = claimRewardBoon(duplicateBoonRewardRun, 0);
assert(duplicateBoonRewardRun.phase === "map", "claiming the remaining non-duplicate boon should finish reward");
assert(duplicateBoonRewardRun.player.boons.includes("catalyst_training"), "remaining non-duplicate boon should still be claimable");

let alchemyBoonRun = createInitialRun(786, "map", "standard");
alchemyBoonRun.reward = {
  nodeType: "fight",
  title: "测试奖励",
  gold: 0,
  cards: [],
  cardResolved: true,
  boons: [{ boonId: "field_alchemy" }],
};
alchemyBoonRun.phase = "reward";
alchemyBoonRun.player.potions = [];
alchemyBoonRun = claimRewardBoon(alchemyBoonRun, 0);
assert(alchemyBoonRun.player.boons.includes("field_alchemy"), "field alchemy should enter boon list");
assert(alchemyBoonRun.player.potions.length === 1, "field alchemy should grant a potion when space exists");
assert(alchemyBoonRun.message?.includes("获得药水"), "field alchemy message should mention gained potion");

let invalidRewardCardRun = createInitialRun(7861, "map", "standard");
invalidRewardCardRun.reward = {
  nodeType: "fight",
  title: "测试坏卡牌奖励",
  gold: 0,
  cards: [{ cardId: "missing_card", upgraded: false }],
};
invalidRewardCardRun.phase = "reward";
invalidRewardCardRun = claimRewardCard(invalidRewardCardRun, 0);
assert(invalidRewardCardRun.phase === "reward", "invalid reward card should not finish reward");
assert(!invalidRewardCardRun.player.deck.some((card) => card.cardId === "missing_card"), "invalid reward card should not enter deck");
assert(invalidRewardCardRun.message?.includes("不存在"), "invalid reward card should explain missing card");

let invalidRewardPotionRun = createInitialRun(7862, "map", "standard");
invalidRewardPotionRun.reward = {
  nodeType: "fight",
  title: "测试坏药水奖励",
  gold: 0,
  cards: [],
  cardResolved: true,
  potionId: "missing_potion",
};
invalidRewardPotionRun.phase = "reward";
invalidRewardPotionRun = claimRewardPotion(invalidRewardPotionRun);
assert(invalidRewardPotionRun.phase === "map", "invalid reward potion should resolve reward safely");
assert(!invalidRewardPotionRun.player.potions.some((potion) => potion.potionId === "missing_potion"), "invalid reward potion should not enter belt");
assert(invalidRewardPotionRun.message?.includes("失效"), "invalid reward potion should explain stale potion");

let invalidRewardBoonRun = createInitialRun(7863, "map", "standard");
invalidRewardBoonRun.reward = {
  nodeType: "fight",
  title: "测试坏常驻奖励",
  gold: 0,
  cards: [],
  cardResolved: true,
  boons: [{ boonId: "missing_boon" as RunState["player"]["boons"][number] }],
};
invalidRewardBoonRun.phase = "reward";
invalidRewardBoonRun = claimRewardBoon(invalidRewardBoonRun, 0);
assert(invalidRewardBoonRun.phase === "reward", "invalid reward boon should keep reward open");
assert(invalidRewardBoonRun.message?.includes("不存在"), "invalid reward boon should explain missing boon");

let rerollRun = createInitialRun(783, "map", "standard");
rerollRun.reward = {
  nodeType: "fight",
  title: "测试奖励",
  gold: 0,
  cards: [{ cardId: "strike", upgraded: false }],
  potionId: "fire_potion",
  boons: [{ boonId: "opening_guard" }],
  rerollPrice: 1,
};
rerollRun.phase = "reward";
rerollRun.player.gold = 5;
rerollRun = rerollRewardCards(rerollRun);
assert(rerollRun.phase === "reward", "reroll should keep reward open");
assert(rerollRun.player.gold === 4, "reroll should spend gold");
assert(rerollRun.reward?.rerolled, "reroll should mark reward as rerolled");
assert(rerollRun.reward?.potionId === "fire_potion", "reroll should not claim or remove potion reward");
assert(rerollRun.reward?.boons?.length === 1, "reroll should not alter boon reward");
const rerollCardsAfterFirst = rerollRun.reward!.cards.map((offer) => offer.cardId).join(",");
rerollRun = rerollRewardCards(rerollRun);
assert(rerollRun.player.gold === 4, "reroll should only be available once");
assert(rerollRun.reward!.cards.map((offer) => offer.cardId).join(",") === rerollCardsAfterFirst, "second reroll should not change cards");

let invalidRerollRun = createInitialRun(7841, "map", "standard");
invalidRerollRun.reward = {
  nodeType: "fight",
  title: "测试异常重掷价",
  gold: 0,
  cards: [{ cardId: "strike", upgraded: false }],
  rerollPrice: Number.NaN,
};
invalidRerollRun.phase = "reward";
invalidRerollRun.player.gold = 100;
invalidRerollRun = rerollRewardCards(invalidRerollRun);
assert(invalidRerollRun.player.gold === 77, "invalid reroll price should fall back to scaled standard price");
assert(Number.isFinite(invalidRerollRun.player.gold), "invalid reroll price should not poison gold with NaN");

let skipRemainingRewardRun = createInitialRun(784, "map", "standard");
skipRemainingRewardRun.reward = {
  nodeType: "fight",
  title: "测试剩余奖励",
  gold: 0,
  cards: [],
  cardResolved: true,
  potionId: "fire_potion",
  boons: [{ boonId: "opening_guard" }],
};
skipRemainingRewardRun.phase = "reward";
skipRemainingRewardRun = claimRewardCard(skipRemainingRewardRun);
assert(skipRemainingRewardRun.phase === "map", "skipping remaining reward should finish reward");
assert(skipRemainingRewardRun.message?.includes("跳过药水、常驻提升奖励"), "skipping remaining reward should describe skipped rewards");

let skipCardRun = createInitialRun(787, "map", "standard");
skipCardRun.reward = {
  nodeType: "fight",
  title: "测试奖励",
  gold: 0,
  cards: [{ cardId: "strike", upgraded: false }],
};
skipCardRun.phase = "reward";
skipCardRun.player.gold = 10;
const skipGoldBefore = skipCardRun.player.gold;
const skipEarnedBefore = skipCardRun.stats.goldEarned;
skipCardRun = claimRewardCard(skipCardRun);
assert(skipCardRun.phase === "map", "skipping only card reward should return to map");
assert(skipCardRun.player.gold > skipGoldBefore, "skipping card reward should grant gold");
assert(skipCardRun.stats.goldEarned > skipEarnedBefore, "skip reward gold should count as earned gold");

let openingBoonRun = createInitialRun(782, "map", "standard");
openingBoonRun.player.boons.push("opening_guard");
openingBoonRun = enterNode(openingBoonRun, getAvailableNodeIds(openingBoonRun)[0]);
assert(openingBoonRun.combat!.playerBlock >= 3, "opening guard boon should grant block at combat start");

let layeredBoonRun = createInitialRun(783, "map", "standard");
layeredBoonRun.player.hp = 70;
layeredBoonRun.player.deck.push(makeCardInstance("wound"));
layeredBoonRun.player.boons.push(
  "blade_oil",
  "venom_prep",
  "reserve_battery",
  "recovery_mantra",
  "scavenger_kit",
  "weakpoint_chart",
  "tempered_shell",
  "coil_training",
  "field_protocol",
  "banner_drill",
  "triage_doctrine",
  "ash_ledger",
  "rhythm_meter",
);
layeredBoonRun = enterNode(layeredBoonRun, getAvailableNodeIds(layeredBoonRun)[0]);
assert((layeredBoonRun.combat!.playerPowers.strength ?? 0) >= 1, "blade oil boon should grant starting strength");
assert((layeredBoonRun.combat!.playerPowers.charge ?? 0) >= 4, "reserve battery, coil training, rhythm meter, and triage doctrine boons should grant charge");
assert((layeredBoonRun.combat!.playerPowers.combo ?? 0) >= 2, "coil training and rhythm meter boons should grant combo");
assert((layeredBoonRun.combat!.playerPowers.platedArmor ?? 0) >= 1, "tempered shell boon should grant plated armor");
assert((layeredBoonRun.combat!.playerPowers.thorns ?? 0) >= 2, "tempered shell boon should grant thorns");
assert(layeredBoonRun.combat!.energy >= 5, "reserve battery boon should grant first-turn energy");
assert(layeredBoonRun.player.hp > 70, "recovery mantra boon should heal through regen");
assert(
  layeredBoonRun.combat!.enemies.every((enemy) => enemy.hp <= 0 || (enemy.powers.poison ?? 0) >= 1),
  "venom prep boon should seed poison on enemies",
);
assert(layeredBoonRun.combat!.hand.some((card) => card.cardId === "salvage"), "scavenger kit should put salvage into opening hand");
assert(layeredBoonRun.combat!.hand.some((card) => card.cardId === "field_tactics"), "field protocol should put field tactics into opening hand");
assert(layeredBoonRun.combat!.hand.some((card) => card.cardId === "trauma_recycler"), "triage doctrine should put trauma recycler into opening hand");
assert(layeredBoonRun.combat!.hand.some((card) => card.cardId === "ash_ward"), "ash ledger should put ash ward into opening hand");
assert(layeredBoonRun.combat!.playerBlock >= 3, "ash ledger should grant block when the deck has status cards");
assert(
  layeredBoonRun.combat!.enemies.every((enemy) => enemy.hp <= 0 || (enemy.powers.mark ?? 0) >= 1),
  "weakpoint chart and banner drill should seed mark on enemies",
);

let traumaRecyclerRun = createInitialRun(784, "map", "standard");
traumaRecyclerRun = enterNode(traumaRecyclerRun, getAvailableNodeIds(traumaRecyclerRun)[0]);
const traumaRecycler = makeCardInstance("trauma_recycler");
traumaRecyclerRun.combat!.hand = [traumaRecycler, makeCardInstance("wound")];
traumaRecyclerRun.combat!.discardPile = [makeCardInstance("burn")];
traumaRecyclerRun.combat!.drawPile = [makeCardInstance("strike"), makeCardInstance("defend")];
traumaRecyclerRun.combat!.energy = 3;
traumaRecyclerRun = playCard(traumaRecyclerRun, traumaRecycler.uid);
assert(traumaRecyclerRun.combat!.exhaustPile.filter((card) => card.cardId === "wound" || card.cardId === "burn").length === 2, "trauma recycler should exhaust status fuel across hand and discard");
assert((traumaRecyclerRun.combat!.playerPowers.charge ?? 0) >= 3, "trauma recycler should convert status fuel into charge");
assert(traumaRecyclerRun.combat!.playerBlock >= 8, "trauma recycler should convert status fuel into block");

let ashLedgerTriggerRun = createInitialRun(7841, "map", "standard");
ashLedgerTriggerRun.player.boons.push("ash_ledger");
ashLedgerTriggerRun = enterNode(ashLedgerTriggerRun, getAvailableNodeIds(ashLedgerTriggerRun)[0]);
const ledgerRecycler = makeCardInstance("trauma_recycler");
ashLedgerTriggerRun.combat!.hand = [ledgerRecycler, makeCardInstance("wound")];
ashLedgerTriggerRun.combat!.discardPile = [makeCardInstance("burn")];
ashLedgerTriggerRun.combat!.energy = 3;
const ledgerBlockBefore = ashLedgerTriggerRun.combat!.playerBlock;
ashLedgerTriggerRun = playCard(ashLedgerTriggerRun, ledgerRecycler.uid);
assert(ashLedgerTriggerRun.combat!.playerBlock >= ledgerBlockBefore + 10, "ash ledger should grant extra block when cards are exhausted");

let triagePotionEffectRun = createInitialRun(785, "map", "standard");
triagePotionEffectRun = enterNode(triagePotionEffectRun, getAvailableNodeIds(triagePotionEffectRun)[0]);
const triagePotion = makePotionInstance("triage_potion");
triagePotionEffectRun.player.potions = [triagePotion];
triagePotionEffectRun.combat!.hand = [makeCardInstance("wound")];
triagePotionEffectRun.combat!.discardPile = [makeCardInstance("burn")];
triagePotionEffectRun.combat!.drawPile = [makeCardInstance("strike"), makeCardInstance("defend")];
triagePotionEffectRun = usePotion(triagePotionEffectRun, triagePotion.uid);
assert(triagePotionEffectRun.player.potions.length === 0, "triage potion should be consumed");
assert(triagePotionEffectRun.combat!.exhaustPile.filter((card) => card.cardId === "wound" || card.cardId === "burn").length === 2, "triage potion should exhaust status fuel across hand and discard");
assert(triagePotionEffectRun.combat!.playerBlock >= 10, "triage potion should grant block per exhausted status");

let woundBatteryRun = createInitialRun(786, "map", "standard");
woundBatteryRun = enterNode(woundBatteryRun, getAvailableNodeIds(woundBatteryRun)[0]);
const woundBattery = makeCardInstance("wound_battery");
woundBatteryRun.combat!.hand = [woundBattery];
woundBatteryRun.combat!.drawPile = [makeCardInstance("strike"), makeCardInstance("defend")];
woundBatteryRun.combat!.discardPile = [];
woundBatteryRun.combat!.energy = 3;
woundBatteryRun = playCard(woundBatteryRun, woundBattery.uid);
assert((woundBatteryRun.combat!.playerPowers.charge ?? 0) >= 2, "wound battery should grant charge");
assert(woundBatteryRun.combat!.discardPile.some((card) => card.cardId === "wound"), "wound battery should create a wound in discard");

let ashWardRun = createInitialRun(787, "map", "standard");
ashWardRun = enterNode(ashWardRun, getAvailableNodeIds(ashWardRun)[0]);
const ashWard = makeCardInstance("ash_ward");
ashWardRun.combat!.hand = [ashWard];
ashWardRun.combat!.exhaustPile = [makeCardInstance("wound"), makeCardInstance("burn"), makeCardInstance("strike")];
ashWardRun.combat!.energy = 3;
ashWardRun = playCard(ashWardRun, ashWard.uid);
assert(ashWardRun.combat!.playerBlock >= 10, "ash ward should gain block from exhausted cards");

let ashPotionRun = createInitialRun(788, "map", "standard");
ashPotionRun = enterNode(ashPotionRun, getAvailableNodeIds(ashPotionRun)[0]);
const ashPotion = makePotionInstance("ash_potion");
ashPotionRun.player.potions = [ashPotion];
ashPotionRun.combat!.exhaustPile = [makeCardInstance("wound"), makeCardInstance("burn")];
ashPotionRun = usePotion(ashPotionRun, ashPotion.uid);
assert(ashPotionRun.player.potions.length === 0, "ash potion should be consumed");
assert(ashPotionRun.combat!.playerBlock >= 12, "ash potion should gain block from exhausted cards");

let rhythmBatteryRun = createInitialRun(789, "map", "standard");
rhythmBatteryRun = enterNode(rhythmBatteryRun, getAvailableNodeIds(rhythmBatteryRun)[0]);
const rhythmBattery = makeCardInstance("rhythm_battery");
rhythmBatteryRun.combat!.hand = [rhythmBattery];
rhythmBatteryRun.combat!.energy = 3;
rhythmBatteryRun.combat!.playerPowers.combo = 3;
const rhythmChargeBefore = rhythmBatteryRun.combat!.playerPowers.charge ?? 0;
rhythmBatteryRun = playCard(rhythmBatteryRun, rhythmBattery.uid);
assert((rhythmBatteryRun.combat!.playerPowers.charge ?? 0) >= rhythmChargeBefore + 4, "rhythm battery should convert combo into charge after skill charge");
assert(rhythmBatteryRun.combat!.playerBlock >= 5, "rhythm battery should grant block while resonating");

let rhythmCapRun = createInitialRun(7891, "map", "standard");
rhythmCapRun = enterNode(rhythmCapRun, getAvailableNodeIds(rhythmCapRun)[0]);
const cappedRhythmBattery = makeCardInstance("rhythm_battery");
rhythmCapRun.combat!.hand = [cappedRhythmBattery];
rhythmCapRun.combat!.energy = 3;
rhythmCapRun.combat!.playerPowers.combo = 9;
const cappedRhythmChargeBefore = rhythmCapRun.combat!.playerPowers.charge ?? 0;
rhythmCapRun = playCard(rhythmCapRun, cappedRhythmBattery.uid);
assert((rhythmCapRun.combat!.playerPowers.charge ?? 0) === cappedRhythmChargeBefore + 5, "rhythm battery should respect its resonance cap plus skill charge");

let tempoPotionRun = createInitialRun(790, "map", "standard");
tempoPotionRun = enterNode(tempoPotionRun, getAvailableNodeIds(tempoPotionRun)[0]);
const tempoPotion = makePotionInstance("tempo_potion");
tempoPotionRun.player.potions = [tempoPotion];
tempoPotionRun.combat!.playerPowers.combo = 1;
tempoPotionRun = usePotion(tempoPotionRun, tempoPotion.uid);
assert(tempoPotionRun.player.potions.length === 0, "tempo potion should be consumed");
assert((tempoPotionRun.combat!.playerPowers.combo ?? 0) >= 3, "tempo potion should grant combo before resonating");
assert((tempoPotionRun.combat!.playerPowers.charge ?? 0) >= 3, "tempo potion should convert combo into charge");

let tempoPotionCapRun = createInitialRun(7901, "map", "standard");
tempoPotionCapRun = enterNode(tempoPotionCapRun, getAvailableNodeIds(tempoPotionCapRun)[0]);
const cappedTempoPotion = makePotionInstance("tempo_potion");
tempoPotionCapRun.player.potions = [cappedTempoPotion];
tempoPotionCapRun.combat!.playerPowers.combo = 10;
const cappedTempoChargeBefore = tempoPotionCapRun.combat!.playerPowers.charge ?? 0;
tempoPotionCapRun = usePotion(tempoPotionCapRun, cappedTempoPotion.uid);
assert((tempoPotionCapRun.combat!.playerPowers.charge ?? 0) === cappedTempoChargeBefore + 4, "tempo potion should respect its resonance cap");

let rhythmMeterRun = createInitialRun(791, "map", "standard");
rhythmMeterRun.player.boons.push("rhythm_meter");
rhythmMeterRun = enterNode(rhythmMeterRun, getAvailableNodeIds(rhythmMeterRun)[0]);
assert((rhythmMeterRun.combat!.playerPowers.combo ?? 0) >= 1, "rhythm meter should grant starting combo");
const rhythmDefend = makeCardInstance("defend");
const rhythmStrike = makeCardInstance("strike");
rhythmMeterRun.combat!.hand = [rhythmDefend, rhythmStrike];
rhythmMeterRun.combat!.energy = 3;
rhythmMeterRun.combat!.enemies[0].hp = Math.max(rhythmMeterRun.combat!.enemies[0].hp, 40);
rhythmMeterRun = playCard(rhythmMeterRun, rhythmDefend.uid);
const meterChargeBefore = rhythmMeterRun.combat!.playerPowers.charge ?? 0;
const meterComboBefore = rhythmMeterRun.combat!.playerPowers.combo ?? 0;
rhythmMeterRun = playCard(rhythmMeterRun, rhythmStrike.uid, rhythmMeterRun.combat!.enemies[0].uid);
assert((rhythmMeterRun.combat!.playerPowers.charge ?? 0) >= meterChargeBefore + 1, "rhythm meter should grant charge on the second card each turn");
assert((rhythmMeterRun.combat!.playerPowers.combo ?? 0) >= meterComboBefore + 2, "rhythm meter should grant extra combo when the second card is an attack");

let chainGuardRun = createInitialRun(792, "map", "standard");
chainGuardRun = enterNode(chainGuardRun, getAvailableNodeIds(chainGuardRun)[0]);
const chainDefend = makeCardInstance("defend");
const chainStrike = makeCardInstance("strike");
const chainGuard = makeCardInstance("chain_guard");
chainGuardRun.combat!.hand = [chainDefend, chainStrike, chainGuard];
chainGuardRun.combat!.energy = 5;
chainGuardRun.combat!.enemies[0].hp = Math.max(chainGuardRun.combat!.enemies[0].hp, 80);
chainGuardRun = playCard(chainGuardRun, chainDefend.uid);
chainGuardRun = playCard(chainGuardRun, chainStrike.uid, chainGuardRun.combat!.enemies[0].uid);
const chainChargeBefore = chainGuardRun.combat!.playerPowers.charge ?? 0;
chainGuardRun = playCard(chainGuardRun, chainGuard.uid);
assert((chainGuardRun.combat!.playerPowers.charge ?? 0) >= chainChargeBefore + 4, "chain guard should count itself as the third card and add charge");
assert(chainGuardRun.combat!.playerBlock >= 10, "chain guard should grant block while chaining");

let chainGuardCapRun = createInitialRun(7921, "map", "standard");
chainGuardCapRun = enterNode(chainGuardCapRun, getAvailableNodeIds(chainGuardCapRun)[0]);
const cappedChainGuard = makeCardInstance("chain_guard");
chainGuardCapRun.combat!.hand = [cappedChainGuard];
chainGuardCapRun.combat!.energy = 3;
chainGuardCapRun.combat!.cardsPlayedThisTurn = 9;
const cappedChainChargeBefore = chainGuardCapRun.combat!.playerPowers.charge ?? 0;
chainGuardCapRun = playCard(chainGuardCapRun, cappedChainGuard.uid);
assert((chainGuardCapRun.combat!.playerPowers.charge ?? 0) === cappedChainChargeBefore + 5, "chain guard should respect its chain cap plus skill charge");

let chainPotionRun = createInitialRun(793, "map", "standard");
chainPotionRun = enterNode(chainPotionRun, getAvailableNodeIds(chainPotionRun)[0]);
const chainPotion = makePotionInstance("chain_potion");
chainPotionRun.player.potions = [chainPotion];
chainPotionRun.combat!.cardsPlayedThisTurn = 2;
const chainPotionEnergyBefore = chainPotionRun.combat!.energy;
chainPotionRun = usePotion(chainPotionRun, chainPotion.uid);
assert(chainPotionRun.player.potions.length === 0, "chain potion should be consumed");
assert(chainPotionRun.combat!.energy === chainPotionEnergyBefore + 1, "chain potion should grant energy");
assert((chainPotionRun.combat!.playerPowers.combo ?? 0) >= 2, "chain potion should turn played cards into combo");

let chainPotionMinimumRun = createInitialRun(7931, "map", "standard");
chainPotionMinimumRun = enterNode(chainPotionMinimumRun, getAvailableNodeIds(chainPotionMinimumRun)[0]);
const minimumChainPotion = makePotionInstance("chain_potion");
chainPotionMinimumRun.player.potions = [minimumChainPotion];
chainPotionMinimumRun.combat!.cardsPlayedThisTurn = 0;
chainPotionMinimumRun = usePotion(chainPotionMinimumRun, minimumChainPotion.uid);
assert((chainPotionMinimumRun.combat!.playerPowers.combo ?? 0) >= 1, "chain potion should have a minimum combo floor");

let chainManualRun = createInitialRun(794, "map", "standard");
chainManualRun.player.boons.push("chain_manual");
chainManualRun = enterNode(chainManualRun, getAvailableNodeIds(chainManualRun)[0]);
const chainManualOne = makeCardInstance("defend");
const chainManualTwo = makeCardInstance("defend");
const chainManualThree = makeCardInstance("defend");
chainManualRun.combat!.hand = [chainManualOne, chainManualTwo, chainManualThree];
chainManualRun.combat!.energy = 3;
chainManualRun = playCard(chainManualRun, chainManualOne.uid);
chainManualRun = playCard(chainManualRun, chainManualTwo.uid);
const chainManualComboBefore = chainManualRun.combat!.playerPowers.combo ?? 0;
chainManualRun = playCard(chainManualRun, chainManualThree.uid);
assert(chainManualRun.combat!.energy === 1, "chain manual should refund energy on the third card");
assert((chainManualRun.combat!.playerPowers.combo ?? 0) >= chainManualComboBefore + 1, "chain manual should grant combo on the third card");

let overloadRun = createInitialRun(795, "map", "standard");
overloadRun = enterNode(overloadRun, getAvailableNodeIds(overloadRun)[0]);
const overloadSurge = makeCardInstance("overload_surge");
overloadRun.combat!.hand = [overloadSurge];
overloadRun.combat!.drawPile = [makeCardInstance("strike")];
overloadRun.combat!.energy = 0;
overloadRun = playCard(overloadRun, overloadSurge.uid);
assert(overloadRun.combat!.energy >= 1, "overload surge should grant energy");
assert((overloadRun.combat!.playerPowers.charge ?? 0) >= 3, "overload surge should grant charge and skill charge");
assert((overloadRun.combat!.playerPowers.bleed ?? 0) >= 1, "overload surge should add self bleed as a drawback");
assert(overloadRun.combat!.hand.some((card) => card.cardId === "strike"), "overload surge should draw a card");

let heatSinkRun = createInitialRun(796, "map", "standard");
heatSinkRun = enterNode(heatSinkRun, getAvailableNodeIds(heatSinkRun)[0]);
const heatSink = makeCardInstance("heat_sink");
heatSinkRun.combat!.hand = [heatSink];
heatSinkRun.combat!.energy = 3;
heatSinkRun.combat!.playerPowers.bleed = 2;
const heatSinkChargeBefore = heatSinkRun.combat!.playerPowers.charge ?? 0;
heatSinkRun = playCard(heatSinkRun, heatSink.uid);
assert((heatSinkRun.combat!.playerPowers.bleed ?? 0) === 0, "heat sink should remove self bleed");
assert((heatSinkRun.combat!.playerPowers.charge ?? 0) >= heatSinkChargeBefore + 3, "heat sink should turn bleed into charge plus skill charge");
assert(heatSinkRun.combat!.playerBlock >= 13, "heat sink should turn bleed into block");

let coolantPotionRun = createInitialRun(797, "map", "standard");
coolantPotionRun = enterNode(coolantPotionRun, getAvailableNodeIds(coolantPotionRun)[0]);
const coolantPotion = makePotionInstance("coolant_potion");
coolantPotionRun.player.potions = [coolantPotion];
coolantPotionRun.combat!.playerPowers.bleed = 3;
coolantPotionRun = usePotion(coolantPotionRun, coolantPotion.uid);
assert(coolantPotionRun.player.potions.length === 0, "coolant potion should be consumed");
assert((coolantPotionRun.combat!.playerPowers.bleed ?? 0) === 0, "coolant potion should remove bleed");
assert((coolantPotionRun.combat!.playerPowers.platedArmor ?? 0) >= 3, "coolant potion should convert bleed into plated armor");
assert(coolantPotionRun.combat!.playerBlock >= 15, "coolant potion should convert bleed into block");

let heatRegulatorRun = createInitialRun(798, "map", "standard");
heatRegulatorRun.player.boons.push("heat_regulator");
heatRegulatorRun.player.deck.push(makeCardInstance("overload_surge"));
heatRegulatorRun = enterNode(heatRegulatorRun, getAvailableNodeIds(heatRegulatorRun)[0]);
assert(heatRegulatorRun.combat!.hand.some((card) => card.cardId === "heat_sink"), "heat regulator should put heat sink into opening hand");
assert((heatRegulatorRun.combat!.playerPowers.charge ?? 0) >= 1, "heat regulator should grant charge when the deck has overload cards");

let bossRewardRun = createInitialRun(11232, "map", "standard");
const preBossNode = bossRewardRun.map.find((node) => node.children.includes("boss"));
assert(preBossNode, "expected a node connected to boss");
preBossNode.completed = true;
bossRewardRun.currentNodeId = preBossNode.id;
bossRewardRun.floor = preBossNode.floor + 1;
bossRewardRun = enterNode(bossRewardRun, "boss");
assert(bossRewardRun.phase === "combat", "entering boss should start combat");
assert(bossRewardRun.combat?.nodeType === "boss", "boss combat should record boss node type");
for (const enemy of bossRewardRun.combat!.enemies.slice(1)) {
  enemy.hp = 0;
}
bossRewardRun.combat!.enemies[0].hp = 1;
bossRewardRun.combat!.enemies[0].maxHp = 1;
const bossStrike = makeCardInstance("strike", true);
bossRewardRun.combat!.hand = [bossStrike];
bossRewardRun.combat!.energy = 3;
bossRewardRun = playCard(bossRewardRun, bossStrike.uid, bossRewardRun.combat!.enemies[0].uid);
assert(bossRewardRun.phase === "reward", "defeating boss should open boss reward before victory");
assert(bossRewardRun.reward?.nodeType === "boss", "boss reward should keep boss node type");
assert(bossRewardRun.reward?.title === "Boss奖励", "boss reward should use boss title");
assert(bossRewardRun.player.relics.includes("star_orb"), "first boss reward should grant boss relic");
bossRewardRun = claimRewardCard(bossRewardRun);
assert(bossRewardRun.phase === "reward", "skipping boss cards should keep remaining boss reward open");
bossRewardRun = claimRewardCard(bossRewardRun);
assert(bossRewardRun.phase === "map", "finishing first boss reward should enter the next act");
assert(bossRewardRun.act === 2, "first boss reward should advance to act 2");
assert(bossRewardRun.floor === 0, "next act should reset local floor progress");
assert(bossRewardRun.currentNodeId === undefined, "next act should reset current map node");
assert(
  getAvailableNodeIds(bossRewardRun).length >= 3 && getAvailableNodeIds(bossRewardRun).length <= 4,
  "next act should offer fresh starting routes",
);
assert(bossRewardRun.map.every((node) => !node.completed), "next act should start with a fresh uncompleted map");

let finalBossRun = createInitialRun(11233, "map", "standard");
finalBossRun.act = 2;
const finalPreBossNode = finalBossRun.map.find((node) => node.children.includes("boss"));
assert(finalPreBossNode, "expected a final-act node connected to boss");
finalPreBossNode.completed = true;
finalBossRun.currentNodeId = finalPreBossNode.id;
finalBossRun.floor = finalPreBossNode.floor + 1;
finalBossRun = enterNode(finalBossRun, "boss");
assert(finalBossRun.phase === "combat", "entering final boss should start combat");
assert(finalBossRun.combat?.encounterName === "觉醒裂隙心核", "act 2 boss should use awakened boss encounter");
for (const enemy of finalBossRun.combat!.enemies.slice(1)) {
  enemy.hp = 0;
}
finalBossRun.combat!.enemies[0].hp = 1;
finalBossRun.combat!.enemies[0].maxHp = 1;
const finalBossStrike = makeCardInstance("strike", true);
finalBossRun.combat!.hand = [finalBossStrike];
finalBossRun.combat!.energy = 3;
finalBossRun = playCard(finalBossRun, finalBossStrike.uid, finalBossRun.combat!.enemies[0].uid);
assert(finalBossRun.phase === "reward", "defeating final boss should still open final reward");
finalBossRun = claimRewardCard(finalBossRun);
finalBossRun = claimRewardCard(finalBossRun);
assert(finalBossRun.phase === "victory", "finishing final boss reward should enter victory");

let focusBoonRun = createInitialRun(784, "map", "standard");
focusBoonRun.player.boons.push("battle_focus");
focusBoonRun = enterNode(focusBoonRun, getAvailableNodeIds(focusBoonRun)[0]);
assert(focusBoonRun.combat!.hand.length === 6, "battle focus boon should draw 1 extra card on turn 1");

let conduitBoonRun = createInitialRun(785, "map", "standard");
conduitBoonRun.player.boons.push("spark_conduit", "bleed_edge");
conduitBoonRun = enterNode(conduitBoonRun, getAvailableNodeIds(conduitBoonRun)[0]);
assert(
  conduitBoonRun.combat!.enemies.every((enemy) => (enemy.powers.spark ?? 0) >= 1 && (enemy.powers.bleed ?? 0) >= 1),
  "offensive boons should seed spark and bleed on enemies",
);
assert(BOONS.field_alchemy.name === "野外炼金", "field alchemy boon should be defined");
assert(BOONS.reserve_battery.name === "备用电池", "reserve battery boon should be defined");
assert(ENEMIES.ash_scout.moves.some((move) => move.id === "mark_flare"), "ash scout should have mark flare move");
assert(ENEMIES.plague_mote.moves.some((move) => move.id === "toxic_puff"), "plague mote should have toxic puff move");
assert(ENEMIES.supply_mimic.moves.some((move) => move.id === "spill_tonic"), "supply mimic should have tonic spill move");
assert(ENEMIES.coil_scrapper.moves.some((move) => move.id === "wind_coil"), "coil scrapper should have coil windup move");
assert(ENEMIES.runic_colossus.tier === "elite", "runic colossus should be an elite enemy");
assert(ENEMIES.rift_heart_awakened.tier === "boss", "awakened heart should be a boss enemy");
assert(ENCOUNTERS.some((encounter) => encounter.id === "plague_bloom"), "plague bloom encounter should be registered");
assert(ENCOUNTERS.some((encounter) => encounter.id === "supply_mimic" && encounter.minFloor === 3), "supply mimic encounter should be registered");
assert(ENCOUNTERS.some((encounter) => encounter.id === "scrap_workshop" && encounter.enemies.includes("coil_scrapper")), "scrap workshop encounter should be registered");
assert(ENCOUNTERS.some((encounter) => encounter.id === "runic_colossus"), "runic colossus encounter should be registered");
assert(ENCOUNTERS.some((encounter) => encounter.id === "rift_heart_awakened" && encounter.minAct === 2), "awakened heart should be act-gated");

let fullPotionRun = createInitialRun(779, "map", "standard");
fullPotionRun.reward = {
  nodeType: "fight",
  title: "测试奖励",
  gold: 0,
  cards: [{ cardId: "cleave", upgraded: false }],
  potionId: "fire_potion",
};
fullPotionRun.phase = "reward";
fullPotionRun.player.potions = [
  makePotionInstance("block_potion"),
  makePotionInstance("strength_potion"),
  makePotionInstance("energy_potion"),
];
fullPotionRun = claimRewardCard(fullPotionRun, 0);
assert(fullPotionRun.phase === "reward", "full potion belt should keep reward open after card");
fullPotionRun = claimRewardPotion(fullPotionRun);
assert(fullPotionRun.phase === "reward", "failed potion claim should not close reward");
assert(fullPotionRun.message === "药水槽已满。", "full potion belt should show an explicit message");
const discardedPotionUid = fullPotionRun.player.potions[0].uid;
fullPotionRun = discardPotion(fullPotionRun, discardedPotionUid);
assert(fullPotionRun.player.potions.length === 2, "discard potion should free a potion slot");
fullPotionRun = claimRewardPotion(fullPotionRun);
assert(fullPotionRun.player.potions.some((potion) => potion.potionId === "fire_potion"), "freed potion slot should accept reward potion");
fullPotionRun = claimRewardCard(fullPotionRun);
assert(fullPotionRun.phase === "map", "continue should allow skipping unclaimed potion");

let shopRun = createInitialRun(888, "map", "standard");
shopRun.phase = "shop";
shopRun.shop = {
  cards: [],
  relics: [],
  potions: [{ potionId: "strength_potion", price: 1 }],
  boons: [],
  healPrice: 45,
  removePrice: 5,
  restockPrice: 5,
};
shopRun.player.gold = 10;
shopRun = buyShopPotion(shopRun, 0);
assert(shopRun.player.gold === 9, "buying potion should spend gold");
assert(shopRun.player.potions.some((item) => item.potionId === "strength_potion"), "shop potion should enter belt");

let fullShopPotionRun = createInitialRun(885, "shop", "standard");
fullShopPotionRun.shop = {
  cards: [],
  relics: [],
  potions: [{ potionId: "strength_potion", price: 2 }],
  boons: [],
  healPrice: 45,
  removePrice: 5,
  restockPrice: 5,
};
fullShopPotionRun.player.gold = 10;
fullShopPotionRun.player.potionSlots = 2;
fullShopPotionRun.player.potions = [makePotionInstance("fire_potion"), makePotionInstance("block_potion")];
fullShopPotionRun = buyShopPotion(fullShopPotionRun, 0);
assert(fullShopPotionRun.player.gold === 10, "full potion belt should not spend gold in shop");
assert(fullShopPotionRun.player.potions.length === 2, "full potion belt should not overfill in shop");
assert(!fullShopPotionRun.shop!.potions[0].sold, "failed shop potion purchase should not mark offer sold");

let duplicateRelicShopRun = createInitialRun(884, "shop", "standard");
duplicateRelicShopRun.shop = {
  cards: [],
  relics: [{ relicId: "bronze_scales", price: 5 }],
  potions: [],
  boons: [],
  healPrice: 45,
  removePrice: 5,
  restockPrice: 5,
};
duplicateRelicShopRun.player.gold = 10;
duplicateRelicShopRun.player.relics.push("bronze_scales");
duplicateRelicShopRun = buyShopRelic(duplicateRelicShopRun, 0);
assert(duplicateRelicShopRun.player.gold === 10, "duplicate relic shop offer should not spend gold");
assert(duplicateRelicShopRun.player.relics.filter((relicId) => relicId === "bronze_scales").length === 1, "duplicate relic shop offer should not add another copy");
assert(duplicateRelicShopRun.shop!.relics[0].sold, "duplicate relic offer should be cleared from shop");

let fullHpHealShopRun = createInitialRun(882, "shop", "standard");
fullHpHealShopRun.shop = {
  cards: [],
  relics: [],
  potions: [],
  boons: [],
  healPrice: 5,
  removePrice: 5,
  restockPrice: 5,
};
fullHpHealShopRun.player.gold = 20;
fullHpHealShopRun.player.hp = fullHpHealShopRun.player.maxHp;
fullHpHealShopRun = buyShopHeal(fullHpHealShopRun);
assert(fullHpHealShopRun.player.gold === 20, "full hp shop heal should not spend gold");
assert(!fullHpHealShopRun.shop!.healSold, "full hp shop heal should not mark heal sold");
assert(fullHpHealShopRun.message === "生命已满。", "full hp shop heal should explain the blocked purchase");

let invalidPriceShopRun = createInitialRun(883, "shop", "standard");
invalidPriceShopRun.shop = {
  cards: [],
  relics: [{ relicId: "bronze_scales", price: Number.NaN }],
  potions: [{ potionId: "strength_potion", price: Number.NaN }],
  boons: [{ boonId: "plate_training", price: Number.NaN }],
  healPrice: Number.NaN,
  removePrice: Number.NaN,
  restockPrice: Number.NaN,
};
invalidPriceShopRun.player.gold = 10;
invalidPriceShopRun = buyShopRelic(invalidPriceShopRun, 0);
invalidPriceShopRun = buyShopPotion(invalidPriceShopRun, 0);
invalidPriceShopRun = buyShopBoon(invalidPriceShopRun, 0);
invalidPriceShopRun = buyShopRemove(invalidPriceShopRun, invalidPriceShopRun.player.deck[0].uid);
invalidPriceShopRun = buyShopHeal(invalidPriceShopRun);
invalidPriceShopRun = restockShop(invalidPriceShopRun);
assert(invalidPriceShopRun.player.gold === 10, "invalid shop prices should not spend gold");
assert(Number.isFinite(invalidPriceShopRun.player.gold), "invalid shop prices should not poison gold with NaN");

let restockRun = createInitialRun(886, "shop", "standard");
restockRun.shop = {
  cards: [{ cardId: "cleave", upgraded: false, price: 1 }],
  relics: [],
  potions: [],
  boons: [],
  healPrice: 45,
  removePrice: 5,
  restockPrice: 5,
};
restockRun.player.gold = 20;
const restockOriginalCards = restockRun.shop.cards.map((offer) => offer.cardId).join(",");
restockRun = restockShop(restockRun);
assert(restockRun.player.gold === 15, "restocking should spend gold");
assert(restockRun.shop?.restocked, "restocking should mark shop as restocked");
assert(restockRun.shop!.cards.length > 0, "restocking should create card offers");
assert(restockRun.shop!.cards.map((offer) => offer.cardId).join(",") !== restockOriginalCards, "restocking should replace card offers");
const restockGoldAfterFirst = restockRun.player.gold;
restockRun = restockShop(restockRun);
assert(restockRun.player.gold === restockGoldAfterFirst, "restocking should be limited to once per shop");

let shopRemoveRun = createInitialRun(887, "map", "standard");
shopRemoveRun.phase = "shop";
shopRemoveRun.shop = {
  cards: [],
  relics: [],
  potions: [],
  boons: [],
  healPrice: 45,
  removePrice: 5,
  restockPrice: 5,
};
shopRemoveRun.player.gold = 10;
const removeUid = shopRemoveRun.player.deck.find((card) => card.cardId === "strike")!.uid;
const removeDeckBefore = shopRemoveRun.player.deck.length;
shopRemoveRun = buyShopRemove(shopRemoveRun, removeUid);
assert(shopRemoveRun.player.gold === 5, "shop remove should spend gold");
assert(shopRemoveRun.player.deck.length === removeDeckBefore - 1, "shop remove should delete one card");
assert(!shopRemoveRun.player.deck.some((card) => card.uid === removeUid), "shop remove should delete the selected card");
const afterFirstRemove = shopRemoveRun.player.deck.length;
shopRemoveRun = buyShopRemove(shopRemoveRun, shopRemoveRun.player.deck[0].uid);
assert(shopRemoveRun.player.deck.length === afterFirstRemove, "shop remove should be limited to once per shop");

let shopBoonRun = createInitialRun(889, "map", "standard");
shopBoonRun.phase = "shop";
shopBoonRun.shop = {
  cards: [],
  relics: [],
  potions: [],
  boons: [{ boonId: "plate_training", price: 1 }],
  healPrice: 45,
  removePrice: 5,
  restockPrice: 5,
};
shopBoonRun.player.gold = 10;
shopBoonRun = buyShopBoon(shopBoonRun, 0);
assert(shopBoonRun.player.gold === 9, "buying boon should spend gold");
assert(shopBoonRun.player.boons.includes("plate_training"), "shop boon should enter permanent boon list");

let alchemistRun = createInitialRun(890, "map", "standard");
alchemistRun.phase = "event";
alchemistRun.event = {
  id: "alchemist_table",
  title: "测试炼金",
  text: "",
  options: [{ id: "brew", label: "调制", text: "" }],
};
alchemistRun = chooseEventOption(alchemistRun, "brew");
assert(alchemistRun.phase === "map", "event choice should return to map");
assert(alchemistRun.player.potions.length === 1, "alchemist brew should grant a potion");

let staleFullBrewRun = createInitialRun(921, "map", "standard");
staleFullBrewRun.phase = "event";
staleFullBrewRun.event = {
  id: "alchemist_table",
  title: "旧存档炼金",
  text: "",
  options: [{ id: "brew", label: "调制", text: "" }],
};
staleFullBrewRun.player.potions = [
  makePotionInstance("fire_potion"),
  makePotionInstance("block_potion"),
  makePotionInstance("energy_potion"),
];
const refreshedBrewEvent = getCurrentEvent(staleFullBrewRun);
assert(refreshedBrewEvent?.options.find((option) => option.id === "brew")?.disabled, "refreshed event should mark full potion brew disabled");
staleFullBrewRun = chooseEventOption(staleFullBrewRun, "brew");
assert(staleFullBrewRun.phase === "event", "stale disabled event option should keep the event open");
assert(staleFullBrewRun.player.potions.length === 3, "stale disabled brew should not overfill potions");
assert(staleFullBrewRun.message?.includes("药水槽已满"), "stale disabled brew should explain potion capacity");

let cappedAlchemyRackRun = createInitialRun(917, "map", "standard");
cappedAlchemyRackRun.phase = "event";
cappedAlchemyRackRun.event = {
  id: "alchemist_table",
  title: "测试瓶架上限",
  text: "",
  options: [{ id: "rack", label: "买瓶架", text: "" }],
};
cappedAlchemyRackRun.player.gold = 100;
cappedAlchemyRackRun.player.potionSlots = 5;
cappedAlchemyRackRun = chooseEventOption(cappedAlchemyRackRun, "rack");
assert(cappedAlchemyRackRun.player.gold === 100, "capped alchemist rack should not spend gold");
assert(cappedAlchemyRackRun.player.potionSlots === 5, "alchemist rack should respect potion slot cap");
assert(cappedAlchemyRackRun.phase === "event", "capped alchemist rack should keep the event open");

let fullRelicShrineRun = createInitialRun(904, "map", "standard");
fullRelicShrineRun.phase = "event";
fullRelicShrineRun.event = {
  id: "blood_shrine",
  title: "测试血泉",
  text: "",
  options: [{ id: "offer", label: "献祭", text: "" }],
};
fullRelicShrineRun.player.relics = [...RELIC_POOL];
const fullRelicHpBefore = fullRelicShrineRun.player.hp;
fullRelicShrineRun = chooseEventOption(fullRelicShrineRun, "offer");
assert(fullRelicShrineRun.player.hp === fullRelicHpBefore, "full relic shrine should not cost hp");
assert(fullRelicShrineRun.player.relics.length === RELIC_POOL.length, "full relic shrine should not add relics");
assert(fullRelicShrineRun.phase === "event", "full relic shrine should keep the event open");
assert(fullRelicShrineRun.message?.includes("遗物已满"), "full relic shrine should explain that relic capacity is full");

let staticRun = createInitialRun(891, "map", "standard");
staticRun.phase = "event";
staticRun.event = {
  id: "static_obelisk",
  title: "测试静电",
  text: "",
  options: [{ id: "attune", label: "调谐", text: "" }],
};
const staticHpBefore = staticRun.player.hp;
staticRun = chooseEventOption(staticRun, "attune");
assert(staticRun.player.hp === staticHpBefore - 6, "static attunement event should cost hp");
assert(staticRun.player.boons.includes("static_attunement"), "static attunement event should grant boon");

let mirrorRun = createInitialRun(892, "map", "standard");
mirrorRun.phase = "event";
mirrorRun.event = {
  id: "living_mirror",
  title: "测试活镜",
  text: "",
  options: [{ id: "copy", label: "复制", text: "" }],
};
const mirrorDeckBefore = mirrorRun.player.deck.length;
mirrorRun = chooseEventOption(mirrorRun, "copy");
assert(mirrorRun.player.deck.length === mirrorDeckBefore + 1, "living mirror should duplicate a non-starter card");

let archiveRun = createInitialRun(893, "map", "standard");
archiveRun.phase = "event";
archiveRun.event = {
  id: "cursed_archive",
  title: "测试档案",
  text: "",
  options: [{ id: "erase", label: "抹去", text: "" }],
};
const archiveDeckBefore = archiveRun.player.deck.length;
const archiveHpBefore = archiveRun.player.hp;
archiveRun = chooseEventOption(archiveRun, "erase");
assert(archiveRun.player.deck.length === archiveDeckBefore - 1, "cursed archive erase should remove a card");
assert(archiveRun.player.hp === archiveHpBefore - 6, "cursed archive erase should cost hp");

let stormRun = createInitialRun(894, "map", "standard");
stormRun.phase = "event";
stormRun.event = {
  id: "storm_chest",
  title: "测试风暴匣",
  text: "",
  options: [{ id: "socket", label: "嵌入", text: "" }],
};
stormRun.player.potions = [];
stormRun = chooseEventOption(stormRun, "socket");
assert(stormRun.phase === "map", "storm chest should return to map");
assert(
  stormRun.player.deck.some((card) => card.cardId === "capacitor" && card.upgraded),
  "storm chest socket should grant capacitor+",
);
assert(stormRun.player.potions.some((potion) => potion.potionId === "charge_potion"), "storm chest should grant charge potion");

let carverRun = createInitialRun(895, "map", "standard");
carverRun.phase = "event";
carverRun.event = {
  id: "boon_carver",
  title: "测试刻纹",
  text: "",
  options: [{ id: "commission", label: "支付", text: "" }],
};
carverRun.player.gold = 80;
carverRun = chooseEventOption(carverRun, "commission");
assert(carverRun.player.gold === 30, "boon carver commission should spend gold");
assert(carverRun.player.boons.length === 1, "boon carver commission should grant a boon");

let fullBoonCarverRun = createInitialRun(905, "map", "standard");
fullBoonCarverRun.phase = "event";
fullBoonCarverRun.event = {
  id: "boon_carver",
  title: "测试满常驻",
  text: "",
  options: [{ id: "commission", label: "支付", text: "" }],
};
fullBoonCarverRun.player.gold = 80;
fullBoonCarverRun.player.boons = [...BOON_POOL];
fullBoonCarverRun = chooseEventOption(fullBoonCarverRun, "commission");
assert(fullBoonCarverRun.player.gold === 80, "full boon carver should not spend gold");
assert(fullBoonCarverRun.phase === "event", "full boon carver should keep the event open");
assert(fullBoonCarverRun.message?.includes("常驻提升已满"), "full boon carver should explain boon capacity is full");

let clinicRun = createInitialRun(896, "map", "standard");
clinicRun.phase = "event";
clinicRun.event = {
  id: "quiet_clinic",
  title: "测试诊所",
  text: "",
  options: [{ id: "cleanse", label: "清创", text: "" }],
};
clinicRun.player.gold = 40;
const clinicBurn = makeCardInstance("burn");
clinicRun.player.deck.push(clinicBurn);
clinicRun = chooseEventOption(clinicRun, "cleanse");
assert(clinicRun.player.gold === 10, "quiet clinic cleanse should spend gold");
assert(!clinicRun.player.deck.some((card) => card.uid === clinicBurn.uid), "quiet clinic cleanse should remove a status");

let staleClinicRun = createInitialRun(922, "map", "standard");
staleClinicRun.phase = "event";
staleClinicRun.event = {
  id: "quiet_clinic",
  title: "旧存档诊所",
  text: "",
  options: [{ id: "cleanse", label: "清创", text: "" }],
};
staleClinicRun.player.gold = 40;
staleClinicRun = chooseEventOption(staleClinicRun, "cleanse");
assert(staleClinicRun.phase === "event", "stale clinic cleanse should keep the event open");
assert(staleClinicRun.player.gold === 40, "stale clinic cleanse should not spend gold without a status card");
assert(staleClinicRun.message?.includes("没有状态牌"), "stale clinic cleanse should explain missing status cards");

let memoryRun = createInitialRun(901, "map", "standard");
memoryRun.phase = "event";
memoryRun.event = {
  id: "memory_well",
  title: "测试记忆井",
  text: "",
  options: [{ id: "dredge", label: "打捞", text: "" }],
};
memoryRun.player.gold = 50;
const memoryWound = makeCardInstance("wound");
memoryRun.player.deck.push(memoryWound);
memoryRun = chooseEventOption(memoryRun, "dredge");
assert(memoryRun.player.gold === 15, "memory well dredge should spend gold");
assert(memoryRun.player.deck.some((card) => card.cardId === "salvage" && card.upgraded), "memory well should grant salvage+");
assert(!memoryRun.player.deck.some((card) => card.uid === memoryWound.uid), "memory well should remove a status when present");

let forgeRun = createInitialRun(897, "map", "standard");
forgeRun.phase = "event";
forgeRun.event = {
  id: "rune_forge",
  title: "测试熔炉",
  text: "",
  options: [{ id: "etch", label: "刻蚀", text: "" }],
};
forgeRun.player.gold = 100;
forgeRun = chooseEventOption(forgeRun, "etch");
assert(forgeRun.player.gold === 55, "rune forge etch should spend gold");
assert(forgeRun.player.deck.filter((card) => card.upgraded).length >= 2, "rune forge etch should upgrade cards");

let staleForgeRun = createInitialRun(923, "map", "standard");
staleForgeRun.phase = "event";
staleForgeRun.event = {
  id: "rune_forge",
  title: "旧存档熔炉",
  text: "",
  options: [{ id: "etch", label: "刻蚀", text: "" }],
};
staleForgeRun.player.gold = 100;
staleForgeRun.player.deck.forEach((card) => {
  card.upgraded = true;
});
staleForgeRun = chooseEventOption(staleForgeRun, "etch");
assert(staleForgeRun.phase === "event", "stale rune forge etch should keep the event open");
assert(staleForgeRun.player.gold === 100, "stale rune forge etch should not spend gold without upgrade targets");
assert(staleForgeRun.message?.includes("没有可升级牌"), "stale rune forge etch should explain missing upgrade targets");

let venomRun = createInitialRun(902, "map", "standard");
venomRun.phase = "event";
venomRun.event = {
  id: "venom_greenhouse",
  title: "测试温室",
  text: "",
  options: [{ id: "coat_blade", label: "涂刃", text: "" }],
};
venomRun.player.gold = 40;
venomRun = chooseEventOption(venomRun, "coat_blade");
assert(venomRun.player.gold === 10, "venom greenhouse coat should spend gold");
assert(venomRun.player.boons.includes("blade_oil"), "venom greenhouse should grant blade oil");

let platedEventRun = createInitialRun(903, "map", "standard");
platedEventRun.phase = "event";
platedEventRun.event = {
  id: "plated_sanctum",
  title: "测试圣坛",
  text: "",
  options: [{ id: "train_plate", label: "演练", text: "" }],
};
platedEventRun.player.gold = 60;
platedEventRun = chooseEventOption(platedEventRun, "train_plate");
assert(platedEventRun.player.gold === 15, "plated sanctum training should spend gold");
assert(platedEventRun.player.boons.includes("plate_training"), "plated sanctum should grant plate training");

let spiritRun = createInitialRun(898, "map", "standard");
spiritRun.phase = "event";
spiritRun.event = {
  id: "bottled_spirit",
  title: "测试精魂",
  text: "",
  options: [{ id: "release", label: "释放", text: "" }],
};
spiritRun.player.potions = [makePotionInstance("energy_potion")];
spiritRun = chooseEventOption(spiritRun, "release");
assert(spiritRun.player.potions.length === 0, "bottled spirit release should consume a potion");
assert(spiritRun.player.boons.length === 1, "bottled spirit release should grant a boon");

let fullBoonSpiritRun = createInitialRun(906, "map", "standard");
fullBoonSpiritRun.phase = "event";
fullBoonSpiritRun.event = {
  id: "bottled_spirit",
  title: "测试满精魂",
  text: "",
  options: [{ id: "release", label: "释放", text: "" }],
};
fullBoonSpiritRun.player.boons = [...BOON_POOL];
fullBoonSpiritRun.player.potions = [makePotionInstance("energy_potion")];
fullBoonSpiritRun = chooseEventOption(fullBoonSpiritRun, "release");
assert(fullBoonSpiritRun.player.potions.length === 1, "full boon bottled spirit should not consume a potion");
assert(fullBoonSpiritRun.phase === "event", "full boon bottled spirit should keep the event open");

let scoutRun = createInitialRun(899, "map", "standard");
const scoutNode = scoutRun.map.find((node) => node.floor === 0)!;
scoutNode.type = "event";
scoutRun.currentNodeId = scoutNode.id;
scoutRun.phase = "event";
scoutRun.event = {
  id: "path_scout",
  title: "测试侦察",
  text: "",
  options: [{ id: "chart_rest", label: "安全路线", text: "" }],
};
scoutRun.player.gold = 60;
const scoutChildren = scoutNode.children;
assert(scoutChildren.length > 0, "scout test node should have children");
scoutRun = chooseEventOption(scoutRun, "chart_rest");
assert(scoutRun.player.gold === 30, "path scout chart should spend gold");
const convertedRestNode = scoutRun.map.find((node) => scoutChildren.includes(node.id) && node.type === "rest");
assert(
  convertedRestNode,
  "path scout chart should convert a next route node to rest",
);
assert(getAvailableNodeIds(scoutRun).includes(convertedRestNode.id), "converted rest node should remain reachable");
const enteredConvertedRest = enterNode(scoutRun, convertedRestNode.id);
assert(enteredConvertedRest.phase === "rest", "converted rest node should enter rest phase");

let flaskTransfuseRun = createInitialRun(907, "map", "standard");
flaskTransfuseRun.phase = "event";
flaskTransfuseRun.event = {
  id: "flask_gambit",
  title: "测试瓶匣",
  text: "",
  options: [{ id: "transfuse", label: "转注", text: "" }],
};
const transfusedPotion = makePotionInstance("energy_potion");
flaskTransfuseRun.player.potions = [transfusedPotion];
flaskTransfuseRun = chooseEventOption(flaskTransfuseRun, "transfuse");
assert(!flaskTransfuseRun.player.potions.some((potion) => potion.uid === transfusedPotion.uid), "flask gambit should consume the selected resource potion");
assert(flaskTransfuseRun.player.boons.length === 1, "flask gambit should convert a potion into a boon");

let flaskOverbrewRun = createInitialRun(908, "map", "standard");
flaskOverbrewRun.phase = "event";
flaskOverbrewRun.event = {
  id: "flask_gambit",
  title: "测试补药",
  text: "",
  options: [{ id: "overbrew", label: "补满", text: "" }],
};
flaskOverbrewRun.player.gold = 28;
flaskOverbrewRun.player.potions = [];
flaskOverbrewRun = chooseEventOption(flaskOverbrewRun, "overbrew");
assert(flaskOverbrewRun.player.gold === 0, "flask overbrew should spend gold");
assert(flaskOverbrewRun.player.potions.length === flaskOverbrewRun.player.potionSlots, "flask overbrew should fill empty potion slots");

let flaskCaseRun = createInitialRun(909, "map", "standard");
flaskCaseRun.phase = "event";
flaskCaseRun.event = {
  id: "flask_gambit",
  title: "测试瓶匣扩容",
  text: "",
  options: [{ id: "crack_case", label: "扩容", text: "" }],
};
const caseSlotsBefore = flaskCaseRun.player.potionSlots;
flaskCaseRun = chooseEventOption(flaskCaseRun, "crack_case");
assert(flaskCaseRun.player.potionSlots === caseSlotsBefore + 1, "cracking flask case should increase potion slots");
assert(flaskCaseRun.player.deck.some((card) => card.cardId === "slimed"), "cracking flask case should add slimed");

let cappedFlaskCaseRun = createInitialRun(915, "map", "standard");
cappedFlaskCaseRun.phase = "event";
cappedFlaskCaseRun.event = {
  id: "flask_gambit",
  title: "测试瓶匣上限",
  text: "",
  options: [{ id: "crack_case", label: "扩容", text: "" }],
};
cappedFlaskCaseRun.player.potionSlots = 5;
cappedFlaskCaseRun = chooseEventOption(cappedFlaskCaseRun, "crack_case");
assert(cappedFlaskCaseRun.player.potionSlots === 5, "flask case should respect potion slot cap");
assert(!cappedFlaskCaseRun.player.deck.some((card) => card.cardId === "slimed"), "capped flask case should not add a drawback");

let tinkerTuneRun = createInitialRun(910, "map", "standard");
tinkerTuneRun.phase = "event";
tinkerTuneRun.event = {
  id: "relic_tinker",
  title: "测试修理工",
  text: "",
  options: [{ id: "tune", label: "校准", text: "" }],
};
tinkerTuneRun.player.gold = 55;
tinkerTuneRun = chooseEventOption(tinkerTuneRun, "tune");
assert(tinkerTuneRun.player.gold === 0, "relic tinker tune should spend gold");
assert(tinkerTuneRun.player.relics.length === 2, "relic tinker tune should grant a relic");
assert(tinkerTuneRun.player.deck.some((card) => card.upgraded), "relic tinker tune should upgrade a card");

let tinkerPawnRun = createInitialRun(911, "map", "standard");
tinkerPawnRun.phase = "event";
tinkerPawnRun.event = {
  id: "relic_tinker",
  title: "测试典当",
  text: "",
  options: [{ id: "pawn", label: "典当", text: "" }],
};
tinkerPawnRun.player.relics.push("anchor");
tinkerPawnRun = chooseEventOption(tinkerPawnRun, "pawn");
assert(!tinkerPawnRun.player.relics.includes("anchor"), "relic tinker pawn should remove a non-starter relic");
assert(tinkerPawnRun.player.gold > DIFFICULTIES.standard.startingGold, "relic tinker pawn should grant gold");
assert(tinkerPawnRun.player.deck.filter((card) => card.upgraded).length >= 2, "relic tinker pawn should upgrade cards");

let fractureGateRun = createInitialRun(912, "map", "standard");
fractureGateRun.phase = "event";
fractureGateRun.event = {
  id: "fracture_gate",
  title: "测试裂纹门",
  text: "",
  options: [{ id: "step_through", label: "穿过", text: "" }],
};
const fractureHpBefore = fractureGateRun.player.hp;
fractureGateRun.player.potions = [];
fractureGateRun = chooseEventOption(fractureGateRun, "step_through");
assert(fractureGateRun.player.hp === fractureHpBefore - 9, "fracture gate step should cost hp");
assert(
  fractureGateRun.player.deck.some((card) => card.cardId === "fracture_thrust" && card.upgraded),
  "fracture gate step should grant fracture thrust+",
);
assert(fractureGateRun.player.potions.some((potion) => potion.potionId === "fracture_potion"), "fracture gate step should grant fracture potion when space exists");

let fractureMapRun = createInitialRun(913, "map", "standard");
fractureMapRun.phase = "event";
fractureMapRun.event = {
  id: "fracture_gate",
  title: "测试裂纹图谱",
  text: "",
  options: [{ id: "map_cracks", label: "描摹", text: "" }],
};
fractureMapRun.player.gold = 35;
fractureMapRun = chooseEventOption(fractureMapRun, "map_cracks");
assert(fractureMapRun.player.gold === 0, "fracture gate map should spend gold");
assert(fractureMapRun.player.boons.includes("weakpoint_chart"), "fracture gate map should grant weakpoint chart");

let fractureSealRun = createInitialRun(914, "map", "standard");
fractureSealRun.phase = "event";
fractureSealRun.event = {
  id: "fracture_gate",
  title: "测试封门",
  text: "",
  options: [{ id: "seal_gate", label: "封门", text: "" }],
};
fractureSealRun.player.hp = 40;
fractureSealRun = chooseEventOption(fractureSealRun, "seal_gate");
assert(fractureSealRun.player.hp === 50, "fracture gate seal should heal");
assert(fractureSealRun.player.deck.some((card) => card.cardId === "dazed"), "fracture gate seal should add dazed");

let catalystLabBoonRun = createInitialRun(918, "map", "standard");
catalystLabBoonRun.phase = "event";
catalystLabBoonRun.event = {
  id: "catalyst_lab",
  title: "测试催化台",
  text: "",
  options: [{ id: "learn_pattern", label: "记录", text: "" }],
};
catalystLabBoonRun.player.gold = 40;
catalystLabBoonRun = chooseEventOption(catalystLabBoonRun, "learn_pattern");
assert(catalystLabBoonRun.player.gold === 0, "catalyst lab pattern should spend gold");
assert(catalystLabBoonRun.player.boons.includes("catalyst_training"), "catalyst lab pattern should grant catalyst training");

let catalystLabPotionRun = createInitialRun(919, "map", "standard");
catalystLabPotionRun.phase = "event";
catalystLabPotionRun.event = {
  id: "catalyst_lab",
  title: "测试催化药水",
  text: "",
  options: [{ id: "take_vial", label: "试剂", text: "" }],
};
catalystLabPotionRun.player.potions = [];
catalystLabPotionRun = chooseEventOption(catalystLabPotionRun, "take_vial");
assert(catalystLabPotionRun.player.potions.some((potion) => potion.potionId === "catalyst_potion"), "catalyst lab vial should grant catalyst potion");

let catalystLabCardRun = createInitialRun(920, "map", "standard");
catalystLabCardRun.phase = "event";
catalystLabCardRun.event = {
  id: "catalyst_lab",
  title: "测试催化配方",
  text: "",
  options: [{ id: "record_formula", label: "配方", text: "" }],
};
const catalystFormulaHp = catalystLabCardRun.player.hp;
catalystLabCardRun = chooseEventOption(catalystLabCardRun, "record_formula");
assert(catalystLabCardRun.player.hp === catalystFormulaHp - 6, "catalyst lab formula should cost hp");
assert(
  catalystLabCardRun.player.deck.some((card) => card.cardId === "blood_catalyst" && card.upgraded),
  "catalyst lab formula should grant blood catalyst+",
);
assert(catalystLabCardRun.player.deck.some((card) => card.cardId === "burn"), "catalyst lab formula should add burn");

let staleCatalystFormulaRun = createInitialRun(924, "map", "standard");
staleCatalystFormulaRun.phase = "event";
staleCatalystFormulaRun.event = {
  id: "catalyst_lab",
  title: "旧存档催化配方",
  text: "",
  options: [{ id: "record_formula", label: "配方", text: "" }],
};
staleCatalystFormulaRun.player.hp = 6;
const staleCatalystDeckBefore = staleCatalystFormulaRun.player.deck.length;
staleCatalystFormulaRun = chooseEventOption(staleCatalystFormulaRun, "record_formula");
assert(staleCatalystFormulaRun.phase === "event", "stale catalyst formula should keep the event open");
assert(staleCatalystFormulaRun.player.hp === 6, "stale catalyst formula should not spend hp when life is insufficient");
assert(staleCatalystFormulaRun.player.deck.length === staleCatalystDeckBefore, "stale catalyst formula should not add cards when disabled");
assert(staleCatalystFormulaRun.message?.includes("生命不足"), "stale catalyst formula should explain insufficient hp");

let coilPlateRun = createInitialRun(930, "map", "standard");
coilPlateRun.phase = "event";
coilPlateRun.event = {
  id: "coil_workbench",
  title: "测试线圈防护匣",
  text: "",
  options: [{ id: "plate_cache", label: "防护匣", text: "" }],
};
coilPlateRun.player.gold = 35;
coilPlateRun.player.potions = [];
coilPlateRun = chooseEventOption(coilPlateRun, "plate_cache");
assert(coilPlateRun.phase === "map", "coil workbench plate cache should finish the event");
assert(coilPlateRun.player.gold === 0, "coil workbench plate cache should spend gold");
assert(coilPlateRun.player.deck.some((card) => card.cardId === "alloy_shell" && card.upgraded), "coil workbench plate cache should grant alloy shell+");
assert(coilPlateRun.player.potions.some((potion) => potion.potionId === "alloy_potion"), "coil workbench plate cache should grant alloy potion when space exists");

let coilWindRun = createInitialRun(931, "map", "standard");
coilWindRun.phase = "event";
coilWindRun.event = {
  id: "coil_workbench",
  title: "测试线圈过载",
  text: "",
  options: [{ id: "wind_coil", label: "过载", text: "" }],
};
coilWindRun.player.potions = [
  makePotionInstance("fire_potion"),
  makePotionInstance("block_potion"),
  makePotionInstance("energy_potion"),
];
const coilWindHpBefore = coilWindRun.player.hp;
coilWindRun = chooseEventOption(coilWindRun, "wind_coil");
assert(coilWindRun.phase === "map", "coil workbench wind coil should finish the event");
assert(coilWindRun.player.hp === coilWindHpBefore - 5, "coil workbench wind coil should spend hp");
assert(coilWindRun.player.deck.some((card) => card.cardId === "coil_lash" && card.upgraded), "coil workbench wind coil should grant coil lash+");
assert(coilWindRun.player.potions.length === 3, "coil workbench wind coil should not overfill potions");

let coilBoonRun = createInitialRun(932, "map", "standard");
coilBoonRun.phase = "event";
coilBoonRun.event = {
  id: "coil_workbench",
  title: "测试线圈常驻",
  text: "",
  options: [{ id: "temper_shell", label: "淬火", text: "" }],
};
coilBoonRun.player.gold = 45;
coilBoonRun = chooseEventOption(coilBoonRun, "temper_shell");
assert(coilBoonRun.phase === "map", "coil workbench tempered shell should finish the event");
assert(coilBoonRun.player.gold === 0, "coil workbench tempered shell should spend gold");
assert(coilBoonRun.player.boons.includes("tempered_shell"), "coil workbench tempered shell should grant the boon");

let staleCoilBoonRun = createInitialRun(933, "map", "standard");
staleCoilBoonRun.phase = "event";
staleCoilBoonRun.event = {
  id: "coil_workbench",
  title: "旧存档线圈常驻",
  text: "",
  options: [{ id: "temper_shell", label: "淬火", text: "" }],
};
staleCoilBoonRun.player.gold = 45;
staleCoilBoonRun.player.boons.push("tempered_shell");
staleCoilBoonRun = chooseEventOption(staleCoilBoonRun, "temper_shell");
assert(staleCoilBoonRun.phase === "event", "stale coil boon should keep the event open");
assert(staleCoilBoonRun.player.gold === 45, "stale coil boon should not spend gold when already owned");
assert(staleCoilBoonRun.message?.includes("已拥有"), "stale coil boon should explain duplicate boon");

let blackRelicRun = createInitialRun(934, "map", "standard");
blackRelicRun.phase = "event";
blackRelicRun.event = {
  id: "black_contract",
  title: "测试黑市遗物",
  text: "",
  options: [{ id: "underwrite", label: "担保", text: "" }],
};
blackRelicRun.player.gold = 55;
const blackRelicCountBefore = blackRelicRun.player.relics.length;
blackRelicRun = chooseEventOption(blackRelicRun, "underwrite");
assert(blackRelicRun.phase === "map", "black contract underwrite should finish the event");
assert(blackRelicRun.player.gold === 0, "black contract underwrite should spend gold");
assert(blackRelicRun.player.relics.length === blackRelicCountBefore + 1, "black contract underwrite should grant a relic");

let blackBloodRun = createInitialRun(935, "map", "standard");
blackBloodRun.phase = "event";
blackBloodRun.event = {
  id: "black_contract",
  title: "测试黑市血契",
  text: "",
  options: [{ id: "blood_clause", label: "血契", text: "" }],
};
const blackBloodMaxBefore = blackBloodRun.player.maxHp;
const blackBloodDeckBefore = blackBloodRun.player.deck.length;
blackBloodRun = chooseEventOption(blackBloodRun, "blood_clause");
assert(blackBloodRun.phase === "map", "black contract blood clause should finish the event");
assert(blackBloodRun.player.maxHp === blackBloodMaxBefore - 6, "black contract blood clause should reduce max hp");
assert(blackBloodRun.player.deck.length === blackBloodDeckBefore + 1, "black contract blood clause should grant a rare card");

let blackContrabandRun = createInitialRun(936, "map", "standard");
blackContrabandRun.phase = "event";
blackContrabandRun.event = {
  id: "black_contract",
  title: "测试黑市补给",
  text: "",
  options: [{ id: "contraband", label: "补给", text: "" }],
};
blackContrabandRun.player.potions = [
  makePotionInstance("fire_potion"),
  makePotionInstance("block_potion"),
  makePotionInstance("energy_potion"),
];
blackContrabandRun = chooseEventOption(blackContrabandRun, "contraband");
assert(blackContrabandRun.phase === "map", "black contract contraband should finish the event");
assert(blackContrabandRun.player.potions.length === 3, "black contract contraband should not overfill potions");
assert(blackContrabandRun.player.deck.some((card) => card.cardId === "alloy_shell"), "black contract contraband should grant alloy shell");
assert(blackContrabandRun.player.deck.some((card) => card.cardId === "wound"), "black contract contraband should add wound");

let staleBlackRelicRun = createInitialRun(937, "map", "standard");
staleBlackRelicRun.phase = "event";
staleBlackRelicRun.event = {
  id: "black_contract",
  title: "旧存档黑市遗物",
  text: "",
  options: [{ id: "underwrite", label: "担保", text: "" }],
};
staleBlackRelicRun.player.gold = 55;
staleBlackRelicRun.player.relics = [...RELIC_POOL];
staleBlackRelicRun = chooseEventOption(staleBlackRelicRun, "underwrite");
assert(staleBlackRelicRun.phase === "event", "stale black contract relic should keep the event open");
assert(staleBlackRelicRun.player.gold === 55, "stale black contract relic should not spend gold when relics are full");
assert(staleBlackRelicRun.message?.includes("遗物已满"), "stale black contract relic should explain relic capacity");

let strategyManualRun = createInitialRun(938, "map", "standard");
strategyManualRun.phase = "event";
strategyManualRun.event = {
  id: "strategy_table",
  title: "测试战术卡牌",
  text: "",
  options: [{ id: "manual", label: "预案", text: "" }],
};
strategyManualRun.player.gold = 32;
strategyManualRun = chooseEventOption(strategyManualRun, "manual");
assert(strategyManualRun.phase === "map", "strategy table manual should finish the event");
assert(strategyManualRun.player.gold === 0, "strategy table manual should spend gold");
assert(strategyManualRun.player.deck.some((card) => card.cardId === "field_tactics" && card.upgraded), "strategy table manual should grant field tactics+");

let strategyKitRun = createInitialRun(939, "map", "standard");
strategyKitRun.phase = "event";
strategyKitRun.event = {
  id: "strategy_table",
  title: "测试战术药水",
  text: "",
  options: [{ id: "kit", label: "药剂", text: "" }],
};
strategyKitRun.player.gold = 24;
strategyKitRun.player.potions = [];
strategyKitRun = chooseEventOption(strategyKitRun, "kit");
assert(strategyKitRun.phase === "map", "strategy table kit should finish the event");
assert(strategyKitRun.player.gold === 0, "strategy table kit should spend gold");
assert(strategyKitRun.player.potions.some((potion) => potion.potionId === "tactics_potion"), "strategy table kit should grant tactics potion");

let strategyProtocolRun = createInitialRun(940, "map", "standard");
strategyProtocolRun.phase = "event";
strategyProtocolRun.event = {
  id: "strategy_table",
  title: "测试战术常驻",
  text: "",
  options: [{ id: "protocol", label: "协议", text: "" }],
};
strategyProtocolRun.player.gold = 48;
strategyProtocolRun = chooseEventOption(strategyProtocolRun, "protocol");
assert(strategyProtocolRun.phase === "map", "strategy table protocol should finish the event");
assert(strategyProtocolRun.player.gold === 0, "strategy table protocol should spend gold");
assert(strategyProtocolRun.player.boons.includes("field_protocol"), "strategy table protocol should grant field protocol");

let staleStrategyProtocolRun = createInitialRun(941, "map", "standard");
staleStrategyProtocolRun.phase = "event";
staleStrategyProtocolRun.event = {
  id: "strategy_table",
  title: "旧存档战术常驻",
  text: "",
  options: [{ id: "protocol", label: "协议", text: "" }],
};
staleStrategyProtocolRun.player.gold = 48;
staleStrategyProtocolRun.player.boons.push("field_protocol");
staleStrategyProtocolRun = chooseEventOption(staleStrategyProtocolRun, "protocol");
assert(staleStrategyProtocolRun.phase === "event", "stale strategy protocol should keep the event open");
assert(staleStrategyProtocolRun.player.gold === 48, "stale strategy protocol should not spend gold when already owned");
assert(staleStrategyProtocolRun.message?.includes("已拥有"), "stale strategy protocol should explain duplicate boon");

let staleStrategyKitRun = createInitialRun(942, "map", "standard");
staleStrategyKitRun.phase = "event";
staleStrategyKitRun.event = {
  id: "strategy_table",
  title: "旧存档战术药水",
  text: "",
  options: [{ id: "kit", label: "药剂", text: "" }],
};
staleStrategyKitRun.player.gold = 24;
staleStrategyKitRun.player.potions = [
  makePotionInstance("fire_potion"),
  makePotionInstance("block_potion"),
  makePotionInstance("energy_potion"),
];
staleStrategyKitRun = chooseEventOption(staleStrategyKitRun, "kit");
assert(staleStrategyKitRun.phase === "event", "stale strategy kit should keep the event open");
assert(staleStrategyKitRun.player.gold === 24, "stale strategy kit should not spend gold when potions are full");
assert(staleStrategyKitRun.message?.includes("药水槽已满"), "stale strategy kit should explain potion capacity");

let bannerCardRun = createInitialRun(943, "map", "standard");
bannerCardRun.phase = "event";
bannerCardRun.event = {
  id: "old_warbanner",
  title: "测试旧战旗卡牌",
  text: "",
  options: [{ id: "take_banner", label: "旗帜", text: "" }],
};
bannerCardRun.player.gold = 34;
bannerCardRun = chooseEventOption(bannerCardRun, "take_banner");
assert(bannerCardRun.phase === "map", "old warbanner card option should finish the event");
assert(bannerCardRun.player.gold === 0, "old warbanner card option should spend gold");
assert(bannerCardRun.player.deck.some((card) => card.cardId === "battle_rhythm" && card.upgraded), "old warbanner should grant battle rhythm+");

let bannerPotionRun = createInitialRun(944, "map", "standard");
bannerPotionRun.phase = "event";
bannerPotionRun.event = {
  id: "old_warbanner",
  title: "测试旧战旗药水",
  text: "",
  options: [{ id: "rally_dose", label: "军剂", text: "" }],
};
bannerPotionRun.player.gold = 24;
bannerPotionRun.player.potions = [];
bannerPotionRun = chooseEventOption(bannerPotionRun, "rally_dose");
assert(bannerPotionRun.phase === "map", "old warbanner potion option should finish the event");
assert(bannerPotionRun.player.gold === 0, "old warbanner potion option should spend gold");
assert(bannerPotionRun.player.potions.some((potion) => potion.potionId === "tactics_potion"), "old warbanner should grant tactics potion");

let bannerBoonRun = createInitialRun(945, "map", "standard");
bannerBoonRun.phase = "event";
bannerBoonRun.event = {
  id: "old_warbanner",
  title: "测试旧战旗常驻",
  text: "",
  options: [{ id: "learn_drill", label: "操典", text: "" }],
};
bannerBoonRun.player.gold = 48;
bannerBoonRun = chooseEventOption(bannerBoonRun, "learn_drill");
assert(bannerBoonRun.phase === "map", "old warbanner boon option should finish the event");
assert(bannerBoonRun.player.gold === 0, "old warbanner boon option should spend gold");
assert(bannerBoonRun.player.boons.includes("banner_drill"), "old warbanner should grant banner drill");

let staleBannerBoonRun = createInitialRun(946, "map", "standard");
staleBannerBoonRun.phase = "event";
staleBannerBoonRun.event = {
  id: "old_warbanner",
  title: "旧存档旧战旗常驻",
  text: "",
  options: [{ id: "learn_drill", label: "操典", text: "" }],
};
staleBannerBoonRun.player.gold = 48;
staleBannerBoonRun.player.boons.push("banner_drill");
staleBannerBoonRun = chooseEventOption(staleBannerBoonRun, "learn_drill");
assert(staleBannerBoonRun.phase === "event", "stale old warbanner boon should keep the event open");
assert(staleBannerBoonRun.player.gold === 48, "stale old warbanner boon should not spend gold when already owned");
assert(staleBannerBoonRun.message?.includes("已拥有"), "stale old warbanner boon should explain duplicate boon");

let staleBannerPotionRun = createInitialRun(947, "map", "standard");
staleBannerPotionRun.phase = "event";
staleBannerPotionRun.event = {
  id: "old_warbanner",
  title: "旧存档旧战旗药水",
  text: "",
  options: [{ id: "rally_dose", label: "军剂", text: "" }],
};
staleBannerPotionRun.player.gold = 24;
staleBannerPotionRun.player.potions = [
  makePotionInstance("fire_potion"),
  makePotionInstance("block_potion"),
  makePotionInstance("energy_potion"),
];
staleBannerPotionRun = chooseEventOption(staleBannerPotionRun, "rally_dose");
assert(staleBannerPotionRun.phase === "event", "stale old warbanner potion should keep the event open");
assert(staleBannerPotionRun.player.gold === 24, "stale old warbanner potion should not spend gold when potions are full");
assert(staleBannerPotionRun.message?.includes("药水槽已满"), "stale old warbanner potion should explain potion capacity");

let infirmaryManualRun = createInitialRun(929, "map", "standard");
infirmaryManualRun.phase = "event";
infirmaryManualRun.event = {
  id: "field_infirmary",
  title: "测试野战医帐卡牌",
  text: "",
  options: [{ id: "manual", label: "清创手册", text: "" }],
};
infirmaryManualRun.player.gold = 30;
infirmaryManualRun = chooseEventOption(infirmaryManualRun, "manual");
assert(infirmaryManualRun.phase === "map", "field infirmary manual should finish the event");
assert(infirmaryManualRun.player.gold === 0, "field infirmary manual should spend gold");
assert(infirmaryManualRun.player.deck.some((card) => card.cardId === "trauma_recycler" && card.upgraded), "field infirmary manual should grant trauma recycler+");

let infirmarySalveRun = createInitialRun(930, "map", "standard");
infirmarySalveRun.phase = "event";
infirmarySalveRun.event = {
  id: "field_infirmary",
  title: "测试野战医帐药水",
  text: "",
  options: [{ id: "salve", label: "清创剂", text: "" }],
};
infirmarySalveRun.player.gold = 24;
infirmarySalveRun.player.potions = [];
infirmarySalveRun = chooseEventOption(infirmarySalveRun, "salve");
assert(infirmarySalveRun.phase === "map", "field infirmary salve should finish the event");
assert(infirmarySalveRun.player.gold === 0, "field infirmary salve should spend gold");
assert(infirmarySalveRun.player.potions.some((potion) => potion.potionId === "triage_potion"), "field infirmary salve should grant triage potion");

let infirmaryDoctrineRun = createInitialRun(931, "map", "standard");
infirmaryDoctrineRun.phase = "event";
infirmaryDoctrineRun.event = {
  id: "field_infirmary",
  title: "测试野战医帐常驻",
  text: "",
  options: [{ id: "doctrine", label: "教范", text: "" }],
};
infirmaryDoctrineRun.player.gold = 50;
infirmaryDoctrineRun = chooseEventOption(infirmaryDoctrineRun, "doctrine");
assert(infirmaryDoctrineRun.phase === "map", "field infirmary doctrine should finish the event");
assert(infirmaryDoctrineRun.player.gold === 0, "field infirmary doctrine should spend gold");
assert(infirmaryDoctrineRun.player.boons.includes("triage_doctrine"), "field infirmary doctrine should grant triage doctrine");

let staleInfirmaryDoctrineRun = createInitialRun(932, "map", "standard");
staleInfirmaryDoctrineRun.phase = "event";
staleInfirmaryDoctrineRun.event = {
  id: "field_infirmary",
  title: "旧存档野战医帐常驻",
  text: "",
  options: [{ id: "doctrine", label: "教范", text: "" }],
};
staleInfirmaryDoctrineRun.player.gold = 50;
staleInfirmaryDoctrineRun.player.boons.push("triage_doctrine");
staleInfirmaryDoctrineRun = chooseEventOption(staleInfirmaryDoctrineRun, "doctrine");
assert(staleInfirmaryDoctrineRun.phase === "event", "stale field infirmary doctrine should keep the event open");
assert(staleInfirmaryDoctrineRun.player.gold === 50, "stale field infirmary doctrine should not spend gold");
assert(staleInfirmaryDoctrineRun.message?.includes("已拥有"), "stale field infirmary doctrine should explain duplicate boon");

let staleInfirmarySalveRun = createInitialRun(933, "map", "standard");
staleInfirmarySalveRun.phase = "event";
staleInfirmarySalveRun.event = {
  id: "field_infirmary",
  title: "旧存档野战医帐药水",
  text: "",
  options: [{ id: "salve", label: "清创剂", text: "" }],
};
staleInfirmarySalveRun.player.gold = 24;
staleInfirmarySalveRun.player.potions = [
  makePotionInstance("fire_potion"),
  makePotionInstance("block_potion"),
  makePotionInstance("energy_potion"),
];
staleInfirmarySalveRun = chooseEventOption(staleInfirmarySalveRun, "salve");
assert(staleInfirmarySalveRun.phase === "event", "stale field infirmary salve should keep the event open");
assert(staleInfirmarySalveRun.player.gold === 24, "stale field infirmary salve should not spend gold when full");
assert(staleInfirmarySalveRun.message?.includes("药水槽已满"), "stale field infirmary salve should explain potion capacity");

let ashArchiveWardRun = createInitialRun(934, "map", "standard");
ashArchiveWardRun.phase = "event";
ashArchiveWardRun.event = {
  id: "ash_archive",
  title: "测试余烬档案卡牌",
  text: "",
  options: [{ id: "ward", label: "护幕", text: "" }],
};
ashArchiveWardRun.player.gold = 32;
ashArchiveWardRun = chooseEventOption(ashArchiveWardRun, "ward");
assert(ashArchiveWardRun.phase === "map", "ash archive ward should finish the event");
assert(ashArchiveWardRun.player.gold === 0, "ash archive ward should spend gold");
assert(ashArchiveWardRun.player.deck.some((card) => card.cardId === "ash_ward" && card.upgraded), "ash archive ward should grant ash ward+");

let ashArchiveBottleRun = createInitialRun(935, "map", "standard");
ashArchiveBottleRun.phase = "event";
ashArchiveBottleRun.event = {
  id: "ash_archive",
  title: "测试余烬档案药水",
  text: "",
  options: [{ id: "bottle", label: "余烬药水", text: "" }],
};
ashArchiveBottleRun.player.gold = 24;
ashArchiveBottleRun.player.potions = [];
ashArchiveBottleRun = chooseEventOption(ashArchiveBottleRun, "bottle");
assert(ashArchiveBottleRun.phase === "map", "ash archive bottle should finish the event");
assert(ashArchiveBottleRun.player.gold === 0, "ash archive bottle should spend gold");
assert(ashArchiveBottleRun.player.potions.some((potion) => potion.potionId === "ash_potion"), "ash archive bottle should grant ash potion");

let ashArchiveLedgerRun = createInitialRun(936, "map", "standard");
ashArchiveLedgerRun.phase = "event";
ashArchiveLedgerRun.event = {
  id: "ash_archive",
  title: "测试余烬档案常驻",
  text: "",
  options: [{ id: "ledger", label: "账本", text: "" }],
};
ashArchiveLedgerRun.player.gold = 50;
ashArchiveLedgerRun = chooseEventOption(ashArchiveLedgerRun, "ledger");
assert(ashArchiveLedgerRun.phase === "map", "ash archive ledger should finish the event");
assert(ashArchiveLedgerRun.player.gold === 0, "ash archive ledger should spend gold");
assert(ashArchiveLedgerRun.player.boons.includes("ash_ledger"), "ash archive ledger should grant ash ledger");

let staleAshArchiveBottleRun = createInitialRun(937, "map", "standard");
staleAshArchiveBottleRun.phase = "event";
staleAshArchiveBottleRun.event = {
  id: "ash_archive",
  title: "旧存档余烬档案药水",
  text: "",
  options: [{ id: "bottle", label: "余烬药水", text: "" }],
};
staleAshArchiveBottleRun.player.gold = 24;
staleAshArchiveBottleRun.player.potions = [
  makePotionInstance("fire_potion"),
  makePotionInstance("block_potion"),
  makePotionInstance("energy_potion"),
];
staleAshArchiveBottleRun = chooseEventOption(staleAshArchiveBottleRun, "bottle");
assert(staleAshArchiveBottleRun.phase === "event", "stale ash archive bottle should keep the event open");
assert(staleAshArchiveBottleRun.player.gold === 24, "stale ash archive bottle should not spend gold when full");
assert(staleAshArchiveBottleRun.message?.includes("药水槽已满"), "stale ash archive bottle should explain potion capacity");

let rhythmCardEventRun = createInitialRun(938, "map", "standard");
rhythmCardEventRun.phase = "event";
rhythmCardEventRun.event = {
  id: "rhythm_metronome",
  title: "测试节拍器卡牌",
  text: "",
  options: [{ id: "calibrate", label: "节拍电池", text: "" }],
};
rhythmCardEventRun.player.gold = 28;
rhythmCardEventRun = chooseEventOption(rhythmCardEventRun, "calibrate");
assert(rhythmCardEventRun.phase === "map", "rhythm metronome card option should finish the event");
assert(rhythmCardEventRun.player.gold === 0, "rhythm metronome card option should spend gold");
assert(rhythmCardEventRun.player.deck.some((card) => card.cardId === "rhythm_battery" && card.upgraded), "rhythm metronome should grant upgraded rhythm battery");

let rhythmPotionEventRun = createInitialRun(939, "map", "standard");
rhythmPotionEventRun.phase = "event";
rhythmPotionEventRun.event = {
  id: "rhythm_metronome",
  title: "测试节拍器药水",
  text: "",
  options: [{ id: "drink", label: "节拍药水", text: "" }],
};
rhythmPotionEventRun.player.gold = 22;
rhythmPotionEventRun.player.potions = [];
rhythmPotionEventRun = chooseEventOption(rhythmPotionEventRun, "drink");
assert(rhythmPotionEventRun.phase === "map", "rhythm metronome potion option should finish the event");
assert(rhythmPotionEventRun.player.gold === 0, "rhythm metronome potion option should spend gold");
assert(rhythmPotionEventRun.player.potions.some((potion) => potion.potionId === "tempo_potion"), "rhythm metronome should grant tempo potion");

let rhythmBoonEventRun = createInitialRun(940, "map", "standard");
rhythmBoonEventRun.phase = "event";
rhythmBoonEventRun.event = {
  id: "rhythm_metronome",
  title: "测试节拍器常驻",
  text: "",
  options: [{ id: "meter", label: "随身节拍器", text: "" }],
};
rhythmBoonEventRun.player.gold = 48;
rhythmBoonEventRun = chooseEventOption(rhythmBoonEventRun, "meter");
assert(rhythmBoonEventRun.phase === "map", "rhythm metronome boon option should finish the event");
assert(rhythmBoonEventRun.player.gold === 0, "rhythm metronome boon option should spend gold");
assert(rhythmBoonEventRun.player.boons.includes("rhythm_meter"), "rhythm metronome should grant rhythm meter");

let staleRhythmPotionRun = createInitialRun(941, "map", "standard");
staleRhythmPotionRun.phase = "event";
staleRhythmPotionRun.event = {
  id: "rhythm_metronome",
  title: "旧存档节拍药水",
  text: "",
  options: [{ id: "drink", label: "节拍药水", text: "" }],
};
staleRhythmPotionRun.player.gold = 22;
staleRhythmPotionRun.player.potions = [
  makePotionInstance("fire_potion"),
  makePotionInstance("block_potion"),
  makePotionInstance("energy_potion"),
];
staleRhythmPotionRun = chooseEventOption(staleRhythmPotionRun, "drink");
assert(staleRhythmPotionRun.phase === "event", "stale rhythm potion option should keep the event open");
assert(staleRhythmPotionRun.player.gold === 22, "stale rhythm potion option should not spend gold when full");
assert(staleRhythmPotionRun.message?.includes("药水槽已满"), "stale rhythm potion option should explain potion capacity");

let chainCardEventRun = createInitialRun(942, "map", "standard");
chainCardEventRun.phase = "event";
chainCardEventRun.event = {
  id: "chain_hourglass",
  title: "测试连锁卡牌",
  text: "",
  options: [{ id: "bind", label: "连锁护法", text: "" }],
};
chainCardEventRun.player.gold = 30;
chainCardEventRun = chooseEventOption(chainCardEventRun, "bind");
assert(chainCardEventRun.phase === "map", "chain hourglass card option should finish the event");
assert(chainCardEventRun.player.gold === 0, "chain hourglass card option should spend gold");
assert(chainCardEventRun.player.deck.some((card) => card.cardId === "chain_guard" && card.upgraded), "chain hourglass should grant upgraded chain guard");

let chainPotionEventRun = createInitialRun(943, "map", "standard");
chainPotionEventRun.phase = "event";
chainPotionEventRun.event = {
  id: "chain_hourglass",
  title: "测试连锁药水",
  text: "",
  options: [{ id: "dose", label: "连锁药水", text: "" }],
};
chainPotionEventRun.player.gold = 24;
chainPotionEventRun.player.potions = [];
chainPotionEventRun = chooseEventOption(chainPotionEventRun, "dose");
assert(chainPotionEventRun.phase === "map", "chain hourglass potion option should finish the event");
assert(chainPotionEventRun.player.gold === 0, "chain hourglass potion option should spend gold");
assert(chainPotionEventRun.player.potions.some((potion) => potion.potionId === "chain_potion"), "chain hourglass should grant chain potion");

let chainBoonEventRun = createInitialRun(944, "map", "standard");
chainBoonEventRun.phase = "event";
chainBoonEventRun.event = {
  id: "chain_hourglass",
  title: "测试连锁常驻",
  text: "",
  options: [{ id: "manual", label: "连锁手册", text: "" }],
};
chainBoonEventRun.player.gold = 50;
chainBoonEventRun = chooseEventOption(chainBoonEventRun, "manual");
assert(chainBoonEventRun.phase === "map", "chain hourglass boon option should finish the event");
assert(chainBoonEventRun.player.gold === 0, "chain hourglass boon option should spend gold");
assert(chainBoonEventRun.player.boons.includes("chain_manual"), "chain hourglass should grant chain manual");

let staleChainPotionRun = createInitialRun(945, "map", "standard");
staleChainPotionRun.phase = "event";
staleChainPotionRun.event = {
  id: "chain_hourglass",
  title: "旧存档连锁药水",
  text: "",
  options: [{ id: "dose", label: "连锁药水", text: "" }],
};
staleChainPotionRun.player.gold = 24;
staleChainPotionRun.player.potions = [
  makePotionInstance("fire_potion"),
  makePotionInstance("block_potion"),
  makePotionInstance("energy_potion"),
];
staleChainPotionRun = chooseEventOption(staleChainPotionRun, "dose");
assert(staleChainPotionRun.phase === "event", "stale chain potion option should keep the event open");
assert(staleChainPotionRun.player.gold === 24, "stale chain potion option should not spend gold when full");
assert(staleChainPotionRun.message?.includes("药水槽已满"), "stale chain potion option should explain potion capacity");

let coolingCardEventRun = createInitialRun(946, "map", "standard");
coolingCardEventRun.phase = "event";
coolingCardEventRun.event = {
  id: "cooling_station",
  title: "测试冷却卡牌",
  text: "",
  options: [{ id: "plate", label: "散热片", text: "" }],
};
coolingCardEventRun.player.gold = 32;
coolingCardEventRun = chooseEventOption(coolingCardEventRun, "plate");
assert(coolingCardEventRun.phase === "map", "cooling station card option should finish the event");
assert(coolingCardEventRun.player.gold === 0, "cooling station card option should spend gold");
assert(coolingCardEventRun.player.deck.some((card) => card.cardId === "heat_sink" && card.upgraded), "cooling station should grant upgraded heat sink");

let coolingPotionEventRun = createInitialRun(947, "map", "standard");
coolingPotionEventRun.phase = "event";
coolingPotionEventRun.event = {
  id: "cooling_station",
  title: "测试冷却药水",
  text: "",
  options: [{ id: "coolant", label: "冷却药水", text: "" }],
};
coolingPotionEventRun.player.gold = 24;
coolingPotionEventRun.player.potions = [];
coolingPotionEventRun = chooseEventOption(coolingPotionEventRun, "coolant");
assert(coolingPotionEventRun.phase === "map", "cooling station potion option should finish the event");
assert(coolingPotionEventRun.player.gold === 0, "cooling station potion option should spend gold");
assert(coolingPotionEventRun.player.potions.some((potion) => potion.potionId === "coolant_potion"), "cooling station should grant coolant potion");

let coolingBoonEventRun = createInitialRun(948, "map", "standard");
coolingBoonEventRun.phase = "event";
coolingBoonEventRun.event = {
  id: "cooling_station",
  title: "测试热控常驻",
  text: "",
  options: [{ id: "regulator", label: "热控铭文", text: "" }],
};
coolingBoonEventRun.player.gold = 52;
coolingBoonEventRun = chooseEventOption(coolingBoonEventRun, "regulator");
assert(coolingBoonEventRun.phase === "map", "cooling station boon option should finish the event");
assert(coolingBoonEventRun.player.gold === 0, "cooling station boon option should spend gold");
assert(coolingBoonEventRun.player.boons.includes("heat_regulator"), "cooling station should grant heat regulator");

let staleCoolingPotionRun = createInitialRun(949, "map", "standard");
staleCoolingPotionRun.phase = "event";
staleCoolingPotionRun.event = {
  id: "cooling_station",
  title: "旧存档冷却药水",
  text: "",
  options: [{ id: "coolant", label: "冷却药水", text: "" }],
};
staleCoolingPotionRun.player.gold = 24;
staleCoolingPotionRun.player.potions = [
  makePotionInstance("fire_potion"),
  makePotionInstance("block_potion"),
  makePotionInstance("energy_potion"),
];
staleCoolingPotionRun = chooseEventOption(staleCoolingPotionRun, "coolant");
assert(staleCoolingPotionRun.phase === "event", "stale cooling potion option should keep the event open");
assert(staleCoolingPotionRun.player.gold === 24, "stale cooling potion option should not spend gold when full");
assert(staleCoolingPotionRun.message?.includes("药水槽已满"), "stale cooling potion option should explain potion capacity");

let triageCardRun = createInitialRun(925, "map", "standard");
triageCardRun.phase = "event";
triageCardRun.event = {
  id: "triage_station",
  title: "测试分拣卡牌",
  text: "",
  options: [{ id: "card_crate", label: "卡牌箱", text: "" }],
};
triageCardRun.player.gold = 25;
const triageCardDeckBefore = triageCardRun.player.deck.length;
triageCardRun = chooseEventOption(triageCardRun, "card_crate");
assert(triageCardRun.phase === "map", "triage card crate should finish the event");
assert(triageCardRun.player.gold === 0, "triage card crate should spend gold");
assert(triageCardRun.player.deck.length === triageCardDeckBefore + 1, "triage card crate should add a card");

let triagePotionRun = createInitialRun(926, "map", "standard");
triagePotionRun.phase = "event";
triagePotionRun.event = {
  id: "triage_station",
  title: "测试分拣药水",
  text: "",
  options: [{ id: "potion_crate", label: "药水箱", text: "" }],
};
triagePotionRun.player.gold = 20;
triagePotionRun.player.potions = [];
triagePotionRun = chooseEventOption(triagePotionRun, "potion_crate");
assert(triagePotionRun.phase === "map", "triage potion crate should finish the event");
assert(triagePotionRun.player.gold === 0, "triage potion crate should spend gold");
assert(triagePotionRun.player.potions.length > 0, "triage potion crate should grant potions");

let triageBoonRun = createInitialRun(927, "map", "standard");
triageBoonRun.phase = "event";
triageBoonRun.event = {
  id: "triage_station",
  title: "测试分拣常驻",
  text: "",
  options: [{ id: "boon_token", label: "令牌", text: "" }],
};
const triageBoonHpBefore = triageBoonRun.player.hp;
triageBoonRun = chooseEventOption(triageBoonRun, "boon_token");
assert(triageBoonRun.phase === "map", "triage boon token should finish the event");
assert(triageBoonRun.player.hp === triageBoonHpBefore - 5, "triage boon token should spend hp");
assert(triageBoonRun.player.boons.length === 1, "triage boon token should grant a boon");

let staleTriagePotionRun = createInitialRun(928, "map", "standard");
staleTriagePotionRun.phase = "event";
staleTriagePotionRun.event = {
  id: "triage_station",
  title: "旧存档分拣药水",
  text: "",
  options: [{ id: "potion_crate", label: "药水箱", text: "" }],
};
staleTriagePotionRun.player.gold = 20;
staleTriagePotionRun.player.potions = [
  makePotionInstance("fire_potion"),
  makePotionInstance("block_potion"),
  makePotionInstance("energy_potion"),
];
staleTriagePotionRun = chooseEventOption(staleTriagePotionRun, "potion_crate");
assert(staleTriagePotionRun.phase === "event", "stale triage potion crate should keep the event open");
assert(staleTriagePotionRun.player.gold === 20, "stale triage potion crate should not spend gold when full");
assert(staleTriagePotionRun.message?.includes("药水槽已满"), "stale triage potion crate should explain potion capacity");

let cappedBottleRackRun = createInitialRun(916, "map", "standard");
cappedBottleRackRun.reward = {
  nodeType: "fight",
  title: "测试瓶架上限",
  gold: 0,
  cards: [],
  cardResolved: true,
  boons: [{ boonId: "bottle_rack" }],
};
cappedBottleRackRun.phase = "reward";
cappedBottleRackRun.player.potionSlots = 5;
cappedBottleRackRun = claimRewardBoon(cappedBottleRackRun, 0);
assert(cappedBottleRackRun.player.potionSlots === 5, "bottle rack should respect potion slot cap");

let eventCompletionRun = createInitialRun(900, "map", "standard");
const eventCompletionNode = eventCompletionRun.map.find((node) => node.floor === 0)!;
eventCompletionNode.type = "event";
eventCompletionRun.currentNodeId = eventCompletionNode.id;
eventCompletionRun.phase = "event";
eventCompletionRun.event = {
  id: "blood_shrine",
  title: "测试完成",
  text: "",
  options: [{ id: "leave", label: "离开", text: "" }],
};
const eventNodesBefore = eventCompletionRun.stats.nodesCleared;
eventCompletionRun = chooseEventOption(eventCompletionRun, "leave");
assert(eventCompletionRun.phase === "map", "leaving an event should return to map");
assert(eventCompletionRun.map.find((node) => node.id === eventCompletionNode.id)?.completed, "event choice should complete node");
assert(eventCompletionRun.floor === eventCompletionNode.floor + 1, "event choice should advance floor");
assert(eventCompletionRun.stats.nodesCleared === eventNodesBefore + 1, "event choice should count a cleared node");
const eventAfterRepeat = chooseEventOption(eventCompletionRun, "leave");
assert(eventAfterRepeat.stats.nodesCleared === eventCompletionRun.stats.nodesCleared, "completed event should not be resolved twice");

let restRun = createInitialRun(999, "map", "standard");
restRun.phase = "rest";
restRun.player.hp = 20;
restRun = restHeal(restRun);
assert(restRun.phase === "map", "resting should return to map");
assert(restRun.player.hp > 20, "resting should heal");

let fullHealthRestRun = createInitialRun(1000, "map", "standard");
fullHealthRestRun.phase = "rest";
const fullHealthRestGoldBefore = fullHealthRestRun.player.gold;
fullHealthRestRun.player.hp = fullHealthRestRun.player.maxHp;
fullHealthRestRun = restHeal(fullHealthRestRun);
assert(fullHealthRestRun.phase === "map", "full health rest prep should still return to map");
assert(fullHealthRestRun.player.hp === fullHealthRestRun.player.maxHp, "full health rest prep should keep hp capped");
assert(fullHealthRestRun.player.gold > fullHealthRestGoldBefore, "full health rest prep should grant fallback gold");
assert(fullHealthRestRun.message?.includes("整备"), "full health rest prep should explain the fallback");

let brewRun = createInitialRun(1001, "map", "standard");
brewRun.phase = "rest";
brewRun.player.potions = [];
brewRun = restBrewPotion(brewRun);
assert(brewRun.phase === "map", "brewing at rest should return to map");
assert(brewRun.player.potions.length === 1, "brewing at rest should grant a potion");

let fullBrewRun = createInitialRun(1002, "map", "standard");
fullBrewRun.phase = "rest";
fullBrewRun.player.potions = [
  makePotionInstance("block_potion"),
  makePotionInstance("strength_potion"),
  makePotionInstance("energy_potion"),
];
fullBrewRun = restBrewPotion(fullBrewRun);
assert(fullBrewRun.phase === "rest", "full potion belt should not consume rest when brewing");
assert(fullBrewRun.message === "药水槽已满。", "full potion belt should show message at rest brew");

let restCleanseRun = createInitialRun(1003, "map", "standard");
restCleanseRun.phase = "rest";
const restBurn = makeCardInstance("burn");
restCleanseRun.player.deck.push(restBurn);
restCleanseRun = restCleanseStatus(restCleanseRun);
assert(restCleanseRun.phase === "map", "rest cleanse should consume rest and return to map");
assert(!restCleanseRun.player.deck.some((card) => card.uid === restBurn.uid), "rest cleanse should remove a status card");

let emptyRestCleanseRun = createInitialRun(1004, "map", "standard");
emptyRestCleanseRun.phase = "rest";
emptyRestCleanseRun = restCleanseStatus(emptyRestCleanseRun);
assert(emptyRestCleanseRun.phase === "rest", "rest cleanse should not consume rest when no status exists");
assert(emptyRestCleanseRun.message === "没有状态牌可以清理。", "rest cleanse should explain missing status");

assert(CARDS.burn.base.endTurnDamage === 2, "burn data should define end-turn damage");
assert(POTIONS.fire_potion.effects[0].type === "damage", "fire potion should define damage");
assert(REWARD_CARD_IDS.includes("blood_rite"), "new cards should enter reward pool");
assert(REWARD_CARD_IDS.includes("clear_mind"), "cleanse card should enter reward pool");
assert(POTIONS.cleanse_potion.effects[0].type === "cleanseDebuffs", "cleanse potion should define cleanse effect");
assert(REWARD_CARD_IDS.includes("static_field"), "new power cards should enter reward pool");
assert(
  CARDS.conductive_guard.base.effects.some((effect) => effect.type === "applyPower" && effect.power === "spark"),
  "conductive guard should apply spark",
);
assert(CARDS.iron_skin.type === "Power", "iron skin should be a power card");
assert(
  CARDS.charged_thought.upgraded.effects.some((effect) => effect.type === "applyPower" && effect.power === "charge" && effect.amount === 2),
  "charged thought+ should grant 2 charge",
);
assert(CARDS.venom_stance.type === "Power", "venom stance should be a power card");
assert(
  CARDS.battle_rhythm.base.effects.some((effect) => effect.type === "applyPower" && effect.power === "combo" && effect.amount === 2),
  "battle rhythm should grant combo",
);
assert(
  CARDS.blood_pact.base.effects.some((effect) => effect.type === "applyPower" && effect.power === "bleed" && effect.target === "self"),
  "blood pact should add self bleed as a drawback",
);
assert(REWARD_CARD_IDS.includes("battle_rhythm"), "new power cards should enter reward pool");
assert(REWARD_CARD_IDS.includes("salvage"), "salvage should enter reward pool");
assert(REWARD_CARD_IDS.includes("memory_hook"), "memory hook should enter reward pool");
assert(REWARD_CARD_IDS.includes("charge_shield"), "charge shield should enter reward pool");
assert(REWARD_CARD_IDS.includes("rupture_finish"), "rupture finish should enter reward pool");
assert(REWARD_CARD_IDS.includes("venom_battery"), "venom battery should enter reward pool");
assert(REWARD_CARD_IDS.includes("fault_resonance"), "fault resonance should enter reward pool");
assert(REWARD_CARD_IDS.includes("blood_catalyst"), "blood catalyst should enter reward pool");
assert(REWARD_CARD_IDS.includes("spark_cascade"), "spark cascade should enter reward pool");
assert(REWARD_CARD_IDS.includes("alloy_shell"), "alloy shell should enter reward pool");
assert(REWARD_CARD_IDS.includes("coil_lash"), "coil lash should enter reward pool");
assert(REWARD_CARD_IDS.includes("static_rebuke"), "static rebuke should enter reward pool");
assert(REWARD_CARD_IDS.includes("mirror_plating"), "mirror plating should enter reward pool");
assert(REWARD_CARD_IDS.includes("field_tactics"), "field tactics should enter reward pool");
assert(REWARD_CARD_IDS.includes("emergency_orders"), "emergency orders should enter reward pool");
assert(REWARD_CARD_IDS.includes("trauma_recycler"), "trauma recycler should enter reward pool");
assert(REWARD_CARD_IDS.includes("wound_battery"), "wound battery should enter reward pool");
assert(REWARD_CARD_IDS.includes("ash_ward"), "ash ward should enter reward pool");
assert(REWARD_CARD_IDS.includes("rhythm_battery"), "rhythm battery should enter reward pool");
assert(REWARD_CARD_IDS.includes("chain_guard"), "chain guard should enter reward pool");
assert(REWARD_CARD_IDS.includes("overload_surge"), "overload surge should enter reward pool");
assert(REWARD_CARD_IDS.includes("heat_sink"), "heat sink should enter reward pool");
assert(POTIONS.catalyst_potion.effects.some((effect) => effect.type === "amplifyPower"), "catalyst potion should define amplification");
assert(POTIONS.alloy_potion.effects.some((effect) => effect.type === "applyPower" && effect.power === "platedArmor"), "alloy potion should grant plated armor");
assert(POTIONS.overcharge_potion.effects.some((effect) => effect.type === "applyPower" && effect.power === "charge"), "overcharge potion should grant charge");
assert(POTIONS.tactics_potion.effects.some((effect) => effect.type === "returnFromDiscard"), "tactics potion should recover cards");
assert(POTIONS.triage_potion.effects.some((effect) => effect.type === "exhaustCards"), "triage potion should exhaust status cards");
assert(POTIONS.ash_potion.effects.some((effect) => effect.type === "blockPerExhaustedCard"), "ash potion should scale with exhausted cards");
assert(POTIONS.tempo_potion.effects.some((effect) => effect.type === "gainPowerPerPower"), "tempo potion should convert combo into charge");
assert(POTIONS.chain_potion.effects.some((effect) => effect.type === "gainPowerPerCardPlayed"), "chain potion should scale with played cards");
assert(POTIONS.coolant_potion.effects.some((effect) => effect.type === "cleansePower"), "coolant potion should define cooling");
assert(BOONS.catalyst_training.name === "催化训练", "catalyst training boon should be defined");
assert(BOONS.tempered_shell.name === "淬火外壳", "tempered shell boon should be defined");
assert(BOONS.coil_training.name === "线圈训练", "coil training boon should be defined");
assert(BOONS.rhythm_meter.name === "随身节拍器", "rhythm meter boon should be defined");
assert(BOONS.field_protocol.name === "战地协议", "field protocol boon should be defined");
assert(BOONS.banner_drill.name === "战旗操典", "banner drill boon should be defined");
assert(BOONS.triage_doctrine.name === "战伤教范", "triage doctrine boon should be defined");
assert(BOONS.ash_ledger.name === "余烬账本", "ash ledger boon should be defined");
assert(BOONS.chain_manual.name === "连锁手册", "chain manual boon should be defined");
assert(BOONS.heat_regulator.name === "热控铭文", "heat regulator boon should be defined");
assert(EVENT_IDS.includes("rhythm_metronome"), "rhythm metronome should enter event pool");
assert(EVENT_IDS.includes("chain_hourglass"), "chain hourglass should enter event pool");
assert(EVENT_IDS.includes("cooling_station"), "cooling station should enter event pool");
assert(ENEMIES.catalyst_adept.moves.some((move) => move.id === "primer_vial"), "catalyst adept should define catalyst setup move");
assert(ENCOUNTERS.some((encounter) => encounter.id === "catalyst_trial"), "catalyst trial encounter should enter encounter pool");
assert(ENEMIES.rift_tactician.moves.some((move) => move.id === "marking_order"), "rift tactician should define marking setup move");
assert(ENCOUNTERS.some((encounter) => encounter.id === "rift_tactics"), "rift tactics encounter should enter encounter pool");
assert(ENEMIES.scar_collector.moves.some((move) => move.id === "pack_wound"), "scar collector should define wound setup move");
assert(ENCOUNTERS.some((encounter) => encounter.id === "scar_triage"), "scar triage encounter should enter encounter pool");
assert(ENEMIES.tempo_sentry.moves.some((move) => move.id === "offbeat_chime"), "tempo sentry should define offbeat setup move");
assert(ENCOUNTERS.some((encounter) => encounter.id === "tempo_patrol"), "tempo patrol encounter should enter encounter pool");
assert(EVENT_IDS.includes("field_infirmary"), "field infirmary should enter event pool");
assert(EVENT_IDS.includes("ash_archive"), "ash archive should enter event pool");
assert(
  CARDS.salvage.upgraded.effects.some((effect) => effect.type === "returnFromDiscard" && effect.amount === 2),
  "salvage+ should recover two cards",
);
assert(
  CARDS.memory_hook.base.effects.some((effect) => effect.type === "returnFromDiscard" && effect.cardType === "Attack"),
  "memory hook should recover attacks",
);
assert(ENEMIES.spark_hulk.moves.some((move) => move.id === "arc_slam"), "spark hulk should define arc slam");
assert(
  ENEMIES.clockwork_jailer.moves.some((move) =>
    move.effects.some((effect) => effect.type === "createCard" && effect.cardId === "wound"),
  ),
  "clockwork jailer should add wound pressure",
);
assert(
  ENCOUNTERS.some((encounter) => encounter.id === "mirror_patrol" && encounter.enemies.includes("mirror_duelist")),
  "mirror patrol encounter should enter the pool",
);
assert(ENEMIES.glass_stalker.moves.some((move) => move.id === "expose"), "glass stalker should expose the player");
assert(ENEMIES.venom_binder.moves.some((move) => move.id === "toxic_bind"), "venom binder should define toxic bind");
assert(
  ENCOUNTERS.some((encounter) => encounter.id === "glass_hunt" && encounter.enemies.includes("glass_stalker")),
  "glass hunt encounter should enter act 2 pool",
);
assert(
  ENCOUNTERS.some((encounter) => encounter.id === "venom_weave" && encounter.enemies.includes("venom_binder")),
  "venom weave encounter should enter act 2 pool",
);

console.log("Smoke test passed");
