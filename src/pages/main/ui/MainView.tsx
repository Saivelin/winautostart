import { Check, Loader2, Settings, SkipForward, X } from "lucide-react";
import type { LaunchProgress } from "@/shared/api";
import type { Config } from "@/entities/preset";
import { PresetIcon } from "@/entities/preset";

interface MainViewProps {
  config: Config;
  selectedId: string;
  countdown: number;
  launching: boolean;
  progress: LaunchProgress[];
  launchError: string | null;
  onSelect: (id: string) => void;
  onLaunch: (id?: string) => void;
  onSwitch: (id?: string) => void;
  onSwitchMinimize: (id?: string) => void;
  onSkip: () => void;
  onSettings: () => void;
}

const PROGRESS_ICONS: Record<LaunchProgress["status"], React.ReactNode> = {
  launching: <Loader2 size={13} className="progress-spin" />,
  ok: <Check size={13} />,
  failed: <X size={13} />,
  skipped: <SkipForward size={13} />,
};

/** Per-item status list shown while a preset launches; failures stay visible. */
function LaunchProgressList({ items }: { items: LaunchProgress[] }) {
  const present = items.filter(Boolean);
  if (present.length === 0) return null;
  const total = present[0].total;
  const done = present.filter((p) => p.status !== "launching").length;
  const active = present.some((p) => p.status === "launching");
  return (
    <div className="launch-progress">
      {active && total > 1 && (
        <div className="launch-progress-header">Launching {done}/{total}…</div>
      )}
      {present.map((p) => (
        <div key={p.index} className={`launch-progress-item launch-progress-item--${p.status}`}>
          <span className="launch-progress-icon">{PROGRESS_ICONS[p.status]}</span>
          <span className="launch-progress-label" title={p.label}>{p.label}</span>
          {p.status === "skipped" && <span className="launch-progress-note">already running</span>}
          {p.error && <span className="launch-progress-note" title={p.error}>{p.error}</span>}
        </div>
      ))}
    </div>
  );
}

/**
 * Home screen: preset cards (click selects, double-click launches), countdown
 * banner, and the launch actions — plain Launch, Switch & Close (kill previous
 * preset's apps first) and Switch & Minimize.
 */
export function MainView({
  config, selectedId, countdown, launching, progress, launchError,
  onSelect, onLaunch, onSwitch, onSwitchMinimize, onSkip, onSettings,
}: MainViewProps) {
  const totalItems = config.presets.reduce((sum, p) => sum + p.apps.length, 0);

  return (
    <div className="container">
      <div className="header">
        <div>
          <h1>WinAutoStart</h1>
          <div className="header-subtitle">Select a preset to launch</div>
        </div>
        <button className="btn btn-icon" onClick={onSettings} title="Settings">
          <Settings size={18} />
        </button>
      </div>

      <div className="stats-row">
        <div className="stat-card">
          <div className="stat-value purple">{config.presets.length}</div>
          <div className="stat-label">Presets</div>
        </div>
        <div className="stat-card">
          <div className="stat-value blue">{totalItems}</div>
          <div className="stat-label">Items</div>
        </div>
        <div className="stat-card">
          <div className="stat-value teal">{config.timeoutSeconds}s</div>
          <div className="stat-label">Timeout</div>
        </div>
      </div>

      <div className="section-title">Presets</div>
      <div className="preset-list">
        {config.presets.map((preset) => (
          <div
            key={preset.id}
            className={`preset-card ${selectedId === preset.id ? "selected" : ""}`}
            onClick={() => onSelect(preset.id)}
            onDoubleClick={() => onLaunch(preset.id)}
          >
            <div className="preset-card-content">
              <PresetIcon icon={preset.icon} color={preset.color} />
              <div className="preset-text">
                <div className="preset-name">{preset.name}</div>
                <div className="preset-desc">{preset.description}</div>
              </div>
              <div className="preset-badge">
                {preset.apps.length} item{preset.apps.length !== 1 ? "s" : ""}
              </div>
            </div>
          </div>
        ))}
      </div>

      {config.timeoutSeconds > 0 && countdown > 0 && (
        <div className="timer">
          {config.defaultPreset
            ? `Auto-launch "${config.presets.find((p) => p.id === config.defaultPreset)?.name || config.defaultPreset}" in ${countdown}s`
            : `Auto-skip in ${countdown}s`}
        </div>
      )}

      {launchError && <div className="app-banner app-banner--danger">{launchError}</div>}
      <LaunchProgressList items={progress} />

      <div className="btn-row btn-row--split">
        <button
          className="btn btn-primary"
          onClick={() => onLaunch()}
          disabled={!selectedId || launching}
        >
          {launching ? "Launching..." : "Launch"}
        </button>
        <button className="btn btn-secondary" onClick={onSkip}>
          Skip
        </button>
      </div>
      <div className="btn-row btn-row--split">
        <button
          className="btn btn-switch"
          onClick={() => onSwitch()}
          disabled={!selectedId || launching}
          title="Ask the previous preset's apps to close, then launch the selected one"
        >
          Switch &amp; Close
        </button>
        <button
          className="btn btn-switch-minimize"
          onClick={() => onSwitchMinimize()}
          disabled={!selectedId || launching}
          title="Minimize previous apps and launch selected"
        >
          Switch &amp; Minimize
        </button>
      </div>
    </div>
  );
}
