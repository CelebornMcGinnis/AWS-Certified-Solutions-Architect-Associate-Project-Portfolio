document.getElementById('year').textContent = new Date().getFullYear();

// -----------------------------------------------------------------------
// Trigger button + live delivery log
// -----------------------------------------------------------------------
(function () {
  var button = document.getElementById('trigger-button');
  var statusEl = document.getElementById('trigger-status');
  var logBody = document.getElementById('notify-log-body');
  var logEmptyNote = document.getElementById('log-empty-note');
  var cooldownCounter = document.getElementById('cooldown-counter');
  if (!button) return;

  var cfg = window.APP_CONFIG || {};
  var pollTimer = null;
  var placeholderCounter = 0;
  var mobileQuery = window.matchMedia('(max-width: 760px)');
  function maxVisibleRows() {
    // Mobile shows each row as its own full-width card (see the
    // responsive table CSS), so a long list means a lot of scrolling —
    // capping it shorter there keeps the section scannable. Desktop's
    // compact table rows don't have that problem, so it keeps the
    // fuller history.
    return mobileQuery.matches ? 3 : 10;
  }

  // rowData and rowElements are both keyed by messageId (or a
  // local-only placeholder key, before the real id comes back from
  // POST /notify). Row *position* is never trusted to insertion order
  // — every update re-sorts every tracked row by its own triggeredAt
  // and rebuilds the table to match, so the display can't drift out
  // of order no matter what sequence updates happen to arrive in.
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

  function badge(state) {
    if (state === 'ok') return '<span class="status-badge status-badge-ok">✓ delivered</span>';
    if (state === 'error') return '<span class="status-badge status-badge-error">✕ failed</span>';
    return '<span class="status-badge status-badge-pending">pending…</span>';
  }

  function timeLabelFor(triggeredAt) {
    var time = new Date(triggeredAt);
    return isNaN(time.getTime()) ? triggeredAt : time.toLocaleTimeString();
  }

  var mobileBubbleCounter = 0;

  var MESSAGE_ID_EXPLANATION =
    'The publisher Lambda generates a random id the moment it publishes ' +
    'to SNS — it\'s not from AWS itself. Both subscribers get that same ' +
    'id attached to the message, which is how the two independent ' +
    'branches get matched back into a single row instead of showing up ' +
    'as two unrelated events.';

  function fillRow(tr, data) {
    var idCell = data.messageId ? '<code>' + data.messageId.slice(0, 8) + '</code>' : '<span class="muted">—</span>';
    var loggerState = data.logger ? 'ok' : (data.publishFailed ? 'error' : 'pending');
    var sesState = data.emailStatus === 'sent' ? 'ok' : (data.emailStatus === 'failed' || data.publishFailed ? 'error' : 'pending');

    mobileBubbleCounter += 1;
    var bubbleId = 'msg-id-bubble-' + mobileBubbleCounter;
    // The mobile card layout's other labels come from a plain CSS
    // data-label attribute (see the responsive table styles) — that
    // works fine for static text, but can't hold a real clickable
    // button. This cell gets a real inline label instead, hidden on
    // desktop where the actual <th> already provides it.
    var messageIdCell =
      '<span class="mobile-field-label-inline">' +
        'Message ID' +
        '<button type="button" class="info-bubble-trigger" aria-expanded="false" aria-describedby="' + bubbleId + '">' +
          '<span aria-hidden="true">i</span>' +
          '<span class="sr-only">Where does the Message ID come from?</span>' +
        '</button>' +
        '<div class="info-bubble" id="' + bubbleId + '" role="tooltip" hidden>' + MESSAGE_ID_EXPLANATION + '</div>' +
      '</span>' +
      idCell;

    tr.innerHTML =
      '<td data-label="Triggered">' + timeLabelFor(data.triggeredAt) + '</td>' +
      '<td class="msg-id-cell">' + messageIdCell + '</td>' +
      '<td data-label="SQS → Lambda → DynamoDB">' + badge(loggerState) + '</td>' +
      '<td data-label="Lambda → SES">' + badge(sesState) + '</td>';
  }

  // Sets/merges the data for one row, then re-sorts and redraws the
  // whole visible table. Cheap enough at 10 rows to just do this on
  // every change rather than trying to patch the DOM incrementally.
  function upsertRow(key, data) {
    rowData[key] = Object.assign({}, rowData[key], data);
    render();
  }

  // Same as upsertRow, but for a whole batch from /notify/recent in
  // one pass (avoids re-sorting once per row in the batch).
  function upsertRows(rows) {
    if (!rows.length) return;
    rows.forEach(function (row) {
      rowData[row.messageId] = Object.assign({}, rowData[row.messageId], row);
    });
    render();
  }

  function render() {
    var keys = Object.keys(rowData).sort(function (a, b) {
      var ta = new Date(rowData[a].triggeredAt).getTime();
      var tb = new Date(rowData[b].triggeredAt).getTime();
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
      // appendChild moves an existing node rather than duplicating it,
      // so iterating `visible` in newest-first order and appending
      // each in turn rebuilds the table in exactly that order.
      logBody.appendChild(tr);
    });

    logEmptyNote.hidden = visible.length > 0;
  }

  // Renames a row's tracking key without touching its position or
  // content — used when the optimistic placeholder's real messageId
  // comes back from POST /notify.
  function retagRow(oldKey, newKey) {
    if (oldKey === newKey || !rowElements[oldKey]) return;
    rowElements[newKey] = rowElements[oldKey];
    rowData[newKey] = rowData[oldKey];
    delete rowElements[oldKey];
    delete rowData[oldKey];
  }

  mobileQuery.addEventListener('change', render);

  function fetchWithTimeout(url, options) {
    var controller = new AbortController();
    var timeoutId = window.setTimeout(function () {
      controller.abort();
    }, cfg.requestTimeoutMs || 10000);
    // cache: 'no-store' matters most for /notify/recent — that URL gets
    // hit repeatedly during polling, and without this, some browsers
    // will happily serve the first response back on every subsequent
    // call instead of making a fresh request, since the backend never
    // sent an explicit Cache-Control header either way.
    return fetch(url, Object.assign({ cache: 'no-store' }, options, { signal: controller.signal }))
      .finally(function () {
        window.clearTimeout(timeoutId);
      });
  }

  // Rows being actively watched, keyed by messageId -> attempts left.
  // A single shared poll loop runs for as long as this set is
  // non-empty. Clicking the button again while a previous click is
  // still unresolved ADDS to this set rather than replacing it, so an
  // earlier click's row keeps getting watched instead of being
  // abandoned the moment a newer click starts.
  var watching = Object.create(null);
  var pollLoopRunning = false;

  function isResolved(row) {
    return !!(row && row.logger && row.emailStatus === 'sent');
  }

  function pollTick() {
    var headers = Object.assign({}, cfg.headers || {});
    if (cfg.apiKey) headers['x-api-key'] = cfg.apiKey;

    fetchWithTimeout(cfg.apiBase + '/notify/recent', { headers: headers })
      .then(function (res) {
        if (!res.ok) throw new Error('Request failed: ' + res.status);
        return res.json();
      })
      .then(function (data) {
        var rows = data.rows || [];
        upsertRows(rows);

        var byId = {};
        rows.forEach(function (row) { byId[row.messageId] = row; });

        Object.keys(watching).forEach(function (id) {
          if (isResolved(byId[id])) {
            delete watching[id];
          } else {
            watching[id] -= 1;
            if (watching[id] <= 0) delete watching[id]; // gave up on this one
          }
        });

        var remaining = Object.keys(watching).length;
        if (remaining === 0) {
          var allResolved = rows.length > 0;
          setStatus(allResolved ? 'Both fan-out branches delivered.' : 'Published — one branch is still catching up. Refresh the table.', allResolved ? 'success' : 'info');
          clearStatusSoon();
          pollLoopRunning = false;
          return;
        }

        pollTimer = window.setTimeout(pollTick, cfg.pollIntervalMs || 2500);
      })
      .catch(function () {
        setStatus('Could not refresh the delivery log — the message was still published.', 'error');
        clearStatusSoon();
        pollLoopRunning = false;
      });
  }

  function watch(messageId) {
    watching[messageId] = cfg.maxPolls || 30;
    if (!pollLoopRunning) {
      pollLoopRunning = true;
      pollTimer = window.setTimeout(pollTick, cfg.firstPollDelayMs || 1500);
    }
  }

  var COOLDOWN_SECONDS = 3;

  button.addEventListener('click', function () {
    if (!cfg.apiBase || cfg.apiBase.indexOf('REPLACE_ME') !== -1) {
      setStatus('This demo is not wired up to a live endpoint yet.', 'error');
      return;
    }

    // A short cooldown, independent of how long the fan-out itself
    // takes to resolve — this is purely a spam-click guard, not tied
    // to the watch-set logic below (which is fine handling multiple
    // in-flight rows at once; this just paces how fast new ones start).
    // The visible countdown is just the number ticking down each
    // second, not a progress bar or any wording — the disabled/greyed
    // button already communicates "wait."
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

    setStatus('Publishing to SNS…', 'info');

    // Show the row immediately, before the network round-trip even
    // finishes — the visitor sees their click registered right away
    // instead of staring at an unchanged table for a second or two.
    placeholderCounter += 1;
    var placeholderKey = 'pending-' + Date.now() + '-' + placeholderCounter;
    var triggeredAt = new Date().toISOString();
    upsertRow(placeholderKey, { triggeredAt: triggeredAt, messageId: null, logger: false, emailStatus: null });

    var headers = Object.assign({ 'Content-Type': 'application/json' }, cfg.headers || {});
    if (cfg.apiKey) headers['x-api-key'] = cfg.apiKey;

    fetchWithTimeout(cfg.apiBase + '/notify', {
      method: 'POST',
      headers: headers,
      body: JSON.stringify({ note: 'Triggered from the website demo.' })
    })
      .then(function (res) {
        if (!res.ok) throw new Error('Request failed: ' + res.status);
        return res.json();
      })
      .then(function (data) {
        setStatus('Published. Watching for both subscribers to deliver…', 'info');

        // Now that the real messageId exists, retarget the placeholder
        // row to that key so future poll responses (which arrive keyed
        // by the real id) update this same row instead of creating a
        // second one.
        retagRow(placeholderKey, data.messageId);
        upsertRow(data.messageId, { triggeredAt: data.triggeredAt || triggeredAt, messageId: data.messageId });
        watch(data.messageId);
      })
      .catch(function () {
        upsertRow(placeholderKey, { triggeredAt: triggeredAt, messageId: null, publishFailed: true });
        setStatus('Something went wrong publishing that message. Please try again.', 'error');
        clearStatusSoon();
      });
  });

  // Populate the table with whatever's already in the database as
  // soon as the page loads — previously this stayed empty until the
  // visitor's own click, hiding rows other sessions (or a past visit)
  // had already triggered.
  (function loadInitialRows() {
    if (!cfg.apiBase || cfg.apiBase.indexOf('REPLACE_ME') !== -1) return;
    var headers = Object.assign({}, cfg.headers || {});
    if (cfg.apiKey) headers['x-api-key'] = cfg.apiKey;
    fetchWithTimeout(cfg.apiBase + '/notify/recent', { headers: headers })
      .then(function (res) {
        if (!res.ok) throw new Error('Request failed: ' + res.status);
        return res.json();
      })
      .then(function (data) {
        upsertRows(data.rows || []);
      })
      .catch(function () {
        // Silent on failure — the trigger button still works fine even
        // if this initial background fetch doesn't succeed.
      });
  })();
})();

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
  var TOTAL_STEPS = 7;
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
  // actually pinned it to the top of the viewport (desktop only — see
  // the .fanout-diagram mobile override in styles.css). A 1px sentinel
  // sits immediately before the diagram in the HTML — once it scrolls
  // out of view above the viewport, the diagram right after it must
  // now be stuck.
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
// Shared chrome behaviors, copied from project1.html: scroll-reveal,
// nav dropdown, sticky header shrink, back-to-top, mobile menu.
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
    var threshold = wasScrolled ? 4 : 48;
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
    var toggleSidebar = function () {
      setSidebarOpen(!mobileSidebar.classList.contains('is-open'));
    };
    // A tap that lands while the page still has scroll momentum can
    // get consumed by the browser purely to stop that momentum,
    // without ever synthesizing a click event afterward -- touchend
    // fires regardless, so the menu opens from there directly, with
    // preventDefault to stop the browser from also firing a
    // redundant synthetic click right after.
    sidebarToggle.addEventListener('touchend', function (event) {
      event.preventDefault();
      toggleSidebar();
    });
    sidebarToggle.addEventListener('click', toggleSidebar);
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

