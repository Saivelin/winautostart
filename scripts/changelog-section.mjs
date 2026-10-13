// Prints the CHANGELOG.md section of one version (the release workflow turns it
// into the GitHub release body). Exits non-zero when the version has no
// section, so a tag pushed before the changelog is updated fails early.
// `node scripts/changelog-section.mjs 1.2.0`
import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Body of the `## [version]` section: everything between its heading and the
 * next `## ` heading, or — for the last section — the link-reference block
 * that Keep a Changelog puts at the end of the file. Trimmed; null when the
 * section is missing or empty. CRLF input is accepted.
 */
export function changelogSection(markdown, version) {
  const text = markdown.replace(/\r\n/g, "\n");
  const heading = new RegExp(`^## \\[${escapeRegExp(version)}\\][^\\n]*\\n`, "m");
  const start = heading.exec(text);
  if (!start) return null;
  const rest = text.slice(start.index + start[0].length);
  const next = /^## /m.exec(rest);
  const body = next ? rest.slice(0, next.index) : stripTrailingLinkReferences(rest);
  return body.trim() || null;
}

/**
 * Drops the `[1.0.0]: https://…` definitions that close the file. No `m`
 * flag on purpose: `$` must mean end of input, or a link definition in the
 * middle of the section followed by a blank line would be cut too.
 */
function stripTrailingLinkReferences(text) {
  return text.replace(/(?:(?:^|\n)\[[^\]\n]+\]:[ \t]*\S[^\n]*)+\s*$/, "");
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Compared through realpath so a symlinked checkout, a different drive-letter
// case or a `subst` path can't turn the CLI into a silent no-op.
function isMain() {
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMain()) {
  const version = process.argv[2];
  if (!version) {
    console.error("Usage: node scripts/changelog-section.mjs <version>");
    process.exit(2);
  }
  const root = fileURLToPath(new URL("..", import.meta.url));
  const section = changelogSection(readFileSync(`${root}CHANGELOG.md`, "utf8"), version);
  if (!section) {
    console.error(`CHANGELOG.md has no "## [${version}]" section`);
    process.exit(1);
  }
  process.stdout.write(section + "\n");
}
