import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CustomSelect } from "./CustomSelect";

const options = [
  { value: "a", label: "Alpha" },
  { value: "b", label: "Beta" },
  { value: "c", label: "Gamma" },
];

function renderSelect(value = "a") {
  const onChange = vi.fn();
  const utils = render(<CustomSelect value={value} options={options} onChange={onChange} />);
  const trigger = utils.container.querySelector(".custom-select-trigger") as HTMLElement;
  return { ...utils, onChange, trigger };
}

describe("CustomSelect", () => {
  it("shows the selected label and keeps the menu closed initially", () => {
    const { trigger } = renderSelect("b");
    expect(trigger).toHaveTextContent("Beta");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("falls back to the placeholder when no option matches", () => {
    const onChange = vi.fn();
    const { container } = render(
      <CustomSelect value="" options={options} onChange={onChange} placeholder="Pick one" />
    );
    expect(container.querySelector(".custom-select-trigger")).toHaveTextContent("Pick one");
  });

  it("opens on click and marks the current option selected", () => {
    const { trigger } = renderSelect("b");
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Beta" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("option", { name: "Alpha" })).toHaveAttribute("aria-selected", "false");
  });

  it("selects an option on click and closes", () => {
    const { trigger, onChange } = renderSelect("a");
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("option", { name: "Gamma" }));
    expect(onChange).toHaveBeenCalledWith("c");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("opens with Enter and closes with Escape", () => {
    const { trigger } = renderSelect();
    fireEvent.keyDown(trigger, { key: "Enter" });
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    fireEvent.keyDown(trigger, { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("navigates with arrows and selects with Enter", () => {
    const { trigger, onChange } = renderSelect("a");
    fireEvent.keyDown(trigger, { key: "ArrowDown" }); // open, active on selected (a)
    fireEvent.keyDown(trigger, { key: "ArrowDown" }); // -> b
    fireEvent.keyDown(trigger, { key: "ArrowDown" }); // -> c
    fireEvent.keyDown(trigger, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith("c");
  });

  it("closes when clicking outside", () => {
    const { trigger } = renderSelect();
    fireEvent.click(trigger);
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("listbox")).toBeNull();
  });
});
