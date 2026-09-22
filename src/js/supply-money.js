// Supply — money side: shops, supplies, payments, cheques, tax invoices, calls, prices, settings, reports.
(function () {
  'use strict';
  var U = window.SUP, S = U.S, V = U.V, A = U.A, I = U.I, C = U.C;
  var $ = U.$, $$ = U.$$, esc = U.esc, money = U.money, r2 = U.r2, fmtDate = U.fmtDate, api = U.api, app = U.app, toast = U.toast, W = U.W, dialog = U.dialog, pageHead = U.pageHead;
  var STATUS_BADGE = { paid: ['Paid', ''], unpaid: ['Unpaid', 'gold'], partial: ['Part paid', 'gold'], overdue: ['Overdue', 'red'], void: ['Void', ''], 'n/a': ['', ''] };
  function statusBadge(s) { var b = STATUS_BADGE[s.status] || [s.status, '']; return b[0] ? '<span class="badge ' + b[1] + '">' + b[0] + '</span>' : ''; }
  function shopOpts(sel, includeSpecial, blank) { return (blank && !sel ? '<option value="">Choose a shop…</option>' : '') + S.shops.filter(function (s) { return s.active !== false && (includeSpecial || s.type !== 'online'); }).sort(function (a, b) { return (a.builtIn ? 1 : 0) - (b.builtIn ? 1 : 0) || a.name.localeCompare(b.name); }).map(function (s) { return '<option value="' + esc(s.id) + '"' + (s.id === sel ? ' selected' : '') + '>' + esc(s.name) + '</option>'; }).join(''); }
  function notFound(e) { toast(e.message, true); app.innerHTML = pageHead('Not found', esc(e.message)) + '<div class="actions"><a class="btn" href="#/">Home</a></div>'; }
  function fail(showErr) { return function (e) { if (showErr) showErr(e.message); else toast(e.message, true); }; }
  function tel(phone) { return phone ? '<a href="tel:' + esc(phone.replace(/[^\d+]/g, '')) + '">' + esc(phone) + '</a>' : ''; }
  function download(name, blob) { var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000); }
  function fieldRow(id, label, val, type, extra) { return '<div class="field"><label for="' + id + '">' + label + '</label><input id="' + id + '" type="' + (type || 'text') + '" value="' + esc(val == null ? '' : val) + '" ' + (extra || '') + '></div>'; }

  // ── MORE (menu) ────────────────────────────────────────────────────────────
  V.more = function () {
    var items = [['#/cheques', 'Cheques', 'Pick-ups, pay-ins, clearing'], ['#/calls', 'Calls and requests', 'Shops that called you'], ['#/rankings', 'Rankings', 'Shops, products, payment'], ['#/daily', 'Daily transactions', 'Everything on one day'],
      ['#/receivables', 'Who owes what', 'Printable list for your boss'], ['#/vat', 'VAT summary', 'Monthly tax figures']];
    if (S.canWrite) items.push(['#/stock', 'Stock', 'Packs in each pool'], ['#/prices', 'Prices', 'Supply price and invoice names'], ['#/settings', 'Settings', 'Company details, backup, practice']);
    else items.unshift(['#/supplies', 'Supplies', 'Every invoice'], ['#/shops', 'Shops', 'Who owes what, per shop']);
    app.innerHTML = pageHead('More', S.me ? esc(S.me.name || S.me.username) + ' · ' + esc(S.me.role) : '') +
      items.map(function (i) { return '<a class="list-item" href="' + i[0] + '" style="text-decoration:none"><span><b>' + i[1] + '</b><small>' + i[2] + '</small></span><span>›</span></a>'; }).join('') +
      '<div class="actions"><button class="btn" data-act="signout">Sign out</button></div>';
  };
  A.signout = function () { try { localStorage.removeItem('freeman_admin_token'); } catch (e) {} location.hash = '#/'; location.reload(); };

  // ── SHOPS ──────────────────────────────────────────────────────────────────
  var shopQ = '';
  V.shops = function () {
    var q = shopQ.toLowerCase();
    U.refreshData().catch(function () {}).then(function () {
      var list = S.shops.filter(function (s) { return s.active !== false && (!q || s.name.toLowerCase().indexOf(q) >= 0); });
      var inactive = S.shops.filter(function (s) { return s.active === false; });
      app.innerHTML = pageHead('Shops', list.length + ' shops', W('<button class="btn small gold" data-act="shop-add">Add shop</button>')) +
        '<div class="field"><input type="search" placeholder="Search shops" data-in="shop-search" value="' + esc(shopQ) + '" aria-label="Search shops"></div>' +
        list.map(function (s) {
          var flag = s.overdue > 0.005 ? '<span class="badge red">overdue</span>' : (s.balance > 0.005 ? '<span class="badge gold">owes</span>' : '');
          return '<a class="list-item" href="#/shop/' + esc(s.id) + '" style="text-decoration:none"><span><b>' + esc(s.name) + '</b> ' + flag + '<small>' + (s.balance > 0.005 ? 'Owes ' + money(s.balance) + ' · ' : '') + (s.lastSupplyDate ? 'last ' + esc(fmtDate(s.lastSupplyDate)) : 'no supply yet') + '</small></span><span>›</span></a>';
        }).join('') + (inactive.length ? '<p class="sub mt">' + inactive.length + ' inactive: ' + inactive.map(function (s) { return '<a href="#/shop/' + esc(s.id) + '">' + esc(s.name) + '</a>'; }).join(', ') + '</p>' : '');
    });
  };
  I['shop-search'] = U.debounce(function (t) { shopQ = t.value; V.shops(); setTimeout(function () { var s = $('[data-in="shop-search"]'); if (s) { s.focus(); s.setSelectionRange(s.value.length, s.value.length); } }, 300); }, 250);
  A['shop-add'] = function () { C.shopDialog(null, function (shop) { location.hash = '#/shop/' + shop.id; }); };
  C.shopDialog = function (shop, done) {
    var s = shop || { termsDays: 30 };
    dialog('<form method="dialog"><h2>' + (shop ? 'Edit shop' : 'New shop') + '</h2>' + fieldRow('sd-name', 'Shop name', s.name, 'text', 'required' + (s.builtIn ? ' readonly' : '')) + fieldRow('sd-contact', 'Contact person', s.contact) + fieldRow('sd-phone', 'Phone', s.phone, 'tel') +
      fieldRow('sd-address', 'Address / area', s.address) + fieldRow('sd-tin', 'Shop TIN (for the tax invoice)', s.tin) +
      '<div class="row2">' + fieldRow('sd-terms', 'Payment terms (days)', s.termsDays, 'number', 'min="0" max="365" inputmode="numeric"') + fieldRow('sd-limit', 'Credit limit (GH₵)', s.creditLimit, 'number', 'min="0" step="0.01" inputmode="decimal" placeholder="none"') + '</div>' +
      fieldRow('sd-reorder', 'Re-visit reminder after (days)', s.reorderDays, 'number', 'min="1" max="365" inputmode="numeric" placeholder="' + (S.settings.reorderDays || 30) + '"') +
      '<div class="field"><label for="sd-notes">Notes</label><textarea id="sd-notes">' + esc(s.notes || '') + '</textarea></div>' +
      (shop && !s.builtIn ? '<label style="display:flex;gap:8px;align-items:center;text-transform:none;letter-spacing:0;font-size:14px;color:var(--dark)"><input type="checkbox" id="sd-active" ' + (s.active !== false ? 'checked' : '') + '> Active shop</label>' : '') +
      '<p class="err"></p><div class="actions"><button class="btn" type="button" data-close>Cancel</button><button class="btn primary" type="submit">Save</button></div></form>',
      function (d, showErr) {
        var body = { name: $('#sd-name', d).value, contact: $('#sd-contact', d).value, phone: $('#sd-phone', d).value, address: $('#sd-address', d).value, tin: $('#sd-tin', d).value, termsDays: $('#sd-terms', d).value,
          creditLimit: $('#sd-limit', d).value, reorderDays: $('#sd-reorder', d).value, notes: $('#sd-notes', d).value };
        if ($('#sd-active', d)) body.active = $('#sd-active', d).checked;
        api(shop ? '/api/supply/shops/' + shop.id : '/api/supply/shops', { method: shop ? 'PUT' : 'POST', body: body }).then(function (r) {
          d.close(); return U.refreshData().then(function () { toast('Shop saved.'); if (done) done(r.shop); });
        }).catch(fail(showErr));
      });
  };
  V.shop = function (parts) {
    var id = parts[1];
    Promise.all([api('/api/supply/shops/' + id), api('/api/supply/rankings?includeSpecial=true').catch(function () { return null; })]).then(function (rr) {
      var d = rr[0], rk = rr[1];
      var takes = rk ? rk.perShopProduct.filter(function (x) { return x.shopId === id && x.net !== 0; }).sort(function (a, b) { return b.net - a.net; }) : [];
      var takesHtml = takes.length ? '<div class="card"><h3>What this shop takes</h3>' + takes.slice(0, 8).map(function (x) { return '<div class="line"><div class="t">' + esc(x.name) + '</div><div><b>' + x.net + ' packs</b><div class="m">' + x.supplied + ' supplied' + (x.takenBack ? ', ' + x.takenBack + ' back' : '') + '</div></div></div>'; }).join('') + '</div>' : '';
      var s = d.shop, real = d.supplies.filter(function (x) { return !x.voided; });
      var open = real.filter(function (x) { return x.balance > 0.005 && (!x.kind || x.kind === 'supply'); });
      var stats = '<div class="grid2"><div class="card stat"><b>' + money(s.balance) + '</b><span>Owes' + (s.overdue > 0.005 ? ' (' + money(s.overdue) + ' overdue)' : '') + '</span></div><div class="card stat"><b>' + money(s.totalSupplied) + '</b><span>Supplied in total (' + s.supplyCount + ')</span></div></div>';
      var extra = [];
      if (s.chequePending > 0.005) extra.push(money(s.chequePending) + ' in cheques not cleared yet');
      if (s.credit > 0.005) extra.push(money(s.credit) + ' credit held for this shop');
      if (s.creditLimit != null) extra.push('credit limit ' + money(s.creditLimit));
      var info = '<div class="card"><div class="spaced"><h2>' + esc(s.name) + '</h2>' + W('<button class="btn small" data-act="shop-edit" data-id="' + esc(s.id) + '">Edit</button>') + '</div>' +
        '<p class="sub">' + [s.contact, tel(s.phone), s.address].filter(Boolean).join(' · ') + '</p><p class="sub">Terms ' + s.termsDays + ' days' + (s.tin ? ' · TIN ' + esc(s.tin) : '') + (s.active === false ? ' · <b>inactive</b>' : '') + '</p>' + (extra.length ? '<p class="sub">' + esc(extra.join(' · ')) + '</p>' : '') + (s.notes ? '<p class="sub">' + esc(s.notes) + '</p>' : '') + '</div>';
      var actions = S.canWrite && s.type !== 'online' ? '<div class="actions no-print"><button class="btn gold" data-act="pay-shop" data-id="' + esc(s.id) + '">Payment</button><a class="btn" href="#/pickup/' + esc(s.id) + '">Pick up cheque</a><button class="btn" data-act="new-call" data-id="' + esc(s.id) + '">Log a call</button><button class="btn" data-act="earlier-invoice" data-id="' + esc(s.id) + '">Add earlier invoice</button></div>' : '';
      var openHtml = open.length ? '<div class="card flat"><div style="padding:14px 16px"><h3>Unpaid invoices</h3></div><div class="scroll-x"><table><tbody>' + open.map(function (x) {
        return '<tr class="click" data-act="open-supply" data-id="' + esc(x.id) + '"><td><b>' + esc(x.invoiceNo) + '</b><br><span class="sub">due ' + esc(fmtDate(x.dueDate)) + '</span></td><td>' + statusBadge(x) + '</td><td class="num">' + money(x.balance) + '</td></tr>'; }).join('') + '</tbody></table></div></div>' : '';
      var hist = '<div class="card flat"><div style="padding:14px 16px"><h3>All supplies</h3></div>' + (d.supplies.length ? '<div class="scroll-x"><table><tbody>' + d.supplies.map(function (x) {
        var lab = x.kind === 'swap' ? '<span class="badge">swap</span>' : x.kind === 'credit' ? '<span class="badge">credit</span>' : statusBadge(x);
        return '<tr class="click' + (x.voided ? ' void' : '') + '" data-act="open-supply" data-id="' + esc(x.id) + '"><td>' + esc(fmtDate(x.date)) + '</td><td><b>' + esc(x.invoiceNo) + '</b></td><td>' + (x.voided ? '<span class="badge">void</span>' : lab) + '</td><td class="num">' + money(x.kind === 'credit' ? -x.creditAmount : x.amount) + '</td></tr>'; }).join('') + '</tbody></table></div>' : '<p class="empty">No supplies yet.</p>') + '</div>';
      var chq = d.cheques.length ? '<div class="card flat"><div style="padding:14px 16px"><h3>Cheques</h3></div><div class="scroll-x"><table><tbody>' + d.cheques.filter(function (c) { return !c.voided; }).map(function (c) {
        return '<tr class="click" data-act="open-cheque" data-id="' + esc(c.id) + '"><td><b>' + esc(c.chequeNo) + '</b><br><span class="sub">dated ' + esc(fmtDate(c.chequeDate)) + '</span></td><td><span class="badge ' + (c.status === 'bounced' ? 'red' : c.status === 'cleared' ? '' : 'gold') + '">' + esc(c.status) + '</span></td><td class="num">' + money(c.amount) + '</td></tr>'; }).join('') + '</tbody></table></div></div>' : '';
      var calls = d.calls.length ? '<div class="card"><h3>Calls</h3>' + d.calls.slice(0, 6).map(function (c) { return '<div class="line"><div><div class="t">' + esc(fmtDate(c.date)) + ' — ' + esc(c.type === 'stock' ? 'asked for stock' : c.type === 'cheque_ready' ? 'cheque ready' : 'call') + '</div><div class="m">' + esc(c.items || c.note || '') + '</div></div><span class="badge ' + (c.status === 'open' ? 'gold' : '') + '">' + esc(c.status) + '</span></div>'; }).join('') + '</div>' : '';
      app.innerHTML = '<p class="no-print"><a href="#/shops">‹ Shops</a></p>' + info + stats + actions + openHtml + takesHtml + chq + hist + calls;
    }).catch(notFound);
  };
  A['shop-edit'] = function (t) { var s = U.shopById(t.dataset.id); C.shopDialog(s, function () { V.shop(['shop', t.dataset.id]); }); };

  // ── SUPPLIES ───────────────────────────────────────────────────────────────
  var supFilter = { q: '', status: '' };
  V.supplies = function () {
    api('/api/supply/supplies' + (supFilter.status ? '?status=' + supFilter.status : '')).then(function (all) {
      var q = supFilter.q.toLowerCase();
      var list = all.filter(function (s) { return !q || (s.invoiceNo + ' ' + s.shopName).toLowerCase().indexOf(q) >= 0; });
      var chips = [['', 'All'], ['unpaid', 'Unpaid'], ['partial', 'Part paid'], ['overdue', 'Overdue'], ['paid', 'Paid']].map(function (c) { return '<button class="chip' + (supFilter.status === c[0] ? ' on' : '') + '" data-act="sup-status" data-s="' + c[0] + '">' + c[1] + '</button>'; }).join('');
      app.innerHTML = pageHead('Supplies', list.length + ' records') + '<div class="field"><input type="search" placeholder="Search invoice or shop" data-in="sup-search" value="' + esc(supFilter.q) + '" aria-label="Search supplies"></div><div class="chips">' + chips + '</div>' +
        '<div class="card flat">' + (list.length ? '<div class="scroll-x"><table><tbody>' + list.map(function (s) {
          var lab = s.kind === 'swap' ? '<span class="badge">swap</span>' : s.kind === 'credit' ? '<span class="badge">credit</span>' : statusBadge(s);
          return '<tr class="click" data-act="open-supply" data-id="' + esc(s.id) + '"><td>' + esc(fmtDate(s.date)) + '</td><td><b>' + esc(s.invoiceNo) + '</b><br><span class="sub">' + esc(s.shopName) + '</span></td><td>' + lab + '</td><td class="num">' + money(s.kind === 'credit' ? -s.creditAmount : s.amount) + '</td></tr>'; }).join('') + '</tbody></table></div>' : '<p class="empty">Nothing found.</p>') + '</div>';
    }).catch(function (e) { toast(e.message, true); });
  };
  A['sup-status'] = function (t) { supFilter.status = t.dataset.s; V.supplies(); };
  I['sup-search'] = U.debounce(function (t) { supFilter.q = t.value; V.supplies(); setTimeout(function () { var s = $('[data-in="sup-search"]'); if (s) { s.focus(); s.setSelectionRange(s.value.length, s.value.length); } }, 300); }, 250);

  V.supply = function (parts) {
    api('/api/supply/supplies/' + parts[1]).then(function (s) {
      var other = s.kind && s.kind !== 'supply';
      var pays = (s.payments || []).map(function (p) { return '<div class="line"><div><div class="t">' + money(p.amount) + ' · ' + esc(p.method) + (p.reference ? ' · ' + esc(p.reference) : '') + '</div><div class="m">' + esc(fmtDate(p.date)) + (p.voided ? ' · voided: ' + esc(p.voidReason) : '') + '</div></div>' + (S.canWrite && !p.voided ? '<button class="btn small" data-act="pay-void" data-id="' + esc(p.id) + '" data-sid="' + esc(s.id) + '">Void</button>' : '') + '</div>'; }).join('');
      var chq = (s.cheques || []).map(function (c) { return '<div class="line"><div><div class="t">Cheque ' + esc(c.chequeNo) + ' · ' + money(c.amount) + '</div><div class="m">dated ' + esc(fmtDate(c.chequeDate)) + '</div></div><span class="badge ' + (c.status === 'cleared' ? '' : 'gold') + '">' + esc(c.status) + '</span></div>'; }).join('');
      var hist = (s.history || []).map(function (h) { return '<div class="m">' + esc(new Date(h.at).toLocaleDateString('en-GB')) + ' · ' + esc(h.by) + ' · ' + esc(h.action) + (h.detail ? ': ' + esc(h.detail) : '') + '</div>'; }).join('');
      var canTax = !other && !s.voided;
      app.innerHTML = '<p class="no-print"><a href="#/shop/' + esc(s.shopId) + '">‹ ' + esc(s.shopName) + '</a></p>' + pageHead(other ? (s.kind === 'swap' ? 'Swap' : 'Credit') : 'Invoice', esc(s.invoiceNo) + (s.voided ? ' — VOID' : '')) +
        '<div class="card">' + U.companyHead() + '<div class="spaced mt"><div><label>Shop</label><b>' + esc(s.shopName) + '</b></div><div style="text-align:right"><label>Date</label><b>' + esc(fmtDate(s.date)) + '</b></div></div>' +
        (s.lines.length ? U.invoiceTable(U.recRows(s)) : '<p class="sub">Opening balance — no item lines.</p>') +
        (other ? '<div class="invtotals"><div class="grand"><span>NET</span><b>' + money(s.kind === 'credit' ? -s.creditAmount : 0) + '</b></div></div>' : U.totalsHtml(s.amount, s.vatAmount, s.vatRate, s.vatParts)) +
        (s.notes ? '<p class="sub mt">' + esc(s.notes) + '</p>' : '') + '</div>' +
        (other ? '' : '<div class="card"><div class="grid2"><div class="stat"><b>' + money(s.balance) + '</b><span>Balance ' + (s.status === 'overdue' ? '(overdue ' + s.daysOverdue + ' days)' : '· due ' + esc(fmtDate(s.dueDate))) + '</span></div><div class="stat"><b>' + money(s.paid) + '</b><span>Paid' + (s.chequePending ? ' · ' + money(s.chequePending) + ' cheque pending' : '') + '</span></div></div>' +
          '<p class="mt">' + statusBadge(s) + (canTax ? ' <span class="badge ' + (s.taxInvoice ? '' : 'gold') + '">' + (s.taxInvoice ? 'Tax invoice ' + esc(s.taxInvoice.serial) : 'No tax invoice yet') + '</span>' : '') + '</p></div>') +
        (pays || chq ? '<div class="card"><h3>Payments</h3>' + pays + chq + '</div>' : '') +
        '<div class="actions no-print">' + (canTax ? '<a class="btn" href="#/tax/' + esc(s.id) + '">Tax invoice</a>' : '') + '<button class="btn" data-act="print">Print</button>' +
        (S.canWrite && !s.voided ? (!other && s.balance > 0.005 ? '<button class="btn gold" data-act="pay-supply" data-id="' + esc(s.id) + '" data-shop="' + esc(s.shopId) + '">Payment</button>' : '') + '<button class="btn" data-act="sup-edit" data-id="' + esc(s.id) + '">Edit</button><button class="btn danger" data-act="sup-void" data-id="' + esc(s.id) + '">Void</button>' : '') + '</div>' +
        (hist ? '<div class="card no-print"><h3>History</h3>' + hist + '</div>' : '');
      window._sup = s;
    }).catch(notFound);
  };
  A['sup-void'] = function (t) {
    U.askReason('Void this record', function (reason, close, showErr) {
      api('/api/supply/supplies/' + t.dataset.id + '/void', { method: 'POST', body: { reason: reason } }).then(function () { close(); toast('Voided.'); return U.refreshData(); }).then(function () { V.supply(['supply', t.dataset.id]); }).catch(fail(showErr));
    });
  };
  A['sup-edit'] = function (t) {
    var s = window._sup; if (!s || s.id !== t.dataset.id) return;
    dialog('<form method="dialog"><h2>Edit invoice</h2>' + fieldRow('se-no', 'Hard-copy invoice number', s.invoiceNo) + '<div class="row2">' + fieldRow('se-date', 'Date', s.date, 'date') + fieldRow('se-terms', 'Terms (days)', s.termsDays, 'number', 'min="0" max="365" inputmode="numeric"') + '</div>' +
      (s.lines.length ? '' : fieldRow('se-amount', 'Invoice total (VAT included)', s.amount, 'number', 'min="0" step="0.01" inputmode="decimal"')) +
      '<div class="field"><label for="se-notes">Notes</label><textarea id="se-notes">' + esc(s.notes || '') + '</textarea></div><p class="hint">Items cannot be changed here. To correct items, void this record and enter it again.</p><p class="err"></p><div class="actions"><button class="btn" type="button" data-close>Cancel</button><button class="btn primary" type="submit">Save</button></div></form>',
      function (d, showErr) {
        var body = { shopId: s.shopId, invoiceNo: $('#se-no', d).value, date: $('#se-date', d).value, termsDays: $('#se-terms', d).value, notes: $('#se-notes', d).value,
          lines: s.lines.map(function (l) { return { productId: l.productId, description: l.description, colour: l.colour, size: l.size, packs: l.packs, unitPrice: l.unitPrice }; }),
          takenBack: (s.takenBack || []).map(function (l) { return { productId: l.productId, colour: l.colour, size: l.size, packs: l.packs, unitPrice: l.unitPrice }; }) };
        if ($('#se-amount', d)) body.amount = $('#se-amount', d).value;
        api('/api/supply/supplies/' + s.id, { method: 'PUT', body: body }).then(function () { d.close(); toast('Saved.'); return U.refreshData(); }).then(function () { V.supply(['supply', s.id]); }).catch(fail(showErr));
      });
  };
  A['earlier-invoice'] = function (t) {
    dialog('<form method="dialog"><h2>Add an earlier invoice</h2><p class="hint">For invoices you wrote before using this system. No items needed.</p><div class="field"><label for="ei-shop">Shop</label><select id="ei-shop" required>' + shopOpts(t.dataset.id, false, true) + '</select></div>' +
      fieldRow('ei-no', 'Hard-copy invoice number', '', 'text', 'required') + '<div class="row2">' + fieldRow('ei-date', 'Invoice date', U.todayStr(), 'date', 'required') + fieldRow('ei-amount', 'Total (VAT included)', '', 'number', 'required min="0.01" step="0.01" inputmode="decimal"') + '</div>' +
      fieldRow('ei-paid', 'Already paid (if any)', '', 'number', 'min="0" step="0.01" inputmode="decimal"') + '<p class="err"></p><div class="actions"><button class="btn" type="button" data-close>Cancel</button><button class="btn primary" type="submit">Add</button></div></form>',
      function (d, showErr) {
        api('/api/supply/supplies', { method: 'POST', body: { shopId: $('#ei-shop', d).value, invoiceNo: $('#ei-no', d).value, date: $('#ei-date', d).value, amount: $('#ei-amount', d).value, alreadyPaid: $('#ei-paid', d).value || 0 } })
          .then(function () { d.close(); toast('Invoice added.'); return U.refreshData(); }).then(function () { U.route(); }).catch(fail(showErr));
      });
  };

  // ── PAYMENTS ───────────────────────────────────────────────────────────────
  function payDialog(shopId, supplyId) {
    var pick = shopId ? '' : '<div class="field"><label for="pd-shop">Shop</label><select id="pd-shop"><option value="">Choose a shop…</option>' + S.shops.filter(function (s) { return s.balance > 0.005; }).map(function (s) { return '<option value="' + esc(s.id) + '">' + esc(s.name) + ' — owes ' + money(s.balance) + '</option>'; }).join('') + '</select></div>';
    var dlg = dialog('<form method="dialog"><h2>Record a payment</h2>' + pick + '<div id="pd-body"></div><p class="err"></p><div class="actions"><button class="btn" type="button" data-close>Cancel</button><button class="btn primary" type="submit">Save payment</button></div></form>',
      function (d, showErr) {
        var sid = shopId || $('#pd-shop', d).value; if (!sid) return showErr('Choose a shop.');
        api('/api/supply/payments', { method: 'POST', body: { shopId: sid, supplyId: $('#pd-inv', d).value || undefined, amount: $('#pd-amount', d).value, method: $('#pd-method', d).value, date: $('#pd-date', d).value, reference: $('#pd-ref', d).value } })
          .then(function (r) { d.close(); toast('Payment saved' + (r.applied.length > 1 ? ' across ' + r.applied.length + ' invoices.' : '.')); return U.refreshData(); }).then(function () { U.route(); }).catch(fail(showErr));
      });
    function load(sid) {
      var box = $('#pd-body', dlg); if (!sid) { box.innerHTML = ''; return; }
      api('/api/supply/shops/' + sid).then(function (d) {
        var open = d.supplies.filter(function (x) { return !x.voided && (!x.kind || x.kind === 'supply') && x.available > 0.005; });
        if (!open.length) { box.innerHTML = '<p class="empty">Nothing left to pay for this shop.</p>'; return; }
        box.innerHTML = '<div class="field"><label for="pd-inv">Pay towards</label><select id="pd-inv"><option value="">Oldest invoices first</option>' + open.map(function (x) { return '<option value="' + esc(x.id) + '"' + (x.id === supplyId ? ' selected' : '') + '>' + esc(x.invoiceNo) + ' — ' + money(x.available) + ' left</option>'; }).join('') + '</select></div>' +
          '<div class="row2">' + fieldRow('pd-amount', 'Amount', supplyId ? (open.filter(function (x) { return x.id === supplyId; })[0] || {}).available : '', 'number', 'required min="0.01" step="0.01" inputmode="decimal"') + '<div class="field"><label for="pd-method">Paid by</label><select id="pd-method"><option value="cash">Cash</option><option value="momo">MoMo</option><option value="bank">Bank transfer</option><option value="other">Other</option></select></div></div>' +
          '<div class="row2">' + fieldRow('pd-date', 'Date', U.todayStr(), 'date') + fieldRow('pd-ref', 'Reference (optional)', '') + '</div><p class="hint">Cheques are recorded with “Pick up cheque”, so the photo and dates are kept.</p>';
      }).catch(fail());
    }
    if (shopId) load(shopId); else $('#pd-shop', dlg).addEventListener('change', function (e) { load(e.target.value); });
  }
  A['pay-any'] = function () { payDialog(null, null); };
  A['pay-shop'] = function (t) { payDialog(t.dataset.id, null); };
  A['pay-supply'] = function (t) { payDialog(t.dataset.shop, t.dataset.id); };
  A['todo-pay'] = function (t) { api('/api/supply/supplies/' + t.dataset.id).then(function (s) { payDialog(s.shopId, s.id); }).catch(fail()); };
  A['pay-void'] = function (t) {
    U.askReason('Void this payment', function (reason, close, showErr) {
      api('/api/supply/payments/' + t.dataset.id + '/void', { method: 'POST', body: { reason: reason } }).then(function () { close(); toast('Payment voided.'); V.supply(['supply', t.dataset.sid]); }).catch(fail(showErr));
    });
  };

  // ── MONEY OVERVIEW ─────────────────────────────────────────────────────────
  V.owed = function () {
    Promise.all([api('/api/supply/reports/receivables'), api('/api/supply/shops')]).then(function (r) {
      var rep = r[0], shops = r[1].filter(function (s) { return s.balance > 0.005; }).sort(function (a, b) { return b.balance - a.balance; }), a = rep.aging;
      var overdue = r2(a.d1_30 + a.d31_60 + a.d61_90 + a.d90);
      app.innerHTML = pageHead('Money', 'As of ' + esc(fmtDate(rep.asOf))) +
        '<div class="grid2"><div class="card stat"><b>' + money(rep.totalOwed) + '</b><span>Owed to you</span></div><div class="card stat"><b class="' + (overdue > 0 ? 'neg' : '') + '">' + money(overdue) + '</b><span>Overdue</span></div></div>' +
        '<div class="card"><h3>How late</h3><div class="aging">' + [['Not due', a.current], ['1–30 days', a.d1_30], ['31–60', a.d31_60], ['61–90', a.d61_90], ['90+', a.d90]].map(function (x) { return '<div><b>' + money(x[1]) + '</b><span>' + x[0] + '</span></div>'; }).join('') + '</div></div>' +
        '<div class="actions no-print"><a class="btn" href="#/receivables">Printable list</a><a class="btn" href="#/cheques">Cheques</a>' + (S.canWrite ? '<a class="btn gold" href="#/pickup">Pick up a cheque</a><button class="btn" data-act="pay-any">Record payment</button>' : '') + '</div>' +
        '<div class="card flat mt"><div style="padding:14px 16px"><h3>Who owes</h3></div>' + (shops.length ? shops.map(function (s) { return '<a class="list-item" style="border:none;border-radius:0;border-top:1px solid var(--light);margin:0;text-decoration:none" href="#/shop/' + esc(s.id) + '"><span><b>' + esc(s.name) + '</b><small>' + (s.overdue > 0.005 ? '<span class="err">' + money(s.overdue) + ' overdue' + (s.oldestOverdueDays ? ' · oldest ' + s.oldestOverdueDays + ' days' : '') + '</span>' : 'not yet due') + (s.chequePending > 0.005 ? ' · ' + money(s.chequePending) + ' in cheques' : '') + '</small></span><b>' + money(s.balance) + '</b></a>'; }).join('') : '<p class="empty">Nobody owes you anything.</p>') + '</div>';
    }).catch(function (e) { toast(e.message, true); });
  };
  V.receivables = function () {
    api('/api/supply/reports/receivables').then(function (rep) {
      app.innerHTML = '<div class="no-print spaced"><a href="#/owed">‹ Money</a><button class="btn small" data-act="print">Print</button></div><div class="card">' + U.companyHead() + '<h2 class="mt">Payments outstanding</h2><p class="sub">As of ' + esc(fmtDate(rep.asOf)) + '</p><div class="scroll-x"><table class="invtable"><thead><tr><th>Date</th><th>Invoice</th><th>Shop</th><th>Due</th><th class="num">Amount</th><th class="num">Balance</th><th>Cheque</th><th>Tax inv.</th></tr></thead><tbody>' +
        rep.rows.map(function (r) { return '<tr><td>' + esc(fmtDate(r.date)) + '</td><td>' + esc(r.invoiceNo) + '</td><td>' + esc(r.shopName) + '</td><td' + (r.status === 'overdue' ? ' class="err"' : '') + '>' + esc(fmtDate(r.dueDate)) + '</td><td class="num">' + r2(r.amount).toFixed(2) + '</td><td class="num"><b>' + r2(r.balance).toFixed(2) + '</b></td><td>' + esc(r.cheques) + '</td><td>' + esc(r.taxInvoice) + '</td></tr>'; }).join('') +
        '</tbody></table></div><div class="invtotals"><div class="grand"><span>TOTAL OWED</span><b>' + money(rep.totalOwed) + '</b></div></div></div>';
    }).catch(function (e) { toast(e.message, true); });
  };
  var vatMonth = U.todayStr().slice(0, 7);
  V.vat = function () {
    api('/api/supply/reports/vat?month=' + vatMonth).then(function (r) {
      var t = r.totals;
      app.innerHTML = '<div class="no-print">' + pageHead('VAT summary', 'Figures for your monthly GRA return', '<button class="btn small" data-act="print">Print</button>') + '<div class="field"><label for="vm">Month</label><input id="vm" type="month" value="' + esc(r.month) + '" data-in="vat-month"></div></div>' +
        '<div class="card">' + U.companyHead() + '<h2 class="mt">Supplies — ' + esc(r.month) + '</h2><div class="scroll-x"><table class="invtable"><thead><tr><th>Date</th><th>Invoice</th><th>Shop</th><th class="num">Excl.</th><th class="num">NHIL</th><th class="num">GETFund</th><th class="num">VAT</th><th class="num">Total</th></tr></thead><tbody>' +
        r.rows.map(function (x) { return '<tr><td>' + esc(fmtDate(x.date)) + '</td><td>' + esc(x.invoiceNo) + '</td><td>' + esc(x.shopName) + '</td><td class="num">' + x.taxExclusive.toFixed(2) + '</td><td class="num">' + x.nhil.toFixed(2) + '</td><td class="num">' + x.getfund.toFixed(2) + '</td><td class="num">' + x.vat.toFixed(2) + '</td><td class="num">' + x.total.toFixed(2) + '</td></tr>'; }).join('') +
        '<tr><td colspan="3"><b>Total</b></td><td class="num"><b>' + t.taxExclusive.toFixed(2) + '</b></td><td class="num"><b>' + t.nhil.toFixed(2) + '</b></td><td class="num"><b>' + t.getfund.toFixed(2) + '</b></td><td class="num"><b>' + t.vat.toFixed(2) + '</b></td><td class="num"><b>' + t.total.toFixed(2) + '</b></td></tr></tbody></table></div>' +
        '<p class="hint mt">Supply invoices only (website sales are on their own invoices).</p></div>';
    }).catch(function (e) { toast(e.message, true); });
  };
  C['vat-month'] = function (t) { if (t.value) { vatMonth = t.value; V.vat(); } };

  // ── TAX INVOICE (GRA) ──────────────────────────────────────────────────────
  V.tax = function (parts) {
    api('/api/supply/supplies/' + parts[1] + '/tax-invoice').then(function (t) {
      var sup = t.supplier, cus = t.customer;
      app.innerHTML = '<p class="no-print"><a href="#/supply/' + esc(parts[1]) + '">‹ Invoice ' + esc(t.supplyInvoiceNo) + '</a></p><div class="card"><div class="spaced"><div>' + U.companyHead() + '</div><div style="text-align:right"><h2>Tax invoice</h2><b>' + (t.serial ? esc(t.serial) : '<span class="err">not issued</span>') + '</b></div></div>' +
        '<div class="grid2 mt"><div><label>Customer</label><b>' + esc(cus.name) + '</b>' + (cus.tin ? '<div class="sub">TIN ' + esc(cus.tin) + '</div>' : '<div class="sub">TIN not on file</div>') + '</div><div style="text-align:right"><label>Date of supply</label><b>' + esc(fmtDate(t.dateOfSupply)) + '</b><div class="sub">Terms: ' + esc(t.termsOfPayment) + ' · invoice ' + esc(t.supplyInvoiceNo) + '</div></div></div>' +
        '<div class="scroll-x"><table class="invtable tight"><thead><tr><th class="num">Qty</th><th>Description</th><th class="num">Unit</th><th class="num">Amount</th></tr></thead><tbody>' + t.rows.map(function (r) { return '<tr><td class="num"><b>' + r.qty + '</b></td><td>' + esc(r.description) + '</td><td class="num">' + r.unitExcl.toFixed(2) + '</td><td class="num">' + r.amountExcl.toFixed(2) + '</td></tr>'; }).join('') + '</tbody></table></div>' +
        '<p class="hint" style="margin-top:6px">Unit and Amount are before tax.</p><div class="invtotals"><div class="taxrow"><span>Tax exclusive value</span><b>' + money(t.taxExclusiveValue) + '</b></div><div class="taxrow"><span>NHIL 2.5%</span><b>' + money(t.nhil) + '</b></div><div class="taxrow"><span>GETFund Levy 2.5%</span><b>' + money(t.getfund) + '</b></div><div class="taxrow"><span>VAT 15%</span><b>' + money(t.vat) + '</b></div><div class="taxrow"><span>Total taxes</span><b>' + money(t.totalTaxes) + '</b></div><div class="grand"><span>TOTAL (tax inclusive)</span><b>' + money(t.totalInclusive) + '</b></div></div>' +
        (sup.tin ? '<p class="hint mt">Supplier TIN: ' + esc(sup.tin) + '</p>' : '<p class="hint mt err">Set your company TIN under Settings so it prints here.</p>') + '</div>' +
        (S.canWrite ? '<div class="card no-print"><h3>GRA serial number</h3><p class="hint">Type the serial printed on the hard-copy tax invoice you give the shop.</p><div class="row2">' + fieldRow('ti-serial', 'Serial', t.serial) + fieldRow('ti-date', 'Date issued', t.dateOfInvoice, 'date') + '</div><div class="actions"><button class="btn primary" data-act="tax-save" data-id="' + esc(parts[1]) + '">Save serial</button>' + (t.issued ? '<button class="btn" data-act="tax-clear" data-id="' + esc(parts[1]) + '">Clear</button>' : '') + '<button class="btn" data-act="print">Print</button></div></div>' : '<div class="actions no-print"><button class="btn" data-act="print">Print</button></div>');
    }).catch(notFound);
  };
  A['tax-save'] = function (t) { api('/api/supply/supplies/' + t.dataset.id + '/tax-invoice', { method: 'PUT', body: { serial: $('#ti-serial').value, date: $('#ti-date').value } }).then(function () { toast('Saved.'); V.tax(['tax', t.dataset.id]); }).catch(fail()); };
  A['tax-clear'] = function (t) { api('/api/supply/supplies/' + t.dataset.id + '/tax-invoice', { method: 'PUT', body: { clear: true } }).then(function () { toast('Cleared.'); V.tax(['tax', t.dataset.id]); }).catch(fail()); };

  // ── CHEQUES ────────────────────────────────────────────────────────────────
  var chqTab = 'received';
  var CHQ_TABS = [['received', 'To pay in'], ['deposited', 'Paid in'], ['cleared', 'Cleared'], ['bounced', 'Bounced']];
  V.cheques = function () {
    api('/api/supply/cheques').then(function (all) {
      var counts = {}; all.forEach(function (c) { counts[c.status] = (counts[c.status] || 0) + 1; });
      var list = all.filter(function (c) { return c.status === chqTab; });
      app.innerHTML = pageHead('Cheques', all.length + ' recorded', W('<a class="btn small gold" href="#/pickup">Pick up</a>')) +
        '<div class="chips">' + CHQ_TABS.map(function (t) { return '<button class="chip' + (chqTab === t[0] ? ' on' : '') + '" data-act="chq-tab" data-s="' + t[0] + '">' + t[1] + (counts[t[0]] ? ' (' + counts[t[0]] + ')' : '') + '</button>'; }).join('') + '</div>' +
        (list.length ? list.map(chequeCard).join('') : '<p class="empty">No cheques here.</p>');
    }).catch(function (e) { toast(e.message, true); });
  };
  function chequeCard(c) {
    var t = U.todayStr(), post = c.status === 'received' && c.chequeDate > t;
    var acts = '';
    if (S.canWrite) {
      if (c.status === 'received') acts += '<button class="btn small primary" data-act="chq-set" data-id="' + esc(c.id) + '" data-s="deposited">Paid in</button>';
      if (c.status === 'deposited') acts += '<button class="btn small primary" data-act="chq-set" data-id="' + esc(c.id) + '" data-s="cleared">Cleared</button><button class="btn small" data-act="chq-bounce" data-id="' + esc(c.id) + '">Bounced</button>';
      if (c.status === 'bounced') acts += '<button class="btn small" data-act="chq-set" data-id="' + esc(c.id) + '" data-s="received">Back to “to pay in”</button>';
      acts += '<button class="btn small" data-act="chq-void" data-id="' + esc(c.id) + '">Void</button>';
    }
    return '<div class="card"><div class="spaced"><div><b>' + esc(c.shopName) + '</b><div class="sub">Cheque ' + esc(c.chequeNo) + (c.bank ? ' · ' + esc(c.bank) : '') + '</div></div><b>' + money(c.amount) + '</b></div>' +
      '<p class="sub">Dated ' + esc(fmtDate(c.chequeDate)) + (post ? ' <span class="badge gold">post-dated</span>' : '') + ' · picked up ' + esc(fmtDate(c.receivedDate)) + (c.depositedDate ? ' · paid in ' + esc(fmtDate(c.depositedDate)) : '') + (c.clearedDate ? ' · cleared ' + esc(fmtDate(c.clearedDate)) : '') + '</p>' +
      '<p class="sub">Pays: ' + c.allocations.map(function (a) { return esc(a.invoiceNo || '') + ' (' + money(a.amount) + ')'; }).join(', ') + '</p>' + (c.bounceNote ? '<p class="err">' + esc(c.bounceNote) + '</p>' : '') +
      '<div class="actions">' + (c.hasPhoto ? '<button class="btn small" data-act="chq-photo" data-id="' + esc(c.id) + '">View photo</button>' : '') + acts + '</div></div>';
  }
  A['chq-tab'] = function (t) { chqTab = t.dataset.s; V.cheques(); };
  A['open-cheque'] = function (t) { location.hash = '#/cheques'; };
  A['chq-set'] = function (t) {
    api('/api/supply/cheques/' + t.dataset.id + '/status', { method: 'PUT', body: { status: t.dataset.s } }).then(function () { toast('Updated.'); return U.refreshData(); }).then(function () { chqTab = t.dataset.s; V.cheques(); }).catch(fail());
  };
  A['chq-bounce'] = function (t) {
    U.askReason('Cheque bounced — what happened?', function (reason, close, showErr) {
      api('/api/supply/cheques/' + t.dataset.id + '/status', { method: 'PUT', body: { status: 'bounced', note: reason } }).then(function () { close(); chqTab = 'bounced'; return U.refreshData(); }).then(V.cheques).catch(fail(showErr));
    });
  };
  A['chq-void'] = function (t) {
    U.askReason('Void this cheque', function (reason, close, showErr) {
      api('/api/supply/cheques/' + t.dataset.id + '/void', { method: 'POST', body: { reason: reason } }).then(function () { close(); toast('Voided.'); return U.refreshData(); }).then(V.cheques).catch(fail(showErr));
    });
  };
  A['chq-photo'] = function (t) {
    api('/api/supply/cheques/' + t.dataset.id + '/photo', { raw: true }).then(function (r) { if (!r.ok) throw new Error('No photo.'); return r.blob(); }).then(function (b) {
      var url = URL.createObjectURL(b); var d = dialog('<div><img src="' + url + '" alt="Cheque photo" style="width:100%;border-radius:8px"><div class="actions"><button class="btn primary" data-close>Close</button></div></div>'); d.addEventListener('close', function () { URL.revokeObjectURL(url); });
    }).catch(fail());
  };

  // ── PICK UP A CHEQUE ───────────────────────────────────────────────────────
  var pick = null;
  V.pickup = function (parts) {
    if (parts[1]) return pickForm(parts[1]);
    Promise.all([api('/api/supply/shops'), api('/api/supply/calls?status=open')]).then(function (r) {
      var ready = {}; r[1].forEach(function (c) { if (c.type === 'cheque_ready') ready[c.shopId] = true; });
      var shops = r[0].filter(function (s) { return s.balance - s.chequePending > 0.005; }).sort(function (a, b) { return (ready[b.id] ? 1 : 0) - (ready[a.id] ? 1 : 0) || b.balance - a.balance; });
      app.innerHTML = pageHead('Pick up a cheque', 'Which shop gave you the cheque?') + (shops.map(function (s) { return '<a class="list-item" style="text-decoration:none" href="#/pickup/' + esc(s.id) + '"><span><b>' + esc(s.name) + '</b> ' + (ready[s.id] ? '<span class="badge gold">called: ready</span>' : '') + '<small>Owes ' + money(s.balance) + '</small></span><span>›</span></a>'; }).join('') || '<p class="empty">No shop has anything left to pay.</p>');
    }).catch(fail());
  };
  function pickForm(shopId) {
    api('/api/supply/shops/' + shopId).then(function (d) {
      var open = d.supplies.filter(function (x) { return !x.voided && (!x.kind || x.kind === 'supply') && x.available > 0.005; }).sort(function (a, b) { return a.dueDate.localeCompare(b.dueDate); });
      pick = { shopId: shopId, open: open, on: {}, amt: {}, tax: {}, file: null };
      open.forEach(function (x) { pick.on[x.id] = true; pick.amt[x.id] = x.available; });
      app.innerHTML = '<p class="no-print"><a href="#/pickup">‹ Choose another shop</a></p>' + pageHead('Cheque from ' + d.shop.name, 'Tick the invoice(s) this cheque pays.') +
        (open.length ? '<div class="card" id="pk-list"></div>' : '<div class="card"><p class="empty">Nothing left to pay for this shop.</p></div>') +
        '<div class="card"><div class="row2">' + fieldRow('pk-no', 'Cheque number', '', 'text', 'required inputmode="numeric" autocomplete="off"') + fieldRow('pk-bank', 'Bank (optional)', '') + '</div><div class="row2">' + fieldRow('pk-cdate', 'Date on the cheque', U.todayStr(), 'date', 'required') + fieldRow('pk-rdate', 'Picked up on', U.todayStr(), 'date') + '</div>' +
        '<div class="field"><label for="pk-photo">Photo of the cheque</label><input id="pk-photo" type="file" accept="image/*" capture="environment" data-in="pk-photo"><div id="pk-preview" class="hint">Kept privately. Only you and your boss can see it.</div></div></div>' +
        '<div id="pk-tax"></div><p class="err" id="pk-err"></p><div class="sticky-bar"><div><b id="pk-total">' + money(0) + '</b><small>cheque total</small></div><button class="btn gold" data-act="pk-save" id="pk-btn">Save cheque</button></div>';
      pickRender();
    }).catch(fail());
  }
  function pickRender() {
    var box = $('#pk-list'); if (box) box.innerHTML = pick.open.map(function (x) {
      return '<div class="line"><label style="display:flex;gap:10px;align-items:center;text-transform:none;letter-spacing:0;font-size:14px;color:var(--dark);margin:0"><input type="checkbox" data-in="pk-on" data-id="' + esc(x.id) + '" ' + (pick.on[x.id] ? 'checked' : '') + '><span><b>' + esc(x.invoiceNo) + '</b><br><span class="sub">' + esc(fmtDate(x.date)) + ' · ' + money(x.available) + ' left' + (x.status === 'overdue' ? ' · overdue' : '') + '</span></span></label>' +
        '<input type="number" inputmode="decimal" step="0.01" min="0" style="width:120px" data-in="pk-amt" data-id="' + esc(x.id) + '" value="' + (pick.amt[x.id] || '') + '" ' + (pick.on[x.id] ? '' : 'disabled') + ' aria-label="Amount for ' + esc(x.invoiceNo) + '"></div>'; }).join('');
    var taxBox = $('#pk-tax'); var need = pick.open.filter(function (x) { return pick.on[x.id] && !x.taxInvoice; });
    taxBox.innerHTML = need.length ? '<div class="card"><h3>GRA tax invoice serial</h3><p class="hint">You issue the tax invoice when you pick up the cheque. Enter the serial number for each (or leave blank and add it later).</p>' + need.map(function (x) { return '<div class="field"><label for="tx-' + esc(x.id) + '">For invoice ' + esc(x.invoiceNo) + '</label><input id="tx-' + esc(x.id) + '" type="text" data-in="pk-tax" data-id="' + esc(x.id) + '" value="' + esc(pick.tax[x.id] || '') + '"></div>'; }).join('') + '</div>' : '';
    pickTotal();
  }
  function pickTotal() { var t = 0; pick.open.forEach(function (x) { if (pick.on[x.id]) t += parseFloat(pick.amt[x.id]) || 0; }); var el = $('#pk-total'); if (el) el.textContent = money(r2(t)); return r2(t); }
  C['pk-on'] = function (t) { pick.on[t.dataset.id] = t.checked; pickRender(); };
  I['pk-amt'] = function (t) { pick.amt[t.dataset.id] = t.value; pickTotal(); };
  I['pk-tax'] = function (t) { pick.tax[t.dataset.id] = t.value; };
  C['pk-photo'] = function (t) { pick.file = t.files && t.files[0] || null; var p = $('#pk-preview'); if (pick.file) { var url = URL.createObjectURL(pick.file); p.innerHTML = '<img src="' + url + '" alt="Cheque preview" style="max-width:100%;max-height:220px;border-radius:8px;margin-top:6px">'; } };
  A['pk-save'] = function () {
    var err = $('#pk-err'); err.textContent = '';
    var allocs = pick.open.filter(function (x) { return pick.on[x.id]; }).map(function (x) { return { supplyId: x.id, amount: pick.amt[x.id] }; });
    if (!allocs.length) { err.textContent = 'Tick at least one invoice.'; return; }
    var no = $('#pk-no').value.trim(); if (!no) { err.textContent = 'Enter the cheque number.'; return; }
    var taxInvoices = pick.open.filter(function (x) { return pick.on[x.id] && pick.tax[x.id] && pick.tax[x.id].trim(); }).map(function (x) { return { supplyId: x.id, serial: pick.tax[x.id].trim() }; });
    var data = { shopId: pick.shopId, chequeNo: no, chequeDate: $('#pk-cdate').value, receivedDate: $('#pk-rdate').value, bank: $('#pk-bank').value, allocations: allocs, taxInvoices: taxInvoices, amount: pickTotal() };
    var fd = new FormData(); fd.append('data', JSON.stringify(data)); if (pick.file) fd.append('photo', pick.file);
    var btn = $('#pk-btn'); btn.disabled = true;
    api('/api/supply/cheques', { method: 'POST', form: fd }).then(function () { toast('Cheque saved.'); return U.refreshData(); }).then(function () { chqTab = 'received'; location.hash = '#/cheques'; }).catch(function (e) { btn.disabled = false; err.textContent = e.message; });
  };
  A['todo-pickup'] = function (t) { location.hash = '#/pickup/' + t.dataset.id; };

  // ── CALLS ──────────────────────────────────────────────────────────────────
  A['new-call'] = function (t) {
    dialog('<form method="dialog"><h2>A shop called</h2><div class="field"><label for="cl-shop">Shop</label><select id="cl-shop" required>' + shopOpts(t && t.dataset && t.dataset.id, false, true) + '</select></div><div class="field"><label for="cl-type">What for?</label><select id="cl-type"><option value="stock">They want stock</option><option value="cheque_ready">Their cheque is ready</option><option value="other">Something else</option></select></div>' +
      fieldRow('cl-items', 'What they asked for (optional)', '') + '<div class="field"><label for="cl-note">Note</label><textarea id="cl-note"></textarea></div><p class="err"></p><div class="actions"><button class="btn" type="button" data-close>Cancel</button><button class="btn primary" type="submit">Save</button></div></form>',
      function (d, showErr) {
        api('/api/supply/calls', { method: 'POST', body: { shopId: $('#cl-shop', d).value, type: $('#cl-type', d).value, items: $('#cl-items', d).value, note: $('#cl-note', d).value } })
          .then(function () { d.close(); toast('Saved to your To do list.'); return U.refreshData(); }).then(function () { U.route(); }).catch(fail(showErr));
      });
  };
  A['call-done'] = function (t) { api('/api/supply/calls/' + t.dataset.id, { method: 'PUT', body: { status: 'done' } }).then(function () { toast('Done.'); return U.refreshData(); }).then(function () { U.route(); }).catch(fail()); };
  V.calls = function () {
    api('/api/supply/calls').then(function (all) {
      var open = all.filter(function (c) { return c.status === 'open'; }), done = all.filter(function (c) { return c.status !== 'open'; }).slice(0, 15);
      var row = function (c) { return '<div class="line"><div><div class="t">' + esc(c.shopName) + ' — ' + esc(c.type === 'stock' ? 'wants stock' : c.type === 'cheque_ready' ? 'cheque ready' : 'call') + '</div><div class="m">' + esc(fmtDate(c.date)) + (c.items ? ' · ' + esc(c.items) : '') + (c.note ? ' · ' + esc(c.note) : '') + '</div></div>' + (S.canWrite && c.status === 'open' ? '<button class="btn small" data-act="call-done" data-id="' + esc(c.id) + '">Done</button>' : '') + '</div>'; };
      app.innerHTML = pageHead('Calls', open.length + ' waiting', W('<button class="btn small gold" data-act="new-call">Log a call</button>')) + '<div class="card">' + (open.length ? open.map(row).join('') : '<p class="empty">No open requests.</p>') + '</div>' + (done.length ? '<div class="card"><h3>Done</h3>' + done.map(row).join('') + '</div>' : '');
    }).catch(fail());
  };

  // ── PRICES ─────────────────────────────────────────────────────────────────
  V.prices = function () {
    api('/api/supply/prices').then(function (p) {
      app.innerHTML = pageHead('Prices', 'One supply price for every product, VAT included.') +
        '<div class="card"><div class="field"><label for="pr-std">Supply price per 3-pack (VAT ' + p.vatRate + '% included)</label><input id="pr-std" type="number" min="0" step="0.01" inputmode="decimal" value="' + (p.standardPrice == null ? '' : p.standardPrice) + '" placeholder="e.g. 250.20"></div>' +
        (p.standardPrice ? '<p class="hint">' + money(p.standardPrice) + ' = ' + money(p.standardPrice / (1 + p.vatRate / 100)) + ' + VAT.</p>' : '') + '</div>' +
        '<div class="card flat"><div style="padding:14px 16px"><h3>Invoice name and optional own price</h3><p class="hint">The invoice name is what prints on the invoice. Leave the price blank to use the standard price.</p></div>' + p.products.map(function (x) {
          return '<div class="pr-row"><b>' + esc(x.name) + '</b><div class="row2"><div class="field"><label for="pn-' + esc(x.id) + '">Invoice name</label><input id="pn-' + esc(x.id) + '" type="text" data-pid="' + esc(x.id) + '" data-f="desc" value="' + esc(x.desc) + '" placeholder="' + esc(x.name) + '"></div><div class="field"><label for="pp-' + esc(x.id) + '">Own price</label><input id="pp-' + esc(x.id) + '" type="number" min="0" step="0.01" inputmode="decimal" data-pid="' + esc(x.id) + '" data-f="price" value="' + (x.overridePrice == null ? '' : x.overridePrice) + '" placeholder="standard"></div></div></div>'; }).join('') + '</div>' +
        '<div class="actions"><button class="btn primary" data-act="prices-save">Save prices</button></div>';
    }).catch(fail());
  };
  A['prices-save'] = function () {
    var body = { standardPrice: $('#pr-std').value, prices: {}, descs: {} };
    $$('[data-pid]').forEach(function (i) { (i.dataset.f === 'price' ? body.prices : body.descs)[i.dataset.pid] = i.value; });
    api('/api/supply/prices', { method: 'PUT', body: body }).then(function () { toast('Prices saved.'); return U.refreshData(); }).then(V.prices).catch(fail());
  };

  // ── SETTINGS ───────────────────────────────────────────────────────────────
  V.settings = function () {
    api('/api/supply/settings').then(function (s) {
      var last = s.lastBackupAt ? new Date(s.lastBackupAt).toLocaleDateString('en-GB') : 'never';
      app.innerHTML = pageHead('Settings') + '<div class="card"><h3>Company details (printed on invoices)</h3>' + fieldRow('st-name', 'Company name', s.companyName) + fieldRow('st-addr', 'Address', s.companyAddress) + '<div class="row2">' + fieldRow('st-tel', 'Tel', s.companyTel) + fieldRow('st-mob', 'Mobile', s.companyMobile) + '</div>' + fieldRow('st-tin', 'Company TIN', s.tin) +
        fieldRow('st-reorder', 'Remind me to re-visit a shop after (days)', s.reorderDays, 'number', 'min="1" max="365" inputmode="numeric"') + '<div class="actions"><button class="btn primary" data-act="settings-save">Save</button></div></div>' +
        '<div class="card"><h3>Backup</h3><p class="sub">Last backup: ' + last + '. Download one monthly and keep it safe (it includes the cheque photos).</p><div class="actions"><button class="btn" data-act="backup">Download backup</button></div></div>' +
        '<div class="card"><h3>Practice mode</h3><p class="sub">' + (s.practice ? '<b>On.</b> Everything you enter is practice, kept apart from your real records.' : 'Off. Turn it on to train someone without touching real records.') + '</p><div class="actions"><button class="btn ' + (s.practice ? 'gold' : '') + '" data-act="practice-toggle" data-on="' + (s.practice ? '0' : '1') + '">' + (s.practice ? 'Turn practice off' : 'Turn practice on') + '</button><button class="btn danger" data-act="practice-clear">Delete practice records</button></div></div>';
    }).catch(fail());
  };
  A['settings-save'] = function () { api('/api/supply/settings', { method: 'PUT', body: { companyName: $('#st-name').value, companyAddress: $('#st-addr').value, companyTel: $('#st-tel').value, companyMobile: $('#st-mob').value, tin: $('#st-tin').value, reorderDays: $('#st-reorder').value } }).then(function () { toast('Saved.'); return U.refreshData(); }).catch(fail()); };
  A.backup = function () {
    api('/api/supply/backup', { raw: true }).then(function (r) { if (!r.ok) throw new Error('Backup failed.'); return r.blob(); }).then(function (b) { download('supply-backup-' + U.todayStr() + '.json', b); toast('Backup downloaded.'); return U.refreshData(); }).catch(fail());
  };
  A['practice-toggle'] = function (t) { api('/api/supply/settings', { method: 'PUT', body: { practice: t.dataset.on === '1' } }).then(function () { return U.refreshData(); }).then(function () { toast(t.dataset.on === '1' ? 'Practice mode on.' : 'Practice mode off.'); V.settings(); }).catch(fail()); };
  A['practice-clear'] = function () {
    dialog('<form method="dialog"><h2>Delete practice records</h2><p class="sub">This removes every record made in practice mode. Your real records are not touched.</p>' + fieldRow('pc-word', 'Type CLEAR to confirm', '') + '<p class="err"></p><div class="actions"><button class="btn" type="button" data-close>Cancel</button><button class="btn danger" type="submit">Delete</button></div></form>',
      function (d, showErr) { api('/api/supply/practice/clear', { method: 'POST', body: { confirm: $('#pc-word', d).value.trim() } }).then(function () { d.close(); toast('Practice records deleted.'); return U.refreshData(); }).then(V.settings).catch(fail(showErr)); });
  };
})();
