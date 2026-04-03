export const FONT = "'DM Sans', sans-serif";
export const GRID_SIZE = 16;
export const DEFAULT_BG_GRID = {
  enabled: true,
  bgColor: "#141413",
  dot1: { color: "#C2C0B6", opacity: 0.07, size: 1.5, softness: 0, spacing: 32 },
  dot2: { enabled: false, color: "#C2C0B6", opacity: 0.04, size: 1, softness: 0, spacing: 64 },
};
export const GRID_SPACINGS = [2, 4, 8, 16, 32, 64];
export const SNAP_ANGLE = 15; // degrees for angle snapping

export const FONTS = [
  { label: "DM Sans", value: "'DM Sans', sans-serif" },
  { label: "Georgia", value: "Georgia, serif" },
  { label: "Courier", value: "'Courier New', monospace" },
  { label: "Impact", value: "Impact, sans-serif" },
  { label: "Comic Sans", value: "'Comic Sans MS', cursive" },
  { label: "Times", value: "'Times New Roman', serif" },
  { label: "Trebuchet", value: "'Trebuchet MS', sans-serif" },
  { label: "Verdana", value: "Verdana, sans-serif" },
];

export const SHAPE_PRESETS = [
  { label: "Rectangle", w: 208, h: 128 },
  { label: "Square", w: 160, h: 160 },
  { label: "Wide bar", w: 400, h: 64 },
  { label: "Tall bar", w: 64, h: 304 },
  { label: "Circle", w: 160, h: 160, radius: 80 },
  { label: "Large circle", w: 320, h: 320, radius: 160 },
];
