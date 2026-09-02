document.getElementById('year').textContent = new Date().getFullYear();

(function () {
  var cfg = window.APP_CONFIG || {};
  var form = document.getElementById('summarize-form');
  if (!form) return;

  var textInput = document.getElementById('summarize-text');
  var charCount = document.getElementById('char-count');
  var lengthRadios = document.querySelectorAll('input[name="length"]');
  var submitButton = document.getElementById('summarize-submit');
  var statusEl = document.getElementById('summarize-status');
  var resultWrap = document.getElementById('summarize-result');
  var resultPlaceholder = document.getElementById('summarize-result-placeholder');
  var resultTitle = document.getElementById('summarize-result-title');
  var resultBullets = document.getElementById('summarize-result-bullets');
  var resultTakeawaysWrap = document.getElementById('summarize-result-takeaways-wrap');
  var resultTakeaways = document.getElementById('summarize-result-takeaways');
  var resultMeta = document.getElementById('summarize-result-meta');

  function renderList(el, items) {
    el.innerHTML = '';
    items.forEach(function (item) {
      var li = document.createElement('li');
      li.textContent = item;
      el.appendChild(li);
    });
  }

  function updateCharCount() {
    var len = textInput.value.length;
    charCount.textContent = len + ' / ' + (cfg.maxInputChars || 6000) + ' characters';
    charCount.classList.toggle('is-over-limit', len > (cfg.maxInputChars || 6000));
  }
  textInput.addEventListener('input', updateCharCount);
  updateCharCount();

  function setStatus(message, kind) {
    statusEl.textContent = message;
    statusEl.hidden = !message;
    statusEl.className = 'form-status' + (message ? ' is-visible' : '') + (kind ? ' ' + kind : '');
  }

  function fetchWithTimeout(url, options) {
    var controller = new AbortController();
    var timeoutId = window.setTimeout(function () {
      controller.abort();
    }, cfg.requestTimeoutMs || 25000);
    return fetch(url, Object.assign({ cache: 'no-store' }, options, { signal: controller.signal })).finally(function () {
      window.clearTimeout(timeoutId);
    });
  }

  function selectedLength() {
    for (var i = 0; i < lengthRadios.length; i++) {
      if (lengthRadios[i].checked) return lengthRadios[i].value;
    }
    return 'short';
  }

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    var text = textInput.value.trim();
    if (!text) {
      setStatus('Please paste some text to summarize.', 'error');
      return;
    }
    if (text.length > (cfg.maxInputChars || 6000)) {
      setStatus('That text is too long -- please trim it down first.', 'error');
      return;
    }

    submitButton.disabled = true;
    resultWrap.hidden = true;
    setStatus('Summarizing…', 'info');

    fetchWithTimeout(cfg.apiBase + '/summarize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: text, length: selectedLength() }),
    })
      .then(function (res) {
        if (res.status === 429) {
          return res.json().then(function (data) {
            throw new Error(data.error || 'This demo has reached its request limit for today.');
          });
        }
        if (!res.ok) throw new Error('Request failed: ' + res.status);
        return res.json();
      })
      .then(function (data) {
        setStatus('', null);
        resultTitle.textContent = data.title;
        renderList(resultBullets, data.bullets || []);
        if (data.takeaways && data.takeaways.length) {
          renderList(resultTakeaways, data.takeaways);
          resultTakeawaysWrap.hidden = false;
        } else {
          resultTakeawaysWrap.hidden = true;
        }
        resultMeta.textContent = (data.length === 'detailed' ? 'Detailed summary' : 'Short summary') + ' · from ' + data.inputCharacterCount + ' characters of input';
        if (resultPlaceholder) resultPlaceholder.hidden = true;
        resultWrap.hidden = false;
      })
      .catch(function (err) {
        setStatus(err.message || 'Something went wrong summarizing that text. Please try again.', 'error');
      })
      .finally(function () {
        submitButton.disabled = false;
      });
  });
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
    { tier: "Light volume", amount: "~$0", period: "/mo", desc: "A handful of summaries a day, a small fraction of the daily cap \u2014 Nova Lite is one of Bedrock's cheapest models per token, so casual use costs a fraction of a cent." },
    { tier: "Moderate volume", amount: "~$0", period: "/mo", desc: "Around half the daily cap reached most days \u2014 still comfortably cheap thanks to Nova Lite's low per-token pricing." },
    { tier: "Regular volume", amount: "~$0.50\u20131", period: "/mo", desc: "The daily cap reached on most days \u2014 a small, predictable ceiling rather than an open-ended bill." },
    { tier: "Heavy volume", amount: "~$1\u20132", period: "/mo", desc: "The daily cap fully engaged every day of the month \u2014 this demo's own request limit, not Bedrock pricing, is what's setting the ceiling here." },
    { tier: "Capped by design", amount: "Capped by design", period: "", desc: "The whole point of the daily request limit \u2014 traffic beyond it is rejected with a 429 rather than ever reaching Bedrock, so cost can't run away regardless of how much traffic shows up." },
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
