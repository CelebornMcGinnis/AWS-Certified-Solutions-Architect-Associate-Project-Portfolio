document.getElementById('year').textContent = new Date().getFullYear();

// -----------------------------------------------------------------------
// Device id: same anonymous, no-account pattern as the habit tracker --
// a random id kept in localStorage, sent as plain request data, trusted
// as-is. There's a device notice banner in the page explaining this.
// -----------------------------------------------------------------------
var DeviceId = (function () {
  var STORAGE_KEY = 'orderProcessingDeviceId';
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
  var form = document.getElementById('order-form');
  if (!form) return;

  var deviceIdNote = document.getElementById('device-id-note');
  var productGrid = document.getElementById('product-grid');
  var resetInventoryButton = document.getElementById('reset-inventory-button');
  var resetInventoryStatus = document.getElementById('reset-inventory-status');
  var quantityInput = document.getElementById('order-quantity');
  var simulateFailureInput = document.getElementById('simulate-failure');
  var submitButton = document.getElementById('order-submit');
  var statusEl = document.getElementById('order-status');
  var timelineWrap = document.getElementById('order-timeline-wrap');
  var timelineSteps = Array.prototype.slice.call(document.querySelectorAll('#order-timeline .job-timeline-step'));
  var failureNote = document.getElementById('order-failure-note');
  var orderIdNote = document.getElementById('order-id-note');
  var logBody = document.getElementById('my-orders-body');
  var logEmptyNote = document.getElementById('my-orders-empty-note');

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

  function setStatus(message, kind) {
    statusEl.textContent = message;
    statusEl.className = 'form-status is-visible' + (kind ? ' ' + kind : '');
  }

  function clearStatusSoon() {
    window.setTimeout(function () {
      statusEl.classList.remove('is-visible');
    }, 4000);
  }

  // --- Product catalog ---
  // A random in-stock product picks up the default radio selection
  // instead of always the first one in the list, so the demo doesn't
  // land on the same product every time it's opened or re-rendered.
  function pickDefaultProductId(products) {
    var inStock = products.filter(function (product) {
      return product.stock > 0;
    });
    if (!inStock.length) return null;
    return inStock[Math.floor(Math.random() * inStock.length)].productId;
  }

  function renderProducts(products) {
    // Re-renders happen after placing an order or resetting inventory,
    // not just on first load -- preserve whatever the visitor already
    // had selected (if it's still in stock) instead of overwriting
    // their choice with a fresh default every time.
    var previouslyChecked = form.querySelector('input[name="productId"]:checked');
    var previousId = previouslyChecked ? previouslyChecked.value : null;
    var previousStillInStock = previousId && products.some(function (product) {
      return product.productId === previousId && product.stock > 0;
    });
    var selectedId = previousStillInStock ? previousId : pickDefaultProductId(products);

    productGrid.innerHTML = '';
    products.forEach(function (product) {
      var label = document.createElement('label');
      label.className = 'product-card';
      var outOfStock = product.stock <= 0;
      label.innerHTML =
        '<input type="radio" name="productId" value="' + product.productId + '"' + (product.productId === selectedId ? ' checked' : '') + (outOfStock ? ' disabled' : '') + ' />' +
        '<span class="product-card-body">' +
        '<h4>' + product.name + '</h4>' +
        '<p>$' + product.unitPrice.toFixed(2) + ' each</p>' +
        '<p' + (outOfStock ? ' class="out-of-stock"' : '') + '>' + (outOfStock ? 'Out of stock' : product.stock + ' in stock') + '</p>' +
        '</span>';
      productGrid.appendChild(label);
    });
  }

  function loadProducts() {
    fetchWithTimeout(cfg.apiBase + '/products')
      .then(function (res) {
        if (!res.ok) throw new Error('Request failed: ' + res.status);
        return res.json();
      })
      .then(function (data) {
        renderProducts(data.products || []);
      })
      .catch(function () {
        productGrid.innerHTML = '<p class="muted small-note">Could not load the product catalog right now. Please try again shortly.</p>';
      });
  }
  loadProducts();

  if (resetInventoryButton) {
    resetInventoryButton.addEventListener('click', function () {
      resetInventoryButton.disabled = true;
      resetInventoryStatus.textContent = 'Resetting…';
      fetchWithTimeout(cfg.apiBase + '/inventory/reset', { method: 'POST' })
        .then(function (res) {
          if (!res.ok) throw new Error('Request failed: ' + res.status);
          return res.json();
        })
        .then(function () {
          resetInventoryStatus.textContent = 'Inventory reset — stock levels are back to normal.';
          loadProducts();
        })
        .catch(function () {
          resetInventoryStatus.textContent = 'Could not reset inventory. Please try again shortly.';
        })
        .finally(function () {
          resetInventoryButton.disabled = false;
          window.setTimeout(function () {
            resetInventoryStatus.textContent = '';
          }, 4000);
        });
    });
  }

  // --- My orders log ---
  var rowData = Object.create(null);
  var rowElements = Object.create(null);
  var mobileQuery = window.matchMedia('(max-width: 760px)');
  function maxVisibleRows() {
    return mobileQuery.matches ? 3 : 10;
  }

  function statusBadge(status) {
    if (status === 'SHIPPED') return '<span class="status-badge status-badge-ok">✓ shipped</span>';
    if (status === 'FAILED') return '<span class="status-badge status-badge-error">failed</span>';
    return '<span class="status-badge status-badge-pending">' + (status || 'pending').toLowerCase().replace('_', ' ') + '…</span>';
  }

  function fillRow(tr, data) {
    tr.innerHTML =
      '<td data-label="Product">' + (data.productName || '—') + '</td>' +
      '<td data-label="Qty">' + (data.quantity != null ? data.quantity : '—') + '</td>' +
      '<td data-label="Total">' + (data.totalPrice != null ? '$' + parseFloat(data.totalPrice).toFixed(2) : '—') + '</td>' +
      '<td data-label="Status">' + statusBadge(data.status) + '</td>';
  }

  function renderLog() {
    var keys = Object.keys(rowData).sort(function (a, b) {
      return new Date(rowData[b].createdAt).getTime() - new Date(rowData[a].createdAt).getTime();
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
  mobileQuery.addEventListener('change', renderLog);

  function upsertOrder(order) {
    rowData[order.orderId] = Object.assign({}, rowData[order.orderId], order);
    renderLog();
  }

  function loadMyOrders() {
    fetchWithTimeout(cfg.apiBase + '/orders/mine?ownerId=' + encodeURIComponent(DeviceId))
      .then(function (res) {
        if (!res.ok) throw new Error('Request failed: ' + res.status);
        return res.json();
      })
      .then(function (data) {
        (data.orders || []).forEach(upsertOrder);
      })
      .catch(function () {
        // Silent -- placing a new order still works even if this
        // background history fetch fails.
      });
  }
  loadMyOrders();

  // --- Timeline ---
  var STAGE_ORDER = ['PENDING', 'INVENTORY_RESERVED', 'PAYMENT_CHARGED', 'SHIPPED'];
  var REPLAY_STEP_MS = 400;

  // The backend runs the whole Reserve -> Charge -> Ship/Fail chain in
  // well under a second, so the first poll (fired ~1s after submit)
  // almost always lands on the terminal status directly -- the visitor
  // never actually observes the intermediate stages, even though they
  // genuinely happened. lastAppliedIndex tracks the last stage this UI
  // has shown, so a jump straight to a terminal status can be replayed
  // through the real stages it skipped instead of snapping to it.
  var lastAppliedIndex = 0;

  function computeFailedAtIndex(order) {
    return (order.failureReason || '').toLowerCase().indexOf('payment') !== -1 ? 2 : 1;
  }

  function terminalTargetIndex(order) {
    if (order.status === 'FAILED') return computeFailedAtIndex(order);
    return STAGE_ORDER.length - 1; // SHIPPED
  }

  function applyTimelineStatus(order) {
    timelineSteps.forEach(function (el) {
      el.classList.remove('is-done', 'is-active', 'is-failed');
    });
    failureNote.hidden = true;

    if (order.status === 'FAILED') {
      var failedAtIndex = computeFailedAtIndex(order);
      timelineSteps.forEach(function (el, index) {
        var dot = el.querySelector('.job-timeline-dot');
        if (index < failedAtIndex) {
          el.classList.add('is-done');
          dot.textContent = '✓';
        } else if (index === failedAtIndex) {
          el.classList.add('is-failed');
          dot.textContent = '✕';
        } else {
          dot.textContent = String(index + 1);
        }
      });
      failureNote.hidden = false;
      failureNote.textContent = order.failureReason || 'This order failed.';
      return;
    }

    var currentIndex = STAGE_ORDER.indexOf(order.status);
    if (currentIndex === -1) currentIndex = 0;

    timelineSteps.forEach(function (el, index) {
      var dot = el.querySelector('.job-timeline-dot');
      if (index < currentIndex || (index === currentIndex && order.status === 'SHIPPED')) {
        el.classList.add('is-done');
        dot.textContent = '✓';
      } else {
        if (index === currentIndex) el.classList.add('is-active');
        dot.textContent = String(index + 1);
      }
    });
  }

  // Renders steps 0..activeIndex-1 as done and activeIndex as active,
  // with no failure state -- used only for the intermediate frames of
  // a replay, never as the final render.
  function renderProgressUpTo(activeIndex) {
    timelineSteps.forEach(function (el, index) {
      el.classList.remove('is-done', 'is-active', 'is-failed');
      var dot = el.querySelector('.job-timeline-dot');
      if (index < activeIndex) {
        el.classList.add('is-done');
        dot.textContent = '✓';
      } else {
        if (index === activeIndex) el.classList.add('is-active');
        dot.textContent = String(index + 1);
      }
    });
    failureNote.hidden = true;
  }

  // Steps through the real stages between fromIndex and toIndex one at
  // a time (an honest replay of what already happened on the backend,
  // not a fake animation), then calls done().
  function replayStages(fromIndex, toIndex, done) {
    var i = fromIndex;
    function step() {
      if (i >= toIndex) {
        done();
        return;
      }
      renderProgressUpTo(i + 1);
      i += 1;
      window.setTimeout(step, REPLAY_STEP_MS);
    }
    step();
  }

  var pollsLeft = 0;
  var pollTimer = null;

  function finishTerminal(data, targetIndex) {
    applyTimelineStatus(data);
    lastAppliedIndex = targetIndex;
    upsertOrder(data);
    setStatus(data.status === 'SHIPPED' ? 'Order shipped.' : 'Order failed.', data.status === 'SHIPPED' ? 'success' : 'error');
    clearStatusSoon();
    loadProducts(); // stock may have changed
  }

  function pollOrder(orderId) {
    fetchWithTimeout(cfg.apiBase + '/orders/' + orderId + '?ownerId=' + encodeURIComponent(DeviceId))
      .then(function (res) {
        if (!res.ok) throw new Error('Request failed: ' + res.status);
        return res.json();
      })
      .then(function (data) {
        if (data.status === 'SHIPPED' || data.status === 'FAILED') {
          var targetIndex = terminalTargetIndex(data);
          var replayFrom = lastAppliedIndex + 1;
          if (replayFrom < targetIndex) {
            replayStages(replayFrom, targetIndex, function () {
              finishTerminal(data, targetIndex);
            });
          } else {
            finishTerminal(data, targetIndex);
          }
          return;
        }

        applyTimelineStatus(data);
        var stageIndex = STAGE_ORDER.indexOf(data.status);
        lastAppliedIndex = Math.max(lastAppliedIndex, stageIndex === -1 ? 0 : stageIndex);
        upsertOrder(data);

        pollsLeft -= 1;
        if (pollsLeft <= 0) {
          setStatus('Still processing — check back in a moment to see it finish.', 'info');
          clearStatusSoon();
          return;
        }
        pollTimer = window.setTimeout(function () {
          pollOrder(orderId);
        }, cfg.pollIntervalMs || 1500);
      })
      .catch(function () {
        setStatus('Lost track of that order — it may still be processing.', 'error');
        clearStatusSoon();
      });
  }

  function watch(orderId) {
    pollsLeft = cfg.maxPolls || 20;
    if (pollTimer) window.clearTimeout(pollTimer);
    pollTimer = window.setTimeout(function () {
      pollOrder(orderId);
    }, cfg.firstPollDelayMs || 1000);
  }

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    var productId = form.querySelector('input[name="productId"]:checked');
    if (!productId) {
      setStatus('Please choose a product.', 'error');
      return;
    }
    var quantity = parseInt(quantityInput.value, 10) || 1;

    submitButton.disabled = true;
    setStatus('Placing your order…', 'info');
    timelineWrap.hidden = false;
    applyTimelineStatus({ status: 'PENDING' });
    lastAppliedIndex = 0;
    orderIdNote.textContent = '';

    fetchWithTimeout(cfg.apiBase + '/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ownerId: DeviceId,
        productId: productId.value,
        quantity: quantity,
        simulateFailure: simulateFailureInput.checked,
      }),
    })
      .then(function (res) {
        if (!res.ok) {
          return res.json().then(function (data) {
            throw new Error(data.error || 'Request failed: ' + res.status);
          });
        }
        return res.json();
      })
      .then(function (data) {
        setStatus('Order submitted — watching it process…', 'info');
        orderIdNote.textContent = 'Order id: ' + data.orderId;
        upsertOrder(Object.assign({ createdAt: new Date().toISOString() }, data));
        watch(data.orderId);
      })
      .catch(function (err) {
        setStatus(err.message || 'Something went wrong placing that order. Please try again.', 'error');
        clearStatusSoon();
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
    var toggleSidebar = function () {
      setSidebarOpen(!mobileSidebar.classList.contains('is-open'));
    };
    // touch-action: manipulation (see styles.css) is the primary fix
    // for a tap during active scroll momentum needing a second tap to
    // register -- it tells the browser this element doesn't pan, so a
    // tap can commit immediately instead of waiting to see if it's the
    // start of a scroll gesture. touchstart is a second layer on top of
    // that (some browsers still delay/drop the click that follows a
    // touch that also stopped momentum scrolling), with a short
    // time-based guard so the touchstart and the click that can still
    // follow it for the same physical tap don't toggle the menu open
    // and immediately back closed.
    var lastToggleAt = 0;
    var guardedToggle = function (event) {
      var now = Date.now();
      if (now - lastToggleAt < 500) return;
      lastToggleAt = now;
      if (event.cancelable) event.preventDefault();
      toggleSidebar();
    };
    sidebarToggle.addEventListener('touchstart', guardedToggle, { passive: false });
    sidebarToggle.addEventListener('click', guardedToggle);
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
    { tier: "Low volume", amount: "~$0", period: "/mo", desc: "A few hundred orders a month \u2014 comfortably inside Step Functions' free tier of 4,000 state transitions (each order uses 2-4 depending on which path it takes), plus Lambda and DynamoDB's free tiers." },
    { tier: "Light volume", amount: "~$0", period: "/mo", desc: "A few thousand orders a month \u2014 still inside the free tier." },
    { tier: "Moderate volume", amount: "~$1", period: "/mo", desc: "Tens of thousands of orders a month \u2014 Step Functions state transitions become the main cost, still a fraction of a cent per order either way." },
    { tier: "Elevated volume", amount: "~$2\u20135", period: "/mo", desc: "Around a hundred thousand orders a month \u2014 Step Functions and Lambda invocations both start to add up." },
    { tier: "High volume", amount: "~$5\u201310", period: "/mo", desc: "Hundreds of thousands of orders a month \u2014 Step Functions and Lambda invocations both keep climbing, though DynamoDB on-demand billing stays cheap either way." },
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
