// Bot đơn giản cho mô phỏng và chế độ debug "bot tự chơi".
import * as P from './progression.js';

// Các kiểu cộng điểm. attrs: tỉ lệ chia mỗi 5 điểm. skills: [id, cấp mục tiêu] ưu tiên từ trên xuống.
export const BUILDS = {
  fireball: {
    attrs: { ene: 2, vit: 2, dex: 1 },
    skills: [['ember_ring', 1], ['fire_mastery', 1], ['meteor', 1], ['firewall', 1], ['inferno_burst', 1], ['fireball', 20]],
  },
  ring: {
    attrs: { vit: 3, ene: 2 },
    skills: [['ember_ring', 3], ['fire_mastery', 1], ['meteor', 1], ['firewall', 1], ['inferno_burst', 1], ['ember_ring', 20]],
  },
  balanced: {
    attrs: { ene: 2, vit: 2, dex: 1 },
    skills: [['ember_ring', 1], ['fire_mastery', 1], ['meteor', 1], ['firewall', 1], ['inferno_burst', 1], ['meteor', 4], ['fireball', 4], ['fire_mastery', 20]],
  },
};

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
  let fx = 0, fy = 0;
  let danger = 0;
  for (const e of game.enemies) {
    if (e.dead || e.flee) continue;
    const dx = p.x - e.x, dy = p.y - e.y;
    const d = Math.hypot(dx, dy) || 1;
    const reach = e.big ? 260 : 170;
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
