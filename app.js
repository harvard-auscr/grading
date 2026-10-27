// The page: collects the round's files and settings, hands them to the grader's worker, shows progress and the report.
// The worker is started from a blob: URL so it runs under this page's Content-Security-Policy (see worker.js).

const $ = (id) => document.getElementById(id);

// The grader runs only on these hosts, over https, and never inside a frame. Every project site of a GitHub
// organization shares one origin (harvard-auscr.github.io, with the HAUSCR website): their scripts can read this
// page's storage, so on github.io only the round's settings are kept, never the key or the rubric.
const HOSTS = ["harvard-auscr.github.io", "grader.hauscr.org", "localhost", "127.0.0.1"];
const HOST = location.hostname.replace(/\.$/, "").toLowerCase();
const LOCAL = HOST === "localhost" || HOST === "127.0.0.1";
const SHARED = HOST.endsWith(".github.io");
const REFUSE = window.top !== window.self
  ? "The grader does not run inside another page. Open it directly."
  : HOSTS.includes(HOST) && (LOCAL || location.protocol === "https:") ? ""
  : "The grader runs only at https://harvard-auscr.github.io/grading/. Open it there.";
try { window.opener = null; } catch { /* a page that opened this one keeps no handle on it */ }

// localStorage is a convenience only: private windows and blocked storage throw, and the page works without it.
const K = { key: "grader.key", rubric: "grader.rubric", round: "grader.round" };
const KEPT = SHARED ? [K.round] : [K.key, K.rubric, K.round];
const saved = {
  get(k) { try { return KEPT.includes(k) ? localStorage.getItem(k) : null; } catch { return null; } },
  set(k, v) {
    try { if (v == null || !KEPT.includes(k)) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* ignore */ }
  },
};

const picked = { papers: [], sheet: null, rubric: null };   // File objects; rubric may be {name, text} from last time
let worker = null, ready = false, busy = false, last = null, graded = false, roundKey = "";

function say(text) { $("state").textContent = text; }
function note(text) { $("note").textContent = text; }   // the live region stays in place, so its first text is read
function readyLine() {
  if (ready && !busy && !REFUSE) say(picked.papers.length && picked.rubric ? "Ready." : "Ready. Add the round's files.");
}
function fail(text) {
  const e = $("error");
  e.textContent = text;
  e.hidden = false;
  busy = false;
  $("bar").hidden = true;
  say("");
  update();
  e.focus();
}
function clearError() { $("error").hidden = true; $("error").textContent = ""; }
function plural(n, one, many) { return `${n} ${n === 1 ? one : many}`; }

function kb(n) { return n < 1e6 ? `${Math.max(1, Math.round(n / 1e3))} KB` : `${(n / 1e6).toFixed(1)} MB`; }
function ext(name) { const i = name.lastIndexOf("."); return i < 0 ? "" : name.slice(i).toLowerCase(); }

function showPicked() {
  const p = picked.papers;
  $("papers-picked").textContent = p.length
    ? (p.length === 1 ? `${p[0].name} (${kb(p[0].size)})` : `${p.length} files (${kb(p.reduce((s, f) => s + f.size, 0))})`)
    : "";
  $("papers-clear").hidden = !p.length;
  $("sheet-picked").textContent = picked.sheet ? picked.sheet.name : "";
  $("rubric-picked").textContent = picked.rubric
    ? (picked.rubric instanceof File ? picked.rubric.name : `${picked.rubric.name} (from last time)`) : "";
}

function idsHint() {
  const p = $("program").value.trim().toLowerCase() || $("program").placeholder;
  $("ids-hint").textContent = `The papers are numbered ${p}-01, ${p}-02, …`;
}

function update() {
  $("grade").disabled = Boolean(REFUSE) || !ready || busy || !picked.papers.length || !picked.rubric;
  idsHint();
}

function take(files) {
  // Sort what was dropped or picked by kind: papers, the mastersheet, the rubric. Anything else is named, not taken.
  if (REFUSE) return;
  const skipped = [], notes = [];
  if (graded && files.some((f) => [".zip", ".docx"].includes(ext(f.name)))) {
    // papers dropped after a round start the next round: they replace the last round's papers, never join them
    if (picked.papers.length) notes.push("The last round's papers were set aside for these.");
    picked.papers = [];
    graded = false;
  }
  for (const f of files) {
    const x = ext(f.name);
    if (x === ".csv") picked.sheet = f;
    else if (x === ".toml") setRubric(f);
    else if (x === ".zip" || x === ".docx") {
      if (!picked.papers.some((g) => g.name === f.name && g.size === f.size)) picked.papers.push(f);
    } else skipped.push(x === ".xlsx" || x === ".xls" ? `${f.name} (the mastersheet must be a .csv: File, Download, Comma-separated values)` : f.name);
  }
  if (skipped.length) notes.push(`Skipped ${skipped.join("; ")}: only .zip and .docx papers, a .csv mastersheet and a .toml rubric are used.`);
  note(notes.join(" "));
  showPicked();
  update();
  readyLine();
}

