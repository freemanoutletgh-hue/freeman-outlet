# Dashboard Skill

description: Build clean admin dashboards with sidebar navigation, data/stat cards, charts, sortable tables, and responsive grid layouts. Minimal aesthetic, production-ready.

---

## Core Philosophy

**Dashboards are tools, not demos.** Clarity beats cleverness. Numbers must be instantly scannable. Actions must be obviously reachable. Never sacrifice density for whitespace.

- Information hierarchy: metrics first, then tables, then actions
- Color for signal only: red = problem, amber = warning, green = good, blue = info
- Every number needs context: show delta, trend, or comparison
- Mobile-first collapse pattern: sidebar → bottom nav or slide-over on small screens

---

## Layout Shell

### Sidebar + Main

```html
<div class="dash-shell">
  <aside class="dash-sidebar" id="dash-sidebar">
    <div class="sidebar-head">
      <a href="/" class="sidebar-logo">Admin</a>
      <button class="sidebar-close" id="sidebar-close" aria-label="Close menu">&times;</button>
    </div>
    <nav class="sidebar-nav" aria-label="Admin navigation">
      <a href="#overview"  class="sidebar-link active" data-page="overview">
        <svg class="sidebar-icon" ...></svg> Overview
      </a>
      <a href="#orders"    class="sidebar-link" data-page="orders">Orders</a>
      <a href="#products"  class="sidebar-link" data-page="products">Products</a>
      <a href="#customers" class="sidebar-link" data-page="customers">Customers</a>
      <a href="#settings"  class="sidebar-link" data-page="settings">Settings</a>
    </nav>
    <div class="sidebar-foot">
      <a href="/logout" class="sidebar-link sidebar-link-danger">Log Out</a>
    </div>
  </aside>

  <div class="dash-body">
    <header class="dash-header">
      <button class="sidebar-toggle" id="sidebar-toggle" aria-label="Open menu" aria-expanded="false">
        <span></span><span></span><span></span>
      </button>
      <h1 class="dash-page-title">Overview</h1>
      <div class="dash-header-actions">
        <button class="btn btn-sm btn-primary">+ New Product</button>
      </div>
    </header>

    <main class="dash-main" id="dash-main">
      <!-- page content here -->
    </main>
  </div>
</div>
```

```css
.dash-shell {
  display: flex; min-height: 100vh;
  background: #f5f5f7; font-family: var(--fb, system-ui, sans-serif);
}

/* Sidebar */
.dash-sidebar {
  width: 240px; flex-shrink: 0;
  background: #fff; border-right: 1px solid #e5e7eb;
  display: flex; flex-direction: column;
  position: sticky; top: 0; height: 100vh; overflow-y: auto;
  z-index: 50;
}
.sidebar-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 0 20px; height: 64px; border-bottom: 1px solid #e5e7eb;
  flex-shrink: 0;
}
.sidebar-logo { font-size: 18px; font-weight: 800; color: var(--dark, #1a1a1a); text-decoration: none; }
.sidebar-close { display: none; background: none; border: none; font-size: 22px; cursor: pointer; }

.sidebar-nav { flex: 1; padding: 16px 12px; display: flex; flex-direction: column; gap: 2px; }
.sidebar-link {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 12px; border-radius: 8px;
  font-size: 14px; font-weight: 500; color: #6b7280;
  text-decoration: none; transition: background .15s, color .15s;
}
.sidebar-link:hover     { background: #f3f4f6; color: #1a1a1a; }
.sidebar-link.active    { background: #fff3ee; color: var(--accent, #e8621a); font-weight: 600; }
.sidebar-link-danger    { color: #dc2626; }
.sidebar-link-danger:hover { background: #fef2f2; }
.sidebar-icon { width: 18px; height: 18px; flex-shrink: 0; }

.sidebar-foot { padding: 16px 12px; border-top: 1px solid #e5e7eb; }

/* Main area */
.dash-body { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.dash-header {
  height: 64px; background: #fff; border-bottom: 1px solid #e5e7eb;
  display: flex; align-items: center; gap: 16px; padding: 0 24px;
  position: sticky; top: 0; z-index: 40;
}
.dash-page-title { font-size: 18px; font-weight: 700; color: #1a1a1a; margin-right: auto; }
.dash-main { flex: 1; padding: 28px 24px; max-width: 1400px; }

.sidebar-toggle {
  display: none; flex-direction: column; gap: 4px;
  background: none; border: none; cursor: pointer; padding: 6px;
}
.sidebar-toggle span { display: block; width: 20px; height: 2px; background: #374151; }

/* Mobile sidebar */
@media (max-width: 1024px) {
  .dash-sidebar {
    position: fixed; top: 0; left: 0; height: 100vh;
    transform: translateX(-100%); transition: transform .25s cubic-bezier(0.16,1,0.3,1);
    box-shadow: 4px 0 40px rgba(0,0,0,.12);
  }
  .dash-sidebar.open { transform: translateX(0); }
  .sidebar-close  { display: block; }
  .sidebar-toggle { display: flex; }
}
```

