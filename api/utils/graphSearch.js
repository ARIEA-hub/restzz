// api/utils/graphSearch.js
//
// Real BFS/DFS graph traversal for "restaurants reachable within N
// walkable hops of my location."
//
// HONEST LIMITATION: edges in this graph are "within walking distance"
// as a STRAIGHT-LINE distance threshold, not real road/sidewalk
// routing. True road-network routing needs an actual routing graph
// (e.g. from OpenStreetMap way data via a routing engine like OSRM),
// which is a meaningfully bigger integration than this. What's here is
// still a genuine graph-traversal problem though: given restaurants
// close enough to reach each other's location.js coordinates in one
// walkable "hop", BFS finds the closest-by-hop-count set, DFS finds a
// single deep path. If/when real road-graph data is added, only the
// buildProximityGraph() function needs to change — bfs()/dfs() would
// work unchanged on a real road graph too.

const { distanceKm } = require('./scoring');

const DEFAULT_WALK_KM = 1.2; // roughly a 15-minute walk at ~5 km/h

/**
 * Builds an adjacency list. Nodes: 'customer' + each restaurant_id.
 * An edge exists between two nodes if they're within walkKm of each
 * other (straight-line) — see the limitation note above.
 */
function buildProximityGraph(customerLat, customerLng, restaurants, walkKm = DEFAULT_WALK_KM) {
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
                graph[nodes[i].id].push(nodes[j].id);
                graph[nodes[j].id].push(nodes[i].id);
            }
        }
    }

    const nodesById = Object.fromEntries(nodes.map((n) => [n.id, n]));
    return { graph, nodesById };
}

/**
 * Breadth-first search from 'customer'. Returns restaurants reachable
 * within maxHops walkable hops, each tagged with its hop count (fewer
 * hops = fewer walkable "legs" to get there, roughly "more directly
 * reachable" rather than needing to walk past other stops first).
 */
function bfsReachable(customerLat, customerLng, restaurants, { maxHops = 2, walkKm = DEFAULT_WALK_KM } = {}) {
    const { graph, nodesById } = buildProximityGraph(customerLat, customerLng, restaurants, walkKm);

    const visited = new Set(['customer']);
    const queue = [{ id: 'customer', hops: 0 }];
    const reachable = [];

    while (queue.length > 0) {
        const { id, hops } = queue.shift();
        if (hops >= maxHops) continue;

        for (const neighborId of graph[id]) {
            if (visited.has(neighborId)) continue;
            visited.add(neighborId);

            const node = nodesById[neighborId];
            if (node.restaurant) {
                reachable.push({ ...node.restaurant, hops: hops + 1 });
            }
            queue.push({ id: neighborId, hops: hops + 1 });
        }
    }

    return reachable.sort((a, b) => a.hops - b.hops);
}

/**
 * Depth-first search from 'customer'. Returns ONE path (a chain of
 * walkable hops) reaching as deep as possible within maxHops — useful
 * for "plan a walking route past several places" rather than "list
 * everything nearby" (that's what BFS above is for).
 */
function dfsPath(customerLat, customerLng, restaurants, { maxHops = 3, walkKm = DEFAULT_WALK_KM } = {}) {
    const { graph, nodesById } = buildProximityGraph(customerLat, customerLng, restaurants, walkKm);

    const visited = new Set(['customer']);
    const path = [];

    function walk(id, depth) {
        if (depth >= maxHops) return;

        for (const neighborId of graph[id]) {
            if (visited.has(neighborId)) continue;
            visited.add(neighborId);

            const node = nodesById[neighborId];
            if (node.restaurant) {
                path.push({ ...node.restaurant, hops: depth + 1 });
            }
            walk(neighborId, depth + 1);
            return; // depth-first: commit to this branch, don't backtrack to siblings
        }
    }

    walk('customer', 0);
    return path;
}

module.exports = { buildProximityGraph, bfsReachable, dfsPath, DEFAULT_WALK_KM };
