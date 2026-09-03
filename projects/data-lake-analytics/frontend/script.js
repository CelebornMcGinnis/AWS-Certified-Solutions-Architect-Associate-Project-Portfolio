document.getElementById('year').textContent = new Date().getFullYear();

// -----------------------------------------------------------------------
// Sample dataset + demo "query" engine. Entirely client-side and fully
// static -- this project's AWS architecture (S3 + Glue + Athena +
// QuickSight, see the README) is designed and documented but
// intentionally never deployed, so there is no real backend to call.
// These three functions are labeled as if they were canned Athena
// queries, but they're just plain JS filters/aggregations over the same
// small synthetic array below.
// -----------------------------------------------------------------------
(function () {
  var form = document.getElementById('query-form');
  if (!form) return;

  var submitButton = document.getElementById('query-submit');
  var statusEl = document.getElementById('query-status');
  var placeholder = document.getElementById('query-result-placeholder');
  var resultWrap = document.getElementById('query-result');
  var resultTitle = document.getElementById('query-result-title');
  var resultMeta = document.getElementById('query-result-meta');
  var resultThead = document.getElementById('query-result-thead');
  var resultBody = document.getElementById('query-result-body');

  // Synthetic sample order data -- clearly not real business data, just
  // enough rows to make "group by" and "sort" produce a believable table.
  var ORDERS = [
    { category: 'Electronics', region: 'US-West', product: 'Wireless Mouse', units: 42, revenue: 839.58 },
    { category: 'Electronics', region: 'US-East', product: 'USB-C Hub', units: 31, revenue: 1239.69 },
    { category: 'Home', region: 'US-West', product: 'Desk Lamp', units: 58, revenue: 1739.42 },
    { category: 'Home', region: 'EU-West', product: 'Throw Pillow', units: 91, revenue: 1637.09 },
    { category: 'Electronics', region: 'EU-West', product: 'Wireless Mouse', units: 27, revenue: 539.73 },
    { category: 'Outdoors', region: 'US-East', product: 'Camp Chair', units: 19, revenue: 1139.81 },
    { category: 'Home', region: 'US-East', product: 'Desk Lamp', units: 33, revenue: 989.67 },
    { category: 'Outdoors', region: 'US-West', product: 'Water Bottle', units: 76, revenue: 987.24 },
    { category: 'Electronics', region: 'US-West', product: 'USB-C Hub', units: 22, revenue: 879.78 },
    { category: 'Outdoors', region: 'EU-West', product: 'Camp Chair', units: 14, revenue: 839.86 },
    { category: 'Home', region: 'US-West', product: 'Throw Pillow', units: 64, revenue: 1151.36 },
    { category: 'Electronics', region: 'US-East', product: 'Wireless Mouse', units: 38, revenue: 759.62 },
    { category: 'Outdoors', region: 'US-West', product: 'Camp Chair', units: 25, revenue: 1499.75 },
    { category: 'Home', region: 'EU-West', product: 'Desk Lamp', units: 41, revenue: 1229.59 },
    { category: 'Electronics', region: 'EU-West', product: 'USB-C Hub', units: 17, revenue: 679.83 },
    { category: 'Outdoors', region: 'US-East', product: 'Water Bottle', units: 53, revenue: 687.97 },
    { category: 'Home', region: 'US-East', product: 'Throw Pillow', units: 29, revenue: 521.71 },
    { category: 'Electronics', region: 'US-West', product: 'Wireless Mouse', units: 46, revenue: 917.54 },
    { category: 'Outdoors', region: 'EU-West', product: 'Water Bottle', units: 37, revenue: 480.63 },
    { category: 'Home', region: 'US-West', product: 'Desk Lamp', units: 22, revenue: 659.78 },
  ];

  function money(n) {
    return '$' + n.toFixed(2);
  }

  function runQuery(id) {
    if (id === 'byCategory') {
      var byCategory = {};
      ORDERS.forEach(function (row) {
        var entry = byCategory[row.category] || { category: row.category, orders: 0, units: 0 };
        entry.orders += 1;
        entry.units += row.units;
        byCategory[row.category] = entry;
      });
      var rows = Object.keys(byCategory).map(function (k) { return byCategory[k]; });
      rows.sort(function (a, b) { return b.units - a.units; });
      return {
        title: 'Orders by category',
        columns: ['Category', 'Order rows', 'Units sold'],
        rows: rows.map(function (r) { return [r.category, String(r.orders), String(r.units)]; }),
      };
    }

    if (id === 'byRegion') {
      var byRegion = {};
      ORDERS.forEach(function (row) {
        var entry = byRegion[row.region] || { region: row.region, revenue: 0 };
        entry.revenue += row.revenue;
        byRegion[row.region] = entry;
      });
      var regionRows = Object.keys(byRegion).map(function (k) { return byRegion[k]; });
      regionRows.sort(function (a, b) { return b.revenue - a.revenue; });
      return {
        title: 'Revenue by region',
        columns: ['Region', 'Total revenue'],
        rows: regionRows.map(function (r) { return [r.region, money(r.revenue)]; }),
      };
    }

    // topProducts
    var byProduct = {};
    ORDERS.forEach(function (row) {
      var entry = byProduct[row.product] || { product: row.product, units: 0 };
      entry.units += row.units;
      byProduct[row.product] = entry;
    });
    var productRows = Object.keys(byProduct).map(function (k) { return byProduct[k]; });
    productRows.sort(function (a, b) { return b.units - a.units; });
    return {
      title: 'Top products by units sold',
      columns: ['Product', 'Units sold'],
      rows: productRows.map(function (r) { return [r.product, String(r.units)]; }),
    };
  }

  function selectedQuery() {
    var checked = form.querySelector('input[name="query"]:checked');
    return checked ? checked.value : 'byCategory';
  }

  function setStatus(message, kind) {
    statusEl.textContent = message;
    statusEl.hidden = !message;
    statusEl.className = 'form-status' + (message ? ' is-visible' : '') + (kind ? ' ' + kind : '');
  }

  function renderResult(result) {
    resultTitle.textContent = result.title;
    resultMeta.textContent = result.rows.length + ' row' + (result.rows.length === 1 ? '' : 's') + ' — sample dataset, ' + ORDERS.length + ' underlying records';

    resultThead.innerHTML = '';
    var headRow = document.createElement('tr');
    result.columns.forEach(function (col) {
      var th = document.createElement('th');
      th.scope = 'col';
      th.textContent = col;
      headRow.appendChild(th);
    });
    resultThead.appendChild(headRow);

    resultBody.innerHTML = '';
    result.rows.forEach(function (row) {
      var tr = document.createElement('tr');
      row.forEach(function (cell) {
        var td = document.createElement('td');
        td.textContent = cell;
        tr.appendChild(td);
      });
      resultBody.appendChild(tr);
    });

    if (placeholder) placeholder.hidden = true;
    resultWrap.hidden = false;
  }

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    submitButton.disabled = true;
    setStatus('Running query…', 'info');

    // Fake latency, matching the feel of this portfolio's real backend
    // demos, even though there's no actual network round trip here.
    var delayMs = 800 + Math.random() * 700;
    window.setTimeout(function () {
      var result = runQuery(selectedQuery());
      setStatus('', null);
      renderResult(result);
      submitButton.disabled = false;
    }, delayMs);
  });
})();

