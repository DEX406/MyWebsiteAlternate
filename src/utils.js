import { GRID_SIZE, SNAP_ANGLE } from './constants.js';

export function uid() { 
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`; 
}

export function snap(v, on) { 
  return on ? Math.round(v / GRID_SIZE) * GRID_SIZE : v; 
}

export function snapAngle(angle, on) { 
  if (!on) return angle;
  return Math.round(angle / SNAP_ANGLE) * SNAP_ANGLE;
}

export function itemShadowEnabled(item) {
  return item.shadow ?? (item.type !== "shape" && item.type !== "text");
}

/* ── Rotation-aware 8-point resize ── */
const HANDLE_CFG = {
  tl: { dx: -1, dy: -1, ax:  1, ay:  1 },
  t:  { dx:  0, dy: -1, ax:  0, ay:  1 },
  tr: { dx:  1, dy: -1, ax: -1, ay:  1 },
  r:  { dx:  1, dy:  0, ax: -1, ay:  0 },
  br: { dx:  1, dy:  1, ax: -1, ay: -1 },
  b:  { dx:  0, dy:  1, ax:  0, ay: -1 },
  bl: { dx: -1, dy:  1, ax:  1, ay: -1 },
  l:  { dx: -1, dy:  0, ax:  1, ay:  0 },
};

export function computeResize(item, handle, screenDx, screenDy, snapVal) {
  const cfg = HANDLE_CFG[handle];
  if (!cfg) return { x: item.x, y: item.y, w: item.w, h: item.h };

  const rad = (item.rotation || 0) * Math.PI / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);

  // Project screen-space delta into object-local space
  const localDx =  screenDx * cos + screenDy * sin;
  const localDy = -screenDx * sin + screenDy * cos;

  // New dimensions
  let newW = snap(Math.max(30, item.w + cfg.dx * localDx), snapVal);
  let newH = snap(Math.max(20, item.h + cfg.dy * localDy), snapVal);

  // Anchor point in local space (relative to center, before resize)
  const aLx = cfg.ax * item.w / 2;
  const aLy = cfg.ay * item.h / 2;

  // Anchor in world space (must stay fixed)
  const cx = item.x + item.w / 2;
  const cy = item.y + item.h / 2;
  const awx = cx + aLx * cos - aLy * sin;
  const awy = cy + aLx * sin + aLy * cos;

  // New anchor in local space (relative to new center)
  const naLx = cfg.ax * newW / 2;
  const naLy = cfg.ay * newH / 2;

  // Solve for new center so anchor stays put
  const ncx = awx - naLx * cos + naLy * sin;
  const ncy = awy - naLx * sin - naLy * cos;

  return { x: ncx - newW / 2, y: ncy - newH / 2, w: newW, h: newH };
}

export function exportBoard(items, palette) {
  const blob = new Blob([JSON.stringify({ items, palette }, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); 
  a.href = url;
  a.download = `lutz-board-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
