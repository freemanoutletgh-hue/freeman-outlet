// Adversarial API checks against the isolated debug server (port 3100).
const base = 'http://localhost:3100';
let pass = 0, failn = 0; const fails = [];
const ok = (c, m, extra) => { if (c) pass++; else { failn++; fails.push(m + (extra !== undefined ? ' -> ' + JSON.stringify(extra).slice(0, 220) : '')); } };
async function call(method, url, token, body, raw) {
  const headers = {}; if (token) headers.Authorization = 'Bearer ' + token;
  let payload; if (body !== undefined) { if (body instanceof FormData) payload = body; else { headers['Content-Type'] = 'application/json'; payload = typeof body === 'string' ? body : JSON.stringify(body); } }
  const r = await fetch(base + url, { method, headers, body: payload });
  const t = await r.text(); let j; try { j = JSON.parse(t); } catch (e) { j = { _raw: t.slice(0, 200) }; }
  return { status: r.status, body: j, text: t };
}
(async () => {
  const login = async (u, p) => (await call('POST', '/api/admin/login', null, { username: u, password: p })).body.token;
  const owner = await login('admin', 'freeman2026'); ok(!!owner, 'owner login');
  // accounts
  let r = await call('POST', '/api/admin/accounts', owner, { username: 'boss', password: 'BossPass-12345', name: 'Boss', role: 'viewer' }); ok(r.body.success, 'create viewer', r.body);
  r = await call('POST', '/api/admin/accounts', owner, { username: 'clerk', password: 'ClerkPass-12345', name: 'Clerk', role: 'staff' }); ok(r.body.success, 'create staff', r.body);
  r = await call('POST', '/api/admin/accounts', owner, { username: 'mgr', password: 'MgrPass-123456', name: 'Mgr', role: 'manager' }); ok(r.body.success, 'create manager', r.body);
  const viewer = await login('boss', 'BossPass-12345'), staff = await login('clerk', 'ClerkPass-12345'), mgr = await login('mgr', 'MgrPass-123456');

  // ── A. authorization matrix ────────────────────────────────────────────────
  const gets = ['/api/supply/shops', '/api/supply/prices', '/api/supply/settings', '/api/supply/rounds/current', '/api/supply/rounds', '/api/supply/supplies', '/api/supply/payments', '/api/supply/cheques', '/api/supply/calls', '/api/supply/todo', '/api/supply/todo/count', '/api/supply/reports/receivables', '/api/supply/reports/vat', '/api/supply/rankings', '/api/supply/daily', '/api/supply/stock', '/api/supply/stock/alerts', '/api/supply/stock/movements', '/api/supply/stock/intakes', '/api/supply/plan', '/api/supply/next-invoice-no'];
  for (const u of gets) {
    r = await call('GET', u); ok(r.status === 401, 'anon GET ' + u + ' is 401', r.status);
    r = await call('GET', u, staff); ok(r.status === 403, 'staff GET ' + u + ' is 403', r.status);
    r = await call('GET', u, viewer); ok(r.status === 200, 'viewer GET ' + u + ' is 200', r.status);
    r = await call('GET', u, mgr); ok(r.status === 200, 'manager GET ' + u + ' is 200', r.status);
  }
  const writes = [['POST', '/api/supply/shops', { name: 'Zed' }], ['PUT', '/api/supply/prices', { standardPrice: 1 }], ['PUT', '/api/supply/settings', { practice: true }], ['POST', '/api/supply/rounds', { lines: [] }], ['POST', '/api/supply/supplies', {}], ['POST', '/api/supply/payments', {}], ['POST', '/api/supply/calls', {}],
    ['POST', '/api/supply/stock/intake', {}], ['POST', '/api/supply/stock/transfer', {}], ['POST', '/api/supply/stock/count', {}], ['PUT', '/api/supply/stock/tracking', { on: true }], ['PUT', '/api/supply/stock/sizes', {}], ['PUT', '/api/supply/stock/size-guides/socks', {}], ['POST', '/api/supply/practice/clear', {}], ['POST', '/api/supply/visits', {}], ['GET', '/api/supply/backup']];
  for (const [m, u, b] of writes) {
    r = await call(m, u, viewer, b); ok(r.status === 403, `viewer ${m} ${u} is 403`, r.status);
    r = await call(m, u, staff, b); ok(r.status === 403, `staff ${m} ${u} is 403`, r.status);
    r = await call(m, u, null, b); ok(r.status === 401, `anon ${m} ${u} is 401`, r.status);
  }
  // viewer on other admin areas
  for (const u of ['/api/admin/all-products', '/api/orders', '/api/admin/accounts', '/api/admin/stats']) { r = await call('GET', u, viewer); ok(r.status === 403 || r.status === 404, 'viewer blocked from ' + u, r.status); }
  r = await call('GET', '/api/admin/me', viewer); ok(r.status === 200 && r.body.role === 'viewer', 'viewer can read /me', r.body);
  r = await call('GET', '/api/supply/../admin/all-products', viewer); ok(r.status !== 200, 'viewer path trick', r.status);
  // public endpoints must not leak anything private
  r = await call('GET', '/api/stock/availability'); ok(r.status === 200 && r.body.tracking === false, 'public availability off', r.body);
  r = await call('GET', '/api/size-guides'); ok(r.status === 200 && r.body.socks, 'public size guides');
  for (const u of ['/data/shops.json', '/data/supplies.json', '/data/private/cheques/', '/uploads/../data/shops.json', '/private/cheques/x.jpg', '/supply-stock.json', '/shops.json']) { r = await call('GET', u); ok(r.status === 404 || (r.text || '').indexOf('"shop-online"') < 0, 'no data leak at ' + u, r.status); }

  // ── B. input fuzz ─────────────────────────────────────────────────────────
  const shopBodies = [{}, { name: '' }, { name: 'a' }, { name: 'x'.repeat(5000) }, { name: 'OK1', termsDays: -1 }, { name: 'OK2', termsDays: 'abc' }, { name: 'OK3', termsDays: 9999 }, { name: 'OK4', creditLimit: -5 }, { name: 'OK5', creditLimit: 'x' }, { name: 'OK6', reorderDays: 0 }, null, 'str', [], { name: { $ne: 1 } }, { name: '__proto__' }, { name: 'constructor' }];
  for (const b of shopBodies) { r = await call('POST', '/api/supply/shops', owner, b === null ? 'null' : b); ok(r.status === 400 || r.status === 200, 'shop fuzz no 500: ' + JSON.stringify(b).slice(0, 40), r.status); ok(r.status < 500, 'shop fuzz not 5xx ' + JSON.stringify(b).slice(0, 40), r.status); }
  r = await call('POST', '/api/supply/shops', owner, { name: 'Hostile <img src=x onerror=window.__xss=1> "Q\' &', contact: '<script>alert(1)</script>', termsDays: 30 }); ok(r.body.success, 'hostile shop stored', r.body);
  const hostileShop = r.body.shop;
  r = await call('POST', '/api/supply/shops', owner, { name: 'hostile <IMG src=x onerror=window.__xss=1> "q\' &' }); ok(r.status === 400, 'shop names unique case-insensitively', r.body);
  r = await call('POST', '/api/supply/shops', owner, { name: 'Alpha Shell', termsDays: 30, phone: '0240000000' }); const alpha = r.body.shop;
  r = await call('POST', '/api/supply/shops', owner, { name: 'Beta Mart', termsDays: 14 }); const beta = r.body.shop;
  r = await call('DELETE', '/api/supply/shops/shop-online', owner); ok(r.status === 409, 'cannot delete Online', r.body);
  r = await call('PUT', '/api/supply/shops/shop-online', owner, { name: 'Renamed' }); ok(r.status === 400, 'cannot rename Online', r.body);
  r = await call('POST', '/api/supply/shops', owner, { name: 'online' }); ok(r.status === 400, 'cannot duplicate Online', r.body);

  await call('PUT', '/api/supply/prices', owner, { standardPrice: 250.2 });
  r = await call('PUT', '/api/supply/prices', owner, { standardPrice: -1 }); ok(r.status === 400, 'negative price rejected', r.body);
  r = await call('PUT', '/api/supply/prices', owner, { standardPrice: 'abc' }); ok(r.status === 400, 'non-numeric price rejected', r.body);
  r = await call('PUT', '/api/supply/prices', owner, { prices: { '__proto__': 5, 'p-rich': 'x' } }); ok(r.status === 400, 'bad override rejected', r.body);
  r = await call('GET', '/api/supply/prices', owner); ok(r.body.standardPrice === 250.2, 'std price kept after bad puts', r.body.standardPrice);

  // rounds fuzz
  const roundBad = [{}, { lines: [] }, { lines: 'x' }, { lines: [{ productId: 'p-rich', colour: 'White', size: 'M', packs: 0 }] }, { lines: [{ productId: 'p-rich', colour: 'White', size: 'M', packs: -3 }] }, { lines: [{ productId: 'p-rich', colour: 'White', size: 'M', packs: 1.5 }] }, { lines: [{ productId: 'p-rich', colour: 'White', size: 'M', packs: '2' }] }, { lines: [{ productId: 'nope', packs: 1 }] }, { lines: [{ packs: 1 }] }, { date: '2026-13-45', lines: [{ productId: 'p-rich', colour: 'White', size: 'M', packs: 1 }] }, { lines: Array(700).fill({ productId: 'p-rich', colour: 'White', size: 'M', packs: 1 }) }];
  for (let i = 0; i < roundBad.length; i++) { r = await call('POST', '/api/supply/rounds', owner, roundBad[i]); if (i === 6) { ok(r.status === 200 || r.status === 400, 'string packs handled', r.status); if (r.status === 200) await call('POST', '/api/supply/rounds/' + r.body.round.id + '/close', owner, { returned: [{ productId: 'p-rich', colour: 'White', size: 'M', packs: 2 }] }); } else ok(r.status === 400, 'bad round #' + i + ' rejected', [r.status, r.body.message]); }
  r = await call('GET', '/api/supply/rounds/current', owner); ok(r.body === null || r.body._raw === 'null' || r.status === 200, 'no round open after rejects', r.body);

  // stock fuzz (tracking off)
  const stockBad = [
    ['POST', '/api/supply/stock/intake', { lines: [{ productId: 'p-rich', colour: 'White', size: 'M', received: -1 }] }],
    ['POST', '/api/supply/stock/intake', { lines: [{ productId: 'p-rich', colour: 'White', size: 'M', received: 1.5 }] }],
    ['POST', '/api/supply/stock/intake', { lines: [{ productId: 'p-rich', colour: 'White', size: 'M', received: 'abc' }] }],
    ['POST', '/api/supply/stock/intake', { lines: [{ productId: 'p-rich', colour: 'White', size: 'M', received: 1e12 }] }],
    ['POST', '/api/supply/stock/intake', { lines: [{ productId: 'p-rich', colour: 'Black', size: 'XL', received: 1 }] }],
    ['POST', '/api/supply/stock/intake', { lines: [{ productId: 'p-rich', colour: 'Green', size: 'M', received: 1 }] }],
    ['POST', '/api/supply/stock/intake', { lines: [{ productId: 'zzz', colour: '', size: '', received: 1 }] }],
    ['POST', '/api/supply/stock/intake', { lines: 'x' }], ['POST', '/api/supply/stock/intake', 'null'], ['POST', '/api/supply/stock/intake', { date: 'x', lines: [] }],
    ['POST', '/api/supply/stock/transfer', { from: 'dome', to: 'dome', lines: [{ productId: 'p-rich', colour: 'White', size: 'M', packs: 1 }] }],
    ['POST', '/api/supply/stock/transfer', { from: 'x', to: 'online', lines: [] }],
    ['POST', '/api/supply/stock/transfer', { from: 'dome', to: 'online', lines: [{ productId: 'p-rich', colour: 'White', size: 'M', packs: 5 }] }],
    ['POST', '/api/supply/stock/count', { pool: 'dome', lines: [{ productId: 'p-rich', colour: 'White', size: 'M', counted: -2 }] }],
    ['POST', '/api/supply/stock/count', { pool: 'nope', lines: [] }],
    ['PUT', '/api/supply/stock/sizes', { productIds: [], sizes: ['X'] }], ['PUT', '/api/supply/stock/sizes', { productIds: ['p-rich'], mode: 'set', sizes: [] }],
    ['PUT', '/api/supply/stock/size-guides/nope', { columns: ['a', 'b'], rows: [['1', '2']] }], ['PUT', '/api/supply/stock/size-guides/socks', { columns: ['a'], rows: [['1']] }], ['PUT', '/api/supply/stock/size-guides/socks', { columns: ['a', 'b'], rows: [] }],
  ];
  for (const [m, u, b] of stockBad) { r = await call(m, u, owner, b); ok(r.status >= 400 && r.status < 500, `stock bad ${m} ${u} ${JSON.stringify(b).slice(0, 70)} → 4xx`, [r.status, r.body.message]); }
  let ov = (await call('GET', '/api/supply/stock', owner)).body; ok(ov.totals.dome === 0 && ov.totals.online === 0 && ov.totals.supply === 0, 'no stock created by bad requests', ov.totals);

  // ── F. delimiter in a colour name ─────────────────────────────────────────
  r = await call('POST', '/api/supply/stock/intake', owner, { lines: [{ productId: 'p-pipe', colour: 'a|b', size: 'M', received: 5 }] });
  console.log('PIPE intake ->', r.status, JSON.stringify(r.body).slice(0, 200));
  ov = (await call('GET', '/api/supply/stock', owner)).body; const pp = ov.products.find(p => p.id === 'p-pipe'); console.log('PIPE product view ->', JSON.stringify(pp.skus), JSON.stringify(pp.colours));

  console.log(`\n${pass} passed, ${failn} failed`); fails.forEach(f => console.log('FAIL:', f));
})().catch(e => { console.error('CRASH', e); process.exit(1); });