```javascript
var sidebarToggle = document.getElementById('sidebar-toggle');
var sidebarClose  = document.getElementById('sidebar-close');
var sidebar       = document.getElementById('dash-sidebar');

function openSidebar()  { sidebar.classList.add('open'); sidebarToggle.setAttribute('aria-expanded', 'true'); }
function closeSidebar() { sidebar.classList.remove('open'); sidebarToggle.setAttribute('aria-expanded', 'false'); }

sidebarToggle.addEventListener('click', openSidebar);
sidebarClose.addEventListener('click', closeSidebar);
document.addEventListener('click', function(e) {
  if (!sidebar.contains(e.target) && e.target !== sidebarToggle) closeSidebar();
});
```

---

## Stat / Data Cards

```html
<div class="stat-grid">
  <div class="stat-card">
    <div class="stat-top">
      <span class="stat-label">Total Revenue</span>
      <span class="stat-icon stat-icon-green">₵</span>
    </div>
    <div class="stat-value">GH₵ 84,230</div>
    <div class="stat-delta stat-up">+12.4% vs last month</div>
  </div>
  <div class="stat-card">
    <div class="stat-top">
      <span class="stat-label">Orders Today</span>
      <span class="stat-icon stat-icon-blue">📦</span>
    </div>
    <div class="stat-value">47</div>
    <div class="stat-delta stat-down">−3 vs yesterday</div>
  </div>
</div>
```

```css
.stat-grid {
  display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px;
  margin-bottom: 28px;
}
@media (max-width: 1200px) { .stat-grid { grid-template-columns: repeat(2, 1fr); } }
@media (max-width: 640px)  { .stat-grid { grid-template-columns: 1fr; } }

.stat-card {
  background: #fff; border: 1px solid #e5e7eb; border-radius: 14px;
  padding: 20px 22px;
  transition: box-shadow .2s;
}
.stat-card:hover { box-shadow: 0 4px 20px rgba(0,0,0,.08); }

.stat-top { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
.stat-label { font-size: 12px; font-weight: 600; color: #6b7280; text-transform: uppercase; letter-spacing: .06em; }
.stat-icon {
  width: 36px; height: 36px; border-radius: 8px;
  display: flex; align-items: center; justify-content: center; font-size: 16px;
}
.stat-icon-green  { background: #d1fae5; color: #059669; }
.stat-icon-orange { background: #ffedd5; color: var(--accent, #e8621a); }
.stat-icon-blue   { background: #dbeafe; color: #2563eb; }
.stat-icon-purple { background: #ede9fe; color: #7c3aed; }

.stat-value { font-size: 28px; font-weight: 800; color: #1a1a1a; line-height: 1.2; margin-bottom: 6px; }
.stat-delta { font-size: 12px; font-weight: 600; }
.stat-up   { color: #059669; }
.stat-down { color: #dc2626; }
.stat-flat { color: #6b7280; }
```

---

## Tables

```html
<div class="table-card">
  <div class="table-head">
    <h3 class="table-title">Recent Orders</h3>
    <input type="search" class="table-search" placeholder="Search orders…" aria-label="Search orders">
  </div>
  <div class="table-wrap">
    <table class="data-table">
      <thead>
        <tr>
          <th class="sortable" data-col="id">Order <span class="sort-icon">↕</span></th>
          <th class="sortable" data-col="customer">Customer <span class="sort-icon">↕</span></th>
          <th class="sortable" data-col="amount">Amount <span class="sort-icon">↕</span></th>
          <th>Status</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody id="orders-tbody">
        <!-- rows inserted by JS -->
      </tbody>
    </table>
  </div>
  <div class="table-foot">
    <span class="table-count">Showing 1–20 of 147</span>
    <div class="pagination">
      <button class="page-btn" disabled>&lsaquo;</button>
      <button class="page-btn active">1</button>
      <button class="page-btn">2</button>
      <button class="page-btn">3</button>
      <button class="page-btn">&rsaquo;</button>
    </div>
  </div>
</div>
```

