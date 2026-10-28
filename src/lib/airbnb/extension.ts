/**
 * The "D|R|P for Airbnb" browser extension (Chrome, Edge, Brave), built on
 * download for the portal it came from. It does what the bookmark buttons do,
 * without the bookmarks: a small D|R|P button on Airbnb's pages imports the
 * listing (or its prices) to /units/from-airbnb, or sends a reservation to
 * /bookings/from-airbnb.
 *
 * The listing is read by the same collectAirbnbListing as the bookmarklet and
 * handed over the same way, in the new tab's URL fragment (#...), so the
 * portal pages need nothing new to receive it.
 *
 * Prices also sync on their own: while a listing's Pricing or Calendar page is
 * open on Airbnb, each time its prices change on screen the extension sends
 * them to /units/from-airbnb/sync, which saves them on the unit (and so on the
 * website) as the signed-in staff member. That is the only call it makes, and
 * it asks for no permissions beyond running on Airbnb's pages and this portal.
 */
import { collectorSource } from "@/lib/airbnb/listing-collect";
import { EXTENSION_VERSION } from "@/lib/airbnb/extension-version";

export { EXTENSION_VERSION };

/** The folder the .zip unpacks to (the one staff pick in "Load unpacked"). */
export const EXTENSION_FOLDER = "drp-airbnb";

/** Airbnb's sites (match patterns cannot wildcard a domain's ending). */
const AIRBNB_DOMAINS = [
  "airbnb.com",
  "airbnb.ae",
  "airbnb.co.uk",
  "airbnb.ca",
  "airbnb.com.au",
  "airbnb.co.in",
  "airbnb.ie",
  "airbnb.de",
  "airbnb.fr",
  "airbnb.es",
  "airbnb.it",
  "airbnb.nl",
  "airbnb.ch",
  "airbnb.com.sg",
];

/** The portal's own pages, for "is the extension installed?" (any port). */
function portalMatch(adminUrl: string): string {
  const u = new URL(adminUrl);
  return `${u.protocol}//${u.hostname}/*`;
}

function manifest(adminUrl: string, withIcon: boolean) {
  const icons = withIcon ? { "16": "icon.png", "32": "icon.png", "48": "icon.png", "128": "icon.png" } : undefined;
  return {
    manifest_version: 3,
    name: "D|R|P for Airbnb",
    version: EXTENSION_VERSION,
    description: "Imports Airbnb listings, prices and reservations into the D|R|P portal.",
    ...(icons ? { icons } : {}),
    action: { default_title: "D|R|P: import this Airbnb page", ...(icons ? { default_icon: icons } : {}) },
    background: { service_worker: "background.js" },
    // Lets the background send the price sync with the staff member's portal session.
    host_permissions: [portalMatch(adminUrl)],
    content_scripts: [
      { matches: AIRBNB_DOMAINS.map((d) => `https://*.${d}/*`), js: ["airbnb.js"], run_at: "document_idle" },
      { matches: [portalMatch(adminUrl)], js: ["portal.js"], run_at: "document_idle" },
    ],
  };
}

