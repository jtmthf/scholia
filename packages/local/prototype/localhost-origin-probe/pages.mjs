// PROTOTYPE — throwaway probe for issue #23. See README.md. Delete when answered.
//
// Two documents. The viewer runs on `localhost`, the frame on `content.localhost`.
// The frame probes what it can see from inside; the viewer probes what it can see
// from outside; the viewer merges both into one report you can paste per browser.

const STYLE = `
  :root { color-scheme: light dark; }
  body { font: 15px/1.5 ui-sans-serif, system-ui, -apple-system, sans-serif; margin: 0; padding: 24px; max-width: 980px; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  h2 { font-size: 14px; text-transform: uppercase; letter-spacing: .07em; opacity: .6; margin: 28px 0 8px; }
  .sub { opacity: .6; margin: 0 0 20px; font-size: 13px; }
  .banner { padding: 14px 16px; border-radius: 8px; font-weight: 600; margin: 0 0 20px; border: 2px solid; }
  .banner.pending { border-color: #9994; }
  .banner.good { border-color: #1a7f37; background: #1a7f371a; }
  .banner.warn { border-color: #9a6700; background: #9a67001a; }
  .banner.bad  { border-color: #cf222e; background: #cf222e1a; }
  .banner small { display: block; font-weight: 400; opacity: .8; margin-top: 4px; }
  table { border-collapse: collapse; width: 100%; font-size: 13px; }
  td, th { border-bottom: 1px solid #8884; padding: 7px 10px; text-align: left; vertical-align: top; }
  th { font-weight: 600; opacity: .65; font-size: 11px; text-transform: uppercase; letter-spacing: .05em; }
  td.label { width: 32%; }
  td.value { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; word-break: break-all; }
  .chip { display: inline-block; padding: 1px 7px; border-radius: 99px; font-size: 11px; font-weight: 600; border: 1px solid; white-space: nowrap; }
  .chip.good { color: #1a7f37; border-color: #1a7f37; }
  .chip.warn { color: #9a6700; border-color: #9a6700; }
  .chip.bad  { color: #cf222e; border-color: #cf222e; }
  .chip.info { opacity: .6; border-color: currentColor; }
  button { font: inherit; padding: 7px 14px; border-radius: 6px; border: 1px solid #8886; background: transparent; color: inherit; cursor: pointer; }
  iframe { width: 100%; height: 150px; border: 1px dashed #8886; border-radius: 6px; background: #8881; }
  pre { font-size: 11px; background: #8881; padding: 12px; border-radius: 6px; overflow-x: auto; }
`;

/** Shared by both documents. No backticks / no template literals — this is source text. */
const HELPERS = `
  function attempt(fn) {
    try { return { ok: true, value: fn() }; }
    catch (e) { return { ok: false, error: (e && e.name ? e.name : 'Error') + ': ' + (e && e.message ? e.message : String(e)) }; }
  }
  function show(r) {
    if (!r) return '(not run)';
    if (r.ok === false) return 'threw ' + r.error;
    var v = r.ok === true ? r.value : r;
    return typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v);
  }
  // Reached lazily through window[which]: in a sandboxed frame merely *naming*
  // localStorage throws, and it has to throw inside attempt() to be recorded.
  function safeStorage(which, mine, theirs) {
    return attempt(function () {
      var store = window[which];
      store.setItem(mine, 'yes');
      return { wroteOwnKey: true, readOtherSidesKey: store.getItem(theirs) };
    });
  }
  function openIdb() {
    return new Promise(function (resolve) {
      var req;
      try { req = indexedDB.open('scholia-probe-23', 1); }
      catch (e) { resolve({ ok: false, error: e.name + ': ' + e.message }); return; }
      req.onupgradeneeded = function () { req.result.createObjectStore('kv'); };
      req.onerror = function () { resolve({ ok: false, error: 'open failed: ' + (req.error ? req.error.name : '?') }); };
      req.onsuccess = function () { resolve({ ok: true, db: req.result }); };
      setTimeout(function () { resolve({ ok: false, error: 'timed out' }); }, 2500);
    });
  }
  function tryIdb(mine, theirs) {
    return openIdb().then(function (opened) {
      if (!opened.ok) return opened;
      return new Promise(function (resolve) {
        var got;
        try {
          var tx = opened.db.transaction('kv', 'readwrite');
          var kv = tx.objectStore('kv');
          kv.put('yes', mine);
          got = kv.get(theirs);
          tx.oncomplete = function () {
            resolve({ ok: true, value: { wroteOwnKey: true, readOtherSidesKey: got.result === undefined ? null : got.result } });
          };
          tx.onerror = function () { resolve({ ok: false, error: 'transaction failed' }); };
        } catch (e) { resolve({ ok: false, error: e.name + ': ' + e.message }); return; }
        setTimeout(function () { resolve({ ok: false, error: 'timed out' }); }, 2500);
      });
    });
  }
  function jsonFetch(url, creds) {
    return fetch(url, { credentials: creds }).then(function (r) { return r.json(); })
      .catch(function (e) { return { fetchError: String(e) }; });
  }
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
`;

