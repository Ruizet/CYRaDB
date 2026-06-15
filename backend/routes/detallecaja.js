const express = require('express');
const router  = express.Router();
const pool    = require('../db');

/**
 * GET /detalle_caja
 * Retorna los últimos 50 movimientos globales de la gaveta.
 * Une la bitácora con la sesión y el usuario para mostrar qué cajero hizo cada acción.
 * Ideal para la pantalla independiente 'historial-caja.html' y el Dashboard.
 */
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT 
        d.iddetalle_caja,
        d.fecha_movimiento,
        d.tipo_movimiento,
        d.monto,
        d.descripcion,
        u.nombre AS cajero
       FROM detalle_caja d
       JOIN caja_sesion c ON d.idcaja_sesion = c.idcaja_sesion
       JOIN usuario u ON c.idusuario = u.idusuario
       ORDER BY d.fecha_movimiento DESC 
       LIMIT 50`
    );
    
    res.json(result.rows);
  } catch (err) {
    console.error("Error en GET /detalle_caja:", err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * OPTIONAL: GET /detalle_caja/sesion/:idsesion
 * Por si en el futuro necesitas ver los movimientos específicos de un solo turno de caja.
 */
router.get('/sesion/:idsesion', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM detalle_caja 
       WHERE idcaja_sesion = $1 
       ORDER BY fecha_movimiento ASC`,
      [req.params.idsesion]
    );
    res.json(result.rows);
  } catch (err) {
    console.error("Error en GET /detalle_caja/sesion:", err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;