// Mô tả chỉ số kỹ năng theo cấp (dữ liệu lấy từ skills.json).
import * as P from '../core/progression.js';

const pct = (v) => `${Math.round(v * 1000) / 10}%`;
const num = (v) => (Math.round(v * 10) / 10).toLocaleString('vi-VN');
const range = ([a, b], m) => `${num(a * m)}–${num(b * m)}`;

// Trả về danh sách [nhãn, giá trị] của kỹ năng ở cấp lvl. Sát thương đã nhân hệ số hiện tại.
export function describeSkill(sk, lvl, ch, data, stats) {
  const lines = [];
  if (lvl <= 0) return lines;
  // Hệ số tính với cấp kỹ năng được xem (synergy/bị động của chính nó không ảnh hưởng).
  const tmp = { ...ch, skills: { ...ch.skills, [sk.id]: lvl } };
  const mult = sk.type === 'active' ? P.damageMult(tmp, sk, stats, data) : 1;
  switch (sk.id) {
    case 'fireball': {
      const n = 1 + sk.extraProjectileAt.filter((l) => lvl >= l).length;
      lines.push(['Sát thương', range(P.damageRange(sk, lvl), mult)]);
      lines.push(['Số quả', n]);
      lines.push(['Xuyên', `${sk.pierce} quái`]);
      lines.push(['Hồi chiêu', `${num(sk.cooldown / stats.cdSpeed)} giây`]);
      lines.push(['Mana', sk.mana]);
      break;
    }
    case 'ember_ring':
      lines.push(['Sát thương mỗi lần đốt', range(P.damageRange(sk, lvl), mult)]);
      lines.push(['Bán kính', `${num(P.lv(sk.radius, lvl))} px`]);
      lines.push(['Đốt mỗi', `${num(sk.tickInterval)} giây`]);
      lines.push(['Mana', `${num(sk.manaPerSecond)} mỗi giây`]);
      break;
    case 'fire_mastery':
      lines.push(['Sát thương lửa', `+${pct(sk.fireDmgPct * lvl)}`]);
      break;
    case 'meteor':
      lines.push(['Sát thương', range(P.damageRange(sk, lvl), mult)]);
      lines.push(['Vết cháy', `${num(P.lv(sk.burnDps, lvl) * mult)}/giây trong ${num(sk.burnDuration)} giây`]);
      lines.push(['Bán kính', `${sk.radius} px`]);
      lines.push(['Rơi sau', `${num(sk.delay)} giây`]);
      lines.push(['Hồi chiêu', `${num(sk.cooldown / stats.cdSpeed)} giây`]);
      lines.push(['Mana', sk.mana]);
      break;
    case 'firewall':
      lines.push(['Sát thương', `${num(P.lv(sk.dps, lvl) * mult)}/giây`]);
      lines.push(['Dài', `${sk.length} px, tồn tại ${num(sk.duration)} giây`]);
      lines.push(['Làm chậm', pct(sk.slowPct)]);
      lines.push(['Hồi chiêu', `${num(sk.cooldown / stats.cdSpeed)} giây`]);
      lines.push(['Mana', sk.mana]);
      break;
    case 'inferno_burst':
      lines.push(['Tỉ lệ nổ', pct(P.lv(sk.chance, lvl))]);
      lines.push(['Sát thương nổ', `${pct(sk.hpPct)} máu tối đa của quái`]);
      lines.push(['Bán kính', `${sk.radius} px`]);
      break;
  }
  if (sk.type === 'active') lines.push(['Hệ số sát thương', `×${num(mult)}`]);
  return lines;
}

export function synergyText(sk, data) {
  return (sk.synergies || []).map((s) => `+${pct(s.pct)} sát thương mỗi cấp ${data.skills[s.from].name}`);
}
