const express = require("express");
const router = express.Router();
const pool = require("../db");

// 1. OBTENER TODOS LOS MEDICAMENTOS (Con Stock > 0)
router.get("/", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        idmedicamento, 
        nombremedicamento, 
        presentacion, 
        cantidadlote,      -- La nueva columna de stock real
        precioventa,       -- El precio calculado para el público
        fechavencimiento, 
        ubicacion_estante, -- Muy útil para farmacias
        fechaingreso
      FROM inventario
      WHERE cantidadlote > 0 -- Solo mostramos lo que tiene stock
      ORDER BY nombremedicamento ASC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error("Error obteniendo inventario:", err.message);
    res.status(500).json({ error: "Error del servidor" });
  }
});

// 2. BUSCAR MEDICAMENTOS (Por nombre o ID)
router.get("/buscar", async (req, res) => {
  const { nombre } = req.query; // Aunque se llame 'nombre', recibimos texto general
  
  try {
    let query = `
      SELECT 
        idmedicamento, 
        nombremedicamento, 
        presentacion, 
        cantidadlote, 
        precioventa, 
        fechavencimiento,
        ubicacion_estante
      FROM inventario
      WHERE cantidadlote > 0 
    `;
    
    let params = [];
    
    // Si envían texto, filtramos
    if (nombre) {
      // Verificamos si es un número (para buscar por ID)
      if (!isNaN(nombre)) {
        query += ` AND idmedicamento = $1`;
        params.push(nombre);
      } else {
        // Si es texto, buscamos por nombre
        query += ` AND (LOWER(nombremedicamento) LIKE LOWER($1) OR LOWER(presentacion) LIKE LOWER($1))`;
        params.push(`%${nombre}%`);
      }
    }
    
    query += ` ORDER BY nombremedicamento ASC`;

    const result = await pool.query(query, params);
    res.json(result.rows);
    
  } catch (err) {
    console.error("Error buscando:", err.message);
    res.status(500).json({ error: "Error en búsqueda" });
  }
});

module.exports = router;