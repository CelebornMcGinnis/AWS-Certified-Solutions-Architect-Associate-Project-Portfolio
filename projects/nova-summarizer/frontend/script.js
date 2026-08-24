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

document.querySelectorAll('.nav-dropdown, .mobile-menu').forEach(function (details) {
  document.addEventListener('click', function (event) {
    if (details.open && !details.contains(event.target)) {
      details.open = false;
    }
  });
});

function closeOpenNavMenus() {
  document.querySelectorAll('.nav-dropdown[open], .mobile-menu[open]').forEach(function (details) {
    details.open = false;
  });
}
window.addEventListener('scroll', closeOpenNavMenus, { passive: true });
document.querySelectorAll('.nav-dropdown-menu a, .mobile-menu-panel a').forEach(function (link) {
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

var mobileMenu = document.getElementById('mobile-menu');
if (mobileMenu) {
  var mobileMenuPanel = mobileMenu.querySelector('.mobile-menu-panel');
  var toggleMobileMenuVisibility = function () {
    var visible = window.scrollY > 220;
    mobileMenu.classList.toggle('is-visible', visible);
    if (!visible && mobileMenu.open) {
      mobileMenu.open = false;
    }
  };
  toggleMobileMenuVisibility();
  window.addEventListener('scroll', toggleMobileMenuVisibility, { passive: true });

  if (mobileMenuPanel) {
    mobileMenu.addEventListener('toggle', function () {
      if (mobileMenu.open) {
        mobileMenuPanel.style.animation = 'none';
        void mobileMenuPanel.offsetWidth;
        mobileMenuPanel.style.animation = 'mobileMenuIn 0.18s ease forwards';
      }
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
