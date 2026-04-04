// React hook that creates and manages the WebGL renderer.
// Replaces the DOM-based content layer with a single WebGL canvas.

import { useRef, useCallback, useEffect } from 'react';
import { GLRenderer } from '../webgl/GLRenderer.js';
import { hitTest } from '../webgl/hitTest.js';

export function useWebGLCanvas() {
  const canvasRef = useRef(null);
  const rendererRef = useRef(null);
  const rafRef = useRef(0);
  const renderDataRef = useRef(null);

  // Initialize renderer when canvas is available
  const initRenderer = useCallback((canvas) => {
    if (!canvas || rendererRef.current) return;
    try {
      const renderer = new GLRenderer(canvas);
      // When a texture finishes loading async, schedule a repaint so the
      // canvas updates without waiting for the next user interaction.
      renderer._onNeedsRedraw = () => {
        const d = renderDataRef.current;
        if (!d) return;
        if (!rafRef.current) {
          rafRef.current = requestAnimationFrame(() => {
            rafRef.current = 0;
            if (rendererRef.current && renderDataRef.current) {
              rendererRef.current.render(renderDataRef.current);
            }
          });
        }
      };
      rendererRef.current = renderer;
    } catch (e) {
      console.error('Failed to create WebGL renderer:', e);
    }
  }, []);

  // Set the canvas ref and init
  const setCanvasRef = useCallback((el) => {
    canvasRef.current = el;
    if (el) initRenderer(el);
  }, [initRenderer]);

  // Schedule a render with the latest data
  const requestRender = useCallback((data) => {
    renderDataRef.current = data;
    if (!rafRef.current) {
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = 0;
        const renderer = rendererRef.current;
        const d = renderDataRef.current;
        if (renderer && d) {
          renderer.render(d);
        }
      });
    }
  }, []);

  // Synchronous render (for inside existing rAF, e.g. animateTo)
  const renderSync = useCallback((data) => {
    renderDataRef.current = data;
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    }
    const renderer = rendererRef.current;
    if (renderer && data) {
      renderer.render(data);
    }
  }, []);

  // Hit test at screen coordinates (relative to canvas)
  const doHitTest = useCallback((screenX, screenY, items, panX, panY, zoom) => {
    return hitTest(screenX, screenY, items, panX, panY, zoom);
  }, []);

  // Invalidate a text item's cached texture
  const invalidateText = useCallback((itemId) => {
    const renderer = rendererRef.current;
    if (renderer) {
      renderer.textRenderer.invalidate(itemId);
    }
  }, []);

  // Cleanup
  useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (rendererRef.current) {
        rendererRef.current.destroy();
        rendererRef.current = null;
      }
    };
  }, []);

  return {
    setCanvasRef,
    canvasRef,
    rendererRef,
    requestRender,
    renderSync,
    doHitTest,
    invalidateText,
  };
}
