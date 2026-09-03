document.getElementById('year').textContent = new Date().getFullYear();

// -----------------------------------------------------------------------
// Reference-only demo: everything below is simulated in the browser.
// There is no config.js, no fetch(), no XHR anywhere on this page --
// see the "Reference build" notice in the hero and the README for why.
// -----------------------------------------------------------------------
(function () {
  var modeButtons = Array.prototype.slice.call(document.querySelectorAll('.dr-mode-button'));
  var outageButton = document.getElementById('simulate-outage-button');
  var resetButton = document.getElementById('reset-dr-button');
  var statusEl = document.getElementById('dr-status');
  var primaryRegion = document.getElementById('dr-region-primary');
  var standbyRegion = document.getElementById('dr-region-standby');
  var primaryRoleEl = document.getElementById('dr-primary-role');
  var standbyRoleEl = document.getElementById('dr-standby-role');
  var timelineSteps = Array.prototype.slice.call(document.querySelectorAll('#dr-timeline .job-timeline-step'));
  if (!outageButton) return;

  var prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var MODE_LABELS = {
    'pilot-light': 'Standby — pilot light',
    'warm-standby': 'Standby — warm (scaled down)',
    'active-active': 'Standby — active (serving traffic)',
  };

  var currentMode = 'pilot-light';
  var outageTimers = [];
  var outageInProgress = false;

  function setStatus(message, kind) {
    statusEl.textContent = message;
    statusEl.className = 'form-status is-visible' + (kind ? ' ' + kind : '');
  }

  function clearOutageTimers() {
    outageTimers.forEach(function (id) { window.clearTimeout(id); });
    outageTimers = [];
  }

  function applyTimelineStatus(status) {
    var stageOrder = ['DETECTING', 'FAILING_OVER', 'PROMOTED', 'SERVING'];
    var currentIndex = status ? stageOrder.indexOf(status) : -1;

    timelineSteps.forEach(function (el) {
      var stepIndex = stageOrder.indexOf(el.getAttribute('data-status'));
      var dot = el.querySelector('.job-timeline-dot');
      el.classList.remove('is-done', 'is-active');

      if (currentIndex === -1) {
        dot.textContent = String(stepIndex + 1);
        return;
      }

      if (stepIndex < currentIndex || (stepIndex === currentIndex && status === 'SERVING')) {
        el.classList.add('is-done');
        dot.textContent = '✓';
      } else {
        if (stepIndex === currentIndex) el.classList.add('is-active');
        dot.textContent = String(stepIndex + 1);
      }
    });
  }

  function resetDemo() {
    clearOutageTimers();
    outageInProgress = false;
    outageButton.disabled = false;
    outageButton.textContent = 'Simulate region outage';
    primaryRegion.classList.remove('is-down');
    primaryRegion.classList.add('is-active');
    standbyRegion.classList.remove('is-active', 'is-promoted');
    primaryRoleEl.textContent = 'Primary — serving traffic';
    standbyRoleEl.textContent = MODE_LABELS[currentMode];
    applyTimelineStatus(null);
    setStatus('', '');
  }

  function setMode(mode) {
    currentMode = mode;
    modeButtons.forEach(function (btn) {
      var active = btn.getAttribute('data-mode') === mode;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-checked', String(active));
    });
    if (!outageInProgress) {
      standbyRoleEl.textContent = MODE_LABELS[mode];
    }
  }

  modeButtons.forEach(function (btn) {
    btn.addEventListener('click', function () {
      if (outageInProgress) return;
      setMode(btn.getAttribute('data-mode'));
    });
  });

  function runOutageSequence() {
    // Warm standby and active-active start from an already-running
    // standby, so the simulated failover is faster than pilot light's
    // cold-compute path -- same four stages either way, just a shorter
    // FAILING_OVER hold for the two warmer postures.
    var failoverHoldMs = currentMode === 'pilot-light' ? 2200 : currentMode === 'warm-standby' ? 1200 : 500;

    var steps = [
      {
        status: 'DETECTING',
        delay: 900,
        run: function () {
          setStatus('Health check failing against us-east-1…', 'info');
          primaryRegion.classList.add('is-down');
          primaryRegion.classList.remove('is-active');
          primaryRoleEl.textContent = 'Primary — unreachable';
        },
      },
      {
        status: 'FAILING_OVER',
        delay: failoverHoldMs,
        run: function () {
          setStatus('Route 53 failing over to us-west-2…', 'info');
        },
      },
      {
        status: 'PROMOTED',
        delay: 900,
        run: function () {
          setStatus('Standby region promoted.', 'info');
          standbyRegion.classList.add('is-promoted');
        },
      },
      {
        status: 'SERVING',
        delay: 0,
        run: function () {
          setStatus('Now serving from us-west-2.', 'success');
          standbyRegion.classList.remove('is-promoted');
          standbyRegion.classList.add('is-active');
          standbyRoleEl.textContent = 'Primary — serving traffic';
          outageButton.disabled = false;
          outageButton.textContent = 'Simulate region outage';
          outageInProgress = false;
        },
      },
    ];

    if (prefersReducedMotion) {
      steps.forEach(function (step) { step.run(); });
      applyTimelineStatus('SERVING');
      return;
    }

    var elapsed = 0;
    steps.forEach(function (step) {
      elapsed += step.delay;
      var id = window.setTimeout(function () {
        step.run();
        applyTimelineStatus(step.status);
      }, elapsed);
      outageTimers.push(id);
    });
  }

  outageButton.addEventListener('click', function () {
    if (outageInProgress) return;
    outageInProgress = true;
    outageButton.disabled = true;
    outageButton.textContent = 'Outage in progress…';
    applyTimelineStatus('DETECTING');
    runOutageSequence();
  });

  if (resetButton) {
    resetButton.addEventListener('click', resetDemo);
  }

  resetDemo();
})();

