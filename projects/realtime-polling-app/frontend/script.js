(() => {
  const defaultConfig = {
    pollWsUrl: ""
  };

  const config = {
    ...defaultConfig,
    ...(window.APP_CONFIG || {})
  };

  const year = document.querySelector("#year");
  if (year) {
    year.textContent = new Date().getFullYear();
  }

  const rowsEl = document.querySelector("#poll-rows");
  if (!rowsEl) {
    return;
  }

  const POLL_ID = "movie-poll";
  const OPTIONS = [
    { id: "fury-road", label: "Mad Max: Fury Road", desc: "Nonstop motion, zero patience, somehow it all works out", color: "var(--poll-color-1)" },
    { id: "matrix", label: "The Matrix", desc: "Questions everything, takes the hard truth over the comfortable lie", color: "var(--poll-color-2)" },
    { id: "mission", label: "The Mission", desc: "Quietly relentless, shows up for it even when it costs everything", color: "var(--poll-color-3)" },
    { id: "la-la-land", label: "La La Land", desc: "Chasing the dream, running on four hours of sleep", color: "var(--poll-color-4)" },
    { id: "jurassic-park", label: "Jurassic Park", desc: "Going great until, very suddenly, it really isn't", color: "var(--poll-color-5)" }
  ];

  const statusEl = document.querySelector("#poll-status");
  const feedEl = document.querySelector("#poll-feed");
  const totalEl = document.querySelector("#poll-total");

  const isConfiguredEndpoint = (url) => {
    return Boolean(
      url &&
      url.startsWith("wss://") &&
      !url.includes("REPLACE_WITH_YOUR_WEBSOCKET_URL")
    );
  };

  let voterId = localStorage.getItem("livePollVoterId");
  if (!voterId) {
    voterId = (window.crypto && crypto.randomUUID)
      ? crypto.randomUUID()
      : `v-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    localStorage.setItem("livePollVoterId", voterId);
  }

  const myChoiceKey = `livePollChoice_${POLL_ID}`;
  let myChoice = localStorage.getItem(myChoiceKey);
  let lastTallies = {};
  let ws = null;

  const setStatus = (state, label) => {
    if (!statusEl) return;
    statusEl.setAttribute("data-state", state);
    statusEl.textContent = label || (state === "live" ? "Live" : state === "connecting" ? "Connecting…" : "Reconnecting…");
  };

  const renderRows = (tallies) => {
    lastTallies = tallies;
    const total = OPTIONS.reduce((sum, o) => sum + (tallies[o.id] || 0), 0);
    if (totalEl) totalEl.textContent = `${total} ${total === 1 ? "vote" : "votes"}`;
    rowsEl.innerHTML = "";
    OPTIONS.forEach((o) => {
      const count = tallies[o.id] || 0;
      const pct = total ? Math.round((count / total) * 100) : 0;
      const row = document.createElement("button");
      row.type = "button";
      row.className = `poll-row${myChoice === o.id ? " is-mine" : ""}`;
      row.setAttribute("aria-pressed", myChoice === o.id ? "true" : "false");
      row.innerHTML = `
        <span class="poll-row-text">
          <span class="poll-row-label">${o.label}:</span>
          <span class="poll-row-desc">${o.desc}</span>
        </span>
        <span class="poll-row-track-wrap">
          ${myChoice === o.id ? '<span class="poll-row-you">Your pick</span>' : ""}
          <span class="poll-row-track"><span class="poll-row-fill" style="width:${pct}%; background:${o.color}"></span></span>
        </span>
        <span class="poll-row-count">${pct}% · ${count}</span>
      `;
      row.addEventListener("click", () => castVote(o.id));
      rowsEl.appendChild(row);
    });
  };

  const addFeedItem = (text) => {
    if (!feedEl) return;
    const li = document.createElement("li");
    li.textContent = text;
    feedEl.prepend(li);
    while (feedEl.children.length > 8) {
      feedEl.removeChild(feedEl.lastChild);
    }
  };

  const castVote = (optionId) => {
    if (!ws || ws.readyState !== 1) return;
    if (myChoice === optionId) return;
    const changed = Boolean(myChoice);
    ws.send(JSON.stringify({ action: "vote", pollId: POLL_ID, option: optionId, voterId }));
    myChoice = optionId;
    localStorage.setItem(myChoiceKey, optionId);
  };

  const connect = () => {
    if (!isConfiguredEndpoint(config.pollWsUrl)) {
      setStatus("reconnecting", "Not configured");
      rowsEl.innerHTML = '<p class="muted small-note">Add your deployed WebSocket URL in config.js to enable voting.</p>';
      return;
    }

    setStatus("connecting");
    ws = new WebSocket(config.pollWsUrl);

    ws.addEventListener("open", () => {
      setStatus("live");
      ws.send(JSON.stringify({ action: "sync", pollId: POLL_ID }));
    });

    ws.addEventListener("close", () => {
      setStatus("reconnecting");
      window.setTimeout(connect, 2000);
    });

    ws.addEventListener("error", () => ws.close());

    ws.addEventListener("message", (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }
      if (msg.type === "results") {
        renderRows(msg.tallies || {});
        if (msg.event && msg.event.option) {
          const opt = OPTIONS.find((o) => o.id === msg.event.option);
          if (opt) {
            addFeedItem((msg.event.changed ? "Someone changed their vote to " : "Someone picked ") + opt.label);
          }
        }
      }
    });
  };

  connect();

  // Explicitly close the connection when navigating away or closing the
  // tab. Without this, the back-forward cache can keep a frozen page's
  // WebSocket connection alive rather than closing it promptly, so
  // $disconnect might not fire until the browser fully discards the page
  // (e.g. closing the whole window) rather than at the moment you'd
  // expect — right when you navigate away.
  window.addEventListener("pagehide", () => {
    if (ws) {
      ws.close();
    }
  });

  // If another tab (same browser) changes the vote, the storage event
  // fires here automatically — sync our in-memory choice and redraw so
  // "your pick" doesn't go stale.
  window.addEventListener("storage", (event) => {
    if (event.key === myChoiceKey) {
      myChoice = event.newValue;
      renderRows(lastTallies);
    }
  });
})();
