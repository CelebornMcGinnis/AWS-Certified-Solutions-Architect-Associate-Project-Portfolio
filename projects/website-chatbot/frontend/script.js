document.getElementById('year').textContent = new Date().getFullYear();

// -----------------------------------------------------------------------
// Minimal Cognito Identity Provider client -- talks directly to Cognito's
// public JSON HTTP API (no AWS SDK, no Amplify), same technique used by
// the moderated image gallery project. Works unsigned because the app
// client has no secret and every action here is one Cognito explicitly
// allows unauthenticated callers to invoke.
// -----------------------------------------------------------------------
var Cognito = (function () {
  var cfg = (window.APP_CONFIG || {}).cognito || {};
  var region = (cfg.userPoolId || '').split('_')[0] || 'us-east-1';
  var endpoint = 'https://cognito-idp.' + region + '.amazonaws.com/';

  var FRIENDLY_ERRORS = {
    UsernameExistsException: 'An account with that email already exists.',
    NotAuthorizedException: 'Incorrect email or password.',
    UserNotFoundException: 'No account found for that email.',
    UserNotConfirmedException: 'This account has not been confirmed yet -- check your email for a code.',
    CodeMismatchException: 'That code did not match. Double-check it and try again.',
    ExpiredCodeException: 'That code has expired -- request a new one.',
    InvalidPasswordException: 'Password must be at least 8 characters and include an uppercase letter, a lowercase letter, and a digit.',
    InvalidParameterException: 'That request was not valid -- check the fields and try again.',
    LimitExceededException: 'Too many attempts -- please wait a bit and try again.',
    TooManyRequestsException: 'Too many attempts -- please wait a bit and try again.',
  };

  function call(action, body) {
    var controller = new AbortController();
    var timeoutId = window.setTimeout(function () {
      controller.abort();
    }, (window.APP_CONFIG || {}).requestTimeoutMs || 15000);

    return fetch(endpoint, {
      method: 'POST',
      cache: 'no-store',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/x-amz-json-1.1',
        'X-Amz-Target': 'AWSCognitoIdentityProviderService.' + action,
      },
      body: JSON.stringify(body),
    })
      .finally(function () {
        window.clearTimeout(timeoutId);
      })
      .then(function (res) {
        return res.json().then(function (data) {
          if (!res.ok) {
            var type = (data.__type || '').split('#').pop();
            var message = FRIENDLY_ERRORS[type] || data.message || 'Something went wrong. Please try again.';
            var err = new Error(message);
            err.type = type;
            throw err;
          }
          return data;
        });
      });
  }

  return {
    signUp: function (email, password) {
      return call('SignUp', {
        ClientId: cfg.clientId,
        Username: email,
        Password: password,
        UserAttributes: [{ Name: 'email', Value: email }],
      });
    },
    confirmSignUp: function (email, code) {
      return call('ConfirmSignUp', { ClientId: cfg.clientId, Username: email, ConfirmationCode: code });
    },
    resendConfirmationCode: function (email) {
      return call('ResendConfirmationCode', { ClientId: cfg.clientId, Username: email });
    },
    signIn: function (email, password) {
      return call('InitiateAuth', {
        ClientId: cfg.clientId,
        AuthFlow: 'USER_PASSWORD_AUTH',
        AuthParameters: { USERNAME: email, PASSWORD: password },
      });
    },
    refresh: function (refreshToken) {
      return call('InitiateAuth', {
        ClientId: cfg.clientId,
        AuthFlow: 'REFRESH_TOKEN_AUTH',
        AuthParameters: { REFRESH_TOKEN: refreshToken },
      });
    },
    forgotPassword: function (email) {
      return call('ForgotPassword', { ClientId: cfg.clientId, Username: email });
    },
    confirmForgotPassword: function (email, code, newPassword) {
      return call('ConfirmForgotPassword', {
        ClientId: cfg.clientId,
        Username: email,
        ConfirmationCode: code,
        Password: newPassword,
      });
    },
  };
})();

