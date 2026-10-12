import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isPathAllowed,
  portalForHost,
  portalForRequest,
  roleAllowedOnPortal,
  safeNextPath,
} from "@/lib/portal";

test("hostname decides the portal", () => {
  assert.equal(portalForHost("admin.dubairapidproperties.com"), "admin");
  assert.equal(portalForHost("owner.dubairapidproperties.com"), "owner");
  assert.equal(portalForHost("owner.localhost:3000"), "owner");
  assert.equal(portalForHost("ADMIN.localhost:3000"), "admin");
  assert.equal(portalForHost("dubairapidproperties.com"), null);
  assert.equal(portalForHost("drp-pms.vercel.app"), null);
  assert.equal(portalForHost("drp-pms.vercel.app", "admin"), "admin");
  assert.equal(portalForHost("localhost:3000", "nonsense"), null);
  assert.equal(portalForHost(null), null);
});

test("a Server Action redirect render keeps its portal", () => {
  // Next.js fetches the redirect target from localhost and forwards the
  // browser's hostname; that render must land on the same portal.
  assert.equal(portalForRequest("localhost:3000", "owner.localhost:3000"), "owner");
  assert.equal(portalForRequest("localhost:3000", "owner.localhost:3000", "admin"), "owner");
  assert.equal(portalForRequest("127.0.0.1:3000", "admin.drp.ae, proxy.internal"), "admin");
});

test("a forwarded host cannot move a request to the other portal", () => {
  assert.equal(portalForRequest("owner.drp.ae", "admin.drp.ae"), "owner");
  assert.equal(portalForRequest("admin.drp.ae", "owner.drp.ae"), "admin");
});

test("with no portal in either header, only the fallback applies", () => {
  assert.equal(portalForRequest("localhost:3000", null), null);
  assert.equal(portalForRequest("localhost:3000", "localhost:3000", "admin"), "admin");
  assert.equal(portalForRequest("drp-pms.vercel.app", "drp-pms.vercel.app"), null);
});

test("admin routes 404 on the owner host", () => {
  for (const path of ["/dashboard", "/units", "/units/abc", "/finance", "/settings", "/setup", "/bookings", "/incidents"]) {
    assert.equal(isPathAllowed("owner", path), false, path);
    assert.equal(isPathAllowed("admin", path), true, path);
  }
});

test("owner routes 404 on the admin host", () => {
  for (const path of ["/portal/owner", "/portal/owner/units", "/portal/owner/bookings"]) {
    assert.equal(isPathAllowed("admin", path), false, path);
    assert.equal(isPathAllowed("owner", path), true, path);
  }
});

test("tenant and guest portals are disabled everywhere", () => {
  for (const portal of ["admin", "owner"] as const) {
    assert.equal(isPathAllowed(portal, "/portal/tenant"), false);
    assert.equal(isPathAllowed(portal, "/portal/guest"), false);
  }
});

test("look-alike prefixes do not leak across portals", () => {
  assert.equal(isPathAllowed("owner", "/portal/ownerX"), false);
  assert.equal(isPathAllowed("owner", "/portal"), false);
  assert.equal(isPathAllowed("admin", "/portalish"), true);
  assert.equal(isPathAllowed("owner", "/loginx"), false);
});

test("shared routes and APIs", () => {
  for (const portal of ["admin", "owner"] as const) {
    assert.equal(isPathAllowed(portal, "/"), true);
    assert.equal(isPathAllowed(portal, "/login"), true);
    assert.equal(isPathAllowed(portal, "/auth/confirm"), true);
    assert.equal(isPathAllowed(portal, "/api/public/availability"), true);
  }
  // Unknown host: only the APIs answer.
  assert.equal(isPathAllowed(null, "/api/ical/abc.ics"), true);
  assert.equal(isPathAllowed(null, "/login"), false);
  assert.equal(isPathAllowed(null, "/"), false);
  assert.equal(isPathAllowed(null, "/dashboard"), false);
});

test("role gates", () => {
  assert.equal(roleAllowedOnPortal("owner", "owner"), true);
  assert.equal(roleAllowedOnPortal("owner", "admin"), false);
  assert.equal(roleAllowedOnPortal("super_admin", "owner"), false);
  assert.equal(roleAllowedOnPortal("super_admin", "admin"), true);
  assert.equal(roleAllowedOnPortal("finance", "admin"), true);
  assert.equal(roleAllowedOnPortal("tenant", "owner"), false);
  assert.equal(roleAllowedOnPortal("tenant", "admin"), false);
  assert.equal(roleAllowedOnPortal("guest", "owner"), false);
  assert.equal(roleAllowedOnPortal(null, "owner"), false);
});

test("post-login redirect cannot leave the site or cross portals", () => {
  assert.equal(safeNextPath("owner", "/portal/owner/units"), "/portal/owner/units");
  assert.equal(safeNextPath("owner", "/dashboard"), "/portal/owner");
  assert.equal(safeNextPath("admin", "/portal/owner"), "/dashboard");
  assert.equal(safeNextPath("admin", "//evil.example/x"), "/dashboard");
  assert.equal(safeNextPath("admin", "/\\evil.example"), "/dashboard");
  assert.equal(safeNextPath("admin", "https://evil.example"), "/dashboard");
  assert.equal(safeNextPath("admin", "/units?q=marina"), "/units?q=marina");
  assert.equal(safeNextPath("admin", ""), "/dashboard");
});
