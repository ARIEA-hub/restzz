# How Q-Sense works

Q-Sense runs a restaurant's front door: guests find a place, join the waitlist or book, and staff seat them. This page follows that journey. For each step it explains what the product does and which technique does the work underneath. The AI serves the product here: each technique is used where it makes that step better, not to show the technique off.

Contents: [Finding a restaurant](#1-finding-a-restaurant) · [Waiting in the queue](#2-waiting-in-the-queue) · [Seating guests](#3-seating-guests) · [Reservations](#4-reservations) · [Planning staff](#5-planning-staff) · [The chat assistant](#6-the-chat-assistant) · [Setup and data](#7-setup-and-data) · [Technique index](#technique-index)

---

## 1. Finding a restaurant

**On the Locations page**, guests see a map of open restaurants and a **Recommended for you** panel for their party size.

### Recommended for you
Each suggestion comes with short reasons: "✓ Table for 4 free now · ✓ No queue · ✓ 0.2 km, walkable", or "✕ No table here seats 8".

*How it works.* A small rule-based expert system (`api/utils/expertSystem.js`, `GET /api/restaurant/expert-recommend`). Live data is turned into facts: which tables are free and how big, the queue length, and the distance. Rules like "a free table that fits **and** a short wait **and** nearby → best right now" are applied by **forward chaining** until nothing new follows. The reasons guests see are built from the facts the rules actually derived, so the explanation and the decision can't disagree. **Backward chaining** answers "why isn't this the top pick?", and **resolution** can prove any conclusion formally; both are used in the tests and returned by the API. Full write-up, including limitations: [expert-system.md](expert-system.md).

### "Most convenient" ranking
`GET /api/restaurant/recommended?lat=&lng=` ranks by a weighted score of real distance (haversine) and current wait (`api/utils/scoring.js`). With `&explain=true`, Gemini writes one sentence about the #1 pick, using only the computed numbers.

### Directions
The **Route** button draws walking directions from OpenStreetMap routing. If that service is unavailable, the app doesn't just draw a straight line. It plans a way there that passes other Q-Sense restaurants, the shortest chain of walkable legs between known locations.

*How it works.* `api/utils/informedSearch.js`, `GET /api/restaurant/route`. Restaurants and the guest are nodes in a graph, with edges between points within walking range weighted by distance in km. **A\*** finds the shortest path, using straight-line distance to the destination as its heuristic. Edge costs are straight-line distances too, so the heuristic is consistent and A* is guaranteed optimal. **Uniform-cost** and **greedy best-first** search run on the same graph for comparison (`?algorithm=compare`). On the real data, all three find the same 5.37 km route to Copper Chimney via Veranda Bandra, but UCS explores 6 places and A* explores 2. **BFS/DFS** (`api/utils/graphSearch.js`, `GET /api/restaurant/reachable`) answer "what can I reach within N walkable hops?".

Limitation: edges are straight lines between restaurants, not streets. That's why this is the fallback and OSRM is the primary route.

### Natural-language search
`POST /api/chatbots/search` with `{ "query": "somewhere quick for 2 people" }`. Gemini only turns the text into filters (`party_size`, `max_wait_minutes`, `keyword`); the filtering itself is SQL. The party-size filter keeps only restaurants with a **free table big enough for that party**. Waits come from the same prediction the queue page uses.

---

## 2. Waiting in the queue

**On the waitlist screen** (`JoinQueue.html`), guests see their position, an estimated wait, and a game to pass the time.

### Estimated wait
The estimate accounts for your party size, the parties ahead, which tables are free, and the time of day, not a fixed 5 minutes per party.

*How it works.* A **decision tree** (`DecisionTreeRegressor`), trained by `src/models/train_model.py` and served by the FastAPI service (`GET /api/predict`, port 8000). Its inputs are party size, parties ahead, free tables, hour, and day of week. Express calls it from `GET /api/queue/status` and the chat assistant. If the service is down, both fall back to 5 minutes per party ahead, and the response says which was used (`estimate_source`). Tree depth and leaf size are chosen by 5-fold cross-validation, and each training run records its accuracy against the old 5-minutes-per-party rule in `models/wait_time_model.json`.

What it learned is realistic. With no free tables, a longer queue means a longer wait. With free tables but a long queue, a party of 2 is often seated at once, because the people waiting are groups that don't fit those tables. Big parties wait longest, because they compete for the few big tables.

**The training data is simulated for now. Please read [Setup and data](#7-setup-and-data).**

### A game while you wait
Tic-tac-toe with **Easy** and **Hard** levels.

*How it works.* **Hard** searches the entire game tree with **minimax and alpha-beta pruning**. It never loses, so a draw is the best a guest can manage. **Easy** runs the same search but only one move ahead. It still takes a win and blocks an obvious threat, but it can't see a fork coming, and it picks randomly between equally good moves so games vary. The tests check that alpha-beta always returns the same move as plain minimax with fewer positions examined, that Hard survives every possible guest strategy, and that Easy can be forked.

---

## 3. Seating guests

This is where the product earns its keep. A table is wasted if a pair sits at a 6-seater while a family of five waits.

### The seating rule
Every party gets **the smallest free table that fits**. A pair gets a 2-seater; if none is free, a 4-seater; a 6-seater only if no 2- or 4-seater is free. The same rule applies everywhere a table is chosen:
- **Walk-ins, automatically.** While the dashboard is open, guests who have waited at least a minute are seated every 30 seconds (`POST /api/queue/auto-allocate/:id`). This pauses while staff are reviewing a seating plan.
- **Walk-ins, one at a time.** Pressing **Seated** on a guest gives them the smallest free table that fits and marks it occupied. If nothing fits, staff can still seat them without a table (at the bar, say).
- **Walk-ins, on demand.** **Plan seating** on the dashboard's Walk-in queue tab shows the proposed seats. **Seat these guests** applies *exactly* that plan. If the queue changed in the meantime (someone left, a table was taken, a smaller table freed up), the server refuses and the dashboard shows an updated plan.
- **Reservations, automatically.** **Assign next booking** gives the next upcoming booking the best-fitting table (`POST /api/admin/reservations/auto-allocate/:id`). Bookings more than two hours in the past are skipped.
- **Reservations, by hand.** On the floor plan, the best-fit table is preselected and marked, and tables that are too small are greyed out. The server rejects a table that's too small, and if a smaller one would fit it suggests that instead. Staff can still insist when they have a reason, such as a table being held. A booking that is cancelled, already has a table, or belongs to another restaurant can't be given one.

Every path breaks ties the same way, by the lowest table number, compared numerically so T2 comes before T10.

The layouts in the demo data now differ per restaurant (`scripts/seed_table_layouts.sql`): a couples-oriented café has more 2-seaters, a family restaurant more 6s and 8s, and so on.

### Seating everyone at once
Seating one party at a time in arrival order can box you in. In the built-in example, a pair takes a 4-seater and a party of three takes a 6-seater, leaving a party of five with nowhere to sit. **Plan seating** considers everyone waiting together. It seats as many guests as possible, keeps empty seats to a minimum, prefers those who have waited longest when not everyone fits, and never breaks the seating rule. The dashboard shows the plan in plain terms: "11 guests at 4 tables · 3 empty seats · seats 2 more guests than seating strictly in arrival order".

*How it works* (`api/utils/tableAllocation.js`, `planSeating`). Seating is modelled as a **constraint satisfaction problem**. Each waiting party is a variable, its domain is the free tables it fits plus "keep waiting", and the constraints are one party per table and the seating rule. Three techniques split the work:
1. **Exact search.** Backtracking with most-constrained-party-first (MRV), least-constraining-table-first (LCV), forward checking and branch-and-bound. It gets a 250 ms budget. A normal queue finishes in milliseconds, and the plan is provably the best. Its tests compare it against brute force on random queues.
2. **Evolutionary search.** If the queue is too large to search exhaustively within the time budget, a **genetic algorithm** explores widely. Its starting plans are "what if they'd arrived in a different order" variants, and crossover and mutation combine them.
3. **Local polishing.** **Hill climbing** then applies single moves and swaps to the GA's best plan.

The best plan from any path wins. On typical queues, exact search solves everything. On a 25-party stress test, the exact search's partial result (293) edged out the polished GA plan (297), and both beat seating in arrival order (317). The whole planner took about a third of a second. The GA is a safety net for very large queues, not the usual winner. Hill climbing on its own gets stuck: on the built-in example it stops on a plateau at the arrival-order plan, because the better plan needs someone to wait longer first. That's why it's used only to polish.

Scoring, which all three share: empty seats + 10 per guest left waiting + 0.5 per minute that guest has already waited. Ties go to the plan that spreads empty seats evenly, so a pair and a four with a 4- and a 6-seater free get 4→pair and 6→four. `POST /api/queue/optimize/:id` with `algorithm: "compare"`, or `POST /api/queue/optimize/demo` (no DB, no auth), runs each technique separately for testing.

---

## 4. Reservations

Customers book from the reservation page or ask the chat assistant. Both go through the same checks (`api/utils/bookings.js`):
- the restaurant must be open
- the party must be 1–20 people and fit the restaurant's largest table
- the time must not have passed, judged on the restaurant's clock

Customers see and cancel their **upcoming** bookings from their Dashboard. Under **All reservations**, staff mark a booking **Arrived** (its table becomes occupied), **Completed**, or a **No-show** (`PATCH /api/reservations/:id/status`). Bookings whose time has passed carry a "past" label, so leftovers are easy to close. No-shows feed the customer summary below. Whenever a booking ends that way, its table is released automatically, so a cancelled booking no longer leaves a table stuck as "reserved". Existing databases need `scripts/migrate_no_show_status.sql` for the `no_show` status.

Reservation auto-allocation still assigns one reservation at a time, using the seating rule. Batch-planning reservations against the tables free *now* would be wrong, because reservations are for future times. Doing it properly needs table availability tracked per time slot.

---

## 5. Planning staff

### Busy times
The **Busy Times** tab shows when guests actually arrive, with a line like "Plan your fullest shift for 19:30–21:35, when 51% of guests arrive".

*How it works.* **K-means clustering** (`api/utils/kmeans.js`, `GET /api/admin/analytics/peak-hours/:id`, admin JWT) over the time of day of 90 days of bookings and walk-ins. Times are placed on a 24-hour circle, so a late-night window like 23:18–00:10 stays one group instead of splitting at midnight. The number of windows is chosen automatically by silhouette score (the `k` parameter overrides it). Times are converted to local time with `RESTAURANT_TZ`; otherwise Supabase's UTC would put the dinner rush at 14:30.

### Customer summary
`GET /api/admin/customer-summary/:customerId` (admin JWT) computes real booking stats (no-show rate, average party size, queue behaviour), and Gemini turns them into a two-line note for staff. Staff only see guests who have booked or queued at *their* restaurant, and the stats cover that restaurant only.

---

## 6. The chat assistant

- `POST /api/chatbots/message`: questions about bookings and the queue. Queue position and wait now come from the real queue and the wait prediction. Before this fix, position was always reported as 1.
- `POST /api/chatbots/action`: "book a table for 4 at Copper Chimney tomorrow at 8" actually books it, using Gemini function calling and the same checks as the booking page. Requires a logged-in customer, and asks for missing details instead of guessing. Gemini is told today's date on the restaurant's clock, so "tonight" and "tomorrow" resolve correctly. `npm run check:gemini` tests this live against the API without touching the database.

---

## 7. Setup and data

```bash
npm install && pip install -r requirements.txt
npm start                # Express on :5000
npm run ml:serve         # FastAPI wait predictions on :8000 (optional; falls back without it)
npm test                 # unit tests for the planners, search, rules, clustering, game
python -m pytest tests/test_prediction.py
```

| Variable | Default | Used for |
|---|---|---|
| `GEMINI_API_KEY` | — | chat assistant, NL search, explanations, customer summary |
| `ML_API_URL` | `http://localhost:8000` | wait predictions |
| `RESTAURANT_TZ` | `Asia/Kolkata` | busy times, wait-model hour/day |

### Wait-time training data (important)
Until now the database never recorded **when a party was seated**, so there is no real wait history to learn from. Two pieces fix that:

1. **Start recording.** Run `scripts/migrate_ml_features.sql` in the Supabase SQL editor. It adds `queue.seated_at`, and it captures the queue length and free tables at the moment each party joins (these can't be reconstructed later). Until you run it, the app works exactly as before; it just doesn't record.
2. **Until then, simulate.** `scripts/simulate_wait_data.py` is a discrete-event simulation of a restaurant: arrivals peak at lunch and dinner, tables turn over realistically, seating uses the same smallest-fit rule, and people walk away from very long queues. `npm run ml:train` uses real history once there are 300+ rows and the simulation before that, and records which one it used (`data_source`).

On simulated data the tree is off by **6.3 minutes on average vs. 13.0** for the old rule. That shows it learns how a queue behaves. It says nothing yet about accuracy at your restaurants.

### Schema changes
- `scripts/migrate_no_show_status.sql`: `no_show` reservation status.
- `scripts/migrate_ml_features.sql`: wait-time training data (above).
- `scripts/seed_table_layouts.sql`: per-restaurant table sizes (already applied to the current database).

### Who can do what
Every route that reads or changes someone's data checks the login token (`api/utils/auth.js`):

| Who | Can |
|---|---|
| Anyone | Browse restaurants, table layouts, recommendations and directions; log in and sign up |
| A customer | Their own profile, bookings (create/cancel upcoming), queue ticket, location |
| Staff | Their own restaurant only: queue, reservations, seating, table status, busy times, and summaries of guests who visited |

Identity always comes from the token, never from an ID in the request body. The frontend's shared helpers (`frontend/js/api.js`: `customerFetch`, `adminFetch`) send the token and return to the right login page when it expires. All user-supplied text (names, phone numbers) is HTML-escaped before it's shown.

### Known gaps
- The live database differs from `scripts/init_db.py`: it has no `created_at` columns (and `restaurant` has an unused `wait_time`). The code, including the Python ORM models, doesn't rely on `created_at`. A fresh install from `init_db.py` gets the extra columns, which is harmless.
- When a walk-in party leaves, staff free its table on the floor plan. The app doesn't track that automatically, because the queue table doesn't record which table a walk-in got.
- Past bookings aren't closed automatically; staff close them under **All reservations** (they're labelled "past").

---

## Technique index

For readers mapping the product back to AI coursework:

| Technique | Where it's used | Code |
|---|---|---|
| BFS, DFS | Reachable restaurants within N walkable hops | `api/utils/graphSearch.js` |
| Uniform-cost, greedy best-first, A* | Directions fallback via restaurants | `api/utils/informedSearch.js` |
| CSP: backtracking, MRV, LCV, forward checking | Seating plan (exact) | `tableAllocation.js` → `solveCSP` |
| Genetic algorithm | Seating plan for very large queues | `tableAllocation.js` → `geneticAlgorithm` |
| Hill climbing (local optima, plateaus) | Polishing the GA's seating plan | `tableAllocation.js` → `hillClimb` |
| Minimax, alpha-beta pruning | Waitlist game, Hard (full depth) and Easy (depth-limited) | `frontend/js/tictactoe.js` |
| Propositional/first-order rules, forward & backward chaining, resolution | Recommended for you | `api/utils/expertSystem.js` |
| Expert system architecture and limitations | Recommended for you | [expert-system.md](expert-system.md) |
| Decision tree (supervised learning) | Estimated wait | `src/models/train_model.py` |
| K-means (unsupervised learning) | Busy times | `api/utils/kmeans.js` |
| LLM function calling / extraction | Chat assistant, NL search, summaries | `api/routes/chatbots.js`, `admin.js` |
