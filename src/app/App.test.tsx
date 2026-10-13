import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import App from "./App";
import type { Config } from "@/entities/preset";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
vi.mock("@tauri-apps/plugin-process", () => ({ exit: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }));

const winMock = vi.hoisted(() => ({
  startDragging: vi.fn(),
  minimize: vi.fn(),
  toggleMaximize: vi.fn(),
  close: vi.fn(),
}));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => winMock }));

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { exit } from "@tauri-apps/plugin-process";

const invokeMock = vi.mocked(invoke);
const listenMock = vi.mocked(listen);
const exitMock = vi.mocked(exit);

type EventHandler = (event: { payload: unknown }) => void;
let listenHandlers: Record<string, EventHandler> = {};

function emitEvent(event: string, payload: unknown) {
  act(() => listenHandlers[event]?.({ payload }));
}

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    defaultPreset: "p1",
    timeoutSeconds: 0,
    autoStartAsked: true,
    closePreviousApps: false,
    hotkey: "Ctrl+Alt+W",
    hotkeyEnabled: true,
    presets: [
      { id: "p1", name: "Work", description: "Work stuff", color: "#fff", icon: "W", apps: [] },
      { id: "p2", name: "Gaming", description: "Games", color: "#000", icon: "G", apps: [] },
    ],
    ...overrides,
  };
}

function mockBackend(config: Config, recovered = false) {
  invokeMock.mockImplementation(async (cmd) => {
    switch (cmd) {
      case "load_config":
        return { config, recovered };
      case "is_autostart_installed":
        return false;
      case "detect_browsers":
      case "get_monitors":
      case "get_start_menu_apps":
        return [];
      default:
        return undefined;
    }
  });
}

function savedConfig(): Config {
  const call = invokeMock.mock.calls.filter((c) => c[0] === "save_config").pop();
  expect(call).toBeDefined();
  return (call![1] as { config: Config }).config;
}

async function renderApp(config = makeConfig()) {
  mockBackend(config);
  const utils = render(<App />);
  await screen.findByText(/select a preset to launch/i);
  return utils;
}

async function flushWithFakeTimers() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  listenHandlers = {};
  listenMock.mockImplementation(async (event, handler) => {
    listenHandlers[event as string] = handler as unknown as EventHandler;
    return () => {};
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("App: startup", () => {
  it("loads the config and renders the main view", async () => {
    await renderApp();
    expect(invokeMock).toHaveBeenCalledWith("load_config");
    expect(screen.getByText("Work")).toBeInTheDocument();
    expect(screen.getByText("Gaming")).toBeInTheDocument();
  });

  it("shows the autostart prompt on first run", async () => {
    mockBackend(makeConfig({ autoStartAsked: false }));
    render(<App />);
    expect(await screen.findByText(/run at startup\?/i)).toBeInTheDocument();
  });

  it("installs autostart and persists the answer on accept", async () => {
    mockBackend(makeConfig({ autoStartAsked: false }));
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /yes, enable autostart/i }));

    await screen.findByText(/select a preset to launch/i);
    expect(invokeMock).toHaveBeenCalledWith("install_autostart");
    expect(savedConfig().autoStartAsked).toBe(true);
  });

  it("only persists the answer on decline", async () => {
    mockBackend(makeConfig({ autoStartAsked: false }));
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /no, thanks/i }));

    await screen.findByText(/select a preset to launch/i);
    expect(invokeMock).not.toHaveBeenCalledWith("install_autostart");
    expect(savedConfig().autoStartAsked).toBe(true);
  });
});

