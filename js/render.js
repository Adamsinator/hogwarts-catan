'use strict';
/* ------------------------------------------------------------------
   SVG board rendering.
------------------------------------------------------------------ */

const SVGNS = 'http://www.w3.org/2000/svg';

function el(tag, attrs, parent) {
  const node = document.createElementNS(SVGNS, tag);
  if (attrs) Object.keys(attrs).forEach((k) => node.setAttribute(k, attrs[k]));
  if (parent) parent.appendChild(node);
  return node;
}

function hexPoints(cx, cy) {
  const pts = [];
  for (let i = 0; i < 6; i++) {
    const p = hexCorner(cx, cy, i);
    pts.push(p.x.toFixed(2) + ',' + p.y.toFixed(2));
  }
  return pts.join(' ');
}

function renderDefs(svg) {
  const defs = el('defs', null, svg);

  const sea = el('radialGradient', { id: 'seaGrad', cx: '50%', cy: '45%', r: '75%' }, defs);
  el('stop', { offset: '0%', 'stop-color': '#16305a' }, sea);
  el('stop', { offset: '100%', 'stop-color': '#070a18' }, sea);

  const dem = el('radialGradient', { id: 'demGrad', cx: '50%', cy: '35%', r: '70%' }, defs);
  el('stop', { offset: '0%', 'stop-color': '#4a4560' }, dem);
  el('stop', { offset: '100%', 'stop-color': '#08080e' }, dem);

  const glow = el('filter', { id: 'glow', x: '-60%', y: '-60%', width: '220%', height: '220%' }, defs);
  el('feGaussianBlur', { stdDeviation: '4', result: 'b' }, glow);
  const merge = el('feMerge', null, glow);
  el('feMergeNode', { in: 'b' }, merge);
  el('feMergeNode', { in: 'SourceGraphic' }, merge);

  const shadow = el('filter', { id: 'drop', x: '-50%', y: '-50%', width: '200%', height: '200%' }, defs);
  el('feDropShadow', { dx: '0', dy: '2', stdDeviation: '2', 'flood-color': '#000', 'flood-opacity': '0.55' }, shadow);

  // One hex-shaped clip, reused by every tile's artwork.
  const clip = el('clipPath', { id: 'hexClip' }, defs);
  el('polygon', { points: hexPoints(0, 0) }, clip);

  // Vertical gradient per terrain: light where the sky hits, dark at the base.
  Object.keys(TERRAIN_ART).forEach((key) => {
    const a = TERRAIN_ART[key];
    const grad = el('linearGradient', { id: 'terr-' + key, x1: '0', y1: '0', x2: '0', y2: '1' }, defs);
    el('stop', { offset: '0%', 'stop-color': a.top }, grad);
    el('stop', { offset: '100%', 'stop-color': a.bottom }, grad);
  });

  // Soft dark disc so number tokens stay legible over busy artwork.
  const tok = el('radialGradient', { id: 'tokenHalo' }, defs);
  el('stop', { offset: '0%', 'stop-color': '#000', 'stop-opacity': '0.5' }, tok);
  el('stop', { offset: '100%', 'stop-color': '#000', 'stop-opacity': '0' }, tok);
}

/* ------------------------------------------------------------------
   Terrain artwork. Each painter draws inside a hex centred on (0,0),
   spanning x ∈ [-52, 52] and y ∈ [-60, 60], and is clipped to the hex.
------------------------------------------------------------------ */

const TERRAIN_ART = {
  lake:       { top: '#20518c', bottom: '#0c1c3c' },
  lode:       { top: '#a8842a', bottom: '#4d3a0c' },
  forest:     { top: '#37764b', bottom: '#12301f' },
  quarry:     { top: '#8d4d2d', bottom: '#4a2615' },
  owlery:     { top: '#4e7aa8', bottom: '#20364d' },
  greenhouse: { top: '#9c8529', bottom: '#4c400f' },
  gringotts:  { top: '#8e8d98', bottom: '#4a4a55' },
  azkaban:    { top: '#32323f', bottom: '#0d0d15' },
};

