const API_URL = "http://127.0.0.1:8000";

async function getRestaurants() {

const response = await fetch(`${API_URL}/restaurants`);
const data = await response.json();

return data;

}