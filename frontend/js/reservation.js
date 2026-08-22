// frontend/js/reservation.js
// Handles the reservation booking form on CustomerReservation.html
// Requires: api.js loaded first

document.addEventListener('DOMContentLoaded', async () => {

    // Guard: must be logged in
    const customerId = localStorage.getItem('customer_id');
    if (!customerId) {
        alert('Please log in to make a reservation.');
        window.location.href = 'CustomerLogin.html';
        return;
    }

    // Populate restaurant dropdown
    const restaurantSelect = document.getElementById('restaurant_id');
    if (restaurantSelect) {
        try {
            const restaurants = await apiFetch('/restaurant/open');
            restaurantSelect.innerHTML = '<option value="">Select a restaurant...</option>';
            restaurants.forEach(r => {
                const opt       = document.createElement('option');
                opt.value       = r.restaurant_id;
                opt.textContent = r.name;
                restaurantSelect.appendChild(opt);
            });
        } catch (err) {
            restaurantSelect.innerHTML = '<option value="">Error loading restaurants</option>';
        }
    }

    // Handle reservation form submission
    const form = document.getElementById('reservation-form');
    if (!form) return;

    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        const submitBtn = form.querySelector('button[type="submit"]');
        if (submitBtn) { submitBtn.textContent = 'Booking...'; submitBtn.disabled = true; }

        const payload = {
            customer_id:  customerId,
            restaurant_id: form.restaurant_id?.value,
            group_size:    form.group_size?.value,
            reserve_date:  form.reserve_date?.value,
            reserve_time:  form.reserve_time?.value
        };

        try {
            // Uses authFetch so JWT is sent in Authorization header
            const result = await authFetch('/reservations/create', {
                method: 'POST',
                body:   JSON.stringify(payload)
            });

            alert(result.message || '✅ Reservation confirmed!');
            form.reset();

        } catch (error) {
            alert('Booking failed: ' + error.message);
        } finally {
            if (submitBtn) { submitBtn.textContent = 'Book Table'; submitBtn.disabled = false; }
        }
    });
});
