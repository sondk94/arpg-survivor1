// Nhân vật vĩnh viễn: cấp, kinh nghiệm, thuộc tính, kỹ năng, ô kỹ năng, đồ đạc. Dùng chung cho game, giao diện và bot.
import { sumGear } from './items.js';

export const ATTRS = ['str', 'dex', 'vit', 'ene'];
export const ELEMENTS = ['fire', 'cold', 'lightning'];

// Giá trị tham số kỹ năng theo cấp: số cố định hoặc { base, perLevel }.
export function lv(param, level) {
  if (typeof param === 'number') return param;
  return param.base + param.perLevel * (level - 1);
}

export function damageRange(skill, level) {
  const d = skill.damage;
  const k = level - 1;
  const pMin = d.perLevelMin ?? d.perLevel ?? 0;
  const pMax = d.perLevelMax ?? d.perLevel ?? 0;
  return [d.min + pMin * k, d.max + pMax * k];
}

export function xpToNext(level, cfg) {
  return Math.round(cfg.xp.base * Math.pow(level, cfg.xp.exp));
}

export function unlockLevel(skill, cfg) {
  return cfg.testMode ? skill.unlockTest : skill.unlock;
}

export function createCharacter(data) {
  const p = data.config.player;
  const ch = {
    version: 1,
    level: 1,
    xp: 0,
    attrs: { ...p.startAttributes },
    attrPoints: p.startAttrPoints || 0,
    skillPoints: p.startSkillPoints || 0,
    skills: {},
    slots: new Array(p.maxSlots).fill(null),
    gold: 0,
    inventory: new Array(data.items.inventorySize).fill(null),
    equipment: Object.fromEntries(data.items.slots.map((s) => [s.id, null])),
    runs: 0,
    deaths: 0,
    clears: 0,
    mapDeaths: {},
  };
  applyStartSkills(ch, data);
  return ch;
}

function applyStartSkills(ch, data) {
  for (const [id, l] of Object.entries(data.config.player.startSkills || {})) {
    ch.skills[id] = l;
    if (data.skills[id].type === 'active') {
      const free = ch.slots.indexOf(null);
      if (free >= 0) ch.slots[free] = id;
    }
  }
}

export function totalAttrs(ch, gear) {
  const g = gear || sumGear(ch).stats;
  const o = {};
  for (const k of ATTRS) o[k] = ch.attrs[k] + (g[k] || 0);
  return o;
}

export function computeStats(ch, data) {
  const c = data.config;
  const p = c.player;
  const a = c.attributes;
  const gear = sumGear(ch);
  const g = gear.stats;
  const at = totalAttrs(ch, g);
  const pct = (k) => (g[k] || 0) / 100;
  const maxHp = p.baseHp + at.vit * a.vit.hp + ch.level * p.hpPerLevel + (g.maxHp || 0);
  const maxMana = p.baseMana + at.ene * a.ene.mana + ch.level * p.manaPerLevel + (g.maxMana || 0);
  const resAll = pct('resAll');
  return {
    attrs: at,
    maxHp,
    maxMana,
    manaRegen: maxMana * p.manaRegenPct * (1 + pct('manaRegenPct')),
    hpRegen: maxHp * p.hpRegenPct,
    cdSpeed: 1 + at.dex * a.dex.cdSpeedPct + pct('cdSpeedPct'),
    dodge: Math.min(c.caps.dodge, at.dex * a.dex.dodgePct),
    physDmgPct: at.str * a.str.physDmgPct,
    spellDmgPct: at.ene * a.ene.spellDmgPct + pct('spellDmgPct'),
    elemDmgPct: { fire: pct('fireDmgPct'), cold: pct('coldDmgPct'), lightning: pct('lightningDmgPct') },
    // +% sát thương lên tinh anh và trùm nhỏ theo nguyên tố (mặc định của nhánh + từ đồ).
    eliteDmgPct: { lightning: (c.eliteDmgBonus?.lightning || 0) + pct('lightningEliteDmgPct') },
    skillBonus: { fire: g.fireSkills || 0, cold: g.coldSkills || 0, lightning: g.lightningSkills || 0, all: g.allSkills || 0 },
    moveSpeed: p.moveSpeed * (1 + pct('moveSpeedPct')),
    pickupRadius: p.pickupRadius * (1 + pct('pickupPct')),
    critChance: p.critChance + pct('critChance'),
    critMult: p.critMult,
    armor: g.armor || 0,
    resist: {
      fire: pct('resFire') + resAll,
      cold: pct('resCold') + resAll,
      lightning: pct('resLightning') + resAll,
      poison: pct('resPoison') + resAll,
    },
    hpOnKill: g.hpOnKill || 0,
    freezeHitsReduce: g.freezeHits || 0,
    inactiveGear: gear.inactive,
  };
}

// Cấp hiệu lực = điểm đã cộng + cấp cộng từ đồ (chỉ với kỹ năng đã học, giống Diablo 2).
export function skillLevel(ch, id, data, stats) {
  const base = ch.skills[id] || 0;
  if (!base) return 0;
  const sk = data.skills[id];
  const b = stats ? stats.skillBonus : { all: 0 };
  return Math.min(sk.maxLevel + 10, base + (b[sk.tree] || 0) + (b.all || 0));
}

