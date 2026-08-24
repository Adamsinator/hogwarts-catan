'use strict';
/* ------------------------------------------------------------------
   UI: panels, modals, input handling and the turn scheduler.
------------------------------------------------------------------ */

const SAVE_KEY = 'hogsmeade.save.v3';

// How long AI opponents pause between actions, so their turns can be followed.
const PACE_PRESETS = {
  brisk:    { setup: 380, roll: 500,  action: 450, afterRoll: 750,  discard: 400, steal: 450 },
  normal:   { setup: 750, roll: 900,  action: 850, afterRoll: 1250, discard: 750, steal: 850 },
  relaxed:  { setup: 1200, roll: 1500, action: 1400, afterRoll: 2200, discard: 1200, steal: 1400 },
};
const PACE_KEY = 'hogsmeade.pace';
let PACE = PACE_PRESETS[localStorage.getItem(PACE_KEY)] || PACE_PRESETS.normal;

function setPace(name) {
  PACE = PACE_PRESETS[name] || PACE_PRESETS.normal;
  try { localStorage.setItem(PACE_KEY, name); } catch (e) { /* ignore */ }
}
const $ = (id) => document.getElementById(id);
let aiTimer = null;
let aiActions = 0;
let lastWasRoll = false;
// A tap on the board picks a spot; it is not built until it is confirmed. Kept
// out of `state` on purpose — it is a half-finished gesture, not part of the game.
let choice = null;

/* ================= modal plumbing ================= */
function modal(html, opts) {
  opts = opts || {};
  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.innerHTML = '<div class="modal" role="dialog" aria-modal="true">' + html + '</div>';
  $('modal-root').appendChild(overlay);
  const close = () => overlay.remove();
  if (opts.dismissible !== false) {
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  }
  return { overlay, root: overlay.querySelector('.modal'), close };
}

function closeAllModals() { $('modal-root').innerHTML = ''; }

function resChipHTML(k, n, extra) {
  return '<div class="res-chip ' + (n ? '' : 'zero') + (extra || '') + '">' +
    '<span class="ic">' + RESOURCES[k].icon + '</span>' +
    '<span class="n">' + n + '</span>' +
    '<span class="lbl">' + RESOURCES[k].label + '</span></div>';
}

function costText(cost) {
  return Object.keys(cost).map((k) => cost[k] + RESOURCES[k].icon).join(' ');
}

/* A row of +/- counters, one per resource — plus, where a trade allows it, a
   wildcard standing for "any card, your choice". Returns {node, values}. */
function makeSteppers(limits, onChange, opts) {
  const values = {};
  const wrap = document.createElement('div');
  wrap.className = 'row';
  const keys = (opts && opts.wildcard) ? RES_KEYS.concat(ANY_CARD) : RES_KEYS;
  keys.forEach((k) => {
    values[k] = 0;
    const max = limits[k] === undefined ? 99 : limits[k];
    const box = document.createElement('div');
    box.className = 'stepper' + (k === ANY_CARD ? ' wild' : '');
    if (k === ANY_CARD) box.title = 'Any card — whoever accepts picks which';
    box.innerHTML =
      '<span class="ic">' + (k === ANY_CARD ? '\u2753' : RESOURCES[k].icon) + '</span>' +
      '<button type="button" data-d="-1">−</button>' +
      '<span class="val">0</span>' +
      '<button type="button" data-d="1">+</button>' +
      (limits[k] === undefined ? '' : '<span class="cap">/' + max + '</span>');
    const val = box.querySelector('.val');
    box.querySelectorAll('button').forEach((b) => {
      b.addEventListener('click', () => {
        const d = Number(b.dataset.d);
        values[k] = Math.max(0, Math.min(max, values[k] + d));
        val.textContent = values[k];
        if (onChange) onChange(values);
      });
    });
    wrap.appendChild(box);
  });
  return { node: wrap, values };
}

function bundleTotal(v) {
  return RES_KEYS.reduce((s, k) => s + (v[k] || 0), 0) + (v[ANY_CARD] || 0);
}

/* How many cards someone holds is public; which cards they are is not. These
   draw the backs, for an opponent's hand and for a hot-seat game between
   turns. */
const MAX_BACKS = 14;

function cardBacksHTML(n) {
  if (!n) return '<span class="empty">No cards in hand.</span>';
  const shown = Math.min(n, MAX_BACKS);
  return '<div class="face-down">' +
    new Array(shown).fill('<span class="card-back"></span>').join('') +
    (n > shown ? '<span class="fd-more">+' + (n - shown) + '</span>' : '') +
    '</div>';
}

function scrollBacksHTML(n) {
  if (!n) return '<span class="empty">No scrolls held.</span>';
  return '<div class="face-down">' +
    new Array(Math.min(n, MAX_BACKS)).fill('<span class="scroll-back">\u{1F4DC}</span>').join('') +
    '</div>';
}

/* ================= rendering ================= */
function render() {
  if (!state) return;
  $('game').hidden = false;
  renderBoard($('board'), boardHandlers());
  renderSidebar();
  renderPlayers();
  renderLog();
  renderBanner();
}

function renderBanner() {
  const b = $('board-banner');
  const p = currentPlayer();

  if (choice) {
    const l = choiceLabel(choice);
    b.hidden = false;
    b.classList.add('confirm');
    // Sit on the far side of the board from the spot being considered, so the
    // bar never covers the thing it is asking about.
    b.classList.toggle('at-bottom', choiceY(choice) < 0);
    b.innerHTML = '<span class="ask">' + l.ask + '</span>' +
      (l.note ? '<span class="note">' + l.note + '</span>' : '') +
      '<span class="confirm-btns">' +
        '<button class="ghost" data-cancel>Cancel</button>' +
        '<button class="primary" data-go>' + l.go + '</button></span>';
    b.querySelector('[data-cancel]').addEventListener('click', cancelChoice);
    b.querySelector('[data-go]').addEventListener('click', commitChoice);
    return;
  }
  b.classList.remove('confirm');

  let msg = '';
  if (state.phase === 'over') msg = '';
  else if (p.isAI) msg = p.name + ' is thinking…';
  else if (state.phase === 'setup') msg = state.setupRoadFrom ? 'Choose a Floo Route from your new Cottage' : 'Choose a spot for your Cottage';
  else if (state.phase === 'moveDementor') msg = 'Click a region to banish the Dementor there';
  else if (state.pending && state.pending.kind === 'willow') msg = 'Choose a region for your Whomping Willow';
  else if (state.pending) msg = 'Choose where to place your ' + PIECE_NAMES[state.pending.kind] +
    (state.pending.free && state.pending.remaining > 1 ? ' (' + state.pending.remaining + ' left)' : '');
  else if (state.phase === 'roll' && state.extraRoll) msg = 'The hour repeats — roll once more';
  b.hidden = !msg;
  b.textContent = msg;
}

