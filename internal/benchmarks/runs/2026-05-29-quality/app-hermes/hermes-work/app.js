/* ===== Pantry Pulse — App Logic ===== */
(function () {
  'use strict';

  // ── Seed data ──────────────────────────────────────────────
  const ITEMS = [
    { id: 'p1', name: 'Organic Rolled Oats',        category: 'grains',     quantity: 'half full',   expires: '2026-07-12' },
    { id: 'p2', name: 'Canned Chickpeas',           category: 'canned',     quantity: '3 cans',       expires: '2027-03-01' },
    { id: 'p3', name: 'Whole Milk',                 category: 'dairy',      quantity: '1 quart',      expires: '2026-05-31' },
    { id: 'p4', name: 'Baby Spinach',               category: 'produce',    quantity: '1 bag',        expires: '2026-05-30' },
    { id: 'p5', name: 'Sourdough Boule',            category: 'bakery',     quantity: 'half loaf',    expires: '2026-05-29' },
    { id: 'p6', name: 'Free-Range Eggs',            category: 'dairy',      quantity: '4 eggs',       expires: '2026-06-12' },
    { id: 'p7', name: 'Jasmine Rice',               category: 'grains',     quantity: '¾ full',       expires: '2026-10-01' },
    { id: 'p8', name: 'Cherry Tomatoes',            category: 'produce',    quantity: '1 pint',       expires: '2026-06-02' },
    { id: 'p9', name: 'Greek Yogurt (Plain)',       category: 'dairy',      quantity: '2 cups',       expires: '2026-06-08' },
  ];

  // ── Item expiry helpers ───────────────────────────────────
  const TODAY = new Date();
  TODAY.setHours(0, 0, 0, 0);

  function parseDate(str) {
    const d = new Date(str + 'T00:00:00');
    d.setHours(0, 0, 0, 0);
    return d;
  }

  function daysUntil(dateStr) {
    const d = parseDate(dateStr);
    return Math.ceil((d - TODAY) / 86_400_000);
  }

  function isExpiringSoon(dateStr) {
    const d = daysUntil(dateStr);
    return d >= 0 && d <= 3;
  }

  function formatExpiry(dateStr) {
    const d = parseDate(dateStr);
    const opts = { month: 'short', day: 'numeric' };
    const formatted = d.toLocaleDateString('en-US', opts);
    const diff = daysUntil(dateStr);

    if (diff < 0)  return `Expired ${Math.abs(diff)}d ago`;
    if (diff === 0) return 'Expires today';
    if (diff === 1) return 'Expires tomorrow';
    return `Expires ${formatted}`;
  }

  function expiryClass(dateStr) {
    const d = daysUntil(dateStr);
    if (d < 0) return 'alert';
    if (d <= 1) return 'alert';
    if (d <= 3) return 'warning';
    return '';
  }

  function urgencyIcon(dateStr) {
    const d = daysUntil(dateStr);
    if (d < 0) return '⚠️';
    if (d <= 1) return '🔥';
    if (d <= 3) return '⚡';
    return '';
  }

  // Categories → emoji map
  const CAT_ICONS = {
    grains:  '🌾',
    canned:  '🥫',
    dairy:   '🥛',
    produce: '🥬',
    bakery:  '🍞',
  };

  // ── State ─────────────────────────────────────────────────
  let pantry = ITEMS.map(item => ({ ...item, used: false }));
  let activeFilter = 'all';   // 'all' | 'expiring'

  // ── DOM refs ──────────────────────────────────────────────
  const listEl   = document.getElementById('pantryList');
  const badgeEl  = document.getElementById('countBadge');
  const filterBtns = document.querySelectorAll('.filter-btn');

  // ── Render ────────────────────────────────────────────────
  function render() {
    const visible = getVisibleItems();
    const totalVisible = visible.length;

    // Update badge
    if (activeFilter === 'expiring') {
      badgeEl.textContent = `${totalVisible} expiring`;
    } else {
      badgeEl.textContent = `${totalVisible} item${totalVisible !== 1 ? 's' : ''}`;
    }

    // Badge urgency styling
    badgeEl.className = 'count-badge';
    if (activeFilter === 'expiring' && totalVisible > 0) {
      const hasCoral = visible.some(i => expiryClass(i.expires) === 'alert');
      badgeEl.classList.add(hasCoral ? 'alert' : 'warning');
    } else if (activeFilter === 'all') {
      const nearExpiry = pantry.filter(i => !i.used && isExpiringSoon(i.expires)).length;
      if (nearExpiry > 0) {
        badgeEl.classList.add(nearExpiry <= 2 ? 'alert' : 'warning');
      }
    }

    // Build list
    if (totalVisible === 0) {
      listEl.innerHTML = `
        <li class="empty-state" role="status">
          <div class="empty-icon">🧺</div>
          <p>Nothing to show here.<br>${
            activeFilter === 'expiring'
              ? 'No items are expiring soon.'
              : 'Your pantry is empty — time to restock!'
          }</p>
        </li>`;
      return;
    }

    let html = '';
    for (const item of visible) {
      const iconBase = CAT_ICONS[item.category] || '📦';
      const urgency = urgencyIcon(item.expires);
      const iconEmoji = urgency || iconBase;
      const cClass = expiryClass(item.expires);
      let iconBgCls = '';
      if (cClass === 'alert') iconBgCls = 'coral-bg';
      else if (cClass === 'warning') iconBgCls = 'amber-bg';

      html += `
        <li class="pantry-item${item.used ? ' used' : ''}" data-id="${item.id}" role="listitem">
          <span class="item-icon ${iconBgCls}" aria-hidden="true">${iconEmoji}</span>
          <div class="item-info">
            <div class="item-name">${escapeHtml(item.name)}</div>
            <div class="item-meta">
              <span class="item-category">${item.category}</span>
              <span aria-hidden="true">·</span>
              <span class="item-quantity">${escapeHtml(item.quantity)}</span>
              <span aria-hidden="true">·</span>
              <span class="item-expiry ${cClass}">${formatExpiry(item.expires)}</span>
            </div>
          </div>
          <button class="mark-btn" data-id="${item.id}" type="button">${item.used ? 'Used ✓' : 'Mark used'}</button>
        </li>`;
    }
    listEl.innerHTML = html;
  }

  // ── Derived state ─────────────────────────────────────────
  function getVisibleItems() {
    const available = pantry.filter(i => !i.used);
    if (activeFilter === 'all') return available;
    // expiring filter: show only items expiring within 3 days (including expired)
    return available.filter(i => isExpiringSoon(i.expires) || daysUntil(i.expires) < 0);
  }

  // ── Actions ───────────────────────────────────────────────
  function toggleUsed(id) {
    const item = pantry.find(i => i.id === id);
    if (!item) return;
    item.used = !item.used;
    // Animate removal
    const li = listEl.querySelector(`[data-id="${id}"]`);
    if (li) {
      li.classList.add(item.used ? 'removing' : 'used');
    }
    // Re-render after animation
    setTimeout(render, 200);
  }

  // ── Filter switching ──────────────────────────────────────
  function setFilter(filter) {
    if (filter === activeFilter) return;
    activeFilter = filter;

    filterBtns.forEach(btn => {
      const isActive = btn.dataset.filter === filter;
      btn.classList.toggle('active', isActive);
      btn.setAttribute('aria-pressed', isActive);
    });

    render();
  }

  // ── Event delegation ──────────────────────────────────────
  listEl.addEventListener('click', function (e) {
    const btn = e.target.closest('.mark-btn');
    if (!btn) return;
    toggleUsed(btn.dataset.id);
  });

  filterBtns.forEach(btn => {
    btn.addEventListener('click', function () {
      setFilter(this.dataset.filter);
    });
  });

  // ── Helpers ───────────────────────────────────────────────
  function escapeHtml(str) {
    const div = document.createElement('div');
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
  }

  // ── Kick-off ──────────────────────────────────────────────
  render();
})();
