Architecture: Figma-Style Canvas Rasterization
The Core Idea
Instead of rendering each item as a separate DOM element (which iOS struggles to composite when there are many), all items are painted onto a single <canvas> element. That canvas is positioned inside a CSS-transformed container, so zoom/pan is just a GPU transform on one texture — no re-rendering needed until the view settles.

Rendering Pipeline
Items (React state)
       │
       ▼
┌─────────────────────────┐
│  useLayoutEffect         │  Runs synchronously after every React render
│  triggers rasterize()    │  (items changed, shadow changed, text editing, image loaded)
└──────────┬──────────────┘
           ▼
┌─────────────────────────┐
│  rasterize() (App.jsx)  │
│                          │
│  1. Get viewport bounds  │  World coords visible on screen
│     in world coords      │
│                          │
│  2. Add dynamic margin   │  Extra pre-rendered area around viewport so
│     (2%–50%)             │  panning doesn't immediately show blank space.
│                          │  Margin auto-shrinks on retina to stay within
│                          │  8M pixel budget while keeping full DPR.
│                          │
│  3. Size the <canvas>    │  Pixel dimensions = worldSize × zoom × dpr
│     element              │  CSS dimensions = worldSize (CSS-scaled by
│                          │  the parent's transform)
│                          │
│  4. ctx.scale + translate │  Set up the coordinate system so drawing
│                          │  commands use world coordinates directly
│                          │
│  5. renderItems()        │  Paint all items onto the canvas
└──────────┬──────────────┘
           ▼
┌─────────────────────────┐
│  canvasRenderer.js       │
│                          │
│  For each item (z-sorted):
│  • Skip videos (DOM)     │
│  • Skip editingTextId    │  (DOM textarea covers it)
│  • Viewport cull         │  AABB check with rotation-aware bounds
│  • Draw shadow layer     │  Solid shape underneath for shadow casting
│  • Draw content on top:  │
│    - image: drawImage()  │  objectFit:cover math, mipmap fallback chain
│    - text: fillText()    │  Word-wrapped via measureText
│    - link: fillText()    │  Centered, with border
│    - shape: fillRect()   │  With optional border
│    - connector: Path2D   │  SVG path string from connectorPath.js
└─────────────────────────┘

Zoom & Pan (The Fast Path)
User pinches/scrolls
       │
       ▼
┌─────────────────────────┐
│  useViewport.js          │
│                          │
│  1. Update panRef/zoomRef│  Just ref mutations, no React render
│                          │
│  2. applyTransform()     │  Batched via rAF (one paint per frame)
│     ├─ CSS transform on  │  translate(px,py) scale(z) — GPU composited
│     │  canvasContentRef  │  (the <canvas> and video overlays)
│     ├─ CSS transform on  │
│     │  canvasHandlesRef  │  (selection handles layer)
│     ├─ Redraw grid       │
│     └─ Bounds check:     │  If viewport exceeds raster bounds →
│        re-rasterize      │  call rasterize() immediately
│                          │
│  3. scheduleSettled()    │  After 150ms of no interaction:
│     ├─ rasterize()       │  Re-render at new zoom for crispness
│     ├─ useMipmap settle  │  Pick optimal image tier for new zoom
│     └─ Drop willChange   │  (above 100% zoom) to force re-composite
└─────────────────────────┘

During zoom, the existing canvas texture is just CSS-scaled — blurry momentarily but instant. When the user stops, it re-rasterizes at the new zoom level with full DPR, snapping to crisp.

DOM Layers (What's NOT on the Canvas)
Three things still use real DOM elements:

Layer	Why
Videos	<video> elements can't be canvas-painted on iOS without tainting
Text being edited	A <textarea> overlay appears when double-clicking a text item, canvas skips that item
Selection handles	Resize dots, rotate knob, delete button — need pointer events and cursor styles
Image Memory Management
imageCache.js
├─ preloadItems() called when items change
│  ├─ Builds activeSrcs set (all src/displaySrc/mipmap URLs)
│  ├─ Preloads each via new Image()
│  └─ Evicts orphans (URLs no longer in any item) via FIFO
│
├─ getImage(src) → HTMLImageElement or null
│  Used by canvasRenderer during drawImageItem
│
└─ Fallback chain in renderer:
   displaySrc → src → srcQ50 → srcQ25 → srcQ12 → srcQ6
   (prevents flicker when switching mipmap tiers)

Hit Testing (Replacing DOM clicks)
Since items aren't DOM elements, clicks go through hitTest.js:

pointerdown / touchstart
       │
       ▼
  elementFromPoint() → found DOM element?  ─yes─→  video/handle/textarea
       │ no
       ▼
  hitTestItems(worldX, worldY)
  ├─ Reverse z-order (topmost first)
  ├─ Rect items: inverse-rotate point into local space, check bounds
  └─ Connectors: distance-to-segment < 16px tolerance

Mipmap Tier Selection
useMipmap.js (runs on viewport settle)
       │
       ▼
  For each image with mipmap variants:
  ├─ Off-screen → smallest tier (srcQ6)
  └─ On-screen → smallest tier where
     tier_width ≥ rendered_CSS_width
     (e.g., at 25% zoom, q25 tier has enough pixels)
       │
       ▼
  Sets item.displaySrc → triggers re-rasterize
  imageCache serves the best loaded tier via fallback chain

Key Invariants
React never re-renders during zoom/pan — only refs and CSS transforms change
Canvas is always at native DPR — margin shrinks instead of resolution
One GPU layer during interaction (willChange: transform), dropped on settle above 100% zoom to force crisp re-composite
rAF coalescing — multiple transform updates per frame collapse into one paint
