# Settlers of Hogsmeade

A Settlers of Catan–inspired board game with a Hogwarts theme. Pure static site — no build step,
no dependencies, no backend. Open `index.html` or serve the folder.

## Playing

Two to four houses compete — any mix of humans (hot-seat) and AI at three skill levels. First to
**12 victory points** wins the House Cup. A **Pace** control sets how long AI opponents pause
between actions.

### AI difficulty

| Level | Behaviour | Win rate* |
|---|---|---|
| Easy | Chases raw pips, rarely visits the bank, aims the Dementor almost at random, accepts poor trades, never opens a negotiation, and never builds Citadels or wards | 15% |
| Medium | Sound play: sensible build order, bank-trades toward its next piece, targets the leader, offers deals when a card short, builds Citadels and wards | 36% |
| Hard | Weighs scarcity and ports, hunts the Longest Floo Network, drives for the last points once it nears the target, refuses trades that help the leader | 49% |

\* Measured over 150 three-handed games with one AI of each level and rotated seating.
The levels differ in strategy, not just strength — Hard takes the Longest Floo Network in 62% of
games against 12% for Easy, and Easy never builds a Citadel or a Shield Charm at all.

| Catan | Hogsmeade |
|---|---|
| Wood / Brick / Sheep / Wheat / Ore | Wandwood / Runestone / Owls / Mandrake / Galleons |
| Forest, Hills, Pasture, Fields, Mountains | Forbidden Forest, Hogsmeade Quarry, The Owlery, Greenhouses, Gringotts Vaults |
| Desert | Azkaban |
| Robber | The Dementor |
| Road / Settlement / City | Floo Route / Cottage / Castle |
| *(no equivalent)* | Citadel — a third tier, 3 points and 3 cards a harvest |
| City Wall | Shield Charm — a ward that raises your hand limit |
| Development cards | Spell Scrolls — Auror, Floo Powder, Accio, Imperio, Order of Merlin |
| Longest Road | Longest Floo Network |
| Largest Army | Dumbledore's Army |
| Harbours | Trading Posts |

Full rules are in the in-game **Rules** panel.

## Implemented rules

Standard Catan, including the fiddly bits:

- 19-hex board, random terrain with the classic number spiral; layouts reshuffle until no two
  6/8 or matching tokens are adjacent.
- Snake-order setup; the second Cottage harvests its surrounding regions.
- Three building tiers: Cottage (1 point, 1 card), Castle (2 and 2), Citadel (3 and 3).
- Shield Charms raise your own hand limit by 2 each, up to three, taking it from 7 to 13. A ward
  survives its Castle becoming a Citadel.
- Distance rule, road connectivity, and opponent buildings breaking a Floo Network.
- Roll of 7: discard half above 7 cards, banish the Dementor, steal a card.
- Bank shortfall rule — if the supply can't pay every claimant, nobody collects that resource.
- 4:1 / 3:1 / 2:1 trading, plus player-to-player offers in both directions: medium and hard
  opponents open negotiations rather than only answering them.
- Spell Scrolls are unplayable on the turn they're drawn; one per turn.
- Longest Floo Network (5+) and Dumbledore's Army (3+) are held until strictly beaten.

Games autosave to `localStorage` and offer to resume on reload.

### Playing aids

- **Junction values.** Every legal placement shows what it pays per roll out of 36, graded green
  for strong and gold for fair, with the exact regions on hover.
- **Harvest ring.** Regions that just paid out are ringed in gold, so a roll reads off the board.
- **The Tally.** A running histogram of every roll against what probability expects, plus each
  house's total harvest, longest route and Aurors played.
- **Trading posts.** The posts you hold are listed under your hand, so your bank rate is never a
  guess.
- **Rematch on this board.** Replay the same map with the same houses from the victory screen.
- **Career record.** Wins and games per house persist across sessions, shown on the setup screen
  and in the Stats panel, with the quickest win and best score.
- **Shortcuts.** `R` roll, `E` end turn, `T` bank trade, `O` offer a trade, `S` stats,
  `1`–`6` build, `Esc` cancel or close.

## Testing

The rules engine is driven entirely through globals (`state`, `createGame`, `rollDice`, `AI.*`),
so a full AI-vs-AI game can be played from the browser console without touching the DOM. That is
how the ruleset is regression-tested: batches of games are checked for resource conservation,
non-negative hands, the distance rule, piece limits, and a legitimate 10-point win.

## Files

```
index.html      markup shell
css/style.css   all styling
js/board.js     hex geometry, terrain, tokens, ports
js/game.js      state and rules
js/ai.js        heuristic opponents (easy / medium / hard)
js/render.js    SVG board rendering
js/ui.js        panels, modals, turn scheduler
```

## Deploying to GitHub Pages

Push to `main`; Pages serves the repo root. `.nojekyll` is present so files are served verbatim.

**Bump the `?v=` on the asset links in `index.html` with every deploy.** GitHub Pages sends a
cache lifetime on CSS and JS, so without a new query string a returning player keeps running the
previous version while `index.html` itself refreshes — which is exactly the sort of mismatch that
looks like a phantom bug.
