import { useState, useEffect, useRef } from "react";
import { getMonitors } from "@/shared/api";
import type { MonitorInfo } from "@/shared/api";
import type { LaunchItem } from "@/entities/preset";
import { resolveMonitorIndex } from "@/entities/preset";
import { MonitorChips, getAppLabel, itemColor } from "./MonitorChips";
import { useWindowDrag } from "../lib/useWindowDrag";

interface MonitorEditorProps {
  apps: LaunchItem[];
  onUpdateItem: (index: number, fields: Partial<LaunchItem>) => void;
}

/**
 * Visual window-placement editor: draws the real monitor layout to scale,
 * lets the user place the selected item by clicking a monitor (defaults to a
 * centered 50% window), then drag to move, drag the corner handle to resize,
 * double-click to fill the monitor, or ✕ on a chip to clear placement.
 * Positions are stored relative to the chosen monitor's origin.
 */
export function MonitorEditor({ apps, onUpdateItem }: MonitorEditorProps) {
  const [monitors, setMonitors] = useState<MonitorInfo[]>([]);
  const [selectedItem, setSelectedItem] = useState<number | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const startDrag = useWindowDrag(apps, monitors, canvasRef, onUpdateItem);

  useEffect(() => {
    getMonitors().then(setMonitors).catch(console.error);
  }, []);

  const appItems = apps.map((item, index) => ({ item, index }));

  // Auto-select first unplaced app, or first app if none selected
  useEffect(() => {
    if (appItems.length === 0) {
      setSelectedItem(null);
      return;
    }
    // If current selection is still valid, keep it
    if (selectedItem != null && appItems.some(({ index }) => index === selectedItem)) return;
    // Select first unplaced app, or first app
    const unplaced = appItems.find(({ item }) => item.monitor == null);
    setSelectedItem(unplaced ? unplaced.index : appItems[0].index);
  }, [appItems.length]);

  if (monitors.length === 0) return <div className="monitor-editor-loading">Loading monitors...</div>;
  if (appItems.length === 0) return null;

  const minX = Math.min(...monitors.map((m) => m.x));
  const minY = Math.min(...monitors.map((m) => m.y));
  const maxX = Math.max(...monitors.map((m) => m.x + m.width));
  const maxY = Math.max(...monitors.map((m) => m.y + m.height));
  const totalW = maxX - minX;
  const totalH = maxY - minY;

  const canvasWidth = 520;
  const scale = canvasWidth / totalW;
  const canvasHeight = totalH * scale;

  function handleMonitorClick(monIndex: number) {
    // If no item selected, try to auto-select first unplaced
    let target = selectedItem;
    if (target == null) {
      const unplaced = appItems.find(({ item }) => item.monitor == null);
      if (unplaced) {
        target = unplaced.index;
        setSelectedItem(target);
      } else {
        return;
      }
    }

    const item = apps[target];
    if (!item) return;

    const mon = monitors[monIndex];
    const defaultW = Math.round(mon.width * 0.5);
    const defaultH = Math.round(mon.height * 0.5);
    onUpdateItem(target, {
      monitor: monIndex,
      monitorName: mon.name,
      posX: Math.round((mon.width - defaultW) / 2),
      posY: Math.round((mon.height - defaultH) / 2),
      posWidth: defaultW,
      posHeight: defaultH,
    });

    // Auto-select next unplaced app
    const nextUnplaced = appItems.find(({ item: it, index }) => index !== target && it.monitor == null);
    if (nextUnplaced) {
      setSelectedItem(nextUnplaced.index);
    }
  }

  function handleClearItem(itemIndex: number) {
    onUpdateItem(itemIndex, {
      monitor: null,
      monitorName: null,
      posX: null,
      posY: null,
      posWidth: null,
      posHeight: null,
    });
  }

  return (
    <div className="monitor-editor">
      <div className="monitor-editor-label">Window Positions</div>

      <MonitorChips
        appItems={appItems}
        selectedItem={selectedItem}
        onSelect={setSelectedItem}
        onClear={handleClearItem}
      />

      {selectedItem != null && apps[selectedItem]?.monitor == null && (
        <div className="monitor-hint">
          Click a monitor to place this app
        </div>
      )}

      <div
        ref={canvasRef}
        className="monitor-canvas"
        style={{ width: canvasWidth, height: canvasHeight, position: "relative" }}
      >
        {monitors.map((mon) => (
          <div
            key={mon.index}
            className="monitor-rect"
            style={{
              left: (mon.x - minX) * scale,
              top: (mon.y - minY) * scale,
              width: mon.width * scale,
              height: mon.height * scale,
              position: "absolute",
            }}
            onClick={() => handleMonitorClick(mon.index)}
          >
            <span className="monitor-label">
              <span className="monitor-label-id">
                Display {mon.index + 1}
                {mon.isPrimary && <span className="monitor-primary-badge">PRIMARY</span>}
              </span>
              <span className="monitor-label-res">{mon.width}x{mon.height}</span>
            </span>
          </div>
        ))}

        {appItems.map(({ item, index }) => {
          const monIdx = resolveMonitorIndex(monitors, item);
          const mon = monIdx != null ? monitors[monIdx] : null;
          if (!mon || item.posX == null || item.posY == null || item.posWidth == null || item.posHeight == null) return null;

          const color = itemColor(index);
          const isSelected = selectedItem === index;

          return (
            <div
              key={index}
              className={`app-position-rect ${isSelected ? "selected" : ""}`}
              style={{
                left: (mon.x - minX + item.posX) * scale,
                top: (mon.y - minY + item.posY) * scale,
                width: item.posWidth * scale,
                height: item.posHeight * scale,
                position: "absolute",
                borderColor: color,
                background: color + (isSelected ? "40" : "20"),
              }}
              onMouseDown={(e) => {
                e.stopPropagation();
                setSelectedItem(index);
                startDrag(index, "move", e, item);
              }}
              onDoubleClick={(e) => {
                e.stopPropagation();
                onUpdateItem(index, {
                  posX: 0,
                  posY: 0,
                  posWidth: mon.width,
                  posHeight: mon.height,
                });
              }}
            >
              <div className="app-position-label">{getAppLabel(item)}</div>
              <div
                className="resize-handle"
                style={{ background: color }}
                onMouseDown={(e) => {
                  e.stopPropagation();
                  setSelectedItem(index);
                  startDrag(index, "resize", e, item);
                }}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
