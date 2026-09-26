---
name: go-live-checklist
description: Steps to set up the LIVE Freeman Outlet site (Render) after a deploy that adds settings, accounts or features. Use when pushing to main, when the live site looks empty or wrong, or when asked what still needs doing on production.
---

# Go-live checklist (Render)

Local data and live data are **separate**. Anything typed into the local admin does not exist on the live site. Pushing to `main` auto-deploys.

## Before pushing
- `bash .claude/skills/supply-checks/scripts/run.sh` ends with `ALL SUITES PASSED` (see the supply-checks skill).
- `node -c server.js stock.js supply.js` and `node -c` on every changed `src/js/*.js`.
- `git status` shows no `data/`, `.env`, uploads or test accounts; no test passwords in tracked files.

## Environment (Render dashboard, once)
- `NODE_ENV=production`, `JWT_SECRET`, `ADMIN_JWT_SECRET`, `ADMIN_USER`, `ADMIN_PASS` (the server refuses to start in production without them).
- `DATA_DIR` on the persistent disk (e.g. `/var/data`) so shops, supplies, stock and cheque photos survive redeploys. Cheque photos live in `DATA_DIR/private/cheques`.

## Live admin (Settings), once
- WhatsApp number `233539718656`, store name, announcement, socials.
- Company TIN in admin Settings (printed on website invoices) **and** Supply → Settings → Company TIN (printed on GRA tax invoices).
- Brand on every product (Fruit of the Loom, Jockey, Pier One, George, Charnos), colours and real sizes, price per 3-pack.
- Hero / About / FAQ / SEO text that still names one brand only.

## Supply page, once
- Supply → Prices: the standard supply price per 3-pack (VAT-inclusive, e.g. 250.20) and invoice names.
- Supply → Settings: company name/address/phones; re-visit days.
- Create the boss's account in Admin → Settings → Accounts with role **Viewer** (view-only).
- Existing **staff** accounts now see a read-only "Stock" tab instead of Catalogue — tell them.
- Open `/supply.html` on the phone and "Add to Home screen".

## Turning on size stock (only when ready)
1. Supply → Stock → Receive delivery / Count stock so Dome, Online and Supply are counted **by size**.
2. Supply → Stock → Start tracking. Refused if Online is empty (everything would show sold out). Blocked while a round is open.
3. Check a product page: sold-out sizes are greyed. Place a test order, then return it.
Turning tracking off leaves the website on the last synced numbers.

## Ongoing
- Download a Supply backup monthly (Supply → Settings). The automatic email backup does **not** include Supply data.
- Use **Practice mode** to train someone; delete practice records afterwards.
