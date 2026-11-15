/**
 * Random id for mission objects. `crypto.randomUUID` exists only in secure
 * contexts (HTTPS or localhost), so a self-hosted instance reached over plain
 * HTTP falls back to `getRandomValues`, which works everywhere.
 */
export function newId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
