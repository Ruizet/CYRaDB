-- ============================================================
--  FARMACIA C&R  |  Script de migración
--  Aplica sobre la base existente CYRaDB sin borrar datos
--  Ejecutar una sola vez en psql o pgAdmin
-- ============================================================


-- ------------------------------------------------------------
-- 1. inventario — columnas nuevas
-- ------------------------------------------------------------

-- Margen configurable por lote (antes era fijo en el backend)
ALTER TABLE public.inventario
  ADD COLUMN IF NOT EXISTS margen_porcentaje NUMERIC(5,2) NOT NULL DEFAULT 30;

-- Descripción libre: dosis, concentración, etc.
ALTER TABLE public.inventario
  ADD COLUMN IF NOT EXISTS descripcion TEXT;

-- fechavencimiento no siempre aplica (vendas, jeringas, etc.)
ALTER TABLE public.inventario
  ALTER COLUMN fechavencimiento DROP NOT NULL;


-- ------------------------------------------------------------
-- 2. venta — columnas nuevas
-- ------------------------------------------------------------

-- Nombre del cliente para el ticket impreso
ALTER TABLE public.venta
  ADD COLUMN IF NOT EXISTS nombre_cliente VARCHAR(100) DEFAULT 'Cliente';

-- Referencia a la sesión POS (NULL en ventas históricas)
ALTER TABLE public.venta
  ADD COLUMN IF NOT EXISTS idsesion INT;

-- Agregar 'transferencia' al check de mediopago
ALTER TABLE public.venta
  DROP CONSTRAINT IF EXISTS venta_mediopago_check;

ALTER TABLE public.venta
  ADD CONSTRAINT venta_mediopago_check
    CHECK (mediopago IN ('efectivo','tarjeta','transferencia'));


-- ------------------------------------------------------------
-- 3. Tablas nuevas — POS multi-cliente
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.sesion_venta (
  idsesion       SERIAL PRIMARY KEY,
  nombre_cliente VARCHAR(100) NOT NULL DEFAULT 'Cliente',
  idusuario      INT NOT NULL REFERENCES public.usuario(idusuario),
  creado_en      TIMESTAMP NOT NULL DEFAULT NOW(),
  cerrado_en     TIMESTAMP,
  estado         VARCHAR(20) NOT NULL DEFAULT 'abierta'
                   CHECK (estado IN ('abierta','confirmada','cancelada'))
);

CREATE TABLE IF NOT EXISTS public.sesion_item (
  iditem        SERIAL PRIMARY KEY,
  idsesion      INT NOT NULL REFERENCES public.sesion_venta(idsesion) ON DELETE CASCADE,
  idmedicamento INT NOT NULL REFERENCES public.inventario(idmedicamento),
  cantidad      INT NOT NULL CHECK (cantidad > 0),
  precio_snap   NUMERIC(10,2) NOT NULL,   -- precio al momento de agregar al carrito
  UNIQUE (idsesion, idmedicamento)
);

-- FK de venta hacia sesion (después de crear la tabla)
ALTER TABLE public.venta
  ADD CONSTRAINT IF NOT EXISTS venta_idsesion_fkey
    FOREIGN KEY (idsesion) REFERENCES public.sesion_venta(idsesion);


-- ------------------------------------------------------------
-- 4. Configuración global de la farmacia
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.configuracion (
  clave VARCHAR(100) PRIMARY KEY,
  valor TEXT NOT NULL
);

INSERT INTO public.configuracion (clave, valor) VALUES
  ('nombre_farmacia', 'Farmacia C&R'),
  ('telefono',        ''),
  ('direccion',       ''),
  ('margen_defecto',  '30')
ON CONFLICT (clave) DO NOTHING;


-- ------------------------------------------------------------
-- 5. Índices de rendimiento
-- ------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_inv_nombre
  ON public.inventario (LOWER(nombremedicamento));

CREATE INDEX IF NOT EXISTS idx_inv_vence
  ON public.inventario (fechavencimiento)
  WHERE fechavencimiento IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_inv_stock
  ON public.inventario (cantidadlote);

CREATE INDEX IF NOT EXISTS idx_venta_fecha
  ON public.venta (fecha DESC);

CREATE INDEX IF NOT EXISTS idx_sesion_estado
  ON public.sesion_venta (estado)
  WHERE estado = 'abierta';


-- ------------------------------------------------------------
-- 6. Vistas
-- ------------------------------------------------------------

