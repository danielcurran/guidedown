#!/usr/bin/env node
const https = require('https');
const fs = require('fs');
const path = require('path');
const { reformat } = require('./reformat');
const { anchorId } = require('../lib/reformat/utils');
const { extractText, parseTOC, splitSections, escapeMd, detectFormat, parseRomanTOC, splitRomanSections, parseBracketTOC, splitBracketSections, parseArrowTOC, splitBoxSections, parsePlainTOC, splitPlainSections, parseDashTOC, splitDashSections, parseHashTOC, splitHashSections, parseAuthor, parseTitle } = require('../lib/convert-core');
const { parseArgs, showHelp } = require('../lib/cli');

const SCRIPT_NAME = 'faqmd';
const SCRIPT_DIR = __dirname;

const cli = parseArgs(process.argv.slice(2), {
  flags: {
    title: { value: 'NAME', desc: 'Override the walkthrough title' },
    author: { value: 'NAME', desc: 'Override the walkthrough author' },
  }
});

if (cli.help) {
  showHelp(SCRIPT_NAME, 'Convert a GameFAQs walkthrough to Markdown.', {
    usage: '[options] [<url-or-file>] [<output.md>]',
    flags: {
      title: { value: 'NAME', desc: 'Override the walkthrough title' },
      author: { value: 'NAME', desc: 'Override the walkthrough author' },
    },
    examples: [
      'faqmd',
      'faqmd https://gamefaqs.gamespot.com/.../faqs/...?print=1',
      'faqmd --title="Phantasy Star IV" --author="Seb Holt" raw.txt psiv.md',
    ]
  });
  process.exit(0);
}

let URL = cli.positional[0] || null;
let OUTPUT = cli.positional[1] || path.join(SCRIPT_DIR, 'walkthrough.md');
const titleOverride = cli.flags.title || null;
const authorOverride = cli.flags.author || null;

function fetch(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, res => {
      if (res.statusCode !== 200) {
        reject(new Error('HTTP ' + res.statusCode + ' (expected 200)'));
        return;
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString()));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(30000, () => {
      req.destroy();
      reject(new Error('Request timed out after 30s'));
    });
  });
}

async function main() {
  let html;
  if (URL && !URL.startsWith('http')) {
    // Local file: validate it's within an allowed directory and has a safe extension
    const { validateInputFile } = require('../lib/cli');
    const resolved = path.resolve(URL);
    const allowedDirs = [SCRIPT_DIR, process.cwd()];
    const inAllowed = allowedDirs.some(d => {
      const r = path.resolve(d);
      return resolved === r || resolved.startsWith(r + path.sep);
    });
    if (!inAllowed) throw new Error('input file must be within the project directory or current working directory');
    const ext = path.extname(resolved).toLowerCase();
    const allowedExts = ['.txt', '.md', '.html', '.htm'];
    if (!allowedExts.includes(ext)) throw new Error('unsupported file extension: ' + ext);
    validateInputFile(resolved);
    html = fs.readFileSync(resolved, 'utf8');
  } else if (URL) {
    html = await fetch(URL);
  } else {
    const cached = path.join(__dirname, 'raw.txt');
    console.log('Using cached raw.txt...');
    html = fs.readFileSync(cached, 'utf8');
  }
  console.log('Got ' + html.length + ' bytes');

  const text = extractText(html);
  console.log('Extracted ' + text.length + ' chars');

  const format = detectFormat(text);
  const FORMATS = {
    roman:    { parse: parseRomanTOC,    split: splitRomanSections,    label: 'roman-numeral' },
    plain:    { parse: parsePlainTOC,    split: splitPlainSections,    label: 'plain-number' },
    arrow:    { parse: parseArrowTOC,    split: splitBoxSections,      label: 'arrow-bracket' },
    bracket:  { parse: parseBracketTOC,  split: splitBracketSections,  label: 'bracket-ccode' },
    standard: { parse: parseTOC,         split: splitSections,         label: 'standard (CCODE)' },
    dash:     { parse: parseDashTOC,     split: splitDashSections,     label: 'dash' },
    hash:     { parse: parseHashTOC,     split: splitHashSections,     label: 'hash-title' },
  };

  const fmt = FORMATS[format];
  if (!fmt) {
    console.error('Error: unknown walkthrough format — cannot determine section markers');
    process.exit(1);
  }

  console.log('Detected ' + fmt.label + ' format');
  let toc = fmt.parse(text);
  const tocWarning = toc.length === 0 ? ' (WARNING: no TOC entries parsed)' : '';
  console.log('Found ' + toc.length + ' sections' + tocWarning);
  if (toc.length === 0) {
    console.error('Error: no TOC entries parsed — input does not appear to be a GameFAQs walkthrough');
    process.exit(1);
  }

  let sections = fmt.split(text, toc);
  const matchPct = toc.length > 0 ? Math.round(sections.length / toc.length * 100) : 0;
  console.log('Split into ' + sections.length + ' sections (' + matchPct + '% of TOC matched)');
  if (toc.length > 0 && matchPct < 80) {
    console.log('WARNING: fewer than 80% of TOC entries matched body sections');
  }
  if (sections.length === 0) {
    console.log('WARNING: no sections extracted — check GameFAQs page format');
  }

  const gameTitle = titleOverride || parseTitle(html) || sections[0]?.title || 'Walkthrough';
  const author = authorOverride || parseAuthor(html, text) || 'Unknown Author';

  let md = '# ' + gameTitle + '\n\n';
  md += '> By ' + author + ' — Converted from GameFAQs\n\n';
  md += '## Table of Contents\n\n';
  for (const s of sections) {
    md += '  '.repeat(s.level - 1) + '- [' + s.num + '. ' + escapeMd(s.title) + '](#' + anchorId(s.num) + ')\n';
  }
  md += '\n---\n\n';
  for (const s of sections) {
    md += '<a id="' + anchorId(s.num) + '"></a>\n\n';
    md += '#'.repeat(s.level) + ' ' + s.num + '. ' + escapeMd(s.title) + '\n\n';
    md += reformat(s.content) + '\n\n';
  }

  fs.writeFileSync(OUTPUT, md);
  console.log('Saved to ' + OUTPUT + ' (' + md.length + ' bytes)');
}

if (process.argv[1] === __filename) {
  main().catch(err => {
    console.error('Fatal:', err.message);
    process.exit(1);
  });
}
