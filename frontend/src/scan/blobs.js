// Tracks every object URL so none can leak (rule 6)
const live = new Set();

export function makeUrl(blob) {
  const u = URL.createObjectURL(blob);
  live.add(u);
  return u;
}

export function revokeUrl(u) {
  if (u && live.delete(u)) URL.revokeObjectURL(u);
}

export function revokeAll() {
  live.forEach((u) => URL.revokeObjectURL(u));
  live.clear();
}

export const liveUrlCount = () => live.size;

// A link that destroys itself after ttlMs
export function expiringUrl(blob, ttlMs, onExpire) {
  const url = makeUrl(blob);
  const t = setTimeout(() => { revokeUrl(url); onExpire?.(); }, ttlMs);
  return { url, cancel() { clearTimeout(t); revokeUrl(url); } };
}