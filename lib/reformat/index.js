// Main reformatting entry points and public API.

const {
  isDecorativeLine, isAsciiArtBlock, isTableBlock, isStatBlock,
  hasEquipSlotLines, isBossCard, isShopBlock, isCharacterSheet, isCharacterPortrait,
  isRomanSubHeader, isHashSubHeader
} = require('./detect');
const {
  formatProse, formatTable, formatAscii,
  formatStatBlock, formatDecorativeText, formatEquipmentTable,
  formatBossCard, formatShopList, formatCharacterSheet, formatCharacterPortrait,
  formatRomanSubHeader, formatHashSubHeader
} = require('./format');
const { formatMixed, classifyArtBlock } = require('./classify');

function reformatBlock(lines) {
  // Phase 1: Full-block checks for content that must stay whole
  if (lines.every(l => isDecorativeLine(l))) return '';

  // Phase 2: Known ASCII-card types — extract plain text directly
  if (isBossCard(lines)) return formatBossCard(lines);
  if (isCharacterSheet(lines)) return formatCharacterSheet(lines);
  if (isCharacterPortrait(lines)) return formatCharacterPortrait(lines);

  // Phase 2.3: Roman-format sub-headers (+----+ boxes)
  if (isRomanSubHeader(lines)) return formatRomanSubHeader(lines);

  // Phase 2.5: Hash-format subsection headers (± Title ± in ¤¤¤/°°° frames)
  if (isHashSubHeader(lines)) return formatHashSubHeader(lines);

  // Phase 3: Check ASCII art — if mixed with stat/table lines, segment anyway
  if (isAsciiArtBlock(lines)) {
    const hasStat = lines.some(l => /^\w[\w\s]+\s*:\s*\w/.test(l.trim()));
    const hasTablePipes = lines.some(l => {
      const s = l.trim();
      if (!s.includes('|')) return false;
      return s.replace(/\|/g, '').replace(/[^a-zA-Z0-9]/g, '').length >= 3;
    });
    if (hasStat || hasTablePipes) {
      const mixed = formatMixed(lines);
      // Suppress <!-- MIXED --> if the only surviving content is a
      // decorative label (e.g. **DUNGEON #1**) — the tag would be noise
      const isDecorativeOnly = /^\*\*[A-Z]/.test(mixed.trim()) && !/\|/.test(mixed) && !mixed.includes('<!--');
      return (isDecorativeOnly ? '' : '<!-- MIXED -->\n\n') + mixed;
    }
    return formatAscii(lines);
  }

  // Phase 3: Equipment blocks — detect before decorative text
  if (hasEquipSlotLines(lines)) {
    const mixed = formatMixed(lines);
    if (mixed && !mixed.startsWith('<!-- MIXED -->')) {
      return formatEquipmentTable(lines);
    }
    return mixed;
  }

  // Phase 3.5: Shop/price listings
  if (isShopBlock(lines)) return formatShopList(lines);

  // Phase 4: Strip simple decorative elements to plain text
  const dec = formatDecorativeText(lines);
  if (dec !== null) return dec;

  // Phase 5: Pure-type formatting
  if (isTableBlock(lines)) return formatTable(lines);
  if (isStatBlock(lines)) return formatStatBlock(lines);
  return formatProse(lines);
}

function postProcess(md) {
  // Collapse 3+ consecutive blank lines to exactly 1
  md = md.replace(/\n{3,}/g, '\n\n');
  // Ensure labels like **DUNGEON #N** have consistent spacing
  md = md.replace(/\n{3,}\*\*DUNGEON #\d/g, '\n\n**DUNGEON #');
  md = md.replace(/\n{3,}\*\*Boss:/g, '\n\n**Boss:');
  // Strip trailing whitespace from every line
  md = md.replace(/ +$/gm, '');
  return md;
}

function reformat(content) {
  if (!content || !content.trim()) return '';
  // Pre-process walkthrough-specific markup
  content = content.replace(/^¤\s+/gm, '');           // strip ¤ bullets
  content = content.replace(/^MAIN GOALS$/gm, '**MAIN GOALS**');
  content = content.replace(/^«\s*Remember\s*->\s*/gim, '> **Remember:** ');
  content = content.replace(/^ITEMS\s*->\s*/gm, '**Items:** ');

  const blocks = content.split(/\n{2,}/);
  const result = [];
  for (const block of blocks) {
    const lines = block.split('\n').filter(l => l.trim().length > 0);
    if (lines.length === 0) continue;
    const formatted = reformatBlock(lines);
    if (formatted) result.push(formatted);
  }
  let md = result.join('\n\n').trim();
  md = postProcess(md);
  return md;
}

module.exports = {
  reformat,
  reformatBlock,
  formatMixed,
  formatTable,
  formatAscii,
  formatProse,
  formatStatBlock,
  formatDecorativeText,
  formatEquipmentTable,
  formatBossCard,
  formatCharacterSheet,
  formatCharacterPortrait,
  formatRomanSubHeader,
  formatHashSubHeader,
  isHashSubHeader,
  classifyArtBlock
};