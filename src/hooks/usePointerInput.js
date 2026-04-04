import { useCallback, useEffect } from 'react';
import { snap, snapAngle, computeResize } from '../utils.js';
import { MIN_ZOOM, MAX_ZOOM } from './useViewport.js';

export function usePointerInput({
  vp, items, setItems, selectedIds, setSelectedIds,
  isAdmin,
  draggingRef, setDragging,
  resizingRef, setResizing,
  rotatingRef, setRotating,
  editingConnectorRef, setEditingConnector,
  setEditingTextId,
  effectiveSnapRef,
  scheduleSave, animateTo, pushUndo,
  doHitTest,
}) {
  const { panRef, zoomRef, isPanningRef, panStartRef, canvasRef, applyTransform, updateDisplays } = vp;

  const handlePointerDown = (e) => {
    if (e.pointerType === "touch") return;
    if (e.button === 1) { e.preventDefault(); isPanningRef.current = true; panStartRef.current = { x: e.clientX - panRef.current.x, y: e.clientY - panRef.current.y }; if (canvasRef.current) canvasRef.current.style.cursor = "grabbing"; return; }
    if (e.button !== 0) return;

    // Try DOM-based hit test first (for handle overlays)
    const target = e.target.closest("[data-item-id]");
    let action = target?.dataset?.action;
    let id = target?.dataset?.itemId;

    // If no DOM hit, try WebGL hit test on the canvas
    if (!id && !e.target.closest("[data-ui]") && doHitTest) {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (rect) {
        const hit = doHitTest(e.clientX - rect.left, e.clientY - rect.top, items, panRef.current.x, panRef.current.y, zoomRef.current);
        if (hit) { id = hit.id; action = hit.action; }
      }
    }

    if (id) {
      const item = items.find(i => i.id === id);
      if (!item) return;

      if (!action && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
        return;
      }

      if (!isAdmin) {
        if (item.type === "link" && !action) {
          if (item.teleportPan) { animateTo(item.teleportPan, item.teleportZoom ?? 1); }
          else if (item.url && item.url !== "https://") { window.open(item.url, "_blank", "noopener"); }
          return;
        }
        isPanningRef.current = true;
        panStartRef.current = { x: e.clientX - panRef.current.x, y: e.clientY - panRef.current.y };
        if (canvasRef.current) canvasRef.current.style.cursor = "grabbing";
        return;
      }

      if (action === "move-ep1" || action === "move-ep2" || action === "move-elbow") {
        e.stopPropagation();
        if (!selectedIds.includes(id)) setSelectedIds([id]);
        pushUndo(items);
        setEditingConnector({ id, handle: action.replace("move-", ""), startX: e.clientX, startY: e.clientY, startItem: { ...item } });
      }

      if (!action) {
        const alreadySelected = selectedIds.includes(id);
        const dragIds = alreadySelected
          ? selectedIds
          : (item.groupId ? items.filter(i => i.groupId === item.groupId).map(i => i.id) : [id]);
        if (!alreadySelected) setSelectedIds(dragIds);
        pushUndo(items);
        setDragging({
          ids: dragIds,
          startX: e.clientX, startY: e.clientY,
          itemsStartMap: new Map(items.filter(i => dragIds.includes(i.id)).map(i => [i.id, {
            id: i.id, x: i.x, y: i.y,
            x1: i.x1, y1: i.y1, x2: i.x2, y2: i.y2,
            elbowX: i.elbowX, elbowY: i.elbowY
          }])),
        });
      }

      if (action === "resize") {
        e.stopPropagation();
        pushUndo(items);
        const handle = target.dataset.handle || "br";
        setResizing({ id, handle, startX: e.clientX, startY: e.clientY, item: { ...item } });
      }

      if (action === "rotate") {
        e.stopPropagation();
        pushUndo(items);
        const rect = canvasRef.current.getBoundingClientRect();
        const centerX = rect.left + (item.x + item.w / 2) * zoomRef.current + panRef.current.x;
        const centerY = rect.top + (item.y + item.h / 2) * zoomRef.current + panRef.current.y;
        setRotating({ id, centerX, centerY, startAngle: item.rotation || 0, startMouseAngle: Math.atan2(e.clientY - centerY, e.clientX - centerX) * 180 / Math.PI });
      }

      e.preventDefault();
    } else {
      if (!e.target.closest("[data-ui]")) {
        setSelectedIds([]);
        setEditingTextId(null);
        isPanningRef.current = true;
        panStartRef.current = { x: e.clientX - panRef.current.x, y: e.clientY - panRef.current.y };
        if (canvasRef.current) canvasRef.current.style.cursor = "grabbing";
      }
    }
  };

  const handlePointerMove = useCallback((e) => {
    if (e.pointerType === "touch") return;
    const drag = draggingRef.current;
    const ec = editingConnectorRef.current;
    const rsz = resizingRef.current;
    const rot = rotatingRef.current;
    const es = effectiveSnapRef.current;
    if (drag) {
      const dx = (e.clientX - drag.startX) / zoomRef.current;
      const dy = (e.clientY - drag.startY) / zoomRef.current;
      setItems(p => p.map(i => {
        const start = drag.itemsStartMap.get(i.id);
        if (!start) return i;
        if (i.type === "connector") {
          return { ...i,
            x1: snap(start.x1 + dx, es), y1: snap(start.y1 + dy, es),
            x2: snap(start.x2 + dx, es), y2: snap(start.y2 + dy, es),
            elbowX: snap(start.elbowX + dx, es),
            elbowY: snap(start.elbowY + dy, es),
          };
        }
        return { ...i, x: snap(start.x + dx, es), y: snap(start.y + dy, es) };
      }));
    } else if (ec) {
      const dx = (e.clientX - ec.startX) / zoomRef.current;
      const dy = (e.clientY - ec.startY) / zoomRef.current;
      const si = ec.startItem;
      setItems(p => p.map(i => {
        if (i.id !== ec.id) return i;
        if (ec.handle === "ep1") return { ...i, x1: snap(si.x1 + dx, es), y1: snap(si.y1 + dy, es) };
        if (ec.handle === "ep2") return { ...i, x2: snap(si.x2 + dx, es), y2: snap(si.y2 + dy, es) };
        if (ec.handle === "elbow") {
          const newElbowX = snap(si.elbowX + dx, es);
          const newElbowY = snap(si.elbowY + dy, es);
          const midX = (i.x1 + i.x2) / 2;
          const midY = (i.y1 + i.y2) / 2;
          const hSpan = Math.abs(i.x2 - i.x1);
          const vSpan = Math.abs(i.y2 - i.y1);
          let orientation = i.orientation || "h";
          if (orientation === "h") {
            const distFromMidY = Math.abs(newElbowY - midY);
            const distFromMidX = Math.abs(newElbowX - midX);
            if (distFromMidY > vSpan * 0.35 + 20 && distFromMidY > distFromMidX) orientation = "v";
          } else {
            const distFromMidX = Math.abs(newElbowX - midX);
            const distFromMidY = Math.abs(newElbowY - midY);
            if (distFromMidX > hSpan * 0.35 + 20 && distFromMidX > distFromMidY) orientation = "h";
          }
          return { ...i, elbowX: newElbowX, elbowY: newElbowY, orientation };
        }
        return i;
      }));
    } else if (rsz) {
      const dx = (e.clientX - rsz.startX) / zoomRef.current;
      const dy = (e.clientY - rsz.startY) / zoomRef.current;
      const r = computeResize(rsz.item, rsz.handle, dx, dy, es);
      setItems(p => p.map(i => i.id === rsz.id ? { ...i, x: r.x, y: r.y, w: r.w, h: r.h } : i));
    } else if (rot) {
      const mouseAngle = Math.atan2(e.clientY - rot.centerY, e.clientX - rot.centerX) * 180 / Math.PI;
      const deltaAngle = mouseAngle - rot.startMouseAngle;
      const newAngle = snapAngle(rot.startAngle + deltaAngle, es);
      setItems(p => p.map(i => i.id === rot.id ? { ...i, rotation: newAngle } : i));
    } else if (isPanningRef.current) {
      panRef.current = { x: e.clientX - panStartRef.current.x, y: e.clientY - panStartRef.current.y };
      applyTransform();
      updateDisplays();
    }
  }, [applyTransform, updateDisplays]);

  const handlePointerUp = useCallback((e) => {
    if (e?.pointerType === "touch") return;
    if (draggingRef.current || resizingRef.current || rotatingRef.current || editingConnectorRef.current) scheduleSave();
    setDragging(null);
    setResizing(null);
    setRotating(null);
    setEditingConnector(null);
    isPanningRef.current = false;
    if (canvasRef.current) canvasRef.current.style.cursor = "";
  }, [scheduleSave]);

  const handleWheel = useCallback((e) => {
    const isOnCanvas = canvasRef.current?.contains(e.target);
    const drag = draggingRef.current;
    if (!isOnCanvas && !drag) return;

    e.preventDefault();

    if (drag) {
      const delta = e.deltaY < 0 ? -1 : 1;
      setItems(p => {
        const maxZ = Math.max(...p.map(i => i.z));
        const minZ = Math.min(...p.map(i => i.z));
        return p.map(i => {
          if (!drag.ids.includes(i.id)) return i;
          const newZ = Math.max(minZ, Math.min(maxZ + 1, i.z + delta));
          return { ...i, z: newZ };
        });
      });
      scheduleSave();
      return;
    }

    const rect = canvasRef.current.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const factor = e.deltaY < 0 ? 1.08 : 1 / 1.08;
    const z = zoomRef.current;
    const nz = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z * factor)), r = nz / z;
    const { x: px, y: py } = panRef.current;
    panRef.current = { x: mx - r * (mx - px), y: my - r * (my - py) };
    zoomRef.current = nz;
    applyTransform();
    updateDisplays();
  }, [scheduleSave, applyTransform, updateDisplays]);

  // Register window-level pointer/wheel listeners
  useEffect(() => {
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("wheel", handleWheel, { passive: false });
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("wheel", handleWheel);
    };
  }, [handlePointerMove, handlePointerUp, handleWheel]);

  return { handlePointerDown };
}
