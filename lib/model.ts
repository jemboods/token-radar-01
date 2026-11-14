// Token Radar model: which protocols in the snapshot have no token recorded,
// what a token would plausibly be worth, and how to farm each one.
//
// The value model is built from the snapshot's own evidence. Protocols that
// already trade carry a market cap; dividing it by TVL gives a multiple for
// every live protocol, and multiples cluster by business model — a liquid
// staking token trades at a few cents per dollar of TVL while a bridge or a
// privacy protocol can trade above one dollar per dollar. So a pre-token
// protocol is priced at the MEDIAN multiple of the live protocols in its own
// category, never at one flat rate and never from a list of names. Three
// adjustments, all computed from the row's own fields, move that base:
//
//   growth     the 7-day TVL change, squashed through tanh so one hot week
//              cannot dominate: 1 + 0.45 * tanh(change_7d / 30)
//   seasoning  how long the protocol has run with no token recorded, capped
//              at two years: 0.75 + 0.45 * min(age_days, 730) / 730. A
//              protocol with no listing date is held at a flat 0.90: unknown
//              age is neither young nor old.
//   breadth    one small step per extra chain, capped at five: a protocol
//              live on several chains has more users to distribute to.
//
// Every factor is rounded before it is applied, so the arithmetic printed on
// the dashboard reproduces the board's implied value exactly.

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
  watchlist: string[];
  protocols: Protocol[];
}

export interface CategoryMultiple {
  category: string;
  /** Median market cap / TVL of the live protocols in this category. */
  multiple: number;
  /** How many live protocols the median is taken over. */
  comps: number;
  /** True when the category has enough comps to use its own median. */
  applied: boolean;
}

export interface Multiples {
  byCategory: Map<string, CategoryMultiple>;
  globalMedian: number;
  compsUsed: number;
}

export interface BoardRow {
  slug: string;
  name: string;
  rank: number;
  implied_value_usd: number;
  farm_steps: string[];
  category: string;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  multiple: number;
  multiple_comps: number;
  growth_factor: number;
  seasoning_factor: number;
  breadth_factor: number;
  implied_multiple: number;
  watchlist: boolean;
  why: string;
}

export interface LiveRow {
  slug: string;
  name: string;
  symbol: string | null;
  category: string;
  tvl_usd: number;
  mcap_usd: number;
  ratio: number;
}

const DAY_MS = 86_400_000;
const MIN_COMPS = 3;
const RATIO_LO = 0.005;
const RATIO_HI = 20;

const UNCATEGORISED = 'Uncategorised';

