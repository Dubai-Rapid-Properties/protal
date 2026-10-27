import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crc32, zip } from "@/lib/zip";
import { EXTENSION_FOLDER, EXTENSION_VERSION, extensionFiles } from "@/lib/airbnb/extension";

test("crc32 matches the standard check value", () => {
  assert.equal(crc32(new TextEncoder().encode("123456789")), 0xcbf43926);
});

test("the zip opens with unzip and holds the files as given", (t) => {
  let hasUnzip = true;
  try {
    execFileSync("unzip", ["-v"], { stdio: "ignore" });
  } catch {
    hasUnzip = false;
  }
  if (!hasUnzip) return t.skip("unzip is not installed");
  const dir = mkdtempSync(join(tmpdir(), "zip-"));
  const file = join(dir, "a.zip");
  writeFileSync(file, zip({ "x/hello.txt": "héllo", "x/bin.dat": new Uint8Array([0, 1, 2, 255]) }));
  execFileSync("unzip", ["-tq", file]);
  execFileSync("unzip", ["-q", file, "-d", dir]);
  assert.equal(readFileSync(join(dir, "x/hello.txt"), "utf8"), "héllo");
  assert.deepEqual([...readFileSync(join(dir, "x/bin.dat"))], [0, 1, 2, 255]);
});

test("the extension is built for the portal it came from", () => {
  const files = extensionFiles("https://admin.example.com/", null);
  const manifest = JSON.parse(files[`${EXTENSION_FOLDER}/manifest.json`] as string);
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.version, EXTENSION_VERSION);
  assert.equal(manifest.icons, undefined);
  assert.ok(manifest.content_scripts[0].matches.includes("https://*.airbnb.com/*"));
  assert.deepEqual(manifest.content_scripts[1].matches, ["https://admin.example.com/*"]);
  assert.equal(manifest.permissions, undefined);
  // Only this portal, for the price sync with the staff member's session.
  assert.deepEqual(manifest.host_permissions, ["https://admin.example.com/*"]);

  const airbnb = files[`${EXTENSION_FOLDER}/airbnb.js`] as string;
  assert.ok(airbnb.includes('"https://admin.example.com"'));
  assert.ok(airbnb.includes("collectAirbnbListing"));
  // Regexes and "\n" reach the browser escaped as written, not eaten by the template.
  assert.ok(airbnb.includes("multicalendar)\\/\\d{3,25}/i"));
  assert.ok(airbnb.includes('split("\\n")'));
  const background = files[`${EXTENSION_FOLDER}/background.js`] as string;
  assert.ok(background.includes('"https://admin.example.com" + "/units/from-airbnb/sync"') || background.includes('PORTAL + "/units/from-airbnb/sync"'));
  // Every script is plain JavaScript a browser can parse.
  for (const name of ["airbnb.js", "background.js", "portal.js"]) {
    assert.doesNotThrow(() => new Function(files[`${EXTENSION_FOLDER}/${name}`] as string), name);
  }
  assert.ok(extensionFiles("https://admin.example.com", new Uint8Array([1]))[`${EXTENSION_FOLDER}/icon.png`]);
});
