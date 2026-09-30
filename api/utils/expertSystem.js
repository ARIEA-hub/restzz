// api/utils/expertSystem.js
//
// "Recommended for you" on the Locations page: which restaurant suits this
// party right now, and why. It's a small rule-based expert system
// (write-up: docs/expert-system.md):
//
//   Knowledge base  = RULES (Horn clauses, universally quantified over a
//                     restaurant R) + FACTS asserted from live data.
//   Inference engine= forwardChain() — data-driven: fire every rule whose
//                     premises all hold until nothing new can be derived
//                     (fixpoint). Also backwardChain() — goal-driven: "can I
//                     prove recommend_strongly(R)?" — and resolution
//                     refutation, which proves a goal by adding its negation
//                     to the clause set and deriving the empty clause.
//   Explanation     = every derived fact records the rule and premises that
//   facility          produced it, so the answer to "why?" is the actual
//                     inference trail, not a narrated guess.
//
// Representation: first-order rules like
//     ∀R  has_vacant_table(R) ∧ fits_party(R) → can_seat_now(R)
// are grounded per restaurant, so inside one restaurant's reasoning every
// atom is a propositional symbol ("has_vacant_table"). The quantifier is
// implicit in running the same rule base once for each restaurant.

// ── Knowledge base: rules ────────────────────────────────────────────
// `if` is a conjunction of atoms; `then` is a single atom (Horn clause).
const RULES = [
    { id: 'R1', if: ['has_vacant_table', 'fits_party'], then: 'can_seat_now',
      text: 'A vacant table big enough for the party means they can be seated right away' },
    { id: 'R2', if: ['no_queue'], then: 'short_wait',
      text: 'Nobody waiting means a short wait' },
    { id: 'R3', if: ['small_queue', 'has_vacant_table'], then: 'short_wait',
      text: 'A small queue with free tables still turns over quickly' },
    { id: 'R4', if: ['walking_distance'], then: 'nearby',
      text: 'Within walking distance counts as nearby' },
    { id: 'R5', if: ['can_seat_now', 'short_wait'], then: 'quick_seating',
      text: 'Seatable now with a short wait means quick seating' },
    { id: 'R6', if: ['quick_seating', 'nearby'], then: 'recommend_strongly',
      text: 'Quick seating close by is the best possible pick' },
    { id: 'R7', if: ['short_wait', 'nearby', 'table_size_ok'], then: 'recommend',
      text: 'Short wait close by is a good pick even if a table must free up first' },
    { id: 'R8', if: ['quick_seating', 'short_drive'], then: 'recommend',
      text: 'Quick seating a short trip away is worth the travel' },
    { id: 'R9', if: ['recommend_strongly'], then: 'recommend',
      text: 'A strong recommendation is also a recommendation' },
    { id: 'R10', if: ['long_queue'], then: 'long_wait',
      text: 'A long queue means a long wait' },
    { id: 'R11', if: ['no_table_fits'], then: 'party_mismatch',
      text: 'No table in the restaurant can ever fit this party size' },
    { id: 'R12', if: ['party_mismatch'], then: 'avoid',
      text: 'Avoid places that cannot seat the party at all' },
    { id: 'R13', if: ['long_wait', 'far'], then: 'avoid',
      text: 'A long wait AND a long trip is not worth it' }
];

const CONCLUSION_RANK = { recommend_strongly: 3, recommend: 2, consider: 1, avoid: 0 };

// Thresholds turning raw numbers into symbolic facts.
const THRESHOLDS = {
    walkingKm: 1.2,      // same walking radius graphSearch.js uses
    shortDriveKm: 5,
    smallQueue: 3,       // parties waiting
    longQueue: 8
};

/**
 * Converts one restaurant's live data into asserted base facts.
 * Returns a Map atom → { source: 'data', detail } so the explanation can
 * cite the actual number behind each fact.
 *
 * @param {object} r { distance_km, waiting_count, vacant_capacities: number[], all_capacities: number[] }
 * @param {number} partySize
 */
