# Animation Skill

description: Build smooth 60fps animations using CSS keyframes, GSAP, Framer Motion, scroll-triggered effects, page transitions, loading states, and micro-interactions — with full performance discipline.

---

## The Golden Rules of Animation

1. **Only animate `transform` and `opacity`** — everything else triggers layout or paint, killing 60fps.
2. **GPU layers are free to create, expensive to overuse** — `will-change` on 10+ elements at once is a bug.
3. **Duration is feel** — 150ms feels instant, 300ms feels responsive, 600ms feels cinematic, 1000ms+ feels slow.
4. **Easing is personality** — linear is mechanical, ease-out is natural, spring is alive.
5. **Always honor `prefers-reduced-motion`** — disable or substitute all decorative motion.

---

## The Performance Model

### What the Browser Does Per Frame (16ms budget at 60fps)

```
JS → Style → Layout → Paint → Composite
```

- **Composite only** (`transform`, `opacity`): GPU handles it, always 60fps
- **Paint** (`color`, `background`, `box-shadow`, `border-radius`): slow, causes repaint
- **Layout** (`width`, `height`, `top`, `left`, `margin`, `padding`, `font-size`): worst, cascades to everything

### The Only Properties Worth Animating
```css
/* Fast — composited, no layout or paint */
transform: translate(), scale(), rotate(), skew()
opacity: 0 → 1

/* Acceptable with care — paint, no layout */
color, background-color, border-color, box-shadow, filter

/* Never animate */
width, height, top, left, right, bottom, margin, padding,
font-size, line-height, border-width
```

### Promoting to GPU Layer
```css
/* Explicit — use when animation is about to start */
.will-animate { will-change: transform, opacity; }

/* Or implicit — triggers layer promotion but no semantic signal */
.promoted { transform: translateZ(0); }
```

**Rules for `will-change`:**
- Apply it *just before* the animation starts (JS: `el.style.willChange = 'transform'`)
- Remove it *after* the animation ends (`el.style.willChange = 'auto'`)
- Never put it in a base CSS rule that applies to 50+ elements on screen
- Each promoted layer uses GPU memory — a page with 100 promoted layers will stutter on mobile

---

## CSS Keyframe Animations

### The Easing Toolkit
```css
:root {
  --ease-out:     cubic-bezier(0.16, 1, 0.3, 1);      /* fast start, soft landing */
  --ease-in:      cubic-bezier(0.55, 0, 1, 0.45);     /* slow start, fast exit */
  --ease-in-out:  cubic-bezier(0.65, 0, 0.35, 1);     /* S-curve, modal overlays */
  --ease-spring:  cubic-bezier(0.34, 1.56, 0.64, 1);  /* overshoot, feels alive */
  --ease-bounce:  cubic-bezier(0.68, -0.55, 0.27, 1.55); /* stronger bounce */
}
```

### Fade In
```css
@keyframes fadeIn {
  from { opacity: 0; }
  to   { opacity: 1; }
}
.fade-in { animation: fadeIn 0.4s var(--ease-out) forwards; }
```

### Fade In Up (most common entrance)
```css
@keyframes fadeInUp {
  from { opacity: 0; transform: translateY(24px); }
  to   { opacity: 1; transform: translateY(0); }
}
.fade-in-up {
  opacity: 0;
  animation: fadeInUp 0.6s var(--ease-out) forwards;
}
/* Stagger via delay */
.fade-in-up:nth-child(1) { animation-delay: 0ms; }
.fade-in-up:nth-child(2) { animation-delay: 80ms; }
.fade-in-up:nth-child(3) { animation-delay: 160ms; }
.fade-in-up:nth-child(4) { animation-delay: 240ms; }
```

### Scale Pop
```css
@keyframes scalePop {
  0%   { opacity: 0; transform: scale(0.85); }
  70%  { transform: scale(1.04); }
  100% { opacity: 1; transform: scale(1); }
}
.scale-pop { animation: scalePop 0.4s var(--ease-spring) forwards; }
```

### Slide In from Right (drawer / sidebar)
```css
@keyframes slideInRight {
  from { transform: translateX(100%); }
  to   { transform: translateX(0); }
}
.sidebar { animation: slideInRight 0.3s var(--ease-out) forwards; }
.sidebar.closing { animation: slideInRight 0.25s var(--ease-in) reverse forwards; }
```

### Shimmer / Skeleton Loader
```css
@keyframes shimmer {
  0%   { background-position: -600px 0; }
  100% { background-position: 600px 0; }
}
.skeleton {
  background: linear-gradient(90deg, #f0f0f0 25%, #e8e8e8 50%, #f0f0f0 75%);
  background-size: 1200px 100%;
  animation: shimmer 1.5s infinite linear;
  border-radius: 6px;
}
```

