/**
 * Collects an Airbnb listing from its page (airbnb.com/rooms/<id>, or the
 * host's listing editor) in the browser. The "Import listing to D|R|P" button
 * runs this function on airbnb.com - its source is put into the bookmarklet -
 * and the import page runs it on a pasted page source. Nothing fetches Airbnb
 * from the portal's server.
 *
 * Airbnb ships the listing as JSON inside the page (script tags); the function
 * walks all of it for the shapes it knows (amenities, the description,
 * person capacity, photo addresses, host pricing settings) rather than for
 * exact paths, so a renamed
 * section still yields most fields. Every field may come back empty.
 *
 * It must stay self-contained (no imports, no outside names, plain syntax that browsers run as is):
 * `collectAirbnbListing.toString()` becomes the bookmarklet.
 */

export interface AirbnbListingSent {
  /** The listing page's address. */
  u: string;
  title: string | null;
  /** The description as Airbnb stores it (may be HTML). */
  desc: string | null;
  guests: number | null;
  /** Short lines like "2 bedrooms", "1.5 baths", "4 guests". */
  facts: string[];
  /** Amenity names as Airbnb shows them (available ones only). */
  amenities: string[];
  /** Photo addresses on muscache.com, in page order. */
  photos: string[];
  /** The page's visible text (empty when read from a page source). */
  text: string;
  /** Host pricing settings found in the page's JSON (amounts, factors, currency). */
  prices: Record<string, number | string>;
  /** Calendar days' labels carrying a date and a price ("Thu, October 15, 2026, AED 450"). */
  nights: string[];
  /**
   * Days read from the month calendar as laid out on screen ("2026-12-28 900د.إ"):
   * only the listing being looked at. `nights` may also hold other listings' days,
   * which the multi-listing calendar keeps in the page too.
   */
  shown: string[];
}

/**
 * `forAddress` (the default) keeps the result small enough to hand over in a
 * new tab's address; the extension's price sync posts it instead, so it sends
 * the whole page (a calendar's side panel comes last in its text).
 */
