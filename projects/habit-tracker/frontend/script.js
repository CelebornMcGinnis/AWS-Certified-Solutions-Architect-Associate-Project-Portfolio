document.getElementById('year').textContent = new Date().getFullYear();

// -----------------------------------------------------------------------
// Device id: this project has no accounts. A random id is generated once
// and kept in localStorage, then sent as plain request data on every
// call -- the API trusts it as-is, with no way to verify it actually
// belongs to this browser. That's disclosed directly in the device
// notice banner in the page itself, not just here.
// -----------------------------------------------------------------------
var DeviceId = (function () {
  var STORAGE_KEY = 'habitTrackerDeviceId';
  var id = null;
  try {
    id = window.localStorage.getItem(STORAGE_KEY);
  } catch (e) {}

  if (!id) {
    id = (window.crypto && window.crypto.randomUUID) ? window.crypto.randomUUID() : 'device-' + Date.now() + '-' + Math.random().toString(16).slice(2);
    try {
      window.localStorage.setItem(STORAGE_KEY, id);
    } catch (e) {}
  }

  return id;
})();

(function () {
  var cfg = window.APP_CONFIG || {};
  var form = document.getElementById('habit-form');
  var nameInput = document.getElementById('habit-name');
  var formStatus = document.getElementById('habit-form-status');
  var listEl = document.getElementById('habit-list');
  var emptyNote = document.getElementById('habit-list-empty-note');
  var deviceIdNote = document.getElementById('device-id-note');
  if (!form) return;

  deviceIdNote.textContent = DeviceId.slice(0, 8);

  function fetchWithTimeout(url, options) {
    var controller = new AbortController();
    var timeoutId = window.setTimeout(function () {
      controller.abort();
    }, cfg.requestTimeoutMs || 10000);
    return fetch(url, Object.assign({ cache: 'no-store' }, options, { signal: controller.signal })).finally(function () {
      window.clearTimeout(timeoutId);
    });
  }

  function setFormStatus(message, kind) {
    formStatus.textContent = message;
    formStatus.hidden = !message;
    formStatus.className = 'form-status' + (message ? ' is-visible' : '') + (kind ? ' ' + kind : '');
  }

  // Keyed by habitId, so re-renders can reuse each card's DOM node
  // instead of losing scroll position / the delete-confirm state on
  // every refresh.
  var habitCards = Object.create(null);

  function dayLabel(dateStr) {
    var d = new Date(dateStr + 'T00:00:00Z');
    return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  }

  function buildCalendar(container, checkedDates) {
    var checkedSet = Object.create(null);
    checkedDates.forEach(function (d) {
      checkedSet[d] = true;
    });

    container.innerHTML = '';
    var days = cfg.calendarDays || 28;
    var today = new Date();
    for (var i = days - 1; i >= 0; i--) {
      var d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - i));
      var dateStr = d.toISOString().slice(0, 10);
      var cell = document.createElement('span');
      cell.className = 'habit-calendar-cell' + (checkedSet[dateStr] ? ' is-checked' : '');
      cell.title = dayLabel(dateStr) + (checkedSet[dateStr] ? ' — checked in' : ' — not checked in');
      container.appendChild(cell);
    }
  }

  function loadCalendar(habitId, container) {
    fetchWithTimeout(cfg.apiBase + '/habits/' + habitId + '/checkins?ownerId=' + encodeURIComponent(DeviceId) + '&days=' + (cfg.calendarDays || 28))
      .then(function (res) {
        if (!res.ok) throw new Error('Request failed: ' + res.status);
        return res.json();
      })
      .then(function (data) {
        buildCalendar(container, data.dates || []);
      })
      .catch(function () {
        // Leave the calendar blank rather than block the rest of the card.
      });
  }

  function checkInStatusText(habit) {
    var today = new Date().toISOString().slice(0, 10);
    return habit.lastCheckInDate === today;
  }

  function renderCard(habit) {
    var existing = habitCards[habit.habitId];
    var card = existing ? existing.card : document.createElement('article');
    card.className = 'habit-card';

    var checkedInToday = checkInStatusText(habit);

    card.innerHTML =
      '<div class="habit-card-head">' +
      '<h3>' + habit.name.replace(/</g, '&lt;') + '</h3>' +
      '<button type="button" class="ghost button-link habit-delete-button" data-habit-id="' + habit.habitId + '">Delete</button>' +
      '</div>' +
      '<div class="habit-stats">' +
      '<span><strong>' + habit.currentStreak + '</strong> day' + (habit.currentStreak === 1 ? '' : 's') + ' current streak</span>' +
      '<span><strong>' + habit.longestStreak + '</strong> day' + (habit.longestStreak === 1 ? '' : 's') + ' best streak</span>' +
      '</div>' +
      '<div class="habit-calendar" data-calendar></div>' +
      '<button type="button" class="habit-checkin-button' + (checkedInToday ? ' is-done' : '') + '" data-habit-id="' + habit.habitId + '"' + (checkedInToday ? ' disabled' : '') + '>' +
      (checkedInToday ? '✓ Checked in today' : 'Check in today') +
      '</button>';

    if (!existing) {
      listEl.appendChild(card);
      habitCards[habit.habitId] = { card: card, habit: habit };
    } else {
      habitCards[habit.habitId].habit = habit;
    }

    loadCalendar(habit.habitId, card.querySelector('[data-calendar]'));
  }

  function removeCard(habitId) {
    var entry = habitCards[habitId];
    if (entry && entry.card.parentNode) {
      entry.card.parentNode.removeChild(entry.card);
    }
    delete habitCards[habitId];
  }

  function renderEmptyState() {
    emptyNote.hidden = Object.keys(habitCards).length > 0;
  }

  function loadHabits() {
    fetchWithTimeout(cfg.apiBase + '/habits?ownerId=' + encodeURIComponent(DeviceId))
      .then(function (res) {
        if (!res.ok) throw new Error('Request failed: ' + res.status);
        return res.json();
      })
      .then(function (data) {
        var habits = data.habits || [];
        var seenIds = Object.create(null);
        habits.forEach(function (habit) {
          seenIds[habit.habitId] = true;
          renderCard(habit);
        });
        Object.keys(habitCards).forEach(function (id) {
          if (!seenIds[id]) removeCard(id);
        });
        renderEmptyState();
      })
      .catch(function () {
        emptyNote.hidden = false;
        emptyNote.textContent = 'Could not load your habits right now -- try refreshing the page.';
      });
  }

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    var name = nameInput.value.trim();
    if (!name) return;

    setFormStatus('Adding…', 'info');
    fetchWithTimeout(cfg.apiBase + '/habits', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ownerId: DeviceId, name: name }),
    })
      .then(function (res) {
        if (!res.ok) throw new Error('Request failed: ' + res.status);
        return res.json();
      })
      .then(function (habit) {
        setFormStatus('', null);
        nameInput.value = '';
        renderCard(habit);
        renderEmptyState();
      })
      .catch(function () {
        setFormStatus('Could not add that habit. Please try again.', 'error');
      });
  });

  // Event delegation for check-in and delete buttons -- cards are
  // re-created/reused across renders, so binding once on the list
  // container avoids re-attaching a listener to every card every time.
  var deleteConfirmTimers = Object.create(null);

  listEl.addEventListener('click', function (event) {
    var checkinButton = event.target.closest('.habit-checkin-button');
    if (checkinButton && !checkinButton.disabled) {
      var habitId = checkinButton.getAttribute('data-habit-id');
      checkinButton.disabled = true;
      fetchWithTimeout(cfg.apiBase + '/habits/' + habitId + '/checkins', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ownerId: DeviceId }),
      })
        .then(function (res) {
          if (!res.ok) throw new Error('Request failed: ' + res.status);
          return res.json();
        })
        .then(function (data) {
          var entry = habitCards[habitId];
          if (entry) renderCard(Object.assign({}, entry.habit, data));
        })
        .catch(function () {
          checkinButton.disabled = false;
        });
      return;
    }

    var deleteButton = event.target.closest('.habit-delete-button');
    if (deleteButton) {
      var deleteHabitId = deleteButton.getAttribute('data-habit-id');
      if (!deleteConfirmTimers[deleteHabitId]) {
        deleteButton.textContent = 'Confirm delete?';
        deleteConfirmTimers[deleteHabitId] = window.setTimeout(function () {
          deleteButton.textContent = 'Delete';
          delete deleteConfirmTimers[deleteHabitId];
        }, 3000);
        return;
      }

      window.clearTimeout(deleteConfirmTimers[deleteHabitId]);
      delete deleteConfirmTimers[deleteHabitId];
      deleteButton.disabled = true;
      fetchWithTimeout(cfg.apiBase + '/habits/' + deleteHabitId + '?ownerId=' + encodeURIComponent(DeviceId), { method: 'DELETE' })
        .then(function (res) {
          if (!res.ok) throw new Error('Request failed: ' + res.status);
          removeCard(deleteHabitId);
          renderEmptyState();
        })
        .catch(function () {
          deleteButton.disabled = false;
          deleteButton.textContent = 'Delete';
        });
    }
  });

  loadHabits();
})();

// -----------------------------------------------------------------------
// Shared chrome behaviors, copied from the other project pages:
// scroll-reveal, nav dropdown, sticky header shrink, back-to-top, mobile
// menu, dark mode toggle.
// -----------------------------------------------------------------------
// -----------------------------------------------------------------------
// "How it works" diagram: same autoplay/click-to-jump behavior used on
// the contact form project page. The AWS icons themselves are the click
// targets — the connector arrows are purely decorative (aria-hidden in
// the HTML).
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
  var connectors = Array.prototype.slice.call(diagram.querySelectorAll('.flow-connector, .fork-wrap, .fork-diagonal'));
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
      // The one node with no data-step is the origin (Visitor) — it
      // counts as "done" as soon as anything has started, same as
      // before switching this from index-based matching.
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

  // Shrink the diagram slightly once its own sticky positioning has
  // actually pinned it to the top of the viewport (desktop only). A 1px
  // sentinel sits immediately before the diagram in the HTML — once it
  // scrolls out of view above the viewport, the diagram right after it
  // must now be stuck.
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
