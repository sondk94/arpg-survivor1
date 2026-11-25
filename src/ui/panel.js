// Bảng nhân vật: thẻ "Nhân vật" (thuộc tính + cây kỹ năng Lửa/Băng/Sét), "Đồ đạc" (trang bị + kho), "Rương" (chỉ ở làng).
// Game dừng hẳn khi bảng mở.
import * as P from '../core/progression.js';
import * as I from '../core/items.js';
import * as L from '../core/loot.js';
import { drawSkillIcon } from './render.js';
import { describeSkill, synergyText } from './skilltext.js';
import { RNG } from '../core/rng.js';
import { Tooltip } from './tooltip.js';

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
    root.addEventListener('change', (ev) => this.onChange(ev));
    this.bulkSpecial = false; // bán / phân giải nhanh: tính cả độc nhất, đồ bộ, rune
    // Khung nổi: đồ (ô kho / trang bị / rương), ô kỹ năng đã gắn, chỉ số có giải thích (data-tip).
    this.tip = new Tooltip();
    const tipAt = (ev) => {
      const c = ev.target.closest('[data-cell], [data-tipcell], [data-slotid], [data-tip]');
      if (!c || !this.isOpen) { this.tip.hide(); return; }
      const html = this.tipHtml(c);
      if (!html) { this.tip.hide(); return; }
      this.tip.show(c.dataset.cell || c.dataset.tipcell || c.dataset.slotid || c.dataset.tip, html, ev.clientX, ev.clientY);
    };
    root.addEventListener('pointerover', tipAt);
    root.addEventListener('pointermove', (ev) => { if (ev.pointerType !== 'touch') this.tip.move(ev.clientX, ev.clientY); });
    root.addEventListener('pointerout', (ev) => {
      if (ev.pointerType === 'touch') return;
      const c = ev.target.closest('[data-cell], [data-tipcell], [data-slotid], [data-tip]');
      if (c && !c.contains(ev.relatedTarget)) this.tip.hide();
    });
    root.addEventListener('pointerdown', (ev) => { if (ev.pointerType === 'touch' && !ev.target.closest('[data-cell], [data-tipcell], [data-slotid], [data-tip]')) this.tip.hide(); });
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
    this.tip.hide();
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
      if ((ev.ctrlKey || ev.metaKey) && this.tab !== 'craft') { this.lastCell = null; this.quickJunk(where, key); return; }
      this.sel = { where, key };
      if (dbl && this.selItem()) { this.lastCell = null; this.doubleAction(); return; }
      this.render();
      return;
    }
    if (d.bulk) { const [mode, f] = d.bulk.split(':'); this.showBulk(mode, f); return; }
    if (d.bulkdo !== undefined) { this.doBulk(d.bulkdo === '1'); return; }
    if (d.sort !== undefined) { L.sortInventory(this.ch, this.data); this.sel = null; this.changed(); return; }
    if (d.buyback !== undefined) { const r = L.buyBack(this.ch, Number(d.buyback)); this.flash(r === 'ok' ? 'Đã mua lại' : r); if (r === 'ok') this.changed(); return; }
    if (d.act) this.itemAction(d.act);
    if (d.rune) this.socketRune(d.rune);
    if (d.craft) this.doCraft(d.craft);
    if (d.combine) this.doCombine(d.combine);
  }

  onChange(ev) {
    const t = ev.target;
    if (t.dataset.lf) {
      const f = L.lootFilter(this.ch);
      if (t.dataset.lf === 'normal') f.normal = t.value;
      else if (t.dataset.lf === 'magicMinLevel') f.magicMinLevel = Math.max(0, Math.floor(Number(t.value) || 0));
      else if (t.dataset.lf === 'makeRoom') f.makeRoom = t.checked;
      this.ch.lootFilter = f;
      this.hooks.onChanged?.();
      this.flash('Đã lưu bộ lọc nhặt đồ');
    } else if (t.dataset.bulkspecial !== undefined) {
      this.bulkSpecial = t.checked;
      this.render();
    }
  }

  // Hộp xác nhận bán / phân giải hàng loạt: liệt kê số món và tổng vàng / mảnh.
  showBulk(mode, filter) {
    const ch = this.ch, data = this.data;
    const idx = L.bulkCandidates(ch, data, filter, this.bulkSpecial);
    if (!idx.length) { this.flash('Không có món nào khớp'); return; }
    const total = L.sumValue(ch, idx, data, mode === 'sell' ? I.sellValue : I.salvageValue);
    const names = idx.slice(0, 12).map((i) => {
      const it = ch.inventory[i];
      return `<span style="color:${it.type === 'rune' ? data.runes.byId[it.rune].color : data.items.rarities[it.rarity].color}">${esc(it.name)}</span>`;
    }).join(', ') + (idx.length > 12 ? ` và ${idx.length - 12} món khác` : '');
    const verb = mode === 'sell' ? 'Bán' : 'Phân giải';
    this.pendingBulk = { mode, idx };
    this.dialog.innerHTML = `<div class="dlg"><h3>${verb} ${idx.length} món ${esc(BULK_LABELS[filter].toLowerCase())}?</h3>
      <p>${names}</p><p>Nhận <b>${total.toLocaleString('vi-VN')} ${mode === 'sell' ? 'vàng' : 'mảnh'}</b>. Đồ đã khoá 🔒 không bị ${verb.toLowerCase()}.${mode === 'sell' ? ' Có thể mua lại 10 món bán gần nhất.' : ''}</p>
      <div class="dlg-btns"><button data-bulkdo="1" class="primary">${verb}</button><button data-bulkdo="0" class="ghost">Huỷ</button></div></div>`;
    this.dialog.classList.remove('hidden');
  }

  doBulk(ok) {
    this.dialog.classList.add('hidden');
    const b = this.pendingBulk;
    this.pendingBulk = null;
    if (!ok || !b) return;
    if (b.mode === 'sell') { const r = L.sellItems(this.ch, b.idx, this.data); this.flash(`Đã bán ${r.n} món: +${r.gold} vàng`); }
    else { const r = L.salvageItems(this.ch, b.idx, this.data); this.flash(`Đã phân giải ${r.n} món: +${r.shards} mảnh`); }
    this.sel = null;
    this.changed();
  }

  // Ctrl + bấm: ở làng bán ngay, trong màn đánh dấu / bỏ đánh dấu rác (tự bán khi về làng).
  quickJunk(where, key) {
    if (where !== 'inv') return;
    const it = this.ch.inventory[key];
    if (!it) return;
    if (it.locked) { this.flash('Món này đã khoá'); return; }
    if (this.village) {
      const r = L.sellItems(this.ch, [Number(key)], this.data);
      this.flash(`Đã bán ${it.name}: +${r.gold} vàng`);
    } else {
      it.junk = !it.junk;
      this.flash(it.junk ? `Đánh dấu rác: ${it.name} (tự bán khi về làng)` : 'Bỏ đánh dấu rác');
    }
    this.sel = null;
    this.changed();
  }

  bulkBarHtml(mode) {
    const verb = mode === 'sell' ? 'Bán' : 'Phân giải';
    const ch = this.ch, data = this.data;
    const btns = Object.entries(BULK_LABELS).filter(([f]) => f !== 'junk' || mode === 'salvage').map(([f, label]) => {
      const idx = L.bulkCandidates(ch, data, f, this.bulkSpecial);
      return `<button data-bulk="${mode}:${f}" ${idx.length ? '' : 'disabled'}>${label} <small>${idx.length}</small></button>`;
    }).join('');
    return `<div class="bulkbar"><h5>${verb} nhanh</h5><div class="bulk-btns">${btns}</div>
      <label class="chk"><input type="checkbox" data-bulkspecial ${this.bulkSpecial ? 'checked' : ''}> Tính cả độc nhất, đồ bộ, rune</label></div>`;
  }

  lootFilterHtml() {
    const f = L.lootFilter(this.ch);
    return `<div class="bulkbar"><h5>Bộ lọc nhặt đồ</h5>
      <label>Đồ thường (trắng): <select data-lf="normal">
        <option value="pick" ${f.normal === 'pick' ? 'selected' : ''}>Nhặt</option>
        <option value="sell" ${f.normal === 'sell' ? 'selected' : ''}>Tự bán khi nhặt</option>
        <option value="skip" ${f.normal === 'skip' ? 'selected' : ''}>Không nhặt</option></select></label>
      <label>Không nhặt đồ ma thuật (xanh) dưới cấp đồ <input type="number" min="0" max="200" data-lf="magicMinLevel" value="${f.magicMinLevel}" style="width:56px"></label>
      <label class="chk"><input type="checkbox" data-lf="makeRoom" ${f.makeRoom ? 'checked' : ''}> Kho đầy: tự bán món rác rẻ nhất (đồ trắng / đánh dấu rác, chưa khoá) để nhặt món mới</label>
      <div class="muted" style="font-size:11px">Vàng, rune và đồ hiếm trở lên luôn được nhặt.</div></div>`;
  }

  buybackHtml() {
    const bb = this.ch.buyback || [];
    if (!bb.length) return '';
    return `<div class="bulkbar"><h5>Mua lại (${bb.length} món bán gần nhất)</h5><div class="bb-list">${bb.map((b, i) =>
      `<div><span style="color:${b.item.type === 'rune' ? this.data.runes.byId[b.item.rune].color : this.data.items.rarities[b.item.rarity].color}">${esc(b.item.name)}</span><button data-buyback="${i}" ${this.ch.gold >= b.price ? '' : 'disabled'}>Mua ${b.price}</button></div>`).join('')}</div></div>`;
  }

  doubleAction() {
    if (this.tab === 'craft') { this.render(); return; }
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
      if (it.locked) { this.flash('Món này đã khoá'); return; }
      const r = L.sellItems(ch, [Number(s.key)], this.data);
      this.flash(`+${r.gold} vàng`);
    } else if (act === 'sellone' && s.where === 'inv') {
      const it = ch.inventory[s.key];
      if (it.locked) { this.flash('Món này đã khoá'); return; }
      const one = I.takeOne(ch.inventory, Number(s.key));
      const v = I.unitSellValue(one, this.data);
      ch.gold += v;
      ch.buyback = [{ item: one, price: v }, ...(ch.buyback || [])].slice(0, L.BUYBACK_MAX);
      this.flash(`+${v} vàng`);
      if (ch.inventory[s.key]) { this.changed(); return; }
    } else if (act === 'drop' && s.where === 'inv') {
      const it = ch.inventory[s.key];
      if (it.locked) { this.flash('Món này đã khoá'); return; }
      ch.inventory[s.key] = null;
    } else if (act === 'lock') {
      const it = this.selItem();
      it.locked = !it.locked;
      if (it.locked) delete it.junk;
      this.flash(it.locked ? 'Đã khoá: không bị bán / phân giải hàng loạt' : 'Đã mở khoá');
      this.changed();
      return;
    } else if (act === 'junk' && s.where === 'inv') {
      const it = ch.inventory[s.key];
      it.junk = !it.junk;
      this.flash(it.junk ? 'Đánh dấu rác: tự bán khi về làng' : 'Bỏ đánh dấu rác');
      this.changed();
      return;
    } else return;
    if (res !== 'ok') { this.flash(res); return; }
    this.sel = null;
    this.changed();
  }

  // Ghép rune đang chọn (ở kho đồ) vào món "where:key".
  socketRune(target) {
    const [where, key] = target.split(':');
    const tgt = where === 'eq' ? this.ch.equipment[key] : this.ch.inventory[key];
    const res = I.insertRune(this.ch, Number(this.sel.key), tgt, this.data);
    if (res !== 'ok') { this.flash(res); return; }
    this.flash('Đã ghép rune');
    this.sel = where === 'eq' ? { where, key } : { where: 'inv', key: String(key) };
    this.changed();
  }

  rng() {
    return (this._rng ||= new RNG((Date.now() >>> 0) || 1));
  }

  doCraft(action) {
    if (!this.sel) return;
    const it = this.selItem();
    if (action === 'salvage' && it && (it.rarity === 'unique' || it.rarity === 'set' || it.runes?.length) && !confirm(`Phân giải "${it.name}"? Món đồ${it.runes?.length ? ' và rune đã ghép' : ''} sẽ mất.`)) return;
    const res = I.craft(this.ch, this.hooks.getStash(), this.sel, action, this.data, this.rng());
    if (res !== 'ok') { this.flash(res); return; }
    if (action === 'salvage') this.sel = null;
    this.flash({ salvage: 'Đã phân giải', reroll: 'Đã đổi dòng chỉ số', upgrade: 'Đã nâng bậc', socket: 'Đã đục thêm lỗ', unsocket: 'Đã gỡ rune' }[action]);
    this.changed();
  }

  doCombine(runeId) {
    const res = I.combineRunes(this.ch, runeId, this.data, this.rng());
    if (res !== 'ok') { this.flash(res); return; }
    this.flash('Đã ghép rune bậc cao hơn');
    this.changed();
  }

  // ---------- Vẽ ----------
  render() {
    const ch = this.ch;
    this.tip?.hide();
    this._tree = L.mainTree(ch, this.data);
    const clsName = P.getClass(ch, this.data).name;
    this.titleEl.textContent = `${ch.name && !clsName.startsWith(ch.name) ? `${ch.name} · ` : ''}${clsName} — Cấp ${ch.level}`;
    const myTrees = P.classTrees(ch, this.data);
    if (!myTrees.includes(this.tree)) {
      this.tree = myTrees[0];
      this.selected = this.data.skillList.find((x) => x.tree === this.tree).id;
    }
    const tabs = [['char', 'Nhân vật'], ['items', 'Đồ đạc']];
    if (this.village) tabs.push(['stash', 'Rương chung'], ['craft', 'Lò chế']);
    if (!this.village && (this.tab === 'stash' || this.tab === 'craft')) this.tab = 'items';
    const pts = ch.attrPoints + ch.skillPoints;
    this.tabsEl.innerHTML = tabs.map(([id, n]) => `<button class="tab ${this.tab === id ? 'on' : ''}" data-tab="${id}">${n}${id === 'char' && pts ? ` <span class="badge">${pts}</span>` : ''}</button>`).join('') +
      `<span class="gold">${ch.gold.toLocaleString('vi-VN')} vàng · ${(ch.shards || 0).toLocaleString('vi-VN')} mảnh</span>`;
    if (this.tab === 'char') this.renderChar();
    else if (this.tab === 'items') this.renderItems(false);
    else if (this.tab === 'craft') this.renderCraft();
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
    const data = this.data;
    const cfg = data.config;
    const st = this.stats();
    const pc = P.playerCfg(ch, data);
    const cls = P.getClass(ch, data);
    const isStr = cls.mainStat === 'str', summ = cls.id === 'summoner', mage = !isStr && !summ;
    const A = cfg.attributes;
    const n = (v) => String(Math.round(v * 100) / 100).replace('.', ',');
    // Một dòng ngắn, chỉ phần có ích cho lớp này; giải thích đầy đủ ở ⓘ.
    const short = {
      str: isStr ? `+${n(A.str.physDmgPct * 100)}% sát thương vật lý · +${A.str.physFlatPerPoint} sát thương/đòn` : 'Đủ yêu cầu Sức mạnh của đồ',
      dex: `+${n(A.dex.cdSpeedPct * 100)}% hồi chiêu · +${n(A.dex.dodgePct * 100)}% né`,
      vit: `+${n(pc.hpPerVit ?? A.vit.hp)} máu`,
      ene: summ ? `+${n(pc.manaPerEne ?? A.ene.mana)} mana · +${n(A.ene.spellDmgPct * 100)}% sát thương thú · +${A.ene.summonFlatPerPoint} sát thương thú/đòn · +${n(A.ene.summonHpPctPerPoint * 100)}% máu thú`
        : mage ? `+${n(pc.manaPerEne ?? A.ene.mana)} mana · +${n(A.ene.spellDmgPct * 100)}% sát thương phép · +${A.ene.spellFlatPerPoint} sát thương phép/đòn`
          : `+${n(pc.manaPerEne ?? A.ene.mana)} mana`,
    };
    const rows = P.ATTRS.map((k) => {
      const a = A[k];
      const added = ch.attrs[k] - this.snap.attrs[k];
      const bonus = st.attrs[k] - ch.attrs[k];
      const full = k === 'vit' ? `+${pc.hpPerVit ?? a.hp} máu tối đa mỗi điểm` : k === 'ene' ? a.desc.replace(/\+\d+(,\d+)? mana/, `+${String(pc.manaPerEne ?? a.mana).replace('.', ',')} mana`) : a.desc;
      return `<div class="attr-row">
        <div class="attr-name"><span class="key">${a.key}</span>${esc(a.name)}</div>
        <div class="attr-val">${st.attrs[k]}${bonus ? `<span class="gear" data-tip="${ch.attrs[k]} điểm + ${bonus} từ đồ">(${ch.attrs[k]}+${bonus})</span>` : ''}${added ? `<span class="added">+${added}</span>` : ''}</div>
        <button class="plus" data-attr="${k}" ${ch.attrPoints ? '' : 'disabled'} title="Giữ Shift để cộng 5">+</button>
        <div class="attr-desc">${esc(short[k])} <span class="info" data-tip="${esc(full)}">ⓘ</span></div>
      </div>`;
    }).join('');
    const p = this.game?.player;
    const hp = p ? `${Math.ceil(p.hp)} / ${Math.round(st.maxHp)}` : Math.round(st.maxHp);
    const mana = p ? `${Math.floor(p.mana)} / ${Math.round(st.maxMana)}` : Math.round(st.maxMana);
    const red = Math.min(cfg.caps.armorReduction, st.armor / (st.armor + cfg.armor.base + cfg.armor.perMonsterLevel));
    const res = (k) => pctStr(Math.min(cfg.caps.playerResist, st.resist[k]));
    const row = (label, val, tip) => `<div ${tip ? `data-tip="${esc(tip)}"` : ''}><span>${label}</span><b>${val}</b></div>`;
    const atk = [];
    if (summ) {
      atk.push(row('Sát thương thú', `+${pctStr(st.summonDmgPct)}`, 'Năng lượng +0,5% mỗi điểm, cộng đồ và bị động. Áp dụng cho mọi kỹ năng triệu hồi.'));
      atk.push(row('Máu thú', `+${pctStr(st.summonHpMult - 1)}`, '+1% mỗi điểm Năng lượng cộng thêm, cộng đồ và bị động.'));
      if (st.summonFlat) atk.push(row('Thú mỗi đòn', `+${st.summonFlat}`, 'Năng lượng cộng thêm × 1, nhân hệ số từng kỹ năng.'));
    } else if (isStr) {
      atk.push(row('Sát thương vật lý', `+${pctStr(st.physDmgPct)}`, 'Sức mạnh +1% mỗi điểm, cộng đồ.'));
      if (st.physFlat) atk.push(row('Vật lý mỗi đòn', `+${st.physFlat}`, 'Sức mạnh cộng thêm × 1, nhân hệ số từng kỹ năng.'));
    } else {
      atk.push(row('Sát thương phép', `+${pctStr(st.spellDmgPct)}`, 'Năng lượng +0,5% mỗi điểm, cộng đồ.'));
      if (st.spellFlat) atk.push(row('Phép mỗi đòn', `+${st.spellFlat}`, 'Năng lượng cộng thêm × 1, nhân hệ số từng kỹ năng.'));
      atk.push(row('Lửa/Băng/Sét', `${pctStr(st.elemDmgPct.fire)}/${pctStr(st.elemDmgPct.cold)}/${pctStr(st.elemDmgPct.lightning)}`, 'Cộng thêm theo nguyên tố, từ đồ.'));
      atk.push(row('Sét → tinh anh', `+${pctStr(st.eliteDmgPct.lightning)}`, 'Sát thương sét lên tinh anh và trùm nhỏ.'));
    }
    atk.push(row('Chí mạng', `${pctStr(st.critChance)} ×${st.critMult}`, 'Tỉ lệ chí mạng × hệ số sát thương chí mạng.'));
    atk.push(row('Hồi chiêu', `+${pctStr(st.cdSpeed - 1)}`, 'Nhanh nhẹn +0,4% mỗi điểm, cộng đồ.'));
    if (cls.trees.some((t) => st.skillBonus[t]) || st.skillBonus.all) atk.push(row('+Cấp từ đồ', cls.trees.map((t) => `+${(st.skillBonus[t] || 0) + st.skillBonus.all}`).join(' / '), cls.trees.map((t) => `${data.treesById[t].name} +${(st.skillBonus[t] || 0) + st.skillBonus.all}`).join(', ')));
    const def = [
      row('Máu', hp, `Máu gốc + Thể lực × ${pc.hpPerVit ?? A.vit.hp} + cấp × ${pc.hpPerLevel} + đồ.`),
      row('Giáp', `${st.armor} (−${pctStr(red)})`, 'Giảm sát thương vật lý. Con số trong ngoặc là mức giảm trước quái cấp 1; quái cấp cao giảm ít hơn.'),
      row('Né', pctStr(st.dodge), 'Nhanh nhẹn +0,2% mỗi điểm, tối đa 40%.'),
      row('Kháng L/B/S/Độc', `${res('fire')} ${res('cold')} ${res('lightning')} ${res('poison')}`, `Tối đa ${pctStr(cfg.caps.playerResist)}. Ác mộng / Địa ngục trừ thêm kháng.`),
    ];
    if (st.leech) def.push(row('Hút máu', pctStr(st.leech), 'Phần trăm sát thương gây ra hồi thành máu.'));
    if (isStr || st.hpRegen > 0.05) def.push(row('Hồi máu', `${st.hpRegen.toFixed(1)}/giây`));
    const resrc = [
      row('Mana', mana, `Mana gốc + Năng lượng × ${pc.manaPerEne ?? A.ene.mana} + cấp × ${pc.manaPerLevel} + đồ.`),
      row('Hồi mana', `${st.manaRegen.toFixed(1)}/giây`, 'Theo % mana tối đa mỗi giây, cộng % hồi mana từ đồ.'),
    ];
    this.attrEl.innerHTML = `
      <div class="pts ${ch.attrPoints ? 'has' : ''}">Điểm thuộc tính: <b>${ch.attrPoints}</b> <small>(Shift + bấm: cộng 5)</small></div>
      ${rows}
      <div class="dgroups">
        <div class="dgroup"><h6>Tấn công</h6>${atk.join('')}</div>
        <div class="dgroup"><h6>Phòng thủ</h6>${def.join('')}</div>
        <div class="dgroup"><h6>Tài nguyên</h6>${resrc.join('')}</div>
      </div>`;
  }

  renderSkills() {
    const ch = this.ch;
    const data = this.data;
    const st = this.stats();
    const slots = ch.slots.map((id, i) => {
      const sk = data.skills[id];
      return `<div class="slot" ${sk ? `data-slotid="${sk.id}"` : ''}>${sk ? `<canvas data-icon="${sk.id}" width="56" height="56"></canvas><span>${esc(sk.name)}</span>` : '<span class="empty">Trống</span>'}</div>`;
    }).join('');
    const treeTabs = data.trees.filter((t) => P.classTrees(ch, data).includes(t.id)).map((t) => {
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
    let equip = '';
    if (sk.type === 'active' && l > 0 && !ch.slots.includes(sk.id)) {
      equip = `<div class="equip">Chưa gắn vào ô: ${ch.slots.map((sid, i) => `<button data-equip="${sk.id}:${i}">Ô ${i + 1}${sid ? ` (thay ${esc(data.skills[sid].name)})` : ''}</button>`).join('')}</div>`;
    }
    el.innerHTML = `<div class="sk-compact">${this.skillCompact(sk)}</div>${equip}`;
  }

  // ---------- Khung nổi ----------
  tipHtml(el) {
    const d = el.dataset;
    if (d.cell || d.tipcell) {
      const [where, key] = (d.cell || d.tipcell).split(':');
      const it = where === 'inv' ? this.ch.inventory[key] : where === 'eq' ? this.ch.equipment[key] : where === 'stash' ? this.hooks.getStash()[key] : null;
      return it ? this.itemTip(it, where) : '';
    }
    if (d.slotid) return `<div class="tip-skill">${this.skillCompact(this.data.skills[d.slotid])}</div>`;
    if (d.tip) return `<div class="tip-text">${esc(d.tip)}</div>`;
    return '';
  }

  // Món đang mặc sẽ bị thay nếu mặc món này (nhẫn: món điểm thấp hơn).
  compareTarget(it) {
    const ch = this.ch;
    const eqs = I.slotsForType(it.type, this.data).map((sl) => ch.equipment[sl]).filter(Boolean);
    if (!eqs.length) return null;
    const mode = L.scoreMode(ch);
    return eqs.reduce((a, b) => (I.itemScore(b, this._tree, mode) < I.itemScore(a, this._tree, mode) ? b : a));
  }

  // Thẻ vật phẩm gọn: so sánh với đồ đang mặc nằm ngay trên từng dòng (▲ / ▼), dòng "mất" cho chỉ số bị mất.
  itemTip(it, where) {
    const ch = this.ch, data = this.data;
    if (it.type === 'rune') {
      const r = data.runes.byId[it.rune];
      const f = (o) => Object.entries(o).map(([k, v]) => I.formatStat(k, v, data)).join(', ');
      return `<div class="tcard" style="--rc:${r.color}"><div class="tn">${esc(r.name)}${I.runeQty(it) > 1 ? ` ×${I.runeQty(it)}` : ''}</div>
        <div class="ts">Rune bậc ${r.tier} · ghép vào lỗ trống</div>
        <div class="tl">Vũ khí: ${esc(f(r.weapon))}</div><div class="tl">Giáp, mũ, tay phụ: ${esc(f(r.armor))}</div>
        <div class="tf">${I.unitSellValue(it, data)} vàng / viên</div></div>`;
    }
    const R = data.items.rarities[it.rarity];
    const v = where !== 'eq' ? L.itemVerdict(it, ch, data, this._tree) : null;
    const vtxt = { up: '<b class="up">↑ tốt hơn</b>', down: '<b class="down">↓ kém hơn</b>', same: '<b class="muted">≈ ngang</b>', cant: `<b class="muted">✕ ${L.wrongClass(it, ch) ? 'lớp khác' : 'chưa đủ yêu cầu'}</b>` }[v] || '';
    const lvlOk = ch.level >= it.req.level, strOk = I.totalStr(ch) >= (it.req.str || 0);
    const cmp = where !== 'eq' ? this.compareTarget(it) : null;
    const a = I.itemStats(it), b = cmp ? I.itemStats(cmp) : {};
    const lines = Object.entries(a).map(([k, val]) => {
      let dlt = '';
      if (cmp) {
        const dv = val - (b[k] || 0);
        if (dv > 0) dlt = `<i class="up">▲ ${dv}</i>`;
        else if (dv < 0) dlt = `<i class="down">▼ ${-dv}</i>`;
      }
      return `<div class="tl"><span>${esc(I.formatStat(k, val, data))}</span>${dlt}</div>`;
    }).join('');
    const lost = cmp ? Object.entries(b).filter(([k]) => !(k in a)).map(([k, val]) => I.formatStat(k, val, data)) : [];
    const sock = it.sockets ? `<div class="ts">Lỗ: ${Array.from({ length: it.sockets }, (_, i) => it.runes?.[i] ? `<span style="color:${data.runes.byId[it.runes[i].id].color}">[${esc(data.runes.byId[it.runes[i].id].name)}]</span>` : '[trống]').join(' ')}</div>` : '';
    let setl = '';
    if (it.set) {
      const set = data.items.setsById[it.set];
      const n = I.equippedSetCount(ch, it.set);
      setl = `<div class="tset">Bộ ${esc(set.name)} ${n}/${set.pieces.length} · ${Object.entries(set.bonus).map(([need, bo]) => `<span class="${n >= Number(need) ? 'on' : ''}">đủ ${need}: ${esc(Object.entries(bo).map(([k, x]) => I.formatStat(k, x, data)).join(', '))}</span>`).join(' · ')}</div>`;
    }
    const pw = it.power > 1.0005 ? ` · sức mạnh +${Math.round((it.power - 1) * 100)}%` : '';
    return `<div class="tcard" style="--rc:${R.color}">
      <div class="tn">${esc(it.name)} ${vtxt}</div>
      <div class="ts">${esc(it.baseName)} · ${esc(R.name)} · cấp đồ ${it.ilvl}${pw} · <span class="${lvlOk ? '' : 'bad'}">cần cấp ${it.req.level}</span>${it.req.str ? ` · <span class="${strOk ? '' : 'bad'}">${it.req.str} Sức mạnh</span>` : ''}</div>
      ${lines}
      ${lost.length ? `<div class="tl lost">mất: ${esc(lost.join(', '))}</div>` : ''}
      ${cmp ? `<div class="ts">so với ${esc(cmp.name)}</div>` : where !== 'eq' && v !== 'cant' ? '<div class="ts">ô này đang trống</div>' : ''}
      ${sock}${setl}
      <div class="tf">${I.sellValue(it, data)} vàng · ${I.salvageValue(it, data)} mảnh${it.locked ? ' · 🔒 đã khoá' : ''}${it.junk ? ' · 🗑 rác' : ''}</div>
    </div>`;
  }

  // Kỹ năng gọn: một cột; dòng đổi khi lên cấp ghi "hiện tại → cấp sau", dòng không đổi gộp lại.
  skillCompact(sk) {
    const ch = this.ch, data = this.data;
    const st = this.stats();
    const l = ch.skills[sk.id] || 0;
    const eff = P.skillLevel(ch, sk.id, data, st);
    const effNext = l ? eff + 1 : 1 + (st.skillBonus[sk.tree] || 0) + st.skillBonus.all;
    const maxed = l >= sk.maxLevel;
    const cur = l ? describeSkill(sk, eff, ch, data, st) : [];
    const next = !maxed ? describeSkill(sk, effNext, ch, data, st) : [];
    const need = P.unlockLevel(sk, data.config);
    const curMap = new Map(cur), nextMap = new Map(next);
    const labels = [...new Set([...cur.map((r) => r[0]), ...next.map((r) => r[0])])];
    const changed = [], same = [];
    for (const k of labels) {
      const a = curMap.get(k), b = nextMap.get(k);
      if (!l) changed.push(`<div class="tl"><span>${esc(k)}</span><b>${esc(b)}</b></div>`);
      else if (b === undefined || a === b) same.push(`${esc(k)} <b>${esc(a ?? b)}</b>`);
      else changed.push(`<div class="tl"><span>${esc(k)}</span><b>${esc(a ?? '–')} <i class="up">→ ${esc(b)}</i></b></div>`);
    }
    const lvlTxt = !l ? `Chưa học · mở ở cấp ${need}` : maxed ? `cấp ${eff} · tối đa` : `cấp ${eff} → ${effNext}${eff > l ? ` (${l} điểm + ${eff - l} từ đồ)` : ''}`;
    const syn = (sk.synergies || []).map((x) => `+${pctStr(x.pct)}/cấp ${esc(data.skills[x.from].name)}`);
    const synNow = P.synergyPct(ch, sk);
    const fs = sk.flatScale ?? (sk.damage || sk.dps ? 1 : null);
    const flatSrc = sk.summon ? 'Năng lượng' : sk.element === 'physical' ? 'Sức mạnh' : 'Năng lượng';
    const flat = fs != null && !sk.deathBurst && sk.kind !== 'static' ? `<span class="chip" data-tip="Mỗi điểm ${flatSrc} cộng thêm (so với lúc tạo nhân vật) cộng thẳng vào sát thương ${sk.dps ? 'mỗi giây' : 'mỗi đòn'} của kỹ năng này, nhân ${Math.round(fs * 100)}%.">Cộng thẳng ${Math.round(fs * 100)}% ${flatSrc}</span>` : '';
    return `<div class="sk-head"><b>${esc(sk.name)}</b><small>${sk.type === 'active' ? 'Chủ động' : 'Bị động'} · ${lvlTxt}</small></div>
      <p class="sk-desc">${esc(sk.desc)}</p>
      ${changed.join('')}
      ${same.length ? `<div class="tl same">${same.join(' · ')}</div>` : ''}
      ${syn.length ? `<div class="tl syn">Synergy ${syn.join(', ')}${synNow ? ` (đang +${pctStr(synNow)})` : ''}</div>` : ''}
      ${flat}`;
  }

  // ---------- Đồ đạc ----------
  cellHtml(it, where, key, label = '') {
    const ch = this.ch;
    const sel = this.sel && this.sel.where === where && String(this.sel.key) === String(key);
    if (!it) return `<div class="cell empty ${sel ? 'sel' : ''}" data-cell="${where}:${key}">${label ? `<span>${esc(label)}</span>` : ''}</div>`;
    const col = it.type === 'rune' ? this.data.runes.byId[it.rune].color : this.data.items.rarities[it.rarity].color;
    const ok = I.meetsReq(it, ch.level, I.totalStr(ch));
    const dots = it.sockets ? `<span class="sk">${Array.from({ length: it.sockets }, (_, i) => `<i class="${it.runes?.[i] ? 'full' : ''}" style="${it.runes?.[i] ? `--ruc:${this.data.runes.byId[it.runes[i].id].color}` : ''}"></i>`).join('')}</span>` : '';
    // So sánh với đồ đang mặc: ↑ tốt hơn, ↓ kém hơn, ✕ sai lớp hoặc chưa đủ yêu cầu.
    const v = where !== 'eq' ? L.itemVerdict(it, ch, this.data, this._tree) : null;
    const vb = v === 'up' ? '<b class="vd up" title="Tốt hơn đồ đang mặc">↑</b>' : v === 'down' ? '<b class="vd down" title="Kém hơn đồ đang mặc">↓</b>' : v === 'cant' ? `<b class="vd cant" title="${L.wrongClass(it, ch) ? 'Đồ của lớp khác' : 'Chưa đủ yêu cầu'}">✕</b>` : '';
    const flags = `${it.locked ? '<b class="lk" title="Đã khoá">🔒</b>' : ''}${it.junk ? '<b class="jk" title="Rác: tự bán khi về làng">🗑</b>' : ''}`;
    const qty = I.runeQty(it) > 1 ? `<b class="qty">×${I.runeQty(it)}</b>` : '';
    return `<div class="cell ${sel ? 'sel' : ''} ${ok ? '' : 'unmet'} ${it.junk ? 'junk' : ''}" data-cell="${where}:${key}" style="--rc:${col}">
      <span class="ic">${esc(typeIcon(it.type))}</span><span class="nm">${esc(it.name)}</span>${dots}${vb}${flags}${qty}</div>`;
  }

  // ---------- Lò chế (chỉ ở làng) ----------
  renderCraft() {
    const ch = this.ch;
    const data = this.data;
    const C = data.items.crafting;
    const eqHtml = data.items.slots.map((s) => `<div class="eqslot eq-${s.id}">${this.cellHtml(ch.equipment[s.id], 'eq', s.id, s.name)}</div>`).join('');
    const invHtml = ch.inventory.map((it, i) => this.cellHtml(it, 'inv', i)).join('');
    const it = this.selItem();
    let detail = '<div class="muted">Chọn một món đồ (đang mặc hoặc trong kho) để chế tác.</div>' + this.bulkBarHtml('salvage');
    if (it && it.type !== 'rune') {
      const c = I.craftCosts(it, data);
      const b = (act, label, cost, why) => `<button data-craft="${act}" ${cost ? '' : 'disabled'} title="${esc(why || '')}">${label}${cost ? ` <small>${[cost.shards ? `${cost.shards} mảnh` : '', cost.gold ? `${cost.gold} vàng` : ''].filter(Boolean).join(' + ')}</small>` : ''}</button>`;
      detail = `<div class="item-detail">${this.itemTip(it, this.sel.where)}</div>
        <div class="craft-btns">
          ${this.sel.where !== 'eq' ? `<button data-craft="salvage" class="ghost">Phân giải → +${c.salvage} mảnh</button>` : ''}
          ${b('upgrade', c.upgrade ? `Nâng bậc lên ${data.items.rarities[c.upgrade.to].name}` : 'Nâng bậc', c.upgrade, 'Chỉ đồ Thường và Ma thuật')}
          ${b('reroll', 'Đổi dòng chỉ số', c.reroll, 'Chỉ đồ Ma thuật và Hiếm')}
          ${b('socket', 'Đục thêm 1 lỗ', c.socket, 'Đã đủ lỗ tối đa, hoặc đồ Độc nhất / đồ bộ')}
          ${b('unsocket', 'Gỡ hết rune (rune bị mất)', c.unsocket, 'Không có rune')}
        </div>`;
    } else if (it) detail = `<div class="item-detail">${this.itemTip(it, this.sel.where)}</div>${this.sel.where === 'inv' ? '<div class="craft-btns"><button data-craft="salvage" class="ghost">Vứt rune</button></div>' : ''}`;
    const counts = I.runeCounts(ch);
    const runeRows = data.runes.list.map((r) => {
      const n = counts[r.id] || 0;
      const next = data.runes.list.find((x) => x.tier === r.tier + 1);
      return `<div class="rune-row"><span style="color:${r.color}">${esc(r.name)}</span><b>×${n}</b>${next ? `<button data-combine="${r.id}" ${n >= C.runeCombine.count ? '' : 'disabled'}>${C.runeCombine.count} → 1 ${esc(next.name)} <small>${C.runeCombine.goldPerTier * r.tier} vàng</small></button>` : '<span class="muted">bậc cao nhất</span>'}</div>`;
    }).join('');
    this.body.innerHTML = `<div class="items-wrap craft-mode">
      <section class="paperdoll"><h4>Trang bị</h4><div class="eqgrid">${eqHtml}</div></section>
      <section class="inv"><h4>Kho đồ <small>Mảnh: <b>${(ch.shards || 0).toLocaleString('vi-VN')}</b></small></h4><div class="grid inv-grid">${invHtml}</div>
        <h4 style="margin-top:12px">Ghép rune</h4><div class="runes-list">${runeRows}</div></section>
      <section class="idetail">${detail}</section>
    </div>`;
  }

  renderItems(stashMode) {
    const ch = this.ch;
    const data = this.data;
    const st = this.stats();
    const eqHtml = data.items.slots.map((s) => `<div class="eqslot eq-${s.id}">${this.cellHtml(ch.equipment[s.id], 'eq', s.id, s.name)}${st.inactiveGear.includes(s.id) && ch.equipment[s.id] ? '<em class="bad">Chưa đủ yêu cầu</em>' : ''}</div>`).join('');
    const invHtml = ch.inventory.map((it, i) => this.cellHtml(it, 'inv', i)).join('');
    const used = ch.inventory.filter(Boolean).length;
    const it = this.selItem();
    const tools = stashMode ? '' : (this.village ? this.bulkBarHtml('sell') + this.buybackHtml() : '') + this.lootFilterHtml();
    let detail = '<div class="muted hint">Rê chuột vào đồ để xem chỉ số. Bấm để chọn, bấm đúp: mặc / tháo' + (stashMode ? ' / chuyển rương' : '') + `. Ctrl + bấm: ${this.village ? 'bán ngay' : 'đánh dấu rác'}.<br>↑ tốt hơn · ↓ kém hơn · ✕ lớp khác / chưa đủ yêu cầu · 🔒 khoá.</div>` + tools;
    if (it) {
      const s = this.sel;
      const btn = [];
      if (s.where === 'inv' && !stashMode && it.type !== 'rune') btn.push('<button data-act="wear" class="primary">Mặc</button>');
      if (s.where === 'inv' && it.type === 'rune') {
        const targets = [];
        for (const sl of data.items.slots) { const e = ch.equipment[sl.id]; if (e && I.freeSockets(e) > 0) targets.push([`eq:${sl.id}`, `${e.name} (đang mặc)`]); }
        ch.inventory.forEach((e, i) => { if (e && e.type !== 'rune' && I.freeSockets(e) > 0) targets.push([`inv:${i}`, e.name]); });
        if (targets.length) btn.push(...targets.map(([k, n]) => `<button data-rune="${k}" class="primary">Ghép vào ${esc(n)}</button>`));
        else btn.push('<span class="muted">Không có món đồ nào còn lỗ trống.</span>');
      }
      if (s.where === 'eq') btn.push('<button data-act="unequip">Tháo</button>');
      if (s.where === 'inv' && stashMode) btn.push('<button data-act="store" class="primary">Cất vào rương</button>');
      if (s.where === 'stash') btn.push('<button data-act="take" class="primary">Lấy ra kho đồ</button>');
      if (s.where === 'inv' && this.village && !it.locked && I.runeQty(it) > 1) btn.push(`<button data-act="sellone">Bán 1 viên (${I.unitSellValue(it, data)} vàng)</button>`);
      if (s.where === 'inv' && this.village && !it.locked) btn.push(`<button data-act="sell">Bán${I.runeQty(it) > 1 ? ` cả ô ×${I.runeQty(it)}` : ''} (${I.sellValue(it, data)} vàng)</button>`);
      if (s.where === 'inv' && !this.village && !it.locked) btn.push(`<button data-act="junk">${it.junk ? 'Bỏ đánh dấu rác' : 'Đánh dấu rác (bán khi về làng)'}</button>`);
      if (s.where === 'inv' && !this.village && !it.locked) btn.push('<button data-act="drop" class="ghost">Vứt bỏ</button>');
      if (s.where !== 'stash') btn.push(`<button data-act="lock" class="ghost">${it.locked ? 'Mở khoá' : '🔒 Khoá'}</button>`);
      const col = it.type === 'rune' ? data.runes.byId[it.rune].color : data.items.rarities[it.rarity].color;
      detail = `<div class="sel-item" data-tipcell="${s.where}:${s.key}" style="--rc:${col}"><b>${esc(it.name)}${I.runeQty(it) > 1 ? ` ×${I.runeQty(it)}` : ''}</b><small>rê chuột vào đây hoặc vào ô đồ để xem chỉ số</small></div><div class="item-btns">${btn.join('')}</div>${tools}`;
    }
    let stashHtml = '';
    if (stashMode) {
      const stash = this.hooks.getStash();
      stashHtml = `<section class="stash"><h4>Rương chung <small>${stash.filter(Boolean).length}/${stash.length} · dùng chung cho mọi nhân vật trên trình duyệt này</small></h4><div class="grid stash-grid">${stash.map((x, i) => this.cellHtml(x, 'stash', i)).join('')}</div></section>`;
    }
    this.body.innerHTML = `<div class="items-wrap ${stashMode ? 'stash-mode' : ''}">
      ${stashMode ? stashHtml : `<section class="paperdoll"><h4>Trang bị</h4><div class="eqgrid">${eqHtml}</div></section>`}
      <section class="inv"><h4>Kho đồ <small>${used}/${ch.inventory.length}</small> <button data-sort class="mini">Sắp xếp</button></h4><div class="grid inv-grid">${invHtml}</div></section>
      <section class="idetail">${detail}</section>
    </div>`;
  }
}

const BULK_LABELS = { normal: 'Đồ thường', magic: 'Đồ ma thuật', worse: 'Kém hơn đồ đang mặc', wrongClass: 'Đồ của lớp khác', junk: 'Đã đánh dấu rác' };

function typeIcon(t) {
  return { weapon: '⚚', offhand: '◉', head: '⛑', body: '▣', gloves: '✋', belt: '═', boots: '▟', amulet: '◈', ring: '○', rune: 'ᚱ' }[t] || '?';
}
