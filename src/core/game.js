// Lõi mô phỏng một lượt chơi. Không đụng tới DOM/canvas: dùng được cho trình duyệt lẫn bot trong Node.
import { RNG } from './rng.js';
import { Grid } from './grid.js';
import * as P from './progression.js';
import { generateItem, addToInventory, firstFree } from './items.js';

const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

function buildObstacles(map, W, H) {
  const cfg = map.obstacles;
  const rng = new RNG(cfg.seed);
  const list = [];
  const cx = W / 2, cy = H / 2;
  for (const t of cfg.types) {
    let placed = 0, tries = 0;
    while (placed < t.count && tries < t.count * 50) {
      tries++;
      const r = rng.range(t.r[0], t.r[1]);
      const x = rng.range(r + 40, W - r - 40);
      const y = rng.range(r + 40, H - r - 40);
      if (Math.hypot(x - cx, y - cy) < cfg.clearRadius + r) continue;
      let ok = true;
      for (const o of list) {
        if (Math.hypot(o.x - x, o.y - y) < o.r + r + cfg.minGap) { ok = false; break; }
      }
      if (!ok) continue;
      list.push({ x, y, r, kind: t.kind, seed: rng.next() });
      placed++;
    }
  }
  return list;
}

function buildObstacleGrid(obs, W, H, cell) {
  const cols = Math.ceil(W / cell) + 1, rows = Math.ceil(H / cell) + 1;
  const cells = Array.from({ length: cols * rows }, () => []);
  const pad = 50;
  obs.forEach((o) => {
    const x0 = Math.max(0, ((o.x - o.r - pad) / cell) | 0), x1 = Math.min(cols - 1, ((o.x + o.r + pad) / cell) | 0);
    const y0 = Math.max(0, ((o.y - o.r - pad) / cell) | 0), y1 = Math.min(rows - 1, ((o.y + o.r + pad) / cell) | 0);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) cells[y * cols + x].push(o);
  });
  return { cell, cols, rows, cells };
}

export class Game {
  constructor(data, ch, opts = {}) {
    this.data = data;
    this.cfg = data.config;
    this.ch = ch;
    this.map = data.maps[opts.mapId || '1-1'];
    this.seed = opts.seed ?? ((Math.random() * 0xffffffff) >>> 0);
    this.rng = new RNG(this.seed);
    this.headless = !!opts.headless;
    this.viewW = opts.viewW || 1280;
    this.viewH = opts.viewH || 720;
    this.W = this.map.size[0];
    this.H = this.map.size[1];
    this.duration = this.cfg.run.duration;
    this.time = 0;
    this.kills = 0;

    this.obstacles = buildObstacles(this.map, this.W, this.H);
    this.obGrid = buildObstacleGrid(this.obstacles, this.W, this.H, 128);

    const pc = this.cfg.player;
    this.player = { x: this.W / 2, y: this.H / 2, r: pc.radius, hp: 0, mana: 0, invuln: 0, faceX: 1, faceY: 0, glow: 0, hurt: 0, moving: false };
    this.stats = P.computeStats(ch, data);
    this.player.hp = this.stats.maxHp;
    this.player.mana = this.stats.maxMana;
    this.statBase = null;

    this.enemies = [];
    this.projectiles = [];
    this.orbs = [];
    this.shots = [];
    this.zones = [];
    this.pending = [];
    this.pickups = [];
    this.fx = [];
    this.texts = [];
    this.grid = new Grid(this.W, this.H, 64);
    this.skillState = {};
    for (const s of data.skillList) this.skillState[s.id] = { cd: s.interval || 0, tick: 0, active: false, noMana: false };

    this.events = [...this.map.events].sort((a, b) => a.t - b.t);
    this.eventIdx = 0;
    this.out = [];
    this.spawnTimer = 0;
    this.nextId = 1;
    this.aliveNormal = 0;
    this.boss = null;
    this.bossSpawned = false;
    this.miniboss = null;
    this.retreating = false;
    this.enraged = false;
    this.banner = null;
    this.over = false;
    this.result = null;

    this.god = false;
    this.showDamage = true;
    this.input = { x: 0, y: 0 };

    // Đo DPS: các ô 0,25 giây trong 5 giây gần nhất.
    this.dpsBuckets = new Float64Array(20);
    this.dpsIdx = 0;
    this.dpsT = 0;
    this.totalDamage = 0;
    this.effDamage = 0; // sát thương thực (không tính phần thừa khi quái đã hết máu)
    this.dmgByElement = {};

    this.log = {
      seed: this.seed,
      startLevel: ch.level,
      attrs: {},
      skills: {},
      panelOpens: 0,
      panelMs: 0,
      levelUps: [],
      damageTaken: {},
      cause: null,
      potions: { hp: 0, mana: 0 },
      minHpPct: 1,
      outOfManaSec: 0,
      freezes: 0,
      itemsDropped: 0,
      itemsPicked: [],
      gold: 0,
    };
    this.invFullT = 0;
  }

  // ---------- Tiện ích ----------
  emit(ev) { this.out.push(ev); }
  showBanner(text, dur = 3.5) { this.banner = { text, t: 0, dur }; this.emit({ type: 'banner', text }); }
  phase() {
    const t = this.time;
    for (const ph of this.map.phases) if (t >= ph.from && t < ph.to) return ph;
    return null;
  }
  addText(x, y, text, color, size = 14) {
    if (this.headless || !this.showDamage) return;
    if (this.texts.length > 70) this.texts.shift();
    this.texts.push({ x: x + (this.rng.next() - 0.5) * 14, y, text, color, size, t: 0 });
  }
  addFx(fx) {
    if (this.headless) return;
    if (this.fx.length > 200) this.fx.shift();
    fx.t = 0;
    this.fx.push(fx);
  }
  dps() {
    let s = 0;
    for (let i = 0; i < this.dpsBuckets.length; i++) s += this.dpsBuckets[i];
    return s / 5;
  }

  // ---------- Vòng cập nhật ----------
  update(dt) {
    if (this.over) return;
    this.time += dt;
    this.processEvents();
    this.updateSpawner(dt);
    this.updatePlayer(dt);
    this.grid.rebuild(this.enemies);
    this.updateSkills(dt);
    this.updateOrbs(dt);
    this.updateProjectiles(dt);
    this.updatePending(dt);
    this.updateZones(dt);
    this.updateEnemies(dt);
    this.updateShots(dt);
    this.updatePickups(dt);
    this.updateVisuals(dt);
    this.cleanup();

    this.dpsT += dt;
    while (this.dpsT >= 0.25) {
      this.dpsT -= 0.25;
      this.dpsIdx = (this.dpsIdx + 1) % this.dpsBuckets.length;
      this.dpsBuckets[this.dpsIdx] = 0;
    }
  }

  cleanup() {
    if (this.enemies.some((e) => e.dead)) this.enemies = this.enemies.filter((e) => !e.dead);
    if (this.projectiles.some((p) => p.dead)) this.projectiles = this.projectiles.filter((p) => !p.dead);
    if (this.shots.some((p) => p.dead)) this.shots = this.shots.filter((p) => !p.dead);
    if (this.pickups.some((p) => p.dead)) this.pickups = this.pickups.filter((p) => !p.dead);
    let n = 0;
    for (const e of this.enemies) if (!e.big) n++;
    this.aliveNormal = n;
  }

  // ---------- Sự kiện & sinh quái ----------
  processEvents() {
    while (this.eventIdx < this.events.length && this.events[this.eventIdx].t <= this.time) {
      this.handleEvent(this.events[this.eventIdx++]);
    }
  }