function renderSidebar() {
  const p = currentPlayer();
  // Private panels belong to whoever is holding the device — never to an AI,
  // and never to the last player once a hot-seat turn has been handed on.
  const holder = deviceHolder();
  const viewer = holder || p;
  const open = !!holder;                       // may cards be shown face up?
  const human = open && holder.id === p.id && state.phase !== 'over';

  $('turn-crest').textContent = p.crest;
  $('turn-name').textContent = p.name;
  // A rival's Order of Merlin stays secret, so their badge shows public points.
  $('turn-vp').textContent = victoryPoints(p.id, open && holder.id === p.id);
  const target = $('vp-target');
  if (target) target.textContent = state.vpTarget || VP_TO_WIN;

  const hints = {
    setup: state.setupRoadFrom ? 'Place a Floo Route' : 'Place a Cottage',
    roll: state.extraRoll ? 'The Time-Turner spins — roll again' : 'Roll to harvest',
    main: 'Build, trade, or end your turn',
    moveDementor: 'Banish the Dementor',
    steal: 'Choose a victim',
    discard: 'The Dementor demands cards',
    over: 'The House Cup is decided',
  };
  $('turn-hint').textContent = (p.isAI ? 'Thinking… ' : '') + (hints[state.phase] || '');

  const d1 = $('die1'), d2 = $('die2');
  d1.textContent = state.dice ? state.dice[0] : '·';
  d2.textContent = state.dice ? state.dice[1] : '·';

  $('btn-roll').disabled = !(human && state.phase === 'roll');
  $('spells').classList.toggle('closed', !open);
  $('btn-roll').title = 'Roll the dice  (R)';

  // hand — the holder's own, or the backs of whoever is playing
  $('hand').innerHTML = open
    ? RES_KEYS.map((k) => resChipHTML(k, viewer.res[k])).join('')
    : cardBacksHTML(totalCards(viewer));

  const limit = handLimit(viewer.id);
  const held = totalCards(viewer);
  const handHead = document.querySelector('#hand').previousElementSibling;
  if (handHead) {
    const title = open ? 'Your Hand' : viewer.name + '\u2019s Hand';
    handHead.innerHTML = title + ' <span class="hand-limit' + (held > limit ? ' over' : '') + '">' +
      held + ' / ' + limit + '</span>';
  }

  const posts = $('ports');
  posts.innerHTML = viewer.ports.length
    ? viewer.ports.map((t) => '<span class="post-badge" title="' + portLabel(t) + '">' +
        (t === 'any' ? '3:1' : RESOURCES[t].icon + ' 2:1') + '</span>').join('')
    : '<span class="empty">No trading posts — the bank charges you 4:1.</span>';

  // build buttons
  const canAct = human && state.phase === 'main' && !state.pending;
  const v = viewer;
  let defs = [
    { kind: 'road', label: 'Floo Route', cost: COSTS.road, spots: () => validRoadSpots(v.id).length, left: v.pieces.road },
  ];
  if (state.scenario === 'voyage') {
    defs.push({ kind: 'broom', label: 'Broomstick', cost: COSTS.broom,
      spots: () => validRoadSpots(v.id, null, 'broom').length, left: v.pieces.broom });
  }
  defs.push(...[
    { kind: 'cottage', label: 'Cottage', cost: COSTS.cottage, spots: () => validCottageSpots(v.id, false).length, left: v.pieces.cottage },
    { kind: 'castle', label: 'Castle', cost: COSTS.castle, spots: () => validCastleSpots(v.id).length, left: v.pieces.castle },
    { kind: 'citadel', label: 'Citadel', cost: COSTS.citadel, spots: () => validCitadelSpots(v.id).length, left: v.pieces.citadel },
    { kind: 'ward', label: 'Shield Charm', cost: COSTS.ward, spots: () => validWardSpots(v.id).length, left: v.pieces.ward },
    { kind: 'willow', label: 'Whomping Willow', cost: COSTS.willow, spots: () => validWillowHexes(v.id).length, left: v.pieces.willow },
  ]);
  const grid = $('build-actions');
  grid.innerHTML = '';
  defs.forEach((d) => {
    const btn = document.createElement('button');
    btn.className = 'build-btn' +
      (human && state.pending && state.pending.kind === d.kind ? ' active' : '');
    btn.innerHTML = '<span class="t">' + d.label + ' <small>(' + d.left + ')</small></span>' +
      '<span class="c">' + costText(d.cost) + '</span>';
    btn.disabled = !canAct || !canAfford(v, d.cost) || d.left <= 0 || d.spots() === 0;
    btn.addEventListener('click', () => { state.pending = { kind: d.kind, free: false }; render(); });
    grid.appendChild(btn);
  });

  const spellBtn = document.createElement('button');
  spellBtn.className = 'build-btn';
  spellBtn.innerHTML = '<span class="t">Spell Scroll <small>(' + state.spellDeck.length + ')</small></span>' +
    '<span class="c">' + costText(COSTS.spell) + '</span>';
  spellBtn.disabled = !canAct || !canAfford(v, COSTS.spell) || !state.spellDeck.length;
  spellBtn.addEventListener('click', () => { buySpell(v.id); render(); });
  grid.appendChild(spellBtn);

  if (state.pending && human) {
    const cancel = document.createElement('button');
    cancel.className = 'build-btn';
    cancel.innerHTML = '<span class="t">Cancel</span><span class="c">choose again later</span>';
    cancel.disabled = state.pending.free;
    cancel.addEventListener('click', () => { state.pending = null; render(); });
    grid.appendChild(cancel);
  }

  // spells in hand
  const sp = $('spells');
  sp.innerHTML = '';
  if (!open) {
    // Which scrolls a rival holds is their business — only the count shows.
    sp.innerHTML = scrollBacksHTML(viewer.spells.length + viewer.freshSpells.length + viewer.merlinTitles.length);
    return finishSidebar(human);
  }
  const playable = human && (state.phase === 'main' || state.phase === 'roll') && !viewer.playedSpellThisTurn && !state.pending;
  const all = viewer.spells.concat(viewer.freshSpells.map((c) => c + ':fresh'));
  if (!all.length && !viewer.merlinTitles.length) {
    sp.innerHTML = '<span class="empty">No scrolls yet. Buy one to learn a spell.</span>';
  }
  viewer.spells.forEach((card) => {
    const ready = playable && spellIsCastable(card, viewer.id);
    const b = document.createElement('button');
    b.className = 'spell-card' + (ready ? '' : ' locked');
    b.innerHTML = SPELLS[card].icon + ' ' + SPELLS[card].name;
    b.title = SPELLS[card].desc + (playable && !ready ? '\n\nNothing for it to do right now.' : '');
    b.disabled = !ready;
    b.addEventListener('click', () => castSpell(card));
    sp.appendChild(b);
  });
  viewer.freshSpells.forEach((card) => {
    const b = document.createElement('button');
    b.className = 'spell-card locked';
    b.innerHTML = SPELLS[card].icon + ' ' + SPELLS[card].name;
    b.title = 'Drawn this turn — playable from your next turn.';
    b.disabled = true;
    sp.appendChild(b);
  });
  viewer.merlinTitles.forEach((t) => {
    const b = document.createElement('button');
    b.className = 'spell-card locked';
    b.innerHTML = '🎖 ' + t;
    b.title = 'A secret victory point.';
    b.disabled = true;
    sp.appendChild(b);
  });

  finishSidebar(human);
}

function finishSidebar(human) {
  $('btn-bank').disabled = !(human && state.phase === 'main' && !state.pending);
  $('btn-offer').disabled = !(human && state.phase === 'main' && !state.pending && state.players.length > 1);
  $('btn-end').disabled = !(human && state.phase === 'main' && !state.pending);
}

function renderPlayers() {
  const wrap = $('players');
  wrap.innerHTML = '';
  state.players.forEach((p) => {
    const card = document.createElement('div');
    card.className = 'pcard' + (p.id === state.current ? ' active' : '');
    card.style.setProperty('--pc', p.color);
    const badges = [];
    if (state.longestRoad.owner === p.id) badges.push('Longest Floo Network +2');
    if (state.largestArmy.owner === p.id) badges.push("Dumbledore's Army +2");
    const roadLen = longestRoadFor(p.id);
    const scrolls = p.spells.length + p.freshSpells.length + p.merlinTitles.length;
    const plural = (n, one, many) => n + ' ' + (n === 1 ? one : (many || one + 's'));
    const stat = (icon, text, tip) =>
      '<span title="' + tip + '">' + icon + ' ' + text + '</span>';
    card.innerHTML =
      '<div class="top"><span class="crest">' + p.crest + '</span>' +
      '<span class="nm">' + p.name + '</span>' +
      (p.isAI ? '<span class="ai">' + AI_LEVELS[p.level].label + '</span>' : '') +
      '<span class="pvp" title="Victory points everyone can see — an Order of Merlin stays hidden">' +
        victoryPoints(p.id, false) + '<em>VP</em></span></div>' +
      '<div class="stats">' +
      stat('🃏', plural(totalCards(p), 'card'), 'Resource cards in hand') +
      stat('📜', plural(scrolls, 'scroll'), 'Spell Scrolls held, face down') +
      stat('🔮', plural(p.aurorsPlayed, 'Auror'),
        "Aurors played — three takes Dumbledore's Army and 2 points") +
      stat('🛤', roadLen + ' network',
        'Longest unbroken run of routes — five takes the Longest Floo Network and 2 points') +
      '</div>' +
      (badges.length ? '<div class="badges">' + badges.map((b) => '<span class="badge">' + b + '</span>').join('') + '</div>' : '');
    wrap.appendChild(card);
  });
}

function renderLog() {
  const l = $('log');
  l.innerHTML = state.log.map((e) => '<div class="' + e.cls + '">' + e.text + '</div>').join('');
}

/* ================= board interaction ================= */
function boardHandlers() {
  const h = {
    vertexTargets: [], edgeTargets: [],
    onVertex, onEdge, onHex,
    hexClickable: () => false,
    chosen: choice,
  };
  if (!state || state.phase === 'over') return h;
  const p = currentPlayer();
  if (p.isAI || state.deviceHolder !== p.id) return h;

  if (state.phase === 'setup') {
    if (!state.setupRoadFrom) h.vertexTargets = validCottageSpots(p.id, true);
    else h.edgeTargets = validRoadSpots(p.id, state.setupRoadFrom);
  } else if (state.phase === 'moveDementor') {
    h.hexClickable = (id) => canDementorEnter(id);
  } else if (state.pending) {
    if (state.pending.kind === 'willow') {
      const spots = validWillowHexes(p.id);
      h.hexClickable = (id) => spots.includes(id);
    }
    else if (state.pending.kind === 'road' || state.pending.kind === 'broom') {
      h.edgeTargets = validRoadSpots(p.id, null, state.pending.kind);
    }
    else if (state.pending.kind === 'cottage') h.vertexTargets = validCottageSpots(p.id, false);
    else if (state.pending.kind === 'castle') h.vertexTargets = validCastleSpots(p.id);
    else if (state.pending.kind === 'citadel') h.vertexTargets = validCitadelSpots(p.id);
    else if (state.pending.kind === 'ward') h.vertexTargets = validWardSpots(p.id);
  }
  return h;
}

