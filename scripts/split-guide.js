#!/usr/bin/env node
// Split a large walkthrough markdown into per-section files with navigation

const fs = require('fs');
const path = require('path');
const { parseArgs, showHelp, validateInputFile } = require('../lib/cli');
const { anchorId } = require('../lib/reformat/utils');

const SCRIPT_NAME = 'faqmd-split';

function main() {
  const cli = parseArgs(process.argv.slice(2));

  if (cli.help) {
    showHelp(SCRIPT_NAME, 'Split a walkthrough markdown file into per-section files.', {
      usage: '<input.md> [output-dir]',
      examples: [
        'faqmd-split walkthrough.md',
        'faqmd-split walkthrough.md guide-psiv',
      ]
    });
    return;
  }

  const inputFile = cli.positional[0];
  const outputDir = cli.positional[1] || 'guide';

  validateInputFile(inputFile);
  const md = fs.readFileSync(inputFile, 'utf8');
  const lines = md.split('\n');

  // Find where the header (title, author, TOC) ends and sections begin
  let headerEnd = 0;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].match(/<a id="s\d/)) {
      headerEnd = i;
      break;
    }
  }

  const header = lines.slice(0, headerEnd).join('\n');

  // Extract walkthrough metadata from the header block
  function extractMeta(src) {
    const titleMatch = src.match(/^#\s+(.+)$/m);
    const authorMatch = src.match(/^>\s+By\s+(.+?)\s+—/m);
    const title = titleMatch ? titleMatch[1].trim() : 'Walkthrough';
    const author = authorMatch ? authorMatch[1].trim() : 'Unknown Author';
    return {
      title,
      subtitle: 'Guide and Walkthrough',
      author,
      source: 'GameFAQs',
      attributionHtml: 'Walkthrough by ' + author + ' — Converted with <a href="https://github.com/danielcurran/faqmd" target="_blank" rel="noopener">faqmd</a>'
    };
  }
  const meta = extractMeta(header);

  // Find all section boundaries by scanning anchor tags
  const anchorLines = [];
  for (let i = headerEnd; i < lines.length; i++) {
    const m = lines[i].match(/<a id="(s\d+(?:-\d+)*)"><\/a>/);
    if (m) {
      anchorLines.push({ line: i, anchor: m[1] });
    }
  }

  // Build sections from anchor boundaries
  const rawSections = [];
  for (let a = 0; a < anchorLines.length; a++) {
    const startLine = anchorLines[a].line;
    const endLine = a + 1 < anchorLines.length ? anchorLines[a + 1].line : lines.length;
    const body = lines.slice(startLine, endLine).join('\n').trim();
    rawSections.push({ anchor: anchorLines[a].anchor, body });
  }

  // Detect stub sections: heading + anchor tags only, no real prose content
  // Short sections with substantive text (100+ chars beyond headings) are not stubs
  function isStub(section) {
    if (section.body.length >= 500) return false;
    const stripped = section.body
      .replace(/<a id="[^"]*"><\/a>/g, '')
      .replace(/^#+\s+.*$/gm, '')
      .replace(/^\s*$/gm, '')
      .trim();
    return stripped.length < 100;
  }

  // Merge stub sections into their next non-stub sibling
  // When multiple stubs precede a real section, all their headings are prepended
  // Track stub→target mapping for TOC redirects
  const stubTargets = {}; // stubAnchor → targetSection
  const sections = [];
  for (let a = 0; a < rawSections.length; a++) {
    if (isStub(rawSections[a])) {
      // Collect consecutive stubs
      const stubs = [rawSections[a]];
      while (a + 1 < rawSections.length && isStub(rawSections[a + 1])) {
        stubs.push(rawSections[++a]);
      }
      // Prepend stub headings to the next non-stub section
      if (a + 1 < rawSections.length) {
        const target = rawSections[a + 1];
        const prefixLines = [];
        for (const stub of stubs) {
          const bodyLines = stub.body.split('\n');
          for (const l of bodyLines) {
            if (l.match(/^<a id=/) || l.match(/^#+\s/)) prefixLines.push(l);
          }
          stubTargets[stub.anchor] = target;
        }
        target.body = prefixLines.join('\n') + '\n\n' + target.body;
      }
    } else {
      sections.push(rawSections[a]);
    }
  }
  console.log(`Merged ${rawSections.length - sections.length} stub sections`);

  // Extract section number from anchor (e.g. "s6-4-8" → "6.4.8")
  function getNumber(anchor) {
    return anchor.replace(/^s/, '').replace(/-/g, '.');
  }

  // Extract heading text from section body (use the first heading)
  function getHeading(body) {
    const bodyLines = body.split('\n');
    for (const line of bodyLines) {
      const hMatch = line.match(/^#+\s+(.+)/);
      if (hMatch) return hMatch[1].trim();
    }
    return '';
  }

  // Create a URL-safe slug from heading text
  function slugify(text) {
    let s = text.toLowerCase();
    s = s.replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '');
    s = s.replace(/[^a-z0-9\s-']/g, '');
    s = s.replace(/\s+/g, '-');
    s = s.replace(/'/g, '');
    s = s.replace(/-+/g, '-');
    s = s.replace(/^-+|-+$/g, '');
    return s || 'section';
  }

  // Assign filenames to real sections
  for (const s of sections) {
    const num = getNumber(s.anchor);
    const title = getHeading(s.body);
    const strippedTitle = title.replace(new RegExp(`^${num.replace(/\./g, '\\.')}\.?\\s*`), '');
    const slug = slugify(strippedTitle) || slugify(title);
    s.filename = `${num}-${slug}.md`;
    s.num = num;
    s.title = title;
    s.strippedTitle = strippedTitle;
  }

  // Build full TOC from rawSections (including stubs for proper tree hierarchy)
  const tocEntries = [];
  const sectionMap = new Map(sections.map(s => [s.num, s]));
  for (const rs of rawSections) {
    const num = getNumber(rs.anchor);
    const title = getHeading(rs.body);
    const strippedTitle = title.replace(new RegExp(`^${num.replace(/\./g, '\\.')}\.?\\s*`), '');
    const depth = (num.match(/\./g) || []).length;
    // Get the real section's filename (redirect stubs)
    let filename = null;
    const real = sectionMap.get(num);
    if (real) {
      filename = real.filename;
    } else if (stubTargets[rs.anchor]) {
      filename = stubTargets[rs.anchor].filename;
    }
    tocEntries.push({ num, title, strippedTitle, filename, depth, anchor: rs.anchor });
  }

  // Build search index: word → [section numbers]
  const searchIndex = {};
  const stopWords = new Set(['the', 'and', 'for', 'you', 'this', 'that', 'with', 'from',
    'are', 'was', 'has', 'have', 'not', 'but', 'can', 'all', 'will', 'one', 'its', 'your',
    'been', 'were', 'they', 'their', 'what', 'when', 'how', 'who', 'which', 'each', 'into',
    'about', 'over', 'than', 'then', 'also', 'very', 'just', 'here', 'there', 'more',
    'some', 'only', 'other', 'after', 'before', 'between']);

  for (const s of sections) {
    const text = s.body.replace(/<[^>]+>/g, ' ').replace(/[^a-zA-Z0-9\s]/g, ' ').toLowerCase();
    const words = new Set(text.split(/\s+/).filter(w => w.length > 1 && !stopWords.has(w)));
    for (const w of words) {
      if (!searchIndex[w]) searchIndex[w] = [];
      if (!searchIndex[w].includes(s.num)) {
        searchIndex[w].push(s.num);
      }
    }
  }

  // Search index stats
  const uniqueTerms = Object.keys(searchIndex).length;
  console.log(`Search index: ${uniqueTerms} unique terms`);

  // Create output directory
  const resolved = path.resolve(outputDir);
  const cwd = process.cwd();
  if (resolved === '/' || resolved === cwd || resolved === path.resolve(cwd, '/')) {
    console.error('Error: output directory must not be the root or working directory');
    process.exit(1);
  }
  if (path.dirname(resolved) !== resolved && !fs.existsSync(path.dirname(resolved))) {
    console.error('Error: parent directory does not exist: ' + path.dirname(resolved));
    process.exit(1);
  }
  const achPath = path.join(outputDir, 'achievements.json');
  let savedAchievements = null;
  if (fs.existsSync(achPath)) {
    savedAchievements = fs.readFileSync(achPath, 'utf8');
  }
  fs.rmSync(outputDir, { recursive: true, force: true });
  fs.mkdirSync(outputDir, { recursive: true });
  if (savedAchievements) {
    fs.writeFileSync(achPath, savedAchievements);
  }

  // Write section files
  console.log(`Writing ${sections.length} sections...`);
  const sizes = [];
  for (let i = 0; i < sections.length; i++) {
    const s = sections[i];
    fs.writeFileSync(path.join(outputDir, s.filename), s.body + '\n');
    sizes.push(s.body.length);
  }

  // Build index.md with search note
  let indexContent = header.split('\n');

  // Update TOC links
  const newTocLines = [];
  for (const line of indexContent) {
    const tocMatch = line.match(/^(\s*-\s+\[)(.+?)(\]\(#)(s[\d-]+)(\)\s*)$/);
    if (tocMatch) {
      const anchor = tocMatch[4];
      let entry = sections.find(s => s.anchor === anchor);
      if (!entry && stubTargets[anchor]) {
        entry = stubTargets[anchor];
      }
      if (entry && entry.filename) {
        newTocLines.push(`${tocMatch[1]}${tocMatch[2]}](${entry.filename})`);
      } else {
        newTocLines.push(line);
      }
    } else {
      newTocLines.push(line);
    }
  }

  // Insert search tip after the title block
  const titleIdx = newTocLines.findIndex(l => l.startsWith('> By'));
  const searchTip = [
    '',
    '> 💡 **Tip:** Press `t` in the GitHub app or website to search across all section files.',
    '',
  ];
  newTocLines.splice(titleIdx + 1, 0, ...searchTip);

  indexContent = newTocLines;

  // Add section file listing at the bottom
  indexContent.push('');
  indexContent.push('---');
  indexContent.push('');
  indexContent.push('## All Sections');
  indexContent.push('');
  for (const e of tocEntries) {
    const indent = '  '.repeat(e.depth);
    const link = e.filename ? `[${e.num}. ${e.strippedTitle}](${e.filename})` : `**${e.num}. ${e.strippedTitle}**`;
    indexContent.push(`${indent}- ${link}`);
  }

  const indexFile = path.join(outputDir, 'index.md');
  fs.writeFileSync(indexFile, indexContent.join('\n'));

  // Write TOC as JSON for the reader app
  const tocTree = [];
  const stack = [{ children: tocTree, depth: -1 }];
  for (const e of tocEntries) {
    const depth = (e.num.match(/\./g) || []).length;
    const node = { num: e.num, title: e.strippedTitle, file: e.filename, depth, children: [] };
    while (stack.length > 1 && stack[stack.length - 1].depth >= depth) {
      stack.pop();
    }
    stack[stack.length - 1].children.push(node);
    stack.push({ ...node, depth });
  }
  const tocJson = path.join(outputDir, 'toc.json');
  fs.writeFileSync(tocJson, JSON.stringify(tocTree, null, 2));

  // Write metadata for the reader app
  const metaJson = path.join(outputDir, 'meta.json');
  fs.writeFileSync(metaJson, JSON.stringify(meta, null, 2));

  // Write search index
  const indexJson = path.join(outputDir, 'search-index.json');
  fs.writeFileSync(indexJson, JSON.stringify(searchIndex, null, 2));

  // Generate achievements.md and update toc.json if achievements.json exists
  generateAchievementsMd(outputDir);

  // Stats
  const totalChars = sizes.reduce((a, b) => a + b, 0);
  const avgChars = Math.round(totalChars / sections.length);
  const maxChars = Math.max(...sizes);
  console.log(`\n${outputDir}/index.md created`);
  console.log(`${outputDir}/search-index.json created (${uniqueTerms} terms)`);
  console.log(`${sections.length} section files | avg ${avgChars} chars | range ${Math.min(...sizes)}-${maxChars} chars`);
}

function generateAchievementsMd(outputDir) {
  const achPath = path.join(outputDir, 'achievements.json');
  if (!fs.existsSync(achPath)) return;

  const ach = JSON.parse(fs.readFileSync(achPath, 'utf8'));
  const tocPath = path.join(outputDir, 'toc.json');
  const toc = JSON.parse(fs.readFileSync(tocPath, 'utf8'));

  const sectionTitles = {};
  function collectTocData(nodes) {
    for (const n of nodes) {
      if (n.num && n.title) sectionTitles[n.num] = n.title;
      if (n.children) collectTocData(n.children);
    }
  }
  collectTocData(toc);

  const bySection = {};
  for (const a of ach.achievements) {
    if (!bySection[a.section]) bySection[a.section] = [];
    bySection[a.section].push(a);
  }

  const sortedSections = Object.keys(bySection).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const medal = pts => pts >= 25 ? '🏅' : pts >= 10 ? '🥈' : '🥉';
  const gameUrl = 'https://retroachievements.org/game/' + ach.gameId;

  const lines = [];
  lines.push(`<a id="${anchorId('0.1')}"></a>`);
  lines.push('## 0.1. Achievements');
  lines.push('');
  lines.push(`**${ach.totalAchievements} achievements · ${ach.totalPoints} points**`);
  lines.push('');
  lines.push('All achievements on [RetroAchievements](' + gameUrl + ').');
  lines.push('');
  lines.push('### By Section');
  lines.push('');

  for (const secNum of sortedSections) {
    const achs = bySection[secNum];
    const title = sectionTitles[secNum] || secNum;
    lines.push('#### ' + secNum + ' ' + title);
    lines.push('');
    for (const a of achs) {
      const achUrl = 'https://retroachievements.org/achievement/' + a.id;
      lines.push('- ' + medal(a.points) + ' [' + a.title + '](' + achUrl + ') — ' + a.description + ' (' + a.points + ' pts)');
    }
    lines.push('');
  }

  fs.writeFileSync(path.join(outputDir, 'achievements.md'), lines.join('\n'));

  const checklistEntry = {
    num: '0.1',
    title: 'Achievements',
    file: 'achievements.md',
    depth: 1,
    children: []
  };

  toc.unshift(checklistEntry);
  fs.writeFileSync(tocPath, JSON.stringify(toc, null, 2));

  console.log(outputDir + '/achievements.md created (' + ach.achievements.length + ' achievements)');
}

try {
  main();
} catch (err) {
  console.error('Fatal:', err.message);
  process.exit(1);
}
