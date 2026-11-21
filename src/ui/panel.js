// Bảng cộng điểm: thuộc tính (trái) và cây kỹ năng (phải). Game dừng hẳn khi bảng mở.
import * as P from '../core/progression.js';
import { drawSkillIcon } from './render.js';
import { describeSkill, synergyText } from './skilltext.js';

const NODE = 78, COL_W = 104, ROW_H = 100;
const pctStr = (v) => `${Math.round(v * 1000) / 10}%`;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export class Panel {
  constructor(root, data, hooks) {
    this.root = root;
    this.data = data;
    this.hooks = hooks; // { getChar, getGame, onClosed }
    this.isOpen = false;
    this.selected = 'fireball';
    this.pendingLearn = null;
    root.querySelector('#btn-undo').addEventListener('click', () => this.undo());
    root.querySelector('#btn-continue').addEventListener('click', () => this.close());
    this.attrEl = root.querySelector('#attr-col');
    this.skillEl = root.querySelector('#skill-col');
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

  stats() {
    const g = this.game;
    return g ? g.stats : P.computeStats(this.ch, this.data);
  }

  open() {
    if (this.isOpen) return;
    this.isOpen = true;
    this.snap = P.snapshot(this.ch);
    this.openedAt = performance.now();
    this.game?.beginEdit();
    this.root.classList.remove('hidden');
    this.dialog.classList.add('hidden');
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

  onClick(ev) {
    const t = ev.target.closest('button, [data-node]');
    if (!t) return;
    if (t.dataset.attr) {
      const n = ev.shiftKey ? 5 : 1;
      if (P.addAttr(this.ch, t.dataset.attr, n)) this.changed();
    } else if (t.dataset.learn) {
      ev.stopPropagation();
      this.learn(t.dataset.learn);
    } else if (t.dataset.replace !== undefined) {
      const id = this.pendingLearn;
      this.dialog.classList.add('hidden');
      this.pendingLearn = null;
      if (t.dataset.replace !== 'cancel' && id) {
        P.learnSkill(this.ch, id, this.data, Number(t.dataset.replace));
        this.changed();
      }
    } else if (t.dataset.equip) {
      const [id, slot] = t.dataset.equip.split(':');
      P.equipSkill(this.ch, id, Number(slot));
      this.changed();
    } else if (t.dataset.node) {
      this.selected = t.dataset.node;
      this.renderDetails();
      this.markSelected();
    }
  }

  learn(id) {
    this.selected = id;
    const res = P.learnSkill(this.ch, id, this.data);
    if (res === 'ok') this.changed();
    else if (res === 'needSlot') this.showReplace(id);
    else this.flash(res);
  }

  flash(msg) {
    const el = this.root.querySelector('#panel-msg');
    el.textContent = msg;
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
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

  render() {
    const ch = this.ch;
    this.titleEl.textContent = `${this.data.tree.className} — Cấp ${ch.level}`;
    this.renderAttrs();
    this.renderSkills();
    const hasChanges = JSON.stringify(P.snapshot(ch)) !== JSON.stringify(this.snap);
    this.root.querySelector('#btn-undo').disabled = !hasChanges;
  }

  renderAttrs() {
    const ch = this.ch;
    const cfg = this.data.config;
    const st = this.stats();
    const rows = P.ATTRS.map((k) => {
      const a = cfg.attributes[k];
      const added = ch.attrs[k] - this.snap.attrs[k];
      return `<div class="attr-row">
        <div class="attr-name"><span class="key">${a.key}</span>${esc(a.name)}</div>
        <div class="attr-val">${ch.attrs[k]}${added ? `<span class="added">+${added}</span>` : ''}</div>
        <button class="plus" data-attr="${k}" ${ch.attrPoints ? '' : 'disabled'} title="Giữ Shift để cộng 5">+</button>
        <div class="attr-desc">${esc(a.desc)}</div>
      </div>`;
    }).join('');
    const p = this.game?.player;
    const hp = p ? `${Math.ceil(p.hp)} / ${Math.round(st.maxHp)}` : Math.round(st.maxHp);
    const mana = p ? `${Math.floor(p.mana)} / ${Math.round(st.maxMana)}` : Math.round(st.maxMana);
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
        <div><span>Sát thương vật lý</span><b>+${pctStr(st.physDmgPct)}</b></div>
        <div><span>Chí mạng</span><b>${pctStr(st.critChance)} ×${st.critMult}</b></div>
      </div>`;
  }

  renderSkills() {
    const ch = this.ch;
    const data = this.data;
    const slots = ch.slots.map((id, i) => {
      const sk = data.skills[id];
      return `<div class="slot" title="Ô ${i + 1}">${sk ? `<canvas data-icon="${sk.id}" width="56" height="56"></canvas><span>${esc(sk.name)}</span>` : '<span class="empty">Trống</span>'}</div>`;
    }).join('');

    const cols = 3;
    const rows = Math.max(...data.skillList.map((s) => s.grid[1])) + 1;
    const W = cols * COL_W, H = rows * ROW_H;
    const center = (s) => [(s.grid[0] + 0.5) * COL_W, (s.grid[1] + 0.5) * ROW_H];
    // Mũi tên synergy: từ kỹ năng cho điểm tới kỹ năng được cộng.
    const pairs = new Map();
    for (const s of data.skillList) for (const syn of s.synergies || []) {
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
    const nodes = data.skillList.map((s) => {
      const l = ch.skills[s.id] || 0;
      const need = P.unlockLevel(s, data.config);
      const locked = ch.level < need;
      const can = P.canLearn(ch, s.id, data).ok;
      const added = l - (this.snap.skills[s.id] || 0);
      const [cx, cy] = center(s);
      return `<div class="node ${locked ? 'locked' : ''} ${l ? 'learned' : ''} ${s.type}" data-node="${s.id}" style="left:${cx - NODE / 2}px;top:${cy - NODE / 2}px">
        <canvas data-icon="${s.id}" width="64" height="64"></canvas>
        <div class="lvl">${l}/${s.maxLevel}${added ? `<span class="added">+${added}</span>` : ''}</div>
        ${locked ? `<div class="lock">Cấp ${need}</div>` : ''}
        <button class="plus small" data-learn="${s.id}" ${can ? '' : 'disabled'}>+</button>
      </div>`;
    }).join('');

    this.skillEl.innerHTML = `
      <div class="pts ${ch.skillPoints ? 'has' : ''}">Điểm kỹ năng: <b>${ch.skillPoints}</b> <small>Nhánh ${esc(data.tree.treeName)}${data.config.testMode ? ' · chế độ thử nghiệm (mốc mở nén)' : ''}</small></div>
      <div class="slots">${slots}</div>
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
    const cur = describeSkill(sk, l, ch, data, st);
    const next = l < sk.maxLevel ? describeSkill(sk, l + 1, ch, data, st) : [];
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
        <div><h5>Cấp hiện tại (${l})</h5>${l ? tbl(cur) : '<em>Chưa học</em>'}</div>
        <div><h5>Cấp kế tiếp (${Math.min(l + 1, sk.maxLevel)})</h5>${next.length ? tbl(next) : '<em>Đã tối đa</em>'}</div>
      </div>
      ${syn.length ? `<div class="syn"><h5>Synergy</h5>${syn.map((s) => `<div>${esc(s)}</div>`).join('')}</div>` : ''}
      ${equip}`;
  }
}
