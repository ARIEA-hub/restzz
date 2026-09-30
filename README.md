# restzz: Restaurant Queue & Reservation Platform

A full-stack restaurant operations platform that runs the front door end to end: guests find a place, join the live waitlist or book, and staff seat them. Throughout, AI does the work behind the scenes, so waits are predicted rather than guessed and tables are matched to party sizes.

## What it does
**For guests**
- **Find a restaurant.** A live map with *Recommended for you* picks for your party size, each with plain reasons ("✓ Table for 4 free now · ✓ No queue").
- **Join the waitlist.** See your position and an estimated wait predicted from the queue, free tables and time of day, plus a quick game to pass the time.
- **Book a table.** Book on the web or just ask the chat assistant ("a table for 4 at Copper Chimney tonight at 8"), and cancel from your dashboard if plans change.
- **Get there.** Walking directions, with a fallback route past other restaurants when street routing is unavailable.

**For staff**
- **Seat guests.** Every party gets the smallest free table that fits: a pair gets a 2-seater, else a 4, never a 6 while a 4 is free. *Plan seating* seats the whole queue at once so nobody is boxed out.
- **Floor plan.** Live table status, with the best-fit table preselected when assigning a reservation.
- **Busy times.** When guests actually arrive, so shifts and prep match the rush.
- **Customer notes.** Booking history and no-show rate, summarised in two lines.

**Platform:** customer signup with email OTP verification and password reset, admin accounts, multi-location support.

## How it works
Each feature is backed by the technique that suits it:

| Feature | Under the hood |
|---|---|
| Estimated wait | Decision tree (scikit-learn) served by FastAPI, falling back to a rule |
| Seating plan | Constraint satisfaction with exact backtracking search; genetic algorithm + hill climbing for very large queues |
| Recommended for you | Rule-based expert system (forward/backward chaining) with an explanation of each pick |
| Directions fallback, reachability | A* / uniform-cost / BFS search over a restaurant graph |
| Busy times | K-means clustering of arrival times |
| Waitlist game | Minimax with alpha-beta pruning (Easy = limited look-ahead) |
| Chat assistant, NL search | Gemini function calling over the app's own data |

Details for every step of the guest and staff journey are in **[docs/how-it-works.md](docs/how-it-works.md)**.

## Tech Stack
- **Backend:** Node.js/Express (main API), FastAPI (wait predictions), Supabase (PostgreSQL)
- **Frontend:** JavaScript, HTML/CSS, Leaflet maps
- **ML/AI:** scikit-learn, Google Gemini
- **Auth/Comms:** JWT, OTP verification, Nodemailer/SMTP

## Running it
```bash
npm install && pip install -r requirements.txt
npm start            # Express API on :5000
npm run ml:serve     # FastAPI ML service on :8000 (optional; wait times fall back to a rule without it)
npm test             # unit tests (seating, search, recommendations, clustering, game)
python -m pytest tests/test_prediction.py
```
For an existing database, run `scripts/migrate_ml_features.sql` in the Supabase SQL editor so the app starts recording real wait-time training data.

## Architecture
Migrated from MySQL to Supabase PostgreSQL for improved reliability and hosted database management. The backend exposes REST APIs for restaurants, reservations, and locations, with a prediction endpoint serving the trained wait-time model directly to the frontend and admin dashboard.

## About
Built by [Ariea Sampat](https://www.linkedin.com/in/ariea-sampat) — Computer Engineering & MBA student, NMIMS MPSTME.
