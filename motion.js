// The page's motion, apart from app.js: a file landing in its tile, and the report coming in. Every animation starts
// from the page as it already stands and, finished or cut short, leaves none of its own styles behind, so when
// anime.js does not load, or the reader's system asks for less motion, the page is the same, only still. Nothing here
// waits on the grader or holds it up.

const still = matchMedia("(prefers-reduced-motion: reduce)");
const WRITTEN = ["opacity", "transform", "stroke-dashoffset"];   // the inline styles these animations set

function clear(els) { for (const el of els) for (const p of WRITTEN) el.style.removeProperty(p); }

// whatever still runs on els is stopped and its styles cleared: an animation replaced or cut short never finishes,
// and the values it left would otherwise stay
function stop(anime, els) { anime.remove(els); clear(els); }

function play(anime, els, params) {
  els = els.filter(Boolean);
  if (!els.length) return;
  stop(anime, els);
  anime.animate(els, { ...params, onComplete: () => clear(els) });
}

const parts = (tile) => [tile.querySelector(".bar"), tile.querySelector(".tick path"), tile.querySelector(".picked")];

function land(anime, tile) {
  const [bar, tick, line] = parts(tile);
  play(anime, [bar], { scaleX: [0, 1], duration: 650, ease: "outExpo" });
  play(anime, [tick], { strokeDashoffset: [1, 0], duration: 420, delay: 180, ease: "inOutQuad" });
  play(anime, [line], { opacity: [0, 1], translateY: [6, 0], duration: 380, ease: "outQuad" });
}

const underline = () => [document.querySelector("#h-result .scribble path")];
const report = () => [...document.querySelectorAll("#result-line, #result .actions button, #report")];

function arrive(anime) {
  play(anime, underline(), { strokeDashoffset: [1, 0], duration: 800, delay: 250, ease: "inOutQuad" });
  play(anime, report(), { opacity: [0, 1], translateY: [10, 0], duration: 450, delay: anime.stagger(70), ease: "outQuad" });
}

async function start() {
  if (still.matches) return;
  const anime = await import("./vendor/anime.esm.min.js");
  const tiles = new MutationObserver((changes) => {
    for (const c of changes) {
      const was = (c.oldValue || "").split(/\s+/).includes("filled"), now = c.target.classList.contains("filled");
      if (now && !was && !still.matches) land(anime, c.target);
      else if (!now && was) stop(anime, parts(c.target));   // cleared while it landed: the tile is empty at once
    }
  });
  for (const tile of document.querySelectorAll(".file")) {
    tiles.observe(tile, { attributes: true, attributeFilter: ["class"], attributeOldValue: true });
  }
  const result = document.getElementById("result");
  new MutationObserver(() => {
    if (result.hidden) stop(anime, [...underline(), ...report()]);   // a new round: the last arrival ends here
    else if (!still.matches) arrive(anime);
  }).observe(result, { attributes: true, attributeFilter: ["hidden"] });
}

// exported for tests/test_site_motion.py, which runs this file under Node
export const started = start().catch(() => { /* motion is a nicety: without it the page stands as it is */ });
