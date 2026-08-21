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
  broom:   { wandwood: 1, owls: 1 },
  cottage: { wandwood: 1, runestone: 1, owls: 1, mandrake: 1 },
  castle:  { mandrake: 2, galleons: 3 },
  citadel: { runestone: 1, mandrake: 2, galleons: 3 },
  ward:    { runestone: 2 },
  spell:   { owls: 1, mandrake: 1, galleons: 1 },
};

const PIECE_NAMES = {
  road: 'Floo Route', broom: 'Broomstick Route', cottage: 'Cottage', castle: 'Castle',
  citadel: 'Citadel', ward: 'Shield Charm',
};

// Victory points and per-roll yield by building.
const BUILDING_VP = { cottage: 1, castle: 2, citadel: 3 };
const BUILDING_YIELD = { cottage: 1, castle: 2, citadel: 3 };

const MAX_WARDS = 3;
const ISLAND_BONUS_VP = 1;   // for being first to settle each outer island
const BASE_HAND_LIMIT = 7;

const SPELLS = {
  auror:    { name: 'Auror',        icon: '\u{1F52E}', desc: 'Banish the Dementor to another region and steal one card from a player there.' },
  floo:     { name: 'Floo Powder',  icon: '\u{1F525}', desc: 'Build two routes for free — Floo Routes, or Broomstick Routes on the voyage map.' },
  accio:    { name: 'Accio',        icon: '\u{2728}',  desc: 'Take any two resources from the supply.' },
  imperio:  { name: 'Imperio',      icon: '\u{1F300}', desc: 'Name a resource; every other player hands you all of theirs.' },
  merlin:   { name: 'Order of Merlin', icon: '\u{1F396}', desc: 'Worth 1 victory point. Kept secret until you win.' },
};

const MERLIN_TITLES = [
  'Order of Merlin', 'The Triwizard Cup', "Chocolate Frog Card",
  "The Marauder's Map", 'Prefect’s Badge',
];

const VP_TO_WIN = 12;
const VOYAGE_VP = 14;   // the voyage map offers island bonuses on top
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

function createGame(playerConfigs, seed, scenario) {
  const usedSeed = seed || (Math.floor(Math.random() * 2 ** 31) >>> 0);
  const mode = scenario === 'voyage' ? 'voyage' : 'classic';
  const board = buildBoard(usedSeed, mode);
  const rng = mulberry32((usedSeed ^ 0x9e3779b9) >>> 0);

  const players = playerConfigs.map((cfg, i) => ({
    id: i,
    name: cfg.name,
    house: cfg.house,
    color: HOUSES.find((h) => h.key === cfg.house).color,
    ink: HOUSES.find((h) => h.key === cfg.house).ink,
    crest: HOUSES.find((h) => h.key === cfg.house).crest,
    isAI: cfg.isAI,
    level: cfg.level || 'medium',
    res: emptyRes(),
    spells: [],           // playable
    freshSpells: [],      // bought this turn
    merlinTitles: [],
    aurorsPlayed: 0,
    playedSpellThisTurn: false,
    offeredThisTurn: false,
    pieces: { road: 15, broom: 15, cottage: 5, castle: 4, citadel: 3, ward: MAX_WARDS },
    ports: [],
    islands: [],   // outer islands this house has settled first
  }));

  const setupOrder = [];
  for (let i = 0; i < players.length; i++) setupOrder.push(i);
  for (let i = players.length - 1; i >= 0; i--) setupOrder.push(i);

  const bank = emptyRes();
  RES_KEYS.forEach((k) => { bank[k] = BANK_PER_RESOURCE; });

  const rollTally = {};
  for (let n = 2; n <= 12; n++) rollTally[n] = 0;

  state = {
    seed: usedSeed,
    scenario: mode,
    vpTarget: mode === 'voyage' ? VOYAGE_VP : VP_TO_WIN,
    configs: playerConfigs,   // kept so a rematch can reuse board + houses
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
    offer: null,              // a trade an AI has put to another house
    goldQueue: [],            // houses owed a free pick from a Goblin Lode
    stats: { rolls: rollTally, harvested: players.map(() => 0), sevens: 0 },
    log: [],
    turnCount: 0,
  };

  const roster = players.map((p) => p.name + (p.isAI ? ' (' + AI_LEVELS[p.level].label + ')' : '')).join(', ');
  logMsg('The Sorting is complete. ' + roster + ' take their places.');
  logMsg(players[state.current].name + ' places the first Cottage.');
  return state;
}

