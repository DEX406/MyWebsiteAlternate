// Main WebGL2 renderer for the infinite canvas.
// Renders: grid background, all content items, selection outlines.
// One <canvas>, one GL context, one render loop.

import {
  GRID_VERT, GRID_FRAG,
  QUAD_VERT, QUAD_FRAG,
  LINE_VERT, LINE_FRAG,
  CIRCLE_VERT, CIRCLE_FRAG,
} from './shaders.js';
import { TextureCache } from './TextureCache.js';
import { TextRenderer } from './TextRenderer.js';

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return [
    parseInt(h.slice(0, 2), 16) / 255,
    parseInt(h.slice(2, 4), 16) / 255,
    parseInt(h.slice(4, 6), 16) / 255,
  ];
}

function hexToRgba(hex, alpha = 1) {
  const rgb = hexToRgb(hex);
  return [...rgb, alpha];
}

function compileShader(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    console.error('Shader compile error:', gl.getShaderInfoLog(s));
    gl.deleteShader(s);
    return null;
  }
  return s;
}

function createProgram(gl, vertSrc, fragSrc) {
  const prog = gl.createProgram();
  const vs = compileShader(gl, gl.VERTEX_SHADER, vertSrc);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fragSrc);
  if (!vs || !fs) return null;
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    console.error('Program link error:', gl.getProgramInfoLog(prog));
    return null;
  }
  // Clean up shaders after linking
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  return prog;
}

function getUniforms(gl, prog, names) {
  const u = {};
  for (const n of names) u[n] = gl.getUniformLocation(prog, n);
  return u;
}

const SUPERSAMPLE = 2; // 2x supersampling multiplier on top of DPR

