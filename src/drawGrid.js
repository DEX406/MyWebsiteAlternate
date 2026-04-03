// WebGL dot-grid renderer
// A fragment shader computes dot membership per-pixel via mod() math.
// Per frame: ~10 uniform uploads only — no texture generation, no CPU rasterization.

const VERT = `
attribute vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }
`;

// highp required: at MIN_ZOOM=0.1 on 3x DPR, world coords reach ~60 000
const FRAG = `
precision highp float;
uniform vec2  u_pan;
uniform float u_zoomDpr;
uniform vec2  u_resolution;
uniform vec3  u_bgColor;
uniform vec3  u_d1Color;
uniform float u_d1Opacity;
uniform float u_d1Size;
uniform float u_d1Softness;
uniform float u_d1Spacing;
uniform int   u_d2On;
uniform vec3  u_d2Color;
uniform float u_d2Opacity;
uniform float u_d2Size;
uniform float u_d2Softness;
uniform float u_d2Spacing;

float dotA(vec2 world, float spacing, float size, float softness) {
  // Place dots at grid intersections (exact multiples of spacing from origin).
  // min(g, spacing-g) is the shortest distance to a grid line per axis,
  // so length() of that is the distance to the nearest intersection.
  // Any secondary spacing that is a multiple of primary lands exactly on a
  // primary dot — no diagonal offset.
  vec2 g = mod(world, spacing);
  float d = length(min(g, vec2(spacing) - g));
  // 0.5 world-px sub-pixel AA on hard dots; softness expands the fade zone
  float edge0 = size - 0.5;
  float edge1 = softness < 0.01 ? size + 0.5 : size * (1.0 + softness * 2.0);
  return 1.0 - smoothstep(edge0, edge1, d);
}

void main() {
  // Flip Y: WebGL origin is bottom-left, CSS is top-left
  vec2 screen = vec2(gl_FragCoord.x, u_resolution.y - gl_FragCoord.y);
  vec2 world  = (screen - u_pan) / u_zoomDpr;

  vec3 col = u_bgColor;

  float a1 = dotA(world, u_d1Spacing, u_d1Size, u_d1Softness);
  col = mix(col, u_d1Color, a1 * u_d1Opacity);

  if (u_d2On != 0) {
    float a2 = dotA(world, u_d2Spacing, u_d2Size, u_d2Softness);
    col = mix(col, u_d2Color, a2 * u_d2Opacity);
  }

  gl_FragColor = vec4(col, 1.0);
}
`;

function hexToRgb(hex) {
  return [
    parseInt(hex.slice(1, 3), 16) / 255,
    parseInt(hex.slice(3, 5), 16) / 255,
    parseInt(hex.slice(5, 7), 16) / 255,
  ];
}

// Per-canvas WebGL state (WeakMap so the canvas can be GC'd freely)
const glMap = new WeakMap();

function initGL(canvas) {
  const gl = canvas.getContext('webgl', { alpha: false, desynchronized: true, antialias: false, powerPreference: 'default' });
  if (!gl) return null;

  function compile(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    return s;
  }

  const prog = gl.createProgram();
  gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
  gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(prog);
  gl.useProgram(prog);

  // Fullscreen quad in NDC
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, -1,1, 1,-1, 1,1]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'a_pos');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

  const u = {};
  ['u_pan','u_zoomDpr','u_resolution','u_bgColor',
   'u_d1Color','u_d1Opacity','u_d1Size','u_d1Softness','u_d1Spacing',
   'u_d2On','u_d2Color','u_d2Opacity','u_d2Size','u_d2Softness','u_d2Spacing',
  ].forEach(n => { u[n] = gl.getUniformLocation(prog, n); });

  return { gl, u };
}

export function drawGrid(canvas, panX, panY, zoom, bgGrid) {
  if (!bgGrid.enabled) return;

  const dpr = window.devicePixelRatio || 1;
  const parent = canvas.parentElement;
  // Always a square large enough to cover the viewport in any dimension.
  // Centered via CSS translate(-50%,-50%), so it bleeds equally on all sides.
  const cssSize = Math.ceil(Math.hypot(parent.clientWidth, parent.clientHeight));
  const px = Math.round(cssSize * dpr);

  canvas.style.width  = cssSize + 'px';
  canvas.style.height = cssSize + 'px';
  if (canvas.width !== px || canvas.height !== px) {
    canvas.width  = px;
    canvas.height = px;
  }

  if (!glMap.has(canvas)) {
    const state = initGL(canvas);
    if (!state) return; // WebGL unavailable
    glMap.set(canvas, state);
  }
  const { gl, u } = glMap.get(canvas);

  gl.viewport(0, 0, px, px);

  const zoomDpr = zoom * dpr;
  const d1 = bgGrid.dot1;
  const d2 = bgGrid.dot2;

  // The canvas top-left is offset from the parent top-left by half the bleed.
  // Subtract that offset from pan so world coords stay aligned with the viewport.
  const offsetX = (parent.clientWidth  - cssSize) / 2;
  const offsetY = (parent.clientHeight - cssSize) / 2;
  gl.uniform2f(u.u_pan,        (panX - offsetX) * dpr, (panY - offsetY) * dpr);
  gl.uniform1f(u.u_zoomDpr,    zoomDpr);
  gl.uniform2f(u.u_resolution, px, px);
  gl.uniform3fv(u.u_bgColor,   hexToRgb(bgGrid.bgColor));

  gl.uniform3fv(u.u_d1Color,   hexToRgb(d1.color));
  gl.uniform1f(u.u_d1Opacity,  d1.opacity);
  gl.uniform1f(u.u_d1Size,     d1.size);
  gl.uniform1f(u.u_d1Softness, d1.softness);
  gl.uniform1f(u.u_d1Spacing,  d1.spacing);

  const d2on = d2?.enabled ? 1 : 0;
  gl.uniform1i(u.u_d2On, d2on);
  if (d2on) {
    gl.uniform3fv(u.u_d2Color,   hexToRgb(d2.color));
    gl.uniform1f(u.u_d2Opacity,  d2.opacity);
    gl.uniform1f(u.u_d2Size,     d2.size);
    gl.uniform1f(u.u_d2Softness, d2.softness);
    gl.uniform1f(u.u_d2Spacing,  d2.spacing);
  }

  gl.drawArrays(gl.TRIANGLES, 0, 6);
}
