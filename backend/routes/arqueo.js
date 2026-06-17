const express = require('express');
const router  = express.Router();
const pool    = require('../db');

// Obtener estado de caja actual de un usuario
router.get('/estado/:idusuario', async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM arqueo_caja WHERE idusuario = $1 AND estado = 'abierto' LIMIT 1",
      [req.params.idusuario]
    );
    if (result.rows.length > 0) {
      res.json({ abierto: true, arqueo: result.rows[0] });
    } else {
      res.json({ abierto: false });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Registrar apertura de caja
router.post('/abrir', async (req, res) => {
  const { idusuario, monto_inicial } = req.body;
  try {
    const result = await pool.query(
      `INSERT INTO arqueo_caja (idusuario, monto_inicial, estado)
       VALUES ($1, $2, 'abierto') RETURNING *`,
      [idusuario, monto_inicial]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Obtener totales acumulados del arqueo activo para la vista previa
router.get('/totales/:idarqueo', async (req, res) => {
  try {
    const ventas = await pool.query(
      "SELECT mediopago, COALESCE(SUM(totalcobro), 0) AS total FROM venta WHERE idarqueo = $1 GROUP BY mediopago",
      [req.params.idarqueo]
    );
    const arqueo = await pool.query("SELECT monto_inicial FROM arqueo_caja WHERE idarqueo = $1", [req.params.idarqueo]);
    
    let efectivo = 0, tarjeta = 0, transferencia = 0;
    ventas.rows.forEach(r => {
      if (r.mediopago === 'efectivo') efectivo = parseFloat(r.total);
      if (r.mediopago === 'tarjeta') tarjeta = parseFloat(r.total);
      if (r.mediopago === 'transferencia') transferencia = parseFloat(r.total);
    });

    const inicial = parseFloat(arqueo.rows[0].monto_inicial);
    const calculado = inicial + efectivo;

    res.json({ inicial, efectivo, tarjeta, transferencia, calculado });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Guardar arqueo final y cerrar la caja
router.post('/cerrar', async (req, res) => {
  const { idarqueo, monto_final_real } = req.body;
  try {
    const ventas = await pool.query(
      "SELECT mediopago, COALESCE(SUM(totalcobro), 0) AS total FROM venta WHERE idarqueo = $1 GROUP BY mediopago",
      [idarqueo]
    );
    const arqueo = await pool.query("SELECT monto_inicial FROM arqueo_caja WHERE idarqueo = $1", [idarqueo]);
    
    let m_efectivo = 0, m_tarjeta = 0, m_transferencia = 0;
    ventas.rows.forEach(r => {
      if (r.mediopago === 'efectivo') m_efectivo = parseFloat(r.total);
      if (r.mediopago === 'tarjeta') m_tarjeta = parseFloat(r.total);
      if (r.mediopago === 'transferencia') m_transferencia = parseFloat(r.total);
    });

    const m_inicial = parseFloat(arqueo.rows[0].monto_inicial);
    const calculado = m_inicial + m_efectivo;
    const real = parseFloat(monto_final_real || 0);
    const diferencia = real - calculado;

    const closeResult = await pool.query(
      `UPDATE arqueo_caja SET
         fecha_cierre = NOW(),
         monto_ventas_efectivo = $1,
         monto_ventas_tarjeta = $2,
         monto_ventas_transferencia = $3,
         monto_final_calculado = $4,
         monto_final_real = $5,
         diferencia = $6,
         estado = 'cerrado'
       WHERE idarqueo = $7 RETURNING *`,
      [m_efectivo, m_tarjeta, m_transferencia, calculado, real, diferencia, idarqueo]
    );

    res.json(closeResult.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;