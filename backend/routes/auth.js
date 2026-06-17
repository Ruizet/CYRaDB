const express = require('express');
const router  = express.Router();
const crypto  = require('crypto');
const pool    = require('../db');
const { Resend } = require('resend');

const FROM_EMAIL = process.env.FROM_EMAIL || 'onboarding@resend.dev';
const APP_URL    = process.env.APP_URL    || 'http://localhost:3000';

// Inicializar SDK de Resend
const resend = new Resend(process.env.RESEND_API_KEY);

// ── Helpers ─────────────────────────────────────────────────

function generarToken() {
  return crypto.randomBytes(32).toString('hex');
}

async function enviarEmail(to, subject, html) {
  if (!process.env.RESEND_API_KEY) throw new Error('RESEND_API_KEY no configurada');

  const { data, error } = await resend.emails.send({
    from: FROM_EMAIL,
    to: to,
    subject: subject,
    html: html
  });

  if (error) {
    throw new Error(error.message);
  }
  return data;
}

function emailResetHtml(nombre, resetUrl) {
  return `
<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0d1b2a;font-family:system-ui,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 16px">
    <tr><td align="center">
      <table width="100%" style="max-width:480px;background:#1b263b;border-radius:14px;border:1px solid #e63946;overflow:hidden">
        <tr>
          <td style="background:#e63946;padding:28px 32px;text-align:center">
            <div style="width:44px;height:44px;background:rgba(255,255,255,.2);border-radius:10px;display:inline-flex;align-items:center;justify-content:center;margin-bottom:10px">
              <span style="font-size:24px">🏥</span>
            </div>
            <div style="color:#ffffff;font-size:20px;font-weight:600;letter-spacing:-.3px">Farmacia C&R</div>
          </td>
        </tr>
        <tr>
          <td style="padding:32px">
            <p style="margin:0 0 8px;font-size:18px;font-weight:600;color:#ffffff">Hola, ${nombre}</p>
            <p style="margin:0 0 24px;font-size:15px;color:#cbd5e1;line-height:1.6">
              Recibimos una solicitud para restablecer la contraseña de tu cuenta en el sistema de gestión.
            </p>
            <div style="text-align:center;margin-bottom:24px">
              <a href="${resetUrl}"
                 style="display:inline-block;background:#e63946;color:#ffffff;text-decoration:none;padding:13px 32px;border-radius:10px;font-size:15px;font-weight:500">
                Restablecer contraseña
              </a>
            </div>
            <p style="margin:0 0 8px;font-size:13px;color:#94a3b8;line-height:1.6">
              Este enlace expira en <strong>1 hora</strong>. Si no solicitaste este cambio, puedes ignorar este correo.
            </p>
            <div style="background:#0f172a;border-radius:8px;padding:10px 14px;margin-top:16px">
              <p style="margin:0;font-size:12px;color:#94a3b8">O copia este enlace en tu navegador:</p>
              <p style="margin:4px 0 0;font-size:12px;color:#e63946;word-break:break-all">${resetUrl}</p>
            </div>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// ── POST /auth/solicitar-reset ───────────────────────────────
router.post('/solicitar-reset', async (req, res) => {
  const { usuario } = req.body;
  if (!usuario) return res.status(400).json({ error: 'Usuario requerido' });

  try {
    const result = await pool.query(
      'SELECT idusuario, nombre, email FROM usuario WHERE usuario = $1',
      [usuario]
    );

    if (!result.rows.length || !result.rows[0].email) {
      return res.json({ ok: true, msg: 'Recibiras el enlace en unos minutos.' });
    }

    const user = result.rows[0];

    await pool.query(
      'UPDATE reset_token SET usado = TRUE WHERE idusuario = $1 AND usado = FALSE',
      [user.idusuario]
    );

    const token = generarToken();
    await pool.query(
      'INSERT INTO reset_token (idusuario, token) VALUES ($1, $2)',
      [user.idusuario, token]
    );

    const resetUrl = `${APP_URL}/reset-password.html?token=${token}`;
    await enviarEmail(
      user.email,
      'Restablecer contraseña — Farmacia C&R',
      emailResetHtml(user.nombre, resetUrl)
    );

    res.json({ ok: true, msg: 'Enlace enviado.' });

  } catch (err) {
    console.error('Error en solicitar-reset:', err.message);
    res.status(500).json({ error: 'Error enviando el correo. Intenta más tarde.' });
  }
});

// ── GET /auth/verificar-token?token=xxx ─────────────────────
router.get('/verificar-token', async (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(400).json({ error: 'Token requerido' });

  try {
    const result = await pool.query(
      `SELECT rt.idusuario, u.nombre, u.usuario
       FROM reset_token rt
       JOIN usuario u ON rt.idusuario = u.idusuario
       WHERE rt.token = $1 AND rt.usado = FALSE AND rt.expira_en > NOW()`,
      [token]
    );

    if (!result.rows.length)
      return res.status(400).json({ error: 'El enlace es inválido o ya expiró.' });

    res.json({ ok: true, nombre: result.rows[0].nombre, usuario: result.rows[0].usuario });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /auth/reset-password ────────────────────────────────
router.post('/reset-password', async (req, res) => {
  const { token, nuevaContrasena } = req.body;
  if (!token || !nuevaContrasena)
    return res.status(400).json({ error: 'Token y nueva contraseña requeridos' });

  if (nuevaContrasena.length < 6)
    return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });

  try {
    const result = await pool.query(
      `SELECT idusuario FROM reset_token WHERE token = $1 AND usado = FALSE AND expira_en > NOW()`,
      [token]
    );

    if (!result.rows.length)
      return res.status(400).json({ error: 'El enlace es inválido o ya expiró.' });

    const { idusuario } = result.rows[0];

    await pool.query('BEGIN');
    await pool.query('UPDATE usuario SET contrasena = $1 WHERE idusuario = $2', [nuevaContrasena, idusuario]);
    await pool.query('UPDATE reset_token SET usado = TRUE WHERE token = $1', [token]);
    await pool.query('COMMIT');

    res.json({ ok: true, msg: 'Contraseña actualizada correctamente.' });
  } catch (err) {
    await pool.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;