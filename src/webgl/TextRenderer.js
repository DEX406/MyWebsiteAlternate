// SDF-based text renderer.  Lays out text as per-glyph quads and draws
// them using a signed-distance-field shader for crisp edges at any zoom.

import { SDFAtlas, SDF_FONT_SIZE, SDF_BUFFER, ATLAS_SIZE } from './SDFAtlas.js';
import { SDF_VERT, SDF_FRAG } from './shaders.js';

function compileShader(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    console.error('SDF shader compile:', gl.getShaderInfoLog(s));
    gl.deleteShader(s);
    return null;
  }
  return s;
}

function createProgram(gl, vert, frag) {
  const prog = gl.createProgram();
  const vs = compileShader(gl, gl.VERTEX_SHADER, vert);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, frag);
  if (!vs || !fs) return null;
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    console.error('SDF program link:', gl.getProgramInfoLog(prog));
    return null;
  }
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  return prog;
}

export class TextRenderer {
  constructor(gl) {
    this.gl = gl;
    this.atlas = new SDFAtlas(gl);
    this._layoutCache = new Map();

    // SDF shader
    this.prog = createProgram(gl, SDF_VERT, SDF_FRAG);
    this.u = {};
    for (const n of ['u_resolution', 'u_pan', 'u_zoom', 'u_offset', 'u_rotation', 'u_rotCenter', 'u_atlas', 'u_color']) {
      this.u[n] = gl.getUniformLocation(this.prog, n);
    }

    // VAO + dynamic VBO (interleaved: x, y, u, v  per vertex)
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    this.vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    const stride = 16; // 4 floats * 4 bytes
    const posLoc = gl.getAttribLocation(this.prog, 'a_pos');
    const uvLoc = gl.getAttribLocation(this.prog, 'a_uv');
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(uvLoc);
    gl.vertexAttribPointer(uvLoc, 2, gl.FLOAT, false, stride, 8);
    gl.bindVertexArray(null);
  }

  // Call once per frame before any draw() calls.
  // Flushes atlas and caches per-frame values.
  beginFrame(panX, panY, zoom, resW, resH) {
    this.atlas.flush();
    this._panX = panX;
    this._panY = panY;
    this._zoom = zoom;
    this._resW = resW;
    this._resH = resH;
  }

  // Called by GLRenderer for each text/link item (between beginFrame/endFrame).
  draw(item) {
    if (!item.text) return;

    const layout = this._getLayout(item);
    if (!layout || layout.vertCount === 0) return;

    // Flush atlas if _buildLayout rasterized new glyphs
    this.atlas.flush();

    const gl = this.gl;
    gl.useProgram(this.prog);
    gl.bindVertexArray(this.vao);

    // Frame-level uniforms (must re-set after quad shader runs in between)
    gl.uniform2f(this.u.u_resolution, this._resW, this._resH);
    gl.uniform2f(this.u.u_pan, this._panX, this._panY);
    gl.uniform1f(this.u.u_zoom, this._zoom);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.atlas.texture);
    gl.uniform1i(this.u.u_atlas, 0);

    // Per-item uniforms
    gl.uniform2f(this.u.u_offset, item.x, item.y);
    gl.uniform1f(this.u.u_rotation, (item.rotation || 0) * Math.PI / 180);
    gl.uniform2f(this.u.u_rotCenter, item.x + item.w * 0.5, item.y + item.h * 0.5);

