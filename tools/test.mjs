#!/usr/bin/env node
// Kiểm tra nhanh các công thức trong tài liệu thiết kế: node tools/test.mjs
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
import { loadData } from '../src/core/data.js';
import { Game } from '../src/core/game.js';
import * as P from '../src/core/progression.js';
import * as I from '../src/core/items.js';
import { exportCode, importCode, newStash } from '../src/core/save.js';
import { RNG } from '../src/core/rng.js';

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
  // Thông Thạo Lửa không cộng cho kỹ năng băng
  ch.skills.ice_bolt = 1;
  assert.ok(Math.abs(P.damageMult(ch, data.skills.ice_bolt, s, data) - (1 + 30 * 0.005)) < 1e-9);
});

t('Lên cấp: +5 điểm thuộc tính, +1 điểm kỹ năng, hồi đầy máu/mana', () => {
  const ch = P.createCharacter(data);
  const g = new Game(data, ch, { seed: 1, headless: true });
  g.player.hp = 10; g.player.mana = 0;
  g.addXp(20);
  assert.equal(ch.level, 2);
  assert.equal(ch.attrPoints, 5);
  assert.equal(ch.skillPoints, data.config.player.startSkillPoints + 1);
  assert.equal(g.player.hp, g.stats.maxHp);
  assert.equal(g.player.mana, g.stats.maxMana);
});

t('Học kỹ năng: tự vào ô trống; đầy 4 ô thì hỏi thay', () => {
  const ch = P.createCharacter(data);
  ch.level = 20; ch.skillPoints = 10;
  assert.equal(P.learnSkill(ch, 'fireball', data), 'ok');
  assert.equal(P.learnSkill(ch, 'ember_ring', data), 'ok');
  assert.deepEqual(ch.slots, ['fireball', 'ember_ring', null, null]);
  ch.slots = ['fireball', 'ember_ring', 'x', 'y'];
  assert.equal(P.learnSkill(ch, 'meteor', data), 'needSlot');
  assert.equal(P.learnSkill(ch, 'meteor', data, 2), 'ok');
  assert.equal(ch.slots[2], 'meteor');
});

t('Mốc mở kỹ năng chế độ thử nghiệm: Lửa 1/1/2/4/6/8, Băng và Sét 1/2/4/4/6/8', () => {
  const by = (tree) => data.skillList.filter((s) => s.tree === tree).map((s) => P.unlockLevel(s, data.config)).sort((a, b) => a - b);
  assert.deepEqual(by('fire'), [1, 1, 2, 4, 6, 8]);
  assert.deepEqual(by('cold'), [1, 2, 4, 4, 6, 8]);
  assert.deepEqual(by('lightning'), [1, 2, 4, 4, 6, 8]);
  assert.equal(data.skillList.length, 18);
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
  P.learnSkill(ch, 'fireball', data);
  const g = new Game(data, ch, { seed: 3, headless: true });
  g.god = true;
  let max = 0;
  for (let i = 0; i < 60 * 60; i++) { g.update(1 / 60); max = Math.max(max, g.aliveNormal); }
  assert.ok(max <= 40, `quái tối đa ${max}`);
  assert.ok(g.kills > 0);
});

t('Đóng băng sau 3 đòn băng liên tiếp; tinh anh nửa thời gian; boss miễn nhiễm', () => {
  const ch = P.createCharacter(data);
  const g = new Game(data, ch, { seed: 1, headless: true });
  const e = g.spawnEnemy('zombie', 100, 100); e.hp = e.maxHp = 1e6;
  g.damageEnemy(e, 1, 'cold'); g.damageEnemy(e, 1, 'cold');
  assert.ok(!e.frozenT);
  g.damageEnemy(e, 1, 'cold');
  assert.equal(e.frozenT, 1);
  const el = g.spawnEnemy('zombie', 100, 100); g.makeElite(el); el.hp = 1e6;
  for (let i = 0; i < 3; i++) g.damageEnemy(el, 1, 'cold');
  assert.equal(el.frozenT, 0.5);
  const b = g.spawnEnemy('swamp_lord', 100, 100);
  for (let i = 0; i < 5; i++) g.damageEnemy(b, 1, 'cold');
  assert.ok(!b.frozenT);
  // không liên tiếp (cách nhau quá 2 giây) thì đếm lại
  const z = g.spawnEnemy('zombie', 100, 100); z.hp = 1e6;
  g.damageEnemy(z, 1, 'cold'); g.damageEnemy(z, 1, 'cold'); g.time += 3; g.damageEnemy(z, 1, 'cold');
  assert.ok(!z.frozenT);
});