// -----------------------------------------------------------------------
// Dark mode toggle — wires up whichever .theme-toggle button(s) are
// present (desktop nav icon, mobile menu row) to flip data-theme on
// <html> and remember the choice.
// -----------------------------------------------------------------------
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

// -----------------------------------------------------------------------
// Info bubbles — a small "i" trigger next to a label that reveals a
// short explanation on click. Uses event delegation on document rather
// than binding to a pre-queried list of triggers, since the mobile
// per-row Message ID bubble is created dynamically every time the
// table re-renders — a static list captured once at page load would
// miss every row added after that.
// -----------------------------------------------------------------------
(function () {
  var mobileQuery = window.matchMedia('(max-width: 760px)');

  function closeAll(except) {
    document.querySelectorAll('.info-bubble-trigger[aria-expanded="true"]').forEach(function (trigger) {
      if (trigger === except) return;
      var bubble = document.getElementById(trigger.getAttribute('aria-describedby'));
      if (bubble) {
        bubble.hidden = true;
        bubble.style.top = '';
      }
      trigger.setAttribute('aria-expanded', 'false');
    });
  }

  document.addEventListener('click', function (event) {
    var trigger = event.target.closest ? event.target.closest('.info-bubble-trigger') : null;
    if (!trigger) {
      closeAll(null);
      return;
    }
    event.stopPropagation();
    var bubble = document.getElementById(trigger.getAttribute('aria-describedby'));
    if (!bubble) return;
    var willOpen = bubble.hidden;
    closeAll(trigger);
    bubble.hidden = !willOpen;
    trigger.setAttribute('aria-expanded', String(willOpen));

    // On mobile the bubble is fixed to the viewport's right edge (CSS
    // handles that side), but its vertical position genuinely depends
    // on which row's trigger was clicked, which CSS alone can't know.
    if (willOpen && mobileQuery.matches) {
      var rect = trigger.getBoundingClientRect();
      bubble.style.top = (rect.bottom + 8) + 'px';
    } else {
      bubble.style.top = '';
    }
  });

  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') closeAll(null);
  });

  // capture:true catches scroll events from any scrollable ancestor,
  // not just window — 'scroll' doesn't bubble the way click does.
  window.addEventListener('scroll', function () { closeAll(null); }, { passive: true, capture: true });
})();

