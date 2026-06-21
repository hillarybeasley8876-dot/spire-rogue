import { useEffect, useMemo, useState } from "react";
import {
  Award,
  BookOpen,
  ChevronRight,
  Coins,
  FlaskConical,
  Flame,
  HeartPulse,
  Layers,
  Map as MapIcon,
  RotateCcw,
  Shield,
  ShoppingBag,
  Skull,
  Sparkles,
  Sword,
  Target,
  Trash2,
  Zap,
} from "lucide-react";
import { BOONS, CARDS, DIFFICULTIES, ENEMIES, POTIONS, POWER_HINTS, POWER_LABELS, RELICS } from "./game/data";
import {
  abandonToTitle,
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
  discardPotion,
  endTurn,
  enterNode,
  getAvailableNodeIds,
  getCardDef,
  getCardLevel,
  getCurrentEvent,
  leaveShop,
  potionNeedsTarget,
  playCard,
  restBrewPotion,
  restCleanseStatus,
  restHeal,
  restUpgrade,
  restockShop,
  rerollRewardCards,
  usePotion,
} from "./game/engine";
import type {
  CardInstance,
  BoonId,
  CardType,
  DifficultyKey,
  EnemyMove,
  EnemyState,
  ExhaustCardsEffect,
  MapNode,
  NodeType,
  PotionInstance,
  PotionEffect,
  PowerKey,
  PowerMap,
  RunState,
} from "./game/types";
import { clearSavedRun, isActiveRun, loadSavedRun, saveRun } from "./game/persistence";

const CARD_TYPE_LABELS = {
  Attack: "攻击",
  Skill: "技能",
  Power: "能力",
  Status: "状态",
};

const BUILD_TAG_PRIORITY = [
  "连击",
  "蓄能",
  "共振",
  "连锁",
  "过载",
  "散热",
  "电弧",
  "电弧催化",
  "流血",
  "流血催化",
  "破绽",
  "破绽催化",
  "金属化",
  "尖刺",
  "格挡",
  "抽牌",
  "能量",
  "回收",
  "消耗堆",
  "保留",
  "消耗",
  "净化",
  "群攻",
  "中毒",
  "中毒催化",
];

const MECHANIC_HINT_PRIORITY: PowerKey[] = [
  "combo",
  "charge",
  "spark",
  "bleed",
  "mark",
  "platedArmor",
  "poison",
  "vulnerable",
  "weak",
  "frail",
  "regen",
  "thorns",
  "ritual",
  "strength",
  "dexterity",
];

const NODE_LABELS: Record<NodeType, string> = {
  fight: "战斗",
  elite: "精英",
  rest: "休息",
  shop: "商店",
  event: "事件",
  boss: "Boss",
};

const NODE_HINTS: Record<NodeType, string> = {
  fight: "普通奖励",
  elite: "高风险高收益",
  rest: "回血/升级/调配",
  shop: "购买/移除/治疗",
  event: "特殊交换",
  boss: "终局检定",
};

const BOON_RARITY_LABELS = {
  common: "普通",
  uncommon: "罕见",
  rare: "稀有",
};

const BOON_MECHANIC_TAGS: Record<BoonId, string[]> = {
  vitality: ["生命", "回复"],
  bottle_rack: ["药水槽", "资源"],
  opening_guard: ["开局", "格挡"],
  combo_discipline: ["开局", "连击"],
  static_attunement: ["开局", "蓄能"],
  plate_training: ["开局", "金属化"],
  armory_drill: ["升级", "牌组"],
  battle_focus: ["开局", "抽牌"],
  spark_conduit: ["开局", "电弧"],
  bleed_edge: ["开局", "流血"],
  field_alchemy: ["药水", "资源"],
  blade_oil: ["开局", "力量"],
  venom_prep: ["开局", "中毒"],
  reserve_battery: ["开局", "能量"],
  recovery_mantra: ["开局", "回复"],
  scavenger_kit: ["开局", "回收"],
  weakpoint_chart: ["开局", "破绽"],
  catalyst_training: ["开局", "催化"],
  potion_catalyst: ["药水", "蓄能"],
  tempered_shell: ["开局", "金属化"],
  coil_training: ["开局", "蓄能"],
  rhythm_meter: ["开局", "连击", "蓄能"],
  chain_manual: ["连锁", "能量", "连击"],
  heat_regulator: ["开局", "散热", "蓄能"],
  field_protocol: ["开局", "回收"],
  banner_drill: ["开局", "破绽"],
  triage_doctrine: ["开局", "净化"],
  ash_ledger: ["开局", "消耗堆"],
};

interface TargetPreview {
  damage: number;
  blockLoss: number;
  powerAdds: Partial<Record<PowerKey, number>>;
  sparkArc: number;
  lethal: boolean;
}

interface ActionSummary {
  block: number;
  draw: number;
  energy: number;
  heal: number;
  selfPowers: Partial<Record<PowerKey, number>>;
  targetPowers: Partial<Record<PowerKey, number>>;
  consumes: string[];
  creates: string[];
  recovers: string[];
  cleanses: string[];
  amplifies: string[];
  resonates: string[];
  chains: string[];
}

interface CatalystInsight {
  enemyName: string;
  total: number;
  entries: [PowerKey, number][];
}

