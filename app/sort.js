// Class Ping: sorting a Classroom post into Homework / Classwork / Important /
// Notes / Extra, on this device, no AI, nothing sent anywhere.
//
// A faithful port of the desktop app's app/local_sort.py (by_phrases and what
// it needs) and app/classifier.py (classify with no learner: the phrase
// reading first, then the keyword rules of rules.json). The learner and the
// attachment-text feature are left out here: the website has neither, so a
// post is read from its title, body, kind and due date alone.
//
// Verified against the Python original with tools/parity_sort.py and
// tools/parity_sort_run.mjs: same section, same "why" text and same scores.
//
// Notes on the translation:
//  * Python's \w, \s and \b are Unicode-aware, JavaScript's are not. Every
//    pattern below is written the Python way and passed through rx(), which
//    rewrites \w as [\p{L}\p{N}_], \s as Python's whitespace set and \b as an
//    explicit lookaround pair, and compiles with the u flag.
//  * Python's str.split(), strip() and isspace use the same whitespace set
//    as \s, so pySplit()/pyStrip() do the same here.

export const SECTIONS = ["Homework", "Classwork", "Important", "Notes", "Extra"];
// When two sections score the same, the one that asks more of the student wins.
const TIE_ORDER = { Homework: 0, Important: 1, Classwork: 2, Notes: 3, Extra: 4 };

// ---- Python-flavoured regular expressions ----------------------------------

const WORD = "\\p{L}\\p{N}_";
// Python's str.isspace() set (what \s and str.split() use).
const SPACE = "\\t\\n\\v\\f\\r \\x1c-\\x1f\\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000";
const BOUNDARY = `(?:(?<=[${WORD}])(?![${WORD}])|(?<![${WORD}])(?=[${WORD}]))`;

function convert(pattern) {
  let out = "";
  let inClass = false;
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === "\\") {
      const n = pattern[++i];
      if (n === "w") out += inClass ? WORD : `[${WORD}]`;
      else if (n === "s") out += inClass ? SPACE : `[${SPACE}]`;
      else if (n === "S") {
        if (inClass) throw new Error("\\S inside a class is not supported");
        out += `[^${SPACE}]`;
      } else if (n === "b") {
        if (inClass) throw new Error("\\b inside a class is not supported");
        out += BOUNDARY;
      } else out += "\\" + n;
    } else {
      if (c === "[" && !inClass) inClass = true;
      else if (c === "]" && inClass) inClass = false;
      out += c;
    }
  }
  return out;
}

function rx(pattern, flags = "iu") {
  return new RegExp(convert(pattern), flags);
}

const R = String.raw;

const PY_SPACE_RE = new RegExp(`[${SPACE}]+`, "u");
const PY_SPACE_CHARS = new RegExp(`^[${SPACE}]+|[${SPACE}]+$`, "gu");

function pySplit(text) {           // str.split() with no argument
  return text.split(PY_SPACE_RE).filter((p) => p !== "");
}

function pyStrip(text) {           // str.strip() with no argument
  return text.replace(PY_SPACE_CHARS, "");
}

function stripChars(text, chars) { // str.strip(chars)
  let a = 0;
  let b = text.length;
  while (a < b && chars.includes(text[a])) a++;
  while (b > a && chars.includes(text[b - 1])) b--;
  return text.slice(a, b);
}

// ---- 1. tidying the words ---------------------------------------------------

// Short forms and slips seen in real posts, and the words they stand for.
const SHORT_FORMS = new Map(Object.entries({
  ur: "your", u: "you", plz: "please", pls: "please", plzz: "please",
  wrk: "work", pg: "page", pgs: "pages", tmrw: "tomorrow", tmr: "tomorrow",
  tomoro: "tomorrow", tomorow: "tomorrow", tommorow: "tomorrow",
  tommorrow: "tomorrow", tommorro: "tomorrow", "2morrow": "tomorrow",
  hw: "homework", cw: "classwork", nb: "notebook", q: "question",
  chrombook: "chromebook", chrombooks: "chromebooks", copies: "copies",
  leanrt: "learnt", learend: "learned", studnts: "students", studrnts: "students",
  reagrds: "regards", regard: "regards", wb: "workbook",
}));

