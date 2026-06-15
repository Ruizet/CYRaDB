UPDATE Usuario 
SET correo = 'jruizjrocha06@gmail.com' 
WHERE idusuario = 1;

ALTER TABLE Usuario 
ALTER COLUMN correo SET NOT NULL,
ADD CONSTRAINT usuario_correo_key UNIQUE (correo),
ADD CONSTRAINT chk_solo_gmail CHECK (correo ~* '^[a-zA-Z0-9._%+-]+@gmail\.com$');

ALTER TABLE usuario
ADD COLUMN codigo_recuperacion VARCHAR(6),

SELECT pg_terminate_backend(pid) 
FROM pg_stat_activity 
WHERE datname = 'CYRaDB';

ALTER DATABASE "CYRaDB" RENAME TO "FarmaciaCyR";

SELECT * FROM Usuario;

CREATE TABLE caja_sesion (
    idcaja_sesion SERIAL PRIMARY KEY,
    idusuario INT REFERENCES usuario(idusuario),
    fecha_apertura TIMESTAMP DEFAULT NOW(),
    fecha_cierre TIMESTAMP,
    monto_apertura NUMERIC(10,2) NOT NULL,
    monto_ventas NUMERIC(10,2) DEFAULT 0.00,
    monto_cierre NUMERIC(10,2),
    estado VARCHAR(20) DEFAULT 'Abierta',    -- 'Abierta' o 'Cerrada'
    observaciones TEXT
);

CREATE TABLE detalle_caja (
    iddetalle_caja SERIAL PRIMARY KEY,
    idcaja_sesion INT REFERENCES caja_sesion(idcaja_sesion) ON DELETE CASCADE,
    fecha_movimiento TIMESTAMP DEFAULT NOW(),
    tipo_movimiento VARCHAR(20) NOT NULL, -- 'apertura', 'venta', 'reapertura', 'cierre_limpio', 'cierre_desconocido'
    monto NUMERIC(10,2) NOT NULL,
    descripcion TEXT NOT NULL -- Ej: "Venta Factura #102", "Cierre forzado de sesión", etc.
);