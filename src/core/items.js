// Đồ đạc: sinh đồ ngẫu nhiên, cộng chỉ số, yêu cầu để mặc, kho đồ/trang bị/rương.

let uidSeq = 0;
export function newUid(rng) {
  const r = rng ? rng.next() : Math.random();
  return `${Date.now().toString(36)}${(uidSeq++).toString(36)}${Math.floor(r * 1e8).toString(36)}`;
}

const RARITY_ORDER = ['normal', 'magic', 'rare', 'set', 'unique'];

export function rollRarity(rng, data, opts = {}) {
  const R = data.items.rarities;
  const w = {};
  const min = RARITY_ORDER.indexOf(opts.minRarity || 'normal');
  for (const k of RARITY_ORDER) {
    if (RARITY_ORDER.indexOf(k) < min) continue;
    let v = R[k].weight;
    if (k === 'rare') v *= opts.rareMult || 1;
    if (k === 'unique') v *= opts.uniqueMult || 1;
    if (k === 'set') v *= opts.setMult || 1;
    w[k] = v;
  }
  return rng.weighted(w);
}

export function generateItem(rng, data, ilvl, opts = {}) {
  const I = data.items;
  let rarity = opts.rarity || rollRarity(rng, data, opts);
  ilvl = Math.max(1, Math.round(ilvl));
  if (rarity === 'set') {
    const pool = [];
    for (const set of I.sets || []) for (const pc of set.pieces) if (pc.req <= ilvl + 3 && (!opts.type || I.basesById[pc.base].type === opts.type)) pool.push([set, pc]);
    if (pool.length) {
      const [set, pc] = rng.pick(pool);
      const base = I.basesById[pc.base];
      return {
        uid: newUid(rng), base: base.id, type: base.type, rarity, set: set.id, piece: pc.id,
        name: pc.name, baseName: base.name, ilvl,
        req: { level: pc.req, str: base.reqStr || 0 },
        stats: { ...pc.stats }, sockets: 0, runes: [],
      };
    }
    rarity = 'rare';
  }
  if (rarity === 'unique') {
    const pool = I.uniques.filter((u) => u.req <= ilvl + 3 && (!opts.type || I.basesById[u.base].type === opts.type));
    if (pool.length) {
      const u = rng.pick(pool);
      const base = I.basesById[u.base];
      return {
        uid: newUid(rng), base: base.id, type: base.type, rarity, unique: u.id,
        name: u.name, baseName: base.name, ilvl,
        req: { level: u.req, str: base.reqStr || 0 },
        stats: { ...u.stats }, sockets: 0, runes: [],
      };
    }
    rarity = 'rare';
  }
  const equipable = I.bases.filter((b) => b.type !== 'rune');
  const bases = equipable.filter((b) => b.req <= ilvl && (!opts.type || b.type === opts.type));
  const base = opts.baseId ? I.basesById[opts.baseId] : rng.pick(bases.length ? bases : equipable.filter((b) => !opts.type || b.type === opts.type));
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
  // Lỗ: đồ thường hay có lỗ nhất (để ghép rune), số lỗ tối đa tuỳ loại đồ.
  let sockets = 0;
  if (base.maxSockets && rng.next() < (I.socketChance?.[rarity] || 0)) sockets = rng.int(1, base.maxSockets);
  return {
    uid: newUid(rng), base: base.id, type: base.type, rarity, name, baseName: base.name, ilvl,
    req: { level: reqLevel, str: base.reqStr || 0 },
    stats, sockets, runes: [],
  };
}

// ---------- Rune ----------
// Rune bậc cao hiếm hơn: trọng số = falloff^(bậc-1), chỉ rơi rune có dropIlvl <= cấp đồ.
export function generateRune(rng, data, ilvl, runeId = null) {
  const R = data.runes;
  let r = runeId ? R.byId[runeId] : null;
  if (!r) {
    const w = {};
    for (const x of R.list) if (x.dropIlvl <= ilvl) w[x.id] = Math.pow(R.tierDropFalloff, x.tier - 1);
    r = R.byId[rng.weighted(w) || R.list[0].id];
  }
  return { uid: newUid(rng), base: 'rune', type: 'rune', rarity: 'rune', rune: r.id, name: r.name, baseName: `Rune bậc ${r.tier}`, ilvl: r.dropIlvl, req: { level: 1, str: 0 }, stats: {}, sockets: 0, runes: [] };
}