// The words the reading below depends on. A word a letter or two away from
// one of these is taken to be it ("completd" -> "completed").
const KEY_WORDS = new Set(`
homework classwork students student tomorrow today yesterday notebook notebooks
workbook textbook copy copies page pages question questions answer answers
complete completed completes finish finished solve solved write wrote written
draw drew label labelled read revise revised revision learn learnt learned
memorise memorize memorised practise practice practised practiced watch watched
bring prepare prepared submit submitted submission upload uploaded research
discuss discussed discussion explain explained explore explored attempt attempted
conduct conducted perform performed recall recalled recite recited identify
identified understand understood taught teach lesson class assessment test tests
quiz exam exams examination examinations schedule syllabus agenda circular
parents parent respected dear kindly please attached attachment reference
information congratulations welcome holiday holidays vacation vacations closed
timing timings uniform guidelines postponed cancelled rescheduled result results
chromebook chromebooks activity activities worksheet assignment presentation
regards teacher teachers important urgent remain meeting ceremony notice
`.split(/\s+/).filter(Boolean));

// Passive and perfect forms that mean "this happened in the lesson".
const DONE_PARTICIPLES = "done|completed|taught|discussed|explained|conducted|practised|practiced|" +
  "revised|covered|introduced|read|taken|attempted|solved|written|checked|" +
  "recalled|performed|finished|reviewed|studied|recited|consumed|given in class";

// Verbs that, told to a student, set work.
const DO_VERBS = "do|solve|write|draw|label|complete|finish|read|learn|memorise|memorize|revise|" +
  "practise|practice|watch|bring|prepare|submit|upload|answer|research|make|try|" +
  "paste|look|gather|collect|copy|colour|color|design|create|recite|attempt|" +
  "study|find out|note down|get ready|come prepared|come up with|choose|work|" +
  "search|build|review|rehearse|listen|explore|take";

// Past forms a sentence about the students can start with.
const IRREGULAR_PAST = "read|did|wrote|learnt|made|took|drew|saw|sang|gave|began|spoke|understood|" +
  "went|had|built|taught|found|got|chose|met|played|shared|heard|thought|knew|" +
  "came|ran|won|sat|told|brought";

function fixUrdu(text) {
  text = text.replaceAll("\u0640", "");                       // tatweel
  text = text.replace(rx(R`آ\s+ج`, "gu"), "آج");
  text = text.replace(rx(R`کر\s+یں`, "gu"), "کریں");
  text = text.replace(rx(R`آ\s+ئیں`, "gu"), "آئیں");
  text = text.replace(rx(R`آ\s+یں`, "gu"), "آئیں");
  return text;
}

// Edit distance with swapped neighbours counting once; stops past limit.
function distance(a, b, limit) {
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  let prev2 = null;
  let prev = [];
  for (let j = 0; j <= b.length; j++) prev.push(j);
  for (let i = 1; i <= a.length; i++) {
    const ca = a[i - 1];
    const cur = new Array(b.length + 1).fill(0);
    cur[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cb = b[j - 1];
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca !== cb ? 1 : 0));
      if (prev2 !== null && i > 1 && j > 1 && ca === b[j - 2] && a[i - 2] === cb) {
        cur[j] = Math.min(cur[j], prev2[j - 2] + 1);
      }
    }
    if (Math.min(...cur) > limit) return limit + 1;
    prev2 = prev;
    prev = cur;
  }
  return prev[prev.length - 1];
}

const ENDING = /(ing|ed|es|s|d)$/;
const MEND_CACHE = new Map();

// A misspelt key word put right; anything else left as it is.
function mend(word) {
  let found = MEND_CACHE.get(word);
  if (found === undefined) {
    found = mendWord(word);
    if (MEND_CACHE.size >= 20000) MEND_CACHE.clear();
    MEND_CACHE.set(word, found);
  }
  return found;
}

function mendWord(word) {
  if (SHORT_FORMS.has(word)) return SHORT_FORMS.get(word);
  // words here are [a-z0-9]+, so "ascii" holds; isalpha means no digit in it
  if (word.length < 5 || KEY_WORDS.has(word) || !/^[a-z]+$/.test(word)) return word;
  const limit = word.length < 8 ? 1 : 2;
  const near = [];
  for (const key of KEY_WORDS) {
    if (key[0] === word[0]) {
      const d = distance(word, key, limit);
      if (d <= limit) near.push([d, key]);
    }
  }
  if (near.length === 0) return word;
  const closest = Math.min(...near.map(([d]) => d));
  let candidates = near.filter(([d]) => d === closest).map(([, k]) => k).sort();
  if (candidates.length > 1) {
    // "completd" is as near "complete" as "completed"; the last letter
    // typed says which was meant.
    candidates = candidates.filter((k) => k[k.length - 1] === word[word.length - 1]);
  }
  if (candidates.length !== 1) return word;
  const best = candidates[0];
  // "watches" is not a slip for "watched": a different ending is a
  // different word, not a typo. A letter dropped ("completd") is still a slip.
  if (word.replace(ENDING, "") === best.replace(ENDING, "") && word.length >= best.length) return word;
  return best;
}

