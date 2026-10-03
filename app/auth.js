// Sign in with Google, in the browser. Google's own sign-in page does the
// signing in; this page never sees a password and has no secret key.
//
// What comes back is an access token that lasts about an hour. A page with no
// server cannot hold a refresh token (that needs a secret kept on a server), so
// a new token is asked for when the old one runs low -- quietly, using Google's
// existing session -- and if Google needs a click, the page says so.

import { CLIENT_ID, SCOPES, ALIASES, ESSENTIAL } from "./config.js";

const KEEP = "classping-web-token";      // sessionStorage: survives a reload, not a closed tab
let loading = null;
let client = null;
let waiting = null;                       // the sign-in being waited for: {resolve, reject}
let current = { token: "", expiresAt: 0, scopes: [] };

export function configured() { return Boolean(CLIENT_ID); }

function loadGoogle() {
  if (window.google && window.google.accounts && window.google.accounts.oauth2) return Promise.resolve();
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://accounts.google.com/gsi/client";
      script.async = true;
      script.onload = resolve;
      script.onerror = () => { loading = null; reject(new Error("Could not reach Google. Check your connection.")); };
      document.head.appendChild(script);
    });
  }
  return loading;
}

function remember() {
  try { sessionStorage.setItem(KEEP, JSON.stringify(current)); } catch (e) { /* blocked */ }
}

export function restore() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(KEEP) || "null");
    if (saved && saved.token && saved.expiresAt > Date.now() + 30000) current = saved;
  } catch (e) { /* nothing kept */ }
  return signedIn();
}

export function signedIn() { return Boolean(current.token) && Date.now() < current.expiresAt - 15000; }
export function token() { return signedIn() ? current.token : ""; }
export function minutesLeft() { return Math.max(0, Math.round((current.expiresAt - Date.now()) / 60000)); }
export function grantedScopes() { return current.scopes; }

// The permissions Google says were granted, under their current names.
function names(scopeText) {
  return String(scopeText || "").split(/\s+/).filter(Boolean).map((s) => ALIASES[s] || s);
}

export function missing() {
  return ESSENTIAL.filter((scope) => !current.scopes.includes(scope));
}

function handle(response) {
  const job = waiting;
  waiting = null;
  if (!job) return;
  if (!response || response.error) {
    const error = new Error((response && (response.error_description || response.error)) || "Sign-in did not finish.");
    error.code = (response && response.error) || "failed";
    job.reject(error);
    return;
  }
  current = {
    token: response.access_token,
    expiresAt: Date.now() + (Number(response.expires_in) || 3600) * 1000,
    scopes: names(response.scope),
  };
  remember();
  job.resolve(current);
}

function fail(error) {
  const job = waiting;
  waiting = null;
  if (!job) return;
  const e = new Error(error && error.type === "popup_failed_to_open"
    ? "Your browser blocked the Google window. Allow pop-ups for this site and try again."
    : "The Google window was closed before sign-in finished.");
  e.code = (error && error.type) || "closed";
  job.reject(e);
}

// prompt: "" (first time only), "select_account", "consent", or "none" (never show a screen).
export async function signIn({ prompt = "", hint = "" } = {}) {
  if (!configured()) throw new Error("Sign-in is not set up on this site yet.");
  await loadGoogle();
  if (!client) {
    client = window.google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: SCOPES.join(" "),
      callback: handle,
      error_callback: fail,
    });
  }
  if (waiting) waiting.reject(Object.assign(new Error("Another sign-in started."), { code: "superseded" }));
  return new Promise((resolve, reject) => {
    waiting = { resolve, reject };
    const options = { prompt };
    if (hint) options.hint = hint;
    client.requestAccessToken(options);
  });
}

export async function email() {
  const reply = await fetch("https://www.googleapis.com/oauth2/v3/userinfo",
    { headers: { Authorization: "Bearer " + current.token } });
  if (!reply.ok) return "";
  const data = await reply.json();
  return String(data.email || "");
}

// Give Google's permission back and forget the token.
export async function signOut() {
  const old = current.token;
  current = { token: "", expiresAt: 0, scopes: [] };
  try { sessionStorage.removeItem(KEEP); } catch (e) { /* blocked */ }
  if (old) {
    try {
      await loadGoogle();
      await new Promise((resolve) => window.google.accounts.oauth2.revoke(old, resolve));
    } catch (e) { /* offline: the token expires on its own within the hour */ }
  }
}

export function forgetToken() {
  current = { token: "", expiresAt: 0, scopes: [] };
  try { sessionStorage.removeItem(KEEP); } catch (e) { /* blocked */ }
}
