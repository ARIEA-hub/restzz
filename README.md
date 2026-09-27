# restzz — AI-Powered Restaurant Queue & Reservation Platform

A full-stack restaurant operations platform combining machine learning wait-time prediction with AI-driven table allocation — built to handle real restaurant workflows end-to-end, from customer signup to admin-side queue management.

## Key Features
- **Decision-tree wait-time prediction** (Scikit-learn), served by FastAPI with a rule-based fallback
- **Batch table allocation as a CSP**, compared live against hill climbing and a genetic algorithm
- **A\* / UCS / Greedy route search** and BFS/DFS reachability between restaurants
- **Rule-based expert system** ("Smart pick") using forward/backward chaining and resolution, with a full explanation trail
- **K-means peak-hour analytics** for admins
- **Tic-tac-toe vs. a minimax / alpha-beta AI** to pass the time while queuing

See [docs/ai-and-algorithms.md](docs/ai-and-algorithms.md) for how each feature works and where it lives.
- **Full authentication flow** — customer signup, email OTP verification, and password reset (via SMTP/Nodemailer)
- **Integrated chatbot** for queue operations and customer interaction
- **Admin dashboard** for real-time restaurant and reservation management
- **Multi-location support** — restaurant and reservation APIs designed for multiple outlets

## Tech Stack
- **Backend:** FastAPI (Python), Supabase (PostgreSQL)
- **Frontend:** JavaScript, HTML/CSS
- **ML:** Scikit-learn
- **Auth/Comms:** OTP verification, Nodemailer/SMTP

## Running it
```bash
npm install && pip install -r requirements.txt
npm start            # Express API on :5000
npm run ml:serve     # FastAPI ML service on :8000 (optional; wait times fall back to a rule without it)
npm test             # algorithm unit tests
python -m pytest tests/test_prediction.py
```
For an existing database, run `scripts/migrate_ml_features.sql` in the Supabase SQL editor so the app starts recording real wait-time training data.

## Architecture
Migrated from MySQL to Supabase PostgreSQL for improved reliability and hosted database management. The backend exposes REST APIs for restaurants, reservations, and locations, with a prediction endpoint serving the trained wait-time model directly to the frontend and admin dashboard.

## About
Built by [Ariea Sampat](https://www.linkedin.com/in/ariea-sampat) — Computer Engineering & MBA student, NMIMS MPSTME.