// -----------------------------------------------------------------------
// "How it works" diagram: same autoplay/click-to-jump behavior used on
// the other project pages.
// -----------------------------------------------------------------------
(function () {
  var diagram = document.getElementById('flow-diagram');
  var stepsList = document.getElementById('flow-steps');
  if (!diagram || !stepsList) return;

  var STEP_MS = 2800;
  var IDLE_RESUME_MS = 6000;
  var TOTAL_STEPS = 5;
  var nodes = Array.prototype.slice.call(diagram.querySelectorAll('.flow-node'));
  var clickableNodes = nodes.filter(function (el) { return el.hasAttribute('data-step'); });
  var connectors = Array.prototype.slice.call(diagram.querySelectorAll('.flow-connector'));
  var stepItems = Array.prototype.slice.call(stepsList.querySelectorAll('.flow-step'));
  var prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var currentStep = 0;
  var timer = null;
  var resumeTimer = null;

  function setActiveStep(step) {
    currentStep = step;

    connectors.forEach(function (el) {
      var n = Number(el.getAttribute('data-step'));
      var active = n === step;
      el.classList.toggle('is-done', n < step);
      if (active) {
        el.classList.remove('is-active');
        void el.offsetWidth;
        el.classList.add('is-active');
      } else {
        el.classList.remove('is-active');
      }
    });

    nodes.forEach(function (el) {
      var hasStep = el.hasAttribute('data-step');
      var n = hasStep ? Number(el.getAttribute('data-step')) : 0;
      el.classList.toggle('is-active', hasStep && n === step);
      el.classList.toggle('is-done', hasStep ? n < step : step >= 1);
    });

    stepItems.forEach(function (el) {
      var n = Number(el.getAttribute('data-step'));
      el.classList.toggle('is-active', n === step);
    });
  }

  function stopAutoplay() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  function startAutoplay(fromStep) {
    stopAutoplay();
    if (resumeTimer) {
      clearTimeout(resumeTimer);
      resumeTimer = null;
    }
    if (prefersReducedMotion) {
      setActiveStep(1);
      return;
    }
    setActiveStep(fromStep || 1);
    timer = setInterval(function () {
      var next = currentStep >= TOTAL_STEPS ? 1 : currentStep + 1;
      setActiveStep(next);
    }, STEP_MS);
  }

  function goToStepManually(step) {
    stopAutoplay();
    setActiveStep(step);
    if (resumeTimer) {
      clearTimeout(resumeTimer);
    }
    if (!prefersReducedMotion) {
      resumeTimer = setTimeout(function () {
        startAutoplay(step >= TOTAL_STEPS ? 1 : step + 1);
      }, IDLE_RESUME_MS);
    }
  }

  clickableNodes.forEach(function (el) {
    el.addEventListener('click', function () {
      goToStepManually(Number(el.getAttribute('data-step')));
    });
    el.addEventListener('keydown', function (event) {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        goToStepManually(Number(el.getAttribute('data-step')));
      }
    });
  });

  stepItems.forEach(function (el) {
    el.addEventListener('click', function () {
      goToStepManually(Number(el.getAttribute('data-step')));
    });
    el.addEventListener('keydown', function (event) {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        goToStepManually(Number(el.getAttribute('data-step')));
      }
    });
  });

  if ('IntersectionObserver' in window) {
    var started = false;
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting && !started) {
          started = true;
          startAutoplay();
          io.disconnect();
        }
      });
    }, { threshold: 0.3 });
    io.observe(diagram);
  } else {
    startAutoplay();
  }

  var sentinel = document.querySelector('.flow-diagram-sentinel');
  if (sentinel && 'IntersectionObserver' in window) {
    var stickyIo = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        diagram.classList.toggle('is-stuck', !entry.isIntersecting);
      });
    }, { threshold: 0 });
    stickyIo.observe(sentinel);
  }
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

// Pricing slider: drag through the three DR postures. Not a live
// formula -- these are the same estimates from the README's cost
// table.
(function () {
  var input = document.getElementById('pricing-slider-input');
  var tierEl = document.getElementById('pricing-slider-tier');
  var amountEl = document.getElementById('pricing-slider-amount');
  var descEl = document.getElementById('pricing-slider-desc');
  if (!input || !tierEl || !amountEl || !descEl) return;

  var steps = [
    { tier: 'Pilot light', amount: '$5–30', period: '/mo', desc: "Just DynamoDB Global Table replication plus a minimal standby Lambda/API footprint. The cheapest posture, and the default choice unless there's a specific reason to spend more." },
    { tier: 'Warm standby', amount: '$50–150', period: '/mo', desc: 'A permanently running, right-sized second-region stack, ready to take load immediately without a cold start.' },
    { tier: 'Active-active', amount: '$150–500+', period: '/mo', desc: "Two full-scale production stacks, all the time -- scaling with whatever the primary region already costs, doubled." },
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
