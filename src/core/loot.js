// Quản lý đồ: so sánh với đồ đang mặc, khoá, bán / phân giải hàng loạt, mua lại, bộ lọc nhặt, sắp xếp kho.
import * as P from './progression.js';
import { itemScore, itemStats, sellValue, salvageValue, slotsForType, meetsReq, totalStr } from './items.js';

export const BUYBACK_MAX = 10;
const RARITY_ORDER = { ssr: -1, set: 0, unique: 1, rare: 2, magic: 3, normal: 4, rune: 5 };

// Chỉ số chỉ có ích cho một lớp: dùng để nhận ra đồ "sai lớp".
const CLASS_KEYS = {
  mage: ['spellDmgPct', 'fireDmgPct', 'coldDmgPct', 'lightningDmgPct', 'fireSkills', 'coldSkills', 'lightningSkills', 'lightningEliteDmgPct', 'freezeHits'],
  warrior: ['physDmgPct', 'weaponSkills', 'shoutSkills', 'bloodSkills'],
  summoner: ['summonDmgPct', 'summonHpPct', 'packSkills', 'beastSkills', 'swarmSkills'],
};

export function defaultLootFilter() {
  // normal: 'pick' nhặt | 'skip' bỏ qua | 'sell' tự bán khi nhặt. magicMinLevel: bỏ qua đồ xanh có cấp đồ thấp hơn.
  // makeRoom: kho đầy thì tự bán món rác rẻ nhất để lấy chỗ cho món tốt hơn.
  return { normal: 'pick', magicMinLevel: 0, makeRoom: false };
}

export function lootFilter(ch) {
  return { ...defaultLootFilter(), ...(ch.lootFilter || {}) };
}

// Nhánh chính của nhân vật (nhiều điểm nhất) để chấm điểm đồ.
export function mainTree(ch, data) {
  let best = null, bn = -1;
  for (const t of P.classTrees(ch, data)) {
    const n = data.skillList.filter((s) => s.tree === t).reduce((a, s) => a + (ch.skills[s.id] || 0), 0);
    if (n > bn) { bn = n; best = t; }
  }
  return best;
}

export function scoreMode(ch) {
  return ch.classId === 'summoner' ? 'summon' : ch.classId === 'warrior';
}

// Đồ có dòng chỉ số dành riêng cho lớp khác và không có dòng nào cho lớp mình.
export function wrongClass(it, ch) {
  if (!it || it.type === 'rune') return false;
  const s = itemStats(it);
  const mine = CLASS_KEYS[ch.classId] || [];
  let other = false;
  for (const [cls, keys] of Object.entries(CLASS_KEYS)) {
    for (const k of keys) {
      if (!s[k]) continue;
      if (cls === ch.classId || mine.includes(k)) return false;
      other = true;
    }
  }
  return other;
}

// So sánh với đồ đang mặc: 'up' tốt hơn, 'down' kém hơn, 'same', 'cant' sai lớp / chưa đủ yêu cầu, null với rune.
export function itemVerdict(it, ch, data, tree = mainTree(ch, data)) {
  if (!it || it.type === 'rune') return null;
  if (wrongClass(it, ch) || !meetsReq(it, ch.level, totalStr(ch))) return 'cant';
  const mode = scoreMode(ch);
  const sc = itemScore(it, tree, mode, data);
  let worst = Infinity;
  for (const sl of slotsForType(it.type, data)) {
    const cur = ch.equipment[sl];
    const v = cur ? itemScore(cur, tree, mode, data) : -1;
    if (v < worst) worst = v;
  }
  if (worst === Infinity) return 'cant';
  if (sc > worst + 0.5) return 'up';
  if (sc < worst - 0.5) return 'down';
  return 'same';
}

const isSpecial = (it) => it.rarity === 'unique' || it.rarity === 'set' || it.rarity === 'ssr' || it.type === 'rune';

// Chỉ số các ô kho đồ khớp bộ lọc bán / phân giải nhanh. Không bao giờ lấy đồ đã khoá.
// filter: 'normal' | 'magic' | 'worse' | 'wrongClass' | 'junk'. includeSpecial: tính cả độc nhất, đồ bộ, rune.
export function bulkCandidates(ch, data, filter, includeSpecial = false) {
  const tree = mainTree(ch, data);
  const out = [];
  ch.inventory.forEach((it, i) => {
    if (!it || it.locked) return;
    if (isSpecial(it) && !includeSpecial) return;
    let ok = false;
    if (filter === 'normal') ok = it.rarity === 'normal';
    else if (filter === 'magic') ok = it.rarity === 'magic';
    else if (filter === 'worse') { const v = itemVerdict(it, ch, data, tree); ok = v === 'down' || v === 'same'; }
    else if (filter === 'wrongClass') ok = wrongClass(it, ch);
    else if (filter === 'junk') ok = !!it.junk;
    if (ok) out.push(i);
  });
  return out;
}

