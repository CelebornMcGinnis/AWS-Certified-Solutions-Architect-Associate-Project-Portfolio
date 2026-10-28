// "How it works" diagram: a phase-based animation showing the
// WebSocket connection opening once (step 1), the vote round-trip
// repeating (steps 2-5, forward then reverse over the same arrows),
// and the connection closing (unnumbered — it's not a step you'd
// click, it's what happens when you leave). Click any numbered step
// to jump straight to it; autoplay resumes after a few seconds idle.
(function () {
  var diagram = document.getElementById('flow-diagram');
  var stepsList = document.getElementById('flow-steps');
  var loopGroup = document.getElementById('ws-loop-group');
  var loopSvg = document.getElementById('ws-loop-svg');
  var loopPath = document.getElementById('ws-loop-path');
  var loopClipRect = document.getElementById('ws-loop-clip-rect');
  var loopLabel = document.getElementById('ws-loop-label');
  var lineL = document.getElementById('ws-line-l');
  var lineR = document.getElementById('ws-line-r');
  var crack = document.getElementById('ws-crack');
  var dotConnect = document.getElementById('ws-dot-connect');
  var dotVote = document.getElementById('ws-dot-vote');
  var dotVoteStubA = document.getElementById('ws-dot-vote-stub-a');
  var dotVoteStubB = document.getElementById('ws-dot-vote-stub-b');
  var dotTally = document.getElementById('ws-dot-tally');
  var apigwNode = diagram.querySelector('[data-node="apigateway"]');
  var dynamodbNode = diagram.querySelector('[data-node="dynamodb"]');
  if (!diagram || !stepsList || !loopGroup) return;

  var DOT_TRAVEL_MS = 1600; // matches the wsDotFwd/wsDotRev animation duration in styles.css
  var IDLE_RESUME_MS = 6000;
  var stepButtons = Array.prototype.slice.call(diagram.querySelectorAll('.ws-step'));
  var nodes = Array.prototype.slice.call(diagram.querySelectorAll('.flow-node'));
  var stepItems = Array.prototype.slice.call(stepsList.querySelectorAll('.flow-step'));
  var prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Phases, in order. Each names which step number is "current" (for
  // highlighting the written list + step buttons), which node should
  // light up once the dot arrives, which dot should travel and in
  // which direction, and whether the loop/crack visuals should
  // trigger on this phase. API Gateway is handled separately — it
  // stays lit for the entire time the connection is open, not just
  // while a dot happens to be passing through it.
  var phases = [
    { step: 1, node: 'apigateway', dot: dotConnect, dir: 'fwd', hold: 1900 },
    { openLoop: true, hold: 900 },
    { step: 2, node: 'lambda', dot: dotVote, dir: 'fwd', hold: 1900 },
    { step: 3, node: 'dynamodb', dot: dotTally, dir: 'fwd', hold: 1900 },
    { step: 4, node: 'lambda', dot: dotTally, dir: 'rev', hold: 1900 },
    { step: 5, node: null, dot: dotVote, dir: 'rev', hold: 1900 },
    { closeLoop: true, node: 'browser', dot: dotConnect, dir: 'rev', hold: 1900 },
    { reset: true, hold: 1000 }
  ];
  var i = 0;
  var timer = null;
  var resumeTimer = null;

  // Keep this in sync with the scale() value in .flow-diagram.is-stuck
  // (styles.css). getBoundingClientRect() returns already-scaled
  // visual pixels once that transform is applied — using those
  // directly as raw SVG attribute values would scale everything a
  // second time (since the SVG itself is also inside the scaled
  // container), so we divide it back out here before assigning them.
  var STUCK_SCALE = 0.78;

  function positionLoop() {
    var scale = diagram.classList.contains('is-stuck') ? STUCK_SCALE : 1;
    var diagramRect = diagram.getBoundingClientRect();
    loopSvg.setAttribute('width', diagramRect.width / scale);
    loopSvg.setAttribute('height', diagramRect.height / scale);
    if (!apigwNode || !dynamodbNode) return null;
    var apigwRect = apigwNode.getBoundingClientRect();
    var dynamoRect = dynamodbNode.getBoundingClientRect();
    var apigwCenterX = (apigwRect.left + apigwRect.width / 2 - diagramRect.left) / scale;
    var apigwTop = (apigwRect.top - diagramRect.top) / scale;
    var apigwBottom = (apigwRect.bottom - diagramRect.top) / scale;
    var topY = apigwTop - 26;
    var bottomY = apigwBottom + 26;
    var rightX = (dynamoRect.right - diagramRect.left) / scale + 26;
    var d = 'M' + apigwCenterX + ' ' + apigwTop +
      ' L' + apigwCenterX + ' ' + topY +
      ' L' + rightX + ' ' + topY +
      ' L' + rightX + ' ' + bottomY +
      ' L' + apigwCenterX + ' ' + bottomY +
      ' L' + apigwCenterX + ' ' + apigwBottom;
    loopPath.setAttribute('d', d);
    loopLabel.style.left = ((apigwCenterX + rightX) / 2) + 'px';
    loopLabel.style.top = topY + 'px';
    return loopPath;
  }

  // Sets the active (lit) node among lambda/dynamodb/browser —
  // deliberately leaves API Gateway alone, since it's managed
  // separately by openLoop()/closeLoop() instead.
  function setActiveNode(name) {
    nodes.forEach(function (el) {
      if (el === apigwNode) return;
      if (name === null) {
        el.classList.remove('is-active');
      } else {
        el.classList.toggle('is-active', el.getAttribute('data-node') === name);
      }
    });
  }

  function linesForDot(dot) {
    var arrow = dot.closest('.ws-arrow');
    if (!arrow) return [];
    return Array.prototype.slice.call(arrow.querySelectorAll('.ws-line, .ws-line-l, .ws-line-r'));
  }

  function highlightArrow(dot, dir) {
    linesForDot(dot).forEach(function (line) {
      line.classList.remove('highlight-fwd', 'highlight-rev');
      line.classList.add(dir === 'rev' ? 'highlight-rev' : 'highlight-fwd');
    });
  }

  function unhighlightArrow(dot) {
    linesForDot(dot).forEach(function (line) {
      line.classList.remove('highlight-fwd', 'highlight-rev');
    });
  }

  // Plays the dot's travel animation and calls onArrive once it
  // actually finishes — using the real animationend event rather
  // than a guessed setTimeout keeps node highlighting genuinely in
  // sync with where the dot visually is, instead of drifting early
  // or late.
  function runDot(dot, dir, onArrive) {
    if (!dot) {
      if (onArrive) onArrive();
      return;
    }
    dot.classList.remove('dot-fwd', 'dot-rev');
    void dot.offsetWidth;
    var handled = false;
    var handler = function () {
      if (handled) return;
      handled = true;
      dot.removeEventListener('animationend', handler);
      if (onArrive) onArrive();
    };
    dot.addEventListener('animationend', handler);
    dot.classList.add(dir === 'rev' ? 'dot-rev' : 'dot-fwd');
    if (prefersReducedMotion) {
      // No animation will actually run, so animationend won't fire —
      // call onArrive directly instead.
      setTimeout(handler, 50);
    }
  }

  // Reveals the path by growing a clip-mask outward from API
  // Gateway's position, rather than animating the path's own
  // stroke-dasharray/dashoffset — that technique requires a single
  // giant dash spanning the "drawn so far" length, which made the
  // line render solid during the reveal instead of staying dashed.
  // The mask doesn't need to precisely match the path's bounding
  // box either (unlike the earlier rect-edge approach) — it just
  // needs to be generous enough to fully cover the path by the end,
  // so there's no exact-shape math to get wrong.
  function animateLoopReveal(onDone) {
    var path = positionLoop();
    if (!path) {
      if (onDone) onDone();
      return;
    }
    var scale = diagram.classList.contains('is-stuck') ? STUCK_SCALE : 1;
    var diagramRect = diagram.getBoundingClientRect();
    var fullW = diagramRect.width / scale;
    var fullH = diagramRect.height / scale;
    var apigwRect = apigwNode.getBoundingClientRect();
    var origin = (apigwRect.left + apigwRect.width / 2 - diagramRect.left) / scale;
    loopClipRect.setAttribute('y', -fullH);
    loopClipRect.setAttribute('height', fullH * 3);
    var duration = prefersReducedMotion ? 0 : 900;
    var start = null;
    function frame(ts) {
      if (start === null) start = ts;
      var t = duration ? Math.min((ts - start) / duration, 1) : 1;
      var eased = 1 - Math.pow(1 - t, 3);
      var half = fullW * eased;
      loopClipRect.setAttribute('x', origin - half);
      loopClipRect.setAttribute('width', half * 2);
      if (t < 1) {
        window.requestAnimationFrame(frame);
      } else {
        loopClipRect.setAttribute('x', -fullW);
        loopClipRect.setAttribute('width', fullW * 3);
        if (onDone) onDone();
      }
    }
    loopClipRect.setAttribute('x', origin);
    loopClipRect.setAttribute('width', 0);
    window.requestAnimationFrame(frame);
  }

  function showClosedState() {
    loopPath.className.baseVal = 'closed';
    loopLabel.textContent = 'WebSocket Closed';
    loopLabel.classList.add('on', 'closed');
    animateLoopReveal();
  }

  function openLoop() {
    crack.classList.remove('show');
    loopPath.className.baseVal = 'active';
    loopLabel.textContent = 'WebSocket Stays Open';
    loopLabel.classList.remove('closed');
    loopLabel.classList.add('on');
    if (apigwNode) apigwNode.classList.add('is-active');
    animateLoopReveal();
  }

  function closeLoop() {
    loopPath.className.baseVal = 'closed';
    loopLabel.textContent = 'WebSocket Closed';
    loopLabel.classList.add('closed');
    if (apigwNode) apigwNode.classList.remove('is-active');
    crack.classList.add('show');
    setTimeout(function () {
      lineL.classList.add('cracked');
      lineR.classList.add('cracked');
    }, 150);
  }

  function resetConnection() {
    lineL.classList.remove('cracked');
    lineR.classList.remove('cracked');
    setActiveNode('browser');
  }

  function clearStepHighlights() {
    stepButtons.forEach(function (el) { el.classList.remove('is-active'); });
    stepItems.forEach(function (el) { el.classList.remove('is-active'); });
  }

  function highlightStep(n) {
    clearStepHighlights();
    stepButtons.forEach(function (el) {
      if (Number(el.getAttribute('data-step')) === n) el.classList.add('is-active');
    });
    stepItems.forEach(function (el) {
      if (Number(el.getAttribute('data-step')) === n) el.classList.add('is-active');
    });
  }

  function animateStubDot(dot, dir, onDone) {
    if (!dot) {
      if (onDone) onDone();
      return;
    }
    var arrow = dot.closest('.ws-arrow-stub');
    var line = arrow ? arrow.querySelector('.ws-line') : null;
    if (line) {
      line.classList.remove('highlight-fwd', 'highlight-rev');
      line.classList.add(dir === 'rev' ? 'highlight-rev' : 'highlight-fwd');
    }
    runDot(dot, dir, function () {
      if (line) line.classList.remove('highlight-fwd', 'highlight-rev');
      if (onDone) onDone();
    });
  }

  // Runs one dot at a time, never both together. Forward (toward
  // DynamoDB) starts at the API Gateway-side stub and ends at the
  // lambda-side stub, matching the actual direction of travel;
  // reverse runs the same two legs in the opposite order.
  function runStubDots(dir) {
    if (dir === 'rev') {
      animateStubDot(dotVoteStubB, dir, function () {
        animateStubDot(dotVoteStubA, dir, function () {});
      });
    } else {
      animateStubDot(dotVoteStubA, dir, function () {
        animateStubDot(dotVoteStubB, dir, function () {});
      });
    }
  }

  function runPhase(index) {
    var p = phases[index];
    if (p.openLoop) openLoop();
    if (p.reset) resetConnection();
    if (p.step) {
      highlightStep(p.step);
    } else if (!p.reset) {
      clearStepHighlights();
    }
    if (p.dot) {
      highlightArrow(p.dot, p.dir);
      if (p.dot === dotVote) runStubDots(p.dir);
      if (p.dot === dotConnect && p.dir === 'fwd' && crack.classList.contains('show')) {
        setTimeout(function () {
          crack.classList.remove('show');
        }, prefersReducedMotion ? 0 : DOT_TRAVEL_MS / 2);
      }
      runDot(p.dot, p.dir, function () {
        unhighlightArrow(p.dot);
        if (p.closeLoop) closeLoop();
        if (p.node !== undefined && !p.openLoop && !p.closeLoop) {
          setActiveNode(p.node);
        }
      });
    } else if (p.closeLoop) {
      closeLoop();
    } else if (p.node !== undefined && !p.openLoop && !p.closeLoop) {
      setActiveNode(p.node);
    }
  }

  function stopAutoplay() {
    if (timer) { clearTimeout(timer); timer = null; }
  }

  function loopPhases() {
    stopAutoplay();
    function tick() {
      runPhase(i);
      var hold = prefersReducedMotion ? 1200 : phases[i].hold;
      i = (i + 1) % phases.length;
      timer = setTimeout(tick, hold);
    }
    tick();
  }

  function findPhaseForStep(step) {
    for (var j = 0; j < phases.length; j++) {
      if (phases[j].step === step) return j;
    }
    return 0;
  }

  function goToStepManually(step) {
    stopAutoplay();
    if (resumeTimer) clearTimeout(resumeTimer);
    // A manual jump can't easily fast-forward the loop-open/close
    // visuals from an arbitrary state, so make sure the connection
    // looks "open" for any of steps 2-5, since those only make sense
    // while it is.
    if (step >= 2 && step <= 5 && !loopLabel.classList.contains('on')) {
      openLoop();
    }
    runPhase(findPhaseForStep(step));
    resumeTimer = setTimeout(function () {
      i = (findPhaseForStep(step) + 1) % phases.length;
      loopPhases();
    }, IDLE_RESUME_MS);
  }

  stepButtons.forEach(function (el) {
    el.addEventListener('click', function () {
      goToStepManually(Number(el.getAttribute('data-step')));
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

  var resizeRaf = null;
  window.addEventListener('resize', function () {
    if (resizeRaf) return;
    resizeRaf = window.requestAnimationFrame(function () {
      resizeRaf = null;
      if (loopLabel.classList.contains('on')) {
        positionLoop();
        var diagramRect = diagram.getBoundingClientRect();
        var scale = diagram.classList.contains('is-stuck') ? STUCK_SCALE : 1;
        var fullW = diagramRect.width / scale;
        var fullH = diagramRect.height / scale;
        loopClipRect.setAttribute('x', -fullW);
        loopClipRect.setAttribute('width', fullW * 3);
        loopClipRect.setAttribute('y', -fullH);
        loopClipRect.setAttribute('height', fullH * 3);
      }
    });
  }, { passive: true });

  // Show the "closed" state right away, before the first connect
  // animation ever plays, so the diagram doesn't start from a blank
  // slate.
  showClosedState();

  if ('IntersectionObserver' in window) {
    var started = false;
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting && !started) {
          started = true;
          loopPhases();
          io.disconnect();
        }
      });
    }, { threshold: 0.3 });
    io.observe(diagram);
  } else {
    loopPhases();
  }

  // Shrink the diagram slightly once its own sticky positioning has
  // actually pinned it to the top of the viewport. A 1px sentinel
  // sits immediately before the diagram in the HTML — once it
  // scrolls out of view above the viewport, the diagram right after
  // it must now be stuck.
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

// Scroll-triggered reveal, matching the rest of the site.
var revealEls = document.querySelectorAll('[data-reveal]');
if ('IntersectionObserver' in window) {
  var revealIo = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-visible');
        revealIo.unobserve(entry.target);
      }
    });
  // See website/index.html's identical reveal-observer comment: 0.15 is
  // a fraction of the observed element's own height, which can become
  // mathematically unreachable for a tall element in a short (e.g.
  // landscape mobile) viewport. threshold: 0.01 is viewport-height-safe.
  }, { threshold: 0.01, rootMargin: '0px 0px -60px 0px' });
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

