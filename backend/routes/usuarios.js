const express = require('express');
const router = express.Router();
const pool = require('../db');
// const bcrypt = require('bcrypt'); // YA NO LO USAMOS

// 1. LISTAR TODOS (Para la tabla de gestión)
router.get('/', async (req, res) => {
  try {
    const result = await pool.query('SELECT idusuario, nombre, usuario, rol FROM usuario ORDER BY idusuario ASC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. OBTENER UN SOLO USUARIO (Para editar)
router.get('/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT idusuario, nombre, usuario, rol, contrasena FROM usuario WHERE idusuario = $1', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: "Usuario no encontrado" });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. LOGIN (Lógica Simplificada)
router.post('/login', async (req, res) => {
  const { usuario, contrasena } = req.body;
  
  try {
    // Buscamos el usuario
    const result = await pool.query('SELECT * FROM usuario WHERE usuario = $1', [usuario]);

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Usuario no encontrado' });
    }

    const user = result.rows[0];

    // --- CAMBIO AQUÍ: Comparación directa de texto ---
    if (user.contrasena !== contrasena) {
      return res.status(401).json({ error: 'Contraseña incorrecta' });
    }
    // -----------------------------------------------

    // Si coincide, entramos
    res.json({
      idusuario: user.idusuario,
      nombre: user.nombre,
      usuario: user.usuario,
      rol: user.rol
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error de servidor' });
  }
});

// 4. CREAR USUARIO (Sin encriptar)
router.post("/", async (req, res) => {
  const { nombre, usuario, password, rol } = req.body; 
  
  try {
    // Guardamos la contraseña DIRECTAMENTE como viene
    const result = await pool.query(
      "INSERT INTO usuario (nombre, usuario, contrasena, rol) VALUES ($1, $2, $3, $4) RETURNING idusuario, nombre, usuario, rol",
      [nombre, usuario, password, rol]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 5. ACTUALIZAR USUARIO (Sin encriptar)
router.put("/:id", async (req, res) => {
  const { id } = req.params;
  const { nombre, usuario, password, rol } = req.body;
  
  try {
    let query, values;

    // Si el usuario escribió una nueva contraseña, la actualizamos tal cual
    if (password && password.trim() !== "") {
      query = "UPDATE usuario SET nombre=$1, usuario=$2, rol=$3, contrasena=$4 WHERE idusuario=$5 RETURNING idusuario, nombre, rol";
      values = [nombre, usuario, rol, password, id];
    } else {
      // Si dejó el campo vacío, mantenemos la vieja
      query = "UPDATE usuario SET nombre=$1, usuario=$2, rol=$3 WHERE idusuario=$4 RETURNING idusuario, nombre, rol";
      values = [nombre, usuario, rol, id];
    }

    const result = await pool.query(query, values);
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 6. ELIMINAR USUARIO
router.delete("/:id", async (req, res) => {
  try {
    await pool.query("DELETE FROM usuario WHERE idusuario=$1", [req.params.id]);
    res.json({ message: "Eliminado" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;