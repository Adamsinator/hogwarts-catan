'use strict';
/* ------------------------------------------------------------------
   Heuristic opponents. Not a grandmaster — but it builds sensibly,
   trades to unblock itself, and aims the Dementor at the leader.
------------------------------------------------------------------ */

const AI = (function () {

  function vertexValue(vk, playerId) {
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
    // Value scarce resources in this player's portfolio.
    const owned = resourceReach(playerId);
    v.hexes.forEach((hid) => {
      const h = state.board.hexes[hid];
      if (h.res && !owned.has(h.res)) score += 8;
    });
    if (v.port === 'any') score += 4;
    else if (v.port) score += 3;
    return score;
  }

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

  function bestSetupVertex(playerId) {
    const spots = validCottageSpots(playerId, true);
    let best = null, bestScore = -1;
    spots.forEach((vk) => {
      const s = vertexValue(vk, playerId) + Math.random() * 3;
      if (s > bestScore) { bestScore = s; best = vk; }
    });
    return best;
  }

  function bestSetupRoad(playerId, fromVertex) {
    const options = validRoadSpots(playerId, fromVertex);
    let best = null, bestScore = -1;
    options.forEach((ek) => {
      const e = state.board.edges[ek];
      const far = e.a === fromVertex ? e.b : e.a;
      // Look one step beyond for a future cottage site.
      let score = 0;
      state.board.vertices[far].adj.forEach((nb) => {
        if (vertexIsFree(nb)) score = Math.max(score, vertexValue(nb, playerId));
      });
      score += Math.random() * 5;
      if (score > bestScore) { bestScore = score; best = ek; }
    });
    return best;
  }

  /* ---------- expansion targets ---------- */
  function bestCottageSpot(playerId) {
    const spots = validCottageSpots(playerId, false);
    let best = null, bestScore = -1;
    spots.forEach((vk) => {
      const s = vertexValue(vk, playerId);
      if (s > bestScore) { bestScore = s; best = vk; }
    });
    return best;
  }

  function bestCastleSpot(playerId) {
    const spots = validCastleSpots(playerId);
    let best = null, bestScore = -1;
    spots.forEach((vk) => {
      const s = vertexValue(vk, playerId);
      if (s > bestScore) { bestScore = s; best = vk; }
    });
    return best;
  }

  // A road that opens the best new cottage site.
  function bestRoadSpot(playerId) {
    const options = validRoadSpots(playerId);
    let best = null, bestScore = -1;
    options.forEach((ek) => {
      const e = state.board.edges[ek];
      let score = 1;
      [e.a, e.b].forEach((v) => {
        if (vertexIsFree(v)) score = Math.max(score, vertexValue(v, playerId));
        state.board.vertices[v].adj.forEach((nb) => {
          if (vertexIsFree(nb)) score = Math.max(score, vertexValue(nb, playerId) * 0.55);
        });
      });
      if (score > bestScore) { bestScore = score; best = ek; }
    });
    return best;
  }

  /* ---------- resource shortfall + bank trades ---------- */
  function missingFor(p, cost) {
    const need = {};
    let total = 0;
    Object.keys(cost).forEach((k) => {
      const d = cost[k] - p.res[k];
      if (d > 0) { need[k] = d; total += d; }
    });
    return { need, total };
  }

  function trySpendSurplus(p, cost) {
    const { need, total } = missingFor(p, cost);
    if (total === 0) return true;
    for (const want of Object.keys(need)) {
      for (let i = 0; i < need[want]; i++) {
        const donor = RES_KEYS
          .filter((k) => !cost[k] || p.res[k] - (cost[k] || 0) >= tradeRate(p, k))
          .filter((k) => p.res[k] >= tradeRate(p, k))
          .sort((a, b) => (p.res[b] / tradeRate(p, b)) - (p.res[a] / tradeRate(p, a)))[0];
        if (!donor) return false;
        if (!bankTrade(p.id, donor, want)) return false;
      }
    }
    return canAfford(p, cost);
  }

  /* ---------- the Dementor ---------- */
  function bestDementorHex(playerId) {
    const leaderVP = {};
    state.players.forEach((p) => { leaderVP[p.id] = victoryPoints(p.id, false); });
    let best = null, bestScore = -Infinity;
    state.board.hexes.forEach((hex) => {
      if (hex.id === state.dementor) return;
      let score = 0, hitsSelf = false;
      hex.corners.forEach((vk) => {
        const b = state.buildings[vk];
        if (!b) return;
        const weight = (b.type === 'castle' ? 2 : 1) * hex.pips;
        if (b.owner === playerId) { hitsSelf = true; score -= weight * 4; }
        else score += weight * (1 + leaderVP[b.owner] * 0.25);
      });
      if (hitsSelf) score -= 10;
      score += Math.random();
      if (score > bestScore) { bestScore = score; best = hex.id; }
    });
    return best === null ? (state.dementor + 1) % state.board.hexes.length : best;
  }

  function richestTarget(targets) {
    return targets.slice().sort((a, b) => totalCards(state.players[b]) - totalCards(state.players[a]))[0];
  }

  /* ---------- spells ---------- */
  function considerSpell(p) {
    if (p.playedSpellThisTurn || !p.spells.length) return null;
    if (p.spells.includes('imperio')) {
      const best = RES_KEYS
        .map((k) => ({ k, n: state.players.reduce((s, o) => s + (o.id === p.id ? 0 : o.res[k]), 0) }))
        .sort((a, b) => b.n - a.n)[0];
      if (best.n >= 3) return { card: 'imperio', opts: { res: best.k } };
    }
    if (p.spells.includes('accio')) {
      const goal = currentGoal(p);
      const { need } = missingFor(p, COSTS[goal]);
      const keys = Object.keys(need);
      if (keys.length) {
        const a = keys[0];
        const b = need[a] > 1 ? a : (keys[1] || a);
        return { card: 'accio', opts: { a, b } };
      }
    }
    if (p.spells.includes('floo') && p.pieces.road >= 2 && validRoadSpots(p.id).length >= 2) {
      return { card: 'floo', opts: {} };
    }
    if (p.spells.includes('auror')) {
      const dem = state.board.hexes[state.dementor];
      const hurtsMe = dem.corners.some((vk) => state.buildings[vk] && state.buildings[vk].owner === p.id);
      if (hurtsMe || p.aurorsPlayed >= state.largestArmy.size) return { card: 'auror', opts: {} };
    }
    return null;
  }

  function currentGoal(p) {
    if (p.pieces.castle > 0 && validCastleSpots(p.id).length) return 'castle';
    if (p.pieces.cottage > 0 && validCottageSpots(p.id, false).length) return 'cottage';
    if (p.pieces.road > 0 && validRoadSpots(p.id).length) return 'road';
    return 'spell';
  }

  /* ---------- one build step; returns an action or null ---------- */
  function nextBuild(p) {
    // 1. Castles first — they double production and are 2 VP.
    if (p.pieces.castle > 0) {
      const spot = bestCastleSpot(p.id);
      if (spot && (canAfford(p, COSTS.castle) || trySpendSurplus(p, COSTS.castle))) {
        return { type: 'castle', target: spot };
      }
    }
    // 2. Cottages.
    if (p.pieces.cottage > 0) {
      const spot = bestCottageSpot(p.id);
      if (spot && (canAfford(p, COSTS.cottage) || trySpendSurplus(p, COSTS.cottage))) {
        return { type: 'cottage', target: spot };
      }
    }
    // 3. A road toward the next site.
    if (p.pieces.road > 0 && p.pieces.cottage > 0) {
      const spot = bestRoadSpot(p.id);
      if (spot && (canAfford(p, COSTS.road) || (totalCards(p) > 5 && trySpendSurplus(p, COSTS.road)))) {
        return { type: 'road', target: spot };
      }
    }
    // 4. Otherwise bank spare cards into Spell Scrolls.
    if (state.spellDeck.length && (canAfford(p, COSTS.spell) || (totalCards(p) >= 8 && trySpendSurplus(p, COSTS.spell)))) {
      return { type: 'spell' };
    }
    return null;
  }

  function evaluateTradeOffer(playerId, give, get) {
    // `give` is what the proposer gives away (AI receives it).
    const p = state.players[playerId];
    if (!canPayBundle(p, get)) return false;
    const incoming = RES_KEYS.reduce((s, k) => s + (give[k] || 0), 0);
    const outgoing = RES_KEYS.reduce((s, k) => s + (get[k] || 0), 0);
    if (outgoing > incoming) return false;
    const goal = COSTS[currentGoal(p)];
    const { need } = missingFor(p, goal);
    const helps = RES_KEYS.some((k) => (give[k] || 0) > 0 && need[k]);
    const costsCritical = RES_KEYS.some((k) => (get[k] || 0) > 0 && p.res[k] - get[k] < (goal[k] || 0));
    return helps && !costsCritical;
  }

  return {
    bestSetupVertex, bestSetupRoad, bestDementorHex, richestTarget,
    bestCottageSpot, bestCastleSpot, bestRoadSpot,
    considerSpell, nextBuild, evaluateTradeOffer, currentGoal, vertexValue,
  };
})();
