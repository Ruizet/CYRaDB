const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');

const usuariosRoutes = require('./routes/usuarios');
const inventarioRoutes = require('./routes/inventario');
const ventasRoutes = require('./routes/ventas');
const comprasRoutes = require('./routes/compras');
const proveedoresRoutes = require('./routes/proveedores');

const app = express();
app.use(cors());
app.use(bodyParser.json());

app.use('/usuarios', usuariosRoutes);
app.use('/inventario', inventarioRoutes);
app.use('/ventas', ventasRoutes);
app.use('/compras', comprasRoutes);
app.use('/proveedores', proveedoresRoutes);

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
});
