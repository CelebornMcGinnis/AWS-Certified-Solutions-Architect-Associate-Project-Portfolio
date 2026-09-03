document.getElementById('year').textContent = new Date().getFullYear();

// -----------------------------------------------------------------------
// Rolling deployment demo: entirely simulated in the browser, no AWS
// account or fetch/XHR anywhere on this page. One task at a time flips
// v1 (green) -> updating (pulsing) -> v2 (green), staggered, mirroring
// ECS's own rolling-update sequence (start new task, wait for health
// check, drain old task, repeat) generalized from order-processing's
// named-3-stage setActiveStep pattern to N tasks instead.
// -----------------------------------------------------------------------
(function () {
  var deployButton = document.getElementById('deploy-button');
  var resetButton = document.getElementById('reset-deployment-button');
  var statusEl = document.getElementById('deployment-status');
  var tasks = Array.prototype.slice.call(document.querySelectorAll('.orchestration-task'));
  if (!deployButton || !tasks.length) return;

  var STEP_MS = 650;
  var UPDATING_MS = 900;
  var prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var currentVersion = 1;
  var deploying = false;

  function setStatus(message) {
    statusEl.textContent = message;
  }

  function setTaskState(task, state, version) {
    task.classList.remove('is-updating', 'is-updated');
    if (state) task.classList.add(state);
    var versionEl = task.querySelector('.orchestration-task-version');
    if (version != null) versionEl.textContent = 'v' + version;
  }

  function resetDemo() {
    currentVersion = 1;
    deploying = false;
    deployButton.disabled = false;
    resetButton.disabled = false;
    tasks.forEach(function (task) {
      setTaskState(task, null, 1);
    });
    setStatus('');
  }

  function deployOneTask(index, nextVersion, done) {
    var task = tasks[index];
    setTaskState(task, 'is-updating', null);
    setStatus('Rolling out v' + nextVersion + ' — task ' + (index + 1) + ' of ' + tasks.length + '…');

    window.setTimeout(function () {
      setTaskState(task, 'is-updated', nextVersion);
      window.setTimeout(function () {
        if (index + 1 < tasks.length) {
          deployOneTask(index + 1, nextVersion, done);
        } else {
          done();
        }
      }, STEP_MS);
    }, UPDATING_MS);
  }

  function startDeployment() {
    if (deploying) return;
    deploying = true;
    deployButton.disabled = true;
    resetButton.disabled = true;
    var nextVersion = currentVersion + 1;

    if (prefersReducedMotion) {
      tasks.forEach(function (task) {
        setTaskState(task, null, nextVersion);
      });
      currentVersion = nextVersion;
      deploying = false;
      deployButton.disabled = false;
      resetButton.disabled = false;
      setStatus('Deployed v' + nextVersion + ' to all ' + tasks.length + ' tasks.');
      return;
    }

    deployOneTask(0, nextVersion, function () {
      currentVersion = nextVersion;
      deploying = false;
      deployButton.disabled = false;
      resetButton.disabled = false;
      setStatus('Deployed v' + nextVersion + ' to all ' + tasks.length + ' tasks.');
    });
  }

  deployButton.addEventListener('click', startDeployment);
  resetButton.addEventListener('click', resetDemo);
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

  var backToTopFadeTimer = null;
  window.addEventListener('scroll', function () {
    backToTop.classList.add('is-scrolling');
    if (backToTopFadeTimer) clearTimeout(backToTopFadeTimer);
    backToTopFadeTimer = setTimeout(function () {
      backToTop.classList.remove('is-scrolling');
    }, 400);
  }, { passive: true });
}

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
