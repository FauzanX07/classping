// Class Ping on the web: your Google Classroom as a to-do list, in the browser.
// Read-only, no server: everything is kept in this browser, and the only
// requests that leave it go to Google.

import * as auth from "./auth.js";
import * as api from "./api.js";
import * as store from "./store.js";
import { classify } from "./sort.js";
import { sample } from "./demo.js";
import { SYNC_EVERY_MS, FIRST_READ_MOST, REFRESH_READ_MOST, SUPPORT_EMAIL } from "./config.js";

const SECTIONS = ["Homework", "Classwork", "Important", "Extra", "Notes"];
const KIND_LABEL = { announcement: "Announcement", assignment: "Assignment", material: "Material", question: "Question" };
const FILE_BADGE = { video: "VIDEO", pdf: "PDF", doc: "DOC", sheet: "SHEET", slides: "SLIDES", image: "IMAGE", form: "FORM", link: "LINK", file: "FILE" };
const RANGES = [["any", "All time"], ["today", "Today"], ["yesterday", "Yesterday"], ["20days", "Last 20 days"]];
const PAGE = 30;
const THEMES = [["system", "Match my device"], ["study-lamp", "Evergreen"], ["parchment", "Parchment"],
  ["chalkboard", "Chalkboard"], ["midnight-ink", "Midnight Ink"], ["ebony", "Ebony"]];
const SITE_PREFS = "classping-site-settings";      // the same key the rest of the site uses

const S = {
  view: "todo", course: "any", range: "any", showDone: false, q: "", limit: PAGE,
  posts: [], courses: [], names: {}, marks: { done: {}, moved: {}, seen: {}, firstSync: false },
  email: "", demo: false, lastSync: "", syncing: false, needSignIn: false, error: "", status: "",
  seenAtLoad: new Set(), drawer: false, expanded: new Set(), connecting: false,
  gen: 0,                                                     // bumps when a different account starts over
  pick: { start: "", tick: "", back: "" }, bulkNote: "",     // the old-work choices and what the last one did
};

