import { useEffect } from 'react';
import { uid } from '../utils.js';

export function useKeyboard({
  isAdmin, selectedIds, setSelectedIds, clipboard, setClipboard,
  items, setItemsAndSave, editingTextId, setEditingTextId,
  viewCenter, setShiftHeld, undo, redo,
}) {
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === "Shift") setShiftHeld(true);
      if (!isAdmin) return;

      if (e.key === "Delete" || e.key === "Backspace") {
        const tag = document.activeElement?.tagName;
        if (editingTextId || tag === "INPUT" || tag === "TEXTAREA" || document.activeElement?.isContentEditable) return;
        if (selectedIds.length > 0) {
          setItemsAndSave(p => p.filter(i => !selectedIds.includes(i.id)));
          setSelectedIds([]);
        }
      }

      if (e.key === "c" && (e.ctrlKey || e.metaKey)) {
        const tag = document.activeElement?.tagName;
        if (editingTextId || tag === "INPUT" || tag === "TEXTAREA") return;
        const toCopy = items.filter(i => selectedIds.includes(i.id));
        setClipboard(toCopy.map(i => ({ ...i, id: uid() })));
        e.preventDefault();
      }

      if (e.key === "v" && (e.ctrlKey || e.metaKey)) {
        if (clipboard.length === 0) return;
        const c = viewCenter();
        const mZ = items.length ? Math.max(...items.map(i => i.z)) : 0;
        // Compute centroid to preserve relative layout on paste
        const centers = clipboard.map(item => item.type === "connector"
          ? { x: ((item.x1 ?? 0) + (item.x2 ?? 0)) / 2, y: ((item.y1 ?? 0) + (item.y2 ?? 0)) / 2 }
          : { x: (item.x ?? 0) + (item.w ?? 0) / 2, y: (item.y ?? 0) + (item.h ?? 0) / 2 });
        const clipCX = centers.reduce((s, p) => s + p.x, 0) / centers.length;
        const clipCY = centers.reduce((s, p) => s + p.y, 0) / centers.length;
        const dx = c.x - clipCX;
        const dy = c.y - clipCY;
        const groupIdMap = {};
        const pasted = clipboard.map((item, idx) => {
          let newGroupId = item.groupId;
          if (newGroupId) {
            if (!groupIdMap[newGroupId]) groupIdMap[newGroupId] = uid();
            newGroupId = groupIdMap[newGroupId];
          }
          if (item.type === "connector") {
            return {
              ...item, id: uid(), groupId: newGroupId,
              x1: (item.x1 ?? 0) + dx, y1: (item.y1 ?? 0) + dy,
              x2: (item.x2 ?? 0) + dx, y2: (item.y2 ?? 0) + dy,
              elbowX: (item.elbowX ?? ((item.x1 + item.x2) / 2)) + dx,
              elbowY: (item.elbowY ?? ((item.y1 + item.y2) / 2)) + dy,
              z: mZ + 1 + idx,
            };
          }
          return { ...item, id: uid(), groupId: newGroupId, x: (item.x ?? 0) + dx, y: (item.y ?? 0) + dy, z: mZ + 1 + idx };
        });
        setItemsAndSave(p => [...p, ...pasted]);
        setSelectedIds(pasted.map(i => i.id));
        e.preventDefault();
      }

      if (e.key === "z" && (e.ctrlKey || e.metaKey) && !e.shiftKey) {
        const tag = document.activeElement?.tagName;
        if (editingTextId || tag === "INPUT" || tag === "TEXTAREA") return;
        undo();
        e.preventDefault();
      }

      if ((e.key === "z" && (e.ctrlKey || e.metaKey) && e.shiftKey) || (e.key === "y" && (e.ctrlKey || e.metaKey))) {
        const tag = document.activeElement?.tagName;
        if (editingTextId || tag === "INPUT" || tag === "TEXTAREA") return;
        redo();
        e.preventDefault();
      }

      if (e.key === "Escape") {
        setSelectedIds([]);
        setEditingTextId(null);
      }
    };

    const handleKeyUp = (e) => {
      if (e.key === "Shift") setShiftHeld(false);
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [isAdmin, selectedIds, clipboard, items, editingTextId,
      setShiftHeld, setSelectedIds, setClipboard, setItemsAndSave, setEditingTextId, viewCenter, undo, redo]);
}
