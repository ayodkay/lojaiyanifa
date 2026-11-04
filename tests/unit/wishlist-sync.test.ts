import { describe, expect, it } from "vitest";

import { mergeWishlists } from "~/lib/wishlist-sync";

describe("mergeWishlists", () => {
  it("first sync on a browser: everything from both sides, the browser's order first", () => {
    expect(mergeWishlists(["b", "a"], ["a", "c"], null)).toEqual(["b", "a", "c"]);
  });

  it("keeps additions from either side since the last sync", () => {
    expect(mergeWishlists(["n", "a"], ["a", "m"], ["a"])).toEqual(["n", "a", "m"]);
  });

  it("a product removed on either side since the last sync stays removed", () => {
    expect(mergeWishlists(["b"], ["a", "b"], ["a", "b"])).toEqual(["b"]); // removed here
    expect(mergeWishlists(["a", "b"], ["b"], ["a", "b"])).toEqual(["b"]); // removed on another device
  });

  it("nothing changed: nothing changes", () => {
    expect(mergeWishlists(["a", "b"], ["a", "b"], ["a", "b"])).toEqual(["a", "b"]);
    expect(mergeWishlists([], [], [])).toEqual([]);
  });
});
