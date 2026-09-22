// Stock by size: every SKU (product x colour x size) is counted in packs across three pools.
//   dome   = the main warehouse (all stock arrives here)
//   online = at Spintex, sold through the website
//   supply = at Spintex, taken out on supply rounds
// While "tracking" is on, website sales, supply rounds and intakes all move these numbers, and the website
// only offers sizes that the online pool actually has. While it is off, the website behaves exactly as before.
const productType = require('./product-type');

module.exports = function registerStock({ app, requireAdminJWT, requireManagerOrOwner, loadJSON, saveJSON, dataDir, getProducts, saveProducts }) {
    const path = require('path');
    const STOCK_FILE = path.join(dataDir, 'supply-stock.json'), LOG_FILE = path.join(dataDir, 'supply-stock-log.json'), INTAKE_FILE = path.join(dataDir, 'supply-stock-intakes.json');
    let st = { tracking: false, since: null, lowOnline: 2, lowSupply: 2, skus: {}, ...loadJSON(STOCK_FILE, {}) };
    let log = loadJSON(LOG_FILE, []), intakes = loadJSON(INTAKE_FILE, []);
    const ctx = { supplyApi: null };
    const POOLS = ['dome', 'online', 'supply'];
    const POOL_NAME = { dome: 'Dome (main warehouse)', online: 'Online (Spintex)', supply: 'Supply (Spintex)' };
    const save = () => saveJSON(STOCK_FILE, st), saveLog = () => saveJSON(LOG_FILE, log), saveIntakes = () => saveJSON(INTAKE_FILE, intakes);
    const clean = (s, max) => String(s == null ? '' : s).trim().replace(/\s+/g, ' ').slice(0, max);
    const fail = (res, code, message) => res.status(code).json({ success: false, message });
    const by = req => req.adminUsername || 'admin';
    const key = (pid, colour, size) => [pid, colour || '', size || ''].join('|');
    const today = () => new Date().toISOString().slice(0, 10);
    const isPractice = () => !!(ctx.supplyApi && ctx.supplyApi.sset().practice);
    const allowViewer = (req, res, next) => ['owner', 'manager', 'viewer'].includes(req.adminRole) ? next() : fail(res, 403, 'Owner, manager or viewer access required.');
    // staff (the person handling WhatsApp orders) may see stock quantities, but not shops, money or the rest of Supply
    const allowStaffRead = (req, res, next) => ['owner', 'manager', 'viewer', 'staff'].includes(req.adminRole) ? next() : fail(res, 403, 'Access required.');
    const read = [requireAdminJWT, allowViewer], write = [requireAdminJWT, requireManagerOrOwner, (req, res, next) => isPractice() ? fail(res, 409, 'Practice mode is on. Turn it off to change real stock.') : next()];

    // ── product structure ────────────────────────────────────────────────────
    const colourName = v => typeof v === 'string' ? v : (v && (v.color || v.name)) || '';
    const isRich = p => Array.isArray(p.variants) && p.variants.length && typeof p.variants[0] === 'object';
    function coloursOf(p) { const c = (p.variants || []).map(colourName).filter(Boolean); return c.length ? c : ['']; }
    function sizesOf(p, colour) {
        const v = (p.variants || []).find(x => colourName(x) === colour);
        const s = (v && typeof v === 'object' && Array.isArray(v.sizes) && v.sizes.length) ? v.sizes : (Array.isArray(p.sizes) ? p.sizes : []);
        return s.length ? s : [''];
    }
    function skusOfProduct(p) { const out = []; coloursOf(p).forEach(c => sizesOf(p, c).forEach(s => out.push({ key: key(p.id, c, s), productId: p.id, colour: c, size: s }))); return out; }
    const rec = k => st.skus[k] || (st.skus[k] = { dome: 0, online: 0, supply: 0 });
    const have = (k, pool) => (st.skus[k] ? st.skus[k][pool] : 0) || 0;
    function checkSku(l) {
        const p = getProducts().find(x => x.id === l.productId); if (!p) return { error: 'A product no longer exists.' };
        const colour = clean(l.colour, 40), size = clean(l.size, 20), k = key(p.id, colour, size);
        if (colour.includes('|') || size.includes('|')) return { error: `${p.name}: colours and sizes cannot contain the | character. Rename it in the product first.` };
        if (!skusOfProduct(p).some(x => x.key === k) && !st.skus[k]) return { error: `${p.name}: ${[colour, size].filter(Boolean).join(' ') || 'that option'} is not a colour/size of this product.` };
        return { p, colour, size, k };
    }
    const label = (p, colour, size) => `${p.name}${colour || size ? ' (' + [colour, size].filter(Boolean).join(' ') + ')' : ''}`;
    const MAX_PACKS = 100000;
    const posInt = (v, what) => { const n = Number(v); if (!Number.isInteger(n) || n < 0 || n > MAX_PACKS) throw new Error(what + ' must be a whole number of packs from 0 to ' + MAX_PACKS + '.'); return n; };

    // ── movements ────────────────────────────────────────────────────────────
    function move(k, pool, delta, type, ref, note, who, extra) {
        if (!delta) return;
        rec(k)[pool] += delta; if (delta > 0) rec(k).seen = true;
        const [pid, colour, size] = k.split('|'); const p = getProducts().find(x => x.id === pid);
        log.push({ id: 'sm-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6), at: Date.now(), date: today(), key: k, productId: pid, productName: p ? p.name : pid, colour, size, pool, delta, type, ref: ref || '', note: note || '', by: who || 'system', ...(extra || {}) });
    }
    function trimLog() { if (log.length > 30000) log = log.slice(-20000); }

    // ── keep the website's own numbers in step while tracking ────────────────
    function syncProduct(pid) {
        const p = getProducts().find(x => x.id === pid); if (!p) return;
        const keys = Object.keys(st.skus).filter(k => k.startsWith(pid + '|')); if (!keys.length) return;
        const online = c => keys.filter(k => c === null || k.split('|')[1] === c).reduce((a, k) => a + (st.skus[k].online || 0), 0);
        if (isRich(p)) {
            p.variants.forEach(v => { v.stock = online(colourName(v)); if (p.variantStock) p.variantStock[colourName(v)] = v.stock; });
            p.stock = p.variants.reduce((a, v) => a + (v.stock || 0), 0);
        } else p.stock = online(null);
        p.isSoldOut = p.stock === 0;
    }
    function syncMany(pids) { [...new Set(pids)].forEach(syncProduct); saveProducts(); }
    const pidOf = k => k.split('|')[0];

    // ── website hooks (called from server.js) ────────────────────────────────
    const tracked = pid => Object.keys(st.skus).some(k => k.startsWith(pid + '|'));
    // Deduct (dir -1) or restore (dir +1) website order items. Returns the items this module did NOT handle,
    // so the original per-colour logic still runs for anything that is not tracked.
    function online(items, dir, reason, ref) {
        if (!st.tracking) return items;
        const rest = [], touched = [];
        (items || []).forEach(it => {
            const p = getProducts().find(x => x.id === it.id); const qty = parseInt(it.quantity, 10);
            if (!p || !qty || qty <= 0 || !tracked(p.id)) { rest.push(it); return; }
            const colour = it.color || (coloursOf(p)[0] || ''), size = it.size || '';
            let k = key(p.id, colour, size);
            if (!size && sizesOf(p, colour).length > 1) {
                // size not given (e.g. a manual invoice): take it from the size of that colour with the most stock
                const cands = Object.keys(st.skus).filter(x => x.startsWith(p.id + '|' + colour + '|')).sort((a, b) => have(b, 'online') - have(a, 'online'));
                if (!cands.length) { rest.push(it); return; } k = cands[0];
            }
            if (dir < 0) {
                const take = Math.min(qty, have(k, 'online'));
                move(k, 'online', -take, 'online-sale', ref, reason || 'Website order', 'system', take < qty ? { short: qty - take } : null);
                if (take < qty) log.push({ id: 'sm-' + Date.now() + Math.random().toString(36).slice(2, 5), at: Date.now(), date: today(), key: k, productId: p.id, productName: p.name, colour: k.split('|')[1], size: k.split('|')[2], pool: 'online', delta: 0, type: 'online-short', ref: ref || '', note: (qty - take) + ' packs sold but the Online pool had none — count this size', by: 'system' });
            }
            else move(k, 'online', qty, 'online-restore', ref, reason || 'Order returned', 'system');
            touched.push(p.id);
        });
        if (touched.length) { syncMany(touched); save(); saveLog(); }
        return rest;
    }
    function validateOnline(it) {
        if (!st.tracking) return null;
        const p = getProducts().find(x => x.id === it.id); if (!p || !tracked(p.id)) return null;
        const colour = it.color || (coloursOf(p)[0] || ''), size = it.size || '', qty = parseInt(it.quantity, 10) || 1;
        if (!size && sizesOf(p, colour).length > 1) return null;
        const n = have(key(p.id, colour, size), 'online'), lab = label(p, colour, size);
        if (n <= 0) return `${lab} is out of stock.`;
        if (qty > n) return `Only ${n} pack${n === 1 ? '' : 's'} of ${lab} available — you ordered ${qty}.`;
        return null;
    }
    app.get('/api/stock/availability', (req, res) => {
        res.setHeader('Cache-Control', 'no-store');
        if (!st.tracking) return res.json({ tracking: false, sku: {} });
        const sku = {}; Object.keys(st.skus).forEach(k => { sku[k] = Math.min(st.skus[k].online || 0, 6); });
        res.json({ tracking: true, sku });
    });

    // ── reading ──────────────────────────────────────────────────────────────
    function overview() {
        const products = getProducts().map(p => {
            const cols = coloursOf(p).map(c => ({ name: c, sizes: sizesOf(p, c) })); const skus = {}; const t = { dome: 0, online: 0, supply: 0 };
            skusOfProduct(p).forEach(x => { const r = st.skus[x.key] || { dome: 0, online: 0, supply: 0 }; skus[x.colour + '|' + x.size] = { dome: r.dome, online: r.online, supply: r.supply }; POOLS.forEach(pl => { t[pl] += r[pl]; }); });
            // stock left on a size/colour that was later removed from the product still counts
            Object.keys(st.skus).filter(k => k.startsWith(p.id + '|')).forEach(k => { const [, c, s] = k.split('|'); if (!skus[c + '|' + s]) { const r = st.skus[k]; skus[c + '|' + s] = { dome: r.dome, online: r.online, supply: r.supply, removed: true }; POOLS.forEach(pl => { t[pl] += r[pl]; }); } });
            return { id: p.id, name: p.name, brand: p.brand || '', type: productType(p.name), packSize: p.packSize || 3, tracked: tracked(p.id), colours: cols, skus, totals: t };
        });
        const totals = { dome: 0, online: 0, supply: 0 }; products.forEach(p => POOLS.forEach(pl => { totals[pl] += p.totals[pl]; }));
        return { tracking: st.tracking, since: st.since, thresholds: { online: st.lowOnline, supply: st.lowSupply }, pools: POOL_NAME, totals, products };
    }
    app.get('/api/supply/stock', read, (req, res) => res.json(overview()));
    // a quantities-only view for the person handling WhatsApp orders (staff): no shops, no money, no cheques
    app.get('/api/supply/stock-summary', [requireAdminJWT, allowStaffRead], (req, res) => {
        const o = overview();
        res.json({ tracking: o.tracking, totals: o.totals, canManage: ['owner', 'manager'].includes(req.adminRole),
            products: o.products.map(p => ({ id: p.id, name: p.name, brand: p.brand, type: p.type, tracked: p.tracked, colours: p.colours, skus: p.skus, totals: p.totals })) });
    });
    app.get('/api/supply/stock/movements', read, (req, res) => {
        const lim = Math.min(parseInt(req.query.limit, 10) || 100, 500);
        res.json(log.filter(m => (!req.query.productId || m.productId === req.query.productId) && (!req.query.pool || m.pool === req.query.pool)).slice(-lim).reverse());
    });
    app.get('/api/supply/stock/intakes', read, (req, res) => res.json(intakes.slice(-50).reverse()));

    // ── settings ─────────────────────────────────────────────────────────────
    app.put('/api/supply/stock/tracking', write, (req, res) => {
        const b = req.body || {};
        // stock leaves the Supply pool when a round is loaded, so switching tracking mid-round would create or lose packs
        if ((b.on === true && !st.tracking) || (b.on === false && st.tracking)) {
            if (ctx.supplyApi && ctx.supplyApi.openRound()) return fail(res, 409, 'You have a supply round open. Close it first, then change stock tracking.');
        }
        if (b.on === true) {
            if (st.tracking) return res.json({ success: true });
            const online = Object.values(st.skus).reduce((a, r) => a + (r.online || 0), 0);
            if (!online && b.force !== true) return fail(res, 409, 'Your Online pool is empty. Count your online stock by size first — otherwise every product would show as sold out.');
            if (b.confirm !== true) return fail(res, 400, 'Please confirm.');
            st.tracking = true; st.since = Date.now(); syncMany(Object.keys(st.skus).map(pidOf)); save();
        } else if (b.on === false) { st.tracking = false; save(); }
        if (b.lowOnline !== undefined) { const n = parseInt(b.lowOnline, 10); if (!isNaN(n) && n >= 0 && n <= 100) st.lowOnline = n; }
        if (b.lowSupply !== undefined) { const n = parseInt(b.lowSupply, 10); if (!isNaN(n) && n >= 0 && n <= 100) st.lowSupply = n; }
        save(); res.json({ success: true, tracking: st.tracking });
    });

    // ── intake (delivery to Dome), transfer, count ───────────────────────────
    app.post('/api/supply/stock/intake', write, (req, res) => {
        try {
            const b = req.body || {}, date = b.date || today();
            if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return fail(res, 400, 'The date is not valid.');
            const lines = [], merged = new Map();
            for (const l of (Array.isArray(b.lines) ? b.lines : []).slice(0, 800)) {
                const c = checkSku(l); if (c.error) return fail(res, 400, c.error);
                const received = posInt(l.received, 'Received'), damaged = posInt(l.damaged || 0, 'Damaged'), expected = l.expected === undefined || l.expected === '' || l.expected === null ? received : posInt(l.expected, 'Expected');
                if (!received && !damaged && !expected) continue;
                if (damaged > received) return fail(res, 400, `${label(c.p, c.colour, c.size)}: damaged (${damaged}) cannot be more than received (${received}).`);
                const m = merged.get(c.k) || { productId: c.p.id, productName: c.p.name, colour: c.colour, size: c.size, expected: 0, received: 0, damaged: 0 };
                m.expected += expected; m.received += received; m.damaged += damaged; merged.set(c.k, m);
            }
            merged.forEach(m => lines.push({ ...m, added: m.received - m.damaged }));
            if (!lines.length || !lines.some(l => l.received > 0)) return fail(res, 400, 'Enter how many packs you received.');
            const intake = { id: 'INT-' + Date.now(), date, supplier: clean(b.supplier, 80), note: clean(b.note, 300), lines, createdAt: Date.now(), createdBy: by(req),
                totals: { expected: lines.reduce((a, l) => a + l.expected, 0), received: lines.reduce((a, l) => a + l.received, 0), damaged: lines.reduce((a, l) => a + l.damaged, 0), added: lines.reduce((a, l) => a + l.added, 0) } };
            lines.forEach(l => { move(key(l.productId, l.colour, l.size), 'dome', l.added, 'intake', intake.id, intake.note, by(req)); if (l.damaged) log.push({ id: 'sm-' + Date.now() + Math.random().toString(36).slice(2, 5), at: Date.now(), date, key: key(l.productId, l.colour, l.size), productId: l.productId, productName: l.productName, colour: l.colour, size: l.size, pool: 'dome', delta: 0, type: 'damaged', ref: intake.id, note: l.damaged + ' packs damaged', by: by(req) }); });
            intakes.push(intake); trimLog(); save(); saveLog(); saveIntakes();
            res.json({ success: true, intake });
        } catch (e) { fail(res, 400, e.message); }
    });
    function cleanMoves(lines) {
        const merged = new Map();
        for (const l of (Array.isArray(lines) ? lines : []).slice(0, 800)) {
            const c = checkSku(l); if (c.error) return { error: c.error };
            let packs; try { packs = posInt(l.packs, 'Packs'); } catch (e) { return { error: e.message }; }
            if (!packs) continue; const m = merged.get(c.k) || { ...c, packs: 0 }; m.packs += packs; merged.set(c.k, m);
        }
        return { list: [...merged.values()] };
    }
    app.post('/api/supply/stock/transfer', write, (req, res) => {
        const b = req.body || {}; const from = b.from, to = b.to;
        if (!POOLS.includes(from) || !POOLS.includes(to) || from === to) return fail(res, 400, 'Choose two different pools.');
        const c = cleanMoves(b.lines); if (c.error) return fail(res, 400, c.error);
        if (!c.list.length) return fail(res, 400, 'Enter the packs to move.');
        for (const m of c.list) { const h = have(m.k, from); if (m.packs > h) return fail(res, 400, `${label(m.p, m.colour, m.size)}: ${POOL_NAME[from]} only has ${h} pack${h === 1 ? '' : 's'}.`); }
        const ref = 'TR-' + Date.now(); const note = clean(b.note, 200);
        c.list.forEach(m => { move(m.k, from, -m.packs, 'transfer-out', ref, `to ${to}${note ? ': ' + note : ''}`, by(req)); move(m.k, to, m.packs, 'transfer-in', ref, `from ${from}${note ? ': ' + note : ''}`, by(req)); });
        if (from === 'online' || to === 'online') syncMany(c.list.map(m => m.p.id));
        trimLog(); save(); saveLog();
        res.json({ success: true, moved: c.list.reduce((a, m) => a + m.packs, 0) });
    });
    app.post('/api/supply/stock/count', write, (req, res) => {
        const b = req.body || {}; if (!POOLS.includes(b.pool)) return fail(res, 400, 'Choose which pool you counted.');
        const diffs = [];
        for (const l of (Array.isArray(b.lines) ? b.lines : []).slice(0, 800)) {
            if (l.counted === '' || l.counted === null || l.counted === undefined) continue;
            const c = checkSku(l); if (c.error) return fail(res, 400, c.error);
            let n; try { n = posInt(l.counted, 'Counted'); } catch (e) { return fail(res, 400, e.message); }
            const cur = have(c.k, b.pool); diffs.push({ k: c.k, productId: c.p.id, productName: c.p.name, colour: c.colour, size: c.size, system: cur, counted: n, diff: n - cur });
        }
        if (!diffs.length) return fail(res, 400, 'Enter at least one counted number.');
        if (b.apply !== true) return res.json({ success: true, applied: false, diffs });
        const ref = 'CNT-' + Date.now(), note = clean(b.note, 200);
        diffs.forEach(d => { if (d.diff) move(d.k, b.pool, d.diff, 'count', ref, note || 'Stock count', by(req)); else rec(d.k); });
        if (b.pool === 'online') syncMany(diffs.map(d => d.productId));
        trimLog(); save(); saveLog();
        res.json({ success: true, applied: true, diffs });
    });

    // ── sizes: add or change a size for many products at once (flows to website, stock, rounds) ──
    app.put('/api/supply/stock/sizes', write, (req, res) => {
        const b = req.body || {}, products = getProducts(); const ids = Array.isArray(b.productIds) ? b.productIds : [];
        const list = products.filter(p => ids.includes(p.id)); if (!list.length) return fail(res, 400, 'Choose at least one product.');
        const norm = a => [...new Set((Array.isArray(a) ? a : String(a || '').split(',')).map(s => clean(s, 20)).filter(Boolean))];
        const mode = ['set', 'add', 'remove'].includes(b.mode) ? b.mode : 'set';
        const apply = arr => { const cur = norm(arr); if (mode === 'set') return norm(b.sizes); if (mode === 'add') { const add = norm(b.sizes).filter(s => !cur.includes(s)); if (b.after && cur.includes(b.after)) { const i = cur.indexOf(b.after) + 1; return [...cur.slice(0, i), ...add, ...cur.slice(i)]; } return [...cur, ...add]; } const rm = norm(b.sizes); return cur.filter(s => !rm.includes(s)); };
        if (mode === 'set' && !norm(b.sizes).length) return fail(res, 400, 'Enter at least one size.');
        list.forEach(p => {
            const before = (p.sizes || []).join(', ');
            p.sizes = apply(p.sizes); p.updatedAt = Date.now();
            if (isRich(p)) p.variants.forEach(v => { if (Array.isArray(v.sizes) && v.sizes.length) v.sizes = apply(v.sizes); });
            (p.history = p.history || []).push({ timestamp: Date.now(), changes: [{ field: 'sizes', label: 'Sizes', from: before, to: p.sizes.join(', ') }], editedBy: by(req) });
        });
        saveProducts();
        res.json({ success: true, changed: list.length });
    });

    // ── size guides: editable charts shown on the website (public read, owner/manager write) ──
    const GUIDES_FILE = path.join(dataDir, 'size-guides.json');
    const DEFAULT_GUIDES = {
        undershirts: { name: 'Undershirts & vests', title: 'Undershirts & Vests — Chest (cm)', columns: ['Size', 'Chest (cm)'], note: '', rows: [['XS', '76 – 83'], ['S', '84 – 91'], ['M', '92 – 99'], ['L', '100 – 107'], ['XL', '108 – 115'], ['XXL', '116 – 124'], ['XXXL', '125 – 132']] },
        boxers: { name: 'Boxers & briefs', title: 'Underwear & Boxers — Waist (cm)', columns: ['Size', 'Waist (cm)'], note: 'Measure around your natural waistline. Between sizes? Size up for comfort.', rows: [['XS', '61 – 66'], ['S', '71 – 76'], ['M', '81 – 86'], ['L', '91 – 96'], ['XL', '101 – 106'], ['XXL', '111 – 116'], ['XXXL', '121 – 126']] },
        panties: { name: "Ladies' panties", title: "Ladies' Panties — Hip (cm)", columns: ['Size', 'Hip (cm)'], note: 'Measure around the fullest part of your hips. Between sizes? Size up for comfort.', rows: [['XS', '80 – 85'], ['S', '86 – 91'], ['M', '92 – 97'], ['L', '98 – 103'], ['XL', '104 – 109'], ['XXL', '110 – 115'], ['XXXL', '116 – 121']] },
        socks: { name: 'Socks', title: 'Unisex Socks — Shoe Size', columns: ['Size', 'UK Shoe Size', 'EU Shoe Size'], note: "Most of our socks are one-size-fits-most and stretch to accommodate a range of shoe sizes.", rows: [['One Size', '6 – 11', '39 – 46']] }
    };
    let guides = { ...DEFAULT_GUIDES, ...loadJSON(GUIDES_FILE, {}) };
    app.get('/api/size-guides', (req, res) => { res.setHeader('Cache-Control', 'no-cache'); res.json(guides); });
    app.put('/api/supply/stock/size-guides/:id', write, (req, res) => {
        const id = req.params.id; if (!DEFAULT_GUIDES[id]) return fail(res, 404, 'Unknown size guide.');
        const b = req.body || {};
        const columns = (Array.isArray(b.columns) ? b.columns : []).map(c => clean(c, 30)).filter(Boolean).slice(0, 4);
        if (columns.length < 2) return fail(res, 400, 'A chart needs at least two columns (for example Size and Chest).');
        const rows = (Array.isArray(b.rows) ? b.rows : []).slice(0, 40).map(r => columns.map((_, i) => clean(Array.isArray(r) ? r[i] : '', 30))).filter(r => r[0]);
        if (!rows.length) return fail(res, 400, 'Add at least one row.');
        guides = { ...guides, [id]: { name: DEFAULT_GUIDES[id].name, title: clean(b.title, 80) || DEFAULT_GUIDES[id].title, columns, rows, note: clean(b.note, 300) } };
        saveJSON(GUIDES_FILE, guides); res.json({ success: true, guide: guides[id] });
    });

    // ── low-stock alerts (per product, per pool) ─────────────────────────────
    function alerts() {
        const out = [];
        getProducts().forEach(p => {
            const lows = { online: [], supply: [] };
            skusOfProduct(p).forEach(x => {
                const r = st.skus[x.key]; if (!r) return; const everStocked = r.seen || (r.dome + r.online + r.supply) > 0;
                if (!everStocked) return;
                if (r.online <= st.lowOnline) lows.online.push({ label: [x.colour, x.size].filter(Boolean).join(' ') || 'all', have: r.online, dome: r.dome, supply: r.supply, key: x.key });
                if (r.supply <= st.lowSupply) lows.supply.push({ label: [x.colour, x.size].filter(Boolean).join(' ') || 'all', have: r.supply, dome: r.dome, online: r.online, key: x.key });
            });
            ['online', 'supply'].forEach(pool => { if (lows[pool].length) out.push({ pool, productId: p.id, productName: p.name, items: lows[pool], canRestock: lows[pool].some(i => i.dome > 0) }); });
        });
        return out;
    }
    app.get('/api/supply/stock/alerts', read, (req, res) => res.json(alerts()));

    // ── round planner ────────────────────────────────────────────────────────
    app.get('/api/supply/plan', read, (req, res) => {
        if (!ctx.supplyApi) return fail(res, 500, 'Supply is not ready.');
        const all = ctx.supplyApi.planInputs(); const ids = req.query.shops ? String(req.query.shops).split(',') : null;
        const chosen = ids ? all.filter(s => ids.includes(s.shopId)) : all.filter(s => s.reason);
        const need = new Map();
        chosen.forEach(s => (s.usual || []).forEach(l => { const k = key(l.productId, l.colour, l.size); need.set(k, (need.get(k) || 0) + l.packs); }));
        const rows = [...need.entries()].map(([k, n]) => { const [pid, colour, size] = k.split('|'); const p = getProducts().find(x => x.id === pid); return { key: k, productId: pid, productName: p ? p.name : pid, colour, size, need: n, supply: have(k, 'supply'), dome: have(k, 'dome') }; })
            .map(r => { const short = Math.max(0, r.need - r.supply); return { ...r, short, fromDome: Math.min(short, r.dome), stillShort: Math.max(0, short - r.dome) }; })
            .sort((a, b) => b.short - a.short || a.productName.localeCompare(b.productName));
        res.json({ tracking: st.tracking, shops: all, chosen: chosen.map(s => s.shopId), rows, totalNeed: rows.reduce((a, r) => a + r.need, 0), totalShort: rows.reduce((a, r) => a + r.short, 0) });
    });

    // ── hooks used by the supply module ──────────────────────────────────────
    const hooks = {
        onRoundLoad(lines, round) {
            if (!st.tracking) return null;
            const merged = new Map(); lines.forEach(l => { const k = key(l.productId, l.colour, l.size); merged.set(k, (merged.get(k) || 0) + l.packs); });
            for (const [k, n] of merged) { if (n > have(k, 'supply')) { const [pid, colour, size] = k.split('|'); const p = getProducts().find(x => x.id === pid); const h = have(k, 'supply'); return `${label(p || { name: pid }, colour, size)}: the Supply pool only has ${h} pack${h === 1 ? '' : 's'}, but you are loading ${n}. Move more from Dome first.`; } }
            merged.forEach((n, k) => move(k, 'supply', -n, 'round-load', round.id, 'Loaded on a round', 'system'));
            trimLog(); save(); saveLog(); return null;
        },
        onRoundClose(returned, round) {
            if (!st.tracking) return;
            (returned || []).forEach(l => move(key(l.productId, l.colour, l.size), 'supply', l.packs, 'round-return', round.id, 'Returned from a round', 'system'));
            (round.missing || []).forEach(l => log.push({ id: 'sm-' + Date.now() + Math.random().toString(36).slice(2, 5), at: Date.now(), date: today(), key: key(l.productId, l.colour, l.size), productId: l.productId, productName: l.productName, colour: l.colour, size: l.size, pool: 'supply', delta: 0, type: 'round-missing', ref: round.id, note: l.packs + ' packs not supplied and not returned', by: 'system' }));
            trimLog(); save(); saveLog();
        },
        onSupply(rec) {
            if (!st.tracking || rec.roundId) return;
            (rec.lines || []).forEach(l => { if (l.productId) { const k = key(l.productId, l.colour, l.size); move(k, 'supply', -Math.min(l.packs, have(k, 'supply')), 'supply', rec.id, 'Supplied to ' + rec.shopName, 'system'); } });
            (rec.takenBack || []).forEach(l => move(key(l.productId, l.colour, l.size), 'supply', l.packs, 'take-back', rec.id, 'Taken back from ' + rec.shopName, 'system'));
            save(); saveLog();
        },
        todoExtra(items) {
            if (!st.tracking) return;
            alerts().forEach(a => items.push({ type: 'low_stock', pool: a.pool, productId: a.productId, days: 0,
                text: `${a.pool === 'online' ? 'Online' : 'Supply'} is low on ${a.productName}: ${a.items.slice(0, 5).map(i => i.label + ' ' + i.have).join(', ')}${a.items.length > 5 ? '…' : ''}${a.canRestock ? ' — Dome has stock to move' : ''}` }));
        }
    };
    // used by the admin's own stock screens: while tracking, a tracked product's numbers come from the pools only
    const lockedProduct = pid => st.tracking && tracked(pid);
    return { hooks, online, validateOnline, attach(api) { ctx.supplyApi = api; }, isTracking: () => st.tracking, isLocked: lockedProduct, syncProduct: pid => { if (lockedProduct(pid)) syncProduct(pid); } };
};
