document.getElementById('year').textContent = new Date().getFullYear();

// -----------------------------------------------------------------------
// Simulated Kinesis-fed dashboard. Zero network calls anywhere in this
// file -- "Start simulated stream" just runs a setInterval that
// manufactures synthetic events, keeps a rolling in-memory buffer, and
// redraws two hand-rolled SVG charts directly from that buffer. This is
// the same shape a real dashboard polling the reference architecture's
// GET /rollups endpoint would follow, just fed by Math.random() instead
// of an actual Kinesis stream.
// -----------------------------------------------------------------------
(function () {
  var toggleButton = document.getElementById('stream-toggle-button');
  var resetButton = document.getElementById('stream-reset-button');
  var statusEl = document.getElementById('stream-status');
  var statsRow = document.getElementById('opsdash-stats-row');
  var placeholder = document.getElementById('opsdash-placeholder');
  var chartsWrap = document.getElementById('opsdash-charts');
  var barChart = document.getElementById('opsdash-bar-chart');
  var lineChart = document.getElementById('opsdash-line-chart');
  var statRate = document.getElementById('stat-rate');
  var statTotal = document.getElementById('stat-total');
  var statBuffer = document.getElementById('stat-buffer');
  if (!toggleButton) return;

  var prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var REGIONS = ['us-east-1', 'us-west-2', 'eu-west-1', 'ap-south-1'];
  var TICK_MS = 400;
  var BUFFER_WINDOW_MS = 20000; // events older than this fall out of the rolling window
  var RATE_HISTORY_LEN = 40;

  var buffer = []; // { region, ts }
  var rateHistory = []; // events created in each tick, most recent last
  var totalEvents = 0;
  var tickTimer = null;
  var running = false;

  function setStatus(message) {
    statusEl.textContent = message;
  }

  function pruneBuffer(now) {
    while (buffer.length && now - buffer[0].ts > BUFFER_WINDOW_MS) {
      buffer.shift();
    }
  }

  function countsByRegion() {
    var counts = Object.create(null);
    REGIONS.forEach(function (r) { counts[r] = 0; });
    buffer.forEach(function (event) { counts[event.region] += 1; });
    return counts;
  }

  function svgEl(name, attrs) {
    var el = document.createElementNS('http://www.w3.org/2000/svg', name);
    Object.keys(attrs || {}).forEach(function (key) {
      el.setAttribute(key, attrs[key]);
    });
    return el;
  }

  function redrawBarChart() {
    var counts = countsByRegion();
    var max = Math.max(1, REGIONS.reduce(function (m, r) { return Math.max(m, counts[r]); }, 0));

    barChart.innerHTML = '';
    var chartWidth = 480;
    var chartHeight = 180;
    var rowHeight = chartHeight / REGIONS.length;
    var labelWidth = 90;
    var barMaxWidth = chartWidth - labelWidth - 50;

    REGIONS.forEach(function (region, index) {
      var y = index * rowHeight;
      var count = counts[region];
      var barWidth = (count / max) * barMaxWidth;

      var label = svgEl('text', {
        x: 0,
        y: y + rowHeight / 2 + 4,
        class: 'opsdash-chart-label',
      });
      label.textContent = region;
      barChart.appendChild(label);

      var track = svgEl('rect', {
        x: labelWidth,
        y: y + rowHeight * 0.25,
        width: barMaxWidth,
        height: rowHeight * 0.5,
        class: 'opsdash-bar-track',
      });
      barChart.appendChild(track);

      var bar = svgEl('rect', {
        x: labelWidth,
        y: y + rowHeight * 0.25,
        width: Math.max(2, barWidth),
        height: rowHeight * 0.5,
        class: 'opsdash-bar-fill',
      });
      barChart.appendChild(bar);

      var countLabel = svgEl('text', {
        x: labelWidth + barMaxWidth + 8,
        y: y + rowHeight / 2 + 4,
        class: 'opsdash-chart-count',
      });
      countLabel.textContent = String(count);
      barChart.appendChild(countLabel);
    });
  }

  function redrawLineChart() {
    lineChart.innerHTML = '';
    var chartWidth = 480;
    var chartHeight = 180;
    var padding = 12;
    var max = Math.max(1, rateHistory.reduce(function (m, v) { return Math.max(m, v); }, 0));

    if (rateHistory.length < 2) return;

    var stepX = (chartWidth - padding * 2) / (RATE_HISTORY_LEN - 1);
    var points = rateHistory.map(function (value, index) {
      var x = padding + index * stepX;
      var y = chartHeight - padding - (value / max) * (chartHeight - padding * 2);
      return x + ',' + y;
    });

    var baseline = svgEl('line', {
      x1: padding,
      y1: chartHeight - padding,
      x2: chartWidth - padding,
      y2: chartHeight - padding,
      class: 'opsdash-line-baseline',
    });
    lineChart.appendChild(baseline);

    var polyline = svgEl('polyline', {
      points: points.join(' '),
      class: 'opsdash-line-path',
    });
    lineChart.appendChild(polyline);

    var lastPoint = points[points.length - 1].split(',');
    var dot = svgEl('circle', {
      cx: lastPoint[0],
      cy: lastPoint[1],
      r: 4,
      class: 'opsdash-line-dot',
    });
    lineChart.appendChild(dot);
  }

  function redrawStats(tickCount) {
    var now = Date.now();
    var perSecond = Math.round((tickCount / TICK_MS) * 1000 * 10) / 10;
    statRate.textContent = String(perSecond);
    statTotal.textContent = String(totalEvents);
    statBuffer.textContent = String(buffer.length);
  }

  function tick() {
    var now = Date.now();
    // A small bursty count per tick, not a flat 1-per-tick, so the
    // charts feel like real traffic rather than a metronome.
    var eventsThisTick = 1 + Math.floor(Math.random() * 3);

    for (var i = 0; i < eventsThisTick; i++) {
      var region = REGIONS[Math.floor(Math.random() * REGIONS.length)];
      buffer.push({ region: region, ts: now });
    }
    totalEvents += eventsThisTick;
    pruneBuffer(now);

    rateHistory.push(eventsThisTick);
    if (rateHistory.length > RATE_HISTORY_LEN) rateHistory.shift();

    redrawBarChart();
    redrawLineChart();
    redrawStats(eventsThisTick);
  }

  function startStream() {
    if (running) return;
    running = true;
    placeholder.hidden = true;
    statsRow.hidden = false;
    chartsWrap.hidden = false;
    toggleButton.textContent = 'Stop simulated stream';
    setStatus('Streaming simulated events…');

    tick();
    tickTimer = window.setInterval(tick, TICK_MS);
  }

  function stopStream() {
    if (!running) return;
    running = false;
    if (tickTimer) {
      window.clearInterval(tickTimer);
      tickTimer = null;
    }
    toggleButton.textContent = 'Start simulated stream';
    setStatus('Stream stopped. Recent data stays on screen until you reset.');
  }

  function resetStream() {
    stopStream();
    buffer = [];
    rateHistory = [];
    totalEvents = 0;
    placeholder.hidden = false;
    statsRow.hidden = true;
    chartsWrap.hidden = true;
    barChart.innerHTML = '';
    lineChart.innerHTML = '';
    setStatus('');
  }

  toggleButton.addEventListener('click', function () {
    if (running) {
      stopStream();
    } else {
      startStream();
    }
  });

  if (resetButton) {
    resetButton.addEventListener('click', resetStream);
  }

  // Reduced motion still gets the live data (it's the point of the
  // demo, not decorative motion) -- redraws just snap instead of
  // transitioning, which is already how the SVG redraw works since
  // nothing here relies on CSS transitions for the bars/line itself.
  if (prefersReducedMotion) {
    // no-op: redraws already snap (innerHTML replace), nothing to disable
  }
})();

