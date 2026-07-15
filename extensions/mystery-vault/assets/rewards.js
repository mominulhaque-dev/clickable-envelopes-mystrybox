/**
 * Mystery Vault "My Rewards" controller.
 *
 * Fetches the logged-in customer's won rewards from the app proxy /rewards
 * endpoint and renders them as a list. Requires login; the server only ever
 * returns the requesting customer's own rewards.
 */
(function () {
  "use strict";

  var root = document.getElementById("mystery-vault-rewards");
  if (!root) return;

  var base = root.getAttribute("data-proxy-base") || "/apps/mystery-vault";
  var campaignId = root.getAttribute("data-campaign") || "";
  var loggedIn = !!root.getAttribute("data-logged-in");

  var listEl = root.querySelector("[data-mvr-list]");
  var statusEl = root.querySelector("[data-mvr-status]");

  function setStatus(msg) {
    statusEl.textContent = msg || "";
  }

  function qs(params) {
    var s = Object.keys(params)
      .filter(function (k) { return params[k] !== "" && params[k] != null; })
      .map(function (k) { return encodeURIComponent(k) + "=" + encodeURIComponent(params[k]); })
      .join("&");
    return s ? "?" + s : "";
  }

  function esc(str) {
    var d = document.createElement("div");
    d.textContent = str == null ? "" : String(str);
    return d.innerHTML;
  }

  function fmtDate(iso) {
    if (!iso) return "";
    try {
      return new Date(iso).toLocaleDateString();
    } catch (e) {
      return "";
    }
  }

  function render(rewards) {
    if (!rewards.length) {
      listEl.innerHTML = "";
      setStatus("You haven't won any rewards yet. Go open an envelope!");
      return;
    }
    setStatus("");
    listEl.innerHTML = rewards
      .map(function (r) {
        var codeBlock = r.code
          ? '<div class="mv-rewards__code"><code>' + esc(r.code) + "</code>" +
            '<button type="button" class="mv-rewards__copy" data-code="' + esc(r.code) + '">Copy</button></div>'
          : "";
        var detail = r.detail ? '<p class="mv-rewards__detail">' + esc(r.detail) + "</p>" : "";
        var msg = r.message ? '<p class="mv-rewards__msg">' + esc(r.message) + "</p>" : "";
        var expiry = r.expiresAt
          ? '<p class="mv-rewards__expiry">Expires ' + esc(fmtDate(r.expiresAt)) + "</p>"
          : "";
        var pending = r.status === "PENDING"
          ? '<p class="mv-rewards__msg">We\'re still issuing this reward…</p>'
          : "";
        return (
          '<li class="mv-rewards__item">' +
          '<h3 class="mv-rewards__item-title">' + esc(r.title || "Reward") + "</h3>" +
          detail + pending + codeBlock + msg + expiry +
          "</li>"
        );
      })
      .join("");
  }

  function load() {
    if (!loggedIn) {
      setStatus("Please log in to see your rewards.");
      return;
    }
    setStatus("Loading your rewards…");
    fetch(base + "/rewards" + qs({ campaign: campaignId }), {
      headers: { Accept: "application/json" },
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (!data || !data.ok) {
          if (data && data.error === "LOGIN_REQUIRED") {
            setStatus("Please log in to see your rewards.");
          } else {
            setStatus("Could not load your rewards. Please refresh.");
          }
          return;
        }
        render(data.rewards || []);
      })
      .catch(function () {
        setStatus("Could not load your rewards. Please refresh.");
      });
  }

  listEl.addEventListener("click", function (e) {
    if (e.target.classList.contains("mv-rewards__copy")) {
      var code = e.target.getAttribute("data-code");
      if (navigator.clipboard && code) {
        navigator.clipboard.writeText(code).then(function () {
          e.target.textContent = "Copied!";
        });
      }
    }
  });

  load();
})();
