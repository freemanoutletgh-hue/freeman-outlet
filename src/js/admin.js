        // ── ADMIN AUTH ────────────────────────────────────────────────────────
        const ADMIN_TOKEN_KEY = 'freeman_admin_token';
        let adminToken = localStorage.getItem(ADMIN_TOKEN_KEY) || '';

        // Intercept ALL fetch calls — auto-inject Bearer token + handle session conflicts
        const _origFetch = window.fetch.bind(window);
        window.fetch = function(url, opts) {
            const s = String(url);
            if (s.includes('/api/') && !s.includes('/api/admin/login') && adminToken) {
                opts = Object.assign({}, opts);
                const existing = opts.headers || {};
                opts.headers = Object.assign({}, existing, { 'Authorization': 'Bearer ' + adminToken });
                if (existing['Content-Type']) opts.headers['Content-Type'] = existing['Content-Type'];
            }
            return _origFetch(url, opts).then(function(resp) {
                // If signed in elsewhere, show alert and force re-login
                if (resp.status === 401) {
                    resp.clone().json().then(function(d) {
                        if (d && d.error === 'signed_in_elsewhere') {
                            localStorage.removeItem(ADMIN_TOKEN_KEY);
                            adminToken = '';
                            alert('' + (d.message || 'You were signed in on another device.') + '\n\nYou will be taken to the login screen.');
                            location.reload();
                        }
                    }).catch(function(){});
                }
                return resp;
            });
        };


        function adminHeaders(includeContentType = true) {
            // Don't include Content-Type for FormData uploads — browser sets it with multipart boundary
            const h = adminToken ? { 'Authorization': 'Bearer ' + adminToken } : {};
            if (includeContentType) h['Content-Type'] = 'application/json';
            return h;
        }

        function adminLogin() {
            const user = document.getElementById('al-user')?.value.trim();
            const pass = document.getElementById('al-pass')?.value;
            const err  = document.getElementById('al-err');
            const btn  = document.getElementById('al-btn');
            if (!user || !pass) { err.textContent = 'Enter username and password.'; err.style.display = ''; return; }
            err.style.display = 'none';
            btn.disabled = true; btn.textContent = 'Signing in…';
            fetch('/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: user, password: pass }) })
                .then(r => r.json())
                .then(d => {
                    if (d.token) {
                        adminToken = d.token;
                        localStorage.setItem(ADMIN_TOKEN_KEY, adminToken);
                        document.getElementById('admin-login-screen').style.display = 'none';
                        document.getElementById('admin-app').style.display = '';
                        const nameEl = document.getElementById('admin-logged-in-name');
                        if (nameEl) nameEl.textContent = d.name + ' (' + d.role + ')';
                        localStorage.setItem('_adminUser', d.username);
                        localStorage.setItem('_adminRole', d.role);
                        startAdminApp(d.role);
                        startOnlinePoll();
                    } else {
                        err.textContent = d.error || 'Invalid credentials.';
                        err.style.display = '';
                    }
                })
                .catch(() => { err.textContent = 'Network error — try again.'; err.style.display = ''; })
                .finally(() => { btn.disabled = false; btn.textContent = 'Sign In'; });
        }

        function adminLogout() {
            if (adminToken) fetch('/api/admin/logout', { method: 'POST', headers: { Authorization: 'Bearer ' + adminToken } }).catch(function(){});
            localStorage.removeItem(ADMIN_TOKEN_KEY);
            localStorage.removeItem('_adminUser');
            adminToken = '';
            location.reload();
        }

        // Show login screen or app based on stored token
        (function initAdminAuth() {
            const loginScreen = document.getElementById('admin-login-screen');
            const app = document.getElementById('admin-app');
            if (!loginScreen || !app) return;
            if (adminToken) {
                fetch('/api/admin/me', { headers: { 'Authorization': 'Bearer ' + adminToken } })
                    .then(r => r.ok ? r.json() : Promise.reject())
                    .then(me => {
                        loginScreen.style.display = 'none';
                        app.style.display = '';
                        const nameEl = document.getElementById('admin-logged-in-name');
                        if (nameEl) nameEl.textContent = me.name + ' (' + me.role + ')';
                        localStorage.setItem('_adminUser', me.username);
                        localStorage.setItem('_adminRole', me.role);
                        startAdminApp(me.role);
                        startOnlinePoll();
                    })
                    .catch(() => { localStorage.removeItem(ADMIN_TOKEN_KEY); adminToken = ''; loginScreen.style.display = 'flex'; app.style.display = 'none'; });
            } else {
                loginScreen.style.display = 'flex';
                app.style.display = 'none';
            }
        })();

        const SECTIONS = ['products', 'orders', 'reviews', 'codes', 'notify', 'images', 'categories', 'faq', 'analytics', 'product-analytics', 'customers', 'stock', 'invoice', 'settings'];

        // ── ADMIN PASSWORD CONFIRM ───────────────────────────────────────────
        let _adminConfirmCb = null;

        function requireAdminConfirm(title, desc, callback) {
            _adminConfirmCb = callback;
            document.getElementById('pwd-modal-title').textContent = title || 'Confirm Action';
            document.getElementById('pwd-modal-desc').textContent  = desc  || 'Enter your admin password to continue.';
            document.getElementById('pwd-modal-input').value = '';
            document.getElementById('pwd-modal-error').classList.add('hidden');
            const modal = document.getElementById('pwd-modal');
            modal.classList.remove('hidden');
            modal.style.display = 'flex';
            setTimeout(() => document.getElementById('pwd-modal-input').focus(), 80);
        }

        function closeAdminConfirm() {
            const modal = document.getElementById('pwd-modal');
            modal.style.display = 'none';
            modal.classList.add('hidden');
            _adminConfirmCb = null;
        }

        async function submitAdminConfirm() {
            const pwd = document.getElementById('pwd-modal-input').value;
            if (!pwd) { document.getElementById('pwd-modal-input').focus(); return; }
            const btn  = document.getElementById('pwd-modal-btn');
            const errEl = document.getElementById('pwd-modal-error');
            btn.disabled = true; btn.textContent = 'Checking…';
            errEl.classList.add('hidden');
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 12000);
            try {
                const res  = await _origFetch('/api/admin/verify-password', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + adminToken },
                    body: JSON.stringify({ password: pwd }),
                    signal: controller.signal
                });
                clearTimeout(timer);
                const data = await res.json();
                if (data.valid) {
                    const cb = _adminConfirmCb;
                    closeAdminConfirm();
                    if (cb) cb();
                } else {
                    errEl.textContent = res.status === 401 ? 'Session expired — please refresh and log in again.' : 'Incorrect password. Try again.';
                    errEl.classList.remove('hidden');
                    document.getElementById('pwd-modal-input').value = '';
                    document.getElementById('pwd-modal-input').focus();
                }
            } catch(e) {
                clearTimeout(timer);
                errEl.textContent = e.name === 'AbortError' ? 'Request timed out. Try again.' : 'Network error. Try again.';
                errEl.classList.remove('hidden');
            } finally {
                btn.disabled = false; btn.textContent = 'Confirm';
            }
        }

        function renderGallerySlots() {
            const grid = document.getElementById('gallery-slots-grid');
            if (!grid || grid.dataset.rendered) return;
            grid.dataset.rendered = '1';
            let html = '';
            for (let i = 1; i <= 9; i++) {
                const slot = 'polar' + i;
                const src = '/assets/images/gallery/polar' + i + '.jpg?t=' + Date.now();
                html += `
                <div class="border border-gray-100 rounded-xl overflow-hidden shadow-sm">
                  <div class="bg-gray-50 overflow-hidden relative" style="aspect-ratio:3/4">
                    <img id="preview-${slot}" src="${src}" alt="Gallery ${i}" class="w-full h-full object-cover" onerror="this.style.opacity='.15'"/>
                    <span class="absolute top-2 left-2 bg-gray-700 text-white text-xs font-bold px-2 py-0.5 rounded">${i}</span>
                  </div>
                  <div class="p-3">
                    <div class="flex gap-1.5">
                      <button onclick="adjustImage('${slot}')" class="flex-1 text-center border border-gray-200 hover:border-orange-400 hover:text-orange-500 text-gray-600 text-xs font-semibold py-1.5 px-2 rounded-lg transition-colors">✦ Adjust</button>
                      <label class="flex-1 cursor-pointer">
                        <span id="${slot}-btn" class="block text-center bg-gray-800 hover:bg-orange-500 text-white text-xs font-semibold py-1.5 px-2 rounded-lg transition-colors">Replace</span>
                        <input type="file" accept="image/*" class="hidden" onchange="uploadSiteImage('${slot}', this)"/>
                      </label>
                    </div>
                    <p id="${slot}-msg" class="text-xs mt-1.5 hidden"></p>
                  </div>
                </div>`;
            }
            grid.innerHTML = html;
        }

        // ── GROUP NAV ────────────────────────────────────────────────────────
        const GROUPS = {
            catalogue: { label: 'Catalogue', tabs: ['products', 'categories', 'stock'] },
            sales:     { label: 'Sales',     tabs: ['orders', 'invoice', 'codes'] },
            customers: { label: 'Customers', tabs: ['customers', 'reviews', 'notify'] },
            content:   { label: 'Content',   tabs: ['images', 'faq'] },
            insights:  { label: 'Insights',  tabs: ['analytics', 'product-analytics'] },
            settings:  { label: 'Settings',  tabs: ['settings'] },
        };
        const TAB_LABELS = {
            products:   'Products',   categories: 'Categories', stock:    'Stock',
            orders:     'Orders',     invoice:    'Invoice',    codes:    'Promos',
            customers:  'Directory',  reviews:    'Reviews',    notify:   'Notify',
            images:     'Images',     faq:      'FAQ',
            analytics:  'Revenue',  'product-analytics': 'Products',  settings:   'Settings',
        };
        let activeGroup = 'catalogue';

        const STATS_TABS = new Set(['products', 'orders', 'analytics']);

        function switchGroup(name) {
            activeGroup = name;
            localStorage.setItem('adminLastGroup', name);
            Object.keys(GROUPS).forEach(g => {
                const btn = document.getElementById('grp-' + g);
                if (btn) btn.classList.toggle('active', g === name);
            });
            const group  = GROUPS[name];
            const subNav = document.getElementById('sub-nav');
            if (group.tabs.length <= 1) {
                subNav.innerHTML = '';
            } else {
                subNav.innerHTML = group.tabs.map(t =>
                    `<button onclick="switchTab('${t}')" id="tab-${t}" class="sub-btn px-4 py-1.5 rounded-lg text-xs font-semibold">${TAB_LABELS[t] || t}</button>`
                ).join('');
            }
            const remembered = localStorage.getItem('adminActiveTab-' + name);
            const target = (remembered && group.tabs.includes(remembered)) ? remembered : group.tabs[0];
            switchTab(target);
        }

        function switchTab(name) {
            SECTIONS.forEach(s => {
                const sec = document.getElementById('section-' + s);
                if (sec) sec.classList.toggle('hidden', s !== name);
            });
            document.querySelectorAll('.sub-btn').forEach(btn => {
                btn.classList.toggle('active', btn.id === 'tab-' + name);
            });
            const statsEl = document.getElementById('dash-stats');
            if (statsEl) statsEl.classList.toggle('hidden', !STATS_TABS.has(name));
            if (activeGroup) localStorage.setItem('adminActiveTab-' + activeGroup, name);
            if (name === 'orders')     loadOrders();
            if (name === 'reviews')    loadReviews();
            if (name === 'codes')      loadCodes();
            if (name === 'notify')     loadNotify();
            if (name === 'categories') loadCategories();
            if (name === 'images')     renderGallerySlots();
            if (name === 'faq')        loadFaqs();
            if (name === 'analytics')         loadAnalytics();
            if (name === 'product-analytics') loadProductAnalytics(true);
            if (name === 'customers')  loadCustomers();
            if (name === 'stock')      { loadStock(); loadIntakes(); }
            if (name === 'products')   loadInventory();
            if (name === 'invoice')    loadInvoiceTab();
            if (name === 'settings')   { loadSettings(); loadAdminAccounts(); if (typeof window._managerSettingsHide === 'function') setTimeout(window._managerSettingsHide, 500); }
        }

        // ── GROUP DRAG-AND-DROP ──────────────────────────────────────────────
        function initTabDragDrop() {
            const groupNav = document.getElementById('group-nav');
            if (!groupNav) return;

            const saved = JSON.parse(localStorage.getItem('adminGroupOrder') || 'null');
            if (Array.isArray(saved)) {
                saved.forEach(name => {
                    const btn = document.getElementById('grp-' + name);
                    if (btn) groupNav.appendChild(btn);
                });
            }

            let dragged = null;
            groupNav.addEventListener('dragstart', e => {
                if (!e.target.classList.contains('grp-btn')) return;
                dragged = e.target;
                setTimeout(() => { if (dragged) dragged.style.opacity = '0.35'; }, 0);
            });
            groupNav.addEventListener('dragend', () => {
                if (dragged) { dragged.style.opacity = ''; dragged = null; }
                const order = [...groupNav.querySelectorAll('.grp-btn')].map(b => b.id.replace('grp-', ''));
                localStorage.setItem('adminGroupOrder', JSON.stringify(order));
            });
            groupNav.addEventListener('dragover', e => {
                e.preventDefault();
                if (!dragged) return;
                const target = e.target.closest('.grp-btn');
                if (!target || target === dragged) return;
                const rect = target.getBoundingClientRect();
                groupNav.insertBefore(dragged, e.clientX < rect.left + rect.width / 2 ? target : target.nextSibling);
            });
            groupNav.querySelectorAll('.grp-btn').forEach(btn => btn.setAttribute('draggable', 'true'));
        }

        // Success toast after product publish redirect
        // ── ONLINE INDICATOR ────────────────────────────────────────────────
        function startOnlinePoll() {
            function poll() {
                fetch('/api/admin/online', { headers: { 'Authorization': 'Bearer ' + adminToken } })
                    .then(r => r.ok ? r.json() : [])
                    .then(function(online) {
                        const el = document.getElementById('admin-online-indicator');
                        if (!el) return;
                        const others = online.filter(function(a) { return a.username !== localStorage.getItem('_adminUser'); });
                        if (!others.length) { el.style.display = 'none'; return; }
                        el.style.display = 'flex';
                        el.innerHTML = others.map(function(a) {
                            return '<span title="' + escAdm(a.name) + ' is online" style="width:28px;height:28px;border-radius:50%;background:#C9971C;color:#fff;font-size:11px;font-weight:700;display:inline-flex;align-items:center;justify-content:center;border:2px solid #fff;margin-left:-6px">' + escAdm((a.name||'?')[0].toUpperCase()) + '</span>';
                        }).join('') + '<span style="margin-left:10px;font-size:11px;color:#888;font-weight:600">' + others.length + ' other admin' + (others.length > 1 ? 's' : '') + ' online</span>';
                    }).catch(function(){});
            }
            poll(); setInterval(poll, 60000);
        }

        // Called after login is confirmed — initialises the full admin app
        function startAdminApp(knownRole) {
            const params = new URLSearchParams(window.location.search);
            if (params.get('success') === 'true') {
                history.replaceState({}, '', '/admin.html');
                showToast('Product published successfully! ✦');
            }
            initTabDragDrop();
            // Apply restrictions FIRST, before any group/tab renders
            if (knownRole) {
                currentAdminRole = knownRole;
                applyRoleRestrictions(knownRole);
            }
            // Always call switchGroup immediately so the correct section shows on first render
            if (knownRole === 'staff') {
                localStorage.setItem('adminLastGroup', 'sales'); // pin staff to Sales
                switchGroup('sales');
            } else {
                const lastGroup = localStorage.getItem('adminLastGroup');
                switchGroup((lastGroup && GROUPS[lastGroup]) ? lastGroup : 'catalogue');
            }
            initAdminRole(); // async confirm + update name display
            // Always load stats for the dashboard header cards
            loadOrders();
            if (knownRole !== 'staff') loadInventory();
        }

        window.addEventListener('DOMContentLoaded', () => {
            // startAdminApp is called by initAdminAuth once the token is verified

            // Prevent bare form submit — all submits are handled via onsubmit or publishBaseProduct
            document.getElementById('product-form').addEventListener('submit', function(e) {
                if (!this.onsubmit) e.preventDefault();
            });

            // Global Escape key handler
            document.addEventListener('keydown', e => {
                if (e.key !== 'Escape') return;
                const drawer = document.getElementById('order-drawer-backdrop');
                if (drawer && !drawer.classList.contains('hidden')) { closeOrderDetail(); return; }
                const crop = document.getElementById('crop-modal');
                if (crop && !crop.classList.contains('hidden')) { closeCropModal(); return; }
                const h = document.getElementById('history-overlay');
                if (h && !h.classList.contains('opacity-0')) { closeHistory(); return; }
            });
        });

        function previewFileImage(input) {
            const file = input.files[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = e => {
                    document.getElementById('image-preview-element').src = e.target.result;
                    document.getElementById('image-preview-box').classList.remove('hidden');
                };
                reader.readAsDataURL(file);
            }
        }

        function removeSelectedImagePreview() {
            document.getElementById('form-image').value = "";
            document.getElementById('image-preview-box').classList.add('hidden');
            document.getElementById('image-preview-element').src = "";
        }

        let productsCache = [];
        function getProductById(id) { return productsCache.find(p => p.id === id) || stockCache.find(p => p.id === id) || null; }

        function collapseInvForm() {
            document.getElementById('section-products')?.classList.add('list-focus');
        }
        function expandInvForm() {
            document.getElementById('section-products')?.classList.remove('list-focus');
        }

        function loadInventory() {
            Promise.all([
                fetch('/api/admin/all-products').then(r => r.json()),
                fetch('/api/inventory/meta').then(r => r.json()).catch(() => ({}))
            ]).then(([products, meta]) => {
                invMetaCache = meta || {};
                stockCache = products;
                productsCache = products.slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
                document.getElementById('stat-total').innerText = products.length;
                document.getElementById('stat-active').innerText = products.filter(p => !p.isSoldOut).length;
                document.getElementById('stat-soldout').innerText = products.filter(p => p.isSoldOut).length;

                const catFilter = document.getElementById('inv-cat-filter');
                if (catFilter) {
                    const cats = [...new Set(products.map(p => p.category).filter(Boolean))].sort();
                    const cur = catFilter.value;
                    catFilter.innerHTML = '<option value="">All categories</option>' + cats.map(c => `<option value="${escAdm(c)}">${escAdm(c)}</option>`).join('');
                    if (cur) catFilter.value = cur;
                }

                const lowStock = products.filter(p => !p.isSoldOut && p.stock !== null && p.stock !== undefined && p.stock <= 3);
                const lowStockBanner = document.getElementById('low-stock-banner');
                if (lowStock.length > 0) {
                    lowStockBanner.innerHTML = `<strong>Low stock alert:</strong> ${lowStock.map(p => `${escAdm(p.name)} (${p.stock} left)`).join(', ')}`;
                    lowStockBanner.classList.remove('hidden');
                } else { lowStockBanner.classList.add('hidden'); }

                const noCat = products.filter(p => !p.category || !p.category.trim());
                const noCatBanner = document.getElementById('no-category-banner');
                if (noCat.length > 0) {
                    noCatBanner.innerHTML = `<strong>${noCat.length} product${noCat.length > 1 ? 's have' : ' has'} no category</strong> — they only appear under "All" on the shop. Click <strong>Edit</strong> on each to assign a category so they show up in the right filter.`;
                    noCatBanner.classList.remove('hidden');
                } else { noCatBanner.classList.add('hidden'); }

                filterInventory();
                populateBaseProductDropdown();
                if (!catsCache.length) loadCategories();
            });
        }

        function filterInventory() {
            const q   = (document.getElementById('inv-search')?.value || '').toLowerCase();
            const cat = document.getElementById('inv-cat-filter')?.value || '';
            const st  = document.getElementById('inv-status-filter')?.value || '';
            let filtered = productsCache.slice();
            if (q)   filtered = filtered.filter(p => p.name.toLowerCase().includes(q) || variantColors(p.variants).join(' ').toLowerCase().includes(q));
            if (cat) filtered = filtered.filter(p => (p.category || '').toLowerCase() === cat.toLowerCase());
            if (st === 'instock') filtered = filtered.filter(p => !p.isSoldOut);
            if (st === 'soldout') filtered = filtered.filter(p => p.isSoldOut);
            renderInventory(filtered);
        }

        function renderInventory(products) {
            const tbody = document.getElementById('inventory-table-body');
            if (!productsCache.length) {
                tbody.innerHTML = `<tr><td colspan="8" class="text-center py-8 text-gray-400 text-xs">No inventory items yet. Create one on the left panel!</td></tr>`;
                return;
            }
            if (!products.length) {
                tbody.innerHTML = `<tr><td colspan="8" class="text-center py-8 text-gray-400 text-xs">No products match your filters.</td></tr>`;
                return;
            }
            tbody.innerHTML = products.map(p => {
                const hasSale = p.originalPrice && parseFloat(p.originalPrice) > parseFloat(p.price);
                const discPct = hasSale ? Math.round((1 - parseFloat(p.price) / parseFloat(p.originalPrice)) * 100) : 0;
                const priceCell = hasSale
                    ? `<span class="font-bold text-gray-900 text-xs">GHS ${p.price}</span>
                       <span class="line-through text-gray-400 text-xs ml-1">${p.originalPrice}</span>
                       <span class="ml-1 text-[9px] font-bold bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">${discPct}% off</span>`
                    : `<span class="font-bold text-gray-900 text-xs">GHS ${p.price}</span>`;
                const isLow = !p.isSoldOut && p.stock !== null && p.stock !== undefined && p.stock <= 3;
                const isFeat = !!p.featured;
                return `
                <tr class="data-row hover:bg-gray-50/50 transition${isLow ? ' bg-red-50/40' : ''}" id="inv-row-${p.id}">
                    <td class="py-3 px-3 w-8"><input type="checkbox" class="bulk-check rounded" style="accent-color:#C9971C" onchange="updateBulkBar()" value="${p.id}"></td>
                    <td class="py-3 px-4" style="min-width:200px;max-width:260px">
                        <div style="display:flex;align-items:center;gap:10px">
                            <img src="${p.image}" style="width:40px;height:40px;object-fit:cover;border-radius:10px;background:#f3f4f6;flex-shrink:0;border:1px solid #f3f4f6" onerror="this.src='data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2240%22 height=%2240%22%3E%3Crect width=%2240%22 height=%2240%22 fill=%22%23f3f4f6%22/%3E%3Ctext x=%2250%25%22 y=%2255%25%22 dominant-baseline=%22middle%22 text-anchor=%22middle%22 font-size=%2218%22%3E%3C/text%3E%3C/svg%3E'">
                            <div style="min-width:0;flex:1">
                                <p class="font-semibold text-gray-900 text-sm truncate">${escAdm(p.name)}</p>
                                <p class="text-gray-400 truncate" style="font-size:11px">${variantColors(p.variants).join(', ') || 'No colour variants'}</p>
                                <p class="text-gray-300 truncate" style="font-size:10px;margin-top:2px">${p.updatedAt ? `${relTime(p.updatedAt)}${p.lastEditedBy ? ' by <strong>' + escAdm(p.lastEditedBy) + '</strong>' : ''}` : p.createdAt ? '' + relTime(p.createdAt) : ''}</p>
                            </div>
                        </div>
                    </td>
                    <td class="py-3 px-4" style="white-space:nowrap">${priceCell}</td>
                    <td class="py-3 px-4 text-xs">${p.category ? `<span class="text-gray-500">${escAdm(p.category)}</span>` : `<span class="text-amber-500 font-semibold cursor-pointer hover:underline" onclick="startEditMode(getProductById('${p.id}'))" title="Click to assign a category">+ Add</span>`}</td>
                    <td class="py-3 px-4 text-xs" id="stock-cell-${p.id}" style="white-space:nowrap">
                        ${p.stock !== null && p.stock !== undefined
                            ? `<span class="font-bold ${p.stock <= 5 ? 'text-rose-600' : 'text-gray-700'}">${p.stock}</span><span class="text-gray-400 ml-1">left</span>`
                            : `<span class="text-gray-400">∞</span>`}
                    </td>
                    <td class="py-3 px-4" style="white-space:nowrap">
                        <span class="px-2.5 py-1 rounded-lg text-[10px] font-bold tracking-wide ${p.isSoldOut ? 'bg-rose-50 text-rose-700 border border-rose-200' : 'bg-emerald-50 text-emerald-700 border border-emerald-200'}">
                            ${p.isSoldOut ? '● Sold Out' : '● In Stock'}
                        </span>
                    </td>
                    <td class="py-3 px-4" style="white-space:nowrap">
                        <button onclick="toggleListed('${p.id}', ${p.isListed !== false})"
                            class="px-2.5 py-1 rounded-lg text-[10px] font-bold tracking-wide transition ${p.isListed === false ? 'bg-gray-100 text-gray-400 border border-gray-200' : 'bg-blue-50 text-blue-700 border border-blue-200'}">
                            ${p.isListed === false ? 'Unlisted' : 'Listed'}
                        </button>
                    </td>
                    <td class="py-3 px-4 text-center">
                        <button onclick="toggleFeatured('${p.id}', ${isFeat})" title="${isFeat ? 'Remove from featured' : 'Mark as featured'}" class="text-xl transition ${isFeat ? 'text-amber-400' : 'text-gray-200 hover:text-amber-300'}">★</button>
                    </td>
                    <td class="py-3 px-4 text-right" style="white-space:nowrap">
                        <button onclick="showHistory(getProductById('${p.id}'))" class="text-gray-400 hover:text-gray-600 font-bold text-xs transition mr-1" title="Change history">History</button>
                        <button onclick="cloneProduct('${p.id}')" class="text-blue-400 hover:text-blue-600 font-bold text-xs transition mr-1" title="Duplicate">Duplicate</button>
                        <button onclick="startEditMode(getProductById('${p.id}'))" class="text-amber-600 hover:text-amber-700 font-bold text-xs transition mr-1">Edit</button>
                        <button onclick="deleteProduct('${p.id}')" class="text-rose-600 hover:text-rose-700 font-bold text-xs transition">Delete</button>
                    </td>
                </tr>`;
            }).join('');
        }

        let historyProduct = null;

        function showHistory(product) {
            historyProduct = product;
            document.getElementById('history-product-name').textContent = product.name;
            const body = document.getElementById('history-body');
            const history = (product.history || []).slice().sort((a, b) => b.timestamp - a.timestamp);

            let html = '';

            // Created entry always first (shown at bottom since newest-first)
            const createdEntry = product.createdAt
                ? `<div class="flex gap-3 pb-4">
                    <div class="flex flex-col items-center flex-shrink-0"><div class="w-8 h-8 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center text-sm">✦</div><div class="w-px flex-1 bg-gray-100 mt-1"></div></div>
                    <div class="pb-4 flex-1">
                      <p class="text-xs font-bold text-gray-900">Product created</p>
                      <p class="text-[11px] text-gray-400 mt-0.5">${new Date(product.createdAt).toLocaleString('en-GH', {dateStyle:'full',timeStyle:'short'})}</p>
                    </div>
                  </div>`
                : '';

            if (!history.length) {
                body.innerHTML = `<p class="text-xs text-gray-400 text-center py-6">No edits recorded yet.</p>` + createdEntry;
            } else {
                html = history.map((entry, i) => {
                    const isLast = i === history.length - 1;
                    const rows = entry.changes.map(c =>
                        `<div class="text-xs text-gray-600 mt-1">
                          <span class="font-semibold text-gray-800">${escAdm(c.label)}:</span>
                          ${c.from ? `<span class="line-through text-gray-400 mr-1">${escAdm(c.from)}</span>` : ''}
                          <span class="text-gray-900">${c.to ? escAdm(c.to) : '—'}</span>
                        </div>`
                    ).join('');
                    return `<div class="flex gap-3">
                      <div class="flex flex-col items-center flex-shrink-0">
                        <div class="w-8 h-8 rounded-full bg-amber-100 text-amber-600 flex items-center justify-center text-sm"></div>
                        ${!isLast || product.createdAt ? '<div class="w-px flex-1 bg-gray-100 mt-1"></div>' : ''}
                      </div>
                      <div class="pb-5 flex-1">
                        <p class="text-xs font-bold text-gray-900">${entry.changes.length} change${entry.changes.length > 1 ? 's' : ''}</p>
                        <p class="text-[11px] text-gray-400 mt-0.5">${new Date(entry.timestamp).toLocaleString('en-GH', {dateStyle:'full',timeStyle:'short'})}</p>
                        <div class="mt-2 bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">${rows}</div>
                      </div>
                    </div>`;
                }).join('') + createdEntry;
                body.innerHTML = html;
            }

            const overlay = document.getElementById('history-overlay');
            overlay.classList.remove('opacity-0','pointer-events-none');
            overlay.classList.add('opacity-100');
        }

        function downloadHistoryCSV() {
            if (!historyProduct) return;
            const p = historyProduct;
            // Prefix values that start with =, +, -, @ with a single quote so spreadsheet apps
            // (Excel/Sheets) treat them as plain text instead of executing them as formulas.
            const esc = v => {
                let s = String(v ?? '');
                if (/^[=+\-@]/.test(s)) s = "'" + s;
                return '"' + s.replace(/"/g, '""') + '"';
            };
            const rows = [];
            rows.push(['"Date"','"Event"','"Field"','"From"','"To"'].join(','));
            if (p.createdAt) {
                rows.push([esc(new Date(p.createdAt).toLocaleString('en-GH')), esc('Product created'), esc('—'), esc('—'), esc(p.name)].join(','));
            }
            const history = (p.history || []).slice().sort((a, b) => a.timestamp - b.timestamp);
            history.forEach(entry => {
                const date = new Date(entry.timestamp).toLocaleString('en-GH');
                entry.changes.forEach(c => {
                    rows.push([esc(date), esc('Edited'), esc(c.label), esc(c.from), esc(c.to)].join(','));
                });
            });
            const csv  = rows.join('\r\n');
            const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
            const url  = URL.createObjectURL(blob);
            const a    = document.createElement('a');
            a.href     = url;
            a.download = 'history-' + p.name.replace(/[^a-z0-9]/gi, '-').toLowerCase() + '.csv';
            a.click();
            URL.revokeObjectURL(url);
        }

        function closeHistory() {
            const overlay = document.getElementById('history-overlay');
            overlay.classList.add('opacity-0','pointer-events-none');
            overlay.classList.remove('opacity-100');
            const box = overlay.querySelector('.bg-white');
            if (box) box.style.transform = 'scale(0.94)';
        }

        function relTime(ts) {
            const s = Math.floor((Date.now() - ts) / 1000);
            if (s < 60)   return 'just now';
            if (s < 3600) return Math.floor(s / 60) + 'm ago';
            if (s < 86400) return Math.floor(s / 3600) + 'h ago';
            if (s < 604800) return Math.floor(s / 86400) + 'd ago';
            return new Date(ts).toLocaleDateString('en-GH', { day: 'numeric', month: 'short', year: 'numeric' });
        }

        let ordersCache = [];
        let orderFilter = 'all';

        function loadOrders() {
            fetch('/api/orders')
                .then(res => res.json())
                .then(orders => {
                    ordersCache = orders;
                    document.getElementById('stat-orders').innerText = orders.length;
                    const revenue = orders.reduce((s, o) => s + parseFloat(o.total || 0), 0);
                    document.getElementById('stat-revenue').innerText = 'GH₵' + revenue.toFixed(2);
                    const now = new Date();
                    const todayRev = orders.filter(o => new Date(o.paidAt).toDateString() === now.toDateString()).reduce((s, o) => s + parseFloat(o.total || 0), 0);
                    const monthRev = orders.filter(o => { const d = new Date(o.paidAt); return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear(); }).reduce((s, o) => s + parseFloat(o.total || 0), 0);
                    document.getElementById('stat-month').innerText = 'GH₵' + monthRev.toFixed(2);
                    document.getElementById('stat-today').innerText = 'GH₵' + todayRev.toFixed(2);
                    renderOrders();
                });
        }

        function inMonth(dateVal, month) {
            if (!month) return true;
            if (!dateVal) return false;
            try { return new Date(dateVal).toISOString().slice(0, 7) === month; } catch { return false; }
        }

        let orderMonth = '';

        let orderSearch = '';

        function setOrderFilter(f) {
            orderFilter = f;
            selectedOrders.clear();
            updateOrderBulkBar(); // clearing the selection above must also hide/refresh the bulk bar — otherwise it stays visible showing a stale count for a now-empty selection
            ['all','Pending','Processing','Shipped','Delivered','Returned','Refunded'].forEach(k => {
                const btn = document.getElementById('ofil-' + k);
                if (!btn) return;
                const isActive = k === f;
                btn.className = `text-xs font-semibold px-4 py-2 rounded-xl whitespace-nowrap transition ${isActive ? 'bg-gray-900 text-white' : 'bg-white border border-gray-200 text-gray-500 hover:border-amber-400 hover:text-amber-600'}`;
            });
            renderOrders();
        }

        function searchOrders(q) {
            orderSearch = (q || '').toLowerCase().trim();
            renderOrders();
        }

        let selectedOrders = new Set();

        function updateOrderBulkBar() {
            const bar = document.getElementById('orders-bulk-bar');
            const countEl = document.getElementById('orders-bulk-count');
            const selectAll = document.getElementById('orders-select-all');
            if (selectedOrders.size > 0) {
                bar.classList.remove('hidden');
                countEl.textContent = selectedOrders.size + ' order' + (selectedOrders.size > 1 ? 's' : '') + ' selected';
            } else {
                bar.classList.add('hidden');
            }
            const visibleIds = Array.from(document.querySelectorAll('.order-chk')).map(c => c.dataset.id);
            if (selectAll) selectAll.checked = visibleIds.length > 0 && visibleIds.every(id => selectedOrders.has(id));
        }

        function toggleOrderRow(id, checked) {
            if (checked) selectedOrders.add(id); else selectedOrders.delete(id);
            updateOrderBulkBar();
        }

        function toggleAllOrders(checked) {
            document.querySelectorAll('.order-chk').forEach(c => {
                c.checked = checked;
                if (checked) selectedOrders.add(c.dataset.id); else selectedOrders.delete(c.dataset.id);
            });
            updateOrderBulkBar();
        }

        function clearOrderSelection() {
            selectedOrders.clear();
            document.querySelectorAll('.order-chk').forEach(c => c.checked = false);
            const sa = document.getElementById('orders-select-all');
            if (sa) sa.checked = false;
            updateOrderBulkBar();
        }

        function bulkDeleteOrders() {
            if (!selectedOrders.size) return;
            const thisMonth = new Date().toISOString().slice(0, 7);
            const allIds = Array.from(selectedOrders);
            const ids = allIds.filter(id => {
                const o = ordersCache.find(o => o.id === id);
                return o && !inMonth(o.paidAt || o.createdAt, thisMonth);
            });
            const skipped = allIds.length - ids.length;
            if (!ids.length) {
                showToast('No orders to delete — current month orders are protected.', true);
                return;
            }
            const skipNote = skipped > 0 ? ` (${skipped} current-month order${skipped > 1 ? 's' : ''} will be skipped)` : '';
            requireAdminConfirm(
                'Bulk Delete Orders',
                `This will email backups then permanently delete ${ids.length} order${ids.length > 1 ? 's' : ''}${skipNote}. This cannot be undone.`,
                async () => {
                    // Target the delete button specifically — it used to be the first
                    // <button> in the bar (bar.querySelector('button')), which is
                    // actually "✓ Apply" in DOM order. That left Apply permanently
                    // stuck disabled/showing "Deleting…" after every bulk delete,
                    // since this code never restored it (the bar itself is just
                    // hidden afterwards, not rebuilt, so the stale state persisted
                    // into the next time it was shown).
                    const btn = document.getElementById('bulk-delete-btn');
                    const originalText = btn.textContent;
                    btn.disabled = true; btn.textContent = 'Deleting…';
                    let failed = 0;
                    try {
                        for (const id of ids) {
                            try {
                                const r = await fetch('/api/orders/' + id, { method: 'DELETE' });
                                const d = await r.json();
                                if (d.success) {
                                    const row = document.getElementById('order-row-' + id);
                                    if (row) row.remove();
                                    selectedOrders.delete(id);
                                } else { failed++; }
                            } catch { failed++; }
                        }
                    } finally {
                        btn.disabled = false; btn.textContent = originalText;
                    }
                    clearOrderSelection();
                    loadOrders();
                    if (failed) showToast(failed + ' order(s) could not be deleted.', true);
                    else showToast(`${ids.length} order${ids.length > 1 ? 's' : ''} deleted.${skipped ? ' ' + skipped + ' current-month order(s) were kept.' : ''}`);
                }
            );
        }

        function bulkUpdateStatus() {
            const sel = document.getElementById('bulk-status-select');
            const status = sel && sel.value;
            if (!status || !selectedOrders.size) { showToast('Select orders and a status.', true); return; }
            const ids = Array.from(selectedOrders);
            fetch('/api/orders/bulk-status', {
                method: 'POST',
                headers: adminHeaders(),
                body: JSON.stringify({ ids, status })
            }).then(r => r.json()).then(d => {
                if (d.success) { showToast('Updated ' + d.updated + ' orders to ' + status); clearOrderSelection(); loadOrders(); }
                else showToast(d.message || 'Failed.', true);
            });
        }

        function renderOrders() {
            const tbody = document.getElementById('orders-table-body');
            let filtered = orderFilter === 'all' ? ordersCache : ordersCache.filter(o => (o.status || 'Pending') === orderFilter);
            filtered = filtered.filter(o => inMonth(o.paidAt || o.createdAt, orderMonth));
            if (orderSearch) {
                filtered = filtered.filter(o => {
                    const c = o.customer || {};
                    return (c.name || '').toLowerCase().includes(orderSearch) ||
                           (c.phone || '').toLowerCase().includes(orderSearch) ||
                           (c.email || '').toLowerCase().includes(orderSearch) ||
                           (o.id || '').toLowerCase().includes(orderSearch) ||
                           (o.trackingNumber || '').toLowerCase().includes(orderSearch) ||
                           (o.items || []).some(i => (i.name || '').toLowerCase().includes(orderSearch));
                });
            }
            if (!ordersCache.length) {
                tbody.innerHTML = `<tr><td colspan="9" class="text-center py-8 text-gray-400 text-xs">No orders yet. Orders will appear here after customers check out via WhatsApp.</td></tr>`;
                return;
            }
            if (!filtered.length) {
                const ctx = [orderMonth ? new Date(orderMonth + '-01').toLocaleString('en-GH', {month:'long',year:'numeric'}) : '', orderFilter !== 'all' ? orderFilter : ''].filter(Boolean).join(' · ');
                tbody.innerHTML = `<tr><td colspan="9" class="text-center py-8 text-gray-400 text-xs">No orders${ctx ? ' for ' + ctx : ''}.</td></tr>`;
                return;
            }
            tbody.innerHTML = filtered.slice().sort((a, b) => new Date(b.paidAt) - new Date(a.paidAt)).map(o => {
                const date = new Date(o.paidAt).toLocaleString('en-GH', { dateStyle: 'medium', timeStyle: 'short' });
                const itemSummary = o.items.map(i => `${escAdm(i.name)}${i.color ? ` (${escAdm(i.color)})` : ''} ×${escAdm(i.quantity)}`).join(', ');
                const status = o.status || 'Pending';
                const statusColors = { 'Pending':'bg-yellow-100 text-yellow-700', 'Processing':'bg-blue-100 text-blue-700', 'Shipped':'bg-purple-100 text-purple-700', 'Delivered':'bg-green-100 text-green-700', 'Returned':'bg-red-100 text-red-600', 'Refunded':'bg-rose-100 text-rose-700', 'Needs Review':'bg-red-100 text-red-700' };
                const sc = statusColors[status] || 'bg-gray-100 text-gray-600';
                const alertBadge = o.fulfillmentAlert ? `<span class="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold bg-red-50 text-red-600 border border-red-200" title="${escAdm(o.fulfillmentAlert)}">Stock issue</span>` : '';
                const ps = o.paymentStatus || 'paid';
                const payBadge = ps === 'paid'
                    ? `<span class="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold bg-orange-50 text-orange-600 border border-orange-100">✓ Paid</span>`
                    : ps === 'test'
                    ? `<span class="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold bg-gray-100 text-gray-500 border border-gray-200">Test</span>`
                    : `<span class="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold bg-gray-100 text-gray-500 border border-gray-200">✓ Paid</span>`;
                const isChecked = selectedOrders.has(o.id);
                return `
                <tr class="data-row hover:bg-amber-50/30 transition cursor-pointer" id="order-row-${o.id}" onclick="openOrderDetail('${o.id}')">
                    <td class="py-4 px-4" onclick="event.stopPropagation()">
                        <input type="checkbox" class="order-chk rounded border-gray-300 accent-orange-500 cursor-pointer" data-id="${o.id}" ${isChecked ? 'checked' : ''} onchange="toggleOrderRow('${o.id}', this.checked)"/>
                    </td>
                    <td class="py-4 px-4">
                        <p class="font-bold text-orange-500 text-sm">${o.orderNo ? '#' + o.orderNo : escAdm(o.id)}</p>
                        <p class="font-mono text-[10px] text-gray-300 mt-0.5">${escAdm(o.id)}</p>
                    </td>
                    <td class="py-4 px-4">
                        <p class="font-semibold text-gray-900 text-xs">${escAdm((o.customer||{}).name||"-")}</p>
                        <p class="text-[11px] text-gray-400">${escAdm((o.customer||{}).phone||"")}</p>
                        <p class="text-[11px] text-gray-400">${escAdm((o.customer||{}).address||"")}</p>
                    </td>
                    <td class="py-4 px-4 text-xs text-gray-500 max-w-xs">${itemSummary}</td>
                    <td class="py-4 px-4 font-bold text-gray-900 text-xs">GHS ${parseFloat(o.total).toFixed(2)}</td>
                    <td class="py-4 px-4"><div class="flex flex-col gap-1">${payBadge}${alertBadge}</div></td>
                    <td class="py-4 px-4" onclick="event.stopPropagation()">
                        <select onchange="updateOrderStatus('${o.id}', this.value, this)" class="text-xs border border-gray-200 rounded-lg px-2 py-1 font-semibold ${sc} cursor-pointer">
                            ${['Pending','Processing','Shipped','Delivered','Returned','Refunded'].map(s => `<option value="${s}" ${s===status?'selected':''}>${s}</option>`).join('')}
                        </select>
                    </td>
                    <td class="py-4 px-4 text-xs text-gray-400 whitespace-nowrap">${date}</td>
                    <td class="py-4 px-4" onclick="event.stopPropagation()">
                        <div class="flex gap-1">
                            <button onclick="printOrderDoc('${o.id}')" title="Download invoice" class="text-xs px-2 py-1 rounded-lg bg-orange-50 text-orange-500 hover:bg-orange-100 font-semibold border border-orange-100 transition">Invoice</button>
                            <button id="del-btn-${o.id}" onclick="deleteOrder('${o.id}')" title="Archive & delete — sends email backup first" class="text-xs px-2 py-1 rounded-lg bg-red-50 text-red-500 hover:bg-red-100 font-semibold border border-red-100 transition">Delete</button>
                        </div>
                    </td>
                </tr>`;
            }).join('');
        }

        function saveTracking(orderId) {
            const carrier = (document.getElementById('od-tracking-carrier')?.value || '').trim();
            const num     = (document.getElementById('od-tracking-num')?.value || '').trim();
            fetch('/api/orders/' + orderId + '/tracking', {
                method: 'PATCH',
                headers: adminHeaders(),
                body: JSON.stringify({ trackingNumber: num, trackingCarrier: carrier })
            })
            .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
            .then(d => {
                if (d.success) {
                    // Update local cache so re-opening the drawer shows the saved value
                    const cached = ordersCache.find(o => o.id === orderId);
                    if (cached) { cached.trackingNumber = num; cached.trackingCarrier = carrier; }
                    showToast('✓ Tracking number saved.');
                } else {
                    showToast(d.message || 'Save failed.', true);
                }
            })
            .catch(e => showToast('Could not save tracking: ' + e.message, true));
        }

        function saveOrderNote(orderId) {
            const inp  = document.getElementById('od-note-input');
            const note = (inp?.value || '').trim();
            if (!note) return;
            fetch('/api/orders/' + orderId + '/note', {
                method: 'PATCH', headers: adminHeaders(),
                body: JSON.stringify({ note })
            }).then(r => r.json()).then(d => {
                if (d.success) {
                    // Patch the cache with the server's copy before re-rendering —
                    // openOrderDetail reads only from ordersCache, which loadOrders()
                    // would otherwise leave stale until the next full refresh, making
                    // the just-added note appear to have silently failed.
                    const cached = ordersCache.find(o => o.id === orderId);
                    if (cached && d.order) Object.assign(cached, d.order);
                    showToast('Note added.'); inp.value = ''; openOrderDetail(orderId);
                }
                else showToast(d.message || 'Save failed.', true);
            }).catch(() => showToast('Network error — note not saved.', true));
        }

        function markReturn(orderId, status) {
            const reason = (document.getElementById('od-return-reason')?.value || '').trim();
            const amount = document.getElementById('od-refund-amount')?.value || 0;
            fetch('/api/orders/' + orderId + '/return', {
                method: 'PATCH', headers: adminHeaders(),
                body: JSON.stringify({ status, returnReason: reason, refundAmount: amount })
            }).then(r => r.json()).then(d => {
                if (d.success) { showToast('Order marked ' + status + '.'); openOrderDetail(orderId); loadOrders(); }
                else showToast(d.message || 'Failed.', true);
            });
        }

        function updateOrderStatus(id, status, selectEl) {
            const statusColors = { 'Pending':'bg-yellow-100 text-yellow-700', 'Processing':'bg-blue-100 text-blue-700', 'Shipped':'bg-purple-100 text-purple-700', 'Delivered':'bg-green-100 text-green-700', 'Returned':'bg-red-100 text-red-600', 'Refunded':'bg-rose-100 text-rose-700' };
            const prev = selectEl.dataset.prev || selectEl.value;

            if (status === 'Shipped') {
                // Revert dropdown until the modal is confirmed
                selectEl.value = prev;
                openShippingModal(id, prev, selectEl, statusColors);
                return;
            }

            selectEl.dataset.prev = status;
            selectEl.className = `text-xs border border-gray-200 rounded-lg px-2 py-1 font-semibold ${statusColors[status] || 'bg-gray-100 text-gray-600'} cursor-pointer`;

            const cached = ordersCache.find(o => o.id === id);
            if (cached) cached.status = status;

            fetch(`/api/orders/${id}/status`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status })
            })
            .then(r => r.json())
            .then(data => {
                if (!data.success) {
                    showToast('Could not update status: ' + (data.message || 'unknown error'), true);
                    if (cached) cached.status = prev;
                    selectEl.value = prev;
                    selectEl.className = `text-xs border border-gray-200 rounded-lg px-2 py-1 font-semibold ${statusColors[prev] || 'bg-gray-100 text-gray-600'} cursor-pointer`;
                }
            })
            .catch(() => {
                showToast('Network error — status not saved.', true);
                // Roll back the cache and the select's badge colour too, not just its
                // value — leaving those out meant a dropped request kept ordersCache
                // and the visible badge on the new (unsaved) status while the <select>
                // itself reverted, so status filters/exports still showed the stale value.
                if (cached) cached.status = prev;
                selectEl.dataset.prev = prev;
                selectEl.value = prev;
                selectEl.className = `text-xs border border-gray-200 rounded-lg px-2 py-1 font-semibold ${statusColors[prev] || 'bg-gray-100 text-gray-600'} cursor-pointer`;
            });
        }

        function openShippingModal(orderId, prev, selectEl, statusColors) {
            // Build modal dynamically
            let modal = document.getElementById('shipping-modal');
            if (!modal) {
                modal = document.createElement('div');
                modal.id = 'shipping-modal';
                modal.className = 'fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4';
                document.body.appendChild(modal);
            }
            modal.innerHTML = `
            <div class="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
                <div class="flex items-center gap-3 mb-4">
                    <div class="w-10 h-10 rounded-xl bg-purple-50 flex items-center justify-center text-xl flex-shrink-0"></div>
                    <div>
                        <h3 class="text-sm font-bold text-gray-900">Mark as Shipped</h3>
                        <p class="text-xs text-gray-400 mt-0.5">Add delivery details — sent to customer via email</p>
                    </div>
                </div>
                <div class="space-y-3">
                    <div>
                        <label class="text-[10px] font-bold uppercase tracking-wider text-gray-400">Carrier / Rider name</label>
                        <input id="ship-carrier" type="text" placeholder="e.g. Yango, Bolt Food, Our rider" class="mt-1 w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400">
                    </div>
                    <div>
                        <label class="text-[10px] font-bold uppercase tracking-wider text-gray-400">Rider phone (optional)</label>
                        <input id="ship-phone" type="tel" placeholder="e.g. 0244 123 456" class="mt-1 w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400">
                    </div>
                    <div>
                        <label class="text-[10px] font-bold uppercase tracking-wider text-gray-400">Tracking link (optional)</label>
                        <input id="ship-link" type="url" placeholder="https://yango.com/..." class="mt-1 w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400">
                    </div>
                    <div>
                        <label class="text-[10px] font-bold uppercase tracking-wider text-gray-400">Note to customer (optional)</label>
                        <input id="ship-note" type="text" placeholder="e.g. Call rider on arrival" class="mt-1 w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400">
                    </div>
                </div>
                <p class="text-[11px] text-gray-400 mt-3">These details will be included in the shipping notification email sent to the customer.</p>
                <div class="flex gap-2 mt-4">
                    <button onclick="closeShippingModal()" class="flex-1 border border-gray-200 text-gray-600 text-sm font-semibold py-2.5 rounded-xl hover:bg-gray-50 transition">Cancel</button>
                    <button onclick="confirmShipped('${orderId}','${prev}')" id="ship-confirm-btn" class="flex-1 bg-purple-600 hover:bg-purple-700 text-white text-sm font-semibold py-2.5 rounded-xl transition">Confirm Shipped</button>
                </div>
            </div>`;
            modal.style.display = 'flex';
            setTimeout(() => document.getElementById('ship-carrier')?.focus(), 80);

            // Store context for confirm
            modal._orderId = orderId;
            modal._prev = prev;
            modal._selectEl = selectEl;
            modal._statusColors = statusColors;
        }

        function closeShippingModal() {
            const modal = document.getElementById('shipping-modal');
            if (modal) modal.style.display = 'none';
        }

        async function confirmShipped(orderId, prev) {
            const modal = document.getElementById('shipping-modal');
            const btn = document.getElementById('ship-confirm-btn');
            const carrier  = (document.getElementById('ship-carrier')?.value || '').trim();
            const phone    = (document.getElementById('ship-phone')?.value || '').trim();
            const link     = (document.getElementById('ship-link')?.value || '').trim();
            const note     = (document.getElementById('ship-note')?.value || '').trim();
            const selectEl = modal?._selectEl;
            const statusColors = modal?._statusColors || {};

            btn.disabled = true; btn.textContent = 'Saving…';
            try {
                const r = await fetch(`/api/orders/${orderId}/status`, {
                    method: 'PATCH',
                    headers: adminHeaders(),
                    body: JSON.stringify({
                        status: 'Shipped',
                        shippingCarrier: carrier,
                        shippingRiderPhone: phone,
                        shippingTrackingLink: link,
                        shippingNote: note
                    })
                });
                const data = await r.json();
                if (data.success) {
                    closeShippingModal();
                    const cached = ordersCache.find(o => o.id === orderId);
                    if (cached) {
                        cached.status = 'Shipped';
                        cached.shippingCarrier = carrier;
                        cached.shippingRiderPhone = phone;
                        cached.shippingTrackingLink = link;
                        cached.shippingNote = note;
                    }
                    if (selectEl) {
                        selectEl.value = 'Shipped';
                        selectEl.dataset.prev = 'Shipped';
                        selectEl.className = `text-xs border border-gray-200 rounded-lg px-2 py-1 font-semibold ${statusColors['Shipped'] || 'bg-purple-100 text-purple-700'} cursor-pointer`;
                    }
                    showToast('Order marked Shipped — customer notified by email.');
                    if (document.getElementById('od-body')) openOrderDetail(orderId);
                } else {
                    showToast(data.message || 'Failed to update status.', true);
                    btn.disabled = false; btn.textContent = 'Confirm Shipped';
                }
            } catch(e) {
                showToast('Network error — please try again.', true);
                btn.disabled = false; btn.textContent = 'Confirm Shipped';
            }
        }

        function deleteOrder(id) {
            requireAdminConfirm(
                'Delete Order',
                'This will email a full backup of this order to the store, then permanently delete it.',
                () => {
                    const btn = document.getElementById('del-btn-' + id);
                    if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }
                    fetch('/api/orders/' + id, { method: 'DELETE' })
                        .then(r => r.json())
                        .then(data => {
                            if (data.success) {
                                const row = document.getElementById('order-row-' + id);
                                if (row) row.remove();
                                loadOrders();
                            } else {
                                showToast('Delete failed: ' + (data.message || 'unknown error'), true);
                                if (btn) { btn.disabled = false; btn.textContent = 'Delete'; }
                            }
                        })
                        .catch(() => {
                            showToast('Network error — order was not deleted.', true);
                            if (btn) { btn.disabled = false; btn.textContent = 'Delete'; }
                        });
                }
            );
        }

        function toggleStockStatus(id, currentStatus) {
            fetch(`/api/products/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ isSoldOut: !currentStatus })
            })
            .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
            .then(d => { if (d.success === false) throw new Error(d.message || 'Save failed.'); loadInventory(); })
            .catch(e => showToast('Could not update stock status: ' + e.message, true));
        }

        function toggleListed(id, currentlyListed) {
            const nowListed = !currentlyListed;
            fetch(`/api/products/${id}/listed`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ isListed: nowListed })
            })
            .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
            .then(d => {
                if (d.success === false) throw new Error(d.message || 'Save failed.');
                loadInventory();
                showToast(nowListed ? 'Product published to storefront.' : 'Product unlisted from storefront.');
            })
            .catch(e => showToast('Could not update listing: ' + e.message, true));
        }

        function deleteProduct(id) {
            requireAdminConfirm(
                'Delete Product',
                'This will permanently remove the product and all its images.',
                () => {
                    fetch(`/api/products/${id}`, { method: 'DELETE' })
                        .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json().catch(() => ({success:true})); })
                        .then(d => {
                            if (d.success === false) throw new Error(d.message || 'Delete failed.');
                            loadInventory(); showToast('Product deleted.');
                        })
                        .catch(e => showToast('Could not delete product: ' + e.message, true));
                }
            );
        }

        function deleteBaseProduct(id) {
            requireAdminConfirm(
                'Delete Base Product',
                'This will permanently remove the product and its cost data.',
                () => {
                    fetch(`/api/products/${id}`, { method: 'DELETE' })
                        .then(() => { loadInventory(); loadStock(); showToast('Base product deleted.'); });
                }
            );
        }

        function startEditMode(product) {
            // Store updatedAt so we can detect if another admin edits while we're working
            if (product) window._editingProductUpdatedAt = product.updatedAt || 0;
            // Edit mode: hide step-1 selector, show form body with editable name
            document.getElementById('base-product-selector').classList.add('hidden');
            document.getElementById('product-form-body').classList.remove('hidden');
            document.getElementById('product-identity-new').classList.add('hidden');
            document.getElementById('product-identity-edit').classList.remove('hidden');

            document.getElementById('form-title').innerHTML = "Edit Product";
            document.getElementById('form-subtitle').textContent = '';
            document.getElementById('edit-id').value = product.id;
            // Keep hidden name in sync
            document.getElementById('form-name').value = product.name;
            document.getElementById('form-name-edit').value = product.name;
            document.getElementById('form-price').value = product.price;
            document.getElementById('form-original-price').value = product.originalPrice || '';
            document.getElementById('form-category').value = product.category || '';
            document.getElementById('form-desc').value = product.desc || '';
            document.getElementById('form-fit').value  = product.fitNotes  || '';
            document.getElementById('form-care').value = product.careNotes || '';
            setBundleRows(product.bundles);
            adminSelectedSizes = new Set(product.sizes || []);
            updateSizeSuggestions(adminSelectedSizes.size === 0);

            adminProductIsUnlisted = product.isListed === false;
            applyStockOnceVisibility();

            // Detect rich (object) vs simple (string) variants
            const isRich = Array.isArray(product.variants) && product.variants.length && typeof product.variants[0] === 'object';
            if (isRich) {
                setVariantMode(true);
                adminVariants = product.variants.map(v => ({
                    color: v.color || '', family: v.family || '', stock: v.stock || 0,
                    sizes: Array.isArray(v.sizes) ? [...v.sizes] : [],
                    existingImage: v.image || '', newFile: null, previewUrl: v.image || ''
                }));
                renderVariantRows();
            } else {
                setVariantMode(false);
                const variantsVal = (product.variants || []).join(', ');
                document.getElementById('form-variants').value = variantsVal;
                if (adminProductIsUnlisted) {
                    document.getElementById('form-soldout').value = (product.isSoldOut ?? false).toString();
                    document.getElementById('form-stock').value = product.stock !== null && product.stock !== undefined ? product.stock : '';
                }
                document.getElementById('image-preview-element').src = product.image;
                document.getElementById('image-preview-box').classList.remove('hidden');
                showExistingImages(product.images || [product.image]);
            }

            document.getElementById('submit-btn').innerText = "Save Changes";
            document.getElementById('cancel-edit-btn').classList.remove('hidden');
            updateDiscountPreview();
            // Open the drawer — form is always visible, no scrolling needed
            openProductDrawer();
            setTimeout(() => {
                const nameInput = document.getElementById('form-name-edit');
                if (nameInput) nameInput.focus();
            }, 320);

            document.getElementById('product-form').onsubmit = function(e) {
                e.preventDefault();
                const btn = document.getElementById('submit-btn');
                btn.disabled = true; btn.textContent = 'Saving…';
                const formData = new FormData(this);
                if (adminUseVariants && appendVariantsToFormData(formData) === false) {
                    btn.disabled = false; btn.textContent = 'Save Changes'; return;
                }
                fetch(`/api/products/${product.id}`, { method: 'PUT', body: formData, headers: adminHeaders(false) })
                    .then(async r => { 
                        if (r.status === 409) {
                            const d = await r.json();
                            btn.disabled = false; btn.textContent = 'Save Changes';
                            if (confirm('Conflict detected!\n\n' + (d.message || 'Another admin edited this product.') + '\n\nClick OK to reload the product and lose your changes, or Cancel to force-save anyway.')) {
                                startEditMode(getProductById(product.id));
                                loadInventory();
                            } else {
                                window._editingProductUpdatedAt = 0; // force save next time
                            }
                            return;
                        }
                        if (!r.ok) { const t = await r.text(); throw new Error(`Server ${r.status}: ${t.slice(0,120)}`); } return r.json(); })
                    .then(data => { if (!data.success) throw new Error(data.message || 'Update failed'); closeProductDrawer(); resetForm(); loadInventory(); showToast('Product updated!'); })
                    .catch(err => showToast(err.message || 'Update failed', true))
                    .finally(() => { btn.disabled = false; btn.textContent = 'Save Changes'; });
            };
        }

        // Keys here MUST match real category names in categories.json — syncCatDropdown()
        // below merges these keys into the category <select>, so a stale/leftover key
        // (e.g. from a previous project's category set) becomes a permanent phantom
        // option in the dropdown no matter what's actually in categories.json. If you
        // rename a category, rename it here too.
        const SIZE_PRESETS = {
            'Men':    ['XS','S','M','L','XL','XXL','XXXL'],
            'Women':  ['XS','S','M','L','XL','XXL','XXXL'],
            'Unisex': ['One Size']
        };
        let adminSelectedSizes = new Set();

        function updateSizeSuggestions(autoFill) {
            const cat = document.getElementById('form-category').value;
            const presets = SIZE_PRESETS[cat] || [];
            const section = document.getElementById('sizes-section');
            if (!presets.length) { section.classList.add('hidden'); adminSelectedSizes.clear(); return; }
            section.classList.remove('hidden');
            // auto-select all preset sizes when category is picked and none are chosen yet
            if (autoFill && adminSelectedSizes.size === 0) {
                presets.forEach(s => adminSelectedSizes.add(s));
            }
            document.getElementById('size-suggestions').innerHTML = presets.map(s =>
                '<button type="button" onclick="toggleAdminSize(\'' + s + '\')" class="size-pick' + (adminSelectedSizes.has(s) ? ' on' : '') + '">' + s + '</button>'
            ).join('');
            document.getElementById('form-sizes').value = [...adminSelectedSizes].join(',');
        }

        function toggleAdminSize(s) {
            if (adminSelectedSizes.has(s)) adminSelectedSizes.delete(s);
            else adminSelectedSizes.add(s);
            updateSizeSuggestions();
        }

        function previewExtraImg(input, slotId) {
            if (!input.files || !input.files[0]) return;
            const reader = new FileReader();
            reader.onload = e => {
                document.getElementById(slotId + '-img').src = e.target.result;
                document.getElementById(slotId + '-img').classList.remove('hidden');
                document.getElementById(slotId + '-ph').classList.add('hidden');
                document.getElementById(slotId + '-x').classList.remove('hidden');
            };
            reader.readAsDataURL(input.files[0]);
        }

        function clearExtraImg(slotId) {
            const slot = document.getElementById(slotId);
            const input = slot.querySelector('input[type=file]');
            input.value = '';
            document.getElementById(slotId + '-img').classList.add('hidden');
            document.getElementById(slotId + '-ph').classList.remove('hidden');
            document.getElementById(slotId + '-x').classList.add('hidden');
        }

        function clearAllExtraImgs() {
            ['slot2','slot3','slot4'].forEach(clearExtraImg);
        }

        // ── VARIANT MODE ─────────────────────────────────────────────────────
        let adminUseVariants = false;
        const COLOUR_FAMILIES = ['Red','Orange','Yellow','Green','Blue','Purple','Pink','Brown','Black','White','Grey','Nude/Beige','Multi','Other'];
        let adminVariants = []; // [{color, family, stock, existingImage, newFile, previewUrl}]
        let adminProductIsUnlisted = false; // true only while editing an unlisted product

        function applyStockOnceVisibility() {
            const fields = document.getElementById('stock-once-fields');
            const hint   = document.getElementById('stock-locked-hint');
            if (fields) fields.classList.toggle('hidden', !adminProductIsUnlisted);
            if (hint)   hint.classList.toggle('hidden',   adminProductIsUnlisted);
        }

        function setVariantMode(useVariants) {
            adminUseVariants = useVariants;
            document.getElementById('simple-mode-fields')?.classList.toggle('hidden', useVariants);
            document.getElementById('variant-mode-fields')?.classList.toggle('hidden', !useVariants);
            const sb = document.getElementById('mode-simple-btn');
            const vb = document.getElementById('mode-variant-btn');
            if (sb) {
                sb.className = 'flex-1 text-xs font-semibold py-2 px-3 rounded-xl border-2 transition '
                    + (!useVariants ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-200 text-gray-600 hover:border-orange-300');
            }
            if (vb) {
                vb.className = 'flex-1 text-xs font-semibold py-2 px-3 rounded-xl border-2 transition '
                    + (useVariants ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-200 text-gray-600 hover:border-orange-300');
            }
        }

        function addVariantRow() {
            adminVariants.push({ color: '', family: '', stock: 1, sizes: [], existingImage: '', newFile: null, previewUrl: '' });
            renderVariantRows();
        }

        function removeVariantRow(i) {
            adminVariants.splice(i, 1);
            renderVariantRows();
        }

        function toggleVariantSize(i, s) {
            const v = adminVariants[i];
            if (!v) return;
            const idx = v.sizes.indexOf(s);
            if (idx >= 0) v.sizes.splice(idx, 1);
            else v.sizes.push(s);
            renderVariantRows();
        }

        function setVariantImage(i, input) {
            const file = input.files[0];
            if (!file) return;
            adminVariants[i].newFile = file;
            const reader = new FileReader();
            reader.onload = e => { adminVariants[i].previewUrl = e.target.result; renderVariantRows(); };
            reader.readAsDataURL(file);
        }

        function renderVariantRows() {
            const container = document.getElementById('variants-builder');
            if (!container) return;
            if (!adminVariants.length) {
                container.innerHTML = '<p class="text-[11px] text-gray-400 text-center py-4 border border-dashed border-gray-200 rounded-xl">No colours added yet. Click "+ Add Colour" to begin.</p>';
                return;
            }
            container.innerHTML = adminVariants.map((v, i) => {
                const imgSrc = v.previewUrl || v.existingImage;
                const imgEl = imgSrc
                    ? `<img src="${escAdm(imgSrc)}" class="h-16 w-full object-cover rounded-lg">`
                    : `<div class="h-16 flex items-center justify-center border-2 border-dashed border-gray-200 rounded-lg text-xs text-gray-400 hover:border-orange-300 hover:text-orange-400 transition">Upload</div>`;
                return `<div class="grid gap-2 items-start border border-gray-200 rounded-xl p-3 bg-gray-50" style="grid-template-columns:1fr auto">
                    <div class="space-y-2">
                        <div class="flex items-center gap-2">
                            <span id="variant-dot-${i}" style="width:22px;height:22px;border-radius:50%;background:${colorGradient(v.color)};flex-shrink:0;border:1px solid rgba(0,0,0,0.12);transition:background .15s"></span>
                            <input type="text" value="${escAdm(v.color)}" placeholder="Colour name (e.g. Brown and White)"
                                oninput="adminVariants[${i}].color=this.value;updateVariantDot(${i},this.value)"
                                class="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-amber-500/20">
                            <select onchange="adminVariants[${i}].family=this.value"
                                class="px-2 py-2 border border-gray-200 rounded-lg text-xs bg-white focus:outline-none focus:ring-2 focus:ring-amber-500/20 text-gray-500" style="min-width:100px"
                                title="Base colour family">
                                <option value="">Base colour…</option>
                                ${COLOUR_FAMILIES.map(f => `<option value="${f}" ${v.family===f?'selected':''}>${f}</option>`).join('')}
                            </select>
                        </div>
                        <div class="mt-1 space-y-2">
                            <label class="cursor-pointer block">
                                ${imgEl}
                                <input type="file" accept="image/*" class="hidden" onchange="setVariantImage(${i},this)">
                            </label>
                            ${(adminProductIsUnlisted || !v.existingImage) ? `<div class="flex items-center gap-2">
                                <label class="text-[10px] font-bold text-gray-400 uppercase tracking-wider flex-shrink-0">Qty in stock</label>
                                <input type="number" min="0" value="${v.stock || 0}" placeholder="0"
                                    oninput="adminVariants[${i}].stock=parseInt(this.value)||0"
                                    class="w-24 px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-amber-500/20">
                            </div>` : ''}
                        ${(() => {
                            const cat = document.getElementById('form-category')?.value || '';
                            const presets = SIZE_PRESETS[cat] || [];
                            const selected = v.sizes || [];
                            if (!presets.length && !selected.length) return '';
                            const chips = selected.map(s =>
                                `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-gray-900 text-white text-[11px] font-semibold">${escAdm(s)}<button type="button" onclick="toggleVariantSize(${i},'${escAdmJsAttr(s)}')" class="ml-0.5 text-gray-300 hover:text-white leading-none">×</button></span>`
                            ).join('');
                            const presetBtns = presets.map(s =>
                                `<button type="button" onclick="toggleVariantSize(${i},'${escAdmJsAttr(s)}')" class="text-[11px] px-2 py-0.5 rounded-full border transition ${selected.includes(s) ? 'bg-gray-900 text-white border-gray-900' : 'border-gray-200 text-gray-500 hover:border-orange-400 hover:text-orange-600'}">${s}</button>`
                            ).join('');
                            return `<div class="space-y-1.5">
                                <label class="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Sizes for this colour</label>
                                <div class="flex flex-wrap gap-1">${presetBtns}</div>
                                ${chips ? `<div class="flex flex-wrap gap-1 mt-1">${chips}</div>` : ''}
                                <div class="flex gap-1 mt-1">
                                    <input type="text" id="vs-custom-${i}" placeholder="Custom size…" class="flex-1 px-2 py-1 text-[11px] border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-amber-400">
                                    <button type="button" onclick="(function(){var el=document.getElementById('vs-custom-${i}');var s=el.value.trim();if(s){toggleVariantSize(${i},s);el.value='';}})();" class="text-[11px] px-2 py-1 rounded-lg bg-gray-100 hover:bg-orange-50 hover:text-orange-600 border border-gray-200 font-semibold transition">+</button>
                                </div>
                            </div>`;
                        })()}
                        </div>
                    </div>
                    <button type="button" onclick="removeVariantRow(${i})" class="text-red-400 hover:text-red-600 font-bold text-sm pt-1 flex-shrink-0">✕</button>
                </div>`;
            }).join('');
        }

        function appendVariantsToFormData(fd) {
            const meta = adminVariants.map(v => ({
                color: v.color.trim(),
                family: v.family || '',
                stock: parseInt(v.stock) || 0,
                sizes: Array.isArray(v.sizes) ? v.sizes.filter(Boolean) : [],
                existingImage: v.existingImage || ''
            }));
            // Block duplicate colour names (case-insensitive)
            const names = meta.map(v => v.color.toLowerCase()).filter(Boolean);
            const dupe = names.find((n, i) => names.indexOf(n) !== i);
            if (dupe) {
                showToast(`Duplicate colour name "${dupe}" — each variant must have a unique name.`, true);
                return false;
            }
            fd.set('variantsJson', JSON.stringify(meta));
            adminVariants.forEach((v, i) => { if (v.newFile) fd.append('variantImage_' + i, v.newFile); });
            fd.delete('variants');
            fd.delete('stock');
            fd.delete('isSoldOut');
            return true;
        }

        function showExistingImages(images) {
            ['slot2','slot3','slot4'].forEach(clearExtraImg);
            (images || []).slice(1, 4).forEach((src, i) => {
                const slotId = 'slot' + (i + 2);
                document.getElementById(slotId + '-img').src = src;
                document.getElementById(slotId + '-img').classList.remove('hidden');
                document.getElementById(slotId + '-ph').classList.add('hidden');
            });
        }

        // ── PRODUCT DRAWER OPEN / CLOSE ──────────────────────────────────────
        function openProductDrawer() {
            const drawer = document.getElementById('inv-form-panel');
            const backdrop = document.getElementById('product-drawer-backdrop');
            if (drawer)   { drawer.style.transform = 'translateX(0)'; }
            if (backdrop) { backdrop.style.display = 'block'; requestAnimationFrame(() => backdrop.style.opacity = '1'); }
            document.body.style.overflow = 'hidden';
        }

        function closeProductDrawer() {
            const drawer = document.getElementById('inv-form-panel');
            const backdrop = document.getElementById('product-drawer-backdrop');
            if (drawer)   { drawer.style.transform = 'translateX(100%)'; }
            if (backdrop) { backdrop.style.opacity = '0'; setTimeout(() => backdrop.style.display = 'none', 280); }
            document.body.style.overflow = '';
        }

        function cancelEdit() { closeProductDrawer(); resetForm(); }

        document.addEventListener('keydown', function(e) {
            if (e.key === 'Escape') {
                const drawer = document.getElementById('inv-form-panel');
                if (drawer && drawer.style.transform === 'translateX(0px)') cancelEdit();
            }
        });

        function resetForm() {
            document.getElementById('product-form').reset();
            setBundleRows([]);
            document.getElementById('form-name').value = '';
            removeSelectedImagePreview();
            clearAllExtraImgs();
            document.getElementById('form-title').innerText = "New Product";
            document.getElementById('form-subtitle').textContent = "Register cost data first, then give it life here.";
            document.getElementById('submit-btn').innerText = "Publish Product";
            document.getElementById('cancel-edit-btn').classList.add('hidden');
            document.getElementById('product-form').onsubmit = null;
            document.getElementById('discount-preview').classList.add('hidden');
            document.getElementById('discount-hint').classList.remove('hidden');
            adminSelectedSizes = new Set();
            document.getElementById('sizes-section').classList.add('hidden');
            document.getElementById('form-sizes').value = '';
            // Reset variant mode
            adminVariants = [];
            adminProductIsUnlisted = false;
            applyStockOnceVisibility();
            setVariantMode(false);
            const vb = document.getElementById('variants-builder');
            if (vb) vb.innerHTML = '';
            // Return to step-1 state
            document.getElementById('base-product-selector').classList.remove('hidden');
            document.getElementById('product-form-body').classList.add('hidden');
            document.getElementById('product-identity-new').classList.add('hidden');
            document.getElementById('product-identity-edit').classList.add('hidden');
            const bpSel = document.getElementById('base-product-select');
            if (bpSel) bpSel.value = '';
        }

        function populateBaseProductDropdown() {
            const sel = document.getElementById('base-product-select');
            if (!sel) return;
            const costed = stockCache.filter(p => {
                const mc = invMetaCache[p.id];
                return mc && calcInvCost(mc) > 0 && p.isSoldOut;
            });
            const emptyState = document.getElementById('base-product-empty');
            if (costed.length === 0) {
                sel.classList.add('hidden');
                if (emptyState) emptyState.classList.remove('hidden');
            } else {
                sel.classList.remove('hidden');
                if (emptyState) emptyState.classList.add('hidden');
                const prev = sel.value;
                sel.innerHTML = '<option value="">— Choose a product to continue —</option>' +
                    costed.map(p => {
                        const mc = invMetaCache[p.id];
                        const retail = calcInvRetail(mc);
                        return `<option value="${escAdm(p.id)}">${escAdm(p.name)} — Est. ${fmtGH(retail)}</option>`;
                    }).join('');
                if (prev) sel.value = prev;
            }
        }

        function selectBaseProduct(pid) {
            if (!pid) {
                // Collapse back to step 1
                document.getElementById('product-form-body').classList.add('hidden');
                document.getElementById('product-identity-new').classList.add('hidden');
                document.getElementById('form-name').value = '';
                return;
            }
            const p  = stockCache.find(x => x.id === pid);
            if (!p) return;
            const mc     = invMetaCache[pid] || {};
            const cost   = calcInvCost(mc);
            const retail = calcInvRetail(mc);

            // Set hidden name field (submitted with form)
            document.getElementById('form-name').value = p.name;
            // Show product badge
            const nameDisplay = document.getElementById('selected-product-name');
            const costDisplay = document.getElementById('selected-product-cost-val');
            if (nameDisplay) nameDisplay.textContent = p.name;
            if (costDisplay) costDisplay.textContent = fmtGH(cost);
            // Pre-fill fields
            const catEl = document.getElementById('form-category');
            if (catEl) catEl.value = p.category || '';
            document.getElementById('form-price').value = retail.toFixed(2);
            document.getElementById('form-original-price').value = '';
            adminProductIsUnlisted = true;
            applyStockOnceVisibility();
            document.getElementById('form-soldout').value = 'false';
            const stockEl = document.getElementById('form-stock');
            if (stockEl) stockEl.value = '';
            updateDiscountPreview();
            // Reveal form body
            document.getElementById('product-identity-new').classList.remove('hidden');
            document.getElementById('product-identity-edit').classList.add('hidden');
            document.getElementById('product-form-body').classList.remove('hidden');
            // Set form to PUT (update the existing product)
            document.getElementById('product-form').onsubmit = function(e) {
                e.preventDefault();
                publishBaseProduct(pid);
            };
        }

        async function publishBaseProduct(pid) {
            if (adminUseVariants && !adminVariants.length) {
                showToast('Add at least one colour variant before publishing.', true); return;
            }
            const btn = document.getElementById('submit-btn');
            btn.disabled = true; btn.textContent = 'Publishing…';
            try {
                const formData = new FormData(document.getElementById('product-form'));
                if (adminUseVariants && appendVariantsToFormData(formData) === false) {
                    btn.disabled = false; btn.textContent = 'Publish'; return;
                }
                const res = await fetch('/api/products/' + pid, { method: 'PUT', body: formData, headers: adminHeaders(false) });
                if (!res.ok) {
                    const txt = await res.text();
                    throw new Error(`Server error ${res.status}: ${txt.slice(0, 120)}`);
                }
                const data = await res.json();
                if (!data.success) throw new Error(data.message || 'Publish failed');
                closeProductDrawer();
                resetForm();
                loadInventory();
                showToast('Product published! ✦ Now visible in your catalogue.');
            } catch(e) { showToast(e.message || 'Publish failed', true); }
            finally { btn.disabled = false; btn.textContent = 'Publish Product'; }
        }

        // ── BUNDLE OFFER EDITOR ────────────────────────────────────────────
        const BUNDLE_TAG_OPTIONS = ['', 'Recommended', 'Popular choice', 'Best value'];
        function addBundleRow(b) {
            b = b || {};
            const rows = document.getElementById('bundle-rows');
            if (!rows || rows.children.length >= 6) return;
            const row = document.createElement('div');
            row.className = 'bundle-row border border-gray-200 rounded-xl p-2.5 bg-gray-50';
            row.innerHTML =
                '<div class="grid grid-cols-[70px_1fr_1fr_28px] gap-2 items-center">'
                + '<input type="number" min="2" max="100" step="1" placeholder="Pcs" class="b-qty w-full px-2 py-2 border border-gray-200 rounded-lg text-sm bg-white" value="' + escAdm(b.qty || '') + '">'
                + '<input type="number" min="0" step="0.01" placeholder="Total GH₵" class="b-price w-full px-2 py-2 border border-gray-200 rounded-lg text-sm bg-white" value="' + escAdm(b.price || '') + '">'
                + '<select class="b-tag w-full px-2 py-2 border border-gray-200 rounded-lg text-sm bg-white">'
                + BUNDLE_TAG_OPTIONS.map(t => '<option value="' + escAdm(t) + '"' + (t === (b.tag || '') ? ' selected' : '') + '>' + (t ? escAdm(t) : 'No tag') + '</option>').join('')
                + '</select>'
                + '<button type="button" class="b-del text-gray-400 hover:text-red-600 text-lg leading-none" aria-label="Remove bundle offer">&times;</button>'
                + '</div><p class="b-hint text-[11px] text-gray-500 mt-1.5"></p>';
            row.addEventListener('input', () => { syncBundlesJson(); updateBundleHints(); });
            row.querySelector('.b-del').addEventListener('click', () => { row.remove(); syncBundlesJson(); });
            rows.appendChild(row);
            syncBundlesJson(); updateBundleHints();
        }
        function readBundleRows() {
            return Array.from(document.querySelectorAll('#bundle-rows .bundle-row')).map(r => ({
                qty: parseInt(r.querySelector('.b-qty').value, 10),
                price: parseFloat(r.querySelector('.b-price').value),
                tag: r.querySelector('.b-tag').value
            })).filter(b => b.qty >= 2 && b.price > 0);
        }
        function syncBundlesJson() {
            const el = document.getElementById('form-bundles');
            if (el) el.value = JSON.stringify(readBundleRows());
        }
        function updateBundleHints() {
            const unit = parseFloat(document.getElementById('form-price').value) || 0;
            document.querySelectorAll('#bundle-rows .bundle-row').forEach(r => {
                const q = parseInt(r.querySelector('.b-qty').value, 10), p = parseFloat(r.querySelector('.b-price').value);
                const hint = r.querySelector('.b-hint');
                if (!(q >= 2) || !(p > 0)) { hint.textContent = ''; hint.className = 'b-hint text-[11px] text-gray-500 mt-1.5'; return; }
                if (unit > 0 && p >= q * unit) {
                    hint.textContent = 'Not a saving — must be less than ' + q + ' × GH₵' + unit.toFixed(2) + ' = GH₵' + (q * unit).toFixed(2) + '. It will be ignored on the store.';
                    hint.className = 'b-hint text-[11px] text-red-600 mt-1.5';
                } else {
                    hint.textContent = 'About GH₵' + (p / q).toFixed(2) + ' per piece' + (unit > 0 ? ' · customer saves GH₵' + (q * unit - p).toFixed(2) : '');
                    hint.className = 'b-hint text-[11px] text-gray-500 mt-1.5';
                }
            });
        }
        function setBundleRows(list) {
            const rows = document.getElementById('bundle-rows');
            if (rows) rows.innerHTML = '';
            (list || []).forEach(addBundleRow);
            syncBundlesJson();
        }

        function updateDiscountPreview() {
            updateBundleHints();
            const price = parseFloat(document.getElementById('form-price').value);
            const orig  = parseFloat(document.getElementById('form-original-price').value);
            const box   = document.getElementById('discount-preview');
            const hint  = document.getElementById('discount-hint');
            if (orig && price && orig > price) {
                const pct = Math.round((1 - price / orig) * 100);
                document.getElementById('discount-preview-text').textContent = `${pct}% OFF — was GHS ${orig}, now GHS ${price}`;
                box.classList.remove('hidden');
                hint.classList.add('hidden');
            } else {
                box.classList.add('hidden');
                hint.classList.remove('hidden');
            }
        }

        let reviewsCache = [];

        function loadReviews() {
            fetch('/api/admin/reviews')
                .then(res => res.json())
                .then(reviews => {
                    reviewsCache = reviews;
                    const approvedCount = reviews.filter(r => r.approved !== false).length;
                    const pendingCount  = reviews.filter(r => r.approved === false).length;
                    document.getElementById('stat-reviews').innerText = approvedCount;
                    const badge = document.getElementById('reviews-pending-badge');
                    if (badge) {
                        if (pendingCount > 0) { badge.textContent = pendingCount + ' pending'; badge.classList.remove('hidden'); }
                        else badge.classList.add('hidden');
                    }
                    const month = document.getElementById('reviews-month')?.value || '';
                    renderReviews(month);
                });
        }

        function approveReview(id, approved) {
            fetch('/api/reviews/' + id + '/approve', {
                method: 'PATCH', headers: adminHeaders(),
                body: JSON.stringify({ approved })
            }).then(r => r.json()).then(d => {
                if (d.success) { showToast(approved ? 'Review approved!' : 'Review hidden.'); loadReviews(); }
                else showToast(d.message || 'Failed.', true);
            });
        }

        function renderReviews(month) {
            const grid = document.getElementById('reviews-admin-grid');
            const filtered = reviewsCache.filter(r => inMonth(r.createdAt, month))
                                         .slice().sort((a, b) => b.createdAt - a.createdAt);
            if (!reviewsCache.length) {
                grid.innerHTML = `<div class="col-span-3 text-center py-10 text-gray-400 text-xs">No reviews yet.</div>`;
                return;
            }
            if (!filtered.length) {
                const label = month ? new Date(month + '-01').toLocaleString('en-GH', {month:'long',year:'numeric'}) : '';
                grid.innerHTML = `<div class="col-span-3 text-center py-10 text-gray-400 text-xs">No reviews${label ? ' for ' + label : ''}.</div>`;
                return;
            }
            grid.innerHTML = filtered.map(r => {
                const stars    = '★'.repeat(r.rating) + '☆'.repeat(5 - r.rating);
                const initials = r.name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
                const date     = new Date(r.createdAt).toLocaleDateString('en-GH', { dateStyle: 'medium' });
                const isFeat   = !!r.featured;
                return `
                <div class="bg-gray-50 border ${isFeat ? 'border-amber-200' : 'border-gray-100'} rounded-2xl p-4 flex flex-col gap-3">
                    <div class="flex items-start justify-between gap-2">
                        <div class="flex items-center gap-2">
                            <div class="w-9 h-9 rounded-full bg-amber-500 text-white text-xs font-bold flex items-center justify-center flex-shrink-0">${escAdm(initials)}</div>
                            <div>
                                <p class="text-sm font-semibold text-gray-900 leading-tight">${escAdm(r.name)}</p>
                                ${r.location ? `<p class="text-[11px] text-gray-400">${escAdm(r.location)}</p>` : ''}
                            </div>
                        </div>
                        <div class="flex items-center gap-1 flex-shrink-0">
                            <button onclick="toggleReviewFeatured('${r.id}', ${isFeat})" title="${isFeat ? 'Remove from homepage' : 'Feature on homepage'}"
                                class="text-lg transition ${isFeat ? 'text-amber-400' : 'text-gray-200 hover:text-amber-300'}">★</button>
                            <button onclick="deleteReview('${r.id}')" title="Delete review"
                                class="text-rose-400 hover:text-rose-600 text-xs font-bold transition mt-0.5">✕</button>
                        </div>
                    </div>
                    ${r.approved === false ? '<div class="text-[10px] font-bold text-orange-600 bg-orange-50 px-2 py-1 rounded-lg border border-orange-100">Pending approval</div>' : ''}
                    <p class="text-amber-400 text-sm tracking-wide leading-none">${stars}</p>
                    <p class="text-sm text-gray-600 italic leading-relaxed flex-1">"${escAdm(r.message)}"</p>
                    <div class="flex items-center justify-between flex-wrap gap-1">
                        <p class="text-[10px] text-gray-400">${date}</p>
                        ${isFeat ? '<span class="text-[10px] font-bold text-amber-500 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-100">★ Featured</span>' : ''}
                    </div>
                    ${r.approved === false ? `<div class="flex gap-2"><button onclick="approveReview('${r.id}',true)" class="flex-1 text-xs font-bold py-1.5 bg-green-500 hover:bg-green-600 text-white rounded-lg transition">✓ Approve</button><button onclick="approveReview('${r.id}',false)" class="flex-1 text-xs font-bold py-1.5 bg-gray-200 hover:bg-gray-300 text-gray-600 rounded-lg transition">Hide</button></div>` : '<button onclick="approveReview(\''+r.id+'\',false)" class="text-[10px] text-gray-300 hover:text-red-400 transition self-start">Hide from storefront</button>'}
                </div>`;
            }).join('');
        }

        function deleteReview(id) {
            requireAdminConfirm(
                'Delete Review',
                'This review will be permanently removed. This cannot be undone.',
                () => {
                    fetch(`/api/reviews/${id}`, { method: 'DELETE' })
                        .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json().catch(() => ({success:true})); })
                        .then(d => {
                            if (d.success === false) throw new Error(d.message || 'Delete failed.');
                            loadReviews(); showToast('Review deleted.');
                        })
                        .catch(e => showToast('Could not delete review: ' + e.message, true));
                }
            );
        }

        function showToast(msg, isError = false) {
            const toast = document.createElement('div');
            toast.className = 'fixed bottom-6 right-6 text-white text-sm font-semibold px-5 py-3 rounded-2xl shadow-xl z-50 transition';
            toast.style.background = isError ? '#dc2626' : '#C9971C';
            toast.textContent = msg;
            document.body.appendChild(toast);
            setTimeout(() => toast.remove(), 3500);
        }

        function downloadOrdersCSV() {
            if (!ordersCache.length) { showToast('No orders to download yet.'); return; }
            const sorted = ordersCache.slice().sort((a, b) => new Date(b.paidAt) - new Date(a.paidAt));
            // Prefix values that start with =, +, -, @ with a single quote so spreadsheet apps
            // (Excel/Sheets) treat them as plain text instead of executing them as formulas.
            const esc = v => {
                let s = String(v ?? '');
                if (/^[=+\-@]/.test(s)) s = "'" + s;
                return '"' + s.replace(/"/g, '""') + '"';
            };
            const headers = ['Order ID', 'Reference', 'Date', 'Customer Name', 'Phone', 'Email', 'Address', 'Notes', 'Items', 'Subtotal (GHS)', 'Delivery Zone', 'Delivery Fee (GHS)', 'Promo Code', 'Promo Discount (GHS)', 'Total (GHS)', 'Status'];
            const rows = sorted.map(o => {
                const date = new Date(o.paidAt).toLocaleString('en-GH', { dateStyle: 'medium', timeStyle: 'short' });
                const items = (o.items || []).map(i =>
                    `${i.name}${i.size ? ' ['+i.size+']' : ''}${i.color ? ' — '+i.color : ''} x${i.quantity}`
                ).join(' | ');
                return [
                    esc(o.id),
                    esc(o.reference),
                    esc(date),
                    esc(o.customer?.name),
                    esc(o.customer?.phone),
                    esc(o.customer?.email),
                    esc(o.customer?.address),
                    esc(o.customer?.notes),
                    esc(items),
                    esc(parseFloat(o.subtotal || o.total || 0).toFixed(2)),
                    esc(o.deliveryZone || ''),
                    esc(parseFloat(o.deliveryPrice || 0).toFixed(2)),
                    esc(o.promoCode || ''),
                    esc(parseFloat(o.promoDiscount || 0).toFixed(2)),
                    esc(parseFloat(o.total).toFixed(2)),
                    esc(o.status || 'pending')
                ].join(',');
            });
            const csv = [headers.map(h => '"' + h + '"').join(','), ...rows].join('\r\n');
            const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
            const url  = URL.createObjectURL(blob);
            const a    = document.createElement('a');
            a.href     = url;
            a.download = 'freeman-orders-' + new Date().toISOString().slice(0,10) + '.csv';
            a.click();
            URL.revokeObjectURL(url);
        }

        var notifyCache = [];

        function loadNotify() {
            const tbody = document.getElementById('notify-table-body');
            tbody.innerHTML = '<tr><td colspan="6" class="text-center py-6 text-gray-400 text-xs">Loading…</td></tr>';
            fetch('/api/notify')
                .then(r => {
                    if (!r.ok) throw new Error('Server returned ' + r.status + ' — try refreshing the page');
                    return r.json();
                })
                .then(data => {
                    notifyCache = data;
                    const month = document.getElementById('notify-month')?.value || '';
                    renderNotify(month);
                })
                .catch(err => {
                    document.getElementById('notify-table-body').innerHTML =
                        '<tr><td colspan="6" class="text-center py-6 text-red-400 text-xs font-semibold">' + err.message + '</td></tr>';
                });
        }

        function renderNotify(month) {
            const tbody = document.getElementById('notify-table-body');
            const filtered = notifyCache.filter(n => inMonth(n.createdAt, month))
                                        .slice().sort((a, b) => b.createdAt - a.createdAt);
            if (!notifyCache.length) {
                tbody.innerHTML = '<tr><td colspan="5" class="text-center py-8 text-gray-400 text-xs">No notify requests yet.</td></tr>';
                return;
            }
            if (!filtered.length) {
                const label = month ? new Date(month + '-01').toLocaleString('en-GH', {month:'long',year:'numeric'}) : '';
                tbody.innerHTML = `<tr><td colspan="5" class="text-center py-8 text-gray-400 text-xs">No requests${label ? ' for ' + label : ''}.</td></tr>`;
                return;
            }
            tbody.innerHTML = filtered.map(n => {
                const date = new Date(n.createdAt).toLocaleString('en-GH', { dateStyle: 'medium', timeStyle: 'short' });
                const sent = !!n.notifiedAt;
                return `
                <tr class="data-row hover:bg-gray-50/50 transition" id="notify-row-${n.id}">
                    <td class="py-3 px-4 text-xs font-semibold text-gray-900">${escAdm(n.name || '—')}</td>
                    <td class="py-3 px-4 text-xs text-gray-600">${escAdm(n.phone || '—')}</td>
                    <td class="py-3 px-4 text-xs text-gray-700 font-medium">${escAdm(n.productName || n.productId)}</td>
                    <td class="py-3 px-4 text-xs text-gray-400 whitespace-nowrap">${date}</td>
                    <td class="py-3 px-4">
                        <div class="flex gap-1">
                            <button id="nbtn-${n.id}" onclick="sendNotify('${n.id}',this)" class="text-xs px-2 py-1 rounded-lg ${sent ? 'bg-green-50 text-green-600 border-green-100' : 'bg-violet-50 text-violet-600 hover:bg-violet-100 border-violet-100'} border transition font-semibold whitespace-nowrap">${sent ? 'Notified' : 'Notify'}</button>
                            <button onclick="deleteNotify('${n.id}')" class="text-xs px-2 py-1 rounded-lg bg-red-50 text-red-400 hover:bg-red-100 border border-red-100 transition font-semibold">✕</button>
                        </div>
                    </td>
                </tr>`;
            }).join('');
        }

        // WhatsApp has no server-side send API here — this opens a pre-filled
        // wa.me chat (recipient + message already composed from the customer's
        // phone and the product) so the admin just hits send in WhatsApp
        // themselves. The server marks the entry "notified" once this succeeds.
        function sendNotify(id, btn) {
            btn.disabled = true;
            btn.textContent = 'Opening…';
            fetch('/api/notify/' + encodeURIComponent(id) + '/send', { method: 'POST' })
                .then(r => r.json())
                .then(d => {
                    if (d.success) {
                        // window.open() here happens inside an async .then callback, not
                        // synchronously inside the click handler — Chrome/Firefox/Safari
                        // can (and often do) treat that as a non-user-initiated popup and
                        // silently block it, returning null. The server has already set
                        // notifiedAt at this point regardless, so the old code showed
                        // "Notified" even when no chat ever opened and no message was
                        // ever sent. Now: on a blocked popup, swap the button for a real
                        // link instead — clicking THAT is a genuine user gesture, so it
                        // always opens.
                        const win = window.open(d.waUrl, '_blank');
                        if (win) {
                            btn.textContent = 'Notified';
                            btn.className = btn.className.replace('bg-violet-50 text-violet-600 hover:bg-violet-100 border-violet-100', 'bg-green-50 text-green-600 border-green-100');
                        } else {
                            const link = document.createElement('a');
                            link.href = d.waUrl; link.target = '_blank'; link.rel = 'noopener';
                            link.className = btn.className.replace('bg-violet-50 text-violet-600 hover:bg-violet-100 border-violet-100', 'bg-green-50 text-green-600 border-green-100');
                            link.textContent = 'Notified — open chat';
                            btn.replaceWith(link);
                            showToast('Popup was blocked — click the link to open the WhatsApp chat.', true);
                        }
                    } else {
                        showToast('Could not open WhatsApp: ' + (d.message || 'unknown error'), true);
                        btn.disabled = false;
                        btn.textContent = 'Notify';
                    }
                })
                .catch(() => {
                    showToast('Network error.', true);
                    btn.disabled = false;
                    btn.textContent = 'Notify';
                });
        }

        function deleteNotify(id) {
            requireAdminConfirm(
                'Remove Notify Entry',
                'This customer will be removed from the restock notification list.',
                () => {
                    fetch('/api/notify/' + encodeURIComponent(id), { method: 'DELETE' })
                        .then(r => r.json())
                        .then(d => { if (d.success) { loadNotify(); showToast('Entry removed.'); } else showToast('Could not remove entry.', true); })
                        .catch(() => showToast('Network error.', true));
                }
            );
        }

        function downloadNotifyCSV() {
            if (!notifyCache.length) { showToast('No entries to download yet.'); return; }
            // Prefix values that start with =, +, -, @ with a single quote so spreadsheet apps
            // (Excel/Sheets) treat them as plain text instead of executing them as formulas.
            const esc = v => {
                let s = String(v ?? '');
                if (/^[=+\-@]/.test(s)) s = "'" + s;
                return '"' + s.replace(/"/g, '""') + '"';
            };
            const headers = ['Name', 'Phone', 'Product', 'Date', 'Notified'];
            const rows = notifyCache.slice().sort((a, b) => b.createdAt - a.createdAt).map(n => {
                const date = new Date(n.createdAt).toLocaleString('en-GH', { dateStyle: 'medium', timeStyle: 'short' });
                return [esc(n.name), esc(n.phone), esc(n.productName || n.productId), esc(date), esc(n.notifiedAt ? 'Yes' : 'No')].join(',');
            });
            const csv = [headers.map(h => '"' + h + '"').join(','), ...rows].join('\r\n');
            const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
            const url  = URL.createObjectURL(blob);
            const a    = document.createElement('a');
            a.href     = url;
            a.download = 'freeman-notify-list-' + new Date().toISOString().slice(0,10) + '.csv';
            a.click();
            URL.revokeObjectURL(url);
        }

        function loadCodes() {
            fetch('/api/codes')
                .then(res => res.json())
                .then(codes => {
                    const list = document.getElementById('codes-list');
                    if (!codes.length) {
                        list.innerHTML = '<p class="text-xs text-gray-400 text-center py-4">No promo codes yet. Create one above.</p>';
                        return;
                    }
                    list.innerHTML = codes.map(c => `
                        <div class="flex items-center justify-between bg-gray-50 border border-gray-100 rounded-xl px-4 py-3">
                            <div class="flex items-center gap-4 flex-wrap">
                                <span class="font-mono font-bold text-sm text-gray-900 tracking-widest">${escAdm(c.code)}</span>
                                <span class="text-xs text-gray-500 bg-white border border-gray-200 px-2.5 py-0.5 rounded-lg">
                                    ${c.type === 'percent' ? escAdm(c.value) + '% off' : 'GH₵' + escAdm(c.value) + ' off'}
                                </span>
                                ${c.referrer ? `<span class="text-[11px] font-semibold text-purple-600 bg-purple-50 border border-purple-100 px-2 py-0.5 rounded-full">${escAdm(c.referrer)}</span>` : ''}
                                ${c.totalRevenue ? `<span class="text-[11px] text-emerald-600 font-semibold">GH₵${parseFloat(c.totalRevenue).toFixed(2)} revenue</span>` : ''}
                                ${c.minOrder ? `<span class="text-[11px] text-gray-400">Min: GH₵${escAdm(c.minOrder)}</span>` : ''}
                                ${c.maxUses ? `<span class="text-[11px] text-blue-500">${c.usedCount||0}/${c.maxUses} used</span>` : (c.usedCount ? `<span class="text-[11px] text-gray-400">${c.usedCount} used</span>` : '')}
                                ${c.expiresAt ? `<span class="text-[11px] ${Date.now()>c.expiresAt?'text-red-500':'text-gray-400'}">Expires ${new Date(c.expiresAt).toLocaleDateString('en-GH')}</span>` : ''}
                            </div>
                            <button onclick="deleteCode('${escAdmJsAttr(c.code)}')" class="text-rose-500 hover:text-rose-700 text-xs font-bold transition ml-4 flex-shrink-0">Delete</button>
                        </div>`).join('');
                })
                .catch(() => {});
        }

        function createCode() {
            const code     = document.getElementById('code-input').value.trim();
            const type     = document.getElementById('code-type').value;
            const value    = document.getElementById('code-value').value;
            const minOrder = document.getElementById('code-min').value;
            const maxUses  = document.getElementById('code-max-uses')?.value || '';
            const expires  = document.getElementById('code-expires')?.value || '';
            const referrer = document.getElementById('code-referrer')?.value?.trim() || '';
            if (!code || !value) { showToast('Code and value are required.', true); return; }
            fetch('/api/codes', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ code, type, value, minOrder, maxUses: maxUses || 0, expiresAt: expires || null, referrer: referrer || null })
            })
            .then(r => r.json())
            .then(data => {
                if (data.success) {
                    document.getElementById('code-input').value = '';
                    document.getElementById('code-value').value = '';
                    document.getElementById('code-min').value   = '';
                    loadCodes();
                    showToast('Promo code created!');
                } else {
                    showToast(data.message || 'Could not create code.', true);
                }
            });
        }

        function deleteCode(code) {
            requireAdminConfirm(
                'Delete Promo Code',
                `Promo code "${code}" will be permanently deleted and can no longer be used.`,
                () => {
                    fetch(`/api/codes/${encodeURIComponent(code)}`, { method: 'DELETE' })
                        .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json().catch(() => ({success:true})); })
                        .then(d => {
                            if (d.success === false) throw new Error(d.message || 'Delete failed.');
                            loadCodes(); showToast('Code deleted.');
                        })
                        .catch(e => showToast('Could not delete code: ' + e.message, true));
                }
            );
        }
        // ── CATEGORIES ──────────────────────────────────────────────────────

        let catsCache = [];

        function loadCategories() {
            fetch('/api/categories')
                .then(r => r.json())
                .then(cats => {
                    catsCache = cats;
                    renderCatList(cats);
                    syncCatDropdown(cats);
                })
                .catch(() => { document.getElementById('cat-list').innerHTML = '<p class="text-xs text-red-400 py-4">Failed to load categories.</p>'; });
        }

        function renderCatList(cats) {
            const list = document.getElementById('cat-list');
            if (!cats.length) {
                list.innerHTML = '<p class="text-sm text-gray-400 text-center py-10">No categories yet — add one above.</p>';
                return;
            }
            list.innerHTML = cats.map((c, idx) => {
                const icon = escAdm((c.name || '?').charAt(0).toUpperCase());
                const isFirst = idx === 0;
                const isLast  = idx === cats.length - 1;
                return `
                <div id="cat-row-${escAdm(c.name)}" data-cat="${escAdm(c.name)}"
                  class="flex items-center gap-3 px-4 py-3 rounded-2xl border transition-colors ${c.enabled ? 'bg-white border-gray-100' : 'bg-gray-50 border-dashed border-gray-200'}">

                  <!-- Move handles -->
                  <div class="flex flex-col gap-0.5 flex-shrink-0">
                    <button onclick="moveCat('${escAdmJsAttr(c.name)}', -1)" ${isFirst ? 'disabled' : ''}
                      class="w-6 h-6 flex items-center justify-center rounded text-gray-300 hover:text-gray-600 hover:bg-gray-100 disabled:opacity-20 disabled:cursor-not-allowed transition-colors text-xs leading-none">▲</button>
                    <button onclick="moveCat('${escAdmJsAttr(c.name)}', 1)" ${isLast ? 'disabled' : ''}
                      class="w-6 h-6 flex items-center justify-center rounded text-gray-300 hover:text-gray-600 hover:bg-gray-100 disabled:opacity-20 disabled:cursor-not-allowed transition-colors text-xs leading-none">▼</button>
                  </div>

                  <!-- Position badge -->
                  <span class="w-6 text-center text-[11px] font-bold text-gray-300 flex-shrink-0">${idx + 1}</span>

                  <!-- Icon + name -->
                  <span class="w-9 h-9 rounded-full bg-gray-100 text-gray-700 text-sm font-semibold flex items-center justify-center flex-shrink-0">${icon}</span>
                  <div class="flex-1 min-w-0">
                    <p class="text-sm font-semibold ${c.enabled ? 'text-gray-900' : 'text-gray-400 line-through'} truncate">${escAdm(c.name)}</p>
                    <p class="text-[10px] text-gray-400 font-medium">Shows as filter tab on the shop</p>
                  </div>

                  <!-- Status badge -->
                  <span class="flex-shrink-0 text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full ${c.enabled ? 'bg-orange-50 text-orange-600 border border-orange-100' : 'bg-gray-100 text-gray-400 border border-gray-200'}">
                    ${c.enabled ? 'Visible' : 'Hidden'}
                  </span>

                  <!-- Actions -->
                  <div class="flex items-center gap-1 flex-shrink-0">
                    <button onclick="toggleCategory('${escAdmJsAttr(c.name)}')"
                      class="text-xs font-semibold px-3 py-1.5 rounded-lg border transition-colors ${c.enabled
                        ? 'border-gray-200 text-gray-500 hover:border-orange-300 hover:text-orange-600 hover:bg-orange-50'
                        : 'border-gray-200 text-gray-400 hover:border-gray-400 hover:text-gray-700 hover:bg-gray-100'}">
                      ${c.enabled ? 'Hide' : 'Show'}
                    </button>
                    ${currentAdminRole !== 'staff' ? `<button onclick="deleteCategory('${escAdmJsAttr(c.name)}')"
                      class="text-xs font-semibold px-2.5 py-1.5 rounded-lg border border-transparent text-red-300 hover:border-red-200 hover:text-red-500 hover:bg-red-50 transition-colors">✕</button>` : ''}
                  </div>
                </div>`;
            }).join('');
        }

        function syncCatDropdown(cats) {
            const sel = document.getElementById('form-category');
            if (!sel) return;
            const cur = sel.value;
            // SIZE_PRESETS' keys are unioned in here too so every preset category is always
            // selectable even before a matching row exists in categories.json — see the
            // warning on SIZE_PRESETS above about keeping the two in sync.
            const presetNames = Object.keys(SIZE_PRESETS);
            const apiNames    = cats.map(c => c.name);
            const allNames    = [...new Set([...apiNames, ...presetNames])];
            sel.innerHTML = '<option value="">— Select category —</option>' +
                allNames.map(name => `<option value="${escAdm(name)}">${escAdm(name)}</option>`).join('');
            if (cur) sel.value = cur;
        }

        function moveCat(name, dir) {
            const idx = catsCache.findIndex(c => c.name === name);
            if (idx < 0) return;
            const newIdx = idx + dir;
            if (newIdx < 0 || newIdx >= catsCache.length) return;
            const updated = [...catsCache];
            [updated[idx], updated[newIdx]] = [updated[newIdx], updated[idx]];
            catsCache = updated;
            renderCatList(catsCache); // instant local update
            fetch('/api/categories/reorder', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ order: catsCache.map(c => c.name) })
            })
            .then(r => r.json())
            .then(d => { if (!d.success) showToast('Could not save order.', true); })
            .catch(() => showToast('Network error — order not saved.', true));
        }

        function toggleCategory(name) {
            fetch('/api/categories/' + encodeURIComponent(name) + '/toggle', { method: 'PUT' })
                .then(r => r.json())
                .then(data => {
                    if (data.success) {
                        catsCache = catsCache.map(c => c.name === name ? { ...c, enabled: data.category.enabled } : c);
                        renderCatList(catsCache);
                        showToast(name + ' is now ' + (data.category.enabled ? 'visible' : 'hidden') + ' on the shop.');
                    } else showToast(data.message || 'Failed to update category.', true);
                })
                .catch(() => showToast('Network error — could not update category.', true));
        }

        function addCategory() {
            const input = document.getElementById('cat-name-input');
            const name  = input.value.trim();
            if (!name) { input.focus(); return; }
            fetch('/api/categories', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name })
            })
            .then(r => r.json())
            .then(data => {
                if (data.success) {
                    input.value = '';
                    loadCategories();
                    showToast('Category "' + name + '" added.');
                } else {
                    showToast(data.message || 'Failed to add category.', true);
                }
            });
        }

        function deleteCategory(name) {
            requireAdminConfirm(
                'Delete Category',
                `"${name}" will be removed. Products in this category will still exist but won't appear in filters.`,
                () => {
                    fetch('/api/categories/' + encodeURIComponent(name), { method: 'DELETE' })
                        .then(r => r.json())
                        .then(data => {
                            if (data.success) {
                                catsCache = catsCache.filter(c => c.name !== name);
                                renderCatList(catsCache);
                                syncCatDropdown(catsCache);
                                showToast('Category deleted.');
                                loadInventory();
                            } else showToast(data.message || 'Failed to delete category.', true);
                        })
                        .catch(() => showToast('Network error — could not delete category.', true));
                }
            );
        }

        // ── ORDER DETAIL DRAWER ─────────────────────────────────────────────
        function openOrderDetail(id) {
            const o = ordersCache.find(o => o.id === id);
            if (!o) return;

            document.getElementById('od-id').textContent = '#' + o.id;

            const status = o.status || 'Pending';
            const statusColors = { Pending:'bg-yellow-100 text-yellow-700', Processing:'bg-blue-100 text-blue-700', Shipped:'bg-purple-100 text-purple-700', Delivered:'bg-green-100 text-green-700' };
            const sc  = statusColors[status] || 'bg-gray-100 text-gray-600';
            const ps  = o.paymentStatus || 'paid';
            const payBadge = ps === 'paid'
                ? `<span class="px-2.5 py-1 rounded-lg text-[10px] font-bold bg-orange-50 text-orange-600 border border-orange-100">✓ Paid</span>`
                : ps === 'test'
                ? `<span class="px-2.5 py-1 rounded-lg text-[10px] font-bold bg-gray-100 text-gray-500 border border-gray-200">Test</span>`
                : `<span class="px-2.5 py-1 rounded-lg text-[10px] font-bold bg-gray-100 text-gray-500 border border-gray-200">✓ Paid</span>`;

            const date = new Date(o.paidAt).toLocaleString('en-GH', { dateStyle: 'full', timeStyle: 'short' });

            const itemsHtml = (o.items || []).map(i => `
                <div class="flex items-start justify-between py-2.5 border-b border-gray-100 last:border-0">
                    <div class="flex-1 min-w-0 pr-3">
                        <p class="text-sm font-semibold text-gray-900">${escAdm(i.name)}</p>
                        <p class="text-xs text-gray-400 mt-0.5">${escAdm([i.size, i.color].filter(Boolean).join(' · ')) || 'No variant'}</p>
                    </div>
                    <div class="text-right flex-shrink-0">
                        <p class="text-xs font-bold text-gray-700">×${i.quantity}</p>
                        ${i.price ? `<p class="text-[10px] text-gray-400">GHS ${parseFloat(i.price).toFixed(2)} ea</p>` : ''}
                    </div>
                </div>`).join('');

            const subtotal = parseFloat(o.subtotal || o.total || 0);
            const delivery = parseFloat(o.deliveryPrice || 0);
            const discount = parseFloat(o.promoDiscount || 0);
            const total    = parseFloat(o.total || 0);

            const totalsHtml = `
                <div class="space-y-1.5 text-xs">
                    <div class="flex justify-between text-gray-500"><span>Subtotal</span><span>GHS ${subtotal.toFixed(2)}</span></div>
                    <div class="flex justify-between text-gray-500">
                        <span>Delivery${o.deliveryZone ? ` <span class="text-gray-400">(${escAdm(o.deliveryZone)})</span>` : ''}</span>
                        <span>${delivery > 0 ? 'GHS ' + delivery.toFixed(2) : 'Free'}</span>
                    </div>
                    ${discount > 0 ? `<div class="flex justify-between text-emerald-600"><span>Promo (${escAdm(o.promoCode || '')})</span><span>−GHS ${discount.toFixed(2)}</span></div>` : ''}
                    <div class="flex justify-between font-bold text-gray-900 pt-2 border-t border-gray-100 text-sm"><span>Total</span><span>GHS ${total.toFixed(2)}</span></div>
                </div>`;

            const fulfillmentBanner = o.fulfillmentAlert
                ? `<div class="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-xs text-red-700 font-semibold">Stock issue at time of payment: ${escAdm(o.fulfillmentAlert)} — stock was NOT deducted. Please review and resolve manually.</div>`
                : '';
            const priceBanner = o.priceAlert
                ? `<div class="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-xs text-amber-800 font-semibold">Price discrepancy: ${escAdm(o.priceAlert)} — this order was accepted but needs manual review.</div>`
                : '';

            document.getElementById('od-body').innerHTML = `
                <div class="flex flex-wrap items-center gap-2">${payBadge}<span class="text-xs text-gray-400">${date}</span></div>
                ${fulfillmentBanner}${priceBanner}

                <div class="bg-gray-50 rounded-2xl p-4 space-y-1">
                    <p class="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-2">Customer</p>
                    <p class="text-sm font-bold text-gray-900">${escAdm((o.customer||{}).name||"-")}</p>
                    <p class="text-xs text-gray-500">${escAdm((o.customer||{}).phone||"")}</p>
                    ${o.customer.email ? `<p class="text-xs text-gray-500">${escAdm(o.customer.email)}</p>` : ''}
                    <p class="text-xs text-gray-500 pt-0.5">${escAdm((o.customer||{}).address||"")}</p>
                    ${o.customer.notes ? `<p class="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2 mt-2">${escAdm(o.customer.notes)}</p>` : ''}
                </div>

                <div>
                    <p class="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-3">Items</p>
                    <div class="bg-gray-50 rounded-2xl px-4 py-1">${itemsHtml}</div>
                </div>

                <div class="bg-gray-50 rounded-2xl p-4">
                    <p class="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-3">Summary</p>
                    ${totalsHtml}
                </div>

                <div>
                    <div class="flex items-center justify-between mb-2">
                      <p class="text-[10px] font-bold uppercase tracking-wider text-gray-400">Fulfilment</p>
                      ${o.lastStatusBy ? `<span class="text-[10px] text-gray-300">Last updated by <strong>${escAdm(o.lastStatusBy)}</strong> · ${o.lastStatusAt ? new Date(o.lastStatusAt).toLocaleString('en-GH',{dateStyle:'short',timeStyle:'short'}) : ''}</span>` : ''}
                    </div>
                    <select onchange="updateOrderStatus('${o.id}', this.value, this)" class="w-full text-sm border border-gray-200 rounded-xl px-4 py-2.5 font-semibold ${sc} cursor-pointer focus:outline-none focus:border-amber-400 transition">
                        ${['Pending','Processing','Shipped','Delivered','Returned','Refunded'].map(s => `<option value="${s}" ${s===status?'selected':''}>${s}</option>`).join('')}
                    </select>
                </div>

                <div class="space-y-2">
                    <p class="text-[10px] font-bold uppercase tracking-wider text-gray-400">Tracking Number</p>
                    <div class="flex gap-2">
                        <input id="od-tracking-carrier" type="text" placeholder="Carrier (e.g. DHL)" value="${escAdm(o.trackingCarrier||'')}" class="w-28 border border-gray-200 rounded-xl px-3 py-2 text-xs focus:outline-none focus:border-orange-400"/>
                        <input id="od-tracking-num" type="text" placeholder="Tracking number" value="${escAdm(o.trackingNumber||'')}" class="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-xs focus:outline-none focus:border-orange-400"/>
                        <button onclick="saveTracking('${o.id}')" class="bg-gray-800 hover:bg-orange-500 text-white text-xs font-semibold px-3 rounded-xl transition">Save</button>
                    </div>
                </div>

                <div class="space-y-2">
                    <p class="text-[10px] font-bold uppercase tracking-wider text-gray-400">Internal Notes</p>
                    ${(o.adminNotes||[]).map(n => `<div class="text-xs bg-amber-50 border border-amber-100 rounded-xl px-3 py-2"><span class="font-semibold text-amber-700">${escAdm(n.author)}</span> <span class="text-gray-400">${new Date(n.at).toLocaleString('en-GH',{dateStyle:'short',timeStyle:'short'})}</span><p class="text-gray-700 mt-1">${escAdm(n.text)}</p></div>`).join('')}
                    <div class="flex gap-2">
                        <input id="od-note-input" type="text" placeholder="Add a note…" class="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-xs focus:outline-none focus:border-orange-400"/>
                        <button onclick="saveOrderNote('${o.id}')" class="bg-gray-800 hover:bg-orange-500 text-white text-xs font-semibold px-3 rounded-xl transition">Add</button>
                    </div>
                </div>

                ${(status === 'Delivered' || status === 'Returned' || status === 'Refunded') ? `
                <div class="border border-red-100 rounded-2xl p-4 space-y-2">
                    <p class="text-[10px] font-bold uppercase tracking-wider text-red-400">Return / Refund</p>
                    <div class="flex gap-2 flex-wrap">
                        <input id="od-return-reason" type="text" placeholder="Reason" class="flex-1 min-w-[120px] border border-gray-200 rounded-xl px-3 py-2 text-xs focus:outline-none focus:border-red-400"/>
                        <input id="od-refund-amount" type="number" placeholder="Refund GH₵" min="0" step="0.01" class="w-28 border border-gray-200 rounded-xl px-3 py-2 text-xs focus:outline-none focus:border-red-400"/>
                        <button onclick="markReturn('${o.id}','Refunded')" class="bg-red-500 hover:bg-red-600 text-white text-xs font-semibold px-3 rounded-xl transition">Mark Refunded</button>
                    </div>
                </div>` : ''}`;

            const raw = (o.customer.phone || '').replace(/\D/g, '');
            const waNum = raw.startsWith('0') ? '233' + raw.slice(1) : raw;
            const waBtn = waNum.length > 6
                ? `<a href="${escAdm(invoiceWaUrl(o))}" target="_blank" rel="noopener" class="flex-1 block text-center bg-gray-900 hover:bg-orange-500 text-white text-sm font-semibold py-2.5 rounded-xl transition">Send Invoice on WhatsApp</a>`
                : `<p class="text-xs text-gray-400 text-center w-full py-2">No phone number on file</p>`;
            document.getElementById('od-footer').innerHTML = `
                ${waBtn}
                <button onclick="printOrderDoc('${o.id}')" class="flex-1 block text-center bg-orange-50 hover:bg-orange-100 border border-orange-200 text-orange-600 text-sm font-semibold py-2.5 rounded-xl transition">↓ Download Invoice</button>`;

            const backdrop = document.getElementById('order-drawer-backdrop');
            const drawer   = document.getElementById('order-drawer');
            backdrop.classList.remove('hidden');
            requestAnimationFrame(() => {
                backdrop.style.opacity = '1';
                drawer.style.transform = 'translateX(0)';
            });
        }

        function closeOrderDetail() {
            const backdrop = document.getElementById('order-drawer-backdrop');
            const drawer   = document.getElementById('order-drawer');
            backdrop.style.opacity = '0';
            drawer.style.transform = 'translateX(100%)';
            setTimeout(() => backdrop.classList.add('hidden'), 280);
        }

        // ── IMAGE CROPPER ────────────────────────────────────────────────────
        const SLOT_CONFIG = {
            hero:   { ratio: 16/9, label: 'Hero Slide 1',     hint: 'Pan & zoom to choose which part of the photo fills the banner' },
            slide2: { ratio: 16/9, label: 'Hero Slide 2',     hint: 'Pan & zoom to choose which part of the photo fills the banner' },
            slide3: { ratio: 16/9, label: 'Hero Slide 3',     hint: 'Pan & zoom to choose which part of the photo fills the banner' },
            about:  { ratio: 4/3,  label: 'About / Story',    hint: 'Adjust the framing for the story section photo' },
            logo:   { ratio: NaN,  label: 'Logo',             hint: 'Draw a crop box around the logo, then save' },
            polar1: { ratio: 3/4,  label: 'Gallery Photo 1',  hint: 'Portrait shot for the community section background' },
            polar2: { ratio: 3/4,  label: 'Gallery Photo 2',  hint: 'Portrait shot for the community section background' },
            polar3: { ratio: 3/4,  label: 'Gallery Photo 3',  hint: 'Portrait shot for the community section background' },
            polar4: { ratio: 3/4,  label: 'Gallery Photo 4',  hint: 'Portrait shot for the community section background' },
            polar5: { ratio: 3/4,  label: 'Gallery Photo 5',  hint: 'Portrait shot for the community section background' },
            polar6: { ratio: 3/4,  label: 'Gallery Photo 6',  hint: 'Portrait shot for the community section background' },
            polar7: { ratio: 3/4,  label: 'Gallery Photo 7',  hint: 'Portrait shot for the community section background' },
            polar8: { ratio: 3/4,  label: 'Gallery Photo 8',  hint: 'Portrait shot for the community section background' },
            polar9: { ratio: 3/4,  label: 'Gallery Photo 9',  hint: 'Portrait shot for the community section background' },
        };
        const SLOT_OUTPUT = {
            hero: [1920,1080], slide2: [1920,1080], slide3: [1920,1080], about: [1200,900], logo: [600,600],
            polar1: [900,1200], polar2: [900,1200], polar3: [900,1200], polar4: [900,1200], polar5: [900,1200],
            polar6: [900,1200], polar7: [900,1200], polar8: [900,1200], polar9: [900,1200],
        };

        let cropperSlot = null;
        let cropperInst = null;

        function uploadHeroVideo(input) {
            const file = input.files[0];
            if (!file) return;
            input.value = '';
            const btn = document.getElementById('hero-video-btn');
            const msg = document.getElementById('hero-video-msg');
            if (btn) { btn.textContent = 'Uploading…'; btn.classList.add('opacity-60'); }
            if (msg) { msg.classList.add('hidden'); }
            const fd = new FormData();
            fd.append('video', file);
            fetch('/api/site-video/hero', { method: 'POST', body: fd })
                .then(r => r.json())
                .then(d => {
                    if (d.success) {
                        showToast('Hero video uploaded!');
                        if (msg) { msg.textContent = '✓ Video saved. Enable it in Settings → Hero Video Slide.'; msg.classList.remove('hidden'); msg.className = 'text-xs mt-2 text-green-600'; }
                    } else {
                        showToast(d.message || 'Upload failed.', true);
                        if (msg) { msg.textContent = d.message || 'Upload failed.'; msg.classList.remove('hidden'); }
                    }
                })
                .catch(() => { showToast('Network error.', true); if (msg) { msg.textContent = 'Network error.'; msg.classList.remove('hidden'); } })
                .finally(() => { if (btn) { btn.textContent = 'Upload Video'; btn.classList.remove('opacity-60'); } });
        }

        function uploadSiteImage(slot, input) {
            const file = input.files[0];
            if (!file) return;
            input.value = '';
            const reader = new FileReader();
            reader.onload = e => openCropModal(slot, e.target.result);
            reader.readAsDataURL(file);
        }

        function adjustImage(slot) {
            const preview = document.getElementById('preview-' + slot);
            if (!preview) return;
            const base = (preview.src || '').split('?')[0];
            if (!base) return;
            openCropModal(slot, base + '?t=' + Date.now());
        }

        function openCropModal(slot, src) {
            cropperSlot = slot;
            const cfg = SLOT_CONFIG[slot] || {};
            document.getElementById('crop-modal-title').textContent = 'Adjust — ' + (cfg.label || slot);
            document.getElementById('crop-modal-hint').textContent = cfg.hint || 'Drag to reposition · Scroll to zoom';
            document.getElementById('crop-modal').classList.remove('hidden');
            if (cropperInst) { cropperInst.destroy(); cropperInst = null; }
            const img = document.getElementById('crop-img');
            img.src = '';
            const isLogo = slot === 'logo';
            img.onload = function() {
                cropperInst = new Cropper(img, {
                    aspectRatio:              isLogo ? NaN : cfg.ratio,
                    viewMode:                 1,
                    dragMode:                 isLogo ? 'crop' : 'move',
                    autoCropArea:             isLogo ? 0.8 : 1,
                    cropBoxMovable:           isLogo,
                    cropBoxResizable:         isLogo,
                    guides:                   true,
                    center:                   true,
                    highlight:                false,
                    background:               false,
                    toggleDragModeOnDblclick: false,
                    minContainerHeight:       360,
                });
            };
            img.src = src;
        }

        function closeCropModal() {
            document.getElementById('crop-modal').classList.add('hidden');
            const img = document.getElementById('crop-img');
            img.onload = null;
            img.src = '';
            if (cropperInst) { cropperInst.destroy(); cropperInst = null; }
            cropperSlot = null;
        }

        // ── INVENTORY: inline stock, featured, clone, bulk ─────────────────
        function inlineEditStock(span, id, currentStock) {
            const cell = span.closest('td');
            const input = document.createElement('input');
            input.type = 'number';
            input.min = '0';
            input.value = currentStock === '' ? '' : currentStock;
            input.placeholder = '0';
            input.className = 'w-16 px-2 py-1 border border-amber-400 rounded-lg text-xs font-bold text-gray-800 focus:outline-none';
            cell.innerHTML = '';
            cell.appendChild(input);
            input.focus();
            input.select();
            let saved = false;
            const save = () => {
                if (saved) return; saved = true;
                const val = input.value.trim();
                const stock = val === '' ? null : parseInt(val, 10);
                fetch('/api/products/' + id + '/stock', {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ stock })
                })
                .then(r => r.json())
                .then(d => { if (d.success) { loadInventory(); showToast('Stock updated.'); } else showToast('Could not update stock.', true); })
                .catch(() => showToast('Network error.', true));
            };
            input.addEventListener('keydown', e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') { saved = true; loadInventory(); } });
            input.addEventListener('blur', save);
        }

        function toggleFeatured(id, isFeat) {
            fetch('/api/products/' + id + '/featured', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ featured: !isFeat })
            })
            .then(r => r.json())
            .then(d => { if (d.success) { loadInventory(); showToast(!isFeat ? 'Added to featured.' : 'Removed from featured.'); } else showToast('Could not update.', true); })
            .catch(() => showToast('Network error.', true));
        }

        function cloneProduct(id) {
            fetch('/api/products/' + id + '/duplicate', { method: 'POST' })
                .then(r => r.json())
                .then(d => {
                    if (d.success) {
                        loadInventory();
                        loadStock();
                        showToast('Product duplicated!');
                    } else showToast(d.message || 'Could not duplicate.', true);
                })
                .catch(() => showToast('Network error.', true));
        }

        function toggleSelectAll(cb) {
            document.querySelectorAll('.bulk-check').forEach(c => c.checked = cb.checked);
            updateBulkBar();
        }

        function updateBulkBar() {
            const checked = document.querySelectorAll('.bulk-check:checked');
            const bar = document.getElementById('bulk-bar');
            const cnt = document.getElementById('bulk-count');
            if (checked.length > 0) {
                bar.classList.remove('hidden');
                cnt.textContent = checked.length + ' selected';
            } else {
                bar.classList.add('hidden');
                const all = document.getElementById('bulk-check-all');
                if (all) all.checked = false;
            }
        }

        function bulkAction(action) {
            const ids = [...document.querySelectorAll('.bulk-check:checked')].map(c => c.value);
            if (!ids.length) return;
            const doAction = () => {
                fetch('/api/products/bulk', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ids, action })
                })
                .then(r => r.json())
                .then(d => { if (d.success) { loadInventory(); showToast(d.message || 'Done!'); } else showToast(d.message || 'Could not complete action.', true); })
                .catch(() => showToast('Network error.', true));
            };
            if (action === 'delete') {
                requireAdminConfirm(
                    'Bulk Delete Products',
                    `Permanently delete ${ids.length} product${ids.length > 1 ? 's' : ''}? This cannot be undone.`,
                    doAction
                );
            } else {
                doAction();
            }
        }

        // ── REVIEWS: featured toggle ────────────────────────────────────────
        function toggleReviewFeatured(id, isFeat) {
            fetch('/api/reviews/' + id + '/featured', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ featured: !isFeat })
            })
            .then(r => r.json())
            .then(d => { if (d.success) { loadReviews(); showToast(!isFeat ? 'Review featured on homepage.' : 'Review unfeatured.'); } else showToast('Could not update.', true); })
            .catch(() => showToast('Network error.', true));
        }

        // ── NOTIFY: WhatsApp message copy ──────────────────────────────────
        function copyWAMsg(id) {
            const entry = notifyCache.find(n => n.id == id);
            if (!entry) return;
            const name = entry.name || 'there';
            const product = entry.productName || entry.productId || 'the item';
            const msg = `Hello ${name}! \n\nGreat news — *${product}* is back in stock at ${getStoreName()}!\n\nShop now before it sells out again \n— ${getStoreName()}`;
            if (navigator.clipboard) {
                navigator.clipboard.writeText(msg).then(() => showToast('WhatsApp message copied to clipboard!')).catch(() => fallbackCopy(msg));
            } else { fallbackCopy(msg); }
        }

        function fallbackCopy(text) {
            const ta = document.createElement('textarea');
            ta.value = text;
            ta.style.position = 'fixed';
            ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
            showToast('WhatsApp message copied!');
        }

        // ── ANALYTICS ───────────────────────────────────────────────────────
        let analyticsChart = null;

        let analyticsCatChart = null;

        function loadAnalytics(fromDate, toDate) {
            const params = new URLSearchParams();
            if (fromDate) params.set('from', fromDate);
            if (toDate)   params.set('to',   toDate);
            const url = '/api/analytics' + (params.toString() ? '?' + params.toString() : '');
            fetch(url)
                .then(r => r.json())
                .then(data => {
                    const days = Object.keys(data.daily);
                    const revenues = days.map(d => data.daily[d].revenue);
                    const orderCounts = days.map(d => data.daily[d].orders);
                    const labels = days.map(d => { const dt = new Date(d); return dt.toLocaleDateString('en-GB', { month:'short', day:'numeric' }); });

                    const now = new Date().toISOString().slice(0, 10);
                    const weekAgo = new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10);
                    const monthAgo = days[0];

                    let today = 0, week = 0, month = 0, totalOrders = 0;
                    days.forEach(d => {
                        month += data.daily[d].revenue;
                        totalOrders += data.daily[d].orders;
                        if (d >= weekAgo) week += data.daily[d].revenue;
                        if (d === now) today += data.daily[d].revenue;
                    });

                    const fmt  = n => 'GH₵' + Math.abs(n).toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
                    const fmtS = n => (n < 0 ? '−' : '') + fmt(n);
                    document.getElementById('an-today').textContent = fmt(today);
                    document.getElementById('an-week').textContent  = fmt(week);
                    document.getElementById('an-month').textContent = fmt(month);
                    document.getElementById('an-avg').textContent   = totalOrders ? fmt(month / totalOrders) : 'GH₵0';

                    // Profit margin cards
                    const gm = data.grossMargin || 0, nm = data.netMargin || 0;
                    const grossBadge = document.getElementById('an-gross-badge');
                    const netBadge   = document.getElementById('an-net-badge');
                    if (grossBadge) {
                        grossBadge.textContent = gm.toFixed(1) + '%';
                        grossBadge.className = 'text-[10px] font-bold px-2 py-0.5 rounded-full ' + (gm >= 40 ? 'bg-emerald-100 text-emerald-700' : gm >= 20 ? 'bg-yellow-100 text-yellow-700' : 'bg-red-100 text-red-600');
                    }
                    if (netBadge) {
                        netBadge.textContent = nm.toFixed(1) + '%';
                        netBadge.className = 'text-[10px] font-bold px-2 py-0.5 rounded-full ' + (nm >= 25 ? 'bg-blue-100 text-blue-700' : nm >= 10 ? 'bg-yellow-100 text-yellow-700' : 'bg-red-100 text-red-600');
                    }
                    const setEl = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
                    setEl('an-gross-profit', fmtS(data.grossProfit || 0));
                    setEl('an-net-profit',   fmtS(data.netProfit   || 0));
                    setEl('an-total-rev',    fmt(data.totalRevenue  || 0));
                    setEl('an-cogs',        '−' + fmt(data.totalCOGS       || 0));
                    setEl('an-delivery-paid','−' + fmt(data.totalDeliveryPaid || 0));
                    setEl('an-net-total',    fmtS(data.netProfit   || 0));
                    const grossBar = document.getElementById('an-gross-bar');
                    const netBar   = document.getElementById('an-net-bar');
                    if (grossBar) setTimeout(() => grossBar.style.width = Math.min(100, Math.max(0, gm)) + '%', 100);
                    if (netBar)   setTimeout(() => netBar.style.width   = Math.min(100, Math.max(0, nm)) + '%', 100);

                    const ctx = document.getElementById('an-chart').getContext('2d');
                    if (analyticsChart) analyticsChart.destroy();
                    analyticsChart = new Chart(ctx, {
                        type: 'bar',
                        data: {
                            labels,
                            datasets: [{
                                label: 'Revenue (GH₵)',
                                data: revenues,
                                backgroundColor: 'rgba(201,151,28,.18)',
                                borderColor: '#C9971C',
                                borderWidth: 2,
                                borderRadius: 6,
                                borderSkipped: false
                            }]
                        },
                        options: {
                            responsive: true,
                            plugins: { legend: { display: false } },
                            scales: {
                                y: { beginAtZero: true, grid: { color: '#f3f4f6' }, ticks: { callback: v => 'GH₵' + v } },
                                x: { grid: { display: false }, ticks: { maxTicksLimit: 10, maxRotation: 0 } }
                            }
                        }
                    });

                    // Repeat customers & promo stats
                    const setEl2 = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
                    setEl2('an-repeat-rate',    (data.repeatRate || 0).toFixed(1) + '%');
                    setEl2('an-unique-cust',    data.uniqueCustomers || 0);
                    setEl2('an-repeat-cust',    data.repeatCustomers || 0);
                    setEl2('an-total-discount', fmt(data.totalDiscount || 0));

                    const bs = document.getElementById('an-bestsellers');
                    if (!data.bestSellers.length) {
                        bs.innerHTML = '<p class="text-xs text-gray-400 text-center py-4">No sales data yet.</p>';
                    } else {
                        const maxQty = data.bestSellers[0].qty || 1;
                        bs.innerHTML = data.bestSellers.map((p) => `
                            <div>
                              <div class="flex items-center justify-between mb-1">
                                <span class="text-xs font-semibold text-gray-700 truncate max-w-[65%]">${escAdm(p.name)}</span>
                                <span class="text-xs text-gray-400">${p.qty} sold · GH₵${(p.revenue||0).toFixed(0)}</span>
                              </div>
                              <div class="w-full bg-gray-100 rounded-full h-1.5">
                                <div class="h-1.5 rounded-full bg-orange-400" style="width:${Math.round(p.qty/maxQty*100)}%"></div>
                              </div>
                            </div>`).join('');
                    }

                    // Category breakdown
                    const catEl = document.getElementById('an-category-chart');
                    if (catEl && data.categoryBreakdown && data.categoryBreakdown.length) {
                        const maxCatRev = data.categoryBreakdown[0].revenue || 1;
                        catEl.innerHTML = data.categoryBreakdown.map(c => `
                            <div>
                              <div class="flex justify-between mb-1">
                                <span class="text-xs font-semibold text-gray-700">${escAdm(c.category)}</span>
                                <span class="text-xs text-gray-400">GH₵${(c.revenue||0).toFixed(0)} · ${c.qty} sold</span>
                              </div>
                              <div class="w-full bg-gray-100 rounded-full h-1.5">
                                <div class="h-1.5 rounded-full bg-blue-400" style="width:${Math.round(c.revenue/maxCatRev*100)}%"></div>
                              </div>
                            </div>`).join('');
                    }
                })
                .catch(() => showToast('Could not load analytics.', true));
        }

        function applyProductAnalytics() { var f=document.getElementById('pa-from')?.value; var t=document.getElementById('pa-to')?.value; loadProductAnalytics(!(f||t)); }

        function applyAnalyticsRange() {
            const from = document.getElementById('an-from')?.value;
            const to   = document.getElementById('an-to')?.value;
            loadAnalytics(from, to);
        }

        // ── PRODUCT ANALYTICS ───────────────────────────────────────────────
        let paRows = [], paSortKey = 'views', paSortAsc = false;

        function loadProductAnalytics(allTime) {
            const from = allTime ? '' : document.getElementById('pa-from')?.value || '';
            const to   = allTime ? '' : document.getElementById('pa-to')?.value   || '';
            const params = new URLSearchParams();
            if (from) params.set('from', from);
            if (to)   params.set('to',   to);
            const url = '/api/admin/product-analytics' + (params.toString() ? '?' + params.toString() : '');
            fetch(url).then(r => r.json()).then(data => {
                paRows = data.rows || [];
                // Summary cards
                const setEl = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
                setEl('pa-total-views', data.totals?.views?.toLocaleString() || '0');
                setEl('pa-total-carts', data.totals?.cartAdds?.toLocaleString() || '0');
                const convRows = paRows.filter(r => r.viewToBuy !== null);
                const avgConv  = convRows.length ? Math.round(convRows.reduce((s,r)=>s+(r.viewToBuy||0),0)/convRows.length) : 0;
                setEl('pa-avg-conv', avgConv + '%');
                setEl('pa-total-wish', paRows.reduce((s,r)=>s+r.wishlistSaves,0).toLocaleString());
                paRender();
            }).catch(() => {
                const tb = document.getElementById('pa-tbody');
                if (tb) tb.innerHTML = '<tr><td colspan="8" class="text-center py-8 text-red-400 text-xs">Failed to load analytics.</td></tr>';
            });
        }

        function paSort(key) {
            if (paSortKey === key) paSortAsc = !paSortAsc;
            else { paSortKey = key; paSortAsc = false; }
            paRender();
        }

        function paFilter() {
            paRender();
        }

        function paRender() {
            const q   = (document.getElementById('pa-search')?.value || '').toLowerCase();
            const tbody = document.getElementById('pa-tbody');
            if (!tbody) return;
            let rows = paRows.filter(r => !q || r.name.toLowerCase().includes(q) || (r.category||'').toLowerCase().includes(q));
            rows = rows.slice().sort((a, b) => {
                const av = a[paSortKey] ?? -1, bv = b[paSortKey] ?? -1;
                return paSortAsc ? (av > bv ? 1 : -1) : (bv > av ? 1 : -1);
            });
            if (!rows.length) { tbody.innerHTML = '<tr><td colspan="8" class="text-center py-8 text-gray-400 text-xs">No data yet — data appears as customers browse the store.</td></tr>'; return; }

            function convBadge(pct) {
                if (pct === null || pct === undefined) return '<span class="text-gray-300 text-xs">—</span>';
                const color = pct >= 10 ? 'text-green-600 bg-green-50' : pct >= 3 ? 'text-yellow-600 bg-yellow-50' : 'text-red-500 bg-red-50';
                return `<span class="text-[11px] font-bold px-2 py-0.5 rounded-full ${color}">${pct}%</span>`;
            }

            tbody.innerHTML = rows.map(r => `
                <tr class="border-b border-gray-50 hover:bg-orange-50/30 transition">
                  <td class="px-4 py-3">
                    <p class="text-sm font-semibold text-gray-800">${escAdm(r.name)}</p>
                    <p class="text-[11px] text-gray-400">${escAdm(r.category||'')} · GH₵${r.price.toFixed(2)}</p>
                  </td>
                  <td class="px-4 py-3 text-right font-semibold text-gray-700">${r.views.toLocaleString()}</td>
                  <td class="px-4 py-3 text-right text-gray-600">${r.cartAdds.toLocaleString()}</td>
                  <td class="px-4 py-3 text-right text-gray-600">${r.wishlistSaves.toLocaleString()}</td>
                  <td class="px-4 py-3 text-right font-semibold text-gray-800">${r.sold.toLocaleString()}</td>
                  <td class="px-4 py-3 text-right font-semibold text-orange-600">GH₵${(r.revenue||0).toFixed(0)}</td>
                  <td class="px-4 py-3 text-right">${convBadge(r.viewToBuy)}</td>
                  <td class="px-4 py-3 text-right">${convBadge(r.cartToBuy)}</td>
                </tr>`).join('');
        }

        // ── CUSTOMERS ───────────────────────────────────────────────────────
        let customersCache = [];

        function loadCustomers() {
            const tbody = document.getElementById('customers-table-body');
            tbody.innerHTML = '<tr><td colspan="7" class="text-center py-8 text-gray-400 text-xs">Loading…</td></tr>';
            fetch('/api/customers')
                .then(r => r.json())
                .then(data => {
                    customersCache = data;
                    const month = document.getElementById('customers-month')?.value || '';
                    renderCustomers(month);
                })
                .catch(() => showToast('Could not load customers.', true));
        }

        function renderCustomers(month) {
            const tbody = document.getElementById('customers-table-body');
            const data = customersCache.filter(c => inMonth(c.lastOrderDate, month));
            if (!customersCache.length) {
                tbody.innerHTML = '<tr><td colspan="7" class="text-center py-8 text-gray-400 text-xs">No customers yet.</td></tr>';
                return;
            }
            if (!data.length) {
                const label = month ? new Date(month + '-01').toLocaleString('en-GH', {month:'long',year:'numeric'}) : '';
                tbody.innerHTML = `<tr><td colspan="7" class="text-center py-8 text-gray-400 text-xs">No customers${label ? ' for ' + label : ''}.</td></tr>`;
                return;
            }
            tbody.innerHTML = data.map(c => {
                const lo      = c.lastOrder;
                const loDate  = c.lastOrderDate ? new Date(c.lastOrderDate).toLocaleDateString('en-GB') : '—';
                const loItems = lo && lo.items && lo.items.length
                    ? lo.items.slice(0, 3).map(i => escAdm(i.name) + (i.quantity > 1 ? ' ×' + i.quantity : '')).join(', ') + (lo.items.length > 3 ? '…' : '')
                    : '—';
                const loTotal = lo ? 'GH₵' + parseFloat(lo.total || 0).toFixed(2) : '';
                const loId    = lo ? `<span class="font-mono text-[10px] text-gray-400">${escAdm(lo.id)}</span>` : '';
                return `<tr class="data-row hover:bg-gray-50/50 transition">
                  <td class="py-3 px-4 text-sm font-semibold text-gray-800">${escAdm(c.name)}</td>
                  <td class="py-3 px-4 text-xs text-gray-500">${c.phone ? `<a href="https://wa.me/${escAdm(String(c.phone).replace(/\D/g, '').replace(/^0/, '233'))}" target="_blank" rel="noopener" class="hover:underline">${escAdm(c.phone)}</a>` : '—'}</td>
                  <td class="py-3 px-4 text-xs text-gray-500">${c.email ? `<a href="mailto:${escAdm(c.email)}" class="hover:underline">${escAdm(c.email)}</a>` : '—'}</td>
                  <td class="py-3 px-4 text-xs font-bold text-gray-700 text-center">${c.orderCount}</td>
                  <td class="py-3 px-4 text-xs font-bold text-orange-600">GH₵${c.totalSpent.toFixed(2)}</td>
                  <td class="py-3 px-4" style="min-width:180px">
                    <p class="text-xs text-gray-700 leading-snug">${loItems}</p>
                    <p class="text-[10px] text-gray-400 mt-0.5">${loDate} ${loId}</p>
                  </td>
                  <td class="py-3 px-4 text-xs font-semibold text-orange-500 whitespace-nowrap">${loTotal}</td>
                  <td class="py-3 px-4"><button onclick="viewCustomerHistory('${escAdmJsAttr(c.phone || c.email)}')" class="text-xs font-semibold text-orange-500 hover:underline whitespace-nowrap">All orders →</button></td>
                </tr>`;
            }).join('');
        }

        function viewCustomerHistory(email) {
            fetch('/api/customers/' + encodeURIComponent(email) + '/orders')
                .then(r => r.json())
                .then(history => {
                    if (!history.length) { showToast('No orders found for this customer.'); return; }
                    const modal = document.createElement('div');
                    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px';
                    modal.innerHTML = `
                        <div style="background:#fff;border-radius:20px;max-width:700px;width:100%;max-height:85vh;overflow-y:auto;padding:24px">
                          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
                            <h2 style="font-size:16px;font-weight:700;color:#1a1a1a">Order History — ${escAdm(email)}</h2>
                            <button onclick="this.closest('[style*=fixed]').remove()" style="background:#f3f4f6;border:none;border-radius:50%;width:32px;height:32px;cursor:pointer;font-size:14px">✕</button>
                          </div>
                          <div style="display:flex;flex-direction:column;gap:10px">
                            ${history.map(o => `
                              <div style="border:1px solid #f3f4f6;border-radius:12px;padding:14px">
                                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
                                  <span style="font-family:monospace;font-size:11px;color:#6b7280">${escAdm(o.id)}</span>
                                  <span style="font-size:11px;font-weight:700;color:#C9971C">GH₵${parseFloat(o.total||0).toFixed(2)}</span>
                                </div>
                                <p style="font-size:12px;color:#374151;margin:0 0 4px">${(o.items||[]).map(i=>escAdm(i.name)+(i.color?' ('+escAdm(i.color)+')':'')+' ×'+i.quantity).join(', ')}</p>
                                <div style="display:flex;gap:8px;font-size:11px;color:#9ca3af">
                                  <span>${new Date(o.paidAt).toLocaleDateString('en-GH')}</span>
                                  <span>·</span>
                                  <span>${escAdm(o.status||'Pending')}</span>
                                  ${o.trackingNumber ? `<span>· ${escAdm(o.trackingNumber)}</span>` : ''}
                                </div>
                              </div>`).join('')}
                          </div>
                        </div>`;
                    modal.onclick = e => { if (e.target === modal) modal.remove(); };
                    document.body.appendChild(modal);
                });
        }

        function downloadCustomersCSV() {
            if (!customersCache.length) return showToast('No customers to export.', true);
            const rows = [['Name','Email','Phone','Orders','Total Spent (GHS)','Last Order']];
            customersCache.forEach(c => rows.push([c.name, c.email, c.phone || '', c.orderCount, c.totalSpent.toFixed(2), c.lastOrderDate ? new Date(c.lastOrderDate).toLocaleDateString('en-GB') : '']));
            const csv = rows.map(r => r.map(v => '"' + String(v).replace(/"/g,'""') + '"').join(',')).join('\n');
            const a = document.createElement('a');
            a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
            a.download = 'customers-' + new Date().toISOString().slice(0,10) + '.csv';
            a.click();
        }

        // ── STOCK MONITOR ────────────────────────────────────────────────────
        let stockCache = [];
        let stockFilter = 'all';

        function setStockFilter(f) {
            stockFilter = f;
            document.querySelectorAll('.sfil-btn').forEach(b => b.classList.remove('active'));
            const active = document.getElementById('sfil-' + f);
            if (active) active.classList.add('active');
            renderStock();
        }

        function renderStock() {
            const tbody = document.getElementById('stock-table-body');
            const threshold = parseInt(document.getElementById('set-stock-threshold')?.value) || 3;

            const stockStatus = p => {
                if (p.isSoldOut || p.stock === 0) return 'out';
                if (p.stock === null || p.stock === undefined) return 'untracked';
                if (p.stock <= threshold) return 'low';
                return 'in';
            };

            // Valuation bar
            const tracked = stockCache.filter(p => p.stock !== null && p.stock !== undefined);
            const totalUnits = tracked.reduce((s, p) => s + (p.stock || 0), 0);
            const totalValue = tracked.reduce((s, p) => s + (p.stock || 0) * parseFloat(p.price || 0), 0);
            const outCount   = stockCache.filter(p => p.isSoldOut || p.stock === 0).length;
            const el = id => document.getElementById(id);
            if (el('val-total-products')) el('val-total-products').textContent = stockCache.length;
            if (el('val-total-units'))    el('val-total-units').textContent    = totalUnits;
            if (el('val-total-value'))    el('val-total-value').textContent    = 'GH₵' + totalValue.toLocaleString('en-GH', {minimumFractionDigits:2, maximumFractionDigits:2});
            if (el('val-out-of-stock'))   el('val-out-of-stock').textContent   = outCount;

            const allBtn = document.getElementById('sfil-all');
            if (allBtn) allBtn.textContent = 'All (' + stockCache.length + ')';
            ['out','low','in','untracked'].forEach(key => {
                const btn = document.getElementById('sfil-' + key);
                if (!btn) return;
                const n = stockCache.filter(p => stockStatus(p) === key).length;
                const dot = btn.querySelector('span');
                const labels = { out: 'Out of stock', low: 'Low stock', in: 'In stock', untracked: 'Untracked' };
                btn.innerHTML = (dot ? dot.outerHTML : '') + `${labels[key]} (${n})`;
            });

            const filtered = stockFilter === 'all' ? stockCache : stockCache.filter(p => stockStatus(p) === stockFilter);

            if (!stockCache.length) {
                tbody.innerHTML = '<tr><td colspan="8" class="text-center py-8 text-gray-400 text-xs">No products.</td></tr>';
                return;
            }
            if (!filtered.length) {
                tbody.innerHTML = '<tr><td colspan="8" class="text-center py-8 text-gray-400 text-xs">No products match this filter.</td></tr>';
                return;
            }

            const sorted = [...filtered].sort((a, b) => {
                const rank = p => p.isSoldOut ? 0 : p.stock === null ? 3 : p.stock === 0 ? 0 : p.stock <= threshold ? 1 : 2;
                return rank(a) - rank(b);
            });

            tbody.innerHTML = sorted.map(p => {
                const stock   = p.stock;
                const soldOut = p.isSoldOut;
                const isTracked = stock !== null && stock !== undefined;
                const dot   = soldOut || stock === 0 ? 'bg-red-400'
                            : !isTracked             ? 'bg-gray-300'
                            : stock <= threshold     ? 'bg-amber-400'
                            :                          'bg-emerald-400';
                const badge = soldOut               ? '<span class="text-[10px] font-bold text-red-500 bg-red-50 px-2 py-0.5 rounded-full">Sold Out</span>'
                            : !isTracked            ? '<span class="text-[10px] text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">Untracked</span>'
                            : stock === 0           ? '<span class="text-[10px] font-bold text-red-500 bg-red-50 px-2 py-0.5 rounded-full">0 left</span>'
                            : stock <= threshold    ? `<span class="text-[10px] font-bold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">Low — ${stock} left</span>`
                            :                        `<span class="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full">${stock} in stock</span>`;
                const value = isTracked ? 'GH₵' + ((stock || 0) * parseFloat(p.price || 0)).toFixed(2) : '—';
                const hasVariants = (p.variants && p.variants.length) || (p.sizes && p.sizes.length);
                const variantCount = (Array.isArray(p.variants) && p.variants.length && typeof p.variants[0] === 'object')
                    ? p.variants.length
                    : (p.variantStock ? Object.keys(p.variantStock).length : 0);
                return `<tr class="hover:bg-gray-50/60 transition" data-pid="${escAdm(p.id)}">
                  <td class="py-3 px-4"><span class="w-2.5 h-2.5 rounded-full inline-block ${dot}"></span></td>
                  <td class="py-3 px-4">
                    <div class="flex items-center gap-2">
                      <img src="${escAdm(p.image || '')}" style="width:32px;height:32px;object-fit:cover;border-radius:6px;flex-shrink:0;background:#f3f4f6" onerror="this.src='data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2232%22 height=%2232%22%3E%3Crect width=%2232%22 height=%2232%22 fill=%22%23f3f4f6%22/%3E%3Ctext x=%2250%25%22 y=%2255%25%22 dominant-baseline=%22middle%22 text-anchor=%22middle%22 font-size=%2214%22%3E%3C/text%3E%3C/svg%3E'"/>
                      <div>
                        <p class="text-sm font-semibold text-gray-800">${escAdm(p.name)}</p>
                        ${hasVariants ? `<button onclick="toggleVariantRow('${escAdm(p.id)}')" class="text-[10px] text-orange-500 hover:underline font-semibold">Variants${variantCount ? ' (' + variantCount + ')' : ''}</button>` : ''}
                      </div>
                    </div>
                  </td>
                  <td class="py-3 px-4 text-xs text-gray-400">${escAdm(p.category || '—')}</td>
                  <td class="py-3 px-4 text-xs font-semibold text-gray-700 text-center">GH₵${parseFloat(p.price).toFixed(2)}</td>
                  <td class="py-3 px-4" style="width:180px">
                    <div class="flex items-center gap-1.5">
                      <button onclick="adjustStock('${escAdm(p.id)}', -1)" class="w-6 h-6 rounded-md bg-gray-100 hover:bg-red-100 text-gray-600 hover:text-red-600 text-sm font-bold flex items-center justify-center transition-colors">−</button>
                      <input type="number" min="0" value="${isTracked ? stock : ''}" placeholder="—"
                        class="stock-input w-14 border border-gray-200 rounded-lg px-2 py-1 text-xs text-center focus:outline-none focus:ring-2 focus:ring-orange-300"
                        onchange="promptSetStock('${escAdm(p.id)}', this.value, this)"/>
                      <button onclick="adjustStock('${escAdm(p.id)}', 1)" class="w-6 h-6 rounded-md bg-gray-100 hover:bg-emerald-100 text-gray-600 hover:text-emerald-600 text-sm font-bold flex items-center justify-center transition-colors">+</button>
                    </div>
                  </td>
                  <td class="py-3 px-4 text-xs font-semibold text-right ${isTracked ? 'text-gray-700' : 'text-gray-300'}">${value}</td>
                  <td class="py-3 px-4 text-center">${badge}</td>
                  <td class="py-3 px-4" style="min-width:140px">
                    ${p.updatedAt || p.createdAt ? `
                      <p class="text-xs text-gray-700 font-medium">${relTime(p.updatedAt || p.createdAt)}</p>
                      <p class="text-[10px] text-gray-400 mt-0.5">${new Date(p.updatedAt || p.createdAt).toLocaleString('en-GH', {dateStyle:'medium', timeStyle:'short'})}</p>
                    ` : '<span class="text-[10px] text-gray-300">—</span>'}
                  </td>
                </tr>
                ${hasVariants ? `<tr id="variant-row-${escAdm(p.id)}" class="hidden bg-orange-50/40"><td colspan="8" class="px-4 pb-4 pt-0"><div id="variant-grid-${escAdm(p.id)}" class="pt-3"></div></td></tr>` : ''}`;
            }).join('');

            // Valuation bar — cost, profit, margin (requires invMetaCache)
            const costVal = tracked.reduce((s, p) => { const m = invMetaCache[p.id] || {}; const c = calcInvCost(m); return s + ((p.stock || 0) * c); }, 0);
            const sellVal = tracked.reduce((s, p) => s + (p.stock || 0) * (parseFloat(p.price) || 0), 0);
            const profit  = sellVal - costVal;
            const margin  = sellVal > 0 ? (profit / sellVal * 100) : 0;
            const elv = id => document.getElementById(id);
            if (elv('val-cost-value')) elv('val-cost-value').textContent = fmtGH(costVal);
            if (elv('val-profit'))   { elv('val-profit').textContent = fmtGH(profit); elv('val-profit').className = `text-xl font-bold ${profit >= 0 ? 'text-emerald-600' : 'text-red-600'} mt-1`; }
            if (elv('val-margin'))     elv('val-margin').textContent = margin.toFixed(1) + '% margin on sell';
            // Low-stock badge on the tab
            const alertCount = stockCache.filter(p => p.isSoldOut || p.stock === 0 || (p.stock !== null && p.stock <= threshold)).length;
            const badge = document.getElementById('lowstock-badge');
            if (badge) { badge.textContent = alertCount; badge.classList.toggle('hidden', alertCount === 0); }
        }

        // ── ADJUSTMENT REASON MODAL ──────────────────────────────────────────
        let _adjPid = null, _adjValue = null, _adjInput = null, _adjVariant = null;

        function promptSetStock(pid, value, inputEl) {
            _adjPid = pid; _adjValue = value; _adjInput = inputEl; _adjVariant = null;
            const p = stockCache.find(p => p.id === pid);
            document.getElementById('adj-modal-desc').textContent = p ? `Updating total stock for "${p.name}".` : 'Select a reason for this stock change.';
            document.getElementById('adj-custom-reason').value = '';
            document.querySelectorAll('.adj-reason-btn').forEach(b => b.classList.remove('border-orange-400','text-orange-600','bg-orange-50'));
            const m = document.getElementById('adj-modal');
            m.classList.remove('hidden'); m.style.display = 'flex';
        }

        function promptSetVariantStock(pid, variant, value, inputEl) {
            _adjPid = pid; _adjValue = value; _adjInput = inputEl; _adjVariant = variant;
            const p = stockCache.find(p => p.id === pid);
            document.getElementById('adj-modal-desc').textContent = p ? `Updating "${variant}" stock for "${p.name}".` : 'Select a reason for this stock change.';
            document.getElementById('adj-custom-reason').value = '';
            document.querySelectorAll('.adj-reason-btn').forEach(b => b.classList.remove('border-orange-400','text-orange-600','bg-orange-50'));
            const m = document.getElementById('adj-modal');
            m.classList.remove('hidden'); m.style.display = 'flex';
        }

        function selectAdjReason(reason) {
            document.querySelectorAll('.adj-reason-btn').forEach(b => b.classList.remove('border-orange-400','text-orange-600','bg-orange-50'));
            event.currentTarget.classList.add('border-orange-400','text-orange-600','bg-orange-50');
            document.getElementById('adj-custom-reason').value = reason;
        }

        function closeAdjModal() {
            const m = document.getElementById('adj-modal');
            m.style.display = 'none'; m.classList.add('hidden');
            if (_adjInput) { const p = stockCache.find(p => p.id === _adjPid); if (p) _adjInput.value = p.stock ?? ''; }
            _adjPid = _adjValue = _adjInput = _adjVariant = null;
        }

        function confirmAdj() {
            const reason = document.getElementById('adj-custom-reason').value.trim() || 'Manual edit';
            const m = document.getElementById('adj-modal');
            m.style.display = 'none'; m.classList.add('hidden');
            if (_adjVariant) {
                setVariantStock(_adjPid, _adjVariant, _adjValue, reason);
            } else {
                setStock(_adjPid, _adjValue, reason);
            }
            _adjPid = _adjValue = _adjInput = _adjVariant = null;
        }

        function adjustStock(pid, delta) {
            const row = document.querySelector(`[data-pid="${pid}"]`);
            const input = row?.querySelector('.stock-input');
            const cur = parseInt(input?.value) || 0;
            const next = Math.max(0, cur + delta);
            if (input) input.value = next;
            promptSetStock(pid, next, input);
        }

        function setStock(pid, value, reason) {
            const stock = value === '' || value === null ? null : parseInt(value);
            fetch('/api/products/' + pid + '/stock', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ stock, reason: reason || 'Manual edit' })
            })
            .then(r => r.json())
            .then(data => {
                if (data.success) { showToast('Stock updated ✓'); loadStock(); }
                else showToast(data.message || 'Could not update stock.', true);
            })
            .catch(() => showToast('Network error.', true));
        }

        // ── VARIANT STOCK ────────────────────────────────────────────────────
        function toggleVariantRow(pid) {
            const row = document.getElementById('variant-row-' + pid);
            if (!row) return;
            if (!row.classList.contains('hidden')) { row.classList.add('hidden'); return; }
            row.classList.remove('hidden');
            const p = stockCache.find(p => p.id === pid);
            if (!p) return;
            renderVariantGrid(p);
        }

        function renderVariantGrid(p) {
            const grid = document.getElementById('variant-grid-' + p.id);
            if (!grid) return;
            const isRich = Array.isArray(p.variants) && p.variants.length && typeof p.variants[0] === 'object';
            const sizes  = p.sizes && p.sizes.length ? p.sizes : [''];
            const vs = p.variantStock || {};
            let rows;
            if (isRich) {
                // Rich variants: colour + stock embedded in each variant object
                rows = p.variants.flatMap(v => sizes.map(s => {
                    const c = v.color || 'Default';
                    const key = s ? c + '-' + s : c;
                    const label = s ? c + ' / ' + s : c;
                    const qty = s ? (vs[key] ?? '') : (typeof v.stock === 'number' ? v.stock : '');
                    return { key, label, qty };
                }));
            } else {
                // Simple string variants with variantStock dict
                const colors = p.variants && p.variants.length ? p.variants : [''];
                rows = colors.flatMap(c => sizes.map(s => {
                    const key = [c, s].filter(Boolean).join('-') || 'default';
                    return { key, label: [c, s].filter(Boolean).join(' / ') || 'Default', qty: vs[key] ?? '' };
                }));
            }
            grid.innerHTML = `<p class="text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-2">Variant Stock — ${escAdm(p.name)}</p>
            <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
              ${rows.map(r => `
                <div class="bg-white border border-gray-200 rounded-xl p-2.5">
                  <p class="text-[10px] text-gray-500 font-semibold mb-1">${escAdm(r.label)}</p>
                  <div class="flex items-center gap-1">
                    <button onclick="adjustVariantStock('${escAdmJsAttr(p.id)}','${escAdmJsAttr(r.key)}',-1,this)" class="w-6 h-6 rounded bg-gray-100 hover:bg-red-100 text-gray-600 hover:text-red-600 text-sm font-bold flex items-center justify-center transition">−</button>
                    <input type="number" min="0" value="${r.qty}" placeholder="0"
                      class="variant-stock-input flex-1 w-0 border border-gray-200 rounded-lg px-1 py-1 text-xs text-center focus:outline-none focus:ring-2 focus:ring-orange-300"
                      data-pid="${escAdm(p.id)}" data-variant="${escAdm(r.key)}"
                      onchange="promptSetVariantStock('${escAdmJsAttr(p.id)}','${escAdmJsAttr(r.key)}',this.value,this)"/>
                    <button onclick="adjustVariantStock('${escAdmJsAttr(p.id)}','${escAdmJsAttr(r.key)}',1,this)" class="w-6 h-6 rounded bg-gray-100 hover:bg-emerald-100 text-gray-600 hover:text-emerald-600 text-sm font-bold flex items-center justify-center transition">+</button>
                  </div>
                </div>`).join('')}
            </div>`;
        }

        function adjustVariantStock(pid, variant, delta, btn) {
            const grid = btn.closest('[id^="variant-grid-"]');
            const input = grid?.querySelector(`[data-variant="${variant}"]`);
            const cur = parseInt(input?.value) || 0;
            const next = Math.max(0, cur + delta);
            if (input) input.value = next;
            promptSetVariantStock(pid, variant, next, input);
        }

        function setVariantStock(pid, variant, value, reason) {
            const qty = value === '' ? 0 : parseInt(value) || 0;
            fetch('/api/products/' + pid + '/variant-stock', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ variant, qty, reason: reason || 'Manual edit' })
            })
            .then(r => r.json())
            .then(data => {
                if (data.success) {
                    // update local cache
                    const p = stockCache.find(p => p.id === pid);
                    if (p) {
                        if (!p.variantStock) p.variantStock = {};
                        p.variantStock[variant] = qty;
                        p.stock = data.product.stock;
                        // Also sync rich variant array
                        if (Array.isArray(p.variants) && p.variants.length && typeof p.variants[0] === 'object') {
                            const rv = p.variants.find(v => v.color === variant);
                            if (rv) rv.stock = qty;
                        }
                    }
                    showToast('Variant stock updated ✓');
                    renderStock();
                    // re-render the open variant grid
                    const openRow = document.getElementById('variant-row-' + pid);
                    if (openRow && !openRow.classList.contains('hidden')) renderVariantGrid(stockCache.find(p => p.id === pid));
                } else showToast(data.message || 'Could not update.', true);
            })
            .catch(() => showToast('Network error.', true));
        }

        function downloadCurrentStock() {
            fetch('/api/products')
                .then(r => r.json())
                .then(prods => {
                    const rows = [['Product', 'Category', 'Price (GHS)', 'Stock', 'Status']];
                    prods.forEach(p => {
                        const status = p.isSoldOut ? 'Sold Out'
                                     : p.stock === null || p.stock === undefined ? 'Untracked'
                                     : p.stock === 0 ? 'Out of Stock'
                                     : 'In Stock';
                        rows.push([p.name, p.category || '', parseFloat(p.price).toFixed(2), p.stock ?? '', status]);
                    });
                    triggerCSV(rows, 'stock-' + new Date().toISOString().slice(0, 10) + '.csv');
                })
                .catch(() => showToast('Could not load products.', true));
        }

        function downloadMonthlyStock() {
            const picker = document.getElementById('stock-month-picker');
            const month  = picker?.value;
            if (!month) return showToast('Pick a month first.', true);

            Promise.all([fetch('/api/products').then(r => r.json()), fetch('/api/orders').then(r => r.json())])
                .then(([prods, orders]) => {
                    // Filter orders in the selected month
                    const monthOrders = orders.filter(o => {
                        const d = o.paidAt || o.createdAt;
                        return d && (d.slice ? d.slice(0, 7) : new Date(d).toISOString().slice(0, 7)) === month;
                    });

                    // Tally units sold and revenue per product name
                    const sales = {};
                    monthOrders.forEach(o => {
                        (o.items || []).forEach(item => {
                            const key = item.name;
                            if (!sales[key]) sales[key] = { units: 0, revenue: 0 };
                            sales[key].units   += parseInt(item.quantity) || 1;
                            sales[key].revenue += (parseFloat(item.price) || 0) * (parseInt(item.quantity) || 1);
                        });
                    });

                    const label = new Date(month + '-01').toLocaleString('en-GH', { month: 'long', year: 'numeric' });
                    const rows  = [['Product', 'Category', 'Price (GHS)', 'Units Sold — ' + label, 'Revenue — ' + label, 'Current Stock', 'Status']];
                    prods.forEach(p => {
                        const s = sales[p.name] || { units: 0, revenue: 0 };
                        const status = p.isSoldOut ? 'Sold Out' : p.stock === null || p.stock === undefined ? 'Untracked' : p.stock === 0 ? 'Out of Stock' : 'In Stock';
                        rows.push([p.name, p.category || '', parseFloat(p.price).toFixed(2), s.units, s.revenue.toFixed(2), p.stock ?? '', status]);
                    });
                    triggerCSV(rows, 'stock-' + month + '.csv');
                })
                .catch(() => showToast('Could not load data.', true));
        }

        function triggerCSV(rows, filename) {
            const csv = rows.map(r => r.map(v => '"' + String(v).replace(/"/g, '""') + '"').join(',')).join('\n');
            const a   = document.createElement('a');
            a.href     = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
            a.download = filename;
            a.click();
        }

        // ── STOCK INTAKES ────────────────────────────────────────────────────
        let intakesCache = [];

        function openIntakeModal() {
            document.getElementById('intake-supplier').value = '';
            document.getElementById('intake-notes').value = '';
            document.getElementById('intake-date').value = new Date().toISOString().slice(0, 10);
            document.getElementById('intake-lines').innerHTML = '';
            addIntakeLine();
            const m = document.getElementById('intake-modal');
            m.classList.remove('hidden');
            m.style.display = 'flex';
        }

        function closeIntakeModal() {
            const m = document.getElementById('intake-modal');
            m.style.display = 'none';
            m.classList.add('hidden');
        }

        function addIntakeLine() {
            const container = document.getElementById('intake-lines');
            const div = document.createElement('div');
            div.setAttribute('data-intake-line', '');
            div.className = 'flex gap-2 items-start bg-gray-50 rounded-xl p-2.5';

            // Build product options from stockCache
            const opts = stockCache.map(p => `<option value="${escAdm(p.id)}">${escAdm(p.name)}</option>`).join('');

            div.innerHTML = `
              <div class="flex-1 space-y-1.5">
                <select class="intake-prod-sel w-full border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-orange-300" onchange="onIntakeProdChange(this)">
                  <option value="">— select product —</option>
                  ${opts}
                </select>
                <select class="intake-variant-sel w-full border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-orange-300 hidden">
                  <option value="">All variants (total stock)</option>
                </select>
              </div>
              <input type="number" min="1" value="1" placeholder="Qty"
                class="intake-qty w-20 border border-gray-200 rounded-lg px-2 py-1.5 text-xs text-center focus:outline-none focus:ring-2 focus:ring-orange-300 flex-shrink-0"/>
              <button onclick="this.closest('[data-intake-line]').remove()" class="text-gray-300 hover:text-red-400 text-xl leading-none mt-0.5 flex-shrink-0 transition-colors">×</button>`;
            container.appendChild(div);
        }

        function onIntakeProdChange(sel) {
            const line = sel.closest('[data-intake-line]');
            const variantSel = line.querySelector('.intake-variant-sel');
            const pid = sel.value;
            if (!pid) { variantSel.classList.add('hidden'); return; }
            const p = stockCache.find(p => p.id === pid);
            if (!p) { variantSel.classList.add('hidden'); return; }
            const colors = variantColors(p.variants);
            const sizes  = p.sizes && p.sizes.length ? p.sizes : [];
            if (!colors.length && !sizes.length) { variantSel.classList.add('hidden'); return; }
            const pairs = colors.length && sizes.length
                ? colors.flatMap(c => sizes.map(s => ({ key: `${c}-${s}`, label: `${c} / ${s}` })))
                : colors.length ? colors.map(c => ({ key: c, label: c }))
                : sizes.map(s => ({ key: s, label: s }));
            variantSel.innerHTML = '<option value="">All variants (total stock)</option>' +
                pairs.map(r => `<option value="${escAdm(r.key)}">${escAdm(r.label)}</option>`).join('');
            variantSel.classList.remove('hidden');
        }

        async function submitIntake() {
            const supplier = document.getElementById('intake-supplier').value.trim();
            const date     = document.getElementById('intake-date').value;
            const notes    = document.getElementById('intake-notes').value.trim();
            const lineDivs = document.querySelectorAll('#intake-lines [data-intake-line]');

            const lines = [];
            let valid = true;
            lineDivs.forEach(div => {
                const prodSel    = div.querySelector('.intake-prod-sel');
                const variantSel = div.querySelector('.intake-variant-sel');
                const qtyInput   = div.querySelector('.intake-qty');
                const pid = prodSel?.value;
                const qty = parseInt(qtyInput?.value) || 0;
                if (!pid || qty <= 0) { valid = false; return; }
                const p = stockCache.find(p => p.id === pid);
                lines.push({ productId: pid, productName: p?.name || '', variant: variantSel?.value || null, qty });
            });

            if (!valid || !lines.length) { showToast('Fill in all line items with a product and quantity > 0.', true); return; }

            const btn = document.querySelector('#intake-modal button[onclick="submitIntake()"]');
            if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }

            try {
                const res  = await fetch('/api/stock-intakes', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ supplier, date: date ? new Date(date).toISOString() : new Date().toISOString(), notes, lines })
                });
                const data = await res.json();
                if (data.success) {
                    closeIntakeModal();
                    showToast('Intake logged ✓');
                    loadStock();
                    loadIntakes();
                } else {
                    showToast(data.message || 'Could not save intake.', true);
                }
            } catch {
                showToast('Network error.', true);
            } finally {
                if (btn) { btn.disabled = false; btn.textContent = 'Save Intake'; }
            }
        }

        function loadIntakes() {
            const body = document.getElementById('intake-history-body');
            if (!body) return;
            body.innerHTML = '<div class="p-6 text-xs text-gray-400 text-center">Loading…</div>';
            fetch('/api/stock-intakes')
                .then(r => r.json())
                .then(items => { intakesCache = items; renderIntakes(); })
                .catch(() => { if (body) body.innerHTML = '<div class="p-6 text-xs text-red-400 text-center">Could not load intakes.</div>'; });
        }

        function renderIntakes() {
            const body = document.getElementById('intake-history-body');
            if (!body) return;
            if (!intakesCache.length) {
                body.innerHTML = '<div class="p-6 text-xs text-gray-400 text-center">No intakes logged yet. Click "+ Log Intake" to record your first restock.</div>';
                return;
            }
            body.innerHTML = `
              <table class="w-full text-xs">
                <thead><tr class="border-b border-gray-100">
                  <th class="text-left py-2 px-4 font-bold text-gray-400 uppercase tracking-wider text-[10px]">Date</th>
                  <th class="text-left py-2 px-4 font-bold text-gray-400 uppercase tracking-wider text-[10px]">Supplier</th>
                  <th class="text-left py-2 px-4 font-bold text-gray-400 uppercase tracking-wider text-[10px]">Items</th>
                  <th class="text-right py-2 px-4 font-bold text-gray-400 uppercase tracking-wider text-[10px]">Units</th>
                  <th class="py-2 px-4"></th>
                </tr></thead>
                <tbody>
                  ${intakesCache.map(intake => {
                    const dateStr = new Date(intake.date || intake.createdAt).toLocaleDateString('en-GH', { dateStyle: 'medium' });
                    const totalUnits = (intake.lines || []).reduce((s, l) => s + (parseInt(l.qty) || 0), 0);
                    const itemNames = (intake.lines || []).map(l => escAdm(l.productName || l.productId)).join(', ');
                    return `<tr class="border-b border-gray-50 hover:bg-gray-50/60 transition">
                      <td class="py-2.5 px-4 text-gray-600 font-medium whitespace-nowrap">${dateStr}</td>
                      <td class="py-2.5 px-4 text-gray-500">${escAdm(intake.supplier || '—')}</td>
                      <td class="py-2.5 px-4 text-gray-500 max-w-xs truncate">${itemNames || '—'}</td>
                      <td class="py-2.5 px-4 text-right font-bold text-gray-700">+${totalUnits}</td>
                      <td class="py-2.5 px-4 text-right">
                        <button onclick="deleteIntake('${escAdm(intake.id)}')" class="text-gray-300 hover:text-red-500 transition text-sm font-bold leading-none" title="Delete intake">×</button>
                      </td>
                    </tr>
                    ${intake.notes ? `<tr class="border-b border-gray-50"><td colspan="5" class="pb-2.5 px-4 text-[10px] text-gray-400 italic">${escAdm(intake.notes)}</td></tr>` : ''}`;
                  }).join('')}
                </tbody>
              </table>`;
        }

        function deleteIntake(id) {
            requireAdminConfirm(
                'Delete Intake',
                'This will remove the intake record. Note: stock levels will not be rolled back automatically.',
                () => {
                    fetch('/api/stock-intakes/' + id, { method: 'DELETE' })
                        .then(r => r.json())
                        .then(d => {
                            if (d.success) { intakesCache = intakesCache.filter(i => i.id !== id); renderIntakes(); showToast('Intake deleted.'); }
                            else showToast(d.message || 'Could not delete.', true);
                        })
                        .catch(() => showToast('Network error.', true));
                }
            );
        }

        // ── STOCK INTERNAL TABS ──────────────────────────────────────────────
        let invMetaCache = {};
        let activeStockTab = 'overview';

        function switchStockTab(tab) {
            activeStockTab = tab;
            ['overview','costing','lowstock','movements','reports'].forEach(t => {
                const panel = document.getElementById('stock-tab-' + t);
                const btn   = document.getElementById('stab-' + t);
                if (panel) panel.classList.toggle('hidden', t !== tab);
                if (btn)   btn.classList.toggle('active', t === tab);
            });
            if (tab === 'costing')   renderCostPricing();
            if (tab === 'lowstock')  renderLowStock();
            if (tab === 'movements') loadMovements();
            if (tab === 'reports')   renderStockReports();
        }

        function loadStock() {
            const picker = document.getElementById('stock-month-picker');
            if (picker && !picker.value) picker.value = new Date().toISOString().slice(0, 7);
            const tbody = document.getElementById('stock-table-body');
            if (tbody) tbody.innerHTML = '<tr><td colspan="8" class="text-center py-8 text-gray-400 text-xs">Loading…</td></tr>';
            Promise.all([
                fetch('/api/admin/all-products').then(r => r.json()),
                fetch('/api/inventory/meta').then(r => r.json()).catch(() => ({}))
            ]).then(([prods, meta]) => {
                stockCache  = prods;
                invMetaCache = meta || {};
                setStockFilter(stockFilter);
                if (activeStockTab !== 'overview') switchStockTab(activeStockTab);
                populateBaseProductDropdown();
            }).catch(() => showToast('Could not load stock data.', true));
        }

        // ── COST HELPERS ─────────────────────────────────────────────────────
        function calcInvSubtotal(m) {
            const actual   = parseFloat(m.actualCost) || 0;
            const ship     = (parseFloat(m.shippingTotal) || 0) / Math.max(parseInt(m.shippingUnits) || 1, 1);
            const tran     = (parseFloat(m.transportTotal) || 0) / Math.max(parseInt(m.transportUnits) || 1, 1);
            const other    = (m.otherExpenses || []).reduce((s, e) => s + (parseFloat(e.amount) || 0), 0);
            return actual + ship + tran + other;
        }
        function calcInvCost(m) {
            const actual = parseFloat(m.actualCost) || 0;
            const growth = parseFloat(m.growthMargin) || 0;
            const ship   = (parseFloat(m.shippingTotal) || 0) / Math.max(parseInt(m.shippingUnits) || 1, 1);
            const tran   = (parseFloat(m.transportTotal) || 0) / Math.max(parseInt(m.transportUnits) || 1, 1);
            const other  = (m.otherExpenses || []).reduce((s, e) => s + (parseFloat(e.amount) || 0), 0);
            // growth margin on actual cost only, then add expenses
            return actual * (1 + growth / 100) + ship + tran + other;
        }
        function calcInvRetail(m) {
            return calcInvCost(m) * (1 + (parseFloat(m.retailMarkup) || 0) / 100);
        }
        function fmtGH(n) { return 'GH₵' + Number(n).toLocaleString('en-GH', {minimumFractionDigits:2,maximumFractionDigits:2}); }

        // ── COST & PRICING TABLE ─────────────────────────────────────────────
        function renderCostPricing() {
            const tbody = document.getElementById('cost-table-body');
            if (!tbody || !stockCache.length) return;
            tbody.innerHTML = stockCache.map(p => {
                const m    = invMetaCache[p.id] || {};
                const cost = calcInvCost(m);
                const sell = parseFloat(p.price) || 0;
                const est  = calcInvRetail(m);
                const profit = sell - cost;
                const margin = sell > 0 ? (profit / sell * 100) : 0;
                const hasCost = cost > 0;
                const diffBadge = hasCost && Math.abs(est - sell) > 0.01
                    ? `<span class="text-[9px] font-bold px-1 py-0.5 rounded bg-amber-100 text-amber-700 ml-1">custom</span>` : '';
                return `<tr class="hover:bg-gray-50/60 transition">
                  <td class="py-3 px-4">
                    <div class="flex items-center gap-2">
                      <img src="${escAdm(p.image||'')}" style="width:28px;height:28px;object-fit:cover;border-radius:6px;flex-shrink:0" onerror="this.style.display='none'"/>
                      <div>
                        <p class="text-sm font-semibold text-gray-800">${escAdm(p.name)}</p>
                        <p class="text-[10px] text-gray-400">${escAdm(p.category||'—')}</p>
                      </div>
                    </div>
                  </td>
                  <td class="py-3 px-4 text-right text-xs font-semibold ${hasCost?'text-gray-700':'text-gray-300'}">${hasCost ? fmtGH(cost) : '—'}</td>
                  <td class="py-3 px-4 text-right text-xs text-gray-500">${m.retailMarkup ? m.retailMarkup+'%' : '—'}</td>
                  <td class="py-3 px-4 text-right text-xs text-gray-500">${hasCost ? fmtGH(est) : '—'}</td>
                  <td class="py-3 px-4 text-right text-xs font-semibold text-gray-700">${fmtGH(sell)}${diffBadge}</td>
                  <td class="py-3 px-4 text-right text-xs font-bold ${profit>=0?'text-emerald-600':'text-red-600'}">${hasCost ? fmtGH(profit) : '—'}</td>
                  <td class="py-3 px-4 text-right text-xs font-bold ${margin>=0?'text-emerald-600':'text-red-600'}">${hasCost ? margin.toFixed(1)+'%' : '—'}</td>
                  <td class="py-3 px-4 text-center" style="white-space:nowrap">
                    <button onclick="openCostModal('${escAdm(p.id)}')" class="text-xs font-bold px-3 py-1.5 rounded-lg border border-gray-200 hover:border-orange-400 hover:text-orange-500 transition">Edit</button>
                    <button onclick="cloneProduct('${escAdmJsAttr(p.id)}')" class="text-xs font-bold px-3 py-1.5 rounded-lg border border-gray-200 hover:border-orange-400 hover:text-orange-500 transition ml-1">Duplicate</button>
                    <button onclick="deleteBaseProduct('${escAdm(p.id)}')" class="text-xs font-bold px-3 py-1.5 rounded-lg border border-gray-200 hover:border-rose-400 hover:text-rose-500 transition ml-1">Delete</button>
                  </td>
                </tr>`;
            }).join('');
        }

        // ── LOW STOCK TAB ────────────────────────────────────────────────────
        function renderLowStock() {
            const threshold = parseInt(document.getElementById('set-stock-threshold')?.value) || 3;
            const out = stockCache.filter(p => (p.isSoldOut || p.stock === 0) && p.stock !== null && p.stock !== undefined);
            const low = stockCache.filter(p => !p.isSoldOut && p.stock > 0 && p.stock <= threshold);
            const badge = document.getElementById('lowstock-badge');
            const total = out.length + low.length;
            if (badge) { badge.textContent = total; badge.classList.toggle('hidden', total === 0); }
            const mkSection = (items, title, bg, tc) => {
                if (!items.length) return '';
                return `<div class="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden mb-4">
                  <div class="px-6 py-3 border-b border-gray-100 ${bg} flex items-center gap-2">
                    <span class="text-sm font-bold ${tc}">${title}</span>
                    <span class="text-xs font-bold px-2 py-0.5 rounded-full bg-white/60 ${tc}">${items.length}</span>
                  </div>
                  <table class="w-full text-sm"><thead class="bg-gray-50"><tr>
                    ${['Product','Category','Stock','Supplier',''].map(h=>`<th class="py-2 px-4 text-left text-[10px] font-bold text-gray-400 uppercase tracking-wider">${h}</th>`).join('')}
                  </tr></thead><tbody>
                  ${items.map(p => `<tr class="border-b border-gray-50 hover:bg-gray-50/60">
                    <td class="py-3 px-4 font-semibold text-gray-900 text-[13px]">${escAdm(p.name)}</td>
                    <td class="py-3 px-4 text-xs text-gray-400">${escAdm(p.category||'—')}</td>
                    <td class="py-3 px-4"><span class="font-bold text-sm ${p.stock===0?'text-red-600':'text-amber-600'}">${p.stock??'—'}</span></td>
                    <td class="py-3 px-4 text-xs text-gray-400">${escAdm((invMetaCache[p.id]||{}).supplier||'—')}</td>
                    <td class="py-3 px-4 text-right"><button onclick="openIntakeModal('${escAdm(p.id)}')" class="text-xs font-bold text-orange-500 hover:text-orange-700 border border-orange-200 hover:border-orange-400 px-3 py-1.5 rounded-lg transition">+ Restock</button></td>
                  </tr>`).join('')}
                  </tbody></table>
                </div>`;
            };
            const outHtml = mkSection(out, 'Out of Stock', 'bg-red-50', 'text-red-700');
            const lowHtml = mkSection(low, 'Low Stock', 'bg-amber-50', 'text-amber-700');
            document.getElementById('lowstock-out-section').innerHTML = outHtml;
            document.getElementById('lowstock-low-section').innerHTML = lowHtml;
            const okMsg = document.getElementById('lowstock-ok-msg');
            if (okMsg) okMsg.classList.toggle('hidden', total > 0);
        }

        // ── MOVEMENTS TAB ────────────────────────────────────────────────────
        function loadMovements() {
            const tbody = document.getElementById('movements-table-body');
            if (!tbody) return;
            tbody.innerHTML = '<tr><td colspan="5" class="text-center py-8 text-gray-400 text-xs">Loading…</td></tr>';
            fetch('/api/stock-movements?limit=100')
                .then(r => r.json())
                .then(data => {
                    const list = Array.isArray(data) ? data : (data.movements || []);
                    if (!list.length) { tbody.innerHTML = '<tr><td colspan="5" class="py-10 text-center text-xs text-gray-400">No movements recorded yet.</td></tr>'; return; }
                    const TYPE_BADGE = {
                        received: 'bg-emerald-100 text-emerald-700', sold: 'bg-blue-100 text-blue-700',
                        damaged:  'bg-red-100 text-red-700',         returned: 'bg-purple-100 text-purple-700',
                        adjusted: 'bg-gray-100 text-gray-600',       adjustment: 'bg-gray-100 text-gray-600'
                    };
                    tbody.innerHTML = list.map(m => {
                        const qty  = parseInt(m.qty) || 0;
                        const badge = TYPE_BADGE[m.type] || 'bg-gray-100 text-gray-600';
                        const ts   = m.createdAt || m.ts || Date.now();
                        return `<tr class="border-b border-gray-50 hover:bg-gray-50/60">
                          <td class="py-3 px-4 text-[13px] font-semibold text-gray-800">${escAdm(m.productName || m.name || '—')}</td>
                          <td class="py-3 px-4"><span class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold ${badge}">${escAdm(m.type||'—')}</span></td>
                          <td class="py-3 px-4 text-center font-bold text-sm ${qty>0?'text-emerald-600':'text-red-600'}">${qty>0?'+':''}${qty}</td>
                          <td class="py-3 px-4 text-xs text-gray-400">${escAdm(m.reason||'—')}</td>
                          <td class="py-3 px-4 text-xs text-gray-400 whitespace-nowrap">${relTime(ts)}</td>
                        </tr>`;
                    }).join('');
                })
                .catch(() => { if (tbody) tbody.innerHTML = '<tr><td colspan="5" class="py-8 text-center text-xs text-red-400">Could not load movements.</td></tr>'; });
        }

        // ── REPORTS TAB ──────────────────────────────────────────────────────
        function renderStockReports() {
            const costed = stockCache.filter(p => invMetaCache[p.id] && calcInvCost(invMetaCache[p.id]) > 0);
            const costVal  = stockCache.reduce((s, p) => { const m = invMetaCache[p.id]||{}; const c = calcInvCost(m); return s + (p.stock||0) * c; }, 0);
            const sellVal  = stockCache.reduce((s, p) => s + (p.stock||0) * (parseFloat(p.price)||0), 0);
            const profit   = sellVal - costVal;
            const margin   = sellVal > 0 ? (profit / sellVal * 100) : 0;
            const el = id => document.getElementById(id);
            if (el('rep-cost-val'))  el('rep-cost-val').textContent  = fmtGH(costVal);
            if (el('rep-sell-val'))  el('rep-sell-val').textContent  = fmtGH(sellVal);
            if (el('rep-profit'))  { el('rep-profit').textContent = fmtGH(profit); el('rep-profit').className = `text-2xl font-extrabold ${profit>=0?'text-emerald-600':'text-red-600'}`; }
            if (el('rep-margin'))    el('rep-margin').textContent   = `Actual sell − cost · ${margin.toFixed(1)}% margin`;
            if (el('rep-costed'))    el('rep-costed').textContent   = `${costed.length} / ${stockCache.length}`;
            loadRealizedProfit();
        }

        async function loadRealizedProfit() {
            const el = id => document.getElementById(id);
            try {
                const orders = await fetch('/api/orders').then(r => r.json());
                // Build a name → cost map for quick lookup
                const nameCostMap = {};
                stockCache.forEach(p => {
                    const mc = invMetaCache[p.id];
                    if (mc) nameCostMap[p.name.toLowerCase()] = calcInvCost(mc);
                });
                let totalRevenue = 0, totalCOGS = 0, matchedOrders = 0;
                orders.forEach(o => {
                    const received = parseFloat(o.total || 0);
                    totalRevenue += received;
                    let orderCOGS = 0;
                    (o.items || []).forEach(item => {
                        const costPerUnit = nameCostMap[item.name?.toLowerCase()] || 0;
                        orderCOGS += costPerUnit * (parseInt(item.quantity) || 1);
                    });
                    totalCOGS += orderCOGS;
                    if (orderCOGS > 0) matchedOrders++;
                });
                const realProfit = totalRevenue - totalCOGS;
                const realMargin = totalRevenue > 0 ? (realProfit / totalRevenue * 100) : 0;
                if (el('rep-realized-revenue')) el('rep-realized-revenue').textContent = fmtGH(totalRevenue);
                if (el('rep-realized-cogs'))    el('rep-realized-cogs').textContent    = fmtGH(totalCOGS);
                if (el('rep-realized-profit')) {
                    el('rep-realized-profit').textContent = fmtGH(realProfit);
                    el('rep-realized-profit').className = `text-xl font-extrabold ${realProfit>=0?'text-emerald-600':'text-red-600'}`;
                }
                if (el('rep-realized-margin')) el('rep-realized-margin').textContent = `${realMargin.toFixed(1)}% margin on received · ${orders.length} orders (${matchedOrders} with cost data)`;
                if (el('rep-realized-note'))   el('rep-realized-note').textContent   = matchedOrders < orders.length ? `${orders.length - matchedOrders} orders had no matching cost data — COGS may be understated.` : '';
            } catch {
                if (el('rep-realized-revenue')) el('rep-realized-revenue').textContent = 'N/A';
            }
        }

        function exportFullInventoryCSV() {
            const rows = [['Name','Category','SKU','Stock','Cost/unit','Sell Price','Profit/unit','Margin %','Supplier','Location']];
            stockCache.forEach(p => {
                const m = invMetaCache[p.id] || {};
                const cost = calcInvCost(m);
                const sell = parseFloat(p.price) || 0;
                const profit = sell - cost;
                const margin = sell > 0 ? (profit / sell * 100) : 0;
                rows.push([p.name, p.category||'', m.sku||'', p.stock??'', cost.toFixed(2), sell.toFixed(2), profit.toFixed(2), margin.toFixed(1)+'%', m.supplier||'', m.loc||'']);
            });
            dlCSV(rows, 'inventory-' + new Date().toISOString().slice(0,10) + '.csv');
        }

        function exportCostingCSV() {
            const rows = [['Name','Actual Cost','Shipping/u','Transport/u','Other/u','Growth %','Cost/unit','Markup %','Est.Retail','Actual Sell','Profit/u','Margin %']];
            stockCache.forEach(p => {
                const m = invMetaCache[p.id] || {};
                const ship = (parseFloat(m.shippingTotal)||0) / Math.max(parseInt(m.shippingUnits)||1,1);
                const tran = (parseFloat(m.transportTotal)||0) / Math.max(parseInt(m.transportUnits)||1,1);
                const other = (m.otherExpenses||[]).reduce((s,e)=>s+(parseFloat(e.amount)||0),0);
                const cost = calcInvCost(m);
                const sell = parseFloat(p.price)||0;
                const profit = sell - cost;
                const margin = sell > 0 ? (profit/sell*100) : 0;
                rows.push([p.name, m.actualCost||0, ship.toFixed(2), tran.toFixed(2), other.toFixed(2), m.growthMargin||0, cost.toFixed(2), m.retailMarkup||0, calcInvRetail(m).toFixed(2), sell.toFixed(2), profit.toFixed(2), margin.toFixed(1)+'%']);
            });
            dlCSV(rows, 'cost-pricing-' + new Date().toISOString().slice(0,10) + '.csv');
        }

        function exportLowStockCSV() {
            const threshold = parseInt(document.getElementById('set-stock-threshold')?.value) || 3;
            const items = stockCache.filter(p => p.stock !== null && p.stock !== undefined && p.stock <= threshold);
            const rows = [['Name','Category','Stock','Threshold','Supplier','Location']];
            items.forEach(p => {
                const m = invMetaCache[p.id] || {};
                rows.push([p.name, p.category||'', p.stock??'', threshold, m.supplier||'', m.loc||'']);
            });
            dlCSV(rows, 'low-stock-' + new Date().toISOString().slice(0,10) + '.csv');
        }

        function exportStockSnapshot() {
            showToast('Preparing stock snapshot…');
            // Always fetch fresh data — do not rely on cache
            Promise.all([
                fetch('/api/admin/all-products').then(r => r.json()),
                fetch('/api/inventory/meta').then(r => r.json()).catch(() => ({}))
            ]).then(function(results) {
                const prods = results[0];
                const meta  = results[1] || {};
                const now     = new Date();
                const dateStr = now.toISOString().slice(0, 10);
                const timeStr = now.toTimeString().slice(0, 5).replace(':', 'h');
                const threshold = parseInt(document.getElementById('set-stock-threshold')?.value) || 3;

                function stockStatus(stock) {
                    if (stock === null || stock === undefined || stock === '' || stock === '—') return 'Unlimited';
                    const n = parseInt(stock, 10);
                    if (isNaN(n)) return '—';
                    if (n === 0) return 'OUT OF STOCK';
                    if (n <= threshold) return 'LOW';
                    return 'In Stock';
                }

                const rows = [['Product', 'Category', 'Colour / Variant', 'Stock', 'Status', 'Sell Price (GH₵)', 'Supplier', 'SKU', 'Snapshot Date']];

                prods.forEach(function(p) {
                    const m = meta[p.id] || {};
                    const price = parseFloat(p.price).toFixed(2);
                    const snap  = [m.supplier || '', m.sku || '', dateStr + ' ' + timeStr];
                    const isRich   = Array.isArray(p.variants) && p.variants.length > 0 && p.variants[0] !== null && typeof p.variants[0] === 'object';
                    const isString = Array.isArray(p.variants) && p.variants.length > 0 && typeof p.variants[0] === 'string';

                    if (isRich) {
                        p.variants.forEach(function(v) {
                            const s = (v.stock !== undefined && v.stock !== null) ? parseInt(v.stock, 10) : null;
                            rows.push([p.name, p.category || '', v.color || '', s !== null && !isNaN(s) ? s : '—', stockStatus(s), price].concat(snap));
                        });
                    } else if (isString && p.variantStock && Object.keys(p.variantStock).length) {
                        p.variants.forEach(function(colourName) {
                            const s = p.variantStock[colourName] !== undefined ? parseInt(p.variantStock[colourName], 10) : null;
                            rows.push([p.name, p.category || '', colourName, s !== null && !isNaN(s) ? s : '—', stockStatus(s), price].concat(snap));
                        });
                    } else {
                        const s = (p.stock !== null && p.stock !== undefined && p.stock !== '') ? p.stock : null;
                        rows.push([p.name, p.category || '', '—', s !== null ? s : '—', stockStatus(s), price].concat(snap));
                    }
                });

                dlCSV(rows, 'stock-snapshot-' + dateStr + '-' + timeStr + '.csv');
                showToast('✓ Stock snapshot downloaded — ' + (rows.length - 1) + ' lines.');
            }).catch(function() {
                showToast('Failed to fetch stock data.', true);
            });
        }

        function dlCSV(rows, filename) {
            const csv = rows.map(r => r.map(v => '"' + String(v).replace(/"/g,'""') + '"').join(',')).join('\n');
            const a = document.createElement('a'); a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv); a.download = filename; a.click();
        }

        // ── COST MODAL ───────────────────────────────────────────────────────
        let _cmOtherRows = [];

        function openCostModal(pid) {
            const newMode = !pid;
            const newFields = document.getElementById('cm-new-fields');
            if (newFields) newFields.classList.toggle('hidden', !newMode);

            if (newMode) {
                document.getElementById('cm-pid').value = '';
                document.getElementById('cost-modal-title').textContent = 'New Base Product';
                document.getElementById('cost-modal-sub').textContent = 'Product will be saved as Sold Out — list it once ready.';
                const nameEl = document.getElementById('cm-new-name');
                if (nameEl) nameEl.value = '';
                const catSel = document.getElementById('cm-new-category');
                if (catSel) {
                    fetch('/api/categories')
                        .then(r => r.json())
                        .then(cats => {
                            const names = cats.filter(c => c.enabled !== false).map(c => c.name).sort();
                            catSel.innerHTML = '<option value="">— Select category —</option>' + names.map(c => `<option value="${escAdm(c)}">${escAdm(c)}</option>`).join('');
                        })
                        .catch(() => {
                            const fallback = [...new Set(stockCache.map(p => p.category).filter(Boolean))].sort();
                            catSel.innerHTML = '<option value="">— Select category —</option>' + fallback.map(c => `<option value="${escAdm(c)}">${escAdm(c)}</option>`).join('');
                        });
                }
                document.getElementById('cm-actual-cost').value = '';
                document.getElementById('cm-ship-total').value  = '';
                document.getElementById('cm-ship-units').value  = '';
                document.getElementById('cm-tran-total').value  = '';
                document.getElementById('cm-tran-units').value  = '';
                document.getElementById('cm-growth').value      = '10';
                document.getElementById('cm-markup').value      = '60';
                _cmOtherRows = [];
            } else {
                const p = stockCache.find(x => x.id === pid);
                if (!p) return;
                const m = invMetaCache[pid] || {};
                document.getElementById('cm-pid').value = pid;
                document.getElementById('cost-modal-title').textContent = 'Cost & Pricing';
                document.getElementById('cost-modal-sub').textContent   = p.name;
                document.getElementById('cm-actual-cost').value  = m.actualCost    || '';
                document.getElementById('cm-ship-total').value   = m.shippingTotal || '';
                document.getElementById('cm-ship-units').value   = m.shippingUnits || '';
                document.getElementById('cm-tran-total').value   = m.transportTotal || '';
                document.getElementById('cm-tran-units').value   = m.transportUnits || '';
                document.getElementById('cm-growth').value       = m.growthMargin   || '10';
                document.getElementById('cm-markup').value       = m.retailMarkup   || '60';
                _cmOtherRows = (m.otherExpenses || []).map(e => ({...e}));
            }
            renderCmOtherRows();
            cmRecalc();
            const modal = document.getElementById('cost-modal');
            modal.classList.remove('hidden'); modal.style.display = 'flex';
        }

        function closeCostModal() {
            const modal = document.getElementById('cost-modal');
            modal.style.display = 'none'; modal.classList.add('hidden');
        }

        function cmAddOther() {
            _cmOtherRows.push({ id: Date.now() + '', label: '', amount: '' });
            renderCmOtherRows();
        }

        function cmRemoveOther(i) {
            _cmOtherRows.splice(i, 1);
            renderCmOtherRows();
            cmRecalc();
        }

        function cmUpdateOther(i, key, val) {
            _cmOtherRows[i][key] = val;
            cmRecalc();
        }

        function renderCmOtherRows() {
            const container = document.getElementById('cm-other-rows');
            if (!container) return;
            if (!_cmOtherRows.length) { container.innerHTML = '<p class="text-xs text-gray-300 italic py-1">No other expenses. Add duty, packaging, handling…</p>'; return; }
            container.innerHTML = _cmOtherRows.map((e, i) => `
              <div class="flex gap-2 mb-2">
                <input placeholder="e.g. Duty, Packaging" value="${escAdm(e.label||'')}" oninput="cmUpdateOther(${i},'label',this.value)"
                  class="flex-1 px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-orange-300"/>
                <div class="relative w-28 flex-shrink-0">
                  <span class="absolute left-2.5 top-1/2 -translate-y-1/2 text-[10px] font-bold text-gray-400">GH₵</span>
                  <input type="number" min="0" step="0.01" value="${escAdm(e.amount||'')}" oninput="cmUpdateOther(${i},'amount',this.value)"
                    class="w-full pl-9 pr-2 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-orange-300"/>
                </div>
                <button onclick="cmRemoveOther(${i})" class="p-2 text-gray-300 hover:text-red-500 transition flex-shrink-0 text-lg leading-none">×</button>
              </div>`).join('');
        }

        function cmRecalc() {
            const m = {
                actualCost:    document.getElementById('cm-actual-cost')?.value || '',
                shippingTotal: document.getElementById('cm-ship-total')?.value  || '',
                shippingUnits: document.getElementById('cm-ship-units')?.value  || '',
                transportTotal:document.getElementById('cm-tran-total')?.value  || '',
                transportUnits:document.getElementById('cm-tran-units')?.value  || '',
                otherExpenses: _cmOtherRows,
                growthMargin:  document.getElementById('cm-growth')?.value      || '10',
                retailMarkup:  document.getElementById('cm-markup')?.value      || '60',
            };
            const ship = (parseFloat(m.shippingTotal)||0) / Math.max(parseInt(m.shippingUnits)||1,1);
            const tran = (parseFloat(m.transportTotal)||0) / Math.max(parseInt(m.transportUnits)||1,1);
            const el = id => document.getElementById(id);
            if (el('cm-ship-per')) el('cm-ship-per').textContent = '= GH₵' + ship.toFixed(2) + '/u';
            if (el('cm-tran-per')) el('cm-tran-per').textContent = '= GH₵' + tran.toFixed(2) + '/u';
            const cost   = calcInvCost(m);
            const retail = calcInvRetail(m);
            if (el('cm-cost-display')) el('cm-cost-display').textContent = fmtGH(cost);
            if (el('cm-retail-display')) el('cm-retail-display').textContent = '→ Est. Retail: ' + fmtGH(retail);
            // breakdown
            const breakdown = el('cm-cost-breakdown');
            if (breakdown && cost > 0) {
                const other = _cmOtherRows.reduce((s,e)=>s+(parseFloat(e.amount)||0),0);
                const actualAmt = parseFloat(m.actualCost) || 0;
                const growthAmt = actualAmt * ((parseFloat(m.growthMargin) || 0) / 100);
                breakdown.innerHTML = `<p>Actual: ${fmtGH(actualAmt)}</p><p>Growth (${m.growthMargin||0}%): +${fmtGH(growthAmt)}</p><p>Ship: +${fmtGH(ship)}/u</p><p>Transport: +${fmtGH(tran)}/u</p>${other>0?`<p>Other: +${fmtGH(other)}</p>`:''}`;
                breakdown.classList.remove('hidden');
            } else if (breakdown) breakdown.classList.add('hidden');
            // profit bar
            const pid  = el('cm-pid')?.value;
            const p    = pid ? stockCache.find(x => x.id === pid) : null;
            const sell = p ? parseFloat(p.price) || 0 : 0;
            const profitBar = el('cm-profit-bar');
            if (profitBar && sell > 0 && cost > 0) {
                const profit = sell - cost;
                const margin = sell > 0 ? (profit/sell*100) : 0;
                profitBar.classList.remove('hidden'); profitBar.style.display = 'flex';
                profitBar.className = `flex items-center justify-between px-4 py-3 rounded-xl ${profit>=0?'bg-emerald-50 border border-emerald-100':'bg-red-50 border border-red-100'}`;
                if (el('cm-profit-val'))     { el('cm-profit-val').textContent = fmtGH(profit); el('cm-profit-val').className = `text-xl font-extrabold ${profit>=0?'text-emerald-600':'text-red-600'}`; }
                if (el('cm-profit-formula')) el('cm-profit-formula').textContent = `${fmtGH(sell)} sell − ${fmtGH(cost)} cost`;
                if (el('cm-margin-val'))     { el('cm-margin-val').textContent = margin.toFixed(1)+'%'; el('cm-margin-val').className = `text-xl font-extrabold ${profit>=0?'text-emerald-600':'text-red-600'}`; }
            } else if (profitBar) { profitBar.classList.add('hidden'); profitBar.style.display = 'none'; }
        }

        async function saveCostMeta() {
            const pid     = document.getElementById('cm-pid')?.value;
            const newMode = !pid;
            const m = {
                actualCost:    document.getElementById('cm-actual-cost')?.value || '',
                shippingTotal: document.getElementById('cm-ship-total')?.value  || '',
                shippingUnits: document.getElementById('cm-ship-units')?.value  || '',
                transportTotal:document.getElementById('cm-tran-total')?.value  || '',
                transportUnits:document.getElementById('cm-tran-units')?.value  || '',
                otherExpenses: _cmOtherRows,
                growthMargin:  document.getElementById('cm-growth')?.value      || '10',
                retailMarkup:  document.getElementById('cm-markup')?.value      || '60',
                price: calcInvCost({ actualCost: document.getElementById('cm-actual-cost')?.value||'', shippingTotal: document.getElementById('cm-ship-total')?.value||'', shippingUnits: document.getElementById('cm-ship-units')?.value||'', transportTotal: document.getElementById('cm-tran-total')?.value||'', transportUnits: document.getElementById('cm-tran-units')?.value||'', otherExpenses: _cmOtherRows, growthMargin: document.getElementById('cm-growth')?.value||'10' }),
            };
            const btn = document.querySelector('#cost-modal button[onclick="saveCostMeta()"]');
            if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
            try {
                if (newMode) {
                    const name = (document.getElementById('cm-new-name')?.value || '').trim();
                    if (!name) { showToast('Product name is required.', true); return; }
                    const category = document.getElementById('cm-new-category')?.value || '';
                    const suggestedPrice = calcInvRetail(m);
                    // Create the product first
                    const createRes = await fetch('/api/admin/products', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ name, category, price: suggestedPrice.toFixed(2), isSoldOut: true, isListed: false })
                    });
                    const createData = await createRes.json();
                    if (!createData.success || !createData.product) throw new Error(createData.message || 'Failed to create product');
                    const newProd = createData.product;
                    const newPid  = newProd.id;
                    // Save cost meta for the new product
                    const payload = { ...m };
                    await fetch('/api/inventory/meta/' + newPid, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
                    invMetaCache[newPid] = payload;
                    // Add to stock cache so it appears in lists immediately
                    stockCache.push(newProd);
                    productsCache.unshift(newProd);
                    closeCostModal();
                    showToast(`Base product "${name}" created ✓ — go to Products to add images and publish.`);
                    populateBaseProductDropdown();
                    if (activeStockTab === 'costing')  renderCostPricing();
                    if (activeStockTab === 'reports')  renderStockReports();
                } else {
                    const existing = invMetaCache[pid] || {};
                    const payload = { ...existing, ...m };
                    const res = await fetch('/api/inventory/meta/' + pid, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
                    const data = await res.json();
                    if (!data.success) throw new Error(data.message || 'Save failed');
                    invMetaCache[pid] = payload;
                    closeCostModal();
                    showToast('Cost data saved ✓');
                    populateBaseProductDropdown();
                    if (activeStockTab === 'costing')  renderCostPricing();
                    if (activeStockTab === 'reports')  renderStockReports();
                    if (activeStockTab === 'overview') renderStock();
                }
            } catch(e) { showToast(e.message || 'Save failed', true); }
            finally { if (btn) { btn.disabled = false; btn.textContent = 'Save Cost Data'; } }
        }

        // Initialise first tab on stock section load
        document.addEventListener('DOMContentLoaded', () => {
            setTimeout(() => switchStockTab('overview'), 100);
        });

        // ── MANUAL INVOICE ───────────────────────────────────────────────────
        let invoiceProductsCache = [];

        function loadInvoiceTab() {
            fetch('/api/admin/next-invoice-num')
                .then(r => r.json())
                .then(d => { const el = document.getElementById('inv-number'); if (el && !el.dataset.touched) el.value = d.next; })
                .catch(() => {});
            fetch('/api/products')
                .then(r => r.json())
                .then(prods => {
                    invoiceProductsCache = prods;
                    // Rebuild any existing rows' dropdowns
                    document.querySelectorAll('#inv-rows tr').forEach(tr => {
                        const sel = tr.querySelector('.inv-prod-select');
                        if (sel) populateProductSelect(sel);
                    });
                })
                .catch(() => {});
            const tbody = document.getElementById('inv-rows');
            if (!tbody.children.length) addInvoiceRow();
            const rctTbody = document.getElementById('rct-rows');
            if (rctTbody && !rctTbody.children.length) addReceiptRow();
        }

        function populateProductSelect(sel) {
            const current = sel.value;
            // Group by category
            const groups = {};
            invoiceProductsCache.forEach(p => {
                const cat = p.category || 'Other';
                if (!groups[cat]) groups[cat] = [];
                groups[cat].push(p);
            });
            sel.innerHTML = '<option value="">— select product or type below —</option>';
            Object.keys(groups).sort().forEach(cat => {
                const og = document.createElement('optgroup');
                og.label = cat;
                groups[cat].forEach(p => {
                    const opt = document.createElement('option');
                    opt.value = p.id;
                    opt.textContent = p.name + ' — GH₵' + parseFloat(p.price).toFixed(2);
                    og.appendChild(opt);
                });
                sel.appendChild(og);
            });
            if (current) sel.value = current;
        }

        function addInvoiceRow() {
            const tbody = document.getElementById('inv-rows');
            const tr = document.createElement('tr');
            tr.className = 'border-b border-gray-50 align-top';
            tr.innerHTML = `
                <td class="py-2 pr-2" style="min-width:220px">
                    <select class="inv-prod-select w-full border border-gray-200 rounded-lg px-2 py-1.5 text-xs text-gray-600 focus:outline-none focus:ring-2 focus:ring-orange-300 mb-1.5" onchange="onInvProductSelect(this)">
                        <option value="">— select product or type below —</option>
                    </select>
                    <div class="flex gap-1.5 mb-1 inv-variant-row hidden">
                        <select class="inv-color-sel flex-1 border border-orange-200 rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-orange-300" onchange="onInvVariantChange(this)">
                            <option value="">Colour…</option>
                        </select>
                        <select class="inv-size-sel flex-1 border border-orange-200 rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-orange-300" onchange="onInvVariantChange(this)">
                            <option value="">Size…</option>
                        </select>
                    </div>
                    <span class="inv-stock-info text-xs hidden block mb-1.5"></span>
                    <input type="text" class="inv-desc w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-300" placeholder="or type description…" oninput="updateInvoiceTotals()"/>
                </td>
                <td class="py-2 px-2" style="width:120px">
                    <input type="number" class="inv-price w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm text-right focus:outline-none focus:ring-2 focus:ring-orange-300" min="0" step="0.01" placeholder="0.00" oninput="updateInvoiceTotals()"/>
                </td>
                <td class="py-2 px-2" style="width:70px">
                    <input type="number" class="inv-qty w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm text-center focus:outline-none focus:ring-2 focus:ring-orange-300" min="1" step="1" value="1" oninput="clampInvQty(this);updateInvoiceTotals()"/>
                </td>
                <td class="py-2 px-2 text-right text-sm font-semibold text-gray-700 row-subtotal whitespace-nowrap" style="width:100px">GH₵0.00</td>
                <td class="py-2 pl-1 text-center" style="width:32px">
                    <button onclick="removeInvoiceRow(this)" class="text-gray-300 hover:text-red-400 text-xl leading-none transition-colors">×</button>
                </td>`;
            tbody.appendChild(tr);
            populateProductSelect(tr.querySelector('.inv-prod-select'));
            updateInvoiceTotals();
        }

        function onInvProductSelect(sel) {
            const tr = sel.closest('tr');
            const pid = sel.value;
            const descInput   = tr.querySelector('.inv-desc');
            const priceInput  = tr.querySelector('.inv-price');
            const variantRow  = tr.querySelector('.inv-variant-row');
            const colorSel    = tr.querySelector('.inv-color-sel');
            const sizeSel     = tr.querySelector('.inv-size-sel');

            if (!pid) {
                variantRow.classList.add('hidden');
                const qi = tr.querySelector('.inv-qty');
                if (qi) { qi.removeAttribute('max'); qi.disabled = false; }
                const si = tr.querySelector('.inv-stock-info');
                if (si) si.className = 'inv-stock-info text-xs hidden block mb-1.5';
                return;
            }
            const prod = invoiceProductsCache.find(p => p.id === pid);
            if (!prod) return;

            descInput.value  = prod.name;
            priceInput.value = parseFloat(prod.price).toFixed(2);

            const hasColors = prod.variants && prod.variants.length > 0;
            const hasSizes  = prod.sizes    && prod.sizes.length    > 0;

            if (hasColors || hasSizes) {
                variantRow.classList.remove('hidden');
                colorSel.innerHTML = '<option value="">Colour…</option>';
                if (hasColors) {
                    variantColors(prod.variants).forEach(cn => {
                        colorSel.innerHTML += `<option value="${escAdm(cn)}">${escAdm(cn)}</option>`;
                    });
                    // Auto-select first variant that has stock; fall back to first colour
                    const isRich = Array.isArray(prod.variants) && prod.variants.length && typeof prod.variants[0] === 'object';
                    const firstWithStock = isRich ? prod.variants.find(v => (v.stock || 0) > 0) : null;
                    const autoColor = firstWithStock ? vColor(firstWithStock) : variantColors(prod.variants)[0];
                    if (autoColor) colorSel.value = autoColor;
                    colorSel.classList.remove('hidden');
                } else {
                    colorSel.classList.add('hidden');
                }
                sizeSel.innerHTML = '<option value="">Size…</option>';
                if (hasSizes) {
                    prod.sizes.forEach(s => sizeSel.innerHTML += `<option>${escAdm(s)}</option>`);
                    sizeSel.classList.remove('hidden');
                } else {
                    sizeSel.classList.add('hidden');
                }
            } else {
                variantRow.classList.add('hidden');
            }
            onInvVariantChange(colorSel);
            updateInvoiceTotals();
        }

        function onInvVariantChange(el) {
            const tr        = el.closest('tr');
            const prod      = invoiceProductsCache.find(p => p.id === tr.querySelector('.inv-prod-select').value);
            if (!prod) return;
            const descInput  = tr.querySelector('.inv-desc');
            const color      = tr.querySelector('.inv-color-sel').value;
            const size       = tr.querySelector('.inv-size-sel').value;
            const parts      = [prod.name, color, size].filter(Boolean);
            descInput.value  = parts.join(' — ');

            const stockInfo = tr.querySelector('.inv-stock-info');
            const qtyInput  = tr.querySelector('.inv-qty');
            const isRich = Array.isArray(prod.variants) && prod.variants.length && typeof prod.variants[0] === 'object';

            let avail = null; // null = unlimited
            if (isRich && color) {
                const v = prod.variants.find(v => v.color === color);
                if (v && typeof v.stock === 'number') avail = v.stock;
            } else if (!isRich && typeof prod.stock === 'number') {
                avail = prod.stock;
            }

            // Update qty max and clamp current value
            if (qtyInput) {
                if (avail !== null) {
                    qtyInput.max = avail;
                    if (avail === 0) { qtyInput.value = 0; qtyInput.disabled = true; }
                    else { qtyInput.disabled = false; if (parseInt(qtyInput.value) > avail) qtyInput.value = avail; }
                } else {
                    qtyInput.removeAttribute('max');
                    qtyInput.disabled = false;
                }
            }

            // Update stock badge
            if (stockInfo) {
                if (avail === null) {
                    stockInfo.className = 'inv-stock-info text-xs hidden block mb-1.5';
                } else if (avail === 0) {
                    stockInfo.textContent = 'Out of stock';
                    stockInfo.className = 'inv-stock-info text-xs block mb-1.5 text-red-500 font-semibold';
                } else {
                    stockInfo.textContent = avail + ' in stock';
                    stockInfo.className = 'inv-stock-info text-xs block mb-1.5 text-green-600';
                }
            }

            updateInvoiceTotals();
        }

        function clampInvQty(input) {
            const max = parseInt(input.max);
            if (!isNaN(max)) {
                const val = parseInt(input.value) || 1;
                if (val > max) input.value = max;
                if (val < 1)   input.value = 1;
            }
        }

        function removeInvoiceRow(btn) {
            const tbody = document.getElementById('inv-rows');
            if (tbody.children.length <= 1) return;
            btn.closest('tr').remove();
            updateInvoiceTotals();
        }

        let discountIsPercent = false;
        let rctDiscountIsPercent = false;

        function toggleDiscountType() {
            discountIsPercent = !discountIsPercent;
            const btn = document.getElementById('inv-discount-type');
            if (btn) btn.textContent = discountIsPercent ? '%' : 'GH₵';
            updateInvoiceTotals();
        }

        function toggleRctDiscountType() {
            rctDiscountIsPercent = !rctDiscountIsPercent;
            const btn = document.getElementById('rct-discount-type');
            if (btn) btn.textContent = rctDiscountIsPercent ? '%' : 'GH₵';
            updateReceiptTotals();
        }

        function getDiscountAmount(subtotal) {
            const raw = parseFloat(document.getElementById('inv-discount')?.value) || 0;
            if (discountIsPercent) return subtotal * Math.min(raw, 100) / 100;
            return raw;
        }

        function updateInvoiceTotals() {
            let subtotal = 0;
            document.querySelectorAll('#inv-rows tr').forEach(tr => {
                const price  = parseFloat(tr.querySelector('.inv-price')?.value) || 0;
                const qty    = parseInt(tr.querySelector('.inv-qty')?.value)     || 1;
                const rowSub = price * qty;
                subtotal += rowSub;
                tr.querySelector('.row-subtotal').textContent = 'GH₵' + rowSub.toFixed(2);
            });
            const delivery = parseFloat(document.getElementById('inv-delivery')?.value) || 0;
            const discount = getDiscountAmount(subtotal);
            const total    = Math.max(0, subtotal + delivery - discount);
            document.getElementById('inv-subtotal-display').textContent = 'GH₵' + subtotal.toFixed(2);
            document.getElementById('inv-delivery-display').textContent = 'GH₵' + delivery.toFixed(2);
            document.getElementById('inv-discount-display').textContent = '−GH₵' + discount.toFixed(2);
            document.getElementById('inv-total-display').textContent    = 'GH₵' + total.toFixed(2);
            const vb = vatBreakdown(total);
            const vEl = document.getElementById('inv-vat-display');
            if (vEl) vEl.textContent = 'GH₵' + (vb.inclusiveTotal - vb.base).toFixed(2);
        }

        // ── PDF / PRINT HELPERS ─────────────────────────────────────────────
        function getStoreName() {
            return document.getElementById('set-store-name')?.value?.trim() || 'Freeman Outlet';
        }

        // Ghana VAT (from 1 Jan 2026): VAT 15% + NHIL 2.5% + GETFund 2.5% = 20% on the
        // VAT-exclusive amount; document totals are VAT-inclusive. Mirrors server.js.
        function vatBreakdown(total) {
            const t = Math.round((parseFloat(total) || 0) * 100) / 100;
            const base = Math.round(t / 1.2 * 100) / 100;
            const parts = [['VAT', 15], ['NHIL', 2.5], ['GETFund Levy', 2.5]].map(p => ({ label: p[0], rate: p[1], amount: Math.round(base * p[1]) / 100 }));
            const drift = Math.round((t - base - parts.reduce((s, p) => s + p.amount, 0)) * 100) / 100;
            parts[parts.length - 1].amount = Math.round((parts[parts.length - 1].amount + drift) * 100) / 100;
            return { inclusiveTotal: t, base, parts, totalRate: 20 };
        }

        function generateDocHtml(order, docType) {
            const storeName    = getStoreName();
            const isInvoice    = docType !== 'receipt';
            const docLabel     = isInvoice ? 'Invoice' : 'Receipt';
            const dateStr      = new Date(order.paidAt || Date.now()).toLocaleDateString('en-GH', { day: 'numeric', month: 'long', year: 'numeric' });
            const subtotal     = parseFloat(order.subtotal || order.total || 0);
            const delivery     = parseFloat(order.deliveryPrice || 0);
            const discount     = parseFloat(order.promoDiscount || 0);
            const total        = parseFloat(order.total) || Math.max(0, subtotal + delivery - discount);
            const showVat      = isInvoice || order.paymentStatus === 'manual' || order.vatInclusive === true;
            const vat          = showVat ? (order.vat || vatBreakdown(total)) : null;
            const tin          = document.getElementById('set-inv-tin')?.value?.trim() || '';
            const acctName     = document.getElementById('set-inv-account-name')?.value?.trim() || '';
            const acctNo       = document.getElementById('set-inv-account-no')?.value?.trim()   || '';
            const instagram    = document.getElementById('set-instagram')?.value?.trim() || '';
            const tiktok       = document.getElementById('set-tiktok')?.value?.trim()    || '';
            const snapchat     = document.getElementById('set-snapchat')?.value?.trim()  || '';
            const waNum        = document.getElementById('set-whatsapp')?.value?.trim()  || '';
            const displayPhone = waNum ? (waNum.startsWith('233') ? '+' + waNum.replace(/(\d{3})(\d{2})(\d{3})(\d{4})/, '$1 $2 $3 $4') : waNum) : '';

            const itemRows = (order.items || []).map(i => {
                const qty   = parseInt(i.quantity || i.qty || 1);
                const price = parseFloat(i.price || 0);
                const line  = (qty * price).toFixed(2);
                const variant = [i.color, i.size].filter(Boolean).join(' / ');
                return `<tr>
                    <td style="padding:14px 0;border-bottom:1px solid #e8e8e8;font-size:14px;color:#222;">
                        ${escAdm(i.name || i.description || '')}
                        ${variant ? `<div style="font-size:11px;color:#999;margin-top:2px;">${escAdm(variant)}</div>` : ''}
                    </td>
                    <td style="padding:14px 16px;border-bottom:1px solid #e8e8e8;font-size:14px;color:#222;">GHS ${price.toFixed(0)}</td>
                    <td style="padding:14px 16px;border-bottom:1px solid #e8e8e8;font-size:14px;text-align:center;color:#222;">${qty}</td>
                    <td style="padding:14px 0;border-bottom:1px solid #e8e8e8;font-size:14px;text-align:right;color:#222;">GHS ${line}</td>
                </tr>`;
            }).join('');

            return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
            <title>${docLabel} ${order.id || ''} — ${storeName}</title>
            <link rel="preconnect" href="https://fonts.googleapis.com">
            <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
            <link href="https://fonts.googleapis.com/css2?family=Sacramento&family=Work+Sans:wght@400;600;700&display=swap" rel="stylesheet">
            <style>
                *{box-sizing:border-box;margin:0;padding:0}
                body{font-family:'Work Sans',sans-serif;background:#f5f5f3;color:#222;font-size:14px;line-height:1.6;min-height:100vh;display:flex;justify-content:center;align-items:flex-start;padding:32px 16px}
                @page{size:A4;margin:0}
                @media print{
                    body{background:#fff;padding:0;display:block}
                    .page{box-shadow:none;border-radius:0;max-width:100%;padding:40px 48px}
                    .no-print{display:none!important}
                    @page{margin:12mm}
                }
                .page{background:#fff;max-width:720px;width:100%;padding:52px 56px;box-shadow:0 4px 40px rgba(0,0,0,.10);border-radius:4px}
                .script-title{font-family:'Sacramento',cursive;font-size:72px;text-align:center;color:#111;margin-bottom:36px;line-height:1}
                .meta-row{display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:32px}
                .bill-label{font-size:13px;color:#888;margin-bottom:4px}
                .bill-name{font-size:15px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;color:#111}
                .inv-meta{text-align:right;font-size:14px;color:#222;line-height:2}
                .inv-meta span{font-weight:700}
                hr{border:none;border-top:1.5px solid #111;margin-bottom:28px}
                table{width:100%;border-collapse:collapse;margin-bottom:0}
                thead th{padding:0 0 14px;font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#111;border-bottom:1.5px solid #111}
                thead th:nth-child(2),thead th:nth-child(3){text-align:center}
                thead th:nth-child(4){text-align:right}
                .items-spacer{height:32px}
                .bottom-section{display:flex;justify-content:space-between;align-items:flex-start;margin-top:40px;padding-top:20px;border-top:1.5px solid #111}
                .payment-block{font-size:13px;color:#222;line-height:1.9}
                .payment-title{font-weight:700;font-size:14px;margin-bottom:6px}
                .totals-block{text-align:right;min-width:200px}
                .totals-row{display:flex;justify-content:space-between;gap:48px;font-size:13px;color:#444;margin-bottom:6px}
                .totals-label{font-weight:700;letter-spacing:.08em;text-transform:uppercase;font-size:12px}
                .vat-box{margin-top:14px;padding-top:10px;border-top:1px dashed #ccc}
                .vat-title{font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#888;margin-bottom:6px}
                .vat-box .totals-row{font-size:12px;color:#666;margin-bottom:3px}
                .totals-total{display:flex;justify-content:space-between;gap:48px;font-size:14px;font-weight:700;color:#111;margin-top:6px;padding-top:6px;border-top:1px solid #ccc}
                .footer{display:flex;justify-content:space-between;align-items:center;margin-top:40px;padding-top:24px;border-top:1px solid #e0e0e0}
                .footer-logo img{height:56px;width:auto}
                .footer-thankyou{font-family:'Sacramento',cursive;font-size:48px;color:#111;text-align:center}
                .footer-socials{text-align:right;font-size:12px;color:#444;line-height:2.2}
                .print-btn{position:fixed;bottom:24px;right:24px;background:#111;color:#fff;border:none;border-radius:10px;padding:11px 20px;font-size:13px;font-weight:700;cursor:pointer;letter-spacing:.04em;box-shadow:0 4px 16px rgba(0,0,0,.18)}
                .print-btn:hover{background:#333}
            </style></head><body>
            <div class="page">
                <div class="script-title">${docLabel}</div>

                <div class="meta-row">
                    <div>
                        <div class="bill-label">${isInvoice ? 'Invoice To' : 'Receipt For'} :</div>
                        <div class="bill-name">${escAdm(order.customer?.name || '—')}</div>
                        ${order.customer?.phone ? `<div style="font-size:12px;color:#888;margin-top:3px">${escAdm(order.customer.phone)}</div>` : ''}
                    </div>
                    <div class="inv-meta">
                        <div>${isInvoice ? 'Invoice' : 'Receipt'} No.: <span>${escAdm(String(order.id || ''))}</span></div>
                        ${!isInvoice && order.refInvoiceNo ? `<div>Ref. Invoice No.: <span>${escAdm(order.refInvoiceNo)}</span></div>` : ''}
                        <div>Date : <span>${dateStr}</span></div>
                        ${tin ? `<div>TIN : <span>${escAdm(tin)}</span></div>` : ''}
                        ${!isInvoice ? `<div>Payment : <span>${escAdm(order.paymentStatus || '')}</span></div>` : ''}
                    </div>
                </div>

                <hr>

                <table>
                    <thead><tr>
                        <th style="text-align:left">Description</th>
                        <th>Price</th>
                        <th>Qty</th>
                        <th style="text-align:right">Total</th>
                    </tr></thead>
                    <tbody>
                        <tr class="items-spacer"><td colspan="4"></td></tr>
                        ${itemRows}
                        <tr class="items-spacer"><td colspan="4"></td></tr>
                    </tbody>
                </table>

                <div class="bottom-section">
                    <div class="payment-block">
                        ${acctName || acctNo ? `
                        <div class="payment-title">Send Payment To :</div>
                        ${acctName ? `<div>Account Name : ${escAdm(acctName)}</div>` : ''}
                        ${acctNo   ? `<div>Account No : ${escAdm(acctNo)}</div>` : ''}
                        ` : ''}
                    </div>
                    <div class="totals-block">
                        <div class="totals-row"><span class="totals-label">Sub Total</span><span>GHS ${subtotal.toFixed(2)}</span></div>
                        ${delivery > 0 ? `<div class="totals-row"><span class="totals-label">Delivery</span><span>GHS ${delivery.toFixed(2)}</span></div>` : ''}
                        ${discount > 0 ? `<div class="totals-row"><span class="totals-label">Discount</span><span>−GHS ${discount.toFixed(2)}</span></div>` : ''}
                        <div class="totals-total"><span class="totals-label">${vat ? 'Total (VAT incl.)' : 'Total'}</span><span>GHS ${total.toFixed(2)}</span></div>
                        ${vat ? `<div class="vat-box">
                            <div class="vat-title">Total includes</div>
                            <div class="totals-row"><span>Amount before VAT</span><span>GHS ${vat.base.toFixed(2)}</span></div>
                            ${vat.parts.map(p => `<div class="totals-row"><span>${escAdm(p.label)} (${p.rate}%)</span><span>GHS ${p.amount.toFixed(2)}</span></div>`).join('')}
                        </div>` : ''}
                    </div>
                </div>

                <div class="footer">
                    <div class="footer-logo">
                        <img src="/assets/images/logo.png" alt="${escAdm(storeName)}">
                    </div>
                    <div class="footer-thankyou">Thank You</div>
                    <div class="footer-socials">
                        ${displayPhone ? `<div>Tel: ${escAdm(displayPhone)}</div>` : ''}
                        ${snapchat  ? `<div>Snapchat: ${escAdm(snapchat)}</div>`  : ''}
                        ${instagram ? `<div>Instagram: ${escAdm(instagram)}</div>` : ''}
                        ${tiktok    ? `<div>TikTok: ${escAdm(tiktok)}</div>`    : ''}
                    </div>
                </div>
            </div>
            <button class="print-btn no-print" onclick="window.print()">↓ Save as PDF</button>
            <script>window.onload=function(){setTimeout(function(){window.print();},400);}<\/script>
            </body></html>`;
        }

        function printDoc(html) {
            const w = window.open('', '_blank', 'width=800,height=900');
            if (!w) { showToast('Pop-up blocked — allow pop-ups and try again.', true); return; }
            w.document.open();
            w.document.write(html);
            w.document.close();
        }

        // WhatsApp message with a link to the public receipt/invoice page (the page
        // checks the customer's phone, which is part of the link). wa.me cannot attach
        // files, so a link the customer can open, print or save as PDF is the way.
        function invoiceWaUrl(o) {
            const c = (o && o.customer) || {};
            const raw = String(c.phone || '').replace(/\D/g, '');
            const num = raw.startsWith('0') ? '233' + raw.slice(1) : raw;
            if (num.length < 7) return '';
            const ref  = o.orderNo ? '#' + o.orderNo : o.id;
            const link = location.origin + '/api/orders/' + encodeURIComponent(o.id) + '/receipt?phone=' + encodeURIComponent(num);
            const msg  = 'Hello ' + (c.name || '') + ', thank you for shopping with ' + getStoreName() + '.\n\n'
                + 'Invoice ' + ref + '\n'
                + 'Total: GH₵' + parseFloat(o.total || 0).toFixed(2) + '\n\n'
                + 'View or download your invoice here:\n' + link;
            return 'https://wa.me/' + num + '?text=' + encodeURIComponent(msg);
        }

        function printOrderDoc(orderId) {
            const o = ordersCache.find(o => o.id === orderId);
            if (!o) return;
            printDoc(generateDocHtml(o, 'invoice'));
        }

        function downloadInvoiceForm() {
            const name     = document.getElementById('inv-name')?.value.trim();
            const email    = document.getElementById('inv-email')?.value.trim();
            const phone    = document.getElementById('inv-phone')?.value.trim();
            const address  = document.getElementById('inv-address')?.value.trim();
            const notes    = document.getElementById('inv-notes')?.value.trim();
            const invNum   = document.getElementById('inv-number')?.value.trim();
            const delivery = parseFloat(document.getElementById('inv-delivery')?.value) || 0;

            if (!name) return showToast('Enter a customer name first.', true);

            const items = [];
            document.querySelectorAll('#inv-rows tr').forEach(tr => {
                const desc  = tr.querySelector('.inv-desc')?.value.trim();
                const price = parseFloat(tr.querySelector('.inv-price')?.value) || 0;
                const qty   = parseInt(tr.querySelector('.inv-qty')?.value) || 1;
                const color = tr.querySelector('.inv-color-sel')?.value || '';
                const size  = tr.querySelector('.inv-size-sel')?.value  || '';
                if (desc) items.push({ name: desc, description: desc, price, quantity: qty, color, size });
            });
            if (!items.length) return showToast('Add at least one line item.', true);

            const subtotal   = items.reduce((s, i) => s + i.price * i.quantity, 0);
            const discount   = getDiscountAmount(subtotal);
            const total      = Math.max(0, subtotal + delivery - discount);
            const order = {
                id:            invNum || ('DRAFT-' + Date.now()),
                paidAt:        new Date().toISOString(),
                paymentStatus: 'manual',
                customer:      { name, email, phone, address, notes },
                items,
                subtotal,
                deliveryPrice: delivery,
                promoDiscount: discount,
                total
            };
            printDoc(generateDocHtml(order, 'invoice'));
        }

        // ── QUICK RECEIPT ────────────────────────────────────────────────────
        function addReceiptRow() {
            const tbody = document.getElementById('rct-rows');
            if (!tbody) return;
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td class="py-1 pr-2">
                  <input type="text" class="rct-desc w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-orange-400" placeholder="Item description" oninput="updateReceiptTotals()"/>
                </td>
                <td class="py-1 pr-2" style="width:110px">
                  <input type="number" class="rct-price w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-orange-400" placeholder="0.00" min="0" step="0.01" oninput="updateReceiptTotals()"/>
                </td>
                <td class="py-1 pr-2" style="width:70px">
                  <input type="number" class="rct-qty w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-orange-400" value="1" min="1" oninput="updateReceiptTotals()"/>
                </td>
                <td class="py-1 pr-2 text-right text-sm font-medium text-gray-700 rct-line-total" style="width:90px">GH₵0.00</td>
                <td class="py-1" style="width:32px">
                  <button onclick="this.closest('tr').remove();updateReceiptTotals()" class="text-gray-300 hover:text-red-400 text-lg leading-none">×</button>
                </td>`;
            tbody.appendChild(tr);
            tr.querySelector('.rct-desc').focus();
        }

        function updateReceiptTotals() {
            let subtotal = 0;
            document.querySelectorAll('#rct-rows tr').forEach(tr => {
                const price = parseFloat(tr.querySelector('.rct-price')?.value) || 0;
                const qty   = parseInt(tr.querySelector('.rct-qty')?.value)   || 1;
                const line  = price * qty;
                subtotal += line;
                const cell = tr.querySelector('.rct-line-total');
                if (cell) cell.textContent = 'GH₵' + line.toFixed(2);
            });
            const delivery    = parseFloat(document.getElementById('rct-delivery')?.value) || 0;
            const rawDiscount = parseFloat(document.getElementById('rct-discount')?.value) || 0;
            const discount    = rctDiscountIsPercent ? subtotal * Math.min(rawDiscount, 100) / 100 : rawDiscount;
            const total       = Math.max(0, subtotal + delivery - discount);
            const fmt = n => 'GH₵' + n.toFixed(2);
            const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
            set('rct-subtotal-display', fmt(subtotal));
            set('rct-delivery-display', fmt(delivery));
            set('rct-discount-display', '−' + fmt(discount));
            set('rct-total-display',    fmt(total));
        }

        function downloadReceiptForm() {
            const name     = document.getElementById('rct-name')?.value.trim();
            const phone    = document.getElementById('rct-phone')?.value.trim();
            const method   = document.getElementById('rct-payment-method')?.value || 'Cash';
            const notes    = document.getElementById('rct-notes')?.value.trim();
            const refInv   = document.getElementById('rct-ref-inv')?.value.trim();
            const delivery    = parseFloat(document.getElementById('rct-delivery')?.value) || 0;
            const rawDiscount = parseFloat(document.getElementById('rct-discount')?.value) || 0;

            if (!name) return showToast('Enter a customer name first.', true);

            const items = [];
            document.querySelectorAll('#rct-rows tr').forEach(tr => {
                const desc  = tr.querySelector('.rct-desc')?.value.trim();
                const price = parseFloat(tr.querySelector('.rct-price')?.value) || 0;
                const qty   = parseInt(tr.querySelector('.rct-qty')?.value)     || 1;
                if (desc) items.push({ name: desc, description: desc, price, quantity: qty });
            });
            if (!items.length) return showToast('Add at least one item.', true);

            const subtotal = items.reduce((s, i) => s + i.price * i.quantity, 0);
            const discount = rctDiscountIsPercent ? subtotal * Math.min(rawDiscount, 100) / 100 : rawDiscount;
            const total    = Math.max(0, subtotal + delivery - discount);
            const order = {
                id:            'RCT-' + Date.now(),
                vatInclusive:  true,
                refInvoiceNo:  refInv || '',
                paidAt:        new Date().toISOString(),
                paymentStatus: method,
                customer:      { name, phone, notes },
                items,
                subtotal,
                deliveryPrice: delivery,
                promoDiscount: discount,
                total
            };
            printDoc(generateDocHtml(order, 'receipt'));
        }

        function showInvoiceWhatsApp(msgEl, order) {
            const url = invoiceWaUrl(order);
            const wrap = document.createElement('div');
            wrap.className = 'mt-3';
            if (url) {
                const a = document.createElement('a');
                a.href = url; a.target = '_blank'; a.rel = 'noopener';
                a.className = 'inline-block bg-gray-900 hover:bg-orange-500 text-white text-sm font-semibold px-5 py-2.5 rounded-xl transition';
                a.textContent = 'Send invoice to customer on WhatsApp';
                wrap.appendChild(a);
            } else {
                wrap.className = 'mt-3 text-xs text-gray-400 font-normal';
                wrap.textContent = "Add the customer's phone number to send the invoice on WhatsApp.";
            }
            msgEl.appendChild(wrap);
        }

        async function submitManualInvoice(mode) {
            const name     = document.getElementById('inv-name').value.trim();
            const email    = document.getElementById('inv-email').value.trim();
            const phone    = document.getElementById('inv-phone').value.trim();
            const address  = document.getElementById('inv-address').value.trim();
            const notes    = document.getElementById('inv-notes').value.trim();
            const invNum   = document.getElementById('inv-number').value.trim();
            const delivery = parseFloat(document.getElementById('inv-delivery').value) || 0;

            if (!name) return showToast('Customer name is required.', true);
            if ((mode === 'save_email' || mode === 'email_only') && !email) return showToast('Enter the customer\'s email to send the invoice by email.', true);

            const items = [];
            document.querySelectorAll('#inv-rows tr').forEach(tr => {
                const desc      = tr.querySelector('.inv-desc')?.value.trim();
                const price     = parseFloat(tr.querySelector('.inv-price')?.value) || 0;
                const qty       = parseInt(tr.querySelector('.inv-qty')?.value)     || 1;
                const productId = tr.querySelector('.inv-prod-select')?.value       || '';
                const color     = tr.querySelector('.inv-color-sel')?.value         || '';
                const size      = tr.querySelector('.inv-size-sel')?.value          || '';
                if (desc) items.push({ description: desc, price, qty, productId, color, size });
            });
            if (!items.length) return showToast('Add at least one line item.', true);

            const subtotalForDiscount = items.reduce((s, i) => s + (parseFloat(i.price)||0) * (parseInt(i.qty)||1), 0);
            const discount            = getDiscountAmount(subtotalForDiscount);

            // Require colour selection for products that have colour variants
            for (const item of items) {
                if (!item.productId) continue;
                const prod = invoiceProductsCache.find(p => p.id === item.productId);
                if (prod && prod.variants && prod.variants.length && !item.color) {
                    return showToast(`Select a colour for "${prod.name}".`, true);
                }
            }

            // Block save/save_email if any linked item is out of stock or exceeds available stock
            if (mode !== 'email_only') {
                for (const item of items) {
                    if (!item.productId) continue;
                    const prod = invoiceProductsCache.find(p => p.id === item.productId);
                    if (!prod) continue;
                    const isRich = Array.isArray(prod.variants) && prod.variants.length && typeof prod.variants[0] === 'object';
                    if (isRich && item.color) {
                        const v = prod.variants.find(v => v.color === item.color);
                        if (v && typeof v.stock === 'number') {
                            if (v.stock === 0)
                                return showToast(`"${prod.name}" (${item.color}) is out of stock — cannot save.`, true);
                            if (item.qty > v.stock)
                                return showToast(`Only ${v.stock} unit${v.stock === 1 ? '' : 's'} of "${prod.name}" (${item.color}) in stock — you entered ${item.qty}.`, true);
                        }
                    } else if (!isRich && typeof prod.stock === 'number') {
                        if (prod.stock === 0)
                            return showToast(`"${prod.name}" is out of stock — cannot save.`, true);
                        if (item.qty > prod.stock)
                            return showToast(`Only ${prod.stock} unit${prod.stock === 1 ? '' : 's'} of "${prod.name}" in stock — you entered ${item.qty}.`, true);
                    }
                }
            }

            const msgEl = document.getElementById('inv-msg');
            msgEl.className = 'mt-4 text-sm text-center font-medium text-gray-500';
            msgEl.textContent = mode === 'save_email' ? 'Saving and sending email…'
                              : mode === 'email_only' ? 'Sending email (no save)…'
                              : 'Saving…';
            msgEl.classList.remove('hidden');

            try {
                const res = await fetch('/api/admin/manual-invoice', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ customer: { name, email, phone, address }, items, discount, deliveryFee: delivery, notes, mode, invoiceNum: invNum })
                });
                const data = await res.json();
                if (!res.ok || !data.success) {
                    msgEl.className = 'mt-4 text-sm text-center font-medium text-red-500';
                    msgEl.textContent = data.message || 'Error.';
                    return;
                }
                msgEl.className = 'mt-4 text-sm text-center font-medium text-green-600';
                if (mode === 'email_only') {
                    msgEl.textContent = 'Email sent to ' + email + ' (not saved to system).';
                } else if (mode === 'save_email') {
                    msgEl.textContent = data.emailError
                        ? 'Saved! (Email error: ' + data.emailError + ')'
                        : 'Invoice ' + data.order.id + ' saved and emailed to ' + email + '!';
                    showInvoiceWhatsApp(msgEl, data.order);
                } else {
                    msgEl.textContent = 'Invoice ' + data.order.id + ' saved to system.';
                    showInvoiceWhatsApp(msgEl, data.order);
                }
                if (mode !== 'email_only') {
                    // Only reset form when something was saved
                    ['inv-name','inv-email','inv-phone','inv-address','inv-notes','inv-delivery','inv-discount'].forEach(id => {
                        const el = document.getElementById(id); if (el) el.value = '';
                    });
                    discountIsPercent = false;
                    const dtBtn = document.getElementById('inv-discount-type');
                    if (dtBtn) dtBtn.textContent = 'GH₵';
                    const numEl = document.getElementById('inv-number');
                    numEl.value = ''; numEl.dataset.touched = '';
                    document.getElementById('inv-rows').innerHTML = '';
                    addInvoiceRow();
                    updateInvoiceTotals();
                    fetch('/api/admin/next-invoice-num')
                        .then(r => r.json()).then(d => { document.getElementById('inv-number').value = d.next; });
                }
            } catch (err) {
                msgEl.className = 'mt-4 text-sm text-center font-medium text-red-500';
                msgEl.textContent = 'Network error. Try again.';
            }
        }

        // ── SETTINGS ────────────────────────────────────────────────────────
        function loadSettings() {
            fetch('/api/admin/settings')
                .then(r => r.json())
                .then(s => {
                    const v = (id, val) => { const el = document.getElementById(id); if(el) el.value = val || ''; };
                    const c = (id, val) => { const el = document.getElementById(id); if(el) el.checked = !!val; };
                    v('set-store-name', s.storeName);
                    v('set-whatsapp',   s.whatsapp);
                    v('set-email',      s.storeEmail);
                    v('set-instagram',  s.instagram);
                    v('set-facebook',   s.facebook);
                    v('set-tiktok',     s.tiktok);
                    v('set-snapchat',   s.snapchat);
                    v('set-announcement', s.announcement);
                    c('set-announcement-on', s.announcementOn);
                    c('set-shop-open',       s.shopOpen !== false);
                    v('set-closed-msg',  s.shopClosedMsg);
                    v('set-hero-pill',      s.heroPill);
                    v('set-hero-headline',  s.heroHeadline);
                    v('set-hero-sub',       s.heroSub);
                    v('set-about-heading',  s.aboutHeading);
                    v('set-about-body',     s.aboutBody);
                    v('set-footer-tagline', s.footerTagline);
                    v('set-trust-1', s.trustLine1);
                    v('set-trust-2', s.trustLine2);
                    v('set-trust-3', s.trustLine3);
                    v('set-trust-4', s.trustLine4);
                    v('set-fd-threshold', s.freeDeliveryThreshold);
                    v('set-fd-zone',      s.freeDeliveryZone);
                    c('set-sale-enabled', s.saleEnabled);
                    v('set-sale-end', s.saleEndDate ? s.saleEndDate.replace('Z','').slice(0,16) : '');
                    v('set-sale-msg',     s.saleMessage);
                    c('set-banner-enabled',  s.featuredBannerEnabled);
                    v('set-banner-headline', s.featuredBannerHeadline);
                    v('set-banner-sub',      s.featuredBannerSub);
                    v('set-banner-cta',      s.featuredBannerCta);
                    v('set-banner-link',     s.featuredBannerLink);
                    v('set-brand-video-url',   s.brandVideoUrl);
                    v('set-brand-video-title', s.brandVideoTitle);
                    c('set-hero-video-enabled', s.heroVideoEnabled);
                    v('set-seo-title', s.seoTitle);
                    v('set-seo-desc',  s.seoDescription);
                    const accent = s.accentColor || '#C9971C';
                    const cp = document.getElementById('set-accent-color');
                    const ch = document.getElementById('set-accent-color-hex');
                    if (cp) cp.value = accent;
                    if (ch) ch.value = accent;
                    v('set-font-body', s.fontBody);
                    c('set-stock-alert-on',   s.stockAlertEnabled);
                    v('set-stock-threshold',  s.stockAlertThreshold || 3);
                    v('set-owner-email',      s.ownerEmail);
                    v('set-owner-phone',      s.ownerPhone);
                    c('set-backup-on',        s.backupEnabled !== false);
                    v('set-inv-account-name', s.invoiceAccountName);
                    v('set-inv-account-no',   s.invoiceAccountNo);
                    v('set-inv-tin',          s.invoiceTin);
                    // sync color picker ↔ hex input
                    if (cp && ch) {
                        cp.oninput = () => { ch.value = cp.value; };
                        ch.oninput = () => { if (/^#[0-9a-f]{6}$/i.test(ch.value)) cp.value = ch.value; };
                    }
                })
                .catch(() => showToast('Could not load settings.', true));
        }

        function saveSettings() {
            const allBtns = document.querySelectorAll('[onclick="saveSettings()"]');
            allBtns.forEach(b => { b.disabled = true; b.textContent = 'Saving…'; });
            const g = id => { const el = document.getElementById(id); return el ? el.value.trim() : ''; };
            const gb = id => { const el = document.getElementById(id); return el ? el.checked : false; };
            const body = {
                storeName:       g('set-store-name'),
                whatsapp:        g('set-whatsapp'),
                storeEmail:      g('set-email'),
                instagram:       g('set-instagram'),
                facebook:        g('set-facebook'),
                tiktok:          g('set-tiktok'),
                snapchat:        g('set-snapchat'),
                announcement:    g('set-announcement'),
                announcementOn:  gb('set-announcement-on'),
                shopOpen:        gb('set-shop-open'),
                shopClosedMsg:   g('set-closed-msg'),
                heroPill:        g('set-hero-pill'),
                heroHeadline:    g('set-hero-headline'),
                heroSub:         g('set-hero-sub'),
                aboutHeading:    g('set-about-heading'),
                aboutBody:       document.getElementById('set-about-body')?.value || '',
                footerTagline:   g('set-footer-tagline'),
                trustLine1:      g('set-trust-1'),
                trustLine2:      g('set-trust-2'),
                trustLine3:      g('set-trust-3'),
                trustLine4:      g('set-trust-4'),
                freeDeliveryThreshold: parseFloat(g('set-fd-threshold')) || 200,
                freeDeliveryZone:      g('set-fd-zone'),
                saleEnabled:  gb('set-sale-enabled'),
                saleEndDate:  g('set-sale-end') ? new Date(g('set-sale-end')).toISOString() : '',
                saleMessage:  g('set-sale-msg'),
                featuredBannerEnabled:  gb('set-banner-enabled'),
                featuredBannerHeadline: g('set-banner-headline'),
                featuredBannerSub:      g('set-banner-sub'),
                featuredBannerCta:      g('set-banner-cta'),
                featuredBannerLink:     g('set-banner-link'),
                brandVideoUrl:   g('set-brand-video-url'),
                brandVideoTitle: g('set-brand-video-title'),
                heroVideoEnabled: gb('set-hero-video-enabled'),
                seoTitle:        g('set-seo-title'),
                seoDescription:  document.getElementById('set-seo-desc')?.value.trim() || '',
                accentColor:     g('set-accent-color-hex') || g('set-accent-color') || '#C9971C',
                fontBody:        g('set-font-body'),
                stockAlertEnabled:    gb('set-stock-alert-on'),
                stockAlertThreshold:  parseInt(g('set-stock-threshold')) || 3,
                ownerEmail:           g('set-owner-email'),
                ownerPhone:           g('set-owner-phone'),
                backupEnabled:        gb('set-backup-on'),
                invoiceAccountName:   g('set-inv-account-name'),
                invoiceAccountNo:     g('set-inv-account-no'),
                invoiceTin:           g('set-inv-tin'),
            };
            fetch('/api/settings', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            })
            .then(r => r.json())
            .then(d => {
                if (d.success) showToast('Settings saved!');
                else showToast(d.message || 'Could not save settings.', true);
            })
            .catch(() => showToast('Network error — settings not saved.', true))
            .finally(() => {
                allBtns.forEach(b => { b.disabled = false; b.textContent = b.id === 'save-settings-btn' ? 'Save Settings' : 'Save All Settings'; });
            });
        }

        // ── ADMIN ACCOUNTS ───────────────────────────────────────────────────
        let currentAdminRole = 'owner'; // updated on load

        function initAdminRole() {
            fetch('/api/admin/me', { headers: { 'Authorization': 'Bearer ' + adminToken } })
                .then(r => r.ok ? r.json() : Promise.reject())
                .then(me => {
                    currentAdminRole = me.role || 'staff';
                    applyRoleRestrictions(currentAdminRole);
                    const el = document.getElementById('admin-logged-in-name');
                    if (el && me.name) el.textContent = me.name + ' (' + me.role + ')';
                }).catch(() => {});
        }

        function applyRoleRestrictions(role) {
            if (role === 'owner') return; // Owner — full access

            function hideGroup(g) {
                const btn = document.getElementById('grp-' + g);
                if (btn) btn.style.display = 'none';
            }

            if (role === 'manager') {
                // Manager — sees Settings BUT owner-only fields hidden after render
                const panel = document.getElementById('admin-accounts-panel');
                if (panel) panel.style.display = 'none';
                // Hook into switchTab to hide sensitive settings when that tab opens
                const _origSwitch = typeof switchTab === 'function' ? switchTab : null;
                window._managerSettingsHide = function() {
                    var ownerFields = ['set-inv-account-name','set-inv-account-no'];
                    ownerFields.forEach(function(id) {
                        var el = document.getElementById(id);
                        if (el) {
                            var row = el.closest('.mb-4') || el.closest('.mb-5') || el.parentElement;
                            if (row) row.style.display = 'none';
                        }
                    });
                    var acctPanel = document.getElementById('admin-accounts-panel');
                    if (acctPanel) acctPanel.style.display = 'none';
                    var note = document.getElementById('settings-role-note');
                    if (!note) {
                        note = document.createElement('div');
                        note.id = 'settings-role-note';
                        note.style.cssText = 'background:#FAF7EF;border:1px solid #E6D6AC;border-radius:10px;padding:10px 14px;margin-bottom:16px;font-size:12px;color:#7D5D10';
                        note.textContent = 'Some fields (bank account) are visible to the Owner only.';
                        var sec = document.getElementById('section-settings');
                        if (sec && sec.firstChild) sec.insertBefore(note, sec.firstChild);
                    }
                };
                // Apply immediately if settings is already active
                setTimeout(window._managerSettingsHide, 400);
            } else if (role === 'staff') {
                // Staff — Sales only (orders, invoices, promos)
                ['catalogue', 'customers', 'insights', 'content', 'settings'].forEach(hideGroup);
                const panel = document.getElementById('admin-accounts-panel');
                if (panel) panel.style.display = 'none';
                // Hide all destructive actions (delete buttons) for staff
                const styleEl = document.createElement('style');
                styleEl.id = 'staff-role-css';
                styleEl.textContent = `
                    [onclick*="deleteProduct"],[onclick*="deleteOrder"],[onclick*="deleteReview"],
                    [onclick*="deleteNotify"],[onclick*="deleteCode"],[onclick*="deleteCategory"],
                    [onclick*="deleteFaq"],[onclick*="deleteBaseProduct"],[onclick*="deleteDelivery"],
                    [onclick*="deleteStockIntake"],[onclick*="bulkDeleteOrders"] { display: none !important; }
                `;
                document.head.appendChild(styleEl);
                // switchGroup('sales') is called by startAdminApp for staff
            }
        }

        function loadAdminAccounts() {
            if (currentAdminRole !== 'owner') return;
            const panel = document.getElementById('admin-accounts-panel');
            if (!panel) return;
            const list = document.getElementById('admin-accounts-list');
            fetch('/api/admin/accounts', { headers: { 'Authorization': 'Bearer ' + adminToken } })
                .then(r => r.json())
                .then(accounts => {
                if (!list) return;
                if (!Array.isArray(accounts)) {
                    list.innerHTML = '<p class="text-xs text-red-400 text-center py-4">Error: ' + escAdm(String(accounts && accounts.error || JSON.stringify(accounts)).slice(0,120)) + '</p>';
                    return;
                }
                const ROLE_BADGE = {
                    owner:   'bg-orange-100 text-orange-700',
                    manager: 'bg-blue-100 text-blue-700',
                    staff:   'bg-gray-100 text-gray-600'
                };
                list.innerHTML = accounts.map(a => `
                    <div class="flex items-center justify-between bg-gray-50 rounded-xl px-4 py-3">
                      <div class="flex items-center gap-3">
                        <div class="w-9 h-9 rounded-full bg-gray-200 flex items-center justify-center text-sm font-bold text-gray-600">${escAdm(a.name[0]?.toUpperCase())}</div>
                        <div>
                          <p class="text-sm font-semibold text-gray-800">${escAdm(a.name)}</p>
                          <p class="text-xs text-gray-400">@${escAdm(a.username)}</p>
                        </div>
                      </div>
                      <div class="flex items-center gap-3">
                        <span class="text-[11px] font-bold px-2.5 py-0.5 rounded-full ${ROLE_BADGE[a.role] || ROLE_BADGE.staff}">${a.role}</span>
                        ${a.id !== 'admin-owner' ? `<button onclick="deleteAdminAccount('${escAdmJsAttr(a.id)}','${escAdmJsAttr(a.name)}')" class="text-xs text-red-400 hover:text-red-600 font-bold transition">Remove</button>` : '<span class="text-xs text-gray-300">Owner</span>'}
                      </div>
                    </div>`).join('');
            }).catch(() => {});
        }

        function showAddAdminForm() {
            document.getElementById('add-admin-form').classList.remove('hidden');
        }

        function toggleAdminPassVis() {
            const inp = document.getElementById('new-admin-pass');
            const btn = inp?.nextElementSibling;
            if (!inp) return;
            const show = inp.type === 'password';
            inp.type = show ? 'text' : 'password';
            if (btn) btn.textContent = show ? 'Hide' : 'Show';
        }

        function createAdminAccount() {
            const name = document.getElementById('new-admin-name').value.trim();
            const user = document.getElementById('new-admin-user').value.trim();
            const pass = document.getElementById('new-admin-pass').value;
            const role = document.getElementById('new-admin-role').value;
            if (!name || !user || !pass) { showToast('Please fill in all fields.', true); return; }
            fetch('/api/admin/accounts', {
                method: 'POST',
                headers: adminHeaders(),
                body: JSON.stringify({ name, username: user, password: pass, role })
            }).then(r => r.json()).then(d => {
                if (d.success) {
                    showToast(name + '\'s account created!');
                    document.getElementById('add-admin-form').classList.add('hidden');
                    ['new-admin-name','new-admin-user','new-admin-pass'].forEach(id => document.getElementById(id).value = '');
                    loadAdminAccounts();
                } else showToast(d.message || 'Failed.', true);
            });
        }

        function deleteAdminAccount(id, name) {
            requireAdminConfirm('Remove Admin Account', name + '\'s account will be permanently removed.', () => {
                fetch('/api/admin/accounts/' + id, { method: 'DELETE', headers: adminHeaders() })
                    .then(r => r.json())
                    .then(d => {
                        if (d.success) { showToast(name + ' removed.'); loadAdminAccounts(); }
                        else showToast(d.message || 'Failed.', true);
                    });
            });
        }

        // ── FAQ EDITOR ───────────────────────────────────────────────────────
        let faqsCache = [];

        function loadFaqs() {
            fetch('/api/faqs')
                .then(r => r.json())
                .then(items => { faqsCache = items; renderFaqs(); })
                .catch(() => showToast('Could not load FAQs.', true));
        }

        function renderFaqs() {
            const list = document.getElementById('faq-admin-list');
            if (!faqsCache.length) {
                list.innerHTML = '<p class="text-sm text-gray-400 text-center py-4">No FAQs yet. Add one below.</p>';
                return;
            }
            list.innerHTML = faqsCache.map((f, i) => `
                <div class="border border-gray-100 rounded-xl p-4" id="faq-row-${f.id}">
                    <div id="faq-view-${f.id}">
                        <div class="flex items-start justify-between gap-3">
                            <div class="flex-1 min-w-0">
                                <p class="text-sm font-bold text-gray-900">${escAdm(f.q)}</p>
                                <p class="text-xs text-gray-500 mt-1 line-clamp-2">${escAdm(f.a)}</p>
                            </div>
                            <div class="flex gap-2 flex-shrink-0">
                                <button onclick="startEditFaq('${f.id}')" class="text-xs font-semibold text-amber-600 hover:text-amber-800 transition">Edit</button>
                                <button onclick="deleteFaq('${f.id}')" class="text-xs font-semibold text-red-400 hover:text-red-600 transition">Delete</button>
                            </div>
                        </div>
                    </div>
                    <div id="faq-edit-${f.id}" class="hidden space-y-2">
                        <input type="text" id="faq-eq-${f.id}" value="${escAdm(f.q)}" class="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-amber-500 transition"/>
                        <textarea id="faq-ea-${f.id}" rows="3" class="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-amber-500 transition resize-none">${escAdm(f.a)}</textarea>
                        <div class="flex gap-2">
                            <button onclick="saveFaqEdit('${f.id}')" class="px-4 py-1.5 bg-gray-900 hover:bg-orange-500 text-white text-xs font-bold rounded-lg transition-colors">Save</button>
                            <button onclick="cancelFaqEdit('${f.id}')" class="px-4 py-1.5 border border-gray-200 text-xs font-semibold text-gray-600 rounded-lg hover:bg-gray-50 transition">Cancel</button>
                        </div>
                    </div>
                </div>`).join('');
        }

        function escAdm(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
        // Safe to embed inside a single-quoted JS string literal that itself sits inside an HTML
        // attribute (e.g. onclick="fn('TEXT')") — escapes backslash/quote for the JS-string context,
        // then HTML-escapes the result so it survives the surrounding double-quoted attribute too.
        function escAdmJsAttr(s) { return escAdm(String(s||'').replace(/\\/g,'\\\\').replace(/'/g,"\\'")); }
        function vColor(v) { return typeof v === 'object' && v ? (v.color || '') : String(v || ''); }
        function variantColors(variants) { return (variants || []).map(vColor).filter(Boolean); }

        const COLOR_MAP = {
            'black':'#1a1a1a','white':'#f5f5f5','red':'#e63946','blue':'#2563eb','navy':'#1e3a5f',
            'green':'#16a34a','olive':'#6b7e3c','yellow':'#facc15','orange':'#f97316','pink':'#ec4899',
            'purple':'#9333ea','brown':'#78350f','cream':'#fef3c7','ivory':'#f5f0e8','beige':'#d4b896',
            'grey':'#9ca3af','gray':'#9ca3af','gold':'#ca8a04','silver':'#94a3b8','maroon':'#9f1239',
            'teal':'#0d9488','coral':'#f87171','mint':'#86efac','lavender':'#c4b5fd','khaki':'#bfa46a',
            'camel':'#c4893e','rust':'#c2410c','sky':'#38bdf8','champagne':'#f0d9b5',
            'peach':'#fca5a5','mustard':'#d97706','emerald':'#059669','burgundy':'#881337','cyan':'#06b6d4'
        };
        function colorHex(name) {
            const lower = (name || '').toLowerCase();
            if (lower.includes('multi') || lower.includes('rainbow')) {
                return 'linear-gradient(135deg,#e63946 0%,#f97316 20%,#facc15 40%,#16a34a 60%,#2563eb 80%,#9333ea 100%)';
            }
            const words = lower.split(/[^a-z]+/).filter(Boolean);
            for (const w of words) { if (COLOR_MAP[w]) return COLOR_MAP[w]; }
            return '#d1d5db';
        }
        function colorGradient(name) {
            const lower = (name || '').toLowerCase();
            if (lower.includes('multi') || lower.includes('rainbow')) {
                return 'linear-gradient(135deg,#e63946 0%,#f97316 20%,#facc15 40%,#16a34a 60%,#2563eb 80%,#9333ea 100%)';
            }
            const words = lower.split(/[^a-z]+/).filter(Boolean);
            const found = [...new Set(words.map(w => COLOR_MAP[w]).filter(Boolean))];
            if (found.length >= 2) {
                const stops = found.map((c, i) => `${c} ${Math.round(i / (found.length - 1) * 100)}%`).join(',');
                return `linear-gradient(135deg,${stops})`;
            }
            if (found.length === 1) return found[0];
            return '#d1d5db';
        }
        function updateVariantDot(i, name) {
            const dot = document.getElementById('variant-dot-' + i);
            if (dot) dot.style.background = colorGradient(name);
        }

        function startEditFaq(id) {
            document.getElementById('faq-view-' + id).classList.add('hidden');
            document.getElementById('faq-edit-' + id).classList.remove('hidden');
        }

        function cancelFaqEdit(id) {
            document.getElementById('faq-view-' + id).classList.remove('hidden');
            document.getElementById('faq-edit-' + id).classList.add('hidden');
        }

        function saveFaqEdit(id) {
            const q = document.getElementById('faq-eq-' + id).value.trim();
            const a = document.getElementById('faq-ea-' + id).value.trim();
            if (!q || !a) { showToast('Question and answer cannot be empty.', true); return; }
            fetch('/api/faqs/' + id, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ q, a })
            })
            .then(r => r.json())
            .then(d => {
                if (d.success) { const f = faqsCache.find(x => x.id === id); if(f){ f.q=q; f.a=a; } renderFaqs(); showToast('FAQ updated!'); }
                else showToast(d.message || 'Could not update FAQ.', true);
            })
            .catch(() => showToast('Network error.', true));
        }

        function deleteFaq(id) {
            requireAdminConfirm(
                'Delete FAQ',
                'This FAQ entry will be permanently removed from the storefront.',
                () => {
                    fetch('/api/faqs/' + id, { method: 'DELETE' })
                        .then(r => r.json())
                        .then(d => {
                            if (d.success) { faqsCache = faqsCache.filter(f => f.id !== id); renderFaqs(); showToast('FAQ deleted.'); }
                            else showToast(d.message || 'Could not delete FAQ.', true);
                        })
                        .catch(() => showToast('Network error.', true));
                }
            );
        }

        function addFaq() {
            const q = document.getElementById('faq-new-q').value.trim();
            const a = document.getElementById('faq-new-a').value.trim();
            if (!q || !a) { showToast('Both question and answer are required.', true); return; }
            fetch('/api/faqs', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ q, a })
            })
            .then(r => r.json())
            .then(d => {
                if (d.success) {
                    faqsCache.push(d.faq);
                    renderFaqs();
                    document.getElementById('faq-new-q').value = '';
                    document.getElementById('faq-new-a').value = '';
                    showToast('FAQ added!');
                } else showToast(d.message || 'Could not add FAQ.', true);
            })
            .catch(() => showToast('Network error.', true));
        }

        function cropAndSave() {
            if (!cropperInst || !cropperSlot) return;
            const slot = cropperSlot;
            const [outW, outH] = SLOT_OUTPUT[slot] || [1200, 900];
            const isLogo = slot === 'logo';
            const canvas = cropperInst.getCroppedCanvas(outW ? { width: outW, height: outH, imageSmoothingQuality: 'high' } : {});
            const btn = document.getElementById(slot + '-btn');
            const msg = document.getElementById(slot + '-msg');
            const preview = document.getElementById('preview-' + slot);
            if (btn) { btn.textContent = 'Uploading…'; btn.classList.add('opacity-60', 'pointer-events-none'); }
            if (msg) msg.className = 'text-xs mt-2 hidden';
            closeCropModal();
            const mime = isLogo ? 'image/png' : 'image/jpeg';
            canvas.toBlob(blob => {
                const fd = new FormData();
                fd.append('image', blob, slot + (isLogo ? '.png' : '.jpg'));
                fetch('/api/site-images/' + slot, { method: 'POST', body: fd })
                    .then(r => r.json())
                    .then(data => {
                        if (data.success) {
                            if (preview) preview.src = data.path + '?t=' + Date.now();
                            if (msg) { msg.textContent = '✓ Updated'; msg.className = 'text-xs mt-2 text-orange-500 font-semibold'; }
                            showToast('Image updated!');
                        } else {
                            if (msg) { msg.textContent = '✗ ' + (data.message || 'Upload failed'); msg.className = 'text-xs mt-2 text-red-500'; }
                            showToast(data.message || 'Upload failed.', true);
                        }
                    })
                    .catch(() => {
                        if (msg) { msg.textContent = '✗ Network error'; msg.className = 'text-xs mt-2 text-red-500'; }
                        showToast('Network error — image not saved.', true);
                    })
                    .finally(() => { if (btn) { btn.textContent = 'Replace'; btn.classList.remove('opacity-60', 'pointer-events-none'); } });
            }, mime, 0.92);
        }
