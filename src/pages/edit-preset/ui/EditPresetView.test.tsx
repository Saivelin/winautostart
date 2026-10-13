import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { EditPresetView } from "./EditPresetView";
import type { LaunchItem, Preset } from "@/entities/preset";
import { newAppItem, newWebsiteItem, PRESET_COLORS, PRESET_ICONS } from "@/entities/preset";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }));

import { invoke } from "@tauri-apps/api/core";
const invokeMock = vi.mocked(invoke);

function makePreset(overrides: Partial<Preset> = {}): Preset {
  return {
    id: "p1",
    name: "Work",
    description: "Work stuff",
    color: "#3498db",
    icon: "\u{1F4BB}",
    apps: [],
    ...overrides,
  };
}

function renderEdit(preset = makePreset()) {
  const onSave = vi.fn();
  const onCancel = vi.fn();
  const utils = render(<EditPresetView preset={preset} onSave={onSave} onCancel={onCancel} />);
  return { ...utils, onSave, onCancel };
}

function pathInputs() {
  return screen.getAllByPlaceholderText<HTMLInputElement>(/program files/i);
}

beforeEach(() => {
  vi.clearAllMocks();
  invokeMock.mockImplementation(async (cmd) => {
    if (cmd === "detect_browsers") return [];
    if (cmd === "get_monitors") return [];
    if (cmd === "get_start_menu_apps") return [{ name: "Notepad", path: "C:\\notepad.exe" }];
    if (cmd === "get_app_icon") return null;
    return undefined;
  });
});

describe("EditPresetView", () => {
  it("detects browsers on mount", () => {
    renderEdit();
    expect(invokeMock).toHaveBeenCalledWith("detect_browsers");
  });

  it("adds an app item", () => {
    renderEdit();
    fireEvent.click(screen.getByRole("button", { name: "+ App" }));
    expect(screen.getByText("APP")).toBeInTheDocument();
  });

  it("adds a website item", () => {
    renderEdit();
    fireEvent.click(screen.getByRole("button", { name: "+ Website" }));
    expect(screen.getByText("WEB")).toBeInTheDocument();
  });

  it("removes an item", () => {
    renderEdit(makePreset({ apps: [{ ...newAppItem(), path: "C:\\a.exe" }] }));
    fireEvent.click(screen.getByTitle("Remove"));
    expect(screen.queryByText("APP")).toBeNull();
  });

  it("reorders items", () => {
    const apps: LaunchItem[] = [
      { ...newAppItem(), path: "C:\\a.exe" },
      { ...newAppItem(), path: "C:\\b.exe" },
    ];
    renderEdit(makePreset({ apps }));
    expect(pathInputs().map((i) => i.value)).toEqual(["C:\\a.exe", "C:\\b.exe"]);
    fireEvent.click(screen.getAllByTitle("Move down")[0]);
    expect(pathInputs().map((i) => i.value)).toEqual(["C:\\b.exe", "C:\\a.exe"]);
  });

  it("disables Save when the name is empty", () => {
    renderEdit(makePreset({ name: "" }));
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText(/work, gaming/i), { target: { value: "X" } });
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  });

  it("trims name/description and drops items without path/url on save", () => {
    const apps: LaunchItem[] = [
      { ...newAppItem(), path: "C:\\keep.exe" },
      { ...newAppItem(), path: "  " },
      { ...newWebsiteItem(), url: "https://keep.io" },
      { ...newWebsiteItem(), url: "" },
    ];
    const { onSave } = renderEdit(makePreset({ apps }));
    fireEvent.change(screen.getByPlaceholderText(/work, gaming/i), {
      target: { value: "  Trimmed  " },
    });
    fireEvent.change(screen.getByPlaceholderText(/short description/i), {
      target: { value: "  desc  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(onSave).toHaveBeenCalledTimes(1);
    const saved = onSave.mock.calls[0][0] as Preset;
    expect(saved.name).toBe("Trimmed");
    expect(saved.description).toBe("desc");
    expect(saved.apps.map((a) => a.type === "app" ? a.path : a.url)).toEqual([
      "C:\\keep.exe",
      "https://keep.io",
    ]);
  });

  it("saves the picked color and icon", () => {
    const { onSave, container } = renderEdit();
    fireEvent.click(container.querySelectorAll(".color-swatch")[0]);
    fireEvent.click(container.querySelectorAll(".icon-option")[1]);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    const saved = onSave.mock.calls[0][0] as Preset;
    expect(saved.color).toBe(PRESET_COLORS[0]);
    expect(saved.icon).toBe(PRESET_ICONS[1]);
  });

  it("searches the full lucide catalog and picks a non-curated icon", () => {
    const { onSave } = renderEdit();
    // 'airplay' is outside the curated PRESET_ICONS set.
    fireEvent.change(screen.getByPlaceholderText(/search icons/i), {
      target: { value: "airplay" },
    });
    expect(screen.getByTitle("airplay")).toBeInTheDocument();
    expect(screen.queryByTitle("briefcase")).toBeNull(); // curated set filtered out

    fireEvent.click(screen.getByTitle("airplay"));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    const saved = onSave.mock.calls[0][0] as Preset;
    expect(saved.icon).toBe("airplay");
  });

  it("uploads a custom image and saves it as a data:-URL icon", async () => {
    const { onSave, container } = renderEdit();
    const fileInput = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    const file = new File(["png-bytes"], "icon.png", { type: "image/png" });
    fireEvent.change(fileInput, { target: { files: [file] } });

    const preview = await screen.findByAltText("custom");
    expect(preview.getAttribute("src")).toMatch(/^data:image\/png;base64,/);

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    const saved = onSave.mock.calls[0][0] as Preset;
    expect(saved.icon).toMatch(/^data:image\/png;base64,/);
  });

  it("shows a dry empty state when no icon matches", () => {
    renderEdit();
    fireEvent.change(screen.getByPlaceholderText(/search icons/i), {
      target: { value: "zzzznotanicon" },
    });
    expect(screen.getByText(/no icons match/i)).toBeInTheDocument();
  });

  it("cancels without saving", () => {
    const { onSave, onCancel } = renderEdit();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("fills the item path from the app picker", async () => {
    renderEdit(makePreset({ apps: [newAppItem()] }));
    fireEvent.click(screen.getByTitle("Select from installed apps"));

    const modal = await screen.findByText("Select Application");
    fireEvent.click(await within(modal.closest(".modal") as HTMLElement).findByText("Notepad"));

    expect(pathInputs()[0].value).toBe("C:\\notepad.exe");
    expect(screen.queryByText("Select Application")).toBeNull();
  });

  it("shows edit title for existing presets and new title otherwise", () => {
    renderEdit(makePreset({ name: "Work" }));
    expect(screen.getByText("Edit: Work")).toBeInTheDocument();
  });

  it("shows the new-preset title for unnamed presets", () => {
    renderEdit(makePreset({ name: "" }));
    expect(screen.getByText("New Preset")).toBeInTheDocument();
  });
});
