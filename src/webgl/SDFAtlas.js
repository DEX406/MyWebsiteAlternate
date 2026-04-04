// Signed Distance Field glyph atlas for resolution-independent text rendering.
// Rasterizes glyphs at a fixed size, computes SDF via Felzenszwalb & Huttenlocher
// distance transform, and packs results into a single-channel GPU texture atlas.

export const SDF_FONT_SIZE = 48;
export const SDF_BUFFER = 6;
const SDF_RADIUS = 8;
export const ATLAS_SIZE = 2048;
const INF = 1e20;

export class SDFAtlas {
  constructor(gl) {
    this.gl = gl;
    this.glyphs = new Map();

    // Offscreen canvas for glyph rasterization
    this._canvas = document.createElement('canvas');
    this._ctx = this._canvas.getContext('2d', { willReadFrequently: true });

    // CPU-side atlas data (single channel)
    this._atlasData = new Uint8Array(ATLAS_SIZE * ATLAS_SIZE);
    this._atlasX = 0;
    this._atlasY = 0;
    this._rowH = 0;
    // Dirty region tracking for partial uploads
    this._dirtyX0 = ATLAS_SIZE;
    this._dirtyY0 = ATLAS_SIZE;
    this._dirtyX1 = 0;
    this._dirtyY1 = 0;

    // GPU atlas texture (R8)
    this.texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, ATLAS_SIZE, ATLAS_SIZE, 0, gl.RED, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    // Reusable buffers for distance transform
    this._gridOuter = new Float64Array(0);
    this._gridInner = new Float64Array(0);
    this._f = new Float64Array(0);
    this._d = new Float64Array(0);
    this._z = new Float64Array(0);
    this._v = new Uint16Array(0);
  }

  getGlyph(char, fontFamily, bold, italic) {
    const key = `${char}|${fontFamily}|${bold ? 1 : 0}|${italic ? 1 : 0}`;
    let g = this.glyphs.get(key);
    if (!g) {
      g = this._rasterize(char, fontFamily, bold, italic);
      this.glyphs.set(key, g);
    }
    return g;
  }

  getFontAscent(fontFamily, bold, italic) {
    const key = `_ascent|${fontFamily}|${bold ? 1 : 0}|${italic ? 1 : 0}`;
    let v = this.glyphs.get(key);
    if (v != null) return v;
    this._ctx.font = `${italic ? 'italic ' : ''}${bold ? 'bold ' : ''}${SDF_FONT_SIZE}px ${fontFamily}`;
    const m = this._ctx.measureText('Mg');
    v = m.fontBoundingBoxAscent ?? Math.round(SDF_FONT_SIZE * 0.8);
    this.glyphs.set(key, v);
    return v;
  }

  flush() {
    if (this._dirtyX1 <= this._dirtyX0) return; // nothing dirty
    const gl = this.gl;
    const x = this._dirtyX0, y = this._dirtyY0;
    const w = this._dirtyX1 - x, h = this._dirtyY1 - y;

    // Extract only the dirty sub-rectangle
    const sub = new Uint8Array(w * h);
    for (let row = 0; row < h; row++) {
      const srcOff = (y + row) * ATLAS_SIZE + x;
      sub.set(this._atlasData.subarray(srcOff, srcOff + w), row * w);
    }

    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, x, y, w, h, gl.RED, gl.UNSIGNED_BYTE, sub);

