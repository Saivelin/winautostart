import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, fireEvent } from "@testing-library/react";
import type { MouseEvent as ReactMouseEvent, RefObject } from "react";
import { useWindowDrag } from "./useWindowDrag";
import type { MonitorInfo } from "@/shared/api";
import type { LaunchItem } from "@/entities/preset";
import { newAppItem } from "@/entities/preset";

const MONITORS: MonitorInfo[] = [
  { index: 0, name: "\\\\.\\DISPLAY1", x: 0, y: 0, width: 1920, height: 1080, isPrimary: true },
];

/** Canvas 480px wide over a 1920px desktop → 1 dragged pixel = 4 monitor px. */
const CANVAS: RefObject<HTMLDivElement | null> = {
  current: { clientWidth: 480 } as HTMLDivElement,
};

function placedItem(overrides: Partial<LaunchItem> = {}): LaunchItem {
  return {
    ...newAppItem(),
    path: "C:\\a.exe",
    monitor: 0,
    monitorName: "\\\\.\\DISPLAY1",
    posX: 100,
    posY: 100,
    posWidth: 800,
    posHeight: 600,
    ...overrides,
  };
}

function mouseDownAt(x: number, y: number): ReactMouseEvent {
  return { clientX: x, clientY: y } as ReactMouseEvent;
}

function setup(items: LaunchItem[], monitors = MONITORS) {
  const onUpdateItem = vi.fn();
  const { result } = renderHook(() => useWindowDrag(items, monitors, CANVAS, onUpdateItem));
  return { startDrag: result.current, onUpdateItem };
}

beforeEach(() => vi.clearAllMocks());

describe("useWindowDrag", () => {
  it("translates a move drag into monitor coordinates", () => {
    const item = placedItem();
    const { startDrag, onUpdateItem } = setup([item]);

    act(() => startDrag(0, "move", mouseDownAt(0, 0), item));
    fireEvent.mouseMove(window, { clientX: 25, clientY: 10 });

    // 25 px on the canvas = 100 px on the monitor at 480/1920 scale
    expect(onUpdateItem).toHaveBeenCalledWith(0, { posX: 200, posY: 140 });
  });

  it("keeps a moved window inside its monitor", () => {
    const item = placedItem();
    const { startDrag, onUpdateItem } = setup([item]);

    act(() => startDrag(0, "move", mouseDownAt(0, 0), item));
    fireEvent.mouseMove(window, { clientX: 10_000, clientY: 10_000 });
    expect(onUpdateItem).toHaveBeenLastCalledWith(0, { posX: 1120, posY: 480 });

    fireEvent.mouseMove(window, { clientX: -10_000, clientY: -10_000 });
    expect(onUpdateItem).toHaveBeenLastCalledWith(0, { posX: 0, posY: 0 });
  });

  it("translates a resize drag into width and height", () => {
    const item = placedItem();
    const { startDrag, onUpdateItem } = setup([item]);

    act(() => startDrag(0, "resize", mouseDownAt(0, 0), item));
    fireEvent.mouseMove(window, { clientX: 25, clientY: 25 });

    expect(onUpdateItem).toHaveBeenCalledWith(0, { posWidth: 900, posHeight: 700 });
  });

  it("clamps a resize to the minimum size and to the monitor edge", () => {
    const item = placedItem();
    const { startDrag, onUpdateItem } = setup([item]);

    act(() => startDrag(0, "resize", mouseDownAt(0, 0), item));
    fireEvent.mouseMove(window, { clientX: -10_000, clientY: -10_000 });
    expect(onUpdateItem).toHaveBeenLastCalledWith(0, { posWidth: 100, posHeight: 80 });

    fireEvent.mouseMove(window, { clientX: 10_000, clientY: 10_000 });
    // Cannot grow beyond the monitor space right/below the window position
    expect(onUpdateItem).toHaveBeenLastCalledWith(0, { posWidth: 1820, posHeight: 980 });
  });

  it("stops updating after the mouse is released", () => {
    const item = placedItem();
    const { startDrag, onUpdateItem } = setup([item]);

    act(() => startDrag(0, "move", mouseDownAt(0, 0), item));
    fireEvent.mouseUp(window);
    onUpdateItem.mockClear();

    fireEvent.mouseMove(window, { clientX: 100, clientY: 100 });
    expect(onUpdateItem).not.toHaveBeenCalled();
  });

  it("ignores movement before a drag starts", () => {
    const { onUpdateItem } = setup([placedItem()]);
    fireEvent.mouseMove(window, { clientX: 50, clientY: 50 });
    expect(onUpdateItem).not.toHaveBeenCalled();
  });

  it("does nothing for an item without placement", () => {
    const item = newAppItem();
    const { startDrag, onUpdateItem } = setup([item]);

    act(() => startDrag(0, "move", mouseDownAt(0, 0), item));
    fireEvent.mouseMove(window, { clientX: 25, clientY: 25 });

    expect(onUpdateItem).not.toHaveBeenCalled();
  });

  it("does nothing when the item's monitor is gone", () => {
    // Monitor disconnected: gone by both name and index
    const item = placedItem({ monitor: 3, monitorName: "\\\\.\\DISPLAY4" });
    const { startDrag, onUpdateItem } = setup([item]);

    act(() => startDrag(0, "move", mouseDownAt(0, 0), item));
    fireEvent.mouseMove(window, { clientX: 25, clientY: 25 });

    expect(onUpdateItem).not.toHaveBeenCalled();
  });

  it("resolves the monitor by device name across a reshuffle", () => {
    const reshuffled: MonitorInfo[] = [
      { index: 0, name: "\\\\.\\DISPLAY9", x: 0, y: 0, width: 1920, height: 1080, isPrimary: true },
      { index: 1, name: "\\\\.\\DISPLAY1", x: 1920, y: 0, width: 1280, height: 720, isPrimary: false },
    ];
    // The same item now targets the second, narrower monitor, so clamps differ
    const item = placedItem({ monitor: 0, posWidth: 1000, posHeight: 600 });
    const { startDrag, onUpdateItem } = setup([item], reshuffled);

    act(() => startDrag(0, "move", mouseDownAt(0, 0), item));
    fireEvent.mouseMove(window, { clientX: 10_000, clientY: 10_000 });

    expect(onUpdateItem).toHaveBeenLastCalledWith(0, { posX: 280, posY: 120 });
  });
});
