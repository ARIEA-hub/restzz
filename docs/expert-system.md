# The "Recommended for you" expert system

`api/utils/expertSystem.js` · `GET /api/restaurant/expert-recommend` · the *Recommended for you* panel on `locations.html`

Guests pick a party size and get the best places to go right now, each with short reasons ("✓ Table for 4 free now · ✓ No queue · ✓ 0.2 km, walkable"). Behind that panel is a small rule-based expert system. It is not a scoring formula in disguise: every conclusion is derived by rules, and the reasons shown are built from what those rules actually derived.

## Architecture

```
 live data (queue, tables, location)
        │  assertFacts()  — thresholds turn numbers into symbols
        ▼
 ┌──────────────────┐     ┌───────────────────────────┐
 │  Knowledge base  │     │  Inference engine         │
 │  • 13 Horn rules │────▶│  • forwardChain()  (data-driven, to fixpoint)
 │  • base facts    │     │  • backwardChain() (goal-driven, "why not?")
 └──────────────────┘     │  • resolutionProve() (refutation)
                          └─────────────┬─────────────┘
                                        ▼
                          Explanation facility: every derived fact
                          records {rule, premises}; base facts cite
                          the number they came from.
```

### Knowledge base

**Representation.** Rules are first-order Horn clauses, universally quantified over a restaurant `R`:

```
∀R  has_vacant_table(R) ∧ fits_party(R) → can_seat_now(R)          (R1)
∀R  quick_seating(R) ∧ nearby(R)       → recommend_strongly(R)     (R6)
```

The system grounds them once per restaurant, so within one restaurant's reasoning each atom is a propositional symbol. Running the same rule base for every restaurant plays the role of the universal quantifier. The full rule list is `RULES` in the source, and the API also returns it.

**Facts** come from live data through fixed thresholds (`THRESHOLDS`): walking distance ≤ 1.2 km (the same radius BFS/DFS use), short drive ≤ 5 km, small queue ≤ 3 parties, long queue ≥ 8.

**Handling negation.** Horn clauses can't express "no table fits". The system asserts two separate positive facts instead, `table_size_ok` and `no_table_fits`. When no table data exists, it asserts neither, so the fact is treated as *unknown* rather than false. Without this, R7 ("short wait and nearby → recommend") could recommend a place that can never seat the party, while R12 says to avoid it.

### Inference engine

| Method | Direction | Used for |
|---|---|---|
| `forwardChain` | Data → conclusions. Fires every rule whose premises hold until nothing new is derived (fixpoint). | The recommendation and its trail. |
| `backwardChain` | Goal → premises. Tries each rule concluding the goal and recursively proves its premises. | "Why isn't this a top pick?" Returns the premises that are missing. |
| `resolutionProve` | Refutation. Turns rules into clauses (`p∧q→r` becomes `{¬p,¬q,r}`), adds `¬goal`, and resolves until it derives `{}`. | Formal proof; the tests check it agrees with forward chaining on every goal. |

The final conclusion is the strongest positive one derived: `recommend_strongly` > `recommend`. `avoid` applies only if nothing positive was derived, and `consider` is the fallback when no conclusion is reached.

### Explanation facility

Two audiences get the same reasoning at different levels of detail. Guests see `highlights`: short ✓/✕ points written from the *derived* facts (for example `can_seat_now` becomes "Table for 4 free now"), so the explanation can never disagree with the decision. Developers get the full trail. A response for one restaurant (trimmed):

```json
{
  "name": "Foo Bandra",
  "conclusion": "recommend_strongly",
  "base_facts": [
    { "atom": "has_vacant_table", "detail": "5 vacant table(s)" },
    { "atom": "no_queue", "detail": "queue is empty" },
    { "atom": "walking_distance", "detail": "0.15 km away" }
  ],
  "derived": [
    { "rule": "R1", "premises": ["has_vacant_table", "fits_party"], "conclusion": "can_seat_now" },
    { "rule": "R6", "premises": ["quick_seating", "nearby"], "conclusion": "recommend_strongly" }
  ],
  "why_not_strong": null,
  "highlights": [
    { "good": true, "text": "Table for 4 free now" },
    { "good": true, "text": "No queue" },
    { "good": true, "text": "0.2 km, walkable" }
  ]
}
```

## Limitations (the honest list)

- **Crisp thresholds.** A restaurant 1.19 km away is "nearby" and one 1.21 km away is not. Real expertise is graded; fuzzy logic or certainty factors (as in MYCIN) would handle this better.
- **Hand-written knowledge.** The rules encode one person's judgement about what makes a good pick. That is the knowledge-acquisition bottleneck: nothing learns or corrects these rules from outcomes.
- **No negation or defaults.** Horn clauses can't say "unless…". The `table_size_ok`/`no_table_fits` pair works around one case, but a larger rule base would need negation-as-failure or priorities.
- **Brittleness.** Situations the rules don't cover, such as a restaurant closing in 20 minutes or a reserved-only table, end up as `consider` instead of degrading gracefully.
- **No conflict resolution beyond ranking.** If two rules ever derived both `recommend` and `avoid`, the ranking picks one. The current rules are written so this can't happen. The test "a party no table can seat is never recommended" guards the one case where it could.
- **Resolution scales poorly.** It's included to demonstrate the proof method. Forward chaining is what the endpoint actually uses.
