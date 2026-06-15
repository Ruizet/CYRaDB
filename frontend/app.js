const API = 'http://localhost:3000';

function getUsuario() { return JSON.parse(localStorage.getItem('usuarioActual') || 'null'); }

function requireAuth(rolRequerido) {
  const u = getUsuario();
  if (!u) { location.href = 'login.html'; return null; }
  if (rolRequerido && u.rol !== rolRequerido) { location.href = 'dashboard.html'; return null; }
  return u;
}

async function logout() {
  const u = getUsuario();
  
  if (u) {
    try {
      // 1. Preguntamos al backend si este usuario tiene un turno activo
      const r = await fetch(`${API}/caja/estado/${u.idusuario}`);
      const caja = await r.json();

      if (caja && caja.activa === true) {
        const proceder = confirm(
          "⚠️ Tienes un turno de gaveta activo.\n\n" +
          "Para salir de manera limpia debes cerrar la caja en su respectiva pestaña.\n" +
          "Si decides salir ahora, el sistema registrará un CIERRE DE EMERGENCIA AUTOMÁTICO por 'Causas Desconocidas' en el libro de auditoría.\n\n" +
          "¿Deseas forzar el cierre de sesión?"
        );
        
        if (!proceder) return; // Cancela el logout y se queda en la app

        // 2. Si el usuario decide forzar la salida, notificamos el cierre de emergencia al backend
        await fetch(`${API}/caja/cerrar`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            idcaja_sesion: caja.datos.idcaja_sesion,
            montoCierreReal: 0.00, // Se asienta en 0 porque no fue un arqueo manual
            observaciones: "Cierre forzado: El cajero abandonó la aplicación o cerró sesión directamente desde la barra lateral.",
            tipoCierre: "cierre_desconocido" // Esto activa el chip rojo en el historial
          })
        });
      }
    } catch (err) {
      console.error("Error en el protocolo de cierre seguro:", err);
    }
  }

  // 3. Limpieza final y redirección estándar
  localStorage.removeItem('usuarioActual');
  location.href = 'login.html';
}

function renderSidebar(paginaActiva, alertCount) {
  const u = getUsuario(); if (!u) return;
  const links = [
    { href:'dashboard.html',          icon:'ti-layout-dashboard', label:'Dashboard',        key:'dashboard' },
    { href:'caja.html', icon:'ti-cash-register', label:'Control de Caja', key:'caja' },
    { href:'venta.html',              icon:'ti-shopping-cart',    label:'Ventas',            key:'venta' },
    { href:'ingreso.html',            icon:'ti-package',          label:'Ingresar',          key:'ingreso' },
    { href:'inventario.html',         icon:'ti-clipboard-list',   label:'Inventario',        key:'inventario' },
    { href:'detalleventas.html',      icon:'ti-receipt',          label:'Historial ventas',  key:'detalleventas' },
    { href:'detallecompras.html',     icon:'ti-truck',            label:'Historial compras', key:'detallecompras' },
    { href:'historial-caja.html',     icon:'ti-report-money',     label:'Auditoría Gaveta',  key:'historial-caja' },
    { href:'ingresoproveedores.html', icon:'ti-building-store',   label:'Proveedores',       key:'proveedores' },
  ];
  const adminLinks = [
    { href:'gestionusuarios.html', icon:'ti-users', label:'Usuarios', key:'usuarios' },
  ];
  const mkLink = l => {
    const badge = (l.key === 'dashboard' && alertCount) ? `<span class="nav-badge">${alertCount}</span>` : '';
    return `<a href="${l.href}" class="nav-link ${paginaActiva===l.key?'active':''}" title="${l.label}">
      <i class="ti ${l.icon}" aria-hidden="true"></i><span>${l.label}</span>${badge}</a>`;
  };
  let nav = links.map(mkLink).join('');
  if (u.rol === 'administrador') {
    nav += `<div class="sidebar-section">Admin</div>` + adminLinks.map(mkLink).join('');
  }
  const ini = u.nombre.split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase();
  document.getElementById('sidebar').innerHTML = `
    <div class="sidebar-logo">
      <div class="logo-name">Farmacia C&R</div>
      <div class="logo-sub">Sistema de gestión</div>
    </div>
    <nav>${nav}</nav>
    <div class="sidebar-footer">
      <div class="sidebar-user">
        <div class="avatar">${ini}</div>
        <div><div class="user-name">${u.nombre}</div><div class="user-rol">${u.rol}</div></div>
      </div>
      <button class="btn-logout" onclick="logout()">
        <i class="ti ti-logout" aria-hidden="true"></i> Cerrar sesión
      </button>
    </div>`;
}

function toast(msg, tipo='ok', dur=3200) {
  let a = document.getElementById('toast-area');
  if (!a) { a = document.createElement('div'); a.id='toast-area'; document.body.appendChild(a); }
  const icons = {ok:'ti-circle-check',err:'ti-circle-x',warn:'ti-alert-triangle'};
  const t = document.createElement('div');
  t.className = `toast toast-${tipo}`;
  t.innerHTML = `<i class="ti ${icons[tipo]||icons.ok}" aria-hidden="true"></i><span>${msg}</span>`;
  a.appendChild(t);
  setTimeout(() => t.remove(), dur);
}