const $ = (selector, root = document) => root.querySelector(selector);
const esc = (text) => String(text == null ? "" : text).replace(/[&<>"']/g,
  (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// -- times -------------------------------------------------------------------------------

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dayKey = (d) => d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();

function clock(d) {
  let h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, "0");
  const suffix = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${h}:${m} ${suffix}`;
}

// "Today 4:30 PM", "Yesterday", "Tomorrow 11:59 PM", "12 Sep 2026"
function friendly(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d)) return "";
  const today = new Date();
  const step = (n) => { const x = new Date(today); x.setDate(x.getDate() + n); return dayKey(x); };
  const key = dayKey(d);
  const hasClock = !(d.getHours() === 0 && d.getMinutes() === 0);
  const when = hasClock ? " " + clock(d) : "";
  if (key === dayKey(today)) return "Today" + when;
  if (key === step(-1)) return "Yesterday" + when;
  if (key === step(1)) return "Tomorrow" + when;
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}${when}`;
}

function dueText(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return { text: "", late: false };
  const late = d.getTime() < Date.now();
  return { text: (late ? "Was due " : "Due ") + friendly(iso).replace(/^Today/, "today").replace(/^Tomorrow/, "tomorrow").replace(/^Yesterday/, "yesterday"), late };
}

const greeting = () => {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
};

function inRange(post, range) {
  if (range === "any") return true;
  const posted = new Date(post.postedAt || post.updatedAt);
  if (isNaN(posted)) return false;
  const today = new Date();
  const ago = (n) => { const x = new Date(today); x.setDate(x.getDate() - n); return x; };
  if (range === "today") return dayKey(posted) === dayKey(today);
  if (range === "yesterday") return dayKey(posted) === dayKey(ago(1));
  return posted >= ago(20);
}

const shortClass = (name) => { const t = String(name || "").trim(); const cut = t.indexOf("["); return cut > 0 ? t.slice(0, cut).trim() : t; };

// -- sorting -----------------------------------------------------------------------------

function sortPost(post) {
  try {
    const result = classify({ title: post.title, body: post.body, kind: post.kind, due_at: post.dueAt });
    post.section = result.section;
    post.why = result.why;
  } catch (e) {
    post.section = "Extra";
    post.why = "fallback";
  }
  return post;
}

const sectionOf = (post) => S.marks.moved[post.id] || post.section || "Extra";
const isDone = (post) => Boolean(S.marks.done[post.id]);
const when = (post) => post.postedAt || post.updatedAt || "";

function matches(post, query) {
  if (!query) return true;
  const hay = [post.title, post.body, post.author, post.courseName, ...post.files.map((f) => f.name)].join(" ").toLowerCase();
  return query.toLowerCase().split(/\s+/).filter(Boolean).every((word) => hay.includes(word));
}

// What a list shows. `ignore` leaves one filter out, to count what choosing it would show.
function list(view, { ignore = "" } = {}) {
  let rows = S.posts.filter((p) =>
    (ignore === "course" || S.course === "any" || p.courseId === S.course) &&
    (ignore === "range" || inRange(p, S.range)) &&
    (S.showDone || !isDone(p)) &&
    matches(p, S.q));
  if (view === "todo") {
    rows = rows.filter((p) => !isDone(p) && sectionOf(p) === "Homework");
    rows.sort((a, b) => {
      const x = a.dueAt ? Date.parse(a.dueAt) : Infinity, y = b.dueAt ? Date.parse(b.dueAt) : Infinity;
      return x - y || Date.parse(when(b)) - Date.parse(when(a));
    });
    return rows;
  }
  if (view !== "all") rows = rows.filter((p) => sectionOf(p) === view);
  return rows.sort((a, b) => Date.parse(when(b)) - Date.parse(when(a)));
}

// -- old work: tick off, or bring back, what was posted a while ago ----------------------------
// Any section. Never a post that is still new: one you have not looked at that was posted today.

const AGES = [["all", "Everything already posted", null], ["yesterday", "Yesterday and older", 1],
  ["3days", "3 days ago and older", 3], ["week", "A week ago and older", 7], ["2weeks", "2 weeks ago and older", 14]];

// The old posts that are (done) or are not (!done) ticked off yet.
function oldPosts(age, done) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = AGES.find((a) => a[0] === age)[2];
  const edge = new Date(today);
  if (days) edge.setDate(edge.getDate() - days + 1);
  return S.posts.filter((p) => {
    if (isDone(p) !== done) return false;
    const t = Date.parse(when(p));
    return days ? t < edge && Boolean(S.marks.seen[p.id]) : t < today || Boolean(S.marks.seen[p.id]);
  });
}

function oldOptions(done) {
  return AGES.map(([key, label]) => [key, label, oldPosts(key, done).length]).filter((o) => o[2]);
}

// tick: true marks them done, false puts them back. Returns how many changed.
function oldApply(age, tick) {
  const rows = oldPosts(age, !tick);
  for (const p of rows) { if (tick) S.marks.done[p.id] = Date.now(); else delete S.marks.done[p.id]; }
  persist();
  return rows.length;
}

function oldSelect(id, done, picked, label) {
  const found = oldOptions(done);
  if (!found.length) {
    return `<select class="ap-pick" id="${id}" disabled aria-label="${label}"><option>${done ? "Nothing ticked off yet" : "Nothing to tick off"}</option></select>`;
  }
  const chosen = found.some((o) => o[0] === picked) ? picked : (found.find((o) => o[0] === "yesterday") || found[0])[0];
  return `<select class="ap-pick" id="${id}" aria-label="${label}">` +
    found.map(([key, name, n]) => `<option value="${key}"${key === chosen ? " selected" : ""}>${name}  (${n})</option>`).join("") + `</select>`;
}

// -- keeping things ----------------------------------------------------------------------

let saving = 0;
async function save() {
  if (S.demo) return;                         // samples are never saved
  await store.set("posts", S.posts);
  await store.set("courses", S.courses);
  await store.set("names", S.names);
  await store.set("marks", S.marks);
  await store.set("lastSync", S.lastSync);
}
function persist() {
  clearTimeout(saving);
  saving = setTimeout(save, 400);
}
// A tick followed by closing the tab straight away must still be kept.
function saveNow() {
  if (!saving) return;
  clearTimeout(saving);
  saving = 0;
  save();
}

// -- reading Classroom -------------------------------------------------------------------

function explain(error) {
  const code = error && (error.code || error.reason || "");
  const text = String((error && error.message) || error || "");
  if (code === "access_denied") {
    return "Google did not let this account in. If it is a school account, your school may need to approve Class Ping first: try a personal Google account, or use the Windows app's Full features.";
  }
  if (/admin|access_not_configured|org_internal|restricted_client/i.test(code + " " + text)) {
    return "Google says your school's admin needs to review Class Ping, so it has not been approved there yet. Try a personal Google account, or use the Windows app's Full features.";
  }
  return text || "Something went wrong.";
}

async function sync({ quiet = false } = {}) {
  if (S.demo || S.syncing) return;
  if (!auth.signedIn()) { S.needSignIn = true; paintAll(); return; }
  S.syncing = true;
  S.error = "";
  const gen = S.gen;
  paintStatus(quiet ? "" : "Checking Classroom...");
  paintCheck();
  if ($("#ap-root").classList.contains("welcome-mode")) paintAll();   // say so, instead of sitting still
  const first = !S.lastSync;
  let token = "";
  try {
    token = auth.token();
    const mine = await api.courses(token);
    if (gen !== S.gen) return;
    const knownClasses = new Set(S.courses.map((c) => c.id));
    S.courses = mine;
    if (S.course !== "any" && !mine.some((c) => c.id === S.course)) S.course = "any";
    const since = first ? "" : new Date(Date.parse(S.lastSync) - 3600 * 1000).toISOString();
    const byId = new Map(S.posts.map((p) => [p.id, p]));
    const fresh = [];
    let finished = 0;
    paintStatus(`Reading ${mine.length} class${mine.length === 1 ? "" : "es"}...`);
    // Every class is read at the same time; the first read of a big account takes seconds, not a minute.
    // One class that cannot be read must not stop the rest. A class you have just joined is read in full.
    const failed = [];
    const reads = await Promise.all(mine.map(async (course) => {
      const everything = first || !knownClasses.has(course.id);
      try {
        const found = await api.readCourse(course, token, S.names, { since: everything ? "" : since, most: everything ? FIRST_READ_MOST : REFRESH_READ_MOST });
        finished += 1;
        paintStatus(`Read ${finished} of ${mine.length} class${mine.length === 1 ? "" : "es"}`);
        return found;
      } catch (error) {
        if (error && error.status === 401) throw error;
        failed.push({ course, error });
        return [];
      }
    }));
    if (gen !== S.gen) return;                  // the account changed while this was reading
    if (failed.length === mine.length && mine.length) throw failed[0].error;
    for (const found of reads) {
      for (const post of found) {
        sortPost(post);
        if (!byId.has(post.id)) fresh.push(post);
        byId.set(post.id, post);
      }
    }
    // A class you have left, or that was archived, goes too.
    if (mine.length) for (const [id, p] of byId) if (!mine.some((c) => c.id === p.courseId)) byId.delete(id);
    S.posts = [...byId.values()];
    if (!failed.length) {
      S.lastSync = new Date().toISOString();
    } else {
      // Not every class was read: keep the old time, so the next check reads from there again.
      S.error = `Could not read ${failed.map((f) => shortClass(f.course.name)).join(", ")} just now. It will be tried again.`;
    }
    S.needSignIn = false;
    if (first) {
      for (const p of S.posts) S.marks.seen[p.id] = 1;        // no backlog of "new" on the first read
      S.marks.firstSync = true;
      S.seenAtLoad = new Set(Object.keys(S.marks.seen));
    } else if (fresh.length) {
      tell(fresh);
    }
    persist();
  } catch (error) {
    if (error && error.status === 401) {
      if (!auth.token() || auth.token() === token) auth.forgetToken();     // not a newer one a click just renewed
      S.needSignIn = !auth.signedIn();
    } else {
      S.error = explain(error);
    }
  } finally {
    S.syncing = false;
    S.status = "";
    paintAll();
  }
}

// New posts: a note on the page, and a desktop notification if you allowed them.
function tell(fresh) {
  const first = fresh[0];
  const line = fresh.length === 1
    ? `${shortClass(first.courseName)}: ${first.title}`
    : `${fresh.length} new posts in Classroom`;
  toast(line);
  if (store.prefs().notify && "Notification" in window && Notification.permission === "granted") {
    try {
      new Notification(fresh.length === 1 ? shortClass(first.courseName) : "Class Ping", {
        body: fresh.length === 1 ? (first.title + (first.body ? ": " + first.body.slice(0, 120) : "")) : line,
        icon: "../logo.png", tag: "classping-new",
      });
    } catch (e) { /* the page can still show the toast */ }
  }
}

// -- signing in --------------------------------------------------------------------------

// Everything stored belongs to one Google account. Forget it all (not the look you chose).
async function startOver() {
  S.gen += 1;
  await store.wipe();
  Object.assign(S, { posts: [], courses: [], names: {}, lastSync: "", needSignIn: false, error: "", bulkNote: "",
    marks: { done: {}, moved: {}, seen: {}, firstSync: false }, view: "todo", q: "", course: "any", range: "any",
    limit: PAGE, seenAtLoad: new Set(), expanded: new Set(), pick: { start: "", tick: "", back: "" } });
}

async function connect(prompt = "") {
  S.error = "";
  S.connecting = true;
  paintAll();
  try {
    await auth.signIn({ prompt, hint: prompt === "select_account" ? "" : S.email });
    const missing = auth.missing();
    if (missing.length) {
      auth.forgetToken();
      S.error = "Class Ping needs every box ticked on Google's page to read your classes, announcements and classwork. Press Sign in and tick them all.";
      return;
    }
    if (S.demo) { S.demo = false; S.posts = []; S.courses = []; S.lastSync = ""; S.marks = { done: {}, moved: {}, seen: {}, firstSync: false }; }
    let who = "";
    try { who = await auth.email(); } catch (e) { /* the address is only shown */ }
    if (who && S.email && who.toLowerCase() !== S.email.toLowerCase()) {
      // A different account: the old one's classes, posts and ticks must not stay.
      await startOver();
    }
    S.email = who || S.email;
    store.savePrefs({ email: S.email });
    S.needSignIn = false;
  } catch (error) {
    if (error.code !== "superseded") S.error = explain(error);
    return;
  } finally {
    S.connecting = false;
    paintAll();
  }
  sync();
}

let renewing = false;
// A click is the one moment the browser lets Google's window open on its own,
// so a token that is running low is renewed then, quietly.
function renewOnClick() {
  if (renewing || S.demo || !auth.configured() || !S.posts.length) return;
  if (auth.signedIn() && auth.minutesLeft() > 8) return;
  if (!S.email && !auth.signedIn()) return;
  renewing = true;
  const gen = S.gen;
  auth.signIn({ prompt: "none", hint: S.email })
    .then(() => {
      if (gen !== S.gen) { auth.forgetToken(); return; }     // erased or switched while Google was answering
      S.needSignIn = false; paintAll(); sync({ quiet: true });
    })
    .catch(() => { if (!auth.signedIn()) { S.needSignIn = true; paintAll(); } })
    .finally(() => { renewing = false; });
}

async function signOutAndErase() {
  if (!confirm("Sign out, give Google's permission back, and erase everything Class Ping saved in this browser?")) return;
  S.gen += 1;                                  // anything still reading or signing in is now ignored
  const gone = auth.signOut();                 // Google can be slow to answer; the page is cleared meanwhile
  await store.wipe();
  store.forgetPrefs();
  Object.assign(S, { posts: [], courses: [], names: {}, lastSync: "", email: "", needSignIn: false, demo: false, error: "",
    marks: { done: {}, moved: {}, seen: {}, firstSync: false }, view: "todo", q: "", course: "any", range: "any" });
  paintAll();
  await Promise.race([gone, new Promise((resolve) => setTimeout(resolve, 6000))]);
}

// -- theme -------------------------------------------------------------------------------

function sitePrefs() {
  try { return { theme: "system", text: "normal", links: "plain", ...(JSON.parse(localStorage.getItem(SITE_PREFS) || "{}") || {}) }; }
  catch (e) { return { theme: "system", text: "normal", links: "plain" }; }
}
function setTheme(theme) {
  const next = { ...sitePrefs(), theme };
  try { localStorage.setItem(SITE_PREFS, JSON.stringify(next)); } catch (e) { /* blocked */ }
  const root = document.documentElement;
  if (theme === "system") root.removeAttribute("data-theme"); else root.setAttribute("data-theme", theme);
}

// -- drawing -----------------------------------------------------------------------------

function toast(text) {
  const box = $("#ap-toasts");
  if (!box) return;
  const item = document.createElement("div");
  item.className = "ap-toast";
  item.textContent = text;
  box.appendChild(item);
  setTimeout(() => item.remove(), 6000);
}

function paintStatus(text) {
  S.status = text;
  const el = $("#ap-status");
  if (el) el.textContent = text || (S.lastSync ? "checked " + friendly(S.lastSync) : "not checked yet");
  const button = $(".ap-google span");
  if (button && S.syncing && text) button.textContent = text;
}

function paintCheck() {
  const button = $("#ap-check");
  if (!button) return;
  button.disabled = S.syncing;
  button.textContent = S.syncing ? "Checking" : "Check now";
}

function navItem(key, label, count) {
  const on = S.view === key;
  return `<button class="ap-nav${on ? " on" : ""}" data-view="${key}"${on ? ' aria-current="page"' : ""}>` +
    `<span>${esc(label)}</span>${count ? `<em>${count}</em>` : ""}</button>`;
}

function paintNav() {
  const holder = $("#ap-nav");
  if (!holder) return;
  const settings = S.view === "settings";
  const count = (view) => list(view).length;
  let html = navItem("todo", "To-Do", count("todo")) + navItem("all", "All posts", count("all"));
  html += `<div class="ap-heading">SECTIONS</div>` + SECTIONS.map((s) => navItem(s, s, count(s))).join("");
  if (S.courses.length) {
    html += `<div class="ap-heading">CLASSES</div>`;
    html += `<button class="ap-nav${S.course === "any" ? " on" : ""}" data-course="any"><span>All classes</span></button>`;
    for (const course of S.courses) {
      const n = S.posts.filter((p) => p.courseId === course.id && (S.showDone || !isDone(p))).length;
      html += `<button class="ap-nav ap-class${S.course === course.id ? " on" : ""}" data-course="${esc(course.id)}">` +
        `<i style="background:${colourFor(shortClass(course.name))}">${esc(shortClass(course.name).charAt(0).toUpperCase())}</i><span>${esc(shortClass(course.name))}</span><em>${n || ""}</em></button>`;
    }
  }
  holder.innerHTML = html;
  const foot = $("#ap-foot");
  if (foot) {
    const done = S.posts.filter(isDone).length;
    foot.innerHTML = `<p id="ap-status">${esc(S.status || (S.lastSync ? "checked " + friendly(S.lastSync) : "not checked yet"))}</p>` +
      `<p>${S.posts.length} posts &middot; ${done} done</p>`;
  }
  const gear = $("#ap-settings");
  if (gear) gear.classList.toggle("on", settings);
  document.title = (list("todo").length ? `(${list("todo").length}) ` : "") + "Class Ping Web";
}

function linkify(text) {
  return esc(text).replace(/https?:\/\/[^\s<]+/g, (url) => {
    const tail = (url.match(/[.,;:!?)\]]+$/) || [""])[0];
    const clean = tail ? url.slice(0, -tail.length) : url;
    return `<a href="${clean}" target="_blank" rel="noopener noreferrer">${clean}</a>${tail}`;
  });
}

