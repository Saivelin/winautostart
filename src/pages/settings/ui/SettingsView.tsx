import { useState, useEffect } from "react";
import { save, open } from "@tauri-apps/plugin-dialog";
import { Check, ScrollText, X } from "lucide-react";
import { isAutostartInstalled, installAutostart, uninstallAutostart, openLog } from "@/shared/api";
import { DEFAULT_HOTKEY, parseBoundedInt } from "@/shared/lib";
import type { Config, Preset } from "@/entities/preset";
import { generateId, PresetIcon, exportPresets, importPresets } from "@/entities/preset";
import { CustomSelect, HotkeyInput } from "@/shared/ui";

/** Five minutes of countdown is plenty; the backend field is a u32. */
const MAX_TIMEOUT_SECONDS = 300;

interface SettingsViewProps {
  config: Config;
  onSave: (cfg: Config) => void;
  onBack: () => void;
  onEditPreset: (p: Preset) => void;
  onNewPreset: () => void;
  onDeletePreset: (id: string) => void;
}

/**
 * Settings screen: timeout/default-preset/close-previous/global-hotkey options
 * (applied on the ✓ button), Windows-autostart toggle (talks to the registry
 * commands directly), preset list management, and import/export through native
 * file dialogs. Imported presets with colliding ids get a fresh id and an
 * " (imported)" suffix.
 */
