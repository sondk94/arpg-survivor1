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
import * as L from '../src/core/loot.js';
import * as S from '../src/core/save.js';

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
  assert.equal(data.skillList.length, 54);
  for (const t of ['weapon', 'shout', 'blood', 'pack', 'beast', 'swarm']) assert.deepEqual(by(t), [1, 2, 4, 4, 6, 8], t);
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
  assert.equal(b.hp, b.maxHp * 0.95); // boss chỉ mất 5% (máu boss đã nhân hệ số boss của độ khó)
  assert.equal(b.maxHp, 2500 * data.difficultiesById.normal.bossHpMult);
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

t('20 màn: máu quái và sát thương tăng theo hpStep / dmgStep mỗi màn, kinh nghiệm +5% (cộng dồn)', () => {
  assert.equal(data.mapOrder.length, 20);
  data.mapOrder.forEach((id, i) => {
    const m = data.maps[id];
    assert.equal(m.index, i);
    if (i > 0) {
      const prev = data.maps[data.mapOrder[i - 1]];
      assert.ok(Math.abs(m.hpMult / prev.hpMult - (1 + data.campaign.hpStep)) < 1e-9, id);
      assert.ok(Math.abs(m.dmgMult / prev.dmgMult - (1 + data.campaign.dmgStep)) < 1e-9, id);
    }
  });
  const ch = P.createCharacter(data);
  const g1 = new Game(data, ch, { seed: 1, headless: true, mapId: '1-1' });
  const g2 = new Game(data, ch, { seed: 1, headless: true, mapId: '1-2' });
  const g20 = new Game(data, ch, { seed: 1, headless: true, mapId: '4-5' });
  const z1 = g1.spawnEnemy('zombie', 100, 100), z2 = g2.spawnEnemy('zombie', 100, 100), z20 = g20.spawnEnemy('zombie', 100, 100);
  assert.ok(Math.abs(z2.maxHp / z1.maxHp - (1 + data.campaign.hpStep)) < 1e-9);
  assert.ok(Math.abs(z2.contact / z1.contact - (1 + data.campaign.dmgStep)) < 1e-9);
  assert.ok(Math.abs(z2.xp / z1.xp - 1.05) < 1e-9);
  assert.ok(Math.abs(z20.maxHp / z1.maxHp - Math.pow(1 + data.campaign.hpStep, 19)) < 1e-9);
  assert.ok(Math.abs(z20.contact / z1.contact - Math.pow(1 + data.campaign.dmgStep, 19)) < 1e-9);
  const b1 = g1.spawnEnemy('swamp_lord', 100, 100), b2 = g2.spawnEnemy('swamp_lord', 100, 100);
  assert.ok(Math.abs(b2.maxHp / b1.maxHp - (1 + data.campaign.hpStep)) < 1e-9);
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
  assert.equal(st.armor, Math.round(15 * 1.5)); // Chiến Binh: tổng giáp ×1,5
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

t('Mỗi điểm Sức mạnh cộng thêm cho +1 sát thương vật lý mỗi đòn (không áp dụng cho phép)', () => {
  const w = P.createCharacter(data, 'warrior');
  w.attrPoints = 10;
  assert.equal(P.computeStats(w, data).physFlat, 0);
  P.addAttr(w, 'str', 10);
  const st = P.computeStats(w, data);
  assert.equal(st.physFlat, 10);
  const [a, b] = P.damageRange(data.skills.cleave, 1);
  assert.deepEqual(P.hitRange(data.skills.cleave, 1, st), [a + 10 * 0.6, b + 10 * 0.6]); // Chém Bổ nhận 60%
  // Sức mạnh từ đồ cũng tính
  w.equipment.ring1 = { uid: 'r', base: 'ring', type: 'ring', rarity: 'magic', name: 'r', ilvl: 1, req: { level: 1, str: 0 }, stats: { str: 5 }, sockets: 0, runes: [] };
  assert.equal(P.computeStats(w, data).physFlat, 15);
  // kỹ năng phép không được cộng
  const m = P.createCharacter(data, 'mage');
  m.attrs.str += 10;
  const sm = P.computeStats(m, data);
  assert.deepEqual(P.hitRange(data.skills.fireball, 1, sm), P.damageRange(data.skills.fireball, 1));
  // trong trận: đòn chém nhận +6 (60% của +10) trước khi nhân hệ số
  const g = new Game(data, w, { seed: 1, headless: true });
  w.equipment.ring1 = null; g.refreshStats();
  const mult = g.skillMult(data.skills.cleave);
  for (let i = 0; i < 20; i++) {
    const d = g.rollSkill(data.skills.cleave, 1, mult);
    assert.ok(d >= (a + 6) * mult - 1e-9 && d <= (b + 6) * mult + 1e-9);
  }
});

t('Năng lượng cộng thêm: +1 sát thương phép mỗi đòn, nhân hệ số flatScale của từng kỹ năng', () => {
  const m = P.createCharacter(data, 'mage');
  m.attrPoints = 10;
  P.addAttr(m, 'ene', 10);
  const st = P.computeStats(m, data);
  assert.equal(st.spellFlat, 10);
  assert.equal(st.physFlat, 0);
  const [a, b] = P.damageRange(data.skills.fireball, 1);
  assert.deepEqual(P.hitRange(data.skills.fireball, 1, st), [a + 10, b + 10]);         // đòn đơn: đủ 100%
  const [oa] = P.damageRange(data.skills.frozen_orb, 1);
  assert.ok(Math.abs(P.hitRange(data.skills.frozen_orb, 1, st)[0] - (oa + 1)) < 1e-9);  // mảnh Cầu Băng Xoay: 10%
  const [ea] = P.damageRange(data.skills.ember_ring, 1);
  assert.ok(Math.abs(P.hitRange(data.skills.ember_ring, 1, st)[0] - (ea + 2.5)) < 1e-9);  // Vòng Than: 25%
  // vùng theo giây: Bão Tuyết nhận +10/giây
  m.level = 10; m.skills.blizzard = 1;
  const g = new Game(data, m, { seed: 1, headless: true });
  g.spawnEnemy('zombie', g.player.x + 100, g.player.y);
  g.grid.rebuild(g.enemies);
  g.castStorm(data.skills.blizzard, 1);
  assert.equal(g.zones[0].dps, P.lv(data.skills.blizzard.dps, 1) + 10);
  // Sức mạnh cũng theo flatScale: Lốc Xoáy 35%
  const w = P.createCharacter(data, 'warrior');
  w.attrPoints = 10; P.addAttr(w, 'str', 10);
  const sw = P.computeStats(w, data);
  const [wa] = P.damageRange(data.skills.whirlwind, 1);
  assert.ok(Math.abs(P.hitRange(data.skills.whirlwind, 1, sw)[0] - (wa + 3.5)) < 1e-9);
  // Năng lượng không cộng cho kỹ năng vật lý
  w.attrs.ene += 10;
  assert.ok(Math.abs(P.hitRange(data.skills.whirlwind, 1, P.computeStats(w, data))[0] - (wa + 3.5)) < 1e-9);
});


// ---------- Triệu hồi sư ----------
function summoner(skills, ene = 0) {
  const c = P.createCharacter(data, 'summoner');
  c.level = 30;
  c.attrPoints = ene;
  if (ene) P.addAttr(c, 'ene', ene);
  Object.assign(c.skills, skills);
  c.slots = Object.keys(skills).filter((id) => data.skills[id].type === 'active').slice(0, 4);
  while (c.slots.length < 4) c.slots.push(null);
  return c;
}

t('Triệu hồi sư: Năng lượng cộng thêm +1 sát thương mỗi đòn và +1% máu cho vật triệu hồi', () => {
  const c = summoner({ summon_wolf: 1 }, 10);
  const st = P.computeStats(c, data);
  assert.equal(st.summonFlat, 10);
  assert.ok(Math.abs(st.summonHpMult - 1.1) < 1e-9);
  const sk = data.skills.summon_wolf;
  const [a] = P.damageRange(sk, 1);
  assert.ok(Math.abs(P.hitRange(sk, 1, st)[0] - (a + 10 * sk.flatScale)) < 1e-9);
  // hệ số sát thương của thú không dùng %vật lý của Sức mạnh
  c.attrs.str += 50;
  const m1 = P.damageMult(c, sk, P.computeStats(c, data), data);
  c.attrs.str -= 50;
  assert.ok(Math.abs(m1 - P.damageMult(c, sk, st, data)) < 1e-9);
});

t('Gọi Sói: số sói theo cấp, chết thì gọi lại, không vượt giới hạn', () => {
  const sk = data.skills.summon_wolf;
  const c = summoner({ summon_wolf: 12 });
  const g = new Game(data, c, { seed: 3, headless: true });
  g.update(1 / 60);
  assert.equal(g.minions.filter((m) => m.kind === 'wolf').length, 4);
  // không gọi thêm khi đủ
  assert.equal(g.castSummon(sk, 12), false);
  g.minions[0].hp = 0; g.minions[0].dead = true;
  g.minions = g.minions.filter((m) => !m.dead);
  assert.equal(g.castSummon(sk, 12), true);
  assert.equal(g.minions.length, 4);
});

t('Quái đuổi vật triệu hồi gần hơn; gấu khiêu khích quái trong tầm', () => {
  const c = summoner({ summon_bear: 1 });
  const g = new Game(data, c, { seed: 4, headless: true });
  const p = g.player;
  const bear = g.spawnMinion(data.skills.summon_bear, 1, p.x + 300, p.y);
  const e = g.spawnEnemy('zombie', p.x + 300 + 120, p.y);
  assert.equal(g.enemyTarget(e), bear); // trong tầm khiêu khích
  const e2 = g.spawnEnemy('zombie', p.x - 60, p.y);
  assert.equal(g.enemyTarget(e2), p); // người chơi gần hơn, ngoài tầm khiêu khích
  // quái chạm gấu thì gấu mất máu
  e.x = bear.x + 10; e.y = bear.y;
  const hp = bear.hp;
  g.grid.rebuild(g.enemies);
  g.updateEnemies(1 / 60);
  assert.ok(bear.hp < hp);
});

t('Vật triệu hồi tự đánh quái và gây sát thương', () => {
  const c = summoner({ summon_wolf: 5, summon_bear: 1 }, 20);
  const g = new Game(data, c, { seed: 5, headless: true });
  g.events = []; g.updateSpawner = () => {};
  const p = g.player;
  const e = g.spawnEnemy('zombie', p.x + 150, p.y);
  e.speed = 0; e.hp = e.maxHp = 1e6;
  for (let i = 0; i < 300; i++) g.update(1 / 60);
  assert.ok(g.effDamage > 0);
  assert.ok(g.minions.length >= 2);
});

t('Đồ của Triệu hồi sư: +% sát thương / máu vật triệu hồi và +cấp nhánh', () => {
  const c = summoner({ summon_wolf: 1 });
  c.equipment.weapon = { uid: 'w', base: 'beast_staff', type: 'weapon', rarity: 'magic', name: 'x', ilvl: 1, req: { level: 1, str: 0 }, stats: { summonDmgPct: 20, summonHpPct: 30, packSkills: 2 }, sockets: 0, runes: [] };
  const st = P.computeStats(c, data);
  const base = P.computeStats(summoner({ summon_wolf: 1 }), data);
  assert.ok(Math.abs(st.summonDmgPct - base.summonDmgPct - 0.2) < 1e-9);
  assert.ok(Math.abs(st.summonHpMult - base.summonHpMult - 0.3) < 1e-9);
  assert.equal(P.skillLevel(c, 'summon_wolf', data, st), 3);
});

// ---------- Rương thưởng và quản lý đồ ----------
function bossGame(fill = 0) {
  const c = P.createCharacter(data, 'mage');
  c.level = 10; c.skills.fireball = 1; c.slots[0] = 'fireball';
  const r = new RNG(3);
  for (let i = 0; i < fill; i++) c.inventory[i] = I.generateItem(r, data, 10);
  const g = new Game(data, c, { seed: 9, headless: true });
  g.events = []; g.updateSpawner = () => {};
  g.spawnBoss('swamp_lord');
  for (let i = 0; i < 5; i++) g.spawnEnemy('zombie', g.player.x + 300, g.player.y + i * 20);
  return { c, g };
}

t('Hạ boss: quái biến mất, rơi rương, chưa kết thúc; nhặt rương 5 giây sau mới kết thúc', () => {
  const { c, g } = bossGame();
  g.killEnemy(g.boss, 'fire');
  assert.equal(g.over, false);
  assert.ok(g.victory);
  assert.equal(g.enemies.filter((e) => !e.dead).length, 0);
  const chest = g.pickups.find((k) => k.kind === 'chest');
  assert.ok(chest);
  const t0 = g.time;
  for (let i = 0; i < 120; i++) g.update(1 / 60);
  assert.equal(g.time, t0); // đồng hồ dừng
  assert.equal(g.enemies.length, 0); // không sinh thêm quái
  assert.equal(g.hurtPlayer(999, 'physical', 'thử'), false); // bất tử
  g.player.x = chest.x; g.player.y = chest.y;
  g.update(1 / 60);
  assert.equal(g.victory.state, 'count');
  const gold0 = c.gold;
  for (let i = 0; i < 60 * 4.5; i++) g.update(1 / 60);
  assert.equal(g.over, false);
  for (let i = 0; i < 60; i++) g.update(1 / 60);
  assert.equal(g.over, true);
  assert.ok(g.result.win);
  assert.ok(g.result.chestLoot.length >= 2); // ít nhất 1 món hiếm + 1 món thêm
  assert.ok(c.gold > gold0);
  assert.ok(c.inventory.filter(Boolean).length >= 2);
});

t('Rương tự mở sau 30 giây; kho đầy thì đồ vào túi tạm, không mất', () => {
  const { g } = bossGame(30);
  g.killEnemy(g.boss, 'fire');
  for (let i = 0; i < 60 * 31; i++) g.update(1 / 60);
  assert.equal(g.victory.state, 'count');
  for (let i = 0; i < 60 * 6; i++) g.update(1 / 60);
  assert.ok(g.over);
  assert.ok(g.result.overflow.length >= g.result.chestLoot.length);
});

t('Bán nhanh: bỏ qua đồ khoá, độc nhất / đồ bộ / rune (trừ khi chọn); mua lại', () => {
  const c = P.createCharacter(data, 'mage');
  const r = new RNG(5);
  c.inventory[0] = I.generateItem(r, data, 5, { rarity: 'normal' });
  c.inventory[1] = I.generateItem(r, data, 5, { rarity: 'normal' });
  c.inventory[1].locked = true;
  c.inventory[2] = I.generateItem(r, data, 20, { rarity: 'unique' });
  c.inventory[3] = I.generateRune(r, data, 5);
  c.inventory[4] = I.generateItem(r, data, 5, { rarity: 'magic' });
  assert.deepEqual(L.bulkCandidates(c, data, 'normal'), [0]);
  assert.deepEqual(L.bulkCandidates(c, data, 'magic'), [4]);
  const worse = L.bulkCandidates(c, data, 'worse');
  assert.ok(!worse.includes(2) && !worse.includes(3) && !worse.includes(1));
  const g0 = c.gold;
  const res = L.sellItems(c, [0, 1], data);
  assert.equal(res.n, 1); // món khoá không bị bán
  assert.equal(c.gold, g0 + res.gold);
  assert.equal(c.buyback.length, 1);
  assert.equal(L.buyBack(c, 0), 'ok');
  assert.equal(c.gold, g0);
  assert.equal(c.buyback.length, 0);
  // tính cả đồ đặc biệt
  assert.ok(L.bulkCandidates(c, data, 'normal', true).length >= 1);
  // mua lại giữ tối đa 10 món
  for (let i = 0; i < 14; i++) { c.inventory[10] = I.generateItem(r, data, 5); L.sellItems(c, [10], data); }
  assert.equal(c.buyback.length, 10);
});

t('Đồ của lớp khác bị nhận ra; so sánh với đồ đang mặc', () => {
  const c = P.createCharacter(data, 'mage');
  const mk = (stats, base = 'ring') => ({ uid: 'x' + Math.random(), base, type: data.items.basesById[base].type, rarity: 'magic', name: 'x', ilvl: 1, req: { level: 1, str: 0 }, stats, sockets: 0, runes: [] });
  assert.equal(L.wrongClass(mk({ physDmgPct: 10 }), c), true);
  assert.equal(L.wrongClass(mk({ physDmgPct: 10, fireDmgPct: 5 }), c), false);
  assert.equal(L.wrongClass(mk({ maxHp: 10 }), c), false);
  assert.equal(L.itemVerdict(mk({ physDmgPct: 10 }), c, data), 'cant');
  assert.equal(L.itemVerdict(mk({ spellDmgPct: 10 }), c, data), 'up'); // ô trống
  c.equipment.ring1 = mk({ spellDmgPct: 30 }); c.equipment.ring2 = mk({ spellDmgPct: 30 });
  assert.equal(L.itemVerdict(mk({ spellDmgPct: 5 }), c, data), 'down');
});

t('Bộ lọc nhặt: bỏ qua / tự bán đồ thường; kho đầy tự bán món rác rẻ nhất', () => {
  const c = P.createCharacter(data, 'mage');
  const g = new Game(data, c, { seed: 2, headless: true });
  g.events = []; g.updateSpawner = () => {};
  const r = new RNG(1);
  c.lootFilter = { normal: 'skip', magicMinLevel: 10, makeRoom: false };
  const n = I.generateItem(r, data, 5, { rarity: 'normal' });
  assert.equal(L.lootDecision(n, c), 'skip');
  assert.equal(L.lootDecision(I.generateItem(r, data, 5, { rarity: 'magic' }), c), 'skip');
  assert.equal(L.lootDecision(I.generateItem(r, data, 12, { rarity: 'magic' }), c), 'pick');
  assert.equal(L.lootDecision(I.generateItem(r, data, 5, { rarity: 'rare' }), c), 'pick');
  g.dropItem(g.player.x, g.player.y, n);
  g.update(1 / 60); g.update(1 / 60);
  assert.equal(c.inventory.filter(Boolean).length, 0);
  // tự bán
  c.lootFilter.normal = 'sell';
  const gold = c.gold;
  g.dropItem(g.player.x + 5, g.player.y, I.generateItem(r, data, 5, { rarity: 'normal' }));
  for (let i = 0; i < 10; i++) g.update(1 / 60);
  assert.ok(c.gold > gold);
  assert.equal(c.inventory.filter(Boolean).length, 0);
  // kho đầy + tự bán rác lấy chỗ
  for (let i = 0; i < c.inventory.length; i++) c.inventory[i] = I.generateItem(r, data, 5, { rarity: i === 7 ? 'normal' : 'magic' });
  c.lootFilter = { normal: 'pick', magicMinLevel: 0, makeRoom: true };
  const rare = I.generateItem(r, data, 8, { rarity: 'rare' });
  g.dropItem(g.player.x + 5, g.player.y, rare);
  for (let i = 0; i < 20; i++) g.update(1 / 60);
  assert.ok(c.inventory.includes(rare));
  assert.equal(c.inventory.filter((x) => x && x.rarity === 'normal').length, 0);
});

t('Sắp xếp kho, lưu khoá / bộ lọc / mua lại / túi tạm qua mã xuất', () => {
  const c = P.createCharacter(data, 'mage');
  const r = new RNG(4);
  c.inventory[5] = I.generateRune(r, data, 5);
  c.inventory[9] = I.generateItem(r, data, 5, { rarity: 'normal', type: 'ring' });
  c.inventory[2] = I.generateItem(r, data, 5, { rarity: 'rare', type: 'head' });
  c.inventory[2].locked = true;
  L.sortInventory(c, data);
  assert.equal(c.inventory[0].type, 'head');
  assert.equal(c.inventory[2].type, 'rune');
  assert.equal(c.inventory[3], null);
  c.lootFilter = { normal: 'sell', magicMinLevel: 7, makeRoom: true };
  c.overflow = [I.generateItem(r, data, 5)];
  L.sellItems(c, [1], data);
  const back = S.importCode(S.exportCode(c, S.newStash(data), data), data).ch;
  assert.deepEqual(back.lootFilter, c.lootFilter);
  assert.equal(back.buyback.length, 1);
  assert.equal(back.overflow.length, 1);
  assert.equal(back.inventory[0].locked, true);
});

// ---------- Sức mạnh theo cấp đồ và rune gộp chồng ----------
t('Độc nhất / đồ bộ tăng 1,65% mỗi cấp đồ vượt yêu cầu (tối đa 165%), yêu cầu cấp = cấp đồ − 10', () => {
  const r = new RNG(21);
  const u = data.items.uniques.find((x) => x.id === 'ash_crown');
  const lo = I.generateItem(r, data, u.req, { rarity: 'unique', type: 'head' });
  // ở đúng cấp yêu cầu: chỉ số gốc
  if (lo.unique === 'ash_crown') assert.deepEqual(lo.stats, u.stats);
  let hi;
  for (let i = 0; i < 200 && !(hi && hi.unique === 'ash_crown'); i++) hi = I.generateItem(r, data, 46, { rarity: 'unique', type: 'head' });
  assert.equal(hi.unique, 'ash_crown');
  const mult = 1 + 0.0165 * (46 - u.req);
  assert.ok(Math.abs(hi.power - mult) < 0.001);
  assert.equal(hi.stats.fireDmgPct, Math.round(u.stats.fireDmgPct * mult));
  assert.equal(hi.stats.fireSkills, u.stats.fireSkills); // +cấp kỹ năng không tăng
  assert.equal(hi.req.level, 36);
  const top = I.generateItem(r, data, 500, { rarity: 'unique', type: 'head' });
  assert.ok(top.power <= 2.65 + 1e-9);
  // đồ bộ cùng hệ số
  const sp = I.generateItem(r, data, 60, { rarity: 'set' });
  const pc = data.items.setsById[sp.set].pieces.find((x) => x.id === sp.piece);
  assert.ok(Math.abs(sp.power - Math.min(2.65, 1 + 0.0165 * (60 - pc.req))) < 0.001);
});

t('Đồ thường / xanh / vàng tăng 0,5% mỗi cấp (tối đa 50%), ít hơn độc nhất; bậc cao được ưu tiên', () => {
  const r = new RNG(22);
  let maxPow = 0;
  for (let i = 0; i < 300; i++) {
    const it = I.generateItem(r, data, 200, { rarity: i % 2 ? 'rare' : 'magic' });
    maxPow = Math.max(maxPow, it.power);
    assert.ok(it.power <= 1.5 + 1e-9);
  }
  assert.ok(maxPow > 1.4);
  // ở cấp đồ cao, bậc cao nhất của Sức mạnh (bậc 5: 18–24) xuất hiện nhiều hơn mỗi bậc thấp
  const tiers = data.items.affixes.find((a) => a.stat === 'str').tiers;
  let top = 0, bottom = 0;
  for (let i = 0; i < 400; i++) {
    const it = I.generateItem(r, data, 45, { rarity: 'rare' });
    if (!it.stats.str) continue;
    const raw = it.stats.str / it.power;
    if (raw >= tiers[4][2] - 0.6) top++;
    else if (raw <= tiers[0][3] + 0.6) bottom++;
  }
  assert.ok(top > bottom);
});

t('Thưởng đồ bộ tăng theo sức mạnh trung bình các món; save cũ: độc nhất / đồ bộ được tính lại', () => {
  const c = P.createCharacter(data, 'mage');
  c.level = 99;
  const set = data.items.sets.find((s) => s.id === 'set_fire');
  const mk = (pc, ilvl) => {
    const base = data.items.basesById[pc.base];
    return { uid: pc.id, base: base.id, type: base.type, rarity: 'set', set: set.id, piece: pc.id, name: pc.name, baseName: base.name, ilvl, req: { level: pc.req, str: 0 }, stats: { ...pc.stats }, sockets: 0, runes: [] };
  };
  // đồ cũ (chưa có power): chuẩn hoá qua mã xuất sẽ tính lại
  c.equipment.head = mk(set.pieces[0], 52);
  c.equipment.body = mk(set.pieces[1], 52);
  const back = importCode(exportCode(c, newStash(data), data), data).ch;
  const h = back.equipment.head;
  const m = 1 + 0.0165 * (52 - set.pieces[0].req);
  assert.ok(Math.abs(h.power - m) < 0.001);
  assert.equal(h.stats.fireDmgPct, Math.round(set.pieces[0].stats.fireDmgPct * m));
  assert.equal(h.req.level, 42);
  const st = I.sumGear(back, data);
  const pw = (back.equipment.head.power + back.equipment.body.power) / 2;
  const expect = Math.round(set.bonus['2'].fireDmgPct * pw) + (h.stats.fireDmgPct || 0) + (back.equipment.body.stats.fireDmgPct || 0);
  assert.equal(st.stats.fireDmgPct, expect);
});

t('Rune cùng loại gộp một ô: nhặt, ghép vào đồ, ghép 3→1, chuyển rương, bán 1 viên, gộp save cũ', () => {
  const c = P.createCharacter(data, 'mage');
  const r = new RNG(23);
  for (let i = 0; i < 4; i++) I.addToInventory(c, I.generateRune(r, data, 5, 'r_ash'));
  I.addToInventory(c, I.generateRune(r, data, 5, 'r_frost'));
  assert.equal(c.inventory.filter(Boolean).length, 2);
  assert.equal(I.runeQty(c.inventory[0]), 4);
  assert.equal(I.runeCounts(c).r_ash, 4);
  // kho đầy vẫn nhặt được rune đã có ô
  for (let i = 2; i < c.inventory.length; i++) c.inventory[i] = I.generateItem(r, data, 5);
  assert.equal(I.canAdd(c, I.generateRune(r, data, 5, 'r_ash')), true);
  assert.equal(I.canAdd(c, I.generateRune(r, data, 5, 'r_storm')), false);
  // ghép vào đồ: trừ 1
  const w = I.generateItem(r, data, 5, { type: 'weapon' }); w.sockets = 1;
  assert.equal(I.insertRune(c, 0, w, data), 'ok');
  assert.equal(I.runeQty(c.inventory[0]), 3);
  // ghép 3 → 1 bậc cao hơn
  c.gold = 9999;
  c.inventory[5] = null;
  const nextId = data.runes.list.find((x) => x.tier === data.runes.byId.r_ash.tier + 1).id; // Rune Sương
  const before = I.runeCounts(c)[nextId] || 0;
  assert.equal(I.combineRunes(c, 'r_ash', data, r), 'ok');
  assert.equal(I.runeCounts(c).r_ash || 0, 0);
  assert.equal(I.runeCounts(c)[nextId], before + 1); // gộp vào ô Rune Sương có sẵn
  assert.equal(c.inventory.filter((x) => x && x.rune === nextId).length, 1);
  // bán: giá cả ô = giá 1 viên × số viên
  const st = { ...I.generateRune(r, data, 5, 'r_frost'), qty: 3 };
  assert.equal(I.sellValue(st, data), I.unitSellValue(st, data) * 3);
  // chuyển sang rương gộp vào ô có sẵn
  const stash = newStash(data);
  stash[7] = I.generateRune(r, data, 5, 'r_frost');
  const fi = c.inventory.findIndex((x) => x && x.rune === 'r_frost');
  const moving = I.runeQty(c.inventory[fi]);
  assert.equal(I.transfer(c.inventory, fi, stash), 'ok');
  assert.equal(I.runeQty(stash[7]), moving + 1);
  assert.equal(stash.filter(Boolean).length, 1);
  // save cũ: các ô rune rời được gộp lại
  const old = P.createCharacter(data, 'mage');
  old.inventory[0] = I.generateRune(r, data, 5, 'r_ash'); delete old.inventory[0].qty;
  old.inventory[3] = I.generateRune(r, data, 5, 'r_ash'); delete old.inventory[3].qty;
  const back = importCode(exportCode(old, newStash(data), data), data).ch;
  assert.equal(back.inventory.filter(Boolean).length, 1);
  assert.equal(I.runeQty(back.inventory[0]), 2);
});

t('Quái mạnh hơn (bản 1.10): +12% máu, +6% sát thương mỗi màn; Ác mộng ×7/×3,5, Địa ngục ×22/×7,5; boss thêm ×2,5/×2/×2,5', () => {
  assert.equal(data.campaign.hpStep, 0.12);
  assert.equal(data.campaign.dmgStep, 0.06);
  const last = data.maps[data.mapOrder[data.mapOrder.length - 1]];
  assert.ok(Math.abs(last.hpMult - Math.pow(1.12, 19)) < 1e-9);
  const D = data.difficultiesById;
  assert.deepEqual([D.nightmare.hpMult, D.nightmare.dmgMult, D.hell.hpMult, D.hell.dmgMult], [7, 3.5, 22, 7.5]);
  const ch = P.createCharacter(data);
  for (const [id, m] of [['normal', 2.5], ['nightmare', 2], ['hell', 2.5]]) {
    const g = new Game(data, ch, { seed: 1, headless: true, mapId: '1-1', difficulty: id });
    const z = g.spawnEnemy('zombie', 100, 100);
    const b = g.spawnEnemy('swamp_lord', 300, 300);
    const zb = data.monsters.zombie.hp, bb = data.monsters.swamp_lord.hp;
    assert.ok(Math.abs(b.maxHp / z.maxHp - (bb / zb) * m) < 1e-6, id); // chỉ boss / trùm nhỏ được nhân thêm
  }
});

t('Dòng đồ "Hút % sát thương thành máu": cộng với bị động, tối đa 20%, hồi máu khi đánh', () => {
  const c = P.createCharacter(data, 'mage');
  assert.equal(P.computeStats(c, data).leech, 0);
  const ring = (v) => ({ uid: 'l' + v, base: 'ring', type: 'ring', rarity: 'magic', name: 'r', ilvl: 1, req: { level: 1, str: 0 }, stats: { leechPct: v }, sockets: 0, runes: [] });
  c.equipment.ring1 = ring(5);
  assert.ok(Math.abs(P.computeStats(c, data).leech - 0.05) < 1e-9);
  c.equipment.ring2 = ring(30);
  assert.ok(Math.abs(P.computeStats(c, data).leech - data.config.caps.leech) < 1e-9);
  c.equipment.ring2 = null;
  const g = new Game(data, c, { seed: 1, headless: true });
  g.player.hp = 10;
  const e = g.spawnEnemy('zombie', g.player.x + 50, g.player.y); e.hp = e.maxHp = 1000;
  g.damageEnemy(e, 100, 'fire', { noCrit: true });
  assert.ok(g.player.hp > 10 && g.player.hp <= 10 + 100 * 0.05 + 1e-9);
  // có trong danh sách dòng chỉ số đồ, không tăng theo cấp đồ
  assert.ok(data.items.affixes.some((a) => a.stat === 'leechPct'));
  assert.ok(data.items.ilvlScaling.exclude.includes('leechPct'));
});

t('Chiến Binh bền hơn (bản 1.11): tổng giáp ×1,5, hút máu tối đa 30% (lớp khác 20%)', () => {
  const ring = (v) => ({ uid: 'l' + v, base: 'ring', type: 'ring', rarity: 'magic', name: 'r', ilvl: 1, req: { level: 1, str: 0 }, stats: { leechPct: v, armor: 100 }, sockets: 0, runes: [] });
  const w = P.createCharacter(data, 'warrior');
  const m = P.createCharacter(data, 'mage');
  for (const c of [w, m]) { c.equipment.ring1 = ring(25); c.equipment.ring2 = ring(25); }
  const sw = P.computeStats(w, data), sm = P.computeStats(m, data);
  assert.ok(Math.abs(sw.leech - 0.3) < 1e-9);
  assert.ok(Math.abs(sm.leech - 0.2) < 1e-9);
  assert.equal(sw.armor, Math.round((15 + 200) * 1.5));
  assert.equal(sm.armor, 200);
});

t('Màn 5 phút (bản 1.12): boss 4:28, cuồng nộ 5:00; kinh nghiệm quái ×1,4; đồ rơi theo cấp nhân vật', () => {
  assert.equal(data.config.run.duration, 300);
  const m = data.maps['1-1'];
  const ev = (type) => m.events.find((e) => e.type === type).t;
  assert.equal(ev('boss'), 268);
  assert.equal(ev('enrage'), 300);
  const c = P.createCharacter(data, 'mage');
  c.level = 37;
  const g = new Game(data, c, { seed: 1, headless: true, mapId: '2-3', difficulty: 'normal' });
  const z = g.spawnEnemy('zombie', 100, 100);
  assert.ok(Math.abs(z.xp - data.monsters.zombie.xp * g.map.rewardMult * 1.4) < 1e-9);
  assert.equal(g.itemLevel(), 37);
  assert.equal(g.itemLevel(5), 42);
  g.time = 200; // không còn cộng theo phút chơi
  assert.equal(g.itemLevel(), 37);
  // đồ thường / xanh / vàng rơi từ quái thường luôn mặc được ngay (yêu cầu ≤ cấp nhân vật)
  const r = new RNG(3);
  for (let i = 0; i < 100; i++) {
    const it = I.generateItem(r, data, g.itemLevel(), { rarity: ['normal', 'magic', 'rare'][i % 3] });
    assert.ok(it.req.level <= c.level, `${it.name} cần ${it.req.level}`);
  }
});

t('Gọi boss sớm: đủ 800 quái thì nhảy tới lúc quái rút lui, bỏ tinh anh / trùm nhỏ còn lại, boss ra sau ~14 giây', () => {
  const c = P.createCharacter(data, 'mage');
  const g = new Game(data, c, { seed: 2, headless: true });
  g.updateSpawner = () => {};
  g.god = true;
  for (let i = 0; i < 60 * 70; i++) g.update(1 / 60); // tới 1:10 (sau tinh anh đầu)
  assert.equal(g.canCallBoss(), false); // chưa đủ quái
  g.kills = data.config.run.callBossKills;
  assert.equal(g.canCallBoss(), true);
  const t0 = g.time;
  assert.equal(g.callBoss(), true);
  assert.equal(g.retreating, true);
  assert.ok(Math.abs(g.clock - m_ret()) < 1e-6);
  assert.equal(g.canCallBoss(), false);
  assert.equal(g.miniboss, null); // trùm nhỏ (2:30) bị bỏ qua
  for (let i = 0; i < 60 * 15; i++) g.update(1 / 60);
  assert.ok(g.bossSpawned && g.boss);
  assert.ok(g.time - t0 < 16);
  function m_ret() { return data.maps['1-1'].events.find((e) => e.type === 'retreat').t; }
});

// ---------- Đồ Thần thoại (SSR) ----------
function wearSSR(classId, setId, n = 5) {
  const c = P.createCharacter(data, classId);
  c.level = 80;
  const r = new RNG(31);
  const set = data.items.setsById[setId];
  for (const pc of set.pieces.slice(0, n)) {
    const base = data.items.basesById[pc.base];
    const slot = I.slotsForType(base.type, data)[0];
    c.equipment[slot] = { uid: pc.id, base: base.id, type: base.type, rarity: 'ssr', set: set.id, piece: pc.id, name: pc.name, baseName: base.name, ilvl: 60, req: { level: 60, str: 0 }, stats: { ...pc.stats }, sockets: 1, runes: [], power: 1 };
  }
  return c;
}

t('SSR: yêu cầu cấp 60 cố định, 1 lỗ, tăng theo cấp đồ, 70% đúng lớp; không lẫn vào đồ bộ thường; không phân giải', () => {
  const r = new RNG(41);
  let own = 0;
  for (let i = 0; i < 400; i++) {
    const it = I.generateSSR(r, data, 95, 'warrior');
    assert.equal(it.rarity, 'ssr');
    assert.equal(it.req.level, 60);
    assert.equal(it.sockets, 1);
    assert.ok(Math.abs(it.power - (1 + 0.0165 * 35)) < 0.001);
    if (data.items.setsById[it.set].class === 'warrior') own++;
  }
  assert.ok(own / 400 > 0.62 && own / 400 < 0.78, `đúng lớp ${own}/400`);
  for (let i = 0; i < 300; i++) assert.notEqual(data.items.setsById[I.generateItem(r, data, 90, { rarity: 'set' }).set]?.rarity, 'ssr');
  const c = P.createCharacter(data, 'mage');
  c.inventory[0] = I.generateSSR(r, data, 70, 'mage');
  assert.equal(I.craft(c, newStash(data), { where: 'inv', key: '0' }, 'salvage', data, r), 'Không phân giải được đồ Thần thoại');
  assert.deepEqual(L.bulkCandidates(c, data, 'normal', true).includes(0), false);
  assert.equal(L.salvageItems(c, [0], data).n, 0);
});

t('SSR: thưởng 2/3 món và hiệu ứng 4/5 món theo số món đang mặc', () => {
  const c3 = wearSSR('mage', 'ssr_mage', 3);
  const s3 = P.computeStats(c3, data);
  assert.equal(s3.skillBonus.all, 2); // gậy +1 và thưởng 3 món +1
  assert.equal(Object.keys(s3.specials).length, 0);
  const s5 = P.computeStats(wearSSR('mage', 'ssr_mage', 5), data);
  assert.ok(s5.specials.elementResonance && s5.specials.cataclysm);
  const w = P.computeStats(wearSSR('warrior', 'ssr_warrior', 4), data);
  assert.ok(w.specials.undying && !w.specials.critWave);
  const sm = P.computeStats(wearSSR('summoner', 'ssr_summoner', 3), data);
  assert.equal(sm.summonExtra, 1);
});

t('SSR Chiến Binh: Bất Diệt cứu khỏi chết một lần mỗi 90 giây; Thần Kiếm tạo sóng chém khi chí mạng', () => {
  const c = wearSSR('warrior', 'ssr_warrior', 5);
  const g = new Game(data, c, { seed: 5, headless: true });
  g.events = []; g.updateSpawner = () => {};
  g.player.hp = 5;
  g.hurtPlayer(9999, 'fire', 'thử');
  assert.equal(g.over, false);
  assert.ok(Math.abs(g.player.hp - g.stats.maxHp * 0.5) < 1e-6);
  g.player.invuln = 0;
  g.hurtPlayer(99999, 'fire', 'thử');
  assert.equal(g.over, true); // đang hồi chiêu
  const g2 = new Game(data, wearSSR('warrior', 'ssr_warrior', 5), { seed: 6, headless: true });
  g2.stats.critChance = 1;
  const p = g2.player;
  const a = g2.spawnEnemy('zombie', p.x + 30, p.y), b = g2.spawnEnemy('zombie', p.x - 60, p.y);
  a.hp = a.maxHp = b.hp = b.maxHp = 1e6;
  g2.grid.rebuild(g2.enemies);
  g2.damageEnemy(a, 100, 'physical');
  assert.ok(b.hp < 1e6); // quái khác trong bán kính 120 px trúng sóng chém
});

t('SSR Pháp sư: Cộng hưởng Nguyên tố +12% mỗi nguyên tố trong 4 giây; Thiên Tai tự rơi', () => {
  const c = wearSSR('mage', 'ssr_mage', 5);
  c.skills.fireball = 5; c.slots[0] = 'fireball';
  const g = new Game(data, c, { seed: 7, headless: true });
  g.events = []; g.updateSpawner = () => {};
  g.stats.critChance = 0;
  const e = g.spawnEnemy('zombie', g.player.x + 200, g.player.y); e.hp = e.maxHp = 1e7; e.resist = {};
  const d1 = g.damageEnemy(e, 100, 'fire');
  g.damageEnemy(e, 100, 'cold');
  const d3 = g.damageEnemy(e, 100, 'lightning');
  assert.ok(Math.abs(d1 - 112) < 1e-6 && Math.abs(d3 - 136) < 1e-6);
  g.time += 5;
  assert.ok(Math.abs(g.damageEnemy(e, 100, 'fire') - 112) < 1e-6); // hết 4 giây: chỉ còn lửa
  const hp0 = e.hp;
  for (let i = 0; i < 60 * 10.5; i++) g.update(1 / 60);
  assert.ok(e.hp < hp0);
});

t('SSR Triệu hồi sư: +1 con mỗi loại, Huyết Mạch Bầy Đàn, Sói Linh Hồn 12 giây', () => {
  const c = wearSSR('summoner', 'ssr_summoner', 5);
  c.skills.summon_wolf = 1; c.slots = ['summon_wolf', null, null, null];
  const g = new Game(data, c, { seed: 8, headless: true });
  g.events = []; g.updateSpawner = () => {}; g.god = true;
  g.update(1 / 60);
  assert.equal(g.minions.filter((m) => m.kind === 'wolf').length, 2); // 1 + 1 từ bộ
  const e = g.spawnEnemy('zombie', g.player.x + 120, g.player.y); e.hp = e.maxHp = 1e7; e.speed = 0; e.contact = 0;
  for (let i = 0; i < 60 * 26; i++) g.update(1 / 60);
  const spirit = g.minions.find((m) => m.kind === 'spirit');
  assert.ok(spirit, 'có Sói Linh Hồn');
  assert.equal(spirit.dmgScale, 3);
  for (let i = 0; i < 60 * 13; i++) g.update(1 / 60);
  assert.ok(!g.minions.some((m) => m === spirit));
  // thú chết → các thú khác nổi giận 8 giây
  g.hurtMinion(g.minions[0], 1e9, 'physical', null);
  assert.ok(g.packRageT > 7);
});

t('SSR rơi từ rương boss: Địa ngục 3%, Ác mộng 1%, Bình thường 0%, cần cấp 60; quái thường rơi đồ ×1,4', () => {
  assert.deepEqual(data.items.drops.ssr.chance, { normal: 0, nightmare: 0.01, hell: 0.03 });
  const n = data.items.drops.normal;
  assert.deepEqual([n.itemChance, n.goldChance, n.runeChance], [0.0056, 0.028, 0.0035]);
  const count = (diff, level) => {
    let got = 0;
    for (let s = 0; s < 400; s++) {
      const c = P.createCharacter(data, 'mage'); c.level = level;
      const g = new Game(data, c, { seed: 1000 + s, headless: true, difficulty: diff });
      g.spawnBoss('swamp_lord'); g.killEnemy(g.boss, 'fire');
      g.openChest(g.pickups.find((k) => k.kind === 'chest'));
      if (g.pickups.some((k) => k.kind === 'item' && k.item.rarity === 'ssr')) got++;
    }
    return got;
  };
  assert.equal(count('normal', 80), 0);
  assert.equal(count('hell', 59), 0);
  const h = count('hell', 80);
  assert.ok(h >= 4 && h <= 24, `Địa ngục ${h}/400`);
});

const { mouseDir } = await import('../src/ui/input.js');
t('Giữ chuột trái: đi về phía con trỏ (tính từ tâm màn hình), con trỏ sát nhân vật thì đứng yên', () => {
  const d = mouseDir(700, 300, 500, 300);
  assert.deepEqual(d, { x: 1, y: 0 });
  const c = mouseDir(600, 400, 500, 300);
  assert.ok(Math.abs(c.x - Math.SQRT1_2) < 1e-9 && Math.abs(c.y - Math.SQRT1_2) < 1e-9);
  assert.deepEqual(mouseDir(505, 304, 500, 300), { x: 0, y: 0 });
});

// Nạp các file giao diện để bắt lỗi cú pháp (vd. khai báo trùng tên biến) mà các kiểm tra lõi không chạm tới.
for (const f of ['render', 'panel', 'sprites', 'skilltext', 'tooltip', 'debug', 'input', 'telemetry', 'look']) {
  try { await import(`../src/ui/${f}.js`); n++; console.log(`ok - nạp được src/ui/${f}.js`); }
  catch (e) { console.error(`LỖI - src/ui/${f}.js: ${e.message}`); throw e; }
}

console.log(`\n${n} kiểm tra đều qua.`);
