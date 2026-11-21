// Bảng nhân vật: thẻ "Nhân vật" (thuộc tính + cây kỹ năng Lửa/Băng/Sét), "Đồ đạc" (trang bị + kho), "Rương" (chỉ ở làng).
// Game dừng hẳn khi bảng mở.
import * as P from '../core/progression.js';
import * as I from '../core/items.js';
import { drawSkillIcon } from './render.js';
import { describeSkill, synergyText } from './skilltext.js';

const NODE = 78, COL_W = 104, ROW_H = 100;
const pctStr = (v) => `${Math.round(v * 1000) / 10}%`;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export class Panel {
  constructor(root, data, hooks) {
    this.root = root;
    this.data = data;
    this.hooks = hooks; // { getChar, getGame, getStash, isVillage, onClosed, onChanged }
    this.isOpen = false;
    this.tab = 'char';
    this.tree = 'fire';
    this.selected = 'fireball';
    this.sel = null; // món đang chọn: { where: 'inv'|'eq'|'stash', key }
    this.pendingLearn = null;
    root.querySelector('#btn-undo').addEventListener('click', () => this.undo());
    root.querySelector('#btn-continue').addEventListener('click', () => this.close());
    this.body = root.querySelector('#panel-body');
    this.tabsEl = root.querySelector('#panel-tabs');
    this.titleEl = root.querySelector('#panel-title');
    this.dialog = root.querySelector('#replace-dialog');
    root.addEventListener('click', (ev) => this.onClick(ev));
    root.addEventListener('pointerover', (ev) => {
      const n = ev.target.closest('[data-node]');
      if (n && n.dataset.node !== this.selected) { this.selected = n.dataset.node; this.renderDetails(); this.markSelected(); }
    });
  }

  get ch() { return this.hooks.getChar(); }
  get game() { return this.hooks.getGame(); }
  get village() { return this.hooks.isVillage(); }

  stats() {
    const g = this.game;
    return g ? g.stats : P.computeStats(this.ch, this.data);
  }

  open(tab) {
    if (tab) this.tab = tab;
    if (this.tab === 'stash' && !this.village) this.tab = 'items';
    if (this.isOpen) { this.render(); return; }
    this.isOpen = true;
    this.snap = P.snapshot(this.ch);
    this.openedAt = performance.now();
    this.game?.beginEdit();
    this.root.classList.remove('hidden');
    this.dialog.classList.add('hidden');
    this.sel = null;
    this.render();
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    const diff = P.allocationDiff(this.snap, this.ch);
    const ms = performance.now() - this.openedAt;
    const g = this.game;
    if (g) {
      g.recordAllocation(diff);
      g.log.panelOpens++;
      g.log.panelMs += ms;
      g.endEdit();
    }
    this.root.classList.add('hidden');
    this.hooks.onClosed({ diff, ms });
  }

  undo() {
    P.restoreAllocation(this.ch, this.snap);
    this.changed();
  }

  changed() {
    this.game?.refreshStats();
    this.render();
    this.hooks.onChanged?.();
  }

  flash(msg) {
    const el = this.root.querySelector('#panel-msg');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(this.msgT);
    this.msgT = setTimeout(() => el.classList.remove('show'), 2200);
  }

  // ---------- Sự kiện ----------
  onClick(ev) {
    const t = ev.target.closest('button, [data-node], [data-cell]');
    if (!t) return;
    const d = t.dataset;
    if (d.tab) { this.tab = d.tab; this.sel = null; this.render(); return; }
    if (d.tree) { this.tree = d.tree; this.selected = this.data.skillList.find((s) => s.tree === d.tree).id; this.render(); return; }
    if (d.attr) {
      if (P.addAttr(this.ch, d.attr, ev.shiftKey ? 5 : 1)) this.changed();
      return;
    }
    if (d.learn) { ev.stopPropagation(); this.learn(d.learn); return; }
    if (d.replace !== undefined) {
      const id = this.pendingLearn;
      this.dialog.classList.add('hidden');
      this.pendingLearn = null;
      if (d.replace !== 'cancel' && id) { P.learnSkill(this.ch, id, this.data, Number(d.replace)); this.changed(); }
      return;
    }
    if (d.equip) {
      const [id, slot] = d.equip.split(':');
      P.equipSkill(this.ch, id, Number(slot));
      this.changed();
      return;
    }
    if (d.node) { this.selected = d.node; this.renderDetails(); this.markSelected(); return; }
    if (d.cell) {
      // Tự nhận bấm đúp: lần bấm đầu vẽ lại bảng nên sự kiện dblclick của trình duyệt không tới được.
      const now = performance.now();
      const dbl = this.lastCell === d.cell && now - this.lastCellT < 400;
      this.lastCell = d.cell;
      this.lastCellT = now;
      const [where, key] = d.cell.split(':');
      this.sel = { where, key };
      if (dbl && this.selItem()) { this.lastCell = null; this.doubleAction(); return; }
      this.render();
      return;
    }
    if (d.act) this.itemAction(d.act);
  }

  doubleAction() {
    const where = this.sel.where;
    if (where === 'eq') this.itemAction('unequip');
    else if (where === 'stash') this.itemAction('take');
    else if (this.tab === 'stash') this.itemAction('store');
    else this.itemAction('wear');
  }

  learn(id) {
    this.selected = id;
    const res = P.learnSkill(this.ch, id, this.data);
    if (res === 'ok') this.changed();
    else if (res === 'needSlot') this.showReplace(id);
    else this.flash(res);
  }

  showReplace(id) {
    this.pendingLearn = id;
    const sk = this.data.skills[id];
    const btns = this.ch.slots.map((sid, i) => {
      const s = this.data.skills[sid];
      return `<button data-replace="${i}">Thay ${esc(s ? s.name : 'ô trống')} (ô ${i + 1})</button>`;
    }).join('');
    this.dialog.innerHTML = `<div class="dlg"><h3>Đã đầy 4 ô kỹ năng</h3><p>Chọn kỹ năng sẽ bị thay bằng <b>${esc(sk.name)}</b>. Kỹ năng bị thay vẫn giữ cấp, có thể gắn lại sau.</p><div class="dlg-btns">${btns}<button data-replace="cancel" class="ghost">Huỷ</button></div></div>`;
    this.dialog.classList.remove('hidden');
  }

  selItem() {
    const s = this.sel;
    if (!s) return null;
    if (s.where === 'inv') return this.ch.inventory[s.key];
    if (s.where === 'eq') return this.ch.equipment[s.key];
    if (s.where === 'stash') return this.hooks.getStash()[s.key];
    return null;
  }

  itemAction(act) {
    const ch = this.ch, s = this.sel;
    if (!s) return;
    const stash = this.hooks.getStash();
    let res = 'ok';
    if (act === 'wear' && s.where === 'inv') res = I.equipFromInventory(ch, Number(s.key), this.data);
    else if (act === 'unequip' && s.where === 'eq') res = I.unequip(ch, s.key);
    else if (act === 'store' && s.where === 'inv') res = I.transfer(ch.inventory, Number(s.key), stash) === 'ok' ? 'ok' : 'Rương đã đầy';
    else if (act === 'take' && s.where === 'stash') res = I.transfer(stash, Number(s.key), ch.inventory) === 'ok' ? 'ok' : 'Kho đồ đầy';
    else if (act === 'sell' && s.where === 'inv') {
      const it = ch.inventory[s.key];
      ch.gold += I.sellValue(it, this.data);
      ch.inventory[s.key] = null;
      this.flash(`+${I.sellValue(it, this.data)} vàng`);
    } else if (act === 'drop' && s.where === 'inv') {
      ch.inventory[s.key] = null;
    } else return;
    if (res !== 'ok') { this.flash(res); return; }
    this.sel = null;
    this.changed();
  }

  // ---------- Vẽ ----------
  render() {
    const ch = this.ch;
    this.titleEl.textContent = `${this.data.tree.className} — Cấp ${ch.level}`;
    const tabs = [['char', 'Nhân vật'], ['items', 'Đồ đạc']];
    if (this.village) tabs.push(['stash', 'Rương chung']);
    const pts = ch.attrPoints + ch.skillPoints;
    this.tabsEl.innerHTML = tabs.map(([id, n]) => `<button class="tab ${this.tab === id ? 'on' : ''}" data-tab="${id}">${n}${id === 'char' && pts ? ` <span class="badge">${pts}</span>` : ''}</button>`).join('') +
      `<span class="gold">${ch.gold.toLocaleString('vi-VN')} vàng</span>`;
    if (this.tab === 'char') this.renderChar();
    else if (this.tab === 'items') this.renderItems(false);
    else this.renderItems(true);
    const hasChanges = JSON.stringify(P.snapshot(ch)) !== JSON.stringify(this.snap);
    this.root.querySelector('#btn-undo').disabled = !hasChanges;
    this.root.querySelector('#btn-undo').classList.toggle('hidden', this.tab !== 'char');
  }

  renderChar() {
    this.body.innerHTML = '<div class="panel-cols"><section id="attr-col"></section><section id="skill-col"></section></div>';
    this.attrEl = this.body.querySelector('#attr-col');
    this.skillEl = this.body.querySelector('#skill-col');
    this.renderAttrs();
    this.renderSkills();
  }

  renderAttrs() {
    const ch = this.ch;
    const cfg = this.data.config;
    const st = this.stats();
    const rows = P.ATTRS.map((k) => {
      const a = cfg.attributes[k];
      const added = ch.attrs[k] - this.snap.attrs[k];
      const bonus = st.attrs[k] - ch.attrs[k];
      return `<div class="attr-row">
        <div class="attr-name"><span class="key">${a.key}</span>${esc(a.name)}</div>
        <div class="attr-val">${st.attrs[k]}${bonus ? `<span class="gear" title="từ đồ">(${ch.attrs[k]}+${bonus})</span>` : ''}${added ? `<span class="added">+${added}</span>` : ''}</div>
        <button class="plus" data-attr="${k}" ${ch.attrPoints ? '' : 'disabled'} title="Giữ Shift để cộng 5">+</button>
        <div class="attr-desc">${esc(a.desc)}</div>
      </div>`;
    }).join('');
    const p = this.game?.player;
    const hp = p ? `${Math.ceil(p.hp)} / ${Math.round(st.maxHp)}` : Math.round(st.maxHp);
    const mana = p ? `${Math.floor(p.mana)} / ${Math.round(st.maxMana)}` : Math.round(st.maxMana);
    const red = Math.min(cfg.caps.armorReduction, st.armor / (st.armor + cfg.armor.base + cfg.armor.perMonsterLevel));
    const res = (k) => pctStr(Math.min(cfg.caps.playerResist, st.resist[k]));
    this.attrEl.innerHTML = `
      <div class="pts ${ch.attrPoints ? 'has' : ''}">Điểm thuộc tính: <b>${ch.attrPoints}</b> <small>(Shift + bấm: cộng 5)</small></div>
      ${rows}
      <div class="derived">
        <div><span>Máu</span><b>${hp}</b></div>
        <div><span>Mana</span><b>${mana}</b></div>
        <div><span>Hồi mana</span><b>${st.manaRegen.toFixed(1)}/giây</b></div>
        <div><span>Tốc độ hồi chiêu</span><b>+${pctStr(st.cdSpeed - 1)}</b></div>
        <div><span>Né</span><b>${pctStr(st.dodge)}</b></div>
        <div><span>Sát thương phép</span><b>+${pctStr(st.spellDmgPct)}</b></div>
        <div><span>Lửa / Băng / Sét</span><b>+${pctStr(st.elemDmgPct.fire)} / +${pctStr(st.elemDmgPct.cold)} / +${pctStr(st.elemDmgPct.lightning)}</b></div>
        <div><span>Chí mạng</span><b>${pctStr(st.critChance)} ×${st.critMult}</b></div>
        <div><span>Giáp</span><b>${st.armor} (−${pctStr(red)} vs cấp 1)</b></div>
        <div><span>Kháng L/B/S/Độc</span><b>${res('fire')} ${res('cold')} ${res('lightning')} ${res('poison')}</b></div>
        ${st.skillBonus.all || st.skillBonus.fire || st.skillBonus.cold || st.skillBonus.lightning ? `<div><span>+Cấp kỹ năng từ đồ</span><b>L${st.skillBonus.fire + st.skillBonus.all} B${st.skillBonus.cold + st.skillBonus.all} S${st.skillBonus.lightning + st.skillBonus.all}</b></div>` : ''}
      </div>`;
  }

  renderSkills() {
    const ch = this.ch;
    const data = this.data;
    const st = this.stats();
    const slots = ch.slots.map((id, i) => {
      const sk = data.skills[id];
      return `<div class="slot" title="Ô ${i + 1}">${sk ? `<canvas data-icon="${sk.id}" width="56" height="56"></canvas><span>${esc(sk.name)}</span>` : '<span class="empty">Trống</span>'}</div>`;
    }).join('');
    const treeTabs = data.trees.map((t) => {
      const spent = data.skillList.filter((s) => s.tree === t.id).reduce((n, s) => n + (ch.skills[s.id] || 0), 0);
      return `<button class="tab tree ${this.tree === t.id ? 'on' : ''}" data-tree="${t.id}" style="--tc:${t.color}">${esc(t.name)} <small>${spent}</small></button>`;
    }).join('');

    const list = data.skillList.filter((s) => s.tree === this.tree);
    const cols = 3;
    const rows = Math.max(...list.map((s) => s.grid[1])) + 1;
    const W = cols * COL_W, H = rows * ROW_H;
    const center = (s) => [(s.grid[0] + 0.5) * COL_W, (s.grid[1] + 0.5) * ROW_H];
    const pairs = new Map();
    for (const s of list) for (const syn of s.synergies || []) {
      const key = [syn.from, s.id].sort().join('|');
      const e = pairs.get(key) || { a: syn.from, b: s.id, ab: false, ba: false };
      if (e.a === syn.from) e.ab = true; else e.ba = true;
      pairs.set(key, e);
    }
    let lines = '';
    for (const e of pairs.values()) {
      const [x1, y1] = center(data.skills[e.a]);
      const [x2, y2] = center(data.skills[e.b]);
      const d = Math.hypot(x2 - x1, y2 - y1), ux = (x2 - x1) / d, uy = (y2 - y1) / d;
      const o = NODE / 2 + 6;
      lines += `<line x1="${x1 + ux * o}" y1="${y1 + uy * o}" x2="${x2 - ux * o}" y2="${y2 - uy * o}" ${e.ab ? 'marker-end="url(#arr)"' : ''} ${e.ba ? 'marker-start="url(#arr)"' : ''}/>`;
    }
    const nodes = list.map((s) => {
      const l = ch.skills[s.id] || 0;
      const eff = P.skillLevel(ch, s.id, data, st);
      const need = P.unlockLevel(s, data.config);
      const locked = ch.level < need;
      const can = P.canLearn(ch, s.id, data).ok;
      const added = l - (this.snap.skills[s.id] || 0);
      const [cx, cy] = center(s);
      return `<div class="node ${locked ? 'locked' : ''} ${l ? 'learned' : ''} ${s.type}" data-node="${s.id}" style="left:${cx - NODE / 2}px;top:${cy - NODE / 2}px">
        <canvas data-icon="${s.id}" width="64" height="64"></canvas>
        <div class="lvl">${l}${eff > l ? `<span class="gear">+${eff - l}</span>` : ''}/${s.maxLevel}${added ? `<span class="added">+${added}</span>` : ''}</div>
        ${locked ? `<div class="lock">Cấp ${need}</div>` : ''}
        <button class="plus small" data-learn="${s.id}" ${can ? '' : 'disabled'}>+</button>
      </div>`;
    }).join('');

    this.skillEl.innerHTML = `
      <div class="pts ${ch.skillPoints ? 'has' : ''}">Điểm kỹ năng: <b>${ch.skillPoints}</b> <small>${data.config.testMode ? 'Chế độ thử nghiệm: mốc mở kỹ năng được nén' : ''}</small></div>
      <div class="slots">${slots}</div>
      <div class="tree-tabs">${treeTabs}</div>
      <div class="tree-wrap">
        <div class="tree" style="width:${W}px;height:${H}px">
          <svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
            <defs><marker id="arr" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#c9a04a"/></marker></defs>
            ${lines}
          </svg>
          ${nodes}
        </div>
        <div class="details" id="skill-details"></div>
      </div>`;
    this.drawIcons();
    this.renderDetails();
    this.markSelected();
  }

  drawIcons() {
    this.root.querySelectorAll('canvas[data-icon]').forEach((c) => {
      const ctx = c.getContext('2d');
      ctx.clearRect(0, 0, c.width, c.height);
      drawSkillIcon(ctx, this.data.skills[c.dataset.icon], c.width / 2, c.height / 2, c.width * 0.36);
    });
  }

  markSelected() {
    this.root.querySelectorAll('.node').forEach((n) => n.classList.toggle('sel', n.dataset.node === this.selected));
  }

  renderDetails() {
    const el = this.root.querySelector('#skill-details');
    if (!el) return;
    const ch = this.ch;
    const data = this.data;
    const sk = data.skills[this.selected];
    if (!sk) return;
    const l = ch.skills[sk.id] || 0;
    const st = this.stats();
    const eff = P.skillLevel(ch, sk.id, data, st);
    const effNext = l ? eff + 1 : 1 + st.skillBonus[sk.tree] + st.skillBonus.all;
    const cur = describeSkill(sk, eff, ch, data, st);
    const next = l < sk.maxLevel ? describeSkill(sk, effNext, ch, data, st) : [];
    const need = P.unlockLevel(sk, data.config);
    const tbl = (rows) => rows.map(([k, v]) => `<div><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join('');
    const syn = synergyText(sk, data);
    let equip = '';
    if (sk.type === 'active' && l > 0 && !ch.slots.includes(sk.id)) {
      equip = `<div class="equip">Chưa gắn vào ô: ${ch.slots.map((sid, i) => `<button data-equip="${sk.id}:${i}">Ô ${i + 1}${sid ? ` (thay ${esc(data.skills[sid].name)})` : ''}</button>`).join('')}</div>`;
    }
    el.innerHTML = `
      <h4>${esc(sk.name)} <small>${sk.type === 'active' ? 'Chủ động' : 'Bị động'} · mở ở cấp ${need}${data.config.testMode && sk.unlock !== need ? ` (bản Demo: ${sk.unlock})` : ''}</small></h4>
      <p>${esc(sk.desc)}</p>
      <div class="cols2">
        <div><h5>Hiện tại (${eff}${eff > l ? `, ${l} điểm + ${eff - l} từ đồ` : ''})</h5>${l ? tbl(cur) : '<em>Chưa học</em>'}</div>
        <div><h5>Cấp kế tiếp (${effNext})</h5>${next.length ? tbl(next) : '<em>Đã tối đa</em>'}</div>
      </div>
      ${syn.length ? `<div class="syn"><h5>Synergy (chỉ tính điểm cộng thật)</h5>${syn.map((s) => `<div>${esc(s)}</div>`).join('')}</div>` : ''}
      ${equip}`;
  }

  // ---------- Đồ đạc ----------
  cellHtml(it, where, key, label = '') {
    const ch = this.ch;
    const sel = this.sel && this.sel.where === where && String(this.sel.key) === String(key);
    if (!it) return `<div class="cell empty ${sel ? 'sel' : ''}" data-cell="${where}:${key}">${label ? `<span>${esc(label)}</span>` : ''}</div>`;
    const col = this.data.items.rarities[it.rarity].color;
    const ok = I.meetsReq(it, ch.level, I.totalStr(ch));
    return `<div class="cell ${sel ? 'sel' : ''} ${ok ? '' : 'unmet'}" data-cell="${where}:${key}" style="--rc:${col}" title="${esc(it.name)}">
      <span class="ic">${esc(typeIcon(it.type))}</span><span class="nm">${esc(it.name)}</span></div>`;
  }

  itemCard(it, title = '') {
    const ch = this.ch;
    const R = this.data.items.rarities[it.rarity];
    const lvlOk = ch.level >= it.req.level;
    const strOk = I.totalStr(ch) >= (it.req.str || 0);
    return `<div class="card" style="--rc:${R.color}">
      ${title ? `<div class="card-title">${esc(title)}</div>` : ''}
      <div class="iname">${esc(it.name)}</div>
      <div class="ibase">${esc(it.baseName)} · ${esc(R.name)} · cấp đồ ${it.ilvl}</div>
      <div class="req ${lvlOk ? '' : 'bad'}">Cần cấp ${it.req.level}</div>
      ${it.req.str ? `<div class="req ${strOk ? '' : 'bad'}">Cần ${it.req.str} Sức mạnh</div>` : ''}
      <div class="istats">${I.itemLines(it, this.data).map((l) => `<div>${esc(l)}</div>`).join('')}</div>
      ${this.village ? `<div class="ival">Bán được ${I.sellValue(it, this.data)} vàng</div>` : ''}
    </div>`;
  }

  compareHtml(it) {
    const slots = I.slotsForType(it.type, this.data);
    const eqs = slots.map((s) => this.ch.equipment[s]).filter(Boolean);
    if (!eqs.length) return '<div class="cmp muted">Ô này đang trống.</div>';
    return eqs.map((eq) => {
      const keys = new Set([...Object.keys(it.stats), ...Object.keys(eq.stats)]);
      const diffs = [...keys].map((k) => [k, (it.stats[k] || 0) - (eq.stats[k] || 0)]).filter(([, v]) => v);
      return `<div class="cmp">${this.itemCard(eq, 'Đang mặc')}
        <div class="diff"><h5>Nếu thay</h5>${diffs.length ? diffs.map(([k, v]) => `<div class="${v > 0 ? 'up' : 'down'}">${esc(I.formatStat(k, v, this.data).replace('+-', '−'))}</div>`).join('') : '<div class="muted">Không đổi chỉ số</div>'}</div>
      </div>`;
    }).join('');
  }

  renderItems(stashMode) {
    const ch = this.ch;
    const data = this.data;
    const st = this.stats();
    const eqHtml = data.items.slots.map((s) => `<div class="eqslot eq-${s.id}">${this.cellHtml(ch.equipment[s.id], 'eq', s.id, s.name)}${st.inactiveGear.includes(s.id) && ch.equipment[s.id] ? '<em class="bad">Chưa đủ yêu cầu</em>' : ''}</div>`).join('');
    const invHtml = ch.inventory.map((it, i) => this.cellHtml(it, 'inv', i)).join('');
    const used = ch.inventory.filter(Boolean).length;
    const it = this.selItem();
    let detail = '<div class="muted">Bấm vào một món để xem chi tiết. Bấm đúp: mặc / tháo' + (stashMode ? ' / chuyển rương' : '') + '.</div>';
    if (it) {
      const s = this.sel;
      const btn = [];
      if (s.where === 'inv' && !stashMode) btn.push('<button data-act="wear" class="primary">Mặc</button>');
      if (s.where === 'eq') btn.push('<button data-act="unequip">Tháo</button>');
      if (s.where === 'inv' && stashMode) btn.push('<button data-act="store" class="primary">Cất vào rương</button>');
      if (s.where === 'stash') btn.push('<button data-act="take" class="primary">Lấy ra kho đồ</button>');
      if (s.where === 'inv' && this.village) btn.push(`<button data-act="sell">Bán (${I.sellValue(it, data)} vàng)</button>`);
      if (s.where === 'inv' && !this.village) btn.push('<button data-act="drop" class="ghost">Vứt bỏ</button>');
      detail = `<div class="item-detail">${this.itemCard(it)}${s.where !== 'eq' ? this.compareHtml(it) : ''}</div><div class="item-btns">${btn.join('')}</div>`;
    }
    let stashHtml = '';
    if (stashMode) {
      const stash = this.hooks.getStash();
      stashHtml = `<section class="stash"><h4>Rương chung <small>${stash.filter(Boolean).length}/${stash.length} · dùng chung cho mọi nhân vật trên trình duyệt này</small></h4><div class="grid stash-grid">${stash.map((x, i) => this.cellHtml(x, 'stash', i)).join('')}</div></section>`;
    }
    this.body.innerHTML = `<div class="items-wrap ${stashMode ? 'stash-mode' : ''}">
      ${stashMode ? stashHtml : `<section class="paperdoll"><h4>Trang bị</h4><div class="eqgrid">${eqHtml}</div></section>`}
      <section class="inv"><h4>Kho đồ <small>${used}/${ch.inventory.length}</small></h4><div class="grid inv-grid">${invHtml}</div></section>
      <section class="idetail">${detail}</section>
    </div>`;
  }
}

function typeIcon(t) {
  return { weapon: '⚚', offhand: '◉', head: '⛑', body: '▣', gloves: '✋', belt: '═', boots: '▟', amulet: '◈', ring: '○' }[t] || '?';
}
