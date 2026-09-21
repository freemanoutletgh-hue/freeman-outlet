require('dotenv').config({ quiet: true }); // suppress dotenv's promotional "tip" banner on startup
const express = require('express');
const compression = require('compression');
const sharp = require('sharp');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const app = express();
// Render puts exactly one reverse proxy in front of this app. Trusting that one
// hop makes Express parse X-Forwarded-For correctly (req.ip becomes the real
// client IP, taking the right-most address the PROXY appended rather than
// anything the client itself put in the header). Without this, clientIp()
// below read the header directly and took the LEFT-most value — which is
// entirely client-supplied — so every rate limit (login, order placement,
// track lookups) was defeated by sending a random X-Forwarded-For per request.
app.set('trust proxy', 1);

// ── GZIP COMPRESSION — reduces HTML/JSON by ~70% ──────────────────────────
app.use(compression({ level: 6, threshold: 1024 }));
const PORT = process.env.PORT || 3000;

const IS_PROD = process.env.NODE_ENV === 'production';

if (IS_PROD && !process.env.JWT_SECRET) {
    console.error('FATAL: JWT_SECRET must be set via an environment variable in production — refusing to start with the default/placeholder secret.');
    process.exit(1);
}
// Same fail-fast for the admin credentials/secret — these previously had no
// production guard at all, so a missed env var on deploy would silently boot
// the live site with a publicly-known admin password (it's printed in this
// very repo's CLAUDE.md) and a JWT secret derived from a value that ships in
// source control.
if (IS_PROD && (!process.env.ADMIN_PASS || !process.env.ADMIN_USER)) {
    console.error('FATAL: ADMIN_USER and ADMIN_PASS must be set via environment variables in production — refusing to start with the default/placeholder admin login.');
    process.exit(1);
}
if (IS_PROD && !process.env.ADMIN_JWT_SECRET) {
    console.error('FATAL: ADMIN_JWT_SECRET must be set via an environment variable in production — refusing to start with a secret derived from JWT_SECRET.');
    process.exit(1);
}

const JWT_SECRET = process.env.JWT_SECRET || 'freemanoutlet-jwt-secret-change-in-production-2026';

// ── EMAIL CONFIG ───────────────────────────────────────────────────────────
const GMAIL_USER  = process.env.GMAIL_USER  || '';
const GMAIL_PASS  = process.env.GMAIL_PASS;
const STORE_EMAIL = process.env.STORE_EMAIL || '';

// ── ADMIN CREDENTIALS ──────────────────────────────────────────────────────
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'freeman2026';

// ── PERSISTENT DATA FILES ──────────────────────────────────────────────────
// On Render: set DATA_DIR env var to the mounted disk path (e.g. /var/data)
const DATA_DIR    = process.env.DATA_DIR || path.join(__dirname, 'data');
const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(__dirname, 'uploads');
const PRODUCTS_FILE     = path.join(DATA_DIR, 'products.json');
const REVIEWS_FILE      = path.join(DATA_DIR, 'reviews.json');
const ORDERS_FILE       = path.join(DATA_DIR, 'orders.json');
const CODES_FILE        = path.join(DATA_DIR, 'codes.json');
const NOTIFY_FILE       = path.join(DATA_DIR, 'notify.json');
const DELIVERY_FILE     = path.join(DATA_DIR, 'delivery.json');
const CATEGORIES_FILE   = path.join(DATA_DIR, 'categories.json');
const SETTINGS_FILE     = path.join(DATA_DIR, 'settings.json');
const FAQS_FILE         = path.join(DATA_DIR, 'faqs.json');
const INTAKES_FILE      = path.join(DATA_DIR, 'stock-intakes.json');
const MOVEMENTS_FILE    = path.join(DATA_DIR, 'stock-movements.json');
const INV_META_FILE     = path.join(DATA_DIR, 'inventory-meta.json');
const ABANDONED_FILE    = path.join(DATA_DIR, 'abandoned-carts.json');
const CUSTOMERS_FILE      = path.join(DATA_DIR, 'customers.json');
const ZONE_MAP_FILE       = path.join(DATA_DIR, 'zone-map.json');
const WISHLIST_FILE       = path.join(DATA_DIR, 'wishlists.json');
const PWD_RESET_FILE      = path.join(DATA_DIR, 'pwd-resets.json');
const REGION_RATES_FILE   = path.join(DATA_DIR, 'region-rates.json');
const REVOKED_TOKENS_FILE  = path.join(DATA_DIR, 'revoked-tokens.json');
const EMAIL_VERIFY_FILE    = path.join(DATA_DIR, 'email-verify.json');
const PRODUCT_EVENTS_FILE  = path.join(DATA_DIR, 'product-events.json');
const ADMIN_ACCOUNTS_FILE  = path.join(DATA_DIR, 'admin-accounts.json');

if (!fs.existsSync(DATA_DIR))    fs.mkdirSync(DATA_DIR,    { recursive: true });
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// Extract color name from either a rich variant object {color,image,stock} or a plain string
function vColor(v) { return typeof v === 'object' && v ? (v.color || '') : String(v || ''); }
function variantColors(variants) { return (variants || []).map(vColor).filter(Boolean); }

// ── GHANA VAT (prices are VAT-inclusive) ─────────────────────────────────────
// From 1 Jan 2026 (VAT Act 2025, Act 1151): VAT 15% + NHIL 2.5% + GETFund 2.5% = 20%,
// all charged on the same VAT-exclusive amount. Given an inclusive total, the
// exclusive amount is total / 1.20 and each levy is a percentage of that.
const VAT_PARTS = [
    { label: 'VAT', rate: 15 },
    { label: 'NHIL', rate: 2.5 },
    { label: 'GETFund Levy', rate: 2.5 }
];
const VAT_TOTAL_RATE = 20;
function vatBreakdown(total) {
    const t = Math.round((parseFloat(total) || 0) * 100) / 100;
    const base = Math.round(t / (1 + VAT_TOTAL_RATE / 100) * 100) / 100;
    const parts = VAT_PARTS.map(p => ({ label: p.label, rate: p.rate, amount: Math.round(base * p.rate) / 100 }));
    // absorb rounding drift in the last levy so base + levies always equals the total exactly
    const drift = Math.round((t - base - parts.reduce((s, p) => s + p.amount, 0)) * 100) / 100;
    parts[parts.length - 1].amount = Math.round((parts[parts.length - 1].amount + drift) * 100) / 100;
    return { inclusiveTotal: t, base, parts, totalRate: VAT_TOTAL_RATE };
}

// ── BUNDLE PRICING ───────────────────────────────────────────────────────────
// A product can carry bundle offers ("3 pieces for GH₵690"). They are read
// through productBundles() only, so an offer that stops being a genuine saving
// (e.g. the unit price is later lowered) silently stops applying. Quantities
// are pooled per product across colour/size lines, largest bundle first.
const BUNDLE_TAGS = ['Recommended', 'Popular choice', 'Best value'];
function cleanBundles(raw) {
    let arr = raw;
    if (typeof raw === 'string') { try { arr = JSON.parse(raw); } catch (e) { arr = []; } }
    if (!Array.isArray(arr)) return [];
    const seen = new Set();
    const out = [];
    for (const b of arr) {
        const qty = Math.floor(Number(b && b.qty));
        const price = Math.round(Number(b && b.price) * 100) / 100;
        if (!(qty >= 2 && qty <= 100) || !(price > 0) || seen.has(qty)) continue;
        seen.add(qty);
        out.push({ qty, price, tag: BUNDLE_TAGS.includes(b.tag) ? b.tag : '' });
        if (out.length >= 6) break;
    }
    return out.sort((a, b) => a.qty - b.qty);
}
function productBundles(p) {
    const unit = parseFloat(p && p.price) || 0;
    return cleanBundles(p && p.bundles).filter(b => b.price < b.qty * unit).sort((a, b) => b.qty - a.qty);
}
function bundleDiscountFor(cartItems) {
    const qtyById = {};
    for (const item of cartItems) {
        const q = Math.max(1, Math.floor(parseFloat(item.quantity)) || 1);
        qtyById[item.id] = (qtyById[item.id] || 0) + q;
    }
    let discount = 0;
    for (const id of Object.keys(qtyById)) {
        const p = products.find(x => x.id === id);
        if (!p) continue;
        const unit = parseFloat(p.price) || 0;
        let rem = qtyById[id], bundled = 0;
        for (const t of productBundles(p)) {
            const n = Math.floor(rem / t.qty);
            if (n) { bundled += n * t.price; rem -= n * t.qty; }
        }
        discount += qtyById[id] * unit - (bundled + rem * unit);
    }
    return Math.round(discount * 100) / 100;
}

// Escape user-controlled text before it's interpolated into server-rendered
// HTML (receipts, emails) — mirrors escHtml() in storefront.js / escAdm() in
// admin.js. Item names/customer fields are never trusted verbatim here.
function escHtml(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Ghana-specific phone normalisation — mirrors normalisePhone() in storefront.js
// so a customer's checkout phone and their /track lookup phone compare equal
// regardless of whether they typed a leading 0 or the 233 country code.
function normalisePhone(p) {
    let d = String(p || '').replace(/\D/g, '');
    if (d.startsWith('0')) d = '233' + d.slice(1);
    else if (d && !d.startsWith('233')) d = '233' + d;
    return d || String(p || '');
}

const SEED_PRODUCTS = [];

const SEED_REVIEWS = [];

function loadJSON(file, seed) {
    try {
        if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (e) {
        // Corrupt file — back it up instead of silently overwriting
        console.error(`[loadJSON] Failed to parse ${file}: ${e.message}`);
        try { fs.copyFileSync(file, file + '.corrupt-' + Date.now()); } catch (_) {}
    }
    const data = seed ? JSON.parse(JSON.stringify(seed)) : [];
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
    return data;
}

function saveJSON(file, data) {
    // Write to a temp file in the same directory, then rename over the real
    // one — a rename onto an existing path is atomic on the filesystems this
    // runs on (same-volume NTFS/ext4/APFS), so a reader always sees either the
    // fully-old or fully-new file, never a half-written one. The previous
    // direct writeFileSync truncates the target before writing; a process kill
    // or restart (a Render redeploy sends SIGTERM) mid-write left a 0-byte or
    // partial file, which loadJSON's next boot then treats as corrupt and
    // replaces with an empty default — silently discarding every order/product/
    // etc. that file held.
    const tmp = file + '.tmp-' + process.pid + '-' + Date.now();
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, file);
}

function deductStock(cartItems) {
    let changed = false;
    const thresh = settings.stockAlertThreshold || 3;
    (cartItems || []).forEach(item => {
        const p = products.find(p => p.id === item.id);
        if (!p) return;
        const qty = parseInt(item.quantity, 10);
        if (!qty || qty <= 0) return; // skip zero/invalid quantities
        // Rich variant mode — always return here, never fall through to simple mode
        if (Array.isArray(p.variants) && p.variants.length && typeof p.variants[0] === 'object') {
            const v = item.color ? p.variants.find(v => v.color === item.color) : p.variants[0];
            if (v && typeof v.stock === 'number') {
                v.stock = Math.max(0, v.stock - qty);
                if (p.variantStock) p.variantStock[v.color] = v.stock;
                p.stock = p.variants.reduce((s, vv) => s + (vv.stock || 0), 0);
                if (p.stock === 0) p.isSoldOut = true;
                changed = true;
                if (settings.stockAlertEnabled && p.stock <= thresh) {
                    sendStockAlertEmail(p).catch(e => console.error('[STOCK ALERT]', e.message));
                }
            } else {
                console.warn(`[STOCK] deductStock: no matching variant "${item.color}" for "${p.name}" — skipped`);
            }
            return; // never touch simple stock pool for a rich-variant product
        }
        // Simple stock mode
        if (p.stock === null || p.stock === undefined) return;
        p.stock = Math.max(0, p.stock - qty);
        if (p.stock === 0) p.isSoldOut = true;
        changed = true;
        if (settings.stockAlertEnabled && p.stock <= thresh) {
            sendStockAlertEmail(p).catch(e => console.error('[STOCK ALERT]', e.message));
        }
    });
    if (changed) saveJSON(PRODUCTS_FILE, products);
}

// Inverse of deductStock — adds units back and logs the movement. Nothing
// called this before: a returned, refunded, or deleted order left its stock
// permanently deducted, so inventory silently shrank on every return even
// though the goods physically came back (or the sale never happened, for a
// deleted order). `reason`/`ref` identify which order caused the restoration
// in the stock-movement ledger.
function restoreStock(items, reason, ref) {
    let changed = false;
    (items || []).forEach(item => {
        const p = products.find(p => p.id === item.id);
        if (!p) return;
        const qty = parseInt(item.quantity, 10);
        if (!qty || qty <= 0) return;
        if (Array.isArray(p.variants) && p.variants.length && typeof p.variants[0] === 'object') {
            const v = item.color ? p.variants.find(v => v.color === item.color) : p.variants[0];
            if (v && typeof v.stock === 'number') {
                v.stock = v.stock + qty;
                if (p.variantStock) p.variantStock[v.color] = v.stock;
                p.stock = p.variants.reduce((s, vv) => s + (vv.stock || 0), 0);
                if (p.stock > 0) p.isSoldOut = false;
                changed = true;
                logMovement({ productId: p.id, productName: p.name, variant: item.color || null, qty, type: 'restore', reason, ref });
            }
            return;
        }
        if (p.stock === null || p.stock === undefined) return;
        p.stock = p.stock + qty;
        if (p.stock > 0) p.isSoldOut = false;
        changed = true;
        logMovement({ productId: p.id, productName: p.name, variant: null, qty, type: 'restore', reason, ref });
    });
    if (changed) saveJSON(PRODUCTS_FILE, products);
}

async function sendStockAlertEmail(product) {
    if (!GMAIL_USER || !GMAIL_PASS) return;
    const merged = { ...SETTINGS_DEFAULTS, ...settings };
    const targets = [STORE_EMAIL];
    if (merged.ownerEmail && merged.ownerEmail !== STORE_EMAIL) targets.push(merged.ownerEmail);
    const storeUrl = process.env.RENDER_EXTERNAL_URL || process.env.BASE_URL || '';
    const adminUrl = storeUrl ? storeUrl + '/admin.html' : '/admin.html';
    const waPhone  = merged.ownerPhone || merged.whatsapp || '';
    const waMsg    = encodeURIComponent(`⚠️ Low stock alert: ${product.name} has only ${product.stock} unit(s) left. Please restock.`);
    const waLink   = waPhone ? `https://wa.me/${waPhone.replace(/\D/g,'')}?text=${waMsg}` : null;
    const transporter = makeTransporter();
    await transporter.sendMail({
        from: `"${merged.storeName} Stock Alert" <${GMAIL_USER}>`,
        to: targets,
        subject: `⚠️ Low Stock: ${product.name} (${product.stock} left)`,
        html: `<div style="font-family:Helvetica,Arial,sans-serif;max-width:480px;margin:32px auto;background:#fff;border-radius:8px;padding:28px;border-left:4px solid #C9971C">
               <h2 style="margin:0 0 12px;color:#C9971C;font-size:16px">⚠️ Low Stock Alert</h2>
               <p style="margin:0 0 8px;font-size:14px;color:#1a1a1a"><strong>${product.name}</strong> is running low.</p>
               <p style="margin:0 0 16px;font-size:14px;color:#555">Current stock: <strong style="color:#C9971C">${product.stock} unit(s)</strong></p>
               <a href="${adminUrl}" style="display:inline-block;background:#C9971C;color:#fff;padding:10px 20px;border-radius:6px;font-size:13px;font-weight:700;text-decoration:none;margin-right:8px">Open Admin →</a>
               ${waLink?`<a href="${waLink}" style="display:inline-block;background:#25d366;color:#fff;padding:10px 20px;border-radius:6px;font-size:13px;font-weight:700;text-decoration:none">WhatsApp Alert</a>`:''}
               </div>`
    });
}

const SEED_CATEGORIES = [
    { name: 'Men',    enabled: true },
    { name: 'Women',  enabled: true },
    { name: 'Unisex', enabled: true },
];

let products     = loadJSON(PRODUCTS_FILE,   SEED_PRODUCTS);
// Migrate: existing products without isListed default to listed (true)
products.forEach(p => { if (p.isListed === undefined) p.isListed = true; });
let reviews      = loadJSON(REVIEWS_FILE,    SEED_REVIEWS);
let orders       = loadJSON(ORDERS_FILE,     []);
let codes        = loadJSON(CODES_FILE,      []);
let notifs       = loadJSON(NOTIFY_FILE,     []).map((n, i) => n.id ? n : { ...n, id: 'NOTIF-' + (n.createdAt || i) });
let delivery     = loadJSON(DELIVERY_FILE,   []);
let categories   = loadJSON(CATEGORIES_FILE, SEED_CATEGORIES);
let customers    = loadJSON(CUSTOMERS_FILE,    []);
const DEFAULT_ZONE_TIERS = { '1': { label: 'Zone 1', price: 0 }, '2': { label: 'Zone 2', price: 0 }, '3': { label: 'Zone 3', price: 0 }, '4': { label: 'Zone 4', price: 0 } };
const GH_REGIONS_LIST = ['Greater Accra','Ashanti','Western','Central','Eastern','Volta','Oti','Northern','Savannah','North East','Upper East','Upper West','Bono','Bono East','Ahafo','Western North'];
function zoneMapSeed() {
    const seed = {};
    GH_REGIONS_LIST.forEach(r => { seed[r] = { tiers: JSON.parse(JSON.stringify(DEFAULT_ZONE_TIERS)), areas: [] }; });
    return seed;
}
let zoneMap = loadJSON(ZONE_MAP_FILE, zoneMapSeed());
// Migrate old flat structure if needed — only trigger when ALL known-good region keys are absent
if (!GH_REGIONS_LIST.some(r => zoneMap[r]) && zoneMap.tiers && zoneMap.areas) {
    const migrated = zoneMapSeed();
    migrated['Greater Accra'] = { tiers: zoneMap.tiers, areas: zoneMap.areas };
    zoneMap = migrated;
    saveJSON(ZONE_MAP_FILE, zoneMap);
}
// Ensure all regions exist (safe to run on every start)
GH_REGIONS_LIST.forEach(r => { if (!zoneMap[r]) zoneMap[r] = { tiers: JSON.parse(JSON.stringify(DEFAULT_ZONE_TIERS)), areas: [] }; });
let wishlists      = loadJSON(WISHLIST_FILE,       {});
let pwdResets      = loadJSON(PWD_RESET_FILE,     []).filter(r => r.expires > Date.now());
let revokedTokens  = new Set(loadJSON(REVOKED_TOKENS_FILE, []).filter(t => t.exp > Date.now() / 1000).map(t => t.jti));
let emailVerify    = loadJSON(EMAIL_VERIFY_FILE,  []).filter(r => r.expires > Date.now());
// Flush expired entries to disk so files don't grow unboundedly
saveJSON(PWD_RESET_FILE, pwdResets);
saveJSON(EMAIL_VERIFY_FILE, emailVerify);
// Admin accounts — owner account always seeded from env vars
let adminAccounts  = loadJSON(ADMIN_ACCOUNTS_FILE, []);
(async () => {
    // Ensure owner account from env always exists and is up to date
    const ownerIdx = adminAccounts.findIndex(a => a.username === ADMIN_USER);
    const ownerHash = ownerIdx >= 0 ? adminAccounts[ownerIdx].passwordHash : await bcrypt.hash(ADMIN_PASS, 10);
    const owner = { id: 'admin-owner', username: ADMIN_USER, name: 'Owner', role: 'owner', passwordHash: ownerHash, createdAt: new Date().toISOString() };
    if (ownerIdx >= 0) adminAccounts[ownerIdx] = { ...adminAccounts[ownerIdx], username: ADMIN_USER, role: 'owner' };
    else adminAccounts.unshift(owner);
    saveJSON(ADMIN_ACCOUNTS_FILE, adminAccounts);
})();
// Product events — keep last 90 days, max 50k entries
const EVENT_TTL = 90 * 24 * 60 * 60 * 1000;
let productEvents  = loadJSON(PRODUCT_EVENTS_FILE, []).filter(e => Date.now() - e.ts < EVENT_TTL);

// Debounced save for high-frequency events
let _evtSaveTimer = null;
function saveEvents() {
    clearTimeout(_evtSaveTimer);
    _evtSaveTimer = setTimeout(() => saveJSON(PRODUCT_EVENTS_FILE, productEvents.slice(-50000)), 2000);
}

// ── IMAGE OPTIMISATION ─────────────────────────────────────────────────────
async function optimiseImage(filePath) {
    try {
        const info = await sharp(filePath).metadata();
        // Skip unsupported formats that sharp can't convert cleanly
        if (['gif', 'svg'].includes(info.format)) return filePath;
        // Skip if already small enough
        const stat = fs.statSync(filePath);
        if (stat.size < 150 * 1024 && info.width <= 1200) return filePath;
        const destPath = filePath.replace(/\.[^.]+$/, '.webp');
        // Use a temp file to avoid self-overwrite when source is already .webp
        const tmpPath = filePath + '.tmp.webp';
        await sharp(filePath)
            .resize({ width: 1200, height: 1200, fit: 'inside', withoutEnlargement: true })
            .webp({ quality: 82 })
            .toFile(tmpPath);
        // Only delete original if it differs from destination
        if (filePath !== destPath) fs.unlinkSync(filePath);
        else fs.unlinkSync(filePath); // same path (.webp source) — unlink then rename
        fs.renameSync(tmpPath, destPath);
        return destPath;
    } catch(e) {
        console.error('[IMAGE OPT]', e.message);
        return filePath; // keep original on error
    }
}

// ── RATE LIMITER ───────────────────────────────────────────────────────────
const _rateBuckets = new Map(); // key → [timestamps]
function rateLimit(key, maxHits = 5, windowMs = 60000) {
    const now = Date.now();
    const hits = (_rateBuckets.get(key) || []).filter(t => now - t < windowMs);
    hits.push(now);
    _rateBuckets.set(key, hits);
    return hits.length > maxHits;
}
// Garbage-collect abandoned buckets every 5 minutes. This must NOT trim the
// timestamps inside a live bucket to some fixed window — rateLimit() already
// filters each bucket by its OWN caller-specified windowMs on every check
// (line above). Truncating here too, on a shorter fixed window, silently
// defeated every rate limit configured with a window longer than that
// (e.g. the hourly notify/track/verify-email limits reset every 2 minutes).
// The longest window in use today is 1 hour, so 2 hours is a safe margin for
// "this key is stale and can be forgotten" without ever touching a live one.
const RATE_BUCKET_MAX_AGE = 2 * 60 * 60 * 1000;
setInterval(() => {
    const now = Date.now();
    _rateBuckets.forEach((hits, key) => {
        if (!hits.length || now - hits[hits.length - 1] > RATE_BUCKET_MAX_AGE) _rateBuckets.delete(key);
    });
}, 5 * 60 * 1000);
const REGION_RATES_SEED = Object.fromEntries(GH_REGIONS_LIST.map(r => [r, { price: 0, enabled: false }]));
let regionRates  = { ...REGION_RATES_SEED, ...loadJSON(REGION_RATES_FILE, {}) };
const SETTINGS_DEFAULTS = {
    storeName:        'Freeman Outlet',
    announcement:     '💬 No online payment — every order is confirmed with you personally on WhatsApp!',
    announcementOn:   true,
    whatsapp:         '',
    instagram:        '',
    facebook:         '',
    tiktok:           '',
    snapchat:         '',
    storeEmail:       '',
    invoiceAccountName: '',
    invoiceAccountNo:   '',
    invoiceTin:         '',
    shopOpen:         true,
    shopClosedMsg:    'We\'re temporarily closed. Check back soon!',
    heroPill:         'Freeman Outlet · Ghana',
    heroHeadline:     'Everyday Basics <span>Built To Last</span><br>At Outlet Prices',
    heroSub:          'Fruit of the Loom undershirts, boxers, unisex socks & ladies\' panties — genuine stock, honest prices, delivered anywhere in Ghana.',
    aboutHeading:     'Quality Basics, <span>Honest Prices</span>',
    aboutBody:        'Freeman Outlet is a Ghanaian-based outlet store bringing genuine Fruit of the Loom undershirts, boxers, unisex socks and ladies\' panties to your doorstep at honest, outlet prices.\n\nEvery item we sell is 100% authentic — no fakes, no knock-offs. We buy in bulk so we can pass the savings straight to you, without cutting corners on quality.\n\nWhether you\'re restocking your everyday essentials or shopping for the family, we\'ve got sizes and packs to match — delivered fresh, anywhere in Ghana.',
    footerTagline:    'Everyday Basics. Built To Last. Outlet Prices.',
    trustLine1:       '<strong>Nationwide delivery</strong> across Ghana',
    trustLine2:       'Free delivery in <strong>Accra</strong> on orders over <strong>GH₵200</strong>',
    trustLine3:       '<strong>Order easily</strong> via WhatsApp',
    trustLine4:       '<strong>Fast replies</strong> on WhatsApp',
    freeDeliveryThreshold: 200,
    freeDeliveryZone:      'Accra',
    featuredBannerEnabled:  false,
    featuredBannerHeadline: 'New Stock Just Landed',
    featuredBannerSub:      'Explore our latest arrivals and restocks.',
    featuredBannerCta:      'Shop Now',
    featuredBannerLink:     '#products',
    saleEnabled:  false,
    saleEndDate:  '',
    saleMessage:  '🔥 Flash Sale ends in',
    brandVideoUrl:   '',
    brandVideoTitle: 'Our Story',
    heroVideoEnabled: false,
    seoTitle:        'Freeman Outlet – Everyday Basics At Outlet Prices',
    seoDescription:  'Freeman Outlet, Ghana — Shop genuine Fruit of the Loom undershirts, boxers, unisex socks & ladies\' panties at outlet prices. Delivered anywhere in Ghana.',
    accentColor:     '#C9971C',
    fontBody:        'Jost',
    stockAlertEnabled:   false,
    stockAlertThreshold: 3,
    minOrderAmount:      0,
    ownerEmail:          '',
    ownerPhone:          '',
    backupEnabled:       true
};
// Merge saved file with defaults so new keys are always present
let settings = { ...SETTINGS_DEFAULTS, ...loadJSON(SETTINGS_FILE, SETTINGS_DEFAULTS) };

const SEED_FAQS = [
    { id: 'faq-1', q: 'How do I place an order?', a: 'Browse the shop and add items to your cart. When you\'re ready, go to checkout and send your order straight to us on WhatsApp with one tap — we\'ll confirm pricing, delivery and payment with you there.' },
    { id: 'faq-2', q: 'What payment methods do you accept?', a: 'We arrange payment directly with you on WhatsApp — cash on delivery, mobile money (MTN, Vodafone, AirtelTigo) or bank transfer, whichever works best for you.' },
    { id: 'faq-3', q: 'How long does delivery take?', a: 'Accra deliveries take 1–2 business days. Greater Accra suburbs 1–3 days. All other regions across Ghana 3–5 business days. You\'ll get a WhatsApp message when your order is dispatched.' },
    { id: 'faq-4', q: 'Are your products genuine Fruit of the Loom?', a: 'Yes — every item we sell is 100% authentic Fruit of the Loom, sourced directly. If anything ever arrives damaged or not as described, message us on WhatsApp and we\'ll sort it out right away.' },
    { id: 'faq-5', q: 'Can I order if I\'m outside Ghana?', a: 'We currently deliver within Ghana only. If you\'re in the diaspora and want to send basics to someone in Ghana, we can absolutely help — message us on WhatsApp.' },
    { id: 'faq-6', q: 'What if an item is sold out?', a: 'Click "Notify Me" on any sold-out product and enter your name and contact. We\'ll reach out the moment it\'s back in stock. You can also WhatsApp us to ask about restock timelines.' }
];
let faqs      = loadJSON(FAQS_FILE,      SEED_FAQS);
let intakes         = loadJSON(INTAKES_FILE,   []);
let abandonedCarts  = loadJSON(ABANDONED_FILE, []);
let movements = loadJSON(MOVEMENTS_FILE, []);
let invMeta   = loadJSON(INV_META_FILE,  {});

// Single source of truth for a product's per-unit cost — must match
// calcInvCost() in admin.js's Cost & Pricing tab exactly (same formula, same
// term-by-term reasoning lives there). Previously this formula was duplicated
// inline here AND in the /api/analytics COGS calculation, with the analytics
// copy having drifted to just `actualCost` (missing growth margin and
// shipping/transport/other expenses entirely) — the two admin screens showed
// different profit numbers for the same product as a result.
function calcInvCost(m) {
    const actual = parseFloat(m.actualCost) || 0;
    const growth = parseFloat(m.growthMargin) || 0;
    const ship   = (parseFloat(m.shippingTotal) || 0) / Math.max(parseInt(m.shippingUnits) || 1, 1);
    const tran   = (parseFloat(m.transportTotal) || 0) / Math.max(parseInt(m.transportUnits) || 1, 1);
    const other  = (m.otherExpenses || []).reduce((s, e) => s + (parseFloat(e.amount) || 0), 0);
    return actual * (1 + growth / 100) + ship + tran + other;
}

// Recalculate stored price for all inv-meta entries using the formula above.
(function migrateInvMetaPrices() {
    let changed = false;
    Object.keys(invMeta).forEach(id => {
        const m = invMeta[id];
        const newPrice = calcInvCost(m);
        if (Math.abs((m.price || 0) - newPrice) > 0.0001) {
            invMeta[id] = { ...m, price: newPrice };
            changed = true;
        }
    });
    if (changed) saveJSON(INV_META_FILE, invMeta);
})();

// ── AUTH ───────────────────────────────────────────────────────────────────
function requireCustomer(req, res, next) {
    const auth = req.headers['authorization'];
    if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ error: 'Sign in required' });
    try {
        const payload = jwt.verify(auth.slice(7), JWT_SECRET);
        if (payload.jti && revokedTokens.has(payload.jti))
            return res.status(401).json({ error: 'Session has been signed out. Please sign in again.' });
        req.customerId    = payload.customerId;
        req.customerEmail = payload.email;
        next();
    } catch(e) {
        res.status(401).json({ error: 'Session expired — please sign in again' });
    }
}

