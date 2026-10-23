import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPortalInvite } from "@/lib/notify/invite-email";

const base = {
  ownerName: "Tara <Topic>",
  email: "tara@example.com",
  link: "https://owner.drp.test/auth/confirm?token_hash=abc&type=invite",
  portalUrl: "https://owner.drp.test",
  company: {
    legal_name: "DRP Real Estate Brokers LLC",
    registered_address: "DRP, Golden Mile 09, Palm Jumeirah, Dubai",
    phone: "+971 4 529 4904",
    email: "office@dubairapidproperties.com",
  },
};

test("the plain-text invite greets the owner, gives the link and the company's details", () => {
  const { subject, text } = buildPortalInvite(base);
  assert.equal(subject, "Your D|R|P owner portal is ready");
  assert.match(text, /^Dear Tara <Topic>,\n/);
  assert.match(text, /set your password here:\nhttps:\/\/owner\.drp\.test\/auth\/confirm\?token_hash=abc&type=invite\n/);
  assert.match(text, /Email: tara@example\.com/);
  assert.match(text, /\+971 4 529 4904 · office@dubairapidproperties\.com/);
});

test("the HTML invite escapes names and links, and loads the logo from the portal", () => {
  const { html } = buildPortalInvite(base);
  assert.match(html, /Welcome, Tara &lt;Topic&gt;/);
  assert.doesNotMatch(html, /<Topic>/);
  assert.match(html, /href="https:\/\/owner\.drp\.test\/auth\/confirm\?token_hash=abc&amp;type=invite"/);
  assert.match(html, /src="https:\/\/owner\.drp\.test\/logo-white\.png"/);
  assert.match(html, /DRP Real Estate Brokers LLC/);
});

test("missing company details leave no empty lines behind", () => {
  const { text } = buildPortalInvite({ ...base, company: null });
  assert.match(text, /Kind regards,\nD\|R\|P - Dubai Rapid Properties$/);
});

test("link mode: the link opens the portal, with no password or sign-in details", () => {
  const { text, html } = buildPortalInvite({ ...base, mode: "link", linkValidHours: 168 });
  assert.match(text, /Open your owner portal here:\nhttps:\/\/owner\.drp\.test\/auth\/confirm/);
  assert.match(text, /works for 7 days\. Whenever you need to open the portal after that, just ask us for a new link\./);
  assert.doesNotMatch(text, /password|Email: tara@example\.com/i);
  assert.match(html, />Open my portal</);
  assert.doesNotMatch(html, /Set my password|Signing in later/);
});
