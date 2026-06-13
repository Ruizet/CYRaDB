const express = require('express');
const router  = express.Router();
const pool    = require('../db');

// GET /config  — todas las claves
router.get('/', async (req, res) => {
  try {
    const result = await pool.query('SELECT clave, valor FROM configuracion ORDER BY clave');
    // Devolver como objeto plano  { nombre_farmacia: 'Farmacia C&R', ... }
    const config = {};
    result.rows.forEach(r => { config[r.clave] = r.valor; });
    res.json(config);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /config  — actualizar una o varias claves  { clave: valor, ... }
router.put('/', async (req, res) => {
  const entries = Object.entries(req.body);
  if (entries.length === 0) return res.status(400).json({ error: 'Sin datos' });

  try {
    for (const [clave, valor] of entries) {
      await pool.query(
        `INSERT INTO configuracion (clave, valor) VALUES ($1, $2)
         ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor`,
        [clave, String(valor)]
      );
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