function conifer(g, x, y, s, dark, light) {
  el('rect', { x: x - 1.7 * s, y: y - 3 * s, width: 3.4 * s, height: 8 * s, fill: '#2b1c10', opacity: 0.9 }, g);
  [0, 1, 2].forEach((i) => {
    const w = (12 - i * 2.4) * s;
    const top = y - (12 + i * 7.5) * s;
    const base = y - (1 + i * 7.5) * s;
    el('polygon', {
      points: [x + ',' + top, (x + w) + ',' + base, (x - w) + ',' + base].join(' '),
      fill: i === 2 ? light : dark, stroke: '#0c2416', 'stroke-width': 0.8,
    }, g);
  });
}

// A faceted rock: lit top-left, shaded right.
function boulder(g, x, y, r) {
  el('polygon', {
    points: [
      (x - r) + ',' + (y + r * 0.75), (x - r * 0.55) + ',' + (y - r * 0.9),
      (x + r * 0.35) + ',' + (y - r), (x + r) + ',' + (y + r * 0.2),
      (x + r * 0.6) + ',' + (y + r * 0.8),
    ].join(' '),
    fill: '#94512e', stroke: '#3a1d0f', 'stroke-width': 1.6, 'stroke-linejoin': 'round',
  }, g);
  el('polygon', {
    points: [
      (x - r) + ',' + (y + r * 0.75), (x - r * 0.55) + ',' + (y - r * 0.9),
      (x + r * 0.35) + ',' + (y - r), (x - r * 0.1) + ',' + (y + r * 0.3),
    ].join(' '),
    fill: '#b06a3f',
  }, g);
  el('polygon', {
    points: [
      (x + r * 0.35) + ',' + (y - r), (x + r) + ',' + (y + r * 0.2),
      (x + r * 0.6) + ',' + (y + r * 0.8), (x - r * 0.1) + ',' + (y + r * 0.3),
    ].join(' '),
    fill: '#6f3b21',
  }, g);
}

/* Artwork is composed as a ring around the middle, because the number token
   sits dead centre and would otherwise hide the focal detail. */

function paintForest(g) {
  el('ellipse', { cx: 0, cy: 30, rx: 62, ry: 26, fill: '#0f2a1a', opacity: 0.45 }, g);
  [[-40, 20, 1.0], [-42, -6, 0.88], [-24, -24, 0.82], [0, -32, 0.78], [24, -24, 0.82],
   [42, -6, 0.88], [40, 20, 1.0], [24, 42, 1.02], [-24, 42, 1.02], [0, 54, 0.92],
  ].forEach(([x, y, s]) => conifer(g, x, y, s, '#144026', '#1f5c37'));
  el('ellipse', { cx: 0, cy: 56, rx: 46, ry: 10, fill: '#0a2114', opacity: 0.5 }, g);
}

function paintQuarry(g) {
  el('path', { d: 'M -60 -6 L -28 -20 L 0 -10 L 26 -22 L 60 -8 L 60 60 L -60 60 Z', fill: '#6c3a22', opacity: 0.85 }, g);
  el('path', { d: 'M -60 14 L -30 2 L -2 12 L 28 0 L 60 12 L 60 60 L -60 60 Z', fill: '#7d4529', opacity: 0.9 }, g);
  el('path', { d: 'M -60 34 L -32 24 L 0 34 L 30 22 L 60 32 L 60 60 L -60 60 Z', fill: '#8d4f2e', opacity: 0.85 }, g);
  boulder(g, -34, -18, 15);
  boulder(g, 32, -22, 12);
  boulder(g, -32, 30, 13);
  boulder(g, 34, 28, 14);
  el('path', { d: 'M -6 46 l 12 -9 l 4 5 z', fill: '#c98f5f', opacity: 0.55 }, g);
}

