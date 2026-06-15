const express = require('express');
const router  = express.Router();
const pool    = require('../db');

// GET /sesiones  — sesiones abiertas (vista)
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM v_sesiones_abiertas ORDER BY creado_en ASC'
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /sesiones  — abrir nueva pestaña/cliente
router.post('/', async (req, res) => {
  const { idusuario, nombre_cliente = 'Cliente' } = req.body;
  if (!idusuario) return res.status(400).json({ error: 'idusuario requerido' });

  try {
    const result = await pool.query(
      `INSERT INTO sesion_venta (idusuario, nombre_cliente)
       VALUES ($1, $2) RETURNING idsesion, nombre_cliente, creado_en`,
      [idusuario, nombre_cliente]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /sesiones/:id/nombre  — renombrar pestaña en tiempo real
router.patch('/:id/nombre', async (req, res) => {
  const { nombre_cliente } = req.body;
  try {
    await pool.query(
      'UPDATE sesion_venta SET nombre_cliente = $1 WHERE idsesion = $2',
      [nombre_cliente, req.params.id]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /sesiones/:id/items  — carrito de una sesión
router.get('/:id/items', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT
         si.iditem,
         si.idmedicamento,
         si.cantidad,
         si.precio_snap,
         si.cantidad * si.precio_snap AS subtotal,
         i.nombremedicamento,
         i.presentacion,
         i.ubicacion_estante,
         i.cantidadlote AS stock_disponible
       FROM sesion_item si
       JOIN inventario i ON si.idmedicamento = i.idmedicamento
       WHERE si.idsesion = $1
       ORDER BY si.iditem ASC`,
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /sesiones/:id/items  — agregar o actualizar cantidad en el carrito
router.post('/:id/items', async (req, res) => {
  const { idmedicamento, cantidad } = req.body;
  if (!idmedicamento || !cantidad || cantidad < 1)
    return res.status(400).json({ error: 'idmedicamento y cantidad requeridos' });

  try {
    // Verificar stock disponible
    const inv = await pool.query(
      'SELECT cantidadlote, precioventa FROM inventario WHERE idmedicamento = $1',
      [idmedicamento]
    );
    if (!inv.rows.length) return res.status(404).json({ error: 'Medicamento no encontrado' });

    const { cantidadlote, precioventa } = inv.rows[0];
    if (cantidadlote < cantidad)
      return res.status(400).json({ error: `Stock insuficiente (disponible: ${cantidadlote})` });

    // Upsert: si ya está en el carrito, actualiza cantidad
    const result = await pool.query(
      `INSERT INTO sesion_item (idsesion, idmedicamento, cantidad, precio_snap)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (idsesion, idmedicamento)
       DO UPDATE SET cantidad = EXCLUDED.cantidad, precio_snap = EXCLUDED.precio_snap
       RETURNING *`,
      [req.params.id, idmedicamento, cantidad, precioventa]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /sesiones/:id/items/:mid  — quitar producto del carrito
router.delete('/:id/items/:mid', async (req, res) => {
  try {
    await pool.query(
      'DELETE FROM sesion_item WHERE idsesion = $1 AND idmedicamento = $2',
      [req.params.id, req.params.mid]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /sesiones/:id/confirmar  — cerrar sesión y generar venta (stored procedure)
router.post('/:id/confirmar', async (req, res) => {
  const { mediopago = 'efectivo' } = req.body;

  try {
    // 1. Verificar que la sesión tiene ítems
    const check = await pool.query(
      'SELECT COUNT(*) FROM sesion_item WHERE idsesion = $1',
      [req.params.id]
    );
    if (parseInt(check.rows[0].count) === 0)
      return res.status(400).json({ error: 'El carrito está vacío' });

    // 🌟 OPERACIÓN ADICIONAL: Conseguir el idusuario dueño de esta pestaña antes de destruirla o cerrarla
    const sesionInfo = await pool.query(
      'SELECT idusuario FROM sesion_venta WHERE idsesion = $1',
      [req.params.id]
    );
    const idUsuarioCajero = sesionInfo.rows[0]?.idusuario;

    // 2. Ejecutar tu Stored Procedure original de Postgres
    const result = await pool.query(
      'CALL sp_confirmar_venta($1, $2, NULL, NULL)',
      [req.params.id, mediopago]
    );
    
    // pg devuelve los OUT params en result.rows[0]
    const { p_idventa, p_total } = result.rows[0];

    // ======================================================================
    // 🌟 INTEGRACIÓN DE LA GAVETA (MAESTRO-DETALLE)
    // ======================================================================
    if (idUsuarioCajero) {
      // Buscamos si el cajero que está cobrando tiene un turno de gaveta abierto
      const turnoActivo = await pool.query(
        "SELECT idcaja_sesion FROM caja_sesion WHERE idusuario = $1 AND estado = 'abierta'",
        [idUsuarioCajero]
      );

      // Si tiene turno abierto, insertamos de inmediato la venta en el libro de detalles
      if (turnoActivo.rows.length > 0) {
        const idcaja_sesion = turnoActivo.rows[0].idcaja_sesion;
        
        await pool.query(
          `INSERT INTO detalle_caja (idcaja_sesion, tipo_movimiento, monto, descripcion) 
           VALUES ($1, 'venta', $2, $3)`,
          [
            idcaja_sesion, 
            parseFloat(p_total), 
            `Cobro POS - Venta #${p_idventa} (${mediopago.toUpperCase()})`
          ]
        );
        console.log(`[Bitácora] Venta #${p_idventa} por C$ ${p_total} sumada a la gaveta.`);
      } else {
        console.log(`[Advertencia] Venta #${p_idventa} cobrada sin un turno de gaveta activo para el usuario ${idUsuarioCajero}.`);
      }
    }
    // ======================================================================

    // 3. Responder al frontend exactamente como antes
    res.json({ idventa: p_idventa, total: p_total });

  } catch (err) {
    console.error("Error en confirmación de venta/gaveta:", err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
