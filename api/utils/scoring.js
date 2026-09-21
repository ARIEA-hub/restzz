// api/utils/scoring.js
//
// "Most convenient restaurant" ranking — combines real distance (from
// the customer's live location, already captured via location.js /
// watchPosition) with real estimated wait (the SAME formula already
// used in queue.js's /status endpoint: position * 5 minutes) into one
// weighted score. Lower score = more convenient. This is a classic
// nearest-neighbor / weighted-scoring problem, not something an LLM
// should be computing — the numbers need to be exact and reproducible.

/**
 * Haversine distance between two lat/lng points, in kilometers.
 */
function distanceKm(lat1, lng1, lat2, lng2) {
    const R = 6371; // Earth's radius in km
    const toRad = (deg) => (deg * Math.PI) / 180;

    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);

    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

/**
 * Ranks restaurants by convenience for a customer at (customerLat, customerLng).
 *
 * @param {number} customerLat
 * @param {number} customerLng
 * @param {Array} restaurants - each needs: restaurant_id, name, latitude,
 *        longitude, and waiting_count (number of people currently
 *        'waiting' in that restaurant's queue — used to derive wait
 *        the same way queue.js already does).
 * @param {object} weights - { distanceWeightPerKm, waitWeightPerMin }
 *        Defaults chosen so that 1 km of extra travel is treated as
 *        roughly equivalent to 4 minutes of extra wait — a customer
 *        would rather wait a few minutes than walk an extra kilometer.
 *        Tune these once real usage data exists; there's no "correct"
 *        answer here, just a starting assumption.
 * @returns {Array} restaurants with distance_km, estimated_wait_min,
 *          and convenience_score added, sorted ascending by score
 *          (most convenient first). Restaurants missing coordinates
 *          are excluded (can't score what we can't locate).
 */
function rankByConvenience(customerLat, customerLng, restaurants, weights = {}) {
    const DISTANCE_WEIGHT = weights.distanceWeightPerKm ?? 4;   // "cost" per km
    const WAIT_WEIGHT     = weights.waitWeightPerMin ?? 1;      // "cost" per minute waited
    const MIN_PER_QUEUED_PARTY = weights.minPerQueuedParty ?? 5; // matches queue.js's existing formula

    return restaurants
        .filter((r) => r.latitude != null && r.longitude != null)
        .map((r) => {
            const distance_km = distanceKm(
                customerLat, customerLng,
                parseFloat(r.latitude), parseFloat(r.longitude)
            );
            const estimated_wait_min = (r.waiting_count || 0) * MIN_PER_QUEUED_PARTY;
            const convenience_score =
                distance_km * DISTANCE_WEIGHT + estimated_wait_min * WAIT_WEIGHT;

            return {
                ...r,
                distance_km: Math.round(distance_km * 100) / 100,
                estimated_wait_min,
                convenience_score: Math.round(convenience_score * 100) / 100
            };
        })
        .sort((a, b) => a.convenience_score - b.convenience_score);
}

module.exports = { distanceKm, rankByConvenience };
