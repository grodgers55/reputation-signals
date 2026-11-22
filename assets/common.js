/* Shared helpers for the dashboards (no build step, no framework).
   Each page defines a render() function and calls Dash.start(render). */
(function () {
  const PAGES = [
    { href: "index.html", label: "Overview", n: "" },
    { href: "tracker.html", label: "Airlines", n: "01" },
    { href: "crisis.html", label: "Spirit collapse", n: "02" },
    { href: "share-of-voice.html", label: "Cava vs Dutch Bros", n: "03" },
    { href: "issues.html", label: "Southwest issues", n: "04" },
  ];

  // ---------- tokens (read from CSS so light/dark stay in one place) ----------
  function tok(name) {
    return getComputedStyle(document.documentElement).getPropertyValue("--" + name).trim();
  }

  // ---------- header / footer ----------
  function header(active) {
    const el = document.getElementById("site-header");
    if (!el) return;
    el.className = "site-header";
    el.innerHTML = `<div class="wrap">
      <a class="brand" href="index.html"><span class="mark">Reputation Signals</span><span class="by">Public-data briefings · Garron Rodgers, PMP</span></a>
      <nav class="nav" aria-label="Briefings">${PAGES.map(p =>
        `<a href="${p.href}"${p.href === active ? ' aria-current="page"' : ""}>${p.n ? `<span class="n">${p.n}</span>` : ""}${p.label}</a>`).join("")}</nav>
    </div>`;
  }
  function footer() {
    const el = document.getElementById("site-footer");
    if (!el) return;
    const m = window.META || {};
    el.className = "site-footer";
    el.innerHTML = `<div class="wrap">
      <div>
        <p class="mark">Reputation Signals</p>
        <p><strong>A proof of concept built entirely from public data.</strong> Not a client deliverable, and not affiliated with any brand shown.
          Sources: GDELT Global Knowledge Graph (via Google BigQuery) and Google Trends, with a blind review of a 500-headline sample.</p>
        <p>Recommendations are illustrative: they show how the data would be turned into advice for a client.</p>
      </div>
      <div>
        <p>Data window ${m.window ? fmtDate(m.window[0]) + " – " + fmtDate(m.window[1]) : ""}<br>Last refreshed ${m.built ? fmtDate(m.built) : ""}</p>
        <p><a href="index.html#methodology">Method, definitions &amp; limitations</a></p>
        <p>Analysis and build: Garron Rodgers, PMP</p>
      </div>
    </div>`;
  }

  // ---------- formatting ----------
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function parse(d) { const [y, m, dd] = d.split("-").map(Number); return new Date(y, (m || 1) - 1, dd || 1); }
  function fmtDate(d) { const x = parse(d); return `${x.getDate()} ${MONTHS[x.getMonth()]} ${x.getFullYear()}`; }
  function fmtDay(d) { const x = parse(d); return `${x.getDate()} ${MONTHS[x.getMonth()]}`; }
  function fmtMonth(p) { const x = parse(p); return `${MONTHS[x.getMonth()]} ’${String(x.getFullYear()).slice(2)}`; }
  function fmtInt(n) { return n == null ? "–" : Math.round(n).toLocaleString("en-US"); }
  function fmtPct(x, dp = 0) { return x == null ? "–" : (x * 100).toFixed(dp) + "%"; }
  function fmtTone(t) { return t == null ? "–" : (t > 0 ? "+" : "") + Number(t).toFixed(1); }
  function esc(s) { return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
  function domainOf(url) { try { return new URL(url).hostname.replace(/^www\./, ""); } catch (e) { return ""; } }

  // ---------- charts ----------
  const registry = {};
  function chartDefaults() {
    const C = window.Chart;
    const ann = window["chartjs-plugin-annotation"];
    if (ann && !C.registry.plugins.get("annotation")) C.register(ann);
    C.defaults.font.family = tok("font") || "system-ui, sans-serif";
    C.defaults.font.size = 12;
    C.defaults.font.weight = "400";
    C.defaults.color = tok("text-2");
    C.defaults.borderColor = tok("grid");
    C.defaults.animation = { duration: 250 };
    C.defaults.maintainAspectRatio = false;
    C.defaults.plugins.legend.display = false;          // legends are drawn in HTML above each chart
    const tt = C.defaults.plugins.tooltip;
    tt.backgroundColor = tok("surface");
    tt.titleColor = tok("text-1");
    tt.bodyColor = tok("text-2");
    tt.borderColor = tok("border");
    tt.borderWidth = 1;
    tt.padding = 10;
    tt.cornerRadius = 2;
    tt.titleFont = { family: tok("font"), weight: "600", size: 12 };
    tt.bodyFont = { family: tok("font"), size: 12 };
    tt.boxPadding = 4;
    tt.usePointStyle = true;
    C.defaults.elements.line.borderWidth = 2;
    C.defaults.elements.line.borderCapStyle = "round";
    C.defaults.elements.line.borderJoinStyle = "round";
    C.defaults.elements.line.cubicInterpolationMode = "monotone";   // smooth, but never overshoots the data
    C.defaults.elements.point.radius = 0;
    C.defaults.elements.point.hoverRadius = 5;
    C.defaults.elements.point.hitRadius = 12;
    C.defaults.elements.bar.borderRadius = 2;
    C.defaults.interaction = { mode: "index", intersect: false };
  }
  function axis(extra = {}) {
    return Object.assign({
      grid: { color: tok("grid"), drawTicks: false },
      border: { color: tok("axis") },
      ticks: { color: tok("text-3"), padding: 6 },
    }, extra);
  }
  function chart(id, config) {
    if (registry[id]) registry[id].destroy();
    const el = document.getElementById(id);
    if (!el) return null;
    registry[id] = new window.Chart(el, config);
    return registry[id];
  }

  // Numbered vertical markers for annotated events (chartjs-plugin-annotation)
  function eventMarkers(events, labels, matchFn) {
    const ann = {};
    let lastIdx = -99, level = 0;
    events.slice().sort((a, b) => a.date.localeCompare(b.date)).forEach(e => {
      const idx = labels.findIndex(l => matchFn(l, e.date));
      if (idx < 0) return;
      // stagger badges that would overlap their neighbour: work out how many
      // x-positions a 26px badge spans at the current page width
      const pxPerLabel = (Math.min(window.innerWidth, 1120) - 90) / labels.length;
      const minGap = Math.max(1, Math.ceil(26 / pxPerLabel));
      level = idx - lastIdx < minGap ? (level + 1) % 4 : 0;
      lastIdx = idx;
      ann["ev" + e.n] = {
        type: "line", xMin: idx, xMax: idx, borderColor: tok("axis"), borderWidth: 1, borderDash: [3, 3],
        label: {
          display: true, content: String(e.n), position: "end", yAdjust: 4 + level * 24,
          backgroundColor: tok("page"), color: tok("text-1"), borderColor: tok("text-1"), borderWidth: 1,
          borderRadius: 11, padding: { x: 6, y: 3 }, font: { family: tok("mono"), size: 10.5, weight: "500" },
        },
      };
    });
    return ann;
  }
  // first period label on/after an event date (weekly labels are week-ending Sundays)
  function weekMatch(label, date) { return label >= date && (parse(label) - parse(date)) / 864e5 < 7; }
  function monthMatch(label, date) { return date.slice(0, 7) === label; }

  // Shorter outlet-type names for narrow screens, so axis labels aren't clipped
  const SHORT_TYPES = { "Local / regional newspaper": "Regional paper", "Local radio (iHeart network)": "iHeart radio",
    "Other / unclassified": "Unclassified", "Lifestyle / entertainment": "Lifestyle", "Opinion / commentary": "Opinion",
    "Financial / investor": "Financial", "Local TV / radio": "Local TV/radio", "National news": "National" };
  function narrow() { return window.innerWidth < 600; }
  function typeLabel(t) { return narrow() ? (SHORT_TYPES[t] || t) : t; }

  // ---------- table views ----------
  function table(el, headers, rows, numeric = []) {
    el.innerHTML = `<div class="table-wrap"><table><thead><tr>${headers.map((h, i) =>
      `<th class="${numeric.includes(i) ? "num" : ""}">${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows.map(r =>
      `<tr>${r.map((c, i) => `<td class="${numeric.includes(i) ? "num" : ""}">${c}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
  }
  function tableToggle(btnId, tableId) {
    const b = document.getElementById(btnId), t = document.getElementById(tableId);
    if (!b || !t || b.dataset.bound) return;
    b.dataset.bound = "1";
    b.addEventListener("click", () => {
      t.hidden = !t.hidden;
      b.textContent = t.hidden ? "Show data table" : "Hide data table";
      b.setAttribute("aria-expanded", String(!t.hidden));
    });
  }

  function legend(el, items, kind = "line") {
    el.innerHTML = items.map(i => `<span><i class="${kind === "line" ? "" : kind}" style="background:${i.color}"></i>${esc(i.label)}</span>`).join("");
  }

  // Segmented button group: returns current value; calls onChange(value)
  function segmented(el, options, value, onChange) {
    el.innerHTML = options.map(o => `<button type="button" data-v="${o.value}" aria-pressed="${o.value === value}">${esc(o.label)}</button>`).join("");
    el.querySelectorAll("button").forEach(b => b.addEventListener("click", () => {
      el.querySelectorAll("button").forEach(x => x.setAttribute("aria-pressed", String(x === b)));
      onChange(b.dataset.v);
    }));
  }

  // ---------- client-action helpers ----------
  // Priority / risk chip: shape + word, never colour alone
  function chip(level, text) {
    const label = text || ({ high: "High", medium: "Medium", low: "Low", alert: "Alert", watch: "Watch", normal: "Normal", ceased: "Ceased" }[level] || level);
    return `<span class="chip ${level}">${esc(label)}</span>`;
  }
  // Priority actions table. rows: {pri, action, detail, evidence, owner, when}
  function actions(el, rows) {
    el.innerHTML = `<div class="table-wrap"><table><thead><tr><th>Priority</th><th>Recommended action</th><th>Why (evidence)</th><th>Owner</th><th>When</th></tr></thead><tbody>${
      rows.map(r => `<tr><td class="pri">${chip(r.pri)}</td><td class="act"><strong>${r.action}</strong><span class="detail">${r.detail || ""}</span></td>
        <td class="ev">${r.evidence}</td><td class="owner">${esc(r.owner)}</td><td class="when">${esc(r.when)}</td></tr>`).join("")}</tbody></table></div>`;
  }
  // Risk level for a Reputation Risk Index value
  function riskLevel(v, th) { return v == null ? "normal" : v >= th.alert ? "alert" : v >= th.watch ? "watch" : "normal"; }
  // Tiny inline SVG sparkline with the two threshold lines (for tables)
  function sparkline(values, th, color, w = 150, h = 34) {
    const max = 100, n = values.length, x = i => (i / (n - 1)) * (w - 2) + 1, y = v => h - 2 - (v / max) * (h - 4);
    let d = "", pen = false;
    values.forEach((v, i) => { if (v == null) { pen = false; return; } d += (pen ? "L" : "M") + x(i).toFixed(1) + " " + y(v).toFixed(1); pen = true; });
    const line = (v, dash) => `<line x1="0" x2="${w}" y1="${y(v)}" y2="${y(v)}" stroke="${tok("axis")}" stroke-width="1" ${dash ? 'stroke-dasharray="2 2"' : ""}/>`;
    return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-hidden="true" style="display:block;max-width:100%">
      ${line(th.watch, true)}${line(th.alert, false)}<path d="${d}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linejoin="round"/></svg>`;
  }
  // Source link; plain text if the article is no longer online (see 16_check_links.py)
  function link(url, text) {
    return url ? `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(text)}</a>` : `<span title="Source page no longer online">${esc(text)}</span>`;
  }
  function printButton(el) {
    if (!el) return;
    el.innerHTML = `<button type="button" class="btn ghost" id="print-brief">Print / save one-page brief (PDF)</button>`;
    document.getElementById("print-brief").addEventListener("click", () => window.print());
  }

  // ---------- lifecycle ----------
  function start(render) {
    const active = location.pathname.split("/").pop() || "index.html";
    header(active);
    footer();
    printButton(document.getElementById("page-tools"));
    // Wait for the web fonts so chart labels are measured in the right typeface
    const go = () => { if (window.Chart) chartDefaults(); render(); };
    (document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve()).then(go, go);
    // Re-draw charts with the right colours if the OS switches light/dark
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
      if (window.Chart) chartDefaults();
      render();
    });
  }

  window.Dash = { tok, chart, axis, eventMarkers, weekMatch, monthMatch, table, tableToggle, legend, segmented,
                  start, narrow, typeLabel, chip, actions, riskLevel, sparkline, link, fmtDate, fmtDay, fmtMonth, fmtInt, fmtPct, fmtTone, esc, domainOf };
})();
