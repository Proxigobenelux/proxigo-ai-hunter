export function log(level, source, message, data = {}) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), level, source, message, ...data }));
}
