#!/usr/bin/env node
// Pure conversion functions extracted from scripts/convert.js for testability and reuse.

function extractText(html) {
  const re = /<pre[^>]*>(.*?)<\/pre>/gs;
  let text = '';
  let m;
  while ((m = re.exec(html)) !== null) text += m[1] + '\n';
  return text.replace(/\r/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

function parseTOC(text) {
  const lines = text.split('\n');
  const tocEntries = [];
  let inTOC = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.toLowerCase().includes('table of contents')) { inTOC = true; continue; }
    if (!inTOC) continue;
    const m = line.match(/^\s*(\d+(?:\.\d+)*)\.?\s+(.+?)\s{2,}([A-Z]{4})\s*$/);
    if (m) {
      const num = m[1], title = m[2].trim(), code = m[3];
      tocEntries.push({ num, title, code, level: (num.match(/\./g) || []).length + 1 });
    }
  }
  return tocEntries;
}

function splitSections(text, tocEntries) {
  if (!tocEntries || tocEntries.length === 0) return [];
  // Find the TOC end marker in body text (last entry's code appears in body)
  const lastEntry = tocEntries[tocEntries.length - 1];
  const tocEndMatch = text.match(lastEntry.num + '\\.\\s+' + lastEntry.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '.*?' + lastEntry.code);
  const tocEnd = tocEndMatch ? tocEndMatch.index + tocEndMatch[0].length : 0;
  const body = text.substring(tocEnd);
  const positions = [];
  for (const entry of tocEntries) {
    const code = 'C' + entry.code;
    const idx = body.indexOf(code);
    if (idx >= 0) {
      const sub = body.substring(idx + code.length);
      const match = sub.match(/^(?:.*\n){0,3}?[\*\-_¯\s]{10,}\n/);
      const headerEnd = match ? idx + code.length + match.index + match[0].length : idx + code.length + 100;
      positions.push({ ...entry, pos: tocEnd + headerEnd });
    }
  }
  positions.sort((a, b) => a.pos - b.pos);
  const sections = [];
  for (let i = 0; i < positions.length; i++) {
    const start = positions[i].pos;
    const end = i < positions.length - 1 ? positions[i + 1].pos : text.length;
    let content = text.substring(start, end);
    // Trim trailing section header bleed: decoration line + title + decoration line
    content = content.replace(/\n[\*\-_¯]{10,}(?:\r?\n)+[^\n]*?C[A-Z]{4}\s*\n[\*\-_¯]{10,}(?:\r?\n)*\s*$/, '\n');
    content = content.replace(/^[\_\*¯\s]{30,}$/gm, '');
    content = content.replace(/\n\d+(?:\.\d+)*\.?\s+[A-Z][\w\s'-]{3,50}\s{3,}C[A-Z]{4}\s*$/gm, '');
    content = content.replace(/\n{3,}/g, '\n\n').trim();
    if (content) sections.push({ ...positions[i], content });
  }
  return sections;
}

function escapeMd(t) { return t.replace(/[\[\]\(\)#*_`]/g, ''); }
function anchorId(e) { return 's' + e.num.replace(/\./g, '-'); }

// ── Roman-numeral format support ──

function detectFormat(text) {
  // Roman format: uses +=====+ or /\====\/ section headers
  if (/\+={30,}\+/.test(text) || /\/[\\\/]+={30,}[\\\/]+/.test(text)) return 'roman';
  // Plain-number format: section numbers (1.0, 4.2.1) with *** separators
  if (/(?:^|\n)\d+\.\d+\s+\S.*\n\*{20,}/m.test(text)) return 'plain';
  // Arrow-bracket format: -> TITLE ... [XXX.NNN]
  if (/->\s+.+\[[A-Z]+\d*\.\d+\]/.test(text)) return 'arrow';
  // Bracket-ccode format: [CCODE] markers with underscore separators
  if (/\[[A-Z][A-Z0-9\-]{2,}\]/.test(text) && /_{30,}/.test(text)) return 'bracket';
  // Hash-title format: -=-=-= wrapped # Title # headers (Lufia II style)
  if (/^[-=]{12,}\n# [^#\n]+ #\n[-=]{12,}/m.test(text)) return 'hash';
  if (/C[A-Z]{4}/.test(text)) return 'standard';
  // Dash format: ===== wrapped major sections + ----- wrapped subsections
  if (/={20,}\n[^\n=]+\n={20,}/.test(text) && /-{20,}\n[^\n-]+\n-{20,}/.test(text)) return 'dash';
  return 'unknown';
}

function romanToInt(roman) {
  const map = { i: 1, v: 5, x: 10, l: 50, c: 100 };
  let result = 0;
  const s = roman.toLowerCase();
  for (let i = 0; i < s.length; i++) {
    const cur = map[s[i]] || 0;
    const next = map[s[i + 1]] || 0;
    result += cur < next ? -cur : cur;
  }
  return result;
}

function parseRomanTOC(text) {
  const lines = text.split('\n');
  let inTOC = false;
  let tocStartIdx = -1;

  // Find the first TABLE OF CONTENTS section
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim().toLowerCase().includes('table of contents')) {
      tocStartIdx = i;
      inTOC = true;
      break;
    }
  }
  if (!inTOC) return [];

  // Parse raw entries from the TOC box lines
  const rawEntries = [];
  for (let i = tocStartIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Second TABLE OF CONTENTS marker — end of the first TOC section
    if (i > tocStartIdx + 5 && trimmed.toLowerCase().includes('table of contents')) break;

    // Skip pure decorative lines
    if (/^[0\-=+|*\/\\_¯\s]+$/.test(trimmed)) continue;
    if (trimmed === '' || trimmed === '+-----------------+') continue;

    // Detect game header lines (DRAGON QUEST I / II)
    if (trimmed.includes('DRAGON QUEST I') && !trimmed.includes('DRAGON QUEST II')) {
      rawEntries.push({ type: 'game_header', title: 'Dragon Quest I' });
      continue;
    }
    if (trimmed.includes('DRAGON QUEST II')) {
      rawEntries.push({ type: 'game_header', title: 'Dragon Quest II' });
      continue;
    }

    // Extract roman numeral + title from TOC line
    // Lines look like: ` |   |   0. VERSION HISTORY   |   |`
    // Strip away the box framing and leading spaces
    const content = line.replace(/^\s*\|.*?\|/, '').replace(/\|.*?\|\s*$/, '').trim();
    const m = content.match(/^([IVXixvlc0]+)\.\s+(.+)/);
    if (!m) {
      // Detect game header lines — ALL CAPS between pipe framing that aren't section entries
      if (/^[A-Z][A-Z\s:\-]{3,}$/.test(content) && !/^[0IVX]+\./.test(content)) {
        rawEntries.push({ type: 'game_header', title: content.trim() });
      }
      continue;
    }

    rawEntries.push({
      type: 'section',
      romanNum: m[1],
      title: m[2].trim()
    });
  }

  // Assign decimal section numbers using auto-incrementing counters
  const tocEntries = [];
  let sectionCounter = 0;
  let subsectionCounter = 0;
  let parentNum = null;
  let inWalkthrough = false;

  for (const entry of rawEntries) {
    if (entry.type === 'game_header') {
      inWalkthrough = false;
      continue;
    }

    let num, level;
    const isUpper = /^[IVX]+$/.test(entry.romanNum);

    if (entry.romanNum === '0') {
      num = '0';
      level = 1;
      sectionCounter = 1;
      subsectionCounter = 0;
      parentNum = null;
    } else if (isUpper) {
      num = String(sectionCounter);
      sectionCounter++;
      level = 1;
      subsectionCounter = 0;
      parentNum = num;
      inWalkthrough = true;
    } else {
      if (!inWalkthrough && parentNum === null) {
        parentNum = '1';
      }
      subsectionCounter++;
      level = 2;
      num = (parentNum || String(sectionCounter)) + '.' + subsectionCounter;
    }

    if (num !== undefined) {
      tocEntries.push({ num, title: entry.title, code: entry.romanNum, level });
    }
  }

  return tocEntries;
}

function splitRomanSections(text, tocEntries) {
  if (!tocEntries || tocEntries.length === 0) return [];

  const lines = text.split('\n');

  // Find the second TOC marker to identify where body sections begin
  let tocCount = 0;
  let bodyStartLine = 0;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim().toLowerCase().includes('table of contents')) {
      tocCount++;
      if (tocCount === 2) {
        bodyStartLine = i;
        break;
      }
    }
  }

  // Find all roman-numeral section headers in the body (diamond and box formats)
  const headerPositions = [];
  for (let i = bodyStartLine; i < lines.length - 2; i++) {
    const top = lines[i].trim();
    const mid = lines[i + 1].trim();
    const bot = lines[i + 2].trim();

    // Diamond header: /\===...===/\ , || num. title || , \/===...===/
    if (/^[\/\\]+={30,}[\/\\]+$/.test(top) && /^\|\|?\s+([IVXixvlc0]+)\.\s+(.+?)\s+\|?\|?\s*$/.test(mid) &&
        /^[\\\/]+={30,}[\\\/]+$/.test(bot)) {
      const m = mid.match(/^\|\|?\s+([IVXixvlc0]+)\.\s+(.+?)\s+\|?\|?\s*$/);
      if (m) {
        headerPositions.push({ headerStart: i, contentStart: i + 3, romanNum: m[1], title: m[2].trim() });
        i += 2;
        continue;
      }
    }

    // Box header: +===...===+ , | num. title | , +===...===+
    if (/^\+={30,}\+$/.test(top) && /^\|\s+([IVXixvlc]+)\.\s+(.+?)\s+\|\s*$/.test(mid) &&
        /^\+={30,}\+$/.test(bot)) {
      const m = mid.match(/^\|\s+([IVXixvlc]+)\.\s+(.+?)\s+\|\s*$/);
      if (m) {
        headerPositions.push({ headerStart: i, contentStart: i + 3, romanNum: m[1], title: m[2].trim() });
        i += 2;
        continue;
      }
    }
  }

  // Zip header positions with TOC entries (they appear in the same order)
  const sections = [];
  for (let i = 0; i < headerPositions.length && i < tocEntries.length; i++) {
    const hp = headerPositions[i];
    const entry = tocEntries[i];
    const endLine = i + 1 < headerPositions.length ? headerPositions[i + 1].headerStart : lines.length;

    let content = lines.slice(hp.contentStart, endLine).join('\n');
    content = content.replace(/\n{3,}/g, '\n\n').trim();
    content = content.replace(/\n{3,}/g, '\n\n').trim();
    if (content) {
      sections.push({ ...entry, content });
    }
  }

  return sections;
}

// ── Arrow-bracket format: TOC parsing (FF IV style) ──

function parseArrowTOC(text) {
  const lines = text.split('\n');
  const tocEntries = [];
  let topLevel = 0;
  let inTOC = false;
  let currentTop = null;
  let subCounter = 0;

  for (const line of lines) {
    const trimmed = line.trim();

    // Detect start of TOC (first `->` line)
    if (!inTOC && /^->\s+.+\[[A-Z]+/.test(trimmed)) {
      inTOC = true;
    }
    if (!inTOC) continue;

    // Stop when we hit the second TOC or body content marker
    if (/^O-{10,}O/.test(trimmed) && tocEntries.length > 5) break;
    // Stop on body prose that looks like a section intro
    if (tocEntries.length > 5 && trimmed.length > 100 && !trimmed.startsWith('->')) break;

    // Match TOC entry: -> TITLE ... [CCODE]
    const m = trimmed.match(/^->\s+(.+?)\s*[.\s]{5,}\s*\[([A-Z]+\.?\d*\.?\d*)\]\s*$/);
    if (!m) continue;

    const title = m[1].trim();
    const code = m[2];

    // Determine level: based on CCODE pattern
    // Top-level: MECH.001, CHAR.001, BEST.000, FAQS.001, UPDATE, COPYRIGHT, WALK.000
    // Sub-sections: WALK.001-999 (under a WALK chapter)
    const isWalk = code.startsWith('WALK.');

    if (!isWalk || code === 'WALK.000') {
      // Top-level section (Mechanics, Characters, etc.)
      topLevel++;
      subCounter = 0;
      currentTop = String(topLevel);
      tocEntries.push({
        num: String(topLevel),
        title: title,
        code: code,
        level: 1
      });
    } else {
      // Walkthrough sub-section — grouped by chapter
      // Check if this starts a new chapter (WALK.050, WALK.100, etc.)
      // Chapters start at multiples of 50 from WALK.050 upward, or are the first walk sub
      const numMatch = code.match(/WALK\.(\d+)/);
      const num = numMatch ? parseInt(numMatch[1]) : 0;
      const isChapterStart = num === 0 || num % 50 === 0;

      if (isChapterStart) {
        topLevel++;
        subCounter = 0;
        currentTop = String(topLevel);
        tocEntries.push({
          num: String(topLevel),
          title: title,
          code: code,
          level: 1
        });
      } else {
        subCounter++;
        tocEntries.push({
          num: (currentTop || String(topLevel)) + '.' + String(subCounter),
          title: title,
          code: code,
          level: 2
        });
      }
    }
  }

  return tocEntries;
}

// ── Arrow-bracket format: box-framed body section splitting ──

function splitBoxSections(text, tocEntries) {
  if (!tocEntries || tocEntries.length === 0) return [];
  const lines = text.split('\n');

  // Find body section markers: O---O---O box headers containing ^[CCODE]
  const markers = [];
  let currentBox = null;
  let boxStart = -1;

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].trim();

    // Detect box header start: O----------O---
    if (/^O-{10,}/.test(l)) {
      boxStart = i;
      currentBox = lines[i];
      continue;
    }
    // Detect box content line: |  ... ^[CCODE] ...  |
    if (boxStart >= 0 && /^\|.*\^\[([A-Z]+\.?\d*\.?\d*)\]/.test(l)) {
      const cm = l.match(/\^\[([A-Z]+\.?\d*\.?\d*)\]/);
      if (cm) {
        const code = cm[1];
        const entry = tocEntries.find(e => e.code === code);
        if (entry) {
          markers.push({ lineIdx: boxStart, entry });
        }
      }
      boxStart = -1;
      currentBox = null;
    }
    // Reset if we've passed the box without finding a code
    if (boxStart >= 0 && i - boxStart > 3) {
      boxStart = -1;
      currentBox = null;
    }
  }

  // Build sections
  const sections = [];
  for (let m = 0; m < markers.length; m++) {
    const headerLine = markers[m].lineIdx;
    const end = m + 1 < markers.length ? markers[m + 1].lineIdx : lines.length;

    // Skip the box framing (O---O---O header) — find actual content start
    let contentStart = headerLine;
    for (let j = headerLine; j < Math.min(headerLine + 6, end); j++) {
      if (/^[A-Z][A-Za-z\s]+$/.test(lines[j].trim()) && lines[j].trim().length > 5) {
        contentStart = j;
        break;
      }
      // Skip box header lines
      if (/^O-{10,}|^\|/.test(lines[j].trim()) || /^[ _\|\/\\'']+$/.test(lines[j].trim())) {
        continue;
      }
      contentStart = j;
      break;
    }

    let content = lines.slice(contentStart, end).join('\n');
    sections.push({
      ...markers[m].entry,
      content: content.trim()
    });
  }

  return sections;
}

// ── Plain-number format: parsing and splitting (FF V style) ──

function parsePlainTOC(text) {
  const lines = text.split('\n');
  const tocEntries = [];

  // Generates TOC entries from ALL body section headers
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].trim();
    const m = l.match(/^(\d+\.\d+\.?\d*)\s+(.+)$/);
    if (!m) continue;
    // Next line must be asterisk separator
    const next = i + 1 < lines.length ? lines[i + 1].trim() : '';
    if (!next.startsWith('****')) continue;

    const num = m[1];
    const title = m[2].trim();
    const parts = num.split('.');

    tocEntries.push({
      num: num,
      title: title,
      level: parts.length
    });
  }

  return tocEntries;
}

