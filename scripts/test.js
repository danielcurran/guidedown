#!/usr/bin/env node
// Unit tests for faqmd converter + reformatting
// Usage: node scripts/test.js
const fs = require('fs');
const path = require('path');

const { extractText, parseTOC, splitSections, escapeMd, detectFormat, romanToInt, parseRomanTOC, splitRomanSections, parseDashTOC, splitDashSections, parseHashTOC, splitHashSections } = require('../lib/convert-core');
const {
  reformat, reformatBlock, formatProse, formatStatBlock, formatDecorativeText,
  formatEquipmentTable, formatBossCard,
  formatCharacterSheet, formatRomanSubHeader
} = require('./reformat');
const { formatShopList, formatHashSubHeader } = require('../lib/reformat/format');
const { hasEquipSlotLines, isBossCard, isShopBlock, isCharacterSheet, isCharacterPortrait, isPureBorderRow, isHashSubHeader } = require('../lib/reformat/detect');
const { stripFrameChars, anchorId: anchorIdStr } = require('../lib/reformat/utils');
const { parseArgs, validateInputFile } = require('../lib/cli');
const { parseAuthor, parseTitle } = require('../lib/convert-core');
const { classifyLine, segmentLines, hasConsistentPipes, formatMixed } = require('../lib/reformat/classify');
const { formatTable, formatAscii } = require('../lib/reformat/format');

let passed = 0;
let failed = 0;
const failures = [];

function assert(label, fn) {
  try {
    fn();
    passed++;
  } catch (e) {
    failed++;
    failures.push('FAIL: ' + label + ' — ' + e.message);
  }
}

// ── convert-core: extractText ──
assert('extractText: captures pre content', () => {
  const html = '<html><body><pre id="faqspan-1">Section 1\n\nSection 2</pre></body></html>';
  const text = extractText(html);
  if (!text.includes('Section 1')) throw new Error('Missing Section 1');
  if (!text.includes('Section 2')) throw new Error('Missing Section 2');
});

assert('extractText: decodes HTML entities', () => {
  const html = '<pre>A &amp; B &lt; C &gt; D &quot;E&quot; &#39;F&#39;</pre>';
  const text = extractText(html);
  if (text !== 'A & B < C > D "E" \'F\'\n') throw new Error('Entity decode failed: ' + JSON.stringify(text));
});

assert('extractText: strips carriage return', () => {
  const html = '<pre>Line 1\r\nLine 2\r\n</pre>';
  const text = extractText(html);
  if (text.includes('\r')) throw new Error('\\r not stripped: ' + JSON.stringify(text));
});

// ── convert-core: parseTOC ──
assert('parseTOC: finds all sections', () => {
  const tocText = [
    'Table of Contents',
    ' 1. Introduction                             INRO',
    '    1.1. Foreword                            FRWR',
    ' 6. Walkthrough                              WKTH',
    '    6.1. An Ancient Civilization             ANCV',
    '      6.1.1. The Town of Learning            TWLR',
    '',
    'Some other content',
  ].join('\n');
  const toc = parseTOC(tocText);
  if (toc.length !== 5) throw new Error('Expected 5 entries, got ' + toc.length);
});

assert('parseTOC: extracts 4-letter code', () => {
  const toc = parseTOC('Table of Contents\n 1. Introduction                             INRO\n');
  if (toc[0].code !== 'INRO') throw new Error('Expected INRO, got ' + toc[0].code);
});

assert('parseTOC: extracts level 3 section', () => {
  const toc = parseTOC('Table of Contents\n      6.1.1. The Town of Learning            TWLR\n');
  const l3 = toc.find(e => e.num === '6.1.1');
  if (!l3) throw new Error('Expected 6.1.1 entry not found');
  if (l3.code !== 'TWLR') throw new Error('Expected TWLR code, got ' + l3.code);
});

assert('parseTOC: is case-insensitive on header', () => {
  const toc = parseTOC('table of contents\n 1. Introduction                             INRO\n');
  if (toc.length !== 1) throw new Error('Expected 1 entry, got ' + toc.length);
});

// ── convert-core: escapeMd ──
assert('escapeMd: strips markdown special chars', () => {
  const r = escapeMd('[Title](url) #section *bold* _italic_ `code`');
  if (r !== 'Titleurl section bold italic code') throw new Error('Got: ' + r);
});

// ── convert-core: splitSections ──
assert('splitSections: splits content by section codes', () => {
  const text = [
    'Table of Contents',
    ' 1. Intro                             AAAA',
    ' 2. Walkthrough                       BBBB',
    '',
    '***************************************************************************',
    '1. Intro                                                               CAAAA',
    '***************************************************************************',
    'Intro text here.',
    '',
    '',
    '',
    '',
    '***************************************************************************',
    '2. Walkthrough                                                         CBBBB',
    '***************************************************************************',
    'Walkthrough text here.',
  ].join('\n');
  const toc = parseTOC(text);
  const sections = splitSections(text, toc);
  if (sections.length !== 2) throw new Error('Expected 2 sections, got ' + sections.length);
  if (!sections[0].content.includes('Intro text')) throw new Error('Missing intro content');
  if (!sections[1].content.includes('Walkthrough text')) throw new Error('Missing walkthrough content');
});

// ── reformat: formatProse ──
assert('formatProse: joins lines with space', () => {
  const r = formatProse(['first line', 'second line', 'third line']);
  if (r !== 'first line second line third line\n\n') throw new Error('Got: ' + JSON.stringify(r));
});
assert('formatProse: handles single line', () => {
  const r = formatProse(['only one line']);
  if (r !== 'only one line\n\n') throw new Error('Got: ' + JSON.stringify(r));
});
assert('formatProse: returns empty for blank input', () => {
  const r = formatProse(['']);
  if (r !== '') throw new Error('Should be empty');
});

// ── reformat: formatStatBlock ──
assert('formatStatBlock: formats key-value pairs', () => {
  const r = formatStatBlock(['HP: 300', 'EXP: 173', 'MST: 54']);
  if (!r.includes('**HP:** 300')) throw new Error('Missing HP');
  if (!r.includes('**EXP:** 173')) throw new Error('Missing EXP');
  if (!r.includes(' · ')) throw new Error('Missing separator');
});
assert('formatStatBlock: handles multi-column stat lines', () => {
  const r = formatStatBlock([
    'Met: Academy Basement           Recommended Level before fighting:',
    '  HP: 300                          Alys: 7',
    ' EXP: 173                          Chaz: 2-3',
    ' MST: 54                           Hahn: 2-3'
  ]);
  if (!r.includes('**Met:** Academy Basement')) throw new Error('Missing Met');
  if (!r.includes('**HP:** 300')) throw new Error('Missing HP');
  if (!r.includes('**Alys:** 7')) throw new Error('Missing Alys');
  if (!r.includes('**EXP:** 173')) throw new Error('Missing EXP');
  if (!r.includes('**Chaz:** 2-3')) throw new Error('Missing Chaz');
  if (r.includes('Recommended Level before fighting:')) throw new Error('Should not include empty-value key');
});