// Pricing slider: drag through 5 volume steps instead of scanning 3
// fixed cards. Not a live formula -- these are the same estimates the
// old cards used at the low/moderate/high anchor points, plus two
// extra steps in between for a smoother feel.
(function () {
  var input = document.getElementById('pricing-slider-input');
  var tierEl = document.getElementById('pricing-slider-tier');
  var amountEl = document.getElementById('pricing-slider-amount');
  var descEl = document.getElementById('pricing-slider-desc');
  if (!input || !tierEl || !amountEl || !descEl) return;

  var steps = [
    { tier: "Low volume", amount: "~$0", period: "/mo", desc: "A few hundred triggers a month \u2014 comfortably inside the free tiers for SNS, SQS, Lambda, and DynamoDB on-demand." },
    { tier: "Light volume", amount: "~$0", period: "/mo", desc: "A few thousand triggers a month \u2014 still inside the free tiers." },
    { tier: "Moderate volume", amount: "~$1", period: "/mo", desc: "Tens of thousands of triggers a month \u2014 mostly SES sending costs once its free tier is used up; SNS/SQS/Lambda stay near free." },
    { tier: "Elevated volume", amount: "~$2\u20135", period: "/mo", desc: "Tens of thousands more triggers a month \u2014 SES sends and Lambda invocations both keep climbing across both fan-out branches." },
    { tier: "High volume", amount: "~$5\u201310", period: "/mo", desc: "Hundreds of thousands of triggers a month \u2014 Lambda invocations and SES sends both add up across both fan-out branches." },
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