```css
.table-card {
  background: #fff; border: 1px solid #e5e7eb; border-radius: 16px;
  overflow: hidden; margin-bottom: 24px;
}
.table-head {
  display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px;
  padding: 18px 20px; border-bottom: 1px solid #f3f4f6;
}
.table-title { font-size: 16px; font-weight: 700; }
.table-search {
  padding: 8px 14px; border: 1px solid #e5e7eb; border-radius: 8px;
  font-size: 13px; outline: none; min-width: 220px;
  transition: border-color .15s;
}
.table-search:focus { border-color: var(--accent, #e8621a); }

.table-wrap { overflow-x: auto; }
.data-table { width: 100%; border-collapse: collapse; font-size: 14px; }
.data-table th {
  padding: 12px 16px; text-align: left;
  background: #f9fafb; border-bottom: 1px solid #e5e7eb;
  font-size: 12px; font-weight: 600; color: #6b7280; text-transform: uppercase; letter-spacing: .06em;
  white-space: nowrap;
}
.data-table th.sortable { cursor: pointer; user-select: none; }
.data-table th.sortable:hover { background: #f3f4f6; }
.sort-icon { color: #d1d5db; }
.data-table th.sort-asc  .sort-icon { color: var(--accent, #e8621a); }
.data-table th.sort-desc .sort-icon { color: var(--accent, #e8621a); }

.data-table td {
  padding: 14px 16px; border-bottom: 1px solid #f3f4f6;
  color: #374151; vertical-align: middle;
}
.data-table tr:last-child td { border-bottom: none; }
.data-table tbody tr:hover td { background: #fafafa; }

/* Status badges */
.badge {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 3px 10px; border-radius: 20px; font-size: 11px; font-weight: 700;
}
.badge-green  { background: #d1fae5; color: #065f46; }
.badge-orange { background: #ffedd5; color: #9a3412; }
.badge-blue   { background: #dbeafe; color: #1e40af; }
.badge-red    { background: #fee2e2; color: #991b1b; }
.badge-gray   { background: #f3f4f6; color: #374151; }
.badge::before { content: ''; width: 6px; height: 6px; border-radius: 50%; background: currentColor; }

/* Table footer + pagination */
.table-foot {
  display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px;
  padding: 14px 20px; border-top: 1px solid #f3f4f6;
}
.table-count { font-size: 13px; color: #6b7280; }
.pagination { display: flex; gap: 4px; }
.page-btn {
  width: 34px; height: 34px; border-radius: 8px; border: 1px solid #e5e7eb;
  background: #fff; font-size: 13px; font-weight: 600; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  transition: background .15s, border-color .15s;
}
.page-btn:hover  { background: #f3f4f6; }
.page-btn.active { background: var(--accent, #e8621a); color: #fff; border-color: var(--accent, #e8621a); }
.page-btn:disabled { opacity: .4; cursor: default; }
```

### Table Sort JS
```javascript
function initSortableTable(tableId) {
  var table = document.getElementById(tableId);
  if (!table) return;
  var sortCol = null, sortDir = 1;

  table.querySelectorAll('th.sortable').forEach(function(th) {
    th.addEventListener('click', function() {
      var col = th.dataset.col;
      sortDir = (sortCol === col) ? -sortDir : 1;
      sortCol = col;
      table.querySelectorAll('th.sortable').forEach(function(t) {
        t.classList.remove('sort-asc', 'sort-desc');
      });
      th.classList.add(sortDir === 1 ? 'sort-asc' : 'sort-desc');

      var tbody = table.querySelector('tbody');
      var rows = Array.from(tbody.querySelectorAll('tr'));
      rows.sort(function(a, b) {
        var va = a.querySelector('[data-col="' + col + '"]')?.textContent.trim() || '';
        var vb = b.querySelector('[data-col="' + col + '"]')?.textContent.trim() || '';
        return va.localeCompare(vb, undefined, { numeric: true }) * sortDir;
      });
      rows.forEach(function(r) { tbody.appendChild(r); });
    });
  });
}
```

---

## Charts (Lightweight, no library)

### Bar Chart (CSS-only)
```html
<div class="bar-chart" role="img" aria-label="Monthly sales chart">
  <div class="bar-chart-bars">
    <div class="bar-wrap">
      <div class="bar" style="--h: 60%" title="Jan: GH₵ 12,400"></div>
      <span class="bar-label">Jan</span>
    </div>
    <div class="bar-wrap">
      <div class="bar" style="--h: 85%" title="Feb: GH₵ 17,600"></div>
      <span class="bar-label">Feb</span>
    </div>
    <!-- ... -->
  </div>
</div>
```

```css
.bar-chart { background: #fff; border: 1px solid #e5e7eb; border-radius: 16px; padding: 24px; }
.bar-chart-bars { display: flex; align-items: flex-end; gap: 8px; height: 160px; }
.bar-wrap { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 8px; height: 100%; }
.bar {
  width: 100%; height: var(--h, 0%); border-radius: 6px 6px 0 0;
  background: linear-gradient(to top, var(--accent, #e8621a), #f97316);
  transition: height .5s cubic-bezier(0.16,1,0.3,1);
  cursor: help;
}
.bar:hover { opacity: .8; }
.bar-label { font-size: 11px; color: #9ca3af; font-weight: 600; }
```

