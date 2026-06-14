const { Pool } = require('pg');

const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'CYRaDB',
  password: 'josm4nyl4w',
  port: 5432,
});

module.exports = pool;
