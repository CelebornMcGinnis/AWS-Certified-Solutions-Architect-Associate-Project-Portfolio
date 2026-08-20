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
  var sessionRow = document.getElementById('session-row');
  var sessionEmail = document.getElementById('session-email');
  var logoutButton = document.getElementById('logout-button');
  var chatSection = document.getElementById('chat-section');
  if (!authSection) return;

  var tabs = Array.prototype.slice.call(document.querySelectorAll('.auth-tab'));
  var panels = {
    signup: document.getElementById('signup-panel'),
    login: document.getElementById('login-panel'),
    forgot: document.getElementById('forgot-panel'),
    confirm: document.getElementById('confirm-panel'),
  };

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
    if (signedIn) sessionEmail.textContent = session.email;
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
          appendMessage('assistant', "Hi! Ask me anything about this site -- pricing, source code, the tech stack, whatever's on your mind.", null);
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
