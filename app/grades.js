// The grade calculator's sums: the same as the desktop app's app/grades.py, and the same
// scales (grade_scales.json, an exact copy of the app's). Nothing here comes from Classroom,
// and nothing typed here leaves this browser.

export const DEFAULT_COUNTRY = "intl";
export const MAX_SHEETS = 20;
export const MAX_ROWS = 60;

let scales = null;

export async function loadScales() {
  if (scales) return scales;
  const response = await fetch("grade_scales.json?v=1", { cache: "no-cache" });
  scales = await response.json();
  return scales;
}

export const international = () => scales.international;

export function countries() {
  return [scales.international, ...[...scales.countries].sort((a, b) => a.name.localeCompare(b.name))];
}

export function scale(key) {
  return countries().find((c) => c.key === key) || scales.international;
}

export function band(percent, chosen) {
  return chosen.bands.find((b) => percent >= b.min) || chosen.bands[chosen.bands.length - 1];
}

// 12, 12.5 -- never 12.0.
export function number(value) {
  const v = Math.round(Number(value) * 100) / 100;
  return Number.isInteger(v) ? String(v) : String(v);
}

export function gradeText(percent, chosen) {
  const item = band(percent, chosen);
  let words = item.grade + (item.points ? ` (${item.points})` : "");
  if (chosen.score) {
    const { from, to } = chosen.score;
    const mark = from + (to - from) * Math.min(percent, 100) / 100;       // bonus marks: never past the top
    words = `${number(Math.round(mark * 10) / 10)} / ${number(to)}, ${words}`;
  }
  return words;
}

export function parseNumber(text) {
  const value = Number(String(text == null ? "" : text).trim().replace(",", "."));
  return String(text == null ? "" : text).trim() === "" || !Number.isFinite(value) ? null : value;
}

export function rowResult(row) {
  const blank = !String(row.marks || "").trim() && !String(row.out_of || "").trim();
  if (blank) return { counts: false, problem: "" };
  const marks = parseNumber(row.marks), outOf = parseNumber(row.out_of);
  if (marks === null || outOf === null) return { counts: false, problem: "Numbers only" };
  if (outOf <= 0) return { counts: false, problem: "Out of must be above 0" };
  if (marks < 0) return { counts: false, problem: "Below 0?" };
  return { counts: true, marks, outOf, percent: marks * 100 / outOf, problem: marks > outOf ? "Bonus marks?" : "" };
}

export const percentText = (value) => `${number(Math.round(value * 10) / 10)}%`;

export function nextStep(marks, outOf, chosen) {
  const percent = marks * 100 / outOf;
  const higher = chosen.bands.filter((b) => b.min > percent);
  if (!higher.length) return "That's the top grade.";
  const target = higher.reduce((a, b) => (b.min < a.min ? b : a));
  const needed = Math.max(1, Math.ceil(target.min * outOf / 100 - marks - 1e-9));
  if (marks + needed > outOf) return "";
  return `${needed} more ${needed === 1 ? "mark" : "marks"} would make it ${target.grade}.`;
}

export function summary(rows, country) {
  const chosen = scale(country), world = international();
  const counted = [];
  for (const row of rows) {
    const r = rowResult(row);
    if (r.counts) counted.push([String(row.subject || "").trim() || "Untitled", r]);
  }
  if (!counted.length) return { subjects: 0 };
  const marks = counted.reduce((n, [, r]) => n + r.marks, 0);
  const outOf = counted.reduce((n, [, r]) => n + r.outOf, 0);
  const percent = marks * 100 / outOf;
  const average = counted.reduce((n, [, r]) => n + r.percent, 0) / counted.length;
  const best = counted.reduce((a, b) => (b[1].percent > a[1].percent ? b : a));
  const worst = counted.reduce((a, b) => (b[1].percent < a[1].percent ? b : a));
  return {
    subjects: counted.length, marks, outOf, percent, average,
    grade: gradeText(percent, chosen), international: gradeText(percent, world),
    best: [best[0], best[1].percent], worst: [worst[0], worst[1].percent],
    next: nextStep(marks, outOf, chosen),
  };
}

// -- what you typed, kept -----------------------------------------------------------------

export function blankSheet(name = "My grades") {
  return { name, rows: Array.from({ length: 4 }, () => ({ subject: "", marks: "", out_of: "" })) };
}

export function clean(data) {
  data = data && typeof data === "object" ? data : {};
  let country = String(data.country || DEFAULT_COUNTRY);
  if (scale(country).key !== country) country = DEFAULT_COUNTRY;
  const sheets = [];
  for (const sheet of (Array.isArray(data.sheets) ? data.sheets : []).slice(0, MAX_SHEETS)) {
    if (!sheet || typeof sheet !== "object") continue;
    const rows = (Array.isArray(sheet.rows) ? sheet.rows : []).slice(0, MAX_ROWS)
      .filter((r) => r && typeof r === "object")
      .map((r) => ({ subject: String(r.subject || "").slice(0, 60), marks: String(r.marks || "").slice(0, 60), out_of: String(r.out_of || "").slice(0, 60) }));
    sheets.push({ name: String(sheet.name || "My grades").slice(0, 40), rows });
  }
  if (!sheets.length) sheets.push(blankSheet());
  let current = Number.isInteger(data.current) ? data.current : 0;
  if (current < 0 || current >= sheets.length) current = 0;
  return { country, sheets, current };
}