export class GLRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', {
      alpha: false,
      desynchronized: true,
      antialias: false,
      powerPreference: 'default',
      premultipliedAlpha: false,
    });
    if (!gl) throw new Error('WebGL2 not supported');
    this.gl = gl;

    this.texCache = new TextureCache(gl);
    this.textRenderer = new TextRenderer(gl);

    this._initPrograms();
    this._initGeometry();

    // Enable blending for transparency
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  }

  _initPrograms() {
    const gl = this.gl;

    // Grid program
    this.gridProg = createProgram(gl, GRID_VERT, GRID_FRAG);
    this.gridU = getUniforms(gl, this.gridProg, [
      'u_pan', 'u_zoomDpr', 'u_resolution', 'u_bgColor',
      'u_d1Color', 'u_d1Opacity', 'u_d1Size', 'u_d1Softness', 'u_d1Spacing',
      'u_d2On', 'u_d2Color', 'u_d2Opacity', 'u_d2Size', 'u_d2Softness', 'u_d2Spacing',
    ]);

    // Quad program
    this.quadProg = createProgram(gl, QUAD_VERT, QUAD_FRAG);
    this.quadU = getUniforms(gl, this.quadProg, [
      'u_resolution', 'u_pan', 'u_zoom',
      'u_itemPos', 'u_itemSize', 'u_rotation', 'u_padSize', 'u_padOffset',
      'u_radius', 'u_color', 'u_textured', 'u_tex', 'u_texCrop',
      'u_opacity', 'u_borderColor', 'u_borderWidth',
      'u_hasShadow', 'u_shadowSize', 'u_shadowOpacity', 'u_isSelection',
    ]);

    // Line program
    this.lineProg = createProgram(gl, LINE_VERT, LINE_FRAG);
    this.lineU = getUniforms(gl, this.lineProg, [
      'u_resolution', 'u_pan', 'u_zoom', 'u_color',
    ]);

    // Circle program
    this.circleProg = createProgram(gl, CIRCLE_VERT, CIRCLE_FRAG);
    this.circleU = getUniforms(gl, this.circleProg, [
      'u_resolution', 'u_pan', 'u_zoom', 'u_center', 'u_radius', 'u_color',
    ]);
  }

  _initGeometry() {
    const gl = this.gl;

    // Unit quad (0,0)→(1,1), 6 vertices
    this.quadVAO = gl.createVertexArray();
    gl.bindVertexArray(this.quadVAO);
    const quadBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0,0, 1,0, 0,1, 0,1, 1,0, 1,1]), gl.STATIC_DRAW);

    // Bind for quad program
    const quadPosLoc = gl.getAttribLocation(this.quadProg, 'a_pos');
    gl.enableVertexAttribArray(quadPosLoc);
    gl.vertexAttribPointer(quadPosLoc, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);

    // Fullscreen quad for grid (-1,-1)→(1,1)
    this.gridVAO = gl.createVertexArray();
    gl.bindVertexArray(this.gridVAO);
    const gridBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, gridBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, -1,1, 1,-1, 1,1]), gl.STATIC_DRAW);
    const gridPosLoc = gl.getAttribLocation(this.gridProg, 'a_pos');
    gl.enableVertexAttribArray(gridPosLoc);
    gl.vertexAttribPointer(gridPosLoc, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);

    // Circle VAO (reuses unit quad)
    this.circleVAO = gl.createVertexArray();
    gl.bindVertexArray(this.circleVAO);
    const circleBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, circleBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0,0, 1,0, 0,1, 0,1, 1,0, 1,1]), gl.STATIC_DRAW);
    const circlePosLoc = gl.getAttribLocation(this.circleProg, 'a_pos');
    gl.enableVertexAttribArray(circlePosLoc);
    gl.vertexAttribPointer(circlePosLoc, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);

    // Line dynamic buffer
    this.lineVAO = gl.createVertexArray();
    gl.bindVertexArray(this.lineVAO);
    this.lineBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.lineBuf);
    const linePosLoc = gl.getAttribLocation(this.lineProg, 'a_pos');
    gl.enableVertexAttribArray(linePosLoc);
    gl.vertexAttribPointer(linePosLoc, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
  }

  // Resize canvas to match display size × DPR × supersample
  resize() {
    const dpr = (window.devicePixelRatio || 1) * SUPERSAMPLE;
    const canvas = this.canvas;
    const parent = canvas.parentElement;
    if (!parent) return;
    const w = parent.clientWidth;
    const h = parent.clientHeight;
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    const pw = Math.round(w * dpr);
    const ph = Math.round(h * dpr);
    if (canvas.width !== pw || canvas.height !== ph) {
      canvas.width = pw;
      canvas.height = ph;
    }
  }

  // Main render call
  render({ items, panX, panY, zoom, bgGrid, globalShadow, selectedIds, editingTextId }) {
    const gl = this.gl;
    const dpr = (window.devicePixelRatio || 1) * SUPERSAMPLE;

    this.resize();
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);

    // Resolution in CSS pixels (shader math uses CSS px, DPR handled by canvas size)
    const cssW = this.canvas.width / dpr;
    const cssH = this.canvas.height / dpr;

    // Clear
    const bgRgb = hexToRgb(bgGrid.bgColor || '#141413');
    gl.clearColor(bgRgb[0], bgRgb[1], bgRgb[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    // 1. Grid background
    if (bgGrid.enabled) {
      const fade = zoom >= 1 ? 1 : zoom <= 0.5 ? 0 : (zoom - 0.5) / 0.5;
      if (fade > 0) {
        this._renderGrid(bgGrid, panX, panY, zoom, dpr, fade);
      }
    }

    // 2. Sort items by z
    const sorted = [...items].sort((a, b) => a.z - b.z);

    // Viewport culling: compute world-space bounds with 25% margin
    const marginX = cssW * 0.25 / zoom;
    const marginY = cssH * 0.25 / zoom;
    const vpLeft = -panX / zoom - marginX;
    const vpTop = -panY / zoom - marginY;
    const vpRight = (cssW - panX) / zoom + marginX;
    const vpBottom = (cssH - panY) / zoom + marginY;

    // 3. Render items (culled)
    const selSet = new Set(selectedIds || []);
    for (const item of sorted) {
      if (item.type === 'connector') {
        const cLeft = Math.min(item.x1, item.x2);
        const cTop = Math.min(item.y1, item.y2);
        const cRight = Math.max(item.x1, item.x2);
        const cBottom = Math.max(item.y1, item.y2);
        if (cRight < vpLeft || cLeft > vpRight || cBottom < vpTop || cTop > vpBottom) continue;
        this._renderConnector(item, panX * dpr, panY * dpr, zoom * dpr, cssW * dpr, cssH * dpr);
      } else {
        if (item.x + item.w < vpLeft || item.x > vpRight || item.y + item.h < vpTop || item.y > vpBottom) continue;
        this._renderItem(item, panX * dpr, panY * dpr, zoom * dpr, cssW * dpr, cssH * dpr, globalShadow, editingTextId);
      }
    }

    // 4. Selection outlines (culled)
    for (const item of sorted) {
      if (!selSet.has(item.id)) continue;
      if (item.type === 'connector') continue; // connector selection handled by DOM handles
      if (item.x + item.w < vpLeft || item.x > vpRight || item.y + item.h < vpTop || item.y > vpBottom) continue;
      this._renderSelectionOutline(item, panX * dpr, panY * dpr, zoom * dpr, cssW * dpr, cssH * dpr);
    }

    // Prune video textures for removed items
    const videoIds = items.filter(i => i.type === 'video').map(i => i.id);
    this.texCache.pruneVideos(videoIds);
  }

  _renderGrid(bgGrid, panX, panY, zoom, dpr, fade) {
    const gl = this.gl;
    gl.useProgram(this.gridProg);
    gl.bindVertexArray(this.gridVAO);

    const u = this.gridU;
    const zoomDpr = zoom * dpr;
    const d1 = bgGrid.dot1;
    const d2 = bgGrid.dot2;

    gl.uniform2f(u.u_pan, panX * dpr, panY * dpr);
    gl.uniform1f(u.u_zoomDpr, zoomDpr);
    gl.uniform2f(u.u_resolution, this.canvas.width, this.canvas.height);
    gl.uniform3fv(u.u_bgColor, hexToRgb(bgGrid.bgColor));

    gl.uniform3fv(u.u_d1Color, hexToRgb(d1.color));
    gl.uniform1f(u.u_d1Opacity, d1.opacity * fade);
    gl.uniform1f(u.u_d1Size, d1.size);
    gl.uniform1f(u.u_d1Softness, d1.softness);
    gl.uniform1f(u.u_d1Spacing, d1.spacing);

    const d2on = d2?.enabled ? 1 : 0;
    gl.uniform1i(u.u_d2On, d2on);
    if (d2on) {
      gl.uniform3fv(u.u_d2Color, hexToRgb(d2.color));
      gl.uniform1f(u.u_d2Opacity, d2.opacity * fade);
      gl.uniform1f(u.u_d2Size, d2.size);
      gl.uniform1f(u.u_d2Softness, d2.softness);
      gl.uniform1f(u.u_d2Spacing, d2.spacing);
    }

    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindVertexArray(null);
  }

  _renderItem(item, panX, panY, zoom, resW, resH, globalShadow, editingTextId) {
    const gl = this.gl;
    gl.useProgram(this.quadProg);
    gl.bindVertexArray(this.quadVAO);

    const u = this.quadU;

    // If currently editing this text item, skip rendering it (DOM textarea overlay is shown)
    if (editingTextId === item.id) return;

    const hasShadow = globalShadow?.enabled && this._itemShadowEnabled(item);
    const shadowSize = hasShadow ? (globalShadow.size || 1.5) : 0;
    const shadowPad = hasShadow ? shadowSize * 5 : 0;

    const padW = item.w + shadowPad * 2;
    const padH = item.h + shadowPad * 2;

    gl.uniform2f(u.u_resolution, resW, resH);
    gl.uniform2f(u.u_pan, panX, panY);
    gl.uniform1f(u.u_zoom, zoom);

    gl.uniform2f(u.u_itemPos, item.x, item.y);
    gl.uniform2f(u.u_itemSize, item.w, item.h);
    gl.uniform1f(u.u_rotation, (item.rotation || 0) * Math.PI / 180);
    gl.uniform2f(u.u_padSize, padW, padH);
    gl.uniform2f(u.u_padOffset, shadowPad, shadowPad);
    gl.uniform1f(u.u_radius, item.radius ?? 2);
    gl.uniform1f(u.u_opacity, 1.0);
    gl.uniform1i(u.u_isSelection, 0);

    // Shadow
    gl.uniform1i(u.u_hasShadow, hasShadow ? 1 : 0);
    gl.uniform1f(u.u_shadowSize, shadowSize);
    gl.uniform1f(u.u_shadowOpacity, globalShadow?.opacity ?? 0.1);

    // Border
    const borderWidth = item.borderWidth || 0;
    gl.uniform1f(u.u_borderWidth, borderWidth);
    if (borderWidth > 0 && item.borderColor && item.borderColor !== 'transparent') {
      gl.uniform4fv(u.u_borderColor, hexToRgba(item.borderColor));
    } else {
      gl.uniform4f(u.u_borderColor, 0, 0, 0, 0);
    }

    // Content
    if (item.type === 'image') {
      // Build candidate list from best to worst resolution.
      // getBestReady kicks off loading for target + placeholder, and
      // returns the closest already-loaded tier to avoid showing
      // unnecessarily low-res when a better one is already cached.
      const target = item.targetSrc || item.displaySrc || item.src;
      const allTiers = [
        item.src,       // full res
        item.srcQ50,
        item.srcQ25,
        item.srcQ12,
        item.srcQ6,     // lowest res
      ];
      // Order: target first, then all tiers from high to low res, deduplicated
      const seen = new Set();
      const candidates = [];
      for (const c of [target, ...allTiers]) {
        if (c && !seen.has(c)) { seen.add(c); candidates.push(c); }
      }
      const best = this.texCache.getBestReady(candidates, item.pixelated);
      const entry = best.entry;
      gl.uniform1i(u.u_textured, 1);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, entry.tex);
      gl.uniform1i(u.u_tex, 0);
      // Object-fit: cover UV mapping
      const texW = entry.width || item.naturalWidth || item.w;
      const texH = entry.height || item.naturalHeight || item.h;
      const crop = this.texCache.coverUV(texW, texH, item.w, item.h);
      gl.uniform4f(u.u_texCrop, crop[0], crop[1], crop[2], crop[3]);
      gl.uniform4f(u.u_color, 1, 1, 1, 1);
    } else if (item.type === 'video') {
      const entry = this.texCache.getVideo(item.id, item.src);
      gl.uniform1i(u.u_textured, entry.ready ? 1 : 0);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, entry.tex);
      gl.uniform1i(u.u_tex, 0);
      const texW = entry.width || item.naturalWidth || item.w;
      const texH = entry.height || item.naturalHeight || item.h;
      const crop = this.texCache.coverUV(texW, texH, item.w, item.h);
      gl.uniform4f(u.u_texCrop, crop[0], crop[1], crop[2], crop[3]);
      gl.uniform4f(u.u_color, 0, 0, 0, 1);
    } else if (item.type === 'text' || item.type === 'link') {
      // Render text to texture
      const entry = this.textRenderer.get(item);
      gl.uniform1i(u.u_textured, 1);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, entry.tex);
      gl.uniform1i(u.u_tex, 0);
      gl.uniform4f(u.u_texCrop, 0, 0, 1, 1);
      gl.uniform4f(u.u_color, 1, 1, 1, 1);
    } else if (item.type === 'shape') {
      gl.uniform1i(u.u_textured, 0);
      const bgColor = this._getBgColor(item);
      gl.uniform4fv(u.u_color, bgColor);
      gl.uniform4f(u.u_texCrop, 0, 0, 1, 1);
    } else {
      return; // Unknown type
    }

    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindVertexArray(null);
  }

  _renderSelectionOutline(item, panX, panY, zoom, resW, resH) {
    const gl = this.gl;
    gl.useProgram(this.quadProg);
    gl.bindVertexArray(this.quadVAO);

    const u = this.quadU;
    const pad = 3; // outline padding

    gl.uniform2f(u.u_resolution, resW, resH);
    gl.uniform2f(u.u_pan, panX, panY);
    gl.uniform1f(u.u_zoom, zoom);

    gl.uniform2f(u.u_itemPos, item.x, item.y);
    gl.uniform2f(u.u_itemSize, item.w, item.h);
    gl.uniform1f(u.u_rotation, (item.rotation || 0) * Math.PI / 180);
    gl.uniform2f(u.u_padSize, item.w + pad * 2, item.h + pad * 2);
    gl.uniform2f(u.u_padOffset, pad, pad);
    gl.uniform1f(u.u_radius, (item.radius ?? 2) + 1);
    gl.uniform1f(u.u_opacity, 1.0);
    gl.uniform1i(u.u_isSelection, 1);
    gl.uniform1i(u.u_textured, 0);
    gl.uniform1i(u.u_hasShadow, 0);
    gl.uniform1f(u.u_borderWidth, 0);
    gl.uniform4f(u.u_color, 0, 0, 0, 0);
    gl.uniform4f(u.u_texCrop, 0, 0, 1, 1);

    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindVertexArray(null);
  }

  _renderConnector(item, panX, panY, zoom, resW, resH) {
    const gl = this.gl;
    const { x1, y1, x2, y2, lineWidth = 2, lineColor = '#C2C0B6',
            dot1 = true, dot2 = true, dotColor = '#C2C0B6', dotRadius = 5 } = item;
    const elbowX = item.elbowX ?? (x1 + x2) / 2;
    const elbowY = item.elbowY ?? (y1 + y2) / 2;
    const orient = item.orientation || 'h';
    const roundness = item.roundness ?? 20;

    // Generate path points
    const points = this._connectorPoints(x1, y1, x2, y2, elbowX, elbowY, orient, roundness);

    // Build thick line geometry from points
    const lineVerts = this._thickLineVerts(points, lineWidth / 2);

    if (lineVerts.length > 0) {
      gl.useProgram(this.lineProg);
      gl.bindVertexArray(this.lineVAO);

      gl.uniform2f(this.lineU.u_resolution, resW, resH);
      gl.uniform2f(this.lineU.u_pan, panX, panY);
      gl.uniform1f(this.lineU.u_zoom, zoom);
      gl.uniform4fv(this.lineU.u_color, hexToRgba(lineColor));

      gl.bindBuffer(gl.ARRAY_BUFFER, this.lineBuf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(lineVerts), gl.DYNAMIC_DRAW);
      gl.drawArrays(gl.TRIANGLES, 0, lineVerts.length / 2);
      gl.bindVertexArray(null);
    }

    // Endpoint dots
    if (dot1) this._renderCircle(x1, y1, dotRadius, dotColor, panX, panY, zoom, resW, resH);
    if (dot2) this._renderCircle(x2, y2, dotRadius, dotColor, panX, panY, zoom, resW, resH);
  }

  _renderCircle(cx, cy, radius, color, panX, panY, zoom, resW, resH) {
    const gl = this.gl;
    gl.useProgram(this.circleProg);
    gl.bindVertexArray(this.circleVAO);

    const u = this.circleU;
    gl.uniform2f(u.u_resolution, resW, resH);
    gl.uniform2f(u.u_pan, panX, panY);
    gl.uniform1f(u.u_zoom, zoom);
    gl.uniform2f(u.u_center, cx, cy);
    gl.uniform1f(u.u_radius, radius);
    gl.uniform4fv(u.u_color, hexToRgba(color));

    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindVertexArray(null);
  }

  // Generate points along a connector path (with rounded corners)
  _connectorPoints(x1, y1, x2, y2, elbowX, elbowY, orient, roundness) {
    const pts = [];

    if (orient === 'h') {
      // H-route: across → down → across
      const vertDist = Math.abs(y2 - y1);
      const halfVert = vertDist / 2;
      const s1 = Math.sign(elbowX - x1) || 1;
      const s2 = Math.sign(x2 - elbowX) || 1;
      const sv = Math.sign(y2 - y1) || 1;
      const r1 = Math.max(0, Math.min(Math.abs(elbowX - x1), halfVert, roundness));
      const r2 = Math.max(0, Math.min(Math.abs(x2 - elbowX), halfVert, roundness));

      if (vertDist < 1) {
        return [[x1, y1], [x2, y2]];
      }

      pts.push([x1, y1]);
      // First corner — arc center inset diagonally from the sharp corner
      if (r1 >= 0.5) {
        pts.push([elbowX - s1 * r1, y1]);
        this._arcPoints(pts, elbowX - s1 * r1, y1, elbowX, y1 + sv * r1, elbowX - s1 * r1, y1 + sv * r1, r1, 8);
      } else {
        pts.push([elbowX, y1]);
      }
      // Second corner — arc center inset diagonally from the sharp corner
      if (r2 >= 0.5) {
        pts.push([elbowX, y2 - sv * r2]);
        this._arcPoints(pts, elbowX, y2 - sv * r2, elbowX + s2 * r2, y2, elbowX + s2 * r2, y2 - sv * r2, r2, 8);
      } else {
        pts.push([elbowX, y2]);
      }
      pts.push([x2, y2]);
    } else {
      // V-route: down → across → down
      const hRun = Math.abs(x2 - x1);
      const halfH = hRun / 2;
      const sv1 = Math.sign(elbowY - y1) || 1;
      const sv2 = Math.sign(y2 - elbowY) || 1;
      const sh = Math.sign(x2 - x1) || 1;
      const r1 = Math.max(0, Math.min(Math.abs(elbowY - y1), halfH, roundness));
      const r2 = Math.max(0, Math.min(Math.abs(y2 - elbowY), halfH, roundness));

      pts.push([x1, y1]);
      if (r1 >= 0.5) {
        pts.push([x1, elbowY - sv1 * r1]);
        this._arcPoints(pts, x1, elbowY - sv1 * r1, x1 + sh * r1, elbowY, x1 + sh * r1, elbowY - sv1 * r1, r1, 8);
      } else {
        pts.push([x1, elbowY]);
      }
      if (r2 >= 0.5) {
        pts.push([x2 - sh * r2, elbowY]);
        this._arcPoints(pts, x2 - sh * r2, elbowY, x2, elbowY + sv2 * r2, x2 - sh * r2, elbowY + sv2 * r2, r2, 8);
      } else {
        pts.push([x2, elbowY]);
      }
      pts.push([x2, y2]);
    }

    return pts;
  }

  // Add arc points between start and end, curving around corner
  _arcPoints(pts, sx, sy, ex, ey, cx, cy, r, steps) {
    const startAngle = Math.atan2(sy - cy, sx - cx);
    const endAngle = Math.atan2(ey - cy, ex - cx);
    let delta = endAngle - startAngle;
    // Normalize to shortest arc
    if (delta > Math.PI) delta -= 2 * Math.PI;
    if (delta < -Math.PI) delta += 2 * Math.PI;

    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const a = startAngle + delta * t;
      pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
    }
  }

  // Convert a polyline to thick line triangle strip vertices
  _thickLineVerts(points, halfWidth) {
    if (points.length < 2) return [];
    const verts = [];

    for (let i = 0; i < points.length - 1; i++) {
      const [ax, ay] = points[i];
      const [bx, by] = points[i + 1];
      const dx = bx - ax, dy = by - ay;
      const len = Math.hypot(dx, dy);
      if (len < 0.001) continue;

      // Normal perpendicular to segment
      const nx = -dy / len * halfWidth;
      const ny = dx / len * halfWidth;

      // Two triangles forming a quad
      verts.push(
        ax + nx, ay + ny,
        ax - nx, ay - ny,
        bx + nx, by + ny,
        bx + nx, by + ny,
        ax - nx, ay - ny,
        bx - nx, by - ny,
      );
    }

    // Round caps at endpoints and joins: render small circles at each point
    for (const [px, py] of points) {
      const segments = 8;
      for (let i = 0; i < segments; i++) {
        const a0 = (i / segments) * Math.PI * 2;
        const a1 = ((i + 1) / segments) * Math.PI * 2;
        verts.push(
          px, py,
          px + Math.cos(a0) * halfWidth, py + Math.sin(a0) * halfWidth,
          px + Math.cos(a1) * halfWidth, py + Math.sin(a1) * halfWidth,
        );
      }
    }

    return verts;
  }

  _itemShadowEnabled(item) {
    return item.shadow ?? (item.type !== 'shape' && item.type !== 'text');
  }

  _getBgColor(item) {
    if (!item.bgColor || item.bgColor === 'transparent') return [0, 0, 0, 0];
    const op = item.bgOpacity ?? 1;
    if (op <= 0) return [0, 0, 0, 0];
    const rgb = hexToRgb(item.bgColor);
    return [...rgb, op];
  }

  destroy() {
    this.texCache.destroy();
    this.textRenderer.destroy();
  }
}
