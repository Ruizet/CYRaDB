const express = require('express');
const router = express.Router();
const pool = require('../db');

// RUTA PARA REGISTRAR NUEVA COMPRA (SOPORTE PARA LOTES)
router.post("/", async (req, res) => {
  const { idProveedor, idUsuario, items } = req.body;

  if (!idProveedor || !idUsuario || !items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: "Faltan datos: proveedor, usuario o ítems" });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // 1. CREAR COMPRA
    const compraResult = await client.query(
      `INSERT INTO compra (fecha, idproveedor, idusuario, totalpago)
       VALUES (NOW(), $1, $2, 0) RETURNING idcompra`,
      [idProveedor, idUsuario]
    );
    const idCompra = compraResult.rows[0].idcompra;

    let totalCompra = 0;

    for (const item of items) {
      const {
        nombreMedicamento,
        presentacion,
        cantidadTotal,    
        costoTotalLote,   
        fechaVencimiento,
        ubicacionEstante
      } = item;

      if (!nombreMedicamento || !cantidadTotal || !costoTotalLote || !fechaVencimiento) {
        throw new Error(`Faltan datos en el medicamento: ${nombreMedicamento}`);
      }

      const costoLoteFloat = parseFloat(costoTotalLote);
      const cantidadFloat = parseInt(cantidadTotal);
      const costoUnitario = costoLoteFloat / cantidadFloat;
      const precioVentaCalculado = costoUnitario / 0.7;

      totalCompra += costoLoteFloat;

      // === CAMBIO CLAVE AQUÍ ===
      // Ahora buscamos coincidencia por Nombre, Presentación Y FECHA DE VENCIMIENTO
      // Si la fecha es distinta, se considera un producto/lote nuevo.
      let medResult = await client.query(
        `SELECT idmedicamento FROM inventario 
         WHERE LOWER(nombremedicamento) = LOWER($1) 
           AND LOWER(presentacion) = LOWER($2)
           AND fechavencimiento = $3`, // <--- ESTA LÍNEA HACE LA MAGIA
        [nombreMedicamento, presentacion, fechaVencimiento]
      );

      let idMedicamento;

      if (medResult.rows.length === 0) {
        // A) NO EXISTE ESE LOTE ESPECÍFICO: CREAMOS NUEVA FILA
        const nuevoMed = await client.query(
          `INSERT INTO inventario 
            (nombremedicamento, presentacion, cantidadlote, costolote, fechavencimiento, precioventa, fechaingreso, ubicacion_estante)
           VALUES ($1, $2, $3, $4, $5, $6, NOW(), $7) 
           RETURNING idmedicamento`,
          [
            nombreMedicamento, 
            presentacion, 
            cantidadFloat, 
            costoLoteFloat, 
            fechaVencimiento, 
            precioVentaCalculado.toFixed(2),
            ubicacionEstante
          ]
        );
        idMedicamento = nuevoMed.rows[0].idmedicamento;
      } else {
        // B) YA EXISTE ESE LOTE (MISMO NOMBRE Y MISMA FECHA): SUMAMOS STOCK Y COSTOS
        idMedicamento = medResult.rows[0].idmedicamento;

        await client.query(
          `UPDATE inventario
           SET cantidadlote = cantidadlote + $1,  -- Sumamos la cantidad nueva
               costolote = costolote + $2,        -- OJO: AQUI SUMAMOS EL COSTO NUEVO AL VIEJO
               precioventa = $3,                  -- Actualizamos el precio de venta al del último ingreso
               ubicacion_estante = COALESCE($4, ubicacion_estante)
           WHERE idmedicamento = $5`,
          [
            cantidadFloat, 
            costoLoteFloat, // El costo de ESTA compra se suma al acumulado
            precioVentaCalculado.toFixed(2), 
            ubicacionEstante, 
            idMedicamento
          ]
        );
      }

      // INSERTAR DETALLE
      await client.query(
        `INSERT INTO detallecompra 
          (idcompra, idmedicamento, cantidaditems, costounitario, subtotal, nombremedicamento)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          idCompra, 
          idMedicamento, 
          cantidadFloat, 
          costoUnitario.toFixed(2), 
          costoLoteFloat,
          nombreMedicamento
        ]
      );
    }

    await client.query(
      `UPDATE compra SET totalpago = $1 WHERE idcompra = $2`,
      [totalCompra, idCompra]
    );

    await client.query('COMMIT');

    res.json({
      message: "Compra registrada con éxito",
      idCompra,
      totalCompra: parseFloat(totalCompra.toFixed(2))
    });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error("Error en compra:", err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

router.get("/", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        c.idcompra, 
        c.fecha, 
        c.totalpago,
        p.nombre AS proveedor, 
        u.nombre AS usuario,
        -- AQUÍ ESTÁ LA MAGIA: Agrupamos los productos en una lista JSON
        COALESCE(
          json_agg(
            json_build_object(
              'nombre', dc.nombremedicamento,
              'cantidad', dc.cantidaditems,
              'subtotal', dc.subtotal
            )
          ) FILTER (WHERE dc.idmedicamento IS NOT NULL), 
          '[]'
        ) AS items
      FROM compra c
      JOIN proveedor p ON c.idproveedor = p.idproveedor
      LEFT JOIN usuario u ON c.idusuario = u.idusuario
      LEFT JOIN detallecompra dc ON c.idcompra = dc.idcompra
      GROUP BY c.idcompra, p.nombre, u.nombre
      ORDER BY c.fecha DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error("Error en GET /compras:", err);
    res.status(500).json({ error: err.message });
  }
});

// ... (Mantén tu ruta GET /buscar igual, o actualízala con la misma lógica si quieres) ...
// Para búsqueda rápida con detalles:
router.get("/buscar", async (req, res) => {
  const { texto } = req.query;
  try {
    const result = await pool.query(`
      SELECT 
        c.idcompra, c.fecha, c.totalpago,
        p.nombre AS proveedor, u.nombre AS usuario,
        COALESCE(json_agg(json_build_object('nombre', dc.nombremedicamento)) FILTER (WHERE dc.idmedicamento IS NOT NULL), '[]') AS items
      FROM compra c
      JOIN proveedor p ON c.idproveedor = p.idproveedor
      LEFT JOIN usuario u ON c.idusuario = u.idusuario
      LEFT JOIN detallecompra dc ON c.idcompra = dc.idcompra
      WHERE CAST(c.idcompra AS TEXT) ILIKE $1 OR p.nombre ILIKE $1
      GROUP BY c.idcompra, p.nombre, u.nombre
      ORDER BY c.fecha DESC
    `, [`%${texto}%`]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;