function fileTile(file) {
  const badge = FILE_BADGE[file.kind] || "FILE";
  const picture = file.thumb ? `<img src="${esc(file.thumb)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : `<b>${badge}</b>`;
  const tag = file.url ? "a" : "span";
  const link = file.url ? ` href="${esc(file.url)}" target="_blank" rel="noopener noreferrer"` : "";
  return `<${tag} class="ap-file"${link}><span class="ap-thumb">${picture}</span><span class="ap-fname">${esc(file.name)}</span>` +
    `<span class="ap-fkind">${badge}</span></${tag}>`;
}

// A person with no picture gets their initials on a colour worked out from their name,
// so the same person is always the same colour. All of them are white-text safe.
const AVATAR_COLOURS = ["#37784C", "#3D6FD1", "#8A5AA8", "#26766E", "#B0486B", "#5E63B6", "#5F7D33", "#3F7197"];
function colourFor(name) {
  let hash = 2166136261;
  for (const ch of String(name || "").trim().toLowerCase()) hash = Math.imul(hash ^ ch.codePointAt(0), 16777619) >>> 0;
  return AVATAR_COLOURS[hash % AVATAR_COLOURS.length];
}

// The teacher's picture when Google gave one, otherwise their initials.
function initials(name) {
  const words = String(name || "").replace(/\b(mr|mrs|ms|miss|dr|sir|madam)\.?\s/gi, "").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();      // as in the Windows app
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

function avatar(post) {
  const picture = post.authorPhoto
    ? `<img src="${esc(post.authorPhoto)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : "";
  return `<span class="ap-ava" style="background:${colourFor(post.author)}" aria-hidden="true">${esc(initials(post.author))}${picture}</span>`;
}