function stemOf(name) { return name.replace(/\.toml$/i, "").toLowerCase(); }

// left empty, the program is the rubric's file name (browser/entry.py takes it from there too)
function programFrom(name) {
  const stem = stemOf(name.trim()).replace(/\s*\(\d+\)$/, "").replace(/[^a-z0-9]/g, "").slice(0, 16);
  $("program").placeholder = /^[a-z]/.test(stem) ? stem : "paper";
}

function setRubric(f) {
  picked.rubric = f;
  programFrom(f.name);
  // remembered only when it is UTF-8, so the copy from last time is the file itself and never a guess at it
  f.arrayBuffer().then((buf) => {
    let text;
    try { text = new TextDecoder("utf-8", { fatal: true }).decode(buf); } catch { saved.set(K.rubric, null); return; }
    saved.set(K.rubric, JSON.stringify({ name: f.name, text }));
  });
}

function restore() {
  try {
    const r = JSON.parse(saved.get(K.rubric) || "null");
    if (r && typeof r.name === "string" && typeof r.text === "string") { picked.rubric = r; programFrom(r.name); }
  } catch { /* a damaged entry is ignored */ }
  try {
    const r = JSON.parse(saved.get(K.round) || "null");
    if (r) {
      // only what was typed here is kept (v2): an older page saved the rubric's name as if it had been typed
      if (r.v === 2 && typeof r.program === "string") $("program").value = r.program;
      if (r.provider === "openai" || r.provider === "deepseek") $("provider").value = r.provider;
    }
  } catch { /* ignore */ }
  const key = saved.get(K.key);
  if (key) { $("key").value = key; $("remember").checked = true; }
}

async function startWorker() {
  const base = new URL(".", location.href).href;
  const src = await (await fetch("worker.js", { cache: "no-cache" })).text();
  const blob = new Blob([`const BASE = ${JSON.stringify(base)};\n`, src], { type: "text/javascript" });
  worker = new Worker(URL.createObjectURL(blob), { type: "module" });
  worker.onmessage = (e) => onMessage(e.data);
  worker.onerror = () => fail("The grader could not start in this browser. Try a recent Chrome, Edge, Firefox or Safari.");
  worker.postMessage({ type: "init" });
}

function onMessage(m) {
  if (m.type === "ready") {
    ready = true;
    readyLine();
    update();
  } else if (m.type === "progress") {
    const p = JSON.parse(m.payload);
    const bar = $("bar");
    if (m.kind === "ingest") {
      const n = p.stored + p.present, bits = [];
      if (p.unreadable) bits.push(`${plural(p.unreadable, "file", "files")} could not be read`);
      if (p.unmatched_rows) bits.push(`${plural(p.unmatched_rows, "sheet row", "sheet rows")} had no file`);
      if (p.same_name) bits.push(`${plural(p.same_name, "file", "files")} left out for sharing a name with another`);
      bar.max = Math.max(1, n); bar.value = 0;
      say(`Found ${plural(n, "paper", "papers")}${bits.length ? `; ${bits.join(", ")}` : ""}. Grading…`);
    } else if (m.kind === "paper") {
      bar.max = Math.max(1, p.total); bar.value = p.done;
      say(`Graded ${p.done} of ${p.total}.`);
    } else if (m.kind === "report") {
      say("Building the report…");
    }
  } else if (m.type === "done") {
    busy = false;
    graded = true;
    last = m;
    // the key is remembered only once a round has used it (a key the grader refused is never kept)
    saved.set(K.key, $("remember").checked && roundKey && (m.out.llm_status === 200 || !m.out.llm_status) ? roundKey : null);
    roundKey = "";
    $("bar").hidden = true;
    showResult(m);
    update();
  } else if (m.type === "error") {
    roundKey = "";
    fail(m.message);
  }
}

function showResult(m) {
  const o = m.out, s = o.summary, n = o.ingest || {}, lines = [];
  lines.push(`${s.ok} of ${plural(s.papers, "paper", "papers")} graded.`);
  if (s.papers > s.ok) lines.push(`${plural(s.papers - s.ok, "paper", "papers")} could not be parsed; listed at the end of the report.`);
  if (n.unreadable) lines.push(`${plural(n.unreadable, "file", "files")} could not be read (over 30 MB or damaged) and ${n.unreadable === 1 ? "is" : "are"} not in the report.`);
  if (n.unmatched_rows) lines.push(`${plural(n.unmatched_rows, "sheet row", "sheet rows")} had no matching file.`);
  if (n.same_name) lines.push(`${plural(n.same_name, "file was", "files were")} left out because another file has the same name (only one of each name is graded).`);
  if (o.no_ai) lines.push(`${plural(o.no_ai, "paper has", "papers have")} no row with a name on the mastersheet, so ${o.no_ai === 1 ? "its" : "their"} AI checks were skipped.`);
  const st = o.llm_status;
  if (st && st !== 200) {
    lines.push(st === 401 || st === 403 ? "The AI service refused the key, so the AI checks did not run."
      : st === 402 ? "The AI service says the key has no balance left, so the AI checks did not run."
      : st === 429 ? "The AI service was too busy for some requests, so some AI checks did not run. Try again later."
      : typeof st === "number" && st >= 500 ? "The AI service had a problem on its side, so some AI checks did not run."
      : typeof st === "number" ? "The AI service turned some requests down, so some AI checks did not run."
      : "The AI service could not be reached, so some AI checks did not run. Check the connection.");
  } else if (!o.llm) {
    lines.push("No key was added, so the AI checks were skipped.");
  }
  $("result-line").textContent = lines.join(" ");
  $("report").srcdoc = m.report;
  $("result").hidden = false;
  say("Done.");
  $("h-result").focus();
  $("result").scrollIntoView({ behavior: "smooth", block: "start" });
}

