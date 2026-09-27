// api/utils/informedSearch.js
//
// Uniform Cost Search, Greedy Best-First Search and A* over the same
// "walkable hop" proximity graph that graphSearch.js builds for BFS/DFS —
// except here every edge carries a real cost: its haversine distance in km.
//
//   UCS    — expands by g(n), the real distance walked so far. Optimal, but
//            blind: it fans out in every direction equally.
//   Greedy — expands by h(n), straight-line distance to the goal. Fast and
//            goal-directed, but NOT optimal: it can commit to a longer path.
//   A*     — expands by f(n) = g(n) + h(n). Optimal AND goal-directed.
//
// Heuristic: straight-line (haversine) distance to the goal. Because edge
// costs are themselves straight-line distances, the triangle inequality
// makes h consistent (h(n) <= cost(n, m) + h(m)), which is what lets A*
// use a closed set and still guarantee the optimal path.
//
// Same honest limitation as graphSearch.js: edges are straight-line hops
// between points within walking range, not real sidewalk geometry. The
// search functions are graph-agnostic — swap in a real road graph and
// they work unchanged.

const { distanceKm } = require('./scoring');
const { DEFAULT_WALK_KM } = require('./graphSearch');

/** Minimal binary min-heap keyed on `priority`. */
class PriorityQueue {
    constructor() { this.items = []; }
    get size() { return this.items.length; }

    push(item) {
        const a = this.items;
        a.push(item);
        let i = a.length - 1;
        while (i > 0) {
            const parent = (i - 1) >> 1;
            if (a[parent].priority <= a[i].priority) break;
            [a[parent], a[i]] = [a[i], a[parent]];
            i = parent;
        }
    }

    pop() {
        const a = this.items;
        const top = a[0];
        const last = a.pop();
        if (a.length > 0) {
            a[0] = last;
            let i = 0;
            for (;;) {
                const l = 2 * i + 1;
                const r = l + 1;
                let smallest = i;
                if (l < a.length && a[l].priority < a[smallest].priority) smallest = l;
                if (r < a.length && a[r].priority < a[smallest].priority) smallest = r;
                if (smallest === i) break;
                [a[smallest], a[i]] = [a[i], a[smallest]];
                i = smallest;
            }
        }
        return top;
    }
}

/**
 * Weighted adjacency list: { nodeId: [{ to, cost }] }, cost in km.
 * Nodes: 'customer' + each restaurant_id (as a string).
 */
function buildWeightedGraph(customerLat, customerLng, restaurants, walkKm = DEFAULT_WALK_KM) {
    const nodes = [
        { id: 'customer', lat: customerLat, lng: customerLng, restaurant: null },
        ...restaurants
            .filter((r) => r.latitude != null && r.longitude != null)
            .map((r) => ({
                id: String(r.restaurant_id),
                lat: parseFloat(r.latitude),
                lng: parseFloat(r.longitude),
                restaurant: r
            }))
    ];

    const graph = {};
    nodes.forEach((n) => { graph[n.id] = []; });

    for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
            const d = distanceKm(nodes[i].lat, nodes[i].lng, nodes[j].lat, nodes[j].lng);
            if (d <= walkKm) {
                graph[nodes[i].id].push({ to: nodes[j].id, cost: d });
                graph[nodes[j].id].push({ to: nodes[i].id, cost: d });
            }
        }
    }

    const nodesById = Object.fromEntries(nodes.map((n) => [n.id, n]));
    return { graph, nodesById };
}

/**
 * Generic best-first search. `mode` picks the priority function:
 *   'ucs'    → g
 *   'greedy' → h
 *   'astar'  → g + h
 *
 * @param {object} graph      adjacency list { id: [{ to, cost }] }
 * @param {string} start
 * @param {string} goal
 * @param {function} heuristic (nodeId) => estimated cost to goal
 * @returns {{ found, path, cost, expanded, expansionOrder }}
 *   expanded = number of nodes popped and expanded — the number that shows
 *   the difference between the three algorithms on the same problem.
 */
function bestFirstSearch(graph, start, goal, heuristic, mode) {
    const h = mode === 'ucs' ? () => 0 : heuristic;
    const priorityOf = (g, id) => (mode === 'greedy' ? h(id) : g + h(id));

    const frontier = new PriorityQueue();
    const bestG = { [start]: 0 };
    const cameFrom = {};
    const closed = new Set();
    const expansionOrder = [];

    frontier.push({ id: start, g: 0, priority: priorityOf(0, start) });

    while (frontier.size > 0) {
        const { id, g } = frontier.pop();
        if (closed.has(id)) continue; // stale duplicate entry
        if (g > bestG[id]) continue;

        if (id === goal) {
            const path = [goal];
            while (path[0] !== start) path.unshift(cameFrom[path[0]]);
            return { found: true, path, cost: g, expanded: expansionOrder.length, expansionOrder };
        }

        closed.add(id);
        expansionOrder.push(id);

        for (const { to, cost } of graph[id] || []) {
            if (closed.has(to)) continue;
            const newG = g + cost;
            // Greedy ignores g for ordering, but still records the first
            // (not necessarily cheapest) way it reached a node.
            if (mode === 'greedy' ? to in bestG : newG >= (bestG[to] ?? Infinity)) continue;
            bestG[to] = newG;
            cameFrom[to] = id;
            frontier.push({ id: to, g: newG, priority: priorityOf(newG, to) });
        }
    }

    return { found: false, path: null, cost: null, expanded: expansionOrder.length, expansionOrder };
}

const ALGORITHMS = ['ucs', 'greedy', 'astar'];

/**
 * Route from the customer to one restaurant over the walkable-hop graph.
 * Returns the path as restaurant/customer waypoints plus search stats.
 */
function findRoute(customerLat, customerLng, restaurants, goalRestaurantId, { algorithm = 'astar', walkKm = DEFAULT_WALK_KM } = {}) {
    if (!ALGORITHMS.includes(algorithm)) {
        throw new Error(`algorithm must be one of: ${ALGORITHMS.join(', ')}`);
    }

    const { graph, nodesById } = buildWeightedGraph(customerLat, customerLng, restaurants, walkKm);
    const goal = String(goalRestaurantId);
    if (!nodesById[goal]) return null;

    const goalNode = nodesById[goal];
    const heuristic = (id) => distanceKm(nodesById[id].lat, nodesById[id].lng, goalNode.lat, goalNode.lng);

    const result = bestFirstSearch(graph, 'customer', goal, heuristic, algorithm);
    const toWaypoint = (id) => {
        const n = nodesById[id];
        return { id, name: n.restaurant ? n.restaurant.name : 'You', lat: n.lat, lng: n.lng };
    };

    return {
        algorithm,
        found: result.found,
        path: result.path ? result.path.map(toWaypoint) : null,
        distance_km: result.cost == null ? null : Math.round(result.cost * 1000) / 1000,
        hops: result.path ? result.path.length - 1 : null,
        nodes_expanded: result.expanded,
        expansion_order: result.expansionOrder.map((id) => toWaypoint(id).name),
        straight_line_km: Math.round(heuristic('customer') * 1000) / 1000
    };
}

module.exports = { PriorityQueue, buildWeightedGraph, bestFirstSearch, findRoute, ALGORITHMS };