function splitPlainSections(text, tocEntries) {
  if (!tocEntries || tocEntries.length === 0) return [];
  const lines = text.split('\n');

  // Build a map of section numbers to line indices
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].trim();
    const m = l.match(/^(\d+\.\d+\.?\d*)\s+(.+)$/);
    if (!m) continue;
    const next = i + 1 < lines.length ? lines[i + 1].trim() : '';
    if (!next.startsWith('****')) continue;
    // Store line position in toc entry for extraction
    for (const entry of tocEntries) {
      if (entry.num === m[1] && !entry._lineIdx) {
        entry._lineIdx = i;
        break;
      }
    }
  }

  // Build ordered marker list
  const markers = tocEntries
    .filter(e => e._lineIdx !== undefined)
    .sort((a, b) => a._lineIdx - b._lineIdx);

  const sections = [];
  for (let m = 0; m < markers.length; m++) {
    const headerLine = markers[m]._lineIdx;
    let end = m + 1 < markers.length ? markers[m + 1]._lineIdx : lines.length;

    // Start content after the *** separator line
    let contentStart = headerLine + 1;
    // Skip the asterisk separator
    while (contentStart < end && lines[contentStart].trim().startsWith('****')) {
      contentStart++;
    }
    // Skip blank lines after separator
    while (contentStart < end && !lines[contentStart].trim()) {
      contentStart++;
    }

    let content = lines.slice(contentStart, end).join('\n').trim();
    sections.push({
      ...markers[m],
      content: content
    });
  }

  return sections;
}

