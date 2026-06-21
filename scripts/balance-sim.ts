import { BOONS, CARDS, DIFFICULTIES, POTIONS, RELICS } from "../src/game/data";
import {
  buyShopBoon,
  buyShopCard,
  buyShopHeal,
  buyShopPotion,
  buyShopRemove,
  buyShopRelic,
  canPlayCard,
  cardNeedsTarget,
  chooseEventOption,
  claimRewardBoon,
  claimRewardCard,
  claimRewardPotion,
  createInitialRun,
  endTurn,
  enterNode,
  getAvailableNodeIds,
  getCardDef,
  getCardLevel,
  leaveShop,
  playCard,
  restBrewPotion,
  restCleanseStatus,
  restHeal,
  restUpgrade,
  restockShop,
  rerollRewardCards,
  usePotion,
} from "../src/game/engine";
import type { CardInstance, DifficultyKey, EnemyState, MapNode, PotionInstance, RunState } from "../src/game/types";

const RUNS_PER_DIFFICULTY = Number(process.env.RUNS ?? 160);
const MAX_STEPS = 1500;

const CARD_SCORE: Record<string, number> = {
  adrenaline: 100,
  battle_trance: 98,
  inflame: 92,
  footwork: 88,
  iron_skin: 78,
  blood_burst: 86,
  blood_rite: 74,
  blade_storm: 84,
  storm_core: 76,
  static_field: 72,
  battle_rhythm: 82,
  blood_pact: 78,
  venom_stance: 73,
  twin_cut: 80,
  body_slam: 78,
  iron_wave: 76,
  conductive_guard: 71,
  plated_guard: 75,
  discharge: 70,
  arc_blade: 70,
  deep_cut: 74,
  quick_stab: 74,
  tempo_shift: 73,
  rhythm_battery: 74,
  chain_guard: 73,
  overload_surge: 82,
  heat_sink: 72,
  hold_guard: 72,
  arc_barrier: 68,
  clear_mind: 72,
  second_wind: 70,
  purge: 70,
  trauma_recycler: 73,
  wound_battery: 74,
  ash_ward: 72,
  toxin_cloud: 69,
  capacitor: 66,
  charged_thought: 66,
  poison_dart: 68,
  expose_weakness: 66,
  marking_strike: 64,
  guard_break: 64,
  finisher: 66,
  regeneration: 58,
  mirror_image: 56,
  salvage: 67,
  memory_hook: 70,
  shield_recall: 69,
  fracture_thrust: 70,
  venom_cut: 68,
  bulwark_engine: 76,
  charge_shield: 63,
  rupture_finish: 67,
  venom_battery: 70,
  fault_resonance: 68,
  blood_catalyst: 76,
  spark_cascade: 70,
  alloy_shell: 72,
  coil_lash: 73,
  static_rebuke: 72,
  mirror_plating: 78,
  field_tactics: 69,
  emergency_orders: 86,
  heavy_blow: 70,
  flurry: 78,
  whirlwind: 76,
  demon_form: 80,
  berserk_edge: 72,
  rallying_roar: 70,
  tidal_edge: 74,
  spike_surge: 70,
  spine_wall: 60,
  blood_forge: 66,
  doom_mark: 74,
  cleave: 54,
  bash: 48,
  strike: 22,
  defend: 20,
};

const RELIC_SCORE: Record<string, number> = {
  pocket_watch: 100,
  kunai: 95,
  flower: 92,
  bronze_scales: 74,
  anchor: 72,
  meal_ticket: 68,
  blood_vial: 64,
  red_skull: 50,
  ancient_coin: 48,
  serrated_edge: 76,
  metronome: 82,
  whetstone: 76,
  threaded_needle: 74,
  toxic_vial: 72,
  fracture_lens: 75,
  echo_bell: 78,
  alchemy_stone: 84,
  charged_plate: 76,
  storm_needle: 82,
};

const POTION_SCORE: Record<string, number> = {
  fire_potion: 82,
  explosive_potion: 78,
  strength_potion: 74,
  dexterity_potion: 72,
  block_potion: 68,
  cleanse_potion: 70,
  energy_potion: 66,
  poison_potion: 64,
  bleed_potion: 72,
  mark_potion: 70,
  plating_potion: 68,
  arc_potion: 66,
  charge_potion: 62,
  tempo_potion: 72,
  chain_potion: 70,
  coolant_potion: 70,
  recall_potion: 76,
  fracture_potion: 70,
  brace_potion: 72,
  swift_potion: 62,
  blood_potion: 60,
  catalyst_potion: 76,
  alloy_potion: 70,
  overcharge_potion: 74,
  tactics_potion: 72,
  triage_potion: 70,
  ash_potion: 68,
};

const BOON_SCORE: Record<string, number> = {
  vitality: 70,
  bottle_rack: 68,
  opening_guard: 64,
  combo_discipline: 62,
  static_attunement: 64,
  plate_training: 64,
  armory_drill: 68,
  battle_focus: 70,
  spark_conduit: 68,
  bleed_edge: 66,
  field_alchemy: 64,
  blade_oil: 66,
  venom_prep: 66,
  reserve_battery: 72,
  recovery_mantra: 64,
  scavenger_kit: 70,
  weakpoint_chart: 68,
  catalyst_training: 74,
  potion_catalyst: 72,
  tempered_shell: 70,
  coil_training: 68,
  rhythm_meter: 72,
  chain_manual: 72,
  heat_regulator: 71,
  field_protocol: 70,
  banner_drill: 71,
  triage_doctrine: 70,
  ash_ledger: 69,
};

interface SimResult {
  won: boolean;
  floor: number;
  hp: number;
  maxHp: number;
  nodes: number;
  damage: number;
  cardsPlayed: number;
  goldEarned: number;
}

function simulateRun(seed: number, difficulty: DifficultyKey): SimResult {
  let run = createInitialRun(seed, "map", difficulty);

  for (let step = 0; step < MAX_STEPS; step += 1) {
    if (run.phase === "victory" || run.phase === "defeat") {
      break;
    }

    if (run.phase === "map") {
      run = enterNode(run, chooseMapNode(run));
      continue;
    }

    if (run.phase === "combat") {
      run = simulateCombatTurn(run);
      continue;
    }

    if (run.phase === "reward") {
      run = simulateReward(run);
      continue;
    }

    if (run.phase === "rest") {
      if (shouldHealAtRest(run)) {
        run = restHeal(run);
      } else if (shouldCleanseAtRest(run)) {
        run = restCleanseStatus(run);
      } else if (shouldBrewAtRest(run)) {
        run = restBrewPotion(run);
      } else {
        const upgradeUid = chooseUpgrade(run);
        run = upgradeUid ? restUpgrade(run, upgradeUid) : restHeal(run);
      }
      continue;
    }

    if (run.phase === "shop") {
      run = simulateShop(run);
      continue;
    }

    if (run.phase === "event") {
      run = chooseEventOption(run, chooseEvent(run));
    }
  }

  return {
    won: run.phase === "victory",
    floor: (run.act - 1) * 12 + run.floor,
    hp: run.player.hp,
    maxHp: run.player.maxHp,
    nodes: run.stats.nodesCleared,
    damage: run.stats.damageDealt,
    cardsPlayed: run.stats.cardsPlayed,
    goldEarned: run.stats.goldEarned,
  };
}

