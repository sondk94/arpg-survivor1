// Lưới không gian (danh sách liên kết trên mảng) để tìm quái gần một điểm nhanh.
export class Grid {
  constructor(w, h, cell) {
    this.cell = cell;
    this.cols = Math.ceil(w / cell) + 1;
    this.rows = Math.ceil(h / cell) + 1;
    this.head = new Int32Array(this.cols * this.rows).fill(-1);
    this.next = new Int32Array(1024);
    this.items = [];
  }

  rebuild(items) {
    this.items = items;
    this.head.fill(-1);
    if (this.next.length < items.length) this.next = new Int32Array(items.length * 2);
    const { cell, cols, rows, head, next } = this;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (it.dead) continue;
      let cx = (it.x / cell) | 0;
      let cy = (it.y / cell) | 0;
      if (cx < 0) cx = 0; else if (cx >= cols) cx = cols - 1;
      if (cy < 0) cy = 0; else if (cy >= rows) cy = rows - 1;
      const k = cy * cols + cx;
      next[i] = head[k];
      head[k] = i;
    }
  }

  // Gọi fn(item) cho mọi phần tử trong các ô giao với hình tròn. fn trả true để dừng.
  query(x, y, r, fn) {
    const { cell, cols, rows, head, next, items } = this;
    let x0 = ((x - r) / cell) | 0, x1 = ((x + r) / cell) | 0;
    let y0 = ((y - r) / cell) | 0, y1 = ((y + r) / cell) | 0;
    if (x0 < 0) x0 = 0; if (y0 < 0) y0 = 0;
    if (x1 >= cols) x1 = cols - 1; if (y1 >= rows) y1 = rows - 1;
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        for (let i = head[cy * cols + cx]; i !== -1; i = next[i]) {
          const it = items[i];
          if (!it.dead && fn(it) === true) return;
        }
      }
    }
  }
}
