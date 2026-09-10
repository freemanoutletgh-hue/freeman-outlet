# UI Components Skill

description: Build reusable, accessible, mobile-first UI components — navbar, hero sections, cards, modals, buttons, forms, and footers — with a clean minimal aesthetic.

---

## Core Philosophy

**Components are contracts.** Each component owns its own state, style, and accessibility. Never reach into a component from outside.

- Mobile-first: write base styles for 375px, layer up with `min-width` queries
- Accessible by default: keyboard nav, ARIA roles, focus rings, contrast
- Zero dependencies unless justified — vanilla HTML/CSS/JS first
- Never hardcode color hex — always use CSS custom properties

---

## Navbar

### Sticky Transparent → Solid on Scroll
```html
<nav id="site-nav" role="navigation" aria-label="Main">
  <div class="wrap nav-inner">
    <a href="/" class="nav-logo" aria-label="Home">Brand</a>
    <button class="nav-toggle" aria-expanded="false" aria-controls="nav-menu" aria-label="Open menu">
      <span></span><span></span><span></span>
    </button>
    <ul id="nav-menu" class="nav-menu" role="list">
      <li><a href="#products" class="nav-link">Shop</a></li>
      <li><a href="#about"    class="nav-link">About</a></li>
      <li><a href="#contact"  class="nav-link">Contact</a></li>
    </ul>
    <div class="nav-actions">
      <button class="nav-cart-btn" aria-label="Cart (0 items)">
        <svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>
        <span class="cart-count" aria-hidden="true">0</span>
      </button>
    </div>
  </div>
</nav>
```

```css
nav {
  position: sticky; top: 0; z-index: 100;
  background: rgba(255,255,255,.92);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border-bottom: 1px solid var(--border);
  transition: box-shadow .2s, background .2s;
}
nav.scrolled { box-shadow: 0 2px 20px rgba(0,0,0,.08); }

.nav-inner {
  display: flex; align-items: center; gap: 32px;
  height: 64px;
}
.nav-logo {
  font-family: var(--fh); font-size: 22px; font-weight: 400;
  color: var(--dark); text-decoration: none; flex-shrink: 0;
}
.nav-menu {
  display: flex; gap: 28px; list-style: none; margin: 0; padding: 0;
  margin-left: auto;
}
.nav-link {
  font-size: 13px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase;
  color: var(--dark); text-decoration: none;
  position: relative; padding-bottom: 2px;
}
.nav-link::after {
  content: ''; position: absolute; left: 0; bottom: -2px;
  width: 0; height: 2px; background: var(--accent);
  transition: width .2s cubic-bezier(0.16,1,0.3,1);
}
.nav-link:hover::after { width: 100%; }
.nav-toggle { display: none; }
.cart-count {
  position: absolute; top: -6px; right: -8px;
  width: 18px; height: 18px; border-radius: 50%;
  background: var(--accent); color: #fff;
  font-size: 10px; font-weight: 700;
  display: flex; align-items: center; justify-content: center;
}

/* Mobile nav */
@media (max-width: 768px) {
  .nav-menu {
    display: none; flex-direction: column; gap: 0;
    position: absolute; top: 64px; left: 0; right: 0;
    background: #fff; border-bottom: 1px solid var(--border);
    padding: 16px 0;
    box-shadow: 0 8px 32px rgba(0,0,0,.1);
  }
  .nav-menu.open { display: flex; }
  .nav-menu li a { display: block; padding: 14px 24px; }
  .nav-toggle {
    display: flex; flex-direction: column; gap: 5px;
    background: none; border: none; cursor: pointer; padding: 8px; margin-left: auto;
  }
  .nav-toggle span {
    display: block; width: 22px; height: 2px; background: var(--dark);
    transition: transform .22s, opacity .22s;
  }
  .nav-toggle[aria-expanded="true"] span:nth-child(1) { transform: translateY(7px) rotate(45deg); }
  .nav-toggle[aria-expanded="true"] span:nth-child(2) { opacity: 0; }
  .nav-toggle[aria-expanded="true"] span:nth-child(3) { transform: translateY(-7px) rotate(-45deg); }
}
```

```javascript
// Scroll state
window.addEventListener('scroll', function() {
  document.getElementById('site-nav').classList.toggle('scrolled', window.scrollY > 20);
}, { passive: true });

// Mobile toggle
var toggle = document.querySelector('.nav-toggle');
var menu   = document.getElementById('nav-menu');
toggle.addEventListener('click', function() {
  var open = menu.classList.toggle('open');
  toggle.setAttribute('aria-expanded', open);
});

// Close on outside click
document.addEventListener('click', function(e) {
  if (!e.target.closest('nav')) { menu.classList.remove('open'); toggle.setAttribute('aria-expanded', false); }
});
```