export function runeStatsFor(runeId, itemType, data) {
  const r = data.runes.byId[runeId];
  return { ...(data.runes.weaponTypes.includes(itemType) ? r.weapon : r.armor) };
}

// Chỉ số thật của món đồ = chỉ số gốc + chỉ số các rune đã ghép.
export function itemStats(item) {
  if (!item.runes || !item.runes.length) return item.stats;
  const o = { ...item.stats };
  for (const r of item.runes) for (const [k, v] of Object.entries(r.stats)) o[k] = (o[k] || 0) + v;
  return o;
}

export function freeSockets(item) {
  return (item.sockets || 0) - (item.runes?.length || 0);
}

// Ghép rune (đang ở kho đồ) vào món đồ. Rune ghép rồi không lấy lại được (gỡ ra là mất).
export function insertRune(ch, runeInvIndex, target, data) {
  const ru = ch.inventory[runeInvIndex];
  if (!ru || ru.type !== 'rune') return 'Không phải rune';
  if (!target || freeSockets(target) <= 0) return 'Món đồ không còn lỗ trống';
  target.runes = target.runes || [];
  target.runes.push({ id: ru.rune, stats: runeStatsFor(ru.rune, target.type, data) });
  ch.inventory[runeInvIndex] = null;
  return 'ok';
}

export function formatStat(key, v, data) {
  const s = data.items.stats[key];
  return s ? s.fmt.replace('{v}', v) : `${key}: ${v}`;
}

export function itemLines(item, data) {
  return Object.entries(item.stats).map(([k, v]) => formatStat(k, v, data));
}

export function runeLines(item, data) {
  return (item.runes || []).map((r) => `${data.runes.byId[r.id]?.name || r.id}: ${Object.entries(r.stats).map(([k, v]) => formatStat(k, v, data)).join(', ')}`);
}

export function sellValue(item, data) {
  const d = data.items.drops;
  return Math.round((d.sellBase + d.sellPerIlvl * item.ilvl) * data.items.rarities[item.rarity].sellMult + (item.runes?.length || 0) * 10);
}

export function meetsReq(item, level, str) {
  return level >= item.req.level && str >= (item.req.str || 0);
}

// Tổng sức mạnh dùng để xét yêu cầu (cơ bản + đồ đang mặc).
export function totalStr(ch) {
  let s = ch.attrs.str;
  for (const it of Object.values(ch.equipment || {})) if (it) s += itemStats(it).str || 0;
  return s;
}

// Cộng chỉ số của các món đang mặc và đủ yêu cầu, kèm thưởng đồ bộ (đủ 2 món, đủ 3 món).
export function sumGear(ch, data) {
  const acc = {};
  const inactive = [];
  const str = totalStr(ch);
  const setCount = {};
  for (const [slot, it] of Object.entries(ch.equipment || {})) {
    if (!it) continue;
    if (!meetsReq(it, ch.level, str)) { inactive.push(slot); continue; }
    for (const [k, v] of Object.entries(itemStats(it))) acc[k] = (acc[k] || 0) + v;
    if (it.set) setCount[it.set] = (setCount[it.set] || 0) + 1;
  }
  const sets = [];
  for (const [id, n] of Object.entries(setCount)) {
    const set = data?.items.setsById?.[id];
    if (!set) continue;
    sets.push({ id, name: set.name, count: n, total: set.pieces.length });
    for (const [need, bonus] of Object.entries(set.bonus)) {
      if (n < Number(need)) continue;
      for (const [k, v] of Object.entries(bonus)) acc[k] = (acc[k] || 0) + v;
    }
  }
  return { stats: acc, inactive, sets };
}

// Số món của một bộ đang mặc (để hiện trên thẻ đồ).
export function equippedSetCount(ch, setId) {
  return Object.values(ch.equipment || {}).filter((it) => it && it.set === setId).length;
}

// ---------- Lò chế ----------
function findRef(ch, stash, ref) {
  if (ref.where === 'inv') return { arr: ch.inventory, key: Number(ref.key) };
  if (ref.where === 'stash') return { arr: stash, key: Number(ref.key) };
  if (ref.where === 'eq') return { arr: ch.equipment, key: ref.key };
  return null;
}

export function salvageValue(item, data) {
  const C = data.items.crafting;
  return Math.max(item.type === 'rune' ? 0 : 1, Math.round((C.salvage[item.rarity] || 0) * (1 + C.salvagePerIlvl * item.ilvl)));
}

