---
name: reformat-review
description: "Use when the user asks to review and fix a reformatted walkthrough for mobile readability. Trigger keywords: reformat, review, fix formatting, check tables, cleanup, polish."
---

# reformat-review — Fix Reformatter Edge Cases

Reviews a reformatted walkthrough and fixes edge cases the automated reformatter
missed. The reformatter (`lib/reformat/`) handles the bulk of content
reformatting — this skill is a targeted review pass for what slips through.

> **Related skills:**
> - `faqmd` — converts the walkthrough (calls reformat internally)
> - `live-review` — final QA on split guide directories

> **Model note:** `deepseek-v4-flash` handles this fine. The scans are
> prescriptive checklists — the agent follows rules, not deep reasoning.

## What the reformatter already handles

The `reformat()` function in `lib/reformat/` runs automatically during
conversion. It correctly formats:

- **Boss cards** → `**BOSS #N — Name**` with HP/EXP/weakness stats
- **Shop/price listings** → bullet lists grouped by store
- **Character sheets** → extracted stats and equipment
- **Stat blocks** → `**Key:** Value` pairs (when ≥30% of lines match)
- **Equipment tables** → markdown tables or definition lists
- **ASCII art** (maps, portraits) → code fences
- **Decorative text** → bold labels stripped of frame characters
- **Roman-format sub-headers** → bold labels from `+----+` boxes

Only fix these if they look wrong in the output. Do not redo correct work.

## When to use

After running the converter:

```bash
node scripts/convert.js "URL?print=1" walkthrough.md
```

Then review the output. Do NOT run `scripts/reformat.js` separately —
`convert.js` already calls `reformat()` internally.

---

## Instructions for the agent

Read the specified file or directory. Run these five scans in order. Do NOT
modify the file until all scans are complete. After fixing, print a summary.

### Scan 1: Code blocks that should be tables

The reformatter sometimes misclassifies equipment tables as ASCII art, wrapping
them in code fences.

Find every ` ``` ` code block. For each block:

1. Do at least 2 lines contain `|` characters?
2. Are pipe positions consistent (same `|` count across lines)?
3. Do cells between pipes contain mostly words (≥50% of non-empty cells have
   2+ consecutive letters)?

If **all three**: extract and rebuild as a markdown pipe table.

### Scan 2: Pipe tables that should be code blocks

Some ASCII layouts (maps, menus) have consistent pipes but are decorative, not
tabular data.

Find every markdown pipe table (line starting with `|` + separator `|---|---|`).
For each:

1. Count "word cells" (2+ consecutive letters) vs. "symbol cells" (no letters).
2. If ≥50% of non-empty cells are symbol-only: rewrap as a code block.

### Scan 3: Stat blocks still in prose

The reformatter requires ≥30% of lines to match `Key: Value` to trigger the
stat-block formatter. Mixed blocks that narrowly miss the threshold leave stat
lines as plain text.

Scan for lines matching `/^\w[\w\s]+\s*:\s*\w+/` that are NOT already formatted
as `**Key:** Value`. For each match:

- Is the key short (1-5 words)?
- Is it NOT part of a full sentence (no following clause with verbs)?
- Is the line in a prose paragraph, not a code block?

If all three: extract, format as `**Key:** Value`, place as a standalone line.

Skip lines that are clearly prose (e.g., "The elder explains:").

### Scan 4: Broken tables

`formatTable` can produce misaligned tables when the original has varying pipe
counts or merged cells.

For each markdown pipe table:

1. Count columns in the separator row.
2. Count columns in each data row. If any row differs from the separator, the
   table is broken.
3. If the original code block is nearby (from Scan 1), use it to rebuild.
   Otherwise flag for manual fix.

### Scan 5: Action sequences as bullet lists

Walkthrough sections often contain step-by-step instructions that read better as
lists than dense paragraphs.

Find sequences of 3+ consecutive sentences where each starts with an action
verb (Go, Head, Walk, Take, Enter, Leave, Use, Follow, Continue, Turn, Collect,
Pick up, Open, Search, Return). Format as a markdown list (`- sentence` or
`1. sentence` if sequentially numbered).

Keep descriptive paragraphs as-is. A sequence must have at least 3 action-verb
sentences to qualify.

### After all scans

```
reformat-review complete
  Scan 1 (code blocks → tables):  N fixed
  Scan 2 (tables → code blocks):  N fixed
  Scan 3 (stat blocks in prose):  N fixed
  Scan 4 (broken tables):         N fixed (M flagged for manual)
  Scan 5 (bullet lists):          N sequences formatted
  ────────────────────────────
  Total: N issues handled
```

If no issues in a scan, print `0 fixed`.

---

## Edge cases

- **File not found**: print `File not found: <path>` and exit.
- **No markdown content**: print `No markdown content detected` and exit.
- **Broken table can't be fixed**: leave as-is, flag in the summary.
- **Directory input**: process all `.md` files in the directory.
- **Section filter**: if the user specifies a section range (e.g.,
  "check sections 6.1-6.4"), only process matching files or content.
- **Overlapping fixes**: if Scans 1 and 2 disagree about a block, tables with
  mostly-word cells stay as tables. Art with mostly-symbol cells goes to code.