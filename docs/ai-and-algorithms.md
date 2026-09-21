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