function App() {
  const [savedRun, setSavedRun] = useState<RunState | undefined>(() => loadSavedRun());
  const [run, setRun] = useState<RunState>(() => createInitialRun(Date.now(), "title"));
  const [difficulty, setDifficulty] = useState<DifficultyKey>("standard");
  const [selectedCardUid, setSelectedCardUid] = useState<string>();
  const [selectedPotionUid, setSelectedPotionUid] = useState<string>();

  useEffect(() => {
    setSelectedCardUid(undefined);
    setSelectedPotionUid(undefined);
  }, [run.phase, run.combat?.turn]);

  const selectedCard = run.combat?.hand.find((card) => card.uid === selectedCardUid);
  const selectedPotion = run.player.potions.find((potion) => potion.uid === selectedPotionUid);

  useEffect(() => {
    if (isActiveRun(run)) {
      saveRun(run);
      setSavedRun(run);
      return;
    }

    if (run.phase === "victory" || run.phase === "defeat") {
      clearSavedRun();
      setSavedRun(undefined);
    }
  }, [run]);

  function startNewRun() {
    setSelectedCardUid(undefined);
    setSelectedPotionUid(undefined);
    setRun(createInitialRun(Date.now(), "map", difficulty));
  }

  function continueSavedRun() {
    const current = loadSavedRun();
    if (!current) {
      setSavedRun(undefined);
      return;
    }
    setSelectedCardUid(undefined);
    setSelectedPotionUid(undefined);
    setDifficulty(current.difficulty);
    setRun(current);
  }

  function handleAbandonToTitle() {
    clearSavedRun();
    setSavedRun(undefined);
    setSelectedCardUid(undefined);
    setSelectedPotionUid(undefined);
    setRun((current) => abandonToTitle(current));
  }

  function handleCardClick(card: CardInstance) {
    if (!run.combat || !canPlayCard(run, card)) {
      return;
    }

    if (cardNeedsTarget(card)) {
      const living = run.combat.enemies.filter((enemy) => enemy.hp > 0);
      if (living.length === 1) {
        setRun((current) => playCard(current, card.uid, living[0].uid));
        setSelectedCardUid(undefined);
        setSelectedPotionUid(undefined);
        return;
      }
      setSelectedPotionUid(undefined);
      setSelectedCardUid((current) => (current === card.uid ? undefined : card.uid));
      return;
    }

    setRun((current) => playCard(current, card.uid));
    setSelectedCardUid(undefined);
    setSelectedPotionUid(undefined);
  }

  function handlePotionClick(potion: PotionInstance) {
    if (!run.combat) {
      return;
    }

    if (!potionNeedsTarget(potion) && selectedPotionUid === potion.uid) {
      handleUseSelectedPotion();
      return;
    }

    setSelectedCardUid(undefined);
    setSelectedPotionUid((current) => (current === potion.uid ? undefined : potion.uid));
  }

  function handleUseSelectedPotion() {
    if (!selectedPotionUid) {
      return;
    }

    setRun((current) => usePotion(current, selectedPotionUid));
    setSelectedPotionUid(undefined);
    setSelectedCardUid(undefined);
  }

  function handleClearSelection() {
    setSelectedCardUid(undefined);
    setSelectedPotionUid(undefined);
  }

  function handleEnemyClick(enemy: EnemyState) {
    if (selectedPotionUid && enemy.hp > 0) {
      setRun((current) => usePotion(current, selectedPotionUid, enemy.uid));
      setSelectedPotionUid(undefined);
      setSelectedCardUid(undefined);
      return;
    }

    if (!selectedCardUid || enemy.hp <= 0) {
      return;
    }
    setRun((current) => playCard(current, selectedCardUid, enemy.uid));
    setSelectedCardUid(undefined);
    setSelectedPotionUid(undefined);
  }

  return (
    <div className="app">
      <div className="app__backdrop" />
      <header className="topbar">
        <div className="brand">
          <span className="brand__mark">
            <Flame size={18} />
          </span>
          <div>
            <h1>裂隙尖塔</h1>
            <p>程序原型</p>
          </div>
        </div>

        {run.phase !== "title" && (
          <div className="topbar__stats">
            <StatPill icon={<HeartPulse size={17} />} label={`${run.player.hp}/${run.player.maxHp}`} tone="hp" />
            <StatPill icon={<Coins size={17} />} label={`${run.player.gold}`} tone="gold" />
            <StatPill icon={<Layers size={17} />} label={`${run.player.deck.length}`} tone="deck" />
            <StatPill icon={<MapIcon size={17} />} label={`幕 ${run.act ?? 1} · 层 ${Math.max(1, run.floor + 1)}`} tone="floor" />
            <StatPill icon={<Skull size={17} />} label={DIFFICULTIES[run.difficulty].name} tone="difficulty" />
          </div>
        )}

        {run.phase !== "title" && (
          <button className="icon-button" type="button" onClick={handleAbandonToTitle}>
            <RotateCcw size={17} />
            <span>返回标题</span>
          </button>
        )}
      </header>

      {run.message && run.phase !== "combat" && <div className="toast">{run.message}</div>}

      <main className={`screen screen--${run.phase}`}>
        {run.phase === "title" ? (
          <TitleScreen
            difficulty={difficulty}
            savedRun={savedRun}
            onDifficultyChange={setDifficulty}
            onStart={startNewRun}
            onContinue={continueSavedRun}
          />
        ) : (
          <div className="game-shell">
            <RunSidebar run={run} onDiscardPotion={(uid) => setRun((current) => discardPotion(current, uid))} />
            <div className="game-stage">
              {run.phase === "map" && <MapScreen run={run} onEnter={(nodeId) => setRun((current) => enterNode(current, nodeId))} />}
              {run.phase === "combat" && (
                <CombatScreen
                  run={run}
                  selectedCard={selectedCard}
                  selectedCardUid={selectedCardUid}
                  selectedPotion={selectedPotion}
                  selectedPotionUid={selectedPotionUid}
                  onCardClick={handleCardClick}
                  onPotionClick={handlePotionClick}
                  onEnemyClick={handleEnemyClick}
                  onUseSelectedPotion={handleUseSelectedPotion}
                  onClearSelection={handleClearSelection}
                  onEndTurn={() => setRun((current) => endTurn(current))}
                />
              )}
              {run.phase === "reward" && (
                <RewardScreen
                  run={run}
                  onPick={(index) => setRun((current) => claimRewardCard(current, index))}
                  onPickPotion={() => setRun((current) => claimRewardPotion(current))}
                  onPickBoon={(index) => setRun((current) => claimRewardBoon(current, index))}
                  onRerollCards={() => setRun((current) => rerollRewardCards(current))}
                  onSkip={() => setRun((current) => claimRewardCard(current))}
                />
              )}
              {run.phase === "rest" && (
                <RestScreen
                  run={run}
                  onBrew={() => setRun((current) => restBrewPotion(current))}
                  onCleanseStatus={() => setRun((current) => restCleanseStatus(current))}
                  onHeal={() => setRun((current) => restHeal(current))}
                  onUpgrade={(uid) => setRun((current) => restUpgrade(current, uid))}
                />
              )}
              {run.phase === "shop" && (
                <ShopScreen
                  run={run}
                  onBuyCard={(index) => setRun((current) => buyShopCard(current, index))}
                  onBuyRelic={(index) => setRun((current) => buyShopRelic(current, index))}
                  onBuyPotion={(index) => setRun((current) => buyShopPotion(current, index))}
                  onBuyBoon={(index) => setRun((current) => buyShopBoon(current, index))}
                  onRemoveCard={(uid) => setRun((current) => buyShopRemove(current, uid))}
                  onBuyHeal={() => setRun((current) => buyShopHeal(current))}
                  onRestock={() => setRun((current) => restockShop(current))}
                  onLeave={() => setRun((current) => leaveShop(current))}
                />
              )}
              {run.phase === "event" && (
                <EventScreen run={run} onChoose={(optionId) => setRun((current) => chooseEventOption(current, optionId))} />
              )}
              {run.phase === "victory" && <EndScreen run={run} result="victory" onStart={startNewRun} />}
              {run.phase === "defeat" && <EndScreen run={run} result="defeat" onStart={startNewRun} />}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

function RunSidebar({
  run,
  onDiscardPotion,
}: {
  run: RunState;
  onDiscardPotion: (potionUid: string) => void;
}) {
  const flowItems = [
    { key: "map", label: "路线", detail: `第 ${run.act ?? 1} 幕 · 层 ${Math.max(1, run.floor + 1)}` },
    { key: "combat", label: "战斗", detail: run.combat?.encounterName ?? "下一场遭遇" },
    { key: "reward", label: "战利品", detail: run.reward?.title ?? "战斗后结算" },
    { key: "rest", label: "营火", detail: "休息 / 升级 / 调配" },
    { key: "shop", label: "商店", detail: `${run.player.gold} 金币` },
    { key: "event", label: "事件", detail: run.event?.title ?? "特殊交换" },
  ] as const;
  const activePhase = run.phase === "victory" || run.phase === "defeat" ? "map" : run.phase;
  const inventoryMeta = `${run.player.relics.length} 遗物 · ${run.player.boons.length} 常驻`;

  return (
    <aside className="game-sidebar">
      <FoldSection
        title="流程"
        icon={<MapIcon size={16} />}
        meta={`第 ${run.act ?? 1} 幕 · ${Math.max(1, run.floor + 1)} 层`}
        defaultOpen
        className="fold-section--route"
      >
        <div className="route-flow">
          <div className="route-flow__list">
            {flowItems.map((item) => (
              <div
                key={item.key}
                className={`route-flow__item ${activePhase === item.key ? "is-active" : ""} ${
                  run.phase === item.key ? "is-current" : ""
                }`}
              >
                <strong>{item.label}</strong>
                <span>{item.detail}</span>
              </div>
            ))}
          </div>
        </div>
      </FoldSection>
      <RunPhaseStatus run={run} />
      <FoldSection
        title="卡牌 / 药水 / 倾向"
        icon={<Layers size={16} />}
        meta={`${run.player.deck.length} 牌 · ${run.player.potions.length}/${run.player.potionSlots} 瓶`}
        defaultOpen={run.phase !== "combat"}
        className="fold-section--resources"
      >
        <RunResourceDock run={run} onDiscardPotion={onDiscardPotion} />
      </FoldSection>
      <FoldSection
        title="遗物 / 常驻"
        icon={<Award size={16} />}
        meta={inventoryMeta}
        defaultOpen={run.player.relics.length + run.player.boons.length <= 4}
        className="fold-section--inventory"
      >
        <RunInventoryTray run={run} />
      </FoldSection>
    </aside>
  );
}

function FoldSection({
  title,
  icon,
  meta,
  defaultOpen = true,
  className = "",
  children,
}: {
  title: string;
  icon: React.ReactNode;
  meta?: string;
  defaultOpen?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section className={`fold-section ${open ? "is-open" : ""} ${className}`}>
      <button className="fold-section__toggle" type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <span className="fold-section__icon">{icon}</span>
        <strong>{title}</strong>
        {meta && <small>{meta}</small>}
        <ChevronRight className="fold-section__chevron" size={15} />
      </button>
      {open && <div className="fold-section__body">{children}</div>}
    </section>
  );
}

function RunPhaseStatus({ run }: { run: RunState }) {
  const phaseCopy = {
    map: {
      title: "选择路线",
      detail: `可前往 ${getAvailableNodeIds(run).length} 个节点`,
      icon: <MapIcon size={16} />,
    },
    combat: {
      title: "处理回合",
      detail: run.combat ? `${run.combat.encounterName} · 第 ${run.combat.turn} 回合` : "遭遇准备中",
      icon: <Sword size={16} />,
    },
    reward: {
      title: "领取战利品",
      detail: run.reward?.title ?? "战斗奖励",
      icon: <Award size={16} />,
    },
    rest: {
      title: "营火整备",
      detail: "休息 / 升级 / 调配",
      icon: <HeartPulse size={16} />,
    },
    shop: {
      title: "商店采购",
      detail: `${run.player.gold} 金币可用`,
      icon: <ShoppingBag size={16} />,
    },
    event: {
      title: "事件抉择",
      detail: run.event?.title ?? "特殊交换",
      icon: <Sparkles size={16} />,
    },
    victory: {
      title: "胜利结算",
      detail: "本局完成",
      icon: <Award size={16} />,
    },
    defeat: {
      title: "失败结算",
      detail: "复盘构筑",
      icon: <Skull size={16} />,
    },
    title: {
      title: "标题",
      detail: "选择难度",
      icon: <Flame size={16} />,
    },
  }[run.phase];

  return (
    <div className="phase-status">
      <span>{phaseCopy.icon}</span>
      <div>
        <strong>{phaseCopy.title}</strong>
        <small>{phaseCopy.detail}</small>
      </div>
    </div>
  );
}

function RunResourceDock({
  run,
  onDiscardPotion,
}: {
  run: RunState;
  onDiscardPotion: (potionUid: string) => void;
}) {
  const summary = useMemo(() => summarizeDeck(run.player.deck), [run.player.deck]);
  const archetypes = useMemo(() => summarizeRunArchetypes(run, summary), [run, summary]);
  const topArchetype = archetypes[0];
  const potionSlots = Array.from({ length: run.player.potionSlots }, (_, index) => run.player.potions[index]);

  return (
    <div className="resource-dock">
      <section className="resource-dock__panel">
        <div className="resource-dock__head">
          <span>
            <BookOpen size={15} /> 卡牌
          </span>
          <strong>{summary.total}</strong>
        </div>
        <div className="resource-dock__metrics">
          <span>均费 {summary.avgCost}</span>
          <span>升级 {summary.upgraded}</span>
          <span className={summary.typeCounts.Status > 0 ? "is-warning" : ""}>状态 {summary.typeCounts.Status}</span>
        </div>
        <div className="resource-dock__tags">
          {summary.topTags.slice(0, 4).map(({ tag, count }) => (
            <span key={tag}>
              {tag} <b>{count}</b>
            </span>
          ))}
          {summary.topTags.length === 0 && <span>基础牌组</span>}
        </div>
      </section>

      <section className="resource-dock__panel">
        <div className="resource-dock__head">
          <span>
            <FlaskConical size={15} /> 药水
          </span>
          <strong>
            {run.player.potions.length}/{run.player.potionSlots}
          </strong>
        </div>
        <div className="resource-slot-list resource-slot-list--compact">
          {potionSlots.map((potion, index) => (
            <ResourcePotionSlot key={potion?.uid ?? `empty-${index}`} potion={potion} onDiscardPotion={onDiscardPotion} />
          ))}
        </div>
      </section>

      <section className="resource-dock__panel resource-dock__panel--signal">
        <div className="resource-dock__head">
          <span>
            <Target size={15} /> 倾向
          </span>
          <strong>{topArchetype?.score ?? 0}</strong>
        </div>
        <div className="resource-dock__signal">
          <strong>{topArchetype?.label ?? "基础构筑"}</strong>
          <span>{topArchetype?.detail ?? "等待核心组件"}</span>
        </div>
      </section>
    </div>
  );
}

function RunInventoryTray({ run }: { run: RunState }) {
  const relics = run.player.relics.slice(0, 5);
  const boons = run.player.boons.slice(0, 5);
  const hiddenRelics = Math.max(0, run.player.relics.length - relics.length);
  const hiddenBoons = Math.max(0, run.player.boons.length - boons.length);

  return (
    <div className="inventory-tray">
      <div>
        <PanelTitle icon={<Award size={17} />} title="遗物" />
        <div className="inventory-chip-list">
          {relics.map((relicId) => {
            const relic = RELICS[relicId];
            return (
              <span className="inventory-chip" key={relicId} title={relic?.text ?? "这个遗物来自旧数据。"}>
                <Award size={13} />
                {relic?.name ?? "失效遗物"}
              </span>
            );
          })}
          {hiddenRelics > 0 && <span className="inventory-chip inventory-chip--more">+{hiddenRelics}</span>}
          {relics.length === 0 && <span className="inventory-chip inventory-chip--empty">暂无遗物</span>}
        </div>
      </div>
      <div>
        <PanelTitle icon={<Sparkles size={17} />} title="常驻" />
        <div className="inventory-chip-list">
          {boons.map((boonId) => {
            const boon = BOONS[boonId];
            return (
              <span className="inventory-chip" key={boonId} title={boon?.text ?? "这项常驻提升来自旧数据。"}>
                <Sparkles size={13} />
                {boon?.name ?? "失效常驻"}
              </span>
            );
          })}
          {hiddenBoons > 0 && <span className="inventory-chip inventory-chip--more">+{hiddenBoons}</span>}
          {boons.length === 0 && <span className="inventory-chip inventory-chip--empty">暂无常驻</span>}
        </div>
      </div>
    </div>
  );
}

function TitleScreen({
  difficulty,
  savedRun,
  onDifficultyChange,
  onStart,
  onContinue,
}: {
  difficulty: DifficultyKey;
  savedRun?: RunState;
  onDifficultyChange: (difficulty: DifficultyKey) => void;
  onStart: () => void;
  onContinue: () => void;
}) {
  const savedRunLabel = savedRun
    ? `${DIFFICULTIES[savedRun.difficulty].name} · 第 ${savedRun.act ?? 1} 幕 · 层 ${Math.max(1, savedRun.floor + 1)} · ${savedRun.player.hp}/${savedRun.player.maxHp} 生命 · ${savedRun.player.deck.length} 张牌`
    : "";

  return (
    <section className="title-layout">
      <div className="title-copy">
        <div className="kicker">Deckbuilding Roguelike Prototype</div>
        <h2>从第一张打击开始，爬完一座可变尖塔。</h2>
        <p>
          这一版先把程序层跑通：路线选择、遭遇战、抽弃牌、状态、敌人意图、奖励、商店、事件、休息、遗物、多幕推进和 Boss 都已经接入。
        </p>
        <div className="title-actions">
          {savedRun && (
            <div className="saved-run">
              <button className="secondary-button" type="button" onClick={onContinue}>
                <RotateCcw size={18} />
                <span>继续存档</span>
              </button>
              <small>{savedRunLabel}</small>
            </div>
          )}
          <button className="primary-button" type="button" onClick={onStart}>
            <ChevronRight size={18} />
            <span>开始{DIFFICULTIES[difficulty].name}难度</span>
          </button>
        </div>
        <div className="difficulty-picker" aria-label="难度选择">
          {(Object.keys(DIFFICULTIES) as DifficultyKey[]).map((key) => {
            const option = DIFFICULTIES[key];
            return (
              <button
                key={option.id}
                className={`difficulty-option ${difficulty === option.id ? "is-selected" : ""}`}
                type="button"
                onClick={() => onDifficultyChange(option.id)}
              >
                <strong>{option.name}</strong>
                <small>{option.tagline}</small>
                <span>{option.text}</span>
              </button>
            );
          })}
        </div>
      </div>
      <div className="title-board" aria-hidden="true">
        <div className="title-card title-card--attack">
          <span>打击</span>
          <strong>6</strong>
        </div>
        <div className="title-card title-card--skill">
          <span>防御</span>
          <strong>5</strong>
        </div>
        <div className="title-card title-card--power">
          <span>燃起</span>
          <strong>力</strong>
        </div>
        <div className="title-enemy">
          <Skull size={54} />
          <span>裂隙心核</span>
        </div>
      </div>
    </section>
  );
}

function MapScreen({ run, onEnter }: { run: RunState; onEnter: (nodeId: string) => void }) {
  const availableIds = useMemo(() => getAvailableNodeIds(run), [run]);
  const available = useMemo(() => new Set(availableIds), [availableIds]);
  const nodeById = useMemo(() => new Map(run.map.map((node) => [node.id, node])), [run.map]);
  const availableNodes = useMemo(
    () => availableIds.map((nodeId) => nodeById.get(nodeId)).filter((node): node is MapNode => Boolean(node)),
    [availableIds, nodeById],
  );
  const mapIntel = useMemo(() => summarizeMapIntel(run.map), [run.map]);
  const currentNode = run.currentNodeId ? nodeById.get(run.currentNodeId) : undefined;
  const bossAvailable = availableNodes.some((node) => node.type === "boss");

  return (
    <section className="map-layout">
      <div className="map-panel">
        <div className="section-heading">
          <div>
            <p>路线</p>
            <h2>第 {run.act ?? 1} 幕 · 选择下一处节点</h2>
            <span className="act-pressure">{actPressureText(run)}</span>
          </div>
          <div className="legend">
            {(["fight", "elite", "rest", "shop", "event", "boss"] as NodeType[]).map((type) => (
              <span key={type} className={`legend__item node-tone--${type}`}>
                <NodeIcon type={type} size={14} />
                {NODE_LABELS[type]}
              </span>
            ))}
          </div>
        </div>

        <div className="map-intel" aria-label="地图情报">
          <span>
            <MapIcon size={14} /> 节点 <b>{mapIntel.nodeCount}</b>
          </span>
          <span>
            <Skull size={14} /> 精英 <b>{mapIntel.counts.elite}</b>
          </span>
          <span>
            <Sparkles size={14} /> 事件 <b>{mapIntel.counts.event}</b>
          </span>
          <span>
            <HeartPulse size={14} /> 补给 <b>{mapIntel.counts.rest + mapIntel.counts.shop}</b>
          </span>
          <span>
            <Layers size={14} /> 分叉 <b>{mapIntel.branchCount}</b>
          </span>
        </div>

        <FoldSection
          title="可前往路线"
          icon={<MapIcon size={16} />}
          meta={`${availableNodes.length} 条 · ${currentNode ? `${NODE_LABELS[currentNode.type]}后续` : "入口"}`}
          defaultOpen
          className="route-command"
        >
          <div className="route-options__grid">
            {availableNodes.map((node) => (
              <button
                key={node.id}
                className={`route-option node-tone--${node.type}`}
                type="button"
                onClick={() => onEnter(node.id)}
              >
                <NodeIcon type={node.type} size={17} />
                <strong>{NODE_LABELS[node.type]}</strong>
                <span>{node.id === "boss" ? `第 ${run.act ?? 1} 幕顶层` : `第 ${node.floor + 1} 层 · ${node.lane + 1} 道`}</span>
                <em>{NODE_HINTS[node.type]}</em>
                <small>{routePreviewLabel(node, nodeById)}</small>
                <small className="route-option__signal">{routeSignalLabel(node, run)}</small>
              </button>
            ))}
          </div>
        </FoldSection>

        {bossAvailable && (
          <div className="boss-warning">
            <Skull size={19} />
            <div>
              <strong>第 {run.act ?? 1} 幕最终战已开启</strong>
              <span>
                生命 {run.player.hp}/{run.player.maxHp} · 药水 {run.player.potions.length}/{run.player.potionSlots} ·
                牌组 {run.player.deck.length} 张
              </span>
            </div>
          </div>
        )}

        <div className="map-scroll">
          <div className="map-canvas">
            <div className="map-ruler" aria-hidden="true">
              {mapIntel.floorMarks.map((mark) => (
                <span key={mark.floor} style={{ top: `${mark.y}%` }}>
                  {mark.floor + 1}
                </span>
              ))}
            </div>
            <svg className="map-lines" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
              {run.map.flatMap((node) =>
                node.children.map((childId) => {
                  const child = nodeById.get(childId);
                  if (!child) {
                    return null;
                  }
                  const isCompletedEdge = Boolean(node.completed && child.completed);
                  const isAvailableEdge = Boolean(node.completed && available.has(child.id));
                  return (
                    <line
                      key={`${node.id}-${child.id}`}
                      x1={node.x}
                      y1={node.y}
                      x2={child.x}
                      y2={child.y}
                      className={`map-line ${node.completed ? "map-line--active" : ""} ${
                        isAvailableEdge ? "map-line--available" : ""
                      } ${isCompletedEdge ? "map-line--completed" : ""}`}
                    />
                  );
                }),
              )}
            </svg>
            {run.map.map((node) => (
              <MapNodeButton
                key={node.id}
                node={node}
                available={available.has(node.id)}
                onEnter={() => onEnter(node.id)}
              />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function summarizeMapIntel(map: MapNode[]) {
  const counts = map.reduce<Record<NodeType, number>>(
    (acc, node) => {
      acc[node.type] += 1;
      return acc;
    },
    { fight: 0, elite: 0, rest: 0, shop: 0, event: 0, boss: 0 },
  );
  const floorBuckets = new Map<number, { count: number; totalY: number }>();
  for (const node of map) {
    const bucket = floorBuckets.get(node.floor) ?? { count: 0, totalY: 0 };
    bucket.count += 1;
    bucket.totalY += node.y;
    floorBuckets.set(node.floor, bucket);
  }
  const floorMarks = Array.from(floorBuckets.entries())
    .sort(([left], [right]) => left - right)
    .filter(([floor], index, floors) => floor === 0 || index === floors.length - 1 || floor % 2 === 0)
    .map(([floor, bucket]) => ({ floor, y: bucket.totalY / bucket.count }));

  return {
    counts,
    floorMarks,
    nodeCount: map.length,
    branchCount: map.filter((node) => node.children.length > 1).length,
  };
}

function RunStatsPanel({ run }: { run: RunState }) {
  return (
    <div className="run-stats-panel">
      <PanelTitle icon={<MapIcon size={17} />} title="本局记录" />
      <div>
        <span>节点 <b>{run.stats.nodesCleared}</b></span>
        <span>战斗 <b>{run.stats.fights}</b></span>
        <span>精英 <b>{run.stats.elites}</b></span>
        <span>Boss <b>{run.stats.bosses}</b></span>
        <span>伤害 <b>{run.stats.damageDealt}</b></span>
        <span>金币 <b>{run.stats.goldEarned}</b></span>
      </div>
    </div>
  );
}

function routePreviewLabel(node: MapNode, nodeById: Map<string, MapNode>): string {
  if (node.type === "boss") {
    return "终点";
  }
  const nextTypes = node.children
    .map((childId) => nodeById.get(childId)?.type)
    .filter((type): type is NodeType => Boolean(type));
  if (nextTypes.length === 0) {
    return "后续路线待定";
  }
  const counts = nextTypes.reduce<Record<NodeType, number>>(
    (acc, type) => {
      acc[type] += 1;
      return acc;
    },
    { fight: 0, elite: 0, rest: 0, shop: 0, event: 0, boss: 0 },
  );
  return `后续：${(Object.keys(counts) as NodeType[])
    .filter((type) => counts[type] > 0)
    .map((type) => `${NODE_LABELS[type]}${counts[type] > 1 ? `x${counts[type]}` : ""}`)
    .join(" / ")}`;
}

function routeSignalLabel(node: MapNode, run: RunState): string {
  const hpRatio = run.player.hp / run.player.maxHp;
  const act = run.act ?? 1;
  if (node.type === "boss") {
    return hpRatio < 0.55 ? "警告：生命偏低" : "终局：检查药水与爆发";
  }
  if (node.type === "elite") {
    return hpRatio > 0.7 ? "收益：遗物与高额奖励" : "高危：建议先补给";
  }
  if (node.type === "fight") {
    return act >= 2 && node.floor >= 5 ? "压力：二幕后段组合敌" : "稳定：积累奖励";
  }
  if (node.type === "rest") {
    return hpRatio < 0.65 ? "修整：优先回血" : "修整：适合升级/调配";
  }
  if (node.type === "shop") {
    return run.player.gold >= 90 ? "采购：可买核心组件" : "采购：偏向移除/治疗";
  }
  return run.player.deck.length >= 16 ? "事件：可寻找压缩" : "事件：资源交换";
}

function MapNodeButton({
  node,
  available,
  onEnter,
}: {
  node: MapNode;
  available: boolean;
  onEnter: () => void;
}) {
  return (
    <button
      className={`map-node node-tone--${node.type} ${available ? "is-available" : ""} ${
        node.completed ? "is-completed" : ""
      }`}
      style={{ left: `${node.x}%`, top: `${node.y}%` }}
      type="button"
      disabled={!available}
      onClick={onEnter}
      title={NODE_LABELS[node.type]}
    >
      <NodeIcon type={node.type} size={20} />
      <span>{NODE_LABELS[node.type]}</span>
    </button>
  );
}

function CombatScreen({
  run,
  selectedCard,
  selectedCardUid,
  selectedPotion,
  selectedPotionUid,
  onCardClick,
  onPotionClick,
  onEnemyClick,
  onUseSelectedPotion,
  onClearSelection,
  onEndTurn,
}: {
  run: RunState;
  selectedCard?: CardInstance;
  selectedCardUid?: string;
  selectedPotion?: PotionInstance;
  selectedPotionUid?: string;
  onCardClick: (card: CardInstance) => void;
  onPotionClick: (potion: PotionInstance) => void;
  onEnemyClick: (enemy: EnemyState) => void;
  onUseSelectedPotion: () => void;
  onClearSelection: () => void;
  onEndTurn: () => void;
}) {
  const combat = run.combat!;
  const selectedCardDef = selectedCard ? CARDS[selectedCard.cardId] : undefined;
  const selectedNeedsTarget = Boolean(selectedCard && selectedCardDef && cardNeedsTarget(selectedCard));
  const selectedPotionDef = selectedPotion ? POTIONS[selectedPotion.potionId] : undefined;
  const selectedPotionNeedsTarget = Boolean(selectedPotion && selectedPotionDef && potionNeedsTarget(selectedPotion));
  const targetingName = selectedCard
    ? `${selectedCardDef?.name ?? "失效卡牌"}${selectedCard.upgraded && selectedCardDef ? "+" : ""}`
    : selectedPotion
      ? selectedPotionDef?.name ?? "失效药水"
      : undefined;
  const targetPreviews = useMemo(() => {
    return new Map(
      combat.enemies.map((enemy) => [
        enemy.uid,
        selectedCard && selectedCardDef
          ? previewCardOnEnemy(run, selectedCard, enemy)
          : selectedPotion && selectedPotionDef
            ? previewPotionOnEnemy(run, selectedPotion, enemy)
            : undefined,
      ]),
    );
  }, [combat.enemies, run, selectedCard, selectedCardDef, selectedPotion, selectedPotionDef]);

  return (
    <section className="combat-layout">
      <div className="combat-main">
        <div className="combat-heading">
          <div>
            <p>遭遇</p>
            <h2>{combat.encounterName}</h2>
          </div>
          <div className="heading-chips">
            <div className="turn-chip">
              <Zap size={16} />
              <span>
                {combat.energy}/{combat.maxEnergy}
              </span>
            </div>
            <div className="turn-chip turn-chip--pressure">
              <Skull size={16} />
              <span>{actPressureText(run)}</span>
            </div>
          </div>
        </div>

        <div className="enemy-row">
          {combat.enemies.map((enemy) => (
            <EnemyCard
              key={enemy.uid}
              enemy={enemy}
              targetable={(selectedNeedsTarget || selectedPotionNeedsTarget) && enemy.hp > 0}
              preview={targetPreviews.get(enemy.uid)}
              onClick={() => onEnemyClick(enemy)}
            />
          ))}
        </div>

        {(selectedNeedsTarget || selectedPotionNeedsTarget) && targetingName && (
          <div className="targeting-prompt">
            <Target size={15} />
            <span>选择目标：{targetingName}</span>
            <button type="button" onClick={onClearSelection}>
              <RotateCcw size={14} />
              <span>取消</span>
            </button>
          </div>
        )}

        {selectedPotion && !selectedPotionNeedsTarget && (
          <div className="targeting-prompt targeting-prompt--confirm">
            <FlaskConical size={15} />
            <span>{selectedPotionDef?.name ?? "失效药水"}</span>
            <button type="button" onClick={onUseSelectedPotion}>
              <ChevronRight size={14} />
              <span>使用药水</span>
            </button>
            <button type="button" onClick={onClearSelection}>
              <RotateCcw size={14} />
              <span>取消</span>
            </button>
          </div>
        )}

        <div className="player-board">
          <div className="player-core">
            <div className="player-core__identity">
              <PixelSprite
                kind="player"
                variant="wanderer"
                active={combat.energy > 0}
                guarded={combat.playerBlock > 0}
                powers={combat.playerPowers}
                pulseKey={`${run.player.hp}-${combat.playerBlock}-${combat.energy}-${combat.turn}`}
              />
              <div>
                <span className="mini-label">角色</span>
                <h3>流亡者</h3>
              </div>
            </div>
            <HealthBar current={run.player.hp} max={run.player.maxHp} />
            <div className="combat-meters">
              <span>
                <Shield size={15} /> {combat.playerBlock}
              </span>
              <span>
                <Zap size={15} /> {combat.energy}
              </span>
              <span>
                <BookOpen size={15} /> {combat.drawPile.length}
              </span>
            </div>
            <PowerBadges powers={combat.playerPowers} />
          </div>

          <div className="pile-strip">
            <PileCount label="抽牌" value={combat.drawPile.length} />
            <PileCount label="弃牌" value={combat.discardPile.length} />
            <PileCount label="消耗" value={combat.exhaustPile.length} />
            <PotionBelt
              potions={run.player.potions}
              slots={run.player.potionSlots}
              selectedPotionUid={selectedPotionUid}
              onPotionClick={onPotionClick}
            />
            <button className="end-turn-button" type="button" onClick={onEndTurn}>
              <ChevronRight size={17} />
              <span>结束回合</span>
            </button>
          </div>
        </div>

        <div className="hand-row">
          {combat.hand.map((card) => (
            <CardView
              key={card.uid}
              card={card}
              disabled={!canPlayCard(run, card)}
              selected={selectedCardUid === card.uid}
              onClick={() => onCardClick(card)}
            />
          ))}
        </div>
      </div>

      <aside className="combat-log">
        <MechanicPanel run={run} selectedCard={selectedCard} selectedPotion={selectedPotion} />
        <PanelTitle icon={<Sparkles size={17} />} title="战斗记录" />
        <ol>
          {combat.log.map((line, index) => (
            <li key={`${line}-${index}`}>{line}</li>
          ))}
        </ol>
      </aside>
    </section>
  );
}

function EnemyCard({
  enemy,
  targetable,
  preview,
  onClick,
}: {
  enemy: EnemyState;
  targetable: boolean;
  preview?: TargetPreview;
  onClick: () => void;
}) {
  const dead = enemy.hp <= 0;
  const intentText = intentSummary(enemy.intent);
  const hasVisiblePreview = Boolean(preview && (targetable || preview.damage > 0 || Object.keys(preview.powerAdds).length > 0));
  return (
    <button
      className={`enemy-card ${targetable ? "is-targetable" : ""} ${hasVisiblePreview ? "has-preview" : ""} ${
        dead ? "is-dead" : ""
      }`}
      type="button"
      disabled={dead || !targetable}
      onClick={onClick}
    >
      <PixelSprite
        kind="enemy"
        variant={enemy.defId}
        intent={enemy.intent.intent}
        active={targetable}
        dead={dead}
        powers={enemy.powers}
        pulseKey={`${enemy.hp}-${enemy.block}-${enemy.intent.id}`}
      />
      <div className="enemy-card__top">
        <div>
          <span className="mini-label">{dead ? "击破" : "敌人"}</span>
          <h3>{enemy.name}</h3>
        </div>
        <IntentBadge move={enemy.intent} />
      </div>
      <HealthBar current={enemy.hp} max={enemy.maxHp} />
      {intentText && <div className="intent-summary">{intentText}</div>}
      <div className="enemy-card__meters">
        <span>
          <Shield size={15} /> {enemy.block}
        </span>
        <span>
          <Target size={15} /> {Math.max(0, enemy.hp)}
        </span>
      </div>
      {hasVisiblePreview && preview && <TargetPreview preview={preview} />}
      <PowerBadges powers={enemy.powers} />
    </button>
  );
}

function PixelSprite({
  kind,
  variant,
  active,
  guarded,
  intent,
  dead,
  powers,
  pulseKey,
}: {
  kind: "player" | "enemy";
  variant: string;
  active?: boolean;
  guarded?: boolean;
  intent?: EnemyMove["intent"];
  dead?: boolean;
  powers?: PowerMap;
  pulseKey: string;
}) {
  const intentClass = intent ? `pixel-sprite--intent-${intent}` : "";
  const powerClass = spritePowerClasses(powers);
  return (
    <div
      key={pulseKey}
      className={`pixel-sprite pixel-sprite--${kind} pixel-sprite--${spriteTone(variant)} ${intentClass} ${powerClass} ${
        active ? "is-active" : ""
      } ${guarded ? "is-guarded" : ""} ${dead ? "is-dead" : ""}`}
      aria-hidden="true"
    >
      <span className="pixel-sprite__aura" />
      <span className="pixel-sprite__guard" />
      <span className="pixel-sprite__slash" />
      <span className="pixel-sprite__head" />
      <span className="pixel-sprite__body" />
      <span className="pixel-sprite__arm pixel-sprite__arm--left" />
      <span className="pixel-sprite__arm pixel-sprite__arm--right" />
      <span className="pixel-sprite__leg pixel-sprite__leg--left" />
      <span className="pixel-sprite__leg pixel-sprite__leg--right" />
      <span className="pixel-sprite__spark pixel-sprite__spark--one" />
      <span className="pixel-sprite__spark pixel-sprite__spark--two" />
      <span className="pixel-sprite__status pixel-sprite__status--one" />
      <span className="pixel-sprite__status pixel-sprite__status--two" />
    </div>
  );
}

function spritePowerClasses(powers?: PowerMap): string {
  if (!powers) {
    return "";
  }

  const classes: string[] = [];
  if ((powers.poison ?? 0) >= 3) classes.push("pixel-sprite--power-poison");
  if ((powers.bleed ?? 0) >= 2) classes.push("pixel-sprite--power-bleed");
  if ((powers.mark ?? 0) >= 2) classes.push("pixel-sprite--power-mark");
  if ((powers.spark ?? 0) >= 2 || (powers.charge ?? 0) >= 2) classes.push("pixel-sprite--power-spark");
  if ((powers.platedArmor ?? 0) >= 2 || (powers.regen ?? 0) >= 2) classes.push("pixel-sprite--power-guard");
  if ((powers.thorns ?? 0) >= 2) classes.push("pixel-sprite--power-thorns");
  if ((powers.combo ?? 0) + (powers.charge ?? 0) >= 4) classes.push("pixel-sprite--power-rhythm");

  const layeredStacks =
    (powers.combo ?? 0) +
    (powers.poison ?? 0) +
    (powers.bleed ?? 0) +
    (powers.mark ?? 0) +
    (powers.spark ?? 0) +
    (powers.charge ?? 0) +
    (powers.platedArmor ?? 0) +
    (powers.regen ?? 0) +
    (powers.thorns ?? 0);
  if (layeredStacks >= 8) classes.push("pixel-sprite--power-stacked");

  return classes.join(" ");
}

function spriteTone(variant: string): string {
  if (variant.includes("slime") || variant.includes("spore") || variant.includes("plague")) return "ooze";
  if (
    variant.includes("sentry") ||
    variant.includes("heart") ||
    variant.includes("spark") ||
    variant.includes("clockwork") ||
    variant.includes("rune") ||
    variant.includes("coil") ||
    variant.includes("scrapper") ||
    variant.includes("supply") ||
    variant.includes("mimic")
  ) {
    return "metal";
  }
  if (
    variant.includes("mage") ||
    variant.includes("wisp") ||
    variant.includes("mirror") ||
    variant.includes("ash") ||
    variant.includes("catalyst") ||
    variant.includes("rift")
  ) {
    return "arcane";
  }
  if (variant.includes("jaw") || variant.includes("nob") || variant.includes("blood") || variant.includes("scar")) return "beast";
  return "hero";
}

function MechanicPanel({
  run,
  selectedCard,
  selectedPotion,
}: {
  run: RunState;
  selectedCard?: CardInstance;
  selectedPotion?: PotionInstance;
}) {
  const combat = run.combat!;
  const incoming = estimateIncomingDamage(run);
  const ongoingDamage = estimateOngoingSelfDamage(run);
  const enemyOngoingDamage = estimateOngoingEnemyDamage(combat);
  const blockGap = Math.max(0, incoming - combat.playerBlock);
  const enemyTotals = aggregateEnemyPowers(combat.enemies);
  const catalystInsight = bestCatalystInsight(combat.enemies);
  const hintPowers = combatHintPowers(combat);
  const hasPocketWatch = run.player.relics.includes("pocket_watch");
  const selectedCardDef = selectedCard ? CARDS[selectedCard.cardId] : undefined;
  const selectedPotionDef = selectedPotion ? POTIONS[selectedPotion.potionId] : undefined;
  const selectedName = selectedCard
    ? `${selectedCardDef?.name ?? "失效卡牌"}${selectedCard.upgraded && selectedCardDef ? "+" : ""}`
    : selectedPotion
      ? selectedPotionDef?.name ?? "失效药水"
      : undefined;
  const selectedTags = selectedCard && selectedCardDef
    ? cardMechanicTags(selectedCard)
    : selectedPotion
      ? potionMechanicTags(selectedPotion)
      : [];
  const actionSummary = selectedCard && selectedCardDef
    ? summarizeCardAction(run, selectedCard)
    : selectedPotion
      ? summarizePotionAction(run, selectedPotion)
      : undefined;

  return (
    <div className="mechanic-panel">
      <PanelTitle icon={<Layers size={17} />} title="机制" />
      <div className="mechanic-forecast">
        <span className={incoming > 0 ? "is-danger" : ""}>
          <Sword size={14} /> 入伤 {incoming}
        </span>
        <span className={blockGap > 0 ? "is-warning" : ""}>
          <Shield size={14} /> 缺口 {blockGap}
        </span>
        <span className={ongoingDamage > 0 ? "is-danger" : ""}>
          <Flame size={14} /> 持续 {ongoingDamage}
        </span>
        <span className={enemyOngoingDamage > 0 ? "is-good" : ""}>
          <Target size={14} /> 敌蚀 {enemyOngoingDamage}
        </span>
      </div>
      <TempoPanel combat={combat} hasPocketWatch={hasPocketWatch} />
      <PileInsight combat={combat} />
      <div className="mechanic-grid">
        <MechanicMeter label="连击" value={combat.playerPowers.combo ?? 0} text="攻击牌" />
        <MechanicMeter label="蓄能" value={combat.playerPowers.charge ?? 0} text="技能牌" />
        <MechanicMeter label="电弧" value={enemyTotals.spark ?? 0} text="弹射" />
        <MechanicMeter label="流血" value={enemyTotals.bleed ?? 0} text="追伤" />
        <MechanicMeter label="破绽" value={enemyTotals.mark ?? 0} text="增伤" />
        <MechanicMeter label="金属化" value={combat.playerPowers.platedArmor ?? 0} text="回合初" />
      </div>
      <MechanicChainPanel playerPowers={combat.playerPowers} enemyTotals={enemyTotals} cardsPlayed={combat.cardsPlayedThisTurn} />
      <CatalystInsightPanel insight={catalystInsight} />
      {hintPowers.length > 0 && (
        <div className="mechanic-hints">
          <strong>当前机制</strong>
          {hintPowers.map((power) => (
            <span key={power}>
              <b>{POWER_LABELS[power]}</b>
              {POWER_HINTS[power]}
            </span>
          ))}
        </div>
      )}
      {selectedName && (
        <div className="mechanic-selected">
          <strong>{selectedName}</strong>
          <div>
            {selectedTags.map((tag) => (
              <span key={tag}>{tag}</span>
            ))}
          </div>
          {actionSummary && <ActionSummaryView summary={actionSummary} />}
        </div>
      )}
    </div>
  );
}

function CatalystInsightPanel({ insight }: { insight?: CatalystInsight }) {
  if (!insight || insight.total <= 0) {
    return null;
  }

  return (
    <div className="catalyst-insight">
      <strong>催化候选</strong>
      <span>{insight.enemyName}</span>
      <div>
        {insight.entries.map(([power, value]) => (
          <em key={power}>
            {POWER_LABELS[power]} +{value}
          </em>
        ))}
      </div>
    </div>
  );
}

function PileInsight({ combat }: { combat: NonNullable<RunState["combat"]> }) {
  const nextDraws = combat.drawPile.slice(0, 3);
  const recentDiscard = combat.discardPile.slice(-3).reverse();
  const recoverable = combat.discardPile.filter((card) => CARDS[card.cardId] && CARDS[card.cardId].type !== "Status").length;
  const statusFuel = [...combat.hand, ...combat.discardPile].filter((card) => CARDS[card.cardId]?.type === "Status").length;

  return (
    <div className="pile-insight">
      <div className="pile-insight__counts">
        <span>抽 {combat.drawPile.length}</span>
        <span>弃 {combat.discardPile.length}</span>
        <span>消 {combat.exhaustPile.length}</span>
        <span className={recoverable > 0 ? "is-ready" : ""}>可回收 {recoverable}</span>
        <span className={statusFuel > 0 ? "is-ready" : ""}>清创 {statusFuel}</span>
      </div>
      <div className="pile-insight__recent">
        <strong>即将抽牌</strong>
        {nextDraws.length > 0 ? (
          nextDraws.map((card) => (
            <span key={card.uid}>
              {cardDisplayName(card)}
            </span>
          ))
        ) : (
          <span>空</span>
        )}
      </div>
      <div className="pile-insight__recent">
        <strong>最近弃牌</strong>
        {recentDiscard.length > 0 ? (
          recentDiscard.map((card) => (
            <span key={card.uid}>
              {cardDisplayName(card)}
            </span>
          ))
        ) : (
          <span>空</span>
        )}
      </div>
    </div>
  );
}

function cardDisplayName(card: CardInstance): string {
  const def = CARDS[card.cardId];
  return `${def?.name ?? "失效卡牌"}${card.upgraded && def ? "+" : ""}`;
}

function TempoPanel({
  combat,
  hasPocketWatch,
}: {
  combat: NonNullable<RunState["combat"]>;
  hasPocketWatch: boolean;
}) {
  const watchWillTrigger = hasPocketWatch && combat.cardsPlayedThisTurn <= 3;
  return (
    <div className="tempo-panel">
      <div className="tempo-cell">
        <BookOpen size={14} />
        <span>本回合</span>
        <strong>{combat.cardsPlayedThisTurn}</strong>
      </div>
      <div className="tempo-cell">
        <Sword size={14} />
        <span>攻击</span>
        <strong>{combat.attacksPlayedThisTurn}</strong>
      </div>
      <div className="tempo-cell">
        <Layers size={14} />
        <span>上回合</span>
        <strong>{combat.cardsPlayedLastTurn}</strong>
      </div>
      <div className="tempo-cell">
        <Target size={14} />
        <span>总攻</span>
        <strong>{combat.attackCount}</strong>
      </div>
      {hasPocketWatch && (
        <span className={`tempo-hint ${watchWillTrigger ? "is-ready" : ""}`}>
          怀表：{watchWillTrigger ? "下回合 +2 抽牌" : "需少打牌"}
        </span>
      )}
    </div>
  );
}

function MechanicMeter({ label, value, text }: { label: string; value: number; text: string }) {
  const width = `${Math.min(100, value * 18)}%`;
  return (
    <div className={`mechanic-meter ${value > 0 ? "is-active" : ""}`}>
      <div>
        <strong>{label}</strong>
        <span>{value}</span>
      </div>
      <i>
        <b style={{ width }} />
      </i>
      <small>{text}</small>
    </div>
  );
}

function MechanicChainPanel({
  playerPowers,
  enemyTotals,
  cardsPlayed,
}: {
  playerPowers: PowerMap;
  enemyTotals: PowerMap;
  cardsPlayed: number;
}) {
  const rows = [
    {
      label: "爆发链",
      value: (playerPowers.combo ?? 0) * 2 + (playerPowers.strength ?? 0) * 3 + (enemyTotals.mark ?? 0) * 2,
      parts: [
        ["连击", playerPowers.combo ?? 0],
        ["力量", playerPowers.strength ?? 0],
        ["破绽", enemyTotals.mark ?? 0],
      ] as [string, number][],
    },
    {
      label: "防守链",
      value: (playerPowers.charge ?? 0) * 2 + (playerPowers.platedArmor ?? 0) * 4 + (playerPowers.regen ?? 0) * 3,
      parts: [
        ["蓄能", playerPowers.charge ?? 0],
        ["金属化", playerPowers.platedArmor ?? 0],
        ["再生", playerPowers.regen ?? 0],
      ] as [string, number][],
    },
    {
      label: "节拍链",
      value: (playerPowers.combo ?? 0) * 3 + (playerPowers.charge ?? 0) * 2,
      parts: [
        ["连击", playerPowers.combo ?? 0],
        ["蓄能", playerPowers.charge ?? 0],
        ["可共振", Math.min(5, playerPowers.combo ?? 0)],
      ] as [string, number][],
    },
    {
      label: "连锁链",
      value: cardsPlayed * 4 + (playerPowers.combo ?? 0) * 2 + (playerPowers.charge ?? 0),
      parts: [
        ["本回合", cardsPlayed],
        ["连击", playerPowers.combo ?? 0],
        ["蓄能", playerPowers.charge ?? 0],
      ] as [string, number][],
    },
    {
      label: "热控链",
      value: (playerPowers.bleed ?? 0) * 4 + (playerPowers.charge ?? 0) * 2 + (playerPowers.platedArmor ?? 0) * 3,
      parts: [
        ["流血", playerPowers.bleed ?? 0],
        ["蓄能", playerPowers.charge ?? 0],
        ["金属化", playerPowers.platedArmor ?? 0],
      ] as [string, number][],
    },
    {
      label: "线圈链",
      value:
        (playerPowers.charge ?? 0) * 3 +
        (playerPowers.platedArmor ?? 0) * 3 +
        (enemyTotals.spark ?? 0) * 2 +
        (playerPowers.thorns ?? 0) * 2,
      parts: [
        ["蓄能", playerPowers.charge ?? 0],
        ["金属化", playerPowers.platedArmor ?? 0],
        ["电弧", enemyTotals.spark ?? 0],
        ["尖刺", playerPowers.thorns ?? 0],
      ] as [string, number][],
    },
    {
      label: "持续链",
      value: (enemyTotals.poison ?? 0) * 2 + (enemyTotals.bleed ?? 0) * 2 + (enemyTotals.spark ?? 0) * 2,
      parts: [
        ["中毒", enemyTotals.poison ?? 0],
        ["流血", enemyTotals.bleed ?? 0],
        ["电弧", enemyTotals.spark ?? 0],
      ] as [string, number][],
    },
  ];

  return (
    <div className="mechanic-chain">
      {rows.map((row) => (
        <div key={row.label} className={row.value > 0 ? "is-active" : ""}>
          <strong>{row.label}</strong>
          <i>
            <b style={{ width: `${Math.min(100, row.value * 8)}%` }} />
          </i>
          <span>
            {row.parts.map(([label, value]) => (
              <em key={label} className={value > 0 ? "is-live" : ""}>
                {label} {value}
              </em>
            ))}
          </span>
        </div>
      ))}
    </div>
  );
}

function TargetPreview({ preview }: { preview: TargetPreview }) {
  const powerEntries = Object.entries(preview.powerAdds).filter(([, value]) => (value ?? 0) > 0) as [PowerKey, number][];
  return (
    <div className={`target-preview ${preview.lethal ? "is-lethal" : ""}`}>
      {preview.damage > 0 && (
        <span>
          <Sword size={13} /> -{preview.damage}
        </span>
      )}
      {preview.blockLoss > 0 && (
        <span>
          <Shield size={13} /> 破 {preview.blockLoss}
        </span>
      )}
      {preview.sparkArc > 0 && (
        <span>
          <Zap size={13} /> 弹 {preview.sparkArc}
        </span>
      )}
      {powerEntries.map(([power, value]) => (
        <span key={power}>
          <Sparkles size={13} /> {POWER_LABELS[power]} +{value}
        </span>
      ))}
      {preview.lethal && <strong>击破</strong>}
    </div>
  );
}

function ActionSummaryView({ summary }: { summary: ActionSummary }) {
  const selfPowers = Object.entries(summary.selfPowers).filter(([, value]) => (value ?? 0) > 0) as [PowerKey, number][];
  const targetPowers = Object.entries(summary.targetPowers).filter(([, value]) => (value ?? 0) > 0) as [PowerKey, number][];
  const hasAny =
    summary.block > 0 ||
    summary.draw > 0 ||
    summary.energy > 0 ||
    summary.heal > 0 ||
    selfPowers.length > 0 ||
    targetPowers.length > 0 ||
    summary.consumes.length > 0 ||
    summary.creates.length > 0 ||
    summary.recovers.length > 0 ||
    summary.cleanses.length > 0 ||
    summary.amplifies.length > 0 ||
    summary.resonates.length > 0 ||
    summary.chains.length > 0;

  if (!hasAny) {
    return null;
  }

  return (
    <div className="action-summary">
      {summary.block > 0 && (
        <span>
          <Shield size={13} /> 格挡 +{summary.block}
        </span>
      )}
      {summary.energy > 0 && (
        <span>
          <Zap size={13} /> 能量 +{summary.energy}
        </span>
      )}
      {summary.draw > 0 && (
        <span>
          <BookOpen size={13} /> 抽 {summary.draw}
        </span>
      )}
      {summary.heal > 0 && (
        <span>
          <HeartPulse size={13} /> 回复 {summary.heal}
        </span>
      )}
      {selfPowers.map(([power, value]) => (
        <span key={`self-${power}`}>
          <Sparkles size={13} /> 自身 {POWER_LABELS[power]} +{value}
        </span>
      ))}
      {targetPowers.map(([power, value]) => (
        <span key={`target-${power}`}>
          <Target size={13} /> 目标 {POWER_LABELS[power]} +{value}
        </span>
      ))}
      {summary.consumes.map((item, index) => (
        <span key={`consume-${item}-${index}`}>
          <Flame size={13} /> 消耗 {item}
        </span>
      ))}
      {summary.amplifies.map((item, index) => (
        <span key={`amplify-${item}-${index}`}>
          <Sparkles size={13} /> 催化 {item}
        </span>
      ))}
      {summary.resonates.map((item, index) => (
        <span key={`resonate-${item}-${index}`}>
          <Zap size={13} /> 共振 {item}
        </span>
      ))}
      {summary.chains.map((item, index) => (
        <span key={`chain-${item}-${index}`}>
          <Zap size={13} /> 连锁 {item}
        </span>
      ))}
      {summary.creates.map((item, index) => (
        <span key={`create-${item}-${index}`}>
          <Layers size={13} /> 生成 {item}
        </span>
      ))}
      {summary.recovers.map((item, index) => (
        <span key={`recover-${item}-${index}`}>
          <RotateCcw size={13} /> 回收 {item}
        </span>
      ))}
      {summary.cleanses.map((item, index) => (
        <span key={`cleanse-${item}-${index}`}>
          <Sparkles size={13} /> 净化 {item}
        </span>
      ))}
    </div>
  );
}

function previewCardOnEnemy(run: RunState, card: CardInstance, enemy: EnemyState): TargetPreview | undefined {
  const combat = run.combat;
  if (!combat || enemy.hp <= 0) {
    return undefined;
  }

  const def = getCardDef(card.cardId);
  const level = getCardLevel(card);
  const playerPowers: PowerMap = { ...combat.playerPowers };
  const enemyPowers: PowerMap = { ...enemy.powers };
  let enemyBlock = enemy.block;
  let enemyHp = enemy.hp;
  const preview: TargetPreview = { damage: 0, blockLoss: 0, powerAdds: {}, sparkArc: 0, lethal: false };

  if (def.type === "Attack") {
    playerPowers.combo = (playerPowers.combo ?? 0) + 1;
  }
  if (def.type === "Skill") {
    playerPowers.charge = (playerPowers.charge ?? 0) + 1;
  }

  const applyAttackDamage = (baseDamage: number) => {
    let damage = Math.max(0, baseDamage + (playerPowers.strength ?? 0));
    const mark = enemyPowers.mark ?? 0;
    if (mark > 0 && damage > 0) {
      damage += mark * 2;
      enemyPowers.mark = Math.max(0, mark - 1);
    }
    if ((playerPowers.weak ?? 0) > 0) {
      damage = Math.floor(damage * 0.75);
    }
    if ((enemyPowers.vulnerable ?? 0) > 0) {
      damage = Math.ceil(damage * 1.5);
    }

    const blocked = Math.min(enemyBlock, damage);
    enemyBlock -= blocked;
    preview.blockLoss += blocked;
    const hpLoss = Math.max(0, damage - blocked);
    if (hpLoss > 0) {
      preview.damage += hpLoss;
      enemyHp = Math.max(0, enemyHp - hpLoss);
      const spark = enemyPowers.spark ?? 0;
      if (spark > 0) {
        preview.sparkArc += spark;
        enemyPowers.spark = Math.max(0, spark - 1);
      }
      const bleed = enemyPowers.bleed ?? 0;
      if (bleed > 0 && enemyHp > 0) {
        preview.damage += bleed;
        enemyHp = Math.max(0, enemyHp - bleed);
        enemyPowers.bleed = Math.max(0, bleed - 1);
      }
    }
  };

  for (const effect of level.effects) {
    if (effect.type === "damage") {
      for (let hit = 0; hit < (effect.hits ?? 1); hit += 1) {
        applyAttackDamage(effect.amount);
      }
    }
    if (effect.type === "damageFromBlock") {
      applyAttackDamage(Math.floor(combat.playerBlock * effect.multiplier));
    }
    if (effect.type === "damagePerAttackPlayed") {
      const attacks = combat.attacksPlayedThisTurn + (def.type === "Attack" ? 1 : 0);
      applyAttackDamage(effect.amount * Math.max(1, attacks));
    }
    if (effect.type === "damagePerPower") {
      const powers = effect.powerTarget === "self" ? playerPowers : enemyPowers;
      const available = powers[effect.power] ?? 0;
      const stacks = Math.max(effect.minimum ?? 0, available);
      applyAttackDamage(effect.amount * stacks);
      if (effect.consume && available > 0) {
        powers[effect.power] = 0;
      }
    }
    if (effect.type === "spendPowerDamage") {
      const available = playerPowers[effect.power] ?? 0;
      const spent = Math.min(available, effect.consume ?? available);
      const stacks = Math.max(effect.minimum ?? 0, spent);
      applyAttackDamage(effect.amount * stacks);
      if (spent > 0) {
        playerPowers[effect.power] = Math.max(0, available - spent);
      }
    }
    if (effect.type === "applyPower" && (effect.target === "enemy" || effect.target === "allEnemies")) {
      preview.powerAdds[effect.power] = (preview.powerAdds[effect.power] ?? 0) + effect.amount;
      enemyPowers[effect.power] = (enemyPowers[effect.power] ?? 0) + effect.amount;
    }
    if (effect.type === "amplifyPower" && (effect.target === "enemy" || effect.target === "allEnemies")) {
      const gained = estimateAmplifiedPower(enemyPowers[effect.power] ?? 0, effect.multiplier, effect.minimum);
      preview.powerAdds[effect.power] = (preview.powerAdds[effect.power] ?? 0) + gained;
      enemyPowers[effect.power] = (enemyPowers[effect.power] ?? 0) + gained;
    }
  }

  preview.lethal = enemyHp <= 0;
  return preview;
}

function previewPotionOnEnemy(run: RunState, potion: PotionInstance, enemy: EnemyState): TargetPreview | undefined {
  const combat = run.combat;
  if (!combat || enemy.hp <= 0) {
    return undefined;
  }

  const def = POTIONS[potion.potionId];
  if (!def) {
    return undefined;
  }
  const preview: TargetPreview = { damage: 0, blockLoss: 0, powerAdds: {}, sparkArc: 0, lethal: false };
  let enemyBlock = enemy.block;
  let enemyHp = enemy.hp;
  const enemyPowers: PowerMap = { ...enemy.powers };

  for (const effect of def.effects as PotionEffect[]) {
    if (effect.type === "damage" && (effect.target === "enemy" || effect.target === "allEnemies")) {
      const blocked = Math.min(enemyBlock, effect.amount);
      enemyBlock -= blocked;
      preview.blockLoss += blocked;
      const hpLoss = Math.max(0, effect.amount - blocked);
      preview.damage += hpLoss;
      enemyHp = Math.max(0, enemyHp - hpLoss);
    }
    if (effect.type === "applyPower" && (effect.target === "enemy" || effect.target === "allEnemies")) {
      preview.powerAdds[effect.power] = (preview.powerAdds[effect.power] ?? 0) + effect.amount;
      enemyPowers[effect.power] = (enemyPowers[effect.power] ?? 0) + effect.amount;
    }
    if (effect.type === "amplifyPower" && (effect.target === "enemy" || effect.target === "allEnemies")) {
      const gained = estimateAmplifiedPower(enemyPowers[effect.power] ?? 0, effect.multiplier, effect.minimum);
      preview.powerAdds[effect.power] = (preview.powerAdds[effect.power] ?? 0) + gained;
      enemyPowers[effect.power] = (enemyPowers[effect.power] ?? 0) + gained;
    }
  }

  preview.lethal = enemyHp <= 0;
  return preview;
}

function summarizeCardAction(run: RunState, card: CardInstance): ActionSummary {
  const combat = run.combat!;
  const def = getCardDef(card.cardId);
  const level = getCardLevel(card);
  const summary = emptyActionSummary();
  const playerPowers: PowerMap = { ...combat.playerPowers };
  const playedCards = combat.cardsPlayedThisTurn + 1;

  if (def.type === "Skill") {
    addSummaryPower(summary.selfPowers, "charge", 1);
    playerPowers.charge = (playerPowers.charge ?? 0) + 1;
  }

  for (const effect of level.effects) {
    if (effect.type === "block") {
      summary.block += estimateBlock(combat.playerPowers, effect.amount);
    }
    if (effect.type === "blockPerPower") {
      const available = playerPowers[effect.power] ?? 0;
      const spent = Math.min(available, effect.consume ?? available);
      const stacks = Math.max(effect.minimum ?? 0, spent);
      summary.block += estimateBlock(combat.playerPowers, effect.amount * stacks);
      if (spent > 0) {
        summary.consumes.push(`${POWER_LABELS[effect.power]} ${spent}`);
        playerPowers[effect.power] = Math.max(0, available - spent);
      }
    }
    if (effect.type === "blockPerExhaustedCard") {
      const stacks = Math.max(effect.minimum ?? 0, Math.min(combat.exhaustPile.length, effect.cap ?? combat.exhaustPile.length));
      summary.block += estimateBlock(combat.playerPowers, effect.amount * stacks);
    }
    if (effect.type === "gainPowerPerPower") {
      const available = playerPowers[effect.sourcePower] ?? 0;
      const stacks = Math.max(effect.minimum ?? 0, Math.min(available, effect.cap ?? available));
      const gained = effect.amount * stacks;
      if (gained > 0) {
        addSummaryPower(summary.selfPowers, effect.gainedPower, gained);
        playerPowers[effect.gainedPower] = (playerPowers[effect.gainedPower] ?? 0) + gained;
        summary.resonates.push(`${POWER_LABELS[effect.sourcePower]} -> ${POWER_LABELS[effect.gainedPower]} +${gained}`);
      }
    }
    if (effect.type === "gainPowerPerCardPlayed") {
      const stacks = Math.max(effect.minimum ?? 0, Math.min(playedCards, effect.cap ?? playedCards));
      const gained = effect.amount * stacks;
      if (gained > 0) {
        addSummaryPower(summary.selfPowers, effect.power, gained);
        playerPowers[effect.power] = (playerPowers[effect.power] ?? 0) + gained;
        summary.chains.push(`${playedCards} 张 -> ${POWER_LABELS[effect.power]} +${gained}`);
      }
    }
    if (effect.type === "draw") {
      summary.draw += effect.amount;
    }
    if (effect.type === "gainEnergy") {
      summary.energy += effect.amount;
    }
    if (effect.type === "heal") {
      summary.heal += effect.amount;
    }
    if (effect.type === "cleanseDebuffs") {
      summary.cleanses.push("负面状态");
    }
    if (effect.type === "cleansePower") {
      const available = playerPowers[effect.power] ?? 0;
      const removed = Math.min(available, effect.amount);
      if (removed > 0) {
        summary.cleanses.push(`${POWER_LABELS[effect.power]} ${removed}`);
        playerPowers[effect.power] = Math.max(0, available - removed);
        if (effect.gainBlockPerStack) {
          summary.block += estimateBlock(combat.playerPowers, effect.gainBlockPerStack * removed);
        }
        if (effect.gainPowerPerStack) {
          const gained = effect.gainPowerPerStack.amount * removed;
          addSummaryPower(summary.selfPowers, effect.gainPowerPerStack.power, gained);
          playerPowers[effect.gainPowerPerStack.power] = (playerPowers[effect.gainPowerPerStack.power] ?? 0) + gained;
        }
        if (effect.gainEnergyPerStack) {
          summary.energy += effect.gainEnergyPerStack * removed;
        }
      }
    }
    if (effect.type === "applyPower") {
      if (effect.target === "self") {
        addSummaryPower(summary.selfPowers, effect.power, effect.amount);
        playerPowers[effect.power] = (playerPowers[effect.power] ?? 0) + effect.amount;
      } else {
        addSummaryPower(summary.targetPowers, effect.power, effect.amount);
      }
    }
    if (effect.type === "amplifyPower") {
      summary.amplifies.push(amplifySummaryLabel(effect.power, effect.multiplier, effect.minimum, effect.target === "self" ? "自身" : "目标"));
      if (effect.target === "self") {
        const gained = estimateAmplifiedPower(playerPowers[effect.power] ?? 0, effect.multiplier, effect.minimum);
        if (gained > 0) {
          addSummaryPower(summary.selfPowers, effect.power, gained);
          playerPowers[effect.power] = (playerPowers[effect.power] ?? 0) + gained;
        }
      }
    }
    if (effect.type === "spendPowerDamage") {
      const available = playerPowers[effect.power] ?? 0;
      const spent = Math.min(available, effect.consume ?? available);
      if (spent > 0) {
        summary.consumes.push(`${POWER_LABELS[effect.power]} ${spent}`);
        playerPowers[effect.power] = Math.max(0, available - spent);
      }
    }
    if (effect.type === "damagePerPower" && effect.consume && effect.powerTarget === "self") {
      const stacks = playerPowers[effect.power] ?? 0;
      if (stacks > 0) {
        summary.consumes.push(`${POWER_LABELS[effect.power]} ${stacks}`);
        playerPowers[effect.power] = 0;
      }
    }
    if (effect.type === "createCard") {
      summary.creates.push(CARDS[effect.cardId]?.name ?? effect.cardId);
    }
    if (effect.type === "returnFromDiscard") {
      summary.recovers.push(effect.cardType ? `${CARD_TYPE_LABELS[effect.cardType]}牌` : effect.excludeStatus ? "非状态牌" : "弃牌");
    }
    if (effect.type === "exhaustCards") {
      const exhausted = estimateExhaustCount(combat, effect);
      const label = effect.cardType ? `${CARD_TYPE_LABELS[effect.cardType]}牌` : "手牌";
      summary.consumes.push(exhausted > 0 ? `${label} ${exhausted}` : label);
      if (exhausted > 0) {
        if (effect.gainBlockPerCard) {
          summary.block += estimateBlock(combat.playerPowers, effect.gainBlockPerCard * exhausted);
        }
        if (effect.drawPerCard) {
          summary.draw += effect.drawPerCard * exhausted;
        }
        if (effect.gainEnergyPerCard) {
          summary.energy += effect.gainEnergyPerCard * exhausted;
        }
        if (effect.gainPowerPerCard) {
          addSummaryPower(summary.selfPowers, effect.gainPowerPerCard.power, effect.gainPowerPerCard.amount * exhausted);
        }
      }
    }
  }

  return summary;
}

function summarizePotionAction(run: RunState, potion: PotionInstance): ActionSummary {
  const def = POTIONS[potion.potionId];
  const summary = emptyActionSummary();
  if (!def) {
    return summary;
  }
  const combat = run.combat;
  const playerPowers: PowerMap = combat ? { ...combat.playerPowers } : {};
  const playedCards = combat?.cardsPlayedThisTurn ?? 0;

  for (const effect of def.effects) {
    if (effect.type === "block") summary.block += combat ? estimateBlock(combat.playerPowers, effect.amount) : effect.amount;
    if (effect.type === "blockPerExhaustedCard") {
      const exhausted = combat ? Math.max(effect.minimum ?? 0, Math.min(combat.exhaustPile.length, effect.cap ?? combat.exhaustPile.length)) : (effect.cap ?? 0);
      const rawBlock = effect.amount * exhausted;
      summary.block += combat ? estimateBlock(combat.playerPowers, rawBlock) : rawBlock;
    }
    if (effect.type === "gainPowerPerPower") {
      const available = playerPowers[effect.sourcePower] ?? 0;
      const stacks = Math.max(effect.minimum ?? 0, Math.min(available, effect.cap ?? available));
      const gained = effect.amount * stacks;
      if (gained > 0) {
        addSummaryPower(summary.selfPowers, effect.gainedPower, gained);
        playerPowers[effect.gainedPower] = (playerPowers[effect.gainedPower] ?? 0) + gained;
        summary.resonates.push(`${POWER_LABELS[effect.sourcePower]} -> ${POWER_LABELS[effect.gainedPower]} +${gained}`);
      }
    }
    if (effect.type === "gainPowerPerCardPlayed") {
      const stacks = Math.max(effect.minimum ?? 0, Math.min(playedCards, effect.cap ?? playedCards));
      const gained = effect.amount * stacks;
      if (gained > 0) {
        addSummaryPower(summary.selfPowers, effect.power, gained);
        playerPowers[effect.power] = (playerPowers[effect.power] ?? 0) + gained;
        summary.chains.push(`${playedCards} 张 -> ${POWER_LABELS[effect.power]} +${gained}`);
      }
    }
    if (effect.type === "draw") summary.draw += effect.amount;
    if (effect.type === "gainEnergy") summary.energy += effect.amount;
    if (effect.type === "heal") summary.heal += effect.amount;
    if (effect.type === "cleanseDebuffs") summary.cleanses.push("负面状态");
    if (effect.type === "cleansePower") {
      const available = playerPowers[effect.power] ?? 0;
      const removed = Math.min(available, effect.amount);
      if (removed > 0) {
        summary.cleanses.push(`${POWER_LABELS[effect.power]} ${removed}`);
        playerPowers[effect.power] = Math.max(0, available - removed);
        if (effect.gainBlockPerStack) {
          const rawBlock = effect.gainBlockPerStack * removed;
          summary.block += combat ? estimateBlock(combat.playerPowers, rawBlock) : rawBlock;
        }
        if (effect.gainPowerPerStack) {
          addSummaryPower(summary.selfPowers, effect.gainPowerPerStack.power, effect.gainPowerPerStack.amount * removed);
        }
        if (effect.gainEnergyPerStack) {
          summary.energy += effect.gainEnergyPerStack * removed;
        }
      }
    }
    if (effect.type === "returnFromDiscard") {
      summary.recovers.push(effect.cardType ? `${CARD_TYPE_LABELS[effect.cardType]}牌` : effect.excludeStatus ? "非状态牌" : "弃牌");
    }
    if (effect.type === "exhaustCards") {
      const exhausted = combat ? estimateExhaustCount(combat, effect) : effect.amount;
      const label = effect.cardType ? `${CARD_TYPE_LABELS[effect.cardType]}牌` : "牌";
      summary.consumes.push(exhausted > 0 ? `${label} ${exhausted}` : label);
      if (effect.gainBlockPerCard) {
        const rawBlock = effect.gainBlockPerCard * exhausted;
        summary.block += combat ? estimateBlock(combat.playerPowers, rawBlock) : rawBlock;
      }
      if (effect.drawPerCard) summary.draw += effect.drawPerCard * exhausted;
      if (effect.gainEnergyPerCard) summary.energy += effect.gainEnergyPerCard * exhausted;
      if (effect.gainPowerPerCard) {
        addSummaryPower(summary.selfPowers, effect.gainPowerPerCard.power, effect.gainPowerPerCard.amount * exhausted);
      }
    }
    if (effect.type === "applyPower") {
      if (effect.target === "self") {
        addSummaryPower(summary.selfPowers, effect.power, effect.amount);
        playerPowers[effect.power] = (playerPowers[effect.power] ?? 0) + effect.amount;
      } else {
        addSummaryPower(summary.targetPowers, effect.power, effect.amount);
      }
    }
    if (effect.type === "amplifyPower") {
      summary.amplifies.push(amplifySummaryLabel(effect.power, effect.multiplier, effect.minimum, effect.target === "self" ? "自身" : "目标"));
      if (effect.target !== "self" && (effect.minimum ?? 0) > 0) {
        addSummaryPower(summary.targetPowers, effect.power, effect.minimum ?? 0);
      }
    }
  }

  return summary;
}

function estimateExhaustCount(combat: NonNullable<RunState["combat"]>, effect: ExhaustCardsEffect): number {
  const zones =
    effect.zone === "handAndDiscard"
      ? [combat.hand, combat.discardPile]
      : effect.zone === "hand"
        ? [combat.hand]
        : [combat.discardPile];
  let count = 0;
  for (const zone of zones) {
    for (const card of zone) {
      const def = CARDS[card.cardId];
      if (def && (!effect.cardType || def.type === effect.cardType)) {
        count += 1;
      }
    }
  }
  return Math.min(effect.amount, count);
}

function emptyActionSummary(): ActionSummary {
  return {
    block: 0,
    draw: 0,
    energy: 0,
    heal: 0,
    selfPowers: {},
    targetPowers: {},
    consumes: [],
    creates: [],
    recovers: [],
    cleanses: [],
    amplifies: [],
    resonates: [],
    chains: [],
  };
}

function estimateAmplifiedPower(current: number, multiplier: number, minimum = 0): number {
  return Math.max(0, Math.floor(Math.max(0, current) * Math.max(0, multiplier - 1)), minimum);
}

function amplifySummaryLabel(power: PowerKey, multiplier: number, minimum = 0, target: string): string {
  const minimumText = minimum > 0 ? `，至少 +${minimum}` : "";
  return `${target}${POWER_LABELS[power]} x${multiplier}${minimumText}`;
}

function addSummaryPower(target: Partial<Record<PowerKey, number>>, power: PowerKey, amount: number): void {
  target[power] = (target[power] ?? 0) + amount;
}

function estimateBlock(powers: PowerMap, baseBlock: number): number {
  let block = Math.max(0, baseBlock + (powers.dexterity ?? 0));
  if ((powers.frail ?? 0) > 0) {
    block = Math.floor(block * 0.75);
  }
  return block;
}

function estimateIncomingDamage(run: RunState): number {
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

function estimateOngoingSelfDamage(run: RunState): number {
  const combat = run.combat;
  if (!combat) {
    return 0;
  }

  const poison = combat.playerPowers.poison ?? 0;
  const burn = combat.hand.reduce((sum, card) => sum + (getCardLevel(card).endTurnDamage ?? 0), 0);
  return poison + burn;
}

function estimateOngoingEnemyDamage(combat: NonNullable<RunState["combat"]>): number {
  return combat.enemies.reduce((sum, enemy) => {
    if (enemy.hp <= 0) {
      return sum;
    }

    return sum + Math.min(enemy.hp, enemy.powers.poison ?? 0);
  }, 0);
}

function aggregateEnemyPowers(enemies: EnemyState[]): PowerMap {
  return enemies.reduce<PowerMap>((acc, enemy) => {
    if (enemy.hp <= 0) {
      return acc;
    }
    for (const [power, value] of Object.entries(enemy.powers) as [PowerKey, number][]) {
      acc[power] = (acc[power] ?? 0) + value;
    }
    return acc;
  }, {});
}

function bestCatalystInsight(enemies: EnemyState[]): CatalystInsight | undefined {
  const catalystPowers: PowerKey[] = ["poison", "bleed", "mark", "spark"];
  const candidates = enemies
    .filter((enemy) => enemy.hp > 0)
    .map((enemy) => {
      const entries = catalystPowers
        .map((power) => [power, enemy.powers[power] ?? 0] as [PowerKey, number])
        .filter(([, value]) => value > 0);
      return {
        enemyName: enemy.name,
        entries,
        total: entries.reduce((sum, [, value]) => sum + value, 0),
      };
    })
    .filter((candidate) => candidate.total > 0)
    .sort((a, b) => b.total - a.total);

  return candidates[0];
}

function combatHintPowers(combat: RunState["combat"]): PowerKey[] {
  if (!combat) {
    return [];
  }

  const seen = new Set<PowerKey>();
  for (const [power, value] of Object.entries(combat.playerPowers) as [PowerKey, number][]) {
    if (value > 0) {
      seen.add(power);
    }
  }
  for (const enemy of combat.enemies) {
    if (enemy.hp <= 0) {
      continue;
    }
    for (const [power, value] of Object.entries(enemy.powers) as [PowerKey, number][]) {
      if (value > 0) {
        seen.add(power);
      }
    }
  }

  return MECHANIC_HINT_PRIORITY.filter((power) => seen.has(power)).slice(0, 5);
}

function cardMechanicTags(card: CardInstance): string[] {
  const def = getCardDef(card.cardId);
  const level = getCardLevel(card);
  const tags = new Set<string>();
  if (def.type === "Attack") tags.add("连击");
  if (def.type === "Skill") tags.add("蓄能");
  if (level.exhaust) tags.add("消耗");
  if (level.retain) tags.add("保留");
  if (level.ethereal) tags.add("虚无");
  if (level.unplayable) tags.add("不可打出");

  for (const effect of level.effects) {
    if (effect.type === "damage") tags.add(effect.target === "allEnemies" ? "群攻" : "伤害");
    if (effect.type === "damageFromBlock") tags.add("盾击");
    if (effect.type === "damagePerAttackPlayed") tags.add("连击伤害");
    if (effect.type === "damagePerPower") tags.add(`${POWER_LABELS[effect.power]}爆发`);
    if (effect.type === "spendPowerDamage") tags.add(`${POWER_LABELS[effect.power]}爆发`);
    if (effect.type === "amplifyPower") tags.add(`${POWER_LABELS[effect.power]}催化`);
    if (effect.type === "block") tags.add("格挡");
    if (effect.type === "blockPerPower") tags.add(`${POWER_LABELS[effect.power]}格挡`);
    if (effect.type === "blockPerExhaustedCard") {
      tags.add("格挡");
      tags.add("消耗堆");
    }
    if (effect.type === "gainPowerPerPower") {
      tags.add("共振");
      tags.add(POWER_LABELS[effect.sourcePower]);
      tags.add(POWER_LABELS[effect.gainedPower]);
    }
    if (effect.type === "gainPowerPerCardPlayed") {
      tags.add("连锁");
      tags.add(POWER_LABELS[effect.power]);
    }
    if (effect.type === "cleansePower") {
      tags.add("散热");
      tags.add("净化");
      tags.add(POWER_LABELS[effect.power]);
      if (effect.gainPowerPerStack) tags.add(POWER_LABELS[effect.gainPowerPerStack.power]);
    }
    if (effect.type === "applyPower") {
      if (effect.target === "self" && effect.power === "bleed" && effect.amount > 0) tags.add("过载");
      tags.add(POWER_LABELS[effect.power]);
    }
    if (effect.type === "draw") tags.add("抽牌");
    if (effect.type === "gainEnergy") tags.add("能量");
    if (effect.type === "heal") tags.add("回复");
    if (effect.type === "cleanseDebuffs") tags.add("净化");
    if (effect.type === "createCard") tags.add("生成");
    if (effect.type === "returnFromDiscard") tags.add("回收");
    if (effect.type === "exhaustCards") {
      tags.add("净化");
      if (effect.gainEnergyPerCard) tags.add("能量");
      if (effect.gainPowerPerCard) tags.add(POWER_LABELS[effect.gainPowerPerCard.power]);
    }
  }

  return [...tags].slice(0, 5);
}

function potionMechanicTags(potion: PotionInstance): string[] {
  const def = POTIONS[potion.potionId];
  if (!def) {
    return ["失效"];
  }
  const tags = new Set<string>();
  for (const effect of def.effects) {
    if (effect.type === "damage") tags.add(effect.target === "allEnemies" ? "群攻" : "伤害");
    if (effect.type === "block") tags.add("格挡");
    if (effect.type === "blockPerExhaustedCard") {
      tags.add("格挡");
      tags.add("消耗堆");
    }
    if (effect.type === "gainPowerPerPower") {
      tags.add("共振");
      tags.add(POWER_LABELS[effect.sourcePower]);
      tags.add(POWER_LABELS[effect.gainedPower]);
    }
    if (effect.type === "gainPowerPerCardPlayed") {
      tags.add("连锁");
      tags.add(POWER_LABELS[effect.power]);
    }
    if (effect.type === "cleansePower") {
      tags.add("散热");
      tags.add("净化");
      tags.add(POWER_LABELS[effect.power]);
      if (effect.gainPowerPerStack) tags.add(POWER_LABELS[effect.gainPowerPerStack.power]);
    }
    if (effect.type === "applyPower") tags.add(POWER_LABELS[effect.power]);
    if (effect.type === "amplifyPower") tags.add(`${POWER_LABELS[effect.power]}催化`);
    if (effect.type === "draw") tags.add("抽牌");
    if (effect.type === "gainEnergy") tags.add("能量");
    if (effect.type === "heal") tags.add("回复");
    if (effect.type === "cleanseDebuffs") tags.add("净化");
    if (effect.type === "returnFromDiscard") tags.add("回收");
    if (effect.type === "exhaustCards") {
      tags.add("净化");
      if (effect.gainEnergyPerCard) tags.add("能量");
      if (effect.gainPowerPerCard) tags.add(POWER_LABELS[effect.gainPowerPerCard.power]);
    }
  }
  return [...tags].slice(0, 4);
}

function boonMechanicTags(boonId: BoonId): string[] {
  const boon = BOONS[boonId];
  return boon ? BOON_MECHANIC_TAGS[boonId] ?? [BOON_RARITY_LABELS[boon.rarity]] : ["失效"];
}

function RewardScreen({
  run,
  onPick,
  onPickPotion,
  onPickBoon,
  onRerollCards,
  onSkip,
}: {
  run: RunState;
  onPick: (index: number) => void;
  onPickPotion: () => void;
  onPickBoon: (index: number) => void;
  onRerollCards: () => void;
  onSkip: () => void;
}) {
  const reward = run.reward!;
  const cardResolved = Boolean(reward.cardResolved);
  const boonOffers = reward.boons ?? [];
  const showBoons = boonOffers.length > 0 && !reward.boonResolved;
  const rerollPrice =
    typeof reward.rerollPrice === "number" && Number.isFinite(reward.rerollPrice) && reward.rerollPrice >= 0
      ? reward.rerollPrice
      : shopPricePreview(run, 24);
  const skipGold = rewardGoldPreview(run, 8);
  const hasRemainingNonCardReward = Boolean(reward.potionId || showBoons);
  return (
    <section className="choice-layout">
      <div className="choice-heading">
        <p>{reward.title}</p>
        <h2>{cardResolved ? "领取剩余奖励" : "选择战斗奖励"}</h2>
      </div>
      <div className="reward-strip">
        <span>
          <Coins size={16} /> +{reward.gold} 金币
        </span>
        {reward.relicId && (
          <span>
            <Award size={16} /> {RELICS[reward.relicId]?.name ?? "失效遗物"}
          </span>
        )}
      </div>
      {!cardResolved && (
        <div className="reward-section">
          <PanelTitle icon={<BookOpen size={17} />} title="卡牌" />
          <div className="card-choice-row">
            {reward.cards.map((offer, index) => (
              <CardView
                key={`${offer.cardId}-${index}`}
                card={{ uid: `${offer.cardId}-${index}`, cardId: offer.cardId, upgraded: offer.upgraded }}
                onClick={() => onPick(index)}
              />
            ))}
          </div>
          <div className="reward-actions">
            <button
              className="secondary-button"
              type="button"
              disabled={reward.rerolled || run.player.gold < rerollPrice}
              onClick={onRerollCards}
            >
              <RotateCcw size={16} />
              <span>{reward.rerolled ? "已重掷" : `重掷卡牌 ${rerollPrice} 金币`}</span>
            </button>
          </div>
        </div>
      )}
      {reward.potionId &&
        (() => {
          const potion = POTIONS[reward.potionId!];
          const tags = potion ? potionMechanicTags({ uid: `reward-${reward.potionId}`, potionId: reward.potionId! }).slice(0, 4) : [];
          return (
            <div className="reward-section">
              <PanelTitle icon={<FlaskConical size={17} />} title="药水" />
              <button className="reward-potion" type="button" onClick={onPickPotion}>
                <PackagePotionIcon />
                <strong>{potion?.name ?? "失效药水"}</strong>
                <span>{potion?.text ?? "这瓶药水来自旧数据，领取后会被清理。"}</span>
                {tags.length > 0 && (
                  <div className="offer-tags">
                    {tags.map((tag) => (
                      <em key={tag}>{tag}</em>
                    ))}
                  </div>
                )}
              </button>
            </div>
          );
        })()}
      {showBoons && (
        <div className="reward-section">
          <PanelTitle icon={<Sparkles size={17} />} title="常驻提升" />
          <div className="boon-choice-row">
            {boonOffers.map((offer, index) => {
              const owned = run.player.boons.includes(offer.boonId);
              const boon = BOONS[offer.boonId];
              const tags = boon ? boonMechanicTags(offer.boonId).slice(0, 3) : [];
              return (
                <button className="boon-card" type="button" key={offer.boonId} disabled={owned} onClick={() => onPickBoon(index)}>
                  <Sparkles size={18} />
                  <strong>{boon?.name ?? "失效常驻"}</strong>
                  <span>{boon?.text ?? "这个常驻提升来自旧数据，已无法领取。"}</span>
                  {tags.length > 0 && (
                    <div className="offer-tags">
                      {tags.map((tag) => (
                        <em key={tag}>{tag}</em>
                      ))}
                    </div>
                  )}
                  <small>{owned ? "已拥有" : boon ? BOON_RARITY_LABELS[boon.rarity] : "失效"}</small>
                </button>
              );
            })}
          </div>
        </div>
      )}
      <button className="secondary-button" type="button" onClick={onSkip}>
        <ChevronRight size={17} />
        <span>{cardResolved ? (hasRemainingNonCardReward ? "跳过剩余奖励" : "继续路线") : `跳过卡牌 +${skipGold} 金币`}</span>
      </button>
    </section>
  );
}

function RestScreen({
  run,
  onBrew,
  onCleanseStatus,
  onHeal,
  onUpgrade,
}: {
  run: RunState;
  onBrew: () => void;
  onCleanseStatus: () => void;
  onHeal: () => void;
  onUpgrade: (cardUid: string) => void;
}) {
  const healAmount = Math.ceil(run.player.maxHp * 0.3);
  const isFullHealth = run.player.hp >= run.player.maxHp;
  const restPrepGold = rewardGoldPreview(run, 6);
  const upgradeable = run.player.deck.filter((card) => !card.upgraded);
  const hasPotionSpace = run.player.potions.length < run.player.potionSlots;
  const statusCount = run.player.deck.filter((card) => CARDS[card.cardId]?.type === "Status").length;

  return (
    <section className="rest-layout">
      <div className="choice-heading">
        <p>营火</p>
        <h2>休息或锻造</h2>
      </div>
      <div className="rest-actions">
        <button className="rest-action" type="button" onClick={onHeal}>
          <HeartPulse size={22} />
          <strong>{isFullHealth ? "整备" : "休息"}</strong>
          <span>{isFullHealth ? `生命已满，获得 ${restPrepGold} 金币` : `回复最多 ${healAmount} 点生命`}</span>
        </button>
        <button className="rest-action" type="button" disabled={!hasPotionSpace} onClick={onBrew}>
          <FlaskConical size={22} />
          <strong>调配</strong>
          <span>{hasPotionSpace ? `获得 1 瓶随机药水 ${run.player.potions.length}/${run.player.potionSlots}` : "药水槽已满"}</span>
        </button>
        <button className="rest-action" type="button" disabled={statusCount === 0} onClick={onCleanseStatus}>
          <Sparkles size={22} />
          <strong>清理</strong>
          <span>{statusCount > 0 ? `移除 1 张随机状态牌 · 当前 ${statusCount}` : "没有状态牌"}</span>
        </button>
      </div>
      <div className="upgrade-list">
        {upgradeable.map((card) => {
          const def = CARDS[card.cardId];
          return (
            <button className="upgrade-row" type="button" key={card.uid} onClick={() => onUpgrade(card.uid)}>
              <span>{def.name}</span>
              <small>
                <b>{getCardLevel(card).text}</b>
                <em>升级后：{def.upgraded.text}</em>
              </small>
              <ChevronRight size={16} />
            </button>
          );
        })}
      </div>
    </section>
  );
}

function ShopScreen({
  run,
  onBuyCard,
  onBuyRelic,
  onBuyPotion,
  onBuyBoon,
  onRemoveCard,
  onBuyHeal,
  onRestock,
  onLeave,
}: {
  run: RunState;
  onBuyCard: (index: number) => void;
  onBuyRelic: (index: number) => void;
  onBuyPotion: (index: number) => void;
  onBuyBoon: (index: number) => void;
  onRemoveCard: (uid: string) => void;
  onBuyHeal: () => void;
  onRestock: () => void;
  onLeave: () => void;
}) {
  const shop = run.shop!;
  const validPrice = (price: unknown): price is number => typeof price === "number" && Number.isFinite(price) && price >= 0;
  const canAfford = (price: unknown) => validPrice(price) && run.player.gold >= price;
  const priceText = (price: unknown) => (validPrice(price) ? `${price} 金币` : "价格异常");
  return (
    <section className="shop-layout">
      <div className="choice-heading">
        <p>商店</p>
        <h2>把金币换成下一场战斗的答案</h2>
      </div>
      <div className="shop-grid">
        <div>
          <PanelTitle icon={<BookOpen size={17} />} title="卡牌" />
          <div className="shop-cards">
            {shop.cards.map((offer, index) => {
              const canPrice = validPrice(offer.price);
              const cardDef = CARDS[offer.cardId];
              if (!cardDef) {
                return (
                  <div key={`${offer.cardId}-${index}`} className="shop-card is-sold">
                    <div className="game-card game-card--status is-disabled">
                      <div className="game-card__top">
                        <strong>失效卡牌</strong>
                      </div>
                      <p>这张商店卡牌来自旧数据，已无法购买。</p>
                    </div>
                    <span className="price">
                      <Coins size={14} /> 价格异常
                    </span>
                  </div>
                );
              }
              return (
                <div key={`${offer.cardId}-${index}`} className={`shop-card ${offer.sold ? "is-sold" : ""}`}>
                  <CardView
                    card={{ uid: `${offer.cardId}-${index}`, cardId: offer.cardId, upgraded: offer.upgraded }}
                    disabled={offer.sold || !canPrice || !canAfford(offer.price)}
                    onClick={() => onBuyCard(index)}
                  />
                  <span className="price">
                    <Coins size={14} /> {offer.sold ? "已售" : priceText(offer.price)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
        <div className="shop-side">
          <PanelTitle icon={<Award size={17} />} title="遗物" />
          {shop.relics.map((offer, index) => {
            const relic = RELICS[offer.relicId];
            return (
              <button
                key={offer.relicId}
                className="shop-relic"
                type="button"
                disabled={offer.sold || !relic || !canAfford(offer.price)}
                onClick={() => onBuyRelic(index)}
              >
                <Award size={18} />
                <strong>{relic?.name ?? "失效遗物"}</strong>
                <span>{relic?.text ?? "这个遗物来自旧数据，已无法购买。"}</span>
                <small>{offer.sold ? "已售" : relic ? priceText(offer.price) : "失效"}</small>
              </button>
            );
          })}
          <PanelTitle icon={<Sparkles size={17} />} title="常驻提升" />
          {(shop.boons ?? []).map((offer, index) => {
            const boon = BOONS[offer.boonId];
            const tags = boon ? boonMechanicTags(offer.boonId).slice(0, 3) : [];
            return (
              <button
                key={offer.boonId}
                className="shop-boon"
                type="button"
                disabled={offer.sold || !boon || !canAfford(offer.price)}
                onClick={() => onBuyBoon(index)}
              >
                <Sparkles size={18} />
                <strong>{boon?.name ?? "失效常驻"}</strong>
                <span>{boon?.text ?? "这个常驻提升来自旧数据，已无法购买。"}</span>
                {tags.length > 0 && (
                  <div className="offer-tags">
                    {tags.map((tag) => (
                      <em key={tag}>{tag}</em>
                    ))}
                  </div>
                )}
                <small>{offer.sold ? "已售" : boon ? priceText(offer.price) : "失效"}</small>
              </button>
            );
          })}
          <PanelTitle icon={<FlaskConical size={17} />} title="药水" />
          <div className="shop-potions">
            {shop.potions.map((offer, index) => {
              const potion = POTIONS[offer.potionId];
              const tags = potion ? potionMechanicTags({ uid: `${offer.potionId}-${index}`, potionId: offer.potionId }).slice(0, 4) : [];
              return (
                <button
                  key={`${offer.potionId}-${index}`}
                  className="shop-potion"
                  type="button"
                  disabled={
                    offer.sold ||
                    !potion ||
                    !canAfford(offer.price) ||
                    run.player.potions.length >= run.player.potionSlots
                  }
                  onClick={() => onBuyPotion(index)}
                >
                  <FlaskConical size={16} />
                  <strong>{potion?.name ?? "失效药水"}</strong>
                  <span>{potion?.text ?? "这瓶药水来自旧数据，已无法购买。"}</span>
                  {tags.length > 0 && (
                    <div className="offer-tags">
                      {tags.map((tag) => (
                        <em key={tag}>{tag}</em>
                      ))}
                    </div>
                  )}
                  <small>{offer.sold ? "已售" : potion ? priceText(offer.price) : "失效"}</small>
                </button>
              );
            })}
          </div>
          <button
            className="shop-relic"
            type="button"
            disabled={shop.healSold || !canAfford(shop.healPrice) || run.player.hp === run.player.maxHp}
            onClick={onBuyHeal}
          >
            <HeartPulse size={18} />
            <strong>治疗药剂</strong>
            <span>回复 14 点生命。</span>
            <small>{shop.healSold ? "已售" : priceText(shop.healPrice)}</small>
          </button>
          <PanelTitle icon={<BookOpen size={17} />} title="牌组服务" />
          <div className="shop-remove-list">
            {run.player.deck.map((card) => (
              <button
                className="shop-remove-row"
                type="button"
                key={card.uid}
                disabled={
                  shop.removeSold ||
                  !canAfford(shop.removePrice) ||
                  run.player.deck.length <= 1
                }
                onClick={() => onRemoveCard(card.uid)}
              >
                <span>{cardDisplayName(card)}</span>
                <small>{shop.removeSold ? "已用" : priceText(shop.removePrice)}</small>
              </button>
            ))}
          </div>
          <button
            className="secondary-button secondary-button--wide"
            type="button"
            disabled={shop.restocked || !canAfford(shop.restockPrice)}
            onClick={onRestock}
          >
            <RotateCcw size={17} />
            <span>{shop.restocked ? "库存已刷新" : `刷新库存 ${priceText(shop.restockPrice)}`}</span>
          </button>
          <button
            className="primary-button primary-button--wide"
            type="button"
            onClick={onLeave}
          >
            <ChevronRight size={17} />
            <span>离开商店</span>
          </button>
        </div>
      </div>
    </section>
  );
}

function EventScreen({ run, onChoose }: { run: RunState; onChoose: (optionId: string) => void }) {
  const event = getCurrentEvent(run) ?? run.event!;
  return (
    <section className="event-layout">
      <div className="event-copy">
        <p>事件</p>
        <h2>{event.title}</h2>
        <span>{event.text}</span>
      </div>
      <div className="event-options">
        {event.options.map((option) => {
          const tags = eventOptionTags(option.text);
          return (
            <button
              key={option.id}
              className="event-option"
              type="button"
              disabled={option.disabled}
              onClick={() => onChoose(option.id)}
            >
              <strong>{option.label}</strong>
              {tags.length > 0 && (
                <div className="event-option__tags">
                  {tags.map((tag) => (
                    <em key={tag}>{tag}</em>
                  ))}
                </div>
              )}
              <span>{option.text}</span>
              {option.disabled && <small>{option.disabledReason ?? "条件不足"}</small>}
              <ChevronRight size={17} />
            </button>
          );
        })}
      </div>
    </section>
  );
}

function eventOptionTags(text: string): string[] {
  const tags: string[] = [];
  const add = (condition: boolean, tag: string) => {
    if (condition && !tags.includes(tag)) {
      tags.push(tag);
    }
  };

  add(/失去 \d+ 点生命/.test(text), "扣血");
  add(/支付 \d+ 金币/.test(text), "花费");
  add(/获得 \d+ 金币/.test(text), "金币");
  add(text.includes("回复"), "回复");
  add(text.includes("最大生命"), "生命上限");
  add(text.includes("药水"), "药水");
  add(text.includes("药水槽"), "瓶槽");
  add(text.includes("常驻提升"), "常驻");
  add(text.includes("节拍") || text.includes("连击") || text.includes("蓄能"), "共振");
  add(text.includes("连锁") || text.includes("本回合") || text.includes("第 3 张牌"), "连锁");
  add(text.includes("过载") || text.includes("自身流血"), "过载");
  add(text.includes("散热") || text.includes("冷却") || text.includes("热控"), "散热");
  add(text.includes("催化"), "催化");
  add(text.includes("清创") || text.includes("净化"), "净化");
  add(text.includes("消耗堆") || text.includes("余烬"), "消耗堆");
  add(text.includes("遗物"), "遗物");
  add(text.includes("升级"), "升级");
  add(text.includes("移除"), "移除");
  add(text.includes("路线") || text.includes("节点") || text.includes("精英"), "路线");
  add(text.includes("伤口") || text.includes("灼烧") || text.includes("晕眩") || text.includes("黏液"), "状态");
  add(text.includes("加入牌组"), "污染");
  add(
    text.includes("获得") &&
      (text.includes("牌") ||
        /散热片|过载涌流|连锁护法|节拍电池|创伤回收|余烬护幕|战地预案|战斗节拍|合金壳|线圈鞭击|血毒催化|裂隙突刺|镀层防守|记忆钩索|战场回收|弧光刃|电容器|放电|毒刃架势/.test(text)) &&
      !text.includes("状态牌"),
    "卡牌",
  );

  return tags.slice(0, 5);
}

function EndScreen({
  run,
  result,
  onStart,
}: {
  run: RunState;
  result: "victory" | "defeat";
  onStart: () => void;
}) {
  return (
    <section className="end-layout">
      <div className={`end-badge end-badge--${result}`}>{result === "victory" ? <Flame size={52} /> : <Skull size={52} />}</div>
      <p>{result === "victory" ? "胜利" : "失败"}</p>
      <h2>{run.message}</h2>
      <div className="run-summary">
        <StatPill icon={<MapIcon size={17} />} label={`幕 ${run.act ?? 1}`} tone="floor" />
        <StatPill icon={<MapIcon size={17} />} label={`节点 ${run.stats.nodesCleared}`} tone="floor" />
        <StatPill icon={<Sword size={17} />} label={`伤害 ${run.stats.damageDealt}`} tone="deck" />
        <StatPill icon={<Coins size={17} />} label={`金币 ${run.stats.goldEarned}`} tone="gold" />
        <StatPill icon={<BookOpen size={17} />} label={`出牌 ${run.stats.cardsPlayed}`} tone="hp" />
      </div>
      <div className="end-build">
        <BuildSummary deck={run.player.deck} compact />
        <div className="end-inventory">
          <StatPill icon={<Award size={17} />} label={`遗物 ${run.player.relics.length}`} tone="floor" />
          <StatPill icon={<Sparkles size={17} />} label={`常驻 ${run.player.boons.length}`} tone="deck" />
          <StatPill icon={<FlaskConical size={17} />} label={`药水 ${run.player.potions.length}/${run.player.potionSlots}`} tone="gold" />
        </div>
      </div>
      <button className="primary-button" type="button" onClick={onStart}>
        <RotateCcw size={17} />
        <span>再来一局</span>
      </button>
    </section>
  );
}

function CardView({
  card,
  disabled,
  selected,
  onClick,
}: {
  card: CardInstance;
  disabled?: boolean;
  selected?: boolean;
  onClick?: () => void;
}) {
  const def = getCardDef(card.cardId);
  const level = getCardLevel(card);
  const tags = cardMechanicTags(card);
  return (
    <button
      className={`game-card game-card--${def.type.toLowerCase()} ${selected ? "is-selected" : ""}`}
      type="button"
      disabled={disabled}
      onClick={onClick}
    >
      <div className="game-card__top">
        <span className="game-card__cost">{level.cost}</span>
        <strong>{def.name}{card.upgraded ? "+" : ""}</strong>
      </div>
      <div className="game-card__art">
        {def.type === "Attack" && <Sword size={38} />}
        {def.type === "Skill" && <Shield size={38} />}
        {def.type === "Power" && <Flame size={38} />}
        {def.type === "Status" && <Sparkles size={38} />}
      </div>
      <span className="game-card__type">{CARD_TYPE_LABELS[def.type]}</span>
      <p>{level.text}</p>
      {tags.length > 0 && (
        <div className="game-card__tags">
          {tags.map((tag) => (
            <span key={tag}>{tag}</span>
          ))}
        </div>
      )}
    </button>
  );
}

interface DeckSummary {
  total: number;
  upgraded: number;
  avgCost: string;
  typeCounts: Record<CardType, number>;
  topTags: Array<{ tag: string; count: number }>;
  tagCounts: Record<string, number>;
  hints: string[];
}

interface ArchetypeSignal {
  label: string;
  score: number;
  detail: string;
}

function ResourceOverview({
  run,
  onDiscardPotion,
}: {
  run: RunState;
  onDiscardPotion?: (potionUid: string) => void;
}) {
  const summary = useMemo(() => summarizeDeck(run.player.deck), [run.player.deck]);
  const archetypes = useMemo(() => summarizeRunArchetypes(run, summary), [run, summary]);
  const statusCount = summary.typeCounts.Status;
  const potionSlots = Array.from({ length: run.player.potionSlots }, (_, index) => run.player.potions[index]);
  const visibleBoons = run.player.boons.slice(0, 4);
  const hiddenBoonCount = Math.max(0, run.player.boons.length - visibleBoons.length);

  return (
    <div className="resource-overview" aria-label="资源总览">
      <section className="resource-panel resource-panel--cards">
        <div className="resource-panel__head">
          <span>
            <BookOpen size={16} /> 卡牌
          </span>
          <strong>{summary.total}</strong>
        </div>
        <div className="resource-panel__meta">
          <span>均费 {summary.avgCost}</span>
          <span>升级 {summary.upgraded}</span>
          <span className={statusCount > 0 ? "is-warning" : ""}>状态 {statusCount}</span>
        </div>
        <div className="resource-panel__tags">
          {summary.topTags.slice(0, 3).map(({ tag, count }) => (
            <span key={tag}>
              {tag} <b>{count}</b>
            </span>
          ))}
          {summary.topTags.length === 0 && <span>基础牌组</span>}
        </div>
      </section>

      <section className="resource-panel resource-panel--potions">
        <div className="resource-panel__head">
          <span>
            <FlaskConical size={16} /> 药水
          </span>
          <strong>
            {run.player.potions.length}/{run.player.potionSlots}
          </strong>
        </div>
        <div className="resource-slot-list">
          {potionSlots.map((potion, index) => (
            <ResourcePotionSlot key={potion?.uid ?? `empty-${index}`} potion={potion} onDiscardPotion={onDiscardPotion} />
          ))}
        </div>
      </section>

      <section className="resource-panel resource-panel--boons">
        <div className="resource-panel__head">
          <span>
            <Sparkles size={16} /> 常驻
          </span>
          <strong>{run.player.boons.length}</strong>
        </div>
        <div className="resource-mini-list">
          {visibleBoons.map((boonId) => {
            const boon = BOONS[boonId];
            return (
              <span className="resource-mini-item" key={boonId} title={boon?.text ?? "这项常驻提升来自旧数据。"}>
                <strong>{boon?.name ?? "失效常驻"}</strong>
                <small>{boonMechanicTags(boonId).slice(0, 2).join(" · ")}</small>
              </span>
            );
          })}
          {hiddenBoonCount > 0 && <span className="resource-mini-item is-more">+{hiddenBoonCount} 个常驻</span>}
          {visibleBoons.length === 0 && <span className="resource-mini-item is-empty">暂无常驻提升</span>}
        </div>
      </section>

      <section className="resource-panel resource-panel--synergy">
        <div className="resource-panel__head">
          <span>
            <Target size={16} /> 构筑倾向
          </span>
          <strong>{archetypes[0]?.score ?? 0}</strong>
        </div>
        <div className="resource-synergy-list">
          {archetypes.map((item) => (
            <div className="resource-synergy" key={item.label}>
              <div>
                <strong>{item.label}</strong>
                <span>{item.detail}</span>
              </div>
              <i aria-hidden="true">
                <b style={{ width: `${Math.min(100, item.score * 12)}%` }} />
              </i>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function ResourcePotionSlot({
  potion,
  onDiscardPotion,
}: {
  potion?: PotionInstance;
  onDiscardPotion?: (potionUid: string) => void;
}) {
  if (!potion) {
    return (
      <div className="resource-slot is-empty">
        <FlaskConical size={14} />
        <span>空槽</span>
      </div>
    );
  }

  const def = POTIONS[potion.potionId];
  if (!def) {
    return (
      <div className="resource-slot is-empty" title="这瓶药水来自旧数据，已无法使用。">
        <FlaskConical size={14} />
        <span>失效药水</span>
        {onDiscardPotion && (
          <button type="button" aria-label="丢弃失效药水" onClick={() => onDiscardPotion(potion.uid)}>
            <Trash2 size={13} />
          </button>
        )}
      </div>
    );
  }
  const tags = potionMechanicTags(potion).slice(0, 2);
  return (
    <div className="resource-slot" title={def.text}>
      <FlaskConical size={14} />
      <span>{def.name}</span>
      <small>{tags.length > 0 ? tags.join(" · ") : "药水"}</small>
      {onDiscardPotion && (
        <button type="button" aria-label={`丢弃${def.name}`} onClick={() => onDiscardPotion(potion.uid)}>
          <Trash2 size={13} />
        </button>
      )}
    </div>
  );
}

function actPressureText(run: Pick<RunState, "act">): string {
  const depth = Math.max(0, (run.act ?? 1) - 1);
  if (depth === 0) {
    return "敌方基础强度";
  }
  return `敌方生命 +${depth * 18}% · 伤害 +${depth * 12}% · 格挡 +${depth * 10}%`;
}

function rewardGoldPreview(run: Pick<RunState, "act" | "difficulty">, value: number): number {
  const actMultiplier = 1 + (Math.max(1, run.act ?? 1) - 1) * 0.08;
  return Math.max(1, Math.round(value * DIFFICULTIES[run.difficulty].rewardGoldMultiplier * actMultiplier));
}

function shopPricePreview(run: Pick<RunState, "difficulty">, value: number): number {
  return Math.max(1, Math.round(value * DIFFICULTIES[run.difficulty].shopPriceMultiplier));
}

function BuildSummary({ deck, compact = false }: { deck: CardInstance[]; compact?: boolean }) {
  const summary = useMemo(() => summarizeDeck(deck), [deck]);
  const typeOrder: CardType[] = ["Attack", "Skill", "Power", "Status"];

  return (
    <div className={`build-summary ${compact ? "build-summary--compact" : ""}`}>
      <div className="build-summary__head">
        <PanelTitle icon={<BookOpen size={17} />} title="构筑概览" />
        <span>{summary.total} 张</span>
      </div>
      <div className="build-summary__stats">
        <span>均费 {summary.avgCost}</span>
        <span>升级 {summary.upgraded}</span>
      </div>
      <div className="build-type-grid">
        {typeOrder.map((type) => (
          <div key={type} className={`build-type build-type--${type.toLowerCase()}`}>
            {type === "Attack" && <Sword size={15} />}
            {type === "Skill" && <Shield size={15} />}
            {type === "Power" && <Flame size={15} />}
            {type === "Status" && <Sparkles size={15} />}
            <span>{CARD_TYPE_LABELS[type]}</span>
            <strong>{summary.typeCounts[type]}</strong>
          </div>
        ))}
      </div>
      <div className="build-bar" aria-hidden="true">
        {typeOrder.map((type) => (
          <span
            key={type}
            className={`build-bar__segment build-bar__segment--${type.toLowerCase()}`}
            style={{ width: `${summary.total ? (summary.typeCounts[type] / summary.total) * 100 : 0}%` }}
          />
        ))}
      </div>
      <div className="build-tags">
        {summary.topTags.length > 0 ? (
          summary.topTags.map(({ tag, count }) => (
            <span key={tag}>
              {tag} <strong>{count}</strong>
            </span>
          ))
        ) : (
          <span>基础牌组</span>
        )}
      </div>
      <div className="build-hints">
        {summary.hints.map((hint) => (
          <span key={hint}>{hint}</span>
        ))}
      </div>
    </div>
  );
}

function summarizeDeck(deck: CardInstance[]): DeckSummary {
  const typeCounts: Record<CardType, number> = {
    Attack: 0,
    Skill: 0,
    Power: 0,
    Status: 0,
  };
  const tagCounts = new Map<string, number>();
  let upgraded = 0;
  let costSum = 0;
  let playableCards = 0;

  for (const card of deck) {
    const def = getCardDef(card.cardId);
    const level = getCardLevel(card);
    typeCounts[def.type] += 1;

    if (card.upgraded) {
      upgraded += 1;
    }

    if (def.type !== "Status" && !level.unplayable) {
      playableCards += 1;
      costSum += level.cost;
    }

    for (const tag of cardMechanicTags(card)) {
      tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
    }
  }

  const priorityTags = BUILD_TAG_PRIORITY.filter((tag) => tagCounts.has(tag)).map((tag) => ({
    tag,
    count: tagCounts.get(tag)!,
  }));
  const otherTags = [...tagCounts.entries()]
    .filter(([tag]) => !BUILD_TAG_PRIORITY.includes(tag))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "zh-Hans"))
    .map(([tag, count]) => ({ tag, count }));

  return {
    total: deck.length,
    upgraded,
    avgCost: playableCards ? (costSum / playableCards).toFixed(1) : "0.0",
    typeCounts,
    topTags: [...priorityTags, ...otherTags].slice(0, 6),
    tagCounts: Object.fromEntries(tagCounts),
    hints: buildDeckHints(deck.length, typeCounts, tagCounts, playableCards ? costSum / playableCards : 0),
  };
}

function summarizeRunArchetypes(run: RunState, summary: DeckSummary): ArchetypeSignal[] {
  const tag = (name: string) => summary.tagCounts[name] ?? 0;
  const tagStartsWith = (prefix: string) =>
    Object.entries(summary.tagCounts).reduce(
      (total, [name, count]) => total + (name !== prefix && name.startsWith(prefix) ? count : 0),
      0,
    );
  const potionTags = run.player.potions.reduce<Record<string, number>>((acc, potion) => {
    for (const item of potionMechanicTags(potion)) {
      acc[item] = (acc[item] ?? 0) + 1;
    }
    return acc;
  }, {});
  const potionTag = (name: string) => potionTags[name] ?? 0;
  const hasBoon = (boonId: BoonId) => run.player.boons.includes(boonId);
  const hasRelic = (relicId: string) => run.player.relics.includes(relicId);
  const detail = (...parts: Array<string | false | undefined>) => parts.filter(Boolean).slice(0, 3).join(" · ") || "等待核心组件";

  const signals: ArchetypeSignal[] = [
    {
      label: "攻击节奏",
      score:
        tag("连击") +
        tag("连击伤害") * 2 +
        tag("连锁") +
        tag("破绽") +
        tag("破绽催化") * 2 +
        (hasBoon("combo_discipline") ? 2 : 0) +
        (hasBoon("battle_focus") ? 1 : 0) +
        (hasBoon("blade_oil") ? 1 : 0) +
        (hasBoon("weakpoint_chart") ? 1 : 0) +
        (hasBoon("coil_training") ? 1 : 0) +
        (hasBoon("rhythm_meter") ? 2 : 0) +
        (hasBoon("chain_manual") ? 2 : 0) +
        (hasBoon("banner_drill") ? 2 : 0) +
        (hasRelic("whetstone") ? 1 : 0) +
        (hasRelic("fracture_lens") ? 1 : 0) +
        potionTag("力量"),
      detail: detail(
        tag("连击") > 0 && `连击牌 ${tag("连击")}`,
        tag("连锁") > 0 && `连锁 ${tag("连锁")}`,
        tag("破绽") > 0 && `破绽 ${tag("破绽")}`,
        tag("破绽催化") > 0 && `破绽催化 ${tag("破绽催化")}`,
        hasBoon("weakpoint_chart") && "破绽图谱",
        hasRelic("fracture_lens") && "裂纹透镜",
        hasBoon("combo_discipline") && "常驻连击",
        hasBoon("coil_training") && "线圈训练",
        hasBoon("rhythm_meter") && "随身节拍器",
        hasBoon("chain_manual") && "连锁手册",
        hasBoon("banner_drill") && "战旗操典",
        potionTag("力量") > 0 && `力量药 ${potionTag("力量")}`,
      ),
    },
    {
      label: "蓄能电弧",
      score:
        tag("蓄能") +
        tagStartsWith("蓄能") +
        tag("连锁") +
        tag("过载") * 2 +
        tag("散热") +
        tag("电弧") * 2 +
        tag("电弧催化") * 2 +
        (hasBoon("static_attunement") ? 2 : 0) +
        (hasBoon("spark_conduit") ? 2 : 0) +
        (hasBoon("reserve_battery") ? 1 : 0) +
        (hasBoon("coil_training") ? 2 : 0) +
        (hasBoon("rhythm_meter") ? 2 : 0) +
        (hasBoon("chain_manual") ? 1 : 0) +
        (hasBoon("heat_regulator") ? 2 : 0) +
        (hasRelic("charged_plate") ? 2 : 0) +
        (hasRelic("storm_needle") ? 2 : 0) +
        potionTag("蓄能") +
        potionTag("电弧"),
      detail: detail(
        tag("蓄能") > 0 && `蓄能牌 ${tag("蓄能")}`,
        tag("连锁") > 0 && `连锁 ${tag("连锁")}`,
        tag("过载") > 0 && `过载 ${tag("过载")}`,
        tag("散热") > 0 && `散热 ${tag("散热")}`,
        tag("电弧") > 0 && `电弧 ${tag("电弧")}`,
        tag("电弧催化") > 0 && `电弧催化 ${tag("电弧催化")}`,
        hasBoon("spark_conduit") && "电弧常驻",
        hasBoon("coil_training") && "线圈训练",
        hasBoon("rhythm_meter") && "随身节拍器",
        hasBoon("chain_manual") && "连锁手册",
        hasBoon("heat_regulator") && "热控铭文",
        hasRelic("storm_needle") && "风暴针",
        potionTag("蓄能") > 0 && `蓄能药 ${potionTag("蓄能")}`,
      ),
    },
    {
      label: "毒血持续",
      score:
        tag("中毒") * 2 +
        tag("流血") * 2 +
        tag("中毒催化") * 2 +
        tag("流血催化") * 2 +
        tag("破绽催化") +
        (hasBoon("venom_prep") ? 2 : 0) +
        (hasBoon("bleed_edge") ? 2 : 0) +
        (hasBoon("catalyst_training") ? 3 : 0) +
        (hasRelic("toxic_vial") ? 1 : 0) +
        potionTag("中毒") +
        potionTag("中毒催化") +
        potionTag("流血催化"),
      detail: detail(
        tag("中毒") > 0 && `中毒 ${tag("中毒")}`,
        tag("流血") > 0 && `流血 ${tag("流血")}`,
        (tag("中毒催化") + tag("流血催化") > 0) && `催化 ${tag("中毒催化") + tag("流血催化")}`,
        hasBoon("catalyst_training") && "催化训练",
        hasBoon("venom_prep") && "毒性预备",
        potionTag("中毒") > 0 && `毒药 ${potionTag("中毒")}`,
      ),
    },
    {
      label: "守备反击",
      score:
        tag("格挡") +
        tag("金属化") * 2 +
        tag("尖刺") * 2 +
        tag("消耗堆") * 2 +
        tag("散热") * 2 +
        tag("盾击") * 2 +
        (hasBoon("opening_guard") ? 1 : 0) +
        (hasBoon("plate_training") ? 2 : 0) +
        (hasBoon("tempered_shell") ? 3 : 0) +
        (hasBoon("ash_ledger") ? 2 : 0) +
        (hasBoon("heat_regulator") ? 2 : 0) +
        (hasBoon("recovery_mantra") ? 1 : 0) +
        (hasRelic("threaded_needle") ? 1 : 0) +
        (hasRelic("bronze_scales") ? 1 : 0) +
        (hasRelic("charged_plate") ? 2 : 0) +
        (hasRelic("storm_needle") ? 1 : 0) +
        potionTag("格挡") +
        potionTag("金属化") * 2 +
        potionTag("尖刺") * 2,
      detail: detail(
        tag("格挡") > 0 && `格挡牌 ${tag("格挡")}`,
        tag("金属化") > 0 && `金属化 ${tag("金属化")}`,
        tag("尖刺") > 0 && `尖刺 ${tag("尖刺")}`,
        tag("盾击") > 0 && `盾击 ${tag("盾击")}`,
        tag("消耗堆") > 0 && `消耗堆 ${tag("消耗堆")}`,
        tag("散热") > 0 && `散热 ${tag("散热")}`,
        hasBoon("tempered_shell") && "淬火外壳",
        hasBoon("ash_ledger") && "余烬账本",
        hasBoon("heat_regulator") && "热控铭文",
        potionTag("金属化") > 0 && `甲片药 ${potionTag("金属化")}`,
        potionTag("格挡") > 0 && `格挡药 ${potionTag("格挡")}`,
      ),
    },
    {
      label: "资源循环",
      score:
        tag("抽牌") * 2 +
        tag("能量") * 2 +
        tag("回收") * 2 +
        tag("连锁") * 2 +
        tag("过载") * 2 +
        (hasBoon("reserve_battery") ? 2 : 0) +
        (hasBoon("recovery_mantra") ? 2 : 0) +
        (hasBoon("scavenger_kit") ? 2 : 0) +
        (hasBoon("field_protocol") ? 2 : 0) +
        (hasBoon("triage_doctrine") ? 2 : 0) +
        (hasBoon("ash_ledger") ? 1 : 0) +
        (hasBoon("rhythm_meter") ? 1 : 0) +
        (hasBoon("chain_manual") ? 3 : 0) +
        (hasBoon("heat_regulator") ? 1 : 0) +
        (hasBoon("potion_catalyst") ? 2 : 0) +
        (hasBoon("field_alchemy") ? 1 : 0) +
        (hasRelic("pocket_watch") ? 2 : 0) +
        (hasRelic("echo_bell") ? 2 : 0) +
        (hasRelic("alchemy_stone") ? 2 : 0) +
        potionTag("抽牌") +
        potionTag("能量") +
        potionTag("回收") * 2,
      detail: detail(
        tag("抽牌") > 0 && `抽牌 ${tag("抽牌")}`,
        tag("能量") > 0 && `能量 ${tag("能量")}`,
        tag("回收") > 0 && `回收 ${tag("回收")}`,
        tag("连锁") > 0 && `连锁 ${tag("连锁")}`,
        tag("过载") > 0 && `过载 ${tag("过载")}`,
        hasBoon("scavenger_kit") && "开局回收",
        hasBoon("field_protocol") && "战地协议",
        hasBoon("triage_doctrine") && "战伤教范",
        hasBoon("ash_ledger") && "余烬账本",
        hasBoon("rhythm_meter") && "随身节拍器",
        hasBoon("chain_manual") && "连锁手册",
        hasBoon("heat_regulator") && "热控铭文",
        hasBoon("potion_catalyst") && "药水蓄能",
        hasRelic("echo_bell") && "回声铃",
        hasRelic("alchemy_stone") && "药水抽牌",
        hasRelic("pocket_watch") && "怀表节奏",
      ),
    },
    {
      label: "净化压缩",
      score:
        tag("净化") * 2 +
        tag("消耗堆") * 2 +
        tag("散热") * 2 +
        tag("蓄能") +
        Math.min(4, summary.typeCounts.Status) +
        (hasBoon("armory_drill") ? 1 : 0) +
        (hasBoon("triage_doctrine") ? 3 : 0) +
        (hasBoon("ash_ledger") ? 2 : 0) +
        (hasBoon("heat_regulator") ? 2 : 0) +
        potionTag("净化"),
      detail: detail(
        tag("净化") > 0 && `净化 ${tag("净化")}`,
        tag("消耗堆") > 0 && `消耗堆 ${tag("消耗堆")}`,
        tag("散热") > 0 && `散热 ${tag("散热")}`,
        summary.typeCounts.Status > 0 && `状态 ${summary.typeCounts.Status}`,
        hasBoon("triage_doctrine") && "战伤教范",
        hasBoon("heat_regulator") && "热控铭文",
        potionTag("净化") > 0 && `净化药 ${potionTag("净化")}`,
      ),
    },
  ];

  const activeSignals = signals
    .filter((item) => item.score > 1)
    .sort((a, b) => b.score - a.score || a.label.localeCompare(b.label, "zh-Hans"))
    .slice(0, 3);

  return activeSignals.length > 0
    ? activeSignals
    : [
        {
          label: "均衡过渡",
          score: 1,
          detail: "基础牌组 · 等待核心组件",
        },
      ];
}

function buildDeckHints(
  total: number,
  typeCounts: Record<CardType, number>,
  tagCounts: Map<string, number>,
  avgCost: number,
): string[] {
  const hints: string[] = [];
  const blockDensity = (tagCounts.get("格挡") ?? 0) + (tagCounts.get("金属化") ?? 0) + (tagCounts.get("尖刺") ?? 0);
  const drawDensity = tagCounts.get("抽牌") ?? 0;
  const energyDensity = tagCounts.get("能量") ?? 0;
  const recycleDensity = drawDensity + energyDensity + (tagCounts.get("回收") ?? 0);
  const cleanseDensity = (tagCounts.get("净化") ?? 0) + (tagCounts.get("消耗堆") ?? 0);

  if (total >= 10 && blockDensity < Math.max(3, Math.floor(total * 0.22))) {
    hints.push("防御偏薄");
  }
  if (total >= 12 && drawDensity === 0) {
    hints.push("缺少抽牌");
  }
  if (total >= 14 && recycleDensity <= 1) {
    hints.push("资源循环弱");
  }
  if (avgCost > 1.45 && energyDensity === 0) {
    hints.push("费用偏重");
  }
  if (typeCounts.Status >= 3 && cleanseDensity === 0) {
    hints.push("污染偏高");
  } else if (typeCounts.Status >= 2 && cleanseDensity > 0) {
    hints.push("状态可转化");
  }
  if (typeCounts.Power >= 3 && typeCounts.Attack <= 4) {
    hints.push("启动偏慢");
  }

  return hints.length > 0 ? hints.slice(0, 3) : ["结构稳定"];
}

function DeckList({ deck }: { deck: CardInstance[] }) {
  const grouped = deck.reduce<Record<string, number>>((acc, card) => {
    const name = cardDisplayName(card);
    acc[name] = (acc[name] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="deck-list">
      {Object.entries(grouped).map(([name, count]) => (
        <div key={name} className="deck-row">
          <span>{name}</span>
          <strong>{count}</strong>
        </div>
      ))}
    </div>
  );
}

function RelicList({ relicIds }: { relicIds: string[] }) {
  return (
    <div className="relic-list">
      {relicIds.map((relicId) => {
        const relic = RELICS[relicId];
        return (
          <div className="relic-row" key={relicId} title={relic?.text ?? "这件遗物来自旧数据。"}>
            <Award size={16} />
            <div>
              <strong>{relic?.name ?? "失效遗物"}</strong>
              <span>{relic?.text ?? "旧数据已失效。"}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function BoonList({ boonIds }: { boonIds: BoonId[] }) {
  return (
    <div className="boon-list">
      {boonIds.length === 0 && <div className="boon-empty">暂无常驻提升</div>}
      {boonIds.map((boonId) => {
        const boon = BOONS[boonId];
        const tags = boonMechanicTags(boonId).slice(0, 3);
        return (
          <div className="boon-row" key={boonId} title={boon?.text ?? "这项常驻提升来自旧数据。"}>
            <Sparkles size={16} />
            <div>
              <strong>{boon?.name ?? "失效常驻"}</strong>
              <span>{boon?.text ?? "旧数据已失效。"}</span>
              <div className="boon-row__tags">
                {tags.map((tag) => (
                  <em key={tag}>{tag}</em>
                ))}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function PowerBadges({ powers }: { powers: PowerMap }) {
  const entries = Object.entries(powers).filter(([, value]) => (value ?? 0) > 0) as [PowerKey, number][];
  if (entries.length === 0) {
    return <div className="power-row is-empty">无状态</div>;
  }

  return (
    <div className="power-row">
      {entries.map(([power, value]) => (
        <span key={power} className={`power power--${power} ${value >= 5 ? "is-stacked" : ""}`} title={POWER_HINTS[power]}>
          {POWER_LABELS[power]} {value}
        </span>
      ))}
    </div>
  );
}

function IntentBadge({ move }: { move: EnemyMove }) {
  return (
    <span className={`intent intent--${move.intent}`} title={intentSummary(move)}>
      {move.intent === "attack" && <Sword size={15} />}
      {move.intent === "defend" && <Shield size={15} />}
      {move.intent === "buff" && <Flame size={15} />}
      {move.intent === "debuff" && <Sparkles size={15} />}
      {move.intent === "mixed" && <Target size={15} />}
      {move.name}
    </span>
  );
}

function intentSummary(move: EnemyMove): string {
  return move.effects
    .map((effect) => {
      if (effect.type === "damage") {
        return `攻击 ${effect.amount}${effect.hits && effect.hits > 1 ? `x${effect.hits}` : ""}`;
      }
      if (effect.type === "block") {
        return `格挡 ${effect.amount}`;
      }
      if (effect.type === "applyPower") {
        return `${POWER_LABELS[effect.power]} ${effect.amount}`;
      }
      if (effect.type === "summon") {
        return `召唤 ${ENEMIES[effect.enemyId]?.name ?? "敌人"}`;
      }
      if (effect.type === "createCard") {
        return `加入 ${CARDS[effect.cardId]?.name ?? "状态牌"}`;
      }
      return "特殊行动";
    })
    .join("，");
}

function HealthBar({ current, max }: { current: number; max: number }) {
  const percent = Math.max(0, Math.min(100, (current / max) * 100));
  return (
    <div className="health">
      <div className="health__track">
        <span style={{ width: `${percent}%` }} />
      </div>
      <strong>
        {Math.max(0, current)}/{max}
      </strong>
    </div>
  );
}

function PileCount({ label, value }: { label: string; value: number }) {
  return (
    <span className="pile-count">
      <BookOpen size={15} />
      {label} {value}
    </span>
  );
}

function PotionBelt({
  potions,
  slots,
  selectedPotionUid,
  onPotionClick,
}: {
  potions: PotionInstance[];
  slots: number;
  selectedPotionUid?: string;
  onPotionClick: (potion: PotionInstance) => void;
}) {
  return (
    <div className="potion-belt">
      {Array.from({ length: slots }).map((_, index) => {
        const potion = potions[index];
        if (!potion) {
          return (
            <span className="potion-slot is-empty" key={`empty-${index}`}>
              <FlaskConical size={15} />
            </span>
          );
        }

        const def = POTIONS[potion.potionId];
        if (!def) {
          return (
            <button
              className={`potion-slot is-empty ${selectedPotionUid === potion.uid ? "is-selected" : ""}`}
              type="button"
              key={potion.uid}
              title="这瓶药水来自旧数据，使用后会被清理。"
              onClick={() => onPotionClick(potion)}
            >
              <FlaskConical size={15} />
              <span>失效</span>
            </button>
          );
        }
        return (
          <button
            className={`potion-slot ${selectedPotionUid === potion.uid ? "is-selected" : ""}`}
            type="button"
            key={potion.uid}
            title={def.text}
            onClick={() => onPotionClick(potion)}
          >
            <FlaskConical size={15} />
            <span>{def.name}</span>
          </button>
        );
      })}
    </div>
  );
}

function PotionInventory({
  potions,
  slots,
  onDiscard,
}: {
  potions: PotionInstance[];
  slots: number;
  onDiscard: (potionUid: string) => void;
}) {
  return (
    <div className="potion-inventory">
      <PanelTitle icon={<FlaskConical size={17} />} title={`药水槽 ${potions.length}/${slots}`} />
      <div className="potion-inventory__grid">
        {Array.from({ length: slots }).map((_, index) => {
          const potion = potions[index];
          if (!potion) {
            return (
              <div className="potion-inventory__slot is-empty" key={`empty-${index}`}>
                <FlaskConical size={15} />
                <span>空槽</span>
              </div>
            );
          }

          const def = POTIONS[potion.potionId];
          if (!def) {
            return (
              <div className="potion-inventory__slot is-empty" key={potion.uid}>
                <FlaskConical size={15} />
                <div>
                  <strong>失效药水</strong>
                  <span>来自旧数据，已无法使用。</span>
                </div>
                <button type="button" title="丢弃药水" onClick={() => onDiscard(potion.uid)}>
                  <Trash2 size={14} />
                </button>
              </div>
            );
          }
          return (
            <div className="potion-inventory__slot" key={potion.uid}>
              <FlaskConical size={15} />
              <div>
                <strong>{def.name}</strong>
                <span>{def.text}</span>
              </div>
              <button type="button" title="丢弃药水" onClick={() => onDiscard(potion.uid)}>
                <Trash2 size={14} />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PackagePotionIcon() {
  return <FlaskConical size={16} />;
}

function StatPill({ icon, label, tone }: { icon: React.ReactNode; label: string; tone: string }) {
  return (
    <span className={`stat-pill stat-pill--${tone}`}>
      {icon}
      {label}
    </span>
  );
}

function PanelTitle({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div className="panel-title">
      {icon}
      <strong>{title}</strong>
    </div>
  );
}

function NodeIcon({ type, size = 18 }: { type: NodeType; size?: number }) {
  if (type === "fight") {
    return <Sword size={size} />;
  }
  if (type === "elite") {
    return <Skull size={size} />;
  }
  if (type === "rest") {
    return <HeartPulse size={size} />;
  }
  if (type === "shop") {
    return <ShoppingBag size={size} />;
  }
  if (type === "event") {
    return <Sparkles size={size} />;
  }
  return <Flame size={size} />;
}

export default App;
