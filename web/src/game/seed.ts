export type Rng = () => number;

export function makeRng(seed: number): Rng {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Same rules as the original OrbitX City menu: blank = random, integers pass through, other text is hashed. */
export function parseSeed(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return Math.floor(Math.random() * 1_000_000_000);
  const numeric = Number(trimmed);
  if (Number.isInteger(numeric)) return numeric | 0;
  let hashCode = 0;
  for (let i = 0; i < trimmed.length; i++) hashCode = (Math.imul(31, hashCode) + trimmed.charCodeAt(i)) | 0;
  return hashCode;
}