  handleEvent(ev) {
    switch (ev.type) {
      case 'spawnGroup':
        for (let i = 0; i < ev.count; i++) {
          const pt = this.spawnPoint(ev.distance || 'range');
          this.spawnEnemy(ev.monster, pt.x, pt.y);
        }
        break;
      case 'banner':
        this.showBanner(ev.text, 2.5);
        break;
      case 'elite': {
        const ph = this.phase();
        const types = this.data.monsters.elite.baseTypes.filter((t) => ph && ph.weights[t] > 0);
        const base = types.length ? this.rng.pick(types) : 'zombie';
        const pt = this.spawnPoint('range');
        const e = this.spawnEnemy(base, pt.x, pt.y);
        this.makeElite(e);
        this.showBanner(`Tinh anh xuất hiện: ${e.name}`, 2.5);
        break;
      }
      case 'miniboss': {
        const pt = this.spawnPoint('edge');
        const e = this.spawnEnemy(ev.monster, pt.x, pt.y);
        this.miniboss = e;
        this.showBanner(`Trùm nhỏ: ${e.name}!`);
        break;
      }
      case 'retreat':
        this.retreating = true;
        for (const e of this.enemies) if (e !== this.boss) this.startFlee(e);
        this.showBanner(ev.text, 4);
        this.emit({ type: 'bossWarning' });
        break;
      case 'boss':
        this.spawnBoss(ev.monster);
        break;
      case 'enrage':
        if (this.boss && !this.boss.dead) {
          this.enraged = true;
          this.showBanner(ev.text, 3);
        }
        break;
    }
  }

  spawnBoss(id) {
    if (this.bossSpawned) return;
    this.bossSpawned = true;
    this.retreating = false;
    const p = this.player;
    const ang = this.rng.next() * TAU;
    let x = clamp(p.x + Math.cos(ang) * 420, 80, this.W - 80);
    let y = clamp(p.y + Math.sin(ang) * 420, 80, this.H - 80);
    const e = this.spawnEnemy(id, x, y);
    this.boss = e;
    this.showBanner(`${e.name} xuất hiện!`, 3);
    this.emit({ type: 'boss' });
  }

  updateSpawner(dt) {
    const ph = this.phase();
    if (!ph || ph.perTick <= 0 || this.retreating) return;
    this.spawnTimer -= dt;
    while (this.spawnTimer <= 0) {
      this.spawnTimer += this.map.spawnInterval;
      // "perTick con mỗi spawnInterval giây": một đàn dơi trừ đúng số con vào ngân sách (có thể nợ sang lượt sau).
      this.spawnCredit = Math.min((this.spawnCredit || 0) + ph.perTick, ph.perTick);
      while (this.spawnCredit > 0) {
        const room = ph.maxAlive - this.aliveNormal;
        if (room <= 0) break;
        let type = this.rng.weighted(ph.weights);
        if (!type) break;
        const pt = this.spawnPoint(ph.distance);
        if (type === 'bat') {
          if (room < 6) type = 'zombie';
          else { this.spawnCredit -= this.spawnFlock(pt.x, pt.y, room); continue; }
        }
        this.spawnEnemy(type, pt.x, pt.y);
        this.spawnCredit -= 1;
      }
    }
  }

  spawnFlock(x, y, room = 99) {
    const def = this.data.monsters.bat;
    const n = Math.min(room, this.rng.int(def.flock[0], def.flock[1]));
    const phase = this.rng.next() * TAU;
    for (let i = 0; i < n; i++) {
      const e = this.spawnEnemy('bat', x + this.rng.range(-40, 40), y + this.rng.range(-40, 40));
      e.phase = phase + this.rng.range(-0.3, 0.3);
    }
    return n;
  }

  // Điểm sinh quái ngoài màn hình. 'edge' = ngay ngoài mép, 'range' = spawnRange px nhưng luôn ngoài màn hình.
  spawnPoint(mode) {
    const p = this.player;
    const hw = this.viewW / 2, hh = this.viewH / 2;
    let x = p.x, y = p.y;
    for (let tries = 0; tries < 10; tries++) {
      const a = this.rng.next() * TAU;
      const c = Math.cos(a), s = Math.sin(a);
      const edge = Math.min(Math.abs(c) > 1e-6 ? hw / Math.abs(c) : 1e9, Math.abs(s) > 1e-6 ? hh / Math.abs(s) : 1e9);
      let d;
      if (mode === 'edge') d = edge + 30 + this.rng.next() * 40;
      else d = Math.max(this.rng.range(this.map.spawnRange[0], this.map.spawnRange[1]), edge + 30);
      x = p.x + c * d;
      y = p.y + s * d;
      if (x > 30 && y > 30 && x < this.W - 30 && y < this.H - 30) break;
    }
    x = clamp(x, 30, this.W - 30);
    y = clamp(y, 30, this.H - 30);
    const o = this.pushOutObstacles(x, y, 14);
    return o;
  }

  spawnEnemy(typeId, x, y) {
    const def = this.data.monsters[typeId];
    const lvl = this.map.level;
    const sc = this.cfg.monsterScaling;
    const hp = def.hp * (1 + sc.hpPerLevel * (lvl - 1));
    const dmgMult = 1 + sc.dmgPerLevel * (lvl - 1);
    const e = {
      id: this.nextId++, type: typeId, def, name: def.name, ai: def.ai,
      x, y, r: def.radius, hp, maxHp: hp,
      dmg: def.damage * dmgMult, dmgMult,
      contact: (def.contactDamage ?? def.damage) * dmgMult,
      dmgType: def.damageType || 'physical',
      speed: def.speed, xp: def.xp, color: def.color,
      resist: def.resist || {}, level: lvl,
      kx: 0, ky: 0, slowT: 0, slowPct: 0, hit: 0,
      t: this.rng.next() * 10, phase: this.rng.next() * TAU,
      atkT: def.attackInterval ? this.rng.range(0.5, def.attackInterval) : 0,
      strafe: this.rng.next() < 0.5 ? 1 : -1,
      elite: false, affixes: [], flying: !!def.flying,
      big: def.ai === 'boss' || def.ai === 'miniboss',
      flee: false, fleeT: 0, dead: false,
    };
    if (def.ai === 'miniboss') e.summonT = def.summonInterval;
    if (def.ai === 'boss') e.b = { state: 'chase', atkT: def.attackInterval, next: 'slam', t: 0, phase2: false, batT: def.phase2.batInterval };
    this.enemies.push(e);
    if (!e.big) this.aliveNormal++;
    return e;
  }

  makeElite(e) {
    const el = this.data.monsters.elite;
    e.elite = true;
    e.hp *= el.hpMult;
    e.maxHp = e.hp;
    e.dmg *= el.dmgMult;
    e.contact *= el.dmgMult;
    e.xp = el.xp;
    e.r *= el.radiusMult;
    const key = this.rng.pick(Object.keys(el.affixes));
    const af = el.affixes[key];
    e.affixes.push(key);
    if (af.speedMult) e.speed *= af.speedMult;
    e.name = `${e.def.name} · ${af.name}`;
  }

  startFlee(e) {
    e.flee = true;
    e.fleeT = 0;
  }

  // ---------- Người chơi ----------
  updatePlayer(dt) {
    const p = this.player;
    let ix = this.input.x, iy = this.input.y;
    const len = Math.hypot(ix, iy);
    if (len > 1) { ix /= len; iy /= len; }
    p.moving = len > 0.05;
    if (p.moving) { p.faceX = ix; p.faceY = iy; }
    p.x += ix * this.stats.moveSpeed * dt;
    p.y += iy * this.stats.moveSpeed * dt;
    const o = this.pushOutObstacles(p.x, p.y, p.r);
    p.x = clamp(o.x, p.r, this.W - p.r);
    p.y = clamp(o.y, p.r, this.H - p.r);
    p.invuln = Math.max(0, p.invuln - dt);
    p.glow = Math.max(0, p.glow - dt);
    p.hurt = Math.max(0, p.hurt - dt);
    p.mana = Math.min(this.stats.maxMana, p.mana + this.stats.manaRegen * dt);
    p.hp = Math.min(this.stats.maxHp, p.hp + this.stats.hpRegen * dt);
    this.log.minHpPct = Math.min(this.log.minHpPct, p.hp / this.stats.maxHp);
  }

