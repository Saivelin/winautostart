import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MonitorChips, getAppLabel, itemColor } from "./MonitorChips";
import type { LaunchItem } from "@/entities/preset";
import { newAppItem, newWebsiteItem, PRESET_COLORS } from "@/entities/preset";

function placed(item: LaunchItem): LaunchItem {
  return { ...item, monitor: 0, posX: 0, posY: 0, posWidth: 800, posHeight: 600 };
}

function renderChips(items: LaunchItem[], selectedItem: number | null = null) {
  const handlers = { onSelect: vi.fn(), onClear: vi.fn() };
  const utils = render(
    <MonitorChips
      appItems={items.map((item, index) => ({ item, index }))}
      selectedItem={selectedItem}
      {...handlers}
    />
  );
  return { ...utils, handlers };
}

beforeEach(() => vi.clearAllMocks());

describe("getAppLabel", () => {
  it("uses the hostname of a website", () => {
    expect(getAppLabel({ ...newWebsiteItem(), url: "https://mail.google.com/u/0" }))
      .toBe("mail.google.com");
  });

  it("falls back to a truncated url when it does not parse", () => {
    expect(getAppLabel({ ...newWebsiteItem(), url: "not a url at all, really" }))
      .toBe("not a url at all, re");
  });

  it("uses the exe name without extension for apps", () => {
    expect(getAppLabel({ ...newAppItem(), path: "C:\\Program Files\\App\\Code.exe" }))
      .toBe("Code");
    expect(getAppLabel({ ...newAppItem(), path: "C:/tools/run.bat" })).toBe("run.bat");
  });

  it("falls back to ? for empty items", () => {
    expect(getAppLabel(newAppItem())).toBe("?");
    expect(getAppLabel(newWebsiteItem())).toBe("?");
  });
});

describe("itemColor", () => {
  it("walks the preset palette and wraps around", () => {
    expect(itemColor(0)).toBe(PRESET_COLORS[0]);
    expect(itemColor(PRESET_COLORS.length)).toBe(PRESET_COLORS[0]);
    expect(itemColor(PRESET_COLORS.length + 2)).toBe(PRESET_COLORS[2]);
  });
});

describe("MonitorChips", () => {
  it("renders one chip per item, labeled", () => {
    renderChips([
      { ...newAppItem(), path: "C:\\a\\Editor.exe" },
      { ...newWebsiteItem(), url: "https://example.com" },
    ]);
    expect(screen.getByRole("button", { name: /Editor/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /example\.com/ })).toBeInTheDocument();
  });

  it("selects an unselected chip and deselects the selected one", () => {
    const items = [{ ...newAppItem(), path: "C:\\a\\Editor.exe" }];
    const { handlers, rerender } = renderChips(items);
    fireEvent.click(screen.getByRole("button", { name: /Editor/ }));
    expect(handlers.onSelect).toHaveBeenCalledWith(0);

    rerender(
      <MonitorChips
        appItems={items.map((item, index) => ({ item, index }))}
        selectedItem={0}
        {...handlers}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /Editor/ }));
    expect(handlers.onSelect).toHaveBeenLastCalledWith(null);
  });

  it("marks a placed item and offers clearing it", () => {
    const { container, handlers } = renderChips([placed({ ...newAppItem(), path: "C:\\a\\Editor.exe" })]);
    const chip = container.querySelector(".monitor-chip")!;
    expect(chip.className).toContain("placed");

    fireEvent.click(container.querySelector(".monitor-chip-clear")!);
    expect(handlers.onClear).toHaveBeenCalledWith(0);
    // Clicking ✕ must not also toggle the chip selection
    expect(handlers.onSelect).not.toHaveBeenCalled();
  });

  it("offers no clear control for an unplaced item", () => {
    const { container } = renderChips([newAppItem()]);
    expect(container.querySelector(".monitor-chip-clear")).toBeNull();
    expect(container.querySelector(".monitor-chip")!.className).not.toContain("placed");
  });

  it("highlights the selected chip", () => {
    const { container } = renderChips([newAppItem(), newAppItem()], 1);
    const chips = container.querySelectorAll(".monitor-chip");
    expect(chips[0].className).not.toContain("active");
    expect(chips[1].className).toContain("active");
  });
});
