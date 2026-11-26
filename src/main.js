import { loadData } from './core/data.js';
import { Game, fmtTime } from './core/game.js';
import * as P from './core/progression.js';
import { botInput, botAllocate, botManageItems, BUILDS } from './core/bot.js';
import * as I from './core/items.js';
import * as L from './core/loot.js';
import { RNG } from './core/rng.js';
import { saveRoster, loadRoster, exportCode, importCode } from './core/save.js';
import { Renderer } from './ui/render.js';
import { drawPortrait } from './ui/sprites.js';
import { Panel } from './ui/panel.js';
import { Input } from './ui/input.js';
import { setupDebug } from './ui/debug.js';
import * as T from './ui/telemetry.js';

const STEP = 1 / 60;
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// Tên gợi ý khi tạo nhân vật.
const NAME_POOL = {
  mage: ['Lửa Hồng', 'Băng Tâm', 'Lôi Vũ', 'Hoả Phong', 'Tuyết Ngân'],
  warrior: ['Thiết Thủ', 'Cuồng Đao', 'Huyết Kiếm', 'Thạch Sanh', 'Bạo Hổ'],
  summoner: ['Lang Vương', 'Gấu Xám', 'Ưng Vũ', 'Bầy Sói', 'Rừng Xanh'],
};
const ATTR_NAMES = { str: 'Sức mạnh', dex: 'Nhanh nhẹn', vit: 'Thể lực', ene: 'Năng lượng' };