function paintOwlery(g) {
  el('circle', { cx: 33, cy: -34, r: 10, fill: '#ffeab5', opacity: 0.92 }, g);
  el('circle', { cx: 28, cy: -37, r: 9, fill: '#4e7aa8' }, g);
  el('ellipse', { cx: 0, cy: 48, rx: 60, ry: 22, fill: '#1a2c40', opacity: 0.75 }, g);

  // main tower, set left of the token
  el('path', { d: 'M -40 44 L -37 -18 L -15 -18 L -12 44 Z', fill: '#22344a', stroke: '#131e2c', 'stroke-width': 2 }, g);
  el('polygon', { points: '-26,-42 -8,-18 -44,-18', fill: '#16222f' }, g);
  el('path', { d: 'M -37 -18 h 22 v -4 h -4 v -5 h -5 v 5 h -4 v -5 h -5 v 5 h -4 z', fill: '#2b4059' }, g);
  el('rect', { x: -30, y: 2, width: 8, height: 11, rx: 4, fill: '#ffd98a', opacity: 0.9 }, g);
  el('rect', { x: -30, y: 22, width: 8, height: 11, rx: 4, fill: '#ffd98a', opacity: 0.55 }, g);

  // lesser tower on the right
  el('path', { d: 'M 20 46 L 22 6 L 38 6 L 40 46 Z', fill: '#1c2c3f', stroke: '#131e2c', 'stroke-width': 1.6 }, g);
  el('polygon', { points: '30,-12 42,6 18,6', fill: '#131f2b' }, g);

  [[-50, 18, 1], [8, -30, -1], [46, 24, -1]].forEach(([x, y, d]) => {
    el('path', { d: 'M ' + x + ' ' + y + ' q ' + (5 * d) + ' -6 ' + (11 * d) + ' 0 q ' + (-5 * d) + ' -2 ' + (-11 * d) + ' 0 z', fill: '#0f1a26', opacity: 0.85 }, g);
  });
}

function glasshouse(g, x, y, s) {
  el('path', {
    d: 'M ' + (x - 19 * s) + ' ' + (y + 15 * s) + ' L ' + (x - 19 * s) + ' ' + (y - 2 * s) +
       ' Q ' + x + ' ' + (y - 24 * s) + ' ' + (x + 19 * s) + ' ' + (y - 2 * s) +
       ' L ' + (x + 19 * s) + ' ' + (y + 15 * s) + ' Z',
    fill: '#dcecca', opacity: 0.55, stroke: '#463c0c', 'stroke-width': 2,
  }, g);
  [[x, y + 15 * s, x, y - 20 * s], [x - 19 * s, y + 4 * s, x + 19 * s, y + 4 * s],
   [x - 12 * s, y + 15 * s, x - 12 * s, y - 12 * s], [x + 12 * s, y + 15 * s, x + 12 * s, y - 12 * s],
  ].forEach(([x1, y1, x2, y2]) => {
    el('line', { x1, y1, x2, y2, stroke: '#463c0c', 'stroke-width': 1.3, opacity: 0.75 }, g);
  });
  el('rect', { x: x - 21 * s, y: y + 15 * s, width: 42 * s, height: 4 * s, fill: '#3d340a' }, g);
}

function paintGreenhouse(g) {
  el('rect', { x: -62, y: 22, width: 124, height: 40, fill: '#6d5c13', opacity: 0.6 }, g);
  glasshouse(g, -31, 2, 0.95);
  glasshouse(g, 31, 2, 0.95);
  [34, 46].forEach((y, i) => {
    for (let x = -48 + (i % 2) * 9; x < 52; x += 17) {
      el('path', { d: 'M ' + x + ' ' + y + ' q -6 -9 0 -13 q 6 4 0 13 z', fill: '#8cb336', opacity: 0.9 }, g);
    }
  });
  [[-14, -34], [14, -34], [0, -44]].forEach(([x, y]) => {
    el('path', { d: 'M ' + x + ' ' + y + ' q -5 -8 0 -11 q 5 3 0 11 z', fill: '#7fa32e', opacity: 0.7 }, g);
  });
}

function paintGringotts(g) {
  el('rect', { x: -62, y: 24, width: 124, height: 38, fill: '#5c5c67' }, g);
  el('polygon', { points: '0,-46 40,-18 -40,-18', fill: '#b3b2bd', stroke: '#3b3b45', 'stroke-width': 2 }, g);
  el('polygon', { points: '0,-40 32,-20 -32,-20', fill: '#96959f', opacity: 0.55 }, g);
  el('rect', { x: -38, y: -18, width: 76, height: 7, fill: '#c6c5cf' }, g);
  [-31, -18, 18, 31].forEach((x) => {
    el('rect', { x: x - 5, y: -11, width: 10, height: 34, fill: '#bfbec9', stroke: '#484852', 'stroke-width': 1.2 }, g);
    el('rect', { x: x - 6.5, y: -13, width: 13, height: 3, fill: '#d2d1db' }, g);
  });
  el('rect', { x: -40, y: 23, width: 80, height: 5, fill: '#a09fab' }, g);
  el('rect', { x: -46, y: 28, width: 92, height: 5, fill: '#8b8a95' }, g);
  [[-42, 44, 7], [-30, 48, 6], [40, 46, 7], [28, 50, 5]].forEach(([x, y, r]) => {
    el('ellipse', { cx: x, cy: y, rx: r, ry: r * 0.42, fill: '#e6c85f', stroke: '#93761a', 'stroke-width': 1 }, g);
  });
}

