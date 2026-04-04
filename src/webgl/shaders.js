// ── WebGL2 Shader Sources ──

// Shared vertex shader for fullscreen quad (grid background)
export const GRID_VERT = `#version 300 es
in vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }
`;

// Grid fragment shader (ported from drawGrid.js)
export const GRID_FRAG = `#version 300 es
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
out vec4 outColor;

float dotA(vec2 world, float spacing, float size, float softness) {
  vec2 g = mod(world, spacing);
  float d = length(min(g, vec2(spacing) - g));
  float edge0 = size - 0.5;
  float edge1 = softness < 0.01 ? size + 0.5 : size * (1.0 + softness * 2.0);
  return 1.0 - smoothstep(edge0, edge1, d);
}

void main() {
  vec2 screen = vec2(gl_FragCoord.x, u_resolution.y - gl_FragCoord.y);
  vec2 world  = (screen - u_pan) / u_zoomDpr;
  vec3 col = u_bgColor;
  float a1 = dotA(world, u_d1Spacing, u_d1Size, u_d1Softness);
  col = mix(col, u_d1Color, a1 * u_d1Opacity);
  if (u_d2On != 0) {
    float a2 = dotA(world, u_d2Spacing, u_d2Size, u_d2Softness);
    col = mix(col, u_d2Color, a2 * u_d2Opacity);
  }
  outColor = vec4(col, 1.0);
}
`;

// ── Quad shader: renders images, shapes, text, links ──
export const QUAD_VERT = `#version 300 es
precision highp float;
// Unit quad: (0,0) → (1,1)
in vec2 a_pos;

// View transform
uniform vec2 u_resolution;
uniform vec2 u_pan;
uniform float u_zoom;

// Item transform
uniform vec2 u_itemPos;   // world-space top-left
uniform vec2 u_itemSize;  // world-space width/height
uniform float u_rotation; // radians
uniform vec2 u_padSize;   // expanded size (for shadow padding)
uniform vec2 u_padOffset; // offset due to padding

out vec2 v_uv;       // 0..1 within padded quad
out vec2 v_localPx;  // pixel coords within padded area

void main() {
  // Position within the padded quad
  vec2 local = a_pos * u_padSize;
  v_uv = a_pos;
  v_localPx = local;

  // Rotate around item center (not pad center)
  vec2 itemCenter = u_padOffset + u_itemSize * 0.5;
  float c = cos(u_rotation), s = sin(u_rotation);
  vec2 d = local - itemCenter;
  vec2 rotated = itemCenter + vec2(d.x * c - d.y * s, d.x * s + d.y * c);

  // World position — subtract padOffset so item content lands at u_itemPos
  vec2 world = (u_itemPos - u_padOffset) + rotated;

  // Screen position
  vec2 screen = world * u_zoom + u_pan;

  // To NDC
  vec2 ndc = screen / u_resolution * 2.0 - 1.0;
  ndc.y = -ndc.y;
  gl_Position = vec4(ndc, 0.0, 1.0);
}
`;

export const QUAD_FRAG = `#version 300 es
precision highp float;

in vec2 v_uv;
in vec2 v_localPx;

uniform vec2 u_itemSize;
uniform vec2 u_padSize;
uniform vec2 u_padOffset;
uniform float u_radius;
uniform vec4 u_color;       // bg RGBA (premultiplied-ready)
uniform int u_textured;
uniform sampler2D u_tex;
uniform vec4 u_texCrop;     // UV rect for object-fit: cover (x, y, w, h)
uniform float u_opacity;
uniform vec4 u_borderColor;
uniform float u_borderWidth;
uniform int u_hasShadow;
uniform float u_shadowSize;
uniform float u_shadowOpacity;
uniform int u_isSelection;   // render as selection outline only

out vec4 outColor;

float roundedBoxSDF(vec2 p, vec2 half_size, float r) {
  vec2 q = abs(p) - half_size + r;
  return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - r;
}

void main() {
  // Position relative to item center (not pad center)
  vec2 itemLocal = v_localPx - u_padOffset;
  vec2 p = itemLocal - u_itemSize * 0.5;
  vec2 halfSize = u_itemSize * 0.5;
  float r = min(u_radius, min(halfSize.x, halfSize.y));

  float dist = roundedBoxSDF(p, halfSize, r);

  // Selection outline mode
  if (u_isSelection != 0) {
    float outlineWidth = 1.5;
    float outerDist = roundedBoxSDF(p, halfSize + outlineWidth, r + outlineWidth);
    float aa = 1.0 - smoothstep(-0.5, 0.5, outerDist);
    float inner = 1.0 - smoothstep(-0.5, 0.5, dist);
    float outline = aa - inner;
    outColor = vec4(0.173, 0.518, 0.859, outline * 0.7); // #2C84DB
    if (outColor.a < 0.01) discard;
    return;
  }

  // Shadow
  if (u_hasShadow != 0 && dist > 0.0) {
    float blur = u_shadowSize * 4.67;
    float shadowAlpha = u_shadowOpacity * (1.0 - smoothstep(0.0, blur, dist));
    if (shadowAlpha < 0.005) discard;
    outColor = vec4(0.0, 0.0, 0.0, shadowAlpha * u_opacity);
    return;
  }

  // Outside rounded box
  if (dist > 0.5) discard;

  float aa = 1.0 - smoothstep(-0.5, 0.5, dist);

  // Border
  if (u_borderWidth > 0.0 && dist > -(u_borderWidth)) {
    outColor = vec4(u_borderColor.rgb, u_borderColor.a * aa * u_opacity);
    return;
  }

  // Content
  vec4 col;
  if (u_textured != 0) {
    vec2 uv = u_texCrop.xy + (itemLocal / u_itemSize) * u_texCrop.zw;
    uv = clamp(uv, vec2(0.0), vec2(1.0));
    col = texture(u_tex, uv);
  } else {
    col = u_color;
  }

  outColor = vec4(col.rgb, col.a * aa * u_opacity);
}
`;

// ── Line shader: renders connectors as thick lines ──
export const LINE_VERT = `#version 300 es
precision highp float;

in vec2 a_pos;

uniform vec2 u_resolution;
uniform vec2 u_pan;
uniform float u_zoom;

void main() {
  vec2 screen = a_pos * u_zoom + u_pan;
  vec2 ndc = screen / u_resolution * 2.0 - 1.0;
  ndc.y = -ndc.y;
  gl_Position = vec4(ndc, 0.0, 1.0);
}
`;

export const LINE_FRAG = `#version 300 es
precision highp float;
uniform vec4 u_color;
out vec4 outColor;
void main() {
  outColor = u_color;
}
`;

// ── Circle shader: renders dots at connector endpoints ──
export const CIRCLE_VERT = `#version 300 es
precision highp float;
in vec2 a_pos; // unit quad 0..1

uniform vec2 u_resolution;
uniform vec2 u_pan;
uniform float u_zoom;
uniform vec2 u_center;  // world space
uniform float u_radius; // world space

out vec2 v_uv;

void main() {
  v_uv = a_pos * 2.0 - 1.0; // -1..1
  vec2 world = u_center + (a_pos - 0.5) * u_radius * 2.0;
  vec2 screen = world * u_zoom + u_pan;
  vec2 ndc = screen / u_resolution * 2.0 - 1.0;
  ndc.y = -ndc.y;
  gl_Position = vec4(ndc, 0.0, 1.0);
}
`;

export const CIRCLE_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform vec4 u_color;
out vec4 outColor;
void main() {
  float d = length(v_uv);
  if (d > 1.0) discard;
  outColor = u_color;
}
`;
