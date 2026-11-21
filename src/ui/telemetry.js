// Ghi log mỗi lượt và góp ý người chơi thử vào localStorage, xuất ra file JSON.
const RUNS = 'arpg_s0_runs';
const FEEDBACK = 'arpg_s0_feedback';

function read(key) {
  try { return JSON.parse(localStorage.getItem(key) || '[]'); } catch { return []; }
}
function write(key, v) {
  try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* bộ nhớ bị chặn: bỏ qua */ }
}

export function saveRun(rec) {
  const all = read(RUNS);
  all.push(rec);
  write(RUNS, all);
}
export function getRuns() { return read(RUNS); }
export function saveFeedback(rec) {
  const all = read(FEEDBACK);
  all.push(rec);
  write(FEEDBACK, all);
}
export function getFeedback() { return read(FEEDBACK); }
export function clearAll() { write(RUNS, []); write(FEEDBACK, []); }

export function exportAll() {
  const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), runs: getRuns(), feedback: getFeedback() }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `arpg-s0-log-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.json`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}

// Tóm tắt nhanh cho màn hình làng.
export function summarize(runs) {
  if (!runs.length) return null;
  const firstRuns = new Map();
  for (const r of runs) if (!firstRuns.has(r.tester)) firstRuns.set(r.tester, r);
  const firsts = [...firstRuns.values()];
  const opens = runs.reduce((s, r) => s + r.panelOpens, 0);
  const secs = runs.reduce((s, r) => s + r.panelSeconds, 0);
  return {
    runs: runs.length,
    testers: firstRuns.size,
    firstRunBossKill: firsts.filter((r) => r.result === 'win').length,
    avgPanelSec: opens ? secs / opens : 0,
  };
}
