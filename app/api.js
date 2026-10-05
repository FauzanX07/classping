// Reading Google Classroom through Google's official, read-only interface.
// Every announcement, assignment, question and material becomes one "post".
// Nothing is written to Classroom and nothing leaves this browser except the
// requests to Google itself.

const API = "https://classroom.googleapis.com/v1";
const PAGE_SIZE = 30;

export class ApiError extends Error {
  constructor(status, reason, message) {
    super(`HTTP ${status} ${reason}: ${message}`.trim());
    this.status = status;
    this.reason = reason;
  }
}

// Only web addresses become links or pictures: a javascript: or data: address from a post is dropped.
const safe = (url) => (/^https?:\/\//i.test(String(url || "")) ? String(url) : "");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function get(path, params, token) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params || {})) {
    if (value !== undefined && value !== null && value !== "") query.set(key, String(value));
  }
  const url = `${API}/${path}${query.toString() ? "?" + query : ""}`;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const reply = await fetch(url, { headers: { Authorization: "Bearer " + token } });
    if (reply.ok) return reply.json();
    if (reply.status === 429 && attempt === 1) { await sleep(4000); continue; }
    let info = {};
    try { info = (await reply.json()).error || {}; } catch (e) { /* no body */ }
    throw new ApiError(reply.status, info.status || "", info.message || "");
  }
  throw new ApiError(0, "", "no answer");
}

// Every item of a list, newest first, until stop(item) says enough.
async function pages(path, key, params, token, { stop = null, most = 300 } = {}) {
  const found = [];
  let pageToken = "";
  for (;;) {
    const page = await get(path, { ...params, pageSize: PAGE_SIZE, pageToken }, token);
    for (const item of page[key] || []) {
      if (stop && stop(item)) return found;
      found.push(item);
      if (found.length >= most) return found;
    }
    pageToken = page.nextPageToken || "";
    if (!pageToken) return found;
  }
}

export async function courses(token) {
  let list = await pages("courses", "courses", { courseStates: "ACTIVE", studentId: "me" }, token);
  if (!list.length) list = await pages("courses", "courses", { courseStates: "ACTIVE" }, token); // a teacher-only account
  return list.map((c) => ({ id: String(c.id), name: String(c.name || "Class"), link: String(c.alternateLink || "") }));
}

// -- who is who ---------------------------------------------------------------------

// A person's name, and their picture when Google gives one. The picture needs the
// "profile photos" permission, which Class Ping does not ask for (yet), so for now
// Google leaves it out and the page draws initials instead.
export async function profile(userId, token, cache) {
  const blank = { name: "", photo: "" };
  if (!userId) return blank;
  const known = cache[userId];
  if (known !== undefined) return typeof known === "string" ? { name: known, photo: "" } : known;
  try {
    const data = await get(`userProfiles/${userId}`, {}, token);
    let photo = String(data.photoUrl || "");
    if (photo.startsWith("//")) photo = "https:" + photo;
    photo = safe(photo);
    cache[userId] = { name: String((data.name && data.name.fullName) || ""), photo };
  } catch (e) {
    // Only "no such person" is remembered; a busy or offline moment is tried again next time.
    if (e && (e.status === 403 || e.status === 404)) cache[userId] = blank;
    return blank;
  }
  return cache[userId];
}

// -- times --------------------------------------------------------------------------

function when(stamp) {
  if (!stamp) return null;
  const date = new Date(stamp);
  return isNaN(date) ? null : date;
}

// Classroom keeps a due date and time in UTC; a date with no time is due at the
// end of that day, where you are.
function due(item) {
  const d = item.dueDate;
  if (!d) return null;
  try {
    const t = item.dueTime;
    const date = t ? new Date(Date.UTC(d.year, d.month - 1, d.day, t.hours || 0, t.minutes || 0))
      : new Date(d.year, d.month - 1, d.day, 23, 59);
    return isNaN(date) ? null : date;       // an odd date from Classroom must not stop the whole read
  } catch (e) { return null; }
}

// -- attachments --------------------------------------------------------------------

