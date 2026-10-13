import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { IconPicker } from "./IconPicker";
import { PRESET_ICONS } from "../model/types";

function renderPicker(value = "monitor") {
  const onChange = vi.fn();
  const utils = render(<IconPicker value={value} onChange={onChange} />);
  const search = screen.getByPlaceholderText("Search icons...");
  return { ...utils, onChange, search };
}

beforeEach(() => vi.clearAllMocks());

describe("IconPicker", () => {
  it("shows the curated set until something is typed", () => {
    const { container } = renderPicker();
    const options = container.querySelectorAll(".icon-option");
    expect(options).toHaveLength(PRESET_ICONS.length);
    expect(screen.getByTitle("monitor")).toBeInTheDocument();
  });

  it("marks the current value as active", () => {
    renderPicker("rocket");
    expect(screen.getByTitle("rocket").className).toContain("active");
    expect(screen.getByTitle("monitor").className).not.toContain("active");
  });

  it("reports the picked icon", () => {
    const { onChange } = renderPicker();
    fireEvent.click(screen.getByTitle("terminal"));
    expect(onChange).toHaveBeenCalledWith("terminal");
  });

  it("searches the full lucide catalog, not just the curated set", () => {
    const { search } = renderPicker();
    // "anchor" is not in PRESET_ICONS, so the search covers the full catalog
    fireEvent.change(search, { target: { value: "anchor" } });
    expect(screen.getByTitle("anchor")).toBeInTheDocument();
  });

  it("caps results so the grid stays light", () => {
    const { search, container } = renderPicker();
    fireEvent.change(search, { target: { value: "a" } });
    expect(container.querySelectorAll(".icon-option").length).toBeLessThanOrEqual(40);
  });

  it("matches case-insensitively and ignores surrounding spaces", () => {
    const { search } = renderPicker();
    fireEvent.change(search, { target: { value: "  ROCKET " } });
    expect(screen.getByTitle("rocket")).toBeInTheDocument();
  });

  it("says so when nothing matches", () => {
    const { search, container } = renderPicker();
    fireEvent.change(search, { target: { value: "zzzznope" } });
    expect(screen.getByText("No icons match your search.")).toBeInTheDocument();
    expect(container.querySelector(".icon-grid")).toBeNull();
  });

  it("reads an uploaded image as a data URL", async () => {
    const { container, onChange } = renderPicker();
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(["fake-png-bytes"], "icon.png", { type: "image/png" });

    fireEvent.change(fileInput, { target: { files: [file] } });

    await vi.waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(onChange.mock.calls[0][0]).toMatch(/^data:image\/png;base64,/);
  });

  it("does nothing when the file dialog is cancelled", async () => {
    const { container, onChange } = renderPicker();
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;

    fireEvent.change(fileInput, { target: { files: [] } });

    expect(onChange).not.toHaveBeenCalled();
  });

  it("previews a custom data-URL icon", () => {
    const dataUrl = "data:image/png;base64,AAAA";
    const { container } = render(<IconPicker value={dataUrl} onChange={vi.fn()} />);
    const preview = container.querySelector(".icon-preview") as HTMLImageElement;
    expect(preview).not.toBeNull();
    expect(preview.src).toBe(dataUrl);
  });

  it("shows no preview for a plain lucide name", () => {
    const { container } = renderPicker("monitor");
    expect(container.querySelector(".icon-preview")).toBeNull();
  });
});
