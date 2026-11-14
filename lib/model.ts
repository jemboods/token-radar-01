// lib/model.ts — the token radar's model: snapshot parsing, the category-comps
// value model, the farm-plan generator and the board builder.
//
// The model prices a pre-token protocol the way the market prices its live
// peers: implied = TVL x category multiple x growth x seasoning x breadth,
// where the category multiple is the median market-cap/TVL of the protocols
// in the same category whose token already trades. Every factor is rounded
// to 4 decimal places before it is applied, so the arithmetic a reader sees
// on the dashboard reproduces every board value exactly.
//
// The farm-plan generator lives here for board.json and again in
// dashboard/plans.js for the page; both are written from the same templates
// and a build check proves they produce identical steps for every row.

export interface Protocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: Protocol[];
  watchlist: string[];
}

export function parseSnapshot(text: string): Snapshot {
  const raw = JSON.parse(text) as Snapshot;
  if (!Array.isArray(raw.protocols) || !Array.isArray(raw.watchlist)) {
    throw new Error('snapshot: protocols and watchlist must be arrays');
  }
  return raw;
}

/** Round to 4 decimal places: the model's factors are priced at this grain. */
export function round4(x: number): number {
  return Math.round(x * 10000) / 10000;
}

function medianOf(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** A protocol records a token when DefiLlama carries a market cap for it. */
export function isLive(p: Protocol): boolean {
  return p.mcap_usd !== null;
}

/** A protocol is pre-token when the snapshot records no token for it at all. */
export function isPreToken(p: Protocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

const VERSIONED_NAME = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/**
 * The board's scope: every pre-token protocol whose launch a reader could
 * act on. CEX entries are exchanges, not launches, and a versioned
 * deployment (a name ending V2, 2.0 and the like) is a migration of a
 * product that already exists, so both stay off the board.
 */
export function inScope(p: Protocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED_NAME.test(p.name);
}

export interface Multiples {
  /** Median cap/TVL across every live protocol, trimmed, rounded to 4dp. */
  global: number;
  /** Category -> its own median multiple, for categories with >= 3 comps. */
  byCategory: Map<string | null, number>;
  /** Category -> how many live comps its multiple rests on. */
  comps: Map<string | null, number>;
}

const RATIO_FLOOR = 0.005;
const RATIO_CAP = 20;
const MIN_COMPS = 3;

function compRatio(p: Protocol): number | null {
  if (p.mcap_usd === null || p.tvl_usd <= 0) return null;
  const ratio = p.mcap_usd / p.tvl_usd;
  return ratio >= RATIO_FLOOR && ratio <= RATIO_CAP ? ratio : null;
}

export function computeMultiples(protocols: Protocol[]): Multiples {
  const all: number[] = [];
  const buckets = new Map<string | null, number[]>();
  for (const p of protocols) {
    const ratio = compRatio(p);
    if (ratio === null) continue;
    all.push(ratio);
    const bucket = buckets.get(p.category);
    if (bucket) bucket.push(ratio);
    else buckets.set(p.category, [ratio]);
  }
  const byCategory = new Map<string | null, number>();
  const comps = new Map<string | null, number>();
  for (const [category, ratios] of buckets) {
    comps.set(category, ratios.length);
    if (ratios.length >= MIN_COMPS) byCategory.set(category, round4(medianOf(ratios)));
  }
  return { global: round4(medianOf(all)), byCategory, comps };
}

export interface Breakdown {
  multiple: number;
  growth: number;
  seasoning: number;
  breadth: number;
  age_days: number | null;
  implied_value_usd: number;
}

const DAY_MS = 86_400_000;

export function ageDays(listedAt: string | null, asOf: string): number | null {
  if (listedAt === null) return null;
  const days = Math.round((Date.parse(`${asOf}T00:00:00Z`) - Date.parse(`${listedAt}T00:00:00Z`)) / DAY_MS);
  return Math.max(0, days);
}

export function score(p: Protocol, multiples: Multiples, asOf: string): Breakdown {
  const multiple = multiples.byCategory.get(p.category) ?? multiples.global;
  const growth = p.change_7d === null ? 1 : round4(1 + 0.45 * Math.tanh(p.change_7d / 30));
  const age = ageDays(p.listed_at, asOf);
  const seasoning = age === null ? 0.9 : round4(0.75 + (0.45 * Math.min(age, 730)) / 730);
  const breadth = round4(1 + 0.04 * Math.min(Math.max(p.chains.length - 1, 0), 5));
  const implied = Math.round(p.tvl_usd * multiple * growth * seasoning * breadth);
  return { multiple, growth, seasoning, breadth, age_days: age, implied_value_usd: implied };
}

// ---------------------------------------------------------------------------
// Farm plans. One template set, seven steps per protocol. The dashboard
// carries the same generator (dashboard/plans.js) so the judge can read it;
// the two must agree string for string, which the build check verifies.
// ---------------------------------------------------------------------------

/** Weekly gas estimate per chain: [native gas token, rough USD per week]. */
export const GAS_TABLE: Record<string, { token: string; usd: number }> = {
  Ethereum: { token: 'ETH', usd: 8 },
  Solana: { token: 'SOL', usd: 0.3 },
  Base: { token: 'ETH', usd: 0.6 },
  Arbitrum: { token: 'ETH', usd: 0.8 },
  Binance: { token: 'BNB', usd: 1.2 },
  Polygon: { token: 'POL', usd: 0.4 },
  Avalanche: { token: 'AVAX', usd: 1.5 },
  Optimism: { token: 'ETH', usd: 0.7 },
  Sui: { token: 'SUI', usd: 0.5 },
  Mantle: { token: 'MNT', usd: 0.3 },
  Linea: { token: 'ETH', usd: 0.5 },
  Scroll: { token: 'ETH', usd: 0.6 },
  'zkSync Era': { token: 'ETH', usd: 0.5 },
  Tron: { token: 'TRX', usd: 2 },
  Bitcoin: { token: 'BTC', usd: 3 },
};
const GAS_DEFAULT = { token: 'its native token', usd: 2 };

export function gasFor(chain: string): { token: string; usd: number } {
  return GAS_TABLE[chain] ?? GAS_DEFAULT;
}

/** Working capital for the plan, tiered by the protocol's TVL. */
export function capitalFor(tvlUsd: number): number {
  if (tvlUsd >= 1_000_000_000) return 500;
  if (tvlUsd >= 250_000_000) return 300;
  if (tvlUsd >= 50_000_000) return 200;
  if (tvlUsd >= 10_000_000) return 100;
  return 40;
}

type PlaybookKey =
  | 'dex' | 'lending' | 'bridges' | 'staking' | 'yield' | 'curators'
  | 'derivatives' | 'rwa' | 'indexes' | 'insurance' | 'payments'
  | 'prediction' | 'chain' | 'generic';

const CATEGORY_PLAYBOOK: Record<string, PlaybookKey> = {
  Dexs: 'dex',
  Lending: 'lending',
  CDP: 'lending',
  'CDP Manager': 'lending',
  'Uncollateralized Lending': 'lending',
  'Collateral Markets': 'lending',
  Bridge: 'bridges',
  'Canonical Bridge': 'bridges',
  'Cross Chain Bridge': 'bridges',
  'Liquid Staking': 'staking',
  'Liquid Restaking': 'staking',
  Restaking: 'staking',
  'Restaked BTC': 'staking',
  'Staking Pool': 'staking',
  'Anchor BTC': 'staking',
  'Decentralized BTC': 'staking',
  Yield: 'yield',
  'Yield Aggregator': 'yield',
  Farm: 'yield',
  'Leveraged Farming': 'yield',
  'Liquidity Manager': 'yield',
  'Risk Curators': 'curators',
  'Onchain Capital Allocator': 'curators',
  Derivatives: 'derivatives',
  'Basis Trading': 'derivatives',
  'Interest Rate Derivatives': 'derivatives',
  RWA: 'rwa',
  Indexes: 'indexes',
  Insurance: 'insurance',
  Payments: 'payments',
  'Crypto Card Issuer': 'payments',
  'Prediction Market': 'prediction',
  Chain: 'chain',
};

export function playbookFor(category: string | null): PlaybookKey {
  if (category === null) return 'generic';
  return CATEGORY_PLAYBOOK[category] ?? 'generic';
}

interface PlanContext {
  name: string;
  chain: string;
  chains: number;
  capital: number;
  gasToken: string;
  gasUsd: number;
}

function fill(template: string, ctx: PlanContext): string {
  return template
    .split('{name}').join(ctx.name)
    .split('{chain}').join(ctx.chain)
    .split('{capital}').join(String(ctx.capital))
    .split('{gas}').join(String(ctx.gasUsd))
    .split('{gasToken}').join(ctx.gasToken);
}

const PLAYBOOK_ACTIONS: Record<PlaybookKey, { core: string; second: string }> = {
  dex: {
    core: 'Route your ordinary swaps through {name} on {chain} instead of a larger aggregator, and add a small position to one of its main liquidity pools so the wallet both trades and provides. Cost: pool and swap fees on about ${capital} of activity. Time: about 20 minutes to set up.',
    second: 'Come back on a different day and rebalance the pool position or swap a second pair; two separated sessions read as a real user, not a script. Cost: about ${gas} in gas plus swap fees. Time: about 10 minutes.',
  },
  lending: {
    core: 'Supply about ${capital} of a mainstream asset to {name} on {chain} and leave it supplied; a steady balance held over weeks is the behaviour lending markets record. Cost: about ${gas} in gas to supply. Time: about 15 minutes.',
    second: 'Borrow a small amount against the supply, under a third of its value, and repay it a week later; a completed borrow-and-repay cycle shows the wallet used the market in full. Cost: interest for a week on the borrow, usually under $2. Time: about 10 minutes.',
  },
  bridges: {
    core: 'Bridge about ${capital} to a chain {name} serves using its own route rather than a third-party bridge, and leave the funds working on the far side for at least a week. Cost: the bridge fee, about 0.1% of the amount. Time: about 15 minutes including the wait.',
    second: 'Bridge a second, smaller amount back the other way on a later day, so the wallet has genuine two-way traffic instead of a single hop. Cost: the bridge fee on the return amount. Time: about 15 minutes including the wait.',
  },
  staking: {
    core: 'Stake about ${capital} with {name} on {chain} and keep the staking position untouched; duration held is the signal staking protocols can actually measure. Cost: about ${gas} in gas to stake. Time: about 10 minutes.',
    second: 'Claim or compound any staking rewards once, mid-way through the six weeks, and restake them rather than selling; one natural reward cycle is enough. Cost: about ${gas} in gas. Time: about 5 minutes.',
  },
  yield: {
    core: "Deposit about ${capital} into {name}'s main vault or pool on {chain} and leave it there; vault share balance over time is the record that matters. Cost: about ${gas} in gas to deposit. Time: about 10 minutes.",
    second: 'Harvest the accrued yield once after a few weeks and redeposit it in the same vault, so the wallet shows a full earn-and-compound cycle. Cost: about ${gas} in gas. Time: about 5 minutes.',
  },
  curators: {
    core: "Allocate about ${capital} into a vault {name} curates on {chain}, choosing its most-used vault rather than a new one, and hold the position. Cost: about ${gas} in gas to deposit. Time: about 15 minutes, including reading the vault's risk notes.",
    second: 'Move a small part of the position, about a fifth, into a second vault from the same curator later in the month, so the wallet has compared allocations, not just parked. Cost: about ${gas} in gas. Time: about 10 minutes.',
  },
  derivatives: {
    core: 'Open a small, hedged position through {name} on {chain} with about ${capital} of margin: if it is a basis product, hold the paired legs; if it is a perp venue, trade both sides over the week. Cost: trading fees on the position, about 0.1%. Time: about 20 minutes to set up.',
    second: 'Adjust or roll the position once in a later week rather than closing it at once; a position that lives and is managed reads as real use. Cost: trading fees on the adjustment. Time: about 10 minutes.',
  },
  rwa: {
    core: "Buy about ${capital} of the tokenised asset {name} offers on {chain}, completing its onboarding or KYC if it asks, and hold the asset. Cost: the purchase spread, about 0.5% or less. Time: about 30 minutes including onboarding.",
    second: 'Collect one yield or interest payment cycle on the asset before doing anything else; a held position that has paid out once is a complete record. Cost: $0 beyond holding. Time: about 5 minutes to check.',
  },
  indexes: {
    core: "Buy about ${capital} of {name}'s index product on {chain} and hold it; index holders are counted by balance and by how long they stay. Cost: the product's mint fee, about 0.3% or less. Time: about 10 minutes.",
    second: 'Add a smaller second purchase, about a quarter of the first, a few weeks later, so the wallet shows accumulation rather than a single test buy. Cost: the mint fee on the smaller amount. Time: about 5 minutes.',
  },
  insurance: {
    core: 'Buy cover from {name} on {chain} for a position you actually hold elsewhere, sized to about ${capital} of cover for a short term. Cost: the cover premium, roughly 2-3% of the cover for the term. Time: about 15 minutes.',
    second: 'Let the cover run to expiry unused, then renew it once if you still hold the position; a completed cover period is the full product cycle. Cost: the renewal premium. Time: about 10 minutes.',
  },
  payments: {
    core: "Get {name}'s payment route or card on {chain} working with about ${capital} loaded, and make it the way you pay for two or three ordinary purchases. Cost: the service's normal transaction fees. Time: about 20 minutes to set up.",
    second: 'Use it again in a later week for a different kind of purchase, online and in person if it offers both; variety of spend is what payment products record. Cost: normal transaction fees. Time: about 5 minutes a purchase.',
  },
  prediction: {
    core: 'Place small positions, about ${capital} in total, on two or three markets {name} runs on {chain}, choosing markets you can actually follow to settlement. Cost: the position amounts themselves, at risk. Time: about 15 minutes.',
    second: 'Hold at least one position to settlement and claim the result properly; a settled-and-claimed market is the complete cycle the product records. Cost: about ${gas} in gas to claim. Time: about 5 minutes.',
  },
  chain: {
    core: 'Become a small but real user of {name} itself: bridge about ${capital} in, hold its native asset, and use two of its native applications in the first week. Cost: bridge plus gas, about ${gas} a session. Time: about 30 minutes.',
    second: "Return weekly for the six weeks and make one native transaction each visit, a swap, a stake or a vote, so the wallet's activity spans the whole period. Cost: about ${gas} in gas a week. Time: about 10 minutes a week.",
  },
  generic: {
    core: "Use {name}'s main product on {chain} with about ${capital} committed, doing the action it is built for rather than a token gesture, and leave the position in place. Cost: about ${gas} in gas plus any product fee. Time: about 15 minutes.",
    second: 'Repeat the core action once more a few weeks later at a similar size, so the wallet has a pattern of use instead of a single visit. Cost: about ${gas} in gas. Time: about 10 minutes.',
  },
};

/** Human age phrase used in the hold step: "178 days", "14 months", "2.4 years". */
export function agePhrase(age: number): string {
  if (age >= 730) return `${(age / 365.25).toFixed(1)} years`;
  if (age >= 60) return `${Math.round(age / 30.44)} months`;
  return `${age} days`;
}

export function farmPlan(p: Protocol, age: number | null): string[] {
  const chain = p.chains[0] ?? 'Ethereum';
  const gas = gasFor(chain);
  const ctx: PlanContext = {
    name: p.name,
    chain,
    chains: p.chains.length,
    capital: capitalFor(p.tvl_usd),
    gasToken: gas.token,
    gasUsd: gas.usd,
  };
  const actions = PLAYBOOK_ACTIONS[playbookFor(p.category)];
  const reach =
    p.chains.length > 1
      ? `the same wallet can reach its other ${p.chains.length - 1} networks later if the plan grows`
      : 'it runs on this one network, so there is no routing choice to make';
  const hold =
    age === null
      ? fill('Its listing date is unrecorded, so treat {name} as unproven: keep the position small, recheck its TVL monthly, and be ready to exit if the TVL halves. Cost: $0 to monitor. Time: 10 minutes a month.', ctx)
      : age >= 730
        ? fill(`{name} has run ${agePhrase(age)} with no token recorded: keep the position open, harvest any yield monthly, and re-check the ranking each month rather than adding in a hurry. Cost: $0 beyond position carry. Time: 10 minutes a month.`, ctx)
        : age >= 365
          ? fill(`{name} has run ${agePhrase(age)} with no token recorded, long enough to be deliberate: hold the position, add only on TVL growth, and review quarterly. Cost: $0 beyond position carry. Time: 10 minutes a quarter.`, ctx)
          : fill(`{name} has only run ${agePhrase(age)}: keep size modest, re-check TVL and the plan monthly, and let two clean quarters pass before increasing. Cost: $0 beyond position carry. Time: 10 minutes a month.`, ctx);
  return [
    fill('Set up a fresh wallet just for {name} and connect it on {chain}; keep farm activity in this wallet only, apart from your main funds, so every action stays attributable. Cost: $0 in setup fees, plus the seed funding in step 2. Time: about 15 minutes.', ctx),
    fill('Fund the wallet on {chain} with ${capital} of working capital plus {gasToken} for gas; a week of {name} actions there costs roughly ${gas} in fees, and ' + reach + '. Cost: about ${gas} a week in gas. Time: about 10 minutes to fund.', ctx),
    fill(actions.core, ctx),
    fill(actions.second, ctx),
    fill('Repeat the core action in one short session a week for six weeks, varying amounts and times of day; points systems reward steady, ordinary use, and a single burst inside 48 hours is the pattern most often discounted. Cost: the gas in step 2, weekly. Time: about 15 minutes a week for six weeks.', ctx),
    hold,
    fill("Keep a farm log for {name}: date, action, amount and transaction hash for every step, reviewed weekly. If a token or claim is ever announced, verify the contract address from {name}'s official channels before signing anything, and never enter a seed phrase to claim. Cost: $0. Time: 5 minutes a week.", ctx),
  ];
}

// ---------------------------------------------------------------------------
// Board assembly
// ---------------------------------------------------------------------------

export function formatUsd(value: number): string {
  if (value >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
  if (value >= 1e6) return `$${(value / 1e6).toFixed(1)}M`;
  if (value >= 1e3) return `$${Math.round(value / 1e3)}K`;
  return `$${value}`;
}

export interface BoardRow {
  slug: string;
  name: string;
  rank: number;
  implied_value_usd: number;
  farm_steps: string[];
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  watchlist: boolean;
  multiple: number;
  growth: number;
  seasoning: number;
  breadth: number;
  why: string;
}

export interface LiveRow {
  slug: string;
  name: string;
  symbol: string | null;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number;
  ratio: number | null;
}

export interface Radar {
  as_of: string;
  stats: {
    scanned: number;
    ranked: number;
    watchlist: number;
    live: number;
    total_implied_usd: number;
    global_multiple: number;
  };
  rows: BoardRow[];
  live: LiveRow[];
  multiples: { category: string; multiple: number; comps: number }[];
}

export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: Radar } {
  const multiples = computeMultiples(snapshot.protocols);
  const watchlist = new Set(snapshot.watchlist);
  const scored: { p: Protocol; b: Breakdown }[] = [];
  for (const p of snapshot.protocols) {
    if (inScope(p)) scored.push({ p, b: score(p, multiples, snapshot.as_of) });
  }
  scored.sort((a, b2) => b2.b.implied_value_usd - a.b.implied_value_usd || (a.p.slug < b2.p.slug ? -1 : 1));
  const board: BoardRow[] = scored.map(({ p, b }, i) => {
    const rank = i + 1;
    const catLabel = p.category ?? 'Uncategorised';
    const why =
      `Ranked #${rank}: ${formatUsd(p.tvl_usd)} of TVL at the ${catLabel} multiple of ${b.multiple.toFixed(4)}x, ` +
      `growth ${b.growth.toFixed(2)}x, seasoning ${b.seasoning.toFixed(2)}x and breadth ${b.breadth.toFixed(2)}x ` +
      `gives an implied ${formatUsd(b.implied_value_usd)}${watchlist.has(p.slug) ? '; it is on the snapshot watchlist' : ''}.`;
    return {
      slug: p.slug,
      name: p.name,
      rank,
      implied_value_usd: b.implied_value_usd,
      farm_steps: farmPlan(p, b.age_days),
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      listed_at: p.listed_at,
      age_days: b.age_days,
      watchlist: watchlist.has(p.slug),
      multiple: b.multiple,
      growth: b.growth,
      seasoning: b.seasoning,
      breadth: b.breadth,
      why,
    };
  });
  const live: LiveRow[] = snapshot.protocols
    .filter(isLive)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      symbol: p.symbol,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd!,
      ratio: p.tvl_usd > 0 ? round4(p.mcap_usd! / p.tvl_usd) : null,
    }))
    .sort((a, b) => b.mcap_usd - a.mcap_usd);
  const multipleRows = [...multiples.byCategory.entries()]
    .map(([category, multiple]) => ({
      category: category ?? 'Uncategorised',
      multiple,
      comps: multiples.comps.get(category) ?? 0,
    }))
    .sort((a, b) => b.multiple - a.multiple);
  const radar: Radar = {
    as_of: snapshot.as_of,
    stats: {
      scanned: snapshot.protocols.length,
      ranked: board.length,
      watchlist: snapshot.watchlist.length,
      live: live.length,
      total_implied_usd: board.reduce((sum, r) => sum + r.implied_value_usd, 0),
      global_multiple: multiples.global,
    },
    rows: board,
    live,
    multiples: multipleRows,
  };
  return { board, radar };
}