// -----------------------------------------------------------------------
// Session storage -- same pattern as the moderated image gallery. Only
// the id token is sent to this project's API (its authorizer is a
// Cognito User Pool JWT authorizer keyed to this app client's
// audience); the refresh token is kept solely to renew it silently.
// -----------------------------------------------------------------------
var Session = (function () {
  var STORAGE_KEY = 'chatbotAuthSession';
  var listeners = [];

  function read() {
    try {
      return JSON.parse(window.localStorage.getItem(STORAGE_KEY) || 'null');
    } catch (e) {
      return null;
    }
  }

  function write(session) {
    if (session) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    } else {
      window.localStorage.removeItem(STORAGE_KEY);
    }
    listeners.forEach(function (fn) {
      fn(session);
    });
  }

  return {
    onChange: function (fn) {
      listeners.push(fn);
    },
    current: read,
    save: function (email, authResult) {
      write({
        email: email,
        idToken: authResult.IdToken,
        accessToken: authResult.AccessToken,
        refreshToken: authResult.RefreshToken,
        expiresAt: Date.now() + (authResult.ExpiresIn || 3600) * 1000,
      });
    },
    clear: function () {
      write(null);
    },
    getValidIdToken: function () {
      var session = read();
      if (!session) return Promise.resolve(null);
      if (session.expiresAt - Date.now() > 30000) return Promise.resolve(session.idToken);

      return Cognito.refresh(session.refreshToken)
        .then(function (data) {
          var result = data.AuthenticationResult;
          session.idToken = result.IdToken;
          session.accessToken = result.AccessToken;
          session.expiresAt = Date.now() + (result.ExpiresIn || 3600) * 1000;
          write(session);
          return session.idToken;
        })
        .catch(function () {
          write(null);
          return null;
        });
    },
  };
})();

