import { useEffect, useRef, useState } from "react";
import { createGame, type Game, type PlayMode } from "./game/engine";
import { parseSeed } from "./game/seed";

const HELP =
  "WASD move · mouse look · Space jump · F fly · Shift down · Ctrl faster · click the view to capture the mouse · Esc releases it";

function shotMode(): PlayMode | null {
  const params = new URLSearchParams(window.location.search);
  const shot = params.get("shot");
  if (shot === "air") return "air";
  if (shot === "spawn" || params.has("autostart")) return "play";
  return null;
}

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameRef = useRef<Game | null>(null);
  const [menu, setMenu] = useState(() => shotMode() === null);
  const [busy, setBusy] = useState(false);
  const [seedText, setSeedText] = useState(() => new URLSearchParams(window.location.search).get("seed") ?? "");
  const [status, setStatus] = useState("");
  const [webglMissing, setWebglMissing] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const params = new URLSearchParams(window.location.search);
    let game: Game;
    try {
      game = createGame(canvas, setStatus, params.has("shot"));
    } catch {
      setWebglMissing(true);
      return;
    }
    gameRef.current = game;
    const mode = shotMode();
    if (mode) {
      game.start(parseSeed(params.get("seed") ?? "1"), mode);
      setMenu(false);
    } else {
      game.start(parseSeed(params.get("seed") ?? "1"), "orbit");
    }
    return () => {
      game.dispose();
      gameRef.current = null;
    };
  }, []);

  const play = () => {
    const game = gameRef.current;
    const canvas = canvasRef.current;
    if (!game || !canvas || busy) return;
    setBusy(true);
    game.start(parseSeed(seedText), "play");
    setBusy(false);
    setMenu(false);
    canvas.requestPointerLock();
  };

  return (
    <>
      <canvas ref={canvasRef} className="view" id="view" />
      <p className="status" id="status">
        {menu ? "" : status}
      </p>
      <div className="crosshair" id="crosshair" hidden={menu} />
      {menu && (
        <section className="menu" id="menu">
          <div className="card">
            <h1>ORBITX CITY</h1>
            <p className="tag">{webglMissing ? "This browser has no WebGL." : "Tropical downtown in the browser"}</p>
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
                  if (event.key === "Enter") play();
                }}
              />
            </label>
            <button id="play" type="button" disabled={webglMissing || busy} onClick={play}>
              {busy ? "BUILDING" : "PLAY"}
            </button>
            <p className="help">{HELP}</p>
          </div>
        </section>
      )}
    </>
  );
}
