const express = require('express');
const router  = express.Router();
const pool    = require('../db');

// GET /proveedores
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM proveedor ORDER BY nombre ASC'
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /proveedores
router.post('/', async (req, res) => {
  const { nombre, contacto } = req.body;
  if (!nombre) return res.status(400).json({ error: 'Nombre requerido' });
  try {
    const result = await pool.query(
      'INSERT INTO proveedor (nombre, contacto) VALUES ($1, $2) RETURNING *',
      [nombre, contacto || null]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /proveedores/:id
router.put('/:id', async (req, res) => {
  const { nombre, contacto } = req.body;
  try {
    const result = await pool.query(
      `UPDATE proveedor SET
         nombre   = COALESCE($1, nombre),
         contacto = COALESCE($2, contacto)
       WHERE idproveedor = $3 RETURNING *`,
      [nombre, contacto, req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'No encontrado' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /proveedores/:id
router.delete('/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM proveedor WHERE idproveedor = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