### Pulsing Dot (live indicator)
```css
@keyframes pulse {
  0%, 100% { transform: scale(1); opacity: 1; }
  50%       { transform: scale(1.5); opacity: 0.5; }
}
.live-dot {
  width: 8px; height: 8px; border-radius: 50%;
  background: #16a34a;
  animation: pulse 1.8s ease-in-out infinite;
}
```

### Spinning Loader
```css
@keyframes spin {
  to { transform: rotate(360deg); }
}
.spinner {
  width: 20px; height: 20px;
  border: 2px solid rgba(0,0,0,.12);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}
```

### Countdown Flip (number change)
```css
@keyframes flipIn {
  from { transform: rotateX(-90deg); opacity: 0; }
  to   { transform: rotateX(0deg); opacity: 1; }
}
.flip-digit { animation: flipIn 0.25s var(--ease-out) forwards; }
```

---

## Scroll-Triggered Animations (CSS + IntersectionObserver)

### Base Pattern
```css
/* Elements start invisible */
.reveal            { opacity: 0; transform: translateY(32px); }
.reveal-left       { opacity: 0; transform: translateX(-40px); }
.reveal-right      { opacity: 0; transform: translateX(40px); }
.reveal-scale      { opacity: 0; transform: scale(0.92); }

/* Transition applied to all at once */
.reveal, .reveal-left, .reveal-right, .reveal-scale {
  transition: opacity 0.65s var(--ease-out), transform 0.65s var(--ease-out);
}

/* Visible state — JS adds this class */
.reveal.in-view,
.reveal-left.in-view,
.reveal-right.in-view,
.reveal-scale.in-view {
  opacity: 1;
  transform: none;
}
```

### Observer Setup
```javascript
var revealObserver = new IntersectionObserver(function(entries) {
  entries.forEach(function(entry) {
    if (entry.isIntersecting) {
      entry.target.classList.add('in-view');
      revealObserver.unobserve(entry.target); // fire once
    }
  });
}, {
  threshold: 0.1,
  rootMargin: '0px 0px -60px 0px' // trigger slightly before fully in view
});

document.querySelectorAll('.reveal, .reveal-left, .reveal-right, .reveal-scale')
  .forEach(function(el) { revealObserver.observe(el); });
```

### Staggered Children via JS
```javascript
document.querySelectorAll('.stagger-group').forEach(function(group) {
  group.querySelectorAll(':scope > *').forEach(function(child, i) {
    child.style.transitionDelay = (i * 80) + 'ms';
    child.classList.add('reveal');
    revealObserver.observe(child);
  });
});
```

### Scroll-Linked Progress Bar (page scroll indicator)
```javascript
(function() {
  var bar = document.getElementById('scroll-progress');
  if (!bar) return;
  window.addEventListener('scroll', function() {
    requestAnimationFrame(function() {
      var max = document.body.scrollHeight - window.innerHeight;
      bar.style.width = (window.scrollY / max * 100).toFixed(1) + '%';
    });
  }, { passive: true });
})();
```
```css
#scroll-progress {
  position: fixed; top: 0; left: 0; z-index: 9999;
  height: 3px; width: 0;
  background: var(--accent);
  transition: width 0.05s linear;
}
```

### Parallax (rAF, GPU-safe)
```javascript
(function() {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  var parallaxEls = document.querySelectorAll('[data-parallax]');
  if (!parallaxEls.length) return;

  var ticking = false;
  window.addEventListener('scroll', function() {
    if (!ticking) {
      requestAnimationFrame(function() {
        parallaxEls.forEach(function(el) {
          var speed = parseFloat(el.dataset.parallax) || 0.3;
          var rect = el.getBoundingClientRect();
          var offset = (window.innerHeight / 2 - rect.top - rect.height / 2) * speed;
          el.style.transform = 'translateY(' + offset.toFixed(1) + 'px)';
        });
        ticking = false;
      });
      ticking = true;
    }
  }, { passive: true });
})();
```
```html
<!-- Usage -->
<div class="hero-img-wrap">
  <img data-parallax="0.25" src="hero.jpg" alt=""/>
</div>
```

---

## Page Transitions

### CSS Class Approach (no framework)
```css
/* Initial state when page loads */
body { opacity: 0; }

/* Triggered by JS after DOMContentLoaded */
body.loaded {
  opacity: 1;
  transition: opacity 0.4s var(--ease-out);
}

/* Leaving state before navigation */
body.leaving {
  opacity: 0;
  transform: translateY(-8px);
  transition: opacity 0.25s var(--ease-in), transform 0.25s var(--ease-in);
}
```

