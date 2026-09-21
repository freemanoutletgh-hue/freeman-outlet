# Freeman Outlet — Project Guidelines

Freeman Outlet sells genuine Fruit of the Loom undershirts, boxers, unisex socks and ladies' panties in Ghana, at outlet prices — mostly men's inventory today, organized under three categories: **Men**, **Women**, **Unisex**. **The site takes no online payment.** Customers browse, add to cart, fill in delivery details at checkout, and the order is sent straight to the store's WhatsApp — a human sales rep confirms pricing/payment and fulfils the order from there.

## Skill Reference Rule

When building or modifying any website, UI, animation, or admin dashboard in this project, **always reference the relevant skills** in `.claude/skills/` before writing code:

| Task | Skill file |
|---|---|
| Website layout, typography, spacing, color | `.claude/skills/frontend-design/SKILL.md` |
| Animations, transitions, scroll effects | `.claude/skills/animation/SKILL.md` |
| Navbar, hero, cards, modals, buttons, forms, footer | `.claude/skills/ui-components/SKILL.md` |
| Admin dashboard, sidebar, tables, stat cards, charts | `.claude/skills/dashboard/SKILL.md` |
| Programmatic video creation/rendering (Remotion) | `.claude/skills/remotion/SKILL.md` |

Apply the patterns, easing curves, spacing values, and component structures from those files. Do not invent ad-hoc values when the skill already defines them.

---

## Order Model (Non-negotiable)

- **No payment gateway.** There is no Paystack/Stripe integration on the storefront — do not re-add one. `POST /api/whatsapp-order` is the only checkout endpoint; it validates the cart/stock/price server-side, records the order (`paymentMethod: 'whatsapp'`, `paymentStatus: 'pending'`), and returns the order so the client can open a pre-filled WhatsApp message via `notifyOwnerWA()`.
- Checkout only requires **name, phone, and delivery address/zone** — email is optional (used for the confirmation email if given, never required to complete an order).
- Every checkout UI must make it obvious, before the customer commits, that their order + delivery details are sent via WhatsApp and no card/mobile-money info is collected on-site.
- Admin can still update stock, prices, categories, and view orders — that dashboard is unchanged from the base template.

## Brand Rules (Non-negotiable)

- The whole project (storefront + admin) is **black / white / gray with gold detail accents only**. No other hues except semantic red for errors.
- **Never use green** for hover or accent states on customer-facing pages (`index.html`), except the WhatsApp button itself (`var(--wa)` / `var(--wa-dark)`, a deep WhatsApp teal-green that meets 4.5:1 with white text).
- Use `var(--accent)` (`#C9971C`, gold) for interactive highlights, CTA buttons, focus rings, and hover underlines on the storefront; text on gold uses `var(--dark)` (`#1A1A1A`), never white. `var(--dark)`/`var(--navy)` (both `#1A1A1A`) are the primary dark color (nav, headings, footer).
- Admin panel uses the same black/white/gray + gold palette (Tailwind config remaps `orange`/`amber` to a gold ramp); green only for intentional semantic meaning such as the WhatsApp button.
- **No Quick View modal.** Tapping a product opens the full-screen product page (`#qv-overlay`, deep-linked as `/?p=<id>`, back button closes it). Ids/functions keep the `qv` prefix for historical reasons.
- Brand fonts: **Oswald** (`var(--fh)`) for headings, **Work Sans** (`var(--fb)`) for body/UI.
- Color tokens are defined in `:root` in `index.html` / `main.css`. Never hardcode hex values in component styles — including email templates in `server.js`, which should also pull from `settings.accentColor` where practical.

## Font Rules

- **Always load fonts from Google Fonts** (`fonts.googleapis.com`).
- This project's fonts: **Oswald** (headings) + **Work Sans** (body). Do not swap without updating both the `<link>` tag and the `--fh`/`--fb` tokens together.
- Use `<link rel="preconnect">` for both `fonts.googleapis.com` and `fonts.gstatic.com` before the font stylesheet.
- Only load the weights actually used — never load a full weight range.
- Always append `&display=swap` to the Google Fonts URL.

