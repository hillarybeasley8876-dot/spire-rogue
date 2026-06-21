export type Phase =
  | "title"
  | "map"
  | "combat"
  | "reward"
  | "rest"
  | "shop"
  | "event"
  | "victory"
  | "defeat";

export type NodeType = "fight" | "elite" | "rest" | "shop" | "event" | "boss";
export type MapZone = "outer" | "wild" | "forge" | "sanctum" | "rift" | "heart";
export type MapRouteKind = "start" | "branch" | "converge" | "choke" | "crossroad" | "summit";
export type CardType = "Attack" | "Skill" | "Power" | "Status";
export type Rarity = "starter" | "common" | "uncommon" | "rare" | "boss" | "status";
export type DifficultyKey = "story" | "standard" | "hard" | "nightmare";

export interface DifficultyConfig {
  id: DifficultyKey;
  name: string;
  tagline: string;
  text: string;
  startingHp: number;
  startingGold: number;
  enemyHpMultiplier: number;
  enemyDamageMultiplier: number;
  enemyBlockMultiplier: number;
  rewardGoldMultiplier: number;
  shopPriceMultiplier: number;
  rewardUpgradeBonus: number;
}

export type PowerKey =
  | "strength"
  | "dexterity"
  | "vulnerable"
  | "weak"
  | "frail"
  | "poison"
  | "regen"
  | "thorns"
  | "ritual"
  | "bleed"
  | "mark"
  | "platedArmor"
  | "combo"
  | "charge"
  | "spark";

export type PowerMap = Partial<Record<PowerKey, number>>;

export type CardEffect =
  | {
      type: "damage";
      amount: number;
      hits?: number;
      target: "enemy" | "allEnemies";
    }
  | {
      type: "damageFromBlock";
      multiplier: number;
      target: "enemy";
    }
  | {
      type: "damagePerAttackPlayed";
      amount: number;
      target: "enemy" | "allEnemies";
    }
  | {
      type: "damagePerPower";
      amount: number;
      power: PowerKey;
      powerTarget: "self" | "enemy";
      target: "enemy" | "allEnemies";
      consume?: boolean;
      minimum?: number;
    }
  | {
      type: "spendPowerDamage";
      amount: number;
      power: PowerKey;
      target: "enemy" | "allEnemies";
      consume?: number;
      minimum?: number;
    }
  | {
      type: "block";
      amount: number;
    }
  | {
      type: "blockPerPower";
      amount: number;
      power: PowerKey;
      consume?: number;
      minimum?: number;
    }
  | BlockPerExhaustedCardEffect
  | GainPowerPerPowerEffect
  | GainPowerPerCardPlayedEffect
  | CleansePowerEffect
  | {
      type: "applyPower";
      power: PowerKey;
      amount: number;
      target: "enemy" | "allEnemies" | "self";
    }
  | {
      type: "amplifyPower";
      power: PowerKey;
      target: "enemy" | "allEnemies" | "self";
      multiplier: number;
      minimum?: number;
    }
  | {
      type: "draw";
      amount: number;
    }
  | {
      type: "gainEnergy";
      amount: number;
    }
  | {
      type: "heal";
      amount: number;
    }
  | {
      type: "cleanseDebuffs";
    }
  | {
      type: "createCard";
      cardId: string;
      destination: "hand" | "draw" | "discard";
      upgraded?: boolean;
    }
  | ExhaustCardsEffect
  | {
      type: "returnFromDiscard";
      amount: number;
      cardType?: CardType;
      excludeStatus?: boolean;
    };

export interface CardLevel {
  cost: number;
  text: string;
  effects: CardEffect[];
  exhaust?: boolean;
  retain?: boolean;
  ethereal?: boolean;
  unplayable?: boolean;
  endTurnDamage?: number;
}

export interface CardDef {
  id: string;
  name: string;
  type: CardType;
  rarity: Rarity;
  tags?: string[];
  base: CardLevel;
  upgraded: CardLevel;
}