CREATE OR REPLACE VIEW public.v_inventario AS
SELECT
  idmedicamento,
  nombremedicamento,
  presentacion,
  descripcion,
  cantidadlote,
  costolote,
  precioventa,
  margen_porcentaje,
  fechavencimiento,
  fechaingreso,
  ubicacion_estante,
  CASE
    WHEN fechavencimiento IS NULL          THEN 'sin_fecha'
    WHEN fechavencimiento < CURRENT_DATE   THEN 'vencido'
    WHEN fechavencimiento <= CURRENT_DATE + INTERVAL '30 days' THEN 'critico'
    WHEN fechavencimiento <= CURRENT_DATE + INTERVAL '90 days' THEN 'proximo'
    ELSE 'vigente'
  END AS estado_vencimiento,
  CASE
    WHEN cantidadlote = 0  THEN 'agotado'
    WHEN cantidadlote < 10 THEN 'bajo'
    ELSE 'normal'
  END AS estado_stock
FROM public.inventario;

-- Alertas para el dashboard
CREATE OR REPLACE VIEW public.v_alertas AS
SELECT
  'vencimiento'                                    AS tipo,
  idmedicamento::TEXT                              AS referencia_id,
  nombremedicamento || ' — ' || presentacion       AS descripcion,
  CASE
    WHEN fechavencimiento < CURRENT_DATE                        THEN 'critico'
    WHEN fechavencimiento <= CURRENT_DATE + INTERVAL '30 days' THEN 'critico'
    ELSE 'advertencia'
  END                                              AS nivel,
  fechavencimiento::TEXT                           AS detalle
FROM public.inventario
WHERE fechavencimiento IS NOT NULL
  AND fechavencimiento <= CURRENT_DATE + INTERVAL '90 days'

UNION ALL

SELECT
  'stock'                                          AS tipo,
  idmedicamento::TEXT                              AS referencia_id,
  nombremedicamento || ' — ' || presentacion       AS descripcion,
  CASE WHEN cantidadlote = 0 THEN 'critico' ELSE 'advertencia' END AS nivel,
  cantidadlote::TEXT || ' unidades'                AS detalle
FROM public.inventario
WHERE cantidadlote < 10;

-- Historial de ventas con detalle de ítems (JSON)
CREATE OR REPLACE VIEW public.v_ventas_detalle AS
SELECT
  v.idventa,
  v.fecha,
  v.totalcobro,
  v.mediopago,
  v.nombre_cliente,
  u.nombre AS usuario,
  COALESCE(
    json_agg(
      json_build_object(
        'nombre',   dv.nombremedicamento,
        'cantidad', dv.cantidaditems,
        'precio',   dv.precioventa_historico,
        'subtotal', dv.subtotal
      )
    ) FILTER (WHERE dv.iddetalleventa IS NOT NULL),
    '[]'
  ) AS items
FROM public.venta v
JOIN public.usuario u ON v.idusuario = u.idusuario
LEFT JOIN public.detalleventa dv ON v.idventa = dv.idventa
GROUP BY v.idventa, u.nombre;

-- Sesiones abiertas (pestañas activas en el POS)
CREATE OR REPLACE VIEW public.v_sesiones_abiertas AS
SELECT
  s.idsesion,
  s.nombre_cliente,
  s.creado_en,
  u.nombre                                        AS vendedor,
  COUNT(si.iditem)                                AS cantidad_items,
  COALESCE(SUM(si.cantidad * si.precio_snap), 0)  AS total_parcial
FROM public.sesion_venta s
JOIN public.usuario u ON s.idusuario = u.idusuario
LEFT JOIN public.sesion_item si ON s.idsesion = si.idsesion
WHERE s.estado = 'abierta'
GROUP BY s.idsesion, s.nombre_cliente, s.creado_en, u.nombre;

-- Historial de compras con detalle
CREATE OR REPLACE VIEW public.v_compras_detalle AS
SELECT
  c.idcompra,
  c.fecha,
  c.totalpago,
  p.nombre   AS proveedor,
  u.nombre   AS usuario,
  COALESCE(
    json_agg(
      json_build_object(
        'nombre',   dc.nombremedicamento,
        'cantidad', dc.cantidaditems,
        'costo',    dc.costounitario,
        'subtotal', dc.subtotal
      )
    ) FILTER (WHERE dc.iddetallecompra IS NOT NULL),
    '[]'
  ) AS items
FROM public.compra c
JOIN public.proveedor p ON c.idproveedor = p.idproveedor
JOIN public.usuario u   ON c.idusuario   = u.idusuario
LEFT JOIN public.detallecompra dc ON c.idcompra = dc.idcompra
GROUP BY c.idcompra, p.nombre, u.nombre;


-- ------------------------------------------------------------
-- 7. Funciones
-- ------------------------------------------------------------

-- Calcula precio de venta: precio = costo_unitario * (1 + margen/100)
CREATE OR REPLACE FUNCTION public.fn_calcular_precio_venta(
  p_costo_unitario NUMERIC,
  p_margen_pct     NUMERIC
) RETURNS NUMERIC AS $$
BEGIN
  IF p_margen_pct <= 0 OR p_margen_pct >= 100 THEN
    RAISE EXCEPTION 'El margen debe ser entre 1 y 99%%';
  END IF;
  RETURN ROUND(p_costo_unitario * (1 + p_margen_pct / 100.0), 2);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Lee el margen por defecto de la tabla configuracion