// ── reformat: formatDecorativeText ──
assert('formatDecorativeText: strips // prefix', () => {
  const r = formatDecorativeText(['// DUNGEON #2']);
  if (!r.includes('**DUNGEON #2**')) throw new Error('Got: ' + r);
});
assert('formatDecorativeText: returns null for plain text', () => {
  const r = formatDecorativeText(['Just normal prose text here']);
  if (r !== null) throw new Error('Should return null for plain text, got: ' + r);
});
assert('formatDecorativeText: does NOT mark stat lines as decorative', () => {
  // Stat lines with multi-space columns — shouldn't trigger decorative
  const r = formatDecorativeText(['HP: 300                          Alys: 7']);
  if (r !== null) throw new Error('Stat line with multi-spaces should not be decorative, got: ' + r);
});

// ── reformat: reformatBlock ──
assert('reformatBlock: classifies prose block', () => {
  const r = reformatBlock(['first sentence here', 'second sentence continues']);
  if (!r.includes('first sentence here second sentence continues')) throw new Error('Got: ' + r);
});
assert('reformatBlock: classifies stat block', () => {
  const r = reformatBlock(['HP: 300', 'EXP: 173']);
  if (!r.includes('**HP:** 300')) throw new Error('Got: ' + r);
});

assert('extractText: concatenates multiple pre tags', () => {
  const html = '<pre>Part one</pre><div>ignore</div><pre>Part two</pre>';
  const text = extractText(html);
  if (!text.includes('Part one')) throw new Error('Missing part one');
  if (!text.includes('Part two')) throw new Error('Missing part two');
  if (text.includes('ignore')) throw new Error('Should not include non-pre content');
});

assert('escapeMd: handles empty string', () => {
  if (escapeMd('') !== '') throw new Error('Should return empty string');
});

assert('splitSections: tolerates missing body code', () => {
  const text = [
    'Table of Contents',
    ' 1. Intro                             AAAA',
    ' 2. Missing                           MISS',
    '',
    '***************************************************************************',
    '1. Intro                                                               CAAAA',
    '***************************************************************************',
    'Intro text here.',
  ].join('\n');
  const toc = parseTOC(text);
  const sections = splitSections(text, toc);
  if (sections.length !== 1) throw new Error('Expected 1 section, got ' + sections.length);
  if (!sections[0].content.includes('Intro text')) throw new Error('Missing intro content');
});

// ── reformat: end-to-end paragraph ──
assert('reformat: continuous prose paragraph', () => {
  const input = 'first sentence here\nsecond sentence continues\nthird sentence ends.';
  const r = reformat(input);
  if (r !== 'first sentence here second sentence continues third sentence ends.') throw new Error('Got: ' + JSON.stringify(r));
});

assert('reformat: splits stat block from prose', () => {
  const input = 'HP: 300\nEXP: 173\nMST: 54\n\nThis is a prose paragraph with multiple\nlines of text.';
  const r = reformat(input);
  if (!r.includes('**HP:** 300')) throw new Error('Missing stat formatting');
  if (!r.includes('prose paragraph')) throw new Error('Missing prose content');
});

// ── Phase 1: equipment detection ──
assert('hasEquipSlotLines: detects equipment slots', () => {
  if (!hasEquipSlotLines(['|Head |LTHR-HELM |', '|Right|HUNT-KNIFE|'])) throw new Error('Should detect equipment slots');
  if (hasEquipSlotLines(['| Location | Inn |'])) throw new Error('Should NOT detect as equipment');
  if (hasEquipSlotLines(['Some prose here', 'More prose'])) throw new Error('Should NOT detect equipment');
});

// ── Phase 1: formatEquipmentTable ──
assert('formatEquipmentTable: single character as list', () => {
  const lines = [
    'Starting          |   Chaz   |',
    'Equipment   |¯¯¯¯¯|¯¯¯¯¯¯¯¯¯¯|',
    '            |Head |LTHR-HELM |',
    '            |Right|HUNT-KNIFE|',
    '            |Left |HUNT-KNIFE|',
    '            |Body |LTHR-CLOTH|',
  ];
  const r = formatEquipmentTable(lines);
  if (!r.includes('**Head:**')) throw new Error('Expected bullet list for single char equipment');
  if (!r.includes('LTHR-HELM')) throw new Error('Expected LTHR-HELM in output');
  if (!r.includes('**Equipment**')) throw new Error('Expected equipment header');
});

assert('formatEquipmentTable: multi-character as table', () => {
  const lines = [
    'Recommended       |   Alys   |   Chaz   |',
    'Equipment   |¯¯¯¯¯|¯¯¯¯¯¯¯¯¯¯|¯¯¯¯¯¯¯¯¯¯|',
    '            |Head |LTHR-CROWN|LTHR-HELM |',
    '            |Right|BOOMERANG |HUNT-KNIFE|',
    '            |Left |          |HUNT-KNIFE|',
    '            |Body |LTHR-CLOTH|LTHR-CLOTH|',
  ];
  const r = formatEquipmentTable(lines);
  if (!r.includes('| Slot |')) throw new Error('Expected table header in multi-char equipment');
  if (!r.includes('Alys')) throw new Error('Expected Alys in table');
  if (!r.includes('Chaz')) throw new Error('Expected Chaz in table');
});

// ── Phase 1: stripFrameChars ──
assert('stripFrameChars: removes trailing frame chars', () => {
  if (stripFrameChars('Test') !== 'Test') throw new Error('Should not strip normal text');
  if (stripFrameChars('MONOMATE       20 MST /') !== 'MONOMATE       20 MST') throw new Error('Should strip trailing /');
  if (stripFrameChars('Item    \\') !== 'Item') throw new Error('Should strip trailing \\');
});

// ── Phase 1: isPureBorderRow ──
assert('isPureBorderRow: detects decorative rows', () => {
  if (!isPureBorderRow('|---------------|')) throw new Error('Should detect dash border');
  if (!isPureBorderRow('|¯¯¯¯¯|¯¯¯¯¯|')) throw new Error('Should detect overline border');
  if (!isPureBorderRow('|===|===|')) throw new Error('Should detect equals border');
  if (isPureBorderRow('|Head |LTHR-HELM |')) throw new Error('Should NOT detect equipment as border');
});

// ── Phase 1: formatDecorativeText skips equipment ──
assert('formatDecorativeText: bails on equipment data', () => {
  const lines = [
    'Equipment   |¯¯¯¯¯|¯¯¯¯¯¯¯¯¯¯|',
    '|Head |LTHR-HELM |',
  ];
  const r = formatDecorativeText(lines);
  if (r !== null) throw new Error('Should return null for equipment blocks, got: ' + r);
});

assert('formatDecorativeText: works on real decorative text', () => {
  const r = formatDecorativeText(['// DUNGEON #2 ¯¯\\']);
  if (r === null) throw new Error('Should NOT return null for real decorative text');
  if (!r.includes('**DUNGEON #2**')) throw new Error('Expected dungeon label, got: ' + r);
});

// ── Phase 1: reformatBlock equipment routing ──
assert('reformatBlock: routes equipment to equipment formatter', () => {
  const lines = [
    'Starting          |   Chaz   |',
    '|Head |LTHR-HELM |',
    '|Body |LTHR-CLOTH|',
  ];
  const r = reformatBlock(lines);
  // Must NOT be broken pipe fragments — either a table or a list
  if (!r.includes('LTHR-HELM')) throw new Error('Missing equipment data in output');
  if (r.includes('Starting          |')) throw new Error('Should not have raw pipe text in output');
});

// ── Phase 1: postProcess whitespace ──
assert('reformat: collapses excessive blank lines', () => {
  const input = 'Paragraph one.\n\n\n\nParagraph two.\n\n\nParagraph three.';
  const r = reformat(input);
  const blankSeq = (r.match(/\n\n+/g) || []).map(m => m.length);
  if (blankSeq.some(n => n > 2)) throw new Error('Should not have 3+ consecutive newlines');
});