// Bán các ô đã chọn; món bán được giữ trong danh sách mua lại (10 món gần nhất).
export function sellItems(ch, idxs, data) {
  let gold = 0, n = 0;
  for (const i of idxs) {
    const it = ch.inventory[i];
    if (!it || it.locked) continue;
    const v = sellValue(it, data);
    gold += v; n++;
    ch.inventory[i] = null;
    delete it.junk;
    ch.buyback = [{ item: it, price: v }, ...(ch.buyback || [])].slice(0, BUYBACK_MAX);
  }
  ch.gold += gold;
  return { gold, n };
}

export function buyBack(ch, idx) {
  const b = (ch.buyback || [])[idx];
  if (!b) return 'Không có món này';
  if (ch.gold < b.price) return `Cần ${b.price} vàng`;
  const free = ch.inventory.indexOf(null);
  if (free < 0) return 'Kho đồ đầy';
  ch.gold -= b.price;
  ch.inventory[free] = b.item;
  ch.buyback.splice(idx, 1);
  return 'ok';
}

export function salvageItems(ch, idxs, data) {
  let shards = 0, n = 0;
  for (const i of idxs) {
    const it = ch.inventory[i];
    if (!it || it.locked || it.rarity === 'ssr') continue; // đồ Thần thoại không phân giải được
    shards += salvageValue(it, data); n++;
    ch.inventory[i] = null;
  }
  ch.shards = (ch.shards || 0) + shards;
  return { shards, n };
}

export function sumValue(ch, idxs, data, fn = sellValue) {
  return idxs.reduce((a, i) => a + (ch.inventory[i] ? fn(ch.inventory[i], data) : 0), 0);
}

// Sắp xếp kho: theo thứ tự ô trang bị, rồi độ hiếm (đồ bộ, độc nhất, hiếm…), rồi cấp đồ; rune ở cuối. Ô trống dồn về sau.
export function sortInventory(ch, data) {
  const slotOrder = {};
  data.items.slots.forEach((s, i) => { if (!(s.type in slotOrder)) slotOrder[s.type] = i; });
  const items = ch.inventory.filter(Boolean);
  items.sort((a, b) => {
    const ta = a.type === 'rune' ? 999 : slotOrder[a.type] ?? 500, tb = b.type === 'rune' ? 999 : slotOrder[b.type] ?? 500;
    if (ta !== tb) return ta - tb;
    const ra = RARITY_ORDER[a.rarity] ?? 9, rb = RARITY_ORDER[b.rarity] ?? 9;
    if (ra !== rb) return ra - rb;
    if (a.type === 'rune') return (data.runes.byId[b.rune]?.tier || 0) - (data.runes.byId[a.rune]?.tier || 0);
    return b.ilvl - a.ilvl;
  });
  ch.inventory = [...items, ...new Array(ch.inventory.length - items.length).fill(null)];
}

// Bộ lọc nhặt: 'pick' nhặt, 'skip' bỏ qua, 'sell' bán ngay lấy vàng. Vàng, rune, đồ hiếm trở lên luôn nhặt.
export function lootDecision(it, ch) {
  const f = lootFilter(ch);
  if (it.type === 'rune') return 'pick';
  if (it.rarity === 'normal') return f.normal;
  if (it.rarity === 'magic' && it.ilvl < (f.magicMinLevel || 0)) return 'skip';
  return 'pick';
}

// Kho đầy: tìm món rác rẻ nhất (đánh dấu rác hoặc đồ trắng, chưa khoá) để bán lấy chỗ.
export function makeRoomFor(ch, item, data) {
  if (!lootFilter(ch).makeRoom) return null;
  let best = -1, bv = Infinity;
  ch.inventory.forEach((it, i) => {
    if (!it || it.locked || isSpecial(it)) return;
    if (!(it.junk || it.rarity === 'normal')) return;
    const v = sellValue(it, data);
    if (v < bv) { bv = v; best = i; }
  });
  if (best < 0) return null;
  // Không đổi một món rác lấy một món rác khác kém hơn.
  if (item.rarity === 'normal' && sellValue(item, data) <= bv) return null;
  const old = ch.inventory[best];
  sellItems(ch, [best], data);
  return { item: old, gold: bv };
}