function onVertex(vk) { choice = { type: 'vertex', key: vk }; render(); }
function onEdge(ek) { choice = { type: 'edge', key: ek }; render(); }
function onHex(hexId) {
  if (state.phase !== 'moveDementor' && !(state.pending && state.pending.kind === 'willow')) return;
  choice = { type: 'hex', key: hexId };
  render();
}

function cancelChoice() { choice = null; render(); }

function commitChoice() {
  if (!choice) return;
  const c = choice;
  choice = null;
  if (c.type === 'vertex') placeAtVertex(c.key);
  else if (c.type === 'edge') placeAtEdge(c.key);
  else placeAtHex(c.key);
}

// What the confirmation is actually asking, and what the button should say.
function choiceLabel(c) {
  const p = currentPlayer();
  if (c.type === 'hex') {
    const hex = state.board.hexes[c.key];
    const where = TERRAINS[hex.terrain].name + (hex.number ? ' (' + hex.number + ')' : '');
    return state.pending && state.pending.kind === 'willow'
      ? { ask: 'Plant your Whomping Willow on ' + where + '?', go: 'Plant' }
      : { ask: 'Banish the Dementor to ' + where + '?', go: 'Banish' };
  }
  if (c.type === 'edge') {
    const kind = state.phase === 'setup' ? 'road' : (state.pending ? state.pending.kind : 'road');
    return kind === 'broom'
      ? { ask: 'Fly a Broomstick Route here?', go: 'Fly' }
      : { ask: 'Lay a Floo Route here?', go: 'Lay' };
  }
  const kind = state.phase === 'setup' ? 'cottage' : (state.pending ? state.pending.kind : 'cottage');
  const yields = (kind === 'cottage') ? vertexYieldText(c.key).split('\n')[0] : '';
  if (kind === 'castle') return { ask: 'Upgrade this Cottage into a Castle?', go: 'Upgrade' };
  if (kind === 'citadel') return { ask: 'Raise this Castle into a Citadel?', go: 'Raise' };
  if (kind === 'ward') return { ask: 'Bind a Shield Charm to this holding?', go: 'Bind' };
  return { ask: 'Build your Cottage here?', go: 'Build', note: yields };
}

// Where on the board the choice sits, in board coordinates (0 is the middle).
function choiceY(c) {
  if (c.type === 'vertex') return state.board.vertices[c.key].y;
  if (c.type === 'hex') return state.board.hexes[c.key].cy;
  const e = state.board.edges[c.key];
  return (e.y1 + e.y2) / 2;
}

function placeAtVertex(vk) {
  const p = currentPlayer();
  if (state.phase === 'setup') {
    placeCottage(p.id, vk, true);
    if (state.setupIndex >= state.players.length) setupSecondRoundGift(vk);
    state.setupRoadFrom = vk;
  } else if (state.pending && state.pending.kind === 'cottage') {
    placeCottage(p.id, vk, false);
    state.pending = null;
    checkVictory();
  } else if (state.pending && state.pending.kind === 'castle') {
    placeCastle(p.id, vk);
    state.pending = null;
    checkVictory();
  } else if (state.pending && state.pending.kind === 'citadel') {
    placeCitadel(p.id, vk);
    state.pending = null;
    checkVictory();
  } else if (state.pending && state.pending.kind === 'ward') {
    placeWard(p.id, vk);
    state.pending = null;
  }
  tick();
}

function placeAtEdge(ek) {
  const p = currentPlayer();
  if (state.phase === 'setup') {
    placeRoad(p.id, ek, true);
    advanceSetup();
  } else if (state.pending && (state.pending.kind === 'road' || state.pending.kind === 'broom')) {
    const kind = state.pending.kind;
    placeRoad(p.id, ek, state.pending.free, kind);
    if (state.pending.free) {
      state.pending.remaining--;
      if (state.pending.remaining <= 0 || validRoadSpots(p.id, null, kind).length === 0) state.pending = null;
    } else {
      state.pending = null;
    }
    checkVictory();
  }
  tick();
}

function placeAtHex(hexId) {
  if (state.pending && state.pending.kind === 'willow') {
    plantWillow(state.current, hexId);
    state.pending = null;
    return tick();
  }
  if (state.phase !== 'moveDementor') return;
  moveDementor(hexId, state.current);
  tick();
}

/* ================= spells ================= */
function castSpell(card) {
  const p = currentPlayer();
  if (!spellIsCastable(card, p.id)) return;
  if (card === 'map') return promptMap(p);
  if (card === 'accio') return promptAccio(p);
  if (card === 'imperio') return promptImperio(p);
  if (card === 'floo') return promptFloo(p);
  playSpell(p.id, card, {});
  tick();
}

function promptFloo(p) {
  const kinds = flooKindsAvailable(p.id);
  if (!kinds.length) {
    alert('There is nowhere to lay a route right now — the scroll stays in your hand.');
    return;
  }
  if (kinds.length === 1) {
    playSpell(p.id, 'floo', { kind: kinds[0] });
    return tick();
  }
  const m = modal(
    '<h2>' + SPELLS.floo.icon + ' Floo Powder</h2>' +
    '<p class="sub">Two free routes. Over land, or over the water?</p>' +
    '<div class="row" id="floo-row"></div>' +
    '<div class="actions"><button class="ghost" data-x>Cancel</button></div>'
  );
  const row = m.root.querySelector('#floo-row');
  kinds.forEach((k) => {
    const b = document.createElement('button');
    b.className = 'pick';
    b.textContent = PIECE_NAMES[k] + 's';
    b.addEventListener('click', () => { m.close(); playSpell(p.id, 'floo', { kind: k }); tick(); });
    row.appendChild(b);
  });
  m.root.querySelector('[data-x]').addEventListener('click', m.close);
}

function promptMap(p) {
  const rivals = mapVictims(p.id);
  const m = modal(
    '<h2>' + SPELLS.map.icon + " The Marauder's Map</h2>" +
    '<p class="sub">I solemnly swear that I am up to no good. Every rival hand lies open — ' +
    'take the one card you want.</p>' +
    '<div class="setup-players" id="map-rows"></div>' +
    '<div class="actions"><button class="ghost" data-x>Cancel</button></div>'
  );
  const box = m.root.querySelector('#map-rows');
  rivals.forEach((o) => {
    const row = document.createElement('div');
    row.className = 'setup-row';
    row.innerHTML = '<span class="crest">' + o.crest + '</span>' +
      '<span class="hname">' + o.name + '</span>';
    const hand = document.createElement('span');
    hand.className = 'map-hand';
    RES_KEYS.forEach((k) => {
      if (o.res[k] <= 0) return;
      const b = document.createElement('button');
      b.className = 'pick';
      b.innerHTML = RESOURCES[k].icon + ' <strong>' + o.res[k] + '</strong>';
      b.title = 'Take 1 ' + RESOURCES[k].label + ' from ' + o.name;
      b.addEventListener('click', () => {
        m.close();
        playSpell(p.id, 'map', { target: o.id, res: k });
        tick();
      });
      hand.appendChild(b);
    });
    row.appendChild(hand);
    box.appendChild(row);
  });
  m.root.querySelector('[data-x]').addEventListener('click', m.close);
}

function promptAccio(p) {
  const m = modal(
    '<h2>' + SPELLS.accio.icon + ' Accio</h2>' +
    '<p class="sub">Summon any two resources from the supply.</p>' +
    '<div id="accio-picks" class="row"></div>' +
    '<div class="actions"><button class="ghost" data-x>Cancel</button>' +
    '<button class="primary" data-go disabled>Cast</button></div>'
  );
  const st = makeSteppers({}, update);
  m.root.querySelector('#accio-picks').replaceWith(st.node);
  const go = m.root.querySelector('[data-go]');
  function update(v) { go.disabled = bundleTotal(v) !== 2; }
  m.root.querySelector('[data-x]').addEventListener('click', m.close);
  go.addEventListener('click', () => {
    const picks = [];
    RES_KEYS.forEach((k) => { for (let i = 0; i < st.values[k]; i++) picks.push(k); });
    m.close();
    playSpell(p.id, 'accio', { a: picks[0], b: picks[1] });
    tick();
  });
}

