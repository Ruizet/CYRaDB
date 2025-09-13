const express = require("express");
const router = express.Router();
const pool = require("../db");

router.get("/inventario", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT idmedicamento, nombremedicamento, presentacion, cantidadpaquetes, cantidaditems, preciounitario, fechavencimiento, fechaingreso
       FROM inventario
       WHERE cantidadpaquetes * cantidaditems > 0
       ORDER BY fechaingreso ASC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({error: "Error al obtener medicamentos"});
  }
});

router.post("/", async (req, res) => {
  const { idusuario, items, mediopago } = req.body;

  try {
    const ventaResult = await pool.query(
      `INSERT INTO venta (fecha, idusuario, totalcobro, mediopago)
       VALUES (NOW(), $1, 0, $2) RETURNING idventa`,
      [idusuario, mediopago]
    );
    const idventa = ventaResult.rows[0].idventa;

    let totalcobro = 0;

    for (const item of items) {
      const med = await pool.query(
        "SELECT preciounitario FROM inventario WHERE idmedicamento = $1",
        [item.idmedicamento]
      );

      if (med.rows.length === 0) continue;

      const precio = med.rows[0].preciounitario;
      const subtotal = item.cantidad * precio;
      totalcobro += subtotal;

      await pool.query(
        `INSERT INTO detalleventa (idventa, idmedicamento, cantidaditems)
         VALUES ($1, $2, $3)`,
        [idventa, item.idmedicamento, item.cantidad]
      );

      await pool.query(
        `UPDATE inventario
         SET cantidaditems = cantidaditems - $1
         WHERE idmedicamento = $2`,
        [item.cantidad, item.idmedicamento]
      );
    }

    await pool.query(
      "UPDATE venta SET totalcobro = $1 WHERE idVenta = $2",
      [totalcobro, idventa]
    );

    res.json({ message: "✅ Venta registrada", totalcobro,idventa });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al registrar venta" });
  }
});

module.exports = router;
