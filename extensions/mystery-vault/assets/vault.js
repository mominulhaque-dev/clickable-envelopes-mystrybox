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

  var gridEl = root.querySelector("[data-mv-grid]");
  var statusEl = root.querySelector("[data-mv-status]");
  var modalEl = root.querySelector("[data-mv-modal]");

  var state = { opened: {}, opensLeft: 0, busy: false };

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

  // A stable-ish idempotency key per open attempt.
  function makeKey(index) {
    return "mv-" + campaignId + "-" + index + "-" + Date.now() + "-" +
      Math.random().toString(36).slice(2, 8);
  }

  function loadState() {
    setStatus("Loading…");
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

        if (data.appearance && data.appearance.brandColor) {
          root.style.setProperty("--mv-brand", data.appearance.brandColor);
        }

        renderGrid(data.campaign.envelopeCount);

        if (!loggedIn && !data.loggedIn) {
          setStatus(data.loginPromptText || "Log in to open an envelope.");
        } else if (data.soldOut) {
          setStatus("All envelopes have been opened.");
        } else if (state.opensLeft <= 0) {
          setStatus("You've used all your opens for this vault.");
        } else {
          setStatus("You have " + state.opensLeft + " open" +
            (state.opensLeft === 1 ? "" : "s") + " left.");
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
      cell.className = "mystery-vault__cell";
      cell.setAttribute("data-index", i);
      cell.setAttribute("aria-label", "Envelope " + (i + 1));
      if (state.opened[i]) {
        cell.classList.add("is-opened");
        cell.disabled = true;
      }
      cell.textContent = state.opened[i] ? "✓" : "?";
      frag.appendChild(cell);
    }
    gridEl.innerHTML = "";
    gridEl.appendChild(frag);
  }

  function canOpen() {
    if (!loggedIn) {
      setStatus("Please log in to open an envelope.");
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
        cell.classList.add("is-opened");
        cell.disabled = true;
        cell.textContent = body.reward && body.reward.won ? "★" : "✓";

        showResult(body.reward);
        setStatus(state.opensLeft > 0
          ? "You have " + state.opensLeft + " open" + (state.opensLeft === 1 ? "" : "s") + " left."
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
        setStatus("Please log in to open an envelope.");
        break;
      case "ENVELOPE_TAKEN":
        // Someone else grabbed it; mark spent and let them pick another.
        state.opened[index] = true;
        cell.classList.add("is-opened");
        cell.disabled = true;
        cell.textContent = "✓";
        setStatus("That envelope was just taken. Try another!");
        break;
      case "OPEN_LIMIT_REACHED":
        state.opensLeft = 0;
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
    var titleEl = modalEl.querySelector("[data-mv-result-title]");
    var detailEl = modalEl.querySelector("[data-mv-result-detail]");
    var msgEl = modalEl.querySelector("[data-mv-result-message]");
    var codeWrap = modalEl.querySelector("[data-mv-result-code]");
    var codeVal = modalEl.querySelector("[data-mv-code-value]");

    titleEl.textContent = reward.title || (reward.won ? "You won!" : "No luck");
    detailEl.textContent = reward.detail || "";
    msgEl.textContent = reward.message || "";

    if (reward.won && reward.code) {
      codeVal.textContent = reward.code;
      codeWrap.hidden = false;
    } else {
      codeWrap.hidden = true;
    }

    root.classList.toggle("mv-win", !!reward.won);
    modalEl.hidden = false;
  }

  function closeModal() {
    if (modalEl) modalEl.hidden = true;
  }

  // --- Event wiring ---
  gridEl.addEventListener("click", function (e) {
    var cell = e.target.closest(".mystery-vault__cell");
    if (!cell || cell.disabled) return;
    var index = Number(cell.getAttribute("data-index"));
    openEnvelope(index, cell);
  });

  if (modalEl) {
    modalEl.addEventListener("click", function (e) {
      if (e.target === modalEl || e.target.hasAttribute("data-mv-close")) {
        closeModal();
      }
      if (e.target.hasAttribute("data-mv-copy")) {
        var code = modalEl.querySelector("[data-mv-code-value]").textContent;
        if (navigator.clipboard && code) {
          navigator.clipboard.writeText(code).then(function () {
            e.target.textContent = "Copied!";
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
