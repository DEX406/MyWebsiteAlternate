import { buildConnectorPath } from '../connectorPath.js';

export function ConnectorItem({ item, isAdmin, isSel }) {
  const { x1, y1, x2, y2, elbowX: elbowXRaw, elbowY: elbowYRaw, orientation, roundness = 20, lineWidth = 2, lineColor = "#C2C0B6", dot1 = true, dot2 = true, dotColor = "#C2C0B6", dotRadius = 5, z } = item;
  const elbowX = elbowXRaw ?? (x1 + x2) / 2;
  const elbowY = elbowYRaw ?? (y1 + y2) / 2;
  const orient = orientation || "h";

  const pad = Math.max(lineWidth, dotRadius) + 10;
  const svgMinX = Math.min(x1, x2, elbowX) - pad;
  const svgMinY = Math.min(y1, y2, elbowY) - pad;
  const svgMaxX = Math.max(x1, x2, elbowX) + pad;
  const svgMaxY = Math.max(y1, y2, elbowY) + pad;
  const svgW = svgMaxX - svgMinX;
  const svgH = svgMaxY - svgMinY;

  const lx1 = x1 - svgMinX, ly1 = y1 - svgMinY;
  const lx2 = x2 - svgMinX, ly2 = y2 - svgMinY;
  const lex = elbowX - svgMinX, ley = elbowY - svgMinY;

  const d = buildConnectorPath(lx1, ly1, lx2, ly2, lex, ley, orient, roundness);
  const dGhost = isSel ? buildConnectorPath(lx1, ly1, lx2, ly2, lex, ley, orient === "h" ? "v" : "h", roundness) : null;

  return (
    <svg style={{ position: "absolute", left: svgMinX, top: svgMinY, overflow: "visible", zIndex: z }} width={svgW} height={svgH}>
      {dGhost && (
        <path d={dGhost} stroke={lineColor} strokeWidth={1.5} fill="none"
          strokeLinecap="round" strokeLinejoin="round"
          strokeDasharray="4 6" opacity={0.22}
          style={{ pointerEvents: "none" }} />
      )}
      <path d={d} stroke="transparent" strokeWidth={Math.max(16, lineWidth + 12)} fill="none"
        data-item-id={item.id} style={{ cursor: isAdmin ? "move" : "default", pointerEvents: isAdmin ? "stroke" : "none" }} />
      <path d={d} stroke={lineColor} strokeWidth={lineWidth} fill="none" strokeLinecap="round" strokeLinejoin="round" style={{ pointerEvents: "none" }} />
      {dot1 && <circle cx={lx1} cy={ly1} r={dotRadius} fill={dotColor} style={{ pointerEvents: "none" }} />}
      {dot2 && <circle cx={lx2} cy={ly2} r={dotRadius} fill={dotColor} style={{ pointerEvents: "none" }} />}
    </svg>
  );
}
