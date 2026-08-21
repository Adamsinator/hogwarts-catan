'use strict';
/* ------------------------------------------------------------------
   Game state and rules for "Hogwarts: Settlers of Hogsmeade".
------------------------------------------------------------------ */

const HOUSES = [
  { key: 'gryffindor', name: 'Gryffindor', color: '#c8102e', ink: '#ffd24a', crest: '\u{1F981}' },
  { key: 'slytherin',  name: 'Slytherin',  color: '#1a7a4c', ink: '#d9dde0', crest: '\u{1F40D}' },
  { key: 'ravenclaw',  name: 'Ravenclaw',  color: '#2b6cb0', ink: '#c8a165', crest: '\u{1F985}' },
  { key: 'hufflepuff', name: 'Hufflepuff', color: '#e8b923', ink: '#2b2b2b', crest: '\u{1F9A1}' },
];

const COSTS = {
  road:    { wandwood: 1, runestone: 1 },
  cottage: { wandwood: 1, runestone: 1, owls: 1, mandrake: 1 },
  castle:  { mandrake: 2, galleons: 3 },
  spell:   { owls: 1, mandrake: 1, galleons: 1 },
};

const PIECE_NAMES = { road: 'Floo Route', cottage: 'Cottage', castle: 'Castle' };

const SPELLS = {
  auror:    { name: 'Auror',        icon: '\u{1F52E}', desc: 'Banish the Dementor to another region and steal one card from a player there.' },
  floo:     { name: 'Floo Powder',  icon: '\u{1F525}', desc: 'Build two Floo Routes for free.' },
  accio:    { name: 'Accio',        icon: '\u{2728}',  desc: 'Take any two resources from the supply.' },
  imperio:  { name: 'Imperio',      icon: '\u{1F300}', desc: 'Name a resource; every other player hands you all of theirs.' },
  merlin:   { name: 'Order of Merlin', icon: '\u{1F396}', desc: 'Worth 1 victory point. Kept secret until you win.' },
};

const MERLIN_TITLES = [
  'Order of Merlin', 'The Triwizard Cup', "Chocolate Frog Card",
  "The Marauder's Map", 'Prefect’s Badge',
];

const VP_TO_WIN = 10;
const BANK_PER_RESOURCE = 19;

/* ---------- state ---------- */
let state = null;

function newSpellDeck(rng) {
  const deck = [
    ...Array(14).fill('auror'),
    ...Array(2).fill('floo'),
    ...Array(2).fill('accio'),
    ...Array(2).fill('imperio'),
    ...Array(5).fill('merlin'),
  ];
  return shuffle(deck, rng);
}

function emptyRes() {
  const r = {};
  RES_KEYS.forEach((k) => { r[k] = 0; });
  return r;
}

function createGame(playerConfigs, seed) {
  const usedSeed = seed || (Math.floor(Math.random() * 2 ** 31) >>> 0);
  const board = buildBoard(usedSeed);
  const rng = mulberry32((usedSeed ^ 0x9e3779b9) >>> 0);

  const players = playerConfigs.map((cfg, i) => ({
    id: i,
    name: cfg.name,
    house: cfg.house,
    color: HOUSES.find((h) => h.key === cfg.house).color,
    ink: HOUSES.find((h) => h.key === cfg.house).ink,
    crest: HOUSES.find((h) => h.key === cfg.house).crest,
    isAI: cfg.isAI,
    res: emptyRes(),
    spells: [],           // playable
    freshSpells: [],      // bought this turn
    merlinTitles: [],
    aurorsPlayed: 0,
    playedSpellThisTurn: false,
    pieces: { road: 15, cottage: 5, castle: 4 },
    ports: [],
  }));

  const setupOrder = [];
  for (let i = 0; i < players.length; i++) setupOrder.push(i);
  for (let i = players.length - 1; i >= 0; i--) setupOrder.push(i);

  const bank = emptyRes();
  RES_KEYS.forEach((k) => { bank[k] = BANK_PER_RESOURCE; });

  state = {
    seed: usedSeed,
    board,
    players,
    bank,
    buildings: {},   // vertexKey -> {owner, type}
    roads: {},       // edgeKey  -> {owner}
    dementor: board.hexes.find((h) => h.terrain === 'azkaban').id,
    spellDeck: newSpellDeck(rng),
    current: setupOrder[0],
    setupOrder,
    setupIndex: 0,
    setupRoadFrom: null,
    phase: 'setup',          // setup | roll | main | moveDementor | steal | discard | over
    returnPhase: 'main',     // where to land once the Dementor is resolved
    dice: null,
    pending: null,           // {kind:'road'|'cottage'|'castle', free:bool, remaining:n}
    discardQueue: [],
    stealTargets: [],
    longestRoad: { owner: null, length: 0 },
    largestArmy: { owner: null, size: 0 },
    trade: null,
    winner: null,
    log: [],
    turnCount: 0,
  };

  logMsg('The Sorting is complete. ' + players.map((p) => p.name).join(', ') + ' take their places.');
  logMsg(players[state.current].name + ' places the first Cottage.');
  return state;
}

