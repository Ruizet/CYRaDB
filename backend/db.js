

const { Pool } = require('pg');

const pool = new Pool({
  user: 'postgres',           
  host: 'localhost',          
  database: 'FarmaciaCyR',    
  password: 'dlanod',  
  port: 5432                  
});

module.exports = pool;