function promptImperio(p) {
  const m = modal(
    '<h2>' + SPELLS.imperio.icon + ' Imperio</h2>' +
    '<p class="sub">Name a resource. Every other player must hand you all of theirs.</p>' +
    '<div class="row" id="imp-row"></div>' +
    '<div class="actions"><button class="ghost" data-x>Cancel</button></div>'
  );
  const row = m.root.querySelector('#imp-row');
  RES_KEYS.forEach((k) => {
    const b = document.createElement('button');
    b.className = 'pick';
    const held = state.players.reduce((s, o) => s + (o.id === p.id ? 0 : o.res[k]), 0);
    b.innerHTML = RESOURCES[k].icon + ' ' + RESOURCES[k].label;
    b.title = 'Opponents hold ' + held;
    b.addEventListener('click', () => { m.close(); playSpell(p.id, 'imperio', { res: k }); tick(); });
    row.appendChild(b);
  });
  m.root.querySelector('[data-x]').addEventListener('click', m.close);
}

/* ================= passing the device ================= */
// Around one iPad the incoming player's hand would otherwise appear while the
// outgoing player is still holding it. This curtain hides the table until the
// right pair of eyes is looking.
function showHandover(playerId) {
  const p = state.players[playerId];
  state.deviceHolder = null;   // turn the cards over before the curtain lifts
  render();
  const others = state.players.filter((o) => !o.isAI && o.id !== playerId).length;
  const m = modal(
    '<div class="curtain-crest">' + p.crest + '</div>' +
    '<h2 style="text-align:center">Pass the device to ' + p.name + '</h2>' +
    '<p class="sub" style="text-align:center">Their cards stay face down until they say they are holding it' +
      (others ? '.' : '.') + '</p>' +
    '<div class="actions" style="justify-content:center">' +
      '<button class="primary" data-go>I\u2019m ' + p.name + ' \u2014 I have it</button></div>' +
    '<p class="sub curtain-opt" style="text-align:center">' +
      '<button class="linkish" data-off>Playing openly? Stop asking this game</button></p>',
    { dismissible: false }
  );
  m.root.querySelector('[data-go]').addEventListener('click', () => {
    m.close();
    state.deviceHolder = playerId;
    tick();
  });
  m.root.querySelector('[data-off]').addEventListener('click', () => {
    m.close();
    state.handoverOff = true;
    state.deviceHolder = playerId;
    tick();
  });
}

/* ================= discard / steal ================= */
function showDiscardModal(playerId) {
  const p = state.players[playerId];
  const need = Math.floor(totalCards(p) / 2);
  const m = modal(
    '<h2>🗡 The Dementor Feeds</h2>' +
    '<p class="sub"><strong>' + p.name + '</strong> holds ' + totalCards(p) + ' cards against a limit of ' +
      handLimit(playerId) + ', and must discard <strong>' + need + '</strong>.</p>' +
    '<div id="dq"></div>' +
    '<div class="actions"><span id="dq-count" class="sub"></span>' +
    '<button class="primary" data-go disabled>Discard</button></div>',
    { dismissible: false }
  );
  const limits = {};
  RES_KEYS.forEach((k) => { limits[k] = p.res[k]; });
  const st = makeSteppers(limits, update);
  m.root.querySelector('#dq').replaceWith(st.node);
  const go = m.root.querySelector('[data-go]');
  const counter = m.root.querySelector('#dq-count');
  function update(v) {
    const t = bundleTotal(v);
    counter.textContent = t + ' / ' + need + ' selected';
    go.disabled = t !== need;
  }
  update(st.values);
  go.addEventListener('click', () => { m.close(); applyDiscard(playerId, st.values); tick(); });
}

function showStealModal() {
  const thief = currentPlayer();
  const m = modal(
    '<h2>🕯 Choose a Victim</h2>' +
    '<p class="sub">The Dementor’s chill lets you take one card.</p>' +
    '<div class="row" id="steal-row"></div>',
    { dismissible: false }
  );
  const row = m.root.querySelector('#steal-row');
  state.stealTargets.forEach((id) => {
    const v = state.players[id];
    const b = document.createElement('button');
    b.className = 'pick';
    b.innerHTML = v.crest + ' ' + v.name + ' <small style="color:var(--muted)">(' + totalCards(v) + ' cards)</small>';
    b.addEventListener('click', () => {
      m.close();
      stealFrom(id, thief.id);
      state.phase = state.returnPhase || 'main';
      tick();
    });
    row.appendChild(b);
  });
}

/* ================= trading ================= */
function showBankTrade() {
  const p = currentPlayer();
  let give = null, get = null;
  const m = modal(
    '<h2>⚖️ Trade with the Bank</h2>' +
    '<p class="sub">Your rate improves at a Trading Post. ' +
    (p.ports.length ? 'You hold: ' + p.ports.map(portLabel).join(', ') + '.' : 'You hold no posts yet.') + '</p>' +
    '<h3>Give</h3><div class="row" id="give-row"></div>' +
    '<h3>Receive</h3><div class="row" id="get-row"></div>' +
    '<div class="actions"><button class="ghost" data-x>Close</button>' +
    '<button class="primary" data-go disabled>Trade</button></div>'
  );
  const go = m.root.querySelector('[data-go]');
  const giveRow = m.root.querySelector('#give-row');
  const getRow = m.root.querySelector('#get-row');

  RES_KEYS.forEach((k) => {
    const rate = tradeRate(p, k);
    const b = document.createElement('button');
    b.className = 'pick';
    b.innerHTML = RESOURCES[k].icon + ' ' + rate + ' × <small style="color:var(--muted)">have ' + p.res[k] + '</small>';
    b.disabled = p.res[k] < rate;
    b.addEventListener('click', () => {
      give = k;
      giveRow.querySelectorAll('.pick').forEach((x) => x.classList.remove('sel'));
      b.classList.add('sel');
      refresh();
    });
    giveRow.appendChild(b);
  });
  RES_KEYS.forEach((k) => {
    const b = document.createElement('button');
    b.className = 'pick';
    b.innerHTML = RESOURCES[k].icon + ' 1 <small style="color:var(--muted)">bank ' + state.bank[k] + '</small>';
    b.disabled = state.bank[k] < 1;
    b.addEventListener('click', () => {
      get = k;
      getRow.querySelectorAll('.pick').forEach((x) => x.classList.remove('sel'));
      b.classList.add('sel');
      refresh();
    });
    getRow.appendChild(b);
  });
  function refresh() { go.disabled = !(give && get && give !== get); }

  m.root.querySelector('[data-x]').addEventListener('click', m.close);
  go.addEventListener('click', () => { bankTrade(p.id, give, get); m.close(); tick(); });
}

function showOfferTrade() {
  const p = currentPlayer();
  const limits = {};
  RES_KEYS.forEach((k) => { limits[k] = p.res[k]; });

  const m = modal(
    '<h2>🤝 Offer a Trade</h2>' +
    '<p class="sub">Propose a swap to the other houses. Ask for <strong>❓</strong> and you will ' +
    'take any card they care to give — say a Runestone for whatever they can spare.</p>' +
    '<h3>You give</h3><div id="t-give"></div>' +
    '<h3>You want</h3><div id="t-get"></div>' +
    '<div class="actions"><button class="ghost" data-x>Cancel</button>' +
    '<button class="primary" data-go disabled>Send Offer</button></div>'
  );
  const giveSt = makeSteppers(limits, update);
  const getSt = makeSteppers({}, update, { wildcard: true });
  m.root.querySelector('#t-give').replaceWith(giveSt.node);
  m.root.querySelector('#t-get').replaceWith(getSt.node);
  const go = m.root.querySelector('[data-go]');
  function update() {
    go.disabled = bundleTotal(giveSt.values) === 0 || bundleTotal(getSt.values) === 0;
  }
  m.root.querySelector('[data-x]').addEventListener('click', m.close);
  go.addEventListener('click', () => {
    m.close();
    showTradeResponses(p, { ...giveSt.values }, { ...getSt.values });
  });
}

