const express = require('express');
const router  = express.Router();
const pool    = require('../db');

// GET /usuarios
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT idusuario, nombre, usuario, rol FROM usuario ORDER BY idusuario ASC'
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /usuarios/:id
router.get('/:id', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT idusuario, nombre, usuario, rol FROM usuario WHERE idusuario = $1',
      [req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'No encontrado' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /usuarios/login
router.post('/login', async (req, res) => {
  const { usuario, contrasena } = req.body;
  if (!usuario || !contrasena)
    return res.status(400).json({ error: 'Usuario y contraseña requeridos' });

  try {
    const result = await pool.query(
      'SELECT * FROM usuario WHERE usuario = $1',
      [usuario]
    );
    if (!result.rows.length)
      return res.status(401).json({ error: 'Usuario no encontrado' });

    const user = result.rows[0];
    if (user.contrasena !== contrasena)
      return res.status(401).json({ error: 'Contraseña incorrecta' });

    res.json({
      idusuario: user.idusuario,
      nombre:    user.nombre,
      usuario:   user.usuario,
      rol:       user.rol
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /usuarios
router.post('/', async (req, res) => {
  const { nombre, usuario, password, rol } = req.body;
  if (!nombre || !usuario || !password || !rol)
    return res.status(400).json({ error: 'Todos los campos son obligatorios' });

  try {
    const result = await pool.query(
      `INSERT INTO usuario (nombre, usuario, contrasena, rol)
       VALUES ($1, $2, $3, $4)
       RETURNING idusuario, nombre, usuario, rol`,
      [nombre, usuario, password, rol]
    );
    res.json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505')
      return res.status(400).json({ error: 'Ese nombre de usuario ya existe' });
    res.status(500).json({ error: err.message });
  }
});

// PUT /usuarios/:id
router.put('/:id', async (req, res) => {
  const { nombre, usuario, password, rol } = req.body;
  try {
    let query, values;
    if (password && password.trim()) {
      query  = `UPDATE usuario SET nombre=$1, usuario=$2, rol=$3, contrasena=$4
                WHERE idusuario=$5 RETURNING idusuario, nombre, usuario, rol`;
      values = [nombre, usuario, rol, password, req.params.id];
    } else {
      query  = `UPDATE usuario SET nombre=$1, usuario=$2, rol=$3
                WHERE idusuario=$4 RETURNING idusuario, nombre, usuario, rol`;
      values = [nombre, usuario, rol, req.params.id];
    }
    const result = await pool.query(query, values);
    if (!result.rows.length) return res.status(404).json({ error: 'No encontrado' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /usuarios/:id
router.delete('/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM usuario WHERE idusuario = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
