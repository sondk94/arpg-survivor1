// Đồ đạc: sinh đồ ngẫu nhiên, cộng chỉ số, yêu cầu để mặc, kho đồ/trang bị/rương.
import { RNG } from './rng.js';

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

// ---------- Sức mạnh theo cấp đồ ----------
// Hệ số = 1 + perLevel × (cấp đồ − yêu cầu cấp gốc), tối đa 1 + max. Độc nhất / đồ bộ tăng nhanh hơn.
export function powerFor(rarity, ilvl, baseReq, data) {
  const S = data.items.ilvlScaling;
  if (!S) return 1;
  const c = S[rarity] || S.default;
  return 1 + Math.min(c.max, c.perLevel * Math.max(0, ilvl - baseReq));
}

// Nhân các chỉ số (trừ +cấp kỹ năng, giảm số đòn đóng băng, % hồi chiêu, % tốc chạy), làm tròn.
export function scaleStats(stats, mult, data) {
  if (mult === 1) return { ...stats };
  const ex = data.items.ilvlScaling?.exclude || [];
  const o = {};
  for (const [k, v] of Object.entries(stats)) o[k] = ex.includes(k) ? v : Math.round(v * mult);
  return o;
}

// Áp sức mạnh theo cấp đồ cho món vừa tạo: nhân chỉ số, ghi hệ số, nâng yêu cầu cấp (cấp đồ − 10).
function applyPower(item, baseStats, baseReq, data) {
  const mult = powerFor(item.rarity, item.ilvl, baseReq, data);
  item.stats = scaleStats(baseStats, mult, data);
  // Độc nhất / đồ bộ / SSR cấp cao: dòng +cấp kỹ năng sẵn có được cộng thêm (cấp đồ 60: +1, 90: +2).
  const sb = skillBonusFor(item.rarity, item.ilvl, data);
  if (sb) for (const k of Object.keys(item.stats)) if (isSkillStat(k)) item.stats[k] += sb;
  item.power = Math.round(mult * 1000) / 1000;
  // Đồ Thần thoại (SSR): yêu cầu cấp cố định (cấp 60), không nâng theo cấp đồ.
  if (mult > 1 && item.rarity !== 'ssr') item.req.level = Math.max(baseReq, item.ilvl - (data.items.ilvlScaling?.reqOffset ?? 10));
  return item;
}

// ---------- Dòng +cấp kỹ năng ----------
export const isSkillStat = (k) => k === 'allSkills' || /^[a-z]+Skills$/.test(k);

export function skillBonusFor(rarity, ilvl, data) {
  if (rarity !== 'unique' && rarity !== 'set' && rarity !== 'ssr') return 0;
  let b = 0;
  for (const [lv, v] of data.items.ilvlScaling?.skillBonus || []) if (ilvl >= lv) b = v;
  return b;
}

// Nhánh kỹ năng → lớp nhân vật.
function treeOwner(data, tree) {
  for (const c of data.classList || []) if ((c.trees || []).includes(tree)) return c.id;
  return null;
}

// Tỉ trọng một dòng: dòng +cấp nhánh của lớp khác chỉ còn otherClassSkillWeight (30%).
function affixWeight(af, data, classId) {
  let w = af.weight ?? 1;
  const m = /^([a-z]+)Skills$/.exec(af.stat);
  if (classId && m && af.stat !== 'allSkills') {
    const owner = treeOwner(data, m[1]);
    if (owner && owner !== classId) w *= data.items.ilvlScaling?.otherClassSkillWeight ?? 1;
  }
  return w;
}

function takeWeighted(rng, pool, data, classId) {
  const ws = pool.map((af) => affixWeight(af, data, classId));
  let r = rng.next() * ws.reduce((a, b) => a + b, 0);
  let i = 0;
  while (i < pool.length - 1 && r >= ws[i]) { r -= ws[i]; i++; }
  return pool.splice(i, 1)[0];
}

// Chọn bậc theo cấp đồ (bậc cao nhất đã mở có tỉ trọng cao hơn, mặc định 3 / 2 / 1) rồi tung giá trị.
function rollAffix(rng, data, af, ilvl) {
  const tiers = af.tiers.filter((t) => t[0] <= ilvl).sort((x, y) => y[0] - x[0]);
  const tw = data.items.ilvlScaling?.tierWeights || [1];
  const ws = tiers.map((_, i) => tw[Math.min(i, tw.length - 1)]);
  let roll = rng.next() * ws.reduce((a, b) => a + b, 0);
  let ti = 0;
  while (ti < tiers.length - 1 && roll >= ws[ti]) { roll -= ws[ti]; ti++; }
  const t = tiers[ti];
  return { v: rng.int(t[2], t[3]), req: t[1] };
}

