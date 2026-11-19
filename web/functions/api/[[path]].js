/**
 * Pages Function — proxy /api/* to the Render City API.
 * The game calls relative /api/city, but Pages is static hosting: without
 * this Function those calls return the SPA HTML ("Unexpected token '<' ...
 * is not valid JSON") and auth falls back to "No Supabase keys in this
 * server". _redirects cannot proxy to external domains, so a Function
 * does it — same fix as orbitx.world.
 */
const API_ORIGIN = "https://orbitx-city-api.onrender.com";

export async function onRequest(context) {
  const url = new URL(context.request.url);
  const target = `${API_ORIGIN}${url.pathname}${url.search}`;
  const headers = new Headers(context.request.headers);
  headers.delete("host");
  const method = context.request.method;
  const init = {
    method,
    headers,
    redirect: "manual",
  };
  if (method !== "GET" && method !== "HEAD") {
    init.body = await context.request.arrayBuffer();
  }
  const res = await fetch(target, init);
  return res;
}