function logMsg(text, cls) {
  state.log.unshift({ text, cls: cls || '' });
  if (state.log.length > 200) state.log.pop();
}

function currentPlayer() { return state.players[state.current]; }

function totalCards(p) { return RES_KEYS.reduce((s, k) => s + p.res[k], 0); }

function canAfford(p, cost) { return Object.keys(cost).every((k) => p.res[k] >= cost[k]); }

function pay(p, cost) {
  Object.keys(cost).forEach((k) => { p.res[k] -= cost[k]; state.bank[k] += cost[k]; });
}

function grant(p, resKey, n) {
  const avail = Math.min(n, state.bank[resKey]);
  p.res[resKey] += avail;
  state.bank[resKey] -= avail;
  return avail;
}

/* ---------- placement legality ---------- */
function vertexIsFree(vk) {
  if (state.buildings[vk]) return false;
  return state.board.vertices[vk].adj.every((n) => !state.buildings[n]);
}

function playerTouchesVertex(playerId, vk) {
  return state.board.vertices[vk].adj.some((n) => {
    const ek = ekey(vk, n);
    return state.roads[ek] && state.roads[ek].owner === playerId;
  });
}

function validCottageSpots(playerId, setupPhase) {
  return Object.keys(state.board.vertices).filter((vk) => {
    if (!vertexIsFree(vk)) return false;
    return setupPhase ? true : playerTouchesVertex(playerId, vk);
  });
}

function validCastleSpots(playerId) {
  return Object.keys(state.buildings).filter(
    (vk) => state.buildings[vk].owner === playerId && state.buildings[vk].type === 'cottage'
  );
}

function validRoadSpots(playerId, restrictToVertex) {
  return Object.keys(state.board.edges).filter((ek) => {
    if (state.roads[ek]) return false;
    const e = state.board.edges[ek];
    if (restrictToVertex) return e.a === restrictToVertex || e.b === restrictToVertex;
    return [e.a, e.b].some((v) => {
      const b = state.buildings[v];
      if (b && b.owner === playerId) return true;
      if (b && b.owner !== playerId) return false; // blocked by opponent building
      return playerTouchesVertex(playerId, v);
    });
  });
}

/* ---------- building ---------- */
function placeCottage(playerId, vk, free) {
  const p = state.players[playerId];
  if (!free) pay(p, COSTS.cottage);
  state.buildings[vk] = { owner: playerId, type: 'cottage' };
  p.pieces.cottage--;
  const port = state.board.vertices[vk].port;
  if (port && !p.ports.includes(port)) p.ports.push(port);
  logMsg(p.name + ' raises a Cottage.' + (port ? ' They now trade at a ' + portLabel(port) + '.' : ''));
  recomputeLongestRoad();
}

function placeCastle(playerId, vk) {
  const p = state.players[playerId];
  pay(p, COSTS.castle);
  state.buildings[vk].type = 'castle';
  p.pieces.cottage++;
  p.pieces.castle--;
  logMsg(p.name + ' upgrades a Cottage into a Castle.');
}

function placeRoad(playerId, ek, free) {
  const p = state.players[playerId];
  if (!free) pay(p, COSTS.road);
  state.roads[ek] = { owner: playerId };
  p.pieces.road--;
  recomputeLongestRoad();
}

/* ---------- dice & production ---------- */
function rollDice() {
  const d1 = 1 + Math.floor(Math.random() * 6);
  const d2 = 1 + Math.floor(Math.random() * 6);
  state.dice = [d1, d2];
  const sum = d1 + d2;
  logMsg(currentPlayer().name + ' rolls ' + d1 + ' + ' + d2 + ' = ' + sum + '.', 'roll');
  if (sum === 7) {
    handleSeven();
  } else {
    produce(sum);
    state.phase = 'main';
  }
  return sum;
}

