// Bot đơn giản cho mô phỏng và chế độ debug "bot tự chơi".
import * as P from './progression.js';
import { itemScore, equipFromInventory, meetsReq, totalStr, slotsForType, insertRune, freeSockets } from './items.js';

// Các kiểu cộng điểm. attrs: tỉ lệ chia mỗi 5 điểm. skills: [id, cấp mục tiêu] ưu tiên từ trên xuống.
export const BUILDS = {
  fire: {
    tree: 'fire',
    attrs: { ene: 2, vit: 2, dex: 1 },
    skills: [['fireball', 1], ['ember_ring', 1], ['fire_mastery', 1], ['meteor', 1], ['firewall', 1], ['inferno_burst', 1], ['fireball', 20]],
  },
  fire_ring: {
    tree: 'fire',
    attrs: { vit: 3, ene: 2 },
    skills: [['fireball', 1], ['ember_ring', 3], ['fire_mastery', 1], ['meteor', 1], ['firewall', 1], ['inferno_burst', 1], ['ember_ring', 20]],
  },
  cold: {
    tree: 'cold',
    attrs: { ene: 2, vit: 2, dex: 1 },
    skills: [['ice_bolt', 1], ['frost_nova', 1], ['cold_mastery', 1], ['blizzard', 1], ['frozen_orb', 1], ['shatter', 1], ['ice_bolt', 20]],
  },
  lightning: {
    tree: 'lightning',
    attrs: { ene: 2, vit: 2, dex: 1 },
    skills: [['charged_bolt', 1], ['lightning', 1], ['lightning_mastery', 1], ['chain_lightning', 1], ['static_field', 1], ['thunder_storm', 1], ['chain_lightning', 20]],
  },
  hybrid: {
    tree: 'cold',
    attrs: { ene: 2, vit: 2, dex: 1 },
    skills: [['ice_bolt', 1], ['frost_nova', 1], ['fireball', 1], ['meteor', 1], ['fire_mastery', 1], ['fireball', 20]],
  },
};
BUILDS.fireball = BUILDS.fire;
for (const b of Object.values(BUILDS)) b.class = b.class || 'mage';
Object.assign(BUILDS, {
  weapon: {
    class: 'warrior', tree: 'weapon',
    attrs: { str: 2, vit: 2, dex: 1 },
    skills: [['cleave', 1], ['whirlwind', 1], ['weapon_mastery', 1], ['leap_slam', 1], ['throwing_axe', 1], ['frenzy', 1], ['cleave', 20]],
  },
  shout: {
    class: 'warrior', tree: 'shout',
    attrs: { str: 2, vit: 2, dex: 1 },
    skills: [['howl', 1], ['battle_cry', 1], ['iron_skin', 1], ['stomp', 1], ['earthquake', 1], ['unbroken', 1], ['stomp', 20]],
  },
  blood: {
    class: 'warrior', tree: 'blood',
    attrs: { str: 2, vit: 2, dex: 1 },
    skills: [['thrust', 1], ['life_leech', 1], ['chain_cleave', 1], ['berserk', 1], ['blood_mastery', 1], ['blood_burst', 1], ['chain_cleave', 20]],
  },
  pack: {
    class: 'summoner', tree: 'pack',
    attrs: { ene: 2, vit: 2, dex: 1 },
    skills: [['summon_wolf', 1], ['summon_bear', 1], ['beast_mastery', 1], ['alpha_wolf', 1], ['pack_frenzy', 1], ['venom_fangs', 1], ['summon_wolf', 12], ['beast_mastery', 20], ['summon_wolf', 20]],
  },
  beast: {
    class: 'summoner', tree: 'beast',
    attrs: { ene: 2, vit: 2, dex: 1 },
    skills: [['summon_bear', 1], ['summon_wolf', 1], ['thorn_hide', 1], ['thick_hide', 1], ['bear_slam', 1], ['wild_regrowth', 1], ['undying', 1], ['summon_bear', 10], ['bear_slam', 20], ['summon_bear', 20]],
  },
  swarm: {
    class: 'summoner', tree: 'swarm',
    attrs: { ene: 2, vit: 2, dex: 1 },
    skills: [['summon_crows', 1], ['summon_bear', 1], ['bee_swarm', 1], ['wild_mastery', 1], ['eagle', 1], ['spirit_link', 1], ['eagle', 20], ['summon_crows', 20]],
  },
});

