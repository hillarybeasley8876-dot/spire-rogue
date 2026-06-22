import type { Dict } from "../index";

// UI 层文案（按钮/标签/标题/映射表）。key 命名：ui.<区域>.<元素>
export const uiDict: Dict = {
  // —— 语言切换 ——
  "ui.lang.toggle": { zh: "EN", en: "中文" },
  "ui.lang.name": { zh: "中文", en: "English" },

  // —— 顶栏 ——
  "ui.topbar.brand": { zh: "裂隙尖塔", en: "Rift Spire" },
  "ui.topbar.subtitle": { zh: "程序原型", en: "Prototype" },
  "ui.topbar.backToTitle": { zh: "返回标题", en: "Title" },
  "ui.topbar.hp": { zh: "生命", en: "HP" },
  "ui.topbar.gold": { zh: "金币", en: "Gold" },
  "ui.topbar.deck": { zh: "牌组", en: "Deck" },

  // —— 通用 ——
  "ui.common.act": { zh: "幕", en: "Act" },
  "ui.common.floor": { zh: "层", en: "Floor" },
  "ui.card.afterUpgrade": { zh: "升级后：", en: "Upgraded: " },
  "ui.label.potion": { zh: "药水", en: "Potion" },
  "ui.label.relic": { zh: "遗物", en: "Relic" },
  "ui.label.boon": { zh: "常驻", en: "Boon" },

  // —— 战斗界面 ——
  "ui.combat.encounter": { zh: "遭遇", en: "Encounter" },
  "ui.combat.usePotion": { zh: "使用药水", en: "Use Potion" },
  "ui.combat.role": { zh: "角色", en: "Hero" },
  "ui.combat.wanderer": { zh: "流浪者", en: "Wanderer" },
  "ui.combat.endTurn": { zh: "结束回合", en: "End Turn" },
  "ui.combat.incoming": { zh: "入伤", en: "Incoming" },
  "ui.combat.gap": { zh: "缺口", en: "Gap" },
  "ui.combat.energy": { zh: "能量", en: "Energy" },
  "ui.combat.hand": { zh: "手牌", en: "Hand" },
  "ui.combat.noStatus": { zh: "无状态", en: "No Status" },
  "ui.combat.defeated": { zh: "击破", en: "Lethal" },
};
