---
name: live-review
description: "Use when the user asks to review a walkthrough as it renders on gamemds.org for final polish and quality. Trigger keywords: live-review, site-qa, gamemds review, final check, polish live, verify guide."
---

# live-review — Final QA on Split Guide Directories

Reviews a split walkthrough guide directory for structural integrity, cross-reference
consistency, and rendering quality. This is the final gate before committing —
it checks things that only exist after `split-guide.js` has produced `toc.json`,
`meta.json`, and section files.

> **Related skills:**
> - `faqmd` — converts the walkthrough (runs first)
> - `reformat-review` — fixes formatting edge cases (runs second)

> **Model note:** `deepseek-v4-flash` handles this fine. The scans are
> structural checks against `toc.json` and section files — rule-following,
> not deep reasoning.

## When to use

After converting, reformatting, and splitting:

```bash
node scripts/convert.js "URL?print=1" walkthrough.md
# (reformat-review if needed)
node scripts/split-guide.js walkthrough.md guide/
```

Then in opencode:

```
"Run live-review on guide/"
"Run live-review on guide/ — check links only"
"Final QA on guide/"
```

Do NOT run `scripts/reformat.js` separately — `convert.js` already calls
`reformat()` internally.

---

## Instructions for the agent

Read the guide directory. Run these scans in order. Do NOT modify any file until
all scans are complete. After fixing, print a summary report.

### Scan 1: Structural integrity

1. Read `guide/toc.json`. For every entry with a `file` field, verify that file
   exists in the guide directory.
2. Read every `guide/*.md` file NOT in `toc.json` — these are orphans. Flag them.
3. Verify `guide/meta.json` has all required fields: `title`, `subtitle`,
   `author`, `source`, `attributionHtml`.
4. Verify `guide/search-index.json` exists and is valid JSON.

### Scan 2: Anchor and link consistency

1. For every entry in `toc.json`, verify its `num` field matches the anchor ID
   in its section file. Anchor ID format: `s` + num with dots replaced by
   hyphens (e.g., `6.4.8` → `s6-4-8`). The section file should contain
   `<a id="s6-4-8"></a>`.
2. For every internal link `[text](#s...)` in section files, verify the target
   anchor exists.
3. For every internal link `[text](filename.md)`, verify the file exists.
4. For every internal link `[text](filename.md#s...)`, verify both the file and
   anchor exist.

### Scan 3: Content quality

Check for rendering problems that degrade readability on mobile.

1. **Empty sections**: Any section file with fewer than 100 characters of actual
   content (excluding anchor tags, headings, and blank lines). Flag it.
2. **Duplicate headings**: No two section files should have the same heading
   text at the same level.
3. **Heading hierarchy**: Within each section file, headings should not skip
   levels (e.g., `##` followed by `####` with no `###` in between).
4. **Raw HTML leaks**: Any HTML tags other than `<a id="..."></a>` should be
   flagged. The reader app renders markdown, not arbitrary HTML.
5. **Oversized code blocks**: Any code block exceeding 40 lines should be
   flagged — hard to scroll on mobile.

Note: broken tables and misclassified blocks should be caught by
`reformat-review` before this stage. If found here, run reformat-review first.

### Scan 4: Mobile rendering

Estimate how content renders on a 375px-wide viewport.

1. **Wide tables**: Any markdown table row exceeding 60 characters of cell
   content will likely overflow. Flag it.
2. **Long unbroken lines**: Any line exceeding 80 characters without a space
   or hyphen will not wrap. Flag it.
3. **Code block width**: Any code block line exceeding 40 characters. Flag
   blocks where more than half the lines exceed this.
4. **Dense paragraphs**: Any paragraph exceeding 5 lines without a break.
   Flag for potential splitting.

### Scan 5: TOC and navigation

1. Every section file must appear in `toc.json` exactly once.
2. Section numbering must be sequential — no gaps (e.g., jumping from 6.3 to
   6.5 without 6.4).
3. The `depth` field in `toc.json` must match the heading level implied by the
   section number (0 dots = depth 0, 1 dot = depth 1, etc.).

### After all scans

```
live-review complete
  Scan 1 (structural integrity):    N errors, M warnings
  Scan 2 (anchors and links):        N broken links fixed, M flagged
  Scan 3 (content quality):          N issues found
  Scan 4 (mobile rendering):         N issues found
  Scan 5 (TOC and navigation):       N errors, M warnings
  ────────────────────────────
  Total: N issues (E errors, W warnings, I nits)
```

Severity levels:
- **Error** (must fix): broken links, missing files, invalid JSON, incorrect
  cross-references
- **Warning** (should fix): empty sections, oversized code blocks, wide
  tables, heading hierarchy skips
- **Nit** (nice to fix): dense paragraphs, long unbroken lines, minor style

For each issue, report the **file path and line number** so the user can fix it
directly.

---

## Fix workflow

When the user asks to fix issues found by live-review:

1. Edit the **source** `walkthrough.md` or section `.md` files in `guide/`.
2. Re-run `node scripts/split-guide.js walkthrough.md guide/` to regenerate
   `toc.json`, `meta.json`, `search-index.json`, and section files.
3. Re-run live-review to verify fixes.

Do NOT edit `toc.json`, `meta.json`, or `search-index.json` directly — they
are generated by `split-guide.js` and will be overwritten.

---

## Edge cases

- **Directory not found**: print `Directory not found: <path>` and exit.
- **No toc.json**: print `No toc.json found — run split-guide.js first` and exit.
- **Section filter**: if the user specifies a section range (e.g., "check sections 6.1-6.4"), only process matching section files. Always run structural and TOC scans on the full directory.
- **Live site check**: if the user provides a gamemds.org URL, optionally fetch the rendered page with `webfetch` and compare the live HTML structure against local files. This catches CSS/rendering issues that local checks cannot.