```javascript
// On load
document.addEventListener('DOMContentLoaded', function() {
  requestAnimationFrame(function() {
    document.body.classList.add('loaded');
  });
});

// On link click (same-origin)
document.querySelectorAll('a[href^="/"]').forEach(function(link) {
  link.addEventListener('click', function(e) {
    var href = link.getAttribute('href');
    if (link.target || e.metaKey || e.ctrlKey) return;
    e.preventDefault();
    document.body.classList.add('leaving');
    setTimeout(function() { window.location.href = href; }, 280);
  });
});
```

### Modal Entrance / Exit
```css
.modal-overlay {
  position: fixed; inset: 0;
  background: rgba(0,0,0,0);
  display: flex; align-items: center; justify-content: center;
  transition: background 0.25s;
  pointer-events: none;
}
.modal-overlay.open {
  background: rgba(0,0,0,.55);
  pointer-events: all;
}
.modal-box {
  transform: scale(0.92) translateY(12px);
  opacity: 0;
  transition: transform 0.3s var(--ease-spring), opacity 0.25s;
}
.modal-overlay.open .modal-box {
  transform: scale(1) translateY(0);
  opacity: 1;
}
```

```javascript
function openModal(id) {
  var overlay = document.getElementById(id);
  overlay.style.display = 'flex';
  requestAnimationFrame(function() {
    requestAnimationFrame(function() { // double rAF ensures display:flex is painted first
      overlay.classList.add('open');
    });
  });
  document.body.style.overflow = 'hidden';
}

function closeModal(id) {
  var overlay = document.getElementById(id);
  overlay.classList.remove('open');
  document.body.style.overflow = '';
  overlay.addEventListener('transitionend', function handler() {
    overlay.style.display = 'none';
    overlay.removeEventListener('transitionend', handler);
  });
}
```

---

## GSAP (GreenSock Animation Platform)

### Setup
```html
<script src="https://cdn.jsdelivr.net/npm/gsap@3/dist/gsap.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/gsap@3/dist/ScrollTrigger.min.js"></script>
```

### Core Patterns
```javascript
gsap.registerPlugin(ScrollTrigger);

// Fade in up (entrance)
gsap.from('.hero-title', {
  opacity: 0, y: 40, duration: 0.8, ease: 'power3.out'
});

// Stagger children
gsap.from('.card', {
  opacity: 0, y: 30, duration: 0.6,
  ease: 'power2.out',
  stagger: 0.1 // 100ms between each
});

// Timeline (sequenced)
var tl = gsap.timeline({ delay: 0.2 });
tl.from('.nav',        { opacity: 0, y: -20, duration: 0.4, ease: 'power2.out' })
  .from('.hero-pill',  { opacity: 0, y: 10, duration: 0.5 }, '-=0.1')
  .from('.hero-h1',    { opacity: 0, y: 20, duration: 0.6 }, '-=0.2')
  .from('.hero-btns',  { opacity: 0, y: 16, duration: 0.5 }, '-=0.3');
```

### ScrollTrigger
```javascript
// Reveal on scroll
gsap.from('.section-heading', {
  scrollTrigger: {
    trigger: '.section-heading',
    start: 'top 80%',   // when top of element hits 80% down the viewport
    end: 'bottom 20%',
    toggleActions: 'play none none reverse' // onEnter, onLeave, onEnterBack, onLeaveBack
  },
  opacity: 0, y: 36, duration: 0.7, ease: 'power3.out'
});

// Scrub (animation tied to scroll position)
gsap.to('.hero-img', {
  scrollTrigger: {
    trigger: '.hero',
    start: 'top top',
    end: 'bottom top',
    scrub: 1.2  // seconds of smoothing
  },
  yPercent: 30  // parallax: image moves 30% of scroll distance
});

// Pinned section (horizontal scroll)
gsap.to('.cards-track', {
  x: () => -(document.querySelector('.cards-track').scrollWidth - window.innerWidth),
  ease: 'none',
  scrollTrigger: {
    trigger: '.cards-section',
    pin: true,
    scrub: 1,
    end: () => '+=' + document.querySelector('.cards-track').scrollWidth
  }
});
```

### GSAP Eases Reference
```javascript
ease: 'none'          // linear
ease: 'power1.out'    // gentle ease-out
ease: 'power2.out'    // medium ease-out (most common)
ease: 'power3.out'    // strong ease-out
ease: 'expo.out'      // explosive start, very soft land
ease: 'back.out(1.7)' // slight overshoot spring
ease: 'elastic.out(1, 0.5)' // springy bounce
ease: 'bounce.out'    // cartoon bounce
```