function safeCompare(a, b) {
    // Constant-time string comparison to prevent timing attacks
    const ba = Buffer.from(String(a)), bb = Buffer.from(String(b));
    const len = Math.max(ba.length, bb.length);
    const pa = Buffer.alloc(len), pb = Buffer.alloc(len);
    ba.copy(pa); bb.copy(pb);
    return crypto.timingSafeEqual(pa, pb) && a.length === b.length;
}

// Role-based access helpers
function requireOwner(req, res, next) {
    if (req.adminRole !== 'owner') return res.status(403).json({ success: false, message: 'Owner access required.' });
    next();
}
function requireManagerOrOwner(req, res, next) {
    if (req.adminRole !== 'owner' && req.adminRole !== 'manager') return res.status(403).json({ success: false, message: 'Manager or owner access required.' });
    next();
}
function requireManager(req, res, next) {
    if (!['owner', 'manager'].includes(req.adminRole)) return res.status(403).json({ success: false, message: 'Manager access required.' });
    next();
}

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// Serve modular src/ assets. /assets is intentionally NOT mounted here — it's
// mounted once, further down, with its real cache/CORS config; a duplicate
// unconfigured mount used to sit at this exact path and (being registered
// first) silently won on every request, making that later config dead code.
//
// /js and /styles get 'no-cache' rather than a long max-age: unlike images,
// these are actively-edited source files during development, and a long
// heuristic cache (the default when no Cache-Control is set at all — which
// was the bug here before) made a just-saved change invisible in an
// already-open browser tab until a manual hard-refresh. 'no-cache' still
// revalidates via ETag/Last-Modified (cheap 304s when unchanged) — it does
// not disable caching outright, it just stops the browser from skipping the
// revalidation check.
app.use('/styles',     express.static(path.join(__dirname, 'src', 'styles'), { setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache') }));
app.use('/js',         express.static(path.join(__dirname, 'src', 'js'),     { setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache') }));
app.use('/components', express.static(path.join(__dirname, 'src', 'components')));

// Explicit page routes (admin protected at route level)
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'src', 'pages', 'index.html')));
// admin.html is now public — login form inside handles auth
app.get('/admin.html', (req, res) => res.sendFile(path.join(__dirname, 'src', 'pages', 'admin.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'src', 'pages', 'admin.html')));
app.get('/track', (req, res) => res.sendFile(path.join(__dirname, 'public', 'track.html')));

// public/index.html is a stale duplicate of src/pages/index.html (the real homepage, served at '/').
// Without this, express.static('public') below would still serve the stale copy at this exact URL,
// showing visitors a broken, out-of-date version of the site. (public/admin.html is already shadowed
// by the explicit '/admin.html' route above, so it needs no extra handling here.)
app.get('/index.html', (req, res) => res.redirect(301, '/'));

// Static files — long cache for assets, short for HTML
app.use('/assets', express.static(path.join(__dirname, 'src', 'assets'), {
    maxAge: '30d', setHeaders: (res) => res.setHeader('Access-Control-Allow-Origin', '*')
}));
app.use(express.static('public', {
    setHeaders: (res, filePath) => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        // Cache JS/CSS/images for 7 days; HTML for 5 minutes
        if (/\.(js|css|png|jpg|jpeg|webp|svg|ico|woff2?)$/i.test(filePath)) {
            res.setHeader('Cache-Control', 'public, max-age=604800, stale-while-revalidate=86400');
        } else {
            res.setHeader('Cache-Control', 'public, max-age=300');
        }
    }
}));
app.use('/uploads', express.static(UPLOADS_DIR, {
    maxAge: '7d',
    setHeaders: (res) => res.setHeader('Cache-Control', 'public, max-age=604800')
}));

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOADS_DIR),
    filename: (req, file, cb) => cb(null, Date.now() + '-' + Math.random().toString(36).slice(2,7) + path.extname(file.originalname))
});
const upload = multer({
    storage,
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (!file.mimetype.startsWith('image/')) return cb(new Error('Image files only.'));
        cb(null, true);
    }
});

const SITE_IMAGE_SLOTS = {
    hero:    { dir: '',        file: 'hero.jpg',    label: 'Hero Slide 1' },
    slide2:  { dir: 'gallery', file: 'photo1.jpg',  label: 'Hero Slide 2' },
    slide3:  { dir: 'gallery', file: 'photo2.jpg',  label: 'Hero Slide 3' },
    banner:  { dir: '',        file: 'banner.jpg',  label: 'Featured Banner Image' },
    about:   { dir: '',        file: 'about.jpg',   label: 'About / Story Image' },
    logo:    { dir: '',        file: 'logo.png',    label: 'Logo' },
    polar1:  { dir: 'gallery', file: 'polar1.jpg',  label: 'Gallery Photo 1' },
    polar2:  { dir: 'gallery', file: 'polar2.jpg',  label: 'Gallery Photo 2' },
    polar3:  { dir: 'gallery', file: 'polar3.jpg',  label: 'Gallery Photo 3' },
    polar4:  { dir: 'gallery', file: 'polar4.jpg',  label: 'Gallery Photo 4' },
    polar5:  { dir: 'gallery', file: 'polar5.jpg',  label: 'Gallery Photo 5' },
    polar6:  { dir: 'gallery', file: 'polar6.jpg',  label: 'Gallery Photo 6' },
    polar7:  { dir: 'gallery', file: 'polar7.jpg',  label: 'Gallery Photo 7' },
    polar8:  { dir: 'gallery', file: 'polar8.jpg',  label: 'Gallery Photo 8' },
    polar9:  { dir: 'gallery', file: 'polar9.jpg',  label: 'Gallery Photo 9' },
};

const siteImageUpload = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => {
            const slot = SITE_IMAGE_SLOTS[req.params.slot];
            const dir = slot && slot.dir
                ? path.join(__dirname, 'src', 'assets', 'images', slot.dir)
                : path.join(__dirname, 'src', 'assets', 'images');
            fs.mkdirSync(dir, { recursive: true });
            cb(null, dir);
        },
        filename: (req, file, cb) => {
            const slot = SITE_IMAGE_SLOTS[req.params.slot];
            if (!slot) return cb(new Error('Invalid slot'));
            cb(null, slot.file);
        }
    }),
    fileFilter: (req, file, cb) => {
        if (!SITE_IMAGE_SLOTS[req.params.slot]) return cb(new Error('Invalid slot'));
        cb(null, true);
    }
});

app.post('/api/site-images/:slot', requireAdminJWT, (req, res, next) => {
    if (!SITE_IMAGE_SLOTS[req.params.slot]) return res.status(400).json({ success: false, message: 'Unknown slot.' });
    siteImageUpload.single('image')(req, res, err => {
        if (err) return res.status(400).json({ success: false, message: err.message });
        if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded.' });
        const slot = SITE_IMAGE_SLOTS[req.params.slot];
        const imagePath = slot.dir ? `/assets/images/${slot.dir}/${slot.file}` : `/assets/images/${slot.file}`;
        res.json({ success: true, path: imagePath });
    });
});

const heroVideoUpload = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => cb(null, path.join(__dirname, 'src', 'assets', 'images')),
        filename:    (req, file, cb) => cb(null, 'hero-video.mp4')
    }),
    fileFilter: (req, file, cb) => {
        if (!file.mimetype.startsWith('video/')) return cb(new Error('Video files only.'));
        cb(null, true);
    },
    limits: { fileSize: 80 * 1024 * 1024 }
});

app.post('/api/site-video/hero', requireAdminJWT, (req, res) => {
    heroVideoUpload.single('video')(req, res, err => {
        if (err) return res.status(400).json({ success: false, message: err.message });
        if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded.' });
        res.json({ success: true, path: '/assets/images/hero-video.mp4' });
    });
});

const uploadProduct = upload.fields([
    { name: 'productImage',   maxCount: 1 },
    { name: 'productImage2',  maxCount: 1 },
    { name: 'productImage3',  maxCount: 1 },
    { name: 'productImage4',  maxCount: 1 },
    { name: 'variantImage_0', maxCount: 1 },
    { name: 'variantImage_1', maxCount: 1 },
    { name: 'variantImage_2', maxCount: 1 },
    { name: 'variantImage_3', maxCount: 1 },
    { name: 'variantImage_4', maxCount: 1 },
    { name: 'variantImage_5', maxCount: 1 },
]);

// ── PRODUCTS ───────────────────────────────────────────────────────────────

// GET: All products — strip internal fields before sending to storefront
const PUBLIC_PRODUCT_FIELDS = ['id','name','price','originalPrice','category','desc','image','images','variants','sizes','stock','variantStock','isSoldOut','featured','createdAt','updatedAt','bundles','fitNotes','careNotes'];
app.get('/api/products', (req, res) => {
    const pub = products
        .filter(p => p.isListed !== false)
        .map(p => Object.fromEntries(PUBLIC_PRODUCT_FIELDS.filter(k => k in p).map(k => [k, p[k]])));
    res.json(pub);
});

// GET: Admin — all products including unlisted, with isListed field
app.get('/api/admin/all-products', requireAdminJWT, (req, res) => {
    res.json(products.map(p => ({ ...p, isListed: p.isListed !== false })));
});

// GET: New arrivals — most recently added products (same public field whitelist as /api/products)
app.get('/api/new-arrivals', (req, res) => {
    const arrivals = [...products]
        .filter(p => p.isListed !== false && !p.isSoldOut)
        .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
        .slice(0, 12)
        .map(p => Object.fromEntries(PUBLIC_PRODUCT_FIELDS.filter(k => k in p).map(k => [k, p[k]])));
    res.json(arrivals);
});

// Helper — optimise all uploaded files in a request and return URL paths
async function optimiseUploadedFiles(files, fields) {
    const results = [];
    for (const field of fields) {
        const f = files && files[field] && files[field][0];
        if (!f) continue;
        const originalPath = f.path || path.join(UPLOADS_DIR, f.filename);
        const optimised = await optimiseImage(originalPath).catch(() => originalPath);
        const filename = path.basename(optimised || originalPath);
        results.push(`/uploads/${filename}`);
    }
    return results;
}

// POST: Add product
app.post('/api/products', requireAdminJWT, uploadProduct, async (req, res) => {
    const { name, price, originalPrice, category, desc, variants, sizes, stock, isSoldOut, bundlesJson, fitNotes, careNotes } = req.body;
    const DEFAULT_IMG = "https://images.unsplash.com/photo-1581091226825-a6a2a5aee158?w=500";

    const uploadedImages = await optimiseUploadedFiles(req.files, ['productImage','productImage2','productImage3','productImage4']);

    const images   = uploadedImages.length ? uploadedImages : [DEFAULT_IMG];
    const imageUrl = images[0];

    const variantArray = variants ? variants.split(',').map(i => i.trim()).filter(Boolean) : [];
    const sizeArray    = sizes    ? sizes.split(',').map(i => i.trim()).filter(Boolean) : [];

    const cleanPrice = parseFloat(price);
    const cleanOrig  = parseFloat(originalPrice);
    const storedOrig = (!isNaN(cleanOrig) && !isNaN(cleanPrice) && cleanOrig > cleanPrice)
        ? String(cleanOrig) : "";

    if (name && price) {
        products.push({
            id: Date.now().toString(),
            name,
            price: String(cleanPrice),
            originalPrice: storedOrig,
            category: category || "",
            desc,
            fitNotes: String(fitNotes || '').slice(0, 1000),
            careNotes: String(careNotes || '').slice(0, 1000),
            bundles: cleanBundles(bundlesJson),
            image: imageUrl,
            images,
            variants: variantArray,
            sizes: sizeArray,
            stock: stock !== undefined && stock !== '' ? parseInt(stock, 10) : null,
            isSoldOut: isSoldOut === 'true',
            isListed: true,
            createdAt: Date.now(),
            createdBy: req.adminUsername || 'admin'
        });
        saveJSON(PRODUCTS_FILE, products);
        const newProduct = products[products.length - 1];
        // Return JSON for AJAX calls, redirect for legacy form submissions
        if (req.headers['authorization'] || req.headers['accept']?.includes('application/json')) {
            res.json({ success: true, product: newProduct });
        } else {
            res.redirect('/admin.html?success=true');
        }
    } else {
        res.status(400).json({ success: false, message: 'Name and price are required.' });
    }
});

// ── PRODUCT SORT ORDER (must be before /:id to avoid route shadowing) ───────
app.put('/api/products/sort-order', requireAdminJWT, (req, res) => {
    const { orderedIds } = req.body;
    if (!Array.isArray(orderedIds)) return res.status(400).json({ success: false, message: 'orderedIds array required.' });
    const idSet = new Set(orderedIds);
    const sorted = orderedIds.map(id => products.find(p => p.id === id)).filter(Boolean);
    const rest   = products.filter(p => !idSet.has(p.id));
    products = [...sorted, ...rest];
    saveJSON(PRODUCTS_FILE, products);
    res.json({ success: true });
});

// PUT: Update product
app.put('/api/products/:id', requireAdminJWT, uploadProduct, async (req, res) => {
    const { id } = req.params;
    const { name, price, originalPrice, category, desc, variants, sizes, stock, isSoldOut, bundlesJson, fitNotes, careNotes } = req.body;

    const idx = products.findIndex(p => p.id === id);
    if (idx === -1) return res.status(404).json({ success: false, message: "Product not found" });
    // Captured once, up front — every mutation below goes through this object
    // reference instead of re-indexing via `idx`. This handler awaits sharp
    // image processing further down (can take hundreds of ms), during which a
    // concurrent request can reorder/splice the shared `products` array (sort-
    // order change, a delete, a bulk action). A cached index can then point at
    // a completely different product when this handler resumes, silently
    // applying this edit's history/fields onto the wrong record — a reference
    // survives the array being reordered around it; an index does not.
    const product = products[idx];

    // Conflict detection — if client sent expectedUpdatedAt and it doesn't match, another admin edited first
    const { expectedUpdatedAt } = req.body;
    if (expectedUpdatedAt && product.updatedAt && Number(expectedUpdatedAt) !== product.updatedAt) {
        return res.status(409).json({
            success: false,
            conflict: true,
            message: `This product was edited by "${product.lastEditedBy || 'another admin'}" since you opened it. Reload to see their changes before saving yours.`,
            currentUpdatedAt: product.updatedAt,
            currentEditedBy: product.lastEditedBy || ''
        });
    }

    // Snapshot before changes for history
    const snapVariants = variantColors(product.variants).join(', ');
    const snap = {
        name:          product.name,
        price:         product.price,
        originalPrice: product.originalPrice || '',
        category:      product.category || '',
        desc:          product.desc || '',
        isSoldOut:     String(product.isSoldOut),
        stock:         String(product.stock ?? ''),
        variants:      snapVariants,
        sizes:         (product.sizes || []).join(', ')
    };

    if (name) product.name = name;
    if (price) {
        const cp = parseFloat(price);
        if (!isNaN(cp)) product.price = String(cp);
    }
    if (originalPrice !== undefined) {
        const co = parseFloat(originalPrice);
        const cp = parseFloat(product.price);
        product.originalPrice = (!isNaN(co) && !isNaN(cp) && co > cp) ? String(co) : "";
    }
    if (category !== undefined) product.category = category;
    if (desc !== undefined) product.desc = desc;
    if (fitNotes !== undefined)  product.fitNotes  = String(fitNotes).slice(0, 1000);
    if (careNotes !== undefined) product.careNotes = String(careNotes).slice(0, 1000);
    if (bundlesJson !== undefined) product.bundles = cleanBundles(bundlesJson);
    if (isSoldOut !== undefined) product.isSoldOut = (isSoldOut === true || isSoldOut === 'true');
    if (req.body.isListed !== undefined) product.isListed = (req.body.isListed === true || req.body.isListed === 'true');
    if (variants !== undefined) product.variants = variants.split(',').map(i => i.trim()).filter(Boolean);
    if (sizes !== undefined) product.sizes = sizes.split(',').map(i => i.trim()).filter(Boolean);
    if (stock !== undefined) {
        const newStock = (stock === null || stock === '') ? null : parseInt(stock, 10);
        if (newStock !== null && isNaN(newStock)) return res.status(400).json({ success: false, message: 'Invalid stock value.' });
        product.stock = newStock;
        // Stock always overrides the sold-out flag — adding stock clears sold out, zeroing stock sets it
        if (newStock !== null) {
            if (newStock === 0) product.isSoldOut = true;
            else if (newStock > 0) product.isSoldOut = false;
        }
    }
    // Rich variant mode (variantsJson sent by variant builder)
    let newUploads = [];
    if (req.body.variantsJson) {
        try {
            const vmeta = JSON.parse(req.body.variantsJson);
            const richVariants = await Promise.all(vmeta.map(async (v, i) => {
                const f = req.files && req.files[`variantImage_${i}`];
                let img = v.existingImage || '';
                if (f && f[0]) {
                    const optPath = await optimiseImage(f[0].path || path.join(UPLOADS_DIR, f[0].filename)).catch(() => null);
                    img = `/uploads/${path.basename(optPath || f[0].filename)}`;
                }
                const parsedStock = parseInt(v.stock, 10);
                const variantSizes = Array.isArray(v.sizes) ? v.sizes.filter(s => s && s.trim()) : [];
                return { color: v.color || '', family: v.family || '', image: img, stock: isNaN(parsedStock) ? 0 : parsedStock, sizes: variantSizes };
            }));
            const filteredVariants = richVariants.filter(v => v.color);
            product.variants = filteredVariants;
            const totalStock = filteredVariants.reduce((s, v) => s + v.stock, 0);
            product.stock = totalStock;
            product.isSoldOut = totalStock === 0;
            product.variantStock = {};
            filteredVariants.forEach(v => { product.variantStock[v.color] = v.stock; });
            // Rebuild aggregate sizes as union of all variant sizes (for size filter on shop page)
            const allVariantSizes = [...new Set(filteredVariants.flatMap(v => v.sizes || []))];
            if (allVariantSizes.length) product.sizes = allVariantSizes;
            const allImgs = filteredVariants.map(v => v.image).filter(Boolean);
            if (allImgs.length) { product.images = allImgs; product.image = allImgs[0]; }
        } catch(e) { /* malformed JSON — skip */ }
    } else {
        // Simple mode — use classic image fields (optimised)
        newUploads = await optimiseUploadedFiles(req.files, ['productImage','productImage2','productImage3','productImage4']);
        if (newUploads.length) {
            product.images = newUploads;
            product.image  = newUploads[0];
        }
    }

    // Build diff and append history entry
    const FIELD_LABELS = {
        name: 'Name', price: 'Price (GHS)', originalPrice: 'Was Price (GHS)',
        category: 'Category', desc: 'Description', isSoldOut: 'Sold Out',
        stock: 'Stock', variants: 'Colours', sizes: 'Sizes'
    };
    const after = {
        name:          product.name,
        price:         product.price,
        originalPrice: product.originalPrice || '',
        category:      product.category || '',
        desc:          product.desc || '',
        isSoldOut:     String(product.isSoldOut),
        stock:         String(product.stock ?? ''),
        variants:      variantColors(product.variants).join(', '),
        sizes:         (product.sizes || []).join(', ')
    };
    const changes = Object.keys(snap)
        .filter(k => snap[k] !== after[k])
        .map(k => ({ field: k, label: FIELD_LABELS[k], from: snap[k], to: after[k] }));
    if (newUploads.length) changes.push({ field: 'images', label: 'Images', from: '', to: newUploads.join(', ') });

    const now = Date.now();
    product.updatedAt = now;
    product.lastEditedBy = req.adminUsername || req.adminUser?.username || 'admin';
    if (changes.length) {
        if (!product.history) product.history = [];
        product.history.push({ timestamp: now, changes, editedBy: product.lastEditedBy });
    }

    saveJSON(PRODUCTS_FILE, products);

    // Restock no longer auto-emails the notify list — that flow is WhatsApp-only
    // by design now (admin sends each "Notify Me" entry manually from the
    // Notify tab, see /api/notify/:id/send). The old auto-email path is removed
    // below rather than "fixed", since re-wiring it to send email again would
    // contradict the storefront's own promise ("We'll message you on WhatsApp")
    // and it was already effectively dead (new notify entries carry no email).

    res.json({ success: true, updatedProduct: product });
});

// DELETE: Remove product
app.delete('/api/products/:id', requireAdminJWT, requireManagerOrOwner, (req, res) => {
    products = products.filter(p => p.id !== req.params.id);
    saveJSON(PRODUCTS_FILE, products);
    res.json({ success: true, message: "Product deleted" });
});