function showTradeResponses(proposer, give, get) {
  const others = state.players.filter((o) => o.id !== proposer.id);
  const m = modal(
    '<h2>🤝 Responses</h2>' +
    '<p class="sub"><strong>' + proposer.name + '</strong> gives ' + bundleText(give) +
    ' for ' + bundleText(get) + '.</p><div id="resp"></div>' +
    '<div class="actions"><button class="ghost" data-x>Withdraw</button></div>',
    { dismissible: false }
  );
  const box = m.root.querySelector('#resp');

  others.forEach((o) => {
    const canPay = canPayBundle(o, get);
    const row = document.createElement('div');
    row.className = 'setup-row';
    const willing = o.isAI ? AI.evaluateTradeOffer(o.id, give, get) : false;
    row.innerHTML = '<span class="crest">' + o.crest + '</span><span class="hname">' + o.name + '</span>';
    // With a wildcard the answer is not just yes or no — it is what they hand over.
    const wildPay = canPay && bundleWild(get) ? fillWildcard(o.id, get) : null;

    const status = document.createElement('span');
    status.style.fontSize = '12.5px';
    status.style.color = 'var(--muted)';

    const btn = document.createElement('button');
    btn.className = 'primary';
    btn.textContent = 'Accept';

    if (!canPay) {
      status.textContent = 'cannot pay';
      row.appendChild(status);
    } else if (o.isAI) {
      status.textContent = willing
        ? (wildPay ? 'offers ' + bundleText(wildPay) : 'accepts')
        : 'declines';
      row.appendChild(status);
      if (willing) {
        btn.textContent = 'Trade';
        btn.addEventListener('click', () => {
          m.close();
          executePlayerTrade(proposer.id, o.id, give, wildPay || get);
          tick();
        });
        row.appendChild(btn);
      }
    } else {
      btn.textContent = 'Accept (pass device)';
      btn.addEventListener('click', () => {
        m.close();
        if (bundleWild(get)) return chooseWildcard(proposer, o, give, get);
        executePlayerTrade(proposer.id, o.id, give, get);
        tick();
      });
      row.appendChild(btn);
    }
    box.appendChild(row);
  });

  m.root.querySelector('[data-x]').addEventListener('click', m.close);
}

// Accepting an offer that asks for "any card" means choosing which.
function chooseWildcard(proposer, payer, give, get) {
  const wild = bundleWild(get);
  const fixed = {};
  RES_KEYS.forEach((k) => { fixed[k] = get[k] || 0; });
  const m = modal(
    '<h2>❓ Your Choice</h2>' +
    '<p class="sub"><strong>' + payer.name + '</strong> receives ' + bundleText(give) +
      ' and owes <strong>' + wild + '</strong> card' + (wild === 1 ? '' : 's') +
      ' of their choosing' + (bundleTotal(fixed) ? ', on top of ' + bundleText(fixed) : '') + '.</p>' +
    '<div id="wild-picks"></div>' +
    '<div class="actions"><span id="wild-count" class="sub"></span>' +
    '<button class="ghost" data-x>Cancel</button>' +
    '<button class="primary" data-go disabled>Hand Over</button></div>',
    { dismissible: false }
  );
  const limits = {};
  RES_KEYS.forEach((k) => { limits[k] = Math.max(0, payer.res[k] - fixed[k]); });
  const st = makeSteppers(limits, update);
  m.root.querySelector('#wild-picks').replaceWith(st.node);
  const go = m.root.querySelector('[data-go]');
  const counter = m.root.querySelector('#wild-count');
  function update(v) {
    const t = bundleTotal(v);
    counter.textContent = t + ' / ' + wild + ' chosen';
    go.disabled = t !== wild;
  }
  update(st.values);
  m.root.querySelector('[data-x]').addEventListener('click', () => { m.close(); tick(); });
  go.addEventListener('click', () => {
    const paid = {};
    RES_KEYS.forEach((k) => { paid[k] = fixed[k] + st.values[k]; });
    m.close();
    executePlayerTrade(proposer.id, payer.id, give, paid);
    tick();
  });
}

/* ================= an AI puts a trade to the table ================= */
function resolveOffer(accepted) {
  const o = state.offer;
  state.offer = null;
  if (!o) return tick();
  const to = state.players[o.toId];
  if (accepted && canPayBundle(to, o.get)) {
    executePlayerTrade(o.from, o.toId, o.give, o.get);
  } else {
    logMsg(to.name + ' turns down ' + state.players[o.from].name + "'s offer.");
  }
  tick();
}

function showGoldChoice(claim) {
  const p = state.players[claim.player];
  const m = modal(
    '<h2>\u{1FA99} The Goblin Lode</h2>' +
    '<p class="sub"><strong>' + p.name + '</strong> may take <strong>' + claim.count + '</strong> ' +
      (claim.count === 1 ? 'card' : 'cards') + ' of any kind from the supply.</p>' +
    '<div id="gold-picks"></div>' +
    '<div class="actions"><span id="gold-count" class="sub"></span>' +
    '<button class="primary" data-go disabled>Take</button></div>',
    { dismissible: false }
  );
  const limits = {};
  RES_KEYS.forEach((k) => { limits[k] = Math.min(claim.count, state.bank[k]); });
  const st = makeSteppers(limits, update);
  m.root.querySelector('#gold-picks').replaceWith(st.node);
  const go = m.root.querySelector('[data-go]');
  const counter = m.root.querySelector('#gold-count');
  const most = Math.min(claim.count, RES_KEYS.reduce((s2, k) => s2 + state.bank[k], 0));
  function update(v) {
    const t = bundleTotal(v);
    counter.textContent = t + ' / ' + most + ' chosen';
    go.disabled = t !== most;
  }
  update(st.values);
  go.addEventListener('click', () => { m.close(); takeGold(claim.player, st.values); tick(); });
}

function showIncomingOffer() {
  const o = state.offer;
  const from = state.players[o.from];
  const to = state.players[o.toId];
  const affordable = canPayBundle(to, o.get);
  const m = modal(
    '<h2>' + from.crest + ' ' + from.name + ' proposes a trade</h2>' +
    '<p class="sub">To <strong>' + to.name + '</strong>.</p>' +
    '<div class="offer-box">' +
      '<div class="offer-side"><span class="offer-lbl">You receive</span>' +
        '<span class="offer-amt">' + bundleText(o.give) + '</span></div>' +
      '<span class="offer-arrow">⇄</span>' +
      '<div class="offer-side"><span class="offer-lbl">You give</span>' +
        '<span class="offer-amt">' + bundleText(o.get) + '</span></div>' +
    '</div>' +
    (affordable ? '' : '<p class="sub" style="color:#ff9f9f">You cannot cover this.</p>') +
    '<div class="actions"><button class="ghost" data-no>Decline</button>' +
    '<button class="primary" data-yes' + (affordable ? '' : ' disabled') + '>Accept</button></div>',
    { dismissible: false }
  );
  m.root.querySelector('[data-no]').addEventListener('click', () => { m.close(); resolveOffer(false); });
  m.root.querySelector('[data-yes]').addEventListener('click', () => { m.close(); resolveOffer(true); });
}

/* ================= scheduler ================= */
function tick() {
  if (aiTimer) { clearTimeout(aiTimer); aiTimer = null; }
  choice = null;
  render();
  save();

  if (state.phase === 'over') { showVictory(); return; }

  if (state.goldQueue && state.goldQueue.length) {
    const claim = state.goldQueue[0];
    if (ensureDevice(claim.player)) return showHandover(claim.player);
    if (state.players[claim.player].isAI) {
      aiTimer = setTimeout(() => {
        takeGold(claim.player, AI.chooseGold(claim.player, claim.count));
        tick();
      }, PACE.action);
    } else {
      showGoldChoice(claim);
    }
    return;
  }

  if (state.offer) {
    const to = state.players[state.offer.toId];
    if (ensureDevice(to.id)) return showHandover(to.id);
    if (to.isAI) {
      aiTimer = setTimeout(() => {
        resolveOffer(AI.evaluateTradeOffer(to.id, state.offer.give, state.offer.get));
      }, PACE.action);
    } else {
      showIncomingOffer();
    }
    return;
  }

  if (state.phase === 'discard') {
    const id = state.discardQueue[0];
    if (ensureDevice(id)) return showHandover(id);
    if (state.players[id].isAI) {
      aiTimer = setTimeout(() => { autoDiscard(id); tick(); }, PACE.discard);
    } else {
      showDiscardModal(id);
    }
    return;
  }

  if (state.phase === 'steal') {
    const p = currentPlayer();
    if (p.isAI) {
      aiTimer = setTimeout(() => {
        stealFrom(AI.richestTarget(state.stealTargets), p.id);
        state.phase = state.returnPhase || 'main';
        tick();
      }, PACE.steal);
    } else {
      showStealModal();
    }
    return;
  }

  if (!currentPlayer().isAI && ensureDevice(state.current)) {
    return showHandover(state.current);
  }

  if (currentPlayer().isAI) {
    let delay = state.phase === 'setup' ? PACE.setup : PACE.action;
    if (state.phase === 'roll') delay = PACE.roll;
    // linger after a harvest so the log can be read before the next action
    if (state.phase === 'main' && state.dice && !state.pending) delay = Math.max(delay, lastWasRoll ? PACE.afterRoll : PACE.action);
    aiTimer = setTimeout(aiStep, delay);
  }
}

