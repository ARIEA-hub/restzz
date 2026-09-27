# scripts/simulate_wait_data.py
#
# Discrete-event simulation of a restaurant's walk-in queue, used to
# bootstrap the wait-time model until the real database has enough
# (join -> seated) history. The output is clearly SYNTHETIC — it lives in
# data/synthetic/, and train_model.py records which source it trained on.
#
# Why a simulation rather than invented rows: every wait in the output is
# the actual outcome of a queue process (arrivals, table turnover, a real
# seating policy), so the relationships the tree learns — longer queues
# and fewer free tables mean longer waits, big parties wait for big tables,
# dinner rush is slower — emerge from the mechanics, not from a formula
# someone typed in.
#
# Model:
#   * Open 11:00–23:00. Arrivals are Poisson with an hourly rate that peaks
#     at lunch and dinner; Fri/Sat/Sun are busier.
#   * Party sizes 1–8 (mostly 2–4). Dining time grows with party size.
#   * Seating policy: the same one the app used — oldest waiting party gets
#     the smallest free table that fits; if it can't be seated, later
#     parties that DO fit a free table may go ahead (what hosts really do).
#   * Balking: a party that finds MAX_QUEUE parties already waiting walks
#     away and is never recorded (the app never sees them either).
#   * Features are captured at the moment a party joins; the label is the
#     minutes until they were seated.
#
# Usage: python scripts/simulate_wait_data.py [--days 90] [--seed 42]

import argparse
import csv
import heapq
import os
import random

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_PATH = os.path.join(PROJECT_ROOT, "data", "synthetic", "simulated_waits.csv")

TABLES = [2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 8]
OPEN_MIN, CLOSE_MIN = 11 * 60, 23 * 60

# Mean arrivals per hour, by hour of day.
HOURLY_RATE = {11: 4, 12: 11, 13: 12, 14: 6, 15: 3, 16: 3, 17: 5,
               18: 9, 19: 12, 20: 12, 21: 8, 22: 4}
DAY_MULTIPLIER = [0.8, 0.8, 0.9, 1.0, 1.25, 1.4, 1.3]  # Mon..Sun
PARTY_SIZES = [1, 2, 3, 4, 5, 6, 7, 8]
PARTY_WEIGHTS = [6, 34, 18, 24, 7, 7, 2, 2]
MAX_QUEUE = 15


def dining_minutes(rng, size):
    base = 40 + 6 * size
    return max(20, rng.gauss(base, base * 0.25))


def simulate_day(rng, dow):
    free = list(range(len(TABLES)))       # indices of vacant tables
    waiting = []                          # [(arrival_min, party_id, size)] in arrival order
    events = []                           # heap of (time, kind, payload)
    rows = []
    features = {}

    # Generate arrivals hour by hour (piecewise-constant Poisson process).
    pid = 0
    for hour, rate in HOURLY_RATE.items():
        lam = rate * DAY_MULTIPLIER[dow] / 60.0
        t = hour * 60 + rng.expovariate(lam)
        while t < (hour + 1) * 60 and t < CLOSE_MIN:
            size = rng.choices(PARTY_SIZES, PARTY_WEIGHTS)[0]
            heapq.heappush(events, (t, 1, (pid, size)))
            pid += 1
            t += rng.expovariate(lam)

    def try_seat(now):
        # Oldest first; parties that can't be seated are skipped, not blocking.
        for entry in list(waiting):
            arrival, p, size = entry
            fits = [i for i in free if TABLES[i] >= size]
            if not fits:
                continue
            table = min(fits, key=lambda i: TABLES[i])
            free.remove(table)
            waiting.remove(entry)
            heapq.heappush(events, (now + dining_minutes(rng, size), 0, table))
            f = features.pop(p)
            f["wait_time"] = round(now - arrival, 1)
            rows.append(f)

    # kind 0 = table frees up, 1 = arrival. Departures sort first at equal times.
    while events:
        now, kind, payload = heapq.heappop(events)
        if kind == 0:
            free.append(payload)
        else:
            p, size = payload
            if len(waiting) >= MAX_QUEUE:
                continue
            features[p] = {
                "day_of_week": dow,
                "hour_of_day": int(now // 60),
                "party_size": size,
                "queue_length": len(waiting),
                "tables_available": len(free),
            }
            waiting.append((now, p, size))
        try_seat(now)
    # Parties still waiting at close are dropped (they never got a label).
    return rows


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--days", type=int, default=90)
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()

    rng = random.Random(args.seed)
    rows = []
    for day in range(args.days):
        rows.extend(simulate_day(rng, day % 7))

    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)

    waits = [r["wait_time"] for r in rows]
    print(f"Simulated {args.days} days -> {len(rows)} parties -> {OUT_PATH}")
    print(f"  mean wait {sum(waits) / len(waits):.1f} min, max {max(waits):.1f} min, "
          f"{sum(w == 0 for w in waits) / len(waits):.0%} seated immediately")


if __name__ == "__main__":
    main()