function paintAzkaban(g) {
  el('rect', { x: -62, y: 16, width: 124, height: 46, fill: '#111124' }, g);
  [24, 34, 44, 54].forEach((y, i) => {
    el('path', {
      d: 'M -62 ' + y + ' q 14 -6 28 0 t 28 0 t 28 0 t 28 0',
      stroke: '#2b2b48', 'stroke-width': 2, fill: 'none', opacity: 0.75 - i * 0.14,
    }, g);
  });
  el('path', { d: 'M -46 20 L -42 -30 L -20 -30 L -16 20 Z', fill: '#07070d', stroke: '#2b2b3a', 'stroke-width': 1.5 }, g);
  el('path', { d: 'M -42 -30 h 22 v -5 h -5 v -5 h -5 v 5 h -3 v -5 h -4 v 5 h -5 z', fill: '#0c0c16' }, g);
  el('rect', { x: -35, y: -14, width: 8, height: 11, rx: 3, fill: '#3d4a63', opacity: 0.75 }, g);
  el('path', { d: 'M 22 22 L 26 -8 L 40 -8 L 44 22 Z', fill: '#06060b', stroke: '#26263a', 'stroke-width': 1.2 }, g);
  el('path', { d: 'M -60 18 q 20 -8 42 -2 q 24 6 46 -4 l 0 12 l -88 0 z', fill: '#0a0a16', opacity: 0.8 }, g);
}

function paintLake(g) {
  [-40, -22, -4, 14, 32, 50].forEach((y, i) => {
    el('path', {
      d: 'M -62 ' + y + ' q 13 -6 26 0 t 26 0 t 26 0 t 26 0',
      stroke: '#5f9adf', 'stroke-width': 2.2, fill: 'none', opacity: 0.18 + (i % 2) * 0.1,
    }, g);
  });
  el('ellipse', { cx: 16, cy: -30, rx: 13, ry: 5, fill: '#9fc9ff', opacity: 0.16 }, g);
  el('ellipse', { cx: -22, cy: 26, rx: 16, ry: 6, fill: '#9fc9ff', opacity: 0.12 }, g);
}

function paintLode(g) {
  el('path', { d: 'M -62 18 L -34 0 L -6 14 L 22 -4 L 62 12 L 62 60 L -62 60 Z', fill: '#6d5416' }, g);
  el('path', { d: 'M -62 34 L -30 20 L 0 32 L 30 18 L 62 30 L 62 60 L -62 60 Z', fill: '#7d621b' }, g);
  // mine mouth, timbered
  el('path', { d: 'M -46 40 L -46 6 L -18 6 L -18 40 Z', fill: '#3b2c0c' }, g);
  el('path', { d: 'M -42 40 L -42 12 Q -32 2 -22 12 L -22 40 Z', fill: '#171208' }, g);
  el('rect', { x: -49, y: 2, width: 34, height: 6, fill: '#5b4512' }, g);
  // spoil of gold
  [[8, 34, 9], [26, 42, 8], [-4, 46, 7], [40, 30, 7], [16, 22, 6]].forEach(([x, y, r]) => {
    el('ellipse', { cx: x, cy: y, rx: r, ry: r * 0.45, fill: '#f0d066', stroke: '#8a6c14', 'stroke-width': 1.2 }, g);
  });
  [[-30, -30], [4, -40], [34, -22]].forEach(([x, y]) => {
    el('path', { d: 'M ' + x + ' ' + y + ' l 4 -9 l 4 9 l -4 4 z', fill: '#ffe9a8', opacity: 0.75 }, g);
  });
}

const TERRAIN_PAINTERS = {
  forest: paintForest, quarry: paintQuarry, owlery: paintOwlery,
  greenhouse: paintGreenhouse, gringotts: paintGringotts, azkaban: paintAzkaban,
  lake: paintLake, lode: paintLode,
};