function affixPool(data, base, ilvl) {
  return data.items.affixes.filter((af) => (af.slots.includes('*') || af.slots.includes(base.type)) && (!af.weaponKinds || af.weaponKinds.includes(base.weaponKind)) && af.tiers.some((t) => t[0] <= ilvl));
}

// Đồ bộ (cả SSR) mạnh hơn: +3 cấp nhánh hợp với nhân vật, và đủ 5 dòng (35% có 6 dòng).
// Nhánh: đồ bộ thường theo nhánh của bộ; SSR theo nhánh chính của nhân vật (đúng lớp), không thì ngẫu nhiên trong lớp của bộ.
export function enhanceSetItem(it, rng, data, opts = {}) {
  const I = data.items;
  const C = I.setLines;
  const set = I.setsById?.[it.set];
  if (!C || !set || it.setV2) return it;
  let tree = set.tree;
  if (!tree && set.class) {
    const trees = data.classes?.[set.class]?.trees || [];
    tree = opts.classId === set.class && trees.includes(opts.tree) ? opts.tree : rng.pick(trees);
  }
  if (tree) {
    const k = `${tree}Skills`;
    it.stats[k] = (it.stats[k] || 0) + C.skillLevels + skillBonusFor(it.rarity, it.ilvl, data);
    it.skillTree = tree;
  }
  const target = rng.next() < (C.maxChance || 0) ? C.maxLines : C.minLines;
  const base = I.basesById[it.base];
  const pool = affixPool(data, base, it.ilvl).filter((af) => !isSkillStat(af.stat));
  const mult = powerFor('rare', it.ilvl, base.req, data);
  while (Object.keys(it.stats).length < target && pool.length) {
    const af = pool.splice(Math.floor(rng.next() * pool.length), 1)[0];
    if (af.stat in it.stats) continue;
    const { v } = rollAffix(rng, data, af, it.ilvl);
    it.stats[af.stat] = Math.max(1, scaleStats({ [af.stat]: v }, mult, data)[af.stat]);
  }
  it.setV2 = 1;
  return it;
}

// Hạt giống ổn định từ uid để nâng cấp đồ bộ cũ luôn ra cùng kết quả.
function uidSeed(uid) {
  let h = 2166136261;
  for (const ch of String(uid || 'x')) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}

// Đồ độc nhất / đồ bộ cũ (lưu trước khi có sức mạnh theo cấp đồ): tính lại từ chỉ số gốc theo cấp đồ đã lưu.
export function upgradeLegacyItem(it, data) {
  if (!it) return;
  if (it.power !== undefined) {
    if ((it.rarity === 'set' || it.rarity === 'ssr') && !it.setV2) enhanceSetItem(it, new RNG(uidSeed(it.uid)), data);
    return;
  }
  const I = data.items;
  let def = null;
  if (it.rarity === 'unique') def = I.uniquesById?.[it.unique];
  else if (it.rarity === 'set' || it.rarity === 'ssr') def = I.setsById?.[it.set]?.pieces.find((p) => p.id === it.piece);
  if (!def) return;
  it.req = { ...it.req, level: def.req };
  applyPower(it, def.stats, def.req, data);
  if (it.rarity === 'set' || it.rarity === 'ssr') enhanceSetItem(it, new RNG(uidSeed(it.uid)), data);
}

// Đồ Thần thoại (SSR): một món của bộ SSR; ownClass (70%) là bộ của lớp đang chơi.
export function generateSSR(rng, data, ilvl, classId, tree = null) {
  const I = data.items;
  const C = I.drops.ssr;
  const sets = (I.sets || []).filter((s) => s.rarity === 'ssr');
  if (!sets.length) return null;
  const own = sets.filter((s) => s.class === classId);
  const others = sets.filter((s) => s.class !== classId);
  const set = own.length && (!others.length || rng.next() < C.ownClass) ? rng.pick(own) : rng.pick(others.length ? others : sets);
  const pc = rng.pick(set.pieces);
  const base = I.basesById[pc.base];
  return enhanceSetItem(applyPower({
    uid: newUid(rng), base: base.id, type: base.type, rarity: 'ssr', set: set.id, piece: pc.id,
    name: pc.name, baseName: base.name, ilvl: Math.max(1, Math.round(ilvl)),
    req: { level: C.req ?? pc.req, str: 0 },
    stats: {}, sockets: C.sockets ?? 1, runes: [],
  }, pc.stats, C.req ?? pc.req, data), rng, data, { classId, tree });
}

