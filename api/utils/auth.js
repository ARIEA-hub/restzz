// api/utils/auth.js
// JWT checks shared by the routes. Admin tokens carry { admin_id,
// restaurant_id, role }; customer tokens carry { customer_id }.

const jwt = require('jsonwebtoken');
const db = require('../database');

function verifyBearer(req) {
    const authorization = req.headers.authorization || '';
    if (!authorization.startsWith('Bearer ')) return null;
    try {
        return jwt.verify(authorization.slice(7), process.env.JWT_SECRET);
    } catch (error) {
        return null;
    }
}

/**
 * Requires an admin token. When the route has a :restaurantId, the admin
 * must belong to that restaurant.
 */
function requireAdmin(req, res, next) {
    const admin = verifyBearer(req);
    if (!admin || !admin.admin_id) {
        return res.status(401).json({ message: 'Admin login required.' });
    }
    const { restaurantId } = req.params;
    if (restaurantId && String(admin.restaurant_id) !== String(restaurantId)) {
        return res.status(403).json({ message: 'You can only manage your own restaurant.' });
    }
    req.admin = admin;
    next();
}

/** Requires a customer token; sets req.customerId. */
function requireCustomer(req, res, next) {
    const token = verifyBearer(req);
    if (!token || !token.customer_id) {
        return res.status(401).json({ message: 'Please log in again.' });
    }
    req.customerId = token.customer_id;
    next();
}

/**
 * For admin routes addressed by a row id (a queue entry, table or
 * reservation) rather than a restaurant id: checks the row belongs to the
 * admin's restaurant. `table` and `idColumn` are fixed strings from the
 * route, never user input. Returns true, or sends 404 and returns false.
 */
async function adminOwnsRow(req, res, table, idColumn, id) {
    const [rows] = await db.query(`SELECT restaurant_id FROM ${table} WHERE ${idColumn} = $1`, [id]);
    if (rows.length === 0 || String(rows[0].restaurant_id) !== String(req.admin.restaurant_id)) {
        res.status(404).json({ message: 'Not found.' });
        return false;
    }
    return true;
}

module.exports = { verifyBearer, requireAdmin, requireCustomer, adminOwnsRow };