function logMsg(text, cls) {
  state.log.unshift({ text, cls: cls || '' });
  if (state.log.length > 200) state.log.pop();
}

function currentPlayer() { return state.players[state.current]; }

function totalCards(p) { return RES_KEYS.reduce((s, k) => s + p.res[k], 0); }

function wardCount(playerId) {
  return Object.values(state.buildings).filter((b) => b.owner === playerId && b.ward).length;
}

// Each Shield Charm lets a house hold two more cards through a seven.
function handLimit(playerId) {
  return BASE_HAND_LIMIT + 2 * wardCount(playerId);
}

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

/* ---------- terrain ---------- */
function hexIsSea(hexId) { return isSea(state.board.hexes[hexId]); }

function edgeTouchesSea(ek) {
  return state.board.edges[ek].hexes.some(hexIsSea);
}
function edgeTouchesLand(ek) {
  return state.board.edges[ek].hexes.some((id) => !hexIsSea(id));
}

// A Floo Route needs ground under it; a Broomstick Route needs open water.
// A shoreline edge will take either.
function edgeAllows(ek, kind) {
  const e = state.board.edges[ek];
  if (!e.hexes.length) return false;
  return kind === 'broom' ? edgeTouchesSea(ek) : edgeTouchesLand(ek);
}

function vertexTouchesLand(vk) {
  return state.board.vertices[vk].hexes.some((id) => !hexIsSea(id));
}

/* ---------- junction yield ---------- */
function vertexYield(vk) {
  const v = state.board.vertices[vk];
  let pips = 0;
  const hexes = [];
  v.hexes.forEach((hid) => {
    const h = state.board.hexes[hid];
    if (!h.res) return;
    pips += h.pips;
    hexes.push(h);
  });
  return { pips, hexes, port: v.port };
}

function vertexYieldText(vk) {
  const y = vertexYield(vk);
  if (!y.hexes.length) return 'Yields nothing';
  const parts = y.hexes
    .sort((a, b) => b.pips - a.pips)
    .map((h) => (h.res === 'gold' ? 'Goblin Lode' : RESOURCES[h.res].label) + ' on ' + h.number);
  let text = y.pips + '/36 per roll — ' + parts.join(', ');
  if (y.port) text += '\n' + portLabel(y.port);
  return text;
}

/* ---------- placement legality ---------- */
function vertexIsFree(vk) {
  if (state.buildings[vk]) return false;
  return state.board.vertices[vk].adj.every((n) => !state.buildings[n]);
}

function playerTouchesVertex(playerId, vk, kind) {
  return state.board.vertices[vk].adj.some((n) => {
    const r = state.roads[ekey(vk, n)];
    if (!r || r.owner !== playerId) return false;
    return kind ? routeKind(r) === kind : true;
  });
}

function routeKind(r) { return r.kind || 'road'; }

function vertexOnMainland(vk) {
  return state.board.vertices[vk].hexes.some((id) => {
    const h = state.board.hexes[id];
    return !isSea(h) && h.island === 0;
  });
}

function validCottageSpots(playerId, setupPhase) {
  return Object.keys(state.board.vertices).filter((vk) => {
    if (!vertexIsFree(vk)) return false;
    if (!vertexTouchesLand(vk)) return false;   // nobody builds on open water
    // The opening settlements are made on the mainland; the islands must be
    // reached by broomstick, which is the whole point of the voyage.
    if (setupPhase) return vertexOnMainland(vk);
    return playerTouchesVertex(playerId, vk);
  });
}

function validCastleSpots(playerId) {
  return Object.keys(state.buildings).filter(
    (vk) => state.buildings[vk].owner === playerId && state.buildings[vk].type === 'cottage'
  );
}

