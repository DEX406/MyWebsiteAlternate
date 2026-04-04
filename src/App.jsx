import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { ZoomInIcon, ZoomOutIcon, GridIcon, HomeIcon, FloppyIcon, UndoIcon, RedoIcon, CopyIcon, PasteIcon, TrashIcon, GroupIcon, UngroupIcon, BringFrontIcon, SendBackIcon } from './icons.jsx';

import { FONT, FONTS, DEFAULT_BG_GRID } from './constants.js';
import { uid, snap } from './utils.js';
import { createBackupZip, restoreFromZip } from './backupRestore.js';
import { serverResize } from './imageUtils.js';
import { tbBtn, tbSurface, tbSep, togBtn, infoText, panelSurface, UI_BG, UI_BORDER, Z } from './styles.js';
import { CanvasItem } from './components/CanvasItem.jsx';
import { PropertiesPanel } from './components/PropertiesPanel.jsx';
import { Toolbar } from './components/Toolbar.jsx';
import { ColorPickerPopup } from './components/ColorPickerPopup.jsx';
import { LoginModal } from './components/LoginModal.jsx';
import { loadBoard, saveBoard, cleanupFiles, uploadImage, uploadVideo, login, logout, hasToken, getBackupManifest, restoreImageKey, downloadImageViaProxy } from './api.js';
import { convertVideoToWebm, isVideoFile } from './videoUtils.js';
import { useViewport } from './hooks/useViewport.js';
import { useKeyboard } from './hooks/useKeyboard.js';
import { usePointerInput } from './hooks/usePointerInput.js';
import { useTouchInput } from './hooks/useTouchInput.js';
import { useUndo } from './hooks/useUndo.js';
import { useMipmap } from './hooks/useMipmap.js';
import { useWebGLCanvas } from './hooks/useWebGLCanvas.js';

const DEFAULT_PALETTE = ["#C2C0B6", "#30302E", "#262624", "#141413", "#FE8181", "#D97757", "#65BB30", "#2C84DB", "#9B87F5"];
const COLOR_PROPS = ["color", "bgColor", "borderColor", "lineColor", "dotColor"];

