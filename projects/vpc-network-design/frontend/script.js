document.getElementById('year').textContent = new Date().getFullYear();

// -----------------------------------------------------------------------
// Reference-only demo: zero network calls, zero timers. Every subnet and
// resource in the diagram is a static lookup into the two tables below --
// clicking one just swaps the detail panel's content to show its
// pre-written route table or security group rules. This is the exact
// design cdk/lib/vpc-network-design-stack.ts would provision if it were
// ever instantiated (it isn't -- see the page's Design decisions section).
// -----------------------------------------------------------------------
(function () {
  var ROUTE_TABLES = {
    'subnet-public-a': {
      title: 'Public subnet · us-east-1a',
      subtitle: '10.0.0.0/24 — route table: public-rt',
      columns: ['Destination', 'Target'],
      rows: [
        ['10.0.0.0/16', 'local'],
        ['0.0.0.0/0', 'Internet Gateway'],
      ],
    },
    'subnet-public-b': {
      title: 'Public subnet · us-east-1b',
      subtitle: '10.0.1.0/24 — route table: public-rt',
      columns: ['Destination', 'Target'],
      rows: [
        ['10.0.0.0/16', 'local'],
        ['0.0.0.0/0', 'Internet Gateway'],
      ],
    },
    'subnet-private-a': {
      title: 'Private subnet · us-east-1a',
      subtitle: '10.0.10.0/24 — route table: private-rt-a',
      columns: ['Destination', 'Target'],
      rows: [
        ['10.0.0.0/16', 'local'],
        ['0.0.0.0/0', 'NAT Gateway (AZ a)'],
      ],
    },
    'subnet-private-b': {
      title: 'Private subnet · us-east-1b',
      subtitle: '10.0.11.0/24 — route table: private-rt-b',
      columns: ['Destination', 'Target'],
      rows: [
        ['10.0.0.0/16', 'local'],
        ['0.0.0.0/0', 'NAT Gateway (AZ b)'],
      ],
    },
    'subnet-isolated-a': {
      title: 'Isolated subnet · us-east-1a',
      subtitle: '10.0.20.0/24 — route table: isolated-rt',
      columns: ['Destination', 'Target'],
      rows: [
        ['10.0.0.0/16', 'local'],
      ],
      note: 'No default route — this subnet has no path to or from the internet, by design.',
    },
    'subnet-isolated-b': {
      title: 'Isolated subnet · us-east-1b',
      subtitle: '10.0.21.0/24 — route table: isolated-rt',
      columns: ['Destination', 'Target'],
      rows: [
        ['10.0.0.0/16', 'local'],
      ],
      note: 'No default route — this subnet has no path to or from the internet, by design.',
    },
    'igw': {
      title: 'Internet Gateway',
      subtitle: 'Attached to the VPC, referenced by both public subnets’ route tables',
      columns: ['Destination', 'Target'],
      rows: [
        ['10.0.0.0/16', 'local (VPC)'],
      ],
      note: 'The IGW itself has no route table of its own — it’s the target public subnets route their outbound internet traffic to.',
    },
    'nat-a': {
      title: 'NAT Gateway · AZ a',
      subtitle: 'Sits in the public subnet, used by private-rt-a',
      columns: ['Destination', 'Target'],
      rows: [
        ['0.0.0.0/0', 'Internet Gateway'],
      ],
      note: 'Only the private subnet in the same AZ routes through this gateway — the AZ-b private subnet uses its own NAT Gateway instead.',
    },
    'nat-b': {
      title: 'NAT Gateway · AZ b',
      subtitle: 'Sits in the public subnet, used by private-rt-b',
      columns: ['Destination', 'Target'],
      rows: [
        ['0.0.0.0/0', 'Internet Gateway'],
      ],
      note: 'Only the private subnet in the same AZ routes through this gateway — the AZ-a private subnet uses its own NAT Gateway instead.',
    },
  };

  var SECURITY_GROUPS = {
    'res-web': {
      title: 'web — Security group: web-sg',
      subtitle: 'Public subnet, us-east-1a',
      columns: ['Direction', 'Port', 'Source / Destination'],
      rows: [
        ['Inbound', '443 (HTTPS)', '0.0.0.0/0'],
        ['Inbound', '80 (HTTP)', '0.0.0.0/0'],
        ['Outbound', '8080', 'app-sg'],
      ],
    },
    'res-app': {
      title: 'app — Security group: app-sg',
      subtitle: 'Private subnet, us-east-1a',
      columns: ['Direction', 'Port', 'Source / Destination'],
      rows: [
        ['Inbound', '8080', 'web-sg'],
        ['Outbound', '5432 (PostgreSQL)', 'db-sg'],
      ],
      note: 'Inbound is scoped to web-sg by reference, not to a CIDR block — any resource carrying that security group can reach this one, regardless of which subnet it’s in.',
    },
    'res-db': {
      title: 'db — Security group: db-sg',
      subtitle: 'Isolated subnet, us-east-1a',
      columns: ['Direction', 'Port', 'Source / Destination'],
      rows: [
        ['Inbound', '5432 (PostgreSQL)', 'app-sg'],
      ],
      note: 'No outbound rule beyond the default — and no route out of the subnet either way, since this is an isolated subnet.',
    },
  };

  var diagram = document.getElementById('vpc-diagram');
  var placeholder = document.getElementById('vpc-detail-placeholder');
  var content = document.getElementById('vpc-detail-content');
  var titleEl = document.getElementById('vpc-detail-title');
  var subtitleEl = document.getElementById('vpc-detail-subtitle');
  var tableHead = document.getElementById('vpc-detail-table-head');
  var tableBody = document.getElementById('vpc-detail-table-body');
  if (!diagram || !content) return;

  var nodes = Array.prototype.slice.call(diagram.querySelectorAll('.vpc-node'));

  function dataFor(nodeId) {
    if (SECURITY_GROUPS[nodeId]) return SECURITY_GROUPS[nodeId];
    if (ROUTE_TABLES[nodeId]) return ROUTE_TABLES[nodeId];
    return null;
  }

  function render(nodeId) {
    var data = dataFor(nodeId);
    if (!data) return;

    titleEl.textContent = data.title;
    subtitleEl.textContent = data.subtitle;

    tableHead.innerHTML = '<tr>' + data.columns.map(function (col) {
      return '<th scope="col">' + col + '</th>';
    }).join('') + '</tr>';

    tableBody.innerHTML = data.rows.map(function (row) {
      return '<tr>' + row.map(function (cell) {
        return '<td>' + cell + '</td>';
      }).join('') + '</tr>';
    }).join('');

    var existingNote = content.querySelector('.vpc-detail-note');
    if (existingNote) existingNote.parentNode.removeChild(existingNote);
    if (data.note) {
      var noteEl = document.createElement('p');
      noteEl.className = 'muted small-note vpc-detail-note';
      noteEl.textContent = data.note;
      content.appendChild(noteEl);
    }

    placeholder.hidden = true;
    content.hidden = false;
  }

  function selectNode(el) {
    var nodeId = el.getAttribute('data-node');
    if (!dataFor(nodeId)) return;

    nodes.forEach(function (n) {
      n.classList.remove('is-selected');
    });
    el.classList.add('is-selected');
    render(nodeId);
  }

  nodes.forEach(function (el) {
    el.addEventListener('click', function () {
      selectNode(el);
    });
    el.addEventListener('keydown', function (event) {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        selectNode(el);
      }
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
    // detect or override it (confirmed elsewhere in this codebase:
    // touch-action: manipulation in styles.css and a touchstart
    // listener were both tried and neither helped, since the touch
    // simply never arrives). A plain click is all that's needed here.
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
