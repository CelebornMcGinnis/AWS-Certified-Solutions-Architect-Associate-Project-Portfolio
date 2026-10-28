document.getElementById('year').textContent = new Date().getFullYear();

// Scroll-triggered reveal for hero, section intros, project cards, and stats.
var revealEls = document.querySelectorAll('[data-reveal]');
if ('IntersectionObserver' in window) {
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-visible');
        io.unobserve(entry.target);
      }
    });
  // threshold is a fraction of the OBSERVED ELEMENT's own area, not the
  // viewport's -- 0.15 silently could never be satisfied for a tall
  // multi-row element (e.g. the project grid, now 14+ cards) once the
  // viewport is short enough that even 100% viewport coverage doesn't
  // add up to 15% of that element's total height. Landscape mobile is
  // exactly this case (short viewport, tall grid), where the section
  // would otherwise never reveal no matter how far you scroll. A near-
  // zero threshold fires as soon as any sliver is visible, which is
  // viewport-height-independent and safe for elements of any size.
  }, { threshold: 0.01, rootMargin: '0px 0px -60px 0px' });
  revealEls.forEach(function (el) { io.observe(el); });
} else {
  revealEls.forEach(function (el) { el.classList.add('is-visible'); });
}

// Fade + slide the Projects dropdown menu in on open (native <details> can't
// transition display:none, so the animation is triggered on the toggle event).
document.querySelectorAll('.nav-dropdown').forEach(function (details) {
  var menu = details.querySelector('.nav-dropdown-menu');
  if (!menu) return;
  details.addEventListener('toggle', function () {
    if (details.open) {
      menu.style.animation = 'none';
      void menu.offsetWidth; // restart the animation
      menu.style.animation = 'dropdownIn 0.18s ease forwards';
    }
  });
});

// Close the "Projects" dropdown when clicking anywhere outside of
// it. (Deliberately not closing on mouseleave — there's a gap
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
// a link was just clicked inside it — both count as "the visitor
// is done with this menu," whether they picked something or just
// scrolled past it. (.mobile-sidebar is deliberately excluded — it
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

// Shrink the sticky header once the page has scrolled past the top.
var siteHeader = document.querySelector('.site-header');
if (siteHeader) {
  var wasScrolled = false;
  var headerRafId = null;
  var headerLockedUntil = 0;
  var updateHeaderState = function () {
    headerRafId = null;
    // Hysteresis: a different threshold for entering vs. leaving the
    // "scrolled" state stops it from rapidly flipping back and forth
    // if scrollY hovers right around a single boundary — which can
    // happen right after load while images/sections are still
    // settling into their final layout position. The lock below is
    // a second layer on top of that: a short cooldown after every
    // flip (not a lock on updating in general) so the header can't
    // chatter between states at scroll positions where scrollY
    // itself jitters back and forth across the threshold (rubber-
    // band bounce, sub-pixel rounding, etc.), while still reacting
    // immediately to a normal, deliberate scroll.
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

// Back-to-top button: fades in once scrolled down a bit, smooth-scrolls
// to the top on click (respects reduced-motion for the scroll itself).
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
// or clicking any link inside the panel — but NOT on scroll, since
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

// Dark mode toggle — wires up whichever .theme-toggle button(s) are
// present (desktop nav icon, mobile menu row) to flip data-theme on
// <html> and remember the choice.
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

// Projects filter — narrows the grid by AWS service (data-services,
// a comma-separated list per card) and by deployment status (the
// is-live/is-reference class each card already carries for its status
// dot). .project-card-placeholder ("Next project — in progress") has
// neither, so it can't match any specific filter — it only stays
// visible while both filters are at "all".
(function () {
  var serviceSelect = document.getElementById('project-filter-service');
  var statusSelect = document.getElementById('project-filter-status');
  if (!serviceSelect || !statusSelect) return;

  var resetBtn = document.getElementById('project-filter-reset');
  var emptyMsg = document.getElementById('project-filter-empty');
  var placeholder = document.querySelector('.project-card-placeholder');
  var cards = document.querySelectorAll('.project-card:not(.project-card-placeholder)');

  function applyFilters() {
    var service = serviceSelect.value;
    var status = statusSelect.value;
    var filtersActive = service !== 'all' || status !== 'all';
    var visibleCount = 0;

    if (placeholder) placeholder.hidden = filtersActive;

    cards.forEach(function (card) {
      var services = (card.dataset.services || '').split(',');
      var matchesService = service === 'all' || services.indexOf(service) !== -1;
      var matchesStatus =
        status === 'all' ||
        (status === 'live' && card.classList.contains('is-live')) ||
        (status === 'reference' && card.classList.contains('is-reference'));
      var visible = matchesService && matchesStatus;
      card.hidden = !visible;
      if (visible) visibleCount += 1;
    });

    if (resetBtn) resetBtn.hidden = !filtersActive;
    if (emptyMsg) emptyMsg.hidden = visibleCount > 0;
  }

  serviceSelect.addEventListener('change', applyFilters);
  statusSelect.addEventListener('change', applyFilters);
  if (resetBtn) {
    resetBtn.addEventListener('click', function () {
      serviceSelect.value = 'all';
      statusSelect.value = 'all';
      applyFilters();
    });
  }
})();