// Fit the viewBox to whatever the board actually occupies, ports included.
function boardExtent() {
  let maxX = 0, maxY = 0;
  state.board.hexes.forEach((h) => {
    maxX = Math.max(maxX, Math.abs(h.cx) + HEX_R);
    maxY = Math.max(maxY, Math.abs(h.cy) + HEX_R);
  });
  state.board.ports.forEach((p) => {
    maxX = Math.max(maxX, Math.abs(p.ox) + 28);
    maxY = Math.max(maxY, Math.abs(p.oy) + 28);
  });
  return { w: Math.ceil(maxX) + 14, h: Math.ceil(maxY) + 14 };
}

function renderBoard(svg, handlers) {
  svg.innerHTML = '';
  const ext = boardExtent();
  svg.setAttribute('viewBox', [-ext.w, -ext.h, ext.w * 2, ext.h * 2].join(' '));
  renderDefs(svg);

  // The frame is drawn inside the SVG rather than applied to the element, so it
  // always hugs the artwork however the element is letterboxed in its cell.
  el('rect', {
    x: -ext.w + 2, y: -ext.h + 2, width: ext.w * 2 - 4, height: ext.h * 2 - 4,
    rx: 18, fill: 'url(#seaGrad)', stroke: 'rgba(201,162,39,0.34)', 'stroke-width': 2,
  }, svg);

  const layers = {};
  // Ports go above the hexes: on the voyage map their markers sit out in the
  // water ring, where a sea tile would otherwise paint straight over them.
  ['hexes', 'ports', 'roads', 'buildings', 'hints', 'overlay'].forEach((n) => {
    layers[n] = el('g', { class: 'layer-' + n }, svg);
  });

  drawHexes(layers.hexes, handlers);
  drawPorts(layers.ports);
  drawRoads(layers.roads);
  drawBuildings(layers.buildings);
  drawHints(layers.hints, handlers);
}

function drawPorts(g) {
  state.board.ports.forEach((p) => {
    p.vertices.forEach((vk) => {
      const v = state.board.vertices[vk];
      el('line', {
        x1: p.ox, y1: p.oy, x2: v.x, y2: v.y,
        stroke: '#c9a227', 'stroke-width': 3, 'stroke-dasharray': '5 5', opacity: 0.6,
      }, g);
    });
    const grp = el('g', { class: 'port', transform: 'translate(' + p.ox.toFixed(1) + ',' + p.oy.toFixed(1) + ')' }, g);
    el('circle', { r: 24, fill: '#12172c', stroke: '#c9a227', 'stroke-width': 2.5, filter: 'url(#drop)' }, grp);
    const label = p.type === 'any' ? '3:1' : '2:1';
    if (p.type === 'any') {
      el('text', { y: 6, 'text-anchor': 'middle', class: 'port-any' }, grp).textContent = label;
    } else {
      el('text', { y: -2, 'text-anchor': 'middle', class: 'port-icon' }, grp).textContent = RESOURCES[p.type].icon;
      el('text', { y: 15, 'text-anchor': 'middle', class: 'port-ratio' }, grp).textContent = label;
    }
    const title = el('title', null, grp);
    title.textContent = portLabel(p.type);
  });
}

