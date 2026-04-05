// Texture cache: loads images from URLs into WebGL textures, manages video textures
// Supports FIFO eviction with placeholder protection — low-res placeholders are evicted last.

const MAX_TEXTURES = 200; // max cached textures before eviction kicks in

export class TextureCache {
  constructor(gl, onTextureReady) {
    this.gl = gl;
    this.cache = new Map(); // url → { tex, width, height, ready, isPlaceholder, insertOrder }
    this.videos = new Map(); // itemId → { video, tex, needsUpdate }
    this.loading = new Set(); // urls currently loading
    this.insertCounter = 0; // monotonic counter for FIFO ordering
    this._onTextureReady = onTextureReady || null; // callback when any texture finishes loading
    // 1x1 transparent fallback texture (used while images load)
    this.fallback = this._create1x1([0, 0, 0, 0]);
    // 1x1 transparent fallback
    this.transparent = this._create1x1([0, 0, 0, 0]);
  }

  _create1x1(rgba) {
    const gl = this.gl;
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(rgba));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    return { tex, width: 1, height: 1, ready: true };
  }

  // Check if a URL's texture is loaded and ready to render
  isReady(url) {
    if (!url) return false;
    const entry = this.cache.get(url);
    return !!(entry && entry.ready);
  }

  // Evict oldest non-placeholder textures first, then oldest placeholders, via FIFO
  _evict() {
    if (this.cache.size <= MAX_TEXTURES) return;

    // Collect entries sorted by insertOrder (FIFO)
    const entries = [...this.cache.entries()]
      .map(([url, entry]) => ({ url, ...entry }))
      .sort((a, b) => a.insertOrder - b.insertOrder);

    // Split into non-placeholder and placeholder
    const nonPlaceholders = entries.filter(e => !e.isPlaceholder);
    const placeholders = entries.filter(e => e.isPlaceholder);

    // Evict non-placeholders first (FIFO), then placeholders if needed
    const evictOrder = [...nonPlaceholders, ...placeholders];
    const toEvict = this.cache.size - MAX_TEXTURES;

    for (let i = 0; i < toEvict && i < evictOrder.length; i++) {
      const e = evictOrder[i];
      this.gl.deleteTexture(e.tex);
      this.cache.delete(e.url);
    }
  }

  // Get texture for an image URL. Returns { tex, width, height, ready }.
  // Starts async load if not cached. Returns fallback until ready.
  // isPlaceholder: mark this entry as a low-res placeholder (evicted last)
  get(url, pixelated = false, isPlaceholder = false) {
    if (!url) return this.transparent;

    const cached = this.cache.get(url);
    if (cached) return cached;

    // Start loading
    if (!this.loading.has(url)) {
      this.loading.add(url);
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        this.loading.delete(url);
        const gl = this.gl;
        const tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        this.cache.set(url, {
          tex, width: img.naturalWidth, height: img.naturalHeight,
          ready: true, isPlaceholder, insertOrder: this.insertCounter++,
        });
        this._evict();
        if (this._onTextureReady) this._onTextureReady();
      };
      img.onerror = () => {
        this.loading.delete(url);
      };
      img.src = url;
    }

    return this.fallback;
  }

  // Get the best available texture from a prioritized list of URLs (best-to-worst).
  // Only kicks off loading for the target (first) and placeholder (last).
  // Checks all intermediate tiers for an already-cached texture to use in the meantime.
  // Returns { entry, url } of the best ready texture, or fallback.
  getBestReady(candidates, pixelated = false) {
    let bestEntry = null;
    let bestUrl = null;

    for (let i = 0; i < candidates.length; i++) {
      const url = candidates[i];
      if (!url) continue;
      const isFirst = i === 0;
      const isLast = i === candidates.length - 1;

      if (isFirst || isLast) {
        // Kick off loading for target (first) and placeholder (last)
        const entry = this.get(url, pixelated, isLast);
        if (!bestEntry && entry.ready && entry !== this.fallback && entry !== this.transparent) {
          bestEntry = entry;
          bestUrl = url;
        }
      } else {
        // Intermediate tiers: only use if already cached, don't trigger new loads
        const cached = this.cache.get(url);
        if (!bestEntry && cached && cached.ready) {
          bestEntry = cached;
          bestUrl = url;
        }
      }
    }

    return bestEntry
      ? { entry: bestEntry, url: bestUrl }
      : { entry: this.fallback, url: null };
  }

  // Get or create a video texture for a video item.
  // Returns { tex, video, width, height, ready }.
  getVideo(itemId, src) {
    let entry = this.videos.get(itemId);
    if (entry && entry.src === src) {
      // Update texture from video frame if playing
      if (entry.video.readyState >= 2) {
        const gl = this.gl;
        gl.bindTexture(gl.TEXTURE_2D, entry.tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, entry.video);
        entry.ready = true;
        entry.width = entry.video.videoWidth;
        entry.height = entry.video.videoHeight;
      }
      return entry;
    }

    // Clean up old video
    if (entry) {
      entry.video.pause();
      entry.video.src = '';
      this.gl.deleteTexture(entry.tex);
    }

    // Create new video element
    const video = document.createElement('video');
    video.crossOrigin = 'anonymous';
    video.autoplay = true;
    video.loop = true;
    video.muted = true;
    video.playsInline = true;
    video.src = src;
    video.play().catch(() => {});

    const gl = this.gl;
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    const newEntry = { video, tex, src, width: 1, height: 1, ready: false };
    this.videos.set(itemId, newEntry);
    return newEntry;
  }

  // Remove video textures for items that no longer exist
  pruneVideos(activeIds) {
    const activeSet = new Set(activeIds);
    for (const [id, entry] of this.videos) {
      if (!activeSet.has(id)) {
        entry.video.pause();
        entry.video.src = '';
        this.gl.deleteTexture(entry.tex);
        this.videos.delete(id);
      }
    }
  }

  // Compute UV crop rect for object-fit: cover
  coverUV(texW, texH, itemW, itemH) {
    if (!texW || !texH || !itemW || !itemH) return [0, 0, 1, 1];
    const texAspect = texW / texH;
    const itemAspect = itemW / itemH;
    if (texAspect > itemAspect) {
      // Texture wider than item: crop sides
      const scale = itemAspect / texAspect;
      const offset = (1 - scale) / 2;
      return [offset, 0, scale, 1];
    } else {
      // Texture taller: crop top/bottom
      const scale = texAspect / itemAspect;
      const offset = (1 - scale) / 2;
      return [0, offset, 1, scale];
    }
  }

  destroy() {
    const gl = this.gl;
    for (const entry of this.cache.values()) {
      gl.deleteTexture(entry.tex);
    }
    for (const entry of this.videos.values()) {
      entry.video.pause();
      entry.video.src = '';
      gl.deleteTexture(entry.tex);
    }
    gl.deleteTexture(this.fallback.tex);
    gl.deleteTexture(this.transparent.tex);
    this.cache.clear();
    this.videos.clear();
  }
}