class App {
  async init() {
    this.data = await loadData(async (p) => {
      const r = await fetch(p, { cache: 'no-store' });
      if (!r.ok) throw new Error(`Không tải được ${p}`);
      return r.json();
    });
    const saved = loadRoster(this.data);
    this.roster = saved.roster;
    this.stash = saved.stash;
    this.ch = this.roster.chars.find((c) => c.uid === this.roster.active) || null;
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
      getStash: () => this.stash,
      isVillage: () => this.state === 'village',
      onClosed: () => this.onPanelClosed(),
      onChanged: () => { this.refresh(); this.save(); },
    });
    $('#btn-plus').addEventListener('click', () => this.togglePanel());
    setupDebug($('#debug'), this);
    $('#debug').classList.toggle('hidden', !this.ui.debugVisible);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.state === 'run' && this.game && !this.game.over) this.panel.open();
    });
    window.addEventListener('beforeunload', () => this.save());
    // Mở game: vào thẳng làng của nhân vật chơi gần nhất; chưa có nhân vật thì ra màn chọn / tạo.
    if (this.ch) { this.state = 'village'; this.renderVillage(); } else this.renderSelect();
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
            g.recordAllocation(botAllocate(this.ch, this.data, this.botBuild()));
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
      if (ev.type === 'item' && this.ui.bot && botManageItems(this.ch, this.data, this.botBuild())) g.refreshStats();
      if (ev.type === 'item' || ev.type === 'levelup') this.saveSoon();
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
    if (this.state === 'select') return;
    if (this.state !== 'run') {
      const typing = ['TEXTAREA', 'INPUT', 'SELECT'].includes(document.activeElement?.tagName);
      if (!this.panel.isOpen && !typing) {
        if (k === 'Escape' && this.closeModal()) return;
        if (k === 'Enter' && (!this.villageModal || this.villageModal === 'result')) { e.preventDefault(); this.villageModal = null; this.startRun(); if (this.state !== 'run') this.renderVillage(); return; }
      }
      if ((k === 'Escape' || k === 'Tab' || k === 'c' || k === 'C') && this.panel.isOpen) this.panel.close();
      else if ((k === 'i' || k === 'I') && document.activeElement?.tagName !== 'TEXTAREA') this.togglePanel('items');
      return;
    }
    if (k === 'Tab' || k === 'c' || k === 'C') this.togglePanel('char');
    else if (k === 'i' || k === 'I') this.togglePanel('items');
    else if (k === 'Escape' && this.panel.isOpen) this.panel.close();
    else if (['1', '2', '3', '4'].includes(k) && !this.panel.isOpen && this.game && !this.game.over) {
      const attr = P.ATTRS[Number(k) - 1];
      if (this.game.quickAdd(attr)) this.game.addText(this.game.player.x, this.game.player.y - 40, `+1 ${ATTR_NAMES[attr]}`, '#ffe9a8', 13);
    }
  }

  // Kiểu cộng điểm của bot: theo lựa chọn ở bảng debug nếu đúng lớp, không thì kiểu mặc định của lớp.
  botBuild() {
    const b = this.ui.botBuild;
    if (b && BUILDS[b] && BUILDS[b].class === this.ch.classId) return b;
    return this.ch.classId === 'warrior' ? 'weapon' : this.ch.classId === 'summoner' ? 'pack' : 'fire';
  }

  togglePanel(tab) {
    if (this.state === 'run' && this.game?.over) return;
    if (this.panel.isOpen && (!tab || this.panel.tab === tab)) this.panel.close();
    else this.panel.open(tab);
  }

  save() {
    clearTimeout(this.saveTimer);
    this.saveTimer = null;
    if (this.ch) {
      const i = this.roster.chars.findIndex((c) => c.uid === this.ch.uid);
      if (i >= 0) this.roster.chars[i] = this.ch; else this.roster.chars.push(this.ch);
      this.roster.active = this.ch.uid;
    }
    saveRoster(this.roster, this.stash, this.data);
  }

  saveSoon() {
    if (!this.saveTimer) this.saveTimer = setTimeout(() => this.save(), 1500);
  }

  onPanelClosed() {
    this.save();
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

  generateItem(ilvl, opts) {
    this.dbgRng ||= new RNG((Date.now() >>> 0) || 1);
    return I.generateItem(this.dbgRng, this.data, ilvl, opts);
  }

  addItem(it) {
    return I.addToInventory(this.ch, it);
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
  // Màn mặc định: màn đã mở xa nhất.
  currentDiff() {
    const u = P.unlockedDifficulties(this.ch, this.data);
    if (!u.includes(this.selectedDiff)) this.selectedDiff = u[u.length - 1];
    return this.selectedDiff;
  }

  defaultMap() {
    const u = P.unlockedMaps(this.ch, this.data, this.currentDiff());
    return u[u.length - 1];
  }

  startRun(mapId = this.selectedMap) {
    const diff = this.currentDiff();
    if (!mapId || !P.unlockedMaps(this.ch, this.data, diff).includes(mapId)) mapId = this.defaultMap();
    this.selectedMap = mapId;
    if (!P.hasActiveSkill(this.ch)) {
      this.panel.open('char');
      this.panel.flash('Hãy học ít nhất một kỹ năng chủ động trước khi vào bản đồ');
      return;
    }
    if (this.panel.isOpen) this.panel.close();
    this.villageModal = null;
    this.ch.runs++;
    this.game = new Game(this.data, this.ch, { mapId, difficulty: diff, viewW: this.renderer.w, viewH: this.renderer.h });
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
    if (!this.game.over && this.game.victory) this.game.finishVictory(); // đã hạ boss: vẫn tính thắng, nhận hết đồ
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
      classId: this.ch.classId,
      charName: this.ch.name,
      map: g.map.id,
      mode: g.diff.id,
      newRecord: !!r.newRecord,
      newDifficulty: r.newDifficulty || null,
      difficulty: Math.round(g.map.difficulty * 1000) / 1000,
      nextMapUnlocked: r.nextMap || null,
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
      itemsPicked: g.log.itemsPicked,
      gold: g.log.gold,
      freezes: g.log.freezes,
      damageByElement: Object.fromEntries(Object.entries(g.dmgByElement).map(([k, v]) => [k, Math.round(v)])),
      slots: [...this.ch.slots],
      debugUsed: !!this.ui.debugTouched || this.ui.god || this.ui.bot || this.ui.timeScale !== 1,
    };
    // Rương thưởng: đồ không vừa kho vào túi tạm; đồ đánh dấu rác tự bán khi về làng.
    rec.chestLoot = r.chestLoot || null;
    rec.chestShards = g.chestShards || 0;
    if (r.overflow?.length) this.ch.overflow = [...(this.ch.overflow || []), ...r.overflow];
    rec.overflow = r.overflow?.length || 0;
    const junk = L.bulkCandidates(this.ch, this.data, 'junk', true);
    rec.junkSold = junk.length ? L.sellItems(this.ch, junk, this.data) : null;
    rec.autoSold = g.log.autoSold || 0;
    T.saveRun(rec);
    this.lastResult = rec;
    if (r.nextMap) this.selectedMap = r.nextMap;
    if (r.newDifficulty) { this.selectedDiff = r.newDifficulty; this.selectedMap = this.data.mapOrder[0]; }
    this.save();
    this.state = 'village';
    this.game = null;
    $('#btn-plus').classList.add('hidden');
    this.canvas.classList.remove('dim');
    this.renderer.draw(null, this.ui);
    this.viewChap = null;
    this.villageModal = 'result';
    this.renderVillage();
  }

  // ---------- Màn chọn nhân vật: một hàng thẻ, bấm là vào làng ----------
  renderSelect(creating = false) {
    this.state = 'select';
    if (this.panel?.isOpen) this.panel.close();
    const v = $('#village');
    v.classList.remove('hidden');
    $('#btn-plus').classList.add('hidden');
    const data = this.data;
    const chars = this.roster.chars;
    if (!chars.length) creating = true;
    const cards = chars.map((c) => {
      const cls = P.getClass(c, data);
      const prog = P.progressOf(c, 'normal');
      const cur = data.maps[data.mapOrder[Math.min(prog, data.mapOrder.length - 1)]];
      return `<div class="pcard ${c.uid === this.roster.active ? 'on' : ''}" style="--cc:${cls.color}" data-play="${c.uid}" tabindex="0" title="Bấm để vào làng">
        <button class="pc-more" data-more="${c.uid}" title="Tuỳ chọn">⋯</button>
        <div class="pc-menu hidden" data-menu="${c.uid}"><button data-del="${c.uid}" class="danger">Xoá nhân vật</button></div>
        <canvas data-portrait="${cls.look}" width="120" height="150"></canvas>
        <b>${esc(c.name)}</b>
        <span>${esc(cls.short)} · cấp ${c.level}</span>
        <small>Màn ${esc(cur.id)} · ${prog}/${data.mapOrder.length}</small>
      </div>`;
    }).join('');
    const newCard = `<div class="pcard new ${creating ? 'on' : ''}" id="s-new" tabindex="0"><div class="plus">+</div><b>Tạo mới</b><span>&nbsp;</span><small>&nbsp;</small></div>`;
    const pick = this.newClass && data.classes[this.newClass] ? this.newClass : data.classList[0].id;
    const classCards = data.classList.map((c) => {
      const st = P.computeStats(P.createCharacter(data, c.id), data);
      return `<label class="classcard" style="--cc:${c.color}">
        <input type="radio" name="cls" value="${c.id}" ${c.id === pick ? 'checked' : ''}>
        <canvas data-portrait="${c.look}" width="120" height="150"></canvas>
        <div><b>${esc(c.name)}</b><p>${esc(c.desc)}</p>
        <small>Máu ${Math.round(st.maxHp)} · Mana ${Math.round(st.maxMana)} · Giáp ${st.armor} · Nhánh: ${c.trees.map((t) => esc(data.treesById[t].name)).join(', ')}</small></div>
      </label>`;
    }).join('');
    v.innerHTML = `<div class="select-box">
      <header class="sel-head"><h1>ARPG Survivor</h1><span class="muted">Chọn nhân vật · bản ${esc(data.config.version)}</span></header>
      <div class="pcards">${cards}${newCard}</div>
      ${creating ? `<section class="create" id="s-create">
        <h3 class="sec-title">Tạo nhân vật mới: chọn lớp</h3>
        <div class="classgrid">${classCards}</div>
        <div class="row create-row"><label>Tên <input id="s-name" maxlength="24" value="${esc(this.suggestName(pick))}"></label>
          <button id="s-make" class="primary">Tạo và vào làng</button>
          ${chars.length ? '<button id="s-cancel" class="ghost">Huỷ</button>' : ''}</div>
      </section>` : ''}
      <p class="muted sel-note">Mỗi nhân vật có cấp, kỹ năng, đồ và tiến độ riêng. Rương chung dùng chung cho mọi nhân vật. Lần sau mở game sẽ vào thẳng nhân vật chơi gần nhất.</p>
    </div>`;
    v.querySelectorAll('canvas[data-portrait]').forEach((c) => drawPortrait(c, c.dataset.portrait));
    v.querySelectorAll('[data-play]').forEach((el) => {
      el.onclick = (e) => { if (e.target.closest('.pc-more, .pc-menu')) return; this.selectChar(el.dataset.play); };
      el.onkeydown = (e) => { if (e.key === 'Enter') this.selectChar(el.dataset.play); };
    });
    v.querySelectorAll('[data-more]').forEach((b) => (b.onclick = (e) => {
      e.stopPropagation();
      v.querySelector(`[data-menu="${b.dataset.more}"]`).classList.toggle('hidden');
    }));
    v.querySelectorAll('[data-del]').forEach((b) => (b.onclick = (e) => {
      e.stopPropagation();
      const c = chars.find((x) => x.uid === b.dataset.del);
      if (!confirm(`Xoá vĩnh viễn nhân vật "${c.name}" (cấp ${c.level})? Đồ trên người và trong kho đồ sẽ mất (rương chung vẫn giữ). Nên xuất mã trước.`)) return;
      this.roster.chars = chars.filter((x) => x.uid !== c.uid);
      if (this.ch?.uid === c.uid) this.ch = null;
      if (this.roster.active === c.uid) this.roster.active = this.roster.chars[0]?.uid || null;
      saveRoster(this.roster, this.stash, data);
      this.renderSelect();
    }));
    $('#s-new').onclick = () => this.renderSelect(true);
    if (!creating) return;
    const nameEl = $('#s-name');
    let typed = false;
    nameEl.oninput = () => { typed = true; };
    v.querySelectorAll('input[name=cls]').forEach((r) => (r.onchange = () => {
      this.newClass = r.value;
      if (!typed) nameEl.value = this.suggestName(r.value);
    }));
    if ($('#s-cancel')) $('#s-cancel').onclick = () => this.renderSelect(false);
    $('#s-make').onclick = () => {
      const cls = v.querySelector('input[name=cls]:checked').value;
      const ch = P.createCharacter(data, cls, nameEl.value.trim().slice(0, 24));
      this.ch = ch;
      this.lastResult = null;
      this.selectedMap = null;
      this.viewChap = null;
      this.villageModal = null;
      this.save();
      this.state = 'village';
      this.renderVillage();
      this.panel.open('char');
      this.panel.flash('Chọn kỹ năng đầu tiên rồi vào màn 1-1');
    };
    nameEl.onkeydown = (e) => { if (e.key === 'Enter') $('#s-make').click(); };
    v.querySelector('#s-create').scrollIntoView({ block: 'nearest' });
  }

  // Tên gợi ý theo lớp, không trùng tên nhân vật đã có.
  suggestName(classId) {
    const pool = NAME_POOL[classId] || [this.data.classes[classId]?.short || 'Nhân vật'];
    const used = new Set(this.roster.chars.map((c) => c.name));
    const free = pool.filter((n) => !used.has(n));
    if (free.length) return free[Math.floor(Math.random() * free.length)];
    let i = 2;
    while (used.has(`${pool[0]} ${i}`)) i++;
    return `${pool[0]} ${i}`;
  }

  selectChar(uid) {
    this.ch = this.roster.chars.find((c) => c.uid === uid);
    this.roster.active = uid;
    this.lastResult = null;
    this.selectedMap = null;
    this.viewChap = null;
    this.villageModal = null;
    this.save();
    this.state = 'village';
    this.renderVillage();
  }

  currentMap() {
    const u = P.unlockedMaps(this.ch, this.data, this.currentDiff());
    if (!u.includes(this.selectedMap)) this.selectedMap = u[u.length - 1];
    return this.data.maps[this.selectedMap];
  }

  mapPickerHtml() {
    const data = this.data;
    const diff = this.currentDiff();
    const unlocked = new Set(P.unlockedMaps(this.ch, data, diff));
    const cur = this.currentMap();
    const udiffs = P.unlockedDifficulties(this.ch, data);
    const dtabs = data.difficulties.map((d) => {
      const open = udiffs.includes(d.id);
      return `<button class="tab dtab ${d.id === diff ? 'on' : ''}" ${open ? `data-diff="${d.id}"` : 'disabled'} style="--dc:${d.color}" title="${open ? '' : `Mở khi qua hết 20 màn ${esc(data.difficultiesById[d.unlockAfter].name)}`}">${open ? '' : '🔒 '}${esc(d.name)} <small>${P.progressOf(this.ch, d.id)}/${data.mapOrder.length}</small></button>`;
    }).join('');
    const D = data.difficultiesById[diff];
    const byCh = new Map();
    for (const id of data.mapOrder) {
      const m = data.maps[id];
      if (!byCh.has(m.chapterName)) byCh.set(m.chapterName, []);
      byCh.get(m.chapterName).push(m);
    }
    const total = data.mapOrder.length;
    const done = Math.min(total, P.progressOf(this.ch, diff));
    let html = '';
    for (const [name, maps] of byCh) {
      html += `<div class="chap"><div class="chap-name">${esc(name)}</div><div class="maps">${maps.map((m) => {
        const open = unlocked.has(m.id);
        const cleared = (this.ch.mapClears?.[P.clearKey(diff, m.id)] || 0) > 0 || m.index < P.progressOf(this.ch, diff);
        const rec = this.ch.records?.[`${diff}:${m.id}`];
        const pct = Math.round((m.hpMult - 1) * 100);
        const dpct = Math.round((m.dmgMult - 1) * 100);
        return `<button class="map ${open ? '' : 'locked'} ${cleared ? 'cleared' : ''} ${m.id === cur.id ? 'on' : ''}" ${open ? `data-map="${m.id}"` : 'disabled'} title="${esc(m.name)} · máu quái ×${m.hpMult.toFixed(2)}, sát thương ×${m.dmgMult.toFixed(2)}">
          <b>${esc(m.id)}</b><span>${open ? esc(m.name) : 'Chưa mở'}</span><small>${cleared ? '✓ đã qua · ' : open ? '' : '🔒 '}${pct ? `máu +${pct}% · ST +${dpct}%` : 'gốc'}${rec ? ` · ⏱ ${fmtTime(rec)}` : ''}</small></button>`;
      }).join('')}</div></div>`;
    }
    const dInfo = D.id === 'normal' ? '' : ` · ${esc(D.name)}: máu quái ×${D.hpMult}, sát thương ×${D.dmgMult}, quái kháng +${Math.round(D.monsterResist * 100)}%, bạn bị trừ ${Math.round(D.playerResistPenalty * 100)}% kháng, kinh nghiệm ×${D.xpMult}, cấp đồ +${D.ilvlBonus}`;
    return `<section class="tests mappicker"><div class="dtabs">${dtabs}</div><h3>Chọn màn <small>${done}/${total} màn đã qua · mỗi màn: máu quái +${Math.round((data.campaign.hpStep ?? 0) * 100)}%, sát thương +${Math.round((data.campaign.dmgStep ?? 0) * 100)}% (cộng dồn), kinh nghiệm +${Math.round((data.campaign.rewardStep ?? 0) * 100)}%${dInfo} · bấm đúp để vào ngay</small></h3>${html}
      ${this.recordsHtml(diff)}</section>`;
  }

  // Bảng kỷ lục thời gian hạ boss của mọi nhân vật trên trình duyệt này.
  recordsHtml(diff) {
    const data = this.data;
    const rows = [];
    for (const c of this.roster.chars) {
      const cc = c.uid === this.ch?.uid ? this.ch : c;
      for (const [k, v] of Object.entries(cc.records || {})) {
        const [d, map] = k.split(':');
        if (d === diff) rows.push({ map, t: v, name: cc.name, cls: P.getClass(cc, data).short, lvl: cc.level });
      }
    }
    if (!rows.length) return '<details class="records"><summary>Bảng kỷ lục</summary><p class="muted">Chưa có kỷ lục ở độ khó này. Hạ boss để ghi thời gian.</p></details>';
    const best = {};
    for (const r of rows) if (!best[r.map] || r.t < best[r.map].t) best[r.map] = r;
    const list = data.mapOrder.filter((id) => best[id]).map((id) => best[id]);
    return `<details class="records"><summary>Bảng kỷ lục (${esc(data.difficultiesById[diff].name)}, trên trình duyệt này)</summary>
      <table class="hist"><thead><tr><th>Màn</th><th>Thời gian hạ boss</th><th>Nhân vật</th></tr></thead><tbody>
      ${list.map((r) => `<tr><td>${esc(r.map)} ${esc(data.maps[r.map].name)}</td><td>${fmtTime(r.t)}</td><td>${esc(r.name)} (${esc(r.cls)}, cấp ${r.lvl})</td></tr>`).join('')}
      </tbody></table><p class="muted" style="font-size:11px">Bảng xếp hạng chung với người chơi khác cần có server, chưa có trong bản này.</p></details>`;
  }

  // ---------- Làng: một màn hình gọn ----------
  // Trái: thẻ nhân vật + nút mở bảng. Giữa: bản đồ theo chương + nút Vào màn. Ít dùng: menu ⚙ và nút ?.
  // Hộp thoại (this.villageModal): 'result' kết quả trận, 'overflow' túi tạm, 'menu' khác, 'help' cách chơi.
  renderVillage() {
    const v = $('#village');
    v.classList.remove('hidden');
    const ch = this.ch;
    const data = this.data;
    const need = P.xpToNext(ch.level, data.config);
    const st = P.computeStats(ch, data);
    const cls = P.getClass(ch, data);
    const diff = this.currentDiff();
    const cur = this.currentMap();
    const udiffs = P.unlockedDifficulties(ch, data);
    const dseg = data.difficulties.map((d) => {
      const open = udiffs.includes(d.id);
      return `<button class="seg ${d.id === diff ? 'on' : ''}" ${open ? `data-diff="${d.id}"` : 'disabled'} style="--dc:${d.color}" title="${open ? `${P.progressOf(ch, d.id)}/${data.mapOrder.length} màn đã qua` : `Mở khi qua hết 20 màn ${esc(data.difficultiesById[d.unlockAfter].name)}`}">${open ? '' : '🔒 '}${esc(d.name)} <small>${P.progressOf(ch, d.id)}/${data.mapOrder.length}</small></button>`;
    }).join('');
    const pts = ch.attrPoints + ch.skillPoints;
    const invUsed = ch.inventory.filter(Boolean).length;
    const over = ch.overflow || [];
    const trees = cls.trees.map((t) => `${data.treesById[t].name} ${data.skillList.filter((s) => s.tree === t).reduce((n, s) => n + (ch.skills[s.id] || 0), 0)}`).join(' · ');
    const noSkill = !P.hasActiveSkill(ch);

    v.innerHTML = `<div class="hub">
      <header class="hub-top">
        <div class="brand">ARPG Survivor <small>bản ${esc(data.config.version)} · Làng</small></div>
        <div class="dseg">${dseg}</div>
        <div class="hub-actions"><button id="v-help" class="icon" title="Cách chơi">?</button><button id="v-menu" class="icon" title="Khác: xuất/nhập mã, tẩy điểm, kỷ lục, log">⚙</button></div>
      </header>
      <aside class="hub-char" style="--cc:${cls.color}">
        <div class="hc-head">
          <canvas data-portrait="${cls.look}" width="96" height="120"></canvas>
          <div class="hc-id"><b>${esc(ch.name)}</b><span>${esc(cls.name)}</span>
            <button id="v-switch" class="ghost mini" title="Đổi / tạo nhân vật">⇄ Đổi nhân vật</button></div>
        </div>
        <div class="hc-lvl">Cấp ${ch.level}</div>
        <div class="xpbar" title="${Math.floor(ch.xp)} / ${need} kinh nghiệm"><div style="width:${Math.min(100, (ch.xp / need) * 100)}%"></div></div>
        <div class="hc-money"><span class="gold">${ch.gold.toLocaleString('vi-VN')} vàng</span><span class="shards">${(ch.shards || 0).toLocaleString('vi-VN')} mảnh</span></div>
        <div class="hc-attrs">${P.ATTRS.map((k) => `<span>${ATTR_NAMES[k]} <b>${st.attrs[k]}</b></span>`).join('')}<span>Máu <b>${Math.round(st.maxHp)}</b></span><span>Mana <b>${Math.round(st.maxMana)}</b></span></div>
        <div class="hc-btns">
          <button id="v-panel">Nhân vật ${pts ? `<span class="badge">${pts}</span>` : ''}</button>
          <button id="v-items">Đồ đạc <small>${invUsed}/${ch.inventory.length}</small></button>
          <button id="v-stash">Rương chung <small>${this.stash.filter(Boolean).length}/${this.stash.length}</small></button>
          <button id="v-craft">Lò chế</button>
        </div>
        <div class="hc-foot muted">${trees}<br>${ch.runs} lượt · ${ch.clears} lần hoàn thành · ${ch.deaths} lần chết</div>
      </aside>
      <main class="hub-map">
        ${this.chapterHtml(diff, cur)}
        <div class="hub-go">
          ${over.length ? `<button id="v-overflow" class="ovf-btn">Túi tạm: ${over.length} món chờ xử lý</button>` : ''}
          ${noSkill ? `<div class="warn">Chưa có kỹ năng chủ động: bấm "Nhân vật" và học một kỹ năng cấp 1.</div>` : ''}
          ${pts && !noSkill ? `<div class="unspent">Còn ${ch.attrPoints} điểm thuộc tính, ${ch.skillPoints} điểm kỹ năng</div>` : ''}
          <button id="v-start" class="primary go">▶ Vào màn ${esc(cur.id)}: ${esc(cur.name)}<small>Enter${diff !== 'normal' ? ` · ${esc(data.difficultiesById[diff].name)}` : ''}</small></button>
        </div>
      </main>
    </div>
    ${this.villageModal ? `<div class="vmodal" id="v-modal"><div class="vm-box ${this.villageModal}">${this.modalHtml(this.villageModal)}</div></div>` : ''}`;

    v.querySelectorAll('canvas[data-portrait]').forEach((c) => drawPortrait(c, c.dataset.portrait));
    const go = () => this.startRun();
    $('#v-start').onclick = go;
    v.querySelectorAll('[data-diff]').forEach((b) => (b.onclick = () => { this.selectedDiff = b.dataset.diff; this.selectedMap = null; this.viewChap = null; this.renderVillage(); }));
    v.querySelectorAll('[data-chap]').forEach((b) => (b.onclick = () => { this.viewChap = b.dataset.chap; this.renderVillage(); }));
    v.querySelectorAll('[data-map]').forEach((b) => {
      b.onclick = () => { this.selectedMap = b.dataset.map; this.renderVillage(); };
      b.ondblclick = () => { this.selectedMap = b.dataset.map; this.startRun(); };
    });
    $('#v-panel').onclick = () => this.panel.open('char');
    $('#v-items').onclick = () => this.panel.open('items');
    $('#v-stash').onclick = () => this.panel.open('stash');
    $('#v-craft').onclick = () => this.panel.open('craft');
    $('#v-switch').onclick = () => { this.save(); this.renderSelect(); };
    $('#v-help').onclick = () => this.openModal('help');
    $('#v-menu').onclick = () => this.openModal('menu');
    if ($('#v-overflow')) $('#v-overflow').onclick = () => this.openModal('overflow');
    if (this.villageModal) this.bindModal(v);
  }

  openModal(m) {
    this.villageModal = m;
    this.renderVillage();
  }

  closeModal() {
    if (!this.villageModal) return false;
    this.villageModal = null;
    this.renderVillage();
    return true;
  }

  // Bản đồ: thẻ chương + 5 màn của chương đang xem nối bằng đường đi, kèm thông tin màn đang chọn.
  chapterHtml(diff, cur) {
    const data = this.data;
    const ch = this.ch;
    const unlocked = new Set(P.unlockedMaps(ch, data, diff));
    const prog = P.progressOf(ch, diff);
    const chaps = [];
    for (const id of data.mapOrder) {
      const m = data.maps[id];
      let c = chaps.find((x) => x.name === m.chapterName);
      if (!c) chaps.push((c = { name: m.chapterName, maps: [] }));
      c.maps.push(m);
    }
    if (!chaps.some((c) => c.name === this.viewChap)) this.viewChap = cur.chapterName;
    const view = chaps.find((c) => c.name === this.viewChap);
    const isCleared = (m) => (ch.mapClears?.[P.clearKey(diff, m.id)] || 0) > 0 || m.index < prog;
    const tabs = chaps.map((c, i) => {
      const open = c.maps.some((m) => unlocked.has(m.id));
      const done = c.maps.every(isCleared);
      return `<button class="chap-tab ${c === view ? 'on' : ''} ${done ? 'done' : ''}" ${open ? `data-chap="${esc(c.name)}"` : 'disabled'} title="${esc(c.name)}">${open ? '' : '🔒 '}${i + 1}. ${esc(c.name.replace(/^Chương \d+:\s*/i, ''))}${done ? ' ✓' : ''}</button>`;
    }).join('');
    const nodes = view.maps.map((m, i) => {
      const open = unlocked.has(m.id);
      const cleared = isCleared(m);
      const last = i === view.maps.length - 1;
      return `<button class="mnode ${open ? '' : 'locked'} ${cleared ? 'cleared' : ''} ${m.id === cur.id ? 'on' : ''} ${last ? 'final' : ''}" ${open ? `data-map="${m.id}"` : 'disabled'} title="${esc(m.name)}">
        <span class="dot">${cleared ? '✓' : open ? (last ? '👑' : '●') : '🔒'}</span><b>${esc(m.id)}</b><small>${open ? esc(m.name) : 'Chưa mở'}</small></button>`;
    }).join('<i class="link"></i>');
    const D = data.difficultiesById[diff];
    const pct = Math.round((cur.hpMult - 1) * 100), dpct = Math.round((cur.dmgMult - 1) * 100);
    const rec = ch.records?.[`${diff}:${cur.id}`];
    const clears = ch.mapClears?.[P.clearKey(diff, cur.id)] || 0;
    const dInfo = D.id === 'normal' ? '' : `<div class="mi-diff" style="color:${D.color}">${esc(D.name)}: máu quái ×${D.hpMult}, sát thương ×${D.dmgMult}, quái kháng +${Math.round(D.monsterResist * 100)}%, bạn bị trừ ${Math.round(D.playerResistPenalty * 100)}% kháng, kinh nghiệm ×${D.xpMult}, cấp đồ +${D.ilvlBonus}</div>`;
    return `<div class="chap-tabs">${tabs}</div>
      <div class="path">${nodes}</div>
      <div class="mapinfo">
        <h2>${esc(cur.id)} ${esc(cur.name)}</h2>
        <div class="mi-stats"><span>${pct ? `Máu quái +${pct}%` : 'Máu quái gốc'}</span><span>${dpct ? `Sát thương +${dpct}%` : 'Sát thương gốc'}</span><span>${clears ? `Đã qua ${clears} lần` : 'Chưa qua'}</span><span>${rec ? `Kỷ lục ⏱ ${fmtTime(rec)}` : 'Chưa có kỷ lục'}</span></div>
        ${dInfo}
        <div class="muted mi-note">${prog}/${data.mapOrder.length} màn đã qua · mỗi màn máu quái +${Math.round((data.campaign.hpStep ?? 0) * 100)}%, sát thương +${Math.round((data.campaign.dmgStep ?? 0) * 100)}%, kinh nghiệm +${Math.round((data.campaign.rewardStep ?? 0) * 100)}% · bấm đúp vào màn để vào ngay</div>
      </div>`;
  }

  modalHtml(m) {
    const data = this.data;
    const ch = this.ch;
    const close = '<button class="vm-x" data-vm-close title="Đóng (Esc)">×</button>';
    if (m === 'result') return close + this.resultHtml();
    if (m === 'overflow') return close + `<h2>Túi tạm</h2>${this.overflowHtml() || '<p class="muted">Túi tạm trống.</p>'}<div class="vm-btns"><button data-vm-close class="primary">Xong</button></div>`;
    if (m === 'help') {
      return close + `<h2>Cách chơi</h2><ul class="help-list">
        <li><b>WASD</b> hoặc phím mũi tên để di chuyển. Kỹ năng tự kích hoạt và tốn mana. Tối đa 4 kỹ năng chủ động, có thể lấy từ nhiều nhánh.</li>
        <li><b>Tab</b>, <b>C</b> hoặc nút <b>+</b>: bảng cộng điểm. <b>I</b>: đồ đạc. Game dừng hẳn khi bảng mở. <b>Shift</b> + bấm để cộng 5 điểm.</li>
        <li>Phím <b>1</b>–<b>4</b>: cộng nhanh 1 điểm Sức mạnh / Nhanh nhẹn / Thể lực / Năng lượng.</li>
        <li>Đồ tự nhặt khi đi qua (nếu kho còn chỗ). Đồ có yêu cầu cấp: nhặt sớm, lên cấp mới mặc được. Bán đồ và tẩy điểm ở làng. Ctrl + bấm vào đồ: bán ngay (ở làng) hoặc đánh dấu rác (trong màn).</li>
        <li>Hạ boss cuối màn: quái biến mất, nhặt <b>rương thưởng</b> rồi 5 giây sau kết thúc màn.</li>
        <li>Băng: 3 đòn băng liên tiếp sẽ đóng băng quái 1 giây (tinh anh nửa thời gian, boss miễn nhiễm).</li>
        <li>Ở làng: <b>Enter</b> để vào màn đang chọn, <b>Esc</b> để đóng hộp thoại.</li>
      </ul><div class="vm-btns"><button data-vm-close class="primary">Đã hiểu</button></div>`;
    }
    // menu ⚙ Khác
    const quick = L.bulkCandidates(ch, data, 'normal');
    const cost = P.respecCost(ch, data);
    const runs = T.getRuns();
    const recent = runs.slice(-8).reverse();
    const sum = T.summarize(runs);
    const hist = recent.length ? `<table class="hist"><thead><tr><th>Người chơi</th><th>Kết quả</th><th>Thời gian</th><th>Cấp</th><th>Giết</th><th>Mở bảng</th><th>Nguyên nhân</th></tr></thead><tbody>${recent.map((x) => `<tr><td>${esc(x.tester)}</td><td>${x.result === 'win' ? 'Thắng' : x.result === 'quit' ? 'Bỏ' : 'Chết'}</td><td>${fmtTime(x.timeSec)}</td><td>${x.startLevel}→${x.endLevel}</td><td>${x.kills}</td><td>${x.panelOpens} lần, TB ${x.avgPanelSeconds}s</td><td>${esc(x.cause || '-')}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">Chưa có lượt nào.</p>';
    return close + `<h2>Khác</h2>
      <section><h3 class="sec-title">Đồ đạc và nhân vật</h3>
        <div class="village-tools">
          <button id="v-sellnormal" ${quick.length ? '' : 'disabled'}>Bán ${quick.length} món thường (${L.sumValue(ch, quick, data)} vàng)</button>
          <button id="v-bulk">Bán nhanh / quản lý đồ…</button>
          <button id="v-respec" ${ch.gold >= cost ? '' : 'disabled'}>Tẩy điểm (${cost} vàng)</button>
        </div></section>
      <section><h3 class="sec-title">Lưu trữ</h3>
        <div class="village-tools"><button id="v-export">Xuất mã nhân vật</button><button id="v-import">Nhập mã</button></div>
        <div id="v-codebox" class="code-box hidden"></div>
        <p class="muted" style="margin:8px 0 0;font-size:12px">Nhân vật và rương tự lưu trên trình duyệt này. Xoá dữ liệu trình duyệt sẽ mất nhân vật: hãy "Xuất mã nhân vật" và cất mã ở nơi khác. Mã gồm cả rương chung.</p></section>
      <section>${this.recordsHtml(this.currentDiff())}</section>
      <section><details class="tester"><summary>Chơi thử: log lượt chơi và góp ý</summary>
        <div class="row">
          <label>Tên người chơi thử <input id="v-tester" value="${esc(this.tester)}" placeholder="VD: Người 1"></label>
          <button id="v-log">Xuất log (JSON)</button>
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
        </details></details></section>`;
  }

  // Hộp thoại kết quả trận.
  resultHtml() {
    const data = this.data;
    const r = this.lastResult;
    if (!r) return '<p class="muted">Chưa có lượt nào.</p>';
    const rm = data.maps[r.map];
    const dn = data.difficultiesById[r.mode || 'normal'];
    const title = r.result === 'win' ? `Hoàn thành màn ${esc(r.map)}: ${esc(rm ? rm.name : '')}!` : r.result === 'quit' ? 'Đã bỏ lượt' : `Gục ngã ở màn ${esc(r.map)}`;
    const nm = r.nextMapUnlocked && data.maps[r.nextMapUnlocked];
    const lines = [];
    if (r.result === 'win') {
      if (r.chestLoot) lines.push(`<div class="chest">🎁 Rương: ${r.chestLoot.map((x) => `<b style="color:${x.rune ? data.runes.byId[x.rune].color : data.items.rarities[x.rarity].color}">${esc(x.name)}</b>`).join(', ')}${r.chestShards ? ` · +${r.chestShards} mảnh` : ''}</div>`);
      if (r.newDifficulty) lines.push(`<div class="chest big">🔓 Mở độ khó mới: <b style="color:${data.difficultiesById[r.newDifficulty].color}">${esc(data.difficultiesById[r.newDifficulty].name)}</b>! Quái mạnh hơn nhiều, có kháng nguyên tố; đồ và kinh nghiệm tốt hơn.</div>`);
      if (nm) lines.push(`<div class="chest">🔓 Mở màn <b>${esc(nm.id)} ${esc(nm.name)}</b> (máu quái ×${nm.hpMult.toFixed(2)}).</div>`);
      if (r.newRecord) lines.push(`<div class="chest">⏱ Kỷ lục mới: hạ boss lúc ${fmtTime(r.timeSec)}!</div>`);
      if (r.flawless) lines.push('<div class="chest">Hòm thưởng thêm: hoàn thành mà chưa chết lần nào ở bản đồ này!</div>');
    } else if (r.result !== 'quit') {
      lines.push(`<div>Nguyên nhân: <b>${esc(r.cause || '-')}</b>. Kinh nghiệm, cấp và đồ đã nhặt vẫn được giữ; màn phải chơi lại từ đầu.</div>`);
    }
    const loot = (r.itemsPicked || []).filter((x) => x.rarity !== 'normal');
    const next = this.currentMap();
    const nextLabel = r.result === 'win' && (nm || r.newDifficulty) ? `▶ Chơi tiếp ${esc(next.id)}` : r.result === 'win' ? `▶ Chơi lại ${esc(next.id)}` : `▶ Thử lại ${esc(next.id)}`;
    const ovf = this.overflowHtml();
    return `<div class="result ${r.result}">
      <h2>${title} <small style="color:${dn.color}">${esc(dn.name)}</small></h2>
      <div class="grid4">
        <div><span>Thời gian</span><b>${fmtTime(r.timeSec)}</b></div>
        <div><span>Cấp</span><b>${r.startLevel} → ${r.endLevel}</b></div>
        <div><span>Đã giết</span><b>${r.kills}</b></div>
        <div><span>Boss</span><b>${r.bossReached ? (r.result === 'win' ? 'Đã hạ' : `còn ${r.bossHpPct}%`) : 'Chưa gặp'}</b></div>
      </div>
      ${lines.join('')}
      ${r.junkSold ? `<div>Đã tự bán ${r.junkSold.n} món đánh dấu rác: +${r.junkSold.gold} vàng.</div>` : ''}
      ${r.autoSold ? `<div>Bộ lọc nhặt đã tự bán ${r.autoSold} món thường.</div>` : ''}
      <div class="muted">Nhặt được ${(r.itemsPicked || []).length} món, ${r.gold || 0} vàng${loot.length ? ': ' + loot.map((x) => `<span style="color:${data.items.rarities[x.rarity].color}">${esc(x.name)}</span>`).join(', ') : ''}.</div>
    </div>
    ${ovf ? `<h3 class="sec-title">Túi tạm</h3>${ovf}` : ''}
    <div class="vm-btns"><button id="r-next" class="primary">${nextLabel} <small>Enter</small></button><button data-vm-close>Về làng</button></div>`;
  }

  overflowHtml() {
    const data = this.data;
    const over = this.ch.overflow || [];
    if (!over.length) return '';
    return `<p class="muted" style="margin:0 0 6px;font-size:12px">${over.length} món từ rương thưởng chưa vừa kho đồ. Giữ: cho vào kho đồ, kho đầy thì cho vào rương chung. Đồ trong túi tạm được lưu cho tới khi bạn chọn.</p>
      <div class="ovf-list">${over.map((it, i) => `<div class="ovf"><span style="color:${it.type === 'rune' ? data.runes.byId[it.rune].color : data.items.rarities[it.rarity].color}">${esc(it.name)}${I.runeQty(it) > 1 ? ` ×${I.runeQty(it)}` : ''}</span><small>cấp đồ ${it.ilvl}</small>
        <button data-ovf-keep="${i}">Giữ</button><button data-ovf-sell="${i}" class="ghost">Bán ${I.sellValue(it, data)}</button></div>`).join('')}</div>
      <div class="row"><button id="ovf-keepall">Giữ hết</button><button id="ovf-sellall" class="ghost">Bán hết (${over.reduce((n, it) => n + I.sellValue(it, data), 0)} vàng)</button></div>`;
  }

  bindModal(v) {
    const ch = this.ch;
    const data = this.data;
    const q = (s) => v.querySelector(s);
    q('#v-modal').onclick = (e) => { if (e.target.id === 'v-modal') this.closeModal(); };
    v.querySelectorAll('[data-vm-close]').forEach((b) => (b.onclick = () => this.closeModal()));
    if (q('#r-next')) q('#r-next').onclick = () => { this.villageModal = null; this.startRun(); if (this.state !== 'run') this.renderVillage(); };
    // Túi tạm
    const ovfKeep = (i) => {
      const it = ch.overflow[i];
      if (I.addToInventory(ch, it)) { ch.overflow.splice(i, 1); return true; }
      if (I.addToArray(this.stash, it)) { ch.overflow.splice(i, 1); return true; }
      return false;
    };
    const ovfSell = (i) => {
      const it = ch.overflow[i];
      const val = I.sellValue(it, data);
      ch.gold += val;
      ch.buyback = [{ item: it, price: val }, ...(ch.buyback || [])].slice(0, L.BUYBACK_MAX);
      ch.overflow.splice(i, 1);
    };
    const after = () => { this.save(); this.renderVillage(); };
    v.querySelectorAll('[data-ovf-keep]').forEach((b) => (b.onclick = () => { if (!ovfKeep(Number(b.dataset.ovfKeep))) alert('Kho đồ và rương chung đều đầy. Hãy bán bớt đồ trước.'); after(); }));
    v.querySelectorAll('[data-ovf-sell]').forEach((b) => (b.onclick = () => { ovfSell(Number(b.dataset.ovfSell)); after(); }));
    if (q('#ovf-keepall')) q('#ovf-keepall').onclick = () => { while (ch.overflow.length && ovfKeep(0)); if (ch.overflow.length) alert('Kho đồ và rương chung đều đầy, còn lại trong túi tạm.'); after(); };
    if (q('#ovf-sellall')) q('#ovf-sellall').onclick = () => { if (!confirm(`Bán hết ${ch.overflow.length} món trong túi tạm?`)) return; while (ch.overflow.length) ovfSell(0); after(); };
    if (this.villageModal !== 'menu') return;
    // Menu ⚙ Khác
    q('#v-sellnormal').onclick = () => { L.sellItems(ch, L.bulkCandidates(ch, data, 'normal'), data); after(); };
    q('#v-bulk').onclick = () => { this.villageModal = null; this.renderVillage(); this.panel.open('items'); };
    const cost = P.respecCost(ch, data);
    q('#v-respec').onclick = () => {
      if (!confirm(`Tẩy điểm với giá ${cost} vàng? Toàn bộ điểm thuộc tính và kỹ năng sẽ được trả lại để cộng lại từ đầu.`)) return;
      const res = P.respec(ch, data);
      if (res !== 'ok') alert(res);
      this.villageModal = null;
      after();
      if (res === 'ok') this.panel.open('char');
    };
    const box = q('#v-codebox');
    q('#v-export').onclick = () => {
      const code = exportCode(ch, this.stash, data);
      box.classList.remove('hidden');
      box.innerHTML = `<p>Mã nhân vật (cấp ${ch.level}, ${ch.inventory.filter(Boolean).length + Object.values(ch.equipment).filter(Boolean).length} món, rương ${this.stash.filter(Boolean).length} món). Chép và cất ở nơi an toàn:</p><textarea readonly id="v-code">${esc(code)}</textarea><button id="v-copy">Sao chép</button> <span id="v-copied" class="muted"></span>`;
      $('#v-copy').onclick = async () => {
        const ta = $('#v-code');
        ta.select();
        try { await navigator.clipboard.writeText(code); $('#v-copied').textContent = 'Đã sao chép.'; } catch { document.execCommand('copy'); $('#v-copied').textContent = 'Đã chọn mã, hãy nhấn Ctrl+C.'; }
      };
    };
    q('#v-import').onclick = () => {
      box.classList.remove('hidden');
      box.innerHTML = '<p>Dán mã nhân vật vào đây. Nhân vật trong mã được thêm vào danh sách (trùng nhân vật thì ghi đè); đồ trong rương của mã được thêm vào các ô trống của rương chung.</p><textarea id="v-code-in" placeholder="ARPG1.…"></textarea><button id="v-do-import" class="primary">Nhập</button> <span id="v-imp-msg" class="bad"></span>';
      $('#v-do-import').onclick = () => {
        try {
          const res = importCode($('#v-code-in').value, data);
          const dup = this.roster.chars.find((c) => c.uid === res.ch.uid);
          if (!confirm(dup ? `Ghi đè nhân vật "${dup.name}" (cấp ${dup.level}) bằng bản trong mã (cấp ${res.ch.level})?` : `Thêm nhân vật "${res.ch.name}" cấp ${res.ch.level}?`)) return;
          this.ch = res.ch;
          const have = new Set(this.stash.filter(Boolean).map((x) => x.uid));
          for (const it of res.stash) if (it && !have.has(it.uid)) I.addToArray(this.stash, it);
          this.lastResult = null;
          this.villageModal = null;
          this.viewChap = null;
          this.selectedMap = null;
          this.save();
          this.renderVillage();
        } catch (e) {
          $('#v-imp-msg').textContent = e.message;
        }
      };
    };
    q('#v-tester').onchange = (e) => {
      this.tester = e.target.value.trim();
      try { localStorage.setItem('arpg_s0_tester', this.tester); } catch { /* bỏ qua */ }
    };
    q('#v-log').onclick = () => T.exportAll();
    q('#v-clear').onclick = () => { if (confirm('Xoá toàn bộ log lượt chơi và góp ý?')) { T.clearAll(); this.renderVillage(); } };
    q('#v-fb').onclick = () => {
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
