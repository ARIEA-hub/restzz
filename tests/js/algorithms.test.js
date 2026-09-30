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

// ── Seating rule: smallest table that fits, next size up if not free ──
test('a pair gets a 2-seater, else a 4, never a 6 while a 4 is free', () => {
    const tables = [{ capacity: 6, table_no: 'T5' }, { capacity: 4, table_no: 'T3' }, { capacity: 2, table_no: 'T1' }];
    assert.equal(ta.smallestFittingTable(2, tables).capacity, 2);
    assert.equal(ta.smallestFittingTable(2, tables.filter((t) => t.capacity !== 2)).capacity, 4);
    assert.equal(ta.smallestFittingTable(5, tables).capacity, 6);
    assert.equal(ta.smallestFittingTable(9, tables), null);
    assert.equal(ta.smallestFittingTable(4, [{ capacity: 4, table_no: 'T10' }, { capacity: 4, table_no: 'T2' }]).table_no, 'T2');
});

test('batch seating gives the pair the 4 and the four the 6, not the other way round', () => {
    const p = ta.createProblem([{ id: 'pair', size: 2 }, { id: 'four', size: 4 }], [{ id: 'T6', capacity: 6 }, { id: 'T4', capacity: 4 }]);
    for (const solver of Object.values(ta.SOLVERS)) {
        const seats = Object.fromEntries(solver(p).seated.map((s) => [s.party_id, s.table_id]));
        assert.deepEqual(seats, { pair: 'T4', four: 'T6' });
    }
});

test('every planner respects the size order on random queues', () => {
    const rand = ta.rng(77);
    for (let trial = 0; trial < 30; trial++) {
        const parties = Array.from({ length: 1 + Math.floor(rand() * 8) }, (_, i) => ({ id: i, size: 1 + Math.floor(rand() * 6), waited_min: Math.floor(rand() * 40) }));
        const tables = Array.from({ length: 1 + Math.floor(rand() * 8) }, (_, i) => ({ id: `T${i}`, capacity: [2, 2, 4, 4, 6, 8][Math.floor(rand() * 6)] }));
        const p = ta.createProblem(parties, tables);
        for (const r of [ta.solveCSP(p), ta.hillClimb(p), ta.geneticAlgorithm(p, { generations: 30 }), ta.planSeating(p), { assignment: ta.greedyFifo(p) }]) {
            assert.ok(ta.isValid(p, r.assignment));
            assert.ok(ta.followsSizeOrder(p, r.assignment), `trial ${trial}`);
        }
    }
});

test('planSeating is exact on a normal queue and falls back gracefully on a huge one', () => {
    const small = ta.planSeating(demo());
    assert.equal(small.method, 'exact');
    assert.equal(small.cost, ta.solveCSP(demo()).cost);

    const rand = ta.rng(5);
    const parties = Array.from({ length: 30 }, (_, i) => ({ id: i, size: [1, 2, 2, 3, 4, 4, 6][Math.floor(rand() * 7)], waited_min: 60 - i * 2 }));
    const tables = Array.from({ length: 24 }, (_, i) => ({ id: `T${i}`, capacity: [2, 2, 4, 4, 6, 8][Math.floor(rand() * 6)] }));
    const p = ta.createProblem(parties, tables);
    const big = ta.planSeating(p, { exactNodeLimit: 2000 });
    assert.notEqual(big.method, 'exact');
    assert.ok(big.cost <= ta.cost(p, ta.greedyFifo(p)), 'never worse than seating in arrival order');
    assert.ok(ta.followsSizeOrder(p, big.assignment));
});

test('an approved plan is applied exactly, and a stale one is refused', () => {
    const p = demo();
    const plan = ta.planSeating(p);
    const seats = plan.seated.map((s) => ({ party_id: s.party_id, table_id: s.table_id }));

    const ok = ta.assignmentFromSeats(p, seats);
    assert.deepEqual(ok.assignment, plan.assignment);

    // A seated party left the queue before staff pressed "Seat".
    const gone = ta.createProblem(ta.DEMO_INSTANCE.parties.filter((x) => x.id !== seats[0].party_id), ta.DEMO_INSTANCE.tables);
    assert.match(ta.assignmentFromSeats(gone, seats).error, /changed/);

    // A smaller table that fits became free in the meantime.
    const pair = ta.createProblem([{ id: 'p', size: 2 }], [{ id: 'T6', capacity: 6 }, { id: 'T2', capacity: 2 }]);
    assert.match(ta.assignmentFromSeats(pair, [{ party_id: 'p', table_id: 'T6' }]).error, /smaller table/);
    assert.match(ta.assignmentFromSeats(pair, []).error, /no seats/);
});

test('ties go to the lowest table number, numerically (T2 before T10)', () => {
    const p = ta.createProblem([{ id: 'a', size: 4 }], [{ id: 10, capacity: 4, table_no: 'T10' }, { id: 2, capacity: 4, table_no: 'T2' }]);
    assert.equal(p.tables[ta.greedyFifo(p)[0]].table_no, 'T2');
});

test('exact search finishes a 14-party queue within the planner time budget', () => {
    const rand = ta.rng(5);
    const parties = Array.from({ length: 14 }, (_, i) => ({ id: i, size: [1, 2, 2, 2, 3, 4, 4, 5, 6, 8][Math.floor(rand() * 10)], waited_min: 28 - i * 2 }));
    const tables = Array.from({ length: 12 }, (_, i) => ({ id: `T${i}`, capacity: [2, 2, 2, 4, 4, 4, 6, 6, 8][Math.floor(rand() * 9)] }));
    const plan = ta.planSeating(ta.createProblem(parties, tables), { exactTimeMs: 2000 });
    assert.equal(plan.method, 'exact');
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

test('Hard never loses; Easy still takes wins and blocks, but can be forked', () => {
    // Hard: play every possible guest strategy against it — it never loses.
    const explore = (board) => {
        for (const i of ttt.emptyCells(board)) {
            const b = [...board];
            b[i] = 'X';
            assert.notEqual(ttt.winner(b)?.player, 'X', 'guest should never beat Hard');
            if (ttt.winner(b) || !ttt.emptyCells(b).length) continue;
            b[ttt.chooseMove(b, 'hard')] = 'O';
            if (!ttt.winner(b) && ttt.emptyCells(b).length) explore(b);
        }
    };
    explore(Array(9).fill(null));

    const rand = ta.rng(1);
    assert.equal(ttt.chooseMove(['O', 'O', null, 'X', 'X', null, null, null, null], 'easy', rand), 2);
    assert.equal(ttt.chooseMove(['X', 'X', null, null, 'O', null, null, null, null], 'easy', rand), 2);

    // X has corners 0 and 8, O the centre: the only safe replies are edges.
    // Easy only looks one move ahead, so across seeds it sometimes plays a
    // corner and walks into the fork — which is what makes it beatable.
    const board = ['X', null, null, null, 'O', null, null, null, 'X'];
    const replies = new Set(Array.from({ length: 40 }, (_, s) => ttt.chooseMove(board, 'easy', ta.rng(s))));
    assert.ok([2, 6].some((corner) => replies.has(corner)), 'Easy should sometimes miss the fork');
    assert.ok([1, 3, 5, 7].includes(ttt.chooseMove(board, 'hard')), 'Hard should always block the fork');
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
