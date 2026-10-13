import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AutoStartPrompt } from "./AutoStartPrompt";

describe("AutoStartPrompt", () => {
  it("calls onRespond(true) when accepting", async () => {
    const onRespond = vi.fn();
    render(<AutoStartPrompt onRespond={onRespond} />);
    await userEvent.click(screen.getByRole("button", { name: /yes, enable autostart/i }));
    expect(onRespond).toHaveBeenCalledWith(true);
  });

  it("calls onRespond(false) when declining", async () => {
    const onRespond = vi.fn();
    render(<AutoStartPrompt onRespond={onRespond} />);
    await userEvent.click(screen.getByRole("button", { name: /no, thanks/i }));
    expect(onRespond).toHaveBeenCalledWith(false);
  });
});
