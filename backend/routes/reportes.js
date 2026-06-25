const express = require('express');
const router  = express.Router();
const pool    = require('../db');

// GET /reportes/ventas-semana - Ventas de los últimos 7 días
router.get('/ventas-semana', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT TO_CHAR(creado_en, 'DD/MM') as dia, SUM(totalcobro) as total
      FROM venta
      WHERE creado_en >= CURRENT_DATE - INTERVAL '6 days'
      GROUP BY DATE(creado_en), TO_CHAR(creado_en, 'DD/MM')
      ORDER BY DATE(creado_en) ASC
    `);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /reportes/top-productos - Los 5 productos más vendidos
router.get('/top-productos', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT nombremedicamento, SUM(cantidaditems) as cantidad
      FROM detalleventa
      GROUP BY nombremedicamento
      ORDER BY cantidad DESC
      LIMIT 5
    `);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;