// ── Phase 2: detection ──
assert('isBossCard: detects boss cards', () => {
  const lines = ['| BOSS #1  \\____________', '| Igglanova', '|  HP: 300'];
  if (!isBossCard(lines)) throw new Error('Should detect boss card');
});

assert('isShopBlock: detects shop listings', () => {
  const lines = ['| Mile | Inn | 10 MST', '| Tool Store | MONOMATE | 20 MST'];
  if (!isShopBlock(lines)) throw new Error('Should detect shop block');
});

assert('isCharacterSheet: detects character sheets', () => {
  const lines = ['|Joins Party: At start|Starting Level: 1|Initial Stats|', '| Head LTHR-HELM | HP 25 |'];
  if (!isCharacterSheet(lines)) throw new Error('Should detect character sheet');
});

assert('isCharacterPortrait: detects ASCII portrait', () => {
  const lines = [
    '  @%@@x**x.                            Chaz Ashley',
    '             #@.   .....                Parmanian',
    '          .%x-@##*========--=========--=+@@x*x###x           (Hunter)',
    '        =#*#    +.- *+---.-=-. .-     ..+++**+***+x#         Age: 16',
    '       *%=#.  *#.- @# .=.+#-..##-#% ##- %#.x#+@x+*+x#       Sex: Male',
    '        -#%*=# -# #% x# #  ###%##########x# -#@.#x+**+#.     Lives:',
    '         @x#.x#-#@-# =# *# ##@%@=   .  -@@# %#=###**        Aiedo'
  ];
  if (!isCharacterPortrait(lines)) throw new Error('Should detect character portrait');
});

// ── Phase 2: formatBossCard ──
assert('formatBossCard: renders plain-text boss stats', () => {
  const lines = [
    '| BOSS #1  \\\\____________  ____________________',
    '| Igglanova             ||                    |',
    '|  HP: 300              ||                    |',
    '| EXP: 173    MST: 54   || Alys: 7           /',
    '| Weak: -               || Chaz: 2-3        /',
    '| Res:  -               || Hahn: 2-3       /',
  ];
  const r = formatBossCard(lines);
  if (!r.includes('BOSS #1 — Igglanova')) throw new Error('Missing boss header');
  if (!r.includes('**HP:** 300')) throw new Error('Missing HP');
  if (!r.includes('Alys (7)')) throw new Error('Missing recommended level');
  if (r.includes('EXP (173)')) throw new Error('Should not treat stats as character levels');
});

// ── Phase 2: formatShopList ──
assert('formatShopList: renders grouped plain-text shop list', () => {
  const lines = [
    '| Mile | Inn | Per person 10 MST |',
    '| Tool Store | MONOMATE 20 MST |  |',
    '|  | ANTIDOTE 10 MST |  |',
    '| Weapon Store | DAGGER 40 MST | +2 ATK |',
    '|  | HUNT-KNIFE 120 MST | +5 ATK |',
  ];
  const r = formatShopList(lines);
  if (!r.includes('**Mile Shops**')) throw new Error('Missing location header');
  if (!r.includes('MONOMATE — 20 MST')) throw new Error('Missing MONOMATE');
  if (!r.includes('ANTIDOTE — 10 MST')) throw new Error('Missing ANTIDOTE');
  if (!r.includes('DAGGER — 40 MST (+2 ATK)')) throw new Error('Missing DAGGER bonus');
});

// ── Phase 2: formatCharacterSheet ──
assert('formatCharacterSheet: extracts stats and equipment', () => {
  const lines = [
    '|Joins Party: At start|Starting Level: 1|Initial Stats|',
    '| Head LTHR-HELM |Initial Techniques: RES| HP 25 |',
    '| Right HUNT-KNIFE |Initial Skills: EARTH (3)| TP 10 |',
    '| Left HUNT-KNIFE | | Str 8 |',
    '| Body LTHR-CLOTH | | Men 6 |',
  ];
  const r = formatCharacterSheet(lines);
  if (!r.includes('**Joins Party:** At start')) throw new Error('Missing join info');
  if (!r.includes('HP 25')) throw new Error('Missing HP stat');
  if (!r.includes('Head: LTHR-HELM')) throw new Error('Missing equipment');
  if (!r.includes('EARTH (3)')) throw new Error('Missing skills');
});

// ── End-to-end: verify generated walkthrough.md ──
assert('e2e: walkthrough.md exists', () => {
  const p = path.join(__dirname, 'walkthrough.md');
  if (!fs.existsSync(p)) throw new Error('walkthrough.md not found');
});

assert('e2e: walkthrough.md has expected sections', () => {
  const p = path.join(__dirname, 'walkthrough.md');
  const md = fs.readFileSync(p, 'utf8');
  if (!md.includes('## Table of Contents')) throw new Error('Missing Table of Contents');
  if (!md.includes('# 1. Legal Jazz/Intro')) throw new Error('Missing section 1 heading');
  if (!md.includes('[11. Special Thanks](#s11)')) throw new Error('Missing TOC entry for last section');
});

assert('e2e: walkthrough.md is substantial', () => {
  const p = path.join(__dirname, 'walkthrough.md');
  const stat = fs.statSync(p);
  if (stat.size < 100000) throw new Error('File too small: ' + stat.size + ' bytes');
});

// ── Roman-numeral format: romanToInt ──
assert('romanToInt: single letters', () => {
  if (romanToInt('i') !== 1) throw new Error('i should be 1');
  if (romanToInt('v') !== 5) throw new Error('v should be 5');
  if (romanToInt('x') !== 10) throw new Error('x should be 10');
  if (romanToInt('l') !== 50) throw new Error('l should be 50');
});

assert('romanToInt: subtractive notation', () => {
  if (romanToInt('iv') !== 4) throw new Error('iv should be 4');
  if (romanToInt('ix') !== 9) throw new Error('ix should be 9');
  if (romanToInt('xlv') !== 45) throw new Error('xlv should be 45, got ' + romanToInt('xlv'));
});

assert('romanToInt: multi-letter', () => {
  if (romanToInt('xx') !== 20) throw new Error('xx should be 20');
  if (romanToInt('xviii') !== 18) throw new Error('xviii should be 18');
  if (romanToInt('xxxix') !== 39) throw new Error('xxxix should be 39');
});

assert('romanToInt: zero passes through', () => {
  if (romanToInt('0') !== 0) throw new Error('0 should be 0');
});

// ── Roman-numeral format: detectFormat ──
assert('detectFormat: detects roman format with +===+', () => {
  if (detectFormat('+====================================+\n| i. Title |\n+======+') !== 'roman')
    throw new Error('Should detect roman format');
});

assert('detectFormat: detects roman format with diamond header', () => {
  const diamond = '/\\' + '='.repeat(30) + '/\\\n|| 0. Version ||\n\\/' + '='.repeat(30) + '/';
  if (detectFormat(diamond) !== 'roman')
    throw new Error('Should detect diamond roman format');
});

assert('detectFormat: detects standard format with CCODE', () => {
  if (detectFormat('1. Intro                             CINRO\nCWALK') !== 'standard')
    throw new Error('Should detect standard format');
});

