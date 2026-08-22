// frontend/js/locations.js
// Locations page script — restaurant map + live location tracking
// Requires: api.js loaded first, Leaflet.js CDN in the HTML

// ── MAP INITIALIZATION ────────────────────────────────────────────────
// Mumbai center coordinates as default
let map;
let userMarker;
let locationWatchId;

function initMap() {
    map = L.map('map').setView([19.076, 72.877], 12);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        maxZoom: 18
    }).addTo(map);
}

// ── LOAD RESTAURANTS FROM BACKEND (Bug B fix) ─────────────────────────
// Uses the Express route GET /api/restaurant (not the old FastAPI endpoint)
async function loadRestaurants() {
    const container = document.getElementById('restaurants-list');

    try {
        // apiFetch comes from api.js
        const restaurants = await apiFetch('/restaurant');

        if (!restaurants || restaurants.length === 0) {
            if (container) container.innerHTML = '<p>No restaurants found.</p>';
            return;
        }

        // Render sidebar list
        if (container) {
            container.innerHTML = restaurants.map(r => `
                <div class="restaurant-card" onclick="focusRestaurant(${r.latitude}, ${r.longitude}, '${r.name}')">
                    <h3>${r.name}</h3>
                    <p>${r.location || 'Mumbai'}</p>
                    <span class="status-badge ${r.status === 'open' ? 'open' : 'closed'}">
                        ${r.status === 'open' ? '✅ Open' : '❌ Closed'}
                    </span>
                </div>
            `).join('');
        }

        // Plot markers on Leaflet map using real lat/lng from DB
        restaurants.forEach(r => {
            if (r.latitude && r.longitude) {
                const marker = L.marker([r.latitude, r.longitude]).addTo(map);
                marker.bindPopup(`
                    <strong>${r.name}</strong><br>
                    ${r.location}<br>
                    Status: ${r.status}
                `);
            }
        });

    } catch (error) {
        console.error('Failed to load restaurants:', error);
        if (container) {
            container.innerHTML = `<p style="color:red;">Failed to load restaurants: ${error.message}</p>`;
        }
    }
}

// Focus map on a specific restaurant
function focusRestaurant(lat, lng, name) {
    if (lat && lng && map) {
        map.setView([lat, lng], 15);
    }
}

// ── FEATURE C: LIVE LOCATION TRACKING ────────────────────────────────
// Uses navigator.geolocation.watchPosition to continuously track user.
// Sends coordinates to backend POST /api/location/update.
// Also updates the user's marker position on the Leaflet map.

function startLocationTracking() {
    if (!navigator.geolocation) {
        console.warn('Geolocation is not supported by this browser.');
        return;
    }

    const customerId = localStorage.getItem('customer_id');

    // watchPosition fires immediately and then on every significant movement
    locationWatchId = navigator.geolocation.watchPosition(
        async (position) => {
            const { latitude, longitude, accuracy } = position.coords;

            console.log(`📍 Location update: ${latitude.toFixed(6)}, ${longitude.toFixed(6)} (±${accuracy.toFixed(0)}m)`);

            // Update user marker on map
            if (map) {
                if (userMarker) {
                    userMarker.setLatLng([latitude, longitude]);
                } else {
                    // Create a distinct blue marker for the user
                    const userIcon = L.divIcon({
                        className: 'user-location-marker',
                        html: '<div style="width:14px;height:14px;background:#3178c6;border:3px solid white;border-radius:50%;box-shadow:0 2px 6px rgba(0,0,0,0.3);"></div>',
                        iconSize: [14, 14],
                        iconAnchor: [7, 7]
                    });
                    userMarker = L.marker([latitude, longitude], { icon: userIcon })
                        .addTo(map)
                        .bindPopup('📍 You are here');
                }
            }

            // Send coordinates to backend (only if user is logged in)
            if (customerId) {
                try {
                    await apiFetch('/location/update', {
                        method: 'POST',
                        body: JSON.stringify({ customer_id: customerId, latitude, longitude })
                    });
                } catch (err) {
                    // Non-blocking — location update failure should not break the page
                    console.warn('Location update failed:', err.message);
                }
            }
        },

        (error) => {
            // Handle geolocation errors gracefully
            const messages = {
                1: 'Location permission denied. Enable location in browser settings.',
                2: 'Location unavailable.',
                3: 'Location request timed out.'
            };
            console.warn('Geolocation error:', messages[error.code] || error.message);
        },

        {
            enableHighAccuracy: true,   // Use GPS if available
            maximumAge:         5000,   // Accept cached position up to 5 seconds old
            timeout:            15000   // Give up after 15 seconds
        }
    );
}

// Stop tracking when user navigates away (saves battery)
function stopLocationTracking() {
    if (locationWatchId !== undefined) {
        navigator.geolocation.clearWatch(locationWatchId);
        locationWatchId = undefined;
    }
}

window.addEventListener('beforeunload', stopLocationTracking);

// ── INIT ──────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    initMap();
    loadRestaurants();
    startLocationTracking();
});