## Standard Resource Stack

When building any website or UI in this project, always use these resources by default:

- **Typography** — Google Fonts (`fonts.googleapis.com`)
- **Animations** — GSAP from cdnjs
- **Utility CSS** — Tailwind CSS (admin dashboard only; storefront uses hand-written CSS)
- **Icons** — Lucide Icons
- **Placeholder images** — Unsplash
- **Components (React only)** — Shadcn/ui (not applicable — this project has no React/npm frontend build)

**Delivery rule:** Link all of the above via CDN `<script>`/`<link>` tags unless the project already has a `package.json` with those packages installed — in that case use the npm imports.

## CDN Library URLs (use these exact URLs — do not guess or invent alternatives)

| Library | URL / Source |
|---|---|
| GSAP core | `https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.2/gsap.min.js` |
| GSAP ScrollTrigger | `https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.2/ScrollTrigger.min.js` |
| Animate.css | `https://animate.style` (docs) — stylesheet: `https://cdnjs.cloudflare.com/ajax/libs/animate.css/4.1.1/animate.min.css` |
| Tailwind CSS | `https://cdn.tailwindcss.com` |
| Shadcn/ui | `https://ui.shadcn.com` — component library for React/Next.js |
| Framer Motion | npm package `framer-motion` — `https://www.npmjs.com/package/framer-motion` |
| Lucide Icons | `https://lucide.dev` — use `lucide-react` (npm) in React, or `https://unpkg.com/lucide@latest` for vanilla JS |
| Heroicons | `https://heroicons.com` — SVG icons, also available via `@heroicons/react` (npm) |
| Phosphor Icons | `https://phosphoricons.com` — SVG icons, also `phosphor-react` (npm) |
| Unsplash (free images) | `https://unsplash.com` — for placeholder/demo images use `https://images.unsplash.com/photo-{id}?w=800` |

---

## Stack

- **Server:** Node.js + Express v5, port 3000
- **Auth:** Basic auth `admin:freeman2026` (default — change `ADMIN_PASS` env var in production) on all `/api/admin/*` and `/admin.html` routes
- **Persistence:** File-based JSON in `data/` directory
- **Uploads:** multer to `public/images/`
- **Admin UI:** `src/pages/admin.html` — uses Tailwind CSS
- **Storefront:** `src/pages/index.html` — uses custom CSS with CSS variables
- **Checkout:** cart + WhatsApp handoff only (see "Order Model" above) — no payment gateway

## Settings Pattern

New settings must be added to `SETTINGS_DEFAULTS` in `server.js`, merged with `loadJSON`, allowed in the PUT `/api/settings` handler, loaded in `loadSettings()` in admin.html, and saved in `saveSettings()` in admin.html.

## XSS Prevention

- Storefront uses `escHtml()` before inserting any user-controlled text into innerHTML.
- Admin uses `escAdm()` for the same purpose.
- Never use `innerHTML` with unescaped server data.

---

## Standing Engineering Rules (apply from day one, not as a later audit)

Compiled from real bugs and audits across the user's other web/e-commerce projects — do not skip these silently.

