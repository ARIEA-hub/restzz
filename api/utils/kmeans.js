// api/utils/kmeans.js
//
// Unsupervised peak-hour discovery: K-means over the times of day that
// reservations are booked for (and/or walk-ins join the queue). Each cluster
// is a "demand window"; the biggest clusters are the real peak hours.
//
// Time of day is circular (23:50 is 20 minutes from 00:10, not 23 hours),
// so each time is embedded on the unit circle as (cos θ, sin θ) with
// θ = 2π · minutes / 1440, clustered there, and centroids are mapped back
// with atan2. For a restaurant open noon–midnight this changes little, but
// it keeps late-night bookings from being split across the "day boundary".
//
// k is chosen automatically (if not given) by the silhouette score, and
// initial centroids use k-means++ seeding with a seeded PRNG so the same
// data always gives the same clusters.

const { rng } = require('./tableAllocation');

const MINUTES_PER_DAY = 1440;

const toPoint = (minutes) => {
    const theta = (2 * Math.PI * minutes) / MINUTES_PER_DAY;
    return [Math.cos(theta), Math.sin(theta)];
};

const toMinutes = ([x, y]) => {
    const theta = Math.atan2(y, x);
    return ((theta / (2 * Math.PI)) * MINUTES_PER_DAY + MINUTES_PER_DAY) % MINUTES_PER_DAY;
};

const dist2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;

/** Circular difference in minutes, in [0, 720]. */
const minuteGap = (a, b) => {
    const d = Math.abs(a - b) % MINUTES_PER_DAY;
    return Math.min(d, MINUTES_PER_DAY - d);
};

/** Core Lloyd's algorithm on 2-D points. */
function kmeans(points, k, { seed = 7, maxIter = 100 } = {}) {
    const rand = rng(seed);

    // k-means++: first centroid uniformly, each next one with probability
    // proportional to squared distance from the nearest chosen centroid.
    const centroids = [points[Math.floor(rand() * points.length)]];
    while (centroids.length < k) {
        const d = points.map((p) => Math.min(...centroids.map((c) => dist2(p, c))));
        const total = d.reduce((s, x) => s + x, 0);
        if (total === 0) break; // fewer distinct points than k
        let r = rand() * total;
        let idx = 0;
        while (r > d[idx]) { r -= d[idx]; idx++; }
        centroids.push(points[Math.min(idx, points.length - 1)]);
    }

    let labels = new Array(points.length).fill(0);
    let iterations = 0;
    for (; iterations < maxIter; iterations++) {
        const next = points.map((p) => {
            let best = 0;
            for (let c = 1; c < centroids.length; c++) if (dist2(p, centroids[c]) < dist2(p, centroids[best])) best = c;
            return best;
        });
        const converged = iterations > 0 && next.every((l, i) => l === labels[i]);
        labels = next;
        if (converged) break;

        for (let c = 0; c < centroids.length; c++) {
            const members = points.filter((_, i) => labels[i] === c);
            if (members.length === 0) continue; // keep an empty cluster's old centroid
            centroids[c] = [
                members.reduce((s, p) => s + p[0], 0) / members.length,
                members.reduce((s, p) => s + p[1], 0) / members.length
            ];
        }
    }

    const inertia = points.reduce((s, p, i) => s + dist2(p, centroids[labels[i]]), 0);
    return { centroids, labels, iterations, inertia };
}

/**
 * Mean silhouette coefficient in [-1, 1]; higher = better-separated clusters.
 * O(n²), so large inputs are scored on an evenly spaced sample.
 */
function silhouette(allPoints, allLabels, maxSample = 800) {
    const step = Math.max(1, Math.ceil(allPoints.length / maxSample));
    const points = allPoints.filter((_, i) => i % step === 0);
    const labels = allLabels.filter((_, i) => i % step === 0);
    const k = Math.max(...labels) + 1;
    if (k < 2) return 0;
    const dist = (a, b) => Math.sqrt(dist2(a, b));

    const scores = points.map((p, i) => {
        const mean = (c) => {
            const others = points.filter((_, j) => labels[j] === c && j !== i);
            return others.length ? others.reduce((s, q) => s + dist(p, q), 0) / others.length : null;
        };
        const a = mean(labels[i]);
        if (a === null) return 0; // singleton cluster
        let b = Infinity;
        for (let c = 0; c < k; c++) {
            if (c === labels[i]) continue;
            const m = mean(c);
            if (m !== null) b = Math.min(b, m);
        }
        return b === Infinity ? 0 : (b - a) / Math.max(a, b);
    });
    return scores.reduce((s, x) => s + x, 0) / scores.length;
}

const fmt = (minutes) => {
    const m = Math.round(minutes) % MINUTES_PER_DAY;
    return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};

/**
 * @param {number[]} minutesOfDay booking/arrival times as minutes after midnight
 * @param {{ k?: number, kRange?: [number, number], seed?: number }} options
 * @returns clusters sorted by size (largest = busiest peak first)
 */
function findPeakHours(minutesOfDay, { k, kRange = [2, 5], seed = 7 } = {}) {
    const points = minutesOfDay.map(toPoint);
    const distinct = new Set(minutesOfDay.map((m) => Math.round(m))).size;
    if (points.length === 0) return { k: 0, clusters: [], silhouette: null, candidates: [] };

    let chosen;
    const candidates = [];
    if (k) {
        chosen = kmeans(points, Math.min(k, distinct), { seed });
    } else {
        const [lo, hi] = kRange;
        for (let kk = lo; kk <= Math.min(hi, distinct - 1); kk++) {
            const run = kmeans(points, kk, { seed });
            const s = silhouette(points, run.labels);
            candidates.push({ k: kk, silhouette: Math.round(s * 1000) / 1000, inertia: Math.round(run.inertia * 1e4) / 1e4 });
            if (!chosen || s > chosen.score) chosen = { ...run, score: s };
        }
        if (!chosen) chosen = kmeans(points, 1, { seed });
    }

    const clusters = chosen.centroids
        .map((c, idx) => {
            const members = minutesOfDay.filter((_, i) => chosen.labels[i] === idx);
            if (members.length === 0) return null;
            const center = toMinutes(c);
            const spread = Math.sqrt(members.reduce((s, m) => s + minuteGap(m, center) ** 2, 0) / members.length);
            // Window = the actual earliest/latest member, measured around the centroid.
            const offsets = members.map((m) => ((m - center + MINUTES_PER_DAY * 1.5) % MINUTES_PER_DAY) - MINUTES_PER_DAY / 2);
            return {
                center: fmt(center),
                center_minutes: Math.round(center),
                window_start: fmt(center + Math.min(...offsets) + MINUTES_PER_DAY),
                window_end: fmt(center + Math.max(...offsets) + MINUTES_PER_DAY),
                spread_minutes: Math.round(spread),
                count: members.length,
                share: Math.round((members.length / minutesOfDay.length) * 1000) / 10
            };
        })
        .filter(Boolean)
        .sort((a, b) => b.count - a.count);

    clusters.forEach((c, i) => { c.label = i === 0 ? 'peak' : c.share >= 25 ? 'busy' : 'quiet'; });

    return {
        k: clusters.length,
        clusters,
        silhouette: chosen.score != null ? Math.round(chosen.score * 1000) / 1000 : Math.round(silhouette(points, chosen.labels) * 1000) / 1000,
        candidates,
        iterations: chosen.iterations
    };
}

module.exports = { kmeans, silhouette, findPeakHours, toPoint, toMinutes, minuteGap };
