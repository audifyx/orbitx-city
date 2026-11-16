import { createRoot } from "react-dom/client";
import App, { StatsPage } from "./App";
import "./index.css";

// PWA: register the service worker (app-shell cache). No-ops on file://
// or where service workers are unavailable — the app works without it.
if ("serviceWorker" in navigator && window.location.protocol.startsWith("http")) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}

// Standalone /stats page: a linkable page with the FULL stats, no game.
// The game (WebGL, engine, intro) never boots on this path — the stats
// page loads as a plain page. Trailing slash normalized so /stats/ and
// /stats resolve the same way.
const statsPath = window.location.pathname.replace(/\/+$/, "") || "/";
createRoot(document.getElementById("root")!).render(
  statsPath === "/stats" ? <StatsPage /> : <App />
);
