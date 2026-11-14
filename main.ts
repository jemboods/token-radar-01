// Token Radar: read the sealed snapshot, rank every protocol it records no
// token for by an implied token value derived from the protocols that do
// trade, and lay the result out as a board, a dashboard and a dossier.
//
//   node main.ts --input <snapshot.json | directory holding one>
//
// Inputs resolve exactly as the harness resolves them (see input/README.md
// in the kit): an explicit file; else the MAKEFUN_INPUT_DIR environment
// variable, or /input in the sandbox; else input/ beside this file. The
// output directory is MAKEFUN_OUTPUT_DIR, or /output in the sandbox, or a
// local out/ run by hand. The dashboard and screenshots are copied from the
// repository that holds this file, so the program runs from a copy anywhere.
//
// Standard library only, no network. The dossier is written last and
// everything before it is a pure function of the snapshot, so two runs over
// the same snapshot write byte-identical outputs.

import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildBoard, buildLive, computeMultiples, type Snapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

function argValue(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1]! : null;
}

function resolveInput(): string {
  const given = argValue('--input');
  if (given) {
    if (existsSync(given) && statSync(given).isDirectory()) {
      for (const name of ['snapshot.json', 'input/snapshot.json']) {
        const p = join(given, name);
        if (existsSync(p)) return p;
      }
      throw new Error(`no snapshot.json under ${given}`);
    }
    return given;
  }
  const root = process.env.MAKEFUN_INPUT_DIR ?? (existsSync('/input') ? '/input' : join(here, 'input'));
  for (const name of ['snapshot.json', 'input/snapshot.json']) {
    const p = join(root, name);
    if (existsSync(p)) return p;
  }
  throw new Error(`no snapshot.json under ${root}`);
}

function copyDir(from: string, to: string): void {
  if (!existsSync(from)) return;
  mkdirSync(to, { recursive: true });
  for (const name of readdirSync(from).sort()) {
    const src = join(from, name);
    const dst = join(to, name);
    if (statSync(src).isDirectory()) copyDir(src, dst);
    else copyFileSync(src, dst);
  }
}

// The screenshots ship as base64 text (<name>.png.b64) so the whole entry
// stays plain text; decode them back to the exact PNG bytes on the way out.
function unpackScreenshots(from: string, to: string): void {
  if (!existsSync(from)) return;
  mkdirSync(to, { recursive: true });
  for (const name of readdirSync(from).sort()) {
    if (!name.endsWith('.png.b64')) continue;
    const packed = readFileSync(join(from, name), 'utf8');
    writeFileSync(join(to, name.slice(0, -4)), Buffer.from(packed, 'base64'));
  }
}

const here = dirname(fileURLToPath(import.meta.url));
const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? (existsSync('/output') ? '/output' : join(here, 'out'));

const snapshot = JSON.parse(readFileSync(resolveInput(), 'utf8')) as Snapshot;
const multiples = computeMultiples(snapshot);
const rows = buildBoard(snapshot, multiples);
const live = buildLive(snapshot);

mkdirSync(outDir, { recursive: true });

const board = {
  as_of: snapshot.as_of,
  source: snapshot.source,
  floor_usd: snapshot.floor_usd,
  watchlist: snapshot.watchlist,
  rows,
};
writeFileSync(join(outDir, 'board.json'), `${JSON.stringify(board)}\n`);

const categoryMultiples = [...multiples.byCategory.values()].sort(
  (a, b) => b.comps - a.comps || (a.category < b.category ? -1 : 1),
);
const radar = {
  as_of: snapshot.as_of,
  source: snapshot.source,
  floor_usd: snapshot.floor_usd,
  stats: {
    scanned: snapshot.protocols.length,
    ranked: rows.length,
    watchlist: snapshot.watchlist.length,
    watchlist_covered: rows.filter((r) => r.watchlist).length,
    live_tokens: live.length,
    comps_used: multiples.compsUsed,
    total_implied_usd: rows.reduce((s, r) => s + r.implied_value_usd, 0),
    global_median_multiple: multiples.globalMedian,
  },
  model: {
    global_median: multiples.globalMedian,
    comps_used: multiples.compsUsed,
    category_multiples: categoryMultiples,
  },
  rows,
  live,
};
writeFileSync(join(outDir, 'data.js'), `window.RADAR = ${JSON.stringify(radar)};\n`);

copyDir(join(here, 'dashboard'), join(outDir, 'dashboard'));
unpackScreenshots(join(here, 'screenshots'), join(outDir, 'screenshots'));

// The dossier goes last: it digests the dashboard and the screenshots into
// the one file the judge reads, so it is built over the finished output.
writeFileSync(
  join(outDir, 'dossier.json'),
  buildDossier(outDir, {
    text_max_bytes: 65536,
    screenshots: { max: 4, max_bytes: 524288 },
    dashboard: { max_files: 400, max_bytes: 4194304 },
  }),
);

console.log(
  `token-radar: ${rows.length} pre-token protocols ranked, ${radar.stats.watchlist_covered}/${snapshot.watchlist.length} watchlist covered, ` +
    `${live.length} live tokens set aside, global median multiple ${multiples.globalMedian}x`,
);
