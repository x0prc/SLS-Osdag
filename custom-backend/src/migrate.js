require('dotenv').config();

const fs = require('fs/promises');
const path = require('path');
const { createPool } = require('./db');

async function main() {
  const pool = createPool();
  const schema = await fs.readFile(path.resolve(__dirname, '..', 'db', 'schema.sql'), 'utf8');
  await pool.query(schema);
  await pool.end();
  console.log('Database schema is ready');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
