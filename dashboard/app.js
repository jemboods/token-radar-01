// app.js — the radar page: board, live list, model view and per-protocol
// detail, all rendered from window.RADAR (the data.js the program writes).
// Routes live in the hash: #/ board, #/live, #/model, #/protocol/<slug>;
// board filters and sort ride along as #/?q=..&cat=..&chain=..&wl=1&sort=..
// so any view can be linked — and screenshotted — deterministically.

(function () {
  'use strict';

  var R = window.RADAR;
  var rows = R.rows;
  var bySlug = {};
  rows.forEach(function (r) { bySlug[r.slug] = r; });

  function el(id) { return document.getElementById(id); }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function fmtUsd(v) {
    if (v >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'B';
    if (v >= 1e6) return '$' + (v / 1e6).toFixed(1) + 'M';
    if (v >= 1e3) return '$' + Math.round(v / 1e3) + 'K';
    return '$' + v;
  }

  function fmtAge(days) {
    if (days === null || days === undefined) return '—';
    if (days >= 730) return (days / 365.25).toFixed(1) + 'y';
    if (days >= 60) return Math.round(days / 30.44) + 'mo';
    return days + 'd';
  }

  function fmtChange(c) {
    if (c === null || c === undefined) return '<span class="sub">n/a</span>';
    var cls = c >= 0 ? 'pos' : 'neg';
    return '<span class="' + cls + '">' + (c >= 0 ? '+' : '') + c.toFixed(1) + '%</span>';
  }

  // -- header ---------------------------------------------------------------
  el('st-scanned').textContent = R.stats.scanned;
  el('st-ranked').textContent = R.stats.ranked;
  el('st-watchlist').textContent = R.stats.watchlist + '/' + R.stats.watchlist;
  el('st-live').textContent = R.stats.live;
  el('st-total').textContent = fmtUsd(R.stats.total_implied_usd);
  el('st-median').textContent = R.stats.global_multiple.toFixed(4) + 'x';
  el('as-of').textContent = R.as_of;

  // -- board state ------------------------------------------------------------
  var state = { q: '', cat: '', chain: '', wl: false, sort: 'rank', dir: 1 };

  function readBoardHash(params) {
    state.q = params.get('q') || '';
    state.cat = params.get('cat') || '';
    state.chain = params.get('chain') || '';
    state.wl = params.get('wl') === '1';
    state.sort = params.get('sort') || 'rank';
    state.dir = params.get('dir') === 'desc' ? -1 : 1;
    el('q').value = state.q;
    el('f-watchlist').checked = state.wl;
  }

  function syncHash() {
    var p = new URLSearchParams();
    if (state.q) p.set('q', state.q);
    if (state.cat) p.set('cat', state.cat);
    if (state.chain) p.set('chain', state.chain);
    if (state.wl) p.set('wl', '1');
    if (state.sort !== 'rank') p.set('sort', state.sort);
    if (state.dir === -1) p.set('dir', 'desc');
    var s = p.toString();
    history.replaceState(null, '', '#/' + (s ? '?' + s : ''));
  }

  function filtered() {
    var q = state.q.trim().toLowerCase();
    var list = rows.filter(function (r) {
      if (state.wl && !r.watchlist) return false;
      if (state.cat && (r.category || 'Uncategorised') !== state.cat) return false;
      if (state.chain && r.chains.indexOf(state.chain) === -1) return false;
      if (q && r.name.toLowerCase().indexOf(q) === -1 && r.slug.indexOf(q) === -1) return false;
      return true;
    });
    var key = state.sort;
    var dir = state.dir;
    var val = {
      rank: function (r) { return r.rank; },
      value: function (r) { return r.implied_value_usd; },
      tvl: function (r) { return r.tvl_usd; },
      change: function (r) { return r.change_7d === null ? -Infinity : r.change_7d; },
      age: function (r) { return r.age_days === null ? -1 : r.age_days; },
    }[key];
    list.sort(function (a, b) { return (val(a) - val(b)) * dir || a.rank - b.rank; });
    return list;
  }

  function renderBoard() {
    var list = filtered();
    el('row-count').textContent = list.length + ' of ' + rows.length + ' protocols';
    el('board-body').innerHTML = list.map(function (r) {
      return '<tr data-slug="' + esc(r.slug) + '">' +
        '<td class="num">' + r.rank + '</td>' +
        '<td class="name">' + esc(r.name) + (r.watchlist ? '<span class="badge">WATCHLIST</span>' : '') +
        '<span class="sub">' + esc(r.slug) + '</span></td>' +
        '<td>' + esc(r.category || 'Uncategorised') + '</td>' +
        '<td class="num">' + fmtUsd(r.implied_value_usd) + '</td>' +
        '<td class="num">' + fmtUsd(r.tvl_usd) + '</td>' +
        '<td class="num">' + fmtChange(r.change_7d) + '</td>' +
        '<td class="num">' + fmtAge(r.age_days) + '</td>' +
        '<td class="num">' + r.multiple.toFixed(4) + 'x</td></tr>';
    }).join('');
  }

  // -- live tab ---------------------------------------------------------------
  function renderLive() {
    el('live-body').innerHTML = R.live.map(function (p) {
      return '<tr><td class="name">' + esc(p.name) + '<span class="sub">' + esc(p.slug) + '</span></td>' +
        '<td>' + esc(p.symbol || '—') + '</td>' +
        '<td>' + esc(p.category || 'Uncategorised') + '</td>' +
        '<td class="num">' + fmtUsd(p.tvl_usd) + '</td>' +
        '<td class="num">' + fmtUsd(p.mcap_usd) + '</td>' +
        '<td class="num">' + (p.ratio === null ? '—' : p.ratio.toFixed(4) + 'x') + '</td></tr>';
    }).join('');
  }

  // -- model tab: multiples recomputed here, from the live rows ---------------
  function medianOf(values) {
    var s = values.slice().sort(function (a, b) { return a - b; });
    var mid = Math.floor(s.length / 2);
    return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  }
  function round4(x) { return Math.round(x * 10000) / 10000; }

  function computeMultiples(liveRows) {
    var all = [];
    var buckets = {};
    liveRows.forEach(function (p) {
      if (p.mcap_usd === null || p.tvl_usd <= 0) return;
      var ratio = p.mcap_usd / p.tvl_usd;
      if (ratio < 0.005 || ratio > 20) return;
      all.push(ratio);
      var key = p.category || 'Uncategorised';
      (buckets[key] = buckets[key] || []).push(ratio);
    });
    var table = Object.keys(buckets)
      .filter(function (k) { return buckets[k].length >= 3; })
      .map(function (k) { return { category: k, multiple: round4(medianOf(buckets[k])), comps: buckets[k].length }; })
      .sort(function (a, b) { return b.multiple - a.multiple; });
    return { global: round4(medianOf(all)), peers: all.length, table: table };
  }

  function renderModel() {
    var made = computeMultiples(R.live);
    el('multiples-body').innerHTML = made.table.map(function (m) {
      return '<tr><td>' + esc(m.category) + '</td><td class="num">' + m.multiple.toFixed(4) + 'x</td><td class="num">' + m.comps + '</td></tr>';
    }).join('');
    el('global-note').textContent =
      'Global median across ' + made.peers + ' live peers with a usable ratio: ' + made.global.toFixed(4) +
      'x. Categories with fewer than 3 live peers are priced at this global median instead.';
  }

  // -- detail -------------------------------------------------------------------
  function renderDetail(slug) {
    var r = bySlug[slug];
    if (!r) { el('detail').innerHTML = '<p class="lede">No protocol with that slug is on the board.</p>'; return; }
    var plan = window.FARM.plan(r);
    var arith = [
      ['TVL (snapshot)', fmtUsd(r.tvl_usd)],
      ['x category multiple (' + (r.category || 'Uncategorised') + ')', r.multiple.toFixed(4) + 'x'],
      ['x growth (7d ' + (r.change_7d === null ? 'unreported' : r.change_7d.toFixed(1) + '%') + ')', r.growth.toFixed(4) + 'x'],
      ['x seasoning (' + (r.age_days === null ? 'listing date unrecorded' : fmtAge(r.age_days) + ' with no token recorded') + ')', r.seasoning.toFixed(4) + 'x'],
      ['x breadth (' + r.chains.length + (r.chains.length === 1 ? ' chain' : ' chains') + ')', r.breadth.toFixed(4) + 'x'],
      ['= implied value', fmtUsd(r.implied_value_usd)],
    ];
    el('detail').innerHTML =
      '<div class="detail-head"><h2>' + esc(r.name) + '</h2>' +
      (r.watchlist ? '<span class="badge">WATCHLIST</span>' : '') +
      '<span class="detail-meta">' + esc(r.category || 'Uncategorised') + ' &middot; ' + esc(r.chains.join(', ')) + '</span></div>' +
      '<div class="cards">' +
      '<div class="card"><span class="v">#' + r.rank + '</span><span class="k">board rank</span></div>' +
      '<div class="card"><span class="v">' + fmtUsd(r.implied_value_usd) + '</span><span class="k">implied value</span></div>' +
      '<div class="card"><span class="v">' + fmtUsd(r.tvl_usd) + '</span><span class="k">TVL</span></div>' +
      '<div class="card"><span class="v">' + fmtChange(r.change_7d) + '</span><span class="k">TVL change, 7d</span></div>' +
      '</div>' +
      '<p class="why">' + esc(r.why) + '</p>' +
      '<h2>The arithmetic</h2>' +
      '<table class="arith">' + arith.map(function (row) { return '<tr><td>' + esc(row[0]) + '</td><td>' + esc(row[1]) + '</td></tr>'; }).join('') + '</table>' +
      '<h2>How to farm it</h2>' +
      '<ol class="plan">' + plan.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ol>' +
      '<p class="hint">DefiLlama records no token for ' + esc(r.name) + ' as of ' + R.as_of + '; a record is not proof that none exists. The plan is a starting point, not a promise of an airdrop.</p>';
  }

  // -- routing ------------------------------------------------------------------
  var views = ['board', 'live', 'model', 'detail'];
  function show(view) {
    views.forEach(function (v) { el('view-' + v).hidden = v !== view; });
    document.querySelectorAll('.tab').forEach(function (t) {
      t.classList.toggle('active', t.getAttribute('data-nav') === view || (view === 'detail' && t.getAttribute('data-nav') === 'board'));
    });
    window.scrollTo(0, 0);
  }

  function route() {
    var hash = location.hash.replace(/^#\/?/, '');
    var parts = hash.split('?');
    var path = parts[0] || '';
    var params = new URLSearchParams(parts[1] || '');
    if (path === 'live') { renderLive(); show('live'); return; }
    if (path === 'model') { renderModel(); show('model'); return; }
    if (path.indexOf('protocol/') === 0) { renderDetail(decodeURIComponent(path.slice('protocol/'.length))); show('detail'); return; }
    readBoardHash(params);
    if (el('f-category').options.length) el('f-category').value = state.cat;
    if (el('f-chain').options.length) el('f-chain').value = state.chain;
    renderBoard();
    show('board');
  }

  // -- controls -------------------------------------------------------------------
  function fillSelect(id, values, allLabel) {
    var sel = el(id);
    sel.innerHTML = '<option value="">' + allLabel + '</option>' + values.map(function (v) {
      return '<option value="' + esc(v) + '">' + esc(v) + '</option>';
    }).join('');
  }
  var cats = [];
  var chains = [];
  rows.forEach(function (r) {
    var c = r.category || 'Uncategorised';
    if (cats.indexOf(c) === -1) cats.push(c);
    r.chains.forEach(function (ch) { if (chains.indexOf(ch) === -1) chains.push(ch); });
  });
  cats.sort(); chains.sort();
  fillSelect('f-category', cats, 'All categories');
  fillSelect('f-chain', chains, 'All chains');

  function controlChanged() {
    state.q = el('q').value;
    state.cat = el('f-category').value;
    state.chain = el('f-chain').value;
    state.wl = el('f-watchlist').checked;
    syncHash();
    renderBoard();
  }
  ['q', 'f-category', 'f-chain', 'f-watchlist'].forEach(function (id) {
    el(id).addEventListener('input', controlChanged);
    el(id).addEventListener('change', controlChanged);
  });

  document.querySelectorAll('th.sortable').forEach(function (th) {
    th.addEventListener('click', function () {
      var key = th.getAttribute('data-sort');
      if (state.sort === key) state.dir = -state.dir;
      else { state.sort = key; state.dir = key === 'rank' ? 1 : -1; }
      syncHash();
      renderBoard();
    });
  });

  el('board-body').addEventListener('click', function (ev) {
    var tr = ev.target.closest('tr[data-slug]');
    if (tr) location.hash = '#/protocol/' + encodeURIComponent(tr.getAttribute('data-slug'));
  });

  document.querySelectorAll('.tab').forEach(function (t) {
    t.addEventListener('click', function () {
      var nav = t.getAttribute('data-nav');
      location.hash = nav === 'board' ? '#/' : '#/' + nav;
    });
  });

  window.addEventListener('hashchange', route);
  route();

  // Exposed for the entry's own build checks: the page's recomputation of
  // the multiples must agree with the values the program published.
  window.RADAR_APP = { computeMultiples: computeMultiples };
})();
