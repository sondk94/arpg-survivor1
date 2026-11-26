// Bàn phím (WASD / mũi tên), giữ chuột trái và cần ảo cảm ứng ở nửa trái màn hình.

// Hướng đi khi giữ chuột: từ tâm màn hình (vị trí nhân vật, camera luôn bám theo) tới con trỏ.
// Con trỏ quá gần nhân vật (trong vùng chết) thì đứng yên.
export function mouseDir(mx, my, cx, cy, dead = 14) {
  const dx = mx - cx, dy = my - cy;
  const l = Math.hypot(dx, dy);
  return l > dead ? { x: dx / l, y: dy / l } : { x: 0, y: 0 };
}

export class Input {
  constructor(canvas, onKey) {
    this.keys = new Set();
    this.joy = { active: false, id: null, ox: 0, oy: 0, dx: 0, dy: 0 };
    this.mouse = { active: false, x: 0, y: 0 };
    this.canvas = canvas;
    // Giữ chuột trái trên màn chơi: nhân vật đi về phía con trỏ; thả chuột thì dừng.
    canvas.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      this.mouse = { active: true, x: e.clientX, y: e.clientY };
      canvas.focus();
      e.preventDefault();
    });
    window.addEventListener('mousemove', (e) => { if (this.mouse.active) { this.mouse.x = e.clientX; this.mouse.y = e.clientY; } });
    window.addEventListener('mouseup', (e) => { if (e.button === 0) this.mouse.active = false; });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (['Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key)) e.preventDefault();
      if (!e.repeat) onKey(e);
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => { this.keys.clear(); this.mouse.active = false; });

    const start = (e) => {
      for (const t of e.changedTouches) {
        if (this.joy.active || t.clientX > window.innerWidth * 0.6) continue;
        this.joy = { active: true, id: t.identifier, ox: t.clientX, oy: t.clientY, dx: 0, dy: 0 };
        e.preventDefault();
      }
    };
    const move = (e) => {
      for (const t of e.changedTouches) {
        if (t.identifier !== this.joy.id) continue;
        let dx = (t.clientX - this.joy.ox) / 50, dy = (t.clientY - this.joy.oy) / 50;
        const l = Math.hypot(dx, dy);
        if (l > 1) { dx /= l; dy /= l; }
        this.joy.dx = dx; this.joy.dy = dy;
        e.preventDefault();
      }
    };
    const end = (e) => {
      for (const t of e.changedTouches) if (t.identifier === this.joy.id) this.joy = { active: false, id: null, ox: 0, oy: 0, dx: 0, dy: 0 };
    };
    canvas.addEventListener('touchstart', start, { passive: false });
    canvas.addEventListener('touchmove', move, { passive: false });
    canvas.addEventListener('touchend', end);
    canvas.addEventListener('touchcancel', end);
  }

  move() {
    if (this.joy.active) return { x: this.joy.dx, y: this.joy.dy };
    const k = this.keys;
    let x = 0, y = 0;
    if (k.has('KeyA') || k.has('ArrowLeft')) x -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) x += 1;
    if (k.has('KeyW') || k.has('ArrowUp')) y -= 1;
    if (k.has('KeyS') || k.has('ArrowDown')) y += 1;
    const l = Math.hypot(x, y);
    if (l) return { x: x / l, y: y / l };
    // Không bấm phím: giữ chuột trái thì đi theo con trỏ.
    if (this.mouse.active) {
      const r = this.canvas.getBoundingClientRect();
      return mouseDir(this.mouse.x, this.mouse.y, r.left + r.width / 2, r.top + r.height / 2);
    }
    return { x: 0, y: 0 };
  }
}
