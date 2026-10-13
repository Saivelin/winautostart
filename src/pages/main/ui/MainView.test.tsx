import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MainView } from "./MainView";
import type { Config, LaunchItem } from "@/entities/preset";
import { newAppItem } from "@/entities/preset";

function makeConfig(overrides: Partial<Config> = {}): Config {
  const app: LaunchItem = { ...newAppItem(), path: "C:\\a.exe" };
  return {
    defaultPreset: "p1",
    timeoutSeconds: 30,
    autoStartAsked: true,
    closePreviousApps: false,
    hotkey: "Ctrl+Alt+W",
    hotkeyEnabled: true,
    presets: [
      { id: "p1", name: "Work", description: "Work stuff", color: "#fff", icon: "W", apps: [app, { ...app }] },
      { id: "p2", name: "Gaming", description: "Games", color: "#000", icon: "G", apps: [{ ...app }] },
    ],
    ...overrides,
  };
}

function makeHandlers() {
  return {
    onSelect: vi.fn(),
    onLaunch: vi.fn(),
    onSwitch: vi.fn(),
    onSwitchMinimize: vi.fn(),
    onSkip: vi.fn(),
    onSettings: vi.fn(),
  };
}

function renderMain(config = makeConfig(), props: Partial<Parameters<typeof MainView>[0]> = {}) {
  const handlers = makeHandlers();
  const utils = render(
    <MainView
      config={config}
      selectedId="p1"
      countdown={10}
      launching={false}
      progress={[]}
      launchError={null}
      {...handlers}
      {...props}
    />
  );
  return { ...utils, handlers, config };
}

describe("MainView", () => {
  it("shows preset, item and timeout stats", () => {
    renderMain();
    expect(screen.getByText("2")).toBeInTheDocument(); // presets
    expect(screen.getByText("3")).toBeInTheDocument(); // total items
    expect(screen.getByText("30s")).toBeInTheDocument(); // timeout
  });

  it("renders all presets with item counts", () => {
    renderMain();
    expect(screen.getByText("Work")).toBeInTheDocument();
    expect(screen.getByText("Gaming")).toBeInTheDocument();
    expect(screen.getByText("2 items")).toBeInTheDocument();
    expect(screen.getByText("1 item")).toBeInTheDocument();
  });

  it("selects a preset on click", () => {
    const { handlers } = renderMain();
    fireEvent.click(screen.getByText("Gaming"));
    expect(handlers.onSelect).toHaveBeenCalledWith("p2");
  });

  it("launches a preset on double click", () => {
    const { handlers } = renderMain();
    fireEvent.doubleClick(screen.getByText("Gaming"));
    expect(handlers.onLaunch).toHaveBeenCalledWith("p2");
  });

  it("shows auto-launch countdown with the default preset name", () => {
    renderMain();
    expect(screen.getByText('Auto-launch "Work" in 10s')).toBeInTheDocument();
  });

  it("shows auto-skip countdown when no default preset", () => {
    renderMain(makeConfig({ defaultPreset: "" }));
    expect(screen.getByText("Auto-skip in 10s")).toBeInTheDocument();
  });

  it("hides the countdown when it reaches zero", () => {
    renderMain(makeConfig(), { countdown: 0 });
    expect(screen.queryByText(/auto-launch/i)).toBeNull();
  });

  it("hides the countdown when timeout is disabled", () => {
    renderMain(makeConfig({ timeoutSeconds: 0 }));
    expect(screen.queryByText(/auto-launch/i)).toBeNull();
  });

  it("launches the selected preset via the Launch button", () => {
    const { handlers } = renderMain();
    fireEvent.click(screen.getByRole("button", { name: "Launch" }));
    expect(handlers.onLaunch).toHaveBeenCalled();
  });

  it("disables action buttons when nothing is selected", () => {
    renderMain(makeConfig(), { selectedId: "" });
    expect(screen.getByRole("button", { name: "Launch" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Switch & Close" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Switch & Minimize" })).toBeDisabled();
  });

  it("disables action buttons and shows progress while launching", () => {
    renderMain(makeConfig(), { launching: true });
    expect(screen.getByRole("button", { name: "Launching..." })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Switch & Close" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Switch & Minimize" })).toBeDisabled();
  });

  it("invokes switch handlers", () => {
    const { handlers } = renderMain();
    fireEvent.click(screen.getByRole("button", { name: "Switch & Close" }));
    expect(handlers.onSwitch).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Switch & Minimize" }));
    expect(handlers.onSwitchMinimize).toHaveBeenCalled();
  });

  it("skips via the Skip button", () => {
    const { handlers } = renderMain();
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    expect(handlers.onSkip).toHaveBeenCalled();
  });

  it("opens settings", () => {
    const { handlers } = renderMain();
    fireEvent.click(screen.getByTitle("Settings"));
    expect(handlers.onSettings).toHaveBeenCalled();
  });

  it("renders launch progress items with statuses", () => {
    renderMain(makeConfig(), {
      progress: [
        { index: 0, total: 3, label: "C:\\ok.exe", status: "ok" },
        { index: 1, total: 3, label: "C:\\skip.exe", status: "skipped" },
        { index: 2, total: 3, label: "C:\\bad.exe", status: "failed", error: "not found" },
      ],
    });
    expect(screen.getByText("C:\\ok.exe")).toBeInTheDocument();
    expect(screen.getByText("already running")).toBeInTheDocument();
    expect(screen.getByText("not found")).toBeInTheDocument();
  });

  it("renders nothing for empty progress", () => {
    const { container } = renderMain();
    expect(container.querySelector(".launch-progress")).toBeNull();
  });

  it("shows a done/total header while items are still launching", () => {
    renderMain(makeConfig(), {
      progress: [
        { index: 0, total: 3, label: "C:\\ok.exe", status: "ok" },
        { index: 1, total: 3, label: "C:\\next.exe", status: "launching" },
      ],
    });
    expect(screen.getByText("Launching 1/3…")).toBeInTheDocument();
  });

  it("hides the header when every item settled", () => {
    renderMain(makeConfig(), {
      progress: [
        { index: 0, total: 2, label: "C:\\a.exe", status: "ok" },
        { index: 1, total: 2, label: "C:\\b.exe", status: "failed", error: "x" },
      ],
    });
    expect(screen.queryByText(/Launching \d/)).toBeNull();
  });

  it("shows the launch error banner", () => {
    renderMain(makeConfig(), { launchError: "Lock error: poisoned" });
    expect(screen.getByText("Lock error: poisoned")).toBeInTheDocument();
  });
});
