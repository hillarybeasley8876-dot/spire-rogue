// 事件（Event）系统的英文映射。
// engine.ts 的 buildEvent 把事件文案以中文硬编码进 state（为兼容旧存档不改 engine），
// 这里按 event.id + option.id 提供英文版；EventScreen 在 EN 模式下查这张表，
// 中文模式直接用 state 里的原文。
//
// disabledReason 是少量复用短语，单独建一张共享表。

export interface EventOptionEN {
  label: string;
  text: string;
}

export interface EventEN {
  title: string;
  text: string;
  options: Record<string, EventOptionEN>;
}

export const EVENT_DISABLED_REASON_EN: Record<string, string> = {
  "生命不足": "Not enough HP",
  "生命已满": "HP already full",
  "金币不足": "Not enough gold",
  "药水槽已满": "Potion slots full",
  "药水槽已达上限": "Potion slots maxed",
  "遗物已满": "Relics full",
  "常驻提升已满": "Boons full",
  "没有药水": "No potions",
  "没有可重塑牌": "No card to reshape",
  "没有可升级牌": "No card to upgrade",
  "最大生命过低": "Max HP too low",
  "条件不足": "Requirements not met",
};

export const EVENTS_EN: Record<string, EventEN> = {
  blood_shrine: {
    title: "Blood Shrine",
    text: "An old spring hums low in the rock. The surface reflects not your face, but the outline of an unfamiliar relic.",
    options: {
      offer: { label: "Offer", text: "Lose 8 HP, gain 1 random relic." },
      sip: { label: "Sip", text: "Heal 12 HP." },
      leave: { label: "Leave", text: "Nothing happens." },
    },
  },
  forgotten_armory: {
    title: "Forgotten Armory",
    text: "Half-buried in ash, the weapons still hold warmth. Nothing here is new, but it all still bites.",
    options: {
      weapon: { label: "Take a Weapon", text: "Gain 1 random upgraded Attack card." },
      armor: { label: "Patch Armor", text: "Max HP +5, heal 5 HP." },
      leave: { label: "Leave", text: "Nothing happens." },
    },
  },
  merchant_cache: {
    title: "Merchant's Cache",
    text: "An unguarded iron box sits behind the old counter, its latch loose, an unfinished upgrade order beside it.",
    options: {
      take_gold: { label: "Take the Gold", text: "Gain gold." },
      invest: { label: "Fill the Order", text: "Pay 40 gold, upgrade 2 random cards." },
      leave: { label: "Leave", text: "Nothing happens." },
    },
  },
  alchemist_table: {
    title: "Cracked Alchemy Table",
    text: "Sediment of many colors lines the flask bottoms. The copper tube is still warm — a small price keeps it working.",
    options: {
      brew: { label: "Brew", text: "Gain 1 random potion." },
      distill: { label: "Blood Distill", text: "Lose 5 HP, gain up to 2 random potions." },
      rack: { label: "Buy a Rack", text: "Pay 55 gold, +1 potion slot permanently." },
      leave: { label: "Leave", text: "Nothing happens." },
    },
  },
  static_obelisk: {
    title: "Static Obelisk",
    text: "A black obelisk hovers in midair, flickering like a broken star chart. As you approach, the edges of your cards begin to glow.",
    options: {
      attune: { label: "Attune", text: "Lose 6 HP, gain boon: Static Tuning." },
      blade: { label: "Pull the Shard", text: "Lose 7 HP, gain Arc Blade+, and add 1 Stun to your deck." },
      bottle: { label: "Collect Charge", text: "Gain 1 Charge potion." },
      leave: { label: "Leave", text: "Nothing happens." },
    },
  },
  living_mirror: {
    title: "Living Mirror Gallery",
    text: "The you in the mirror lags half a beat behind. It reaches for a card, and an identical shadow grows on the glass.",
    options: {
      copy: { label: "Copy the Shade", text: "Lose 6 HP, copy 1 random non-starter card." },
      transmute: { label: "Reshape Reflection", text: "Transmute 1 random non-status card." },
      shatter: { label: "Shatter Reflection", text: "Lose 4 HP, remove 1 random Strike or Defend." },
      leave: { label: "Leave", text: "Nothing happens." },
    },
  },
  storm_chest: {
    title: "Storm Chest",
    text: "A bronze chest is stitched to the ground by arcs. With each opening comes the sound of shuffling cards and clinking vials.",
    options: {
      socket: { label: "Socket Capacitor", text: "Gain Capacitor+. If a slot is free, gain 1 Charge potion." },
      overload: { label: "Overload Core", text: "Lose 6 HP, gain Discharge+, and add 1 Stun to your deck." },
      sell_core: { label: "Strip the Coils", text: "Nothing happens." },
      leave: { label: "Leave", text: "Nothing happens." },
    },
  },
  boon_carver: {
    title: "The Carver",
    text: "A figure in grey cloth sits by the broken bridge, the carving knife casting no shadow. True power, he says, belongs in the bone, not on the card.",
    options: {
      commission: { label: "Commission", text: "Pay 50 gold, gain 1 random boon." },
      blood_mark: { label: "Blood Carving", text: "Lose 8 HP, gain 1 random boon." },
      chip: { label: "Chip Old Marks", text: "Lose 3 HP, remove 1 random Status, Strike or Defend." },
      leave: { label: "Leave", text: "Nothing happens." },
    },
  },
  cursed_archive: {
    title: "Sealed Archive",
    text: "No names on the spines, only rows of wax seals. Each one you break makes the room a little colder.",
    options: {
      read: { label: "Read Forbidden Pages", text: "Gain 1 random Rare card, and add 1 Burn to your deck." },
      erase: { label: "Erase Old Text", text: "Lose 6 HP, remove 1 random card." },
      seal: { label: "Seal the Whispers", text: "Gain 1 random boon, and add 1 Wound to your deck." },
      leave: { label: "Leave", text: "Nothing happens." },
    },
  },
  wandering_trainer: {
    title: "Wandering Trainer",
    text: "A trainer in a worn cloak drives a wooden sword into the ground. She asks not where you came from, only how much strength you have left.",
    options: {
      lesson: { label: "Paid Lesson", text: "Pay 35 gold, upgrade 1 random card." },
      spar: { label: "Spar", text: "Lose 7 HP, gain 1 random upgraded Attack or Skill card." },
      breathe: { label: "Catch Your Breath", text: "Heal 8 HP." },
      leave: { label: "Leave", text: "Nothing happens." },
    },
  },
  quiet_clinic: {
    title: "Quiet Clinic",
    text: "Instruments arrange themselves behind the white cloth. No doctor here — only an empty chart with prices written in.",
    options: {
      cleanse: { label: "Debride", text: "Pay 30 gold, remove 1 random Status card." },
      serum: { label: "Draw Serum", text: "Gain 1 random potion, heal 4 HP." },
      stitch: { label: "Stitch Up", text: "Heal 16 HP." },
      leave: { label: "Leave", text: "Nothing happens." },
    },
  },
  memory_well: {
    title: "Memory Well",
    text: "The water mirrors the cards you just played. Fragments of old battles drift below — reach in for a little power, and a little noise.",
    options: {
      dredge: { label: "Dredge Memory", text: "Pay 35 gold, gain Field Recovery+. If your deck has a Status card, remove 1 at random." },
      echo: { label: "Take the Echo", text: "Lose 5 HP, gain Memory Hook+." },
      siphon: { label: "Siphon the Well", text: "Gain 1 random potion, heal 3 HP." },
      leave: { label: "Leave", text: "Nothing happens." },
    },
  },
  rune_forge: {
    title: "Rune Forge",
    text: "No fire in the hearth, only rings of glowing runes. The anvil asks one resource, then hammers another into your cards.",
    options: {
      etch: { label: "Rune Etching", text: "Pay 45 gold, upgrade 2 random cards." },
      reforge: { label: "Hot Reforge", text: "Lose 6 HP, transmute 1 random non-status card and upgrade it." },
      quench: { label: "Quench Armor", text: "Gain Plated Guard+, and add 1 Burn to your deck." },
      leave: { label: "Leave", text: "Nothing happens." },
    },
  },
  venom_greenhouse: {
    title: "Venom Greenhouse",
    text: "Green tubes crawl across the glass house, venom trickling back down the walls. A good place to give a blade a longer tail.",
    options: {
      coat_blade: { label: "Coating Ritual", text: "Pay 30 gold, gain boon: Blade Oil." },
      distill_venom: { label: "Extract Venom Sac", text: "Gain Venom Stance+, and add 1 Stun to your deck." },
      take_sample: { label: "Take a Sample", text: "Gain a Venom potion and Poison Darts." },
      leave: { label: "Leave", text: "Nothing happens." },
    },
  },
  plated_sanctum: {
    title: "Plated Sanctum",
    text: "A row of thin plates rests on the altar, each engraved with the shape of an old wound. Not pretty, but they wake just before the next blow.",
    options: {
      train_plate: { label: "Plate Drill", text: "Pay 45 gold, gain boon: Plate Training." },
      forge_guard: { label: "Forge a Guard", text: "Lose 4 HP, gain Plated Guard+." },
      patch_armor: { label: "Patch Plates", text: "Heal 10 HP." },
      leave: { label: "Leave", text: "Nothing happens." },
    },
  },
  bottled_spirit: {
    title: "Bottled Spirits",
    text: "A row of bottles hangs in the air, tiny figures tapping the glass beneath the stoppers. They will trade, but only speak the language of potions.",
    options: {
      release: { label: "Release a Spirit", text: "Consume 1 random potion, gain 1 random boon." },
      decant: { label: "Decant Essence", text: "Pay 35 gold, +1 potion slot permanently." },
      stabilize: { label: "Steady the Rack", text: "Nothing happens." },
      leave: { label: "Leave", text: "Nothing happens." },
    },
  },
  path_scout: {
    title: "Path Scout",
    text: "A scout sketches the next floor's paths on the back of her shield. She can't turn the spire, but she can rewrite the nature of one fork.",
    options: {
      chart_rest: { label: "Chart a Safe Route", text: "Pay 30 gold, turn one next-floor node into a Rest site." },
      mark_elite: { label: "Mark Dangerous Prey", text: "Lose 5 HP, turn one next-floor node into an Elite." },
      take_rations: { label: "Take the Supplies", text: "Nothing happens." },
      leave: { label: "Leave", text: "Nothing happens." },
    },
  },
  flask_gambit: {
    title: "Flask Gambit",
    text: "Three clear flask-cases spin on the table. Each can turn a potion into something else, but none writes the price on the front.",
    options: {
      transfuse: { label: "Transfuse", text: "Consume 1 random potion, gain 1 random boon." },
      overbrew: { label: "Overbrew", text: "Pay 28 gold, refill empty potion slots." },
      crack_case: { label: "Crack a Case", text: "+1 potion slot permanently, and add 1 Slime to your deck." },
      leave: { label: "Leave", text: "Nothing happens." },
    },
  },
  relic_tinker: {
    title: "Relic Tinker",
    text: "The tinker breaks relics down into gears, bone shards and old prayers. A good relic, she says, fears no rebuild — only your reluctance to pay.",
    options: {
      tune: { label: "Calibrate Relic", text: "Pay 55 gold, gain 1 random relic, and upgrade 1 random card." },
      pawn: { label: "Pawn a Relic", text: "Upgrade 1 random card, heal 6 HP." },
      polish: { label: "Polish Gear", text: "Nothing happens." },
      leave: { label: "Leave", text: "Nothing happens." },
    },
  },
  fracture_gate: {
    title: "Fracture Gate",
    text: "Beyond the door is not a room, but a wound that hasn't happened yet. Cracks crawl toward your deck, seeking the first card willing to open.",
    options: {
      step_through: { label: "Step Through", text: "Lose 9 HP, gain Rift Lunge+. If a slot is free, gain 1 Fracture potion." },
      map_cracks: { label: "Trace the Cracks", text: "Pay 35 gold, gain boon: Weakpoint Chart." },
      seal_gate: { label: "Seal the Gate", text: "Heal 10 HP, and add 1 Stun to your deck." },
      leave: { label: "Leave", text: "Nothing happens." },
    },
  },
  catalyst_lab: {
    title: "Catalyst Lab",
    text: "Poison, blood and fracture chase each other in the dishes. The formula on the bench has no ending, only a multiplication sign that keeps deepening.",
    options: {
      learn_pattern: { label: "Record the Pattern", text: "Pay 40 gold, gain boon: Catalyst Training." },
      take_vial: { label: "Take a Vial", text: "Gain 1 Catalyst potion." },
      record_formula: { label: "Copy the Formula", text: "Lose 6 HP, gain Toxic Catalyst+, and add 1 Burn to your deck." },
      leave: { label: "Leave", text: "Nothing happens." },
    },
  },
  coil_workbench: {
    title: "Coil Workbench",
    text: "A bench crammed with copper wire, plates and small capacitors. Different drawers hold different answers: cards, potions, or carvings that last into the next fight.",
    options: {
      plate_cache: { label: "Take the Casing", text: "Pay 35 gold, gain Alloy Shell+. If a slot is free, gain 1 Alloy potion." },
      wind_coil: { label: "Wind Overload Coil", text: "Lose 5 HP, gain Coil Whip+. If a slot is free, gain 1 Overload potion." },
      temper_shell: { label: "Temper the Shell", text: "Pay 45 gold, gain boon: Tempered Shell." },
      leave: { label: "Leave", text: "Nothing happens." },
    },
  },
  black_contract: {
    title: "Black Contract",
    text: "A faceless broker spreads three contracts on the crate lid. The ink shrinks into fine print: gold buys relics, blood buys cards, trouble buys a whole sack of supplies.",
    options: {
      underwrite: { label: "Underwrite a Relic", text: "Pay 55 gold, gain 1 random relic." },
      blood_clause: { label: "Sign in Blood", text: "Max HP -6, gain 1 random Rare card, and upgrade 1 random card." },
      contraband: { label: "Take Contraband", text: "Gain an Alloy Shell and up to 2 random potions, and add 1 Wound to your deck." },
      leave: { label: "Leave", text: "Nothing happens." },
    },
  },
  strategy_table: {
    title: "Strategy Table",
    text: "Three colored flags stand on the sand table: one marked deck tempo, one holding a fast-acting draught, one carved with a protocol you can carry into the next fight.",
    options: {
      manual: { label: "Pocket the Manual", text: "Pay 32 gold, gain Field Plan+." },
      kit: { label: "Take the Tactical Draught", text: "Pay 24 gold, gain 1 Tactical potion." },
      protocol: { label: "Sign the Protocol", text: "Pay 48 gold, gain boon: Field Protocol." },
      leave: { label: "Leave", text: "Nothing happens." },
    },
  },
  old_warbanner: {
    title: "Old War Banner",
    text: "A tattered banner stands on the stone steps, still rippling to a horn that isn't there. It leaves three things: battle tempo on cards, a stimulant in a vial, and drills carved into bone.",
    options: {
      take_banner: { label: "Take the Banner", text: "Pay 34 gold, gain Battle Tempo+." },
      rally_dose: { label: "Drink the Ration", text: "Pay 24 gold, gain 1 Tactical potion." },
      learn_drill: { label: "Memorize the Drill", text: "Pay 48 gold, gain boon: Banner Drill." },
      leave: { label: "Leave", text: "Nothing happens." },
    },
  },
  field_infirmary: {
    title: "Field Infirmary",
    text: "No steady cot in the tent, only boards covered in wound-care steps. The medic splits the cost three ways: card, potion, standing doctrine.",
    options: {
      manual: { label: "Take the Triage Manual", text: "Pay 30 gold, gain Trauma Recovery+." },
      salve: { label: "Take the Salve", text: "Pay 24 gold, gain 1 Debride potion." },
      doctrine: { label: "Note the Doctrine", text: "Pay 50 gold, gain boon: Triage Doctrine." },
      leave: { label: "Leave", text: "Nothing happens." },
    },
  },
  ash_archive: {
    title: "Ash Archive",
    text: "A stack of charred ledgers still smolders. Each page records how consumed cards became wards, draughts, or the opening of the next fight.",
    options: {
      ward: { label: "Find the Ward Page", text: "Pay 32 gold, gain Ember Ward+." },
      bottle: { label: "Bottle the Ash", text: "Pay 24 gold, gain 1 Ember potion." },
      ledger: { label: "Copy the Ledger", text: "Pay 50 gold, gain boon: Ash Ledger." },
      leave: { label: "Leave", text: "Nothing happens." },
    },
  },
  rhythm_metronome: {
    title: "Offbeat Metronome",
    text: "A brass metronome sways on the stone table. Each swing seems to pull a combo apart, then tuck the echo into a charge coil.",
    options: {
      calibrate: { label: "Calibrate the Beat", text: "Pay 28 gold, gain Tempo Battery+." },
      drink: { label: "Drink the Tempo Dose", text: "Pay 22 gold, gain 1 Tempo potion." },
      meter: { label: "Take the Metronome", text: "Pay 48 gold, gain boon: Pocket Metronome." },
      leave: { label: "Leave", text: "Nothing happens." },
    },
  },
  chain_hourglass: {
    title: "Chain Hourglass",
    text: "The sand doesn't fall — it lights up cell by cell with the cards you play this turn. Three stacks on the table: ward pages, short draughts, and a manual that remembers your third card.",
    options: {
      bind: { label: "Bind the Ward Pages", text: "Pay 30 gold, gain Chain Ward+." },
      dose: { label: "Drink the Chain Dose", text: "Pay 24 gold, gain 1 Chain potion." },
      manual: { label: "Copy the Manual", text: "Pay 50 gold, gain boon: Chain Manual." },
      leave: { label: "Leave", text: "Nothing happens." },
    },
  },
  cooling_station: {
    title: "Cooling Station",
    text: "An abandoned cooler still hums, blue-white draughts drifting in the tank. The wall inscription splits Overload three ways: pull the heat sink, bottle the coolant, or learn to vent heat early.",
    options: {
      plate: { label: "Pull the Heat Sink", text: "Pay 32 gold, gain Heat Sink+." },
      coolant: { label: "Bottle the Coolant", text: "Pay 24 gold, gain 1 Coolant potion." },
      regulator: { label: "Copy the Inscription", text: "Pay 52 gold, gain boon: Heat Regulator." },
      leave: { label: "Leave", text: "Nothing happens." },
    },
  },
  triage_station: {
    title: "Triage Supply Station",
    text: "Three supply crates line the path: one stuffed with card sleeves, one rattling with potions, one stamped with a warm sigil. Each crate accepts only one kind of price.",
    options: {
      card_crate: { label: "Open the Card Crate", text: "Pay 25 gold, gain 1 random non-Rare card, possibly upgraded." },
      potion_crate: { label: "Open the Potion Crate", text: "Pay 20 gold, gain up to 2 random potions." },
      boon_token: { label: "Crush the Token", text: "Lose 5 HP, gain 1 random boon." },
      leave: { label: "Leave", text: "Nothing happens." },
    },
  },
  crystal_garden: {
    title: "Crystal Garden",
    text: "Translucent roots reach from the rock seams, as if listening to your heartbeat. Each cluster of crystal flowers refracts a different path.",
    options: {
      harvest: { label: "Harvest a Cluster", text: "Gain gold and 1 Poison Dart." },
      rest: { label: "Rest Nearby", text: "Heal 14 HP." },
      root: { label: "Swallow a Root Crystal", text: "Max HP +3, heal 3 HP." },
      leave: { label: "Leave", text: "Nothing happens." },
    },
  },
};
