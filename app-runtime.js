/* Sliding In 4 — PWA runtime: install, per-lesson deep links, teacher
   sharing, licence unlock.

   Content model: lesson-data.js carries only the free teaser, encrypted under a
   public key. The full deck is sealed per buyer (or per shared lesson) by the
   unlock service and decrypted here. The paid key never ships. */
(function () {
  "use strict";
  var DECK = "4";
  var WORKER = "https://ae-sliding-in.billiethomasonsound.workers.dev";
  var PRODUCT_KEY = "rWSej";   /* Payhip product key — Sliding In 4 */
  var BUY_URL = "https://payhip.com/b/rWSej"; /* Sliding In 4 checkout */
  var FREE_SLUGS = ["airportsflying", "carsdriving", "conversation", "introductions"];
  var unlocked = false;
  var granted = {};

  /* ── service worker ── */
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("sw.js").catch(function (e) {
        if (window.console) console.warn("[Sliding In] service worker failed", e);
      });
    });
  }

  /* ── install prompt ── */
  var deferredPrompt = null;
  window.addEventListener("beforeinstallprompt", function (e) {
    e.preventDefault();
    deferredPrompt = e;
    var b = document.getElementById("installBtn");
    if (b) b.classList.remove("hidden");
  });
  window.slidingInInstall = function () {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    deferredPrompt.userChoice.then(function () { deferredPrompt = null; });
  };

  /* ── access ── */
  window.slidingInIsOpen = function (slug) {
    return FREE_SLUGS.indexOf(slug) >= 0 || unlocked || !!granted[slug];
  };

  /* ── crypto (mirrors the Worker's hkdfFromString) ── */
  function b64urlDecode(s) {
    try {
      var t = String(s || "").replace(/-/g, "+").replace(/_/g, "/");
      var pad = t.length % 4 === 0 ? "" : "=".repeat(4 - (t.length % 4));
      var bin = atob(t + pad);
      var out = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    } catch (e) { return new Uint8Array(0); }
  }
  function deriveKey(secret, salt, info) {
    return crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(secret))).then(function (ikm) {
      return crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveKey"]);
    }).then(function (base) {
      return crypto.subtle.deriveKey(
        { name: "HKDF", hash: "SHA-256", salt: new TextEncoder().encode(salt), info: new TextEncoder().encode(info) },
        base, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
    });
  }
  function decryptPayload(ctB64, key) {
    var raw = b64urlDecode(ctB64);
    return crypto.subtle.decrypt({ name: "AES-GCM", iv: raw.slice(0, 12) }, key, raw.slice(12));
  }
  function grantNonce(token) {
    try {
      var part = String(token).split(".")[0];
      return JSON.parse(new TextDecoder().decode(b64urlDecode(part))).nonce || null;
    } catch (e) { return null; }
  }
  function deviceId() {
    try {
      var id = localStorage.getItem("sliding-in-device");
      if (!id) { id = "d" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); localStorage.setItem("sliding-in-device", id); }
      return id;
    } catch (e) { return "anonymous"; }
  }

  /* ── data ── */
  function mergeTopics(incoming) {
    var data = window.lessonData || [];
    (incoming || []).forEach(function (cat) {
      var target = null;
      for (var i = 0; i < data.length; i++) if (data[i].category === cat.category) { target = data[i]; break; }
      if (!target) { target = { category: cat.category, topics: [] }; data.push(target); }
      (cat.topics || []).forEach(function (t) {
        var found = false;
        for (var j = 0; j < target.topics.length; j++) {
          if (target.topics[j].slug === t.slug) { target.topics[j] = t; found = true; break; }
        }
        if (!found) target.topics.push(t);
      });
    });
    window.lessonData = data;
  }
  function findTopic(slug) {
    var data = window.lessonData || [];
    for (var i = 0; i < data.length; i++) {
      for (var j = 0; j < data[i].topics.length; j++) {
        if (data[i].topics[j].slug === slug) return { cat: data[i].category, topic: data[i].topics[j] };
      }
    }
    return null;
  }
  function openLesson(slug) {
    var hit = findTopic(slug);
    if (hit && window.openDeck) { window.openDeck(hit.cat, hit.topic); return true; }
    return false;
  }
  function rerender() { if (window.tryInitLibrary) window.tryInitLibrary(); }

  /* ── licence unlock ── */
  function storedLicence() { try { return localStorage.getItem("sliding-in-licence") || ""; } catch (e) { return ""; } }
  function setUnlockMessage(text, kind) {
    var el = document.getElementById("unlockMsg");
    if (!el) return;
    el.textContent = text;
    el.style.color = kind === "error" ? "#f87171" : "var(--text-dim)";
  }
  window.slidingInUnlock = function () {
    var input = document.getElementById("licenceKey");
    var key = input ? input.value.trim() : storedLicence();
    if (!key) { setUnlockMessage("Paste the license key from your receipt email.", "error"); return; }
    if (!PRODUCT_KEY) { setUnlockMessage("Unlock is not enabled yet — the store is still being wired.", "error"); return; }
    setUnlockMessage("Checking…");
    fetch(WORKER + "/sliding-in/verify", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ licence_key: key, product_key: PRODUCT_KEY })
    }).then(function (r) { return r.json().then(function (d) { return { status: r.status, body: d }; }); })
      .then(function (res) {
        if (!res.body.ok) { setUnlockMessage(res.body.error || "That key was not accepted.", "error"); return; }
        return fetch(WORKER + "/sliding-in/payload", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ licence_key: key, product_key: PRODUCT_KEY, deck: DECK })
        }).then(function (r2) { return r2.json().then(function (d2) { return { status: r2.status, body: d2 }; }); })
          .then(function (res2) {
            if (!res2.body.ok) { setUnlockMessage(res2.body.error || "Could not load the deck.", "error"); return; }
            return deriveKey(key, "sliding-in/" + DECK, "sliding-in/payload/v1")
              .then(function (k) { return decryptPayload(res2.body.ciphertext, k); })
              .then(function (plain) {
                mergeTopics(JSON.parse(new TextDecoder().decode(plain)));
                unlocked = true;
                try { localStorage.setItem("sliding-in-licence", key); } catch (e) {}
                setUnlockMessage("");
                var modal = document.getElementById("buyModal");
                if (modal) modal.classList.remove("open");
                rerender();
                var btn = document.getElementById("buyBtn");
                if (btn) { btn.textContent = "Unlocked"; btn.classList.remove("disabled"); }
              });
          });
      }).catch(function (e) { setUnlockMessage("Network error — try again.", "error"); });
  };

  /* ── share a lesson ──
     The link is the plain lesson URL, so it works for a free lesson and lands on
     the unlock screen for a locked one. No licence is required to share. */
  window.slidingInShare = function (slug) {
    if (!slug) return;
    var url = window.location.origin + window.location.pathname +
              "?lesson=" + encodeURIComponent(slug);
    var input = document.getElementById("shareLink");
    if (input) { input.value = url; try { input.select(); } catch (e) {} }
    var modal = document.getElementById("shareModal");
    if (modal) modal.classList.add("open");
  };
  window.closeShareModal = function () {
    var modal = document.getElementById("shareModal");
    if (modal) modal.classList.remove("open");
  };
  window.copyShareLink = function () {
    var input = document.getElementById("shareLink");
    if (!input) return;
    var btn = document.getElementById("shareCopyBtn");
    function done() {
      if (btn) { btn.textContent = "Copied"; setTimeout(function () { btn.textContent = "Copy link"; }, 1600); }
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(input.value).then(done, function () {
        try { input.select(); document.execCommand("copy"); } catch (e) {}
        done();
      });
    } else {
      try { input.select(); document.execCommand("copy"); } catch (e) {}
      done();
    }
  };

  /* ── deep link: ?lesson=<slug>&grant=<token> ── */
  function handleDeepLink() {
    var p = new URLSearchParams(window.location.search);
    var slug = p.get("lesson");
    var token = p.get("grant");
    if (!slug) return;
    if (window.slidingInIsOpen(slug)) { openLesson(slug); return; }
    if (!token) { openBuyModal(null); return; }
    var nonce = grantNonce(token);
    fetch(WORKER + "/sliding-in/redeem", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ grant: token, device: deviceId() })
    }).then(function (r) { return r.json(); }).then(function (d) {
      if (!d.ok) { openBuyModal(null); return; }
      granted[d.lesson] = true;
      if (!d.payload || !nonce) { rerender(); openLesson(d.lesson); return; }
      deriveKey(nonce, "sliding-in/grant/" + d.deck + "/" + d.lesson, "sliding-in/grant/v1")
        .then(function (k) { return decryptPayload(d.payload, k); })
        .then(function (plain) {
          mergeTopics(JSON.parse(new TextDecoder().decode(plain)));
          rerender();
          openLesson(d.lesson);
        }).catch(function () { rerender(); });
    }).catch(function () { openBuyModal(null); });
  }

  /* ── wire the UI once the page exists ── */
  function wire() {
    var share = document.getElementById("shareBtn");
    if (share) share.addEventListener("click", function () {
      var slug = share.getAttribute("data-slug");
      if (slug) window.slidingInShare(slug);
    });
    var shareClose = document.getElementById("shareCloseBtn");
    if (shareClose) shareClose.addEventListener("click", window.closeShareModal);
    var shareCopy = document.getElementById("shareCopyBtn");
    if (shareCopy) shareCopy.addEventListener("click", window.copyShareLink);
    var unlockBtn = document.getElementById("unlockBtn");
    if (unlockBtn) unlockBtn.addEventListener("click", window.slidingInUnlock);
    var buyBtn = document.getElementById("buyBtn");
    if (buyBtn) {
      if (BUY_URL) { buyBtn.textContent = "Buy on Payhip"; buyBtn.classList.remove("disabled"); buyBtn.setAttribute("href", BUY_URL); }
      else { buyBtn.textContent = "On Payhip soon"; buyBtn.classList.add("disabled"); }
    }
    var empty = document.getElementById("buyEmpty");
    if (empty && !BUY_URL) empty.textContent = "Payhip checkout opens here once the store is live. Have a license key? Use Unlock below.";
  }

  /* keep the Share button pointed at whichever lesson is open */
  function hookOpenDeck() {
    if (!window.openDeck) { setTimeout(hookOpenDeck, 200); return; }
    if (window.__slidingInHooked) return;
    window.__slidingInHooked = true;
    var orig = window.openDeck;
    window.openDeck = function (cat, topic) {
      var btn = document.getElementById("shareBtn");
      if (btn && topic && topic.slug) btn.setAttribute("data-slug", topic.slug);
      return orig.apply(this, arguments);
    };
  }

  document.addEventListener("DOMContentLoaded", function () {
    hookOpenDeck();
    wire();
    handleDeepLink();
  });
})();
