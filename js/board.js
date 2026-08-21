'use strict';
/* ------------------------------------------------------------------
   Board generation: hex geometry, terrain, number tokens, ports.
   Pointy-top hexes in axial coordinates, radius-2 board (19 hexes).
------------------------------------------------------------------ */

const HEX_R = 60;

const RESOURCES = {
  wandwood:  { label: 'Wandwood',  icon: '\u{1F332}', color: '#3f8a55' },
  runestone: { label: 'Runestone', icon: '\u{1F9F1}', color: '#b9663d' },
  owls:      { label: 'Owls',      icon: '\u{1F989}', color: '#8fb0d4' },
  mandrake:  { label: 'Mandrake',  icon: '\u{1F33F}', color: '#d3b13c' },
  galleons:  { label: 'Galleons',  icon: '\u{1F4B0}', color: '#c9b45e' },
};
const RES_KEYS = Object.keys(RESOURCES);

const TERRAINS = {
  forest:     { res: 'wandwood',  name: 'Forbidden Forest', fill: '#1e4230', glyph: '\u{1F332}' },
  quarry:     { res: 'runestone', name: 'Hogsmeade Quarry', fill: '#6b3a26', glyph: '⛏️' },
  owlery:     { res: 'owls',      name: 'The Owlery',       fill: '#3d628f', glyph: '\u{1F989}' },
  greenhouse: { res: 'mandrake',  name: 'Greenhouses',      fill: '#77641d', glyph: '\u{1F33F}' },
  gringotts:  { res: 'galleons',  name: 'Gringotts Vaults', fill: '#6b6a74', glyph: '\u{1F3E6}' },
  azkaban:    { res: null,        name: 'Azkaban',          fill: '#26262f', glyph: '\u{1F5FF}' },
};

const TERRAIN_BAG = [
  ...Array(4).fill('forest'),
  ...Array(3).fill('quarry'),
  ...Array(4).fill('owlery'),
  ...Array(4).fill('greenhouse'),
  ...Array(3).fill('gringotts'),
  'azkaban',
];

// Classic token spiral (18 tokens for 18 producing hexes).
const NUMBER_SPIRAL = [5, 2, 6, 3, 8, 10, 9, 12, 11, 4, 8, 10, 9, 4, 5, 6, 3, 11];

const AXIAL_DIRS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];

/* ---------- deterministic RNG so a game can be replayed / saved ---------- */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(arr, rng) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* ---------- geometry helpers ---------- */
function hexCenter(q, r) {
  return {
    x: HEX_R * Math.sqrt(3) * (q + r / 2),
    y: HEX_R * 1.5 * r,
  };
}

function hexCorner(cx, cy, i) {
  const angle = (Math.PI / 180) * (60 * i + 30);
  return { x: cx + HEX_R * Math.cos(angle), y: cy + HEX_R * Math.sin(angle) };
}

// Vertices shared by neighbouring hexes are at least 30px apart, so rounding to
// whole pixels merges them reliably without any float drift at the boundaries.
function snap(v) {
  const r = Math.round(v);
  return Object.is(r, -0) ? 0 : r;
}

function vkey(p) { return snap(p.x) + ':' + snap(p.y); }
function ekey(a, b) { return a < b ? a + '|' + b : b + '|' + a; }

function ring(rad) {
  if (rad === 0) return [{ q: 0, r: 0 }];
  let q = AXIAL_DIRS[4][0] * rad;
  let r = AXIAL_DIRS[4][1] * rad;
  const out = [];
  for (let i = 0; i < 6; i++) {
    for (let j = 0; j < rad; j++) {
      out.push({ q, r });
      q += AXIAL_DIRS[i][0];
      r += AXIAL_DIRS[i][1];
    }
  }
  return out;
}

// Outer ring first, spiralling inward — the classic token-placement path.
function spiralCoords() {
  return [...ring(2), ...ring(1), ...ring(0)];
}

function numberPips(n) {
  return n === null ? 0 : 6 - Math.abs(7 - n);
}