assert('detectFormat: returns unknown for plain text', () => {
  if (detectFormat('Just a walkthrough with no markers.') !== 'unknown')
    throw new Error('Should return unknown');
});

// ── Roman-numeral format: parseRomanTOC ──
assert('parseRomanTOC: parses full TOC structure', () => {
  const tocText = [
    ' 0---0------------------------------------------------------0---0',
    ' |   |                   TABLE OF CONTENTS                  |   |',
    ' |   |                  +-----------------+                 |   |',
    ' 0---0------------------------------------------------------0---0',
    ' |   |   0. VERSION HISTORY                                 |   |',
    ' |   |   I. INTRODUCTION                                    |   |',
    ' |===|======================================================|===|',
    ' |   |                    DRAGON QUEST I                    |   |',
    ' |===|======================================================|===|',
    ' |   |     I. WALKTHROUGH                                   |   |',
    ' |   |      i. Introduction                                 |   |',
    ' |   |     ii. Radatome Castle                              |   |',
    ' |===|======================================================|===|',
    ' |   |      DRAGON QUEST II: GODS OF THE EVIL SPIRITS       |   |',
    ' |===|======================================================|===|',
    ' |   |     I. WALKTHROUGH                                   |   |',
    ' |   |      i. Introduction                                 |   |',
    ' |   |     ii. Laurasia Castle                              |   |',
    ' |   |   II. CONCLUSION                                     |   |',
    ' |   |  III. NEXT TIME...                                   |   |',
  ].join('\n');

  const toc = parseRomanTOC(tocText);
  if (toc.length < 7) throw new Error('Expected at least 7 entries, got ' + toc.length);
  if (toc[0].num !== '0' || toc[0].title !== 'VERSION HISTORY') throw new Error('Entry 0: ' + JSON.stringify(toc[0]));
  if (toc[1].num !== '1' || toc[1].title !== 'INTRODUCTION') throw new Error('Entry 1: ' + JSON.stringify(toc[1]));
  if (toc[2].num !== '2' || toc[2].title !== 'WALKTHROUGH') throw new Error('Entry 2: ' + JSON.stringify(toc[2]));
  if (toc[3].num !== '2.1' || toc[3].title !== 'Introduction') throw new Error('Entry 3: ' + JSON.stringify(toc[3]));
  if (toc[4].num !== '2.2' || toc[4].title !== 'Radatome Castle') throw new Error('Entry 4: ' + JSON.stringify(toc[4]));
  // DQ II sections
  const dq2Walk = toc.find(e => e.num === '3');
  if (!dq2Walk || dq2Walk.title !== 'WALKTHROUGH') throw new Error('Missing DQ II walkthrough');
  const dq2Intro = toc.find(e => e.num === '3.1');
  if (!dq2Intro || dq2Intro.title !== 'Introduction') throw new Error('Missing DQ II intro');
  const dq2Laur = toc.find(e => e.num === '3.2');
  if (!dq2Laur || dq2Laur.title !== 'Laurasia Castle') throw new Error('Missing DQ II Laurasia');
  // Post-game sections
  const concl = toc.find(e => e.num === '4');
  if (!concl || concl.title !== 'CONCLUSION') throw new Error('Missing CONCLUSION');
  const next = toc.find(e => e.num === '5');
  if (!next || next.title !== 'NEXT TIME...') throw new Error('Missing NEXT TIME');
});

assert('parseRomanTOC: sets correct levels', () => {
  const tocText = [
    ' |   |                   TABLE OF CONTENTS                  |   |',
    ' |   |   0. VERSION HISTORY                                 |   |',
    ' |   |                    DRAGON QUEST I                    |   |',
    ' |   |     I. WALKTHROUGH                                   |   |',
    ' |   |      i. Introduction                                 |   |',
  ].join('\n');

  const toc = parseRomanTOC(tocText);
  if (toc[0].level !== 1) throw new Error('Level-1 entry should be level 1, got ' + toc[0].level);
  if (toc[1].level !== 1) throw new Error('Level-1 walkthrough should be level 1, got ' + toc[1].level);
  if (toc[2].level !== 2) throw new Error('Level-2 subsection should be level 2, got ' + toc[2].level);
});

// ── Roman-numeral format: splitRomanSections ──
assert('splitRomanSections: splits body by diamond headers', () => {
  const body = [
    ' 0---0------------------------------------------------------0---0',
    ' |   |                   TABLE OF CONTENTS                  |   |',
    ' 0---0------------------------------------------------------0---0',
    ' 0---0------------------------------------------------------0---0',
    ' |   |                   TABLE OF CONTENTS                  |   |',
    ' 0---0------------------------------------------------------0---0',
    '  /\\============================================================/\\',
    '  ||                     0. VERSION HISTORY                      ||',
    '  \\/============================================================\\/',
    '  Version: Final',
    '',
    '  Guide completed!',
    '',
    '  /\\============================================================/\\',
    '  ||                      I. INTRODUCTION                       ||',
    '  \\/============================================================\\/',
    '  Welcome to this guide.',
  ].join('\n');

  const toc = parseRomanTOC(body);
  const sections = splitRomanSections(body, toc);
  if (sections.length !== 2) throw new Error('Expected 2 sections, got ' + sections.length);
  if (!sections[0].content.includes('Version: Final')) throw new Error('Missing version content: ' + sections[0].content);
  if (!sections[1].content.includes('Welcome')) throw new Error('Missing intro content: ' + sections[1].content);
});

assert('splitRomanSections: splits body by box headers', () => {
  const body = [
    ' |   |                   TABLE OF CONTENTS                  |   |',
    ' |   |   0. VERSION HISTORY                                 |   |',
    ' |   |     I. WALKTHROUGH                                   |   |',
    ' |   |      i. Introduction                                 |   |',
    ' 0---0------------------------------------------------------0---0',
    ' |   |                   TABLE OF CONTENTS                  |   |',
    ' 0---0------------------------------------------------------0---0',
    '  /\\============================================================/\\',
    '  ||                     0. VERSION HISTORY                      ||',
    '  \\/============================================================\\/',
    '  Version info here.',
    '',
    '  /\\============================================================/\\',
    '  ||                      I. WALKTHROUGH                        ||',
    '  \\/============================================================\\/',
    '  Walkthrough starts.',
    '',
    '  +==============================================================+',
    '  |                      i. Introduction                         |',
    '  +==============================================================+',
    '  Introduction text here.',
  ].join('\n');

  const toc = parseRomanTOC(body);
  const sections = splitRomanSections(body, toc);
  if (sections.length !== 3) throw new Error('Expected 3 sections, got ' + sections.length);
  if (!sections[2].content.includes('Introduction text')) throw new Error('Missing walkthrough intro: ' + sections[2].content);
});

// ── Roman-format: reformat sub-headers ──
assert('formatRomanSubHeader: formats overworld sub-header', () => {
  const lines = [
    '+--------------------------------------------------------------+',
    '|                        - Overworld -                         |',
    '|                     (Radatome Outskirts)                     |',
    '+--------------------------------------------------------------+',
  ];
  const r = formatRomanSubHeader(lines);
  if (!r.includes('**Overworld**')) throw new Error('Expected Overworld bold, got: ' + r);
  if (!r.includes('*(Radatome Outskirts)*')) throw new Error('Expected parenthetical italic, got: ' + r);
});

