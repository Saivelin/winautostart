import { useState, useEffect, useCallback } from "react";
import type { MouseEvent as ReactMouseEvent, RefObject } from "react";
import type { MonitorInfo } from "@/shared/api";
import type { LaunchItem } from "@/entities/preset";
import { resolveMonitorIndex } from "@/entities/preset";

interface DragState {
  itemIndex: number;
  type: "move" | "resize";
  startX: number;
  startY: number;
  origX: number;
  origY: number;
  origW: number;
  origH: number;
}

/**
 * Drag state for the monitor map: converts pixel deltas of a mouse drag into
 * item position/size updates in monitor coordinates, clamped to the item's
 * monitor. Returns `startDrag` to call from a rect's/handle's onMouseDown;
 * global mousemove/mouseup listeners are attached only while dragging.
 */
export function useWindowDrag(
  apps: LaunchItem[],
  monitors: MonitorInfo[],
  canvasRef: RefObject<HTMLDivElement | null>,
  onUpdateItem: (index: number, fields: Partial<LaunchItem>) => void,
) {
  const [dragging, setDragging] = useState<DragState | null>(null);

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!dragging) return;
      const item = apps[dragging.itemIndex];
      if (!item) return;
      const monIdx = resolveMonitorIndex(monitors, item);
      if (monIdx == null) return;
      const mon = monitors[monIdx];

      const minX = Math.min(...monitors.map((m) => m.x));
      const totalW = Math.max(...monitors.map((m) => m.x + m.width)) - minX;
      const canvasWidth = canvasRef.current?.clientWidth ?? 460;
      const scale = canvasWidth / totalW;

      const dx = (e.clientX - dragging.startX) / scale;
      const dy = (e.clientY - dragging.startY) / scale;

      if (dragging.type === "move") {
        const newX = Math.max(0, Math.min(mon.width - (item.posWidth ?? 400), Math.round(dragging.origX + dx)));
        const newY = Math.max(0, Math.min(mon.height - (item.posHeight ?? 300), Math.round(dragging.origY + dy)));
        onUpdateItem(dragging.itemIndex, { posX: newX, posY: newY });
      } else {
        const newW = Math.max(100, Math.min(mon.width - (item.posX ?? 0), Math.round(dragging.origW + dx)));
        const newH = Math.max(80, Math.min(mon.height - (item.posY ?? 0), Math.round(dragging.origH + dy)));
        onUpdateItem(dragging.itemIndex, { posWidth: newW, posHeight: newH });
      }
    },
    [dragging, monitors, apps, canvasRef, onUpdateItem]
  );

  const handleMouseUp = useCallback(() => {
    setDragging(null);
  }, []);

  useEffect(() => {
    if (dragging) {
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
      return () => {
        window.removeEventListener("mousemove", handleMouseMove);
        window.removeEventListener("mouseup", handleMouseUp);
      };
    }
  }, [dragging, handleMouseMove, handleMouseUp]);

  const startDrag = useCallback(
    (itemIndex: number, type: "move" | "resize", e: ReactMouseEvent, item: LaunchItem) => {
      setDragging({
        itemIndex,
        type,
        startX: e.clientX,
        startY: e.clientY,
        origX: item.posX ?? 0,
        origY: item.posY ?? 0,
        origW: item.posWidth ?? 0,
        origH: item.posHeight ?? 0,
      });
    },
    []
  );

  return startDrag;
}
