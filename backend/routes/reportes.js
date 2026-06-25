const express = require('express');
const router  = express.Router();
const pool    = require('../db');

// GET /reportes/ventas-semana - Ventas de los últimos 7 días
router.get('/ventas-semana', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT TO_CHAR(fecha, 'DD/MM') as dia, SUM(totalcobro) as total
      FROM venta
      WHERE fecha >= CURRENT_DATE - INTERVAL '6 days'
      GROUP BY DATE(fecha), TO_CHAR(fecha, 'DD/MM')
      ORDER BY DATE(fecha) ASC
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

// GET /reportes/top-empleados - Top 5 empleados que más venden
router.get('/top-empleados', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT u.nombre, SUM(v.totalcobro) as total_generado
      FROM venta v
      JOIN sesion_venta sv ON v.idsesion = sv.idsesion
      JOIN usuario u ON sv.idusuario = u.idusuario
      GROUP BY u.nombre
      ORDER BY total_generado DESC
      LIMIT 5
    `);
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /reportes/finanzas - Ganancias vs Pérdidas de los últimos 30 días
router.get('/finanzas', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        (SELECT COALESCE(SUM(totalcobro), 0) FROM venta WHERE fecha >= CURRENT_DATE - INTERVAL '30 days') as ganancias,
        (SELECT COALESCE(SUM(totalpago), 0) FROM compra WHERE fecha >= CURRENT_DATE - INTERVAL '30 days') as perdidas
    `);
    res.json(result.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;