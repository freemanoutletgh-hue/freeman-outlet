// Supply — stock by size: pools (Dome / Online / Supply), delivery, moving stock, counting, sizes, history, round planner.
(function () {
  'use strict';
  var U = window.SUP, S = U.S, V = U.V, A = U.A, I = U.I, C = U.C;
  var $ = U.$, $$ = U.$$, esc = U.esc, money = U.money, fmtDate = U.fmtDate, api = U.api, app = U.app, toast = U.toast, dialog = U.dialog, pageHead = U.pageHead, W = U.W;
  var POOL = { dome: 'Dome', online: 'Online', supply: 'Supply' };
  var POOL_LONG = { dome: 'Dome — main warehouse', online: 'Online — at Spintex', supply: 'Supply — at Spintex' };
  var data = null, view = 'all', form = null;
  function fail(showErr) { return function (e) { if (showErr) showErr(e.message); else toast(e.message, true); }; }
  function load() { return api('/api/supply/stock').then(function (d) { data = d; U.stockData = d; return d; }); }
  function gkey(pid, c, s) { return pid + '|' + (c || '') + '|' + (s || ''); }
  function unionSizes(p) { var seen = {}, out = []; p.colours.forEach(function (c) { c.sizes.forEach(function (s) { if (!seen[s]) { seen[s] = 1; out.push(s); } }); }); Object.keys(p.skus).forEach(function (k) { var s = k.split('|')[1]; if (!seen[s]) { seen[s] = 1; out.push(s); } }); return out; }
  function extraColours(p) { var have = p.colours.map(function (c) { return c.name; }), extra = []; Object.keys(p.skus).forEach(function (k) { var c = k.split('|')[0]; if (have.indexOf(c) < 0 && extra.indexOf(c) < 0) extra.push(c); }); return extra; }
  function colourRows(p) { return p.colours.map(function (c) { return c.name; }).concat(extraColours(p)); }
  function sizeIn(p, c, s) { var col = p.colours.filter(function (x) { return x.name === c; })[0]; return col ? col.sizes.indexOf(s) >= 0 : !!p.skus[c + '|' + s]; }
  function gridStyle(n) { return 'grid-template-columns:72px repeat(' + n + ',minmax(54px,1fr))'; }
  function heads(sizes) { return '<div></div>' + sizes.map(function (s) { return '<div class="cl">' + esc(s || 'Packs') + '</div>'; }).join(''); }
  function typeGroups(list) { var g = {}, order = []; list.forEach(function (p) { if (!g[p.type]) { g[p.type] = []; order.push(p.type); } g[p.type].push(p); }); return order.map(function (t) { return { type: t, items: g[t] }; }); }
  function n0(v) { return v || 0; }
  function poolTotal(p, pool) { return pool === 'all' ? p.totals.dome + p.totals.online + p.totals.supply : p.totals[pool]; }

  // ── OVERVIEW ───────────────────────────────────────────────────────────────
  V.stock = function () {
    Promise.all([load(), api('/api/supply/stock/alerts')]).then(function (r) {
      var d = r[0], alerts = r[1], t = d.totals;
      var track = d.tracking
        ? '<div class="card notice"><b>Size stock is on.</b> Website orders, supply rounds and deliveries now move these numbers, and the website only offers sizes that are in stock online.' + (S.canWrite ? '<div class="actions"><button class="btn small" data-act="stock-thresholds">Low-stock levels</button><button class="btn small" data-act="stock-track-off">Turn off</button></div>' : '') + '</div>'
        : '<div class="card notice warn"><b>Size stock is off.</b> The website still uses its old stock numbers. Receive or count your stock by size below, then start tracking.' + (S.canWrite ? '<div class="actions"><button class="btn small primary" data-act="stock-track-on">Start tracking</button></div>' : '') + '</div>';
      var alertHtml = alerts.length ? '<div class="card"><h3>Running low</h3>' + alerts.slice(0, 8).map(function (a) {
        return '<div class="line"><div><div class="t">' + (a.pool === 'online' ? 'Online' : 'Supply') + ' · ' + esc(a.productName) + '</div><div class="m">' + a.items.slice(0, 6).map(function (i) { return esc(i.label) + ' ' + i.have; }).join(' · ') + (a.canRestock ? ' — Dome has stock' : ' — none in Dome') + '</div></div>' + (S.canWrite && a.canRestock ? '<button class="btn small" data-act="stock-restock" data-p="' + esc(a.productId) + '" data-pool="' + a.pool + '">Move</button>' : '') + '</div>'; }).join('') + '</div>' : '';
      var chips = [['all', 'All'], ['dome', 'Dome'], ['online', 'Online'], ['supply', 'Supply']].map(function (c) { return '<button class="chip' + (view === c[0] ? ' on' : '') + '" data-act="stock-view" data-s="' + c[0] + '">' + c[1] + '</button>'; }).join('');
      var products = typeGroups(d.products).map(function (g) {
        return '<h3 class="rk-h">' + esc(g.type) + '</h3>' + g.items.map(function (p) {
          var sizes = unionSizes(p), cols = colourRows(p);
          var cells = cols.map(function (c) { return '<div class="rl">' + esc(c || 'Packs') + '</div>' + sizes.map(function (s) {
            if (!sizeIn(p, c, s)) return '<div class="na">—</div>';
            var r = p.skus[c + '|' + s] || { dome: 0, online: 0, supply: 0 }, n = view === 'all' ? r.dome + r.online + r.supply : r[view];
            var low = d.tracking && ((view === 'online' || view === 'all') && r.online <= d.thresholds.online && (r.dome + r.online + r.supply) > 0);
            var title = 'Dome ' + r.dome + ' · Online ' + r.online + ' · Supply ' + r.supply;
            return '<div class="scell' + (n === 0 ? ' zero' : '') + (low ? ' low' : '') + '" title="' + title + '"><b>' + n + '</b>' + (view === 'all' ? '<small>' + r.dome + '/' + r.online + '/' + r.supply + '</small>' : '') + '</div>'; }).join(''); }).join('');
          return '<details class="prod"><summary><span><b>' + esc(p.name) + '</b>' + (p.brand ? '<br><span class="sub">' + esc(p.brand) + '</span>' : '') + '</span><span class="badge ' + (poolTotal(p, view) ? 'gold' : '') + '">' + poolTotal(p, view) + ' packs</span></summary><div class="body">' +
            '<div class="scroll-x"><div class="matrix" style="' + gridStyle(sizes.length) + '">' + heads(sizes) + cells + '</div></div>' + (view === 'all' ? '<p class="hint">Each box shows the total, then Dome / Online / Supply.</p>' : '') + '</div></details>'; }).join(''); }).join('');
      var acts = S.canWrite ? '<div class="quick"><a class="btn" href="#/stock-in">Receive delivery</a><a class="btn" href="#/stock-move">Move stock</a><a class="btn" href="#/stock-count">Count stock</a></div><div class="quick"><a class="btn" href="#/plan">Plan a round</a><a class="btn" href="#/stock-sizes">Sizes</a><a class="btn" href="#/stock-history">History</a></div>' : '<div class="quick"><a class="btn" href="#/stock-history">History</a></div>';
      app.innerHTML = pageHead('Stock', 'In packs of 3, by colour and size') + track +
        '<div class="grid2 pools"><div class="card stat"><b>' + t.dome + '</b><span>Dome</span></div><div class="card stat"><b>' + t.online + '</b><span>Online</span></div><div class="card stat"><b>' + t.supply + '</b><span>Supply</span></div></div>' + alertHtml + acts + '<div class="chips">' + chips + '</div>' + products;
    }).catch(fail());
  };
  A['stock-view'] = function (t) { view = t.dataset.s; V.stock(); };
  A['stock-track-on'] = function () {
    dialog('<form method="dialog"><h2>Start tracking stock by size</h2><p class="sub">From now on, website orders take packs from the Online pool by size, and the website only shows sizes that are in stock there. Your products’ existing stock numbers are replaced by the Online pool counts.</p><p class="sub"><b>Only do this after you have counted your Online stock by size</b> (Count stock → Online). Otherwise products will show as sold out.</p><p class="err"></p><div class="actions"><button class="btn" type="button" data-close>Not yet</button><button class="btn primary" type="submit">Start tracking</button></div></form>',
      function (d, showErr) { api('/api/supply/stock/tracking', { method: 'PUT', body: { on: true, confirm: true } }).then(function () { d.close(); toast('Stock tracking is on.'); V.stock(); }).catch(fail(showErr)); });
  };
  A['stock-track-off'] = function () { api('/api/supply/stock/tracking', { method: 'PUT', body: { on: false } }).then(function () { toast('Tracking is off. The website keeps its current stock numbers and goes back to counting by colour only.'); V.stock(); }).catch(fail()); };
  A['stock-thresholds'] = function () {
    dialog('<form method="dialog"><h2>Low-stock levels</h2><p class="sub">Warn me when a size in a pool falls to this many packs or fewer.</p><div class="row2"><div class="field"><label for="lt-on">Online</label><input id="lt-on" type="number" min="0" max="100" value="' + data.thresholds.online + '"></div><div class="field"><label for="lt-su">Supply</label><input id="lt-su" type="number" min="0" max="100" value="' + data.thresholds.supply + '"></div></div><p class="err"></p><div class="actions"><button class="btn" type="button" data-close>Cancel</button><button class="btn primary" type="submit">Save</button></div></form>',
      function (d, showErr) { api('/api/supply/stock/tracking', { method: 'PUT', body: { lowOnline: $('#lt-on', d).value, lowSupply: $('#lt-su', d).value } }).then(function () { d.close(); toast('Saved.'); V.stock(); }).catch(fail(showErr)); });
  };
  A['stock-restock'] = function (t) {
    api('/api/supply/stock/alerts').then(function (al) {
      var a = al.filter(function (x) { return x.productId === t.dataset.p && x.pool === t.dataset.pool; })[0]; if (!a) return;
      form = { kind: 'move', from: 'dome', to: t.dataset.pool, cells: {}, note: 'Restock', q: '' };
      a.items.forEach(function (i) { if (i.dome > 0) form.cells[i.key] = { packs: Math.min(i.dome, 6) }; });
      location.hash = '#/stock-move'; if (location.hash === '#/stock-move') renderForm();
    }).catch(fail());
  };

  // ── FORMS: receive delivery / move / count ─────────────────────────────────
  function newForm(kind) {
    var f = { kind: kind, cells: {}, q: '', note: '', date: U.todayStr(), unit: 'packs', supplier: '' };
    if (kind === 'move') { f.from = 'dome'; f.to = 'online'; }
    if (kind === 'count') f.pool = 'online';
    return f;
  }
  function openForm(kind) { return load().then(function () { if (!form || form.kind !== kind || !form.keep) form = newForm(kind); form.keep = false; renderForm(); }).catch(fail()); }
  V['stock-in'] = function () { openForm('in'); };
  V['stock-move'] = function () { load().then(function () { if (!form || form.kind !== 'move') form = newForm('move'); renderForm(); }).catch(fail()); };
  V['stock-count'] = function () { openForm('count'); };
  function cellVal(k, f) { var c = form.cells[k]; return c && c[f] != null ? c[f] : ''; }
  function formTotal() { var t = { received: 0, expected: 0, damaged: 0, packs: 0, counted: 0 }; Object.keys(form.cells).forEach(function (k) { var c = form.cells[k]; ['received', 'expected', 'damaged', 'packs', 'counted'].forEach(function (f) { t[f] += parseInt(c[f], 10) || 0; }); }); return t; }
  function renderForm() {
    var d = data, f = form, q = f.q.toLowerCase();
    var prods = d.products.filter(function (p) { return !q || (p.name + ' ' + p.brand + ' ' + p.type).toLowerCase().indexOf(q) >= 0; });
    var title = f.kind === 'in' ? 'Receive a delivery' : f.kind === 'move' ? 'Move stock' : 'Count stock';
    var intro = f.kind === 'in' ? 'Enter what came in, by colour and size. Good stock goes into Dome.' : f.kind === 'move' ? 'Choose where stock moves from and to, then enter packs.' : 'Enter what you counted. Only the sizes you fill in are changed.';
    var top = '';
    if (f.kind === 'in') top = '<div class="card"><div class="row2"><div class="field"><label for="f-date">Date received</label><input id="f-date" type="date" value="' + esc(f.date) + '" data-in="f-date"></div><div class="field"><label for="f-sup">From (optional)</label><input id="f-sup" type="text" value="' + esc(f.supplier) + '" data-in="f-supplier"></div></div><div class="field"><label>Enter numbers in</label><div class="chips"><button class="chip' + (f.unit === 'packs' ? ' on' : '') + '" data-act="f-unit" data-s="packs">Packs</button><button class="chip' + (f.unit === 'pieces' ? ' on' : '') + '" data-act="f-unit" data-s="pieces">Pieces</button></div><div class="hint">' + (f.unit === 'pieces' ? 'Pieces are divided into packs (3 per pack).' : 'One pack = 3 pieces.') + '</div></div></div>';
    if (f.kind === 'move') top = '<div class="card"><div class="row2"><div class="field"><label for="f-from">From</label><select id="f-from" data-in="f-from">' + Object.keys(POOL).map(function (p) { return '<option value="' + p + '"' + (f.from === p ? ' selected' : '') + '>' + POOL[p] + '</option>'; }).join('') + '</select></div><div class="field"><label for="f-to">To</label><select id="f-to" data-in="f-to">' + Object.keys(POOL).map(function (p) { return '<option value="' + p + '"' + (f.to === p ? ' selected' : '') + '>' + POOL[p] + '</option>'; }).join('') + '</select></div></div><div class="field"><label for="f-note">Note (optional)</label><input id="f-note" type="text" value="' + esc(f.note) + '" data-in="f-note"></div></div>';
    if (f.kind === 'count') top = '<div class="card"><div class="field"><label for="f-pool">Which pool did you count?</label><select id="f-pool" data-in="f-pool">' + Object.keys(POOL_LONG).map(function (p) { return '<option value="' + p + '"' + (f.pool === p ? ' selected' : '') + '>' + POOL_LONG[p] + '</option>'; }).join('') + '</select></div><div class="field"><label for="f-note">Note (optional)</label><input id="f-note" type="text" value="' + esc(f.note) + '" data-in="f-note"></div></div>';
    var pool = f.kind === 'move' ? f.from : f.kind === 'count' ? f.pool : null;
    var blocks = prods.map(function (p) {
      var sizes = unionSizes(p), cols = colourRows(p), n = 0;
      Object.keys(f.cells).forEach(function (k) { if (k.indexOf(p.id + '|') === 0) { var c = f.cells[k]; n += (parseInt(c.received, 10) || 0) + (parseInt(c.packs, 10) || 0) + (parseInt(c.counted, 10) || 0); } });
      var body;
      if (f.kind === 'in') {
        body = cols.map(function (c) {
          var rows = [['expected', 'Expected'], ['received', 'Received'], ['damaged', 'Damaged']].map(function (fld) {
            return '<div class="rl sm">' + fld[1] + '</div>' + sizes.map(function (s) { if (!sizeIn(p, c, s)) return '<div class="na">—</div>'; var k = gkey(p.id, c, s);
              return '<input type="number" inputmode="numeric" min="0" step="1" placeholder="' + (fld[0] === 'expected' && cellVal(k, 'received') !== '' ? cellVal(k, 'received') : '0') + '" data-in="f-cell" data-k="' + esc(k) + '" data-f="' + fld[0] + '" data-p="' + esc(p.id) + '" aria-label="' + esc(fld[1] + ' ' + p.name + ' ' + c + ' ' + s) + '" value="' + cellVal(k, fld[0]) + '">'; }).join(''); }).join('');
          return '<p class="sub" style="margin:10px 0 0"><b>' + esc(c || 'One colour') + '</b></p><div class="scroll-x"><div class="matrix" style="' + gridStyle(sizes.length) + '">' + heads(sizes) + rows + '</div></div>'; }).join('');
      } else {
        var fld = f.kind === 'move' ? 'packs' : 'counted';
        var cells = cols.map(function (c) { return '<div class="rl">' + esc(c || 'Packs') + '</div>' + sizes.map(function (s) { if (!sizeIn(p, c, s)) return '<div class="na">—</div>'; var k = gkey(p.id, c, s), r = p.skus[c + '|' + s] || { dome: 0, online: 0, supply: 0 };
          return '<input type="number" inputmode="numeric" min="0" step="1" placeholder="' + r[pool] + '" data-in="f-cell" data-k="' + esc(k) + '" data-f="' + fld + '" data-p="' + esc(p.id) + '" aria-label="' + esc((f.kind === 'move' ? 'Packs to move: ' : 'Counted: ') + p.name + ' ' + c + ' ' + s) + '" value="' + cellVal(k, fld) + '">'; }).join(''); }).join('');
        body = '<div class="scroll-x"><div class="matrix" style="' + gridStyle(sizes.length) + '">' + heads(sizes) + cells + '</div></div><p class="hint">Faint number = ' + esc(POOL[pool]) + ' has now.</p>';
      }
      return '<details class="prod"' + (n || prods.length === 1 ? ' open' : '') + '><summary><span><b>' + esc(p.name) + '</b>' + (p.brand ? '<br><span class="sub">' + esc(p.brand) + '</span>' : '') + '</span><span class="badge ' + (n ? 'gold' : '') + '" data-badge="' + esc(p.id) + '">' + n + ' packs</span></summary><div class="body">' + body + '</div></details>';
    }).join('');
    var tot = formTotal(), label = f.kind === 'in' ? 'received' : f.kind === 'move' ? 'to move' : 'counted', num = f.kind === 'in' ? tot.received : f.kind === 'move' ? tot.packs : tot.counted;
    app.innerHTML = '<p class="no-print"><a href="#/stock">‹ Stock</a></p>' + pageHead(title, intro) + top +
      '<div class="field"><input type="search" placeholder="Search products" data-in="f-search" value="' + esc(f.q) + '" aria-label="Search products"></div>' + (blocks || '<p class="empty">No products found.</p>') +
      '<p class="err" id="f-err"></p><div class="sticky-bar"><div><b id="f-total">' + num + '</b><small id="f-label">' + label + (f.kind === 'in' && tot.damaged ? ' · ' + tot.damaged + ' damaged' : '') + '</small></div><button class="btn gold" data-act="f-save" id="f-save">' + (f.kind === 'in' ? 'Add to Dome' : f.kind === 'move' ? 'Move' : 'Check counts') + '</button></div>';
  }
  function updateFormBar(p) {
    var tot = formTotal(), f = form, num = f.kind === 'in' ? tot.received : f.kind === 'move' ? tot.packs : tot.counted;
    $('#f-total').textContent = num; $('#f-label').textContent = (f.kind === 'in' ? 'received' : f.kind === 'move' ? 'to move' : 'counted') + (f.kind === 'in' && tot.damaged ? ' · ' + tot.damaged + ' damaged' : '');
    var n = 0; Object.keys(f.cells).forEach(function (k) { if (k.indexOf(p + '|') === 0) { var c = f.cells[k]; n += (parseInt(c.received, 10) || 0) + (parseInt(c.packs, 10) || 0) + (parseInt(c.counted, 10) || 0); } });
    var b = $('[data-badge="' + CSS.escape(p) + '"]'); if (b) { b.textContent = n + ' packs'; b.className = 'badge' + (n ? ' gold' : ''); }
  }
  I['f-cell'] = function (t) {
    var k = t.dataset.k, f = t.dataset.f, c = form.cells[k] || (form.cells[k] = {});
    if (t.value === '') delete c[f]; else c[f] = Math.max(0, parseInt(t.value, 10) || 0);
    if (!Object.keys(c).length) delete form.cells[k];
    updateFormBar(t.dataset.p);
  };
  I['f-search'] = U.debounce(function (t) { form.q = t.value; renderForm(); var s = $('[data-in="f-search"]'); if (s) { s.focus(); s.setSelectionRange(s.value.length, s.value.length); } }, 250);
  I['f-date'] = function (t) { form.date = t.value; }; I['f-supplier'] = function (t) { form.supplier = t.value; }; I['f-note'] = function (t) { form.note = t.value; };
  C['f-from'] = function (t) { form.from = t.value; if (form.to === form.from) form.to = Object.keys(POOL).filter(function (p) { return p !== form.from; })[0]; renderForm(); };
  C['f-to'] = function (t) { form.to = t.value; if (form.from === form.to) form.from = Object.keys(POOL).filter(function (p) { return p !== form.to; })[0]; renderForm(); };
  C['f-pool'] = function (t) { form.pool = t.value; renderForm(); };
  A['f-unit'] = function (t) { form.unit = t.dataset.s; renderForm(); };
  function splitKey(k) { var p = k.split('|'); return { productId: p[0], colour: p[1], size: p[2] }; }
  function toPacks(n, sku) {
    if (form.unit !== 'pieces') return n;
    var pk = (data.products.filter(function (x) { return x.id === sku.productId; })[0] || {}).packSize || 3;
    if (n % pk) throw new Error(n + ' pieces do not make whole packs of ' + pk + ' (' + [sku.colour, sku.size].filter(Boolean).join(' ') + '). Enter a multiple of ' + pk + '.');
    return n / pk;
  }
  A['f-save'] = function () {
    var f = form, err = $('#f-err'); err.textContent = '';
    try {
      if (f.kind === 'in') {
        var lines = Object.keys(f.cells).map(function (k) { var c = f.cells[k], s = splitKey(k); return { productId: s.productId, colour: s.colour, size: s.size, received: toPacks(c.received || 0, s), damaged: toPacks(c.damaged || 0, s), expected: c.expected == null ? undefined : toPacks(c.expected, s) }; });
        if (!lines.some(function (l) { return l.received > 0; })) { err.textContent = 'Enter how many packs you received.'; return; }
        $('#f-save').disabled = true;
        api('/api/supply/stock/intake', { method: 'POST', body: { date: f.date, supplier: f.supplier, lines: lines } }).then(function (r) {
          var t = r.intake.totals; form = null;
          dialog('<div><h2>Delivery recorded</h2><div class="grid2"><div class="stat"><b>' + t.added + '</b><span>Added to Dome</span></div><div class="stat"><b>' + t.received + '</b><span>Received</span></div></div><p class="sub mt">Expected ' + t.expected + ' · damaged ' + t.damaged + (t.expected !== t.received ? ' · <b class="neg">difference ' + (t.received - t.expected) + '</b>' : '') + '</p><div class="actions"><button class="btn primary" data-close>Done</button></div></div>').addEventListener('close', function () { location.hash = '#/stock'; });
        }).catch(function (e) { $('#f-save').disabled = false; err.textContent = e.message; });
      } else if (f.kind === 'move') {
        var ml = Object.keys(f.cells).map(function (k) { var s = splitKey(k); return { productId: s.productId, colour: s.colour, size: s.size, packs: f.cells[k].packs || 0 }; }).filter(function (l) { return l.packs > 0; });
        if (!ml.length) { err.textContent = 'Enter the packs to move.'; return; }
        api('/api/supply/stock/transfer', { method: 'POST', body: { from: f.from, to: f.to, note: f.note, lines: ml } }).then(function (r) { toast(r.moved + ' packs moved from ' + POOL[f.from] + ' to ' + POOL[f.to] + '.'); form = null; location.hash = '#/stock'; if (location.hash === '#/stock') V.stock(); }).catch(function (e) { err.textContent = e.message; });
      } else {
        var cl = Object.keys(f.cells).map(function (k) { var s = splitKey(k); return { productId: s.productId, colour: s.colour, size: s.size, counted: f.cells[k].counted }; }).filter(function (l) { return l.counted != null; });
        if (!cl.length) { err.textContent = 'Enter at least one counted number.'; return; }
        api('/api/supply/stock/count', { method: 'POST', body: { pool: f.pool, lines: cl, note: f.note } }).then(function (r) {
          var changed = r.diffs.filter(function (x) { return x.diff; });
          var rows = r.diffs.map(function (x) { return '<div class="line"><div><div class="t">' + esc(x.productName) + '</div><div class="m">' + esc([x.colour, x.size].filter(Boolean).join(' ') || 'one size') + ' · system ' + x.system + ' → counted ' + x.counted + '</div></div><b class="' + (x.diff < 0 ? 'neg' : '') + '">' + (x.diff > 0 ? '+' : '') + x.diff + '</b></div>'; }).join('');
          var d = dialog('<div><h2>Count result</h2><p class="sub">' + (changed.length ? changed.length + ' of ' + r.diffs.length + ' sizes differ from the system.' : 'Everything matches the system.') + '</p>' + rows + '<p class="err"></p><div class="actions"><button class="btn" data-close>Back</button><button class="btn primary" data-apply>Set to counted numbers</button></div></div>');
          $('[data-apply]', d).addEventListener('click', function () {
            api('/api/supply/stock/count', { method: 'POST', body: { pool: f.pool, lines: cl, note: f.note, apply: true } }).then(function () { d.close(); toast('Stock updated to your count.'); form = null; location.hash = '#/stock'; if (location.hash === '#/stock') V.stock(); }).catch(function (e) { $('.err', d).textContent = e.message; });
          });
        }).catch(function (e) { err.textContent = e.message; });
      }
    } catch (e) { err.textContent = e.message; }
  };

  // ── HISTORY ────────────────────────────────────────────────────────────────
  var histPool = '';
  var TYPE_LABEL = { intake: 'Delivery', 'transfer-out': 'Moved out', 'transfer-in': 'Moved in', count: 'Count', 'online-sale': 'Online sale', 'online-restore': 'Order returned', 'round-load': 'Loaded on round', 'round-return': 'Returned from round', 'round-missing': 'Missing after round', supply: 'Supplied', 'take-back': 'Taken back', damaged: 'Damaged', 'online-short': 'Sold with no stock' };
  V['stock-history'] = function () {
    Promise.all([api('/api/supply/stock/movements?limit=150' + (histPool ? '&pool=' + histPool : '')), api('/api/supply/stock/intakes')]).then(function (r) {
      var mv = r[0], intakes = r[1];
      var chips = [['', 'All'], ['dome', 'Dome'], ['online', 'Online'], ['supply', 'Supply']].map(function (c) { return '<button class="chip' + (histPool === c[0] ? ' on' : '') + '" data-act="hist-pool" data-s="' + c[0] + '">' + c[1] + '</button>'; }).join('');
      app.innerHTML = '<p class="no-print"><a href="#/stock">‹ Stock</a></p>' + pageHead('Stock history') +
        (intakes.length ? '<div class="card flat"><div style="padding:14px 16px"><h3>Deliveries</h3></div>' + intakes.slice(0, 8).map(function (i) { return '<div class="line" style="padding:12px 16px"><div><div class="t">' + esc(fmtDate(i.date)) + (i.supplier ? ' · ' + esc(i.supplier) : '') + '</div><div class="m">expected ' + i.totals.expected + ' · received ' + i.totals.received + ' · damaged ' + i.totals.damaged + '</div></div><b>+' + i.totals.added + '</b></div>'; }).join('') + '</div>' : '') +
        '<div class="chips">' + chips + '</div><div class="card flat">' + (mv.length ? mv.map(function (m) { return '<div class="line" style="padding:10px 16px"><div><div class="t">' + esc(TYPE_LABEL[m.type] || m.type) + ' · ' + esc(m.productName) + '</div><div class="m">' + esc([m.colour, m.size].filter(Boolean).join(' ') || 'one size') + ' · ' + esc(POOL[m.pool]) + ' · ' + esc(new Date(m.at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })) + (m.note ? ' · ' + esc(m.note) : '') + '</div></div><b class="' + (m.delta < 0 ? 'neg' : '') + '">' + (m.delta > 0 ? '+' : '') + m.delta + '</b></div>'; }).join('') : '<p class="empty">No stock movements yet.</p>') + '</div>';
    }).catch(fail());
  };
  A['hist-pool'] = function (t) { histPool = t.dataset.s; V['stock-history'](); };

  // ── SIZES ──────────────────────────────────────────────────────────────────
  V['stock-sizes'] = function () {
    Promise.all([load(), api('/api/size-guides')]).then(function (r) {
      var d = r[0], guides = r[1], types = typeGroups(d.products);
      var guideHtml = Object.keys(guides).map(function (id) {
        var g = guides[id];
        return '<div class="card"><h3>' + esc(g.name) + '</h3><div class="field mt"><label for="sg-title-' + id + '">Heading on the website</label><input id="sg-title-' + id + '" type="text" value="' + esc(g.title) + '"></div><div class="field"><label for="sg-cols-' + id + '">Columns, separated by commas</label><input id="sg-cols-' + id + '" type="text" value="' + esc(g.columns.join(', ')) + '"></div>' +
          '<div class="field"><label for="sg-rows-' + id + '">Rows — one per line, cells separated by |</label><textarea id="sg-rows-' + id + '" rows="' + Math.min(12, g.rows.length + 1) + '">' + esc(g.rows.map(function (x) { return x.join(' | '); }).join('\n')) + '</textarea></div>' +
          '<div class="field"><label for="sg-note-' + id + '">Note under the chart (optional)</label><input id="sg-note-' + id + '" type="text" value="' + esc(g.note || '') + '"></div><p class="err" id="sg-err-' + id + '"></p><div class="actions"><button class="btn small primary" data-act="sg-save" data-id="' + id + '">Save chart</button></div></div>';
      }).join('');
      app.innerHTML = '<p class="no-print"><a href="#/stock">‹ Stock</a></p>' + pageHead('Sizes', 'A size you add here appears in deliveries, stock, rounds and on the website.') +
        '<div class="card"><h3>Add a size to a whole range</h3><div class="field"><label for="sz-type">Range</label><select id="sz-type">' + types.map(function (g) { return '<option value="' + esc(g.type) + '">' + esc(g.type) + ' (' + g.items.length + ' products)</option>'; }).join('') + '</select></div><div class="row2"><div class="field"><label for="sz-new">New size</label><input id="sz-new" type="text" placeholder="e.g. 3XL"></div><div class="field"><label for="sz-after">Place after (optional)</label><input id="sz-after" type="text" placeholder="e.g. 2XL"></div></div><p class="err" id="sz-err"></p><div class="actions"><button class="btn primary" data-act="sz-add">Add to range</button></div></div>' +
        types.map(function (g) { return '<h3 class="rk-h">' + esc(g.type) + '</h3>' + g.items.map(function (p) { var all = unionSizes(p); return '<div class="card"><div class="spaced"><div><b>' + esc(p.name) + '</b><div class="sub">' + all.map(esc).join(' · ') + '</div></div><button class="btn small" data-act="sz-edit" data-id="' + esc(p.id) + '">Edit</button></div></div>'; }).join(''); }).join('') +
        '<h2 class="mt">Size guides</h2><p class="sub">The charts customers see on the website. Type your real measurements here.</p>' + guideHtml;
    }).catch(fail());
  };
  A['sg-save'] = function (t) {
    var id = t.dataset.id, err = $('#sg-err-' + id); err.textContent = '';
    var cols = $('#sg-cols-' + id).value.split(',').map(function (x) { return x.trim(); }).filter(Boolean);
    var rows = $('#sg-rows-' + id).value.split('\n').map(function (l) { return l.split('|').map(function (c) { return c.trim(); }); }).filter(function (r) { return r[0]; });
    api('/api/supply/stock/size-guides/' + id, { method: 'PUT', body: { title: $('#sg-title-' + id).value, columns: cols, rows: rows, note: $('#sg-note-' + id).value } }).then(function () { toast('Chart saved. It is live on the website.'); }).catch(function (e) { err.textContent = e.message; });
  };
  A['sz-add'] = function () {
    var type = $('#sz-type').value, size = $('#sz-new').value.trim(), after = $('#sz-after').value.trim(), err = $('#sz-err'); err.textContent = '';
    if (!size) { err.textContent = 'Enter the new size.'; return; }
    var ids = data.products.filter(function (p) { return p.type === type; }).map(function (p) { return p.id; });
    api('/api/supply/stock/sizes', { method: 'PUT', body: { productIds: ids, mode: 'add', sizes: [size], after: after } }).then(function (r) { toast(size + ' added to ' + r.changed + ' products.'); return U.refreshData(); }).then(V['stock-sizes']).catch(function (e) { err.textContent = e.message; });
  };
  A['sz-edit'] = function (t) {
    var p = data.products.filter(function (x) { return x.id === t.dataset.id; })[0];
    dialog('<form method="dialog"><h2>' + esc(p.name) + '</h2><div class="field"><label for="sz-list">Sizes, in order, separated by commas</label><input id="sz-list" type="text" value="' + esc(unionSizes(p).join(', ')) + '"></div><p class="hint">Removing a size hides it. Stock already counted on it stays in your records.</p><p class="err"></p><div class="actions"><button class="btn" type="button" data-close>Cancel</button><button class="btn primary" type="submit">Save</button></div></form>',
      function (d, showErr) { api('/api/supply/stock/sizes', { method: 'PUT', body: { productIds: [p.id], mode: 'set', sizes: $('#sz-list', d).value } }).then(function () { d.close(); toast('Sizes saved.'); return U.refreshData(); }).then(V['stock-sizes']).catch(fail(showErr)); });
  };

  // ── ROUND PLANNER ──────────────────────────────────────────────────────────
  var planSel = null;
  V.plan = function () {
    var qs = planSel ? '?shops=' + planSel.join(',') : '';
    api('/api/supply/plan' + qs).then(function (r) {
      if (!planSel) planSel = r.chosen.slice();
      var shops = r.shops.map(function (s) {
        var why = s.reason === 'request' ? '<span class="badge gold">asked for stock</span>' : s.reason === 'revisit' ? '<span class="badge red">' + s.days + ' days</span>' : '';
        return '<label class="pick"><input type="checkbox" data-in="plan-shop" data-id="' + esc(s.shopId) + '" ' + (planSel.indexOf(s.shopId) >= 0 ? 'checked' : '') + '><span><b>' + esc(s.name) + '</b> ' + why + '<small>' + (s.lastSupplyDate ? 'last supplied ' + esc(fmtDate(s.lastSupplyDate)) : 'no supply yet') + (s.request ? ' · wants: ' + esc(s.request) : '') + '</small></span></label>'; }).join('');
      var rows = r.rows.length ? '<div class="scroll-x"><table><thead><tr><th>Item</th><th class="num">Need</th><th class="num">Supply</th><th class="num">Dome</th></tr></thead><tbody>' + r.rows.map(function (x) { return '<tr' + (x.short ? ' class="short"' : '') + '><td><b>' + esc(x.productName) + '</b><br><span class="sub">' + esc([x.colour, x.size].filter(Boolean).join(' ') || 'one size') + '</span></td><td class="num">' + x.need + '</td><td class="num">' + x.supply + '</td><td class="num">' + x.dome + '</td></tr>'; }).join('') + '</tbody></table></div>' : '<p class="empty">Pick shops to see what to bring. The plan uses what each shop usually takes.</p>';
      var short = r.rows.filter(function (x) { return x.fromDome > 0; }), still = r.rows.filter(function (x) { return x.stillShort > 0; });
      app.innerHTML = '<p class="no-print"><a href="#/stock">‹ Stock</a></p>' + pageHead('Plan a round', 'Choose the shops you will visit. Shops due a visit or waiting on stock are ticked.') + '<div class="card">' + (shops || '<p class="empty">No shops yet.</p>') + '</div>' +
        '<div class="card flat"><div style="padding:14px 16px"><h3>What you will probably need</h3><p class="hint">' + r.totalNeed + ' packs' + (r.tracking ? ' · ' + r.totalShort + ' more than the Supply pool has' : '') + '</p></div>' + rows + '</div>' +
        (still.length ? '<div class="card notice warn"><b>Not enough even with Dome:</b> ' + still.slice(0, 6).map(function (x) { return esc(x.productName) + ' ' + esc([x.colour, x.size].filter(Boolean).join(' ')) + ' (' + x.stillShort + ')'; }).join(', ') + '</div>' : '') +
        '<div class="actions no-print">' + (short.length && S.canWrite ? '<button class="btn" data-act="plan-move">Move ' + short.reduce(function (a, x) { return a + x.fromDome; }, 0) + ' packs from Dome to Supply</button>' : '') + (r.rows.length && S.canWrite ? '<button class="btn gold" data-act="plan-load">Load this as a round</button>' : '') + '</div>';
      window._plan = r;
    }).catch(fail());
  };
  C['plan-shop'] = function (t) { var i = planSel.indexOf(t.dataset.id); if (t.checked && i < 0) planSel.push(t.dataset.id); if (!t.checked && i >= 0) planSel.splice(i, 1); V.plan(); };
  A['plan-move'] = function () {
    var lines = window._plan.rows.filter(function (x) { return x.fromDome > 0; }).map(function (x) { return { productId: x.productId, colour: x.colour, size: x.size, packs: x.fromDome }; });
    api('/api/supply/stock/transfer', { method: 'POST', body: { from: 'dome', to: 'supply', note: 'Round plan', lines: lines } }).then(function (r) { toast(r.moved + ' packs moved to Supply.'); V.plan(); }).catch(fail());
  };
  A['plan-load'] = function () {
    var qty = {}; window._plan.rows.forEach(function (x) { var n = window._plan.tracking ? Math.min(x.need, x.supply) : x.need; if (n > 0) qty[U.key(x.productId, x.colour, x.size)] = n; });
    if (!Object.keys(qty).length) { toast('The Supply pool has none of these yet. Move stock from Dome first.', true); return; }
    U.openLoader(qty);
  };
})();
