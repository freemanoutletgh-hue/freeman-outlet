// Supply — core: helpers, sign-in, router, home (To do), rounds and the shop-visit flow (with swaps).
// Other files register their own views on window.SUP: supply-money.js and supply-insight.js.
(function () {
  'use strict';
  var TOKEN_KEY = 'freeman_admin_token', DRAFT_KEY = 'supply_visit_draft', QUEUE_KEY = 'supply_pending', CACHE_KEY = 'supply_cache';
  var token = '';
  try { token = localStorage.getItem(TOKEN_KEY) || ''; } catch (e) {}
  var app = document.getElementById('app');
  var S = { me: null, canWrite: true, offline: false, products: [], shops: [], priceList: [], prices: {}, round: null, standardPrice: null, vatRate: 20, settings: {}, todoCount: 0 };
  var V = {}, A = {}, I = {}, C = {};           // views, click actions, input handlers, change handlers
  var visit = null;
  var loader = null;

  // ── helpers ────────────────────────────────────────────────────────────────
  function $(s, el) { return (el || document).querySelector(s); }
  function $$(s, el) { return Array.prototype.slice.call((el || document).querySelectorAll(s)); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function money(n) { return 'GH₵' + Number(n || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function r2(n) { return Math.round((Number(n) || 0) * 100) / 100; }
  function todayStr() { return new Date().toISOString().slice(0, 10); }
  function fmtDate(s) { return s ? new Date(s + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : ''; }
  function addDays(s, n) { var d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
  function daysBetween(a, b) { return Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 86400000); }
  function toast(msg, isErr) { var t = $('#toast'); t.textContent = msg; t.className = 'toast show' + (isErr ? ' error' : ''); clearTimeout(toast._t); toast._t = setTimeout(function () { t.className = 'toast'; }, 3400); }
  function lsGet(k, d) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function lsDel(k) { try { localStorage.removeItem(k); } catch (e) {} }
  function api(path, opts) {
    opts = opts || {};
    var headers = {}; if (!opts.form) headers['Content-Type'] = 'application/json';
    if (token) headers.Authorization = 'Bearer ' + token;
    return fetch(path, { method: opts.method || 'GET', headers: headers, body: opts.form ? opts.form : (opts.body ? JSON.stringify(opts.body) : undefined) }).then(function (r) {
      if (r.status === 401) { token = ''; lsDel(TOKEN_KEY); renderLogin(); throw new Error('Please sign in again.'); }
      if (opts.raw) return r;
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (j === null && r.ok) return null;
        j = j || {};
        if (!r.ok || j.success === false) throw new Error(j.message || j.error || 'Something went wrong.');
        return j;
      });
    }, function () { var e = new Error('No signal. Your entries are kept on this phone.'); e.network = true; throw e; });
  }
  function colourName(v) { return typeof v === 'string' ? v : (v && (v.color || v.name)) || ''; }
  function coloursOf(p) { var c = (p.variants || []).map(colourName).filter(Boolean); return c.length ? c : ['']; }
  function sizesOf(p, colour) {
    var v = (p.variants || []).filter(function (x) { return colourName(x) === colour; })[0];
    var s = (v && typeof v === 'object' && Array.isArray(v.sizes) && v.sizes.length) ? v.sizes : (p.sizes || []);
    return s.length ? s : [''];
  }
  function unionSizes(p, colours) { var seen = {}, out = []; colours.forEach(function (c) { sizesOf(p, c).forEach(function (s) { if (!seen[s]) { seen[s] = 1; out.push(s); } }); }); return out; }
  function key(pid, c, s) { return pid + '|' + (c || '') + '|' + (s || ''); }
  function productById(id) { return S.products.filter(function (p) { return p.id === id; })[0]; }
  function priceOf(pid) { var v = S.prices[pid]; return v == null ? null : v; }
  function skuLabel(l) { return [l.colour, l.size].filter(Boolean).join(' ') || 'One size'; }
  function shopById(id) { return S.shops.filter(function (s) { return s.id === id; })[0]; }
  function descOf(pid) { var p = S.priceList.filter(function (x) { return x.id === pid; })[0]; return (p && p.desc) || (p && p.name) || ''; }
  function companyHead() {
    var c = S.settings || {};
    return '<div class="company"><b>' + esc(c.companyName || '') + '</b><br>' + esc(c.companyAddress || '') + '<br>' + esc([c.companyTel && 'Tel: ' + c.companyTel, c.companyMobile && 'Mobile: ' + c.companyMobile].filter(Boolean).join(' · ')) + (c.tin ? '<br>TIN: ' + esc(c.tin) : '') + '</div>';
  }
  function W(html) { return S.canWrite ? html : ''; }
  function packs(n) { return n + (n === 1 ? ' pack' : ' packs'); }
  function clamp(n, max) { n = parseInt(n, 10); if (isNaN(n) || n < 0) n = 0; return Math.min(n, max == null ? 1e6 : max); }
  function dialog(html, onSubmit) {
    var dlg = document.createElement('dialog'); dlg.innerHTML = html;
    document.body.appendChild(dlg); dlg.showModal();
    dlg.addEventListener('close', function () { dlg.remove(); });
    $$('[data-close]', dlg).forEach(function (b) { b.addEventListener('click', function () { dlg.close(); }); });
    var form = $('form', dlg);
    if (form && onSubmit) form.addEventListener('submit', function (e) { e.preventDefault(); onSubmit(dlg, function (msg) { var el = $('.err', dlg); if (el) el.textContent = msg; }); });
    return dlg;
  }
  function askReason(title, cb) {
    return dialog('<form method="dialog"><h2>' + esc(title) + '</h2><div class="field mt"><label for="rsn">Reason</label><input id="rsn" type="text" required></div><p class="err"></p><div class="actions"><button class="btn" type="button" data-close>Cancel</button><button class="btn danger" type="submit">Confirm</button></div></form>',
      function (d, showErr) { var v = $('#rsn', d).value.trim(); if (!v) return showErr('Please give a reason.'); cb(v, function () { d.close(); }, showErr); });
  }
  function pageHead(title, sub, extra) { return '<div class="page-head"><div><h1>' + esc(title) + '</h1>' + (sub ? '<p class="sub">' + sub + '</p>' : '') + '</div>' + (extra || '') + '</div>'; }
  var debounce = function (fn, ms) { var t; return function () { var a = arguments, c = this; clearTimeout(t); t = setTimeout(function () { fn.apply(c, a); }, ms); }; };

  // ── data ───────────────────────────────────────────────────────────────────
  function applyData(d) { S.products = d.products; S.shops = d.shops; S.priceList = d.priceList; S.prices = d.prices; S.round = d.round; S.settings = d.settings; S.standardPrice = d.standardPrice; S.vatRate = d.vatRate; }
  function refreshData() {
    return Promise.all([S.canWrite ? api('/api/admin/all-products') : Promise.resolve(S.products), api('/api/supply/shops'), api('/api/supply/prices'), api('/api/supply/rounds/current'), api('/api/supply/settings'), api('/api/supply/todo/count').catch(function () { return { count: 0 }; })]).then(function (r) {
      S.products = r[0] || []; S.shops = r[1]; S.round = r[3]; S.settings = r[4]; S.todoCount = r[5].count;
      S.standardPrice = r[2].standardPrice; S.vatRate = r[2].vatRate; S.priceList = r[2].products;
      S.prices = {}; r[2].products.forEach(function (p) { if (p.effectivePrice != null) S.prices[p.id] = p.effectivePrice; });
      S.offline = false;
      lsSet(CACHE_KEY, { products: S.products, shops: S.shops, priceList: S.priceList, prices: S.prices, round: S.round, settings: S.settings, standardPrice: S.standardPrice, vatRate: S.vatRate, at: Date.now() });
      updateBadge();
    });
  }
  function updateBadge() { var a = $('#bottomnav a[data-nav="more"]'); if (a) a.setAttribute('data-count', S.todoCount > 0 ? S.todoCount : ''); }

  // ── sign-in / boot ─────────────────────────────────────────────────────────
  function renderLogin() {
    $('#bottomnav').hidden = true;
    app.innerHTML = '<div class="card login"><h1>Sign in</h1><p class="sub">Owner, manager or viewer account.</p><form id="loginForm" class="mt"><div class="field"><label for="lu">Username</label><input id="lu" type="text" autocomplete="username" required></div>' +
      '<div class="field"><label for="lp">Password</label><input id="lp" type="password" autocomplete="current-password" required></div><p class="err" id="lerr"></p><button class="btn primary block" type="submit">Sign in</button></form></div>';
    $('#loginForm').addEventListener('submit', function (e) {
      e.preventDefault();
      fetch('/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: $('#lu').value.trim(), password: $('#lp').value }) })
        .then(function (r) { return r.json(); }).then(function (d) {
          if (!d.token) { $('#lerr').textContent = d.error || 'Wrong username or password.'; return; }
          token = d.token; lsSet(TOKEN_KEY, token); boot();
        }).catch(function () { $('#lerr').textContent = 'No signal. Try again.'; });
    });
  }
  function buildNav() {
    var items = S.canWrite ? [['home', '#/', 'Home'], ['round', '#/round', 'Round'], ['owed', '#/owed', 'Money'], ['shops', '#/shops', 'Shops'], ['more', '#/more', 'More']]
                           : [['home', '#/', 'Home'], ['owed', '#/owed', 'Money'], ['rankings', '#/rankings', 'Rankings'], ['stock', '#/stock', 'Stock'], ['more', '#/more', 'More']];
    var tl = $('.toplink'); if (tl && !S.canWrite) tl.hidden = true;
    $('#bottomnav').innerHTML = items.map(function (i) { return '<a href="' + i[1] + '" data-nav="' + i[0] + '">' + i[2] + '</a>'; }).join('');
    $('#bottomnav').hidden = false; updateBadge();
  }
  function boot() {
    if (!token) return renderLogin();
    api('/api/admin/me').then(function (me) {
      S.me = me; S.canWrite = ['owner', 'manager'].indexOf(me.role) >= 0;
      if (['owner', 'manager', 'viewer'].indexOf(me.role) < 0) { app.innerHTML = '<div class="card center"><h1>Not allowed</h1><p class="sub">This account cannot open Supply.</p></div>'; return; }
      return refreshData().then(start);
    }).catch(function (e) {
      if (e.network) { var c = lsGet(CACHE_KEY, null); if (c && token) { applyData(c); S.offline = true; S.canWrite = true; start(); return; } }
      if (token) app.innerHTML = '<div class="card center"><p class="err">' + esc(e.message) + '</p><button class="btn" data-act="reload">Try again</button></div>';
    });
  }
  function start() {
    buildNav();
    window.removeEventListener('hashchange', route); window.addEventListener('hashchange', route);
    window.removeEventListener('online', flushQueue); window.addEventListener('online', flushQueue);
    route(); flushQueue();
  }

  // ── router ─────────────────────────────────────────────────────────────────
  var NAVMAP = { visit: 'home', pickup: 'owed', receivables: 'owed', tax: 'supplies', supply: 'supplies', shop: 'shops', 'stock-in': 'stock', 'stock-move': 'stock', 'stock-count': 'stock', 'stock-history': 'stock', 'stock-sizes': 'stock', plan: 'stock' };
  function route() {
    var h = (location.hash || '#/').replace(/^#/, ''), parts = h.split('/').filter(Boolean), name = parts[0] || 'home';
    var nav = NAVMAP[name] || name;
    if (!$('#bottomnav a[data-nav="' + nav + '"]')) nav = 'more';
    $$('#bottomnav a').forEach(function (a) { a.classList.toggle('active', a.dataset.nav === nav); });
    window.scrollTo(0, 0);
    var writeOnly = { round: 1, visit: 1, pickup: 1 };
    if (!S.canWrite && writeOnly[name]) { location.hash = '#/'; return; }
    if (V[name]) return V[name](parts);
    location.hash = '#/';
  }
  document.addEventListener('visibilitychange', function () { if (!document.hidden && token && S.me) refreshData().catch(function () {}); });

  // ── offline queue + draft ──────────────────────────────────────────────────
  function queue() { return lsGet(QUEUE_KEY, []); }
  function flushQueue() {
    var q = queue(); if (!q.length || !token) return Promise.resolve();
    var next = q[0];
    return api('/api/supply/supplies', { method: 'POST', body: next.payload }).then(function () { return true; }, function (e) {
      if (e.network) return null;
      if (/already recorded/.test(e.message)) return true;
      next.error = e.message; lsSet(QUEUE_KEY, q); return false;
    }).then(function (done) {
      if (done === null) return;
      var cur = queue(); if (done) cur.shift(); else cur.push(cur.shift());
      lsSet(QUEUE_KEY, cur);
      if (done) { toast('A supply saved on your phone was sent.'); return refreshData().then(function () { return cur.length ? flushQueue() : null; }); }
    });
  }
  function saveDraft() { if (visit && visit.step < 5) lsSet(DRAFT_KEY, visit); }
  function clearDraft() { lsDel(DRAFT_KEY); }

  // ── HOME ───────────────────────────────────────────────────────────────────
  var TODO_LABEL = { stock_request: 'Stock request', cheque_ready: 'Cheque ready', cheque_deposit: 'Pay in cheque', cheque_clear: 'Chase clearing', revisit: 'Re-visit', overdue: 'Overdue', tax_invoice: 'Tax invoice', low_stock: 'Low stock', call: 'Call', backup: 'Backup' };
  function todoAction(i) {
    if (!S.canWrite) return '';
    var b = function (act, label, extra) { return '<button class="btn small" data-act="' + act + '" ' + (extra || '') + '>' + label + '</button>'; };
    if (i.type === 'revisit') return b('todo-visit', 'Visit', 'data-id="' + esc(i.shopId) + '"');
    if (i.type === 'stock_request') return b('todo-visit', 'Visit', 'data-id="' + esc(i.shopId) + '"') + b('call-done', 'Done', 'data-id="' + esc(i.callId) + '"');
    if (i.type === 'cheque_ready') return b('todo-pickup', 'Pick up', 'data-id="' + esc(i.shopId) + '"');
    if (i.type === 'cheque_deposit' || i.type === 'cheque_clear') return '<a class="btn small" href="#/cheques">Update</a>';
    if (i.type === 'overdue') return b('todo-pay', 'Payment', 'data-id="' + esc(i.supplyId) + '"');
    if (i.type === 'tax_invoice') return '<a class="btn small" href="#/tax/' + esc(i.supplyId) + '">Open</a>';
    if (i.type === 'backup') return b('backup', 'Download');
    if (i.type === 'call') return b('call-done', 'Done', 'data-id="' + esc(i.callId) + '"');
    if (i.type === 'low_stock') return '<a class="btn small" href="#/stock">Open</a>';
    return '';
  }
  V.home = function () {
    var draft = S.canWrite ? lsGet(DRAFT_KEY, null) : null, q = queue();
    Promise.all([api('/api/supply/supplies'), api('/api/supply/todo')]).then(function (r) {
      var list = r[0], todo = r[1]; S.todoCount = todo.count; updateBadge();
      var ym = todayStr().slice(0, 7), year = todayStr().slice(0, 4);
      var real = list.filter(function (s) { return !s.kind || s.kind === 'supply'; });
      var month = real.filter(function (s) { return s.date.slice(0, 7) === ym; }), yr = real.filter(function (s) { return s.date.slice(0, 4) === year; });
      var sum = function (a) { return a.reduce(function (t, s) { return t + s.amount; }, 0); };
      var rd = S.round, banner = '';
      if (S.settings.practice) banner += '<div class="card notice"><b>Practice mode is on.</b> Everything you enter is practice only, kept apart from your real records.</div>';
      if (S.offline) banner += '<div class="card notice"><b>No signal.</b> You can still do a shop visit. It will send when the signal returns.</div>';
      if (q.length) banner += '<div class="card notice"><b>' + q.length + ' supply saved on this phone, waiting to send.</b>' + (q[0].error ? '<div class="err">' + esc(q[0].error) + '</div>' : '') + '<div class="actions"><button class="btn small" data-act="retry-queue">Send now</button></div></div>';
      if (draft) banner += '<div class="card notice"><b>You have a shop visit in progress' + (draft.shopId && shopById(draft.shopId) ? ' (' + esc(shopById(draft.shopId).name) + ')' : '') + '.</b><div class="actions"><button class="btn small primary" data-act="draft-continue">Continue</button><button class="btn small" data-act="draft-discard">Discard</button></div></div>';
      var items = todo.items.filter(function (i) { return !i.info; });
      var todoHtml = items.length ? '<div class="card flat"><div class="spaced" style="padding:14px 16px"><h2>To do</h2><span class="badge gold">' + items.length + '</span></div>' +
        items.slice(0, 12).map(function (i) { return '<div class="todo"><div><span class="badge">' + esc(TODO_LABEL[i.type] || i.type) + '</span><div class="t">' + esc(i.text) + '</div></div><div class="todo-act">' + todoAction(i) + '</div></div>'; }).join('') +
        (items.length > 12 ? '<p class="sub" style="padding:8px 16px">and ' + (items.length - 12) + ' more — see the Money and More pages.</p>' : '') + '</div>'
        : '<div class="card"><h2>To do</h2><p class="sub">Nothing needs your attention right now.</p></div>';
      var roundCard = !S.canWrite ? '' : rd
        ? '<div class="card"><div class="spaced"><h2>Round open</h2><span class="badge gold">since ' + esc(fmtDate(rd.date)) + '</span></div><div class="grid2 mt"><div class="stat"><b>' + rd.remainingTotal + '</b><span>Packs you carry</span></div><div class="stat"><b>' + rd.suppliedTotal + ' / ' + rd.loadedTotal + '</b><span>Supplied / loaded</span></div></div><div class="actions"><a class="btn gold" href="#/visit">Visit a shop</a><a class="btn" href="#/round">Round details</a></div></div>'
        : '<div class="card"><h2>No round open</h2><p class="sub">Load the stock you are taking out, then visit shops.</p><div class="actions"><a class="btn gold" href="#/round">Load a round</a></div></div>';
      var quick = S.canWrite ? '<div class="quick"><button class="btn" data-act="new-call">Log a call</button><a class="btn" href="#/pickup">Pick up a cheque</a><button class="btn" data-act="pay-any">Record payment</button></div>' : '';
      var recent = list.slice(0, 6).map(function (s) { return '<tr class="click" data-act="open-supply" data-id="' + esc(s.id) + '"><td>' + esc(fmtDate(s.date)) + '</td><td><b>' + esc(s.invoiceNo) + '</b><br><span class="sub">' + esc(s.shopName) + '</span></td><td class="num">' + money(s.amount) + '</td></tr>'; }).join('');
      app.innerHTML = pageHead('Supply', esc(fmtDate(todayStr()))) + banner + todoHtml + roundCard + quick +
        '<div class="grid2"><div class="card stat"><b>' + money(sum(month)) + '</b><span>Supplied this month (' + month.length + ')</span></div><div class="card stat"><b>' + money(sum(yr)) + '</b><span>Supplied this year (' + yr.length + ')</span></div></div>' +
        '<div class="card flat"><div class="spaced" style="padding:14px 16px"><h3>Recent</h3><a class="btn small" href="#/supplies">All supplies</a></div>' + (recent ? '<div class="scroll-x"><table><tbody>' + recent + '</tbody></table></div>' : '<p class="empty">No supplies recorded yet.</p>') + '</div>';
    }).catch(function (e) {
      if (e.network) { app.innerHTML = pageHead('Supply', 'No signal') + '<div class="card notice"><b>No signal.</b> You can still do a shop visit.</div>' + (S.round ? '<div class="card"><h2>Round open</h2><p class="sub">' + S.round.remainingTotal + ' packs carried.</p><div class="actions"><a class="btn gold" href="#/visit">Visit a shop</a></div></div>' : '') + (draft ? '<div class="card notice"><b>Visit in progress.</b><div class="actions"><button class="btn small primary" data-act="draft-continue">Continue</button></div></div>' : ''); }
      else toast(e.message, true);
    });
  };
  A['draft-continue'] = function () { visit = lsGet(DRAFT_KEY, null); if (!visit) return; location.hash = '#/visit'; renderVisit(); };
  A['draft-discard'] = function () { clearDraft(); visit = null; V.home(); };
  A['retry-queue'] = function () { flushQueue().then(V.home); };
  A['todo-visit'] = function (t) { if (!S.round) { toast('Load a round first.', true); location.hash = '#/round'; return; } visit = newVisit(); visit.shopId = t.dataset.id; visit.step = 2; location.hash = '#/visit'; renderVisit(); };
  A.reload = boot;
  A['open-supply'] = function (t) { location.hash = '#/supply/' + t.dataset.id; };
  A.print = function () { window.print(); };

  // ── ROUND ──────────────────────────────────────────────────────────────────
  var pendingLoader = false;
  function loadStockInfo() { if (S.stockChecked) return; S.stockChecked = true; api('/api/supply/stock').then(function (o) { S.stockInfo = o; if (loader && o.tracking && !Object.keys(loader.qty).length) renderLoader(); }).catch(function () {}); }
  function openLoader(qty) { loader = { qty: qty || {}, q: '', mode: S.round ? 'add' : 'create' }; pendingLoader = true; if ((location.hash || '') === '#/round') route(); else location.hash = '#/round'; }
  V.round = function () {
    var r = S.round;
    if (pendingLoader) { pendingLoader = false; loadStockInfo(); return renderLoader(); }
    if (!r) { loader = { qty: {}, q: '', mode: 'create' }; loadStockInfo(); return renderLoader(); }
    var groups = {};
    r.lines.forEach(function (l) { (groups[l.productId] = groups[l.productId] || { name: l.productName, l: [] }).l.push(l); });
    var rows = Object.keys(groups).map(function (id) {
      var g = groups[id], tot = g.l.reduce(function (a, l) { return { loaded: a.loaded + l.loaded, left: a.left + l.remaining }; }, { loaded: 0, left: 0 });
      var detail = g.l.map(function (l) { return '<div class="line"><div><div class="t">' + esc(skuLabel(l)) + '</div><div class="m">loaded ' + l.loaded + ' · supplied ' + l.supplied + (l.takenBack ? ' · taken back ' + l.takenBack : '') + '</div></div><b>' + l.remaining + ' left</b></div>'; }).join('');
      return '<details class="prod"><summary><span><b>' + esc(g.name) + '</b><br><span class="sub">' + tot.left + ' left of ' + tot.loaded + '</span></span></summary><div class="body">' + detail + '</div></details>';
    }).join('');
    app.innerHTML = pageHead('Round', 'Opened ' + esc(fmtDate(r.date)) + ' · ' + r.remainingTotal + ' packs left of ' + r.loadedTotal + (r.takenBackTotal ? ' · ' + r.takenBackTotal + ' taken back' : '')) + rows +
      '<div class="actions"><button class="btn" data-act="round-add">Add stock to round</button><button class="btn danger" data-act="round-close">Close round</button></div>';
  };
  function renderLoader() {
    var isAdd = loader.mode === 'add', q = loader.q.toLowerCase();
    var prods = S.products.filter(function (p) { return !q || (p.name + ' ' + (p.brand || '')).toLowerCase().indexOf(q) >= 0; });
    var cards = prods.map(function (p) {
      var cols = coloursOf(p), sizes = unionSizes(p, cols);
      var head = '<div></div>' + sizes.map(function (s) { return '<div class="cl">' + esc(s || 'Packs') + '</div>'; }).join('');
      var cells = cols.map(function (c) {
        return '<div class="rl">' + esc(c) + '</div>' + sizes.map(function (s) {
          if (sizesOf(p, c).indexOf(s) < 0) return '<div class="na">—</div>';
          var k = key(p.id, c, s);
          return '<input type="number" inputmode="numeric" min="0" step="1" placeholder="0" data-in="load" data-k="' + esc(k) + '" data-p="' + esc(p.id) + '" aria-label="' + esc(p.name + ' ' + c + ' ' + s) + '" value="' + (loader.qty[k] || '') + '">';
        }).join('');
      }).join('');
      var n = Object.keys(loader.qty).reduce(function (a, k) { return a + (k.indexOf(p.id + '|') === 0 ? loader.qty[k] : 0); }, 0);
      var sp = S.stockInfo && S.stockInfo.tracking ? S.stockInfo.products.filter(function (x) { return x.id === p.id; })[0] : null;
      return '<details class="prod"' + (n || prods.length === 1 ? ' open' : '') + '><summary><span><b>' + esc(p.name) + '</b>' + (p.brand ? '<br><span class="sub">' + esc(p.brand) + '</span>' : '') + (sp ? '<br><span class="sub">Supply pool: ' + sp.totals.supply + ' packs</span>' : '') + '</span><span class="badge ' + (n ? 'gold' : '') + '" data-badge="' + esc(p.id) + '">' + n + ' packs</span></summary>' +
        '<div class="body"><div class="scroll-x"><div class="matrix" style="grid-template-columns:72px repeat(' + sizes.length + ',minmax(54px,1fr))">' + head + cells + '</div></div></div></details>';
    }).join('');
    var total = Object.keys(loader.qty).reduce(function (a, k) { return a + loader.qty[k]; }, 0);
    app.innerHTML = pageHead(isAdd ? 'Add to round' : 'Load a round', 'Enter the packs you are taking out, by colour and size.') +
      '<div class="field"><input type="search" placeholder="Search products" data-in="load-search" value="' + esc(loader.q) + '" aria-label="Search products"></div>' +
      '<div class="actions no-print" style="margin:0 0 12px"><button class="btn small" data-act="round-copy">Copy last round</button></div>' + (cards || '<p class="empty">No products found.</p>') +
      '<div class="sticky-bar"><div><b id="loadTotal">' + total + '</b><small>packs to ' + (isAdd ? 'add' : 'take out') + '</small></div><button class="btn gold" data-act="round-save">' + (isAdd ? 'Add to round' : 'Start round') + '</button></div>';
  }
  A['round-add'] = function () { loader = { qty: {}, q: '', mode: 'add' }; renderLoader(); };
  A['round-copy'] = function () {
    api('/api/supply/rounds').then(function (list) {
      var last = list.filter(function (r) { return r.status === 'closed'; })[0]; if (!last) return toast('No earlier round to copy.', true);
      loader.qty = {}; last.lines.forEach(function (l) { if (l.loaded > 0 && productById(l.productId)) loader.qty[key(l.productId, l.colour, l.size)] = l.loaded; });
      renderLoader(); toast('Copied from ' + fmtDate(last.date) + '. Adjust as needed.');
    }).catch(function (e) { toast(e.message, true); });
  };
  A['round-save'] = function () {
    var lines = Object.keys(loader.qty).filter(function (k) { return loader.qty[k] > 0; }).map(function (k) { var p = k.split('|'); return { productId: p[0], colour: p[1], size: p[2], packs: loader.qty[k] }; });
    if (!lines.length) return toast('Enter at least one pack.', true);
    var add = loader.mode === 'add';
    api(add ? '/api/supply/rounds/' + S.round.id + '/add' : '/api/supply/rounds', { method: 'POST', body: { lines: lines } }).then(function (r) {
      S.round = r.round; toast(add ? 'Added to your round.' : 'Round started.'); loader = null; location.hash = '#/round'; V.round();
    }).catch(function (e) { toast(e.message, true); });
  };
  A['round-close'] = function () {
    var r = S.round, lines = r.lines.filter(function (l) { return l.remaining > 0; });
    var body = lines.length ? lines.map(function (l) {
      var k = key(l.productId, l.colour, l.size);
      return '<div class="line"><div><div class="t">' + esc(l.productName) + '</div><div class="m">' + esc(skuLabel(l)) + ' · ' + l.remaining + ' left</div></div><div class="stepper"><button type="button" data-act="ret-minus" data-k="' + esc(k) + '" aria-label="Fewer">−</button><input type="number" inputmode="numeric" min="0" max="' + l.remaining + '" value="' + l.remaining + '" data-in="ret" data-k="' + esc(k) + '" data-max="' + l.remaining + '"><button type="button" data-act="ret-plus" data-k="' + esc(k) + '" aria-label="More">+</button></div></div>';
    }).join('') : '<p class="empty">Everything was supplied. Nothing to return.</p>';
    app.innerHTML = pageHead('Close round', 'How many packs of each are you bringing back?') + '<div class="card">' + body + '</div><p class="hint">Anything not returned is reported as missing.</p><div class="actions"><button class="btn" data-act="round-cancel-close">Back</button><button class="btn primary" data-act="round-confirm-close">Close round</button></div>';
  };
  A['round-cancel-close'] = function () { V.round(); };
  A['round-confirm-close'] = function () {
    var returned = $$('input[data-in="ret"]').map(function (i) { var p = i.dataset.k.split('|'); return { productId: p[0], colour: p[1], size: p[2], packs: parseInt(i.value, 10) || 0 }; });
    api('/api/supply/rounds/' + S.round.id + '/close', { method: 'POST', body: { returned: returned } }).then(function (r) {
      S.round = null;
      app.innerHTML = pageHead('Round closed') + '<div class="card">' + (r.missing.length ? '<h3>Missing (not supplied, not returned)</h3>' + r.missing.map(function (m) { return '<div class="line"><div class="t">' + esc(m.productName) + ' — ' + esc(skuLabel(m)) + '</div><b class="err">' + m.packs + ' packs</b></div>'; }).join('') : '<p>Everything is accounted for.</p>') + '</div><div class="actions"><a class="btn primary" href="#/">Home</a></div>';
    }).catch(function (e) { toast(e.message, true); });
  };
  A['ret-minus'] = A['ret-plus'] = function (t) { var ri = t.closest('.stepper').querySelector('input'); ri.value = clamp(parseInt(ri.value, 10) + (t.dataset.act === 'ret-plus' ? 1 : -1), parseInt(ri.dataset.max, 10)); };
  I.load = function (t) {
    var n = clamp(t.value); if (n > 0) loader.qty[t.dataset.k] = n; else delete loader.qty[t.dataset.k];
    var total = 0, pn = 0; Object.keys(loader.qty).forEach(function (kk) { total += loader.qty[kk]; if (kk.indexOf(t.dataset.p + '|') === 0) pn += loader.qty[kk]; });
    $('#loadTotal').textContent = total; var b = $('[data-badge="' + CSS.escape(t.dataset.p) + '"]'); if (b) { b.textContent = pn + ' packs'; b.className = 'badge' + (pn ? ' gold' : ''); }
  };
  I['load-search'] = debounce(function (t) { loader.q = t.value; renderLoader(); var s = $('[data-in="load-search"]'); if (s) { s.focus(); s.setSelectionRange(s.value.length, s.value.length); } }, 250);
  I.ret = function (t) { t.value = clamp(t.value, parseInt(t.dataset.max, 10)); };

  // ── VISIT (at the shop) ────────────────────────────────────────────────────
  function newVisit() { return { step: 1, shopId: '', shelf: {}, give: {}, touched: {}, takeBack: {}, par: 1, showAll: false, invoiceNo: '', date: todayStr(), notes: '', q: '', tq: '' }; }
  function roundLines() { return S.round ? S.round.lines.filter(function (l) { return l.remaining > 0; }) : []; }
  function suggest() {
    S.round.lines.forEach(function (l) {
      var k = key(l.productId, l.colour, l.size); if (visit.touched[k]) return;
      var has = visit.shelf[k] || 0;
      visit.give[k] = (has > 0 || l.remaining <= 0) ? 0 : Math.min(visit.par, l.remaining);
    });
  }
  function summary() {
    var groups = {}, packs = 0, sub = 0, missing = [];
    S.round.lines.forEach(function (l) {
      var k = key(l.productId, l.colour, l.size), n = visit.give[k] || 0; if (n <= 0) return;
      var price = priceOf(l.productId);
      var g = groups[l.productId] = groups[l.productId] || { id: l.productId, name: descOf(l.productId) || l.productName, packs: 0, amount: 0, price: price, lines: [] };
      var amt = price == null ? 0 : r2(n * price);
      g.packs += n; g.amount = r2(g.amount + amt); g.lines.push({ label: skuLabel(l), packs: n, price: price, l: l });
      packs += n; sub = r2(sub + amt); if (price == null && missing.indexOf(l.productId) < 0) missing.push(l.productId);
    });
    var back = {}, bpacks = 0, btotal = 0;
    Object.keys(visit.takeBack).forEach(function (k) {
      var n = visit.takeBack[k]; if (!(n > 0)) return; var p = k.split('|'), prod = productById(p[0]); if (!prod) return;
      var price = priceOf(p[0]); if (price == null && missing.indexOf(p[0]) < 0) missing.push(p[0]);
      var g = back[p[0]] = back[p[0]] || { id: p[0], name: descOf(p[0]) || prod.name, packs: 0, amount: 0, price: price, lines: [] };
      var amt = price == null ? 0 : r2(n * price);
      g.packs += n; g.amount = r2(g.amount + amt); g.lines.push({ label: [p[1], p[2]].filter(Boolean).join(' ') || 'One size', packs: n, price: price, key: k });
      bpacks += n; btotal = r2(btotal + amt);
    });
    var net = r2(sub - btotal);
    return { groups: Object.keys(groups).map(function (k) { return groups[k]; }), back: Object.keys(back).map(function (k) { return back[k]; }), packs: packs, backPacks: bpacks, given: sub, backTotal: btotal, net: net,
      vat: net > 0 ? r2(net - r2(net / (1 + S.vatRate / 100))) : 0, missingPrice: missing };
  }
  function totalsHtml(total, vat, rate, parts) {
    return '<div class="invtotals"><div class="grand"><span>TOTAL (VAT included)</span><b>' + money(total) + '</b></div><div class="vatparts"><span>Includes VAT ' + rate + '%: ' + money(vat) + '</span></div>' +
      (parts && parts.length ? '<div class="vatparts"><span>' + parts.map(function (p) { return esc(p.label) + ' ' + p.rate + '% ' + money(p.amount); }).join(' · ') + '</span></div>' : '') + '</div>';
  }
  function invoiceTable(rows) {
    return '<div class="scroll-x"><table class="invtable"><thead><tr><th class="num">Qty</th><th>Description</th><th class="num">Unit</th><th class="num">Amount</th></tr></thead><tbody>' +
      rows.map(function (r) { return '<tr' + (r.neg ? ' class="neg"' : '') + '><td class="num"><b>' + (r.neg ? '−' : '') + r.packs + '</b></td><td>' + esc(r.name) + (r.detail ? '<br><span class="sub">' + esc(r.detail) + '</span>' : '') + '</td><td class="num">' + (r.price == null ? '—' : r2(r.price).toFixed(2)) + '</td><td class="num">' + (r.neg ? '−' : '') + r2(r.amount).toFixed(2) + '</td></tr>'; }).join('') + '</tbody></table></div>';
  }
  function recRows(rec) {
    var g = {}, order = [];
    (rec.lines || []).forEach(function (l) {
      var n = l.invoiceName || l.productName || l.description;
      if (!g[n]) { g[n] = { name: n, packs: 0, amount: 0, price: l.unitPrice, parts: [] }; order.push(n); }
      g[n].packs += l.packs; g[n].amount = r2(g[n].amount + l.lineTotal);
      var lab = [l.colour, l.size].filter(Boolean).join(' '); if (lab) g[n].parts.push(lab + ' ×' + l.packs);
    });
    var rows = order.map(function (n) { var x = g[n]; x.detail = x.parts.join(' · '); return x; });
    var bg = {}, border = [];
    (rec.takenBack || []).forEach(function (l) {
      var n = l.invoiceName || l.productName;
      if (!bg[n]) { bg[n] = { name: n, packs: 0, amount: 0, price: l.unitPrice, parts: [], neg: true }; border.push(n); }
      bg[n].packs += l.packs; bg[n].amount = r2(bg[n].amount + l.lineTotal);
      var lab = [l.colour, l.size].filter(Boolean).join(' '); if (lab) bg[n].parts.push(lab + ' ×' + l.packs);
    });
    border.forEach(function (n) { var x = bg[n]; x.name = 'Taken back: ' + x.name; x.detail = x.parts.join(' · '); rows.push(x); });
    return rows;
  }
  function stepsBar(n) { return '<div class="steps" aria-hidden="true">' + [1, 2, 3, 4].map(function (i) { return '<i class="' + (i < n ? 'done' : i === n ? 'now' : '') + '"></i>'; }).join('') + '</div>'; }
  function shopWarning(shop) {
    if (!shop) return '';
    var bits = [];
    if (shop.balance > 0.005) bits.push('owes ' + money(shop.balance));
    if (shop.overdue > 0.005) bits.push(money(shop.overdue) + ' overdue' + (shop.oldestOverdueDays ? ' (oldest ' + shop.oldestOverdueDays + ' days)' : ''));
    if (shop.creditLimit != null && shop.balance > shop.creditLimit) bits.push('over the ' + money(shop.creditLimit) + ' limit');
    if (shop.chequePending > 0.005) bits.push(money(shop.chequePending) + ' in cheques not cleared yet');
    if (!bits.length) return '';
    return '<div class="card notice ' + (shop.overdue > 0.005 || (shop.creditLimit != null && shop.balance > shop.creditLimit) ? 'warn' : '') + '"><b>' + esc(shop.name) + '</b> ' + esc(bits.join(' · ')) + '.</div>';
  }

  function renderVisit() {
    if (!S.round) { app.innerHTML = '<div class="card center"><h2>No round open</h2><p class="sub">Load the stock you are taking out first.</p><a class="btn gold" href="#/round">Load a round</a></div>'; return; }
    if (!visit) visit = newVisit();
    var v = visit;
    if (v.step === 1) {
      var q = v.q.toLowerCase();
      var shops = S.shops.filter(function (s) { return s.active !== false && s.type !== 'online' && (!q || s.name.toLowerCase().indexOf(q) >= 0); })
        .sort(function (a, b) { return (b.lastSupplyDate || '').localeCompare(a.lastSupplyDate || '') || a.name.localeCompare(b.name); });
      app.innerHTML = stepsBar(1) + pageHead('Which shop?', 'You are carrying ' + packs(S.round.remainingTotal) + '.', '<button class="btn small" data-act="shop-new-visit">New shop</button>') +
        '<div class="field"><input type="search" placeholder="Search shops" data-in="visit-search" value="' + esc(v.q) + '" aria-label="Search shops"></div>' +
        (shops.map(function (s) { var flag = s.overdue > 0.005 ? '<span class="badge red">overdue</span>' : ''; return '<button class="list-item" data-act="pick-shop" data-id="' + esc(s.id) + '"><span><b>' + esc(s.name) + '</b> ' + flag + '<small>' + (s.lastSupplyDate ? 'Last supplied ' + esc(fmtDate(s.lastSupplyDate)) : 'No supply yet') + '</small></span><span>›</span></button>'; }).join('') || '<p class="empty">No shops yet. Add one.</p>');
      return;
    }
    var shop = shopById(v.shopId) || { name: '' };
    if (v.step === 2) {
      var byProd = {}; roundLines().forEach(function (l) { (byProd[l.productId] = byProd[l.productId] || []).push(l); });
      var cards = Object.keys(byProd).map(function (pid) {
        var lines = byProd[pid], cols = [], sizes = [];
        lines.forEach(function (l) { if (cols.indexOf(l.colour) < 0) cols.push(l.colour); if (sizes.indexOf(l.size) < 0) sizes.push(l.size); });
        var head = '<div></div>' + sizes.map(function (s) { return '<div class="cl">' + esc(s || 'Packs') + '</div>'; }).join('');
        var cells = cols.map(function (c) {
          return '<div class="rl">' + esc(c) + '</div>' + sizes.map(function (s) {
            var l = lines.filter(function (x) { return x.colour === c && x.size === s; })[0]; if (!l) return '<div class="na">—</div>';
            var k = key(pid, c, s);
            return '<input type="number" inputmode="numeric" min="0" step="1" placeholder="0" data-in="shelf" data-k="' + esc(k) + '" aria-label="Shop has: ' + esc(l.productName + ' ' + skuLabel(l)) + '" value="' + (v.shelf[k] == null ? '' : v.shelf[k]) + '">';
          }).join('');
        }).join('');
        return '<details class="prod" open><summary><span><b>' + esc(lines[0].productName) + '</b>' + (lines[0].brand ? '<br><span class="sub">' + esc(lines[0].brand) + '</span>' : '') + '</span></summary><div class="body"><div class="scroll-x"><div class="matrix" style="grid-template-columns:72px repeat(' + sizes.length + ',minmax(54px,1fr))">' + head + cells + '</div></div></div></details>';
      }).join('');
      var tbPacks = Object.keys(v.takeBack).reduce(function (a, k) { return a + (v.takeBack[k] || 0); }, 0);
      app.innerHTML = stepsBar(2) + pageHead('What do they have?', esc(shop.name) + ' — enter the packs already on their shelf. Leave blank for none.', '<button class="btn small" data-act="visit-back">Change shop</button>') + shopWarning(shop) +
        (cards || '<p class="empty">Nothing left on your round.</p>') +
        '<div class="actions"><button class="btn" data-act="visit-takeback">' + (tbPacks ? 'Taking back ' + packs(tbPacks) + ' — edit' : 'Swap: take items back') + '</button><button class="btn primary" data-act="visit-to-give">See what to give</button></div>';
      return;
    }
    if (v.step === 25) {
      var q2 = (v.tq || '').toLowerCase();
      var prods = S.products.filter(function (p) { return !q2 || (p.name + ' ' + (p.brand || '')).toLowerCase().indexOf(q2) >= 0; });
      var cards2 = prods.map(function (p) {
        var cols = coloursOf(p), sizes = unionSizes(p, cols);
        var head = '<div></div>' + sizes.map(function (s) { return '<div class="cl">' + esc(s || 'Packs') + '</div>'; }).join('');
        var cells = cols.map(function (c) {
          return '<div class="rl">' + esc(c) + '</div>' + sizes.map(function (s) {
            if (sizesOf(p, c).indexOf(s) < 0) return '<div class="na">—</div>';
            var k = key(p.id, c, s), has = v.shelf[k];
            return '<input type="number" inputmode="numeric" min="0" step="1" placeholder="' + (has ? 'has ' + has : '0') + '" data-in="takeback" data-k="' + esc(k) + '" data-p="' + esc(p.id) + '" aria-label="Take back: ' + esc(p.name + ' ' + c + ' ' + s) + '" value="' + (v.takeBack[k] || '') + '">';
          }).join('');
        }).join('');
        var n = Object.keys(v.takeBack).reduce(function (a, k) { return a + (k.indexOf(p.id + '|') === 0 ? v.takeBack[k] : 0); }, 0);
        return '<details class="prod"' + (n ? ' open' : '') + '><summary><span><b>' + esc(p.name) + '</b></span><span class="badge ' + (n ? 'gold' : '') + '" data-badge="' + esc(p.id) + '">' + n + ' packs</span></summary><div class="body"><div class="scroll-x"><div class="matrix" style="grid-template-columns:72px repeat(' + sizes.length + ',minmax(54px,1fr))">' + head + cells + '</div></div></div></details>';
      }).join('');
      app.innerHTML = stepsBar(2) + pageHead('Take back', esc(shop.name) + ' — packs you are taking back from this shop. They are credited at your supply price.') +
        '<div class="field"><input type="search" placeholder="Search products" data-in="tb-search" value="' + esc(v.tq || '') + '" aria-label="Search products"></div>' + cards2 +
        '<div class="actions"><button class="btn primary" data-act="visit-back-to-shelf">Done</button></div>';
      return;
    }
    if (v.step === 3) {
      suggest();
      var sm = summary(), groups = {};
      S.round.lines.forEach(function (l) { if (l.remaining > 0) (groups[l.productId] = groups[l.productId] || { name: l.productName, l: [] }).l.push(l); });
      var html = Object.keys(groups).map(function (pid) {
        var g = groups[pid];
        var rows = g.l.map(function (l) {
          var k = key(pid, l.colour, l.size), has = v.shelf[k] || 0, give = v.give[k] || 0;
          if (!v.showAll && has > 0 && give === 0) return '';
          return '<div class="line' + (has > 0 ? ' has' : '') + '"><div><div class="t">' + esc(skuLabel(l)) + '</div><div class="m">' + (has > 0 ? 'Shop has ' + has + ' — already stocked' : 'Shop has none') + ' · you carry ' + l.remaining + '</div></div>' +
            '<div class="stepper"><button type="button" data-act="give-minus" data-k="' + esc(k) + '" aria-label="Fewer">−</button><input type="number" inputmode="numeric" min="0" max="' + l.remaining + '" value="' + give + '" data-in="give" data-k="' + esc(k) + '" data-max="' + l.remaining + '" aria-label="Packs to give: ' + esc(g.name + ' ' + skuLabel(l)) + '"><button type="button" data-act="give-plus" data-k="' + esc(k) + '" aria-label="More">+</button></div></div>';
        }).join('');
        return rows ? '<div class="card"><h3>' + esc(g.name) + '</h3>' + rows + '</div>' : '';
      }).join('');
      var backCard = sm.backPacks ? '<div class="card notice"><b>Taking back ' + packs(sm.backPacks) + '</b> (' + money(sm.backTotal) + ' credit).</div>' : '';
      app.innerHTML = stepsBar(3) + pageHead('What to give', esc(shop.name) + ' — suggested from what they are missing and what you carry.') + shopWarning(shop) + backCard +
        '<div class="card"><div class="spaced"><div><b>Give each missing item</b><div class="hint">Packs per missing size/colour</div></div><div class="stepper"><button type="button" data-act="par-minus" aria-label="Fewer">−</button><input type="number" inputmode="numeric" min="1" max="20" value="' + v.par + '" data-in="par" aria-label="Packs per missing item"><button type="button" data-act="par-plus" aria-label="More">+</button></div></div>' +
        '<label style="margin-top:12px;display:flex;gap:8px;align-items:center;text-transform:none;letter-spacing:0;font-size:14px;color:var(--dark)"><input type="checkbox" data-in="showall" ' + (v.showAll ? 'checked' : '') + '> Show items the shop already has</label></div>' +
        (html || '<p class="empty">Nothing to suggest: the shop has everything you carry.</p>') +
        '<div id="missingPrice"></div><div class="sticky-bar"><div><b id="giveAmt">' + money(sm.net) + '</b><small id="givePacks">' + sm.packs + ' packs' + (sm.backPacks ? ' − ' + sm.backPacks + ' back' : '') + ' · incl. VAT</small></div><button class="btn gold" data-act="visit-to-confirm" id="reviewBtn">Review</button></div>' +
        '<div class="actions no-print"><button class="btn" data-act="visit-to-shelf">Back</button><button class="btn" data-act="visit-shelf-only">Save shelf check only</button></div>';
      refreshGiveBar(); return;
    }
    if (v.step === 4) {
      var s4 = summary(), terms = shop.termsDays == null ? 30 : shop.termsDays, due = addDays(v.date, terms);
      var rows4 = s4.groups.map(function (g) { return { packs: g.packs, name: g.name, price: g.price, amount: g.amount, detail: g.lines.map(function (x) { return x.label + ' ×' + x.packs; }).join(' · ') }; })
        .concat(s4.back.map(function (g) { return { packs: g.packs, name: 'Taken back: ' + g.name, price: g.price, amount: g.amount, neg: true, detail: g.lines.map(function (x) { return x.label + ' ×' + x.packs; }).join(' · ') }; }));
      var even = s4.net <= 0;
      var head4 = even ? (s4.net === 0 ? '<div class="card notice"><b>Even swap.</b> No invoice needed — this just records what went out and what came back.</div>' : '<div class="card notice"><b>You are taking back more than you give.</b> The ' + money(-s4.net) + ' difference is credited to what this shop owes.</div>') : '';
      app.innerHTML = stepsBar(4) + pageHead(even ? 'Confirm swap' : 'Confirm supply', esc(shop.name) + (even ? '' : ' — copy this onto the hard-copy invoice.')) + head4 + shopWarning(shop) +
        '<div class="card breakdown">' + invoiceTable(rows4) + (even ? '<div class="invtotals"><div class="grand"><span>NET</span><b>' + money(s4.net) + '</b></div></div>' : totalsHtml(s4.net, s4.vat, S.vatRate)) + '<p class="hint" style="margin-top:8px">' + s4.packs + ' packs given' + (s4.backPacks ? ', ' + s4.backPacks + ' taken back' : '') + '</p></div>' +
        '<div class="card">' + (even ? '' : '<div class="field"><label for="invNo">Hard-copy invoice number</label><input id="invNo" type="text" data-in="invno" value="' + esc(v.invoiceNo) + '" autocomplete="off"><div class="hint" id="invHint"></div></div>') +
        '<div class="row2"><div class="field"><label for="invDate">Date</label><input id="invDate" type="date" data-in="invdate" value="' + esc(v.date) + '"></div>' + (even ? '' : '<div class="field"><label>Due</label><input type="text" id="dueShow" readonly value="' + esc(fmtDate(due)) + '"><div class="hint">' + terms + ' days</div></div>') + '</div>' +
        '<div class="field"><label for="invNotes">Notes (optional)</label><textarea id="invNotes" data-in="invnotes">' + esc(v.notes) + '</textarea></div></div>' +
        '<div class="actions"><button class="btn" data-act="visit-to-give">Back</button><button class="btn primary" data-act="visit-save" id="saveSupply">' + (even ? 'Save swap' : 'Confirm supply') + '</button></div>';
      if (!even) api('/api/supply/next-invoice-no').then(function (r) { if (r.next && !visit.invoiceNo) { visit.invoiceNo = r.next; var i = $('#invNo'); if (i && !i.value) i.value = r.next; } var h = $('#invHint'); if (h && r.next) h.textContent = 'After your last invoice comes ' + r.next + '. Change it to match your hard copy.'; }).catch(function () {});
      return;
    }
    if (v.step === 5) {
      var d = v.done, pend = v.queued, other = d.kind && d.kind !== 'supply';
      app.innerHTML = pageHead(other ? (d.kind === 'swap' ? 'Swap saved' : 'Credit saved') : 'Supply saved', pend ? '<span class="err">Saved on this phone. It will send when the signal returns.</span>' : (other ? '' : 'Write this on the hard-copy invoice.')) +
        '<div class="card">' + companyHead() + '<div class="spaced mt"><div><label>' + (other ? 'Reference' : 'Invoice no.') + '</label><b style="font-size:22px">' + esc(d.invoiceNo) + '</b></div><div style="text-align:right"><label>' + (other ? 'Date' : 'Due') + '</label><b>' + esc(fmtDate(other ? d.date : d.dueDate)) + '</b></div></div><p class="sub">' + esc(d.shopName) + ' · ' + esc(fmtDate(d.date)) + '</p>' +
        invoiceTable(recRows(d)) + (other ? '<div class="invtotals"><div class="grand"><span>NET</span><b>' + money(d.kind === 'credit' ? -d.creditAmount : 0) + '</b></div></div>' : totalsHtml(d.amount, d.vatAmount, d.vatRate, d.vatParts)) + '</div>' +
        '<div class="actions no-print"><button class="btn" data-act="print">Print</button><button class="btn gold" data-act="visit-again">Visit another shop</button><a class="btn primary" href="#/">Home</a></div>';
    }
  }
  V.visit = function () { renderVisit(); };
  function refreshGiveBar() {
    var sm = summary(), a = $('#giveAmt'), p = $('#givePacks'), b = $('#reviewBtn'), mp = $('#missingPrice');
    if (a) a.textContent = money(sm.net); if (p) p.textContent = packs(sm.packs) + (sm.backPacks ? ' − ' + sm.backPacks + ' back' : '') + ' · incl. VAT';
    if (b) b.disabled = (sm.packs === 0 && sm.backPacks === 0) || sm.missingPrice.length > 0;
    if (mp) {
      var has = mp.querySelector('input');
      if (sm.missingPrice.length && !has) mp.innerHTML = '<div class="card"><p class="err">Set your supply price to continue.</p><div class="field"><label for="stdp">Supply price per 3-pack (VAT included)</label><input id="stdp" type="number" min="0" step="0.01" inputmode="decimal" data-in="setprice" placeholder="e.g. 250.20"><div class="hint">One price for every product. You can change it later under Prices.</div></div></div>';
      if (!sm.missingPrice.length) mp.innerHTML = '';
    }
  }
  function buildPayload() {
    var v = visit, sm = summary(), lines = [], takenBack = [];
    sm.groups.forEach(function (g) { g.lines.forEach(function (x) { lines.push({ productId: g.id, colour: x.l.colour, size: x.l.size, packs: x.packs, unitPrice: x.price }); }); });
    sm.back.forEach(function (g) { g.lines.forEach(function (x) { var p = x.key.split('|'); takenBack.push({ productId: g.id, colour: p[1], size: p[2], packs: x.packs, unitPrice: x.price }); }); });
    var shelf = Object.keys(v.shelf).map(function (k) { var p = k.split('|'); return { productId: p[0], colour: p[1], size: p[2], has: v.shelf[k] || 0 }; });
    return { shopId: v.shopId, invoiceNo: sm.net > 0 ? v.invoiceNo.trim() : '', date: v.date, notes: v.notes, roundId: S.round.id, lines: lines, takenBack: takenBack, shelf: shelf };
  }
  function localRecord(payload, shop) {
    var sm = summary(), rate = S.vatRate, net = sm.net, kind = net > 0 ? 'supply' : (net === 0 ? 'swap' : 'credit');
    var mapLine = function (x) { var p = productById(x.productId) || {}; return { productId: x.productId, productName: p.name, invoiceName: descOf(x.productId), colour: x.colour, size: x.size, packs: x.packs, unitPrice: x.unitPrice, lineTotal: r2(x.packs * x.unitPrice) }; };
    var base = r2(net / (1 + rate / 100));
    return { kind: kind, invoiceNo: payload.invoiceNo || (kind === 'swap' ? 'SWAP (not sent yet)' : 'CREDIT (not sent yet)'), shopName: shop.name, date: payload.date, dueDate: addDays(payload.date, shop.termsDays == null ? 30 : shop.termsDays),
      lines: payload.lines.map(mapLine), takenBack: payload.takenBack.map(mapLine), amount: net > 0 ? net : 0, creditAmount: net < 0 ? -net : 0, vatAmount: net > 0 ? r2(net - base) : 0, vatRate: rate, vatParts: [], packsTotal: sm.packs };
  }
  function applyLocalRoundUse(payload) {
    if (!S.round) return;
    var lines = S.round.lines, same = function (y, x) { return key(y.productId, y.colour, y.size) === key(x.productId, x.colour, x.size); };
    payload.lines.forEach(function (x) { var l = lines.filter(function (y) { return same(y, x); })[0]; if (l) { l.remaining -= x.packs; l.supplied += x.packs; } });
    payload.takenBack.forEach(function (x) { var l = lines.filter(function (y) { return same(y, x); })[0]; if (l) { l.remaining += x.packs; l.takenBack = (l.takenBack || 0) + x.packs; } else lines.push({ productId: x.productId, productName: (productById(x.productId) || {}).name, brand: '', colour: x.colour, size: x.size, packs: 0, loaded: 0, supplied: 0, takenBack: x.packs, remaining: x.packs }); });
    S.round.remainingTotal = lines.reduce(function (a, l) { return a + l.remaining; }, 0);
  }
  function saveVisit() {
    var v = visit, sm = summary(), shop = shopById(v.shopId) || {};
    if (sm.net > 0 && !v.invoiceNo.trim()) return toast('Enter the hard-copy invoice number.', true);
    var problem = (shop.overdue > 0.005 ? shop.name + ' is ' + money(shop.overdue) + ' overdue.' : '') || ((shop.creditLimit != null && shop.balance + sm.net > shop.creditLimit) ? shop.name + ' would be over its ' + money(shop.creditLimit) + ' credit limit.' : '');
    if (problem && sm.net > 0 && !window.confirm(problem + '\n\nSupply anyway?')) return;
    var payload = buildPayload(), btn = $('#saveSupply'); btn.disabled = true;
    api('/api/supply/supplies', { method: 'POST', body: payload }).then(function (r) {
      v.done = r.supply; v.step = 5; clearDraft();
      return refreshData().catch(function () {}).then(function () { renderVisit(); });
    }).catch(function (e) {
      if (e.network) {
        var q = queue(); q.push({ payload: payload, ts: Date.now(), shop: shop.name }); lsSet(QUEUE_KEY, q);
        v.done = localRecord(payload, shop); v.queued = true; v.step = 5; clearDraft(); applyLocalRoundUse(payload); renderVisit();
      } else { btn.disabled = false; toast(e.message, true); }
    });
  }
  A['pick-shop'] = function (t) { visit.shopId = t.dataset.id; visit.step = 2; saveDraft(); renderVisit(); };
  A['shop-new-visit'] = function () { C.shopDialog(null, function (shop) { visit.shopId = shop.id; visit.step = 2; saveDraft(); renderVisit(); }); };
  A['visit-back'] = function () { visit.step = 1; renderVisit(); };
  A['visit-takeback'] = function () { visit.step = 25; renderVisit(); };
  A['visit-back-to-shelf'] = function () { visit.step = 2; saveDraft(); renderVisit(); };
  A['visit-to-give'] = function () { visit.step = 3; saveDraft(); renderVisit(); };
  A['visit-to-shelf'] = function () { visit.step = 2; renderVisit(); };
  A['visit-to-confirm'] = function () { var sm = summary(); if (sm.packs === 0 && sm.backPacks === 0) return; visit.step = 4; saveDraft(); renderVisit(); };
  A['visit-save'] = saveVisit;
  A['visit-again'] = function () { visit = null; location.hash = '#/visit'; renderVisit(); };
  A['visit-shelf-only'] = function () {
    var shelf = Object.keys(visit.shelf).map(function (k) { var p = k.split('|'); return { productId: p[0], colour: p[1], size: p[2], has: visit.shelf[k] || 0 }; });
    api('/api/supply/visits', { method: 'POST', body: { shopId: visit.shopId, date: visit.date, shelf: shelf } }).then(function () { toast('Shelf check saved.'); visit = null; clearDraft(); location.hash = '#/'; }).catch(function (e) { toast(e.message, true); });
  };
  A['par-minus'] = A['par-plus'] = function (t) { visit.par = Math.max(1, Math.min(20, visit.par + (t.dataset.act === 'par-plus' ? 1 : -1))); visit.touched = {}; renderVisit(); };
  A['give-minus'] = A['give-plus'] = function (t) {
    var input = t.closest('.stepper').querySelector('input'), max = parseInt(input.dataset.max, 10), val = clamp(parseInt(input.value, 10) + (t.dataset.act === 'give-plus' ? 1 : -1), max);
    input.value = val; visit.give[t.dataset.k] = val; visit.touched[t.dataset.k] = true; refreshGiveBar(); saveDraft();
  };
  I.shelf = function (t) { var v2 = t.value === '' ? null : clamp(t.value); if (v2 == null) delete visit.shelf[t.dataset.k]; else visit.shelf[t.dataset.k] = v2; saveDraft(); };
  I.takeback = function (t) {
    var n = clamp(t.value); if (n > 0) visit.takeBack[t.dataset.k] = n; else delete visit.takeBack[t.dataset.k];
    var pn = 0; Object.keys(visit.takeBack).forEach(function (kk) { if (kk.indexOf(t.dataset.p + '|') === 0) pn += visit.takeBack[kk]; });
    var b = $('[data-badge="' + CSS.escape(t.dataset.p) + '"]'); if (b) { b.textContent = pn + ' packs'; b.className = 'badge' + (pn ? ' gold' : ''); } saveDraft();
  };
  I['tb-search'] = debounce(function (t) { visit.tq = t.value; renderVisit(); var s = $('[data-in="tb-search"]'); if (s) { s.focus(); s.setSelectionRange(s.value.length, s.value.length); } }, 250);
  I.give = function (t) { var g = clamp(t.value, parseInt(t.dataset.max, 10)); visit.give[t.dataset.k] = g; visit.touched[t.dataset.k] = true; refreshGiveBar(); saveDraft(); };
  I.par = function (t) { visit.par = Math.max(1, Math.min(20, parseInt(t.value, 10) || 1)); };
  I.showall = function (t) { visit.showAll = t.checked; renderVisit(); };
  I['visit-search'] = debounce(function (t) { visit.q = t.value; renderVisit(); var s = $('[data-in="visit-search"]'); if (s) { s.focus(); s.setSelectionRange(s.value.length, s.value.length); } }, 200);
  I.invno = function (t) { visit.invoiceNo = t.value; saveDraft(); };
  I.invdate = function (t) { visit.date = t.value || todayStr(); var sh = shopById(visit.shopId) || {}, sd = $('#dueShow'); if (sd) sd.value = fmtDate(addDays(visit.date, sh.termsDays == null ? 30 : sh.termsDays)); saveDraft(); };
  I.invnotes = function (t) { visit.notes = t.value; saveDraft(); };
  I.setprice = debounce(function (t) {
    var val = parseFloat(t.value); if (isNaN(val) || val < 0) return;
    api('/api/supply/prices', { method: 'PUT', body: { standardPrice: val } }).then(function () { S.standardPrice = val; S.priceList.forEach(function (p) { S.prices[p.id] = p.overridePrice == null ? val : p.overridePrice; }); refreshGiveBar(); toast('Supply price saved.'); }).catch(function (e) { toast(e.message, true); });
  }, 700);

  // ── events (shared with the other files) ───────────────────────────────────
  app.addEventListener('click', function (e) { var t = e.target.closest('[data-act]'); if (!t) return; var f = A[t.dataset.act]; if (f) f(t, e); });
  app.addEventListener('input', function (e) { var t = e.target, kind = t.dataset && t.dataset.in; if (kind && I[kind]) I[kind](t, e); });
  app.addEventListener('change', function (e) { var t = e.target, kind = t.dataset && t.dataset.in; if (kind && C[kind]) C[kind](t, e); });

  window.SUP = { S: S, V: V, A: A, I: I, C: C, $: $, $$: $$, esc: esc, money: money, r2: r2, todayStr: todayStr, fmtDate: fmtDate, addDays: addDays, daysBetween: daysBetween, toast: toast, api: api, app: app,
    productById: productById, shopById: shopById, skuLabel: skuLabel, key: key, coloursOf: coloursOf, sizesOf: sizesOf, unionSizes: unionSizes, descOf: descOf, priceOf: priceOf, companyHead: companyHead, W: W, dialog: dialog, askReason: askReason,
    pageHead: pageHead, refreshData: refreshData, totalsHtml: totalsHtml, invoiceTable: invoiceTable, recRows: recRows, debounce: debounce, clamp: clamp, lsGet: lsGet, lsSet: lsSet, route: route, boot: boot,
    openLoader: openLoader, packs: packs, getVisit: function () { return visit; }, setVisit: function (v) { visit = v; }, newVisit: newVisit, renderVisit: renderVisit, saveDraft: saveDraft, shopWarning: shopWarning };

  // the money / insight files load after this one and add their views; start once they are ready
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/supply-sw.js').catch(function () {});
  window.addEventListener('load', boot);
})();
