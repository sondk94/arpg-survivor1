// Đồ đạc: sinh đồ ngẫu nhiên, cộng chỉ số, yêu cầu để mặc, kho đồ/trang bị/rương.

let uidSeq = 0;
export function newUid(rng) {
  const r = rng ? rng.next() : Math.random();
  return `${Date.now().toString(36)}${(uidSeq++).toString(36)}${Math.floor(r * 1e8).toString(36)}`;
}

const RARITY_ORDER = ['normal', 'magic', 'rare', 'unique'];

export function rollRarity(rng, data, opts = {}) {
  const R = data.items.rarities;
  const w = {};
  const min = RARITY_ORDER.indexOf(opts.minRarity || 'normal');
  for (const k of RARITY_ORDER) {
    if (RARITY_ORDER.indexOf(k) < min) continue;
    let v = R[k].weight;
    if (k === 'rare') v *= opts.rareMult || 1;
    if (k === 'unique') v *= opts.uniqueMult || 1;
    w[k] = v;
  }
  return rng.weighted(w);
}

export function generateItem(rng, data, ilvl, opts = {}) {
  const I = data.items;
  let rarity = opts.rarity || rollRarity(rng, data, opts);
  ilvl = Math.max(1, Math.round(ilvl));
  if (rarity === 'unique') {
    const pool = I.uniques.filter((u) => u.req <= ilvl + 3 && (!opts.type || I.basesById[u.base].type === opts.type));
    if (pool.length) {
      const u = rng.pick(pool);
      const base = I.basesById[u.base];
      return {
        uid: newUid(rng), base: base.id, type: base.type, rarity, unique: u.id,
        name: u.name, baseName: base.name, ilvl,
        req: { level: u.req, str: base.reqStr || 0 },
        stats: { ...u.stats },
      };
    }
    rarity = 'rare';
  }
  const bases = I.bases.filter((b) => b.req <= ilvl && (!opts.type || b.type === opts.type));
  const base = rng.pick(bases.length ? bases : I.bases.filter((b) => !opts.type || b.type === opts.type));
  const stats = {};
  for (const [k, [a, b]] of Object.entries(base.implicit || {})) stats[k] = rng.int(a, b);
  let reqLevel = base.req;
  const [amin, amax] = I.rarities[rarity].affixes;
  const count = amax ? rng.int(amin, amax) : 0;
  const pool = I.affixes.filter((af) => (af.slots.includes('*') || af.slots.includes(base.type)) && af.tiers.some((t) => t[0] <= ilvl));
  const names = [];
  for (let i = 0; i < count && pool.length; i++) {
    const idx = Math.floor(rng.next() * pool.length);
    const af = pool.splice(idx, 1)[0];
    const tiers = af.tiers.filter((t) => t[0] <= ilvl);
    const t = tiers[Math.floor(rng.next() * tiers.length)];
    stats[af.stat] = (stats[af.stat] || 0) + rng.int(t[2], t[3]);
    reqLevel = Math.max(reqLevel, t[1]);
    names.push(af.name);
  }
  let name = base.name;
  if (rarity === 'magic' && names.length) name = `${base.name} ${names[0]}`;
  if (rarity === 'rare') name = `${rng.pick(I.rareNames.first)} ${rng.pick(I.rareNames.second)}`;
  return {
    uid: newUid(rng), base: base.id, type: base.type, rarity, name, baseName: base.name, ilvl,
    req: { level: reqLevel, str: base.reqStr || 0 },
    stats,
  };
}

export function formatStat(key, v, data) {
  const s = data.items.stats[key];
  return s ? s.fmt.replace('{v}', v) : `${key}: ${v}`;
}

export function itemLines(item, data) {
  return Object.entries(item.stats).map(([k, v]) => formatStat(k, v, data));
}

export function sellValue(item, data) {
  const d = data.items.drops;
  return Math.round((d.sellBase + d.sellPerIlvl * item.ilvl) * data.items.rarities[item.rarity].sellMult);
}