function card(post) {
  const done = isDone(post);
  const fresh = !S.seenAtLoad.has(post.id) && S.marks.firstSync;
  const section = sectionOf(post);
  const due = post.dueAt ? dueText(post.dueAt) : null;
  const long = post.body.length > 480 || (post.body.match(/\n/g) || []).length > 7;
  const open = S.expanded.has(post.id);
  const move = SECTIONS.map((s) => `<option${s === section ? " selected" : ""}>${s}</option>`).join("");
  return `<article class="ap-card${done ? " done" : ""}${fresh ? " fresh" : ""}" data-id="${esc(post.id)}">` +
    `<div class="ap-top"><span class="ap-pill k-${esc(post.kind)}">${KIND_LABEL[post.kind] || "Post"}</span>` +
    (fresh ? `<span class="ap-new">New</span>` : "") +
    `<div class="ap-acts">` +
    (post.link ? `<a class="ap-btn" href="${esc(post.link)}" target="_blank" rel="noopener noreferrer">Open</a>` : "") +
    `<label class="ap-move" title="Move to another section"><select data-move="${esc(post.id)}" aria-label="Section">${move}</select></label>` +
    `<button class="ap-btn${done ? "" : " strong"}" data-done="${esc(post.id)}">${done ? "Undo" : "Mark done"}</button></div></div>` +
    `<h3>${esc(post.title || "(no title)")}</h3>` +
    `<p class="ap-meta">${post.author ? `${avatar(post)}<b>${esc(post.author)}</b><span class="ap-dot">&middot;</span>` : ""}` +
    `<span>${esc(shortClass(post.courseName))}</span><span class="ap-dot">&middot;</span><span>${esc(friendly(when(post)))}</span></p>` +
    (due ? `<p class="ap-due${due.late ? " late" : ""}">${esc(due.text)}</p>` : "") +
    (post.body ? `<div class="ap-body${long && !open ? " clamp" : ""}">${linkify(post.body)}</div>` : "") +
    (long ? `<button class="ap-more" data-more="${esc(post.id)}">${open ? "Show less" : "Show more"}</button>` : "") +
    (post.files.length ? `<div class="ap-files">${post.files.map(fileTile).join("")}</div>` : "") +
    `</article>`;
}

