// package.json is the single source of the app version: tauri.conf.json reads it
// directly, Cargo.toml/Cargo.lock can't, so this script copies it there.
// `node scripts/sync-version.mjs`          — write the version into Cargo.toml/Cargo.lock
// `node scripts/sync-version.mjs --check`  — fail if they have drifted (CI)
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const { version } = JSON.parse(readFileSync(`${root}package.json`, "utf8"));

/**
 * Range [start, end) of the TOML table whose header line matches `header`,
 * so the crate's own `version` isn't confused with a dependency's.
 */
function tableRange(content, header) {
  const match = header.exec(content);
  if (!match) return null;
  const start = match.index;
  const nextTable = /^\[/m;
  const rest = content.slice(start + match[0].length);
  const next = nextTable.exec(rest);
  return [start, next ? start + match[0].length + next.index : content.length];
}

const targets = [
  { file: "src-tauri/Cargo.toml", header: /^\[package\][ \t]*$/m },
  // Cargo.lock: one [[package]] table per crate; ours is the one named winautostart
  { file: "src-tauri/Cargo.lock", header: /^\[\[package\]\]\r?\nname = "winautostart"$/m },
];
const versionLine = /^(version\s*=\s*")([^"]+)(")/m;

const isCheck = process.argv.includes("--check");
let drifted = false;

for (const { file, header } of targets) {
  const path = `${root}${file}`;
  const content = readFileSync(path, "utf8");
  const range = tableRange(content, header);
  const table = range && content.slice(...range);
  const match = table?.match(versionLine);
  if (!match) {
    console.error(`No crate version found in ${file}`);
    process.exit(1);
  }
  const current = match[2];
  if (current === version) continue;

  if (isCheck) {
    console.error(`Version mismatch: package.json ${version}, ${file} ${current}`);
    drifted = true;
  } else {
    const updated = table.replace(versionLine, (_, before, _old, after) => before + version + after);
    writeFileSync(path, content.slice(0, range[0]) + updated + content.slice(range[1]));
    console.log(`${file}: ${current} -> ${version}`);
  }
}

if (drifted) {
  console.error("Run: node scripts/sync-version.mjs");
  process.exit(1);
}
if (isCheck) console.log(`Versions in sync: ${version}`);
