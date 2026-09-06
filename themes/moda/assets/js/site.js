(function () {
  "use strict";

  /* ---------------------------- nav toggle (mobile) ---------------------------- */

  var toggle = document.querySelector(".nav-toggle");
  var nav = document.getElementById("primary-nav");

  if (toggle && nav) {
    var closeNav = function () {
      toggle.classList.remove("is-open");
      nav.classList.remove("is-open");
      toggle.setAttribute("aria-expanded", "false");
    };

    toggle.addEventListener("click", function () {
      var isOpen = nav.classList.toggle("is-open");
      toggle.classList.toggle("is-open", isOpen);
      toggle.setAttribute("aria-expanded", String(isOpen));
    });

    nav.addEventListener("click", function (event) {
      if (event.target.tagName === "A") {
        closeNav();
      }
    });

    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape") {
        closeNav();
      }
    });
  }

  /* ------------------------------ reveal on scroll ------------------------------ */

  var revealTargets = document.querySelectorAll("[data-reveal]");

  if (revealTargets.length) {
    if ("IntersectionObserver" in window) {
      var observer = new IntersectionObserver(
        function (entries) {
          entries.forEach(function (entry) {
            if (entry.isIntersecting) {
              entry.target.classList.add("is-visible");
              observer.unobserve(entry.target);
            }
          });
        },
        { threshold: 0.12, rootMargin: "0px 0px -40px 0px" }
      );

      revealTargets.forEach(function (el) {
        observer.observe(el);
      });
    } else {
      revealTargets.forEach(function (el) {
        el.classList.add("is-visible");
      });
    }
  }

  /* ------------------------------ telemetry readout ------------------------------ */

  var statusFields = document.querySelectorAll("#status-panel [data-field]");

  if (statusFields.length) {
    var fieldMap = {};
    statusFields.forEach(function (el) {
      fieldMap[el.getAttribute("data-field")] = el;
    });

    window.addEventListener("hd189b:telemetry", function (event) {
      var d = event.detail || {};
      if (fieldMap.phase) fieldMap.phase.textContent = d.phase + "%";
      if (fieldMap.event) fieldMap.event.textContent = d.event;
      if (fieldMap.flux) fieldMap.flux.textContent = d.flux + "%";
    });
  }

  /* ------------------------------ command-k search ------------------------------ */

  (function () {
    var overlay = document.getElementById("search-overlay");
    var input = document.getElementById("search-input");
    var resultsEl = document.getElementById("search-results");
    var scopeBadge = document.getElementById("search-scope-badge");
    var trigger = document.querySelector(".search-trigger");
    if (!overlay || !input || !resultsEl) return;

    var scope = document.body.getAttribute("data-search-scope") || "all";
    var section = document.body.getAttribute("data-search-section") || "";
    var indexUrl = document.body.getAttribute("data-search-index") || "/index.json";

    var indexData = null;
    var indexPromise = null;
    var activeIndex = -1;
    var currentResults = [];
    var lastFocused = null;

    if (scopeBadge) {
      scopeBadge.textContent = scope === "section" && section ? section : "everything";
    }

    function escapeHtml(s) {
      return s.replace(/[&<>"']/g, function (c) {
        return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
      });
    }

    function escapeRegExp(s) {
      return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }

    function loadIndex() {
      if (indexPromise) return indexPromise;
      indexPromise = fetch(indexUrl)
        .then(function (res) {
          return res.ok ? res.json() : [];
        })
        .then(function (data) {
          indexData = Array.isArray(data) ? data : [];
          return indexData;
        })
        .catch(function () {
          indexData = [];
          return indexData;
        });
      return indexPromise;
    }

    /* a query wrapped in /pattern/flags is treated as a real regex (grep-style);
       anything else is a plain, case-insensitive substring match */
    function buildMatcher(query) {
      var m = /^\/(.+)\/([a-z]*)$/i.exec(query.trim());
      if (m) {
        try {
          var flags = m[2].toLowerCase().indexOf("i") === -1 ? m[2] + "i" : m[2];
          var re = new RegExp(m[1], flags);
          return function (text) {
            re.lastIndex = 0;
            return re.test(text);
          };
        } catch (e) {
          /* invalid regex -- fall through to plain substring matching */
        }
      }
      var needle = query.trim().toLowerCase();
      if (!needle) return null;
      return function (text) {
        return text.toLowerCase().indexOf(needle) !== -1;
      };
    }

    function bareNeedle(query) {
      return query.replace(/^\/|\/[a-z]*$/gi, "").trim();
    }

    function snippetFor(text, query) {
      var plain = text.replace(/\s+/g, " ").trim();
      var needle = bareNeedle(query);
      var idx = needle ? plain.toLowerCase().indexOf(needle.toLowerCase()) : -1;
      var start = idx > 40 ? idx - 40 : 0;
      var snippet = plain.slice(start, start + 160);
      if (start > 0) snippet = "…" + snippet;
      if (start + 160 < plain.length) snippet = snippet + "…";
      return snippet || plain.slice(0, 160);
    }

    function highlight(text, query) {
      var escaped = escapeHtml(text || "");
      var needle = bareNeedle(query);
      if (!needle) return escaped;
      try {
        var re = new RegExp(escapeRegExp(needle), "ig");
        return escaped.replace(re, function (m) {
          return "<mark>" + m + "</mark>";
        });
      } catch (e) {
        return escaped;
      }
    }

    function renderEmpty(message) {
      resultsEl.innerHTML = '<p class="search-empty">' + message + "</p>";
      currentResults = [];
      activeIndex = -1;
    }

    function rowsHtml(items, query, withSection) {
      return items
        .map(function (item, i) {
          var titleHtml = item.title ? '<span class="search-result-title">' + highlight(item.title, query) + "</span>" : "";
          var head = withSection
            ? '<div class="search-result-head">' +
              titleHtml +
              '<span class="search-result-section">' +
              escapeHtml(item.section || "") +
              "</span></div>"
            : "";
          return (
            '<div class="search-result' +
            (i === 0 ? " is-active" : "") +
            '" role="option" data-index="' +
            i +
            '">' +
            head +
            '<p class="search-result-snippet">' +
            highlight(item.snippet, query) +
            "</p></div>"
          );
        })
        .join("");
    }

    function renderList(items, query, withSection) {
      currentResults = items;
      activeIndex = items.length ? 0 : -1;
      if (!items.length) {
        renderEmpty("no matches. try different terms.");
        return;
      }
      resultsEl.innerHTML = rowsHtml(items, query, withSection);
    }

    function searchIndex(query) {
      var pool = (indexData || []).filter(function (p) {
        return scope !== "section" || p.section === section;
      });
      var matcher = buildMatcher(query);
      if (!matcher) {
        renderList(
          pool.slice(0, 8).map(function (p) {
            return {
              title: p.title || "",
              section: p.section,
              permalink: p.permalink,
              snippet: (p.content || "").replace(/\s+/g, " ").trim().slice(0, 160),
            };
          }),
          "",
          true
        );
        return;
      }
      var found = [];
      for (var i = 0; i < pool.length && found.length < 30; i++) {
        var p = pool[i];
        var haystack = (p.title || "") + " " + (p.tags || []).join(" ") + " " + (p.content || "");
        if (matcher(haystack)) {
          found.push({
            title: p.title || "",
            section: p.section,
            permalink: p.permalink,
            snippet: snippetFor(p.content || p.title || "", query),
          });
        }
      }
      renderList(found, query, true);
    }

    function runQuery(query) {
      loadIndex().then(function () {
        searchIndex(query);
      });
    }

    function activateResult(item) {
      if (item && item.permalink) {
        window.location.href = item.permalink;
      }
    }

    function setActive(index) {
      var rows = resultsEl.querySelectorAll(".search-result");
      rows.forEach(function (row) {
        row.classList.remove("is-active");
      });
      if (rows[index]) {
        rows[index].classList.add("is-active");
        rows[index].scrollIntoView({ block: "nearest" });
      }
      activeIndex = index;
    }

    resultsEl.addEventListener("click", function (event) {
      var row = event.target.closest(".search-result");
      if (!row) return;
      activateResult(currentResults[Number(row.getAttribute("data-index"))]);
    });

    input.addEventListener("input", function () {
      runQuery(input.value);
    });

    function openSearch() {
      lastFocused = document.activeElement;
      overlay.hidden = false;
      document.body.classList.add("search-open");
      input.value = "";
      runQuery("");
      setTimeout(function () {
        input.focus();
      }, 0);
    }

    function closeSearch() {
      overlay.hidden = true;
      document.body.classList.remove("search-open");
      if (lastFocused && lastFocused.focus) lastFocused.focus();
    }

    function toggleSearch() {
      if (overlay.hidden) openSearch();
      else closeSearch();
    }

    if (trigger) trigger.addEventListener("click", openSearch);

    overlay.addEventListener("mousedown", function (event) {
      if (event.target === overlay) closeSearch();
    });

    document.addEventListener("keydown", function (event) {
      var isK = event.key === "k" || event.key === "K";
      if ((event.ctrlKey || event.metaKey) && isK) {
        event.preventDefault();
        toggleSearch();
        return;
      }
      if (overlay.hidden) return;

      if (event.key === "Escape") {
        event.preventDefault();
        closeSearch();
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        if (currentResults.length) setActive((activeIndex + 1) % currentResults.length);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        if (currentResults.length) setActive((activeIndex - 1 + currentResults.length) % currentResults.length);
      } else if (event.key === "Enter") {
        event.preventDefault();
        activateResult(currentResults[activeIndex]);
      }
    });
  })();

  /* --------------------------- HD 189733 system canvas ---------------------------- */

  var canvas = document.getElementById("orbit-canvas");
  if (!canvas || !canvas.getContext) {
    return;
  }

  var ctx = canvas.getContext("2d");
  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var darkMode = window.matchMedia("(prefers-color-scheme: dark)");

  var width = 0;
  var height = 0;
  var dpr = Math.min(window.devicePixelRatio || 1, 2);
  var stars = [];
  var rainStreaks = [];
  var flares = [];
  var t = 0;
  var rafId = null;
  var lastTelemetryAt = 0;
  var lastFlareCheck = 0;

  var ORBIT_MS = 9000; // one full loop of HD 189733 b, stylised (real period is 2.2 days)
  var TRANSIT_DEPTH = 2.4; // %, matches the real, unusually deep transit of HD 189733 b

  function palette() {
    return darkMode.matches
      ? {
          bg: "#05070d",
          star: "255, 255, 255",
          hostStar: "255, 177, 92",
          hostCore: "#fff3d6",
          companion: "255, 120, 96",
          planetDay: "#bfe0ff",
          planetMid: "#4f9dff",
          planetEdge: "#1e6fff",
          planetNight: "8, 14, 34",
          glow: "87, 168, 255",
        }
      : {
          bg: "#f4f6fb",
          star: "70, 90, 130",
          hostStar: "226, 121, 10",
          hostCore: "#fff0da",
          companion: "205, 90, 70",
          planetDay: "#eaf5ff",
          planetMid: "#4f9dff",
          planetEdge: "#1e6fff",
          planetNight: "18, 26, 48",
          glow: "30, 111, 255",
        };
  }

  function resize() {
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = width + "px";
    canvas.style.height = height + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    seed();
  }

  function seed() {
    var count = Math.min(150, Math.round((width * height) / 9500));
    stars = [];
    for (var i = 0; i < count; i++) {
      stars.push({
        x: Math.random() * width,
        y: Math.random() * height,
        r: Math.random() * 1.3 + 0.3,
        phase: Math.random() * Math.PI * 2,
        speed: 0.4 + Math.random() * 0.8,
      });
    }

    rainStreaks = [];
    var streakCount = Math.min(26, Math.round(width / 60));
    for (var j = 0; j < streakCount; j++) {
      rainStreaks.push({
        x: Math.random() * width,
        y: Math.random() * height,
        len: 8 + Math.random() * 16,
        speed: 1 + Math.random() * 1.8,
      });
    }
  }

  function drawStarfield(p) {
    for (var i = 0; i < stars.length; i++) {
      var s = stars[i];
      var alpha = reduceMotion ? 0.55 : 0.35 + 0.45 * Math.abs(Math.sin(t * 0.0006 * s.speed + s.phase));
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(" + p.star + ", " + alpha.toFixed(3) + ")";
      ctx.fill();
    }
  }

  function drawCompanion(p, cx, cy) {
    var twinkle = reduceMotion ? 0.6 : 0.5 + 0.25 * Math.sin(t * 0.0009);
    ctx.save();
    var glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, 22);
    glow.addColorStop(0, "rgba(" + p.companion + ", " + (0.3 * twinkle).toFixed(3) + ")");
    glow.addColorStop(1, "rgba(" + p.companion + ", 0)");
    ctx.fillStyle = glow;
    ctx.fillRect(cx - 22, cy - 22, 44, 44);
    ctx.beginPath();
    ctx.arc(cx, cy, 2.4, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(" + p.companion + ", " + twinkle.toFixed(3) + ")";
    ctx.fill();
    ctx.restore();
  }

  function drawHostStar(p, hostX, hostY, starR, dip) {
    var alpha = 1 - dip * 0.35;
    ctx.save();

    /* magnetic flares -- HD 189733 A is an active, flaring K dwarf */
    for (var i = 0; i < flares.length; i++) {
      var f = flares[i];
      var progress = (t - f.start) / f.duration;
      if (progress >= 1) continue;
      var flareAlpha = (1 - progress) * 0.8;
      var flareLen = starR * (1.4 + progress * 1.8);
      var fx = hostX + Math.cos(f.angle) * starR * 0.9;
      var fy = hostY + Math.sin(f.angle) * starR * 0.9;
      var fx2 = hostX + Math.cos(f.angle) * (starR * 0.9 + flareLen);
      var fy2 = hostY + Math.sin(f.angle) * (starR * 0.9 + flareLen);
      ctx.strokeStyle = "rgba(" + p.hostStar + ", " + flareAlpha.toFixed(3) + ")";
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(fx, fy);
      ctx.lineTo(fx2, fy2);
      ctx.stroke();
    }

    var haloR = starR * 7;
    var halo = ctx.createRadialGradient(hostX, hostY, 0, hostX, hostY, haloR);
    halo.addColorStop(0, "rgba(" + p.hostStar + ", " + (0.4 * alpha).toFixed(3) + ")");
    halo.addColorStop(1, "rgba(" + p.hostStar + ", 0)");
    ctx.fillStyle = halo;
    ctx.fillRect(hostX - haloR, hostY - haloR, haloR * 2, haloR * 2);

    var body = ctx.createRadialGradient(hostX, hostY, 0, hostX, hostY, starR);
    body.addColorStop(0, p.hostCore);
    body.addColorStop(1, "rgba(" + p.hostStar + ", " + alpha.toFixed(3) + ")");
    ctx.beginPath();
    ctx.arc(hostX, hostY, starR, 0, Math.PI * 2);
    ctx.fillStyle = body;
    ctx.fill();
    ctx.restore();
  }

  function drawPlanet(p, x, y, r, alpha, illumAngle) {
    if (alpha <= 0.02) return;
    ctx.save();
    ctx.globalAlpha = alpha;

    /* atmospheric limb glow -- the cobalt scattering this planet is known for */
    var glowR = r * 2.6;
    var glow = ctx.createRadialGradient(x, y, r * 0.5, x, y, glowR);
    glow.addColorStop(0, "rgba(" + p.glow + ", 0.4)");
    glow.addColorStop(1, "rgba(" + p.glow + ", 0)");
    ctx.fillStyle = glow;
    ctx.fillRect(x - glowR, y - glowR, glowR * 2, glowR * 2);

    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.clip();

    /* base sphere shading */
    var sphere = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.1, x, y, r * 1.05);
    sphere.addColorStop(0, p.planetDay);
    sphere.addColorStop(0.55, p.planetMid);
    sphere.addColorStop(1, p.planetEdge);
    ctx.fillStyle = sphere;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);

    /* tidally-locked day/night terminator, oriented toward the host star */
    var gx0 = x - Math.cos(illumAngle) * r;
    var gy0 = y - Math.sin(illumAngle) * r;
    var gx1 = x + Math.cos(illumAngle) * r;
    var gy1 = y + Math.sin(illumAngle) * r;
    var term = ctx.createLinearGradient(gx0, gy0, gx1, gy1);
    term.addColorStop(0, "rgba(" + p.planetNight + ", 0.92)");
    term.addColorStop(0.46, "rgba(" + p.planetNight + ", 0.5)");
    term.addColorStop(0.58, "rgba(" + p.planetNight + ", 0)");
    term.addColorStop(1, "rgba(" + p.planetNight + ", 0)");
    ctx.fillStyle = term;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);

    /* fast silicate-glass wind bands, ~2km/s, streaking across the dayside */
    ctx.strokeStyle = "rgba(255,255,255,0.16)";
    ctx.lineWidth = Math.max(1, r * 0.05);
    for (var band = -2; band <= 2; band++) {
      var by = y + band * r * 0.32;
      var shift = ((t * 0.35 + band * 260) % (r * 4)) - r * 2;
      ctx.beginPath();
      ctx.moveTo(x - r + shift, by - r * 0.12);
      ctx.quadraticCurveTo(x + shift * 0.2, by + r * 0.1, x + r + shift, by - r * 0.12);
      ctx.stroke();
    }

    /* glassy specular highlight on the lit limb */
    var hlx = x + Math.cos(illumAngle) * r * 0.45;
    var hly = y + Math.sin(illumAngle) * r * 0.45;
    var hl = ctx.createRadialGradient(hlx, hly, 0, hlx, hly, r * 0.6);
    hl.addColorStop(0, "rgba(255,255,255,0.35)");
    hl.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = hl;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);

    ctx.restore();
  }

  function draw(time) {
    var p = palette();
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = p.bg;
    ctx.fillRect(0, 0, width, height);

    drawStarfield(p);
    drawCompanion(p, width * 0.9, height * 0.14);

    var hostX = Math.max(width * 0.22, 120);
    var hostY = height * 0.5;
    var starR = Math.max(7, Math.min(width, height) * 0.014);

    var a = Math.min(hostX - 20, Math.min(width, height) * 0.18);
    var b = a * 0.15;
    var planetR = Math.max(15, Math.min(width, height) * 0.026);

    var angle = reduceMotion ? 4.6 : ((time % ORBIT_MS) / ORBIT_MS) * Math.PI * 2;
    var planetX = hostX + Math.cos(angle) * a;
    var planetY = hostY + Math.sin(angle) * b;
    var dx = planetX - hostX;
    var dy = planetY - hostY;
    var dist = Math.sqrt(dx * dx + dy * dy);

    var behindStar = Math.sin(angle) > 0;
    var closeness = Math.max(0, Math.min(1, 1 - dist / (starR + planetR * 1.3)));
    var transitDip = !behindStar ? closeness : 0;
    var planetAlpha = behindStar ? Math.max(0, Math.min(1, dist / (planetR * 1.1))) : 1;
    var illumAngle = Math.atan2(hostY - planetY, hostX - planetX);

    if (behindStar) {
      drawPlanet(p, planetX, planetY, planetR, planetAlpha, illumAngle);
      drawHostStar(p, hostX, hostY, starR, 0);
    } else {
      drawHostStar(p, hostX, hostY, starR, transitDip);
      drawPlanet(p, planetX, planetY, planetR, planetAlpha, illumAngle);
    }

    /* faint ambient glass-rain drifting through the foreground */
    ctx.save();
    ctx.strokeStyle = "rgba(" + p.glow + ", 0.16)";
    ctx.lineWidth = 1;
    for (var k = 0; k < rainStreaks.length; k++) {
      var r2 = rainStreaks[k];
      var rx = reduceMotion ? r2.x : (r2.x + time * 0.05 * r2.speed) % (width + 40);
      ctx.beginPath();
      ctx.moveTo(rx, r2.y);
      ctx.lineTo(rx - r2.len, r2.y + r2.len * 0.35);
      ctx.stroke();
    }
    ctx.restore();

    /* occasional flare ignition */
    if (!reduceMotion && time - lastFlareCheck > 400) {
      lastFlareCheck = time;
      if (flares.length < 2 && Math.random() < 0.35) {
        flares.push({ start: time, duration: 700 + Math.random() * 500, angle: Math.random() * Math.PI * 2 });
      }
      flares = flares.filter(function (f) {
        return time - f.start < f.duration;
      });
    }

    /* telemetry, throttled */
    if (time - lastTelemetryAt > 220 || reduceMotion) {
      lastTelemetryAt = time;
      var phasePercent = Math.round((angle / (Math.PI * 2)) * 100);
      var eventLabel = "in orbit";
      var fluxPercent = "100.0";
      if (!behindStar && closeness > 0.3) {
        eventLabel = "transit";
        fluxPercent = (100 - closeness * TRANSIT_DEPTH).toFixed(1);
      } else if (behindStar && closeness > 0.3) {
        eventLabel = "occulted";
      }
      window.dispatchEvent(
        new CustomEvent("hd189b:telemetry", {
          detail: { phase: phasePercent, event: eventLabel, flux: fluxPercent },
        })
      );
    }
  }

  function frame(time) {
    t = time;
    draw(time);
    if (!reduceMotion && !document.hidden) {
      rafId = requestAnimationFrame(frame);
    }
  }

  var resizeTimer = null;
  window.addEventListener("resize", function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(resize, 150);
  });

  document.addEventListener("visibilitychange", function () {
    if (document.hidden) {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = null;
    } else if (!reduceMotion && rafId === null) {
      rafId = requestAnimationFrame(frame);
    }
  });

  if (darkMode.addEventListener) {
    darkMode.addEventListener("change", function () {
      draw(t);
    });
  }

  resize();

  if (reduceMotion) {
    draw(0);
  } else {
    rafId = requestAnimationFrame(frame);
  }
})();
