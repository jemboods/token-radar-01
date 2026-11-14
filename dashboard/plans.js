'use strict';
/* Farm plans, generated in the page from the row's own figures, the same
   generator the program uses for board.json: the capital scales with the
   protocol's TVL, the gas with its main chain, the core action with its
   category, the hold with its age. Every step names its cost and its time.
   Nothing here promises an airdrop: a plan earns a genuine usage history,
   which is the only thing a future distribution can reward. */

function trCapitalFor(tvl) {
  if (tvl >= 1e9) return '$500';
  if (tvl >= 250e6) return '$250';
  if (tvl >= 50e6) return '$150';
  if (tvl >= 10e6) return '$75';
  return '$40';
}

function trGasFor(chain) {
  switch (chain) {
    case 'Ethereum': return 'about $3-8';
    case 'Arbitrum': case 'Optimism': return 'about $0.10-0.30';
    case 'Base': return 'about $0.05-0.20';
    case 'Binance': return 'about $0.10-0.30';
    case 'Solana': case 'Polygon': return 'under $0.05';
    case 'Avalanche': return 'about $0.05-0.30';
    default: return 'under $1 on most days';
  }
}

const TR_PLAYBOOKS = {
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

function trPlaybookFor(category) {
  switch (category) {
    case 'Dexs': return TR_PLAYBOOKS.dexs;
    case 'Lending': case 'Uncollateralized Lending': case 'Collateral Markets': case 'CDP': case 'CDP Manager': return TR_PLAYBOOKS.lending;
    case 'Bridge': case 'Cross Chain Bridge': case 'Canonical Bridge': return TR_PLAYBOOKS.bridge;
    case 'Liquid Staking': case 'Staking Pool': case 'Restaking': case 'Liquid Restaking': case 'Restaked BTC': case 'Anchor BTC': case 'Decentralized BTC': case 'Stablecoin Wrapper': return TR_PLAYBOOKS.staking;
    case 'Yield': case 'Yield Aggregator': case 'Farm': case 'Leveraged Farming': case 'Liquidity Manager': case 'Dual-Token Stablecoin': return TR_PLAYBOOKS.yield;
    case 'Risk Curators': case 'Onchain Capital Allocator': case 'Governance Incentives': return TR_PLAYBOOKS.curator;
    case 'Derivatives': case 'Interest Rate Derivatives': case 'Basis Trading': return TR_PLAYBOOKS.derivs;
    case 'RWA': return TR_PLAYBOOKS.rwa;
    case 'Indexes': return TR_PLAYBOOKS.indexes;
    case 'Insurance': return TR_PLAYBOOKS.insurance;
    case 'Payments': case 'Crypto Card Issuer': return TR_PLAYBOOKS.payments;
    case 'Prediction Market': return TR_PLAYBOOKS.prediction;
    case 'Chain': return TR_PLAYBOOKS.chain;
    default: return TR_PLAYBOOKS.generic;
  }
}

function trFmtInt(n) {
  const s = String(Math.trunc(Math.abs(n)));
  let out = '';
  for (let i = 0; i < s.length; i++) {
    if (i > 0 && (s.length - i) % 3 === 0) out += ',';
    out += s[i];
  }
  return n < 0 ? '-' + out : out;
}

function farmSteps(row) {
  const name = row.name;
  const age = row.age_days;
  const mainChain = row.chains[0] || 'Ethereum';
  const gas = trGasFor(mainChain);
  const capital = trCapitalFor(row.tvl_usd);
  const book = trPlaybookFor(row.category);
  const year = row.listed_at ? row.listed_at.slice(0, 4) : null;

  const setup =
    'Set up a fresh wallet for ' + name + ' and keep the seed phrase offline, on paper; never use a wallet that holds other funds. ' +
    'Fund it with about $10 of gas money on ' + mainChain + ' plus the working capital used in step 3. Cost: about $10 moved, not spent. Time: 15 minutes.';
  const route =
    'Move the working capital to ' + mainChain + ', the first chain the snapshot lists for ' + name +
    (row.chains.length > 1 ? ' (it is live on ' + row.chains.length + ' chains in all)' : '') +
    '. Use the official bridge or an exchange withdrawal, and send a $5 test transfer before the full amount. Cost: ' + gas + ' in network fees. Time: 10 minutes.';
  const core =
    'Put ' + capital + ' to work in ' + name + ': ' + book.core + '. Keep the size small enough that a lock-up or a bad week stays affordable. ' +
    'Cost: ' + capital + ' of working capital, deposited rather than spent, plus ' + gas + ' in gas. Time: 15 minutes.';
  const second = book.second + ' Cost: about $0.50 in gas for most chains, ' + gas + ' on ' + mainChain + '. Time: 10 minutes.';
  const cadence =
    'Repeat the core action once a week for the next six weeks, varying the amount by about a third each time and never running two sessions in one day: ' +
    'distributions that look at history reward steady weeks and discount bursts crammed into 48 hours. Cost: ' + gas + ' a week in gas. Time: 10 minutes a week.';
  let hold;
  if (age !== null && year !== null && age >= 730) {
    hold =
      name + ' has been listed since ' + year + ', ' + trFmtInt(age) + ' days with no token recorded. Keep the position open and check its official channels and rewards page every week: ' +
      'long-running protocols that launch a token usually announce it with little notice. Cost: $0. Time: 5 minutes a week.';
  } else if (age !== null && year !== null && age >= 180) {
    hold =
      name + ' has been listed since ' + year + ', ' + trFmtInt(age) + ' days with no token recorded. Hold the position through at least two more months of weekly sessions before judging it: ' +
      'protocols of this age are where points and rewards programmes usually appear first. Cost: $0 beyond the gas above. Time: 5 minutes a week.';
  } else if (age !== null && year !== null) {
    hold =
      name + ' was only listed in ' + year + ', ' + trFmtInt(age) + ' days ago, early enough that small wallets are still a large share of its users. Keep the weekly sessions going and expect a long wait. ' +
      'Cost: $0 beyond the gas above. Time: 5 minutes a week.';
  } else {
    hold =
      'The snapshot gives no listing date for ' + name + ', so plan for a long wait: hold the position, check the official channels once a month, and let the weekly sessions accumulate. ' +
      'Cost: $0 beyond the gas above. Time: 5 minutes a month.';
  }
  const log =
    'Keep a farm log for ' + name + ': the date, action, amount and transaction hash of every session. If a token or a claim is ever announced, claim only through links in the protocol\'s ' +
    'official channels, check the contract address twice before signing, and unwind borrows and LP positions before claiming. Cost: $0. Time: 5 minutes per session.';
  return [setup, route, core, second, cadence, hold, log];
}

window.farmSteps = farmSteps;