  pushOutObstacles(x, y, r) {
    const g = this.obGrid;
    const cx = clamp((x / g.cell) | 0, 0, g.cols - 1), cy = clamp((y / g.cell) | 0, 0, g.rows - 1);
    for (const o of g.cells[cy * g.cols + cx]) {
      const dx = x - o.x, dy = y - o.y;
      const min = o.r + r;
      const d2 = dx * dx + dy * dy;
      if (d2 < min * min) {
        const d = Math.sqrt(d2) || 0.001;
        x = o.x + (dx / d) * min;
        y = o.y + (dy / d) * min;
      }
    }
    return { x, y };
  }

  hurtPlayer(amount, type, source, opts = {}) {
    const p = this.player;
    if (this.over || this.god) return false;
    if (!opts.dot) {
      if (p.invuln > 0) return false;
      if (this.rng.next() < this.stats.dodge) {
        this.addText(p.x, p.y - 22, 'Né', '#9fd3ff', 13);
        return false;
      }
    }
    let dmg = amount;
    if (type === 'physical') {
      const lvl = opts.level || this.map.level;
      const a = this.stats.armor;
      const red = Math.min(this.cfg.caps.armorReduction, a / (a + this.cfg.armor.base + this.cfg.armor.perMonsterLevel * lvl));
      dmg *= 1 - red;
    } else {
      dmg *= 1 - Math.min(this.cfg.caps.playerResist, this.stats.resist[type] || 0);
      if (dmg < 0) dmg = 0;
    }
    p.hp -= dmg;
    this.log.damageTaken[source] = (this.log.damageTaken[source] || 0) + dmg;
    if (!opts.dot) {
      p.invuln = this.cfg.player.invulnAfterHit;
      p.hurt = 0.2;
    }
    this.addText(p.x, p.y - 22, `-${Math.round(dmg)}`, '#ff5a5a', 15);
    if (p.hp <= 0) {
      p.hp = 0;
      this.die(source);
    }
    return true;
  }

  die(cause) {
    if (this.over) return;
    this.over = true;
    this.log.cause = cause;
    this.ch.deaths++;
    this.ch.mapDeaths[this.map.id] = (this.ch.mapDeaths[this.map.id] || 0) + 1;
    this.result = { win: false, cause, time: this.time };
    this.emit({ type: 'death', cause });
  }

  win() {
    if (this.over) return;
    // Hút hết ngọc kinh nghiệm còn trên màn hình.
    const p = this.player;
    for (const k of this.pickups) {
      if (!k.dead && k.kind === 'xp' && Math.hypot(k.x - p.x, k.y - p.y) < 700) { this.addXp(k.value); k.dead = true; }
    }
    this.over = true;
    this.ch.clears++;
    const flawless = !(this.ch.mapDeaths[this.map.id] > 0);
    this.result = { win: true, time: this.time, flawless };
    this.emit({ type: 'victory', flawless });
  }

  addXp(n) {
    const ch = this.ch;
    const cfg = this.cfg;
    ch.xp += n;
    while (ch.level < cfg.xp.maxLevel && ch.xp >= P.xpToNext(ch.level, cfg)) {
      ch.xp -= P.xpToNext(ch.level, cfg);
      ch.level++;
      ch.attrPoints += cfg.player.attrPointsPerLevel;
      ch.skillPoints += cfg.player.skillPointsPerLevel;
      this.onLevelUp();
    }
  }

  onLevelUp() {
    const p = this.player;
    this.stats = P.computeStats(this.ch, this.data);
    p.hp = this.stats.maxHp;
    p.mana = this.stats.maxMana;
    p.glow = 1.2;
    const lu = this.cfg.player.levelUp;
    for (const e of this.enemies) {
      if (e.dead || e.big) continue;
      const dx = e.x - p.x, dy = e.y - p.y;
      const d = Math.hypot(dx, dy);
      if (d < lu.knockbackRadius) {
        const f = lu.knockbackForce * (1 - d / lu.knockbackRadius * 0.5);
        e.kx += (dx / (d || 1)) * f;
        e.ky += (dy / (d || 1)) * f;
      }
    }
    this.addFx({ kind: 'levelup', x: p.x, y: p.y, dur: 0.8, r: lu.knockbackRadius });
    this.log.levelUps.push({ level: this.ch.level, t: Math.round(this.time) });
    this.emit({ type: 'levelup', level: this.ch.level });
  }

  // Gọi khi mở bảng cộng điểm: các thay đổi chỉ số trong bảng tính tương đối với lúc mở (chống hồi máu bằng hoàn tác).
  beginEdit() {
    const p = this.player;
    this.statBase = { hp: p.hp, mana: p.mana, maxHp: this.stats.maxHp, maxMana: this.stats.maxMana };
  }
  endEdit() { this.statBase = null; }

  refreshStats() {
    const p = this.player;
    const old = this.stats;
    const ns = P.computeStats(this.ch, this.data);
    if (this.statBase) {
      const b = this.statBase;
      p.hp = Math.min(b.hp + Math.max(0, ns.maxHp - b.maxHp), ns.maxHp);
      p.mana = Math.min(b.mana + Math.max(0, ns.maxMana - b.maxMana), ns.maxMana);
    } else {
      p.hp = Math.min(p.hp + Math.max(0, ns.maxHp - old.maxHp), ns.maxHp);
      p.mana = Math.min(p.mana + Math.max(0, ns.maxMana - old.maxMana), ns.maxMana);
    }
    this.stats = ns;
  }

  // Phím tắt 1–4: cộng 1 điểm mà không mở bảng.
  quickAdd(attr) {
    if (P.addAttr(this.ch, attr, 1)) {
      this.log.attrs[attr] = (this.log.attrs[attr] || 0) + 1;
      this.refreshStats();
      return true;
    }
    return false;
  }

  recordAllocation(diff) {
    for (const [k, v] of Object.entries(diff.attrs)) this.log.attrs[k] = (this.log.attrs[k] || 0) + v;
    for (const [k, v] of Object.entries(diff.skills)) this.log.skills[k] = (this.log.skills[k] || 0) + v;
  }

  // ---------- Kỹ năng ----------
  lvl(id) {
    return P.skillLevel(this.ch, id, this.data, this.stats);
  }

  skillMult(skill) {
    return P.damageMult(this.ch, skill, this.stats, this.data);
  }

  rollSkill(skill, lvl, mult) {
    const [a, b] = P.damageRange(skill, lvl);
    return this.rng.range(a, b) * mult;
  }

  updateSkills(dt) {
    const ch = this.ch;
    let anyNoMana = false;
    for (const id of ch.slots) {
      if (!id) continue;
      const lvl = this.lvl(id);
      if (lvl <= 0) continue;
      const sk = this.data.skills[id];
      const st = this.skillState[id];
      if (sk.kind === 'aura') {
        this.updateAura(sk, st, lvl, dt);
        if (st.noMana) anyNoMana = true;
        continue;
      }
      st.cd = Math.max(0, st.cd - dt);
      if (st.cd > 0) continue;
      if (this.player.mana < sk.mana) { st.noMana = true; anyNoMana = true; continue; }
      st.noMana = false;
      const cast = this.castSkill(sk, lvl);
      if (cast) {
        this.player.mana -= sk.mana;
        st.cd = sk.cooldown / this.stats.cdSpeed;
        st.cdMax = st.cd;
      }
    }
    if (anyNoMana) this.log.outOfManaSec += dt;
    // Bị động có đòn đánh riêng (Bão Sấm).
    const ts = this.data.skills.thunder_storm;
    const tl = this.lvl('thunder_storm');
    if (ts && tl > 0) {
      const st = this.skillState.thunder_storm;
      st.cd -= dt;
      if (st.cd <= 0) {
        st.cd += ts.interval;
        const t = this.randomEnemy(ts.range);
        if (t) {
          const mult = this.skillMult(ts);
          this.areaDamage(t.x, t.y, ts.radius, () => this.rollSkill(ts, tl, mult), ts.element);
          this.addFx({ kind: 'strike', x: t.x, y: t.y, dur: 0.3, color: ts.color });
        }
      }
    }
  }

