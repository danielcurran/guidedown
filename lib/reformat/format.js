// Formatters for reformatting GameFAQs plain-text walkthroughs.

const { isDecorativeLine, isPureBorderRow } = require('./detect');
const { stripFrameChars, stripPipeAndDash } = require('./utils');

function formatProse(lines) {
  let text = lines.join(' ').replace(/ +/g, ' ').trim();
  if (!text) return '';
  text = text.replace(/«\s*Remember\s*->\s*/g, '> **Remember:** ');
  return text + '\n\n';
}

function formatTable(lines) {
  const dataRows = [];
  for (const line of lines) {
    const s = line.trim();
    if (!s) continue;
    // Skip rows that are purely decorative between pipes
    const betweenPipes = s.split('|').slice(1, -1);
    if (betweenPipes.length === 0) continue;
    if (betweenPipes.every(c => /^[\*\-_=¯\s]+$/.test(c.trim()))) continue;
    // Skip pure border rows that separate table sections
    if (isPureBorderRow(s)) continue;
    dataRows.push(s);
  }
  if (dataRows.length === 0) return '';

  // Determine column count from the row with most pipe separators
  const colCounts = dataRows.map(r => r.split('|').length - 1);
  const maxCols = Math.max(...colCounts);
  if (maxCols < 2) return '';

  // Extract cells
  const rows = dataRows.map(row => {
    const cells = row.split('|');
    // Skip leading/trailing empty cell from leading/trailing pipe
    const firstCell = cells[0].trim().length > 0 ? 0 : 1;
    const slice = cells.slice(firstCell);
    // Pad to maxCols
    while (slice.length < maxCols) slice.push('');
    return slice.slice(0, maxCols).map(c => stripFrameChars(c.trim()));
  });

  if (rows.length === 0) return '';

  // Detect header row: first row with word content that isn't all data rows
  const headerIdx = 0;

  // Build markdown table
  let md = '';
  for (let i = 0; i < rows.length; i++) {
    md += '| ' + rows[i].join(' | ') + ' |\n';
    if (i === headerIdx) {
      md += '| ' + rows[i].map(() => '---').join(' | ') + ' |\n';
    }
  }
  return md + '\n';
}

function formatEquipmentTable(lines) {
  // Format equipment block as either a markdown table or bullet list
  const dataRows = [];
  for (const line of lines) {
    const s = line.trim();
    if (!s || isPureBorderRow(s)) continue;
    dataRows.push(s);
  }
  if (dataRows.length <= 2) return formatTable(lines);

  // Extract characters from header row
  const headerRow = dataRows.find(r => /^(Starting|Recommended)\s+\|/.test(r.trim()));
  let charNames = [];
  if (headerRow) {
    const cells = headerRow.split('|').slice(1).map(c => c.trim()).filter(c => c);
    charNames = cells;
  }

  // Extract slot rows
  const slotRows = [];
  for (const row of dataRows) {
    const s = row.trim();
    const m = s.match(/^\s*\|?(Head|Right|Left|Body)\s*\|(.*)$/);
    if (m) {
      slotRows.push({ slot: m[1], rest: m[2] });
    }
  }

  if (slotRows.length === 0) return formatTable(lines);

  // If multiple characters with consistent columns, render a table
  if (charNames.length >= 1) {
    // Parse equipment items per character, preserving empty cells for alignment
    const parsed = slotRows.map(r => {
      const cells = r.rest.split('|');
      const end = cells[cells.length - 1] === '' ? cells.length - 1 : cells.length;
      const items = cells.slice(0, end).map(c => stripFrameChars(c.trim()));
      return { slot: r.slot, items };
    });

    const maxItems = Math.max(...parsed.map(r => r.items.length), 1);
    const allSameCols = parsed.every(r => r.items.length === maxItems || r.items.length === maxItems - 1);
    const cols = Math.min(maxItems, charNames.length);

    if (allSameCols && cols >= 1) {
      let md = '';
      if (charNames.length === 1) {
        // Single character: render as definition list
        md += '**Equipment**\n\n';
        for (const r of parsed) {
          md += '- **' + r.slot + ':** ' + (r.items[0] || '') + '\n';
        }
        return md + '\n';
      } else {
        // Multi-character: render as table
        md += '| Slot | ' + charNames.slice(0, cols).join(' | ') + ' |\n';
        md += '| --- | ' + charNames.slice(0, cols).map(() => '---').join(' | ') + ' |\n';
        for (const r of parsed) {
          const cells = r.items.slice(0, cols);
          while (cells.length < cols) cells.push('');
          md += '| ' + r.slot + ' | ' + cells.join(' | ') + ' |\n';
        }
        return md + '\n';
      }
    }
  }

  // Fallback: render as simple markdown table using formatTable with cleanup
  return formatTable(lines);
}

