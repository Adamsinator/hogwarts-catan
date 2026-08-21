'use strict';
/* ------------------------------------------------------------------
   UI: panels, modals, input handling and the turn scheduler.
------------------------------------------------------------------ */

const SAVE_KEY = 'hogsmeade.save.v2';

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

/* A row of +/- counters, one per resource. Returns {node, values}. */
function makeSteppers(limits, onChange) {
  const values = {};
  const wrap = document.createElement('div');
  wrap.className = 'row';
  RES_KEYS.forEach((k) => {
    values[k] = 0;
    const max = limits[k] === undefined ? 99 : limits[k];
    const box = document.createElement('div');
    box.className = 'stepper';
    box.innerHTML =
      '<span class="ic">' + RESOURCES[k].icon + '</span>' +
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

function bundleTotal(v) { return RES_KEYS.reduce((s, k) => s + v[k], 0); }

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
  let msg = '';
  if (state.phase === 'over') msg = '';
  else if (p.isAI) msg = p.name + ' is thinking…';
  else if (state.phase === 'setup') msg = state.setupRoadFrom ? 'Choose a Floo Route from your new Cottage' : 'Choose a spot for your Cottage';
  else if (state.phase === 'moveDementor') msg = 'Click a region to banish the Dementor there';
  else if (state.pending) msg = 'Choose where to place your ' + PIECE_NAMES[state.pending.kind] +
    (state.pending.free && state.pending.remaining > 1 ? ' (' + state.pending.remaining + ' left)' : '');
  b.hidden = !msg;
  b.textContent = msg;
}

function renderSidebar() {
  const p = currentPlayer();
  const human = !p.isAI && state.phase !== 'over';

  $('turn-crest').textContent = p.crest;
  $('turn-name').textContent = p.name;
  $('turn-vp').textContent = victoryPoints(p.id, true);
  const target = $('vp-target');
  if (target) target.textContent = state.vpTarget || VP_TO_WIN;

  const hints = {
    setup: state.setupRoadFrom ? 'Place a Floo Route' : 'Place a Cottage',
    roll: 'Roll to harvest',
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
  $('btn-roll').title = 'Roll the dice  (R)';

  // hand
  $('hand').innerHTML = RES_KEYS.map((k) => resChipHTML(k, p.res[k])).join('');

  const limit = handLimit(p.id);
  const held = totalCards(p);
  const handHead = document.querySelector('#hand').previousElementSibling;
  if (handHead) {
    handHead.innerHTML = 'Your Hand <span class="hand-limit' + (held > limit ? ' over' : '') + '">' +
      held + ' / ' + limit + '</span>';
  }

  const posts = $('ports');
  posts.innerHTML = p.ports.length
    ? p.ports.map((t) => '<span class="post-badge" title="' + portLabel(t) + '">' +
        (t === 'any' ? '3:1' : RESOURCES[t].icon + ' 2:1') + '</span>').join('')
    : '<span class="empty">No trading posts — the bank charges you 4:1.</span>';

  // build buttons
  const canAct = human && state.phase === 'main' && !state.pending;
  let defs = [
    { kind: 'road', label: 'Floo Route', cost: COSTS.road, spots: () => validRoadSpots(p.id).length, left: p.pieces.road },
  ];
  if (state.scenario === 'voyage') {
    defs.push({ kind: 'broom', label: 'Broomstick', cost: COSTS.broom,
      spots: () => validRoadSpots(p.id, null, 'broom').length, left: p.pieces.broom });
  }
  defs.push(...[
    { kind: 'cottage', label: 'Cottage', cost: COSTS.cottage, spots: () => validCottageSpots(p.id, false).length, left: p.pieces.cottage },
    { kind: 'castle', label: 'Castle', cost: COSTS.castle, spots: () => validCastleSpots(p.id).length, left: p.pieces.castle },
    { kind: 'citadel', label: 'Citadel', cost: COSTS.citadel, spots: () => validCitadelSpots(p.id).length, left: p.pieces.citadel },
    { kind: 'ward', label: 'Shield Charm', cost: COSTS.ward, spots: () => validWardSpots(p.id).length, left: p.pieces.ward },
  ]);
  const grid = $('build-actions');
  grid.innerHTML = '';
  defs.forEach((d) => {
    const btn = document.createElement('button');
    btn.className = 'build-btn' + (state.pending && state.pending.kind === d.kind ? ' active' : '');
    btn.innerHTML = '<span class="t">' + d.label + ' <small>(' + d.left + ')</small></span>' +
      '<span class="c">' + costText(d.cost) + '</span>';
    btn.disabled = !canAct || !canAfford(p, d.cost) || d.left <= 0 || d.spots() === 0;
    btn.addEventListener('click', () => { state.pending = { kind: d.kind, free: false }; render(); });
    grid.appendChild(btn);
  });

  const spellBtn = document.createElement('button');
  spellBtn.className = 'build-btn';
  spellBtn.innerHTML = '<span class="t">Spell Scroll <small>(' + state.spellDeck.length + ')</small></span>' +
    '<span class="c">' + costText(COSTS.spell) + '</span>';
  spellBtn.disabled = !canAct || !canAfford(p, COSTS.spell) || !state.spellDeck.length;
  spellBtn.addEventListener('click', () => { buySpell(p.id); render(); });
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
  const playable = human && (state.phase === 'main' || state.phase === 'roll') && !p.playedSpellThisTurn && !state.pending;
  const all = p.spells.concat(p.freshSpells.map((c) => c + ':fresh'));
  if (!all.length && !p.merlinTitles.length) {
    sp.innerHTML = '<span class="empty">No scrolls yet. Buy one to learn a spell.</span>';
  }
  p.spells.forEach((card) => {
    const b = document.createElement('button');
    b.className = 'spell-card' + (playable ? '' : ' locked');
    b.innerHTML = SPELLS[card].icon + ' ' + SPELLS[card].name;
    b.title = SPELLS[card].desc;
    b.disabled = !playable;
    b.addEventListener('click', () => castSpell(card));
    sp.appendChild(b);
  });
  p.freshSpells.forEach((card) => {
    const b = document.createElement('button');
    b.className = 'spell-card locked';
    b.innerHTML = SPELLS[card].icon + ' ' + SPELLS[card].name;
    b.title = 'Drawn this turn — playable from your next turn.';
    b.disabled = true;
    sp.appendChild(b);
  });
  p.merlinTitles.forEach((t) => {
    const b = document.createElement('button');
    b.className = 'spell-card locked';
    b.innerHTML = '🎖 ' + t;
    b.title = 'A secret victory point.';
    b.disabled = true;
    sp.appendChild(b);
  });

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
    card.innerHTML =
      '<div class="top"><span class="crest">' + p.crest + '</span>' +
      '<span class="nm">' + p.name + '</span>' +
      (p.isAI ? '<span class="ai">' + AI_LEVELS[p.level].label + '</span>' : '') +
      '<span class="pvp" title="Public victory points">' + victoryPoints(p.id, false) + '</span></div>' +
      '<div class="stats">' +
      '<span>🃏 ' + totalCards(p) + ' cards</span>' +
      '<span>📜 ' + (p.spells.length + p.freshSpells.length + p.merlinTitles.length) + '</span>' +
      '<span>🔮 ' + p.aurorsPlayed + '</span>' +
      '<span>🛤 ' + roadLen + '</span>' +
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
  };
  if (!state || state.phase === 'over') return h;
  const p = currentPlayer();
  if (p.isAI) return h;

  if (state.phase === 'setup') {
    if (!state.setupRoadFrom) h.vertexTargets = validCottageSpots(p.id, true);
    else h.edgeTargets = validRoadSpots(p.id, state.setupRoadFrom);
  } else if (state.phase === 'moveDementor') {
    h.hexClickable = (id) => id !== state.dementor;
  } else if (state.pending) {
    if (state.pending.kind === 'road' || state.pending.kind === 'broom') {
      h.edgeTargets = validRoadSpots(p.id, null, state.pending.kind);
    }
    else if (state.pending.kind === 'cottage') h.vertexTargets = validCottageSpots(p.id, false);
    else if (state.pending.kind === 'castle') h.vertexTargets = validCastleSpots(p.id);
    else if (state.pending.kind === 'citadel') h.vertexTargets = validCitadelSpots(p.id);
    else if (state.pending.kind === 'ward') h.vertexTargets = validWardSpots(p.id);
  }
  return h;
}

function onVertex(vk) {
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

function onEdge(ek) {
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

function onHex(hexId) {
  if (state.phase !== 'moveDementor') return;
  moveDementor(hexId, state.current);
  tick();
}

/* ================= spells ================= */
function castSpell(card) {
  const p = currentPlayer();
  if (card === 'accio') return promptAccio(p);
  if (card === 'imperio') return promptImperio(p);
  playSpell(p.id, card, {});
  tick();
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
    '<p class="sub">Propose a swap to the other houses.</p>' +
    '<h3>You give</h3><div id="t-give"></div>' +
    '<h3>You want</h3><div id="t-get"></div>' +
    '<div class="actions"><button class="ghost" data-x>Cancel</button>' +
    '<button class="primary" data-go disabled>Send Offer</button></div>'
  );
  const giveSt = makeSteppers(limits, update);
  const getSt = makeSteppers({}, update);
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
      status.textContent = willing ? 'accepts' : 'declines';
      row.appendChild(status);
      if (willing) {
        btn.textContent = 'Trade';
        btn.addEventListener('click', () => {
          m.close();
          executePlayerTrade(proposer.id, o.id, give, get);
          tick();
        });
        row.appendChild(btn);
      }
    } else {
      btn.textContent = 'Accept (pass device)';
      btn.addEventListener('click', () => {
        m.close();
        executePlayerTrade(proposer.id, o.id, give, get);
        tick();
      });
      row.appendChild(btn);
    }
    box.appendChild(row);
  });

  m.root.querySelector('[data-x]').addEventListener('click', m.close);
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
  render();
  save();

  if (state.phase === 'over') { showVictory(); return; }

  if (state.goldQueue && state.goldQueue.length) {
    const claim = state.goldQueue[0];
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

/* ================= new game / rules ================= */
function showSetup() {
  if (aiTimer) clearTimeout(aiTimer);
  const rows = HOUSES.map((h, i) => {
    const def = i === 0 ? 'human' : (i < 3 ? 'ai:medium' : 'off');
    const opt = (v, label) => '<option value="' + v + '"' + (def === v ? ' selected' : '') + '>' + label + '</option>';
    return '<div class="setup-row" data-house="' + h.key + '">' +
      '<span class="crest">' + h.crest + '</span>' +
      '<span class="hname">' + h.name +
        (careerLine(h.key) ? ' <span class="career">' + careerLine(h.key) + '</span>' : '') + '</span>' +
      '<input type="text" value="' + h.name + '" maxlength="14" aria-label="Name">' +
      '<select aria-label="Player type">' +
      opt('human', 'Human') +
      opt('ai:easy', 'AI — Easy') +
      opt('ai:medium', 'AI — Medium') +
      opt('ai:hard', 'AI — Hard') +
      opt('off', 'Not playing') +
      '</select></div>';
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
    '<div class="actions"><button class="ghost" data-rules>Rules</button>' +
    '<button class="primary" data-start>Begin the Term</button></div>',
    { dismissible: false }
  );

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
  modal(
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
    '<li><strong>Spell Scroll</strong> — ' + costText(COSTS.spell) + '</li>' +
    '</ul>' +
    '<h3>The Dementor</h3><ul>' +
    '<li>Roll a <strong>7</strong> and anyone over their hand limit feeds half their cards to the Dementor. The limit is <strong>7</strong> unless you have warded your holdings.</li>' +
    '<li>The roller then banishes the Dementor to a new region and steals a card from someone there. That region yields nothing until the Dementor moves on.</li>' +
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
    '</ul>' +
    '<h3>Reading the Board</h3><ul>' +
    '<li>When you place, every legal junction shows what it pays per roll out of 36. Green marks a strong spot, gold a fair one. Hover for the exact regions.</li>' +
    '<li>After a roll, the regions that paid out are ringed in gold.</li>' +
    '<li><strong>Stats</strong> keeps a tally of every roll against what probability expects.</li>' +
    '</ul>' +
    '<h3>Shortcuts</h3><ul>' +
    '<li><code>R</code> roll · <code>E</code> end turn · <code>T</code> bank trade · <code>O</code> offer a trade · <code>S</code> stats</li>' +
    '<li><code>1</code>–<code>6</code> pick a thing to build · <code>Esc</code> cancel or close</li>' +
    '</ul>' +
    '<h3>Titles</h3><ul>' +
    '<li><strong>Longest Floo Network</strong> — 5+ connected routes, +2 points. An opponent’s building breaks the chain.</li>' +
    '<li><strong>Dumbledore’s Army</strong> — 3+ Aurors cast, +2 points.</li>' +
    '</ul>' +
    '</div>' +
    '<div class="actions"><button class="primary" data-x>Close</button></div>'
  ).root.querySelector('[data-x]').addEventListener('click', closeAllModals);
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
      if (state && state.pending && !state.pending.free) { state.pending = null; render(); }
      return;
    }
    if (!state || document.querySelector('.overlay')) return;

    const press = (id) => { const b = $(id); if (b && !b.disabled) b.click(); };
    const key = e.key.toLowerCase();
    if (key === 'r') press('btn-roll');
    else if (key === 'e') press('btn-end');
    else if (key === 't') press('btn-bank');
    else if (key === 'o') press('btn-offer');
    else if (key === 's') press('btn-stats');
    else if ('1234567'.includes(key)) {
      const btn = document.querySelectorAll('.build-btn')[Number(key) - 1];
      if (btn && !btn.disabled) btn.click();
    }
  });

  const saved = loadSave();
  if (saved) offerResume(saved);
  else showSetup();
});
