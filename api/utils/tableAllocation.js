// api/utils/tableAllocation.js
//
// Batch table allocation: assign ALL waiting parties to vacant tables at
// once, instead of the old "oldest guest → smallest table that fits, one at
// a time" rule. Three solvers share one problem definition and one cost
// function so their results are directly comparable:
//
//   solveCSP        — backtracking search with MRV variable ordering, LCV
//                     value ordering, forward checking (constraint
//                     propagation) and branch-and-bound. Exact: returns a
//                     provably minimum-cost assignment.
//   hillClimb       — steepest-ascent local search starting from the old
//                     greedy FIFO rule. Fast, but it can get stuck at a
//                     local optimum or wander a plateau (see NEIGHBOURHOOD).
//   geneticAlgorithm— population search (tournament selection, uniform
//                     crossover, mutation, elitism). Stochastic, but seeded
//                     so results are reproducible; escapes the local optima
//                     that stop hill climbing.
//
// ── The CSP ──────────────────────────────────────────────────────────
//   Variables:   one per waiting party.
//   Domains:     vacant tables with capacity >= party size, plus UNSEATED.
//   Constraints: (1) capacity — enforced by the domain itself;
//                (2) all-different — no table holds two parties
//                    (UNSEATED is exempt);
//                (3) size order — nobody sits at a bigger table than the
//                    smallest free size that fits them. A party of 2 gets a
//                    2-seater; if none is free, a 4-seater — never a 6 while
//                    a 4 stands empty. See followsSizeOrder().
//   Objective:   minimise cost(assignment) below; ties are broken by
//                wasteSpread() so empty seats are spread evenly — given a
//                4 and a 6 for a pair and a four, the pair gets the 4.
//
// ── Cost ─────────────────────────────────────────────────────────────
//   wasted seats (capacity − party size, summed over seated parties)
//   + for each unseated party: SEAT_PENALTY × size + WAIT_PENALTY × minutes waited
//
// SEAT_PENALTY (10) dominates: seating one more person always beats saving
// a few empty chairs. WAIT_PENALTY breaks ties toward whoever has waited
// longest, so the optimiser doesn't starve early arrivals just to shave
// wasted seats.

const UNSEATED = -1;
const DEFAULT_WEIGHTS = { seatPenalty: 10, waitPenaltyPerMin: 0.5 };

/**
 * @param {Array<{id, size, waited_min?}>} parties
 * @param {Array<{id, capacity}>} tables
 */
function createProblem(parties, tables, weights = {}) {
    return {
        parties: parties.map((p) => ({ id: p.id, size: Number(p.size), waited_min: Number(p.waited_min) || 0, ...p })),
        tables: tables.map((t) => ({ id: t.id, capacity: Number(t.capacity), ...t })),
        weights: { ...DEFAULT_WEIGHTS, ...weights }
    };
}

/** assignment[i] = index into problem.tables, or UNSEATED. */
function cost(problem, assignment) {
    const { parties, tables, weights } = problem;
    let total = 0;
    assignment.forEach((t, i) => {
        const party = parties[i];
        if (t === UNSEATED) {
            total += weights.seatPenalty * party.size + weights.waitPenaltyPerMin * party.waited_min;
        } else {
            total += tables[t].capacity - party.size;
        }
    });
    return Math.round(total * 100) / 100;
}

function isValid(problem, assignment) {
    const used = new Set();
    return assignment.every((t, i) => {
        if (t === UNSEATED) return true;
        if (used.has(t) || problem.tables[t].capacity < problem.parties[i].size) return false;
        used.add(t);
        return true;
    });
}

/**
 * Size order (constraint 3): no seated party may be at a table while a
 * SMALLER table that still fits them is left free.
 */
function followsSizeOrder(problem, assignment) {
    const used = new Set(assignment.filter((t) => t !== UNSEATED));
    const freeCaps = problem.tables.filter((_, idx) => !used.has(idx)).map((t) => t.capacity);
    return assignment.every((t, i) => {
        if (t === UNSEATED) return true;
        const size = problem.parties[i].size;
        const cap = problem.tables[t].capacity;
        return !freeCaps.some((c) => c >= size && c < cap);
    });
}

