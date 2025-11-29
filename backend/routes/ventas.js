const express = require("express");
const router = express.Router();
const pool = require("../db");

// 1. LISTAR TODAS LAS VENTAS (CON DETALLE DE PRODUCTOS)
router.get("/", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        v.idventa, 
        v.fecha, 
        v.totalcobro, 
        v.mediopago,
        u.nombre AS usuario,
        -- Agrupamos los productos vendidos en una lista JSON
        COALESCE(
          json_agg(
            json_build_object(
              -- Si el nombre histórico está vacío (ventas viejas), buscamos en inventario actual
              'nombre', COALESCE(dv.nombremedicamento, i.nombremedicamento, 'Desconocido'),
              'cantidad', dv.cantidaditems,
              'subtotal', dv.subtotal
            )
          ) FILTER (WHERE dv.iddetalleventa IS NOT NULL), 
          '[]'
        ) AS items
      FROM venta v
      LEFT JOIN usuario u ON v.idusuario = u.idusuario
      LEFT JOIN detalleventa dv ON v.idventa = dv.idventa
      LEFT JOIN inventario i ON dv.idmedicamento = i.idmedicamento -- Join extra para recuperar nombres viejos
      GROUP BY v.idventa, u.nombre
      ORDER BY v.fecha DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error("Error en GET /ventas:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// 2. BUSCAR VENTAS (CON DETALLE)
router.get("/vbuscar", async (req, res) => {
  const { texto } = req.query;
  try {
    const result = await pool.query(`
      SELECT 
        v.idventa, v.fecha, v.totalcobro, v.mediopago,
        u.nombre AS usuario,
        COALESCE(
          json_agg(
            json_build_object(
              'nombre', COALESCE(dv.nombremedicamento, i.nombremedicamento, 'Desconocido'),
              'cantidad', dv.cantidaditems,
              'subtotal', dv.subtotal
            )
          ) FILTER (WHERE dv.iddetalleventa IS NOT NULL), '[]'
        ) AS items
      FROM venta v
      LEFT JOIN usuario u ON v.idusuario = u.idusuario
      LEFT JOIN detalleventa dv ON v.idventa = dv.idventa
      LEFT JOIN inventario i ON dv.idmedicamento = i.idmedicamento
      WHERE CAST(v.idventa AS TEXT) ILIKE $1
         OR CAST(v.fecha AS TEXT) ILIKE $1
         OR u.nombre ILIKE $1
      GROUP BY v.idventa, u.nombre
      ORDER BY v.fecha DESC
    `, [`%${texto}%`]);
    res.json(result.rows);
  } catch (err) {
    console.error("Error en GET /ventas/vbuscar:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// 3. REGISTRAR NUEVA VENTA (Lógica Pro con Control de Stock)
router.post("/", async (req, res) => {
  const { idusuario, items, mediopago } = req.body;

  if (!idusuario || !items || items.length === 0) {
    return res.status(400).json({ error: "Datos incompletos para la venta" });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // A. CREAR CABECERA DE VENTA
    const ventaResult = await client.query(
      `INSERT INTO venta (fecha, idusuario, totalcobro, mediopago)
       VALUES (NOW(), $1, 0, $2) RETURNING idventa`,
      [idusuario, mediopago]
    );
    const idventa = ventaResult.rows[0].idventa;

    let totalVenta = 0;

    for (const item of items) {
      // B. VERIFICAR STOCK Y OBTENER PRECIO ACTUAL
      const medQuery = await client.query(
        `SELECT nombremedicamento, cantidadlote, precioventa 
         FROM inventario WHERE idmedicamento = $1 FOR UPDATE`, 
        [item.idmedicamento]
      );

      if (medQuery.rows.length === 0) throw new Error(`Medicamento ID ${item.idmedicamento} no encontrado`);
      
      const producto = medQuery.rows[0];

      // Validar Stock
      if (producto.cantidadlote < item.cantidad) {
        throw new Error(`Stock insuficiente para: ${producto.nombremedicamento}. Disponible: ${producto.cantidadlote}`);
      }

      const precioHistorico = parseFloat(producto.precioventa);
      const subtotal = item.cantidad * precioHistorico;
      totalVenta += subtotal;

      // C. INSERTAR DETALLE (SNAPSHOT)
      await client.query(
        `INSERT INTO detalleventa 
          (idventa, idmedicamento, cantidaditems, precioventa_historico, subtotal, nombremedicamento)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [idventa, item.idmedicamento, item.cantidad, precioHistorico, subtotal, producto.nombremedicamento]
      );

      // D. DESCONTAR DEL INVENTARIO
      await client.query(
        `UPDATE inventario 
         SET cantidadlote = cantidadlote - $1 
         WHERE idmedicamento = $2`,
        [item.cantidad, item.idmedicamento]
      );
    }

    // E. ACTUALIZAR TOTAL FINAL
    await client.query(
      "UPDATE venta SET totalcobro = $1 WHERE idventa = $2",
      [totalVenta, idventa]
    );

    await client.query('COMMIT');
    res.json({ message: "Venta registrada", idventa, total: totalVenta });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error("Error Venta:", err.message);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

module.exports = router;