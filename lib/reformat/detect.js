// Detection helpers for reformatting GameFAQs plain-text walkthroughs.

/**
 * Check if a line is purely decorative (repeating chars like --- or ====).
 * @param {string} line
 * @returns {boolean}
 */
function isDecorativeLine(line) {
  return /^[\*\-_=¯+]{8,}$/.test(line.trim());
}

/**
 * Detect if a block of lines is ASCII art based on special character density.
 * @param {string[]} lines
 * @returns {boolean}
 */
function isAsciiArtBlock(lines) {
  let artLines = 0;
  for (const line of lines) {
    const s = line.trim();
    if (!s) continue;
    if ((s.match(/\|/g) || []).length >= 5) { artLines++; continue; }
    // Decorative section markers (// DUNGEON, // CHAPTER, etc)
    if (/^\/\/\s+[A-Z][A-Z\s\d#]+/.test(s) && /[\|\/\\¯_\-]/.test(s)) { artLines++; continue; }
    if (isDecorativeLine(line)) { artLines++; continue; }
    if ((s.match(/[\/\\\|]/g) || []).length >= 5) { artLines++; continue; }
    const letters = (s.match(/[a-zA-Z]/g) || []).length;
    const special = (s.match(/[^a-zA-Z0-9\s]/g) || []).length;
    if (special > letters * 2 && special > 3) artLines++;
  }
  return artLines >= 2;
}

function isTableBlock(lines) {
  const nonEmpty = lines.filter(l => l.trim());
  if (nonEmpty.length < 2) return false;
  const pipeLines = nonEmpty.filter(l => l.includes('|'));
  return pipeLines.length / nonEmpty.length >= 0.5;
}

function isStatBlock(lines) {
  const nonEmpty = lines.filter(l => l.trim());
  if (nonEmpty.length < 2) return false;
  const kvRe = /^\s*\w[\w\s]+\s*:\s*\w/;
  const kvLines = nonEmpty.filter(l => kvRe.test(l.trim()));
  return kvLines.length / nonEmpty.length >= 0.3;
}

function hasEquipSlotLines(lines) {
  // True if block contains equipment slot labels (Head, Right, Left, Body)
  // or character headers (Starting, Recommended) with pipes
  return lines.some(l => {
    const s = l.trim();
    return /^\|?\s*(Head|Right|Left|Body)\s*\|/.test(s) ||
      /^(Starting|Recommended)\s+\|/.test(s);
  });
}

function isBossCard(lines) {
  return lines.some(l => /BOSS\s*#?\s*\d/i.test(l.trim())) &&
         lines.some(l => /HP\s*:/i.test(l.trim()));
}

function isShopBlock(lines) {
  return lines.some(l => /\b(Inn|Store|Shop|Guild|Market|Merchant|Dealer|Cafe|Pub|Bar|Tavern|Healer|Priest|Church|Temple)\b/i.test(l.trim())) &&
         lines.some(l => /\d+\s*(MST|GP|Gold|Gil|G|Z|Coins?|Credits|Meseta|Gald|Bol|Yen|Dollars?|¥|¤)\b/i.test(l.trim()));
}

function isCharacterSheet(lines) {
  return lines.some(l => /(Initial|Starting|Base)\s*(Stats|Equipment|Skills|Techniques|Magic|Spells)/i.test(l.trim())) &&
         lines.some(l => /(Joins?\s*Party|Recruit|New\s+Member)/i.test(l.trim()));
}

function isCharacterPortrait(lines) {
  const text = lines.join('\n');
  const labelCount = [/Age\s*:\s*\d+/i, /Sex\s*:/i, /Lives\s*:/i, /Race\s*:/i, /Class\s*:/i, /Level\s*:\s*\d+/i].filter(re => re.test(text)).length;
  return labelCount >= 2;
}

function isRomanSubHeader(lines) {
  // Detects +----+ box sub-headers like:
  // +--------------------------------------------------------------+
  // |                        - Overworld -                         |
  // +--------------------------------------------------------------+
  if (lines.length < 3) return false;
  const top = lines[0].trim();
  const bot = lines[lines.length - 1].trim();
  // Top and bottom are + followed by dashes followed by +
  if (!/^\+-{10,}\+$/.test(top) || !/^\+-{10,}\+$/.test(bot)) return false;
  // Middle lines should have | pipes with short text inside
  const inner = lines.slice(1, -1);
  return inner.every(l => {
    const s = l.trim();
    return /^\|.*\|$/.test(s) && s.replace(/[|\-\s()]/g, '').length > 1;
  });
}

function isHashSubHeader(lines) {
  // Detect ± Title ± subsection headers with ¤¤¤/°°° or «««/°°° border frames.
  // These appear in Lufia II-style walkthroughs and should be rendered as
  // headings, not ASCII art code blocks.
  if (lines.length < 3) return false;
  const top = lines[0].trim();
  const bot = lines[lines.length - 1].trim();
  const inner = lines.slice(1, -1);
  // Top: 3+ of ¤ or «. Bottom: 3+ of °.
  if (!/^[¤«]{3,}$/.test(top) || !/^°{3,}$/.test(bot)) return false;
  // Inner should have at least one ± Title ± line
  return inner.some(l => /^± .+ ±$/.test(l.trim()));
}

function isPureBorderRow(s) {
  const betweenPipes = s.split('|').slice(1, -1);
  if (betweenPipes.length === 0) return false;
  const content = betweenPipes.map(c => c.trim()).join('');
  if (/^[+\-=\*_¯\s]*$/.test(content)) return true;
  return betweenPipes.every(c => {
    const t = c.trim();
    return !t || /^[+\-=\*_¯\s]+$/.test(t);
  });
}

module.exports = {
  isDecorativeLine, isAsciiArtBlock, isTableBlock, isStatBlock,
  hasEquipSlotLines, isBossCard, isShopBlock, isCharacterSheet,
  isCharacterPortrait, isRomanSubHeader, isHashSubHeader, isPureBorderRow
};
