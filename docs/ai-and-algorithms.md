# AI & Algorithms — what was added and how to use it

Six features, split into two categories: things that need `GEMINI_API_KEY`,
and things that are plain deterministic algorithms and need no API key at all.

## Gemini-powered (needs `GEMINI_API_KEY` in `.env`)

### 1. Chatbot can now act, not just answer — `POST /api/chatbots/action`
Requires a logged-in customer (`Authorization: Bearer <token>`).

```json
// Request
{ "message": "book a table for 4 at Copper Chimney tonight at 8pm" }

// Response (success)
{ "reply": "Booked! A table for 4 at Copper Chimney on 2026-09-19 at 20:00.",
  "action": { "type": "book_table", "restaurant_id": 3 } }

// Response (missing info — Gemini asks instead of guessing)
{ "reply": "To book at Copper Chimney, I still need the date, time.", "action": null }
```
Also supports `join_queue`. Kept as a **separate endpoint** from the existing
`/message` (pure Q&A) so this newer, harder-to-fully-verify-offline path
can't destabilize what's already working. **Not yet tested against a live
API key in this environment** (no network access here) — test the actual
function-calling response shape before relying on it; `@google/genai`'s
exact response structure can shift slightly between SDK versions.

### 2. Natural-language search — `POST /api/chatbots/search`
```json
// Request
{ "query": "somewhere quick for 2 people", "lat": 19.06, "lng": 72.83 }

// Response
{ "filters": { "party_size": 2, "max_wait_minutes": 15, "keyword": null },
  "results": [ /* real restaurants matching those filters, ranked by convenience if lat/lng given */ ] }
```
Gemini only parses the free-text into structured filters — every filter
maps to a column that actually exists (no `cuisine`, since that column
doesn't exist in `restaurant`). The actual filtering is plain SQL/JS.

### 3. "Why this pick?" explanations — `GET /api/restaurant/recommended?...&explain=true`
Adds one extra Gemini call (only for the #1 result, not the whole list) that
narrates the real computed distance/wait numbers in one sentence. Never
fails the whole request if the explanation call fails — falls back to
`explanation: null`.

### 4. Admin customer-behavior summary — `GET /api/admin/customer-summary/:customerId`
Requires an admin JWT. Computes real stats (total reservations, no-show
rate, average party size, queue behavior) and asks Gemini to narrate them
in plain English. **Needed a schema change to be meaningful** — see below.

---

## Classical algorithms (no API key needed)

### 5. Convenience ranking — `GET /api/restaurant/recommended?lat=&lng=&limit=`
`api/utils/scoring.js`. Weighted score combining real distance (haversine)
and real estimated wait (`waiting_count * 5`, the same formula `queue.js`
already used) — lower score wins. This is the actual answer to "predict the
most convenient choice," not the chatbot.

### 6. BFS/DFS reachability — `GET /api/restaurant/reachable?lat=&lng=&algorithm=bfs|dfs`
`api/utils/graphSearch.js`. Real union-find-free BFS/DFS over a graph where
an edge connects two points within walking distance of each other.

**Honest limitation:** edges are straight-line distance, not real
road/sidewalk routing. True road-network BFS needs an actual routing graph
(e.g. from OpenStreetMap way data via a routing engine like OSRM) — a
meaningfully bigger integration than this. If that's added later, only
`buildProximityGraph()` needs to change; `bfs()`/`dfs()` work on any graph
shape.

---

## Schema change required

`no_show` is now a valid `reservation.status` value (previously only
`reserved/seated/cancelled/completed` existed — there was no way to ever
record a no-show, which made stat #4 above permanently show 0%).

- **Fresh installs:** already included in `scripts/init_db.py`.
- **Existing databases:** run `scripts/migrate_no_show_status.sql` in
  Supabase SQL Editor.
- New endpoint to actually set it: `PATCH /api/reservations/:id/status`
  (body: `{ "status": "no_show" }`, or any of the other valid statuses).

## Known gap, not introduced by this round

Most existing admin routes have no JWT verification at all — the frontend
hides the UI, but the API itself would accept an unauthenticated request.
The **new** `customer-summary` endpoint added real verification since it's
new code, but it's currently the exception, not the rule. Worth a dedicated
pass to add the same protection to the rest of `admin.js`.

---

# Round 2: syllabus algorithms

Every item below is covered by `npm test` (`tests/js/algorithms.test.js`) or `pytest tests/test_prediction.py`.

| Syllabus topic | Where | Endpoint / UI |
|---|---|---|
| BFS, DFS | `api/utils/graphSearch.js` | `GET /api/restaurant/reachable` (round 1) |
| Uniform Cost, Greedy Best-First, A* | `api/utils/informedSearch.js` | `GET /api/restaurant/route` · "Hop route (A*)" on Locations |
| CSP (backtracking, MRV, LCV, forward checking) | `api/utils/tableAllocation.js` → `solveCSP` | `POST /api/queue/auto-allocate/:id` (now batch CSP) · Admin → Optimizer |
| Hill climbing (local optimum / plateau / ridge) | `tableAllocation.js` → `hillClimb` | `POST /api/queue/optimize/...` · Admin → Optimizer |
| Genetic algorithm | `tableAllocation.js` → `geneticAlgorithm` | same |
| Minimax, alpha-beta pruning | `frontend/js/tictactoe.js` | Tic-tac-toe on the queue screen (`JoinQueue.html`) |
| Propositional/FOL, forward & backward chaining, resolution | `api/utils/expertSystem.js` | `GET /api/restaurant/expert-recommend` · "Smart pick" on Locations |
| Expert systems | same; write-up in [`expert-system.md`](expert-system.md) | n/a |
| Decision trees (supervised) | `src/models/train_model.py` | FastAPI `GET /api/predict`, called by `GET /api/queue/status` |
| K-means (unsupervised) | `api/utils/kmeans.js` | `GET /api/admin/analytics/peak-hours/:id` · Admin → Peak Hours |

## Search: UCS vs. Greedy vs. A*

This uses the same proximity graph as BFS/DFS, except that each edge is weighted by its haversine distance in km. The heuristic is straight-line distance to the goal. Because edge costs are also straight-line distances, the heuristic is **consistent**, so A* with a closed set is optimal.

```
GET /api/restaurant/route?lat=19.06&lng=72.835&to=3&algorithm=compare&walk_km=5
```

On the real seed data, all three algorithms route to Copper Chimney as You → Veranda Bandra → Copper Chimney (5.37 km). **UCS expands 6 nodes; A\* and Greedy expand 2.** The unit test uses a textbook graph where Greedy commits to a path costing 10 while A* and UCS find the optimum of 6. The limitation is the same as BFS/DFS: edges are straight lines, not streets.

## Table allocation: CSP vs. hill climbing vs. GA

All three share one cost function, so their results are directly comparable:
`wasted seats + 10 × each unseated guest + 0.5 × minutes that unseated party has waited`.
The seat penalty dominates, so seating one more person always beats saving empty chairs. The wait term keeps early arrivals from being starved.

- **CSP.** One variable per party. Each domain is the tables that fit the party, plus "unseated". Forward checking enforces the all-different constraint, MRV orders the variables, and LCV orders the values. Branch-and-bound, seeded with the greedy answer, makes it an exact optimizer. The tests check it against brute force on 40 random instances.
- **Hill climbing.** Starts from the old greedy rule. Neighbours are *move to a free table* and *swap two seated parties*. It cannot "bump" (unseat A so B can sit), because that move makes the cost worse before it gets better. The result reports whether it stopped at a `local_optimum` or a `plateau`.
- **GA.** The chromosome is the assignment array. It uses tournament selection, uniform crossover, mutation, elitism, and a repair step that keeps every child valid. It is seeded, so runs are reproducible.

`POST /api/queue/optimize/demo` (no DB, no auth) runs everything on a built-in 8-party instance. The old rule and hill climbing both stop at **86.5** (hill climbing on a plateau). CSP proves **61** is optimal. The GA starts at 75 and reaches 61 at generation 22.

**`auto-allocate` behaviour changed.** It now seats *every* guest who has waited at least 1 minute in one CSP batch, instead of one guest per call. The response keeps `allocated` and `table_no` for the existing dashboard and adds `assignments[]`. The admin endpoint `POST /api/queue/optimize/:id` requires an admin JWT; sending `{algorithm, apply: true}` commits the chosen solver's result.

Reservation auto-allocation (`admin.js`) is unchanged. Reservations are for future dates and times, so batch-assigning them to tables that are vacant *now* would be wrong. Doing it properly needs table capacity tracked per time slot.

## Adversarial search: tic-tac-toe

The AI plays O as MAX. Utility is ±10, adjusted by depth so it prefers faster wins and slower losses. The UI can switch between minimax and alpha-beta and shows both node counts for every move. The tests check that alpha-beta always returns the same move and value as minimax using fewer nodes, and that perfect play from an empty board is a draw.

## Decision-tree wait-time model

**Before:** a `LinearRegression` trained on a 5-row CSV that nothing called. `GET /api/queue/status` returned `position × 5`. `api/main.py` also imported two router modules that don't exist, so the FastAPI service couldn't start.

**Now:**
- `src/models/train_model.py` trains a `DecisionTreeRegressor`, with `max_depth` and `min_samples_leaf` chosen by 5-fold CV. It reports test MAE **against the old 5-min rule** and saves `models/wait_time_model.json` containing the metrics, feature importances, and the top of the tree as readable rules.
- Features: party size, queue length, free tables, hour, day of week, and queue-per-table.
- `GET /api/queue/status` asks the FastAPI service first and falls back to the 5-min rule if the service is down. The response reports which one answered (`estimate_source: "decision_tree" | "fallback"`), and the queue page shows it in a tooltip.

**Where the training data comes from (important).** The database has never recorded when a party was seated, so it contains **zero** real wait-time labels today. Two changes address that:
1. `scripts/migrate_ml_features.sql` adds `queue.seated_at`, plus `queue_length_at_join` and `tables_vacant_at_join`, which snapshot the features at the moment a party joins. Once the migration is run, the app records them on every join and seat. The code checks whether the columns exist and behaves exactly as before until they do.
2. Until there are 300+ real rows, training uses `scripts/simulate_wait_data.py`. It is a discrete-event simulation (Poisson arrivals with lunch and dinner peaks, real table turnover, the app's own seating rule, and balking) that writes to `data/synthetic/`. The model metadata records `data_source: "synthetic"` or `"real"`.

On the simulated data, test MAE is **6.3 min vs. 13.0 min** for the old rule (R² 0.75). That shows the tree learns the queue mechanics. It does **not** yet show accuracy on real restaurants; that needs the real rows.

```bash
npm run ml:simulate      # regenerate synthetic data (seeded)
npm run ml:train         # real data if there are 300+ rows, otherwise synthetic
npm run ml:serve         # FastAPI on :8000 (Express reads ML_API_URL, default http://localhost:8000)
```

## K-means peak hours

Each booking time is placed on a 24-hour circle as `(cos θ, sin θ)` and clustered there, so a window like 23:18–00:10 stays one cluster instead of splitting at midnight. Centroids are seeded with k-means++, and **k is chosen by silhouette score** (2–5) unless `?k=` is given. Clusters are ranked by size and labelled peak, busy, or quiet. The inputs are the last 90 days of reservations (excluding cancelled) and queue joins, converted to local time using `RESTAURANT_TZ` (default `Asia/Kolkata`). Without that conversion, Supabase returns UTC and the dinner rush would show up at 14:30. Requires an admin JWT.

## New environment variables (all optional)

| Variable | Default | Used by |
|---|---|---|
| `ML_API_URL` | `http://localhost:8000` | Express → FastAPI predictions |
| `RESTAURANT_TZ` | `Asia/Kolkata` | peak-hour analytics; model hour/day features |

## Fixed along the way

- `api/main.py` imported `api.routes.reservations` and `api.routes.queue`, which don't exist, so the service could not start. It also printed a ✅ emoji at startup, which raises `UnicodeEncodeError` on Windows when stdout isn't a UTF-8 console.
- FastAPI no longer requires `DATABASE_URL` just to serve predictions.
