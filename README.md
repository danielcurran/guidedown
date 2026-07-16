# faqmd

Convert GameFAQs walkthroughs into hyperlinked markdown — via Node.js script or
[opencode](https://opencode.ai) agent skill.

## Repository Roles

| Repo | Purpose |
|---|---|
| **faqmd** (this repo) | Converter tool + opencode agent skills |
| **[gamemds](https://github.com/danielcurran/gamemds)** | Walkthrough content hosted at [gamemds.org](https://gamemds.org) |

The tool converts walkthroughs. The site hosts the converted results.
No walkthrough content is committed to this repo.

---

## Quick Start

The converter is standalone and works for any GameFAQs walkthrough. No API
keys or accounts needed.

```bash
git clone https://github.com/danielcurran/faqmd
cd faqmd
node scripts/convert.js \
  --title="Phantasy Star IV" \
  --author="SWCINC" \
  "https://gamefaqs.gamespot.com/genesis/563334-phantasy-star-iv/faqs/31907?print=1"
```

Output is saved as `walkthrough.md`. The optional `--title` and `--author` flags
override the metadata that `split-guide.js` writes to `guide/meta.json`. For
large guides, split into mobile-friendly sections:

```bash
node scripts/split-guide.js walkthrough.md guide/
```

This creates a `guide/` directory with `index.md` + one file per section.

### Convert any walkthrough

1. Find a walkthrough on [gamefaqs.gamespot.com](https://gamefaqs.gamespot.com)
2. Click the guide, add `?print=1` to the URL
3. Run `node scripts/convert.js "<url>"`

---

## opencode Agent Skills

Four agent skills are included for use with [opencode](https://opencode.ai).
Install all skills with one command:

```bash
npm run sync-skills
```

This copies all skill files to `~/.config/opencode/skills/` so they are
available globally. Per-repo copies in `.opencode/skills/` are already
included.

### faqmd — Convert walkthroughs

In opencode, paste a GameFAQs print URL and ask:

```
"convert this gamefaqs walkthrough https://gamefaqs.gamespot.com/..."
```

The agent runs `node scripts/convert.js` to fetch, parse, and reformat the walkthrough.



### reformat-review — Polish the reformatter output

Reviews and fixes edge cases in the reformatted walkthrough:

- Code blocks that should be markdown tables
- Pipe tables that should be ASCII art code blocks
- Stat blocks still embedded in prose
- Broken or misaligned tables
- Walkthrough steps that should be bullet lists

Usage: `"Run reformat-review on walkthrough.md"`

### live-review — Final QA on split guides

Verifies structural integrity of split guide directories before publishing:

- Checks all internal anchor links (cross-section and TOC)
- Validates every toc.json entry has a corresponding section file
- Confirms navigation (prev/next links) is complete
- Inspects section file naming and frontmatter

Usage: `"Run live-review on guide/"`

---

## Full Pipeline

```bash
# 1. Convert
node scripts/convert.js "https://gamefaqs.gamespot.com/.../faqs/12345?print=1"

# 2. Review and polish (optional, via opencode agent skills)
# "Run reformat-review on walkthrough.md"   — fix tables, stat blocks, bullet lists

# 3. Split (generates section files, toc.json, and achievements.md if achievements.json exists)
node scripts/split-guide.js walkthrough.md guide/

# 4. Validate
npm test

# 5. Publish — copy to gamemds repo (auto-deploys to gamemds.org)
cp -r guide/ /path/to/gamemds/guides/<game-slug>/
cd /path/to/gamemds
npm test
git add -A && git commit -m "add walkthrough" && git push
```

---

## Output Features

- **Table of Contents** with clickable anchor links to every section
- **Proper heading levels** (`#`, `##`, `###`) matching the guide's structure
- **Prose unwrapped from code blocks** — readable at normal font size on mobile
- **Boss cards** (HP, EXP, MST, weaknesses, recommended levels) extracted as clean bold stat blocks — no more broken tables
- **Shop listings** rendered as grouped bullet lists with item — price (bonus) per store
- **Character sheets** (join info, initial stats, equipment, techniques, skills) extracted as plain text
- **ASCII art portraits** stripped to a clean profile line (`Name — Race (Class) · Age · Sex · Lives`)
- **Equipment tables** converted to markdown pipe tables
- **Stat blocks** (party info, enemy data) formatted as bold `**Key:** Value`; multi-column layouts now parsed correctly
- **ASCII art** (maps, dungeon layouts) preserved in code blocks
- **Paragraph breaks** at walkthrough instruction steps (Go, Turn, Take, Enter)
- **Decorative headers** (`// DUNGEON #2`) stripped to clean bold text
- **RetroAchievements** — `split-guide.js` generates a simple `achievements.md` reference page from `achievements.json`, with each achievement linking to its RetroAchievements page.
- Content-aware formatting — classifies each block and reformats accordingly

## How It Works

GameFAQs walkthroughs use several formats. The converter auto-detects the format
then parses accordingly:

| Format | Section markers |
|---|---|
| **standard** | 4-letter CCODE headers (most common) |
| **roman** | `+=====+` boxed headers with roman numerals |
| **plain** | `***` asterisk dividers with dotted numbers |
| **arrow** | `-> Title [XXX.NNN]` arrow-bracket headers |
| **bracket** | `[CCODE]` markers with underscore separators |
| **dash** | `=====`/`-----` delimited sections with indentation-based TOC |

Once the format is detected, the converter:

1. **Fetches** the `?print=1` page
2. **Extracts** text from `<pre>` tags
3. **Parses** the TOC into a section tree
4. **Splits** content at body section markers
5. **Classifies** each content block — prose, table, ASCII art, stat block, decorative, boss card, shop listing, character sheet, character portrait
6. **Reformats** each type — prose to paragraphs, tables to markdown, art to code blocks, stats to bold labels, boss cards/shops/character sheets to plain-text extractions, portraits to profile lines
7. **Strips** simple decorations (`// DUNGEON`, `\ Boss:`) to clean bold text
8. **Generates** a TOC with anchor links

## Files

| File | Purpose |
|---|---|
| `scripts/convert.js` | CLI entry point — fetch, parse, reformat, output markdown |
| `lib/convert-core.js` | Core conversion logic used by `scripts/convert.js` |
| `lib/cli.js` | Shared zero-dependency CLI argument parsing helpers |
| `lib/reformat/index.js` | Public reformatting API |
| `lib/reformat/detect.js` | Block-type detection (prose, table, ASCII art, stat block, decorative, boss card, shop listing, character sheet, character portrait) |
| `lib/reformat/format.js` | Per-block formatting (prose, tables, boss cards, stat blocks, shop lists, character sheets, portraits, decorative text) |
| `lib/reformat/classify.js` | Content classification helpers |
| `scripts/reformat.js` | Backward-compatible wrapper around `lib/reformat` |
| `scripts/split-guide.js` | Split large output into mobile-friendly section files; generates achievements.md from achievements.json |
| `scripts/fetch-achievements.js` | Fetch RetroAchievements data for a game ID |
| `scripts/validate-achievements.js` | Validate achievements.json schema and cross-reference sections against toc.json |
| `scripts/test.js` | Standalone test runner (run via `npm test`) |
| `scripts/raw.txt` | Cached GameFAQs walkthrough for offline testing |
| `package.json` | Defines `npm test`, `npm run convert`, `npm run sync-skills`, and Node engine requirement |
| `.github/workflows/test.yml` | CI — runs `npm test` on push/PR |
| `skills/SKILL.md` | opencode agent skill — convert walkthroughs |
| `skills/retroachievements-skill.md` | opencode agent skill — match achievements to walkthrough sections |
| `skills/reformat-review-skill.md` | opencode agent skill — review and fix reformatter edge cases |
| `skills/live-review-skill.md` | opencode agent skill — final QA on split guide directories |

## Contributing

faqmd is open source and welcomes contributions! See [`CONTRIBUTING.md`](CONTRIBUTING.md) for guidelines.

- [Bug reports](.github/ISSUE_TEMPLATE/bug.yml) — something not working right
- [Feature requests](.github/ISSUE_TEMPLATE/feature.yml) — ideas for improvements
- [Walkthrough submissions](.github/ISSUE_TEMPLATE/submission.yml) — submit a converted guide for [gamemds.org](https://gamemds.org)
- [Discussions](https://github.com/danielcurran/faqmd/discussions) — questions and ideas

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md) code of conduct.
See [`SECURITY.md`](SECURITY.md) for vulnerability reporting.

## License

MIT