---

## Hero Section

### Split Editorial (text left, image right)
```html
<section class="hero-split">
  <div class="wrap hero-split-inner">
    <div class="hero-text reveal">
      <p class="eyebrow">New Arrivals 2024</p>
      <h1 class="hero-heading">Bold Color.<br>Pure Style.</h1>
      <p class="hero-sub">Handcrafted looks built for the confident. Discover pieces that speak before you do.</p>
      <div class="hero-cta-row">
        <a href="#products" class="btn btn-primary">Shop Now</a>
        <a href="#about"    class="btn btn-ghost">Our Story</a>
      </div>
    </div>
    <div class="hero-img-wrap reveal">
      <img src="/images/hero.jpg" alt="Featured product" width="600" height="720" class="hero-img">
    </div>
  </div>
</section>
```

```css
.hero-split { padding: 80px 0; background: var(--light); overflow: hidden; }
.hero-split-inner {
  display: grid; grid-template-columns: 1fr 1fr; gap: 60px; align-items: center;
}
.eyebrow {
  font-size: 11px; font-weight: 800; letter-spacing: .14em; text-transform: uppercase;
  color: var(--accent); margin-bottom: 16px;
}
.hero-heading {
  font-family: var(--fh); font-size: clamp(42px, 6vw, 72px);
  font-weight: 300; line-height: 1.05; letter-spacing: -.03em;
  color: var(--dark); margin-bottom: 20px;
}
.hero-sub { font-size: 17px; color: var(--muted); line-height: 1.7; max-width: 44ch; margin-bottom: 36px; }
.hero-cta-row { display: flex; gap: 16px; flex-wrap: wrap; }
.hero-img-wrap { position: relative; border-radius: 16px; overflow: hidden; }
.hero-img { width: 100%; height: 100%; object-fit: cover; display: block; }

@media (max-width: 768px) {
  .hero-split-inner { grid-template-columns: 1fr; gap: 40px; }
  .hero-img-wrap { max-height: 420px; }
}
```

### Full-bleed with Overlay
```css
.hero-full {
  position: relative; min-height: 100svh;
  display: flex; align-items: center; justify-content: center;
  text-align: center; overflow: hidden;
}
.hero-full-bg {
  position: absolute; inset: 0;
  background: linear-gradient(to bottom, rgba(0,0,0,.15) 0%, rgba(0,0,0,.5) 100%);
  z-index: 1;
}
.hero-full-content { position: relative; z-index: 2; color: #fff; }
```

---

## Cards

### Product Card
```html
<article class="card product-card" tabindex="0">
  <div class="card-img-wrap">
    <img src="/images/product.jpg" alt="Product name" width="400" height="480" loading="lazy" class="card-img">
    <div class="card-badge">New</div>
    <button class="card-quick-view trigger" aria-label="Quick view Product name">Quick View</button>
  </div>
  <div class="card-body">
    <p class="card-category eyebrow">Dresses</p>
    <h3 class="card-title">Sunset Wrap Dress</h3>
    <div class="card-swatches" aria-label="Available colors"></div>
    <div class="card-foot">
      <span class="card-price">GH₵ 320</span>
      <button class="btn btn-sm btn-primary" aria-label="Add Sunset Wrap Dress to cart">Add to Cart</button>
    </div>
  </div>
</article>
```

