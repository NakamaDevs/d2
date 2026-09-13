const DEFAULT_WIDTH = 172;
const DEFAULT_HEIGHT = 36;
const DIRECTIONS = new Set(["up", "down", "left", "right"]);

function positiveFinite(value, field) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new TypeError(`${field} must be a positive finite number`);
  }
  return value;
}

function nodeSize(node, options) {
  const width =
    node.measured?.width ?? node.width ?? options.defaultWidth ?? DEFAULT_WIDTH;
  const height =
    node.measured?.height ?? node.height ?? options.defaultHeight ?? DEFAULT_HEIGHT;
  return {
    width: Math.ceil(
      positiveFinite(width, `node ${JSON.stringify(node.id)} positive finite width`)
    ),
    height: Math.ceil(
      positiveFinite(height, `node ${JSON.stringify(node.id)} positive finite height`)
    ),
  };
}

function validate(nodes, edges, options) {
  if (!Array.isArray(nodes) || !Array.isArray(edges)) {
    throw new TypeError("xyflow nodes and edges must be arrays");
  }
  const direction = options.direction ?? "right";
  if (!DIRECTIONS.has(direction)) {
    throw new TypeError(`direction must be one of: ${[...DIRECTIONS].join(", ")}`);
  }

  const nodeIDs = new Set();
  const sizes = nodes.map((node) => {
    if (!node || typeof node.id !== "string" || node.id.length === 0) {
      throw new TypeError("each xyflow node must have a non-empty string id");
    }
    if (nodeIDs.has(node.id))
      throw new TypeError(`duplicate node id ${JSON.stringify(node.id)}`);
    if (node.parentId !== undefined && node.parentId !== null) {
      throw new TypeError("layoutXyflow currently supports only flat xyflow nodes");
    }
    if (
      node.origin !== undefined &&
      (!Array.isArray(node.origin) || node.origin[0] !== 0 || node.origin[1] !== 0)
    ) {
      throw new TypeError("layoutXyflow requires the top-left node origin [0, 0]");
    }
    nodeIDs.add(node.id);
    return nodeSize(node, options);
  });

  const edgeIDs = new Set();
  for (const edge of edges) {
    if (!edge || typeof edge.id !== "string" || edge.id.length === 0) {
      throw new TypeError("each xyflow edge must have a non-empty string id");
    }
    if (edgeIDs.has(edge.id))
      throw new TypeError(`duplicate edge id ${JSON.stringify(edge.id)}`);
    edgeIDs.add(edge.id);
    if (!nodeIDs.has(edge.source)) {
      throw new TypeError(
        `edge ${JSON.stringify(edge.id)} has an unknown source ${JSON.stringify(
          edge.source
        )}`
      );
    }
    if (!nodeIDs.has(edge.target)) {
      throw new TypeError(
        `edge ${JSON.stringify(edge.id)} has an unknown target ${JSON.stringify(
          edge.target
        )}`
      );
    }
  }

  let seeds;
  if (options.seeds !== undefined) {
    if (!Array.isArray(options.seeds) || options.seeds.length === 0) {
      throw new TypeError("seeds must be a non-empty array of safe integers");
    }
    seeds = options.seeds.map((seed) => {
      if (!Number.isSafeInteger(seed))
        throw new TypeError("each seed must be a safe integer");
      return seed;
    });
  }
  return { direction, nodeIDs: [...nodeIDs], sizes, seeds };
}

function d2Source(nodes, edges, contract) {
  const indexByID = new Map(nodes.map((node, index) => [node.id, index]));
  const lines = [`direction: ${contract.direction}`];
  if (contract.seeds) {
    lines.push(
      `vars: { d2-config: { data: { tala-seeds: [${contract.seeds.join("; ")}] } } }`
    );
  }
  nodes.forEach((_node, index) => {
    const size = contract.sizes[index];
    lines.push(`n${index}: {width: ${size.width}; height: ${size.height}}`);
  });
  edges.forEach((edge) => {
    lines.push(`n${indexByID.get(edge.source)} -> n${indexByID.get(edge.target)}`);
  });
  return lines.join("\n");
}

function point(point) {
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    throw new TypeError("TALA returned an invalid route point");
  }
  return { x: point.x, y: point.y };
}

/**
 * Run TALA through a D2.js instance and return xyflow-compatible elements.
 * Routed edge points are stored in edge.data.tala.route for a custom edge.
 */
export async function layoutXyflow(d2, nodes, edges, options = {}) {
  if (!d2 || typeof d2.compile !== "function") {
    throw new TypeError("layoutXyflow requires a D2 instance");
  }
  const contract = validate(nodes, edges, options);
  const result = await d2.compile(d2Source(nodes, edges, contract), { layout: "tala" });

  const shapes = result?.diagram?.shapes ?? [];
  const connections = result?.diagram?.connections ?? [];
  if (shapes.length !== nodes.length) {
    throw new Error(`TALA returned ${shapes.length} nodes for ${nodes.length} inputs`);
  }
  if (connections.length !== edges.length) {
    throw new Error(
      `TALA returned ${connections.length} edges for ${edges.length} inputs`
    );
  }
  const shapeByID = new Map(shapes.map((shape) => [shape.id, shape]));
  const layoutedNodes = nodes.map((node, index) => {
    const shape = shapeByID.get(`n${index}`);
    if (
      !shape ||
      !shape.pos ||
      !Number.isFinite(shape.pos.x) ||
      !Number.isFinite(shape.pos.y)
    ) {
      throw new Error(
        `TALA returned no valid position for node ${JSON.stringify(node.id)}`
      );
    }
    return { ...node, position: { x: shape.pos.x, y: shape.pos.y } };
  });
  const layoutedEdges = edges.map((edge, index) => {
    const route = (connections[index]?.route ?? []).map(point);
    const talaData =
      edge.data?.tala && typeof edge.data.tala === "object" ? edge.data.tala : {};
    return {
      ...edge,
      data: { ...(edge.data ?? {}), tala: { ...talaData, route } },
    };
  });
  return { nodes: layoutedNodes, edges: layoutedEdges };
}

/** Convert an edge.data.tala.route value into a path for xyflow BaseEdge. */
export function talaRoutePath(route) {
  if (!Array.isArray(route) || route.length === 0) return "";
  return route
    .map((value, index) => {
      const routePoint = point(value);
      return `${index === 0 ? "M" : "L"} ${routePoint.x} ${routePoint.y}`;
    })
    .join(" ");
}