function paintHead() {
  const title = $("#ap-title"), note = $("#ap-note");
  if (!title || !note) return;
  if (S.view === "settings") { title.textContent = "Settings"; note.textContent = "Everything here is saved in this browser."; return; }
  const rows = list(S.view);
  title.textContent = S.view === "todo" ? greeting() : S.view === "all" ? "All posts" : S.view;
  const bits = [S.view === "todo" ? (rows.length ? `${rows.length} thing${rows.length === 1 ? "" : "s"} to do` : "Nothing to do")
    : `${rows.length} post${rows.length === 1 ? "" : "s"}`];
  if (S.course !== "any") { const c = S.courses.find((x) => x.id === S.course); if (c) bits.push(shortClass(c.name)); }
  if (S.range !== "any") bits.push(RANGES.find((r) => r[0] === S.range)[1]);
  bits.push(S.lastSync ? "checked " + friendly(S.lastSync) : "not checked yet");
  note.textContent = bits.join("  ·  ");
}

function paintTools() {
  const select = $("#ap-range");
  if (select) {
    select.innerHTML = RANGES.map(([key, label]) => {
      const n = S.posts.filter((p) => inRange(p, key) && (S.showDone || !isDone(p)) && (S.course === "any" || p.courseId === S.course)).length;
      return `<option value="${key}"${S.range === key ? " selected" : ""}>${label}  (${n})</option>`;
    }).join("");
  }
  const toggle = $("#ap-done");
  if (toggle) toggle.checked = S.showDone;
}

function emptyText() {
  if (S.q) return ["Nothing matches", "No post has all of those words."];
  if (S.view === "todo") return ["You're all caught up", "Nothing left to do. Every task is marked done."];
  return ["Nothing here", "No posts in this list yet."];
}

function paintList() {
  const holder = $("#ap-list");
  if (!holder) return;
  const rows = list(S.view);
  if (!rows.length) {
    const [head, line] = emptyText();
    holder.innerHTML = `<div class="ap-empty"><h2>${esc(head)}</h2><p>${esc(line)}</p></div>`;
    return;
  }
  const shown = rows.slice(0, S.limit);
  holder.innerHTML = shown.map(card).join("") +
    (rows.length > shown.length ? `<button class="ap-btn wide" id="ap-more-posts">Show ${Math.min(PAGE, rows.length - shown.length)} more (${rows.length - shown.length} left)</button>` : "");
}