export function SettingsView({ config, onSave, onBack, onEditPreset, onNewPreset, onDeletePreset }: SettingsViewProps) {
  const [timeout, setTimeout] = useState(config.timeoutSeconds);
  const [defaultPreset, setDefaultPreset] = useState(config.defaultPreset);
  const [closePrevious, setClosePrevious] = useState(config.closePreviousApps ?? false);
  const [hotkey, setHotkey] = useState(config.hotkey || DEFAULT_HOTKEY);
  const [hotkeyEnabled, setHotkeyEnabled] = useState(config.hotkeyEnabled ?? true);
  const [autostartInstalled, setAutostartInstalled] = useState<boolean | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: "success" | "danger"; text: string } | null>(null);

  useEffect(() => {
    isAutostartInstalled().then(setAutostartInstalled);
  }, []);

  function handleSaveSettings() {
    onSave({
      ...config,
      timeoutSeconds: timeout,
      defaultPreset,
      closePreviousApps: closePrevious,
      hotkey,
      hotkeyEnabled,
    });
    onBack();
  }

  async function handleExport() {
    const filePath = await save({
      title: "Export Presets",
      defaultPath: "winautostart-presets.json",
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (!filePath) return;
    try {
      await exportPresets(filePath, config.presets);
      setNotice({ kind: "success", text: `Exported ${config.presets.length} preset(s)` });
    } catch (e) {
      console.error("Export failed:", e);
      setNotice({ kind: "danger", text: `Export failed: ${e}` });
    }
  }

  async function handleImport() {
    const filePath = await open({
      title: "Import Presets",
      filters: [{ name: "JSON", extensions: ["json"] }],
      multiple: false,
    });
    if (!filePath) return;
    try {
      const imported = await importPresets(filePath as string);
      const existingIds = new Set(config.presets.map((p) => p.id));
      const newPresets = imported.map((p) => {
        if (existingIds.has(p.id)) {
          return { ...p, id: generateId(), name: p.name + " (imported)" };
        }
        return p;
      });
      onSave({ ...config, presets: [...config.presets, ...newPresets] });
      setNotice({ kind: "success", text: `Imported ${newPresets.length} preset(s)` });
    } catch (e) {
      console.error("Import failed:", e);
      setNotice({ kind: "danger", text: `Import failed: ${e}` });
    }
  }

  async function handleOpenLog() {
    try {
      await openLog();
    } catch (e) {
      setNotice({ kind: "danger", text: `Could not open the log: ${e}` });
    }
  }

  async function toggleAutostart() {
    try {
      if (autostartInstalled) {
        await uninstallAutostart();
        setAutostartInstalled(false);
      } else {
        await installAutostart();
        setAutostartInstalled(true);
      }
    } catch (e) {
      console.error(e);
    }
  }

  return (
    <div className="container">
      <div className="header">
        <h1>Settings</h1>
        <button className="btn btn-icon" onClick={handleSaveSettings} aria-label="Save settings" title="Save settings">
          <Check size={18} />
        </button>
      </div>

      <div className="settings-section">
        <label>
          Timeout (seconds):
          <input
            type="number"
            min={0}
            max={MAX_TIMEOUT_SECONDS}
            value={timeout}
            onChange={(e) => setTimeout(parseBoundedInt(e.target.value, 0, MAX_TIMEOUT_SECONDS))}
          />
        </label>

        <label>
          Default preset:
          <CustomSelect
            value={defaultPreset}
            onChange={setDefaultPreset}
            options={[
              { value: "", label: "None (skip on timeout)" },
              ...config.presets.map((p) => ({ value: p.id, label: p.name })),
            ]}
          />
        </label>

        <div className="autostart-toggle">
          <span>Windows autostart:</span>
          <button className="btn btn-small" onClick={toggleAutostart}>
            {autostartInstalled === null
              ? "..."
              : autostartInstalled
                ? "Disable"
                : "Enable"}
          </button>
        </div>

        <div className="autostart-toggle">
          <span>Close previous apps on launch:</span>
          <button className="btn btn-small" onClick={() => setClosePrevious(!closePrevious)}>
            {closePrevious ? "Enabled" : "Disabled"}
          </button>
        </div>

        <div className="autostart-toggle">
          <span>Show window hotkey:</span>
          <div className="hotkey-controls">
            <HotkeyInput value={hotkey} onChange={setHotkey} disabled={!hotkeyEnabled} />
            <button className="btn btn-small" onClick={() => setHotkeyEnabled(!hotkeyEnabled)}>
              {hotkeyEnabled ? "Enabled" : "Disabled"}
            </button>
          </div>
        </div>
      </div>

      <h2>Presets</h2>
      <div className="preset-list compact">
        {config.presets.map((preset) => (
          <div
            key={preset.id}
            className="preset-card settings-card"
            style={{ borderLeftColor: preset.color || "var(--border)" }}
          >
            <PresetIcon icon={preset.icon} color={preset.color} />
            <div className="preset-info" onClick={() => onEditPreset(preset)}>
              <div className="preset-name">{preset.name}</div>
              <div className="preset-desc">{preset.description}</div>
            </div>
            {confirmDeleteId === preset.id ? (
              <div className="confirm-delete">
                <button
                  className="btn btn-danger btn-small"
                  onClick={() => { onDeletePreset(preset.id); setConfirmDeleteId(null); }}
                >
                  Delete?
                </button>
                <button
                  className="btn btn-secondary btn-small"
                  onClick={() => setConfirmDeleteId(null)}
                  aria-label="Cancel delete"
                  title="Cancel"
                >
                  <X size={14} />
                </button>
              </div>
            ) : (
              <button
                className="btn btn-danger btn-small"
                onClick={() => setConfirmDeleteId(preset.id)}
                aria-label="Delete preset"
                title="Delete preset"
              >
                <X size={14} />
              </button>
            )}
          </div>
        ))}
      </div>

      <button className="btn btn-primary full-width" onClick={onNewPreset}>
        + Add Preset
      </button>

      {notice && (
        <div className={`app-banner app-banner--${notice.kind}`}>
          <span>{notice.text}</span>
          <button className="app-banner-dismiss" onClick={() => setNotice(null)} aria-label="Dismiss">
            <X size={13} />
          </button>
        </div>
      )}

      <div className="btn-row btn-row--split btn-row--footer">
        <button className="btn btn-secondary" onClick={handleExport}>
          Export
        </button>
        <button className="btn btn-secondary" onClick={handleImport}>
          Import
        </button>
        <button
          className="btn btn-secondary btn-with-icon"
          onClick={handleOpenLog}
          title="Open the diagnostics log (%APPDATA%\WinAutoStart\log.txt)"
        >
          <ScrollText size={14} />
          Log
        </button>
      </div>
    </div>
  );
}
