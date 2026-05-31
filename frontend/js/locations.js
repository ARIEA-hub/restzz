async function loadRestaurants(){

const restaurants = await getRestaurants();

restaurants.forEach(r => {

L.marker([19.076,72.877])
.addTo(map)
.bindPopup(`${r.name} - Wait: ${r.wait_time} min`);

});

}

loadRestaurants();

document.addEventListener('DOMContentLoaded', async () => {
    const container = document.getElementById('restaurants-list');
    if (!container) return;

    try {
        const restaurants = await apiFetch('/restaurants');
        container.innerHTML = restaurants.map(r => `
            <div class="restaurant-card">
                <h3>${r.name}</h3>
                <p>${r.location}</p>
            </div>
        `).join('');
    } catch (error) {
        container.innerHTML = `<p>Failed to load restaurants: ${error.message}</p>`;
    }
});