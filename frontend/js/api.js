// FIX: Point all requests to your Express server running on port 5000
const API_BASE = 'http://localhost:5000/api';

// Reusable standard API Fetch wrapper
async function apiFetch(endpoint, options = {}) {
    const response = await fetch(`${API_BASE}${endpoint}`, {
        headers: { 'Content-Type': 'application/json' },
        ...options
    });
    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || `HTTP Error ${response.status}`);
    }
    return response.json();
}

// FIX: Updated to fetch from your unified API path (/api/restaurants)
async function getRestaurants() {
    try {
        const data = await apiFetch('/restaurants');
        return data;
    } catch (error) {
        console.error("Failed to load restaurants on frontend:", error);
        return [];
    }
}
