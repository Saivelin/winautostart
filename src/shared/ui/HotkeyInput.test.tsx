import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { HotkeyInput } from "./HotkeyInput";

function renderInput(value = "Ctrl+Alt+W", disabled = false) {
  const onChange = vi.fn();
  const utils = render(<HotkeyInput value={value} onChange={onChange} disabled={disabled} />);
  return { ...utils, onChange, trigger: screen.getByRole("button", { name: "Global hotkey" }) };
}

describe("HotkeyInput", () => {
  it("shows the current combo and ignores keys until armed", () => {
    const { trigger, onChange } = renderInput();
    expect(trigger).toHaveTextContent("Ctrl + Alt + W");

    fireEvent.keyDown(trigger, { code: "KeyK", ctrlKey: true, altKey: true });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("captures a combo once armed", () => {
    const { trigger, onChange } = renderInput();
    fireEvent.click(trigger);
    expect(trigger).toHaveTextContent("Press keys…");

    fireEvent.keyDown(trigger, { code: "KeyK", ctrlKey: true, altKey: true });
    expect(onChange).toHaveBeenCalledWith("Ctrl+Alt+K");
    expect(trigger).toHaveTextContent("Ctrl + Alt + W"); // value is owned by the parent
  });

  it("keeps recording while modifiers are held", () => {
    const { trigger, onChange } = renderInput();
    fireEvent.click(trigger);
    fireEvent.keyDown(trigger, { code: "ControlLeft", ctrlKey: true });

    expect(onChange).not.toHaveBeenCalled();
    expect(trigger).toHaveTextContent("Press keys…");
  });

  it("explains why a combo was rejected and stays armed", () => {
    const { trigger, onChange } = renderInput();
    fireEvent.click(trigger);
    fireEvent.keyDown(trigger, { code: "KeyK", shiftKey: true });

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText("A global hotkey needs Ctrl or Alt")).toBeInTheDocument();
    expect(trigger).toHaveTextContent("Press keys…");
  });

  it("cancels recording on Escape and on blur", () => {
    const { trigger, onChange } = renderInput();
    fireEvent.click(trigger);
    fireEvent.keyDown(trigger, { code: "Escape" });
    expect(trigger).toHaveTextContent("Ctrl + Alt + W");

    fireEvent.click(trigger);
    fireEvent.blur(trigger);
    expect(trigger).toHaveTextContent("Ctrl + Alt + W");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("can't be armed while disabled", () => {
    const { trigger } = renderInput("Ctrl+Alt+W", true);
    expect(trigger).toBeDisabled();
    fireEvent.click(trigger);
    expect(trigger).toHaveTextContent("Ctrl + Alt + W");
  });
});
