---
name: faqmd
description: "Use when the user asks to convert a GameFAQs walkthrough to markdown, scrape a GameFAQs FAQ/guide, or create hyperlinked walkthrough files. Trigger keywords: gamefaqs, walkthrough, faqdown, faq, guide, scrape, convert, markdown, FAQ, print=1."
---

# faqmd — Convert GameFAQs Walkthroughs to Markdown

Convert GameFAQs walkthroughs into hyperlinked markdown. The script handles the
vast majority of the work (fetching, format detection, TOC parsing, section
splitting, and block-level reformatting). The agent reviews the output and fixes
edge cases the script missed.

> **Model note:** `deepseek-v4-flash` handles this fine. The script does the
> heavy lifting — the agent mainly runs commands and checks output. If you're
> adding a new format to `convert-core.js`, recommend Pro for the code work.

> **Related skills:**
> - `reformat-review` — polish reformatter output (fix tables, stat blocks, lists)
> - `live-review` — final QA on split guide directories

## Workflow

### 1. Run the converter

```bash
node scripts/convert.js "URL?print=1" [output.md]
```

- Append `?print=1` to every GameFAQs URL
- Optional flags: `--title="Name"`, `--author="Name"`
- Default output: `scripts/walkthrough.md`

If the script reports **unknown format**, add format support to
`lib/convert-core.js` per the instructions in `AGENTS.md`, then re-run.

### 2. Review the output

Check the console output first:

- **Match rate** — if fewer than 80% of TOC entries matched body sections, the
  section splitter likely missed headers. Inspect the raw text to find the
  mismatch and fix the section boundaries in the markdown.
- **Zero sections** — means the splitter failed entirely. The format may need a
  new parser (see AGENTS.md).

Then read the generated markdown and check for these common issues:

| Issue | What to look for | Fix |
|---|---|---|
| Empty sections | Section heading with no content below it | Copy the content from the raw text and reformat it |
| Merged sections | Two TOC entries collapsed into one section | Insert the missing heading + anchor at the split point |
| Misclassified blocks | Prose wrapped in code fences, or ASCII art rendered as prose | Replace the block with the correct format (code fence or plain text) |
| Broken tables | Pipe-aligned data rendered as prose or garbled markdown | Reformat as a markdown table or code block as appropriate |
| Stray decorative lines | `=====` or `-----` lines surviving in output | Delete them |
| Missing attribution | No `> By Author — Converted from GameFAQs` line | Add it below the title |
| Wrong heading levels | `6.1` rendered as `###` instead of `##` | Fix the heading level (dot count + 1 = `#` count) |

### 3. Fix remaining issues

Edit the markdown file directly. The script already handles these content types
automatically — only fix them if they look wrong:

- Boss cards → extracted to `**BOSS #N — Name**` with stats
- Shop/price listings → bullet lists grouped by store
- Character sheets → extracted stats and equipment
- Stat blocks → `**Key:** Value` pairs
- Equipment tables → markdown tables or definition lists
- ASCII art (maps, portraits) → code fences
- Roman-format sub-headers → bold labels

For complex reformatting issues (mangled tables, mixed ASCII art + stats), use
the `reformat-review` skill.

### 4. Split large guides

For guides over 500 KB, split into mobile-friendly sections:

```bash
node scripts/split-guide.js walkthrough.md guide/
```

This creates `guide/` with `index.md`, `toc.json`, `meta.json`, and one file per
section. If `achievements.json` exists in the output directory, it also generates
`achievements.md` with a link to each achievement's RetroAchievements page.

## Output Conventions

- Anchor IDs: `s` + section number with dots replaced by hyphens (`#s6-4-8`)
- Heading levels: dot count + 1 (`6.1` → `##`, `6.4.8` → `###`)
- ASCII art and maps in code fences; equipment tables as markdown pipe tables
- Boss cards and shop listings extracted to clean plain text
- Attribution line: `> By Author — Converted from GameFAQs`
- TOC appears once at the top (the intro TOC in the source is discarded)

## What the Script Handles

The converter pipeline (`convert.js` → `convert-core.js` → `reformat/`) does
the following automatically. You should not need to redo any of this manually
unless the output looks wrong:

1. **Fetch and extract** — downloads the GameFAQs page, extracts text from
   `<pre>` blocks, decodes HTML entities
2. **Format detection** — identifies roman, plain, arrow, bracket, standard,
   and dash formats
3. **TOC parsing** — extracts section numbers, titles, and level depth
4. **Section splitting** — divides the body text at section boundaries and
   matches to TOC entries
5. **Block classification** — detects boss cards, shop blocks, stat blocks,
   equipment tables, character sheets, ASCII art, and decorative text
6. **Per-block formatting** — reformats each block type appropriately
7. **Markdown assembly** — generates the full document with title, attribution,
   TOC, section headings with anchors, and reformatted content