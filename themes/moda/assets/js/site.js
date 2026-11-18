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
      if (fieldMap.next && d.next) fieldMap.next.textContent = d.next;
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
  /*
   * A stylised but physically-informed view of the HD 189733 system:
   *  - HD 189733 A: an active K1.5 dwarf -- limb-darkened, granulated, spotted, flaring.
   *  - HD 189733 b: a tidally-locked, cobalt-blue hot Jupiter on a 2.2-day orbit,
   *    rendered per-pixel as a lit sphere: a procedural cloud-band texture with
   *    zonal jets and storms, starlight from the true 3D direction (so it shows
   *    phases and a dark silhouette in transit), a hot spot ~30 deg east of noon,
   *    a faint red thermal glow on the ~700 C nightside, blue limb haze and an
   *    atmosphere ring that lights up when backlit. Its real radius ratio
   *    (Rp/R* ~ 0.155) and impact parameter (~0.66) set the transit chord, and
   *    its escaping hydrogen atmosphere trails behind it as a tail.
   *  - HD 189733 B: the distant M-dwarf companion.
   *  - An inset light curve plots the transit dip as it happens.
   */

  var canvas = document.getElementById("orbit-canvas");
  if (!canvas || !canvas.getContext) {
    return;
  }

  var ctx = canvas.getContext("2d");
  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  var width = 0;
  var height = 0;
  var dpr = Math.min(window.devicePixelRatio || 1, 2);
  var sky = null;
  var gran = null;
  var twinklers = [];
  var spots = [];
  var flares = [];
  var gas = [];
  var curve = [];
  var L = null;
  var t = 0;
  var lastFrameAt = 0;
  var rafId = null;
  var lastTelemetryAt = 0;
  var lastFlareCheck = 0;

  var TAU = Math.PI * 2;
  var ORBIT_MS = 16000; // one stylised orbit (real period: 2.2 days)
  var PERIOD_H = 2.21857 * 24; // real orbital period, hours
  var TRANSIT_DEPTH = 2.4; // %, the real, unusually deep transit
  var RP_RS = 0.155; // real planet/star radius ratio
  var PLANET_BOOST = 1.7; // planet drawn larger than true scale so its detail reads
  var IMPACT = 0.66; // real transit impact parameter, in stellar radii
  var A_RS = 4.4; // orbit size in stellar radii (real ~8.8, halved to fit the screen)
  var TILT = -0.1; // orbit tilt on screen, radians
  var CURVE_WINDOW = 0.16; // half-width, in orbital phase, of the light-curve inset
  var STATIC_ANGLE = Math.PI / 2 - 0.09; // reduced-motion frame: mid-transit
  var HOTSPOT_LON = -0.52; // ~30 deg east of the sub-stellar point
  var SIDEBAR_W = 290; // fixed telemetry sidebar on very wide screens (see style.css)

  var C = {
    bg: "#05070d",
    starCore: "#fff7ea",
    starMid: "255, 200, 128",
    starEdge: "226, 112, 48",
    corona: "255, 168, 88",
    spot: "92, 36, 12",
    companion: "255, 110, 90",
    glow: "87, 168, 255",
    hud: "154, 167, 199",
  };

  var STAR_TINTS = ["255, 255, 255", "205, 222, 255", "255, 238, 214", "255, 214, 176", "184, 204, 255"];

  function gauss() {
    return (Math.random() + Math.random() + Math.random() - 1.5) / 1.5;
  }

  function computeLayout() {
    var narrow = width < 760;
    var unit = Math.min(width, height);
    var R = narrow ? Math.max(24, unit * 0.07) : Math.max(34, Math.min(unit * 0.085, 90));
    var maxA = narrow ? width * 0.42 : width * 0.27;
    if (R * A_RS > maxA) R = maxA / A_RS;
    var a = R * A_RS;
    var x = narrow ? width * 0.5 : width * 0.7;
    if (width >= 1500) x = Math.min(x, width - SIDEBAR_W - a);
    return {
      narrow: narrow,
      R: R,
      a: a,
      b: R * IMPACT,
      rp: Math.max(narrow ? 8 : 11, R * RP_RS * PLANET_BOOST),
      x: x,
      y: narrow ? Math.max(height * 0.22, R * 2 + 70) : height * 0.4,
      fade: narrow ? 0.55 : 1,
    };
  }

  function orbitPoint(angle) {
    var ox = Math.cos(angle) * L.a;
    var oy = Math.sin(angle) * L.b;
    var c = Math.cos(TILT);
    var s = Math.sin(TILT);
    return { x: L.x + ox * c - oy * s, y: L.y + ox * s + oy * c, front: Math.sin(angle) > 0 };
  }

  function phaseOf(angle) {
    var ph = (angle - Math.PI / 2) / TAU;
    return ph - Math.floor(ph); // 0 = mid-transit
  }

  /* area of overlap between two discs, radii R and r, centres d apart */
  function overlapArea(d, R, r) {
    if (d >= R + r) return 0;
    if (d <= Math.abs(R - r)) return Math.PI * Math.min(R, r) * Math.min(R, r);
    var r2 = r * r;
    var R2 = R * R;
    var a1 = r2 * Math.acos((d * d + r2 - R2) / (2 * d * r));
    var a2 = R2 * Math.acos((d * d + R2 - r2) / (2 * d * R));
    var a3 = 0.5 * Math.sqrt((-d + r + R) * (d + r - R) * (d - r + R) * (d + r + R));
    return a1 + a2 - a3;
  }

  /* relative flux (%) with simple linear limb darkening, normalised to the real depth */
  function fluxAt(angle) {
    if (Math.sin(angle) <= 0) return 100;
    var dx = Math.cos(angle) * L.a;
    var dy = Math.sin(angle) * L.b;
    var d = Math.sqrt(dx * dx + dy * dy);
    var covered = overlapArea(d, L.R, L.rp) / (Math.PI * L.rp * L.rp);
    if (covered <= 0) return 100;
    var mu = Math.sqrt(Math.max(0, 1 - (d / L.R) * (d / L.R)));
    var mu0 = Math.sqrt(1 - IMPACT * IMPACT);
    var limb = (0.55 + 0.45 * mu) / (0.55 + 0.45 * mu0);
    return 100 - TRANSIT_DEPTH * covered * limb;
  }

  function buildCurve() {
    curve = [];
    var n = 220;
    for (var i = 0; i <= n; i++) {
      var ph = -CURVE_WINDOW + (2 * CURVE_WINDOW * i) / n;
      curve.push({ ph: ph, flux: fluxAt(Math.PI / 2 + ph * TAU) });
    }
  }

  function nebula(s, x, y, r, rgb, alpha) {
    var g = s.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, "rgba(" + rgb + ", " + alpha + ")");
    g.addColorStop(1, "rgba(" + rgb + ", 0)");
    s.fillStyle = g;
    s.fillRect(x - r, y - r, r * 2, r * 2);
  }

  /* ------------------------- planet surface texture -------------------------- */

  var TEX_W = 256;
  var TEX_H = 128;
  var tex = null;

  function hash3(x, y, z) {
    var h = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
    return h - Math.floor(h);
  }

  function vnoise(x, y, z) {
    var xi = Math.floor(x);
    var yi = Math.floor(y);
    var zi = Math.floor(z);
    var xf = x - xi;
    var yf = y - yi;
    var zf = z - zi;
    var u = xf * xf * (3 - 2 * xf);
    var v = yf * yf * (3 - 2 * yf);
    var w = zf * zf * (3 - 2 * zf);
    function lerp(p, q, s) {
      return p + (q - p) * s;
    }
    var x00 = lerp(hash3(xi, yi, zi), hash3(xi + 1, yi, zi), u);
    var x10 = lerp(hash3(xi, yi + 1, zi), hash3(xi + 1, yi + 1, zi), u);
    var x01 = lerp(hash3(xi, yi, zi + 1), hash3(xi + 1, yi, zi + 1), u);
    var x11 = lerp(hash3(xi, yi + 1, zi + 1), hash3(xi + 1, yi + 1, zi + 1), u);
    return lerp(lerp(x00, x10, v), lerp(x01, x11, v), w);
  }

  function fbm(x, y, z, octaves) {
    var sum = 0;
    var amp = 0.5;
    var norm = 0;
    for (var o = 0; o < octaves; o++) {
      sum += amp * vnoise(x, y, z);
      norm += amp;
      x *= 2.03;
      y *= 2.03;
      z *= 2.03;
      amp *= 0.5;
    }
    return sum / norm;
  }

  /* Equirectangular albedo map: hazy cobalt cloud bands, distorted by turbulence,
     a bright equatorial jet, a few long-lived storms and darker poles. Sampled on
     the sphere (3D noise) so there's no seam. Built once. */
  function buildPlanetTexture() {
    tex = new Float32Array(TEX_W * TEX_H * 3);
    var storms = [
      { lon: 1.3, lat: 0.42, rx: 0.42, ry: 0.11, amp: 0.45 },
      { lon: 4.1, lat: -0.3, rx: 0.3, ry: 0.08, amp: -0.35 },
      { lon: 2.7, lat: -0.62, rx: 0.25, ry: 0.07, amp: 0.3 },
    ];
    for (var j = 0; j < TEX_H; j++) {
      var lat = (0.5 - (j + 0.5) / TEX_H) * Math.PI;
      var cl = Math.cos(lat);
      var sl = Math.sin(lat);
      for (var i = 0; i < TEX_W; i++) {
        var lon = ((i + 0.5) / TEX_W) * TAU;
        var cx = Math.cos(lon) * cl;
        var cy = Math.sin(lon) * cl;
        var cz = sl;
        var warp = fbm(cx * 2.2 + 5.2, cy * 2.2, cz * 5, 4);
        var turb = fbm(cx * 7 + 1.7 + warp, cy * 7, cz * 16 + 3.1, 5);
        var fine = fbm(cx * 18, cy * 18 + 2.3, cz * 30, 3);
        var band = 0.5 + 0.5 * Math.sin(lat * 17 + (warp - 0.5) * 8 + (turb - 0.5) * 2.5);
        var v = band * 0.5 + turb * 0.35 + fine * 0.15;
        v = v * v * 1.6;

        for (var s = 0; s < storms.length; s++) {
          var st = storms[s];
          var dl = lon - st.lon;
          dl = dl - TAU * Math.round(dl / TAU);
          var d = (dl / st.rx) * (dl / st.rx) + ((lat - st.lat) / st.ry) * ((lat - st.lat) / st.ry);
          if (d < 1) v += st.amp * (1 - d) * (1 - d) * (0.7 + 0.6 * turb);
        }

        var eq = Math.exp(-lat * lat * 14);
        var pole = Math.pow(Math.abs(sl), 3);
        var k = (j * TEX_W + i) * 3;
        var dim = 1 - 0.4 * pole;
        tex[k] = (0.015 + 0.06 * v + 0.03 * eq) * dim;
        tex[k + 1] = (0.07 + 0.2 * v + 0.07 * eq) * dim;
        tex[k + 2] = (0.32 + 0.5 * v + 0.12 * eq) * dim;
      }
    }
  }

  var pcan = document.createElement("canvas");
  var pctx = pcan.getContext("2d");
  var pimg = null;

  /* Renders the planet into pcan, `rpx` device pixels in radius. Works in the
     un-tilted orbit frame (x right, y up, z toward the viewer): the orbit is
     P(angle) = a (cos U + sin V) with U = (1,0,0), V = (0,-k,s). */
  function renderPlanet(angle, rpx, time) {
    var atmH = 0.07 + 1.4 / rpx;
    var pad = Math.ceil(rpx * atmH) + 2;
    var size = Math.ceil(rpx * 2) + pad * 2;
    if (pcan.width !== size) {
      pcan.width = size;
      pcan.height = size;
      pimg = pctx.createImageData(size, size);
    }
    var data = pimg.data;
    var c = size / 2;

    var k = L.b / L.a;
    var s = Math.sqrt(1 - k * k);
    var ca = Math.cos(angle);
    var sa = Math.sin(angle);
    var lx = -ca;
    var ly = sa * k;
    var lz = -sa * s; // unit vector toward the star
    var mx = -sa;
    var my = -ca * k;
    var mz = ca * s; // direction of orbital motion
    var ny = -s;
    var nzO = -k; // orbit normal (x component is 0)
    var cosT = Math.cos(TILT);
    var sinT = Math.sin(TILT);
    var spin = reduceMotion ? 0 : time * 0.00005;
    var backlit = lz < 0 ? Math.pow(-lz, 4) : 0;
    var outer = 1 + atmH;

    for (var py = 0; py < size; py++) {
      for (var px = 0; px < size; px++) {
        var idx = (py * size + px) * 4;
        var sx = (px + 0.5 - c) / rpx;
        var sy = (py + 0.5 - c) / rpx;
        var ux = sx * cosT + sy * sinT;
        var uy = -(-sx * sinT + sy * cosT);
        var r2 = ux * ux + uy * uy;
        if (r2 >= outer * outer) {
          data[idx + 3] = 0;
          continue;
        }
        var r = Math.sqrt(r2);

        /* atmosphere: thin limb glow, strong when backlit (transit) */
        var limbMu0 = r > 0 ? (ux * lx + uy * ly) / r : 0;
        var fall = r >= 1 ? Math.exp((-(r - 1) / atmH) * 3) : 1;
        var atm = fall * (0.3 * Math.max(0, limbMu0 + 0.25) + 1.1 * backlit);

        if (r >= 1) {
          var ai = Math.min(1, atm);
          data[idx] = 120;
          data[idx + 1] = 180;
          data[idx + 2] = 255;
          data[idx + 3] = ai * 255;
          continue;
        }

        var nz = Math.sqrt(1 - r2);
        var mu0 = ux * lx + uy * ly + nz * lz;
        var xb = mu0;
        var yb = ux * mx + uy * my + nz * mz;
        var zb = uy * ny + nz * nzO;
        var lat = Math.asin(Math.max(-1, Math.min(1, zb)));
        var lon = Math.atan2(yb, xb);

        /* super-rotating winds: equatorial jet fastest */
        var tl = lon + spin * (1 + 1.8 * Math.exp(-lat * lat * 9));
        var fu = (tl / TAU) * TEX_W;
        fu = fu - TEX_W * Math.floor(fu / TEX_W);
        var fv = (0.5 - lat / Math.PI) * TEX_H - 0.5;
        if (fv < 0) fv = 0;
        if (fv > TEX_H - 1.001) fv = TEX_H - 1.001;
        var i0 = Math.floor(fu);
        var j0 = Math.floor(fv);
        var du = fu - i0;
        var dv = fv - j0;
        var i1 = (i0 + 1) % TEX_W;
        var k00 = (j0 * TEX_W + i0) * 3;
        var k10 = (j0 * TEX_W + i1) * 3;
        var k01 = ((j0 + 1) * TEX_W + i0) * 3;
        var k11 = ((j0 + 1) * TEX_W + i1) * 3;
        var w00 = (1 - du) * (1 - dv);
        var w10 = du * (1 - dv);
        var w01 = (1 - du) * dv;
        var w11 = du * dv;
        var ar = tex[k00] * w00 + tex[k10] * w10 + tex[k01] * w01 + tex[k11] * w11;
        var ag = tex[k00 + 1] * w00 + tex[k10 + 1] * w10 + tex[k01 + 1] * w01 + tex[k11 + 1] * w11;
        var ab = tex[k00 + 2] * w00 + tex[k10 + 2] * w10 + tex[k01 + 2] * w01 + tex[k11 + 2] * w11;

        /* reflected K-star light, soft terminator, mild limb darkening */
        var lit = mu0 > -0.08 ? Math.pow((mu0 + 0.08) / 1.08, 0.85) : 0;
        var limb = Math.pow(nz, 0.3);
        var I = lit * limb * 1.7;
        var cr = ar * I;
        var cg = ag * I * 0.9;
        var cb = ab * I * 0.78;

        /* blue scattering haze toward the limb on the day side */
        var haze = Math.pow(1 - nz, 2.2) * (lit > 0 ? 0.4 + 0.6 * lit : 0);
        cr += 0.02 * haze;
        cg += 0.12 * haze;
        cb += 0.4 * haze;

        /* thermal glow: dull red night side, warmer near the shifted hot spot */
        var hs = Math.cos(lon - HOTSPOT_LON) * Math.cos(lat);
        var heat = (0.035 + 0.05 * (hs > 0 ? hs * hs : 0)) * (1 - Math.min(1, lit * 2.5));
        cr += heat * 0.6;
        cg += heat * 0.1;
        cb += heat * 0.04;

        /* backlit atmosphere ring seen just inside the limb */
        var ring = atm * Math.pow(1 - nz, 4);
        cr += ring * 0.15;
        cg += ring * 0.35;
        cb += ring * 0.7;

        var edge = Math.min(1, (1 - r) * rpx + 0.5);
        data[idx] = 255 * (1 - Math.exp(-cr * 2.2));
        data[idx + 1] = 255 * (1 - Math.exp(-cg * 2.2));
        data[idx + 2] = 255 * (1 - Math.exp(-cb * 2.2));
        data[idx + 3] = 255 * Math.max(edge, Math.min(1, atm));
      }
    }
    pctx.putImageData(pimg, 0, 0);
    return size;
  }

  /* ------------------------------- sky & star -------------------------------- */

  /* static sky: nebula haze, a faint galactic band and the dim star field, rendered once per resize */
  function buildSky() {
    sky = document.createElement("canvas");
    sky.width = canvas.width;
    sky.height = canvas.height;
    var s = sky.getContext("2d");
    s.setTransform(dpr, 0, 0, dpr, 0, 0);
    var unit = Math.max(width, height);

    s.fillStyle = C.bg;
    s.fillRect(0, 0, width, height);

    nebula(s, width * 0.78, height * 0.32, unit * 0.55, "52, 84, 200", 0.11);
    nebula(s, width * 0.12, height * 0.88, unit * 0.5, "110, 56, 170", 0.07);
    nebula(s, width * 0.55, height * 0.78, unit * 0.4, "255, 140, 70", 0.03);

    /* galactic band, bottom-left to top-right */
    var x0 = -0.1 * width;
    var y0 = 0.98 * height;
    var x1 = 1.1 * width;
    var y1 = 0.02 * height;
    var len = Math.sqrt((x1 - x0) * (x1 - x0) + (y1 - y0) * (y1 - y0));
    var nx = -(y1 - y0) / len;
    var ny = (x1 - x0) / len;
    var spread = Math.min(width, height) * 0.13;

    for (var k = 0; k <= 10; k++) {
      var f = k / 10;
      nebula(s, x0 + (x1 - x0) * f, y0 + (y1 - y0) * f, spread * 2.2, "150, 170, 230", 0.035);
    }

    var bandCount = Math.min(1100, Math.round((width * height) / 1300));
    for (var i = 0; i < bandCount; i++) {
      var p = Math.random();
      var off = gauss() * spread;
      var bx = x0 + (x1 - x0) * p + nx * off;
      var by = y0 + (y1 - y0) * p + ny * off;
      s.fillStyle = "rgba(" + STAR_TINTS[i % STAR_TINTS.length] + ", " + (0.12 + Math.random() * 0.35).toFixed(2) + ")";
      s.fillRect(bx, by, 0.6 + Math.random() * 0.7, 0.6 + Math.random() * 0.7);
    }

    var fieldCount = Math.min(320, Math.round((width * height) / 4500));
    for (var j = 0; j < fieldCount; j++) {
      s.beginPath();
      s.arc(Math.random() * width, Math.random() * height, Math.random() * 0.9 + 0.25, 0, TAU);
      s.fillStyle = "rgba(" + STAR_TINTS[j % STAR_TINTS.length] + ", " + (0.25 + Math.random() * 0.45).toFixed(2) + ")";
      s.fill();
    }
  }

  /* convective granulation, laid over the photosphere and turned slowly with the star */
  function buildGranulation() {
    var R = L.R;
    var size = Math.ceil(R * 2 * dpr);
    gran = document.createElement("canvas");
    gran.width = size;
    gran.height = size;
    var g = gran.getContext("2d");
    g.scale(dpr, dpr);
    var count = Math.round(R * R * 0.6);
    for (var i = 0; i < count; i++) {
      var x = Math.random() * R * 2;
      var y = Math.random() * R * 2;
      var r = R * (0.015 + Math.random() * 0.025);
      g.beginPath();
      g.arc(x, y, r, 0, TAU);
      g.fillStyle = Math.random() < 0.55 ? "rgba(255, 246, 225, 0.06)" : "rgba(120, 48, 12, 0.05)";
      g.fill();
    }
  }

  function seed() {
    twinklers = [];
    var count = Math.min(46, Math.round((width * height) / 26000));
    for (var i = 0; i < count; i++) {
      twinklers.push({
        x: Math.random() * width,
        y: Math.random() * height,
        r: Math.random() * 1.1 + 0.7,
        tint: STAR_TINTS[i % STAR_TINTS.length],
        phase: Math.random() * TAU,
        speed: 0.5 + Math.random() * 0.9,
        spikes: Math.random() < 0.18,
      });
    }

    if (!spots.length) {
      for (var j = 0; j < 5; j++) {
        spots.push({
          lat: (Math.random() - 0.5) * 1.1,
          lon: Math.random() * TAU,
          size: 0.07 + Math.random() * 0.09,
        });
      }
    }
    gas = [];
  }

  function drawTwinklers() {
    for (var i = 0; i < twinklers.length; i++) {
      var s = twinklers[i];
      var alpha = reduceMotion ? 0.7 : 0.4 + 0.5 * Math.abs(Math.sin(t * 0.0006 * s.speed + s.phase));
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, TAU);
      ctx.fillStyle = "rgba(" + s.tint + ", " + alpha.toFixed(3) + ")";
      ctx.fill();
      if (s.spikes) {
        var l = s.r * 6;
        ctx.strokeStyle = "rgba(" + s.tint + ", " + (alpha * 0.35).toFixed(3) + ")";
        ctx.lineWidth = 0.6;
        ctx.beginPath();
        ctx.moveTo(s.x - l, s.y);
        ctx.lineTo(s.x + l, s.y);
        ctx.moveTo(s.x, s.y - l);
        ctx.lineTo(s.x, s.y + l);
        ctx.stroke();
      }
    }
  }

  function drawCompanion(cx, cy) {
    var twinkle = reduceMotion ? 0.65 : 0.55 + 0.2 * Math.sin(t * 0.0009);
    nebula(ctx, cx, cy, 26, C.companion, (0.28 * twinkle).toFixed(3));
    ctx.beginPath();
    ctx.arc(cx, cy, 2.2, 0, TAU);
    ctx.fillStyle = "rgba(" + C.companion + ", " + twinkle.toFixed(3) + ")";
    ctx.fill();
  }

  function drawStar() {
    var R = L.R;
    var x = L.x;
    var y = L.y;
    var pulse = reduceMotion ? 1 : 1 + 0.03 * Math.sin(t * 0.0011);
    var spin = reduceMotion ? 0 : t * 0.00005;

    /* wide corona and inner glow */
    nebula(ctx, x, y, R * 6.5 * pulse, C.corona, 0.22);
    nebula(ctx, x, y, R * 2.1, C.corona, 0.45);

    /* diffraction spikes, like a telescope image */
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(Math.PI / 4);
    for (var k = 0; k < 4; k++) {
      ctx.rotate(Math.PI / 2);
      var spike = ctx.createLinearGradient(0, 0, R * 5, 0);
      spike.addColorStop(0, "rgba(" + C.corona + ", 0.35)");
      spike.addColorStop(1, "rgba(" + C.corona + ", 0)");
      ctx.fillStyle = spike;
      ctx.beginPath();
      ctx.moveTo(R * 0.8, -1.2);
      ctx.lineTo(R * 5, 0);
      ctx.lineTo(R * 0.8, 1.2);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();

    /* magnetic prominences -- HD 189733 A is an active, flaring star */
    for (var i = 0; i < flares.length; i++) {
      var f = flares[i];
      var progress = (t - f.start) / f.duration;
      if (progress < 0 || progress >= 1) continue;
      var fade = Math.sin(progress * Math.PI);
      var h = R * (0.25 + progress * 0.55) * f.scale;
      var a0 = f.angle - f.width;
      var a1 = f.angle + f.width;
      ctx.strokeStyle = "rgba(" + C.corona + ", " + (0.75 * fade).toFixed(3) + ")";
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(x + Math.cos(a0) * R * 0.95, y + Math.sin(a0) * R * 0.95);
      ctx.quadraticCurveTo(
        x + Math.cos(f.angle) * (R + h * 2),
        y + Math.sin(f.angle) * (R + h * 2),
        x + Math.cos(a1) * R * 0.95,
        y + Math.sin(a1) * R * 0.95
      );
      ctx.stroke();
    }

    /* limb-darkened photosphere */
    var body = ctx.createRadialGradient(x, y, 0, x, y, R);
    body.addColorStop(0, C.starCore);
    body.addColorStop(0.5, "rgba(" + C.starMid + ", 1)");
    body.addColorStop(0.86, "rgba(" + C.starEdge + ", 1)");
    body.addColorStop(1, "rgba(" + C.starEdge + ", 0.92)");
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, R, 0, TAU);
    ctx.fillStyle = body;
    ctx.fill();
    ctx.clip();

    if (gran) {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(spin * 0.6);
      ctx.globalAlpha *= 0.6;
      ctx.drawImage(gran, -R, -R, R * 2, R * 2);
      ctx.restore();
    }

    /* starspots, carried across the disc by the star's rotation */
    for (var j = 0; j < spots.length; j++) {
      var sp = spots[j];
      var lon = sp.lon + spin;
      var cosLon = Math.cos(lon);
      if (cosLon <= 0.05) continue;
      var rowW = Math.sqrt(Math.max(0, 1 - sp.lat * sp.lat));
      var sx = x + Math.sin(lon) * rowW * R;
      var sy = y + sp.lat * R;
      var sr = sp.size * R;
      var g = ctx.createRadialGradient(sx, sy, 0, sx, sy, sr);
      g.addColorStop(0, "rgba(" + C.spot + ", " + (0.75 * cosLon).toFixed(3) + ")");
      g.addColorStop(0.45, "rgba(" + C.spot + ", " + (0.45 * cosLon).toFixed(3) + ")");
      g.addColorStop(1, "rgba(" + C.spot + ", 0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(sx, sy, sr * Math.max(0.15, cosLon), sr, 0, 0, TAU);
      ctx.fill();
    }
    ctx.restore();

    /* thin chromosphere rim */
    ctx.beginPath();
    ctx.arc(x, y, R + 0.6, 0, TAU);
    ctx.strokeStyle = "rgba(255, 196, 140, 0.45)";
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  function drawOrbit(front, angle) {
    ctx.save();
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(" + C.glow + ", " + (front ? 0.22 : 0.12) + ")";
    if (!front) ctx.setLineDash([3, 5]);
    ctx.beginPath();
    ctx.ellipse(L.x, L.y, L.a, L.b, TILT, front ? 0 : Math.PI, front ? Math.PI : TAU);
    ctx.stroke();
    ctx.setLineDash([]);

    /* phase ticks every 30 degrees */
    ctx.fillStyle = "rgba(" + C.glow + ", " + (front ? 0.45 : 0.25) + ")";
    for (var q = 0; q < 12; q++) {
      var qa = (q / 12) * TAU;
      if (Math.sin(qa) > 0 !== front || Math.abs(Math.sin(qa)) < 1e-6) continue;
      var tp = orbitPoint(qa);
      ctx.fillRect(tp.x - 1, tp.y - 1, 2, 2);
    }

    /* bright trail just behind the planet */
    var steps = 18;
    var span = 0.9;
    for (var i = 0; i < steps; i++) {
      var s0 = angle - span + (span * i) / steps;
      var s1 = s0 + span / steps;
      if (Math.sin((s0 + s1) / 2) > 0 !== front) continue;
      ctx.strokeStyle = "rgba(" + C.glow + ", " + ((0.55 * (i + 1)) / steps).toFixed(3) + ")";
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.ellipse(L.x, L.y, L.a, L.b, TILT, s0, s1);
      ctx.stroke();
    }
    ctx.restore();
  }

  /* direction the escaping atmosphere streams: away from the star, trailing the orbit */
  function tailDirection(pos, angle) {
    var ax = pos.x - L.x;
    var ay = pos.y - L.y;
    var al = Math.sqrt(ax * ax + ay * ay) || 1;
    var ahead = orbitPoint(angle + 0.05);
    var vx = ahead.x - pos.x;
    var vy = ahead.y - pos.y;
    var vl = Math.sqrt(vx * vx + vy * vy) || 1;
    var dx = ax / al - (vx / vl) * 0.8;
    var dy = ay / al - (vy / vl) * 0.8;
    var dl = Math.sqrt(dx * dx + dy * dy) || 1;
    return { x: dx / dl, y: dy / dl };
  }

  function drawTail(pos, dir) {
    var r = L.rp;
    var len = r * 6;
    var tipX = pos.x + dir.x * len;
    var tipY = pos.y + dir.y * len;
    var g = ctx.createLinearGradient(pos.x, pos.y, tipX, tipY);
    g.addColorStop(0, "rgba(" + C.glow + ", 0.22)");
    g.addColorStop(1, "rgba(" + C.glow + ", 0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(pos.x - dir.y * r * 1.05, pos.y + dir.x * r * 1.05);
    ctx.quadraticCurveTo(
      pos.x + dir.x * len * 0.5 - dir.y * r * 1.5,
      pos.y + dir.y * len * 0.5 + dir.x * r * 1.5,
      tipX,
      tipY
    );
    ctx.quadraticCurveTo(
      pos.x + dir.x * len * 0.5 + dir.y * r * 1.5,
      pos.y + dir.y * len * 0.5 - dir.x * r * 1.5,
      pos.x + dir.y * r * 1.05,
      pos.y - dir.x * r * 1.05
    );
    ctx.closePath();
    ctx.fill();

    /* individual wisps of escaping hydrogen */
    for (var i = 0; i < gas.length; i++) {
      var p = gas[i];
      var age = (t - p.born) / p.life;
      if (age >= 1) continue;
      ctx.fillStyle = "rgba(170, 210, 255, " + (0.45 * (1 - age)).toFixed(3) + ")";
      ctx.fillRect(p.x, p.y, 1.2, 1.2);
    }
  }

  function updateGas(pos, dir, dt) {
    if (reduceMotion) return;
    gas = gas.filter(function (p) {
      return t - p.born < p.life;
    });
    for (var i = 0; i < gas.length; i++) {
      gas[i].x += gas[i].vx * dt;
      gas[i].y += gas[i].vy * dt;
    }
    if (gas.length < 60 && Math.random() < 0.55) {
      var spread = (Math.random() - 0.5) * 2;
      var speed = 0.012 + Math.random() * 0.02;
      gas.push({
        x: pos.x + dir.x * L.rp * 0.9 - dir.y * spread * L.rp,
        y: pos.y + dir.y * L.rp * 0.9 + dir.x * spread * L.rp,
        vx: dir.x * speed - dir.y * spread * 0.004,
        vy: dir.y * speed + dir.x * spread * 0.004,
        born: t,
        life: 1800 + Math.random() * 1600,
      });
    }
  }

  function drawPlanet(pos, angle) {
    var r = L.rp;
    var litFrac = (1 - Math.sin(angle)) / 2;
    nebula(ctx, pos.x, pos.y, r * 2.6, C.glow, (0.06 + 0.2 * litFrac).toFixed(3));
    var size = renderPlanet(angle, r * dpr, t);
    var css = size / dpr;
    ctx.drawImage(pcan, pos.x - css / 2, pos.y - css / 2, css, css);
  }

  function drawLabel(x, y, tx, ty, text) {
    ctx.strokeStyle = "rgba(" + C.hud + ", 0.35)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(tx, ty);
    ctx.lineTo(tx + 6, ty);
    ctx.stroke();
    ctx.fillStyle = "rgba(" + C.hud + ", 0.7)";
    ctx.fillText(text, tx + 10, ty + 3.5);
  }

  function drawLightCurve(phase) {
    var w = Math.min(L.a * 1.6, 300);
    var h = 44;
    var x0 = L.x - w / 2;
    var y0 = L.y - L.R * 2.5 - h;
    if (y0 < 84) return;

    var lo = 100 - TRANSIT_DEPTH * 1.25;
    function px(ph) {
      return x0 + ((ph + CURVE_WINDOW) / (2 * CURVE_WINDOW)) * w;
    }
    function py(flux) {
      return y0 + ((100 - flux) / (100 - lo)) * h;
    }

    ctx.save();
    ctx.fillStyle = "rgba(" + C.hud + ", 0.55)";
    ctx.fillText("TRANSIT PHOTOMETRY", x0, y0 - 10);
    ctx.textAlign = "right";
    ctx.fillText("ΔF " + TRANSIT_DEPTH.toFixed(1) + "%", x0 + w, y0 - 10);
    ctx.textAlign = "left";

    ctx.strokeStyle = "rgba(" + C.hud + ", 0.18)";
    ctx.setLineDash([2, 4]);
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x0 + w, y0);
    ctx.moveTo(x0, py(100 - TRANSIT_DEPTH));
    ctx.lineTo(x0 + w, py(100 - TRANSIT_DEPTH));
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.strokeStyle = "rgba(" + C.glow + ", 0.6)";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    for (var i = 0; i < curve.length; i++) {
      var cx = px(curve[i].ph);
      var cy = py(curve[i].flux);
      if (i === 0) ctx.moveTo(cx, cy);
      else ctx.lineTo(cx, cy);
    }
    ctx.stroke();

    var ph = phase > 0.5 ? phase - 1 : phase;
    if (Math.abs(ph) <= CURVE_WINDOW) {
      var mx = px(ph);
      var my = py(fluxAt(Math.PI / 2 + ph * TAU));
      nebula(ctx, mx, my, 9, C.glow, 0.5);
      ctx.beginPath();
      ctx.arc(mx, my, 2.2, 0, TAU);
      ctx.fillStyle = "rgba(220, 236, 255, 0.95)";
      ctx.fill();
    }
    ctx.restore();
  }

  function formatCountdown(hours) {
    var total = Math.round(hours * 60);
    var hh = Math.floor(total / 60);
    var mm = total % 60;
    return "T−" + hh + "h " + (mm < 10 ? "0" : "") + mm + "m";
  }

  function draw(time) {
    var dt = lastFrameAt ? Math.min(64, time - lastFrameAt) : 16;
    lastFrameAt = time;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (sky) ctx.drawImage(sky, 0, 0, width, height);
    drawTwinklers();

    var compX = L.narrow ? width * 0.88 : Math.min(width * 0.93, width - (width >= 1500 ? SIDEBAR_W : 40));
    var compY = height * 0.12;
    drawCompanion(compX, compY);

    var angle = reduceMotion ? STATIC_ANGLE : (((time % ORBIT_MS) / ORBIT_MS) * TAU + STATIC_ANGLE - 0.6) % TAU;
    var pos = orbitPoint(angle);
    var phase = phaseOf(angle);
    var dir = tailDirection(pos, angle);
    updateGas(pos, dir, dt);

    ctx.save();
    ctx.globalAlpha = L.fade;

    drawOrbit(false, angle);
    if (!pos.front) {
      drawTail(pos, dir);
      drawPlanet(pos, angle);
    }
    drawStar();
    drawOrbit(true, angle);
    if (pos.front) {
      drawTail(pos, dir);
      drawPlanet(pos, angle);
    }

    if (!L.narrow) {
      ctx.font = "10px ui-monospace, 'JetBrains Mono', 'Fira Code', Menlo, Consolas, monospace";
      ctx.textBaseline = "alphabetic";
      drawLabel(L.x + L.R * 0.75, L.y - L.R * 0.75, L.x + L.R * 1.5, L.y - L.R * 1.6, "HD 189733 A");
      drawLabel(pos.x + L.rp * 0.8, pos.y - L.rp * 0.8, pos.x + L.rp + 14, pos.y - L.rp - 18, "b");
      drawLabel(compX - 3, compY + 3, compX - 18, compY + 22, "B");
      drawLightCurve(phase);
    }
    ctx.restore();

    /* occasional prominence */
    if (!reduceMotion && time - lastFlareCheck > 500) {
      lastFlareCheck = time;
      flares = flares.filter(function (f) {
        return time - f.start < f.duration;
      });
      if (flares.length < 2 && Math.random() < 0.3) {
        flares.push({
          start: time,
          duration: 1400 + Math.random() * 1200,
          angle: Math.random() * TAU,
          width: 0.1 + Math.random() * 0.12,
          scale: 0.6 + Math.random() * 0.6,
        });
      }
    }

    /* telemetry, throttled */
    if (time - lastTelemetryAt > 220 || reduceMotion) {
      lastTelemetryAt = time;
      var dx = Math.cos(angle) * L.a;
      var dy = Math.sin(angle) * L.b;
      var touching = Math.sqrt(dx * dx + dy * dy) < L.R + L.rp;
      var eventLabel = "in orbit";
      if (touching) eventLabel = pos.front ? "transit" : "occulted";
      window.dispatchEvent(
        new CustomEvent("hd189b:telemetry", {
          detail: {
            phase: Math.round(phase * 100),
            event: eventLabel,
            flux: fluxAt(angle).toFixed(2),
            next: touching && pos.front ? "now" : formatCountdown((1 - phase) * PERIOD_H),
          },
        })
      );
    }
  }

  function resize() {
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = width + "px";
    canvas.style.height = height + "px";
    L = computeLayout();
    buildSky();
    buildGranulation();
    seed();
    buildCurve();
    if (reduceMotion) draw(0);
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
      lastFrameAt = 0;
    } else if (!reduceMotion && rafId === null) {
      rafId = requestAnimationFrame(frame);
    }
  });

  buildPlanetTexture();
  resize();

  if (!reduceMotion) {
    rafId = requestAnimationFrame(frame);
  }
})();
