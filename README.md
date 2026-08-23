# Settlers of Hogsmeade

A Settlers of Catan–inspired board game with a Hogwarts theme. Pure static site — no build step,
no dependencies, no backend. Open `index.html` or serve the folder.

## Playing

Two to four houses compete — any mix of humans (hot-seat) and AI at three skill levels.

### Around one screen

Every house is set to Human or AI independently, so two people can share a laptop or an iPad
against two AI opponents, or four can play with no AI at all.

Only the player holding the device sees cards. Everyone else's hand shows as face-down backs —
you can count them, as you can across a real table, but not read them. That goes for the AI too:
its resources, its Spell Scrolls and its hidden Order of Merlin points are never on screen.

With two or more humans, a **pass-the-device** screen covers the table between hands and before
a rival's discard, so the outgoing player never sees the incoming player's cards. It names who is
up and waits for them to say they are holding it. A table playing openly can dismiss it for the
rest of the game with *Stop asking this game*. A game with a single human is never interrupted by
it, and keeps their own hand in view while the AI plays.

### Maps

- **Hogsmeade Valley** — the classic 19-hex board. First to **12 victory points**.
- **Broomstick Voyage** — the valley set in the Black Lake, ringed by open water with three
  islands beyond it. First to **14**. Broomstick Routes fly where Floo Routes cannot; a flight
  launches only from your own coastal holding, and the two kinds of route join only at one of your
  buildings. Opening Cottages go on the mainland, so the islands must be flown to. The first house
  to settle each island scores a bonus point, and two **Goblin Lodes** pay out in whatever
  resource the owner chooses. A **Pace** control sets how long AI opponents pause
between actions.

### Full screen

**Full Screen** in the top bar (or on the setup screen, or `F`) hands the game the whole display —
no address bar, no tabs. It works wherever the browser offers the Fullscreen API, iPadOS Safari
included.

For a true app on iOS, **Add to Home Screen** from the Share menu: a web app manifest and the Apple
meta tags are in place, so it launches chrome-free with its own icon, respects the safe areas around
the notch and home indicator, and drops the tagline to give the board that much more room. Saves and
the career record live in the browser and carry over. Where the Fullscreen API is missing — Safari
on iPhone — the button explains how to install instead.

### AI difficulty

| Level | Behaviour | Win rate* |
|---|---|---|
| Easy | Chases raw pips, rarely visits the bank, aims the Dementor almost at random, accepts poor trades, never opens a negotiation, and never builds Citadels, wards or Willows | 11% |
| Medium | Sound play: sensible build order, bank-trades toward its next piece, targets the leader, offers deals when a card short, builds Citadels and wards, and plants its Willow the moment the Dementor lands on its land | 39% |
| Hard | Weighs scarcity and ports, hunts the Longest Floo Network, shields its best region with a Willow before the Dementor gets there, drives for the last points once it nears the target, refuses trades that help the leader | 50% |

\* Measured over 300 three-handed games with one AI of each level and rotated seating.
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
| *(no equivalent)* | Whomping Willow — a region the Dementor cannot enter |
| Seafarers ships | Broomstick Routes — flight over the Black Lake |
| Gold field | The Goblin Lode — pays out in any resource you choose |
| Development cards | Spell Scrolls — Auror, Floo Powder, Accio, Imperio, the Marauder's Map, the Time-Turner, Order of Merlin |
| Longest Road | Longest Floo Network |
| Largest Army | Dumbledore's Army |
| Harbours | Trading Posts |

Full rules are in the in-game **Rules** panel.

## Implemented rules

Standard Catan, including the fiddly bits:

- 19-hex board, random terrain with the classic number spiral; layouts reshuffle until no two
  6/8 or matching tokens are adjacent. The layout is drawn once when a game begins and stands for
  the whole game — regions never move between turns, only the Dementor does.
- Snake-order setup; the second Cottage harvests its surrounding regions.
- Three building tiers: Cottage (1 point, 1 card), Castle (2 and 2), Citadel (3 and 3).
- Shield Charms raise your own hand limit by 2 each, up to three, taking it from 7 to 13. A ward
  survives its Castle becoming a Citadel.
- One Whomping Willow per house, planted on a producing region one of your buildings touches. The
  Dementor may never be banished into that region again, and planting on the region it is already
  sitting on beats it straight back to Azkaban. No points, no cards — just a harvest nobody can
  interrupt.
- Distance rule, road connectivity, and opponent buildings breaking a Floo Network.
- Roll of 7: discard half above 7 cards, banish the Dementor, steal a card.
- Bank shortfall rule — if the supply can't pay every claimant, nobody collects that resource.
- 4:1 / 3:1 / 2:1 trading, plus player-to-player offers in both directions: medium and hard
  opponents open negotiations rather than only answering them.
- Spell Scrolls are unplayable on the turn they're drawn; one per turn. A scroll that could do
  nothing — Floo Powder with nowhere to build, a Time-Turner before the dice are thrown, a
  Marauder's Map over empty hands — is greyed out rather than swallowed.
- The Marauder's Map lays every rival hand open and takes the one card you name; the Time-Turner
  buys a second roll of the dice, and a seven on it stirs the Dementor like any other.
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
  `F` full screen, `1`–`8` build, `Esc` cancel or close.

## Testing

The rules engine is driven entirely through globals (`state`, `createGame`, `rollDice`, `AI.*`),
so a full AI-vs-AI game can be played from the browser console without touching the DOM. That is
how the ruleset is regression-tested: batches of games are checked for resource conservation,
non-negative hands, the distance rule, piece limits, a Dementor that never stands where a Whomping
Willow grows, and a legitimate win on the target score.

## Files

```
index.html      markup shell
css/style.css   all styling
js/board.js     hex geometry, terrain, tokens, ports
js/game.js      state and rules
js/ai.js        heuristic opponents (easy / medium / hard)
js/render.js    SVG board rendering
js/ui.js        panels, modals, turn scheduler

manifest.webmanifest  installable-app metadata
icons/                app icon — icon.svg is the source, the PNGs are rendered from it
```

## Deploying to GitHub Pages

Push to `main`; Pages serves the repo root. `.nojekyll` is present so files are served verbatim.

**Bump the `?v=` on the asset links in `index.html` with every deploy.** GitHub Pages sends a
cache lifetime on CSS and JS, so without a new query string a returning player keeps running the
previous version while `index.html` itself refreshes — which is exactly the sort of mismatch that
looks like a phantom bug.
