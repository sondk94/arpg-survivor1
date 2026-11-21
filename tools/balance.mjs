#!/usr/bin/env node
// So sánh DPS các nhánh ở cùng cấp, cùng số điểm (không đồ, người chơi đứng yên, bất tử).
// - Đám đông: luôn có 40 quái đứng yên (36 máu), chết thì sinh lại.
// - Đơn mục tiêu: 1 boss đứng yên (2.500 máu), chết thì sinh lại.
// - Tinh anh: 1 tinh anh Vỏ Đá 600 máu.
// Khoảng cách theo cách chơi: pháp sư 100–350 px / boss 200 px; Chiến Binh áp sát 40–200 px / boss 110 px.
// Chỉ tính sát thương thực (không tính phần thừa). Cách dùng: node tools/balance.mjs [--level 10] [--secs 60]
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { loadData } from '../src/core/data.js';
import { Game } from '../src/core/game.js';
import { createCharacter } from '../src/core/progression.js';
import { botAllocate, BUILDS } from '../src/core/bot.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const arg = (n, d) => { const i = args.indexOf(`--${n}`); return i < 0 ? d : args[i + 1]; };
const LEVEL = Number(arg('level', 10));
const SECS = Number(arg('secs', 60));
const ARENA = arg('arena', 'class'); // class: theo cách chơi từng lớp; close: mọi lớp đứng gần (so sánh giữa các lớp)
const builds = (arg('builds', 'fire,cold,lightning,weapon,shout,blood')).split(',');

const data = await loadData(async (p) => JSON.parse(await readFile(path.join(root, p), 'utf8')));
const DT = 1 / 60;

function makeChar(build) {
  const ch = createCharacter(data, BUILDS[build].class);
  const p = data.config.player;
  ch.level = LEVEL;
  ch.attrPoints = (LEVEL - 1) * p.attrPointsPerLevel;
  ch.skillPoints += (LEVEL - 1) * p.skillPointsPerLevel;
  botAllocate(ch, data, build);
  return ch;
}

function arena(build, mode, seed) {
  const ch = makeChar(build);
  const g = new Game(data, ch, { seed, headless: true });
  g.god = true;
  g.events = [];
  g.updateSpawner = () => {};
  const p = g.player;
  // Pháp sư đánh từ xa: quái ở xa như lúc chơi thật. Chiến Binh cận chiến: quái ở sát (bot thật cũng áp sát).
  const melee = ARENA === 'close' || data.classes[BUILDS[build].class].look === 'warrior';
  const near = melee ? [40, 200] : [100, 350];
  const single = melee ? 110 : 200, eliteD = melee ? 100 : 180;
  const spawnCrowd = () => {
    const a = g.rng.next() * Math.PI * 2, d = g.rng.range(near[0], near[1]);
    const e = g.spawnEnemy('zombie', p.x + Math.cos(a) * d, p.y + Math.sin(a) * d);
    e.speed = 0; e.hp = e.maxHp = 36;
  };
  const spawnBoss = () => {
    const e = g.spawnEnemy('swamp_lord', p.x + single, p.y);
    e.speed = 0;
    e.b = { state: 'cast', t: 1e9, phase2: true, batT: 1e9 };
    g.boss = null; // không kết thúc màn khi chết
    return e;
  };
  let kills = 0;
  for (let t = 0; t < SECS; t += DT) {
    if (mode === 'crowd') { while (g.enemies.filter((e) => !e.dead).length < 40) spawnCrowd(); }
    else if (mode === 'elite') {
      if (!g.enemies.some((e) => !e.dead)) {
        const e = g.spawnEnemy('zombie', p.x + eliteD, p.y);
        g.makeElite(e); e.affixes = ['stone_skin']; e.speed = 0; e.hp = e.maxHp = 600;
        kills++;
      }
    }
    else if (!g.enemies.some((e) => !e.dead && e.type === 'swamp_lord')) spawnBoss();
    g.update(DT);
    g.player.x = g.W / 2; g.player.y = g.H / 2;
  }
  return { dps: g.effDamage / SECS, noMana: g.log.outOfManaSec / SECS, ttk: SECS / Math.max(1, kills - 1) };
}

console.log(`Bố trí: ${ARENA === 'close' ? 'mọi lớp đứng gần (so sánh giữa các lớp)' : 'theo cách chơi từng lớp'}. Cấp ${LEVEL}, ${SECS} giây mỗi thử nghiệm, trung bình 3 seed. Điểm kỹ năng: ${1 + (LEVEL - 1)}.`);
const rows = [];
for (const b of builds) {
  let crowd = 0, single = 0, nm = 0, ttk = 0;
  for (let s = 1; s <= 3; s++) {
    const c = arena(b, 'crowd', s), t = arena(b, 'single', s), el = arena(b, 'elite', s);
    crowd += c.dps / 3; single += t.dps / 3; nm += (c.noMana + t.noMana) / 6; ttk += el.ttk / 3;
  }
  const ch = makeChar(b);
  rows.push({ b, crowd, single, nm, ttk, skills: Object.entries(ch.skills).map(([k, v]) => `${k}:${v}`).join(' ') });
}
const avgC = rows.reduce((s, r) => s + r.crowd, 0) / rows.length;
const avgS = rows.reduce((s, r) => s + r.single, 0) / rows.length;
for (const r of rows) {
  const dc = ((r.crowd / avgC - 1) * 100).toFixed(0), ds = ((r.single / avgS - 1) * 100).toFixed(0);
  console.log(`${r.b.padEnd(10)} đám đông ${r.crowd.toFixed(1).padStart(6)} DPS (${dc >= 0 ? '+' : ''}${dc}%)  đơn mục tiêu ${r.single.toFixed(1).padStart(6)} DPS (${ds >= 0 ? '+' : ''}${ds}%)  tinh anh 600 máu: ${r.ttk.toFixed(1)}s/con  thiếu mana ${(r.nm * 100).toFixed(0)}%  [${r.skills}]`);
}
const cls = (b) => BUILDS[b].class;
for (const c of new Set(rows.map((r) => cls(r.b)))) {
  const rs = rows.filter((r) => cls(r.b) === c);
  const av = (k) => rs.reduce((x, r) => x + r[k], 0) / rs.length;
  console.log(`Trung bình ${c}: đám đông ${av('crowd').toFixed(1)}, đơn mục tiêu ${av('single').toFixed(1)}, tinh anh ${av('ttk').toFixed(1)}s`);
}
const spread = (k) => { const v = rows.map((r) => r[k]); const a = v.reduce((x, y) => x + y) / v.length; return Math.max(...v.map((x) => Math.abs(x / a - 1))) * 100; };
console.log(`Chênh lệch tối đa so với trung bình: đám đông ±${spread('crowd').toFixed(0)}%, đơn mục tiêu ±${spread('single').toFixed(0)}%`);