export function collectAirbnbListing(doc: Document, href: string, withText: boolean, forAddress?: boolean): AirbnbListingSent {
  const MAX_ENCODED = 60000;
  const photos: string[] = [];
  const seenPhoto: Record<string, boolean> = {};
  const amenities: string[] = [];
  const seenAmenity: Record<string, boolean> = {};
  const facts: string[] = [];
  let title = "";
  let desc = "";
  let guests: number | null = null;
  let nodes = 0;
  const prices: Record<string, number | string> = {};
  // Airbnb's host pricing settings, under the names its pages have used.
  const priceKeys: Record<string, string> = {
    defaultDailyPrice: "nightly",
    default_daily_price: "nightly",
    weekendPrice: "weekend",
    weekend_price: "weekend",
    weeklyPriceFactor: "weeklyFactor",
    weekly_price_factor: "weeklyFactor",
    monthlyPriceFactor: "monthlyFactor",
    monthly_price_factor: "monthlyFactor",
    cleaningFee: "cleaning",
    cleaning_fee: "cleaning",
    listingCurrency: "currency",
    listing_currency: "currency",
  };

  function addPhotos(s: string) {
    const re = /https:\/\/[a-z0-9.-]*muscache\.com\/im\/pictures\/[^\s"'?#\\),]+/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(s)) && photos.length < 120) {
      const url = m[0];
      if (/\/(user|users|airbnb-platform-assets|ui)\//i.test(url)) continue;
      if (!seenPhoto[url]) {
        seenPhoto[url] = true;
        photos.push(url);
      }
    }
  }

  function addFact(s: string) {
    if (facts.length < 30 && s.length < 120 && /\d\s*\+?\s*(guest|bedroom|bed|bath|bathroom)s?\b|\bstudio\b/i.test(s)) facts.push(s);
  }

  function walk(o: unknown, depth: number) {
    if (o == null || depth > 60 || ++nodes > 400000) return;
    if (typeof o === "string") {
      if (o.indexOf("muscache.com") >= 0) addPhotos(o);
      else if (o.length < 120) addFact(o);
      return;
    }
    if (typeof o !== "object") return;
    if (Array.isArray(o)) {
      for (let i = 0; i < o.length; i++) walk(o[i], depth + 1);
      return;
    }
    const r = o as Record<string, unknown>;
    const type = typeof r.__typename === "string" ? r.__typename : "";
    const ldType = String(r["@type"] || "");
    // Airbnb's own amenity objects: { __typename: "Amenity", title, available }.
    if (/Amenity$/.test(type) && typeof r.title === "string" && r.available !== false) addAmenity(r.title);
    // schema.org: { amenityFeature: [{ name, value }] }.
    if (/LocationFeatureSpecification/.test(ldType) && typeof r.name === "string" && r.value !== false) addAmenity(r.name);
    if (/TitleSection$/.test(type) && typeof r.title === "string" && !title) title = r.title;
    if (typeof r.listingTitle === "string" && !title) title = r.listingTitle;
    if (/VacationRental|Accommodation|Apartment|House|LodgingBusiness|Product/.test(ldType)) {
      if (typeof r.name === "string" && !title) title = r.name;
      if (typeof r.description === "string" && r.description.length > desc.length) desc = r.description;
    }
    const html = r.htmlDescription as Record<string, unknown> | undefined;
    if (html && typeof html.htmlText === "string" && html.htmlText.length > desc.length) desc = html.htmlText;
    if (typeof r.personCapacity === "number" && guests == null) guests = r.personCapacity;
    if (typeof r.numberOfBedrooms === "number") addFact(r.numberOfBedrooms + " bedrooms");
    if (typeof r.numberOfBathroomsTotal === "number") addFact(r.numberOfBathroomsTotal + " baths");
    for (const k in r) {
      if (!Object.prototype.hasOwnProperty.call(r, k)) continue;
      const v = r[k];
      const key = priceKeys[k];
      if (key && !(key in prices)) {
        const amount = v && typeof v === "object" ? (v as Record<string, unknown>).amount : v;
        if (typeof amount === "number" || (typeof amount === "string" && amount.length < 20)) prices[key] = amount;
      }
      walk(v, depth + 1);
    }
  }

  function addAmenity(name: string) {
    const n = name.replace(/\s+/g, " ").trim();
    if (n && !/^unavailable:/i.test(n) && !seenAmenity[n.toLowerCase()] && amenities.length < 150) {
      seenAmenity[n.toLowerCase()] = true;
      amenities.push(n);
    }
  }

  const scripts = doc.querySelectorAll('script[type="application/json"], script[type="application/ld+json"]');
  for (let s = 0; s < scripts.length; s++) {
    try {
      walk(JSON.parse(scripts[s].textContent || ""), 0);
    } catch {
      // Not JSON after all; the rest of the page still counts.
    }
  }

  // Photos shown on the page (the editor, or a page whose JSON was not found).
  const imgs = doc.querySelectorAll("img[src], img[srcset], source[srcset]");
  for (let j = 0; j < imgs.length; j++) {
    addPhotos((imgs[j].getAttribute("src") || "") + " " + (imgs[j].getAttribute("srcset") || ""));
  }
  const meta = function (sel: string) {
    const el = doc.querySelector(sel);
    return el ? el.getAttribute("content") || "" : "";
  };
  addPhotos(meta('meta[property="og:image"]'));

  // The host calendar: days with their date and price. The date is in the day's
  // label ("Saturday, November 1, 2026") or in an attribute ("2026-11-01"); the
  // price is in the label or shown in the day ("386 د.إ").
  const nights: string[] = [];
  const seenNight: Record<string, boolean> = {};
  // Dirhams in any Arabic letters ("د.إ") or the dirham sign: on Airbnb's English pages Arabic is only ever the currency.
  const money = /AED|USD|EUR|GBP|SAR|[\u0600-\u06FF\uFE70-\uFEFF]|\u20C3|\$|€|£/;
  // What a day shows, its parts kept apart ("1", "386د.إ" is not 1386).
  const shownIn = function (el: Element) {
    const live = (el as HTMLElement).innerText;
    return String(typeof live === "string" && live ? live : el.textContent || "").replace(/\s+/g, " ").trim();
  };
  const addNight = function (label: string) {
    if (money.test(label) && !seenNight[label] && nights.length < 400) {
      seenNight[label] = true;
      nights.push(label);
    }
  };
  // The month calendar as it is laid out on screen (Calendar → Month): under a
  // month's heading, each day's number with its price below it, in the column
  // of its weekday. Read from where the text sits rather than from Airbnb's
  // markup. A month any of whose days is not in its weekday's column (a heading
  // that belongs to another month, a wrong year) is left out, never guessed.
  const laidOut = function () {
    const found: string[] = [];
    const page = doc.body;
    if (!page || typeof doc.createTreeWalker !== "function" || typeof doc.createRange !== "function") return found;
    const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
    const WEEKDAY = /^(sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)\.?$|^(sunday|monday|tuesday|wednesday|thursday|friday|saturday)$/i;
    const boxes: { text: string; left: number; right: number; top: number; bottom: number }[] = [];
    const walker = doc.createTreeWalker(page, 4); // text nodes
    const range = doc.createRange();
    for (let node = walker.nextNode(); node && boxes.length < 30000; node = walker.nextNode()) {
      const text = (node.nodeValue || "").replace(/[‎‏؜‪-‮⁦-⁩]/g, "").replace(/\s+/g, " ").trim();
      if (!text || text.length > 40) continue;
      range.selectNodeContents(node);
      const r = range.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) boxes.push({ text: text, left: r.left, right: r.right, top: r.top, bottom: r.bottom });
    }

    // Weekday columns, from the header row (Mon … Sun).
    const columns: number[] = [];
    for (let i = 0; i < boxes.length; i++) {
      const w = boxes[i].text.match(WEEKDAY);
      if (!w) continue;
      const day = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"].indexOf(boxes[i].text.slice(0, 3).toLowerCase());
      if (columns[day] === undefined) columns[day] = (boxes[i].left + boxes[i].right) / 2;
    }
    for (let c = 0; c < 7; c++) if (columns[c] === undefined) return found;
    const xs = columns.slice().sort(function (a, b) { return a - b; });
    const colWidth = (xs[6] - xs[0]) / 6;
    if (!(colWidth > 20)) return found;
    const columnOf = function (x: number) {
      let best = 0;
      for (let c = 1; c < 7; c++) if (Math.abs(columns[c] - x) < Math.abs(columns[best] - x)) best = c;
      return Math.abs(columns[best] - x) < colWidth / 2 ? best : -1;
    };

    // Prices: "350د.إ" in one piece, or the amount and its currency side by side.
    const prices: { text: string; left: number; top: number }[] = [];
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      if (/%/.test(b.text) || !/^[^\da-z]*\d[\d,]*(\.\d{1,2})?[^\da-z]*$|^(AED|USD|EUR|GBP|SAR)\s*\d[\d,]*(\.\d{1,2})?$|^\d[\d,]*(\.\d{1,2})?\s*(AED|USD|EUR|GBP|SAR)$/i.test(b.text)) continue;
      let text = b.text;
      const next = boxes[i + 1];
      if (!money.test(text) && next && money.test(next.text) && !/\d/.test(next.text) && Math.abs(next.top - b.top) < 10) text += next.text;
      if (money.test(text)) prices.push({ text: text, left: b.left, top: b.top });
    }

    const heads: { month: number; year: number | null; top: number }[] = [];
    for (let i = 0; i < boxes.length; i++) {
      const m = boxes[i].text.match(/^([a-z]+)(?:\s+(\d{4}))?$/i);
      const month = m ? MONTHS.indexOf(m[1].toLowerCase()) : -1;
      if (m && month >= 0) heads.push({ month: month, year: m[2] ? Number(m[2]) : null, top: boxes[i].top });
    }

    // Day numbers sit at the same place in every day's box (its top left), so a
    // stray number elsewhere (a guest's "+ 1") is not taken for a day.
    const numbers: { text: string; left: number; right: number; top: number; bottom: number }[] = [];
    const offsets: number[] = [];
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      if (!/^\d{1,2}$/.test(b.text) || Number(b.text) < 1 || Number(b.text) > 31) continue;
      const c = columnOf((b.left + b.right) / 2);
      if (c < 0) continue;
      numbers.push(b);
      offsets.push(b.left - columns[c]);
    }
    const typical = offsets.slice().sort(function (a, b) { return a - b; })[Math.floor(offsets.length / 2)];

    // Each day under the nearest heading above it.
    const byHead: Record<number, { day: number; column: number; top: number; price: string | null }[]> = {};
    for (let i = 0; i < numbers.length; i++) {
      const b = numbers[i];
      if (Math.abs(offsets[i] - typical) > 8) continue;
      let head = -1;
      for (let h = 0; h < heads.length; h++) if (heads[h].top < b.top && (head < 0 || heads[h].top > heads[head].top)) head = h;
      if (head < 0) continue;
      let price: { text: string; left: number; top: number } | null = null;
      for (let p = 0; p < prices.length; p++) {
        const q = prices[p];
        if (q.top > b.top + 2 && q.top - b.top < colWidth * 0.9 && Math.abs(q.left - b.left) < colWidth / 2 && (!price || q.top < price.top)) price = q;
      }
      (byHead[head] = byHead[head] || []).push({ day: Number(b.text), column: columnOf((b.left + b.right) / 2), top: b.top, price: price ? price.text : null });
    }

    const now = new Date();
    for (const h in byHead) {
      const head = heads[Number(h)];
      const all = byHead[h];
      // A number shown twice (a guest's "+ 1" over the days): the day is the one
      // in line with the other days of its week; if neither is, the month is left out.
      const inLine = function (e: { top: number }) {
        let n = 0;
        for (let k = 0; k < all.length; k++) if (all[k] !== e && Math.abs(all[k].top - e.top) <= 3) n++;
        return n;
      };
      let clash = false;
      const days = all.filter(function (e) {
        const rivals = all.filter(function (o) { return o.day === e.day; });
        if (rivals.length === 1) return true;
        const best = Math.max.apply(null, rivals.map(inLine));
        const winners = rivals.filter(function (o) { return inLine(o) === best; });
        if (winners.length > 1) clash = true;
        return winners[0] === e;
      });
      if (clash) continue;
      // No year on the heading: the one that puts the month nearest today.
      let year = head.year;
      if (year == null) {
        const y = now.getFullYear();
        year = [y - 1, y, y + 1].sort(function (a, b) {
          return Math.abs(Date.UTC(a, head.month, 15) - now.getTime()) - Math.abs(Date.UTC(b, head.month, 15) - now.getTime());
        })[0];
      }
      // A whole month: its 1st is there and no day twice (part of the month
      // before, still under the next month's heading, is not).
      const seen: Record<number, boolean> = {};
      let fits = days.some(function (d) { return d.day === 1; });
      for (let d = 0; d < days.length && fits; d++) {
        fits = !seen[days[d].day];
        seen[days[d].day] = true;
      }
      for (let d = 0; d < days.length && fits; d++) {
        const date = new Date(Date.UTC(year, head.month, days[d].day));
        fits = date.getUTCMonth() === head.month && date.getUTCDay() === days[d].column;
      }
      if (!fits) continue;
      for (let d = 0; d < days.length; d++) {
        if (!days[d].price) continue;
        const iso = year + "-" + String(head.month + 1).padStart(2, "0") + "-" + String(days[d].day).padStart(2, "0");
        found.push(iso + " " + days[d].price);
      }
    }
    return found;
  };
  const shown = laidOut();

  const dated = doc.querySelectorAll("[data-testid], [data-date], [data-day], [data-key]");
  for (let d = 0; d < dated.length && nights.length < 400; d++) {
    const el = dated[d];
    const attrs = [el.getAttribute("data-date"), el.getAttribute("data-day"), el.getAttribute("data-testid"), el.getAttribute("data-key")].join(" ");
    const iso = attrs.match(/\b20\d\d-\d\d-\d\d\b/);
    if (!iso) continue;
    const shown = shownIn(el);
    if (shown.length < 60) addNight(iso[0] + " " + shown);
  }
  const days = doc.querySelectorAll("[aria-label], [title]");
  for (let d = 0; d < days.length && nights.length < 400; d++) {
    let label = days[d].getAttribute("aria-label") || days[d].getAttribute("title") || "";
    if (label.length > 200 || !/\b20\d\d\b/.test(label)) continue;
    if (!money.test(label)) {
      const shown = shownIn(days[d]);
      if (shown.length < 60 && money.test(shown)) label += " " + shown;
    }
    addNight(label);
  }

  const h1 = doc.querySelector("h1");
  if (!title && h1) title = (h1.textContent || "").trim();
  if (!title) title = meta('meta[property="og:title"]');
  if (!desc) desc = meta('meta[property="og:description"]') || meta('meta[name="description"]');

  const body = doc.body as HTMLElement | null;
  const out: AirbnbListingSent = {
    u: String(href).slice(0, 500),
    title: title ? title.slice(0, 300) : null,
    desc: desc ? desc.slice(0, 20000) : null,
    guests: guests,
    facts: facts,
    amenities: amenities,
    photos: photos.slice(0, 100),
    text: withText && body ? String(body.innerText || "").slice(0, forAddress === false ? 100000 : 15000) : "",
    prices: prices,
    nights: nights,
    shown: shown,
  };

  // The button hands this over in the address (#...): keep it well inside
  // what browsers accept by trimming the text first, then the description.
  const size = function () {
    return encodeURIComponent(JSON.stringify(out)).length;
  };
  if (forAddress === false) return out;
  while (size() > MAX_ENCODED && out.text.length > 0) out.text = out.text.slice(0, Math.floor(out.text.length / 2) - 1);
  while (size() > MAX_ENCODED && out.desc && out.desc.length > 500) out.desc = out.desc.slice(0, Math.floor(out.desc.length / 2));
  while (size() > MAX_ENCODED && out.nights.length > 30) out.nights = out.nights.slice(0, out.nights.length - 30);
  while (size() > MAX_ENCODED && out.photos.length > 10) out.photos = out.photos.slice(0, out.photos.length - 10);
  return out;
}

/**
 * collectAirbnbListing's source as an expression, to run on airbnb.com. The
 * production build (esbuild's keepNames, on Cloudflare) wraps the functions
 * inside it in calls to its own `__name` helper, which the source carries but
 * airbnb.com does not have ("__name is not defined"), so it comes along.
 */
export function collectorSource(): string {
  return "(function(){var __name=function(f){return f;};return " + collectAirbnbListing.toString() + ";})()";
}

/**
 * The bookmarklet: collects the listing on airbnb.com and opens `target` in a
 * new tab with it in the fragment (#...), which never reaches the server or
 * its logs. Encoded, because a javascript: address is URL-decoded before it
 * runs.
 */
export function listingBookmarklet(target: string): string {
  const code =
    "(function(){try{var d=" +
    collectorSource() +
    "(document,location.href,true);" +
    `window.open(${JSON.stringify(target)}+'#'+encodeURIComponent(JSON.stringify(d)),'_blank','noopener');` +
    "}catch(e){alert('D|R|P could not read this page. Use copy and paste on the import page instead.');}})();";
  return "javascript:" + encodeURIComponent(code);
}
