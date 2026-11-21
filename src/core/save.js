// Lưu nhân vật + rương chung, và mã sao lưu để chuyển sang máy khác.
import { createCharacter, getClass } from './progression.js';

const FIELDS = ['uid', 'name', 'classId', 'level', 'xp', 'attrs', 'attrPoints', 'skillPoints', 'skills', 'slots', 'gold', 'inventory', 'equipment', 'runs', 'deaths', 'clears', 'mapDeaths', 'mapProgress', 'mapClears'];

function b64encode(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
function b64decode(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}
function checksum(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}

// Kiểm tra một món đồ có hợp lệ với dữ liệu hiện tại không.
function validItem(it, data) {
  return it && typeof it === 'object' && data.items.basesById[it.base] && data.items.rarities[it.rarity] &&
    it.req && typeof it.req.level === 'number' && it.stats && typeof it.stats === 'object';
}

// Chuẩn hoá dữ liệu nhân vật đọc từ ngoài: điền giá trị thiếu, bỏ đồ/kỹ năng không hợp lệ.
export function normalizeCharacter(raw, data) {
  if (!raw || typeof raw !== 'object') throw new Error('Dữ liệu nhân vật không hợp lệ');
  const classId = data.classes[raw.classId] ? raw.classId : data.classList[0].id; // nhân vật cũ (trước khi có lớp) là Pháp sư
  const ch = createCharacter(data, classId);
  const freshUid = ch.uid;
  for (const k of FIELDS) if (raw[k] !== undefined) ch[k] = JSON.parse(JSON.stringify(raw[k]));
  const num = (v, d) => (Number.isFinite(v) ? v : d);
  ch.level = Math.max(1, Math.min(data.config.xp.maxLevel, Math.floor(num(ch.level, 1))));
  ch.xp = Math.max(0, num(ch.xp, 0));
  ch.gold = Math.max(0, Math.floor(num(ch.gold, 0)));
  ch.attrPoints = Math.max(0, Math.floor(num(ch.attrPoints, 0)));
  ch.skillPoints = Math.max(0, Math.floor(num(ch.skillPoints, 0)));
  ch.classId = classId;
  ch.uid = typeof ch.uid === 'string' && ch.uid ? ch.uid.slice(0, 40) : freshUid;
  ch.name = String(ch.name || getClass(ch, data).short).slice(0, 24);
  const start = getClass(ch, data).startAttributes;
  ch.attrs = Object.fromEntries(Object.keys(start).map((k) => [k, Math.max(start[k], Math.floor(num(ch.attrs?.[k], start[k])))]));
  const skills = {};
  const trees = getClass(ch, data).trees;
  for (const [id, l] of Object.entries(ch.skills || {})) if (data.skills[id] && trees.includes(data.skills[id].tree) && l > 0) skills[id] = Math.min(data.skills[id].maxLevel, Math.floor(l));
  ch.skills = skills;
  const maxSlots = data.config.player.maxSlots;
  ch.slots = Array.from({ length: maxSlots }, (_, i) => {
    const id = Array.isArray(ch.slots) ? ch.slots[i] : null;
    return id && skills[id] && data.skills[id].type === 'active' ? id : null;
  });
  const inv = Array.isArray(ch.inventory) ? ch.inventory : [];
  ch.inventory = Array.from({ length: data.items.inventorySize }, (_, i) => (validItem(inv[i], data) ? inv[i] : null));
  const eq = {};
  for (const s of data.items.slots) {
    const it = ch.equipment?.[s.id];
    eq[s.id] = validItem(it, data) && it.type === s.type ? it : null;
  }
  ch.equipment = eq;
  ch.mapDeaths = ch.mapDeaths && typeof ch.mapDeaths === 'object' ? ch.mapDeaths : {};
  for (const k of ['runs', 'deaths', 'clears']) ch[k] = Math.max(0, Math.floor(num(ch[k], 0)));
  ch.mapProgress = Math.max(0, Math.min(data.mapOrder.length - 1, Math.floor(num(ch.mapProgress, 0))));
  ch.mapClears = ch.mapClears && typeof ch.mapClears === 'object' ? ch.mapClears : {};
  return ch;
}

export function normalizeStash(raw, data) {
  const arr = Array.isArray(raw) ? raw : [];
  return Array.from({ length: data.items.stashSize }, (_, i) => (validItem(arr[i], data) ? arr[i] : null));
}

export function newStash(data) {
  return new Array(data.items.stashSize).fill(null);
}

function storage() {
  try { return globalThis.localStorage || null; } catch { return null; }
}

export function saveGame(ch, stash, data) {
  const ls = storage();
  if (!ls) return false;
  try {
    const plain = Object.fromEntries(FIELDS.map((k) => [k, ch[k]]));
    ls.setItem(data.config.save.charKey, JSON.stringify(plain));
    ls.setItem(data.config.save.stashKey, JSON.stringify(stash));
    return true;
  } catch {
    return false;
  }
}

export function loadGame(data) {
  const ls = storage();
  let ch = null, stash = newStash(data);
  if (!ls) return { ch, stash };
  try {
    const c = ls.getItem(data.config.save.charKey);
    if (c) ch = normalizeCharacter(JSON.parse(c), data);
  } catch { ch = null; }
  try {
    const s = ls.getItem(data.config.save.stashKey);
    if (s) stash = normalizeStash(JSON.parse(s), data);
  } catch { /* giữ rương trống */ }
  return { ch, stash };
}

// Mã sao lưu: TIỀN_TỐ.base64(json).checksum — gồm nhân vật và rương chung.
export function exportCode(ch, stash, data) {
  const plain = Object.fromEntries(FIELDS.map((k) => [k, ch[k]]));
  const json = JSON.stringify({ v: 1, ch: plain, stash });
  const body = b64encode(json);
  return `${data.config.save.codePrefix}.${body}.${checksum(body)}`;
}

export function importCode(code, data) {
  const parts = String(code || '').trim().replace(/\s+/g, '').split('.');
  if (parts.length !== 3 || parts[0] !== data.config.save.codePrefix) throw new Error('Mã không đúng định dạng');
  if (checksum(parts[1]) !== parts[2]) throw new Error('Mã bị hỏng hoặc chép thiếu');
  let obj;
  try { obj = JSON.parse(b64decode(parts[1])); } catch { throw new Error('Không đọc được mã'); }
  return { ch: normalizeCharacter(obj.ch, data), stash: normalizeStash(obj.stash, data) };
}

// ---------- Nhiều nhân vật ----------
// roster = { active: uid | null, chars: [nhân vật] }. Rương chung dùng chung cho mọi nhân vật.
export function loadRoster(data) {
  const ls = storage();
  const roster = { active: null, chars: [] };
  let stash = newStash(data);
  if (!ls) return { roster, stash };
  try {
    const raw = JSON.parse(ls.getItem(data.config.save.rosterKey) || 'null');
    if (raw && Array.isArray(raw.chars)) {
      for (const c of raw.chars) { try { roster.chars.push(normalizeCharacter(c, data)); } catch { /* bỏ nhân vật hỏng */ } }
      roster.active = raw.active;
    } else {
      // Chuyển dữ liệu kiểu cũ (một nhân vật) sang danh sách.
      const old = ls.getItem(data.config.save.charKey);
      if (old) roster.chars.push(normalizeCharacter(JSON.parse(old), data));
      if (roster.chars[0]) roster.active = roster.chars[0].uid;
    }
  } catch { /* giữ danh sách trống */ }
  try {
    const st = ls.getItem(data.config.save.stashKey);
    if (st) stash = normalizeStash(JSON.parse(st), data);
  } catch { /* giữ rương trống */ }
  if (!roster.chars.some((c) => c.uid === roster.active)) roster.active = roster.chars[0]?.uid || null;
  return { roster, stash };
}

export function saveRoster(roster, stash, data) {
  const ls = storage();
  if (!ls) return false;
  try {
    const plain = { active: roster.active, chars: roster.chars.map((ch) => Object.fromEntries(FIELDS.map((k) => [k, ch[k]]))) };
    ls.setItem(data.config.save.rosterKey, JSON.stringify(plain));
    ls.setItem(data.config.save.stashKey, JSON.stringify(stash));
    return true;
  } catch {
    return false;
  }
}
