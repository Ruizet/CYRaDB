const express = require('express');
const router  = express.Router();
const pool    = require('../db');

// GET /dashboard/hoy  — KPIs del día
router.get('/hoy', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM fn_dashboard_hoy()');
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /dashboard/alertas  — lista completa para el panel
router.get('/alertas', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM v_alertas ORDER BY nivel DESC, descripcion ASC`
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
