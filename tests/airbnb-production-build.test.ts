import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

/**
 * The portal as the Cloudflare build bundles it: esbuild with keepNames, which
 * wraps functions in a `__name` helper. Only the code the extension and the
 * bookmarklet carry to airbnb.com is built.
 */
function productionBuild(): { airbnbJs: string; bookmarklet: string } | null {
  let esbuild: typeof import("esbuild");
  try {
    esbuild = require("esbuild");
  } catch {
    return null;
  }
  const out = esbuild.buildSync({
    stdin: {
      contents: `
        import { extensionFiles } from "@/lib/airbnb/extension";
        import { listingBookmarklet } from "@/lib/airbnb/listing-collect";
        module.exports = {
          airbnbJs: extensionFiles("https://admin.example.com", null)["drp-airbnb/airbnb.js"],
          bookmarklet: listingBookmarklet("https://admin.example.com/units/from-airbnb"),
        };`,
      resolveDir: root,
      loader: "ts",
    },
    absWorkingDir: root,
    tsconfig: join(root, "tsconfig.json"),
    bundle: true,
    keepNames: true,
    platform: "node",
    format: "cjs",
    write: false,
    logLevel: "silent",
  });
  const mod = { exports: {} as { airbnbJs: string; bookmarklet: string } };
  new Function("module", "exports", "require", out.outputFiles[0].text)(mod, mod.exports, require);
  return mod.exports;
}

/** Just enough of a page for the collector: nothing on it, and no `__name` anywhere. */
function page() {
  const opened: string[] = [];
  const alerts: string[] = [];
  const doc = { body: { innerText: "Pricing\n229 د.إ per night" }, querySelectorAll: () => [], querySelector: () => null };
  return {
    opened,
    alerts,
    context: {
      document: doc,
      location: { href: "https://www.airbnb.co.uk/multicalendar/1703596941988303704" },
      window: { open: (url: string) => opened.push(url) },
      alert: (m: string) => alerts.push(m),
      encodeURIComponent,
      JSON,
    },
  };
}

test("the built collector runs on airbnb.com, where __name does not exist", (t) => {
  const built = productionBuild();
  if (!built) return t.skip("esbuild is not installed");
  // The build does wrap the collector's functions...
  assert.match(built.airbnbJs, /__name\(/);

  // ...and the bookmarklet still reads the page.
  const p = page();
  runInNewContext(decodeURIComponent(built.bookmarklet.replace(/^javascript:/, "")), p.context);
  assert.deepEqual(p.alerts, []);
  assert.equal(p.opened.length, 1);
  const sent = JSON.parse(decodeURIComponent(p.opened[0].split("#")[1]));
  assert.equal(sent.u, "https://www.airbnb.co.uk/multicalendar/1703596941988303704");

  // So does the extension's copy.
  const start = built.airbnbJs.indexOf("var collectAirbnbListing = ");
  const end = built.airbnbJs.indexOf("\n", built.airbnbJs.indexOf("})()", start));
  const collect = runInNewContext(built.airbnbJs.slice(start + "var collectAirbnbListing = ".length, end).replace(/;\s*$/, ""), {});
  const q = page();
  assert.equal(collect(q.context.document, q.context.location.href, true).text, "Pricing\n229 د.إ per night");
});