function parseAuthor(html, extractedText) {
  // Try to extract author from the HTML page metadata
  // Pattern: Walkthrough by _AuthorName_
  const metaMatch = html.match(/Walkthrough by\s+([A-Za-z0-9_\-]+)/);
  if (metaMatch) return metaMatch[1].replace(/_/g, '');

  // Try the <title> tag
  const titleMatch = html.match(/<title[^>]*>Walkthrough by\s+([^<]+)/i);
  if (titleMatch) return titleMatch[1].trim().replace(/_/g, '');

  // Fallback: check extracted text for author patterns
  // Author often appears in a decorative header box near the start
  const textLine = extractedText.split('\n').slice(0, 30).join('\n');
  const textMatch = textLine.match(/[_ ]([A-Z][A-Za-z]+[-_][A-Z][a-zA-Z]+)[_ ]/);
  if (textMatch) return textMatch[1].replace(/_/g, ' ');

  return null;
}

// ── Bracket-ccode format: TOC parsing ──

function parseBracketTOC(text) {
  const lines = text.split('\n');
  const tocEntries = [];
  let inTOC = false;
  let topLevel = 0;
  let subLevel = 0;
  let currentParent = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Stop parsing TOC when body content starts (underscore separators)
    if (/^_{30,}$/.test(trimmed) && inTOC) break;

    // Detect top-level section: ROMAN. TITLE ... CCODE (Chrono Cross style)
    const topMatch = trimmed.match(/^([IVX]+)[\.\)]\s*(.+?)\s*[.\s]{10,}\s*([A-Z][A-Z0-9\-]{2,})\s*$/);
    if (topMatch) {
      inTOC = true;
      topLevel++;
      subLevel = 0;
      currentParent = String(topLevel);
      tocEntries.push({
        num: String(topLevel),
        title: topMatch[2].trim(),
        code: topMatch[3],
        level: 1
      });
      continue;
    }

    // Detect numbered sub-section: NN) TITLE ... [...] ... CCODE
    const numMatch = trimmed.match(/^(\d{2})\)\s+(.+?)\s*[.\s]{10,}.*?\s*([A-Z][A-Z0-9\-]{2,})\s*$/);
    if (numMatch && inTOC) {
      subLevel++;
      tocEntries.push({
        num: currentParent + '.' + String(subLevel),
        title: numMatch[2].replace(/\[[^\]]*\][.]*/g, '').trim(),
        code: numMatch[3],
        level: 2
      });
      continue;
    }

    // Detect PATH sub-section: PATH X: TITLE ... [...] ... CCODE
    const pathMatch = trimmed.match(/^(PATH\s+[A-Z]):\s+(.+?)\s*[.\s]{10,}.*?\s*([A-Z][A-Z0-9\-]{2,})\s*$/);
    if (pathMatch && inTOC) {
      subLevel++;
      tocEntries.push({
        num: currentParent + '.' + String(subLevel),
        title: pathMatch[1] + ': ' + pathMatch[2].replace(/\[[^\]]*\][.]*/g, '').trim(),
        code: pathMatch[3],
        level: 2
      });
      continue;
    }

    // Detect OPTIONAL sub-section: OPTIONAL: TITLE ... [...] ... CCODE
    const optMatch = trimmed.match(/^(OPTIONAL):\s+(.+?)\s*[.\s]{10,}.*?\s*([A-Z][A-Z0-9\-]{2,})\s*$/);
    if (optMatch && inTOC) {
      subLevel++;
      tocEntries.push({
        num: currentParent + '.' + String(subLevel),
        title: optMatch[1] + ': ' + optMatch[2].replace(/\[[^\]]*\][.]*/g, '').trim(),
        code: optMatch[3],
        level: 2
      });
      continue;
    }

    // Detect un-numbered sub-section: TITLE ... ... CCODE (indented, under TH' BASICS or APPENDIX)
    // Match lines that look like sub-section entries with a CCODE at the end
    const subMatch = trimmed.match(/^([A-Z][A-Za-z\/\s\-\+&]{3,}?)\s*[.\s]{10,}\s*([A-Z][A-Z0-9\-]{2,})\s*$/);
    if (subMatch && inTOC) {
      const title = subMatch[1].trim();
      const code = subMatch[2];
      // Skip if it looks like a verse number or non-section marker
      if (title.length > 3 && !title.startsWith('EX:') && code.length >= 3) {
        subLevel++;
        tocEntries.push({
          num: currentParent + '.' + String(subLevel),
          title: title,
          code: code,
          level: 2
        });
      }
      continue;
    }

    // Detect route sub-section (e.g., "Nikki's Route")
    const routeMatch = trimmed.match(/^([A-Z][A-Za-z']+\s+Route)\s*[.\s]{10,}.*?\s*([A-Z][A-Z0-9\-]{2,})\s*$/);
    if (routeMatch && inTOC) {
      subLevel++;
      const annot = trimmed.match(/\[([^\]]+)\]/);
      const title = routeMatch[1] + (annot ? ' — ' + annot[1] : '');
      tocEntries.push({
        num: currentParent + '.' + String(subLevel),
        title: title,
        code: routeMatch[2],
        level: 2
      });
      continue;
    }
  }

  return tocEntries;
}

