// frontend/js/api.js
// Shared API configuration and fetch helpers
// Include in HTML pages: <script src="js/api.js"></script>

// ── CONFIG ────────────────────────────────────────────────────────────
// All requests go through the Express backend.
// The old FastAPI endpoint (localhost:8000) has been removed.
const API_BASE = 'http://localhost:5000/api';

// ── PUBLIC FETCH ─────────────────────────────────────────────────────
// For unauthenticated endpoints (restaurants list, send-otp, etc.)
async function apiFetch(endpoint, options = {}) {
    const response = await fetch(`${API_BASE}${endpoint}`, {
        headers: { 'Content-Type': 'application/json' },
        ...options
    });

    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || errorData.error || `HTTP Error ${response.status}`);
    }
    return response.json();
}

// ── AUTHENTICATED FETCH ───────────────────────────────────────────────
// For endpoints that require a JWT token (dashboard, reservations, etc.)
// Automatically reads token from localStorage and attaches to header.
async function authFetch(endpoint, options = {}) {
    const token = localStorage.getItem('auth_token');

    const response = await fetch(`${API_BASE}${endpoint}`, {
        headers: {
            'Content-Type': 'application/json',
            ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        ...options
    });

    // If token expired or invalid, redirect to login
    if (response.status === 401) {
        clearSession();
        window.location.href = 'CustomerLogin.html';
        return;
    }

    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || errorData.error || `HTTP Error ${response.status}`);
    }
    return response.json();
}

// ── SESSION HELPERS ───────────────────────────────────────────────────
function getAuthToken() {
    return localStorage.getItem('auth_token');
}

function clearSession() {
    ['auth_token', 'customer_id', 'admin_id', 'restaurant_id', 'role',
     'temp_email', 'temp_role', 'temp_customer_id', 'temp_admin_id'].forEach(k =>
        localStorage.removeItem(k)
    );
}
