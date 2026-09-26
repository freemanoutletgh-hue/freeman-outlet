// Business-logic, concurrency and stock-invariant checks against the isolated debug server (port 3100).
const base = 'http://localhost:3100';
let pass = 0, failn = 0; const fails = [];
const ok = (c, m, extra) => { if (c) pass++; else { failn++; fails.push(m + (extra !== undefined ? ' -> ' + JSON.stringify(extra).slice(0, 260) : '')); } };
let ipn = 1;
async function call(method, url, token, body, fresh) {
  const headers = {}; if (token) headers.Authorization = 'Bearer ' + token; if (fresh) headers['X-Forwarded-For'] = '10.9.' + (ipn >> 8) + '.' + (ipn++ & 255);
  let payload; if (body !== undefined) { if (body instanceof FormData) payload = body; else { headers['Content-Type'] = 'application/json'; payload = typeof body === 'string' ? body : JSON.stringify(body); } }
  const r = await fetch(base + url, { method, headers, body: payload });
  const t = await r.text(); let j; try { j = JSON.parse(t); } catch (e) { j = { _raw: t.slice(0, 200) }; }
  return { status: r.status, body: j };
}
const r2 = n => Math.round(n * 100) / 100;
(async () => {
  const owner = (await call('POST', '/api/admin/login', null, { username: 'admin', password: 'freeman2026' })).body.token;
  const P = async () => (await call('GET', '/api/products')).body;
  const ST = async () => (await call('GET', '/api/supply/stock', owner)).body;
  await call('PUT', '/api/supply/prices', owner, { standardPrice: 250.2 });
  let r = await call('POST', '/api/supply/shops', owner, { name: 'Alpha Shell', termsDays: 30 }); const alpha = r.body.shop;
  r = await call('POST', '/api/supply/shops', owner, { name: 'Beta Mart', termsDays: 14, creditLimit: 1000 }); const beta = r.body.shop;

  // ── 1. lots of stock across every product shape, tracking OFF first ───────
  r = await call('POST', '/api/supply/stock/intake', owner, { lines: [
    { productId: 'p-rich', colour: 'White', size: 'M', received: 20 }, { productId: 'p-rich', colour: 'White', size: 'L', received: 10 }, { productId: 'p-rich', colour: 'White', size: 'XL', received: 1 },
    { productId: 'p-rich', colour: 'Black', size: 'M', received: 8 }, { productId: 'p-rich', colour: 'Black', size: 'L', received: 4 },
    { productId: 'p-plain', colour: 'white', size: 'M', received: 6 }, { productId: 'p-plain', colour: 'grey', size: 'S', received: 6 },
    { productId: 'p-socks', colour: '', size: '', received: 30 },
    { productId: 'p-panty', colour: 'Black', size: '8', received: 12 }, { productId: 'p-panty', colour: 'Black', size: '10', received: 12 },
    { productId: 'p-evil', colour: 'Red "Hot" <b>', size: 'S', received: 5 },
  ] }); ok(r.body.success, 'big intake', r.body);
  const moveAll = async (to, frac) => { const o = await ST(); const lines = []; o.products.forEach(p => Object.keys(p.skus).forEach(k => { const [c, s] = k.split('|'); const n = Math.floor(p.skus[k].dome * frac); if (n > 0) lines.push({ productId: p.id, colour: c, size: s, packs: n }); })); return call('POST', '/api/supply/stock/transfer', owner, { from: 'dome', to, lines }); };
  r = await moveAll('online', 0.5); ok(r.body.success, 'move half to online', r.body);
  r = await moveAll('supply', 0.5); ok(r.body.success, 'move half of the rest to supply', r.body);
  let o = await ST(); const tot0 = { ...o.totals };
  console.log('pools after setup', JSON.stringify(tot0));

  // ── 2. switch tracking on: website numbers must equal the Online pool exactly ──
  r = await call('PUT', '/api/supply/stock/tracking', owner, { on: true, confirm: true }); ok(r.body.success, 'tracking on', r.body);
  const checkSync = async (label) => {
    const [prods, st] = [await P(), await ST()];
    for (const sp of st.products) {
      const pub = prods.find(x => x.id === sp.id); if (!pub) continue;
      const onlineTotal = sp.totals.online; const anyTracked = Object.values(sp.skus).some(x => x.dome + x.online + x.supply > 0);
      if (!anyTracked) continue;
      ok(pub.stock === onlineTotal, `${label}: ${sp.id} public stock ${pub.stock} = online pool ${onlineTotal}`);
      ok(pub.isSoldOut === (onlineTotal === 0), `${label}: ${sp.id} soldOut flag matches`, [pub.isSoldOut, onlineTotal]);
      if (Array.isArray(pub.variants) && typeof pub.variants[0] === 'object') pub.variants.forEach(v => { const sum = Object.keys(sp.skus).filter(k => k.split('|')[0] === v.color).reduce((a, k) => a + sp.skus[k].online, 0); ok(v.stock === sum, `${label}: ${sp.id}/${v.color} variant stock ${v.stock} = ${sum}`); });
    }
  };
  await checkSync('after tracking on');

  // ── 3. website orders for every product shape ─────────────────────────────
  const order = (items, fresh = true) => call('POST', '/api/whatsapp-order', null, { customer: { name: 'Kofi <b>T</b>', phone: '0241111111' }, cartItems: items, deliveryZone: 'Accra', deliveryAddress: 'East Legon' }, fresh);
  const onlineOf = async (pid, c, s) => { const p = (await ST()).products.find(x => x.id === pid); return p.skus[c + '|' + s].online; };
  let before = await onlineOf('p-rich', 'White', 'M');
  r = await order([{ id: 'p-rich', name: 'x', price: 260, quantity: 2, color: 'White', size: 'M' }]); ok(r.body.success && r.body.order.status !== 'Needs Review', 'order rich M', r.body);
  ok((await onlineOf('p-rich', 'White', 'M')) === before - 2, 'rich M online −2');
  const ord1 = r.body.order;
  await checkSync('after order');
  r = await order([{ id: 'p-socks', name: 'x', price: 260, quantity: 3, color: '', size: '' }]); ok(r.body.success && r.body.order.status !== 'Needs Review', 'order one-size socks', r.body);
  ok((await onlineOf('p-socks', '', '')) === 15 - 3, 'socks online −3', await onlineOf('p-socks', '', ''));
  r = await order([{ id: 'p-panty', name: 'x', price: 260, quantity: 1, color: 'Black', size: '10' }]); ok(r.body.success, 'order panty numeric size', r.body);
  r = await order([{ id: 'p-plain', name: 'x', price: 260, quantity: 1, color: 'white', size: 'M' }]); ok(r.body.success, 'order plain-variant product', r.body);
  r = await order([{ id: 'p-evil', name: 'x', price: 260, quantity: 1, color: 'Red "Hot" <b>', size: 'S' }]); ok(r.body.success, 'order hostile-name product', r.body);
  // sold-out size and oversell are flagged, never silently deducted
  const b2 = await onlineOf('p-rich', 'White', 'XL'); // 0 online (1 received, half floors to 0)
  r = await order([{ id: 'p-rich', name: 'x', price: 260, quantity: 1, color: 'White', size: 'XL' }]); ok(r.body.success === false || r.body.order.status === 'Needs Review', 'sold-out size flagged/rejected', r.body.order && r.body.order.status);
  ok((await onlineOf('p-rich', 'White', 'XL')) === b2, 'sold-out size not deducted');
  const m0 = await onlineOf('p-rich', 'White', 'L');
  r = await order([{ id: 'p-rich', name: 'x', price: 260, quantity: m0 + 5, color: 'White', size: 'L' }]); ok(r.body.success === false || r.body.order.status === 'Needs Review', 'oversell flagged/rejected', r.body.order && r.body.order.status);
  ok((await onlineOf('p-rich', 'White', 'L')) === m0, 'oversell not deducted');
  // a size that the product does not have
  r = await order([{ id: 'p-rich', name: 'x', price: 260, quantity: 1, color: 'Black', size: 'XL' }]); ok(r.body.success === false || r.body.order.status === 'Needs Review', 'non-existent size for colour flagged/rejected', r.body.order && r.body.order.status);
  // negative / zero / fractional quantities
  for (const q of [0, -3, 1.5, 'abc', null]) { const before2 = JSON.stringify((await ST()).totals); r = await order([{ id: 'p-rich', name: 'x', price: 260, quantity: q, color: 'White', size: 'M' }]); const after2 = JSON.stringify((await ST()).totals); ok(before2 === after2 || (q === 1.5 || q === 'abc'), 'odd quantity ' + q + ' does not corrupt pools', [before2, after2, r.body.message]); }
  // return restores the exact SKU
  const ordId = ord1.id; before = await onlineOf('p-rich', 'White', 'M');
  r = await call('PATCH', '/api/orders/' + ordId + '/return', owner, { status: 'Returned', returnReason: 'debug' }); ok(r.body.success, 'return order', r.body);
  ok((await onlineOf('p-rich', 'White', 'M')) === before + 2, 'return restores +2 to the same SKU');
  r = await call('PATCH', '/api/orders/' + ordId + '/return', owner, { status: 'Refunded', returnReason: 'again' });
  ok((await onlineOf('p-rich', 'White', 'M')) === before + 2, 'second return call does not double-restore');
  await checkSync('after return');
  // delete an order restores too
  r = await order([{ id: 'p-socks', name: 'x', price: 260, quantity: 2, color: '', size: '' }]); const delOrder = r.body.order; before = await onlineOf('p-socks', '', '');
  r = await call('DELETE', '/api/orders/' + delOrder.id, owner); ok(r.body.success, 'delete order', r.body);
  ok((await onlineOf('p-socks', '', '')) === before + 2, 'delete restores stock');
  // manual invoice (admin) with and without size
  before = await onlineOf('p-rich', 'Black', 'M');
  r = await call('POST', '/api/admin/manual-invoice', owner, { customer: { name: 'Walk in', phone: '0200000000' }, items: [{ id: 'p-rich', name: 'x', price: 250, quantity: 1, color: 'Black', size: 'M' }] });
  console.log('manual invoice endpoint ->', r.status, JSON.stringify(r.body).slice(0, 160));

  // ── 4. concurrency: 25 simultaneous orders for the last 3 packs ──────────
  await call('POST', '/api/supply/stock/count', owner, { pool: 'online', apply: true, lines: [{ productId: 'p-socks', colour: '', size: '', counted: 3 }] });
  const results = await Promise.all(Array.from({ length: 25 }, () => order([{ id: 'p-socks', name: 'x', price: 260, quantity: 1, color: '', size: '' }])));
  const good = results.filter(x => x.body.success && x.body.order.status !== 'Needs Review').length;
  const left = await onlineOf('p-socks', '', '');
  console.log('concurrent orders accepted:', good, 'pool left:', left);
  ok(left >= 0 && good <= 3 && left === 3 - good, 'concurrent orders never oversell', { good, left });
  await checkSync('after concurrency');

  // ── 5. money lifecycle with an independent ledger ────────────────────────
  await call('POST', '/api/supply/stock/intake', owner, { lines: [{ productId: 'p-socks', colour: '', size: '', received: 10 }, { productId: 'p-rich', colour: 'White', size: 'M', received: 10 }] });
  await call('POST', '/api/supply/stock/transfer', owner, { from: 'dome', to: 'supply', lines: [{ productId: 'p-socks', colour: '', size: '', packs: 10 }, { productId: 'p-rich', colour: 'White', size: 'M', packs: 10 }] });
  const rnd = await call('POST', '/api/supply/rounds', owner, { lines: [{ productId: 'p-rich', colour: 'White', size: 'M', packs: 8 }, { productId: 'p-socks', colour: '', size: '', packs: 1 }] }); ok(rnd.body.success, 'round for money tests', rnd.body);
  console.log('round create ->', rnd.status, JSON.stringify(rnd.body).slice(0,300)); const round = rnd.body.round;
  const mk = (shop, no, date, packs) => call('POST', '/api/supply/supplies', owner, { shopId: shop.id, invoiceNo: no, date, roundId: round.id, lines: [{ productId: 'p-rich', colour: 'White', size: 'M', packs, unitPrice: 250.2 }] });
  const day = n => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
  const t1 = await mk(alpha, 'D-001', day(-40), 2); console.log('mk1 ->', t1.status, JSON.stringify(t1.body).slice(0,200)); const s1 = t1.body.supply, s2 = (await mk(alpha, 'D-002', day(-5), 1)).body.supply, s3 = (await mk(beta, 'D-003', day(-20), 2)).body.supply;
  ok(s1 && s1.amount === 500.4 && s1.status === 'overdue', 'S1 500.40 overdue', s1);
  ok(s3 && s3.status === 'overdue' && s3.daysOverdue === 6, 'beta 14-day terms: 20 days ago is 6 overdue', s3 && s3.daysOverdue);
  const recv0 = (await call('GET', '/api/supply/reports/receivables', owner)).body; ok(recv0.totalOwed === r2(500.4 + 250.2 + 500.4), 'receivables total', recv0.totalOwed);
  // part pay, then cheque covering 2 invoices, bounced, re-received, cleared
  r = await call('POST', '/api/supply/payments', owner, { shopId: alpha.id, supplyId: s1.id, amount: 100, method: 'cash' }); ok(r.body.success, 'part payment', r.body);
  r = await call('POST', '/api/supply/payments', owner, { shopId: alpha.id, supplyId: s1.id, amount: 400.5, method: 'cash' }); ok(r.status === 400, 'over-payment rejected (only 400.40 left)', r.body);
  r = await call('POST', '/api/supply/payments', owner, { shopId: alpha.id, amount: 1e999, method: 'cash' }); ok(r.status === 400, 'infinite payment rejected', r.body);
  r = await call('POST', '/api/supply/payments', owner, { shopId: alpha.id, amount: '0.001', method: 'cash' }); ok(r.status === 400, 'sub-cent payment rejected', r.body);
  const chq = async (no, allocs, extra) => { const fd = new FormData(); fd.append('data', JSON.stringify({ shopId: alpha.id, chequeNo: no, chequeDate: day(0), allocations: allocs, ...(extra || {}) })); return call('POST', '/api/supply/cheques', owner, fd); };
  r = await chq('C-1', [{ supplyId: s1.id, amount: 400.4 }, { supplyId: s2.id, amount: 250.2 }]); console.log('cheque ->', r.status, JSON.stringify(r.body).slice(0,300)); ok(r.body.success, 'cheque covering two invoices', r.body); const c1 = r.body.cheque;
  let d1 = (await call('GET', '/api/supply/supplies/' + s1.id, owner)).body; ok(d1.balance === 400.4 && d1.chequePending === 400.4 && d1.available === 0, 'balance unchanged until cleared', d1);
  r = await call('POST', '/api/supply/payments', owner, { shopId: alpha.id, supplyId: s1.id, amount: 1, method: 'cash' }); ok(r.status === 400, 'cannot also pay what a cheque already covers', r.body);
  r = await chq('C-1', [{ supplyId: s2.id, amount: 1 }]); ok(r.status === 400, 'duplicate cheque number rejected', r.body);
  r = await chq('C-2', [{ supplyId: s2.id, amount: 1 }]); ok(r.status === 400, 'second cheque cannot exceed remaining cover', r.body);
  r = await chq('C-3', [{ supplyId: s3.id, amount: 100 }]); ok(r.status === 400, 'cheque for another shop’s invoice rejected', r.body);
  r = await call('PUT', '/api/supply/cheques/' + c1.id + '/status', owner, { status: 'deposited' }); ok(r.body.success, 'deposited');
  r = await call('PUT', '/api/supply/cheques/' + c1.id + '/status', owner, { status: 'bounced', note: 'refer to drawer' }); ok(r.body.success, 'bounced');
  d1 = (await call('GET', '/api/supply/supplies/' + s1.id, owner)).body; ok(d1.chequePending === 0 && d1.balance === 400.4 && d1.available === 400.4, 'bounce re-opens cover', d1);
  r = await call('PUT', '/api/supply/cheques/' + c1.id + '/status', owner, { status: 'received' }); r = await call('PUT', '/api/supply/cheques/' + c1.id + '/status', owner, { status: 'cleared' });
  d1 = (await call('GET', '/api/supply/supplies/' + s1.id, owner)).body; const d2 = (await call('GET', '/api/supply/supplies/' + s2.id, owner)).body;
  ok(d1.balance === 0 && d1.status === 'paid' && d2.balance === 0 && d2.status === 'paid', 'cleared cheque pays both', [d1.balance, d2.balance]);
  r = await call('POST', '/api/supply/supplies/' + s1.id + '/void', owner, { reason: 'x' }); ok(r.status === 409, 'cannot void a paid invoice', r.body);
  r = await call('POST', '/api/supply/cheques/' + c1.id + '/void', owner, { reason: 'test' }); d1 = (await call('GET', '/api/supply/supplies/' + s1.id, owner)).body; ok(d1.balance === 400.4, 'voiding the cheque re-opens the invoice', d1.balance);
  // rankings sanity
  const rk = (await call('GET', '/api/supply/rankings', owner)).body; ok(rk.shopsByAmount.length >= 2, 'rankings build'); ok(rk.payment.every(p => p.onTimePct >= 0 && p.onTimePct <= 100), 'pct in range');
  // swap with credit: taking back more than given
  const sw = await call('POST', '/api/supply/supplies', owner, { shopId: beta.id, invoiceNo: '', date: day(0), roundId: round.id, lines: [], takenBack: [{ productId: 'p-rich', colour: 'White', size: 'M', packs: 1, unitPrice: 250.2 }] });
  ok(sw.body.success && sw.body.supply.kind === 'credit' && sw.body.supply.creditAmount === 250.2, 'credit swap', sw.body);
  let bshop = (await call('GET', '/api/supply/shops/' + beta.id, owner)).body.shop; ok(bshop.balance === r2(500.4 - 250.2), 'credit reduces what beta owes', bshop.balance);
  r = await call('POST', '/api/supply/supplies/' + sw.body.supply.id + '/void', owner, { reason: 'mistake' }); ok(r.body.success, 'void credit swap', r.body);
  bshop = (await call('GET', '/api/supply/shops/' + beta.id, owner)).body.shop; ok(bshop.balance === 500.4, 'voiding the credit swap restores what beta owes', bshop.balance);
  // duplicate invoice numbers, case-insensitive
  r = await mk(alpha, 'd-001', day(0), 1); ok(r.status === 400, 'duplicate invoice number rejected (case-insensitive)', r.body);
  // supply more than carried
  r = await mk(alpha, 'D-BIG', day(0), 999); ok(r.status === 400, 'cannot supply more than carried', r.body);
  // shops with records cannot be deleted; credit limit exists
  r = await call('DELETE', '/api/supply/shops/' + alpha.id, owner); ok(r.status === 409, 'shop with records not deletable');

  // ── 6. stock invariants: pools equal the sum of logged movements ──────────
  o = await ST(); const mv = (await call('GET', '/api/supply/stock/movements?limit=500', owner)).body;
  const calc = {}; mv.forEach(m => { const k = m.key + '#' + m.pool; calc[k] = (calc[k] || 0) + m.delta; });
  let bad = 0, neg = 0; o.products.forEach(p => Object.keys(p.skus).forEach(k => ['dome', 'online', 'supply'].forEach(pl => { const v = p.skus[k][pl]; if (v < 0) neg++; const ck = p.id + '|' + k + '#' + pl; if ((calc[ck] || 0) !== v) { bad++; if (bad < 6) console.log('  ledger mismatch', ck, 'pool', v, 'log', calc[ck] || 0); } })));
  ok(neg === 0, 'no negative pools'); ok(bad === 0, 'pools equal the sum of logged movements', bad);
  console.log('movement log rows:', mv.length, '(capped at 500 per query)');

  // ── 7. restart persistence is checked by the caller (state dump) ─────────
  require('fs').writeFileSync(require('path').join(process.env.DATA_DIR,'state-after-logic.json'), JSON.stringify({ stock: await ST(), shops: (await call('GET', '/api/supply/shops', owner)).body, supplies: (await call('GET', '/api/supply/supplies?includeVoid=true', owner)).body, todo: (await call('GET', '/api/supply/todo', owner)).body }));
  console.log(`\n${pass} passed, ${failn} failed`); fails.forEach(f => console.log('FAIL:', f));
})().catch(e => { console.error('CRASH', e.message); fails.forEach(f => console.log('FAIL:', f)); process.exit(1); });