/** Tie-breaker: sum of squared empty seats — prefers 2 + 2 empty over 4 + 0. */
function wasteSpread(problem, assignment) {
    return assignment.reduce((s, t, i) => (t === UNSEATED ? s : s + (problem.tables[t].capacity - problem.parties[i].size) ** 2), 0);
}

/** Lexicographic comparison on (cost, spread). Negative = a is better. */
function compareScores(a, b) {
    return a.cost - b.cost || a.spread - b.spread;
}

const scoreOf = (problem, assignment) => ({ cost: cost(problem, assignment), spread: wasteSpread(problem, assignment) });

/**
 * Enforces size order by moving any seated party down to the smallest free
 * table that fits them. Each move frees a bigger table and strictly cuts
 * wasted seats, so this never makes an assignment worse.
 */
function tighten(problem, assignment) {
    const out = [...assignment];
    let moved = true;
    while (moved) {
        moved = false;
        const used = new Set(out.filter((t) => t !== UNSEATED));
        for (let i = 0; i < out.length && !moved; i++) {
            if (out[i] === UNSEATED) continue;
            const size = problem.parties[i].size;
            let best = out[i];
            problem.tables.forEach((t, idx) => {
                if (!used.has(idx) && t.capacity >= size && t.capacity < problem.tables[best].capacity) best = idx;
            });
            if (best !== out[i]) { out[i] = best; moved = true; }
        }
    }
    return out;
}

/** Human-readable summary shared by every solver's output. */
function describe(problem, assignment) {
    const seated = [];
    const unseated = [];
    let wastedSeats = 0;
    assignment.forEach((t, i) => {
        const p = problem.parties[i];
        if (t === UNSEATED) {
            unseated.push({ party_id: p.id, size: p.size });
        } else {
            const table = problem.tables[t];
            wastedSeats += table.capacity - p.size;
            seated.push({ party_id: p.id, size: p.size, table_id: table.id, capacity: table.capacity });
        }
    });
    return {
        cost: cost(problem, assignment),
        seated,
        unseated,
        guests_seated: seated.reduce((s, x) => s + x.size, 0),
        wasted_seats: wastedSeats
    };
}

// ── Baseline: the old greedy FIFO rule ────────────────────────────────
// Oldest party first (parties are expected in join order), each takes the
// smallest free table that fits. This is exactly what /auto-allocate did
// one guest at a time, applied to the whole queue.
function greedyFifo(problem) {
    const used = new Set();
    const indexed = problem.tables.map((t, idx) => ({ ...t, idx }));
    return problem.parties.map((p) => {
        const fit = smallestFittingTable(p.size, indexed.filter((t) => !used.has(t.idx)));
        if (!fit) return UNSEATED;
        used.add(fit.idx);
        return fit.idx;
    });
}

