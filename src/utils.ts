/** Very naive cosine‑like similarity using token overlap. Replace with embeddings. */
export function similarity(a: string, b: string): number {
  const tok = (s: string) => new Set(s.toLowerCase().split(/\W+/));
  const A = tok(a), B = tok(b);
  const inter = [...A].filter(x => B.has(x)).length;
  return inter / Math.sqrt(A.size * B.size || 1);
}
