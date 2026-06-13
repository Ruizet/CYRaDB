const express = require('express');
const router  = express.Router();
const pool    = require('../db');

// GET /inventario  — listado completo con estados calculados (usa vista)
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM v_inventario ORDER BY nombremedicamento ASC`
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /inventario/buscar?q=texto  — para autocompletado en ventas e ingreso
// Devuelve agrupado por nombre (con todas sus presentaciones/lotes anidados)
router.get('/buscar', async (req, res) => {
  const { q = '', soloStock } = req.query;
  const filtroStock = soloStock === '1' ? 'AND cantidadlote > 0' : '';

  try {
    const result = await pool.query(
      `SELECT
         idmedicamento,
         nombremedicamento,
         presentacion,
         descripcion,
         cantidadlote,
         precioventa,
         margen_porcentaje,
         fechavencimiento,
         ubicacion_estante,
         estado_vencimiento,
         estado_stock
       FROM v_inventario
       WHERE LOWER(nombremedicamento) LIKE LOWER($1)
          OR LOWER(presentacion)      LIKE LOWER($1)
       ${filtroStock}
       ORDER BY nombremedicamento ASC, fechavencimiento ASC NULLS LAST`,
      [`%${q}%`]
    );

    // Agrupar por nombre para el acordeón de presentaciones en el POS
    const grupos = {};
    for (const row of result.rows) {
      const key = row.nombremedicamento.toLowerCase();
      if (!grupos[key]) {
        grupos[key] = { nombre: row.nombremedicamento, lotes: [] };
      }
      grupos[key].lotes.push(row);
    }

    res.json(Object.values(grupos));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /inventario/alertas  — proxy cómodo para el dashboard
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

// GET /inventario/:id  — detalle de un lote
router.get('/:id', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM v_inventario WHERE idmedicamento = $1',
      [req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'No encontrado' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /inventario/:id  — editar precio, margen o ubicación de un lote
router.put('/:id', async (req, res) => {
  const { precioventa, margen_porcentaje, ubicacion_estante, descripcion } = req.body;
  try {
    const result = await pool.query(
      `UPDATE inventario SET
         precioventa       = COALESCE($1, precioventa),
         margen_porcentaje = COALESCE($2, margen_porcentaje),
         ubicacion_estante = COALESCE($3, ubicacion_estante),
         descripcion       = COALESCE($4, descripcion)
       WHERE idmedicamento = $5
       RETURNING *`,
      [precioventa, margen_porcentaje, ubicacion_estante, descripcion, req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'No encontrado' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