function simulateReward(run: RunState): RunState {
  let current = run;
  const reward = current.reward;
  if (!reward) {
    return current;
  }

  if (reward.potionId && current.player.potions.length < current.player.potionSlots) {
    current = claimRewardPotion(current);
  }

  if (current.phase !== "reward") {
    return current;
  }

  if (current.reward?.boons?.length && !current.reward.boonResolved) {
    const boonIndex = chooseRewardBoon(current);
    if (typeof boonIndex === "number") {
      current = claimRewardBoon(current, boonIndex);
    }
  }

  if (current.phase !== "reward") {
    return current;
  }

  if (!current.reward?.cardResolved) {
    const pick = chooseRewardCard(current);
    if (typeof pick === "number") {
      return claimRewardCard(current, pick);
    }
    if (!current.reward.rerolled && current.player.gold >= (current.reward.rerollPrice ?? 24)) {
      current = rerollRewardCards(current);
      if (current.phase !== "reward") {
        return current;
      }
      return claimRewardCard(current, chooseRewardCard(current));
    }
    return claimRewardCard(current);
  }

  return claimRewardCard(current);
}

function simulateCombatTurn(run: RunState): RunState {
  let current = run;
  let guard = 0;

  while (current.phase === "combat" && guard < 30) {
    guard += 1;
    const potionUse = choosePotionUse(current);
    if (potionUse) {
      current = usePotion(current, potionUse.potion.uid, potionUse.target?.uid);
      continue;
    }

    const card = choosePlayableCard(current);
    if (!card) {
      return endTurn(current);
    }

    const target = chooseTarget(current, card);
    current = playCard(current, card.uid, target?.uid);
  }

  return current.phase === "combat" ? endTurn(current) : current;
}

function choosePotionUse(run: RunState): { potion: PotionInstance; target?: EnemyState } | undefined {
  const combat = run.combat;
  if (!combat || run.player.potions.length === 0) {
    return undefined;
  }

  const incoming = expectedIncomingDamage(run);
  const hpDanger = run.player.hp + combat.playerBlock <= incoming + 8;
  const hardFight = combat.nodeType === "elite" || combat.nodeType === "boss" || combat.enemies.some((enemy) => enemy.maxHp >= 70);
  const living = combat.enemies.filter((enemy) => enemy.hp > 0);
  const bestTarget = [...living].sort((a, b) => targetScore(b) - targetScore(a))[0];

  for (const potion of run.player.potions) {
    const id = potion.potionId;
    if (id === "blood_potion" && run.player.hp / run.player.maxHp < 0.38) {
      return { potion };
    }
    if (id === "block_potion" && hpDanger) {
      return { potion };
    }
    if (id === "fire_potion" && bestTarget && (bestTarget.hp <= 22 || hpDanger || hardFight)) {
      return { potion, target: bestTarget };
    }
    if (id === "explosive_potion" && living.length >= 2 && (living.some((enemy) => enemy.hp <= 12) || hpDanger)) {
      return { potion };
    }
    if (id === "poison_potion" && bestTarget && hardFight && (bestTarget.powers.poison ?? 0) < 4) {
      return { potion, target: bestTarget };
    }
    if (id === "bleed_potion" && bestTarget && (hardFight || bestTarget.hp >= 30) && (bestTarget.powers.bleed ?? 0) < 6) {
      return { potion, target: bestTarget };
    }
    if (id === "mark_potion" && bestTarget && (hpDanger || hardFight || living.length === 1) && (bestTarget.powers.mark ?? 0) < 4) {
      return { potion, target: bestTarget };
    }
    if (id === "fracture_potion" && (hardFight || living.length >= 2) && living.some((enemy) => (enemy.powers.mark ?? 0) < 3)) {
      return { potion };
    }
    if (id === "catalyst_potion" && bestTarget) {
      const catalystStacks = (bestTarget.powers.poison ?? 0) + (bestTarget.powers.bleed ?? 0) + (bestTarget.powers.mark ?? 0);
      if ((hardFight || hpDanger || bestTarget.maxHp >= 45) && catalystStacks >= 3) {
        return { potion, target: bestTarget };
      }
    }
    if (id === "arc_potion" && (living.length >= 2 || hardFight) && living.some((enemy) => (enemy.powers.spark ?? 0) < 3)) {
      return { potion };
    }
    if (
      id === "charge_potion" &&
      (hardFight || combat.hand.some((card) => card.cardId === "discharge" || card.cardId === "arc_barrier")) &&
      (combat.playerPowers.charge ?? 0) < 3
    ) {
      return { potion };
    }
    if (
      id === "tempo_potion" &&
      (hardFight ||
        hpDanger ||
        combat.hand.some((card) => card.cardId === "finisher" || card.cardId === "rhythm_battery" || card.cardId === "chain_guard" || card.cardId === "coil_lash")) &&
      ((combat.playerPowers.combo ?? 0) < 4 || (combat.playerPowers.charge ?? 0) < 4)
    ) {
      return { potion };
    }
    if (
      id === "chain_potion" &&
      (hardFight || hpDanger || combat.cardsPlayedThisTurn >= 2) &&
      combat.hand.some((card) => getCardLevel(card).cost <= combat.energy + 1)
    ) {
      return { potion };
    }
    if (id === "coolant_potion") {
      const bleed = combat.playerPowers.bleed ?? 0;
      if (bleed > 0 && (hpDanger || hardFight || bleed >= 2)) {
        return { potion };
      }
    }
    if (id === "plating_potion" && (hpDanger || hardFight) && (combat.playerPowers.platedArmor ?? 0) < 4) {
      return { potion };
    }
    if (id === "brace_potion" && (hpDanger || hardFight) && (combat.playerPowers.platedArmor ?? 0) < 3) {
      return { potion };
    }
    if (id === "alloy_potion" && (hpDanger || hardFight) && ((combat.playerPowers.platedArmor ?? 0) < 3 || incoming > combat.playerBlock)) {
      return { potion };
    }
    if (
      id === "overcharge_potion" &&
      (hardFight || hpDanger || combat.hand.some((card) => card.cardId === "coil_lash" || card.cardId === "static_rebuke")) &&
      ((combat.playerPowers.charge ?? 0) < 4 || living.some((enemy) => (enemy.powers.spark ?? 0) < 2))
    ) {
      return { potion };
    }
    if ((id === "strength_potion" || id === "dexterity_potion") && hardFight && combat.turn <= 2) {
      return { potion };
    }
    if (id === "energy_potion" && combat.energy === 0 && combat.hand.some((card) => getCardLevel(card).cost <= 2)) {
      return { potion };
    }
    if (
      id === "recall_potion" &&
      combat.energy <= 1 &&
      combat.discardPile.some((card) => CARDS[card.cardId].type !== "Status") &&
      combat.hand.length <= 8
    ) {
      return { potion };
    }
    if (
      id === "tactics_potion" &&
      combat.hand.length <= 4 &&
      (hardFight || hpDanger || combat.discardPile.some((card) => CARDS[card.cardId].type !== "Status"))
    ) {
      return { potion };
    }
    if (id === "triage_potion") {
      const statusFuel = [...combat.hand, ...combat.discardPile].filter((card) => CARDS[card.cardId]?.type === "Status").length;
      if (statusFuel > 0 && (hpDanger || hardFight || combat.hand.length <= 5)) {
        return { potion };
      }
    }
    if (id === "ash_potion") {
      const exhaustFuel = combat.exhaustPile.length;
      if ((hpDanger || hardFight) && exhaustFuel >= 2) {
        return { potion };
      }
    }
    if (id === "swift_potion" && combat.energy >= 1 && combat.hand.length <= 2) {
      return { potion };
    }
  }

  return undefined;
}

