import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ItemEditor } from "./ItemEditor";
import type { BrowserInfo } from "@/shared/api";
import type { LaunchItem } from "@/entities/preset";
import { newAppItem, newWebsiteItem } from "@/entities/preset";

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
import { open } from "@tauri-apps/plugin-dialog";
const openMock = vi.mocked(open);

const browsers: BrowserInfo[] = [
  { id: "google-chrome", name: "Google Chrome", path: "C:\\chrome.exe" },
  { id: "firefox", name: "Firefox", path: "C:\\firefox.exe" },
];

function makeHandlers() {
  return { onUpdate: vi.fn(), onRemove: vi.fn(), onMove: vi.fn(), onOpenAppPicker: vi.fn() };
}

function renderItem(item: LaunchItem, index = 0, totalItems = 3) {
  const handlers = makeHandlers();
  const utils = render(
    <ItemEditor
      item={item}
      index={index}
      totalItems={totalItems}
      browsers={browsers}
      {...handlers}
    />
  );
  return { ...utils, handlers };
}

beforeEach(() => vi.clearAllMocks());

describe("ItemEditor (app)", () => {
  it("renders the APP badge with path and args inputs", () => {
    renderItem({ ...newAppItem(), path: "C:\\a.exe", args: "--x" });
    expect(screen.getByText("APP")).toBeInTheDocument();
    expect(screen.getByDisplayValue("C:\\a.exe")).toBeInTheDocument();
    expect(screen.getByDisplayValue("--x")).toBeInTheDocument();
  });

  it("shows the untracked hint only for elevated apps", () => {
    const { container, rerender } = render(
      <ItemEditor
        item={newAppItem()}
        index={0}
        totalItems={1}
        browsers={browsers}
        {...makeHandlers()}
      />
    );
    expect(container.querySelector(".item-untracked")).toBeNull();

    rerender(
      <ItemEditor
        item={{ ...newAppItem(), runAsAdmin: true }}
        index={0}
        totalItems={1}
        browsers={browsers}
        {...makeHandlers()}
      />
    );
    expect(container.querySelector(".item-untracked")).not.toBeNull();
  });

  it("shows the untracked hint for default-browser websites only", () => {
    const { container, rerender } = render(
      <ItemEditor
        item={newWebsiteItem()}
        index={0}
        totalItems={1}
        browsers={browsers}
        {...makeHandlers()}
      />
    );
    expect(container.querySelector(".item-untracked")).not.toBeNull();

    rerender(
      <ItemEditor
        item={{ ...newWebsiteItem(), browser: "google-chrome" }}
        index={0}
        totalItems={1}
        browsers={browsers}
        {...makeHandlers()}
      />
    );
    expect(container.querySelector(".item-untracked")).toBeNull();
  });

  it("updates the path", () => {
    const { handlers } = renderItem(newAppItem());
    fireEvent.change(screen.getByPlaceholderText(/program files/i), {
      target: { value: "C:\\new.exe" },
    });
    expect(handlers.onUpdate).toHaveBeenCalledWith(0, "path", "C:\\new.exe");
  });

  it("updates the args", () => {
    const { handlers } = renderItem(newAppItem());
    fireEvent.change(screen.getByPlaceholderText("Args"), { target: { value: "-v" } });
    expect(handlers.onUpdate).toHaveBeenCalledWith(0, "args", "-v");
  });

  it("updates the delay as a number", () => {
    const { handlers } = renderItem(newAppItem());
    fireEvent.change(screen.getByPlaceholderText("0"), { target: { value: "1500" } });
    expect(handlers.onUpdate).toHaveBeenCalledWith(0, "delayMs", 1500);
  });

  it("clamps a typed negative delay to zero", () => {
    // A negative value would reach the Rust u64 and break save_config
    const { handlers } = renderItem(newAppItem());
    fireEvent.change(screen.getByPlaceholderText("0"), { target: { value: "-1" } });
    expect(handlers.onUpdate).toHaveBeenCalledWith(0, "delayMs", 0);
  });

  it("caps an absurd delay at ten minutes", () => {
    const { handlers } = renderItem(newAppItem());
    fireEvent.change(screen.getByPlaceholderText("0"), { target: { value: "99999999" } });
    expect(handlers.onUpdate).toHaveBeenCalledWith(0, "delayMs", 600_000);
  });

  it("toggles skip-if-running", () => {
    const { handlers } = renderItem(newAppItem());
    fireEvent.click(screen.getByTitle("Skip if already running"));
    expect(handlers.onUpdate).toHaveBeenCalledWith(0, "skipIfRunning", false);
  });

  it("shows the always-launch state when skipping is off", () => {
    const { handlers } = renderItem({ ...newAppItem(), skipIfRunning: false });
    fireEvent.click(screen.getByTitle("Always launch, even if already running"));
    expect(handlers.onUpdate).toHaveBeenCalledWith(0, "skipIfRunning", true);
  });

  it("toggles run-as-admin", () => {
    const { handlers } = renderItem(newAppItem());
    fireEvent.click(screen.getByTitle("Run as Admin OFF"));
    expect(handlers.onUpdate).toHaveBeenCalledWith(0, "runAsAdmin", true);
  });

  it("browses for an executable via the file dialog", async () => {
    openMock.mockResolvedValue("C:\\picked.exe");
    const { handlers } = renderItem(newAppItem());
    fireEvent.click(screen.getByTitle("Browse for file"));
    await vi.waitFor(() =>
      expect(handlers.onUpdate).toHaveBeenCalledWith(0, "path", "C:\\picked.exe")
    );
  });

  it("does not update the path when the dialog is cancelled", async () => {
    openMock.mockResolvedValue(null);
    const { handlers } = renderItem(newAppItem());
    fireEvent.click(screen.getByTitle("Browse for file"));
    await vi.waitFor(() => expect(openMock).toHaveBeenCalled());
    expect(handlers.onUpdate).not.toHaveBeenCalled();
  });

  it("opens the app picker", () => {
    const { handlers } = renderItem(newAppItem(), 2);
    fireEvent.click(screen.getByTitle("Select from installed apps"));
    expect(handlers.onOpenAppPicker).toHaveBeenCalledWith(2);
  });

  it("moves the item up and down", () => {
    const { handlers } = renderItem(newAppItem(), 1);
    fireEvent.click(screen.getByTitle("Move up"));
    expect(handlers.onMove).toHaveBeenCalledWith(1, -1);
    fireEvent.click(screen.getByTitle("Move down"));
    expect(handlers.onMove).toHaveBeenCalledWith(1, 1);
  });

  it("disables move up on the first item and move down on the last", () => {
    renderItem(newAppItem(), 0, 1);
    expect(screen.getByTitle("Move up")).toBeDisabled();
    expect(screen.getByTitle("Move down")).toBeDisabled();
  });

  it("removes the item", () => {
    const { handlers } = renderItem(newAppItem(), 1);
    fireEvent.click(screen.getByTitle("Remove"));
    expect(handlers.onRemove).toHaveBeenCalledWith(1);
  });
});

