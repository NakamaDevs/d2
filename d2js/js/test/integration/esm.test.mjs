import assert from "node:assert/strict";
import test from "node:test";
import { D2, layoutXyflow, talaRoutePath } from "@d2lang/d2";

test("installed ESM package compiles and renders", async () => {
  const d2 = new D2();
  try {
    const result = await d2.compile("x -> y");
    assert.ok(result.diagram);
    const svg = await d2.render(result.diagram);
    assert.match(svg, /<svg\b/);
    assert.match(svg, /<\/svg>/);
  } finally {
    await d2.dispose();
  }
});

test("installed ESM package exposes the xyflow adapter", async () => {
  const d2 = new D2();
  try {
    const result = await layoutXyflow(
      d2,
      [{ id: "a", width: 100, height: 40 }],
      [],
      { seeds: [1] }
    );
    assert.equal(result.nodes.length, 1);
    assert.equal(talaRoutePath([{ x: 0, y: 0 }, { x: 1, y: 1 }]), "M 0 0 L 1 1");
  } finally {
    await d2.dispose();
  }
});