function drawHexes(g, handlers) {
  state.board.hexes.forEach((hex) => {
    const t = TERRAINS[hex.terrain];
    const pts = hexPoints(hex.cx, hex.cy);
    const grp = el('g', { class: 'hex', 'data-hex': hex.id }, g);

    // 1. graded ground
    el('polygon', { points: pts, fill: 'url(#terr-' + hex.terrain + ')' }, grp);

    // 2. terrain artwork, clipped to the tile
    const art = el('g', {
      transform: 'translate(' + hex.cx.toFixed(2) + ',' + hex.cy.toFixed(2) + ')',
      'clip-path': 'url(#hexClip)',
    }, grp);
    (TERRAIN_PAINTERS[hex.terrain] || (() => {}))(art);

    // 3. inner bevel and a crisp outer edge
    el('polygon', { points: pts, fill: 'none', stroke: '#ffffff', 'stroke-width': 2, opacity: 0.10 }, grp);
    el('polygon', { points: pts, fill: 'none', stroke: '#070a16', 'stroke-width': 3.5 }, grp);

    if (hex.number !== null) {
      const hot = hex.number === 6 || hex.number === 8;
      el('circle', { cx: hex.cx, cy: hex.cy, r: 32, fill: 'url(#tokenHalo)' }, grp);
      el('circle', { cx: hex.cx, cy: hex.cy, r: 20, fill: '#f3ead2', stroke: '#3a2f18', 'stroke-width': 2, filter: 'url(#drop)' }, grp);
      el('circle', { cx: hex.cx, cy: hex.cy, r: 16, fill: 'none', stroke: '#cbb98a', 'stroke-width': 1 }, grp);
      el('text', {
        x: hex.cx, y: hex.cy + 3, 'text-anchor': 'middle',
        class: 'hex-num' + (hot ? ' hot' : ''),
      }, grp).textContent = hex.number;
      el('text', {
        x: hex.cx, y: hex.cy + 14, 'text-anchor': 'middle',
        class: 'hex-pips' + (hot ? ' hot' : ''),
      }, grp).textContent = '•'.repeat(hex.pips);
    }

    // Ring the regions that just paid out, so a roll can be read off the board.
    const rolled = state.dice ? state.dice[0] + state.dice[1] : null;
    if (rolled !== null && hex.number === rolled && hex.id !== state.dementor) {
      el('polygon', {
        points: pts, fill: 'none', stroke: '#ffe082', 'stroke-width': 5,
        class: 'hex-produced', 'stroke-linejoin': 'round',
      }, grp);
    }

    const title = el('title', null, grp);
    title.textContent = t.name + (hex.number ? ' — rolls ' + hex.number : ' — yields nothing');

    if (state.willows && state.willows[hex.id] !== undefined) drawWillow(grp, hex);
    if (state.dementor === hex.id) drawDementor(grp, hex);

    if (handlers.hexClickable && handlers.hexClickable(hex.id)) {
      const chosen = handlers.chosen && handlers.chosen.type === 'hex' && handlers.chosen.key === hex.id;
      const waiting = handlers.chosen && !chosen;
      grp.classList.add('clickable');
      if (waiting) grp.classList.add('dimmed');
      el('polygon', {
        points: pts,
        fill: chosen ? '#ffe082' : '#8fe3ff', opacity: chosen ? 0.34 : 0.22,
        stroke: chosen ? '#ffe082' : '#8fe3ff', 'stroke-width': chosen ? 6 : 4,
        class: chosen ? 'hex-chosen' : 'hex-target',
      }, grp);
      grp.addEventListener('click', () => handlers.onHex(hex.id));
    }
  });
}

// A Whomping Willow stands to the right of the number token, ringed in its
// owner's colour, and keeps the Dementor out of the region for good. Clipped
// to the tile like the terrain artwork, so it never spills over an edge.
function drawWillow(g, hex) {
  const owner = state.players[state.willows[hex.id]];
  const grp = el('g', {
    class: 'willow',
    transform: 'translate(' + hex.cx + ',' + hex.cy + ')',
    'clip-path': 'url(#hexClip)',
  }, g);
  el('ellipse', { cx: 33, cy: 33, rx: 16, ry: 4.5, fill: '#000', opacity: 0.45 }, grp);
  el('path', { d: 'M 30 33 L 31.5 14 L 34.5 14 L 36 33 Z', fill: '#5a4020', stroke: '#0d1409', 'stroke-width': 1.4 }, grp);
  // a dark halo so the tree reads over forest as clearly as over stone
  el('circle', { cx: 33, cy: 8, r: 17, fill: '#050c07', opacity: 0.55 }, grp);
  el('circle', { cx: 33, cy: 8, r: 13, fill: '#2f8551', stroke: owner.color, 'stroke-width': 3 }, grp);
  el('path', {
    d: 'M 23 5 q -5 12 -2 21 M 29 1 q -3 14 -1 22 M 37 1 q 3 14 1 22 M 43 5 q 5 12 2 21',
    stroke: '#8fd6a5', 'stroke-width': 2, fill: 'none', 'stroke-linecap': 'round', opacity: 0.85,
  }, grp);
  el('title', null, grp).textContent =
    owner.name + '\u2019s Whomping Willow — the Dementor cannot settle in this region';
}

