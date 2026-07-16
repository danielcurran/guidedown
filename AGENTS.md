# faqmd — GameFAQs Walkthrough to Markdown Converter

## Purpose
Converts GameFAQs plain-text walkthroughs into clean, readable markdown files with a table of contents, internal anchor links, and properly formatted sections.

## Repository Separation
This repo contains the **converter tool** and **opencode agent skills** only. Walkthrough content and the [gamemds.org](https://gamemds.org) site are in a separate repo:
- **[gamemds](https://github.com/danielcurran/gamemds)** — hosted walkthrough content (HTML, reader app, guide files, deploy workflow) at [gamemds.org](https://gamemds.org)

## Tech Stack
- Node.js (>=18)
- Zero npm dependencies — all scripts use Node.js built-ins only

## Key Files
- `scripts/convert.js` — CLI entry point: fetch a GameFAQs walkthrough, parse, and write markdown
- `scripts/split-guide.js` — Split a large walkthrough markdown into per-section files for mobile-friendly browsing
- `lib/convert-core.js` — Core conversion logic used by `scripts/convert.js`
- `lib/cli.js` — Shared zero-dependency CLI argument parsing helpers
- `lib/reformat/index.js` — Public reformatting API
- `lib/reformat/detect.js` — Block-type detection (prose, table, ASCII art, stat block, decorative)
- `lib/reformat/format.js` — Per-block formatting (prose, tables, boss cards, stat blocks, etc.)
- `lib/reformat/classify.js` — Content classification helpers
- `scripts/reformat.js` — Backward-compatible wrapper around `lib/reformat`
- `scripts/test.js` — Standalone test runner (also available as `npm test`)
- `scripts/fetch-achievements.js` — Fetches RA achievement data for any game ID, optionally with Comments API data
- `scripts/validate-achievements.js` — Validates achievements.json schema and cross-references sections against toc.json
- `scripts/sync-skills.js` — Copies repo skill files to `~/.config/opencode/skills/` (run via `npm run sync-skills`)
- `package.json` — Defines `npm test`, `npm run convert`, `npm run sync-skills`, and Node engine requirement
- `.github/workflows/test.yml` — CI: runs `npm test` on push/PR
- `skills/SKILL.md` — opencode agent skill for converting walkthroughs
- `skills/retroachievements-skill.md` — opencode agent skill for AI-powered achievement matching
- `skills/reformat-review-skill.md` — opencode agent skill for reviewing reformatter edge cases
- `skills/live-review-skill.md` — opencode agent skill for final QA on split guide directories
- `.gitignore` — Ignores node_modules/, generated walkthrough files, and guide/ (local artifact only)

## Conventions
- Converter output is saved as `walkthrough.md` by default
- Large guides (>500KB) should be split with `split-guide.js` for mobile readability
- Split output goes in `guide/`: `index.md` + `toc.json` + `meta.json` + one file per section named `<section-num>-<slug>.md`
- `meta.json` contains `title`, `subtitle`, `author`, `source`, and `attributionHtml` for the gamemds reader app
- Anchor IDs: replace dots with hyphens, prefix with `s` (e.g., `s6-4-8`)
- ASCII art wrapped in code blocks; reformatter extracts plain text from boss cards, stat blocks, and shop tables
- Equipment tables stay in code blocks, not treated as markdown tables
- TOC appears twice in source (intro + body) — only parse the intro TOC
- Run `npm test` before committing any change to converter logic, reformatting rules, or skills
- Do not commit generated `walkthrough.md`, `guide/`, or `node_modules/`

## Adding New Formats

When `detectFormat()` returns `"unknown"` for a walkthrough, add the new format
to `lib/convert-core.js` so future conversions of that type work automatically.
Never write a one-off custom script.

**Pattern for each new format:**

1. **Detection** — Add a regex to `detectFormat()` that uniquely identifies the
   format's section delimiter pattern (before the `return 'unknown'` fallback)
2. **TOC parser** — `parseXxxTOC(text)` → `[{ num, title, code?, level }]`
3. **Section splitter** — `splitXxxSections(text, tocEntries)` → `[{ num, title, level, content }]`
4. **Export** — Add both functions to `module.exports` in `convert-core.js`
5. **Registry** — Add to the `FORMATS` object in `scripts/convert.js` with `parse`, `split`, and `label`
6. **Tests** — Add tests to `scripts/test.js` for detection, TOC parsing, and section splitting
7. **Verify** — Run `npm test`

See the existing formats (roman, plain, arrow, bracket, dash) in `lib/convert-core.js`
as examples. Each format is self-contained with its own parse and split functions.

## Usage
Convert: node scripts/convert.js [--title=NAME] [--author=NAME] <gamefaqs-print-url>
Split: node scripts/split-guide.js <input.md> [output-dir]
Fetch Achievements: node scripts/fetch-achievements.js --game=<id> [--output=FILE] [--comments]
Validate Achievements: node scripts/validate-achievements.js guide/achievements.json
Test: npm test

## Agent Skills

This repo is the source of truth for all faqmd-related opencode skills. The
skill files live in `skills/` and are mirrored in `.opencode/skills/<name>/SKILL.md`
for per-repo discovery.

Globally installed copies also live under `~/.config/opencode/skills/` so the
skills are available outside this repo. When editing a skill, update the file
in `skills/` first, then run `npm run sync-skills` to copy the changed files to
`~/.config/opencode/skills/`.

| Skill | File | Purpose |
|---|---|---|
| `faqmd` | `skills/SKILL.md` | Convert GameFAQs walkthroughs to markdown |
| `retroachievements` | `skills/retroachievements-skill.md` | Match RetroAchievements to walkthrough sections |
| `reformat-review` | `skills/reformat-review-skill.md` | Review and fix reformatter edge cases |
| `live-review` | `skills/live-review-skill.md` | Final QA on split guide directories |

## Per-Repo Opencode Config

`.opencode/opencode.json` declares the `build` agent profile. The
`.opencode/skills/` directory mirrors the skills above for per-repo
discovery. When adding or renaming a skill, update both `skills/` and
`.opencode/skills/` and run `npm run sync-skills` to update the global copies.