function download(data, name, type) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement("a");
  a.href = url; a.download = name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

async function grade() {
  clearError();
  const key = $("key").value.trim();
  if (key && !picked.sheet) {
    fail("With a key, add the mastersheet too: its names are what the grader masks before any text goes to the AI service.");
    return;
  }
  const typed = $("program").value.trim().toLowerCase();
  const opts = { program: typed || $("program").placeholder, key, provider: $("provider").value,
                 offline: !$("online").checked, rubric_name: picked.rubric.name };
  saved.set(K.round, JSON.stringify({ v: 2, program: typed, provider: opts.provider }));
  roundKey = key;
  if (!$("remember").checked) saved.set(K.key, null);
  if (SHARED) $("key").value = "";   // no filled password field is left for the browser to offer to save

  busy = true; update();
  $("result").hidden = true;
  say("Reading the files…");
  const files = [];
  try {
    for (const f of picked.papers) files.push({ kind: "paper", name: f.name, data: await f.arrayBuffer() });
    if (picked.sheet) files.push({ kind: "sheet", name: "sheet.csv", data: await picked.sheet.arrayBuffer() });
    const rub = picked.rubric instanceof File ? await picked.rubric.arrayBuffer()
                                              : new TextEncoder().encode(picked.rubric.text).buffer;
    files.push({ kind: "rubric", name: "rubric.toml", data: rub });
  } catch {
    picked.papers = []; picked.sheet = null;
    if (picked.rubric instanceof File) picked.rubric = null;
    showPicked();
    fail("A file changed or moved after you picked it. Pick the files again.");
    return;
  }
  const bar = $("bar"); bar.hidden = false; bar.removeAttribute("value");
  say("Starting…");
  worker.postMessage({ type: "grade", files, opts }, files.map((f) => f.data));
}

// ---- wiring ----
for (const id of ["papers", "sheet", "rubric"]) {
  $(id).addEventListener("change", (e) => {
    take([...e.target.files]);   // papers add up, as Drive splits a big folder into several zips; Clear starts over
    e.target.value = "";         // picking the same file again still fires change
  });
}
$("papers-clear").addEventListener("click", () => { picked.papers = []; note(""); showPicked(); update(); readyLine(); });
$("program").addEventListener("input", update);
$("remember").addEventListener("change", () => { if (!$("remember").checked) saved.set(K.key, null); });
$("grade").addEventListener("click", grade);
$("dl-report").addEventListener("click", () => last && download(last.report, `${last.out.slug}-report.html`, "text/html"));
$("dl-summary").addEventListener("click", () => last && download(last.summary, `${last.out.slug}-summary.csv`, "text/csv"));
$("dl-all").addEventListener("click", () => last && download(last.zip, `${last.out.slug}.zip`, "application/zip"));

let depth = 0;
addEventListener("dragenter", (e) => { e.preventDefault(); depth++; document.body.classList.add("dragging"); });
addEventListener("dragleave", () => { if (--depth <= 0) { depth = 0; document.body.classList.remove("dragging"); } });
addEventListener("dragover", (e) => e.preventDefault());
addEventListener("drop", (e) => {
  e.preventDefault(); depth = 0; document.body.classList.remove("dragging");
  if (!busy && !REFUSE && e.dataTransfer?.files?.length) take([...e.dataTransfer.files]);
});
addEventListener("beforeunload", (e) => { if (busy) e.preventDefault(); });
addEventListener("pagehide", () => { if (SHARED) $("key").value = ""; });

if (REFUSE) {
  // nothing on a refused page takes input or stores anything
  for (const el of document.querySelectorAll("input, select, button")) el.disabled = true;
  update();
  fail(REFUSE);
} else {
  if (SHARED) {
    // the key is typed for each round; a key or rubric left by an older version of the page is removed
    saved.set(K.key, null); saved.set(K.rubric, null);
    $("remember").checked = false; $("remember").disabled = true;
    $("remember").closest("label").hidden = true;
    $("rubric-kept").hidden = true;
    $("key-not-kept").hidden = false;
  }
  restore();
  showPicked();
  update();
  startWorker().catch(() => fail("The grader could not load. Check the connection and reload the page."));
}