CREATE OR REPLACE FUNCTION public.fn_margen_defecto()
RETURNS NUMERIC AS $$
  SELECT valor::NUMERIC FROM public.configuracion WHERE clave = 'margen_defecto';
$$ LANGUAGE sql STABLE;

-- KPIs del día para el dashboard
CREATE OR REPLACE FUNCTION public.fn_dashboard_hoy()
RETURNS TABLE (
  ventas_hoy         INT,
  ingresos_hoy       NUMERIC,
  alertas_criticas   INT,
  sesiones_abiertas  INT,
  productos_agotados INT
) AS $$
BEGIN
  RETURN QUERY SELECT
    (SELECT COUNT(*)::INT
       FROM public.venta WHERE fecha::DATE = CURRENT_DATE),
    (SELECT COALESCE(SUM(totalcobro), 0)
       FROM public.venta WHERE fecha::DATE = CURRENT_DATE),
    (SELECT COUNT(*)::INT FROM public.v_alertas WHERE nivel = 'critico'),
    (SELECT COUNT(*)::INT FROM public.sesion_venta WHERE estado = 'abierta'),
    (SELECT COUNT(*)::INT FROM public.inventario  WHERE cantidadlote = 0);
END;
$$ LANGUAGE plpgsql STABLE;


-- ------------------------------------------------------------
-- 8. Triggers
-- ------------------------------------------------------------

-- Trigger A: evitar stock negativo (doble seguro a nivel DB)
CREATE OR REPLACE FUNCTION public.trg_fn_stock_no_negativo()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.cantidadlote < 0 THEN
    RAISE EXCEPTION
      'Stock insuficiente: % — disponible: %, solicitado descontar: %',
      (SELECT nombremedicamento FROM public.inventario WHERE idmedicamento = NEW.idmedicamento),
      OLD.cantidadlote,
      OLD.cantidadlote - NEW.cantidadlote;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_stock_no_negativo ON public.inventario;
CREATE TRIGGER trg_stock_no_negativo
BEFORE UPDATE OF cantidadlote ON public.inventario
FOR EACH ROW EXECUTE FUNCTION public.trg_fn_stock_no_negativo();


-- ------------------------------------------------------------
-- 9. Stored Procedures
-- ------------------------------------------------------------

-- Registrar una compra completa (múltiples ítems en una sola transacción)
CREATE OR REPLACE PROCEDURE public.sp_registrar_compra(
  p_id_proveedor INT,
  p_id_usuario   INT,
  p_items        JSON,
  OUT p_idcompra INT,
  OUT p_total    NUMERIC
) AS $$
DECLARE
  v_item         JSON;
  v_id_med       INT;
  v_cant         INT;
  v_costo_lote   NUMERIC;
  v_costo_unit   NUMERIC;
  v_margen       NUMERIC;
  v_precio_venta NUMERIC;
BEGIN
  p_total := 0;

  INSERT INTO public.compra (idproveedor, idusuario, totalpago)
  VALUES (p_id_proveedor, p_id_usuario, 0)
  RETURNING idcompra INTO p_idcompra;

  FOR v_item IN SELECT * FROM json_array_elements(p_items) LOOP

    v_cant       := (v_item->>'cantidad')::INT;
    v_costo_lote := (v_item->>'costoLote')::NUMERIC;
    v_costo_unit := v_costo_lote / NULLIF(v_cant, 0);
    v_margen     := COALESCE(
                      NULLIF((v_item->>'margen')::NUMERIC, 0),
                      public.fn_margen_defecto()
                    );

    -- Precio: manual si viene, calculado si no
    IF (v_item->>'precioVenta') IS NOT NULL
       AND (v_item->>'precioVenta')::NUMERIC > 0 THEN
      v_precio_venta := (v_item->>'precioVenta')::NUMERIC;
    ELSE
      v_precio_venta := public.fn_calcular_precio_venta(v_costo_unit, v_margen);
    END IF;

    -- Buscar lote existente (mismo nombre + presentacion + vencimiento)
    SELECT idmedicamento INTO v_id_med
    FROM public.inventario
    WHERE LOWER(nombremedicamento) = LOWER(v_item->>'nombre')
      AND LOWER(presentacion)      = LOWER(v_item->>'presentacion')
      AND (
        (fechavencimiento IS NULL AND (v_item->>'fechaVencimiento') IS NULL)
        OR fechavencimiento = NULLIF(v_item->>'fechaVencimiento','')::DATE
      )
    LIMIT 1;

    IF v_id_med IS NULL THEN
      -- Nuevo lote
      INSERT INTO public.inventario (
        nombremedicamento, presentacion, descripcion,
        cantidadlote, costolote, precioventa, margen_porcentaje,
        fechavencimiento, ubicacion_estante
      ) VALUES (
        v_item->>'nombre',
        v_item->>'presentacion',
        NULLIF(v_item->>'descripcion',''),
        v_cant,
        v_costo_lote,
        v_precio_venta,
        v_margen,
        NULLIF(v_item->>'fechaVencimiento','')::DATE,
        NULLIF(v_item->>'ubicacion','')
      )
      RETURNING idmedicamento INTO v_id_med;
    ELSE
      -- Lote existente: sumar stock y actualizar precio
      UPDATE public.inventario SET
        cantidadlote      = cantidadlote + v_cant,
        costolote         = costolote + v_costo_lote,
        precioventa       = v_precio_venta,
        margen_porcentaje = v_margen,
        ubicacion_estante = COALESCE(
                              NULLIF(v_item->>'ubicacion',''),
                              ubicacion_estante
                            )
      WHERE idmedicamento = v_id_med;
    END IF;

    INSERT INTO public.detallecompra (
      idcompra, idmedicamento, nombremedicamento,
      cantidaditems, costounitario, subtotal
    ) VALUES (
      p_idcompra, v_id_med, v_item->>'nombre',
      v_cant, ROUND(v_costo_unit, 4), v_costo_lote
    );

    p_total := p_total + v_costo_lote;
  END LOOP;

  UPDATE public.compra SET totalpago = p_total WHERE idcompra = p_idcompra;

