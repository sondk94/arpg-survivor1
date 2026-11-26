// Vật triệu hồi của Triệu hồi sư Hoang dã: sói, sói đầu đàn, gấu, quạ và các kỹ năng điều khiển bầy thú.
// Các hàm ở đây được gắn vào Game.prototype (xem cuối game.js).
import * as P from './progression.js';

const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// Số con mong muốn của một kỹ năng gọi thú theo cấp.
export function minionCount(sk, lvl, extra = 0) {
  const m = sk.minion;
  return (m.countBase || 1) + (m.countAt || []).filter((l) => lvl >= l).length + extra;
}

export const MinionMixin = {
  minionCfg() {
    return this.cfg.summons || { maxTotal: 12, leash: 600, aggro: 380, retargetEvery: 0.5, hitCooldown: 0.4 };
  },

  aliveMinions(filter) {
    let n = 0;
    for (const m of this.minions) if (!m.dead && (!filter || filter(m))) n++;
    return n;
  },

  minionMaxHp(sk, lvl) {
    return P.lv(sk.minion.hp, lvl) * (this.stats.summonHpMult || 1);
  },

  // Gọi thú: gọi bù đủ số con theo cấp kỹ năng. Không thiếu con nào thì không tốn mana.
  castSummon(sk, lvl) {
    const extra = this.stats.summonExtra || 0;
    const want = minionCount(sk, lvl, extra);
    const have = this.aliveMinions((m) => m.skillId === sk.id && !m.special);
    // Bộ SSR Vua Muôn Thú: +1 con mỗi loại, giới hạn tổng nâng thêm 2.
    const cap = this.minionCfg().maxTotal + (extra ? 2 : 0);
    let n = Math.min(want - have, cap - this.aliveMinions());
    if (n <= 0) return false;
    const p = this.player;
    while (n-- > 0) {
      const a = this.rng.next() * TAU;
      const pt = this.pushOutObstacles(clamp(p.x + Math.cos(a) * 40, 20, this.W - 20), clamp(p.y + Math.sin(a) * 40, 20, this.H - 20), sk.minion.radius);
      this.spawnMinion(sk, lvl, pt.x, pt.y);
    }
    return true;
  },

  spawnMinion(sk, lvl, x, y) {
    const d = sk.minion;
    const hp = this.minionMaxHp(sk, lvl);
    const m = {
      id: this.nextMinionId = (this.nextMinionId || 0) + 1,
      kind: d.kind, skillId: sk.id, x, y, r: d.radius, hp, maxHp: hp,
      speed: d.speed, flying: !!d.flying, atkT: this.rng.next() * d.atkInterval, target: null, retarget: 0,
      faceX: 1, faceY: 0, t: this.rng.next() * 10, hit: 0, swing: 0, dead: false, moving: false,
      orbit: this.rng.next() * TAU,
    };
    this.minions.push(m);
    this.addFx({ kind: 'burst', x, y, dur: 0.35, r: d.radius * 2.2, color: sk.color });
    return m;
  },

  summonAtkMult() {
    let m = 1;
    for (const b of this.buffs) if (b.summonAtk) m += b.summonAtk;
    return m;
  },
  summonSpeedMult() {
    let m = 1;
    for (const b of this.buffs) if (b.summonSpeed) m += b.summonSpeed;
    return m;
  },

  // Đòn đánh của vật triệu hồi: dùng sát thương của kỹ năng gọi nó, chí mạng cộng thêm từ bị động.
  minionHit(m, e, sk, lvl, scale = 1) {
    let mult = this.skillMult(sk);
    if ((m.kind === 'wolf') && this.aliveMinions((o) => o.kind === 'alpha')) mult += this.data.skills.alpha_wolf.minion.packAura || 0;
    const pb = this.stats.specials?.packBlood;
    if (pb && this.packRageT > 0) mult += pb.rage;
    const dealt = this.damageEnemy(e, this.rollSkill(sk, lvl, mult) * scale * (m.dmgScale || 1), sk.element, { critBonus: this.stats.summonCrit || 0 });
    // Huyết Mạch Bầy Đàn: thú hút máu cho chính mình.
    if (pb && dealt > 0) m.hp = Math.min(m.maxHp, m.hp + dealt * pb.leech);
    // Nanh Độc: sói và sói đầu đàn gây độc cộng dồn.
    if ((m.kind === 'wolf' || m.kind === 'alpha') && !e.dead) {
      const vl = this.lvl('venom_fangs');
      if (vl > 0) {
        const vf = this.data.skills.venom_fangs;
        const po = e.poison || (e.poison = { stacks: 0, t: 0, tick: 0.5 });
        po.stacks = Math.min(vf.poison.maxStacks, po.stacks + 1);
        po.t = vf.poison.duration;
        po.dps = P.lv(vf.poison.dps, vl) * this.skillMult(vf);
        this.poisoned.add(e);
      }
    }
  },

  updateMinions(dt) {
    // Độc của Nanh Độc.
    if (this.poisoned.size) {
      for (const e of this.poisoned) {
        const po = e.poison;
        if (e.dead || !po) { this.poisoned.delete(e); continue; }
        po.t -= dt;
        po.tick -= dt;
        if (po.tick <= 0) {
          po.tick += 0.5;
          this.damageEnemy(e, po.dps * po.stacks * 0.5, 'physical', { noCrit: true, quiet: true });
        }
        if (po.t <= 0) { e.poison = null; this.poisoned.delete(e); }
      }
    }
    if (!this.minions.length) return;
    const p = this.player;
    const mc = this.minionCfg();
    const spdMult = this.summonSpeedMult();
    const atkMult = this.summonAtkMult();
    let idx = 0;
    const total = this.minions.length;
    // Cập nhật máu tối đa theo chỉ số hiện tại (cộng điểm giữa trận).
    this.minionHpT = (this.minionHpT || 0) - dt;
    const rescale = this.minionHpT <= 0;
    if (rescale) this.minionHpT = 1;
    for (const m of this.minions) {
      idx++;
      if (m.dead) continue;
      const sk = this.data.skills[m.skillId];
      const lvl = Math.max(1, this.lvl(m.skillId));
      const d = sk.minion;
      // Sói Linh Hồn (bộ SSR) tồn tại có hạn.
      if (m.ttl !== undefined) {
        m.ttl -= dt;
        if (m.ttl <= 0) { m.dead = true; this.addFx({ kind: 'death', x: m.x, y: m.y, dur: 0.5, r: m.r, color: '#9fd8ff' }); continue; }
      }
      if (rescale && !m.special) {
        const mx = this.minionMaxHp(sk, lvl);
        if (Math.abs(mx - m.maxHp) > 0.5) { m.hp = Math.max(1, m.hp * (mx / m.maxHp)); m.maxHp = mx; }
      }
      m.t += dt;
      m.hit = Math.max(0, m.hit - dt);
      m.swing = Math.max(0, m.swing - dt);
      m.atkT -= dt * atkMult;
      // Bị bỏ quá xa: dịch chuyển về cạnh người chơi.
      if (Math.hypot(m.x - p.x, m.y - p.y) > mc.leash) {
        const a = this.rng.next() * TAU;
        m.x = clamp(p.x + Math.cos(a) * 50, m.r, this.W - m.r);
        m.y = clamp(p.y + Math.sin(a) * 50, m.r, this.H - m.r);
        m.target = null;
      }
      // Chọn mục tiêu: quái gần thú nhất trong vùng quanh người chơi.
      m.retarget -= dt;
      if (m.target && (m.target.dead || m.target.flee || Math.hypot(m.target.x - p.x, m.target.y - p.y) > mc.aggro + 120)) m.target = null;
      if (!m.target || m.retarget <= 0) {
        m.retarget = mc.retargetEvery;
        const aggro = m.flying ? mc.aggro * 0.6 : mc.aggro;
        let best = null, bd = Infinity;
        for (const e of this.enemies) {
          if (e.dead || e.flee) continue;
          const pd = (e.x - p.x) ** 2 + (e.y - p.y) ** 2;
          if (pd > aggro * aggro) continue;
          const dd = (e.x - m.x) ** 2 + (e.y - m.y) ** 2 - (e.elite || e.big ? 3600 : 0);
          if (dd < bd) { bd = dd; best = e; }
        }
        m.target = best;
      }
      let tx, ty, stop;
      const t = m.target;
      if (t) {
        tx = t.x; ty = t.y; stop = t.r + m.r + d.range * 0.6;
      } else if (m.flying) {
        // Quạ bay vòng quanh người chơi.
        m.orbit += dt * 1.6;
        tx = p.x + Math.cos(m.orbit + idx) * 55; ty = p.y + Math.sin(m.orbit + idx) * 40 - 20; stop = 4;
      } else {
        // Đi theo người chơi, xếp vòng quanh.
        const a = (idx / total) * TAU + 0.6;
        tx = p.x + Math.cos(a) * (60 + m.r); ty = p.y + Math.sin(a) * (60 + m.r); stop = 12;
      }
      const dx = tx - m.x, dy = ty - m.y;
      const dist = Math.hypot(dx, dy) || 0.001;
      m.moving = dist > stop;
      if (m.moving) {
        const sp = Math.min(m.speed * spdMult * (t ? 1 : dist > 150 ? 1.4 : 1), (dist - stop) / dt);
        m.x += (dx / dist) * sp * dt;
        m.y += (dy / dist) * sp * dt;
        m.faceX = dx / dist; m.faceY = dy / dist;
      }
      // Tấn công.
      if (t && !t.dead && m.atkT <= 0 && dist <= t.r + m.r + d.range) {
        m.atkT = d.atkInterval;
        m.swing = 0.2;
        m.faceX = dx / dist; m.faceY = dy / dist;
        const cleave = m.cleave ?? d.cleave;
        if (d.aoe || cleave) {
          // Gấu vả vùng nhỏ trước mặt; sói đầu đàn cắn lan sang quái cạnh mục tiêu (60%).
          const r = d.aoe || cleave;
          const cx = d.aoe ? m.x + m.faceX * m.r : t.x, cy = d.aoe ? m.y + m.faceY * m.r : t.y;
          const list = [];
          this.grid.query(cx, cy, r + 45, (e) => {
            if (!e.flee && Math.hypot(e.x - cx, e.y - cy) < r + e.r) list.push(e);
          });
          for (const e of list) this.minionHit(m, e, sk, lvl, d.aoe || e === t ? 1 : 0.6);
          if (d.aoe) this.addFx({ kind: 'slash', x: m.x, y: m.y, a: Math.atan2(m.faceY, m.faceX), half: 1, r: r + m.r, dur: 0.18, color: sk.color });
        } else {
          this.minionHit(m, t, sk, lvl);
        }
      }
      // Tách nhau ra (thú mặt đất).
      if (!m.flying) {
        for (const o of this.minions) {
          if (o === m || o.dead || o.flying) continue;
          const ox = m.x - o.x, oy = m.y - o.y;
          const min = m.r + o.r;
          const d2 = ox * ox + oy * oy;
          if (d2 < min * min && d2 > 0.0001) {
            const dd = Math.sqrt(d2);
            m.x += (ox / dd) * (min - dd) * 0.5;
            m.y += (oy / dd) * (min - dd) * 0.5;
          }
        }
        const o = this.pushOutObstacles(m.x, m.y, m.r);
        m.x = o.x; m.y = o.y;
      }
      m.x = clamp(m.x, m.r, this.W - m.r);
      m.y = clamp(m.y, m.r, this.H - m.r);
    }
    if (this.minions.some((m) => m.dead)) this.minions = this.minions.filter((m) => !m.dead);
  },

  // Quái đánh trúng vật triệu hồi: trừ giáp/kháng, phản gai, có thể sống lại (Thú Bất Tử).
  hurtMinion(m, amount, type, e) {
    if (m.dead) return;
    let dmg = amount;
    if (type === 'physical') {
      const a = (this.data.skills[m.skillId].minion.armor || 0) + (this.stats.summonArmor || 0);
      const red = Math.min(this.cfg.caps.armorReduction, a / (a + this.cfg.armor.base + this.cfg.armor.perMonsterLevel * this.map.level));
      dmg *= 1 - red;
    } else {
      dmg *= 1 - Math.min(this.cfg.caps.playerResist, Math.max(-1, (this.stats.summonResist || 0) - (this.diff.playerResistPenalty || 0)));
    }
    m.hp -= dmg;
    m.hit = 0.15;
    this.log.minionDamageTaken = (this.log.minionDamageTaken || 0) + dmg;
    const tl = this.lvl('thorn_hide');
    if (tl > 0 && e && !e.dead) {
      this.damageEnemy(e, amount * P.lv(this.data.skills.thorn_hide.thorns, tl) * this.skillMult({ summon: true, element: 'physical' }), 'physical', { noCrit: true, quiet: true });
    }
    if (m.hp <= 0) {
      const ul = this.lvl('undying');
      if (ul > 0 && this.rng.next() < P.lv(this.data.skills.undying.reviveChance, ul)) {
        m.hp = m.maxHp * 0.5;
        this.addFx({ kind: 'nova', x: m.x, y: m.y, dur: 0.4, r: m.r * 2.5, color: '#e0e0a0' });
        return;
      }
      m.dead = true;
      this.log.minionDeaths = (this.log.minionDeaths || 0) + 1;
      const pb = this.stats.specials?.packBlood;
      if (pb) this.packRageT = pb.rageDur;
      this.addFx({ kind: 'death', x: m.x, y: m.y, dur: 0.3, r: m.r, color: this.data.skills[m.skillId].color });
    }
  },

  // Mục tiêu của quái: người chơi hoặc vật triệu hồi (mặt đất) gần nhất; gấu khiêu khích quái trong tầm.
  enemyTarget(e) {
    const p = this.player;
    if (!this.minions.length || e.ai === 'boss' || e.ai === 'ranged') return p;
    let best = p, bd = (p.x - e.x) ** 2 + (p.y - e.y) ** 2;
    let taunt = null, td = Infinity;
    for (const m of this.minions) {
      if (m.dead || m.flying) continue;
      const d = (m.x - e.x) ** 2 + (m.y - e.y) ** 2;
      if (d < bd) { bd = d; best = m; }
      const tr = m.taunt ?? this.data.skills[m.skillId].minion.taunt;
      if (tr && d < tr * tr && d < td) { td = d; taunt = m; }
    }
    return taunt || best;
  },

  // ---------- Kỹ năng điều khiển bầy ----------
  // Cuồng Bạo Bầy Sói: mọi sói lao vào cụm quái đông nhất, mỗi con gây sát thương vùng.
  castRally(sk, lvl) {
    const wolves = this.minions.filter((m) => !m.dead && (m.kind === 'wolf' || m.kind === 'alpha'));
    if (!wolves.length) return false;
    const t = this.densestPoint(sk.searchRange, sk.radius);
    if (!t || !Number.isFinite(t.x)) return false;
    const mult = this.skillMult(sk);
    this.grid.rebuild(this.enemies);
    wolves.forEach((m, i) => {
      const a = (i / wolves.length) * TAU;
      const x = clamp(t.x + Math.cos(a) * 25, m.r, this.W - m.r), y = clamp(t.y + Math.sin(a) * 25, m.r, this.H - m.r);
      this.addFx({ kind: 'leap', x1: m.x, y1: m.y, x, y, dur: 0.25 });
      m.x = x; m.y = y;
      this.areaDamage(x, y, sk.radius, () => this.rollSkill(sk, lvl, mult), sk.element, { critBonus: this.stats.summonCrit || 0 });
    });
    this.addFx({ kind: 'burst', x: t.x, y: t.y, dur: 0.35, r: sk.radius + 25, color: sk.color });
    return true;
  },

  // Đập Đất: gấu đập xuống đất, sát thương + choáng quanh gấu.
  castMinionNova(sk, lvl) {
    const bear = this.minions.find((m) => !m.dead && m.kind === sk.minionKind && this.nearestEnemy(sk.radius * 0.8, m));
    if (!bear) return false;
    const mult = this.skillMult(sk);
    this.areaDamage(bear.x, bear.y, sk.radius, () => this.rollSkill(sk, lvl, mult), sk.element, { slow: sk.slow, critBonus: this.stats.summonCrit || 0 });
    bear.swing = 0.3;
    this.addFx({ kind: 'nova', x: bear.x, y: bear.y, dur: 0.4, r: sk.radius, color: sk.color });
    this.emit({ type: 'shake', amount: 3 });
    return true;
  },

  // Hồi Sinh Hoang Dã: chỉ dùng khi có thú hoặc người chơi bị thương.
  castHeal(sk, lvl) {
    const p = this.player;
    const hurt = this.minions.some((m) => !m.dead && m.hp < m.maxHp * 0.75) || p.hp < this.stats.maxHp * 0.6;
    if (!hurt) return false;
    const hp = P.lv(sk.healPct, lvl);
    for (const m of this.minions) {
      if (m.dead) continue;
      m.hp = Math.min(m.maxHp, m.hp + m.maxHp * hp);
      this.addFx({ kind: 'nova', x: m.x, y: m.y, dur: 0.35, r: m.r * 2, color: sk.color });
    }
    p.hp = Math.min(this.stats.maxHp, p.hp + this.stats.maxHp * P.lv(sk.playerHealPct, lvl));
    this.addFx({ kind: 'nova', x: p.x, y: p.y, dur: 0.45, r: 60, color: sk.color });
    return true;
  },

  // Bầy Ong: đám ong bay theo cụm quái, gây sát thương liên tục.
  castSwarm(sk, lvl) {
    const t = this.densestPoint(sk.searchRange, sk.radius);
    if (!t || !Number.isFinite(t.x)) return false;
    const p = this.player;
    const dps = P.lv(sk.dps, lvl) + P.flatFor(sk, this.stats);
    this.zones.push({ kind: 'swarm', x: p.x, y: p.y, tx: t.x, ty: t.y, r: sk.radius, t: 0, dur: sk.duration, tickT: sk.tick, tick: sk.tick, dps, skill: sk, element: sk.element, speed: sk.speed });
    return true;
  },

  // Đại Bàng: bổ nhào vào tinh anh / trùm hoặc quái nhiều máu nhất trong tầm.
  castDive(sk, lvl) {
    const p = this.player;
    let best = null, bs = -1;
    for (const e of this.enemies) {
      if (e.dead || e.flee) continue;
      if ((e.x - p.x) ** 2 + (e.y - p.y) ** 2 > sk.range * sk.range) continue;
      const s = e.hp + (e.elite || e.big ? 1e6 : 0);
      if (s > bs) { bs = s; best = e; }
    }
    if (!best) return false;
    this.pending.push({ kind: 'dive', t: sk.delay, dur: sk.delay, x: best.x, y: best.y, r: sk.radius, target: best, skill: sk, lvl, sx: p.x, sy: p.y - 120 });
    return true;
  },

  resolveDive(pd) {
    const sk = pd.skill;
    const x = pd.target && !pd.target.dead ? pd.target.x : pd.x;
    const y = pd.target && !pd.target.dead ? pd.target.y : pd.y;
    const mult = this.skillMult(sk);
    this.areaDamage(x, y, sk.radius, () => this.rollSkill(sk, pd.lvl, mult), sk.element, { critBonus: this.stats.summonCrit || 0 });
    this.addFx({ kind: 'leap', x1: pd.sx, y1: pd.sy, x, y, dur: 0.2 });
    this.addFx({ kind: 'burst', x, y, dur: 0.3, r: sk.radius + 10, color: sk.color });
  },

  updateSwarmZone(z, dt) {
    // Bay về phía quái gần nhất quanh đám ong (tìm lại mỗi 0,5 giây).
    z.seek = (z.seek || 0) - dt;
    if (z.seek <= 0) {
      z.seek = 0.5;
      const e = this.nearestEnemy(260, z);
      if (e) { z.tx = e.x; z.ty = e.y; }
    }
    const dx = z.tx - z.x, dy = z.ty - z.y;
    const d = Math.hypot(dx, dy);
    if (d > 5) {
      const s = Math.min(z.speed * dt, d);
      z.x += (dx / d) * s; z.y += (dy / d) * s;
    }
    z.tickT -= dt;
    if (z.tickT <= 0) {
      z.tickT += z.tick;
      const mult = this.skillMult(z.skill);
      this.areaDamage(z.x, z.y, z.r, () => z.dps * z.tick * mult, z.element, { critBonus: this.stats.summonCrit || 0 });
    }
  },

  // Bộ SSR Vua Muôn Thú (5 món): Sói Linh Hồn khổng lồ, có hạn, khiêu khích, cắn lan rộng.
  spawnSpiritWolf(sp) {
    const sk = this.data.skills.alpha_wolf;
    const lvl = Math.max(1, this.lvl('alpha_wolf'));
    const p = this.player;
    const m = this.spawnMinion(sk, lvl, clamp(p.x + 40, 20, this.W - 20), clamp(p.y, 20, this.H - 20));
    m.kind = 'spirit';
    m.special = true;
    m.r = sk.minion.radius * 1.6;
    m.maxHp = m.hp = this.minionMaxHp(sk, lvl) * sp.hpMult;
    m.dmgScale = sp.dmgMult;
    m.taunt = sp.taunt;
    m.cleave = sp.cleave;
    m.ttl = sp.duration;
    this.addFx({ kind: 'nova', x: m.x, y: m.y, dur: 0.6, r: 90, color: '#9fd8ff' });
    this.showBanner('Sói Linh Hồn xuất hiện!', 1.5);
    return m;
  },

  // Linh Hồn Thú: hồi mana và kháng theo số thú đang sống (tối đa 10).
  spiritLinkCount() {
    if (this.lvl('spirit_link') <= 0) return 0;
    return Math.min(10, this.aliveMinions());
  },
};