function produce(sum) {
  // Tally first so bank shortages can be resolved by the official rule.
  const owed = {};
  state.players.forEach((p) => { owed[p.id] = emptyRes(); });

  state.board.hexes.forEach((hex) => {
    if (hex.number !== sum || hex.id === state.dementor || !hex.res) return;
    hex.corners.forEach((vk) => {
      const b = state.buildings[vk];
      if (!b) return;
      owed[b.owner][hex.res] += b.type === 'castle' ? 2 : 1;
    });
  });

  const lines = [];
  RES_KEYS.forEach((k) => {
    const claimants = state.players.filter((p) => owed[p.id][k] > 0);
    if (!claimants.length) return;
    const demand = claimants.reduce((s, p) => s + owed[p.id][k], 0);
    if (demand > state.bank[k] && claimants.length > 1) {
      logMsg('The supply of ' + RESOURCES[k].label + ' runs dry — nobody collects it.', 'warn');
      return;
    }
    claimants.forEach((p) => {
      const got = grant(p, k, owed[p.id][k]);
      if (got > 0) lines.push(p.name + ' +' + got + ' ' + RESOURCES[k].icon);
    });
  });

  if (lines.length) logMsg('Harvest: ' + lines.join(' · '));
  else logMsg('Nothing is harvested.');
}

function handleSeven() {
  logMsg('A seven! The Dementor stirs.', 'warn');
  state.returnPhase = 'main';
  state.discardQueue = state.players.filter((p) => totalCards(p) > 7).map((p) => p.id);
  if (state.discardQueue.length) {
    state.phase = 'discard';
  } else {
    state.phase = 'moveDementor';
  }
}

function autoDiscard(playerId) {
  const p = state.players[playerId];
  const n = Math.floor(totalCards(p) / 2);
  const pool = [];
  RES_KEYS.forEach((k) => { for (let i = 0; i < p.res[k]; i++) pool.push(k); });
  pool.sort(() => Math.random() - 0.5);
  const picked = pool.slice(0, n);
  const counts = emptyRes();
  picked.forEach((k) => { counts[k]++; });
  applyDiscard(playerId, counts);
}

function applyDiscard(playerId, counts) {
  const p = state.players[playerId];
  let n = 0;
  RES_KEYS.forEach((k) => { p.res[k] -= counts[k]; state.bank[k] += counts[k]; n += counts[k]; });
  logMsg(p.name + ' feeds ' + n + ' card' + (n === 1 ? '' : 's') + ' to the Dementor.');
  state.discardQueue = state.discardQueue.filter((id) => id !== playerId);
  if (!state.discardQueue.length) state.phase = 'moveDementor';
}

function moveDementor(hexId, byPlayerId) {
  state.dementor = hexId;
  const hex = state.board.hexes[hexId];
  logMsg(state.players[byPlayerId].name + ' drives the Dementor to ' + TERRAINS[hex.terrain].name + '.', 'warn');

  const victims = new Set();
  hex.corners.forEach((vk) => {
    const b = state.buildings[vk];
    if (b && b.owner !== byPlayerId && totalCards(state.players[b.owner]) > 0) victims.add(b.owner);
  });
  const back = state.returnPhase || 'main';
  state.stealTargets = [...victims];
  if (state.stealTargets.length === 0) {
    state.phase = back;
  } else if (state.stealTargets.length === 1) {
    stealFrom(state.stealTargets[0], byPlayerId);
    state.phase = back;
  } else {
    state.phase = 'steal';
  }
}

function stealFrom(victimId, thiefId) {
  const v = state.players[victimId];
  const t = state.players[thiefId];
  const pool = [];
  RES_KEYS.forEach((k) => { for (let i = 0; i < v.res[k]; i++) pool.push(k); });
  if (!pool.length) return;
  const k = pool[Math.floor(Math.random() * pool.length)];
  v.res[k]--; t.res[k]++;
  logMsg(t.name + ' steals a card from ' + v.name + '.');
  state.stealTargets = [];
}