// -----------------------------------------------------------------------
// Auth panel: sign up / log in / forgot password tabs, plus the
// post-sign-up confirmation-code step. Identical structure to the
// moderated image gallery's auth panel -- once a session exists, this
// whole panel is replaced by the "signed in as" row + chat window.
// -----------------------------------------------------------------------
(function () {
  var authSection = document.getElementById('auth-section');
  var authOpenButton = document.getElementById('auth-open-button');
  var authModal = document.getElementById('auth-modal');
  var authModalClose = document.getElementById('auth-modal-close');
  var sessionRow = document.getElementById('session-row');
  var sessionEmail = document.getElementById('session-email');
  var logoutButton = document.getElementById('logout-button');
  var chatSection = document.getElementById('chat-section');
  if (!authSection) return;

  var tabs = Array.prototype.slice.call(document.querySelectorAll('.auth-tab'));
  var panels = {
    signup: document.getElementById('signup-form'),
    login: document.getElementById('login-form'),
    forgot: document.getElementById('forgot-panel'),
    confirm: document.getElementById('confirm-panel'),
  };

  // Sign up / log in / forgot password all live inside a <dialog> now,
  // opened on demand from a single "Log in" button instead of being
  // permanently rendered inline -- keeps the demo section to one
  // control until the visitor actually wants to authenticate.
  if (authOpenButton && authModal && authModal.showModal) {
    authOpenButton.addEventListener('click', function () {
      authModal.showModal();
    });
    authModalClose.addEventListener('click', function () {
      authModal.close();
    });
    // A click that lands on the <dialog> element itself (not one of its
    // children) is a click on the ::backdrop -- dialogs don't close on
    // backdrop click by default, so this adds that behavior back in.
    authModal.addEventListener('click', function (event) {
      if (event.target === authModal) authModal.close();
    });
    // The native "close" event fires for every close path -- the X
    // button, a backdrop click, Escape, and the programmatic close()
    // after a successful login -- so resetting the forms here (rather
    // than in each individual close handler) clears whatever was typed,
    // most importantly a password, whenever the modal is reopened later.
    authModal.addEventListener('close', function () {
      [signupForm, loginForm, forgotRequestForm, forgotResetForm, confirmForm].forEach(function (form) {
        if (form) form.reset();
      });
    });
  }

  function showPanel(name) {
    Object.keys(panels).forEach(function (key) {
      if (panels[key]) panels[key].hidden = key !== name;
    });
    tabs.forEach(function (tab) {
      tab.classList.toggle('is-active', tab.getAttribute('data-panel') === name);
    });
  }

  tabs.forEach(function (tab) {
    tab.addEventListener('click', function () {
      showPanel(tab.getAttribute('data-panel'));
    });
  });

  function setFormStatus(el, message, kind) {
    el.textContent = message;
    el.hidden = false;
    el.className = 'form-status is-visible' + (kind ? ' ' + kind : '');
  }

  function reflectSession(session) {
    var signedIn = !!session;
    authSection.hidden = signedIn;
    sessionRow.hidden = !signedIn;
    chatSection.hidden = !signedIn;
    if (signedIn) {
      sessionEmail.textContent = session.email;
      if (authModal && authModal.open) authModal.close();
    }
  }

  Session.onChange(reflectSession);
  reflectSession(Session.current());

  logoutButton.addEventListener('click', function () {
    Session.clear();
  });

  // --- Sign up ---
  var signupForm = document.getElementById('signup-form');
  var signupStatus = document.getElementById('signup-status');
  var pendingConfirmEmail = null;

  signupForm.addEventListener('submit', function (event) {
    event.preventDefault();
    var email = signupForm.email.value.trim();
    var password = signupForm.password.value;
    if (password !== signupForm.confirmPassword.value) {
      setFormStatus(signupStatus, 'Passwords do not match.', 'error');
      return;
    }
    setFormStatus(signupStatus, 'Creating your account…', 'info');

    Cognito.signUp(email, password)
      .then(function () {
        pendingConfirmEmail = email;
        document.getElementById('confirm-email-note').textContent = email;
        showPanel('confirm');
      })
      .catch(function (err) {
        setFormStatus(signupStatus, err.message, 'error');
      });
  });

  // --- Confirm sign-up code ---
  var confirmForm = document.getElementById('confirm-form');
  var confirmStatus = document.getElementById('confirm-status');
  var resendButton = document.getElementById('resend-code-button');

  confirmForm.addEventListener('submit', function (event) {
    event.preventDefault();
    if (!pendingConfirmEmail) return;
    setFormStatus(confirmStatus, 'Confirming…', 'info');

    Cognito.confirmSignUp(pendingConfirmEmail, confirmForm.code.value.trim())
      .then(function () {
        setFormStatus(confirmStatus, 'Account confirmed -- you can log in now.', 'success');
        confirmForm.reset();
        window.setTimeout(function () {
          showPanel('login');
        }, 1200);
      })
      .catch(function (err) {
        setFormStatus(confirmStatus, err.message, 'error');
      });
  });

  resendButton.addEventListener('click', function () {
    if (!pendingConfirmEmail) return;
    Cognito.resendConfirmationCode(pendingConfirmEmail)
      .then(function () {
        setFormStatus(confirmStatus, 'A new code is on its way.', 'info');
      })
      .catch(function (err) {
        setFormStatus(confirmStatus, err.message, 'error');
      });
  });

  // --- Log in ---
  var loginForm = document.getElementById('login-form');
  var loginStatus = document.getElementById('login-status');

  loginForm.addEventListener('submit', function (event) {
    event.preventDefault();
    var email = loginForm.email.value.trim();
    setFormStatus(loginStatus, 'Signing in…', 'info');

    Cognito.signIn(email, loginForm.password.value)
      .then(function (data) {
        Session.save(email, data.AuthenticationResult);
        loginForm.reset();
        loginStatus.hidden = true;
      })
      .catch(function (err) {
        if (err.type === 'UserNotConfirmedException') {
          pendingConfirmEmail = email;
          document.getElementById('confirm-email-note').textContent = email;
          showPanel('confirm');
          return;
        }
        setFormStatus(loginStatus, err.message, 'error');
      });
  });

  // --- Forgot password ---
  var forgotRequestForm = document.getElementById('forgot-request-form');
  var forgotResetForm = document.getElementById('forgot-reset-form');
  var forgotStatus = document.getElementById('forgot-status');
  var forgotResetEmail = null;

  forgotRequestForm.addEventListener('submit', function (event) {
    event.preventDefault();
    var email = forgotRequestForm.email.value.trim();
    setFormStatus(forgotStatus, 'Sending a reset code…', 'info');

    Cognito.forgotPassword(email)
      .then(function () {
        forgotResetEmail = email;
        forgotRequestForm.hidden = true;
        forgotResetForm.hidden = false;
        forgotStatus.hidden = true;
      })
      .catch(function (err) {
        setFormStatus(forgotStatus, err.message, 'error');
      });
  });

  forgotResetForm.addEventListener('submit', function (event) {
    event.preventDefault();
    setFormStatus(forgotStatus, 'Resetting your password…', 'info');

    Cognito.confirmForgotPassword(forgotResetEmail, forgotResetForm.code.value.trim(), forgotResetForm.newPassword.value)
      .then(function () {
        setFormStatus(forgotStatus, 'Password reset -- you can log in now.', 'success');
        forgotResetForm.reset();
        window.setTimeout(function () {
          forgotRequestForm.hidden = false;
          forgotResetForm.hidden = true;
          forgotRequestForm.reset();
          showPanel('login');
        }, 1200);
      })
      .catch(function (err) {
        setFormStatus(forgotStatus, err.message, 'error');
      });
  });

  document.querySelectorAll('[data-show-panel]').forEach(function (link) {
    link.addEventListener('click', function (event) {
      event.preventDefault();
      showPanel(link.getAttribute('data-show-panel'));
    });
  });
})();