export interface CardInstance {
  uid: string;
  cardId: string;
  upgraded: boolean;
}

export interface ExhaustCardsEffect {
  type: "exhaustCards";
  amount: number;
  zone: "hand" | "discard" | "handAndDiscard";
  cardType?: CardType;
  gainBlockPerCard?: number;
  drawPerCard?: number;
  gainEnergyPerCard?: number;
  gainPowerPerCard?: {
    power: PowerKey;
    amount: number;
  };
}

export interface BlockPerExhaustedCardEffect {
  type: "blockPerExhaustedCard";
  amount: number;
  cap?: number;
  minimum?: number;
}

export interface GainPowerPerPowerEffect {
  type: "gainPowerPerPower";
  sourcePower: PowerKey;
  gainedPower: PowerKey;
  amount: number;
  cap?: number;
  minimum?: number;
}

export interface GainPowerPerCardPlayedEffect {
  type: "gainPowerPerCardPlayed";
  power: PowerKey;
  amount: number;
  cap?: number;
  minimum?: number;
}

export interface CleansePowerEffect {
  type: "cleansePower";
  power: PowerKey;
  amount: number;
  gainBlockPerStack?: number;
  gainPowerPerStack?: {
    power: PowerKey;
    amount: number;
  };
  gainEnergyPerStack?: number;
}

export type EnemyIntent = "attack" | "defend" | "buff" | "debuff" | "mixed" | "unknown";

export type EnemyEffect =
  | {
      type: "damage";
      amount: number;
      hits?: number;
    }
  | {
      type: "block";
      amount: number;
    }
  | {
      type: "applyPower";
      power: PowerKey;
      amount: number;
      target: "player" | "self";
    }
  | {
      type: "summon";
      enemyId: string;
    }
  | {
      type: "createCard";
      cardId: string;
      destination: "hand" | "draw" | "discard";
      upgraded?: boolean;
    };

export interface EnemyMove {
  id: string;
  name: string;
  intent: EnemyIntent;
  weight: number;
  effects: EnemyEffect[];
}

export interface EnemyDef {
  id: string;
  name: string;
  tier: "normal" | "elite" | "boss";
  maxHp: [number, number];
  moves: EnemyMove[];
  pattern?: string[];
}

export interface EnemyState {
  uid: string;
  defId: string;
  name: string;
  maxHp: number;
  hp: number;
  block: number;
  powers: PowerMap;
  intent: EnemyMove;
  moveIndex: number;
  lastMoveId?: string;
}

export interface EncounterDef {
  id: string;
  name: string;
  type: "fight" | "elite" | "boss";
  minFloor?: number;
  minAct?: number;
  maxAct?: number;
  enemies: string[];
}

export interface RelicDef {
  id: string;
  name: string;
  rarity: Rarity;
  text: string;
}

export type BoonId =
  | "vitality"
  | "bottle_rack"
  | "opening_guard"
  | "combo_discipline"
  | "static_attunement"
  | "plate_training"
  | "armory_drill"
  | "battle_focus"
  | "spark_conduit"
  | "bleed_edge"
  | "field_alchemy"
  | "blade_oil"
  | "venom_prep"
  | "reserve_battery"
  | "recovery_mantra"
  | "scavenger_kit"
  | "weakpoint_chart"
  | "catalyst_training"
  | "potion_catalyst"
  | "tempered_shell"
  | "coil_training"
  | "field_protocol"
  | "banner_drill"
  | "triage_doctrine"
  | "ash_ledger"
  | "rhythm_meter"
  | "chain_manual"
  | "heat_regulator";

export interface BoonDef {
  id: BoonId;
  name: string;
  rarity: Exclude<Rarity, "starter" | "boss" | "status">;
  text: string;
}

export type PotionTarget = "none" | "enemy" | "allEnemies" | "self";

