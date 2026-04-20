type Access = "car" | "ferry" | "bart" | "caltrain" | "smart" | "bus";
type Region = "sf" | "bay_area";

interface Idea {
  id: string;
  title: string;
  region: Region;
  subregion: string;
  access: Access[];
  tags: string[];
  notes?: string;
}

const SUBREGION_LABEL: Record<string, string> = {
  westside: "SF · Westside",
  eastside: "SF · Eastside",
  middle: "SF · Middle",
  north: "SF · North",
  north_bay: "North Bay & Marin",
  east_bay: "East Bay",
  peninsula_south: "Peninsula & South",
};

const ACCESS_LABEL: Record<Access, string> = {
  car: "Car",
  ferry: "Ferry",
  bart: "BART",
  caltrain: "Caltrain",
  smart: "SMART",
  bus: "Bus",
};

const ideas: Idea[] = (window as unknown as { __IDEAS__: Idea[] }).__IDEAS__;

const state = {
  locations: new Set<string>(),
  access: new Set<Access>(),
  tags: new Set<string>(),
  lastPick: null as Idea | null,
};

const $ = <T extends HTMLElement>(s: string) =>
  document.querySelector(s) as T;
const $$ = <T extends HTMLElement>(s: string) =>
  Array.from(document.querySelectorAll(s)) as T[];

const card = $<HTMLDivElement>("#card");
const ticker = $<HTMLSpanElement>("#ticker");
const meta = $<HTMLDivElement>("#meta");
const metaWhere = $<HTMLSpanElement>("#meta-where");
const metaAccessRow = $<HTMLDivElement>("#meta-access-row");
const metaAccess = $<HTMLSpanElement>("#meta-access");
const metaTags = $<HTMLSpanElement>("#meta-tags");
const pickBtn = $<HTMLButtonElement>("#pick");
const resetBtn = $<HTMLButtonElement>("#reset");
const poolEl = $<HTMLParagraphElement>("#pool");

function filtered(): Idea[] {
  const locs = state.locations;
  const acc = state.access;
  const tags = state.tags;
  return ideas.filter((i) => {
    const locKey = `${i.region}:${i.subregion}`;
    if (locs.size > 0 && !locs.has(locKey)) return false;
    if (acc.size > 0) {
      if (i.region === "sf") return false;
      if (!i.access.some((a) => acc.has(a))) return false;
    }
    if (tags.size > 0) {
      if (!i.tags.some((t) => tags.has(t))) return false;
    }
    return true;
  });
}

function refreshPool() {
  const pool = filtered();
  const any = pool.length > 0;
  pickBtn.disabled = !any;
  const bayAreaSelected =
    state.locations.size === 0 ||
    Array.from(state.locations).some((l) => l.startsWith("bay_area"));
  $$<HTMLButtonElement>('.chip[data-kind="access"]').forEach((c) => {
    c.disabled = !bayAreaSelected;
  });
  if (!any) {
    poolEl.textContent =
      "nothing matches — loosen a filter to cast a wider net";
  } else if (
    state.locations.size === 0 &&
    state.access.size === 0 &&
    state.tags.size === 0
  ) {
    poolEl.textContent = `${pool.length} specimens in the catalogue`;
  } else {
    poolEl.textContent = `${pool.length} matching ${
      pool.length === 1 ? "specimen" : "specimens"
    }`;
  }
}

function toggleChip(btn: HTMLButtonElement) {
  const kind = btn.dataset.kind!;
  const value = btn.dataset.value!;
  const set: Set<string> =
    kind === "location"
      ? state.locations
      : kind === "access"
        ? (state.access as Set<string>)
        : state.tags;
  if (set.has(value)) {
    set.delete(value);
    btn.setAttribute("aria-pressed", "false");
  } else {
    set.add(value);
    btn.setAttribute("aria-pressed", "true");
  }
  refreshPool();
}

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function renderReveal(pick: Idea) {
  ticker.textContent = pick.title;
  ticker.classList.remove("rolling");
  ticker.classList.remove("settling");
  // reflow to restart animation
  void ticker.offsetWidth;
  ticker.classList.add("settling");

  metaWhere.textContent = SUBREGION_LABEL[pick.subregion] ?? pick.subregion;
  if (pick.access.length > 0) {
    metaAccess.textContent = pick.access
      .map((a) => ACCESS_LABEL[a])
      .join(" / ");
    metaAccessRow.hidden = false;
  } else {
    metaAccessRow.hidden = true;
  }
  metaTags.innerHTML = pick.tags
    .map((t) => `<span class="tag">${t.replace("-", " ")}</span>`)
    .join("");
  meta.hidden = false;
  // restart fade-in animation
  meta.style.animation = "none";
  void meta.offsetWidth;
  meta.style.animation = "";
  card.dataset.state = "revealed";
  // restart vine-draw
  const path = card.querySelector<SVGPathElement>(".card-vine path");
  if (path) {
    path.style.animation = "none";
    void path.getBoundingClientRect();
    path.style.animation = "";
  }
}

async function roll() {
  const pool = filtered();
  if (pool.length === 0) return;
  const final = pool[Math.floor(Math.random() * pool.length)];

  if (prefersReducedMotion() || pool.length === 1) {
    renderReveal(final);
    return;
  }

  pickBtn.disabled = true;
  card.dataset.state = "rolling";
  meta.hidden = true;
  ticker.classList.add("rolling");

  const frames = 16;
  const titles: string[] = [];
  let last = "";
  for (let i = 0; i < frames - 1; i++) {
    let t: string;
    do {
      t = pool[Math.floor(Math.random() * pool.length)].title;
    } while (t === last && pool.length > 1);
    titles.push(t);
    last = t;
  }
  titles.push(final.title);

  // ease-out cubic cumulative timing over ~2100ms
  const total = 2100;
  const delays: number[] = [];
  for (let i = 1; i <= frames; i++) {
    const t = i / frames;
    const eased = 1 - Math.pow(1 - t, 3);
    delays.push(eased * total);
  }

  await new Promise<void>((resolve) => {
    titles.forEach((title, idx) => {
      setTimeout(() => {
        if (idx < frames - 1) {
          ticker.textContent = title;
          ticker.classList.remove("settling");
          void ticker.offsetWidth;
          ticker.classList.add("settling");
        } else {
          ticker.classList.remove("rolling");
          setTimeout(() => {
            renderReveal(final);
            resolve();
          }, 160);
        }
      }, delays[idx]);
    });
  });

  pickBtn.disabled = false;
  state.lastPick = final;
}

function init() {
  $$<HTMLButtonElement>(".chip").forEach((btn) => {
    btn.setAttribute("aria-pressed", "false");
    btn.addEventListener("click", () => toggleChip(btn));
  });
  pickBtn.addEventListener("click", () => {
    void roll();
  });
  resetBtn.addEventListener("click", () => {
    state.locations.clear();
    state.access.clear();
    state.tags.clear();
    $$<HTMLButtonElement>(".chip").forEach((c) =>
      c.setAttribute("aria-pressed", "false"),
    );
    refreshPool();
  });
  refreshPool();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
