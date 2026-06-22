import { currentLang } from "./index";
import type { NodeType, MapZone, MapRouteKind } from "../game/types";
import { UI_STRINGS } from "./locales/ui-strings";

type Pair = { zh: string; en: string };
const pick = (p: Pair) => (currentLang === "en" ? p.en : p.zh);

// 通用 UI 文案直查：英文模式查 UI_STRINGS，缺则回落原中文。
// 用于把 JSX 里硬编码的中文界面文案运行时切成英文。
export function tr(zh: string): string {
  if (currentLang !== "en") {
    return zh;
  }
  return UI_STRINGS[zh] ?? zh;
}

// —— 节点类型 ——
const NODE_LABEL: Record<NodeType, Pair> = {
  fight: { zh: "战斗", en: "Fight" },
  elite: { zh: "精英", en: "Elite" },
  rest: { zh: "休息", en: "Rest" },
  shop: { zh: "商店", en: "Shop" },
  event: { zh: "事件", en: "Event" },
  boss: { zh: "Boss", en: "Boss" },
};
export const nodeLabel = (t: NodeType) => pick(NODE_LABEL[t]);

const NODE_HINT: Record<NodeType, Pair> = {
  fight: { zh: "普通奖励", en: "Standard reward" },
  elite: { zh: "高风险高收益", en: "High risk, high reward" },
  rest: { zh: "回血/升级/调配", en: "Heal / Upgrade / Brew" },
  shop: { zh: "购买/移除/治疗", en: "Buy / Remove / Heal" },
  event: { zh: "特殊交换", en: "Special exchange" },
  boss: { zh: "终局检定", en: "Final encounter" },
};
export const nodeHint = (t: NodeType) => pick(NODE_HINT[t]);

const ZONE_LABEL: Record<MapZone, Pair> = {
  outer: { zh: "外缘", en: "Outer" },
  wild: { zh: "荒巢", en: "Wilds" },
  forge: { zh: "熔炉", en: "Forge" },
  sanctum: { zh: "圣所", en: "Sanctum" },
  rift: { zh: "裂隙", en: "Rift" },
  heart: { zh: "心核", en: "Heart" },
};
export const zoneLabel = (z: MapZone) => pick(ZONE_LABEL[z]);

const ROUTE_KIND_LABEL: Record<MapRouteKind, Pair> = {
  start: { zh: "入口", en: "Start" },
  branch: { zh: "分叉", en: "Branch" },
  converge: { zh: "汇合", en: "Merge" },
  choke: { zh: "窄口", en: "Choke" },
  crossroad: { zh: "交汇", en: "Crossroad" },
  summit: { zh: "终点", en: "Summit" },
};
export const routeKindLabel = (k: MapRouteKind) => pick(ROUTE_KIND_LABEL[k]);

const ROUTE_KIND_SHORT: Record<MapRouteKind, Pair> = {
  start: { zh: "入", en: "S" },
  branch: { zh: "岔", en: "B" },
  converge: { zh: "汇", en: "M" },
  choke: { zh: "窄", en: "C" },
  crossroad: { zh: "枢", en: "X" },
  summit: { zh: "顶", en: "T" },
};
export const routeKindShort = (k: MapRouteKind) => pick(ROUTE_KIND_SHORT[k]);

// —— 稀有度 ——
const RARITY_LABEL: Record<string, Pair> = {
  starter: { zh: "初始", en: "Starter" },
  common: { zh: "普通", en: "Common" },
  uncommon: { zh: "罕见", en: "Uncommon" },
  rare: { zh: "稀有", en: "Rare" },
  boss: { zh: "首领", en: "Boss" },
  status: { zh: "状态", en: "Status" },
};
export const rarityLabel = (r: string) => pick(RARITY_LABEL[r] ?? { zh: r, en: r });

const BOON_RARITY_LABEL: Record<string, Pair> = {
  common: { zh: "普通", en: "Common" },
  uncommon: { zh: "罕见", en: "Uncommon" },
  rare: { zh: "稀有", en: "Rare" },
};
export const boonRarityLabel = (r: string) => pick(BOON_RARITY_LABEL[r] ?? { zh: r, en: r });

