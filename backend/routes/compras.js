const express = require('express');
const router  = express.Router();
const pool    = require('../db');

// GET /compras  — historial completo (usa vista)
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM v_compras_detalle ORDER BY fecha DESC'
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /compras/buscar?q=texto
router.get('/buscar', async (req, res) => {
  const { q = '' } = req.query;
  try {
    const result = await pool.query(
      `SELECT * FROM v_compras_detalle
       WHERE CAST(idcompra AS TEXT) ILIKE $1
          OR LOWER(proveedor)       ILIKE $1
          OR LOWER(usuario)         ILIKE $1
       ORDER BY fecha DESC`,
      [`%${q}%`]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /compras  — registrar compra completa (stored procedure)
// Body: { idProveedor, idusuario, items: [...] }
// Cada ítem: { nombre, presentacion, descripcion, cantidad, costoLote,
//              margen, precioVenta, fechaVencimiento, ubicacion }
router.post('/', async (req, res) => {
  const { idProveedor, idusuario, items } = req.body;

  if (!idProveedor || !idusuario || !Array.isArray(items) || items.length === 0)
    return res.status(400).json({ error: 'Faltan datos: proveedor, usuario o ítems' });

  // Validar cada ítem antes de llamar al procedimiento
  for (const item of items) {
    if (!item.nombre || !item.cantidad || !item.costoLote)
      return res.status(400).json({
        error: `Ítem incompleto: nombre, cantidad y costoLote son obligatorios`
      });
    if (item.cantidad <= 0 || item.costoLote <= 0)
      return res.status(400).json({ error: 'Cantidad y costo deben ser mayores a 0' });
  }

  try {
    const result = await pool.query(
      'CALL sp_registrar_compra($1, $2, $3::json, NULL, NULL)',
      [idProveedor, idusuario, JSON.stringify(items)]
    );
    const { p_idcompra, p_total } = result.rows[0];
    res.json({ idcompra: p_idcompra, total: p_total });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