export function craftCosts(item, data) {
  const C = data.items.crafting;
  const up = C.upgrade[item.rarity];
  return {
    salvage: salvageValue(item, data),
    reroll: (item.rarity === 'magic' || item.rarity === 'rare') ? { shards: C.reroll.shards, gold: C.reroll.goldPerIlvl * item.ilvl } : null,
    upgrade: up ? { shards: up.shards, to: up.to } : null,
    socket: item.type !== 'rune' && (item.sockets || 0) < (data.items.basesById[item.base].maxSockets || 0) && item.rarity !== 'unique' && item.rarity !== 'set' ? { shards: C.socket.shards } : null,
    unsocket: item.runes?.length ? { gold: C.unsocket.gold } : null,
  };
}

// action: 'salvage' | 'reroll' | 'upgrade' | 'socket' | 'unsocket'. Trả 'ok' hoặc lý do.
export function craft(ch, stash, ref, action, data, rng) {
  const loc = findRef(ch, stash, ref);
  const it = loc && loc.arr[loc.key];
  if (!it) return 'Chưa chọn món đồ';
  const cost = craftCosts(it, data)[action];
  if (action === 'salvage') {
    ch.shards = (ch.shards || 0) + cost;
    loc.arr[loc.key] = null;
    return 'ok';
  }
  if (!cost) return 'Không làm được với món này';
  if ((cost.shards || 0) > (ch.shards || 0)) return `Cần ${cost.shards} mảnh`;
  if ((cost.gold || 0) > ch.gold) return `Cần ${cost.gold} vàng`;
  if (action === 'reroll' || action === 'upgrade') {
    const rarity = action === 'upgrade' ? cost.to : it.rarity;
    const fresh = generateItem(rng, data, it.ilvl, { rarity, baseId: it.base });
    Object.assign(it, { rarity, name: fresh.name, stats: fresh.stats, req: { ...fresh.req, level: Math.max(fresh.req.level, data.items.basesById[it.base].req) } });
  } else if (action === 'socket') {
    it.sockets = (it.sockets || 0) + 1;
  } else if (action === 'unsocket') {
    it.runes = [];
  }
  ch.shards = (ch.shards || 0) - (cost.shards || 0);
  ch.gold -= cost.gold || 0;
  return 'ok';
}

// Ghép 3 rune cùng loại (trong kho đồ) thành 1 rune bậc cao hơn.
export function combineRunes(ch, runeId, data, rng) {
  const R = data.runes;
  const r = R.byId[runeId];
  const next = R.list.find((x) => x.tier === r.tier + 1);
  if (!next) return 'Đã là rune bậc cao nhất';
  const C = data.items.crafting.runeCombine;
  const idx = [];
  ch.inventory.forEach((it, i) => { if (it && it.type === 'rune' && it.rune === runeId && idx.length < C.count) idx.push(i); });
  if (idx.length < C.count) return `Cần ${C.count} ${r.name}`;
  const gold = C.goldPerTier * r.tier;
  if (ch.gold < gold) return `Cần ${gold} vàng`;
  ch.gold -= gold;
  for (const i of idx) ch.inventory[i] = null;
  ch.inventory[idx[0]] = generateRune(rng, data, 99, next.id);
  return 'ok';
}

export function runeCounts(ch) {
  const c = {};
  for (const it of ch.inventory) if (it && it.type === 'rune') c[it.rune] = (c[it.rune] || 0) + 1;
  return c;
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
  if (item.type === 'rune') return -1;
  const s = itemStats(item);
  const elem = tree ? (s[`${tree}DmgPct`] || 0) * 1.2 + (s[`${tree}Skills`] || 0) * 25 : 0;
  const main = physical ? (s.physDmgPct || 0) * 1.3 + (s.str || 0) * 1.0 - (s.ene || 0) * 0.6 : (s.spellDmgPct || 0) * 1.2;
  return main + elem + (s.allSkills || 0) * 25 + (s.ene || 0) * 0.8 + (s.vit || 0) * 1.2 +
    (s.maxHp || 0) * 0.4 + (s.maxMana || 0) * 0.3 + (s.armor || 0) * 0.3 + (s.cdSpeedPct || 0) * 1.2 + (s.critChance || 0) * 2 +
    (s.dex || 0) * 0.5 + (s.moveSpeedPct || 0) * 0.5 + (s.hpOnKill || 0) * 4 + (s.resAll || 0) * 0.3;
}