function aiStep() {
  const p = currentPlayer();
  if (!p.isAI || state.phase === 'over') return tick();

  if (state.phase === 'setup') {
    if (!state.setupRoadFrom) {
      const vk = AI.bestSetupVertex(p.id);
      placeCottage(p.id, vk, true);
      if (state.setupIndex >= state.players.length) setupSecondRoundGift(vk);
      state.setupRoadFrom = vk;
    } else {
      const ek = AI.bestSetupRoad(p.id, state.setupRoadFrom);
      if (ek) placeRoad(p.id, ek, true);
      advanceSetup();
    }
    aiActions = 0;
    return tick();
  }

  if (state.phase === 'roll') {
    aiActions = 0;
    const sp = AI.considerSpell(p);
    if (sp && sp.card === 'auror') { playSpell(p.id, 'auror', sp.opts); return tick(); }
    rollDice();
    lastWasRoll = true;
    return tick();
  }

  if (state.phase === 'moveDementor') {
    moveDementor(AI.bestDementorHex(p.id), p.id);
    return tick();
  }

  if (state.phase === 'main') {
    const wasRoll = lastWasRoll;
    lastWasRoll = false;
    if (wasRoll) return tick();   // one beat to read the harvest
    if (aiActions++ > 24) { endTurn(); return tick(); }

    if (state.pending && state.pending.kind === 'road') {
      const ek = AI.bestRoadSpot(p.id);
      if (ek) {
        placeRoad(p.id, ek, true);
        state.pending.remaining--;
        if (state.pending.remaining <= 0) state.pending = null;
      } else {
        state.pending = null;
      }
      if (checkVictory()) return tick();
      return tick();
    }

    const sp = AI.considerSpell(p);
    if (sp) { playSpell(p.id, sp.card, sp.opts); if (checkVictory()) return tick(); return tick(); }

    if (!p.offeredThisTurn) {
      const offer = AI.proposeTrade(p);
      p.offeredThisTurn = true;
      if (offer) {
        state.offer = { from: p.id, toId: offer.toId, give: offer.give, get: offer.get };
        logMsg(p.name + ' offers ' + bundleText(offer.give) + ' for ' + bundleText(offer.get) + '.');
        return tick();
      }
    }

    const move = AI.nextBuild(p);
    if (move) {
      if (move.type === 'citadel') placeCitadel(p.id, move.target);
      else if (move.type === 'ward') placeWard(p.id, move.target);
      else if (move.type === 'willow') plantWillow(p.id, move.target);
      else if (move.type === 'castle') placeCastle(p.id, move.target);
      else if (move.type === 'cottage') placeCottage(p.id, move.target, false);
      else if (move.type === 'road' || move.type === 'broom') placeRoad(p.id, move.target, false, move.type);
      else if (move.type === 'spell') buySpell(p.id);
      if (checkVictory()) return tick();
      return tick();
    }

    endTurn();
    return tick();
  }

  return tick();
}

/* ================= victory ================= */
function showVictory() {
  closeAllModals();
  const career = recordResult();
  const w = state.players[state.winner];
  const rows = state.players
    .map((p) => ({ p, vp: victoryPoints(p.id, true) }))
    .sort((a, b) => b.vp - a.vp)
    .map((r) => '<div class="setup-row"><span class="crest">' + r.p.crest + '</span>' +
      '<span class="hname">' + r.p.name + '</span><strong style="color:var(--gold-soft)">' + r.vp + '</strong></div>')
    .join('');
  const m = modal(
    '<div class="win-crest">' + w.crest + '</div>' +
    '<h2 style="text-align:center">' + w.name + ' wins the House Cup!</h2>' +
    '<p class="sub" style="text-align:center">Final standings</p>' +
    '<div class="setup-players">' + rows + '</div>' +
    '<p class="sub" style="text-align:center;margin-top:14px">' +
      career.games + ' game' + (career.games === 1 ? '' : 's') + ' played · ' +
      'quickest win ' + career.fastestWin + ' rounds · best score ' + career.bestVP +
    '</p>' +
    '<div class="actions"><button class="ghost" data-again>Rematch on this board</button>' +
    '<button class="primary" data-new>New Game</button></div>',
    { dismissible: false }
  );
  const configs = state.configs, seed = state.seed, mode = state.scenario;
  m.root.querySelector('[data-new]').addEventListener('click', () => { m.close(); showSetup(); });
  m.root.querySelector('[data-again]').addEventListener('click', () => {
    m.close();
    createGame(configs, seed, mode);
    tick();
  });
  localStorage.removeItem(SAVE_KEY);
}

/* ================= career record ================= */
const CAREER_KEY = 'hogsmeade.career.v1';

function loadCareer() {
  try {
    const c = JSON.parse(localStorage.getItem(CAREER_KEY));
    if (c && c.houses) return c;
  } catch (e) { /* fall through */ }
  return { houses: {}, games: 0, fastestWin: null, bestVP: 0 };
}

function saveCareer(c) {
  try { localStorage.setItem(CAREER_KEY, JSON.stringify(c)); } catch (e) { /* ignore */ }
}

function recordResult() {
  const c = loadCareer();
  c.games++;
  state.players.forEach((p) => {
    const h = c.houses[p.house] || { played: 0, won: 0 };
    h.played++;
    if (p.id === state.winner) h.won++;
    c.houses[p.house] = h;
  });
  const vp = victoryPoints(state.winner, true);
  if (vp > c.bestVP) c.bestVP = vp;
  const turns = Math.ceil(state.turnCount / state.players.length);
  if (c.fastestWin === null || turns < c.fastestWin) c.fastestWin = turns;
  saveCareer(c);
  return c;
}

function careerLine(houseKey) {
  const h = loadCareer().houses[houseKey];
  if (!h || !h.played) return '';
  return h.won + 'W / ' + h.played;
}

/* ================= statistics ================= */
function showStats() {
  const rolls = state.stats.rolls;
  const totalRolls = Object.keys(rolls).reduce((s2, k) => s2 + rolls[k], 0);
  const peak = Math.max(1, ...Object.keys(rolls).map((k) => rolls[k]));
  const ways = { 2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 7: 6, 8: 5, 9: 4, 10: 3, 11: 2, 12: 1 };

  const bars = Object.keys(rolls).map((n) => {
    const count = rolls[n];
    const expected = totalRolls * ways[n] / 36;
    const hot = n === '6' || n === '8';
    return '<div class="stat-row">' +
      '<span class="stat-n' + (hot ? ' hot' : '') + '">' + n + '</span>' +
      '<span class="stat-track">' +
        '<span class="stat-bar" style="width:' + (count / peak * 100) + '%"></span>' +
        '<span class="stat-exp" style="left:' + (expected / peak * 100) + '%" title="Expected ' + expected.toFixed(1) + '"></span>' +
      '</span>' +
      '<span class="stat-c">' + count + '</span></div>';
  }).join('');

  const rows = state.players.map((p) => {
    const roadLen = longestRoadFor(p.id);
    return '<div class="setup-row"><span class="crest">' + p.crest + '</span>' +
      '<span class="hname">' + p.name + '</span>' +
      '<span class="stat-mini">' + state.stats.harvested[p.id] + ' harvested</span>' +
      '<span class="stat-mini">' + roadLen + ' route' + (roadLen === 1 ? '' : 's') + '</span>' +
      '<span class="stat-mini">' + p.aurorsPlayed + ' Aurors</span></div>';
  }).join('');

  const m = modal(
    '<h2>📊 The Tally</h2>' +
    '<p class="sub">' + totalRolls + ' roll' + (totalRolls === 1 ? '' : 's') + ' so far, ' +
      state.stats.sevens + ' of them sevens. The notch on each bar marks the expected count.</p>' +
    '<div class="stat-chart">' + bars + '</div>' +
    '<h3>Houses</h3><div class="setup-players">' + rows + '</div>' +
    '<h3>Career</h3>' + careerBlock() +
    '<div class="actions"><button class="ghost" data-reset>Clear Record</button>' +
    '<button class="primary" data-x>Close</button></div>'
  );
  m.root.querySelector('[data-x]').addEventListener('click', m.close);
  m.root.querySelector('[data-reset]').addEventListener('click', () => {
    if (!confirm('Erase the career record for every house?')) return;
    localStorage.removeItem(CAREER_KEY);
    m.close();
    showStats();
  });
}

function careerBlock() {
  const c = loadCareer();
  if (!c.games) return '<p class="sub">No games finished yet — the record starts with your first House Cup.</p>';
  const rows = HOUSES.filter((h) => c.houses[h.key] && c.houses[h.key].played).map((h) => {
    const r = c.houses[h.key];
    const pct = Math.round(r.won / r.played * 100);
    return '<div class="setup-row"><span class="crest">' + h.crest + '</span>' +
      '<span class="hname">' + h.name + '</span>' +
      '<span class="stat-mini">' + r.won + ' of ' + r.played + '</span>' +
      '<span class="stat-mini">' + pct + '%</span></div>';
  }).join('');
  return '<p class="sub">' + c.games + ' game' + (c.games === 1 ? '' : 's') + ' finished · ' +
    'quickest win ' + c.fastestWin + ' rounds · best score ' + c.bestVP + '</p>' +
    '<div class="setup-players">' + rows + '</div>';
}

