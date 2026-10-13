import { describe, expect, it } from "vitest";
import { changelogSection } from "./changelog-section.mjs";

const changelog = `# Changelog

Intro paragraph.

## [Unreleased]

## [1.1.0] - 2026-11-01

### Added
- Something new ([#12]).

[#12]: https://example.com/pull/12

### Fixed
- A bug.

## [1.0.0] - 2026-10-13

First public release.

### Added
- Presets.

[Unreleased]: https://example.com/compare/v1.1.0...HEAD
[1.1.0]: https://example.com/compare/v1.0.0...v1.1.0
[1.0.0]: https://example.com/releases/tag/v1.0.0
`;

describe("changelogSection", () => {
  it("returns the body between the version heading and the next version, keeping inline link definitions", () => {
    expect(changelogSection(changelog, "1.1.0")).toBe(
      "### Added\n- Something new ([#12]).\n\n[#12]: https://example.com/pull/12\n\n### Fixed\n- A bug.",
    );
  });

  it("drops the trailing link-reference block for the last version", () => {
    expect(changelogSection(changelog, "1.0.0")).toBe(
      "First public release.\n\n### Added\n- Presets.",
    );
  });

  it("keeps a link definition inside the last section and drops only the closing block", () => {
    const last = `## [1.0.0] - 2026-10-13

### Fixed
- A bug ([#3]).

[#3]: https://example.com/issues/3

### Added
- Presets.

[1.0.0]: https://example.com/releases/tag/v1.0.0
`;
    expect(changelogSection(last, "1.0.0")).toBe(
      "### Fixed\n- A bug ([#3]).\n\n[#3]: https://example.com/issues/3\n\n### Added\n- Presets.",
    );
  });

  it("accepts CRLF line endings and returns LF", () => {
    expect(changelogSection(changelog.replace(/\n/g, "\r\n"), "1.0.0")).toBe(
      "First public release.\n\n### Added\n- Presets.",
    );
  });

  it("returns null for a missing version", () => {
    expect(changelogSection(changelog, "2.0.0")).toBeNull();
  });

  it("returns null for an empty section", () => {
    expect(changelogSection(changelog, "Unreleased")).toBeNull();
  });

  it("matches the version literally, not as a regex", () => {
    expect(changelogSection(changelog, "1.1.")).toBeNull();
    expect(changelogSection(changelog, "1x1x0")).toBeNull();
  });
});
