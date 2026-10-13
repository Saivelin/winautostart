interface AutoStartPromptProps {
  onRespond: (yes: boolean) => void;
}

/** First-run question: register the app in Windows autostart? Shown once (autoStartAsked flag). */
export function AutoStartPrompt({ onRespond }: AutoStartPromptProps) {
  return (
    <div className="container">
      <div className="autostart-prompt">
        <h2>Run at startup?</h2>
        <p>Would you like WinAutoStart to launch automatically when Windows starts?</p>
        <div className="btn-row">
          <button className="btn btn-primary" onClick={() => onRespond(true)}>
            Yes, enable autostart
          </button>
          <button className="btn btn-secondary" onClick={() => onRespond(false)}>
            No, thanks
          </button>
        </div>
      </div>
    </div>
  );
}
