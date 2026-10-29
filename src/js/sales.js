// Sales — order-taking tool for owner, manager and staff. Split out of Admin: Orders, Invoice, Codes, and a
// read-only Stock view (Dome + Spintex). Only Admin changes stock directly; Sales just needs to see and quote it.
(function () {
  'use strict';
  var TOKEN_KEY = 'freeman_admin_token';
  var token = '';
  try { token = localStorage.getItem(TOKEN_KEY) || ''; } catch (e) {}
  var app = document.getElementById('app');
  var S = { me: null, role: 'staff', canManage: false, products: [], orders: [], codes: null, searchQ: '', statusFilter: '' };
  var V = {}, A = {}, I = {}, C = {};

  // ── helpers ────────────────────────────────────────────────────────────────
  function $(s, el) { return (el || document).querySelector(s); }
  function $$(s, el) { return Array.prototype.slice.call((el || document).querySelectorAll(s)); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function money(n) { return 'GH₵' + Number(n || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function fmtDateTime(s) { if (!s) return ''; try { return new Date(s).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch (e) { return s; } }
  var SKELETON = '<div class="skel-wrap" aria-hidden="true"><div class="skel skel-title"></div><div class="skel skel-card-lg"></div><div class="skel skel-card-lg"></div><div class="skel skel-card-sm"></div></div>';
  function toast(msg, isErr) {
    if (isErr && $('#app .skel-wrap')) app.innerHTML = '<div class="card center"><h2>Could not load this</h2><p class="sub">' + esc(msg) + '</p><div class="actions"><button class="btn primary" data-act="retry-route">Try again</button><a class="btn" href="#/">Orders</a></div></div>';
    var t = $('#toast'); t.textContent = msg; t.className = 'toast show' + (isErr ? ' error' : ''); clearTimeout(toast._t); toast._t = setTimeout(function () { t.className = 'toast'; }, 3400);
  }
  function lsDel(k) { try { localStorage.removeItem(k); } catch (e) {} }
  function api(path, opts) {
    opts = opts || {};
    var headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = 'Bearer ' + token;
    return fetch(path, { method: opts.method || 'GET', headers: headers, body: opts.body ? JSON.stringify(opts.body) : undefined }).then(function (r) {
      if (r.status === 401) { token = ''; lsDel(TOKEN_KEY); renderLogin(); throw new Error('Please sign in again.'); }
      return r.json().catch(function () { return {}; }).then(function (j) {
        j = j || {};
        if (!r.ok || j.success === false) throw new Error(j.message || j.error || 'Something went wrong.');
        return j;
      });
    }, function () { throw new Error('No signal. Please try again.'); });
  }
  function fail(showErr) { return function (e) { if (showErr) showErr(e.message); else toast(e.message, true); }; }
  function pageHead(title, sub, extra) { return '<div class="page-head"><div><h1>' + esc(title) + '</h1>' + (sub ? '<p class="sub">' + esc(sub) + '</p>' : '') + '</div>' + (extra || '') + '</div>'; }
  var debounce = function (fn, ms) { var t; return function () { var a = arguments, c = this; clearTimeout(t); t = setTimeout(function () { fn.apply(c, a); }, ms); }; };
  function dialog(html, onSubmit) {
    var dlg = document.createElement('dialog'); dlg.innerHTML = html;
    document.body.appendChild(dlg); dlg.showModal();
    dlg.addEventListener('close', function () { dlg.remove(); });
    $$('[data-close]', dlg).forEach(function (b) { b.addEventListener('click', function () { dlg.close(); }); });
    var form = $('form', dlg);
    if (form && onSubmit) form.addEventListener('submit', function (e) { e.preventDefault(); onSubmit(dlg, function (msg) { var el = $('.err', dlg); if (el) el.textContent = msg; }); });
    return dlg;
  }
  function productById(id) { return S.products.filter(function (p) { return p.id === id; })[0]; }
  function orderById(id) { return S.orders.filter(function (o) { return o.id === id; })[0]; }
  function orderRef(o) { return o.orderNo ? '#' + o.orderNo : o.id; }
  function statusClass(st) { return 'status-badge status-' + String(st || 'Pending').replace(/\s+/g, ''); }
  function waUrl(o) {
    var c = (o && o.customer) || {};
    var raw = String(c.phone || '').replace(/\D/g, '');
    var num = raw.indexOf('0') === 0 ? '233' + raw.slice(1) : raw;
    if (num.length < 7) return '';
    var link = location.origin + '/api/orders/' + encodeURIComponent(o.id) + '/receipt?phone=' + encodeURIComponent(num);
    var msg = 'Hello ' + (c.name || '') + ', thank you for shopping with Freeman Outlet.\n\n' +
      'Invoice ' + orderRef(o) + '\n' + 'Total: ' + money(o.total) + '\n\n' + 'View or download your invoice here:\n' + link;
    return 'https://wa.me/' + num + '?text=' + encodeURIComponent(msg);
  }

  // ── sign-in / boot ─────────────────────────────────────────────────────────
  function renderLogin() {
    $('#bottomnav').hidden = true;
    app.innerHTML = '<div class="card login"><h1>Sign in</h1><p class="sub">Owner, manager or staff account.</p><form id="loginForm" class="mt"><div class="field"><label for="lu">Username</label><input id="lu" type="text" autocomplete="username" required></div>' +
      '<div class="field"><label for="lp">Password</label><input id="lp" type="password" autocomplete="current-password" required></div><p class="err" id="lerr"></p><button class="btn primary block" type="submit">Sign in</button></form></div>';
    $('#loginForm').addEventListener('submit', function (e) {
      e.preventDefault();
      fetch('/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: $('#lu').value.trim(), password: $('#lp').value }) })
        .then(function (r) { return r.json(); }).then(function (d) {
          if (!d.token) { $('#lerr').textContent = d.error || 'Wrong username or password.'; return; }
          if (d.role === 'viewer') { localStorage.setItem(TOKEN_KEY, d.token); location.href = '/supply.html'; return; }
          localStorage.setItem(TOKEN_KEY, d.token); token = d.token; boot();
        }).catch(function () { $('#lerr').textContent = 'No signal. Try again.'; });
    });
  }
  function buildNav() {
    var items = [['orders', '#/', 'Orders'], ['invoice', '#/invoice', 'Invoice'], ['codes', '#/codes', 'Codes'], ['stock', '#/stock', 'Stock'], ['more', '#/more', 'More']];
    $('#bottomnav').innerHTML = items.map(function (i) { return '<a href="' + i[1] + '" data-nav="' + i[0] + '">' + i[2] + '</a>'; }).join('');
    $('#bottomnav').hidden = false;
    var adminLink = $('#sales-admin-link'); if (adminLink) adminLink.style.display = S.canManage ? '' : 'none';
  }
  function boot() {
    if (!token) return renderLogin();
    api('/api/admin/me').then(function (me) {
      if (me.role === 'viewer') { location.href = '/supply.html'; return; }
      if (['owner', 'manager', 'staff'].indexOf(me.role) < 0) { app.innerHTML = '<div class="card center"><h1>Not allowed</h1><p class="sub">This account cannot open Sales.</p></div>'; return; }
      S.me = me; S.role = me.role; S.canManage = (me.role === 'owner' || me.role === 'manager');
      return Promise.all([api('/api/admin/all-products'), api('/api/orders')]).then(function (r) {
        S.products = r[0] || []; S.orders = r[1] || [];
        start();
      });
    }).catch(function (e) {
      if (token) app.innerHTML = '<div class="card center"><p class="err">' + esc(e.message) + '</p><button class="btn" data-act="reload">Try again</button></div>';
    });
  }
  function start() {
    buildNav();
    window.removeEventListener('hashchange', route); window.addEventListener('hashchange', route);
    route();
  }
  A.reload = boot;
  A['retry-route'] = function () { route(); };

  // ── router ─────────────────────────────────────────────────────────────────
  var NAVMAP = { order: 'orders' };
  function route() {
    var h = (location.hash || '#/').replace(/^#/, ''), parts = h.split('/').filter(Boolean), name = parts[0] || 'orders';
    var nav = NAVMAP[name] || name;
    if (!$('#bottomnav a[data-nav="' + nav + '"]')) nav = 'orders';
    $$('#bottomnav a').forEach(function (a) { a.classList.toggle('active', a.dataset.nav === nav); });
    window.scrollTo(0, 0);
    var viewName = name === 'order' ? 'order' : (V[name] ? name : 'orders');
    app.innerHTML = SKELETON;
    V[viewName](parts.map(decodeURIComponent));
  }

  // ── ORDERS ─────────────────────────────────────────────────────────────────
  var STATUSES = ['Pending', 'Processing', 'Shipped', 'Delivered', 'Returned', 'Refunded'];
  function loadOrders() { return api('/api/orders' + (S.searchQ ? '?q=' + encodeURIComponent(S.searchQ) : '')).then(function (list) { S.orders = list; return list; }); }
  V.orders = function () {
    loadOrders().then(function (list) {
      var filtered = S.statusFilter ? list.filter(function (o) { return (o.status || 'Pending') === S.statusFilter; }) : list;
      filtered = filtered.slice().sort(function (a, b) { return new Date(b.paidAt) - new Date(a.paidAt); });
      var chips = [['', 'All']].concat(STATUSES.map(function (s) { return [s, s]; })).map(function (c) {
        return '<button class="chip' + (S.statusFilter === c[0] ? ' on' : '') + '" data-act="order-filter" data-s="' + esc(c[0]) + '">' + esc(c[1]) + '</button>';
      }).join('');
      var rows = filtered.map(function (o) {
        return '<button class="order-row" data-act="open-order" data-id="' + esc(o.id) + '"><span><b>' + esc(orderRef(o)) + '</b> <span class="' + statusClass(o.status) + '">' + esc(o.status || 'Pending') + '</span>' +
          '<div class="m">' + esc((o.customer && o.customer.name) || '') + ' · ' + (o.items || []).length + ' item(s) · ' + esc(fmtDateTime(o.paidAt)) + '</div></span>' +
          '<span class="right"><b>' + money(o.total) + '</b></span></button>';
      }).join('');
      app.innerHTML = pageHead('Orders', filtered.length + ' order(s)') +
        '<div class="field"><input type="search" placeholder="Search name, phone, email, order #" data-in="order-search" value="' + esc(S.searchQ) + '" aria-label="Search orders"></div>' +
        '<div class="chips">' + chips + '</div>' + (rows || '<p class="empty">No orders found.</p>');
    }).catch(fail());
  };
  A['order-filter'] = function (t) { S.statusFilter = t.dataset.s; V.orders(); };
  A['open-order'] = function (t) { location.hash = '#/order/' + encodeURIComponent(t.dataset.id); };
  I['order-search'] = debounce(function (t) { S.searchQ = t.value; V.orders(); var s = $('[data-in="order-search"]'); if (s) { s.focus(); s.setSelectionRange(s.value.length, s.value.length); } }, 300);

  // ── ORDER DETAIL ───────────────────────────────────────────────────────────
  var currentOrderId = null;
  V.order = function (parts) {
    currentOrderId = parts[1];
    var order = orderById(currentOrderId);
    if (order) return renderOrderDetail();
    loadOrders().then(function () { if (!orderById(currentOrderId)) { toast('Order not found.', true); location.hash = '#/'; return; } renderOrderDetail(); }).catch(fail());
  };
  function renderOrderDetail() {
    var o = orderById(currentOrderId); if (!o) return;
    var c = o.customer || {};
    var items = (o.items || []).map(function (it, idx) {
      var label = [it.color, it.size].filter(Boolean).join(' ');
      return '<div class="item-row"><div><div>' + esc(it.name) + (label ? ' <span class="sub">(' + esc(label) + ')</span>' : '') + '</div><div class="m">×' + (parseInt(it.quantity, 10) || 1) + ' @ ' + money(it.price) + '</div></div>' +
        '<div style="text-align:right"><b>' + money((parseFloat(it.price) || 0) * (parseInt(it.quantity, 10) || 1)) + '</b><br><button class="btn small" style="margin-top:4px" data-act="change-item" data-id="' + esc(o.id) + '" data-idx="' + idx + '">Change</button></div></div>';
    }).join('');
    var itemEdits = (o.itemEdits || []).slice().reverse().map(function (e) {
      var line = e.type === 'add'
        ? 'Added ' + esc(e.item.name) + (e.item.color || e.item.size ? ' (' + esc([e.item.color, e.item.size].filter(Boolean).join(' ')) + ')' : '') + ' ×' + e.item.quantity
        : 'Changed ' + esc(e.from.name) + ' (' + esc([e.from.color, e.from.size].filter(Boolean).join(' ') || 'one size') + ' ×' + e.from.quantity + ') to ' + esc(e.to.name) + ' (' + esc([e.to.color, e.to.size].filter(Boolean).join(' ') || 'one size') + ' ×' + e.to.quantity + ')';
      return '<div class="note-item">' + line + '<div class="m">' + esc(e.editedBy) + ' · ' + esc(fmtDateTime(e.timestamp)) + '</div></div>';
    }).join('');
    var money_lines = '';
    if (o.bundleDiscount > 0) money_lines += '<div class="spaced"><span class="sub">Bundle savings</span><span>−' + money(o.bundleDiscount) + '</span></div>';
    if (o.promoCode) money_lines += '<div class="spaced"><span class="sub">Promo (' + esc(o.promoCode) + ')</span><span>−' + money(o.promoDiscount) + '</span></div>';
    if (o.deliveryZone || o.deliveryPrice > 0) money_lines += '<div class="spaced"><span class="sub">Delivery' + (o.deliveryZone ? ' (' + esc(o.deliveryZone) + ')' : '') + '</span><span>' + (o.deliveryPrice > 0 ? money(o.deliveryPrice) : 'Free / arranged') + '</span></div>';
    var alert = o.fulfillmentAlert ? '<div class="card notice warn"><b>Needs review:</b> ' + esc(o.fulfillmentAlert) + '</div>' : '';
    var shipInfo = (o.shippingCarrier || o.shippingRiderPhone || o.shippingTrackingLink || o.shippingNote)
      ? '<div class="card"><h3>Shipping details</h3>' +
        (o.shippingCarrier ? '<div class="spaced"><span class="sub">Carrier / rider</span><span>' + esc(o.shippingCarrier) + '</span></div>' : '') +
        (o.shippingRiderPhone ? '<div class="spaced"><span class="sub">Rider phone</span><span>' + esc(o.shippingRiderPhone) + '</span></div>' : '') +
        (o.shippingTrackingLink ? '<div class="spaced"><span class="sub">Tracking link</span><a href="' + esc(o.shippingTrackingLink) + '" target="_blank" rel="noopener">Open</a></div>' : '') +
        (o.shippingNote ? '<div class="spaced"><span class="sub">Note</span><span>' + esc(o.shippingNote) + '</span></div>' : '') + '</div>'
      : '';
    var notes = (o.adminNotes || []).slice().reverse().map(function (n) {
      return '<div class="note-item">' + esc(n.text) + '<div class="m">' + esc(n.author) + ' · ' + esc(fmtDateTime(n.at)) + '</div></div>';
    }).join('');
    var wa = waUrl(o);
    var returnInfo = (o.status === 'Returned' || o.status === 'Refunded') ? '<div class="card"><h3>Return / refund</h3>' +
      (o.returnReason ? '<div class="spaced"><span class="sub">Reason</span><span>' + esc(o.returnReason) + '</span></div>' : '') +
      '<div class="spaced"><span class="sub">Refund amount</span><span>' + money(o.refundAmount) + '</span></div></div>' : '';
    app.innerHTML = '<p class="no-print"><a href="#/">‹ Orders</a></p>' +
      pageHead(orderRef(o), fmtDateTime(o.paidAt), '<span class="' + statusClass(o.status) + '">' + esc(o.status || 'Pending') + '</span>') + alert +
      '<div class="card"><h3>Customer</h3><div class="spaced"><span class="sub">Name</span><span>' + esc(c.name || '') + '</span></div>' +
      (c.phone ? '<div class="spaced"><span class="sub">Phone</span><a href="tel:' + esc(c.phone) + '">' + esc(c.phone) + '</a></div>' : '') +
      (c.email ? '<div class="spaced"><span class="sub">Email</span><span>' + esc(c.email) + '</span></div>' : '') +
      (o.deliveryAddress || c.address ? '<div class="spaced"><span class="sub">Address</span><span>' + esc(o.deliveryAddress || c.address) + '</span></div>' : '') +
      (c.notes ? '<div class="spaced"><span class="sub">Note</span><span>' + esc(c.notes) + '</span></div>' : '') + '</div>' +
      '<div class="card"><h3>Items</h3>' + items + '<div class="mt">' + money_lines + '<div class="spaced" style="font-weight:700;margin-top:6px"><span>Total</span><b>' + money(o.total) + '</b></div></div>' +
      '<div class="actions"><button class="btn small" data-act="add-item" data-id="' + esc(o.id) + '">Add item</button></div>' +
      (o.stockDeducted ? '<p class="hint">This order\'s stock has already been taken out — adding or changing an item here adjusts ' + (o.stockPool === 'dome' ? 'Dome' : 'Spintex') + ' immediately.</p>' : '<p class="hint">Stock hasn\'t been taken out yet, so adding or changing items here is free — it just changes what gets deducted when you confirm this order.</p>') + '</div>' +
      (itemEdits ? '<div class="card"><h3>Item changes</h3>' + itemEdits + '</div>' : '') +
      shipInfo + returnInfo +
      '<div class="card"><h3>Status</h3><select data-in="order-status" data-id="' + esc(o.id) + '">' +
      STATUSES.map(function (s) { return '<option value="' + s + '"' + (s === (o.status || 'Pending') ? ' selected' : '') + '>' + s + '</option>'; }).join('') + '</select>' +
      (o.stockDeducted ? '<p class="hint">Stock taken from ' + (o.stockPool === 'dome' ? 'Dome' : 'Spintex') + '.</p>' : '<p class="hint">Stock has not been taken out yet — this happens when you mark it Shipped or Delivered.</p>') + '</div>' +
      '<div class="card"><h3>Tracking</h3><div class="row2"><div class="field"><label for="trk-number">Tracking number</label><input id="trk-number" type="text" value="' + esc(o.trackingNumber || '') + '"></div><div class="field"><label for="trk-carrier">Carrier</label><input id="trk-carrier" type="text" value="' + esc(o.trackingCarrier || '') + '"></div></div><div class="actions"><button class="btn small" data-act="save-tracking">Save tracking</button></div></div>' +
      '<div class="card"><h3>Notes</h3>' + (notes || '<p class="empty">No notes yet.</p>') + '<div class="field mt"><label for="note-input">Add a note</label><textarea id="note-input"></textarea></div><div class="actions"><button class="btn small" data-act="add-note">Add note</button></div></div>' +
      '<div class="actions">' + (wa ? '<a class="btn gold" target="_blank" rel="noopener" href="' + wa + '">Share on WhatsApp</a>' : '') + '<a class="btn" href="/admin.html">Full invoice in Admin</a>' + (S.canManage ? '<button class="btn danger" data-act="delete-order" data-id="' + esc(o.id) + '">Delete order</button>' : '') + '</div>';
  }
  C['order-status'] = function (t) {
    var order = orderById(t.dataset.id); if (!order) return;
    var val = t.value, prev = order.status || 'Pending';
    if (val === prev) return;
    if (val === 'Shipped') return openShipDialog(order, t, prev);
    if (val === 'Delivered' && !order.stockDeducted) return openDeliverDialog(order, t, prev);
    if (val === 'Returned' || val === 'Refunded') return openReturnDialog(order, t, val, prev);
    api('/api/orders/' + order.id + '/status', { method: 'PATCH', body: { status: val } }).then(function (r) {
      Object.assign(order, r.order); toast('Status updated to ' + val + '.'); renderOrderDetail();
    }).catch(function (e) { t.value = prev; toast(e.message, true); });
  };
  // Shared pool-pick toggle (Dome/Spintex, Spintex default) — used wherever an order's
  // status is about to trigger stock deduction for the first time.
  function poolPickerHtml(current) {
    return '<div class="field"><label>Fulfil from</label><div class="chips" id="pool-pick">' +
      '<button type="button" class="chip' + (current !== 'dome' ? ' on' : '') + '" data-pool="spintex">Spintex</button>' +
      '<button type="button" class="chip' + (current === 'dome' ? ' on' : '') + '" data-pool="dome">Dome</button></div></div>';
  }
  function wirePoolPicker(dlg, initial) {
    var pool = initial || 'spintex';
    $$('#pool-pick .chip', dlg).forEach(function (b) {
      b.addEventListener('click', function () { pool = b.dataset.pool; $$('#pool-pick .chip', dlg).forEach(function (x) { x.classList.toggle('on', x === b); }); });
    });
    return function () { return pool; };
  }
  function openShipDialog(order, selectEl, prev) {
    var confirmed = false, needsPool = !order.stockDeducted;
    var dlg = dialog('<form method="dialog"><h2>Mark as Shipped</h2><p class="sub">Delivery details are sent to the customer by email.</p>' +
      (needsPool ? poolPickerHtml(order.stockPool) : '') +
      '<div class="field"><label for="ship-carrier">Carrier / rider name</label><input id="ship-carrier" type="text" value="' + esc(order.shippingCarrier || '') + '"></div>' +
      '<div class="field"><label for="ship-phone">Rider phone (optional)</label><input id="ship-phone" type="tel" value="' + esc(order.shippingRiderPhone || '') + '"></div>' +
      '<div class="field"><label for="ship-link">Tracking link (optional)</label><input id="ship-link" type="url" value="' + esc(order.shippingTrackingLink || '') + '"></div>' +
      '<div class="field"><label for="ship-note">Note to customer (optional)</label><input id="ship-note" type="text" value="' + esc(order.shippingNote || '') + '"></div>' +
      '<p class="err"></p><div class="actions"><button class="btn" type="button" data-close>Cancel</button><button class="btn primary" type="submit">Confirm Shipped</button></div></form>',
      function (d, showErr) {
        api('/api/orders/' + order.id + '/status', { method: 'PATCH', body: {
          status: 'Shipped', pool: getPool ? getPool() : undefined,
          shippingCarrier: $('#ship-carrier', d).value.trim(), shippingRiderPhone: $('#ship-phone', d).value.trim(),
          shippingTrackingLink: $('#ship-link', d).value.trim(), shippingNote: $('#ship-note', d).value.trim()
        } }).then(function (r) { confirmed = true; Object.assign(order, r.order); d.close(); toast('Marked Shipped.'); renderOrderDetail(); }).catch(fail(showErr));
      });
    var getPool = needsPool ? wirePoolPicker(dlg, order.stockPool) : null;
    dlg.addEventListener('close', function () { if (!confirmed) selectEl.value = prev; });
  }
  function openDeliverDialog(order, selectEl, prev) {
    var confirmed = false;
    var dlg = dialog('<form method="dialog"><h2>Mark as Delivered</h2><p class="sub">This is the first time this order\'s stock is being taken out — pick which pool it came from.</p>' +
      poolPickerHtml(order.stockPool) + '<p class="err"></p><div class="actions"><button class="btn" type="button" data-close>Cancel</button><button class="btn primary" type="submit">Confirm Delivered</button></div></form>',
      function (d, showErr) {
        api('/api/orders/' + order.id + '/status', { method: 'PATCH', body: { status: 'Delivered', pool: getPool() } })
          .then(function (r) { confirmed = true; Object.assign(order, r.order); d.close(); toast('Marked Delivered.'); renderOrderDetail(); }).catch(fail(showErr));
      });
    var getPool = wirePoolPicker(dlg, order.stockPool);
    dlg.addEventListener('close', function () { if (!confirmed) selectEl.value = prev; });
  }
  function openReturnDialog(order, selectEl, status, prev) {
    var confirmed = false;
    var dlg = dialog('<form method="dialog"><h2>Mark as ' + status + '</h2><p class="sub">' + (order.stockDeducted ? 'Stock already taken out for this order is restored to ' + (order.stockPool === 'dome' ? 'Dome' : 'Spintex') + '.' : 'No stock was taken out for this order yet, so nothing is restored.') + '</p>' +
      '<div class="field"><label for="ret-reason">Reason</label><input id="ret-reason" type="text" value="' + esc(order.returnReason || '') + '"></div>' +
      '<div class="field"><label for="ret-amount">Refund amount</label><input id="ret-amount" type="number" min="0" step="0.01" value="' + (order.refundAmount || order.total || 0) + '"></div>' +
      '<p class="err"></p><div class="actions"><button class="btn" type="button" data-close>Cancel</button><button class="btn primary" type="submit">Confirm</button></div></form>',
      function (d, showErr) {
        api('/api/orders/' + order.id + '/return', { method: 'PATCH', body: { status: status, returnReason: $('#ret-reason', d).value.trim(), refundAmount: $('#ret-amount', d).value } })
          .then(function (r) { confirmed = true; Object.assign(order, r.order); d.close(); toast('Marked ' + status + '.'); renderOrderDetail(); }).catch(fail(showErr));
      });
    dlg.addEventListener('close', function () { if (!confirmed) selectEl.value = prev; });
  }
  // Two distinct actions for when a customer calls back wanting changes to an order already
  // taken — "Add item" (they want more) and "Change item" (swap a line for something else).
  function productOptionsHtml(selectedId) {
    return '<option value="">— custom item (no linked product) —</option>' + S.products.map(function (p) { return '<option value="' + esc(p.id) + '"' + (selectedId === p.id ? ' selected' : '') + '>' + esc(p.name) + '</option>'; }).join('');
  }
  function openAddItemDialog(order) {
    var dlg = dialog('<form method="dialog"><h2>Add item</h2>' +
      '<div class="field"><label for="ai-product">Product</label><select id="ai-product">' + productOptionsHtml('') + '</select></div>' +
      '<div class="field"><label for="ai-name">Description (for a custom item)</label><input id="ai-name" type="text"></div>' +
      '<div class="row2"><div class="field"><label for="ai-price">Price</label><input id="ai-price" type="number" min="0" step="0.01"></div><div class="field"><label for="ai-qty">Qty</label><input id="ai-qty" type="number" min="1" step="1" value="1"></div></div>' +
      '<div class="row2"><div class="field"><label for="ai-color">Colour</label><input id="ai-color" type="text"></div><div class="field"><label for="ai-size">Size</label><input id="ai-size" type="text"></div></div>' +
      '<p class="err"></p><div class="actions"><button class="btn" type="button" data-close>Cancel</button><button class="btn primary" type="submit">Add item</button></div></form>',
      function (d, showErr) {
        var pid = $('#ai-product', d).value;
        var body = { color: $('#ai-color', d).value.trim(), size: $('#ai-size', d).value.trim(), quantity: $('#ai-qty', d).value };
        if (pid) body.productId = pid; else { body.name = $('#ai-name', d).value.trim(); body.price = $('#ai-price', d).value; }
        api('/api/orders/' + order.id + '/items/add', { method: 'PATCH', body: body })
          .then(function (r) { Object.assign(order, r.order); d.close(); toast('Item added.'); renderOrderDetail(); }).catch(fail(showErr));
      });
    $('#ai-product', dlg).addEventListener('change', function () { var p = productById(this.value); if (p && !$('#ai-price', dlg).value) $('#ai-price', dlg).value = p.price; });
  }
  function openChangeItemDialog(order, idx) {
    var it = order.items[idx]; if (!it) return;
    var dlg = dialog('<form method="dialog"><h2>Change item</h2><p class="sub">Currently: ' + esc(it.name) + (it.color || it.size ? ' (' + esc([it.color, it.size].filter(Boolean).join(' ')) + ')' : '') + ' ×' + it.quantity + '</p>' +
      '<div class="field"><label for="ci-product">Product</label><select id="ci-product">' + productOptionsHtml(it.id) + '</select></div>' +
      '<div class="field"><label for="ci-name">Description (for a custom item)</label><input id="ci-name" type="text" value="' + (it.id ? '' : esc(it.name)) + '"></div>' +
      '<div class="row2"><div class="field"><label for="ci-price">Price</label><input id="ci-price" type="number" min="0" step="0.01" value="' + esc(it.price) + '"></div><div class="field"><label for="ci-qty">Qty</label><input id="ci-qty" type="number" min="1" step="1" value="' + esc(it.quantity) + '"></div></div>' +
      '<div class="row2"><div class="field"><label for="ci-color">Colour</label><input id="ci-color" type="text" value="' + esc(it.color || '') + '"></div><div class="field"><label for="ci-size">Size</label><input id="ci-size" type="text" value="' + esc(it.size || '') + '"></div></div>' +
      '<p class="err"></p><div class="actions"><button class="btn" type="button" data-close>Cancel</button><button class="btn primary" type="submit">Save change</button></div></form>',
      function (d, showErr) {
        var pid = $('#ci-product', d).value;
        var body = { index: idx, color: $('#ci-color', d).value.trim(), size: $('#ci-size', d).value.trim(), quantity: $('#ci-qty', d).value };
        if (pid) body.productId = pid; else { body.name = $('#ci-name', d).value.trim(); body.price = $('#ci-price', d).value; }
        api('/api/orders/' + order.id + '/items/change', { method: 'PATCH', body: body })
          .then(function (r) { Object.assign(order, r.order); d.close(); toast('Item changed.'); renderOrderDetail(); }).catch(fail(showErr));
      });
    $('#ci-product', dlg).addEventListener('change', function () { var p = productById(this.value); if (p) $('#ci-price', dlg).value = p.price; });
  }
  A['add-item'] = function (t) { var order = orderById(t.dataset.id); if (order) openAddItemDialog(order); };
  A['change-item'] = function (t) { var order = orderById(t.dataset.id); if (order) openChangeItemDialog(order, parseInt(t.dataset.idx, 10)); };
  A['save-tracking'] = function () {
    var order = orderById(currentOrderId); if (!order) return;
    api('/api/orders/' + order.id + '/tracking', { method: 'PATCH', body: { trackingNumber: $('#trk-number').value, trackingCarrier: $('#trk-carrier').value } })
      .then(function (r) { Object.assign(order, r.order); toast('Tracking saved.'); }).catch(function (e) { toast(e.message, true); });
  };
  A['add-note'] = function () {
    var order = orderById(currentOrderId); if (!order) return;
    var note = ($('#note-input').value || '').trim(); if (!note) return;
    api('/api/orders/' + order.id + '/note', { method: 'PATCH', body: { note: note } })
      .then(function (r) { Object.assign(order, r.order); toast('Note added.'); renderOrderDetail(); }).catch(function (e) { toast(e.message, true); });
  };
  A['delete-order'] = function (t) {
    if (!window.confirm('Delete this order? This cannot be undone.')) return;
    api('/api/orders/' + t.dataset.id, { method: 'DELETE' }).then(function () {
      S.orders = S.orders.filter(function (o) { return o.id !== t.dataset.id; });
      toast('Order deleted.'); location.hash = '#/';
    }).catch(function (e) { toast(e.message, true); });
  };

  // ── INVOICE (manual order entry) ─────────────────────────────────────────────
  var inv = null;
  function newInvoiceDraft() { return { customer: { name: '', phone: '', email: '', address: '' }, notes: '', discount: '', deliveryFee: '', invoiceNum: '', seq: 1, items: { r0: { productId: '', description: '', price: '', qty: 1, color: '', size: '' } } }; }
  V.invoice = function () { if (!inv) inv = newInvoiceDraft(); renderInvoice(); };
  function renderInvoice() {
    var rows = Object.keys(inv.items).map(function (k) {
      var it = inv.items[k];
      var opts = '<option value="">— pick a product (optional) —</option>' + S.products.map(function (p) { return '<option value="' + esc(p.id) + '"' + (it.productId === p.id ? ' selected' : '') + '>' + esc(p.name) + '</option>'; }).join('');
      return '<div class="card" style="padding:12px"><select data-in="inv-product" data-k="' + k + '" style="margin-bottom:8px">' + opts + '</select>' +
        '<div class="inv-row">' +
        '<input type="text" placeholder="Description" data-in="inv-desc" data-k="' + k + '" value="' + esc(it.description) + '">' +
        '<input type="number" min="0" step="0.01" placeholder="Price" data-in="inv-price" data-k="' + k + '" value="' + esc(it.price) + '">' +
        '<input type="number" min="1" step="1" placeholder="Qty" data-in="inv-qty" data-k="' + k + '" value="' + esc(it.qty) + '">' +
        '<input type="text" placeholder="Colour" data-in="inv-color" data-k="' + k + '" value="' + esc(it.color) + '">' +
        '<input type="text" placeholder="Size" data-in="inv-size" data-k="' + k + '" value="' + esc(it.size) + '">' +
        '<button type="button" class="btn small danger" data-act="inv-remove" data-k="' + k + '" aria-label="Remove item">&times;</button></div></div>';
    }).join('');
    var subtotal = Object.keys(inv.items).reduce(function (a, k) { var it = inv.items[k]; return a + (parseFloat(it.price) || 0) * (parseInt(it.qty, 10) || 1); }, 0);
    var total = Math.max(0, subtotal + (parseFloat(inv.deliveryFee) || 0) - (parseFloat(inv.discount) || 0));
    app.innerHTML = pageHead('New invoice', 'Record an order taken by phone or in person.') +
      '<div class="card"><h3>Customer</h3><div class="field"><label for="inv-name">Name</label><input id="inv-name" type="text" data-in="inv-cust-name" value="' + esc(inv.customer.name) + '"></div>' +
      '<div class="row2"><div class="field"><label for="inv-phone">Phone</label><input id="inv-phone" type="tel" data-in="inv-cust-phone" value="' + esc(inv.customer.phone) + '"></div>' +
      '<div class="field"><label for="inv-email">Email (optional)</label><input id="inv-email" type="email" data-in="inv-cust-email" value="' + esc(inv.customer.email) + '"></div></div>' +
      '<div class="field"><label for="inv-addr">Delivery address</label><input id="inv-addr" type="text" data-in="inv-cust-address" value="' + esc(inv.customer.address) + '"></div></div>' +
      '<div class="card"><h3>Items</h3>' + rows + '<button type="button" class="btn small" data-act="inv-add">+ Add item</button></div>' +
      '<div class="card"><div class="row2"><div class="field"><label for="inv-disc">Discount</label><input id="inv-disc" type="number" min="0" step="0.01" data-in="inv-discount" value="' + esc(inv.discount) + '"></div>' +
      '<div class="field"><label for="inv-del">Delivery fee</label><input id="inv-del" type="number" min="0" step="0.01" data-in="inv-delivery" value="' + esc(inv.deliveryFee) + '"></div></div>' +
      '<div class="field"><label for="inv-num">Invoice number (optional — auto if blank)</label><input id="inv-num" type="text" data-in="inv-invnum" value="' + esc(inv.invoiceNum) + '"></div>' +
      '<div class="field"><label for="inv-notes">Notes (optional)</label><textarea id="inv-notes" data-in="inv-notes">' + esc(inv.notes) + '</textarea></div></div>' +
      '<div class="sticky-bar"><div><b>' + money(total) + '</b><small>' + Object.keys(inv.items).length + ' item(s) · subtotal ' + money(subtotal) + '</small></div></div>' +
      '<p class="err" id="inv-err"></p>' +
      '<div class="actions"><button class="btn" data-act="inv-save">Save</button><button class="btn" data-act="inv-save-email">Save &amp; email</button><button class="btn primary" data-act="inv-email-only">Email only (no stock change)</button></div>';
  }
  I['inv-cust-name'] = function (t) { inv.customer.name = t.value; };
  I['inv-cust-phone'] = function (t) { inv.customer.phone = t.value; };
  I['inv-cust-email'] = function (t) { inv.customer.email = t.value; };
  I['inv-cust-address'] = function (t) { inv.customer.address = t.value; };
  I['inv-discount'] = function (t) { inv.discount = t.value; };
  I['inv-delivery'] = function (t) { inv.deliveryFee = t.value; };
  I['inv-invnum'] = function (t) { inv.invoiceNum = t.value; };
  I['inv-notes'] = function (t) { inv.notes = t.value; };
  I['inv-desc'] = function (t) { inv.items[t.dataset.k].description = t.value; };
  I['inv-price'] = function (t) { inv.items[t.dataset.k].price = t.value; renderInvoiceTotalsOnly(); };
  I['inv-qty'] = function (t) { inv.items[t.dataset.k].qty = t.value; renderInvoiceTotalsOnly(); };
  I['inv-color'] = function (t) { inv.items[t.dataset.k].color = t.value; };
  I['inv-size'] = function (t) { inv.items[t.dataset.k].size = t.value; };
  function renderInvoiceTotalsOnly() {
    var bar = $('.sticky-bar b'); if (!bar) return;
    var subtotal = Object.keys(inv.items).reduce(function (a, k) { var it = inv.items[k]; return a + (parseFloat(it.price) || 0) * (parseInt(it.qty, 10) || 1); }, 0);
    var total = Math.max(0, subtotal + (parseFloat(inv.deliveryFee) || 0) - (parseFloat(inv.discount) || 0));
    bar.textContent = money(total);
    var small = $('.sticky-bar small'); if (small) small.textContent = Object.keys(inv.items).length + ' item(s) · subtotal ' + money(subtotal);
  }
  C['inv-product'] = function (t) {
    var it = inv.items[t.dataset.k], p = productById(t.value);
    it.productId = t.value || '';
    if (p) { if (!it.description) it.description = p.name; if (!it.price) it.price = p.price; }
    renderInvoice();
  };
  A['inv-add'] = function () { var k = 'r' + (inv.seq++); inv.items[k] = { productId: '', description: '', price: '', qty: 1, color: '', size: '' }; renderInvoice(); };
  A['inv-remove'] = function (t) { delete inv.items[t.dataset.k]; if (!Object.keys(inv.items).length) inv.items.r0 = { productId: '', description: '', price: '', qty: 1, color: '', size: '' }; renderInvoice(); };
  function buildInvoicePayload(mode) {
    var items = Object.keys(inv.items).map(function (k) { var it = inv.items[k]; return { productId: it.productId || null, description: it.description, price: it.price, qty: it.qty, color: it.color, size: it.size }; }).filter(function (it) { return it.description; });
    return { customer: inv.customer, items: items, discount: inv.discount, deliveryFee: inv.deliveryFee, notes: inv.notes, invoiceNum: inv.invoiceNum, mode: mode };
  }
  function saveInvoice(mode) {
    var err = $('#inv-err'); err.textContent = '';
    var payload = buildInvoicePayload(mode);
    if (!payload.customer.name) { err.textContent = 'Customer name is required.'; return; }
    if ((mode === 'save_email' || mode === 'email_only') && !payload.customer.email) { err.textContent = 'Enter the customer\'s email to send the invoice by email.'; return; }
    if (!payload.items.length) { err.textContent = 'Add at least one item with a description.'; return; }
    api('/api/admin/manual-invoice', { method: 'POST', body: payload }).then(function (r) {
      toast(mode === 'email_only' ? 'Email sent.' : 'Invoice saved.');
      var order = r.order;
      if (order && mode !== 'email_only') S.orders.unshift(order);
      inv = null;
      var wa = order ? waUrl(order) : '';
      if (order && wa) { app.innerHTML = pageHead('Invoice saved', orderRef(order) + ' — ' + money(order.total)) + '<div class="actions"><a class="btn gold" target="_blank" rel="noopener" href="' + wa + '">Share on WhatsApp</a><a class="btn" href="#/">Back to orders</a></div>'; return; }
      location.hash = '#/';
    }).catch(function (e) { err.textContent = e.message; });
  }
  A['inv-save'] = function () { saveInvoice('save'); };
  A['inv-save-email'] = function () { saveInvoice('save_email'); };
  A['inv-email-only'] = function () { saveInvoice('email_only'); };

  // ── CODES ──────────────────────────────────────────────────────────────────
  V.codes = function () {
    api('/api/codes').then(function (list) {
      S.codes = list;
      var rows = list.map(function (c) {
        return '<tr><td><b>' + esc(c.code) + '</b></td><td>' + (c.type === 'percent' ? c.value + '%' : money(c.value)) + '</td><td class="num">' + (c.minOrder ? money(c.minOrder) : '—') + '</td>' +
          '<td class="num">' + c.usedCount + (c.maxUses ? ' / ' + c.maxUses : '') + '</td><td class="num">' + money(c.totalRevenue) + '</td>' +
          '<td>' + (c.expiresAt ? new Date(c.expiresAt).toLocaleDateString('en-GB') : '—') + '</td>' +
          '<td>' + (S.canManage ? '<button class="btn small danger" data-act="code-delete" data-code="' + esc(c.code) + '">Delete</button>' : '') + '</td></tr>';
      }).join('');
      app.innerHTML = pageHead('Promo codes', list.length + ' code(s)') +
        '<div class="card"><h3>Create a code</h3>' +
        '<div class="row2"><div class="field"><label for="code-code">Code</label><input id="code-code" type="text" placeholder="e.g. WELCOME10"></div><div class="field"><label for="code-type">Type</label><select id="code-type"><option value="percent">Percent off</option><option value="fixed">Fixed amount off</option></select></div></div>' +
        '<div class="row2"><div class="field"><label for="code-value">Value</label><input id="code-value" type="number" min="0" step="0.01" placeholder="e.g. 10"></div><div class="field"><label for="code-min">Minimum order (optional)</label><input id="code-min" type="number" min="0" step="0.01"></div></div>' +
        '<div class="row2"><div class="field"><label for="code-max">Max uses (optional)</label><input id="code-max" type="number" min="0" step="1"></div><div class="field"><label for="code-exp">Expires (optional)</label><input id="code-exp" type="date"></div></div>' +
        '<div class="field"><label for="code-ref">Referrer (optional)</label><input id="code-ref" type="text" placeholder="who gets credit for this code"></div>' +
        '<p class="err" id="code-err"></p><div class="actions"><button class="btn primary" data-act="code-create">Create code</button></div></div>' +
        '<div class="card flat"><div class="scroll-x"><table><thead><tr><th>Code</th><th>Value</th><th class="num">Min order</th><th class="num">Used</th><th class="num">Revenue</th><th>Expires</th><th></th></tr></thead><tbody>' + (rows || '<tr><td colspan="7" class="empty">No codes yet.</td></tr>') + '</tbody></table></div></div>';
    }).catch(fail());
  };
  A['code-create'] = function () {
    var err = $('#code-err'); err.textContent = '';
    var code = $('#code-code').value.trim(), type = $('#code-type').value, value = $('#code-value').value;
    if (!code || !value) { err.textContent = 'Code and value are required.'; return; }
    api('/api/codes', { method: 'POST', body: { code: code, type: type, value: value, minOrder: $('#code-min').value, maxUses: $('#code-max').value, expiresAt: $('#code-exp').value || null, referrer: $('#code-ref').value } })
      .then(function () { toast('Code created.'); V.codes(); }).catch(function (e) { err.textContent = e.message; });
  };
  A['code-delete'] = function (t) {
    if (!window.confirm('Delete code ' + t.dataset.code + '?')) return;
    api('/api/codes/' + encodeURIComponent(t.dataset.code), { method: 'DELETE' }).then(function () { toast('Code deleted.'); V.codes(); }).catch(function (e) { toast(e.message, true); });
  };

  // ── STOCK (read-only — Dome + Spintex) ──────────────────────────────────────
  function colourName(v) { return typeof v === 'string' ? v : (v && (v.color || v.name)) || ''; }
  function unionSizes(p) { var seen = {}, out = []; p.colours.forEach(function (c) { c.sizes.forEach(function (s) { if (!seen[s]) { seen[s] = 1; out.push(s); } }); }); Object.keys(p.skus).forEach(function (k) { var s = k.split('|')[1]; if (!seen[s]) { seen[s] = 1; out.push(s); } }); return out; }
  function sizeIn(p, c, s) { var col = p.colours.filter(function (x) { return x.name === c; })[0]; return col ? col.sizes.indexOf(s) >= 0 : !!p.skus[c + '|' + s]; }
  function typeGroups(list) { var g = {}, order = []; list.forEach(function (p) { if (!g[p.type]) { g[p.type] = []; order.push(p.type); } g[p.type].push(p); }); return order.map(function (t) { return { type: t, items: g[t] }; }); }
  V.stock = function () {
    api('/api/supply/stock-summary').then(function (d) {
      if (!d.tracking) { app.innerHTML = pageHead('Stock', 'By colour and size') + '<div class="card notice warn"><b>Size stock is off.</b> The website still uses its old stock numbers. Ask an owner/manager to turn it on in Admin &rsaquo; Stock.</div>'; return; }
      var groups = typeGroups(d.products).map(function (g) {
        return '<h3 class="rk-h">' + esc(g.type) + '</h3>' + g.items.map(function (p) {
          var sizes = unionSizes(p), cols = p.colours.map(function (c) { return c.name; });
          var head = '<div></div>' + sizes.map(function (s) { return '<div class="cl">' + esc(s || 'Packs') + '</div>'; }).join('');
          var cells = cols.map(function (c) {
            return '<div class="rl">' + esc(c || 'Packs') + '</div>' + sizes.map(function (s) {
              if (!sizeIn(p, c, s)) return '<div class="na">—</div>';
              var r = p.skus[c + '|' + s] || { dome: 0, spintex: 0 }, n = r.dome + r.spintex;
              return '<div class="scell' + (n === 0 ? ' zero' : '') + '" title="Dome ' + r.dome + ' · Spintex ' + r.spintex + '"><b>' + n + '</b><small>' + r.dome + '/' + r.spintex + '</small></div>';
            }).join('');
          }).join('');
          return '<details class="prod"><summary><span><b>' + esc(p.name) + '</b>' + (p.brand ? '<br><span class="sub">' + esc(p.brand) + '</span>' : '') + '</span><span class="badge ' + (p.totals.dome + p.totals.spintex ? 'gold' : '') + '">' + (p.totals.dome + p.totals.spintex) + ' packs</span></summary>' +
            '<div class="body"><div class="scroll-x"><div class="matrix" style="grid-template-columns:72px repeat(' + sizes.length + ',minmax(54px,1fr))">' + head + cells + '</div></div><p class="hint">Each box shows the total, then Dome / Spintex.</p></div></details>';
        }).join('');
      }).join('');
      app.innerHTML = pageHead('Stock', 'In packs of 3, by colour and size — view only') +
        '<div class="grid2 pools"><div class="card stat"><b>' + d.totals.dome + '</b><span>Dome</span></div><div class="card stat"><b>' + d.totals.spintex + '</b><span>Spintex</span></div></div>' +
        '<p class="hint no-print">Receiving stock, moving Dome &rarr; Spintex and stock counts are done in <a href="/admin.html">Admin &rsaquo; Stock</a>.</p>' + groups;
    }).catch(fail());
  };

  // ── MORE ───────────────────────────────────────────────────────────────────
  V.more = function () {
    app.innerHTML = pageHead('More', (S.me && S.me.name ? S.me.name : '') + (S.me ? ' (' + S.me.role + ')' : '')) +
      '<div class="card"><div class="actions">' + (S.canManage ? '<a class="btn" href="/admin.html">Open Admin</a>' : '') + (S.canManage ? '<a class="btn" href="/supply.html">Open Supply</a>' : '') + '<button class="btn danger" data-act="sign-out">Sign out</button></div></div>';
  };
  A['sign-out'] = function () {
    api('/api/admin/logout', { method: 'POST' }).catch(function () {}).then(function () { lsDel(TOKEN_KEY); token = ''; location.hash = '#/'; renderLogin(); });
  };

  // ── events ───────────────────────────────────────────────────────────────
  app.addEventListener('click', function (e) { var t = e.target.closest('[data-act]'); if (!t) return; var f = A[t.dataset.act]; if (f) f(t, e); });
  app.addEventListener('input', function (e) { var t = e.target, kind = t.dataset && t.dataset.in; if (kind && I[kind]) I[kind](t, e); });
  app.addEventListener('change', function (e) { var t = e.target, kind = t.dataset && t.dataset.in; if (kind && C[kind]) C[kind](t, e); });

  window.addEventListener('load', boot);
})();
