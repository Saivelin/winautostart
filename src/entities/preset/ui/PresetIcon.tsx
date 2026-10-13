import { icons, Monitor } from "lucide-react";
import type { LucideIcon } from "lucide-react";

/**
 * lucide ships components under PascalCase keys ("Briefcase", "CodeXml",
 * "Gamepad2"); our config stores the kebab name ("briefcase", "code-xml",
 * "gamepad-2"). These helpers convert between the two so any of lucide's
 * ~1700 icons can be looked up by its kebab name.
 */
export function kebabToPascal(name: string): string {
  return name
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

export function pascalToKebab(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([a-zA-Z])([0-9])/g, "$1-$2")
    .toLowerCase();
}

/** Resolves a lucide kebab-case name to its component, or undefined if unknown. */
export function getLucideIcon(name: string): LucideIcon | undefined {
  return (icons as Record<string, LucideIcon>)[kebabToPascal(name)];
}

/**
 * Preset icon rendered by priority: a data:-URL as an image; any lucide icon
 * name (kebab-case) as its component; any other non-empty string as text
 * (legacy emoji from older configs); an empty icon falls back to the Monitor
 * glyph.
 */
export function PresetIcon({ icon, color }: { icon: string; color?: string }) {
  const style = color ? { color } : {};

  if (icon.startsWith("data:")) {
    return <div className="preset-icon-wrap" style={style}><img src={icon} alt="" /></div>;
  }

  const LucideComponent = getLucideIcon(icon);
  if (LucideComponent) {
    return <div className="preset-icon-wrap" style={style}><LucideComponent size={22} strokeWidth={1.75} /></div>;
  }

  if (icon) {
    return <div className="preset-icon-wrap" style={style}>{icon}</div>;
  }

  return <div className="preset-icon-wrap" style={style}><Monitor size={22} strokeWidth={1.75} /></div>;
}