function drawDementor(g, hex) {
  const grp = el('g', { class: 'dementor', transform: 'translate(' + hex.cx + ',' + (hex.cy - 4) + ')' }, g);
  el('ellipse', { rx: 30, ry: 33, fill: 'url(#demGrad)', opacity: 0.9, filter: 'url(#glow)' }, grp);
  el('path', {
    d: 'M -17 16 Q -21 -16 0 -20 Q 21 -16 17 16 Q 0 24 -17 16 Z',
    fill: '#07070d', stroke: '#3c3752', 'stroke-width': 1.5,
  }, grp);
  el('path', { d: 'M -10 6 Q 0 -6 10 6 Q 0 0 -10 6 Z', fill: '#1b1826' }, grp);
  el('circle', { cx: -4.5, cy: 1, r: 1.8, fill: '#9fd8ff', opacity: 0.85 }, grp);
  el('circle', { cx: 4.5, cy: 1, r: 1.8, fill: '#9fd8ff', opacity: 0.85 }, grp);
  const title = el('title', null, grp);
  title.textContent = 'The Dementor blocks this region';
}

function roadGeom(e) {
  const dx = e.x2 - e.x1, dy = e.y2 - e.y1;
  const len = Math.hypot(dx, dy) || 1;
  const t = 12 / len;
  return {
    x1: e.x1 + dx * t, y1: e.y1 + dy * t,
    x2: e.x2 - dx * t, y2: e.y2 - dy * t,
  };
}

function drawRoads(g) {
  Object.keys(state.roads).forEach((ek) => {
    const e = state.board.edges[ek];
    const r = state.roads[ek];
    const owner = state.players[r.owner];
    const gm = roadGeom(e);
    el('line', { ...gm, stroke: '#080a14', 'stroke-width': 13, 'stroke-linecap': 'round' }, g);
    el('line', { ...gm, stroke: owner.color, 'stroke-width': 8.5, 'stroke-linecap': 'round' }, g);
    if (routeKind(r) === 'broom') {
      // a flight path: bright dashes with a bristled tail
      el('line', { ...gm, stroke: '#ffe9a8', 'stroke-width': 3, 'stroke-linecap': 'round',
        'stroke-dasharray': '7 6', opacity: 0.9 }, g);
      const mx = (gm.x1 + gm.x2) / 2, my = (gm.y1 + gm.y2) / 2;
      const ang = Math.atan2(gm.y2 - gm.y1, gm.x2 - gm.x1) * 180 / Math.PI;
      const b = el('g', { transform: 'translate(' + mx.toFixed(1) + ',' + my.toFixed(1) + ') rotate(' + ang.toFixed(1) + ')' }, g);
      el('path', { d: 'M -9 0 L 5 0', stroke: '#f3ead2', 'stroke-width': 2.4, 'stroke-linecap': 'round' }, b);
      el('path', { d: 'M 5 0 L 11 -4 M 5 0 L 12 0 M 5 0 L 11 4', stroke: '#f3ead2', 'stroke-width': 1.8, 'stroke-linecap': 'round' }, b);
    }
  });
}

function cottagePath() {
  return 'M -12 10 L -12 -2 L 0 -12 L 12 -2 L 12 10 Z';
}
function castlePath() {
  return 'M -15 12 L -15 -4 L -10 -4 L -10 -10 L -5 -10 L -5 -4 L 0 -4 L 0 -12 L 6 -12 L 6 -4 L 15 -4 L 15 12 Z';
}
// Taller, with a spire, so the third tier reads at a glance.
function citadelPath() {
  return 'M -17 13 L -17 -6 L -12 -6 L -12 -13 L -7 -13 L -7 -6 L -3 -6 L -3 -14 ' +
         'L 0 -24 L 3 -14 L 3 -6 L 8 -6 L 8 -13 L 13 -13 L 13 -6 L 17 -6 L 17 13 Z';
}
const BUILDING_PATHS = { cottage: cottagePath, castle: castlePath, citadel: citadelPath };

// The piece a confirmed tap would put down — a Shield Charm goes on a holding
// that is already there, so it keeps whatever shape it is warding.
function ghostKind() {
  if (state.phase === 'setup') return 'cottage';
  const kind = state.pending ? state.pending.kind : 'cottage';
  if (kind === 'ward') return 'castle';
  return kind;
}

