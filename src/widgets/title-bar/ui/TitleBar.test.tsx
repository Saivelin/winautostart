import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { TitleBar } from "./TitleBar";

const winMock = vi.hoisted(() => ({
  startDragging: vi.fn(),
  minimize: vi.fn(),
  toggleMaximize: vi.fn(),
  close: vi.fn(),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => winMock,
}));

describe("TitleBar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function renderBar() {
    const { container } = render(<TitleBar />);
    const bar = container.querySelector(".titlebar") as HTMLElement;
    const [minimizeBtn, maximizeBtn, closeBtn] = Array.from(
      container.querySelectorAll<HTMLButtonElement>(".titlebar-btn")
    );
    return { bar, minimizeBtn, maximizeBtn, closeBtn };
  }

  it("starts dragging on left mousedown", () => {
    const { bar } = renderBar();
    fireEvent.mouseDown(bar, { button: 0 });
    expect(winMock.startDragging).toHaveBeenCalledTimes(1);
  });

  it("does not start dragging on right mousedown", () => {
    const { bar } = renderBar();
    fireEvent.mouseDown(bar, { button: 2 });
    expect(winMock.startDragging).not.toHaveBeenCalled();
  });

  it("does not start dragging when pressing on the window controls", () => {
    const { minimizeBtn } = renderBar();
    fireEvent.mouseDown(minimizeBtn, { button: 0 });
    expect(winMock.startDragging).not.toHaveBeenCalled();
  });

  it("minimizes the window", () => {
    const { minimizeBtn } = renderBar();
    fireEvent.click(minimizeBtn);
    expect(winMock.minimize).toHaveBeenCalledTimes(1);
  });

  it("toggles maximize", () => {
    const { maximizeBtn } = renderBar();
    fireEvent.click(maximizeBtn);
    expect(winMock.toggleMaximize).toHaveBeenCalledTimes(1);
  });

  it("closes the window", () => {
    const { closeBtn } = renderBar();
    fireEvent.click(closeBtn);
    expect(winMock.close).toHaveBeenCalledTimes(1);
  });
});