describe("ItemEditor (website)", () => {
  it("renders the WEB badge with a url input and browser select", () => {
    const { container } = renderItem({ ...newWebsiteItem(), url: "https://a.io" });
    expect(screen.getByText("WEB")).toBeInTheDocument();
    expect(screen.getByDisplayValue("https://a.io")).toBeInTheDocument();
    fireEvent.click(container.querySelector(".custom-select-trigger")!);
    expect(screen.getByRole("option", { name: "Google Chrome" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Firefox" })).toBeInTheDocument();
  });

  it("updates the url", () => {
    const { handlers } = renderItem(newWebsiteItem());
    fireEvent.change(screen.getByPlaceholderText("https://example.com"), {
      target: { value: "https://b.io" },
    });
    expect(handlers.onUpdate).toHaveBeenCalledWith(0, "url", "https://b.io");
  });

  it("updates the browser via the custom dropdown", () => {
    const { handlers, container } = renderItem(newWebsiteItem());
    fireEvent.click(container.querySelector(".custom-select-trigger")!);
    fireEvent.click(screen.getByRole("option", { name: "Firefox" }));
    expect(handlers.onUpdate).toHaveBeenCalledWith(0, "browser", "firefox");
  });

  it("toggles incognito", () => {
    const { handlers } = renderItem(newWebsiteItem());
    fireEvent.click(screen.getByTitle("Incognito mode OFF"));
    expect(handlers.onUpdate).toHaveBeenCalledWith(0, "incognito", true);
  });
});