function openModal(id)  { document.getElementById(id)?.classList.add('open'); }
function closeModal(id) { document.getElementById(id)?.classList.remove('open'); }
document.addEventListener('click', e => { if(e.target.classList.contains('modal-backdrop')) e.target.classList.remove('open'); });
document.addEventListener('keydown', e => { if(e.key==='Escape') document.querySelectorAll('.modal-backdrop.open').forEach(m=>m.classList.remove('open')); });

function setupAutocomplete(input, list, onSelect) {
  let timer, grupos=[], flat=[], idx=-1;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (q.length < 1) { list.classList.remove('open'); return; }
    timer = setTimeout(() => buscar(q), 220);
  });
  async function buscar(q) {
    try {
      const r = await fetch(`${API}/inventario/buscar?q=${encodeURIComponent(q)}&soloStock=1`);
      grupos = await r.json(); flat = grupos.flatMap(g=>g.lotes); render();
    } catch {}
  }
  function render() {
    list.innerHTML=''; idx=-1;
    if (!flat.length) { list.innerHTML='<div style="padding:.6rem .9rem;font-size:.85rem;color:var(--text-3)">Sin resultados</div>'; list.classList.add('open'); return; }
    grupos.forEach(g => {
      const h=document.createElement('div'); h.className='ac-group-header'; h.textContent=g.nombre; list.appendChild(h);
      g.lotes.forEach(lote => {
        const d=document.createElement('div'); d.className='ac-item'; d.dataset.id=lote.idmedicamento;
        const vc = lote.estado_vencimiento==='vencido'?'<span class="chip chip-danger" style="font-size:.65rem">Vencido</span>'
                 : lote.estado_vencimiento==='critico'?'<span class="chip chip-warning" style="font-size:.65rem">Vence pronto</span>':'';
        const loc = lote.ubicacion_estante?`<span class="ac-item-loc"><i class="ti ti-map-pin" style="font-size:.7rem"></i> ${lote.ubicacion_estante}</span>`:'';
        d.innerHTML=`<div class="ac-item-left">
          <span class="ac-item-name">${lote.presentacion}</span>
          <span class="ac-item-pres flex-center gap-sm">${lote.descripcion||''}${vc}</span>
        </div>
        <div class="ac-item-right">
          <span class="ac-item-price">C$ ${parseFloat(lote.precioventa).toFixed(2)}</span>
          <span class="ac-item-stock">${lote.cantidadlote} disp.</span>${loc}
        </div>`;
        d.addEventListener('mousedown', e=>{e.preventDefault();sel(lote);});
        list.appendChild(d);
      });
    });
    list.classList.add('open');
  }
  function sel(lote) { list.classList.remove('open'); input.value=''; onSelect(lote); }
  input.addEventListener('keydown', e => {
    const items = list.querySelectorAll('.ac-item');
    if (e.key==='ArrowDown'){e.preventDefault();idx=Math.min(idx+1,items.length-1);foco(items);}
    else if (e.key==='ArrowUp'){e.preventDefault();idx=Math.max(idx-1,0);foco(items);}
    else if (e.key==='Enter'&&idx>=0){e.preventDefault();sel(flat[idx]);}
    else if (e.key==='Escape') list.classList.remove('open');
  });
  function foco(items){items.forEach((it,i)=>it.classList.toggle('focused',i===idx));items[idx]?.scrollIntoView({block:'nearest'});}
  document.addEventListener('click', e=>{if(!input.contains(e.target)&&!list.contains(e.target))list.classList.remove('open');});
}

function moneda(n) { return 'C$ '+parseFloat(n||0).toFixed(2); }
function fechaCorta(iso) { if(!iso)return'—'; return new Date(iso).toLocaleDateString('es-NI',{day:'2-digit',month:'short',year:'numeric'}); }
function fechaHora(iso) {
  if(!iso)return'—';
  const d=new Date(iso);
  return d.toLocaleDateString('es-NI',{day:'2-digit',month:'short'})+' '+d.toLocaleTimeString('es-NI',{hour:'2-digit',minute:'2-digit'});
}

/* ── Impresión de ticket ────────────────────────────────────
   Uso: imprimirTicket(htmlString)
   Copia el contenido a un div directo en body para que
   @media print lo capture sin importar donde está el modal.
────────────────────────────────────────────────────────────── */
function imprimirTicket(html) {
  // Eliminar overlay previo si existe
  const prev = document.getElementById('cr-ticket-overlay');
  if (prev) prev.remove();

  // Crear overlay directo en body
  const overlay = document.createElement('div');
  overlay.id = 'cr-ticket-overlay';
  overlay.innerHTML = html;
  document.body.appendChild(overlay);

  // Pequeño delay para que el DOM renderice antes de imprimir
  setTimeout(() => {
    window.print();
    // Limpiar después de imprimir (onafterprint no es universal, usamos timeout)
    setTimeout(() => overlay.remove(), 1000);
  }, 120);
}