t('Kháng nguyên tố của quái giảm đúng sát thương nguyên tố đó', () => {
  const ch = P.createCharacter(data);
  const g = new Game(data, ch, { seed: 1, headless: true });
  g.stats.critChance = 0;
  const e = g.spawnEnemy('zombie', 100, 100); e.hp = e.maxHp = 1000;
  e.resist = { fire: 0.5, cold: 0, lightning: -0.5 };
  assert.equal(g.damageEnemy(e, 100, 'fire'), 50);
  assert.equal(g.damageEnemy(e, 100, 'lightning'), 150);
  assert.equal(g.damageEnemy(e, 100, 'cold', {}), 100);
});

t('Sét gây thêm sát thương lên tinh anh và trùm nhỏ, không lên boss/quái thường', () => {
  const ch = P.createCharacter(data);
  const g = new Game(data, ch, { seed: 1, headless: true });
  g.stats.critChance = 0;
  const bonus = data.config.eliteDmgBonus.lightning;
  const el = g.spawnEnemy('zombie', 100, 100); g.makeElite(el); el.hp = el.maxHp = 1e4;
  const z = g.spawnEnemy('zombie', 100, 100); z.hp = z.maxHp = 1e4;
  const mb = g.spawnEnemy('gravedigger', 100, 100);
  const b = g.spawnEnemy('swamp_lord', 100, 100);
  assert.ok(Math.abs(g.damageEnemy(el, 100, 'lightning') - 100 * (1 + bonus)) < 1e-9);
  assert.ok(Math.abs(g.damageEnemy(mb, 100, 'lightning') - 100 * (1 + bonus)) < 1e-9);
  assert.equal(g.damageEnemy(z, 100, 'lightning'), 100);
  assert.equal(g.damageEnemy(b, 100, 'lightning'), 100);
  assert.equal(g.damageEnemy(el, 100, 'fire'), 100);
  // dòng trên đồ cộng thêm
  ch.equipment.ring1 = { uid: 'r', base: 'ring', type: 'ring', rarity: 'magic', name: 'r', ilvl: 5, req: { level: 1, str: 0 }, stats: { lightningEliteDmgPct: 20 } };
  assert.ok(Math.abs(P.computeStats(ch, data).eliteDmgPct.lightning - (bonus + 0.2)) < 1e-9);
});

t('Trường Tĩnh Điện: 15% máu hiện tại, boss 5%', () => {
  const ch = P.createCharacter(data);
  ch.level = 10; ch.skillPoints = 5;
  const g = new Game(data, ch, { seed: 1, headless: true });
  ch.skills.static_field = 1;
  g.stats.critChance = 0;
  const z = g.spawnEnemy('zombie', g.player.x + 50, g.player.y); z.hp = z.maxHp = 1000;
  const b = g.spawnEnemy('swamp_lord', g.player.x - 60, g.player.y);
  g.grid.rebuild(g.enemies);
  g.castStatic(data.skills.static_field, 1);
  assert.equal(z.hp, 850);
  assert.equal(b.hp, 2500 * 0.95);
});

