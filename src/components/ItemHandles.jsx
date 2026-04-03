import { XIcon } from '../icons.jsx';
import { Z } from '../styles.js';

const HIT = 64;
const DOT = 9;
const ROD_LEN = 36;

const dotStyle = {
  width: DOT, height: DOT, borderRadius: '50%',
  background: '#C2C0B6', border: '1.5px solid rgba(44,132,219,0.85)',
};

const hitBase = {
  position: 'absolute', width: HIT, height: HIT,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  pointerEvents: 'auto', background: 'transparent', border: 'none', padding: 0,
};

function Handle({ item, handle, style, cursor }) {
  return (
    <div data-item-id={item.id} data-action="resize" data-handle={handle}
      style={{ ...hitBase, cursor, ...style }}>
      <div style={dotStyle} />
    </div>
  );
}

export function ItemHandles({ item, deleteItems }) {
  const half = HIT / 2;
  return (
    <div style={{
      position: 'absolute', left: item.x, top: item.y, width: item.w, height: item.h,
      zIndex: Z.HANDLE_GRIP, pointerEvents: 'none',
    }}>
      <div style={{
        position: 'absolute', inset: 0,
        transform: `rotate(${item.rotation || 0}deg)`,
        transformOrigin: 'center center',
      }}>
        {/* Bounding box */}
        <div style={{
          position: 'absolute', inset: -1,
          border: '1.5px solid rgba(44,132,219,0.7)',
          borderRadius: (item.radius ?? 2) + 1,
          pointerEvents: 'none',
        }} />

        {/* Rod from top-center to rotate knob */}
        <div style={{
          position: 'absolute', left: '50%', top: -(ROD_LEN + 1), width: 1.5,
          height: ROD_LEN, background: 'rgba(44,132,219,0.7)',
          transform: 'translateX(-50%)', pointerEvents: 'none',
        }} />

        {/* Rotate knob */}
        <div data-item-id={item.id} data-action="rotate" style={{
          ...hitBase,
          left: '50%', top: -(ROD_LEN + half + 6),
          transform: 'translateX(-50%)',
          cursor: 'grab',
        }}>
          <div style={{
            width: 14, height: 14, borderRadius: '50%',
            background: '#C2C0B6', boxShadow: '0 1px 4px rgba(0,0,0,0.25)',
            border: '1.5px solid rgba(44,132,219,0.85)',
          }} />
        </div>

        {/* 4 Corner handles */}
        <Handle item={item} handle="tl" cursor="nwse-resize"
          style={{ top: -half, left: -half }} />
        <Handle item={item} handle="tr" cursor="nesw-resize"
          style={{ top: -half, right: -half }} />
        <Handle item={item} handle="bl" cursor="nesw-resize"
          style={{ bottom: -half, left: -half }} />
        <Handle item={item} handle="br" cursor="nwse-resize"
          style={{ bottom: -half, right: -half }} />

        {/* 4 Edge midpoint handles */}
        <Handle item={item} handle="t" cursor="ns-resize"
          style={{ top: -half, left: '50%', transform: 'translateX(-50%)' }} />
        <Handle item={item} handle="b" cursor="ns-resize"
          style={{ bottom: -half, left: '50%', transform: 'translateX(-50%)' }} />
        <Handle item={item} handle="l" cursor="ew-resize"
          style={{ left: -half, top: '50%', transform: 'translateY(-50%)' }} />
        <Handle item={item} handle="r" cursor="ew-resize"
          style={{ right: -half, top: '50%', transform: 'translateY(-50%)' }} />

        {/* Delete button */}
        <button
          onPointerDown={e => { e.stopPropagation(); e.preventDefault(); deleteItems([item.id]); }}
          style={{
            ...hitBase,
            top: -49, right: -49, cursor: 'pointer',
          }}
        >
          <div style={{
            width: 22, height: 22,
            background: 'rgba(254,129,129,0.88)', borderRadius: '50%',
            color: '#C2C0B6', display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 1px 6px rgba(0,0,0,0.35)',
          }}>
            <XIcon size={12} />
          </div>
        </button>
      </div>
    </div>
  );
}