// POST: Add product via JSON (for inventory app — main POST redirects to HTML)
app.post('/api/admin/products', requireAdminJWT, (req, res) => {
    const { name, price, category, stock, isSoldOut, isListed } = req.body;
    if (!name || price === undefined) return res.status(400).json({ success: false, message: 'Name and price are required.' });
    const cleanPrice = parseFloat(price);
    if (isNaN(cleanPrice)) return res.status(400).json({ success: false, message: 'Invalid price.' });
    const newProd = {
        id: Date.now().toString(),
        name,
        price: String(cleanPrice),
        originalPrice: '',
        category: category || '',
        desc: '',
        image: '',
        images: [],
        variants: [],
        sizes: [],
        stock: stock !== undefined && stock !== null && stock !== '' ? parseInt(stock) : null,
        isSoldOut: isSoldOut === true || isSoldOut === 'true',
        isListed: isListed !== undefined ? (isListed === true || isListed === 'true') : true,
        createdAt: Date.now()
    };
    products.push(newProd);
    saveJSON(PRODUCTS_FILE, products);
    res.json({ success: true, product: newProd });
});

// PATCH: Toggle listed/unlisted
app.patch('/api/products/:id/listed', requireAdminJWT, (req, res) => {
    const prod = products.find(p => p.id === req.params.id);
    if (!prod) return res.status(404).json({ success: false, message: 'Product not found.' });
    prod.isListed = req.body.isListed === true || req.body.isListed === 'true';
    prod.lastEditedBy = req.adminUsername || 'admin';
    prod.updatedAt = Date.now();
    saveJSON(PRODUCTS_FILE, products);
    res.json({ success: true, isListed: prod.isListed });
});

// PATCH: Quick stock update
app.patch('/api/products/:id/stock', requireAdminJWT, (req, res) => {
    const prod = products.find(p => p.id === req.params.id);
    if (!prod) return res.status(404).json({ success: false, message: 'Product not found.' });
    const { stock, isSoldOut, reason } = req.body;
    const prevStock = prod.stock;
    if (stock !== undefined) prod.stock = stock === null || stock === '' ? null : parseInt(stock);
    if (isSoldOut !== undefined) prod.isSoldOut = !!isSoldOut;
    if (prod.stock === null) prod.isSoldOut = false;         // null = unlimited stock, never sold out
    else if (prod.stock === 0) prod.isSoldOut = true;
    else if (prod.stock > 0) prod.isSoldOut = false;
    prod.updatedAt = Date.now();
    prod.lastEditedBy = req.adminUsername || 'admin';
    saveJSON(PRODUCTS_FILE, products);
    if (stock !== undefined && prod.stock !== null && prevStock !== null && prod.stock !== prevStock) {
        logMovement({ productId: prod.id, productName: prod.name, variant: null, qty: prod.stock - (prevStock || 0), type: 'adjustment', reason: reason || 'Manual edit', ref: null, editedBy: req.adminUsername || 'admin' });
    }
    res.json({ success: true, product: prod });
});

function validateCartStock(cartItems) {
    for (const i of (cartItems || [])) {
        const p = products.find(p => p.id === i.id);
        if (!p) continue;
        if (p.isListed === false) return `"${p.name}" is no longer available.`;
        const qty = parseInt(i.quantity, 10) || 1;
        const isRichVariant = Array.isArray(p.variants) && p.variants.length && typeof p.variants[0] === 'object';
        if (isRichVariant) {
            if (p.isSoldOut) return `"${p.name}" is sold out and cannot be ordered.`;
            if (i.color) {
                const v = p.variants.find(v => v.color === i.color);
                if (!v) return `Colour "${i.color}" is no longer available for "${p.name}".`;
                // Per-variant size check — only enforced when the variant has its own sizes list
                if (i.size && Array.isArray(v.sizes) && v.sizes.length) {
                    if (!v.sizes.includes(i.size)) return `Size "${i.size}" is not available in ${i.color} for "${p.name}".`;
                }
                const vStock = parseInt(v.stock, 10);
                if (!isNaN(vStock)) {
                    if (vStock === 0) return `"${p.name}" (${i.color}) is out of stock.`;
                    if (qty > vStock) return `Only ${vStock} unit${vStock === 1 ? '' : 's'} of "${p.name}" (${i.color}) available — you ordered ${qty}.`;
                }
            } else {
                // No colour specified — validate against sum of all variant stocks
                const total = p.variants.reduce((s, v) => s + (parseInt(v.stock, 10) || 0), 0);
                if (total === 0) return `"${p.name}" is out of stock.`;
                if (qty > total) return `Only ${total} unit${total === 1 ? '' : 's'} of "${p.name}" available — you ordered ${qty}.`;
            }
        } else {
            if (p.isSoldOut) return `"${p.name}" is sold out and cannot be ordered.`;
            if (p.stock !== null && p.stock !== undefined) {
                if (p.stock === 0) return `"${p.name}" is out of stock.`;
                if (qty > p.stock) return `Only ${p.stock} unit${p.stock === 1 ? '' : 's'} of "${p.name}" available — you ordered ${qty}.`;
            }
        }
    }
    return null;
}

// ── MANUAL INVOICE ─────────────────────────────────────────────────────────

function nextInvoiceId() {
    const existing = orders.filter(o => /^INV-\d+$/.test(o.id));
    const nextNum  = existing.length > 0
        ? Math.max(...existing.map(o => parseInt(o.id.slice(4)))) + 1
        : 1;
    return `INV-${String(nextNum).padStart(4, '0')}`;
}

function nextOrderNo() {
    // Sequential friendly order number: #1001, #1002 ...
    // Start at 1001 so it looks like an established store
    const nums = orders.map(o => o.orderNo).filter(n => typeof n === 'number');
    return nums.length > 0 ? Math.max(...nums) + 1 : 1001;
}

// Backfill orderNo for existing orders that don't have one
(function backfillOrderNos() {
    let changed = false;
    const sorted = [...orders].sort((a, b) => new Date(a.paidAt||0) - new Date(b.paidAt||0));
    let next = 1001;
    sorted.forEach(o => {
        if (!o.orderNo) {
            // Find the same order in the main array and assign
            const real = orders.find(r => r.id === o.id);
            if (real) { real.orderNo = next; changed = true; }
            next++;
        } else {
            if (o.orderNo >= next) next = o.orderNo + 1;
        }
    });
    if (changed) saveJSON(ORDERS_FILE, orders);
})();

app.post('/api/admin/verify-password', requireAdminJWT, async (req, res) => {
    const { password } = req.body;
    if (!password) return res.json({ valid: false });
    const account = adminAccounts.find(a => a.id === req.adminUser.id);
    if (!account || !account.passwordHash) return res.json({ valid: false });
    const ok = await bcrypt.compare(password, account.passwordHash);
    res.json({ valid: ok });
});

app.get('/api/admin/next-invoice-num', requireAdminJWT, (req, res) => {
    res.json({ next: nextInvoiceId() });
});

app.post('/api/admin/manual-invoice', requireAdminJWT, async (req, res) => {
    // mode: 'save' | 'save_email' | 'email_only'
    const { customer, items, discount, deliveryFee, notes, mode, invoiceNum } = req.body;
    if (!customer?.name)
        return res.status(400).json({ success: false, message: 'Customer name is required.' });
    if ((mode === 'save_email' || mode === 'email_only') && !customer?.email)
        return res.status(400).json({ success: false, message: 'Enter the customer\'s email to send the invoice by email.' });
    if (!Array.isArray(items) || !items.length)
        return res.status(400).json({ success: false, message: 'At least one line item is required.' });

    const subtotal = items.reduce((s, i) => s + (parseFloat(i.price) || 0) * (parseInt(i.qty) || 1), 0);
    const disc     = parseFloat(discount) || 0;
    const delivery = parseFloat(deliveryFee) || 0;
    const total    = Math.max(0, subtotal + delivery - disc);

    // Build order items (include productId/color/size for stock tracking)
    const orderItems = items.map(i => ({
        id:       i.productId || null,
        name:     i.description,
        price:    parseFloat(i.price) || 0,
        quantity: parseInt(i.qty) || 1,
        color:    i.color || '',
        size:     i.size  || ''
    }));

    const order = {
        reference: null,
        paymentStatus: 'manual',
        customer: {
            name:    customer.name,
            email:   customer.email,
            phone:   customer.phone   || '',
            address: customer.address || '',
            notes:   notes            || ''
        },
        items: orderItems,
        subtotal,
        promoCode:       null,
        promoDiscount:   disc,
        deliveryZone:    null,
        deliveryPrice:   delivery,
        deliveryAddress: customer.address || null,
        total,
        vat: vatBreakdown(total),
        paidAt:  new Date().toISOString(),
        status:  'Pending'
    };

    // Email-only: send receipt without saving or touching stock
    if (mode === 'email_only') {
        order.id = (invoiceNum || '').trim() || nextInvoiceId();
        try {
            await sendConfirmationEmail(order);
            return res.json({ success: true, emailOnly: true, order });
        } catch (err) {
            console.error('[EMAIL ERROR - manual invoice email-only]', err.message);
            return res.status(500).json({ success: false, message: 'Email failed: ' + err.message });
        }
    }

    // Save modes: validate stock, assign ID, persist, deduct
    const id = (invoiceNum || '').trim() || nextInvoiceId();
    if (orders.find(o => o.id === id))
        return res.status(409).json({ success: false, message: `Invoice ${id} already exists.` });
    order.id = id;

    // Validate stock for linked product items
    const stockError = validateCartStock(
        orderItems.filter(i => i.id).map(i => ({ id: i.id, color: i.color, quantity: i.quantity }))
    );
    if (stockError) return res.status(400).json({ success: false, message: stockError });

    // Deduct stock BEFORE saving the order so the flag is only set if deduction succeeds
    deductStock(orderItems.filter(i => i.id).map(i => ({ id: i.id, color: i.color, quantity: i.quantity })));
    order.stockDeducted = true;
    orders.push(order);
    saveJSON(ORDERS_FILE, orders);

    if (mode === 'save_email') {
        try {
            await sendConfirmationEmail(order);
        } catch (err) {
            console.error('[EMAIL ERROR - manual invoice]', err.message);
            return res.json({ success: true, order, emailError: err.message });
        }
    }

    res.json({ success: true, order });
});

// ── WHATSAPP ORDERS ──────────────────────────────────────────────────────────
// This store takes no online payment. Checkout only records the order + delivery
// details; the customer's sales chat on WhatsApp is where price/payment is confirmed.
app.post('/api/whatsapp-order', (req, res) => {
    if (rateLimit('order:' + clientIp(req), 10, 10 * 60 * 1000)) return res.status(429).json({ success: false, message: 'Too many orders placed — please wait a few minutes and try again, or message us on WhatsApp directly.' });
    let { customer, cartItems, promoCode, promoDiscount, deliveryZone, deliveryPrice, deliveryAddress, areaName, areaRegion } = req.body;
    if (!customer || !customer.name || !customer.phone) {
        return res.status(400).json({ success: false, message: 'Name and phone are required.' });
    }
    if (!Array.isArray(cartItems) || !cartItems.length) {
        return res.status(400).json({ success: false, message: 'Your cart is empty.' });
    }

    // Delivery fee is negotiated with the customer on WhatsApp, not calculated
    // on-site — deliveryZone/deliveryArea are recorded only as location context
    // for whoever fulfils the order. A client-supplied deliveryPrice is never
    // trusted or added to the total (previously it was, via a zone-map guard
    // that compared the zone NAME the client actually sends against the zone
    // ID format it was written to expect, so it never matched and the raw
    // client value passed straight through unchecked).

    // Hard block: unlisted or nonexistent products. A cart line whose id matches
    // no real product used to fall through every check below and get priced
    // from the client's own (arbitrary) price/name — a fabricated line item
    // could zero out or invert an order's total and poison the name into
    // best-sellers analytics. Rejecting the whole order up front is simpler and
    // safer than trying to price an item that doesn't exist.
    for (const i of cartItems) {
        const p = products.find(p => p.id === i.id);
        if (!p) return res.status(400).json({ success: false, message: 'One or more items in your cart are no longer available. Please refresh and try again.' });
        if (p.isListed === false) {
            return res.status(400).json({ success: false, message: `"${p.name}" is no longer available. Please remove it and try again.` });
        }
    }
    const stockError = validateCartStock(cartItems);
    const fulfillmentAlert = stockError ? stockError : null;

    // Price/quantity guard — recompute entirely from server-side product data
    // (every item is now guaranteed to match a real product, per the block
    // above). Quantity is clamped to a positive integer — a negative or
    // fractional quantity previously passed both this subtotal calculation and
    // validateCartStock's `qty > vStock` check unrejected, quietly reducing the
    // order's total without deducting (or restoring) any real stock.
    const serverSubtotal = cartItems.reduce((s, item) => {
        const p = products.find(p => p.id === item.id);
        const qty = Math.max(1, Math.floor(parseFloat(item.quantity)) || 1);
        return s + (parseFloat(p.price) || 0) * qty;
    }, 0);
    // Re-validate the promo code against the same rules as /api/validate-code —
    // that endpoint's checks are only a checkout-time preview and are not
    // otherwise enforced here, so expiry/usage-limit/minimum-order must be
    // re-checked at the point the order is actually recorded.
    const serverBundleDiscount = Math.min(serverSubtotal, bundleDiscountFor(cartItems));
    const subtotalAfterBundles = serverSubtotal - serverBundleDiscount;
    let serverDiscount = 0;
    let appliedPromoCode = null;
    if (promoCode) {
        const code = codes.find(c => c.code === (promoCode || '').toUpperCase().trim());
        const now = Date.now();
        const codeValid = code
            && !(code.expiresAt && now > code.expiresAt)
            && !(code.maxUses && promoUsageCount(code.code) >= code.maxUses)
            && !(code.minOrder && subtotalAfterBundles < code.minOrder);
        if (codeValid) {
            appliedPromoCode = code.code;
            serverDiscount = code.type === 'percent'
                ? Math.min(subtotalAfterBundles, Math.round(subtotalAfterBundles * code.value) / 100)
                : Math.min(code.value, subtotalAfterBundles);
        }
    }
    // Always 0 — see comment above. Any deliveryPrice the client sends is ignored.
    const serverDelivery = 0;
    const serverTotal = Math.max(0, subtotalAfterBundles + serverDelivery - serverDiscount);

    const order = {
        id: 'ORD-' + Date.now(),
        orderNo: nextOrderNo(),
        reference: 'WA-' + Date.now(),
        paymentMethod: 'whatsapp',
        paymentStatus: 'pending',
        customer,
        items: cartItems.map(item => {
            // Every item is guaranteed to match a real, listed product by the
            // hard-block above — name/price always come from that record, never
            // the client, and quantity is clamped the same way serverSubtotal is.
            const p = products.find(p => p.id === item.id);
            const qty = Math.max(1, Math.floor(parseFloat(item.quantity)) || 1);
            return { ...item, name: p.name, price: parseFloat(p.price), quantity: qty };
        }),
        subtotal: serverSubtotal,
        bundleDiscount: serverBundleDiscount,
        promoCode: appliedPromoCode,
        promoDiscount: serverDiscount,
        deliveryZone: deliveryZone || null,
        deliveryArea: (areaName || '').trim() || null,
        deliveryPrice: serverDelivery,
        deliveryAddress: deliveryAddress || null,
        total: serverTotal,
        vat: vatBreakdown(serverTotal),
        paidAt: new Date().toISOString(),
        stockDeducted: !fulfillmentAlert,
        ...(fulfillmentAlert ? { fulfillmentAlert, status: 'Needs Review' } : {})
    };
    orders.push(order);
    saveJSON(ORDERS_FILE, orders);
    if (!fulfillmentAlert) deductStock(cartItems);
    if (appliedPromoCode) {
        // Usage count is no longer stored/incremented here — promoUsageCount()
        // derives it live from orders, so it can never drift from what actually
        // happened (see the comment on that function).
        const usedCode = codes.find(c => c.code === appliedPromoCode);
        if (usedCode && usedCode.referrer) {
            order.referrer = usedCode.referrer;
            saveJSON(ORDERS_FILE, orders);
        }
    }
    sendConfirmationEmail(order).catch(err => console.error('[EMAIL ERROR - whatsapp-order]', err.message));
    res.json({ success: true, order });
});

// ── CUSTOMER AUTH ─────────────────────────────────────────────────────────

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '1087064685632-co79opd5u3vs1qi942khk1pav003130o.apps.googleusercontent.com';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ── GOOGLE SIGN-IN ─────────────────────────────────────────────────────────
app.post('/api/auth/google', async (req, res) => {
    const { credential } = req.body;
    if (!credential) return res.status(400).json({ error: 'No credential provided.' });
    try {
        // Verify the ID token with Google tokeninfo endpoint
        const gRes  = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`);
        const verifyRes = await gRes.json();
        // Check token is for our app — aud can be a string or array
        const audList = Array.isArray(verifyRes.aud) ? verifyRes.aud : [verifyRes.aud];
        if (!audList.some(a => a.trim() === GOOGLE_CLIENT_ID.trim())) {
            console.error('[GOOGLE AUTH] aud mismatch — token aud:', verifyRes.aud, 'expected:', GOOGLE_CLIENT_ID);
            return res.status(401).json({ error: 'Token audience mismatch.' });
        }
        if (verifyRes.error_description || !verifyRes.email) {
            return res.status(401).json({ error: verifyRes.error_description || 'Invalid token.' });
        }
        const email = verifyRes.email.toLowerCase().trim();
        const name  = verifyRes.name || verifyRes.given_name || email.split('@')[0];
        const picture = verifyRes.picture || null;
        // Find or create customer
        let customer = customers.find(c => c.email === email);
        if (!customer) {
            customer = {
                id: 'CUST-' + Date.now(),
                email, name,
                picture,
                passwordHash: null, // Google-only accounts have no password
                googleId: verifyRes.sub,
                phone: '', address: '',
                createdAt: new Date().toISOString()
            };
            customers.push(customer);
            saveJSON(CUSTOMERS_FILE, customers);
        } else {
            // Update picture/googleId if signing in via Google for the first time
            let changed = false;
            if (!customer.googleId) { customer.googleId = verifyRes.sub; changed = true; }
            if (picture && !customer.picture) { customer.picture = picture; changed = true; }
            if (changed) saveJSON(CUSTOMERS_FILE, customers);
        }
        const token = jwt.sign({ customerId: customer.id, email: customer.email, jti: crypto.randomBytes(16).toString('hex') }, JWT_SECRET, { expiresIn: '30d' });
        res.json({ token, customer: { id: customer.id, email: customer.email, name: customer.name, phone: customer.phone, address: customer.address, picture: customer.picture || null } });
    } catch(e) {
        console.error('[GOOGLE AUTH]', e.message);
        res.status(500).json({ error: 'Google sign-in failed. Please try again.' });
    }
});

// ── HELPERS ────────────────────────────────────────────────────────────────
function clientIp(req) {
    // req.ip is trust-proxy-aware (see app.set('trust proxy', 1) above) — safe
    // against a client spoofing X-Forwarded-For, unlike reading the header directly.
    return req.ip || 'unknown';
}
function issueToken(customer) {
    return jwt.sign({ customerId: customer.id, email: customer.email, jti: crypto.randomBytes(16).toString('hex') }, JWT_SECRET, { expiresIn: '30d' });
}
function safeCustomer(c) {
    return { id: c.id, email: c.email, name: c.name, phone: c.phone, address: c.address, picture: c.picture || null, emailVerified: !!c.emailVerified };
}
async function sendLoginAlert(customer, req) {
    if (!GMAIL_PASS) return;
    try {
        const ua = req.headers['user-agent'] || 'Unknown device';
        const ip = clientIp(req);
        const transporter = makeTransporter();
        await transporter.sendMail({
            from: `"Freeman Outlet" <${GMAIL_USER}>`,
            to: customer.email,
            subject: 'New sign-in to your Freeman Outlet account',
            html: `<p style="font-family:sans-serif">Hi <strong>${escHtml(customer.name)}</strong>,</p>
                   <p style="font-family:sans-serif">A new sign-in to your Freeman Outlet account was detected.</p>
                   <table style="font-family:sans-serif;font-size:13px;border-collapse:collapse">
                     <tr><td style="padding:4px 12px 4px 0;color:#888">Device</td><td>${ua.slice(0, 120)}</td></tr>
                     <tr><td style="padding:4px 12px 4px 0;color:#888">IP</td><td>${ip}</td></tr>
                     <tr><td style="padding:4px 12px 4px 0;color:#888">Time</td><td>${new Date().toLocaleString('en-GH')}</td></tr>
                   </table>
                   <p style="font-family:sans-serif;margin-top:16px">If this wasn't you, <a href="https://wa.me/${settings.whatsapp || ''}" style="color:#C9971C">contact us immediately on WhatsApp</a>.</p>`
        });
    } catch(e) { console.error('[LOGIN ALERT]', e.message); }
}

app.post('/api/auth/register', async (req, res) => {
    const ip = clientIp(req);
    if (rateLimit('reg:' + ip, 5, 60000)) return res.status(429).json({ error: 'Too many attempts. Please wait a minute.' });
    const { name, email, password } = req.body;
    if (!name || !email || !password) return res.status(400).json({ error: 'Name, email and password are required' });
    if (!EMAIL_RE.test(String(email).trim())) return res.status(400).json({ error: 'Please enter a valid email address' });
    if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
    if (/^(.)\1+$/.test(password) || ['12345678','password','00000000','11111111'].includes(password))
        return res.status(400).json({ error: 'Password is too simple. Please choose a stronger one.' });
    const emailNorm = email.toLowerCase().trim();
    if (customers.find(c => c.email === emailNorm))
        return res.status(409).json({ error: 'An account with this email already exists' });
    const hash = await bcrypt.hash(password, 10);
    const customer = { id: 'CUST-' + Date.now(), email: emailNorm, passwordHash: hash, name: name.trim(), phone: '', address: '', emailVerified: false, createdAt: new Date().toISOString() };
    customers.push(customer);
    saveJSON(CUSTOMERS_FILE, customers);
    // Send email verification
    const verifyToken = crypto.randomBytes(32).toString('hex');
    emailVerify = emailVerify.filter(r => r.email !== emailNorm);
    emailVerify.push({ token: verifyToken, email: emailNorm, expires: Date.now() + 24 * 60 * 60 * 1000 });
    saveJSON(EMAIL_VERIFY_FILE, emailVerify);
    if (GMAIL_PASS) {
        const baseUrl = process.env.BASE_URL || process.env.RENDER_EXTERNAL_URL || 'http://localhost:3000';
        makeTransporter().sendMail({
            from: `"Freeman Outlet" <${GMAIL_USER}>`,
            to: emailNorm,
            subject: 'Verify your Freeman Outlet email',
            html: `<p style="font-family:sans-serif">Hi <strong>${escHtml(customer.name)}</strong>, welcome to Freeman Outlet!</p>
                   <p style="font-family:sans-serif">Please verify your email address:</p>
                   <p><a href="${baseUrl}/api/auth/verify-email?token=${verifyToken}" style="background:#C9971C;color:#fff;padding:10px 24px;border-radius:6px;text-decoration:none;font-family:sans-serif;font-weight:700">Verify Email</a></p>
                   <p style="font-family:sans-serif;font-size:12px;color:#888">This link expires in 24 hours.</p>`
        }).catch(e => console.error('[VERIFY EMAIL]', e.message));
    }
    const token = issueToken(customer);
    res.json({ token, customer: safeCustomer(customer), message: 'Account created! Check your email to verify your address.' });
});

app.post('/api/auth/login', async (req, res) => {
    const ip = clientIp(req);
    if (rateLimit('login:' + ip, 10, 60000)) return res.status(429).json({ error: 'Too many login attempts. Please wait a minute.' });
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
    const emailNorm = email.toLowerCase().trim();
    const customer = customers.find(c => c.email === emailNorm);
    if (!customer || !customer.passwordHash) return res.status(401).json({ error: 'Invalid email or password' });
    // Account lockout check
    if (customer.lockedUntil && customer.lockedUntil > Date.now()) {
        const mins = Math.ceil((customer.lockedUntil - Date.now()) / 60000);
        return res.status(429).json({ error: `Account locked after too many failed attempts. Try again in ${mins} minute${mins > 1 ? 's' : ''}.` });
    }
    const ok = await bcrypt.compare(password, customer.passwordHash);
    if (!ok) {
        // Increment failed attempts
        customer.failedAttempts = (customer.failedAttempts || 0) + 1;
        if (customer.failedAttempts >= 5) {
            customer.lockedUntil = Date.now() + 15 * 60 * 1000;
            customer.failedAttempts = 0;
            saveJSON(CUSTOMERS_FILE, customers);
            return res.status(429).json({ error: 'Too many failed attempts. Account locked for 15 minutes.' });
        }
        saveJSON(CUSTOMERS_FILE, customers);
        const left = 5 - customer.failedAttempts;
        return res.status(401).json({ error: `Invalid email or password. ${left} attempt${left !== 1 ? 's' : ''} remaining.` });
    }
    // Success — reset lockout state
    if (customer.failedAttempts || customer.lockedUntil) {
        customer.failedAttempts = 0;
        delete customer.lockedUntil;
        saveJSON(CUSTOMERS_FILE, customers);
    }
    // Send login alert if this is a known account (not first login)
    const isFirstLogin = !customer.lastLoginAt;
    customer.lastLoginAt = new Date().toISOString();
    saveJSON(CUSTOMERS_FILE, customers);
    if (!isFirstLogin) sendLoginAlert(customer, req).catch(() => {});
    const token = issueToken(customer);
    res.json({ token, customer: safeCustomer(customer) });
});

// Email verification
app.get('/api/auth/verify-email', (req, res) => {
    const { token } = req.query;
    const record = emailVerify.find(r => r.token === token && r.expires > Date.now());
    if (!record) return res.redirect('/?verified=fail');
    const customer = customers.find(c => c.email === record.email);
    if (customer) { customer.emailVerified = true; saveJSON(CUSTOMERS_FILE, customers); }
    emailVerify = emailVerify.filter(r => r.token !== token);
    saveJSON(EMAIL_VERIFY_FILE, emailVerify);
    res.redirect('/?verified=ok');
});

