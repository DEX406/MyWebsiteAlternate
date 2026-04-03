import { XIcon } from '../icons.jsx';
import { Z } from '../styles.js';

export function ConnectorHandles({ item, deleteItems }) {
  const { x1, y1, x2, y2, elbowX: elbowXRaw, elbowY: elbowYRaw, orientation } = item;
  const elbowX = elbowXRaw ?? (x1 + x2) / 2;
  const elbowY = elbowYRaw ?? (y1 + y2) / 2;
  const orient = orientation || "h";

  const midX = (x1 + x2) / 2;
  const midY = (y1 + y2) / 2;
  const handleX = orient === "h" ? elbowX : midX;
  const handleY = orient === "h" ? midY : elbowY;
  const delX = handleX + 18;
  const delY = handleY - 18;

  const hS = { position: "absolute", width: 18, height: 18, background: "transparent", border: "none", borderRadius: "50%", transform: "translate(-50%, -50%)", cursor: "move", pointerEvents: "auto" };
  const elbowHStyle = { position: "absolute", width: 10, height: 10, background: "#C2C0B6", border: "1.5px solid rgba(44,132,219,0.85)", borderRadius: "50%", transform: "translate(-50%, -50%)", cursor: "move", pointerEvents: "auto" };

  return (
    <div style={{ position: "absolute", left: 0, top: 0, width: 0, height: 0, zIndex: Z.HANDLE_GRIP, pointerEvents: "none" }}>
      <div data-item-id={item.id} data-action="move-ep1" style={{ ...hS, left: x1, top: y1 }} />
      <div data-item-id={item.id} data-action="move-ep2" style={{ ...hS, left: x2, top: y2 }} />
      <div data-item-id={item.id} data-action="move-elbow" style={{ ...elbowHStyle, left: handleX, top: handleY }} />
      <button onPointerDown={e => { e.stopPropagation(); e.preventDefault(); deleteItems([item.id]); }}
        style={{ position: "absolute", left: delX, top: delY, transform: "translate(-50%, -50%)", width: 22, height: 22, background: "rgba(254,129,129,0.88)", border: "none", borderRadius: "50%", color: "#C2C0B6", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 1px 6px rgba(0,0,0,0.35)", pointerEvents: "auto" }}>
        <XIcon size={12} />
      </button>
    </div>
  );
}
