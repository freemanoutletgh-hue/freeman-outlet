  // ── CONFIG ─────────────────────────────────────────────────────────────
  let WA = '';                                                        // overwritten by /api/settings
  const NEW_THRESHOLD = 7 * 24 * 60 * 60 * 1000;

  function escHtml(s){ return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  // Safe to embed inside a single-quoted JS string literal that itself sits inside an HTML attribute
  // (e.g. onclick="fn('TEXT')") — escapes backslash/quote for the JS-string context, then HTML-escapes
  // the result so it survives the surrounding double-quoted attribute too.
  function escJsAttr(s){ return escHtml(String(s||'').replace(/\\/g,'\\\\').replace(/'/g,"\\'")); }

  var _splashStart = Date.now(); // must be before dismissSplash references it
  // ── SPLASH SCREEN ──────────────────────────────────────────────────────
  var _splashDismissed = false;
  function dismissSplash() {
    if (_splashDismissed) return;
    _splashDismissed = true;
    var splash = document.getElementById('splash-screen');
    if (!splash) return;
    // Minimum display time of 2s so the animation completes
    var shown = Date.now() - _splashStart;
    var delay = Math.max(0, 2000 - shown);
    setTimeout(function() {
      splash.style.opacity = '0';
      splash.style.visibility = 'hidden';
      setTimeout(function() { if (splash.parentNode) splash.parentNode.removeChild(splash); }, 900);
    }, delay);
  }
  // Safety fallback — dismiss after 8s even if products never load
  setTimeout(dismissSplash, 8000);

  // ── VARIANT HELPERS (handles both string[] and object[] formats) ────────
  function vColor(v) { return typeof v === 'string' ? v : (v && v.color || ''); }
  function vImage(v) { return typeof v === 'object' && v ? (v.image || '') : ''; }
  function vStock(v) { return typeof v === 'object' && v && typeof v.stock === 'number' ? v.stock : null; }
  function vUnavail(v) { var s = vStock(v); return s !== null && s === 0; }
  function hasColours(p) {
    return !!(p.variants && p.variants.length && vColor(p.variants[0]));
  }
  function variantForColor(p, color) {
    if (!p.variants) return null;
    return p.variants.find(function(v) { return vColor(v) === color; }) || null;
  }

  // ── STATE ──────────────────────────────────────────────────────────────
  let allProducts = [];
  let activeStatus = 'all';
  let activeCat = 'all';
  let activeSizeFilter = 'all';
  const selectedColors = {};
  const selectedSizes  = {};
  const cardQty = {};
  let cart     = loadCart();
  let wishlist = loadWishlist();
  let appliedPromo     = null;
  let promoDiscount    = 0;
  let checkoutSubtotal = 0;
  let lastOrderData    = null;

  // ── CART PERSISTENCE ───────────────────────────────────────────────────
  function loadCart() {
    try { return JSON.parse(localStorage.getItem('freeman_cart') || '[]'); }
    catch { return []; }
  }
  function saveCart() { localStorage.setItem('freeman_cart', JSON.stringify(cart)); }

  // ── WISHLIST PERSISTENCE ────────────────────────────────────────────────
  function loadWishlist() {
    try { return JSON.parse(localStorage.getItem('freeman_wishlist') || '[]'); }
    catch { return []; }
  }
  function saveWishlist() { localStorage.setItem('freeman_wishlist', JSON.stringify(wishlist)); }
  function updateWishCount() {
    const el = document.getElementById('wish-count');
    el.textContent = wishlist.length;
    el.classList.toggle('hidden', wishlist.length === 0);
  }

  // ── SEARCH ─────────────────────────────────────────────────────────────
  function navSearch(val) {
    document.getElementById('search-bar').value = val;
    var mob = document.getElementById('mobile-search-bar'); if (mob) mob.value = val;
    applyFilters();
    if (val.length === 1) document.getElementById('products').scrollIntoView({ behavior: 'smooth' });
  }
  function mobileSearch(val) {
    document.getElementById('search-bar').value = val;
    var nav = document.getElementById('nav-search-input'); if (nav) nav.value = val;
    applyFilters();
    if (val.length === 1) document.getElementById('products').scrollIntoView({ behavior: 'smooth' });
  }

  // ── MOBILE NAV ─────────────────────────────────────────────────────────
  function toggleMobileNav() { document.getElementById('mobile-nav').classList.toggle('open'); }
  function closeMobileNav() { document.getElementById('mobile-nav').classList.remove('open'); }

  // ── CART COUNT ─────────────────────────────────────────────────────────
  function updateCartCount() {
    const n = cart.reduce((s, i) => s + i.quantity, 0);
    const el = document.getElementById('cart-count');
    el.textContent = n;
    el.classList.toggle('hidden', n === 0);
  }

  // ── OPEN / CLOSE CART ──────────────────────────────────────────────────
  function openCart() {
    renderCart();
    document.getElementById('cart-overlay').classList.add('open');
    document.getElementById('cart-sidebar').classList.add('open');
    document.body.style.overflow = 'hidden';
  }
  function closeCart() {
    document.getElementById('cart-overlay').classList.remove('open');
    document.getElementById('cart-sidebar').classList.remove('open');
    document.body.style.overflow = '';
  }

  // ── BUNDLE PRICING (server re-computes the same rule at checkout) ──────────
  function productBundles(p) {
    var unit = parseFloat(p && p.price) || 0;
    return ((p && p.bundles) || []).filter(function(b) { return b.qty >= 2 && b.price > 0 && b.price < b.qty * unit; })
      .sort(function(a, b) { return a.qty - b.qty; });
  }
  function bundleSavings(items) {
    var qtyById = {};
    items.forEach(function(i) { qtyById[i.id] = (qtyById[i.id] || 0) + Math.max(1, Math.floor(Number(i.quantity)) || 1); });
    var d = 0;
    Object.keys(qtyById).forEach(function(id) {
      var p = allProducts.find(function(x) { return x.id === id; });
      if (!p) return;
      var unit = parseFloat(p.price) || 0, rem = qtyById[id], bundled = 0;
      productBundles(p).slice().reverse().forEach(function(t) {
        var n = Math.floor(rem / t.qty);
        if (n) { bundled += n * t.price; rem -= n * t.qty; }
      });
      d += qtyById[id] * unit - (bundled + rem * unit);
    });
    return Math.round(d * 100) / 100;
  }

  // ── RENDER CART SIDEBAR ────────────────────────────────────────────────
  function renderCart() {
    const body = document.getElementById('cart-body');
    const foot = document.getElementById('cart-foot');
    if (cart.length === 0) {
      body.innerHTML = `<div class="cart-empty"><div class="cart-empty-icon"></div><p>Your cart is empty.<br>Browse our products below!</p></div>`;
      foot.style.display = 'none';
      return;
    }
    const regularSubtotal = cart.reduce((s, i) => s + i.price * i.quantity, 0);
    const bundleDisc = Math.min(regularSubtotal, bundleSavings(cart));
    const subtotal = regularSubtotal - bundleDisc;
    body.innerHTML = cart.map((item, idx) => `
      <div class="cart-item">
        <img src="${escHtml(item.image)}" alt="${escHtml(item.name)}" onerror="this.src='https://images.unsplash.com/photo-1581091226825-a6a2a5aee158?w=200'"/>
        <div class="cart-item-info">
          <div class="cart-item-name">${escHtml(item.name)}</div>
          ${item.color ? `<div class="cart-item-color">Colour: ${escHtml(item.color)}</div>` : ''}
          ${item.size  ? `<div class="cart-item-color">Size: ${escHtml(item.size)}</div>`   : ''}
          <div class="cart-item-bottom">
            <span class="cart-item-price">GH₵${(item.price * item.quantity).toFixed(2)}</span>
            <div style="display:flex;align-items:center">
              <div class="cart-qty">
                <button onclick="cartQty(${idx}, -1)">−</button>
                <span>${item.quantity}</span>
                <button onclick="cartQty(${idx}, +1)">+</button>
              </div>
              <button class="cart-remove" onclick="cartRemove(${idx})" title="Remove">✕</button>
            </div>
          </div>
        </div>
      </div>
    `).join('');
    document.getElementById('cart-total').textContent = `GH₵${subtotal.toFixed(2)}`;
    var cbl = document.getElementById('cart-bundle-line');
    cbl.style.display = bundleDisc > 0 ? 'flex' : 'none';
    document.getElementById('cart-bundle-amt').textContent = '−GH₵' + bundleDisc.toFixed(2);
    renderFreeDeliveryBar(subtotal);
    foot.style.display = 'block';
  }

  function cartQty(idx, delta) {
    const item = cart[idx];
    const p = allProducts.find(p => p.id === item.id);
    const cv = (item.color && p) ? variantForColor(p, item.color) : null;
    const cvStock = cv ? vStock(cv) : null;
    const maxQty = cvStock !== null ? cvStock : (p && p.stock !== null && p.stock !== undefined ? p.stock : Infinity);
    const next = Math.min(maxQty, Math.max(1, item.quantity + delta));
    if (delta > 0 && next === item.quantity && maxQty !== Infinity) {
      alert('Only ' + maxQty + ' in stock — you\'ve reached the limit.');
      return;
    }
    cart[idx].quantity = next;
    saveCart(); updateCartCount(); renderCart();
  }
  function cartRemove(idx) {
    cart.splice(idx, 1);
    saveCart(); updateCartCount(); renderCart();
  }

  // ── ADD TO CART ────────────────────────────────────────────────────────
  function addToCart(productId) {
    const p = allProducts.find(p => p.id === productId);
    if (!p || p.isSoldOut) return;
    trackEvent(productId, 'cart');
    if (hasColours(p) && !selectedColors[productId]) {
      alert(`Please choose a colour for "${p.name}" first!`);
      return;
    }
    if (p.sizes && p.sizes.length > 0 && !selectedSizes[productId]) {
      alert(`Please choose a size for "${p.name}" first!`);
      return;
    }
    const color = selectedColors[productId] || '';
    const size  = selectedSizes[productId]  || '';
    const qty = cardQty[productId] || 1;
    const existing = cart.findIndex(i => i.id === productId && i.color === color && i.size === size);
    const alreadyInCart = existing >= 0 ? cart[existing].quantity : 0;
    const cv = variantForColor(p, color);
    const cvStock = cv ? vStock(cv) : null;
    if (cvStock !== null) {
      const maxAdd = Math.max(0, cvStock - alreadyInCart);
      if (maxAdd === 0) { alert(`This colour is out of stock.`); return; }
      if (qty > maxAdd) { alert(`Only ${maxAdd} more available for ${color}.`); return; }
    } else if (p.stock !== null && p.stock !== undefined) {
      const maxAddable = Math.max(0, p.stock - alreadyInCart);
      if (maxAddable === 0) { alert(`You already have all ${p.stock} units of "${p.name}" in your cart.`); return; }
      if (qty > maxAddable) { alert(`Only ${maxAddable} more of "${p.name}" can be added.`); return; }
    }
    const cartImg = (cv && vImage(cv)) ? vImage(cv) : p.image;
    if (existing >= 0) {
      cart[existing].quantity += qty;
    } else {
      cart.push({ id: productId, name: p.name, image: cartImg, price: parseFloat(p.price), color, size, quantity: qty });
    }
    saveCart(); updateCartCount(); openCart();
  }

  // ── WHATSAPP ORDER ─────────────────────────────────────────────────────
  function handleOrder(productId) {
    const p = allProducts.find(p => p.id === productId);
    if (!p) return;
    if (p.isSoldOut) {
      const msg = `Hi! I'd like to enquire about when *${p.name}* will be back in stock. Please let me know! `;
      window.open(`https://wa.me/${WA}?text=${encodeURIComponent(msg)}`, '_blank');
      return;
    }
    if (hasColours(p) && !selectedColors[productId]) {
      alert(`Please choose a colour for "${p.name}" first!`);
      return;
    }
    if (p.sizes && p.sizes.length > 0 && !selectedSizes[productId]) {
      alert(`Please choose a size for "${p.name}" first!`);
      return;
    }
    const color = selectedColors[productId] || '';
    const size  = selectedSizes[productId]  || '';
    const details = [color ? 'Colour: ' + color : '', size ? 'Size: ' + size : ''].filter(Boolean).join(', ');
    const msg = `Hi! I want to order *${p.name}*${details ? ' - ' + details : ''} (GH₵${p.price}) `;
    window.open(`https://wa.me/${WA}?text=${encodeURIComponent(msg)}`, '_blank');
  }

  // ── CHECKOUT ───────────────────────────────────────────────────────────
  function openCheckout() {
    if (cart.length === 0) return;
    const unavailableInCart = cart.filter(i => {
      const p = allProducts.find(p => p.id === i.id);
      return !p || p.isListed === false || p.isSoldOut;
    });
    if (unavailableInCart.length) {
      alert('The following item' + (unavailableInCart.length > 1 ? 's are' : ' is') + ' no longer available and must be removed from your cart before checkout:\n\n' + unavailableInCart.map(i => '• ' + i.name).join('\n'));
      return;
    }
    closeCart();
    var regularTotal = cart.reduce((s, i) => s + i.price * i.quantity, 0);
    var bundleDisc   = Math.min(regularTotal, bundleSavings(cart));
    checkoutSubtotal = regularTotal - bundleDisc;
    appliedPromo     = null;
    promoDiscount    = 0;
    document.getElementById('checkout-items').innerHTML = cart.map(i =>
      `<div class="summary-item">
        <span>${escHtml(i.name)}${[i.color ? 'Colour: '+escHtml(i.color) : '', i.size ? 'Size: '+escHtml(i.size) : ''].filter(Boolean).map(s=>' ('+s+')').join('')} × ${escHtml(i.quantity)}</span>
        <span>GH₵${(i.price * i.quantity).toFixed(2)}</span>
      </div>`
    ).join('');
    document.getElementById('checkout-total').textContent = `GH₵${checkoutSubtotal.toFixed(2)}`;
    document.getElementById('pay-amount').textContent = `GH₵${checkoutSubtotal.toFixed(2)}`;
    document.getElementById('checkout-bundle-line').style.display = bundleDisc > 0 ? 'flex' : 'none';
    document.getElementById('checkout-bundle-amt').textContent = '−GH₵' + bundleDisc.toFixed(2);
    document.getElementById('promo-discount-line').style.display = 'none';
    document.getElementById('promo-msg').className = '';
    document.getElementById('promo-msg').style.display = '';
    document.getElementById('co-promo').value = '';
    prefillCheckout();
    document.getElementById('checkout-modal').classList.add('open');
    document.body.style.overflow = 'hidden';
  }

  // Remember delivery details on this device only, so a returning customer (or someone who closed the
  // page mid-checkout) doesn't retype them. Fields already filled in are never overwritten.
  var CHECKOUT_KEY = 'freeman_checkout';
  var CHECKOUT_FIELDS = { name: 'co-name', phone: 'co-phone', email: 'co-email', address: 'co-address' };
  function saveCheckoutDetails() {
    var d = {};
    Object.keys(CHECKOUT_FIELDS).forEach(function(k) { var el = document.getElementById(CHECKOUT_FIELDS[k]); d[k] = el ? el.value.trim() : ''; });
    try { localStorage.setItem(CHECKOUT_KEY, JSON.stringify(d)); } catch (e) {}
  }
  function prefillCheckout() {
    var d = {};
    try { d = JSON.parse(localStorage.getItem(CHECKOUT_KEY) || '{}') || {}; } catch (e) {}
    Object.keys(CHECKOUT_FIELDS).forEach(function(k) {
      var el = document.getElementById(CHECKOUT_FIELDS[k]);
      if (el && !el.value && typeof d[k] === 'string') el.value = d[k];
    });
  }
  Object.keys(CHECKOUT_FIELDS).forEach(function(k) {
    var el = document.getElementById(CHECKOUT_FIELDS[k]);
    if (el) el.addEventListener('input', saveCheckoutDetails);
  });

  function updateCheckoutTotal() {
    const finalTotal  = Math.max(0, checkoutSubtotal - promoDiscount);
    document.getElementById('checkout-total').textContent = `GH₵${finalTotal.toFixed(2)}`;
    document.getElementById('pay-amount').textContent     = `GH₵${finalTotal.toFixed(2)}`;
  }
  function closeCheckout() {
    document.getElementById('checkout-modal').classList.remove('open');
    document.body.style.overflow = '';
    var pe = document.getElementById('pay-error');
    if (pe) pe.style.display = 'none';
  }

  async function sendOrderToWhatsApp() {
    const name    = document.getElementById('co-name').value.trim();
    const email   = document.getElementById('co-email').value.trim();
    const phone   = normalisePhone(document.getElementById('co-phone').value.trim());
    const address = document.getElementById('co-address').value.trim();
    const notes   = document.getElementById('co-notes').value.trim();
    // Delivery location is now captured entirely by the free-text address field
    // above (Google Maps/Yango link or a description) — the zone/area-picker
    // this used to require was removed in favour of that, since delivery fees
    // are negotiated with the customer on WhatsApp regardless of which zone
    // they're in.
    if (!name || !phone || !address) {
      alert('Please fill in all required fields (Name, Phone, Address).');
      return;
    }
    const _customer = { name, email, phone, address, notes };
    const _items    = [...cart];

    // Save checkout-started server-side for abandoned cart recovery
    fetch('/api/checkout-started', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, name, phone, cartItems: _items }) }).catch(() => {});

    const payBtn = document.getElementById('checkout-pay-btn');
    payBtn.disabled = true;
    payBtn.style.opacity = '0.7';

    try {
      const res = await fetch('/api/whatsapp-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer: _customer,
          cartItems: _items,
          promoCode: appliedPromo ? appliedPromo.code : null,
          promoDiscount
        })
      });
      const data = await res.json();
      if (!data.success) {
        payBtn.disabled = false;
        payBtn.style.opacity = '';
        showPayError(data.message || 'One or more items in your cart are no longer available. Please update your cart and try again.');
        return;
      }
      lastOrderData = { reference: data.order.reference, customer: _customer, cartItems: _items, total: data.order.total, bundleDiscount: data.order.bundleDiscount || 0, orderId: data.order.id };
      notifyOwnerWA(data.order.reference, _customer, _items);
      var invBtn = document.getElementById('success-invoice-btn');
      if (invBtn) invBtn.href = invoiceLink(data.order.id, _customer.phone);
      closeCheckout();
      cart = []; saveCart(); updateCartCount();
      document.getElementById('success-ref').textContent = 'Order Reference: ' + data.order.orderNo;
      document.getElementById('success-overlay').classList.add('open');
      document.body.style.overflow = 'hidden';
    } catch(e) {
      payBtn.disabled = false;
      payBtn.style.opacity = '';
      showPayError('Network error — please try again, or message us directly on WhatsApp.');
    }
  }

  function showPayError(msg) {
    var el = document.getElementById('pay-error');
    if (!el) return;
    el.innerHTML = '' + escHtml(msg) + ' — <a href="https://wa.me/' + WA + '" target="_blank" style="color:#dc2626;font-weight:700;text-decoration:underline">WhatsApp us</a> to confirm.';
    el.style.display = 'block';
    var payBtn = document.getElementById('checkout-pay-btn');
    if (payBtn) { payBtn.disabled = false; payBtn.style.opacity = ''; }
  }

  // ── QUICK VIEW ─────────────────────────────────────────────────────────
  var qvProduct = null;
  var qvQtyVal  = 1;
  var qvSize    = '';
  var qvColor   = '';
  var qvGallery = [];
  var qvIdx     = 0;
  var qvLastFocus = null;
  var STORE_NAME = 'Freeman Outlet';

  var pendingDeepLink = new URLSearchParams(window.location.search).get('p');
  function openDeepLink() {
    if (!pendingDeepLink || !allProducts.length) return;
    var id = pendingDeepLink; pendingDeepLink = null;
    if (allProducts.some(function(x) { return x.id === id; })) openQV(id);
    else history.replaceState({}, '', '/');
  }

  function trackEvent(productId, type) {
    fetch('/api/events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ productId: productId, type: type }) }).catch(function() {});
  }

  function openQV(productId, fromHistory) {
    var p = allProducts.find(function(x){ return x.id === productId; });
    if (!p) return;
    trackEvent(productId, 'view');
    qvProduct = p;
    qvQtyVal  = cardQty[productId] || 1;
    renderUpsell(p);
    qvSize    = selectedSizes[productId]  || '';
    qvColor   = selectedColors[productId] || '';

    var imgs = (p.images && p.images.length) ? p.images : [p.image];
    // Find initial image: use the selected colour's variant image if available
    var initialImgSrc = imgs[0];
    if (qvColor && p.variants) {
      var initV = variantForColor(p, qvColor);
      if (initV && vImage(initV)) initialImgSrc = vImage(initV);
      else {
        var idx0 = p.variants.findIndex(function(v) { return vColor(v) === qvColor; });
        if (idx0 >= 0 && imgs[idx0]) initialImgSrc = imgs[idx0];
      }
    }
    qvGallery = qvBuildGallery(p, imgs, initialImgSrc);
    var startIdx = qvGallery.findIndex(function(g) { return g.src === initialImgSrc; });
    qvRenderThumbs();
    qvShow(startIdx >= 0 ? startIdx : 0, false);

    document.getElementById('qv-cat').textContent  = p.category || '';
    document.getElementById('qv-name').textContent = p.name;
    document.getElementById('qv-top-title').textContent = p.name;
    var brand = (p.brand || '').trim();
    document.getElementById('qv-top-sub').textContent = (brand ? brand + ' \u2022 ' : '') + 'Delivery fee confirmed on WhatsApp';
    var capLbl = document.getElementById('qv-caption-lbl'); capLbl.textContent = brand; capLbl.hidden = !brand;
    var brandChip = document.getElementById('qv-brand-chip'); brandChip.textContent = brand ? 'Brand: ' + brand : ''; brandChip.hidden = !brand;
    qvRefreshStoreInfo();
    qvRenderInfo(p);

    var curr = Number(p.price), orig = Number(p.originalPrice);
    var onSale = orig > curr && orig > 0 && curr > 0;
    var pct = onSale ? Math.round((1 - curr/orig)*100) : 0;
    document.getElementById('qv-sale-strip').innerHTML = onSale
      ? '<div class="sale-header"><span class="sale-pct">'+pct+'% OFF</span>&nbsp;&nbsp;Limited Sale</div>' : '';
    document.getElementById('qv-price').innerHTML = onSale
      ? '<div class="price-was-now"><div class="price-was-row"><span class="plbl plbl-was">WAS</span>&nbsp;<span class="price-was-val">GH&#8373;'+orig.toFixed(2)+'</span></div><div class="price-now-row"><span class="plbl plbl-now">NOW</span>&nbsp;<span class="price-now-val">GH&#8373;'+curr.toFixed(2)+'</span><span class="price-unit"> per 3-pack</span></div></div>'
      : '<div class="price-row"><span class="price">GH&#8373;'+curr.toFixed(2)+'</span><span class="price-unit"> per 3-pack</span></div>';

    var initialSizes = getVariantSizes(p, qvColor);
    qvRenderSizes(p, initialSizes);

    document.getElementById('qv-colors').innerHTML = hasColours(p)
      ? '<div class="variants" style="flex-wrap:wrap;row-gap:8px"><span class="opts-lbl">Colour</span>'
        + p.variants.map(function(v){
            var c = vColor(v); var unavail = vUnavail(v);
            var hex = colorHex(c);
            var isGrad = hex && hex.startsWith('linear-gradient');
            var dotStyle = isGrad
              ? 'background:' + hex + ';'
              : 'background:' + (hex || '#ccc') + ';';
            return '<button class="colour-pill'+(qvColor===c?' active':'')+(unavail?' chip-unavail':'')+'" data-color="'+escHtml(c)+'"'
              + (unavail ? ' disabled title="Out of stock"' : ' onclick="qvPickColor(this,\''+escJsAttr(c)+'\')"')
              + '><span class="cpill-dot" style="' + dotStyle + '"></span>'
              + escHtml(c) + '</button>';
          }).join('')
        + '</div>' : '';

    document.getElementById('qv-qty-val').textContent = qvQtyVal;
    document.getElementById('qv-btn-cart').disabled = p.isSoldOut;
    document.getElementById('qv-btn-wa').disabled   = p.isSoldOut;
    var snEl = document.getElementById('qv-stock-note');
    if (snEl) snEl.style.display = '';
    qvUpdateStockNote();

    var ov = document.getElementById('qv-overlay');
    var wasOpen = ov.classList.contains('open');
    if (!wasOpen) qvLastFocus = document.activeElement;
    ov.classList.add('open');
    ov.scrollTop = 0;
    document.body.style.overflow = 'hidden';
    updateWishlistUI();
    var url = '/?p=' + encodeURIComponent(p.id);
    if (!fromHistory) {
      if (history.state && history.state.qv) history.replaceState({ qv: p.id, entry: history.state.entry }, '', url);
      else if (new URLSearchParams(location.search).get('p') === p.id) history.replaceState({ qv: p.id, entry: true }, '', url);
      else history.pushState({ qv: p.id }, '', url);
    }
    if (!wasOpen) {
      var closeBtn = ov.querySelector('.qv-topcard-x');
      if (!closeBtn || closeBtn.offsetParent === null) closeBtn = ov.querySelector('.qv-x');
      if (closeBtn) closeBtn.focus({ preventScroll: true });
    }
  }

  function qvUpdateStockNote() {
    qvRenderBundles();
    var el = document.getElementById('qv-stock-note');
    if (!el || !qvProduct) return;
    var max = qvMaxStock();
    if (qvProduct.isSoldOut || max === 0) {
      el.textContent = '✕ Out of stock'; el.className = 'qv-stock-note qv-stock-out';
    } else if (max !== Infinity && max <= 5) {
      el.textContent = 'Only ' + max + ' left!'; el.className = 'qv-stock-note qv-stock-low';
    } else {
      el.textContent = '✓ In stock'; el.className = 'qv-stock-note qv-stock-ok';
    }
  }

  function hideQV() {
    var ov = document.getElementById('qv-overlay');
    if (!ov.classList.contains('open')) return;
    ov.classList.remove('open');
    document.body.style.overflow = '';
    if (qvLastFocus && document.contains(qvLastFocus)) { try { qvLastFocus.focus({ preventScroll: true }); } catch (e) {} }
    qvLastFocus = null;
  }

  function closeQV() {
    var wasOpen = document.getElementById('qv-overlay').classList.contains('open');
    hideQV();
    if (!wasOpen) return;
    var st = history.state;
    if (st && st.qv) {
      if (st.entry) history.replaceState({}, '', '/');
      else history.back();
    }
  }

  window.addEventListener('popstate', function(e) {
    var st = e.state;
    if (st && st.qv) openQV(st.qv, true);
    else hideQV();
  });

  function qvBuildGallery(p, imgs, initialSrc) {
    var g = [], seen = {};
    function add(src, color) { if (src && !seen[src]) { seen[src] = 1; g.push({ src: src, color: color || '' }); } }
    if (Array.isArray(p.variants)) p.variants.forEach(function(v) { if (v && typeof v === 'object') add(vImage(v), vColor(v)); });
    imgs.forEach(function(src) { add(src, ''); });
    add(initialSrc, '');
    return g;
  }

  function qvRenderThumbs() {
    var el = document.getElementById('qv-thumbs');
    if (qvGallery.length < 2) { el.innerHTML = ''; return; }
    el.innerHTML = qvGallery.map(function(g, i) {
      var label = g.color ? g.color : 'Photo ' + (i + 1);
      return '<button type="button" class="qv-thumb" data-i="' + i + '" onclick="qvGo(' + i + ')" aria-label="Show ' + escHtml(label) + '"><img src="' + escHtml(g.src) + '" alt="" loading="lazy" onerror="this.src=\'https://images.unsplash.com/photo-1737094540182-d602f8a7dd1d?w=200\';this.onerror=null"></button>';
    }).join('');
  }

  function qvShow(i, syncColor) {
    var n = qvGallery.length;
    if (!n) return;
    qvIdx = ((i % n) + n) % n;
    var g = qvGallery[qvIdx];
    var img = document.getElementById('qv-main-img');
    img.src = g.src;
    img.alt = (qvProduct ? qvProduct.name : '') + (g.color ? ' \u2014 ' + g.color : '') + (n > 1 ? ' (photo ' + (qvIdx + 1) + ' of ' + n + ')' : '');
    document.getElementById('qv-caption-name').textContent = (qvProduct ? qvProduct.name : '') + (g.color ? ' \u2014 ' + g.color : '');
    var multi = n > 1;
    document.getElementById('qv-prev').hidden = !multi;
    document.getElementById('qv-next').hidden = !multi;
    var ctr = document.getElementById('qv-counter');
    ctr.hidden = !multi;
    ctr.textContent = (qvIdx + 1) + ' / ' + n;
    document.querySelectorAll('#qv-thumbs .qv-thumb').forEach(function(t) {
      var on = Number(t.dataset.i) === qvIdx;
      t.classList.toggle('active', on);
      if (on) { try { t.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (e) {} }
    });
    if (syncColor && g.color) qvSelectColor(g.color);
  }

  function qvGo(i) { qvShow(i, true); }
  function qvNav(d) { qvShow(qvIdx + d, true); }

  function qvRenderInfo(p) {
    var box = document.getElementById('qv-info');
    var secs = [];
    if (p.desc) secs.push({ t: 'Description', open: true, html: '<p class="qv-acc-text">' + escHtml(p.desc) + '</p>' });
    var sizeLine = (p.sizes && p.sizes.length) ? '<p class="qv-acc-text"><strong>Available sizes:</strong> ' + escHtml(p.sizes.join(', ')) + '</p>' : '';
    secs.push({ t: 'Fit &amp; Sizing', html: (p.fitNotes ? '<p class="qv-acc-text">' + escHtml(p.fitNotes) + '</p>' : '') + sizeLine
      + '<button type="button" class="size-guide-link" onclick="openSizeGuide(\'' + escJsAttr(p.name || '') + '\')">Open size guide</button>' });
    if (p.careNotes) secs.push({ t: 'Care Instructions', html: '<p class="qv-acc-text">' + escHtml(p.careNotes) + '</p>' });
    box.innerHTML = secs.map(function(x) {
      return '<details class="qv-acc"' + (x.open ? ' open' : '') + '><summary>' + x.t + '</summary><div class="qv-acc-body">' + x.html + '</div></details>';
    }).join('');
  }

  function qvRenderBundles() {
    var box = document.getElementById('qv-bundles');
    if (!box) return;
    var p = qvProduct, tiers = p ? productBundles(p) : [];
    if (!tiers.length) { box.innerHTML = ''; box.style.display = 'none'; return; }
    var unit = parseFloat(p.price) || 0, max = qvMaxStock();
    box.style.display = '';
    box.innerHTML = '<div class="qv-bundles-head"><span class="qv-bundles-title">Choose your package</span><span class="qv-bundles-sub">Mix sizes and colours &mdash; the bundle price applies automatically when you have that many of this product in your cart.</span></div>'
      + tiers.map(function(t) {
          var regular = unit * t.qty, save = regular - t.price, per = t.price / t.qty;
          var picked = qvQtyVal === t.qty, unavailable = max < t.qty;
          return '<div class="qv-bundle' + (picked ? ' picked' : '') + (unavailable ? ' unavailable' : '') + '">'
            + (t.tag ? '<span class="qv-bundle-tag">' + escHtml(t.tag) + '</span>' : '')
            + '<div class="qv-bundle-row"><span class="qv-bundle-qty">' + t.qty + ' packs</span>'
            + '<span class="qv-bundle-price"><s>GH&#8373;' + regular.toFixed(2) + '</s> GH&#8373;' + t.price.toFixed(2) + '</span></div>'
            + '<div class="qv-bundle-meta">Save GH&#8373;' + save.toFixed(2) + ' &bull; About GH&#8373;' + per.toFixed(2) + ' per pack</div>'
            + '<button type="button" class="qv-bundle-btn"' + (unavailable ? ' disabled' : '') + ' onclick="qvSelectBundle(' + t.qty + ')">'
            + (unavailable ? 'Not enough in stock' : picked ? 'Selected \u2713' : 'Select ' + t.qty + ' packs') + '</button></div>';
        }).join('');
  }

  function qvSelectBundle(n) {
    if (qvMaxStock() < n) return;
    qvQtyVal = n;
    document.getElementById('qv-qty-val').textContent = qvQtyVal;
    qvRenderBundles();
    qvScrollToOptions();
  }

  function qvSelectColor(color) {
    var pills = document.querySelectorAll('#qv-colors .colour-pill');
    var hit = null;
    pills.forEach(function(pill) { if (pill.dataset.color === color && !pill.disabled) hit = pill; });
    if (hit) qvPickColor(hit, color, true);
  }

  function qvScrollToOptions() {
    var el = document.getElementById('qv-options');
    if (!el) return;
    var bar = document.querySelector('.qv-topcard');
    el.style.scrollMarginTop = ((bar ? bar.offsetHeight : 0) + 12) + 'px';
    var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
  }

  function qvRefreshStoreInfo() {
    document.getElementById('qv-top-chip').textContent = FD_THRESHOLD > 0 ? 'Free delivery in ' + FD_ZONE + ' over GH₵' + FD_THRESHOLD : '';
    document.getElementById('qv-contact-name').textContent = STORE_NAME;
    document.getElementById('qv-contact-phone').textContent = displayPhone(WA);
  }

  function displayPhone(raw) {
    var d = String(raw || '').replace(/\D/g, '');
    if (!d) return '';
    if (d.indexOf('233') === 0 && d.length === 12) d = '0' + d.slice(3);
    if (d.length === 10 && d.charAt(0) === '0') return d.slice(0, 3) + ' ' + d.slice(3, 6) + ' ' + d.slice(6);
    return '+' + d;
  }

  function qvChatWA() {
    var p = qvProduct;
    var msg = p
      ? 'Hi ' + STORE_NAME + '! I\'m interested in *' + p.name + '* (GH\u20B5' + parseFloat(p.price).toFixed(2) + '). ' + window.location.origin + '/?p=' + encodeURIComponent(p.id)
      : 'Hi ' + STORE_NAME + '!';
    window.open('https://wa.me/' + WA + '?text=' + encodeURIComponent(msg), '_blank');
  }

  (function() {
    var wrap = document.getElementById('qv-main-wrap');
    if (!wrap) return;
    var sx = 0, sy = 0;
    wrap.addEventListener('touchstart', function(e) { sx = e.touches[0].clientX; sy = e.touches[0].clientY; }, { passive: true });
    wrap.addEventListener('touchend', function(e) {
      var dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy;
      if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.5) qvNav(dx < 0 ? 1 : -1);
    }, { passive: true });
  })();

  function qvPickSize(btn, size) {
    qvSize = size;
    var container = btn.closest('.variants') || btn.closest('.yard-chips');
    if (container) container.querySelectorAll('.chip, .yard-chip').forEach(function(b){ b.classList.remove('active'); });
    btn.classList.add('active');
  }

  // Size-level availability (only when the store has switched on size stock tracking); null = no restriction
  var sizeAvail = null;
  fetch('/api/stock/availability').then(function(r){ return r.json(); }).then(function(d){ if (d && d.tracking) sizeAvail = d.sku; }).catch(function(){});
  function sizeSoldOut(p, color, size) {
    if (!sizeAvail) return false;
    var prefix = p.id + '|';
    if (!Object.keys(sizeAvail).some(function(k){ return k.indexOf(prefix) === 0; })) return false;
    return !(sizeAvail[p.id + '|' + (color || '') + '|' + size] > 0);
  }

  // Shared by openQV (initial render) and qvPickColor (re-render after switching colour)
  function qvRenderSizes(prod, sizes) {
    if (qvSize && sizeSoldOut(prod, qvColor, qvSize)) qvSize = '';
    document.getElementById('qv-sizes').innerHTML = (sizes && sizes.length)
      ? '<div class="variants" style="align-items:center"><span class="opts-lbl">Size</span>' + sizes.map(function(s){
          var out = sizeSoldOut(prod, qvColor, s);
          return '<button class="chip'+(qvSize===s?' active':'')+(out?' chip-unavail':'')+'"'+(out?' disabled title="Sold out"':'')+' onclick="qvPickSize(this,\''+escJsAttr(s)+'\')">'+escHtml(s)+'</button>';
        }).join('') + '<span class="size-guide-link" style="margin-left:6px" onclick="openSizeGuide(\'' + escJsAttr(prod.name||'') + '\')">Guide</span></div>'
      : '<div class="variants" style="align-items:center"><span class="size-guide-link" onclick="openSizeGuide(\'' + escJsAttr(prod.name||'') + '\')">Size Guide</span></div>';
  }

  function qvPickColor(btn, color, fromGallery) {
    qvColor = color;
    btn.closest('.variants').querySelectorAll('.chip, .colour-pill').forEach(function(b){ b.classList.remove('active'); });
    btn.classList.add('active');
    // Refresh sizes for this colour variant
    if (qvProduct) {
      var sizes = getVariantSizes(qvProduct, color);
      if (!sizes.includes(qvSize)) qvSize = ''; // clear if selected size isn't in new colour
      qvRenderSizes(qvProduct, sizes);
    }
    var newMax = qvMaxStock();
    if (newMax !== Infinity && qvQtyVal > newMax) {
      qvQtyVal = Math.max(1, newMax);
      var qEl = document.getElementById('qv-qty-val');
      if (qEl) qEl.textContent = qvQtyVal;
    }
    if (qvProduct && !fromGallery) {
      var imgs = (qvProduct.images && qvProduct.images.length) ? qvProduct.images : [qvProduct.image];
      var v = variantForColor(qvProduct, color);
      var imgSrc = (v && vImage(v)) ? vImage(v) : null;
      if (!imgSrc) {
        var idx = qvProduct.variants ? qvProduct.variants.findIndex(function(vv){ return vColor(vv) === color; }) : -1;
        if (idx >= 0 && idx < imgs.length) imgSrc = imgs[idx];
      }
      var gi = imgSrc ? qvGallery.findIndex(function(g) { return g.src === imgSrc; }) : -1;
      if (gi >= 0) qvShow(gi, false);
    }
    qvUpdateStockNote();
  }

  function qvMaxStock() {
    var p = qvProduct; if (!p) return Infinity;
    var cv = qvColor ? variantForColor(p, qvColor) : null;
    var cvStock = cv ? vStock(cv) : null;
    var total = cvStock !== null ? cvStock : (p.stock !== null && p.stock !== undefined ? p.stock : Infinity);
    var existing = cart.findIndex(function(i) { return i.id === p.id && i.color === (qvColor||'') && i.size === (qvSize||''); });
    var inCart = existing >= 0 ? cart[existing].quantity : 0;
    return total === Infinity ? Infinity : Math.max(0, total - inCart);
  }

  function qvQty(delta) {
    var max = qvMaxStock();
    qvQtyVal = Math.min(max || 1, Math.max(1, qvQtyVal + delta));
    document.getElementById('qv-qty-val').textContent = qvQtyVal;
    qvRenderBundles();
  }

  function qvAddCart() {
    var p = qvProduct; if (!p) return;
    if (hasColours(p) && !qvColor) { alert('Please choose a colour first!'); return; }
    var effectiveSizes = getVariantSizes(p, qvColor);
    if (effectiveSizes.length && !qvSize) { alert('Please choose a size first!'); return; }
    trackEvent(p.id, 'cart');
    var existing = cart.findIndex(function(i){ return i.id===p.id && i.color===qvColor && i.size===qvSize; });
    var alreadyInCart = existing >= 0 ? cart[existing].quantity : 0;
    // Per-variant stock check
    var cv = variantForColor(p, qvColor);
    var cvStock = cv ? vStock(cv) : null;
    if (cvStock !== null) {
      var maxAdd = Math.max(0, cvStock - alreadyInCart);
      if (maxAdd === 0) { alert('This colour is out of stock.'); return; }
      if (qvQtyVal > maxAdd) { alert('Only ' + maxAdd + ' more available for ' + qvColor + '.'); return; }
    } else if (p.stock !== null && p.stock !== undefined) {
      var maxAddable = Math.max(0, p.stock - alreadyInCart);
      if (maxAddable === 0) { alert('You already have all ' + p.stock + ' units in your cart.'); return; }
      if (qvQtyVal > maxAddable) { alert('Only ' + maxAddable + ' more can be added.'); return; }
    }
    var cartImg = (cv && vImage(cv)) ? vImage(cv) : p.image;
    if (existing >= 0) { cart[existing].quantity += qvQtyVal; }
    else { cart.push({ id:p.id, name:p.name, image:cartImg, price:parseFloat(p.price), color:qvColor, size:qvSize, quantity:qvQtyVal }); }
    saveCart(); updateCartCount(); closeQV(); openCart();
  }

  function qvOrderWA() {
    var p = qvProduct; if (!p) return;
    if (p.variants && p.variants.length && !qvColor) { alert('Please choose a colour first!'); return; }
    if (p.sizes   && p.sizes.length   && !qvSize)  { alert('Please choose a size first!');   return; }
    var details = [qvColor?'Colour: '+qvColor:'', qvSize?'Size: '+qvSize:''].filter(Boolean).join(', ');
    var msg = 'Hi! I want to order *'+p.name+'*'+(details?' - '+details:'')+ ' (GH₵'+p.price+') × '+qvQtyVal+' ';
    window.open('https://wa.me/'+WA+'?text='+encodeURIComponent(msg),'_blank');
  }

  function closeSuccess() {
    document.getElementById('success-overlay').classList.remove('open');
    document.body.style.overflow = '';
    window.location.reload();
  }

  function openNotify(id, name) {
    document.getElementById('notify-product-id').value = id;
    document.getElementById('notify-product-name').textContent = name;
    document.getElementById('notify-name').value = '';
    document.getElementById('notify-phone').value = '';
    document.getElementById('notify-success').style.display = 'none';
    document.getElementById('notify-submit-btn').style.display = '';
    document.getElementById('notify-modal').classList.add('open');
    document.body.style.overflow = 'hidden';
  }
  function closeNotify() {
    document.getElementById('notify-modal').classList.remove('open');
    document.body.style.overflow = '';
  }
  function submitNotify() {
    const name = document.getElementById('notify-name').value.trim();
    const phone = normalisePhone(document.getElementById('notify-phone').value.trim());
    const productId = document.getElementById('notify-product-id').value;
    const productName = document.getElementById('notify-product-name').textContent;
    if (!name) { alert('Please enter your name.'); return; }
    if (!phone) { alert('Please enter your phone number.'); return; }
    fetch('/api/notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, phone, productId, productName })
    }).then(r => r.json()).then(d => {
      if (d.success) {
        document.getElementById('notify-success-msg').textContent = "We'll message you on WhatsApp when " + productName + " is back in stock.";
        document.getElementById('notify-success').style.display = '';
        document.getElementById('notify-submit-btn').style.display = 'none';
      } else {
        alert(d.message || 'Something went wrong. Please try again.');
      }
    }).catch(() => alert('Something went wrong. Please try again.'));
  }

  function toggleFaq(btn) {
    var item = btn.closest('.faq-item');
    var body = item.querySelector('.faq-a');
    var isOpen = item.classList.contains('open');
    document.querySelectorAll('.faq-item.open').forEach(function(i) {
      i.classList.remove('open');
      var b = i.querySelector('.faq-a');
      b.style.height = b.scrollHeight + 'px';
      requestAnimationFrame(function() { b.style.height = '0'; });
    });
    if (!isOpen) {
      item.classList.add('open');
      body.style.height = '0';
      requestAnimationFrame(function() { body.style.height = body.scrollHeight + 'px'; });
      body.addEventListener('transitionend', function handler() {
        body.style.height = 'auto';
        body.removeEventListener('transitionend', handler);
      });
    }
  }

  function normalisePhone(p) {
    var d = (p || '').replace(/\D/g, '');
    if (d.startsWith('0')) d = '233' + d.slice(1);
    else if (d && !d.startsWith('233')) d = '233' + d;
    return d || p || '';
  }

  var lastWAUrl = '';

  // Public invoice page; it checks the customer's phone, which is part of the link.
  function invoiceLink(orderId, rawPhone) {
    return window.location.origin + '/api/orders/' + encodeURIComponent(orderId) + '/receipt?phone=' + encodeURIComponent(normalisePhone(rawPhone));
  }

  function notifyOwnerWA(reference, customer, cartItems) {
    var ref  = reference  || (lastOrderData && lastOrderData.reference)  || '—';
    var cust = customer   || (lastOrderData && lastOrderData.customer)   || {};
    var items = cartItems || (lastOrderData && lastOrderData.cartItems)  || [];
    var total = Math.max(0, items.reduce(function(s,i){ return s + i.price * i.quantity; }, 0) - promoDiscount);
    if (lastOrderData && lastOrderData.total) total = lastOrderData.total;
    var phone = normalisePhone(cust.phone);
    var invoiceUrl = (lastOrderData && lastOrderData.orderId) ? invoiceLink(lastOrderData.orderId, cust.phone) : '';
    var lines = items.map(function(i) {
      var meta = [i.color ? 'Colour: '+i.color : '', i.size ? 'Size: '+i.size : ''].filter(Boolean).join(', ');
      return '• ' + i.name + (meta ? ' (' + meta + ')' : '') + ' × ' + i.quantity + ' — GH₵' + (i.price * i.quantity).toFixed(2);
    }).join('\n');
    var msg = '*NEW ORDER*\n\n'
      + '*Customer:* ' + (cust.name    || '') + '\n'
      + '*Phone:* '    + phone + '\n'
      + '*Email:* '    + (cust.email   || '') + '\n'
      + '*Address:* '  + (cust.address || '') + '\n'
      + (cust.notes ? '*Notes:* ' + cust.notes + '\n' : '')
      + '\n*Items:*\n' + lines + '\n\n'
      + ((lastOrderData && lastOrderData.bundleDiscount > 0) ? '*Bundle savings:* −GH₵' + lastOrderData.bundleDiscount.toFixed(2) + '\n' : '')
      + '*Total (items):* GH₵' + total.toFixed(2) + '\n'
      + '*Ref:* ' + ref
      + (invoiceUrl ? '\n*Invoice:* ' + invoiceUrl : '');
    lastWAUrl = 'https://wa.me/' + WA + '?text=' + encodeURIComponent(msg);
    // Update the button in the success overlay so users can tap it directly on mobile
    var waBtn = document.getElementById('success-wa-btn');
    if (waBtn) waBtn.href = lastWAUrl;
    // Try auto-open (works on desktop; may be blocked on mobile due to async callback context)
    try { window.open(lastWAUrl, '_blank'); } catch(e) {}
  }

  function renderUpsell(currentProduct) {
    var upsellEl = document.getElementById('qv-upsell');
    var gridEl   = document.getElementById('qv-upsell-grid');
    if (!upsellEl || !gridEl) return;
    var price = parseFloat(currentProduct.price) || 0;
    var candidates = allProducts.filter(function(p) {
      if (p.id === currentProduct.id || p.isSoldOut) return false;
      // Price within ±50% range
      var pp = parseFloat(p.price) || 0;
      return pp > 0 && pp >= price * 0.5 && pp <= price * 1.5;
    });
    // Prefer featured, then sort by closeness of price
    candidates.sort(function(a,b) {
      if (b.featured && !a.featured) return 1;
      if (a.featured && !b.featured) return -1;
      return Math.abs(parseFloat(a.price)-price) - Math.abs(parseFloat(b.price)-price);
    });
    var picks = candidates.slice(0,4);
    if (!picks.length) { upsellEl.style.display = 'none'; return; }
    upsellEl.style.display = 'block';
    gridEl.innerHTML = picks.map(function(p) {
      return '<div onclick="openQV(\''+escJsAttr(p.id)+'\')" style="cursor:pointer;border-radius:10px;overflow:hidden;border:1px solid var(--border);transition:box-shadow .2s" onmouseover="this.style.boxShadow=\'0 4px 16px rgba(0,0,0,.1)\'" onmouseout="this.style.boxShadow=\'\'">'
        + '<img src="'+escHtml(p.image)+'" alt="'+escHtml(p.name)+'" style="width:100%;aspect-ratio:1;object-fit:cover">'
        + '<div style="padding:8px"><p style="font-size:11px;font-weight:600;color:#1a1a1a;margin:0 0 2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+escHtml(p.name)+'</p>'
        + '<p style="font-size:11px;color:var(--accent);font-weight:700;margin:0">GH&#8373;'+parseFloat(p.price).toFixed(2)+'</p></div></div>';
    }).join('');
  }

  // Returns sizes for a specific color variant; falls back to product-level sizes
  function getVariantSizes(p, color) {
    if (color && Array.isArray(p.variants)) {
      var v = p.variants.find(function(v) { return vColor(v) === color; });
      if (v && Array.isArray(v.sizes) && v.sizes.length) return v.sizes;
    }
    return p.sizes || [];
  }

  // ── COLOR SELECTION ────────────────────────────────────────────────────
  function selectColor(btn) {
    const container = btn.closest('[data-product-id]');
    const id = container.dataset.productId;
    selectedColors[id] = btn.dataset.color;
    container.querySelectorAll('[data-color]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  }

  // ── SIZE SELECTION ─────────────────────────────────────────────────────
  function selectSize(btn) {
    const container = btn.closest('[data-product-id]');
    const id = container.dataset.productId;
    selectedSizes[id] = btn.dataset.size;
    container.querySelectorAll('[data-size]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  }

  // ── QTY ON CARD ────────────────────────────────────────────────────────
  function changeQty(productId, delta) {
    const p = allProducts.find(p => p.id === productId);
    const color = selectedColors[productId] || '';
    const cv = (color && p) ? variantForColor(p, color) : null;
    const cvStock = cv ? vStock(cv) : null;
    const maxQty = cvStock !== null ? cvStock : (p && p.stock !== null && p.stock !== undefined ? p.stock : Infinity);
    const next = Math.min(maxQty, Math.max(1, (cardQty[productId] || 1) + delta));
    if (delta > 0 && next === (cardQty[productId] || 1) && maxQty !== Infinity) return;
    cardQty[productId] = next;
    ['qty-', 'bs-qty-'].forEach(function(prefix) {
      const el = document.getElementById(prefix + productId);
      if (el) el.textContent = cardQty[productId];
    });
  }

  // ── FILTERS ────────────────────────────────────────────────────────────
  function setStatusFilter(f) {
    activeStatus = f;
    ['all','instock','soldout'].forEach(id =>
      document.getElementById(`filter-${id}`).className = id === f ? 'f-btn active' : 'f-btn'
    );
    applyFilters();
  }

  function setCategoryFilter(cat) {
    activeCat = cat;
    activeSizeFilter = 'all';
    document.querySelectorAll('.cat-card').forEach(b =>
      b.classList.toggle('active', b.dataset.cat === cat)
    );
    applyFilters();
  }

  function setSizeFilter(size) {
    activeSizeFilter = size;
    applyFilters();
  }

  const SIZE_ORDER = ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL'];

  function renderSizeFilters(products) {
    const row = document.getElementById('size-filters');
    if (activeCat === 'all') { row.innerHTML = ''; return; }
    const seen = new Set();
    products.forEach(p => (p.sizes || []).forEach(s => seen.add(s)));
    if (!seen.size) { row.innerHTML = ''; return; }
    const sorted = [...seen].sort(function(a, b) {
      const ai = SIZE_ORDER.indexOf(a), bi = SIZE_ORDER.indexOf(b);
      if (ai !== -1 && bi !== -1) return ai - bi;
      if (ai !== -1) return -1;
      if (bi !== -1) return 1;
      return Number(a) - Number(b) || a.localeCompare(b);
    });
    row.innerHTML = '<button class="f-btn size-btn' + (activeSizeFilter === 'all' ? ' active' : '') + '" onclick="setSizeFilter(\'all\')">All Sizes</button>' +
      sorted.map(function(s) {
        return '<button class="f-btn size-btn' + (activeSizeFilter === s ? ' active' : '') + '" onclick="setSizeFilter(\'' + escJsAttr(s) + '\')">' + escHtml(s) + '</button>';
      }).join('');
  }

  var activeSort = 'default';

  function applyFilters() {
    const q = document.getElementById('search-bar').value.toLowerCase();
    const preFiltered = allProducts.filter(p => {
      const pCat = (p.category || '').toLowerCase();
      const matchQ   = !q
        || p.name.toLowerCase().includes(q)
        || (p.desc     || '').toLowerCase().includes(q)
        || (p.category || '').toLowerCase().includes(q)
        || (p.variants || []).some(v => (vColor(v) || '').toLowerCase().includes(q))
        || (p.sizes    || []).some(s => s.toLowerCase().includes(q));
      const matchSt  = activeStatus === 'all' || (activeStatus === 'instock' && !p.isSoldOut) || (activeStatus === 'soldout' && p.isSoldOut);
      const matchCat = activeCat === 'all' || pCat === activeCat;
      return matchQ && matchSt && matchCat;
    });
    // if the active size no longer exists in this filtered set, reset it
    if (activeSizeFilter !== 'all') {
      const available = new Set();
      preFiltered.forEach(p => (p.sizes || []).forEach(s => available.add(s)));
      if (!available.has(activeSizeFilter)) activeSizeFilter = 'all';
    }
    renderSizeFilters(preFiltered);
    let filtered = activeSizeFilter === 'all'
      ? preFiltered
      : preFiltered.filter(p => (p.sizes || []).includes(activeSizeFilter));

    // Sort
    if (activeSort === 'price-asc')  filtered = filtered.slice().sort((a,b) => parseFloat(a.price) - parseFloat(b.price));
    if (activeSort === 'price-desc') filtered = filtered.slice().sort((a,b) => parseFloat(b.price) - parseFloat(a.price));
    if (activeSort === 'newest')     filtered = filtered.slice().sort((a,b) => (b.createdAt||0) - (a.createdAt||0));
    if (activeSort === 'name-asc')   filtered = filtered.slice().sort((a,b) => a.name.localeCompare(b.name));

    renderGrid(filtered);
  }

  function setSort(val) {
    activeSort = val;
    applyFilters();
  }

  let enabledCategories = []; // populated from /api/categories

  const CAT_THEMES = {
    'all':    { grad: 'var(--dark)', icon: '', label: 'Browse everything', dark: true },
    'men':    { grad: '#2B2B2B', icon: '', label: 'Shop Now', dark: true },
    'women':  { grad: '#3D3D3D', icon: '', label: 'Shop Now', dark: true },
    'unisex': { grad: '#4F4F4F', icon: '', label: 'Shop Now', dark: true },
  };
  const CAT_FALLBACK_GRADS = ['#F2F2F2', '#E5E5E5'];

  function renderFooterCategories() {
    var ul = document.getElementById('foot-shop-links');
    if (!ul) return;
    var visible = enabledCategories.filter(function(c) { return c.enabled; });
    var existing = ul.querySelectorAll('li[data-foot-cat]');
    existing.forEach(function(el) { el.remove(); });
    visible.forEach(function(c) {
      var li = document.createElement('li');
      li.setAttribute('data-foot-cat', c.name.toLowerCase());
      var a = document.createElement('a');
      a.href = '#products';
      a.textContent = c.name;
      a.onclick = function() {
        setCategoryFilter(c.name.toLowerCase());
        document.getElementById('products').scrollIntoView({ behavior: 'smooth' });
      };
      li.appendChild(a);
      ul.appendChild(li);
    });
  }

  function renderCategories(products) {
    const grid = document.getElementById('cat-cards');
    if (!grid) return;

    const visibleCats = enabledCategories.length
      ? enabledCategories.filter(c => c.enabled).map(c => c.name)
      : [...new Set(products.map(p => (p.category || '').trim()).filter(Boolean))];

    const withCount = visibleCats
      .map(c => ({ name: c, key: c.toLowerCase(), count: products.filter(p => (p.category||'').toLowerCase() === c.toLowerCase()).length }))
      .filter(c => c.count > 0);

    const allCards = [{ name: 'All', key: 'all', count: products.length }, ...withCount];

    grid.innerHTML = allCards.map((c, idx) => {
      // Falls back to a generic theme for any category with no explicit entry above
      // (e.g. one added later in admin) — "Shop Now" avoids repeating the category
      // name that's already shown in .cat-card-name right below this label.
      const th  = CAT_THEMES[c.key] || { grad: CAT_FALLBACK_GRADS[idx % CAT_FALLBACK_GRADS.length], icon: '', label: 'Shop Now', dark: false };
      const col = th.dark ? '#fff' : '#1a1a1a';
      const lbl = th.dark ? 'rgba(255,255,255,.58)' : 'rgba(0,0,0,.48)';
      const isActive = activeCat === c.key;
      return `<button class="cat-card${isActive ? ' active' : ''}" data-cat="${escHtml(c.key)}"
        onclick="setCategoryFilter('${escJsAttr(c.key)}');document.getElementById('products').scrollIntoView({behavior:'smooth',block:'start'})"
        style="background:${th.grad}">
        <div class="cat-card-top">
          <span class="cat-card-label" style="color:${lbl}">${escHtml(th.label)}</span>
          ${th.icon ? `<span class="cat-card-icon">${th.icon}</span>` : ''}
        </div>
        <span class="cat-card-name" style="color:${col}">${escHtml(c.name)}${c.key !== 'all' ? ' <span style="font-size:11px;font-weight:500;opacity:.55">('+c.count+')</span>' : ''}</span>
      </button>`;
    }).join('');
  }

  // ── PRODUCT GRID ───────────────────────────────────────────────────────
  function renderGrid(products) {
    const grid = document.getElementById('shop-grid');
    if (!products.length) {
      grid.innerHTML = '<div class="empty-state"><p>No products match your filter.</p></div>';
      return;
    }
    const now = Date.now();
    grid.innerHTML = products.map(function(p) {
      if (hasColours(p) && !(p.id in selectedColors)) {
        selectedColors[p.id] = vColor(p.variants[0]);
      }
      if (p.sizes && p.sizes.length > 0 && !(p.id in selectedSizes)) {
        selectedSizes[p.id] = '';
      }

      /* ── sale calc ── */
      var curr = Number(p.price);
      var orig = Number(p.originalPrice);
      var onSale = orig > curr && orig > 0 && curr > 0;
      var pct   = onSale ? Math.round((1 - curr / orig) * 100) : 0;
      var isNew = p.createdAt && (now - p.createdAt) < NEW_THRESHOLD;
      var lowStock = !p.isSoldOut && p.stock !== null && p.stock !== undefined && p.stock > 0 && p.stock <= 5;

      /* ── heart / wishlist button ── */
      var inWish = wishlist.includes(p.id);
      var heartBtn = '<button class="wish-btn' + (inWish ? ' wishlisted' : '') + '" onclick="event.stopPropagation();toggleWishlist(\'' + escJsAttr(p.id) + '\')" title="Save to wishlist">' + (inWish ? '♥' : '♡') + '</button>';

      /* ── overlay badge stack ── */
      var badges = '';
      if (p.isSoldOut) {
        badges = '<span class="pbadge pbadge-sold">✕ Sold Out</span>';
      } else if (onSale) {
        badges = '<span class="pbadge pbadge-disc">'
          + '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>'
          + ' −' + pct + '% OFF</span>'
          + '<span class="pbadge pbadge-info">Save GH&#8373;' + (orig - curr).toFixed(0) + '</span>';
      } else if (isNew) {
        badges = '<span class="pbadge pbadge-new">✶ New</span>';
      }
      if (lowStock) badges += '<span class="pbadge pbadge-info">Only ' + p.stock + ' left</span>';

      /* ── price display ── */
      var priceHtml = '<span class="pfrom">From</span>'
        + '<span class="prod-price-main">GH&#8373;' + curr.toFixed(2) + '</span>'
        + (onSale ? '<span class="prod-price-was">GH&#8373;' + orig.toFixed(2) + '</span>' : '');

      /* ── arrow button ── */
      var arrowSvg = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>';

      var notifyBtn = p.isSoldOut
        ? '<button class="prod-notify-btn" onclick="event.stopPropagation();openNotify(\'' + escJsAttr(p.id) + '\',\'' + escJsAttr(p.name) + '\')" title="Notify me when back in stock">Notify Me</button>'
        : '';
      return '<div class="prod-c' + (p.isSoldOut ? ' sold-out' : '') + '" data-product-id="' + escHtml(p.id) + '" onclick="openQV(\'' + escJsAttr(p.id) + '\')">'
        + '<div class="prod-img-wrap">'
          + '<img src="' + escHtml(p.image) + '" alt="' + escHtml(p.name) + '" loading="lazy" onerror="this.src=\'https://images.unsplash.com/photo-1581091226825-a6a2a5aee158?w=500\'"/>'
          + '<div class="prod-badges">' + badges + '</div>'
          + heartBtn + notifyBtn
        + '</div>'
        + '<div class="prod-info">'
          + '<h4>' + escHtml(p.name) + '</h4>'
          + swatchesHtml(p.variants, p.id)
          + '<div class="prod-foot">'
            + '<div class="prod-foot-price">' + priceHtml + '</div>'
            + '<button class="prod-arrow" onclick="event.stopPropagation();openQV(\'' + escJsAttr(p.id) + '\')" aria-label="View product">' + arrowSvg + '</button>'
          + '</div>'
        + '</div>'
      + '</div>';
    }).join('');
  }

  // ── WISHLIST ───────────────────────────────────────────────────────────
  function toggleWishlist(id) {
    var idx = wishlist.indexOf(id);
    if (idx >= 0) wishlist.splice(idx, 1);
    else wishlist.push(id);
    saveWishlist(); updateWishCount();
    document.querySelectorAll('.wish-btn').forEach(function(btn) {
      var pid = btn.closest('[data-product-id]') && btn.closest('[data-product-id]').dataset.productId;
      var inW = wishlist.includes(pid);
      btn.classList.toggle('wishlisted', inW);
      btn.textContent = inW ? '♥' : '♡';
    });
    var sidebar = document.getElementById('wish-sidebar');
    if (sidebar.classList.contains('open')) renderWishlist();
  }
  function openWishlist() {
    renderWishlist();
    document.getElementById('wish-overlay').classList.add('open');
    document.getElementById('wish-sidebar').classList.add('open');
    document.body.style.overflow = 'hidden';
  }
  function closeWishlist() {
    document.getElementById('wish-overlay').classList.remove('open');
    document.getElementById('wish-sidebar').classList.remove('open');
    document.body.style.overflow = '';
  }
  function renderWishlist() {
    var body = document.getElementById('wish-body');
    var saved = allProducts.filter(function(p) { return wishlist.includes(p.id); });
    if (!saved.length) {
      body.innerHTML = '<div class="cart-empty"><div class="cart-empty-icon"></div><p>No saved items yet.<br>Tap the heart on a product to save it.</p></div>';
      return;
    }
    body.innerHTML = saved.map(function(p) {
      var curr = Number(p.price), orig = Number(p.originalPrice);
      var onSale = orig > curr && orig > 0 && curr > 0;
      var priceStr = onSale
        ? '<span style="font-size:12px;color:var(--muted);text-decoration:line-through;margin-right:5px">GH₵'+orig.toFixed(2)+'</span><span style="font-size:15px;font-weight:700;color:var(--accent)">GH₵'+curr.toFixed(2)+'</span>'
        : '<span style="font-size:15px;font-weight:700;color:var(--accent)">GH₵'+curr.toFixed(2)+'</span>';
      return '<div class="cart-item">'
        + '<img src="'+escHtml(p.image)+'" alt="'+escHtml(p.name)+'" style="width:72px;height:72px;object-fit:cover;border-radius:10px;flex-shrink:0;border:1px solid var(--border)" onerror="this.src=\'https://images.unsplash.com/photo-1581091226825-a6a2a5aee158?w=200\'"/>'
        + '<div class="cart-item-info">'
          + '<div class="cart-item-name">'+escHtml(p.name)+'</div>'
          + '<div style="margin:4px 0 10px">'+priceStr+'</div>'
          + '<div style="display:flex;gap:8px">'
            + '<button onclick="addToCartFromWishlist(\''+escJsAttr(p.id)+'\')" style="flex:1;background:var(--dark);color:#fff;border:none;border-radius:8px;padding:8px 12px;font-family:var(--fb);font-size:12px;font-weight:600;cursor:pointer;transition:background .2s" onmouseover="this.style.background=\'var(--accent)\'" onmouseout="this.style.background=\'var(--dark)\'">Add to Cart</button>'
            + '<button onclick="toggleWishlist(\''+escJsAttr(p.id)+'\')" title="Remove" style="background:var(--light);color:#dc2626;border:1.5px solid #fecaca;border-radius:8px;padding:8px 12px;font-size:13px;cursor:pointer">✕</button>'
          + '</div>'
        + '</div>'
      + '</div>';
    }).join('');
  }
  function addToCartFromWishlist(id) {
    var p = allProducts.find(function(x){ return x.id === id; });
    if (!p || p.isSoldOut) { closeWishlist(); return; }
    if ((p.variants && p.variants.length) || (p.sizes && p.sizes.length)) {
      closeWishlist(); openQV(id); return;
    }
    var existing = cart.findIndex(function(i){ return i.id === p.id && !i.color && !i.size; });
    if (existing >= 0) cart[existing].quantity += 1;
    else cart.push({ id:p.id, name:p.name, image:p.image, price:parseFloat(p.price), color:'', size:'', quantity:1 });
    saveCart(); updateCartCount(); closeWishlist(); openCart();
  }

  // ── SIZE GUIDE ─────────────────────────────────────────────────────────
  // Takes the PRODUCT NAME, not category — category is now just an audience
  // label (Men/Women/Unisex) and no longer describes the garment type, so it
  // can't tell underwear from undershirts from panties from socks the way it
  // used to. Checked most-specific first so e.g. "Ladies Boxer Shorts" still
  // resolves sensibly (panty check doesn't fire, boxer check does).
  // The charts are editable in the Supply page (Stock > Sizes) and served by /api/size-guides;
  // the static charts in index.html are only a fallback if that request fails.
  var sizeGuides = null;
  fetch('/api/size-guides').then(function(r){ return r.json(); }).then(function(g){ sizeGuides = g; }).catch(function(){});
  function openSizeGuide(productName) {
    var c = (productName || '').toLowerCase();
    var chart = /sock/.test(c) ? 'sg-socks'
      : /pant(y|ies)/.test(c) ? 'sg-panties'
      : /underwear|boxer|brief|trunk/.test(c) ? 'sg-underwear'
      : 'sg-clothing';
    var guideKey = { 'sg-socks': 'socks', 'sg-panties': 'panties', 'sg-underwear': 'boxers', 'sg-clothing': 'undershirts' }[chart];
    var g = sizeGuides && sizeGuides[guideKey];
    var dyn = document.getElementById('sg-dynamic');
    if (g && Array.isArray(g.columns) && Array.isArray(g.rows)) {
      dyn.innerHTML = '<span class="sg-section">' + escHtml(g.title) + '</span><table class="sg-table"><thead><tr>'
        + g.columns.map(function(col){ return '<th>' + escHtml(col) + '</th>'; }).join('') + '</tr></thead><tbody>'
        + g.rows.map(function(r){ return '<tr>' + r.map(function(cell, i){ return '<td>' + (i === 0 ? '<b>' + escHtml(cell) + '</b>' : escHtml(cell)) + '</td>'; }).join('') + '</tr>'; }).join('')
        + '</tbody></table>' + (g.note ? '<p style="font-size:11px;color:var(--muted);margin-top:10px">' + escHtml(g.note) + '</p>' : '');
      chart = 'sg-dynamic';
    }
    ['sg-clothing', 'sg-underwear', 'sg-panties', 'sg-socks', 'sg-dynamic'].forEach(function(id) {
      document.getElementById(id).style.display = (id === chart) ? '' : 'none';
    });
    var modal = document.querySelector('#sg-overlay .sg-modal');
    modal.querySelector('h3').textContent  = 'Size Guide';
    modal.querySelector('.sg-sub').textContent = 'Measurements in centimetres (cm). When in doubt, size up.';
    document.getElementById('sg-overlay').classList.add('open');
    document.body.style.overflow = 'hidden';
  }
  function closeSizeGuide() {
    document.getElementById('sg-overlay').classList.remove('open');
    document.body.style.overflow = '';
  }

  // ── PROMO CODE ─────────────────────────────────────────────────────────
  function applyPromo() {
    var code = document.getElementById('co-promo').value.trim();
    if (!code) return;
    var msg = document.getElementById('promo-msg');
    var applyBtn = document.getElementById('promo-apply-btn');
    msg.className = '';
    msg.style.display = '';
    applyBtn.textContent = '…';
    applyBtn.disabled = true;
    fetch('/api/validate-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: code, orderTotal: checkoutSubtotal })
    })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      applyBtn.textContent = 'Apply';
      applyBtn.disabled = false;
      if (data.success) {
        appliedPromo  = data;
        promoDiscount = data.discount;
        msg.className = 'ok';
        msg.textContent = '✓ Code applied! You save GH₵' + promoDiscount.toFixed(2);
        document.getElementById('promo-discount-line').style.display = 'flex';
        document.getElementById('promo-code-lbl').textContent = data.code;
        document.getElementById('promo-disc-amt').textContent = '−GH₵' + promoDiscount.toFixed(2);
        updateCheckoutTotal();
      } else {
        appliedPromo  = null;
        promoDiscount = 0;
        msg.className = 'err';
        msg.textContent = data.message || 'Invalid promo code.';
        resetPromoDisplay();
      }
    })
    .catch(function() {
      applyBtn.textContent = 'Apply';
      applyBtn.disabled = false;
      msg.className = 'err';
      msg.textContent = 'Could not verify code. Check your connection.';
    });
  }
  function resetPromoDisplay() {
    document.getElementById('promo-discount-line').style.display = 'none';
    updateCheckoutTotal();
  }

  // ── REVIEWS ───────────────────────────────────────────────────────────
  let pickedRating = 0;
  const REVIEW_FORM_HTML = document.getElementById('review-modal-body').innerHTML;

  function initStarPicker() {
    pickedRating = 0;
    document.querySelectorAll('.star-opt').forEach(function(s) {
      s.addEventListener('mouseover', function() {
        const v = parseInt(s.dataset.v);
        document.querySelectorAll('.star-opt').forEach(function(x) { x.classList.toggle('lit', parseInt(x.dataset.v) <= v); });
      });
      s.addEventListener('mouseout', function() {
        document.querySelectorAll('.star-opt').forEach(function(x) { x.classList.toggle('lit', parseInt(x.dataset.v) <= pickedRating); });
      });
      s.addEventListener('click', function() {
        pickedRating = parseInt(s.dataset.v);
        document.querySelectorAll('.star-opt').forEach(function(x) { x.classList.toggle('lit', parseInt(x.dataset.v) <= pickedRating); });
      });
    });
  }

  function openReviewModal() {
    document.getElementById('review-modal-body').innerHTML = REVIEW_FORM_HTML;
    initStarPicker();
    document.getElementById('review-modal').classList.add('open');
    document.body.style.overflow = 'hidden';
  }
  function closeReviewModal() {
    document.getElementById('review-modal').classList.remove('open');
    document.body.style.overflow = '';
  }

  function submitReview() {
    const name       = document.getElementById('rev-name').value.trim();
    const location   = document.getElementById('rev-location').value.trim();
    const identifier = document.getElementById('rev-email').value.trim();
    const message    = document.getElementById('rev-message').value.trim();
    if (!name || !pickedRating || !message) {
      alert('Please fill in your name, star rating, and review.');
      return;
    }
    if (!identifier) {
      alert('Please enter the email or phone number you used when ordering so we can verify your purchase.');
      return;
    }
    // The single field accepts either — send it as whichever it looks like,
    // matching what checkout actually asked for (phone always; email only if given).
    const isEmail = identifier.includes('@');
    const email = isEmail ? identifier : '';
    const phone = isEmail ? '' : identifier;
    fetch('/api/reviews', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, location, email, phone, rating: pickedRating, message })
    })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (data.success) {
        // Was "has been posted" — reviews go into a pending-approval queue
        // (server.js sets approved:false), so that overstated what actually
        // happened; loadReviews() right after couldn't show it for the same reason.
        document.getElementById('review-modal-body').innerHTML =
          '<div class="rev-success"><div class="success-icon">✓</div><h3>Thank you!</h3><p>Your review has been submitted and is awaiting approval. We really appreciate it!</p></div>';
        setTimeout(closeReviewModal, 2800);
      } else {
        alert(data.message || 'Could not submit review. Please try again.');
      }
    })
    .catch(function() { alert('Network error. Please try again.'); });
  }

  function loadReviews() {
    fetch('/api/reviews')
      .then(function(r) { return r.json(); })
      .then(function(data) {
        const grid = document.getElementById('reviews-grid');
        if (!data.length) { grid.innerHTML = ''; return; }
        const sorted = data.slice().sort(function(a,b) { return b.createdAt - a.createdAt; });
        grid.innerHTML = sorted.map(function(r) {
          const initials = r.name.split(' ').map(function(w){ return w[0]; }).join('').toUpperCase().slice(0,2);
          const stars = '★'.repeat(r.rating) + '☆'.repeat(5 - r.rating);
          const isVerified = !!r.verified; // set when review linked to an order
          return '<div class="testi-c">' +
            '<div class="stars">' + stars + (isVerified ? ' <span style="font-size:10px;font-weight:700;color:#16a34a;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:20px;padding:2px 7px;margin-left:4px">✓ Verified</span>' : '') + '</div>' +
            '<blockquote>"' + escHtml(r.message) + '"</blockquote>' +
            '<div class="rev">' +
              '<div class="av">' + escHtml(initials) + '</div>' +
              '<div><div class="rev-name">' + escHtml(r.name) + '</div>' +
              (r.location ? '<div class="rev-loc">' + escHtml(r.location) + '</div>' : '') +
            '</div></div></div>';
        }).join('');
      });
  }

  // ── NEW ARRIVALS ───────────────────────────────────────────────────────
  function loadNewArrivals() {
    fetch('/api/new-arrivals')
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (!data || !data.length) return;
        var grid = document.getElementById('new-arrivals-grid');
        var now = Date.now();
        grid.innerHTML = data.map(function(p) {
          if (p.variants && p.variants.length > 0 && !(p.id in selectedColors)) {
            selectedColors[p.id] = vColor(p.variants[0]);
          }
          if (p.sizes && p.sizes.length > 0 && !(p.id in selectedSizes)) {
            selectedSizes[p.id] = '';
          }
          var curr = Number(p.price);
          var orig = Number(p.originalPrice);
          var onSale = orig > curr && orig > 0 && curr > 0;
          var pct = onSale ? Math.round((1 - curr / orig) * 100) : 0;
          var lowStock = !p.isSoldOut && p.stock !== null && p.stock !== undefined && p.stock > 0 && p.stock <= 5;
          var inWish = wishlist.includes(p.id);
          var heartBtn = '<button class="wish-btn' + (inWish ? ' wishlisted' : '') + '" onclick="event.stopPropagation();toggleWishlist(\'' + escJsAttr(p.id) + '\')" title="Save to wishlist">' + (inWish ? '♥' : '♡') + '</button>';
          var bsBadges = '';
          if (p.isSoldOut) {
            bsBadges = '<span class="pbadge pbadge-sold">✕ Sold Out</span>';
          } else if (onSale) {
            bsBadges = '<span class="pbadge pbadge-disc"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> −' + pct + '% OFF</span>'
              + '<span class="pbadge pbadge-info">Save GH&#8373;' + (orig - curr).toFixed(0) + '</span>';
          }
          if (lowStock) bsBadges += '<span class="pbadge pbadge-info">Only ' + p.stock + ' left</span>';
          var priceHtml = '<span class="pfrom">From</span><span class="prod-price-main">GH&#8373;' + curr.toFixed(2) + '</span>'
            + (onSale ? '<span class="prod-price-was">GH&#8373;' + orig.toFixed(2) + '</span>' : '');
          var arrowSvg = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>';
          return '<div class="prod-c' + (p.isSoldOut ? ' sold-out' : '') + '" data-product-id="' + escHtml(p.id) + '" onclick="openQV(\'' + escJsAttr(p.id) + '\')">'
            + '<div class="prod-img-wrap">'
              + '<img src="' + escHtml(p.image) + '" alt="' + escHtml(p.name) + '" loading="lazy" onerror="this.src=\'https://images.unsplash.com/photo-1581091226825-a6a2a5aee158?w=500\'"/>'
              + '<div class="prod-badges">' + bsBadges + '</div>'
              + heartBtn
            + '</div>'
            + '<div class="prod-info">'
              + '<h4>' + escHtml(p.name) + '</h4>'
              + swatchesHtml(p.variants, p.id)
              + '<div class="prod-foot">'
                + '<div class="prod-foot-price">' + priceHtml + '</div>'
                + '<button class="prod-arrow" onclick="event.stopPropagation();openQV(\'' + escJsAttr(p.id) + '\')" aria-label="View product">' + arrowSvg + '</button>'
              + '</div>'
            + '</div>'
          + '</div>';
        }).join('');
        document.getElementById('new-arrivals').style.display = '';
        arrivalsInit();
        startArrivalsTimer();
      })
      .catch(function() {});
  }

  // ── INIT — single bootstrap call loads settings + products + categories + zone map ──
  fetch('/api/bootstrap').then(function(r){ return r.json(); }).then(function(boot) {
    var s = boot.settings || {};
    // Wire products and categories immediately
    if (boot.categories) { enabledCategories = boot.categories; renderFooterCategories(); }
    if (boot.products)   {
      allProducts = boot.products;
      renderCategories(allProducts);
      applyFilters();
      openDeepLink();
      renderRecentlyViewed();
      dismissSplash();
    }
    // Continue with settings wiring below
  }).catch(function(e){ console.error("[bootstrap]", e); });

  fetch('/api/settings').then(function(r){ return r.json(); }).then(function(s) {
    // Runtime constants
    if (s.whatsapp) {
      WA = s.whatsapp;
      var waDelivLink = document.getElementById('co-wa-delivery');
      if (waDelivLink) waDelivLink.href = 'https://wa.me/' + WA + '?text=' + encodeURIComponent('Hi! I need help with my delivery area.');
    }

    // SEO — update page title and meta
    if (s.seoTitle) document.title = s.seoTitle;
    if (s.seoDescription) { var md = document.querySelector('meta[name="description"]'); if (md) md.setAttribute('content', s.seoDescription); }

    // Theme — accent colour and body font
    if (s.accentColor) document.documentElement.style.setProperty('--accent', s.accentColor);
    if (s.fontBody && s.fontBody !== 'Jost') {
      var link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = 'https://fonts.googleapis.com/css2?family=' + encodeURIComponent(s.fontBody) + ':wght@300;400;500;600&display=swap';
      document.head.appendChild(link);
      document.documentElement.style.setProperty('--fb', "'" + s.fontBody + "', sans-serif");
    }

    // WA links throughout the page
    var waNum  = s.whatsapp || '';
    var waUrl  = 'https://wa.me/' + waNum;
    var waDisp = waNum.startsWith('233') ? '0' + waNum.slice(3) : waNum;
    function $id(id){ return document.getElementById(id); }
    function setHref(id, href){ var el=$id(id); if(el) el.href = href; }
    function setTxt(id, txt){   var el=$id(id); if(el) el.textContent = txt; }
    function setHtml(id, html){ var el=$id(id); if(el) el.innerHTML  = html; }

    setHref('mn-wa', waUrl);
    setHref('ss-wa-cta', waUrl);
    setTxt('ss-wa-h', waDisp);
    setHref('strip-wa', waUrl);
    setTxt('strip-wa-txt', ' ' + waDisp);
    setHref('about-wa-btn', waUrl);
    setHref('cart-wa', waUrl);
    setHref('foot-wa', waUrl);
    setHref('sg-wa', waUrl);
    setHref('hero-wa-btn', waUrl);
    setHref('foot-contact-wa', waUrl);
    // WA island
    var waIsland = document.querySelector('.wa-island');
    if (waIsland) waIsland.href = waUrl;

    // Instagram
    if (s.instagram) {
      var igUrl = 'https://www.instagram.com/' + s.instagram + '/';
      setHref('ss-ig-cta', igUrl); setTxt('ss-ig-h', '@' + s.instagram);
      setHref('strip-ig', igUrl);  setTxt('strip-ig-txt', ' @' + s.instagram);
      setHref('foot-ig', igUrl); setHref('foot-co-ig', igUrl);
    }
    // Facebook
    if (s.facebook) {
      var fbUrl = s.facebook.startsWith('http') ? s.facebook : 'https://www.facebook.com/' + s.facebook;
      setHref('ss-fb-cta', fbUrl); setHref('foot-fb', fbUrl); setHref('foot-co-fb', fbUrl);
    }
    // TikTok
    if (s.tiktok) {
      var ttUrl = 'https://www.tiktok.com/@' + s.tiktok.replace(/^@/,'');
      setHref('ss-tt-cta', ttUrl); setTxt('ss-tt-h', '@' + s.tiktok.replace(/^@/,''));
      setHref('foot-tt', ttUrl); setHref('foot-co-tt', ttUrl);
    }
    // Snapchat
    if (s.snapchat) {
      var scUrl = 'https://www.snapchat.com/add/' + s.snapchat;
      setHref('ss-sc-cta', scUrl); setTxt('ss-sc-h', s.snapchat);
      setHref('foot-sc', scUrl); setHref('foot-co-sc', scUrl);
    }
    // Email
    if (s.storeEmail) {
      setHref('strip-email', 'mailto:' + s.storeEmail); setTxt('strip-email-txt', ' ' + s.storeEmail);
      var fe = $id('foot-email'); if(fe){ fe.href = 'mailto:' + s.storeEmail; fe.textContent = s.storeEmail; }
      setHref('foot-cc-email', 'mailto:' + s.storeEmail);
    }
    setHref('foot-cc-wa', waUrl);
    // Phone (derived from WA number for footer)
    var fp = $id('foot-phone');
    if (fp) { fp.href = 'tel:+' + waNum; fp.textContent = waDisp; }

    // Hero
    if (s.heroPill)     setTxt('hero-pill', s.heroPill);
    if (s.heroHeadline) setHtml('hero-headline', s.heroHeadline);
    if (s.heroSub)      setHtml('hero-sub', s.heroSub);

    // About
    if (s.aboutHeading) setHtml('about-heading', s.aboutHeading);
    if (s.aboutBody) {
      var wrap = $id('about-body-wrap');
      if (wrap) wrap.innerHTML = s.aboutBody.replace(/\r\n/g,'\n').replace(/\r/g,'\n').split('\n\n').filter(Boolean).map(function(p){ return '<p>' + p + '</p>'; }).join('');
    }

    // Footer
    if (s.footerTagline) setTxt('foot-tagline', s.footerTagline);
    if (s.storeName)     setTxt('foot-logo-text', s.storeName);

    // Trust strip
    ['trustLine1','trustLine2','trustLine3','trustLine4'].forEach(function(k, i){
      if (s[k]) setHtml('trust-' + (i+1), s[k]);
    });

    // Announcement banner
    var bar = document.getElementById('announce-bar');
    if (s.announcementOn && s.announcement) {
      document.getElementById('announce-text').innerHTML = s.announcement;
      bar.style.display = '';
    }

    // Free delivery thresholds
    if (s.storeName) STORE_NAME = s.storeName;
    if (s.freeDeliveryThreshold) FD_THRESHOLD = parseFloat(s.freeDeliveryThreshold) || 200;
    if (s.freeDeliveryZone)      FD_ZONE = s.freeDeliveryZone;
    qvRefreshStoreInfo();

    // Flash sale countdown
    if (s.saleEnabled && s.saleEndDate) {
      startFlashSaleCountdown(s.saleEndDate, s.saleMessage || 'Flash Sale ends in');
    }

    // Featured banner
    if (s.featuredBannerEnabled) {
      var fb = $id('feat-banner');
      if (fb) {
        if (s.featuredBannerHeadline) setHtml('feat-banner-headline', s.featuredBannerHeadline);
        if (s.featuredBannerSub)      setTxt('feat-banner-sub', s.featuredBannerSub);
        if (s.featuredBannerCta)      setTxt('feat-banner-cta', s.featuredBannerCta);
        if (s.featuredBannerLink) {
          var cta = $id('feat-banner-cta');
          if (cta) cta.href = s.featuredBannerLink;
        }
        fb.style.display = 'block';
      }
    }

    // Brand video section
    if (s.brandVideoUrl) {
      brandVideoUrl = s.brandVideoUrl;
      var bvSec = $id('brand-video-sec');
      if (bvSec) bvSec.style.display = 'block';
      if (s.brandVideoTitle) setHtml('brand-video-title', s.brandVideoTitle);
      var thumb = getYtThumb(s.brandVideoUrl);
      if (thumb) { var ti = $id('brand-video-thumb-img'); if (ti) { ti.src = thumb; ti.style.display = 'block'; } }
    }

    // Hero video slide
    if (s.heroVideoEnabled) {
      var hvSlide = $id('hero-video-slide');
      var hvDot   = $id('hero-dot-3');
      if (hvSlide) hvSlide.style.display = '';
      if (hvDot)   hvDot.style.display = '';
      var vid = $id('hero-video-el');
      if (vid) vid.src = '/assets/images/hero-video.mp4';
      heroTotal = 4;
    }

    // Shop closed overlay
    if (s.shopOpen === false) {
      var overlay = document.createElement('div');
      overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(26,26,26,.96);display:flex;align-items:center;justify-content:center;padding:24px;';
      overlay.innerHTML = '<div style="text-align:center;color:#fff;max-width:400px"><p style="font-size:40px;margin:0 0 16px"></p><h2 style="font-size:24px;font-weight:800;margin:0 0 12px;color:#fff">Shop Temporarily Closed</h2><p style="font-size:15px;color:rgba(255,255,255,.7);line-height:1.6;margin:0">' + (s.shopClosedMsg || 'We\'re temporarily closed. Check back soon!') + '</p></div>';
      document.body.appendChild(overlay);
    }
  }).catch(function(){});

  // Load FAQs dynamically
  fetch('/api/faqs').then(function(r){ return r.json(); }).then(function(items) {
    var list = document.getElementById('faq-list');
    if (!list) return;
    list.innerHTML = items.map(function(f){
      return '<div class="faq-item">'
        + '<button class="faq-q" onclick="toggleFaq(this)">' + escHtml(f.q) + ' <span class="faq-icon">+</span></button>'
        + '<div class="faq-a"><div class="faq-a-inner">' + escHtml(f.a) + '</div></div>'
        + '</div>';
    }).join('');
  }).catch(function(){});

  loadReviews();
  loadNewArrivals();
  updateCartCount();
  updateWishCount();

  document.addEventListener('keydown', function(e) {
    var qvOv = document.getElementById('qv-overlay');
    var sgOpen = document.getElementById('sg-overlay').classList.contains('open');
    if (qvOv.classList.contains('open') && !sgOpen) {
      if (e.key === 'ArrowLeft'  && qvGallery.length > 1) { qvNav(-1); return; }
      if (e.key === 'ArrowRight' && qvGallery.length > 1) { qvNav(1);  return; }
      if (e.key === 'Tab') {
        var f = Array.prototype.filter.call(qvOv.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'), function(n) { return !n.disabled && !n.hidden && n.offsetParent !== null; });
        if (f.length) {
          var first = f[0], last = f[f.length - 1];
          if (e.shiftKey && (document.activeElement === first || !qvOv.contains(document.activeElement))) { e.preventDefault(); last.focus(); }
          else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        }
        return;
      }
    }
    if (e.key !== 'Escape') return;
    if (sgOpen) { closeSizeGuide(); return; }
    if (qvOv.classList.contains('open'))     { closeQV(); return; }
    if (document.getElementById('cart-sidebar').classList.contains('open'))   { closeCart(); return; }
    if (document.getElementById('checkout-modal').classList.contains('open')) { closeCheckout(); return; }
    if (document.getElementById('success-overlay').classList.contains('open')){ closeSuccess(); return; }
    if (document.getElementById('notify-modal').classList.contains('open'))   { closeNotify(); return; }
    if (document.getElementById('wish-sidebar').classList.contains('open'))   { closeWishlist(); return; }
    if (document.getElementById('sg-overlay').classList.contains('open')){ closeSizeGuide(); return; }
    if (document.getElementById('video-modal-overlay').classList.contains('open')){ closeVideoModal(); return; }
    if (document.getElementById('review-modal').classList.contains('open')) { closeReviewModal(); return; }
  });

  // Show the shape of the grid while products load (skeleton cards) instead of a bare "Loading…" line
  if (!allProducts.length) document.getElementById('shop-grid').innerHTML =
    Array(8).fill('<div class="skel-card" aria-hidden="true"><div class="skel skel-img"></div><div class="skel skel-line"></div><div class="skel skel-line short"></div></div>').join('');
  // Products are loaded by the bootstrap call above — this is a fallback
  setTimeout(function() {
    if (!allProducts.length) {
      fetch('/api/products').then(r => r.json()).then(data => {
        allProducts = data; renderCategories(allProducts); applyFilters(); renderRecentlyViewed(); dismissSplash(); openDeepLink();
      }).catch(() => {
        document.getElementById('shop-grid').innerHTML = '<div class="empty-state"><p>Could not load products. Please refresh.</p></div>';
        dismissSplash();
      });
    }
  }, 3000);

  // ── NEW ARRIVALS INFINITE CAROUSEL ─────────────────────────────────────
  var arrivalsRAF = null;
  var arrivalsOriginalWidth = 0;
  var arrivalsOffset = 0;
  var arrivalsPaused = false;
  var arrivalsSpeed = 1.1; // px per frame (~66px/s at 60fps)

  function arrivalsInit() {
    var track = document.getElementById('new-arrivals-grid');
    if (!track) return;
    var original = track.innerHTML;
    track.innerHTML = original + original;
    // Defer so the browser has laid out the duplicated content before measuring
    requestAnimationFrame(function() {
      arrivalsOriginalWidth = track.scrollWidth / 2;
    });
  }

  function arrivalsLoop() {
    var track = document.getElementById('new-arrivals-grid');
    if (track) {
      // Lazily grab width once layout is ready
      if (!arrivalsOriginalWidth && track.scrollWidth > 0) {
        arrivalsOriginalWidth = track.scrollWidth / 2;
      }
      if (!arrivalsPaused && arrivalsOriginalWidth > 0) {
        arrivalsOffset -= arrivalsSpeed;
        if (arrivalsOffset <= -arrivalsOriginalWidth) {
          arrivalsOffset += arrivalsOriginalWidth;
        }
        track.style.transform = 'translateX(' + arrivalsOffset + 'px)';
      }
    }
    arrivalsRAF = requestAnimationFrame(arrivalsLoop);
  }

  function startArrivalsTimer() {
    if (arrivalsRAF) cancelAnimationFrame(arrivalsRAF);
    arrivalsOffset = 0;
    arrivalsLoop();
  }

  function arrivalsScroll(dir) {
    if (!arrivalsOriginalWidth) return;
    var track = document.getElementById('new-arrivals-grid');
    if (!track) return;
    var card = track.querySelector('.prod-c');
    var step = card ? (card.offsetWidth + 18) * 2 : 480;
    arrivalsOffset -= dir * step;
    while (arrivalsOffset <= -arrivalsOriginalWidth) arrivalsOffset += arrivalsOriginalWidth;
    while (arrivalsOffset > 0) arrivalsOffset -= arrivalsOriginalWidth;
    track.style.transform = 'translateX(' + arrivalsOffset + 'px)';
  }

  document.addEventListener('DOMContentLoaded', function() {
    var wrap = document.querySelector('.arrivals-track-wrap');
    if (!wrap) return;

    var isDragging   = false;
    var dragStartX   = 0;
    var dragStartOff = 0;
    var hasDragged   = false;
    var resumeTimer  = null;

    function dragStart(x) {
      isDragging   = true;
      hasDragged   = false;
      dragStartX   = x;
      dragStartOff = arrivalsOffset;
      arrivalsPaused = true;
      clearTimeout(resumeTimer);
      wrap.classList.add('arr-dragging');
    }

    function dragMove(x) {
      if (!isDragging) return;
      var delta = x - dragStartX;
      if (Math.abs(delta) > 4) hasDragged = true;
      var track = document.getElementById('new-arrivals-grid');
      if (!track || !arrivalsOriginalWidth) return;
      arrivalsOffset = dragStartOff + delta;
      // Keep within infinite-loop bounds
      while (arrivalsOffset <= -arrivalsOriginalWidth) arrivalsOffset += arrivalsOriginalWidth;
      while (arrivalsOffset >  0)                      arrivalsOffset -= arrivalsOriginalWidth;
      track.style.transform = 'translateX(' + arrivalsOffset + 'px)';
    }

    function dragEnd() {
      if (!isDragging) return;
      isDragging = false;
      wrap.classList.remove('arr-dragging');
      // Resume auto-scroll after 2.5 s of inactivity
      resumeTimer = setTimeout(function() { arrivalsPaused = false; }, 2500);
    }

    // ── Mouse ────────────────────────────────────────────────────────────
    wrap.addEventListener('mousedown', function(e) {
      e.preventDefault();
      dragStart(e.clientX);
    });
    document.addEventListener('mousemove', function(e) { dragMove(e.clientX); });
    document.addEventListener('mouseup',   dragEnd);

    // ── Touch ────────────────────────────────────────────────────────────
    wrap.addEventListener('touchstart', function(e) {
      dragStart(e.touches[0].clientX);
    }, { passive: true });

    wrap.addEventListener('touchmove', function(e) {
      dragMove(e.touches[0].clientX);
      if (hasDragged) e.preventDefault(); // block page scroll only when actually dragging
    }, { passive: false });

    wrap.addEventListener('touchend', dragEnd, { passive: true });

    // Block card click/open if the user actually dragged (not just tapped)
    wrap.addEventListener('click', function(e) {
      if (hasDragged) {
        e.stopPropagation();
        e.preventDefault();
        hasDragged = false;
      }
    }, true);
  });

  // ── SWIPE TO DISMISS MODALS ────────────────────────────────────────────
  (function() {
    var modals = [
      { id: 'checkout-modal',   close: closeCheckout },
      { id: 'account-modal',    close: closeAccountModal },
      { id: 'cart-sidebar',      close: closeCart },
      { id: 'wish-sidebar',      close: closeWishlist },
    ];
    modals.forEach(function(m) {
      var el = document.getElementById(m.id);
      if (!el) return;
      var startY = 0, startX = 0;
      el.addEventListener('touchstart', function(e) {
        startY = e.touches[0].clientY;
        startX = e.touches[0].clientX;
      }, { passive: true });
      el.addEventListener('touchend', function(e) {
        var dy = e.changedTouches[0].clientY - startY;
        var dx = Math.abs(e.changedTouches[0].clientX - startX);
        // Swipe down >80px and mostly vertical → dismiss
        if (dy > 80 && dx < 60 && e.target === el) m.close();
      }, { passive: true });
    });
  })();

  // ── COLOR SWATCHES ─────────────────────────────────────────────────────
  var COLOR_MAP = {
    'black':'#1a1a1a','white':'#f5f5f5','red':'#e63946','blue':'#2563eb','navy':'#1e3a5f',
    'green':'#16a34a','olive':'#6b7e3c','yellow':'#facc15','orange':'#f97316','pink':'#ec4899',
    'purple':'#9333ea','brown':'#78350f','cream':'#fef3c7','ivory':'#f5f0e8','beige':'#d4b896',
    'grey':'#9ca3af','gray':'#9ca3af','gold':'#ca8a04','silver':'#94a3b8','maroon':'#9f1239',
    'teal':'#0d9488','coral':'#f87171','mint':'#86efac','lavender':'#c4b5fd','khaki':'#bfa46a',
    'camel':'#c4893e','rust':'#c2410c','sky':'#38bdf8','osu':'#1a1a1a','champagne':'#f0d9b5',
    'peach':'#fca5a5','mustard':'#d97706','emerald':'#059669','burgundy':'#881337','cyan':'#06b6d4'
  };
  function colorHex(name) {
    var lower = (name || '').toLowerCase();
    if (lower.includes('multi') || lower.includes('rainbow')) {
      return 'linear-gradient(135deg,#e63946 0%,#f97316 20%,#facc15 40%,#16a34a 60%,#2563eb 80%,#9333ea 100%)';
    }
    var words = lower.split(/[^a-z]+/).filter(Boolean);
    for (var i = 0; i < words.length; i++) { if (COLOR_MAP[words[i]]) return COLOR_MAP[words[i]]; }
    return '#ccc';
  }
  function swatchesHtml(variants, productId) {
    if (!variants || !variants.length) return '';
    var activeName = productId ? (selectedColors[productId] || '') : '';
    var dots = variants.slice(0, 6).map(function(v) {
      var name = vColor(v);
      if (!name) return '';
      var col = colorHex(name);
      var unavail = vUnavail(v);
      var isActive = activeName === name;
      var bg = 'background:' + col;
      var ring = isActive ? ';box-shadow:0 0 0 2px #fff,0 0 0 3.5px #C9971C' : '';
      var dim = unavail ? ';opacity:.35;filter:grayscale(1)' : '';
      var unavailAttr = unavail ? ' data-unavail="1"' : '';
      return '<span class="color-dot" data-color="' + escHtml(name) + '"' + unavailAttr
        + ' style="' + bg + ring + dim + '"'
        + ' title="' + escHtml(name) + (unavail ? ' (out of stock)' : '') + '"></span>';
    }).join('');
    return '<div class="card-swatches">' + dots + '</div>';
  }

  function cardPickColor(productId, color) {
    selectedColors[productId] = color;
    var p = allProducts.find(function(x) { return x.id === productId; });
    if (!p) return;
    var v = variantForColor(p, color);
    var imgSrc = (v && vImage(v)) ? vImage(v) : p.image;
    // update ALL cards for this product (same product can appear in multiple sections)
    document.querySelectorAll('[data-product-id="' + productId + '"]').forEach(function(cardEl) {
      var imgEl = cardEl.querySelector('.prod-img-wrap img');
      if (imgEl && imgSrc) imgEl.src = imgSrc;
      cardEl.querySelectorAll('.color-dot').forEach(function(dot) {
        dot.style.boxShadow = dot.dataset.color === color ? '0 0 0 2px #fff,0 0 0 3.5px #C9971C' : '';
      });
    });
  }

  // Delegated listener — fires for all current and future card swatches
  document.addEventListener('click', function(e) {
    var dot = e.target.closest('.color-dot');
    if (!dot || dot.dataset.unavail) return;
    e.stopPropagation();
    var card = dot.closest('[data-product-id]');
    if (!card) return;
    cardPickColor(card.dataset.productId, dot.dataset.color);
  }, true); // capture phase so it fires before the card's onclick

  // ── FREE DELIVERY BAR ──────────────────────────────────────────────────
  var FD_THRESHOLD = 200;
  var FD_ZONE = 'Accra';
  var fdWasUnlocked = false;
  function renderFreeDeliveryBar(subtotal) {
    var wrap = document.getElementById('fd-bar-wrap');
    var msg  = document.getElementById('fd-bar-msg');
    var fill = document.getElementById('fd-fill');
    if (!wrap || !msg || !fill) return;
    var pct = Math.min(100, Math.round((subtotal / FD_THRESHOLD) * 100));
    fill.style.width = pct + '%';
    var isUnlocked = subtotal >= FD_THRESHOLD;
    if (isUnlocked) {
      msg.innerHTML = 'You\'ve unlocked <strong>free delivery</strong> in ' + escHtml(FD_ZONE) + '!';
      wrap.classList.add('fd-unlocked');
      // Trigger celebration only on the moment it flips to unlocked
      if (!fdWasUnlocked) {
        wrap.classList.remove('fd-celebrate');
        void wrap.offsetWidth; // force reflow to restart animation
        wrap.classList.add('fd-celebrate');
      }
    } else {
      wrap.classList.remove('fd-unlocked', 'fd-celebrate');
      var left = (FD_THRESHOLD - subtotal).toFixed(2);
      msg.innerHTML = 'Add <strong>GH&#8373;' + left + '</strong> more for free delivery in ' + escHtml(FD_ZONE);
    }
    fdWasUnlocked = isUnlocked;
    wrap.style.display = '';
  }

  // ── RECENTLY VIEWED ────────────────────────────────────────────────────
  var RV_KEY = 'freeman_rv';
  var RV_MAX = 8;
  function getRecentlyViewed() {
    try { return JSON.parse(localStorage.getItem(RV_KEY) || '[]'); } catch(e) { return []; }
  }
  function trackRecentlyViewed(id) {
    var rv = getRecentlyViewed().filter(function(x) { return x !== id; });
    rv.unshift(id);
    if (rv.length > RV_MAX) rv = rv.slice(0, RV_MAX);
    try { localStorage.setItem(RV_KEY, JSON.stringify(rv)); } catch(e) {}
  }
  function renderRecentlyViewed() {
    var ids = getRecentlyViewed();
    if (!ids.length || !allProducts.length) return;
    var prods = ids.map(function(id) { return allProducts.find(function(p) { return p.id === id; }); }).filter(Boolean);
    if (prods.length < 2) return;
    var track = document.getElementById('rv-track');
    var sec   = document.getElementById('rv-section');
    if (!track || !sec) return;
    track.innerHTML = prods.map(function(p) {
      var curr = Number(p.price);
      var arrowSvg = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>';
      return '<div class="prod-c' + (p.isSoldOut ? ' sold-out' : '') + '" data-product-id="' + escHtml(p.id) + '" onclick="openQV(\'' + escJsAttr(p.id) + '\')">'
        + '<div class="prod-img-wrap"><img src="' + escHtml(p.image) + '" alt="' + escHtml(p.name) + '" loading="lazy" onerror="this.src=\'https://images.unsplash.com/photo-1581091226825-a6a2a5aee158?w=500\'"/></div>'
        + '<div class="prod-info"><h4>' + escHtml(p.name) + '</h4>'
        + swatchesHtml(p.variants, p.id)
        + '<div class="prod-foot"><div class="prod-foot-price"><span class="pfrom">From</span><span class="prod-price-main">GH&#8373;' + curr.toFixed(2) + '</span></div>'
        + '<button class="prod-arrow" onclick="event.stopPropagation();openQV(\'' + escJsAttr(p.id) + '\')" aria-label="View product">' + arrowSvg + '</button>'
        + '</div></div></div>';
    }).join('');
    sec.style.display = '';
  }

  // ── FLASH SALE COUNTDOWN ───────────────────────────────────────────────
  var flashSaleInterval = null;
  function startFlashSaleCountdown(endDateStr, message) {
    var bar = document.getElementById('flash-sale-bar');
    var msgEl = document.getElementById('flash-sale-msg');
    var cdEl  = document.getElementById('flash-countdown');
    if (!bar || !cdEl) return;
    if (message) msgEl.textContent = message + ' ';
    var endMs = new Date(endDateStr).getTime();
    if (isNaN(endMs)) return;
    function tick() {
      var diff = endMs - Date.now();
      if (diff <= 0) {
        bar.style.display = 'none';
        clearInterval(flashSaleInterval);
        return;
      }
      var h = Math.floor(diff / 3600000);
      var m = Math.floor((diff % 3600000) / 60000);
      var s = Math.floor((diff % 60000) / 1000);
      cdEl.textContent = String(h).padStart(2,'0') + ':' + String(m).padStart(2,'0') + ':' + String(s).padStart(2,'0');
    }
    tick();
    if (flashSaleInterval) clearInterval(flashSaleInterval);
    flashSaleInterval = setInterval(tick, 1000);
    bar.style.display = 'block';
  }

  // ── BRAND VIDEO MODAL ──────────────────────────────────────────────────
  var brandVideoUrl = '';
  function getYtEmbedUrl(url) {
    var m = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|v\/))([A-Za-z0-9_-]{11})/);
    if (m) return 'https://www.youtube.com/embed/' + m[1] + '?autoplay=1&rel=0';
    var v = url.match(/(?:vimeo\.com\/)(\d+)/);
    if (v) return 'https://player.vimeo.com/video/' + v[1] + '?autoplay=1';
    return url;
  }
  function getYtThumb(url) {
    var m = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|v\/))([A-Za-z0-9_-]{11})/);
    return m ? 'https://img.youtube.com/vi/' + m[1] + '/hqdefault.jpg' : '';
  }
  function openVideoModal() {
    if (!brandVideoUrl) return;
    document.getElementById('video-modal-frame').src = getYtEmbedUrl(brandVideoUrl);
    document.getElementById('video-modal-overlay').classList.add('open');
    document.body.style.overflow = 'hidden';
  }
  function closeVideoModal() {
    document.getElementById('video-modal-frame').src = '';
    document.getElementById('video-modal-overlay').classList.remove('open');
    document.body.style.overflow = '';
  }

  // ── BACK TO TOP ────────────────────────────────────────────────────────
  (function() {
    var btn = document.getElementById('back-top');
    if (!btn) return;
    window.addEventListener('scroll', function() {
      btn.classList.toggle('show', window.scrollY > 400);
    }, { passive: true });
  })();

  // ── NAV SCROLL GLASSY ──────────────────────────────────────────────────
  (function() {
    var nav = document.querySelector('nav');
    if (!nav) return;
    window.addEventListener('scroll', function() {
      nav.classList.toggle('scrolled', window.scrollY > 20);
    }, { passive: true });
  })();

  // ── SCROLL REVEAL ──────────────────────────────────────────────────────
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

  // ── HERO SLIDESHOW ──────────────────────────────────────────────────────
  var heroCurrent = 0;
  var heroTotal = 3;
  var heroTimer;
  function heroGoTo(n) {
    document.querySelectorAll('.hero-slide').forEach(function(s, i) { s.classList.toggle('active', i === n); });
    document.querySelectorAll('#hero-dots .hero-dot').forEach(function(d, i) { d.classList.toggle('active', i === n); });
    heroCurrent = n;
    var vid = document.getElementById('hero-video-el');
    if (vid) { n === 3 ? vid.play().catch(function(){}) : vid.pause(); }
  }
  function heroNext() { heroGoTo((heroCurrent + 1) % heroTotal); }
  heroTimer = setInterval(heroNext, 5000);
  document.querySelectorAll('#hero-dots .hero-dot').forEach(function(d) {
    d.addEventListener('click', function() { clearInterval(heroTimer); heroTimer = setInterval(heroNext, 5000); });
  });

  // ── CUSTOMER ACCOUNTS ───────────────────────────────────────────────────
  var AUTH_KEY = 'freeman_auth';
  var GOOGLE_CLIENT_ID = '1087064685632-co79opd5u3vs1qi942khk1pav003130o.apps.googleusercontent.com';
  var currentAccount = null;

  // Initialise Google Identity Services once the GIS script loads
  function initGoogleSignIn() {
    if (typeof google === 'undefined' || !google.accounts) return;
    google.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      callback: handleGoogleCredential,
      auto_select: false,
      cancel_on_tap_outside: true
    });
    renderGoogleButtons();
  }

  function renderGoogleButtons() {
    if (typeof google === 'undefined' || !google.accounts) return;
    ['g-signin-btn', 'g-signup-btn'].forEach(function(id) {
      var el = document.getElementById(id);
      if (!el) return;
      el.innerHTML = '';
      google.accounts.id.renderButton(el, {
        type: 'standard',
        shape: 'rectangular',
        theme: 'outline',
        text: id === 'g-signup-btn' ? 'signup_with' : 'signin_with',
        size: 'large',
        width: 280,
        logo_alignment: 'left'
      });
    });
  }

  function handleGoogleCredential(response) {
    var errEl = document.getElementById('acct-login-err');
    if (errEl) { errEl.style.display = 'none'; }
    fetch('/api/auth/google', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credential: response.credential })
    })
    .then(function(r) { return r.json(); })
    .then(function(d) {
      if (d.token) {
        localStorage.setItem(AUTH_KEY, d.token);
        setAccountUI(d.customer);
        closeAccountModal();
        wishlist = loadWishlist(); updateWishCount();
      } else {
        if (errEl) { errEl.textContent = d.error || 'Google sign-in failed.'; errEl.style.display = ''; }
      }
    })
    .catch(function() {
      if (errEl) { errEl.textContent = 'Network error. Please try again.'; errEl.style.display = ''; }
    });
  }

  // Render buttons when modal opens (GIS may not have loaded yet on first open)
  var _gsiInited = false;
  function ensureGoogleButtons() {
    if (!_gsiInited && typeof google !== 'undefined' && google.accounts) {
      initGoogleSignIn();
      _gsiInited = true;
    } else if (_gsiInited) {
      renderGoogleButtons();
    }
  }

  function authHeaders() {
    var t = localStorage.getItem(AUTH_KEY);
    return t ? { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + t } : { 'Content-Type': 'application/json' };
  }

  // Called by Google GIS once it's ready
  window.onGoogleLibraryLoad = function() {
    if (!_gsiInited) { initGoogleSignIn(); _gsiInited = true; }
  };

  function initAccount() {
    var token = localStorage.getItem(AUTH_KEY);
    if (!token) return;
    fetch('/api/auth/me', { headers: { 'Authorization': 'Bearer ' + token } })
      .then(function(r) { return r.ok ? r.json() : Promise.reject(); })
      .then(function(c) { setAccountUI(c); })
      .catch(function() { localStorage.removeItem(AUTH_KEY); });
  }

  function setAccountUI(c) {
    currentAccount = c;
    var nameEl   = document.getElementById('acct-nav-name');
    var btn      = document.getElementById('acct-nav-btn');
    var avatarEl = document.getElementById('acct-avatar');
    if (nameEl) { nameEl.textContent = c.name.split(' ')[0]; nameEl.style.display = ''; }
    if (btn) btn.classList.add('acct-signed-in');
    // Show Google profile picture in avatar if available
    if (avatarEl) {
      if (c.picture) {
        avatarEl.innerHTML = '<img src="' + escHtml(c.picture) + '" alt="' + escHtml(c.name) + '" style="width:100%;height:100%;border-radius:50%;object-fit:cover"/>';
      } else {
        avatarEl.textContent = c.name ? c.name[0].toUpperCase() : '?';
      }
    }
    // Show Google profile picture in nav button too
    if (btn && c.picture) {
      btn.style.backgroundImage = 'url(' + c.picture + ')';
      btn.style.backgroundSize  = 'cover';
      btn.style.backgroundPosition = 'center';
    }
    // Pre-fill checkout fields
    var f = { 'co-name': c.name, 'co-email': c.email, 'co-phone': c.phone, 'co-address': c.address };
    Object.keys(f).forEach(function(id) { var el = document.getElementById(id); if (el && !el.value && f[id]) el.value = f[id]; });
  }

  function openAccountModal() {
    var modal = document.getElementById('account-modal');
    if (!modal) return;
    if (currentAccount) {
      showAcctLoggedIn();
      switchAcctSection('orders');
    } else {
      showAcctAuth();
      switchAcctTab('login');
    }
    modal.classList.add('open');
    document.body.style.overflow = 'hidden';
    if (!currentAccount) setTimeout(ensureGoogleButtons, 50);
  }

  function closeAccountModal() {
    var modal = document.getElementById('account-modal');
    if (modal) modal.classList.remove('open');
    document.body.style.overflow = '';
  }

  function showAcctAuth() {
    document.getElementById('acct-auth-view').style.display = '';
    document.getElementById('acct-loggedin-view').style.display = 'none';
  }

  function showAcctLoggedIn() {
    document.getElementById('acct-auth-view').style.display = 'none';
    document.getElementById('acct-loggedin-view').style.display = '';
    var c = currentAccount;
    document.getElementById('acct-display-name').textContent  = c.name;
    document.getElementById('acct-display-email').textContent = c.email;
    document.getElementById('acct-prof-name').value  = c.name    || '';
    document.getElementById('acct-prof-phone').value = c.phone   || '';
    document.getElementById('acct-prof-addr').value  = c.address || '';

    // Email verification badge
    var badge = document.getElementById('acct-email-badge');
    if (badge) {
      if (c.googleId) {
        badge.textContent = '✓ Google'; badge.style.cssText = 'display:inline;font-size:10px;font-weight:700;padding:2px 7px;border-radius:20px;background:#e8f0fe;color:#1a73e8';
      } else if (c.emailVerified === false) {
        badge.textContent = 'Unverified'; badge.style.cssText = 'display:inline;font-size:10px;font-weight:700;padding:2px 7px;border-radius:20px;background:#fff7ed;color:#c2410c';
      } else {
        badge.textContent = '✓ Verified'; badge.style.cssText = 'display:inline;font-size:10px;font-weight:700;padding:2px 7px;border-radius:20px;background:#f0fdf4;color:#16a34a';
      }
    }

    // Hide change-password for Google-only accounts
    var pwWrap = document.getElementById('acct-change-pw-wrap');
    if (pwWrap) pwWrap.style.display = c.googleId && !c.passwordHash ? 'none' : '';

    // Email verification banner
    var banner = document.getElementById('acct-verify-banner');
    if (banner) banner.style.display = (c.emailVerified === false && !c.googleId) ? '' : 'none';

    // Load order stats
    fetch('/api/auth/me/orders', { headers: authHeaders() })
      .then(function(r) { return r.json(); })
      .then(function(orders) {
        var statsEl = document.getElementById('acct-stats');
        var ordEl   = document.getElementById('acct-stat-orders');
        var spentEl = document.getElementById('acct-stat-spent');
        if (statsEl && orders.length) {
          var total = orders.reduce(function(s, o) { return s + (parseFloat(o.total) || 0); }, 0);
          if (ordEl)   ordEl.textContent   = orders.length;
          if (spentEl) spentEl.textContent = 'GH₵' + total.toFixed(0);
          statsEl.style.display = 'flex';
        }
      }).catch(function() {});
  }

  function switchAcctTab(tab) {
    document.getElementById('acct-login-form').style.display   = tab === 'login'    ? '' : 'none';
    document.getElementById('acct-reg-form').style.display     = tab === 'register' ? '' : 'none';
    document.getElementById('acct-forgot-form').style.display  = tab === 'forgot'   ? '' : 'none';
    document.getElementById('acct-tab-login').classList.toggle('active',    tab === 'login');
    document.getElementById('acct-tab-register').classList.toggle('active', tab === 'register');
    document.getElementById('acct-login-err').style.display = 'none';
    document.getElementById('acct-reg-err').style.display   = 'none';
  }

  function showForgotPassword() {
    switchAcctTab('forgot');
  }

  function sendForgotPassword() {
    var email = document.getElementById('acct-forgot-email').value.trim();
    var msg   = document.getElementById('acct-forgot-msg');
    if (!email) { msg.textContent = 'Please enter your email.'; msg.style.cssText = 'display:block;color:#dc2626'; return; }
    fetch('/api/auth/forgot-password', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    }).then(r => r.json()).then(function(d) {
      msg.textContent = d.message || 'Check your email for a reset link.';
      msg.style.cssText = 'display:block;color:#16a34a';
    }).catch(function() {
      msg.textContent = 'Something went wrong. Try again.';
      msg.style.cssText = 'display:block;color:#dc2626';
    });
  }

  // Handle password reset token from URL (?reset=TOKEN)
  (function() {
    var params = new URLSearchParams(window.location.search);
    var token  = params.get('reset');
    if (!token) return;
    // Show reset form
    var modal = document.getElementById('account-modal');
    if (modal) modal.classList.add('open');
    var authView = document.getElementById('acct-auth-view');
    if (authView) {
      authView.insertAdjacentHTML('beforeend',
        '<div id="acct-reset-form" style="margin-top:16px">' +
        '<p style="font-size:13px;color:#555;margin:0 0 12px">Choose a new password for your account.</p>' +
        '<div class="acct-field"><input type="password" id="acct-reset-pass" placeholder="New password (min 6 characters)"/></div>' +
        '<div id="acct-reset-msg" style="display:none;font-size:13px;margin-bottom:10px"></div>' +
        '<button class="acct-submit" onclick="submitPasswordReset(\'' + escJsAttr(token) + '\')">Update Password</button>' +
        '</div>');
      // Hide other forms
      var lf = document.getElementById('acct-login-form');
      if (lf) lf.style.display = 'none';
      var tabs = document.querySelector('.acct-tabs');
      if (tabs) tabs.style.display = 'none';
    }
  })();

  function submitPasswordReset(token) {
    var pass = document.getElementById('acct-reset-pass').value;
    var msg  = document.getElementById('acct-reset-msg');
    if (!pass || pass.length < 6) { msg.textContent = 'Password must be at least 6 characters.'; msg.style.cssText = 'display:block;color:#dc2626'; return; }
    fetch('/api/auth/reset-password', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, password: pass })
    }).then(r => r.json()).then(function(d) {
      if (d.success) {
        msg.textContent = '✓ Password updated! You can now sign in.';
        msg.style.cssText = 'display:block;color:#16a34a';
        history.replaceState({}, '', '/');
        setTimeout(function() { switchAcctTab('login'); }, 2000);
      } else {
        msg.textContent = d.error || 'Failed. Please request a new link.';
        msg.style.cssText = 'display:block;color:#dc2626';
      }
    });
  }

  // ── QV WISHLIST BUTTON ─────────────────────────────────────────────────
  function updateWishlistUI() {
    var btn = document.getElementById('qv-wishlist-btn');
    if (btn && qvProduct) {
      var saved = wishlist.includes(qvProduct.id);
      btn.textContent = saved ? '♥' : '♡';
      btn.style.color = saved ? '#C9971C' : '#ccc';
    }
  }

  function qvToggleWishlist() {
    if (!qvProduct) return;
    toggleWishlist(qvProduct.id);
    updateWishlistUI();
  }

  // ── WHATSAPP PRODUCT SHARE ─────────────────────────────────────────────
  function qvShareWA() {
    if (!qvProduct) return;
    var price = 'GH₵' + parseFloat(qvProduct.price).toFixed(2);
    var url   = window.location.origin + '/?p=' + encodeURIComponent(qvProduct.id);
    var text  = 'Check this out from Freeman Outlet!\n\n*' + qvProduct.name + '* — ' + price + '\n\n' + url;
    window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank');
  }

  function switchAcctSection(sec) {
    document.getElementById('acct-orders-section').style.display  = sec === 'orders'  ? '' : 'none';
    document.getElementById('acct-profile-section').style.display = sec === 'profile' ? '' : 'none';
    document.getElementById('acct-tab-orders').classList.toggle('active',  sec === 'orders');
    document.getElementById('acct-tab-profile').classList.toggle('active', sec === 'profile');
    if (sec === 'orders') loadAccountOrders();
  }

  function acctSetLoading(btnId, loading) {
    var btn = document.getElementById(btnId);
    if (!btn) return;
    btn.disabled = loading;
    btn.style.opacity = loading ? '0.65' : '';
  }

  function accountLogin() {
    var email = document.getElementById('acct-login-email').value.trim();
    var pass  = document.getElementById('acct-login-pass').value;
    var errEl = document.getElementById('acct-login-err');
    errEl.style.display = 'none';
    if (!email || !pass) { errEl.textContent = 'Please enter your email and password.'; errEl.style.display = ''; return; }
    acctSetLoading('acct-login-btn', true);
    fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: pass }) })
      .then(function(r) { return r.json(); })
      .then(function(d) {
        acctSetLoading('acct-login-btn', false);
        if (d.token) {
          localStorage.setItem(AUTH_KEY, d.token);
          setAccountUI(d.customer);
          showAcctLoggedIn();
          switchAcctSection('orders');
        } else {
          errEl.textContent = d.error || 'Sign in failed.';
          errEl.style.display = '';
        }
      })
      .catch(function() { acctSetLoading('acct-login-btn', false); errEl.textContent = 'Network error — please try again.'; errEl.style.display = ''; });
  }

  function accountRegister() {
    var name  = document.getElementById('acct-reg-name').value.trim();
    var email = document.getElementById('acct-reg-email').value.trim();
    var pass  = document.getElementById('acct-reg-pass').value;
    var errEl = document.getElementById('acct-reg-err');
    errEl.style.display = 'none';
    if (!name || !email || !pass) { errEl.textContent = 'Please fill in all fields.'; errEl.style.display = ''; return; }
    if (pass.length < 6) { errEl.textContent = 'Password must be at least 6 characters.'; errEl.style.display = ''; return; }
    acctSetLoading('acct-reg-btn', true);
    fetch('/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, email, password: pass }) })
      .then(function(r) { return r.json(); })
      .then(function(d) {
        acctSetLoading('acct-reg-btn', false);
        if (d.token) {
          localStorage.setItem(AUTH_KEY, d.token);
          setAccountUI(d.customer);
          showAcctLoggedIn();
          switchAcctSection('orders');
        } else {
          errEl.textContent = d.error || 'Registration failed.';
          errEl.style.display = '';
        }
      })
      .catch(function() { acctSetLoading('acct-reg-btn', false); errEl.textContent = 'Network error — please try again.'; errEl.style.display = ''; });
  }

  function accountSignOut() {
    // Revoke the token server-side so it can't be reused
    var token = localStorage.getItem(AUTH_KEY);
    if (token) {
      fetch('/api/auth/logout', { method: 'POST', headers: { Authorization: 'Bearer ' + token } }).catch(function() {});
    }
    localStorage.removeItem(AUTH_KEY);
    currentAccount = null;
    wishlist = []; try { saveWishlist(); } catch(e){} updateWishCount();
    var nameEl = document.getElementById('acct-nav-name');
    var btn    = document.getElementById('acct-nav-btn');
    if (nameEl) { nameEl.textContent = ''; nameEl.style.display = 'none'; }
    if (btn) { btn.classList.remove('acct-signed-in'); btn.style.backgroundImage = ''; }
    // Also sign out of Google so they're not auto-signed back in
    if (typeof google !== 'undefined' && google.accounts) google.accounts.id.disableAutoSelect();
    closeAccountModal();
  }

  // ── PASSWORD STRENGTH ──────────────────────────────────────────────────
  function updatePasswordStrength(pw) {
    var fill  = document.getElementById('pw-strength-fill');
    var label = document.getElementById('pw-strength-label');
    if (!fill || !label) return;
    var score = 0;
    if (pw.length >= 8)  score++;
    if (pw.length >= 12) score++;
    if (/[A-Z]/.test(pw)) score++;
    if (/[0-9]/.test(pw)) score++;
    if (/[^A-Za-z0-9]/.test(pw)) score++;
    var pct   = Math.min(100, score * 20) + '%';
    var color = score <= 1 ? '#ef4444' : score <= 2 ? '#f97316' : score <= 3 ? '#eab308' : '#22c55e';
    var text  = score <= 1 ? 'Weak' : score <= 2 ? 'Fair' : score <= 3 ? 'Good' : 'Strong';
    fill.style.width = pct;
    fill.style.background = color;
    label.textContent = pw.length ? text : '';
    label.style.color = color;
  }

  // ── CHANGE PASSWORD ────────────────────────────────────────────────────
  function changePassword() {
    var current = document.getElementById('acct-pw-current').value;
    var newPw   = document.getElementById('acct-pw-new').value;
    var msg     = document.getElementById('acct-pw-msg');
    if (!current || !newPw) { msg.textContent = 'Please fill in both fields.'; msg.style.cssText = 'display:block;color:#dc2626'; return; }
    if (newPw.length < 8)   { msg.textContent = 'New password must be at least 8 characters.'; msg.style.cssText = 'display:block;color:#dc2626'; return; }
    fetch('/api/auth/change-password', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ currentPassword: current, newPassword: newPw })
    }).then(function(r) { return r.json(); })
    .then(function(d) {
      if (d.success) {
        msg.textContent = '✓ Password updated successfully.';
        msg.style.cssText = 'display:block;color:#16a34a';
        document.getElementById('acct-pw-current').value = '';
        document.getElementById('acct-pw-new').value = '';
      } else {
        msg.textContent = d.error || 'Failed to update password.';
        msg.style.cssText = 'display:block;color:#dc2626';
      }
    });
  }

  // ── RESEND EMAIL VERIFICATION ─────────────────────────────────────────
  function resendVerification() {
    fetch('/api/auth/resend-verification', { method: 'POST', headers: authHeaders() })
      .then(function(r) { return r.json(); })
      .then(function(d) {
        var banner = document.getElementById('acct-verify-banner');
        if (banner) banner.innerHTML = d.success
          ? 'Verification email sent! Check your inbox.'
          : '' + escHtml(d.error || 'Could not send email.');
      });
  }

  // ── DELETE ACCOUNT ────────────────────────────────────────────────────
  function requestDeleteAccount() {
    var pw = window.prompt('To permanently delete your account, enter your password (leave blank if you signed in with Google):');
    if (pw === null) return; // user cancelled
    if (!confirm('This will permanently delete your account and anonymise your orders. This cannot be undone. Continue?')) return;
    fetch('/api/auth/me', {
      method: 'DELETE',
      headers: authHeaders(),
      body: JSON.stringify({ password: pw || null })
    })
    .then(function(r) { return r.json(); })
    .then(function(d) {
      if (d.success) {
        alert('Your account has been deleted. We\'re sorry to see you go!');
        accountSignOut();
      } else {
        alert(d.error || 'Could not delete account. Please try again.');
      }
    });
  }

  // ── HANDLE ?verified= REDIRECT FROM EMAIL LINK ────────────────────────
  (function() {
    var params = new URLSearchParams(window.location.search);
    var verified = params.get('verified');
    if (!verified) return;
    history.replaceState({}, '', '/');
    if (verified === 'ok') {
      // Update local account state if signed in
      if (currentAccount) currentAccount.emailVerified = true;
      setTimeout(function() {
        var banner = document.getElementById('acct-verify-banner');
        if (banner) banner.style.display = 'none';
        alert('✓ Email verified successfully! Your account is fully set up.');
      }, 300);
    } else {
      setTimeout(function() {
        alert('The verification link has expired or is invalid. Please sign in and request a new one.');
      }, 300);
    }
  })();

  function loadAccountOrders() {
    var listEl = document.getElementById('acct-orders-list');
    if (!listEl) return;
    listEl.innerHTML = '<p class="acct-empty">Loading…</p>';
    fetch('/api/auth/me/orders', { headers: authHeaders() })
      .then(function(r) { return r.json(); })
      .then(function(orders) {
        if (!orders.length) { listEl.innerHTML = '<p class="acct-empty">No orders yet. Start shopping!</p>'; return; }
        listEl.innerHTML = orders.map(function(o) {
          var date = new Date(o.paidAt).toLocaleDateString('en-GH', { day:'numeric', month:'short', year:'numeric' });
          var items = (o.items || []).map(function(i) { return escHtml(i.name) + (i.color ? ' (' + escHtml(i.color) + ')' : '') + ' × ' + i.quantity; }).join('<br>');
          var statusClass = o.status === 'Delivered' ? 'acct-status-done' : o.status === 'Shipped' ? 'acct-status-ship' : 'acct-status-proc';
          return '<div class="acct-order-card">'
            + '<div class="acct-order-top"><span class="acct-order-id">' + escHtml(o.id) + '</span><span class="acct-order-status ' + statusClass + '">' + escHtml(o.status) + '</span></div>'
            + '<div class="acct-order-date">' + date + (o.deliveryZone ? ' · ' + escHtml(o.deliveryZone) : '') + '</div>'
            + '<div class="acct-order-items">' + items + '</div>'
            + '<div class="acct-order-total">GH₵' + parseFloat(o.total).toFixed(2) + '</div>'
            + '</div>';
        }).join('');
      })
      .catch(function() { listEl.innerHTML = '<p class="acct-empty">Could not load orders.</p>'; });
  }

  function saveProfile() {
    var name  = document.getElementById('acct-prof-name').value.trim();
    var phone = document.getElementById('acct-prof-phone').value.trim();
    var addr  = document.getElementById('acct-prof-addr').value.trim();
    var msgEl = document.getElementById('acct-prof-msg');
    msgEl.style.display = 'none';
    fetch('/api/auth/me', { method: 'PUT', headers: authHeaders(), body: JSON.stringify({ name, phone, address: addr }) })
      .then(function(r) { return r.json(); })
      .then(function(c) {
        if (c.id) {
          currentAccount = { ...currentAccount, ...c };
          setAccountUI(currentAccount);
          document.getElementById('acct-display-name').textContent = c.name;
          msgEl.textContent = '✓ Saved!';
          msgEl.className = 'acct-prof-ok';
          msgEl.style.display = '';
          setTimeout(function() { msgEl.style.display = 'none'; }, 2500);
        } else {
          msgEl.textContent = c.error || 'Could not save.';
          msgEl.className = 'acct-err';
          msgEl.style.display = '';
        }
      })
      .catch(function() { msgEl.textContent = 'Network error.'; msgEl.className = 'acct-err'; msgEl.style.display = ''; });
  }

  // Pre-fill checkout when logged in and checkout opens
  var _origOpenCheckout = openCheckout;
  openCheckout = function() {
    _origOpenCheckout();
    if (currentAccount) {
      var f = { 'co-name': currentAccount.name, 'co-email': currentAccount.email, 'co-phone': currentAccount.phone, 'co-address': currentAccount.address };
      Object.keys(f).forEach(function(id) { var el = document.getElementById(id); if (el && f[id]) el.value = f[id]; });
    }
  };

  // Escape key closes account modal too
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && document.getElementById('account-modal').classList.contains('open')) closeAccountModal();
  });

  initAccount();