/** Runs on Airbnb: the floating button and its two actions. */
function airbnbScript(adminUrl: string): string {
  return `// D|R|P for Airbnb, version ${EXTENSION_VERSION}. Built by the portal: download it again rather than editing.
(function () {
  if (window.top !== window || document.getElementById("drp-airbnb-button")) return;
  var PORTAL = ${JSON.stringify(adminUrl)};
  var collectAirbnbListing = ${collectorSource()};

  function open(path, data) {
    chrome.runtime.sendMessage({ open: PORTAL + path + "#" + encodeURIComponent(JSON.stringify(data)) });
  }

  // After the extension is updated or reloaded, a page opened before can no longer reach it.
  function isStale(e) {
    return /context invalidated|Extension context|Receiving end does not exist/i.test(String(e && e.message));
  }
  var RELOAD = "the extension was updated: reload this Airbnb page (F5), then try again.";

  function importListing() {
    try {
      open("/units/from-airbnb", collectAirbnbListing(document, location.href, true));
    } catch (e) {
      alert(isStale(e) ? "D|R|P: " + RELOAD : "D|R|P could not read this page (" + String(e && e.message).slice(0, 200) + "). Use copy and paste on the portal's Import from Airbnb page instead, and tell the portal's admin this message.");
    }
  }

  // Automatic price sync. A listing's own host pages (Pricing, Calendar) only:
  // other host pages show no one listing's prices.
  var AUTO_KEY = "drp-auto-prices";
  var autoOff = false;
  try { autoOff = localStorage.getItem(AUTO_KEY) === "off"; } catch (e) {}
  var lastSig = "";
  var lastRun = 0;
  var timer = null;
  var sending = false;

  function isListingHostPage() {
    return /\\/(hosting\\/listings(\\/editor)?|hosting\\/calendar|manage-your-space|multicalendar)\\/\\d{3,25}/i.test(location.pathname);
  }

  // What changes when the prices on screen change: the page's price settings,
  // the calendar's night labels and the lines of text that carry an amount.
  function signature(d) {
    var lines = String(d.text || "").split("\\n").filter(function (l) { return /\\d/.test(l) && /AED|[\\u0600-\\u06FF\\uFE70-\\uFEFF]|\\u20C3|USD|\\$|€|£|%/.test(l); });
    return JSON.stringify([location.pathname, d.prices, d.nights, d.months, lines]);
  }

  function schedule() {
    if (autoOff || timer || !isListingHostPage()) return;
    // Airbnb fills the page in pieces: read it once it has had a moment, at most every few seconds.
    timer = setTimeout(function () {
      timer = null;
      syncPrices();
    }, Math.max(4000, lastRun + 10000 - Date.now()));
  }

  function syncPrices() {
    if (autoOff || sending || !isListingHostPage()) return;
    lastRun = Date.now();
    var d;
    try {
      d = collectAirbnbListing(document, location.href, true, false);
    } catch (e) {
      // Said once per kind of failure, not every few seconds.
      var why = "read:" + String(e && e.message);
      if (why !== lastSig) note("could not read this page's prices (" + String(e && e.message).slice(0, 200) + ").", true);
      lastSig = why;
      return;
    }
    var sig = signature(d);
    if (sig === lastSig) return;
    if (!Object.keys(d.prices).length && !d.nights.length && !d.months.length && !/AED|[\\u0600-\\u06FF\\uFE70-\\uFEFF]|\\u20C3|USD|\\$|€|£/.test(d.text)) return;
    sending = true;
    lastSig = sig;
    // The page's JSON is as it was when the page loaded; after a change on Airbnb a fresh copy has the new settings.
    fetch(location.href, { credentials: "include", cache: "no-store" })
      .then(function (r) { return r.ok ? r.text() : ""; })
      .then(function (html) {
        if (!html) return;
        var fresh = collectAirbnbListing(new DOMParser().parseFromString(html, "text/html"), location.href, false, false);
        d.prices = fresh.prices;
      })
      .catch(function () {})
      .then(function () {
        try {
          chrome.runtime.sendMessage({ sync: d }, answered);
        } catch (e) {
          sending = false;
          autoOff = true;
          note(isStale(e) ? RELOAD : "could not send the prices (" + String(e && e.message).slice(0, 200) + ").", true);
        }
        function answered(res) {
          sending = false;
          if (chrome.runtime.lastError || !res) {
            lastSig = "";
            return note(RELOAD, true);
          }
          // The calendar's months as the portal read them ("Dec 2026: 31 days, 27 priced").
          var days = res.calendar ? " (calendar: " + res.calendar + ")" : typeof res.nights === "number" ? " (" + res.nights + " calendar days read)" : "";
          if (res.status === "saved") note("Prices saved to " + res.unit + days + ": " + res.changes.join(", ") + ". The website follows within minutes.");
          else if (res.status === "unchanged") note("Prices match " + res.unit + " in the portal" + days + ".");
          else {
            // Sent again once the page changes (or after signing in, on the next change).
            if (res.status === "signin" || res.status === "error") lastSig = "";
            note(res.message || "could not save the prices.", true);
          }
        }
      });
  }

  function sendReservation() {
    try {
      open("/bookings/from-airbnb", { u: location.href, t: String(document.body.innerText || "").slice(0, 60000) });
    } catch (e) {
      alert(isStale(e) ? "D|R|P: " + RELOAD : "D|R|P could not send this reservation (" + String(e && e.message).slice(0, 200) + ").");
    }
  }

  // A reservation's page sends the reservation; anything else is a listing,
  // its pricing or its calendar.
  function isReservation() {
    return /\\/(hosting\\/)?reservations?\\b|\\/trips\\//i.test(location.pathname) || /[?&]confirmationCode=/i.test(location.search);
  }

  var host = document.createElement("div");
  host.id = "drp-airbnb-button";
  host.style.cssText = "position:fixed;right:20px;bottom:20px;z-index:2147483647;";
  var root = host.attachShadow({ mode: "closed" });
  root.innerHTML =
    "<style>" +
    ":host{all:initial}" +
    "*{box-sizing:border-box;font:500 14px/1.2 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif}" +
    ".pill{display:flex;align-items:center;gap:6px;border:0;border-radius:999px;padding:10px 14px;background:#111;color:#fff;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.25)}" +
    ".pill b{font-weight:700;letter-spacing:.04em}" +
    ".menu{position:absolute;right:0;bottom:48px;min-width:230px;background:#fff;color:#111;border-radius:12px;padding:6px;box-shadow:0 8px 28px rgba(0,0,0,.22)}" +
    ".menu[hidden]{display:none}" +
    ".menu button{display:block;width:100%;text-align:left;border:0;background:none;padding:10px 12px;border-radius:8px;cursor:pointer;color:#111}" +
    ".menu button:hover,.menu button.hint{background:#f2f2f2}" +
    ".menu small{display:block;margin-top:3px;font-size:12px;font-weight:400;color:#666}" +
    ".menu .hide{color:#666;font-size:12px;font-weight:400}" +
    ".note{position:absolute;right:0;bottom:48px;width:300px;background:#111;color:#fff;border-radius:12px;padding:10px 12px;font-size:13px;font-weight:400;line-height:1.35;box-shadow:0 8px 28px rgba(0,0,0,.22);cursor:pointer}" +
    ".note.bad{background:#b42318}" +
    ".note[hidden]{display:none}" +
    "</style>" +
    "<div class='note' hidden></div>" +
    "<div class='menu' hidden>" +
    "<button data-do='listing'>Import listing<small>Details and photos, or prices from Pricing / Calendar</small></button>" +
    "<button data-do='reservation'>Send reservation<small>Guest, dates and payout</small></button>" +
    "<button data-do='auto' class='hide'></button>" +
    "<button data-do='hide' class='hide'>Hide this button on this page</button>" +
    "</div>" +
    "<button class='pill' title='D|R|P: import this Airbnb page'><b>D|R|P</b> Import</button>";

  var menu = root.querySelector(".menu");
  var noteBox = root.querySelector(".note");
  var noteTimer = null;
  function note(text, bad) {
    menu.hidden = true;
    noteBox.textContent = "D|R|P: " + text;
    noteBox.className = bad ? "note bad" : "note";
    noteBox.hidden = false;
    clearTimeout(noteTimer);
    noteTimer = setTimeout(function () { noteBox.hidden = true; }, bad ? 15000 : 8000);
  }
  noteBox.addEventListener("click", function () { noteBox.hidden = true; });
  var autoItem = root.querySelector("button[data-do='auto']");
  function showAuto() {
    autoItem.textContent = autoOff ? "Turn on automatic price sync" : "Turn off automatic price sync";
  }
  showAuto();
  function toggle(show) {
    menu.hidden = show === undefined ? !menu.hidden : !show;
    if (!menu.hidden) noteBox.hidden = true;
    var items = menu.querySelectorAll("button[data-do='listing'], button[data-do='reservation']");
    var suggested = isReservation() ? "reservation" : "listing";
    for (var i = 0; i < items.length; i++) items[i].classList.toggle("hint", items[i].getAttribute("data-do") === suggested);
  }
  root.querySelector(".pill").addEventListener("click", function () { toggle(); });
  menu.addEventListener("click", function (e) {
    var b = e.target.closest("button");
    if (!b) return;
    var what = b.getAttribute("data-do");
    toggle(false);
    if (what === "listing") importListing();
    else if (what === "reservation") sendReservation();
    else if (what === "hide") host.remove();
    else if (what === "auto") {
      autoOff = !autoOff;
      try { localStorage.setItem(AUTO_KEY, autoOff ? "off" : "on"); } catch (e) {}
      showAuto();
      lastSig = "";
      note(autoOff ? "Automatic price sync is off on this browser." : "Automatic price sync is on.");
      schedule();
    }
  });
  document.addEventListener("click", function (e) { if (!e.composedPath().includes(host)) toggle(false); });

  // The toolbar icon opens the same menu.
  chrome.runtime.onMessage.addListener(function (msg) {
    if (msg && msg.menu) {
      if (!host.isConnected) document.documentElement.appendChild(host);
      toggle(true);
    }
  });

  document.documentElement.appendChild(host);

  // Airbnb changes pages without loading them, and fills prices in as they arrive.
  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  schedule();
})();
`;
}