EXCEPTION WHEN OTHERS THEN RAISE;
END;
$$ LANGUAGE plpgsql;


-- Confirmar venta desde una sesión POS
CREATE OR REPLACE PROCEDURE public.sp_confirmar_venta(
  p_idsesion  INT,
  p_mediopago VARCHAR,
  OUT p_idventa INT,
  OUT p_total   NUMERIC
) AS $$
DECLARE
  v_item      RECORD;
  v_producto  RECORD;
  v_idusuario INT;
  v_cliente   VARCHAR;
  v_subtotal  NUMERIC;
BEGIN
  p_total := 0;

  SELECT idusuario, nombre_cliente INTO v_idusuario, v_cliente
  FROM public.sesion_venta
  WHERE idsesion = p_idsesion AND estado = 'abierta';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'La sesión % no existe o ya fue cerrada', p_idsesion;
  END IF;

  INSERT INTO public.venta (idusuario, idsesion, mediopago, nombre_cliente, totalcobro)
  VALUES (v_idusuario, p_idsesion, p_mediopago, v_cliente, 0)
  RETURNING idventa INTO p_idventa;

  FOR v_item IN
    SELECT idmedicamento, cantidad, precio_snap
    FROM public.sesion_item WHERE idsesion = p_idsesion
  LOOP
    -- Bloquear la fila para evitar condiciones de carrera
    SELECT idmedicamento, nombremedicamento, presentacion, cantidadlote
    INTO v_producto
    FROM public.inventario
    WHERE idmedicamento = v_item.idmedicamento
    FOR UPDATE;

    IF v_producto.cantidadlote < v_item.cantidad THEN
      RAISE EXCEPTION
        'Stock insuficiente: % (disponible: %, solicitado: %)',
        v_producto.nombremedicamento, v_producto.cantidadlote, v_item.cantidad;
    END IF;

    v_subtotal := v_item.cantidad * v_item.precio_snap;
    p_total    := p_total + v_subtotal;

    INSERT INTO public.detalleventa (
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

    UPDATE public.inventario
    SET cantidadlote = cantidadlote - v_item.cantidad
    WHERE idmedicamento = v_item.idmedicamento;
  END LOOP;

  UPDATE public.venta    SET totalcobro = p_total    WHERE idventa  = p_idventa;
  UPDATE public.sesion_venta
    SET estado = 'confirmada', cerrado_en = NOW()
  WHERE idsesion = p_idsesion;

EXCEPTION WHEN OTHERS THEN RAISE;
END;
$$ LANGUAGE plpgsql;


-- ------------------------------------------------------------
-- MIGRACIÓN: Reset de contraseña
-- Tabla de tokens temporales (expiran en 1 hora)
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.reset_token (
  id          SERIAL PRIMARY KEY,
  idusuario   INT NOT NULL REFERENCES public.usuario(idusuario) ON DELETE CASCADE,
  token       VARCHAR(64) NOT NULL UNIQUE,
  expira_en   TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '1 hour'),
  usado       BOOLEAN NOT NULL DEFAULT FALSE,
  creado_en   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reset_token ON public.reset_token (token) WHERE usado = FALSE;

-- Columna email en usuario (necesaria para enviar el correo)
ALTER TABLE public.usuario
  ADD COLUMN IF NOT EXISTS email VARCHAR(200);
