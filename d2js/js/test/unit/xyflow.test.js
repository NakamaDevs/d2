import { describe, expect, test } from "bun:test";
import { D2 } from "../../dist/node-esm/index.js";
import { layoutXyflow, talaRoutePath } from "../../src/xyflow.js";

function fakeD2(response, capture = {}) {
  return {
    async compile(source, options) {
      capture.source = source;
      capture.options = options;
      return response;
    },
  };
}

describe("layoutXyflow", () => {
  test("runs the bundled TALA engine", async () => {
    const d2 = new D2();
    try {
      const result = await layoutXyflow(
        d2,
        [
          { id: "a", width: 120, height: 48 },
          { id: "b", width: 120, height: 48 },
        ],
        [{ id: "a-b", source: "a", target: "b" }],
        { seeds: [1] }
      );

      expect(result.nodes).toHaveLength(2);
      expect(result.nodes.every((node) => Number.isFinite(node.position.x))).toBe(true);
      expect(result.edges[0].data.tala.route.length).toBeGreaterThan(1);
    } finally {
      await d2.dispose();
    }
  });

  test("maps TALA positions and routes without changing caller data", async () => {
    const nodes = Object.freeze([
      Object.freeze({
        id: "issue-a",
        measured: { width: 180, height: 72 },
        data: { title: "A" },
      }),
      Object.freeze({ id: "issue-b", width: 220, height: 88, data: { title: "B" } }),
    ]);
    const edges = Object.freeze([
      Object.freeze({
        id: "blocks",
        source: "issue-a",
        target: "issue-b",
        data: { kind: "blocks" },
      }),
    ]);
    const response = {
      diagram: {
        shapes: [
          { id: "n0", pos: { x: 40, y: 60 }, width: 180, height: 72 },
          { id: "n1", pos: { x: 360, y: 90 }, width: 220, height: 88 },
        ],
        connections: [
          {
            src: "n0",
            dst: "n1",
            route: [
              { x: 220, y: 96 },
              { x: 300, y: 96 },
              { x: 300, y: 134 },
            ],
          },
        ],
      },
    };
    const capture = {};

    const result = await layoutXyflow(fakeD2(response, capture), nodes, edges, {
      direction: "right",
      seeds: [7, 11],
    });

    expect(result.nodes).toEqual([
      { ...nodes[0], position: { x: 40, y: 60 } },
      { ...nodes[1], position: { x: 360, y: 90 } },
    ]);
    expect(result.edges).toEqual([
      {
        ...edges[0],
        data: {
          kind: "blocks",
          tala: {
            route: [
              { x: 220, y: 96 },
              { x: 300, y: 96 },
              { x: 300, y: 134 },
            ],
          },
        },
      },
    ]);
    expect(capture.options).toEqual({ layout: "tala" });
    expect(capture.source).toContain("direction: right");
    expect(capture.source).toContain("tala-seeds: [7, 11]");
    expect(capture.source).toContain("n0: {width: 180; height: 72}");
    expect(capture.source).toContain("n0 -> n1");
    expect(nodes[0]).not.toHaveProperty("position");
  });

  test("uses documented default dimensions", async () => {
    const response = {
      diagram: { shapes: [{ id: "n0", pos: { x: 0, y: 0 } }], connections: [] },
    };
    const capture = {};

    const result = await layoutXyflow(
      fakeD2(response, capture),
      [{ id: "a", data: {} }],
      [],
      {
        defaultWidth: 150,
        defaultHeight: 50,
      }
    );

    expect(result.nodes[0].position).toEqual({ x: 0, y: 0 });
    expect(capture.source).toContain("n0: {width: 150; height: 50}");
  });

  test("rounds fractional measured dimensions up for D2", async () => {
    const response = {
      diagram: { shapes: [{ id: "n0", pos: { x: 0, y: 0 } }], connections: [] },
    };
    const capture = {};

    await layoutXyflow(
      fakeD2(response, capture),
      [{ id: "a", measured: { width: 150.2, height: 50.01 } }],
      []
    );

    expect(capture.source).toContain("n0: {width: 151; height: 51}");
  });

  test("preserves existing TALA edge metadata", async () => {
    const response = {
      diagram: {
        shapes: [
          { id: "n0", pos: { x: 0, y: 0 } },
          { id: "n1", pos: { x: 100, y: 0 } },
        ],
        connections: [
          {
            route: [
              { x: 0, y: 0 },
              { x: 100, y: 0 },
            ],
          },
        ],
      },
    };
    const result = await layoutXyflow(
      fakeD2(response),
      [{ id: "a" }, { id: "b" }],
      [{ id: "e", source: "a", target: "b", data: { tala: { color: "red" } } }]
    );

    expect(result.edges[0].data.tala.color).toBe("red");
  });

  test.each([
    [[{ id: "a" }, { id: "a" }], [], "duplicate node id"],
    [[{ id: "a" }], [{ id: "e", source: "a", target: "missing" }], "unknown target"],
    [[{ id: "a", width: -1, height: 20 }], [], "positive finite width"],
    [[{ id: "a", parentId: "group" }], [], "flat xyflow nodes"],
    [[{ id: "a", origin: [0.5, 0.5] }], [], "top-left node origin"],
  ])("rejects invalid xyflow input", async (nodes, edges, message) => {
    await expect(layoutXyflow(fakeD2({}), nodes, edges)).rejects.toThrow(message);
  });

  test("rejects an incomplete TALA result", async () => {
    const response = { diagram: { shapes: [], connections: [] } };
    await expect(layoutXyflow(fakeD2(response), [{ id: "a" }], [])).rejects.toThrow(
      "returned 0 nodes for 1 inputs"
    );
  });

  test("builds an SVG path for a xyflow custom edge", () => {
    expect(
      talaRoutePath([
        { x: 1, y: 2 },
        { x: 30, y: 40 },
      ])
    ).toBe("M 1 2 L 30 40");
    expect(talaRoutePath([])).toBe("");
  });
});