export function normalise(text) {
  text = fixUrdu(String(text || ""));
  text = text.replaceAll("\u2019", "'").replaceAll("\u2018", "'").replaceAll("\u201c", '"')
    .replaceAll("\u201d", '"').replaceAll("\u200b", " ").replaceAll("\xa0", " ");
  text = text.toLowerCase();
  text = text.replace(rx(R`\bh\.\s*w\b\.?`, "gu"), " homework ");
  text = text.replace(rx(R`\bc\.\s*w\b\.?`, "gu"), " classwork ");
  text = text.replace(rx(R`\bhome[\s-]+work\b`, "gu"), "homework");
  text = text.replace(rx(R`\bclass[\s-]+work\b`, "gu"), "classwork");
  text = text.replace(/[a-z0-9]+/g, (m) => mend(m));
  return text.replace(/[ \t]+/g, " ");
}

const SPLIT = rx(R`(?<=[.!?؟۔])\s+|\n+|\s+(?=(?:homework|classwork|written task)\s*:)|(?<=:)\s+(?=[a-z])`, "u");

function sentences(text) {
  const parts = text.split(SPLIT).map((p) => stripChars(p, " -\u2013\u2014\u2022*,;"));
  return parts.filter((p) => p);
}

// ---- 2. what each sentence is doing -----------------------------------------

const URL_RE = rx(R`https?://\S+|www\.\S+`);
const URL_ALL = rx(R`https?://\S+|www\.\S+`, "giu");
const NO_HOMEWORK = rx(R`(?<!\w)no\s+homework(?!\w)|(?<!\w)no\s+h\.?w(?!\w)`);
const SAYS_HOMEWORK = rx(R`(?<!\w)(homework|for homework|as (their |your )?homework)(?!\w)` +
  R`|گھر کا کام|گھر کے کام|ghar ka (kaam|kam)`);
const SAYS_CLASSWORK = rx(R`(?<!\w)classwork(?!\w)|جماعت کا کام`);

const PARENTS = rx(R`\b(dear|respected|to the)\s+parents?\b|\bparents? (and|&) (dear )?students\b` +
  R`|محترم والدین|محترمہ والدہ|والدین|\bwalid[ae]in\b`);
const SCHOOL_VOICE = rx(R`\bschool (administration|management)\b|\bcommittee\b|\bcampus\b` +
  R`|\bplease be informed\b|\bplease note that\b|\bkindly note that\b` +
  R`|\bwe (are pleased|appreciate|request)\b|\bour school\b`);
const CIRCULAR = rx(R`\bcircular\b|\bnotice\b(?! of)|\bspecifications?\b|\bpolicy\b`);

const TO_STUDENT = rx(R`(^|\b(kindly|please|also|must|should|need to|have to|remember to|forget to|` +
  R`make sure (to|you)|are required to|were asked to|are asked to|` +
  R`are instructed to|are expected to|is given to|you can|you will|and)\s+)` +
  R`(` + DO_VERBS + R`)\b`);
const LEAD_IN = rx(R`^((dear|respected|hi|hello|hey)\b[^.,!:]{0,40}?(students?|delegates|stars|masters|` +
  R`everyone|all|class|children|kids|engineers)\b[\s,!:]*|note\s*:\s*|also\s+|now\s+|` +
  R`and\s+|then\s+|kindly\s+|please\s+|(?:task|homework|reinforcement)\s*:\s*|` +
  R`(?:for|by|before) (?:tomorrow|the next class|next class|monday|tuesday|wednesday|` +
  R`thursday|friday|saturday|sunday)\b[\s,:]*|at home[\s,:]+|tomorrow[\s,:]+|` +
  R`of (?:the )?[\w\s]{0,25}?club\s+)+`);