// -----------------------------------------------------------------------
// Chat window.
// -----------------------------------------------------------------------
(function () {
  var cfg = window.APP_CONFIG || {};
  var form = document.getElementById('chat-form');
  if (!form) return;

  var input = document.getElementById('chat-input');
  var submitButton = document.getElementById('chat-submit');
  var statusEl = document.getElementById('chat-status');
  var messagesEl = document.getElementById('chat-messages');

  function fetchWithTimeout(url, options) {
    var controller = new AbortController();
    var timeoutId = window.setTimeout(function () {
      controller.abort();
    }, cfg.requestTimeoutMs || 20000);
    return fetch(url, Object.assign({ cache: 'no-store' }, options, { signal: controller.signal })).finally(function () {
      window.clearTimeout(timeoutId);
    });
  }

  function authedFetch(path, options) {
    return Session.getValidIdToken().then(function (idToken) {
      if (!idToken) throw new Error('NOT_SIGNED_IN');
      var headers = Object.assign({}, (options || {}).headers, { Authorization: 'Bearer ' + idToken });
      return fetchWithTimeout(cfg.apiBase + path, Object.assign({}, options, { headers: headers }));
    });
  }

  function setStatus(message, kind) {
    statusEl.textContent = message;
    statusEl.hidden = !message;
    statusEl.className = 'form-status' + (message ? ' is-visible' : '') + (kind ? ' ' + kind : '');
  }

  function sourceLabel(source) {
    if (source === 'faq') return 'Scripted FAQ';
    if (source === 'guardrail') return 'Blocked by guardrail';
    if (source === 'ai') return 'Nova Lite (AI)';
    return null;
  }

  function appendMessage(role, text, source) {
    var wrap = document.createElement('div');
    wrap.className = 'chat-message is-' + role;

    var bubble = document.createElement('div');
    bubble.className = 'chat-bubble';
    bubble.textContent = text;
    wrap.appendChild(bubble);

    var label = sourceLabel(source);
    if (label) {
      var tag = document.createElement('span');
      tag.className = 'chat-source-tag chat-source-' + source;
      tag.textContent = label;
      wrap.appendChild(tag);
    }

    messagesEl.appendChild(wrap);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function loadHistory() {
    authedFetch('/chat/history')
      .then(function (res) {
        if (!res.ok) throw new Error('Request failed: ' + res.status);
        return res.json();
      })
      .then(function (data) {
        messagesEl.innerHTML = '';
        (data.messages || []).forEach(function (message) {
          appendMessage(message.role, message.text, message.source);
        });
        if (!(data.messages || []).length) {
          appendMessage('assistant', "Hi! Try asking what this costs to run, what AWS services power it, where the source code lives, or what a specific project -- like the movie poll or the image gallery -- actually does.", null);
        }
      })
      .catch(function () {
        // Silent -- a fresh chat window still works even if history fails to load.
      });
  }

  Session.onChange(function (session) {
    if (session) loadHistory();
  });
  if (Session.current()) loadHistory();

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    var message = input.value.trim();
    if (!message) return;

    appendMessage('user', message, null);
    input.value = '';
    submitButton.disabled = true;
    setStatus('Thinking…', 'info');

    authedFetch('/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: message }),
    })
      .then(function (res) {
        if (!res.ok) throw new Error('Request failed: ' + res.status);
        return res.json();
      })
      .then(function (data) {
        setStatus('', null);
        appendMessage('assistant', data.reply, data.source);
      })
      .catch(function (err) {
        setStatus(err.message === 'NOT_SIGNED_IN' ? 'Please sign in first.' : 'Something went wrong. Please try again.', 'error');
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
    { tier: "Low volume", amount: "~$0", period: "/mo", desc: "A handful of AI-fallback questions a month, most conversations answered by the free FAQ layer \u2014 comfortably inside Cognito's 50,000 MAU free tier plus Lambda/DynamoDB/API Gateway free tiers." },
    { tier: "Light volume", amount: "~$0", period: "/mo", desc: "Dozens of AI-fallback questions a month \u2014 still effectively free." },
    { tier: "Moderate volume", amount: "~$0.50\u20132", period: "/mo", desc: "Hundreds of AI-fallback questions a month \u2014 cost scales with how often visitors ask something the FAQ layer doesn't cover, not with total message volume." },
    { tier: "Elevated volume", amount: "~$1\u20134", period: "/mo", desc: "A thousand or so AI-fallback questions a month \u2014 still dominated by Nova Lite's low per-token cost." },
    { tier: "High volume", amount: "~$3\u20138", period: "/mo", desc: "Thousands of AI-fallback questions a month \u2014 still dominated by Nova Lite's low per-token cost; the FAQ layer keeps this from scaling with total traffic." },
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
