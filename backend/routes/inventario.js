const express = require('express');
const router = express.Router();
const pool = require('../db');

router.get('/', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM Inventario ORDER BY idMedicamento ASC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/ingresar', async (req, res) => {
  const { nombreMedicamento, presentacion, cantidadPaquetes, cantidadItems, fechaVencimiento, precioUnitario } = req.body;

  try {
    const result = await pool.query(
      `INSERT INTO Inventario 
       (nombreMedicamento, presentacion, cantidadPaquetes, cantidadItems, fechaIngreso, fechaVencimiento, precioUnitario)
       VALUES ($1, $2, $3, $4, NOW(), $5, $6) RETURNING *`,
      [nombreMedicamento, presentacion, cantidadPaquetes, cantidadItems, fechaVencimiento, precioUnitario]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al ingresar medicamento" });
  }
});

router.put('/actualizar/:id', async (req, res) => {
  const { id } = req.params;
  const { cantidadItems } = req.body;
  try {
    const result = await pool.query(
      `UPDATE Inventario SET cantidadItems=$1 WHERE idMedicamento=$2 RETURNING *`,
      [cantidadItems, id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const result = await pool.query("DELETE FROM Inventario WHERE idMedicamento=$1 RETURNING *", [req.params.id]);
    if(result.rowCount === 0){
      return res.status(404).json({error: "Medicamento no encontrado"});
    }
    res.json({message: "Medicamento eliminado"});
  } catch (err) {
    console.error(err);
    res.status(500).json({error: "Error al eliminar"});
  }
});


module.exports = router;