/* ================= full screen ================= */
// Safari on iPad has the Fullscreen API (prefixed); Safari on iPhone does not,
// and there the honest answer is Add to Home Screen, which runs the game with
// no browser chrome at all.
function fullscreenAvailable() {
  const el = document.documentElement;
  return !!(el.requestFullscreen || el.webkitRequestFullscreen);
}

// Installed to a home screen — as opposed to merely filling the screen from
// inside the browser, where the button must stay put so there is a way back.
function isInstalled() {
  if (window.navigator.standalone === true) return true;
  if (fullscreenOn()) return false;
  return ['standalone', 'minimal-ui', 'fullscreen'].some((m) =>
    window.matchMedia('(display-mode: ' + m + ')').matches);
}

function fullscreenOn() {
  return !!(document.fullscreenElement || document.webkitFullscreenElement);
}

function toggleFullscreen() {
  if (!fullscreenAvailable()) return showInstallTip();
  if (fullscreenOn()) {
    const exit = document.exitFullscreen || document.webkitExitFullscreen;
    exit.call(document);
    return;
  }
  const el = document.documentElement;
  const req = el.requestFullscreen || el.webkitRequestFullscreen;
  const done = req.call(el, { navigationUI: 'hide' });
  // Safari rejects the promise rather than throwing when it will not play along
  if (done && done.catch) done.catch(showInstallTip);
}

function syncFullscreen() {
  const b = $('btn-full');
  if (!b) return;
  const installed = isInstalled();
  b.hidden = installed;                       // already as full as it gets
  document.documentElement.classList.toggle('app-frame', installed || fullscreenOn());
  b.textContent = fullscreenOn() ? '\u21F2 Exit Full Screen' : '\u26F6 Full Screen';
  b.setAttribute('aria-pressed', fullscreenOn() ? 'true' : 'false');
}

function showInstallTip() {
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  modal(
    '<h2>\u26F6 Playing full screen</h2>' +
    '<p class="sub">This browser will not hand a web page the whole screen on its own — ' +
    'but it will run the game as an app.</p>' +
    (ios
      ? '<ol class="rules-body"><li>Tap the <strong>Share</strong> button in the browser bar.</li>' +
        '<li>Choose <strong>Add to Home Screen</strong>.</li>' +
        '<li>Open Hogsmeade from the home screen — no address bar, no tabs, the whole display.</li></ol>'
      : '<ol class="rules-body"><li>Open your browser\u2019s menu.</li>' +
        '<li>Choose <strong>Install</strong> or <strong>Add to Home Screen</strong>.</li>' +
        '<li>Launch it from there and it runs in its own window.</li></ol>') +
    '<p class="sub">Your games and career record carry over — they live in this browser either way.</p>' +
    '<div class="actions"><button class="primary" data-x>Got it</button></div>'
  ).root.querySelector('[data-x]').addEventListener('click', closeAllModals);
}

/* ================= new game / rules ================= */
function showSetup() {
  if (aiTimer) clearTimeout(aiTimer);
  const rows = HOUSES.map((h, i) => {
    const def = i === 0 ? 'human' : (i < 3 ? 'ai:medium' : 'off');
    const opt = (v, label) => '<option value="' + v + '"' + (def === v ? ' selected' : '') + '>' + label + '</option>';
    return '<div class="setup-row" data-house="' + h.key + '">' +
      '<span class="who">' +
        '<span class="crest">' + h.crest + '</span>' +
        '<span class="hname">' + h.name +
          (careerLine(h.key) ? ' <span class="career">' + careerLine(h.key) + '</span>' : '') + '</span>' +
      '</span>' +
      '<span class="controls">' +
      '<input type="text" value="' + h.name + '" maxlength="14" aria-label="Name">' +
      '<select aria-label="Player type">' +
      opt('human', 'Human') +
      opt('ai:easy', 'AI — Easy') +
      opt('ai:medium', 'AI — Medium') +
      opt('ai:hard', 'AI — Hard') +
      opt('off', 'Not playing') +
      '</select></span></div>';
  }).join('');

  const m = modal(
    '<h2>⚡ Settlers of Hogsmeade</h2>' +
    '<p class="sub">Choose a map and your houses. Two to four may play.</p>' +
    '<div class="scenario-pick">' +
      '<button class="pick sel" data-map="classic">' +
        '<span><strong>Hogsmeade Valley</strong><small>The classic board. First to ' + VP_TO_WIN + '.</small></span></button>' +
      '<button class="pick" data-map="voyage">' +
        '<span><strong>Broomstick Voyage</strong><small>Islands across the Black Lake, with Goblin Lodes. First to ' + VOYAGE_VP + '.</small></span></button>' +
    '</div>' +
    '<div class="setup-players">' + rows + '</div>' +
    '<div class="actions">' +
    (isInstalled() ? '' : '<button class="ghost" data-full>\u26F6 Full Screen</button>') +
    '<button class="ghost" data-rules>Rules</button>' +
    '<button class="primary" data-start>Begin the Term</button></div>',
    { dismissible: false }
  );

  const fullBtn = m.root.querySelector('[data-full]');
  if (fullBtn) fullBtn.addEventListener('click', () => {
    toggleFullscreen();
    setTimeout(() => { fullBtn.textContent = fullscreenOn() ? '\u21F2 Exit Full Screen' : '\u26F6 Full Screen'; }, 120);
  });

  let scenario = 'classic';
  m.root.querySelectorAll('[data-map]').forEach((b) => {
    b.addEventListener('click', () => {
      scenario = b.dataset.map;
      m.root.querySelectorAll('[data-map]').forEach((x) => x.classList.toggle('sel', x === b));
    });
  });

  m.root.querySelector('[data-rules]').addEventListener('click', showRules);
  m.root.querySelector('[data-start]').addEventListener('click', () => {
    const cfgs = [...m.root.querySelectorAll('.setup-row')].map((row) => ({
      house: row.dataset.house,
      name: row.querySelector('input').value.trim() || row.dataset.house,
      type: row.querySelector('select').value,
    })).filter((c) => c.type !== 'off');

    if (cfgs.length < 2) { alert('At least two houses must play.'); return; }
    m.close();
    createGame(cfgs.map((c) => ({
      house: c.house,
      name: c.name,
      isAI: c.type.startsWith('ai'),
      level: c.type.split(':')[1] || 'medium',
    })), null, scenario);
    tick();
  });
}

