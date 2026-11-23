#!/usr/bin/env node
// Mô phỏng các lượt 10 phút bằng bot, dùng đúng lõi game và file JSON.
// Chiến dịch: node tools/sim.mjs --campaign [--build cold] [--max-runs 120] — 1 nhân vật chơi lần lượt các màn, thua thì chơi lại.
// Cách dùng: node tools/sim.mjs [--runs 4] [--map 1-1] [--build fire|fire_ring|cold|lightning|hybrid] [--items] [--persist] [--seed 1] [--no-dodge] [--god]
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { loadData } from '../src/core/data.js';
import { Game, fmtTime } from '../src/core/game.js';
import * as P from '../src/core/progression.js';
const { createCharacter } = P;
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
const diffArg = arg('difficulty', 'normal');
const untilDiff = arg('until', 'hell');

const data = await loadData(async (p) => JSON.parse(await readFile(path.join(root, p), 'utf8')));
const DT = 1 / 60;
let ch = createCharacter(data, (BUILDS[build] || {}).class);
const results = [];

const totalRuns = campaign ? maxRuns : runs;
const attempts = {};
for (let r = 0; r < totalRuns; r++) {
  if (!persist && !campaign) ch = createCharacter(data, (BUILDS[build] || {}).class);
  botAllocate(ch, data, build);
  // Chiến dịch: chơi hết Bình thường rồi tới Ác mộng, Địa ngục (tới mức --until).
  let diff = diffArg;
  if (campaign) {
    diff = null;
    for (const d of data.difficulties) {
      if (P.progressOf(ch, d.id) < data.mapOrder.length && P.unlockedDifficulties(ch, data).includes(d.id)) { diff = d.id; break; }
      if (d.id === untilDiff) break;
    }
    if (!diff) break;
  }
  const mapId = campaign ? data.mapOrder[Math.min(P.progressOf(ch, diff), data.mapOrder.length - 1)] : mapArg || data.mapOrder[0];
  const ak = `${diff}:${mapId}`;
  attempts[ak] = (attempts[ak] || 0) + 1;
  const g = new Game(data, ch, { seed: seed0 + r, headless: true, mapId, difficulty: diff });
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
  if (campaign && !g.over && g.boss) {
    const b = g.boss, p = g.player;
    console.log(`   HẾT GIỜ: người chơi (${p.x | 0},${p.y | 0}) máu ${p.hp | 0}; boss (${b.x | 0},${b.y | 0}) trạng thái ${b.b.state}, cách ${Math.hypot(b.x - p.x, b.y - p.y) | 0}px; quái còn ${g.enemies.length}`);
  } else if (campaign && !g.over) console.log(`   HẾT GIỜ khi chưa có boss: t=${g.time | 0}, bossSpawned=${g.bossSpawned}, sự kiện ${g.eventIdx}/${g.events.length}`);
  if (campaign) {
    if (verbose || res.result !== 'THẮNG' || mapId.endsWith('-5')) console.log(`${data.difficultiesById[diff].name} ${mapId} (×${g.map.difficulty.toFixed(2)}) lần ${attempts[ak]}: ${res.result} lúc ${res.time}, cấp ${res.level}, boss còn ${res.boss}, nguyên nhân ${res.cause}`);
    continue;
  }
  console.log(`Lượt ${res.run}: ${res.result} lúc ${res.time}, cấp ${res.level}, giết ${res.kills}, nguyên nhân: ${res.cause}, boss còn ${res.boss}, quái tối đa ${maxAlive}, thiếu mana ${res.noManaSec}s, đồ ${res.items}, vàng ${g.log.gold}, đóng băng ${g.log.freezes} (${ms.toFixed(0)}ms)`);
  if (verbose) console.log('   ' + perMin.join(' | '));
  if (verbose) console.log('   kỹ năng: ' + res.skills + ' | thuộc tính: ' + JSON.stringify(ch.attrs) + ' | lên cấp: ' + g.log.levelUps.map((l) => `${l.level}@${fmtTime(l.t)}`).join(' '));
}

if (campaign) {
  const prog = data.difficulties.map((d) => `${d.name} ${P.progressOf(ch, d.id)}/${data.mapOrder.length}`).join(', ');
  const hard = Object.entries(attempts).filter(([, v]) => v > 1).map(([k, v]) => `${k}:${v}`).join(' ');
  console.log(`\nKết thúc sau ${Object.values(attempts).reduce((a, b) => a + b, 0)} lượt, cấp ${ch.level}: ${prog}. Màn phải thử nhiều lần: ${hard || 'không'}`);
}