```css
.product-card {
  background: #fff; border-radius: 14px; overflow: hidden;
  border: 1px solid var(--border);
  transition: transform .22s cubic-bezier(0.16,1,0.3,1), box-shadow .22s cubic-bezier(0.16,1,0.3,1);
  cursor: pointer;
}
.product-card:hover {
  transform: translateY(-5px);
  box-shadow: 0 18px 44px rgba(0,0,0,.12);
}
.card-img-wrap { position: relative; overflow: hidden; aspect-ratio: 5/6; }
.card-img { width: 100%; height: 100%; object-fit: cover; display: block; transition: transform .4s cubic-bezier(0.16,1,0.3,1); }
.product-card:hover .card-img { transform: scale(1.06); }

.card-badge {
  position: absolute; top: 12px; left: 12px;
  background: var(--accent); color: #fff;
  font-size: 10px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase;
  padding: 4px 10px; border-radius: 20px;
}
.card-quick-view {
  position: absolute; bottom: 12px; left: 50%; transform: translateX(-50%) translateY(8px);
  opacity: 0; transition: opacity .2s, transform .2s cubic-bezier(0.16,1,0.3,1);
  background: rgba(255,255,255,.92); backdrop-filter: blur(8px);
  border: none; border-radius: 8px; padding: 8px 20px;
  font-size: 12px; font-weight: 700; cursor: pointer; white-space: nowrap;
}
.product-card:hover .card-quick-view { opacity: 1; transform: translateX(-50%) translateY(0); }

.card-body { padding: 16px 20px 20px; }
.card-category { margin-bottom: 4px; }
.card-title { font-size: 15px; font-weight: 600; color: var(--dark); margin-bottom: 10px; }
.card-foot { display: flex; align-items: center; justify-content: space-between; margin-top: 14px; }
.card-price { font-size: 16px; font-weight: 700; color: var(--dark); }

/* Color swatches */
.card-swatches { display: flex; gap: 6px; flex-wrap: wrap; }
.color-dot {
  width: 16px; height: 16px; border-radius: 50%;
  border: 2px solid #fff; box-shadow: 0 0 0 1px rgba(0,0,0,.15);
  cursor: pointer; transition: transform .15s;
}
.color-dot:hover { transform: scale(1.25); }
```

### Feature/Info Card
```css
.info-card {
  background: #fff; border: 1px solid var(--border);
  border-radius: 16px; padding: 32px;
  transition: box-shadow .2s;
}
.info-card:hover { box-shadow: 0 8px 32px rgba(0,0,0,.08); }
.info-card-icon {
  width: 48px; height: 48px; border-radius: 12px;
  background: var(--light); display: flex; align-items: center; justify-content: center;
  margin-bottom: 20px; color: var(--accent); font-size: 22px;
}
.info-card-title { font-size: 17px; font-weight: 700; margin-bottom: 8px; }
.info-card-body { font-size: 14px; color: var(--muted); line-height: 1.65; }
```

---

## Buttons

```css
.btn {
  display: inline-flex; align-items: center; gap: 8px;
  font-size: 13px; font-weight: 700; letter-spacing: .04em;
  padding: 0 28px; height: 48px; border-radius: 10px; border: 2px solid transparent;
  cursor: pointer; text-decoration: none; white-space: nowrap;
  transition: background .18s, transform .15s cubic-bezier(0.34,1.56,0.64,1), box-shadow .18s;
}
.btn:focus-visible { outline: 3px solid var(--accent); outline-offset: 3px; }

.btn-primary { background: var(--accent); color: #fff; }
.btn-primary:hover { background: #d45510; transform: scale(1.03); box-shadow: 0 8px 24px rgba(232,98,26,.3); }
.btn-primary:active { transform: scale(0.97); box-shadow: none; }

.btn-ghost { background: transparent; color: var(--dark); border-color: var(--border); }
.btn-ghost:hover { border-color: var(--dark); transform: scale(1.03); }

.btn-outline-accent { background: transparent; color: var(--accent); border-color: var(--accent); }
.btn-outline-accent:hover { background: var(--accent); color: #fff; transform: scale(1.03); }

.btn-sm { height: 36px; padding: 0 16px; font-size: 12px; border-radius: 8px; }
.btn-lg { height: 56px; padding: 0 40px; font-size: 15px; border-radius: 12px; }

/* Loading state */
.btn.loading { pointer-events: none; opacity: .7; }
.btn.loading::after {
  content: ''; width: 14px; height: 14px; border-radius: 50%;
  border: 2px solid rgba(255,255,255,.4); border-top-color: #fff;
  animation: spin .6s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
```

---

## Modal

```html
<div id="modal-overlay" class="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="modal-title" hidden>
  <div class="modal-box">
    <button class="modal-close" aria-label="Close">&times;</button>
    <h2 id="modal-title" class="modal-title">Modal Title</h2>
    <div class="modal-body">
      <!-- content -->
    </div>
    <div class="modal-foot">
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary">Confirm</button>
    </div>
  </div>
</div>
```

