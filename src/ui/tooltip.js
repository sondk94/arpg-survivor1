// Khung nổi khi rê chuột (vật phẩm, kỹ năng, chỉ số). Trên màn hình cảm ứng: chạm để hiện, chạm chỗ khác để ẩn.
export class Tooltip {
  constructor() {
    this.el = document.createElement('div');
    this.el.className = 'tip hidden';
    document.body.appendChild(this.el);
    this.key = null;
  }

  show(key, html, x, y) {
    if (this.key !== key) {
      this.key = key;
      this.el.innerHTML = html;
    }
    this.el.classList.remove('hidden');
    this.move(x, y);
  }

  move(x, y) {
    if (this.el.classList.contains('hidden')) return;
    const r = this.el.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight;
    let left = x + 16, top = y + 14;
    if (left + r.width > vw - 8) left = Math.max(8, x - r.width - 16);
    if (top + r.height > vh - 8) top = Math.max(8, vh - r.height - 8);
    this.el.style.left = `${left}px`;
    this.el.style.top = `${top}px`;
  }

  hide() {
    this.key = null;
    this.el.classList.add('hidden');
  }
}
