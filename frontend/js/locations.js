async function loadRestaurants(){

const restaurants = await getRestaurants();

restaurants.forEach(r => {

L.marker([19.076,72.877])
.addTo(map)
.bindPopup(`${r.name} - Wait: ${r.wait_time} min`);

});

}

loadRestaurants();