// Resend verification email
app.post('/api/auth/resend-verification', requireCustomer, async (req, res) => {
    const customer = customers.find(c => c.id === req.customerId);
    if (!customer) return res.status(404).json({ error: 'Account not found' });
    if (customer.emailVerified) return res.json({ success: true, message: 'Already verified.' });
    if (rateLimit('verify:' + customer.email, 3, 60 * 60 * 1000))
        return res.status(429).json({ error: 'Too many resend requests. Please wait an hour.' });
    const verifyToken = crypto.randomBytes(32).toString('hex');
    emailVerify = emailVerify.filter(r => r.email !== customer.email);
    emailVerify.push({ token: verifyToken, email: customer.email, expires: Date.now() + 24 * 60 * 60 * 1000 });
    saveJSON(EMAIL_VERIFY_FILE, emailVerify);
    if (GMAIL_PASS) {
        const baseUrl = process.env.BASE_URL || process.env.RENDER_EXTERNAL_URL || 'http://localhost:3000';
        await makeTransporter().sendMail({
            from: `"Freeman Outlet" <${GMAIL_USER}>`,
            to: customer.email,
            subject: 'Verify your Freeman Outlet email',
            html: `<p style="font-family:sans-serif">Hi ${escHtml(customer.name)},</p><p style="font-family:sans-serif"><a href="${baseUrl}/api/auth/verify-email?token=${encodeURIComponent(verifyToken)}" style="background:#C9971C;color:#fff;padding:10px 24px;border-radius:6px;text-decoration:none">Verify Email →</a></p>`
        }).catch(e => console.error('[RESEND VERIFY]', e.message));
    }
    res.json({ success: true, message: 'Verification email sent.' });
});

// Logout — revoke the token
app.post('/api/auth/logout', requireCustomer, (req, res) => {
    try {
        const payload = jwt.decode(req.headers['authorization'].slice(7));
        if (payload?.jti) {
            revokedTokens.add(payload.jti);
            // Persist: save revoked tokens with expiry so we can clean up later
            const existing = loadJSON(REVOKED_TOKENS_FILE, []).filter(t => t.exp > Date.now() / 1000);
            existing.push({ jti: payload.jti, exp: payload.exp });
            saveJSON(REVOKED_TOKENS_FILE, existing);
        }
    } catch(e) { /* ignore decode errors */ }
    res.json({ success: true });
});

// Delete account
app.delete('/api/auth/me', requireCustomer, async (req, res) => {
    const { password } = req.body;
    const customer = customers.find(c => c.id === req.customerId);
    if (!customer) return res.status(404).json({ error: 'Account not found' });
    // Require password confirmation (Google-only accounts skip this)
    if (customer.passwordHash) {
        if (!password) return res.status(400).json({ error: 'Password required to delete account' });
        const ok = await bcrypt.compare(password, customer.passwordHash);
        if (!ok) return res.status(401).json({ error: 'Incorrect password' });
    }
    // Anonymise orders (keep order records but strip personal data)
    orders.forEach(o => {
        if (o.customer && o.customer.email === customer.email) {
            o.customer = { name: 'Deleted Account', email: '', phone: '', address: '', notes: '' };
        }
    });
    saveJSON(ORDERS_FILE, orders);
    // Remove account
    customers = customers.filter(c => c.id !== req.customerId);
    saveJSON(CUSTOMERS_FILE, customers);
    if (wishlists[req.customerId]) { delete wishlists[req.customerId]; saveJSON(WISHLIST_FILE, wishlists); }
    if (GMAIL_PASS) {
        makeTransporter().sendMail({
            from: `"Freeman Outlet" <${GMAIL_USER}>`,
            to: customer.email,
            subject: 'Your Freeman Outlet account has been deleted',
            html: `<p style="font-family:sans-serif">Hi ${escHtml(customer.name)}, your Freeman Outlet account has been permanently deleted as requested. We're sorry to see you go.</p><p style="font-family:sans-serif">If you didn't request this, please contact us on WhatsApp immediately.</p>`
        }).catch(() => {});
    }
    res.json({ success: true, message: 'Account deleted.' });
});

app.get('/api/auth/me', requireCustomer, (req, res) => {
    const c = customers.find(c => c.id === req.customerId);
    if (!c) return res.status(404).json({ error: 'Account not found' });
    res.json({ id: c.id, email: c.email, name: c.name, phone: c.phone, address: c.address, picture: c.picture || null, createdAt: c.createdAt });
});

app.post('/api/auth/change-password', requireCustomer, async (req, res) => {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Both fields required.' });
    if (newPassword.length < 8) return res.status(400).json({ error: 'New password must be at least 8 characters.' });
    const customer = customers.find(c => c.id === req.customerId);
    if (!customer) return res.status(404).json({ error: 'Account not found.' });
    if (!customer.passwordHash) return res.status(400).json({ error: 'This account uses Google sign-in — no password to change.' });
    const ok = await bcrypt.compare(currentPassword, customer.passwordHash);
    if (!ok) return res.status(401).json({ error: 'Current password is incorrect.' });
    customer.passwordHash = await bcrypt.hash(newPassword, 10);
    saveJSON(CUSTOMERS_FILE, customers);
    res.json({ success: true });
});

app.put('/api/auth/me', requireCustomer, (req, res) => {
    const idx = customers.findIndex(c => c.id === req.customerId);
    if (idx < 0) return res.status(404).json({ error: 'Account not found' });
    const { name, phone, address } = req.body;
    if (name    !== undefined) customers[idx].name    = name.trim();
    if (phone   !== undefined) customers[idx].phone   = phone.trim();
    if (address !== undefined) customers[idx].address = address.trim();
    saveJSON(CUSTOMERS_FILE, customers);
    const c = customers[idx];
    res.json({ id: c.id, email: c.email, name: c.name, phone: c.phone, address: c.address });
});

app.get('/api/auth/me/orders', requireCustomer, (req, res) => {
    // Filter by customerId (set at checkout/registration), not email — prevents cross-account data leak
    const myOrders = orders
        .filter(o => o.customerId === req.customerId || (o.customer && o.customer.email && o.customer.email.toLowerCase() === req.customerEmail.toLowerCase()))
        .sort((a, b) => new Date(b.paidAt) - new Date(a.paidAt))
        .map(o => ({ id: o.id, reference: o.reference, paidAt: o.paidAt, total: o.total, items: o.items, deliveryZone: o.deliveryZone, status: o.status || 'Processing' }));
    res.json(myOrders);
});

// ── PASSWORD RESET ─────────────────────────────────────────────────────────

app.post('/api/auth/forgot-password', async (req, res) => {
    const email = (req.body.email || '').toLowerCase().trim();
    if (!email) return res.status(400).json({ error: 'Email required.' });
    // Always return success to prevent email enumeration
    const customer = customers.find(c => c.email === email);
    if (customer && GMAIL_PASS) {
        // Expire old tokens for this email
        pwdResets = pwdResets.filter(r => r.email !== email && r.expires > Date.now()); // remove old + expired
        const token   = crypto.randomBytes(32).toString('hex');
        const expires = Date.now() + 60 * 60 * 1000; // 1 hour
        pwdResets.push({ token, email, expires });
        saveJSON(PWD_RESET_FILE, pwdResets);
        const transporter = makeTransporter();
        const baseUrl  = process.env.BASE_URL || process.env.RENDER_EXTERNAL_URL || 'http://localhost:3000';
        const resetUrl = `${baseUrl}/?reset=${token}`;
        await transporter.sendMail({
            from: `"Freeman Outlet" <${GMAIL_USER}>`,
            to: email,
            subject: 'Reset your Freeman Outlet password',
            html: `<p style="font-family:sans-serif">Hi ${escHtml(customer.name)},</p>
                   <p style="font-family:sans-serif">Click below to reset your password. This link expires in 1 hour.</p>
                   <p><a href="${resetUrl}" style="background:#C9971C;color:#fff;padding:10px 24px;border-radius:6px;text-decoration:none;font-family:sans-serif;font-weight:700">Reset Password</a></p>
                   <p style="font-family:sans-serif;font-size:12px;color:#888">If you didn't request this, ignore this email.</p>`
        }).catch(e => console.error('[PWD RESET EMAIL]', e.message));
    }
    res.json({ success: true, message: 'If that email is registered, a reset link has been sent.' });
});

app.post('/api/auth/reset-password', async (req, res) => {
    const { token, password } = req.body;
    if (!token || !password) return res.status(400).json({ error: 'Token and new password required.' });
    if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters.' });
    const record = pwdResets.find(r => r.token === token && r.expires > Date.now());
    if (!record) return res.status(400).json({ error: 'Invalid or expired reset link. Please request a new one.' });
    const idx = customers.findIndex(c => c.email === record.email);
    if (idx === -1) return res.status(404).json({ error: 'Account not found.' });
    customers[idx].passwordHash = await bcrypt.hash(password, 10);
    saveJSON(CUSTOMERS_FILE, customers);
    pwdResets = pwdResets.filter(r => r.token !== token);
    saveJSON(PWD_RESET_FILE, pwdResets);
    res.json({ success: true, message: 'Password updated. You can now log in.' });
});

// ── WISHLIST ────────────────────────────────────────────────────────────────

app.get('/api/wishlist', requireCustomer, (req, res) => {
    const ids = wishlists[req.customerId] || [];
    const items = ids.map(id => products.find(p => p.id === id)).filter(Boolean)
        .map(p => Object.fromEntries(PUBLIC_PRODUCT_FIELDS.filter(k => k in p).map(k => [k, p[k]])));
    res.json(items);
});

app.post('/api/wishlist/:productId', requireCustomer, (req, res) => {
    const { productId } = req.params;
    if (!products.find(p => p.id === productId)) return res.status(404).json({ error: 'Product not found.' });
    if (!wishlists[req.customerId]) wishlists[req.customerId] = [];
    if (!wishlists[req.customerId].includes(productId)) wishlists[req.customerId].push(productId);
    saveJSON(WISHLIST_FILE, wishlists);
    res.json({ success: true });
});

app.delete('/api/wishlist/:productId', requireCustomer, (req, res) => {
    if (wishlists[req.customerId]) {
        wishlists[req.customerId] = wishlists[req.customerId].filter(id => id !== req.params.productId);
        saveJSON(WISHLIST_FILE, wishlists);
    }
    res.json({ success: true });
});

// ── EMAIL ──────────────────────────────────────────────────────────────────

// Was public/images/logo.png — that file never existed (the directory is empty),
// so nodemailer threw ENOENT on every send that attached this, silently killing
// the customer invoice, owner alert, shipped/delivered, order-archived, and
// abandoned-cart emails. The real logo lives here.
const LOGO_ATTACHMENT = { filename: 'logo.png', path: path.join(__dirname, 'src', 'assets', 'images', 'logo.png'), cid: 'logo@freemanoutlet' };
// Always read from settings so the value in the admin panel is the single source of truth
function waStore() { return settings.whatsapp || ''; }

function makeTransporter() {
    return nodemailer.createTransport({
        host: 'smtp.gmail.com',
        port: 465,
        secure: true,
        auth: { user: GMAIL_USER, pass: GMAIL_PASS },
        tls: { rejectUnauthorized: false }
    });
}

const SOCIAL_LINKS_HTML = `
  <div style="padding:18px 36px 22px;border-top:1px solid #e8e0d8;text-align:center">
    <p style="margin:0 0 10px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.12em;color:#bbb">Find us online</p>
    <a href="https://wa.me/${waStore()}" style="display:inline-block;margin:0 8px;font-size:12px;color:#888;text-decoration:none">WhatsApp</a>
    <a href="#" style="display:inline-block;margin:0 8px;font-size:12px;color:#888;text-decoration:none">Instagram</a>
    <a href="#" style="display:inline-block;margin:0 8px;font-size:12px;color:#888;text-decoration:none">Facebook</a>
    <a href="#" style="display:inline-block;margin:0 8px;font-size:12px;color:#888;text-decoration:none">TikTok</a>
    <p style="margin:10px 0 0;font-size:11px;color:#ccc">© 2026 Freeman Outlet Ghana</p>
  </div>`;

async function sendConfirmationEmail(order) {
    if (!GMAIL_PASS) { console.error('[EMAIL SKIP] GMAIL_PASS not set — no email sent for order', order.id); return; }
    if (!GMAIL_USER || GMAIL_USER.includes('REPLACE')) return;
    const { customer, items, total, id, orderNo, paidAt, promoCode, promoDiscount, bundleDiscount, subtotal, deliveryZone, deliveryArea, deliveryPrice, deliveryAddress } = order;
    const displayId = orderNo ? '#' + orderNo : id;
    // Build a human-readable delivery label: prefer area name, fallback to zone
    const deliveryLabel = deliveryArea ? escHtml(deliveryArea) + (deliveryZone ? ' · ' + escHtml(deliveryZone) : '') : (deliveryZone ? escHtml(deliveryZone) : null);
    const date = new Date(paidAt).toLocaleString('en-GH', { dateStyle: 'long', timeStyle: 'short' });

    const rowsHtml = (items || []).map(i => {
        const meta = [i.color ? 'Colour: ' + escHtml(i.color) : '', i.size ? 'Size: ' + escHtml(i.size) : ''].filter(Boolean).join(' · ');
        return `<tr>
          <td style="padding:12px 10px 12px 0;border-bottom:1px solid #f0eae4;font-size:13px;color:#1a1a1a">${escHtml(i.name)}${meta ? '<br><span style="font-size:11px;color:#aaa">' + meta + '</span>' : ''}</td>
          <td style="padding:12px 8px;border-bottom:1px solid #f0eae4;text-align:right;font-size:13px;color:#666">GH₵${parseFloat(i.price).toFixed(2)}</td>
          <td style="padding:12px 8px;border-bottom:1px solid #f0eae4;text-align:center;font-size:13px;color:#666">${parseInt(i.quantity)||1}</td>
          <td style="padding:12px 0 12px 8px;border-bottom:1px solid #f0eae4;text-align:right;font-size:13px;font-weight:700;color:#1a1a1a">GH₵${(i.price * i.quantity).toFixed(2)}</td>
        </tr>`;
    }).join('');

    // VAT-inclusive breakdown
    const vatB = order.vat || vatBreakdown(total);
    const vatRowsHtml = vatB ? `
          <tr><td colspan="2" style="padding:14px 0 4px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.12em;color:#aaa">Total includes</td></tr>
          <tr><td style="padding:2px 0;font-size:12px;color:#777">Amount before VAT</td><td style="padding:2px 0;text-align:right;font-size:12px;color:#777">GH₵${vatB.base.toFixed(2)}</td></tr>
          ${vatB.parts.map(p => `<tr><td style="padding:2px 0;font-size:12px;color:#777">${p.label} (${p.rate}%)</td><td style="padding:2px 0;text-align:right;font-size:12px;color:#777">GH₵${p.amount.toFixed(2)}</td></tr>`).join('')}` : '';

    // Customer invoice email
    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
<link href="https://fonts.googleapis.com/css2?family=Dancing+Script:wght@700&display=swap" rel="stylesheet">
</head><body style="margin:0;padding:0;background:#f7f5f3;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif">
<div style="max-width:600px;margin:32px auto;background:#fff;border-radius:4px;box-shadow:0 2px 20px rgba(0,0,0,.08)">

  <div style="padding:28px 40px 22px;text-align:center;border-bottom:2px solid #C9971C">
    <img src="cid:logo@freemanoutlet" width="68" alt="Freeman Outlet" style="display:block;margin:0 auto 12px"/>
    <h1 style="margin:0;font-family:'Dancing Script',cursive;font-size:42px;color:#C9971C;font-weight:700;line-height:1">Invoice</h1>
    ${(settings.invoiceTin || '').trim() ? `<p style="margin:8px 0 0;font-size:11px;color:#888">TIN: ${escHtml(settings.invoiceTin)}</p>` : ''}
  </div>

  <table width="100%" cellpadding="0" cellspacing="0">
    <tr>
      <td style="padding:24px 40px 20px;vertical-align:top">
        <p style="margin:0 0 5px;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.14em;color:#aaa">Invoice To</p>
        <p style="margin:0;font-size:15px;font-weight:800;text-transform:uppercase;letter-spacing:.07em;color:#1a1a1a">${escHtml(customer.name)}</p>
        <p style="margin:6px 0 0;font-size:13px;color:#666;line-height:1.55">${escHtml(customer.address || '')}</p>
        ${customer.phone ? `<p style="margin:3px 0 0;font-size:13px;color:#666">${escHtml(customer.phone)}</p>` : ''}
        <p style="margin:3px 0 0;font-size:13px;color:#666">${escHtml(customer.email)}</p>
        ${customer.notes ? `<p style="margin:8px 0 0;font-size:12px;color:#aaa;font-style:italic">Note: ${escHtml(customer.notes)}</p>` : ''}
        ${deliveryAddress ? `<p style="margin:10px 0 0;font-size:12px;color:#C9971C;font-weight:700">📍 Pickup from: ${escHtml(deliveryAddress)}</p>` : ''}
      </td>
      <td style="padding:24px 40px 20px;text-align:right;vertical-align:top">
        <p style="margin:0 0 4px;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.14em;color:#aaa">Order No.</p>
        <p style="margin:0;font-size:16px;font-weight:800;color:#C9971C;font-family:monospace">${displayId}</p>
        <p style="margin:14px 0 4px;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.14em;color:#aaa">Date</p>
        <p style="margin:0;font-size:13px;color:#1a1a1a">${date}</p>
      </td>
    </tr>
  </table>

  <div style="margin:0 40px;height:1px;background:#e8e0d8"></div>

  <div style="padding:20px 40px 0">
    <table width="100%" cellpadding="0" cellspacing="0">
      <thead>
        <tr>
          <th style="padding:10px 10px 10px 0;text-align:left;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.12em;color:#aaa;border-bottom:1px solid #e8e0d8">Description</th>
          <th style="padding:10px 8px;text-align:right;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.12em;color:#aaa;border-bottom:1px solid #e8e0d8">Price</th>
          <th style="padding:10px 8px;text-align:center;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.12em;color:#aaa;border-bottom:1px solid #e8e0d8">Qty</th>
          <th style="padding:10px 0 10px 8px;text-align:right;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.12em;color:#aaa;border-bottom:1px solid #e8e0d8">Total</th>
        </tr>
      </thead>
      <tbody>${rowsHtml}</tbody>
    </table>
  </div>

  <table width="100%" cellpadding="0" cellspacing="0">
    <tr>
      <td></td>
      <td style="padding:4px 40px 20px;width:220px">
        <table width="100%" cellpadding="0" cellspacing="0">
          ${(deliveryPrice > 0 || promoCode || bundleDiscount > 0) ? `
          <tr>
            <td style="padding:10px 0 6px;font-size:13px;color:#777;border-top:1px solid #e8e0d8">Items Sub Total</td>
            <td style="padding:10px 0 6px;text-align:right;font-size:13px;color:#777;border-top:1px solid #e8e0d8">GH₵${(subtotal || 0).toFixed(2)}</td>
          </tr>` : ''}
          ${(deliveryPrice > 0 || deliveryLabel) ? `
          <tr>
            <td style="padding:4px 0;font-size:13px;color:#555;vertical-align:top">
              Delivery${deliveryLabel ? ' — ' + deliveryLabel : ''}
              ${customer.address ? '<br><span style="font-size:11px;color:#aaa">' + customer.address + '</span>' : ''}
            </td>
            <td style="padding:4px 0;text-align:right;font-size:13px;vertical-align:top;${deliveryPrice > 0 ? 'color:#555' : 'color:#16a34a'}">${deliveryPrice > 0 ? 'GH₵' + parseFloat(deliveryPrice).toFixed(2) : 'Free'}</td>
          </tr>` : ''}
          ${bundleDiscount > 0 ? `
          <tr>
            <td style="padding:4px 0 8px;font-size:13px;color:#16a34a">Bundle savings</td>
            <td style="padding:4px 0 8px;text-align:right;font-size:13px;color:#16a34a">−GH₵${parseFloat(bundleDiscount).toFixed(2)}</td>
          </tr>` : ''}
          ${promoCode && promoDiscount ? `
          <tr>
            <td style="padding:4px 0 8px;font-size:13px;color:#16a34a">Discount (${promoCode})</td>
            <td style="padding:4px 0 8px;text-align:right;font-size:13px;color:#16a34a">−GH₵${parseFloat(promoDiscount).toFixed(2)}</td>
          </tr>` : ''}
          <tr>
            <td style="padding:8px 0 14px;font-size:16px;font-weight:800;color:#1a1a1a;border-top:2px solid #1a1a1a">Total${vatB ? ' (VAT incl.)' : ''}</td>
            <td style="padding:8px 0 14px;text-align:right;font-size:16px;font-weight:800;color:#C9971C;border-top:2px solid #1a1a1a">GH₵${total.toFixed(2)}</td>
          </tr>${vatRowsHtml}
        </table>
      </td>
    </tr>
  </table>

  <div style="margin:0 40px;height:1px;background:#e8e0d8"></div>

  <table width="100%" cellpadding="0" cellspacing="0">
    <tr>
      <td style="padding:20px 40px;vertical-align:middle;width:70px">
        <img src="cid:logo@freemanoutlet" width="50" alt="" style="opacity:.55"/>
      </td>
      <td style="text-align:center;vertical-align:middle">
        <h2 style="margin:0;font-family:'Dancing Script',cursive;font-size:32px;color:#C9971C;font-weight:700">Thank You!</h2>
        <p style="margin:4px 0 0;font-size:11px;color:#bbb;letter-spacing:.06em">We appreciate your order</p>
      </td>
      <td style="padding:20px 40px;text-align:right;vertical-align:middle;width:120px">
        <a href="https://wa.me/${waStore()}" style="display:block;font-size:11px;color:#888;text-decoration:none;line-height:2.2">WhatsApp</a>
        <a href="#" style="display:block;font-size:11px;color:#888;text-decoration:none;line-height:2.2">Instagram</a>
        <a href="#" style="display:block;font-size:11px;color:#888;text-decoration:none;line-height:2.2">Facebook</a>
        <a href="#" style="display:block;font-size:11px;color:#888;text-decoration:none;line-height:2.2">TikTok</a>
      </td>
    </tr>
  </table>

  <div style="padding:16px 40px 28px;text-align:center">
    <a href="https://wa.me/${waStore()}" style="display:inline-block;background:#25d366;color:#fff;font-size:13px;font-weight:700;padding:11px 24px;border-radius:6px;text-decoration:none">💬 Chat with us on WhatsApp</a>
    <p style="margin:10px 0 0;font-size:11px;color:#bbb">Questions about your order? We reply fast.</p>
  </div>

</div></body></html>`;

    const transporter = makeTransporter();

    // 1. Customer invoice — email is optional at checkout, so this can be blank.
    // This used to `await` unconditionally: nodemailer rejects with "No recipients
    // defined" on an empty `to`, which threw here and skipped section 2 below
    // entirely — meaning the store owner never got the new-order alert for any
    // order where the customer didn't give an email, which is the normal case.
    if (customer.email) {
        await transporter.sendMail({
            from: `"Freeman Outlet" <${GMAIL_USER}>`,
            to: customer.email,
            subject: `Your Freeman Outlet invoice — Order ${displayId}`,
            html,
            attachments: [LOGO_ATTACHMENT]
        }).catch(err => console.error('[EMAIL ERROR - customer invoice]', err.message));
    }

    // 2. Store owner alert
    let waPhone = (customer.phone || '').replace(/\D/g, '');
    if (waPhone.startsWith('0')) waPhone = '233' + waPhone.slice(1);
    else if (waPhone && !waPhone.startsWith('233')) waPhone = '233' + waPhone;

    const ownerRowsHtml = (items || []).map(i => {
        const meta = [i.color ? 'Colour: ' + escHtml(i.color) : '', i.size ? 'Size: ' + escHtml(i.size) : ''].filter(Boolean).join(' · ');
        return `<tr>
          <td style="padding:8px 10px 8px 0;border-bottom:1px solid #f0eae4;font-size:13px">${escHtml(i.name)}${meta ? '<br><span style="font-size:11px;color:#aaa">' + meta + '</span>' : ''}</td>
          <td style="padding:8px;border-bottom:1px solid #f0eae4;text-align:center;font-size:13px">× ${parseInt(i.quantity)||1}</td>
          <td style="padding:8px 0 8px 8px;border-bottom:1px solid #f0eae4;text-align:right;font-weight:700;font-size:13px">GH₵${(i.price * i.quantity).toFixed(2)}</td>
        </tr>`;
    }).join('');

    const ownerHtml = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f7f5f3;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif">
<div style="max-width:560px;margin:28px auto;background:#fff;border-radius:4px;box-shadow:0 2px 16px rgba(0,0,0,.08)">
  <div style="padding:20px 32px;border-bottom:2px solid #C9971C">
    <table width="100%" cellpadding="0" cellspacing="0"><tr>
      <td style="vertical-align:middle;width:56px"><img src="cid:logo@freemanoutlet" width="48" alt=""/></td>
      <td style="vertical-align:middle;padding-left:12px">
        <p style="margin:0;font-size:16px;font-weight:700;color:#1a1a1a">New Order Received</p>
        <p style="margin:3px 0 0;font-size:14px;font-weight:800;color:#C9971C">${displayId} &nbsp;·&nbsp; <span style="font-size:12px;font-weight:400;color:#aaa">${date}</span></p>
      </td>
    </tr></table>
  </div>
  <div style="padding:20px 32px">
    <table width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;margin-bottom:12px">
      <tr><td style="padding:5px 0;color:#999;width:80px">Name</td><td style="padding:5px 0;font-weight:700;color:#1a1a1a">${escHtml(customer.name)}</td></tr>
      <tr><td style="padding:5px 0;color:#999">Phone</td><td style="padding:5px 0"><a href="tel:+${waPhone}" style="color:#C9971C;text-decoration:none;font-weight:600">+${waPhone}</a></td></tr>
      <tr><td style="padding:5px 0;color:#999">Email</td><td style="padding:5px 0;color:#1a1a1a">${escHtml(customer.email)}</td></tr>
      ${customer.notes ? `<tr><td style="padding:5px 0;color:#999">Notes</td><td style="padding:5px 0;color:#888;font-style:italic">${escHtml(customer.notes)}</td></tr>` : ""}
    </table>
    <!-- Delivery highlight box -->
    <div style="background:#fff7f2;border:2px solid #C9971C;border-radius:8px;padding:14px 16px;margin-bottom:18px">
      <p style="margin:0 0 10px;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.14em;color:#C9971C">📦 Delivery Details</p>
      <table width="100%" cellpadding="0" cellspacing="0" style="font-size:13px">
        <tr><td style="padding:3px 0;color:#888;width:90px">Area</td><td style="padding:3px 0;font-weight:700;color:#1a1a1a">${escHtml(deliveryArea || deliveryZone || "—")}${deliveryArea && deliveryZone ? '<br><span style="font-size:11px;font-weight:400;color:#aaa">'+escHtml(deliveryZone)+'</span>' : ''}</td></tr>
        <tr><td style="padding:3px 0;color:#888">Delivery Fee</td><td style="padding:3px 0;font-weight:700;color:#1a1a1a">${parseFloat(deliveryPrice) > 0 ? "GH₵"+parseFloat(deliveryPrice).toFixed(2) : "<span style='color:#16a34a;font-weight:700'>Free</span>"}</td></tr>
        <tr><td style="padding:6px 0 3px;color:#888;vertical-align:top">Exact Address</td>
          <td style="padding:6px 0 3px;word-break:break-all">${/^https?:\/\//i.test(String(customer.address||'').trim()) ? '<a href="'+escHtml(customer.address)+'" target="_blank" rel="noopener" style="color:#C9971C;font-weight:700;text-decoration:underline">'+escHtml(customer.address)+'</a>' : '<strong style="color:#1a1a1a">'+(customer.address ? escHtml(customer.address) : '<em style="color:#dc2626">No address provided</em>')+'</strong>'}</td>
        </tr>
      </table>
    </div>
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:16px">
      <thead><tr>
        <th style="padding:8px 10px 8px 0;text-align:left;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:#aaa;border-bottom:1px solid #e8e0d8">Item</th>
        <th style="padding:8px;text-align:center;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:#aaa;border-bottom:1px solid #e8e0d8">Qty</th>
        <th style="padding:8px 0 8px 8px;text-align:right;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:#aaa;border-bottom:1px solid #e8e0d8">Price</th>
      </tr></thead>
      <tbody>${ownerRowsHtml}</tbody>
      <tfoot>
        ${(deliveryPrice > 0 || promoCode || bundleDiscount > 0) ? `
        <tr>
          <td colspan="2" style="padding:10px 0 4px;font-size:13px;color:#777;border-top:1px solid #e8e0d8">Items Sub Total</td>
          <td style="padding:10px 0 4px;text-align:right;font-size:13px;color:#777;border-top:1px solid #e8e0d8">GH₵${(subtotal || 0).toFixed(2)}</td>
        </tr>` : ''}
        ${(deliveryPrice > 0 || deliveryZone || deliveryArea) ? `
        <tr>
          <td colspan="2" style="padding:4px 0;font-size:13px;color:#555">Delivery — ${deliveryArea || deliveryZone || ''}${deliveryArea && deliveryZone ? '<br><span style="font-size:11px;color:#aaa">'+deliveryZone+'</span>' : ''}</td>
          <td style="padding:4px 0;text-align:right;font-size:13px;vertical-align:top;${deliveryPrice > 0 ? 'color:#555' : 'color:#16a34a'}">${deliveryPrice > 0 ? 'GH₵'+parseFloat(deliveryPrice).toFixed(2) : 'Free'}</td>
        </tr>` : ''}
        ${bundleDiscount > 0 ? `
        <tr>
          <td colspan="2" style="padding:4px 0 8px;font-size:13px;color:#16a34a">Bundle savings</td>
          <td style="padding:4px 0 8px;text-align:right;font-size:13px;color:#16a34a">−GH₵${parseFloat(bundleDiscount).toFixed(2)}</td>
        </tr>` : ''}
        ${promoCode && promoDiscount ? `
        <tr>
          <td colspan="2" style="padding:4px 0 8px;font-size:13px;color:#16a34a">Discount (${promoCode})</td>
          <td style="padding:4px 0 8px;text-align:right;font-size:13px;color:#16a34a">−GH₵${parseFloat(promoDiscount).toFixed(2)}</td>
        </tr>` : ''}
        <tr>
          <td colspan="2" style="padding:8px 0;font-size:14px;font-weight:700;color:#1a1a1a;border-top:2px solid #1a1a1a">Total Paid</td>
          <td style="padding:8px 0;text-align:right;font-size:16px;font-weight:800;color:#C9971C;border-top:2px solid #1a1a1a">GH₵${total.toFixed(2)}</td>
        </tr>
      </tfoot>
    </table>
    <a href="https://wa.me/${waPhone}" style="display:inline-block;background:#25d366;color:#fff;font-size:13px;font-weight:700;padding:10px 20px;border-radius:6px;text-decoration:none;margin-right:10px">WhatsApp Customer</a>
    <a href="mailto:${escHtml(customer.email)}" style="display:inline-block;background:#f3f4f6;color:#1a1a1a;font-size:13px;font-weight:700;padding:10px 20px;border-radius:6px;text-decoration:none">Reply by Email</a>
    <p style="margin:14px 0 0;font-size:11px;color:#bbb">Order ref: ${order.reference}</p>
  </div>
  ${SOCIAL_LINKS_HTML}
</div></body></html>`;

    await transporter.sendMail({
        from: `"Freeman Outlet Orders" <${GMAIL_USER}>`,
        to: STORE_EMAIL,
        subject: `${displayId} — New order from ${customer.name} — GH₵${total.toFixed(2)}`,
        html: ownerHtml,
        attachments: [LOGO_ATTACHMENT]
    });
}