```css
.modal-overlay {
  position: fixed; inset: 0; z-index: 1000;
  background: rgba(0,0,0,.55); backdrop-filter: blur(4px);
  display: flex; align-items: center; justify-content: center; padding: 24px;
  opacity: 0; transition: opacity .25s cubic-bezier(0.65,0,0.35,1);
}
.modal-overlay:not([hidden]) { opacity: 1; }
.modal-overlay[hidden] { display: none; }

.modal-box {
  background: #fff; border-radius: 20px; max-width: 520px; width: 100%;
  padding: 36px; position: relative;
  transform: scale(.95) translateY(12px);
  transition: transform .25s cubic-bezier(0.16,1,0.3,1);
  box-shadow: 0 32px 80px rgba(0,0,0,.22);
}
.modal-overlay:not([hidden]) .modal-box { transform: scale(1) translateY(0); }

.modal-close {
  position: absolute; top: 16px; right: 20px;
  background: none; border: none; font-size: 24px; cursor: pointer;
  color: var(--muted); line-height: 1; width: 36px; height: 36px;
  border-radius: 50%; transition: background .15s;
}
.modal-close:hover { background: var(--light); }

.modal-title { font-size: 20px; font-weight: 700; margin-bottom: 16px; }
.modal-body  { font-size: 15px; color: var(--muted); line-height: 1.7; margin-bottom: 28px; }
.modal-foot  { display: flex; gap: 12px; justify-content: flex-end; }

@media (max-width: 480px) {
  .modal-box { padding: 24px; border-radius: 16px; }
  .modal-foot { flex-direction: column-reverse; }
  .modal-foot .btn { width: 100%; justify-content: center; }
}
```

```javascript
function openModal(id) {
  var overlay = document.getElementById(id || 'modal-overlay');
  overlay.hidden = false;
  // Double rAF for transition to fire after display
  requestAnimationFrame(function() {
    requestAnimationFrame(function() { overlay.style.opacity = ''; });
  });
  document.body.style.overflow = 'hidden';
  overlay.querySelector('.modal-close').focus();
}
function closeModal(id) {
  var overlay = document.getElementById(id || 'modal-overlay');
  overlay.hidden = true;
  document.body.style.overflow = '';
}

// ESC key
document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') closeModal();
});

// Click outside
document.querySelectorAll('.modal-overlay').forEach(function(el) {
  el.addEventListener('click', function(e) {
    if (e.target === el) closeModal(el.id);
  });
});

// Focus trap
document.querySelectorAll('.modal-overlay').forEach(function(overlay) {
  overlay.addEventListener('keydown', function(e) {
    if (e.key !== 'Tab') return;
    var focusable = overlay.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    var first = focusable[0], last = focusable[focusable.length - 1];
    if (e.shiftKey) { if (document.activeElement === first) { e.preventDefault(); last.focus(); } }
    else            { if (document.activeElement === last)  { e.preventDefault(); first.focus(); } }
  });
});
```

---

## Forms

```html
<form class="form" novalidate>
  <div class="form-group">
    <label class="form-label" for="name">Full Name <span aria-hidden="true">*</span></label>
    <input type="text" id="name" name="name" class="form-input" placeholder="Jane Doe" autocomplete="name" required>
    <span class="form-error" role="alert"></span>
  </div>
  <div class="form-group">
    <label class="form-label" for="email">Email</label>
    <input type="email" id="email" name="email" class="form-input" placeholder="jane@example.com" autocomplete="email">
  </div>
  <div class="form-group">
    <label class="form-label" for="msg">Message</label>
    <textarea id="msg" name="msg" class="form-input form-textarea" rows="5" placeholder="How can we help?"></textarea>
  </div>
  <button type="submit" class="btn btn-primary">Send Message</button>
</form>
```

```css
.form-group { display: flex; flex-direction: column; gap: 6px; margin-bottom: 20px; }
.form-label { font-size: 13px; font-weight: 600; color: var(--dark); }
.form-label span { color: var(--accent); }

.form-input {
  width: 100%; padding: 12px 16px; border-radius: 10px;
  border: 1.5px solid var(--border); background: #fff;
  font-size: 15px; color: var(--dark); font-family: inherit;
  transition: border-color .15s, box-shadow .15s;
  box-sizing: border-box;
}
.form-input::placeholder { color: #bbb; }
.form-input:focus {
  outline: none; border-color: var(--accent);
  box-shadow: 0 0 0 3px rgba(232,98,26,.12);
}
.form-input.error { border-color: #dc2626; }
.form-input.error:focus { box-shadow: 0 0 0 3px rgba(220,38,38,.12); }
.form-textarea { resize: vertical; min-height: 120px; line-height: 1.6; }
.form-error { font-size: 12px; color: #dc2626; display: none; }
.form-input.error + .form-error { display: block; }

/* Inline form (search, subscribe) */
.form-inline { display: flex; gap: 0; }
.form-inline .form-input { border-radius: 10px 0 0 10px; border-right: none; }
.form-inline .btn { border-radius: 0 10px 10px 0; flex-shrink: 0; }
```