function choosePlayableCard(run: RunState): CardInstance | undefined {
  const combat = run.combat;
  if (!combat) {
    return undefined;
  }

  const incoming = expectedIncomingDamage(run);
  const playable = combat.hand.filter((card) => canPlayCard(run, card));
  if (playable.length === 0) {
    return undefined;
  }

  const scored = playable.map((card) => ({
    card,
    score: scoreCardInCombat(run, card, incoming),
  }));
  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.score > 0 ? scored[0].card : undefined;
}

function scoreCardInCombat(run: RunState, card: CardInstance, incoming: number): number {
  const def = getCardDef(card.cardId);
  const level = getCardLevel(card);
  let score = CARD_SCORE[card.cardId] ?? 40;

  if (def.type === "Skill") {
    const blockNeed = Math.max(0, incoming - (run.combat?.playerBlock ?? 0));
    const blockValue = level.effects
      .filter((effect) => effect.type === "block")
      .reduce((sum, effect) => sum + effect.amount, 0);
    if (blockValue > 0 && blockNeed <= 0) {
      score -= 40;
    } else {
      score += Math.min(24, blockNeed);
    }
  }

  if (def.type === "Power" && run.combat && run.combat.turn > 4) {
    score -= 28;
  }

  if (card.cardId === "purge") {
    const handStatuses = run.combat?.hand.filter((item) => CARDS[item.cardId]?.type === "Status").length ?? 0;
    score += handStatuses > 0 ? Math.min(42, handStatuses * 18) : -42;
  }

  if (card.cardId === "trauma_recycler") {
    const statusFuel =
      run.combat ? [...run.combat.hand, ...run.combat.discardPile].filter((item) => CARDS[item.cardId]?.type === "Status").length : 0;
    score += statusFuel > 0 ? Math.min(40, statusFuel * 16) : -20;
    if (incoming > (run.combat?.playerBlock ?? 0)) {
      score += 8;
    }
  }

  if (card.cardId === "wound_battery") {
    const hasStatusPayoff = run.player.deck.some((item) => item.cardId === "purge" || item.cardId === "trauma_recycler") || run.player.boons.includes("triage_doctrine");
    score += hasStatusPayoff ? 18 : 2;
    if (countStatusCards(run) >= 4 && !hasStatusPayoff) {
      score -= 16;
    }
  }

  if (card.cardId === "ash_ward") {
    const exhaustFuel = run.combat?.exhaustPile.length ?? 0;
    score += exhaustFuel > 0 ? Math.min(36, exhaustFuel * 7) : -6;
    if (incoming > (run.combat?.playerBlock ?? 0)) {
      score += 10;
    }
  }

  if (card.cardId === "rhythm_battery") {
    const combo = run.combat?.playerPowers.combo ?? 0;
    score += Math.min(34, Math.max(1, combo) * 8);
    if (run.player.deck.some((item) => item.cardId === "chain_guard" || item.cardId === "coil_lash" || item.cardId === "static_rebuke" || item.cardId === "discharge")) {
      score += 10;
    }
    if (incoming > (run.combat?.playerBlock ?? 0)) {
      score += 8;
    }
  }

  if (card.cardId === "chain_guard") {
    const played = (run.combat?.cardsPlayedThisTurn ?? 0) + 1;
    const blockNeed = Math.max(0, incoming - (run.combat?.playerBlock ?? 0));
    score += Math.min(36, played * 8);
    if (blockNeed > 0) {
      score += Math.min(18, blockNeed);
    }
    if (run.player.boons.includes("chain_manual") || run.player.boons.includes("rhythm_meter")) {
      score += 8;
    }
  }

  if (card.cardId === "overload_surge") {
    const hasCooling =
      run.player.deck.some((item) => item.cardId === "heat_sink") ||
      run.player.boons.includes("heat_regulator") ||
      run.player.potions.some((potion) => potion.potionId === "coolant_potion");
    score += hasCooling ? 18 : 4;
    if (run.player.hp / run.player.maxHp < 0.42 && !hasCooling) {
      score -= 28;
    }
    if ((run.combat?.playerPowers.bleed ?? 0) >= 3 && !hasCooling) {
      score -= 24;
    }
  }

  if (card.cardId === "heat_sink") {
    const bleed = run.combat?.playerPowers.bleed ?? 0;
    const blockNeed = Math.max(0, incoming - (run.combat?.playerBlock ?? 0));
    score += bleed > 0 ? Math.min(42, bleed * 16) : -10;
    if (blockNeed > 0) {
      score += Math.min(20, blockNeed);
    }
  }

  if (card.cardId === "body_slam") {
    score += Math.min(26, run.combat?.playerBlock ?? 0);
  }

  if (card.cardId === "finisher") {
    score += Math.min(46, (run.combat?.playerPowers.combo ?? 0) * 8);
  }

  if (card.cardId === "blood_burst") {
    const bleed = run.combat?.enemies.reduce((sum, enemy) => sum + (enemy.hp > 0 ? enemy.powers.bleed ?? 0 : 0), 0) ?? 0;
    score += Math.min(58, bleed * 5);
    if (bleed < 3) {
      score -= 42;
    }
  }

  if (card.cardId === "blood_catalyst") {
    const catalystStacks =
      run.combat?.enemies.reduce((sum, enemy) => sum + (enemy.hp > 0 ? (enemy.powers.poison ?? 0) + (enemy.powers.bleed ?? 0) : 0), 0) ?? 0;
    score += Math.min(62, catalystStacks * 5);
    if (catalystStacks < 4) {
      score -= 44;
    }
  }

  if (card.cardId === "fault_resonance") {
    const mark = run.combat?.enemies.reduce((sum, enemy) => sum + (enemy.hp > 0 ? enemy.powers.mark ?? 0 : 0), 0) ?? 0;
    score += Math.min(34, mark * 5) + 8;
  }

  if (card.cardId === "spark_cascade") {
    const spark = run.combat?.enemies.reduce((sum, enemy) => sum + (enemy.hp > 0 ? enemy.powers.spark ?? 0 : 0), 0) ?? 0;
    const enemyCount = run.combat?.enemies.filter((enemy) => enemy.hp > 0).length ?? 1;
    score += Math.min(42, spark * 5 + enemyCount * 6);
  }

  if (card.cardId === "discharge") {
    const charge = run.combat?.playerPowers.charge ?? 0;
    const enemyCount = run.combat?.enemies.filter((enemy) => enemy.hp > 0).length ?? 1;
    score += Math.min(44, charge * 7 + enemyCount * 4);
    if (charge < 2) {
      score -= 28;
    }
  }

  if (card.cardId === "arc_barrier") {
    const charge = run.combat?.playerPowers.charge ?? 0;
    score += Math.min(28, charge * 4);
  }

  if (card.cardId === "arc_blade") {
    const spark = run.combat?.enemies.reduce((sum, enemy) => sum + (enemy.hp > 0 ? enemy.powers.spark ?? 0 : 0), 0) ?? 0;
    score += spark > 0 ? 12 : 4;
  }

  if (card.cardId === "capacitor") {
    score += (run.combat?.playerPowers.charge ?? 0) < 3 ? 16 : 2;
  }

  if (card.cardId === "storm_core") {
    const enemyCount = run.combat?.enemies.filter((enemy) => enemy.hp > 0).length ?? 1;
    score += enemyCount >= 2 ? 18 : 4;
  }

  if (card.cardId === "deep_cut") {
    score += run.combat?.enemies.some((enemy) => enemy.hp > 0 && (enemy.powers.bleed ?? 0) > 0) ? 10 : 0;
  }

  if (card.cardId === "expose_weakness") {
    const hasTargetMark = run.combat?.enemies.some((enemy) => enemy.hp > 0 && (enemy.powers.mark ?? 0) >= 4);
    score += hasTargetMark ? -18 : 16;
  }

  if (card.cardId === "tempo_shift") {
    const hasFinisher = [...(run.combat?.hand ?? []), ...(run.combat?.drawPile ?? [])].some((item) => item.cardId === "finisher");
    score += hasFinisher ? 24 : 4;
  }

  if (card.cardId === "plated_guard") {
    score += run.player.hp / run.player.maxHp < 0.65 ? 18 : 6;
  }

  if (card.cardId === "salvage") {
    const recoverable = run.combat?.discardPile.filter((item) => CARDS[item.cardId].type !== "Status").length ?? 0;
    score += recoverable > 0 ? Math.min(28, recoverable * 12) : -20;
  }

  if (card.cardId === "memory_hook") {
    const recoverableAttacks = run.combat?.discardPile.filter((item) => CARDS[item.cardId].type === "Attack").length ?? 0;
    score += recoverableAttacks > 0 ? 22 : -24;
    score += Math.min(18, (run.combat?.playerPowers.combo ?? 0) * 3);
  }

  if (card.cardId === "shield_recall") {
    const recoverableSkills = run.combat?.discardPile.filter((item) => CARDS[item.cardId].type === "Skill").length ?? 0;
    score += recoverableSkills > 0 ? Math.min(24, recoverableSkills * 10) : -16;
  }

  if (card.cardId === "field_tactics") {
    const recoverable = run.combat?.discardPile.filter((item) => CARDS[item.cardId].type !== "Status").length ?? 0;
    score += recoverable > 0 ? Math.min(32, recoverable * 11) : -18;
    if (incoming > (run.combat?.playerBlock ?? 0)) {
      score += 8;
    }
  }

  if (card.cardId === "emergency_orders") {
    const recoverable = run.combat?.discardPile.filter((item) => CARDS[item.cardId].type !== "Status").length ?? 0;
    score += recoverable > 0 ? 18 : 0;
    score += run.combat && run.combat.energy <= 1 ? 14 : 0;
  }

  if (card.cardId === "fracture_thrust") {
    const needsMark = run.combat?.enemies.some((enemy) => enemy.hp > 0 && (enemy.powers.mark ?? 0) < 3);
    score += needsMark ? 12 : -4;
  }

  if (card.cardId === "venom_cut") {
    const hardTarget = run.combat?.enemies.some((enemy) => enemy.hp > 24 && (enemy.powers.poison ?? 0) + (enemy.powers.bleed ?? 0) < 5);
    score += hardTarget ? 12 : 0;
  }

  if (card.cardId === "bulwark_engine") {
    score += run.player.hp / run.player.maxHp < 0.72 ? 12 : 4;
  }

  if (card.cardId === "whirlwind") {
    const attacksThisTurn = run.combat?.attacksPlayedThisTurn ?? 0;
    const enemyCount = run.combat?.enemies.filter((enemy) => enemy.hp > 0).length ?? 1;
    score += Math.min(48, attacksThisTurn * 9 + enemyCount * 5);
    if (attacksThisTurn < 1) {
      score -= 20;
    }
  }

  if (card.cardId === "berserk_edge") {
    const strength = run.combat?.playerPowers.strength ?? 0;
    score += Math.min(54, strength * 7);
    if (strength < 3) {
      score -= 30;
    }
  }

  if (card.cardId === "flurry" || card.cardId === "heavy_blow") {
    const strength = run.combat?.playerPowers.strength ?? 0;
    score += Math.min(28, strength * (card.cardId === "flurry" ? 6 : 3));
  }

  if (card.cardId === "tidal_edge") {
    const dexterity = run.combat?.playerPowers.dexterity ?? 0;
    score += Math.min(30, dexterity * 6);
  }

  if (card.cardId === "spike_surge") {
    const thorns = run.combat?.playerPowers.thorns ?? 0;
    const enemyCount = run.combat?.enemies.filter((enemy) => enemy.hp > 0).length ?? 1;
    score += Math.min(46, thorns * 6 + enemyCount * 4);
    if (thorns < 2) {
      score -= 24;
    }
  }

  if (card.cardId === "spine_wall") {
    const blockNeed = Math.max(0, incoming - (run.combat?.playerBlock ?? 0));
    score += Math.min(16, blockNeed);
    if (run.player.deck.some((item) => item.cardId === "spike_surge")) {
      score += 10;
    }
  }

  if (card.cardId === "blood_forge") {
    const regen = run.combat?.playerPowers.regen ?? 0;
    score += regen > 0 ? Math.min(40, regen * 9) : -28;
  }

  if (card.cardId === "doom_mark") {
    const enemyCount = run.combat?.enemies.filter((enemy) => enemy.hp > 0).length ?? 1;
    score += 12 + (enemyCount >= 2 ? 8 : 0);
  }

  score -= level.cost * 4;
  return score;
}

