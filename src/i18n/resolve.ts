import type { Lang } from "./index";
import { currentLang } from "./index";
import { DIFFICULTIES, CARDS, ENEMIES, RELICS, POTIONS, BOONS, POWER_LABELS, POWER_HINTS } from "../game/data";
import type { DifficultyKey, PowerKey, Rarity } from "../game/types";
import {
  cardNameEn,
  cardTextEn,
  enemyNameEn,
  moveNameEn,
  relicEn,
  potionEn,
  boonEn,
  difficultyEn,
  powerLabelEn,
  powerHintEn,
} from "./locales/content.en";

// 内容数据本地化：state 里只存 id，渲染期按当前语言解析文案。
// zh 来自 data.ts；en 来自 locales/content.en.ts。缺 en 回落 zh。

export function getLocalizedDifficulty(id: DifficultyKey, lang: Lang) {
  const zh = DIFFICULTIES[id];
  if (lang === "en") {
    const en = difficultyEn[id];
    if (en) {
      return { ...zh, name: en.name, tagline: en.tagline, text: en.text };
    }
  }
  return zh;
}

export function getLocalizedCardName(cardId: string, lang: Lang): string {
  if (lang === "en" && cardNameEn[cardId]) {
    return cardNameEn[cardId];
  }
  return CARDS[cardId]?.name ?? cardId;
}

export function getLocalizedCardText(cardId: string, upgraded: boolean, lang: Lang): string {
  if (lang === "en" && cardTextEn[cardId]) {
    return cardTextEn[cardId][upgraded ? 1 : 0];
  }
  const c = CARDS[cardId];
  if (!c) {
    return "";
  }
  return (upgraded ? c.upgraded : c.base).text;
}

export function getLocalizedEnemyName(enemyId: string, lang: Lang): string {
  if (lang === "en" && enemyNameEn[enemyId]) {
    return enemyNameEn[enemyId];
  }
  return ENEMIES[enemyId]?.name ?? enemyId;
}

export function getLocalizedMoveName(enemyId: string, moveId: string, lang: Lang): string {
  if (lang === "en") {
    const key = `${enemyId}.${moveId}`;
    if (moveNameEn[key]) {
      return moveNameEn[key];
    }
  }
  const e = ENEMIES[enemyId];
  const move = e?.moves.find((m) => m.id === moveId);
  return move?.name ?? moveId;
}

export function getLocalizedRelic(relicId: string, lang: Lang): { name: string; text: string; rarity: Rarity } {
  const r = RELICS[relicId];
  const rarity = (r?.rarity ?? "common") as Rarity;
  if (lang === "en" && relicEn[relicId]) {
    return { ...relicEn[relicId], rarity };
  }
  return { name: r?.name ?? relicId, text: r?.text ?? "", rarity };
}

export function getLocalizedPotion(potionId: string, lang: Lang): { name: string; text: string } {
  if (lang === "en" && potionEn[potionId]) {
    return potionEn[potionId];
  }
  const p = POTIONS[potionId];
  return { name: p?.name ?? potionId, text: p?.text ?? "" };
}

export function getLocalizedBoon(boonId: string, lang: Lang): { name: string; text: string; rarity: "common" | "uncommon" | "rare" } {
  const b = BOONS[boonId as keyof typeof BOONS];
  const rarity = (b?.rarity ?? "common") as "common" | "uncommon" | "rare";
  if (lang === "en" && boonEn[boonId]) {
    return { ...boonEn[boonId], rarity };
  }
  return { name: b?.name ?? boonId, text: b?.text ?? "", rarity };
}

export function getLocalizedPowerLabel(power: PowerKey, lang: Lang): string {
  if (lang === "en" && powerLabelEn[power]) {
    return powerLabelEn[power];
  }
  return POWER_LABELS[power];
}

export function getLocalizedPowerHint(power: PowerKey, lang: Lang): string {
  if (lang === "en" && powerHintEn[power]) {
    return powerHintEn[power];
  }
  return POWER_HINTS[power];
}

// —— 便捷版（读模块级 currentLang）：App.tsx 直接调用，无需到处传 lang ——
export const cardName = (id: string) => getLocalizedCardName(id, currentLang);
export const cardText = (id: string, upgraded: boolean) => getLocalizedCardText(id, upgraded, currentLang);
export const enemyName = (id: string) => getLocalizedEnemyName(id, currentLang);
export const moveName = (enemyId: string, moveId: string) => getLocalizedMoveName(enemyId, moveId, currentLang);
export const relicInfo = (id: string) => getLocalizedRelic(id, currentLang);
export const potionInfo = (id: string) => getLocalizedPotion(id, currentLang);
export const boonInfo = (id: string) => getLocalizedBoon(id, currentLang);
export const powerLabel = (p: PowerKey) => getLocalizedPowerLabel(p, currentLang);
export const powerHint = (p: PowerKey) => getLocalizedPowerHint(p, currentLang);
export const difficultyInfo = (id: DifficultyKey) => getLocalizedDifficulty(id, currentLang);

