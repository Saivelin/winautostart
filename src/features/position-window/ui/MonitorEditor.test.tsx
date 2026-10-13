import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MonitorEditor } from "./MonitorEditor";
import type { LaunchItem } from "@/entities/preset";
import { newAppItem, newWebsiteItem } from "@/entities/preset";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
import { invoke } from "@tauri-apps/api/core";
const invokeMock = vi.mocked(invoke);

const monitors = [
  { index: 0, name: "\\\\.\\DISPLAY1", x: 0, y: 0, width: 1920, height: 1080, isPrimary: true },
  { index: 1, name: "\\\\.\\DISPLAY2", x: 1920, y: 0, width: 2560, height: 1440, isPrimary: false },
];

function placedApp(path: string): LaunchItem {
  return {
    ...newAppItem(),
    path,
    monitor: 0,
    posX: 100,
    posY: 50,
    posWidth: 800,
    posHeight: 600,
  };
}

function renderEditor(apps: LaunchItem[]) {
  const onUpdateItem = vi.fn();
  const utils = render(<MonitorEditor apps={apps} onUpdateItem={onUpdateItem} />);
  return { ...utils, onUpdateItem };
}

beforeEach(() => {
  vi.clearAllMocks();
  invokeMock.mockImplementation(async (cmd) => {
    if (cmd === "get_monitors") return monitors;
    return undefined;
  });
});

describe("MonitorEditor", () => {
  it("shows a loading state before monitors arrive", () => {
    invokeMock.mockImplementation(() => new Promise(() => {}));
    renderEditor([{ ...newAppItem(), path: "C:\\a.exe" }]);
    expect(screen.getByText(/loading monitors/i)).toBeInTheDocument();
  });

  it("renders all monitors with resolutions", async () => {
    renderEditor([{ ...newAppItem(), path: "C:\\a.exe" }]);
    expect(await screen.findByText(/1920x1080/)).toBeInTheDocument();
    expect(screen.getByText(/2560x1440/)).toBeInTheDocument();
  });

  it("flags the primary display and labels the others by index", async () => {
    renderEditor([{ ...newAppItem(), path: "C:\\a.exe" }]);
    await screen.findByText(/1920x1080/);
    expect(screen.getByText("PRIMARY")).toBeInTheDocument();
    expect(screen.getByText("Display 2")).toBeInTheDocument();
  });

  it("places the selected app centered at half size when a monitor is clicked", async () => {
    const { onUpdateItem } = renderEditor([{ ...newAppItem(), path: "C:\\a.exe" }]);
    fireEvent.click(await screen.findByText(/2560x1440/));
    expect(onUpdateItem).toHaveBeenCalledWith(0, {
      monitor: 1,
      monitorName: "\\\\.\\DISPLAY2",
      posX: 640,
      posY: 360,
      posWidth: 1280,
      posHeight: 720,
    });
  });

  it("clears placement via the chip's ✕", async () => {
    const { onUpdateItem, container } = renderEditor([placedApp("C:\\a.exe")]);
    await screen.findByText(/1920x1080/);
    fireEvent.click(container.querySelector(".monitor-chip-clear")!);
    expect(onUpdateItem).toHaveBeenCalledWith(0, {
      monitor: null,
      monitorName: null,
      posX: null,
      posY: null,
      posWidth: null,
      posHeight: null,
    });
  });

  it("resolves a stale monitor index by device name", async () => {
    // Index is stale (5), but the name points to a live DISPLAY2, so the rect is drawn
    const item: LaunchItem = {
      ...placedApp("C:\\a.exe"),
      monitor: 5,
      monitorName: "\\\\.\\DISPLAY2",
    };
    const { container } = renderEditor([item]);
    await screen.findByText(/1920x1080/);
    expect(container.querySelectorAll(".app-position-rect")).toHaveLength(1);
  });

  it("labels chips: hostname for websites, exe name for apps, ? for empty", async () => {
    renderEditor([
      { ...newWebsiteItem(), url: "https://example.com/page" },
      { ...newAppItem(), path: "C:\\Apps\\Tool.exe" },
      { ...newAppItem(), path: "" },
    ]);
    await screen.findByText(/1920x1080/);
    expect(screen.getByText("example.com")).toBeInTheDocument();
    expect(screen.getByText("Tool")).toBeInTheDocument();
    expect(screen.getByText("?")).toBeInTheDocument();
  });

  it("labels invalid website urls with a truncated string", async () => {
    renderEditor([{ ...newWebsiteItem(), url: "not a url" }]);
    await screen.findByText(/1920x1080/);
    expect(screen.getByText("not a url")).toBeInTheDocument();
  });

  it("maximizes a placed app on double click", async () => {
    const { onUpdateItem, container } = renderEditor([placedApp("C:\\a.exe")]);
    await screen.findByText(/1920x1080/);
    fireEvent.doubleClick(container.querySelector(".app-position-rect")!);
    expect(onUpdateItem).toHaveBeenCalledWith(0, {
      posX: 0,
      posY: 0,
      posWidth: 1920,
      posHeight: 1080,
    });
  });

  it("renders a position rect only for fully placed items", async () => {
    const { container } = renderEditor([
      placedApp("C:\\a.exe"),
      { ...newAppItem(), path: "C:\\b.exe" },
    ]);
    await screen.findByText(/1920x1080/);
    expect(container.querySelectorAll(".app-position-rect")).toHaveLength(1);
  });

  it("shows a hint while the selected app is unplaced", async () => {
    renderEditor([{ ...newAppItem(), path: "C:\\a.exe" }]);
    await screen.findByText(/1920x1080/);
    expect(screen.getByText(/click a monitor to place this app/i)).toBeInTheDocument();
  });
});
