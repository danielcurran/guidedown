# Contributing to faqmd

Thanks for wanting to contribute! Here's how to get started.

## Getting Started

1. Fork the repo.
2. Clone your fork: `git clone https://github.com/<your-username>/faqmd`
3. Ensure you have Node.js >= 18.
4. No `npm install` needed — zero dependencies.

## Making Changes

1. Create a branch: `git checkout -b my-feature`
2. Make your changes.
3. Run tests: `npm test`
4. If you changed conversion logic, also test against a real walkthrough:
   ```bash
   node scripts/convert.js "https://gamefaqs.gamespot.com/.../faqs/12345?print=1"
   ```

## Code Style

- **No comments** in source code unless the logic genuinely requires one.
- **No new dependencies** — the project uses Node.js built-ins only. If you need a library, open an issue first to discuss.
- Follow existing patterns in `lib/` and `scripts/`.
- Use `const` / `let`, not `var`.
- 2-space indentation.

## Testing

- Tests live in `scripts/test.js`.
- Run `npm test` to run the full suite.
- Add tests for any new functionality.
- Tests use Node.js built-in `assert` and `test` runner — no test framework needed.

## Commit Messages

Use conventional commits:

```
feat: add support for X
fix: correct Y parsing
refactor: extract Z into its own module
docs: update README
chore: bump version
```

## Pull Requests

Before submitting:

- [ ] `npm test` passes
- [ ] Your branch is up to date with `main`
- [ ] Commit messages follow conventional commits
- [ ] If adding a feature, consider adding a test
- [ ] If fixing a bug, add a test that catches the regression

## Project Structure

```
lib/
  cli.js              CLI argument parsing
  convert-core.js     Core conversion logic
  reformat/
    index.js          Public reformatting API
    detect.js         Block-type detection
    format.js         Per-block formatting
    classify.js       Content classification helpers
scripts/
  convert.js          CLI entry point
  split-guide.js      Split walkthrough into sections
  reformat.js         Backward-compatible reformat wrapper
  fetch-achievements.js   Fetch RetroAchievements data
  validate-achievements.js Validate achievements.json
  test.js             Test runner
  sync-skills.js      Sync opencode skills
skills/
  SKILL.md            opencode agent skill
  retroachievements-skill.md
  reformat-review-skill.md
```

## Questions?

Open a [discussion](https://github.com/danielcurran/faqmd/discussions) or [issue](https://github.com/danielcurran/faqmd/issues).
