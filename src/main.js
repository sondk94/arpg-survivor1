import { loadData } from './core/data.js';
import { Game, fmtTime } from './core/game.js';
import * as P from './core/progression.js';
import { botInput, botAllocate } from './core/bot.js';
import { Renderer } from './ui/render.js';
import { Panel } from './ui/panel.js';
import { Input } from './ui/input.js';
import { setupDebug } from './ui/debug.js';
import * as T from './ui/telemetry.js';

const STEP = 1 / 60;
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ATTR_NAMES = { str: 'Sức mạnh', dex: 'Nhanh nhẹn', vit: 'Thể lực', ene: 'Năng lượng' };

class App {
  async init() {
    this.data = await loadData(async (p) => {
      const r = await fetch(p, { cache: 'no-store' });
      if (!r.ok) throw new Error(`Không tải được ${p}`);
      return r.json();
    });
    this.ch = P.createCharacter(this.data);
    this.game = null;
    this.state = 'village';
    this.lastResult = null;
    const params = new URLSearchParams(location.search);
    this.ui = { debugVisible: params.has('debug'), debugHud: true, fps: 60, timeScale: 1, bot: false, god: false, showDamage: true, resume: 0, joy: null };
    this.tester = (() => { try { return localStorage.getItem('arpg_s0_tester') || ''; } catch { return ''; } })();

    this.canvas = $('#game');
    this.renderer = new Renderer(this.canvas);
    window.addEventListener('resize', () => {
      this.renderer.resize();
      if (this.game) { this.game.viewW = this.renderer.w; this.game.viewH = this.renderer.h; }
    });
    this.input = new Input(this.canvas, (e) => this.onKey(e));
    this.ui.joy = this.input.joy;
    this.panel = new Panel($('#panel'), this.data, {
      getChar: () => this.ch,
      getGame: () => (this.state === 'run' ? this.game : null),
      onClosed: () => this.onPanelClosed(),
      onChanged: () => this.refresh(),
    });
    $('#btn-plus').addEventListener('click', () => this.togglePanel());
    setupDebug($('#debug'), this);
    $('#debug').classList.toggle('hidden', !this.ui.debugVisible);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.state === 'run' && this.game && !this.game.over) this.panel.open();
    });
    this.renderVillage();
    this.last = performance.now();
    this.acc = 0;
    requestAnimationFrame((t) => this.frame(t));
  }

  // ---------- Vòng lặp ----------
  frame(now) {
    const realDt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    if (realDt > 0) this.ui.fps = this.ui.fps * 0.92 + (1 / realDt) * 0.08;
    const g = this.game;
    if (this.state === 'run' && g) {
      if (this.panel.isOpen) {
        this.acc = 0;
      } else if (this.ui.resume > 0) {
        this.ui.resume -= realDt;
        this.acc = 0;
      } else if (!g.over) {
        this.acc += realDt * this.ui.timeScale;
        let steps = 0;
        const maxSteps = 6 * this.ui.timeScale;
        while (this.acc >= STEP && steps < maxSteps && !g.over) {
          const mv = this.ui.bot ? botInput(g) : this.input.move();
          g.input.x = mv.x; g.input.y = mv.y;
          g.update(STEP);
          this.acc -= STEP;
          steps++;
          if (this.ui.bot && (this.ch.attrPoints || this.ch.skillPoints)) {
            g.beginEdit();
            g.recordAllocation(botAllocate(this.ch, this.data, 'fireball'));
            g.refreshStats();
            g.endEdit();
          }
        }
        if (steps >= maxSteps) this.acc = 0;
      }
      this.handleEvents(g);
    }
    if (this.state === 'run' && g) {
      this.ui.debug = this.ui.debugVisible && this.ui.debugHud;
      this.renderer.draw(g, this.ui);
      this.updatePlus();
    }
    requestAnimationFrame((t) => this.frame(t));
  }

  handleEvents(g) {
    for (const ev of g.out) {
      if (ev.type === 'shake') this.renderer.shake = Math.max(this.renderer.shake, ev.amount);
      if (ev.type === 'death' || ev.type === 'victory') {
        if (!this.endTimer) this.endTimer = setTimeout(() => this.endRun(), ev.type === 'victory' ? 1600 : 1200);
      }
    }
    g.out.length = 0;
  }

  // ---------- Điều khiển ----------
  onKey(e) {
    const k = e.key;
    if (k === 'F2' || k === '`') {
      e.preventDefault();
      this.ui.debugVisible = !this.ui.debugVisible;
      $('#debug').classList.toggle('hidden', !this.ui.debugVisible);
      return;
    }
    if (this.state !== 'run') {
      if ((k === 'Escape' || k === 'Tab' || k === 'c' || k === 'C') && this.panel.isOpen) this.panel.close();
      return;
    }
    if (k === 'Tab' || k === 'c' || k === 'C') this.togglePanel();
    else if (k === 'Escape' && this.panel.isOpen) this.panel.close();
    else if (['1', '2', '3', '4'].includes(k) && !this.panel.isOpen && this.game && !this.game.over) {
      const attr = P.ATTRS[Number(k) - 1];
      if (this.game.quickAdd(attr)) this.game.addText(this.game.player.x, this.game.player.y - 40, `+1 ${ATTR_NAMES[attr]}`, '#ffe9a8', 13);
    }
  }

  togglePanel() {
    if (this.state === 'run' && this.game?.over) return;
    if (this.panel.isOpen) this.panel.close();
    else this.panel.open();
  }

  onPanelClosed() {
    if (this.state === 'run') {
      this.ui.resume = this.data.config.run.resumeDelay;
      this.canvas.classList.remove('dim');
    } else {
      this.renderVillage();
    }
  }

  updatePlus() {
    const btn = $('#btn-plus');
    const pts = this.ch.attrPoints + this.ch.skillPoints;
    btn.classList.toggle('blink', pts > 0);
    const txt = pts > 0 ? String(pts) : '';
    if (btn.dataset.count !== txt) { btn.dataset.count = txt; $('#plus-count').textContent = txt; }
    this.canvas.classList.toggle('dim', this.panel.isOpen);
  }

  refresh() {
    if (this.game && this.state === 'run') this.game.refreshStats();
    if (this.panel.isOpen) this.panel.render();
    if (this.state === 'village') this.renderVillage();
  }

  debugLevel() {
    if (this.game && this.state === 'run') {
      this.game.addXp(P.xpToNext(this.ch.level, this.data.config) - this.ch.xp);
    } else {
      this.ch.level++;
      this.ch.attrPoints += this.data.config.player.attrPointsPerLevel;
      this.ch.skillPoints += this.data.config.player.skillPointsPerLevel;
    }
    this.refresh();
  }

  // ---------- Lượt chơi ----------
  startRun() {
    if (this.panel.isOpen) this.panel.close();
    this.ch.runs++;
    this.game = new Game(this.data, this.ch, { viewW: this.renderer.w, viewH: this.renderer.h });
    this.game.god = this.ui.god;
    this.game.showDamage = this.ui.showDamage;
    this.state = 'run';
    this.endTimer = null;
    this.acc = 0;
    this.ui.resume = 0;
    this.ui.debugTouched = false;
    $('#village').classList.add('hidden');
    $('#btn-plus').classList.remove('hidden');
    this.canvas.focus();
  }

  quitRun() {
    if (this.state !== 'run' || !this.game) return;
    if (!this.game.over) {
      this.game.over = true;
      this.game.result = { win: false, quit: true, time: this.game.time };
      this.game.log.cause = 'Bỏ lượt';
    }
    this.endRun();
  }

  endRun() {
    clearTimeout(this.endTimer);
    this.endTimer = null;
    if (this.panel.isOpen) this.panel.close();
    const g = this.game;
    const r = g.result || { win: false, time: g.time };
    const boss = g.boss;
    const rec = {
      tester: this.tester || '(chưa đặt tên)',
      date: new Date().toISOString(),
      version: this.data.config.version,
      map: g.map.id,
      seed: g.seed,
      result: r.win ? 'win' : r.quit ? 'quit' : 'death',
      timeSec: Math.round(g.time),
      startLevel: g.log.startLevel,
      endLevel: this.ch.level,
      kills: g.kills,
      cause: g.log.cause,
      attrsSpent: g.log.attrs,
      skillsSpent: g.log.skills,
      finalAttrs: { ...this.ch.attrs },
      finalSkills: { ...this.ch.skills },
      unspent: { attr: this.ch.attrPoints, skill: this.ch.skillPoints },
      panelOpens: g.log.panelOpens,
      panelSeconds: Math.round(g.log.panelMs / 100) / 10,
      avgPanelSeconds: g.log.panelOpens ? Math.round(g.log.panelMs / g.log.panelOpens / 100) / 10 : 0,
      levelUps: g.log.levelUps,
      bossReached: !!boss,
      bossHpPct: boss ? Math.max(0, Math.round((boss.hp / boss.maxHp) * 100)) : null,
      flawless: !!r.flawless,
      damageTaken: Object.fromEntries(Object.entries(g.log.damageTaken).map(([k, v]) => [k, Math.round(v)])),
      potions: g.log.potions,
      minHpPct: Math.round(g.log.minHpPct * 100),
      outOfManaSec: Math.round(g.log.outOfManaSec),
      debugUsed: !!this.ui.debugTouched || this.ui.god || this.ui.bot || this.ui.timeScale !== 1,
    };
    T.saveRun(rec);
    this.lastResult = rec;
    this.state = 'village';
    this.game = null;
    $('#btn-plus').classList.add('hidden');
    this.canvas.classList.remove('dim');
    this.renderer.draw(null, this.ui);
    this.renderVillage();
  }

  // ---------- Làng ----------
  renderVillage() {
    const v = $('#village');
    v.classList.remove('hidden');
    const ch = this.ch;
    const need = P.xpToNext(ch.level, this.data.config);
    const r = this.lastResult;
    let resultHtml = '';
    if (r) {
      const title = r.result === 'win' ? 'Hoàn thành màn 1-1!' : r.result === 'quit' ? 'Đã bỏ lượt' : 'Bạn đã gục ngã';
      const extra = r.result === 'win'
        ? (r.flawless ? '<div class="chest">Hòm thưởng thêm: hoàn thành mà chưa chết lần nào ở bản đồ này! <small>(giai đoạn 0 chưa có đồ đạc)</small></div>' : '')
        : `<div>Nguyên nhân: <b>${esc(r.cause || '-')}</b>. Kinh nghiệm, cấp và điểm vẫn được giữ; màn phải chơi lại từ đầu.</div>`;
      resultHtml = `<div class="result ${r.result}">
        <h2>${title}</h2>
        <div class="grid4">
          <div><span>Thời gian</span><b>${fmtTime(r.timeSec)}</b></div>
          <div><span>Cấp</span><b>${r.startLevel} → ${r.endLevel}</b></div>
          <div><span>Đã giết</span><b>${r.kills}</b></div>
          <div><span>Boss</span><b>${r.bossReached ? (r.result === 'win' ? 'Đã hạ' : `còn ${r.bossHpPct}%`) : 'Chưa gặp'}</b></div>
        </div>
        ${extra}
      </div>`;
    }
    const runs = T.getRuns();
    const recent = runs.slice(-8).reverse();
    const sum = T.summarize(runs);
    const hist = recent.length ? `<table class="hist"><thead><tr><th>Người chơi</th><th>Kết quả</th><th>Thời gian</th><th>Cấp</th><th>Giết</th><th>Mở bảng</th><th>Nguyên nhân</th></tr></thead><tbody>${recent.map((x) => `<tr><td>${esc(x.tester)}</td><td>${x.result === 'win' ? 'Thắng' : x.result === 'quit' ? 'Bỏ' : 'Chết'}</td><td>${fmtTime(x.timeSec)}</td><td>${x.startLevel}→${x.endLevel}</td><td>${x.kills}</td><td>${x.panelOpens} lần, TB ${x.avgPanelSeconds}s</td><td>${esc(x.cause || '-')}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">Chưa có lượt nào.</p>';

    v.innerHTML = `
      <div class="village-box">
        <header>
          <h1>ARPG Survivor <small>Giai đoạn 0 · bản thử ${esc(this.data.config.version)}</small></h1>
        </header>
        ${resultHtml}
        <div class="char">
          <div class="char-main">
            <div class="cls">${esc(this.data.config.player.className)} · Nhánh ${esc(this.data.tree.treeName)}</div>
            <div class="lvl">Cấp ${ch.level}</div>
            <div class="xpbar"><div style="width:${Math.min(100, (ch.xp / need) * 100)}%"></div></div>
            <div class="muted">${Math.floor(ch.xp)} / ${need} kinh nghiệm · ${ch.runs} lượt · ${ch.clears} lần hoàn thành · ${ch.deaths} lần chết</div>
            <div class="attrs">${P.ATTRS.map((k) => `<span>${ATTR_NAMES[k]} <b>${ch.attrs[k]}</b></span>`).join('')}</div>
            ${ch.attrPoints || ch.skillPoints ? `<div class="unspent">Còn ${ch.attrPoints} điểm thuộc tính, ${ch.skillPoints} điểm kỹ năng</div>` : ''}
          </div>
          <div class="char-btns">
            <button id="v-start" class="primary">Vào bản đồ 1-1: ${esc(this.data.maps['1-1'].name)}</button>
            <button id="v-panel">Cộng điểm (Tab / C)</button>
            <button id="v-new" class="ghost">Nhân vật mới</button>
          </div>
        </div>
        <details class="help" ${this.ch.runs === 0 ? 'open' : ''}>
          <summary>Cách chơi</summary>
          <ul>
            <li><b>WASD</b> hoặc phím mũi tên để di chuyển. Kỹ năng tự kích hoạt và tốn mana.</li>
            <li><b>Tab</b>, <b>C</b> hoặc nút <b>+</b> mở bảng cộng điểm; game dừng hẳn khi bảng mở. <b>Shift</b> + bấm để cộng 5 điểm. Có nút Hoàn tác.</li>
            <li>Phím <b>1</b> Sức mạnh, <b>2</b> Nhanh nhẹn, <b>3</b> Thể lực, <b>4</b> Năng lượng: cộng nhanh 1 điểm, không cần mở bảng.</li>
            <li>Sống sót 10 phút: trùm nhỏ ở 5:00, boss Chúa Đầm Lầy ở 9:00. Màn chỉ hoàn thành khi boss chết.</li>
            <li>Chết thì về làng, giữ nguyên cấp và kinh nghiệm. Điện thoại: cần ảo nửa trái, nút + bên phải.</li>
          </ul>
        </details>
        <section class="tests">
          <div class="row">
            <label>Tên người chơi thử <input id="v-tester" value="${esc(this.tester)}" placeholder="VD: Người 1"></label>
            <button id="v-export">Xuất log (JSON)</button>
            <button id="v-clear" class="ghost">Xoá log</button>
          </div>
          ${sum ? `<div class="muted">Đã ghi ${sum.runs} lượt của ${sum.testers} người · hạ boss ở lượt đầu: ${sum.firstRunBossKill}/${sum.testers} · mở bảng trung bình ${sum.avgPanelSec.toFixed(1)} giây/lần</div>` : ''}
          ${hist}
          <details class="feedback">
            <summary>Góp ý sau buổi chơi (3 câu)</summary>
            <label>Lúc nào vui nhất?<textarea id="f1"></textarea></label>
            <label>Lúc nào chán nhất?<textarea id="f2"></textarea></label>
            <label>Có muốn chơi tiếp không?<textarea id="f3"></textarea></label>
            <button id="v-fb">Lưu góp ý</button> <span id="fb-ok" class="muted"></span>
          </details>
        </section>
      </div>`;
    $('#v-start').onclick = () => this.startRun();
    $('#v-panel').onclick = () => this.panel.open();
    $('#v-new').onclick = () => {
      if (!confirm('Tạo nhân vật mới? Cấp và điểm hiện tại sẽ mất (log vẫn giữ).')) return;
      this.ch = P.createCharacter(this.data);
      this.lastResult = null;
      this.renderVillage();
    };
    $('#v-tester').onchange = (e) => {
      this.tester = e.target.value.trim();
      try { localStorage.setItem('arpg_s0_tester', this.tester); } catch { /* bỏ qua */ }
    };
    $('#v-export').onclick = () => T.exportAll();
    $('#v-clear').onclick = () => { if (confirm('Xoá toàn bộ log lượt chơi và góp ý?')) { T.clearAll(); this.renderVillage(); } };
    $('#v-fb').onclick = () => {
      T.saveFeedback({ tester: this.tester, date: new Date().toISOString(), fun: $('#f1').value, boring: $('#f2').value, playMore: $('#f3').value });
      $('#f1').value = $('#f2').value = $('#f3').value = '';
      $('#fb-ok').textContent = 'Đã lưu.';
    };
  }
}

const app = new App();
window.app = app; // tiện cho debug trong console
app.init().catch((err) => {
  document.body.innerHTML = `<pre style="color:#f88;padding:20px">${esc(err.stack || err)}\n\nHãy chạy qua một máy chủ web (xem README), không mở trực tiếp file index.html.</pre>`;
});