describe("App: countdown", () => {
  it("auto-launches the default preset when the countdown ends", async () => {
    vi.useFakeTimers();
    mockBackend(makeConfig({ timeoutSeconds: 2 }));
    render(<App />);
    await flushWithFakeTimers();
    expect(screen.getByText('Auto-launch "Work" in 2s')).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(invokeMock).toHaveBeenCalledWith("launch_preset", { id: "p1" });
  });

  it("exits when the countdown ends without a default preset", async () => {
    vi.useFakeTimers();
    mockBackend(makeConfig({ timeoutSeconds: 2, defaultPreset: "" }));
    render(<App />);
    await flushWithFakeTimers();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(exitMock).toHaveBeenCalledWith(0);
    expect(invokeMock).not.toHaveBeenCalledWith("launch_preset", expect.anything());
  });

  it("stops the countdown when a preset is clicked", async () => {
    vi.useFakeTimers();
    mockBackend(makeConfig({ timeoutSeconds: 5 }));
    render(<App />);
    await flushWithFakeTimers();

    fireEvent.click(screen.getByText("Gaming"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(invokeMock).not.toHaveBeenCalledWith("launch_preset", expect.anything());
    expect(exitMock).not.toHaveBeenCalled();
  });
});

describe("App: launching", () => {
  it("launches the selected preset", async () => {
    await renderApp();
    fireEvent.click(screen.getByRole("button", { name: "Launch" }));
    await vi.waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("launch_preset", { id: "p1" })
    );
    expect(invokeMock).not.toHaveBeenCalledWith("close_previous_apps");
  });

  it("closes previous apps before launching when configured", async () => {
    await renderApp(makeConfig({ closePreviousApps: true }));
    fireEvent.click(screen.getByRole("button", { name: "Launch" }));
    await vi.waitFor(() => expect(invokeMock).toHaveBeenCalledWith("close_previous_apps"));
    expect(invokeMock).toHaveBeenCalledWith("launch_preset", { id: "p1" });
  });

  it("launches the clicked preset on double click", async () => {
    await renderApp();
    fireEvent.doubleClick(screen.getByText("Gaming"));
    await vi.waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("launch_preset", { id: "p2" })
    );
  });

  it("Switch & Close closes previous apps and launches", async () => {
    await renderApp();
    fireEvent.click(screen.getByRole("button", { name: "Switch & Close" }));
    await vi.waitFor(() => expect(invokeMock).toHaveBeenCalledWith("close_previous_apps"));
    expect(invokeMock).toHaveBeenCalledWith("launch_preset", { id: "p1" });
  });

  it("Switch & Minimize minimizes previous apps and launches", async () => {
    await renderApp();
    fireEvent.click(screen.getByRole("button", { name: "Switch & Minimize" }));
    await vi.waitFor(() => expect(invokeMock).toHaveBeenCalledWith("minimize_previous_apps"));
    expect(invokeMock).toHaveBeenCalledWith("launch_preset", { id: "p1" });
  });

  it("exits on Skip", async () => {
    await renderApp();
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    await vi.waitFor(() => expect(exitMock).toHaveBeenCalledWith(0));
  });
});

describe("App: settings and presets", () => {
  async function openSettings() {
    await renderApp();
    fireEvent.click(screen.getByTitle("Settings"));
    await screen.findByText("Settings");
  }

  it("navigates to settings via the gear button", async () => {
    await openSettings();
    expect(screen.getByText("+ Add Preset")).toBeInTheDocument();
  });

  it("persists settings changes and rebuilds the tray", async () => {
    await openSettings();
    fireEvent.change(screen.getByLabelText(/timeout/i), { target: { value: "45" } });
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));

    await vi.waitFor(() => expect(invokeMock).toHaveBeenCalledWith("rebuild_tray"));
    expect(savedConfig().timeoutSeconds).toBe(45);
    expect(await screen.findByText(/select a preset to launch/i)).toBeInTheDocument();
  });

  it("saves an edited preset in place", async () => {
    await openSettings();
    fireEvent.click(screen.getByText("Work", { selector: ".preset-name" }));
    await screen.findByText("Edit: Work");

    fireEvent.change(screen.getByPlaceholderText(/work, gaming/i), {
      target: { value: "Renamed" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await vi.waitFor(() => {
      const cfg = savedConfig();
      expect(cfg.presets.map((p) => p.name)).toEqual(["Renamed", "Gaming"]);
    });
    expect(await screen.findByText("Settings")).toBeInTheDocument();
  });

  it("adds a new preset", async () => {
    await openSettings();
    fireEvent.click(screen.getByRole("button", { name: "+ Add Preset" }));
    await screen.findByText("New Preset");

    fireEvent.change(screen.getByPlaceholderText(/work, gaming/i), {
      target: { value: "Fresh" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await vi.waitFor(() => {
      const cfg = savedConfig();
      expect(cfg.presets).toHaveLength(3);
      expect(cfg.presets[2].name).toBe("Fresh");
      expect(cfg.presets[2].id).toBeTruthy();
    });
  });

  it("keeps the UI on the stored config and explains a failed save", async () => {
    const config = makeConfig();
    invokeMock.mockImplementation(async (cmd) => {
      switch (cmd) {
        case "load_config":
          return { config, recovered: false };
        case "is_autostart_installed":
          return false;
        case "save_config":
          throw "Write error: access denied";
        default:
          return undefined;
      }
    });
    render(<App />);
    await screen.findByText(/select a preset to launch/i);
    fireEvent.click(screen.getByTitle("Settings"));
    await screen.findByText("Settings");
    fireEvent.change(screen.getByLabelText(/timeout/i), { target: { value: "45" } });
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));

    expect(await screen.findByText(/Settings not saved/)).toBeInTheDocument();
    expect(screen.getByText(/access denied/)).toBeInTheDocument();
    // A failed save must not look applied: the old timeout is still on disk,
    // so the UI keeps it too, and the tray and hotkey are not rebuilt
    expect(await screen.findByText(`${config.timeoutSeconds}s`)).toBeInTheDocument();
    expect(invokeMock).not.toHaveBeenCalledWith("rebuild_tray");
    expect(invokeMock).not.toHaveBeenCalledWith("refresh_hotkey");
  });

  it("persists a re-recorded hotkey and re-registers it", async () => {
    await openSettings();
    const trigger = screen.getByRole("button", { name: "Global hotkey" });
    fireEvent.click(trigger);
    fireEvent.keyDown(trigger, { code: "KeyG", ctrlKey: true, altKey: true });
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));

    await vi.waitFor(() => expect(invokeMock).toHaveBeenCalledWith("refresh_hotkey"));
    expect(savedConfig().hotkey).toBe("Ctrl+Alt+G");
  });

  it("shows a banner when the hotkey can't be registered", async () => {
    const config = makeConfig();
    invokeMock.mockImplementation(async (cmd) => {
      switch (cmd) {
        case "load_config":
          return { config, recovered: false };
        case "is_autostart_installed":
          return false;
        case "refresh_hotkey":
          throw 'Failed to register hotkey "Ctrl+Alt+W": taken';
        default:
          return undefined;
      }
    });
    render(<App />);
    await screen.findByText(/select a preset to launch/i);
    fireEvent.click(screen.getByTitle("Settings"));
    await screen.findByText("Settings");
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));

    expect(await screen.findByText(/Hotkey not registered/)).toBeInTheDocument();
    expect(screen.getByText(/taken/)).toBeInTheDocument();
  });

  it("deleting the default preset clears defaultPreset", async () => {
    await openSettings();
    fireEvent.click(screen.getAllByRole("button", { name: "Delete preset" })[0]);
    // Two-step delete: the first click shows a confirmation
    fireEvent.click(screen.getByRole("button", { name: "Delete?" }));

    await vi.waitFor(() => {
      const cfg = savedConfig();
      expect(cfg.presets.map((p) => p.id)).toEqual(["p2"]);
      expect(cfg.defaultPreset).toBe("");
    });
  });
});