export function frameHtml({ viewerOrigin, contentOrigin, viewerHostname }) {
  return `<!doctype html>
<meta charset="utf-8">
<title>content Origin — probe frame</title>
<style>${STYLE} body { padding: 12px; font-size: 13px; }</style>
<h1>Content Origin</h1>
<p class="sub" id="origin"></p>
<pre id="out">running…</pre>
<script>
${HELPERS}
var VIEWER_ORIGIN = ${JSON.stringify(viewerOrigin)};
var CONTENT_ORIGIN = ${JSON.stringify(contentOrigin)};
var VIEWER_HOSTNAME = ${JSON.stringify(viewerHostname)};
var MODE = new URLSearchParams(location.search).get('mode') || 'plain';
var TARGET = MODE === 'sandbox' ? '*' : VIEWER_ORIGIN;

document.getElementById('origin').textContent = 'mode=' + MODE + '  origin=' + location.origin;

function post(message) { parent.postMessage(message, TARGET); }

function run() {
  var p = {};
  p.origin = attempt(function () { return location.origin; });
  p.isSecureContext = attempt(function () { return window.isSecureContext; });
  p.crossOriginIsolated = attempt(function () { return window.crossOriginIsolated; });
  p.localStorage = safeStorage('localStorage', 'p_content', 'p_viewer');
  p.sessionStorage = safeStorage('sessionStorage', 'p_content', 'p_viewer');
  p.readParentDom = attempt(function () { return String(parent.document.title); });
  p.readTopLocation = attempt(function () { return String(top.location.href); });

  return tryIdb('content', 'viewer').then(function (idb) {
    p.indexedDB = idb;
    return jsonFetch(CONTENT_ORIGIN + '/probe/set-cookies', 'same-origin');
  }).then(function (setResult) {
    p.cookiesAttempted = { ok: true, value: setResult.attempted || setResult };
    p.documentCookie = attempt(function () { return document.cookie || '(empty)'; });
    return jsonFetch(CONTENT_ORIGIN + '/probe/echo', 'same-origin');
  }).then(function (echo) {
    p.serverSeesCookies = { ok: true, value: echo.cookie || '(none)' };
    p.serverSeesHost = { ok: true, value: echo.host || '(none)' };
    return p;
  });
}

window.addEventListener('message', function (event) {
  var d = event.data;
  if (!d || typeof d !== 'object') return;
  if (d.type === 'scholia-probe-ping') {
    post({ type: 'scholia-probe-pong', mode: MODE, tag: d.tag, sawOrigin: event.origin });
  }
  if (d.type === 'scholia-probe-relax') {
    var relaxed = attempt(function () { document.domain = VIEWER_HOSTNAME; return document.domain; });
    post({ type: 'scholia-probe-relaxed', mode: MODE, relaxed: relaxed });
  }
});

run().then(function (probes) {
  document.getElementById('out').textContent = JSON.stringify(probes, null, 2);
  post({ type: 'scholia-probe-report', mode: MODE, probes: probes });
});
</script>`;
}