// -----------------------------------------------------------------------
// Shared chrome behaviors, copied from the other project pages:
// scroll-reveal, nav dropdown, sticky header shrink, back-to-top, mobile
// menu, dark mode toggle. This page's own architecture diagram is fully
// static (see index.html) and needs no autoplay/click-to-jump JS since
// the pipeline it documents was never deployed and isn't something a
// visitor triggers.
// -----------------------------------------------------------------------

var revealEls = document.querySelectorAll('[data-reveal]');
if ('IntersectionObserver' in window) {
  var revealIo = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-visible');
        revealIo.unobserve(entry.target);
      }
    });
  }, { threshold: 0.15, rootMargin: '0px 0px -60px 0px' });
  revealEls.forEach(function (el) { revealIo.observe(el); });
} else {
  revealEls.forEach(function (el) { el.classList.add('is-visible'); });
}

// Close the "Projects" dropdown when clicking anywhere outside of
// it. (Deliberately not closing on mouseleave -- there's a gap
// between the "Projects" trigger and the menu below it, so moving
// the mouse there would exit .nav-dropdown's hit area and close
// the menu before you could click anything in it.)
document.querySelectorAll('.nav-dropdown').forEach(function (details) {
  document.addEventListener('click', function (event) {
    if (details.open && !details.contains(event.target)) {
      details.open = false;
    }
  });
});

