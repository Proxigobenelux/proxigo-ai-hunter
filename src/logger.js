// ─── Proxigo AI Hunter — Logger ───────────────────────────────────────────────
export function log(level, message, meta = {}) {
  const entry = { ts: new Date().toISOString(), level, message, ...meta };
  console.log(JSON.stringify(entry));
}
