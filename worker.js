// The grader's worker: Python (Pyodide) runs here so the page stays responsive. app.js starts it from a blob: URL,
// prefixed with `const BASE = "<the page's folder URL>";`, so it runs under the page's Content-Security-Policy: it can
// load the page's own files and reach the listed hosts, nothing else. The key arrives with a round and stays in
// this worker's memory for that round only.

let py = null, entry = null;

// One synchronous request for Python (browser/entry.py make_transport). Synchronous XHR is allowed in a worker, and it
// lets the grader's code stay the same plain, blocking Python it is on the desktop.
function xhr(method, url, headersJson, body, timeoutMs) {
  const r = new XMLHttpRequest();
  r.open(method, url, false);
  r.responseType = "arraybuffer";
  r.timeout = timeoutMs;
  const headers = JSON.parse(headersJson);
  for (const k of Object.keys(headers)) r.setRequestHeader(k, headers[k]);
  r.send(body ?? null);
  return [r.status, r.getResponseHeader("Content-Type") || "", new Uint8Array(r.response || new ArrayBuffer(0))];
}

function post(kind, payload) { self.postMessage({ type: "progress", kind, payload }); }

async function init() {
  const { loadPyodide } = await import(BASE + "pyodide/pyodide.mjs");
  // stdout/stderr dropped: the console should never carry anything from a paper
  py = await loadPyodide({ indexURL: BASE + "pyodide/", stdout: () => {}, stderr: () => {} });
  const app = await (await fetch(BASE + "app.zip")).arrayBuffer();
  py.unpackArchive(app, "zip", { extractDir: "/app" });
  py.runPython("import sys; sys.path.insert(0, '/app')");
  entry = py.pyimport("browser.entry");
  self.postMessage({ type: "ready" });
}

function safeName(name, seen) {
  // the file's own name (sheet rows are matched to papers by it), without any folder part or control characters
  let n = String(name).split(/[\\/]/).pop().replace(/[\u0000-\u001f\u007f]/g, "").slice(-200) || "paper";
  if (n === "." || n === "..") n = "paper";
  while (seen.has(n)) n = "_" + n;
  seen.add(n);
  return n;
}

function grade(files, opts) {
  py.runPython("import shutil, os; shutil.rmtree('/work/in', ignore_errors=True); os.makedirs('/work/in/papers')");
  const seen = new Set();
  for (const f of files) {
    const bytes = new Uint8Array(f.data);
    if (f.kind === "sheet") py.FS.writeFile("/work/in/sheet.csv", bytes);
    else if (f.kind === "rubric") py.FS.writeFile("/work/in/rubric.toml", bytes);
    else py.FS.writeFile("/work/in/papers/" + safeName(f.name, seen), bytes);
  }
  let out;
  try {
    out = JSON.parse(entry.run(JSON.stringify(opts), xhr, post));
  } finally {   // the papers leave memory with the round, however it ended (entry.run also clears them)
    py.runPython("import shutil; shutil.rmtree('/work/in', ignore_errors=True); shutil.rmtree('/work/data', ignore_errors=True)");
  }
  if (!out.ok) {
    self.postMessage({ type: "error", message: out.error });
    return;
  }
  const dir = `/work/${out.slug}/`;
  const report = py.FS.readFile(dir + "report.html", { encoding: "utf8" });
  const summary = py.FS.readFile(dir + "summary.csv");
  const zip = py.FS.readFile("/work/result.zip");
  self.postMessage({ type: "done", out, report, summary, zip }, [summary.buffer, zip.buffer]);
}

self.onmessage = async (e) => {
  const m = e.data;
  try {
    if (m.type === "init") await init();
    else if (m.type === "grade") grade(m.files, m.opts);
  } catch (err) {
    // the error's own text can quote a paper; only its kind is shown. Python keeps the last error, and with it the
    // round's frame (the key among its locals), until it is cleared.
    try { py?.runPython("import sys, gc; sys.last_exc = sys.last_value = sys.last_traceback = sys.last_type = None; gc.collect()"); } catch { /* ignore */ }
    const kind = (err && (err.type || err.name)) || "error";
    self.postMessage({ type: "error", message: m.type === "init"
      ? "The grader could not load. Check the connection and reload the page."
      : `The grader stopped unexpectedly (${kind}). Reload the page and try again.` });
  }
};