/* ---------- board construction ---------- */
function buildBoard(seed) {
  const rng = mulberry32(seed);
  const coords = spiralCoords();

  // Shuffle terrain until no two "red" (6/8) or identical numbers touch.
  let terrains, hexes;
  for (let attempt = 0; attempt < 500; attempt++) {
    terrains = shuffle(TERRAIN_BAG, rng);
    hexes = assembleHexes(coords, terrains);
    if (layoutIsFair(hexes)) break;
  }

  const vertices = {};
  const edges = {};

  hexes.forEach((hex) => {
    const corners = [];
    for (let i = 0; i < 6; i++) corners.push(hexCorner(hex.cx, hex.cy, i));
    hex.corners = corners.map(vkey);

    corners.forEach((pt, i) => {
      const key = vkey(pt);
      if (!vertices[key]) {
        vertices[key] = { key, x: snap(pt.x), y: snap(pt.y), hexes: [], adj: [], port: null };
      }
      if (!vertices[key].hexes.includes(hex.id)) vertices[key].hexes.push(hex.id);

      const nxt = corners[(i + 1) % 6];
      const nk = vkey(nxt);
      const ek = ekey(key, nk);
      if (!edges[ek]) {
        edges[ek] = { key: ek, a: key, b: nk, x1: snap(pt.x), y1: snap(pt.y), x2: snap(nxt.x), y2: snap(nxt.y), hexes: [] };
      }
      if (!edges[ek].hexes.includes(hex.id)) edges[ek].hexes.push(hex.id);
    });
  });

  // Vertex adjacency from edges.
  Object.values(edges).forEach((e) => {
    if (!vertices[e.a].adj.includes(e.b)) vertices[e.a].adj.push(e.b);
    if (!vertices[e.b].adj.includes(e.a)) vertices[e.b].adj.push(e.a);
  });

  const ports = placePorts(edges, vertices, rng);

  return { seed, hexes, vertices, edges, ports };
}

function assembleHexes(coords, terrains) {
  let tokenIdx = 0;
  return coords.map((c, i) => {
    const terrain = terrains[i];
    const t = TERRAINS[terrain];
    const number = t.res === null ? null : NUMBER_SPIRAL[tokenIdx++];
    const { x, y } = hexCenter(c.q, c.r);
    return {
      id: i, q: c.q, r: c.r, terrain, res: t.res, number,
      pips: numberPips(number), cx: x, cy: y,
    };
  });
}

function layoutIsFair(hexes) {
  const byCoord = new Map(hexes.map((h) => [h.q + ',' + h.r, h]));
  for (const h of hexes) {
    if (h.number === null) continue;
    for (const [dq, dr] of AXIAL_DIRS) {
      const n = byCoord.get((h.q + dq) + ',' + (h.r + dr));
      if (!n || n.number === null) continue;
      const bothRed = (h.number === 6 || h.number === 8) && (n.number === 6 || n.number === 8);
      if (bothRed || h.number === n.number) return false;
    }
  }
  return true;
}

const PORT_TYPES = ['any', 'any', 'any', 'any', 'wandwood', 'runestone', 'owls', 'mandrake', 'galleons'];
const PORT_GAPS = [0, 3, 6, 10, 13, 16, 20, 23, 27];

function placePorts(edges, vertices, rng) {
  const coastal = Object.values(edges).filter((e) => e.hexes.length === 1);
  coastal.forEach((e) => {
    e.mx = (e.x1 + e.x2) / 2;
    e.my = (e.y1 + e.y2) / 2;
    e.angle = Math.atan2(e.my, e.mx);
  });
  coastal.sort((a, b) => a.angle - b.angle);

  const types = shuffle(PORT_TYPES, rng);
  const ports = [];
  PORT_GAPS.forEach((idx, i) => {
    const e = coastal[idx % coastal.length];
    if (!e) return;
    const type = types[i];
    const port = {
      id: i, type, edgeKey: e.key, vertices: [e.a, e.b],
      x: e.mx, y: e.my,
      // push the marker a fixed distance outward from the board centre
      ox: snap(e.mx + (e.mx / Math.hypot(e.mx, e.my)) * 44),
      oy: snap(e.my + (e.my / Math.hypot(e.mx, e.my)) * 44),
    };
    ports.push(port);
    vertices[e.a].port = type;
    vertices[e.b].port = type;
  });
  return ports;
}