// Shrink the sticky header once the page has scrolled past the top.
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

// Back-to-top button: fades in once scrolled down a bit, smooth-scrolls
// to the top on click.
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
    { tier: "Low volume", amount: "~$0", period: "/mo", desc: "Casual portfolio traffic — a handful of visitors keeping a tab open here and there. Comfortably inside free-tier-level cost for Lambda and DynamoDB, with negligible WebSocket charges." },
    { tier: "Light volume", amount: "~$0", period: "/mo", desc: "A small cluster of visitors browsing at once — still negligible connection-minute cost." },
    { tier: "Moderate volume", amount: "~$1–3", period: "/mo", desc: "A steady trickle of visitors, or a short burst — a few hundred connection-minutes and a few thousand messages a month." },
    { tier: "Elevated volume", amount: "~$5–10", period: "/mo", desc: "A busier burst of traffic — connection-minutes and broadcast messages both start adding up." },
    { tier: "High volume", amount: "~$10–25", period: "/mo", desc: "A viral moment with thousands of concurrent connections — connection-minutes and broadcast costs both climb together." },
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

// Architecture diagram lightbox: click the thumbnail (or press Enter/
// Space on it) to expand the full diagram full-screen; Escape, the
// backdrop, or the close button dismiss it. Same markup/behavior on
// every project page.
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