---

## Framer Motion (React)

### Install
```bash
npm install framer-motion
```

### Entrance Animations
```jsx
import { motion } from 'framer-motion';

// Simple fade in up
<motion.div
  initial={{ opacity: 0, y: 24 }}
  animate={{ opacity: 1, y: 0 }}
  transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
>
  Content
</motion.div>

// With spring
<motion.button
  whileHover={{ scale: 1.04 }}
  whileTap={{ scale: 0.96 }}
  transition={{ type: 'spring', stiffness: 400, damping: 20 }}
>
  Click me
</motion.button>
```

### Variants (staggered lists)
```jsx
const containerVariants = {
  hidden: {},
  visible: {
    transition: { staggerChildren: 0.08 }
  }
};

const itemVariants = {
  hidden:  { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: [0.16, 1, 0.3, 1] } }
};

<motion.ul variants={containerVariants} initial="hidden" animate="visible">
  {items.map(item => (
    <motion.li key={item.id} variants={itemVariants}>{item.name}</motion.li>
  ))}
</motion.ul>
```

### Scroll-Triggered (useInView)
```jsx
import { motion, useInView } from 'framer-motion';
import { useRef } from 'react';

function RevealSection({ children }) {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: '-60px' });

  return (
    <motion.section
      ref={ref}
      initial={{ opacity: 0, y: 32 }}
      animate={isInView ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.65, ease: [0.16, 1, 0.3, 1] }}
    >
      {children}
    </motion.section>
  );
}
```

### Page Transitions (Next.js / React Router)
```jsx
import { AnimatePresence, motion } from 'framer-motion';

// In _app.jsx (Next.js)
export default function App({ Component, pageProps, router }) {
  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={router.route}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8 }}
        transition={{ duration: 0.3, ease: [0.65, 0, 0.35, 1] }}
      >
        <Component {...pageProps} />
      </motion.div>
    </AnimatePresence>
  );
}
```

### Layout Animations (auto-animate repositioning)
```jsx
<motion.div layout layoutId="card-1">
  {/* Framer Motion smoothly animates between positions when this moves in DOM */}
</motion.div>
```

---

## Loading Animations

### Three-dot bounce
```css
@keyframes dotBounce {
  0%, 80%, 100% { transform: scale(0.6); opacity: 0.4; }
  40%           { transform: scale(1); opacity: 1; }
}
.dots { display: flex; gap: 6px; align-items: center; }
.dot {
  width: 8px; height: 8px; border-radius: 50%;
  background: var(--accent);
  animation: dotBounce 1.2s ease-in-out infinite;
}
.dot:nth-child(2) { animation-delay: 0.15s; }
.dot:nth-child(3) { animation-delay: 0.30s; }
```

### Bar loader
```css
@keyframes barPulse {
  0%, 100% { transform: scaleY(0.4); }
  50%       { transform: scaleY(1); }
}
.bars { display: flex; gap: 4px; align-items: center; height: 24px; }
.bar {
  width: 4px; height: 100%; border-radius: 2px;
  background: var(--accent);
  animation: barPulse 1s ease-in-out infinite;
  transform-origin: center;
}
.bar:nth-child(2) { animation-delay: 0.1s; }
.bar:nth-child(3) { animation-delay: 0.2s; }
.bar:nth-child(4) { animation-delay: 0.3s; }
```

### Button loading state
```javascript
function setButtonLoading(btn, loading) {
  if (loading) {
    btn.dataset.originalText = btn.textContent;
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner" style="display:inline-block;width:16px;height:16px;border:2px solid rgba(255,255,255,.3);border-top-color:#fff;border-radius:50%;animation:spin .7s linear infinite;vertical-align:middle;margin-right:8px"></span>Processing…';
  } else {
    btn.disabled = false;
    btn.textContent = btn.dataset.originalText || 'Submit';
  }
}
```

---

## Micro-interactions Reference

### Ripple Effect (Material-style)
```javascript
function addRipple(el) {
  el.style.position = 'relative';
  el.style.overflow = 'hidden';
  el.addEventListener('click', function(e) {
    var ripple = document.createElement('span');
    var rect = el.getBoundingClientRect();
    var size = Math.max(rect.width, rect.height);
    ripple.style.cssText = [
      'position:absolute', 'border-radius:50%', 'pointer-events:none',
      'width:' + size + 'px', 'height:' + size + 'px',
      'left:' + (e.clientX - rect.left - size/2) + 'px',
      'top:' + (e.clientY - rect.top - size/2) + 'px',
      'background:rgba(255,255,255,.25)',
      'transform:scale(0)',
      'animation:ripple 0.5s linear'
    ].join(';');
    el.appendChild(ripple);
    ripple.addEventListener('animationend', function() { ripple.remove(); });
  });
}
```
```css
@keyframes ripple {
  to { transform: scale(2.5); opacity: 0; }
}
```

