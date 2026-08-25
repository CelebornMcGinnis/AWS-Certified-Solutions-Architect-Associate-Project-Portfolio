document.getElementById('year').textContent = new Date().getFullYear();

// -----------------------------------------------------------------------
// Submit button + job timeline + recent jobs log
// -----------------------------------------------------------------------
(function () {
  var button = document.getElementById('submit-job-button');
  var statusEl = document.getElementById('job-status');
  var cooldownCounter = document.getElementById('cooldown-counter');
  var timelineWrap = document.getElementById('job-timeline-wrap');
  var timelineSteps = Array.prototype.slice.call(document.querySelectorAll('#job-timeline .job-timeline-step'));
  var jobIdNote = document.getElementById('job-id-note');
  var logBody = document.getElementById('recent-jobs-body');
  var logEmptyNote = document.getElementById('log-empty-note');
  if (!button) return;

  var cfg = window.APP_CONFIG || {};
  var mobileQuery = window.matchMedia('(max-width: 760px)');
  function maxVisibleRows() {
    return mobileQuery.matches ? 3 : 10;
  }

  // Keyed by jobId. Same "re-sort and redraw everything on every change"
  // approach as the SNS fan-out project's log table -- cheap enough at
  // 10 rows, and avoids the display ever drifting out of newest-first
  // order no matter what sequence updates arrive in.
  var rowData = Object.create(null);
  var rowElements = Object.create(null);

  function setStatus(message, kind) {
    statusEl.textContent = message;
    statusEl.className = 'form-status is-visible' + (kind ? ' ' + kind : '');
  }

  function clearStatusSoon() {
    window.setTimeout(function () {
      statusEl.classList.remove('is-visible');
    }, 4000);
  }

  function badge(status) {
    if (status === 'COMPLETE') return '<span class="status-badge status-badge-ok">✓ complete</span>';
    return '<span class="status-badge status-badge-pending">' + (status || 'pending').toLowerCase() + '…</span>';
  }

  function timeLabelFor(createdAt) {
    var time = new Date(createdAt);
    return isNaN(time.getTime()) ? createdAt : time.toLocaleTimeString();
  }

  function fillRow(tr, data) {
    var idCell = data.jobId ? '<code>' + data.jobId.slice(0, 8) + '</code>' : '<span class="muted">—</span>';
    tr.innerHTML =
      '<td data-label="Submitted">' + timeLabelFor(data.createdAt) + '</td>' +
      '<td data-label="Job ID">' + idCell + '</td>' +
      '<td data-label="Status">' + badge(data.status) + '</td>';
  }

  function upsertRow(key, data) {
    rowData[key] = Object.assign({}, rowData[key], data);
    render();
  }

  function upsertRows(rows) {
    if (!rows.length) return;
    rows.forEach(function (row) {
      rowData[row.jobId] = Object.assign({}, rowData[row.jobId], row);
    });
    render();
  }

  function render() {
    var keys = Object.keys(rowData).sort(function (a, b) {
      var ta = new Date(rowData[a].createdAt).getTime();
      var tb = new Date(rowData[b].createdAt).getTime();
      return tb - ta; // newest first
    });

    var visible = keys.slice(0, maxVisibleRows());
    var overflow = keys.slice(maxVisibleRows());

    overflow.forEach(function (key) {
      var tr = rowElements[key];
      if (tr && tr.parentNode) tr.parentNode.removeChild(tr);
      delete rowElements[key];
      delete rowData[key];
    });

    visible.forEach(function (key) {
      var tr = rowElements[key];
      if (!tr) {
        tr = document.createElement('tr');
        rowElements[key] = tr;
      }
      fillRow(tr, rowData[key]);
      logBody.appendChild(tr);
    });

    logEmptyNote.hidden = visible.length > 0;
  }

  mobileQuery.addEventListener('change', render);

  function fetchWithTimeout(url, options) {
    var controller = new AbortController();
    var timeoutId = window.setTimeout(function () {
      controller.abort();
    }, cfg.requestTimeoutMs || 10000);
    return fetch(url, Object.assign({ cache: 'no-store' }, options, { signal: controller.signal }))
      .finally(function () {
        window.clearTimeout(timeoutId);
      });
  }

  // Lights up the timeline to match a given status: stages before the
  // current one (or the current one, once COMPLETE) get a checkmark and
  // "done" styling; the current stage (while still running) pulses as
  // "active"; everything after stays a plain numbered dot.
  var STAGE_ORDER = ['SUBMITTED', 'VALIDATING', 'PROCESSING', 'COMPLETE'];

  function applyTimelineStatus(status) {
    var currentIndex = STAGE_ORDER.indexOf(status);
    if (currentIndex === -1) currentIndex = 0;

    timelineSteps.forEach(function (el) {
      var stepIndex = STAGE_ORDER.indexOf(el.getAttribute('data-status'));
      var dot = el.querySelector('.job-timeline-dot');
      el.classList.remove('is-done', 'is-active');

      if (stepIndex < currentIndex || (stepIndex === currentIndex && status === 'COMPLETE')) {
        el.classList.add('is-done');
        dot.textContent = '✓';
      } else {
        if (stepIndex === currentIndex) el.classList.add('is-active');
        dot.textContent = String(stepIndex + 1);
      }
    });
  }

  var pollsLeft = 0;
  var pollTimer = null;

  function pollJob(jobId) {
    var headers = Object.assign({}, cfg.headers || {});
    if (cfg.apiKey) headers['x-api-key'] = cfg.apiKey;

    fetchWithTimeout(cfg.apiBase + '/jobs/' + jobId, { headers: headers })
      .then(function (res) {
        if (!res.ok) throw new Error('Request failed: ' + res.status);
        return res.json();
      })
      .then(function (data) {
        applyTimelineStatus(data.status);
        upsertRow(data.jobId, data);

        if (data.status === 'COMPLETE') {
          setStatus('Job complete.', 'success');
          clearStatusSoon();
          return;
        }

        pollsLeft -= 1;
        if (pollsLeft <= 0) {
          setStatus('Still running — refresh in a moment to see it finish.', 'info');
          clearStatusSoon();
          return;
        }
        pollTimer = window.setTimeout(function () {
          pollJob(jobId);
        }, cfg.pollIntervalMs || 2000);
      })
      .catch(function () {
        setStatus('Lost track of that job — it may still be running.', 'error');
        clearStatusSoon();
      });
  }

  function watch(jobId) {
    pollsLeft = cfg.maxPolls || 20;
    if (pollTimer) window.clearTimeout(pollTimer);
    pollTimer = window.setTimeout(function () {
      pollJob(jobId);
    }, cfg.firstPollDelayMs || 1500);
  }

  var COOLDOWN_SECONDS = 3;

  button.addEventListener('click', function () {
    if (!cfg.apiBase || cfg.apiBase.indexOf('REPLACE_ME') !== -1) {
      setStatus('This demo is not wired up to a live endpoint yet.', 'error');
      return;
    }

    // Spam-click guard, independent of how long the workflow itself
    // takes to finish.
    button.disabled = true;
    var secondsLeft = COOLDOWN_SECONDS;
    if (cooldownCounter) cooldownCounter.textContent = String(secondsLeft);
    var cooldownTimer = window.setInterval(function () {
      secondsLeft -= 1;
      if (secondsLeft <= 0) {
        window.clearInterval(cooldownTimer);
        button.disabled = false;
        if (cooldownCounter) cooldownCounter.textContent = '';
      } else if (cooldownCounter) {
        cooldownCounter.textContent = String(secondsLeft);
      }
    }, 1000);

    setStatus('Starting the workflow…', 'info');
    timelineWrap.hidden = false;
    applyTimelineStatus('SUBMITTED');
    jobIdNote.textContent = '';

    var headers = Object.assign({ 'Content-Type': 'application/json' }, cfg.headers || {});
    if (cfg.apiKey) headers['x-api-key'] = cfg.apiKey;

    fetchWithTimeout(cfg.apiBase + '/jobs', { method: 'POST', headers: headers })
      .then(function (res) {
        if (!res.ok) throw new Error('Request failed: ' + res.status);
        return res.json();
      })
      .then(function (data) {
        setStatus('Job submitted — watching it run…', 'info');
        jobIdNote.textContent = 'Job id: ' + data.jobId;
        upsertRow(data.jobId, data);
        watch(data.jobId);
      })
      .catch(function () {
        setStatus('Something went wrong submitting that job. Please try again.', 'error');
        clearStatusSoon();
      });
  });

  // Populate the recent-jobs table with whatever's already in the
  // database as soon as the page loads, same as the SNS fan-out project.
  (function loadInitialRows() {
    if (!cfg.apiBase || cfg.apiBase.indexOf('REPLACE_ME') !== -1) return;
    var headers = Object.assign({}, cfg.headers || {});
    if (cfg.apiKey) headers['x-api-key'] = cfg.apiKey;
    fetchWithTimeout(cfg.apiBase + '/jobs/recent', { headers: headers })
      .then(function (res) {
        if (!res.ok) throw new Error('Request failed: ' + res.status);
        return res.json();
      })
      .then(function (data) {
        upsertRows(data.jobs || []);
      })
      .catch(function () {
        // Silent on failure -- the submit button still works fine even
        // if this initial background fetch doesn't succeed.
      });
  })();
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
  var updateHeaderState = function () {
    headerRafId = null;
    var threshold = wasScrolled ? 8 : 24;
    var scrolled = window.scrollY > threshold;
    if (scrolled !== wasScrolled) {
      siteHeader.classList.toggle('is-scrolled', scrolled);
      wasScrolled = scrolled;
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