// %Synergy: chỉ tính điểm đã cộng thật (không tính cấp từ đồ).
export function synergyPct(ch, skill) {
  let s = 0;
  for (const syn of skill.synergies || []) s += (ch.skills[syn.from] || 0) * syn.pct;
  return s;
}

// %Bị động theo nguyên tố (Thông Thạo Lửa/Băng/Sét), theo cấp hiệu lực.
export function passivePct(ch, element, data, stats) {
  let s = 0;
  for (const sk of data.skillList) {
    if (sk.type !== 'passive' || !sk.dmgPct || element !== sk.element) continue;
    s += skillLevel(ch, sk.id, data, stats) * sk.dmgPct;
  }
  return s;
}

// Hệ số nhân sát thương: 1 + %Thuộc tính + %Synergy + %Bị động + %Đồ (cộng dồn trước rồi mới nhân).
export function damageMult(ch, skill, stats, data) {
  return 1 + stats.spellDmgPct + synergyPct(ch, skill) + passivePct(ch, skill.element, data, stats) + (stats.elemDmgPct[skill.element] || 0);
}

export function addAttr(ch, key, n = 1) {
  const k = Math.min(n, ch.attrPoints);
  if (k <= 0 || !ATTRS.includes(key)) return 0;
  ch.attrs[key] += k;
  ch.attrPoints -= k;
  return k;
}

export function canLearn(ch, id, data) {
  const sk = data.skills[id];
  const cur = ch.skills[id] || 0;
  if (ch.skillPoints <= 0) return { ok: false, reason: 'Hết điểm kỹ năng' };
  if (cur >= sk.maxLevel) return { ok: false, reason: 'Đã tối đa' };
  const need = unlockLevel(sk, data.config);
  if (ch.level < need) return { ok: false, reason: `Cần cấp ${need}` };
  return { ok: true };
}

// Học kỹ năng. Trả về 'ok' | 'needSlot' | lý do lỗi.
export function learnSkill(ch, id, data, replaceSlot = null) {
  const chk = canLearn(ch, id, data);
  if (!chk.ok) return chk.reason;
  const sk = data.skills[id];
  const isNew = !ch.skills[id];
  if (sk.type === 'active' && isNew && !ch.slots.includes(id)) {
    const free = ch.slots.indexOf(null);
    if (free >= 0) ch.slots[free] = id;
    else if (replaceSlot === null) return 'needSlot';
    else ch.slots[replaceSlot] = id;
  }
  ch.skills[id] = (ch.skills[id] || 0) + 1;
  ch.skillPoints -= 1;
  return 'ok';
}

export function equipSkill(ch, id, slot) {
  if (!ch.skills[id]) return false;
  const cur = ch.slots.indexOf(id);
  if (cur >= 0) ch.slots[cur] = ch.slots[slot];
  ch.slots[slot] = id;
  return true;
}

export function hasActiveSkill(ch) {
  return ch.slots.some((id) => id && ch.skills[id]);
}

export function respecCost(ch, data) {
  return data.items.respecCostPerLevel * ch.level;
}

// Tẩy điểm: trả lại toàn bộ điểm thuộc tính và kỹ năng.
export function respec(ch, data) {
  const cost = respecCost(ch, data);
  if (ch.gold < cost) return `Cần ${cost} vàng`;
  const p = data.config.player;
  ch.gold -= cost;
  ch.attrs = { ...p.startAttributes };
  ch.attrPoints = (p.startAttrPoints || 0) + (ch.level - 1) * p.attrPointsPerLevel;
  ch.skills = {};
  ch.slots = new Array(p.maxSlots).fill(null);
  applyStartSkills(ch, data); // kỹ năng khởi đầu là miễn phí, không tính vào điểm
  ch.skillPoints = (p.startSkillPoints || 0) + (ch.level - 1) * p.skillPointsPerLevel;
  return 'ok';
}

export function snapshot(ch) {
  return JSON.parse(JSON.stringify({
    level: ch.level, xp: ch.xp, attrs: ch.attrs, attrPoints: ch.attrPoints,
    skillPoints: ch.skillPoints, skills: ch.skills, slots: ch.slots,
  }));
}

// Hoàn tác: chỉ khôi phục phần cộng điểm (không lấy lại cấp, kinh nghiệm hay đồ).
export function restoreAllocation(ch, snap) {
  ch.attrs = { ...snap.attrs };
  ch.attrPoints = snap.attrPoints;
  ch.skillPoints = snap.skillPoints;
  ch.skills = { ...snap.skills };
  ch.slots = [...snap.slots];
}

export function allocationDiff(before, after) {
  const attrs = {};
  for (const k of ATTRS) {
    const d = after.attrs[k] - before.attrs[k];
    if (d) attrs[k] = d;
  }
  const skills = {};
  for (const k of new Set([...Object.keys(before.skills), ...Object.keys(after.skills)])) {
    const d = (after.skills[k] || 0) - (before.skills[k] || 0);
    if (d) skills[k] = d;
  }
  return { attrs, skills };
}
