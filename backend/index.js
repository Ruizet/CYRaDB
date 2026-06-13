const express = require('express');
const cors    = require('cors');
const path    = require('path');
const { exec } = require('child_process');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend')));

app.use('/usuarios',    require('./routes/usuarios'));
app.use('/inventario',  require('./routes/inventario'));
app.use('/ventas',      require('./routes/ventas'));
app.use('/sesiones',    require('./routes/sesiones'));
app.use('/compras',     require('./routes/compras'));
app.use('/proveedores', require('./routes/proveedores'));
app.use('/dashboard',   require('./routes/dashboard'));
app.use('/config',      require('./routes/config'));

app.get('/', (req, res) =>
  res.sendFile(path.join(__dirname, '../frontend/login.html'))
);

const PORT = process.env.PORT || 3000;
const URL  = `http://localhost:${PORT}`;

app.listen(PORT, () => {
  console.log(`✓ Servidor corriendo en ${URL}`);

  // Abrir navegador automáticamente según el sistema operativo
  const cmd =
    process.platform === 'win32'  ? `start ${URL}` :
    process.platform === 'darwin' ? `open ${URL}`  :
                                    `xdg-open ${URL}`;

  // Pequeño delay para que el servidor esté listo antes de abrir
  setTimeout(() => exec(cmd, err => {
    if (err) console.log(`Abre manualmente: ${URL}`);
  }), 600);
});
