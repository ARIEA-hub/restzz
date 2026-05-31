require('dotenv').config();
console.log("DB_USER: " + process.env.DB_USER);

const express = require('express');
const cors = require('cors');
const db = require('./config/db.js');
const app = express();

app.use(cors({
    origin: '*', 
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    credentials: true
}));
app.use(express.json());


app.get('/', (req, res) => { 
    res.send('Q-Sense Backend Running');
});

app.get('/test-db', async(req,res) => { 
    try{
        const [rows] = await db.query('SELECT 1'); 
        res.json({message: 'Database Connected Successfully.'});
    }
    catch(error){
        res.status(500).json({error: error.message});
    }
});

// API Routes
const userRoutes = require('./routes/users');
app.use('/api/users', userRoutes);

const adminRoutes = require('./routes/admin');
app.use('/api/admin', adminRoutes);

const restRoutes = require('./routes/restaurant');
app.use('/api/restaurant', restRoutes);

const tableRoutes = require('./routes/tables');
app.use('/api/tables', tableRoutes);

const otpRoutes = require('./routes/otp');
app.use('/api', otpRoutes); 

const reservationRoutes = require('./routes/reservations');
app.use('/api/reservations', reservationRoutes);

const queueRoutes = require('./routes/queue');
app.use('/api/queue', queueRoutes);

app.get('/api/restaurants', async (req, res) => {
    try {
        const [restaurants] = await db.query("SELECT * FROM restaurant");
        res.json(restaurants);
    } catch (error) {
        console.error("Error fetching restaurants:", error);
        res.status(500).json({ message: "Failed to load restaurants." });
    }
});

app.get('/test', (req, res) => {
   res.send("Server routes working");
});


const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});