const STARTS_WITH_DO = rx(R`^(` + DO_VERBS + R`)\b`);
const QUESTIONS_DONE = rx(R`\b(these|the following|following|the given|given|those|some|the)\s+` +
  R`(\w+\s+)?(questions?|exercises?|tasks?)\b`);
const AND_DO = rx(R`\band (` + DO_VERBS + R`)\b`);
const FUTURE_WORK = rx(R`\b(students|they|you) will (write|complete|do|solve|need|bring|prepare|submit|` +
  R`answer|draw|learn|practi[sc]e|finish|read)\b|\bwill need\b`);
const FOR_LATER = rx(R`\bat home\b|\bover the weekend\b|\bfor tomorrow\b|\bby (tomorrow|monday|` +
  R`tuesday|wednesday|thursday|friday|saturday|sunday|next)\b|\bnext class\b` +
  R`|\bnext lesson\b|\bupcoming (class|lesson|club)\b|\bat your earliest\b` +
  R`|\btomorrow\b|\bon (monday|tuesday|wednesday|thursday|friday|saturday)\b`);
const NOT_YET = rx(R`\bnot (yet )?(uploaded|submitted|completed|done)\b|\bpending (work|task)`);
const BRING = rx(R`\bbring\b|\bwhat to bring\b|\brequired (stationery|items|materials)\b` +
  R`|\bthe following (items|materials)\b`);
const URDU_DO = rx(R`(لکھیں|کریں|لائیں|آئیں|سنائیں|یاد کر|مکمل کر|تحریر کر|تیاری کر|لے کر آ|پڑھیں|بنائیں)`);
const ROMAN_DO = rx(R`\b(likhein|likhen|likhain|karein|karen|kijiye|kijye|layein|laein|layen|aayein|aaein|` +
  R`ayein|sunayein|sunaein|yaad kar\w*|le kar aa\w*|parhein|parhen|banayein)\b`);

const PAST_BY_STUDENTS = rx(R`\b(students?|we|they|children|pupils|the class|class)\s+(\w+ly\s+|also\s+|then\s+` +
  R`|all\s+)?(\w+ed|` + IRREGULAR_PAST + R`)\b`);
const PASSIVE_DONE = rx(R`\b(was|were|has been|have been|had been)\s+(\w+\s+)?(` + DONE_PARTICIPLES + R`)\b`);
const STARTS_PAST = rx(R`^(recalled|revised|practi[sc]ed|discussed|completed|learnt|learned|did|` +
  R`wrote|attempted|solved|explored|identified|made|performed|watched|reviewed)\b`);
const IN_CLASS = rx(R`\bin (the )?class\b|\bin today'?s (lesson|class)\b|\btoday in (class|science|` +
  R`english|math|urdu|islamiat)\b|\bduring the (lesson|class)\b|\bin (the )?lesson` +
  R` today\b|\bin class today\b|\bin (the )?\w+ lesson today\b|\btoday'?s lesson\b`);
const URDU_DONE = rx(R`(جماعت میں|کروائی گئی|کروائے گئے|کروایا گیا|لکھوائی گئی|لکھوائے گئے|لکھوایا گیا|` +
  R`پڑھائی گئی|پڑھایا گیا|پروائی گئی|کیئے|کیے گئے|درست کروائی)`);
const ROMAN_DONE = rx(R`\baaj class (mein|me|main)\b|\b(parhaya|parhai|likhwaya|likhwaye|likhwai|` +
  R`karwaya|karwaye|karwai|sikhaya) (gaya|gaye|gayi|gai)\b`);

const TEST_WORDS = rx(R`\b(tests?|quiz(zes)?|exams?|examinations?|assessments?|cats?|catso|date ?sheet|` +
  R`spellathon|olympiad|mid-?terms?|finals?|viva)\b`);
const PRACTICE_QUIZ = rx(R`\b(practi[sc]e|practi[sc]ing|attempt|play|try)\b[^.]{0,30}\bquiz|\bonline quiz\b` +
  R`|\bquizizz\b|\bwayground\b|\bkahoot\b`);
const NOTICE_WORDS = rx(R`\b(remain closed|will be closed|closed|holidays?|vacations?|timings?|fees?|` +
  R`uniform|postponed|cancell?ed|rescheduled|resume|ptm|parent[- ]teacher|results?|` +
  R`report cards?|admissions?|urgent|guidelines|discipline|online classes|` +
  R`will be held|orientation|feedback form|birthdays?|dress code|schedule change` +
  R`|last date|deadline)\b|بند رہے گا|چھٹی|\bband rahega\b|\bchutti\b`);