async function sendStatusEmail(order, status) {
    if (!GMAIL_USER || GMAIL_USER.includes('REPLACE')) return;
    if (!order.customer || !order.customer.email) return;
    const { customer, id } = order;

    const isShipped = status === 'Shipped';
    const headline = isShipped ? 'Your order is on its way! 🚚' : 'Your order has been delivered! 🎉';
    const subline  = isShipped ? 'Dispatched & en route' : 'Delivered with love';
    const baseBody = isShipped
        ? `Great news — your order has been dispatched and is heading to you.`
        : `Your order has arrived! We hope you love your new pieces. If anything isn't right, WhatsApp us within 48 hours.`;

    // Shipping details block — only for dispatched orders
    const carrier = order.shippingCarrier || '';
    const riderPhone = order.shippingRiderPhone || '';
    const trackingLink = order.shippingTrackingLink || '';
    const shippingNote = order.shippingNote || '';
    const shippingBlock = isShipped && (carrier || riderPhone || trackingLink)
        ? `<div style="margin:16px 0 20px;padding:16px 20px;background:#fdf6f0;border-left:4px solid #C9971C;border-radius:0 8px 8px 0">
      <p style="margin:0 0 10px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.12em;color:#C9971C">Delivery Details</p>
      ${carrier    ? `<p style="margin:0 0 6px;font-size:13px;color:#1a1a1a"><strong>Carrier:</strong> ${carrier}</p>` : ''}
      ${riderPhone ? `<p style="margin:0 0 6px;font-size:13px;color:#1a1a1a"><strong>Rider phone:</strong> <a href="tel:${riderPhone}" style="color:#C9971C;text-decoration:none">${riderPhone}</a></p>` : ''}
      ${trackingLink ? `<p style="margin:0 0 6px;font-size:13px"><a href="${trackingLink}" style="color:#C9971C;font-weight:700;word-break:break-all">Track your order →</a></p>` : ''}
      ${shippingNote ? `<p style="margin:8px 0 0;font-size:13px;color:#555;font-style:italic">${shippingNote}</p>` : ''}
    </div>` : '';

    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
<link href="https://fonts.googleapis.com/css2?family=Dancing+Script:wght@700&display=swap" rel="stylesheet">
</head><body style="margin:0;padding:0;background:#f7f5f3;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif">
<div style="max-width:560px;margin:32px auto;background:#fff;border-radius:4px;box-shadow:0 2px 20px rgba(0,0,0,.08)">
  <div style="padding:24px 36px 20px;text-align:center;border-bottom:2px solid #C9971C">
    <img src="cid:logo@freemanoutlet" width="64" alt="Freeman Outlet" style="display:block;margin:0 auto 12px"/>
    <p style="margin:0;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.14em;color:#C9971C">${subline}</p>
  </div>
  <div style="padding:28px 36px">
    <h2 style="margin:0 0 14px;font-size:20px;font-weight:700;color:#1a1a1a">${headline}</h2>
    <p style="font-size:14px;color:#555;line-height:1.7;margin:0 0 16px">Hi <strong>${escHtml(customer.name)}</strong>, ${baseBody}</p>
    ${shippingBlock}
    <p style="margin:0 0 5px;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.12em;color:#aaa">Order Reference</p>
    <p style="margin:0 0 24px;font-size:13px;font-family:monospace;color:#1a1a1a">${id}</p>
    <a href="https://wa.me/${waStore()}" style="display:inline-block;background:linear-gradient(90deg,#C9971C,#A67C15);color:#fff;font-size:14px;font-weight:700;padding:12px 28px;border-radius:6px;text-decoration:none">${isShipped ? 'Contact us on WhatsApp' : 'Leave a Review'} →</a>
  </div>
  ${SOCIAL_LINKS_HTML}
</div></body></html>`;

    const transporter = makeTransporter();
    await transporter.sendMail({
        from: `"Freeman Outlet" <${GMAIL_USER}>`,
        to: customer.email,
        subject: isShipped ? `Your order is on its way! — ${id}` : `Your order has been delivered! — ${id}`,
        html,
        attachments: [LOGO_ATTACHMENT]
    });
}

// ── REVIEWS ────────────────────────────────────────────────────────────────

// GET: All reviews — storefront only sees approved ones; admin sees all
// Strip reviewerEmail/reviewerPhone before this reaches the public — those exist
// only for the admin-side verified-purchase check and were previously sent to
// every visitor once a review was approved.
app.get('/api/reviews', (req, res) => res.json(reviews.filter(r => r.approved !== false).map(({ reviewerEmail, reviewerPhone, ...r }) => r)));
app.get('/api/admin/reviews', requireAdminJWT, (req, res) => res.json(reviews));

// POST: Submit a review (public) — goes into pending queue
app.post('/api/reviews', (req, res) => {
    const { name, rating, message, location, email, phone } = req.body;
    if (!name || !rating || !message) return res.status(400).json({ success: false, message: 'Name, rating, and message are required.' });
    // Email used to be mandatory here for purchase verification — but checkout
    // only ever required phone (email is optional there), so every WhatsApp-only
    // customer had no way to pass this check and could never leave a review.
    // Phone is now accepted as an equally valid verification path.
    if ((!email || !email.trim()) && (!phone || !phone.trim())) return res.status(400).json({ success: false, message: 'Email or phone is required to verify your purchase.' });
    const r = parseInt(rating);
    if (r < 1 || r > 5) return res.status(400).json({ success: false, message: 'Rating must be 1–5.' });
    if (message.trim().length < 10) return res.status(400).json({ success: false, message: 'Review must be at least 10 characters.' });
    if (name.trim().length > 100 || message.trim().length > 2000 || (location || '').trim().length > 100)
        return res.status(400).json({ success: false, message: 'Input too long.' });
    // Verified purchase check — must have at least one delivered order, matched
    // by whichever of email/phone was given.
    const emailNorm = email ? email.toLowerCase().trim() : '';
    const phoneNorm = phone ? normalisePhone(phone) : '';
    const hasOrder = orders.some(o => o.customer && o.status === 'Delivered' && (
        (emailNorm && (o.customer.email||'').toLowerCase() === emailNorm) ||
        (phoneNorm && normalisePhone(o.customer.phone||'') === phoneNorm)
    ));
    if (!hasOrder) return res.status(403).json({ success: false, message: 'We could not find a completed order for that email/phone. Only customers who have ordered from us can leave a review.' });
    reviews.push({
        id: 'REV-' + Date.now(), name: name.trim(), location: (location || '').trim(),
        rating: r, message: message.trim(), createdAt: Date.now(), approved: false,
        verified: true, reviewerEmail: emailNorm, reviewerPhone: phoneNorm
    });
    saveJSON(REVIEWS_FILE, reviews);
    res.json({ success: true, message: 'Thank you! Your review is pending approval.' });
});

// PATCH: Approve or reject a review (admin only)
app.patch('/api/reviews/:id/approve', requireAdminJWT, (req, res) => {
    const rev = reviews.find(r => r.id === req.params.id);
    if (!rev) return res.status(404).json({ success: false, message: 'Review not found.' });
    rev.approved = req.body.approved !== false;
    rev.approvedBy = req.adminUsername || 'admin';
    rev.approvedAt = new Date().toISOString();
    saveJSON(REVIEWS_FILE, reviews);
    res.json({ success: true, review: rev });
});

// DELETE: Remove a review (admin only)
app.delete('/api/reviews/:id', requireAdminJWT, requireManagerOrOwner, (req, res) => {
    reviews = reviews.filter(r => r.id !== req.params.id);
    saveJSON(REVIEWS_FILE, reviews);
    res.json({ success: true });
});

// ── ORDERS ─────────────────────────────────────────────────────────────────

// GET: All orders (admin only) — supports ?q= search
app.get('/api/orders', requireAdminJWT, (req, res) => {
    const q = (req.query.q || '').toLowerCase().trim();
    if (!q) return res.json(orders);
    const filtered = orders.filter(o => {
        const c = o.customer || {};
        return (c.name  || '').toLowerCase().includes(q) ||
               (c.phone || '').toLowerCase().includes(q) ||
               (c.email || '').toLowerCase().includes(q) ||
               (o.id    || '').toLowerCase().includes(q) ||
               (o.reference || '').toLowerCase().includes(q) ||
               (o.items || []).some(i => (i.name || '').toLowerCase().includes(q));
    });
    res.json(filtered);
});

// PATCH: Update tracking number
app.patch('/api/orders/:id/tracking', requireAdminJWT, (req, res) => {
    const order = orders.find(o => o.id === req.params.id);
    if (!order) return res.status(404).json({ success: false, message: 'Order not found.' });
    order.trackingNumber = (req.body.trackingNumber || '').trim();
    order.trackingCarrier = (req.body.trackingCarrier || '').trim();
    order.trackingUpdatedBy = req.adminUsername || 'admin';
    order.trackingUpdatedAt = new Date().toISOString();
    // This admin-drawer quick-edit used to be a fully separate data field from
    // shippingCarrier/shippingTrackingLink/etc — the ones actually read by the
    // customer's /track page, the shipped-order email, and the orders CSV
    // export. Saving here was a real no-op from the customer's point of view:
    // the number went in, but nothing that shows a customer their delivery
    // status ever looked at it. Mirroring into the canonical fields (as a
    // plain-text note rather than a link — a tracking NUMBER isn't necessarily
    // a URL, so it can't safely become shippingTrackingLink's href) makes this
    // form actually do something.
    if (order.trackingCarrier) order.shippingCarrier = order.trackingCarrier;
    if (order.trackingNumber) order.shippingNote = `Tracking #: ${order.trackingNumber}`;
    saveJSON(ORDERS_FILE, orders);
    res.json({ success: true, order });
});

// PATCH: Add/update internal admin note on order
app.patch('/api/orders/:id/note', requireAdminJWT, (req, res) => {
    const order = orders.find(o => o.id === req.params.id);
    if (!order) return res.status(404).json({ success: false, message: 'Order not found.' });
    const note = (req.body.note || '').trim();
    const author = req.adminUsername || req.adminUser?.username || ADMIN_USER;
    if (!order.adminNotes) order.adminNotes = [];
    if (note) order.adminNotes.push({ text: note, author, at: new Date().toISOString() });
    saveJSON(ORDERS_FILE, orders);
    res.json({ success: true, order });
});

// POST: Bulk status update
app.post('/api/orders/bulk-status', requireAdminJWT, (req, res) => {
    const { ids, status } = req.body;
    const valid = ['Pending', 'Processing', 'Shipped', 'Delivered', 'Returned', 'Refunded'];
    if (!Array.isArray(ids) || !valid.includes(status))
        return res.status(400).json({ success: false, message: 'ids array and valid status required.' });
    let updated = 0;
    ids.forEach(id => {
        const order = orders.find(o => o.id === id);
        if (!order) return;
        order.status = status;
        if ((status === 'Shipped' || status === 'Delivered') && !order.stockDeducted) {
            deductStock((order.items || []).map(i => ({ id: i.id, color: i.color, quantity: parseInt(i.quantity, 10) || 1 })));
            order.stockDeducted = true;
        }
        updated++;
    });
    if (updated) { saveJSON(ORDERS_FILE, orders); saveJSON(PRODUCTS_FILE, products); }
    res.json({ success: true, updated });
});

// PATCH: Mark order as Returned or Refunded
app.patch('/api/orders/:id/return', requireAdminJWT, (req, res) => {
    const order = orders.find(o => o.id === req.params.id);
    if (!order) return res.status(404).json({ success: false, message: 'Order not found.' });
    const { status, refundAmount, returnReason } = req.body;
    const valid = ['Returned', 'Refunded'];
    if (!valid.includes(status)) return res.status(400).json({ success: false, message: 'status must be Returned or Refunded.' });
    order.status       = status;
    order.refundAmount = parseFloat(refundAmount) || 0;
    order.returnReason = (returnReason || '').trim();
    order.returnedAt   = new Date().toISOString();
    order.returnedBy   = req.adminUsername || 'admin';
    // Restore the stock this order deducted at checkout — nothing did this before,
    // so a returned/refunded order left inventory permanently short by the
    // returned quantity even though the goods physically came back. Guarded by
    // stockRestored so marking Returned then Refunded on the same order (or any
    // other double-call) doesn't restore the same units twice.
    if (order.stockDeducted && !order.stockRestored) {
        restoreStock(order.items, status.toLowerCase(), order.orderNo ? '#' + order.orderNo : order.id);
        order.stockRestored = true;
    }
    saveJSON(ORDERS_FILE, orders);
    res.json({ success: true, order });
});

// /admin alias handled above

// ── PROMO CODES ────────────────────────────────────────────────────────────

app.post('/api/validate-code', (req, res) => {
    const { code, orderTotal } = req.body;
    if (!code) return res.status(400).json({ success: false, message: 'No code provided.' });
    const found = codes.find(c => c.code === code.toUpperCase().trim());
    if (!found) return res.status(404).json({ success: false, message: 'Invalid promo code.' });
    // Check expiry
    if (found.expiresAt && Date.now() > found.expiresAt) return res.status(400).json({ success: false, message: 'This promo code has expired.' });
    // Check usage limit
    if (found.maxUses && promoUsageCount(found.code) >= found.maxUses) return res.status(400).json({ success: false, message: 'This promo code has reached its usage limit.' });
    const total = parseFloat(orderTotal) || 0;
    if (found.minOrder && total < found.minOrder) {
        return res.status(400).json({ success: false, message: `Minimum order of GH₵${found.minOrder} required for this code.` });
    }
    const discount = found.type === 'percent'
        ? Math.min(total, Math.round(total * found.value) / 100)
        : Math.min(found.value, total);
    res.json({ success: true, code: found.code, type: found.type, value: found.value, discount: Math.round(discount * 100) / 100 });
});

// Single source of truth for a promo code's usage count — computed live from
// orders rather than trusting the stored code.usedCount counter. That counter
// only ever went up (incremented at checkout, never decremented when an order
// using the code was later deleted/returned) while this same live count was
// already what GET /api/codes displayed to the admin — so the admin's screen
// and the actual enforcement check at checkout disagreed after any deletion.
function promoUsageCount(codeStr) {
    return orders.reduce((n, o) => n + (o.promoCode === codeStr ? 1 : 0), 0);
}

app.get('/api/codes', requireAdminJWT, (req, res) => {
    const revenueMap = {};
    orders.forEach(o => {
        if (o.promoCode) revenueMap[o.promoCode] = (revenueMap[o.promoCode] || 0) + parseFloat(o.total || 0);
    });
    res.json(codes.map(c => ({ ...c, usedCount: promoUsageCount(c.code), totalRevenue: revenueMap[c.code] || 0 })));
});

app.post('/api/codes', requireAdminJWT, (req, res) => {
    const { code, type, value, minOrder, maxUses, expiresAt, referrer } = req.body;
    if (!code || !type || !value) return res.status(400).json({ success: false, message: 'Code, type, and value are required.' });
    if (codes.find(c => c.code === code.toUpperCase().trim())) {
        return res.status(400).json({ success: false, message: 'That code already exists.' });
    }
    const newCode = {
        code: code.toUpperCase().trim(), type, value: parseFloat(value),
        minOrder: parseFloat(minOrder) || 0,
        maxUses: parseInt(maxUses, 10) || 0,
        expiresAt: expiresAt ? new Date(expiresAt).getTime() : null,
        referrer: (referrer || '').trim() || null,
        usedCount: 0, createdAt: Date.now(), createdBy: req.adminUsername || 'admin'
    };
    codes.push(newCode);
    saveJSON(CODES_FILE, codes);
    res.json({ success: true, code: newCode });
});

app.delete('/api/codes/:code', requireAdminJWT, requireManagerOrOwner, (req, res) => {
    codes = codes.filter(c => c.code !== req.params.code.toUpperCase());
    saveJSON(CODES_FILE, codes);
    res.json({ success: true });
});

// ── DELIVERY ZONES ─────────────────────────────────────────────────────────

app.get('/api/delivery', (req, res) => res.json(delivery));

app.post('/api/delivery', requireAdminJWT, (req, res) => {
    const { name, region, price, address } = req.body;
    if (!name || price === undefined || price === '') return res.status(400).json({ success: false, message: 'Name and price are required.' });
    const parsed = parseFloat(price);
    if (isNaN(parsed) || parsed < 0) return res.status(400).json({ success: false, message: 'Price must be a valid number.' });
    const zone = { id: 'DZ-' + Date.now(), name: name.trim(), region: (region || '').trim(), price: parsed, address: (address || '').trim() };
    delivery.push(zone);
    saveJSON(DELIVERY_FILE, delivery);
    res.json({ success: true, zone });
});

app.delete('/api/delivery/:id', requireAdminJWT, requireManagerOrOwner, (req, res) => {
    const before = delivery.length;
    delivery = delivery.filter(z => z.id !== req.params.id);
    if (delivery.length === before) return res.status(404).json({ success: false, message: 'Zone not found.' });
    saveJSON(DELIVERY_FILE, delivery);
    res.json({ success: true });
});

// ── ZONE MAP (all regions) ─────────────────────────────────────────────────

// GET full map OR a single region: /api/zone-map?region=Ashanti
app.get('/api/zone-map', (req, res) => {
    const region = req.query.region;
    if (region) {
        if (!zoneMap[region]) return res.status(404).json({ success: false, message: 'Region not found.' });
        return res.json(zoneMap[region]);
    }
    res.json(zoneMap);
});

// PUT tier prices for a region: body { region, tiers }
app.put('/api/zone-map/tiers', requireAdminJWT, (req, res) => {
    const { tiers, region = 'Greater Accra' } = req.body;
    if (!tiers || typeof tiers !== 'object') return res.status(400).json({ success: false, message: 'tiers object required.' });
    if (!GH_REGIONS_LIST.includes(region)) return res.status(400).json({ success: false, message: 'Invalid region.' });
    if (!zoneMap[region]) zoneMap[region] = { tiers: JSON.parse(JSON.stringify(DEFAULT_ZONE_TIERS)), areas: [] };
    Object.keys(tiers).forEach(k => {
        if (!zoneMap[region].tiers[k]) zoneMap[region].tiers[k] = { label: 'Zone ' + k, price: 0 };
        const p = parseFloat(tiers[k].price);
        if (!isNaN(p)) zoneMap[region].tiers[k].price = p;
        if (tiers[k].label) zoneMap[region].tiers[k].label = tiers[k].label;
    });
    saveJSON(ZONE_MAP_FILE, zoneMap);
    res.json({ success: true, tiers: zoneMap[region].tiers });
});

// PUT areas for a region: body { region, areas }
app.put('/api/zone-map/areas', requireAdminJWT, (req, res) => {
    const { areas, region = 'Greater Accra' } = req.body;
    if (!Array.isArray(areas)) return res.status(400).json({ success: false, message: 'areas array required.' });
    if (!GH_REGIONS_LIST.includes(region)) return res.status(400).json({ success: false, message: 'Invalid region.' });
    if (!zoneMap[region]) zoneMap[region] = { tiers: JSON.parse(JSON.stringify(DEFAULT_ZONE_TIERS)), areas: [] };
    zoneMap[region].areas = areas.map(a => ({ name: String(a.name || '').trim(), zone: String(a.zone || '1') })).filter(a => a.name);
    saveJSON(ZONE_MAP_FILE, zoneMap);
    res.json({ success: true, count: zoneMap[region].areas.length });
});