// ── Bracket-ccode format: body section splitting ──

function splitBracketSections(text, tocEntries) {
  if (!tocEntries || tocEntries.length === 0) return [];
  const lines = text.split('\n');
  const seenCcodes = new Set();

  // Find section markers in the body
  const markers = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].trim();
    // 1) Bracket-ccode markers: content with [CCODE] at end
    const ccMatch = l.match(/\[([A-Z][A-Z0-9\-]{2,})\]\s*$/);
    if (ccMatch) {
      const code = ccMatch[1];
      if (seenCcodes.has(code)) continue;
      const entry = tocEntries.find(e => e.code === code);
      if (entry) {
        seenCcodes.add(code);
        markers.push({ lineIdx: i, entry });
        continue;
      }
    }
    // 2) Top-level roman-numeral headers: preceded by underscore separator
    //    Lines like `I. CONTROLS` or `II. TH' BASICS`
    const romanMatch = l.match(/^([IVX]+)[\.\)]\s+(.+?)\s*$/);
    if (romanMatch) {
      // Must be preceded by an underscore/overline separator (body section divider)
      const prev1 = i > 0 ? lines[i - 1].trim() : '';
      const prev2 = i > 1 ? lines[i - 2].trim() : '';
      if (/^_{30,}$/.test(prev1) || /^_{30,}$/.test(prev2)) {
        const title = romanMatch[2].trim();
        // Only match ALL-CAPS titles or multi-word titles (avoid false positives on prose)
        if (/^[A-Z][A-Z\s\/\-\+\&'\.]{2,}$/.test(title) || title.split(/\s+/).length >= 3) {
          const entry = tocEntries.find(e => e.title === title && e.level === 1);
          if (entry && !seenCcodes.has(entry.code)) {
            seenCcodes.add(entry.code);
            markers.push({ lineIdx: i, entry });
          }
        }
      }
    }
  }

  // Sort markers by position
  markers.sort((a, b) => a.lineIdx - b.lineIdx);

    // Build sections
  const sections = [];
  for (let m = 0; m < markers.length; m++) {
    const headerLine = markers[m].lineIdx;
    const end = m + 1 < markers.length ? markers[m + 1].lineIdx : lines.length;

    // Skip section header line and its surrounding separators
    let contentStart = headerLine + 1;
    // Skip underscore/overline separator lines immediately after the header
    while (contentStart < end && /^[¯_]{10,}$/.test(lines[contentStart].trim())) {
      contentStart++;
    }
    // Also skip the line if it re-states the section title (common in bracket format)
    if (contentStart < end) {
      const firstContent = lines[contentStart].trim();
      if (/^[¯_]{10,}$/.test(firstContent) || /^[IVX]+\.\s|^\d{2}\)/.test(firstContent)) {
        contentStart++;
      }
    }

    let content = lines.slice(contentStart, end).join('\n');

    sections.push({
      ...markers[m].entry,
      content: content.trim()
    });
  }

  return sections;
}

