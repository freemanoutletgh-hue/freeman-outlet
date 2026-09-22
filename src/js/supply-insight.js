// Supply — insight: rankings (shops, products, sizes, payment behaviour) and the daily transactions view.
(function () {
  'use strict';
  var U = window.SUP, S = U.S, V = U.V, A = U.A, C = U.C;
  var esc = U.esc, money = U.money, fmtDate = U.fmtDate, api = U.api, app = U.app, toast = U.toast, pageHead = U.pageHead, $ = U.$;

  // ── RANKINGS ───────────────────────────────────────────────────────────────
  var rk = { tab: 'shops', period: 'month', special: false };
  var TABS = [['shops', 'Shops'], ['products', 'Products'], ['sizes', 'Sizes'], ['pay', 'Paying'], ['owes', 'Owing'], ['slow', 'Slowing']];
  var PERIODS = [['month', 'This month'], ['30', 'Last 30 days'], ['year', 'This year'], ['all', 'All time']];
  function range() {
    var t = U.todayStr();
    if (rk.period === 'month') return { from: t.slice(0, 7) + '-01' };
    if (rk.period === '30') return { from: U.addDays(t, -30) };
    if (rk.period === 'year') return { from: t.slice(0, 4) + '-01-01' };
    return {};
  }
  function bars(rows, opt) {
    if (!rows.length) return '<p class="empty">Nothing to show for this period.</p>';
    var max = rows.reduce(function (m, r) { return Math.max(m, opt.value(r)); }, 0) || 1;
    return '<div class="card flat">' + rows.slice(0, opt.limit || 25).map(function (r, i) {
      return '<div class="rank"><span class="pos">' + (i + 1) + '</span><div class="rk-main"><div class="spaced"><b>' + esc(opt.name(r)) + '</b><b>' + opt.show(r) + '</b></div><div class="bar"><i style="width:' + Math.max(2, Math.round(opt.value(r) / max * 100)) + '%"></i></div><div class="m">' + (opt.sub ? opt.sub(r) : '') + '</div></div></div>'; }).join('') + '</div>';
  }
  V.rankings = function () {
    var q = range(), qs = [];
    if (q.from) qs.push('from=' + q.from); if (rk.special) qs.push('includeSpecial=true');
    api('/api/supply/rankings' + (qs.length ? '?' + qs.join('&') : '')).then(function (d) {
      var body = '';
      if (rk.tab === 'shops') {
        body = '<h3 class="rk-h">By money supplied</h3>' + bars(d.shopsByAmount.filter(function (s) { return s.amount > 0; }), { value: function (s) { return s.amount; }, name: function (s) { return s.name; }, show: function (s) { return money(s.amount); }, sub: function (s) { return s.packs + ' packs · ' + s.supplies + ' supplies' + (s.takenBack ? ' · ' + s.takenBack + ' taken back' : ''); } }) +
          '<h3 class="rk-h">By packs</h3>' + bars(d.shopsByPacks.filter(function (s) { return s.packs > 0; }), { value: function (s) { return s.packs; }, name: function (s) { return s.name; }, show: function (s) { return s.packs + ' packs'; }, sub: function (s) { return s.lastDate ? 'last ' + fmtDate(s.lastDate) : ''; } });
      } else if (rk.tab === 'products') {
        body = '<p class="hint">Moved = supplied − taken back + sold online. Stock a shop gives back does not count as sold.</p>' + bars(d.products, { value: function (p) { return p.moved; }, name: function (p) { return p.name; }, show: function (p) { return p.moved + ' packs'; },
          sub: function (p) { return 'supplied ' + p.supplied + (p.takenBack ? ' · back ' + p.takenBack + ' (' + p.takeBackRate + '%)' : '') + ' · online ' + p.online; } });
      } else if (rk.tab === 'sizes') {
        body = '<p class="hint">Which colour and size moves most, so you know what to load first.</p>' + bars(d.skus, { value: function (p) { return p.moved; }, name: function (p) { return p.name + ' — ' + ([p.colour, p.size].filter(Boolean).join(' ') || 'one size'); }, show: function (p) { return p.moved + ' packs'; },
          sub: function (p) { return 'supplied ' + p.supplied + (p.takenBack ? ' · back ' + p.takenBack : '') + ' · online ' + p.online; }, limit: 40 });
      } else if (rk.tab === 'pay') {
        body = '<p class="hint">On time = the cheque was picked up (or paid) by the due date. Grade A = 90%+ on time and no bounced cheques.</p>' + (d.payment.length ? '<div class="card flat">' + d.payment.map(function (p, i) {
          return '<div class="rank"><span class="pos">' + (i + 1) + '</span><div class="rk-main"><div class="spaced"><b>' + esc(p.name) + '</b><span class="badge ' + (p.grade === 'A' ? 'dark' : p.grade === 'C' ? 'red' : 'gold') + '">Grade ' + p.grade + '</span></div><div class="m">' + p.onTimePct + '% on time (' + p.paidOnTime + ' of ' + p.invoices + ')' + (p.late ? ' · ' + p.late + ' late, about ' + p.avgDaysLate + ' days' : '') + (p.bounced ? ' · ' + p.bounced + ' bounced' : '') + (p.overdueNow ? ' · ' + money(p.overdueNow) + ' overdue now' : '') + '</div></div></div>'; }).join('') + '</div>' : '<p class="empty">Nothing to show for this period.</p>');
      } else if (rk.tab === 'owes') {
        body = bars(d.owes, { value: function (s) { return s.balance; }, name: function (s) { return s.name; }, show: function (s) { return money(s.balance); }, sub: function (s) { return (s.overdue > 0.005 ? money(s.overdue) + ' overdue' : 'not yet due') + (s.chequePending > 0.005 ? ' · ' + money(s.chequePending) + ' in cheques' : ''); } });
      } else {
        body = '<p class="hint">Shops taking fewer packs than in the period before this one.</p>' + (d.slowing.length ? '<div class="card flat">' + d.slowing.map(function (s, i) {
          return '<div class="rank"><span class="pos">' + (i + 1) + '</span><div class="rk-main"><div class="spaced"><b>' + esc(s.name) + '</b><b class="neg">' + s.changePct + '%</b></div><div class="m">' + s.packs + ' packs now vs ' + s.prevPacks + ' before' + (s.daysSince != null ? ' · last supply ' + s.daysSince + ' days ago' : '') + '</div></div></div>'; }).join('') + '</div>' : '<p class="empty">No shop is slowing down.</p>');
      }
      app.innerHTML = pageHead('Rankings', PERIODS.filter(function (p) { return p[0] === rk.period; })[0][1]) +
        '<div class="field"><label for="rk-period">Period</label><select id="rk-period" data-in="rk-period">' + PERIODS.map(function (p) { return '<option value="' + p[0] + '"' + (p[0] === rk.period ? ' selected' : '') + '>' + p[1] + '</option>'; }).join('') + '</select></div>' +
        '<div class="chips">' + TABS.map(function (t) { return '<button class="chip' + (rk.tab === t[0] ? ' on' : '') + '" data-act="rk-tab" data-s="' + t[0] + '">' + t[1] + '</button>'; }).join('') + '</div>' +
        '<label class="check"><input type="checkbox" data-in="rk-special" ' + (rk.special ? 'checked' : '') + '> Include Online and Samples</label>' + body;
    }).catch(function (e) { toast(e.message, true); });
  };
  A['rk-tab'] = function (t) { rk.tab = t.dataset.s; V.rankings(); };
  C['rk-period'] = function (t) { rk.period = t.value; V.rankings(); };
  C['rk-special'] = function (t) { rk.special = t.checked; V.rankings(); };

  // ── DAILY TRANSACTIONS ─────────────────────────────────────────────────────
  var day = U.todayStr();
  V.daily = function (parts) {
    if (parts[1] && /^\d{4}-\d{2}-\d{2}$/.test(parts[1])) day = parts[1];
    api('/api/supply/daily?date=' + day).then(function (d) {
      var t = d.totals, none = !d.supplies.length && !d.online.length && !d.payments.length && !d.cheques.length;
      var typeRows = d.byType.map(function (x) { return '<tr><td><b>' + esc(x.type) + '</b></td><td class="num">' + x.suppliedPacks + (x.takenBackPacks ? '<br><span class="sub">−' + x.takenBackPacks + ' back</span>' : '') + '</td><td class="num">' + x.onlinePacks + '</td><td class="num"><b>' + (x.suppliedPacks - x.takenBackPacks + x.onlinePacks) + '</b></td><td class="num">' + money(x.suppliedAmount + x.onlineAmount) + '</td></tr>'; }).join('');
      var totalPacks = t.suppliedPacks - t.takenBackPacks + t.onlinePacks;
      app.innerHTML = '<div class="no-print">' + pageHead('Daily transactions', esc(fmtDate(day))) + '<div class="daynav"><button class="btn small" data-act="day-move" data-n="-1">‹ Previous</button><input type="date" value="' + esc(day) + '" data-in="day-pick" aria-label="Choose a day"><button class="btn small" data-act="day-move" data-n="1">Next ›</button></div></div>' +
        '<div class="grid2"><div class="card stat"><b>' + money(t.suppliedAmount + t.onlineAmount) + '</b><span>Sales that day (' + totalPacks + ' packs)</span></div><div class="card stat"><b>' + money(t.paymentsAmount + t.chequesAmount) + '</b><span>Money collected</span></div></div>' +
        (none ? '<p class="empty">Nothing recorded on this day.</p>' :
        '<div class="card flat"><div style="padding:14px 16px"><h3>By product type</h3></div><div class="scroll-x"><table><thead><tr><th>Type</th><th class="num">Shops</th><th class="num">Online</th><th class="num">Total</th><th class="num">Amount</th></tr></thead><tbody>' + typeRows +
        '<tr><td><b>Total</b></td><td class="num"><b>' + (t.suppliedPacks - t.takenBackPacks) + '</b></td><td class="num"><b>' + t.onlinePacks + '</b></td><td class="num"><b>' + totalPacks + '</b></td><td class="num"><b>' + money(t.suppliedAmount + t.onlineAmount) + '</b></td></tr></tbody></table></div></div>' +
        (d.supplies.length ? '<div class="card flat"><div style="padding:14px 16px"><h3>Supplied to shops</h3></div><div class="scroll-x"><table><tbody>' + d.supplies.map(function (s) { return '<tr class="click" data-act="open-supply" data-id="' + esc(s.id) + '"><td><b>' + esc(s.shopName) + '</b><br><span class="sub">' + esc(s.invoiceNo) + (s.kind !== 'supply' ? ' · ' + s.kind : '') + '</span></td><td class="num">' + s.packs + ' packs' + (s.takenBack ? '<br><span class="sub">−' + s.takenBack + ' back</span>' : '') + '</td><td class="num">' + money(s.kind === 'credit' ? -s.creditAmount : s.amount) + '</td></tr>'; }).join('') + '</tbody></table></div></div>' : '') +
        (d.online.length ? '<div class="card flat"><div style="padding:14px 16px"><h3>Online orders</h3></div><div class="scroll-x"><table><tbody>' + d.online.map(function (o) { return '<tr><td><b>' + esc(o.name || 'Customer') + '</b><br><span class="sub">' + esc(o.orderNo || o.id) + ' · ' + esc(o.status) + '</span></td><td class="num">' + o.packs + ' packs</td><td class="num">' + money(o.total) + '</td></tr>'; }).join('') + '</tbody></table></div></div>' : '') +
        (d.payments.length || d.cheques.length ? '<div class="card flat"><div style="padding:14px 16px"><h3>Money in</h3></div><div class="scroll-x"><table><tbody>' + d.payments.map(function (p) { return '<tr><td><b>' + esc(p.shopName) + '</b><br><span class="sub">' + esc(p.invoiceNo || '') + ' · ' + esc(p.method) + '</span></td><td class="num">' + money(p.amount) + '</td></tr>'; }).join('') + d.cheques.map(function (c) { return '<tr><td><b>' + esc(c.shopName) + '</b><br><span class="sub">cheque ' + esc(c.chequeNo) + ' · dated ' + esc(fmtDate(c.chequeDate)) + '</span></td><td class="num">' + money(c.amount) + '</td></tr>'; }).join('') + '</tbody></table></div></div>' : '')) +
        '<div class="actions no-print"><button class="btn" data-act="print">Print</button></div>';
    }).catch(function (e) { toast(e.message, true); });
  };
  A['day-move'] = function (t) { day = U.addDays(day, parseInt(t.dataset.n, 10)); V.daily([]); };
  C['day-pick'] = function (t) { if (t.value) { day = t.value; V.daily([]); } };
})();
