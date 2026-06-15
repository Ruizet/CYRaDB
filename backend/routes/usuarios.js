const express = require('express');
const router  = express.Router();
const pool    = require('../db');
const { Resend } = require('resend');

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

const resend = new Resend(process.env.RESEND_API_KEY);

router.post('/recuperar-password', async (req, res) => {
  const { correo } = req.body;

  if (!correo) {
    return res.status(400).json({ error: 'El correo es requerido' });
  }

  try {
    const codigoVerificacion = Math.floor(100000 + Math.random() * 900000).toString();
    await pool.query(
      `UPDATE usuario 
      SET codigo_recuperacion = $1, 
          codigo_expira = NOW() + INTERVAL '15 minutes' 
      WHERE correo = $2`, 
      [codigoVerificacion, correo]
    );

    const { data, error } = await resend.emails.send({
      from: 'Farmacia C&R <onboarding@resend.dev>',
      to: correo,
      subject: 'Código de recuperación de contraseña - Farmacia C&R',
      html: `
        <div style="font-family: sans-serif; max-width: 500px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
          <h2 style="color: #0284c7; text-align: center;">Farmacia C&R</h2>
          <p>Hola,</p>
          <p>Has solicitado restablecer tu contraseña para el sistema de gestión <strong> C&RaDB</strong>. Usa el siguiente código de verificación de un solo uso:</p>
          <div style="background-color: #f1f5f9; font-size: 24px; font-weight: bold; text-align: center; letter-spacing: 4px; padding: 15px; margin: 20px 0; border-radius: 6px; color: #1e293b;">
            ${codigoVerificacion}
          </div>
          <p style="font-size: 12px; color: #64748b;">Este código expirará en 15 minutos.</p>
        </div>
      `,
    });

    if (error) {
      console.error('Error de Resend:', error);
      return res.status(400).json({ error: 'No se pudo despachar el correo' });
    }

    res.json({ mensaje: 'Código enviado con éxito' });

  } catch (error) {
    console.error('Error en recuperar-password:', error);
    res.status(500).json({ error: 'Error interno en el servidor' });
  }
});

router.post('/restablecer-password', async (req, res) => {
  const { correo, codigo, nuevaClave } = req.body;

  if (!correo || !codigo || !nuevaClave) {
    return res.status(400).json({ error: 'Todos los campos son obligatorios' });
  }

  try {
    const resultado = await pool.query(
      `SELECT idusuario 
       FROM usuario 
       WHERE correo = $1 
         AND codigo_recuperacion = $2 
         AND NOW() < codigo_expira`, 
      [correo, codigo]
    );

    if (resultado.rows.length === 0) {
      return res.status(400).json({ 
        error: 'El código es incorrecto, no coincide con el usuario o ya ha caducado.' 
      });
    }

    const idUsuario = resultado.rows[0].idusuario;

    await pool.query(
      `UPDATE usuario 
       SET contrasena = $1, 
           codigo_recuperacion = NULL, 
           codigo_expira = NULL 
       WHERE idusuario = $2`,
      [nuevaClave, idUsuario]
    );

    res.json({ mensaje: 'Contraseña actualizada correctamente' });

  } catch (error) {
    console.error('Error en restablecer-password:', error);
    res.status(500).json({ error: 'Error interno en el servidor' });
  }
});

module.exports = router;