### Heart/Like Toggle
```css
.like-btn { font-size: 22px; cursor: pointer; user-select: none; }
.like-btn.liked { animation: heartPop 0.35s var(--ease-spring); }
@keyframes heartPop {
  0%   { transform: scale(1); }
  50%  { transform: scale(1.4); }
  100% { transform: scale(1); }
}
```

### Shake on Error
```css
@keyframes shake {
  0%, 100% { transform: translateX(0); }
  20%       { transform: translateX(-8px); }
  40%       { transform: translateX(8px); }
  60%       { transform: translateX(-5px); }
  80%       { transform: translateX(5px); }
}
.shake { animation: shake 0.4s ease-in-out; }
```

### Smooth Accordion (no max-height hack)
```javascript
function toggleAccordion(btn) {
  var body = btn.nextElementSibling;
  var isOpen = body.style.height && body.style.height !== '0px';

  if (isOpen) {
    body.style.height = body.scrollHeight + 'px';
    requestAnimationFrame(function() {
      body.style.transition = 'height 0.3s cubic-bezier(0.65,0,0.35,1)';
      body.style.height = '0px';
    });
  } else {
    body.style.height = '0px';
    body.style.overflow = 'hidden';
    body.style.transition = 'height 0.3s cubic-bezier(0.16,1,0.3,1)';
    requestAnimationFrame(function() {
      body.style.height = body.scrollHeight + 'px';
      body.addEventListener('transitionend', function handler() {
        body.style.height = 'auto';
        body.removeEventListener('transitionend', handler);
      });
    });
  }
}
```

---

## Debugging Animations

```javascript
// Slow all animations 10× to inspect them
document.body.style.setProperty('animation-duration', '10s', 'important');
// Or via DevTools: Animations panel → drag speed slider

// Find the element causing layout thrash
// In Chrome DevTools: Performance tab → record → look for long purple (Layout) frames

// Force GPU layer inspection
// DevTools → Rendering → Layer borders (teal = composited, orange = repaint)
```

### Common Performance Bugs
| Symptom | Cause | Fix |
|---|---|---|
| Jank on scroll | scroll listener doing layout reads | Use `passive: true`, move reads to rAF |
| Blur/shimmer on transform | sub-pixel rendering | `transform: translateZ(0)` or round coordinates |
| Animation skips first frame | class added synchronously | Double `requestAnimationFrame()` before adding class |
| Safari flicker | GPU layer creation | `backface-visibility: hidden` on animated element |
| 30fps on mobile | too many promoted layers | Audit `will-change`, remove it when not animating |

---

## Reduced Motion

Always provide a fallback. This is not optional.

```css
@media (prefers-reduced-motion: reduce) {
  /* Kill decorative motion entirely */
  *, *::before, *::after {
    animation-duration:   0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration:  0.01ms !important;
    scroll-behavior: auto !important;
  }
  /* But keep functional transitions (toast appearing, modal opening) */
  .toast, .modal-overlay, .modal-box {
    transition-duration: 0.2s !important;
  }
}
```

```javascript
// Check in JS before starting GSAP/Framer animations
var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
if (!reduceMotion) {
  // start scroll animations
}

// GSAP: respect it automatically
gsap.defaults({ overwrite: 'auto' });
if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
  gsap.globalTimeline.timeScale(1000); // instant
}
```

---

## 60fps Checklist

- [ ] Only animating `transform` / `opacity` in the hot path
- [ ] `will-change` applied just-in-time, removed after animation
- [ ] Scroll listeners use `{ passive: true }`
- [ ] rAF used for all scroll-driven visual updates
- [ ] No layout reads (`.offsetTop`, `.getBoundingClientRect`) inside rAF loops — batch them before
- [ ] `IntersectionObserver` instead of scroll events for entrance detection
- [ ] Parallax uses `translateY`, not `top` or `margin-top`
- [ ] No `setTimeout` for animation sequencing — use CSS delays or GSAP timeline
- [ ] Modals use double-rAF trick to avoid first-frame skip
- [ ] `prefers-reduced-motion` respected and tested
- [ ] DevTools Performance trace shows consistent 60fps green bars