export function botAllocate(ch, data, buildName = 'fireball') {
  const b = BUILDS[buildName] || BUILDS.fireball;
  const order = [];
  for (const [k, n] of Object.entries(b.attrs)) for (let i = 0; i < n; i++) order.push(k);
  let i = 0;
  const changes = { attrs: {}, skills: {} };
  while (ch.attrPoints > 0) {
    const k = order[i++ % order.length];
    P.addAttr(ch, k, 1);
    changes.attrs[k] = (changes.attrs[k] || 0) + 1;
  }
  let progressed = true;
  while (ch.skillPoints > 0 && progressed) {
    progressed = false;
    for (const [id, target] of b.skills) {
      if ((ch.skills[id] || 0) >= target) continue;
      if (!P.canLearn(ch, id, data).ok) continue;
      const res = P.learnSkill(ch, id, data, 3);
      if (res === 'ok') {
        changes.skills[id] = (changes.skills[id] || 0) + 1;
        progressed = true;
        break;
      }
    }
  }
  return changes;
}

// Hướng di chuyển: tránh quái/đạn/vũng độc, đi nhặt ngọc, không ra sát mép bản đồ.
export function botInput(game, opts = {}) {
  const p = game.player;
  // Đã hạ boss: đi thẳng tới rương thưởng.
  if (game.victory) {
    const c = game.pickups.find((k) => k.kind === 'chest' && !k.dead);
    if (!c) return { x: 0, y: 0 };
    const dx = c.x - p.x, dy = c.y - p.y, d = Math.hypot(dx, dy) || 1;
    return { x: dx / d, y: dy / d };
  }
  let fx = 0, fy = 0;
  let danger = 0;
  // Cận chiến: áp sát quái gần nhất, chỉ lùi khi máu thấp.
  const melee = game.cls?.look === 'warrior' && p.hp > game.stats.maxHp * 0.35;
  if (melee) {
    let best = null, bd = 600;
    for (const e of game.enemies) {
      if (e.dead || e.flee) continue;
      const d = Math.hypot(e.x - p.x, e.y - p.y) - e.r;
      const w = d - (e.elite ? 80 : 0) - (e.big ? 120 : 0);
      if (w < bd) { bd = w; best = e; }
    }
    if (best) {
      const dx = best.x - p.x, dy = best.y - p.y;
      const d = Math.hypot(dx, dy) || 1;
      const stand = best.r + p.r + (best.big ? 40 : 25);
      const k = d > stand ? 1.2 : -0.6;
      fx += (dx / d) * k; fy += (dy / d) * k;
    }
  }
  for (const e of game.enemies) {
    if (e.dead || e.flee) continue;
    const dx = p.x - e.x, dy = p.y - e.y;
    const d = Math.hypot(dx, dy) || 1;
    const reach = melee ? (e.big ? 90 : 0) : e.big ? 260 : 170;
    if (!reach) continue;
    if (d < reach) {
      const w = ((reach - d) / reach) ** 2 * (e.big ? 3 : 1) * (e.elite ? 1.5 : 1);
      fx += (dx / d) * w; fy += (dy / d) * w;
      danger += w;
    }
  }
  if (opts.dodge !== false) {
    for (const s of game.shots) {
      const dx = p.x - s.x, dy = p.y - s.y;
      const d = Math.hypot(dx, dy) || 1;
      if (d < 120) {
        // né vuông góc với hướng đạn
        const sl = Math.hypot(s.vx, s.vy) || 1;
        let nx = -s.vy / sl, ny = s.vx / sl;
        if (nx * dx + ny * dy < 0) { nx = -nx; ny = -ny; }
        fx += nx * 1.5; fy += ny * 1.5; danger += 1;
      }
    }
    for (const z of game.zones) {
      if (z.kind !== 'poison') continue;
      const dx = p.x - z.x, dy = p.y - z.y;
      const d = Math.hypot(dx, dy) || 1;
      if (d < z.r + 40) { fx += (dx / d) * 3; fy += (dy / d) * 3; danger += 3; }
    }
    for (const pd of game.pending) {
      if (pd.kind !== 'pool' && pd.kind !== 'eliteBlast') continue;
      const dx = p.x - pd.x, dy = p.y - pd.y;
      const d = Math.hypot(dx, dy) || 1;
      if (d < pd.r + 40) { fx += (dx / d) * 3; fy += (dy / d) * 3; danger += 3; }
    }
    const b = game.boss;
    if (b && !b.dead && (b.b.state === 'tele' || b.b.state === 'dash')) {
      const sx = b.b.sx ?? b.x, sy = b.b.sy ?? b.y;
      const lx = b.b.tx - sx, ly = b.b.ty - sy;
      const ll = Math.hypot(lx, ly) || 1;
      let nx = -ly / ll, ny = lx / ll;
      if (nx * (p.x - sx) + ny * (p.y - sy) < 0) { nx = -nx; ny = -ny; }
      fx += nx * 4; fy += ny * 4; danger += 4;
    }
  }
  // Nhặt ngọc gần nhất khi không quá nguy hiểm.
  if (danger < 1.5) {
    let best = null, bd = 380;
    for (const k of game.pickups) {
      if (k.dead || k.mag) continue;
      const d = Math.hypot(k.x - p.x, k.y - p.y);
      if (d < bd) { bd = d; best = k; }
    }
    if (best) { fx += ((best.x - p.x) / bd) * 0.8; fy += ((best.y - p.y) / bd) * 0.8; }
  }
  // Kéo về giữa bản đồ khi gần mép.
  const cx = game.W / 2 - p.x, cy = game.H / 2 - p.y;
  const cd = Math.hypot(cx, cy) || 1;
  if (cd > 900) { const w = (cd - 900) / 300; fx += (cx / cd) * w; fy += (cy / cd) * w; }
  // Tránh vật cản trước mặt.
  for (const o of game.obstacles) {
    const dx = p.x - o.x, dy = p.y - o.y;
    const d = Math.hypot(dx, dy);
    if (d < o.r + 40) { fx += (dx / d) * 0.8; fy += (dy / d) * 0.8; }
  }
  const len = Math.hypot(fx, fy);
  if (len < 0.05) {
    // Đi vòng chậm để giữ nhịp
    const a = game.time * 0.4;
    return { x: Math.cos(a) * 0.5, y: Math.sin(a) * 0.5 };
  }
  return { x: fx / len, y: fy / len };
}