function countStatusCards(run: RunState): number {
  const combat = run.combat;
  if (!combat) {
    return run.player.deck.filter((card) => CARDS[card.cardId].type === "Status").length;
  }
  return [...combat.hand, ...combat.drawPile, ...combat.discardPile].filter((card) => CARDS[card.cardId].type === "Status")
    .length;
}

function chooseTarget(run: RunState, card: CardInstance): EnemyState | undefined {
  const combat = run.combat;
  if (!combat || !cardNeedsTarget(card)) {
    return undefined;
  }

  return [...combat.enemies]
    .filter((enemy) => enemy.hp > 0)
    .sort((a, b) => targetScore(b) - targetScore(a))[0];
}

function targetScore(enemy: EnemyState): number {
  const hpPressure = 100 - enemy.hp;
  const stackPressure =
    (enemy.powers.bleed ?? 0) * 4 +
    (enemy.powers.mark ?? 0) * 3 +
    (enemy.powers.spark ?? 0) * 4 -
    (enemy.powers.platedArmor ?? 0) * 2;
  const intentPressure = enemy.intent.effects.reduce((sum, effect) => {
    if (effect.type === "damage") {
      return sum + effect.amount * (effect.hits ?? 1);
    }
    if (effect.type === "applyPower" && effect.target === "player") {
      return sum + 8;
    }
    return sum;
  }, 0);
  return hpPressure + intentPressure + stackPressure - enemy.block * 0.6;
}