export function generateItem(rng, data, ilvl, opts = {}) {
  const I = data.items;
  let rarity = opts.rarity || rollRarity(rng, data, opts);
  ilvl = Math.max(1, Math.round(ilvl));
  if (rarity === 'set') {
    const pool = [];
    for (const set of I.sets || []) if (set.rarity !== 'ssr') for (const pc of set.pieces) if (pc.req <= ilvl + 3 && (!opts.type || I.basesById[pc.base].type === opts.type)) pool.push([set, pc]);
    if (pool.length) {
      // Đồ bộ hợp lớp nhân vật rơi nhiều hơn (70%, giống SSR).
      const own = opts.classId ? pool.filter(([st]) => treeOwner(data, st.tree) === opts.classId) : [];
      const others = pool.filter((x) => !own.includes(x));
      const src = own.length && (!others.length || rng.next() < (I.drops.ssr?.ownClass ?? 0.7)) ? own : others.length ? others : pool;
      const [set, pc] = rng.pick(src);
      const base = I.basesById[pc.base];
      return enhanceSetItem(applyPower({
        uid: newUid(rng), base: base.id, type: base.type, rarity, set: set.id, piece: pc.id,
        name: pc.name, baseName: base.name, ilvl,
        req: { level: pc.req, str: base.reqStr || 0 },
        stats: {}, sockets: 0, runes: [],
      }, pc.stats, pc.req, data), rng, data, opts);
    }
    rarity = 'rare';
  }
  if (rarity === 'unique') {
    const pool = I.uniques.filter((u) => u.req <= ilvl + 3 && (!opts.type || I.basesById[u.base].type === opts.type));
    if (pool.length) {
      const u = rng.pick(pool);
      const base = I.basesById[u.base];
      return applyPower({
        uid: newUid(rng), base: base.id, type: base.type, rarity, unique: u.id,
        name: u.name, baseName: base.name, ilvl,
        req: { level: u.req, str: base.reqStr || 0 },
        stats: {}, sockets: 0, runes: [],
      }, u.stats, u.req, data);
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
  // Dòng có weaponKinds (vd. chỉ vũ khí cận chiến) chỉ ra trên đúng loại vũ khí.
  const pool = affixPool(data, base, ilvl);
  const names = [];
  for (let i = 0; i < count && pool.length; i++) {
    const af = takeWeighted(rng, pool, data, opts.classId);
    const { v, req } = rollAffix(rng, data, af, ilvl);
    stats[af.stat] = (stats[af.stat] || 0) + v;
    reqLevel = Math.max(reqLevel, req);
    names.push(af.name);
  }
  let name = base.name;
  if (rarity === 'magic' && names.length) name = `${base.name} ${names[0]}`;
  if (rarity === 'rare') name = `${rng.pick(I.rareNames.first)} ${rng.pick(I.rareNames.second)}`;
  // Lỗ: đồ thường hay có lỗ nhất (để ghép rune), số lỗ tối đa tuỳ loại đồ.
  let sockets = 0;
  if (base.maxSockets && rng.next() < (I.socketChance?.[rarity] || 0)) sockets = rng.int(1, base.maxSockets);
  return applyPower({
    uid: newUid(rng), base: base.id, type: base.type, rarity, name, baseName: base.name, ilvl,
    req: { level: reqLevel, str: base.reqStr || 0 },
    stats: {}, sockets, runes: [],
  }, stats, reqLevel, data);
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
  return { uid: newUid(rng), base: 'rune', type: 'rune', rarity: 'rune', rune: r.id, name: r.name, baseName: `Rune bậc ${r.tier}`, ilvl: r.dropIlvl, req: { level: 1, str: 0 }, stats: {}, sockets: 0, runes: [], qty: 1 };
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
  takeOne(ch.inventory, runeInvIndex);
  return 'ok';
}

export function formatStat(key, v, data) {
  const s = data.items.stats[key];
  // Sét dao động lớn: mỗi đòn ngẫu nhiên từ 1/4 tới giá trị ghi trên đồ.
  return s ? s.fmt.replace('{lo}', Math.max(1, Math.round(v / 4))).replace('{v}', v) : `${key}: ${v}`;
}

export function itemLines(item, data) {
  return Object.entries(item.stats).map(([k, v]) => formatStat(k, v, data));
}

export function runeLines(item, data) {
  return (item.runes || []).map((r) => `${data.runes.byId[r.id]?.name || r.id}: ${Object.entries(r.stats).map(([k, v]) => formatStat(k, v, data)).join(', ')}`);
}

export function sellValue(item, data) {
  const d = data.items.drops;
  if (item.type === 'rune') return unitSellValue(item, data) * runeQty(item);
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

// Giá bán một viên (rune gộp chồng bán từng viên hoặc cả ô).
export function unitSellValue(item, data) {
  const d = data.items.drops;
  return Math.round((d.sellBase + d.sellPerIlvl * item.ilvl) * data.items.rarities[item.rarity].sellMult);
}

// Cộng chỉ số của các món đang mặc và đủ yêu cầu, kèm thưởng đồ bộ (đủ 2 món, đủ 3 món).
export function sumGear(ch, data) {
  const acc = {};
  const inactive = [];
  const str = totalStr(ch);
  const setCount = {};
  const setPower = {};
  const specials = {};
  for (const [slot, it] of Object.entries(ch.equipment || {})) {
    if (!it) continue;
    if (!meetsReq(it, ch.level, str)) { inactive.push(slot); continue; }
    for (const [k, v] of Object.entries(itemStats(it))) acc[k] = (acc[k] || 0) + v;
    if (it.set) { setCount[it.set] = (setCount[it.set] || 0) + 1; (setPower[it.set] ||= []).push(it.power || 1); }
  }
  const sets = [];
  for (const [id, n] of Object.entries(setCount)) {
    const set = data?.items.setsById?.[id];
    if (!set) continue;
    // Thưởng bộ mạnh theo sức mạnh trung bình của các món trong bộ đang mặc.
    const pw = setPower[id].reduce((a, b) => a + b, 0) / setPower[id].length;
    sets.push({ id, name: set.name, count: n, total: set.pieces.length, power: pw });
    for (const [need, bonus] of Object.entries(set.bonus)) {
      if (n < Number(need)) continue;
      for (const [k, v] of Object.entries(data ? scaleStats(bonus, pw, data) : bonus)) acc[k] = (acc[k] || 0) + v;
    }
    // Hiệu ứng đặc biệt của bộ SSR (đủ 4 / 5 món).
    for (const [need, sp] of Object.entries(set.special || {})) if (n >= Number(need)) specials[sp.id] = sp;
  }
  return { stats: acc, inactive, sets, specials };
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
    socket: item.type !== 'rune' && (item.sockets || 0) < (data.items.basesById[item.base].maxSockets || 0) && !['unique', 'set', 'ssr'].includes(item.rarity) ? { shards: C.socket.shards } : null,
    unsocket: item.runes?.length ? { gold: C.unsocket.gold } : null,
  };
}

// action: 'salvage' | 'reroll' | 'upgrade' | 'socket' | 'unsocket'. Trả 'ok' hoặc lý do.
export function craft(ch, stash, ref, action, data, rng) {
  const loc = findRef(ch, stash, ref);
  const it = loc && loc.arr[loc.key];
  if (!it) return 'Chưa chọn món đồ';
  const cost = craftCosts(it, data)[action];
  if (action === 'salvage' && it.rarity === 'ssr') return 'Không phân giải được đồ Thần thoại';
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
    const fresh = generateItem(rng, data, it.ilvl, { rarity, baseId: it.base, classId: ch.classId });
    Object.assign(it, { rarity, name: fresh.name, stats: fresh.stats, power: fresh.power, req: { ...fresh.req, level: Math.max(fresh.req.level, data.items.basesById[it.base].req) } });
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
  if ((runeCounts(ch)[runeId] || 0) < C.count) return `Cần ${C.count} ${r.name}`;
  const gold = C.goldPerTier * r.tier;
  if (ch.gold < gold) return `Cần ${gold} vàng`;
  // Trừ dần trong các ô rune cùng loại; rune mới gộp vào ô có sẵn hoặc ô vừa trống.
  let need = C.count;
  for (let i = 0; i < ch.inventory.length && need > 0; i++) {
    const it = ch.inventory[i];
    if (!it || it.type !== 'rune' || it.rune !== runeId) continue;
    const k = Math.min(need, runeQty(it));
    need -= k;
    it.qty = runeQty(it) - k;
    if (it.qty <= 0) ch.inventory[i] = null;
  }
  ch.gold -= gold;
  addToInventory(ch, generateRune(rng, data, 99, next.id));
  return 'ok';
}

export function runeCounts(ch) {
  const c = {};
  for (const it of ch.inventory) if (it && it.type === 'rune') c[it.rune] = (c[it.rune] || 0) + runeQty(it);
  return c;
}

export function slotsForType(type, data) {
  return data.items.slots.filter((s) => s.type === type).map((s) => s.id);
}

export function firstFree(arr) {
  return arr.indexOf(null);
}

export function addToInventory(ch, item) {
  return addToArray(ch.inventory, item);
}

// ---------- Rune gộp chồng ----------
export function runeQty(it) {
  return it && it.type === 'rune' ? Math.max(1, Math.floor(it.qty || 1)) : 1;
}

// Thêm vào một dãy ô (kho đồ, rương): rune gộp vào ô cùng loại có sẵn, không cần ô trống.
export function addToArray(arr, item) {
  if (item.type === 'rune') {
    const s = arr.find((x) => x && x.type === 'rune' && x.rune === item.rune);
    if (s) { s.qty = runeQty(s) + runeQty(item); return true; }
  }
  const i = firstFree(arr);
  if (i < 0) return false;
  arr[i] = item;
  return true;
}

// Có nhặt được vào kho không (còn ô trống, hoặc rune đã có ô cùng loại).
export function canAdd(ch, item) {
  if (firstFree(ch.inventory) >= 0) return true;
  return item.type === 'rune' && ch.inventory.some((x) => x && x.type === 'rune' && x.rune === item.rune);
}

// Lấy ra 1 viên từ ô rune (hết thì ô trống). Trả về viên rune vừa lấy.
export function takeOne(arr, i) {
  const it = arr[i];
  if (!it) return null;
  if (it.type === 'rune' && runeQty(it) > 1) {
    it.qty = runeQty(it) - 1;
    return { ...it, uid: `${it.uid}-${it.qty}`, qty: 1 };
  }
  arr[i] = null;
  return it;
}

// Gộp các ô rune cùng loại trong một dãy (dùng khi tải save cũ).
export function mergeRuneStacks(arr) {
  const first = {};
  for (let i = 0; i < arr.length; i++) {
    const it = arr[i];
    if (!it || it.type !== 'rune') continue;
    it.qty = runeQty(it);
    if (first[it.rune] === undefined) first[it.rune] = i;
    else { arr[first[it.rune]].qty += it.qty; arr[i] = null; }
  }
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
  if (!addToArray(to, it)) return 'Đã đầy';
  from[i] = null;
  return 'ok';
}

// Điểm đánh giá đơn giản (bot dùng để tự mặc đồ).
export function itemScore(item, tree, physical = false, data = null) {
  if (item.type === 'rune') return -1;
  const s = itemStats(item);
  // Sát thương cơ bản của vũ khí (đúng loại với lớp) và các dòng cộng thẳng.
  let wpn = 0;
  const base = data?.items.basesById[item.base];
  if (base?.damage) {
    const want = physical === 'summon' ? 'totem' : physical ? 'melee' : 'caster';
    if (base.weaponKind === want) wpn = ((base.damage[0] + base.damage[1]) / 2) * (item.power || 1) * (1 + (s.weaponDmgPct || 0) / 100) * 1.5;
  }
  wpn += (s.addPhys || 0) * 1.5 + (s.addFire || 0) + (s.addCold || 0) + (s.addLightning || 0) * 0.6;
  const elem = tree ? (s[`${tree}DmgPct`] || 0) * 1.2 + (s[`${tree}Skills`] || 0) * 25 : 0;
  // physical: true = Chiến binh, 'summon' = Triệu hồi sư, false = Pháp sư.
  const main = physical === 'summon' ? (s.summonDmgPct || 0) * 1.3 + (s.summonHpPct || 0) * 0.5 + (s.ene || 0) * 0.6
    : physical ? (s.physDmgPct || 0) * 1.3 + (s.str || 0) * 1.0 - (s.ene || 0) * 0.6 : (s.spellDmgPct || 0) * 1.2;
  return main + elem + (s.allSkills || 0) * 25 + (s.ene || 0) * 0.8 + (s.vit || 0) * 1.2 +
    (s.maxHp || 0) * 0.4 + (s.maxMana || 0) * 0.3 + (s.armor || 0) * 0.3 + (s.cdSpeedPct || 0) * 1.2 + (s.critChance || 0) * 2 +
    (s.dex || 0) * 0.5 + (s.moveSpeedPct || 0) * 0.5 + (s.hpOnKill || 0) * 4 + (s.resAll || 0) * 0.3 + (s.leechPct || 0) * 4 + wpn;
}
