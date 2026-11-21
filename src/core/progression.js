// Nhân vật vĩnh viễn: cấp, kinh nghiệm, thuộc tính, kỹ năng, ô kỹ năng. Dùng chung cho game, bảng cộng điểm và bot.

export const ATTRS = ['str', 'dex', 'vit', 'ene'];

// Giá trị tham số kỹ năng theo cấp: số cố định hoặc { base, perLevel }.
export function lv(param, level) {
  if (typeof param === 'number') return param;
  return param.base + param.perLevel * (level - 1);
}

export function damageRange(skill, level) {
  const d = skill.damage;
  const add = d.perLevel * (level - 1);
  return [d.min + add, d.max + add];
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
    level: 1,
    xp: 0,
    attrs: { ...p.startAttributes },
    attrPoints: p.startAttrPoints || 0,
    skillPoints: p.startSkillPoints || 0,
    skills: {},
    slots: new Array(p.maxSlots).fill(null),
    runs: 0,
    deaths: 0,
    clears: 0,
    mapDeaths: {},
  };
  for (const [id, l] of Object.entries(p.startSkills)) {
    ch.skills[id] = l;
    if (data.skills[id].type === 'active') {
      const free = ch.slots.indexOf(null);
      if (free >= 0) ch.slots[free] = id;
    }
  }
  return ch;
}

export function computeStats(ch, data) {
  const c = data.config;
  const p = c.player;
  const a = c.attributes;
  const at = ch.attrs;
  const maxHp = p.baseHp + at.vit * a.vit.hp + ch.level * p.hpPerLevel;
  const maxMana = p.baseMana + at.ene * a.ene.mana + ch.level * p.manaPerLevel;
  return {
    maxHp,
    maxMana,
    manaRegen: maxMana * p.manaRegenPct,
    hpRegen: maxHp * p.hpRegenPct,
    cdSpeed: 1 + at.dex * a.dex.cdSpeedPct,
    dodge: Math.min(c.caps.dodge, at.dex * a.dex.dodgePct),
    physDmgPct: at.str * a.str.physDmgPct,
    spellDmgPct: at.ene * a.ene.spellDmgPct,
    moveSpeed: p.moveSpeed,
    pickupRadius: p.pickupRadius,
    critChance: p.critChance,
    critMult: p.critMult,
    armor: 0, // Giai đoạn 0 chưa có đồ
    resist: { fire: 0, cold: 0, lightning: 0, poison: 0 },
    gearDmgPct: 0,
  };
}

// %Synergy cộng vào sát thương của kỹ năng.
export function synergyPct(ch, skill) {
  let s = 0;
  for (const syn of skill.synergies || []) s += (ch.skills[syn.from] || 0) * syn.pct;
  return s;
}

// %Bị động theo nguyên tố (Thông Thạo Lửa...).
export function passivePct(ch, element, data) {
  let s = 0;
  for (const sk of data.skillList) {
    if (sk.type !== 'passive' || !sk.fireDmgPct || element !== sk.element) continue;
    s += (ch.skills[sk.id] || 0) * sk.fireDmgPct;
  }
  return s;
}

// Hệ số nhân sát thương: 1 + %Thuộc tính + %Synergy + %Bị động + %Đồ (cộng dồn trước rồi mới nhân).
export function damageMult(ch, skill, stats, data) {
  return 1 + stats.spellDmgPct + synergyPct(ch, skill) + passivePct(ch, skill.element, data) + stats.gearDmgPct;
}

export function addAttr(ch, key, n = 1) {
  const k = Math.min(n, ch.attrPoints);
  if (k <= 0 || !ATTRS.includes(key)) return 0;
  ch.attrs[key] += k;
  ch.attrPoints -= k;
  return k;
}

// Kiểm tra có học được (thêm 1 cấp) kỹ năng không.
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
// replaceSlot: chỉ số ô sẽ thay nếu ô đã đầy.
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

// Gắn kỹ năng đã học vào ô.
export function equipSkill(ch, id, slot) {
  if (!ch.skills[id]) return false;
  const cur = ch.slots.indexOf(id);
  if (cur >= 0) ch.slots[cur] = ch.slots[slot];
  ch.slots[slot] = id;
  return true;
}

export function snapshot(ch) {
  return JSON.parse(JSON.stringify({
    level: ch.level, xp: ch.xp, attrs: ch.attrs, attrPoints: ch.attrPoints,
    skillPoints: ch.skillPoints, skills: ch.skills, slots: ch.slots,
  }));
}

// Hoàn tác: chỉ khôi phục phần cộng điểm (không lấy lại cấp/kinh nghiệm).
export function restoreAllocation(ch, snap) {
  ch.attrs = { ...snap.attrs };
  ch.attrPoints = snap.attrPoints;
  ch.skillPoints = snap.skillPoints;
  ch.skills = { ...snap.skills };
  ch.slots = [...snap.slots];
}

// Chênh lệch điểm đã cộng giữa hai trạng thái (dùng cho log).
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