function expectedIncomingDamage(run: RunState): number {
  const combat = run.combat;
  if (!combat) {
    return 0;
  }

  let playerMark = combat.playerPowers.mark ?? 0;
  return combat.enemies
    .filter((enemy) => enemy.hp > 0)
    .flatMap((enemy) => enemy.intent.effects.map((effect) => ({ enemy, effect })))
    .reduce((sum, { enemy, effect }) => {
      if (effect.type !== "damage") {
        return sum;
      }
      let total = 0;
      for (let hit = 0; hit < (effect.hits ?? 1); hit += 1) {
        let damage = Math.max(0, effect.amount + (enemy.powers.strength ?? 0));
        if (playerMark > 0 && damage > 0) {
          damage += playerMark * 2;
          playerMark = Math.max(0, playerMark - 1);
        }
        if ((enemy.powers.weak ?? 0) > 0) {
          damage = Math.floor(damage * 0.75);
        }
        if ((combat.playerPowers.vulnerable ?? 0) > 0) {
          damage = Math.ceil(damage * 1.5);
        }
        total += damage;
      }
      return sum + total;
    }, 0);
}

function chooseRewardCard(run: RunState): number | undefined {
  const reward = run.reward;
  if (!reward) {
    return undefined;
  }

  const scored = reward.cards.map((offer, index) => {
    const score = (CARD_SCORE[offer.cardId] ?? 40) + (offer.upgraded ? 10 : 0) - deckPenalty(run, offer.cardId);
    return { index, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored[0] && scored[0].score >= 46 ? scored[0].index : undefined;
}

function chooseRewardBoon(run: RunState): number | undefined {
  const reward = run.reward;
  if (!reward?.boons?.length) {
    return undefined;
  }

  const scored = reward.boons.map((offer, index) => {
    const rarityBonus = BOONS[offer.boonId].rarity === "rare" ? 4 : BOONS[offer.boonId].rarity === "uncommon" ? 2 : 0;
    return { index, score: (BOON_SCORE[offer.boonId] ?? 60) + rarityBonus };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored[0] && scored[0].score >= 64 ? scored[0].index : undefined;
}

function deckPenalty(run: RunState, cardId: string): number {
  const copies = run.player.deck.filter((card) => card.cardId === cardId).length;
  const def = CARDS[cardId];
  if (def.type === "Power") {
    return copies * 22;
  }
  return Math.max(0, copies - 1) * 8;
}

function chooseMapNode(run: RunState): string {
  const available = getAvailableNodeIds(run)
    .map((nodeId) => run.map.find((node) => node.id === nodeId))
    .filter(Boolean) as MapNode[];

  const hpRatio = run.player.hp / run.player.maxHp;
  const scored = available.map((node) => {
    let score = 0;
    if (node.type === "fight") score = 55;
    if (node.type === "event") score = 52;
    if (node.type === "shop") score = run.player.gold >= 90 ? 58 : 34;
    if (node.type === "rest") score = hpRatio < 0.62 ? 88 : 42;
    if (node.type === "elite") score = hpRatio > 0.68 ? 72 : 16;
    if (node.type === "boss") score = 100;
    return { node, score };
  });

  scored.sort((a, b) => b.score - a.score || a.node.lane - b.node.lane);
  return scored[0].node.id;
}

function shouldHealAtRest(run: RunState): boolean {
  const hpRatio = run.player.hp / run.player.maxHp;
  const hasGoodUpgrade = run.player.deck.some((card) => !card.upgraded && (CARD_SCORE[card.cardId] ?? 0) >= 48);
  return hpRatio < 0.52 || (hpRatio < 0.72 && !hasGoodUpgrade);
}

function shouldBrewAtRest(run: RunState): boolean {
  const hpRatio = run.player.hp / run.player.maxHp;
  const hasPotionSpace = run.player.potions.length < run.player.potionSlots;
  const hasGoodUpgrade = run.player.deck.some((card) => !card.upgraded && (CARD_SCORE[card.cardId] ?? 0) >= 48);
  return hasPotionSpace && hpRatio >= 0.72 && (!hasGoodUpgrade || run.player.potions.length === 0);
}

function shouldCleanseAtRest(run: RunState): boolean {
  const hpRatio = run.player.hp / run.player.maxHp;
  const statusCount = run.player.deck.filter((card) => CARDS[card.cardId].type === "Status").length;
  return statusCount > 0 && hpRatio >= 0.62;
}

function chooseUpgrade(run: RunState): string | undefined {
  const card = [...run.player.deck]
    .filter((item) => !item.upgraded)
    .sort((a, b) => (CARD_SCORE[b.cardId] ?? 0) - (CARD_SCORE[a.cardId] ?? 0))[0];
  return card?.uid;
}

function simulateShop(run: RunState): RunState {
  let current = run;
  let bought = true;
  while (current.phase === "shop" && bought) {
    bought = false;
    const shop = current.shop;
    if (!shop) break;

    const relic = shop.relics
      .map((offer, index) => ({ offer, index, score: RELIC_SCORE[offer.relicId] ?? 45 }))
      .filter(({ offer, score }) => !offer.sold && current.player.gold >= offer.price && score >= 62)
      .sort((a, b) => b.score - a.score)[0];
    if (relic) {
      current = buyShopRelic(current, relic.index);
      bought = true;
      continue;
    }

    const card = shop.cards
      .map((offer, index) => ({ offer, index, score: (CARD_SCORE[offer.cardId] ?? 40) + (offer.upgraded ? 8 : 0) }))
      .filter(({ offer, score }) => !offer.sold && current.player.gold >= (offer.price ?? 0) && score >= 70)
      .sort((a, b) => b.score - a.score)[0];
    if (card) {
      current = buyShopCard(current, card.index);
      bought = true;
      continue;
    }

    const boon = (shop.boons ?? [])
      .map((offer, index) => ({ offer, index, score: BOON_SCORE[offer.boonId] ?? 58 }))
      .filter(({ offer, score }) => {
        return !offer.sold && current.player.gold >= (offer.price ?? 0) && score >= 68;
      })
      .sort((a, b) => b.score - a.score)[0];
    if (boon) {
      current = buyShopBoon(current, boon.index);
      bought = true;
      continue;
    }

    const removeTarget = chooseShopRemoveCard(current);
    if (removeTarget && !shop.removeSold && current.player.gold >= shop.removePrice) {
      current = buyShopRemove(current, removeTarget.uid);
      bought = true;
      continue;
    }

    const potion = shop.potions
      .map((offer, index) => ({ offer, index, score: POTION_SCORE[offer.potionId] ?? 45 }))
      .filter(({ offer, score }) => {
        return (
          !offer.sold &&
          current.player.gold >= offer.price &&
          current.player.potions.length < current.player.potionSlots &&
          score >= 62
        );
      })
      .sort((a, b) => b.score - a.score)[0];
    if (potion) {
      current = buyShopPotion(current, potion.index);
      bought = true;
      continue;
    }

    if (current.player.hp / current.player.maxHp < 0.52 && current.player.gold >= shop.healPrice && !shop.healSold) {
      current = buyShopHeal(current);
      bought = true;
      continue;
    }

    if (!shop.restocked && current.player.gold >= shop.restockPrice + 55) {
      current = restockShop(current);
      bought = true;
    }
  }

  return current.phase === "shop" ? leaveShop(current) : current;
}

function chooseShopRemoveCard(run: RunState): CardInstance | undefined {
  const shop = run.shop;
  if (!shop || shop.removeSold || run.player.deck.length <= 8 || run.player.gold < shop.removePrice + 25) {
    return undefined;
  }

  const scored = run.player.deck.map((card) => {
    let score = CARD_SCORE[card.cardId] ?? 42;
    if (card.cardId === "strike") score = 8;
    if (card.cardId === "defend") score = 12;
    if (CARDS[card.cardId].rarity === "status") score = -20;
    if (card.upgraded) score += 8;
    return { card, score };
  });
  scored.sort((a, b) => a.score - b.score);
  return scored[0]?.score <= 24 ? scored[0].card : undefined;
}

function chooseEvent(run: RunState): string {
  const event = run.event;
  if (!event) {
    return "leave";
  }

  const hpRatio = run.player.hp / run.player.maxHp;
  const canChoose = (id: string) => !event.options.find((option) => option.id === id)?.disabled;
  if (event.id === "blood_shrine") {
    if (hpRatio > 0.72 && !event.options.find((option) => option.id === "offer")?.disabled) {
      return "offer";
    }
    return "sip";
  }

  if (event.id === "forgotten_armory") {
    return hpRatio > 0.55 ? "weapon" : "armor";
  }

  if (event.id === "merchant_cache") {
    return run.player.gold >= 80 && run.player.deck.some((card) => !card.upgraded) ? "invest" : "take_gold";
  }

  if (event.id === "alchemist_table") {
    if (run.player.gold >= 90 && run.player.potionSlots <= 3) {
      return "rack";
    }
    if (run.player.potions.length < run.player.potionSlots) {
      return hpRatio > 0.62 ? "distill" : "brew";
    }
    return "leave";
  }

  if (event.id === "static_obelisk") {
    if (!run.player.boons.includes("static_attunement") && hpRatio > 0.65) {
      return "attune";
    }
    if (hpRatio > 0.58 && run.player.deck.filter((card) => card.cardId === "arc_blade").length < 2) {
      return "blade";
    }
    return run.player.potions.length < run.player.potionSlots ? "bottle" : "leave";
  }

  if (event.id === "storm_chest") {
    const hasCapacitor = run.player.deck.some((card) => card.cardId === "capacitor");
    if (!hasCapacitor || run.player.potions.length < run.player.potionSlots) {
      return "socket";
    }
    return hpRatio > 0.7 ? "overload" : "sell_core";
  }

  if (event.id === "living_mirror") {
    const hasBasic = run.player.deck.some((card) => card.cardId === "strike" || card.cardId === "defend");
    const hasGoodNonStarter = run.player.deck.some((card) => (CARD_SCORE[card.cardId] ?? 0) >= 72 && CARDS[card.cardId].rarity !== "starter");
    if (hpRatio > 0.58 && hasBasic) {
      return "shatter";
    }
    if (hpRatio > 0.72 && hasGoodNonStarter) {
      return "copy";
    }
    return "transmute";
  }

  if (event.id === "boon_carver") {
    const hasCarvable = run.player.deck.some(
      (card) => CARDS[card.cardId].rarity === "status" || card.cardId === "strike" || card.cardId === "defend",
    );
    if (hpRatio > 0.55 && hasCarvable && run.player.deck.length > 10) {
      return "chip";
    }
    if (run.player.gold >= 75 && run.player.boons.length < 4) {
      return "commission";
    }
    return hpRatio > 0.72 && run.player.boons.length < 4 ? "blood_mark" : "leave";
  }

  if (event.id === "cursed_archive") {
    if (hpRatio > 0.7 && run.player.deck.length > 13) {
      return "erase";
    }
    if (run.player.boons.length < 2 && run.player.deck.length < 18) {
      return "seal";
    }
    return "read";
  }

  if (event.id === "wandering_trainer") {
    if (run.player.gold >= 70 && run.player.deck.some((card) => !card.upgraded)) {
      return "lesson";
    }
    if (hpRatio > 0.68) {
      return "spar";
    }
    return "breathe";
  }

  if (event.id === "crystal_garden") {
    if (hpRatio < 0.55) {
      return "rest";
    }
    return run.player.maxHp < 88 ? "root" : "harvest";
  }

  if (event.id === "quiet_clinic") {
    const hasStatus = run.player.deck.some((card) => CARDS[card.cardId].rarity === "status");
    if (hasStatus && run.player.gold >= 30) {
      return "cleanse";
    }
    if (run.player.potions.length < run.player.potionSlots && hpRatio > 0.5) {
      return "serum";
    }
    return hpRatio < 0.82 ? "stitch" : "leave";
  }

  if (event.id === "memory_well") {
    const hasStatus = run.player.deck.some((card) => CARDS[card.cardId].rarity === "status");
    const hasHook = run.player.deck.some((card) => card.cardId === "memory_hook");
    if (run.player.gold >= 55 && (hasStatus || run.player.deck.length >= 14) && canChoose("dredge")) {
      return "dredge";
    }
    if (hpRatio > 0.58 && !hasHook && canChoose("echo")) {
      return "echo";
    }
    if (run.player.potions.length < run.player.potionSlots && canChoose("siphon")) {
      return "siphon";
    }
    return "leave";
  }

  if (event.id === "rune_forge") {
    const upgradeable = run.player.deck.filter((card) => !card.upgraded).length;
    if (run.player.gold >= 75 && upgradeable >= 2 && canChoose("etch")) {
      return "etch";
    }
    if (hpRatio > 0.62 && canChoose("reforge")) {
      return "reforge";
    }
    return canChoose("quench") ? "quench" : "leave";
  }

  if (event.id === "venom_greenhouse") {
    if (run.player.gold >= 65 && !run.player.boons.includes("blade_oil") && canChoose("coat_blade")) {
      return "coat_blade";
    }
    const poisonCards = run.player.deck.filter((card) => card.cardId === "poison_dart" || card.cardId === "venom_stance").length;
    if (poisonCards < 3 && canChoose("distill_venom")) {
      return "distill_venom";
    }
    if (run.player.potions.length < run.player.potionSlots && canChoose("take_sample")) {
      return "take_sample";
    }
    return "leave";
  }

  if (event.id === "plated_sanctum") {
    if (run.player.gold >= 80 && !run.player.boons.includes("plate_training") && canChoose("train_plate")) {
      return "train_plate";
    }
    if (hpRatio > 0.54 && canChoose("forge_guard")) {
      return "forge_guard";
    }
    return hpRatio < 0.86 ? "patch_armor" : "leave";
  }

  if (event.id === "bottled_spirit") {
    if (run.player.potions.length > 0 && run.player.boons.length < 5 && canChoose("release")) {
      return "release";
    }
    if (run.player.gold >= 70 && run.player.potionSlots < 5 && canChoose("stabilize")) {
      return "stabilize";
    }
    if (run.player.potions.length > 1 && canChoose("decant")) {
      return "decant";
    }
    return "leave";
  }

  if (event.id === "path_scout") {
    if (run.player.gold >= 65 && hpRatio < 0.78 && canChoose("chart_rest")) {
      return "chart_rest";
    }
    if (hpRatio > 0.72 && run.player.deck.length >= 15 && canChoose("mark_elite")) {
      return "mark_elite";
    }
    return "take_rations";
  }

  if (event.id === "flask_gambit") {
    if (run.player.potions.length > 0 && run.player.boons.length < 5 && canChoose("transfuse")) {
      return "transfuse";
    }
    if (run.player.gold >= 55 && run.player.potions.length < run.player.potionSlots && canChoose("overbrew")) {
      return "overbrew";
    }
    return run.player.potionSlots < 5 ? "crack_case" : "leave";
  }

  if (event.id === "relic_tinker") {
    const hasPawnableRelic = run.player.relics.some((relicId) => RELICS[relicId]?.rarity !== "starter" && RELICS[relicId]?.rarity !== "boss");
    if (run.player.gold >= 85 && canChoose("tune")) {
      return "tune";
    }
    if (hasPawnableRelic && run.player.deck.some((card) => !card.upgraded) && run.player.gold < 60 && canChoose("pawn")) {
      return "pawn";
    }
    return hpRatio < 0.9 && canChoose("polish") ? "polish" : "leave";
  }

  if (event.id === "fracture_gate") {
    if (!run.player.boons.includes("weakpoint_chart") && run.player.gold >= 60 && canChoose("map_cracks")) {
      return "map_cracks";
    }
    if (hpRatio > 0.68 && canChoose("step_through")) {
      return "step_through";
    }
    return hpRatio < 0.86 && canChoose("seal_gate") ? "seal_gate" : "leave";
  }

  if (event.id === "catalyst_lab") {
    if (!run.player.boons.includes("catalyst_training") && run.player.gold >= 70 && canChoose("learn_pattern")) {
      return "learn_pattern";
    }
    if (run.player.potions.length < run.player.potionSlots && canChoose("take_vial")) {
      return "take_vial";
    }
    if (hpRatio > 0.64 && !run.player.deck.some((card) => card.cardId === "blood_catalyst") && canChoose("record_formula")) {
      return "record_formula";
    }
    return "leave";
  }

  if (event.id === "coil_workbench") {
    const hasArmorPayoff = run.player.deck.some((card) => card.cardId === "alloy_shell" || card.cardId === "plated_guard" || card.cardId === "body_slam");
    const hasChargePayoff = run.player.deck.some((card) => card.cardId === "coil_lash" || card.cardId === "static_rebuke" || card.cardId === "discharge");
    if (!run.player.boons.includes("tempered_shell") && run.player.gold >= 75 && (hasArmorPayoff || run.player.boons.length < 3) && canChoose("temper_shell")) {
      return "temper_shell";
    }
    if (hpRatio > 0.62 && !hasChargePayoff && canChoose("wind_coil")) {
      return "wind_coil";
    }
    if (run.player.gold >= 55 && canChoose("plate_cache")) {
      return "plate_cache";
    }
    return "leave";
  }

  if (event.id === "black_contract") {
    if (run.player.gold >= 85 && run.player.relics.length < 5 && canChoose("underwrite")) {
      return "underwrite";
    }
    if (hpRatio > 0.68 && run.player.maxHp > 58 && run.player.deck.length < 18 && canChoose("blood_clause")) {
      return "blood_clause";
    }
    if (run.player.deck.filter((card) => CARDS[card.cardId].rarity === "status").length <= 3 && canChoose("contraband")) {
      return "contraband";
    }
    return "leave";
  }

  if (event.id === "strategy_table") {
    const hasRecoverPlan = run.player.deck.some((card) => card.cardId === "field_tactics" || card.cardId === "salvage");
    if (!run.player.boons.includes("field_protocol") && run.player.gold >= 76 && run.player.boons.length < 5 && canChoose("protocol")) {
      return "protocol";
    }
    if (!hasRecoverPlan && run.player.gold >= 52 && canChoose("manual")) {
      return "manual";
    }
    if (run.player.potions.length < run.player.potionSlots && run.player.gold >= 42 && canChoose("kit")) {
      return "kit";
    }
    return canChoose("manual") ? "manual" : "leave";
  }

  if (event.id === "old_warbanner") {
    const hasTempoPower = run.player.deck.some((card) => card.cardId === "battle_rhythm");
    if (!run.player.boons.includes("banner_drill") && run.player.gold >= 76 && run.player.boons.length < 5 && canChoose("learn_drill")) {
      return "learn_drill";
    }
    if (!hasTempoPower && run.player.gold >= 48 && canChoose("take_banner")) {
      return "take_banner";
    }
    if (run.player.potions.length < run.player.potionSlots && run.player.gold >= 42 && canChoose("rally_dose")) {
      return "rally_dose";
    }
    return canChoose("take_banner") ? "take_banner" : "leave";
  }

  if (event.id === "field_infirmary") {
    const statusCount = run.player.deck.filter((card) => CARDS[card.cardId].type === "Status").length;
    const hasRecycler = run.player.deck.some((card) => card.cardId === "trauma_recycler" || card.cardId === "purge");
    if (!run.player.boons.includes("triage_doctrine") && run.player.gold >= 78 && (statusCount > 0 || hasRecycler) && canChoose("doctrine")) {
      return "doctrine";
    }
    if (!hasRecycler && run.player.gold >= 50 && canChoose("manual")) {
      return "manual";
    }
    if (run.player.potions.length < run.player.potionSlots && statusCount > 0 && run.player.gold >= 40 && canChoose("salve")) {
      return "salve";
    }
    return canChoose("manual") ? "manual" : "leave";
  }

  if (event.id === "ash_archive") {
    const statusCount = run.player.deck.filter((card) => CARDS[card.cardId].type === "Status").length;
    const hasExhaustPayoff = run.player.deck.some((card) => card.cardId === "ash_ward" || card.cardId === "purge" || card.cardId === "trauma_recycler");
    if (!run.player.boons.includes("ash_ledger") && run.player.gold >= 78 && (statusCount > 0 || hasExhaustPayoff) && canChoose("ledger")) {
      return "ledger";
    }
    if (!hasExhaustPayoff && run.player.gold >= 54 && canChoose("ward")) {
      return "ward";
    }
    if (run.player.potions.length < run.player.potionSlots && run.player.gold >= 42 && canChoose("bottle")) {
      return "bottle";
    }
    return canChoose("ward") ? "ward" : "leave";
  }

  if (event.id === "rhythm_metronome") {
    const hasRhythmCard = run.player.deck.some((card) => card.cardId === "rhythm_battery");
    const hasTempoPayoff = run.player.deck.some((card) =>
      ["tempo_shift", "battle_rhythm", "finisher", "rhythm_battery", "chain_guard", "coil_lash", "static_rebuke", "discharge"].includes(card.cardId),
    );
    if (!run.player.boons.includes("rhythm_meter") && run.player.gold >= 70 && (hasTempoPayoff || run.player.boons.length < 4) && canChoose("meter")) {
      return "meter";
    }
    if (!hasRhythmCard && run.player.gold >= 44 && canChoose("calibrate")) {
      return "calibrate";
    }
    if (run.player.potions.length < run.player.potionSlots && run.player.gold >= 38 && canChoose("drink")) {
      return "drink";
    }
    return canChoose("calibrate") ? "calibrate" : "leave";
  }

  if (event.id === "chain_hourglass") {
    const hasChainCard = run.player.deck.some((card) => card.cardId === "chain_guard");
    const hasChainPayoff =
      run.player.deck.some((card) => ["quick_stab", "tempo_shift", "battle_trance", "adrenaline", "charged_thought", "field_tactics"].includes(card.cardId)) ||
      run.player.boons.includes("rhythm_meter");
    if (!run.player.boons.includes("chain_manual") && run.player.gold >= 78 && (hasChainPayoff || run.player.boons.length < 4) && canChoose("manual")) {
      return "manual";
    }
    if (!hasChainCard && run.player.gold >= 50 && canChoose("bind")) {
      return "bind";
    }
    if (run.player.potions.length < run.player.potionSlots && run.player.gold >= 42 && canChoose("dose")) {
      return "dose";
    }
    return canChoose("bind") ? "bind" : "leave";
  }

  if (event.id === "cooling_station") {
    const hasHeatSink = run.player.deck.some((card) => card.cardId === "heat_sink");
    const hasOverload = run.player.deck.some((card) => card.cardId === "overload_surge" || card.cardId === "blood_pact");
    if (!run.player.boons.includes("heat_regulator") && run.player.gold >= 82 && (hasOverload || run.player.boons.length < 4) && canChoose("regulator")) {
      return "regulator";
    }
    if (!hasHeatSink && run.player.gold >= 54 && canChoose("plate")) {
      return "plate";
    }
    if (run.player.potions.length < run.player.potionSlots && run.player.gold >= 42 && (hasOverload || run.player.hp / run.player.maxHp < 0.65) && canChoose("coolant")) {
      return "coolant";
    }
    return canChoose("plate") ? "plate" : "leave";
  }

  if (event.id === "triage_station") {
    if (run.player.boons.length < 4 && hpRatio > 0.6 && canChoose("boon_token")) {
      return "boon_token";
    }
    if (run.player.potions.length < run.player.potionSlots && run.player.gold >= 45 && canChoose("potion_crate")) {
      return "potion_crate";
    }
    if (run.player.gold >= 45 && run.player.deck.length < 18 && canChoose("card_crate")) {
      return "card_crate";
    }
    return "leave";
  }

  return "leave";
}

function summarize(results: SimResult[]) {
  const wins = results.filter((result) => result.won).length;
  return {
    runs: results.length,
    wins,
    winRate: wins / results.length,
    avgFloor: average(results.map((result) => result.floor)),
    avgNodes: average(results.map((result) => result.nodes)),
    avgHpOnWin: average(results.filter((result) => result.won).map((result) => result.hp)),
    avgGold: average(results.map((result) => result.goldEarned)),
    avgDamage: average(results.map((result) => result.damage)),
  };
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

for (const difficulty of Object.keys(DIFFICULTIES) as DifficultyKey[]) {
  const results: SimResult[] = [];
  for (let i = 0; i < RUNS_PER_DIFFICULTY; i += 1) {
    results.push(simulateRun(100000 + i * 977 + difficulty.length * 131, difficulty));
  }
  const summary = summarize(results);
  console.log(
    [
      `${DIFFICULTIES[difficulty].name.padEnd(4, " ")}`,
      `胜率 ${(summary.winRate * 100).toFixed(1).padStart(5, " ")}%`,
      `均层 ${summary.avgFloor.toFixed(1).padStart(4, " ")}`,
      `均节点 ${summary.avgNodes.toFixed(1).padStart(4, " ")}`,
      `胜局均血 ${summary.avgHpOnWin.toFixed(1).padStart(5, " ")}`,
      `均金币 ${summary.avgGold.toFixed(1).padStart(5, " ")}`,
      `均伤害 ${summary.avgDamage.toFixed(0).padStart(5, " ")}`,
    ].join(" | "),
  );
}
