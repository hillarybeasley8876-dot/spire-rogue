/**
 * 战斗系统审计脚本（机械层）
 * 用 tsx 直接 import 真实数据对象，做卡牌/敌人/遗物/药水/恩赐的交叉核对。
 * 运行: npm run audit
 *
 * 检查项：
 *  - effect 引用的 cardId / enemyId 是否存在
 *  - 卡牌文本中的数字是否与 effect 数值一致（粗核对）
 *  - 升级牌相对基础牌是否真的有提升
 *  - power 流派的「施加 vs 消耗/获益」闭环（找断头机制）
 *  - 敌人招式可达性（pattern 引用的 move 是否存在；weight=0 的不可达招式）
 *  - 引擎实现了但无人使用的孤儿 effect 类型
 *  - cost / 数值异常（负数、NaN）
 */
import {
  CARDS,
  ENEMIES,
  RELICS,
  POTIONS,
  BOONS,
} from "../src/game/data";
import type {
  CardDef,
  CardLevel,
  CardEffect,
  EnemyEffect,
  PowerKey,
} from "../src/game/types";

type Finding = { sev: "ERR" | "WARN" | "INFO"; area: string; id: string; msg: string };
const findings: Finding[] = [];
const add = (sev: Finding["sev"], area: string, id: string, msg: string) =>
  findings.push({ sev, area, id, msg });

const cardIds = new Set(Object.keys(CARDS));
const enemyIds = new Set(Object.keys(ENEMIES));

// ---------- 1. 引擎已实现的 effect 类型（手工同步自 engine.ts）----------
const ENGINE_CARD_EFFECTS = new Set([
  "damage", "damageFromBlock", "damagePerAttackPlayed", "damagePerPower",
  "spendPowerDamage", "block", "blockPerPower", "blockPerExhaustedCard",
  "gainPowerPerPower", "gainPowerPerCardPlayed", "cleansePower", "applyPower",
  "amplifyPower", "draw", "gainEnergy", "heal", "cleanseDebuffs", "exhaustCards",
  "returnFromDiscard", "createCard",
]);
const ENGINE_ENEMY_EFFECTS = new Set(["damage", "block", "applyPower", "createCard", "summon"]);

// ---------- 2. 收集 effect 类型使用情况 ----------
const usedCardEffectTypes = new Set<string>();
const usedEnemyEffectTypes = new Set<string>();

// 流派闭环统计：每个 power 被「施加给自己 / 施加给敌人 / 被消耗或获益」的次数
const powerApplySelf: Record<string, number> = {};
const powerApplyEnemy: Record<string, number> = {};
const powerConsumeOrScale: Record<string, number> = {};
const bump = (m: Record<string, number>, k: string) => (m[k] = (m[k] ?? 0) + 1);

function scanCardEffect(cardId: string, level: string, eff: CardEffect) {
  usedCardEffectTypes.add(eff.type);
  if (!ENGINE_CARD_EFFECTS.has(eff.type)) {
    add("ERR", "card", cardId, `[${level}] effect 类型 "${eff.type}" 引擎未实现`);
  }
  switch (eff.type) {
    case "applyPower":
      if (eff.target === "self") bump(powerApplySelf, eff.power);
      else bump(powerApplyEnemy, eff.power);
      break;
    case "damagePerPower":
    case "spendPowerDamage":
    case "blockPerPower":
      bump(powerConsumeOrScale, eff.power);
      break;
    case "gainPowerPerPower":
      bump(powerConsumeOrScale, eff.sourcePower);
      bump(powerApplySelf, eff.gainedPower);
      break;
    case "gainPowerPerCardPlayed":
      bump(powerApplySelf, eff.power);
      break;
    case "amplifyPower":
      if (eff.target === "self") bump(powerApplySelf, eff.power);
      bump(powerConsumeOrScale, eff.power);
      break;
    case "cleansePower":
      bump(powerConsumeOrScale, eff.power);
      break;
    case "createCard":
      if (!cardIds.has(eff.cardId))
        add("ERR", "card", cardId, `[${level}] createCard 引用了不存在的卡 "${eff.cardId}"`);
      break;
  }
  // 数值健全性
  const anyEff = eff as Record<string, unknown>;
  for (const key of ["amount", "multiplier", "hits"]) {
    const v = anyEff[key];
    if (typeof v === "number" && (Number.isNaN(v) || v < 0))
      add("WARN", "card", cardId, `[${level}] ${eff.type}.${key} = ${v} 异常`);
  }
}

