const express = require('express');
const router  = express.Router();
const pool    = require('../db');

// GET /ventas  — historial completo (usa vista)
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM v_ventas_detalle ORDER BY fecha DESC'
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /ventas/buscar?q=texto
router.get('/buscar', async (req, res) => {
  const { q = '' } = req.query;
  try {
    const result = await pool.query(
      `SELECT * FROM v_ventas_detalle
       WHERE CAST(idventa AS TEXT) ILIKE $1
          OR CAST(fecha AS TEXT)   ILIKE $1
          OR LOWER(usuario)        ILIKE $1
          OR LOWER(nombre_cliente) ILIKE $1
       ORDER BY fecha DESC`,
      [`%${q}%`]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /ventas/:id  — detalle de una venta (para reimprimir ticket)
router.get('/:id', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM v_ventas_detalle WHERE idventa = $1',
      [req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Venta no encontrada' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