export type PotionEffect =
  | {
      type: "damage";
      amount: number;
      target: "enemy" | "allEnemies";
    }
  | {
      type: "block";
      amount: number;
    }
  | BlockPerExhaustedCardEffect
  | GainPowerPerPowerEffect
  | GainPowerPerCardPlayedEffect
  | CleansePowerEffect
  | {
      type: "applyPower";
      power: PowerKey;
      amount: number;
      target: "enemy" | "allEnemies" | "self";
    }
  | {
      type: "amplifyPower";
      power: PowerKey;
      target: "enemy" | "allEnemies" | "self";
      multiplier: number;
      minimum?: number;
    }
  | {
      type: "draw";
      amount: number;
    }
  | {
      type: "gainEnergy";
      amount: number;
    }
  | {
      type: "heal";
      amount: number;
    }
  | {
      type: "cleanseDebuffs";
    }
  | ExhaustCardsEffect
  | {
      type: "returnFromDiscard";
      amount: number;
      cardType?: CardType;
      excludeStatus?: boolean;
    };

export interface PotionDef {
  id: string;
  name: string;
  rarity: Rarity;
  text: string;
  target: PotionTarget;
  effects: PotionEffect[];
}

export interface PotionInstance {
  uid: string;
  potionId: string;
}

export interface MapNode {
  id: string;
  floor: number;
  lane: number;
  x: number;
  y: number;
  type: NodeType;
  zone?: MapZone;
  routeKind?: MapRouteKind;
  children: string[];
  completed?: boolean;
}

export interface CombatState {
  nodeType: NodeType;
  encounterName: string;
  enemies: EnemyState[];
  drawPile: CardInstance[];
  hand: CardInstance[];
  discardPile: CardInstance[];
  exhaustPile: CardInstance[];
  energy: number;
  maxEnergy: number;
  turn: number;
  playerBlock: number;
  playerPowers: PowerMap;
  cardsPlayedThisTurn: number;
  cardsPlayedLastTurn: number;
  attackCount: number;
  attacksPlayedThisTurn: number;
  log: string[];
}

export interface CardOffer {
  cardId: string;
  upgraded: boolean;
  price?: number;
  sold?: boolean;
}

export interface RelicOffer {
  relicId: string;
  price: number;
  sold?: boolean;
}

export interface BoonOffer {
  boonId: BoonId;
  price?: number;
  sold?: boolean;
}

export interface PotionOffer {
  potionId: string;
  price: number;
  sold?: boolean;
}

export interface RewardState {
  nodeType: NodeType;
  title: string;
  gold: number;
  cards: CardOffer[];
  relicId?: string;
  potionId?: string;
  boons?: BoonOffer[];
  cardResolved?: boolean;
  boonResolved?: boolean;
  rerollPrice?: number;
  rerolled?: boolean;
}

export interface ShopState {
  cards: CardOffer[];
  relics: RelicOffer[];
  potions: PotionOffer[];
  boons: BoonOffer[];
  healPrice: number;
  healSold?: boolean;
  removePrice: number;
  removeSold?: boolean;
  restockPrice: number;
  restocked?: boolean;
}

export interface EventOption {
  id: string;
  label: string;
  text: string;
  disabled?: boolean;
  disabledReason?: string;
}

export interface EventState {
  id: string;
  title: string;
  text: string;
  options: EventOption[];
}

export interface PlayerState {
  hp: number;
  maxHp: number;
  gold: number;
  deck: CardInstance[];
  relics: string[];
  boons: BoonId[];
  potions: PotionInstance[];
  potionSlots: number;
}

export interface RunStats {
  fights: number;
  elites: number;
  bosses: number;
  cardsPlayed: number;
  damageDealt: number;
  goldEarned: number;
  nodesCleared: number;
}

export interface RunState {
  phase: Phase;
  seed: number;
  rng: number;
  runId: string;
  difficulty: DifficultyKey;
  act: number;
  floor: number;
  player: PlayerState;
  map: MapNode[];
  currentNodeId?: string;
  combat?: CombatState;
  reward?: RewardState;
  shop?: ShopState;
  event?: EventState;
  message?: string;
  stats: RunStats;
}