// ---------- 3. 卡牌审计 ----------
function digitsIn(text: string): number[] {
  return [...text.matchAll(/\d+/g)].map((m) => Number(m[0]));
}

function auditCardLevel(card: CardDef, which: "base" | "upgraded", lvl: CardLevel) {
  for (const eff of lvl.effects) scanCardEffect(card.id, which, eff);

  if (lvl.cost < -1) add("WARN", "card", card.id, `[${which}] cost=${lvl.cost} 异常`);
  if (!lvl.effects.length && !lvl.unplayable && !lvl.endTurnDamage)
    add("WARN", "card", card.id, `[${which}] 没有任何 effect 且非 unplayable`);

  // 文本/数值一致性：把 effect 里出现的关键数字与文本数字做集合核对
  const effNums: number[] = [];
  for (const eff of lvl.effects) {
    const a = eff as Record<string, unknown>;
    if (typeof a.amount === "number") {
      const hits = typeof a.hits === "number" ? a.hits : 1;
      effNums.push(a.amount as number);
      if (hits > 1) effNums.push(hits);
    }
  }
  const textNums = digitsIn(lvl.text);
  for (const n of effNums) {
    if (n > 1 && !textNums.includes(n)) {
      add("INFO", "card-text", card.id, `[${which}] effect 数值 ${n} 未在文本"${lvl.text}"中出现`);
    }
  }
}

for (const card of Object.values(CARDS)) {
  auditCardLevel(card, "base", card.base);
  auditCardLevel(card, "upgraded", card.upgraded);

  // 升级是否真有提升（cost 降低 或 文本不同 或 数值变大）
  const sameText = card.base.text === card.upgraded.text;
  const sameCost = card.base.cost === card.upgraded.cost;
  const baseSum = card.base.effects.reduce((s, e) => s + ((e as any).amount ?? 0), 0);
  const upSum = card.upgraded.effects.reduce((s, e) => s + ((e as any).amount ?? 0), 0);
  if (sameText && sameCost && baseSum === upSum && card.rarity !== "status")
    add("WARN", "card", card.id, `升级与基础完全相同（无提升）`);
}

// ---------- 4. 敌人审计 ----------
for (const enemy of Object.values(ENEMIES)) {
  const moveIds = new Set(enemy.moves.map((m) => m.id));
  if (!enemy.moves.length) add("ERR", "enemy", enemy.id, "没有任何招式");
  if (enemy.maxHp[0] > enemy.maxHp[1])
    add("ERR", "enemy", enemy.id, `maxHp 区间反了 [${enemy.maxHp}]`);

  // pattern 引用的 move 必须存在
  for (const pid of enemy.pattern ?? []) {
    if (!moveIds.has(pid))
      add("ERR", "enemy", enemy.id, `pattern 引用了不存在的招式 "${pid}"`);
  }
  // 无 pattern 时，weight<=0 的招式不可达
  if (!enemy.pattern) {
    for (const m of enemy.moves) {
      if (m.weight <= 0)
        add("WARN", "enemy", enemy.id, `招式 "${m.id}" weight=${m.weight}，随机模式下不可达`);
    }
  }
  // effect 类型核对 + summon 引用
  for (const m of enemy.moves) {
    for (const eff of m.effects as EnemyEffect[]) {
      usedEnemyEffectTypes.add(eff.type);
      if (!ENGINE_ENEMY_EFFECTS.has(eff.type))
        add("ERR", "enemy", enemy.id, `招式 "${m.id}" effect 类型 "${eff.type}" 引擎未实现`);
      if (eff.type === "summon" && !enemyIds.has(eff.enemyId))
        add("ERR", "enemy", enemy.id, `召唤了不存在的敌人 "${eff.enemyId}"`);
      if (eff.type === "createCard" && !cardIds.has(eff.cardId))
        add("ERR", "enemy", enemy.id, `生成了不存在的卡 "${eff.cardId}"`);
      // intent 与 effect 粗一致性
      if (eff.type === "damage" && m.intent !== "attack" && m.intent !== "mixed")
        add("INFO", "enemy", enemy.id, `招式 "${m.id}" 含伤害但 intent=${m.intent}`);
    }
  }
}

