const express = require('express');
const router = express.Router();
const pool = require('../db');

router.get('/', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM Proveedor');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/nuevo', async (req, res) => {
  const { nombre, contacto } = req.body;
  try {
    const result = await pool.query(
      `INSERT INTO Proveedor (nombre, contacto) VALUES ($1,$2) RETURNING *`,
      [nombre, contacto]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