export function meetsReq(item, level, str) {
  return level >= item.req.level && str >= (item.req.str || 0);
}

// Tổng sức mạnh dùng để xét yêu cầu (cơ bản + đồ đang mặc).
export function totalStr(ch) {
  let s = ch.attrs.str;
  for (const it of Object.values(ch.equipment || {})) if (it) s += it.stats.str || 0;
  return s;
}

// Cộng chỉ số của các món đang mặc và đủ yêu cầu.
export function sumGear(ch) {
  const acc = {};
  const inactive = [];
  const str = totalStr(ch);
  for (const [slot, it] of Object.entries(ch.equipment || {})) {
    if (!it) continue;
    if (!meetsReq(it, ch.level, str)) { inactive.push(slot); continue; }
    for (const [k, v] of Object.entries(it.stats)) acc[k] = (acc[k] || 0) + v;
  }
  return { stats: acc, inactive };
}

export function slotsForType(type, data) {
  return data.items.slots.filter((s) => s.type === type).map((s) => s.id);
}

export function firstFree(arr) {
  return arr.indexOf(null);
}

export function addToInventory(ch, item) {
  const i = firstFree(ch.inventory);
  if (i < 0) return false;
  ch.inventory[i] = item;
  return true;
}

// Mặc món ở ô kho invIndex. Trả về 'ok' hoặc lý do.
export function equipFromInventory(ch, invIndex, data, slotId = null) {
  const item = ch.inventory[invIndex];
  if (!item) return 'Ô trống';
  const slots = slotsForType(item.type, data);
  if (!slots.length) return 'Không mặc được';
  if (!meetsReq(item, ch.level, totalStr(ch))) {
    return item.req.level > ch.level ? `Cần cấp ${item.req.level}` : `Cần ${item.req.str} Sức mạnh`;
  }
  let slot = slotId && slots.includes(slotId) ? slotId : slots.find((s) => !ch.equipment[s]) || slots[0];
  const old = ch.equipment[slot];
  ch.equipment[slot] = item;
  ch.inventory[invIndex] = old || null;
  return 'ok';
}

export function unequip(ch, slotId) {
  const it = ch.equipment[slotId];
  if (!it) return 'Ô trống';
  const i = firstFree(ch.inventory);
  if (i < 0) return 'Kho đồ đầy';
  ch.inventory[i] = it;
  ch.equipment[slotId] = null;
  return 'ok';
}

// Chuyển món giữa hai mảng (kho ↔ rương).
export function transfer(from, i, to) {
  const it = from[i];
  if (!it) return 'Ô trống';
  const j = firstFree(to);
  if (j < 0) return 'Đã đầy';
  to[j] = it;
  from[i] = null;
  return 'ok';
}

// Điểm đánh giá đơn giản (bot dùng để tự mặc đồ).
export function itemScore(item, tree, physical = false) {
  const s = item.stats;
  const elem = tree ? (s[`${tree}DmgPct`] || 0) * 1.2 + (s[`${tree}Skills`] || 0) * 25 : 0;
  const main = physical ? (s.physDmgPct || 0) * 1.3 + (s.str || 0) * 1.0 - (s.ene || 0) * 0.6 : (s.spellDmgPct || 0) * 1.2;
  return main + elem + (s.allSkills || 0) * 25 + (s.ene || 0) * 0.8 + (s.vit || 0) * 1.2 +
    (s.maxHp || 0) * 0.4 + (s.maxMana || 0) * 0.3 + (s.armor || 0) * 0.3 + (s.cdSpeedPct || 0) * 1.2 + (s.critChance || 0) * 2 +
    (s.dex || 0) * 0.5 + (s.moveSpeedPct || 0) * 0.5 + (s.hpOnKill || 0) * 4 + (s.resAll || 0) * 0.3;
}
