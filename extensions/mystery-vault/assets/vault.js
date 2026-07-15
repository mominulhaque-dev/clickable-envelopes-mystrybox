/**
 * Mystery Vault storefront controller.
 *
 * Talks only to the app proxy (data-proxy-base). The server owns all reward
 * logic; this script just renders the grid, sends open requests, and shows the
 * outcome. It never decides or trusts a reward client-side.
 */
(function () {
  "use strict";

  var root = document.getElementById("mystery-vault");
  if (!root) return;

  var base = root.getAttribute("data-proxy-base") || "/apps/mystery-vault";
  var campaignId = root.getAttribute("data-campaign") || "";
  var loggedIn = !!root.getAttribute("data-logged-in");
  var loginUrl = root.getAttribute("data-login-url") || "/account/login";

  var gridEl = root.querySelector("[data-mv-grid]");
  var statusEl = root.querySelector("[data-mv-status]");
  var modalEl = root.querySelector("[data-mv-modal]");
  var statsEl = root.querySelector("[data-mv-stats]");
  var loginEl = root.querySelector("[data-mv-login]");

  var state = { opened: {}, opensLeft: 0, busy: false, remaining: null };

  // --- Inline SVG icon set (no external requests) ------------------------
  var ICONS = {
    envelope:
      '<svg viewBox="0 0 24 24" class="mv__cell-icon" aria-hidden="true"><path d="M20 4H4a2 2 0 00-2 2v12a2 2 0 002 2h16a2 2 0 002-2V6a2 2 0 00-2-2zm0 4l-8 5-8-5V6l8 5 8-5z"/></svg>',
    check:
      '<svg viewBox="0 0 24 24" class="mv__cell-icon" aria-hidden="true"><path d="M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z"/></svg>',
    gift:
      '<svg viewBox="0 0 24 24" class="mv__cell-icon" aria-hidden="true"><path d="M20 7h-2.2a3 3 0 00-4.8-3.5A3 3 0 006.2 7H4a1 1 0 00-1 1v3h9v-2h2v2h9V8a1 1 0 00-1-1zM4 13v7a1 1 0 001 1h6v-8zm9 8h6a1 1 0 001-1v-7h-7z"/></svg>',
    reward: {
      DISCOUNT:
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21.4 11.6l-9-9A2 2 0 0011 2H4a2 2 0 00-2 2v7a2 2 0 00.6 1.4l9 9a2 2 0 002.8 0l5-5a2 2 0 000-2.8zM6.5 8A1.5 1.5 0 118 6.5 1.5 1.5 0 016.5 8z"/></svg>',
      FREE_SHIPPING:
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 8h-3V4H3a2 2 0 00-2 2v11h2a3 3 0 006 0h6a3 3 0 006 0h2v-6zM6 18.5A1.5 1.5 0 117.5 17 1.5 1.5 0 016 18.5zm12 0A1.5 1.5 0 1119.5 17 1.5 1.5 0 0118 18.5zM17 12V9.5h2.5l1.96 2.5z"/></svg>',
      GIFT_CARD:
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 7h-2.2a3 3 0 00-4.8-3.5A3 3 0 006.2 7H4a1 1 0 00-1 1v3h9v-2h2v2h9V8a1 1 0 00-1-1zM4 13v7a1 1 0 001 1h6v-8zm9 8h6a1 1 0 001-1v-7h-7z"/></svg>',
      FREE_PRODUCT:
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2l2.6 5.6L21 8.3l-4.5 4.4L17.5 19 12 15.9 6.5 19l1-6.3L3 8.3l6.4-.7z"/></svg>',
      WIN:
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2l2.6 5.6L21 8.3l-4.5 4.4L17.5 19 12 15.9 6.5 19l1-6.3L3 8.3l6.4-.7z"/></svg>',
      LOSE:
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a10 10 0 1010 10A10 10 0 0012 2zm5 11H7v-2h10z"/></svg>',
    },
  };

  function qs(params) {
    var s = Object.keys(params)
      .filter(function (k) { return params[k] !== "" && params[k] != null; })
      .map(function (k) { return encodeURIComponent(k) + "=" + encodeURIComponent(params[k]); })
      .join("&");
    return s ? "?" + s : "";
  }

  function setStatus(msg) {
    statusEl.textContent = msg || "";
  }

  function setStat(sel, value) {
    var el = root.querySelector(sel);
    if (el) el.textContent = value;
  }

  function refreshStats() {
    if (!statsEl) return;
    statsEl.hidden = false;
    setStat("[data-mv-stat-remaining]", state.remaining != null ? state.remaining : "—");
    setStat("[data-mv-stat-opens]", state.opensLeft != null ? state.opensLeft : "—");
  }

  // A stable-ish idempotency key per open attempt.
  function makeKey(index) {
    return "mv-" + campaignId + "-" + index + "-" + Date.now() + "-" +
      Math.random().toString(36).slice(2, 8);
  }

  function showLogin(text) {
    if (!loginEl) return;
    loginEl.hidden = false;
    loginEl.setAttribute("href", loginUrl);
    var t = loginEl.querySelector("[data-mv-login-text]");
    if (t && text) t.textContent = text;
  }

  function loadState() {
    setStatus("Loading your vault…");
    fetch(base + "/state" + qs({ campaign: campaignId }), {
      headers: { Accept: "application/json" },
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (!data || !data.ok || !data.campaign) {
          setStatus("No active vault right now. Check back soon.");
          gridEl.innerHTML = "";
          return;
        }
        campaignId = data.campaign.id;
        state.opened = {};
        (data.openedIndices || []).forEach(function (i) { state.opened[i] = true; });
        state.opensLeft = data.customerOpensLeft != null ? data.customerOpensLeft : 0;

        var count = data.campaign.envelopeCount || 0;
        state.remaining = Math.max(0, count - Object.keys(state.opened).length);

        if (data.appearance && data.appearance.brandColor) {
          root.style.setProperty("--mv-brand", data.appearance.brandColor);
        }

        renderGrid(count);
        refreshStats();

        if (!loggedIn && !data.loggedIn) {
          setStatus("");
          showLogin(data.loginPromptText || "Log in to play");
        } else if (data.soldOut) {
          setStatus("Every envelope has been opened. Thanks for playing!");
        } else if (state.opensLeft <= 0) {
          setStatus("You've used all your opens for this vault.");
        } else {
          setStatus("Tap an envelope to reveal your reward.");
        }
      })
      .catch(function () {
        setStatus("Could not load the vault. Please refresh.");
      });
  }

  function renderGrid(count) {
    var frag = document.createDocumentFragment();
    for (var i = 0; i < count; i++) {
      var cell = document.createElement("button");
      cell.type = "button";
      cell.className = "mv__cell";
      cell.setAttribute("data-index", i);
      cell.setAttribute("aria-label", "Envelope " + (i + 1));
      if (state.opened[i]) {
        cell.classList.add("is-opened");
        cell.disabled = true;
        cell.innerHTML = ICONS.check;
      } else {
        cell.innerHTML = ICONS.envelope;
      }
      frag.appendChild(cell);
    }
    gridEl.innerHTML = "";
    gridEl.appendChild(frag);
  }

  function canOpen() {
    if (!loggedIn) {
      showLogin();
      return false;
    }
    if (state.busy) return false;
    if (state.opensLeft <= 0) {
      setStatus("You've used all your opens for this vault.");
      return false;
    }
    return true;
  }

  function openEnvelope(index, cell) {
    if (!canOpen()) return;
    state.busy = true;
    cell.classList.add("is-loading");
    setStatus("Opening…");

    fetch(base + "/open", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ campaign: campaignId, index: index, key: makeKey(index) }),
    })
      .then(function (r) { return r.json().then(function (b) { return { status: r.status, body: b }; }); })
      .then(function (res) {
        state.busy = false;
        cell.classList.remove("is-loading");
        var body = res.body || {};

        if (!body.ok) {
          handleOpenError(body.error, cell, index);
          return;
        }

        // Mark spent regardless of win/lose.
        state.opened[index] = true;
        state.opensLeft = Math.max(0, state.opensLeft - 1);
        state.remaining = Math.max(0, (state.remaining || 1) - 1);
        cell.classList.add("is-opened");
        cell.disabled = true;
        var won = body.reward && body.reward.won;
        if (won) cell.classList.add("is-won");
        cell.innerHTML = won ? ICONS.gift : ICONS.check;

        refreshStats();
        showResult(body.reward);
        setStatus(state.opensLeft > 0
          ? "Nice! You have " + state.opensLeft + " open" + (state.opensLeft === 1 ? "" : "s") + " left."
          : "That was your last open. Thanks for playing!");
      })
      .catch(function () {
        state.busy = false;
        cell.classList.remove("is-loading");
        setStatus("Something went wrong. Please try again.");
      });
  }

  function handleOpenError(code, cell, index) {
    switch (code) {
      case "LOGIN_REQUIRED":
        showLogin();
        break;
      case "ENVELOPE_TAKEN":
        // Someone else grabbed it; mark spent and let them pick another.
        state.opened[index] = true;
        cell.classList.add("is-opened");
        cell.disabled = true;
        cell.innerHTML = ICONS.check;
        setStatus("That envelope was just taken. Try another!");
        break;
      case "OPEN_LIMIT_REACHED":
        state.opensLeft = 0;
        refreshStats();
        setStatus("You've used all your opens for this vault.");
        break;
      case "RATE_LIMITED":
        setStatus("Slow down a moment, then try again.");
        break;
      case "NO_ACTIVE_CAMPAIGN":
        setStatus("This vault has ended.");
        break;
      default:
        setStatus("Could not open that envelope. Please try again.");
    }
  }

  function showResult(reward) {
    if (!modalEl || !reward) return;
    var iconEl = modalEl.querySelector("[data-mv-reward-icon]");
    var titleEl = modalEl.querySelector("[data-mv-result-title]");
    var detailEl = modalEl.querySelector("[data-mv-result-detail]");
    var msgEl = modalEl.querySelector("[data-mv-result-message]");
    var codeWrap = modalEl.querySelector("[data-mv-result-code]");
    var codeVal = modalEl.querySelector("[data-mv-code-value]");

    var won = !!reward.won;
    titleEl.textContent = reward.title || (won ? "You won!" : "No luck this time");
    detailEl.textContent = reward.detail || "";
    msgEl.textContent = reward.message || "";

    if (iconEl) {
      iconEl.innerHTML = won
        ? (ICONS.reward[reward.type] || ICONS.reward.WIN)
        : ICONS.reward.LOSE;
    }

    if (won && reward.code) {
      codeVal.textContent = reward.code;
      codeWrap.hidden = false;
    } else {
      codeWrap.hidden = true;
    }

    root.classList.toggle("mv--win", won);
    modalEl.hidden = false;

    if (won) launchConfetti();
  }

  function closeModal() {
    if (modalEl) modalEl.hidden = true;
    stopConfetti();
  }

  // --- Lightweight canvas confetti (no dependencies) ---------------------
  var confettiRaf = null;
  function launchConfetti() {
    var canvas = modalEl.querySelector("[data-mv-confetti]");
    if (!canvas) return;
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    var ctx = canvas.getContext("2d");
    var w = (canvas.width = canvas.offsetWidth);
    var h = (canvas.height = canvas.offsetHeight);
    var colors = ["#F5B301", "#6D5EF8", "#22c55e", "#ff5e7e", "#22d3ee"];
    var pieces = [];
    for (var i = 0; i < 120; i++) {
      pieces.push({
        x: Math.random() * w,
        y: -20 - Math.random() * h,
        r: 4 + Math.random() * 6,
        c: colors[(Math.random() * colors.length) | 0],
        vy: 2 + Math.random() * 3,
        vx: -1 + Math.random() * 2,
        rot: Math.random() * Math.PI,
        vr: -0.1 + Math.random() * 0.2,
      });
    }
    var start = Date.now();
    function frame() {
      ctx.clearRect(0, 0, w, h);
      pieces.forEach(function (p) {
        p.y += p.vy;
        p.x += p.vx;
        p.rot += p.vr;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.c;
        ctx.fillRect(-p.r / 2, -p.r / 2, p.r, p.r * 0.6);
        ctx.restore();
      });
      if (Date.now() - start < 2600) {
        confettiRaf = requestAnimationFrame(frame);
      } else {
        ctx.clearRect(0, 0, w, h);
      }
    }
    frame();
  }
  function stopConfetti() {
    if (confettiRaf) cancelAnimationFrame(confettiRaf);
    confettiRaf = null;
  }

  // --- Event wiring ------------------------------------------------------
  gridEl.addEventListener("click", function (e) {
    var cell = e.target.closest(".mv__cell");
    if (!cell || cell.disabled) return;
    var index = Number(cell.getAttribute("data-index"));
    openEnvelope(index, cell);
  });

  if (modalEl) {
    modalEl.addEventListener("click", function (e) {
      if (e.target === modalEl || e.target.closest("[data-mv-close]")) {
        closeModal();
      }
      var copyBtn = e.target.closest("[data-mv-copy]");
      if (copyBtn) {
        var code = modalEl.querySelector("[data-mv-code-value]").textContent;
        if (navigator.clipboard && code) {
          navigator.clipboard.writeText(code).then(function () {
            copyBtn.classList.add("is-copied");
            var label = copyBtn.querySelector("span");
            if (label) label.textContent = "Copied!";
          });
        }
      }
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") closeModal();
    });
  }

  loadState();
})();
