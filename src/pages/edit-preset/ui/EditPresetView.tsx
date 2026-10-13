import { useState, useEffect } from "react";
import { detectBrowsers } from "@/shared/api";
import type { BrowserInfo } from "@/shared/api";
import type { Preset, LaunchItem } from "@/entities/preset";
import { PRESET_COLORS, newAppItem, newWebsiteItem, IconPicker } from "@/entities/preset";
import { AppPicker } from "@/features/pick-app";
import { MonitorEditor } from "@/features/position-window";
import { ItemEditor } from "./ItemEditor";

interface EditPresetViewProps {
  preset: Preset;
  onSave: (p: Preset) => void;
  onCancel: () => void;
}

/**
 * Preset editor: name/description, color picker, icon picker (extracted to
 * IconPicker), the launch-item list with reordering, and the visual
 * monitor-placement editor. Saving trims text fields and drops items with an
 * empty path/url.
 */
export function EditPresetView({ preset, onSave, onCancel }: EditPresetViewProps) {
  const [name, setName] = useState(preset.name);
  const [description, setDescription] = useState(preset.description);
  const [color, setColor] = useState(preset.color || PRESET_COLORS[0]);
  const [icon, setIcon] = useState(preset.icon || "monitor");
  const [apps, setApps] = useState<LaunchItem[]>(preset.apps);
  const [browsers, setBrowsers] = useState<BrowserInfo[]>([]);
  const [appPickerFor, setAppPickerFor] = useState<number | null>(null);

  useEffect(() => {
    detectBrowsers().then(setBrowsers).catch(() => {});
  }, []);

  function addApp() {
    setApps([...apps, newAppItem()]);
  }

  function addWebsite() {
    setApps([...apps, newWebsiteItem()]);
  }

  function removeItem(index: number) {
    setApps(apps.filter((_, i) => i !== index));
  }

  function moveItem(index: number, direction: -1 | 1) {
    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= apps.length) return;
    const newApps = [...apps];
    [newApps[index], newApps[newIndex]] = [newApps[newIndex], newApps[index]];
    setApps(newApps);
  }

  function updateItem(index: number, field: keyof LaunchItem, value: string | number | boolean | null) {
    setApps((prev) =>
      prev.map((item, i) =>
        i === index ? { ...item, [field]: value } : item
      )
    );
  }

  function updateItemFields(index: number, fields: Partial<LaunchItem>) {
    setApps((prev) =>
      prev.map((item, i) =>
        i === index ? { ...item, ...fields } : item
      )
    );
  }

  function handleSave() {
    if (!name.trim()) return;
    onSave({
      ...preset,
      name: name.trim(),
      description: description.trim(),
      color,
      icon,
      apps: apps.filter((a) => a.type === "website" ? a.url.trim() !== "" : a.path.trim() !== ""),
    });
  }

  return (
    <div className="container">
      <div className="header">
        <h1>{preset.name ? `Edit: ${preset.name}` : "New Preset"}</h1>
      </div>

      <div className="form-group">
        <label>
          Name:
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Work, Gaming"
          />
        </label>
      </div>

      <div className="form-group">
        <label>
          Description:
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Short description"
          />
        </label>
      </div>

      <h2>Color</h2>
      <div className="color-picker">
        {PRESET_COLORS.map((c) => (
          <div
            key={c}
            className={`color-swatch ${color === c ? "active" : ""}`}
            style={{ background: c }}
            onClick={() => setColor(c)}
          />
        ))}
        <input
          type="color"
          value={color}
          onChange={(e) => setColor(e.target.value)}
          className="color-input"
          title="Custom color"
        />
      </div>

      <h2>Icon</h2>
      <IconPicker value={icon} onChange={setIcon} />

      <h2>Launch Items</h2>
      <div className="apps-list">
        {apps.length === 0 && (
          <div className="apps-empty">No launch items yet — add an app or website below.</div>
        )}
        {apps.map((item, i) => (
          <ItemEditor
            key={i}
            item={item}
            index={i}
            totalItems={apps.length}
            browsers={browsers}
            onUpdate={updateItem}
            onRemove={removeItem}
            onMove={moveItem}
            onOpenAppPicker={(idx) => setAppPickerFor(idx)}
          />
        ))}
      </div>

      {appPickerFor !== null && (
        <AppPicker
          onSelect={(path) => {
            updateItem(appPickerFor, "path", path);
          }}
          onClose={() => setAppPickerFor(null)}
        />
      )}

      <div className="add-items-row">
        <button className="btn btn-secondary" onClick={addApp}>
          + App
        </button>
        <button className="btn btn-secondary" onClick={addWebsite}>
          + Website
        </button>
      </div>

      {apps.length > 0 && (
        <MonitorEditor
          apps={apps}
          onUpdateItem={(index, fields) => updateItemFields(index, fields)}
        />
      )}

      <div className="btn-row btn-row--footer">
        <button className="btn btn-primary" onClick={handleSave} disabled={!name.trim()}>
          Save
        </button>
        <button className="btn btn-secondary" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