function parseTitle(html) {
  // Try to extract the game title from the page <title> tag
  // Format: "GameFAQs: <Game Name> Walkthrough by <Author>"
  const m = html.match(/<title[^>]*>GameFAQs:\s*(.+?)\s+Walkthrough/i);
  if (m) {
    let title = m[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
    // Strip " Guide and" suffix that sometimes precedes Walkthrough
    title = title.replace(/\s+Guide and\s*$/, '');
    return title;
  }
  return null;
}

// ── Dash format: TOC parsing (Terranigma style) ──

function parseDashTOC(text) {
  const lines = text.split('\n');
  const tocEntries = [];

  // Find the TOC start marker
  let tocStartIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim().toLowerCase().includes('table of contents')) {
      tocStartIdx = i;
      break;
    }
  }
  if (tocStartIdx < 0) return [];

  // Parse TOC entries based on indentation
  let topLevel = 0;
  let subLevel = 0;
  let subSubLevel = 0;
  let currentParent = null;
  let currentSubParent = null;

  for (let i = tocStartIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Stop at the first ===== body section marker
    if (/^={20,}$/.test(trimmed)) break;

    // Skip blank lines and decorative lines
    if (!trimmed || /^[=\-_]+$/.test(trimmed)) continue;

    // Determine level based on leading spaces
    const leadingSpaces = line.match(/^(\s*)/)[1].length;
    let level;
    if (leadingSpaces <= 2) level = 1;
    else if (leadingSpaces <= 5) level = 2;
    else level = 3;

    // Handle special patterns
    let title = trimmed;
    let num;

    // Chapter N: Title
    const chapterMatch = title.match(/^Chapter\s+(\d+):\s*(.+)/i);
    if (chapterMatch) {
      subLevel++;
      num = (currentParent || String(topLevel)) + '.' + subLevel;
      currentSubParent = num;
      subSubLevel = 0;
      title = chapterMatch[2].trim();
      level = 2;
    }
    // Appendix X: Title
    else if (/^Appendix\s+[A-Z]:/i.test(title)) {
      topLevel++;
      subLevel = 0;
      subSubLevel = 0;
      currentParent = String(topLevel);
      currentSubParent = null;
      num = currentParent;
      level = 1;
    }
    // Numbered item: 1. Title
    else if (/^\d+\.\s+/.test(title)) {
      const numMatch = title.match(/^(\d+)\.\s+(.+)/);
      if (numMatch) {
        if (level === 2) {
          subLevel++;
          num = (currentParent || String(topLevel)) + '.' + subLevel;
          currentSubParent = num;
          subSubLevel = 0;
        } else if (level === 3) {
          subSubLevel++;
          num = (currentSubParent || (currentParent || String(topLevel)) + '.1') + '.' + subSubLevel;
        } else {
          topLevel++;
          subLevel = 0;
          subSubLevel = 0;
          currentParent = String(topLevel);
          currentSubParent = null;
          num = currentParent;
        }
        title = numMatch[2].trim();
      }
    }
    // Regular entry
    else {
      if (level === 1) {
        topLevel++;
        subLevel = 0;
        subSubLevel = 0;
        currentParent = String(topLevel);
        currentSubParent = null;
        num = currentParent;
      } else if (level === 2) {
        subLevel++;
        num = (currentParent || String(topLevel)) + '.' + subLevel;
        currentSubParent = num;
        subSubLevel = 0;
      } else {
        subSubLevel++;
        num = (currentSubParent || (currentParent || String(topLevel)) + '.1') + '.' + subSubLevel;
      }
    }

    tocEntries.push({ num, title, level });
  }

  return tocEntries;
}

