// Bảng debug: nhảy phút, cho điểm, bất tử, DPS/FPS, thử tải 300 quái, bot tự chơi.
export function setupDebug(el, app) {
  el.innerHTML = `
    <div class="dbg-head">Debug <small>(F2 hoặc \` để ẩn/hiện)</small></div>
    <div class="dbg-row"><label>Nhảy tới phút <input id="dbg-min" type="number" min="0" max="11" step="0.5" value="5"></label><button data-dbg="jump">Đi</button></div>
    <div class="dbg-row"><button data-dbg="lvl">+1 cấp</button><button data-dbg="attr">+5 điểm TT</button><button data-dbg="skill">+1 điểm KN</button></div>
    <div class="dbg-row"><label><input type="checkbox" data-dbg-check="god"> Bất tử</label><label><input type="checkbox" data-dbg-check="hud" checked> DPS/FPS</label><label><input type="checkbox" data-dbg-check="dmg" checked> Số sát thương</label></div>
    <div class="dbg-row">Tốc độ: <button data-dbg="ts1">×1</button><button data-dbg="ts2">×2</button><button data-dbg="ts4">×4</button></div>
    <div class="dbg-row"><button data-dbg="spawn300">Sinh 300 quái</button><button data-dbg="killall">Giết hết quái</button></div>
    <div class="dbg-row"><button data-dbg="gold">+500 vàng</button><button data-dbg="loot">Rơi 5 đồ</button><button data-dbg="unique">Rơi 1 độc nhất</button></div>
    <div class="dbg-row"><label><input type="checkbox" data-dbg-check="bot"> Bot tự chơi</label><select id="dbg-build"><option value="fire">Lửa</option><option value="cold">Băng</option><option value="lightning">Sét</option><option value="hybrid">Lai Băng+Lửa</option><option value="weapon">CB: Vũ Khí</option><option value="shout">CB: Tiếng Thét</option><option value="blood">CB: Huyết Chiến</option></select></div>
    <div class="dbg-row"><button data-dbg="quit">Bỏ lượt, về làng</button></div>`;
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-dbg]');
    if (!b) return;
    const g = app.game;
    app.ui.debugTouched = true;
    switch (b.dataset.dbg) {
      case 'jump': if (g) g.jumpTo(Number(el.querySelector('#dbg-min').value) * 60); break;
      case 'lvl': app.debugLevel(); break;
      case 'attr': app.ch.attrPoints += 5; app.refresh(); break;
      case 'skill': app.ch.skillPoints += 1; app.refresh(); break;
      case 'ts1': app.ui.timeScale = 1; break;
      case 'ts2': app.ui.timeScale = 2; break;
      case 'ts4': app.ui.timeScale = 4; break;
      case 'spawn300': if (g) g.debugSpawn(300 - g.enemies.length > 0 ? 300 - g.enemies.length : 0); break;
      case 'killall': if (g) g.debugKillAll(); break;
      case 'quit': app.quitRun(); break;
      case 'gold': app.ch.gold += 500; app.refresh(); break;
      case 'loot':
      case 'unique': {
        const n = b.dataset.dbg === 'loot' ? 5 : 1;
        for (let i = 0; i < n; i++) {
          const ilvl = Math.max(app.ch.level, 5);
          const it = app.generateItem(ilvl, b.dataset.dbg === 'unique' ? { rarity: 'unique' } : {});
          if (g) g.dropItem(g.player.x + 40 * Math.cos(i * 1.3), g.player.y + 40 * Math.sin(i * 1.3), it);
          else app.addItem(it);
        }
        app.refresh();
        break;
      }
    }
    b.blur();
  });
  el.addEventListener('change', (e) => {
    if (e.target.id === 'dbg-build') { app.ui.botBuild = e.target.value; e.target.blur(); return; }
    const c = e.target.closest('[data-dbg-check]');
    if (!c) return;
    const on = c.checked;
    app.ui.debugTouched = true;
    switch (c.dataset.dbgCheck) {
      case 'god': app.ui.god = on; if (app.game) app.game.god = on; break;
      case 'hud': app.ui.debugHud = on; break;
      case 'dmg': app.ui.showDamage = on; if (app.game) app.game.showDamage = on; break;
      case 'bot': app.ui.bot = on; break;
    }
    c.blur();
  });
}