// ── CSP: backtracking + MRV + LCV + forward checking + branch & bound ─
function solveCSP(problem, { nodeLimit = 2000000, timeLimitMs = Infinity } = {}) {
    const { parties, tables, weights } = problem;
    const n = parties.length;

    // Initial domains (unary capacity constraint applied up front).
    const initialDomains = parties.map((p) =>
        tables.map((t, idx) => idx).filter((idx) => tables[idx].capacity >= p.size)
    );

    const unseatedCost = (i) => weights.seatPenalty * parties[i].size + weights.waitPenaltyPerMin * parties[i].waited_min;
    const valueCost = (i, t) => (t === UNSEATED ? unseatedCost(i) : tables[t].capacity - parties[i].size);

    // Admissible lower bound on the remaining cost: each unassigned party
    // pays at least its cheapest still-available option.
    const lowerBound = (domains, assigned) => {
        let lb = 0;
        for (let i = 0; i < n; i++) {
            if (assigned[i] !== undefined) continue;
            let best = unseatedCost(i);
            for (const t of domains[i]) best = Math.min(best, valueCost(i, t));
            lb += best;
        }
        return lb;
    };

    let best = greedyFifo(problem); // incumbent → gives B&B a real bound from node 1
    let bestScore = scoreOf(problem, best);
    let nodes = 0;
    let pruned = 0;
    let truncated = false;
    const deadline = Date.now() + timeLimitMs;

    const valueSpread = (i, t) => (t === UNSEATED ? 0 : (tables[t].capacity - parties[i].size) ** 2);

    function backtrack(assigned, domains, costSoFar, spreadSoFar, depth) {
        if (truncated || nodes >= nodeLimit || (nodes % 1024 === 0 && Date.now() > deadline)) { truncated = true; return; }
        nodes++;

        if (depth === n) {
            const candidate = parties.map((_, i) => assigned[i]);
            if (!followsSizeOrder(problem, candidate)) return; // constraint (3)
            const score = scoreOf(problem, candidate);
            if (compareScores(score, bestScore) < 0) {
                bestScore = score;
                best = candidate;
            }
            return;
        }

        // Prune on cost; on an exact cost tie, prune only if this branch
        // can't spread empty seats better either (spread only grows as
        // parties are added, so spreadSoFar is a valid lower bound).
        const bound = costSoFar + lowerBound(domains, assigned);
        if (bound > bestScore.cost || (bound === bestScore.cost && spreadSoFar >= bestScore.spread)) { pruned++; return; }

        // MRV: the party with the fewest remaining tables (ties → bigger
        // party first, since big parties are the hardest to place).
        let v = -1;
        for (let i = 0; i < n; i++) {
            if (assigned[i] !== undefined) continue;
            if (v === -1 || domains[i].length < domains[v].length ||
                (domains[i].length === domains[v].length && parties[i].size > parties[v].size)) v = i;
        }

        // LCV: try tables that knock out the fewest options for the other
        // unassigned parties first; ties → least wasted seats. UNSEATED last.
        const conflicts = (t) => {
            let c = 0;
            for (let i = 0; i < n; i++) if (i !== v && assigned[i] === undefined && domains[i].includes(t)) c++;
            return c;
        };
        const values = [...domains[v]]
            .sort((a, b) => conflicts(a) - conflicts(b) || valueCost(v, a) - valueCost(v, b));
        values.push(UNSEATED);

        for (const t of values) {
            // Forward checking: remove t from every other unassigned
            // party's domain (all-different constraint).
            const newDomains = t === UNSEATED
                ? domains
                : domains.map((d, i) => (i === v || assigned[i] !== undefined ? d : d.filter((x) => x !== t)));

            assigned[v] = t;
            backtrack(assigned, newDomains, costSoFar + valueCost(v, t), spreadSoFar + valueSpread(v, t), depth + 1);
            assigned[v] = undefined;
        }
    }

    backtrack(new Array(n).fill(undefined), initialDomains, 0, 0, 0);

    return {
        algorithm: 'csp',
        assignment: best,
        ...describe(problem, best),
        stats: { nodes_explored: nodes, branches_pruned: pruned, optimal: !truncated }
    };
}

// ── Hill climbing ─────────────────────────────────────────────────────
// NEIGHBOURHOOD (deliberately the "obvious" local moves a host would make):
//   move — seat an unseated party at a free table, or move a seated party
//          to a different free table;
//   swap — two seated parties trade tables (if both still fit).
// What it can't do in one step is "bump": unseat party A so party B can
// take A's table. That move first makes things worse (A is unseated) or is
// two moves apart — so when the optimum needs it, hill climbing stops at a
// LOCAL optimum. Equal-cost neighbours with no better ones = a PLATEAU.
// Needing a coordinated two-party change that no single move can make is
// the RIDGE case. The result reports which of these ended the climb.
function neighbours(problem, assignment) {
    const { parties, tables } = problem;
    const used = new Set(assignment.filter((t) => t !== UNSEATED));
    const free = tables.map((_, idx) => idx).filter((idx) => !used.has(idx));
    const out = [];

    assignment.forEach((t, i) => {
        for (const f of free) {
            if (tables[f].capacity >= parties[i].size) {
                const next = [...assignment];
                next[i] = f;
                out.push({ move: `move party ${parties[i].id} → table ${tables[f].id}`, assignment: next });
            }
        }
    });

    for (let i = 0; i < assignment.length; i++) {
        for (let j = i + 1; j < assignment.length; j++) {
            const a = assignment[i];
            const b = assignment[j];
            if (a === UNSEATED || b === UNSEATED) continue;
            if (tables[b].capacity >= parties[i].size && tables[a].capacity >= parties[j].size) {
                const next = [...assignment];
                next[i] = b;
                next[j] = a;
                out.push({ move: `swap parties ${parties[i].id} ⇄ ${parties[j].id}`, assignment: next });
            }
        }
    }
    return out;
}

