// Supply module: shops (incl. the built-in Online and Samples accounts), the supply price list, rounds,
// supply records (the system's invoice; the hard-copy pad invoice is written to match it and carries the
// same manual invoice number), swaps/credits, payments, cheques (private photos), the GRA tax invoice
// figures, calls/requests, the To do list, reports, practice mode and backup.
// Owner/manager can change things; a "viewer" (the boss) can read only.
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const sharp = require('sharp');
const productType = require('./product-type');

module.exports = function registerSupply({ app, requireAdminJWT, requireManagerOrOwner, loadJSON, saveJSON, dataDir, getProducts, getOrders, hooks }) {
    hooks = hooks || {};
    getOrders = getOrders || (() => []);
    const F = n => path.join(dataDir, n);
    const SHOPS_FILE = F('shops.json'), SUPPLIES_FILE = F('supplies.json'), PRICES_FILE = F('supply-prices.json'),
          ROUNDS_FILE = F('supply-rounds.json'), VISITS_FILE = F('supply-visits.json'), SETTINGS_FILE = F('supply-settings.json'),
          PAYMENTS_FILE = F('supply-payments.json'), CHEQUES_FILE = F('supply-cheques.json'), CALLS_FILE = F('supply-calls.json'),
          CREDITS_FILE = F('supply-credits.json');
    const PHOTO_DIR = path.join(dataDir, 'private', 'cheques');
    fs.mkdirSync(PHOTO_DIR, { recursive: true });

    let shops = loadJSON(SHOPS_FILE, []), supplies = loadJSON(SUPPLIES_FILE, []), prices = loadJSON(PRICES_FILE, {}),
        rounds = loadJSON(ROUNDS_FILE, []), visits = loadJSON(VISITS_FILE, []), payments = loadJSON(PAYMENTS_FILE, []),
        cheques = loadJSON(CHEQUES_FILE, []), calls = loadJSON(CALLS_FILE, []), credits = loadJSON(CREDITS_FILE, []);
    // Prices are VAT-INCLUSIVE (e.g. 250.20 per 3-pack = 208.50 + 20%); a product may override the standard price.
    const SETTINGS_DEFAULTS = {
        standardPrice: null, vatRate: 20, reorderDays: 30, practice: false, lastBackupAt: null,
        companyName: 'ARILEO LIMITED', companyAddress: 'P.O. Box YK 1366, Kanda, Accra, Ghana',
        companyTel: '+233 (0)302424189', companyMobile: '+233 (0)200187230', tin: ''
    };
    let sset = { ...SETTINGS_DEFAULTS, ...loadJSON(SETTINGS_FILE, {}) };

    // built-in accounts
    const BUILTIN = [
        { id: 'shop-online',  name: 'Online',  type: 'online',  builtIn: true, termsDays: 0,  active: true },
        { id: 'shop-samples', name: 'Samples', type: 'samples', builtIn: true, termsDays: 30, active: true }
    ];
    let addedBuiltin = false;
    BUILTIN.forEach(b => { if (!shops.some(x => x.id === b.id)) { shops.push({ contact: '', phone: '', address: '', notes: '', tin: '', createdAt: Date.now(), createdBy: 'system', ...b }); addedBuiltin = true; } });
    if (addedBuiltin) saveJSON(SHOPS_FILE, shops);

    function allowViewer(req, res, next) {
        if (['owner', 'manager', 'viewer'].includes(req.adminRole)) return next();
        res.status(403).json({ success: false, message: 'Owner, manager or viewer access required.' });
    }
    const read  = [requireAdminJWT, allowViewer];
    const write = [requireAdminJWT, requireManagerOrOwner];

    // ── helpers ──────────────────────────────────────────────────────────────
    const round2 = n => Math.round((Number(n) || 0) * 100) / 100;
    const sum = (a, f) => round2(a.reduce((t, x) => t + f(x), 0));
    const normName = s => String(s || '').trim().replace(/\s+/g, ' ').toLowerCase();
    const cleanText = (s, max) => String(s == null ? '' : s).trim().replace(/\s+/g, ' ').slice(0, max);
    const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
    function validDate(s) { if (!DATE_RE.test(s || '')) return false; const d = new Date(s + 'T00:00:00Z'); return !isNaN(d) && d.toISOString().slice(0, 10) === s; }
    function addDays(dateStr, n) { const d = new Date(dateStr + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
    function daysBetween(a, b) { return Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 86400000); }
    const today = () => new Date().toISOString().slice(0, 10);
    const fail = (res, code, message) => res.status(code).json({ success: false, message });
    const uid = p => p + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
    const by = req => req.adminUsername || 'admin';
    const skuKey = l => [l.productId, l.colour || '', l.size || ''].join('|');
    const save = {
        shops: () => saveJSON(SHOPS_FILE, shops), supplies: () => saveJSON(SUPPLIES_FILE, supplies), prices: () => saveJSON(PRICES_FILE, prices),
        rounds: () => saveJSON(ROUNDS_FILE, rounds), visits: () => saveJSON(VISITS_FILE, visits), settings: () => saveJSON(SETTINGS_FILE, sset),
        payments: () => saveJSON(PAYMENTS_FILE, payments), cheques: () => saveJSON(CHEQUES_FILE, cheques), calls: () => saveJSON(CALLS_FILE, calls),
        credits: () => saveJSON(CREDITS_FILE, credits)
    };
    // Practice mode: records made while it is on are tagged and only visible while it is on.
    const live = x => !!x.practice === !!sset.practice;
    const tag = o => { if (sset.practice) o.practice = true; return o; };
    const vShops = () => shops.filter(s => s.builtIn || live(s));
    const vSupplies = () => supplies.filter(live);
    const vRounds = () => rounds.filter(live);
    const vPayments = () => payments.filter(live);
    const vCheques = () => cheques.filter(live);
    const vCalls = () => calls.filter(live);
    const shopOf = id => shops.find(s => s.id === id);
    const supplyOf = id => supplies.find(s => s.id === id);
    const isSupply = s => !s.kind || s.kind === 'supply';

    // ── money on a supply ─────────────────────────────────────────────────────
    function chequeAllocs(supplyId) {
        const out = [];
        vCheques().forEach(c => { if (c.voided) return; (c.allocations || []).forEach(a => { if (a.supplyId === supplyId) out.push({ cheque: c, amount: a.amount }); }); });
        return out;
    }
    function money(s) {
        const paidDirect = sum(vPayments().filter(p => p.supplyId === s.id && !p.voided), p => p.amount);
        const ca = chequeAllocs(s.id);
        const paidCheque = sum(ca.filter(x => x.cheque.status === 'cleared'), x => x.amount);
        const pending = sum(ca.filter(x => x.cheque.status === 'received' || x.cheque.status === 'deposited'), x => x.amount);
        const paid = round2(paidDirect + paidCheque);
        const balance = s.voided ? 0 : Math.max(0, round2(s.amount - paid));
        const t = today();
        let status = 'unpaid';
        if (s.voided) status = 'void'; else if (!isSupply(s)) status = 'n/a';
        else if (balance <= 0.005) status = 'paid';
        else if (t > s.dueDate) status = 'overdue'; else if (paid > 0 || pending > 0) status = 'partial'; else status = 'unpaid';
        const daysOverdue = (!s.voided && balance > 0.005 && t > s.dueDate) ? daysBetween(s.dueDate, t) : 0;
        return { paid, chequePending: pending, balance, status, daysOverdue, daysToDue: s.voided ? null : daysBetween(t, s.dueDate), available: Math.max(0, round2(balance - pending)) };
    }
    function dressSupply(s) { const shop = shopOf(s.shopId); return { ...s, shopName: shop ? shop.name : s.shopName, ...money(s) }; }
    function shopMoney(shopId) {
        const st = vSupplies().filter(s => s.shopId === shopId && !s.voided && isSupply(s));
        const list = st.map(money);
        return { balance: sum(list, m => m.balance), overdue: sum(list.filter(m => m.status === 'overdue'), m => m.balance),
            oldestOverdueDays: list.reduce((m, x) => Math.max(m, x.daysOverdue), 0), chequePending: sum(list, m => m.chequePending),
            credit: sum(credits.filter(c => c.shopId === shopId && live(c)), c => c.remaining), invoiceCount: st.length };
    }
    function shopStats(shopId) {
        const mine = vSupplies().filter(s => s.shopId === shopId && !s.voided);
        const real = mine.filter(isSupply);
        return { supplyCount: real.length, totalSupplied: sum(real, s => s.amount), lastSupplyDate: mine.reduce((m, s) => (s.date > m ? s.date : m), ''), ...shopMoney(shopId) };
    }

    // ── SHOPS ─────────────────────────────────────────────────────────────────
    function cleanShop(body, selfId) {
        const name = cleanText(body.name, 80);
        if (name.length < 2) return { error: 'Shop name is required (at least 2 letters).' };
        const clash = shops.find(s => s.id !== selfId && normName(s.name) === normName(name) && (s.builtIn || live(s)));
        if (clash) return { error: `A shop called "${clash.name}" already exists.` };
        const terms = body.termsDays === undefined || body.termsDays === '' ? 30 : parseInt(body.termsDays, 10);
        if (isNaN(terms) || terms < 0 || terms > 365) return { error: 'Payment terms must be between 0 and 365 days.' };
        let limit = null;
        if (body.creditLimit !== undefined && body.creditLimit !== null && body.creditLimit !== '') { limit = round2(body.creditLimit); if (isNaN(Number(body.creditLimit)) || limit < 0 || limit > 1e9) return { error: 'The credit limit must be 0 or more.' }; }
        let reorder = null;
        if (body.reorderDays !== undefined && body.reorderDays !== null && body.reorderDays !== '') { reorder = parseInt(body.reorderDays, 10); if (isNaN(reorder) || reorder < 1 || reorder > 365) return { error: 'Re-visit days must be between 1 and 365.' }; }
        return { value: { name, contact: cleanText(body.contact, 80), phone: cleanText(body.phone, 30), address: cleanText(body.address, 160), tin: cleanText(body.tin, 30),
            notes: cleanText(body.notes, 500), termsDays: terms, creditLimit: limit, reorderDays: reorder, active: body.active === undefined ? true : body.active === true || body.active === 'true' } };
    }
    app.get('/api/supply/shops', read, (req, res) => res.json(vShops().map(s => ({ ...s, ...shopStats(s.id) })).sort((a, b) => (b.builtIn ? 1 : 0) - (a.builtIn ? 1 : 0) || a.name.localeCompare(b.name))));
    app.post('/api/supply/shops', write, (req, res) => {
        const c = cleanShop(req.body || {}, null); if (c.error) return fail(res, 400, c.error);
        const shop = tag({ id: uid('shop'), ...c.value, createdAt: Date.now(), createdBy: by(req) });
        shops.push(shop); save.shops();
        res.json({ success: true, shop: { ...shop, ...shopStats(shop.id) } });
    });
    app.put('/api/supply/shops/:id', write, (req, res) => {
        const shop = shopOf(req.params.id); if (!shop) return fail(res, 404, 'Shop not found.');
        if (shop.builtIn && normName((req.body || {}).name) !== normName(shop.name)) return fail(res, 400, 'The ' + shop.name + ' account cannot be renamed.');
        const c = cleanShop(req.body || {}, shop.id); if (c.error) return fail(res, 400, c.error);
        Object.assign(shop, c.value, { updatedAt: Date.now() });
        supplies.forEach(s => { if (s.shopId === shop.id) s.shopName = shop.name; });
        save.shops(); save.supplies();
        res.json({ success: true, shop: { ...shop, ...shopStats(shop.id) } });
    });
    app.delete('/api/supply/shops/:id', write, (req, res) => {
        const shop = shopOf(req.params.id); if (!shop) return fail(res, 404, 'Shop not found.');
        if (shop.builtIn) return fail(res, 409, 'The ' + shop.name + ' account is built in and cannot be deleted.');
        if (supplies.some(s => s.shopId === shop.id)) return fail(res, 409, 'This shop has supply records. Mark it inactive instead of deleting it.');
        shops = shops.filter(s => s.id !== shop.id); save.shops();
        res.json({ success: true });
    });
    app.get('/api/supply/shops/:id', read, (req, res) => {
        const shop = shopOf(req.params.id); if (!shop) return fail(res, 404, 'Shop not found.');
        res.json({ shop: { ...shop, ...shopStats(shop.id) },
            supplies: vSupplies().filter(s => s.shopId === shop.id).sort((a, b) => b.date.localeCompare(a.date)).map(dressSupply),
            payments: vPayments().filter(p => p.shopId === shop.id).sort((a, b) => b.date.localeCompare(a.date)),
            cheques: vCheques().filter(c => c.shopId === shop.id).sort((a, b) => b.receivedDate.localeCompare(a.receivedDate)).map(dressCheque),
            calls: vCalls().filter(c => c.shopId === shop.id).sort((a, b) => b.date.localeCompare(a.date)) });
    });

    // ── PRICES + SETTINGS ─────────────────────────────────────────────────────
    const effectivePrice = pid => (prices[pid] && prices[pid].price != null) ? prices[pid].price : sset.standardPrice;
    app.get('/api/supply/prices', read, (req, res) => res.json({ standardPrice: sset.standardPrice, vatRate: sset.vatRate,
        products: getProducts().map(p => ({ id: p.id, name: p.name, brand: p.brand || '', category: p.category || '', retailPrice: parseFloat(p.price) || 0,
            overridePrice: prices[p.id] && prices[p.id].price != null ? prices[p.id].price : null, desc: (prices[p.id] && prices[p.id].desc) || '', effectivePrice: effectivePrice(p.id) })) }));
    app.put('/api/supply/prices', write, (req, res) => {
        const body = req.body || {};
        if (body.standardPrice !== undefined) {
            if (body.standardPrice === null || body.standardPrice === '') sset.standardPrice = null;
            else { const v = round2(body.standardPrice); if (isNaN(Number(body.standardPrice)) || !(v >= 0) || v > 1000000) return fail(res, 400, 'The standard price must be a number of 0 or more.'); sset.standardPrice = v; }
        }
        const known = new Set(getProducts().map(p => p.id)); const next = { ...prices };
        for (const [pid, raw] of Object.entries(body.prices || {})) {
            if (!known.has(pid)) continue; const cur = next[pid] || {};
            if (raw === null || raw === '') cur.price = null;
            else { const v = round2(raw); if (isNaN(Number(raw)) || !(v >= 0) || v > 1000000) return fail(res, 400, 'Prices must be numbers of 0 or more.'); cur.price = v; }
            next[pid] = { ...cur, updatedAt: Date.now(), by: by(req) };
        }
        for (const [pid, d] of Object.entries(body.descs || {})) { if (!known.has(pid)) continue; next[pid] = { ...(next[pid] || { price: null }), desc: cleanText(d, 80) }; }
        for (const pid of Object.keys(next)) if (next[pid].price == null && !next[pid].desc) delete next[pid];
        prices = next; save.prices(); save.settings();
        res.json({ success: true });
    });
    app.get('/api/supply/settings', read, (req, res) => res.json(sset));
    app.put('/api/supply/settings', write, (req, res) => {
        const b = req.body || {};
        ['companyName', 'companyAddress', 'companyTel', 'companyMobile', 'tin'].forEach(k => { if (b[k] !== undefined) sset[k] = cleanText(b[k], 120); });
        if (b.reorderDays !== undefined) { const n = parseInt(b.reorderDays, 10); if (!isNaN(n) && n >= 1 && n <= 365) sset.reorderDays = n; }
        if (b.practice !== undefined) sset.practice = b.practice === true || b.practice === 'true';
        save.settings();
        res.json({ success: true, settings: sset });
    });

    // ── VAT (20% = VAT 15% + NHIL 2.5% + GETFund 2.5%, all on the tax-exclusive value) ──
    function vatParts(subtotal, vatAmount) {
        const parts = [['VAT', 15], ['NHIL', 2.5], ['GETFund Levy', 2.5]].map(p => ({ label: p[0], rate: p[1], amount: round2(subtotal * p[1] / 100) }));
        const drift = round2(vatAmount - parts.reduce((a, p) => a + p.amount, 0)); parts[2].amount = round2(parts[2].amount + drift);
        return parts;
    }

    // ── ROUNDS ────────────────────────────────────────────────────────────────
    function cleanRoundLines(raw) {
        if (!Array.isArray(raw) || !raw.length) return { error: 'Add at least one item to the round.' };
        if (raw.length > 600) return { error: 'Too many lines.' };
        const pm = new Map(getProducts().map(p => [p.id, p])); const merged = new Map();
        for (const l of raw) {
            const packs = Number(l.packs);
            if (!Number.isInteger(packs) || packs <= 0 || packs > 100000) return { error: 'Packs must be whole numbers from 1 to 100000.' };
            const p = pm.get(l.productId); if (!p) return { error: 'A product in the round no longer exists.' };
            const line = { productId: p.id, productName: p.name, brand: p.brand || '', colour: cleanText(l.colour, 40), size: cleanText(l.size, 20), packs };
            if (line.colour.includes('|') || line.size.includes('|')) return { error: 'Colours and sizes cannot contain the | character.' };
            const k = skuKey(line); if (merged.has(k)) merged.get(k).packs += packs; else merged.set(k, line);
        }
        return { value: [...merged.values()] };
    }
    function roundUsage(roundId, excludeSupplyId) {
        const given = new Map(), back = new Map();
        vSupplies().forEach(sp => {
            if (sp.voided || sp.roundId !== roundId || sp.id === excludeSupplyId) return;
            (sp.lines || []).forEach(l => { if (l.productId) given.set(skuKey(l), (given.get(skuKey(l)) || 0) + l.packs); });
            (sp.takenBack || []).forEach(l => { const k = skuKey(l); const cur = back.get(k) || { ...l, packs: 0 }; cur.packs += l.packs; back.set(k, cur); });
        });
        return { given, back };
    }
    function roundWithRemaining(r, excludeSupplyId) {
        const { given, back } = roundUsage(r.id, excludeSupplyId);
        const seen = new Set();
        const lines = r.lines.map(l => { const k = skuKey(l); seen.add(k); const supplied = given.get(k) || 0, tb = back.get(k) ? back.get(k).packs : 0;
            return { ...l, loaded: l.packs, supplied, takenBack: tb, remaining: l.packs - supplied + tb }; });
        back.forEach((l, k) => { if (!seen.has(k)) lines.push({ productId: l.productId, productName: l.productName, brand: l.brand || '', colour: l.colour, size: l.size, packs: 0, loaded: 0, supplied: given.get(k) || 0, takenBack: l.packs, remaining: l.packs - (given.get(k) || 0) }); });
        return { ...r, lines, loadedTotal: lines.reduce((a, l) => a + l.loaded, 0), suppliedTotal: lines.reduce((a, l) => a + l.supplied, 0),
            takenBackTotal: lines.reduce((a, l) => a + l.takenBack, 0), remainingTotal: lines.reduce((a, l) => a + l.remaining, 0) };
    }
    const openRound = () => vRounds().find(r => r.status === 'open') || null;
    app.get('/api/supply/rounds/current', read, (req, res) => { const r = openRound(); res.json(r ? roundWithRemaining(r) : null); });
    app.get('/api/supply/rounds', read, (req, res) => res.json(vRounds().map(r => roundWithRemaining(r)).sort((a, b) => b.createdAt - a.createdAt)));
    app.post('/api/supply/rounds', write, (req, res) => {
        if (openRound()) return fail(res, 409, 'You already have an open round. Add to it, or close it first.');
        const c = cleanRoundLines(req.body && req.body.lines); if (c.error) return fail(res, 400, c.error);
        const date = (req.body && req.body.date) || today(); if (!validDate(date)) return fail(res, 400, 'The round date is not valid.');
        const r = tag({ id: uid('rnd'), date, status: 'open', lines: c.value, note: cleanText(req.body && req.body.note, 200), createdAt: Date.now(), createdBy: by(req) });
        if (hooks.onRoundLoad && !sset.practice) { const err = hooks.onRoundLoad(c.value, r); if (err) return fail(res, 400, err); }
        rounds.push(r); save.rounds();
        res.json({ success: true, round: roundWithRemaining(r) });
    });
    app.post('/api/supply/rounds/:id/add', write, (req, res) => {
        const r = rounds.find(x => x.id === req.params.id); if (!r) return fail(res, 404, 'Round not found.');
        if (r.status !== 'open') return fail(res, 409, 'This round is closed.');
        const c = cleanRoundLines(req.body && req.body.lines); if (c.error) return fail(res, 400, c.error);
        if (hooks.onRoundLoad && !r.practice) { const err = hooks.onRoundLoad(c.value, r); if (err) return fail(res, 400, err); }
        const merged = new Map(r.lines.map(l => [skuKey(l), { ...l }]));
        c.value.forEach(l => { const k = skuKey(l); if (merged.has(k)) merged.get(k).packs += l.packs; else merged.set(k, l); });
        r.lines = [...merged.values()]; save.rounds();
        res.json({ success: true, round: roundWithRemaining(r) });
    });
    app.post('/api/supply/rounds/:id/close', write, (req, res) => {
        const r = rounds.find(x => x.id === req.params.id); if (!r) return fail(res, 404, 'Round not found.');
        if (r.status !== 'open') return fail(res, 409, 'This round is already closed.');
        const cur = roundWithRemaining(r); const returned = new Map();
        for (const l of (Array.isArray(req.body && req.body.returned) ? req.body.returned : [])) {
            const packs = Number(l.packs); if (!Number.isInteger(packs) || packs < 0) return fail(res, 400, 'Returned packs must be whole numbers.');
            if (packs) returned.set(skuKey(l), (returned.get(skuKey(l)) || 0) + packs);
        }
        const missing = [];
        for (const l of cur.lines) {
            const back = returned.get(skuKey(l)) || 0;
            if (back > l.remaining) return fail(res, 400, `You cannot return ${back} of ${l.productName}${l.colour ? ' ' + l.colour : ''}${l.size ? ' ' + l.size : ''} — only ${l.remaining} left on the round.`);
            if (l.remaining - back > 0) missing.push({ productId: l.productId, productName: l.productName, colour: l.colour, size: l.size, packs: l.remaining - back });
        }
        r.status = 'closed'; r.closedAt = Date.now(); r.closedBy = by(req);
        r.returned = cur.lines.map(l => ({ productId: l.productId, colour: l.colour, size: l.size, packs: returned.get(skuKey(l)) || 0 })).filter(x => x.packs > 0);
        r.missing = missing; r.closeNote = cleanText(req.body && req.body.note, 200);
        if (hooks.onRoundClose && !r.practice) hooks.onRoundClose(r.returned, r);
        save.rounds();
        res.json({ success: true, round: roundWithRemaining(r), missing });
    });

    // ── SUPPLY RECORDS (supply / swap / credit) ───────────────────────────────
    function cleanLines(rawLines, pm) {
        const lines = [];
        for (const l of rawLines) {
            const packs = Number(l.packs); if (!Number.isInteger(packs) || packs <= 0 || packs > 100000) return { error: 'Every line needs a whole number of packs from 1 to 100000.' };
            const unitPrice = round2(l.unitPrice); if (!(unitPrice >= 0) || unitPrice > 1000000 || isNaN(Number(l.unitPrice))) return { error: 'Every line needs a price of 0 or more (and not absurdly large).' };
            const line = { packs, unitPrice, lineTotal: round2(packs * unitPrice), colour: cleanText(l.colour, 40), size: cleanText(l.size, 20) };
            if (l.productId) { const p = pm.get(l.productId); if (!p) return { error: 'A product on this supply no longer exists.' };
                line.productId = p.id; line.productName = p.name; line.brand = p.brand || ''; line.invoiceName = (prices[p.id] && prices[p.id].desc) || p.name; }
            else { line.description = cleanText(l.description, 80); if (!line.description) return { error: 'Describe each custom line.' }; }
            lines.push(line);
        }
        return { lines };
    }
    function cleanSupply(body, selfId) {
        body = body || {};
        const shop = shopOf(body.shopId); if (!shop) return { error: 'Choose a shop.' };
        if (shop.type === 'online') return { error: 'Online sales come from website orders automatically. Choose a shop or Samples.' };
        const date = body.date || today(); if (!validDate(date)) return { error: 'The supply date is not a valid date.' };
        const termsDays = body.termsDays === undefined || body.termsDays === '' ? shop.termsDays : parseInt(body.termsDays, 10);
        if (isNaN(termsDays) || termsDays < 0 || termsDays > 365) return { error: 'Payment terms must be between 0 and 365 days.' };
        const dueDate = body.dueDate || addDays(date, termsDays); if (!validDate(dueDate)) return { error: 'The due date is not a valid date.' };
        const rawLines = Array.isArray(body.lines) ? body.lines : [], rawBack = Array.isArray(body.takenBack) ? body.takenBack : [];
        if (rawLines.length > 300 || rawBack.length > 300) return { error: 'Too many lines on one supply.' };
        const pm = new Map(getProducts().map(p => [p.id, p]));
        const g = cleanLines(rawLines, pm); if (g.error) return g; const lines = g.lines;
        const b = cleanLines(rawBack.map(x => ({ ...x, description: undefined })), pm); if (b.error) return b; const takenBack = b.lines;
        if (takenBack.some(l => !l.productId)) return { error: 'Taken-back items must be catalogue products.' };
        let roundId = null;
        if (body.roundId) {
            const round = rounds.find(r => r.id === body.roundId);
            if (!round) return { error: 'That round no longer exists.' };
            if (round.status !== 'open') return { error: 'That round is closed. Start a new round to supply from.' };
            roundId = round.id;
            const cur = roundWithRemaining(round, selfId); const want = new Map();
            lines.forEach(l => { if (l.productId) want.set(skuKey(l), (want.get(skuKey(l)) || 0) + l.packs); });
            for (const [k, packs] of want) {
                const have = cur.lines.find(x => skuKey(x) === k); const avail = have ? have.remaining : 0;
                if (packs > avail) { const lb = lines.find(l => l.productId && skuKey(l) === k);
                    return { error: `You are carrying ${avail} of ${lb.productName}${lb.colour ? ' ' + lb.colour : ''}${lb.size ? ' ' + lb.size : ''} but the supply has ${packs}.` }; }
            }
        }
        const shelf = (Array.isArray(body.shelf) ? body.shelf : []).slice(0, 600).filter(x => x && x.productId && Number.isInteger(Number(x.has)) && Number(x.has) >= 0)
            .map(x => ({ productId: String(x.productId), colour: cleanText(x.colour, 40), size: cleanText(x.size, 20), has: Number(x.has) }));
        const givenTotal = sum(lines, l => l.lineTotal), backTotal = sum(takenBack, l => l.lineTotal);
        const rate = sset.vatRate; let kind = 'supply', amount, creditAmount = 0;
        if (!lines.length && !takenBack.length) {
            amount = round2(body.amount);
            if (isNaN(Number(body.amount)) || !(amount > 0) || amount > 1e9) return { error: 'Add the items, or enter the invoice total.' };
        } else {
            const net = round2(givenTotal - backTotal);
            if (net > 0) amount = net; else if (net === 0) { kind = 'swap'; amount = 0; } else { kind = 'credit'; amount = 0; creditAmount = -net; }
        }
        let invoiceNo = cleanText(body.invoiceNo, 40);
        if (kind === 'supply' && !invoiceNo) return { error: 'Enter the invoice number you write on the hard-copy invoice.' };
        if (invoiceNo) { const clash = vSupplies().find(s => s.id !== selfId && !s.voided && normName(s.invoiceNo) === normName(invoiceNo));
            if (clash) return { error: `Invoice ${clash.invoiceNo} is already recorded (${(shopOf(clash.shopId) || {}).name || ''}, ${clash.date}).` }; }
        if (!invoiceNo) invoiceNo = (kind === 'swap' ? 'SWAP-' : 'CREDIT-') + date.replace(/-/g, '') + '-' + (vSupplies().filter(s => s.date === date && s.kind === kind).length + 1);
        const subtotal = kind === 'supply' ? round2(amount / (1 + rate / 100)) : 0, vatAmount = kind === 'supply' ? round2(amount - subtotal) : 0;
        return { value: { kind, shopId: shop.id, shopName: shop.name, invoiceNo, date, termsDays, dueDate, lines, takenBack,
            packsTotal: lines.reduce((a, l) => a + l.packs, 0), takenBackPacks: takenBack.reduce((a, l) => a + l.packs, 0),
            givenTotal, takenBackTotal: backTotal, amount, creditAmount,
            subtotal, vatRate: rate, vatAmount, vatParts: kind === 'supply' ? vatParts(subtotal, vatAmount) : [], roundId, shelf, notes: cleanText(body.notes, 500) } };
    }
    function applyCredit(shopId, amount, reason, refId) {
        // a credit is spent on the shop's oldest unpaid invoices; anything left stays as shop credit
        let left = round2(amount);
        const open = vSupplies().filter(s => s.shopId === shopId && !s.voided && isSupply(s)).map(s => ({ s, m: money(s) }))
            .filter(x => x.m.available > 0.005).sort((a, b) => a.s.dueDate.localeCompare(b.s.dueDate));
        const credit = tag({ id: uid('crd'), shopId, amount: round2(amount), remaining: 0, date: today(), reason, refId, createdAt: Date.now() });
        for (const x of open) { if (left <= 0.005) break; const use = round2(Math.min(left, x.m.available));
            payments.push(tag({ id: uid('pay'), shopId, supplyId: x.s.id, amount: use, method: 'credit', reference: reason, date: today(), note: 'Credit applied', creditId: credit.id, createdBy: 'system', createdAt: Date.now() })); left = round2(left - use); }
        credit.remaining = Math.max(0, left); credits.push(credit); save.payments(); save.credits();
    }
    app.get('/api/supply/next-invoice-no', read, (req, res) => {
        const last = vSupplies().filter(s => !s.voided && isSupply(s)).sort((a, b) => b.createdAt - a.createdAt)[0];
        const m = last && last.invoiceNo.match(/^(.*?)(\d+)$/);
        res.json({ next: m ? m[1] + String(parseInt(m[2], 10) + 1).padStart(m[2].length, '0') : '' });
    });
    app.get('/api/supply/supplies', read, (req, res) => {
        const { shopId, from, to, q, includeVoid, status } = req.query; const needle = normName(q);
        let list = vSupplies().filter(s => (includeVoid === 'true' || !s.voided) && (!shopId || s.shopId === shopId) && (!from || s.date >= from) && (!to || s.date <= to)
            && (!needle || normName(s.invoiceNo).includes(needle) || normName((shopOf(s.shopId) || {}).name).includes(needle)));
        list = list.sort((a, b) => (b.date === a.date ? b.createdAt - a.createdAt : b.date.localeCompare(a.date))).map(dressSupply);
        if (status) list = list.filter(s => s.status === status);
        res.json(list);
    });
    app.get('/api/supply/supplies/:id', read, (req, res) => {
        const s = supplyOf(req.params.id); if (!s) return fail(res, 404, 'Supply record not found.');
        res.json({ ...dressSupply(s), payments: vPayments().filter(p => p.supplyId === s.id), cheques: chequeAllocs(s.id).map(x => ({ id: x.cheque.id, chequeNo: x.cheque.chequeNo, status: x.cheque.status, amount: x.amount, chequeDate: x.cheque.chequeDate })) });
    });
    app.post('/api/supply/supplies', write, (req, res) => {
        const c = cleanSupply(req.body, null); if (c.error) return fail(res, 400, c.error);
        const already = round2(req.body && req.body.alreadyPaid); if (isNaN(already) || already < 0 || already > 1e9) return fail(res, 400, 'Already-paid must be an amount of 0 or more.');
        if (already > 0 && already > c.value.amount + 0.005) return fail(res, 400, 'Already-paid cannot be more than the invoice total.');
        const rec = tag({ id: uid('sup'), ...c.value, voided: false, createdAt: Date.now(), createdBy: by(req), history: [] });
        supplies.push(rec);
        if (already > 0) { payments.push(tag({ id: uid('pay'), shopId: rec.shopId, supplyId: rec.id, amount: already, method: 'earlier', reference: '', date: rec.date, note: 'Paid before this invoice was entered here', createdBy: by(req), createdAt: Date.now() })); save.payments(); }
        if (rec.kind === 'credit') applyCredit(rec.shopId, rec.creditAmount, 'Swap credit ' + rec.invoiceNo, rec.id);
        if (hooks.onSupply && !rec.practice) hooks.onSupply(rec);
        save.supplies();
        res.json({ success: true, supply: dressSupply(rec) });
    });
    app.put('/api/supply/supplies/:id', write, (req, res) => {
        const rec = supplyOf(req.params.id); if (!rec) return fail(res, 404, 'Supply record not found.');
        if (rec.voided) return fail(res, 409, 'A voided supply cannot be edited.');
        const c = cleanSupply({ ...(req.body || {}), roundId: undefined }, rec.id); if (c.error) return fail(res, 400, c.error);
        c.value.roundId = rec.roundId; c.value.shelf = rec.shelf || [];
        const m = money(rec);
        if (isSupply(rec) && c.value.kind !== 'supply' && (m.paid > 0 || m.chequePending > 0)) return fail(res, 409, 'This invoice already has payments — it cannot become a swap.');
        if (c.value.kind === 'supply' && c.value.amount < m.paid - 0.005) return fail(res, 409, `This invoice already has ${m.paid.toFixed(2)} paid — the total cannot go below that.`);
        const changes = [];
        if (rec.invoiceNo !== c.value.invoiceNo) changes.push(`invoice ${rec.invoiceNo} → ${c.value.invoiceNo}`);
        if (rec.shopId !== c.value.shopId) changes.push(`shop ${rec.shopName} → ${c.value.shopName}`);
        if (rec.date !== c.value.date) changes.push(`date ${rec.date} → ${c.value.date}`);
        if (rec.amount !== c.value.amount) changes.push(`amount ${rec.amount.toFixed(2)} → ${c.value.amount.toFixed(2)}`);
        if (rec.packsTotal !== c.value.packsTotal) changes.push(`packs ${rec.packsTotal} → ${c.value.packsTotal}`);
        Object.assign(rec, c.value, { updatedAt: Date.now() });
        (rec.history = rec.history || []).push({ at: Date.now(), by: by(req), action: 'edited', detail: changes.join('; ') || 'details updated' });
        save.supplies();
        res.json({ success: true, supply: dressSupply(rec) });
    });
    app.post('/api/supply/supplies/:id/void', write, (req, res) => {
        const rec = supplyOf(req.params.id); if (!rec) return fail(res, 404, 'Supply record not found.');
        if (rec.voided) return fail(res, 409, 'Already voided.');
        const reason = cleanText(req.body && req.body.reason, 200); if (!reason) return fail(res, 400, 'Give a reason for voiding this supply.');
        const m = money(rec); if (m.paid > 0 || m.chequePending > 0) return fail(res, 409, 'This invoice has payments or a cheque against it. Void those first.');
        rec.voided = true; rec.voidReason = reason; rec.voidedAt = Date.now(); rec.voidedBy = by(req);
        (rec.history = rec.history || []).push({ at: Date.now(), by: by(req), action: 'voided', detail: reason });
        if (rec.kind === 'credit') {
            // a swap credit was spent on the shop's oldest invoices (or kept as shop credit) — take that back
            credits.filter(c => c.refId === rec.id).forEach(c => payments.forEach(p => { if (p.creditId === c.id && !p.voided) { p.voided = true; p.voidReason = 'Swap credit voided'; p.voidedBy = by(req); p.voidedAt = Date.now(); } }));
            credits = credits.filter(c => c.refId !== rec.id);
            save.payments(); save.credits();
        }
        save.supplies();
        res.json({ success: true, supply: dressSupply(rec) });
    });

    // ── GRA TAX INVOICE (a replica of the supply invoice: same quantities and total, tax breakdown) ──
    function taxInvoiceOf(s) {
        const rate = 1 + sset.vatRate / 100;
        const groups = new Map();
        s.lines.forEach(l => { const n = l.invoiceName || l.productName || l.description; if (!groups.has(n)) groups.set(n, { description: n, qty: 0, inclAmount: 0, unitIncl: l.unitPrice }); const g = groups.get(n); g.qty += l.packs; g.inclAmount = round2(g.inclAmount + l.lineTotal); });
        const rows = [...groups.values()].map(g => ({ qty: g.qty, description: g.description, unitExcl: round2(g.unitIncl / rate), amountExcl: round2(g.inclAmount / rate) }));
        const total = s.amount; const tev = round2(total / rate);
        if (rows.length) { const drift = round2(tev - sum(rows, r => r.amountExcl)); rows[rows.length - 1].amountExcl = round2(rows[rows.length - 1].amountExcl + drift); }
        const nhil = round2(tev * 0.025), getfund = round2(tev * 0.025), vat = round2(total - tev - nhil - getfund);
        const shop = shopOf(s.shopId) || {};
        return { supplier: { name: sset.companyName, address: sset.companyAddress, tel: sset.companyTel, mobile: sset.companyMobile, tin: sset.tin },
            customer: { name: shop.name || s.shopName, tin: shop.tin || '' }, dateOfSupply: s.date, dateOfInvoice: (s.taxInvoice && s.taxInvoice.date) || today(), termsOfPayment: `${s.termsDays} days`,
            supplyInvoiceNo: s.invoiceNo, serial: (s.taxInvoice && s.taxInvoice.serial) || '', issued: !!s.taxInvoice,
            rows, taxExclusiveValue: tev, nhil, getfund, vat, totalTaxes: round2(nhil + getfund + vat), totalInclusive: total };
    }
    app.get('/api/supply/supplies/:id/tax-invoice', read, (req, res) => {
        const s = supplyOf(req.params.id); if (!s) return fail(res, 404, 'Supply record not found.');
        if (!isSupply(s)) return fail(res, 400, 'Only supply invoices have a tax invoice.');
        res.json(taxInvoiceOf(s));
    });
    app.put('/api/supply/supplies/:id/tax-invoice', write, (req, res) => {
        const s = supplyOf(req.params.id); if (!s) return fail(res, 404, 'Supply record not found.');
        const b = req.body || {};
        if (b.clear === true) { s.taxInvoice = null; save.supplies(); return res.json({ success: true }); }
        const serial = cleanText(b.serial, 40); if (!serial) return fail(res, 400, 'Enter the GRA serial number printed on the tax invoice.');
        const date = b.date || today(); if (!validDate(date)) return fail(res, 400, 'The tax invoice date is not valid.');
        s.taxInvoice = { serial, date, issuedBy: by(req), issuedAt: Date.now() };
        (s.history = s.history || []).push({ at: Date.now(), by: by(req), action: 'tax invoice issued', detail: serial });
        save.supplies();
        res.json({ success: true, taxInvoice: s.taxInvoice });
    });

    // ── PAYMENTS ──────────────────────────────────────────────────────────────
    const METHODS = ['cash', 'momo', 'bank', 'other'];
    app.get('/api/supply/payments', read, (req, res) => {
        const { shopId, supplyId } = req.query;
        res.json(vPayments().filter(p => (!shopId || p.shopId === shopId) && (!supplyId || p.supplyId === supplyId)).sort((a, b) => b.date.localeCompare(a.date)));
    });
    app.post('/api/supply/payments', write, (req, res) => {
        const b = req.body || {}; const shop = shopOf(b.shopId); if (!shop) return fail(res, 400, 'Choose a shop.');
        const amount = round2(b.amount); if (isNaN(Number(b.amount)) || !(amount > 0) || amount > 1e9) return fail(res, 400, 'Enter the amount paid.');
        const method = METHODS.includes(b.method) ? b.method : null; if (!method) return fail(res, 400, 'Choose how it was paid.');
        const date = b.date || today(); if (!validDate(date)) return fail(res, 400, 'The payment date is not valid.');
        const open = vSupplies().filter(s => s.shopId === shop.id && !s.voided && isSupply(s)).map(s => ({ s, m: money(s) })).filter(x => x.m.available > 0.005);
        const made = []; const batch = uid('bat');
        if (b.supplyId) {
            const x = open.find(o => o.s.id === b.supplyId); if (!x) return fail(res, 400, 'That invoice has nothing left to pay.');
            if (amount > x.m.available + 0.005) return fail(res, 400, `That invoice only has ${x.m.available.toFixed(2)} left to pay.`);
            made.push({ supplyId: x.s.id, amount });
        } else {
            let left = amount; const totalOpen = sum(open, x => x.m.available);
            if (amount > totalOpen + 0.005) return fail(res, 400, `This shop only owes ${totalOpen.toFixed(2)} in total.`);
            for (const x of open.sort((a, c) => a.s.dueDate.localeCompare(c.s.dueDate))) { if (left <= 0.005) break; const use = round2(Math.min(left, x.m.available)); made.push({ supplyId: x.s.id, amount: use }); left = round2(left - use); }
        }
        made.forEach(m => payments.push(tag({ id: uid('pay'), batchId: batch, shopId: shop.id, supplyId: m.supplyId, amount: m.amount, method, reference: cleanText(b.reference, 60), date, note: cleanText(b.note, 200), createdBy: by(req), createdAt: Date.now() })));
        save.payments();
        res.json({ success: true, applied: made.map(m => ({ ...m, invoiceNo: (supplyOf(m.supplyId) || {}).invoiceNo })) });
    });
    app.post('/api/supply/payments/:id/void', write, (req, res) => {
        const p = payments.find(x => x.id === req.params.id); if (!p) return fail(res, 404, 'Payment not found.');
        if (p.voided) return fail(res, 409, 'Already voided.');
        const reason = cleanText(req.body && req.body.reason, 200); if (!reason) return fail(res, 400, 'Give a reason for voiding this payment.');
        p.voided = true; p.voidReason = reason; p.voidedBy = by(req); p.voidedAt = Date.now(); save.payments();
        res.json({ success: true });
    });

    // ── CHEQUES (photo kept privately; balance drops only when the cheque clears) ──
    const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 12 * 1024 * 1024, files: 1, fields: 5 } });
    const photoUpload = (req, res, next) => upload.single('photo')(req, res, err => err ? fail(res, err.code === 'LIMIT_FILE_SIZE' ? 413 : 400, err.code === 'LIMIT_FILE_SIZE' ? 'That photo is too large (12 MB at most). Try a lower photo quality.' : 'The photo could not be uploaded.') : next());
    function dressCheque(c) { return { ...c, hasPhoto: !!c.photo, allocations: (c.allocations || []).map(a => ({ ...a, invoiceNo: (supplyOf(a.supplyId) || {}).invoiceNo })) }; }
    async function savePhoto(id, buf) {
        const out = await sharp(buf).rotate().resize({ width: 1400, height: 1400, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 72 }).toBuffer();
        const name = id + '.jpg'; fs.writeFileSync(path.join(PHOTO_DIR, name), out); return name;
    }
    app.get('/api/supply/cheques', read, (req, res) => {
        const { shopId, status } = req.query;
        res.json(vCheques().filter(c => !c.voided && (!shopId || c.shopId === shopId) && (!status || c.status === status)).sort((a, b) => b.receivedDate.localeCompare(a.receivedDate)).map(dressCheque));
    });
    app.post('/api/supply/cheques', write, photoUpload, async (req, res) => {
        try {
            let b = {}; try { b = JSON.parse((req.body && req.body.data) || '{}'); } catch (e) { return fail(res, 400, 'Bad cheque data.'); }
            const shop = shopOf(b.shopId); if (!shop) return fail(res, 400, 'Choose a shop.');
            const chequeNo = cleanText(b.chequeNo, 30); if (!chequeNo) return fail(res, 400, 'Enter the cheque number.');
            const chequeDate = b.chequeDate; if (!validDate(chequeDate)) return fail(res, 400, 'Enter the date written on the cheque.');
            const receivedDate = b.receivedDate || today(); if (!validDate(receivedDate)) return fail(res, 400, 'The pickup date is not valid.');
            if (vCheques().some(c => !c.voided && c.shopId === shop.id && normName(c.chequeNo) === normName(chequeNo))) return fail(res, 400, `Cheque ${chequeNo} is already recorded for ${shop.name}.`);
            const allocs = Array.isArray(b.allocations) ? b.allocations : [];
            if (!allocs.length) return fail(res, 400, 'Tick the invoice(s) this cheque pays.');
            const clean = []; const seen = new Set();
            for (const a of allocs) {
                const s = supplyOf(a.supplyId); if (!s || s.shopId !== shop.id || s.voided || !isSupply(s)) return fail(res, 400, 'One of the invoices is not valid for this shop.');
                if (seen.has(s.id)) return fail(res, 400, 'An invoice is listed twice.'); seen.add(s.id);
                const amt = round2(a.amount); const avail = money(s).available;
                if (isNaN(Number(a.amount)) || !(amt > 0)) return fail(res, 400, 'Each ticked invoice needs an amount.');
                if (amt > avail + 0.005) return fail(res, 400, `Invoice ${s.invoiceNo} only has ${avail.toFixed(2)} left to cover.`);
                clean.push({ supplyId: s.id, amount: amt });
            }
            const amount = sum(clean, a => a.amount);
            if (b.amount !== undefined && b.amount !== '' && Math.abs(round2(b.amount) - amount) > 0.005) return fail(res, 400, `The cheque amount (${round2(b.amount).toFixed(2)}) does not match the invoices ticked (${amount.toFixed(2)}).`);
            const id = uid('chq'); let photo = null;
            if (req.file) { try { photo = await savePhoto(id, req.file.buffer); } catch (e) { return fail(res, 400, 'That photo could not be read. Try taking it again.'); } }
            // another request may have used the same balance or cheque number while the photo was being processed
            const taken = clean.some(a => a.amount > money(supplyOf(a.supplyId)).available + 0.005) || vCheques().some(c => !c.voided && c.shopId === shop.id && normName(c.chequeNo) === normName(chequeNo));
            if (taken) { if (photo) { try { fs.unlinkSync(path.join(PHOTO_DIR, photo)); } catch (e) {} } return fail(res, 409, 'Something changed while saving. Check the invoice balances and try again.'); }
            const c = tag({ id, shopId: shop.id, shopName: shop.name, chequeNo, chequeDate, bank: cleanText(b.bank, 60), amount, allocations: clean, status: 'received', receivedDate, photo, note: cleanText(b.note, 200), createdBy: by(req), createdAt: Date.now(), history: [{ at: Date.now(), by: by(req), status: 'received', date: receivedDate }] });
            cheques.push(c);
            // the VAT (GRA tax) invoice is issued at pickup: one per supply
            (Array.isArray(b.taxInvoices) ? b.taxInvoices : []).forEach(t => { const s = supplyOf(t.supplyId); const serial = cleanText(t.serial, 40);
                if (s && s.shopId === shop.id && serial) { s.taxInvoice = { serial, date: t.date && validDate(t.date) ? t.date : receivedDate, issuedBy: by(req), issuedAt: Date.now() }; (s.history = s.history || []).push({ at: Date.now(), by: by(req), action: 'tax invoice issued', detail: serial }); } });
            // a "cheque ready" call for this shop is now dealt with
            calls.forEach(cl => { if (live(cl) && cl.shopId === shop.id && cl.type === 'cheque_ready' && cl.status === 'open') { cl.status = 'done'; cl.doneAt = Date.now(); cl.doneBy = by(req); } });
            save.cheques(); save.supplies(); save.calls();
            res.json({ success: true, cheque: dressCheque(c) });
        } catch (e) { console.error('[SUPPLY cheque]', e.message); fail(res, 500, 'Could not save the cheque.'); }
    });
    app.put('/api/supply/cheques/:id/status', write, (req, res) => {
        const c = cheques.find(x => x.id === req.params.id); if (!c) return fail(res, 404, 'Cheque not found.');
        if (c.voided) return fail(res, 409, 'This cheque was voided.');
        const status = req.body && req.body.status; const date = (req.body && req.body.date) || today();
        if (!['received', 'deposited', 'cleared', 'bounced'].includes(status)) return fail(res, 400, 'Choose a status.');
        if (!validDate(date)) return fail(res, 400, 'The date is not valid.');
        if (status === 'cleared' && !c.depositedDate) c.depositedDate = date;
        if (status === 'deposited') c.depositedDate = date;
        if (status === 'cleared') c.clearedDate = date;
        if (status === 'bounced') { c.bouncedDate = date; c.bounceNote = cleanText(req.body.note, 200); }
        if (status === 'received') { c.depositedDate = null; c.clearedDate = null; c.bouncedDate = null; }
        c.status = status; (c.history = c.history || []).push({ at: Date.now(), by: by(req), status, date });
        save.cheques();
        res.json({ success: true, cheque: dressCheque(c) });
    });
    app.post('/api/supply/cheques/:id/void', write, (req, res) => {
        const c = cheques.find(x => x.id === req.params.id); if (!c) return fail(res, 404, 'Cheque not found.');
        const reason = cleanText(req.body && req.body.reason, 200); if (!reason) return fail(res, 400, 'Give a reason.');
        c.voided = true; c.voidReason = reason; c.voidedBy = by(req); save.cheques();
        res.json({ success: true });
    });
    app.get('/api/supply/cheques/:id/photo', read, (req, res) => {
        const c = cheques.find(x => x.id === req.params.id); if (!c || !c.photo) return fail(res, 404, 'No photo.');
        res.sendFile(path.join(PHOTO_DIR, path.basename(c.photo)));
    });

    // ── CALLS / REQUESTS (a shop calls for stock, or to say a cheque is ready) ─
    app.get('/api/supply/calls', read, (req, res) => res.json(vCalls().filter(c => (!req.query.status || c.status === req.query.status)).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt)));
    app.post('/api/supply/calls', write, (req, res) => {
        const b = req.body || {}; const shop = shopOf(b.shopId); if (!shop) return fail(res, 400, 'Choose a shop.');
        const type = ['stock', 'cheque_ready', 'other'].includes(b.type) ? b.type : null; if (!type) return fail(res, 400, 'Choose the type of call.');
        const date = b.date || today(); if (!validDate(date)) return fail(res, 400, 'The date is not valid.');
        const c = tag({ id: uid('call'), shopId: shop.id, shopName: shop.name, type, date, items: cleanText(b.items, 300), note: cleanText(b.note, 300), status: 'open', createdBy: by(req), createdAt: Date.now() });
        calls.push(c); save.calls(); res.json({ success: true, call: c });
    });
    app.put('/api/supply/calls/:id', write, (req, res) => {
        const c = calls.find(x => x.id === req.params.id); if (!c) return fail(res, 404, 'Call not found.');
        const b = req.body || {}; if (b.status && ['open', 'done'].includes(b.status)) { c.status = b.status; c.doneAt = b.status === 'done' ? Date.now() : null; c.doneBy = b.status === 'done' ? by(req) : null; }
        if (b.note !== undefined) c.note = cleanText(b.note, 300);
        save.calls(); res.json({ success: true, call: c });
    });
    app.delete('/api/supply/calls/:id', write, (req, res) => { calls = calls.filter(x => x.id !== req.params.id); save.calls(); res.json({ success: true }); });

    // ── VISITS WITHOUT A SUPPLY ───────────────────────────────────────────────
    app.post('/api/supply/visits', write, (req, res) => {
        const shop = shopOf(req.body && req.body.shopId); if (!shop) return fail(res, 400, 'Choose a shop.');
        const date = (req.body && req.body.date) || today(); if (!validDate(date)) return fail(res, 400, 'The visit date is not valid.');
        const shelf = (Array.isArray(req.body.shelf) ? req.body.shelf : []).slice(0, 600).filter(x => x && x.productId && Number.isInteger(Number(x.has)) && Number(x.has) >= 0)
            .map(x => ({ productId: String(x.productId), colour: cleanText(x.colour, 40), size: cleanText(x.size, 20), has: Number(x.has) }));
        const v = tag({ id: uid('vis'), shopId: shop.id, shopName: shop.name, date, shelf, notes: cleanText(req.body.notes, 300), createdAt: Date.now(), createdBy: by(req) });
        visits.push(v); save.visits(); res.json({ success: true, visit: v });
    });

    // ── TO DO (everything that needs the owner's attention) ───────────────────
    function buildTodo() {
        const t = today(); const items = [];
        vShops().filter(s => !s.builtIn && s.active !== false).forEach(s => {
            const mine = vSupplies().filter(x => x.shopId === s.id && !x.voided && isSupply(x));
            if (!mine.length) return;
            const last = mine.reduce((m, x) => (x.date > m ? x.date : m), ''); const days = daysBetween(last, t); const limit = s.reorderDays || sset.reorderDays;
            if (days >= limit) items.push({ type: 'revisit', shopId: s.id, shopName: s.name, days, lastSupplyDate: last, text: `${s.name} — last supplied ${days} days ago` });
        });
        vCalls().filter(c => c.status === 'open').forEach(c => items.push({ type: c.type === 'cheque_ready' ? 'cheque_ready' : (c.type === 'stock' ? 'stock_request' : 'call'), shopId: c.shopId, shopName: c.shopName, callId: c.id, date: c.date, days: daysBetween(c.date, t),
            text: c.type === 'cheque_ready' ? `${c.shopName} — cheque ready for pickup (called ${c.date})` : c.type === 'stock' ? `${c.shopName} — asked for stock${c.items ? ': ' + c.items : ''} (called ${c.date})` : `${c.shopName} — call: ${c.note || ''}` }));
        vCheques().filter(c => !c.voided).forEach(c => {
            if (c.status === 'received' && c.chequeDate <= t) items.push({ type: 'cheque_deposit', shopId: c.shopId, shopName: c.shopName, chequeId: c.id, text: `Cheque ${c.chequeNo} (${c.shopName}) can be paid in — dated ${c.chequeDate}` });
            else if (c.status === 'received') items.push({ type: 'cheque_wait', shopId: c.shopId, shopName: c.shopName, chequeId: c.id, info: true, text: `Cheque ${c.chequeNo} (${c.shopName}) is post-dated ${c.chequeDate}` });
            if (c.status === 'deposited' && c.depositedDate && daysBetween(c.depositedDate, t) >= 5) items.push({ type: 'cheque_clear', shopId: c.shopId, shopName: c.shopName, chequeId: c.id, text: `Cheque ${c.chequeNo} (${c.shopName}) paid in ${daysBetween(c.depositedDate, t)} days ago — not cleared yet` });
        });
        const dressed = vSupplies().filter(s => !s.voided && isSupply(s)).map(dressSupply);
        dressed.filter(s => s.status === 'overdue').forEach(s => items.push({ type: 'overdue', shopId: s.shopId, shopName: s.shopName, supplyId: s.id, days: s.daysOverdue, amount: s.balance, text: `${s.shopName} — invoice ${s.invoiceNo}: ${s.balance.toFixed(2)} overdue by ${s.daysOverdue} days` }));
        dressed.filter(s => !s.taxInvoice && chequeAllocs(s.id).length).forEach(s => items.push({ type: 'tax_invoice', shopId: s.shopId, shopName: s.shopName, supplyId: s.id, text: `${s.shopName} — issue GRA tax invoice for ${s.invoiceNo}` }));
        const backupDue = !sset.lastBackupAt || (Date.now() - sset.lastBackupAt) > 30 * 86400000;
        if (backupDue && (supplies.length || cheques.length)) items.push({ type: 'backup', text: 'Download a backup of your supply records (monthly)' });
        if (hooks.todoExtra) { try { hooks.todoExtra(items); } catch (e) { console.error('[SUPPLY todoExtra]', e.message); } }
        const order = { stock_request: 1, cheque_ready: 2, cheque_deposit: 3, cheque_clear: 4, revisit: 5, overdue: 6, tax_invoice: 7, low_stock: 8, call: 9, backup: 10, cheque_wait: 11 };
        items.sort((a, b) => (order[a.type] || 99) - (order[b.type] || 99) || (b.days || 0) - (a.days || 0));
        return items;
    }
    app.get('/api/supply/todo', read, (req, res) => { const items = buildTodo(); res.json({ count: items.filter(i => !i.info).length, items }); });
    app.get('/api/supply/todo/count', read, (req, res) => res.json({ count: buildTodo().filter(i => !i.info).length }));

    // ── REPORTS ───────────────────────────────────────────────────────────────
    app.get('/api/supply/reports/receivables', read, (req, res) => {
        const rows = vSupplies().filter(s => !s.voided && isSupply(s)).map(dressSupply).filter(s => s.balance > 0.005)
            .sort((a, b) => a.dueDate.localeCompare(b.dueDate)).map(s => ({ date: s.date, invoiceNo: s.invoiceNo, shopName: s.shopName, status: s.status, dueDate: s.dueDate, amount: s.amount, balance: s.balance, chequePending: s.chequePending,
                cheques: chequeAllocs(s.id).map(x => x.cheque.chequeNo + ' (' + x.cheque.status + ')').join(', '), taxInvoice: s.taxInvoice ? s.taxInvoice.serial : '' }));
        const aging = { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90: 0 };
        rows.forEach(r => { const d = r.status === 'overdue' ? daysBetween(r.dueDate, today()) : 0; if (!d) aging.current += r.balance; else if (d <= 30) aging.d1_30 += r.balance; else if (d <= 60) aging.d31_60 += r.balance; else if (d <= 90) aging.d61_90 += r.balance; else aging.d90 += r.balance; });
        Object.keys(aging).forEach(k => aging[k] = round2(aging[k]));
        res.json({ asOf: today(), rows, totalOwed: sum(rows, r => r.balance), totalAmount: sum(rows, r => r.amount), aging, company: sset.companyName });
    });
    app.get('/api/supply/reports/vat', read, (req, res) => {
        const month = req.query.month || today().slice(0, 7);
        const rows = vSupplies().filter(s => !s.voided && isSupply(s) && s.date.slice(0, 7) === month).map(s => { const ti = taxInvoiceOf(s); return { date: s.date, invoiceNo: s.invoiceNo, shopName: (shopOf(s.shopId) || {}).name, taxExclusive: ti.taxExclusiveValue, nhil: ti.nhil, getfund: ti.getfund, vat: ti.vat, total: ti.totalInclusive, taxInvoice: s.taxInvoice ? s.taxInvoice.serial : '' }; });
        res.json({ month, rows, totals: { taxExclusive: sum(rows, r => r.taxExclusive), nhil: sum(rows, r => r.nhil), getfund: sum(rows, r => r.getfund), vat: sum(rows, r => r.vat), total: sum(rows, r => r.total) } });
    });

    // ── RANKINGS + INSIGHT (built from supplies, taken-back stock, cheques and website orders) ──
    app.get('/api/supply/rankings', read, (req, res) => {
        const from = req.query.from || '0000-01-01', to = req.query.to || '9999-12-31', includeSpecial = req.query.includeSpecial === 'true';
        const inRange = d => d >= from && d <= to;
        const sups = vSupplies().filter(s => !s.voided && inRange(s.date));
        const shopRows = new Map();
        const getShop = id => { const sh = shopOf(id) || { name: id }; if (!shopRows.has(id)) shopRows.set(id, { shopId: id, name: sh.name, special: !!sh.builtIn, amount: 0, packs: 0, supplies: 0, takenBack: 0, lastDate: '' }); return shopRows.get(id); };
        const prod = new Map(), sku = new Map(), perShopProd = new Map();
        const bump = (m, k, base, f) => { if (!m.has(k)) m.set(k, { ...base, supplied: 0, takenBack: 0, online: 0, amount: 0 }); f(m.get(k)); };
        sups.forEach(s => {
            const sh = getShop(s.shopId); sh.supplies += isSupply(s) ? 1 : 0; sh.amount = round2(sh.amount + (s.amount || 0)); sh.packs += s.packsTotal || 0; sh.takenBack += s.takenBackPacks || 0; if (s.date > sh.lastDate) sh.lastDate = s.date;
            (s.lines || []).forEach(l => { if (!l.productId) return;
                bump(prod, l.productId, { productId: l.productId, name: l.productName }, x => { x.supplied += l.packs; x.amount = round2(x.amount + l.lineTotal); });
                bump(sku, skuKey(l), { productId: l.productId, name: l.productName, colour: l.colour, size: l.size }, x => { x.supplied += l.packs; });
                bump(perShopProd, s.shopId + '|' + l.productId, { shopId: s.shopId, productId: l.productId, name: l.productName }, x => { x.supplied += l.packs; }); });
            (s.takenBack || []).forEach(l => {
                bump(prod, l.productId, { productId: l.productId, name: l.productName }, x => { x.takenBack += l.packs; });
                bump(sku, skuKey(l), { productId: l.productId, name: l.productName, colour: l.colour, size: l.size }, x => { x.takenBack += l.packs; });
                bump(perShopProd, s.shopId + '|' + l.productId, { shopId: s.shopId, productId: l.productId, name: l.productName }, x => { x.takenBack += l.packs; }); });
        });
        // website orders count as the Online shop
        const online = getShop('shop-online');
        (getOrders() || []).filter(o => o && o.items && inRange(String(o.paidAt || '').slice(0, 10)) && o.status !== 'Returned' && o.status !== 'Refunded').forEach(o => {
            online.supplies += 1; online.amount = round2(online.amount + (parseFloat(o.total) || 0));
            const d = String(o.paidAt || '').slice(0, 10); if (d > online.lastDate) online.lastDate = d;
            o.items.forEach(i => { const q = parseInt(i.quantity, 10) || 0; if (!q || !i.id) return; online.packs += q;
                bump(prod, i.id, { productId: i.id, name: i.name }, x => { x.online += q; });
                bump(sku, skuKey({ productId: i.id, colour: i.color, size: i.size }), { productId: i.id, name: i.name, colour: i.color || '', size: i.size || '' }, x => { x.online += q; });
                bump(perShopProd, 'shop-online|' + i.id, { shopId: 'shop-online', productId: i.id, name: i.name }, x => { x.supplied += q; }); });
        });
        const fin = x => ({ ...x, net: x.supplied - x.takenBack, moved: x.supplied - x.takenBack + x.online, takeBackRate: x.supplied ? Math.round(x.takenBack / x.supplied * 1000) / 10 : 0 });
        const shopList = [...shopRows.values()].filter(s => includeSpecial || !s.special);
        const behaviour = new Map();
        vSupplies().filter(s => !s.voided && isSupply(s) && inRange(s.date)).forEach(s => {
            const b = behaviour.get(s.shopId) || { shopId: s.shopId, name: (shopOf(s.shopId) || {}).name, invoices: 0, paidOnTime: 0, clearedOnTime: 0, late: 0, daysLateTotal: 0, bounced: 0, overdueNow: 0 };
            b.invoices += 1; const m = money(s); const allocs = chequeAllocs(s.id);
            const first = allocs.filter(x => x.cheque.status !== 'bounced').map(x => x.cheque.receivedDate).sort()[0];
            const cleared = allocs.filter(x => x.cheque.status === 'cleared').map(x => x.cheque.clearedDate || x.cheque.receivedDate).sort().pop();
            const direct = vPayments().filter(p => p.supplyId === s.id && !p.voided && p.method !== 'earlier' && p.method !== 'credit').map(p => p.date).sort();
            const paidDate = [first, direct[0]].filter(Boolean).sort()[0];
            if (paidDate) { const late = daysBetween(s.dueDate, paidDate); if (late <= 0) b.paidOnTime += 1; else { b.late += 1; b.daysLateTotal += late; } }
            else if (m.status === 'overdue') { b.late += 1; b.daysLateTotal += m.daysOverdue; b.overdueNow += m.balance; }
            if (cleared && daysBetween(s.dueDate, cleared) <= 0) b.clearedOnTime += 1;
            b.bounced += allocs.filter(x => x.cheque.status === 'bounced').length;
            behaviour.set(s.shopId, b);
        });
        const payRows = [...behaviour.values()].filter(b => includeSpecial || !(shopOf(b.shopId) || {}).builtIn).map(b => {
            const pct = b.invoices ? Math.round(b.paidOnTime / b.invoices * 100) : 0; const avgLate = b.late ? Math.round(b.daysLateTotal / b.late) : 0;
            const grade = b.bounced > 0 && pct < 80 ? 'C' : pct >= 90 && b.bounced === 0 ? 'A' : pct >= 60 ? 'B' : 'C';
            return { ...b, onTimePct: pct, avgDaysLate: avgLate, grade, overdueNow: round2(b.overdueNow) };
        }).sort((a, b) => b.onTimePct - a.onTimePct || a.avgDaysLate - b.avgDaysLate);
        const startOfRange = from === '0000-01-01' ? (sups.reduce((m, s) => (s.date < m ? s.date : m), today())) : from;
        const spanDays = Math.max(1, daysBetween(startOfRange, to === '9999-12-31' ? today() : to));
        const prevFrom = addDays(startOfRange, -spanDays), prevTo = addDays(startOfRange, -1);
        const prevPacks = new Map(); vSupplies().filter(s => !s.voided && s.date >= prevFrom && s.date <= prevTo).forEach(s => prevPacks.set(s.shopId, (prevPacks.get(s.shopId) || 0) + (s.packsTotal || 0)));
        const slowing = shopList.filter(s => !s.special).map(s => ({ ...s, prevPacks: prevPacks.get(s.shopId) || 0, changePct: (prevPacks.get(s.shopId) || 0) ? Math.round((s.packs - prevPacks.get(s.shopId)) / prevPacks.get(s.shopId) * 100) : null, daysSince: s.lastDate ? daysBetween(s.lastDate, today()) : null }))
            .filter(s => s.changePct !== null && s.changePct < 0).sort((a, b) => a.changePct - b.changePct);
        const owes = vShops().filter(s => !s.builtIn || includeSpecial).map(s => ({ shopId: s.id, name: s.name, ...shopMoney(s.id) })).filter(s => s.balance > 0.005).sort((a, b) => b.balance - a.balance);
        res.json({ from: req.query.from || null, to: req.query.to || null,
            shopsByAmount: shopList.slice().sort((a, b) => b.amount - a.amount), shopsByPacks: shopList.slice().sort((a, b) => b.packs - a.packs),
            payment: payRows, owes, slowing,
            products: [...prod.values()].map(fin).sort((a, b) => b.moved - a.moved), skus: [...sku.values()].map(fin).sort((a, b) => b.moved - a.moved),
            perShopProduct: [...perShopProd.values()].map(fin) });
    });

    // ── DAILY TRANSACTIONS (one day: supplies, website orders, money in; split by product type) ──
    app.get('/api/supply/daily', read, (req, res) => {
        const date = req.query.date || today(); if (!validDate(date)) return fail(res, 400, 'The date is not valid.');
        const types = new Map(); const bucket = t => { if (!types.has(t)) types.set(t, { type: t, suppliedPacks: 0, suppliedAmount: 0, takenBackPacks: 0, onlinePacks: 0, onlineAmount: 0 }); return types.get(t); };
        const sups = vSupplies().filter(s => !s.voided && s.date === date).sort((a, b) => a.createdAt - b.createdAt).map(s => {
            (s.lines || []).forEach(l => { const b = bucket(productType(l.productName || l.description)); b.suppliedPacks += l.packs; b.suppliedAmount = round2(b.suppliedAmount + l.lineTotal); });
            (s.takenBack || []).forEach(l => { const b = bucket(productType(l.productName)); b.takenBackPacks += l.packs; b.suppliedAmount = round2(b.suppliedAmount - l.lineTotal); });
            return { id: s.id, kind: s.kind || 'supply', invoiceNo: s.invoiceNo, shopName: s.shopName, packs: s.packsTotal || 0, takenBack: s.takenBackPacks || 0, amount: s.amount || 0, creditAmount: s.creditAmount || 0 };
        });
        const onlineOrders = (getOrders() || []).filter(o => o && String(o.paidAt || '').slice(0, 10) === date && o.status !== 'Returned' && o.status !== 'Refunded').map(o => {
            let packs = 0; (o.items || []).forEach(i => { const q = parseInt(i.quantity, 10) || 0; packs += q; const b = bucket(productType(i.name)); b.onlinePacks += q; b.onlineAmount = round2(b.onlineAmount + (parseFloat(i.price) || 0) * q); });
            return { id: o.id, orderNo: o.orderNo || '', name: (o.customer && o.customer.name) || '', packs, total: parseFloat(o.total) || 0, status: o.status || 'Pending' };
        });
        const pays = vPayments().filter(p => !p.voided && p.date === date && p.method !== 'earlier' && p.method !== 'credit').map(p => ({ shopName: (shopOf(p.shopId) || {}).name, invoiceNo: (supplyOf(p.supplyId) || {}).invoiceNo, method: p.method, amount: p.amount }));
        const chq = vCheques().filter(c => !c.voided && c.receivedDate === date).map(c => ({ shopName: c.shopName, chequeNo: c.chequeNo, amount: c.amount, chequeDate: c.chequeDate, status: c.status }));
        res.json({ date, supplies: sups, online: onlineOrders, payments: pays, cheques: chq, byType: [...types.values()].sort((a, b) => (b.suppliedPacks + b.onlinePacks) - (a.suppliedPacks + a.onlinePacks)),
            totals: { suppliedPacks: sups.reduce((a, s) => a + s.packs, 0), suppliedAmount: sum(sups, s => s.amount), takenBackPacks: sups.reduce((a, s) => a + s.takenBack, 0), onlinePacks: onlineOrders.reduce((a, o) => a + o.packs, 0), onlineAmount: sum(onlineOrders, o => o.total), paymentsAmount: sum(pays, p => p.amount), chequesAmount: sum(chq, c => c.amount) } });
    });

    // ── PRACTICE MODE + BACKUP ────────────────────────────────────────────────
    app.post('/api/supply/practice/clear', write, (req, res) => {
        if ((req.body || {}).confirm !== 'CLEAR') return fail(res, 400, 'Type CLEAR to confirm.');
        cheques.filter(c => c.practice && c.photo).forEach(c => { try { fs.unlinkSync(path.join(PHOTO_DIR, path.basename(c.photo))); } catch (e) {} });
        const keep = x => !x.practice;
        shops = shops.filter(keep); supplies = supplies.filter(keep); rounds = rounds.filter(keep); visits = visits.filter(keep);
        payments = payments.filter(keep); cheques = cheques.filter(keep); calls = calls.filter(keep); credits = credits.filter(keep);
        BUILTIN.forEach(b => { if (!shops.some(x => x.id === b.id)) shops.push({ contact: '', phone: '', address: '', notes: '', tin: '', createdAt: Date.now(), createdBy: 'system', ...b }); });
        Object.values(save).forEach(f => f());
        res.json({ success: true });
    });
    app.get('/api/supply/backup', write, (req, res) => {
        const photos = {};
        cheques.forEach(c => { if (c.photo) { try { photos[c.id] = fs.readFileSync(path.join(PHOTO_DIR, path.basename(c.photo))).toString('base64'); } catch (e) {} } });
        sset.lastBackupAt = Date.now(); save.settings();
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="supply-backup-${today()}.json"`);
        res.send(JSON.stringify({ exportedAt: new Date().toISOString(), settings: sset, shops, supplies, prices, rounds, visits, payments, cheques, calls, credits, chequePhotosBase64: photos }));
    });

    // home-screen shortcut + offline app shell (never caches /api, so money figures are always live)
    app.get('/supply.webmanifest', (req, res) => { res.type('application/manifest+json').json({ name: 'Freeman Outlet Supply', short_name: 'Supply', start_url: '/supply.html', scope: '/', display: 'standalone', background_color: '#FAFAFA', theme_color: '#1A1A1A',
        icons: [{ src: '/assets/images/logo.png', sizes: '1080x1080', type: 'image/png', purpose: 'any' }] }); });
    app.get('/supply-sw.js', (req, res) => { res.setHeader('Cache-Control', 'no-cache'); res.type('application/javascript').send(`
const CACHE = 'supply-shell-v1';
const SHELL = ['/supply.html', '/styles/supply.css', '/js/supply.js', '/js/supply-money.js', '/js/supply-insight.js', '/js/supply-stock.js'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin || u.pathname.startsWith('/api/') || !SHELL.includes(u.pathname === '/supply' ? '/supply.html' : u.pathname)) return;
  e.respondWith(fetch(e.request).then(r => { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return r; }).catch(() => caches.match(e.request).then(m => m || caches.match('/supply.html'))));
});
`); });

    const pageFile = path.join(__dirname, 'src', 'pages', 'supply.html');
    app.get(['/supply', '/supply.html'], (req, res) => res.sendFile(pageFile));
    // what the round planner needs: each shop's last supply, whether it is due or asked for stock, and its usual top-up
    function planInputs() {
        const t = today(), open = vCalls().filter(c => c.status === 'open' && c.type === 'stock');
        return vShops().filter(s => !s.builtIn && s.active !== false).map(s => {
            const mine = vSupplies().filter(x => x.shopId === s.id && !x.voided && isSupply(x)).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
            const last = mine[0], days = last ? daysBetween(last.date, t) : null, limit = s.reorderDays || sset.reorderDays, req = open.find(c => c.shopId === s.id);
            return { shopId: s.id, name: s.name, days, lastSupplyDate: last ? last.date : null, reason: req ? 'request' : (last && days >= limit ? 'revisit' : ''), request: req ? req.items : '',
                usual: last ? last.lines.filter(l => l.productId).map(l => ({ productId: l.productId, colour: l.colour, size: l.size, packs: l.packs })) : [] };
        }).sort((a, b) => (b.reason ? 1 : 0) - (a.reason ? 1 : 0) || (b.days || 0) - (a.days || 0));
    }
    return { buildTodo, roundWithRemaining, openRound, planInputs, sset: () => sset };
};