// ── Dash format: body section splitting ──

function normalizeTitle(title) {
  return title.toLowerCase()
    .replace(/^\d+\.\s+/, '')
    .replace(/^chapter\s+\d+:\s*/, '')
    .replace(/^appendix\s+[a-z]:\s*/, '')
    .replace(/\b(the|a|an)\b\s*/g, '')  // Strip noise articles
    .replace(/\s*\(.*?\)\s*$/, '')     // Strip trailing parentheticals
    .replace(/[_-]/g, ' ')             // Replace underscores/hyphens with spaces
    .replace(/\s+/g, ' ')              // Normalize whitespace
    .trim();
}

function titleMatchScore(tocTitle, headerTitle) {
  const t = normalizeTitle(tocTitle);
  const h = normalizeTitle(headerTitle);
  if (!t) return 0;
  if (t === h) return 100;
  if (h.startsWith(t)) return 90;
  if (t.startsWith(h)) return 85;
  if (h.includes(t) && t.length > 3) return 75;
  if (t.includes(h) && h.length > 3) return 70;
  // Acronym check: FAQ → Frequently Asked Questions
  if (t.length >= 2 && t.length <= 5) {
    const words = h.split(/\s+/).filter(w => w.length > 0);
    if (words.length >= t.length) {
      const acronym = words.map(w => w[0]).join('').toLowerCase();
      if (acronym.startsWith(t)) return 70;
    }
  }
  return 0;
}