// ── REGIONAL RATES ─────────────────────────────────────────────────────────

app.get('/api/region-rates', (req, res) => res.json(regionRates));

app.put('/api/region-rates', requireAdminJWT, (req, res) => {
    const updates = req.body;
    if (!updates || typeof updates !== 'object') return res.status(400).json({ success: false, message: 'Object required.' });
    Object.keys(updates).forEach(region => {
        if (GH_REGIONS_LIST.includes(region) && updates[region]) {
            const price   = parseFloat(updates[region].price);
            const enabled = updates[region].enabled === true || updates[region].enabled === 'true';
            regionRates[region] = { price: isNaN(price) ? 0 : price, enabled };
        }
    });
    saveJSON(REGION_RATES_FILE, regionRates);
    res.json({ success: true, regionRates });
});

// ── CATEGORIES ─────────────────────────────────────────────────────────────

app.get('/api/categories', (req, res) => res.json(categories));

app.post('/api/categories', requireAdminJWT, (req, res) => {
    const { name } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ success: false, message: 'Category name is required.' });
    const trimmed = name.trim();
    if (categories.find(c => c.name.toLowerCase() === trimmed.toLowerCase())) {
        return res.status(400).json({ success: false, message: 'Category already exists.' });
    }
    const cat = { name: trimmed, enabled: true };
    categories.push(cat);
    saveJSON(CATEGORIES_FILE, categories);
    res.json({ success: true, category: cat });
});

app.put('/api/categories/reorder', requireAdminJWT, (req, res) => {
    const { order } = req.body;
    if (!Array.isArray(order)) return res.status(400).json({ success: false, message: 'order must be an array.' });
    const catMap = Object.fromEntries(categories.map(c => [c.name.toLowerCase(), c]));
    const reordered = order.map(name => catMap[name.toLowerCase()]).filter(Boolean);
    const orderedSet = new Set(order.map(n => n.toLowerCase()));
    const extras = categories.filter(c => !orderedSet.has(c.name.toLowerCase()));
    categories = [...reordered, ...extras];
    saveJSON(CATEGORIES_FILE, categories);
    res.json({ success: true, categories });
});

app.put('/api/categories/:name/toggle', requireAdminJWT, (req, res) => {
    const cat = categories.find(c => c.name.toLowerCase() === req.params.name.toLowerCase());
    if (!cat) return res.status(404).json({ success: false, message: 'Category not found.' });
    cat.enabled = !cat.enabled;
    saveJSON(CATEGORIES_FILE, categories);
    res.json({ success: true, category: cat });
});

app.delete('/api/categories/:name', requireAdminJWT, requireManagerOrOwner, (req, res) => {
    const nameLower = req.params.name.toLowerCase();
    const before = categories.length;
    categories = categories.filter(c => c.name.toLowerCase() !== nameLower);
    if (categories.length === before) return res.status(404).json({ success: false, message: 'Category not found.' });
    saveJSON(CATEGORIES_FILE, categories);
    // Clear category field on products that referenced this category
    let changed = false;
    products.forEach(p => {
        if ((p.category || '').toLowerCase() === nameLower) { p.category = ''; changed = true; }
    });
    if (changed) saveJSON(PRODUCTS_FILE, products);
    res.json({ success: true });
});

// ── SETTINGS ───────────────────────────────────────────────────────────────

// ── BOOTSTRAP — single call returns everything the storefront needs on first load
app.get('/api/bootstrap', (req, res) => {
    const merged = { ...SETTINGS_DEFAULTS, ...settings };
    ['invoiceAccountName', 'invoiceAccountNo'].forEach(k => delete merged[k]);
    const pub = products
        .filter(p => p.isListed !== false)
        .map(p => Object.fromEntries(PUBLIC_PRODUCT_FIELDS.filter(k => k in p).map(k => [k, p[k]])));
    const enabledCats = categories.filter(c => c.enabled !== false);
    const zm = zoneMap;
    res.json({ settings: merged, products: pub, categories: enabledCats, zoneMap: zm });
});

// Public settings — strip admin-only fields (bank account). storeEmail is the
// store's own public contact address (shown in the storefront footer) — it is
// NOT a credential and must stay public, unlike the bank fields it was
// previously grouped with here.
const SETTINGS_PRIVATE_KEYS = ['invoiceAccountName', 'invoiceAccountNo'];
app.get('/api/settings', (req, res) => {
    const merged = { ...SETTINGS_DEFAULTS, ...settings };
    SETTINGS_PRIVATE_KEYS.forEach(k => delete merged[k]);
    res.json(merged);
});
app.get('/api/admin/settings', requireAdminJWT, (req, res) => {
    const merged = { ...SETTINGS_DEFAULTS, ...settings };
    // Bank account details are owner-only. The dashboard also hides these
    // fields from managers/staff with CSS, but that alone still sent the real
    // values to the page before hiding them — strip them at the source instead.
    if (req.adminRole !== 'owner') { delete merged.invoiceAccountName; delete merged.invoiceAccountNo; }
    res.json(merged);
});

// ── BROADCAST HELPERS ─────────────────────────────────────────────────────

async function sendBroadcast(recipients, subject, htmlBody) {
    if (!GMAIL_PASS) throw new Error('GMAIL_PASS not set');
    const transporter = makeTransporter();
    let sent = 0, failed = 0;
    for (const r of recipients) {
        try {
            await transporter.sendMail({
                from: `"${settings.storeName || 'Freeman Outlet'}" <${GMAIL_USER}>`,
                to: r.email,
                subject,
                html: htmlBody.replace(/{{name}}/g, r.name || 'Valued Customer')
            });
            sent++;
        } catch(e) {
            console.error(`[BROADCAST] Failed to send to ${r.email}: ${e.message}`);
            failed++;
        }
    }
    return { sent, failed };
}

