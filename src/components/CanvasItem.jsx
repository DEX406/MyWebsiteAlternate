import { useState, useEffect, useRef } from 'react';
import { itemShadowEnabled } from '../utils.js';
import { ConnectorItem } from './ConnectorItem.jsx';
import { ConnectorHandles } from './ConnectorHandles.jsx';
import { ItemHandles } from './ItemHandles.jsx';
import { Z } from '../styles.js';

function useNaturalSize(src) {
  const [size, setSize] = useState(null);
  useEffect(() => {
    if (!src) return;
    let alive = true;
    const img = new Image();
    img.onload = () => { if (alive) setSize({ w: img.naturalWidth, h: img.naturalHeight }); };
    img.src = src;
    return () => { alive = false; };
  }, [src]);
  return size;
}

function MipmapImage({ item }) {
  const currentSrcRef = useRef(item.src);
  const [activeSrc, setActiveSrc] = useState(item.src);
  const [nextSrc, setNextSrc] = useState(null);
  const [nextReady, setNextReady] = useState(false);

  const displaySrc = item.displaySrc || item.src;

  useEffect(() => {
    if (displaySrc === activeSrc) {
      setNextSrc(null);
      setNextReady(false);
      return;
    }
    // Preload the new src
    setNextReady(false);
    setNextSrc(displaySrc);
    const img = new window.Image();
    let alive = true;
    img.onload = () => {
      if (alive) setNextReady(true);
    };
    img.onerror = () => {
      if (alive) { setNextSrc(null); setNextReady(false); }
    };
    img.src = displaySrc;
    return () => { alive = false; };
  }, [displaySrc, activeSrc]);

  // When the next image is loaded and crossfade finishes, swap it in
  useEffect(() => {
    if (!nextReady || !nextSrc) return;
    const timer = setTimeout(() => {
      setActiveSrc(nextSrc);
      currentSrcRef.current = nextSrc;
      setNextSrc(null);
      setNextReady(false);
    }, 250); // match the CSS transition duration
    return () => clearTimeout(timer);
  }, [nextReady, nextSrc]);

  const baseStyle = {
    position: 'absolute', top: 0, left: 0,
    width: '100%', height: '100%',
    objectFit: 'cover', display: 'block', pointerEvents: 'none',
    imageRendering: item.pixelated ? 'pixelated' : undefined,
  };

  return (
    <>
      <img src={activeSrc} alt="" draggable={false} style={baseStyle} />
      {nextSrc && (
        <img
          src={nextSrc} alt="" draggable={false}
          style={{
            ...baseStyle,
            opacity: nextReady ? 1 : 0,
            transition: 'opacity 250ms ease',
          }}
        />
      )}
    </>
  );
}

function VideoItem({ item }) {
  return (
    <video
      src={item.src}
      autoPlay
      loop
      muted
      playsInline
      draggable={false}
      style={{
        position: 'absolute', top: 0, left: 0,
        width: '100%', height: '100%',
        objectFit: 'cover', display: 'block', pointerEvents: 'none',
      }}
    />
  );
}

function imgFormat(src) {
  if (!src) return null;
  if (src.startsWith('data:image/')) {
    const m = src.match(/^data:image\/(\w+)/);
    return m ? m[1].toUpperCase() : null;
  }
  const ext = src.split('?')[0].split('#')[0].split('.').pop().toLowerCase();
  return { jpg: 'JPEG', jpeg: 'JPEG', png: 'PNG', gif: 'GIF', webp: 'WebP', avif: 'AVIF', svg: 'SVG', bmp: 'BMP', webm: 'WEBM', mp4: 'MP4', mov: 'MOV' }[ext] || null;
}

function imgSrcType(src) {
  if (!src) return null;
  if (src.startsWith('http') && !src.includes('r2.dev')) return 'link';
  return 'stored';
}

function ImageInfoPill({ src, item }) {
  const imgSize = useNaturalSize(item?.type === "video" ? null : src);
  const size = item?.type === "video"
    ? (item.naturalWidth ? { w: item.naturalWidth, h: item.naturalHeight } : null)
    : imgSize;
  const format = imgFormat(src);
  const srcType = imgSrcType(src);
  if (!size) return null;
  const parts = [format, srcType, `${size.w} × ${size.h}`].filter(Boolean);
  return (
    <div style={{
      position: "absolute", top: "calc(100% + 8px)", left: "50%",
      transform: "translateX(-50%)", pointerEvents: "none", whiteSpace: "nowrap",
      background: "rgba(20,20,19,0.85)", backdropFilter: "blur(16px)",
      border: "1px solid rgba(194,192,182,0.09)", borderRadius: 20,
      padding: "3px 10px", display: "flex", alignItems: "center", gap: 6,
      fontSize: 10, fontFamily: "inherit", color: "rgba(194,192,182,0.55)",
      letterSpacing: "0.04em",
    }}>
      {parts.map((p, i) => (
        <span key={i} style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {i > 0 && <span style={{ opacity: 0.3 }}>·</span>}
          {p}
        </span>
      ))}
    </div>
  );
}

