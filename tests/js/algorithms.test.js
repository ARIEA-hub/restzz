// tests/js/algorithms.test.js
// Run with: npm test   (node --test, no extra dependencies)

const test = require('node:test');
const assert = require('node:assert/strict');

const { bestFirstSearch, findRoute, PriorityQueue } = require('../../api/utils/informedSearch');
const ta = require('../../api/utils/tableAllocation');
const ttt = require('../../frontend/js/tictactoe');
const es = require('../../api/utils/expertSystem');
const km = require('../../api/utils/kmeans');

// ── Search ────────────────────────────────────────────────────────────
test('priority queue pops in priority order', () => {
    const pq = new PriorityQueue();
    [5, 1, 4, 2, 3].forEach((p) => pq.push({ priority: p }));
    assert.deepEqual([1, 2, 3, 4, 5].map(() => pq.pop().priority), [1, 2, 3, 4, 5]);
});

// Classic textbook graph where greedy is suboptimal: S→A looks closest to G
// by heuristic, but S→B→G is cheaper.
const graph = {
    S: [{ to: 'A', cost: 5 }, { to: 'B', cost: 2 }],
    A: [{ to: 'G', cost: 5 }],
    B: [{ to: 'C', cost: 2 }],
    C: [{ to: 'G', cost: 2 }],
    G: []
};
const h = { S: 6, A: 2, B: 5, C: 2, G: 0 };

test('UCS and A* find the optimal path; greedy does not', () => {
    const ucs = bestFirstSearch(graph, 'S', 'G', (n) => h[n], 'ucs');
    const astar = bestFirstSearch(graph, 'S', 'G', (n) => h[n], 'astar');
    const greedy = bestFirstSearch(graph, 'S', 'G', (n) => h[n], 'greedy');

    assert.deepEqual(ucs.path, ['S', 'B', 'C', 'G']);
    assert.equal(ucs.cost, 6);
    assert.deepEqual(astar.path, ['S', 'B', 'C', 'G']);
    assert.equal(astar.cost, 6);
    assert.deepEqual(greedy.path, ['S', 'A', 'G']);
    assert.equal(greedy.cost, 10);
    assert.ok(astar.expanded <= ucs.expanded, 'A* should not expand more than UCS');
});

test('unreachable goal returns found=false', () => {
    const r = bestFirstSearch({ S: [], G: [] }, 'S', 'G', () => 0, 'astar');
    assert.equal(r.found, false);
    assert.equal(r.path, null);
});

test('findRoute hops through intermediate restaurants when the goal is out of walking range', () => {
    // Three restaurants ~0.9 km apart in a line north of the customer.
    const restaurants = [1, 2, 3].map((i) => ({ restaurant_id: i, name: `R${i}`, latitude: 19 + 0.008 * i, longitude: 72.8 }));
    const route = findRoute(19, 72.8, restaurants, 3, { algorithm: 'astar', walkKm: 1.2 });
    assert.equal(route.found, true);
    assert.deepEqual(route.path.map((p) => p.name), ['You', 'R1', 'R2', 'R3']);
    assert.ok(route.distance_km >= route.straight_line_km - 1e-9);
    assert.equal(findRoute(19, 72.8, restaurants, 99), null);
});

// ── Table allocation ──────────────────────────────────────────────────
const demo = () => ta.createProblem(ta.DEMO_INSTANCE.parties, ta.DEMO_INSTANCE.tables);

test('CSP finds the optimum and hill climbing gets stuck on the demo instance', () => {
    const p = demo();
    const csp = ta.solveCSP(p);
    const hc = ta.hillClimb(p);
    const ga = ta.geneticAlgorithm(p);

    assert.equal(csp.stats.optimal, true);
    assert.ok(ta.isValid(p, csp.assignment));
    assert.ok(hc.cost > csp.cost, 'hill climbing should stop above the optimum');
    assert.ok(['local_optimum', 'plateau'].includes(hc.stats.stopped_because));
    assert.equal(ga.cost, csp.cost, 'GA should escape and match the optimum');
});

test('CSP matches brute force on random instances', () => {
    const rand = ta.rng(123);
    for (let trial = 0; trial < 40; trial++) {
        const parties = Array.from({ length: 1 + Math.floor(rand() * 5) }, (_, i) => ({ id: i, size: 1 + Math.floor(rand() * 6), waited_min: Math.floor(rand() * 30) }));
        const tables = Array.from({ length: 1 + Math.floor(rand() * 4) }, (_, i) => ({ id: `T${i}`, capacity: [2, 4, 4, 6, 8][Math.floor(rand() * 5)] }));
        const p = ta.createProblem(parties, tables);

        // Enumerate every assignment (tables^parties, small instances only).
        let best = Infinity;
        const walk = (i, a) => {
            if (i === parties.length) {
                if (ta.isValid(p, a)) best = Math.min(best, ta.cost(p, a));
                return;
            }
            for (let t = -1; t < tables.length; t++) walk(i + 1, [...a, t]);
        };
        walk(0, []);

        const csp = ta.solveCSP(p);
        assert.ok(ta.isValid(p, csp.assignment));
        assert.equal(csp.cost, best, `trial ${trial}`);
        // Every solver's output must at least be valid and no better than optimal.
        for (const r of [ta.hillClimb(p), ta.geneticAlgorithm(p, { generations: 30 })]) {
            assert.ok(ta.isValid(p, r.assignment));
            assert.ok(r.cost >= best);
        }
    }
});

