# Frontend Design Skill

description: Build clean, minimal, high-quality websites with smooth animations, modern layouts, responsive design, hover effects, scroll animations, and CSS/JS micro-interactions.

---

## Core Philosophy

**Less is more. Motion has meaning. Every pixel earns its place.**

- Remove before you add. Whitespace is a design element, not wasted space.
- Animations should guide attention, not perform for the sake of it.
- Every interaction should feel instant (< 100ms perceived) or intentional (> 300ms with easing).
- Design for the slowest device and smallest screen first, then layer up.

---

## Typography

### Scale
Use a modular type scale. Never mix arbitrary font sizes.

```css
:root {
  --text-xs:   11px;
  --text-sm:   13px;
  --text-base: 15px;
  --text-md:   17px;
  --text-lg:   20px;
  --text-xl:   26px;
  --text-2xl:  34px;
  --text-3xl:  46px;
  --text-4xl:  62px;
}
```

### Rules
- Body: `font-size: 15–16px`, `line-height: 1.65–1.75`, `letter-spacing: -0.01em`
- Headings: tighten line-height (`1.0–1.2`) and letter-spacing (`-0.02em to -0.04em`) at large sizes
- Display headings: use a serif (Cormorant Garamond, Playfair Display) at `font-weight: 300–400` for elegance
- UI labels: sans-serif (Jost, Inter, DM Sans) at `font-weight: 500–700`
- Never use more than 2 font families on one page
- Eyebrow labels: `font-size: 11px; font-weight: 800; letter-spacing: 0.14em; text-transform: uppercase`
- Max line length: `60–75ch` for body text. Use `max-width` on paragraphs.

### Pairing Patterns
- Elegant shop: Cormorant Garamond (headings) + Jost (body/UI)
- Modern SaaS: Inter (both, vary weight)
- Editorial: Playfair Display (headings) + Source Sans Pro (body)

---

## Spacing System

Use an 8px base grid. Every margin, padding, and gap should be a multiple of 4 or 8.

```css
:root {
  --sp-1:  4px;
  --sp-2:  8px;
  --sp-3:  12px;
  --sp-4:  16px;
  --sp-5:  20px;
  --sp-6:  24px;
  --sp-8:  32px;
  --sp-10: 40px;
  --sp-12: 48px;
  --sp-16: 64px;
  --sp-20: 80px;
  --sp-24: 96px;
}
```

### Section Rhythm
- Section padding: `72px 0` desktop, `48px 0` mobile
- Section header margin-bottom: `44–56px`
- Card gap: `20–24px`
- Component internal padding: `24–32px`

---

## Color Systems

### Structure
Always define a complete token set, never hardcode hex values in components.

```css
:root {
  /* Brand */
  --accent:   #e8621a;   /* primary CTA, highlights */
  --accent2:  #d946a8;   /* gradient partner, secondary accent */

  /* Neutrals */
  --dark:     #1a1a1a;   /* text, dark backgrounds */
  --muted:    #6b6b6b;   /* secondary text */
  --border:   #f0e0d8;   /* dividers, card borders */
  --light:    #fff8f4;   /* light backgrounds */
  --white:    #ffffff;

  /* Semantic */
  --error:    #dc2626;
  --success:  #16a34a;
}
```

