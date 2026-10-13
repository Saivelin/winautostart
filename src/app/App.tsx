import { useState, useEffect, useRef, useCallback } from "react";
import { AlertTriangle, X } from "lucide-react";
import { exit } from "@tauri-apps/plugin-process";
import { rebuildTray, refreshHotkey, installAutostart, onLaunchProgress } from "@/shared/api";
import type { LaunchProgress } from "@/shared/api";
import type { Config, Preset } from "@/entities/preset";
import {
  generateId,
  PRESET_COLORS,
  loadConfig,
  saveConfig,
  launchPreset,
  closePreviousApps,
  minimizePreviousApps,
  upsertPreset,
  removePreset,
} from "@/entities/preset";
import { TitleBar } from "@/widgets/title-bar";
import { MainView } from "@/pages/main";
import { SettingsView } from "@/pages/settings";
import { EditPresetView } from "@/pages/edit-preset";
import { AutoStartPrompt } from "@/pages/autostart-prompt";
import type { View } from "./types";

/**
 * Root component: owns the config (loaded once via load_config, saved through
 * save_config + tray rebuild), the view routing (main/settings/editPreset),
 * the first-run autostart prompt, and the startup countdown that auto-launches
 * the default preset. The countdown is one-shot: any interaction (selecting a
 * preset, opening settings) disarms it for the rest of the session — note the
 * banner doesn't disappear, it resets to the full value and stays frozen.
 */