function showRules() {
  const rules = modal(
    '<h2>📖 The Rules of Hogsmeade</h2>' +
    '<div class="rules-body">' +
    '<p>Wizarding families are settling the valley around Hogsmeade. Claim the best land, keep the Floo network open, and reach <strong>' + VP_TO_WIN + ' victory points</strong> first.</p>' +
    '<h3>Setup</h3><ul>' +
    '<li>In turn order each house places a <strong>Cottage</strong> and a <strong>Floo Route</strong>, then the order reverses and everyone places a second pair.</li>' +
    '<li>The second Cottage immediately harvests one resource from each neighbouring region.</li>' +
    '<li>Cottages must never be adjacent to another building — always leave one junction between them.</li>' +
    '</ul>' +
    '<h3>Your Turn</h3><ul>' +
    '<li><strong>Roll</strong> two dice. Every region showing that number yields to the buildings touching it — 1 card per Cottage, 2 per Castle.</li>' +
    '<li>Then build, trade, and cast spells in any order.</li>' +
    '</ul>' +
    '<h3>Costs</h3><ul>' +
    '<li><strong>Floo Route</strong> — ' + costText(COSTS.road) + '</li>' +
    '<li><strong>Cottage</strong> — ' + costText(COSTS.cottage) + ' (1 point, 1 card per harvest)</li>' +
    '<li><strong>Castle</strong> — ' + costText(COSTS.castle) + ' (upgrades a Cottage: 2 points, 2 cards)</li>' +
    '<li><strong>Citadel</strong> — ' + costText(COSTS.citadel) + ' (upgrades a Castle: 3 points, 3 cards)</li>' +
    '<li><strong>Shield Charm</strong> — ' + costText(COSTS.ward) + ' (warded holding, see below)</li>' +
    '<li><strong>Whomping Willow</strong> — ' + costText(COSTS.willow) + ' (a region the Dementor cannot enter)</li>' +
    '<li><strong>Spell Scroll</strong> — ' + costText(COSTS.spell) + '</li>' +
    '</ul>' +
    '<h3>The Dementor</h3><ul>' +
    '<li>Roll a <strong>7</strong> and anyone over their hand limit feeds half their cards to the Dementor. The limit is <strong>7</strong> unless you have warded your holdings.</li>' +
    '<li>The roller then banishes the Dementor to a new region and steals a card from someone there. That region yields nothing until the Dementor moves on.</li>' +
    '<li>It will not enter a region guarded by a Whomping Willow.</li>' +
    '</ul>' +
    '<h3>The Whomping Willow</h3><ul>' +
    '<li>Plant one for ' + costText(COSTS.willow) + ' on any producing region one of your buildings touches. ' +
      'Each house has <strong>one</strong>, and it stands for the rest of the game.</li>' +
    '<li>The Dementor can never be banished into that region again — by you or by anyone else.</li>' +
    '<li>Plant it on the region the Dementor is <em>already</em> sitting on and the tree beats it straight back to Azkaban.</li>' +
    '<li>It scores no points and yields no cards. What it buys is a harvest nobody can interrupt.</li>' +
    '</ul>' +
    '<h3>Broomstick Voyage</h3><ul>' +
    '<li>The second map sets the valley in the middle of the Black Lake, with three islands beyond the water.</li>' +
    '<li><strong>Broomstick Route</strong> — ' + costText(COSTS.broom) + '. Flies over water where a Floo Route cannot go. A shoreline may take either.</li>' +
    '<li>A flight can only launch from <em>your own</em> coastal Cottage, Castle or Citadel, and a Floo Route and a Broomstick Route only join at one of your buildings.</li>' +
    '<li>Opening Cottages are placed on the mainland — the islands must be flown to.</li>' +
    '<li>The first house to settle each island scores an extra <strong>' + ISLAND_BONUS_VP + ' point</strong>.</li>' +
    '<li>The <strong>Goblin Lode</strong> is a gold mine: when its number rolls it pays nothing in particular, and you take <em>any</em> resources you like from the supply — one per Cottage, two per Castle, three per Citadel.</li>' +
    '<li>Both routes count together toward the Longest Floo Network.</li>' +
    '</ul>' +
    '<h3>Shield Charms</h3><ul>' +
    '<li>Bind a Shield Charm to a Castle or Citadel for ' + costText(COSTS.ward) + '. Each raises your hand limit by <strong>2</strong>, so a seven costs you nothing until you are over it.</li>' +
    '<li>Three may be bound in all, taking the limit to <strong>13</strong>. A ward stays put when the Castle beneath it becomes a Citadel.</li>' +
    '<li>Your current holding and limit sit beside <em>Your Hand</em>.</li>' +
    '</ul>' +
    '<h3>Spell Scrolls</h3><ul>' +
    Object.keys(SPELLS).map((k) => '<li><strong>' + SPELLS[k].icon + ' ' + SPELLS[k].name + '</strong> — ' + SPELLS[k].desc + '</li>').join('') +
    '<li>A scroll drawn this turn may not be cast until your next turn, and only one may be cast per turn.</li>' +
    '</ul>' +
    '<h3>Trading</h3><ul>' +
    '<li>With the bank at <code>4:1</code>, or <code>3:1</code> / <code>2:1</code> at a Trading Post your Cottage touches. The posts you hold are listed beneath your hand.</li>' +
    '<li>Or offer a swap to the other houses — and they will put offers to you in turn.</li>' +
    '<li>An offer may ask for <strong>❓</strong> — any card the accepting house cares to give. Handy when you only want to shift a spare.</li>' +
    '</ul>' +
    '<h3>Reading the Board</h3><ul>' +
    '<li>When you place, every legal junction shows what it pays per roll out of 36. Green marks a strong spot, gold a fair one. Hover for the exact regions.</li>' +
    '<li>Nothing is built by a single tap: choosing a spot shows what would stand there and what it would pay, and waits for you to confirm it.</li>' +
    '<li>After a roll, the regions that paid out are ringed in gold.</li>' +
    '<li><strong>Stats</strong> keeps a tally of every roll against what probability expects.</li>' +
    '</ul>' +
    '<h3>Shortcuts</h3><ul>' +
    '<li><code>R</code> roll · <code>E</code> end turn · <code>T</code> bank trade · <code>O</code> offer a trade · <code>S</code> stats</li>' +
    '<li><code>1</code>–<code>8</code> pick a thing to build · <code>Enter</code> confirm a placement · <code>F</code> full screen · <code>Esc</code> cancel or close</li>' +
    '</ul>' +
    '<h3>Titles</h3><ul>' +
    '<li><strong>Longest Floo Network</strong> — 5+ connected routes, +2 points. An opponent’s building breaks the chain.</li>' +
    '<li><strong>Dumbledore’s Army</strong> — 3+ Aurors cast, +2 points.</li>' +
    '</ul>' +
    '</div>' +
    '<div class="actions"><button class="primary" data-x>Close</button></div>'
  );
  // Close only this panel — the setup dialog may well be open underneath it.
  rules.root.querySelector('[data-x]').addEventListener('click', rules.close);
}

/* ================= persistence ================= */
function save() {
  try {
    if (state && state.phase !== 'over') localStorage.setItem(SAVE_KEY, JSON.stringify(state));
  } catch (e) { /* storage full or blocked — play on */ }
}

function loadSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (!s || !s.board || !s.players) return null;
    s.offer = null;   // an offer in flight cannot be resumed meaningfully
    // Who is holding the device cannot be known across a reload — a lone human
    // always is, a table is asked again.
    const humans = s.players.filter((pl) => !pl.isAI);
    s.deviceHolder = humans.length === 1 ? humans[0].id : null;
    if (s.handoverOff === undefined) s.handoverOff = false;
    return s;
  } catch (e) { return null; }
}

function offerResume(saved) {
  const m = modal(
    '<h2>🕰 An Unfinished Term</h2>' +
    '<p class="sub">A game is in progress: ' + saved.players.map((p) => p.name).join(', ') + '.</p>' +
    '<div class="actions"><button class="ghost" data-new>Start Fresh</button>' +
    '<button class="primary" data-resume>Resume</button></div>',
    { dismissible: false }
  );
  m.root.querySelector('[data-resume]').addEventListener('click', () => {
    m.close();
    state = saved;
    tick();
  });
  m.root.querySelector('[data-new]').addEventListener('click', () => { m.close(); showSetup(); });
}

/* ================= boot ================= */
document.addEventListener('DOMContentLoaded', () => {
  $('btn-roll').addEventListener('click', () => {
    const d1 = $('die1'), d2 = $('die2');
    d1.classList.add('rolling'); d2.classList.add('rolling');
    $('btn-roll').disabled = true;
    setTimeout(() => {
      d1.classList.remove('rolling'); d2.classList.remove('rolling');
      rollDice();
      tick();
    }, 550);
  });
  $('btn-end').addEventListener('click', () => { endTurn(); tick(); });
  $('btn-bank').addEventListener('click', showBankTrade);
  $('btn-offer').addEventListener('click', showOfferTrade);
  $('btn-rules').addEventListener('click', showRules);
  $('btn-full').addEventListener('click', toggleFullscreen);
  ['fullscreenchange', 'webkitfullscreenchange', 'resize'].forEach((e) =>
    window.addEventListener(e, syncFullscreen));
  syncFullscreen();

  const paceSel = $('pace');
  paceSel.value = localStorage.getItem(PACE_KEY) || 'normal';
  paceSel.addEventListener('change', () => setPace(paceSel.value));
  $('btn-new').addEventListener('click', () => {
    if (state && state.phase !== 'over' && !confirm('Abandon the current game?')) return;
    closeAllModals();
    showSetup();
  });

  $('btn-stats').addEventListener('click', () => { if (state) showStats(); });

  document.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'select' || tag === 'textarea') return;

    if (e.key === 'Escape') {
      const dismissible = [...document.querySelectorAll('.overlay')].pop();
      if (dismissible) { dismissible.remove(); return; }
      if (choice) { cancelChoice(); return; }
      if (state && state.pending && !state.pending.free) { state.pending = null; render(); }
      return;
    }
    if ((e.key === 'Enter' || e.key === ' ') && choice && !document.querySelector('.overlay')) {
      e.preventDefault();
      commitChoice();
      return;
    }
    // Full screen is about the window, not the game, so it works anywhere.
    if (e.key.toLowerCase() === 'f') { toggleFullscreen(); return; }
    if (!state || document.querySelector('.overlay')) return;

    const press = (id) => { const b = $(id); if (b && !b.disabled) b.click(); };
    const key = e.key.toLowerCase();
    if (key === 'r') press('btn-roll');
    else if (key === 'e') press('btn-end');
    else if (key === 't') press('btn-bank');
    else if (key === 'o') press('btn-offer');
    else if (key === 's') press('btn-stats');
    else if ('12345678'.includes(key)) {
      const btn = document.querySelectorAll('.build-btn')[Number(key) - 1];
      if (btn && !btn.disabled) btn.click();
    }
  });

  const saved = loadSave();
  if (saved) offerResume(saved);
  else showSetup();
});