// —— 事件（Event）本地化 ——
// state 里的 event.title/text/options 是中文（engine 硬编码，为兼容旧存档不改）。
// EN 模式按 event.id + option.id 查 EVENTS_EN；缺失则回落中文原文。
import { EVENTS_EN, EVENT_DISABLED_REASON_EN } from "./locales/events.en";

export function localizedEventTitle(eventId: string, zhTitle: string): string {
  if (currentLang === "en") return EVENTS_EN[eventId]?.title ?? zhTitle;
  return zhTitle;
}

export function localizedEventText(eventId: string, zhText: string): string {
  if (currentLang === "en") return EVENTS_EN[eventId]?.text ?? zhText;
  return zhText;
}

export function localizedEventOption(
  eventId: string,
  optionId: string,
  zh: { label: string; text: string },
): { label: string; text: string } {
  if (currentLang === "en") {
    const en = EVENTS_EN[eventId]?.options[optionId];
    if (en) return en;
  }
  return zh;
}

export function localizedDisabledReason(zhReason?: string): string | undefined {
  if (!zhReason) return zhReason;
  if (currentLang === "en") return EVENT_DISABLED_REASON_EN[zhReason] ?? zhReason;
  return zhReason;
}

// —— 动作结果 toast / 结算页 message 本地化 ——
// engine 把 state.message 拼成中文（带 ${} 插值 + 内嵌中文物品名）。
// 这里在渲染期把整条消息按模板翻成英文；匹配不上回落原文（零回归）。
import { MESSAGE_TEMPLATES } from "./locales/messages.en";

// 反向名称表：中文物品名 -> 英文名（卡 / 遗物 / 药水 / 常驻），懒构建一次。
let NAME_EN: Map<string, string> | null = null;
function buildNameMap(): Map<string, string> {
  const map = new Map<string, string>();
  for (const id of Object.keys(CARDS)) {
    const zh = (CARDS as Record<string, { name: string }>)[id]?.name;
    const en = getLocalizedCardName(id, "en");
    if (zh && en) map.set(zh, en);
  }
  for (const id of Object.keys(RELICS)) {
    const zh = (RELICS as Record<string, { name: string }>)[id]?.name;
    const en = getLocalizedRelic(id, "en")?.name;
    if (zh && en) map.set(zh, en);
  }
  for (const id of Object.keys(POTIONS)) {
    const zh = (POTIONS as Record<string, { name: string }>)[id]?.name;
    const en = getLocalizedPotion(id, "en")?.name;
    if (zh && en) map.set(zh, en);
  }
  for (const id of Object.keys(BOONS)) {
    const zh = (BOONS as Record<string, { name: string }>)[id]?.name;
    const en = getLocalizedBoon(id, "en")?.name;
    if (zh && en) map.set(zh, en);
  }
  return map;
}

function relocalizeName(captured: string): string {
  if (!NAME_EN) NAME_EN = buildNameMap();
  if (NAME_EN.has(captured)) return NAME_EN.get(captured)!;
  // 处理升级标记后缀 "+"（如 "火球+"）
  if (captured.endsWith("+") && NAME_EN.has(captured.slice(0, -1))) {
    return NAME_EN.get(captured.slice(0, -1))! + "+";
  }
  return captured; // 数字 / 未知 / 已是英文 —— 原样透传
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// 预编译模板：把相邻 {}{} 合并成单占位，按 zh 字面长度降序（更具体的先匹配）。
const COMPILED_MESSAGES = MESSAGE_TEMPLATES.map(([zh, en]) => {
  const zhMerged = zh.replace(/(\{\})+/g, "{}");
  const enMerged = en.replace(/(\{\})+/g, "{}");
  const literals = zhMerged.split("{}");
  const pattern = "^" + literals.map(escapeRegex).join("(.+?)") + "$";
  return { re: new RegExp(pattern), en: enMerged, slots: literals.length - 1 };
}).sort((a, b) => b.re.source.length - a.re.source.length);

export function translateMessage(zh?: string): string | undefined {
  if (!zh || currentLang !== "en") return zh;
  for (const t of COMPILED_MESSAGES) {
    const m = zh.match(t.re);
    if (!m) continue;
    const caps = m.slice(1).map(relocalizeName);
    let i = 0;
    return t.en.replace(/\{\}/g, () => caps[i++] ?? "");
  }
  return zh; // 没匹配上：回落中文，保证不比现状差
}