const KEEP_THIS = rx(R`\b(syllabus|agenda|slides|ppt|handouts?|reading material|study material|` +
  R`for your (reference|information|convenience)|reference|email ids?|e-?mail addresses|` +
  R`teacher details|subject teachers?|house details|timetable|time table|book list|` +
  R`list of (books|teachers)|script|recording|resources|websites?|` +
  R`homework schedule|meet link|class link|details are in|document having)\b`);
const HANDED_OVER = rx(R`\b(please|kindly) (find|receive|see|refer)\b|\bfind (the )?attached\b|\bin the ` +
  R`(below |following )?attachment\b|\bis attached\b|\bare attached\b|\bhere (is|are)\b` +
  R`|\battached (is|are)\b|\bshared (below|with you)\b`);
const NOTES_WORD = rx(R`(?<!took )(?<!take )(?<!taking )(?<!given )(?<!made )(?<!make )` +
  R`(?<!took the )(?<!the given )\bnotes\b`);
const CHEER = rx(R`\b(congratulations|congrats|well done|mubarak|happy|welcome( back)?|greetings|wishes|` +
  R`proud|thank you|thanks|bravo|best of luck|good luck|all the best)\b|🎉|🥳`);
const CLUB_NEWS = rx(R`\b(club|clubs|squad|society|house matches|assembly day|sign-?ups?|interested ` +
  R`students|calling all|join us|photos|pictures|stay tuned|keep checking|continue to ` +
  R`check|further updates)\b`);

const WRITTEN_TASK = rx(R`\bwritten task\s*:`, "u");
const WRITTEN_TASK_DONE = rx(R`\bwritten task\s*:\s*(\w+ed|did|wrote)\b`, "u");
const STARTS_HAND_OVER = rx(R`^(find|receive|see|note|check|refer)\b`, "u");

const ATTACHMENT_SHARE = 0.5;       // an attachment's say when the post has words of its own
const ATTACHMENT_OPENING = 500;     // characters of an attachment that are read
const ATTACHMENT_WHEN_BELOW = 4.0;  // a post with words is helped only when its reading is this weak

function leadOff(sentence) {
  return pyStrip(sentence.replace(LEAD_IN, ""));
}

function hasTitlePrefix(title) {
  return title.startsWith("post by ");
}