function hillClimb(problem, { start = greedyFifo(problem), maxSteps = 1000 } = {}) {
    let current = start;
    let currentScore = scoreOf(problem, current);
    const trace = [{ step: 0, move: 'start (greedy FIFO)', cost: currentScore.cost }];
    let stoppedBecause = 'max_steps';
    let evaluated = 0;

    for (let step = 1; step <= maxSteps; step++) {
        const candidates = neighbours(problem, current);
        evaluated += candidates.length;
        if (candidates.length === 0) { stoppedBecause = 'no_neighbours'; break; }

        let bestN = null;
        let bestNScore = { cost: Infinity, spread: Infinity };
        let sideways = 0;
        for (const c of candidates) {
            const cScore = scoreOf(problem, c.assignment);
            if (cScore.cost === currentScore.cost) sideways++;
            if (compareScores(cScore, bestNScore) < 0) { bestNScore = cScore; bestN = c; }
        }

        if (compareScores(bestNScore, currentScore) >= 0) {
            stoppedBecause = sideways > 0 ? 'plateau' : 'local_optimum';
            break;
        }
        current = bestN.assignment;
        currentScore = bestNScore;
        trace.push({ step, move: bestN.move, cost: currentScore.cost });
    }

    return {
        algorithm: 'hill_climbing',
        assignment: current,
        ...describe(problem, current),
        stats: { steps: trace.length - 1, neighbours_evaluated: evaluated, stopped_because: stoppedBecause, trace }
    };
}

// ── Genetic algorithm ─────────────────────────────────────────────────
// Chromosome: the assignment array itself (gene i = table index for party
// i, or UNSEATED). Crossover/mutation can create invalid children (two
// parties on one table, or a party too big for its table); repair() fixes
// them by unseating the offending party, then tighten() moves anyone at
// an oversized table down a size — so every individual is valid and
// follows the size order.