export default function App() {
  const [config, setConfig] = useState<Config | null>(null);
  const [selectedId, setSelectedId] = useState<string>("");
  const [countdown, setCountdown] = useState<number>(0);
  const [view, setView] = useState<View>("main");
  const [editingPreset, setEditingPreset] = useState<Preset | null>(null);
  const [launching, setLaunching] = useState(false);
  const [showAutoStartPrompt, setShowAutoStartPrompt] = useState(false);
  const [progress, setProgress] = useState<LaunchProgress[]>([]);
  const [launchError, setLaunchError] = useState<string | null>(null);
  const [recovered, setRecovered] = useState(false);
  const [hotkeyError, setHotkeyError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const timerRef = useRef<number | null>(null);
  const timerStartedRef = useRef(false);

  useEffect(() => {
    loadConfig()
      .then(({ config: cfg, recovered: wasRecovered }) => {
        setConfig(cfg);
        setRecovered(wasRecovered);
        setSelectedId(cfg.defaultPreset || cfg.presets[0]?.id || "");
        setCountdown(cfg.timeoutSeconds);
        if (!cfg.autoStartAsked) {
          setShowAutoStartPrompt(true);
        }
      })
      .catch((e) => setLoadError(String(e)));

    const unlistenProgress = onLaunchProgress((payload) => {
      setProgress((prev) => {
        const next = [...prev];
        next[payload.index] = payload;
        return next;
      });
    });
    return () => {
      unlistenProgress.then((fn) => fn());
    };
  }, []);

  const stopTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!config || view !== "main" || showAutoStartPrompt || config.timeoutSeconds <= 0) return;
    if (timerStartedRef.current) return;
    timerStartedRef.current = true;

    timerRef.current = window.setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          stopTimer();
          if (config.defaultPreset) {
            handleLaunch(config.defaultPreset);
          } else {
            exit(0);
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => stopTimer();
  }, [config, view, showAutoStartPrompt]);

  async function runLaunch(presetId: string | undefined, preAction: "close" | "minimize" | null) {
    const id = presetId || selectedId;
    if (!id) return;
    setLaunching(true);
    setProgress([]);
    setLaunchError(null);
    stopTimer();
    try {
      if (preAction) {
        await (preAction === "close" ? closePreviousApps() : minimizePreviousApps());
      }
      await launchPreset(id);
    } catch (e) {
      console.error(e);
      setLaunchError(String(e));
    }
    setLaunching(false);
  }

  function handleLaunch(presetId?: string) {
    return runLaunch(presetId, config?.closePreviousApps ? "close" : null);
  }

  function handleSwitch(presetId?: string) {
    return runLaunch(presetId, "close");
  }

  function handleSwitchMinimize(presetId?: string) {
    return runLaunch(presetId, "minimize");
  }

  async function handleSkip() {
    stopTimer();
    await exit(0);
  }

  async function handleAutoStartResponse(yes: boolean) {
    if (yes) {
      try {
        await installAutostart();
      } catch (e) {
        console.error("Failed to install autostart:", e);
      }
    }
    if (config) {
      await handleSaveConfig({ ...config, autoStartAsked: true });
    }
    setShowAutoStartPrompt(false);
  }

  /**
   * Saves the config and only then treats it as current. A rejected save (a
   * value the Rust model refuses, a locked file) rolls the UI back to what is
   * actually on disk and says so — showing the new values as "saved" while the
   * file still holds the old ones is how edits used to disappear on restart.
   */
  async function handleSaveConfig(newConfig: Config) {
    const previous = config;
    setConfig(newConfig);
    try {
      await saveConfig(newConfig);
      setSaveError(null);
    } catch (e) {
      setConfig(previous);
      setSaveError(String(e));
      return;
    }
    await rebuildTray().catch(() => {});
    // A combo the OS refuses (already taken by another app) has to be visible —
    // otherwise the hotkey just silently stops working.
    try {
      await refreshHotkey();
      setHotkeyError(null);
    } catch (e) {
      setHotkeyError(String(e));
    }
  }

  function openSettings() {
    stopTimer();
    setView("settings");
  }

  function openEditPreset(preset: Preset) {
    setEditingPreset({ ...preset, apps: preset.apps.map((a) => ({ ...a })) });
    setView("editPreset");
  }

  function handleDeletePreset(id: string) {
    if (!config) return;
    const updated = {
      ...config,
      presets: removePreset(config.presets, id),
      defaultPreset: config.defaultPreset === id ? "" : config.defaultPreset,
    };
    handleSaveConfig(updated);
  }

  function handleSavePreset(preset: Preset) {
    if (!config) return;
    const updated = { ...config, presets: upsertPreset(config.presets, preset) };
    handleSaveConfig(updated);
    setView("settings");
  }

  function handleSelectPreset(id: string) {
    setSelectedId(id);
    stopTimer();
    setCountdown(config?.timeoutSeconds ?? 0);
  }

  if (loadError) {
    return (
      <>
        <TitleBar />
        <div className="load-error">
          <div className="load-error-title">
            <AlertTriangle size={16} />
            <span>Failed to load configuration</span>
          </div>
          <div className="load-error-detail">{loadError}</div>
        </div>
      </>
    );
  }

  if (!config) {
    return <><TitleBar /><div className="loading">Loading...</div></>;
  }

  const recoveredBanner = recovered && (
    <div className="app-banner app-banner--warning">
      <span>
        The config file was corrupt and has been reset to defaults. A backup was
        saved as <code>config.json.corrupt</code>.
      </span>
      <button className="app-banner-dismiss" onClick={() => setRecovered(false)} aria-label="Dismiss">
        <X size={13} />
      </button>
    </div>
  );

  const saveErrorBanner = saveError && (
    <div className="app-banner app-banner--danger">
      <span>Settings not saved: {saveError}</span>
      <button className="app-banner-dismiss" onClick={() => setSaveError(null)} aria-label="Dismiss">
        <X size={13} />
      </button>
    </div>
  );

  const hotkeyBanner = hotkeyError && (
    <div className="app-banner app-banner--danger">
      <span>Hotkey not registered: {hotkeyError}</span>
      <button className="app-banner-dismiss" onClick={() => setHotkeyError(null)} aria-label="Dismiss">
        <X size={13} />
      </button>
    </div>
  );

  if (showAutoStartPrompt) {
    return (
      <>
        <TitleBar />
        <AutoStartPrompt onRespond={handleAutoStartResponse} />
      </>
    );
  }

  if (view === "editPreset" && editingPreset) {
    return (
      <>
        <TitleBar />
        {saveErrorBanner}
        <EditPresetView
          preset={editingPreset}
          onSave={handleSavePreset}
          onCancel={() => setView("settings")}
        />
      </>
    );
  }

  if (view === "settings") {
    return (
      <>
        <TitleBar />
        {saveErrorBanner}
        {hotkeyBanner}
        <SettingsView
          config={config}
          onSave={handleSaveConfig}
          onBack={() => setView("main")}
          onEditPreset={(p) => openEditPreset(p)}
          onNewPreset={() =>
            openEditPreset(
              { id: generateId(), name: "", description: "", color: PRESET_COLORS[0], icon: "monitor", apps: [] }
            )
          }
          onDeletePreset={handleDeletePreset}
        />
      </>
    );
  }

  return (
    <>
      <TitleBar />
      {recoveredBanner}
      {saveErrorBanner}
      {hotkeyBanner}
      <MainView
        config={config}
        selectedId={selectedId}
        countdown={countdown}
        launching={launching}
        progress={progress}
        launchError={launchError}
        onSelect={handleSelectPreset}
        onLaunch={handleLaunch}
        onSwitch={handleSwitch}
        onSwitchMinimize={handleSwitchMinimize}
        onSkip={handleSkip}
        onSettings={openSettings}
      />
    </>
  );
}
