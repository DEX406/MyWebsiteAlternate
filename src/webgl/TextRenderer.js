// Renders text items to offscreen Canvas2D and uploads as WebGL textures.
// Caches based on a hash of all text-affecting properties.

export class TextRenderer {
  constructor(gl) {
    this.gl = gl;
    this.cache = new Map(); // hash → { tex, width, height }
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d');
  }

  // Generate a cache key from item properties
  _key(item) {
    return `${item.id}|${item.text}|${item.fontSize}|${item.fontFamily}|${item.color}|${item.bold}|${item.italic}|${item.align}|${item.w}|${item.h}|${item.bgColor}|${item.bgOpacity ?? 1}`;
  }

  // Get or create a texture for a text/link item.
  // Returns { tex, width, height }
  get(item) {
    const key = this._key(item);
    const cached = this.cache.get(key);
    if (cached) {
      cached.lastUsed = performance.now();
      return cached;
    }

    const entry = this._render(item);
    entry.lastUsed = performance.now();
    this.cache.set(key, entry);

    // Evict old entries if cache is large
    if (this.cache.size > 200) this._evict();

    return entry;
  }

  _render(item) {
    const gl = this.gl;
    const scale = (window.devicePixelRatio || 1) * 2;
    const w = Math.ceil(item.w * scale);
    const h = Math.ceil(item.h * scale);

    this.canvas.width = w;
    this.canvas.height = h;
    const ctx = this.ctx;

    ctx.clearRect(0, 0, w, h);
    ctx.scale(scale, scale);

    // Background
    const bgColor = this._applyBg(item);
    if (bgColor !== 'transparent') {
      ctx.fillStyle = bgColor;
      ctx.fillRect(0, 0, item.w, item.h);
    }

    // Text
    if (item.text) {
      const padX = 12, padY = 8;
      const fontSize = item.fontSize || 24;
      const fontWeight = item.bold ? 'bold' : 'normal';
      const fontStyle = item.italic ? 'italic' : 'normal';
      const fontFamily = item.fontFamily || "'DM Sans', sans-serif";

      ctx.font = `${fontStyle} ${fontWeight} ${fontSize}px ${fontFamily}`;
      ctx.fillStyle = item.color || '#C2C0B6';
      ctx.textBaseline = 'top';
      ctx.textAlign = item.align || 'left';

      const maxWidth = item.w - padX * 2;
      const lines = this._wrapText(ctx, item.text, maxWidth);
      const lineHeight = fontSize * 1.3;

      let x;
      if (item.align === 'center') x = item.w / 2;
      else if (item.align === 'right') x = item.w - padX;
      else x = padX;

      // For link items, vertically center
      let startY = padY;
      if (item.type === 'link') {
        const totalHeight = lines.length * lineHeight;
        startY = (item.h - totalHeight) / 2;
      }

      for (let i = 0; i < lines.length; i++) {
        const y = startY + i * lineHeight;
        if (y + lineHeight > item.h) break;
        ctx.fillText(lines[i], x, y);
      }
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);

    // Upload to texture
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.canvas);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    return { tex, width: w, height: h };
  }

  _wrapText(ctx, text, maxWidth) {
    const lines = [];
    // Handle explicit newlines (pre-wrap)
    const paragraphs = text.split('\n');
    for (const para of paragraphs) {
      if (!para) { lines.push(''); continue; }
      const words = para.split(/(\s+)/);
      let currentLine = '';
      for (const word of words) {
        const test = currentLine + word;
        if (ctx.measureText(test).width > maxWidth && currentLine) {
          lines.push(currentLine);
          currentLine = word.trimStart();
        } else {
          currentLine = test;
        }
      }
      if (currentLine) lines.push(currentLine);
    }
    return lines.length ? lines : [''];
  }

  _applyBg(item) {
    if (!item.bgColor || item.bgColor === 'transparent') return 'transparent';
    const op = item.bgOpacity ?? 1;
    if (op <= 0) return 'transparent';
    const hex = item.bgColor.replace('#', '');
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    return op >= 1 ? item.bgColor : `rgba(${r},${g},${b},${op})`;
  }

  _evict() {
    // Remove oldest 50 entries
    const entries = [...this.cache.entries()].sort((a, b) => a[1].lastUsed - b[1].lastUsed);
    const toRemove = entries.slice(0, 50);
    for (const [key, entry] of toRemove) {
      this.gl.deleteTexture(entry.tex);
      this.cache.delete(key);
    }
  }

  // Invalidate a specific item's cache (call when item text/style changes)
  invalidate(itemId) {
    for (const [key, entry] of this.cache) {
      if (key.startsWith(itemId + '|')) {
        this.gl.deleteTexture(entry.tex);
        this.cache.delete(key);
      }
    }
  }

  destroy() {
    for (const entry of this.cache.values()) {
      this.gl.deleteTexture(entry.tex);
    }
    this.cache.clear();
  }
}
