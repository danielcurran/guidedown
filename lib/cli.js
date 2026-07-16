// Minimal CLI helpers for faqmd scripts (zero dependencies).

const fs = require('fs');

function parseArgs(argv) {
  const flags = {};
  const positional = [];
  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') return { help: true, flags, positional };
    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=');
      if (eq > 0) {
        flags[arg.slice(2, eq)] = arg.slice(eq + 1);
      } else {
        flags[arg.slice(2)] = true;
      }
    } else {
      positional.push(arg);
    }
  }
  return { help: false, flags, positional };
}

function showHelp(scriptName, description, opts = {}) {
  console.log('Usage: ' + scriptName + (opts.usage ? ' ' + opts.usage : '') + '\n');
  console.log(description + '\n');
  console.log('Options:\n  -h, --help  Show this help message');
  for (const [name, info] of Object.entries(opts.flags || {}))
    console.log('  --' + name + (info.value ? '=' + info.value : '') + '  ' + (info.desc || ''));
  console.log('');
  if (opts.examples && opts.examples.length) {
    console.log('Examples:');
    for (const ex of opts.examples) console.log('  ' + ex);
    console.log('');
  }
}

/**
 * Validate that an input file exists and is readable.
 */
function validateInputFile(inputPath) {
  if (!inputPath) throw new Error('input file is required');
  if (!fs.existsSync(inputPath)) throw new Error('input file not found: ' + inputPath);
  const stat = fs.statSync(inputPath);
  if (!stat.isFile()) throw new Error('input path is not a file: ' + inputPath);
  if (stat.size === 0) throw new Error('input file is empty: ' + inputPath);
}

module.exports = { parseArgs, showHelp, validateInputFile };
