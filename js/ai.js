'use strict';
/* ------------------------------------------------------------------
   Heuristic opponents at three skill levels.

   easy   — grabs obvious pips, rarely trades to unblock itself, aims the
            Dementor almost at random, and will happily take a bad deal.
   medium — plays a sound game: builds in a sensible order, bank-trades to
            reach the next piece, targets the leader with the Dementor.
   hard   — values scarcity and ports, hunts the Longest Floo Network when
            it is winnable, drives for the last points once it nears the target,
            and refuses trades that help whoever is ahead.
------------------------------------------------------------------ */

const AI_LEVELS = {
  easy: {
    label: 'Easy', noise: 26, planTrades: true, tradeAfter: 8, skipChance: 0.15, proposes: false,
    buildsCitadels: false, wards: false, plantsWillow: false,
    dementorSkill: 0.15, spellSkill: 0.35, scarcity: 0, portValue: 0,
    endgame: false, chaseRoad: false, tradeGenerosity: 1.6,
  },
  medium: {
    label: 'Medium', noise: 7, planTrades: true, tradeAfter: 0, skipChance: 0.08, proposes: true,
    buildsCitadels: true, wards: true, plantsWillow: true,
    dementorSkill: 0.8, spellSkill: 0.85, scarcity: 8, portValue: 4,
    endgame: false, chaseRoad: false, tradeGenerosity: 1.0,
  },
  hard: {
    label: 'Hard', noise: 1.5, planTrades: true, tradeAfter: 0, skipChance: 0, proposes: true,
    buildsCitadels: true, wards: true, plantsWillow: true,
    dementorSkill: 1, spellSkill: 1, scarcity: 14, portValue: 7,
    endgame: true, chaseRoad: true, tradeGenerosity: 0.55,
  },
};

