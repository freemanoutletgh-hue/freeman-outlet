// Role-permission checks for staff (the WhatsApp handler): should see stock, must not be able to edit
// products/prices/categories/stock, and existing owner/manager/viewer behaviour must be unaffected.
const base = 'http://localhost:3100';
let pass = 0, failn = 0; const fails = [];
const ok = (c, m, extra) => { if (c) pass++; else { failn++; fails.push(m + (extra !== undefined ? ' -> ' + JSON.stringify(extra).slice(0, 220) : '')); } };
async function call(method, url, token, body) {
  const headers = {}; if (token) headers.Authorization = 'Bearer ' + token;
  let payload; if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = typeof body === 'string' ? body : JSON.stringify(body); }
  const r = await fetch(base + url, { method, headers, body: payload });
  const t = await r.text(); let j; try { j = JSON.parse(t); } catch (e) { j = { _raw: t.slice(0, 200) }; }
  return { status: r.status, body: j };
}
(async () => {
  const login = async (u, p) => (await call('POST', '/api/admin/login', null, { username: u, password: p })).body.token;
  const owner = await login('admin', 'freeman2026'); ok(!!owner, 'owner login');
  let r = await call('POST', '/api/admin/accounts', owner, { username: 'clerk2', password: 'ClerkPass-12345', name: 'Clerk', role: 'staff' }); ok(r.body.success, 'create staff', r.body);
  r = await call('POST', '/api/admin/accounts', owner, { username: 'mgr2', password: 'MgrPass-123456', name: 'Mgr', role: 'manager' }); ok(r.body.success, 'create manager', r.body);
  const staff = await login('clerk2', 'ClerkPass-12345'), mgr = await login('mgr2', 'MgrPass-123456');

  // stock visibility: staff CAN read the new summary
  r = await call('GET', '/api/supply/stock-summary', staff); ok(r.status === 200 && Array.isArray(r.body.products) && r.body.canManage === false, 'staff reads stock-summary, canManage=false', [r.status, r.body.canManage]);
  r = await call('GET', '/api/supply/stock-summary', mgr); ok(r.status === 200 && r.body.canManage === true, 'manager reads stock-summary, canManage=true', r.body.canManage);
  r = await call('GET', '/api/supply/stock-summary', owner); ok(r.status === 200 && r.body.canManage === true, 'owner reads stock-summary');
  r = await call('GET', '/api/supply/stock-summary', null); ok(r.status === 401, 'anon cannot read stock-summary', r.status);
  // stock-summary must not leak shops/money — it is stock.js data only, sanity-check shape
  ok(r.status === 401 || !('shops' in (r.body || {})), 'no shop data in summary shape');

  // staff must NOT reach the private Supply app data at all (unchanged)
  r = await call('GET', '/api/supply/stock', staff); ok(r.status === 403, 'staff still blocked from full /api/supply/stock', r.status);
  r = await call('GET', '/api/supply/shops', staff); ok(r.status === 403, 'staff still blocked from shops', r.status);

  // staff must NOT be able to edit products, prices, images, categories, stock, faqs, reviews, notify, delivery config
  const pid = 'p-rich';
  const blocked = [
    ['PUT', '/api/products/' + pid, { name: 'Hacked' }],
    ['POST', '/api/products', { name: 'New' }],
    ['POST', '/api/products/' + pid + '/duplicate', {}],
    ['POST', '/api/products/bulk', { ids: [pid], action: 'delete' }],
    ['PUT', '/api/products/' + pid + '/featured', { featured: true }],
    ['PUT', '/api/products/sort-order', { order: [pid] }],
    ['PATCH', '/api/products/' + pid + '/listed', { isListed: false }],
    ['PATCH', '/api/products/' + pid + '/stock', { stock: 999 }],
    ['PATCH', '/api/products/' + pid + '/variant-stock', { variant: 'White', qty: 999 }],
    ['POST', '/api/stock-intakes', { lines: [{ productId: pid, qty: 5 }] }],
    ['GET', '/api/inventory/meta', undefined],
    ['PUT', '/api/inventory/meta/' + pid, { actualCost: 1 }],
    ['POST', '/api/categories', { name: 'Hacked' }],
    ['PUT', '/api/categories/reorder', { order: [] }],
    ['PUT', '/api/categories/Men/toggle', {}],
    ['POST', '/api/faqs', { q: 'x', a: 'y' }],
    ['PUT', '/api/faqs/1', { q: 'x' }],
    ['PATCH', '/api/reviews/1/approve', { approved: true }],
    ['PUT', '/api/reviews/1/featured', { featured: true }],
    ['POST', '/api/notify/1/send', {}],
    ['POST', '/api/site-images/hero', {}],
    ['POST', '/api/site-video/hero', {}],
    ['POST', '/api/delivery', {}],
    ['PUT', '/api/zone-map/tiers', {}],
    ['PUT', '/api/zone-map/areas', {}],
    ['PUT', '/api/region-rates', {}],
    ['POST', '/api/admin/test-email', {}],
    ['PATCH', '/api/admin/abandoned-carts/x/recovered', {}],
    ['POST', '/api/admin/accounts', { username: 'x', password: 'x12345678', name: 'x', role: 'owner' }],
  ];
  for (const [m, u, b] of blocked) { r = await call(m, u, staff, b); ok(r.status === 403, `staff ${m} ${u} -> 403`, r.status); }

  // manager/owner must still be able to do these (spot-check a few, non-destructively where possible)
  r = await call('PATCH', '/api/products/' + pid + '/listed', mgr, { isListed: true }); ok(r.status === 200, 'manager can still toggle listed', r.body);
  r = await call('GET', '/api/inventory/meta', mgr); ok(r.status === 200, 'manager can still read inventory meta', r.status);
  r = await call('POST', '/api/faqs', mgr, { q: 'Test?', a: 'Yes.' }); ok(r.status === 200 || r.status === 201, 'manager can still add a FAQ', [r.status, r.body]);

  // staff-facing actions that MUST still work (their actual job)
  r = await call('POST', '/api/codes', staff, { code: 'STAFF10', type: 'percent', value: 10 }); ok(r.status === 200 || r.status === 201, 'staff can still create a promo code', [r.status, r.body]);
  r = await call('POST', '/api/admin/manual-invoice', staff, { customer: { name: 'Walk in' }, items: [{ description: 'x', price: 10, qty: 1 }], mode: 'save' }); ok(r.status === 200, 'staff can still create a manual invoice', [r.status, r.body]);
  r = await call('GET', '/api/orders', staff); ok(r.status === 200, 'staff can still read orders', r.status);
  r = await call('GET', '/api/admin/all-products', staff); ok(r.status === 200, 'staff can still read all-products (needed for invoices/stock quoting)', r.status);

  console.log(`\n${pass} passed, ${failn} failed`); fails.forEach(f => console.log('FAIL:', f));
})().catch(e => { console.error('CRASH', e.message); fails.forEach(f => console.log('FAIL:', f)); process.exit(1); });
