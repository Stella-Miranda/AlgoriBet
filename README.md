# AlgoriBet

Bet points on algorithms. Each race puts six algorithms on the same freshly
generated problem — a maze, a list to sort, a text to search — and the one that
gets there in the fewest steps wins. Everyone starts with 100 points; most
points after the last race takes the table.

## Running it

Needs Node 18 or newer.

```sh
npm install
npm start            # http://localhost:3000  (PORT=8080 npm start to change)
npm run check        # engine sanity checks; add -- --odds to print win rates
```

Friends on the same network can join at `http://<your-ip>:3000`. To play over
the internet, put it behind any host that supports WebSockets.

## How it fits together

- `shared/` — the race engine, imported by both the server and the browser.
  - `modes/pathfinding.js`, `sorting.js`, `strings.js`: map generators, the
    algorithms (each one records a step-by-step trace), and a "how far along"
    measure used to move the horses down the track.
  - `race.js`: race cards, the shared race clock, finish order with dead heats,
    and the odds (a form book of a few hundred simulated races per course).
  - `rng.js`: seeded PRNG so every client rebuilds an identical race.
- `server.js` — static files plus a WebSocket server. Holds the rooms, takes
  bets, decides results and pays out. The server is the source of truth.
- `public/` — the client. No build step, no framework.

### Fairness

The map seed goes out while betting is open so players can study the course.
The race seed (tie-breaks, DFS's coin flips, quicksort's pivots) is only sent
when the gates open. Determined players could still pre-compute the
deterministic runners from the map, which is fine among friends and worth
knowing if you ever put real stakes on it (please don't).

### Timing

All six runners spend steps off one shared clock: the winner crosses the line
at 6.5 s, then the clock speeds up so the whole field is home by 10 s. Since
the clock is shared, the order you see is always the true order.
