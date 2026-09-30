// api/utils/bookings.js
//
// The two ways a guest claims a table — booking ahead and joining the
// walk-in queue — shared by the web pages and the chat assistant, so both
// paths apply the same checks and record the same data.

const db = require('../database');
const { hasMlColumns } = require('./waitPredictor');

const MAX_PARTY = 20;

/** Checks common to both: open restaurant, sane party size that some table there can seat. */
async function checkParty(restaurantId, groupSize) {
    const size = Number(groupSize);
    if (!Number.isInteger(size) || size < 1 || size > MAX_PARTY) {
        return { error: `Party size must be a whole number from 1 to ${MAX_PARTY}.` };
    }
    const [rows] = await db.query(
        `SELECT r.name, r.status, MAX(t.capacity) AS largest
         FROM restaurant r
         LEFT JOIN restaurant_tables t ON t.restaurant_id = r.restaurant_id
         WHERE r.restaurant_id = $1
         GROUP BY r.restaurant_id`,
        [restaurantId]
    );
    if (rows.length === 0) return { error: 'Restaurant not found.' };
    const restaurant = rows[0];
    if (restaurant.status !== 'open') return { error: `${restaurant.name} isn't taking guests right now.` };
    if (restaurant.largest != null && size > Number(restaurant.largest)) {
        return { error: `${restaurant.name}'s largest table seats ${restaurant.largest}. Please call the restaurant for a party of ${size}.` };
    }
    return { size, restaurant };
}

/**
 * @returns {Promise<{ reserve_id } | { error, status }>}
 */
async function createReservation({ customerId, restaurantId, groupSize, date, time }) {
    if (!customerId || !restaurantId || !groupSize || !date || !time) {
        return { error: 'All reservation fields are required.', status: 400 };
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date)) || !/^\d{1,2}:\d{2}/.test(String(time))) {
        return { error: 'Date must be YYYY-MM-DD and time HH:MM.', status: 400 };
    }
    // Compare in the restaurant's time zone, not the server's.
    const tz = process.env.RESTAURANT_TZ || 'Asia/Kolkata';
    const [[{ is_past: isPast }]] = await db.query(
        `SELECT ($1::date + $2::time) < (NOW() AT TIME ZONE $3) AS is_past`,
        [date, time, tz]
    );
    if (isPast) return { error: 'That time has already passed.', status: 400 };

    const check = await checkParty(restaurantId, groupSize);
    if (check.error) return { error: check.error, status: 400 };

    const [rows] = await db.query(
        `INSERT INTO reservation (customer_id, restaurant_id, group_size, reserve_date, reserve_time)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING reserve_id`,
        [customerId, restaurantId, check.size, date, time]
    );
    return { reserve_id: rows[0].reserve_id, restaurant: check.restaurant };
}

/**
 * Adds a party to the walk-in queue. Snapshots queue length and free
 * tables at join time when the ML columns exist (the wait model's
 * features; see scripts/migrate_ml_features.sql).
 * @returns {Promise<{ queue_id } | { error, status }>}
 */
async function joinQueue({ customerId, restaurantId, groupSize }) {
    const check = await checkParty(restaurantId, groupSize);
    if (check.error) return { error: check.error, status: 400 };

    const [existing] = await db.query(
        `SELECT queue_id FROM queue
         WHERE customer_id = $1 AND restaurant_id = $2 AND status IN ('waiting', 'called')`,
        [customerId, restaurantId]
    );
    if (existing.length > 0) return { error: "You're already in this queue.", status: 400, queue_id: existing[0].queue_id };

    const [rows] = (await hasMlColumns())
        ? await db.query(
            `INSERT INTO queue (restaurant_id, customer_id, group_size, queue_length_at_join, tables_vacant_at_join)
             VALUES ($1, $2, $3,
                     (SELECT COUNT(*) FROM queue WHERE restaurant_id = $1 AND status = 'waiting'),
                     (SELECT COUNT(*) FROM restaurant_tables WHERE restaurant_id = $1 AND status = 'vacant'))
             RETURNING queue_id`,
            [restaurantId, customerId, check.size]
        )
        : await db.query(
            `INSERT INTO queue (restaurant_id, customer_id, group_size)
             VALUES ($1, $2, $3)
             RETURNING queue_id`,
            [restaurantId, customerId, check.size]
        );
    return { queue_id: rows[0].queue_id, restaurant: check.restaurant };
}

/**
 * A reservation's table, if it holds one, goes back to 'vacant' when the
 * reservation ends without the guests sitting down (cancelled / no-show)
 * or after they leave (completed); 'seated' marks it occupied.
 * Call inside the same transaction as the status change.
 */
async function syncReservationTable(client, reserveId, status) {
    const tableStatus = { cancelled: 'vacant', no_show: 'vacant', completed: 'vacant', seated: 'occupied' }[status];
    if (!tableStatus) return;
    await client.query(
        `UPDATE restaurant_tables SET status = $1
         WHERE table_id = (SELECT table_id FROM reservation WHERE reserve_id = $2)
           AND status IN ('reserved', 'occupied')`,
        [tableStatus, reserveId]
    );
}

module.exports = { createReservation, joinQueue, syncReservationTable, MAX_PARTY };