### Donut Chart (SVG)
```html
<svg class="donut" width="120" height="120" viewBox="0 0 36 36" aria-label="60% complete">
  <circle class="donut-track"  cx="18" cy="18" r="15.915" fill="none" stroke="#f3f4f6" stroke-width="3.5"/>
  <circle class="donut-fill"   cx="18" cy="18" r="15.915" fill="none"
          stroke="var(--accent)" stroke-width="3.5"
          stroke-dasharray="60 40" stroke-dashoffset="25" stroke-linecap="round"/>
  <text x="18" y="20.5" class="donut-text">60%</text>
</svg>
```

```css
.donut { transform: rotate(-90deg); }
.donut-text { transform: rotate(90deg) translate(0, -36px); fill: #1a1a1a; font-size: 7px; font-weight: 700; text-anchor: middle; }
.donut-fill { transition: stroke-dasharray .8s cubic-bezier(0.16,1,0.3,1); }
```

---

## Section Grid (Dashboard Layout)

```css
/* Two-column main area */
.dash-grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 20px; }
@media (max-width: 1024px) { .dash-grid-2 { grid-template-columns: 1fr; } }

/* Wide + narrow (chart + quick stats) */
.dash-grid-split { display: grid; grid-template-columns: 2fr 1fr; gap: 20px; margin-bottom: 20px; }
@media (max-width: 1024px) { .dash-grid-split { grid-template-columns: 1fr; } }

/* Panel / box */
.dash-panel {
  background: #fff; border: 1px solid #e5e7eb; border-radius: 16px; padding: 24px;
}
.dash-panel-title { font-size: 15px; font-weight: 700; color: #1a1a1a; margin-bottom: 18px; }
```

---

## Empty States

```html
<div class="empty-state">
  <div class="empty-icon">📦</div>
  <h3 class="empty-title">No orders yet</h3>
  <p class="empty-sub">Orders will appear here once customers start purchasing.</p>
  <a href="#products" class="btn btn-primary">View Products</a>
</div>
```

```css
.empty-state {
  text-align: center; padding: 60px 24px;
  display: flex; flex-direction: column; align-items: center; gap: 12px;
}
.empty-icon { font-size: 48px; line-height: 1; }
.empty-title { font-size: 18px; font-weight: 700; color: #1a1a1a; }
.empty-sub   { font-size: 14px; color: #6b7280; max-width: 36ch; }
```

---

## Filters / Toolbar

```html
<div class="toolbar">
  <div class="filter-row">
    <select class="form-select-sm" aria-label="Filter by status">
      <option value="">All Statuses</option>
      <option value="paid">Paid</option>
      <option value="pending">Pending</option>
    </select>
    <select class="form-select-sm" aria-label="Sort by">
      <option>Newest First</option>
      <option>Oldest First</option>
      <option>Highest Value</option>
    </select>
    <button class="btn btn-sm btn-ghost" onclick="clearFilters()">Clear</button>
  </div>
  <div class="toolbar-right">
    <span class="result-count" id="result-count">147 results</span>
    <button class="btn btn-sm btn-primary">Export CSV</button>
  </div>
</div>
```

```css
.toolbar {
  display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px;
  margin-bottom: 16px;
}
.filter-row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
.toolbar-right { display: flex; gap: 10px; align-items: center; }
.result-count { font-size: 13px; color: #6b7280; }
.form-select-sm {
  padding: 7px 28px 7px 10px; border: 1px solid #e5e7eb; border-radius: 8px;
  font-size: 13px; font-weight: 500; background: #fff; cursor: pointer;
  appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%236b7280' stroke-width='1.5' fill='none' stroke-linecap='round'/%3E%3C/svg%3E");
  background-repeat: no-repeat; background-position: right 10px center;
  transition: border-color .15s;
}
.form-select-sm:focus { outline: none; border-color: var(--accent, #e8621a); }
```

---

## Responsive Rules

| Viewport | Sidebar behavior | Stat grid | Table |
|---|---|---|---|
| ≥ 1024px | Fixed visible | 4 columns | Full |
| 768–1023px | Slide-over drawer | 2 columns | Scroll |
| < 768px | Slide-over drawer | 1 column | Scroll |

---

## Performance Tips

- Use `position: sticky` for sidebar on desktop (avoids JS scroll tracking)
- Virtualize long tables (> 500 rows) with a windowed list — never render all rows
- Debounce search input at 250ms; never filter on every keystroke
- Use `content-visibility: auto` on off-screen panels for paint savings
- Charts: SVG for static, `<canvas>` only when animating many data points
- Load chart libraries async + deferred — they should never block initial render