// Scores for each section, and the signs found, strongest first.
// Each sign is [weight, section, sign].
export function readPost(post) {
  const title0 = normalise(post.title || "");
  const body = normalise(post.body || "");
  // Classroom's "Post by <teacher>" stands in for a missing title.
  const title = hasTitlePrefix(title0) ? "" : title0;
  const whole = title ? `${title}. ${body}` : body;
  const scores = {};
  for (const s of SECTIONS) scores[s] = 0.0;
  const signs = [];

  function add(section, weight, sign) {
    scores[section] += weight;
    signs.push([weight, section, sign]);
  }

  // Only the opening of an attachment (the website has none, so this is
  // normally empty; kept so the code path matches the original).
  let attached = normalise(Array.from(post.attachment_text || "").slice(0, ATTACHMENT_OPENING).join(""));
  const bare_post = pySplit(body.replace(URL_ALL, " ")).length < 12;
  // "Please receive the agenda": the post already says what the file is.
  if (attached && (KEEP_THIS.test(whole) || HANDED_OVER.test(whole))) attached = "";
  const share = bare_post ? 1.0 : ATTACHMENT_SHARE;
  // Who it is written to: the post says -- or, when it says next to
  // nothing, the notice in the attachment does.
  const about = bare_post ? whole + "\n" + attached : whole;
  const to_parents = PARENTS.test(about);
  const school = SCHOOL_VOICE.test(about);
  const negated = NO_HOMEWORK.test(whole);

  // The labels teachers put on posts.
  if (!negated && SAYS_HOMEWORK.test(whole) && !KEEP_THIS.test(whole)) {
    add("Homework", !to_parents ? 8 : 3, "says homework");
  }
  if (SAYS_CLASSWORK.test(title)) add("Classwork", 3, "titled classwork");
  else if (SAYS_CLASSWORK.test(body)) add("Classwork", 2, "says classwork");
  if (negated) add("Classwork", 2, "says no homework");
  if (WRITTEN_TASK.test(whole) && !WRITTEN_TASK_DONE.test(whole)) {
    add("Homework", 2.5, "a written task set");
  }

  // Sentence by sentence. Each kind of sign counts up to twice, so a long
  // post does not win on length alone.
  const seen = new Map();

  function once(key, section, weight, sign, cap = 2) {
    if ((seen.get(key) || 0) < cap) {
      seen.set(key, (seen.get(key) || 0) + 1);
      if (key.startsWith("att:")) add(section, weight * share, `the attachment: ${sign}`);
      else add(section, weight, sign);
    }
  }

  function scan(lines, tag) {
    // "Day to Day Assessment" as a title, then "...was conducted today": a
    // test the post describes as over is part of the lesson, title and all.
    const test_over = lines.some((l) => TEST_WORDS.test(l) && (PASSIVE_DONE.test(l) || PAST_BY_STUDENTS.test(l)));
    let quoting = false;
    for (const line of lines) {
      const bare = leadOff(line);
      const past = PAST_BY_STUDENTS.test(line) || PASSIVE_DONE.test(line) ||
        STARTS_PAST.test(bare) || URDU_DONE.test(line) || ROMAN_DONE.test(line);
      let told = STARTS_WITH_DO.test(bare) || TO_STUDENT.test(line) || FUTURE_WORK.test(line) ||
        URDU_DO.test(line) || ROMAN_DO.test(line);
      if (quoting && !FOR_LATER.test(line)) {
        // "Students completed the following questions: ... Answer each
        // in 2-3 sentences. Q6. Explain..." -- the questions they did,
        // quoted, not new work.
        told = false;
      }
      if (past && QUESTIONS_DONE.test(line)) quoting = true;
      if (STARTS_HAND_OVER.test(bare)) {
        // "find attached..." hands something over -- unless it goes on
        // "...and come prepared".
        told = AND_DO.test(bare);
      }
      const told_here = told && !(past && !FUTURE_WORK.test(line));
      const club = CLUB_NEWS.test(line);

      if (past && !told_here && club) {
        once(tag + "club-met", "Extra", 3, "club or school news");
      } else if (past && !told_here) {
        once(tag + "past", "Classwork", 3, "describes the lesson");
        if (IN_CLASS.test(line)) once(tag + "in-class", "Classwork", 1, "in class");
      } else if (IN_CLASS.test(line) && !told_here) {
        once(tag + "in-class", "Classwork", 1.5, "in class");
      }
      if (told_here && (to_parents || school)) {
        // Instructions to parents are part of a notice, not homework.
        once(tag + "told-parents", "Important", 1.5, "asks parents to do something");
      } else if (told_here) {
        once(tag + "told", "Homework", 4, "asks the student to do something");
      }
      if (told_here) {
        if (FOR_LATER.test(line)) once(tag + "later", "Homework", to_parents ? 0.8 : 1.5, "for later");
      }
      if (BRING.test(line) && !past) {
        once(tag + "bring", "Homework", to_parents ? 1 : 2, "something to bring");
      }
      if (NOT_YET.test(line)) once(tag + "not-yet", "Homework", 3, "work still missing");
      if (TEST_WORDS.test(line) && !past && !test_over) {
        if (PRACTICE_QUIZ.test(line)) once(tag + "practice", "Homework", 1.5, "a practice quiz");
        else once(tag + "test", "Important", 3.5, "a test or exam");
      }
      if (NOTICE_WORDS.test(line) && !past) once(tag + "notice", "Important", 2.5, "a school notice");
      if (CIRCULAR.test(line)) once(tag + "circular", "Important", 3, "a circular or notice", 1);
      if (KEEP_THIS.test(line)) once(tag + "keep", "Notes", 3.5, "something to keep", 1);
      if (NOTES_WORD.test(line) && !past && !told_here) once(tag + "notes", "Notes", 2.5, "notes", 1);
      if (HANDED_OVER.test(line)) once(tag + "handed", "Notes", 1.5, "shared to keep", 1);
      if (CHEER.test(line)) once(tag + "cheer", "Extra", 4, "a greeting or congratulations", 1);
      if (club && !told_here && !past) once(tag + "club", "Extra", 1.5, "club or school news", 1);
    }
  }

  scan(sentences(whole), "");
  // The words inside the attachments. When the post itself says next to
  // nothing, the attachment is the post and counts in full; otherwise the
  // teacher's own words come first and it counts for half.
  // A post with words of its own and a clear reading needs no help.
  if (attached && (bare_post || Math.max(...Object.values(scores)) < ATTACHMENT_WHEN_BELOW)) {
    scan(sentences(attached), "att:");
  }

  if (to_parents) add("Important", 2.5, "written to parents");
  if (school) add("Important", 1.5, "written by the school");
  const words = pySplit(body.replace(URL_ALL, " "));
  if (URL_RE.test(body) && words.length <= 3) {
    add("Notes", 4, "a link to keep");
  } else if (!pyStrip(body) && title && !attached) {
    add("Notes", 1, "a title and attachment only");
  }

  const kind = String(post.kind || "").toLowerCase();
  const due = Boolean(post.due_at);
  if (kind === "assignment" && due) {
    add("Homework", 2, "an assignment with a due date");
  } else if (kind === "assignment" || kind === "question") {
    add("Homework", 0.5, "an assignment");
  }
  signs.sort((a, b) => b[0] - a[0]);   // stable, like Python's sort
  return { scores, signs };
}