function paintBanner() {
  const holder = $("#ap-banner");
  if (!holder) return;
  let html = "";
  if (S.demo) {
    html = `<div class="ap-note-bar"><span>These are made-up sample posts, not your Classroom.</span>` +
      (auth.configured() ? `<button class="ap-btn strong" data-act="signin">Sign in with Google</button>` : "") + `</div>`;
  } else if (S.needSignIn && S.posts.length) {
    html = `<div class="ap-note-bar warn"><span>You are signed out for now. The posts below are saved in this browser.</span>` +
      `<button class="ap-btn strong" data-act="signin">Sign in to refresh</button></div>`;
  }
  if (!S.demo && S.view !== "settings" && S.marks.firstSync && !S.marks.askedOld && oldOptions(false).length) {
    html += `<div class="ap-ask"><b>Tick off old work?</b>` +
      `<p>Some work was posted before you started. Tick it off now so your list does not pile up. New posts stay as they are, and Settings can bring any of it back.</p>` +
      `<div class="ap-askrow">${oldSelect("ap-old-start", false, S.pick.start, "How much old work to tick off")}` +
      `<button class="ap-btn strong" data-act="old-tick">Tick off</button><button class="ap-btn" data-act="old-keep">Keep all</button></div></div>`;
  }
  if (S.error) html += `<div class="ap-note-bar warn"><span>${esc(S.error)}</span></div>`;
  holder.innerHTML = html;
}

function googleButton(label) {
  return `<button class="ap-google" data-act="signin"${S.connecting || S.syncing ? " disabled" : ""}><svg viewBox="0 0 48 48" aria-hidden="true">` +
    `<path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>` +
    `<path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>` +
    `<path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>` +
    `<path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>` +
    `<span>${esc(label)}</span></button>`;
}

function welcome() {
  const ready = auth.configured();
  return `<a class="ap-back" href="../">&larr; Class Ping website</a><div class="ap-welcome"><div class="ap-wcard">` +
    `<img src="../logo-name.png?v=5" alt="Class Ping" width="96" height="96">` +
    `<h1>Class Ping in your browser</h1>` +
    `<p class="lead">Your Google Classroom as a to-do list: homework first, due dates in plain sight, everything sorted into sections.</p>` +
    `<p class="small beta-note">Beta: still being tested, so some bugs are not found yet. <a href="mailto:${SUPPORT_EMAIL}?subject=Class%20Ping%20feedback">Tell us if you meet one.</a></p>` +
    `<ul><li>Read-only: it never posts, edits or deletes anything in Classroom.</li>` +
    `<li>Everything stays in this browser. There is no Class Ping server and no account.</li>` +
    `<li>Google's own page signs you in. Class Ping never sees your password.</li></ul>` +
    (ready ? googleButton(S.connecting ? "Waiting for Google..." : S.syncing ? (S.status || "Reading your Classroom...") : "Sign in with Google")
      : `<p class="ap-warn-text">Sign-in is not switched on for this site yet.</p>`) +
    (ready ? `<button class="ap-link" data-act="other">Use a different Google account</button>` : "") +
    `<button class="ap-btn wide" data-act="demo">Try it with sample posts</button>` +
    (S.error ? `<p class="ap-warn-text">${esc(S.error)}</p>` : "") +
    `<p class="small">A web page can only notify you while it is open. For alerts all day, even with the browser closed, use <a href="../download.html">the Windows app</a>. ` +
    `<a href="../privacy.html">Privacy</a> &middot; <a href="../terms.html">Terms</a> &middot; <a href="../safety.html">Check it yourself</a></p>` +
    `</div></div>`;
}

function settings() {
  const prefs = store.prefs(), site = sitePrefs();
  const who = S.demo ? "Sample posts (not signed in)" : auth.signedIn() ? `Connected as ${S.email || "your Google account"}`
    : S.email ? `Signed out for now (${S.email})` : "Not signed in";
  const perm = "Notification" in window ? Notification.permission : "unsupported";
  const themes = THEMES.map(([key, name]) => `<label class="ap-choice"><input type="radio" name="theme" value="${key}"${site.theme === key ? " checked" : ""}>` +
    `<span class="swatch sw-${key}"><i></i><i></i></span><b>${name}</b></label>`).join("");
  return `<section class="ap-set"><h2>Connection</h2><p>Class Ping reads your Classroom through Google's official, read-only sign-in.</p>` +
    `<div class="ap-row"><div><b>${esc(who)}</b>` +
    `<small>${S.lastSync ? "Last checked " + esc(friendly(S.lastSync)) : "Not checked yet"}</small></div><div class="ap-rowbtns">` +
    (auth.configured() ? `<button class="ap-btn${auth.signedIn() ? "" : " strong"}" data-act="${auth.signedIn() ? "switch" : "signin"}">${auth.signedIn() ? "Switch account" : "Sign in"}</button>` : "") +
    `<button class="ap-btn" data-act="signout">Sign out and erase</button></div></div></section>` +
    `<section class="ap-set"><h2>Notifications</h2><p>Get a desktop notification when a new post arrives. This only works while this page is open in a tab.</p>` +
    `<label class="ap-row"><div><b>Notify me of new posts</b><small>${perm === "denied" ? "Your browser has blocked notifications for this site." : perm === "unsupported" ? "This browser cannot show notifications." : "Asks your browser's permission first."}</small></div>` +
    `<input type="checkbox" id="ap-notify"${prefs.notify && perm === "granted" ? " checked" : ""}${perm === "denied" || perm === "unsupported" ? " disabled" : ""}></label>` +
    `<p class="small">For alerts all day, even with the browser closed, use <a href="../download.html">the Windows app</a>.</p></section>` +
    `<section class="ap-set"><h2>Old work</h2><p>Tick off everything that was posted a while ago so your list does not pile up. New posts are never touched, and nothing is deleted.</p>` +
    `<div class="ap-row"><div><b>Tick off old work</b><small>Marks posts as done, in any section.</small></div><div class="ap-rowbtns">` +
    `${oldSelect("ap-bulk-tick", false, S.pick.tick, "How much old work to tick off")}<button class="ap-btn strong" data-act="bulk-tick">Tick off</button></div></div>` +
    `<div class="ap-row gap"><div><b>Bring old work back</b><small>Puts ticked-off posts back on your list.</small></div><div class="ap-rowbtns">` +
    `${oldSelect("ap-bulk-back", true, S.pick.back, "How much old work to bring back")}<button class="ap-btn strong" data-act="bulk-back">Untick</button></div></div>` +
    `<p class="small" id="ap-bulk-note" role="status">${esc(S.bulkNote)}</p></section>` +
    `<section class="ap-set"><h2>Appearance</h2><p>The same five looks as the Windows app.</p><div class="ap-themes">${themes}</div></section>` +
    `<section class="ap-set"><h2>Your data</h2><p>Class Ping keeps your posts, ticks and moves in this browser only. Nothing is sent to us. ` +
    `"Sign out and erase" gives Google's permission back and deletes all of it from this browser.</p>` +
    `<p class="small"><a href="../privacy.html">Privacy policy</a> &middot; <a href="../terms.html">Terms</a> &middot; <a href="mailto:${SUPPORT_EMAIL}">Contact</a></p></section>`;
}