// —— 卡牌类型 ——
const CARD_TYPE_LABEL: Record<string, Pair> = {
  Attack: { zh: "攻击", en: "Attack" },
  Skill: { zh: "技能", en: "Skill" },
  Power: { zh: "能力", en: "Power" },
  Status: { zh: "状态", en: "Status" },
};
export const cardTypeLabel = (t: string) => pick(CARD_TYPE_LABEL[t] ?? { zh: t, en: t });

// —— 行动目标 ——
const ACTION_TARGET_LABEL: Record<string, Pair> = {
  enemy: { zh: "目标：敌人", en: "Target: Enemy" },
  allEnemies: { zh: "目标：全体", en: "Target: All" },
  self: { zh: "目标：自身", en: "Target: Self" },
  none: { zh: "目标：无", en: "Target: None" },
};
export const actionTargetLabel = (t: string) => pick(ACTION_TARGET_LABEL[t] ?? { zh: t, en: t });

// —— power 色调标签 ——
const POWER_TONE_LABEL: Record<string, Pair> = {
  buff: { zh: "增益", en: "Buff" },
  debuff: { zh: "负面", en: "Debuff" },
  engine: { zh: "机制", en: "Engine" },
};
export const powerToneLabel = (t: string) => pick(POWER_TONE_LABEL[t] ?? { zh: t, en: t });

// —— 机制标签（BOON_MECHANIC_TAGS / 其它通用机制词）——
const TAG: Record<string, Pair> = {
  生命: { zh: "生命", en: "HP" },
  回复: { zh: "回复", en: "Heal" },
  药水槽: { zh: "药水槽", en: "Potion Slot" },
  资源: { zh: "资源", en: "Resource" },
  开局: { zh: "开局", en: "Start" },
  格挡: { zh: "格挡", en: "Block" },
  连击: { zh: "连击", en: "Combo" },
  蓄能: { zh: "蓄能", en: "Charge" },
  金属化: { zh: "金属化", en: "Plated Armor" },
  升级: { zh: "升级", en: "Upgrade" },
  牌组: { zh: "牌组", en: "Deck" },
  抽牌: { zh: "抽牌", en: "Draw" },
  电弧: { zh: "电弧", en: "Spark" },
  流血: { zh: "流血", en: "Bleed" },
  力量: { zh: "力量", en: "Strength" },
  中毒: { zh: "中毒", en: "Poison" },
  能量: { zh: "能量", en: "Energy" },
  回收: { zh: "回收", en: "Recover" },
  破绽: { zh: "破绽", en: "Mark" },
  催化: { zh: "催化", en: "Catalyst" },
  连锁: { zh: "连锁", en: "Chain" },
  散热: { zh: "散热", en: "Cool" },
  敏捷: { zh: "敏捷", en: "Dexterity" },
  尖刺: { zh: "尖刺", en: "Thorns" },
  再生: { zh: "再生", en: "Regen" },
  过载: { zh: "过载", en: "Overload" },
  消耗: { zh: "消耗", en: "Exhaust" },
  状态: { zh: "状态", en: "Status" },
  路线: { zh: "路线", en: "Route" },
  污染: { zh: "污染", en: "Pollute" },
  卡牌: { zh: "卡牌", en: "Card" },
  遗物: { zh: "遗物", en: "Relic" },
  移除: { zh: "移除", en: "Remove" },
  生命上限: { zh: "生命上限", en: "Max HP" },
  瓶槽: { zh: "瓶槽", en: "Slot" },
  扣血: { zh: "扣血", en: "Lose HP" },
  花费: { zh: "花费", en: "Cost" },
  金币: { zh: "金币", en: "Gold" },
  共振: { zh: "共振", en: "Resonance" },
  净化: { zh: "净化", en: "Cleanse" },
  消耗堆: { zh: "消耗堆", en: "Exhaust Pile" },
};
export const mechTag = (zh: string) => pick(TAG[zh] ?? { zh, en: zh });