/** Opens the portal tab next to the Airbnb one, sends the price sync; the toolbar icon opens the menu. */
function backgroundScript(adminUrl: string): string {
  return `// D|R|P for Airbnb, version ${EXTENSION_VERSION}.
var PORTAL = ${JSON.stringify(adminUrl)};

// The price sync, with the portal session (host_permissions lets it carry the cookie).
chrome.runtime.onMessage.addListener(function (msg, sender, reply) {
  if (!msg || !msg.sync) return;
  fetch(PORTAL + "/units/from-airbnb/sync", {
    method: "POST",
    credentials: "include",
    redirect: "manual",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(msg.sync),
  })
    .then(function (res) {
      // Signed out: the portal sends the request to its sign-in page.
      if (res.type === "opaqueredirect") return { status: "signin", message: "Sign in to the D|R|P portal in this browser to sync prices." };
      return res.json().catch(function () {
        return { status: "error", message: "The portal answered HTTP " + res.status + "." };
      });
    })
    .catch(function () {
      return { status: "error", message: "The portal could not be reached." };
    })
    .then(reply);
  return true;
});

chrome.runtime.onMessage.addListener(function (msg, sender) {
  // Only ever opens this portal's pages.
  if (!msg || typeof msg.open !== "string" || msg.open.indexOf(PORTAL + "/") !== 0) return;
  var where = { url: msg.open };
  if (sender.tab) {
    where.index = sender.tab.index + 1;
    where.openerTabId = sender.tab.id;
  }
  chrome.tabs.create(where);
});

chrome.action.onClicked.addListener(function (tab) {
  // Not on Airbnb (or the page has not finished loading): the import page explains.
  chrome.tabs.sendMessage(tab.id, { menu: true }).catch(function () {
    chrome.tabs.create({ url: PORTAL + "/units/from-airbnb" });
  });
});
`;
}