function formatBossCard(lines) {
  // Strip decorative frame and render boss stats as plain text.
  const text = lines.join('\n');

  const numMatch = text.match(/BOSS\s*#?\s*(\d+)/i);
  const number = numMatch ? numMatch[1] : '';

  // Boss name: line immediately after BOSS #N, or a line with just the name
  let name = '';
  const nameLine = lines.find(l => /^\|?\s*[A-Z][a-z]+\s*\|/.test(l.trim()) && !/BOSS/i.test(l.trim()));
  if (nameLine) {
    const m = nameLine.trim().match(/^\|?\s*([A-Z][A-Za-z\s]+?)\s*\|/);
    if (m) name = m[1].trim();
  }

  const stats = {};
  const statKeys = ['HP', 'EXP', 'MST'];
  for (const key of statKeys) {
    const re = new RegExp('\\b' + key + '\\s*:\\s*([^\\s|]+)', 'i');
    const m = text.match(re);
    if (m) stats[key] = m[1].trim();
  }

  const attrs = {};
  for (const key of ['Weak', 'Res', 'Imm']) {
    const re = new RegExp('\\b' + key + '\\s*:\\s*([^\\s|]+)', 'i');
    const m = text.match(re);
    if (m) attrs[key] = m[1].trim();
  }

  const levels = [];
  const levelRe = /\b([A-Z][a-zA-Z]{1,9})\s*:\s*([\d\-]+)\b/g;
  let m;
  while ((m = levelRe.exec(text)) !== null) {
    const name = m[1].trim();
    if (!/^(HP|EXP|MST|TP|MP|GP|Gold|Gil|Level|LV|ATK|DEF|STR|INT|AGI|DEX|SPD|Weak|Res|Imm|Boss|Item|Drop|Steal|Skill|Tech|Magic|Spell)$/i.test(name)) {
      levels.push(name + ' (' + m[2].trim() + ')');
    }
  }

  let md = '**BOSS';
  if (number) md += ' #' + number;
  md += name ? ' — ' + name : '';
  md += '**\n\n';

  const statParts = [];
  for (const key of statKeys) {
    if (stats[key] !== undefined) statParts.push('**' + key + ':** ' + stats[key]);
  }
  if (statParts.length) md += statParts.join(' · ') + '\n\n';

  const attrParts = [];
  for (const key of ['Weak', 'Res', 'Imm']) {
    if (attrs[key] !== undefined) attrParts.push('**' + key + ':** ' + attrs[key]);
  }
  if (attrParts.length) md += attrParts.join(' · ') + '\n\n';

  if (levels.length) {
    md += '**Recommended:** ' + levels.join(', ') + '\n\n';
  }

  return md;
}

function formatShopList(lines) {
  // Render shop/price tables as plain-text bullet lists grouped by store.
  const dataRows = [];
  for (const line of lines) {
    const s = line.trim();
    if (!s || isPureBorderRow(s)) continue;
    dataRows.push(s);
  }

  let location = '';
  const stores = {};
  let currentStore = null;

  function parseItem(cell) {
    const m = cell.match(/^(.+?)\s+(\d+\s*MST)$/);
    return m ? { item: m[1].trim(), price: m[2].trim() } : { item: cell.trim(), price: '' };
  }

  for (const row of dataRows) {
    // Extract cells, stripping only leading/trailing empty cells from pipes
    let cells = row.split('|').map(c => stripFrameChars(c.trim()));
    while (cells.length && cells[0] === '') cells.shift();
    while (cells.length && cells[cells.length - 1] === '') cells.pop();

    // Find the store-name cell by keyword; everything to its right is item info
    let storeIdx = -1;
    for (let i = 0; i < cells.length; i++) {
      if (/\b(Inn|Store|Shop|Guild)/i.test(cells[i]) && !/\d+\s*MST/i.test(cells[i])) {
        storeIdx = i;
        break;
      }
    }

    if (storeIdx >= 0) {
      currentStore = cells[storeIdx].replace(/\s+#\d$/, '').trim();
      if (!stores[currentStore]) stores[currentStore] = [];

      // Cells left of the store name are location (only on first row)
      if (storeIdx === 1 && !location && cells[0] && !/\d+\s*MST/i.test(cells[0])) {
        location = cells[0].trim();
      }

      // Item is the next non-empty cell to the right
      let itemCell = '';
      let bonusCell = '';
      for (let i = storeIdx + 1; i < cells.length; i++) {
        if (!itemCell && cells[i]) itemCell = cells[i];
        else if (itemCell && cells[i]) { bonusCell = cells[i]; break; }
      }
      const parsed = parseItem(itemCell);
      if (parsed.item) {
        stores[currentStore].push({ item: parsed.item, price: parsed.price, bonus: bonusCell });
      }
    } else if (currentStore) {
      // Row with no store keyword: belongs to currentStore
      const itemCell = cells.find(c => c && /\d+\s*MST/i.test(c)) || cells[0] || '';
      const bonusCell = cells.find(c => c && c !== itemCell && !/\d+\s*MST/i.test(c)) || '';
      const parsed = parseItem(itemCell);
      if (parsed.item) {
        stores[currentStore].push({ item: parsed.item, price: parsed.price, bonus: bonusCell });
      }
    }
  }

  let md = '';
  if (location) md += '**' + location + ' Shops**\n\n';

  for (const [store, items] of Object.entries(stores)) {
    if (items.length === 0) continue;
    md += '- **' + store + '**\n';
    for (const it of items) {
      let line = '  - ' + it.item;
      if (it.price) line += ' — ' + it.price;
      if (it.bonus) line += ' (' + it.bonus + ')';
      md += line + '\n';
    }
  }

  return md + '\n';
}

function formatCharacterSheet(lines) {
  // Strip the ASCII frame and extract key character info as plain text.
  const text = lines.join('\n');

  const get = (re, group = 1) => {
    const m = text.match(re);
    return m ? m[group].trim() : '';
  };

  const joinParty = get(/Joins\s*Party:\s*(.+?)(?=\||\n|$)/i);
  const startLevel = get(/Starting\s*Level:\s*(\d+)/i);
  const techniques = get(/Initial\s*Techniques:\s*(.+?)(?=\||\n|$)/i);
  const skills = get(/Initial\s*Skills:\s*(.+?)(?=\||\n|$)/i);

  const stats = {};
  for (const key of ['HP', 'TP', 'MP', 'Str', 'Men', 'Agl', 'Dex', 'Int', 'Vit', 'Luk', 'Spd', 'Def', 'Atk', 'Mag']) {
    const re = new RegExp(key + '\\s*[-:]?\\s*(\\d+)', 'i');
    const val = get(re);
    if (val) stats[key] = val;
  }

  const equip = {};
  for (const key of ['Head', 'Right', 'Left', 'Body', 'Weapon', 'Shield', 'Armor', 'Accessory', 'Helm', 'Armor', 'Boots', 'Ring', 'Amulet']) {
    const re = new RegExp('\\b' + key + '\\s+([A-Z][A-Za-z0-9\\-\\s]+?)\\s*(?:\\||$)', 'i');
    const val = get(re);
    if (val) equip[key] = val;
  }

  let md = '';

  if (joinParty) md += '**Joins Party:** ' + joinParty + ' · ';
  if (startLevel) md += '**Starting Level:** ' + startLevel;
  if (md) md += '\n\n';

  if (Object.keys(stats).length) {
    md += '**Initial Stats:** ' + Object.entries(stats).map(([k, v]) => k + ' ' + v).join(', ') + '\n\n';
  }

  if (Object.keys(equip).length) {
    md += '**Initial Equipment:** ' + Object.entries(equip).map(([k, v]) => k + ': ' + v).join(', ') + '\n\n';
  }

  if (techniques) md += '**Initial Techniques:** ' + techniques + '\n\n';
  if (skills) md += '**Initial Skills:** ' + skills + '\n\n';

  return md;
}

function formatCharacterPortrait(lines) {
  // ASCII art portrait: extract profile labels from the right side of lines.
  const textLines = lines.map(l => l.trim()).filter(Boolean);

  let name = '';
  let race = '';
  let cls = '';
  let age = '';
  let sex = '';
  let lives = '';

  for (let i = 0; i < textLines.length; i++) {
    const line = textLines[i];

    // Name: line ending with two capitalized words (First Last)
    if (!name) {
      const m = line.match(/([A-Z][a-zA-Z]+\s+[A-Z][a-zA-Z]+)\s*$/);
      if (m) name = m[1].trim();
    }

    // Class: line ending with (Class)
    const classMatch = line.match(/\(([A-Za-z\s]+)\)\s*$/);
    if (classMatch) {
      cls = classMatch[1].trim();
      // Race is usually the previous line's last word
      if (i > 0) {
        const prev = textLines[i - 1].trim();
        const raceMatch = prev.match(/([A-Z][a-zA-Z]+)\s*$/);
        if (raceMatch && raceMatch[1] !== name.split(' ').pop()) {
          race = raceMatch[1];
        }
      }
    }

    // Age, Sex, Lives
    const ageMatch = line.match(/Age\s*:\s*(\d+)/i);
    if (ageMatch) age = ageMatch[1].trim();
    const sexMatch = line.match(/Sex\s*:\s*(\w+)/i);
    if (sexMatch) sex = sexMatch[1].trim();
    const livesMatch = line.match(/Lives\s*:\s*(\w+)/i);
    if (livesMatch) {
      lives = livesMatch[1].trim();
    } else if (/Lives\s*:\s*$/i.test(line) && i + 1 < textLines.length) {
      // Value may be on the next line
      const next = textLines[i + 1].trim();
      const nextMatch = next.match(/([A-Z][a-zA-Z]+)\s*$/);
      if (nextMatch) lives = nextMatch[1].trim();
    }
  }

  let parts = [];
  if (race && cls) parts.push(race + ' (' + cls + ')');
  else if (race) parts.push(race);
  if (age) parts.push('Age: ' + age);
  if (sex) parts.push('Sex: ' + sex);
  if (lives) parts.push('Lives: ' + lives);

  if (parts.length === 0) return '';

  let md = '';
  if (name) md += '**' + name + '** — ';
  md += parts.join(' · ') + '\n\n';
  return md;
}

function formatAscii(lines) {
  const text = lines.map(l => l.trimEnd()).join('\n').trim();
  if (!text) return '';
  // Skip single-line decorative fragments that look like map headers
  if (lines.length === 1) {
    const s = lines[0].trim();
    const words = (s.match(/[a-zA-Z]{2,}/g) || []).length;
    if (words < 2) return ''; // Single decorative line, strip it
  }
  return '```\n' + text + '\n```\n\n';
}

function formatStatBlock(lines) {
  const kvLines = [];
  const otherLines = [];

  for (const line of lines) {
    const s = line.trim();
    if (!s) continue;

    // Extract all Key: Value pairs on the line, handling multi-column layouts
    // like: "HP: 300                          Alys: 7"
    const pairs = [];
    let remaining = s;
    while (remaining.trim()) {
      const pairRe = /([A-Za-z][A-Za-z\s]+?)\s*:\s*([^]*?)(?=\s{2,}[A-Za-z][A-Za-z\s]*:|$)/i;
      const m = pairRe.exec(remaining);
      if (!m) break;
      const key = m[1].trim();
      const value = m[2].trim();
      if (key && value) {
        pairs.push('**' + key + ':** ' + value);
      }
      remaining = remaining.slice(m.index + m[0].length).trimStart();
    }

    if (pairs.length > 0) {
      kvLines.push(pairs.join(' · '));
    } else {
      otherLines.push(s);
    }
  }

  let out = '';
  if (kvLines.length > 0) {
    const multiColumn = kvLines.some(line => line.includes(' · '));
    if (multiColumn) {
      out += kvLines.join('\n\n') + '\n\n';
    } else {
      out += kvLines.join(' · ') + '\n\n';
    }
  }
  if (otherLines.length > 0) out += otherLines.join(' ').replace(/ +/g, ' ').trim() + '\n\n';
  return out;
}

function formatDecorativeText(lines) {
  // Don't run on blocks that contain equipment/table data
  const hasEquipment = lines.some(l => /^\|?\s*(Head|Right|Left|Body)\s*\|/.test(l.trim()));
  const hasTableData = lines.filter(l => l.includes('|')).length >= 2;
  if (hasEquipment || hasTableData) return null;

  const cleaned = [];
  let anyChanged = false;
  for (const line of lines) {
    const orig = line.trim();
    if (!orig || /^[\/\\¯_|\-=\s]+$/.test(orig)) continue;
    if (/^[\*\-_=¯]{8,}$/.test(orig)) continue;
    let s = orig;
    s = s.replace(/^\/\/\s*/, '')
         .replace(/^\|?\s*\/\s*/, '')
         .replace(/^[\/\\]+\s*/, '')
         .replace(/[\/\\¯_|=\-]{2,}/g, ' ');
    if (s !== orig) {
      s = s.replace(/\s+/g, ' ').trim();
      if (s) {
        cleaned.push('**' + s + '**');
        anyChanged = true;
      }
    } else if (orig) {
      cleaned.push(orig);
    }
  }
  if (!anyChanged) return null;
  return cleaned.join('\n\n') + '\n\n';
}

function formatRomanSubHeader(lines) {
  // Format +----+ box sub-headers (roman-format) as bold labels.
  const inner = lines.slice(1, -1);
  const cleaned = [];
  for (const line of inner) {
    const s = stripPipeAndDash(line.trim());
    if (s) cleaned.push(s);
  }
  if (cleaned.length === 0) return '';
  const parts = cleaned.map(c => {
    if (/^\(.+\)$/.test(c)) return '*' + c + '*';
    return '**' + c + '**';
  });
  return parts.join('\n\n') + '\n\n';
}

function formatHashSubHeader(lines) {
  // Render ± Title ± subsection header as a bold label,
  // stripping the ¤¤¤/««« and °°° decorative border lines.
  const inner = lines.slice(1, -1);
  const titles = inner
    .map(l => l.trim().replace(/^±\s*|\s*±$/g, '').trim())
    .filter(Boolean);
  if (titles.length === 0) return '';
  return '**' + titles.join(' — ') + '**\n\n';
}

module.exports = {
  formatProse, formatTable, formatAscii,
  formatStatBlock, formatDecorativeText, formatEquipmentTable,
  formatBossCard, formatShopList, formatCharacterSheet, formatCharacterPortrait,
  formatRomanSubHeader, formatHashSubHeader
};
