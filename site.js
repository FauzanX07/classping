/* Class Ping website: saved look, the phone menu, and the Settings page.
   Choices are kept in this browser only (localStorage). If storage is
   blocked the site still works -- it just forgets them. */
(function () {
  "use strict";

  var KEY = "classping-site-settings";
  // The web app starts in Light for anyone who has not chosen a look; the rest of the site follows the device.
  var DEFAULTS = { theme: /\/app\/?$|\/app\/index\.html$/.test(location.pathname) ? "light" : "system", text: "normal", links: "plain" };
  var THEMES = [
    ["light", "Light"],
    ["graphite", "Graphite"],
    ["system", "Match my device"],
    ["study-lamp", "Evergreen"],
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

  var calm = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function apply(prefs, ease) {
    if (ease && !calm) {                  // a changed look eases over (style.css), a saved one is there from the first paint
      root.classList.add("theme-fade");
      setTimeout(function () { root.classList.remove("theme-fade"); }, 400);
    }
    if (prefs.theme === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", prefs.theme);
    root.setAttribute("data-text", prefs.text);
    root.setAttribute("data-links", prefs.links);
    proofs(prefs.theme);
    homePicture(prefs.theme);
    barColour(prefs.theme);
  }

  // The colour of the browser's own bar on a phone follows the chosen look (the page's own tags only
  // follow the device). "Match my device" goes back to those.
  var BAR = { light: "#FFFFFF", graphite: "#202020", "study-lamp": "#1B201D", parchment: "#F7F2E8",
    chalkboard: "#1C2B24", "midnight-ink": "#171D2E", ebony: "#000000" };
  window.classPingBar = barColour;
  function barColour(theme) {
    var own = document.querySelector("meta[name=theme-color][data-own]");
    if (!BAR[theme]) { if (own) own.parentNode.removeChild(own); return; }
    if (!own) {
      own = document.createElement("meta");
      own.setAttribute("name", "theme-color");
      own.setAttribute("data-own", "");
      document.head.insertBefore(own, document.head.firstChild);
    }
    own.setAttribute("content", BAR[theme]);
  }

  // The pictures of the app on the privacy page follow the chosen look: img[data-proof="img/name"]
  // has name.png for Light and name-<look>.png for the others. "Match my device" uses Graphite in
  // the dark. If a picture is missing the Light one stays, and without scripts it is the one shown.
  var dark = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
  function proofs(theme) {
    if (theme === "system") theme = dark && dark.matches ? "graphite" : "light";
    var pics = document.querySelectorAll("img[data-proof]");
    for (var i = 0; i < pics.length; i++) {
      var pic = pics[i], base = pic.getAttribute("data-proof");
      var want = base + (theme === "light" ? "" : "-" + theme) + ".png?v=2";
      if (pic.getAttribute("data-shown") === want) continue;
      pic.setAttribute("data-shown", want);
      pic.onerror = function () { this.onerror = null; this.src = this.getAttribute("data-proof") + ".png?v=2"; };
      pic.src = want;
    }
  }
  // The home page picture: the dark picture for the dark looks, the light one for the light looks,
  // the phone-size one on a narrow screen. Without scripts the picture follows the device instead.
  var DARK_LOOKS = { graphite: 1, "study-lamp": 1, chalkboard: 1, "midnight-ink": 1, ebony: 1 };
  function homePicture(theme) {
    var img = document.querySelector("img[data-home]");
    if (!img) return;
    var isDark = theme === "system" ? !!(dark && dark.matches) : !!DARK_LOOKS[theme];
    var phone = window.matchMedia && window.matchMedia("(max-width: 640px)").matches;
    var want = img.getAttribute("data-home") + (phone ? "-phone" : "") + (isDark ? "-dark" : "") + ".png?v=1";
    if (img.getAttribute("data-shown") === want) return;
    var sources = img.parentNode.querySelectorAll("source");     // they would override the choice
    for (var i = 0; i < sources.length; i++) sources[i].parentNode.removeChild(sources[i]);
    img.setAttribute("data-shown", want);
    img.src = want;
  }
  var narrow = window.matchMedia ? window.matchMedia("(max-width: 640px)") : null;
  function pictures() { var t = read().theme; proofs(t); homePicture(t); }
  document.addEventListener("DOMContentLoaded", pictures);
  if (narrow && narrow.addEventListener) narrow.addEventListener("change", pictures);
  if (dark && dark.addEventListener) dark.addEventListener("change", pictures);

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
          "<p>Seven looks, or follow your device's light or dark mode.</p>" +
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
      apply(chosen, true);
      if (save(chosen)) said();
    });
    form.addEventListener("submit", function (event) { event.preventDefault(); });
    holder.querySelector(".reset").addEventListener("click", function () {
      form.elements.theme.value = DEFAULTS.theme;
      form.elements.text.value = DEFAULTS.text;
      form.elements.links.checked = false;
      apply(DEFAULTS, true);
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

  // Blocks below the first screen rise in once as they scroll into view. Only opacity and transform
  // change, so nothing moves; if anything here is missing, the blocks are simply there.
  function reveal() {
    if (!("IntersectionObserver" in window) || calm) return;
    var below = window.innerHeight - 40;
    var items = [].slice.call(document.querySelectorAll(
      ".band .section-head, .band .points, .band .mode, .band .split > *, .band .cta > *"))
      .filter(function (el) { return el.getBoundingClientRect().top > below; });
    if (!items.length) return;
    function show(el) {
      el.classList.add("in");
      el.addEventListener("transitionend", function done(event) {
        if (event.propertyName !== "opacity") return;
        el.removeEventListener("transitionend", done);
        el.classList.remove("rv", "in");          // back to plain styles, so hover effects are not slowed
        el.style.removeProperty("--i");
      });
    }
    var seen = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting || entry.boundingClientRect.top < 0) { seen.unobserve(entry.target); show(entry.target); }
      });
    }, { rootMargin: "0px 0px -6% 0px" });
    items.forEach(function (el) {
      el.classList.add("rv");
      el.style.setProperty("--i", [].indexOf.call(el.parentNode.children, el) % 2);
      seen.observe(el);
    });
    window.addEventListener("beforeprint", function () { items.forEach(function (el) { el.classList.add("in"); }); });
  }

  document.addEventListener("DOMContentLoaded", function () {
    phoneMenu();
    reveal();
    var holder = document.getElementById("settings-root");
    if (holder) settingsPage(holder);
  });
})();