function drawBuildings(g) {
  Object.keys(state.buildings).forEach((vk) => {
    const b = state.buildings[vk];
    const v = state.board.vertices[vk];
    const p = state.players[b.owner];
    const grp = el('g', { class: 'building', transform: 'translate(' + v.x + ',' + v.y + ')', filter: 'url(#drop)' }, g);

    // A Shield Charm shows as a glowing dome over the holding.
    if (b.ward) {
      el('path', {
        d: 'M -21 14 A 21 21 0 0 0 21 14 Z',   // sweep 0 so the dome arches over the holding
        fill: '#8fe3ff', opacity: 0.20, stroke: '#8fe3ff', 'stroke-width': 2, class: 'ward-dome',
      }, grp);
    }

    el('path', {
      d: (BUILDING_PATHS[b.type] || cottagePath)(),
      fill: p.color, stroke: '#080a14', 'stroke-width': 2.5, 'stroke-linejoin': 'round',
    }, grp);
    const title = el('title', null, grp);
    title.textContent = p.name + ' — ' + PIECE_NAMES[b.type] + (b.ward ? ' with a Shield Charm' : '');
  });
}

function drawHints(g, handlers) {
  const pick = handlers.chosen;
  const dim = (grp, isChosen) => { if (pick && !isChosen) grp.classList.add('dimmed'); };

  (handlers.vertexTargets || []).forEach((vk) => {
    const v = state.board.vertices[vk];
    const y = vertexYield(vk);
    // Grade the marker by how much the junction actually pays out, and print
    // the pip count, so a spot can be judged without counting dots by hand.
    const tone = y.pips >= 10 ? '#8ce99a' : y.pips >= 7 ? '#ffe082' : '#c9b89a';
    const chosen = !!pick && pick.type === 'vertex' && pick.key === vk;
    const grp = el('g', {
      class: 'hint vertex-hint' + (chosen ? ' chosen' : ''),
      transform: 'translate(' + v.x + ',' + v.y + ')',
    }, g);
    dim(grp, chosen);
    el('circle', { r: 26, fill: 'transparent' }, grp);   // generous touch target
    if (chosen) {
      // a ghost of the piece, so the spot can be judged before it is paid for
      el('circle', { r: 24, fill: '#ffe082', opacity: 0.22 }, grp);
      el('circle', { r: 24, fill: 'none', stroke: '#ffe082', 'stroke-width': 3 }, grp);
      el('path', {
        d: (BUILDING_PATHS[ghostKind()] || cottagePath)(),
        fill: currentPlayer().color, opacity: 0.85, stroke: '#080a14', 'stroke-width': 2.5,
        'stroke-linejoin': 'round',
      }, grp);
    } else {
      el('circle', { r: 17, fill: tone, opacity: 0.26 }, grp);
      el('circle', { r: 12, fill: tone, stroke: '#4a3c14', 'stroke-width': 1.6 }, grp);
      el('text', { y: 4, 'text-anchor': 'middle', class: 'hint-pips' }, grp).textContent = y.pips;
      if (y.port) el('circle', { cx: 11, cy: -11, r: 4.5, fill: '#12172c', stroke: '#c9a227', 'stroke-width': 1.5 }, grp);
    }
    el('title', null, grp).textContent = vertexYieldText(vk);
    grp.addEventListener('click', () => handlers.onVertex(vk));
  });

  (handlers.edgeTargets || []).forEach((ek) => {
    const e = state.board.edges[ek];
    const gm = roadGeom(e);
    const chosen = !!pick && pick.type === 'edge' && pick.key === ek;
    const grp = el('g', { class: 'hint edge-hint' + (chosen ? ' chosen' : '') }, g);
    dim(grp, chosen);
    el('line', { ...gm, stroke: 'transparent', 'stroke-width': 30, 'stroke-linecap': 'round' }, grp);
    if (chosen) {
      // the route as it would be laid, ringed so the choice is unmistakable
      el('line', { ...gm, stroke: '#ffe082', 'stroke-width': 20, 'stroke-linecap': 'round', opacity: 0.35 }, grp);
      el('line', { ...gm, stroke: '#080a14', 'stroke-width': 13, 'stroke-linecap': 'round' }, grp);
      el('line', { ...gm, stroke: currentPlayer().color, 'stroke-width': 8.5, 'stroke-linecap': 'round' }, grp);
    } else {
      el('line', { ...gm, stroke: '#ffe082', 'stroke-width': 16, 'stroke-linecap': 'round', opacity: 0.25 }, grp);
      el('line', { ...gm, stroke: '#ffe082', 'stroke-width': 6, 'stroke-linecap': 'round', 'stroke-dasharray': '9 6' }, grp);
    }
    grp.addEventListener('click', () => handlers.onEdge(ek));
  });
}