function materials(item) {
  const out = [];
  for (const m of item.materials || []) {
    if (m.driveFile) {
      const f = m.driveFile.driveFile || {};
      out.push({ name: f.title || "Drive file", url: safe(f.alternateLink), thumb: "" });
    } else if (m.youtubeVideo) {
      const v = m.youtubeVideo;
      out.push({ name: v.title || "YouTube video", url: safe(v.alternateLink), thumb: safe(v.thumbnailUrl) });
    } else if (m.link) {
      out.push({ name: m.link.title || m.link.url || "Link", url: safe(m.link.url), thumb: "" });
    } else if (m.form) {
      out.push({ name: m.form.title || "Google Form", url: safe(m.form.formUrl), thumb: "" });
    }
  }
  return out.filter((a) => a.name || a.url);
}

export function attachmentKind(name, url) {
  const text = `${name} ${url}`.toLowerCase();
  if (/youtube\.com|youtu\.be/.test(text)) return "video";
  if (/docs\.google\.com\/forms|forms\.gle/.test(text)) return "form";
  if (/\.pdf\b/.test(text)) return "pdf";
  if (/\.(png|jpe?g|gif|webp|heic)\b/.test(text)) return "image";
  if (/\.(mp4|mov|mkv|webm)\b/.test(text)) return "video";
  if (/docs\.google\.com\/document|\.docx?\b/.test(text)) return "doc";
  if (/docs\.google\.com\/spreadsheets|\.xlsx?\b|\.csv\b/.test(text)) return "sheet";
  if (/docs\.google\.com\/presentation|\.pptx?\b/.test(text)) return "slides";
  if (/drive\.google\.com/.test(text)) return "file";
  if (/^https?:/i.test(url)) return "link";
  return "file";
}

// -- one item into one post ---------------------------------------------------------

function kindOf(item, list) {
  if (list === "announcements") return "announcement";
  if (list === "courseWorkMaterials") return "material";
  return String(item.workType || "").includes("QUESTION") ? "question" : "assignment";
}

export async function toPost(item, list, course, token, names) {
  const kind = kindOf(item, list);
  const person = await profile(String(item.creatorUserId || ""), token, names);
  const who = person.name;
  const body = String((kind === "announcement" ? item.text : item.description) || "").trim();
  // Classroom labels an announcement "Post by <teacher>"; the desktop app stores the same label.
  const title = kind === "announcement" ? (who ? `Post by ${who}` : "Announcement") : String(item.title || "").trim();
  const posted = when(item.creationTime);
  const dueAt = due(item);
  const files = materials(item).map((f) => ({ ...f, kind: attachmentKind(f.name, f.url) }));
  return {
    id: String(item.id),
    courseId: course.id,
    courseName: course.name,
    kind,
    title,
    body,
    author: who,
    authorPhoto: person.photo,
    link: safe(item.alternateLink),
    postedAt: posted ? posted.toISOString() : "",
    updatedAt: String(item.updateTime || item.creationTime || ""),
    dueAt: dueAt ? dueAt.toISOString() : "",
    files,
  };
}

const LISTS = [["announcements", "announcements"], ["courseWork", "courseWork"], ["courseWorkMaterials", "courseWorkMaterial"]];

// Everything in one class since `since` (an ISO time), or the newest `most` of each list.
export async function readCourse(course, token, names, { since = "", most = 300 } = {}) {
  const cutoff = since ? new Date(since) : null;
  const older = (item) => {
    const changed = when(item.updateTime || item.creationTime);
    return cutoff !== null && changed !== null && changed < cutoff;
  };
  // The three lists of a class are asked for together, not one after another.
  const lists = await Promise.all(LISTS.map(async ([list, key]) => {
    try {
      return [list, await pages(`courses/${course.id}/${list}`, key, { orderBy: "updateTime desc" }, token, { stop: older, most })];
    } catch (error) {
      if (error.status === 403) return [list, []];  // e.g. classwork, for a class you teach
      throw error;
    }
  }));
  // Each teacher is looked up once, all at the same time, before the posts are built.
  const people = new Set();
  for (const [, items] of lists) for (const item of items) people.add(String(item.creatorUserId || ""));
  await Promise.all([...people].map((id) => profile(id, token, names)));
  const posts = [];
  for (const [list, items] of lists) for (const item of items) posts.push(await toPost(item, list, course, token, names));
  return posts;
}
