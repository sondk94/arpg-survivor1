// Bảng debug: nhảy phút, cho điểm, bất tử, DPS/FPS, thử tải 300 quái, bot tự chơi.
export function setupDebug(el, app) {
  el.innerHTML = `
    <div class="dbg-head">Debug <small>(F2 hoặc \` để ẩn/hiện)</small></div>
    <div class="dbg-row"><label>Nhảy tới phút <input id="dbg-min" type="number" min="0" max="11" step="0.5" value="5"></label><button data-dbg="jump">Đi</button></div>
    <div class="dbg-row"><button data-dbg="lvl">+1 cấp</button><button data-dbg="attr">+5 điểm TT</button><button data-dbg="skill">+1 điểm KN</button></div>
    <div class="dbg-row"><label><input type="checkbox" data-dbg-check="god"> Bất tử</label><label><input type="checkbox" data-dbg-check="hud" checked> DPS/FPS</label><label><input type="checkbox" data-dbg-check="dmg" checked> Số sát thương</label></div>
    <div class="dbg-row">Tốc độ: <button data-dbg="ts1">×1</button><button data-dbg="ts2">×2</button><button data-dbg="ts4">×4</button></div>
    <div class="dbg-row"><button data-dbg="spawn300">Sinh 300 quái</button><button data-dbg="killall">Giết hết quái</button></div>
    <div class="dbg-row"><label><input type="checkbox" data-dbg-check="bot"> Bot tự chơi + tự cộng điểm</label></div>
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
    }
    b.blur();
  });
  el.addEventListener('change', (e) => {
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
