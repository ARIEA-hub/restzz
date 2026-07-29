async function loadRestaurants() {
    try {
        const restaurants = await getRestaurants();

        restaurants.forEach(r => {
            // FIX: Use coordinates from the database if they exist, otherwise fallback safely
            const lat = r.latitude || 19.076;
            const lng = r.longitude || 72.877;

            // FIX: Added a small fallback string in case wait_time is null/undefined
            const waitTime = r.wait_time !== undefined && r.wait_time !== null ? r.wait_time : 0;

            L.marker([lat, lng])
                .addTo(map)
                .bindPopup(`<b>${r.name}</b><br>Wait Time: ${waitTime} mins`);
        });
    } catch (error) {
        console.error("Error pinning restaurants on Leaflet map:", error);
    }
}

// Ensure the map script runs safely after DOM loads alongside the list
document.addEventListener('DOMContentLoaded', async () => {
    // Run map initialization
    await loadRestaurants();

    const container = document.getElementById('restaurants-list');
    if (!container) return;

    try {
        const restaurants = await apiFetch('/restaurants');
        
        // Safety measure: handle empty database states cleanly
        if (restaurants.length === 0) {
            container.innerHTML = `<p>No active restaurants found at this time.</p>`;
            return;
        }

        container.innerHTML = restaurants.map(r => `
            <div class="restaurant-card">
                <h3>${r.name}</h3>
                <p>${r.location || 'Location details unavailable'}</p>
            </div>
        `).join('');
    } catch (error) {
        container.innerHTML = `<p class="error-msg">Failed to load restaurants: ${error.message}</p>`;
    }
});