// ---------- 5. 流派闭环报告 ----------
const ALL_POWERS: PowerKey[] = [
  "strength", "dexterity", "vulnerable", "weak", "frail", "poison", "regen",
  "thorns", "ritual", "bleed", "mark", "platedArmor", "combo", "charge", "spark",
];
// 引擎里有被动触发（不依赖卡显式消耗）的 power
const ENGINE_PASSIVE = new Set(["poison", "regen", "thorns", "bleed", "spark", "platedArmor", "ritual", "mark", "strength", "dexterity", "vulnerable", "weak", "frail"]);

console.log("\n========== 战斗系统机械审计 ==========\n");

console.log("【流派闭环：玩家可施加(self) / 施加敌人 / 被消耗或缩放】");
for (const p of ALL_POWERS) {
  const s = powerApplySelf[p] ?? 0;
  const e = powerApplyEnemy[p] ?? 0;
  const c = powerConsumeOrScale[p] ?? 0;
  const passive = ENGINE_PASSIVE.has(p) ? "✓被动" : "";
  let note = "";
  if (s > 0 && c === 0 && !passive)
    note = " ⚠ 玩家能获得但无卡消耗/缩放它（可能断头）";
  if (s === 0 && e === 0 && c === 0)
    note = " ⚠ 没有任何卡涉及此 power";
  console.log(
    `  ${p.padEnd(12)} self:${String(s).padStart(2)} enemy:${String(e).padStart(2)} scale/consume:${String(c).padStart(2)} ${passive}${note}`,
  );
}

// ---------- 6. 孤儿 effect 类型 ----------
console.log("\n【孤儿 effect：引擎实现但无卡/敌人使用】");
const orphanCard = [...ENGINE_CARD_EFFECTS].filter((t) => !usedCardEffectTypes.has(t));
const orphanEnemy = [...ENGINE_ENEMY_EFFECTS].filter((t) => !usedEnemyEffectTypes.has(t));
console.log("  卡牌侧:", orphanCard.length ? orphanCard.join(", ") : "（无）");
console.log("  敌人侧:", orphanEnemy.length ? orphanEnemy.join(", ") : "（无）");

// ---------- 7. 内容计数 ----------
console.log("\n【内容规模】");
console.log(`  卡牌 ${Object.keys(CARDS).length} / 敌人 ${Object.keys(ENEMIES).length} / 遗物 ${Object.keys(RELICS).length} / 药水 ${Object.keys(POTIONS).length} / 恩赐 ${Object.keys(BOONS).length}`);

// ---------- 8. Findings 输出 ----------
const order = { ERR: 0, WARN: 1, INFO: 2 } as const;
findings.sort((a, b) => order[a.sev] - order[b.sev] || a.area.localeCompare(b.area) || a.id.localeCompare(b.id));
const errs = findings.filter((f) => f.sev === "ERR");
const warns = findings.filter((f) => f.sev === "WARN");
const infos = findings.filter((f) => f.sev === "INFO");

console.log(`\n【问题清单】 ERR:${errs.length} WARN:${warns.length} INFO:${infos.length}`);
for (const f of findings) {
  console.log(`  [${f.sev}] (${f.area}) ${f.id}: ${f.msg}`);
}

console.log("\n======================================");
if (errs.length) {
  console.log(`审计发现 ${errs.length} 个错误级问题`);
  process.exitCode = 1;
} else {
  console.log("无错误级问题");
}
