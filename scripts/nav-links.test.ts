import assert from "node:assert/strict";
import test from "node:test";
import * as nav from "../lib/nav-links";

type Link = { key: string; href: string; label: string };

/** Keeps the first RED run explicit while the shared config is missing. */
const links = (nav as Record<string, unknown>).NAV_LINKS as
  | readonly Link[]
  | undefined;

function config(): readonly Link[] {
  assert.ok(Array.isArray(links), "NAV_LINKS is not exported from lib/nav-links");
  return links!;
}

test("the navbar config is the single source of truth for four destinations", () => {
  assert.deepEqual(config(), [
    { key: "dashboard", href: "/dashboard", label: "ড্যাশবোর্ড" },
    { key: "service", href: "/service", label: "সার্ভিস" },
    { key: "products", href: "/products", label: "প্রোডাক্ট" },
    { key: "parts", href: "/parts", label: "পার্টস" },
  ]);
});

test("nav keys and routes are unique so aria-current can only mark one page", () => {
  const all = config();
  assert.equal(new Set(all.map((l) => l.key)).size, all.length);
  assert.equal(new Set(all.map((l) => l.href)).size, all.length);
  for (const link of all) {
    assert.equal(link.href, `/${link.key}`);
    assert.ok(link.label.length > 0);
  }
});
