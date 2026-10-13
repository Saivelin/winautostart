import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SettingsView } from "./SettingsView";
import type { Config, Preset } from "@/entities/preset";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ save: vi.fn(), open: vi.fn() }));

import { invoke } from "@tauri-apps/api/core";
import { save, open } from "@tauri-apps/plugin-dialog";

const invokeMock = vi.mocked(invoke);
const saveMock = vi.mocked(save);
const openMock = vi.mocked(open);

function makePreset(id: string, name: string): Preset {
  return { id, name, description: `${name} desc`, color: "#fff", icon: "X", apps: [] };
}

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    defaultPreset: "p1",
    timeoutSeconds: 30,
    autoStartAsked: true,
    closePreviousApps: false,
    hotkey: "Ctrl+Alt+W",
    hotkeyEnabled: true,
    presets: [makePreset("p1", "Work"), makePreset("p2", "Gaming")],
    ...overrides,
  };
}

function makeHandlers() {
  return {
    onSave: vi.fn(),
    onBack: vi.fn(),
    onEditPreset: vi.fn(),
    onNewPreset: vi.fn(),
    onDeletePreset: vi.fn(),
  };
}

function renderSettings(config = makeConfig()) {
  const handlers = makeHandlers();
  const utils = render(<SettingsView config={config} {...handlers} />);
  return { ...utils, handlers, config };
}

beforeEach(() => {
  vi.clearAllMocks();
  invokeMock.mockImplementation(async (cmd) => {
    if (cmd === "is_autostart_installed") return false;
    return undefined;
  });
});