/** Seeded PRNG (mulberry32) — same seed, same run, reproducible demos. */
function rng(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** Seeded Fisher–Yates shuffle of 0..n-1 (uniform, unlike sort(() => rand() - 0.5)). */
function shuffledIndices(n, rand) {
    const out = Array.from({ length: n }, (_, i) => i);
    for (let i = n - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
}

function repair(problem, genes, rand) {
    const used = new Set();
    // Visit genes in random order so no party is systematically favoured.
    const order = shuffledIndices(genes.length, rand);
    const out = [...genes];
    for (const i of order) {
        const t = out[i];
        if (t === UNSEATED) continue;
        if (used.has(t) || problem.tables[t].capacity < problem.parties[i].size) out[i] = UNSEATED;
        else used.add(t);
    }
    return tighten(problem, out);
}

function geneticAlgorithm(problem, {
    populationSize = 60,
    generations = 120,
    mutationRate = 0.15,
    tournamentSize = 3,
    eliteCount = 2,
    seed = 42
} = {}) {
    const rand = rng(seed);
    const { parties, tables } = problem;
    const n = parties.length;
    const randomGene = (i) => {
        const fits = tables.map((_, idx) => idx).filter((idx) => tables[idx].capacity >= parties[i].size);
        return fits.length === 0 || rand() < 0.1 ? UNSEATED : fits[Math.floor(rand() * fits.length)];
    };

    if (n === 0) {
        return { algorithm: 'genetic', assignment: [], ...describe(problem, []), stats: { generations: 0, best_cost_by_generation: [] } };
    }

    // Initial population: the arrival-order plan, then half "what if these
    // parties had arrived in a different order?" plans (smallest-fit in a
    // shuffled order — each one sensible, all different), then random
    // plans for diversity. Purely random plans alone leave so many parties
    // unseated that crossover has nothing good to combine on big queues.
    let population = [greedyFifo(problem)];
    const shuffledGreedy = () => {
        const order = shuffledIndices(n, rand);
        const used = new Set();
        const genes = new Array(n).fill(UNSEATED);
        for (const i of order) {
            const fit = smallestFittingTable(parties[i].size,
                tables.map((t, idx) => ({ ...t, idx })).filter((t) => !used.has(t.idx)));
            if (fit) { genes[i] = fit.idx; used.add(fit.idx); }
        }
        return genes;
    };
    while (population.length < populationSize / 2) population.push(shuffledGreedy());
    while (population.length < populationSize) {
        population.push(repair(problem, parties.map((_, i) => randomGene(i)), rand));
    }

    const scored = (pop) => pop.map((g) => ({ genes: g, ...scoreOf(problem, g) })).sort(compareScores);
    const tournament = (pool) => {
        let winner = null;
        for (let k = 0; k < tournamentSize; k++) {
            const c = pool[Math.floor(rand() * pool.length)];
            if (!winner || compareScores(c, winner) < 0) winner = c;
        }
        return winner.genes;
    };

    let ranked = scored(population);
    const history = [ranked[0].cost];

    for (let gen = 1; gen <= generations; gen++) {
        const next = ranked.slice(0, eliteCount).map((x) => x.genes);
        while (next.length < populationSize) {
            const a = tournament(ranked);
            const b = tournament(ranked);
            let child = a.map((gene, i) => (rand() < 0.5 ? gene : b[i])); // uniform crossover
            child = child.map((gene, i) => (rand() < mutationRate ? randomGene(i) : gene));
            next.push(repair(problem, child, rand));
        }
        ranked = scored(next);
        history.push(ranked[0].cost);
    }

    const best = ranked[0].genes;
    return {
        algorithm: 'genetic',
        assignment: best,
        ...describe(problem, best),
        stats: { generations, population_size: populationSize, seed, best_cost_by_generation: history }
    };
}

/**
 * One party, one table — the rule a host follows at the door and the one
 * reservations use: the smallest free table that fits. A party of 2 gets a
 * 2-seater; if none is free, a 4-seater; a 6 only if no 2 or 4 is free.
 * Ties on size go to the lowest table number.
 * @param {Array<{capacity, table_no?}>} freeTables
 */
function smallestFittingTable(partySize, freeTables) {
    return freeTables
        .filter((t) => Number(t.capacity) >= partySize)
        .sort((a, b) => Number(a.capacity) - Number(b.capacity) ||
            String(a.table_no ?? '').localeCompare(String(b.table_no ?? ''), undefined, { numeric: true }))[0] || null;
}

/**
 * What the app actually runs when staff press "Plan seating" (and on every
 * auto-allocate). Each technique does the job it's best at:
 *
 *   1. Exact search (solveCSP) — for a normal queue this finishes quickly
 *      and the plan is provably the best possible.
 *   2. If the queue is too big to search exhaustively within the budget,
 *      evolutionary search (geneticAlgorithm) explores widely for a good plan…
 *   3. …and a local-improvement pass (hillClimb) polishes it — a few swaps
 *      and moves the GA's random search tends to leave on the table.
 *
 * Exact search gets a fixed time budget; if it runs out, the best of its
 * incumbent and the polished GA plan wins.
 * `method` says which path produced it, for logs and the "how was this
 * planned?" note in the dashboard.
 */
function planSeating(problem, { exactTimeMs = 250, exactNodeLimit } = {}) {
    // A time budget, not a node count: nodes cost ~0.3µs, so 250 ms covers
    // any normal queue exhaustively (a 14-party queue needs ~160 ms).
    const exact = solveCSP(problem, { timeLimitMs: exactTimeMs, ...(exactNodeLimit ? { nodeLimit: exactNodeLimit } : {}) });
    if (exact.stats.optimal) {
        return { ...exact, method: 'exact', stats: { exact: exact.stats } };
    }

    const evolved = geneticAlgorithm(problem);
    const polished = hillClimb(problem, { start: evolved.assignment });
    const useExact = compareScores(scoreOf(problem, exact.assignment), scoreOf(problem, polished.assignment)) <= 0;
    const chosen = useExact ? exact : polished;
    return {
        ...chosen,
        method: useExact ? 'exact_partial' : 'evolved',
        stats: {
            exact: exact.stats,
            evolved: { generations: evolved.stats.generations, cost: evolved.cost },
            polished: { steps: polished.stats.steps, cost: polished.cost }
        }
    };
}

/**
 * Turns a plan staff approved on screen ([{ party_id, table_id }]) back into
 * an assignment for the CURRENT problem, so exactly what they saw is what
 * gets seated. Returns { assignment } or { error } if the queue or tables
 * changed in between (someone left, a table was taken) or the plan breaks
 * a seating rule.
 */
function assignmentFromSeats(problem, seats) {
    if (!Array.isArray(seats) || seats.length === 0) return { error: 'The plan has no seats.' };
    const assignment = problem.parties.map(() => UNSEATED);
    for (const seat of seats) {
        const i = problem.parties.findIndex((p) => String(p.id) === String(seat.party_id));
        const t = problem.tables.findIndex((tb) => String(tb.id) === String(seat.table_id));
        if (i === -1 || t === -1) return { error: 'The queue or tables changed since this plan was made.' };
        if (assignment[i] !== UNSEATED) return { error: 'A party appears twice in the plan.' };
        assignment[i] = t;
    }
    if (!isValid(problem, assignment)) return { error: 'The plan puts two parties at one table or a party at a table too small.' };
    if (!followsSizeOrder(problem, assignment)) return { error: 'A smaller table that fits has become free since this plan was made.' };
    return { assignment };
}

const SOLVERS = { csp: solveCSP, hill_climbing: hillClimb, genetic: geneticAlgorithm };

/** Runs the greedy baseline and all three solvers on the same problem. */
function compareAll(problem, options = {}) {
    const baseline = greedyFifo(problem);
    return {
        baseline: { algorithm: 'greedy_fifo', assignment: baseline, ...describe(problem, baseline) },
        csp: solveCSP(problem, options.csp),
        hill_climbing: hillClimb(problem, options.hill_climbing),
        genetic: geneticAlgorithm(problem, options.genetic)
    };
}

// Demo instance (a Friday-rush-sized queue) where the methods visibly
// differ: the old greedy FIFO rule seats parties strictly in arrival order,
// so the pair C takes a 4-top and E (3 people) takes a 6-top — leaving H
// (5 people) with nowhere to sit. The optimum leaves C waiting and seats H
// instead. From there no single move or swap improves the cost, so hill
// climbing halts on a PLATEAU at the greedy answer. CSP proves the optimum;
// the GA starts well above it and needs ~20 generations of recombination
// to reach it. (Found by searching random instances for exactly this
// behaviour — see tests/js/algorithms.test.js for the assertions.)
const DEMO_INSTANCE = {
    parties: [
        { id: 'A', size: 3, waited_min: 30 },
        { id: 'B', size: 2, waited_min: 27 },
        { id: 'C', size: 2, waited_min: 24 },
        { id: 'D', size: 4, waited_min: 21 },
        { id: 'E', size: 3, waited_min: 18 },
        { id: 'F', size: 6, waited_min: 15 },
        { id: 'G', size: 2, waited_min: 12 },
        { id: 'H', size: 5, waited_min: 9 }
    ],
    tables: [
        { id: 'T1', capacity: 2 },
        { id: 'T2', capacity: 4 },
        { id: 'T3', capacity: 4 },
        { id: 'T4', capacity: 4 },
        { id: 'T5', capacity: 6 },
        { id: 'T6', capacity: 6 }
    ]
};

module.exports = {
    UNSEATED,
    DEFAULT_WEIGHTS,
    DEMO_INSTANCE,
    SOLVERS,
    createProblem,
    cost,
    isValid,
    followsSizeOrder,
    wasteSpread,
    tighten,
    smallestFittingTable,
    planSeating,
    assignmentFromSeats,
    describe,
    greedyFifo,
    solveCSP,
    hillClimb,
    geneticAlgorithm,
    compareAll,
    rng
};
