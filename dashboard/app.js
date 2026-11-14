'use strict';
/* Token Radar dashboard. Everything on this page is rendered from
   window.RADAR, the data.js the program writes beside this folder, so the
   page, the board file and the screenshots always agree. Routes:
   #/ board, #/live, #/model, #/protocol/<slug>, and the board accepts
   ?q=&cat=&chain=&watch=1&sort=&dir= so a view can be linked exactly. */

const R = window.RADAR;
const $ = (s) => document.querySelector(s);

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function commas(n) {
  const s = String(Math.trunc(Math.abs(n)));
  let out = '';
  for (let i = 0; i < s.length; i++) {
    if (i > 0 && (s.length - i) % 3 === 0) out += ',';
    out += s[i];
  }
  return n < 0 ? '-' + out : out;
}
function money(n) {
  if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return '$' + (n / 1e3).toFixed(0) + 'K';
  return '$' + n;
}
function moneyFull(n) { return '$' + commas(n); }
function fmtChg(x) { return (x > 0 ? '+' : '') + (Math.round(x * 100) / 100) + '%'; }
function pct(x) {
  if (x === null || x === undefined) return '<span class="dim">—</span>';
  const cls = x > 0 ? 'pos' : x < 0 ? 'neg' : '';
  return '<span class="' + cls + '">' + fmtChg(x) + '</span>';
}

/* The category multiples, recomputed here from the live protocols' own
   market cap ÷ TVL ratios (trimmed to 0.005–20, median per category,
   categories with fewer than 3 comps fall back to the global median) —
   the same computation the program runs for the board. */
function computeMultiples(live) {
  const byCat = new Map();
  const all = [];
  for (const p of live) {
    if (!p.tvl_usd || p.tvl_usd <= 0) continue;
    const r = p.mcap_usd / p.tvl_usd;
    if (r < 0.005 || r > 20) continue;
    if (!byCat.has(p.category)) byCat.set(p.category, []);
    byCat.get(p.category).push(r);
    all.push(r);
  }
  const median = (xs) => {
    const s = [...xs].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 === 1 ? s[m] : (s[m - 1] + s[m]) / 2;
  };
  const round4 = (x) => Math.round(x * 10000) / 10000;
  const global = round4(median(all));
  const cats = [...byCat.entries()].map(([category, xs]) => ({
    category, multiple: round4(median(xs)), comps: xs.length, applied: xs.length >= 3,
  }));
  cats.sort((a, b) => b.comps - a.comps || (a.category < b.category ? -1 : 1));
  return { global, cats };
}
function ageText(days) {
  if (days === null) return '—';
  if (days >= 730) return (days / 365).toFixed(1) + 'y';
  if (days >= 60) return Math.round(days / 30.4) + 'mo';
  return days + 'd';
}

/* ------------------------------------------------------------- routing */