// Close the dropdown the instant scrolling starts, and close it if
// a link was just clicked inside it -- both count as "the visitor
// is done with this menu," whether they picked something or just
// scrolled past it. (.mobile-sidebar is deliberately excluded -- it
// stays open across scrolling, see the dedicated block below.)
function closeOpenNavMenus() {
  document.querySelectorAll('.nav-dropdown[open]').forEach(function (details) {
    details.open = false;
  });
}
window.addEventListener('scroll', closeOpenNavMenus, { passive: true });
document.querySelectorAll('.nav-dropdown-menu a').forEach(function (link) {
  link.addEventListener('click', function () {
    var details = link.closest('details');
    if (details) details.open = false;
  });
});

var siteHeader = document.querySelector('.site-header');
if (siteHeader) {
  var wasScrolled = false;
  var headerRafId = null;
  var headerLockedUntil = 0;
  // A short lock after every flip -- not a lock on updating in
  // general, just on flipping back again right away -- stops the
  // header from chattering between states at scroll positions
  // where scrollY jitters back and forth across the threshold
  // (rubber-band bounce, sub-pixel rounding, etc.), while still
  // reacting immediately to a normal, deliberate scroll.
  var updateHeaderState = function () {
    headerRafId = null;
    if (window.performance.now() < headerLockedUntil) return;
    var threshold = wasScrolled ? 4 : 48;
    var scrolled = window.scrollY > threshold;
    if (scrolled !== wasScrolled) {
      siteHeader.classList.toggle('is-scrolled', scrolled);
      wasScrolled = scrolled;
      headerLockedUntil = window.performance.now() + 200;
    }
  };
  var scheduleHeaderUpdate = function () {
    if (headerRafId === null) {
      headerRafId = window.requestAnimationFrame(updateHeaderState);
    }
  };
  updateHeaderState();
  window.addEventListener('scroll', scheduleHeaderUpdate, { passive: true });
}

var backToTop = document.getElementById('back-to-top');
if (backToTop) {
  var toggleBackToTop = function () {
    backToTop.classList.toggle('is-visible', window.scrollY > 500);
  };
  toggleBackToTop();
  window.addEventListener('scroll', toggleBackToTop, { passive: true });

  backToTop.addEventListener('click', function () {
    var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
  });

  // Same rest/scroll opacity behavior as the sidebar rail below.
  var backToTopFadeTimer = null;
  window.addEventListener('scroll', function () {
    backToTop.classList.add('is-scrolling');
    if (backToTopFadeTimer) clearTimeout(backToTopFadeTimer);
    backToTopFadeTimer = setTimeout(function () {
      backToTop.classList.remove('is-scrolling');
    }, 400);
  }, { passive: true });
}

