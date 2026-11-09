import type { District, DistrictId } from './data'

interface CityMapProps {
  districts: District[]
  selected: DistrictId | null
  onSelect: (id: DistrictId) => void
}

// Top-down map of OrbitX City, drawn from world/layout.json.
// viewBox 1000 x 760. Spawn plaza at the center (500, 380).
// North is up (Minecraft -Z). Marker positions are a stylized schematic;
// the block coordinates in data.ts are the true in-world positions.
export default function CityMap({ districts, selected, onSelect }: CityMapProps) {
  const byId = new Map(districts.map((d) => [d.id, d]))
  const terminal = byId.get('terminal')!
  const dex = byId.get('dex')!
  const launchpad = byId.get('launchpad')!
  const social = byId.get('social')!
  const scanner = byId.get('scanner')!
  const jobs = byId.get('jobs')!

  // Taxi loop: a circuit through the district gates in perimeter order
  // (clockwise from the north tower), so the loop reads as a ring, not a
  // tangle of diagonals.
  const loop = [
    `${terminal.map.x},${terminal.map.y}`,
    `${scanner.map.x},${scanner.map.y}`,
    `${dex.map.x},${dex.map.y}`,
    `${launchpad.map.x},${launchpad.map.y}`,
    `${jobs.map.x},${jobs.map.y}`,
    `${social.map.x},${social.map.y}`,
  ].join(' ')

  return (
    <svg
      className="city-map"
      viewBox="0 0 1000 760"
      role="img"
      aria-label="Top-down map of OrbitX City: spawn plaza in the center, Terminal to the north, DEX to the east, Launchpad to the south, Social to the west, Scanner to the north-east, and the Jobs market to the south-west, connected by roads and a taxi loop."
    >
      {/* city ground */}
      <rect x="20" y="20" width="960" height="720" rx="18" fill="#0d0d0d" stroke="#d4af37" strokeWidth="3" />

      {/* parks — north-west and south-east */}
      <g>
        <rect x="90" y="60" width="170" height="130" rx="10" fill="#12351d" stroke="#3fae5a" strokeWidth="2" />
        <text x="175" y="120" className="map-label" textAnchor="middle">PARK</text>
        <text x="175" y="142" className="map-sublabel" textAnchor="middle">North-West</text>
        <rect x="740" y="570" width="170" height="130" rx="10" fill="#12351d" stroke="#3fae5a" strokeWidth="2" />
        <text x="825" y="630" className="map-label" textAnchor="middle">PARK</text>
        <text x="825" y="652" className="map-sublabel" textAnchor="middle">South-East</text>
      </g>

      {/* roads — the cross grid through the plaza */}
      <g stroke="#8a8a8a" strokeWidth="26" strokeLinecap="round">
        <line x1="500" y1="60" x2="500" y2="700" />
        <line x1="120" y1="380" x2="880" y2="380" />
      </g>
      <g stroke="#d4af37" strokeWidth="2" strokeDasharray="14 12">
        <line x1="500" y1="60" x2="500" y2="700" />
        <line x1="120" y1="380" x2="880" y2="380" />
      </g>

      {/* taxi loop — dashed gold circuit through every district gate */}
      <polygon
        points={loop}
        fill="none"
        stroke="#d4af37"
        strokeWidth="4"
        strokeDasharray="10 8"
        strokeLinejoin="round"
      />
      <text x="600" y="92" className="map-sublabel" fill="#d4af37">TAXI LOOP</text>

      {/* compass */}
      <g>
        <text x="950" y="60" className="map-label" textAnchor="end">N</text>
        <text x="950" y="78" className="map-sublabel" textAnchor="end">↑ north</text>
      </g>

      {/* spawn plaza */}
      <g>
        <circle cx="500" cy="380" r="52" fill="#1a1a1a" stroke="#ffffff" strokeWidth="3" />
        <circle cx="500" cy="380" r="34" fill="none" stroke="#d4af37" strokeWidth="2" />
        <text x="500" y="374" className="map-label" textAnchor="middle">SPAWN</text>
        <text x="500" y="394" className="map-label" textAnchor="middle">PLAZA</text>
        <text x="500" y="452" className="map-sublabel" textAnchor="middle">You start here · 0, 0</text>
      </g>

      {/* district markers */}
      {districts.map((d) => {
        const isSelected = selected === d.id
        return (
          <g
            key={d.id}
            className="map-marker"
            onClick={() => onSelect(d.id)}
            role="button"
            aria-label={`${d.name} district — ${d.compass}`}
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') onSelect(d.id)
            }}
          >
            <circle
              cx={d.map.x}
              cy={d.map.y}
              r={isSelected ? 54 : 46}
              fill="#000000"
              stroke={isSelected ? '#ffffff' : d.accent}
              strokeWidth={isSelected ? 4 : 3}
            />
            <text x={d.map.x} y={d.map.y - 2} className="map-marker-label" textAnchor="middle">
              {d.name.toUpperCase()}
            </text>
            <text x={d.map.x} y={d.map.y + 16} className="map-marker-sub" textAnchor="middle">
              {d.id === 'terminal' ? 'TOWER' : d.id === 'dex' ? 'HALL' : d.id === 'launchpad' ? 'BAY' : d.id === 'social' ? 'HUB' : d.id === 'scanner' ? 'TOWER' : 'MARKET'}
            </text>
          </g>
        )
      })}

      {/* district name tags under markers that would collide with roads */}
      <text x={terminal.map.x} y={terminal.map.y + 66} className="map-sublabel" textAnchor="middle">
        Terminal · north
      </text>
      <text x={scanner.map.x} y={scanner.map.y - 56} className="map-sublabel" textAnchor="middle">
        Scanner · north-east
      </text>
      <text x={dex.map.x} y={dex.map.y + 62} className="map-sublabel" textAnchor="middle">
        DEX · east
      </text>
      <text x={launchpad.map.x} y={launchpad.map.y + 66} className="map-sublabel" textAnchor="middle">
        Launchpad · south
      </text>
      <text x={social.map.x} y={social.map.y + 62} className="map-sublabel" textAnchor="middle">
        Social · west
      </text>
      <text x={jobs.map.x} y={jobs.map.y + 66} className="map-sublabel" textAnchor="middle">
        Jobs · south-west
      </text>
    </svg>
  )
}