test('GA is reproducible for a fixed seed', () => {
    const a = ta.geneticAlgorithm(demo(), { seed: 7 });
    const b = ta.geneticAlgorithm(demo(), { seed: 7 });
    assert.deepEqual(a.assignment, b.assignment);
});

test('empty queue or no tables is handled', () => {
    assert.equal(ta.solveCSP(ta.createProblem([], [{ id: 1, capacity: 4 }])).seated.length, 0);
    assert.equal(ta.solveCSP(ta.createProblem([{ id: 1, size: 2 }], [])).unseated.length, 1);
    assert.equal(ta.geneticAlgorithm(ta.createProblem([], [])).seated.length, 0);
});

// ── Tic-tac-toe ───────────────────────────────────────────────────────
test('AI takes an immediate win and blocks an immediate loss', () => {
    const win = ['O', 'O', null, 'X', 'X', null, null, null, null];
    assert.equal(ttt.bestMove(win).move, 2);
    const block = ['X', 'X', null, null, 'O', null, null, null, null];
    assert.equal(ttt.bestMove(block).move, 2);
});

test('alpha-beta agrees with minimax but visits fewer nodes', () => {
    const boards = [
        ['X', null, null, null, null, null, null, null, null],
        [null, null, null, null, 'X', null, null, null, null],
        ['X', null, null, null, 'O', null, null, null, 'X']
    ];
    for (const b of boards) {
        const mm = ttt.bestMove(b, 'minimax');
        const ab = ttt.bestMove(b, 'alphabeta');
        assert.equal(ab.value, mm.value);
        assert.equal(ab.move, mm.move);
        assert.ok(ab.nodes < mm.nodes);
    }
});

test('perfect play from an empty board is a draw', () => {
    const board = Array(9).fill(null);
    let turn = 'X';
    while (!ttt.winner(board) && ttt.emptyCells(board).length) {
        // Let the same search play both sides by flipping the board for X.
        if (turn === 'O') board[ttt.bestMove(board).move] = 'O';
        else {
            const flipped = board.map((v) => (v === 'X' ? 'O' : v === 'O' ? 'X' : null));
            board[ttt.bestMove(flipped).move] = 'X';
        }
        turn = turn === 'X' ? 'O' : 'X';
    }
    assert.equal(ttt.winner(board), null);
});

// ── Expert system ─────────────────────────────────────────────────────
const base = (r, size = 4) => es.assertFacts(r, size);

test('forward chaining derives a strong recommendation with its trail', () => {
    const facts = base({ distance_km: 0.4, waiting_count: 0, vacant_capacities: [4], all_capacities: [4, 6] });
    const { facts: derived, trail } = es.forwardChain(facts);
    assert.ok(derived.has('recommend_strongly'));
    assert.deepEqual(trail.find((t) => t.conclusion === 'recommend_strongly').premises, ['quick_seating', 'nearby']);
});

test('backward chaining explains what is missing', () => {
    const facts = base({ distance_km: 0.4, waiting_count: 5, vacant_capacities: [], all_capacities: [4] });
    const proof = es.backwardChain('recommend_strongly', facts);
    assert.equal(proof.proved, false);
    assert.deepEqual(proof.attempts[0].missing, ['quick_seating']);
});

test('resolution agrees with forward chaining', () => {
    const cases = [
        { distance_km: 0.4, waiting_count: 0, vacant_capacities: [4], all_capacities: [4] },
        { distance_km: 3, waiting_count: 0, vacant_capacities: [4], all_capacities: [4] },
        { distance_km: 9, waiting_count: 12, vacant_capacities: [], all_capacities: [2] }
    ];
    for (const c of cases) {
        const facts = base(c);
        const { facts: derived } = es.forwardChain(facts);
        for (const goal of ['recommend_strongly', 'recommend', 'avoid']) {
            assert.equal(es.resolutionProve(goal, facts).proved, derived.has(goal), `${goal} for ${JSON.stringify(c)}`);
        }
    }
});

test('a party no table can seat is never recommended', () => {
    const [r] = es.recommend([{ name: 'Tiny', distance_km: 0.2, waiting_count: 0, vacant_capacities: [2], all_capacities: [2] }], 6);
    assert.equal(r.conclusion, 'avoid');
});

// ── K-means ───────────────────────────────────────────────────────────
test('k-means recovers lunch and dinner peaks, including across midnight', () => {
    const rand = ta.rng(3);
    const around = (center, n, spread) => Array.from({ length: n }, () => (center + (rand() - 0.5) * spread + 1440) % 1440);
    const data = [...around(13 * 60, 40, 60), ...around(20 * 60, 60, 60), ...around(0, 20, 40)];
    const r = km.findPeakHours(data);

    assert.equal(r.k, 3);
    assert.equal(r.clusters[0].label, 'peak');
    assert.equal(r.clusters[0].count, 60);
    const centers = r.clusters.map((c) => c.center_minutes);
    assert.ok(centers.some((m) => km.minuteGap(m, 20 * 60) < 15));
    assert.ok(centers.some((m) => km.minuteGap(m, 13 * 60) < 15));
    assert.ok(centers.some((m) => km.minuteGap(m, 0) < 15), 'the midnight cluster must not be split');
});

test('k-means handles tiny and empty inputs', () => {
    assert.equal(km.findPeakHours([]).k, 0);
    assert.ok(km.findPeakHours([600, 600, 600]).k >= 1);
});
