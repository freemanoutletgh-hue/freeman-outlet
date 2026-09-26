---
name: vat-and-invoices
description: Rules for Ghana VAT, supply invoices, hard-copy pad invoices, GRA tax invoices and customer invoices in Freeman Outlet. Use when touching prices, totals, invoice layouts, VAT breakdowns, the tax invoice page or the monthly VAT summary.
---

# VAT and invoices

## Ghana VAT (20%)
From 2026, 20% = **VAT 15% + NHIL 2.5% + GETFund Levy 2.5%**, all charged on the **tax-exclusive** value. Prices are stored **VAT-inclusive**; exclusive = inclusive ÷ 1.2.

Example (one 3-pack at the supply price): 250.20 incl. = 208.50 excl. + NHIL 5.21 + GETFund 5.21 + VAT 31.28. The VAT figure is the balancing amount so the three taxes always add to exactly (inclusive − exclusive).

## Documents
| Document | Who gets it | Notes |
|---|---|---|
| **Website order invoice** | online customer (`/api/orders/:id/receipt?phone=`) | Titled "Invoice"; shows a VAT breakdown; default status Pending; sent on WhatsApp. Manual invoice can change prices at sale. |
| **Supply invoice (system copy)** | the owner | Not sent anywhere. Written by hand on the pad invoice with the **hard-copy invoice number typed in by the owner**. VAT-inclusive, unit price × packs. Items grouped by product family ("3 Pack V necks"). |
| **Hard-copy pad invoice** | the shop | ARILEO LIMITED. No. / Qty / Description / Unit / Amount. She copies the system copy. |
| **GRA tax invoice (Form C)** | the shop, issued when she **picks up the cheque** | A replica of the supply invoice: same quantities and total, unit price ÷ 1.2, then Tax-exclusive value, NHIL, GETFund, VAT, total taxes, total inclusive. **One tax invoice per supply** (one cheque can cover several). The GRA serial number is typed in. |

## Prices
- One supply price **per product, per 3-pack, VAT-inclusive**; a product may override it (socks are priced separately). Never one price per shop or per size.
- Everything counts **packs** (rounds, stock, carts, invoices). Labels say "per 3-pack" and "packs".

## Money rules
- **Terms 30 days**: due = date + terms (a shop can have its own). Overdue days count from due.
- A cheque does **not** reduce the balance until it is **Cleared**; until then the invoice shows the cheque as pending. Bounced re-opens it.
- Swap where the shop returns more than it takes → a **credit** applied to its oldest invoices; voiding the swap undoes it.
- Samples is a normal account. **Online** is a built-in shop with no invoices/terms; its sales come from website orders.
- Round to 2 decimals with `round2`; compare with 0.005 tolerance; cap absurd amounts.

## Where the code is
`supply.js` (`vatParts`, `taxInvoiceOf`, `money`, `cleanSupply`), `server.js` (`vatBreakdown`, receipt route), `src/js/admin.js` (`vatBreakdown`, `invoiceWaUrl`, `generateDocHtml`), `src/js/supply-money.js` (invoice, tax invoice, receivables, VAT summary views). Confirm any change to VAT figures with the accountant.
