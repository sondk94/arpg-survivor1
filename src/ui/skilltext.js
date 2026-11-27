// Mô tả chỉ số kỹ năng theo cấp (dữ liệu lấy từ skills.json).
import * as P from '../core/progression.js';
import { minionCount } from '../core/minions.js';

const pct = (v) => `${Math.round(v * 1000) / 10}%`;
const num = (v) => (Math.round(v * 10) / 10).toLocaleString('vi-VN');
const range = ([a, b], m) => `${num(a * m)}–${num(b * m)}`;

// Trả về danh sách [nhãn, giá trị] của kỹ năng ở cấp hiệu lực lvl. Sát thương đã nhân hệ số hiện tại.
export function describeSkill(sk, lvl, ch, data, stats) {
  const lines = [];
  if (lvl <= 0) return lines;
  const tmp = { ...ch, skills: { ...ch.skills } };
  const mult = (sk.damage || sk.dps || sk.burnDps || sk.poison) && !sk.deathBurst ? P.damageMult(tmp, sk, stats, data) : 1;
  const cd = () => lines.push(['Hồi chiêu', `${num(sk.cooldown / stats.cdSpeed)} giây`]);
  const mana = () => lines.push(['Mana', sk.mana]);
  const slow = () => sk.slow && lines.push(['Làm chậm', `${pct(sk.slow.pct)} trong ${num(sk.slow.duration)} giây`]);
  switch (sk.id) {
    case 'fireball': {
      const n = 1 + sk.extraProjectileAt.filter((l) => lvl >= l).length;
      lines.push(['Sát thương', range(P.hitRange(sk, lvl, stats), mult)], ['Số quả', n], ['Xuyên', `${sk.pierce} quái`]);
      cd(); mana();
      break;
    }
    case 'ember_ring':
      lines.push(['Sát thương mỗi lần đốt', range(P.hitRange(sk, lvl, stats), mult)], ['Bán kính', `${num(P.lv(sk.radius, lvl))} px`],
        ['Đốt mỗi', `${num(sk.tickInterval)} giây`], ['Mana', `${num(sk.manaPerSecond)} mỗi giây`]);
      break;
    case 'fire_mastery':
    case 'cold_mastery':
    case 'lightning_mastery':
      lines.push([`Sát thương ${sk.element === 'fire' ? 'lửa' : sk.element === 'cold' ? 'băng' : 'sét'}`, `+${pct(sk.dmgPct * lvl)}`]);
      break;
    case 'meteor':
      lines.push(['Sát thương', range(P.hitRange(sk, lvl, stats), mult)], ['Vết cháy', `${num((P.lv(sk.burnDps, lvl) + P.dpsFlat(sk, stats, 'burnFlatScale')) * mult)}/giây trong ${num(sk.burnDuration)} giây`],
        ['Bán kính', `${sk.radius} px`], ['Rơi sau', `${num(sk.delay)} giây`]);
      cd(); mana();
      break;
    case 'firewall':
      lines.push(['Sát thương', `${num((P.lv(sk.dps, lvl) + P.dpsFlat(sk, stats)) * mult)}/giây`], ['Dài', `${sk.length} px, tồn tại ${num(sk.duration)} giây`], ['Làm chậm', pct(sk.slowPct)]);
      cd(); mana();
      break;
    case 'inferno_burst':
      lines.push(['Tỉ lệ nổ', pct(P.lv(sk.chance, lvl))], ['Sát thương nổ', `${pct(sk.hpPct)} máu tối đa của quái`], ['Bán kính', `${sk.radius} px`]);
      break;
    case 'ice_bolt':
      lines.push(['Sát thương', range(P.hitRange(sk, lvl, stats), mult)], ['Xuyên', lvl >= sk.pierceFromLevel ? `${sk.pierceBonus} quái` : `không (từ cấp ${sk.pierceFromLevel})`]);
      slow(); cd(); mana();
      break;
    case 'frost_nova':
      lines.push(['Sát thương', range(P.hitRange(sk, lvl, stats), mult)], ['Bán kính', `${sk.radius} px`]);
      slow(); cd(); mana();
      break;
    case 'blizzard':
      lines.push(['Sát thương', `${num((P.lv(sk.dps, lvl) + P.dpsFlat(sk, stats)) * mult)}/giây trong ${num(sk.duration)} giây`], ['Bán kính', `${sk.radius} px`], ['Làm chậm', pct(sk.slow.pct)]);
      cd(); mana();
      break;
    case 'frozen_orb':
      lines.push(['Sát thương mỗi mảnh', range(P.hitRange(sk, lvl, stats), mult)], ['Số mảnh', `≈${Math.round(sk.orbLife / sk.shardInterval)}`], ['Tầm mảnh', `${sk.shardRange} px`]);
      slow(); cd(); mana();
      break;
    case 'shatter':
      lines.push(['Sát thương lên quái bị đóng băng', `+${pct(P.lv(sk.frozenDmgBonus, lvl))}`], ['Mảnh vỡ khi chết', `${sk.shardCount} mảnh, mỗi mảnh ${pct(sk.shardHpPct)} máu tối đa của quái`]);
      break;
    case 'charged_bolt':
      lines.push(['Sát thương mỗi tia', range(P.hitRange(sk, lvl, stats), mult)], ['Số tia', sk.count]);
      cd(); mana();
      break;
    case 'lightning':
      lines.push(['Sát thương', range(P.hitRange(sk, lvl, stats), mult)], ['Độ dài', `${sk.length} px, xuyên mọi quái`]);
      cd(); mana();
      break;
    case 'chain_lightning':
      lines.push(['Sát thương', range(P.hitRange(sk, lvl, stats), mult)], ['Số lần lan', sk.jumps + Math.floor(lvl / sk.jumpEveryLevels)], ['Tầm lan', `${sk.jumpRange} px`]);
      cd(); mana();
      break;
    case 'static_field':
      lines.push(['Trừ máu hiện tại', `${pct(sk.pct)} (boss ${pct(sk.bossPct)})`], ['Bán kính', `${num(P.lv(sk.radius, lvl))} px`]);
      cd(); mana();
      break;
    case 'thunder_storm':
      lines.push(['Sát thương', range(P.hitRange(sk, lvl, stats), mult)], ['Đánh mỗi', `${num(sk.interval)} giây`], ['Tầm', `${sk.range} px`]);
      break;
    // ---- Chiến Binh
    case 'cleave':
      lines.push(['Sát thương', range(P.hitRange(sk, lvl, stats), mult)], ['Tầm', `${sk.range} px, vòng cung ${sk.arcDeg}°`]);
      cd();
      break;
    case 'whirlwind':
      lines.push(['Sát thương mỗi nhát', range(P.hitRange(sk, lvl, stats), mult)], ['Bán kính', `${num(P.lv(sk.radius, lvl))} px`],
        ['Chém mỗi', `${num(sk.tickInterval)} giây`], ['Mana', `${num(sk.manaPerSecond)} mỗi giây`]);
      break;
    case 'weapon_mastery':
      lines.push(['Sát thương vật lý', `+${pct(sk.dmgPct * lvl)}`], ['Tỉ lệ chí mạng', `+${pct(sk.critPerLevel * lvl)}`]);
      break;
    case 'leap_slam':
      lines.push(['Sát thương', range(P.hitRange(sk, lvl, stats), mult)], ['Bán kính', `${sk.radius} px`], ['Tầm nhảy', `${sk.range} px`]);
      cd(); mana();
      break;
    case 'throwing_axe': {
      const n = 1 + sk.extraProjectileAt.filter((l) => lvl >= l).length;
      lines.push(['Sát thương', range(P.hitRange(sk, lvl, stats), mult)], ['Số rìu', n], ['Xuyên', `${sk.pierce} quái`]);
      cd(); mana();
      break;
    }
    case 'frenzy':
      lines.push(['Mỗi tầng', `+${pct(P.lv(sk.stackDmg, lvl))} sát thương`], ['Tối đa', `${sk.maxStacks} tầng, giữ ${sk.stackDuration} giây`]);
      break;
    case 'howl':
      lines.push(['Sát thương', range(P.hitRange(sk, lvl, stats), mult)], ['Hoảng sợ', `${num(P.lv(sk.fear, lvl))} giây`], ['Bán kính', `${sk.radius} px`], ['Tự dùng khi', `≥${sk.minCrowd} quái sát người hoặc máu < ${pct(sk.lowHpPct)}`]);
      cd(); mana();
      break;
    case 'battle_cry':
    case 'berserk':
      lines.push(['Tăng sát thương', `+${pct(P.lv(sk.buff.dmgPct, lvl))}`], ['Thời gian', `${sk.duration} giây`]);
      if (sk.buff.armorMult) lines.push(['Giáp', `còn ${pct(sk.buff.armorMult)}`]);
      cd(); mana();
      break;
    case 'iron_skin':
      lines.push(['Giáp', `+${num(P.lv(sk.armor, lvl))}`], ['Kháng mọi nguyên tố', `+${pct(sk.resAllPerLevel * lvl)}`]);
      break;
    case 'stomp':
      lines.push(['Sát thương', range(P.hitRange(sk, lvl, stats), mult)], ['Bán kính', `${sk.radius} px`], ['Choáng', `${num(sk.slow.duration)} giây`]);
      cd(); mana();
      break;
    case 'earthquake':
      lines.push(['Sát thương', `${num((P.lv(sk.dps, lvl) + P.dpsFlat(sk, stats)) * mult)}/giây trong ${num(sk.duration)} giây`], ['Bán kính', `${sk.radius} px`], ['Làm chậm', pct(sk.slow.pct)]);
      cd(); mana();
      break;
    case 'unbroken':
      lines.push(['Hồi máu', `${pct(P.lv(sk.hpRegen, lvl))} máu tối đa mỗi giây`]);
      break;
    case 'thrust':
      lines.push(['Sát thương', range(P.hitRange(sk, lvl, stats), mult)], ['Độ dài', `${sk.length} px, xuyên mọi quái`]);
      cd();
      break;
    case 'life_leech':
      lines.push(['Hút máu', `${pct(P.lv(sk.leech, lvl))} sát thương gây ra`]);
      break;
    case 'chain_cleave':
      lines.push(['Sát thương', range(P.hitRange(sk, lvl, stats), mult)], ['Số lần lướt', sk.jumps + Math.floor(lvl / sk.jumpEveryLevels)], ['Tầm lướt', `${sk.jumpRange} px`]);
      cd(); mana();
      break;
    case 'blood_mastery':
      lines.push(['Tỉ lệ chí mạng', `+${pct(sk.critPerLevel * lvl)}`], ['Sát thương chí mạng', `+${pct(sk.critMultPerLevel * lvl)}`]);
      break;
    case 'blood_burst':
      lines.push(['Tỉ lệ nổ', pct(P.lv(sk.chance, lvl))], ['Sát thương nổ', `${pct(sk.hpPct)} máu tối đa của quái`], ['Bán kính', `${sk.radius} px`]);
      break;
    // ---- Triệu hồi sư
    case 'summon_wolf':
    case 'alpha_wolf':
    case 'summon_bear':
    case 'summon_crows': {
      const m = sk.minion;
      lines.push(['Sát thương mỗi đòn', range(P.hitRange(sk, lvl, stats), mult)], ['Đánh mỗi', `${num(m.atkInterval)} giây`],
        ['Số con', minionCount(sk, lvl, stats.summonExtra || 0)], ['Máu mỗi con', num(P.lv(m.hp, lvl) * (stats.summonHpMult || 1))],
        ['Giáp', num((m.armor || 0) + (stats.summonArmor || 0))]);
      if (m.taunt) lines.push(['Khiêu khích', `quái trong ${m.taunt} px`]);
      if (m.cleave) lines.push(['Cắn lan', `60% sát thương, bán kính ${m.cleave} px`]);
      if (m.packAura) lines.push(['Hào quang bầy', `sói thường +${pct(m.packAura)} sát thương`]);
      lines.push(['Gọi lại sau', `${num(sk.cooldown / stats.cdSpeed)} giây khi thú chết`]);
      mana();
      break;
    }
    case 'pack_howl':
      lines.push(['Tốc độ đánh của thú', `+${pct(P.lv(sk.buff.summonAtkSpeed, lvl))}`], ['Tốc độ chạy của thú', `+${pct(sk.buff.summonSpeed)}`], ['Thời gian', `${sk.duration} giây`]);
      cd(); mana();
      break;
    case 'beast_mastery':
      lines.push(['Sát thương vật triệu hồi', `+${pct(sk.summonDmgPct * lvl)}`], ['Máu vật triệu hồi', `+${pct(sk.summonHpPct * lvl)}`]);
      break;
    case 'pack_frenzy':
      lines.push(['Sát thương mỗi sói', range(P.hitRange(sk, lvl, stats), mult)], ['Bán kính', `${sk.radius} px`], ['Tầm', `${sk.searchRange} px`]);
      cd(); mana();
      break;
    case 'venom_fangs':
      lines.push(['Độc mỗi tầng', `${num(P.lv(sk.poison.dps, lvl) * mult)}/giây trong ${sk.poison.duration} giây`], ['Cộng dồn', `tối đa ${sk.poison.maxStacks} tầng`]);
      break;
    case 'thorn_hide':
      lines.push(['Phản sát thương', pct(P.lv(sk.thorns, lvl))]);
      break;
    case 'thick_hide':
      lines.push(['Máu vật triệu hồi', `+${pct(sk.summonHpPct * lvl)}`], ['Giáp vật triệu hồi', `+${num(P.lv(sk.summonArmor, lvl))}`], ['Kháng nguyên tố', `+${pct(sk.summonResistPerLevel * lvl)}`]);
      break;
    case 'bear_slam':
      lines.push(['Sát thương', range(P.hitRange(sk, lvl, stats), mult)], ['Bán kính', `${sk.radius} px quanh gấu`], ['Choáng', `${num(sk.slow.duration)} giây`]);
      cd(); mana();
      break;
    case 'wild_regrowth':
      lines.push(['Hồi máu thú', pct(P.lv(sk.healPct, lvl))], ['Hồi máu bạn', pct(P.lv(sk.playerHealPct, lvl))]);
      cd(); mana();
      break;
    case 'undying':
      lines.push(['Tỉ lệ sống lại', pct(P.lv(sk.reviveChance, lvl))], ['Máu khi sống lại', '50%']);
      break;
    case 'bee_swarm':
      lines.push(['Sát thương', `${num((P.lv(sk.dps, lvl) + P.dpsFlat(sk, stats)) * mult)}/giây trong ${num(sk.duration)} giây`], ['Bán kính', `${sk.radius} px`]);
      cd(); mana();
      break;
    case 'wild_mastery':
      lines.push(['Sát thương thú bay', `+${pct(sk.flyingDmgPct * lvl)}`], ['Chí mạng vật triệu hồi', `+${pct(sk.summonCritPerLevel * lvl)}`]);
      break;
    case 'eagle':
      lines.push(['Sát thương', range(P.hitRange(sk, lvl, stats), mult)], ['Bán kính', `${sk.radius} px`], ['Tầm', `${sk.range} px, ưu tiên tinh anh/trùm`]);
      cd(); mana();
      break;
    case 'spirit_link':
      lines.push(['Mỗi thú đang sống', `+${pct(P.lv(sk.perMinionManaRegen, lvl))} tốc độ hồi mana, +${pct(sk.perMinionResist)} kháng`], ['Tối đa', '10 con']);
      break;
    case 'feather_storm':
      lines.push(['Sát thương', range(P.hitRange(sk, lvl, stats), mult)], ['Vệt quét', `${sk.length} × ${sk.width} px`]);
      cd(); mana();
      break;
  }
  if (mult !== 1) lines.push(['Hệ số sát thương', `×${num(mult)}`]);
  return lines;
}

export function synergyText(sk, data) {
  return (sk.synergies || []).map((s) => `+${pct(s.pct)} sát thương mỗi cấp ${data.skills[s.from].name}`);
}