/** No mcap, no gecko id, no symbol: the snapshot records no token for it. */
export function isPreToken(p: Protocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/**
 * A pre-token protocol the board ranks: not a centralised exchange (an
 * exchange's token value is its off-chain business, which no figure in this
 * snapshot measures) and not a versioned deployment of a protocol listed
 * under its main name.
 */
export function isRankable(p: Protocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

export function categoryOf(p: Protocol): string {
  return p.category ?? UNCATEGORISED;
}

/** Whole days from the listing date to the snapshot date; null when unknown. */
export function ageDays(p: Protocol, asOf: string): number | null {
  if (!p.listed_at) return null;
  const listed = Date.parse(`${p.listed_at}T00:00:00Z`);
  const as = Date.parse(`${asOf}T00:00:00Z`);
  if (!Number.isFinite(listed) || !Number.isFinite(as)) return null;
  return Math.max(0, Math.floor((as - listed) / DAY_MS));
}

const round = (x: number, dp: number): number => {
  const f = 10 ** dp;
  return Math.round(x * f) / f;
};

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/**
 * The live evidence: for every category, the median market-cap-to-TVL
 * multiple of the protocols that already trade. Ratios outside
 * [0.005, 20] are trimmed as data errors or peg artefacts before any median
 * is taken. A category with fewer than three live comps falls back to the
 * global median.
 */
export function computeMultiples(snapshot: Snapshot): Multiples {
  const ratios = new Map<string, number[]>();
  let all: number[] = [];
  for (const p of snapshot.protocols) {
    if (p.mcap_usd === null || p.tvl_usd <= 0) continue;
    const r = p.mcap_usd / p.tvl_usd;
    if (r < RATIO_LO || r > RATIO_HI) continue;
    const cat = categoryOf(p);
    const list = ratios.get(cat) ?? [];
    list.push(r);
    ratios.set(cat, list);
    all = [...all, r];
  }
  const globalMedian = round(median(all), 4);
  const byCategory = new Map<string, CategoryMultiple>();
  for (const [cat, list] of ratios) {
    byCategory.set(cat, {
      category: cat,
      multiple: round(median(list), 4),
      comps: list.length,
      applied: list.length >= MIN_COMPS,
    });
  }
  return { byCategory, globalMedian, compsUsed: all.length };
}

/** The multiple a row is priced at, and how much evidence stands behind it. */
export function multipleFor(p: Protocol, m: Multiples): { multiple: number; comps: number } {
  const own = m.byCategory.get(categoryOf(p));
  if (own && own.applied) return { multiple: own.multiple, comps: own.comps };
  return { multiple: m.globalMedian, comps: 0 };
}

export function growthFactor(change7d: number | null): number {
  if (change7d === null) return 1;
  return round(1 + 0.45 * Math.tanh(change7d / 30), 3);
}

export function seasoningFactor(age: number | null): number {
  if (age === null) return 0.9;
  return round(0.75 + (0.45 * Math.min(age, 730)) / 730, 3);
}

export function breadthFactor(chainCount: number): number {
  return round(1 + 0.04 * Math.min(Math.max(chainCount - 1, 0), 5), 2);
}

/** 1,234,567 — a thousands separator that does not depend on ICU data. */
export function fmtInt(n: number): string {
  const s = String(Math.trunc(Math.abs(n)));
  let out = '';
  for (let i = 0; i < s.length; i++) {
    if (i > 0 && (s.length - i) % 3 === 0) out += ',';
    out += s[i];
  }
  return n < 0 ? `-${out}` : out;
}

function whyLine(p: Protocol, age: number | null, mult: number, comps: number, globalMedian: number, gf: number, sf: number, bf: number): string {
  const cat = categoryOf(p);
  const base =
    comps > 0
      ? `Priced at ${mult}× TVL, the median market cap to TVL of the ${comps} live ${cat} protocols in this snapshot (the global median across all categories is ${globalMedian}×)`
      : `Priced at ${mult}× TVL, the global median market cap to TVL across every live protocol in this snapshot, because ${cat} has too few live protocols to take a median of its own`;
  const growth =
    p.change_7d === null
      ? 'growth ×1 (no 7-day change recorded)'
      : `growth ×${gf} (TVL ${p.change_7d >= 0 ? '+' : ''}${round(p.change_7d, 2)}% in 7 days)`;
  const seasoning =
    age === null
      ? 'seasoning ×0.90 (no listing date recorded, so age is treated as unknown rather than young or old)'
      : `seasoning ×${sf} (${fmtInt(age)} days listed with no token recorded)`;
  const breadth = `breadth ×${bf} (live on ${p.chains.length} chain${p.chains.length === 1 ? '' : 's'})`;
  return `${base}; ${growth}; ${seasoning}; ${breadth}.`;
}

// ---------------------------------------------------------------- farm plans

/** Working capital for the core position, tiered by the protocol's TVL. */
function capitalFor(tvl: number): string {
  if (tvl >= 1_000_000_000) return '$500';
  if (tvl >= 250_000_000) return '$250';
  if (tvl >= 50_000_000) return '$150';
  if (tvl >= 10_000_000) return '$75';
  return '$40';
}

/** A plain-language gas estimate for the protocol's first listed chain. */
function gasFor(chain: string): string {
  switch (chain) {
    case 'Ethereum':
      return 'about $3-8';
    case 'Arbitrum':
    case 'Optimism':
      return 'about $0.10-0.30';
    case 'Base':
      return 'about $0.05-0.20';
    case 'Binance':
      return 'about $0.10-0.30';
    case 'Solana':
    case 'Polygon':
      return 'under $0.05';
    case 'Avalanche':
      return 'about $0.05-0.30';
    default:
      return 'under $1 on most days';
  }
}

interface Playbook {
  core: string;
  second: string;
}

const PLAYBOOKS: Record<string, Playbook> = {
  dexs: {
    core: 'swap about half of it between the two main assets of its busiest pool, then deposit the rest as liquidity in that same pool and keep the LP position open',
    second: 'On a later visit, add to the LP position once and remove about a third of it, so the wallet shows both directions of liquidity flow, not only deposits.',
  },
  lending: {
    core: 'supply it as collateral, borrow about a quarter of it back in a stablecoin, and repay the borrow within the same week, so the account shows a complete lend-and-borrow cycle',
    second: 'Later in the month, run the same cycle with a different collateral asset if the market lists one, at half the first size.',
  },
  bridge: {
    core: 'bridge it to a second chain the product supports, wait at least a day, then bridge a different amount back; one-way-only trips read as wash volume',
    second: 'Use a second route or destination chain the product supports, at half size, so the footprint is not a single repeated corridor.',
  },
  staking: {
    core: 'stake it through the product and hold the liquid receipt token in the same wallet; do not sell the receipt in the same week you receive it',
    second: 'If the product offers a second vault, tier or staking route, split a small part of the stake into it rather than adding everything to the first.',
  },
  yield: {
    core: 'deposit it into the main vault and hold the vault share token; leave the deposit untouched across at least two weekly balance snapshots',
    second: 'After the first deposit settles, move a small part of it into a second vault with a different strategy or asset.',
  },
  curator: {
    core: 'deposit it into one of the curated vaults on the main chain and hold the position; curators who launch tokens tend to reward average balance over time, not peak balance',
    second: 'After two weeks, shift a small part of the deposit to a second vault from the same curator, to show deliberate allocation rather than a parked lump sum.',
  },
  derivs: {
    core: 'open the smallest hedged position the interface allows, a long and a short leg of equal size, and close it after at least a day, so the account shows real usage without directional risk',
    second: 'Repeat the hedged trade in a different market the product lists, at the same small size, in a different week.',
  },
  rwa: {
    core: 'complete any onboarding the product requires and buy the smallest tokenised position it offers; hold it rather than flipping it back the same week',
    second: 'Hold through at least one interest or reporting cycle, and save the position statement if the product issues one.',
  },
  indexes: {
    core: 'buy the smallest basket allocation it offers and hold it across at least two rebalances',
    second: 'After the first rebalance, add a small top-up, so the account shows activity in two different months.',
  },
  insurance: {
    core: 'buy the smallest cover policy it offers against a position you actually hold elsewhere, and let it run towards expiry',
    second: 'Renew or extend the cover once if the underlying position is still open.',
  },
  payments: {
    core: 'register for the card or account if one is offered and make two small real payments on different days; payment products count active days, not volume',
    second: 'Keep the account active with one small payment a week for a month; consistency is the metric these products snapshot.',
  },
  prediction: {
    core: 'take small positions, under $10 each, on two different markets on two different days; prediction products reward breadth of markets used',
    second: 'Settle or close the first positions before opening new ones, so the history shows completed markets, not only entries.',
  },
  chain: {
    core: 'use the chain itself: bridge a small amount in, then make swaps and transfers on three separate days, so the wallet reads as a real user of the network',
    second: 'Use one native application on the chain, a DEX or a lending market, with a small amount, so the activity is not only transfers.',
  },
  generic: {
    core: 'make the smallest real deposit or trade the product offers on its main chain and hold the resulting position; a held position counts for more than a same-day round trip',
    second: 'On the next visit, use a second feature of the same product, a different pool, market or vault, at half the first size.',
  },
};

function playbookFor(category: string): Playbook {
  switch (category) {
    case 'Dexs':
      return PLAYBOOKS.dexs!;
    case 'Lending':
    case 'Uncollateralized Lending':
    case 'Collateral Markets':
    case 'CDP':
    case 'CDP Manager':
      return PLAYBOOKS.lending!;
    case 'Bridge':
    case 'Cross Chain Bridge':
    case 'Canonical Bridge':
      return PLAYBOOKS.bridge!;
    case 'Liquid Staking':
    case 'Staking Pool':
    case 'Restaking':
    case 'Liquid Restaking':
    case 'Restaked BTC':
    case 'Anchor BTC':
    case 'Decentralized BTC':
    case 'Stablecoin Wrapper':
      return PLAYBOOKS.staking!;
    case 'Yield':
    case 'Yield Aggregator':
    case 'Farm':
    case 'Leveraged Farming':
    case 'Liquidity Manager':
    case 'Dual-Token Stablecoin':
      return PLAYBOOKS.yield!;
    case 'Risk Curators':
    case 'Onchain Capital Allocator':
    case 'Governance Incentives':
      return PLAYBOOKS.curator!;
    case 'Derivatives':
    case 'Interest Rate Derivatives':
    case 'Basis Trading':
      return PLAYBOOKS.derivs!;
    case 'RWA':
      return PLAYBOOKS.rwa!;
    case 'Indexes':
      return PLAYBOOKS.indexes!;
    case 'Insurance':
      return PLAYBOOKS.insurance!;
    case 'Payments':
    case 'Crypto Card Issuer':
      return PLAYBOOKS.payments!;
    case 'Prediction Market':
      return PLAYBOOKS.prediction!;
    case 'Chain':
      return PLAYBOOKS.chain!;
    default:
      return PLAYBOOKS.generic!;
  }
}

/**
 * A seven-step plan for one protocol. Every step names its cost and its
 * time, and the amounts come from the row itself: the capital scales with
 * the protocol's TVL, the gas with its main chain, the hold with its age.
 * Nothing here promises an airdrop: the plan earns a real usage history,
 * which is the only thing a future distribution can reward.
 */
export function farmSteps(p: Protocol, age: number | null): string[] {
  const name = p.name;
  const mainChain = p.chains[0] ?? 'Ethereum';
  const gas = gasFor(mainChain);
  const capital = capitalFor(p.tvl_usd);
  const book = playbookFor(categoryOf(p));
  const year = p.listed_at ? p.listed_at.slice(0, 4) : null;

  const setup =
    `Set up a fresh wallet for ${name} and keep the seed phrase offline, on paper; never use a wallet that holds other funds. ` +
    `Fund it with about $10 of gas money on ${mainChain} plus the working capital used in step 3. Cost: about $10 moved, not spent. Time: 15 minutes.`;
  const route =
    `Move the working capital to ${mainChain}, the first chain the snapshot lists for ${name}` +
    (p.chains.length > 1 ? ` (it is live on ${p.chains.length} chains in all)` : '') +
    `. Use the official bridge or an exchange withdrawal, and send a $5 test transfer before the full amount. Cost: ${gas} in network fees. Time: 10 minutes.`;
  const core =
    `Put ${capital} to work in ${name}: ${book.core}. Keep the size small enough that a lock-up or a bad week stays affordable. ` +
    `Cost: ${capital} of working capital, deposited rather than spent, plus ${gas} in gas. Time: 15 minutes.`;
  const second = `${book.second} Cost: about $0.50 in gas for most chains, ${gas} on ${mainChain}. Time: 10 minutes.`;
  const cadence =
    `Repeat the core action once a week for the next six weeks, varying the amount by about a third each time and never running two sessions in one day: ` +
    `distributions that look at history reward steady weeks and discount bursts crammed into 48 hours. Cost: ${gas} a week in gas. Time: 10 minutes a week.`;
  let hold: string;
  if (age !== null && year !== null && age >= 730) {
    hold =
      `${name} has been listed since ${year}, ${fmtInt(age)} days with no token recorded. Keep the position open and check its official channels and rewards page every week: ` +
      `long-running protocols that launch a token usually announce it with little notice. Cost: $0. Time: 5 minutes a week.`;
  } else if (age !== null && year !== null && age >= 180) {
    hold =
      `${name} has been listed since ${year}, ${fmtInt(age)} days with no token recorded. Hold the position through at least two more months of weekly sessions before judging it: ` +
      `protocols of this age are where points and rewards programmes usually appear first. Cost: $0 beyond the gas above. Time: 5 minutes a week.`;
  } else if (age !== null && year !== null) {
    hold =
      `${name} was only listed in ${year}, ${fmtInt(age)} days ago, early enough that small wallets are still a large share of its users. Keep the weekly sessions going and expect a long wait. ` +
      `Cost: $0 beyond the gas above. Time: 5 minutes a week.`;
  } else {
    hold =
      `The snapshot gives no listing date for ${name}, so plan for a long wait: hold the position, check the official channels once a month, and let the weekly sessions accumulate. ` +
      `Cost: $0 beyond the gas above. Time: 5 minutes a month.`;
  }
  const log =
    `Keep a farm log for ${name}: the date, action, amount and transaction hash of every session. If a token or a claim is ever announced, claim only through links in the protocol's ` +
    `official channels, check the contract address twice before signing, and unwind borrows and LP positions before claiming. Cost: $0. Time: 5 minutes per session.`;
  return [setup, route, core, second, cadence, hold, log];
}

/** The whole board: every rankable pre-token protocol, ranked by implied value. */
export function buildBoard(snapshot: Snapshot, multiples: Multiples): BoardRow[] {
  const watch = new Set(snapshot.watchlist);
  const rows: BoardRow[] = [];
  for (const p of snapshot.protocols) {
    if (!isRankable(p)) continue;
    const age = ageDays(p, snapshot.as_of);
    const { multiple, comps } = multipleFor(p, multiples);
    const gf = growthFactor(p.change_7d);
    const sf = seasoningFactor(age);
    const bf = breadthFactor(p.chains.length);
    const implied = Math.max(1, Math.round(p.tvl_usd * multiple * gf * sf * bf));
    rows.push({
      slug: p.slug,
      name: p.name,
      rank: 0,
      implied_value_usd: implied,
      farm_steps: farmSteps(p, age),
      category: categoryOf(p),
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      listed_at: p.listed_at,
      age_days: age,
      multiple,
      multiple_comps: comps,
      growth_factor: gf,
      seasoning_factor: sf,
      breadth_factor: bf,
      implied_multiple: round(implied / p.tvl_usd, 3),
      watchlist: watch.has(p.slug),
      why: whyLine(p, age, multiple, comps, multiples.globalMedian, gf, sf, bf),
    });
  }
  rows.sort(
    (a, b) =>
      b.implied_value_usd - a.implied_value_usd ||
      b.tvl_usd - a.tvl_usd ||
      (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0),
  );
  rows.forEach((r, i) => {
    r.rank = i + 1;
  });
  return rows;
}

/** The live side of the market: protocols that already trade, richest first. */
export function buildLive(snapshot: Snapshot): LiveRow[] {
  const out: LiveRow[] = [];
  for (const p of snapshot.protocols) {
    if (p.mcap_usd === null) continue;
    out.push({
      slug: p.slug,
      name: p.name,
      symbol: p.symbol,
      category: categoryOf(p),
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      ratio: p.tvl_usd > 0 ? round(p.mcap_usd / p.tvl_usd, 3) : 0,
    });
  }
  out.sort((a, b) => b.mcap_usd - a.mcap_usd || (a.slug < b.slug ? -1 : 1));
  return out;
}