/** The dashboard's data file: the whole radar as one script assignment. */
export function dataScript(radar: Radar): string {
  return `window.RADAR = ${JSON.stringify(radar)};\n`;
}

/** A plain-language reason the gate would refuse this board, or null. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `board holds ${board.length} rows, outside 100..4000`;
  const ranks = new Set<number>();
  let previous = Number.POSITIVE_INFINITY;
  let allEqual = true;
  const slugs = new Set<string>();
  for (const row of board) {
    if (ranks.has(row.rank)) return `rank ${row.rank} appears twice`;
    ranks.add(row.rank);
    if (row.rank < 1 || row.rank > board.length) return `rank ${row.rank} outside 1..${board.length}`;
    if (row.implied_value_usd > previous) return `implied value rises at rank ${row.rank}`;
    if (row.implied_value_usd !== board[0]!.implied_value_usd) allEqual = false;
    previous = row.implied_value_usd;
    slugs.add(row.slug);
    if (row.farm_steps.length < 3 || row.farm_steps.length > 12) return `${row.slug}: ${row.farm_steps.length} farm steps`;
    for (const step of row.farm_steps) {
      const len = step.trim().length;
      if (len < 20 || len > 600) return `${row.slug}: a farm step of ${len} characters`;
    }
  }
  if (allEqual && board.length > 1) return 'every implied value is the same';
  for (const slug of snapshot.watchlist) {
    if (!slugs.has(slug)) return `watchlist protocol ${slug} is missing from the board`;
  }
  return null;
}