assert('formatRomanSubHeader: formats simple location label', () => {
  const lines = [
    '+--------------------------------------------------------------+',
    '|                        - Dungeon B1 -                        |',
    '+--------------------------------------------------------------+',
  ];
  const r = formatRomanSubHeader(lines);
  if (!r.includes('**Dungeon B1**')) throw new Error('Expected Dungeon B1 bold, got: ' + r);
});

// ── lib/cli: parseArgs ──
assert('parseArgs: parses --flag=value', () => {
  const r = parseArgs(['--game=50'], { flags: { game: { value: 'ID' } } });
  if (r.flags.game !== '50') throw new Error('Expected game=50, got ' + r.flags.game);
});

assert('parseArgs: parses --flag=value', () => {
  const r = parseArgs(['--output=out.md']);
  if (r.flags.output !== 'out.md') throw new Error('Expected output=out.md, got ' + r.flags.output);
});

assert('parseArgs: boolean flag sets true', () => {
  const r = parseArgs(['--comments'], { flags: { comments: { value: '' } } });
  if (r.flags.comments !== true) throw new Error('Expected comments=true, got ' + r.flags.comments);
});

assert('parseArgs: boolean flag does not consume next positional', () => {
  const r = parseArgs(['--comments', 'file.json'], { flags: { comments: { value: '' } } });
  if (r.flags.comments !== true) throw new Error('Expected comments=true, got ' + r.flags.comments);
  if (r.positional[0] !== 'file.json') throw new Error('Expected file.json as positional, got ' + r.positional[0]);
});

assert('parseArgs: collects positional args', () => {
  const r = parseArgs(['input.txt', 'output.md'], { flags: {} });
  if (r.positional.length !== 2) throw new Error('Expected 2 positionals, got ' + r.positional.length);
  if (r.positional[0] !== 'input.txt') throw new Error('Expected input.txt');
  if (r.positional[1] !== 'output.md') throw new Error('Expected output.md');
});

assert('parseArgs: --help returns help flag', () => {
  const r = parseArgs(['--help'], { flags: {} });
  if (r.help !== true) throw new Error('Expected help=true');
});

assert('parseArgs: -h returns help flag', () => {
  const r = parseArgs(['-h'], { flags: {} });
  if (r.help !== true) throw new Error('Expected help=true');
});

assert('parseArgs: bare flag at end of args is boolean', () => {
  const r = parseArgs(['--output']);
  if (r.flags.output !== true) throw new Error('Expected true, got ' + r.flags.output);
});

assert('parseArgs: mixed flags and positionals', () => {
  const r = parseArgs(['--game=50', 'input.txt', '--comments'], { flags: { game: { value: 'ID' }, comments: { value: '' } } });
  if (r.flags.game !== '50') throw new Error('Expected game=50');
  if (r.flags.comments !== true) throw new Error('Expected comments=true');
  if (r.positional[0] !== 'input.txt') throw new Error('Expected input.txt');
});

// ── lib/cli: validateInputFile ──
assert('validateInputFile: throws on missing file', () => {
  let caught = false;
  try { validateInputFile('/nonexistent/file.txt'); } catch (e) { caught = true; }
  if (!caught) throw new Error('Should throw on missing file');
});

assert('validateInputFile: throws on empty path', () => {
  let caught = false;
  try { validateInputFile(''); } catch (e) { caught = true; }
  if (!caught) throw new Error('Should throw on empty path');
});

assert('validateInputFile: accepts existing file', () => {
  const p = path.join(__dirname, 'test.js');
  validateInputFile(p);
});

// ── convert-core: parseAuthor ──
assert('parseAuthor: extracts author from Walkthrough by pattern', () => {
  const html = '<pre>Walkthrough by Young-Gamer</pre>';
  const result = parseAuthor(html, '');
  if (result !== 'Young-Gamer') throw new Error('Expected Young-Gamer, got ' + result);
});

assert('parseAuthor: extracts author from title tag', () => {
  const html = '<title>GameFAQs: Chrono Cross Walkthrough by FByouth</title>';
  const result = parseAuthor(html, '');
  if (result !== 'FByouth') throw new Error('Expected FByouth, got ' + result);
});

assert('parseAuthor: returns null when no author found', () => {
  const html = '<pre>Some random text without author info</pre>';
  const result = parseAuthor(html, '');
  if (result !== null) throw new Error('Expected null, got ' + result);
});

// ── convert-core: parseTitle ──
assert('parseTitle: extracts game title from title tag', () => {
  const html = '<title>GameFAQs: Phantasy Star IV Walkthrough by FByouth</title>';
  const result = parseTitle(html);
  if (result !== 'Phantasy Star IV') throw new Error('Expected "Phantasy Star IV", got ' + JSON.stringify(result));
});

assert('parseTitle: decodes HTML entities in title', () => {
  const html = '<title>GameFAQs: Dragon Quest I &amp; II Walkthrough by Young-Gamer</title>';
  const result = parseTitle(html);
  if (result !== 'Dragon Quest I & II') throw new Error('Expected "Dragon Quest I & II", got ' + JSON.stringify(result));
});

assert('parseTitle: returns null when no title tag match', () => {
  const html = '<title>Some Other Page</title>';
  const result = parseTitle(html);
  if (result !== null) throw new Error('Expected null, got ' + result);
});

// ── reformat: formatTable ──
assert('formatTable: renders simple pipe-delimited table', () => {
  const lines = ['| Name | HP | MP |', '|---|---|---|', '| Alys | 50 | 10 |'];
  const r = formatTable(lines);
  if (!r.includes('| Name | HP | MP |')) throw new Error('Missing header row');
  if (!r.includes('| Alys | 50 | 10 |')) throw new Error('Missing data row');
  if (!r.includes('| --- | --- | --- |')) throw new Error('Missing separator');
});

assert('formatTable: skips decorative border rows', () => {
  const lines = ['| Name | HP |', '|¯¯¯¯¯|¯¯¯|', '| Alys | 50 |'];
  const r = formatTable(lines);
  if (!r.includes('Alys')) throw new Error('Missing data row');
  if (r.includes('¯¯¯')) throw new Error('Should not include border row');
});

assert('formatTable: returns empty for no data rows', () => {
  const lines = ['|¯¯¯¯¯|¯¯¯|'];
  const r = formatTable(lines);
  if (r !== '') throw new Error('Expected empty string for border-only table, got ' + r);
});

assert('formatTable: handles table without leading pipe', () => {
  const lines = ['| Name | HP |', '| Alys | 50 |'];
  const r = formatTable(lines);
  if (!r.includes('Alys')) throw new Error('Missing data row, got: ' + r);
});

// ── reformat: formatAscii ──
assert('formatAscii: wraps content in code block', () => {
  const lines = ['  +---+', '  | X |', '  +---+'];
  const r = formatAscii(lines);
  if (!r.startsWith('```\n')) throw new Error('Should start with code fence');
  if (!r.endsWith('\n```\n\n')) throw new Error('Should end with code fence');
  if (!r.includes('| X |')) throw new Error('Should include content');
});

assert('formatAscii: returns empty for single decorative line', () => {
  const lines = ['========================'];
  const r = formatAscii(lines);
  if (r !== '') throw new Error('Should return empty for single decorative line, got ' + r);
});

assert('formatAscii: preserves multi-line ASCII art', () => {
  const lines = ['+-----+', '| ABC |', '+-----+'];
  const r = formatAscii(lines);
  if (!r.includes('ABC')) throw new Error('Should preserve ASCII art content');
});

