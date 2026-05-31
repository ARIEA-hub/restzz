const API_URL = "http://127.0.0.1:8000";

async function getRestaurants() {

const response = await fetch(`${API_URL}/restaurants`);
const data = await response.json();

return data;

}   
const API_BASE = 'http://localhost:5000/api';

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