// Bot tự mặc món tốt hơn trong kho (theo điểm đánh giá đơn giản).
export function botManageItems(ch, data, buildName = 'fire') {
  const tree = (BUILDS[buildName] || BUILDS.fire).tree;
  const cls = (BUILDS[buildName] || {}).class;
  const physical = cls === 'summoner' ? 'summon' : cls === 'warrior';
  let changed = false;
  for (let i = 0; i < ch.inventory.length; i++) {
    const it = ch.inventory[i];
    if (!it || !meetsReq(it, ch.level, totalStr(ch))) continue;
    const slots = slotsForType(it.type, data);
    let target = null, worst = Infinity;
    for (const s of slots) {
      const cur = ch.equipment[s];
      const sc = cur ? itemScore(cur, tree, physical, data) : -1;
      if (sc < worst) { worst = sc; target = s; }
    }
    if (target && itemScore(it, tree, physical, data) > worst && equipFromInventory(ch, i, data, target) === 'ok') changed = true;
  }
  // Ghép rune vào đồ đang mặc còn lỗ trống (vũ khí trước).
  for (let i = 0; i < ch.inventory.length; i++) {
    const ru = ch.inventory[i];
    if (!ru || ru.type !== 'rune') continue;
    const target = ['weapon', 'body', 'head', 'offhand'].map((sl) => ch.equipment[sl]).find((it) => it && freeSockets(it) > 0);
    if (target && insertRune(ch, i, target, data) === 'ok') changed = true;
  }
  return changed;
}
