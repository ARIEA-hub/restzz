// api/utils/auth.js
// JWT helpers shared by the routes added for the AI/algorithm features.

const jwt = require('jsonwebtoken');

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
 * Express middleware: requires an admin token, and — when the route has a
 * :restaurantId — that the admin belongs to that restaurant.
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

module.exports = { verifyBearer, requireAdmin };