// ── App ──
export default function App() {
  const [items, setItems] = useState([]);
  const [isAdmin, setIsAdmin] = useState(() => hasToken());
  const [showLogin, setShowLogin] = useState(false);
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState(false);
  const [rateLimited, setRateLimited] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saveStatus, setSaveStatus] = useState("");
  const [uploadStatus, setUploadStatus] = useState("");
  const [snapOn, setSnapOn] = useState(false);
  const [shiftHeld, setShiftHeld] = useState(false);
  const [globalShadow, setGlobalShadow] = useState(() => {
    try { const s = localStorage.getItem("lutz-shadow-settings"); return s ? JSON.parse(s) : { enabled: true, size: 1.5, opacity: 0.1 }; }
    catch { return { enabled: true, size: 1.5, opacity: 0.1 }; }
  });
  const [selectedIds, setSelectedIds] = useState([]);
  const [clipboard, setClipboard] = useState([]);
  const [palette, setPalette] = useState(DEFAULT_PALETTE);
  const [bgGrid, setBgGrid] = useState(DEFAULT_BG_GRID);
  const [colorPicker, setColorPicker] = useState(null);
  const [settingTeleport, setSettingTeleport] = useState(null);
  const [dragging, setDragging] = useState(null);
  const [resizing, setResizing] = useState(null);
  const [rotating, setRotating] = useState(null);
  const [editingTextId, setEditingTextId] = useState(null);
  const [editingConnector, setEditingConnector] = useState(null);
  const [multiSelectMode, setMultiSelectMode] = useState(false);

  const fileInputRef = useRef(null);
  const boardFileRef = useRef(null);
  const saveTimer = useRef(null);
  const itemsRef = useRef(items); itemsRef.current = items;
  const bgGridRef = useRef(bgGrid); bgGridRef.current = bgGrid;
  const paletteRef = useRef(palette); paletteRef.current = palette;
  const isAdminRef = useRef(isAdmin); isAdminRef.current = isAdmin;
  const selectedIdsRef = useRef(selectedIds); selectedIdsRef.current = selectedIds;
  const draggingRef = useRef(dragging); draggingRef.current = dragging;
  const resizingRef = useRef(resizing); resizingRef.current = resizing;
  const rotatingRef = useRef(rotating); rotatingRef.current = rotating;
  const editingConnectorRef = useRef(editingConnector); editingConnectorRef.current = editingConnector;
  const multiSelectModeRef = useRef(multiSelectMode); multiSelectModeRef.current = multiSelectMode;
  const globalShadowRef = useRef(globalShadow); globalShadowRef.current = globalShadow;
  const editingTextIdRef = useRef(editingTextId); editingTextIdRef.current = editingTextId;

  const effectiveSnap = snapOn || shiftHeld;
  const effectiveSnapRef = useRef(effectiveSnap); effectiveSnapRef.current = effectiveSnap;

  // ── Viewport ──
  const vp = useViewport();
  const { canvasRef, canvasHandlesRef, drawBgRef, posDisplayRef, zoomDisplayRef, applyTransform, updateDisplays, viewCenter, zoomTo, animateTo, goHome, setHome } = vp;

  // ── WebGL renderer ──
  const webgl = useWebGLCanvas();

  // Wire up WebGL render trigger — called on every viewport change (pan/zoom/resize)
  useEffect(() => {
    drawBgRef.current = () => {
      webgl.renderSync({
        items: itemsRef.current,
        panX: vp.panRef.current.x,
        panY: vp.panRef.current.y,
        zoom: vp.zoomRef.current,
        bgGrid: bgGridRef.current,
        globalShadow: globalShadowRef.current,
        selectedIds: selectedIdsRef.current,
        editingTextId: editingTextIdRef.current,
      });
    };
    drawBgRef.current();
  }, []);

  // Re-render when state changes that affect WebGL output
  useEffect(() => {
    if (drawBgRef.current) drawBgRef.current();
  }, [bgGrid, items, selectedIds, globalShadow, editingTextId]);

  // Re-render on viewport container resize
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => { if (drawBgRef.current) drawBgRef.current(); });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Continuous render for video items (need to update video textures each frame)
  useEffect(() => {
    const hasVideo = items.some(i => i.type === 'video');
    if (!hasVideo) return;
    let running = true;
    const loop = () => {
      if (!running) return;
      if (drawBgRef.current) drawBgRef.current();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    return () => { running = false; };
  }, [items]);

  // ── Load board on mount ──
  useEffect(() => {
    loadBoard().then(({ items: loaded, bgGrid: savedGrid, homeView: savedHome, palette: savedPalette }) => {
      if (savedGrid) setBgGrid(savedGrid);
      if (savedPalette) setPalette(savedPalette);
      if (savedHome) vp.homeViewRef.current = savedHome;
      const migrated = loaded.map(item => {
        let out = { ...item, rotation: item.rotation || 0 };
        if (item.type === "connector" && item.elbow !== undefined) {
          const midY = ((item.y1 ?? 0) + (item.y2 ?? 0)) / 2;
          out = { ...out, elbowX: item.elbow, elbowY: midY, orientation: "h" };
          delete out.elbow;
        }
        if (item.type === "connector" && out.orientation === undefined) {
          out = { ...out, elbowX: out.elbowX ?? ((out.x1 + out.x2) / 2), elbowY: out.elbowY ?? ((out.y1 + out.y2) / 2), orientation: "h" };
        }
        return out;
      });
      // Set pan/zoom before setLoading so the first canvas render uses correct values
      const w = window.innerWidth, h = window.innerHeight;
      if (savedHome) {
        vp.panRef.current = { x: w / 2 - savedHome.x * savedHome.zoom, y: h / 2 - savedHome.y * savedHome.zoom };
        vp.zoomRef.current = savedHome.zoom;
      } else {
        vp.panRef.current = { x: w / 2, y: h / 2 };
        vp.zoomRef.current = 1;
      }
      setItems(migrated);
      setLoading(false);
    });
  }, []);

  // ── Persist settings ──
  useEffect(() => { try { localStorage.setItem("lutz-shadow-settings", JSON.stringify(globalShadow)); } catch {} }, [globalShadow]);
  // bgGrid and palette changes trigger a board save (defined after scheduleSave below)

  // Close color picker on outside click
  useEffect(() => {
    if (!colorPicker) return;
    const close = (ev) => { if (!ev?.target?.closest("[data-ui]")) setColorPicker(null); };
    const t = setTimeout(() => window.addEventListener("pointerdown", close), 0);
    return () => { clearTimeout(t); window.removeEventListener("pointerdown", close); };
  }, [colorPicker !== null]);

  // Sync handles transform on selection change
  useEffect(() => { applyTransform(); }, [selectedIds, applyTransform]);

  // Exit multi-select mode when nothing is selected
  useEffect(() => {
    if (multiSelectMode && selectedIds.length === 0) setMultiSelectMode(false);
  }, [selectedIds.length, multiSelectMode]);

  // ── Save helpers ──
  const scheduleSave = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      setSaveStatus("saving");
      const ok = await saveBoard(itemsRef.current, bgGridRef.current, vp.homeViewRef.current, paletteRef.current);
      setSaveStatus(ok ? "saved" : "error");
      setTimeout(() => setSaveStatus(""), 2000);
    }, 2000);
  }, []);

  // Persist bgGrid and palette with board data when they change (skip during initial load)
  useEffect(() => {
    if (loading || !isAdmin) return;
    scheduleSave();
  }, [bgGrid]);

  useEffect(() => {
    if (loading || !isAdmin) return;
    scheduleSave();
  }, [palette]);


  const { setItemsWithUndo: setItemsAndSave, undo, redo, canUndo, canRedo, pushUndo } = useUndo(setItems, scheduleSave, isAdmin);

  // ── Item CRUD ──
  const maxZ = (arr) => { const a = arr || items; return a.length ? Math.max(...a.map(i => i.z)) : 0; };
  const updateItem = (id, updates) => setItemsAndSave(p => p.map(i => i.id === id ? { ...i, ...updates } : i));
  // Mipmap updater: displaySrc/placeholderSrc/targetSrc changes are silent (no save),
  // but srcQ50/srcQ25/srcQ12/srcQ6 trigger a save
  const updateItemMipmap = useCallback((id, updates) => {
    const hasMipmapUrls = updates.srcQ50 !== undefined || updates.srcQ25 !== undefined || updates.srcQ12 !== undefined || updates.srcQ6 !== undefined;
    if (hasMipmapUrls) {
      // Persist mipmap URLs to the board (but no undo entry)
      setItems(p => p.map(i => i.id === id ? { ...i, ...updates } : i));
      scheduleSave();
    } else {
      // displaySrc/placeholderSrc/targetSrc changes — ephemeral, no save needed
      setItems(p => p.map(i => i.id === id ? { ...i, ...updates } : i));
    }
  }, [scheduleSave]);

  // MIP mapping — lazy generation + tier selection
  useMipmap(items, updateItemMipmap, vp);

  const updateItems = (ids, updates) => setItemsAndSave(p => p.map(i => ids.includes(i.id) ? { ...i, ...updates } : i));
  const deleteItems = (ids) => { setItemsAndSave(p => p.filter(i => !ids.includes(i.id))); setSelectedIds(prev => prev.filter(id => !ids.includes(id))); };
  const groupSelected = () => { if (selectedIds.length < 2) return; const gid = uid(); setItemsAndSave(p => p.map(i => selectedIds.includes(i.id) ? { ...i, groupId: gid } : i)); };
  const ungroupSelected = () => setItemsAndSave(p => p.map(i => selectedIds.includes(i.id) ? { ...i, groupId: undefined } : i));
  const bringToFront = () => setItemsAndSave(prev => {
    const others = prev.filter(i => !selectedIds.includes(i.id));
    const mZ = others.length ? Math.max(...others.map(i => i.z)) : 0;
    const sel = prev.filter(i => selectedIds.includes(i.id)).sort((a, b) => a.z - b.z);
    const zMap = Object.fromEntries(sel.map((item, idx) => [item.id, mZ + 1 + idx]));
    return prev.map(i => selectedIds.includes(i.id) ? { ...i, z: zMap[i.id] } : i);
  });
  const sendToBack = () => setItemsAndSave(prev => {
    const others = prev.filter(i => !selectedIds.includes(i.id));
    const mZ = others.length ? Math.min(...others.map(i => i.z)) : 0;
    const sel = prev.filter(i => selectedIds.includes(i.id)).sort((a, b) => a.z - b.z);
    const zMap = Object.fromEntries(sel.map((item, idx) => [item.id, mZ - sel.length + idx]));
    return prev.map(i => selectedIds.includes(i.id) ? { ...i, z: zMap[i.id] } : i);
  });

  const handleCopySelected = useCallback(() => {
    const toCopy = items.filter(i => selectedIds.includes(i.id));
    if (!toCopy.length) return;
    setClipboard(toCopy.map(i => ({ ...i, id: uid() })));
  }, [items, selectedIds]);

  const handlePasteClipboard = useCallback(() => {
    if (!clipboard.length) return;
    const c = viewCenter();
    const mZ = items.length ? Math.max(...items.map(i => i.z)) : 0;
    // Compute centroid of clipboard items to preserve relative layout on paste
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
        return { ...item, id: uid(), groupId: newGroupId, x1: (item.x1 ?? 0) + dx, y1: (item.y1 ?? 0) + dy, x2: (item.x2 ?? 0) + dx, y2: (item.y2 ?? 0) + dy, elbowX: (item.elbowX ?? ((item.x1 + item.x2) / 2)) + dx, elbowY: (item.elbowY ?? ((item.y1 + item.y2) / 2)) + dy, z: mZ + 1 + idx };
      }
      return { ...item, id: uid(), groupId: newGroupId, x: (item.x ?? 0) + dx, y: (item.y ?? 0) + dy, z: mZ + 1 + idx };
    });
    setItemsAndSave(p => [...p, ...pasted]);
    setSelectedIds(pasted.map(i => i.id));
  }, [clipboard, items, viewCenter, setItemsAndSave]);

  const handleDeleteSelected = useCallback(() => {
    if (!selectedIds.length) return;
    deleteItems(selectedIds);
  }, [selectedIds]);

  const handleLogin = async () => {
    const result = await login(password);
    if (result === true) { setIsAdmin(true); setShowLogin(false); setPassword(""); setLoginError(false); setRateLimited(null); }
    else if (result && result.rateLimited) { setRateLimited(result.retryAfter); setLoginError(false); }
    else setLoginError(true);
  };

  // ── Input hooks ──
  const { handlePointerDown } = usePointerInput({
    vp, items, setItems, selectedIds, setSelectedIds, isAdmin,
    draggingRef, setDragging, resizingRef, setResizing,
    rotatingRef, setRotating, editingConnectorRef, setEditingConnector,
    setEditingTextId, effectiveSnapRef, scheduleSave, animateTo, pushUndo,
    doHitTest: webgl.doHitTest,
  });

  useTouchInput({
    vp, loading, itemsRef, isAdminRef, selectedIdsRef,
    setItems, setSelectedIds, setEditingTextId,
    setDragging, draggingRef, effectiveSnapRef,
    scheduleSave, animateTo, pushUndo,
    multiSelectModeRef, setMultiSelectMode,
    doHitTest: webgl.doHitTest,
  });

  useKeyboard({
    isAdmin, selectedIds, setSelectedIds, clipboard, setClipboard,
    items, setItemsAndSave, editingTextId, setEditingTextId,
    viewCenter, setShiftHeld, undo, redo,
  });

  // ── Image upload (all conversion handled server-side) ──

  const fitTo512 = (natW, natH) => {
    const MAX = 512;
    if (natW <= MAX && natH <= MAX) return { w: natW, h: natH };
    const scale = Math.min(MAX / natW, MAX / natH);
    return { w: Math.round(natW * scale), h: Math.round(natH * scale) };
  };

  // Load image dimensions and add to canvas, fitting to 512px max
  const addImageToCanvas = (url, opts = {}) => {
    const { id: existingId, onError } = opts;
    const id = existingId || uid();
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const fit = fitTo512(img.width, img.height);
        const w = snap(fit.w, true), h = snap(fit.h, true);
        const c = viewCenter();
        if (existingId) {
          setItemsAndSave(p => p.map(i => i.id === id ? { ...i, w, h, naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight, x: snap(c.x - w / 2, true), y: snap(c.y - h / 2, true) } : i));
        } else {
          setItemsAndSave(p => [...p, { id, type: "image", src: url, x: snap(c.x - w / 2, true), y: snap(c.y - h / 2, true), w, h, naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight, z: maxZ(p) + 1, radius: 2, rotation: 0 }]);
        }
        resolve(id);
      };
      img.onerror = (e) => { if (onError) onError(); reject(e); };
      img.src = url;
    });
  };

  const handleFilesRef = useRef(null);

  const handleFiles = async (files) => {
    files = Array.from(files);
    if (!files.length) return;
    const total = files.length;
    let done = 0;
    let hadError = false;
    setUploadStatus(`Uploading 0/${total}...`);

    const CONCURRENT_UPLOADS = 4;
    for (let i = 0; i < files.length; i += CONCURRENT_UPLOADS) {
      const batch = files.slice(i, i + CONCURRENT_UPLOADS);
      await Promise.all(batch.map(async (file) => {
        try {
          if (isVideoFile(file)) {
            setUploadStatus(`Converting video${total > 1 ? ` (${done + 1}/${total})` : ''}...`);
            const { blob, width, height } = await convertVideoToWebm(file, (progress) => {
              setUploadStatus(`Converting video ${Math.round(progress * 100)}%${total > 1 ? ` (${done + 1}/${total})` : ''}`);
            });
            setUploadStatus(`Uploading video${total > 1 ? ` (${done + 1}/${total})` : ''}...`);
            const webmFilename = file.name.replace(/\.[^.]+$/, '.webm');
            const { url } = await uploadVideo(blob, webmFilename);
            const fit = fitTo512(width, height);
            const w = snap(fit.w, true), h = snap(fit.h, true);
            const c = viewCenter();
            setItemsAndSave(p => [...p, {
              id: uid(), type: "video", src: url,
              x: snap(c.x - w / 2, true), y: snap(c.y - h / 2, true),
              w, h, naturalWidth: width, naturalHeight: height,
              z: maxZ(p) + 1, radius: 2, rotation: 0,
            }]);
          } else {
            const isGif = file.type === "image/gif";
            const { url } = await uploadImage(file);
            if (isGif) {
              const id = uid();
              const c = viewCenter();
              const defaultW = snap(320, true), defaultH = snap(240, true);
              setItemsAndSave(p => [...p, { id, type: "image", src: url, x: snap(c.x - defaultW / 2, true), y: snap(c.y - defaultH / 2, true), w: defaultW, h: defaultH, z: maxZ(p) + 1, radius: 2, rotation: 0 }]);
              addImageToCanvas(url, { id });
            } else {
              await addImageToCanvas(url);
            }
          }
          done++;
          setUploadStatus(`Uploading ${done}/${total}...`);
        } catch (err) {
          hadError = true;
          done++;
          setUploadStatus(err.message || "Upload failed");
        }
      }));
    }

    if (!hadError) setUploadStatus("");
    else setTimeout(() => setUploadStatus(""), 4000);
  };

  handleFilesRef.current = handleFiles;

  const handleFileUpload = (e) => { handleFiles(e.target.files); e.target.value = ""; };

  // Clipboard paste (Ctrl-V) — images only, skip when typing in an input
  useEffect(() => {
    if (!isAdmin) return;
    const onPaste = (e) => {
      const tag = document.activeElement?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || document.activeElement?.isContentEditable) return;
      const imageFiles = Array.from(e.clipboardData?.items ?? [])
        .filter(item => item.kind === "file" && item.type.startsWith("image/"))
        .map(item => item.getAsFile())
        .filter(Boolean);
      if (!imageFiles.length) return;
      e.preventDefault();
      handleFilesRef.current(imageFiles);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [isAdmin]);

  // ── Item creation ──
  const addText = () => {
    const c = viewCenter();
    const item = { id: uid(), type: "text", x: snap(c.x - 104, true), y: snap(c.y - 24, true), w: 208, h: 48, z: maxZ() + 1, rotation: 0,
      text: "Dolor ipsum per existentiam manet, sed creatio vulneribus insanabilibus medetur.", placeholder: true, fontSize: 24, fontFamily: FONTS[0].value,
      color: "#C2C0B6", bgColor: "transparent", radius: 0, bold: false, italic: false, align: "left" };
    setItemsAndSave(p => [...p, item]); setSelectedIds([item.id]);
  };

  const addLink = () => {
    const c = viewCenter();
    const item = { id: uid(), type: "link", x: snap(c.x - 80, true), y: snap(c.y - 24, true), w: 160, h: 48, z: maxZ() + 1, rotation: 0,
      text: "Click me", url: "https://", fontSize: 15, fontFamily: FONTS[0].value,
      color: "#141413", bgColor: "#2C84DB", radius: 8, bold: true, italic: false, align: "center" };
    setItemsAndSave(p => [...p, item]); setSelectedIds([item.id]);
  };

  const addShape = (preset) => {
    const c = viewCenter();
    const item = { id: uid(), type: "shape", x: snap(c.x - preset.w / 2, true), y: snap(c.y - preset.h / 2, true),
      w: preset.w, h: preset.h, z: maxZ() + 1, rotation: 0, bgColor: "#262624", radius: preset.radius ?? 4, borderColor: "transparent", borderWidth: 0 };
    setItemsAndSave(p => [...p, item]); setSelectedIds([item.id]);
  };

  const addConnector = () => {
    const c = viewCenter();
    const item = { id: uid(), type: "connector", z: maxZ() + 1,
      x1: snap(c.x - 80, effectiveSnap), y1: snap(c.y - 40, effectiveSnap),
      x2: snap(c.x + 80, effectiveSnap), y2: snap(c.y + 40, effectiveSnap),
      elbowX: snap(c.x, effectiveSnap), elbowY: snap(c.y, effectiveSnap),
      orientation: "h", roundness: 20, lineWidth: 2, lineColor: "#C2C0B6",
      dot1: true, dot2: true, dotColor: "#C2C0B6", dotRadius: 5 };
    setItemsAndSave(p => [...p, item]); setSelectedIds([item.id]);
  };

  const handleAddImageUrl = () => {
    const url = prompt("Enter image URL:");
    if (url) {
      const isGif = /\.gif(\?|$)/i.test(url);
      const onError = () => { setUploadStatus(`Failed to load ${isGif ? "GIF" : "image"} from URL`); setTimeout(() => setUploadStatus(""), 4000); };
      if (isGif) {
        const id = uid();
        const c = viewCenter();
        const defaultW = snap(320, true), defaultH = snap(240, true);
        setItemsAndSave(p => [...p, { id, type: "image", src: url, x: snap(c.x - defaultW / 2, true), y: snap(c.y - defaultH / 2, true), w: defaultW, h: defaultH, z: maxZ(p) + 1, radius: 2, rotation: 0 }]);
        addImageToCanvas(url, { id, onError });
      } else {
        addImageToCanvas(url, { onError });
      }
    }
  };

  // ── Board import/export/cleanup ──
  const handleFullBackup = useCallback(async () => {
    setUploadStatus("Preparing backup...");
    try {
      const { board, images } = await getBackupManifest();
      setUploadStatus(`Downloading ${images.length} image${images.length !== 1 ? 's' : ''}...`);
      const { zipBlob, downloaded, failed } = await createBackupZip(board, images, downloadImageViaProxy, (done, total) => {
        setUploadStatus(`Downloading images ${done}/${total}...`);
      });
      const date = new Date().toISOString().slice(0, 10);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(zipBlob);
      a.download = `lutz-board-backup-${date}.zip`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      setUploadStatus(failed > 0 ? `Backup done (${downloaded} images, ${failed} failed)` : `Backup done (${downloaded} images)`);
    } catch (err) {
      console.error("Backup failed:", err);
      setUploadStatus("Backup failed");
    }
    setTimeout(() => setUploadStatus(""), 4000);
  }, []);

  const importBoard = (e) => {
    const file = e.target.files[0]; if (!file) return;
    e.target.value = "";

    if (file.name.endsWith('.zip') || file.type === 'application/zip' || file.type === 'application/x-zip-compressed') {
      if (!confirm("Restore from backup ZIP? This will replace the current board and re-upload all images to R2.")) return;
      setUploadStatus("Restoring backup...");
      restoreFromZip(file, restoreImageKey, (done, total) => {
        setUploadStatus(`Restoring images ${done}/${total}...`);
      }).then(({ board, restored, failed, total }) => {
        const migrated = (board.items || []).map(item => ({ ...item, rotation: item.rotation || 0 }));
        setItemsAndSave(migrated);
        if (board.palette && Array.isArray(board.palette)) setPalette(board.palette);
        if (board.bgGrid) setBgGrid(board.bgGrid);
        if (board.homeView) vp.homeViewRef.current = board.homeView;
        setTimeout(() => goHome(), 100);
        setUploadStatus(failed > 0 ? `Restored! ${restored}/${total} images (${failed} failed)` : `Restored! ${restored} images`);
        setTimeout(() => setUploadStatus(""), 5000);
      }).catch(err => {
        console.error("Restore failed:", err);
        setUploadStatus(`Restore failed: ${err.message}`);
        setTimeout(() => setUploadStatus(""), 5000);
      });
      return;
    }

    // Legacy JSON import
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const d = JSON.parse(ev.target.result);
        const rawItems = Array.isArray(d) ? d : d?.items;
        if (!Array.isArray(rawItems)) { alert("Invalid board file"); return; }
        const migrated = rawItems.map(item => ({ ...item, rotation: item.rotation || 0 }));
        setItemsAndSave(migrated);
        if (d?.palette && Array.isArray(d.palette)) setPalette(d.palette);
        setTimeout(() => goHome(), 100);
      } catch (err) { alert("Invalid board file"); }
    };
    reader.readAsText(file);
  };

  const handleCleanup = async () => {
    setUploadStatus("Cleaning up...");
    try { const result = await cleanupFiles(items); setUploadStatus(`Cleaned ${result.deleted || 0} files`); }
    catch { setUploadStatus("Cleanup failed"); }
    setTimeout(() => setUploadStatus(""), 3000);
  };

  const resizeImage = async (imageItems, scale) => {
    const list = Array.isArray(imageItems) ? imageItems : [imageItems];
    const total = list.length;
    let done = 0;
    setUploadStatus(`Resizing 0/${total}...`);
    let hadError = false;
    for (const item of list) {
      try {
        const { url } = await serverResize(item.src, scale);
        updateItem(item.id, {
          src: url,
          originalSrc: item.originalSrc || item.src,
          // Stash old mipmaps so revert can restore them
          originalSrcQ50: item.originalSrcQ50 || item.srcQ50 || null,
          originalSrcQ25: item.originalSrcQ25 || item.srcQ25 || null,
          originalSrcQ12: item.originalSrcQ12 || item.srcQ12 || null,
          originalSrcQ6: item.originalSrcQ6 || item.srcQ6 || null,
          // Clear mipmaps — new ones will auto-generate for resized src
          srcQ50: null, srcQ25: null, srcQ12: null, srcQ6: null,
          displaySrc: null, placeholderSrc: null, targetSrc: null,
        });
        done++;
        setUploadStatus(`Resizing ${done}/${total}...`);
      } catch (err) {
        console.error("Resize failed:", err);
        hadError = true;
        done++;
      }
    }
    setUploadStatus(hadError ? "Some resizes failed" : `Resized ${total} to ${Math.round(scale * 100)}%`);
    setTimeout(() => setUploadStatus(""), 3000);
  };

  const updatePaletteColor = (index, newColor) => {
    const oldColor = palette[index];
    setPalette(p => p.map((x, j) => j === index ? newColor : x));
    if (oldColor === newColor) return;
    setItemsAndSave(prev => prev.map(item => {
      const updates = {};
      for (const prop of COLOR_PROPS) { if (item[prop] === oldColor) updates[prop] = newColor; }
      return Object.keys(updates).length ? { ...item, ...updates } : item;
    }));
  };

  const openColorPicker = (e, value, onChange) => {
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    setColorPicker({ x: Math.min(rect.left, window.innerWidth - 190), bottomY: window.innerHeight - rect.top + 6, value, onChange });
  };

  const sortedItems = useMemo(() => [...items].sort((a, b) => a.z - b.z), [items]);

  // ── Loading screen ──
  if (loading) return (
    <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#141413", color: "rgba(194,192,182,0.3)", fontFamily: FONT, fontSize: 14 }}>Loading board...</div>
  );

  // ── Main render ──
  return (
    <div
      style={{ width: "100%", height: "100%", overflow: "hidden", position: "relative", isolation: "isolate", background: bgGrid.bgColor, fontFamily: FONT, userSelect: "none" }}
      onDragOver={(e) => { if (isAdmin) e.preventDefault(); }}
      onDrop={(e) => {
        if (!isAdmin) return;
        e.preventDefault();
        const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith("image/") || f.type.startsWith("video/"));
        if (files.length) handleFilesRef.current(files);
      }}
    >
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet" />

      {/* Canvas */}
      <div ref={canvasRef} onPointerDown={handlePointerDown}
        style={{ width: "100%", height: "100%", cursor: dragging ? "move" : rotating ? "grabbing" : "grab", position: "relative", overflow: "hidden", touchAction: "none", zIndex: Z.CANVAS, isolation: "isolate" }}>

        {/* WebGL canvas — renders grid + all content items */}
        <canvas ref={webgl.setCanvasRef} style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", pointerEvents: "none" }} />

        {/* Text editing overlay — positioned over the text item being edited */}
        {editingTextId && (() => {
          const item = items.find(i => i.id === editingTextId);
          if (!item || (item.type !== 'text' && item.type !== 'link')) return null;
          const z = vp.zoomRef.current;
          const px = item.x * z + vp.panRef.current.x;
          const py = item.y * z + vp.panRef.current.y;
          const sw = item.w * z;
          const sh = item.h * z;
          const applyBg = (!item.bgColor || item.bgColor === 'transparent' || (item.bgOpacity ?? 1) <= 0)
            ? 'rgba(194,192,182,0.05)' : (item.bgOpacity ?? 1) >= 1 ? item.bgColor
            : `rgba(${parseInt(item.bgColor.slice(1,3),16)},${parseInt(item.bgColor.slice(3,5),16)},${parseInt(item.bgColor.slice(5,7),16)},${item.bgOpacity})`;
          return (
            <textarea data-ui autoFocus value={item.text}
              onFocus={() => { if (item.placeholder) updateItem(item.id, { text: "", placeholder: false }); }}
              onChange={e => updateItem(item.id, { text: e.target.value })}
              onBlur={() => setEditingTextId(null)}
              onPointerDown={e => e.stopPropagation()}
              onTouchStart={e => e.stopPropagation()}
              style={{
                position: "absolute", left: px, top: py, width: sw, height: sh,
                transform: `rotate(${item.rotation || 0}deg)`, transformOrigin: "0 0",
                resize: "none", border: "none", outline: "2px solid rgba(44,132,219,0.7)",
                touchAction: "auto", background: applyBg,
                color: item.color, fontSize: (item.fontSize || 24) * z,
                fontFamily: item.fontFamily || "'DM Sans', sans-serif",
                fontWeight: item.bold ? "bold" : "normal", fontStyle: item.italic ? "italic" : "normal",
                textAlign: item.align || "left", padding: `${8*z}px ${12*z}px`, boxSizing: "border-box",
                zIndex: Z.HANDLES + 1,
              }} />
          );
        })()}

        {isAdmin && (
          <div style={{ position: "absolute", top: 0, left: 0, zIndex: Z.HANDLES, pointerEvents: "none" }}>
            <div ref={canvasHandlesRef} style={{ transform: `translate(${vp.panRef.current.x}px,${vp.panRef.current.y}px) scale(${vp.zoomRef.current})`, transformOrigin: "0 0" }}>
              {sortedItems.map(item => <CanvasItem key={item.id} item={item} renderHandles={true} selectedIds={selectedIds} isAdmin={isAdmin} editingTextId={editingTextId} globalShadow={globalShadow} deleteItems={deleteItems} updateItem={updateItem} setEditingTextId={setEditingTextId} />)}
              {(() => {
                if (selectedIds.length < 2) return null;
                const selItems = items.filter(i => selectedIds.includes(i.id));
                const gid = selItems[0]?.groupId;
                if (!gid || !selItems.every(i => i.groupId === gid)) return null;
                const pad = 10;
                const bounds = selItems.map(i => i.type === "connector"
                  ? { x: Math.min(i.x1, i.x2, i.elbowX ?? (i.x1+i.x2)/2), y: Math.min(i.y1, i.y2), r: Math.max(i.x1, i.x2, i.elbowX ?? (i.x1+i.x2)/2), b: Math.max(i.y1, i.y2) }
                  : { x: i.x, y: i.y, r: i.x + i.w, b: i.y + i.h });
                const minX = Math.min(...bounds.map(b => b.x)) - pad;
                const minY = Math.min(...bounds.map(b => b.y)) - pad;
                const maxX = Math.max(...bounds.map(b => b.r)) + pad;
                const maxY = Math.max(...bounds.map(b => b.b)) + pad;
                return <div style={{ position: "absolute", left: minX, top: minY, width: maxX - minX, height: maxY - minY, border: "1px dashed rgba(44,132,219,0.3)", borderRadius: 6, pointerEvents: "none" }} />;
              })()}
            </div>
          </div>
        )}

        {items.length === 0 && (
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 12, color: "rgba(194,192,182,0.15)", pointerEvents: "none" }}>
            <div style={{ fontSize: 48, fontWeight: 700, letterSpacing: "-0.02em" }}>infgrid.com</div>
            <div style={{ fontSize: 14 }}>{isAdmin ? "Upload images or add items" : "Nothing here yet"}</div>
          </div>
        )}
      </div>

      {/* Zoom controls */}
      <div data-ui style={{ position: "absolute", bottom: "calc(16px + env(safe-area-inset-bottom, 0px))", left: "calc(16px + env(safe-area-inset-left, 0px))", zIndex: Z.UI, ...tbSurface }}>
        <button onClick={() => zoomTo(vp.zoomRef.current * 1.3)} style={tbBtn}><ZoomInIcon /></button>
        <button onClick={() => zoomTo(vp.zoomRef.current / 1.3)} style={tbBtn}><ZoomOutIcon /></button>
        <button onClick={goHome} title="Home view" style={tbBtn}><HomeIcon /></button>
        {isAdmin && <button onClick={() => setSnapOn(!snapOn)} title={snapOn ? "Grid snap ON" : "Grid snap OFF"} style={snapOn ? { ...tbBtn, background: "rgba(44,132,219,0.12)", color: "#2C84DB" } : tbBtn}><GridIcon /></button>}
        <div style={tbSep} />
        <button ref={zoomDisplayRef} onClick={() => {
          const rect = canvasRef.current.getBoundingClientRect();
          const cx = (rect.width / 2 - vp.panRef.current.x) / vp.zoomRef.current;
          const cy = (rect.height / 2 - vp.panRef.current.y) / vp.zoomRef.current;
          animateTo({ x: rect.width / 2 - cx, y: rect.height / 2 - cy }, 1, 500);
        }} style={{ padding: "0 9px", ...infoText, background: "none", border: "none", cursor: "pointer" }}>100%</button>
      </div>

      {/* Coordinates display */}
      <div ref={posDisplayRef} data-ui style={{ position: "absolute", bottom: "calc(16px + env(safe-area-inset-bottom, 0px))", right: "calc(16px + env(safe-area-inset-right, 0px))", zIndex: Z.UI, ...tbSurface, padding: "0 10px", height: 36, ...infoText }}>X 0   Y 0</div>

      {/* Left panel — Copy/Paste/Delete · Undo/Redo · Selection/Group, stacked */}
      {isAdmin && (() => {
        const selItems = items.filter(i => selectedIds.includes(i.id));
        const gid = selItems[0]?.groupId;
        const isGroup = !!(gid && selItems.every(i => i.groupId === gid));
        return (
          <div data-ui style={{ position: "absolute", top: "calc(16px + env(safe-area-inset-top, 0px))", left: "calc(16px + env(safe-area-inset-left, 0px))", zIndex: Z.UI }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <div style={tbSurface}>
                <button onClick={handleCopySelected} title="Copy" style={{ ...tbBtn, color: selectedIds.length > 0 ? "#6e6e6e" : "#2a2a2a" }}><CopyIcon /></button>
                <button onClick={handlePasteClipboard} title="Paste" style={{ ...tbBtn, color: clipboard.length > 0 ? "#6e6e6e" : "#2a2a2a" }}><PasteIcon /></button>
                <button onClick={handleDeleteSelected} title="Delete" style={{ ...tbBtn, color: selectedIds.length > 0 ? "#FE8181" : "#262624" }}><TrashIcon /></button>
              </div>
              <div style={tbSurface}>
                <button onClick={undo} title="Undo (Ctrl+Z)" style={{ ...tbBtn, color: canUndo() ? "#6e6e6e" : "#2a2a2a", pointerEvents: canUndo() ? "auto" : "none" }}><UndoIcon /></button>
                <button onClick={redo} title="Redo (Ctrl+Shift+Z)" style={{ ...tbBtn, color: canRedo() ? "#6e6e6e" : "#2a2a2a", pointerEvents: canRedo() ? "auto" : "none" }}><RedoIcon /></button>
                <div style={{ ...tbBtn, position: "relative", pointerEvents: "none" }}>
                  <FloppyIcon style={{ color: "#262624" }} />
                  <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center",
                    opacity: saveStatus === "saved" || saveStatus === "error" ? 1 : 0,
                    transition: saveStatus === "saved" || saveStatus === "error" ? "opacity 0.2s ease" : "opacity 0.6s ease 0.3s",
                    color: saveStatus === "error" ? "#FE8181" : "#65BB30" }}>
                    <FloppyIcon />
                  </div>
                </div>
              </div>
              {selectedIds.length > 0 && (
                <div style={{ ...tbSurface, display: "grid", gridTemplateColumns: "32px 32px", gap: 1, placeItems: "center" }}>
                  <span style={{ ...tbBtn, cursor: "default", pointerEvents: "none", fontSize: 12, fontWeight: 600 }}>{selectedIds.length}</span>
                  {selectedIds.length >= 2 && !isGroup
                    ? <button onClick={groupSelected} title="Group" style={{ ...tbBtn, color: "#6e6e6e" }}><GroupIcon size={16} /></button>
                    : isGroup
                      ? <button onClick={ungroupSelected} title="Ungroup" style={{ ...tbBtn, color: "#6e6e6e" }}><UngroupIcon size={16} /></button>
                      : <span />}
                  <button onClick={bringToFront} title="Bring to Front" style={{ ...tbBtn, color: "#6e6e6e" }}><BringFrontIcon /></button>
                  <button onClick={sendToBack} title="Send to Back" style={{ ...tbBtn, color: "#6e6e6e" }}><SendBackIcon /></button>
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* Upload status pill */}
      {isAdmin && uploadStatus && (
        <div style={{ position: "absolute", bottom: "calc(16px + env(safe-area-inset-bottom, 0px))", left: "50%", transform: "translateX(-50%)", zIndex: Z.UI, background: UI_BG, border: UI_BORDER, borderRadius: 20, padding: "4px 14px", fontSize: 11, fontFamily: FONT, letterSpacing: "0.02em", color: "rgba(194,192,182,0.38)" }}>
          {uploadStatus}
        </div>
      )}

      <Toolbar
        isAdmin={isAdmin}
        onAddText={addText} onAddLink={addLink} onAddShape={addShape} onAddConnector={addConnector}
        onFileUpload={handleFileUpload} onAddImageUrl={handleAddImageUrl}
        onExportBoard={handleFullBackup} onImportBoard={importBoard} onCleanup={handleCleanup}
        onLock={() => { logout(); setIsAdmin(false); setSelectedIds([]); setEditingTextId(null); }}
        onShowLogin={() => setShowLogin(true)}
        snapOn={snapOn} setSnapOn={setSnapOn}
        globalShadow={globalShadow} setGlobalShadow={setGlobalShadow}
        palette={palette} setPalette={setPalette} updatePaletteColor={updatePaletteColor}
        bgGrid={bgGrid} setBgGrid={setBgGrid}
        onSetHome={() => { setHome(); scheduleSave(); }}
        fileInputRef={fileInputRef} boardFileRef={boardFileRef}
      />

      {settingTeleport && (
        <div data-ui style={{ position: "absolute", top: 16, left: "50%", transform: "translateX(-50%)", zIndex: Z.TELEPORT, ...tbSurface, padding: "6px 12px", gap: 8 }}>
          <span style={{ color: "rgba(194,192,182,0.45)", fontSize: 11, whiteSpace: "nowrap" }}>Pan to destination</span>
          <button data-ui onClick={() => { updateItem(settingTeleport, { teleportPan: { ...vp.panRef.current }, teleportZoom: vp.zoomRef.current }); setSettingTeleport(null); }}
            style={{ ...togBtn, width: "auto", padding: "3px 12px", fontSize: 11, background: "rgba(194,192,182,0.15)" }}>Apply</button>
          <button data-ui onClick={() => setSettingTeleport(null)}
            style={{ ...togBtn, width: "auto", padding: "3px 10px", fontSize: 11 }}>Cancel</button>
        </div>
      )}

      <PropertiesPanel isAdmin={isAdmin} selectedIds={selectedIds} items={items} openColorPicker={openColorPicker} updateItems={updateItems} updateItem={updateItem} ungroupSelected={ungroupSelected} resizeImage={resizeImage} setUploadStatus={setUploadStatus} setSettingTeleport={setSettingTeleport} />

      <ColorPickerPopup colorPicker={colorPicker} setColorPicker={setColorPicker} palette={palette} />
      <LoginModal showLogin={showLogin} setShowLogin={setShowLogin} password={password} setPassword={setPassword} loginError={loginError} setLoginError={setLoginError} handleLogin={handleLogin} rateLimited={rateLimited} setRateLimited={setRateLimited} />
    </div>
  );
}