function splitDashSections(text, tocEntries) {
  if (!tocEntries || tocEntries.length === 0) return [];
  const lines = text.split('\n');

  // Phase 1: Find all section headers
  const headers = [];
  for (let i = 0; i < lines.length - 2; i++) {
    const top = lines[i].trim();
    const mid = lines[i + 1].trim();
    const bot = lines[i + 2].trim();

    if (/^={20,}$/.test(top) && /^={20,}$/.test(bot) && mid.length > 0) {
      headers.push({ lineIdx: i, title: mid, type: 'major' });
      continue;
    }

    if (/^-{20,}$/.test(top) && /^-{20,}$/.test(bot) && mid.length > 0) {
      headers.push({ lineIdx: i, title: mid, type: 'sub' });
      continue;
    }
  }

  // Phase 2: Match headers to TOC entries.
  // Only create synthetic sections for unmatched MAJOR headers (=====).
  // Unmatched sub headers (-----) stay as content within their parent.
  const used = new Set();
  const allHeaders = [];
  let unmatchedMajor = 0;

  for (const header of headers) {
    let bestEntry = null;
    let bestScore = 0;

    for (let i = 0; i < tocEntries.length; i++) {
      if (used.has(i)) continue;
      const score = titleMatchScore(tocEntries[i].title, header.title);
      // Tiebreaker: when scores are within 10, prefer the longer (more specific) title
      if (bestEntry && Math.abs(score - bestScore) <= 10) {
        const curLen = normalizeTitle(tocEntries[i].title).length;
        const bestLen = normalizeTitle(bestEntry.entry.title).length;
        if (curLen > bestLen) {
          bestScore = score;
          bestEntry = { entry: tocEntries[i], idx: i };
        }
      } else if (score > bestScore) {
        bestScore = score;
        bestEntry = { entry: tocEntries[i], idx: i };
      }
    }

    if (bestEntry && bestScore >= 70) {
      used.add(bestEntry.idx);
      allHeaders.push({ ...header, entry: bestEntry.entry });
    } else if (header.type === 'major') {
      unmatchedMajor++;
      allHeaders.push({ ...header, entry: { num: 'U' + unmatchedMajor, title: header.title, level: 1 } });
    }
    // Sub headers without a match are skipped (stay as content)
  }

  // Phase 3: Build sections using all headers as boundaries
  const sections = [];
  for (let m = 0; m < allHeaders.length; m++) {
    const headerLine = allHeaders[m].lineIdx;
    const entry = allHeaders[m].entry;

    // Find the end of this section: next header in allHeaders (any level)
    let end = m + 1 < allHeaders.length ? allHeaders[m + 1].lineIdx : lines.length;

    // Start content after the header block (skip 3-line wrapper)
    let contentStart = headerLine;
    while (contentStart < end && contentStart < headerLine + 3) {
      contentStart++;
    }

    // Clamp: don't start after the end
    if (contentStart >= end) {
      sections.push({ ...entry, content: '' });
      continue;
    }

    // Skip blank lines after header
    while (contentStart < end && !lines[contentStart].trim()) {
      contentStart++;
    }

    let content = lines.slice(contentStart, end).join('\n');
    content = content.replace(/\n{3,}/g, '\n\n').trim();

    sections.push({ ...entry, content });
  }

  return sections;
}

