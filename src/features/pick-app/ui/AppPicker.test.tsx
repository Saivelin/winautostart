import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AppPicker } from "./AppPicker";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
import { invoke } from "@tauri-apps/api/core";
const invokeMock = vi.mocked(invoke);

const apps = [
  { name: "Visual Studio Code", path: "C:\\vscode\\Code.exe" },
  { name: "Telegram", path: "C:\\tg\\Telegram.exe" },
];

function renderPicker() {
  const onSelect = vi.fn();
  const onClose = vi.fn();
  const utils = render(<AppPicker onSelect={onSelect} onClose={onClose} />);
  return { ...utils, onSelect, onClose };
}

beforeEach(() => {
  vi.clearAllMocks();
  invokeMock.mockImplementation(async (cmd) => {
    if (cmd === "get_start_menu_apps") return apps;
    if (cmd === "get_app_icon") return null;
    return undefined;
  });
});

describe("AppPicker", () => {
  it("shows a loading state, then the app list", async () => {
    renderPicker();
    expect(screen.getByText(/scanning installed apps/i)).toBeInTheDocument();
    expect(await screen.findByText("Visual Studio Code")).toBeInTheDocument();
    expect(screen.getByText("Telegram")).toBeInTheDocument();
  });

  it("filters by name", async () => {
    renderPicker();
    await screen.findByText("Telegram");
    fireEvent.change(screen.getByPlaceholderText(/search apps/i), {
      target: { value: "tele" },
    });
    expect(screen.getByText("Telegram")).toBeInTheDocument();
    expect(screen.queryByText("Visual Studio Code")).toBeNull();
  });

  it("filters by path", async () => {
    renderPicker();
    await screen.findByText("Telegram");
    fireEvent.change(screen.getByPlaceholderText(/search apps/i), {
      target: { value: "vscode" },
    });
    expect(screen.getByText("Visual Studio Code")).toBeInTheDocument();
    expect(screen.queryByText("Telegram")).toBeNull();
  });

  it("shows an empty state when nothing matches", async () => {
    renderPicker();
    await screen.findByText("Telegram");
    fireEvent.change(screen.getByPlaceholderText(/search apps/i), {
      target: { value: "zzz" },
    });
    expect(screen.getByText("No apps found")).toBeInTheDocument();
  });

  it("selects an app and closes", async () => {
    const { onSelect, onClose } = renderPicker();
    fireEvent.click(await screen.findByText("Telegram"));
    expect(onSelect).toHaveBeenCalledWith("C:\\tg\\Telegram.exe");
    expect(onClose).toHaveBeenCalled();
  });

  it("closes when clicking the overlay", async () => {
    const { onClose, container } = renderPicker();
    await screen.findByText("Telegram");
    fireEvent.click(container.querySelector(".modal-overlay")!);
    expect(onClose).toHaveBeenCalled();
  });

  it("does not close when clicking inside the modal", async () => {
    const { onClose } = renderPicker();
    await screen.findByText("Telegram");
    fireEvent.click(screen.getByText("Select Application"));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes via the close button", async () => {
    const { onClose } = renderPicker();
    await screen.findByText("Telegram");
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalled();
  });
});
