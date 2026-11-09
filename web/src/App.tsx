import { useState } from 'react'
import CityMap from './CityMap'
import {
  DISTRICTS,
  JOBS,
  MAP_PROVISIONAL,
  MINECRAFT_VERSION,
  WORLD_ZIP_PATH,
  type DistrictId,
} from './data'

export default function App() {
  const [selected, setSelected] = useState<DistrictId>('terminal')
  const district = DISTRICTS.find((d) => d.id === selected) ?? DISTRICTS[0]

  const scrollTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' })
  }

  return (
    <div className="app">
      <header className="topbar">
        <span className="topbar-logo">ORBITX CITY</span>
        <nav className="topbar-nav">
          <button type="button" onClick={() => scrollTo('districts')}>Districts</button>
          <button type="button" onClick={() => scrollTo('map')}>City Map</button>
          <button type="button" onClick={() => scrollTo('jobs')}>Jobs</button>
          <button type="button" onClick={() => scrollTo('how-to-play')}>How to Play</button>
        </nav>
        <a className="topbar-download" href={WORLD_ZIP_PATH} download>
          Download the World
        </a>
      </header>

      <main>
        {/* HERO */}
        <section className="hero">
          <p className="hero-kicker">ORBITX · MINECRAFT JAVA EDITION {MINECRAFT_VERSION}</p>
          <h1>
            ORBITX
            <br />
            <span className="gold">CITY</span>
          </h1>
          <p className="hero-pitch">
            Every OrbitX platform is a district you can walk to. Spawn in the
            plaza, visit the Terminal tower, trade in the DEX hall, launch from
            the bay — a whole city, free forever.
          </p>
          <div className="hero-actions">
            <button type="button" className="btn-primary" onClick={() => scrollTo('districts')}>
              Enter the City
            </button>
            <a className="btn-secondary" href={WORLD_ZIP_PATH} download>
              Download the World — Free
            </a>
          </div>
          <p className="hero-note">Free, forever. No account, no wallet, no charge — just the world file.</p>
        </section>

        {/* DISTRICTS */}
        <section id="districts" className="section">
          <h2>Pick a district</h2>
          <p className="section-intro">
            Six districts, one plaza in the middle. Tap a card — or a marker on
            the map below — to see what the district is and what you do there.
          </p>
          <div className="district-grid">
            {DISTRICTS.map((d) => (
              <button
                key={d.id}
                type="button"
                className={`district-card${selected === d.id ? ' selected' : ''}`}
                style={{ borderTopColor: d.accent }}
                onClick={() => setSelected(d.id)}
                aria-pressed={selected === d.id}
              >
                <span className="district-name">{d.name}</span>
                <span className="district-tagline">{d.tagline}</span>
                <span className="district-compass">{d.compass}</span>
              </button>
            ))}
          </div>

          <article className="district-detail" aria-live="polite">
            <div className="district-detail-head">
              <h3>{district.name} <span className="gold">— {district.tagline}</span></h3>
              <p className="district-location">
                Map location: {district.compass} · blocks {district.coords.x}, {district.coords.z}
              </p>
            </div>
            <p>{district.description}</p>
            <h4>What you do there</h4>
            <ul>
              {district.whatYouDo.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </article>
        </section>

        {/* CITY MAP */}
        <section id="map" className="section">
          <h2>City map</h2>
          <p className="section-intro">
            Top-down view of OrbitX City. The gold dashed line is the taxi loop —
            it runs through every district gate. Tap a marker to open that district.
          </p>
          <CityMap districts={DISTRICTS} selected={selected} onSelect={setSelected} />
          <p className="map-caption">
            {MAP_PROVISIONAL
              ? 'Map layout is provisional — drawn from the plan while the world generator finishes. Exact coordinates land with the world file.'
              : 'Map drawn from the world generator layout.'}{' '}
            Spawn plaza at the center. North is up.
          </p>
        </section>

        {/* JOBS BOARD */}
        <section id="jobs" className="section">
          <h2>Jobs board</h2>
          <p className="section-intro">
            The city pays in city credits. These are the city economy —{' '}
            <strong>city credits — economy numbers coming in Part 4</strong>.
            They are placeholders, not real money, and never will be.
          </p>
          <div className="jobs-grid">
            {JOBS.map((job) => (
              <article key={job.title} className="job-card">
                <h3>{job.title}</h3>
                <p className="job-payout">{job.payout}</p>
                <p className="job-payout-note">city credits — economy numbers coming in Part 4</p>
                <p>{job.description}</p>
                <ul>
                  {job.duties.map((duty) => (
                    <li key={duty}>{duty}</li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </section>

        {/* HOW TO PLAY */}
        <section id="how-to-play" className="section">
          <h2>How to play</h2>
          <p className="section-intro">
            OrbitX City runs on Minecraft: Java Edition {MINECRAFT_VERSION}.
          </p>
          <ol className="steps">
            <li>
              <strong>Download the world.</strong> Grab the free world zip from
              the button below — one file, the whole city.
            </li>
            <li>
              <strong>Put it in your saves folder.</strong> Unzip the file, then
              move the unzipped world folder into your Minecraft{' '}
              <code>saves</code> folder. On most computers that is{' '}
              <code>.minecraft/saves</code> — open Minecraft, go to Options →
              Resource Packs → Open Pack Folder, then go up one level to find{' '}
              <code>saves</code>.
            </li>
            <li>
              <strong>Open Minecraft: Java Edition {MINECRAFT_VERSION}.</strong>{' '}
              Make sure you are on Java Edition — this world does not work on
              Bedrock.
            </li>
            <li>
              <strong>Select the world.</strong> On the singleplayer screen,
              pick <strong>OrbitX City</strong> from your world list.
            </li>
            <li>
              <strong>Spawn in the plaza.</strong> You arrive at the spawn
              plaza in the center of the city. Read the map board, pick a gate,
              and walk to any district — or follow the taxi loop around the
              whole city.
            </li>
          </ol>
        </section>

        {/* DOWNLOAD */}
        <section id="download" className="section download-section">
          <h2>Download OrbitX City</h2>
          <p className="section-intro">
            One file, the whole city — free, forever. Minecraft: Java Edition{' '}
            {MINECRAFT_VERSION}.
          </p>
          <a className="btn-primary btn-large" href={WORLD_ZIP_PATH} download>
            Download the World (.zip)
          </a>
          <p className="download-note">
            The world file is generated alongside this menu. If the download
            does not start yet, the world is still being built — check back
            shortly.
          </p>
        </section>
      </main>

      <footer className="footer">
        <p>
          ORBITX CITY — free, forever. The world, the city, the menu — never
          charged. Minecraft: Java Edition {MINECRAFT_VERSION}.
        </p>
        <p className="footer-small">
          OrbitX City is a fan-made Minecraft world for the OrbitX community.
          Not affiliated with Mojang or Microsoft.
        </p>
      </footer>
    </div>
  )
}