// ── reformat/classify: classifyLine ──
assert('classifyLine: classifies blank lines', () => {
  if (classifyLine('') !== 'blank') throw new Error('Expected blank');
  if (classifyLine('   ') !== 'blank') throw new Error('Expected blank for whitespace');
});

assert('classifyLine: classifies decorative lines', () => {
  if (classifyLine('========================') !== 'decorative') throw new Error('Expected decorative');
  if (classifyLine('¯¯¯¯¯¯¯¯¯¯¯¯¯¯¯¯') !== 'decorative') throw new Error('Expected decorative for overline');
});

assert('classifyLine: classifies pipe lines', () => {
  if (classifyLine('| Name | HP |') !== 'pipe') throw new Error('Expected pipe');
});

assert('classifyLine: classifies stat lines', () => {
  if (classifyLine('HP: 300') !== 'stat') throw new Error('Expected stat');
});

assert('classifyLine: classifies prose lines', () => {
  if (classifyLine('This is a normal sentence.') !== 'prose') throw new Error('Expected prose');
});

// ── reformat/classify: segmentLines ──
assert('segmentLines: groups consecutive same-type lines', () => {
  const groups = segmentLines(['HP: 300', 'EXP: 173', 'Some prose here']);
  if (groups.length !== 2) throw new Error('Expected 2 groups, got ' + groups.length);
  if (groups[0].type !== 'stat') throw new Error('Expected stat group, got ' + groups[0].type);
  if (groups[0].lines.length !== 2) throw new Error('Expected 2 stat lines, got ' + groups[0].lines.length);
  if (groups[1].type !== 'prose') throw new Error('Expected prose group, got ' + groups[1].type);
});

assert('segmentLines: creates separate groups for type changes', () => {
  const groups = segmentLines(['| Name | HP |', 'HP: 300', 'Some text']);
  if (groups.length !== 3) throw new Error('Expected 3 groups, got ' + groups.length);
});

assert('segmentLines: handles empty input', () => {
  const groups = segmentLines([]);
  if (groups.length !== 0) throw new Error('Expected 0 groups for empty input');
});

// ── reformat/classify: hasConsistentPipes ──
assert('hasConsistentPipes: returns true for consistent pipe tables', () => {
  const lines = ['| Name | HP |', '| Alys | 50 |', '| Chaz | 30 |'];
  if (!hasConsistentPipes(lines)) throw new Error('Should detect consistent pipes');
});

assert('hasConsistentPipes: returns false for inconsistent pipes', () => {
  const lines = ['| Name | HP |', 'Some text without pipes'];
  if (hasConsistentPipes(lines)) throw new Error('Should not detect inconsistent pipes');
});

assert('hasConsistentPipes: returns false for ASCII art with pipes', () => {
  const lines = ['+=====+', '|  X  |', '+=====+'];
  if (hasConsistentPipes(lines)) throw new Error('Should not detect ASCII art as consistent pipes');
});

// ── reformat/classify: formatMixed paths ──
assert('formatMixed: roman sub-header multi-line', () => {
  const lines = ['| - Overworld - |', '| (Radatome Outskirts) |'];
  const r = formatMixed(lines);
  if (!r.includes('**Overworld**')) throw new Error('Expected Overworld bold, got: ' + r);
  if (!r.includes('*(Radatome Outskirts)*')) throw new Error('Expected italic parenthetical, got: ' + r);
});

assert('formatMixed: equipment table', () => {
  const lines = [
    'Starting          |   Chaz   |',
    '|Head |LTHR-HELM |',
    '|Body |LTHR-CLOTH|',
  ];
  const r = formatMixed(lines);
  if (!r.includes('LTHR-HELM')) throw new Error('Missing equipment data');
});

assert('formatMixed: shop listing', () => {
  const lines = [
    '| Mile | Inn | 10 MST |',
    '| Tool Store | MONOMATE | 20 MST |',
  ];
  const r = formatMixed(lines);
  if (!r.includes('MONOMATE')) throw new Error('Missing shop item');
});

assert('formatMixed: consistent pipe table', () => {
  const lines = [
    '| Name | HP |',
    '| Alys | 50 |',
    '| Chaz | 30 |',
  ];
  const r = formatMixed(lines);
  if (!r.includes('| Name |')) throw new Error('Missing table header');
});

assert('formatMixed: prose lines handled by decorative detector', () => {
  const lines = [
    '// DUNGEON #1 \\\\',
    '// BOSS: Igglanova',
  ];
  const r = formatMixed(lines);
  if (!r.includes('**DUNGEON #1**')) throw new Error('Missing dungeon label, got: ' + r);
  if (!r.includes('**BOSS: Igglanova**')) throw new Error('Missing boss label, got: ' + r);
});

assert('formatMixed: single-line roman sub-header', () => {
  const lines = ['| - Dungeon B1 - |'];
  const r = formatMixed(lines);
  if (!r.includes('**Dungeon B1**')) throw new Error('Expected bold label, got: ' + r);
});

assert('formatMixed: single-line dungeon entrance stripped', () => {
  const lines = ['|/  Academy Basement       \\_________________________________'];
  const r = formatMixed(lines);
  if (r !== '') throw new Error('Expected empty for dungeon entrance marker, got: ' + r);
});

assert('formatMixed: single-line decorative pipe stripped', () => {
  const lines = ['|¯¯¯¯¯¯¯¯¯¯¯¯¯¯¯¯|'];
  const r = formatMixed(lines);
  if (r !== '') throw new Error('Expected empty for decorative fragment, got: ' + r);
});

assert('formatMixed: stat lines formatted', () => {
  const lines = ['HP: 300', 'EXP: 173'];
  const r = formatMixed(lines);
  if (!r.includes('**HP:** 300')) throw new Error('Missing stat formatting, got: ' + r);
});

assert('formatMixed: decorative lines stripped', () => {
  const lines = ['========================'];
  const r = formatMixed(lines);
  if (r !== '') throw new Error('Expected empty for decorative lines, got: ' + r);
});

assert('formatMixed: prose fallback', () => {
  const lines = ['This is normal text.'];
  const r = formatMixed(lines);
  if (!r.includes('This is normal text.')) throw new Error('Expected prose output, got: ' + r);
});

// ── utils: anchorId ──
assert('anchorId: converts dots to hyphens with s prefix', () => {
  if (anchorIdStr('6.4.8') !== 's6-4-8') throw new Error('Expected s6-4-8, got ' + anchorIdStr('6.4.8'));
});

assert('anchorId: handles single section number', () => {
  if (anchorIdStr('2') !== 's2') throw new Error('Expected s2, got ' + anchorIdStr('2'));
});

// ── Phase 2: generalized detection ──
assert('isShopBlock: detects GP currency', () => {
  const lines = ['| Town | Inn | 5 GP |'];
  if (!isShopBlock(lines)) throw new Error('Should detect shop with GP currency');
});

assert('isShopBlock: detects Gold currency', () => {
  const lines = ['Weapon Shop | Iron Sword | 100 Gold |'];
  if (!isShopBlock(lines)) throw new Error('Should detect shop with Gold currency');
});

assert('isCharacterPortrait: matches with only Age and Level', () => {
  const lines = [
    '  Portrait art here',
    '  Age: 25',
    '  Level: 10',
  ];
  if (!isCharacterPortrait(lines)) throw new Error('Should detect portrait with Age + Level');
});

