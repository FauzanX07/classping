/* Class Ping website: the Settings panel.
   Choices are kept in this browser only (localStorage), and the page still
   works if storage is blocked -- it just forgets them. */
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
    try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch (e) { /* kept for this visit only */ }
  }

  function apply(prefs) {
    var root = document.documentElement;
    if (prefs.theme === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", prefs.theme);
    root.setAttribute("data-text", prefs.text);
    root.setAttribute("data-links", prefs.links);
  }

  function radio(name, value, checked, inner) {
    return '<label class="choice"><input type="radio" name="' + name + '" value="' + value + '"' +
      (checked ? " checked" : "") + '><span class="face">' + inner + "</span></label>";
  }

  function build(prefs) {
    var themes = THEMES.map(function (t) {
      return radio("theme", t[0], prefs.theme === t[0],
        '<span class="swatch sw-' + t[0] + '"><i></i><i></i></span>' + t[1]);
    }).join("");
    var sizes = SIZES.map(function (s) {
      return radio("text", s[0], prefs.text === s[0], s[1]);
    }).join("");

    var dialog = document.createElement("dialog");
    dialog.className = "prefs";
    dialog.setAttribute("aria-labelledby", "prefs-title");
    dialog.innerHTML =
      '<form method="dialog" class="prefs-body">' +
        '<div class="prefs-head"><h2 id="prefs-title">Settings</h2><p>Saved in this browser only</p></div>' +
        '<fieldset><legend class="label">Appearance</legend><div class="themes">' + themes + "</div></fieldset>" +
        '<fieldset><legend class="label">Text size</legend><div class="segmented">' + sizes + "</div></fieldset>" +
        '<fieldset><legend class="label">Links</legend>' +
          '<label class="toggle"><span>Underline every link<small>Easier to spot links in the text.</small></span>' +
          '<input type="checkbox" name="links"' + (prefs.links === "underline" ? " checked" : "") + "></label>" +
        "</fieldset>" +
        '<div class="prefs-foot"><button type="button" class="reset">Reset to default</button>' +
          '<button type="submit" class="done">Done</button></div>' +
      "</form>";
    document.body.appendChild(dialog);

    var form = dialog.querySelector("form");
    function current() {
      return {
        theme: form.elements.theme.value || DEFAULTS.theme,
        text: form.elements.text.value || DEFAULTS.text,
        links: form.elements.links.checked ? "underline" : "plain"
      };
    }
    form.addEventListener("change", function () {
      var prefs = current();
      apply(prefs);
      save(prefs);
    });
    dialog.querySelector(".reset").addEventListener("click", function () {
      form.elements.theme.value = DEFAULTS.theme;
      form.elements.text.value = DEFAULTS.text;
      form.elements.links.checked = false;
      apply(DEFAULTS);
      save(DEFAULTS);
    });
    // A click on the dimmed area outside the panel closes it.
    dialog.addEventListener("click", function (event) {
      if (event.target === dialog) dialog.close();
    });
    return dialog;
  }

  apply(read());

  document.addEventListener("DOMContentLoaded", function () {
    var opener = document.querySelector(".prefs-open");
    if (!opener || typeof HTMLDialogElement === "undefined") {
      if (opener) opener.hidden = true;      // a very old browser: no panel, page still fine
      return;
    }
    var dialog = null;
    opener.hidden = false;
    opener.addEventListener("click", function () {
      if (!dialog) dialog = build(read());
      dialog.showModal();
    });
  });
})();
