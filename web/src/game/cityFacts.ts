// Single source of truth for the city facts + feature highlights the
// splash / intro / menu / About page show.
//
// Counts are derived from the real catalogs — never hardcoded — so the
// splash stays up to date as features are added, removed, or renamed:
//   characters — LOOK_IDS (avatar.ts, the 12 KOL looks)
//   jobs       — JOBS_20 (emergency.ts, the job roster)
//   vehicles   — VEHICLES (vehicles.ts, the full catalog)
//   homes      — HOMES (homes.ts, buildHomeCatalog — 50 per state)
//   districts  — STATES (states.ts, 4 districts per state)
//   states     — STATES (states.ts)
//   universes  — UNIVERSE_META (multiverse.ts, the 5 universes)
//
// The intro beats and the menu stats strip + feature grid all read from
// here. Add a feature to FEATURE_HIGHLIGHTS and the splash shows it;
// remove or rename one and the splash follows. Do NOT hardcode a feature
// list in Intro.tsx or MenuHome.tsx — that is how the splash goes stale.
import { LOOK_IDS } from "./avatar";
import { JOBS_20 } from "./emergency";
import { VEHICLES } from "./vehicles";
import { HOMES } from "./homes";
import { STATES } from "./states";
import { UNIVERSE_META } from "./multiverse";
import type { PanelName } from "./runtime";

export const CITY_FACTS = {
  characters: LOOK_IDS.length,
  jobs: JOBS_20.length,
  vehicles: VEHICLES.length,
  homes: HOMES.length,
  districts: STATES.reduce((n, s) => n + s.districts.length, 0),
  states: STATES.length,
  universes: Object.keys(UNIVERSE_META).length,
  /** "New York · Los Angeles · Florida" — the state names, in order. */
  stateNames: STATES.map((s) => s.name).join(" · "),
} as const;

export interface FeatureHighlight {
  /** Stable key — the intro ticker and the menu grid key off it. */
  id: string;
  /** Display name, e.g. "12 characters". Built from the live count. */
  name: string;
  /** One-line blurb. */
  blurb: string;
  /**
   * Live count, derived from the catalogs above — only for features
   * that ARE a number (characters, jobs, homes, vehicles, districts,
   * universes). Omitted for named features (radio, voice, arcade).
   */
  count?: number;
  /** What the count counts, e.g. "characters". Pairs with `count`. */
  countLabel?: string;
  /**
   * The in-game panel this feature opens (PanelName from runtime.ts).
   * Omit when the feature has no single panel (e.g. characters — the
   * roster is a menu step, not a panel). Typed, so renaming a panel
   * fails the build here instead of silently orphaning the highlight.
   */
  panel?: PanelName;
}

/**
 * Headline features, in splash order. Each count is derived live from
 * CITY_FACTS, so the numbers track the catalogs. To add a feature to
 * the splash, add one entry here — nothing else needs editing.
 */
export const FEATURE_HIGHLIGHTS: FeatureHighlight[] = [
  {
    id: "characters",
    name: `${CITY_FACTS.characters} characters`,
    blurb: "Play as a real name from the timeline.",
    count: CITY_FACTS.characters,
    countLabel: "characters",
  },
  {
    id: "jobs",
    name: `${CITY_FACTS.jobs} jobs`,
    blurb: "Work the city, get paid in City Sol.",
    count: CITY_FACTS.jobs,
    countLabel: "jobs",
    panel: "jobs",
  },
  {
    id: "homes",
    name: `${CITY_FACTS.homes} homes`,
    blurb: "Buy a place, build on it, rent it out.",
    count: CITY_FACTS.homes,
    countLabel: "homes",
    panel: "home",
  },
  {
    id: "vehicles",
    name: `${CITY_FACTS.vehicles} vehicles`,
    blurb: "Cars, bikes, boards, flying cars, planes.",
    count: CITY_FACTS.vehicles,
    countLabel: "vehicles",
    panel: "garage",
  },
  {
    id: "districts",
    name: `${CITY_FACTS.districts} districts`,
    blurb: `${CITY_FACTS.stateNames} — three states, one city.`,
    count: CITY_FACTS.districts,
    countLabel: "districts",
  },
  {
    id: "universes",
    name: `${CITY_FACTS.universes} universes`,
    blurb: "Same city, different saves — travel free.",
    count: CITY_FACTS.universes,
    countLabel: "universes",
    panel: "multiverse",
  },
  {
    id: "radio",
    name: "City radio",
    blurb: "Your tracks on the shared playlist.",
    panel: "radio",
  },
  {
    id: "voice",
    name: "Live voice",
    blurb: "Talk to players nearby, party channels.",
    panel: "voice",
  },
  {
    id: "arcade",
    name: "Neon Arcade",
    blurb: "High/low, reflex light, coin hunt, fishing.",
    panel: "arcade",
  },
  {
    id: "race",
    name: "Street races",
    blurb: "Ring-road races + hover time trials.",
    panel: "race",
  },
];
