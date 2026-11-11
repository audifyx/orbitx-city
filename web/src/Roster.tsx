import { useEffect, useRef, useState } from "react";
import { AmbientLight, DirectionalLight, Group, PerspectiveCamera, Scene, WebGLRenderer } from "three";
import { allLooks, dressPerson, loadLooks, type Look } from "./game/avatar";

const HELP =
  "WASD move · click or drag to look · arrows or Q/R turn · Space jump · F fly · E use or drive · C camera · hold Z emotes · O spectator · T chat · V talk";

interface CharacterSelectProps {
  seedText: string;
  setSeedText: (value: string) => void;
  webglMissing: boolean;
  busy: boolean;
  onPlay: () => void;
  onBack: () => void;
}

// Snapshots share ONE renderer for all 12 looks. Phones give a page only a
// few WebGL contexts: one renderer per card (12 creates) exhausts that budget,
// the first failed create threw inside the loop's finally and killed every
// card, so they all stayed blank. One context, disposed once, fixes it.

export function CharacterSelect({ seedText, setSeedText, webglMissing, busy, onPlay, onBack }: CharacterSelectProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [looks, setLooks] = useState<Look[]>(allLooks());
  const [index, setIndex] = useState(0);
  const [shots, setShots] = useState<Record<string, string>>({});
  // True when the live preview's own WebGL context could not be created
  // (phone context budget). The selected look's snapshot image shows instead,
  // so the character is never a black box.
  const [previewDead, setPreviewDead] = useState(false);

  useEffect(() => {
    let live = true;
    void loadLooks().then((list) => {
      if (!live) return;
      setLooks(list);
      const saved = localStorage.getItem("orbitx-look");
      const found = list.findIndex((item) => item.id === saved);
      setIndex(found >= 0 ? found : 0);
    });
    return () => {
      live = false;
    };
  }, []);

  // Render each avatar once into a still image for its card. One shared
  // renderer for the whole loop (see above): a single WebGL context, disposed
  // once, and one bad look can never kill the rest of the grid.
  useEffect(() => {
    if (!looks.length) return;
    let live = true;
    void (async () => {
      const canvas = document.createElement("canvas");
      canvas.width = 180;
      canvas.height = 220;
      let renderer: WebGLRenderer | undefined;
      try {
        renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
      } catch {
        return;
      }
      try {
        renderer.setSize(180, 220, false);
        const scene = new Scene();
        const camera = new PerspectiveCamera(36, 180 / 220, 0.1, 20);
        camera.position.set(1.7, 1.45, 2.6);
        camera.lookAt(0, 1.0, 0);
        scene.add(new AmbientLight(0xffffff, 1.15));
        const sun = new DirectionalLight(0xfff1dc, 2.1);
        sun.position.set(3, 5, 2);
        scene.add(sun);
        const next: Record<string, string> = {};
        for (const look of looks) {
          if (!live) return;
          try {
            const actor = new Group();
            dressPerson(actor, look, { color: "white", hat: "none", owned: [], trustOwned: true });
            scene.add(actor);
            renderer.render(scene, camera);
            next[look.id] = canvas.toDataURL("image/png");
            setShots({ ...next });
            scene.remove(actor);
            actor.traverse((child) => {
              const material = (child as { material?: { dispose?: () => void } }).material;
              material?.dispose?.();
            });
          } catch {
            // One bad look is skipped; the rest of the grid still renders.
          }
        }
      } finally {
        renderer?.dispose();
      }
    })();
    return () => {
      live = false;
    };
  }, [looks]);

  const look = looks[index] ?? looks[0];

  useEffect(() => {
    if (!look) return;
    localStorage.setItem("orbitx-look", look.id);
  }, [look]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !look) return;
    setPreviewDead(false);
    let renderer: WebGLRenderer | undefined;
    try {
      renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true });
    } catch {
      setPreviewDead(true);
      return;
    }
    const width = canvas.clientWidth || 240;
    const height = canvas.clientHeight || 280;
    renderer.setSize(width, height, false);
    const scene = new Scene();
    // Wide enough framing that the whole character fits on phone aspect
    // ratios (the old camera cropped the head off at ~1.6 aspect).
    const camera = new PerspectiveCamera(36, width / Math.max(1, height), 0.1, 20);
    camera.position.set(1.9, 1.5, 3.1);
    camera.lookAt(0, 0.95, 0);
    scene.add(new AmbientLight(0xffffff, 1.15));
    const sun = new DirectionalLight(0xfff1dc, 2.1);
    sun.position.set(3, 5, 2);
    scene.add(sun);
    const actor = new Group();
    dressPerson(actor, look, { color: "white", hat: "none", owned: [], trustOwned: true });
    scene.add(actor);
    let raf = 0;
    const spin = () => {
      actor.rotation.y += 0.012;
      renderer.render(scene, camera);
      raf = requestAnimationFrame(spin);
    };
    raf = requestAnimationFrame(spin);
    return () => {
      cancelAnimationFrame(raf);
      renderer.dispose();
    };
  }, [look]);

  if (!look) return null;
  const prev = () => setIndex((value) => (value - 1 + looks.length) % looks.length);
  const next = () => setIndex((value) => (value + 1) % looks.length);

  return (
    <div
      className="char-select"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === "ArrowRight") {
          event.preventDefault();
          next();
        }
        if (event.key === "ArrowLeft") {
          event.preventDefault();
          prev();
        }
      }}
    >
      <div className="char-head">
        <button type="button" className="menu-ghost" onClick={onBack}>
          ← MENU
        </button>
        <h2>PICK YOUR CHARACTER</h2>
        <p>12 characters · each one a real name from the timeline</p>
      </div>
      <div className="char-body">
        <div className="char-preview">
          {previewDead && shots[look.id] ? (
            <img src={shots[look.id]} alt={`${look.displayName} voxel avatar`} className="char-view-img" />
          ) : (
            <canvas ref={canvasRef} className="char-view" width={480} height={560} />
          )}
          <h3>{look.displayName}</h3>
          <p className="tagline">{look.tagline}</p>
          <p className="char-look">{look.look ?? ""}</p>
          <div className="char-nav">
            <button type="button" onClick={prev} aria-label="Previous character">
              Prev
            </button>
            <button type="button" onClick={next} aria-label="Next character">
              Next
            </button>
          </div>
        </div>
        <div className="char-grid">
          {looks.map((item, itemIndex) => (
            <button
              key={item.id}
              type="button"
              className={`char-card${itemIndex === index ? " on" : ""}`}
              aria-pressed={itemIndex === index}
              onClick={() => setIndex(itemIndex)}
            >
              {shots[item.id] ? (
                <img src={shots[item.id]} alt={`${item.displayName} voxel avatar`} />
              ) : (
                <span className="char-blank" style={{ background: item.colors.outfit }} />
              )}
              <b>{item.displayName}</b>
              <span>{item.look ?? ""}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="char-foot">
        <label>
          Seed
          <input
            id="seed"
            value={seedText}
            placeholder="random"
            inputMode="text"
            disabled={webglMissing}
            onChange={(event) => setSeedText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") onPlay();
            }}
          />
        </label>
        <p className="help">{HELP}</p>
        <p className="help">Demo credits only. No real tokens. · Looks: see web/public/config/character-looks.md</p>
      </div>
      <div className="char-playbar">
        <button id="play" type="button" disabled={webglMissing || busy} onClick={onPlay}>
          {busy ? "BUILDING" : "PLAY"}
        </button>
      </div>
    </div>
  );
}
