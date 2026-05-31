document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('reservation-form');
    if (!form) return;

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const customer_id = localStorage.getItem('customer_id');
        const payload = {
            customer_id,
            restaurant_id: form.restaurant_id?.value,
            group_size: form.group_size?.value,
            reserve_date: form.reserve_date?.value,
            reserve_time: form.reserve_time?.value
        };
        try {
            const result = await apiFetch('/reservations/create', {
                method: 'POST',
                body: JSON.stringify(payload)
            });
            alert(result.message || 'Reservation confirmed!');
        } catch (error) {
            alert('Booking failed: ' + error.message);
        }
    });
});