const hexToRgba = (hex, alpha) => {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0,2), 16), g = parseInt(h.slice(2,4), 16), b = parseInt(h.slice(4,6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
};

const applyBg = (item) => {
  if (!item.bgColor || item.bgColor === "transparent") return "transparent";
  const op = item.bgOpacity ?? 1;
  if (op <= 0) return "transparent";
  return op >= 1 ? item.bgColor : hexToRgba(item.bgColor, op);
};

export function CanvasItem({ item, renderHandles, selectedIds, isAdmin, editingTextId, globalShadow, deleteItems, updateItem, setEditingTextId }) {
  const isSel = selectedIds.includes(item.id) && isAdmin;

  // Cull off-screen items — skip both content and handles unless selected
  if (item.culled && !isSel) return null;

  if (renderHandles && !isSel) return null;

  // Connector type — delegate to specialized components
  if (item.type === "connector") {
    return renderHandles
      ? <ConnectorHandles item={item} deleteItems={deleteItems} />
      : <ConnectorItem item={item} isAdmin={isAdmin} isSel={isSel} />;
  }

  // Non-connector handles
  if (renderHandles) return (
    <>
      <ItemHandles item={item} deleteItems={deleteItems} />
      {(item.type === "image" || item.type === "video") && (
        <div style={{ position: "absolute", left: item.x, top: item.y, width: item.w, height: item.h, zIndex: Z.HANDLE_INFO, pointerEvents: "none" }}>
          <ImageInfoPill src={item.src} item={item} />
        </div>
      )}
    </>
  );

  // Content rendering
  const containerStyle = {
    position: "absolute",
    left: item.x, top: item.y, width: item.w, height: item.h,
    zIndex: item.z,
    cursor: isAdmin ? "move" : (item.type === "link" ? "pointer" : "grab"),
  };

  const contentStyle = {
    width: "100%", height: "100%",
    position: "relative",
    borderRadius: item.radius ?? 2,
    boxShadow: globalShadow.enabled && itemShadowEnabled(item)
      ? `0 ${globalShadow.size}px ${globalShadow.size * 4.67}px rgba(0,0,0,${globalShadow.opacity})`
      : "none",
    overflow: "hidden",
    transform: `rotate(${item.rotation || 0}deg)`,
    transformOrigin: "center center",
  };

  let content;
  if (item.type === "image") {
    content = <MipmapImage item={item} />;
  } else if (item.type === "video") {
    content = <VideoItem item={item} />;
  } else if (item.type === "text") {
    const isEd = editingTextId === item.id;
    content = isEd ? (
      <textarea data-ui autoFocus value={item.text} onFocus={() => { if (item.placeholder) updateItem(item.id, { text: "", placeholder: false }); }} onChange={e => updateItem(item.id, { text: e.target.value })}
        onBlur={() => setEditingTextId(null)} onPointerDown={e => e.stopPropagation()}
        onTouchStart={e => e.stopPropagation()}
        style={{ width: "100%", height: "100%", resize: "none", border: "none", outline: "none", touchAction: "auto",
          background: applyBg(item) === "transparent" ? "rgba(194,192,182,0.05)" : applyBg(item),
          color: item.color, fontSize: item.fontSize, fontFamily: item.fontFamily,
          fontWeight: item.bold ? "bold" : "normal", fontStyle: item.italic ? "italic" : "normal",
          textAlign: item.align, padding: "8px 12px", boxSizing: "border-box" }} />
    ) : (
      <div onDoubleClick={() => isAdmin && setEditingTextId(item.id)} style={{
        width: "100%", height: "100%", padding: "8px 12px", boxSizing: "border-box",
        color: item.color, fontSize: item.fontSize, fontFamily: item.fontFamily,
        fontWeight: item.bold ? "bold" : "normal", fontStyle: item.italic ? "italic" : "normal",
        textAlign: item.align, background: applyBg(item), backdropFilter: item.bgBlur ? "blur(8px)" : undefined,
        whiteSpace: "pre-wrap", wordBreak: "break-word", overflow: "hidden",
        pointerEvents: isAdmin ? "auto" : "none" }}>{item.text}</div>
    );
  } else if (item.type === "link") {
    content = <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center",
      background: applyBg(item), backdropFilter: item.bgBlur ? "blur(8px)" : undefined, color: item.color, fontSize: item.fontSize, fontFamily: item.fontFamily,
      fontWeight: item.bold ? "bold" : "normal", fontStyle: item.italic ? "italic" : "normal",
      padding: "8px 16px", boxSizing: "border-box", pointerEvents: "none",
      borderWidth: item.borderWidth || 0, borderStyle: "solid", borderColor: item.borderColor || "transparent" }}>{item.text}</div>;
  } else if (item.type === "shape") {
    content = <div style={{ width: "100%", height: "100%", background: applyBg(item), backdropFilter: item.bgBlur ? "blur(8px)" : undefined,
      borderWidth: item.borderWidth || 0, borderStyle: "solid", borderColor: item.borderColor || "transparent", pointerEvents: "none" }} />;
  }

  return (
    <div data-item-id={item.id} style={containerStyle}>
      <div style={contentStyle}>{content}</div>
    </div>
  );
}
