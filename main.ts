// Token launch radar (token-radar-01) — program entrypoint, Node 22 stdlib.
//
// Reads the sealed DefiLlama snapshot, builds the ranked pre-token board
// with lib/model.ts, writes /output/board.json and /output/data.js, copies
// dashboard/ into /output, unpacks the screenshots (they ship as base64
// text, one .png.b64 per image, so the repository is plain text end to end)
// and writes /output/dossier.json last with the vendored make.fun library.
//
// Input resolution: --input <file|dir>, else $MAKEFUN_INPUT_DIR, else
// /input, else ./input beside this file. Output: --output <dir>, else
// $MAKEFUN_OUTPUT_DIR, else /output.

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const DASHBOARD_CAPS = { max_files: 400, max_bytes: 4_194_304 };
const PLAIN_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

function fail(message: string): never {
  process.stderr.write(`token radar: ${message}\n`);
  process.exit(1);
}

/** --name <value> or --name=<value> from the arguments, else the fallback. */
function argValue(name: string, fallback: string): string {
  const args = process.argv.slice(2);
  const at = args.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < args.length) return args[at + 1]!;
  const glued = args.find((a) => a.startsWith(`--${name}=`));
  return glued === undefined ? fallback : glued.slice(name.length + 3);
}

function resolveInputFile(): string {
  const candidates: string[] = [];
  const given = argValue('input', '');
  if (given !== '') candidates.push(given);
  if (process.env.MAKEFUN_INPUT_DIR) candidates.push(process.env.MAKEFUN_INPUT_DIR);
  candidates.push('/input', join(here, 'input'));
  for (const candidate of candidates) {
    const file = candidate.endsWith('.json') ? candidate : join(candidate, 'snapshot.json');
    if (existsSync(file)) return file;
  }
  return fail('no snapshot found: pass --input <snapshot.json|directory> or mount the sealed /input');
}

function copyDir(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from).sort()) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}

/**
 * The screenshots ship as base64 text (<name>.png.b64) so the whole entry
 * is plain text; decode each one back to the PNG the dossier expects.
 */
function unpackScreenshots(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const written: string[] = [];
  for (const name of readdirSync(from).sort()) {
    if (!name.endsWith('.png.b64')) continue;
    const pngName = name.slice(0, -'.b64'.length);
    const packed = readFileSync(join(from, name), 'utf8');
    writeFileSync(join(to, pngName), Buffer.from(packed.trim(), 'base64'));
    written.push(pngName);
  }
  return written;
}

const inputFile = resolveInputFile();
const outDir = argValue('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const { board, radar } = buildRadar(snapshot);
const issue = boardIssue(board, snapshot);
if (issue !== null) fail(`the model wrote a board the gate refuses: ${issue}`);

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(outDir, 'data.js'), dataScript(radar));

const dashboardFiles = copyDir(join(here, 'dashboard'), join(outDir, 'dashboard'));
if (!dashboardFiles.includes('index.html')) fail('dashboard/ holds no index.html');

const shots = unpackScreenshots(join(here, 'screenshots'), join(outDir, 'screenshots'));
if (shots.length < 3 || shots.length > 4) {
  fail(`screenshots/ unpacks to ${shots.length} images: hand in 3 or 4`);
}
for (const name of shots) {
  if (!PLAIN_NAME.test(name)) fail(`screenshots/${name}: not a plain file name`);
}

// The dossier goes last: the scorer rebuilds it from this output tree and
// compares bytes, so nothing may be written after it.
writeFileSync(
  join(outDir, 'dossier.json'),
  buildDossier(outDir, {
    text_max_bytes: TEXT_MAX_BYTES,
    screenshots: SCREENSHOT_CAPS,
    dashboard: DASHBOARD_CAPS,
  }),
);

process.stdout.write(
  `token radar: ${snapshot.protocols.length} protocols scanned, ${radar.stats.live} already trading, ` +
    `${board.length} pre-token ranked, watchlist ${radar.stats.watchlist}/${snapshot.watchlist.length} covered\n` +
    `token radar: wrote board.json, data.js, dashboard/ (${dashboardFiles.length} files), ` +
    `screenshots/ (${shots.length} images) and dossier.json to ${outDir}\n`,
);
