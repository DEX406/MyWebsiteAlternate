import { tbBtn, tbSurface, infoText, Z } from '../styles.js';
import { GroupIcon } from '../icons.jsx';

export function SelectionBar({ selectedIds, items, groupSelected, ungroupSelected }) {
  if (selectedIds.length === 0) return null;

  const selItems = items.filter(i => selectedIds.includes(i.id));
  const gid = selItems[0]?.groupId;
  const isGroup = gid && selItems.every(i => i.groupId === gid);

  return (
    <div style={{ position: "absolute", top: "calc(56px + env(safe-area-inset-top, 0px))", left: "50%", transform: "translateX(-50%)", zIndex: Z.UI, display: "flex", alignItems: "center", gap: 1, ...tbSurface }}>
      <span style={{ padding: "0 10px", ...infoText, color: "rgba(194,192,182,0.45)" }}>
        {isGroup ? "group · " : ""}{selectedIds.length} selected
      </span>
      {selectedIds.length >= 2 && !isGroup && (
        <button onClick={groupSelected} title="Group" style={{ ...tbBtn, color: "rgba(194,192,182,0.55)" }}><GroupIcon size={16} /></button>
      )}
      {isGroup && (
        <button onClick={ungroupSelected} title="Ungroup" style={{ ...tbBtn, width: "auto", padding: "0 9px", fontSize: 10, color: "rgba(194,192,182,0.45)", letterSpacing: "0.04em" }}>Ungroup</button>
      )}
    </div>
  );
}