t('Đồ: sinh đủ 4 bậc, yêu cầu cấp chặn mặc đồ, chỉ số đồ cộng vào nhân vật', () => {
  const rng = new RNG(5);
  const seen = new Set();
  for (let i = 0; i < 400; i++) seen.add(I.generateItem(rng, data, 12).rarity);
  assert.deepEqual([...seen].sort(), ['magic', 'normal', 'rare', 'unique']);
  const ch = P.createCharacter(data);
  const it = I.generateItem(rng, data, 10, { rarity: 'unique', type: 'amulet' }); // Mắt Xác Sống, cần cấp 10
  ch.inventory[0] = it;
  assert.match(I.equipFromInventory(ch, 0, data), /Cần cấp 10/);
  ch.level = 10;
  const before = P.computeStats(ch, data);
  assert.equal(I.equipFromInventory(ch, 0, data), 'ok');
  const after = P.computeStats(ch, data);
  assert.equal(after.maxHp - before.maxHp, 15);
  assert.equal(after.skillBonus.all, 1);
  ch.skills.fireball = 2;
  assert.equal(P.skillLevel(ch, 'fireball', data, after), 3);
  assert.equal(P.skillLevel(ch, 'ice_bolt', data, after), 0); // +kỹ năng chỉ cộng cho kỹ năng đã học
  // Tụt cấp yêu cầu (VD: nhập mã cũ) thì món đồ không còn tác dụng
  ch.level = 9;
  assert.deepEqual(P.computeStats(ch, data).inactiveGear, ['amulet']);
});

t('Synergy chỉ tính điểm cộng thật, không tính cấp từ đồ', () => {
  const ch = P.createCharacter(data);
  ch.skills = { fireball: 1, meteor: 2 };
  ch.equipment.amulet = { uid: 'x', base: 'amulet', type: 'amulet', rarity: 'magic', name: 'x', ilvl: 1, req: { level: 1, str: 0 }, stats: { fireSkills: 2 } };
  const s = P.computeStats(ch, data);
  assert.equal(P.skillLevel(ch, 'meteor', data, s), 4);
  assert.ok(Math.abs(P.synergyPct(ch, data.skills.fireball) - 2 * 0.06) < 1e-9);
});

t('Tẩy điểm trả lại đủ điểm và trừ vàng', () => {
  const ch = P.createCharacter(data);
  ch.level = 8; ch.gold = 1000; ch.attrs.vit += 35; ch.skills = { fireball: 5, ember_ring: 3 }; ch.slots = ['fireball', 'ember_ring', null, null];
  assert.equal(P.respec(ch, data), 'ok');
  assert.equal(ch.gold, 1000 - 40 * 8);
  assert.equal(ch.attrPoints, 35);
  assert.equal(ch.skillPoints, 1 + 7);
  assert.deepEqual(ch.skills, {});
});

t('Xuất mã rồi nhập lại vẫn đủ cấp, điểm, đồ và rương', () => {
  const rng = new RNG(9);
  const ch = P.createCharacter(data);
  ch.level = 12; ch.xp = 345; ch.attrPoints = 7; ch.skillPoints = 2; ch.gold = 777;
  ch.skills = { ice_bolt: 6, frost_nova: 2 }; ch.slots = ['ice_bolt', 'frost_nova', null, null];
  for (let i = 0; i < 5; i++) ch.inventory[i] = I.generateItem(rng, data, 12);
  ch.equipment.weapon = I.generateItem(rng, data, 12, { type: 'weapon' });
  const stash = newStash(data);
  stash[3] = I.generateItem(rng, data, 12, { rarity: 'unique' });
  const code = exportCode(ch, stash, data);
  const back = importCode(code, data);
  for (const k of ['level', 'xp', 'attrPoints', 'skillPoints', 'gold', 'attrs', 'skills', 'slots', 'inventory', 'equipment']) assert.deepEqual(back.ch[k], ch[k], k);
  assert.deepEqual(back.stash, stash);
  assert.throws(() => importCode(code.slice(0, -3) + 'abc', data), /hỏng/);
  assert.throws(() => importCode('xyz', data), /định dạng/);
});

console.log(`\n${n} kiểm tra đều qua.`);