    const rgb = hexToRgb(item.color || '#C2C0B6');
    gl.uniform4f(this.u.u_color, rgb[0], rgb[1], rgb[2], 1.0);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, layout.verts, gl.DYNAMIC_DRAW);
    gl.drawArrays(gl.TRIANGLES, 0, layout.vertCount);
    gl.bindVertexArray(null);
  }

  endFrame() {
    // no-op, kept for symmetry
  }

  // --- layout caching ---

  _getLayout(item) {
    const key = `${item.id}|${item.text}|${item.fontSize}|${item.fontFamily}|${item.bold}|${item.italic}|${item.align}|${item.w}|${item.h}|${item.type}`;
    let cached = this._layoutCache.get(key);
    if (cached) { cached.lastUsed = performance.now(); return cached; }

    cached = this._buildLayout(item);
    cached.lastUsed = performance.now();
    this._layoutCache.set(key, cached);
    if (this._layoutCache.size > 300) this._evict();
    return cached;
  }

  _buildLayout(item) {
    const atlas = this.atlas;
    const fontSize = item.fontSize || 24;
    const fontFamily = item.fontFamily || "'DM Sans', sans-serif";
    const bold = !!item.bold;
    const italic = !!item.italic;
    const align = item.align || 'left';
    const padX = 12, padY = 8;
    const maxWidth = item.w - padX * 2;
    const lineHeight = fontSize * 1.3;
    const scale = fontSize / SDF_FONT_SIZE;

    const fontAscent = atlas.getFontAscent(fontFamily, bold, italic);
    const lines = this._wrapText(item.text, fontFamily, bold, italic, fontSize, maxWidth);

    // Vertical start
    let startY;
    if (item.type === 'link') {
      startY = (item.h - lines.length * lineHeight) / 2;
    } else {
      startY = padY;
    }

    const verts = [];

    for (let li = 0; li < lines.length; li++) {
      const lineTop = startY + li * lineHeight;
      if (lineTop + lineHeight > item.h) break;

      const line = lines[li];
      if (!line) continue;

      // Measure line width for alignment
      let lineWidth = 0;
      for (const char of line) {
        lineWidth += atlas.getGlyph(char, fontFamily, bold, italic).advance * scale;
      }

      let penX;
      if (align === 'center') penX = (item.w - lineWidth) / 2;
      else if (align === 'right') penX = item.w - padX - lineWidth;
      else penX = padX;

      const baselineY = lineTop + fontAscent * scale;

      for (const char of line) {
        const g = atlas.getGlyph(char, fontFamily, bold, italic);

        if (!g.space && g.sdfW > 0 && g.sdfH > 0) {
          // Glyph quad relative to item origin
          const qx = penX - (g.bearingX + SDF_BUFFER) * scale;
          const qy = baselineY - (g.bearingY + SDF_BUFFER) * scale;
          const qw = g.sdfW * scale;
          const qh = g.sdfH * scale;

          // Atlas UVs
          const u0 = g.atlasX / ATLAS_SIZE;
          const v0 = g.atlasY / ATLAS_SIZE;
          const u1 = (g.atlasX + g.sdfW) / ATLAS_SIZE;
          const v1 = (g.atlasY + g.sdfH) / ATLAS_SIZE;

          verts.push(
            qx,      qy,      u0, v0,
            qx + qw, qy,      u1, v0,
            qx,      qy + qh, u0, v1,
            qx,      qy + qh, u0, v1,
            qx + qw, qy,      u1, v0,
            qx + qw, qy + qh, u1, v1,
          );
        }

        penX += g.advance * scale;
      }
    }

    return { verts: new Float32Array(verts), vertCount: verts.length / 4 };
  }

  _wrapText(text, fontFamily, bold, italic, fontSize, maxWidth) {
    const atlas = this.atlas;
    const scale = fontSize / SDF_FONT_SIZE;
    const lines = [];

    for (const para of text.split('\n')) {
      if (!para) { lines.push(''); continue; }
      const words = para.split(/(\s+)/);
      let currentLine = '';
      let currentWidth = 0;

      for (const word of words) {
        let wordWidth = 0;
        for (const ch of word) {
          wordWidth += atlas.getGlyph(ch, fontFamily, bold, italic).advance * scale;
        }

        if (currentWidth + wordWidth > maxWidth && currentLine) {
          lines.push(currentLine);
          currentLine = word.trimStart();
          currentWidth = 0;
          for (const ch of currentLine) {
            currentWidth += atlas.getGlyph(ch, fontFamily, bold, italic).advance * scale;
          }
        } else {
          currentLine += word;
          currentWidth += wordWidth;
        }
      }
      if (currentLine) lines.push(currentLine);
    }
    return lines.length ? lines : [''];
  }

  _evict() {
    const entries = [...this._layoutCache.entries()].sort((a, b) => a[1].lastUsed - b[1].lastUsed);
    for (const [key] of entries.slice(0, 100)) this._layoutCache.delete(key);
  }

  invalidate(itemId) {
    for (const key of this._layoutCache.keys()) {
      if (key.startsWith(itemId + '|')) this._layoutCache.delete(key);
    }
  }

  destroy() {
    this.atlas.destroy();
    this._layoutCache.clear();
  }
}

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return [
    parseInt(h.slice(0, 2), 16) / 255,
    parseInt(h.slice(2, 4), 16) / 255,
    parseInt(h.slice(4, 6), 16) / 255,
  ];
}