describe("App: config recovery and load failure", () => {
  it("shows a banner when the config was recovered from a corrupt file", async () => {
    mockBackend(makeConfig(), true);
    render(<App />);
    await screen.findByText(/select a preset to launch/i);
    expect(screen.getByText(/config file was corrupt/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByText(/config file was corrupt/i)).toBeNull();
  });

  it("shows no banner on a normal load", async () => {
    await renderApp();
    expect(screen.queryByText(/config file was corrupt/i)).toBeNull();
  });

  it("shows an error screen instead of hanging when load_config fails", async () => {
    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === "load_config") throw "Read error: access denied";
      return undefined;
    });
    render(<App />);
    expect(await screen.findByText(/failed to load configuration/i)).toBeInTheDocument();
    expect(screen.getByText(/access denied/i)).toBeInTheDocument();
    expect(screen.queryByText("Loading...")).toBeNull();
  });
});

describe("App: launch progress", () => {
  it("renders per-item progress from launch-progress events", async () => {
    await renderApp();
    emitEvent("launch-progress", {
      index: 0, total: 2, label: "C:\\a.exe", status: "ok",
    });
    emitEvent("launch-progress", {
      index: 1, total: 2, label: "C:\\gone.exe", status: "failed",
      error: "Failed to launch C:\\gone.exe: not found",
    });

    expect(screen.getByText("C:\\a.exe")).toBeInTheDocument();
    expect(screen.getByText("C:\\gone.exe")).toBeInTheDocument();
    expect(screen.getByText(/not found/)).toBeInTheDocument();
  });

  it("marks skipped items as already running", async () => {
    await renderApp();
    emitEvent("launch-progress", {
      index: 0, total: 1, label: "C:\\a.exe", status: "skipped",
    });
    expect(screen.getByText("already running")).toBeInTheDocument();
  });

  it("clears previous progress when a new launch starts", async () => {
    await renderApp();
    emitEvent("launch-progress", {
      index: 0, total: 1, label: "C:\\old.exe", status: "ok",
    });
    expect(screen.getByText("C:\\old.exe")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Launch" }));
    await vi.waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("launch_preset", { id: "p1" })
    );
    expect(screen.queryByText("C:\\old.exe")).toBeNull();
  });

  it("shows a banner when the launch command itself fails", async () => {
    mockBackend(makeConfig());
    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === "load_config") return { config: makeConfig(), recovered: false };
      if (cmd === "launch_preset") throw "Preset 'p1' not found";
      return undefined;
    });
    render(<App />);
    await screen.findByText(/select a preset to launch/i);

    fireEvent.click(screen.getByRole("button", { name: "Launch" }));
    expect(await screen.findByText(/Preset 'p1' not found/)).toBeInTheDocument();
  });
});
