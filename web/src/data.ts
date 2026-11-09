// OrbitX City — lobby data.
//
// Coordinates are generated from world/layout.json (Part 1) — the same
// layout the world generator built. Block coords use Minecraft convention:
// north = -Z. The SVG map positions in `map` are a stylized schematic
// (viewBox 1000 x 760, plaza at center); the `coords` are the true
// in-world block coordinates shown in the district panels.

export type DistrictId =
  | 'terminal'
  | 'dex'
  | 'launchpad'
  | 'social'
  | 'scanner'
  | 'jobs'

export interface District {
  id: DistrictId
  name: string
  tagline: string
  description: string
  whatYouDo: string[]
  /** Where it sits on the city map. */
  compass: string
  /** Block coordinates in the world (x, z) — from world/layout.json. */
  coords: { x: number; z: number }
  /** Position on the SVG map (viewBox 1000 x 760). */
  map: { x: number; y: number }
  accent: string
}

export const MAP_PROVISIONAL = false

export const DISTRICTS: District[] = [
  {
    id: 'terminal',
    name: 'Terminal',
    tagline: 'The command tower',
    description:
      'The tallest building in OrbitX City — black, white and gold. The OrbitX Terminal is the command dashboard made into a tower: every tool, every chart, every command in one hall, looking out over the whole city.',
    whatYouDo: [
      'Walk the command hall and run the Terminal like a dashboard',
      'Check the OG-score board for any token',
      'Plan your route across the city from the top floor',
    ],
    compass: 'North of the plaza',
    coords: { x: 0, z: -160 },
    map: { x: 500, y: 110 },
    accent: '#d4af37',
  },
  {
    id: 'dex',
    name: 'DEX',
    tagline: 'The trading hall',
    description:
      'The trading hall of the city. A swap floor with pair boards and live-price boards — the place to watch pairs move and trade, right in the middle of the action on the east side.',
    whatYouDo: [
      'Stand on the swap floor and watch the pair boards',
      'Follow prices on the live-price boards',
      'Trade the way the Terminal taught you',
    ],
    compass: 'East of the plaza',
    coords: { x: 160, z: 0 },
    map: { x: 820, y: 380 },
    accent: '#3fae5a',
  },
  {
    id: 'launchpad',
    name: 'Launchpad',
    tagline: 'The launch bay',
    description:
      'The launch bay, south of the plaza. Pads where new tokens lift off, bonding-curve ramps you can walk up, and a graduation gate at the far end — the moment a token makes it out of the bay and into the wider city.',
    whatYouDo: [
      'Walk the launch pads and watch new tokens go up',
      'Climb the bonding-curve ramps',
      'Pass through the graduation gate',
    ],
    compass: 'South of the plaza',
    coords: { x: 0, z: 160 },
    map: { x: 500, y: 650 },
    accent: '#d4af37',
  },
  {
    id: 'social',
    name: 'Social',
    tagline: 'The social hub',
    description:
      'The social hub, west of the plaza — a plaza and hall of its own, with post boards and DM rooms. This is where the city talks: what people are posting, who is around, and what the crowd is watching.',
    whatYouDo: [
      'Read the post boards in the hall',
      'Meet the city in the DM rooms',
      'See what the crowd is talking about',
    ],
    compass: 'West of the plaza',
    coords: { x: -160, z: 0 },
    map: { x: 180, y: 380 },
    accent: '#4a90d9',
  },
  {
    id: 'scanner',
    name: 'Scanner',
    tagline: 'The watchtower',
    description:
      'The watchtower in the north-east, watching the chain so you do not have to. The OG-score board, the bundle map, and the X-signal panels — everything the Scanner sees, posted where the whole city can read it.',
    whatYouDo: [
      'Read the OG-score board for any token',
      'Study the bundle map before you trust a chart',
      'Check the X-signal panels for what is moving',
    ],
    compass: 'North-east of the plaza',
    coords: { x: 160, z: -160 },
    map: { x: 800, y: 130 },
    accent: '#d4af37',
  },
  {
    id: 'jobs',
    name: 'Jobs',
    tagline: 'The market quarter',
    description:
      'The market quarter in the south-west — stalls, stands, and the job boards. This is where the city works: pick up a job, earn city credits, and spend them at the market stalls.',
    whatYouDo: [
      'Take a job from the jobs board',
      'Work the market stalls',
      'Earn city credits and spend them in the quarter',
    ],
    compass: 'South-west of the plaza',
    coords: { x: -160, z: 160 },
    map: { x: 200, y: 630 },
    accent: '#c0c0c0',
  },
]

export interface Job {
  title: string
  description: string
  duties: string[]
  /** City-economy PLACEHOLDER payout — see PLAN.md Part 4. Never real money. */
  payout: string
}

export const JOBS: Job[] = [
  {
    title: 'Taxi Driver',
    description:
      'Drive the taxi loop — the road circuit that runs around the whole city, stopping at every district gate. You keep the loop moving and the city connected.',
    duties: [
      'Follow the looped taxi route around the city',
      'Stop at every district gate to pick up passengers',
      'Keep the route running, day and night',
    ],
    payout: '120 city credits per loop',
  },
  {
    title: 'Scanner Operator',
    description:
      'Work the Scanner tower in the north-east. You watch the chain, read the OG-score board and the bundle map, and call out what is real and what is not.',
    duties: [
      'Watch the OG-score board and flag risky tokens',
      'Read the bundle map and report bundled supplies',
      'Post X-signal updates to the tower panels',
    ],
    payout: '90 city credits per shift',
  },
  {
    title: 'Trader',
    description:
      'Work the DEX trading hall on the east side. You read the pair boards, follow the live-price boards, and make the calls — the city rewards good reads.',
    duties: [
      'Read the pair boards on the swap floor',
      'Track live prices and call the moves',
      'Keep a clean record on the hall board',
    ],
    payout: '150 city credits per winning call',
  },
]

export const WORLD_ZIP_PATH = '/orbitx-city-world.zip'

export const MINECRAFT_VERSION = '1.21.x'