// Mobile sidebar: present from first paint (unlike the old
// scroll-triggered popover it replaces), toggled by its own button
// rather than a native <details> so its width can transition
// smoothly. Closes on: the toggle button, a backdrop tap, Escape,
// or clicking any link inside the panel -- but NOT on scroll, since
// it's a persistent drawer rather than a transient popover.
var mobileSidebar = document.getElementById('mobile-sidebar');
if (mobileSidebar) {
  var sidebarToggle = document.getElementById('mobile-sidebar-toggle');
  var sidebarPanel = document.getElementById('mobile-sidebar-panel');
  var sidebarBackdrop = document.getElementById('mobile-sidebar-backdrop');

  var setSidebarOpen = function (open) {
    mobileSidebar.classList.toggle('is-open', open);
    if (sidebarToggle) {
      sidebarToggle.setAttribute('aria-expanded', String(open));
      sidebarToggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    }
    if (sidebarPanel) sidebarPanel.setAttribute('aria-hidden', String(!open));
  };

  if (sidebarToggle) {
    // A tap that also stops active momentum scrolling on iOS Safari
    // never reaches the page as a touch/click event at all -- that's
    // decided natively before it's dispatched, so no JS here can
    // detect or override it (confirmed: touch-action: manipulation in
    // styles.css and a touchstart listener were both tried and neither
    // helped, since the touch simply never arrives). touch-action:
    // manipulation stays in styles.css since it's still correct to
    // have; a plain click is all that's needed here.
    sidebarToggle.addEventListener('click', function () {
      setSidebarOpen(!mobileSidebar.classList.contains('is-open'));
    });
  }

  if (sidebarBackdrop) {
    sidebarBackdrop.addEventListener('click', function () {
      setSidebarOpen(false);
    });
  }

  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && mobileSidebar.classList.contains('is-open')) {
      setSidebarOpen(false);
    }
  });

  if (sidebarPanel) {
    sidebarPanel.querySelectorAll('a').forEach(function (link) {
      link.addEventListener('click', function () {
        setSidebarOpen(false);
      });
    });
  }

  // Rail transparency: very faint at rest so it stays out of the
  // way of whatever's scrolling underneath it, solid for as long
  // as a scroll is actually happening, then fades back out a beat
  // after it stops (the timeout resets on every scroll event, so
  // it only fires once motion has actually settled).
  var sidebarRail = mobileSidebar.querySelector('.mobile-sidebar-rail');
  if (sidebarRail) {
    var scrollFadeTimer = null;
    window.addEventListener('scroll', function () {
      sidebarRail.classList.add('is-scrolling');
      if (scrollFadeTimer) clearTimeout(scrollFadeTimer);
      scrollFadeTimer = setTimeout(function () {
        sidebarRail.classList.remove('is-scrolling');
      }, 400);
    }, { passive: true });
  }
}

(function () {
  var toggles = document.querySelectorAll('.theme-toggle');
  if (!toggles.length) return;

  function currentTheme() {
    return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  }

  function reflectState() {
    var isDark = currentTheme() === 'dark';
    toggles.forEach(function (btn) {
      btn.setAttribute('aria-pressed', String(isDark));
    });
  }

  reflectState();

  toggles.forEach(function (btn) {
    btn.addEventListener('click', function () {
      var next = currentTheme() === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      try { localStorage.setItem('theme', next); } catch (e) {}
      reflectState();
    });
  });
})();

// Pricing slider: drag through 5 volume steps instead of scanning fixed
// cards. Not a live formula -- QuickSight's flat per-seat fee dominates
// at every step, since query volume itself barely moves the bill.
(function () {
  var input = document.getElementById('pricing-slider-input');
  var tierEl = document.getElementById('pricing-slider-tier');
  var amountEl = document.getElementById('pricing-slider-amount');
  var descEl = document.getElementById('pricing-slider-desc');
  if (!input || !tierEl || !amountEl || !descEl) return;

  var steps = [
    { tier: 'Light volume', amount: '~$15', period: '/mo', desc: "A handful of ad-hoc queries a day against a small dataset — Athena's per-TB-scanned pricing is nearly free at this scale, so QuickSight's flat per-seat fee dominates the bill." },
    { tier: 'Moderate volume', amount: '~$25', period: '/mo', desc: 'A couple of readers checking dashboards daily, one author building them — still mostly QuickSight seats, Athena and Glue stay a rounding error.' },
    { tier: 'Regular volume', amount: '~$60', period: '/mo', desc: 'A small team of QuickSight readers plus a scheduled Glue crawler — crawler runtime starts to show up alongside the per-seat licensing.' },
    { tier: 'Heavy volume', amount: '~$150', period: '/mo', desc: 'Multiple authors and a wider reader base, frequent crawler runs, and Athena queries scanning larger partitions — every line item now contributes.' },
    { tier: 'Multi-seat, multi-team', amount: '~$300+', period: '/mo', desc: "QuickSight author/reader seats scaled across several teams — at this point the per-seat licensing model, not compute, is what's setting the ceiling." },
  ];

  function render() {
    var step = steps[Number(input.value)];
    tierEl.textContent = step.tier;
    amountEl.textContent = step.amount;
    amountEl.appendChild(Object.assign(document.createElement('span'), { className: 'pricing-period', textContent: step.period }));
    descEl.textContent = step.desc;

    var percent = (Number(input.value) / (steps.length - 1)) * 100;
    input.style.background =
      'linear-gradient(to right, var(--accent) ' + percent + '%, var(--border) ' + percent + '%)';
  }

  input.addEventListener('input', render);
  render();
})();