### Rules
- Use one accent color for all interactive CTAs (buttons, links, focus rings)
- Use a gradient only for decorative purposes, not text on backgrounds
- Maintain 4.5:1 contrast ratio for body text (WCAG AA)
- Hover states: darken or shift to the secondary accent — never just opacity
- Never use pure black (#000) for text — use `#1a1a1a` or `#0f0f0f`

### Gradients
```css
/* Brand gradient — use on highlights, not full backgrounds */
background: linear-gradient(90deg, var(--accent), var(--accent2));

/* Overlay for text on images */
background: linear-gradient(to bottom, rgba(0,0,0,.15) 0%, rgba(0,0,0,.65) 70%, rgba(0,0,0,.75) 100%);
```

---

## Layout Patterns

### CSS Grid
```css
/* 4-col product grid */
.grid-4 {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 20px;
}
@media (max-width: 1024px) { .grid-4 { grid-template-columns: repeat(3, 1fr); } }
@media (max-width: 640px)  { .grid-4 { grid-template-columns: repeat(2, 1fr); gap: 12px; } }

/* 2-col editorial split */
.split { display: grid; grid-template-columns: 1fr 1fr; gap: 60px; align-items: center; }
@media (max-width: 768px) { .split { grid-template-columns: 1fr; gap: 36px; } }
```

### Max-width Container
```css
.wrap { max-width: 1100px; margin: 0 auto; padding: 0 24px; }
@media (max-width: 640px) { .wrap { padding: 0 16px; } }
```

### Sticky Nav
```css
nav {
  position: sticky; top: 0; z-index: 100;
  background: rgba(255,255,255,.92);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border-bottom: 1px solid var(--border);
  transition: box-shadow .2s;
}
nav.scrolled { box-shadow: 0 2px 20px rgba(0,0,0,.08); }
```

---

## Animations & Transitions

### The Easing Library
```css
:root {
  --ease-out:    cubic-bezier(0.16, 1, 0.3, 1);    /* fast start, soft land — most UI */
  --ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1); /* slight overshoot — delightful */
  --ease-in-out: cubic-bezier(0.65, 0, 0.35, 1);   /* balanced — modals, overlays */
}
```

### Duration Guidelines
| Interaction | Duration | Easing |
|---|---|---|
| Hover color/border | 150–200ms | linear or ease-out |
| Button scale/shadow | 180ms | ease-spring |
| Dropdown open | 200ms | ease-out |
| Modal open | 250–300ms | ease-out |
| Page section fade-in | 500–700ms | ease-out |
| Parallax / scroll | 0ms (rAF-driven) | — |

### Hover Effects

**Card lift:**
```css
.card {
  transition: transform 0.22s var(--ease-out), box-shadow 0.22s var(--ease-out);
}
.card:hover {
  transform: translateY(-5px);
  box-shadow: 0 18px 44px rgba(0,0,0,.14);
}
```

**Image zoom on card hover:**
```css
.card-img-wrap { overflow: hidden; border-radius: inherit; }
.card-img-wrap img { transition: transform 0.4s var(--ease-out); }
.card:hover .card-img-wrap img { transform: scale(1.06); }
```

**Button press:**
```css
.btn { transition: background .18s, transform .15s var(--ease-spring), box-shadow .18s; }
.btn:hover  { transform: scale(1.03); box-shadow: 0 8px 24px rgba(0,0,0,.18); }
.btn:active { transform: scale(0.97); box-shadow: none; }
```

**Underline slide:**
```css
.nav-link { position: relative; }
.nav-link::after {
  content: ''; position: absolute; left: 0; bottom: -2px;
  width: 0; height: 2px; background: var(--accent);
  transition: width .2s var(--ease-out);
}
.nav-link:hover::after { width: 100%; }
```

**Reveal on hover (quick-view trigger pattern):**
```css
.trigger {
  opacity: 0; transform: translateY(8px);
  transition: opacity .2s, transform .2s var(--ease-out);
}
.card:hover .trigger { opacity: 1; transform: translateY(0); }
```

---

## Scroll Animations

Use `IntersectionObserver` — never scroll event listeners for entrance effects.

### CSS Setup
```css
.reveal {
  opacity: 0;
  transform: translateY(28px);
  transition: opacity 0.6s var(--ease-out), transform 0.6s var(--ease-out);
}
.reveal.visible {
  opacity: 1;
  transform: translateY(0);
}

/* Staggered children */
.reveal-group .reveal:nth-child(1) { transition-delay: 0ms; }
.reveal-group .reveal:nth-child(2) { transition-delay: 80ms; }
.reveal-group .reveal:nth-child(3) { transition-delay: 160ms; }
.reveal-group .reveal:nth-child(4) { transition-delay: 240ms; }
```

### JS Observer
```javascript
(function() {
  var io = new IntersectionObserver(function(entries) {
    entries.forEach(function(e) {
      if (e.isIntersecting) {
        e.target.classList.add('visible');
        io.unobserve(e.target);
      }
    });
  }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });

  document.querySelectorAll('.reveal').forEach(function(el) { io.observe(el); });
})();
```

### Parallax (performance-safe, rAF-based)
```javascript
var parallaxEl = document.querySelector('.parallax-img');
if (parallaxEl && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
  window.addEventListener('scroll', function() {
    requestAnimationFrame(function() {
      var y = window.scrollY * 0.35;
      parallaxEl.style.transform = 'translateY(' + y + 'px)';
    });
  }, { passive: true });
}
```

---

## Micro-interactions

### Progress / Loading Bar
```css
.progress-bar {
  height: 3px; background: var(--border); border-radius: 2px; overflow: hidden;
}
.progress-fill {
  height: 100%; background: var(--accent); border-radius: 2px;
  transition: width 0.4s var(--ease-out);
  min-width: 4px;
}
```

### Skeleton Loader
```css
@keyframes shimmer {
  0%   { background-position: -400px 0; }
  100% { background-position: 400px 0; }
}
.skeleton {
  background: linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%);
  background-size: 800px 100%;
  animation: shimmer 1.4s infinite linear;
  border-radius: 8px;
}
```

### Toast Notification
```css
.toast {
  position: fixed; bottom: 24px; right: 24px; z-index: 9999;
  background: var(--dark); color: #fff;
  padding: 12px 20px; border-radius: 12px;
  font-size: 13px; font-weight: 600;
  box-shadow: 0 8px 32px rgba(0,0,0,.22);
  transform: translateY(80px); opacity: 0;
  transition: transform 0.3s var(--ease-spring), opacity 0.3s;
  pointer-events: none;
}
.toast.show { transform: translateY(0); opacity: 1; }
.toast.error { background: #dc2626; }
.toast.success { background: var(--accent); }
```

```javascript
function showToast(msg, isError) {
  var t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast show' + (isError ? ' error' : ' success');
  clearTimeout(t._timer);
  t._timer = setTimeout(function() { t.className = 'toast'; }, 3200);
}
```

### Animated Counter
```javascript
function animateCount(el, target, duration) {
  var start = 0, startTime = null;
  function step(ts) {
    if (!startTime) startTime = ts;
    var progress = Math.min((ts - startTime) / duration, 1);
    var ease = 1 - Math.pow(1 - progress, 3); // ease-out cubic
    el.textContent = Math.floor(ease * target).toLocaleString();
    if (progress < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}
```

### Toggle Switch (CSS-only)
```html
<label class="toggle">
  <input type="checkbox" class="sr-only peer">
  <div class="toggle-track"></div>
</label>
```
```css
.sr-only { position:absolute; width:1px; height:1px; overflow:hidden; clip:rect(0,0,0,0); }
.toggle-track {
  width: 44px; height: 26px; border-radius: 13px;
  background: #d1d5db;
  position: relative; transition: background .2s;
}
.toggle-track::after {
  content: ''; position: absolute;
  top: 3px; left: 3px;
  width: 20px; height: 20px; border-radius: 50%;
  background: #fff; box-shadow: 0 1px 4px rgba(0,0,0,.25);
  transition: transform .2s var(--ease-spring);
}
.peer:checked ~ .toggle-track { background: var(--accent); }
.peer:checked ~ .toggle-track::after { transform: translateX(18px); }
```

---

## Responsive Design

### Breakpoint System
```css
/* Mobile-first: write base styles for mobile, override for larger screens */
/* sm  */ @media (min-width: 480px)  { }
/* md  */ @media (min-width: 768px)  { }
/* lg  */ @media (min-width: 1024px) { }
/* xl  */ @media (min-width: 1280px) { }
```

### Touch Targets
- Minimum tap target: `44 × 44px` (Apple HIG) / `48 × 48px` (Material)
- Add padding to small elements rather than making them visually large
- Remove hover effects on touch screens: `@media (hover: none) { .card:hover { transform: none; } }`

### Mobile Patterns
```css
/* Hide on mobile, show on desktop */
.desktop-only { display: none; }
@media (min-width: 768px) { .desktop-only { display: block; } }

/* Stack side-by-side elements on mobile */
.row { display: flex; gap: 16px; flex-wrap: wrap; }
.row > * { flex: 1 1 200px; } /* min 200px, then grow */

/* Full-bleed on mobile */
@media (max-width: 640px) {
  .card { border-radius: 0; margin: 0 -16px; }
}
```

---

## Performance

### Images
- Always set `width` and `height` attributes to prevent layout shift (CLS)
- Use `loading="lazy"` on all below-fold images
- Use `onerror` fallbacks for user-uploaded content
- Use `object-fit: cover` with a fixed container — never let images dictate layout

### Fonts
```html
<!-- Preconnect to font origin -->
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<!-- Load only needed weights -->
<link href="https://fonts.googleapis.com/css2?family=Jost:wght@400;500;600&display=swap" rel="stylesheet">
```
- `font-display: swap` is set by Google Fonts automatically with `display=swap`
- Never load a weight you don't use

### Animation Performance
- Only animate `transform` and `opacity` — they are GPU-composited
- Never animate `width`, `height`, `top`, `left`, `margin` — they trigger layout
- Use `will-change: transform` sparingly, only on elements actively animating
- Always respect `prefers-reduced-motion`:

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

### CSS Variables over JS
Prefer CSS custom properties for theming. JS should only toggle classes, not set inline styles for design tokens.

```javascript
// Bad: el.style.color = '#e8621a'
// Good:
el.classList.add('accent');
```

---

## Checklist Before Shipping

- [ ] All interactive elements have `:hover`, `:focus`, and `:active` states
- [ ] Focus rings are visible (don't `outline: none` without a replacement)
- [ ] All images have `alt` text; decorative images have `alt=""`
- [ ] No layout shift when fonts load (`font-display: swap` + size fallback)
- [ ] Tested on 375px viewport (iPhone SE)
- [ ] Tested at 1.5× text zoom in browser
- [ ] Animations respect `prefers-reduced-motion`
- [ ] Touch targets ≥ 44px on mobile
- [ ] Color contrast passes WCAG AA (4.5:1 for text, 3:1 for UI elements)
- [ ] No JavaScript errors in console on initial load
- [ ] CSS custom properties defined in `:root`, never hardcoded hex in components
