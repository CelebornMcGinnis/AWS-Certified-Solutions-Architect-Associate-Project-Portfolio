document.getElementById('year').textContent = new Date().getFullYear();

// -----------------------------------------------------------------------
// Minimal Cognito Identity Provider client -- talks directly to Cognito's
// public JSON HTTP API (no AWS SDK, no Amplify). This works unsigned
// because the app client has no secret and every action here is one
// Cognito explicitly allows unauthenticated callers to invoke (SignUp,
// InitiateAuth, ForgotPassword, etc.) -- the same actions Amplify's
// Auth.signIn() ultimately calls under the hood.
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
// Session storage. Only the id token is ever sent to the gallery API (its
// authorizer is a Cognito User Pool JWT authorizer keyed to this app
// client's audience, which only id tokens carry) -- the refresh token is
// kept solely to renew it silently.
// -----------------------------------------------------------------------
var Session = (function () {
  var STORAGE_KEY = 'galleryAuthSession';
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
    // Returns a valid id token, transparently refreshing first if the
    // stored one is expired (or about to be). Resolves null if there's
    // no session, or if the refresh token itself has expired -- callers
    // treat that the same as "not signed in".
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
// post-sign-up confirmation-code step. Once a session exists, this whole
// panel is replaced by the "signed in as" row + upload form.
// -----------------------------------------------------------------------
(function () {
  var cfg = window.APP_CONFIG || {};
  var authSection = document.getElementById('auth-section');
  var sessionRow = document.getElementById('session-row');
  var sessionEmail = document.getElementById('session-email');
  var logoutButton = document.getElementById('logout-button');
  var uploadSection = document.getElementById('upload-section');
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
    uploadSection.hidden = !signedIn;
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
// Upload form + live status timeline + "my uploads" history.
// -----------------------------------------------------------------------
(function () {
  var cfg = window.APP_CONFIG || {};
  var form = document.getElementById('upload-form');
  if (!form) return;

  var fileInput = document.getElementById('upload-file');
  var agreeInput = document.getElementById('upload-agree');
  var submitButton = document.getElementById('upload-submit');
  var statusEl = document.getElementById('upload-status');
  var resultWrap = document.getElementById('upload-result');
  var resultBadge = document.getElementById('upload-result-badge');
  var rejectionNote = document.getElementById('upload-rejection-note');
  var myUploadsBody = document.getElementById('my-uploads-body');
  var myUploadsEmptyNote = document.getElementById('my-uploads-empty-note');

  var MAX_BYTES = 5 * 1024 * 1024;
  var ALLOWED_TYPES = { 'image/jpeg': true, 'image/png': true, 'image/webp': true };

  function setStatus(message, kind) {
    statusEl.textContent = message;
    statusEl.hidden = !message;
    statusEl.className = 'form-status' + (message ? ' is-visible' : '') + (kind ? ' ' + kind : '');
  }

  function fetchWithTimeout(url, options) {
    var controller = new AbortController();
    var timeoutId = window.setTimeout(function () {
      controller.abort();
    }, cfg.requestTimeoutMs || 15000);
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

  function statusBadge(status) {
    if (status === 'APPROVED') return '<span class="status-badge status-badge-ok">✓ approved</span>';
    if (status === 'REJECTED') return '<span class="status-badge status-badge-error">rejected</span>';
    return '<span class="status-badge status-badge-pending">pending…</span>';
  }

  function loadMyUploads() {
    authedFetch('/uploads/mine')
      .then(function (res) {
        if (!res.ok) throw new Error('Request failed: ' + res.status);
        return res.json();
      })
      .then(function (data) {
        var uploads = data.uploads || [];
        myUploadsBody.innerHTML = '';
        uploads.forEach(function (item) {
          var tr = document.createElement('tr');
          var nameCell = item.filename || '—';
          var downloadCell = item.imageUrl
            ? '<a href="' + item.imageUrl + '" download target="_blank" rel="noopener noreferrer">Download</a>'
            : '<span class="muted">—</span>';
          tr.innerHTML =
            '<td data-label="File">' + nameCell + '</td>' +
            '<td data-label="Status">' + statusBadge(item.status) + '</td>' +
            '<td data-label="Download">' + downloadCell + '</td>';
          myUploadsBody.appendChild(tr);
        });
        myUploadsEmptyNote.hidden = uploads.length > 0;
      })
      .catch(function () {
        // Silent -- the upload form itself still works even if this
        // background history fetch fails.
      });
  }

  Session.onChange(function (session) {
    if (session) loadMyUploads();
  });
  if (Session.current()) loadMyUploads();

  var pollsLeft = 0;
  var pollTimer = null;

  function pollUpload(uploadId) {
    authedFetch('/uploads/' + uploadId)
      .then(function (res) {
        if (!res.ok) throw new Error('Request failed: ' + res.status);
        return res.json();
      })
      .then(function (data) {
        if (data.status === 'PENDING') {
          pollsLeft -= 1;
          if (pollsLeft <= 0) {
            setStatus('Still being reviewed -- check "My uploads" below in a moment.', 'info');
            return;
          }
          pollTimer = window.setTimeout(function () {
            pollUpload(uploadId);
          }, cfg.pollIntervalMs || 2000);
          return;
        }

        setStatus('', null);
        resultWrap.hidden = false;
        if (data.status === 'APPROVED') {
          resultBadge.innerHTML = statusBadge('APPROVED');
          rejectionNote.hidden = true;
        } else {
          resultBadge.innerHTML = statusBadge('REJECTED');
          rejectionNote.hidden = false;
        }
        loadMyUploads();
        loadGallery();
      })
      .catch(function () {
        setStatus('Lost track of that upload -- check "My uploads" below.', 'error');
      });
  }

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    if (!Session.current()) {
      setStatus('Please sign in first.', 'error');
      return;
    }

    var file = fileInput.files[0];
    if (!file) {
      setStatus('Choose an image first.', 'error');
      return;
    }
    if (!ALLOWED_TYPES[file.type]) {
      setStatus('Only JPEG, PNG, and WebP images are allowed.', 'error');
      return;
    }
    if (file.size > MAX_BYTES) {
      setStatus('That file is larger than 5MB.', 'error');
      return;
    }
    if (!agreeInput.checked) {
      setStatus('Please confirm the community guidelines above before uploading.', 'error');
      return;
    }

    submitButton.disabled = true;
    resultWrap.hidden = true;
    if (pollTimer) window.clearTimeout(pollTimer);
    setStatus('Requesting an upload slot…', 'info');

    authedFetch('/uploads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contentType: file.type, filename: file.name }),
    })
      .then(function (res) {
        if (!res.ok) throw new Error('Request failed: ' + res.status);
        return res.json();
      })
      .then(function (data) {
        setStatus('Uploading…', 'info');
        var formData = new FormData();
        Object.keys(data.uploadFields).forEach(function (key) {
          formData.append(key, data.uploadFields[key]);
        });
        formData.append('file', file);

        return fetchWithTimeout(data.uploadUrl, { method: 'POST', body: formData }).then(function (s3Res) {
          if (!s3Res.ok) throw new Error('S3 upload failed: ' + s3Res.status);
          setStatus('Uploaded -- running it through moderation…', 'info');
          pollsLeft = cfg.maxPolls || 20;
          pollUpload(data.uploadId);
        });
      })
      .catch(function (err) {
        if (err.message === 'NOT_SIGNED_IN') {
          setStatus('Please sign in first.', 'error');
        } else {
          setStatus('Something went wrong with that upload. Please try again.', 'error');
        }
      })
      .finally(function () {
        submitButton.disabled = false;
        form.reset();
      });
  });

  // -----------------------------------------------------------------------
  // Public gallery -- no auth required.
  // -----------------------------------------------------------------------
  var galleryGrid = document.getElementById('gallery-grid');
  var galleryEmptyNote = document.getElementById('gallery-empty-note');
  var galleryRefreshButton = document.getElementById('gallery-refresh-button');

  function loadGallery() {
    if (!galleryGrid) return;
    fetchWithTimeout(cfg.apiBase + '/gallery')
      .then(function (res) {
        if (!res.ok) throw new Error('Request failed: ' + res.status);
        return res.json();
      })
      .then(function (data) {
        var images = data.images || [];
        galleryGrid.innerHTML = '';
        images.forEach(function (item) {
          var figure = document.createElement('div');
          figure.className = 'gallery-item';
          figure.innerHTML =
            '<img src="' + item.imageUrl + '" alt="' + (item.filename ? item.filename.replace(/"/g, '') : 'Approved gallery upload') + '" loading="lazy" />' +
            '<a class="gallery-download" href="' + item.imageUrl + '" download target="_blank" rel="noopener noreferrer" aria-label="Download image">' +
            '<svg viewBox="0 0 24 24" fill="none" width="18" height="18" aria-hidden="true"><path d="M12 4v11M7 10l5 5 5-5M5 20h14" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
            '</a>';
          galleryGrid.appendChild(figure);
        });
        galleryEmptyNote.hidden = images.length > 0;
      })
      .catch(function () {
        // Silent -- an empty/stale gallery grid isn't worth an error banner.
      });
  }

  window.__loadGallery = loadGallery;
  loadGallery();
  if (galleryRefreshButton) {
    galleryRefreshButton.addEventListener('click', loadGallery);
  }
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
  var TOTAL_STEPS = 6;
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
