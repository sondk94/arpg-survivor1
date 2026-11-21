#!/usr/bin/env node
// Kiểm tra nhanh các công thức trong tài liệu thiết kế: node tools/test.mjs
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
import { loadData } from '../src/core/data.js';
import { Game } from '../src/core/game.js';
import * as P from '../src/core/progression.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const data = await loadData(async (p) => JSON.parse(await readFile(path.join(root, p), 'utf8')));
let n = 0;
const t = (name, fn) => { fn(); n++; console.log('ok -', name); };

t('XP cần để lên từ cấp L = round(20 × L^1,8)', () => {
  assert.equal(P.xpToNext(1, data.config), 20);
  assert.equal(P.xpToNext(2, data.config), 70);
  assert.equal(P.xpToNext(7, data.config), Math.round(20 * 7 ** 1.8));
});

t('Máu/mana tối đa của pháp sư cấp 1', () => {
  const ch = P.createCharacter(data);
  const s = P.computeStats(ch, data);
  assert.equal(s.maxHp, 40 + 15 * 3 + 1 * 2);
  assert.equal(s.maxMana, 30 + 30 * 2 + 1 * 1.5);
  assert.ok(Math.abs(s.manaRegen - s.maxMana * 0.05) < 1e-9);
  assert.ok(Math.abs(s.dodge - 0.04) < 1e-9);
});

t('Né tối đa 40%', () => {
  const ch = P.createCharacter(data);
  ch.attrs.dex = 1000;
  assert.equal(P.computeStats(ch, data).dodge, 0.4);
});

t('Hệ số sát thương cộng dồn rồi mới nhân (thuộc tính + synergy + bị động)', () => {
  const ch = P.createCharacter(data);
  ch.skills = { fireball: 3, meteor: 2, fire_mastery: 4 };
  const s = P.computeStats(ch, data);
  const m = P.damageMult(ch, data.skills.fireball, s, data);
  assert.ok(Math.abs(m - (1 + 30 * 0.005 + 2 * 0.06 + 4 * 0.08)) < 1e-9);
});

t('Lên cấp: +5 điểm thuộc tính, +1 điểm kỹ năng, hồi đầy máu/mana', () => {
  const ch = P.createCharacter(data);
  const g = new Game(data, ch, { seed: 1, headless: true });
  g.player.hp = 10; g.player.mana = 0;
  g.addXp(20);
  assert.equal(ch.level, 2);
  assert.equal(ch.attrPoints, 5);
  assert.equal(ch.skillPoints, 1);
  assert.equal(g.player.hp, g.stats.maxHp);
  assert.equal(g.player.mana, g.stats.maxMana);
});

t('Học kỹ năng: tự vào ô trống; đầy 4 ô thì hỏi thay', () => {
  const ch = P.createCharacter(data);
  ch.level = 20; ch.skillPoints = 10;
  assert.equal(P.learnSkill(ch, 'ember_ring', data), 'ok');
  assert.deepEqual(ch.slots, ['fireball', 'ember_ring', null, null]);
  ch.slots = ['fireball', 'ember_ring', 'x', 'y'];
  assert.equal(P.learnSkill(ch, 'meteor', data), 'needSlot');
  assert.equal(P.learnSkill(ch, 'meteor', data, 2), 'ok');
  assert.equal(ch.slots[2], 'meteor');
});

t('Mốc mở kỹ năng chế độ thử nghiệm 1/1/2/4/6/8', () => {
  const lv = data.skillList.map((s) => P.unlockLevel(s, data.config));
  assert.deepEqual(lv, [1, 1, 2, 4, 6, 8]);
});

t('Hoàn tác không hồi máu (cộng Thể lực rồi hoàn tác nhiều lần)', () => {
  const ch = P.createCharacter(data);
  ch.attrPoints = 5;
  const g = new Game(data, ch, { seed: 1, headless: true });
  g.player.hp = 20;
  g.beginEdit();
  const snap = P.snapshot(ch);
  for (let i = 0; i < 5; i++) {
    P.addAttr(ch, 'vit', 5); g.refreshStats();
    P.restoreAllocation(ch, snap); g.refreshStats();
  }
  P.addAttr(ch, 'vit', 5); g.refreshStats();
  g.endEdit();
  assert.equal(g.player.hp, 20 + 15);
});

t('Giáp giảm sát thương vật lý theo Giáp ÷ (Giáp + 50 + 10 × cấp quái)', () => {
  const ch = P.createCharacter(data);
  const g = new Game(data, ch, { seed: 1, headless: true });
  g.stats.armor = 60; g.stats.dodge = 0;
  const hp = g.player.hp;
  g.hurtPlayer(12, 'physical', 'test', { level: 1 });
  assert.ok(Math.abs(hp - g.player.hp - 12 * (1 - 60 / (60 + 50 + 10))) < 1e-9);
  // bất tử 0,5 giây sau khi trúng đòn
  assert.equal(g.hurtPlayer(12, 'physical', 'test'), false);
});

t('Chết thì giữ cấp và kinh nghiệm', () => {
  const ch = P.createCharacter(data);
  const g = new Game(data, ch, { seed: 1, headless: true });
  g.addXp(100);
  const lvl = ch.level, xp = ch.xp;
  g.stats.dodge = 0;
  g.hurtPlayer(9999, 'physical', 'test');
  assert.ok(g.over && !g.result.win);
  assert.equal(ch.level, lvl);
  assert.equal(ch.xp, xp);
});

t('Mô phỏng 60 giây không lỗi, đúng nhịp sinh quái (tối đa 40 lúc đầu)', () => {
  const ch = P.createCharacter(data);
  const g = new Game(data, ch, { seed: 3, headless: true });
  g.god = true;
  let max = 0;
  for (let i = 0; i < 60 * 60; i++) { g.update(1 / 60); max = Math.max(max, g.aliveNormal); }
  assert.ok(max <= 40, `quái tối đa ${max}`);
  assert.ok(g.kills > 0);
});

console.log(`\n${n} kiểm tra đều qua.`);
