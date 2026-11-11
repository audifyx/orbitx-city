let started = false;

type Channel = {
  on: (event: string, filter: Record<string, string>, cb: (payload: { new?: Record<string, unknown> }) => void) => Channel;
  subscribe: () => void;
};

export async function connectLive(url: string, anon: string) {
  if (started || !url || !anon) return;
  started = true;
  try {
    const load = new Function("spec", "return import(spec)") as (spec: string) => Promise<{
      createClient: (url: string, key: string) => { channel: (name: string) => Channel };
    }>;
    const { createClient } = await load("https://esm.sh/@supabase/supabase-js@2.49.4");
    const { world } = await import("./world");
    const client = createClient(url, anon);
    world.realtime = true;
    client
      .channel("orbitx-city")
      .on("postgres_changes", { event: "*", schema: "public", table: "presence" }, (payload) => {
        const state = payload.new?.state as Record<string, unknown> | undefined;
        if (!state || typeof state.id !== "string" || state.id === world.id) return;
        const people = world.people.filter((person) => person.id !== state.id);
        people.push(state as unknown as (typeof world.people)[number]);
        world.people = people;
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "chat" }, (payload) => {
        const row = payload.new;
        if (!row) return;
        world.chat = [
          ...world.chat,
          {
            id: String(row.player_id || ""),
            name: String(row.name || ""),
            text: String(row.text || ""),
            scope: (row.scope === "near" ? "near" : "global") as "near" | "global",
            x: Number(row.x) || 0,
            z: Number(row.z) || 0,
          },
        ].slice(-40);
      })
      .subscribe();
  } catch {
    started = false;
  }
}
