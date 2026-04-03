import { useEffect, useRef, useCallback, useState } from 'react';
import { generateMipmaps } from '../api.js';

// Track in-flight mipmap generation requests globally to avoid duplicates
const pendingGenerations = new Set();

/**
 * Manages mipmap tier selection for all image items on the canvas.
 *
 * For each image, determines the best resolution tier (full / q50 / q25 / q12 / q6)
 * based on DPI-aware logic: only downgrade when the smaller variant has
 * enough pixels to cover the rendered size without upscaling.
 *
 * Triggers lazy mipmap generation for images that don't have variants yet.
 */
export function useMipmap(items, updateItem, vp) {
  const [settled, setSettled] = useState(0); // increments on each settle
  const itemsRef = useRef(items);
  itemsRef.current = items;

  // Wire up the settled callback from useViewport
  useEffect(() => {
    vp.onSettledRef.current = () => setSettled(c => c + 1);
    return () => { vp.onSettledRef.current = null; };
  }, [vp.onSettledRef]);

  // Trigger mipmap generation for images missing variants
  useEffect(() => {
    const images = items.filter(i =>
      i.type === 'image' &&
      i.src &&
      !i.srcQ50 &&
      !i._mipmapPending &&
      !pendingGenerations.has(i.src)
    );

    // Skip GIFs and SVGs on the client side too
    const eligible = images.filter(i => {
      const ext = i.src.split('?')[0].split('#')[0].split('.').pop().toLowerCase();
      return ext !== 'gif' && ext !== 'svg';
    });

    // Only process R2-hosted images
    const r2Images = eligible.filter(i => i.src.includes('r2.dev'));

    for (const item of r2Images) {
      pendingGenerations.add(item.src);
      generateMipmaps(item.src).then(result => {
        pendingGenerations.delete(item.src);
        if (result && (result.srcQ50 || result.srcQ25 || result.srcQ12 || result.srcQ6)) {
          updateItem(item.id, {
            srcQ50: result.srcQ50 || null,
            srcQ25: result.srcQ25 || null,
            srcQ12: result.srcQ12 || null,
            srcQ6: result.srcQ6 || null,
          });
        }
      }).catch(() => {
        pendingGenerations.delete(item.src);
      });
    }
  }, [items, updateItem]);

  // Compute display sources for all image items whenever viewport settles
  const computeDisplaySources = useCallback(() => {
    const bounds = vp.getViewportBounds();
    const zoom = vp.zoomRef.current;

    for (const item of itemsRef.current) {
      if (item.type !== 'image' || !item.src) continue;
      if (!item.srcQ50 && !item.srcQ25 && !item.srcQ12 && !item.srcQ6) continue; // no variants available

      const isOnscreen = itemIsOnscreen(item, bounds);

      if (!isOnscreen) {
        // Cull off-screen images entirely instead of swapping to a low-res
        // variant — the swap causes heavy lag on iOS.
        if (!item.culled) updateItem(item.id, { culled: true });
        continue;
      }

      const targetSrc = pickTier(item, zoom);
      const updates = {};
      if (item.culled) updates.culled = false;
      if (targetSrc !== item.displaySrc) updates.displaySrc = targetSrc;
      if (Object.keys(updates).length) updateItem(item.id, updates);
    }
  }, [vp, updateItem]);

  // Re-evaluate on every settle event
  useEffect(() => {
    if (settled > 0) computeDisplaySources();
  }, [settled, computeDisplaySources]);

  // Also evaluate once when mipmaps become available
  const prevMipmapCountRef = useRef(0);
  useEffect(() => {
    const count = items.filter(i => i.srcQ50 || i.srcQ25 || i.srcQ12 || i.srcQ6).length;
    if (count > prevMipmapCountRef.current) {
      computeDisplaySources();
    }
    prevMipmapCountRef.current = count;
  }, [items, computeDisplaySources]);
}

function itemIsOnscreen(item, bounds) {
  // AABB intersection test
  const itemRight = item.x + item.w;
  const itemBottom = item.y + item.h;
  return !(item.x > bounds.right || itemRight < bounds.left ||
           item.y > bounds.bottom || itemBottom < bounds.top);
}

function pickTier(item, zoom) {
  // DPI-aware selection
  // renderedWidth = the CSS pixel width this item occupies on screen
  const renderedWidth = item.w * zoom;

  // Natural width of each variant (power-of-2 halving chain).
  // We use item.naturalWidth if available, otherwise fall back to item.w (the canvas size)
  const natW = item.naturalWidth || item.w;

  const q6Width = natW * 0.0625;
  const q12Width = natW * 0.125;
  const q25Width = natW * 0.25;
  const q50Width = natW * 0.50;

  if (item.srcQ6 && q6Width >= renderedWidth) return item.srcQ6;
  if (item.srcQ12 && q12Width >= renderedWidth) return item.srcQ12;
  if (item.srcQ25 && q25Width >= renderedWidth) return item.srcQ25;
  if (item.srcQ50 && q50Width >= renderedWidth) return item.srcQ50;
  return item.src;
}
