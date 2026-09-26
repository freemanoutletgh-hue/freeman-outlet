---
name: supply-checks
description: Re-run the Supply, stock-by-size and admin-role safety checks after changing supply.js, stock.js, server.js, admin.js or the supply page. Use before committing or pushing any change that touches stock, money, cheques, invoices, roles or permissions.
---

# Supply checks

Runs 430+ automated checks against a **throw-away copy** of the server (port 3100, temp data folder). Your real `data/` and `uploads/` are never touched.

```
bash .claude/skills/supply-checks/scripts/run.sh            # all four suites
bash .claude/skills/supply-checks/scripts/run.sh roles      # just one: security | logic | photos | roles
```

It must end with `ALL SUITES PASSED`. Stop the normal dev server first if it uses port 3100 (it normally uses 3000).

## What each suite proves
- **security** — who can call what (nobody signed in, staff, boss/viewer, manager, owner); nonsense input (negative, fractional, huge or infinite numbers, `|` in colours, junk bodies); private files are not reachable by URL.
- **logic** — stock pools always equal the sum of logged movements and never go negative; website orders, returns, deletes, manual invoices keep the Online pool in step; 25 simultaneous orders never oversell; payments, cheques (bounce, clear, void), swap credits and overdue days add up correctly.
- **photos** — cheque photo upload, resizing, oversize and non-image rejection, privacy (only signed-in owner/manager/viewer), practice-mode cleanup.
- **roles** — staff (the WhatsApp handler) can see stock but cannot edit products, prices, stock, categories or content; manager/owner still can; staff keep orders, manual invoices and promo codes.

## When a check fails
1. Read the `FAIL:` line — it names the rule and shows the response. Fix the code, not the test, unless the rule itself changed on purpose.
2. Re-run only that suite until it passes, then run everything once more.
3. Server log for the run is printed on failure.

## Adding a check
Add it to the matching file in `scripts/`. The helper `ok(condition, 'what should be true', extraInfo)` counts a pass or a fail. Tests create their own accounts and products (see `seed-products.js`: rich variants, plain variants, one-size, numeric sizes, hostile names).

## Also check by eye (not automated)
Phone-size screens (390 px), the staff view of admin > Stock, and the website product page with size tracking on. Screenshots via headless Chrome are the quickest way.
