// Nhân vật vẽ bằng hình khối có chân chạy.
// - Quái thường: vẽ sẵn thành các khung hình (8 khung bước chân × 2 hướng × 4 kiểu màu) để vẽ nhanh khi có 300 quái.
// - Người chơi, trùm nhỏ, boss: vẽ trực tiếp mỗi khung hình (chỉ 1–2 con).
const TAU = Math.PI * 2;
export const WALK_FRAMES = 8;

function limb(ctx, x1, y1, x2, y2, w, color) {
  ctx.strokeStyle = color;
  ctx.lineWidth = w;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

// Chân có đầu gối: góc đùi theo nhịp bước, cẳng chân gập khi đưa chân về phía sau.
function leg(ctx, hx, hy, len, swing, w, color, foot) {
  const thigh = len * 0.52, shin = len * 0.5;
  const kx = hx + Math.sin(swing) * thigh, ky = hy + Math.cos(swing) * thigh;
  const bend = Math.max(0, -swing) * 0.9 + 0.05;
  const fx = kx + Math.sin(swing - bend) * shin, fy = ky + Math.cos(swing - bend) * shin;
  limb(ctx, hx, hy, kx, ky, w, color);
  limb(ctx, kx, ky, fx, fy, w * 0.9, color);
  if (foot) {
    ctx.fillStyle = foot;
    ctx.beginPath();
    ctx.ellipse(fx + w * 0.35, fy, w * 0.75, w * 0.42, 0, 0, TAU);
    ctx.fill();
  }
}

// ---------- Quái thường (hướng mặt sang phải, tâm = tâm va chạm) ----------
function paintZombie(ctx, r, ph) {
  const a = ph * TAU, s = Math.sin(a), c = Math.cos(a);
  const bob = -Math.abs(c) * 0.06 * r;
  const hipY = 0.28 * r + bob, L = 0.95 * r;
  const skin = '#8fae6a', skinDark = '#6d8a50', cloth = '#55603f', pants = '#3e3a30';
  leg(ctx, -0.05 * r, hipY, L, -s * 0.5, 0.3 * r, '#2f2c24', '#24221c');
  limb(ctx, 0.05 * r, -0.38 * r + bob, 0.9 * r, -0.28 * r + s * 0.06 * r + bob, 0.22 * r, skinDark); // tay sau
  ctx.save();
  ctx.translate(0, bob);
  ctx.rotate(0.18);
  ctx.fillStyle = cloth;
  ctx.beginPath();
  ctx.roundRect(-0.36 * r, -0.62 * r, 0.7 * r, 0.98 * r, 0.18 * r);
  ctx.fill();
  ctx.fillStyle = '#46502f'; // vết rách
  ctx.beginPath();
  ctx.moveTo(-0.36 * r, 0.2 * r); ctx.lineTo(-0.15 * r, 0.36 * r); ctx.lineTo(0.02 * r, 0.18 * r); ctx.lineTo(0.2 * r, 0.36 * r); ctx.lineTo(0.34 * r, 0.22 * r); ctx.lineTo(0.34 * r, 0.36 * r); ctx.lineTo(-0.36 * r, 0.36 * r);
  ctx.fill();
  ctx.restore();
  leg(ctx, 0.05 * r, hipY, L, s * 0.5, 0.3 * r, pants, '#2a2720');
  // đầu
  ctx.fillStyle = skin;
  ctx.beginPath(); ctx.arc(0.3 * r, -0.86 * r + bob, 0.4 * r, 0, TAU); ctx.fill();
  ctx.fillStyle = skinDark;
  ctx.beginPath(); ctx.arc(0.18 * r, -0.98 * r + bob, 0.12 * r, 0, TAU); ctx.fill();
  ctx.fillStyle = '#c0392b';
  ctx.beginPath(); ctx.arc(0.5 * r, -0.9 * r + bob, 0.07 * r, 0, TAU); ctx.fill();
  ctx.fillStyle = '#2a1a1a';
  ctx.fillRect(0.42 * r, -0.7 * r + bob, 0.22 * r, 0.06 * r);
  limb(ctx, 0.08 * r, -0.34 * r + bob, 1.0 * r, -0.2 * r - s * 0.06 * r + bob, 0.22 * r, skin); // tay trước
}

function paintSkeleton(ctx, r, ph) {
  const a = ph * TAU, s = Math.sin(a), c = Math.cos(a);
  const bob = -Math.abs(c) * 0.07 * r;
  const bone = '#e6dfc8', shade = '#b9b096';
  const hipY = 0.25 * r + bob, L = 1.0 * r;
  leg(ctx, 0, hipY, L, -s * 0.6, 0.13 * r, shade, shade);
  // tay sau giơ cao cầm xương chuẩn bị ném
  limb(ctx, -0.05 * r, -0.45 * r + bob, -0.45 * r, -0.95 * r + bob + s * 0.05 * r, 0.12 * r, shade);
  ctx.save();
  ctx.translate(-0.45 * r, -1.0 * r + bob);
  ctx.rotate(-0.8);
  ctx.fillStyle = bone;
  ctx.fillRect(-0.32 * r, -0.06 * r, 0.64 * r, 0.12 * r);
  ctx.beginPath(); ctx.arc(-0.32 * r, -0.07 * r, 0.09 * r, 0, TAU); ctx.arc(-0.32 * r, 0.07 * r, 0.09 * r, 0, TAU); ctx.arc(0.32 * r, -0.07 * r, 0.09 * r, 0, TAU); ctx.arc(0.32 * r, 0.07 * r, 0.09 * r, 0, TAU); ctx.fill();
  ctx.restore();
  // xương sống + xương sườn
  limb(ctx, 0, hipY, 0.02 * r, -0.55 * r + bob, 0.1 * r, bone);
  for (let i = 0; i < 3; i++) {
    const y = -0.45 * r + i * 0.18 * r + bob;
    ctx.strokeStyle = bone;
    ctx.lineWidth = 0.08 * r;
    ctx.beginPath(); ctx.ellipse(0.02 * r, y, 0.3 * r, 0.08 * r, 0, 0, Math.PI); ctx.stroke();
  }
  ctx.fillStyle = bone;
  ctx.beginPath(); ctx.ellipse(0, hipY, 0.22 * r, 0.09 * r, 0, 0, TAU); ctx.fill();
  leg(ctx, 0, hipY, L, s * 0.6, 0.13 * r, bone, bone);
  // sọ
  ctx.fillStyle = bone;
  ctx.beginPath(); ctx.arc(0.12 * r, -0.85 * r + bob, 0.34 * r, 0, TAU); ctx.fill();
  ctx.fillRect(0.02 * r, -0.66 * r + bob, 0.32 * r, 0.16 * r);
  ctx.fillStyle = '#1b1714';
  ctx.beginPath(); ctx.arc(0.26 * r, -0.88 * r + bob, 0.09 * r, 0, TAU); ctx.arc(0.04 * r, -0.88 * r + bob, 0.08 * r, 0, TAU); ctx.fill();
  ctx.fillRect(0.08 * r, -0.6 * r + bob, 0.04 * r, 0.08 * r);
  ctx.fillRect(0.18 * r, -0.6 * r + bob, 0.04 * r, 0.08 * r);
  limb(ctx, 0.05 * r, -0.42 * r + bob, 0.55 * r, -0.05 * r - s * 0.1 * r + bob, 0.12 * r, bone); // tay trước
}

function paintBat(ctx, r, ph) {
  const flap = Math.sin(ph * TAU);
  const body = '#6a4a9a', wing = '#8a62c4', mem = '#5a3d85';
  const wy = -flap * 0.9 * r;
  for (const side of [-1, 1]) {
    ctx.fillStyle = side < 0 ? mem : wing;
    ctx.beginPath();
    ctx.moveTo(0, -0.1 * r);
    ctx.lineTo(side * 0.9 * r, wy - 0.4 * r);
    ctx.lineTo(side * 1.7 * r, wy * 0.6 - 0.1 * r);
    ctx.lineTo(side * 1.3 * r, wy * 0.4 + 0.2 * r);
    ctx.lineTo(side * 0.95 * r, wy * 0.3 + 0.05 * r);
    ctx.lineTo(side * 0.6 * r, wy * 0.2 + 0.35 * r);
    ctx.lineTo(0, 0.3 * r);
    ctx.closePath();
    ctx.fill();
  }
  ctx.fillStyle = body;
  ctx.beginPath(); ctx.ellipse(0, 0.05 * r, 0.42 * r, 0.6 * r, 0, 0, TAU); ctx.fill();
  ctx.beginPath(); ctx.moveTo(-0.3 * r, -0.4 * r); ctx.lineTo(-0.22 * r, -0.85 * r); ctx.lineTo(-0.05 * r, -0.45 * r); ctx.fill();
  ctx.beginPath(); ctx.moveTo(0.3 * r, -0.4 * r); ctx.lineTo(0.22 * r, -0.85 * r); ctx.lineTo(0.05 * r, -0.45 * r); ctx.fill();
  ctx.fillStyle = '#ff4d4d';
  ctx.beginPath(); ctx.arc(-0.14 * r, -0.2 * r, 0.09 * r, 0, TAU); ctx.arc(0.14 * r, -0.2 * r, 0.09 * r, 0, TAU); ctx.fill();
  // chân quặp
  limb(ctx, -0.12 * r, 0.6 * r, -0.16 * r, 0.85 * r, 0.08 * r, '#3e2a5e');
  limb(ctx, 0.12 * r, 0.6 * r, 0.16 * r, 0.85 * r, 0.08 * r, '#3e2a5e');
}

const PAINTERS = { zombie: paintZombie, bone_thrower: paintSkeleton, bat: paintBat };
// Khung bao của từng loại (theo bán kính r, tâm = tâm va chạm): [trái, trên, phải, dưới]
const BOUNDS = { zombie: [-1.25, -1.45, 1.35, 1.35], bone_thrower: [-1.05, -1.5, 1.05, 1.4], bat: [-1.85, -1.3, 1.85, 1.1] };
const TINTS = { normal: null, hit: 'rgba(255,255,255,0.75)', frozen: 'rgba(190,235,255,0.7)', slow: 'rgba(120,200,255,0.35)' };

// Bộ sprite vẽ sẵn đúng kích thước điểm ảnh trên màn hình (pxPerUnit = tỉ lệ phóng × devicePixelRatio),
// để lúc vẽ chỉ còn sao chép 1:1, không phải co giãn ảnh.
// sprites.get(type, tint, frame, flip) → { img, x0, y0, w, h } (x0..h theo px thế giới, tính từ tâm).
export function buildSprites(monsters, pxPerUnit) {
  const cache = {};
  for (const [type, paint] of Object.entries(PAINTERS)) {
    const r = monsters[type].radius;
    const [bl, bt, br, bb] = BOUNDS[type];
    const pw = Math.ceil((br - bl) * r * pxPerUnit), phh = Math.ceil((bb - bt) * r * pxPerUnit);
    const ox = -bl * r * pxPerUnit, oy = -bt * r * pxPerUnit;
    const set = {};
    for (const tint of Object.keys(TINTS)) {
      set[tint] = [[], []];
      for (let f = 0; f < WALK_FRAMES; f++) {
        for (const flip of [0, 1]) {
          const cv = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(pw, phh) : Object.assign(document.createElement('canvas'), { width: pw, height: phh });
          const ctx = cv.getContext('2d');
          ctx.translate(flip ? pw - ox : ox, oy);
          ctx.scale(pxPerUnit * (flip ? -1 : 1), pxPerUnit);
          paint(ctx, r, f / WALK_FRAMES);
          if (TINTS[tint]) {
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.globalCompositeOperation = 'source-atop';
            ctx.fillStyle = TINTS[tint];
            ctx.fillRect(0, 0, pw, phh);
          }
          set[tint][flip].push(cv);
        }
      }
    }
    const w = pw / pxPerUnit, h = phh / pxPerUnit;
    cache[type] = { r, set, w, h, x0: bl * r, y0: bt * r, x0f: -(w + bl * r) };
  }
  return {
    pxPerUnit,
    get(type, tint, frame, flip) {
      const c = cache[type];
      return { img: c.set[tint][flip ? 1 : 0][frame % WALK_FRAMES], x0: flip ? c.x0f : c.x0, y0: c.y0, w: c.w, h: c.h, r: c.r };
    },
  };
}

// ---------- Người chơi: pháp sư áo choàng, mũ nhọn, gậy phép ----------
export function drawMage(ctx, x, y, r, face, phase, moving, opts = {}) {
  const a = phase * TAU, s = moving ? Math.sin(a) : 0, c = Math.cos(a);
  const bob = moving ? -Math.abs(c) * 0.08 * r : 0;
  ctx.save();
  ctx.translate(x, y);
  if (face < 0) ctx.scale(-1, 1);
  const robe = opts.hurt ? '#c0506a' : '#5b4bc4', robeDark = opts.hurt ? '#93394f' : '#3f328f';
  const hipY = 0.35 * r + bob, L = 0.85 * r;
  // chân (lộ ra dưới áo choàng)
  leg(ctx, -0.08 * r, hipY, L, -s * 0.55, 0.24 * r, '#2b2233', '#3a2a1e');
  leg(ctx, 0.08 * r, hipY, L, s * 0.55, 0.24 * r, '#3a2f4a', '#4a3424');
  // áo choàng
  ctx.fillStyle = robe;
  ctx.beginPath();
  ctx.moveTo(-0.32 * r, -0.55 * r + bob);
  ctx.lineTo(0.32 * r, -0.55 * r + bob);
  ctx.lineTo(0.5 * r, 0.62 * r + bob);
  ctx.quadraticCurveTo(0, 0.75 * r + bob + s * 0.05 * r, -0.55 * r, 0.62 * r + bob);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = robeDark;
  ctx.fillRect(-0.05 * r, -0.5 * r + bob, 0.1 * r, 1.15 * r);
  ctx.fillStyle = '#d9b35c'; // thắt lưng
  ctx.fillRect(-0.4 * r, 0.05 * r + bob, 0.82 * r, 0.1 * r);
  // mặt
  ctx.fillStyle = '#f0c9a0';
  ctx.beginPath(); ctx.arc(0.08 * r, -0.78 * r + bob, 0.3 * r, 0, TAU); ctx.fill();
  ctx.fillStyle = '#e8e4f0'; // râu
  ctx.beginPath(); ctx.moveTo(-0.08 * r, -0.66 * r + bob); ctx.lineTo(0.36 * r, -0.66 * r + bob); ctx.lineTo(0.16 * r, -0.28 * r + bob); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#2a2a3a';
  ctx.beginPath(); ctx.arc(0.22 * r, -0.82 * r + bob, 0.05 * r, 0, TAU); ctx.fill();
  // mũ nhọn
  ctx.fillStyle = robeDark;
  ctx.beginPath(); ctx.ellipse(0.05 * r, -0.98 * r + bob, 0.55 * r, 0.12 * r, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = robe;
  ctx.beginPath();
  ctx.moveTo(-0.3 * r, -1.0 * r + bob);
  ctx.lineTo(0.38 * r, -1.0 * r + bob);
  ctx.quadraticCurveTo(0.1 * r, -1.5 * r + bob, -0.35 * r - s * 0.08 * r, -1.75 * r + bob);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#ffd86b';
  ctx.beginPath(); ctx.arc(0.05 * r, -1.25 * r + bob, 0.07 * r, 0, TAU); ctx.fill();
  // gậy phép + tay
  const sx = 0.62 * r, sy = -0.1 * r + bob - s * 0.05 * r;
  limb(ctx, sx, sy - 0.85 * r, sx + 0.05 * r, sy + 0.95 * r, 0.1 * r, '#7a5230');
  ctx.fillStyle = 'rgba(255,170,60,0.35)';
  ctx.beginPath(); ctx.arc(sx, sy - 0.95 * r, 0.3 * r, 0, TAU); ctx.fill();
  ctx.fillStyle = '#ffb347';
  ctx.beginPath(); ctx.arc(sx, sy - 0.95 * r, 0.15 * r, 0, TAU); ctx.fill();
  limb(ctx, 0.1 * r, -0.4 * r + bob, sx, sy, 0.18 * r, robe);
  ctx.fillStyle = '#f0c9a0';
  ctx.beginPath(); ctx.arc(sx, sy, 0.1 * r, 0, TAU); ctx.fill();
  ctx.restore();
}

// ---------- Trùm nhỏ: Kẻ Đào Mộ, to lớn, mũ rộng vành, vác xẻng ----------
export function drawGravedigger(ctx, e, face, phase, tint) {
  const r = e.r, a = phase * TAU, s = Math.sin(a), c = Math.cos(a);
  const bob = -Math.abs(c) * 0.05 * r;
  ctx.save();
  ctx.translate(e.x, e.y);
  if (face < 0) ctx.scale(-1, 1);
  const coat = tint || '#6b4f32', dark = tint || '#4a3622';
  leg(ctx, -0.1 * r, 0.3 * r + bob, 0.85 * r, -s * 0.45, 0.24 * r, '#2e261c', '#1e1912');
  // xẻng vác trên vai
  ctx.save();
  ctx.translate(-0.1 * r, -0.5 * r + bob);
  ctx.rotate(-0.9 + s * 0.05);
  limb(ctx, -0.2 * r, 0, 1.3 * r, 0, 0.09 * r, '#7a5a35');
  ctx.fillStyle = tint || '#8e9499';
  ctx.beginPath(); ctx.roundRect(1.25 * r, -0.2 * r, 0.42 * r, 0.4 * r, 0.12 * r); ctx.fill();
  ctx.restore();
  ctx.fillStyle = coat;
  ctx.beginPath(); ctx.roundRect(-0.48 * r, -0.62 * r + bob, 0.96 * r, 1.05 * r, 0.25 * r); ctx.fill();
  ctx.fillStyle = dark;
  ctx.fillRect(-0.48 * r, 0.1 * r + bob, 0.96 * r, 0.08 * r);
  leg(ctx, 0.1 * r, 0.3 * r + bob, 0.85 * r, s * 0.45, 0.24 * r, '#3b3024', '#241d14');
  ctx.fillStyle = tint || '#b9a07a';
  ctx.beginPath(); ctx.arc(0.18 * r, -0.82 * r + bob, 0.3 * r, 0, TAU); ctx.fill();
  ctx.fillStyle = '#ff6a3a';
  ctx.beginPath(); ctx.arc(0.32 * r, -0.85 * r + bob, 0.05 * r, 0, TAU); ctx.fill();
  ctx.fillStyle = tint || '#2e2418'; // mũ rộng vành
  ctx.beginPath(); ctx.ellipse(0.1 * r, -1.0 * r + bob, 0.6 * r, 0.12 * r, 0, 0, TAU); ctx.fill();
  ctx.beginPath(); ctx.roundRect(-0.2 * r, -1.35 * r + bob, 0.55 * r, 0.38 * r, 0.06 * r); ctx.fill();
  limb(ctx, 0.2 * r, -0.35 * r + bob, 0.7 * r, 0.0 + bob - s * 0.08 * r, 0.2 * r, coat);
  ctx.restore();
}

// ---------- Boss: Chúa Đầm Lầy, khối bùn rêu khổng lồ, 4 chân, 2 vuốt ----------
export function drawSwampLord(ctx, e, face, phase, opts = {}) {
  const r = e.r, a = phase * TAU, s = Math.sin(a), c = Math.cos(a);
  const bob = -Math.abs(c) * 0.04 * r;
  ctx.save();
  ctx.translate(e.x, e.y);
  if (face < 0) ctx.scale(-1, 1);
  const body = opts.tint || '#3f6b4a', dark = opts.tint || '#2a4a33', moss = '#5f8f4a';
  // 4 chân, bước so le
  const legs = [[-0.55, 0], [-0.2, 0.5], [0.2, 0.25], [0.55, 0.75]];
  for (const [lx, off] of legs) {
    const sw = Math.sin(a + off * TAU) * 0.35;
    leg(ctx, lx * r, 0.35 * r + bob, 0.75 * r, sw, 0.22 * r, dark, '#1d3324');
  }
  // thân
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.moveTo(-0.95 * r, 0.4 * r + bob);
  ctx.bezierCurveTo(-1.05 * r, -0.6 * r + bob, -0.4 * r, -1.1 * r + bob, 0.2 * r, -1.0 * r + bob);
  ctx.bezierCurveTo(0.85 * r, -0.95 * r + bob, 1.05 * r, -0.2 * r + bob, 0.95 * r, 0.4 * r + bob);
  ctx.quadraticCurveTo(0, 0.65 * r + bob, -0.95 * r, 0.4 * r + bob);
  ctx.fill();
  ctx.fillStyle = moss;
  for (let i = 0; i < 6; i++) {
    ctx.beginPath(); ctx.arc((-0.7 + i * 0.28) * r, (-0.55 + (i % 2) * 0.2) * r + bob, 0.14 * r, 0, TAU); ctx.fill();
  }
  // rêu rủ xuống
  ctx.strokeStyle = dark;
  ctx.lineWidth = 0.06 * r;
  for (let i = 0; i < 5; i++) {
    const x = (-0.6 + i * 0.3) * r;
    ctx.beginPath(); ctx.moveTo(x, 0.35 * r + bob); ctx.quadraticCurveTo(x + 0.05 * r, 0.55 * r + bob, x - 0.04 * r + s * 0.04 * r, 0.7 * r + bob); ctx.stroke();
  }
  // vuốt
  const claw = (y, k) => {
    limb(ctx, 0.5 * r, y + bob, 1.15 * r, y + 0.25 * r + bob + k * s * 0.12 * r, 0.24 * r, dark);
    ctx.strokeStyle = '#d8d0b0';
    ctx.lineWidth = 0.06 * r;
    for (let j = -1; j <= 1; j++) { ctx.beginPath(); ctx.moveTo(1.15 * r, y + 0.25 * r + bob); ctx.lineTo(1.4 * r, y + 0.25 * r + j * 0.12 * r + bob); ctx.stroke(); }
  };
  claw(-0.35 * r, 1);
  claw(0.0, -1);
  // mắt
  ctx.fillStyle = opts.enraged ? '#ff3030' : '#d8ff5a';
  ctx.beginPath(); ctx.arc(0.35 * r, -0.5 * r + bob, 0.11 * r, 0, TAU); ctx.arc(0.62 * r, -0.45 * r + bob, 0.1 * r, 0, TAU); ctx.fill();
  ctx.fillStyle = '#1b2a1e';
  ctx.beginPath(); ctx.ellipse(0.55 * r, -0.18 * r + bob, 0.22 * r, 0.08 * r + Math.abs(s) * 0.05 * r, 0, 0, TAU); ctx.fill();
  ctx.restore();
}

// ---------- Chiến Binh: giáp, mũ sừng, kiếm lớn; vung kiếm khi chém ----------
export function drawWarrior(ctx, x, y, r, face, phase, moving, opts = {}) {
  const a = phase * TAU, s = moving ? Math.sin(a) : 0, c = Math.cos(a);
  const bob = moving ? -Math.abs(c) * 0.08 * r : 0;
  ctx.save();
  ctx.translate(x, y);
  if (face < 0) ctx.scale(-1, 1);
  const plate = opts.hurt ? '#d08080' : '#8e959e', plateDark = opts.hurt ? '#a05a5a' : '#5d636b', cloth = '#8a2f2a';
  const hipY = 0.3 * r + bob, L = 0.95 * r;
  leg(ctx, -0.12 * r, hipY, L, -s * 0.6, 0.3 * r, '#3a3330', '#2a2522');
  // áo choàng đỏ sau lưng
  ctx.fillStyle = cloth;
  ctx.beginPath();
  ctx.moveTo(-0.3 * r, -0.55 * r + bob); ctx.lineTo(-0.75 * r - s * 0.08 * r, 0.55 * r + bob); ctx.lineTo(-0.1 * r, 0.4 * r + bob); ctx.closePath();
  ctx.fill();
  // thân giáp
  ctx.fillStyle = plate;
  ctx.beginPath(); ctx.roundRect(-0.42 * r, -0.62 * r + bob, 0.84 * r, 0.98 * r, 0.2 * r); ctx.fill();
  ctx.fillStyle = plateDark;
  ctx.fillRect(-0.42 * r, 0.05 * r + bob, 0.84 * r, 0.12 * r);
  ctx.beginPath(); ctx.arc(-0.38 * r, -0.5 * r + bob, 0.2 * r, 0, TAU); ctx.fill(); // vai sau
  leg(ctx, 0.12 * r, hipY, L, s * 0.6, 0.3 * r, '#4a423d', '#2e2824');
  // đầu + mũ sừng
  ctx.fillStyle = '#e8b890';
  ctx.beginPath(); ctx.arc(0.08 * r, -0.85 * r + bob, 0.3 * r, 0, TAU); ctx.fill();
  ctx.fillStyle = plateDark;
  ctx.beginPath(); ctx.arc(0.08 * r, -0.92 * r + bob, 0.33 * r, Math.PI, TAU); ctx.fill();
  ctx.fillRect(0.2 * r, -0.95 * r + bob, 0.16 * r, 0.3 * r);
  ctx.fillStyle = '#efe6cf';
  for (const sx of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(0.08 * r + sx * 0.25 * r, -1.0 * r + bob);
    ctx.quadraticCurveTo(0.08 * r + sx * 0.55 * r, -1.1 * r + bob, 0.08 * r + sx * 0.5 * r, -1.45 * r + bob);
    ctx.lineTo(0.08 * r + sx * 0.18 * r, -1.08 * r + bob);
    ctx.closePath(); ctx.fill();
  }
  ctx.fillStyle = '#2a2a2a';
  ctx.beginPath(); ctx.arc(0.22 * r, -0.83 * r + bob, 0.05 * r, 0, TAU); ctx.fill();
  // kiếm lớn: giơ cao rồi chém xuống khi đang chém (opts.swing 0..1)
  const sw = opts.swing || 0;
  const ang = sw > 0 ? -1.9 + (1 - sw) * 2.6 : -0.5 + s * 0.15;
  const hx = 0.35 * r, hy = -0.25 * r + bob;
  ctx.save();
  ctx.translate(hx, hy);
  ctx.rotate(ang);
  ctx.fillStyle = '#d9dde3';
  ctx.beginPath(); ctx.moveTo(0.15 * r, -0.1 * r); ctx.lineTo(1.45 * r, -0.07 * r); ctx.lineTo(1.6 * r, 0); ctx.lineTo(1.45 * r, 0.07 * r); ctx.lineTo(0.15 * r, 0.1 * r); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#b08a3a';
  ctx.fillRect(0.08 * r, -0.25 * r, 0.1 * r, 0.5 * r);
  ctx.fillStyle = '#5a3d22';
  ctx.fillRect(-0.25 * r, -0.06 * r, 0.33 * r, 0.12 * r);
  ctx.restore();
  limb(ctx, 0.05 * r, -0.4 * r + bob, hx, hy, 0.22 * r, plate);
  ctx.fillStyle = plateDark;
  ctx.beginPath(); ctx.arc(0.32 * r, -0.48 * r + bob, 0.19 * r, 0, TAU); ctx.fill(); // vai trước
  ctx.restore();
}

// Ảnh chân dung cho màn chọn nhân vật.
export function drawPortrait(canvas, look) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  const g = ctx.createRadialGradient(w / 2, h * 0.55, 4, w / 2, h * 0.55, w * 0.6);
  g.addColorStop(0, 'rgba(255,220,150,0.25)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  const r = h * 0.2;
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath(); ctx.ellipse(w / 2, h * 0.58 + r * 1.3, r * 0.9, r * 0.25, 0, 0, TAU); ctx.fill();
  if (look === 'warrior') drawWarrior(ctx, w / 2 - r * 0.2, h * 0.58, r, 1, 0.15, true, { swing: 0 });
  else drawMage(ctx, w / 2 - r * 0.2, h * 0.58, r, 1, 0.15, true, {});
}
