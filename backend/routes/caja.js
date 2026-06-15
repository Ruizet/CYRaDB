const express = require('express');
const router  = express.Router();
const pool    = require('../db');

// 1. GET /caja/estado/:idusuario — Saber si el cajero tiene un turno activo
router.get('/estado/:idusuario', async (req, res) => {
  try {
    const sesion = await pool.query(
      "SELECT * FROM caja_sesion WHERE idusuario = $1 AND estado = 'abierta'",
      [req.params.idusuario]
    );

    if (sesion.rows.length === 0) return res.json({ activa: false });

    const caja = sesion.rows[0];

    // Traemos la suma de las ventas de este turno desde la tabla detallada
    const balance = await pool.query(
      `SELECT COALESCE(SUM(monto), 0) AS total_ventas 
       FROM detalle_caja 
       WHERE idcaja_sesion = $1 AND tipo_movimiento = 'venta'`,
      [caja.idcaja_sesion]
    );

    caja.monto_ventas = parseFloat(balance.rows[0].total_ventas);
    res.json({ activa: true, datos: caja });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 2. POST /caja/abrir — Iniciar turno e insertar primer detalle
router.post('/abrir', async (req, res) => {
  const { idusuario, montoApertura, descripcionObs } = req.body;
  try {
    const nuevaSesion = await pool.query(
      `INSERT INTO caja_sesion (idusuario, monto_apertura, estado) 
       VALUES ($1, $2, 'abierta') RETURNING idcaja_sesion`,
      [idusuario, montoApertura]
    );
    
    const idcaja = nuevaSesion.rows[0].idcaja_sesion;

    // Almacenamos la apertura en la bitácora relacional
    await pool.query(
      `INSERT INTO detalle_caja (idcaja_sesion, tipo_movimiento, monto, descripcion) 
       VALUES ($1, 'apertura', $2, $3)`,
      [idcaja, montoApertura, descripcionObs || 'Apertura de turno estándar.']
    );

    res.json({ mensaje: 'Gaveta abierta.' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 3. POST /caja/cerrar — Registrar el arqueo físico final
router.post('/cerrar', async (req, res) => {
  const { idcaja_sesion, montoCierreReal, observaciones, tipoCierre } = req.body; 
  try {
    // Actualizamos la tabla maestro usando 'monto_cierre'
    await pool.query(
      `UPDATE caja_sesion 
       SET fecha_cierre = NOW(), monto_cierre = $1, estado = 'cerrada' 
       WHERE idcaja_sesion = $2`,
      [montoCierreReal, idcaja_sesion]
    );

    // Insertamos el movimiento de cierre en la bitácora
    await pool.query(
      `INSERT INTO detalle_caja (idcaja_sesion, tipo_movimiento, monto, descripcion) 
       VALUES ($1, $2, $3, $4)`,
      [idcaja_sesion, tipoCierre || 'cierre_limpio', montoCierreReal, observaciones || 'Cierre de turno diario.']
    );

    res.json({ mensaje: 'Gaveta cerrada con éxito.' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 4. GET /caja/ultimo-cierre-general — Para la validación del fondo de caja entrante
router.get('/ultimo-cierre-general', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT monto_cierre FROM caja_sesion 
       WHERE estado = 'cerrada' 
       ORDER BY fecha_cierre DESC LIMIT 1`
    );
    res.json(result.rows.length > 0 ? result.rows[0] : null);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;