function assertFacts(r, partySize, thresholds = THRESHOLDS) {
    const facts = new Map();
    const add = (atom, detail) => facts.set(atom, { source: 'data', detail });

    const waiting = Number(r.waiting_count) || 0;
    const vacant = (r.vacant_capacities || []).map(Number);
    const all = (r.all_capacities || []).map(Number);
    const fitting = vacant.filter((c) => c >= partySize);

    if (vacant.length > 0) add('has_vacant_table', `${vacant.length} vacant table(s)`);
    if (fitting.length > 0) add('fits_party', `${fitting.length} vacant table(s) seat ${partySize}+`);
    // Horn clauses have no negation, so "some table could ever fit" and
    // "no table can fit" are asserted as two separate positive facts.
    // With no table data at all, neither is asserted (unknown).
    if (all.some((c) => c >= partySize)) add('table_size_ok', `largest table seats ${Math.max(...all)}`);
    else if (all.length > 0) add('no_table_fits', `largest table seats ${Math.max(...all)}, party is ${partySize}`);

    if (waiting === 0) add('no_queue', 'queue is empty');
    else if (waiting <= thresholds.smallQueue) add('small_queue', `${waiting} part${waiting === 1 ? 'y' : 'ies'} waiting`);
    if (waiting >= thresholds.longQueue) add('long_queue', `${waiting} parties waiting`);

    if (r.distance_km != null) {
        const d = Number(r.distance_km);
        if (d <= thresholds.walkingKm) add('walking_distance', `${d.toFixed(2)} km away`);
        else if (d <= thresholds.shortDriveKm) add('short_drive', `${d.toFixed(2)} km away`);
        else add('far', `${d.toFixed(2)} km away`);
    }
    return facts;
}

/**
 * Forward chaining to a fixpoint. Each pass fires every rule whose
 * premises are all known and whose conclusion is new.
 * @returns {{ facts: Map, trail: Array<{ rule, premises, conclusion, text }> }}
 */
function forwardChain(baseFacts, rules = RULES) {
    const facts = new Map(baseFacts);
    const trail = [];
    let changed = true;
    while (changed) {
        changed = false;
        for (const rule of rules) {
            if (facts.has(rule.then)) continue;
            if (rule.if.every((p) => facts.has(p))) {
                facts.set(rule.then, { source: 'rule', rule: rule.id });
                trail.push({ rule: rule.id, premises: rule.if, conclusion: rule.then, text: rule.text });
                changed = true;
            }
        }
    }
    return { facts, trail };
}

/**
 * Backward chaining: tries to prove `goal` from base facts by recursively
 * proving the premises of some rule that concludes it. Returns a proof tree
 * on success or a failure tree listing what was missing — which is how the
 * system answers "why NOT recommended?".
 */
function backwardChain(goal, baseFacts, rules = RULES, seen = new Set()) {
    if (baseFacts.has(goal)) return { goal, proved: true, by: 'fact', detail: baseFacts.get(goal).detail };
    if (seen.has(goal)) return { goal, proved: false, by: 'cycle' };

    const candidates = rules.filter((r) => r.then === goal);
    if (candidates.length === 0) return { goal, proved: false, by: 'no_fact_or_rule' };

    const attempts = [];
    for (const rule of candidates) {
        const nextSeen = new Set(seen).add(goal);
        const subproofs = rule.if.map((p) => backwardChain(p, baseFacts, rules, nextSeen));
        if (subproofs.every((s) => s.proved)) return { goal, proved: true, by: rule.id, text: rule.text, subproofs };
        attempts.push({ rule: rule.id, missing: subproofs.filter((s) => !s.proved).map((s) => s.goal) });
    }
    return { goal, proved: false, by: 'all_rules_failed', attempts };
}

// ── Resolution (propositional, refutation) ────────────────────────────
// Horn rule  p1 ∧ p2 → q   becomes the clause  {¬p1, ¬p2, q}.
// Fact  p  becomes  {p}.  To prove q: add {¬q}, resolve until {} appears.
const neg = (lit) => (lit.startsWith('¬') ? lit.slice(1) : `¬${lit}`);
const clauseKey = (c) => [...c].sort().join('∨');

function toClauses(baseFacts, rules = RULES) {
    return [
        ...[...baseFacts.keys()].map((f) => new Set([f])),
        ...rules.map((r) => new Set([...r.if.map(neg), r.then]))
    ];
}

function resolve(a, b) {
    const out = [];
    for (const lit of a) {
        if (b.has(neg(lit))) {
            const r = new Set([...a, ...b]);
            r.delete(lit);
            r.delete(neg(lit));
            // Skip tautologies (contain p and ¬p) — they can never help.
            if (![...r].some((l) => r.has(neg(l)))) out.push(r);
        }
    }
    return out;
}

/**
 * Resolution refutation. Returns { proved, steps } where steps is the
 * derivation that reached the empty clause (or null if none exists).
 */
