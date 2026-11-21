// Mô tả chỉ số kỹ năng theo cấp (dữ liệu lấy từ skills.json).
import * as P from '../core/progression.js';

const pct = (v) => `${Math.round(v * 1000) / 10}%`;
const num = (v) => (Math.round(v * 10) / 10).toLocaleString('vi-VN');
const range = ([a, b], m) => `${num(a * m)}–${num(b * m)}`;

// Trả về danh sách [nhãn, giá trị] của kỹ năng ở cấp hiệu lực lvl. Sát thương đã nhân hệ số hiện tại.
export function describeSkill(sk, lvl, ch, data, stats) {
  const lines = [];
  if (lvl <= 0) return lines;
  const tmp = { ...ch, skills: { ...ch.skills } };
  const mult = sk.damage || sk.dps || sk.burnDps ? P.damageMult(tmp, sk, stats, data) : 1;
  const cd = () => lines.push(['Hồi chiêu', `${num(sk.cooldown / stats.cdSpeed)} giây`]);
  const mana = () => lines.push(['Mana', sk.mana]);
  const slow = () => sk.slow && lines.push(['Làm chậm', `${pct(sk.slow.pct)} trong ${num(sk.slow.duration)} giây`]);
  switch (sk.id) {
    case 'fireball': {
      const n = 1 + sk.extraProjectileAt.filter((l) => lvl >= l).length;
      lines.push(['Sát thương', range(P.damageRange(sk, lvl), mult)], ['Số quả', n], ['Xuyên', `${sk.pierce} quái`]);
      cd(); mana();
      break;
    }
    case 'ember_ring':
      lines.push(['Sát thương mỗi lần đốt', range(P.damageRange(sk, lvl), mult)], ['Bán kính', `${num(P.lv(sk.radius, lvl))} px`],
        ['Đốt mỗi', `${num(sk.tickInterval)} giây`], ['Mana', `${num(sk.manaPerSecond)} mỗi giây`]);
      break;
    case 'fire_mastery':
    case 'cold_mastery':
    case 'lightning_mastery':
      lines.push([`Sát thương ${sk.element === 'fire' ? 'lửa' : sk.element === 'cold' ? 'băng' : 'sét'}`, `+${pct(sk.dmgPct * lvl)}`]);
      break;
    case 'meteor':
      lines.push(['Sát thương', range(P.damageRange(sk, lvl), mult)], ['Vết cháy', `${num(P.lv(sk.burnDps, lvl) * mult)}/giây trong ${num(sk.burnDuration)} giây`],
        ['Bán kính', `${sk.radius} px`], ['Rơi sau', `${num(sk.delay)} giây`]);
      cd(); mana();
      break;
    case 'firewall':
      lines.push(['Sát thương', `${num(P.lv(sk.dps, lvl) * mult)}/giây`], ['Dài', `${sk.length} px, tồn tại ${num(sk.duration)} giây`], ['Làm chậm', pct(sk.slowPct)]);
      cd(); mana();
      break;
    case 'inferno_burst':
      lines.push(['Tỉ lệ nổ', pct(P.lv(sk.chance, lvl))], ['Sát thương nổ', `${pct(sk.hpPct)} máu tối đa của quái`], ['Bán kính', `${sk.radius} px`]);
      break;
    case 'ice_bolt':
      lines.push(['Sát thương', range(P.damageRange(sk, lvl), mult)], ['Xuyên', lvl >= sk.pierceFromLevel ? `${sk.pierceBonus} quái` : `không (từ cấp ${sk.pierceFromLevel})`]);
      slow(); cd(); mana();
      break;
    case 'frost_nova':
      lines.push(['Sát thương', range(P.damageRange(sk, lvl), mult)], ['Bán kính', `${sk.radius} px`]);
      slow(); cd(); mana();
      break;
    case 'blizzard':
      lines.push(['Sát thương', `${num(P.lv(sk.dps, lvl) * mult)}/giây trong ${num(sk.duration)} giây`], ['Bán kính', `${sk.radius} px`], ['Làm chậm', pct(sk.slow.pct)]);
      cd(); mana();
      break;
    case 'frozen_orb':
      lines.push(['Sát thương mỗi mảnh', range(P.damageRange(sk, lvl), mult)], ['Số mảnh', `≈${Math.round(sk.orbLife / sk.shardInterval)}`], ['Tầm mảnh', `${sk.shardRange} px`]);
      slow(); cd(); mana();
      break;
    case 'shatter':
      lines.push(['Sát thương lên quái bị đóng băng', `+${pct(P.lv(sk.frozenDmgBonus, lvl))}`], ['Mảnh vỡ khi chết', `${sk.shardCount} mảnh, mỗi mảnh ${pct(sk.shardHpPct)} máu tối đa của quái`]);
      break;
    case 'charged_bolt':
      lines.push(['Sát thương mỗi tia', range(P.damageRange(sk, lvl), mult)], ['Số tia', sk.count]);
      cd(); mana();
      break;
    case 'lightning':
      lines.push(['Sát thương', range(P.damageRange(sk, lvl), mult)], ['Độ dài', `${sk.length} px, xuyên mọi quái`]);
      cd(); mana();
      break;
    case 'chain_lightning':
      lines.push(['Sát thương', range(P.damageRange(sk, lvl), mult)], ['Số lần lan', sk.jumps + Math.floor(lvl / sk.jumpEveryLevels)], ['Tầm lan', `${sk.jumpRange} px`]);
      cd(); mana();
      break;
    case 'static_field':
      lines.push(['Trừ máu hiện tại', `${pct(sk.pct)} (boss ${pct(sk.bossPct)})`], ['Bán kính', `${num(P.lv(sk.radius, lvl))} px`]);
      cd(); mana();
      break;
    case 'thunder_storm':
      lines.push(['Sát thương', range(P.damageRange(sk, lvl), mult)], ['Đánh mỗi', `${num(sk.interval)} giây`], ['Tầm', `${sk.range} px`]);
      break;
  }
  if (mult !== 1) lines.push(['Hệ số sát thương', `×${num(mult)}`]);
  return lines;
}

export function synergyText(sk, data) {
  return (sk.synergies || []).map((s) => `+${pct(s.pct)} sát thương mỗi cấp ${data.skills[s.from].name}`);
}
