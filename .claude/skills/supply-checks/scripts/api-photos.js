// Manual invoices, flagged orders, cheque photos and their privacy, on the isolated debug server (3100).
const sharp = require('sharp');
const base = 'http://localhost:3100';
let pass = 0, failn = 0; const fails = [];
const ok = (c, m, extra) => { if (c) pass++; else { failn++; fails.push(m + (extra !== undefined ? ' -> ' + JSON.stringify(extra).slice(0, 260) : '')); } };
let ipn = 1;
async function call(method, url, token, body, fresh, raw) {
  const headers = {}; if (token) headers.Authorization = 'Bearer ' + token; if (fresh) headers['X-Forwarded-For'] = '10.8.' + (ipn >> 8) + '.' + (ipn++ & 255);
  let payload; if (body !== undefined) { if (body instanceof FormData) payload = body; else { headers['Content-Type'] = 'application/json'; payload = typeof body === 'string' ? body : JSON.stringify(body); } }
  const r = await fetch(base + url, { method, headers, body: payload });
  if (raw) return r;
  const t = await r.text(); let j; try { j = JSON.parse(t); } catch (e) { j = { _raw: t.slice(0, 200) }; }
  return { status: r.status, body: j };
}
(async () => {
  const login = async (u, p) => (await call('POST', '/api/admin/login', null, { username: u, password: p })).body.token;
  const owner = await login('admin', 'freeman2026');
  let r = await call('POST', '/api/admin/accounts', owner, { username: 'boss', password: 'BossPass-12345', name: 'Boss', role: 'viewer' });
  r = await call('POST', '/api/admin/accounts', owner, { username: 'clerk', password: 'ClerkPass-12345', name: 'Clerk', role: 'staff' });
  const viewer = await login('boss', 'BossPass-12345'), staff = await login('clerk', 'ClerkPass-12345');
  const ST = async () => (await call('GET', '/api/supply/stock', owner)).body;
  const online = async (pid, c, s) => (await ST()).products.find(p => p.id === pid).skus[c + '|' + s].online;
  await call('PUT', '/api/supply/prices', owner, { standardPrice: 250.2 });

  // stock: rich product, Black M 5 / L 2 online
  await call('POST', '/api/supply/stock/intake', owner, { lines: [{ productId: 'p-rich', colour: 'Black', size: 'M', received: 10 }, { productId: 'p-rich', colour: 'Black', size: 'L', received: 4 }, { productId: 'p-rich', colour: 'White', size: 'M', received: 10 }] });
  await call('POST', '/api/supply/stock/transfer', owner, { from: 'dome', to: 'online', lines: [{ productId: 'p-rich', colour: 'Black', size: 'M', packs: 5 }, { productId: 'p-rich', colour: 'Black', size: 'L', packs: 2 }, { productId: 'p-rich', colour: 'White', size: 'M', packs: 4 }] });
  r = await call('PUT', '/api/supply/stock/tracking', owner, { on: true, confirm: true }); ok(r.body.success, 'tracking on');

  // ── manual invoices ───────────────────────────────────────────────────────
  const inv = (item) => call('POST', '/api/admin/manual-invoice', owner, { customer: { name: 'Walk in', phone: '0200000000' }, items: [item], mode: 'save' });
  let b = await online('p-rich', 'Black', 'M');
  r = await inv({ productId: 'p-rich', description: 'Black M', price: 250, qty: 2, color: 'Black', size: 'M' }); ok(r.body.success, 'manual invoice with size', r.body);
  ok((await online('p-rich', 'Black', 'M')) === b - 2, 'manual invoice deducts the exact size');
  // no size given: takes from the size with most stock for that colour (Black M has 3 now, L has 2)
  b = [await online('p-rich', 'Black', 'M'), await online('p-rich', 'Black', 'L')];
  r = await inv({ productId: 'p-rich', description: 'Black any size', price: 250, qty: 1, color: 'Black', size: '' }); ok(r.body.success, 'manual invoice without size', r.body);
  const a2 = [await online('p-rich', 'Black', 'M'), await online('p-rich', 'Black', 'L')]; ok(a2[0] + a2[1] === b[0] + b[1] - 1, 'no-size invoice deducts exactly one pack in total', [b, a2]);
  // custom line (no productId) must not touch stock
  const tot = JSON.stringify((await ST()).totals); r = await inv({ description: 'Delivery bag', price: 5, qty: 1 }); ok(r.body.success && JSON.stringify((await ST()).totals) === tot, 'custom line leaves stock alone', r.body);
  // manual invoice for more than online has
  const lb = await online('p-rich', 'Black', 'L'); r = await inv({ productId: 'p-rich', description: 'too many', price: 250, qty: lb + 3, color: 'Black', size: 'L' });
  console.log('manual oversell ->', r.status, JSON.stringify(r.body).slice(0, 160)); ok(r.status === 400 || (await online('p-rich', 'Black', 'L')) === lb, 'manual oversell is blocked or leaves stock untouched');
  ok((await online('p-rich', 'Black', 'L')) >= 0, 'never negative');

  // ── flagged order (oversold) shipped later: pool clamps at 0, shortage logged ──
  const order = (items) => call('POST', '/api/whatsapp-order', null, { customer: { name: 'Ama', phone: '0242222222' }, cartItems: items, deliveryZone: 'Accra', deliveryAddress: 'Tema' }, true);
  const wl = await online('p-rich', 'White', 'M');
  r = await order([{ id: 'p-rich', name: 'x', price: 260, quantity: wl + 2, color: 'White', size: 'M' }]);
  const flagged = r.body.order; ok(flagged && flagged.status === 'Needs Review', 'oversold order is flagged Needs Review', flagged && flagged.status);
  ok((await online('p-rich', 'White', 'M')) === wl, 'flagged order deducted nothing');
  r = await call('PATCH', '/api/orders/' + flagged.id + '/status', owner, { status: 'Shipped' }); ok(r.body.success, 'ship flagged order', r.body);
  ok((await online('p-rich', 'White', 'M')) === 0, 'shipping clamps the pool at zero, not negative', await online('p-rich', 'White', 'M'));
  const mv = (await call('GET', '/api/supply/stock/movements?limit=50', owner)).body; ok(mv.some(m => m.type === 'online-short'), 'shortage is logged for a recount', mv.map(m => m.type));
  r = await call('PATCH', '/api/orders/' + flagged.id + '/return', owner, { status: 'Returned', returnReason: 'x' });
  ok((await online('p-rich', 'White', 'M')) === wl + 2, 'returning the oversold order restores its full quantity (pool 4? or 2+...)', await online('p-rich', 'White', 'M'));

  // ── cheque photo privacy ──────────────────────────────────────────────────
  r = await call('POST', '/api/supply/shops', owner, { name: 'Photo Shop', termsDays: 30 }); const shop = r.body.shop;
  await call('POST', '/api/supply/supplies', owner, { shopId: shop.id, invoiceNo: 'PH-1', date: '2026-09-01', amount: 1000 });
  const sup = (await call('GET', '/api/supply/supplies', owner)).body.find(s => s.invoiceNo === 'PH-1');
  const jpg = await sharp({ create: { width: 3000, height: 2000, channels: 3, background: { r: 200, g: 180, b: 120 } } }).jpeg().toBuffer();
  const mkChq = (no, buf, name, type) => { const fd = new FormData(); fd.append('data', JSON.stringify({ shopId: shop.id, chequeNo: no, chequeDate: '2026-09-21', allocations: [{ supplyId: sup.id, amount: 100 }] })); if (buf) fd.append('photo', new Blob([buf], { type: type || 'image/jpeg' }), name || 'c.jpg'); return call('POST', '/api/supply/cheques', owner, fd); };
  r = await mkChq('PH-100', Buffer.from('this is not an image at all'), 'x.jpg'); ok(r.status === 400, 'non-image upload rejected', r.body);
  r = await call('GET', '/api/supply/cheques', owner); ok(r.body.length === 0, 'rejected upload left no cheque behind', r.body.length);
  r = await mkChq('PH-101', Buffer.alloc(13 * 1024 * 1024, 1), 'big.jpg'); ok(r.status >= 400 && r.status < 500 || r.status === 500, 'oversize upload rejected', r.status); console.log('oversize ->', r.status, JSON.stringify(r.body).slice(0, 120));
  r = await mkChq('PH-102', jpg, 'ok.jpg'); ok(r.body.success && r.body.cheque.hasPhoto, 'valid photo saved', r.body); const chq = r.body.cheque;
  ok(!('photo' in {}) && true, 'sanity');
  const list = (await call('GET', '/api/supply/cheques', viewer)).body; ok(list[0] && list[0].photo && !/^https?:/.test(list[0].photo), 'api exposes only a file name, never a public URL', list[0] && list[0].photo);
  const pr = await call('GET', '/api/supply/cheques/' + chq.id + '/photo', owner, undefined, false, true); ok(pr.status === 200 && (pr.headers.get('content-type') || '').includes('image/jpeg'), 'owner can view photo', pr.status);
  const buf = Buffer.from(await pr.arrayBuffer()); const meta = await sharp(buf).metadata(); ok(meta.width <= 1400 && meta.height <= 1400, 'photo is shrunk to max 1400px', [meta.width, meta.height]); ok(buf.length < 400000, 'photo file is small', buf.length);
  ok((await call('GET', '/api/supply/cheques/' + chq.id + '/photo', viewer, undefined, false, true)).status === 200, 'viewer can view photo');
  ok((await call('GET', '/api/supply/cheques/' + chq.id + '/photo', staff, undefined, false, true)).status === 403, 'staff cannot view photo');
  ok((await call('GET', '/api/supply/cheques/' + chq.id + '/photo', null, undefined, false, true)).status === 401, 'anonymous cannot view photo');
  for (const u of ['/api/supply/cheques/..%2f..%2fshops.json/photo', '/api/supply/cheques/%2e%2e/photo', '/data/private/cheques/' + chq.photo, '/private/cheques/' + chq.photo, '/uploads/' + chq.photo, '/uploads/../data/private/cheques/' + chq.photo, '/assets/../data/private/cheques/' + chq.photo]) {
    const x = await call('GET', u, owner, undefined, false, true); const ct = x.headers.get('content-type') || ''; ok(!(x.status === 200 && ct.includes('image')), 'no photo reachable via ' + u, [x.status, ct]);
    const y = await call('GET', u, null, undefined, false, true); ok(!(y.status === 200 && (y.headers.get('content-type') || '').includes('image')), 'anonymous: no photo via ' + u, y.status);
  }
  r = await call('POST', '/api/supply/cheques/' + chq.id + '/void', owner, { reason: 'test' });
  // practice clear removes practice photos
  await call('PUT', '/api/supply/settings', owner, { practice: true });
  const shop2 = (await call('POST', '/api/supply/shops', owner, { name: 'Practice Shop' })).body.shop; await call('POST', '/api/supply/supplies', owner, { shopId: shop2.id, invoiceNo: 'PR-1', amount: 500 });
  const sup2 = (await call('GET', '/api/supply/supplies', owner)).body.find(s => s.invoiceNo === 'PR-1'); const fd = new FormData(); fd.append('data', JSON.stringify({ shopId: shop2.id, chequeNo: 'PR-C1', chequeDate: '2026-09-21', allocations: [{ supplyId: sup2.id, amount: 50 }] })); fd.append('photo', new Blob([jpg], { type: 'image/jpeg' }), 'p.jpg');
  const pc = (await call('POST', '/api/supply/cheques', owner, fd)).body.cheque; ok(pc && pc.hasPhoto, 'practice cheque with photo');
  r = await call('POST', '/api/supply/stock/intake', owner, { lines: [{ productId: 'p-socks', colour: '', size: '', received: 1 }] }); ok(r.status === 409, 'stock changes are blocked in practice mode', r.body);
  r = await call('POST', '/api/supply/practice/clear', owner, { confirm: 'clear' }); ok(r.status === 400, 'clear needs exact word');
  r = await call('POST', '/api/supply/practice/clear', owner, { confirm: 'CLEAR' }); ok(r.body.success, 'practice clear');
  await call('PUT', '/api/supply/settings', owner, { practice: false });
  ok((await call('GET', '/api/supply/shops', owner)).body.every(s => s.name !== 'Practice Shop'), 'practice shop is gone');
  ok((await call('GET', '/api/supply/shops', owner)).body.some(s => s.name === 'Photo Shop'), 'real shop survived practice clear');
  const fs = require('fs'), path = require('path'); const dir = path.join(process.env.DATA_DIR, 'private', 'cheques');
  const files = fs.readdirSync(dir); ok(!files.some(f => f.includes(pc.id)), 'practice photo file deleted from disk', files);
  console.log('photo files on disk:', files);

  // ── restart persistence: dump, the caller restarts the server, then compares ──
  fs.writeFileSync(path.join(process.env.DATA_DIR,'state-after-photos.json'), JSON.stringify({ stock: await ST(), shops: (await call('GET', '/api/supply/shops', owner)).body, supplies: (await call('GET', '/api/supply/supplies?includeVoid=true', owner)).body, cheques: (await call('GET', '/api/supply/cheques', owner)).body, settings: (await call('GET', '/api/supply/settings', owner)).body }));
  console.log(`\n${pass} passed, ${failn} failed`); fails.forEach(f => console.log('FAIL:', f));
})().catch(e => { console.error('CRASH', e); fails.forEach(f => console.log('FAIL:', f)); process.exit(1); });
