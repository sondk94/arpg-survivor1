// Ngoại hình nhân vật theo đồ đang mặc (bản rút gọn): hình vũ khí theo loại, màu áo theo độ hiếm áo, hào quang bộ SSR.

// Nhóm hình vũ khí theo loại đồ gốc.
export const WEAPON_FAMILY = {
  wand: 'wand',
  staff: 'staff', grand_staff: 'staff', shadow_staff: 'staff', void_staff: 'staff',
  short_sword: 'sword',
  war_axe: 'axe', war_cleaver: 'axe',
  great_sword: 'greatsword', titan_blade: 'greatsword',
  beast_staff: 'totem', elder_totem: 'totem', primal_totem: 'totem',
};

// Vũ khí mặc định khi tay không (giữ hình cũ của từng lớp).
export const DEFAULT_WEAPON = { mage: 'staff', warrior: 'greatsword', summoner: 'totem' };

// Màu vải chính / tối theo độ hiếm của áo. Đồ thường hoặc không mặc áo: giữ màu gốc của lớp.
const BODY_COLORS = {
  magic: ['#4f6fd8', '#34489a'],
  rare: ['#c9a227', '#8e7016'],
  unique: ['#c0702a', '#83481a'],
  set: ['#3fae5a', '#2a7a3e'],
  ssr: ['#e0482a', '#9a2a16'],
};

// Trả về { weapon, weaponGlow, body: [chính, tối] | null, ssr: lớp của bộ SSR đủ 5 món | null }.
export function appearance(ch, data) {
  const eq = ch?.equipment || {};
  const w = eq.weapon;
  const body = eq.body;
  const look = {
    weapon: (w && WEAPON_FAMILY[w.base]) || DEFAULT_WEAPON[ch?.classId] || 'staff',
    weaponGlow: w && w.rarity !== 'normal' ? data.items.rarities[w.rarity]?.color || null : null,
    body: body ? BODY_COLORS[body.rarity] || null : null,
    ssr: null,
  };
  const count = {};
  for (const it of Object.values(eq)) if (it && it.rarity === 'ssr' && it.set) count[it.set] = (count[it.set] || 0) + 1;
  for (const [id, n] of Object.entries(count)) {
    const set = data.items.setsById[id];
    if (set && n >= set.pieces.length) look.ssr = set.class;
  }
  return look;
}

// Khoá để biết ngoại hình có đổi không (tránh tính lại mỗi khung hình).
export function appearanceKey(ch) {
  const eq = ch?.equipment || {};
  return Object.values(eq).map((it) => (it ? `${it.uid}:${it.rarity}` : '-')).join('|');
}