// -----------------------------------------------------------------------
// Pricing slider: drag through 4 volume steps.
// -----------------------------------------------------------------------
(function () {
  var input = document.getElementById('pricing-slider-input');
  var tierEl = document.getElementById('pricing-slider-tier');
  var amountEl = document.getElementById('pricing-slider-amount');
  var descEl = document.getElementById('pricing-slider-desc');
  if (!input || !tierEl || !amountEl || !descEl) return;

  var steps = [
    { tier: 'One shard, idle', amount: '~$15', period: '/mo', desc: 'A single Kinesis shard costs about $0.015/hour (~$11/month) whether or not any events arrive, plus a small PUT payload charge — this is the floor, not the ceiling.' },
    { tier: 'One shard, light traffic', amount: '~$20', period: '/mo', desc: 'A few hundred thousand small events a month — still one shard, PUT payload charges start to add a few dollars on top of the flat shard-hour cost.' },
    { tier: 'Two shards, moderate traffic', amount: '~$35–45', period: '/mo', desc: 'Enough sustained throughput to need a second shard for capacity — shard-hour cost roughly doubles, Lambda and DynamoDB stay minor by comparison.' },
    { tier: 'Several shards, heavy traffic', amount: '~$75+', period: '/mo', desc: 'High-volume ingestion needing 4+ shards for throughput — shard count becomes the dominant cost driver, well past what a portfolio demo would ever need.' },
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

// -----------------------------------------------------------------------
// Shared chrome behaviors, copied from the other project pages:
// scroll-reveal, nav dropdown, sticky header shrink, back-to-top, mobile
// menu, dark mode toggle.
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
    // detect or override it. touch-action: manipulation stays in
    // styles.css since it's still correct to have; a plain click is
    // all that's needed here.
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