  castSkill(sk, lvl) {
    switch (sk.kind) {
      case 'projectile': return this.castProjectile(sk, lvl);
      case 'meteor': return this.castMeteor(sk, lvl);
      case 'wall': return this.castWall(sk, lvl);
      case 'nova': return this.castNova(sk, lvl);
      case 'storm': return this.castStorm(sk, lvl);
      case 'orb': return this.castOrb(sk, lvl);
      case 'sparks': return this.castSparks(sk, lvl);
      case 'beam': return this.castBeam(sk, lvl);
      case 'chain': return this.castChain(sk, lvl);
      case 'static': return this.castStatic(sk, lvl);
    }
    return false;
  }

  updateAura(sk, st, lvl, dt) {
    st.tick -= dt;
    if (st.tick > 0) return;
    st.tick += sk.tickInterval;
    const cost = sk.manaPerSecond * sk.tickInterval;
    if (this.player.mana < cost) { st.active = false; st.noMana = true; return; }
    this.player.mana -= cost;
    st.active = true;
    st.noMana = false;
    const p = this.player;
    const r = P.lv(sk.radius, lvl);
    const mult = this.skillMult(sk);
    this.areaDamage(p.x, p.y, r, () => this.rollSkill(sk, lvl, mult), sk.element);
  }

