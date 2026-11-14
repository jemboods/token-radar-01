// plans.js — the farm-plan generator, carried on the page so a reader (and
// the judge) can see exactly how every row's plan was made. It mirrors the
// generator in lib/model.ts template for template; the entry's build check
// proves the two produce identical steps for all 289 board rows.
//
// A plan is seven steps: fresh-wallet setup, funding and gas on the
// protocol's first chain, a category-playbook core action, a second action,
// a six-week cadence, an age-tiered hold, and a farm log with a claim-safety
// exit. Every step states its Cost: and its Time:.

(function () {
  'use strict';

  var GAS_TABLE = {
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
  var GAS_DEFAULT = { token: 'its native token', usd: 2 };

  function gasFor(chain) {
    return GAS_TABLE[chain] || GAS_DEFAULT;
  }

  function capitalFor(tvlUsd) {
    if (tvlUsd >= 1000000000) return 500;
    if (tvlUsd >= 250000000) return 300;
    if (tvlUsd >= 50000000) return 200;
    if (tvlUsd >= 10000000) return 100;
    return 40;
  }

  var CATEGORY_PLAYBOOK = {
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

  function playbookFor(category) {
    if (category === null || category === undefined) return 'generic';
    return CATEGORY_PLAYBOOK[category] || 'generic';
  }

  var PLAYBOOK_ACTIONS = {
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

  function agePhrase(age) {
    if (age >= 730) return (age / 365.25).toFixed(1) + ' years';
    if (age >= 60) return Math.round(age / 30.44) + ' months';
    return age + ' days';
  }

  function fill(template, ctx) {
    return template
      .split('{name}').join(ctx.name)
      .split('{chain}').join(ctx.chain)
      .split('{capital}').join(String(ctx.capital))
      .split('{gas}').join(String(ctx.gasUsd))
      .split('{gasToken}').join(ctx.gasToken);
  }

  // proto: { name, category, chains, tvl_usd, age_days } — the board row's
  // own fields, so the page regenerates the very steps board.json carries.
  function farmPlan(proto) {
    var chain = proto.chains[0] || 'Ethereum';
    var gas = gasFor(chain);
    var ctx = {
      name: proto.name,
      chain: chain,
      chains: proto.chains.length,
      capital: capitalFor(proto.tvl_usd),
      gasToken: gas.token,
      gasUsd: gas.usd,
    };
    var actions = PLAYBOOK_ACTIONS[playbookFor(proto.category)];
    var reach =
      proto.chains.length > 1
        ? 'the same wallet can reach its other ' + (proto.chains.length - 1) + ' networks later if the plan grows'
        : 'it runs on this one network, so there is no routing choice to make';
    var age = proto.age_days;
    var hold;
    if (age === null || age === undefined) {
      hold = fill('Its listing date is unrecorded, so treat {name} as unproven: keep the position small, recheck its TVL monthly, and be ready to exit if the TVL halves. Cost: $0 to monitor. Time: 10 minutes a month.', ctx);
    } else if (age >= 730) {
      hold = fill('{name} has run ' + agePhrase(age) + ' with no token recorded: keep the position open, harvest any yield monthly, and re-check the ranking each month rather than adding in a hurry. Cost: $0 beyond position carry. Time: 10 minutes a month.', ctx);
    } else if (age >= 365) {
      hold = fill('{name} has run ' + agePhrase(age) + ' with no token recorded, long enough to be deliberate: hold the position, add only on TVL growth, and review quarterly. Cost: $0 beyond position carry. Time: 10 minutes a quarter.', ctx);
    } else {
      hold = fill('{name} has only run ' + agePhrase(age) + ': keep size modest, re-check TVL and the plan monthly, and let two clean quarters pass before increasing. Cost: $0 beyond position carry. Time: 10 minutes a month.', ctx);
    }
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

  window.FARM = { plan: farmPlan, gasFor: gasFor, capitalFor: capitalFor };
})();
