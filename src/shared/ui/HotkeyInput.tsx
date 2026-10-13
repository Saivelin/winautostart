import { useState } from "react";
import { captureHotkey, formatHotkey } from "@/shared/lib";

interface HotkeyInputProps {
  value: string;
  onChange: (hotkey: string) => void;
  disabled?: boolean;
}

/**
 * Key-combo picker: click to arm, then press the combination. Every keystroke
 * while armed is swallowed (a global hotkey uses Alt/Ctrl combos the browser
 * would otherwise act on), Esc cancels, and rejected combos surface the reason
 * instead of silently doing nothing. Blur disarms so a forgotten recording
 * doesn't keep eating keys.
 */
export function HotkeyInput({ value, onChange, disabled }: HotkeyInputProps) {
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function stopRecording() {
    setRecording(false);
    setError(null);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLButtonElement>) {
    e.preventDefault();
    e.stopPropagation();
    if (e.code === "Escape") {
      stopRecording();
      return;
    }
    const captured = captureHotkey(e);
    if (!captured) return;
    if ("error" in captured) {
      setError(captured.error);
      return;
    }
    onChange(captured.hotkey);
    stopRecording();
  }

  return (
    <div className="hotkey-input">
      <button
        type="button"
        className={`btn btn-small hotkey-trigger${recording ? " recording" : ""}`}
        onClick={() => (recording ? stopRecording() : setRecording(true))}
        onKeyDown={recording ? handleKeyDown : undefined}
        onBlur={stopRecording}
        disabled={disabled}
        aria-label="Global hotkey"
      >
        {recording ? "Press keys…" : formatHotkey(value)}
      </button>
      {error && <span className="hotkey-error">{error}</span>}
    </div>
  );
}
