import { open as dialogOpen } from "@tauri-apps/plugin-dialog";
import { Folder, Info, LayoutGrid, ShieldCheck, Shield, Eye, EyeOff, Trash2, Clock, ChevronUp, ChevronDown, Copy, CopyX } from "lucide-react";
import type { ReactNode } from "react";
import type { BrowserInfo } from "@/shared/api";
import type { LaunchItem } from "@/entities/preset";
import { isUntracked } from "@/entities/preset";
import { parseBoundedInt } from "@/shared/lib";
import { CustomSelect } from "@/shared/ui";

/** Ten minutes — a delay past that is a typo, and the backend field is a u64. */
const MAX_DELAY_MS = 600_000;

type FieldUpdate = (field: keyof LaunchItem, value: string | number | boolean | null) => void;

interface ItemEditorProps {
  item: LaunchItem;
  index: number;
  totalItems: number;
  browsers: BrowserInfo[];
  onUpdate: (index: number, field: keyof LaunchItem, value: string | number | boolean | null) => void;
  onRemove: (index: number) => void;
  onMove: (index: number, direction: -1 | 1) => void;
  onOpenAppPicker?: (index: number) => void;
}

function ToggleButton({ active, titleOn, titleOff, iconOn, iconOff, onToggle }: {
  active: boolean;
  titleOn: string;
  titleOff: string;
  iconOn: ReactNode;
  iconOff: ReactNode;
  onToggle: () => void;
}) {
  return (
    <button
      className={`btn-icon btn-icon--toggle ${active ? "active" : ""}`}
      onClick={onToggle}
      title={active ? titleOn : titleOff}
    >
      {active ? iconOn : iconOff}
    </button>
  );
}

function WebsiteFields({ item, browsers, update }: { item: LaunchItem; browsers: BrowserInfo[]; update: FieldUpdate }) {
  return (
    <>
      <input
        type="text"
        value={item.url}
        onChange={(e) => update("url", e.target.value)}
        placeholder="https://example.com"
        className="app-path"
      />
      <CustomSelect
        className="app-browser"
        value={item.browser}
        onChange={(value) => update("browser", value)}
        options={[
          { value: "default", label: "Default" },
          ...browsers.map((b) => ({ value: b.id, label: b.name })),
        ]}
      />
      <ToggleButton
        active={item.incognito}
        titleOn="Incognito mode ON"
        titleOff="Incognito mode OFF"
        iconOn={<EyeOff size={18} />}
        iconOff={<Eye size={18} />}
        onToggle={() => update("incognito", !item.incognito)}
      />
    </>
  );
}

function AppFields({ item, update, onBrowse, onOpenPicker }: {
  item: LaunchItem;
  update: FieldUpdate;
  onBrowse: () => void;
  onOpenPicker?: () => void;
}) {
  return (
    <>
      <input
        type="text"
        value={item.path}
        onChange={(e) => update("path", e.target.value)}
        placeholder="C:\Program Files\...\app.exe"
        className="app-path"
      />
      <button className="btn-icon" onClick={onBrowse} title="Browse for file">
        <Folder size={18} />
      </button>
      {onOpenPicker && (
        <button className="btn-icon" onClick={onOpenPicker} title="Select from installed apps">
          <LayoutGrid size={18} />
        </button>
      )}
      <input
        type="text"
        value={item.args}
        onChange={(e) => update("args", e.target.value)}
        placeholder="Args"
        className="app-args"
      />
      <ToggleButton
        active={item.runAsAdmin}
        titleOn="Run as Admin ON"
        titleOff="Run as Admin OFF"
        iconOn={<ShieldCheck size={18} />}
        iconOff={<Shield size={18} />}
        onToggle={() => update("runAsAdmin", !item.runAsAdmin)}
      />
      <ToggleButton
        active={item.skipIfRunning ?? true}
        titleOn="Skip if already running"
        titleOff="Always launch, even if already running"
        iconOn={<CopyX size={18} />}
        iconOff={<Copy size={18} />}
        onToggle={() => update("skipIfRunning", !(item.skipIfRunning ?? true))}
      />
    </>
  );
}

function DelayField({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="delay-group">
      <Clock size={14} />
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(parseBoundedInt(e.target.value, 0, MAX_DELAY_MS))}
        placeholder="0"
        className="app-delay"
        min={0}
        max={MAX_DELAY_MS}
        step={500}
      />
      <span className="delay-unit">ms</span>
    </div>
  );
}

function ReorderButtons({ index, total, onMove }: { index: number; total: number; onMove: (d: -1 | 1) => void }) {
  return (
    <div className="reorder-group">
      <button className="btn-icon btn-icon--reorder" onClick={() => onMove(-1)} disabled={index === 0} title="Move up">
        <ChevronUp size={14} />
      </button>
      <button className="btn-icon btn-icon--reorder" onClick={() => onMove(1)} disabled={index === total - 1} title="Move down">
        <ChevronDown size={14} />
      </button>
    </div>
  );
}

/**
 * Single launch-item row: a type badge, then the website fields (url +
 * browser + incognito) or the app fields (path + browse/app-picker + args +
 * run-as-admin + skip-if-running), followed by the delay, reorder and remove
 * controls shared by both variants.
 */
export function ItemEditor({ item, index, totalItems, browsers, onUpdate, onRemove, onMove, onOpenAppPicker }: ItemEditorProps) {
  const update: FieldUpdate = (field, value) => onUpdate(index, field, value);
  const isWebsite = item.type === "website";

  async function handleBrowse() {
    const selected = await dialogOpen({
      title: "Select Application",
      filters: [{ name: "Executables", extensions: ["exe", "bat", "cmd", "lnk"] }],
      multiple: false,
    });
    if (selected) {
      update("path", selected as string);
    }
  }

  return (
    <div className={`app-entry app-entry--${item.type}`}>
      <div className={`item-type-badge ${item.type}`}>{isWebsite ? "WEB" : "APP"}</div>
      {isUntracked(item) && (
        <span
          className="item-untracked"
          title="No process handle can be captured for this item (elevated app or default browser) — Switch & Close/Minimize and window positioning won't affect it"
        >
          <Info size={13} />
        </span>
      )}
      {isWebsite ? (
        <WebsiteFields item={item} browsers={browsers} update={update} />
      ) : (
        <AppFields
          item={item}
          update={update}
          onBrowse={handleBrowse}
          onOpenPicker={onOpenAppPicker && (() => onOpenAppPicker(index))}
        />
      )}
      <DelayField value={item.delayMs} onChange={(v) => update("delayMs", v)} />
      <ReorderButtons index={index} total={totalItems} onMove={(d) => onMove(index, d)} />
      <button className="btn-icon btn-icon--danger" onClick={() => onRemove(index)} title="Remove">
        <Trash2 size={18} />
      </button>
    </div>
  );
}