- **Unify parallel data representations immediately.** If a domain concept can be represented two ways (e.g. simple vs rich product variants, aggregate vs per-unit stock), write one accessor function the moment the second representation appears, and require every call site to use it. Do not let ad hoc checks against one representation accumulate — this is the single biggest recurring bug source across past projects.
- **Every stateful UI flow (modal, wizard, multi-step checkout, admin session) needs an explicit reset path for every exit** — confirm, cancel, outside-click dismiss, and context switch (e.g. switching users) — not just the happy path. When adding new state to a flow, immediately audit all its exits.
- **Escape user-controlled data for its actual output context at build time**, not as a later security-audit pass: HTML-body context, inline JS-string context (e.g. inside `onclick="fn('...')"`), and HTML-attribute context each need a different escaper. Every new template/feature gets this checked before merge, not batched into a periodic sweep.
- **Order flow validates at multiple points**: on cart-add, immediately pre-submit, and again server-side in `/api/whatsapp-order` (price/stock/zone recomputed from server data, never trusted from the client). A single validation point gets bypassed by race conditions or stale client state.
- **After editing a large single-file server, run a syntax check (`node -c server.js`) before considering the change done.** A single syntax error crashes the whole process with no per-request isolation. This bit us once already in this project (an unescaped apostrophe inside a single-quoted JS string in `SETTINGS_DEFAULTS`) — always re-check string literals after bulk text edits.
- **Set explicit UTF-8 charset on all text Content-Type headers.** Periodically grep for mojibake byte patterns (`â€`, `Ã©`, `ðŸ`, `â‚µ` etc.) in source files that may have been copy-pasted from external editors — and verify any finding by directly reading the file, never by trusting console output piped through a Windows shell (it can itself corrupt the display and produce false positives).
- **Never fabricate structured data** (fake reviews/ratings, invented street addresses for a delivery-only business) to satisfy a checklist or silence an audit warning. Omit the optional field, or use the most accurate coarser-grained value available.

## SEO checklist — set up once, but re-verify periodically (it's not "set and forget")

- [ ] `sitemap.xml` — valid, submitted in Google Search Console, re-check "last read" date periodically (a stale read date can mean Google stopped re-crawling it)
- [ ] `robots.txt` — `Allow: /` for `User-agent: *`; only disallow paths you actually want excluded (admin, checkout confirmation, etc.)
- [ ] Canonical `<link rel="canonical">` on every page, pointing to the single correct domain (watch for old/redirecting domains still being used as the GSC property)
- [ ] Meta description **pulled from real per-page content**, not left to render empty when a CMS field is blank — audit the live data, not just the template
- [ ] Product/Organization JSON-LD structured data, honestly filled (see "never fabricate" above)
- [ ] `favicon.ico` at the literal root path (browsers/crawlers check it by convention even when a `<link rel="icon">` tag exists) — a PNG saved with a `.ico` extension works fine via content-sniffing, no real ICO encoder needed
- [ ] `apple-touch-icon` link tag
- [ ] Custom 404 page
- [ ] Diagnose "not showing up in search" with **Google Search Console directly** (Indexing → Pages report, URL Inspection) — a generic web-search `site:` query is unreliable and can show 0 results for a genuinely indexed site
- [ ] Diagnose "not showing up in AI Mode / AI Overviews / AI recommendations" as a **separate track** — those pull from Google Business Profile (Maps: category, service area, reviews, photos) and Merchant/product schema, not organic web ranking. A perfect website is still invisible there without a claimed, complete GBP profile and real reviews.
- [ ] A real, working review-collection loop (e.g. a post-delivery WhatsApp/email prompt linking to a review form or Google review link) — an on-site review form existing is not the same as customers being prompted to use it, and reviews are the highest-leverage lever for both rich snippets and AI recommendations

## Debugging Checklist

When debugging any UI or feature, always check:

- **Console errors** — no uncaught exceptions, no failed network requests
- **Layout shifts** — images have explicit `width`/`height`, no CLS-causing reflows
- **Animation performance** — only `transform` and `opacity` animated; `will-change` set where needed
- **Mobile breakpoints** — tested at 375px, 768px, 1024px minimum
- **Accessibility** — focus states visible, ARIA labels present, `prefers-reduced-motion` respected

## Shaping Checklist

When polishing or reviewing UI, always check:

- **Spacing rhythm** — consistent use of spacing scale (no arbitrary pixel values)
- **Type scale** — headings follow size hierarchy; no rogue font sizes
- **Color contrast** — text meets WCAG AA (4.5:1 for body, 3:1 for large text)
- **Hover states** — every interactive element has a visible hover/focus state using `var(--accent)`
- **Loading states** — async actions show a loader or skeleton; buttons disabled while pending
