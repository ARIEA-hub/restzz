// frontend/js/api.js
// Shared helpers for every page that talks to the Q-Sense API.
// Include before page scripts: <script src="js/api.js"></script>

const API_BASE = 'http://localhost:5000/api';

// ── Escaping ─────────────────────────────────────────────────────────
// escapeHtml: for text placed inside HTML.
// attrJson:   for a JS value inside an inline handler, e.g.
//             onclick='go(${attrJson(name)})'. JSON.stringify alone breaks
//             on names like "Leopold's" inside a single-quoted attribute.
function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

function attrJson(value) {
    return escapeHtml(JSON.stringify(value));
}

// ── Toasts (instead of window.alert) ─────────────────────────────────
function toast(message, kind = 'info') {
    let host = document.getElementById('toast-host');
    if (!host) {
        host = document.createElement('div');
        host.id = 'toast-host';
        host.setAttribute('role', 'status');
        host.setAttribute('aria-live', 'polite');
        document.body.appendChild(host);
    }
    const el = document.createElement('div');
    el.className = `toast toast-${kind}`;
    el.textContent = message;
    host.appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));
    setTimeout(() => {
        el.classList.remove('show');
        setTimeout(() => el.remove(), 250);
    }, kind === 'error' ? 6000 : 4000);
}

// A message that should survive a redirect ("Account verified. Log in now.").
// Shown on the next page that loads this file.
function flash(message, kind = 'info') {
    try { sessionStorage.setItem('qsense_flash', JSON.stringify({ message, kind })); } catch (e) { /* storage blocked */ }
}

document.addEventListener('DOMContentLoaded', () => {
    try {
        const pending = sessionStorage.getItem('qsense_flash');
        if (!pending) return;
        sessionStorage.removeItem('qsense_flash');
        const { message, kind } = JSON.parse(pending);
        toast(message, kind);
    } catch (e) { /* ignore */ }
});

const NETWORK_ERROR = "Can't reach Q-Sense right now. Check your connection and try again.";

// ── Fetch ────────────────────────────────────────────────────────────
async function request(endpoint, options, onUnauthorized) {
    const token = localStorage.getItem('auth_token');
    const response = await fetch(`${API_BASE}${endpoint}`, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...(options.headers || {})
        }
    });

    const data = await response.json().catch(() => ({}));
    if (response.status === 401 && onUnauthorized) {
        onUnauthorized();
        throw new Error(data.message || 'Please log in again.');
    }
    if (!response.ok) {
        const error = new Error(data.message || data.error || `Request failed (${response.status}).`);
        error.status = response.status;
        error.data = data;
        throw error;
    }
    return data;
}

/** Public endpoints (restaurant list, recommendations, …). */
function apiFetch(endpoint, options = {}) {
    return request(endpoint, options, null);
}

/** Customer endpoints: sends the login token; expired → customer login. */
function customerFetch(endpoint, options = {}) {
    return request(endpoint, options, () => {
        clearSession();
        window.location.href = 'CustomerLogin.html';
    });
}

/** Staff endpoints: sends the login token; expired → admin login. */
function adminFetch(endpoint, options = {}) {
    return request(endpoint, options, () => {
        clearSession();
        window.location.href = 'AdminLogin.html';
    });
}

function clearSession() {
    ['auth_token', 'customer_id', 'admin_id', 'restaurant_id', 'role', 'admin_email',
     'temp_email', 'temp_role', 'temp_customer_id', 'temp_admin_id'].forEach((k) => localStorage.removeItem(k));
}