export function viewerHtml({ viewerOrigin, contentOrigin, viewerHostname }) {
  return `<!doctype html>
<meta charset="utf-8">
<title>*.localhost origin probe — scholia #23</title>
<style>${STYLE}</style>
<h1>Does <code>*.localhost</code> give a real cross-origin boundary?</h1>
<p class="sub">
  viewer <code>${viewerOrigin}</code> &nbsp;·&nbsp; content <code>${contentOrigin}</code> &nbsp;·&nbsp; one port, no proxy, no TLS
</p>

<div class="banner pending" id="banner">Running probes…</div>
<p><button id="copy">Copy report as Markdown</button></p>

<div id="tables"></div>

<h2>The frames under test</h2>
<p class="sub">Left is plain (measures the hostname boundary). Right is <code>sandbox="allow-scripts"</code> (ADR-0003's actual config).</p>
<iframe id="plain" src="${contentOrigin}/frame?mode=plain"></iframe>
<iframe id="sandbox" sandbox="allow-scripts" src="${contentOrigin}/frame?mode=sandbox"></iframe>

<script>
${HELPERS}
var VIEWER_ORIGIN = ${JSON.stringify(viewerOrigin)};
var CONTENT_ORIGIN = ${JSON.stringify(contentOrigin)};
var VIEWER_HOSTNAME = ${JSON.stringify(viewerHostname)};

var state = { viewer: {}, plain: null, sandbox: null, eventOrigins: {}, pongs: [], escape: {} };

// Write the viewer's own storage keys before the frames load, so that when each
// frame reads the *other* side's key a null genuinely means "partitioned".
state.viewer.localStorage = safeStorage('localStorage', 'p_viewer', 'p_content');
state.viewer.sessionStorage = safeStorage('sessionStorage', 'p_viewer', 'p_content');
state.viewer.isSecureContext = attempt(function () { return window.isSecureContext; });

window.addEventListener('message', function (event) {
  var d = event.data;
  if (!d || typeof d !== 'object') return;
  if (d.type === 'scholia-probe-report') {
    state[d.mode] = d.probes;
    state.eventOrigins[d.mode] = event.origin;
    if (d.mode === 'plain') runTargetOriginProbe();
    render();
  }
  if (d.type === 'scholia-probe-pong') {
    state.pongs.push({ tag: d.tag, sawOrigin: d.sawOrigin });
    render();
  }
  if (d.type === 'scholia-probe-relaxed') {
    state.escape.frameRelaxed = d.relaxed;
    state.escape.viewerRelaxed = attempt(function () { document.domain = VIEWER_HOSTNAME; return document.domain; });
    state.escape.readFrameDomAfter = attempt(function () {
      return String(document.getElementById('plain').contentWindow.document.title);
    });
    render();
  }
});

/** Correctly-targeted message should arrive; deliberately wrong one must not. */
function runTargetOriginProbe() {
  var frame = document.getElementById('plain').contentWindow;
  frame.postMessage({ type: 'scholia-probe-ping', tag: 'correct-target' }, CONTENT_ORIGIN);
  frame.postMessage({ type: 'scholia-probe-ping', tag: 'WRONG-TARGET' }, 'http://wrong.' + location.host);
  setTimeout(render, 700);
}

function finalProbes() {
  var frame = document.getElementById('plain');
  state.viewer.readFrameDocument = attempt(function () { return String(frame.contentWindow.document.title); });
  state.viewer.readFrameLocation = attempt(function () { return String(frame.contentWindow.location.href); });
  // Allowed cross-origin — proves the frame is really there, so a throw above
  // means "blocked by the origin boundary", not "frame never loaded".
  state.viewer.readFrameLength = attempt(function () { return frame.contentWindow.length; });
  state.viewer.readOwnStorage = attempt(function () {
    return { localStorage_p_content: localStorage.getItem('p_content'), sessionStorage_p_content: sessionStorage.getItem('p_content') };
  });
  state.viewer.documentCookie = attempt(function () { return document.cookie || '(empty)'; });
}

function boot() {
  jsonFetch(CONTENT_ORIGIN + '/probe/ping', 'omit').then(function (ping) {
    state.viewer.contentHostResolves = ping.fetchError ? { ok: false, error: ping.fetchError } : { ok: true, value: ping };
    render();
  });
  tryIdb('viewer', 'content').then(function (idb) { state.viewer.indexedDB = idb; render(); });

  setTimeout(function () {
    finalProbes();
    jsonFetch(VIEWER_ORIGIN + '/probe/echo', 'same-origin').then(function (echo) {
      state.viewer.serverSeesCookies = { ok: true, value: echo.cookie || '(none)' };
      render();
      // Escape hatch runs last: relaxing document.domain changes this document's
      // origin for same-origin checks, so it must not pollute the probes above.
      var frame = document.getElementById('plain').contentWindow;
      if (frame) frame.postMessage({ type: 'scholia-probe-relax' }, CONTENT_ORIGIN);
    });
  }, 2500);
}

// ---- verdict ----------------------------------------------------------------

function cookieLeak() {
  var seen = state.viewer.serverSeesCookies && state.viewer.serverSeesCookies.value;
  if (!seen || seen === '(none)') return { leaked: false, names: [] };
  var names = [];
  ['p_dot_lax', 'p_dot_none', 'p_dom_lax', 'p_dom_none', 'p_host_lax', 'p_host_none'].forEach(function (n) {
    if (seen.indexOf(n + '=') !== -1) names.push(n);
  });
  return { leaked: names.length > 0, names: names };
}

function storageShared() {
  var shared = [];
  var frame = state.plain || {};
  ['localStorage', 'sessionStorage'].forEach(function (k) {
    var r = frame[k];
    if (r && r.ok && r.value && r.value.readOtherSidesKey !== null) shared.push('frame read viewer ' + k);
  });
  if (frame.indexedDB && frame.indexedDB.ok && frame.indexedDB.value.readOtherSidesKey !== null) shared.push('frame read viewer IndexedDB');
  var own = state.viewer.readOwnStorage;
  if (own && own.ok && own.value) {
    if (own.value.localStorage_p_content !== null) shared.push('viewer read frame localStorage');
    if (own.value.sessionStorage_p_content !== null) shared.push('viewer read frame sessionStorage');
  }
  return shared;
}

function verdict() {
  var resolves = state.viewer.contentHostResolves;
  if (!resolves) return { klass: 'pending', text: 'Running probes…', note: '' };
  if (!resolves.ok) {
    return { klass: 'bad', text: 'content.localhost DID NOT RESOLVE',
      note: 'The browser could not reach ' + CONTENT_ORIGIN + ' — ' + resolves.error + '. Local Preview cannot use a subdomain boundary in this browser.' };
  }
  if (!state.plain) return { klass: 'pending', text: 'Hostname resolved — waiting for the frame…', note: '' };

  var domBlocked = state.viewer.readFrameDocument && state.viewer.readFrameDocument.ok === false;
  var originMatches = state.eventOrigins.plain === CONTENT_ORIGIN;
  var shared = storageShared();
  var cookies = cookieLeak();

  if (!domBlocked || !originMatches || shared.length > 0) {
    return { klass: 'bad', text: 'NOT A REAL BOUNDARY',
      note: [!domBlocked ? 'cross-frame DOM access succeeded' : '', !originMatches ? 'event.origin was ' + state.eventOrigins.plain : '', shared.join('; ')].filter(Boolean).join(' · ') };
  }
  if (cookies.leaked) {
    return { klass: 'warn', text: 'CROSS-ORIGIN FOR THE DOM — BUT COOKIES LEAK',
      note: 'The viewer host received cookies set by the content host: ' + cookies.names.join(', ') + '. Cookies ignore port and scheme, so the boundary is porous even though the origins differ.' };
  }
  return { klass: 'good', text: 'REAL CROSS-ORIGIN BOUNDARY',
    note: 'Distinct origins for DOM access, postMessage and storage, with no cookie leak to the viewer host.' };
}

// ---- rendering --------------------------------------------------------------

function chip(kind, text) { return '<span class="chip ' + kind + '">' + esc(text) + '</span>'; }

function table(title, rows) {
  var body = rows.map(function (r) {
    return '<tr><td class="label">' + esc(r[0]) + '</td><td class="value">' + esc(show(r[1])) + '</td><td>' + (r[2] || '') + '</td></tr>';
  }).join('');
  return '<h2>' + esc(title) + '</h2><table><tr><th>Probe</th><th>Result</th><th></th></tr>' + body + '</table>';
}

function blockedChip(r) {
  if (!r) return '';
  return r.ok === false ? chip('good', 'blocked') : chip('bad', 'readable');
}

function render() {
  var v = verdict();
  var banner = document.getElementById('banner');
  banner.className = 'banner ' + v.klass;
  banner.innerHTML = esc(v.text) + (v.note ? '<small>' + esc(v.note) + '</small>' : '');

  var frame = state.plain || {};
  var sandbox = state.sandbox || {};
  var cookies = cookieLeak();
  var shared = storageShared();
  var correct = state.pongs.filter(function (p) { return p.tag === 'correct-target'; });
  var wrong = state.pongs.filter(function (p) { return p.tag === 'WRONG-TARGET'; });

  var html = '';

  html += table('0 · Resolution', [
    ['content host reachable', state.viewer.contentHostResolves,
      state.viewer.contentHostResolves ? (state.viewer.contentHostResolves.ok ? chip('good', 'resolved') : chip('bad', 'failed')) : ''],
    ['frame is really loaded (cross-origin-legal read)', state.viewer.readFrameLength,
      state.viewer.readFrameLength && state.viewer.readFrameLength.ok ? chip('info', 'control') : ''],
  ]);

  html += table('1–3 · Origin boundary (plain, unsandboxed iframe)', [
    ['viewer reads frame document.title', state.viewer.readFrameDocument, blockedChip(state.viewer.readFrameDocument)],
    ['viewer reads frame location.href', state.viewer.readFrameLocation, blockedChip(state.viewer.readFrameLocation)],
    ['frame reads parent document.title', frame.readParentDom, blockedChip(frame.readParentDom)],
    ['frame reads top location.href', frame.readTopLocation, blockedChip(frame.readTopLocation)],
    ['event.origin seen by viewer', state.eventOrigins.plain || '(none yet)',
      state.eventOrigins.plain ? (state.eventOrigins.plain === CONTENT_ORIGIN ? chip('good', 'distinct origin') : chip('bad', 'unexpected')) : ''],
    ['message with correct targetOrigin', correct.length ? 'delivered · frame saw origin ' + correct[0].sawOrigin : '(none)',
      correct.length ? chip('good', 'delivered') : chip('warn', 'not delivered')],
    ['message with wrong targetOrigin', wrong.length ? 'DELIVERED — ' + JSON.stringify(wrong) : 'dropped',
      wrong.length ? chip('bad', 'delivered') : chip('good', 'dropped')],
  ]);

  html += table('4 · Storage partitioning', [
    ['frame localStorage', frame.localStorage, ''],
    ['frame sessionStorage', frame.sessionStorage, ''],
    ['frame IndexedDB', frame.indexedDB, ''],
    ['viewer IndexedDB', state.viewer.indexedDB, ''],
    ['viewer reads frame keys', state.viewer.readOwnStorage, ''],
    ['verdict', shared.length ? shared.join('; ') : 'no key crossed the boundary',
      shared.length ? chip('bad', 'shared') : chip('good', 'partitioned')],
  ]);

  html += table('5 · Cookies (host/domain-scoped — ignores port and scheme)', [
    ['content host tried to set', frame.cookiesAttempted, ''],
    ['content host document.cookie', frame.documentCookie, ''],
    ['server sees on content host', frame.serverSeesCookies, ''],
    ['viewer document.cookie', state.viewer.documentCookie, ''],
    ['server sees on viewer host', state.viewer.serverSeesCookies, ''],
    ['leak', cookies.leaked ? 'reached viewer host: ' + cookies.names.join(', ') : 'nothing from the content host reached the viewer host',
      cookies.leaked ? chip('bad', 'leaked') : chip('good', 'contained')],
  ]);

  html += table('6 · document.domain escape hatch (runs last)', [
    ['frame set document.domain', state.escape.frameRelaxed, ''],
    ['viewer set document.domain', state.escape.viewerRelaxed, ''],
    ['DOM access after both relaxed', state.escape.readFrameDomAfter,
      state.escape.readFrameDomAfter ? (state.escape.readFrameDomAfter.ok ? chip('bad', 'boundary collapsed') : chip('good', 'still blocked')) : ''],
  ]);

  html += table('7 · Secure context (no TLS)', [
    ['viewer isSecureContext', state.viewer.isSecureContext,
      state.viewer.isSecureContext && state.viewer.isSecureContext.value ? chip('good', 'secure') : chip('warn', 'not secure')],
    ['content isSecureContext', frame.isSecureContext,
      frame.isSecureContext && frame.isSecureContext.value ? chip('good', 'secure') : chip('warn', 'not secure')],
    ['content crossOriginIsolated', frame.crossOriginIsolated, chip('info', 'info')],
  ]);

  html += table('8 · Under sandbox="allow-scripts" (ADR-0003\\'s config)', [
    ['event.origin seen by viewer', state.eventOrigins.sandbox || '(none yet)',
      state.eventOrigins.sandbox === 'null' ? chip('good', 'opaque origin') : chip('info', String(state.eventOrigins.sandbox))],
    ['sandboxed frame origin', sandbox.origin, ''],
    ['sandboxed frame localStorage', sandbox.localStorage, blockedChip(sandbox.localStorage)],
    ['sandboxed frame reads parent DOM', sandbox.readParentDom, blockedChip(sandbox.readParentDom)],
  ]);

  document.getElementById('tables').innerHTML = html;
}

document.getElementById('copy').addEventListener('click', function () {
  var v = verdict();
  var md = '## ' + v.text + '\\n\\n' + v.note + '\\n\\n' +
    '- userAgent: \\u0060' + navigator.userAgent + '\\u0060\\n' +
    '- platform: \\u0060' + (navigator.userAgentData ? navigator.userAgentData.platform : navigator.platform) + '\\u0060\\n' +
    '- viewer: \\u0060' + VIEWER_ORIGIN + '\\u0060  content: \\u0060' + CONTENT_ORIGIN + '\\u0060\\n\\n' +
    '\\u0060\\u0060\\u0060json\\n' + JSON.stringify(state, null, 2) + '\\n\\u0060\\u0060\\u0060\\n';
  navigator.clipboard.writeText(md).then(function () {
    document.getElementById('copy').textContent = 'Copied — paste into issue #23';
  }, function () {
    var pre = document.createElement('pre');
    pre.textContent = md;
    document.body.appendChild(pre);
  });
});

render();
boot();
</script>`;
}
