/* Class Ping website: saved look, the phone menu, and the Settings page.
   Choices are kept in this browser only (localStorage). If storage is
   blocked the site still works -- it just forgets them. */
(function () {
  "use strict";

  var KEY = "classping-site-settings";
  var DEFAULTS = { theme: "system", text: "normal", links: "plain" };
  var THEMES = [
    ["system", "Match my device"],
    ["study-lamp", "Study Lamp"],
    ["parchment", "Parchment"],
    ["chalkboard", "Chalkboard"],
    ["midnight-ink", "Midnight Ink"],
    ["ebony", "Ebony"]
  ];
  var SIZES = [["small", "Smaller"], ["normal", "Normal"], ["large", "Larger"]];
  var root = document.documentElement;

  function read() {
    var saved = {};
    try { saved = JSON.parse(localStorage.getItem(KEY) || "{}") || {}; } catch (e) { saved = {}; }
    return {
      theme: saved.theme || DEFAULTS.theme,
      text: saved.text || DEFAULTS.text,
      links: saved.links || DEFAULTS.links
    };
  }

  function save(prefs) {
    try { localStorage.setItem(KEY, JSON.stringify(prefs)); return true; } catch (e) { return false; }
  }

  function apply(prefs) {
    if (prefs.theme === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", prefs.theme);
    root.setAttribute("data-text", prefs.text);
    root.setAttribute("data-links", prefs.links);
  }

  // Before the page draws, so it never flashes the wrong colours.
  root.classList.add("js");
  apply(read());

  function radio(name, value, checked, inner) {
    return '<label class="choice"><input type="radio" name="' + name + '" value="' + value + '"' +
      (checked ? " checked" : "") + '><span class="face">' + inner + "</span></label>";
  }

  function settingsPage(holder) {
    var prefs = read();
    var themes = THEMES.map(function (t) {
      return radio("theme", t[0], prefs.theme === t[0],
        '<span class="swatch sw-' + t[0] + '"><i></i><i></i></span>' + t[1]);
    }).join("");
    var sizes = SIZES.map(function (s) {
      return radio("text", s[0], prefs.text === s[0], s[1]);
    }).join("");
    holder.innerHTML =
      '<form class="settings-form">' +
        '<section class="settings-group" aria-labelledby="set-look"><h2 id="set-look">Appearance</h2>' +
          "<p>The same five looks as the app, or follow your device's light or dark mode.</p>" +
          '<div class="themes" role="radiogroup" aria-labelledby="set-look">' + themes + "</div></section>" +
        '<section class="settings-group" aria-labelledby="set-size"><h2 id="set-size">Text size</h2>' +
          "<p>Make everything on the site a little smaller or larger.</p>" +
          '<div class="segmented" role="radiogroup" aria-labelledby="set-size">' + sizes + "</div></section>" +
        '<section class="settings-group" aria-labelledby="set-links"><h2 id="set-links">Links</h2>' +
          '<label class="toggle"><span>Underline every link<small>Easier to spot links inside the text.</small></span>' +
          '<input type="checkbox" name="links"' + (prefs.links === "underline" ? " checked" : "") + "></label></section>" +
        '<div class="settings-foot"><p>Saved in this browser only. <span class="saved" aria-live="polite">Saved</span></p>' +
          '<button type="button" class="reset">Reset to default</button></div>' +
      "</form>";

    var form = holder.querySelector("form");
    var note = holder.querySelector(".saved");
    var timer = null;
    function said() {
      note.classList.add("show");
      clearTimeout(timer);
      timer = setTimeout(function () { note.classList.remove("show"); }, 1400);
    }
    function current() {
      return {
        theme: form.elements.theme.value || DEFAULTS.theme,
        text: form.elements.text.value || DEFAULTS.text,
        links: form.elements.links.checked ? "underline" : "plain"
      };
    }
    form.addEventListener("change", function () {
      var chosen = current();
      apply(chosen);
      if (save(chosen)) said();
    });
    form.addEventListener("submit", function (event) { event.preventDefault(); });
    holder.querySelector(".reset").addEventListener("click", function () {
      form.elements.theme.value = DEFAULTS.theme;
      form.elements.text.value = DEFAULTS.text;
      form.elements.links.checked = false;
      apply(DEFAULTS);
      if (save(DEFAULTS)) said();
    });
  }

  function phoneMenu() {
    var bar = document.querySelector(".top");
    var button = bar && bar.querySelector(".menu-toggle");
    if (!button) return;
    function set(open) {
      bar.classList.toggle("open", open);
      button.setAttribute("aria-expanded", open ? "true" : "false");
    }
    button.addEventListener("click", function (event) {
      event.stopPropagation();
      set(!bar.classList.contains("open"));
    });
    document.addEventListener("click", function (event) {
      if (!bar.contains(event.target)) set(false);
    });
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && bar.classList.contains("open")) { set(false); button.focus(); }
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    phoneMenu();
    var holder = document.getElementById("settings-root");
    if (holder) settingsPage(holder);
  });
})();