function parseHash() {
  const h = location.hash.replace(/^#/, '') || '/';
  const q = h.indexOf('?');
  const path = q >= 0 ? h.slice(0, q) : h;
  const params = new URLSearchParams(q >= 0 ? h.slice(q + 1) : '');
  return { path, params };
}

function boardHash() {
  const p = new URLSearchParams();
  const q = $('#q').value.trim();
  if (q) p.set('q', q);
  if ($('#cat').value) p.set('cat', $('#cat').value);
  if ($('#chain').value) p.set('chain', $('#chain').value);
  if ($('#watch').checked) p.set('watch', '1');
  if ($('#sort').value !== 'rank') p.set('sort', $('#sort').value);
  const def = $('#sort').value === 'rank' ? 'asc' : 'desc';
  if (state.dir !== def) p.set('dir', state.dir);
  const s = p.toString();
  return '#/' + (s ? '?' + s : '');
}

const state = { dir: 'asc' };

function show(view) {
  for (const v of ['board', 'live', 'model', 'detail']) {
    $('#view-' + v).hidden = v !== view;
  }
  document.querySelectorAll('.tabs button').forEach((b) => {
    b.classList.toggle('on', b.dataset.view === view);
  });
}

/* ------------------------------------------------------------- board */

function filteredRows() {
  const q = $('#q').value.trim().toLowerCase();
  const cat = $('#cat').value;
  const chain = $('#chain').value;
  const watch = $('#watch').checked;
  let rows = R.rows.filter((r) =>
    (!q || r.name.toLowerCase().includes(q) || r.slug.includes(q)) &&
    (!cat || r.category === cat) &&
    (!chain || r.chains.includes(chain)) &&
    (!watch || r.watchlist));
  const key = { rank: 'rank', value: 'implied_value_usd', tvl: 'tvl_usd', chg: 'change_7d', age: 'age_days' }[$('#sort').value];
  const mul = state.dir === 'asc' ? 1 : -1;
  rows.sort((a, b) => {
    const av = a[key], bv = b[key];
    if (av === null && bv === null) return a.rank - b.rank;
    if (av === null) return 1;
    if (bv === null) return -1;
    return (av - bv) * mul || a.rank - b.rank;
  });
  return rows;
}

function renderBoard() {
  const rows = filteredRows();
  const watchShown = rows.filter((r) => r.watchlist).length;
  $('#count').textContent =
    'Showing ' + rows.length + ' of ' + R.rows.length + ' ranked protocols · ' + watchShown +
    ' watchlist · implied values in USD, from the model on the third tab';
  $('#board tbody').innerHTML = rows.map((r) =>
    '<tr data-slug="' + esc(r.slug) + '"' + (r.watchlist ? ' class="watch"' : '') + '>' +
    '<td class="rank">' + r.rank + '</td>' +
    '<td class="name">' + (r.watchlist ? '<span class="star">★</span> ' : '') + esc(r.name) +
      '<span class="slug">' + esc(r.slug) + '</span></td>' +
    '<td>' + esc(r.category) + '</td>' +
    '<td>' + esc(r.chains.slice(0, 3).join(', ')) + (r.chains.length > 3 ? ' +' + (r.chains.length - 3) : '') + '</td>' +
    '<td class="num">' + money(r.tvl_usd) + '</td>' +
    '<td class="num">' + pct(r.change_7d) + '</td>' +
    '<td>' + (r.listed_at || '—') + '</td>' +
    '<td class="num">' + ageText(r.age_days) + '</td>' +
    '<td class="num">' + money(r.implied_value_usd) + '</td>' +
    '<td class="num">' + r.implied_multiple + '×</td></tr>'
  ).join('');
}

/* ------------------------------------------------------------- live */

function renderLive() {
  $('#live tbody').innerHTML = R.live.slice(0, 60).map((r) =>
    '<tr><td class="name">' + esc(r.name) + '<span class="slug">' + esc(r.slug) + '</span></td>' +
    '<td>' + esc(r.symbol || '—') + '</td><td>' + esc(r.category) + '</td>' +
    '<td class="num">' + money(r.tvl_usd) + '</td><td class="num">' + money(r.mcap_usd) + '</td>' +
    '<td class="num">' + r.ratio + '×</td></tr>'
  ).join('');
}

function renderModel() {
  const m = computeMultiples(R.live);
  $('#mults tbody').innerHTML = m.cats.map((c) =>
    '<tr><td>' + esc(c.category) + '</td><td class="num">' + c.comps + '</td>' +
    '<td class="num">' + c.multiple + '×</td>' +
    '<td>' + (c.category === 'CEX' ? 'shown for evidence — exchanges are not ranked' : c.applied ? 'priced at this median' : 'too few — global median ' + m.global + '× applies') + '</td></tr>'
  ).join('');
}

/* ------------------------------------------------------------- detail */

function renderDetail(slug) {
  const r = R.rows.find((x) => x.slug === slug);
  if (!r) { location.hash = '#/'; return; }
  const plan = window.farmSteps(r).map((s) =>
    '<li>' + esc(s).replace(' Cost: ', '<br><b>Cost:</b> ').replace('. Time: ', ' &nbsp;<b>Time:</b> ') + '</li>'
  ).join('');
  $('#view-detail').innerHTML =
    '<a class="back" href="#/">← Back to the board</a>' +
    '<div class="detail-head"><h2>' + esc(r.name) + '</h2>' +
    '<span class="slug">' + esc(r.slug) + '</span>' +
    (r.watchlist ? '<span class="pill amber">★ watchlist</span>' : '') +
    (r.tvl_usd >= R.floor_usd ? '<span class="pill">above the $50M curation floor</span>' : '<span class="pill">below the $50M floor — early</span>') +
    '</div>' +
    '<div class="dgrid">' +
    '<div class="stat"><div class="v">#' + r.rank + '</div><div class="l">Rank of ' + R.rows.length + '</div></div>' +
    '<div class="stat"><div class="v"><em>' + moneyFull(r.implied_value_usd) + '</em></div><div class="l">Implied token value</div></div>' +
    '<div class="stat"><div class="v">' + moneyFull(r.tvl_usd) + '</div><div class="l">TVL in snapshot</div></div>' +
    '<div class="stat"><div class="v">' + r.implied_multiple + '×</div><div class="l">Implied value ÷ TVL</div></div>' +
    '</div>' +
    '<h3>Why this rank</h3><p class="why">' + esc(r.why) + '</p>' +
    '<h3>The arithmetic</h3><table class="break"><tbody>' +
    '<tr><td>TVL</td><td class="num">' + moneyFull(r.tvl_usd) + '</td></tr>' +
    '<tr><td>Category multiple</td><td class="num">× ' + r.multiple + (r.multiple_comps > 0 ? ' (median of ' + r.multiple_comps + ' live ' + esc(r.category) + ')' : ' (global median — too few live ' + esc(r.category) + ')') + '</td></tr>' +
    '<tr><td>Growth</td><td class="num">× ' + r.growth_factor + (r.change_7d === null ? ' (no 7-day change recorded)' : ' (' + fmtChg(r.change_7d) + ' TVL in 7 days)') + '</td></tr>' +
    '<tr><td>Seasoning</td><td class="num">× ' + r.seasoning_factor + (r.age_days === null ? ' (listing date unknown)' : ' (listed ' + r.listed_at + ', ' + commas(r.age_days) + ' days, no token recorded)') + '</td></tr>' +
    '<tr><td>Breadth</td><td class="num">× ' + r.breadth_factor + ' (' + r.chains.length + ' chains: ' + esc(r.chains.join(', ')) + ')</td></tr>' +
    '<tr><td>Implied value</td><td class="num"><b>' + moneyFull(r.implied_value_usd) + '</b></td></tr>' +
    '</tbody></table>' +
    '<h3>Farm plan — 7 steps</h3><ol class="plan">' + plan + '</ol>' +
    '<p class="hint">The snapshot records no token for ' + esc(r.name) + ' — that is a statement about this data, not a promise that none exists or that one will launch. The plan builds a real usage history; nothing can guarantee a distribution.</p>';
  show('detail');
}

/* ------------------------------------------------------------- init */

function renderStats() {
  const s = R.stats;
  const cells = [
    [String(s.scanned), 'protocols scanned'],
    ['<em>' + s.ranked + '</em>', 'pre-token, ranked'],
    ['<em>' + s.watchlist_covered + ' / ' + s.watchlist + '</em>', 'watchlist covered'],
    [String(s.live_tokens), 'already trading'],
    [money(s.total_implied_usd), 'total implied value'],
    [s.global_median_multiple + '×', 'global median cap ÷ TVL'],
  ];
  $('#stats').innerHTML = cells.map((c) => '<div class="stat"><div class="v">' + c[0] + '</div><div class="l">' + c[1] + '</div></div>').join('');
  $('#m-asof').textContent = R.as_of;
  $('#source').textContent = 'Source: ' + R.source;
}

function applyBoardParams(params) {
  $('#q').value = params.get('q') || '';
  $('#cat').value = params.get('cat') || '';
  $('#chain').value = params.get('chain') || '';
  $('#watch').checked = params.get('watch') === '1';
  $('#sort').value = params.get('sort') || 'rank';
  state.dir = params.get('dir') || ($('#sort').value === 'rank' ? 'asc' : 'desc');
  $('#dir').textContent = state.dir === 'asc' ? '↑' : '↓';
}

function route() {
  if (!R) { document.body.innerHTML = '<p style="padding:32px">data.js is missing — run the program first.</p>'; return; }
  const { path, params } = parseHash();
  if (path.startsWith('/protocol/')) {
    renderDetail(decodeURIComponent(path.slice('/protocol/'.length)));
    return;
  }
  if (path === '/live') { show('live'); renderLive(); return; }
  if (path === '/model') { show('model'); renderModel(); return; }
  show('board');
  applyBoardParams(params);
  renderBoard();
}

function init() {
  const cats = [...new Set(R.rows.map((r) => r.category))].sort();
  $('#cat').innerHTML = '<option value="">All categories</option>' + cats.map((c) => '<option>' + esc(c) + '</option>').join('');
  const chains = [...new Set(R.rows.flatMap((r) => r.chains))].sort();
  $('#chain').innerHTML = '<option value="">All chains</option>' + chains.map((c) => '<option>' + esc(c) + '</option>').join('');
  renderStats();

  const sync = () => { history.replaceState(null, '', boardHash()); renderBoard(); };
  for (const id of ['#q', '#cat', '#chain', '#sort']) $(id).addEventListener('input', sync);
  $('#watch').addEventListener('change', sync);
  $('#dir').addEventListener('click', () => {
    state.dir = state.dir === 'asc' ? 'desc' : 'asc';
    $('#dir').textContent = state.dir === 'asc' ? '↑' : '↓';
    sync();
  });
  document.querySelectorAll('#board thead th[data-k]').forEach((th) => {
    th.addEventListener('click', () => {
      const map = { rank: 'rank', tvl: 'tvl', chg: 'chg', age: 'age', value: 'value' };
      const v = map[th.dataset.k];
      if ($('#sort').value === v) state.dir = state.dir === 'asc' ? 'desc' : 'asc';
      else { $('#sort').value = v; state.dir = v === 'rank' ? 'asc' : 'desc'; }
      $('#dir').textContent = state.dir === 'asc' ? '↑' : '↓';
      sync();
    });
  });
  $('#board tbody').addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-slug]');
    if (tr) location.hash = '#/protocol/' + encodeURIComponent(tr.dataset.slug);
  });
  document.querySelectorAll('.tabs button').forEach((b) => {
    b.addEventListener('click', () => {
      location.hash = b.dataset.view === 'board' ? '#/' : '#/' + b.dataset.view;
    });
  });
  window.addEventListener('hashchange', route);
  route();
}

init();
