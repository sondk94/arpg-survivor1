#!/usr/bin/env node
// Mô phỏng các lượt 10 phút bằng bot, dùng đúng lõi game và file JSON.
// Chiến dịch: node tools/sim.mjs --campaign [--build cold] [--max-runs 120] — 1 nhân vật chơi lần lượt các màn, thua thì chơi lại.
// Cách dùng: node tools/sim.mjs [--runs 4] [--map 1-1] [--build fire|fire_ring|cold|lightning|hybrid] [--items] [--persist] [--seed 1] [--no-dodge] [--god]
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { loadData } from '../src/core/data.js';
import { Game, fmtTime } from '../src/core/game.js';
import { createCharacter } from '../src/core/progression.js';
import { botInput, botAllocate, botManageItems, BUILDS } from '../src/core/bot.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const arg = (name, def) => {
  const i = args.indexOf(`--${name}`);
  if (i < 0) return def;
  const v = args[i + 1];
  return v === undefined || v.startsWith('--') ? true : v;
};

const runs = Number(arg('runs', 4));
const build = arg('build', 'fire');
const useItems = !!arg('items', false);
const persist = !!arg('persist', false);
const seed0 = Number(arg('seed', 1));
const dodge = !arg('no-dodge', false);
const god = !!arg('god', false);
const verbose = !!arg('verbose', false);
const mapArg = arg('map', null);
const campaign = !!arg('campaign', false);
const maxRuns = Number(arg('max-runs', 120));

const data = await loadData(async (p) => JSON.parse(await readFile(path.join(root, p), 'utf8')));
const DT = 1 / 60;
let ch = createCharacter(data, (BUILDS[build] || {}).class);
const results = [];

const totalRuns = campaign ? maxRuns : runs;
const attempts = {};
for (let r = 0; r < totalRuns; r++) {
  if (!persist && !campaign) ch = createCharacter(data, (BUILDS[build] || {}).class);
  botAllocate(ch, data, build);
  const mapId = campaign ? data.mapOrder[Math.min(ch.mapProgress || 0, data.mapOrder.length - 1)] : mapArg || data.mapOrder[0];
  if (campaign && (ch.mapClears?.[data.mapOrder[data.mapOrder.length - 1]] || 0) > 0) break;
  attempts[mapId] = (attempts[mapId] || 0) + 1;
  const g = new Game(data, ch, { seed: seed0 + r, headless: true, mapId });
  g.god = god;
  const perMin = [];
  let nextMark = 60;
  let maxAlive = 0;
  const t0 = performance.now();
  while (!g.over && g.time < 720) {
    const inp = botInput(g, { dodge });
    g.input.x = inp.x; g.input.y = inp.y;
    g.update(DT);
    if (ch.attrPoints > 0 || ch.skillPoints > 0) {
      g.beginEdit();
      const diff = botAllocate(ch, data, build);
      g.refreshStats();
      g.endEdit();
      g.recordAllocation(diff);
    }
    if (useItems && g.out.some((e) => e.type === 'item')) { botManageItems(ch, data, build); g.refreshStats(); }
    g.out.length = 0;
    maxAlive = Math.max(maxAlive, g.enemies.length);
    if (g.time >= nextMark) {
      perMin.push(`${nextMark / 60}m:L${ch.level} k${g.kills} e${g.enemies.length} hp${Math.round(g.player.hp)}`);
      nextMark += 60;
    }
  }
  const ms = performance.now() - t0;
  const res = {
    run: r + 1,
    result: g.result ? (g.result.win ? 'THẮNG' : 'CHẾT') : 'HẾT GIỜ',
    time: fmtTime(g.time),
    level: `${g.log.startLevel}→${ch.level}`,
    kills: g.kills,
    cause: g.log.cause || '-',
    boss: g.boss ? `${Math.round((g.boss.hp / g.boss.maxHp) * 100)}%` : '-',
    maxAlive,
    noManaSec: Math.round(g.log.outOfManaSec),
    dmg: Object.fromEntries(Object.entries(g.dmgByElement).map(([k, v]) => [k, Math.round(v)])),
    items: g.log.itemsPicked.length,
    skills: Object.entries(ch.skills).map(([k, v]) => `${k}:${v}`).join(' '),
    simMs: Math.round(ms),
  };
  results.push(res);
  if (campaign) {
    console.log(`Màn ${mapId} (×${g.map.difficulty.toFixed(2)}) lần ${attempts[mapId]}: ${res.result} lúc ${res.time}, cấp ${res.level}, boss còn ${res.boss}, nguyên nhân ${res.cause}`);
    continue;
  }
  console.log(`Lượt ${res.run}: ${res.result} lúc ${res.time}, cấp ${res.level}, giết ${res.kills}, nguyên nhân: ${res.cause}, boss còn ${res.boss}, quái tối đa ${maxAlive}, thiếu mana ${res.noManaSec}s, đồ ${res.items}, vàng ${g.log.gold}, đóng băng ${g.log.freezes} (${ms.toFixed(0)}ms)`);
  if (verbose) console.log('   ' + perMin.join(' | '));
  if (verbose) console.log('   kỹ năng: ' + res.skills + ' | thuộc tính: ' + JSON.stringify(ch.attrs) + ' | lên cấp: ' + g.log.levelUps.map((l) => `${l.level}@${fmtTime(l.t)}`).join(' '));
}

if (campaign) {
  const cleared = ch.mapProgress || 0;
  console.log(`\nKết thúc: qua ${Math.min(cleared, data.mapOrder.length)}/${data.mapOrder.length} màn sau ${Object.values(attempts).reduce((a, b) => a + b, 0)} lượt, cấp ${ch.level}. Số lần thử từng màn: ${Object.entries(attempts).map(([k, v]) => `${k}:${v}`).join(' ')}`);
}