describe("SettingsView", () => {
  it("checks autostart status on mount", async () => {
    renderSettings();
    expect(await screen.findByRole("button", { name: "Enable" })).toBeInTheDocument();
    expect(invokeMock).toHaveBeenCalledWith("is_autostart_installed");
  });

  it("installs autostart when enabling", async () => {
    renderSettings();
    fireEvent.click(await screen.findByRole("button", { name: "Enable" }));
    expect(await screen.findByRole("button", { name: "Disable" })).toBeInTheDocument();
    expect(invokeMock).toHaveBeenCalledWith("install_autostart");
  });

  it("uninstalls autostart when disabling", async () => {
    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === "is_autostart_installed") return true;
      return undefined;
    });
    renderSettings();
    fireEvent.click(await screen.findByRole("button", { name: "Disable" }));
    expect(await screen.findByRole("button", { name: "Enable" })).toBeInTheDocument();
    expect(invokeMock).toHaveBeenCalledWith("uninstall_autostart");
  });

  it("saves edited settings and goes back", () => {
    const { handlers, config, container } = renderSettings();
    fireEvent.change(screen.getByLabelText(/timeout/i), { target: { value: "60" } });
    fireEvent.click(container.querySelector(".custom-select-trigger")!); // default-preset dropdown
    fireEvent.click(screen.getByRole("option", { name: "Gaming" }));
    fireEvent.click(screen.getByRole("button", { name: "Disabled" })); // close previous apps toggle
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
    expect(handlers.onSave).toHaveBeenCalledWith({
      ...config,
      timeoutSeconds: 60,
      defaultPreset: "p2",
      closePreviousApps: true,
    });
    expect(handlers.onBack).toHaveBeenCalled();
  });

  it("saves a re-recorded hotkey", () => {
    const { handlers, config } = renderSettings();
    const trigger = screen.getByRole("button", { name: "Global hotkey" });
    fireEvent.click(trigger);
    fireEvent.keyDown(trigger, { code: "KeyG", ctrlKey: true, altKey: true });
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));

    expect(handlers.onSave).toHaveBeenCalledWith({ ...config, hotkey: "Ctrl+Alt+G" });
  });

  it("saves the hotkey switched off", () => {
    const { handlers, config } = renderSettings();
    fireEvent.click(screen.getByRole("button", { name: "Enabled" })); // hotkey toggle
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));

    expect(handlers.onSave).toHaveBeenCalledWith({ ...config, hotkeyEnabled: false });
    expect(screen.getByRole("button", { name: "Global hotkey" })).toBeDisabled();
  });

  it("clamps a typed negative timeout to zero", () => {
    const { handlers, config } = renderSettings();
    fireEvent.change(screen.getByLabelText(/timeout/i), { target: { value: "-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));

    expect(handlers.onSave).toHaveBeenCalledWith({ ...config, timeoutSeconds: 0 });
  });

  it("caps the timeout at five minutes", () => {
    const { handlers, config } = renderSettings();
    fireEvent.change(screen.getByLabelText(/timeout/i), { target: { value: "9999" } });
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));

    expect(handlers.onSave).toHaveBeenCalledWith({ ...config, timeoutSeconds: 300 });
  });

  it("opens the diagnostics log", async () => {
    renderSettings();
    fireEvent.click(screen.getByRole("button", { name: /log/i }));
    await vi.waitFor(() => expect(invokeMock).toHaveBeenCalledWith("open_log"));
  });

  it("reports a log that could not be opened", async () => {
    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === "is_autostart_installed") return false;
      if (cmd === "open_log") throw "Failed to open C:\\log.txt";
      return undefined;
    });
    renderSettings();
    fireEvent.click(screen.getByRole("button", { name: /log/i }));

    expect(await screen.findByText(/Could not open the log/)).toBeInTheDocument();
  });

  it("opens the editor when a preset is clicked", () => {
    const { handlers, config } = renderSettings();
    fireEvent.click(screen.getByText("Work", { selector: ".preset-name" }));
    expect(handlers.onEditPreset).toHaveBeenCalledWith(config.presets[0]);
  });

  it("creates a new preset", () => {
    const { handlers } = renderSettings();
    fireEvent.click(screen.getByRole("button", { name: "+ Add Preset" }));
    expect(handlers.onNewPreset).toHaveBeenCalled();
  });

  it("deletes a preset after confirmation", () => {
    const { handlers } = renderSettings();
    const deleteButtons = screen.getAllByRole("button", { name: "Delete preset" });
    fireEvent.click(deleteButtons[1]);
    // The first click deletes nothing, it only shows a confirmation
    expect(handlers.onDeletePreset).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Delete?" }));
    expect(handlers.onDeletePreset).toHaveBeenCalledWith("p2");
  });

  it("cancels a pending delete confirmation", () => {
    const { handlers } = renderSettings();
    fireEvent.click(screen.getAllByRole("button", { name: "Delete preset" })[0]);
    fireEvent.click(screen.getByRole("button", { name: "Cancel delete" }));

    expect(handlers.onDeletePreset).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Delete?" })).toBeNull();
  });

  it("exports presets to the chosen file and reports success", async () => {
    saveMock.mockResolvedValue("C:\\out.json");
    const { config } = renderSettings();
    fireEvent.click(screen.getByRole("button", { name: "Export" }));
    await vi.waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("export_presets", {
        path: "C:\\out.json",
        presets: config.presets,
      });
    });
    expect(await screen.findByText("Exported 2 preset(s)")).toBeInTheDocument();
  });

  it("shows a banner when export fails", async () => {
    saveMock.mockResolvedValue("C:\\out.json");
    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === "is_autostart_installed") return false;
      if (cmd === "export_presets") throw "Write error: denied";
      return undefined;
    });
    renderSettings();
    fireEvent.click(screen.getByRole("button", { name: "Export" }));
    expect(await screen.findByText(/Export failed: Write error: denied/)).toBeInTheDocument();
  });

  it("does nothing when the export dialog is cancelled", async () => {
    saveMock.mockResolvedValue(null);
    renderSettings();
    fireEvent.click(screen.getByRole("button", { name: "Export" }));
    await vi.waitFor(() => expect(saveMock).toHaveBeenCalled());
    expect(invokeMock).not.toHaveBeenCalledWith("export_presets", expect.anything());
  });

  it("imports presets, regenerating colliding ids", async () => {
    openMock.mockResolvedValue("C:\\in.json");
    const imported = [makePreset("p1", "Imported Work"), makePreset("p9", "Fresh")];
    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === "is_autostart_installed") return false;
      if (cmd === "import_presets") return imported;
      return undefined;
    });

    const { handlers, config } = renderSettings();
    fireEvent.click(screen.getByRole("button", { name: "Import" }));

    await vi.waitFor(() => expect(handlers.onSave).toHaveBeenCalled());
    const saved = handlers.onSave.mock.calls[0][0] as Config;
    expect(saved.presets).toHaveLength(4);
    const [, , collided, fresh] = saved.presets;
    expect(collided.id).not.toBe("p1");
    expect(collided.name).toBe("Imported Work (imported)");
    expect(fresh).toEqual(imported[1]);
    expect(saved.presets.slice(0, 2)).toEqual(config.presets);
  });

  it("shows a banner when import fails", async () => {
    openMock.mockResolvedValue("C:\\in.json");
    invokeMock.mockImplementation(async (cmd) => {
      if (cmd === "is_autostart_installed") return false;
      if (cmd === "import_presets") throw "Parse error: bad json";
      return undefined;
    });
    const { handlers } = renderSettings();
    fireEvent.click(screen.getByRole("button", { name: "Import" }));

    expect(await screen.findByText(/Import failed: Parse error: bad json/)).toBeInTheDocument();
    expect(handlers.onSave).not.toHaveBeenCalled();
  });

  it("does nothing when the import dialog is cancelled", async () => {
    openMock.mockResolvedValue(null);
    const { handlers } = renderSettings();
    fireEvent.click(screen.getByRole("button", { name: "Import" }));
    await vi.waitFor(() => expect(openMock).toHaveBeenCalled());
    expect(invokeMock).not.toHaveBeenCalledWith("import_presets", expect.anything());
    expect(handlers.onSave).not.toHaveBeenCalled();
  });
});
