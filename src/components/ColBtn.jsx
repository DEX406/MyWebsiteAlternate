const colInp = { width: 32, height: 32, border: "1px solid rgba(194,192,182,0.1)", borderRadius: 5, cursor: "pointer", padding: 0, background: "none" };

export default function ColBtn({ value, onChange, onOpen }) {
  return (
    <button
      data-ui
      onClick={e => onOpen(e, value === "transparent" ? "#000000" : value, onChange)}
      style={{ ...colInp, background: value === "transparent" ? "repeating-conic-gradient(#30302E 0% 25%, #1F1E1D 0% 50%) 0 0 / 8px 8px" : value }}
    />
  );
}