  nearestEnemy(range, from = this.player) {
    let best = null, bd = range * range;
    for (const e of this.enemies) {
      if (e.dead || e.flee) continue;
      const dx = e.x - from.x, dy = e.y - from.y;
      const d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }

  randomEnemy(range) {
    const p = this.player;
    const list = [];
    for (const e of this.enemies) {
      if (e.dead || e.flee) continue;
      const dx = e.x - p.x, dy = e.y - p.y;
      if (dx * dx + dy * dy < range * range) list.push(e);
    }
    return list.length ? list[(this.rng.next() * list.length) | 0] : null;
  }

  // Tìm cụm quái đông nhất trong tầm: lấy mẫu tối đa 24 quái, đếm hàng xóm, trả về trọng tâm cụm.
  densestPoint(range, radius) {
    const p = this.player;
    const cands = [];
    for (const e of this.enemies) {
      if (e.dead || e.flee) continue;
      const dx = e.x - p.x, dy = e.y - p.y;
      if (dx * dx + dy * dy < range * range) cands.push(e);
    }
    if (!cands.length) return null;
    const sample = cands.length > 24 ? Array.from({ length: 24 }, () => cands[(this.rng.next() * cands.length) | 0]) : cands;
    let best = null;
    for (const c of sample) {
      let n = 0, sx = 0, sy = 0;
      this.grid.query(c.x, c.y, radius + 40, (e) => {
        if (e.flee) return;
        const dx = e.x - c.x, dy = e.y - c.y;
        if (dx * dx + dy * dy < radius * radius) {
          const w = e.big ? 5 : e.elite ? 3 : 1;
          n += w; sx += e.x * w; sy += e.y * w;
        }
      });
      if (!best || n > best.n) best = { n, x: sx / n, y: sy / n };
    }
    return best;
  }

  addProjectile(o) {
    this.projectiles.push({ hitIds: [], dead: false, pierce: 0, turn: 0, ...o });
  }

  castProjectile(sk, lvl) {
    const t = this.nearestEnemy(sk.range);
    if (!t) return false;
    const p = this.player;
    const n = 1 + (sk.extraProjectileAt || []).filter((l) => lvl >= l).length;
    const base = Math.atan2(t.y - p.y, t.x - p.x);
    const spread = ((sk.spreadDeg || 10) * Math.PI) / 180;
    const pierce = (sk.pierce || 0) + (sk.pierceFromLevel && lvl >= sk.pierceFromLevel ? sk.pierceBonus : 0);
    const mult = this.skillMult(sk);
    const dmg = P.damageRange(sk, lvl);
    for (let k = 0; k < n; k++) {
      const a = base + (k - (n - 1) / 2) * spread;
      this.addProjectile({
        x: p.x, y: p.y, vx: Math.cos(a) * sk.projectileSpeed, vy: Math.sin(a) * sk.projectileSpeed,
        r: sk.projectileRadius, life: sk.range / sk.projectileSpeed, pierce, dmg, mult,
        element: sk.element, slow: sk.slow, color: sk.color, look: sk.id,
      });
    }
    return true;
  }

  castMeteor(sk, lvl) {
    const t = this.densestPoint(sk.searchRange, sk.radius);
    if (!t) return false;
    this.pending.push({ kind: 'meteor', t: sk.delay, dur: sk.delay, x: t.x, y: t.y, r: sk.radius, skill: sk, lvl });
    return true;
  }

  castWall(sk, lvl) {
    const t = this.densestPoint(sk.searchRange, sk.clusterRadius);
    if (!t) return false;
    const p = this.player;
    let dx = t.x - p.x, dy = t.y - p.y;
    const d = Math.hypot(dx, dy) || 1;
    dx /= d; dy /= d;
    const place = clamp(d * 0.6, 60, sk.placeDistance);
    const cx = p.x + dx * place, cy = p.y + dy * place;
    const hx = -dy * sk.length / 2, hy = dx * sk.length / 2;
    this.zones.push({
      kind: 'firewall', x1: cx - hx, y1: cy - hy, x2: cx + hx, y2: cy + hy, cx, cy,
      half: sk.thickness / 2, t: 0, dur: sk.duration, tickT: 0, tick: sk.tickInterval,
      dps: P.lv(sk.dps, lvl), slow: sk.slowPct, skill: sk, lvl,
    });
    return true;
  }

  castNova(sk, lvl) {
    const p = this.player;
    if (!this.nearestEnemy(sk.radius + 20)) return false;
    const mult = this.skillMult(sk);
    this.areaDamage(p.x, p.y, sk.radius, () => this.rollSkill(sk, lvl, mult), sk.element, { slow: sk.slow });
    this.addFx({ kind: 'nova', x: p.x, y: p.y, dur: 0.35, r: sk.radius, color: sk.color });
    return true;
  }

  castStorm(sk, lvl) {
    const t = this.densestPoint(sk.searchRange, sk.radius);
    if (!t) return false;
    this.zones.push({
      kind: 'area', look: 'blizzard', x: t.x, y: t.y, r: sk.radius, t: 0, dur: sk.duration, tick: sk.tick, tickT: 0.05,
      dps: P.lv(sk.dps, lvl), skill: sk, element: sk.element, slow: sk.slow,
    });
    return true;
  }

  castOrb(sk, lvl) {
    const t = this.densestPoint(sk.range, 120) || this.nearestEnemy(sk.range);
    if (!t) return false;
    const p = this.player;
    const a = Math.atan2(t.y - p.y, t.x - p.x);
    this.orbs.push({
      x: p.x, y: p.y, vx: Math.cos(a) * sk.orbSpeed, vy: Math.sin(a) * sk.orbSpeed, life: sk.orbLife,
      emitT: 0, ang: a, skill: sk, lvl, mult: this.skillMult(sk), dmg: P.damageRange(sk, lvl),
    });
    return true;
  }

  updateOrbs(dt) {
    if (!this.orbs.length) return;
    for (const o of this.orbs) {
      o.x += o.vx * dt; o.y += o.vy * dt; o.life -= dt;
      o.emitT -= dt;
      const sk = o.skill;
      while (o.emitT <= 0) {
        o.emitT += sk.shardInterval;
        o.ang += sk.shardAngleStep;
        this.addProjectile({
          x: o.x, y: o.y, vx: Math.cos(o.ang) * sk.shardSpeed, vy: Math.sin(o.ang) * sk.shardSpeed,
          r: sk.shardRadius, life: sk.shardRange / sk.shardSpeed, dmg: o.dmg, mult: o.mult,
          element: sk.element, slow: sk.slow, color: sk.color, look: 'shard',
        });
      }
    }
    this.orbs = this.orbs.filter((o) => o.life > 0);
  }

  castSparks(sk, lvl) {
    const t = this.nearestEnemy(sk.range);
    if (!t) return false;
    const p = this.player;
    const base = Math.atan2(t.y - p.y, t.x - p.x);
    const mult = this.skillMult(sk);
    const dmg = P.damageRange(sk, lvl);
    for (let k = 0; k < sk.count; k++) {
      const a = base + this.rng.range(-sk.spread, sk.spread);
      this.addProjectile({
        x: p.x, y: p.y, vx: Math.cos(a) * sk.speed, vy: Math.sin(a) * sk.speed, r: sk.radius, life: sk.life,
        dmg, mult, element: sk.element, color: sk.color, look: 'spark', jitter: sk.jitter,
      });
    }
    return true;
  }

  castBeam(sk, lvl) {
    const t = this.nearestEnemy(sk.length);
    if (!t) return false;
    const p = this.player;
    let dx = t.x - p.x, dy = t.y - p.y;
    const d = Math.hypot(dx, dy) || 1;
    dx /= d; dy /= d;
    const x2 = p.x + dx * sk.length, y2 = p.y + dy * sk.length;
    const mult = this.skillMult(sk);
    const half = sk.width / 2;
    const hits = [];
    this.grid.query(p.x + dx * sk.length / 2, p.y + dy * sk.length / 2, sk.length / 2 + 50, (e) => {
      if (e.flee) return;
      if (segDist(e.x, e.y, p.x, p.y, x2, y2) < half + e.r) hits.push(e);
    });
    for (const e of hits) this.damageEnemy(e, this.rollSkill(sk, lvl, mult), sk.element);
    this.addFx({ kind: 'bolt', pts: [[p.x, p.y], [x2, y2]], dur: 0.2, color: sk.color, w: 3 });
    return true;
  }

  castChain(sk, lvl) {
    const first = this.nearestEnemy(sk.range);
    if (!first) return false;
    const p = this.player;
    const mult = this.skillMult(sk);
    const jumps = sk.jumps + Math.floor(lvl / sk.jumpEveryLevels);
    const hit = new Set();
    const pts = [[p.x, p.y]];
    let cur = first;
    for (let i = 0; i <= jumps && cur; i++) {
      hit.add(cur.id);
      pts.push([cur.x, cur.y]);
      this.damageEnemy(cur, this.rollSkill(sk, lvl, mult), sk.element);
      let next = null, bd = sk.jumpRange * sk.jumpRange;
      const from = cur;
      this.grid.query(from.x, from.y, sk.jumpRange, (e) => {
        if (hit.has(e.id) || e.flee) return;
        const dx = e.x - from.x, dy = e.y - from.y;
        const dd = dx * dx + dy * dy;
        if (dd < bd) { bd = dd; next = e; }
      });
      cur = next;
    }
    this.addFx({ kind: 'bolt', pts, dur: 0.25, color: sk.color, w: 2.5 });
    return true;
  }

  castStatic(sk, lvl) {
    const p = this.player;
    const r = P.lv(sk.radius, lvl);
    if (!this.nearestEnemy(r)) return false;
    this.grid.query(p.x, p.y, r + 45, (e) => {
      const dx = e.x - p.x, dy = e.y - p.y;
      const rr = r + e.r;
      if (dx * dx + dy * dy >= rr * rr || e.hp <= 0) return;
      const pct = e.ai === 'boss' ? sk.bossPct : sk.pct;
      this.damageEnemy(e, e.hp * pct, sk.element, { noCrit: true });
    });
    this.addFx({ kind: 'nova', x: p.x, y: p.y, dur: 0.3, r, color: sk.color });
    return true;
  }

  // ---------- Sát thương lên quái ----------
  damageEnemy(e, amount, element, opts = {}) {
    if (e.dead) return 0;
    const caps = this.cfg.caps;
    const res = clamp(e.resist[element] || 0, caps.monsterResistMin, caps.monsterResistMax);
    let dmg = amount * (1 - res);
    let crit = false;
    if (!opts.noCrit && this.rng.next() < this.stats.critChance) { dmg *= this.stats.critMult; crit = true; }
    if (e.affixes.includes('stone_skin')) {
      const af = this.data.monsters.elite.affixes.stone_skin;
      if (e.hp > e.maxHp * af.untilHpPct) dmg *= af.damageTakenMult;
    }
    if (e.frozenT > 0) {
      const sl = this.lvl('shatter');
      if (sl > 0) dmg *= 1 + P.lv(this.data.skills.shatter.frozenDmgBonus, sl);
    }
    const before = e.hp;
    e.hp -= dmg;
    e.hit = 0.08;
    this.dpsBuckets[this.dpsIdx] += dmg;
    this.totalDamage += dmg;
    this.effDamage += Math.max(0, Math.min(dmg, before));
    this.dmgByElement[element] = (this.dmgByElement[element] || 0) + Math.max(0, Math.min(dmg, before));
    if (opts.slow) this.applySlow(e, opts.slow.pct, opts.slow.duration);
    if (element === 'cold') this.chill(e);
    if (this.showDamage && !this.headless && (crit || dmg >= 6 || e.big || e.elite)) {
      this.addText(e.x, e.y - e.r - 4, Math.round(dmg).toString(), crit ? '#ffe14d' : element === 'cold' ? '#bfeaff' : '#ffffff', crit ? 17 : 13);
    }
    if (e.hp <= 0) this.killEnemy(e, element);
    return dmg;
  }

  applySlow(e, pct, dur) {
    if (e.ai === 'boss') pct *= this.cfg.freeze.bossSlowMult;
    if (e.slowT <= 0 || pct >= e.slowPct) e.slowPct = pct;
    e.slowT = Math.max(e.slowT, dur);
  }

  // Cơ chế đóng băng: đủ N đòn băng liên tiếp (cách nhau không quá window giây) thì đóng băng.
  chill(e) {
    const fr = this.cfg.freeze;
    if (e.dead || e.frozenT > 0 || e.freezeCd > 0) return;
    if (e.ai === 'boss' && fr.bossImmune) return;
    if (this.time - (e.lastCold ?? -99) > fr.window) e.coldHits = 0;
    e.lastCold = this.time;
    e.coldHits = (e.coldHits || 0) + 1;
    const need = Math.max(1, fr.hits - this.stats.freezeHitsReduce);
    if (e.coldHits >= need) {
      e.coldHits = 0;
      e.frozenT = fr.duration * (e.elite || e.big ? fr.eliteMult : 1);
      this.log.freezes++;
    }
  }

  killEnemy(e, element) {
    if (e.dead) return;
    e.dead = true;
    if (!e.big) this.aliveNormal--;
    this.kills++;
    if (this.stats.hpOnKill) this.player.hp = Math.min(this.stats.maxHp, this.player.hp + this.stats.hpOnKill);
    const drops = this.cfg.drops;
    if (e === this.boss) {
      this.addXp(e.xp);
      this.dropLoot(e, 'boss');
      this.addFx({ kind: 'burst', x: e.x, y: e.y, dur: 1.2, r: 160, color: '#7dff9a' });
      this.win();
      return;
    }
    if (!e.flee) {
      this.dropXp(e.x, e.y, e.xp);
      if (e.elite || this.rng.next() < drops.hpPotion.chance) this.dropPickup('hp', e.x + 8, e.y);
      if (this.rng.next() < drops.manaPotion.chance) this.dropPickup('mana', e.x - 8, e.y);
      this.dropLoot(e, e.elite ? 'elite' : e.ai === 'miniboss' ? 'miniboss' : 'normal');
    }
    if (e.affixes.includes('fire_enchanted')) {
      const ex = this.data.monsters.elite.affixes.fire_enchanted.deathExplosion;
      this.pending.push({ kind: 'eliteBlast', t: ex.delay, dur: ex.delay, x: e.x, y: e.y, r: ex.radius, dmg: ex.damage * e.dmgMult, name: e.name });
    }
    const ib = this.data.skills.inferno_burst;
    const ibl = this.lvl('inferno_burst');
    if (element === 'fire' && ibl > 0 && this.rng.next() < P.lv(ib.chance, ibl)) {
      this.pending.push({ kind: 'inferno', t: 0.05, dur: 0.05, x: e.x, y: e.y, r: ib.radius, dmg: e.maxHp * ib.hpPct, src: e.id });
    }
    const sh = this.data.skills.shatter;
    if (e.frozenT > 0 && this.lvl('shatter') > 0) {
      const dmg = e.maxHp * sh.shardHpPct;
      const a0 = this.rng.next() * TAU;
      for (let i = 0; i < sh.shardCount; i++) {
        const a = a0 + (i / sh.shardCount) * TAU;
        this.addProjectile({
          x: e.x, y: e.y, vx: Math.cos(a) * sh.shardSpeed, vy: Math.sin(a) * sh.shardSpeed, r: sh.shardRadius,
          life: sh.shardRange / sh.shardSpeed, dmg: [dmg, dmg], mult: 1, element: 'cold', noCrit: true,
          color: '#ffffff', look: 'shard', hitIds: [e.id],
        });
      }
    }
    if (e === this.miniboss) {
      this.showBanner(`Đã hạ ${e.name}!`, 2.5);
      this.miniboss = null;
    }
    if (!this.headless) this.addFx({ kind: 'death', x: e.x, y: e.y, dur: 0.3, r: e.r, color: e.color });
  }

  // Cấp đồ rơi: cấp bản đồ + số phút đã chơi + thưởng theo loại quái.
  itemLevel(bonus = 0) {
    return this.map.level + Math.floor(this.time / 60) * this.data.items.drops.ilvlPerMinute + bonus;
  }

  dropLoot(e, kind) {
    const D = this.data.items.drops;
    const cfg = D[kind];
    if (!cfg) return;
    if (kind === 'normal') {
      if (this.rng.next() < cfg.itemChance) this.dropItem(e.x, e.y, generateItem(this.rng, this.data, this.itemLevel()));
      if (this.rng.next() < cfg.goldChance) this.dropGold(e.x, e.y, this.itemLevel());
      return;
    }
    const ilvl = this.itemLevel(cfg.ilvlBonus);
    for (let i = 0; i < cfg.items; i++) {
      const minRarity = i === 0 && cfg.firstMinRarity ? cfg.firstMinRarity : cfg.minRarity;
      const it = generateItem(this.rng, this.data, ilvl, { minRarity, rareMult: cfg.rareMult, uniqueMult: cfg.uniqueMult });
      const a = (i / cfg.items) * TAU;
      this.dropItem(e.x + Math.cos(a) * 18, e.y + Math.sin(a) * 18, it);
    }
    if (cfg.gold) this.dropGold(e.x, e.y + 10, ilvl, 3);
  }

  dropItem(x, y, item) {
    this.pickups.push({ kind: 'item', x, y, item, value: 0, mag: false, dead: false });
    this.log.itemsDropped++;
  }

  dropGold(x, y, ilvl, mult = 1) {
    const g = this.data.items.drops.gold;
    const v = Math.round(this.rng.range(g.min, g.max) * (1 + g.perIlvl * ilvl) * mult);
    this.pickups.push({ kind: 'gold', x, y, value: v, mag: false, dead: false });
  }

  dropXp(x, y, value) {
    if (this.pickups.length >= this.cfg.drops.maxPickups) {
      // Gộp vào một viên ngọc sẵn có để giới hạn số vật thể.
      for (let i = this.pickups.length - 1; i >= 0; i--) {
        const k = this.pickups[i];
        if (k.kind === 'xp' && !k.dead) { k.value += value; return; }
      }
    }
    this.pickups.push({ kind: 'xp', x: x + this.rng.range(-6, 6), y: y + this.rng.range(-6, 6), value, mag: false, dead: false });
  }

  dropPickup(kind, x, y) {
    this.pickups.push({ kind, x, y, value: 0, mag: false, dead: false });
  }

  // ---------- Đạn, hiệu ứng trễ, vùng ----------
  updateProjectiles(dt) {
    for (const pr of this.projectiles) {
      if (pr.dead) continue;
      if (pr.jitter) {
        // Tia điện chạy lung tung: đổi hướng ngẫu nhiên liên tục.
        const a = (this.rng.next() - 0.5) * pr.jitter * dt * 2;
        const c = Math.cos(a), s = Math.sin(a);
        const vx = pr.vx * c - pr.vy * s;
        pr.vy = pr.vx * s + pr.vy * c;
        pr.vx = vx;
      }
      pr.x += pr.vx * dt;
      pr.y += pr.vy * dt;
      pr.life -= dt;
      if (pr.life <= 0) { pr.dead = true; continue; }
      this.grid.query(pr.x, pr.y, pr.r + 45, (e) => {
        if (e.flee && e !== this.boss) return;
        const dx = e.x - pr.x, dy = e.y - pr.y;
        const rr = e.r + pr.r;
        if (dx * dx + dy * dy >= rr * rr || pr.hitIds.includes(e.id)) return;
        pr.hitIds.push(e.id);
        this.damageEnemy(e, this.rng.range(pr.dmg[0], pr.dmg[1]) * pr.mult, pr.element, { slow: pr.slow, noCrit: pr.noCrit });
        if (pr.pierce-- <= 0) { pr.dead = true; return true; }
      });
    }
  }

  updatePending(dt) {
    if (!this.pending.length) return;
    const keep = [];
    const list = this.pending;
    this.pending = [];
    for (const pd of list) {
      pd.t -= dt;
      if (pd.t > 0) { keep.push(pd); continue; }
      this.resolvePending(pd);
    }
    // resolvePending có thể thêm hiệu ứng mới (nổ dây chuyền).
    this.pending = keep.concat(this.pending);
  }

  resolvePending(pd) {
    const p = this.player;
    switch (pd.kind) {
      case 'meteor': {
        const sk = pd.skill;
        const mult = this.skillMult(sk);
        this.areaDamage(pd.x, pd.y, pd.r, () => this.rollSkill(sk, pd.lvl, mult), sk.element);
        this.zones.push({ kind: 'area', look: 'burn', x: pd.x, y: pd.y, r: pd.r, t: 0, dur: sk.burnDuration, tickT: sk.burnTick, tick: sk.burnTick, dps: P.lv(sk.burnDps, pd.lvl), skill: sk, element: sk.element });
        this.addFx({ kind: 'burst', x: pd.x, y: pd.y, dur: 0.4, r: pd.r, color: '#ff7a2a' });
        this.emit({ type: 'shake', amount: 4 });
        break;
      }
      case 'inferno':
        this.areaDamage(pd.x, pd.y, pd.r, () => pd.dmg, 'fire', { noCrit: true });
        this.addFx({ kind: 'burst', x: pd.x, y: pd.y, dur: 0.35, r: pd.r, color: '#ffd23f' });
        break;
      case 'eliteBlast':
        if (Math.hypot(p.x - pd.x, p.y - pd.y) < pd.r + p.r) this.hurtPlayer(pd.dmg, 'fire', `Nổ: ${pd.name}`);
        this.addFx({ kind: 'burst', x: pd.x, y: pd.y, dur: 0.35, r: pd.r, color: '#ff3b1f' });
        break;
      case 'pool':
        this.zones.push({ kind: 'poison', x: pd.x, y: pd.y, r: pd.r, t: 0, dur: pd.duration, tickT: pd.tick, tick: pd.tick, dps: pd.dps });
        break;
    }
  }

  areaDamage(x, y, r, dmgFn, element, opts) {
    const list = [];
    this.grid.query(x, y, r + 45, (e) => {
      const dx = e.x - x, dy = e.y - y;
      const rr = r + e.r;
      if (dx * dx + dy * dy < rr * rr) list.push(e);
    });
    for (const e of list) this.damageEnemy(e, dmgFn(), element, opts);
  }

  updateZones(dt) {
    if (!this.zones.length) return;
    const p = this.player;
    for (const z of this.zones) {
      z.t += dt;
      if (z.kind === 'firewall') {
        // Làm chậm liên tục mọi quái chạm tường.
        const minx = Math.min(z.x1, z.x2) - 50, maxx = Math.max(z.x1, z.x2) + 50;
        const miny = Math.min(z.y1, z.y2) - 50, maxy = Math.max(z.y1, z.y2) + 50;
        const touching = [];
        this.grid.query(z.cx, z.cy, z.skill.length / 2 + 50, (e) => {
          if (e.x < minx || e.x > maxx || e.y < miny || e.y > maxy) return;
          if (segDist(e.x, e.y, z.x1, z.y1, z.x2, z.y2) < z.half + e.r) {
            this.applySlow(e, z.slow, 0.2);
            touching.push(e);
          }
        });
        z.tickT -= dt;
        if (z.tickT <= 0) {
          z.tickT += z.tick;
          const mult = this.skillMult(z.skill);
          for (const e of touching) this.damageEnemy(e, z.dps * z.tick * mult, 'fire');
        }
      } else if (z.kind === 'area') {
        z.tickT -= dt;
        if (z.tickT <= 0) {
          z.tickT += z.tick;
          const mult = this.skillMult(z.skill);
          this.areaDamage(z.x, z.y, z.r, () => z.dps * z.tick * mult, z.element, { slow: z.slow });
        }
      } else if (z.kind === 'poison') {
        z.tickT -= dt;
        if (z.tickT <= 0) {
          z.tickT += z.tick;
          if (Math.hypot(p.x - z.x, p.y - z.y) < z.r + p.r * 0.5) {
            this.hurtPlayer(z.dps * z.tick * (this.enraged ? this.data.monsters.swamp_lord.enrageDmgMult : 1), 'poison', 'Vũng độc', { dot: true });
          }
        }
      }
    }
    this.zones = this.zones.filter((z) => z.t < z.dur);
  }

  // ---------- Quái ----------
  updateEnemies(dt) {
    const p = this.player;
    const relocate = this.cfg.relocateDistance;
    const decay = Math.exp(-7 * dt);
    for (const e of this.enemies) {
      if (e.dead) continue;
      e.t += dt;
      e.hit = Math.max(0, e.hit - dt);
      if (e.freezeCd > 0) e.freezeCd -= dt;
      if (e.frozenT > 0) {
        // Đóng băng: đứng yên, không tấn công.
        e.frozenT -= dt;
        if (e.frozenT <= 0) { e.frozenT = 0; e.freezeCd = this.cfg.freeze.cooldown; }
        e.kx *= 0.9; e.ky *= 0.9;
        continue;
      }
      if (e.slowT > 0) { e.slowT -= dt; if (e.slowT <= 0) e.slowPct = 0; }
      const spd = e.speed * (1 - e.slowPct);
      let dx = p.x - e.x, dy = p.y - e.y;
      const d = Math.hypot(dx, dy) || 0.001;
      const ux = dx / d, uy = dy / d;
      let vx = 0, vy = 0;

      if (e.flee && e !== this.boss) {
        e.fleeT += dt;
        vx = -ux * spd * 1.6; vy = -uy * spd * 1.6;
        if (d > 950 || e.fleeT > 6) { e.dead = true; if (!e.big) this.aliveNormal--; if (e === this.miniboss) this.miniboss = null; continue; }
      } else {
        // Quái bị bỏ quá xa: đưa lại gần người chơi.
        if (!e.big && d > relocate) {
          const pt = this.spawnPoint('edge');
          e.x = pt.x; e.y = pt.y;
          continue;
        }
        switch (e.ai) {
          case 'chase':
            vx = ux * spd; vy = uy * spd;
            break;
          case 'bat': {
            const w = Math.sin(e.t * e.def.waveFreq + e.phase) * e.def.waveStrength;
            vx = (ux - uy * w) * spd; vy = (uy + ux * w) * spd;
            break;
          }
          case 'ranged': {
            const keep = e.def.keepDistance;
            if (d > keep + 30) { vx = ux * spd; vy = uy * spd; }
            else if (d < keep - 30) { vx = -ux * spd; vy = -uy * spd; }
            else { vx = -uy * spd * 0.4 * e.strafe; vy = ux * spd * 0.4 * e.strafe; }
            e.atkT -= dt;
            if (e.atkT <= 0 && d < e.def.attackRange) {
              e.atkT = e.def.attackInterval;
              const s = e.def.projectileSpeed;
              this.shots.push({ x: e.x, y: e.y, vx: ux * s, vy: uy * s, r: e.def.projectileRadius, dmg: e.dmg, life: e.def.attackRange / s + 0.6, name: e.name, src: e, dead: false });
            }
            break;
          }
          case 'miniboss':
            vx = ux * spd; vy = uy * spd;
            e.summonT -= dt;
            if (e.summonT <= 0) {
              e.summonT = e.def.summonInterval;
              for (let i = 0; i < e.def.summonCount; i++) {
                const a = (i / e.def.summonCount) * TAU;
                const pt = this.pushOutObstacles(clamp(e.x + Math.cos(a) * 60, 20, this.W - 20), clamp(e.y + Math.sin(a) * 60, 20, this.H - 20), 13);
                this.spawnEnemy(e.def.summonType, pt.x, pt.y);
              }
              this.addFx({ kind: 'burst', x: e.x, y: e.y, dur: 0.5, r: 70, color: '#a58a5a' });
            }
            break;
          case 'boss': {
            const v = this.updateBoss(e, dt, ux, uy, d, spd);
            vx = v[0]; vy = v[1];
            break;
          }
        }
      }

      e.kx *= decay; e.ky *= decay;
      e.x += (vx + e.kx) * dt;
      e.y += (vy + e.ky) * dt;

      // Tách nhau ra để không chồng lên một điểm.
      if (!e.big) {
        const er = e.r;
        this.grid.query(e.x, e.y, er + 45, (o) => {
          if (o === e) return;
          const ox = e.x - o.x, oy = e.y - o.y;
          const min = er + o.r;
          const d2 = ox * ox + oy * oy;
          if (d2 < min * min && d2 > 0.0001) {
            const dd = Math.sqrt(d2);
            const push = (min - dd) * (o.big ? 1 : 0.5);
            e.x += (ox / dd) * push;
            e.y += (oy / dd) * push;
          }
        });
      }
      if (!e.flying && !e.big) {
        const o = this.pushOutObstacles(e.x, e.y, e.r);
        e.x = o.x; e.y = o.y;
      }
      e.x = clamp(e.x, e.r, this.W - e.r);
      e.y = clamp(e.y, e.r, this.H - e.r);

      // Chạm người chơi.
      if (!e.flee) {
        const cx = p.x - e.x, cy = p.y - e.y;
        const rr = e.r + p.r;
        if (cx * cx + cy * cy < rr * rr) {
          const mult = e === this.boss && this.enraged ? e.def.enrageDmgMult : 1;
          if (this.hurtPlayer(e.contact * mult, e.dmgType, e.name)) this.onEnemyHitPlayer(e);
        }
      }
    }
  }

  onEnemyHitPlayer(e) {
    if (e.affixes.includes('mana_drain')) {
      const n = this.data.monsters.elite.affixes.mana_drain.manaPerHit;
      this.player.mana = Math.max(0, this.player.mana - n);
      this.addText(this.player.x, this.player.y - 36, `-${n} mana`, '#6fa8ff', 12);
    }
  }

  updateBoss(e, dt, ux, uy, d, spd) {
    const def = e.def;
    const b = e.b;
    const p = this.player;
    const enr = this.enraged ? def.enrageDmgMult : 1;
    if (!b.phase2 && e.hp < e.maxHp * def.phase2.hpPct) {
      b.phase2 = true;
      e.speed *= def.phase2.speedMult;
      this.showBanner(`${e.name} nổi giận, gọi đàn dơi!`, 2.5);
    }
    if (b.phase2) {
      b.batT -= dt;
      if (b.batT <= 0) {
        b.batT = def.phase2.batInterval;
        const room = this.phase() ? this.phase().maxAlive - this.aliveNormal : 0;
        if (room >= 6) this.spawnFlock(e.x, e.y, room);
      }
    }
    switch (b.state) {
      case 'chase':
        b.atkT -= dt;
        if (b.atkT <= 0) {
          if (b.next === 'slam') {
            b.state = 'tele'; b.t = def.slam.telegraph;
            b.sx = e.x; b.sy = e.y; b.tx = p.x; b.ty = p.y;
            b.next = 'pools';
          } else {
            b.state = 'cast'; b.t = def.pools.castTime;
            const pl = def.pools;
            for (let i = 0; i < pl.count; i++) {
              const ox = i === 0 ? 0 : this.rng.range(-pl.spread, pl.spread);
              const oy = i === 0 ? 0 : this.rng.range(-pl.spread, pl.spread);
              this.pending.push({ kind: 'pool', t: pl.landDelay + i * 0.12, dur: pl.landDelay + i * 0.12, x: clamp(p.x + ox, 20, this.W - 20), y: clamp(p.y + oy, 20, this.H - 20), r: pl.radius, duration: pl.duration, tick: pl.tick, dps: pl.dps });
            }
            b.next = 'slam';
          }
          return [0, 0];
        }
        return [ux * spd, uy * spd];
      case 'tele':
        b.t -= dt;
        if (b.t <= 0) {
          b.state = 'dash';
          const dx = b.tx - e.x, dy = b.ty - e.y;
          b.dist = Math.hypot(dx, dy);
          b.dx = dx / (b.dist || 1); b.dy = dy / (b.dist || 1);
          b.hitDone = false;
        }
        return [0, 0];
      case 'dash': {
        const step = def.slam.dashSpeed * dt;
        b.dist -= step;
        if (!b.hitDone && Math.hypot(p.x - e.x, p.y - e.y) < e.r + p.r + 6) {
          b.hitDone = true;
          this.hurtPlayer(def.slam.damage * e.dmgMult * enr, 'physical', `${e.name} (Vồ)`);
        }
        if (b.dist <= 0) {
          b.state = 'recover'; b.t = def.slam.recover;
          this.emit({ type: 'shake', amount: 6 });
          this.addFx({ kind: 'burst', x: e.x, y: e.y, dur: 0.4, r: 90, color: '#c23b3b' });
        }
        return [b.dx * def.slam.dashSpeed, b.dy * def.slam.dashSpeed];
      }
      case 'cast':
      case 'recover':
        b.t -= dt;
        if (b.t <= 0) { b.state = 'chase'; b.atkT = def.attackInterval * (b.phase2 ? 0.8 : 1); }
        return [0, 0];
    }
    return [0, 0];
  }

  updateShots(dt) {
    const p = this.player;
    for (const s of this.shots) {
      if (s.dead) continue;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.life -= dt;
      if (s.life <= 0) { s.dead = true; continue; }
      const dx = s.x - p.x, dy = s.y - p.y;
      const rr = s.r + p.r;
      if (dx * dx + dy * dy < rr * rr) {
        s.dead = true;
        if (this.hurtPlayer(s.dmg, 'physical', s.name) && s.src) this.onEnemyHitPlayer(s.src);
      }
    }
  }

  updatePickups(dt) {
    const p = this.player;
    const pr = this.stats.pickupRadius;
    const drops = this.cfg.drops;
    for (const k of this.pickups) {
      if (k.dead) continue;
      const dx = p.x - k.x, dy = p.y - k.y;
      const d = Math.hypot(dx, dy);
      if (!k.mag && d < pr) {
        if (k.kind === 'item' && firstFree(this.ch.inventory) < 0) {
          if (this.time > this.invFullT) { this.invFullT = this.time + 3; this.addText(p.x, p.y - 44, 'Kho đồ đầy!', '#ff9a8a', 14); }
          continue;
        }
        k.mag = true; k.sp = 120;
      }
      if (!k.mag) continue;
      k.sp = Math.min(drops.magnetSpeed * 2, k.sp + drops.magnetSpeed * 3 * dt);
      const step = k.sp * dt;
      if (d <= step + p.r) {
        k.dead = true;
        if (k.kind === 'xp') this.addXp(k.value);
        else if (k.kind === 'gold') {
          this.ch.gold += k.value;
          this.log.gold += k.value;
          this.addText(p.x, p.y - 30, `+${k.value} vàng`, '#ffd76a', 13);
        } else if (k.kind === 'item') {
          if (!addToInventory(this.ch, k.item)) { k.dead = false; k.mag = false; continue; }
          const col = this.data.items.rarities[k.item.rarity].color;
          this.log.itemsPicked.push({ rarity: k.item.rarity, name: k.item.name, ilvl: k.item.ilvl, t: Math.round(this.time) });
          this.addText(p.x, p.y - 48, k.item.name, col, 15);
          this.emit({ type: 'item', item: k.item });
        }
        else if (k.kind === 'hp') {
          p.hp = Math.min(this.stats.maxHp, p.hp + this.stats.maxHp * drops.hpPotion.healPct);
          this.log.potions.hp++;
          this.addText(p.x, p.y - 30, '+Máu', '#ff6b6b', 14);
        } else if (k.kind === 'mana') {
          p.mana = Math.min(this.stats.maxMana, p.mana + this.stats.maxMana * drops.manaPotion.restorePct);
          this.log.potions.mana++;
          this.addText(p.x, p.y - 30, '+Mana', '#6fa8ff', 14);
        }
      } else {
        k.x += (dx / d) * step;
        k.y += (dy / d) * step;
      }
    }
  }

  updateVisuals(dt) {
    if (this.banner) {
      this.banner.t += dt;
      if (this.banner.t > this.banner.dur) this.banner = null;
    }
    if (this.headless) return;
    for (const t of this.texts) t.t += dt;
    this.texts = this.texts.filter((t) => t.t < 0.8);
    for (const f of this.fx) f.t += dt;
    this.fx = this.fx.filter((f) => f.t < f.dur);
  }

  // ---------- Debug ----------
  jumpTo(seconds) {
    const t = Math.max(0, seconds);
    for (const e of this.enemies) if (e !== this.boss) e.dead = true;
    this.shots = [];
    this.orbs = [];
    this.zones = this.zones.filter((z) => z.kind !== 'poison');
    this.pending = this.pending.filter((p) => p.kind !== 'pool' && p.kind !== 'eliteBlast');
    this.miniboss = null;
    this.cleanup();
    this.time = t;
    this.eventIdx = 0;
    while (this.eventIdx < this.events.length && this.events[this.eventIdx].t < t) this.eventIdx++;
    const bossEv = this.events.find((ev) => ev.type === 'boss');
    const enrEv = this.events.find((ev) => ev.type === 'enrage');
    const retEv = this.events.find((ev) => ev.type === 'retreat');
    this.retreating = !!retEv && t >= retEv.t && (!bossEv || t < bossEv.t);
    if (bossEv && t >= bossEv.t && !this.bossSpawned) this.spawnBoss(bossEv.monster);
    if (enrEv && t >= enrEv.t && this.boss && !this.boss.dead) this.enraged = true;
    this.spawnTimer = 0;
    this.showBanner(`Debug: nhảy tới ${fmtTime(t)}`, 1.5);
  }

  debugSpawn(n, type = 'zombie') {
    for (let i = 0; i < n; i++) {
      const pt = this.spawnPoint('range');
      this.spawnEnemy(type, pt.x, pt.y);
    }
  }

  debugKillAll() {
    for (const e of this.enemies) if (!e.big) this.killEnemy(e, 'fire');
  }
}

export function segDist(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const l2 = dx * dx + dy * dy;
  let t = l2 ? ((px - x1) * dx + (py - y1) * dy) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

export function fmtTime(s) {
  s = Math.max(0, Math.floor(s));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