/* ---------- trading ---------- */
function tradeRate(player, resKey) {
  if (player.ports.includes(resKey)) return 2;
  if (player.ports.includes('any')) return 3;
  return 4;
}

function portLabel(type) {
  return type === 'any' ? '3:1 Trading Post' : '2:1 ' + RESOURCES[type].label + ' Post';
}

function bankTrade(playerId, give, get) {
  const p = state.players[playerId];
  const rate = tradeRate(p, give);
  if (p.res[give] < rate || state.bank[get] < 1) return false;
  p.res[give] -= rate; state.bank[give] += rate;
  grant(p, get, 1);
  logMsg(p.name + ' trades ' + rate + ' ' + RESOURCES[give].icon + ' for 1 ' + RESOURCES[get].icon + '.');
  return true;
}

function canPayBundle(p, bundle) {
  return RES_KEYS.every((k) => p.res[k] >= (bundle[k] || 0));
}

function executePlayerTrade(fromId, toId, give, get) {
  const a = state.players[fromId];
  const b = state.players[toId];
  RES_KEYS.forEach((k) => {
    const g = give[k] || 0, r = get[k] || 0;
    a.res[k] -= g; b.res[k] += g;
    b.res[k] -= r; a.res[k] += r;
  });
  logMsg(a.name + ' and ' + b.name + ' strike a bargain.');
}

function bundleText(b) {
  const parts = RES_KEYS.filter((k) => b[k] > 0).map((k) => b[k] + RESOURCES[k].icon);
  return parts.length ? parts.join(' ') : 'nothing';
}

/* ---------- spells ---------- */
function buySpell(playerId) {
  const p = state.players[playerId];
  if (!state.spellDeck.length || !canAfford(p, COSTS.spell)) return null;
  pay(p, COSTS.spell);
  const card = state.spellDeck.pop();
  if (card === 'merlin') {
    const title = MERLIN_TITLES[p.merlinTitles.length % MERLIN_TITLES.length];
    p.merlinTitles.push(title);
    logMsg(p.name + ' draws a Spell Scroll.');
  } else {
    p.freshSpells.push(card);
    logMsg(p.name + ' draws a Spell Scroll.');
  }
  return card;
}

function playableSpells(p) {
  return p.spells;
}

function playSpell(playerId, card, opts) {
  const p = state.players[playerId];
  const idx = p.spells.indexOf(card);
  if (idx < 0 || p.playedSpellThisTurn) return false;
  p.spells.splice(idx, 1);
  p.playedSpellThisTurn = true;

  if (card === 'auror') {
    p.aurorsPlayed++;
    logMsg(p.name + ' summons an Auror. Expecto Patronum!', 'spell');
    recomputeLargestArmy();
    state.returnPhase = state.phase === 'roll' ? 'roll' : 'main';
    state.phase = 'moveDementor';
  } else if (card === 'floo') {
    logMsg(p.name + ' casts Floo Powder — two free Floo Routes.', 'spell');
    const avail = validRoadSpots(playerId).length;
    state.pending = { kind: 'road', free: true, remaining: Math.min(2, avail, p.pieces.road) };
    if (state.pending.remaining <= 0) state.pending = null;
  } else if (card === 'accio') {
    logMsg(p.name + ' casts Accio for ' + RESOURCES[opts.a].icon + ' ' + RESOURCES[opts.b].icon + '.', 'spell');
    grant(p, opts.a, 1);
    grant(p, opts.b, 1);
  } else if (card === 'imperio') {
    let taken = 0;
    state.players.forEach((o) => {
      if (o.id === playerId) return;
      taken += o.res[opts.res];
      p.res[opts.res] += o.res[opts.res];
      o.res[opts.res] = 0;
    });
    logMsg(p.name + ' casts Imperio and seizes ' + taken + ' ' + RESOURCES[opts.res].label + '.', 'spell');
  }
  return true;
}

