// Lõi mô phỏng một lượt chơi. Không đụng tới DOM/canvas: dùng được cho trình duyệt lẫn bot trong Node.
import { RNG } from './rng.js';
import { Grid } from './grid.js';
import * as P from './progression.js';
import { generateItem, generateRune, generateSSR, addToInventory, canAdd } from './items.js';
import { MinionMixin } from './minions.js';
import { lootDecision, makeRoomFor } from './loot.js';
import { sellValue } from './items.js';

const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// Vật cản: nếu màn bật "random" thì mỗi lượt chơi một bố cục khác (theo seed của lượt), số lượng dao động ±countVariation.
function buildObstacles(map, W, H, runSeed) {
  const cfg = map.obstacles;
  const random = !!cfg.random;
  const rng = new RNG(random ? (runSeed ^ 0x9e3779b9) >>> 0 : cfg.seed);
  const list = [];
  const cx = W / 2, cy = H / 2;
  for (const t of cfg.types) {
    let placed = 0, tries = 0;
    const v = random ? cfg.random.countVariation || 0 : 0;
    const count = Math.round(t.count * (1 + rng.range(-v, v)));
    while (placed < count && tries < count * 50) {
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
    this.map = data.maps[opts.mapId || data.mapOrder[0]];
    if (!this.map) throw new Error(`Không có màn ${opts.mapId}`);
    this.diff = data.difficultiesById[opts.difficulty || 'normal'] || data.difficulties[0];
    this.seed = opts.seed ?? ((Math.random() * 0xffffffff) >>> 0);
    this.rng = new RNG(this.seed);
    this.headless = !!opts.headless;
    this.viewW = opts.viewW || 1280;
    this.viewH = opts.viewH || 720;
    this.W = this.map.size[0];
    this.H = this.map.size[1];
    this.duration = this.cfg.run.duration;
    this.time = 0;
    this.timeShift = 0; // gọi boss sớm: đồng hồ màn nhảy tới lúc quái rút lui
    this.kills = 0;

    this.obstacles = buildObstacles(this.map, this.W, this.H, this.seed);
    this.obGrid = buildObstacleGrid(this.obstacles, this.W, this.H, 128);

    const pc = P.playerCfg(ch, data);
    this.pcfg = pc;
    this.cls = P.getClass(ch, data);
    this.player = { x: this.W / 2, y: this.H / 2, r: pc.radius, hp: 0, mana: 0, invuln: 0, faceX: 1, faceY: 0, glow: 0, hurt: 0, moving: false };
    this.stats = P.computeStats(ch, data);
    this.player.hp = this.stats.maxHp;
    this.player.mana = this.stats.maxMana;
    this.statBase = null;

    this.enemies = [];
    this.minions = []; // vật triệu hồi (Triệu hồi sư)
    this.poisoned = new Set(); // quái đang trúng độc Nanh Độc
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
    this.buffs = []; // { id, dmgPct, armorMult, t }
    // Hiệu ứng bộ SSR.
    this.specialT = { cataclysm: 0, spiritWolf: 0 };
    this.undyingCd = 0;
    this.elemHitT = {};
    this.packRageT = 0;
    this.waveIcd = 0;
    this.frenzy = { stacks: 0, t: 0 };
  }

  // ---------- Tiện ích ----------
  emit(ev) { this.out.push(ev); }
  showBanner(text, dur = 3.5) { this.banner = { text, t: 0, dur }; this.emit({ type: 'banner', text }); }
  // Hệ số máu / kinh nghiệm của quái mới sinh theo thời gian trong màn (run.ramp).
  rampMult() {
    const R = this.cfg.run.ramp;
    if (!R) return { hp: 1, xp: 1, steps: 0 };
    const steps = Math.floor(this.clock / R.interval);
    return { hp: 1 + R.hpPct * steps, xp: 1 + R.xpPct * steps, steps };
  }

  // Đồng hồ của màn (lịch sinh quái, sự kiện, cuồng nộ). Bằng thời gian thật, trừ khi đã gọi boss sớm.
  get clock() { return this.time + this.timeShift; }

  phase() {
    const t = this.clock;
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
    if (this.victory) this.updateVictory(dt);
    else {
      this.time += dt;
      this.processEvents();
      this.updateSpawner(dt);
    }
    if (this.over) return;
    this.updatePlayer(dt);
    this.grid.rebuild(this.enemies);
    this.updateBuffs(dt);
    this.updateSkills(dt);
    this.updateSpecials(dt);
    this.updateOrbs(dt);
    this.updateMinions(dt);
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
    while (this.eventIdx < this.events.length && this.events[this.eventIdx].t <= this.clock) {
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
    // Độ khó của màn (×1,05 mỗi màn) nhân vào máu và sát thương của mọi quái.
    const D = this.diff;
    const hp = def.hp * (1 + sc.hpPerLevel * (lvl - 1)) * (this.map.hpMult ?? this.map.difficulty ?? 1) * D.hpMult;
    // Boss / trùm nhỏ có thể có hệ số sát thương riêng theo độ khó (Địa ngục ×7,5 thay vì ×9,5).
    const isBig = def.ai === 'boss' || def.ai === 'miniboss';
    const dmgMult = (1 + sc.dmgPerLevel * (lvl - 1)) * (this.map.dmgMult ?? this.map.difficulty ?? 1) * (isBig ? D.bossDmgMult ?? D.dmgMult : D.dmgMult);
    const e = {
      id: this.nextId++, type: typeId, def, name: def.name, ai: def.ai,
      x, y, r: def.radius, hp, maxHp: hp,
      dmg: def.damage * dmgMult, dmgMult,
      contact: (def.contactDamage ?? def.damage) * dmgMult,
      dmgType: def.damageType || 'physical',
      speed: def.speed, xp: def.xp * (this.map.rewardMult || 1) * D.xpMult * (this.cfg.xp.killMult || 1), color: def.color,
      resist: this.diffResist(def.resist || {}), level: lvl,
      kx: 0, ky: 0, slowT: 0, slowPct: 0, hit: 0,
      t: this.rng.next() * 10, phase: this.rng.next() * TAU,
      atkT: def.attackInterval ? this.rng.range(0.5, def.attackInterval) : 0,
      strafe: this.rng.next() < 0.5 ? 1 : -1,
      elite: false, affixes: [], flying: !!def.flying,
      big: def.ai === 'boss' || def.ai === 'miniboss',
      flee: false, fleeT: 0, dead: false,
    };
    // Boss và trùm nhỏ có thêm máu riêng theo độ khó.
    if (e.big && D.bossHpMult) { e.hp *= D.bossHpMult; e.maxHp = e.hp; }
    // Quái thường (kể cả tinh anh) mạnh dần trong màn: mỗi 5 giây +1% máu và +2% kinh nghiệm cho quái mới sinh.
    if (!e.big) {
      const rp = this.rampMult();
      e.hp *= rp.hp; e.maxHp = e.hp;
      e.xp *= rp.xp;
    }
    if (def.ai === 'miniboss') e.summonT = def.summonInterval;
    if (def.ai === 'boss') e.b = { state: 'chase', atkT: def.attackInterval, next: 'slam', t: 0, phase2: false, batT: def.phase2.batInterval };
    this.enemies.push(e);
    if (!e.big) this.aliveNormal++;
    return e;
  }

  // Độ khó cao: quái có thêm kháng mọi nguyên tố (vật lý được nửa).
  diffResist(base) {
    const add = this.diff.monsterResist || 0;
    if (!add) return base;
    const o = { ...base };
    for (const k of ['fire', 'cold', 'lightning', 'poison']) o[k] = (o[k] || 0) + add;
    o.physical = (o.physical || 0) + add * 0.5;
    return o;
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
    // Bị làm chậm (Sóng bùn của boss).
    if (p.slowT > 0) p.slowT -= dt;
    const ms = this.stats.moveSpeed * (p.slowT > 0 ? 1 - (p.slowPct || 0) : 1);
    p.x += ix * ms * dt;
    p.y += iy * ms * dt;
    const o = this.pushOutObstacles(p.x, p.y, p.r);
    p.x = clamp(o.x, p.r, this.W - p.r);
    p.y = clamp(o.y, p.r, this.H - p.r);
    p.invuln = Math.max(0, p.invuln - dt);
    p.glow = Math.max(0, p.glow - dt);
    p.swing = Math.max(0, (p.swing || 0) - dt);
    p.hurt = Math.max(0, p.hurt - dt);
    const link = this.minions.length ? this.spiritLinkCount() : 0;
    const linkRegen = link ? link * P.lv(this.data.skills.spirit_link.perMinionManaRegen, this.lvl('spirit_link')) : 0;
    p.mana = Math.min(this.stats.maxMana, p.mana + this.stats.manaRegen * (1 + linkRegen) * dt);
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
    if (this.over || this.god || this.victory) return false;
    if (!opts.dot) {
      if (p.invuln > 0) return false;
      if (this.rng.next() < this.stats.dodge) {
        this.addText(p.x, p.y - 22, 'Né', '#9fd3ff', 13);
        return false;
      }
    }
    let dmg = amount;
    // Kiên Cường (Chiến Binh): nhận ít sát thương hơn từ boss và trùm nhỏ.
    if (opts.boss) dmg *= this.pcfg.bossDmgTaken ?? 1;
    if (type === 'physical') {
      const lvl = opts.level || this.map.level;
      const a = this.stats.armor * this.armorMult();
      const red = Math.min(this.cfg.caps.armorReduction, a / (a + this.cfg.armor.base + this.cfg.armor.perMonsterLevel * lvl));
      dmg *= 1 - red;
    } else {
      // Độ khó cao trừ kháng của người chơi (có thể âm, tối đa nhận ×2 sát thương).
      const link = this.minions.length ? this.spiritLinkCount() * this.data.skills.spirit_link.perMinionResist : 0;
      const res = Math.max(-1, Math.min(this.cfg.caps.playerResist, (this.stats.resist[type] || 0) + link - (this.diff.playerResistPenalty || 0)));
      dmg *= 1 - res;
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
      // Bất Diệt (bộ SSR Chiến Binh): hồi 50% máu, bất tử 2 giây, hồi chiêu 90 giây.
      const und = this.stats.specials?.undying;
      if (und && this.undyingCd <= 0) {
        this.undyingCd = und.cooldown;
        p.hp = this.stats.maxHp * und.heal;
        p.invuln = Math.max(p.invuln, und.invuln);
        this.log.undying = (this.log.undying || 0) + 1;
        this.addText(p.x, p.y - 40, 'Bất Diệt!', '#ffd27a', 18);
        this.addFx({ kind: 'nova', x: p.x, y: p.y, dur: 0.6, r: 110, color: '#ffd27a' });
        return true;
      }
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
    // Mở khoá màn kế tiếp.
    const idx = this.map.index ?? 0;
    const dId = this.diff.id;
    const before = P.unlockedDifficulties(this.ch, this.data);
    const firstClear = P.progressOf(this.ch, dId) <= idx;
    P.setProgress(this.ch, dId, idx + 1);
    this.ch.mapClears = this.ch.mapClears || {};
    const ck = P.clearKey(dId, this.map.id);
    this.ch.mapClears[ck] = (this.ch.mapClears[ck] || 0) + 1;
    // Kỷ lục thời gian hạ boss.
    this.ch.records = this.ch.records || {};
    const rk = `${dId}:${this.map.id}`;
    const t = Math.round((this.bossTime ?? this.time) * 10) / 10;
    const newRecord = !(this.ch.records[rk] <= t);
    if (newRecord) this.ch.records[rk] = t;
    const next = this.data.mapOrder[idx + 1] || null;
    const newDiff = P.unlockedDifficulties(this.ch, this.data).find((d) => !before.includes(d)) || null;
    this.result = { win: true, time: this.bossTime ?? this.time, chestLoot: this.chestLoot || [], overflow: this.overflow || [], flawless, firstClear, nextMap: firstClear ? next : null, newRecord, difficulty: dId, newDifficulty: newDiff };
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
    return P.damageMult(this.ch, skill, this.stats, this.data) + this.buffDmgPct();
  }

  // ---------- Buff (Thét Xung Trận, Cuồng Huyết) và Cuồng Sát ----------
  buffDmgPct() {
    let s = 0;
    for (const b of this.buffs) s += b.dmgPct || 0;
    const fz = this.data.skills.frenzy;
    if (fz && this.frenzy.stacks > 0) s += this.frenzy.stacks * P.lv(fz.stackDmg, Math.max(1, this.lvl('frenzy')));
    return s;
  }

  armorMult() {
    let m = 1;
    for (const b of this.buffs) if (b.armorMult) m *= b.armorMult;
    return m;
  }

  updateBuffs(dt) {
    if (this.buffs.length) {
      for (const b of this.buffs) b.t -= dt;
      this.buffs = this.buffs.filter((b) => b.t > 0);
    }
    if (this.frenzy.stacks > 0) {
      this.frenzy.t -= dt;
      if (this.frenzy.t <= 0) this.frenzy.stacks = 0;
    }
  }

  rollSkill(skill, lvl, mult) {
    // Đòn kỹ năng vật lý (không phải thú): đánh dấu để damageEnemy cộng thêm sát thương nguyên tố của vũ khí cận chiến.
    this._addSk = !skill.summon && skill.element === 'physical' ? skill : null;
    const [a, b] = P.hitRange(skill, lvl, this.stats);
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
      case 'melee': return this.castMelee(sk, lvl);
      case 'leap': return this.castLeap(sk, lvl);
      case 'howl': return this.castHowl(sk, lvl);
      case 'buff': return this.castBuff(sk, lvl);
      case 'summon': return this.castSummon(sk, lvl);
      case 'rally': return this.castRally(sk, lvl);
      case 'minionNova': return this.castMinionNova(sk, lvl);
      case 'heal': return this.castHeal(sk, lvl);
      case 'swarm': return this.castSwarm(sk, lvl);
      case 'dive': return this.castDive(sk, lvl);
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
      // Quái vừa sinh trong khung hình này chưa có trong lưới: n = 0, bỏ qua (tránh chia 0 ra NaN).
      if (n > 0 && (!best || n > best.n)) best = { n, x: sx / n, y: sy / n };
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
    const dmg = P.hitRange(sk, lvl, this.stats);
    for (let k = 0; k < n; k++) {
      const a = base + (k - (n - 1) / 2) * spread;
      this.addProjectile({
        x: p.x, y: p.y, vx: Math.cos(a) * sk.projectileSpeed, vy: Math.sin(a) * sk.projectileSpeed,
        r: sk.projectileRadius, life: sk.range / sk.projectileSpeed, pierce, dmg, mult,
        element: sk.element, slow: sk.slow, color: sk.color, look: sk.id,
        addSk: !sk.summon && sk.element === 'physical' ? sk : null,
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
      dps: P.lv(sk.dps, lvl) + P.dpsFlat(sk, this.stats), slow: sk.slowPct, skill: sk, lvl,
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
      dps: P.lv(sk.dps, lvl) + P.dpsFlat(sk, this.stats), skill: sk, element: sk.element, slow: sk.slow,
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
      emitT: 0, ang: a, skill: sk, lvl, mult: this.skillMult(sk), dmg: P.hitRange(sk, lvl, this.stats),
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
    const dmg = P.hitRange(sk, lvl, this.stats);
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

  // Chém cận chiến hình vòng cung về phía quái gần nhất.
  castMelee(sk, lvl) {
    const p = this.player;
    const t = this.nearestEnemy(sk.range + 45);
    if (!t || Math.hypot(t.x - p.x, t.y - p.y) > sk.range + t.r + p.r) return false;
    const a0 = Math.atan2(t.y - p.y, t.x - p.x);
    const half = ((sk.arcDeg || 120) * Math.PI) / 360;
    const mult = this.skillMult(sk);
    const hits = [];
    this.grid.query(p.x, p.y, sk.range + p.r + 45, (e) => {
      if (e.flee && e !== this.boss) return;
      const dx = e.x - p.x, dy = e.y - p.y;
      const d = Math.hypot(dx, dy);
      if (d > sk.range + e.r + p.r) return;
      let da = Math.atan2(dy, dx) - a0;
      while (da > Math.PI) da -= TAU;
      while (da < -Math.PI) da += TAU;
      if (Math.abs(da) <= half + Math.atan2(e.r, Math.max(d, 1))) hits.push(e);
    });
    for (const e of hits) this.damageEnemy(e, this.rollSkill(sk, lvl, mult), sk.element);
    p.faceX = Math.cos(a0); p.faceY = Math.sin(a0);
    p.swing = 0.22;
    this.addFx({ kind: 'slash', x: p.x, y: p.y, a: a0, half, r: sk.range + p.r, dur: 0.18, color: sk.color });
    return true;
  }

  // Nhảy vào cụm quái đông nhất rồi đập xuống.
  castLeap(sk, lvl) {
    const t = this.densestPoint(sk.range, sk.radius);
    if (!t || !Number.isFinite(t.x) || !Number.isFinite(t.y)) return false;
    const p = this.player;
    const from = { x: p.x, y: p.y };
    const o = this.pushOutObstacles(clamp(t.x, p.r, this.W - p.r), clamp(t.y, p.r, this.H - p.r), p.r);
    p.x = o.x; p.y = o.y;
    p.invuln = Math.max(p.invuln, sk.invuln);
    const mult = this.skillMult(sk);
    this.grid.rebuild(this.enemies);
    this.areaDamage(p.x, p.y, sk.radius, () => this.rollSkill(sk, lvl, mult), sk.element);
    this.addFx({ kind: 'leap', x1: from.x, y1: from.y, x: p.x, y: p.y, dur: 0.3 });
    this.addFx({ kind: 'burst', x: p.x, y: p.y, dur: 0.35, r: sk.radius, color: '#b0a090' });
    this.emit({ type: 'shake', amount: 5 });
    return true;
  }

  // Gầm: sát thương nhỏ, đẩy lùi, làm quái sợ bỏ chạy.
  castHowl(sk, lvl) {
    const p = this.player;
    // Đòn thoát thân: chỉ tự dùng khi bị vây (đủ minCrowd quái sát người) hoặc máu thấp.
    let close = 0;
    this.grid.query(p.x, p.y, sk.closeRadius + 45, (e) => {
      if (!e.flee && Math.hypot(e.x - p.x, e.y - p.y) < sk.closeRadius + e.r) close++;
    });
    if (close < sk.minCrowd && !(close > 0 && p.hp < this.stats.maxHp * sk.lowHpPct)) return false;
    const mult = this.skillMult(sk);
    const fear = P.lv(sk.fear, lvl);
    const list = [];
    this.grid.query(p.x, p.y, sk.radius + 45, (e) => {
      const d = Math.hypot(e.x - p.x, e.y - p.y);
      if (d < sk.radius + e.r) list.push([e, d]);
    });
    for (const [e, d] of list) {
      this.damageEnemy(e, this.rollSkill(sk, lvl, mult), sk.element);
      if (e.dead || e.big) continue;
      const ux = (e.x - p.x) / (d || 1), uy = (e.y - p.y) / (d || 1);
      const kb = sk.knockback * (e.elite ? 0.3 : 1); // tinh anh nặng hơn, bị đẩy ít
      e.kx += ux * kb; e.ky += uy * kb;
      e.fearT = Math.max(e.fearT || 0, fear * (e.elite ? 0.5 : 1));
    }
    this.addFx({ kind: 'nova', x: p.x, y: p.y, dur: 0.4, r: sk.radius, color: sk.color });
    return true;
  }

  // Buff bản thân: chỉ dùng khi có quái trong tầm 400 px để không phí.
  castBuff(sk, lvl) {
    if (!this.nearestEnemy(400)) return false;
    if (sk.summon && !this.aliveMinions((m) => !m.flying)) return false; // Tiếng Hú Bầy Đàn cần có thú
    this.buffs = this.buffs.filter((b) => b.id !== sk.id);
    this.buffs.push({
      id: sk.id, dmgPct: sk.buff.dmgPct ? P.lv(sk.buff.dmgPct, lvl) : 0, armorMult: sk.buff.armorMult || 0,
      summonAtk: sk.buff.summonAtkSpeed ? P.lv(sk.buff.summonAtkSpeed, lvl) : 0, summonSpeed: sk.buff.summonSpeed || 0,
      t: sk.duration, dur: sk.duration, color: sk.color,
    });
    this.addFx({ kind: 'nova', x: this.player.x, y: this.player.y, dur: 0.5, r: 70, color: sk.color });
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
    // Đọc rồi xoá ngay dấu đòn kỹ năng, để các đòn phụ lồng bên trong (sóng chém, phản gai…) không nhận thêm.
    const addSk = element === 'physical' && !opts.noAdds ? this._addSk : null;
    this._addSk = null;
    if (e.dead || e.burrowed) return 0; // trùm nhỏ đang độn thổ: không trúng
    const caps = this.cfg.caps;
    const res = clamp(e.resist[element] || 0, caps.monsterResistMin, caps.monsterResistMax);
    let dmg = amount * (1 - res);
    // Cộng hưởng Nguyên tố (bộ SSR Pháp sư): mỗi nguyên tố đã đánh trúng trong 4 giây gần nhất +12%.
    const reso = this.stats.specials?.elementResonance;
    if (reso && (element === 'fire' || element === 'cold' || element === 'lightning')) {
      this.elemHitT[element] = this.time;
      let k = 0;
      for (const el of ['fire', 'cold', 'lightning']) if (this.elemHitT[el] !== undefined && this.time - this.elemHitT[el] <= reso.window) k++;
      dmg *= 1 + k * reso.perElement;
    }
    let crit = false;
    if (!opts.noCrit && this.rng.next() < this.stats.critChance + (opts.critBonus || 0)) { dmg *= this.stats.critMult; crit = true; }
    // Thần Kiếm (bộ SSR Chiến Binh): đòn chí mạng tạo sóng chém quanh người chơi.
    const wave = this.stats.specials?.critWave;
    if (crit && wave && !opts.noWave && this.waveIcd <= 0) {
      this.waveIcd = wave.icd;
      const p = this.player;
      const wd = dmg * wave.mult;
      this.areaDamage(p.x, p.y, wave.radius, () => wd, element, { noCrit: true, noWave: true, quiet: true });
      this.addFx({ kind: 'nova', x: p.x, y: p.y, dur: 0.25, r: wave.radius, color: '#ffd27a' });
    }
    if (e.affixes.includes('stone_skin')) {
      const af = this.data.monsters.elite.affixes.stone_skin;
      if (e.hp > e.maxHp * af.untilHpPct) dmg *= af.damageTakenMult;
    }
    if ((e.elite || e.ai === 'miniboss') && this.stats.eliteDmgPct[element]) dmg *= 1 + this.stats.eliteDmgPct[element];
    if (e.frozenT > 0) {
      const sl = this.lvl('shatter');
      if (sl > 0) dmg *= 1 + P.lv(this.data.skills.shatter.frozenDmgBonus, sl);
    }
    const before = e.hp;
    e.hp -= dmg;
    if (this.stats.leech && before > 0) {
      const p = this.player;
      p.hp = Math.min(this.stats.maxHp, p.hp + Math.min(dmg, before) * this.stats.leech);
    }
    e.hit = 0.08;
    this.dpsBuckets[this.dpsIdx] += dmg;
    this.totalDamage += dmg;
    this.effDamage += Math.max(0, Math.min(dmg, before));
    this.dmgByElement[element] = (this.dmgByElement[element] || 0) + Math.max(0, Math.min(dmg, before));
    if (opts.slow) this.applySlow(e, opts.slow.pct, opts.slow.duration);
    if (element === 'cold') this.chill(e);
    if (this.showDamage && !this.headless && !opts.quiet && (crit || dmg >= 6 || e.big || e.elite)) {
      this.addText(e.x, e.y - e.r - 4, Math.round(dmg).toString(), crit ? '#ffe14d' : element === 'cold' ? '#bfeaff' : '#ffffff', crit ? 17 : 13);
    }
    if (e.hp <= 0) this.killEnemy(e, element);
    else if (addSk) this.elementalAdds(e, addSk);
    return dmg;
  }

  // Sát thương lửa / băng / sét cộng thêm mỗi đòn từ vũ khí cận chiến: là đòn riêng theo nguyên tố
  // (trừ kháng nguyên tố, băng tính vào đóng băng, sét +60% lên tinh anh), nhân hệ số kỹ năng và % nguyên tố trên đồ.
  elementalAdds(e, sk) {
    const ad = this.stats.adds;
    if (!ad || !(ad.fire || ad.cold || ad.lightning)) return;
    const fs = sk.flatScale ?? 1;
    const base = this.skillMult(sk);
    for (const el of ['fire', 'cold', 'lightning']) {
      const v = ad[el];
      if (!v || e.dead) continue;
      const roll = el === 'lightning' ? this.rng.range(Math.max(1, v / 4), v) : v;
      this.damageEnemy(e, roll * fs * (base + (this.stats.elemDmgPct[el] || 0)), el, { noCrit: true, noWave: true, noAdds: true, quiet: true });
    }
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
      this.bossDefeated(e);
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
    // Bị động nổ khi giết (Hoả Ngục Bùng Nổ với lửa, Huyết Bạo với vật lý).
    for (const id of this.deathBursts || (this.deathBursts = this.data.skillList.filter((x) => x.deathBurst).map((x) => x.id))) {
      const ib = this.data.skills[id];
      const ibl = this.lvl(id);
      if (element === ib.element && ibl > 0 && this.rng.next() < P.lv(ib.chance, ibl)) {
        this.pending.push({ kind: 'inferno', t: 0.05, dur: 0.05, x: e.x, y: e.y, r: ib.radius, dmg: e.maxHp * ib.hpPct, src: e.id, element: ib.element, color: ib.color });
      }
    }
    const fz = this.data.skills.frenzy;
    if (fz && this.lvl('frenzy') > 0) {
      this.frenzy.stacks = Math.min(fz.maxStacks, this.frenzy.stacks + 1);
      this.frenzy.t = fz.stackDuration;
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

  // ---------- Hiệu ứng bộ SSR ----------
  updateSpecials(dt) {
    if (this.undyingCd > 0) this.undyingCd -= dt;
    if (this.waveIcd > 0) this.waveIcd -= dt;
    if (this.packRageT > 0) this.packRageT -= dt;
    const sp = this.stats.specials;
    if (!sp) return;
    if (sp.cataclysm) {
      this.specialT.cataclysm += dt;
      if (this.specialT.cataclysm >= sp.cataclysm.interval && this.castCataclysm(sp.cataclysm)) this.specialT.cataclysm = 0;
    }
    if (sp.spiritWolf) {
      this.specialT.spiritWolf += dt;
      if (this.specialT.spiritWolf >= sp.spiritWolf.interval && this.nearestEnemy(500)) {
        this.specialT.spiritWolf = 0;
        this.spawnSpiritWolf(sp.spiritWolf);
      }
    }
  }

  // Thiên Tai (bộ SSR Pháp sư): thiên thạch ba nguyên tố, sát thương = mult × kỹ năng mạnh nhất đang gắn.
  castCataclysm(c) {
    const t = this.densestPoint(c.range, c.radius);
    if (!t || !Number.isFinite(t.x)) return false;
    let best = 0;
    for (const id of this.ch.slots) {
      const sk = id && this.data.skills[id];
      if (!sk || !sk.damage) continue;
      const l = this.lvl(id);
      if (l <= 0) continue;
      const [a, b] = P.hitRange(sk, l, this.stats);
      best = Math.max(best, ((a + b) / 2) * this.skillMult(sk));
    }
    if (best <= 0) return false;
    const part = (best * c.mult) / 3;
    for (const el of ['fire', 'cold', 'lightning']) this.areaDamage(t.x, t.y, c.radius, () => part, el);
    this.addFx({ kind: 'burst', x: t.x, y: t.y, dur: 0.5, r: c.radius, color: '#ff7a2a' });
    this.addFx({ kind: 'nova', x: t.x, y: t.y, dur: 0.45, r: c.radius * 0.8, color: '#9fe3ff' });
    this.addFx({ kind: 'strike', x: t.x, y: t.y, dur: 0.35, color: '#ffe14d' });
    this.emit({ type: 'shake', amount: 4 });
    return true;
  }

  // ---------- Gọi boss sớm ----------
  // Giết đủ run.callBossKills quái (trước khi quái rút lui) thì được gọi boss ngay.
  canCallBoss() {
    if (this.over || this.victory || this.bossSpawned || this.retreating || this.bossCalled) return false;
    return this.kills >= (this.cfg.run.callBossKills ?? Infinity);
  }

  // Nhảy đồng hồ màn tới lúc quái rút lui: bỏ các sự kiện còn lại trước đó (tinh anh, trùm nhỏ chưa ra), boss tới sau vài giây.
  callBoss() {
    if (!this.canCallBoss()) return false;
    const ret = this.events.find((ev) => ev.type === 'retreat');
    if (!ret) return false;
    this.bossCalled = true;
    this.timeShift = Math.max(0, ret.t - this.time);
    while (this.eventIdx < this.events.length && this.events[this.eventIdx].t < ret.t) this.eventIdx++;
    this.spawnTimer = 0;
    this.log.bossCalledAt = Math.round(this.time);
    this.processEvents();
    return true;
  }

  // ---------- Hạ boss: rương thưởng ----------
  bossDefeated(e) {
    const p = this.player;
    this.bossTime = this.time;
    const C = this.data.items.drops.chest;
    this.victory = { state: 'chest', t: 0, left: C.countdown };
    // Quái còn lại biến mất, không sinh thêm quái, không còn đạn hay vũng độc.
    for (const o of this.enemies) {
      if (o.dead) continue;
      o.dead = true;
      this.addFx({ kind: 'death', x: o.x, y: o.y, dur: 0.4, r: o.r, color: o.color });
    }
    this.aliveNormal = 0;
    this.shots = [];
    this.pending = this.pending.filter((pd) => pd.kind !== 'eliteBlast' && pd.kind !== 'pool');
    this.zones = this.zones.filter((z) => z.kind !== 'poison');
    p.invuln = 0;
    const x = Math.max(40, Math.min(this.W - 40, e.x)), y = Math.max(40, Math.min(this.H - 40, e.y + 85));
    const o = this.pushOutObstacles(x, y, 24);
    this.pickups.push({ kind: 'chest', x: o.x, y: o.y, value: 0, mag: false, dead: false, opened: false });
    this.showBanner('Đã hạ boss! Nhặt rương thưởng', 3);
    this.emit({ type: 'bossDown' });
  }

  updateVictory(dt) {
    const v = this.victory;
    const C = this.data.items.drops.chest;
    v.t += dt;
    if (v.state === 'chest') {
      if (v.t >= C.autoOpen) {
        const chest = this.pickups.find((k) => k.kind === 'chest' && !k.opened);
        if (chest) this.openChest(chest);
      }
    } else if (v.state === 'count') {
      v.left -= dt;
      // Đồ còn trên đất (kể cả đồ bị bộ lọc bỏ qua thì để lại) tiếp tục bay vào người.
      if (v.left <= 0) this.finishVictory();
    }
  }

  // Mở rương: phun phần thưởng ra rồi hút mọi đồ trên đất vào người; 5 giây sau kết thúc màn.
  openChest(chest) {
    if (chest.opened) return;
    chest.opened = true;
    chest.dead = true;
    const C = this.data.items.drops.chest;
    const DF = this.diff;
    const mult = (this.map.rewardMult || 1) * (DF.xpMult ? Math.sqrt(DF.xpMult) : 1);
    const ilvl = this.itemLevel(C.ilvlBonus);
    const items = [generateItem(this.rng, this.data, ilvl, { minRarity: C.minRarity, rareMult: C.rareMult * DF.rareMult, uniqueMult: C.uniqueMult * DF.uniqueMult, setMult: C.setMult })];
    if (this.rng.next() < C.specialChance) {
      items.push(generateItem(this.rng, this.data, ilvl, { rarity: this.rng.next() < 0.5 ? 'unique' : 'set' }));
    }
    for (let i = 0; i < C.extraItems; i++) items.push(generateItem(this.rng, this.data, ilvl, { minRarity: 'magic', rareMult: C.rareMult * DF.rareMult, uniqueMult: DF.uniqueMult, setMult: C.setMult }));
    const first = this.ch.mapClears?.[P.clearKey(this.diff.id, this.map.id)] ? false : true;
    if (first) items.push(generateItem(this.rng, this.data, ilvl, { minRarity: 'rare', rareMult: C.rareMult * DF.rareMult, uniqueMult: C.uniqueMult * DF.uniqueMult, setMult: C.setMult }));
    if (this.rng.next() < C.runeChance) items.push(generateRune(this.rng, this.data, ilvl));
    // Đồ Thần thoại (SSR): Ác mộng 1%, Địa ngục 3% mỗi boss, nhân vật từ cấp 60.
    const S = this.data.items.drops.ssr;
    if (S && this.ch.level >= S.minLevel && this.rng.next() < (S.chance[this.diff.id] || 0)) {
      const ssr = generateSSR(this.rng, this.data, ilvl, this.ch.classId);
      if (ssr) { items.push(ssr); this.showBanner(`Đồ Thần thoại: ${ssr.name}!`, 4); this.log.ssr = ssr.name; }
    }
    items.forEach((it, i) => {
      const a = (i / items.length) * TAU + 0.3;
      this.dropItem(chest.x + Math.cos(a) * 45, chest.y + Math.sin(a) * 45, it);
    });
    for (let i = 0; i < 3; i++) this.dropGold(chest.x + (i - 1) * 20, chest.y + 25, ilvl, C.goldMult * mult / 3);
    const shards = Math.round(this.rng.range(C.shards[0], C.shards[1]) * mult);
    this.ch.shards = (this.ch.shards || 0) + shards;
    this.chestLoot = items.map((it) => ({ name: it.name, rarity: it.rarity, rune: it.rune || null }));
    this.chestShards = shards;
    this.addText(chest.x, chest.y - 40, `+${shards} mảnh`, '#c9b6ff', 15);
    this.addFx({ kind: 'burst', x: chest.x, y: chest.y, dur: 0.8, r: 120, color: '#ffd76a' });
    this.emit({ type: 'shake', amount: 4 });
    for (const k of this.pickups) if (!k.dead && k.kind !== 'chest') k.pull = true;
    this.victory.state = 'count';
    this.victory.left = C.countdown;
    this.emit({ type: 'chest' });
  }

  // Kết thúc màn (hết đếm ngược hoặc bỏ lượt sau khi đã hạ boss): đồ chưa bay tới vẫn được nhận.
  finishVictory() {
    if (this.over) return;
    const p = this.player;
    for (const k of this.pickups) {
      if (k.dead || k.kind === 'chest' || k.skipped) continue;
      k.x = p.x; k.y = p.y; k.mag = true; k.pull = true; k.sp = 1e6;
    }
    // Một bước nhặt cuối, chạy hai lần để quyết định bộ lọc rồi mới nhặt.
    this.updatePickups(0.0001);
    this.updatePickups(0.0001);
    this.win();
  }

  // Cấp đồ rơi: cấp bản đồ + số phút đã chơi + thưởng theo loại quái.
  itemLevel(bonus = 0) {
    // Đồ rơi theo cấp nhân vật (lên cấp giữa màn thì đồ rơi mạnh lên ngay), cộng thưởng theo loại quái:
    // tinh anh +2, trùm nhỏ +3, boss +5, rương +6. Yêu cầu cấp = cấp đồ − 10 nên luôn mặc được.
    return this.ch.level + bonus;
  }

  dropLoot(e, kind) {
    const D = this.data.items.drops;
    const cfg = D[kind];
    if (!cfg) return;
    const DF = this.diff;
    if (this.rng.next() < (cfg.runeChance || 0)) this.dropItem(e.x - 10, e.y + 6, generateRune(this.rng, this.data, this.itemLevel(cfg.ilvlBonus || 0)));
    if (kind === 'normal') {
      if (this.rng.next() < cfg.itemChance) this.dropItem(e.x, e.y, generateItem(this.rng, this.data, this.itemLevel(), { rareMult: DF.rareMult, uniqueMult: DF.uniqueMult }));
      if (this.rng.next() < cfg.goldChance) this.dropGold(e.x, e.y, this.itemLevel());
      return;
    }
    const ilvl = this.itemLevel(cfg.ilvlBonus);
    for (let i = 0; i < cfg.items; i++) {
      const minRarity = i === 0 && cfg.firstMinRarity ? cfg.firstMinRarity : cfg.minRarity;
      const it = generateItem(this.rng, this.data, ilvl, { minRarity, rareMult: cfg.rareMult * DF.rareMult, uniqueMult: cfg.uniqueMult * DF.uniqueMult, setMult: cfg.setMult || 1 });
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
        if (pr.addSk) this._addSk = pr.addSk; // rìu ném: nhận sát thương nguyên tố của vũ khí cận chiến
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
        this.zones.push({ kind: 'area', look: 'burn', x: pd.x, y: pd.y, r: pd.r, t: 0, dur: sk.burnDuration, tickT: sk.burnTick, tick: sk.burnTick, dps: P.lv(sk.burnDps, pd.lvl) + P.dpsFlat(sk, this.stats, 'burnFlatScale'), skill: sk, element: sk.element });
        this.addFx({ kind: 'burst', x: pd.x, y: pd.y, dur: 0.4, r: pd.r, color: '#ff7a2a' });
        this.emit({ type: 'shake', amount: 4 });
        break;
      }
      case 'inferno':
        this.areaDamage(pd.x, pd.y, pd.r, () => pd.dmg, pd.element || 'fire', { noCrit: true });
        this.addFx({ kind: 'burst', x: pd.x, y: pd.y, dur: 0.35, r: pd.r, color: pd.element === 'physical' ? '#c0392b' : '#ffd23f' });
        break;
      case 'eliteBlast':
        if (Math.hypot(p.x - pd.x, p.y - pd.y) < pd.r + p.r) this.hurtPlayer(pd.dmg, 'fire', `Nổ: ${pd.name}`);
        this.addFx({ kind: 'burst', x: pd.x, y: pd.y, dur: 0.35, r: pd.r, color: '#ff3b1f' });
        break;
      case 'dive':
        this.resolveDive(pd);
        break;
      case 'pool':
        this.zones.push({ kind: 'poison', x: pd.x, y: pd.y, r: pd.r, t: 0, dur: pd.duration, tickT: pd.tick, tick: pd.tick, dps: pd.dps });
        break;
      case 'tomb': // bia mộ của trùm nhỏ rơi xuống
        if (Math.hypot(p.x - pd.x, p.y - pd.y) < pd.r + p.r) this.hurtPlayer(pd.dmg, 'physical', `${pd.name} (Bia mộ)`, { boss: true });
        this.addFx({ kind: 'burst', x: pd.x, y: pd.y, dur: 0.3, r: pd.r, color: '#9a9a9a' });
        this.emit({ type: 'shake', amount: 2 });
        break;
      case 'erupt': { // trùm nhỏ trồi lên dưới chân người chơi
        const e = pd.src;
        if (e && !e.dead) { e.x = pd.x; e.y = pd.y; e.burrowed = false; }
        if (Math.hypot(p.x - pd.x, p.y - pd.y) < pd.r + p.r) this.hurtPlayer(pd.dmg, 'physical', `${pd.name} (Độn thổ)`, { boss: true });
        this.addFx({ kind: 'burst', x: pd.x, y: pd.y, dur: 0.45, r: pd.r, color: '#8a6a45' });
        this.emit({ type: 'shake', amount: 5 });
        break;
      }
      case 'volley': { // một loạt đạn độc hình quạt của boss
        const e = pd.src;
        if (!e || e.dead) break;
        const sp = pd.def;
        const a0 = Math.atan2(p.y - e.y, p.x - e.x);
        const spread = (sp.spreadDeg * Math.PI) / 180;
        for (let i = 0; i < sp.count; i++) {
          const a = a0 + (sp.count > 1 ? (i / (sp.count - 1) - 0.5) * spread : 0);
          this.shots.push({ x: e.x, y: e.y, vx: Math.cos(a) * sp.speed, vy: Math.sin(a) * sp.speed, r: sp.radius, dmg: pd.dmg, life: sp.range / sp.speed, name: `${e.name} (Phun độc)`, type: 'poison', boss: true, look: 'venom', dead: false });
        }
        break;
      }
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
      } else if (z.kind === 'mudwave') {
        // Sóng bùn loang ra từ boss, có một khe hở; trúng thì mất máu và bị chậm (mỗi sóng trúng tối đa 1 lần).
        z.r = z.r0 + (z.maxR - z.r0) * Math.min(1, z.t / z.dur);
        const dx = p.x - z.x, dy = p.y - z.y;
        const dist = Math.hypot(dx, dy);
        if (!z.hit && Math.abs(dist - z.r) < z.width / 2 + p.r) {
          let da = Math.atan2(dy, dx) - z.gapA;
          while (da > Math.PI) da -= TAU;
          while (da < -Math.PI) da += TAU;
          if (Math.abs(da) > z.gapHalf) {
            z.hit = true;
            if (this.hurtPlayer(z.dmg, 'physical', z.name, { boss: true })) { p.slowT = z.slowDur; p.slowPct = z.slowPct; }
          }
        }
      } else if (z.kind === 'swarm') {
        this.updateSwarmZone(z, dt);
      } else if (z.kind === 'poison') {
        z.tickT -= dt;
        if (z.tickT <= 0) {
          z.tickT += z.tick;
          if (Math.hypot(p.x - z.x, p.y - z.y) < z.r + p.r * 0.5) {
            this.hurtPlayer(z.dps * z.tick * (this.enraged ? this.data.monsters.swamp_lord.enrageDmgMult : 1), 'poison', 'Vũng độc', { dot: true, boss: true });
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
      // Mục tiêu: người chơi hoặc vật triệu hồi gần nhất (gấu khiêu khích). d = khoảng cách tới người chơi.
      const tg = this.minions.length ? this.enemyTarget(e) : p;
      let dx = p.x - e.x, dy = p.y - e.y;
      const d = Math.hypot(dx, dy) || 0.001;
      let ux = dx / d, uy = dy / d;
      if (tg !== p) {
        const tx = tg.x - e.x, ty = tg.y - e.y;
        const td = Math.hypot(tx, ty) || 0.001;
        ux = tx / td; uy = ty / td;
      }
      let vx = 0, vy = 0;

      if (e.flee && e !== this.boss) {
        e.fleeT += dt;
        vx = -ux * spd * 1.6; vy = -uy * spd * 1.6;
        if (d > 950 || e.fleeT > 6) { e.dead = true; if (!e.big) this.aliveNormal--; if (e === this.miniboss) this.miniboss = null; continue; }
      } else if (e.fearT > 0) {
        // Hoảng sợ (Gầm Chiến): chạy ra xa, không tấn công.
        e.fearT -= dt;
        vx = -ux * spd * 1.2; vy = -uy * spd * 1.2;
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
          case 'miniboss': {
            const v = this.updateMiniboss(e, dt, ux, uy, d, spd);
            vx = v[0]; vy = v[1];
            break;
          }
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

      // Chạm vật triệu hồi đang bị nhắm (mỗi quái đánh tối đa 1 lần / hitCooldown giây).
      if (tg !== p && !e.flee && !(e.fearT > 0)) {
        e.mhitT = (e.mhitT || 0) - dt;
        const cx = tg.x - e.x, cy = tg.y - e.y;
        const rr = e.r + tg.r + 2;
        if (e.mhitT <= 0 && cx * cx + cy * cy < rr * rr) {
          e.mhitT = this.cfg.summons?.hitCooldown ?? 0.4;
          this.hurtMinion(tg, e.contact, e.dmgType, e);
        }
      }
      // Chạm người chơi.
      if (!e.flee && !(e.fearT > 0) && !e.burrowed) {
        const cx = p.x - e.x, cy = p.y - e.y;
        const rr = e.r + p.r;
        if (cx * cx + cy * cy < rr * rr) {
          const mult = e === this.boss && this.enraged ? e.def.enrageDmgMult : 1;
          if (this.hurtPlayer(e.contact * mult, e.dmgType, e.name, { boss: e.big })) this.onEnemyHitPlayer(e);
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

  // ---------- Trùm nhỏ: Kẻ Đào Mộ ----------
  // Đuổi theo người chơi, gọi xác sống theo nhịp riêng, cứ attackInterval giây ra một chiêu: Vung xẻng → Ném bia mộ → Độn thổ.
  updateMiniboss(e, dt, ux, uy, d, spd) {
    const def = e.def;
    const p = this.player;
    const mb = e.mb || (e.mb = { state: 'chase', atkT: def.attackInterval * 0.6, next: 0, t: 0, phase2: false });
    if (!mb.phase2 && def.phase2 && e.hp < e.maxHp * def.phase2.hpPct) {
      mb.phase2 = true;
      this.showBanner(`${e.name} nổi giận!`, 2);
    }
    // Gọi xác (dưới 50% máu: nhanh hơn, trộn kẻ ném xương).
    if (!e.burrowed) {
      e.summonT -= dt;
      if (e.summonT <= 0) {
        e.summonT = mb.phase2 ? def.phase2.summonInterval : def.summonInterval;
        const types = mb.phase2 ? def.phase2.summonTypes : [def.summonType];
        for (let i = 0; i < def.summonCount; i++) {
          const a = (i / def.summonCount) * TAU;
          const pt = this.pushOutObstacles(clamp(e.x + Math.cos(a) * 60, 20, this.W - 20), clamp(e.y + Math.sin(a) * 60, 20, this.H - 20), 13);
          this.spawnEnemy(types[i % types.length], pt.x, pt.y);
        }
        this.addFx({ kind: 'burst', x: e.x, y: e.y, dur: 0.5, r: 70, color: '#a58a5a' });
      }
    }
    const nextAtk = () => { mb.state = 'chase'; mb.atkT = def.attackInterval * (mb.phase2 ? def.phase2.atkMult : 1); };
    switch (mb.state) {
      case 'chase': {
        mb.atkT -= dt;
        if (mb.atkT > 0 || !def.sweep) return [ux * spd, uy * spd];
        const order = ['sweep', 'tombs', 'burrow'];
        let skill = order[mb.next % 3];
        mb.next++;
        // Vung xẻng chỉ dùng khi người chơi ở gần; ở xa thì chuyển sang ném bia mộ.
        if (skill === 'sweep' && d > def.sweep.trigger) skill = 'tombs';
        if (skill === 'sweep') {
          mb.state = 'sweepTele'; mb.t = def.sweep.telegraph; mb.ang = Math.atan2(p.y - e.y, p.x - e.x);
        } else if (skill === 'tombs') {
          const T = def.tombs;
          for (let i = 0; i < T.count; i++) {
            const ox = i === 0 ? 0 : this.rng.range(-T.spread, T.spread), oy = i === 0 ? 0 : this.rng.range(-T.spread, T.spread);
            this.pending.push({ kind: 'tomb', t: T.delay + i * 0.1, dur: T.delay + i * 0.1, x: clamp(p.x + ox, 20, this.W - 20), y: clamp(p.y + oy, 20, this.H - 20), r: T.radius, dmg: T.damage * e.dmgMult, name: e.name });
          }
          mb.state = 'cast'; mb.t = 0.5;
        } else {
          mb.state = 'burrow'; mb.t = def.burrow.hide;
          e.burrowed = true;
          this.addFx({ kind: 'burst', x: e.x, y: e.y, dur: 0.4, r: 60, color: '#8a6a45' });
        }
        return [0, 0];
      }
      case 'sweepTele':
        mb.t -= dt;
        if (mb.t <= 0) {
          const S = def.sweep;
          const dx = p.x - e.x, dy = p.y - e.y;
          let da = Math.atan2(dy, dx) - mb.ang;
          while (da > Math.PI) da -= TAU;
          while (da < -Math.PI) da += TAU;
          if (Math.hypot(dx, dy) < S.range + e.r + p.r && Math.abs(da) <= Math.PI / 2) {
            if (this.hurtPlayer(S.damage * e.dmgMult, 'physical', `${e.name} (Vung xẻng)`, { boss: true })) {
              const dd = Math.hypot(dx, dy) || 1;
              const o = this.pushOutObstacles(clamp(p.x + (dx / dd) * S.knockback * 0.25, p.r, this.W - p.r), clamp(p.y + (dy / dd) * S.knockback * 0.25, p.r, this.H - p.r), p.r);
              p.x = o.x; p.y = o.y;
            }
          }
          this.addFx({ kind: 'slash', x: e.x, y: e.y, a: mb.ang, half: Math.PI / 2, r: S.range + e.r, dur: 0.25, color: '#c8a070' });
          mb.state = 'cast'; mb.t = 0.3;
        }
        return [0, 0];
      case 'burrow':
        mb.t -= dt;
        if (mb.t <= 0) {
          const B = def.burrow;
          this.pending.push({ kind: 'erupt', t: B.telegraph, dur: B.telegraph, x: p.x, y: p.y, r: B.radius, dmg: B.damage * e.dmgMult, name: e.name, src: e });
          mb.state = 'emerge'; mb.t = B.telegraph + 0.1;
        }
        return [0, 0];
      case 'emerge':
        mb.t -= dt;
        if (mb.t <= 0) { e.burrowed = false; nextAtk(); }
        return [0, 0];
      case 'cast':
        mb.t -= dt;
        if (mb.t <= 0) nextAtk();
        return [0, 0];
    }
    return [0, 0];
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
    // Dưới 25% máu: Bão đầm lầy, vũng độc rơi ngẫu nhiên quanh boss.
    if (def.phase3 && e.hp < e.maxHp * def.phase3.hpPct) {
      if (!b.phase3) { b.phase3 = true; b.stormT = 0; this.showBanner(`${e.name}: Bão đầm lầy!`, 2.5); }
      b.stormT -= dt;
      if (b.stormT <= 0) {
        b.stormT = def.phase3.stormInterval;
        const pl = def.pools, S = def.phase3;
        for (let i = 0; i < S.stormCount; i++) {
          const x = clamp(e.x + this.rng.range(-S.stormSpread, S.stormSpread), 20, this.W - 20), y = clamp(e.y + this.rng.range(-S.stormSpread, S.stormSpread), 20, this.H - 20);
          this.pending.push({ kind: 'pool', t: pl.landDelay + i * 0.15, dur: pl.landDelay + i * 0.15, x, y, r: pl.radius, duration: pl.duration, tick: pl.tick, dps: pl.dps * e.dmgMult });
        }
      }
    }
    switch (b.state) {
      case 'chase':
        b.atkT -= dt;
        if (b.atkT <= 0) {
          // Vồ → Vũng độc → Phun độc → Sóng bùn (chiêu chưa có số liệu thì bỏ qua).
          const order = ['slam', 'pools', 'spit', 'wave'].filter((k) => def[k]);
          const k = order.includes(b.next) ? b.next : 'slam';
          b.next = order[(order.indexOf(k) + 1) % order.length];
          if (k === 'slam') {
            b.state = 'tele'; b.t = b.teleDur = def.slam.telegraph;
            b.sx = e.x; b.sy = e.y; b.tx = p.x; b.ty = p.y;
            b.second = false;
          } else if (k === 'pools') {
            b.state = 'cast'; b.t = def.pools.castTime;
            const pl = def.pools;
            for (let i = 0; i < pl.count; i++) {
              const ox = i === 0 ? 0 : this.rng.range(-pl.spread, pl.spread);
              const oy = i === 0 ? 0 : this.rng.range(-pl.spread, pl.spread);
              this.pending.push({ kind: 'pool', t: pl.landDelay + i * 0.12, dur: pl.landDelay + i * 0.12, x: clamp(p.x + ox, 20, this.W - 20), y: clamp(p.y + oy, 20, this.H - 20), r: pl.radius, duration: pl.duration, tick: pl.tick, dps: pl.dps * e.dmgMult });
            }
          } else if (k === 'spit') {
            const sp = def.spit;
            b.state = 'cast'; b.t = sp.castTime + sp.volleys * sp.volleyGap;
            b.spitT = sp.castTime; // ngửa đầu báo trước
            for (let i = 0; i < sp.volleys; i++) this.pending.push({ kind: 'volley', t: sp.castTime + i * sp.volleyGap, dur: sp.castTime, x: e.x, y: e.y, r: 0, src: e, def: sp, dmg: sp.damage * e.dmgMult * enr });
          } else {
            b.state = 'waveTele'; b.t = def.wave.telegraph;
          }
          return [0, 0];
        }
        return [ux * spd, uy * spd];
      case 'waveTele':
        b.t -= dt;
        if (b.t <= 0) {
          const W = def.wave;
          this.zones.push({ kind: 'mudwave', x: e.x, y: e.y, r0: e.r, r: e.r, maxR: W.maxRadius, t: 0, dur: W.duration, width: W.width, gapA: this.rng.next() * TAU, gapHalf: ((W.gapDeg * Math.PI) / 180) / 2, dmg: W.damage * e.dmgMult * enr, slowPct: W.slowPct, slowDur: W.slowDur, name: `${e.name} (Sóng bùn)`, hit: false });
          this.emit({ type: 'shake', amount: 4 });
          b.state = 'recover'; b.t = 0.4;
        }
        return [0, 0];
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
          this.hurtPlayer(def.slam.damage * e.dmgMult * enr, 'physical', `${e.name} (Vồ)`, { boss: true });
        }
        if (b.dist <= 0) {
          // Giai đoạn 2: Vồ đôi, lao thêm lần nữa vào vị trí mới của người chơi.
          if (b.phase2 && def.phase2.doubleSlam && !b.second) {
            b.second = true;
            b.state = 'tele'; b.t = b.teleDur = def.phase2.doubleTelegraph;
            b.sx = e.x; b.sy = e.y; b.tx = p.x; b.ty = p.y;
            this.addFx({ kind: 'burst', x: e.x, y: e.y, dur: 0.3, r: 70, color: '#c23b3b' });
            return [0, 0];
          }
          b.state = 'recover'; b.t = def.slam.recover;
          this.emit({ type: 'shake', amount: 6 });
          this.addFx({ kind: 'burst', x: e.x, y: e.y, dur: 0.4, r: 90, color: '#c23b3b' });
        }
        return [b.dx * def.slam.dashSpeed, b.dy * def.slam.dashSpeed];
      }
      case 'cast':
      case 'recover':
        b.t -= dt;
        if (b.spitT > 0) b.spitT -= dt;
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
        if (this.hurtPlayer(s.dmg, s.type || 'physical', s.name, { boss: !!s.boss }) && s.src) this.onEnemyHitPlayer(s.src);
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
      if (k.kind === 'chest') {
        if (!k.opened && d < pr * 0.6 + 30) this.openChest(k);
        continue;
      }
      if (!k.mag && (d < pr || k.pull)) {
        if (k.kind === 'item') {
          // Bộ lọc nhặt đồ: bỏ qua hoặc bán ngay.
          if (!k.decision) k.decision = lootDecision(k.item, this.ch);
          if (k.decision === 'skip') { k.skipped = true; continue; }
          if (k.decision !== 'sell' && !k.pull && !canAdd(this.ch, k.item)) {
            const freed = makeRoomFor(this.ch, k.item, this.data);
            if (freed) this.addText(p.x, p.y - 60, `Tự bán ${freed.item.name} (+${freed.gold} vàng)`, '#ffd76a', 12);
            else {
              if (this.time > this.invFullT) { this.invFullT = this.time + 3; this.addText(p.x, p.y - 44, 'Kho đồ đầy!', '#ff9a8a', 14); }
              continue;
            }
          }
        }
        k.mag = true; k.sp = k.pull ? 300 : 120;
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
          if (k.decision === 'sell') {
            const v = sellValue(k.item, this.data);
            this.ch.gold += v;
            this.log.gold += v;
            this.log.autoSold = (this.log.autoSold || 0) + 1;
            this.addText(p.x, p.y - 30, `Bán ${k.item.name} +${v} vàng`, '#ffd76a', 12);
            continue;
          }
          if (!addToInventory(this.ch, k.item)) {
            const freed = makeRoomFor(this.ch, k.item, this.data);
            if (!(freed && addToInventory(this.ch, k.item))) {
              // Sau khi hạ boss: kho đầy thì cho vào túi tạm, chọn giữ / bán ở bảng kết quả.
              if (k.pull) { (this.overflow ||= []).push(k.item); this.addText(p.x, p.y - 48, `${k.item.name} → túi tạm`, '#ffb070', 13); continue; }
              k.dead = false; k.mag = false; continue;
            }
          }
          const col = k.item.type === 'rune' ? this.data.runes.byId[k.item.rune].color : this.data.items.rarities[k.item.rarity].color;
          this.log.itemsPicked.push({ rarity: k.item.rarity, name: k.item.name, ilvl: k.item.ilvl, t: Math.round(this.time) });
          this.addText(p.x, p.y - 48, k.item.name, col, 15);
          this.emit({ type: 'item', item: k.item });
        }
        else if (k.kind === 'hp') {
          p.hp = Math.min(this.stats.maxHp, p.hp + drops.hpPotion.heal);
          this.log.potions.hp++;
          this.addText(p.x, p.y - 30, `+${drops.hpPotion.heal} máu`, '#ff6b6b', 14);
        } else if (k.kind === 'mana') {
          p.mana = Math.min(this.stats.maxMana, p.mana + drops.manaPotion.restore);
          this.log.potions.mana++;
          this.addText(p.x, p.y - 30, `+${drops.manaPotion.restore} mana`, '#6fa8ff', 14);
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

Object.assign(Game.prototype, MinionMixin);

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