/** Runs on the portal: tells the import pages the extension is installed. */
function portalScript(): string {
  return `// D|R|P for Airbnb, version ${EXTENSION_VERSION}.
window.addEventListener("message", function (e) {
  if (e.source === window && e.data && e.data.drpExtension === "ping") {
    window.postMessage({ drpExtension: "pong", version: ${JSON.stringify(EXTENSION_VERSION)} }, location.origin);
  }
});
`;
}

const README = `D|R|P for Airbnb
================

Install (once, on each computer; Chrome, Edge or Brave):
1. Keep this folder somewhere it will stay (e.g. Documents). Chrome runs it from here.
2. Open chrome://extensions (edge://extensions in Edge).
3. Turn on "Developer mode" (top right).
4. Click "Load unpacked" and choose this folder.

Use: on Airbnb, click the black "D|R|P Import" button at the bottom right of the page.
- Import listing: on the listing (airbnb.com/rooms/...), its Pricing page or its Calendar.
- Send reservation: on a reservation's details.
Stay signed in to the portal. Nothing is saved until you check it there and click Save.

Prices sync on their own: open a listing's Pricing page or Calendar on Airbnb
(and change prices there as usual). The extension saves the prices shown onto
the unit whose Airbnb calendar is that listing, and a note at the bottom right
says what changed. Amounts must be in AED. The button's menu turns this off.

Update: download the extension again from the portal's Import from Airbnb page,
replace this folder's files, and click the reload arrow on chrome://extensions.
`;

/** The extension's files, under its folder, for zip(). */
export function extensionFiles(adminUrl: string, icon: Uint8Array | null): Record<string, string | Uint8Array> {
  const portal = adminUrl.replace(/\/+$/, "");
  const files: Record<string, string | Uint8Array> = {
    "manifest.json": JSON.stringify(manifest(portal, Boolean(icon)), null, 2) + "\n",
    "airbnb.js": airbnbScript(portal),
    "background.js": backgroundScript(portal),
    "portal.js": portalScript(),
    "README.txt": README,
  };
  if (icon) files["icon.png"] = icon;
  return Object.fromEntries(Object.entries(files).map(([name, body]) => [`${EXTENSION_FOLDER}/${name}`, body]));
}