/* ---------- longest road / largest army ---------- */
function recomputeLongestRoad() {
  const holder = state.longestRoad.owner;

  const lengths = state.players.map((p) => longestRoadFor(p.id));
  let maxLen = Math.max(...lengths, 0);
  if (maxLen < 5) {
    if (holder !== null) logMsg('The Longest Floo Network is broken and unclaimed.');
    state.longestRoad = { owner: null, length: 0 };
    return;
  }
  // Incumbent keeps the title on a tie.
  if (holder !== null && lengths[holder] === maxLen) {
    state.longestRoad = { owner: holder, length: maxLen };
    return;
  }
  const leaders = lengths.map((l, i) => [l, i]).filter(([l]) => l === maxLen);
  if (leaders.length > 1 && holder !== null) {
    state.longestRoad = { owner: holder, length: lengths[holder] };
    return;
  }
  const winner = leaders[0][1];
  if (winner !== holder) {
    logMsg(state.players[winner].name + ' claims the Longest Floo Network (' + maxLen + ').', 'award');
  }
  state.longestRoad = { owner: winner, length: maxLen };
}

function longestRoadFor(playerId) {
  const own = Object.keys(state.roads).filter((ek) => state.roads[ek].owner === playerId);
  if (!own.length) return 0;

  const adj = {};
  own.forEach((ek) => {
    const e = state.board.edges[ek];
    (adj[e.a] = adj[e.a] || []).push({ ek, to: e.b });
    (adj[e.b] = adj[e.b] || []).push({ ek, to: e.a });
  });

  const blocked = (v) => {
    const b = state.buildings[v];
    return !!b && b.owner !== playerId;
  };

  let best = 0;
  const walk = (v, used) => {
    if (used.size > best) best = used.size;
    if (blocked(v)) return;
    for (const { ek, to } of adj[v] || []) {
      if (used.has(ek)) continue;
      used.add(ek);
      walk(to, used);
      used.delete(ek);
    }
  };
  Object.keys(adj).forEach((v) => walk(v, new Set()));
  return best;
}

function recomputeLargestArmy() {
  const sizes = state.players.map((p) => p.aurorsPlayed);
  const max = Math.max(...sizes);
  if (max < 3) return;
  const holder = state.largestArmy.owner;
  if (holder !== null && sizes[holder] === max) return;
  const winner = sizes.indexOf(max);
  if (winner !== holder) {
    logMsg(state.players[winner].name + " musters Dumbledore's Army (" + max + ' Aurors).', 'award');
  }
  state.largestArmy = { owner: winner, size: max };
}

/* ---------- scoring ---------- */
function victoryPoints(playerId, includeHidden) {
  const p = state.players[playerId];
  let vp = 0;
  Object.values(state.buildings).forEach((b) => {
    if (b.owner !== playerId) return;
    vp += b.type === 'castle' ? 2 : 1;
  });
  if (state.longestRoad.owner === playerId) vp += 2;
  if (state.largestArmy.owner === playerId) vp += 2;
  if (includeHidden) vp += p.merlinTitles.length;
  return vp;
}

function checkVictory() {
  const p = currentPlayer();
  if (victoryPoints(p.id, true) >= VP_TO_WIN) {
    state.winner = p.id;
    state.phase = 'over';
    logMsg(p.name + ' wins the House Cup with ' + victoryPoints(p.id, true) + ' points!', 'award');
    return true;
  }
  return false;
}

/* ---------- turn flow ---------- */
function advanceSetup(justPlacedRoad) {
  state.setupIndex++;
  if (state.setupIndex >= state.setupOrder.length) {
    state.phase = 'roll';
    state.current = state.setupOrder[0];
    state.turnCount = 1;
    logMsg('Term begins! ' + currentPlayer().name + ' rolls first.', 'roll');
    return;
  }
  state.current = state.setupOrder[state.setupIndex];
  state.setupRoadFrom = null;
  logMsg(currentPlayer().name + ' places a Cottage.');
}

function setupSecondRoundGift(vk) {
  const p = currentPlayer();
  const gained = [];
  state.board.vertices[vk].hexes.forEach((hid) => {
    const hex = state.board.hexes[hid];
    if (!hex.res) return;
    grant(p, hex.res, 1);
    gained.push(RESOURCES[hex.res].icon);
  });
  if (gained.length) logMsg(p.name + ' collects ' + gained.join(' ') + ' from the surrounding land.');
}

function endTurn() {
  const p = currentPlayer();
  p.spells = p.spells.concat(p.freshSpells);
  p.freshSpells = [];
  p.playedSpellThisTurn = false;
  state.pending = null;
  state.dice = null;
  state.trade = null;
  state.current = (state.current + 1) % state.players.length;
  state.turnCount++;
  state.phase = 'roll';
  logMsg('— ' + currentPlayer().name + "'s turn —", 'turn');
}
