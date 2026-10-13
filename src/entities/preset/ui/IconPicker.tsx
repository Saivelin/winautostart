import { useState, useRef, useMemo } from "react";
import { icons } from "lucide-react";
import { PRESET_ICONS } from "../model/types";
import { getLucideIcon, pascalToKebab } from "./PresetIcon";

interface IconPickerProps {
  value: string;
  onChange: (icon: string) => void;
}

/**
 * Preset icon picker: search across the full lucide catalog (curated
 * PRESET_ICONS set shown until a query is typed), plus custom image upload
 * stored as a data:-URL. Controlled: the chosen icon lives in the parent.
 */
export function IconPicker({ value, onChange }: IconPickerProps) {
  const [query, setQuery] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // All lucide names in kebab form, computed once — the searchable catalog.
  const allIconNames = useMemo(() => Object.keys(icons).map(pascalToKebab), []);

  // No query → curated default set; otherwise the full lucide catalog,
  // filtered by substring and capped so the grid stays light.
  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return PRESET_ICONS;
    return allIconNames.filter((name) => name.includes(q)).slice(0, 40);
  }, [query, allIconNames]);

  function handleCustomIcon(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        onChange(reader.result);
      }
    };
    reader.readAsDataURL(file);
  }

  const isCustomImage = value.startsWith("data:");

  return (
    <div className="icon-picker">
      <input
        type="text"
        className="search-input icon-search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search icons..."
      />
      {results.length === 0 ? (
        <div className="icon-empty">No icons match your search.</div>
      ) : (
        <div className="icon-grid">
          {results.map((ic) => {
            const IconComponent = getLucideIcon(ic);
            return (
              <div
                key={ic}
                className={`icon-option ${value === ic ? "active" : ""}`}
                onClick={() => onChange(ic)}
                title={ic}
              >
                {IconComponent ? <IconComponent size={18} strokeWidth={1.75} /> : ic}
              </div>
            );
          })}
        </div>
      )}
      <div className="icon-custom-row">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/svg+xml,image/webp"
          onChange={handleCustomIcon}
          style={{ display: "none" }}
        />
        <button
          className="btn btn-secondary btn-small"
          onClick={() => fileInputRef.current?.click()}
        >
          Upload image...
        </button>
        {isCustomImage && (
          <img src={value} alt="custom" className="icon-preview" />
        )}
      </div>
    </div>
  );
}