    // Reset dirty region
    this._dirtyX0 = ATLAS_SIZE;
    this._dirtyY0 = ATLAS_SIZE;
    this._dirtyX1 = 0;
    this._dirtyY1 = 0;
  }

  _rasterize(char, fontFamily, bold, italic) {
    const ctx = this._ctx;
    const fontSize = SDF_FONT_SIZE;
    const buffer = SDF_BUFFER;
    const fontStr = `${italic ? 'italic ' : ''}${bold ? 'bold ' : ''}${fontSize}px ${fontFamily}`;

    ctx.font = fontStr;
    const m = ctx.measureText(char);
    const advance = m.width;

    // Whitespace: no visible glyph
    if (char === ' ' || char === '\t' || advance < 0.01) {
      return { atlasX: 0, atlasY: 0, sdfW: 0, sdfH: 0, advance, bearingX: 0, bearingY: 0, space: true };
    }

    const bearingX = m.actualBoundingBoxLeft || 0;
    const bearingY = m.actualBoundingBoxAscent || Math.round(fontSize * 0.8);
    const bbRight = m.actualBoundingBoxRight || Math.ceil(advance);
    const bbDescent = m.actualBoundingBoxDescent || Math.round(fontSize * 0.2);
    const contentW = Math.ceil(bearingX + bbRight) || 1;
    const contentH = Math.ceil(bearingY + bbDescent) || 1;

    const sdfW = contentW + buffer * 2;
    const sdfH = contentH + buffer * 2;

    // Render glyph
    this._canvas.width = sdfW;
    this._canvas.height = sdfH;
    ctx.font = fontStr;
    ctx.fillStyle = '#fff';
    ctx.textBaseline = 'alphabetic';
    ctx.clearRect(0, 0, sdfW, sdfH);
    ctx.fillText(char, buffer + bearingX, buffer + bearingY);

    // Extract alpha channel
    const imgData = ctx.getImageData(0, 0, sdfW, sdfH);
    const len = sdfW * sdfH;
    const alpha = new Uint8Array(len);
    for (let i = 0; i < len; i++) alpha[i] = imgData.data[i * 4 + 3];

    // Compute SDF
    const sdf = this._computeSDF(alpha, sdfW, sdfH);

    // Pack into atlas
    if (this._atlasX + sdfW > ATLAS_SIZE) {
      this._atlasX = 0;
      this._atlasY += this._rowH;
      this._rowH = 0;
    }
    if (this._atlasY + sdfH > ATLAS_SIZE) {
      console.warn('SDF atlas full, cannot add glyph:', char);
      return { atlasX: 0, atlasY: 0, sdfW: 0, sdfH: 0, advance, bearingX: 0, bearingY: 0, space: true };
    }

    for (let row = 0; row < sdfH; row++) {
      const srcOff = row * sdfW;
      const dstOff = (this._atlasY + row) * ATLAS_SIZE + this._atlasX;
      for (let col = 0; col < sdfW; col++) {
        this._atlasData[dstOff + col] = sdf[srcOff + col];
      }
    }

    const glyph = {
      atlasX: this._atlasX,
      atlasY: this._atlasY,
      sdfW, sdfH,
      advance,  // in SDF_FONT_SIZE pixels
      bearingX, // in SDF_FONT_SIZE pixels
      bearingY, // in SDF_FONT_SIZE pixels
    };

    // Expand dirty region
    this._dirtyX0 = Math.min(this._dirtyX0, this._atlasX);
    this._dirtyY0 = Math.min(this._dirtyY0, this._atlasY);
    this._dirtyX1 = Math.max(this._dirtyX1, this._atlasX + sdfW);
    this._dirtyY1 = Math.max(this._dirtyY1, this._atlasY + sdfH);

    this._atlasX += sdfW;
    this._rowH = Math.max(this._rowH, sdfH);

    return glyph;
  }

  _computeSDF(alpha, w, h) {
    const len = w * h;
    const maxDim = Math.max(w, h);

    if (this._gridOuter.length < len) {
      this._gridOuter = new Float64Array(len);
      this._gridInner = new Float64Array(len);
    }
    if (this._f.length < maxDim) {
      this._f = new Float64Array(maxDim);
      this._d = new Float64Array(maxDim);
      this._z = new Float64Array(maxDim + 1);
      this._v = new Uint16Array(maxDim);
    }

    const outer = this._gridOuter;
    const inner = this._gridInner;

    for (let i = 0; i < len; i++) {
      const a = alpha[i] / 255;
      outer[i] = a === 1.0 ? 0 : a === 0.0 ? INF : Math.pow(Math.max(0, 0.5 - a), 2);
      inner[i] = a === 1.0 ? INF : a === 0.0 ? 0 : Math.pow(Math.max(0, a - 0.5), 2);
    }

    this._edt(outer, w, h);
    this._edt(inner, w, h);

    const out = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      const d = Math.sqrt(outer[i]) - Math.sqrt(inner[i]);
      out[i] = Math.round(255 - 255 * (d / SDF_RADIUS + 0.5));
    }
    return out;
  }

  // 2D Euclidean distance transform
  _edt(grid, w, h) {
    const f = this._f, d = this._d, v = this._v, z = this._z;

    for (let x = 0; x < w; x++) {
      for (let y = 0; y < h; y++) f[y] = grid[y * w + x];
      this._edt1d(f, d, v, z, h);
      for (let y = 0; y < h; y++) grid[y * w + x] = d[y];
    }
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) f[x] = grid[y * w + x];
      this._edt1d(f, d, v, z, w);
      for (let x = 0; x < w; x++) grid[y * w + x] = d[x];
    }
  }

  // 1D squared distance transform (Felzenszwalb & Huttenlocher)
  _edt1d(f, d, v, z, n) {
    v[0] = 0;
    z[0] = -INF;
    z[1] = INF;

    for (let q = 1, k = 0; q < n; q++) {
      let s;
      do {
        const r = v[k];
        s = (f[q] - f[r] + q * q - r * r) / (q - r) / 2;
      } while (s <= z[k] && --k > -1);
      k++;
      v[k] = q;
      z[k] = s;
      z[k + 1] = INF;
    }

    for (let q = 0, k = 0; q < n; q++) {
      while (z[k + 1] < q) k++;
      const r = v[k];
      d[q] = f[r] + (q - r) * (q - r);
    }
  }

  destroy() {
    this.gl.deleteTexture(this.texture);
  }
}
