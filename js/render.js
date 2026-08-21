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
}

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

  el('rect', { x: -ext.w, y: -ext.h, width: ext.w * 2, height: ext.h * 2, fill: 'url(#seaGrad)' }, svg);

  const layers = {};
  ['ports', 'hexes', 'roads', 'buildings', 'hints', 'overlay'].forEach((n) => {
    layers[n] = el('g', { class: 'layer-' + n }, svg);
  });

  drawPorts(layers.ports);
  drawHexes(layers.hexes, handlers);
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
    const grp = el('g', { class: 'hex', 'data-hex': hex.id }, g);
    el('polygon', {
      points: hexPoints(hex.cx, hex.cy),
      fill: t.fill, stroke: '#0b0e1c', 'stroke-width': 3,
    }, grp);
    el('polygon', {
      points: hexPoints(hex.cx, hex.cy),
      fill: 'none', stroke: '#ffffff', 'stroke-width': 1, opacity: 0.08,
    }, grp);

    el('text', {
      x: hex.cx, y: hex.cy - 22, 'text-anchor': 'middle', class: 'hex-glyph',
    }, grp).textContent = t.glyph;

    if (hex.number !== null) {
      const hot = hex.number === 6 || hex.number === 8;
      el('circle', { cx: hex.cx, cy: hex.cy + 16, r: 19, fill: '#f0e6cd', stroke: '#3a2f18', 'stroke-width': 2, filter: 'url(#drop)' }, grp);
      el('text', {
        x: hex.cx, y: hex.cy + 20, 'text-anchor': 'middle',
        class: 'hex-num' + (hot ? ' hot' : ''),
      }, grp).textContent = hex.number;
      const pipStr = '•'.repeat(hex.pips);
      el('text', { x: hex.cx, y: hex.cy + 31, 'text-anchor': 'middle', class: 'hex-pips' + (hot ? ' hot' : '') }, grp).textContent = pipStr;
    }

    const title = el('title', null, grp);
    title.textContent = t.name + (hex.number ? ' — rolls ' + hex.number : ' — yields nothing');

    if (state.dementor === hex.id) drawDementor(grp, hex);

    if (handlers.hexClickable && handlers.hexClickable(hex.id)) {
      grp.classList.add('clickable');
      el('polygon', {
        points: hexPoints(hex.cx, hex.cy),
        fill: '#8fe3ff', opacity: 0.22, stroke: '#8fe3ff', 'stroke-width': 4, class: 'hex-target',
      }, grp);
      grp.addEventListener('click', () => handlers.onHex(hex.id));
    }
  });
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
    const owner = state.players[state.roads[ek].owner];
    const gm = roadGeom(e);
    el('line', { ...gm, stroke: '#080a14', 'stroke-width': 13, 'stroke-linecap': 'round' }, g);
    el('line', { ...gm, stroke: owner.color, 'stroke-width': 8.5, 'stroke-linecap': 'round' }, g);
  });
}

function cottagePath() {
  return 'M -12 10 L -12 -2 L 0 -12 L 12 -2 L 12 10 Z';
}
function castlePath() {
  return 'M -15 12 L -15 -4 L -10 -4 L -10 -10 L -5 -10 L -5 -4 L 0 -4 L 0 -12 L 6 -12 L 6 -4 L 15 -4 L 15 12 Z';
}

function drawBuildings(g) {
  Object.keys(state.buildings).forEach((vk) => {
    const b = state.buildings[vk];
    const v = state.board.vertices[vk];
    const p = state.players[b.owner];
    const grp = el('g', { class: 'building', transform: 'translate(' + v.x + ',' + v.y + ')', filter: 'url(#drop)' }, g);
    el('path', {
      d: b.type === 'castle' ? castlePath() : cottagePath(),
      fill: p.color, stroke: '#080a14', 'stroke-width': 2.5, 'stroke-linejoin': 'round',
    }, grp);
    const title = el('title', null, grp);
    title.textContent = p.name + ' — ' + PIECE_NAMES[b.type];
  });
}

function drawHints(g, handlers) {
  (handlers.vertexTargets || []).forEach((vk) => {
    const v = state.board.vertices[vk];
    const grp = el('g', { class: 'hint vertex-hint', transform: 'translate(' + v.x + ',' + v.y + ')' }, g);
    el('circle', { r: 26, fill: 'transparent' }, grp);   // generous touch target
    el('circle', { r: 15, fill: '#ffe082', opacity: 0.28 }, grp);
    el('circle', { r: 9, fill: '#ffe082', stroke: '#8a6d1f', 'stroke-width': 2 }, grp);
    grp.addEventListener('click', () => handlers.onVertex(vk));
  });

  (handlers.edgeTargets || []).forEach((ek) => {
    const e = state.board.edges[ek];
    const gm = roadGeom(e);
    const grp = el('g', { class: 'hint edge-hint' }, g);
    el('line', { ...gm, stroke: 'transparent', 'stroke-width': 30, 'stroke-linecap': 'round' }, grp);
    el('line', { ...gm, stroke: '#ffe082', 'stroke-width': 16, 'stroke-linecap': 'round', opacity: 0.25 }, grp);
    el('line', { ...gm, stroke: '#ffe082', 'stroke-width': 6, 'stroke-linecap': 'round', 'stroke-dasharray': '9 6' }, grp);
    grp.addEventListener('click', () => handlers.onEdge(ek));
  });
}
