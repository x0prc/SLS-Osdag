require('dotenv').config();

const { createApp } = require('./app');
const { createPool } = require('./db');

const pool = createPool();
const app = createApp(pool);
const port = Number(process.env.PORT || 3000);

app.listen(port, () => {
  console.log(`Custom auth backend listening on http://localhost:${port}`);
});