function validCitadelSpots(playerId) {
  return Object.keys(state.buildings).filter(
    (vk) => state.buildings[vk].owner === playerId && state.buildings[vk].type === 'castle'
  );
}

// A Shield Charm may be laid on any fortified holding that has none.
function validWardSpots(playerId) {
  if (wardCount(playerId) >= MAX_WARDS) return [];
  return Object.keys(state.buildings).filter((vk) => {
    const b = state.buildings[vk];
    return b.owner === playerId && b.type !== 'cottage' && !b.ward;
  });
}

function validRoadSpots(playerId, restrictToVertex, kind) {
  const want = kind || 'road';
  return Object.keys(state.board.edges).filter((ek) => {
    if (state.roads[ek]) return false;
    if (!edgeAllows(ek, want)) return false;
    const e = state.board.edges[ek];
    if (restrictToVertex) return e.a === restrictToVertex || e.b === restrictToVertex;
    return [e.a, e.b].some((v) => {
      const b = state.buildings[v];
      if (b && b.owner === playerId) return true;
      if (b && b.owner !== playerId) return false; // blocked by opponent building
      // routes of different kinds may only be joined at your own building
      return playerTouchesVertex(playerId, v, want);
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
  claimIsland(playerId, vk);
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

function placeCitadel(playerId, vk) {
  const p = state.players[playerId];
  pay(p, COSTS.citadel);
  state.buildings[vk].type = 'citadel';
  p.pieces.castle++;
  p.pieces.citadel--;
  logMsg(p.name + ' raises a Citadel — three cards from every harvest.');
}

function placeWard(playerId, vk) {
  const p = state.players[playerId];
  pay(p, COSTS.ward);
  state.buildings[vk].ward = true;
  p.pieces.ward--;
  logMsg(p.name + ' binds a Shield Charm — they may now hold ' + handLimit(playerId) + ' cards through a seven.');
}

function placeRoad(playerId, ek, free, kind) {
  const p = state.players[playerId];
  const want = kind || 'road';
  if (!free) pay(p, COSTS[want]);
  state.roads[ek] = { owner: playerId, kind: want };
  p.pieces[want]--;
  recomputeLongestRoad();
}

// The first house to settle an outer island is rewarded for the crossing.
function claimIsland(playerId, vk) {
  const p = state.players[playerId];
  state.board.vertices[vk].hexes.forEach((hid) => {
    const island = state.board.hexes[hid].island;
    if (!island || p.islands.includes(island)) return;
    p.islands.push(island);
    logMsg(p.name + ' founds a settlement across the water — +' + ISLAND_BONUS_VP + ' point.', 'award');
  });
}

/* ---------- dice & production ---------- */
function rollDice() {
  const d1 = 1 + Math.floor(Math.random() * 6);
  const d2 = 1 + Math.floor(Math.random() * 6);
  state.dice = [d1, d2];
  const sum = d1 + d2;
  state.stats.rolls[sum]++;
  logMsg(currentPlayer().name + ' rolls ' + d1 + ' + ' + d2 + ' = ' + sum + '.', 'roll');
  if (sum === 7) {
    state.stats.sevens++;
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

  const gold = {};
  state.board.hexes.forEach((hex) => {
    if (hex.number !== sum || hex.id === state.dementor || !hex.res) return;
    hex.corners.forEach((vk) => {
      const b = state.buildings[vk];
      if (!b) return;
      const n = BUILDING_YIELD[b.type] || 1;
      if (hex.res === 'gold') gold[b.owner] = (gold[b.owner] || 0) + n;
      else owed[b.owner][hex.res] += n;
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
      state.stats.harvested[p.id] += got;
      if (got > 0) lines.push(p.name + ' +' + got + ' ' + RESOURCES[k].icon);
    });
  });

  Object.keys(gold).forEach((id) => {
    const p = state.players[Number(id)];
    lines.push(p.name + ' +' + gold[id] + ' from the Lode');
    state.goldQueue.push({ player: Number(id), count: gold[id] });
  });

  if (lines.length) logMsg('Harvest: ' + lines.join(' · '));
  else logMsg('Nothing is harvested.');
}

function takeGold(playerId, counts) {
  const p = state.players[playerId];
  let n = 0;
  RES_KEYS.forEach((k) => { n += grant(p, k, counts[k] || 0); });
  state.goldQueue = state.goldQueue.filter((g) => g.player !== playerId);
  logMsg(p.name + ' draws ' + n + ' from the Goblin Lode.');
}

function handleSeven() {
  logMsg('A seven! The Dementor stirs.', 'warn');
  state.returnPhase = 'main';
  state.discardQueue = state.players.filter((p) => totalCards(p) > handLimit(p.id)).map((p) => p.id);
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

// Which kinds of route a Floo Powder could actually lay right now.
function flooKindsAvailable(playerId) {
  const p = state.players[playerId];
  const kinds = state.scenario === 'voyage' ? ['road', 'broom'] : ['road'];
  return kinds.filter((k) => p.pieces[k] > 0 && validRoadSpots(playerId, null, k).length > 0);
}

function playSpell(playerId, card, opts) {
  const p = state.players[playerId];
  const idx = p.spells.indexOf(card);
  if (idx < 0 || p.playedSpellThisTurn) return false;

  // Check the spell can actually do something before it leaves the hand — a
  // scroll spent on nothing is a scroll silently lost.
  let flooKind = null;
  if (card === 'floo') {
    const kinds = flooKindsAvailable(playerId);
    if (!kinds.length) return false;
    flooKind = (opts && opts.kind && kinds.includes(opts.kind)) ? opts.kind : kinds[0];
  }

  p.spells.splice(idx, 1);
  p.playedSpellThisTurn = true;

  if (card === 'auror') {
    p.aurorsPlayed++;
    logMsg(p.name + ' summons an Auror. Expecto Patronum!', 'spell');
    recomputeLargestArmy();
    state.returnPhase = state.phase === 'roll' ? 'roll' : 'main';
    state.phase = 'moveDementor';
  } else if (card === 'floo') {
    logMsg(p.name + ' casts Floo Powder — two free ' + PIECE_NAMES[flooKind] + 's.', 'spell');
    const avail = validRoadSpots(playerId, null, flooKind).length;
    state.pending = { kind: flooKind, free: true, remaining: Math.min(2, avail, p.pieces[flooKind]) };
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
    const kind = routeKind(state.roads[ek]);
    (adj[e.a] = adj[e.a] || []).push({ ek, to: e.b, kind });
    (adj[e.b] = adj[e.b] || []).push({ ek, to: e.a, kind });
  });

  const blocked = (v) => {
    const b = state.buildings[v];
    return !!b && b.owner !== playerId;
  };

  const mine = (v) => { const b = state.buildings[v]; return b && b.owner === playerId; };

  let best = 0;
  const walk = (v, used, lastKind) => {
    if (used.size > best) best = used.size;
    if (blocked(v)) return;
    for (const { ek, to, kind } of adj[v] || []) {
      if (used.has(ek)) continue;
      // a route may only change between road and broomstick at your own building
      if (lastKind && kind !== lastKind && !mine(v)) continue;
      used.add(ek);
      walk(to, used, kind);
      used.delete(ek);
    }
  };
  Object.keys(adj).forEach((v) => walk(v, new Set(), null));
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
    vp += BUILDING_VP[b.type] || 1;
  });
  vp += p.islands.length * ISLAND_BONUS_VP;
  if (state.longestRoad.owner === playerId) vp += 2;
  if (state.largestArmy.owner === playerId) vp += 2;
  if (includeHidden) vp += p.merlinTitles.length;
  return vp;
}

function checkVictory() {
  const p = currentPlayer();
  if (victoryPoints(p.id, true) >= (state.vpTarget || VP_TO_WIN)) {
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
  p.offeredThisTurn = false;
  state.pending = null;
  state.offer = null;
  state.dice = null;
  state.trade = null;
  state.current = (state.current + 1) % state.players.length;
  state.turnCount++;
  state.phase = 'roll';
  logMsg('— ' + currentPlayer().name + "'s turn —", 'turn');
}
