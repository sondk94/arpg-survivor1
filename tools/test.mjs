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
import { exportCode, importCode, newStash, normalizeCharacter } from '../src/core/save.js';
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
  assert.equal(data.skillList.length, 36);
  for (const t of ['weapon', 'shout', 'blood']) assert.deepEqual(by(t), [1, 2, 4, 4, 6, 8], t);
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

t('Đồ: sinh đủ 5 bậc (cả đồ bộ), yêu cầu cấp chặn mặc đồ, chỉ số đồ cộng vào nhân vật', () => {
  const rng = new RNG(5);
  const seen = new Set();
  for (let i = 0; i < 400; i++) seen.add(I.generateItem(rng, data, 12).rarity);
  assert.deepEqual([...seen].sort(), ['magic', 'normal', 'rare', 'set', 'unique']);
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

t('20 màn: máu quái +10% mỗi màn, sát thương +5%, kinh nghiệm +5% (cộng dồn)', () => {
  assert.equal(data.mapOrder.length, 20);
  data.mapOrder.forEach((id, i) => {
    const m = data.maps[id];
    assert.equal(m.index, i);
    if (i > 0) {
      const prev = data.maps[data.mapOrder[i - 1]];
      assert.ok(Math.abs(m.hpMult / prev.hpMult - 1.10) < 1e-9, id);
      assert.ok(Math.abs(m.dmgMult / prev.dmgMult - 1.05) < 1e-9, id);
    }
  });
  const ch = P.createCharacter(data);
  const g1 = new Game(data, ch, { seed: 1, headless: true, mapId: '1-1' });
  const g2 = new Game(data, ch, { seed: 1, headless: true, mapId: '1-2' });
  const g20 = new Game(data, ch, { seed: 1, headless: true, mapId: '4-5' });
  const z1 = g1.spawnEnemy('zombie', 100, 100), z2 = g2.spawnEnemy('zombie', 100, 100), z20 = g20.spawnEnemy('zombie', 100, 100);
  assert.ok(Math.abs(z2.maxHp / z1.maxHp - 1.10) < 1e-9);
  assert.ok(Math.abs(z2.contact / z1.contact - 1.05) < 1e-9);
  assert.ok(Math.abs(z2.xp / z1.xp - 1.05) < 1e-9);
  assert.ok(Math.abs(z20.maxHp / z1.maxHp - Math.pow(1.10, 19)) < 1e-9);
  assert.ok(Math.abs(z20.contact / z1.contact - Math.pow(1.05, 19)) < 1e-9);
  const b1 = g1.spawnEnemy('swamp_lord', 100, 100), b2 = g2.spawnEnemy('swamp_lord', 100, 100);
  assert.ok(Math.abs(b2.maxHp / b1.maxHp - 1.10) < 1e-9);
});

t('Qua màn thì mở màn sau; tiến độ được lưu trong mã nhân vật', () => {
  const ch = P.createCharacter(data);
  assert.deepEqual(P.unlockedMaps(ch, data), ['1-1']);
  const g = new Game(data, ch, { seed: 1, headless: true, mapId: '1-1' });
  g.win();
  assert.equal(g.result.nextMap, '1-2');
  assert.deepEqual(P.unlockedMaps(ch, data), ['1-1', '1-2']);
  // chơi lại màn cũ không mở thêm
  const g2 = new Game(data, ch, { seed: 2, headless: true, mapId: '1-1' });
  g2.win();
  assert.equal(g2.result.nextMap, null);
  assert.equal(P.unlockedMaps(ch, data).length, 2);
  const back = importCode(exportCode(ch, newStash(data), data), data);
  assert.equal(back.ch.mapProgress, 1);
  assert.equal(back.ch.mapClears['1-1'], 2);
});

t('Chướng ngại vật ngẫu nhiên mỗi lượt chơi', () => {
  const ch = P.createCharacter(data);
  const a = new Game(data, ch, { seed: 11, headless: true }).obstacles;
  const b = new Game(data, ch, { seed: 12, headless: true }).obstacles;
  const a2 = new Game(data, ch, { seed: 11, headless: true }).obstacles;
  assert.notDeepEqual(a.map((o) => [o.x, o.y]), b.map((o) => [o.x, o.y]));
  assert.deepEqual(a.map((o) => [o.x, o.y]), a2.map((o) => [o.x, o.y])); // cùng seed thì giống nhau (tái lập mô phỏng)
  // vùng xuất phát luôn trống
  for (const o of b) assert.ok(Math.hypot(o.x - 1500, o.y - 1500) > 260);
});

t('Chiến Binh: chỉ số riêng của lớp, Sức mạnh tăng sát thương vật lý, chỉ học kỹ năng của lớp mình', () => {
  const w = P.createCharacter(data, 'warrior', 'Test');
  assert.equal(w.classId, 'warrior');
  assert.deepEqual(w.attrs, data.classes.warrior.startAttributes);
  const st = P.computeStats(w, data);
  assert.equal(st.maxHp, 60 + 25 * 4 + 1 * 3);
  assert.equal(st.armor, 15);
  assert.ok(Math.abs(P.damageMult(w, data.skills.cleave, st, data) - (1 + 30 * 0.01)) < 1e-9);
  assert.equal(P.learnSkill(w, 'fireball', data), 'Kỹ năng của lớp khác');
  assert.equal(P.learnSkill(w, 'cleave', data), 'ok');
  const m = P.createCharacter(data, 'mage');
  assert.equal(P.learnSkill(m, 'cleave', data), 'Kỹ năng của lớp khác');
});

t('Chiến Binh: chém cận chiến chỉ trúng quái trong tầm và trong vòng cung phía trước', () => {
  const w = P.createCharacter(data, 'warrior');
  w.skills = { cleave: 1 }; w.slots = ['cleave', null, null, null];
  const g = new Game(data, w, { seed: 1, headless: true });
  g.stats.critChance = 0;
  const p = g.player;
  const front = g.spawnEnemy('zombie', p.x + 50, p.y); front.hp = front.maxHp = 1000;
  const back = g.spawnEnemy('zombie', p.x - 50, p.y); back.hp = back.maxHp = 1000;
  const far = g.spawnEnemy('zombie', p.x + 250, p.y); far.hp = far.maxHp = 1000;
  g.grid.rebuild(g.enemies);
  assert.equal(g.castMelee(data.skills.cleave, 1), true);
  assert.ok(front.hp < 1000);
  assert.equal(far.hp, 1000);
  // phía sau: nằm ngoài vòng cung 130° hướng về quái gần nhất (bằng khoảng cách thì lấy con đầu tiên)
  assert.ok(back.hp === 1000 || front.hp === 1000);
});

t('Chiến Binh: buff, cuồng sát, hút máu, nhảy đập, gầm làm quái sợ', () => {
  const w = P.createCharacter(data, 'warrior');
  w.level = 10;
  w.skills = { battle_cry: 1, frenzy: 1, life_leech: 5, leap_slam: 1, howl: 1 };
  const g = new Game(data, w, { seed: 1, headless: true });
  const p = g.player;
  const e = g.spawnEnemy('zombie', p.x + 60, p.y); e.hp = e.maxHp = 1e4;
  g.grid.rebuild(g.enemies);
  const before = g.skillMult(data.skills.cleave);
  g.castBuff(data.skills.battle_cry, 1);
  assert.ok(Math.abs(g.skillMult(data.skills.cleave) - before - 0.25) < 1e-9);
  const z = g.spawnEnemy('zombie', p.x + 30, p.y); g.killEnemy(z, 'physical');
  assert.equal(g.frenzy.stacks, 1);
  p.hp = 10; g.stats.critChance = 0;
  g.damageEnemy(e, 100, 'physical');
  assert.ok(Math.abs(p.hp - (10 + 100 * g.stats.leech)) < 1e-9);
  const x0 = p.x;
  assert.equal(g.castLeap(data.skills.leap_slam, 1), true);
  assert.ok(p.x !== x0 && p.invuln >= 0.4);
  // gầm chỉ tự dùng khi bị vây (hoặc máu thấp)
  p.hp = g.stats.maxHp;
  g.grid.rebuild(g.enemies);
  assert.equal(g.castHowl(data.skills.howl, 1), false);
  p.hp = g.stats.maxHp * 0.3;
  assert.equal(g.castHowl(data.skills.howl, 1), true);
  p.hp = g.stats.maxHp;
  for (const x of g.enemies) x.fearT = 0;
  for (let i = 0; i < 6; i++) g.spawnEnemy('zombie', p.x + Math.cos(i) * 40, p.y + Math.sin(i) * 40);
  g.grid.rebuild(g.enemies);
  assert.equal(g.castHowl(data.skills.howl, 1), true);
  assert.ok(g.enemies.some((x) => x.fearT > 0));
});

t('Nhân vật cũ (chưa có lớp) được đọc thành Pháp sư; mã của Chiến Binh giữ đúng lớp', () => {
  const old = normalizeCharacter({ level: 7, skills: { fireball: 2 }, slots: ['fireball', null, null, null] }, data);
  assert.equal(old.classId, 'mage');
  assert.equal(old.skills.fireball, 2);
  const w = P.createCharacter(data, 'warrior', 'Thiết Hùng');
  w.skills = { cleave: 3, fireball: 2 }; // kỹ năng lớp khác bị loại khi đọc lại
  const back = importCode(exportCode(w, newStash(data), data), data).ch;
  assert.equal(back.classId, 'warrior');
  assert.equal(back.name, 'Thiết Hùng');
  assert.equal(back.uid, w.uid);
  assert.deepEqual(back.skills, { cleave: 3 });
});

t('Lỗ và rune: ghép rune cộng chỉ số theo loại đồ; hết lỗ thì không ghép được', () => {
  const rng = new RNG(3);
  const ch = P.createCharacter(data, 'mage');
  const staff = I.generateItem(rng, data, 10, { rarity: 'normal', baseId: 'staff' });
  staff.sockets = 1;
  const helm = I.generateItem(rng, data, 10, { rarity: 'normal', baseId: 'cap' });
  helm.sockets = 1;
  ch.inventory[0] = I.generateRune(rng, data, 1, 'r_ash');
  ch.inventory[1] = I.generateRune(rng, data, 1, 'r_ash');
  ch.inventory[2] = I.generateRune(rng, data, 1, 'r_ash');
  assert.equal(I.insertRune(ch, 0, staff, data), 'ok');
  assert.equal(I.itemStats(staff).fireDmgPct, (staff.stats.fireDmgPct || 0) + 10); // vũ khí: +10% sát thương lửa
  assert.equal(I.insertRune(ch, 1, staff, data), 'Món đồ không còn lỗ trống');
  assert.equal(I.insertRune(ch, 1, helm, data), 'ok');
  assert.equal(I.itemStats(helm).resFire, 12); // giáp: +12% kháng lửa
  // mặc vào thì chỉ số rune có tác dụng (gậy cần cấp 5)
  ch.level = 10;
  ch.equipment.weapon = staff;
  assert.ok(Math.abs(P.computeStats(ch, data).elemDmgPct.fire - (I.itemStats(staff).fireDmgPct) / 100) < 1e-9);
});

t('Ghép 3 rune cùng loại thành 1 rune bậc cao hơn', () => {
  const rng = new RNG(4);
  const ch = P.createCharacter(data);
  ch.gold = 1000;
  for (let i = 0; i < 3; i++) ch.inventory[i] = I.generateRune(rng, data, 1, 'r_frost');
  assert.equal(I.combineRunes(ch, 'r_frost', data, rng), 'ok');
  assert.deepEqual(I.runeCounts(ch), { r_storm: 1 });
  assert.equal(ch.gold, 1000 - data.items.crafting.runeCombine.goldPerTier * 2);
});

t('Đồ bộ: mặc đủ 2 món và 3 món được thêm thưởng', () => {
  const rng = new RNG(5);
  const ch = P.createCharacter(data, 'mage');
  ch.level = 20;
  const set = data.items.setsById.set_fire;
  const pieces = set.pieces.map((pc) => ({ uid: pc.id, base: pc.base, type: data.items.basesById[pc.base].type, rarity: 'set', set: set.id, piece: pc.id, name: pc.name, ilvl: 15, req: { level: pc.req, str: 0 }, stats: { ...pc.stats }, sockets: 0, runes: [] }));
  const base = P.computeStats(ch, data).elemDmgPct.fire;
  ch.equipment.head = pieces[0];
  const one = P.computeStats(ch, data).elemDmgPct.fire;
  ch.equipment.gloves = pieces[2];
  const two = P.computeStats(ch, data);
  assert.ok(Math.abs(two.elemDmgPct.fire - one - (pieces[2].stats.fireDmgPct + set.bonus['2'].fireDmgPct) / 100) < 1e-9);
  ch.equipment.body = pieces[1];
  const three = P.computeStats(ch, data);
  assert.equal(three.skillBonus.fire, 1);
  assert.deepEqual(three.sets.map((x) => [x.id, x.count]), [['set_fire', 3]]);
  assert.ok(one > base);
});

t('Lò chế: phân giải ra mảnh, nâng bậc, đổi dòng, đục lỗ, gỡ rune', () => {
  const rng = new RNG(6);
  const ch = P.createCharacter(data);
  const stash = newStash(data);
  ch.inventory[0] = I.generateItem(rng, data, 10, { rarity: 'rare' });
  const v = I.salvageValue(ch.inventory[0], data);
  assert.equal(I.craft(ch, stash, { where: 'inv', key: 0 }, 'salvage', data, rng), 'ok');
  assert.equal(ch.shards, v);
  assert.equal(ch.inventory[0], null);
  ch.shards = 100; ch.gold = 5000;
  ch.inventory[1] = I.generateItem(rng, data, 10, { rarity: 'normal', baseId: 'staff' });
  ch.inventory[1].sockets = 0;
  assert.equal(I.craft(ch, stash, { where: 'inv', key: 1 }, 'upgrade', data, rng), 'ok');
  assert.equal(ch.inventory[1].rarity, 'magic');
  assert.equal(ch.inventory[1].base, 'staff');
  assert.equal(I.craft(ch, stash, { where: 'inv', key: 1 }, 'reroll', data, rng), 'ok');
  assert.equal(I.craft(ch, stash, { where: 'inv', key: 1 }, 'socket', data, rng), 'ok');
  assert.equal(ch.inventory[1].sockets, 1);
  ch.inventory[2] = I.generateRune(rng, data, 1, 'r_ash');
  I.insertRune(ch, 2, ch.inventory[1], data);
  assert.equal(I.craft(ch, stash, { where: 'inv', key: 1 }, 'unsocket', data, rng), 'ok');
  assert.equal(ch.inventory[1].runes.length, 0);
  ch.shards = 0;
  assert.match(I.craft(ch, stash, { where: 'inv', key: 1 }, 'socket', data, rng), /Cần .* mảnh/);
});

t('Độ khó: Ác mộng mở sau khi qua hết Bình thường; quái mạnh hơn, có kháng; người chơi bị trừ kháng', () => {
  const ch = P.createCharacter(data);
  assert.deepEqual(P.unlockedDifficulties(ch, data), ['normal']);
  assert.deepEqual(P.unlockedMaps(ch, data, 'nightmare'), []);
  ch.mapProgress = 19;
  const g = new Game(data, ch, { seed: 1, headless: true, mapId: '4-5' });
  g.win();
  assert.equal(g.result.newDifficulty, 'nightmare');
  assert.deepEqual(P.unlockedMaps(ch, data, 'nightmare'), ['1-1']);
  const n = data.difficultiesById.nightmare;
  const gn = new Game(data, ch, { seed: 1, headless: true, mapId: '1-1', difficulty: 'nightmare' });
  const gb = new Game(data, ch, { seed: 1, headless: true, mapId: '1-1' });
  const zn = gn.spawnEnemy('zombie', 100, 100), zb = gb.spawnEnemy('zombie', 100, 100);
  assert.ok(Math.abs(zn.maxHp / zb.maxHp - n.hpMult) < 1e-9);
  assert.ok(Math.abs(zn.contact / zb.contact - n.dmgMult) < 1e-9);
  assert.equal(zn.resist.fire, n.monsterResist);
  gn.stats.dodge = 0; gn.stats.resist.fire = 0;
  const hp = gn.player.hp;
  gn.hurtPlayer(10, 'fire', 'test');
  assert.ok(Math.abs(hp - gn.player.hp - 10 * (1 + n.playerResistPenalty)) < 1e-9);
  // kỷ lục thời gian
  gn.time = 300; gn.win();
  assert.equal(ch.records['nightmare:1-1'], 300);
  assert.equal(gn.result.newRecord, true);
});

t('Tìm cụm quái không trả về NaN khi quái vừa sinh chưa vào lưới (lỗi Nhảy Đập đưa người chơi về NaN)', () => {
  const w = P.createCharacter(data, 'warrior');
  w.skills = { leap_slam: 1 };
  const g = new Game(data, w, { seed: 1, headless: true });
  g.grid.rebuild(g.enemies); // lưới rỗng
  g.spawnEnemy('zombie', g.player.x + 100, g.player.y); // sinh sau khi dựng lưới
  const t = g.densestPoint(300, 110);
  assert.ok(t === null || (Number.isFinite(t.x) && Number.isFinite(t.y)));
  g.castLeap(data.skills.leap_slam, 1);
  assert.ok(Number.isFinite(g.player.x) && Number.isFinite(g.player.y));
});

t('Mỗi điểm Sức mạnh cộng thêm cho +2 sát thương vật lý mỗi đòn (không áp dụng cho phép)', () => {
  const w = P.createCharacter(data, 'warrior');
  w.attrPoints = 10;
  assert.equal(P.computeStats(w, data).physFlat, 0);
  P.addAttr(w, 'str', 10);
  const st = P.computeStats(w, data);
  assert.equal(st.physFlat, 20);
  const [a, b] = P.damageRange(data.skills.cleave, 1);
  assert.deepEqual(P.hitRange(data.skills.cleave, 1, st), [a + 20 * 0.6, b + 20 * 0.6]); // Chém Bổ nhận 60%
  // Sức mạnh từ đồ cũng tính
  w.equipment.ring1 = { uid: 'r', base: 'ring', type: 'ring', rarity: 'magic', name: 'r', ilvl: 1, req: { level: 1, str: 0 }, stats: { str: 5 }, sockets: 0, runes: [] };
  assert.equal(P.computeStats(w, data).physFlat, 30);
  // kỹ năng phép không được cộng
  const m = P.createCharacter(data, 'mage');
  m.attrs.str += 10;
  const sm = P.computeStats(m, data);
  assert.deepEqual(P.hitRange(data.skills.fireball, 1, sm), P.damageRange(data.skills.fireball, 1));
  // trong trận: đòn chém nhận +12 (60% của +20) trước khi nhân hệ số
  const g = new Game(data, w, { seed: 1, headless: true });
  w.equipment.ring1 = null; g.refreshStats();
  const mult = g.skillMult(data.skills.cleave);
  for (let i = 0; i < 20; i++) {
    const d = g.rollSkill(data.skills.cleave, 1, mult);
    assert.ok(d >= (a + 12) * mult - 1e-9 && d <= (b + 12) * mult + 1e-9);
  }
});

t('Năng lượng cộng thêm: +2 sát thương phép mỗi đòn, nhân hệ số flatScale của từng kỹ năng', () => {
  const m = P.createCharacter(data, 'mage');
  m.attrPoints = 10;
  P.addAttr(m, 'ene', 10);
  const st = P.computeStats(m, data);
  assert.equal(st.spellFlat, 20);
  assert.equal(st.physFlat, 0);
  const [a, b] = P.damageRange(data.skills.fireball, 1);
  assert.deepEqual(P.hitRange(data.skills.fireball, 1, st), [a + 20, b + 20]);         // đòn đơn: đủ 100%
  const [oa] = P.damageRange(data.skills.frozen_orb, 1);
  assert.ok(Math.abs(P.hitRange(data.skills.frozen_orb, 1, st)[0] - (oa + 2)) < 1e-9);  // mảnh Cầu Băng Xoay: 10%
  const [ea] = P.damageRange(data.skills.ember_ring, 1);
  assert.ok(Math.abs(P.hitRange(data.skills.ember_ring, 1, st)[0] - (ea + 5)) < 1e-9);  // Vòng Than: 25%
  // vùng theo giây: Bão Tuyết nhận +20/giây
  m.level = 10; m.skills.blizzard = 1;
  const g = new Game(data, m, { seed: 1, headless: true });
  g.spawnEnemy('zombie', g.player.x + 100, g.player.y);
  g.grid.rebuild(g.enemies);
  g.castStorm(data.skills.blizzard, 1);
  assert.equal(g.zones[0].dps, P.lv(data.skills.blizzard.dps, 1) + 20);
  // Sức mạnh cũng theo flatScale: Lốc Xoáy 35%
  const w = P.createCharacter(data, 'warrior');
  w.attrPoints = 10; P.addAttr(w, 'str', 10);
  const sw = P.computeStats(w, data);
  const [wa] = P.damageRange(data.skills.whirlwind, 1);
  assert.ok(Math.abs(P.hitRange(data.skills.whirlwind, 1, sw)[0] - (wa + 7)) < 1e-9);
  // Năng lượng không cộng cho kỹ năng vật lý
  w.attrs.ene += 10;
  assert.ok(Math.abs(P.hitRange(data.skills.whirlwind, 1, P.computeStats(w, data))[0] - (wa + 7)) < 1e-9);
});

console.log(`\n${n} kiểm tra đều qua.`);