### Select Styled
```css
.form-select {
  appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath d='M1 1l5 5 5-5' stroke='%236b6b6b' stroke-width='1.5' fill='none' stroke-linecap='round'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 14px center;
  padding-right: 40px;
  cursor: pointer;
}
```

---

## Footer

```html
<footer class="site-footer">
  <div class="wrap footer-inner">
    <div class="footer-brand">
      <a href="/" class="footer-logo">Brand</a>
      <p class="footer-tagline">Crafted for the bold.</p>
      <div class="footer-social">
        <a href="#" aria-label="Instagram" class="social-link">IG</a>
        <a href="#" aria-label="TikTok"    class="social-link">TT</a>
        <a href="#" aria-label="WhatsApp"  class="social-link">WA</a>
      </div>
    </div>
    <nav class="footer-nav" aria-label="Footer">
      <div class="footer-col">
        <h4 class="footer-col-title">Shop</h4>
        <ul><li><a href="#">Dresses</a></li><li><a href="#">Tops</a></li></ul>
      </div>
      <div class="footer-col">
        <h4 class="footer-col-title">Help</h4>
        <ul><li><a href="#">FAQ</a></li><li><a href="#">Returns</a></li></ul>
      </div>
    </nav>
  </div>
  <div class="footer-bar wrap">
    <p>&copy; 2024 Brand. All rights reserved.</p>
    <div class="footer-legal">
      <a href="#">Privacy</a> &middot; <a href="#">Terms</a>
    </div>
  </div>
</footer>
```

```css
.site-footer { background: var(--dark); color: rgba(255,255,255,.7); padding-top: 64px; }
.footer-inner { display: grid; grid-template-columns: 1fr auto; gap: 60px; padding-bottom: 48px; }
.footer-logo { font-family: var(--fh); font-size: 24px; color: #fff; text-decoration: none; }
.footer-tagline { font-size: 14px; margin: 8px 0 20px; }
.footer-social { display: flex; gap: 14px; }
.social-link {
  width: 36px; height: 36px; border-radius: 50%;
  border: 1px solid rgba(255,255,255,.2); color: rgba(255,255,255,.7);
  display: flex; align-items: center; justify-content: center;
  font-size: 11px; font-weight: 700; text-decoration: none;
  transition: background .15s, color .15s;
}
.social-link:hover { background: var(--accent); border-color: var(--accent); color: #fff; }
.footer-nav { display: flex; gap: 60px; }
.footer-col-title {
  font-size: 11px; font-weight: 800; letter-spacing: .12em; text-transform: uppercase;
  color: rgba(255,255,255,.4); margin-bottom: 14px;
}
.footer-col ul { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 10px; }
.footer-col a { color: rgba(255,255,255,.7); text-decoration: none; font-size: 14px; transition: color .15s; }
.footer-col a:hover { color: #fff; }
.footer-bar {
  border-top: 1px solid rgba(255,255,255,.1);
  display: flex; align-items: center; justify-content: space-between;
  padding-top: 20px; padding-bottom: 20px;
  font-size: 13px;
}
.footer-legal { display: flex; gap: 20px; }
.footer-legal a { color: rgba(255,255,255,.5); text-decoration: none; }
.footer-legal a:hover { color: #fff; }

@media (max-width: 768px) {
  .footer-inner { grid-template-columns: 1fr; gap: 40px; }
  .footer-bar { flex-direction: column; gap: 10px; text-align: center; }
}
```

---

## Accessibility Checklist

- [ ] All interactive elements reachable by `Tab`
- [ ] Focus ring visible (never `outline: none` without replacement)
- [ ] `aria-label` on icon-only buttons
- [ ] `role="dialog"` + `aria-modal="true"` on modals, focus trapped inside
- [ ] `aria-expanded` on toggles (nav, accordion)
- [ ] `aria-live` or `role="alert"` for dynamic error messages
- [ ] Color contrast ≥ 4.5:1 for body text, ≥ 3:1 for UI elements
- [ ] No hover-only information (all hover content accessible by focus too)
- [ ] Touch targets ≥ 44×44px
- [ ] `alt` on all images; `alt=""` on decorative images
- [ ] `<form>` uses `novalidate` + custom validation (browser defaults are inaccessible)
