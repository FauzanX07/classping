// Class Ping on the web: settings that are not secret.
//
// CLIENT_ID is the "Web application" OAuth client of the Google Cloud project.
// A web client ID is public by design (every visitor's browser sees it); it
// is not a password and there is no client secret anywhere on this site.
// Leave it empty until the client exists: the page then says sign-in is not
// set up yet and offers the sample posts instead.
export const CLIENT_ID = "948214079897-dr2defmgp6tko2e4c2sf0th4fmp3il0b.apps.googleusercontent.com";

const G = "https://www.googleapis.com/auth/";
// The same read-only permissions as the desktop app's Sign in with Google.
export const SCOPES = [
  G + "classroom.courses.readonly",
  G + "classroom.announcements.readonly",
  G + "classroom.coursework.me.readonly",
  G + "classroom.courseworkmaterials.readonly",
  G + "classroom.rosters.readonly",
  G + "userinfo.email",
];
// Google sometimes reports a permission under its old (or a short) name.
export const ALIASES = {
  email: G + "userinfo.email",
  [G + "classroom.student-submissions.me.readonly"]: G + "classroom.coursework.me.readonly",
};
// Without these three there is nothing to show.
export const ESSENTIAL = SCOPES.slice(0, 3);
// The boxes on Google's permission page, in the words it uses (the same words as the Windows app).
export const BOX_WORDS = {
  [G + "classroom.courses.readonly"]: "your classes",
  [G + "classroom.announcements.readonly"]: "announcements",
  [G + "classroom.coursework.me.readonly"]: "your classwork",
  [G + "classroom.courseworkmaterials.readonly"]: "class materials",
  [G + "classroom.rosters.readonly"]: "teacher names",
  [G + "userinfo.email"]: "your email address",
};

// The date the terms and privacy policy last changed (their "Last updated" line). Changing it
// asks everyone to agree again.
export const TERMS_VERSION = "2026-10-05";
export const SUPPORT_EMAIL = "classpingsupport@gmail.com";
export const SYNC_EVERY_MS = 3 * 60 * 1000;     // while the page is open and signed in
export const FIRST_READ_MOST = 150;              // posts per list on the first read
export const REFRESH_READ_MOST = 300;            // most per list afterwards (reading stops at the first post already seen)
