# Settlers of Hogsmeade

A Settlers of Catan–inspired board game with a Hogwarts theme. Pure static site — no build step,
no dependencies, no backend. Open `index.html` or serve the folder.

## Playing

Two to four houses compete — any mix of humans (hot-seat) and AI. First to **10 victory points**
wins the House Cup.

| Catan | Hogsmeade |
|---|---|
| Wood / Brick / Sheep / Wheat / Ore | Wandwood / Runestone / Owls / Mandrake / Galleons |
| Forest, Hills, Pasture, Fields, Mountains | Forbidden Forest, Hogsmeade Quarry, The Owlery, Greenhouses, Gringotts Vaults |
| Desert | Azkaban |
| Robber | The Dementor |
| Road / Settlement / City | Floo Route / Cottage / Castle |
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
- Distance rule, road connectivity, and opponent buildings breaking a Floo Network.
- Roll of 7: discard half above 7 cards, banish the Dementor, steal a card.
- Bank shortfall rule — if the supply can't pay every claimant, nobody collects that resource.
- 4:1 / 3:1 / 2:1 trading, plus player-to-player offers.
- Spell Scrolls are unplayable on the turn they're drawn; one per turn.
- Longest Floo Network (5+) and Dumbledore's Army (3+) are held until strictly beaten.

Games autosave to `localStorage` and offer to resume on reload.

## Files

```
index.html      markup shell
css/style.css   all styling
js/board.js     hex geometry, terrain, tokens, ports
js/game.js      state and rules
js/ai.js        heuristic opponents
js/render.js    SVG board rendering
js/ui.js        panels, modals, turn scheduler
```

## Deploying to GitHub Pages

Push to a repo and enable Pages on the `main` branch, root folder. `.nojekyll` is present so
files are served verbatim.
