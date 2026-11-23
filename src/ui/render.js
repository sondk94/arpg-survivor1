// Vẽ thế giới và HUD bằng Canvas 2D, hình khối đơn giản.
import { fmtTime } from '../core/game.js';
import { xpToNext } from '../core/progression.js';
import { buildSprites, drawMage, drawWarrior, drawGravedigger, drawSwampLord } from './sprites.js';

const TAU = Math.PI * 2;
const VIS = 1.3; // hình vẽ quái to hơn vùng va chạm một chút cho dễ nhìn

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.shake = 0;
    this.resize();
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.dpr = dpr;
    this.w = window.innerWidth;
    this.h = window.innerHeight;
    this.canvas.width = Math.round(this.w * dpr);
    this.canvas.height = Math.round(this.h * dpr);
    this.canvas.style.width = this.w + 'px';
    this.canvas.style.height = this.h + 'px';
  }

  draw(g, ui) {
    const ctx = this.ctx;
    const { w, h } = this;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = '#121410';
    ctx.fillRect(0, 0, w, h);
    if (!g) return;
    const p = g.player;
    let sx = 0, sy = 0;
    if (this.shake > 0) {
      sx = (Math.random() - 0.5) * this.shake * 2;
      sy = (Math.random() - 0.5) * this.shake * 2;
      this.shake = Math.max(0, this.shake - 0.6);
    }
    const camX = Math.round(p.x - w / 2 + sx), camY = Math.round(p.y - h / 2 + sy);
    this.view = { x0: camX - 60, y0: camY - 60, x1: camX + w + 60, y1: camY + h + 60 };
    ctx.save();
    ctx.translate(-camX, -camY);
    this.drawGround(g, camX, camY);
    this.drawObstacles(g, false);
    this.drawZones(g);
    this.drawPending(g);
    this.drawPickups(g);
    this.drawAura(g);
    this.drawEnemies(g);
    this.drawObstacles(g, true);
    this.drawProjectiles(g);
    this.drawPlayer(g);
    this.drawFx(g);
    this.drawTexts(g);
    this.drawBossOverhead(g);
    ctx.restore();
    this.drawOffscreenMarkers(g, camX, camY);
    this.drawHud(g, ui);
  }

  vis(x, y, r = 0) {
    const v = this.view;
    return x + r > v.x0 && x - r < v.x1 && y + r > v.y0 && y - r < v.y1;
  }

  drawGround(g, camX, camY) {
    const ctx = this.ctx;
    ctx.fillStyle = g.map.theme?.ground || '#23261c';
    ctx.fillRect(0, 0, g.W, g.H);
    ctx.strokeStyle = 'rgba(255,255,255,0.035)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    const step = 100;
    const x0 = Math.max(0, Math.floor(camX / step) * step), x1 = Math.min(g.W, camX + this.w + step);
    const y0 = Math.max(0, Math.floor(camY / step) * step), y1 = Math.min(g.H, camY + this.h + step);
    for (let x = x0; x <= x1; x += step) { ctx.moveTo(x, y0); ctx.lineTo(x, y1); }
    for (let y = y0; y <= y1; y += step) { ctx.moveTo(x0, y); ctx.lineTo(x1, y); }
    ctx.stroke();
    ctx.strokeStyle = '#5a2b2b';
    ctx.lineWidth = 6;
    ctx.strokeRect(0, 0, g.W, g.H);
  }

  drawObstacles(g, tall) {
    const ctx = this.ctx;
    for (const o of g.obstacles) {
      if (!this.vis(o.x, o.y, o.r + 30)) continue;
      if (o.kind === 'swamp' && !tall) {
        ctx.fillStyle = '#1f3a33';
        ctx.beginPath();
        ctx.ellipse(o.x, o.y, o.r, o.r * 0.92, o.seed * 3, 0, TAU);
        ctx.fill();
        ctx.strokeStyle = '#2f5246';
        ctx.lineWidth = 3;
        ctx.stroke();
      } else if (o.kind === 'grave' && !tall) {
        ctx.fillStyle = '#6d6f76';
        const ww = o.r * 1.5, hh = o.r * 1.9;
        ctx.beginPath();
        ctx.roundRect(o.x - ww / 2, o.y - hh / 2, ww, hh, [ww / 2, ww / 2, 2, 2]);
        ctx.fill();
        ctx.fillStyle = '#55575d';
        ctx.fillRect(o.x - 1.5, o.y - hh / 4, 3, hh / 2);
        ctx.fillRect(o.x - ww / 4, o.y - hh / 8, ww / 2, 3);
      } else if (o.kind === 'tree') {
        if (!tall) {
          ctx.fillStyle = '#3a2a1e';
          ctx.beginPath();
          ctx.arc(o.x, o.y, o.r * 0.55, 0, TAU);
          ctx.fill();
        } else {
          ctx.strokeStyle = 'rgba(70,52,38,0.85)';
          ctx.lineWidth = 3;
          ctx.beginPath();
          for (let i = 0; i < 5; i++) {
            const a = o.seed * 10 + i * 1.3;
            ctx.moveTo(o.x, o.y);
            ctx.lineTo(o.x + Math.cos(a) * o.r * 1.4, o.y + Math.sin(a) * o.r * 1.4);
          }
          ctx.stroke();
        }
      }
    }
  }

  drawZones(g) {
    const ctx = this.ctx;
    for (const z of g.zones) {
      const fade = Math.min(1, (z.dur - z.t) / 0.4);
      if (z.kind === 'area' && z.look === 'blizzard') {
        ctx.fillStyle = `rgba(150,210,255,${0.18 * fade})`;
        ctx.beginPath(); ctx.arc(z.x, z.y, z.r, 0, TAU); ctx.fill();
        ctx.strokeStyle = `rgba(200,240,255,${0.5 * fade})`;
        ctx.lineWidth = 2; ctx.stroke();
        // mảnh băng rơi
        ctx.strokeStyle = `rgba(235,250,255,${0.85 * fade})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let i = 0; i < 14; i++) {
          const a = i * 2.39996 + z.x * 0.01;
          const rr = z.r * Math.sqrt(((i * 0.618 + z.t * 1.7) % 1));
          const fx = z.x + Math.cos(a) * rr, fy = z.y + Math.sin(a) * rr;
          const k = (z.t * 3 + i * 0.37) % 1;
          ctx.moveTo(fx - 6, fy - 22 + k * 22); ctx.lineTo(fx, fy - 10 + k * 22);
        }
        ctx.stroke();
      } else if (z.kind === 'area') {
        ctx.fillStyle = `rgba(255,110,30,${0.22 * fade})`;
        ctx.beginPath(); ctx.arc(z.x, z.y, z.r, 0, TAU); ctx.fill();
        ctx.strokeStyle = `rgba(255,160,60,${0.5 * fade})`;
        ctx.lineWidth = 2; ctx.stroke();
      } else if (z.kind === 'poison') {
        ctx.fillStyle = `rgba(110,200,60,${0.3 * fade})`;
        ctx.beginPath(); ctx.arc(z.x, z.y, z.r, 0, TAU); ctx.fill();
        ctx.strokeStyle = `rgba(160,255,90,${0.6 * fade})`;
        ctx.lineWidth = 2; ctx.stroke();
      } else if (z.kind === 'firewall') {
        ctx.lineCap = 'round';
        ctx.strokeStyle = `rgba(255,90,20,${0.45 * fade})`;
        ctx.lineWidth = z.half * 2 + 10;
        ctx.beginPath(); ctx.moveTo(z.x1, z.y1); ctx.lineTo(z.x2, z.y2); ctx.stroke();
        ctx.strokeStyle = `rgba(255,200,80,${0.9 * fade})`;
        ctx.lineWidth = z.half;
        ctx.stroke();
        ctx.lineCap = 'butt';
      }
    }
  }

  drawPending(g) {
    const ctx = this.ctx;
    for (const pd of g.pending) {
      const k = 1 - pd.t / (pd.dur || 1);
      if (pd.kind === 'meteor') {
        ctx.strokeStyle = 'rgba(255,90,40,0.8)';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(pd.x, pd.y, pd.r, 0, TAU); ctx.stroke();
        ctx.fillStyle = 'rgba(255,90,40,0.15)';
        ctx.beginPath(); ctx.arc(pd.x, pd.y, pd.r * k, 0, TAU); ctx.fill();
        // thiên thạch rơi
        const fy = pd.y - 260 * (1 - k), fx = pd.x + 120 * (1 - k);
        ctx.fillStyle = '#ff9a3c';
        ctx.beginPath(); ctx.arc(fx, fy, 14, 0, TAU); ctx.fill();
      } else if (pd.kind === 'pool') {
        ctx.strokeStyle = 'rgba(150,255,90,0.8)';
        ctx.setLineDash([6, 6]);
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(pd.x, pd.y, pd.r, 0, TAU); ctx.stroke();
        ctx.setLineDash([]);
      } else if (pd.kind === 'eliteBlast') {
        ctx.strokeStyle = 'rgba(255,60,30,0.9)';
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(pd.x, pd.y, pd.r * (0.4 + 0.6 * k), 0, TAU); ctx.stroke();
      }
    }
  }

  drawPickups(g) {
    const ctx = this.ctx;
    ctx.fillStyle = '#5fe0ff';
    ctx.beginPath();
    for (const k of g.pickups) {
      if (k.kind !== 'xp' || !this.vis(k.x, k.y, 8)) continue;
      const s = k.value >= 20 ? 7 : k.value >= 5 ? 5.5 : 4;
      ctx.moveTo(k.x, k.y - s); ctx.lineTo(k.x + s * 0.75, k.y); ctx.lineTo(k.x, k.y + s); ctx.lineTo(k.x - s * 0.75, k.y); ctx.closePath();
    }
    ctx.fill();
    ctx.textAlign = 'center';
    for (const k of g.pickups) {
      if (k.kind === 'item') {
        if (!this.vis(k.x, k.y, 60)) continue;
        const col = k.item.type === 'rune' ? g.data.runes.byId[k.item.rune].color : g.data.items.rarities[k.item.rarity].color;
        if (k.item.rarity === 'rare' || k.item.rarity === 'unique' || k.item.rarity === 'set' || k.item.type === 'rune') {
          const grd = ctx.createLinearGradient(0, k.y - 70, 0, k.y);
          grd.addColorStop(0, 'rgba(0,0,0,0)');
          grd.addColorStop(1, col);
          ctx.globalAlpha = 0.45;
          ctx.fillStyle = grd;
          ctx.fillRect(k.x - 3, k.y - 70, 6, 70);
          ctx.globalAlpha = 1;
        }
        ctx.fillStyle = '#1a1712';
        ctx.fillRect(k.x - 7, k.y - 7, 14, 14);
        ctx.strokeStyle = col;
        ctx.lineWidth = 2;
        ctx.strokeRect(k.x - 7, k.y - 7, 14, 14);
        if (k.item.rarity !== 'normal') {
          ctx.font = '600 11px system-ui, sans-serif';
          ctx.fillStyle = 'rgba(0,0,0,0.65)';
          const tw = ctx.measureText(k.item.name).width + 8;
          ctx.fillRect(k.x - tw / 2, k.y - 24, tw, 14);
          ctx.fillStyle = col;
          ctx.fillText(k.item.name, k.x, k.y - 13);
        }
        continue;
      }
      if (k.kind === 'gold') {
        if (!this.vis(k.x, k.y, 10)) continue;
        ctx.fillStyle = '#f2c94c';
        ctx.beginPath(); ctx.arc(k.x - 3, k.y + 1, 4, 0, TAU); ctx.arc(k.x + 3, k.y - 1, 4, 0, TAU); ctx.fill();
        ctx.strokeStyle = '#8a6a1a'; ctx.lineWidth = 1; ctx.stroke();
        continue;
      }
      if (k.kind === 'xp' || !this.vis(k.x, k.y, 10)) continue;
      ctx.fillStyle = k.kind === 'hp' ? '#e03b3b' : '#3b6fe0';
      ctx.beginPath(); ctx.arc(k.x, k.y + 2, 7, 0, TAU); ctx.fill();
      ctx.fillRect(k.x - 3, k.y - 9, 6, 6);
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(k.x, k.y + 2, 7, 0, TAU); ctx.stroke();
    }
  }

  drawAura(g) {
    const ctx = this.ctx;
    const p = g.player;
    for (const id of g.ch.slots) {
      if (!id) continue;
      const sk = g.data.skills[id];
      const lvl = g.lvl(id);
      if (sk.kind !== 'aura' || !lvl) continue;
      const st = g.skillState[id];
      const r = sk.radius.base + sk.radius.perLevel * (lvl - 1);
      const pulse = 0.5 + 0.5 * Math.sin(g.time * 8);
      if (sk.element === 'physical') {
        // Lốc Xoáy: các vệt chém xoay quanh người
        if (!st.active) continue;
        ctx.strokeStyle = 'rgba(230,230,235,0.55)';
        ctx.lineWidth = 3;
        for (let i = 0; i < 3; i++) {
          const a = g.time * 14 + (i * TAU) / 3;
          ctx.beginPath(); ctx.arc(p.x, p.y, r * (0.7 + 0.1 * i), a, a + 1.2); ctx.stroke();
        }
        continue;
      }
      ctx.fillStyle = st.active ? `rgba(255,120,40,${0.08 + 0.04 * pulse})` : 'rgba(120,120,120,0.05)';
      ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, TAU); ctx.fill();
      ctx.strokeStyle = st.active ? `rgba(255,150,60,${0.5 + 0.3 * pulse})` : 'rgba(150,150,150,0.35)';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

  drawEnemies(g) {
    const ctx = this.ctx;
    const ppu = VIS * this.dpr;
    if (!this.sprites || this.sprites.pxPerUnit !== ppu) this.sprites = buildSprites(g.data.monsters, ppu);
    const dpr = this.dpr;
    const p = g.player;
    const vis = [];
    for (const e of g.enemies) {
      if (e.dead || !this.vis(e.x, e.y, e.r * 2.5)) continue;
      vis.push(e);
    }
    // Vẽ từ trên xuống dưới để con đứng trước che con đứng sau.
    vis.sort((a, b) => a.y - b.y);
    // Bóng dưới chân (một lần vẽ cho tất cả).
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.beginPath();
    for (const e of vis) {
      const fy = e.flying ? e.y + e.r * 1.9 : e.y + e.r * 1.08 * VIS;
      const rx = e.r * (e.flying ? 0.8 : 0.75 * VIS);
      ctx.moveTo(e.x + rx, fy);
      ctx.ellipse(e.x, fy, rx, rx * 0.3, 0, 0, TAU);
    }
    ctx.fill();
    for (const e of vis) {
      if (e.big) { this.drawSpecial(g, e); continue; }
      if (e.elite) this.drawEliteMark(e);
      const face = e.flee ? (e.x > p.x ? 1 : -1) : (p.x >= e.x ? 1 : -1);
      const tint = e.hit > 0 ? 'hit' : e.frozenT > 0 ? 'frozen' : e.slowT > 0 && e.slowPct >= 0.25 ? 'slow' : 'normal';
      let frame = 0;
      if (!(e.frozenT > 0)) {
        const fps = e.flying ? 16 : Math.max(5, (e.speed * (1 - e.slowPct)) / (e.def.radius * 2.6) * 8);
        frame = Math.floor(e.t * fps + e.phase * 4) % 8;
      }
      const sp = this.sprites.get(e.type, tint, frame, face < 0);
      const k = e.r / sp.r; // tinh anh to hơn: co giãn (ít con nên không tốn)
      if (k === 1) {
        // Sao chép 1:1 đúng lưới điểm ảnh: nhanh nhất.
        const x = Math.round((e.x + sp.x0 * VIS) * dpr) / dpr, y = Math.round((e.y + sp.y0 * VIS) * dpr) / dpr;
        ctx.drawImage(sp.img, x, y, sp.w * VIS, sp.h * VIS);
      } else {
        ctx.drawImage(sp.img, e.x + sp.x0 * VIS * k, e.y + sp.y0 * VIS * k, sp.w * VIS * k, sp.h * VIS * k);
      }
      if (e.elite) this.drawBar(e, e.elite ? '#ffcc33' : '#e0a050', e.elite ? '#ffd966' : '#f0c890');
    }
  }

  drawEliteMark(e) {
    const ctx = this.ctx;
    const fy = e.y + e.r * 1.05 * VIS;
    const stone = e.affixes.includes('stone_skin') && e.hp > e.maxHp * 0.5;
    ctx.strokeStyle = stone ? '#c8c8d8' : '#ffcc33';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.ellipse(e.x, fy, e.r * 1.0, e.r * 0.34, 0, 0, TAU); ctx.stroke();
    if (e.affixes.includes('fire_enchanted')) {
      ctx.fillStyle = `rgba(255,80,30,${0.25 + 0.15 * Math.sin(e.t * 10)})`;
      ctx.beginPath(); ctx.ellipse(e.x, e.y, e.r * 1.25, e.r * 1.5, 0, 0, TAU); ctx.fill();
    }
  }

  drawBar(e, col, nameCol) {
    const ctx = this.ctx;
    const bw = Math.max(40, e.r * 2.4);
    const y = e.y - e.r * 1.9 * (e.big ? 1 : VIS) - 8;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(e.x - bw / 2, y, bw, 5);
    ctx.fillStyle = col;
    ctx.fillRect(e.x - bw / 2, y, bw * Math.max(0, e.hp / e.maxHp), 5);
    ctx.font = '600 11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = nameCol;
    ctx.fillText(e.name, e.x, y - 4);
  }

  drawSpecial(g, e) {
    const ctx = this.ctx;
    const p = g.player;
    const face = p.x >= e.x ? 1 : -1;
    const moving = !(e.frozenT > 0) && !(e.b && e.b.state !== 'chase' && e.b.state !== 'dash');
    const phase = moving ? (e.t * (e.b && e.b.state === 'dash' ? 3 : 1.1)) % 1 : 0;
    if (e.ai === 'boss') {
      const b = e.b;
      if (b.state === 'tele') {
        const k = 1 - b.t / e.def.slam.telegraph;
        const ang = Math.atan2(b.ty - b.sy, b.tx - b.sx);
        const len = Math.hypot(b.tx - b.sx, b.ty - b.sy) + e.r;
        ctx.save();
        ctx.translate(b.sx, b.sy);
        ctx.rotate(ang);
        ctx.fillStyle = `rgba(230,40,40,${0.15 + 0.25 * k})`;
        ctx.fillRect(0, -e.r, len, e.r * 2);
        ctx.strokeStyle = 'rgba(255,60,60,0.9)';
        ctx.lineWidth = 2;
        ctx.strokeRect(0, -e.r, len, e.r * 2);
        ctx.restore();
      }
      const bf = b.state === 'tele' || b.state === 'dash' ? (b.tx >= e.x ? 1 : -1) : face;
      drawSwampLord(ctx, e, bf, phase, { enraged: g.enraged, tint: e.hit > 0 ? '#e8f5e0' : null });
      return;
    }
    const tint = e.hit > 0 ? '#f2eadc' : e.frozenT > 0 ? '#bfe9ff' : null;
    drawGravedigger(ctx, e, face, phase, tint);
    this.drawBar(e, '#e0a050', '#f0c890');
  }

  drawBossOverhead(g) {
    const e = g.boss;
    if (!e || e.dead) return;
    const ctx = this.ctx;
    const bw = 180, y = e.y - e.r * 1.2 - 24;
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fillRect(e.x - bw / 2 - 2, y - 2, bw + 4, 12);
    ctx.fillStyle = g.enraged ? '#ff3b3b' : '#c0392b';
    ctx.fillRect(e.x - bw / 2, y, bw * Math.max(0, e.hp / e.maxHp), 8);
    ctx.font = '700 13px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffe0d0';
    ctx.fillText(`${e.name}${g.enraged ? ' (nổi điên)' : ''}`, e.x, y - 6);
  }

  drawProjectiles(g) {
    const ctx = this.ctx;
    const fire = [], ice = [], spark = [], shard = [];
    for (const pr of g.projectiles) {
      if (!this.vis(pr.x, pr.y, 20)) continue;
      if (pr.look === 'spark') spark.push(pr);
      else if (pr.look === 'shard') shard.push(pr);
      else if (pr.element === 'cold') ice.push(pr);
      else fire.push(pr);
    }
    const glow = (list, halo, core, k = 1.8) => {
      if (!list.length) return;
      ctx.fillStyle = halo;
      ctx.beginPath();
      for (const pr of list) { ctx.moveTo(pr.x + pr.r * k, pr.y); ctx.arc(pr.x, pr.y, pr.r * k, 0, TAU); }
      ctx.fill();
      ctx.fillStyle = core;
      ctx.beginPath();
      for (const pr of list) { ctx.moveTo(pr.x + pr.r, pr.y); ctx.arc(pr.x, pr.y, pr.r, 0, TAU); }
      ctx.fill();
    };
    glow(fire, 'rgba(255,120,40,0.35)', '#ffd27a');
    glow(ice, 'rgba(120,200,255,0.35)', '#e6f7ff');
    if (shard.length) {
      ctx.strokeStyle = '#dff5ff';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      for (const pr of shard) {
        const l = Math.hypot(pr.vx, pr.vy) || 1;
        ctx.moveTo(pr.x - (pr.vx / l) * 8, pr.y - (pr.vy / l) * 8); ctx.lineTo(pr.x + (pr.vx / l) * 4, pr.y + (pr.vy / l) * 4);
      }
      ctx.stroke();
    }
    if (spark.length) {
      ctx.strokeStyle = '#fff27a';
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (const pr of spark) {
        for (let i = 0; i < 3; i++) {
          const a = Math.random() * TAU;
          ctx.moveTo(pr.x, pr.y); ctx.lineTo(pr.x + Math.cos(a) * 9, pr.y + Math.sin(a) * 9);
        }
      }
      ctx.stroke();
      glow(spark, 'rgba(255,240,120,0.3)', '#ffffff', 1.6);
    }
    // Cầu Băng Xoay
    for (const o of g.orbs) {
      ctx.fillStyle = 'rgba(150,220,255,0.35)';
      ctx.beginPath(); ctx.arc(o.x, o.y, 18, 0, TAU); ctx.fill();
      ctx.fillStyle = '#f0fbff';
      ctx.beginPath(); ctx.arc(o.x, o.y, 9, 0, TAU); ctx.fill();
      ctx.strokeStyle = '#9fe3ff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let i = 0; i < 3; i++) { const a = o.ang + i * 2.09; ctx.moveTo(o.x, o.y); ctx.lineTo(o.x + Math.cos(a) * 16, o.y + Math.sin(a) * 16); }
      ctx.stroke();
    }
    ctx.fillStyle = '#efe8d0';
    ctx.strokeStyle = '#8a7f60';
    ctx.lineWidth = 1.5;
    for (const s of g.shots) {
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.rotate(g.time * 12);
      ctx.fillRect(-s.r * 1.4, -s.r * 0.4, s.r * 2.8, s.r * 0.8);
      ctx.strokeRect(-s.r * 1.4, -s.r * 0.4, s.r * 2.8, s.r * 0.8);
      ctx.restore();
    }
  }

  drawPlayer(g) {
    const ctx = this.ctx;
    const p = g.player;
    if (p.glow > 0) {
      const k = p.glow / 1.2;
      const grd = ctx.createRadialGradient(p.x, p.y, 4, p.x, p.y, 70);
      grd.addColorStop(0, `rgba(255,240,150,${0.7 * k})`);
      grd.addColorStop(1, 'rgba(255,240,150,0)');
      ctx.fillStyle = grd;
      ctx.beginPath(); ctx.arc(p.x, p.y, 70, 0, TAU); ctx.fill();
    }
    // Nhịp bước theo quãng đường đã đi, nên dừng thì đứng yên và tạm dừng game không làm chân chạy.
    if (this.lastP && this.lastG === g) {
      const d = Math.hypot(p.x - this.lastP.x, p.y - this.lastP.y);
      if (d < 50) this.walk = (this.walk + d / (p.r * 3.4)) % 1;
    } else this.walk = 0;
    this.lastP = { x: p.x, y: p.y };
    this.lastG = g;
    if (Math.abs(p.faceX) > 0.1) this.face = p.faceX > 0 ? 1 : -1;
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath(); ctx.ellipse(p.x, p.y + p.r * 1.45, p.r * 0.95, p.r * 0.3, 0, 0, TAU); ctx.fill();
    const blink = p.invuln > 0 && Math.floor(g.time * 20) % 2 === 0;
    ctx.globalAlpha = blink ? 0.45 : 1;
    if (g.cls?.look === 'warrior') drawWarrior(ctx, p.x, p.y, p.r * 1.3, this.face || 1, this.walk, p.moving, { hurt: p.hurt > 0, swing: (p.swing || 0) / 0.22 });
    else drawMage(ctx, p.x, p.y, p.r * 1.3, this.face || 1, this.walk, p.moving, { hurt: p.hurt > 0 });
    // Buff đang có: vòng sáng dưới chân
    for (const b of g.buffs || []) {
      ctx.strokeStyle = b.color || '#ffd27a';
      ctx.globalAlpha = 0.35 + 0.25 * Math.sin(g.time * 6);
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.ellipse(p.x, p.y + p.r * 1.45, p.r * 1.4, p.r * 0.45, 0, 0, TAU); ctx.stroke();
      ctx.globalAlpha = 1;
    }
    ctx.globalAlpha = 1;
  }

  drawFx(g) {
    const ctx = this.ctx;
    for (const f of g.fx) {
      const k = f.t / f.dur;
      if (f.kind === 'levelup') {
        ctx.strokeStyle = `rgba(255,235,140,${1 - k})`;
        ctx.lineWidth = 4;
        ctx.beginPath(); ctx.arc(f.x, f.y, f.r * k, 0, TAU); ctx.stroke();
      } else if (f.kind === 'burst') {
        ctx.globalAlpha = 1 - k;
        ctx.fillStyle = f.color;
        ctx.beginPath(); ctx.arc(f.x, f.y, f.r * (0.5 + 0.5 * k), 0, TAU); ctx.fill();
        ctx.globalAlpha = 1;
      } else if (f.kind === 'slash') {
        ctx.globalAlpha = 1 - k;
        ctx.strokeStyle = f.color || '#fff';
        ctx.lineWidth = 10 * (1 - k) + 2;
        ctx.lineCap = 'round';
        const a1 = f.a - f.half, a2 = f.a - f.half + 2 * f.half * Math.min(1, k * 2.5);
        ctx.beginPath(); ctx.arc(f.x, f.y, f.r * 0.85, a1, a2); ctx.stroke();
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(f.x, f.y, f.r, a1, a2); ctx.stroke();
        ctx.lineCap = 'butt';
        ctx.globalAlpha = 1;
      } else if (f.kind === 'leap') {
        ctx.globalAlpha = (1 - k) * 0.6;
        ctx.strokeStyle = '#d0c8b8';
        ctx.lineWidth = 6;
        ctx.setLineDash([10, 8]);
        const mx = (f.x1 + f.x) / 2, my = (f.y1 + f.y) / 2 - 80;
        ctx.beginPath(); ctx.moveTo(f.x1, f.y1); ctx.quadraticCurveTo(mx, my, f.x, f.y); ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
      } else if (f.kind === 'nova') {
        ctx.strokeStyle = f.color;
        ctx.globalAlpha = 1 - k;
        ctx.lineWidth = 6 * (1 - k) + 1;
        ctx.beginPath(); ctx.arc(f.x, f.y, f.r * (0.3 + 0.7 * k), 0, TAU); ctx.stroke();
        ctx.globalAlpha = 1;
      } else if (f.kind === 'bolt') {
        ctx.globalAlpha = 1 - k;
        ctx.strokeStyle = f.color;
        ctx.lineWidth = f.w || 2;
        ctx.beginPath();
        for (let i = 0; i < f.pts.length - 1; i++) {
          const [x1, y1] = f.pts[i], [x2, y2] = f.pts[i + 1];
          ctx.moveTo(x1, y1);
          const n = Math.max(2, Math.round(Math.hypot(x2 - x1, y2 - y1) / 25));
          for (let j = 1; j < n; j++) {
            const t = j / n;
            ctx.lineTo(x1 + (x2 - x1) * t + (Math.random() - 0.5) * 16, y1 + (y2 - y1) * t + (Math.random() - 0.5) * 16);
          }
          ctx.lineTo(x2, y2);
        }
        ctx.stroke();
        ctx.globalAlpha = 1;
      } else if (f.kind === 'strike') {
        ctx.globalAlpha = 1 - k;
        ctx.strokeStyle = f.color;
        ctx.lineWidth = 3;
        ctx.beginPath();
        let x = f.x + 30, y = f.y - 300;
        ctx.moveTo(x, y);
        while (y < f.y) { y += 30; x += (Math.random() - 0.5) * 30; ctx.lineTo(y >= f.y ? f.x : x, Math.min(y, f.y)); }
        ctx.stroke();
        ctx.fillStyle = 'rgba(255,250,200,0.5)';
        ctx.beginPath(); ctx.arc(f.x, f.y, 40 * (1 - k), 0, TAU); ctx.fill();
        ctx.globalAlpha = 1;
      } else if (f.kind === 'death') {
        if (!this.vis(f.x, f.y, 20)) continue;
        ctx.strokeStyle = f.color;
        ctx.globalAlpha = 1 - k;
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(f.x, f.y, f.r * (1 + k), 0, TAU); ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }
  }

  drawTexts(g) {
    const ctx = this.ctx;
    ctx.textAlign = 'center';
    for (const t of g.texts) {
      const k = t.t / 0.8;
      ctx.globalAlpha = 1 - k * k;
      ctx.font = `700 ${t.size}px system-ui, sans-serif`;
      ctx.fillStyle = '#000';
      ctx.fillText(t.text, t.x + 1, t.y - k * 30 + 1);
      ctx.fillStyle = t.color;
      ctx.fillText(t.text, t.x, t.y - k * 30);
    }
    ctx.globalAlpha = 1;
  }

  drawOffscreenMarkers(g, camX, camY) {
    const ctx = this.ctx;
    const list = [];
    if (g.boss && !g.boss.dead) list.push([g.boss, '#ff4040']);
    if (g.miniboss && !g.miniboss.dead) list.push([g.miniboss, '#e0a050']);
    for (const e of g.enemies) if (e.elite && !e.dead && !e.flee) list.push([e, '#ffcc33']);
    for (const [e, col] of list) {
      const x = e.x - camX, y = e.y - camY;
      if (x > 0 && x < this.w && y > 0 && y < this.h) continue;
      const cx = this.w / 2, cy = this.h / 2;
      const a = Math.atan2(y - cy, x - cx);
      const mx = Math.min(Math.max(x, 24), this.w - 24), my = Math.min(Math.max(y, 24), this.h - 24);
      ctx.save();
      ctx.translate(mx, my);
      ctx.rotate(a);
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.moveTo(12, 0); ctx.lineTo(-8, -8); ctx.lineTo(-8, 8); ctx.closePath(); ctx.fill();
      ctx.restore();
    }
  }

  // ---------- HUD ----------
  drawHud(g, ui) {
    const ctx = this.ctx;
    const { w, h } = this;
    const p = g.player;
    const st = g.stats;
    const small = w < 700;

    // Đồng hồ & số quái đã giết (giữa trên)
    const remain = g.duration - g.time;
    ctx.textAlign = 'center';
    ctx.font = `800 ${small ? 26 : 34}px system-ui, sans-serif`;
    ctx.fillStyle = '#000';
    const timeText = remain >= 0 ? fmtTime(remain) : `+${fmtTime(-remain)}`;
    ctx.fillText(timeText, w / 2 + 2, 42);
    ctx.fillStyle = remain >= 0 ? '#f2efe6' : '#ff5050';
    ctx.fillText(timeText, w / 2, 40);
    ctx.font = '600 14px system-ui, sans-serif';
    ctx.fillStyle = '#c8c2b0';
    ctx.fillText(`Đã giết: ${g.kills}`, w / 2, 60);
    ctx.textAlign = 'right';
    ctx.font = '600 13px system-ui, sans-serif';
    ctx.fillStyle = '#bdb6a2';
    ctx.fillText(`${g.diff && g.diff.id !== 'normal' ? `${g.diff.name} · ` : ''}Màn ${g.map.id}: ${g.map.name}${g.map.difficulty > 1.0001 ? ` · +${Math.round((g.map.difficulty - 1) * 100)}%` : ''}`, w - 14, 22);

    if (g.banner) {
      const k = g.banner.t < 0.3 ? g.banner.t / 0.3 : Math.min(1, (g.banner.dur - g.banner.t) / 0.5);
      ctx.globalAlpha = Math.max(0, k);
      ctx.font = `700 ${small ? 15 : 20}px system-ui, sans-serif`;
      const tw = ctx.measureText(g.banner.text).width + 40;
      ctx.fillStyle = 'rgba(20,10,10,0.75)';
      ctx.fillRect(w / 2 - tw / 2, 76, tw, 34);
      ctx.fillStyle = '#ffd27a';
      ctx.fillText(g.banner.text, w / 2, 99);
      ctx.globalAlpha = 1;
    }

    // Quả cầu máu & mana
    const orbR = small ? 42 : 54;
    const oy = h - orbR - 18;
    this.drawOrb(orbR + 18, oy, orbR, p.hp / st.maxHp, '#b3122a', '#ff4b5c', `${Math.ceil(p.hp)}/${Math.round(st.maxHp)}`);
    this.drawOrb(w - orbR - 18, oy, orbR, p.mana / st.maxMana, '#1b3fa8', '#5d8bff', `${Math.floor(p.mana)}/${Math.round(st.maxMana)}`);

    // Ô kỹ năng + thanh kinh nghiệm
    const slotS = small ? 44 : 54, gap = 8;
    const totalW = slotS * 4 + gap * 3;
    // Màn hẹp: đặt ô kỹ năng lên trên hai quả cầu để không đè nhau.
    const narrow = totalW + (orbR * 2 + 24) * 2 > w;
    const sx = w / 2 - totalW / 2, sy = narrow ? oy - orbR - slotS - 34 : h - slotS - 16;
    g.ch.slots.forEach((id, i) => this.drawSlot(g, id, sx + i * (slotS + gap), sy, slotS, i));
    const xpW = narrow ? Math.min(w - 32, totalW + 60) : Math.min(w - (orbR * 2 + 60) * 2, Math.max(totalW + 60, 380));
    const xx = w / 2 - xpW / 2, xy = sy - 18;
    const need = xpToNext(g.ch.level, g.cfg);
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(xx, xy, xpW, 9);
    ctx.fillStyle = '#e8c547';
    ctx.fillRect(xx, xy, xpW * Math.min(1, g.ch.xp / need), 9);
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.lineWidth = 1;
    ctx.strokeRect(xx + 0.5, xy + 0.5, xpW - 1, 8);
    ctx.font = '700 13px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#f2efe6';
    ctx.fillText(`Cấp ${g.ch.level}`, xx, xy - 5);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#bdb6a2';
    ctx.font = '500 11px system-ui, sans-serif';
    ctx.fillText(`${Math.floor(g.ch.xp)} / ${need} KN`, xx + xpW, xy - 5);

    // Debug
    if (ui.debug) {
      ctx.textAlign = 'left';
      ctx.font = '600 13px ui-monospace, monospace';
      const lines = [
        `FPS ${ui.fps.toFixed(0)}  quái ${g.enemies.length}  vật phẩm ${g.pickups.length}`,
        `DPS ${g.dps().toFixed(1)}  tổng ST ${Math.round(g.totalDamage)}`,
        `t=${g.time.toFixed(1)}s${g.god ? '  BẤT TỬ' : ''}${ui.timeScale !== 1 ? `  x${ui.timeScale}` : ''}${ui.bot ? '  BOT' : ''}`,
      ];
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(8, 8, 330, lines.length * 18 + 8);
      ctx.fillStyle = '#9fff9f';
      lines.forEach((l, i) => ctx.fillText(l, 14, 26 + i * 18));
    }

    // Cần ảo trên điện thoại
    if (ui.joy && ui.joy.active) {
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(ui.joy.ox, ui.joy.oy, 50, 0, TAU); ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.beginPath(); ctx.arc(ui.joy.ox + ui.joy.dx * 50, ui.joy.oy + ui.joy.dy * 50, 22, 0, TAU); ctx.fill();
    }

    if (ui.resume > 0) {
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.fillRect(0, 0, w, h);
      ctx.textAlign = 'center';
      ctx.font = '800 40px system-ui, sans-serif';
      ctx.fillStyle = '#fff';
      ctx.fillText('Sẵn sàng…', w / 2, h / 2);
    }
  }

  drawOrb(x, y, r, frac, dark, light, label) {
    const ctx = this.ctx;
    frac = Math.max(0, Math.min(1, frac));
    ctx.fillStyle = '#0c0c0e';
    ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
    ctx.save();
    ctx.beginPath(); ctx.arc(x, y, r - 3, 0, TAU); ctx.clip();
    const top = y + r - frac * 2 * r;
    const grd = this.ctx.createLinearGradient(0, y - r, 0, y + r);
    grd.addColorStop(0, light);
    grd.addColorStop(1, dark);
    ctx.fillStyle = grd;
    ctx.fillRect(x - r, top, r * 2, y + r - top);
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.beginPath(); ctx.ellipse(x - r * 0.3, y - r * 0.45, r * 0.4, r * 0.22, -0.5, 0, TAU); ctx.fill();
    ctx.restore();
    ctx.strokeStyle = '#8a7a55';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.stroke();
    ctx.textAlign = 'center';
    ctx.font = '700 13px system-ui, sans-serif';
    ctx.fillStyle = '#000';
    ctx.fillText(label, x + 1, y + 6);
    ctx.fillStyle = '#fff';
    ctx.fillText(label, x, y + 5);
  }

  drawSlot(g, id, x, y, s, i) {
    const ctx = this.ctx;
    ctx.fillStyle = 'rgba(10,10,12,0.8)';
    ctx.fillRect(x, y, s, s);
    ctx.strokeStyle = '#6d6248';
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 1, y + 1, s - 2, s - 2);
    if (!id) return;
    const sk = g.data.skills[id];
    const st = g.skillState[id];
    drawSkillIcon(ctx, sk, x + s / 2, y + s / 2, s * 0.36);
    if (sk.kind === 'aura') {
      if (!st.active) { ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(x + 2, y + 2, s - 4, s - 4); }
    } else if (st.cd > 0 && st.cdMax) {
      const k = st.cd / st.cdMax;
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.beginPath();
      ctx.moveTo(x + s / 2, y + s / 2);
      ctx.arc(x + s / 2, y + s / 2, s * 0.7, -Math.PI / 2, -Math.PI / 2 + TAU * k);
      ctx.closePath();
      ctx.save();
      ctx.beginPath(); ctx.rect(x + 2, y + 2, s - 4, s - 4); ctx.clip();
      ctx.beginPath();
      ctx.moveTo(x + s / 2, y + s / 2);
      ctx.arc(x + s / 2, y + s / 2, s * 0.7, -Math.PI / 2, -Math.PI / 2 + TAU * k);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    if (st.noMana) {
      ctx.fillStyle = 'rgba(40,80,255,0.35)';
      ctx.fillRect(x + 2, y + 2, s - 4, s - 4);
    }
    ctx.font = '700 11px system-ui, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillStyle = '#fff';
    ctx.fillText(String(g.lvl(id)), x + s - 4, y + s - 4);
  }
}

// Biểu tượng kỹ năng dùng chung cho HUD và bảng cộng điểm.
export function drawSkillIcon(ctx, sk, cx, cy, r) {
  ctx.save();
  ctx.fillStyle = sk.color;
  ctx.strokeStyle = sk.color;
  switch (sk.id) {
    case 'fireball':
      ctx.beginPath(); ctx.arc(cx + r * 0.25, cy - r * 0.15, r * 0.55, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.moveTo(cx - r, cy + r * 0.6); ctx.lineTo(cx + r * 0.05, cy - r * 0.55); ctx.lineTo(cx + r * 0.5, cy + r * 0.25); ctx.closePath(); ctx.globalAlpha = 0.6; ctx.fill();
      break;
    case 'ember_ring':
      ctx.lineWidth = r * 0.3;
      ctx.beginPath(); ctx.arc(cx, cy, r * 0.75, 0, TAU); ctx.stroke();
      ctx.beginPath(); ctx.arc(cx, cy, r * 0.18, 0, TAU); ctx.fill();
      break;
    case 'fire_mastery':
      ctx.beginPath();
      ctx.moveTo(cx, cy - r); ctx.quadraticCurveTo(cx + r, cy, cx, cy + r); ctx.quadraticCurveTo(cx - r, cy, cx, cy - r);
      ctx.fill();
      break;
    case 'meteor':
      ctx.lineWidth = r * 0.15;
      for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.moveTo(cx - r + i * r * 0.3, cy - r); ctx.lineTo(cx - r * 0.1 + i * r * 0.3, cy); ctx.stroke(); }
      ctx.beginPath(); ctx.arc(cx + r * 0.3, cy + r * 0.3, r * 0.55, 0, TAU); ctx.fill();
      break;
    case 'firewall':
      for (let i = 0; i < 4; i++) {
        const x = cx - r + i * r * 0.62;
        ctx.beginPath(); ctx.moveTo(x, cy + r * 0.7); ctx.lineTo(x + r * 0.3, cy - r * (0.4 + (i % 2) * 0.5)); ctx.lineTo(x + r * 0.6, cy + r * 0.7); ctx.closePath(); ctx.fill();
      }
      ctx.fillRect(cx - r, cy + r * 0.6, r * 2, r * 0.3);
      break;
    case 'inferno_burst':
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * TAU;
        ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a - 0.2) * r, cy + Math.sin(a - 0.2) * r); ctx.lineTo(cx + Math.cos(a + 0.2) * r, cy + Math.sin(a + 0.2) * r); ctx.closePath(); ctx.fill();
      }
      break;
    case 'ice_bolt':
      ctx.beginPath(); ctx.moveTo(cx - r, cy + r * 0.5); ctx.lineTo(cx + r, cy - r * 0.5); ctx.lineTo(cx + r * 0.2, cy + r * 0.1); ctx.closePath(); ctx.fill();
      break;
    case 'frost_nova':
      ctx.lineWidth = r * 0.18;
      for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU; ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * r * 0.35, cy + Math.sin(a) * r * 0.35); ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); ctx.stroke(); }
      break;
    case 'cold_mastery':
    case 'lightning_mastery':
      ctx.beginPath();
      for (let i = 0; i < 6; i++) { const a = (i / 6) * TAU - Math.PI / 2; ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); }
      ctx.closePath(); ctx.fill();
      break;
    case 'blizzard':
      ctx.lineWidth = r * 0.14;
      for (let i = 0; i < 5; i++) { const x = cx - r + i * r * 0.5; ctx.beginPath(); ctx.moveTo(x, cy - r); ctx.lineTo(x - r * 0.3, cy + r); ctx.stroke(); }
      break;
    case 'frozen_orb':
      ctx.beginPath(); ctx.arc(cx, cy, r * 0.45, 0, TAU); ctx.fill();
      ctx.lineWidth = r * 0.14;
      for (let i = 0; i < 6; i++) { const a = (i / 6) * TAU; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); ctx.stroke(); }
      break;
    case 'shatter':
      for (let i = 0; i < 5; i++) { const a = (i / 5) * TAU; ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * r * 0.2, cy + Math.sin(a) * r * 0.2); ctx.lineTo(cx + Math.cos(a - 0.25) * r, cy + Math.sin(a - 0.25) * r); ctx.lineTo(cx + Math.cos(a + 0.25) * r, cy + Math.sin(a + 0.25) * r); ctx.closePath(); ctx.fill(); }
      break;
    case 'charged_bolt':
      for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.arc(cx - r * 0.5 + i * r * 0.5, cy + (i % 2 ? -r * 0.3 : r * 0.3), r * 0.25, 0, TAU); ctx.fill(); }
      break;
    case 'lightning':
    case 'thunder_storm':
      ctx.beginPath(); ctx.moveTo(cx + r * 0.3, cy - r); ctx.lineTo(cx - r * 0.5, cy + r * 0.1); ctx.lineTo(cx, cy + r * 0.1); ctx.lineTo(cx - r * 0.3, cy + r); ctx.lineTo(cx + r * 0.5, cy - r * 0.15); ctx.lineTo(cx, cy - r * 0.15); ctx.closePath(); ctx.fill();
      break;
    case 'chain_lightning':
      ctx.lineWidth = r * 0.16;
      ctx.beginPath(); ctx.moveTo(cx - r, cy + r * 0.6); ctx.lineTo(cx - r * 0.3, cy - r * 0.5); ctx.lineTo(cx + r * 0.2, cy + r * 0.4); ctx.lineTo(cx + r, cy - r * 0.6); ctx.stroke();
      break;
    case 'static_field':
      ctx.lineWidth = r * 0.14;
      ctx.setLineDash([r * 0.25, r * 0.18]);
      ctx.beginPath(); ctx.arc(cx, cy, r * 0.85, 0, TAU); ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath(); ctx.arc(cx, cy, r * 0.3, 0, TAU); ctx.fill();
      break;
    // ---- Chiến Binh
    case 'cleave':
      ctx.lineWidth = r * 0.28; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.arc(cx - r * 0.3, cy + r * 0.3, r * 0.95, -1.4, 0.2); ctx.stroke();
      break;
    case 'whirlwind':
      ctx.lineWidth = r * 0.18; ctx.lineCap = 'round';
      for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.arc(cx, cy, r * (0.35 + i * 0.28), i * 2.1, i * 2.1 + 2.2); ctx.stroke(); }
      break;
    case 'leap_slam':
      ctx.lineWidth = r * 0.16; ctx.setLineDash([r * 0.25, r * 0.18]);
      ctx.beginPath(); ctx.moveTo(cx - r, cy + r * 0.5); ctx.quadraticCurveTo(cx, cy - r * 1.3, cx + r * 0.6, cy + r * 0.3); ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath(); ctx.ellipse(cx + r * 0.6, cy + r * 0.6, r * 0.45, r * 0.15, 0, 0, TAU); ctx.fill();
      break;
    case 'throwing_axe':
      ctx.lineWidth = r * 0.14;
      ctx.beginPath(); ctx.moveTo(cx - r * 0.7, cy + r * 0.7); ctx.lineTo(cx + r * 0.4, cy - r * 0.4); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx + r * 0.1, cy - r * 0.9); ctx.quadraticCurveTo(cx + r * 1.1, cy - r * 0.6, cx + r * 0.9, cy + r * 0.2); ctx.lineTo(cx + r * 0.3, cy - r * 0.3); ctx.closePath(); ctx.fill();
      break;
    case 'howl':
    case 'battle_cry':
      ctx.beginPath(); ctx.moveTo(cx - r, cy - r * 0.3); ctx.lineTo(cx - r * 0.4, cy - r * 0.3); ctx.lineTo(cx, cy - r * 0.8); ctx.lineTo(cx, cy + r * 0.8); ctx.lineTo(cx - r * 0.4, cy + r * 0.3); ctx.lineTo(cx - r, cy + r * 0.3); ctx.closePath(); ctx.fill();
      ctx.lineWidth = r * 0.12;
      for (let i = 1; i <= 2; i++) { ctx.beginPath(); ctx.arc(cx, cy, r * 0.4 * i + r * 0.1, -0.7, 0.7); ctx.stroke(); }
      break;
    case 'stomp':
    case 'earthquake':
      ctx.lineWidth = r * 0.12;
      ctx.beginPath(); ctx.moveTo(cx - r, cy + r * 0.2); ctx.lineTo(cx - r * 0.4, cy - r * 0.1); ctx.lineTo(cx - r * 0.1, cy + r * 0.5); ctx.lineTo(cx + r * 0.3, cy - r * 0.3); ctx.lineTo(cx + r, cy + r * 0.1); ctx.stroke();
      if (sk.id === 'stomp') { ctx.beginPath(); ctx.ellipse(cx, cy + r * 0.7, r, r * 0.2, 0, 0, TAU); ctx.fill(); }
      else { ctx.beginPath(); ctx.moveTo(cx - r * 0.2, cy - r); ctx.lineTo(cx, cy - r * 0.2); ctx.lineTo(cx + r * 0.25, cy - r); ctx.stroke(); }
      break;
    case 'thrust':
      ctx.lineWidth = r * 0.14;
      ctx.beginPath(); ctx.moveTo(cx - r, cy + r * 0.5); ctx.lineTo(cx + r * 0.6, cy - r * 0.3); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx + r, cy - r * 0.5); ctx.lineTo(cx + r * 0.4, cy - r * 0.55); ctx.lineTo(cx + r * 0.65, cy - r * 0.05); ctx.closePath(); ctx.fill();
      break;
    case 'chain_cleave':
      ctx.lineWidth = r * 0.15; ctx.lineCap = 'round';
      for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.arc(cx - r * 0.6 + i * r * 0.6, cy + (i % 2 ? -r * 0.2 : r * 0.2), r * 0.35, -1.5, 0.3); ctx.stroke(); }
      break;
    case 'life_leech':
    case 'berserk':
    case 'blood_burst':
      ctx.beginPath(); ctx.moveTo(cx, cy - r); ctx.quadraticCurveTo(cx + r * 0.8, cy + r * 0.1, cx, cy + r * 0.8); ctx.quadraticCurveTo(cx - r * 0.8, cy + r * 0.1, cx, cy - r); ctx.fill();
      if (sk.id !== 'life_leech') { ctx.strokeStyle = '#fff'; ctx.lineWidth = r * 0.1; ctx.beginPath(); ctx.moveTo(cx - r * 0.25, cy + r * 0.1); ctx.lineTo(cx + r * 0.25, cy + r * 0.1); if (sk.id === 'blood_burst') { ctx.moveTo(cx, cy - r * 0.15); ctx.lineTo(cx, cy + r * 0.35); } ctx.stroke(); }
      break;
    case 'weapon_mastery':
    case 'iron_skin':
    case 'blood_mastery':
    case 'unbroken':
    case 'frenzy':
      ctx.beginPath();
      if (sk.id === 'iron_skin' || sk.id === 'unbroken') { ctx.moveTo(cx, cy - r); ctx.lineTo(cx + r * 0.8, cy - r * 0.6); ctx.lineTo(cx + r * 0.7, cy + r * 0.3); ctx.lineTo(cx, cy + r); ctx.lineTo(cx - r * 0.7, cy + r * 0.3); ctx.lineTo(cx - r * 0.8, cy - r * 0.6); }
      else for (let i = 0; i < 6; i++) { const a = (i / 6) * TAU - Math.PI / 2; ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); }
      ctx.closePath(); ctx.fill();
      break;
    default:
      ctx.font = `700 ${r}px system-ui`;
      ctx.textAlign = 'center';
      ctx.fillText(sk.short, cx, cy + r * 0.35);
  }
  ctx.restore();
}