function paintAll() {
  const root = $("#ap-root");
  if (!root) return;
  const showWelcome = !S.demo && !S.posts.length && !S.lastSync && S.view !== "settings";
  root.classList.toggle("welcome-mode", showWelcome);
  root.classList.toggle("drawer-open", S.drawer);
  if (showWelcome) { $("#ap-page").innerHTML = welcome(); paintNav(); return; }
  if (!$("#ap-list") && S.view !== "settings") mountPage();
  if (S.view === "settings") {
    $("#ap-page").innerHTML = `<header class="ap-head"><div><h1 id="ap-title">Settings</h1><p id="ap-note"></p></div></header><div id="ap-banner"></div><div class="ap-settings">${settings()}</div>`;
    paintHead(); paintNav(); paintBanner(); paintCheck();
    return;
  }
  if ($("#ap-page .ap-settings") || $("#ap-page .ap-welcome")) mountPage();
  paintNav(); paintHead(); paintTools(); paintBanner(); paintList(); paintCheck();
}

function mountPage() {
  $("#ap-page").innerHTML =
    `<header class="ap-head"><div><h1 id="ap-title"></h1><p id="ap-note"></p></div></header><div id="ap-banner"></div>` +
    `<div class="ap-tools"><input id="ap-search" type="search" placeholder="Search posts" aria-label="Search posts" value="${esc(S.q)}">` +
    `<select id="ap-range" aria-label="Time range"></select>` +
    `<label class="ap-switch"><input type="checkbox" id="ap-done"><span></span>Show done</label></div>` +
    `<div id="ap-list" class="ap-listing"></div>`;
}

// -- events ------------------------------------------------------------------------------