// Owner-only: all three broadcast endpoints accept an arbitrary recipients[]
// array straight from the request body with no check that those addresses
// belong to real customers, so any role that could reach these could use the
// store's own Gmail account to mass-email anyone.
app.post('/api/admin/broadcast', requireAdminJWT, requireOwner, async (req, res) => {
    const { subject, message, recipients } = req.body;
    if (!subject || !message || !Array.isArray(recipients) || !recipients.length)
        return res.status(400).json({ success: false, message: 'subject, message and recipients are required.' });
    try {
        const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f7f5f3;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif">
<div style="max-width:560px;margin:32px auto;background:#fff;border-radius:4px;box-shadow:0 2px 20px rgba(0,0,0,.08)">
  <div style="padding:24px 36px 20px;text-align:center;border-bottom:2px solid #C9971C">
    <p style="margin:0;font-size:22px;font-weight:800;color:#C9971C;letter-spacing:-.5px">${settings.storeName || 'Freeman Outlet'}</p>
  </div>
  <div style="padding:28px 36px">
    <p style="font-size:15px;color:#1a1a1a;margin:0 0 16px">Hi <strong>{{name}}</strong>,</p>
    <div style="font-size:14px;color:#444;line-height:1.8;white-space:pre-wrap">${message.replace(/</g,'&lt;').replace(/>/g,'&gt;')}</div>
  </div>
  <div style="padding:16px 36px 24px;text-align:center;border-top:1px solid #f0ede9">
    <a href="https://wa.me/${waStore()}" style="display:inline-block;background:#C9971C;color:#fff;font-size:13px;font-weight:700;padding:10px 24px;border-radius:6px;text-decoration:none">Shop Now →</a>
  </div>
  <div style="padding:12px 36px 20px;text-align:center;border-top:1px solid #f0ede9">
    <p style="margin:0;font-size:11px;color:#bbb">© ${new Date().getFullYear()} ${settings.storeName || 'Freeman Outlet'} Ghana</p>
  </div>
</div></body></html>`;
        const result = await sendBroadcast(recipients, subject, html);
        res.json({ success: true, ...result });
    } catch(e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

app.post('/api/admin/broadcast-promo', requireAdminJWT, requireOwner, async (req, res) => {
    const { code, message, recipients } = req.body;
    if (!code || !Array.isArray(recipients) || !recipients.length)
        return res.status(400).json({ success: false, message: 'code and recipients are required.' });
    const promoCode = code.toUpperCase().trim();
    const found = codes.find(c => c.code === promoCode);
    const discount = found ? (found.type === 'percent' ? found.value + '% off' : 'GH₵' + found.value + ' off') : 'exclusive discount';
    const extraMsg = message ? `<p style="font-size:14px;color:#444;line-height:1.8;margin:0 0 20px">${message.replace(/</g,'&lt;').replace(/>/g,'&gt;')}</p>` : '';
    try {
        const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f7f5f3;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif">
<div style="max-width:560px;margin:32px auto;background:#fff;border-radius:4px;box-shadow:0 2px 20px rgba(0,0,0,.08)">
  <div style="padding:24px 36px 20px;text-align:center;border-bottom:2px solid #C9971C">
    <p style="margin:0;font-size:22px;font-weight:800;color:#C9971C">🎁 Special Offer for You</p>
  </div>
  <div style="padding:28px 36px">
    <p style="font-size:15px;color:#1a1a1a;margin:0 0 16px">Hi <strong>{{name}}</strong>,</p>
    ${extraMsg}
    <p style="font-size:14px;color:#444;margin:0 0 20px">Use the code below to get <strong>${discount}</strong> on your next order:</p>
    <div style="text-align:center;margin:24px 0">
      <span style="display:inline-block;background:#fff7f2;border:2px dashed #C9971C;border-radius:10px;padding:14px 32px;font-size:26px;font-weight:900;letter-spacing:4px;color:#C9971C">${promoCode}</span>
    </div>
    ${found && found.minOrder ? `<p style="font-size:12px;color:#aaa;text-align:center;margin:0 0 20px">Minimum order: GH₵${found.minOrder}</p>` : ''}
    <div style="text-align:center">
      <a href="https://wa.me/${waStore()}" style="display:inline-block;background:#C9971C;color:#fff;font-size:13px;font-weight:700;padding:12px 28px;border-radius:6px;text-decoration:none">Shop Now & Save →</a>
    </div>
  </div>
  <div style="padding:16px 36px 20px;text-align:center;border-top:1px solid #f0ede9">
    <p style="margin:0;font-size:11px;color:#bbb">© ${new Date().getFullYear()} ${settings.storeName || 'Freeman Outlet'} Ghana</p>
  </div>
</div></body></html>`;
        const result = await sendBroadcast(recipients, `🎁 ${discount} — Your exclusive code inside`, html);
        res.json({ success: true, ...result });
    } catch(e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

app.post('/api/admin/broadcast-product', requireAdminJWT, requireOwner, async (req, res) => {
    const { productId, message, recipients } = req.body;
    if (!productId || !Array.isArray(recipients) || !recipients.length)
        return res.status(400).json({ success: false, message: 'productId and recipients are required.' });
    const product = products.find(p => p.id === productId);
    if (!product) return res.status(404).json({ success: false, message: 'Product not found.' });
    const extraMsg = message ? `<p style="font-size:14px;color:#444;line-height:1.8;margin:0 0 20px">${message.replace(/</g,'&lt;').replace(/>/g,'&gt;')}</p>` : '';
    try {
        const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f7f5f3;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif">
<div style="max-width:560px;margin:32px auto;background:#fff;border-radius:4px;box-shadow:0 2px 20px rgba(0,0,0,.08)">
  <div style="padding:24px 36px 20px;text-align:center;border-bottom:2px solid #C9971C">
    <p style="margin:0;font-size:22px;font-weight:800;color:#C9971C">✨ New Arrival</p>
  </div>
  <div style="padding:28px 36px">
    <p style="font-size:15px;color:#1a1a1a;margin:0 0 16px">Hi <strong>{{name}}</strong>,</p>
    ${product.image ? `<div style="text-align:center;margin-bottom:20px"><img src="${product.image.replace(/"/g,'&quot;')}" alt="${(product.name||'').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')}" style="max-width:220px;border-radius:12px;box-shadow:0 4px 16px rgba(0,0,0,.12)"/></div>` : ''}
    <p style="font-size:20px;font-weight:800;color:#1a1a1a;margin:0 0 8px">${(product.name||'').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</p>
    ${product.desc ? `<p style="font-size:13px;color:#666;line-height:1.7;margin:0 0 16px">${product.desc.slice(0,180).replace(/</g,'&lt;').replace(/>/g,'&gt;')}${product.desc.length>180?'…':''}</p>` : ''}
    ${extraMsg}
    <p style="font-size:24px;font-weight:900;color:#C9971C;margin:0 0 20px">GH₵${parseFloat(product.price).toFixed(2)}</p>
    <div style="text-align:center">
      <a href="https://wa.me/${waStore()}" style="display:inline-block;background:#C9971C;color:#fff;font-size:13px;font-weight:700;padding:12px 28px;border-radius:6px;text-decoration:none">Shop Now →</a>
    </div>
  </div>
  <div style="padding:16px 36px 20px;text-align:center;border-top:1px solid #f0ede9">
    <p style="margin:0;font-size:11px;color:#bbb">© ${new Date().getFullYear()} ${settings.storeName || 'Freeman Outlet'} Ghana</p>
  </div>
</div></body></html>`;
        const result = await sendBroadcast(recipients, `✨ New Arrival: ${product.name}`, html);
        res.json({ success: true, ...result });
    } catch(e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

app.post('/api/admin/test-email', requireAdminJWT, async (req, res) => {
    if (!GMAIL_PASS) return res.status(500).json({ success: false, message: 'GMAIL_PASS not set in environment.' });
    try {
        const transporter = makeTransporter();
        await transporter.verify();
        await transporter.sendMail({
            from: `"Freeman Outlet" <${GMAIL_USER}>`,
            to: STORE_EMAIL,
            subject: '✅ Test Email — Freeman Outlet Server',
            html: `<p style="font-family:sans-serif">Your email configuration is working correctly.</p><p style="font-family:sans-serif;color:#888;font-size:12px">Sent from Freeman Outlet server at ${new Date().toISOString()}</p>`
        });
        res.json({ success: true, message: `Test email sent to ${STORE_EMAIL}` });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

app.put('/api/settings', requireAdminJWT, requireManagerOrOwner, (req, res) => {
    let allowed = ['storeName','announcement','announcementOn','whatsapp','instagram','facebook','tiktok','snapchat','storeEmail','shopOpen','shopClosedMsg','heroPill','heroHeadline','heroSub','aboutHeading','aboutBody','footerTagline','trustLine1','trustLine2','trustLine3','trustLine4','freeDeliveryThreshold','freeDeliveryZone','featuredBannerEnabled','featuredBannerHeadline','featuredBannerSub','featuredBannerCta','featuredBannerLink','saleEnabled','saleEndDate','saleMessage','brandVideoUrl','brandVideoTitle','heroVideoEnabled','seoTitle','seoDescription','accentColor','fontBody','stockAlertEnabled','stockAlertThreshold','ownerEmail','ownerPhone','backupEnabled','invoiceAccountName','invoiceAccountNo','minOrderAmount','invoiceTin'];
    // Bank account fields are owner-only — GET /api/admin/settings no longer sends
    // their real values to a manager/staff session, so a save from that session
    // would otherwise overwrite the real numbers with blanks.
    if (req.adminRole !== 'owner') allowed = allowed.filter(k => k !== 'invoiceAccountName' && k !== 'invoiceAccountNo');
    allowed.forEach(k => { if (req.body[k] !== undefined) settings[k] = req.body[k]; });
    settings._lastSavedBy = req.adminUsername || 'admin';
    settings._lastSavedAt = new Date().toISOString();
    saveJSON(SETTINGS_FILE, settings);
    res.json({ success: true, settings });
});

// ── STOCK MOVEMENT HELPER ──────────────────────────────────────────────────
let _movementSaveTimer = null;
function logMovement({ productId, productName, variant, qty, type, reason, ref, editedBy }) {
    movements.push({ id: 'mv-' + Date.now() + '-' + Math.random().toString(36).slice(2,6), productId, productName, variant: variant || null, qty, type, reason: reason || '', ref: ref || null, editedBy: editedBy || null, createdAt: Date.now() });
    clearTimeout(_movementSaveTimer);
    _movementSaveTimer = setTimeout(() => saveJSON(MOVEMENTS_FILE, movements), 500);
}

// ── STOCK INTAKES ──────────────────────────────────────────────────────────
app.get('/api/stock-intakes', requireAdminJWT, (req, res) => res.json(intakes));

app.post('/api/stock-intakes', requireAdminJWT, (req, res) => {
    const { supplier, date, notes, lines } = req.body;
    if (!Array.isArray(lines) || !lines.length) return res.status(400).json({ success: false, message: 'No intake lines provided.' });
    const intake = { id: 'si-' + Date.now(), supplier: supplier || '', date: date || new Date().toISOString(), notes: notes || '', lines, createdAt: Date.now(), createdBy: req.adminUsername || 'admin' };
    // Apply stock increases to products
    lines.forEach(line => {
        const p = products.find(p => p.id === line.productId);
        if (!p) return;
        const qty = parseInt(line.qty) || 0;
        if (!qty) return;
        if (line.variant && line.variant !== 'all') {
            // variant-level stock — use canonical colour name from rich variant array (case-insensitive match)
            if (!p.variantStock) p.variantStock = {};
            if (Array.isArray(p.variants) && p.variants.length && typeof p.variants[0] === 'object') {
                const rv = p.variants.find(v => v.color.toLowerCase() === line.variant.toLowerCase());
                const stockKey = rv ? rv.color : line.variant; // prefer canonical name
                p.variantStock[stockKey] = (p.variantStock[stockKey] || 0) + qty;
                if (rv) rv.stock = p.variantStock[stockKey];
                p.stock = p.variants.reduce((s, v) => s + (v.stock || 0), 0);
            } else {
                p.variantStock[line.variant] = (p.variantStock[line.variant] || 0) + qty;
                p.stock = Object.values(p.variantStock).reduce((a, b) => a + (parseInt(b, 10) || 0), 0);
            }
        } else {
            // Guard: don't convert null (unlimited) stock to tracked finite stock
            if (p.stock === null || p.stock === undefined) {
                console.warn(`[INTAKE] Product "${p.name}" has unlimited stock (null) — skipping total-stock update`);
            } else {
                p.stock = (parseInt(p.stock, 10) || 0) + qty;
            }
        }
        if (p.stock > 0) p.isSoldOut = false;
        p.updatedAt = Date.now();
        logMovement({ productId: p.id, productName: p.name, variant: line.variant || null, qty, type: 'intake', reason: `Intake from ${supplier || 'supplier'}`, ref: intake.id, editedBy: req.adminUsername || 'admin' });
    });
    saveJSON(PRODUCTS_FILE, products);
    intakes.unshift(intake);
    saveJSON(INTAKES_FILE, intakes);
    res.json({ success: true, intake });
});

app.delete('/api/stock-intakes/:id', requireAdminJWT, requireManagerOrOwner, (req, res) => {
    const before = intakes.length;
    intakes = intakes.filter(i => i.id !== req.params.id);
    if (intakes.length === before) return res.status(404).json({ success: false, message: 'Intake not found.' });
    saveJSON(INTAKES_FILE, intakes);
    res.json({ success: true });
});

// ── STOCK MOVEMENTS LOG ────────────────────────────────────────────────────
app.get('/api/stock-movements', requireAdminJWT, (req, res) => {
    const pid = req.query.productId;
    res.json(pid ? movements.filter(m => m.productId === pid) : movements.slice(0, 500));
});

// CSV export of all stock movements
app.get('/api/stock-movements/export.csv', requireAdminJWT, (req, res) => {
    const rows = [['Date','Product','Variant','Qty Change','Type','Reason','Ref','Done By']];
    movements.slice().reverse().forEach(m => {
        rows.push([
            new Date(m.createdAt).toISOString().replace('T',' ').slice(0,19),
            m.productName || '', m.variant || '', m.qty, m.type || '', m.reason || '', m.ref || '', m.editedBy || ''
        ]);
    });
    const csv = rows.map(r => r.map(v => '"' + String(v).replace(/"/g,'""') + '"').join(',')).join('\r\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="stock-movements-${new Date().toISOString().slice(0,10)}.csv"`);
    res.send(csv);
});

// sort-order route moved — see before PUT /api/products/:id

// ── INVENTORY ACCOUNTING METADATA ──────────────────────────────────────────
app.get('/api/inventory/meta', requireAdminJWT, (req, res) => res.json(invMeta));
app.put('/api/inventory/meta/:productId', requireAdminJWT, (req, res) => {
    invMeta[req.params.productId] = req.body;
    saveJSON(INV_META_FILE, invMeta);
    res.json({ success: true });
});
app.delete('/api/inventory/meta/:productId', requireAdminJWT, requireManagerOrOwner, (req, res) => {
    delete invMeta[req.params.productId];
    saveJSON(INV_META_FILE, invMeta);
    res.json({ success: true });
});

// ── VARIANT STOCK ──────────────────────────────────────────────────────────
app.patch('/api/products/:id/variant-stock', requireAdminJWT, (req, res) => {
    const p = products.find(p => p.id === req.params.id);
    if (!p) return res.status(404).json({ success: false, message: 'Product not found.' });
    const { variant, qty, reason } = req.body;
    if (!variant) return res.status(400).json({ success: false, message: 'variant required.' });
    const newQty = qty === null || qty === '' ? 0 : parseInt(qty) || 0;
    if (!p.variantStock) p.variantStock = {};
    const prev = p.variantStock[variant] || 0;
    const diff = newQty - prev;
    p.variantStock[variant] = newQty;
    // Also sync rich variant array if present
    if (Array.isArray(p.variants) && p.variants.length && typeof p.variants[0] === 'object') {
        const rv = p.variants.find(v => v.color === variant);
        if (rv) rv.stock = newQty;
        p.stock = p.variants.reduce((s, v) => s + (v.stock || 0), 0);
    } else {
        p.stock = Object.values(p.variantStock).reduce((a, b) => a + (parseInt(b, 10) || 0), 0);
    }
    if (p.stock > 0) p.isSoldOut = false;
    if (p.stock === 0) p.isSoldOut = true;
    p.updatedAt = Date.now();
    saveJSON(PRODUCTS_FILE, products);
    if (diff !== 0) logMovement({ productId: p.id, productName: p.name, variant, qty: diff, type: 'adjustment', reason: reason || 'Manual edit', ref: null });
    res.json({ success: true, product: p });
});

// ── FAQs ───────────────────────────────────────────────────────────────────

app.get('/api/faqs', (req, res) => res.json(faqs));

app.post('/api/faqs', requireAdminJWT, (req, res) => {
    const { q, a } = req.body;
    if (!q || !a) return res.status(400).json({ success: false, message: 'Question and answer required.' });
    const faq = { id: 'faq-' + Date.now(), q, a };
    faqs.push(faq);
    saveJSON(FAQS_FILE, faqs);
    res.json({ success: true, faq });
});

app.put('/api/faqs/:id', requireAdminJWT, (req, res) => {
    const faq = faqs.find(f => f.id === req.params.id);
    if (!faq) return res.status(404).json({ success: false, message: 'FAQ not found.' });
    if (req.body.q !== undefined) faq.q = req.body.q;
    if (req.body.a !== undefined) faq.a = req.body.a;
    saveJSON(FAQS_FILE, faqs);
    res.json({ success: true, faq });
});

app.delete('/api/faqs/:id', requireAdminJWT, requireManagerOrOwner, (req, res) => {
    const before = faqs.length;
    faqs = faqs.filter(f => f.id !== req.params.id);
    if (faqs.length === before) return res.status(404).json({ success: false, message: 'FAQ not found.' });
    saveJSON(FAQS_FILE, faqs);
    res.json({ success: true });
});

// ── PRODUCT DUPLICATE ──────────────────────────────────────────────────────

app.post('/api/products/:id/duplicate', requireAdminJWT, (req, res) => {
    const orig = products.find(p => p.id === req.params.id);
    if (!orig) return res.status(404).json({ success: false, message: 'Product not found.' });
    // { ...orig } only shallow-copies — array/object-valued fields (variants,
    // images, variantStock, sizes) would otherwise still point at the SAME
    // array/object as the original. Selling the clone would then mutate the
    // original's stock too (deductStock writes into variant objects in place),
    // and editing either product's images/sizes/variants would silently change
    // both. Every such field is explicitly deep-copied below instead.
    const clone = {
        ...orig,
        id: Date.now().toString(),
        name: orig.name + ' (Copy)',
        isSoldOut: false,
        createdAt: Date.now(),
        updatedAt: undefined,
        history: [],
        variants: Array.isArray(orig.variants) ? orig.variants.map(v => typeof v === 'object' && v ? { ...v } : v) : orig.variants,
        images: Array.isArray(orig.images) ? [...orig.images] : orig.images,
        sizes: Array.isArray(orig.sizes) ? [...orig.sizes] : orig.sizes,
        bundles: Array.isArray(orig.bundles) ? orig.bundles.map(b => ({ ...b })) : orig.bundles,
        variantStock: orig.variantStock ? { ...orig.variantStock } : orig.variantStock
    };
    products.push(clone);
    saveJSON(PRODUCTS_FILE, products);
    // Copy inventory meta (cost data) if it exists for the original — same
    // shallow-copy problem applies to otherExpenses (an array of objects).
    if (invMeta[orig.id]) {
        const origMeta = invMeta[orig.id];
        invMeta[clone.id] = { ...origMeta, otherExpenses: (origMeta.otherExpenses || []).map(e => ({ ...e })) };
        saveJSON(INV_META_FILE, invMeta);
    }
    res.json({ success: true, product: clone });
});

// ── PRODUCT BULK ACTIONS ───────────────────────────────────────────────────

app.post('/api/products/bulk', requireAdminJWT, (req, res) => {
    const { ids, action } = req.body;
    if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ success: false, message: 'No IDs provided.' });
    if (action === 'delete' && req.adminRole === 'staff') return res.status(403).json({ success: false, message: 'Manager or owner access required.' });
    if (action === 'delete') {
        products = products.filter(p => !ids.includes(p.id));
    } else if (action === 'soldout') {
        products.forEach(p => { if (ids.includes(p.id)) p.isSoldOut = true; });
    } else if (action === 'instock') {
        products.forEach(p => { if (ids.includes(p.id)) p.isSoldOut = false; });
    } else {
        return res.status(400).json({ success: false, message: 'Unknown action.' });
    }
    saveJSON(PRODUCTS_FILE, products);
    const msgs = { delete: `${ids.length} product(s) deleted.`, soldout: `${ids.length} product(s) marked Sold Out.`, instock: `${ids.length} product(s) marked In Stock.` };
    res.json({ success: true, message: msgs[action] || 'Done.' });
});

// ── PRODUCT FEATURED TOGGLE ────────────────────────────────────────────────

app.put('/api/products/:id/featured', requireAdminJWT, (req, res) => {
    const p = products.find(p => p.id === req.params.id);
    if (!p) return res.status(404).json({ success: false, message: 'Product not found.' });
    p.featured = !p.featured;
    saveJSON(PRODUCTS_FILE, products);
    res.json({ success: true, featured: p.featured });
});

// ── INLINE STOCK UPDATE ────────────────────────────────────────────────────

// ── REVIEW FEATURED TOGGLE ─────────────────────────────────────────────────

app.put('/api/reviews/:id/featured', requireAdminJWT, (req, res) => {
    const r = reviews.find(r => r.id === req.params.id);
    if (!r) return res.status(404).json({ success: false, message: 'Review not found.' });
    r.featured = !r.featured;
    saveJSON(REVIEWS_FILE, reviews);
    res.json({ success: true, featured: r.featured });
});

// ── NOTIFY ME ──────────────────────────────────────────────────────────────

// Back-in-stock notifications are WhatsApp-only — phone is the required contact
// method (matching checkout, where email is likewise optional). No email is
// sent or required here; the admin dashboard messages the customer on
// WhatsApp directly once stock returns (see /api/notify/:id/send below).
app.post('/api/notify', async (req, res) => {
    if (rateLimit('notify:' + clientIp(req), 10, 60 * 60 * 1000)) return res.status(429).json({ success: false, message: 'Too many requests. Try again later.' });
    const { name, phone, productId } = req.body;
    if (!phone || !productId) return res.status(400).json({ success: false, message: 'Name, phone and product required.' });
    const normPhone = normalisePhone(phone);
    const product = products.find(p => p.id === productId);
    if (!product) return res.status(404).json({ success: false, message: 'Product not found.' });
    // Use the server's own product name — never the client's — so it can't be
    // spoofed into recording an arbitrary message/product.
    const productName = product.name;
    const exists = notifs.find(n => normalisePhone(n.phone) === normPhone && n.productId === productId);
    if (!exists) {
        notifs.push({ id: 'NOTIF-' + Date.now(), name: name || '', phone, productId, productName, createdAt: Date.now() });
        saveJSON(NOTIFY_FILE, notifs);
    }
    res.json({ success: true });
});

app.get('/api/notify', requireAdminJWT, (req, res) => res.json(notifs));

// WhatsApp is the only channel for restock notifications — there's no WhatsApp
// Business API integration here, so "sending" means handing the admin a
// pre-filled wa.me link to open and actually send themselves. This endpoint
// just validates the entry and marks it notified; the message is composed
// client-side in admin.js.
app.post('/api/notify/:id/send', requireAdminJWT, async (req, res) => {
    const n = notifs.find(n => n.id === req.params.id);
    if (!n) return res.status(404).json({ success: false, message: 'Entry not found.' });
    if (!n.phone) return res.status(400).json({ success: false, message: 'No phone number on record for this customer.' });
    const product = products.find(p => p.id === n.productId);
    const productName = product ? product.name : (n.productName || n.productId);
    const productPrice = product ? `GH₵${parseFloat(product.price).toFixed(2)}` : '';
    const msg = `Hi ${n.name || 'there'}! Good news — *${productName}* is back in stock${productPrice ? ' at ' + productPrice : ''} at Freeman Outlet. Want us to set some aside for you?`;
    n.notifiedAt = new Date().toISOString();
    saveJSON(NOTIFY_FILE, notifs);
    res.json({ success: true, waUrl: 'https://wa.me/' + normalisePhone(n.phone) + '?text=' + encodeURIComponent(msg) });
});

app.delete('/api/notify/:id', requireAdminJWT, requireManagerOrOwner, (req, res) => {
    const before = notifs.length;
    notifs = notifs.filter(n => n.id !== req.params.id);
    if (notifs.length === before) return res.status(404).json({ success: false, message: 'Entry not found.' });
    saveJSON(NOTIFY_FILE, notifs);
    res.json({ success: true });
});

// ── PRODUCT EVENTS ─────────────────────────────────────────────────────────

// POST: track view or cart-add event (public, lightweight, no auth)
app.post('/api/events', (req, res) => {
    const { productId, type } = req.body;
    if (!productId || !['view', 'cart'].includes(type)) return res.status(400).json({ ok: false });
    // Drop duplicates: same product+type within 30s from same IP (prevents double-counting on refresh)
    const ip  = clientIp(req);
    const key = ip + ':' + productId + ':' + type;
    const now = Date.now();
    const recent = productEvents.filter(e => e.k === key && now - e.ts < 30000);
    if (!recent.length) {
        productEvents.push({ productId, type, ts: now, k: key });
        saveEvents();
    }
    res.json({ ok: true });
});

// GET: product analytics aggregation
app.get('/api/admin/product-analytics', requireAdminJWT, (req, res) => {
    const fromDate = req.query.from ? new Date(req.query.from + 'T00:00:00Z').getTime() : 0;
    const toDate   = req.query.to   ? new Date(req.query.to   + 'T23:59:59Z').getTime() : Date.now();

    // Aggregate events
    const views = {}, cartAdds = {};
    productEvents.forEach(e => {
        if (e.ts < fromDate || e.ts > toDate) return;
        if (e.type === 'view') views[e.productId]    = (views[e.productId]    || 0) + 1;
        if (e.type === 'cart') cartAdds[e.productId] = (cartAdds[e.productId] || 0) + 1;
    });

    // Wishlist saves — count how many customers have each product saved
    const wishlistSaves = {};
    Object.values(wishlists).forEach(ids => {
        (ids || []).forEach(id => { wishlistSaves[id] = (wishlistSaves[id] || 0) + 1; });
    });

    // Orders — qty sold + revenue per product
    const orderQty = {}, orderRev = {};
    orders.forEach(o => {
        // Every order here is real (this store takes no online payment — 'pending'
        // and 'manual' are the only paymentStatus values that exist). Exclude only
        // orders that were returned/refunded, since those aren't real revenue.
        if (o.status === 'Returned' || o.status === 'Refunded') return;
        const ts = new Date(o.paidAt || o.createdAt).getTime();
        if (ts < fromDate || ts > toDate) return;
        (o.items || []).forEach(item => {
            orderQty[item.id] = (orderQty[item.id] || 0) + (parseInt(item.quantity, 10) || 1);
            orderRev[item.id] = (orderRev[item.id] || 0) + (parseFloat(item.price) || 0) * (parseInt(item.quantity, 10) || 1);
        });
    });

    // Build per-product rows
    const allIds = new Set([...Object.keys(views), ...Object.keys(cartAdds), ...Object.keys(wishlistSaves), ...Object.keys(orderQty)]);
    const rows = [...allIds].map(id => {
        const p       = products.find(p => p.id === id);
        const v       = views[id]        || 0;
        const c       = cartAdds[id]     || 0;
        const w       = wishlistSaves[id]|| 0;
        const sold    = orderQty[id]     || 0;
        const revenue = orderRev[id]     || 0;
        const viewToBuy  = v    > 0 ? Math.round(sold / v * 100) : null;
        const cartToBuy  = c    > 0 ? Math.round(sold / c * 100) : null;
        const cartToView = v    > 0 ? Math.round(c    / v * 100) : null;
        return {
            id,
            name:        p ? p.name     : '(deleted)',
            category:    p ? p.category : '',
            price:       p ? parseFloat(p.price) : 0,
            stock:       p ? p.stock    : null,
            views:       v,
            cartAdds:    c,
            wishlistSaves: w,
            sold,
            revenue,
            viewToBuy,
            cartToBuy,
            cartToView
        };
    }).sort((a, b) => b.views - a.views);

    res.json({ rows, totals: { views: Object.values(views).reduce((s,v)=>s+v,0), cartAdds: Object.values(cartAdds).reduce((s,v)=>s+v,0) } });
});

// ── ANALYTICS ──────────────────────────────────────────────────────────────

app.get('/api/analytics', requireAdminJWT, (req, res) => {
    // Support custom date range via ?from=YYYY-MM-DD&to=YYYY-MM-DD; default last 30 days
    const now    = Date.now();
    const dayMs  = 86400000;
    const toDate   = req.query.to   ? new Date(req.query.to   + 'T23:59:59Z').getTime() : now;
    const fromDate = req.query.from ? new Date(req.query.from + 'T00:00:00Z').getTime() : toDate - 29 * dayMs;
    const days = Math.min(365, Math.ceil((toDate - fromDate) / dayMs) + 1);
    const daily = {};
    for (let i = days - 1; i >= 0; i--) {
        const d = new Date(toDate - i * dayMs).toISOString().slice(0, 10);
        daily[d] = { revenue: 0, orders: 0 };
    }
    const productSales = {}, categorySales = {};
    let totalRevenue = 0, totalCOGS = 0, totalDeliveryPaid = 0, totalDiscount = 0;
    const emailSeen = new Set(), repeatEmails = new Set();
    orders.forEach(o => {
        // Every order here is real (this store takes no online payment — 'pending'
        // and 'manual' are the only paymentStatus values that exist). Exclude only
        // orders that were returned/refunded, since those aren't real revenue.
        if (o.status === 'Returned' || o.status === 'Refunded') return;
        const ts = new Date(o.paidAt || o.createdAt).getTime();
        const d  = new Date(ts).toISOString().slice(0, 10);
        if (daily[d]) { daily[d].revenue += parseFloat(o.total) || 0; daily[d].orders++; }
        // Only count in-range orders for totals
        if (ts < fromDate || ts > toDate) return;
        const orderTotal = parseFloat(o.total) || 0;
        totalRevenue     += orderTotal;
        totalDeliveryPaid += parseFloat(o.deliveryPrice) || 0;
        totalDiscount    += parseFloat(o.promoDiscount)  || 0;
        // Repeat customer tracking — keyed by phone first (see /api/customers for why:
        // email is optional at checkout, so email-only keying undercounts customers).
        const custKey = o.customer && o.customer.phone ? normalisePhone(o.customer.phone)
            : (o.customer && o.customer.email ? o.customer.email.toLowerCase() : null);
        if (custKey) { if (emailSeen.has(custKey)) repeatEmails.add(custKey); else emailSeen.add(custKey); }
        (o.items || []).forEach(item => {
            if (!productSales[item.id]) productSales[item.id] = { name: item.name, qty: 0, revenue: 0 };
            const qty = parseInt(item.quantity, 10) || 1;
            const rev = (parseFloat(item.price) || 0) * qty;
            productSales[item.id].qty += qty;
            productSales[item.id].revenue += rev;
            // Category breakdown
            const p = products.find(p => p.id === item.id);
            const cat = (p && p.category) ? p.category : 'Other';
            if (!categorySales[cat]) categorySales[cat] = { revenue: 0, qty: 0 };
            categorySales[cat].revenue += rev;
            categorySales[cat].qty += qty;
            // COGS — must match calcInvCost() in admin.js's Cost & Pricing tab
            // exactly (see that function for why each term is there). This used
            // to just be actualCost with no growth margin or shipping/transport/
            // other expenses folded in, so Analytics and Cost & Pricing showed
            // two different profit numbers for the same product.
            const meta = invMeta[item.id];
            const unitCost = meta ? calcInvCost(meta) : 0;
            if (unitCost > 0) totalCOGS += unitCost * qty;
        });
    });
    const grossProfit  = totalRevenue - totalCOGS;
    const netProfit    = grossProfit - totalDeliveryPaid;
    const grossMargin  = totalRevenue > 0 ? (grossProfit / totalRevenue) * 100 : 0;
    const netMargin    = totalRevenue > 0 ? (netProfit   / totalRevenue) * 100 : 0;
    const repeatRate   = emailSeen.size > 0 ? (repeatEmails.size / emailSeen.size) * 100 : 0;
    const bestSellers  = Object.values(productSales).sort((a, b) => b.qty - a.qty).slice(0, 5);
    const categoryBreakdown = Object.entries(categorySales)
        .map(([cat, s]) => ({ category: cat, revenue: s.revenue, qty: s.qty }))
        .sort((a, b) => b.revenue - a.revenue);
    res.json({ daily, bestSellers, categoryBreakdown, totalRevenue, totalCOGS, totalDeliveryPaid, totalDiscount, grossProfit, netProfit, grossMargin, netMargin, repeatRate, uniqueCustomers: emailSeen.size, repeatCustomers: repeatEmails.size });
});

// ── CUSTOMERS ──────────────────────────────────────────────────────────────

app.get('/api/customers', requireAdminJWT, requireManagerOrOwner, (req, res) => {
    // Keyed by phone, not email — email is optional at checkout (only phone is
    // required), so keying on email alone silently dropped every phone-only
    // order from this directory and from the repeat-customer/uniqueCustomers
    // metrics on /api/analytics. Phone is always present; email is kept as a
    // secondary fallback for the rare record missing even that.
    const map = {};
    orders.forEach(o => {
        if (!o.customer) return;
        const normPhone = o.customer.phone ? normalisePhone(o.customer.phone) : '';
        const key = normPhone || (o.customer.email ? o.customer.email.toLowerCase() : '');
        if (!key) return;
        if (!map[key]) map[key] = { name: o.customer.name, email: o.customer.email || '', phone: o.customer.phone || '', orderCount: 0, totalSpent: 0, lastOrderDate: 0, lastOrder: null };
        map[key].orderCount++;
        map[key].totalSpent += parseFloat(o.total) || 0;
        const ts = new Date(o.paidAt || o.createdAt || 0).getTime();
        if (ts > map[key].lastOrderDate) {
            map[key].lastOrderDate = ts;
            map[key].name = o.customer.name;
            map[key].lastOrder = { id: o.id, items: o.items || [], total: o.total, status: o.status || 'Pending', paidAt: o.paidAt };
        }
    });
    res.json(Object.values(map).sort((a, b) => b.lastOrderDate - a.lastOrderDate));
});

// GET: Full order history for a customer by phone (preferred) or email (admin)
app.get('/api/customers/:id/orders', requireAdminJWT, requireManagerOrOwner, (req, res) => {
    const raw = decodeURIComponent(req.params.id);
    const normPhone = normalisePhone(raw);
    const asEmail = raw.toLowerCase();
    const history = orders
        .filter(o => o.customer && (
            (normPhone && normalisePhone(o.customer.phone || '') === normPhone) ||
            (o.customer.email && o.customer.email.toLowerCase() === asEmail)
        ))
        .sort((a, b) => new Date(b.paidAt) - new Date(a.paidAt));
    res.json(history);
});

// ── ORDER STATUS ───────────────────────────────────────────────────────────

app.patch('/api/orders/:id/status', requireAdminJWT, (req, res) => {
    const { status, shippingCarrier, shippingRiderPhone, shippingTrackingLink, shippingNote } = req.body;
    const valid = ['Pending', 'Processing', 'Shipped', 'Delivered', 'Returned', 'Refunded'];
    if (!valid.includes(status)) return res.status(400).json({ success: false, message: 'Invalid status.' });
    const order = orders.find(o => o.id === req.params.id);
    if (!order) return res.status(404).json({ success: false, message: 'Order not found.' });
    order.status = status;
    order.lastStatusBy = req.adminUsername || req.adminUser?.username || 'admin';
    order.lastStatusAt = new Date().toISOString();
    // Save shipping details when dispatching
    if (status === 'Shipped') {
        if (shippingCarrier)     order.shippingCarrier      = shippingCarrier.trim();
        if (shippingRiderPhone)  order.shippingRiderPhone   = shippingRiderPhone.trim();
        if (shippingTrackingLink) order.shippingTrackingLink = shippingTrackingLink.trim();
        if (shippingNote)        order.shippingNote         = shippingNote.trim();
        order.shippedBy = req.adminUsername || 'admin';
        order.shippedAt = new Date().toISOString();
    }
    // Auto-deduct stock when order first reaches Shipped or Delivered
    // Set flag AFTER deduction so a write failure doesn't permanently skip deduction
    if ((status === 'Shipped' || status === 'Delivered') && !order.stockDeducted) {
        deductStock((order.items || []).map(item => ({ id: item.id, color: item.color, quantity: parseInt(item.quantity, 10) || 1 })));
        saveJSON(PRODUCTS_FILE, products);
        order.stockDeducted = true;
    }
    saveJSON(ORDERS_FILE, orders);
    if (status === 'Shipped' || status === 'Delivered') {
        sendStatusEmail(order, status).catch(err => console.error('[EMAIL ERROR - status]', err.message));
    }
    res.json({ success: true, order });
});

app.delete('/api/orders/:id', requireAdminJWT, requireManagerOrOwner, async (req, res) => {
    const idx = orders.findIndex(o => o.id === req.params.id);
    if (idx === -1) return res.status(404).json({ success: false, message: 'Order not found.' });
    const order = orders[idx];

    const date = new Date(order.paidAt).toLocaleString('en-GH', { dateStyle: 'long', timeStyle: 'short' });
    const itemRows = (order.items || []).map(i =>
        `<tr><td style="padding:6px 12px;border-bottom:1px solid #f3f4f6">${escHtml(i.name)}${i.color ? ' — ' + escHtml(i.color) : ''}${i.size ? ' [' + escHtml(i.size) + ']' : ''}</td><td style="padding:6px 12px;border-bottom:1px solid #f3f4f6;text-align:center">×${parseInt(i.quantity)||1}</td><td style="padding:6px 12px;border-bottom:1px solid #f3f4f6;text-align:right">GH₵${(i.price * i.quantity).toFixed(2)}</td></tr>`
    ).join('');

    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f7f5f3;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif">
<div style="max-width:560px;margin:28px auto;background:#fff;border-radius:4px;box-shadow:0 2px 16px rgba(0,0,0,.08)">
  <div style="padding:20px 32px;border-bottom:2px solid #C9971C">
    <table width="100%" cellpadding="0" cellspacing="0"><tr>
      <td style="vertical-align:middle;width:56px"><img src="cid:logo@freemanoutlet" width="48" alt=""/></td>
      <td style="vertical-align:middle;padding-left:12px">
        <p style="margin:0;font-size:15px;font-weight:700;color:#1a1a1a">Order Archived</p>
        <p style="margin:3px 0 0;font-size:12px;color:#aaa">Removed from the Freeman Outlet system</p>
      </td>
    </tr></table>
  </div>
  <div style="padding:20px 32px">
    <table width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;margin-bottom:16px">
      <tr><td style="padding:4px 0;color:#999;width:80px">Order ID</td><td style="padding:4px 0;font-family:monospace;font-weight:700;color:#1a1a1a">${order.id}</td></tr>
      <tr><td style="padding:4px 0;color:#999">Ref</td><td style="padding:4px 0;font-family:monospace;color:#1a1a1a">${order.reference}</td></tr>
      <tr><td style="padding:4px 0;color:#999">Date</td><td style="padding:4px 0;color:#1a1a1a">${date}</td></tr>
      <tr><td style="padding:4px 0;color:#999">Status</td><td style="padding:4px 0;color:#1a1a1a">${order.status || 'Pending'}</td></tr>
    </table>
    <p style="margin:0 0 6px;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.12em;color:#aaa">Customer</p>
    <p style="margin:0 0 16px;font-size:13px;color:#1a1a1a;line-height:1.6">${escHtml(order.customer.name)} · ${escHtml(order.customer.phone)} · ${escHtml(order.customer.email)}<br>${escHtml(order.customer.address)}${order.customer.notes ? '<br><em style="color:#aaa">' + escHtml(order.customer.notes) + '</em>' : ''}</p>
    <p style="margin:0 0 8px;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.12em;color:#aaa">Items</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;margin-bottom:14px">${itemRows}</table>
    ${(order.deliveryPrice > 0 || order.promoCode || order.bundleDiscount > 0) ? `<p style="margin:0 0 4px;font-size:13px;text-align:right;color:#777">Items Sub Total: GH₵${parseFloat(order.subtotal || 0).toFixed(2)}</p>` : ''}
    ${order.deliveryZone ? `<p style="margin:0 0 4px;font-size:13px;text-align:right;color:#555">Delivery (${escHtml(order.deliveryZone)}): ${order.deliveryPrice > 0 ? 'GH₵' + parseFloat(order.deliveryPrice).toFixed(2) : 'Free'}</p>` : ''}
    ${order.bundleDiscount > 0 ? `<p style="margin:0 0 4px;font-size:13px;text-align:right;color:#16a34a">Bundle savings: −GH₵${parseFloat(order.bundleDiscount).toFixed(2)}</p>` : ''}
    ${order.promoCode && order.promoDiscount ? `<p style="margin:0 0 4px;font-size:13px;text-align:right;color:#16a34a">Discount (${order.promoCode}): −GH₵${parseFloat(order.promoDiscount).toFixed(2)}</p>` : ''}
    <p style="margin:0;font-size:15px;font-weight:800;text-align:right;color:#C9971C">Total: GH₵${parseFloat(order.total).toFixed(2)}</p>
  </div>
  ${SOCIAL_LINKS_HTML}
</div></body></html>`;

    // Restore the stock this order deducted — deleting an order never did this
    // before, so removing an order (e.g. a duplicate or a test order) left
    // inventory permanently short by whatever it had deducted at checkout.
    if (order.stockDeducted && !order.stockRestored) {
        restoreStock(order.items, 'order deleted', order.orderNo ? '#' + order.orderNo : order.id);
    }
    // Delete the order first — email is secondary and must never block deletion
    orders.splice(idx, 1);
    saveJSON(ORDERS_FILE, orders);
    res.json({ success: true });
    // Fire archive email in background (failure is logged but does not affect the response)
    if (GMAIL_PASS) {
        makeTransporter().sendMail({
            from: `"Freeman Outlet Admin" <${GMAIL_USER}>`,
            to: STORE_EMAIL,
            subject: `[Archived] Order ${order.id} — ${order.customer?.name || 'Customer'}`,
            html,
            attachments: [LOGO_ATTACHMENT]
        }).catch(err => console.error('[EMAIL ERROR - delete order]', err.message));
    }
});

// ── ADMIN JWT AUTH ─────────────────────────────────────────────────────────
// Set ADMIN_JWT_SECRET in the environment to use a key independent of JWT_SECRET
// (so a leaked customer-token secret can't be used to forge admin tokens). Falls
// back to a derived value when unset so existing deployments keep working.
const ADMIN_JWT_SECRET = process.env.ADMIN_JWT_SECRET || (JWT_SECRET + '-admin');

function requireAdminJWT(req, res, next) {
    const auth = req.headers['authorization'] || '';
    if (auth.startsWith('Bearer ')) {
        try {
            const payload = jwt.verify(auth.slice(7), ADMIN_JWT_SECRET);
            const account = adminAccounts.find(a => a.id === payload.adminId);
            if (!account) return res.status(401).json({ error: 'Session expired.' });
            // Single active session — if another device logged in since, reject this token
            if (account.activeSessionId && payload.sessionId && account.activeSessionId !== payload.sessionId) {
                return res.status(401).json({ error: 'signed_in_elsewhere', message: 'You were signed in on another device. Please log in again.' });
            }
            // Track last seen (max once per 30s to avoid constant disk writes)
            const now = Date.now();
            if (!account.lastSeen || now - account.lastSeen > 30000) {
                account.lastSeen = now;
                account.lastSeenDevice = (req.headers['user-agent'] || '').slice(0, 80);
                saveJSON(ADMIN_ACCOUNTS_FILE, adminAccounts);
            }
            req.adminUser = account; req.adminRole = account.role; req.adminUsername = account.username;
            return next();
        } catch(e) { return res.status(401).json({ error: 'Session expired.' }); }
    }
    res.status(401).json({ error: 'Login required.' });
}

app.post('/api/admin/login', async (req, res) => {
    const ip = clientIp(req);
    if (rateLimit('adminlogin:' + ip, 5, 60000)) return res.status(429).json({ error: 'Too many attempts. Wait a minute.' });
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username and password required.' });
    const account = adminAccounts.find(a => a.username === username.trim());
    if (!account) return res.status(401).json({ error: 'Invalid username or password.' });
    const ok = await bcrypt.compare(password, account.passwordHash);
    if (!ok) return res.status(401).json({ error: 'Invalid username or password.' });
    // New sessionId invalidates ALL previous sessions for this account
    const sessionId = crypto.randomBytes(16).toString('hex');
    account.activeSessionId = sessionId;
    account.lastSeen = Date.now();
    account.lastSeenDevice = (req.headers['user-agent'] || '').slice(0, 80);
    saveJSON(ADMIN_ACCOUNTS_FILE, adminAccounts);
    const token = jwt.sign({ adminId: account.id, username: account.username, role: account.role, sessionId }, ADMIN_JWT_SECRET, { expiresIn: '12h' });
    res.json({ token, name: account.name, role: account.role, username: account.username });
});

app.post('/api/admin/logout', requireAdminJWT, (req, res) => {
    const account = adminAccounts.find(a => a.id === req.adminUser.id);
    // Rotate to a fresh sessionId rather than deleting activeSessionId — the
    // guard above at requireAdminJWT is `if (account.activeSessionId && ...)`,
    // so clearing the field entirely made it falsy and skipped the whole check,
    // meaning the just-"logged-out" token (and every other token ever issued
    // for this account) kept working normally until its 12h expiry. Rotating
    // ensures the presented token's sessionId can never match again.
    if (account) { account.activeSessionId = crypto.randomBytes(16).toString('hex'); saveJSON(ADMIN_ACCOUNTS_FILE, adminAccounts); }
    res.json({ success: true });
});

// Who's online (active in last 3 minutes)
app.get('/api/admin/online', requireAdminJWT, (req, res) => {
    const cutoff = Date.now() - 3 * 60 * 1000;
    res.json(adminAccounts.filter(a => a.lastSeen && a.lastSeen > cutoff)
        .map(a => ({ name: a.name, username: a.username, role: a.role, lastSeen: a.lastSeen })));
});

// ── ADMIN ACCOUNTS ─────────────────────────────────────────────────────────

// GET: list all admin accounts (owner only)
app.get('/api/admin/accounts', requireAdminJWT, requireOwner, (req, res) => {
    res.json(adminAccounts.map(a => ({ id: a.id, username: a.username, name: a.name, role: a.role, createdAt: a.createdAt })));
});

// GET: current admin info (any role)
app.get('/api/admin/me', requireAdminJWT, (req, res) => {
    res.json({ username: req.adminUsername, name: req.adminUser.name, role: req.adminRole });
});

// POST: create new admin account (owner only)
app.post('/api/admin/accounts', requireAdminJWT, requireOwner, async (req, res) => {
    const { username, password, name, role } = req.body;
    if (!username || !password || !name) return res.status(400).json({ success: false, message: 'Username, password and name required.' });
    if (!['owner', 'manager', 'staff'].includes(role)) return res.status(400).json({ success: false, message: 'Role must be owner, manager or staff.' });
    if (adminAccounts.find(a => a.username === username.trim()))
        return res.status(409).json({ success: false, message: 'Username already exists.' });
    if (password.length < 8) return res.status(400).json({ success: false, message: 'Password must be at least 8 characters.' });
    const hash = await bcrypt.hash(password, 10);
    const account = { id: 'admin-' + Date.now(), username: username.trim(), name: name.trim(), role, passwordHash: hash, createdAt: new Date().toISOString() };
    adminAccounts.push(account);
    saveJSON(ADMIN_ACCOUNTS_FILE, adminAccounts);
    res.json({ success: true, account: { id: account.id, username: account.username, name: account.name, role: account.role } });
});

// PUT: update admin account (owner only; can't demote self)
app.put('/api/admin/accounts/:id', requireAdminJWT, requireOwner, async (req, res) => {
    const acc = adminAccounts.find(a => a.id === req.params.id);
    if (!acc) return res.status(404).json({ success: false, message: 'Account not found.' });
    if (acc.id === 'admin-owner' && req.body.role && req.body.role !== 'owner')
        return res.status(400).json({ success: false, message: 'Cannot change the owner account role.' });
    // The comment above has always claimed "can't demote self", but the only actual
    // protection was for the one hardcoded 'admin-owner' id — a second owner account
    // (created via POST /api/admin/accounts) could demote itself with no error.
    if (acc.id === req.adminUser.id && req.body.role && req.body.role !== 'owner')
        return res.status(400).json({ success: false, message: 'You cannot change your own role.' });
    if (req.body.name)     acc.name  = req.body.name.trim();
    if (req.body.role && ['owner','manager','staff'].includes(req.body.role)) acc.role = req.body.role;
    if (req.body.password) {
        if (req.body.password.length < 8) return res.status(400).json({ success: false, message: 'Password must be at least 8 characters.' });
        acc.passwordHash = await bcrypt.hash(req.body.password, 10);
        // A password change must invalidate any session already issued for this
        // account — otherwise a token stolen before the change (the exact scenario
        // a password change is meant to contain) keeps working for its full 12h,
        // since the session guard only ever compared sessionId, never the password.
        acc.activeSessionId = crypto.randomBytes(16).toString('hex');
    }
    saveJSON(ADMIN_ACCOUNTS_FILE, adminAccounts);
    res.json({ success: true, account: { id: acc.id, username: acc.username, name: acc.name, role: acc.role } });
});

// DELETE: remove admin account (owner only; can't delete self)
app.delete('/api/admin/accounts/:id', requireAdminJWT, requireOwner, (req, res) => {
    if (req.params.id === 'admin-owner') return res.status(400).json({ success: false, message: 'Cannot delete the owner account.' });
    // Same gap as the role-change check above — only the hardcoded 'admin-owner'
    // id was protected, so any other account (including a second owner) could
    // delete itself with no error.
    if (req.params.id === req.adminUser.id) return res.status(400).json({ success: false, message: 'You cannot delete your own account.' });
    const before = adminAccounts.length;
    adminAccounts = adminAccounts.filter(a => a.id !== req.params.id);
    if (adminAccounts.length === before) return res.status(404).json({ success: false, message: 'Account not found.' });
    saveJSON(ADMIN_ACCOUNTS_FILE, adminAccounts);
    res.json({ success: true });
});

// ── ORDERS CSV EXPORT ──────────────────────────────────────────────────────
app.get('/api/admin/orders/export.csv', requireAdminJWT, requireManagerOrOwner, (req, res) => {
    const rows = [['Order ID','Order No','Date','Customer Name','Phone','Email','Address','Items','Subtotal','Delivery','Promo','Discount','Total','Payment','Status','Carrier','Tracking','Shipped By']];
    orders.slice().sort((a,b) => new Date(b.paidAt) - new Date(a.paidAt)).forEach(o => {
        const c = o.customer || {};
        const itemStr = (o.items||[]).map(i=>`${i.name}${i.color?' ('+i.color+')':''}${i.size?' ['+i.size+']':''} x${i.quantity}`).join(' | ');
        rows.push([o.id, o.orderNo||'', new Date(o.paidAt).toLocaleDateString('en-GH'),
            c.name||'', c.phone||'', c.email||'', c.address||'', itemStr,
            parseFloat(o.subtotal||0).toFixed(2), parseFloat(o.deliveryPrice||0).toFixed(2),
            o.promoCode||'', parseFloat(o.promoDiscount||0).toFixed(2), parseFloat(o.total||0).toFixed(2),
            o.paymentStatus||'paid', o.status||'Pending', o.shippingCarrier||'', o.shippingTrackingLink||'', o.shippedBy||'']);
    });
    // Prefix a leading apostrophe on any cell that would otherwise be read as a
    // spreadsheet formula (=, +, -, @) when opened in Excel/Sheets — formula injection.
    const csvSafe = v => { const s = String(v); return /^[=+\-@]/.test(s) ? "'" + s : s; };
    const csv = rows.map(r=>r.map(v=>'"'+csvSafe(v).replace(/"/g,'""')+'"').join(',')).join('\r\n');
    res.setHeader('Content-Type','text/csv');
    res.setHeader('Content-Disposition',`attachment; filename="orders-${new Date().toISOString().slice(0,10)}.csv"`);
    res.send(csv);
});

// ── ORDER TRACKING (public — customer looks up by email or order ref) ───────
// Rate-limited: `ref` accepts a short, sequential order number as sole proof of
// ownership (the same way a paper receipt does), so this endpoint must not allow
// fast enough guessing to walk the whole order book.
app.get('/api/track', (req, res) => {
    if (rateLimit('track:' + clientIp(req), 20, 60 * 60 * 1000)) return res.status(429).json({ success: false, message: 'Too many lookups. Please try again later.' });
    const { email, ref, phone } = req.query;
    if (!email && !ref && !phone) return res.status(400).json({ success: false, message: 'Provide your phone number, email or order reference.' });
    let found = [];
    if (ref) {
        const o = orders.find(o => o.id === ref || o.reference === ref || String(o.orderNo) === ref);
        if (o) found = [o];
    } else if (phone) {
        // Phone is required at checkout (email is optional), so this is the lookup
        // most customers can actually use.
        const norm = normalisePhone(phone);
        found = orders.filter(o => o.customer && normalisePhone(o.customer.phone) === norm)
            .sort((a,b) => new Date(b.paidAt) - new Date(a.paidAt)).slice(0,10);
    } else {
        const norm = email.toLowerCase().trim();
        found = orders.filter(o => o.customer && (o.customer.email||'').toLowerCase() === norm)
            .sort((a,b) => new Date(b.paidAt) - new Date(a.paidAt)).slice(0,10);
    }
    if (!found.length) return res.json({ success: false, message: 'No orders found for that phone number, email or reference.' });
    res.json({ success: true, orders: found.map(o => ({
        id: o.id, orderNo: o.orderNo, status: o.status||'Pending', paidAt: o.paidAt,
        total: o.total, items: o.items, deliveryArea: o.deliveryArea, deliveryZone: o.deliveryZone,
        shippingCarrier: o.shippingCarrier||null, shippingRiderPhone: o.shippingRiderPhone||null,
        shippingTrackingLink: o.shippingTrackingLink||null, shippingNote: o.shippingNote||null,
        // Included so the client can build a working receipt link (which requires
        // a phone/email match) even when this lookup was done by reference alone —
        // that lookup already reveals strictly more (items, address, total), so
        // this isn't a further privacy loss.
        customerPhone: (o.customer && o.customer.phone) || null
    }))});
});

// ── RECEIPT (printable HTML) ────────────────────────────────────────────────
app.get('/api/orders/:id/receipt', (req, res) => {
    const order = orders.find(o => o.id === req.params.id);
    if (!order) return res.status(404).send('<p>Order not found.</p>');
    // Require the phone or email on file to match the query — order IDs are sequential
    // timestamps (`ORD-<Date.now()>`) and easily guessable, so this check must not be
    // skippable. Phone is required at checkout (email is optional), so it's checked
    // first — an order with no email on file must still not be openable by ID alone.
    const phoneQ  = normalisePhone(req.query.phone || '');
    const emailQ  = (req.query.email || '').toLowerCase().trim();
    const orderPhone = normalisePhone((order.customer && order.customer.phone) || '');
    const orderEmail = ((order.customer && order.customer.email) || '').toLowerCase().trim();
    const phoneMatches = !!phoneQ && !!orderPhone && phoneQ === orderPhone;
    const emailMatches = !!emailQ && !!orderEmail && emailQ === orderEmail;
    if (!phoneMatches && !emailMatches)
        return res.status(403).send('<p>Access denied. Add <code>?phone=</code> or <code>?email=</code> matching this order to view the receipt.</p>');
    const c = order.customer||{};
    const merged = { ...SETTINGS_DEFAULTS, ...settings };
    const itemRows = (order.items||[]).map(i=>`
        <tr><td style="padding:8px 0;border-bottom:1px solid #f0f0f0">${escHtml(i.name)}${i.color?' — '+escHtml(i.color):''}${i.size?' / '+escHtml(i.size):''}</td>
            <td style="padding:8px 0;border-bottom:1px solid #f0f0f0;text-align:center">×${parseInt(i.quantity)||1}</td>
            <td style="padding:8px 0;border-bottom:1px solid #f0f0f0;text-align:right">GH₵${(parseFloat(i.price||0)*parseInt(i.quantity||1)).toFixed(2)}</td></tr>`).join('');
    const vatR = order.vat || vatBreakdown(order.total);
    const vatRowsR = vatR ? `<tr><td colspan="3" style="padding-top:16px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:#aaa">Total includes</td></tr>
        <tr><td colspan="2" style="padding:3px 0;font-size:12px;color:#777">Amount before VAT</td><td style="padding:3px 0;text-align:right;font-size:12px;color:#777">GH₵${vatR.base.toFixed(2)}</td></tr>
        ${vatR.parts.map(p => `<tr><td colspan="2" style="padding:3px 0;font-size:12px;color:#777">${p.label} (${p.rate}%)</td><td style="padding:3px 0;text-align:right;font-size:12px;color:#777">GH₵${p.amount.toFixed(2)}</td></tr>`).join('')}` : '';
    const tinR = (settings.invoiceTin || '').trim();
    res.setHeader('Content-Type','text/html');
    res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Invoice — ${escHtml(order.orderNo||order.id)}</title>
<style>*{margin:0;box-sizing:border-box}body{font-family:Helvetica,Arial,sans-serif;background:#f7f5f3;padding:32px 16px;color:#1a1a1a}
.card{max-width:520px;margin:0 auto;background:#fff;border-radius:8px;padding:36px;box-shadow:0 2px 20px rgba(0,0,0,.08)}
.label{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:#aaa;margin:20px 0 4px}
p{font-size:13px;color:#555;line-height:1.6}
table{width:100%;border-collapse:collapse;font-size:13px}
th{text-align:left;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:#aaa;padding-bottom:8px;border-bottom:2px solid #1a1a1a}
.total-row td{padding-top:12px;font-weight:800;font-size:15px;color:#C9971C;border-top:2px solid #1a1a1a}
.status{display:inline-block;padding:4px 12px;border-radius:20px;font-size:11px;font-weight:700;background:#fdf6f0;color:#C9971C;border:1px solid #fbd9c6}
@media(max-width:560px){body{padding:16px 12px}.card{padding:20px;border-radius:8px}th,td{font-size:12px}}
@media print{body{background:#fff;padding:0}.card{box-shadow:none;padding:24px}.no-print{display:none}}</style></head>
<body><div class="card">
  <div style="text-align:center;margin-bottom:28px">
    <div style="font-size:22px;font-weight:900;color:#C9971C">${escHtml(merged.storeName)}</div>
    <div style="font-size:11px;color:#aaa;margin-top:4px">Invoice${tinR?' · TIN: '+escHtml(tinR):''}</div>
  </div>
  <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:16px;margin-bottom:24px">
    <div><div class="label">Invoice No.</div>
      <p style="font-weight:700;color:#1a1a1a">${order.orderNo?'#'+escHtml(order.orderNo):escHtml(order.id)}</p>
      <p style="font-size:11px;color:#aaa">${new Date(order.paidAt).toLocaleString('en-GH',{dateStyle:'long',timeStyle:'short'})}</p>
    </div><span class="status">${escHtml(order.status||'Pending')}</span>
  </div>
  <div class="label">Customer</div>
  <p>${escHtml(c.name||'—')}</p>${c.phone?`<p>${escHtml(c.phone)}</p>`:''} ${c.address?`<p>${escHtml(c.address)}</p>`:''}
  <div class="label" style="margin-top:20px">Items</div>
  <table><thead><tr><th>Item</th><th style="text-align:center">Qty</th><th style="text-align:right">Amount</th></tr></thead>
  <tbody>${itemRows}</tbody>
  <tfoot>
    ${parseFloat(order.deliveryPrice||0)>0?`<tr><td colspan="2" style="padding:8px 0;color:#555">Delivery${order.deliveryArea?' — '+escHtml(order.deliveryArea):''}</td><td style="padding:8px 0;text-align:right">GH₵${parseFloat(order.deliveryPrice).toFixed(2)}</td></tr>`:''}
    ${parseFloat(order.bundleDiscount||0)>0?`<tr><td colspan="2" style="padding:8px 0;color:#16a34a">Bundle savings</td><td style="padding:8px 0;text-align:right;color:#16a34a">−GH₵${parseFloat(order.bundleDiscount).toFixed(2)}</td></tr>`:''}
    ${parseFloat(order.promoDiscount||0)>0?`<tr><td colspan="2" style="padding:8px 0;color:#16a34a">Discount</td><td style="padding:8px 0;text-align:right;color:#16a34a">−GH₵${parseFloat(order.promoDiscount).toFixed(2)}</td></tr>`:''}
    <tr class="total-row"><td colspan="2">Total (VAT incl.)</td><td style="text-align:right">GH₵${parseFloat(order.total||0).toFixed(2)}</td></tr>${vatRowsR}
  </tfoot></table>
  ${order.paymentStatus!=='manual'?'<p style="margin-top:16px;font-size:11px;color:#888;text-align:center">Delivery fee, if any, is confirmed with you on WhatsApp.</p>':''}
  <p style="margin-top:28px;font-size:11px;color:#aaa;text-align:center">Thank you for shopping with ${escHtml(merged.storeName)}</p>
  <div class="no-print" style="margin-top:24px;text-align:center">
    <button onclick="window.print()" style="background:#C9971C;color:#fff;border:none;padding:10px 24px;border-radius:6px;font-size:13px;font-weight:700;cursor:pointer">Print / Save PDF</button>
  </div>
</div></body></html>`);
});

// ── ABANDONED CART ─────────────────────────────────────────────────────────
app.post('/api/checkout-started', (req, res) => {
    if (rateLimit('checkout-started:' + clientIp(req), 20, 10 * 60 * 1000)) return res.json({ ok: true }); // silent no-op, not an error the client needs to see
    const { email, name, phone, cartItems } = req.body;
    // Email is optional at checkout — this used to require it, so it silently
    // captured nothing for the (normal) phone-only case: the request fires on
    // every checkout, but with no email this always hit the early-return, and
    // data/abandoned-carts.json stayed permanently empty. Phone-only carts are
    // now tracked too (visible to admin for manual WhatsApp follow-up); the
    // automated recovery *email* still only fires when one was given (below).
    if ((!email && !phone) || !cartItems) return res.json({ ok: true });
    const normEmail = email ? email.toLowerCase().trim() : '';
    const normPhone = phone ? normalisePhone(phone) : '';
    const key = normPhone || normEmail;
    abandonedCarts = abandonedCarts.filter(c => (c.phone ? normalisePhone(c.phone) : c.email) !== key);
    abandonedCarts.push({ id: 'AC-'+Date.now(), email: normEmail, name: name||'', phone: phone||'', cartItems, startedAt: Date.now(), recoverySent: false });
    if (abandonedCarts.length > 500) abandonedCarts = abandonedCarts.slice(-500);
    saveJSON(ABANDONED_FILE, abandonedCarts);
    res.json({ ok: true });
});
app.get('/api/admin/abandoned-carts', requireAdminJWT, (req, res) => {
    const week = 7*24*60*60*1000;
    res.json(abandonedCarts.filter(c => Date.now()-c.startedAt < week && !c.recovered).sort((a,b)=>b.startedAt-a.startedAt));
});
app.patch('/api/admin/abandoned-carts/:id/recovered', requireAdminJWT, (req, res) => {
    const cart = abandonedCarts.find(c => c.id === req.params.id);
    if (cart) { cart.recovered = true; saveJSON(ABANDONED_FILE, abandonedCarts); }
    res.json({ ok: true });
});

async function sendAbandonedCartEmail(cart) {
    if (!GMAIL_USER || !GMAIL_PASS) return;
    const merged = { ...SETTINGS_DEFAULTS, ...settings };
    const total = (cart.cartItems||[]).reduce((s,i)=>s+parseFloat(i.price||0)*parseInt(i.quantity||1),0);
    const itemList = (cart.cartItems||[]).map(i=>`<li style="padding:4px 0;font-size:13px;color:#555">${escHtml(i.name)}${i.color?' — '+escHtml(i.color):''}${i.size?' / '+escHtml(i.size):''} ×${parseInt(i.quantity)||1} — <strong>GH₵${(parseFloat(i.price||0)*parseInt(i.quantity||1)).toFixed(2)}</strong></li>`).join('');
    const storeUrl = process.env.RENDER_EXTERNAL_URL || process.env.BASE_URL || 'http://localhost:3000';
    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f7f5f3;font-family:Helvetica,Arial,sans-serif">
<div style="max-width:540px;margin:32px auto;background:#fff;border-radius:4px;box-shadow:0 2px 20px rgba(0,0,0,.08)">
  <div style="padding:24px 36px 20px;text-align:center;border-bottom:2px solid #C9971C">
    <div style="font-size:20px;font-weight:900;color:#C9971C">${merged.storeName}</div>
    <p style="margin:4px 0 0;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.12em;color:#aaa">You left something behind 🛍️</p>
  </div>
  <div style="padding:28px 36px">
    <h2 style="margin:0 0 12px;font-size:19px;font-weight:700;color:#1a1a1a">Still thinking it over?</h2>
    <p style="font-size:14px;color:#555;line-height:1.7;margin:0 0 20px">Hi <strong>${escHtml(cart.name||'there')}</strong>, you left these items in your cart. They are still waiting for you!</p>
    <ul style="padding-left:16px;margin:0 0 20px">${itemList}</ul>
    <p style="font-size:14px;font-weight:700;color:#1a1a1a;margin:0 0 24px">Cart total: GH₵${total.toFixed(2)}</p>
    <a href="${storeUrl}" style="display:inline-block;background:linear-gradient(90deg,#C9971C,#A67C15);color:#fff;font-size:14px;font-weight:700;padding:12px 28px;border-radius:6px;text-decoration:none">Complete Your Order →</a>
    <p style="margin:20px 0 0;font-size:12px;color:#aaa">Need help? WhatsApp us: +${merged.whatsapp||''}</p>
  </div>
  ${SOCIAL_LINKS_HTML}
</div></body></html>`;
    const transporter = makeTransporter();
    await transporter.sendMail({ from:`"${merged.storeName}" <${GMAIL_USER}>`, to: cart.email, subject:`You left something in your cart — ${merged.storeName}`, html, attachments:[LOGO_ATTACHMENT] });
}

setInterval(async () => {
    const oneHour = 60*60*1000, sevenDays = 7*24*60*60*1000;
    let changed = false;
    const before = abandonedCarts.length;
    abandonedCarts = abandonedCarts.filter(c => Date.now()-c.startedAt < sevenDays);
    if (abandonedCarts.length !== before) changed = true;
    for (const cart of abandonedCarts) {
        if (cart.recoverySent || cart.recovered) continue;
        if (Date.now()-cart.startedAt < oneHour) continue;
        const cartPhone = cart.phone ? normalisePhone(cart.phone) : '';
        const completed = orders.find(o => o.customer && new Date(o.paidAt).getTime() > cart.startedAt && (
            (cartPhone && normalisePhone(o.customer.phone || '') === cartPhone) ||
            (cart.email && (o.customer.email||'').toLowerCase() === cart.email)
        ));
        if (completed) { cart.recovered = true; changed = true; continue; }
        cart.recoverySent = true; changed = true;
        // No automated recovery channel for a phone-only cart (this store never
        // collects a customer's WhatsApp opt-in for marketing) — it's still
        // marked recoverySent so the sweep doesn't retry it forever, but it
        // stays visible (via !c.recovered) in the admin tab for manual follow-up.
        if (cart.email) sendAbandonedCartEmail(cart).catch(e => console.error('[ABANDONED EMAIL]', e.message));
    }
    if (changed) saveJSON(ABANDONED_FILE, abandonedCarts);
}, 30*60*1000);

// ── DAILY BACKUP ───────────────────────────────────────────────────────────
async function sendDailyBackup() {
    if (!GMAIL_USER || !GMAIL_PASS) return;
    const merged = { ...SETTINGS_DEFAULTS, ...settings };
    if (!merged.backupEnabled) return;
    const targets = [STORE_EMAIL];
    if (merged.ownerEmail && merged.ownerEmail !== STORE_EMAIL) targets.push(merged.ownerEmail);
    const transporter = makeTransporter();
    await transporter.sendMail({
        from: `"${merged.storeName} Backup" <${GMAIL_USER}>`,
        to: targets, subject: `Daily Backup — ${merged.storeName} — ${new Date().toDateString()}`,
        text: `Automated daily backup. Generated: ${new Date().toISOString()}`,
        attachments: [
            { filename:'orders.json',    content: JSON.stringify(orders,null,2),    contentType:'application/json' },
            { filename:'products.json',  content: JSON.stringify(products,null,2),  contentType:'application/json' },
            { filename:'customers.json', content: JSON.stringify(customers,null,2), contentType:'application/json' },
            { filename:'categories.json',content: JSON.stringify(categories,null,2),contentType:'application/json' },
        ]
    });
    console.log('[BACKUP] Sent to', targets.join(', '));
}
(function scheduleDailyBackup() {
    const now = new Date(), next = new Date(now);
    next.setHours(23,0,0,0);
    if (next <= now) next.setDate(next.getDate()+1);
    setTimeout(() => {
        sendDailyBackup().catch(e => console.error('[BACKUP]', e.message));
        setInterval(() => sendDailyBackup().catch(e => console.error('[BACKUP]', e.message)), 24*60*60*1000);
    }, next-now);
    console.log(`[BACKUP] Scheduled daily backup at 23:00 (in ${Math.round((next-now)/3600000)}h)`);
})();

// Health check endpoint (must be before app.listen)
app.get('/api/health', (req, res) => res.json({ ok: true, ts: Date.now() }));

app.listen(PORT, () => {
    console.log(`🚀 Control-Center Shop running on http://localhost:${PORT}`);
    // Keep-alive ping every 10 minutes — prevents server from slowing down under low traffic
    if (process.env.RENDER_EXTERNAL_URL || process.env.BASE_URL) {
        const pingUrl = (process.env.RENDER_EXTERNAL_URL || process.env.BASE_URL) + '/api/health';
        setInterval(() => {
            fetch(pingUrl).catch(() => {});
        }, 10 * 60 * 1000);
        console.log('Keep-alive ping active →', pingUrl);
    }
});

// (health endpoint moved above app.listen)
