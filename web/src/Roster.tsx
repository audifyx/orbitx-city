import { useEffect, useRef, useState } from "react";
import { AmbientLight, DirectionalLight, Group, PerspectiveCamera, Scene, WebGLRenderer } from "three";
import { allLooks, dressPerson, loadLooks, type Look } from "./game/avatar";

export function Roster() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [looks, setLooks] = useState<Look[]>(allLooks());
  const [index, setIndex] = useState(0);

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

  const look = looks[index] ?? looks[0];

  useEffect(() => {
    if (!look) return;
    localStorage.setItem("orbitx-look", look.id);
  }, [look]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !look) return;
    let renderer: WebGLRenderer;
    try {
      renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true });
    } catch {
      return;
    }
    const width = canvas.clientWidth || 220;
    const height = canvas.clientHeight || 260;
    renderer.setSize(width, height, false);
    const scene = new Scene();
    const camera = new PerspectiveCamera(32, width / Math.max(1, height), 0.1, 20);
    camera.position.set(1.7, 1.45, 2.5);
    camera.lookAt(0, 1.05, 0);
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
      className="roster"
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
      <canvas ref={canvasRef} className="roster-view" width={440} height={520} />
      <div>
        <div className="roster-nav">
          <button type="button" onClick={prev} aria-label="Previous character">
            Prev
          </button>
          <button type="button" onClick={next} aria-label="Next character">
            Next
          </button>
        </div>
        <h2>{look.displayName}</h2>
        <p className="tagline">{look.tagline}</p>
        <div className="roster-grid">
          {looks.map((item, itemIndex) => (
            <button key={item.id} type="button" className={itemIndex === index ? "on" : ""} onClick={() => setIndex(itemIndex)}>
              {item.displayName}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
