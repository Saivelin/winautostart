import { useState, useEffect, useRef } from "react";
import { X } from "lucide-react";
import { getAppIcon, getStartMenuApps } from "@/shared/api";
import type { InstalledApp } from "@/shared/api";

interface AppPickerProps {
  onSelect: (path: string) => void;
  onClose: () => void;
}

function AppPickerItem({ app, onClick }: { app: InstalledApp; onClick: () => void }) {
  const [icon, setIcon] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const loadedRef = useRef(false);

  useEffect(() => {
    if (loadedRef.current) return;
    const el = ref.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !loadedRef.current) {
          loadedRef.current = true;
          observer.disconnect();
          getAppIcon(app.path)
            .then((ic) => { if (ic) setIcon(ic); })
            .catch(() => {});
        }
      },
      { threshold: 0 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [app.path]);

  return (
    <div ref={ref} className="app-picker-item" onClick={onClick}>
      {icon ? (
        <img src={icon} alt="" className="app-picker-icon" />
      ) : (
        <div className="app-picker-icon app-picker-icon--placeholder" />
      )}
      <div className="app-picker-text">
        <div className="app-picker-name">{app.name}</div>
        <div className="app-picker-path">{app.path}</div>
      </div>
    </div>
  );
}

/**
 * Modal listing installed apps from the Start Menu scan, with search by name
 * or path. Icons load lazily (IntersectionObserver → get_app_icon) as rows
 * scroll into view.
 */
export function AppPicker({ onSelect, onClose }: AppPickerProps) {
  const [apps, setApps] = useState<InstalledApp[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getStartMenuApps()
      .then(setApps)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const query = search.toLowerCase();
  const filtered = apps.filter(
    (a) => a.name.toLowerCase().includes(query) || a.path.toLowerCase().includes(query)
  );

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Select Application</h2>
          <button className="btn btn-small btn-secondary" onClick={onClose} aria-label="Close" title="Close">
            <X size={14} />
          </button>
        </div>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search apps..."
          className="search-input"
          autoFocus
        />
        <div className="app-picker-list">
          {loading ? (
            <div className="app-picker-loading">Scanning installed apps...</div>
          ) : filtered.length === 0 ? (
            <div className="app-picker-empty">
              <div className="app-picker-empty-title">No apps found</div>
              <div className="app-picker-empty-hint">Try a different search term.</div>
            </div>
          ) : (
            filtered.map((app, i) => (
              <AppPickerItem
                key={i}
                app={app}
                onClick={() => {
                  onSelect(app.path);
                  onClose();
                }}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}
