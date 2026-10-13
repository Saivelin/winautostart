import { getCurrentWindow } from "@tauri-apps/api/window";
import { Minus, Square, X } from "lucide-react";

/**
 * Custom title bar for the frameless window: drag-to-move (left button only),
 * minimize/maximize, and close — which hides to tray rather than exiting
 * (intercepted in src-tauri/src/lib.rs).
 */
export function TitleBar() {
  const win = getCurrentWindow();

  function handleDrag(e: React.MouseEvent) {
    if (e.button === 0) {
      win.startDragging();
    }
  }

  return (
    <div className="titlebar" onMouseDown={handleDrag}>
      <div className="titlebar-title">WinAutoStart</div>
      <div className="titlebar-controls" onMouseDown={(e) => e.stopPropagation()}>
        <button className="titlebar-btn" onClick={() => { win.minimize(); }}>
          <Minus size={12} strokeWidth={1.5} />
        </button>
        <button className="titlebar-btn" onClick={() => { win.toggleMaximize(); }}>
          <Square size={12} strokeWidth={1.5} />
        </button>
        <button className="titlebar-btn titlebar-close" onClick={() => { win.close(); }}>
          <X size={12} strokeWidth={1.5} />
        </button>
      </div>
    </div>
  );
}