function best(scores) {
  const ranked = Object.entries(scores).sort((a, b) => (b[1] - a[1]) || (TIE_ORDER[a[0]] - TIE_ORDER[b[0]]));
  return [ranked[0][0], ranked[0][1], ranked[1][1]];
}

// The strongest sign that points where the post went.
function why(section, signs) {
  for (const [, towards, sign] of signs) {
    if (towards === section) return `on this PC: ${sign}`;
  }
  return `on this PC: reads like ${section.toLowerCase()}`;
}

// The section the words point to, or section null when they point nowhere at all.
export function byPhrases(post) {
  const { scores, signs } = readPost(post);
  const [section, top] = best(scores);
  if (top <= 0) return { section: null, why: "" };
  return { section, why: why(section, signs) };
}

// ---- 3. the keyword rules (rules.json), for what the phrases leave open ------

const RULES = Object.freeze({
  "_comment": "Edit the keywords freely, then press 'Re-sort all' in the app. Rules run in the order listed in 'priority' and the first match wins. Matching is case-insensitive and whole-word, so 'hw' will not match 'shower'. The title is checked before the body. Classwork also catches posts that describe what was already done in the lesson ('students revised...', 'in the class'); Homework and Important are checked first, so anything still owed by the student wins over a record of the lesson.",
  "priority": [
    "Important",
    "Homework",
    "Classwork",
    "Notes",
    "Extra"
  ],
  "rules": {
    "Important": {
      "keywords": [
        "exam",
        "exams",
        "test",
        "tests",
        "quiz",
        "quizzes",
        "midterm",
        "final",
        "finals",
        "deadline",
        "urgent",
        "important",
        "cancelled",
        "canceled",
        "postponed",
        "rescheduled",
        "reschedule",
        "reminder",
        "result",
        "results",
        "graded",
        "grade",
        "permission slip",
        "fee",
        "fees",
        "notice",
        "announcement"
      ],
      "due_within_hours": 48
    },
    "Homework": {
      "keywords": [
        "homework",
        "hw",
        "h.w",
        "assignment",
        "submit",
        "submission",
        "turn in",
        "turn it in",
        "due",
        "worksheet"
      ],
      "kinds_with_due": [
        "assignment",
        "question"
      ]
    },
    "Classwork": {
      "keywords": [
        "classwork",
        "class work",
        "c.w",
        "in class",
        "class activity",
        "lab",
        "practical",
        "exercise",
        "exercises",
        "practice problems",
        "group work",
        "activity",
        "in the class",
        "during the class",
        "during the lesson",
        "in the lesson",
        "done in class",
        "did in class",
        "completed in class",
        "covered in class",
        "discussed in class",
        "revised",
        "revision",
        "recalled"
      ],
      "kinds_without_due": [
        "assignment"
      ]
    },
    "Notes": {
      "keywords": [
        "notes",
        "note",
        "slides",
        "ppt",
        "presentation",
        "chapter",
        "summary",
        "reference",
        "reading",
        "textbook",
        "handout",
        "recording",
        "syllabus",
        "schedule",
        "agenda"
      ],
      "kinds": [
        "material"
      ]
    },
    "Extra": {
      "fallback": true
    }
  }
});

const FALLBACK_SECTION = "Extra";

function escapeRegExp(text) {
  return text.replace(/[\\^$.*+?()[\]{}|\/]/g, "\\$&");
}

const WORD_CACHE = new Map();

