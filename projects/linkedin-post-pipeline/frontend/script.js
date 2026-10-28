document.getElementById('year').textContent = new Date().getFullYear();

// -----------------------------------------------------------------------
// Simulated weekly review. Zero network calls anywhere in this file: the
// five sample posts below are invented for the demo, and every approval,
// decline, and deferral lives only in this browser tab's memory. The
// real pipeline's review page works the same way, but backed by DynamoDB
// and EventBridge Scheduler instead of an in-page array.
// -----------------------------------------------------------------------
(function () {
  var generateButton = document.getElementById('li-generate-button');
  var resetButton = document.getElementById('li-reset-button');
  var statusEl = document.getElementById('li-status');
  var placeholder = document.getElementById('li-placeholder');
  var board = document.getElementById('li-board');
  var postsEl = document.getElementById('li-posts');
  var summaryEl = document.getElementById('li-summary');
  var publishButton = document.getElementById('li-publish-button');
  if (!generateButton) return;

  var prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Subjects and weekday slots mirror the real config; the text is made up.
  var SAMPLE_WEEK = [
    { day: 'Mon', subject: 'People management', icon: 'M', text: 'A small change that makes one-on-ones better: start with the other person’s agenda, not yours. Ask what is getting in their way this week, then spend the rest of the time on that.' },
    { day: 'Tue', subject: 'Cloud architecture', icon: 'T', text: 'A habit worth keeping: before adding a service to a design, write down which failure it removes. If you cannot name one, you probably just added a line to the bill.' },
    { day: 'Wed', subject: 'AI tips', icon: 'W', text: 'Prompt tip: tell the model who the reader is, not just the topic. “Explain this to a nervous first-time manager” beats “explain this” almost every time.' },
    { day: 'Thu', subject: 'Excel tips', icon: 'T', text: 'Excel tip: XLOOKUP can look in any direction and tells you plainly when there is no match. It retires most of the VLOOKUP headaches you have been working around.' },
    { day: 'Fri', subject: 'Family funny', icon: 'F', text: 'Overheard at home: my kid explained that cloud storage is “where the internet keeps my stuff when it rains.” Honestly, not far off.' }
  ];

  // Same two windows the real config uses, as minutes since midnight (ET).
  var WINDOWS = [[11 * 60, 16 * 60], [18 * 60, 21 * 60]];

  var posts = [];
  var generating = false;

  function pickMinute() {
    var total = WINDOWS.reduce(function (sum, w) { return sum + (w[1] - w[0]); }, 0);
    var r = Math.floor(Math.random() * total);
    for (var i = 0; i < WINDOWS.length; i += 1) {
      var len = WINDOWS[i][1] - WINDOWS[i][0];
      if (r < len) return WINDOWS[i][0] + r;
      r -= len;
    }
    return WINDOWS[0][0];
  }

  function formatTime(minutes) {
    var h = Math.floor(minutes / 60);
    var m = minutes % 60;
    var suffix = h >= 12 ? 'PM' : 'AM';
    var h12 = h % 12 === 0 ? 12 : h % 12;
    return h12 + ':' + (m < 10 ? '0' : '') + m + ' ' + suffix + ' ET';
  }

  function setStatus(message) {
    statusEl.textContent = message;
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function badgeFor(post) {
    var labels = {
      draft: 'Draft',
      approved: 'Scheduled ' + (post.minute ? formatTime(post.minute) : ''),
      declined: 'Declined',
      deferred: 'Deferred',
      published: 'Published (simulated)'
    };
    return labels[post.state];
  }

  function renderSummary() {
    var counts = { draft: 0, approved: 0, declined: 0, deferred: 0, published: 0 };
    posts.forEach(function (p) { counts[p.state] += 1; });
    summaryEl.textContent =
      counts.draft + ' awaiting review · ' +
      counts.approved + ' scheduled · ' +
      counts.published + ' published · ' +
      counts.declined + ' declined · ' +
      counts.deferred + ' deferred';
    publishButton.disabled = counts.approved === 0;
  }

  function render() {
    postsEl.textContent = '';
    posts.forEach(function (post, index) {
      var card = el('article', 'li-post is-' + post.state);

      var thumb = el('div', 'li-post-image');
      thumb.setAttribute('aria-hidden', 'true');
      thumb.appendChild(el('span', 'li-post-image-letter', post.data.icon));
      card.appendChild(thumb);

      var body = el('div', 'li-post-body');
      var head = el('div', 'li-post-head');
      head.appendChild(el('span', 'li-post-day', post.data.day));
      head.appendChild(el('span', 'li-post-subject', post.data.subject));
      head.appendChild(el('span', 'li-post-badge', badgeFor(post)));
      body.appendChild(head);
      body.appendChild(el('p', 'li-post-text', post.data.text));

      if (post.state === 'declined' && post.reason) {
        body.appendChild(el('p', 'li-post-note muted small-note', 'Reason saved as a lesson for next week: “' + post.reason + '”'));
      }
      if (post.state === 'approved') {
        body.appendChild(el('p', 'li-post-note muted small-note', 'One-time EventBridge schedule created for this exact minute. It deletes itself after it runs.'));
      }

      if (post.state === 'draft' || post.state === 'deferred') {
        var actions = el('div', 'li-post-actions');
        var approve = el('button', 'li-btn li-btn-approve', 'Approve');
        approve.type = 'button';
        approve.addEventListener('click', function () {
          post.state = 'approved';
          post.minute = pickMinute();
          setStatus(post.data.day + ' approved and scheduled for ' + formatTime(post.minute) + '.');
          render();
        });
        var decline = el('button', 'li-btn', 'Decline');
        decline.type = 'button';
        decline.addEventListener('click', function () {
          post.state = 'declined';
          post.reason = '';
          setStatus(post.data.day + ' declined. Nothing was scheduled.');
          render();
        });
        var defer = el('button', 'li-btn', post.state === 'deferred' ? 'Still deferred' : 'Defer');
        defer.type = 'button';
        defer.disabled = post.state === 'deferred';
        defer.addEventListener('click', function () {
          post.state = 'deferred';
          setStatus(post.data.day + ' deferred. It stays out of the schedule until you decide.');
          render();
        });
        actions.appendChild(approve);
        actions.appendChild(decline);
        actions.appendChild(defer);
        body.appendChild(actions);
      } else if (post.state === 'declined') {
        var reasonRow = el('div', 'li-post-actions');
        var input = document.createElement('input');
        input.type = 'text';
        input.className = 'li-reason-input';
        input.maxLength = 120;
        input.placeholder = 'Why? (optional)';
        input.setAttribute('aria-label', 'Why was ' + post.data.day + ' declined? (optional)');
        input.value = post.reason || '';
        var save = el('button', 'li-btn', 'Save reason');
        save.type = 'button';
        save.addEventListener('click', function () {
          post.reason = input.value.trim();
          setStatus('Reason saved. The real pipeline feeds the last eight weeks of these into new drafts.');
          render();
        });
        var undo = el('button', 'li-btn', 'Undo');
        undo.type = 'button';
        undo.addEventListener('click', function () {
          post.state = 'draft';
          post.reason = '';
          render();
        });
        reasonRow.appendChild(input);
        reasonRow.appendChild(save);
        reasonRow.appendChild(undo);
        body.appendChild(reasonRow);
      }

      card.appendChild(body);
      postsEl.appendChild(card);
    });
    renderSummary();
  }

  function reveal() {
    placeholder.hidden = true;
    board.hidden = false;
    resetButton.hidden = false;
    generateButton.textContent = 'Regenerate Sample Week';
  }

  function startGenerate() {
    if (generating) return;
    generating = true;
    generateButton.disabled = true;
    var steps = [
      'Saturday 10:00 ET — the weekly schedule fires the Draft function…',
      'Reading research feeds and asking Bedrock for five posts…',
      'Rendering images and saving drafts…',
      'Emailing the review link through SES…'
    ];
    var i = 0;
    function next() {
      if (i < steps.length) {
        setStatus(steps[i]);
        i += 1;
        setTimeout(next, prefersReducedMotion ? 0 : 650);
        return;
      }
      posts = SAMPLE_WEEK.map(function (data) {
        return { data: data, state: 'draft', minute: 0, reason: '' };
      });
      reveal();
      render();
      setStatus('Five drafts are ready. Nothing is scheduled until you approve it.');
      generateButton.disabled = false;
      generating = false;
    }
    next();
  }

  generateButton.addEventListener('click', startGenerate);

  resetButton.addEventListener('click', function () {
    posts = [];
    board.hidden = true;
    placeholder.hidden = false;
    resetButton.hidden = true;
    generateButton.textContent = 'Generate Sample Week';
    setStatus('');
  });

  publishButton.addEventListener('click', function () {
    var n = 0;
    posts.forEach(function (p) {
      if (p.state === 'approved') {
        p.state = 'published';
        n += 1;
      }
    });
    setStatus(n + (n === 1 ? ' scheduled post' : ' scheduled posts') + ' published (simulated). Drafts, declined, and deferred posts were left alone.');
    render();
  });
})();

// -----------------------------------------------------------------------
// Pricing slider: three regeneration levels. Estimates only -- see the
// assumptions in the "What drives the cost" list on the page.
// -----------------------------------------------------------------------
(function () {
  var input = document.getElementById('pricing-slider-input');
  var tierEl = document.getElementById('pricing-slider-tier');
  var amountEl = document.getElementById('pricing-slider-amount');
  var descEl = document.getElementById('pricing-slider-desc');
  if (!input || !tierEl || !amountEl || !descEl) return;

  var steps = [
    { tier: 'Draft only', amount: '~$0.50', period: '/mo', desc: 'One weekly Bedrock call for five posts (about 11 cents each time), no redos. Everything else sits inside free tiers or rounds to pennies.' },
    { tier: 'A few redos', amount: '~$1', period: '/mo', desc: 'About ten single-post regenerations a month at a couple of cents apiece, on top of the weekly draft.' },
    { tier: 'Lots of redos', amount: '~$2\u20133', period: '/mo', desc: 'Dozens of regenerations a month. The model call is still the only meaningful cost; the rest of the stack barely moves.' }
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
// Architecture diagram lightbox: click the thumbnail (or press Enter/
// Space on it) to expand the full diagram full-screen; Escape, the
// backdrop, or the close button dismiss it. Same markup/behavior on
// every project page.
// -----------------------------------------------------------------------
(function () {
  var trigger = document.getElementById('arch-diagram-trigger');
  var lightbox = document.getElementById('arch-diagram-lightbox');
  var closeBtn = document.getElementById('arch-diagram-lightbox-close');
  if (!trigger || !lightbox || !closeBtn) return;

  function openLightbox() {
    lightbox.classList.add('is-open');
    lightbox.setAttribute('aria-hidden', 'false');
    document.body.classList.add('diagram-lightbox-open');
    closeBtn.focus();
  }

  function closeLightbox() {
    lightbox.classList.remove('is-open');
    lightbox.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('diagram-lightbox-open');
    trigger.focus();
  }

  trigger.addEventListener('click', openLightbox);
  closeBtn.addEventListener('click', closeLightbox);
  lightbox.addEventListener('click', function (event) {
    if (event.target === lightbox) closeLightbox();
  });
  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && lightbox.classList.contains('is-open')) {
      closeLightbox();
    }
  });
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
