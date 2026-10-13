import { X } from "lucide-react";
import type { LaunchItem } from "@/entities/preset";
import { PRESET_COLORS } from "@/entities/preset";

/**
 * Stable color for the item at `index`, shared by chips and position rects.
 * Reuses the preset accent palette — same muted business tones.
 */
export function itemColor(index: number): string {
  return PRESET_COLORS[index % PRESET_COLORS.length];
}

/** Short human label for a launch item: URL hostname, exe name without extension, or "?". */
export function getAppLabel(item: LaunchItem): string {
  if (item.type === "website") {
    if (!item.url) return "?";
    try {
      return new URL(item.url).hostname;
    } catch {
      return item.url.slice(0, 20);
    }
  }
  if (!item.path) return "?";
  const parts = item.path.replace(/\\/g, "/").split("/");
  const filename = parts[parts.length - 1] || "?";
  return filename.replace(/\.exe$/i, "");
}

interface MonitorChipsProps {
  appItems: { item: LaunchItem; index: number }[];
  selectedItem: number | null;
  onSelect: (index: number | null) => void;
  onClear: (index: number) => void;
}

/**
 * Chip row above the monitor map: one chip per launch item, click toggles
 * selection, the ✕ (shown once placed) clears the item's placement.
 */
export function MonitorChips({ appItems, selectedItem, onSelect, onClear }: MonitorChipsProps) {
  return (
    <div className="monitor-app-chips">
      {appItems.map(({ item, index }) => (
        <button
          key={index}
          className={`monitor-chip ${selectedItem === index ? "active" : ""} ${item.monitor != null ? "placed" : ""}`}
          style={{
            borderColor: itemColor(index),
            background: selectedItem === index ? itemColor(index) + "30" : undefined,
          }}
          onClick={() => onSelect(selectedItem === index ? null : index)}
        >
          <span className="monitor-chip-dot" style={{ background: itemColor(index) }} />
          {getAppLabel(item)}
          {item.monitor != null && (
            <span
              className="monitor-chip-clear"
              onClick={(e) => { e.stopPropagation(); onClear(index); }}
            >
              <X size={12} />
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