// ── Negative/error tests ──
assert('formatProse: handles array of empty strings', () => {
  const r = formatProse(['', '', '']);
  if (r !== '') throw new Error('Expected empty for blank input');
});

assert('formatStatBlock: handles single stat line', () => {
  const r = formatStatBlock(['HP: 300']);
  if (!r.includes('**HP:** 300')) throw new Error('Missing single stat');
});

assert('reformat: handles empty input', () => {
  const r = reformat('');
  if (r !== '') throw new Error('Expected empty string for empty input, got: ' + JSON.stringify(r));
});

assert('reformat: handles whitespace-only input', () => {
  const r = reformat('   \n\n  \n   ');
  if (r !== '') throw new Error('Expected empty string for whitespace input, got: ' + JSON.stringify(r));
});

// ── Dash format: detectFormat ──
assert('detectFormat: detects dash format with ===== and -----', () => {
  const text = '=====================\nVersion Updates\n=====================\n\n---------------------\nController\n---------------------\n';
  if (detectFormat(text) !== 'dash') throw new Error('Should detect dash format');
});

assert('detectFormat: does not false-positive standard format as dash', () => {
  const text = '1. Intro                             CINRO\nCWALK\n';
  if (detectFormat(text) !== 'standard') throw new Error('Should detect standard, not dash');
});

assert('detectFormat: does not false-positive roman format as dash', () => {
  const text = '+====================================+\n| i. Title |\n+======+\n';
  if (detectFormat(text) !== 'roman') throw new Error('Should detect roman, not dash');
});

// ── Dash format: parseDashTOC ──
assert('parseDashTOC: parses indentation-based TOC', () => {
  const tocText = [
    '=================',
    'Table of contents',
    '=================',
    '',
    '  Version Updates',
    '',
    '  FAQ',
    '',
    '  Controls',
    '     Controller',
    '     Statistics',
    '',
    '  Walkthrough',
    '    Chapter 1: The Outset',
    '       1. Apologize for your mischief',
    '       2. The trials of the 5 towers',
    '    Chapter 2: Resurrection of the World',
    '       1. Save the Ra Tree',
    '',
    '=====================',
    'Version Updates',
    '=====================',
  ].join('\n');

  const toc = parseDashTOC(tocText);
  if (toc.length < 10) throw new Error('Expected at least 10 entries, got ' + toc.length);
  if (toc[0].title !== 'Version Updates') throw new Error('First entry should be Version Updates, got: ' + toc[0].title);
  if (toc[0].level !== 1) throw new Error('Version Updates should be level 1');
});

assert('parseDashTOC: assigns correct levels and numbering', () => {
  const tocText = [
    '=================',
    'Table of contents',
    '=================',
    '',
    '  Controls',
    '     Controller',
    '     Statistics',
    '',
    '=====================',
    'Controls',
    '=====================',
  ].join('\n');

  const toc = parseDashTOC(tocText);
  if (toc.length < 3) throw new Error('Expected at least 3 entries, got ' + toc.length);
  if (toc[0].num !== '1' || toc[0].level !== 1) throw new Error('Controls should be 1/level1, got: ' + JSON.stringify(toc[0]));
  if (toc[1].num !== '1.1' || toc[1].level !== 2) throw new Error('Controller should be 1.1/level2, got: ' + JSON.stringify(toc[1]));
  if (toc[2].num !== '1.2' || toc[2].level !== 2) throw new Error('Statistics should be 1.2/level2, got: ' + JSON.stringify(toc[2]));
});

assert('parseDashTOC: handles Chapter N: pattern', () => {
  const tocText = [
    '=================',
    'Table of contents',
    '=================',
    '',
    '  Walkthrough',
    '    Chapter 1: The Outset',
    '       1. First step',
    '       2. Second step',
    '    Chapter 2: Next Chapter',
    '       1. Another step',
    '',
    '=====================',
    'Walkthrough',
    '=====================',
  ].join('\n');

  const toc = parseDashTOC(tocText);
  const chapter1 = toc.find(e => e.title === 'The Outset');
  if (!chapter1) throw new Error('Should find Chapter 1 entry');
  if (chapter1.level !== 2) throw new Error('Chapter 1 should be level 2, got: ' + chapter1.level);
});

// ── Dash format: splitDashSections ──
assert('splitDashSections: splits at ===== and ----- boundaries', () => {
  const text = [
    '=====================',
    'Version Updates',
    '=====================',
    '',
    'Version 1.0 content here.',
    '',
    '=====================',
    'Controls',
    '=====================',
    '',
    '---------------------',
    'Controller',
    '---------------------',
    '',
    'Controller content here.',
    '',
    '---------------------',
    'Statistics',
    '---------------------',
    '',
    'Statistics content here.',
  ].join('\n');

  const toc = [
    { num: '1', title: 'Version Updates', level: 1 },
    { num: '2', title: 'Controls', level: 1 },
    { num: '2.1', title: 'Controller', level: 2 },
    { num: '2.2', title: 'Statistics', level: 2 },
  ];

  const sections = splitDashSections(text, toc);
  if (sections.length !== 4) throw new Error('Expected 4 sections, got ' + sections.length);
  if (sections[0].title !== 'Version Updates') throw new Error('First section should be Version Updates');
  if (!sections[0].content.includes('Version 1.0')) throw new Error('Version Updates content missing');
  if (sections[2].title !== 'Controller') throw new Error('Third section should be Controller');
  if (!sections[2].content.includes('Controller content')) throw new Error('Controller content missing');
});

assert('splitDashSections: unmatched sub-headers stay as content', () => {
  const text = [
    '=====================',
    'Walkthrough',
    '=====================',
    '',
    '---------------------',
    'Chapter 1',
    '---------------------',
    '',
    '--Crysta--',
    'Some walkthrough content.',
    '',
    '---------------------',
    'Mini-Boss: Red Huball',
    '---------------------',
    '',
    'Boss fight content.',
  ].join('\n');

  const toc = [
    { num: '1', title: 'Walkthrough', level: 1 },
    { num: '1.1', title: 'Chapter 1', level: 2 },
  ];

  const sections = splitDashSections(text, toc);
  // Walkthrough and Chapter 1 become sections; Mini-Boss stays as content
  if (sections.length !== 2) throw new Error('Expected 2 sections, got ' + sections.length);
  if (!sections[1].content.includes('--Crysta--')) throw new Error('Chapter 1 should contain --Crysta--');
  // Mini-Boss wrapped in ----- stays as content (not a section) because unmatched
  if (!sections[1].content.includes('Mini-Boss')) throw new Error('Chapter 1 should contain Mini-Boss as content');
});

assert('splitDashSections: matches sections to TOC entries by title', () => {
  const text = [
    '=====================',
    'FAQ',
    '=====================',
    '',
    'FAQ content here.',
    '',
    '=====================',
    'Controls',
    '=====================',
    '',
    'Controls content here.',
  ].join('\n');

  const toc = [
    { num: '1', title: 'FAQ', level: 1 },
    { num: '2', title: 'Controls', level: 1 },
  ];

  const sections = splitDashSections(text, toc);
  if (sections.length !== 2) throw new Error('Expected 2 sections, got ' + sections.length);
  if (sections[0].num !== '1') throw new Error('First section should have num 1');
  if (sections[1].num !== '2') throw new Error('Second section should have num 2');
});

// ── Hash-title format: detectFormat ──

