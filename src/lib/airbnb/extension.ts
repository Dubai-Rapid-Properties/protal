/**
 * The "D|R|P for Airbnb" browser extension (Chrome, Edge, Brave), built on
 * download for the portal it came from. It does what the bookmark buttons do,
 * without the bookmarks: a small D|R|P button on Airbnb's pages imports the
 * listing (or its prices) to /units/from-airbnb, or sends a reservation to
 * /bookings/from-airbnb.
 *
 * The listing is read by the same collectAirbnbListing as the bookmarklet and
 * handed over the same way, in the new tab's URL fragment (#...), so the
 * portal pages need nothing new to receive it. The extension asks for no
 * permissions beyond running on Airbnb's pages and this portal; it calls no
 * server and stores nothing.
 */
import { collectAirbnbListing } from "@/lib/airbnb/listing-collect";
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
  var collectAirbnbListing = ${collectAirbnbListing.toString()};

  function open(path, data) {
    chrome.runtime.sendMessage({ open: PORTAL + path + "#" + encodeURIComponent(JSON.stringify(data)) });
  }

  function importListing() {
    try {
      open("/units/from-airbnb", collectAirbnbListing(document, location.href, true));
    } catch (e) {
      alert("D|R|P could not read this page. Use copy and paste on the portal's Import from Airbnb page instead.");
    }
  }

  function sendReservation() {
    open("/bookings/from-airbnb", { u: location.href, t: String(document.body.innerText || "").slice(0, 60000) });
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
    "</style>" +
    "<div class='menu' hidden>" +
    "<button data-do='listing'>Import listing<small>Details and photos, or prices from Pricing / Calendar</small></button>" +
    "<button data-do='reservation'>Send reservation<small>Guest, dates and payout</small></button>" +
    "<button data-do='hide' class='hide'>Hide this button on this page</button>" +
    "</div>" +
    "<button class='pill' title='D|R|P: import this Airbnb page'><b>D|R|P</b> Import</button>";

  var menu = root.querySelector(".menu");
  function toggle(show) {
    menu.hidden = show === undefined ? !menu.hidden : !show;
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
})();
`;
}

/** Opens the portal tab next to the Airbnb one; the toolbar icon opens the menu. */
function backgroundScript(adminUrl: string): string {
  return `// D|R|P for Airbnb, version ${EXTENSION_VERSION}.
var PORTAL = ${JSON.stringify(adminUrl)};

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
