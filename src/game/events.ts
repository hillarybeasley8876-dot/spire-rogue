export const EVENT_IDS = [
  "blood_shrine",
  "forgotten_armory",
  "merchant_cache",
  "alchemist_table",
  "static_obelisk",
  "storm_chest",
  "living_mirror",
  "boon_carver",
  "cursed_archive",
  "wandering_trainer",
  "crystal_garden",
  "quiet_clinic",
  "memory_well",
  "rune_forge",
  "venom_greenhouse",
  "plated_sanctum",
  "bottled_spirit",
  "path_scout",
  "flask_gambit",
  "relic_tinker",
  "fracture_gate",
  "catalyst_lab",
  "triage_station",
  "coil_workbench",
  "black_contract",
  "strategy_table",
  "old_warbanner",
  "field_infirmary",
  "ash_archive",
  "rhythm_metronome",
  "chain_hourglass",
  "cooling_station",
] as const;

export type EventId = (typeof EVENT_IDS)[number];

export function isEventId(eventId: unknown): eventId is EventId {
  return typeof eventId === "string" && (EVENT_IDS as readonly string[]).includes(eventId);
}