assert('detectFormat: detects hash format', () => {
  const text = 'garbage\n' +
    '-=-=-=-=-=-=-=-=-\n' +
    '# Test Section #\n' +
    '-=-=-=-=-=-=-=-=-\n' +
    'some content\n' +
    '-=-=-=-=\n' +
    '# Another Section #\n' +
    '-=-=-=-=\n' +
    'more content';
  const result = detectFormat(text);
  if (result !== 'hash') throw new Error('Expected hash, got ' + result);
});

assert('detectFormat: does not false-positive hash on plain dash lines', () => {
  const text = '-----------------\nsome text\n-----------------';
  const result = detectFormat(text);
  if (result === 'hash') throw new Error('Should not detect hash without # title');
});

// ── Hash-title format: parseHashTOC ──

assert('parseHashTOC: parses bullet TOC', () => {
  const text = 'preamble\n' +
    'o-=-=-=-=-=-=-=-=-=-o\n' +
    '± Table of Contents ±\n' +
    'o-=-=-=-=-=-=-=-=-=-o\n' +
    '\n' +
    '¤ First Section\n' +
    '¤ Second Section!\n' +
    '¤ Third Section\n' +
    '\n' +
    '-=-=-=-=-=-=-=-=-\n' +
    '# First Section #\n' +
    '-=-=-=-=-=-=-=-=-\n' +
    'body one\n' +
    '-=-=-=-=-=-=-=-=-\n' +
    '# Second Section #\n' +
    '-=-=-=-=-=-=-=-=-\n' +
    'body two\n' +
    '-=-=-=-=-=-=-=-=-\n' +
    '# Third Section #\n' +
    '-=-=-=-=-=-=-=-=-\n' +
    'body three';
  const entries = parseHashTOC(text);
  if (entries.length !== 3) throw new Error('Expected 3 entries, got ' + entries.length);
  if (entries[0].title !== 'First Section') throw new Error('Expected First Section, got ' + entries[0].title);
  if (entries[1].title !== 'Second Section') throw new Error('Expected Second Section (stripped !), got ' + entries[1].title);
  if (entries[2].title !== 'Third Section') throw new Error('Expected Third Section, got ' + entries[2].title);
  if (entries[0].num !== '1') throw new Error('Expected num 1, got ' + entries[0].num);
  if (entries[0].level !== 1) throw new Error('Expected level 1, got ' + entries[0].level);
});

assert('parseHashTOC: detects subsections from body', () => {
  const text = 'some preamble\n' +
    '± Table of Contents ±\n\n' +
    '¤ Walkthrough\n\n' +
    '-=-=-=-=-=-=-=-\n# Walkthrough #\n-=-=-=-=-=-=-=-\n' +
    'intro\n' +
    '¤¤¤¤¤¤¤¤¤\n± Elcid ±\n°°°°°°°°°\n' +
    'elcid content\n' +
    '«««««««««««««\n± MAXIM ±\n°°°°°°°°°°°°°\n' +
    'maxim content\n' +
    '-=-=-=-=-=-=-=-\n# Credits #\n-=-=-=-=-=-=-=-\n' +
    'thanks';
  const entries = parseHashTOC(text);
  if (entries.length < 3) throw new Error('Expected at least 3 entries, got ' + entries.length);
  if (entries[0].num !== '1') throw new Error('Expected num 1 (parent), got ' + entries[0].num);
  if (entries[0].level !== 1) throw new Error('Expected level 1, got ' + entries[0].level);
  // Check first subsection
  if (entries[1].num !== '1.1') throw new Error('Expected num 1.1 for first sub, got ' + entries[1].num);
  if (entries[1].title !== 'Elcid') throw new Error('Expected Elcid, got ' + entries[1].title);
  if (entries[1].level !== 2) throw new Error('Expected level 2, got ' + entries[1].level);
  // Check «-variant subsection
  if (entries[2].num !== '1.2') throw new Error('Expected num 1.2, got ' + entries[2].num);
  if (entries[2].title !== 'MAXIM') throw new Error('Expected MAXIM, got ' + entries[2].title);
  if (entries[2].level !== 2) throw new Error('Expected level 2, got ' + entries[2].level);
});

// ── Hash-title format: splitHashSections ──

assert('splitHashSections: splits on hash headers', () => {
  const text = [
    'preamble',
    '-=-=-=-=-=-=-=-=-=-=-',
    '# Section One #',
    '-=-=-=-=-=-=-=-=-=-=-',
    'content one line 1',
    'content one line 2',
    '-=-=-=-=-=-=-=-',
    '# Section Two #',
    '-=-=-=-=-=-=-=-',
    'content two line 1',
    'content two line 2',
  ].join('\n');
  const toc = [
    { num: '1', title: 'Section One', level: 1 },
    { num: '2', title: 'Section Two', level: 1 },
  ];
  const sections = splitHashSections(text, toc);
  if (sections.length !== 2) throw new Error('Expected 2 sections, got ' + sections.length);
  if (sections[0].num !== '1') throw new Error('First section should have num 1');
  if (!sections[0].content.includes('content one')) throw new Error('First section missing content');
  if (sections[1].num !== '2') throw new Error('Second section should have num 2');
  if (!sections[1].content.includes('content two')) throw new Error('Second section missing content');
});

assert('splitHashSections: splits on subsections', () => {
  const lines = [
    '-=-=-=-=-=-=-=-=-\n# Main Walkthrough #\n-=-=-=-=-=-=-=-=-',
    'intro text',
    '¤¤¤¤¤¤¤¤¤\n± Elcid ±\n°°°°°°°°°',
    'elcid body',
    '«««««««««\n± Cave ±\n°°°°°°°°°',
    'cave body',
    '-=-=-=-=-=-=-=-=-=-\n# Credits #\n-=-=-=-=-=-=-=-=-=-',
    'thanks',
  ];
  const text = lines.join('\n');
  const toc = [
    { num: '4', title: 'Main Walkthrough', level: 1 },
    { num: '4.1', title: 'Elcid', level: 2 },
    { num: '4.2', title: 'Cave', level: 2 },
    { num: '11', title: 'Credits', level: 1 },
  ];
  const sections = splitHashSections(text, toc);
  if (sections.length !== 4) throw new Error('Expected 4 sections, got ' + sections.length);
  if (sections[0].num !== '4') throw new Error('Expected section 4');
  if (!sections[0].content.includes('intro text')) throw new Error('Section 4 missing intro');
  if (sections[1].num !== '4.1') throw new Error('Expected section 4.1');
  if (!sections[1].content.includes('elcid body')) throw new Error('Section 4.1 missing content');
  if (sections[2].num !== '4.2') throw new Error('Expected section 4.2, got ' + sections[2].num);
  if (!sections[2].content.includes('cave body')) throw new Error('Section 4.2 missing content');
  if (sections[3].num !== '11') throw new Error('Expected section 11');
  if (!sections[3].content.includes('thanks')) throw new Error('Section 11 missing content');
  // Verify subsection frames are stripped from content
  for (const s of sections) {
    if (s.content.includes('±')) throw new Error(s.num + ' content still has ± border');
  }
});

// ── Summary ──
console.log('');
console.log('  \x1b[32mPassed:\x1b[0m ' + passed);
if (failed > 0) {
  console.log('  \x1b[31mFailed:\x1b[0m ' + failed);
  failures.forEach(f => console.log('    ' + f));
  process.exit(1);
} else {
  console.log('  \x1b[32mAll ' + passed + ' tests passed.\x1b[0m');
  process.exit(0);
}
