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
