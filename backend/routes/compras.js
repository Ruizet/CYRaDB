const express = require('express');
const router = express.Router();
const pool = require('../db');

router.post("/", async (req, res) => {
  const { idProveedor, items } = req.body;

  try {
    const compraResult = await pool.query(
      `INSERT INTO Compra (fecha, idProveedor, totalPago)
       VALUES (NOW(), $1, 0) RETURNING idCompra`,
      [idProveedor]
    );
    const idCompra = compraResult.rows[0].idcompra;

    let totalCompra = 0;

    for (const item of items) {
      const subtotal = item.cantidad * item.precioUnitario;
      totalCompra += subtotal;

      await pool.query(
        `INSERT INTO detallecompra (idCompra, idMedicamento, cantidadItems, precioUnitario)
         VALUES ($1, $2, $3, $4)`,
        [idCompra, item.idmedicamento, item.cantidad, item.preciounitario]
      );

      await pool.query(
        `UPDATE Inventario
         SET cantidadItems = cantidadItems + $1, precioUnitario = $2
         WHERE idMedicamento = $3`,
        [item.cantidad, item.precioUnitario, item.idMedicamento]
      );
    }

    await pool.query(
      "UPDATE Compra SET totalPago = $1 WHERE idCompra = $2",
      [totalCompra, idCompra]
    );

    res.json({ message: "✅ Compra registrada", idCompra, totalCompra });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al registrar compra" });
  }
});


module.exports = router;