// Whole-word, case-insensitive. 'hw' must not match 'shower'.
function wordPattern(keyword) {
  let found = WORD_CACHE.get(keyword);
  if (!found) {
    found = rx(R`(?<!\w)` + escapeRegExp(pyStrip(keyword)) + R`(?!\w)`);
    WORD_CACHE.set(keyword, found);
  }
  return found;
}

function findKeyword(text, keywords) {
  if (!text) return null;
  for (const keyword of keywords) {
    if (wordPattern(keyword).test(text)) return keyword;
  }
  return null;
}

// Python's datetime.fromisoformat for the shapes Classroom gives, as a
// timestamp in ms. A time with no offset is Pakistan time (UTC+5, no DST).
// Returns NaN when Python would have raised.
const KARACHI_OFFSET_MIN = 300;
const ISO = /^(\d{4})-?(\d{2})-?(\d{2})(?:[T ](\d{2})(?::?(\d{2})(?::?(\d{2})(?:[.,](\d{1,6})\d*)?)?)?)?(Z|z|[+-]\d{2}(?::?\d{2}(?::?\d{2}(?:[.,]\d{1,6})?)?)?)?$/;

function parseIso(text) {
  const m = ISO.exec(String(text));
  if (!m) return NaN;
  const [, y, mo, d, h = "0", mi = "0", s = "0", frac = "0"] = m;
  const tz = m[8];
  const year = +y, month = +mo, day = +d, hour = +h, minute = +mi, second = +s;
  if (year < 1 || month < 1 || month > 12 || day < 1 || hour > 23 || minute > 59 || second > 59) return NaN;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const dim = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  if (day > dim) return NaN;
  let offsetMin = KARACHI_OFFSET_MIN;
  let offsetSec = 0;
  if (tz) {
    if (tz === "Z" || tz === "z") offsetMin = 0;
    else {
      const t = /^([+-])(\d{2}):?(\d{2})?(?::?(\d{2}))?/.exec(tz);
      const sign = t[1] === "-" ? -1 : 1;
      const oh = +t[2], om = +(t[3] || 0), os = +(t[4] || 0);
      if (oh > 23 || om > 59 || os > 59) return NaN;
      offsetMin = sign * (oh * 60 + om);
      offsetSec = sign * os;
    }
  }
  const micro = +(frac + "000000").slice(0, 6);
  const local = new Date(0);
  local.setUTCFullYear(year, month - 1, day);
  local.setUTCHours(hour, minute, second, 0);
  return local.getTime() - (offsetMin * 60 + offsetSec) * 1000 + micro / 1000;
}

// Sort a post: what it says first, then rules.json for what that leaves open.
// post: {title, body, kind, due_at}; now: a Date.  Returns {section, why}.
export function classify(post, now = new Date()) {
  const phrased = byPhrases(post);
  if (phrased.section) return phrased;

  const title = post.title || "";
  const body = post.body || "";
  const kind = (post.kind || "").toLowerCase();
  const due_at = post.due_at;
  const has_due = Boolean(due_at);
  const nowMs = now instanceof Date ? now.getTime() : new Date(now).getTime();

  for (const section of RULES.priority) {
    const rule = RULES.rules[section] || {};

    if (rule.fallback) return { section, why: "fallback" };

    // a due date close enough to matter
    const hours = rule.due_within_hours;
    if (hours && due_at) {
      const due = parseIso(due_at);
      if (!Number.isNaN(due)) {
        const gap = due - nowMs;
        if (0 <= gap && gap <= hours * 3600000) return { section, why: `due within ${hours}h` };
      }
    }

    if (kind && has_due && (rule.kinds_with_due || []).map((k) => k.toLowerCase()).includes(kind)) {
      return { section, why: `${kind} with a due date` };
    }
    if (kind && !has_due && (rule.kinds_without_due || []).map((k) => k.toLowerCase()).includes(kind)) {
      return { section, why: `${kind} with no due date` };
    }
    if (kind && (rule.kinds || []).map((k) => k.toLowerCase()).includes(kind)) {
      return { section, why: `kind is ${kind}` };
    }

    const keywords = rule.keywords || [];
    let hit = findKeyword(title, keywords);
    if (hit) return { section, why: `title has '${hit}'` };
    hit = findKeyword(body, keywords);
    if (hit) return { section, why: `body has '${hit}'` };
  }
  return { section: FALLBACK_SECTION, why: "fallback" };
}