function resolutionProve(goal, baseFacts, rules = RULES, { maxClauses = 5000 } = {}) {
    const clauses = [...toClauses(baseFacts, rules), new Set([neg(goal)])];
    const seen = new Set(clauses.map(clauseKey));
    const origin = new Map(clauses.map((c) => [clauseKey(c), null]));

    for (let i = 0; i < clauses.length && clauses.length < maxClauses; i++) {
        for (let j = 0; j < i; j++) {
            for (const r of resolve(clauses[i], clauses[j])) {
                const key = clauseKey(r);
                if (seen.has(key)) continue;
                seen.add(key);
                origin.set(key, [clauseKey(clauses[i]), clauseKey(clauses[j])]);
                if (r.size === 0) {
                    // Walk back from {} to list the derivation.
                    const steps = [];
                    const walk = (k) => {
                        const o = origin.get(k);
                        if (!o) return;
                        walk(o[0]); walk(o[1]);
                        steps.push({ from: o.map((x) => `{${x}}`), derived: `{${k}}` });
                    };
                    walk(key);
                    return { proved: true, steps };
                }
                clauses.push(r);
            }
        }
    }
    return { proved: false, steps: null };
}

/**
 * Runs the expert system over every restaurant and ranks them.
 * @param {Array} restaurants each with name, distance_km, waiting_count, vacant_capacities, all_capacities
 */
function recommend(restaurants, partySize, thresholds = THRESHOLDS) {
    return restaurants
        .map((r) => {
            const base = assertFacts(r, partySize, thresholds);
            const { facts, trail } = forwardChain(base);

            // Strongest positive conclusion wins; 'avoid' only if nothing
            // positive was derived; otherwise the neutral 'consider'.
            const conclusion = ['recommend_strongly', 'recommend', 'avoid'].find((c) => facts.has(c)) || 'consider';

            const whyNot = conclusion === 'recommend_strongly' ? null : backwardChain('recommend_strongly', base);

            return {
                ...r,
                conclusion,
                rank: CONCLUSION_RANK[conclusion],
                base_facts: [...base.entries()].map(([atom, v]) => ({ atom, detail: v.detail })),
                derived: trail,
                why_not_strong: whyNot && whyNot.attempts
                    ? whyNot.attempts.map((a) => ({ rule: a.rule, missing: a.missing }))
                    : null,
                highlights: highlights(r, facts, partySize),
                explanation: explain(r.name, base, trail, conclusion)
            };
        })
        .sort((a, b) => b.rank - a.rank || (a.distance_km ?? Infinity) - (b.distance_km ?? Infinity));
}

/**
 * The explanation facility in customer language: short good/bad points
 * built from what was actually derived (not from the raw numbers), so the
 * panel on the Locations page says the same thing the rules concluded.
 */
function highlights(r, facts, partySize) {
    const out = [];
    const good = (text) => out.push({ good: true, text });
    const bad = (text) => out.push({ good: false, text });
    const km = r.distance_km == null ? null : `${Number(r.distance_km).toFixed(1)} km`;
    const waiting = Number(r.waiting_count) || 0;

    if (facts.has('party_mismatch')) bad(`No table here seats ${partySize}`);
    else if (facts.has('can_seat_now')) good(`Table for ${partySize} free now`);
    else bad(`No free table for ${partySize} right now`);

    if (facts.has('long_wait')) bad(`Long queue (${waiting} parties)`);
    else if (facts.has('short_wait')) good(waiting === 0 ? 'No queue' : `Short queue (${waiting} ${waiting === 1 ? 'party' : 'parties'})`);
    else if (waiting > 0) out.push({ good: null, text: `${waiting} ${waiting === 1 ? 'party' : 'parties'} waiting` });

    if (km) {
        if (facts.has('nearby')) good(`${km}, walkable`);
        else if (facts.has('far')) bad(`${km} away`);
        else out.push({ good: null, text: `${km} away` });
    }
    return out;
}

function explain(name, base, trail, conclusion) {
    if (trail.length === 0) return `${name}: no rule fired from the known facts, so no recommendation either way.`;
    const cite = (atom) => (base.has(atom) ? `${atom} (${base.get(atom).detail})` : atom);
    const steps = trail.map((t) => `${t.rule}: ${t.premises.map(cite).join(' ∧ ')} ⇒ ${t.conclusion}`);
    return `${name} → ${conclusion}. ${steps.join('; ')}.`;
}

module.exports = {
    RULES,
    THRESHOLDS,
    CONCLUSION_RANK,
    assertFacts,
    forwardChain,
    backwardChain,
    toClauses,
    resolutionProve,
    recommend,
    highlights,
    explain
};
