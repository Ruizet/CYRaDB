-- ============================================================
--  FARMACIA C&R  |  Schema PostgreSQL completo
--  Incluye: tablas, vistas, funciones, triggers, procedimientos
-- ============================================================

-- Extensión para UUID (opcional, usamos SERIAL por simplicidad)
-- CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- 1. TABLAS BASE
-- ============================================================

CREATE TABLE IF NOT EXISTS usuario (
  idusuario   SERIAL PRIMARY KEY,
  nombre      VARCHAR(100) NOT NULL,
  usuario     VARCHAR(50)  NOT NULL UNIQUE,
  contrasena  VARCHAR(255) NOT NULL,
  rol         VARCHAR(20)  NOT NULL DEFAULT 'empleado'
                CHECK (rol IN ('empleado','administrador')),
  activo      BOOLEAN NOT NULL DEFAULT TRUE,
  creado_en   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS proveedor (
  idproveedor SERIAL PRIMARY KEY,
  nombre      VARCHAR(150) NOT NULL,
  contacto    VARCHAR(200),
  activo      BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS inventario (
  idmedicamento      SERIAL PRIMARY KEY,
  nombremedicamento  VARCHAR(200) NOT NULL,
  presentacion       VARCHAR(100) NOT NULL DEFAULT 'unidad',
  descripcion        TEXT,                          -- dosis, concentración, etc.
  cantidadlote       INT          NOT NULL DEFAULT 0 CHECK (cantidadlote >= 0),
  costolote          NUMERIC(12,2) NOT NULL DEFAULT 0,
  precioventa        NUMERIC(12,2) NOT NULL DEFAULT 0,
  margen_porcentaje  NUMERIC(5,2)  NOT NULL DEFAULT 30, -- margen configurable
  fechavencimiento   DATE,
  fechaingreso       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  ubicacion_estante  VARCHAR(50),
  activo             BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS compra (
  idcompra    SERIAL PRIMARY KEY,
  fecha       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  idproveedor INT NOT NULL REFERENCES proveedor(idproveedor),
  idusuario   INT NOT NULL REFERENCES usuario(idusuario),
  totalpago   NUMERIC(12,2) NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS detallecompra (
  iddetallecompra SERIAL PRIMARY KEY,
  idcompra        INT  NOT NULL REFERENCES compra(idcompra) ON DELETE CASCADE,
  idmedicamento   INT  NOT NULL REFERENCES inventario(idmedicamento),
  nombremedicamento VARCHAR(200),   -- snapshot
  cantidaditems   INT          NOT NULL,
  costounitario   NUMERIC(12,2) NOT NULL,
  subtotal        NUMERIC(12,2) NOT NULL
);

-- Sesiones de venta (una sesión = un cliente / una "pestaña")
CREATE TABLE IF NOT EXISTS sesion_venta (
  idsesion      SERIAL PRIMARY KEY,
  nombre_cliente VARCHAR(100) DEFAULT 'Cliente',
  idusuario     INT NOT NULL REFERENCES usuario(idusuario),
  creado_en     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  cerrado_en    TIMESTAMPTZ,
  estado        VARCHAR(20) NOT NULL DEFAULT 'abierta'
                  CHECK (estado IN ('abierta','confirmada','cancelada'))
);

-- Ítems temporales de sesión (el "carrito")
CREATE TABLE IF NOT EXISTS sesion_item (
  iditem        SERIAL PRIMARY KEY,
  idsesion      INT NOT NULL REFERENCES sesion_venta(idsesion) ON DELETE CASCADE,
  idmedicamento INT NOT NULL REFERENCES inventario(idmedicamento),
  cantidad      INT NOT NULL CHECK (cantidad > 0),
  precio_snap   NUMERIC(12,2) NOT NULL,  -- precio al momento de agregar
  UNIQUE (idsesion, idmedicamento)
);

CREATE TABLE IF NOT EXISTS venta (
  idventa     SERIAL PRIMARY KEY,
  fecha       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  idusuario   INT NOT NULL REFERENCES usuario(idusuario),
  idsesion    INT REFERENCES sesion_venta(idsesion),
  totalcobro  NUMERIC(12,2) NOT NULL DEFAULT 0,
  mediopago   VARCHAR(30) NOT NULL DEFAULT 'efectivo'
                CHECK (mediopago IN ('efectivo','tarjeta','transferencia')),
  nombre_cliente VARCHAR(100) DEFAULT 'Cliente'
);

CREATE TABLE IF NOT EXISTS detalleventa (
  iddetalleventa        SERIAL PRIMARY KEY,
  idventa               INT  NOT NULL REFERENCES venta(idventa) ON DELETE CASCADE,
  idmedicamento         INT  NOT NULL REFERENCES inventario(idmedicamento),
  nombremedicamento     VARCHAR(200),  -- snapshot
  cantidaditems         INT  NOT NULL,
  precioventa_historico NUMERIC(12,2) NOT NULL,
  subtotal              NUMERIC(12,2) NOT NULL
);

-- Tabla de configuración global de la farmacia
CREATE TABLE IF NOT EXISTS configuracion (
  clave  VARCHAR(100) PRIMARY KEY,
  valor  TEXT NOT NULL
);

INSERT INTO configuracion (clave, valor) VALUES
  ('nombre_farmacia', 'Farmacia C&R'),
  ('telefono',        ''),
  ('direccion',       ''),
  ('margen_defecto',  '30')
ON CONFLICT (clave) DO NOTHING;


-- ============================================================
-- 2. ÍNDICES
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_inv_nombre   ON inventario (LOWER(nombremedicamento));
CREATE INDEX IF NOT EXISTS idx_inv_vence    ON inventario (fechavencimiento) WHERE activo = TRUE;
CREATE INDEX IF NOT EXISTS idx_inv_stock    ON inventario (cantidadlote)     WHERE activo = TRUE;
CREATE INDEX IF NOT EXISTS idx_venta_fecha  ON venta (fecha DESC);
CREATE INDEX IF NOT EXISTS idx_compra_fecha ON compra (fecha DESC);
CREATE INDEX IF NOT EXISTS idx_sesion_est   ON sesion_venta (estado) WHERE estado = 'abierta';


-- ============================================================
-- 3. VISTAS
-- ============================================================

-- Vista completa del inventario con estado calculado
CREATE OR REPLACE VIEW v_inventario AS
SELECT
  i.idmedicamento,
  i.nombremedicamento,
  i.presentacion,
  i.descripcion,
  i.cantidadlote,
  i.costolote,
  i.precioventa,
  i.margen_porcentaje,
  i.fechavencimiento,
  i.fechaingreso,
  i.ubicacion_estante,
  CASE
    WHEN i.fechavencimiento IS NULL THEN 'sin_fecha'
    WHEN i.fechavencimiento < CURRENT_DATE THEN 'vencido'
    WHEN i.fechavencimiento <= CURRENT_DATE + INTERVAL '30 days' THEN 'critico'
    WHEN i.fechavencimiento <= CURRENT_DATE + INTERVAL '90 days' THEN 'proximo'
    ELSE 'vigente'
  END AS estado_vencimiento,
  CASE
    WHEN i.cantidadlote = 0 THEN 'agotado'
    WHEN i.cantidadlote < 10 THEN 'bajo'
    ELSE 'normal'
  END AS estado_stock,
  (i.cantidadlote * i.precioventa) AS valor_inventario
FROM inventario i
WHERE i.activo = TRUE;

-- Vista de alertas del dashboard
CREATE OR REPLACE VIEW v_alertas AS
SELECT
  'vencimiento' AS tipo,
  idmedicamento::TEXT AS referencia_id,
  nombremedicamento || ' — ' || presentacion AS descripcion,
  CASE
    WHEN fechavencimiento < CURRENT_DATE THEN 'critico'
    WHEN fechavencimiento <= CURRENT_DATE + INTERVAL '30 days' THEN 'critico'
    ELSE 'advertencia'
  END AS nivel,
  fechavencimiento::TEXT AS detalle
FROM inventario
WHERE activo = TRUE
  AND fechavencimiento IS NOT NULL
  AND fechavencimiento <= CURRENT_DATE + INTERVAL '90 days'

UNION ALL

SELECT
  'stock' AS tipo,
  idmedicamento::TEXT AS referencia_id,
  nombremedicamento || ' — ' || presentacion AS descripcion,
  CASE WHEN cantidadlote = 0 THEN 'critico' ELSE 'advertencia' END AS nivel,
  cantidadlote::TEXT || ' unidades' AS detalle
FROM inventario
WHERE activo = TRUE
  AND cantidadlote < 10;

-- Vista para historial de ventas con detalle
CREATE OR REPLACE VIEW v_ventas_detalle AS
SELECT
  v.idventa,
  v.fecha,
  v.totalcobro,
  v.mediopago,
  v.nombre_cliente,
  u.nombre AS vendedor,
  COALESCE(
    json_agg(
      json_build_object(
        'nombre',    dv.nombremedicamento,
        'cantidad',  dv.cantidaditems,
        'precio',    dv.precioventa_historico,
        'subtotal',  dv.subtotal
      )
    ) FILTER (WHERE dv.iddetalleventa IS NOT NULL),
    '[]'
  ) AS items
FROM venta v
JOIN usuario u ON v.idusuario = u.idusuario
LEFT JOIN detalleventa dv ON v.idventa = dv.idventa
GROUP BY v.idventa, u.nombre;

-- Vista de resumen de sesiones abiertas (para el POS multi-cliente)
CREATE OR REPLACE VIEW v_sesiones_abiertas AS
SELECT
  s.idsesion,
  s.nombre_cliente,
  s.creado_en,
  u.nombre AS vendedor,
  COUNT(si.iditem)      AS cantidad_items,
  COALESCE(SUM(si.cantidad * si.precio_snap), 0) AS total_parcial
FROM sesion_venta s
JOIN usuario u ON s.idusuario = u.idusuario
LEFT JOIN sesion_item si ON s.idsesion = si.idsesion
WHERE s.estado = 'abierta'
GROUP BY s.idsesion, s.nombre_cliente, s.creado_en, u.nombre;


-- ============================================================
-- 4. FUNCIONES
-- ============================================================

-- Calcula el precio de venta dado el costo unitario y margen
CREATE OR REPLACE FUNCTION fn_calcular_precio_venta(
  p_costo_unitario NUMERIC,
  p_margen_pct     NUMERIC
) RETURNS NUMERIC AS $$
BEGIN
  IF p_margen_pct <= 0 OR p_margen_pct >= 100 THEN
    RAISE EXCEPTION 'Margen debe estar entre 1 y 99%%';
  END IF;
  -- precio = costo / (1 - margen%)   =>  garantiza el margen sobre el precio de venta
  -- Alternativa simple: precio = costo * (1 + margen/100)   => margen sobre el costo
  -- Usamos la segunda (más común en farmacias pequeñas):
  RETURN ROUND(p_costo_unitario * (1 + p_margen_pct / 100.0), 2);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Obtiene el margen por defecto de configuración
CREATE OR REPLACE FUNCTION fn_margen_defecto() RETURNS NUMERIC AS $$
  SELECT valor::NUMERIC FROM configuracion WHERE clave = 'margen_defecto';
$$ LANGUAGE sql STABLE;

-- Resumen del dashboard (KPIs del día)
CREATE OR REPLACE FUNCTION fn_dashboard_hoy()
RETURNS TABLE (
  ventas_hoy         INT,
  ingresos_hoy       NUMERIC,
  alertas_criticas   INT,
  sesiones_abiertas  INT,
  productos_agotados INT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    (SELECT COUNT(*)::INT   FROM venta  WHERE fecha::DATE = CURRENT_DATE),
    (SELECT COALESCE(SUM(totalcobro), 0) FROM venta WHERE fecha::DATE = CURRENT_DATE),
    (SELECT COUNT(*)::INT   FROM v_alertas WHERE nivel = 'critico'),
    (SELECT COUNT(*)::INT   FROM sesion_venta WHERE estado = 'abierta'),
    (SELECT COUNT(*)::INT   FROM inventario  WHERE activo = TRUE AND cantidadlote = 0);
END;
$$ LANGUAGE plpgsql STABLE;


-- ============================================================
-- 5. TRIGGERS
-- ============================================================

-- TRIGGER 1: Actualizar precio de venta automáticamente al ingresar
--            un lote, pero solo si el usuario no puso precio manual.
CREATE OR REPLACE FUNCTION trg_fn_calcular_precio_auto()
RETURNS TRIGGER AS $$
DECLARE
  v_costo_unit NUMERIC;
BEGIN
  -- Solo recalcula si precioventa no fue seteado manualmente (= 0 o NULL)
  IF NEW.precioventa IS NULL OR NEW.precioventa = 0 THEN
    IF NEW.cantidadlote > 0 THEN
      v_costo_unit := NEW.costolote / NEW.cantidadlote;
      NEW.precioventa := fn_calcular_precio_venta(v_costo_unit, NEW.margen_porcentaje);
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_precio_auto
BEFORE INSERT OR UPDATE OF costolote, cantidadlote, margen_porcentaje
ON inventario
FOR EACH ROW EXECUTE FUNCTION trg_fn_calcular_precio_auto();

-- TRIGGER 2: Evitar que cantidadlote baje de cero (doble seguro)
CREATE OR REPLACE FUNCTION trg_fn_stock_no_negativo()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.cantidadlote < 0 THEN
    RAISE EXCEPTION 'Stock insuficiente para el medicamento ID %: disponible %, solicitado %',
      NEW.idmedicamento, OLD.cantidadlote, OLD.cantidadlote - NEW.cantidadlote;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_stock_no_negativo
BEFORE UPDATE OF cantidadlote ON inventario
FOR EACH ROW EXECUTE FUNCTION trg_fn_stock_no_negativo();

-- TRIGGER 3: Al cerrar (cancelar) una sesión, devolver stock reservado
--            (Solo aplica si implementamos reserva de stock; aquí dejamos
--             la estructura lista para esa expansión futura)
-- CREATE OR REPLACE TRIGGER trg_devolver_stock_cancelacion ...


-- ============================================================
-- 6. STORED PROCEDURES (LÓGICA DE NEGOCIO CRÍTICA)
-- ============================================================

-- Procedimiento: Registrar una compra completa con múltiples ítems
-- Parámetros: JSON array de ítems
CREATE OR REPLACE PROCEDURE sp_registrar_compra(
  p_id_proveedor  INT,
  p_id_usuario    INT,
  p_items         JSON,        -- [{nombreMedicamento, presentacion, descripcion, cantidadTotal, costoTotalLote, margenPct, precioVentaManual, fechaVencimiento, ubicacionEstante}]
  OUT p_id_compra INT,
  OUT p_total     NUMERIC
) AS $$
DECLARE
  v_item         JSON;
  v_id_med       INT;
  v_costo_unit   NUMERIC;
  v_precio_venta NUMERIC;
  v_margen       NUMERIC;
  v_cant         INT;
  v_costo_lote   NUMERIC;
BEGIN
  p_total := 0;

  -- Crear cabecera de compra
  INSERT INTO compra (idproveedor, idusuario, totalpago)
  VALUES (p_id_proveedor, p_id_usuario, 0)
  RETURNING idcompra INTO p_id_compra;

  -- Iterar sobre cada medicamento del JSON
  FOR v_item IN SELECT * FROM json_array_elements(p_items)
  LOOP
    v_cant       := (v_item->>'cantidadTotal')::INT;
    v_costo_lote := (v_item->>'costoTotalLote')::NUMERIC;
    v_costo_unit := v_costo_lote / v_cant;

    -- Margen: usa el del ítem si viene, si no el de configuración
    v_margen := COALESCE(NULLIF((v_item->>'margenPct')::NUMERIC, 0), fn_margen_defecto());

    -- Precio de venta: usa manual si viene, si no calcula
    IF (v_item->>'precioVentaManual') IS NOT NULL
       AND (v_item->>'precioVentaManual')::NUMERIC > 0 THEN
      v_precio_venta := (v_item->>'precioVentaManual')::NUMERIC;
    ELSE
      v_precio_venta := fn_calcular_precio_venta(v_costo_unit, v_margen);
    END IF;

    -- Buscar si ya existe ese lote exacto (nombre + presentacion + vencimiento)
    SELECT idmedicamento INTO v_id_med
    FROM inventario
    WHERE LOWER(nombremedicamento) = LOWER(v_item->>'nombreMedicamento')
      AND LOWER(presentacion)      = LOWER(v_item->>'presentacion')
      AND (
        (fechavencimiento IS NULL AND (v_item->>'fechaVencimiento') IS NULL)
        OR fechavencimiento = (v_item->>'fechaVencimiento')::DATE
      )
      AND activo = TRUE
    LIMIT 1;

    IF v_id_med IS NULL THEN
      -- Nuevo lote: insertar fila en inventario
      INSERT INTO inventario (
        nombremedicamento, presentacion, descripcion,
        cantidadlote, costolote, precioventa, margen_porcentaje,
        fechavencimiento, ubicacion_estante
      ) VALUES (
        v_item->>'nombreMedicamento',
        v_item->>'presentacion',
        v_item->>'descripcion',
        v_cant,
        v_costo_lote,
        v_precio_venta,
        v_margen,
        NULLIF(v_item->>'fechaVencimiento', '')::DATE,
        NULLIF(v_item->>'ubicacionEstante', '')
      )
      RETURNING idmedicamento INTO v_id_med;
    ELSE
      -- Lote existente: sumar stock y actualizar precio
      UPDATE inventario SET
        cantidadlote      = cantidadlote + v_cant,
        costolote         = costolote + v_costo_lote,
        precioventa       = v_precio_venta,
        margen_porcentaje = v_margen,
        ubicacion_estante = COALESCE(NULLIF(v_item->>'ubicacionEstante',''), ubicacion_estante)
      WHERE idmedicamento = v_id_med;
    END IF;

    -- Insertar detalle de compra
    INSERT INTO detallecompra (
      idcompra, idmedicamento, nombremedicamento,
      cantidaditems, costounitario, subtotal
    ) VALUES (
      p_id_compra,
      v_id_med,
      v_item->>'nombreMedicamento',
      v_cant,
      ROUND(v_costo_unit, 4),
      v_costo_lote
    );

    p_total := p_total + v_costo_lote;
  END LOOP;

  -- Actualizar total de la compra
  UPDATE compra SET totalpago = p_total WHERE idcompra = p_id_compra;

EXCEPTION
  WHEN OTHERS THEN
    RAISE;
END;
$$ LANGUAGE plpgsql;


-- Procedimiento: Confirmar venta desde sesión
CREATE OR REPLACE PROCEDURE sp_confirmar_venta(
  p_idsesion  INT,
  p_mediopago VARCHAR,
  OUT p_idventa  INT,
  OUT p_total    NUMERIC
) AS $$
DECLARE
  v_item      RECORD;
  v_producto  RECORD;
  v_subtotal  NUMERIC;
  v_idusuario INT;
  v_cliente   VARCHAR;
BEGIN
  p_total := 0;

  -- Obtener info de la sesión
  SELECT idusuario, nombre_cliente INTO v_idusuario, v_cliente
  FROM sesion_venta
  WHERE idsesion = p_idsesion AND estado = 'abierta';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sesión % no encontrada o ya fue cerrada', p_idsesion;
  END IF;

  -- Crear cabecera de venta
  INSERT INTO venta (idusuario, idsesion, mediopago, nombre_cliente, totalcobro)
  VALUES (v_idusuario, p_idsesion, p_mediopago, v_cliente, 0)
  RETURNING idventa INTO p_idventa;

  -- Procesar cada ítem de la sesión
  FOR v_item IN
    SELECT si.idmedicamento, si.cantidad, si.precio_snap
    FROM sesion_item si
    WHERE si.idsesion = p_idsesion
  LOOP
    -- Verificar y bloquear stock (FOR UPDATE previene condiciones de carrera)
    SELECT idmedicamento, nombremedicamento, cantidadlote, presentacion
    INTO v_producto
    FROM inventario
    WHERE idmedicamento = v_item.idmedicamento
    FOR UPDATE;

    IF v_producto.cantidadlote < v_item.cantidad THEN
      RAISE EXCEPTION 'Stock insuficiente: % (% disponibles, % solicitados)',
        v_producto.nombremedicamento,
        v_producto.cantidadlote,
        v_item.cantidad;
    END IF;

    v_subtotal := v_item.cantidad * v_item.precio_snap;
    p_total    := p_total + v_subtotal;

    -- Insertar detalle de venta
    INSERT INTO detalleventa (
      idventa, idmedicamento, nombremedicamento,
      cantidaditems, precioventa_historico, subtotal
    ) VALUES (
      p_idventa,
      v_item.idmedicamento,
      v_producto.nombremedicamento || ' (' || v_producto.presentacion || ')',
      v_item.cantidad,
      v_item.precio_snap,
      v_subtotal
    );

    -- Descontar stock
    UPDATE inventario
    SET cantidadlote = cantidadlote - v_item.cantidad
    WHERE idmedicamento = v_item.idmedicamento;
  END LOOP;

  -- Actualizar total de la venta
  UPDATE venta SET totalcobro = p_total WHERE idventa = p_idventa;

  -- Cerrar la sesión
  UPDATE sesion_venta
  SET estado = 'confirmada', cerrado_en = NOW()
  WHERE idsesion = p_idsesion;

EXCEPTION
  WHEN OTHERS THEN
    RAISE;
END;
$$ LANGUAGE plpgsql;


-- ============================================================
-- 7. DATOS INICIALES
-- ============================================================

-- Usuario administrador por defecto (cambiar contraseña luego)
INSERT INTO usuario (nombre, usuario, contrasena, rol)
VALUES ('Administrador', 'admin', 'admin123', 'administrador')
ON CONFLICT (usuario) DO NOTHING;