const AI = (function () {

  function cfg(playerId) {
    return AI_LEVELS[state.players[playerId].level] || AI_LEVELS.medium;
  }

  /* ---------- how good is a junction ---------- */
  function resourceReach(playerId) {
    const set = new Set();
    Object.keys(state.buildings).forEach((vk) => {
      if (state.buildings[vk].owner !== playerId) return;
      state.board.vertices[vk].hexes.forEach((hid) => {
        const h = state.board.hexes[hid];
        if (h.res) set.add(h.res);
      });
    });
    return set;
  }

  // Pips of each resource still unclaimed across the whole board — a resource
  // nobody can produce is worth far more than raw probability suggests.
  function boardScarcity() {
    const total = {};
    RES_KEYS.forEach((k) => { total[k] = 0; });
    state.board.hexes.forEach((h) => { if (h.res && total[h.res] !== undefined) total[h.res] += h.pips; });
    return total;
  }

  function vertexValue(vk, playerId) {
    const c = cfg(playerId);
    const v = state.board.vertices[vk];
    let pips = 0;
    const kinds = new Set();
    v.hexes.forEach((hid) => {
      const h = state.board.hexes[hid];
      if (!h.res) return;
      pips += h.pips;
      kinds.add(h.res);
    });

    let score = pips * 10 + kinds.size * 6;
    if (c.scarcity) {
      const owned = resourceReach(playerId);
      const supply = boardScarcity();
      v.hexes.forEach((hid) => {
        const h = state.board.hexes[hid];
        if (!h.res || supply[h.res] === undefined) return;   // a Lode is scored below
        if (!owned.has(h.res)) score += c.scarcity;
        // rarer on the board => more valuable to hold
        score += Math.max(0, (14 - supply[h.res])) * (c.scarcity / 14);
      });
    }
    // A Goblin Lode pays in any resource, so its pips are worth more than most.
    v.hexes.forEach((hid) => {
      const h = state.board.hexes[hid];
      if (h.res === 'gold') score += h.pips * 4;
      if (h.island && !state.players[playerId].islands.includes(h.island)) score += 16;
    });
    // On the voyage map a berth on the shore is what makes a crossing possible
    // at all — a flight can only launch from your own coastal holding. Inland
    // junctions always out-produce the shore, so without a real premium here
    // the islands never get visited.
    if (state.scenario === 'voyage' && v.hexes.some((hid) => isSea(state.board.hexes[hid]))) {
      const me = state.players[playerId];
      const unclaimed = state.board.hexes.some((h) => h.island > 0 && !me.islands.includes(h.island));
      score += (unclaimed && me.pieces.broom > 0) ? 38 : 6;
    }
    if (c.portValue && v.port) {
      score += v.port === 'any' ? c.portValue * 0.6 : c.portValue;
      // a 2:1 port is only worth it if we actually produce that resource
      if (v.port !== 'any' && !resourceReach(playerId).has(v.port)) score -= c.portValue * 0.5;
    }
    return score;
  }

  function pickBest(items, scoreFn, noise) {
    let best = null, bestScore = -Infinity;
    items.forEach((it) => {
      const s = scoreFn(it) + Math.random() * noise;
      if (s > bestScore) { bestScore = s; best = it; }
    });
    return best;
  }

  /* ---------- opening placement ---------- */
  function bestSetupVertex(playerId) {
    const c = cfg(playerId);
    return pickBest(validCottageSpots(playerId, true), (vk) => vertexValue(vk, playerId), c.noise * 1.5);
  }

  function bestSetupRoad(playerId, fromVertex) {
    const c = cfg(playerId);
    return pickBest(validRoadSpots(playerId, fromVertex), (ek) => {
      const e = state.board.edges[ek];
      const far = e.a === fromVertex ? e.b : e.a;
      let score = 0;
      state.board.vertices[far].adj.forEach((nb) => {
        if (vertexIsFree(nb)) score = Math.max(score, vertexValue(nb, playerId));
      });
      return score;
    }, c.noise);
  }

  /* ---------- expansion targets ---------- */
  function bestCottageSpot(playerId) {
    const c = cfg(playerId);
    return pickBest(validCottageSpots(playerId, false), (vk) => vertexValue(vk, playerId), c.noise);
  }

  function bestCastleSpot(playerId) {
    const c = cfg(playerId);
    return pickBest(validCastleSpots(playerId), (vk) => vertexValue(vk, playerId), c.noise);
  }

  function bestCitadelSpot(playerId) {
    const c = cfg(playerId);
    return pickBest(validCitadelSpots(playerId), (vk) => vertexValue(vk, playerId), c.noise);
  }

  // Ward the holding that produces most — it is the one worth protecting, and
  // the one a rival's Dementor will sit on.
  function bestWardSpot(playerId) {
    const c = cfg(playerId);
    return pickBest(validWardSpots(playerId), (vk) => vertexValue(vk, playerId), c.noise);
  }

  // The region worth a Willow: the one this house draws most from — and above
  // all the one the Dementor is sitting on, since planting there beats it off.
  function bestWillowHex(playerId) {
    const c = cfg(playerId);
    const options = validWillowHexes(playerId);
    if (!options.length) return null;
    return pickBest(options, (id) => {
      const hex = state.board.hexes[id];
      let mine = 0;
      hex.corners.forEach((vk) => {
        const b = state.buildings[vk];
        if (b && b.owner === playerId) mine += BUILDING_YIELD[b.type] || 1;
      });
      let score = hex.pips * mine * 4;
      if (hex.res === 'gold') score += 10;
      if (state.dementor === id) score += 60;
      return score;
    }, c.noise);
  }

  // Would laying this road take (or extend) the Longest Floo Network?
  function roadClaimsLongest(playerId, ek) {
    const holder = state.longestRoad.owner;
    if (holder === playerId) return false;
    state.roads[ek] = { owner: playerId };
    const len = longestRoadFor(playerId);
    delete state.roads[ek];
    return len >= 5 && len > state.longestRoad.length;
  }

  function bestRoadSpot(playerId, kind) {
    const c = cfg(playerId);
    const options = validRoadSpots(playerId, null, kind);
    return pickBest(options, (ek) => {
      const e = state.board.edges[ek];
      let score = 1;
      [e.a, e.b].forEach((v) => {
        if (vertexIsFree(v) && vertexTouchesLand(v)) score = Math.max(score, vertexValue(v, playerId));
        state.board.vertices[v].adj.forEach((nb) => {
          if (vertexIsFree(nb) && vertexTouchesLand(nb)) score = Math.max(score, vertexValue(nb, playerId) * 0.55);
        });
      });
      if (kind === 'broom') score += Math.max(islandPull(e.a, playerId), islandPull(e.b, playerId));
      if (c.chaseRoad && roadClaimsLongest(playerId, ek)) score += 160;
      return score;
    }, c.noise);
  }

  // How keenly this junction pulls a flight toward land not yet claimed.
  function islandPull(vk, playerId) {
    if (state.scenario !== 'voyage') return 0;
    const p = state.players[playerId];
    const targets = state.board.hexes.filter((h) => h.island > 0 && !p.islands.includes(h.island));
    if (!targets.length || p.pieces.cottage <= 0) return 0;
    const v = state.board.vertices[vk];
    const d = Math.min(...targets.map((h) => Math.hypot(v.x - h.cx, v.y - h.cy)));
    return Math.max(0, 620 - d) * 0.45;
  }

  // How far this junction is from land the house has not yet claimed.
  function islandDist(vk, playerId) {
    const p = state.players[playerId];
    const targets = state.board.hexes.filter((h) => h.island > 0 && !p.islands.includes(h.island));
    if (!targets.length) return Infinity;
    const v = state.board.vertices[vk];
    return Math.min(...targets.map((h) => Math.hypot(v.x - h.cx, v.y - h.cy)));
  }

  // The furthest point the house has already reached toward that land.
  function flightFrontier(playerId) {
    let best = Infinity;
    Object.keys(state.buildings).forEach((vk) => {
      if (state.buildings[vk].owner === playerId) best = Math.min(best, islandDist(vk, playerId));
    });
    Object.keys(state.roads).forEach((ek) => {
      const r = state.roads[ek];
      if (r.owner !== playerId || routeKind(r) !== 'broom') return;
      const e = state.board.edges[ek];
      best = Math.min(best, islandDist(e.a, playerId), islandDist(e.b, playerId));
    });
    return best;
  }

  // Is there already an island junction we could simply settle?
  function islandSpotReady(playerId) {
    const p = state.players[playerId];
    return validCottageSpots(playerId, false).some((vk) =>
      state.board.vertices[vk].hexes.some((hid) => {
        const h = state.board.hexes[hid];
        return h.island > 0 && !p.islands.includes(h.island);
      }));
  }

  // Only fly if the hop actually closes the gap — otherwise a house drifts
  // around the lake spending brooms and never making landfall.
  function bestFlightSpot(playerId) {
    const c = cfg(playerId);
    const frontier = flightFrontier(playerId);
    const options = validRoadSpots(playerId, null, 'broom').filter((ek) => {
      const e = state.board.edges[ek];
      return Math.min(islandDist(e.a, playerId), islandDist(e.b, playerId)) < frontier - 1;
    });
    if (!options.length) return null;
    return pickBest(options, (ek) => {
      const e = state.board.edges[ek];
      return -Math.min(islandDist(e.a, playerId), islandDist(e.b, playerId));
    }, c.noise);
  }

  // Which way out of the harbour: a Floo Route on land, or a Broomstick over water.
  function bestRouteMove(p, c, mayTrade, closing) {
    let bestMove = null, bestScore = -Infinity;

    if (p.pieces.road > 0) {
      const spot = bestRoadSpot(p.id, 'road');
      if (spot) {
        const claims = c.chaseRoad && roadClaimsLongest(p.id, spot);
        if (claims || (p.pieces.cottage > 0 && !closing)) {
          const allow = mayTrade && (claims || totalCards(p) > 5);
          if (affordVia(p, COSTS.road, allow)) {
            const e = state.board.edges[spot];
            let score = claims ? 200 : 0;
            [e.a, e.b].forEach((v) => {
              if (vertexIsFree(v) && vertexTouchesLand(v)) score = Math.max(score, vertexValue(v, p.id));
              state.board.vertices[v].adj.forEach((nb) => {
                if (vertexIsFree(nb) && vertexTouchesLand(nb)) score = Math.max(score, vertexValue(nb, p.id) * 0.55);
              });
            });
            bestScore = score;
            bestMove = { type: 'road', target: spot };
          }
        }
      }
    }

    if (state.scenario === 'voyage' && p.pieces.broom > 0 && p.pieces.cottage > 0 && !closing) {
      const spot = bestFlightSpot(p.id);
      if (spot && affordVia(p, COSTS.broom, mayTrade)) {
        const e = state.board.edges[spot];
        const score = 90 + Math.max(islandPull(e.a, p.id), islandPull(e.b, p.id));
        if (score > bestScore) { bestScore = score; bestMove = { type: 'broom', target: spot }; }
      }
    }

    return bestMove;
  }

  // Spend a Lode payout on whatever the next piece is short of.
  function chooseGold(playerId, count) {
    const p = state.players[playerId];
    const picks = {};
    RES_KEYS.forEach((k) => { picks[k] = 0; });
    const goal = COSTS[currentGoal(p)];
    for (let i = 0; i < count; i++) {
      const short = RES_KEYS
        .filter((k) => p.res[k] + picks[k] < (goal[k] || 0) && state.bank[k] - picks[k] > 0)
        .sort((a, b) => ((goal[b] || 0) - p.res[b] - picks[b]) - ((goal[a] || 0) - p.res[a] - picks[a]))[0];
      const fallback = RES_KEYS
        .filter((k) => state.bank[k] - picks[k] > 0)
        .sort((a, b) => (p.res[a] + picks[a]) - (p.res[b] + picks[b]))[0];
      const pick = short || fallback;
      if (!pick) break;
      picks[pick]++;
    }
    return picks;
  }

  /* ---------- bank trading ---------- */
  function missingFor(p, cost) {
    const need = {};
    let total = 0;
    Object.keys(cost).forEach((k) => {
      const d = cost[k] - p.res[k];
      if (d > 0) { need[k] = d; total += d; }
    });
    return { need, total };
  }

  // Work out the whole sequence of bank trades on paper first, so we never
  // spend cards on a conversion that cannot actually finish.
  function planBankTrades(p, cost) {
    const { need, total } = missingFor(p, cost);
    if (total === 0) return [];
    const res = { ...p.res };
    const bank = { ...state.bank };
    const trades = [];
    const wants = [];
    Object.keys(need).forEach((k) => { for (let i = 0; i < need[k]; i++) wants.push(k); });

    for (const want of wants) {
      if (bank[want] < 1) return null;
      let donor = null, bestRatio = 0;
      RES_KEYS.forEach((k) => {
        if (k === want) return;
        const rate = tradeRate(p, k);
        const surplus = res[k] - (cost[k] || 0);
        const ratio = surplus / rate;
        if (surplus >= rate && ratio > bestRatio) { bestRatio = ratio; donor = k; }
      });
      if (!donor) return null;
      res[donor] -= tradeRate(p, donor);
      res[want] += 1;
      bank[want] -= 1;
      trades.push([donor, want]);
    }
    return trades;
  }

  function affordVia(p, cost, allowTrades) {
    if (canAfford(p, cost)) return true;
    if (!allowTrades) return false;
    const plan = planBankTrades(p, cost);
    if (!plan) return false;
    plan.forEach(([give, get]) => bankTrade(p.id, give, get));
    return canAfford(p, cost);
  }

  /* ---------- the Dementor ---------- */
  function bestDementorHex(playerId) {
    const c = cfg(playerId);
    const options = state.board.hexes.filter((h) => canDementorEnter(h.id));
    if (!options.length) return state.dementor;

    // Unskilled players just shove it somewhere that is not their own land.
    if (Math.random() > c.dementorSkill) {
      const harmless = options.filter((h) =>
        h.corners.every((vk) => !state.buildings[vk] || state.buildings[vk].owner !== playerId));
      const pool = harmless.length ? harmless : options;
      return pool[Math.floor(Math.random() * pool.length)].id;
    }

    const vp = {};
    state.players.forEach((p) => { vp[p.id] = victoryPoints(p.id, false); });
    const leadVP = Math.max(...state.players.map((p) => vp[p.id]));

    return pickBest(options, (hex) => {
      let score = 0, hitsSelf = false;
      hex.corners.forEach((vk) => {
        const b = state.buildings[vk];
        if (!b) return;
        const weight = (b.type === 'castle' ? 2 : 1) * hex.pips;
        if (b.owner === playerId) { hitsSelf = true; score -= weight * 4; }
        else {
          score += weight * (1 + vp[b.owner] * 0.3);
          // squeeze the leader hardest, and prefer someone we can rob
          if (vp[b.owner] === leadVP) score += weight * 0.8;
          if (totalCards(state.players[b.owner]) > 0) score += 3;
        }
      });
      if (hitsSelf) score -= 12;
      return score;
    }, 1).id;
  }

  function richestTarget(targets) {
    return targets.slice().sort((a, b) => totalCards(state.players[b]) - totalCards(state.players[a]))[0];
  }

  /* ---------- spells ---------- */
  function considerSpell(p) {
    const c = cfg(p.id);
    if (p.playedSpellThisTurn || !p.spells.length) return null;
    if (Math.random() > c.spellSkill) return null;

    if (p.spells.includes('imperio')) {
      const best = RES_KEYS
        .map((k) => ({ k, n: state.players.reduce((s, o) => s + (o.id === p.id ? 0 : o.res[k]), 0) }))
        .sort((a, b) => b.n - a.n)[0];
      const bar = c.endgame ? 3 : 4;
      if (best.n >= bar) return { card: 'imperio', opts: { res: best.k } };
    }
    // The Map: take exactly the card that is holding us up, or bleed whoever
    // is both rich and close to the Cup.
    if (p.spells.includes('map') && spellIsCastable('map', p.id)) {
      const { need } = missingFor(p, COSTS[currentGoal(p)]);
      let best = null;
      state.players.forEach((o) => {
        if (o.id === p.id) return;
        RES_KEYS.forEach((k) => {
          if (o.res[k] <= 0) return;
          const score = (need[k] ? 10 : 1) + o.res[k] * 0.5 + victoryPoints(o.id, false) * 0.4;
          if (!best || score > best.score) best = { score, target: o.id, res: k };
        });
      });
      if (best && (c.endgame || best.score >= 6)) {
        return { card: 'map', opts: { target: best.target, res: best.res } };
      }
    }
    if (p.spells.includes('accio')) {
      const { need } = missingFor(p, COSTS[currentGoal(p)]);
      const keys = Object.keys(need);
      if (keys.length) {
        const a = keys[0];
        const b = need[a] > 1 ? a : (keys[1] || a);
        return { card: 'accio', opts: { a, b } };
      }
    }
    if (p.spells.includes('floo')) {
      const kinds = flooKindsAvailable(p.id);
      if (kinds.length) {
        // mid-crossing, spend it on the flight rather than on roads
        const flying = state.scenario === 'voyage' && kinds.includes('broom') && !!bestFlightSpot(p.id);
        return { card: 'floo', opts: { kind: flying ? 'broom' : kinds[0] } };
      }
    }
    // A second harvest is worth having, but not while a seven would cost us
    // half the hand.
    if (p.spells.includes('turner') && spellIsCastable('turner', p.id)) {
      const room = handLimit(p.id) - totalCards(p);
      const holdings = Object.keys(state.buildings)
        .filter((vk) => state.buildings[vk].owner === p.id).length;
      if (room >= 2 && holdings >= 2) return { card: 'turner', opts: {} };
    }
    if (p.spells.includes('auror')) {
      const dem = state.board.hexes[state.dementor];
      const hurtsMe = dem.corners.some((vk) => state.buildings[vk] && state.buildings[vk].owner === p.id);
      const wantsArmy = p.aurorsPlayed >= state.largestArmy.size && state.largestArmy.owner !== p.id;
      if (hurtsMe || wantsArmy) return { card: 'auror', opts: {} };
    }
    return null;
  }

  function currentGoal(p) {
    if (p.pieces.citadel > 0 && validCitadelSpots(p.id).length) return 'citadel';
    if (p.pieces.castle > 0 && validCastleSpots(p.id).length) return 'castle';
    if (p.pieces.cottage > 0 && validCottageSpots(p.id, false).length) return 'cottage';
    if (p.pieces.road > 0 && validRoadSpots(p.id).length) return 'road';
    if (p.pieces.broom > 0 && validRoadSpots(p.id, null, 'broom').length) return 'broom';
    return 'spell';
  }

  /* ---------- choose one action ---------- */
  function nextBuild(p) {
    const c = cfg(p.id);
    if (c.skipChance && Math.random() < c.skipChance) return null;

    const vp = victoryPoints(p.id, true);
    const closing = c.endgame && vp >= VP_TO_WIN - 2;
    // Weaker players only think to visit the bank once their hand is bulging.
    const mayTrade = c.planTrades && totalCards(p) >= (c.tradeAfter || 0);

    // Citadels: three points and triple production, at a steep price.
    if (p.pieces.citadel > 0 && c.buildsCitadels) {
      const spot = bestCitadelSpot(p.id);
      if (spot && affordVia(p, COSTS.citadel, mayTrade)) return { type: 'citadel', target: spot };
    }

    // A Shield Charm once the hand is regularly over the limit.
    if (c.wards && p.pieces.ward > 0) {
      const spot = bestWardSpot(p.id);
      const exposed = totalCards(p) >= handLimit(p.id) - 1;
      if (spot && exposed && affordVia(p, COSTS.ward, false)) return { type: 'ward', target: spot };
    }

    // A Whomping Willow. Reactive for most: planted the moment the Dementor
    // settles on land this house is drawing from, which beats it straight off
    // again. A hard player also shields its best region before that happens.
    if (c.plantsWillow && p.pieces.willow > 0) {
      const spot = bestWillowHex(p.id);
      if (spot !== null) {
        const besieged = state.dementor === spot;
        const prime = c.endgame && state.board.hexes[spot].pips >= 5;
        if ((besieged || prime) && affordVia(p, COSTS.willow, false)) {
          return { type: 'willow', target: spot };
        }
      }
    }

    // Castles: two points and double production.
    if (p.pieces.castle > 0) {
      const spot = bestCastleSpot(p.id);
      if (spot && affordVia(p, COSTS.castle, mayTrade)) return { type: 'castle', target: spot };
    }

    // The crossing. Ranked above a plain Cottage because an island cottage is
    // worth two points, not one — and once a flight is begun, abandoning it
    // strands the brooms already paid for.
    if (state.scenario === 'voyage' && p.pieces.cottage > 0 && p.pieces.broom > 0) {
      const unclaimed = state.board.hexes.some((h) => h.island > 0 && !p.islands.includes(h.island));
      const flying = Object.keys(state.roads).some((ek) =>
        state.roads[ek].owner === p.id && routeKind(state.roads[ek]) === 'broom');
      const berth = Object.keys(state.buildings).some((vk) =>
        state.buildings[vk].owner === p.id &&
        state.board.vertices[vk].hexes.some((h) => isSea(state.board.hexes[h])));
      // If a landing site is already in reach, settle it rather than fly on.
      if (unclaimed && (flying || berth) && !islandSpotReady(p.id)) {
        const onward = bestRouteMove(p, c, mayTrade, closing);
        if (onward && onward.type === 'broom') return onward;
      }
    }
    // Cottages.
    if (p.pieces.cottage > 0) {
      const spot = bestCottageSpot(p.id);
      if (spot && affordVia(p, COSTS.cottage, mayTrade)) return { type: 'cottage', target: spot };
    }
    // A road — either toward the next site, or to seize the Longest Floo Network.
    if (p.pieces.road > 0) {
      const spot = bestRoadSpot(p.id);
      const claims = spot && c.chaseRoad && roadClaimsLongest(p.id, spot);
      const worthIt = claims || (p.pieces.cottage > 0 && !closing);
      if (spot && worthIt) {
        const allow = mayTrade && (claims || totalCards(p) > 5);
        if (affordVia(p, COSTS.road, allow)) return { type: 'road', target: spot };
      }
    }
    // Otherwise bank spare cards into Spell Scrolls — and always do so when a
    // hidden victory point could end the game.
    if (state.spellDeck.length) {
      const allow = mayTrade && (closing || totalCards(p) >= 8);
      if (affordVia(p, COSTS.spell, allow)) return { type: 'spell' };
    }
    return null;
  }

  /* ---------- putting an offer to the table ---------- */
  // Offered when one card short of the next piece: better rates than the bank,
  // so a house would rather deal with a neighbour than pay 4:1.
  function proposeTrade(p) {
    const c = cfg(p.id);
    if (!c.proposes || p.offeredThisTurn) return null;

    const goal = COSTS[currentGoal(p)];
    const { need, total } = missingFor(p, goal);
    if (total !== 1) return null;                      // only a single card short
    const want = Object.keys(need)[0];
    if (planBankTrades(p, goal)) return null;          // the bank already covers it

    // Spend from the biggest pile that the goal does not itself require.
    const spare = RES_KEYS
      .filter((k) => k !== want && p.res[k] - (goal[k] || 0) > 0)
      .sort((a, b) => (p.res[b] - (goal[b] || 0)) - (p.res[a] - (goal[a] || 0)))[0];
    if (!spare) return null;

    const surplus = p.res[spare] - (goal[spare] || 0);
    // A sharper player opens at 1-for-1; a plainer one sweetens it immediately.
    const giveN = Math.min(surplus, c.endgame ? 1 : 2);
    if (giveN < 1) return null;

    let holders = state.players.filter((o) => o.id !== p.id && o.res[want] > 0);
    if (c.endgame) {
      // never top up whoever is closest to the House Cup
      const lead = Math.max(...state.players.map((o) => victoryPoints(o.id, false)));
      const safe = holders.filter((o) => victoryPoints(o.id, false) < lead || lead < VP_TO_WIN - 3);
      if (safe.length) holders = safe;
    }
    if (!holders.length) return null;

    holders.sort((a, b) => b.res[want] - a.res[want]);
    const give = {}, get = {};
    RES_KEYS.forEach((k) => { give[k] = 0; get[k] = 0; });
    give[spare] = giveN;
    get[want] = 1;
    return { toId: holders[0].id, give, get };
  }

  /* ---------- responding to an offer ---------- */
  function evaluateTradeOffer(playerId, give, get) {
    const c = cfg(playerId);
    const p = state.players[playerId];
    if (!canPayBundle(p, get)) return false;

    const incoming = RES_KEYS.reduce((s, k) => s + (give[k] || 0), 0);
    const outgoing = RES_KEYS.reduce((s, k) => s + (get[k] || 0), 0);
    if (outgoing > incoming * c.tradeGenerosity) return false;

    // Never hand a win to whoever is already ahead.
    if (c.endgame) {
      const leader = state.players.reduce((a, b) =>
        victoryPoints(b.id, false) > victoryPoints(a.id, false) ? b : a);
      if (leader.id === state.current && victoryPoints(leader.id, false) >= VP_TO_WIN - 2) return false;
    }

    const goal = COSTS[currentGoal(p)];
    const { need } = missingFor(p, goal);
    const helps = RES_KEYS.some((k) => (give[k] || 0) > 0 && need[k]);
    const costsCritical = RES_KEYS.some((k) => (get[k] || 0) > 0 && p.res[k] - get[k] < (goal[k] || 0));

    if (c.tradeGenerosity > 1.2) return !costsCritical || incoming > outgoing;  // easy: agreeable
    return helps && !costsCritical;
  }

  return {
    bestSetupVertex, bestSetupRoad, bestDementorHex, richestTarget,
    bestCottageSpot, bestCastleSpot, bestCitadelSpot, bestWardSpot, bestWillowHex,
    bestRoadSpot, roadClaimsLongest,
    considerSpell, nextBuild, evaluateTradeOffer, proposeTrade, currentGoal, vertexValue,
    bestRouteMove, chooseGold, bestFlightSpot, islandSpotReady,
    planBankTrades, cfg,
  };
})();