// ── Hash-title format: parsing and splitting (Lufia II style) ──
// This walkthrough has # Title # major sections and ± Title ± subsections
// with ¤¤¤ / °°° or ««« / °°° decorative frames. The TOC only lists
// major sections; subsections are detected from the body.

function parseHashTOC(text) {
  const lines = text.split('\n');
  const tocEntries = [];
  let inTOC = false;
  let sectionCounter = 0;

  // Step 1: Parse flat TOC from ¤ bullets
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.toLowerCase().includes('table of contents')) {
      inTOC = true;
      continue;
    }
    if (!inTOC) continue;

    if (/^# .+ #$/.test(line) || /^[-=]{12,}$/.test(line)) break;

    const m = line.match(/^¤\s+(.+)$/);
    if (m) {
      sectionCounter++;
      let title = m[1].trim().replace(/[!]+$/, '').trim();
      tocEntries.push({ num: String(sectionCounter), title, level: 1 });
    }
  }

  if (tocEntries.length === 0) return [];

  // Step 2: Find major # Title # header positions in the body
  const maj = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (/^[-=]{12,}$/.test(line) && i + 2 < lines.length) {
      const mid = lines[i + 1].trim();
      const bot = lines[i + 2].trim();
      if (/^# .+ #$/.test(mid) && /^[-=]{12,}$/.test(bot)) {
        maj.push(i);
        i += 2;
      }
    }
  }

  // Step 3: Build combined TOC — parents then their subsection children
  const combined = [];
  const count = Math.min(maj.length, tocEntries.length);

  for (let mi = 0; mi < count; mi++) {
    const parent = tocEntries[mi];
    combined.push({ ...parent, level: 1 });

    const start = maj[mi] + 3;
    const end = mi + 1 < count ? maj[mi + 1] : lines.length;

    // Scan for ± Title ± subsections within this parent range
    let subNum = 0;
    for (let i = start; i < end; i++) {
      const line = lines[i].trim();
      if (/^[¤«]{3,}$/.test(line) && i + 2 < end) {
        const mid = lines[i + 1].trim();
        const bot = lines[i + 2].trim();
        if (/^± .+ ±$/.test(mid) && /^°{3,}$/.test(bot)) {
          subNum++;
          const title = mid.replace(/^±\s*|\s*±$/g, '');
          combined.push({ num: parent.num + '.' + subNum, title, level: 2 });
          i += 2;
        }
      }
    }
  }

  return combined;
}

function splitHashSections(text, tocEntries) {
  if (!tocEntries || tocEntries.length === 0) return [];
  const lines = text.split('\n');

  // Find all major # Title # boundaries
  const majorHeaders = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (/^[-=]{12,}$/.test(line) && i + 2 < lines.length) {
      const mid = lines[i + 1].trim();
      const bot = lines[i + 2].trim();
      if (/^# .+ #$/.test(mid) && /^[-=]{12,}$/.test(bot)) {
        majorHeaders.push({ lineIdx: i, contentStart: i + 3 });
        i += 2;
      }
    }
  }

  // Merge major and subsection boundaries in document order
  const boundaries = [];
  for (let mi = 0; mi < majorHeaders.length; mi++) {
    const mh = majorHeaders[mi];
    boundaries.push({ lineIdx: mh.lineIdx, contentStart: mh.contentStart, level: 1 });

    const start = mh.contentStart;
    const end = mi + 1 < majorHeaders.length
      ? majorHeaders[mi + 1].lineIdx
      : lines.length;

    // Find ± Title ± subsection boundaries within this parent range
    for (let i = start; i < end; i++) {
      const line = lines[i].trim();
      if (/^[¤«]{3,}$/.test(line) && i + 2 < end) {
        const mid = lines[i + 1].trim();
        const bot = lines[i + 2].trim();
        if (/^± .+ ±$/.test(mid) && /^°{3,}$/.test(bot)) {
          boundaries.push({ lineIdx: i, contentStart: i + 3, level: 2 });
          i += 2;
        }
      }
    }
  }

  // Match boundaries to TOC entries by position
  const sections = [];
  const count = Math.min(boundaries.length, tocEntries.length);
  for (let i = 0; i < count; i++) {
    const boundary = boundaries[i];
    const entry = tocEntries[i];
    const end = i + 1 < boundaries.length
      ? boundaries[i + 1].lineIdx
      : lines.length;

    let content = lines.slice(boundary.contentStart, end).join('\n');
    content = content.replace(/\n{3,}/g, '\n\n').trim();

    if (content) {
      sections.push({ num: entry.num, title: entry.title, level: entry.level, content });
    }
  }

  return sections;
}

module.exports = {
  extractText, parseTOC, splitSections, escapeMd, anchorId,
  detectFormat, romanToInt, parseRomanTOC, splitRomanSections,
  parseBracketTOC, splitBracketSections,
  parseArrowTOC, splitBoxSections,
  parsePlainTOC, splitPlainSections,
  parseDashTOC, splitDashSections,
  parseHashTOC, splitHashSections,
  parseAuthor, parseTitle
};
