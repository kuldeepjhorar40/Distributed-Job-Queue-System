require('dotenv').config();

const express = require('express');
const { connectDB } = require('./config/db');
const { connectRedis } = require('./config/redis');
const jobRoutes = require('./routes/job.routes');

const app = express();

// Middleware
app.use(express.json());

// Routes
app.use('/job', jobRoutes);

app.get('/', (req, res) => {
  res.send('QueueFlow API running 🚀');
});

const PORT = process.env.PORT || 3000;

// Start server
async function startServer() {
  try {
    await connectDB();
    await connectRedis();

    app.listen(PORT, () => {
      console.log(`🚀 Server running on http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error('Server failed:', err.message);
    process.exit(1);
  }
}

startServer();