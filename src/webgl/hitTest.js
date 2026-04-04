// Math-based hit testing: given a screen point, find which item (if any) is under it.
// Replaces DOM-based `closest("[data-item-id]")`.

import { buildConnectorPath } from '../connectorPath.js';

// Test if a screen-space point hits any item. Returns { id, action } or null.
// Items should be sorted back-to-front (we test front-to-back for topmost hit).
export function hitTest(screenX, screenY, items, panX, panY, zoom) {
  // Convert screen → world
  const worldX = (screenX - panX) / zoom;
  const worldY = (screenY - panY) / zoom;

  // Test front-to-back (highest z first)
  const sorted = [...items].sort((a, b) => b.z - a.z);

  for (const item of sorted) {
    if (item.type === 'connector') {
      if (hitConnector(worldX, worldY, item)) {
        return { id: item.id, action: null };
      }
    } else {
      if (hitRect(worldX, worldY, item)) {
        return { id: item.id, action: null };
      }
    }
  }

  return null;
}

// Test if world point is inside a rotated rectangle item
function hitRect(wx, wy, item) {
  const cx = item.x + item.w / 2;
  const cy = item.y + item.h / 2;
  const rad = -(item.rotation || 0) * Math.PI / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);

  // Rotate point into item's local space
  const dx = wx - cx;
  const dy = wy - cy;
  const localX = dx * cos - dy * sin + item.w / 2;
  const localY = dx * sin + dy * cos + item.h / 2;

  return localX >= 0 && localX <= item.w && localY >= 0 && localY <= item.h;
}

// Test if world point is near the connector path
function hitConnector(wx, wy, item) {
  const { x1, y1, x2, y2, lineWidth = 2 } = item;
  const elbowX = item.elbowX ?? (x1 + x2) / 2;
  const elbowY = item.elbowY ?? (y1 + y2) / 2;
  const orient = item.orientation || 'h';

  // Hit threshold: max of 8px or lineWidth + 6
  const threshold = Math.max(8, lineWidth + 6);

  // Generate path segments based on orientation
  let segments;
  if (orient === 'h') {
    // H-route: across → down → across
    segments = [
      [x1, y1, elbowX, y1],
      [elbowX, y1, elbowX, y2],
      [elbowX, y2, x2, y2],
    ];
  } else {
    // V-route: down → across → down
    segments = [
      [x1, y1, x1, elbowY],
      [x1, elbowY, x2, elbowY],
      [x2, elbowY, x2, y2],
    ];
  }

  for (const [sx, sy, ex, ey] of segments) {
    if (distToSegment(wx, wy, sx, sy, ex, ey) < threshold) return true;
  }

  // Also check endpoint dots
  const dotR = item.dotRadius || 5;
  if (Math.hypot(wx - x1, wy - y1) < dotR + 4) return true;
  if (Math.hypot(wx - x2, wy - y2) < dotR + 4) return true;

  return false;
}

// Distance from point (px, py) to line segment (ax, ay)-(bx, by)
function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - ax, py - ay);
  let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