function wire() {
  document.addEventListener("pointerdown", renewOnClick, true);

  $("#ap-root").addEventListener("click", (event) => {
    const t = event.target.closest("button, a, label");
    if (!t) return;
    if (t.dataset.view) { S.view = t.dataset.view; S.limit = PAGE; S.drawer = false; paintAll(); return; }
    if (t.dataset.course) { S.course = t.dataset.course; S.limit = PAGE; S.drawer = false; if (S.view === "settings") S.view = "todo"; paintAll(); return; }
    if (t.dataset.done) {
      const id = t.dataset.done;
      if (S.marks.done[id]) delete S.marks.done[id]; else S.marks.done[id] = Date.now();
      persist(); paintAll(); return;
    }
    if (t.dataset.more) { const id = t.dataset.more; if (S.expanded.has(id)) S.expanded.delete(id); else S.expanded.add(id); paintList(); return; }
    if (t.id === "ap-more-posts") { S.limit += PAGE; paintList(); return; }
    if (t.id === "ap-check") { sync(); return; }
    if (t.id === "ap-settings") { S.view = S.view === "settings" ? "todo" : "settings"; S.bulkNote = ""; S.drawer = false; paintAll(); return; }
    if (t.id === "ap-menu") { S.drawer = !S.drawer; $("#ap-root").classList.toggle("drawer-open", S.drawer); return; }
    if (t.id === "ap-scrim") { S.drawer = false; $("#ap-root").classList.remove("drawer-open"); return; }
    const act = t.dataset.act;
    if (act === "signin") connect();
    else if (act === "switch" || act === "other") connect("select_account");
    else if (act === "signout") signOutAndErase();
    else if (act === "demo") startDemo();
    else if (act === "old-tick" || act === "old-keep") {
      const n = act === "old-tick" ? oldApply(($("#ap-old-start") || {}).value || "all", true) : 0;
      S.marks.askedOld = true;
      persist();
      if (n) toast(`${n} old post${n === 1 ? "" : "s"} ticked off. Settings can bring ${n === 1 ? "it" : "them"} back.`);
      paintAll();
    } else if (act === "bulk-tick" || act === "bulk-back") {
      const tick = act === "bulk-tick";
      const field = $(tick ? "#ap-bulk-tick" : "#ap-bulk-back");
      if (!field || field.disabled) return;
      const n = oldApply(field.value, tick);
      S.marks.askedOld = true;                       // no need to ask at the start now
      persist();
      S.bulkNote = `${n} post${n === 1 ? "" : "s"} ${tick ? "ticked off" : "brought back"}.`;
      paintAll();
    }
  });

  $("#ap-root").addEventListener("change", async (event) => {
    const t = event.target;
    if (t.dataset && t.dataset.move) { S.marks.moved[t.dataset.move] = t.value; persist(); paintAll(); return; }
    if (t.id === "ap-range") { S.range = t.value; S.limit = PAGE; paintAll(); return; }
    if (t.id === "ap-old-start") { S.pick.start = t.value; return; }
    if (t.id === "ap-bulk-tick") { S.pick.tick = t.value; return; }
    if (t.id === "ap-bulk-back") { S.pick.back = t.value; return; }
    if (t.id === "ap-done") { S.showDone = t.checked; S.limit = PAGE; store.savePrefs({ showDone: S.showDone }); paintAll(); return; }
    if (t.name === "theme") { setTheme(t.value); return; }
    if (t.id === "ap-notify") {
      if (t.checked && "Notification" in window) {
        const answer = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
        store.savePrefs({ notify: answer === "granted" });
        paintAll();
      } else { store.savePrefs({ notify: false }); }
    }
  });

  let typing = 0;
  $("#ap-root").addEventListener("input", (event) => {
    if (event.target.id !== "ap-search") return;
    clearTimeout(typing);
    typing = setTimeout(() => { S.q = event.target.value.trim(); S.limit = PAGE; paintHead(); paintList(); paintNav(); }, 120);
  });

  document.addEventListener("keydown", (event) => { if (event.key === "Escape" && S.drawer) { S.drawer = false; $("#ap-root").classList.remove("drawer-open"); } });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") { saveNow(); return; }
    // Coming back to the tab checks again, unless it was checked a moment ago.
    const fresh = S.lastSync && Date.now() - Date.parse(S.lastSync) < 60000;
    paintAll();
    if (auth.signedIn() && !fresh) sync({ quiet: true });
  });
  window.addEventListener("pagehide", saveNow);
  setInterval(() => {
    if (document.visibilityState !== "visible" || S.demo) return;
    if (auth.signedIn()) sync({ quiet: true });
    else if (S.posts.length && !S.needSignIn) { S.needSignIn = true; paintAll(); }     // say so, instead of quietly stopping
  }, SYNC_EVERY_MS);
  // New posts stop being "new" after you have looked at them for a few seconds.
  setInterval(() => {
    if (document.visibilityState !== "visible" || !S.marks.firstSync) return;
    const fresh = S.posts.filter((p) => !S.marks.seen[p.id]);
    if (!fresh.length) return;
    for (const p of fresh) S.marks.seen[p.id] = 1;
    persist();
  }, 6000);
}

function startDemo() {
  const data = sample();
  S.demo = true;
  S.courses = data.courses;
  S.posts = data.posts.map(sortPost);
  S.marks = { done: {}, moved: {}, seen: {}, firstSync: false };
  S.lastSync = new Date().toISOString();
  S.view = "todo";
  S.error = "";
  paintAll();
}

function chrome() {
  return `<div id="ap-root" class="ap">` +
    `<div class="ap-bar"><button id="ap-menu" class="ap-btn" aria-label="Menu">Menu</button><a class="ap-brand" href="../"><img src="../logo.png?v=5" alt="" width="26" height="26">Class Ping<span class="ap-beta">Beta</span></a></div>` +
    `<div id="ap-scrim"></div>` +
    `<aside class="ap-side"><a class="ap-brand" href="../"><img src="../logo.png?v=5" alt="" width="28" height="28">Class Ping<span class="ap-beta">Beta</span></a>` +
    `<div class="ap-checkrow"><button id="ap-check" class="ap-btn strong big">Check now</button></div>` +
    `<nav id="ap-nav" aria-label="Lists"></nav>` +
    `<div class="ap-side-foot"><div id="ap-foot"></div>` +
    `<button id="ap-settings" class="ap-nav"><span>Settings</span></button>` +
    `<a class="ap-nav" href="mailto:${SUPPORT_EMAIL}?subject=Class%20Ping%20feedback"><span>Send feedback</span></a>` +
    `<a class="ap-nav" href="../"><span>Class Ping home</span></a></div></aside>` +
    `<main class="ap-main"><div id="ap-page"></div></main><div id="ap-toasts" aria-live="polite"></div></div>`;
}

async function boot() {
  document.body.innerHTML = chrome();
  const prefs = store.prefs();
  S.showDone = prefs.showDone;
  S.email = prefs.email || "";
  wire();
  const stored = await store.get("posts", []);
  S.posts = (stored || []).map((p) => (p.section ? p : sortPost(p)));
  S.courses = await store.get("courses", []);
  S.names = await store.get("names", {});
  S.marks = { done: {}, moved: {}, seen: {}, firstSync: false, ...(await store.get("marks", {})) };
  S.lastSync = await store.get("lastSync", "") || "";
  S.seenAtLoad = new Set(Object.keys(S.marks.seen));
  auth.restore();
  if (/[?#&]demo\b/.test(location.search + location.hash)) startDemo();
  else if (!auth.signedIn() && S.posts.length) S.needSignIn = true;
  paintAll();
  if (auth.signedIn() && !S.demo) sync();
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => { /* works without it */ });
}

boot();
