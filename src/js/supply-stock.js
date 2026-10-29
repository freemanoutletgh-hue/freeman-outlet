// Supply — stock by size: read-only view of the two pools (Dome / Spintex), history, sizes, round planner.
// Changing stock (receiving a delivery, moving Dome → Spintex, counting) happens in Admin now, not here.
(function () {
  'use strict';
  var U = window.SUP, S = U.S, V = U.V, A = U.A, I = U.I, C = U.C;
  var $ = U.$, $$ = U.$$, esc = U.esc, money = U.money, fmtDate = U.fmtDate, api = U.api, app = U.app, toast = U.toast, dialog = U.dialog, pageHead = U.pageHead, W = U.W;
  var POOL = { dome: 'Dome', spintex: 'Spintex' };
  var data = null, view = 'all';
  function fail(showErr) { return function (e) { if (showErr) showErr(e.message); else toast(e.message, true); }; }
  function load() { return api('/api/supply/stock').then(function (d) { data = d; U.stockData = d; return d; }); }
  function unionSizes(p) { var seen = {}, out = []; p.colours.forEach(function (c) { c.sizes.forEach(function (s) { if (!seen[s]) { seen[s] = 1; out.push(s); } }); }); Object.keys(p.skus).forEach(function (k) { var s = k.split('|')[1]; if (!seen[s]) { seen[s] = 1; out.push(s); } }); return out; }
  function extraColours(p) { var have = p.colours.map(function (c) { return c.name; }), extra = []; Object.keys(p.skus).forEach(function (k) { var c = k.split('|')[0]; if (have.indexOf(c) < 0 && extra.indexOf(c) < 0) extra.push(c); }); return extra; }
  function colourRows(p) { return p.colours.map(function (c) { return c.name; }).concat(extraColours(p)); }
  function sizeIn(p, c, s) { var col = p.colours.filter(function (x) { return x.name === c; })[0]; return col ? col.sizes.indexOf(s) >= 0 : !!p.skus[c + '|' + s]; }
  function gridStyle(n) { return 'grid-template-columns:72px repeat(' + n + ',minmax(54px,1fr))'; }
  function heads(sizes) { return '<div></div>' + sizes.map(function (s) { return '<div class="cl">' + esc(s || 'Packs') + '</div>'; }).join(''); }
  function typeGroups(list) { var g = {}, order = []; list.forEach(function (p) { if (!g[p.type]) { g[p.type] = []; order.push(p.type); } g[p.type].push(p); }); return order.map(function (t) { return { type: t, items: g[t] }; }); }
  function poolTotal(p, pool) { return pool === 'all' ? p.totals.dome + p.totals.spintex : p.totals[pool]; }

  // ── OVERVIEW (read-only) ─────────────────────────────────────────────────────
  V.stock = function () {
    Promise.all([load(), api('/api/supply/stock/alerts')]).then(function (r) {
      var d = r[0], alerts = r[1], t = d.totals;
      var track = d.tracking
        ? '<div class="card notice"><b>Size stock is on.</b> Sales and supply rounds move these numbers, and the website only offers sizes in stock.</div>'
        : '<div class="card notice warn"><b>Size stock is off.</b> The website still uses its old stock numbers. Turning tracking on, and changing these numbers (deliveries, moves, counts), is done in Admin &rsaquo; Stock.</div>';
      var alertHtml = alerts.length ? '<div class="card"><h3>Running low in Spintex</h3>' + alerts.slice(0, 8).map(function (a) {
        return '<div class="line"><div><div class="t">' + esc(a.productName) + '</div><div class="m">' + a.items.slice(0, 6).map(function (i) { return esc(i.label) + ' ' + i.have; }).join(' · ') + (a.canRestock ? ' — Dome has stock' : ' — none in Dome') + '</div></div></div>'; }).join('') + '</div>' : '';
      var chips = [['all', 'All'], ['dome', 'Dome'], ['spintex', 'Spintex']].map(function (c) { return '<button class="chip' + (view === c[0] ? ' on' : '') + '" data-act="stock-view" data-s="' + c[0] + '">' + c[1] + '</button>'; }).join('');
      var products = typeGroups(d.products).map(function (g) {
        return '<h3 class="rk-h">' + esc(g.type) + '</h3>' + g.items.map(function (p) {
          var sizes = unionSizes(p), cols = colourRows(p);
          var cells = cols.map(function (c) { return '<div class="rl">' + esc(c || 'Packs') + '</div>' + sizes.map(function (s) {
            if (!sizeIn(p, c, s)) return '<div class="na">—</div>';
            var r = p.skus[c + '|' + s] || { dome: 0, spintex: 0 }, n = view === 'all' ? r.dome + r.spintex : r[view];
            var low = d.tracking && (view === 'spintex' || view === 'all') && r.spintex <= d.threshold && (r.dome + r.spintex) > 0;
            var title = 'Dome ' + r.dome + ' · Spintex ' + r.spintex;
            return '<div class="scell' + (n === 0 ? ' zero' : '') + (low ? ' low' : '') + '" title="' + title + '"><b>' + n + '</b>' + (view === 'all' ? '<small>' + r.dome + '/' + r.spintex + '</small>' : '') + '</div>'; }).join(''); }).join('');
          return '<details class="prod"><summary><span><b>' + esc(p.name) + '</b>' + (p.brand ? '<br><span class="sub">' + esc(p.brand) + '</span>' : '') + '</span><span class="badge ' + (poolTotal(p, view) ? 'gold' : '') + '">' + poolTotal(p, view) + ' packs</span></summary><div class="body">' +
            '<div class="scroll-x"><div class="matrix" style="' + gridStyle(sizes.length) + '">' + heads(sizes) + cells + '</div></div>' + (view === 'all' ? '<p class="hint">Each box shows the total, then Dome / Spintex.</p>' : '') + '</div></details>'; }).join(''); }).join('');
      var acts = '<div class="quick"><a class="btn" href="#/plan">Plan a round</a><a class="btn" href="#/stock-sizes">Sizes</a><a class="btn" href="#/stock-history">History</a></div>' +
        (S.canWrite ? '<p class="hint no-print">Receiving stock, moving Dome &rarr; Spintex and stock counts are done in <a href="/admin.html">Admin &rsaquo; Stock</a>.</p>' : '');
      app.innerHTML = pageHead('Stock', 'In packs of 3, by colour and size — view only') + track +
        '<div class="grid2 pools"><div class="card stat"><b>' + t.dome + '</b><span>Dome</span></div><div class="card stat"><b>' + t.spintex + '</b><span>Spintex</span></div></div>' + alertHtml + acts + '<div class="chips">' + chips + '</div>' + products;
    }).catch(fail());
  };
  A['stock-view'] = function (t) { view = t.dataset.s; V.stock(); };

  // ── HISTORY (read-only) ───────────────────────────────────────────────────
  var histPool = '';
  var TYPE_LABEL = { intake: 'Delivery', 'transfer-out': 'Moved out', 'transfer-in': 'Moved in', count: 'Count', 'spintex-sale': 'Sale', 'spintex-restore': 'Order returned', 'dome-sale': 'Sale (from Dome)', 'dome-restore': 'Order returned (to Dome)', 'round-load': 'Loaded on round', 'round-return': 'Returned from round', 'round-missing': 'Missing after round', supply: 'Supplied', 'take-back': 'Taken back', damaged: 'Damaged', 'spintex-short': 'Sold with no stock', 'dome-short': 'Sold with no stock' };
  V['stock-history'] = function () {
    Promise.all([api('/api/supply/stock/movements?limit=150' + (histPool ? '&pool=' + histPool : '')), api('/api/supply/stock/intakes')]).then(function (r) {
      var mv = r[0], intakes = r[1];
      var chips = [['', 'All'], ['dome', 'Dome'], ['spintex', 'Spintex']].map(function (c) { return '<button class="chip' + (histPool === c[0] ? ' on' : '') + '" data-act="hist-pool" data-s="' + c[0] + '">' + c[1] + '</button>'; }).join('');
      app.innerHTML = '<p class="no-print"><a href="#/stock">‹ Stock</a></p>' + pageHead('Stock history') +
        (intakes.length ? '<div class="card flat"><div style="padding:14px 16px"><h3>Deliveries</h3></div>' + intakes.slice(0, 8).map(function (i) { return '<div class="line" style="padding:12px 16px"><div><div class="t">' + esc(fmtDate(i.date)) + (i.supplier ? ' · ' + esc(i.supplier) : '') + '</div><div class="m">expected ' + i.totals.expected + ' · received ' + i.totals.received + ' · damaged ' + i.totals.damaged + '</div></div><b>+' + i.totals.added + '</b></div>'; }).join('') + '</div>' : '') +
        '<div class="chips">' + chips + '</div><div class="card flat">' + (mv.length ? mv.map(function (m) { return '<div class="line" style="padding:10px 16px"><div><div class="t">' + esc(TYPE_LABEL[m.type] || m.type) + ' · ' + esc(m.productName) + '</div><div class="m">' + esc([m.colour, m.size].filter(Boolean).join(' ') || 'one size') + ' · ' + esc(POOL[m.pool] || m.pool) + ' · ' + esc(new Date(m.at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })) + (m.note ? ' · ' + esc(m.note) : '') + '</div></div><b class="' + (m.delta < 0 ? 'neg' : '') + '">' + (m.delta > 0 ? '+' : '') + m.delta + '</b></div>'; }).join('') : '<p class="empty">No stock movements yet.</p>') + '</div>';
    }).catch(fail());
  };
  A['hist-pool'] = function (t) { histPool = t.dataset.s; V['stock-history'](); };

  // ── SIZES (still here — this is about product structure, not stock levels) ──
  V['stock-sizes'] = function () {
    Promise.all([load(), api('/api/size-guides')]).then(function (r) {
      var d = r[0], guides = r[1], types = typeGroups(d.products);
      var guideHtml = Object.keys(guides).map(function (id) {
        var g = guides[id];
        return '<div class="card"><h3>' + esc(g.name) + '</h3><div class="field mt"><label for="sg-title-' + id + '">Heading on the website</label><input id="sg-title-' + id + '" type="text" value="' + esc(g.title) + '"></div><div class="field"><label for="sg-cols-' + id + '">Columns, separated by commas</label><input id="sg-cols-' + id + '" type="text" value="' + esc(g.columns.join(', ')) + '"></div>' +
          '<div class="field"><label for="sg-rows-' + id + '">Rows — one per line, cells separated by |</label><textarea id="sg-rows-' + id + '" rows="' + Math.min(12, g.rows.length + 1) + '">' + esc(g.rows.map(function (x) { return x.join(' | '); }).join('\n')) + '</textarea></div>' +
          '<div class="field"><label for="sg-note-' + id + '">Note under the chart (optional)</label><input id="sg-note-' + id + '" type="text" value="' + esc(g.note || '') + '"></div><p class="err" id="sg-err-' + id + '"></p><div class="actions"><button class="btn small primary" data-act="sg-save" data-id="' + id + '">Save chart</button></div></div>';
      }).join('');
      app.innerHTML = '<p class="no-print"><a href="#/stock">‹ Stock</a></p>' + pageHead('Sizes', 'A size you add here appears in stock, rounds and on the website.') +
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
  // Still lives here (it's about planning a Supply round), but the "move stock from Dome" step
  // now points to Admin instead of doing the transfer itself — only Admin changes stock directly.
  var planSel = null;
  V.plan = function () {
    var qs = planSel ? '?shops=' + planSel.join(',') : '';
    api('/api/supply/plan' + qs).then(function (r) {
      if (!planSel) planSel = r.chosen.slice();
      var shops = r.shops.map(function (s) {
        var why = s.reason === 'request' ? '<span class="badge gold">asked for stock</span>' : s.reason === 'revisit' ? '<span class="badge red">' + s.days + ' days</span>' : '';
        return '<label class="pick"><input type="checkbox" data-in="plan-shop" data-id="' + esc(s.shopId) + '" ' + (planSel.indexOf(s.shopId) >= 0 ? 'checked' : '') + '><span><b>' + esc(s.name) + '</b> ' + why + '<small>' + (s.lastSupplyDate ? 'last supplied ' + esc(fmtDate(s.lastSupplyDate)) : 'no supply yet') + (s.request ? ' · wants: ' + esc(s.request) : '') + '</small></span></label>'; }).join('');
      var rows = r.rows.length ? '<div class="scroll-x"><table><thead><tr><th>Item</th><th class="num">Need</th><th class="num">Spintex</th><th class="num">Dome</th></tr></thead><tbody>' + r.rows.map(function (x) { return '<tr' + (x.short ? ' class="short"' : '') + '><td><b>' + esc(x.productName) + '</b><br><span class="sub">' + esc([x.colour, x.size].filter(Boolean).join(' ') || 'one size') + '</span></td><td class="num">' + x.need + '</td><td class="num">' + x.spintex + '</td><td class="num">' + x.dome + '</td></tr>'; }).join('') + '</tbody></table></div>' : '<p class="empty">Pick shops to see what to bring. The plan uses what each shop usually takes.</p>';
      var short = r.rows.filter(function (x) { return x.fromDome > 0; }), still = r.rows.filter(function (x) { return x.stillShort > 0; });
      app.innerHTML = '<p class="no-print"><a href="#/stock">‹ Stock</a></p>' + pageHead('Plan a round', 'Choose the shops you will visit. Shops due a visit or waiting on stock are ticked.') + '<div class="card">' + (shops || '<p class="empty">No shops yet.</p>') + '</div>' +
        '<div class="card flat"><div style="padding:14px 16px"><h3>What you will probably need</h3><p class="hint">' + r.totalNeed + ' packs' + (r.tracking ? ' · ' + r.totalShort + ' more than Spintex has' : '') + '</p></div>' + rows + '</div>' +
        (short.length ? '<div class="card notice"><b>' + short.reduce(function (a, x) { return a + x.fromDome; }, 0) + ' packs are in Dome but not Spintex.</b> Move them in <a href="/admin.html">Admin &rsaquo; Stock</a> before loading this round.</div>' : '') +
        (still.length ? '<div class="card notice warn"><b>Not enough even with Dome:</b> ' + still.slice(0, 6).map(function (x) { return esc(x.productName) + ' ' + esc([x.colour, x.size].filter(Boolean).join(' ')) + ' (' + x.stillShort + ')'; }).join(', ') + '</div>' : '') +
        '<div class="actions no-print">' + (r.rows.length && S.canWrite ? '<button class="btn gold" data-act="plan-load">Load this as a round</button>' : '') + '</div>';
      window._plan = r;
    }).catch(fail());
  };
  C['plan-shop'] = function (t) { var i = planSel.indexOf(t.dataset.id); if (t.checked && i < 0) planSel.push(t.dataset.id); if (!t.checked && i >= 0) planSel.splice(i, 1); V.plan(); };
  A['plan-load'] = function () {
    var qty = {}; window._plan.rows.forEach(function (x) { var n = window._plan.tracking ? Math.min(x.need, x.spintex) : x.need; if (n > 0) qty[U.key(x.productId, x.colour, x.size)] = n; });
    if (!Object.keys(qty).length) { toast('Spintex has none of these yet. Move stock from Dome in Admin first.', true); return; }
    U.openLoader(qty);
  };
})();
