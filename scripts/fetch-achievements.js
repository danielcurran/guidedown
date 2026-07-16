#!/usr/bin/env node
/**
 * fetch-achievements.js
 *
 * Fetches RetroAchievements data for a given game and outputs a JSON file
 * ready for the retroachievements agent skill to match sections to.
 *
 * Usage:
 *   node scripts/fetch-achievements.js --game=50 --output=guide/achievements-raw.json
 *   node scripts/fetch-achievements.js --game=50 --output=guide/achievements-raw.json --comments
 *
 * With --comments, also fetches player comments from the RA Comments API
 * (API_GetComments.php?t=2) and stores useful ones in communityTips[].
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const { parseArgs, showHelp } = require('../lib/cli');

const SCRIPT_NAME = 'faqmd-fetch-achievements';

function env(key) {
  // Read from .env file if present, fall back to process.env
  const envPath = path.join(__dirname, '..', '.env');
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf8').split('\n');
    for (const line of lines) {
      // Strip inline comments (anything after unquoted #)
      // and skip blank or comment-only lines
      const cleaned = line.replace(/#.*$/, '').trim();
      if (!cleaned) continue;
      // Handle quoted values: KEY="value with spaces"
      const match = cleaned.match(/^([A-Z_]+)\s*=\s*(.+)/);
      if (!match || match[1] !== key) continue;
      let value = match[2].trim();
      // Strip surrounding double or single quotes
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      return value;
    }
  }
  return process.env[key] || '';
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error('HTTP ' + res.statusCode + ' (expected 200) for ' + url));
        return;
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('Failed to parse JSON from ' + url + ': ' + e.message)); }
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(30000, () => {
      req.destroy();
      reject(new Error('Request timed out after 30s: ' + url));
    });
  });
}

function mapType(raType, description) {
  if (raType === 'missable') return 'missable';
  if (raType === 'progression') return 'story';
  if (raType === 'win_condition') return 'story';
  if (/(?:\bmiss|\bcollect|\bchallenge|\bsecret|\bspeed\b)/i.test(description)) {
    if (/\bcollect\b/i.test(description)) return 'collectible';
    if (/\bchallenge\b|\blimit\b/i.test(description)) return 'challenge';
    if (/\bsecret\b|\bhidden\b/i.test(description)) return 'secret';
  }
  return 'progress';
}

function detectMissable(type, description) {
  if (type === 'missable') return true;
  return /\(Missed upon|\(Missable\)/i.test(description);
}

function extractCutoff(description) {
  const match = description.match(/\(Missed upon\s+(.+?)\)/i);
  return match ? match[1] : '';
}

async function fetchComments(raUser, raKey, achievementId) {
  const url = 'https://retroachievements.org/API/API_GetComments.php' +
    '?z=' + encodeURIComponent(raUser) +
    '&y=' + encodeURIComponent(raKey) +
    '&i=' + achievementId +
    '&t=2&c=50';
  try {
    const data = await fetchJson(url);
    if (!data || !data.Results) return [];
    return data.Results
      .filter(r => r.User !== 'Server')
      .map(r => ({ user: r.User, text: r.CommentText }))
      .slice(0, 3);
  } catch {
    return [];
  }
}

function badgeUrl(badgeName) {
  return 'https://retroachievements.org/Badge/' + badgeName + '.png';
}

function main() {
  const cli = parseArgs(process.argv.slice(2), {
    flags: {
      game:  { desc: 'RetroAchievements game ID (required)', value: 'ID' },
      output: { desc: 'Output JSON file path (default: stdout)', value: 'FILE' },
      comments: { desc: 'Fetch RA Comments API for each achievement', value: '' }
    }
  });

  if (cli.help) {
    showHelp(SCRIPT_NAME, 'Fetch RetroAchievements data for a game ID. Outputs JSON ready for the retroachievements agent skill to fill in section/confidence/notes.', {
      flags: {
        game:     { desc: 'RetroAchievements game ID (required)', value: 'ID' },
        output:   { desc: 'Output JSON file path (default: guide/achievements-raw.json)', value: 'FILE' },
        comments: { desc: 'Also fetch RA Comments API for each achievement' }
      },
      examples: [
        'faqmd-fetch-achievements --game=50',
        'faqmd-fetch-achievements --game=50 --output=guide/raw.json --comments'
      ]
    });
    return;
  }

  const gameId = cli.flags.game;
  if (!gameId) throw new Error('--game=<ID> is required');

  const raUser = env('RA_USER');
  const raKey = env('RA_KEY');
  if (!raUser || !raKey) throw new Error('RA_USER and RA_KEY must be set in .env or environment');

  const outputPath = cli.flags.output || path.join('guide', 'achievements-raw.json');
  const fetchCommentsFlag = cli.flags.comments === true;

  (async () => {
    console.error('Fetching achievements for game ' + gameId + '...');

    const url = 'https://retroachievements.org/API/API_GetGameInfoAndUserProgress.php' +
      '?z=' + encodeURIComponent(raUser) +
      '&y=' + encodeURIComponent(raKey) +
      '&g=' + gameId +
      '&u=' + raUser;

    const gameData = await fetchJson(url);

    if (!gameData || !gameData.Achievements) {
      throw new Error('No achievement data returned for game ' + gameId);
    }

    const achievements = [];
    let totalPoints = 0;
    const rawAchievements = gameData.Achievements;

    for (const id of Object.keys(rawAchievements)) {
      const a = rawAchievements[id];
      const raType = a.Type || '';
      const description = a.Description || '';
      const type = mapType(raType, description);
      const missable = detectMissable(raType, description);
      const cutoff = missable ? extractCutoff(description) : '';

      const entry = {
        id: parseInt(id, 10),
        title: a.Title,
        description: description,
        points: a.Points,
        badgeUrl: badgeUrl(a.BadgeName),
        displayOrder: a.DisplayOrder,
        type: type,
        missable: missable,
        missableCutoff: cutoff,
        missableCutoffSection: '',
        section: '',
        confidence: '',
        notes: '',
        communityTips: []
      };

      totalPoints += a.Points;
      achievements.push(entry);
    }

    // Sort by displayOrder
    achievements.sort((a, b) => a.displayOrder - b.displayOrder);

    // Fetch comments if requested
    if (fetchCommentsFlag) {
      console.error('Fetching comments for ' + achievements.length + ' achievements...');
      let done = 0;
      for (const ach of achievements) {
        const tips = await fetchComments(raUser, raKey, ach.id);
        if (tips.length > 0) {
          ach.communityTips = tips;
        }
        done++;
        if (done % 10 === 0) console.error('  ' + done + '/' + achievements.length + '...');
      }
      console.error('  ' + done + '/' + achievements.length + ' done.');
    }

    const output = {
      schemaVersion: 1,
      gameId: parseInt(gameId, 10),
      gameTitle: gameData.Title || '',
      source: 'https://retroachievements.org/game/' + gameId,
      totalAchievements: achievements.length,
      totalPoints: totalPoints,
      achievements: achievements
    };

    const json = JSON.stringify(output, null, 2);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, json);

    console.error('Wrote ' + achievements.length + ' achievements to ' + outputPath);
    console.error('Next: run the retroachievements agent skill to match sections.');
  })().catch(err => {
    console.error('Error: ' + err.message);
    process.exit(1);
  });
}

main();
