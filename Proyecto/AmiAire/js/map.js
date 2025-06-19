

// =============================================================
// map.js — build 27-may-2025-d  🟢  Exporta sensores activos
// -------------------------------------------------------------
//  • Igual que la versión “c”, pero ahora:
//      – Guarda la lista filtrada vigente en `sensoresActivos`
//      – Expone   window.getActiveSensors()   →  array
//  • El chat (main.js) puede invocar ese getter para crear
//    el contexto de la IA sin tocar la BD.
// =============================================================

const API_URL       = '/api/sensores?fields=id,nombre,ubicacion,nivelPolucion,metricas.concentracion,fechaInicio,fechaRecogida';
const MAX_POLLUTION = 150;

let map;
let markerLayer;          // L.layerGroup()
let heatLayer;
let radioCircle;

let sensoresGlobal   = null;   // cache completa
let sensoresPromise  = null;
let sensoresActivos  = [];     // ⬅️  lista filtrada vigente
let btnDownloadCsv, btnDownloadZip; 

/* 👉  Exporta getter global para el chat IA */
window.getActiveSensors = () => sensoresActivos;

/* ---------- Utilidades UI ---------- */
function showLoading(){ document.getElementById('loading-spinner')?.classList.remove('d-none'); }
function hideLoading(){ document.getElementById('loading-spinner')?.classList.add('d-none');  }

/* ---------- GET sensores (cache) ---------- */
async function fetchSensores(force=false){
  if (sensoresGlobal && !force) return sensoresGlobal;
  if (!force && sensoresPromise) return sensoresPromise;

  showLoading();
  sensoresPromise = fetch(API_URL)
      .then(r => r.json())
      .then(j => { sensoresGlobal = j.data; return sensoresGlobal; })
      .catch(e => { console.error('Error fetch sensores', e); throw e; })
      .finally(() => { hideLoading(); sensoresPromise = null; });
  return sensoresPromise;
}

/* ---------- Conversión polución → peso y color ---------- */


/* ---------- Categoría y color unificados ---------- */
function getCategoria(sensor){
  // 1) Si hay numérico, usa los umbrales
  if (sensor.metricas?.concentracion !== undefined){
    const c = sensor.metricas.concentracion;
    if (c >= 150) return 'Extremo';
    if (c >=  50) return 'Alto';
    if (c >=  20) return 'Moderado';
    if (c >=  10) return 'Bueno';
    return 'Bajo';                    // <10 µg/m³
  }
  // 2) Si no, usa la cadena (puede venir mezclada en mayúsc/minúsc)
  if (sensor.nivelPolucion) return sensor.nivelPolucion;
  // 3) Sin datos
  return 'SinDatos';
}

function getColor(sensor){
  const cat = getCategoria(sensor).toLowerCase();
  if (cat.includes('extremo'))   return '#d73027';   // rojo
  if (cat.includes('alto'))      return '#fc8d59';   // naranja
  if (cat.includes('moderado'))  return '#fee08b';   // amarillo
  if (cat.includes('bueno'))     return '#1a9850';   // verde
  if (cat.includes('bajo'))      return '#91cf60';   // verde claro
  return '#999';                                   // gris “sin datos”
}

function getWeight(sensor){
  // el heat-map usará la concentración si existe, si no un default según categoría
  if (sensor.metricas?.concentracion !== undefined){
    return Math.min(sensor.metricas.concentracion / MAX_POLLUTION, 1);
  }
  const cat = getCategoria(sensor).toLowerCase();
  if (cat.includes('extremo'))   return 1;
  if (cat.includes('alto'))      return 0.7;
  if (cat.includes('moderado'))  return 0.4;
  if (cat.includes('bueno'))     return 0.1;
  return 0.05;   // Sin datos
}


/* ---------- Geometría ---------- */
function haversineKm(lat1, lon1, lat2, lon2){
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(lat1 * Math.PI / 180) *
            Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function geocode(city){
  const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(city)}`;
  const r   = await fetch(url);
  const d   = await r.json();
  if (!d.length) throw new Error('Ciudad no encontrada');
  return { lat: +d[0].lat, lon: +d[0].lon };
}

/* ---------- Filtro ---------- */
function filtrar(sensores, { centro = null, radioKm = null, fechaInicio = null, fechaFin = null } = {}){
  return sensores.filter(x => {
    let ok = true;

    if (centro && radioKm){
      const { latitud, longitud } = x.ubicacion;
      ok = haversineKm(centro.lat, centro.lon, latitud, longitud) <= radioKm;
    }
    if (ok && fechaInicio) ok = new Date(x.fechaInicio)  >= new Date(fechaInicio);
    if (ok && fechaFin)    ok = new Date(x.fechaRecogida) <= new Date(fechaFin);
    return ok;
  });
}

/* ---------- Construir capas ---------- */
function buildMarkers(list){
  markerLayer.clearLayers();
  list.forEach(s => {
    const { latitud, longitud } = s.ubicacion;
    const m = L.circleMarker(
      [latitud, longitud],
      { radius: 8,
        fillColor: getColor(s),
        color: '#333',
        weight: 1,
        opacity: 1,
        fillOpacity: 0.75 }
    )
     .bindPopup(
    `<strong>ID:</strong> ${s.id}<br>` +
    `<strong>Categoría:</strong> ${getCategoria(s)}<br>` +
    `<strong>Conc.:</strong> ${s.metricas?.concentracion?.toFixed(1) ?? '–'} μg/m³`
  );
    markerLayer.addLayer(m);
  });
}

function buildHeat(list){
  const data = list.map(s => [
    s.ubicacion.latitud,
    s.ubicacion.longitud,
    getWeight(s)
  ]);

  if (heatLayer){
    heatLayer.setLatLngs(data);
  } else {
    heatLayer = L.heatLayer(data, {
      radius: 35, blur: 35, maxZoom: 10,
      gradient:{0:'#0000ff',0.25:'#00ffff',0.5:'#00ff00',0.75:'#ffff00',1:'#ff0000'}
    });
  }
}

/* ---------- Render principal ---------- */
async function pintar(opts = {}){
  const all  = await fetchSensores();
  const list = filtrar(all, opts);

  /* guarda la lista para el chat IA */
  sensoresActivos = list;
  buildMarkers(list);
  buildHeat(list);
}

/* ---------- Init ---------- */
async function initMap(){

  /* --- referencias de botones y estado inicial --- */
  btnDownloadCsv = document.getElementById('btn-download');      // ← asignar
  btnDownloadZip = document.getElementById('btn-download-zip');  // ← asignar
  btnDownloadCsv.disabled = btnDownloadZip.disabled = true;      // ambos grises
  btnDownloadZip.addEventListener('click', downloadImagesZip);   // único listener ZIP
  btnDownloadCsv.addEventListener('click', downloadCSV);         // único listener CSV

  /* --- mapa base --- */
  markerLayer = L.layerGroup();
  map = L.map('map').setView([40.4168, -3.7038], 5);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{
    attribution:'&copy; OpenStreetMap'
  }).addTo(map);

  await pintar();
  map.addLayer(markerLayer);

  /* --------- Botones de vista --------- */
  document.getElementById('btn-heatmap').addEventListener('click', () => {
    map.removeLayer(markerLayer);
    heatLayer.addTo(map);
  });
  document.getElementById('btn-normalmap').addEventListener('click', () => {
    if (heatLayer) map.removeLayer(heatLayer);
    map.addLayer(markerLayer);
  });

  /* --------- FILTRAR --------- */
  document.getElementById('btn-filtrar').addEventListener('click', async () => {
    const ciudad  = document.getElementById('ciudad').value.trim();
    const radioKm = parseFloat(document.getElementById('radio').value);
    const fIni    = document.getElementById('fechaInicio').value;
    const fFin    = document.getElementById('fechaFin').value;

    if (!ciudad || isNaN(radioKm)){
      alert('Introduce ciudad y radio válidos');
      return;
    }

    try{
      const centro = await geocode(ciudad);
      await pintar({ centro, radioKm, fechaInicio:fIni, fechaFin:fFin });
      map.setView([centro.lat, centro.lon], 11);

      if (radioCircle) map.removeLayer(radioCircle);
      radioCircle = L.circle([centro.lat, centro.lon],
                    { radius: radioKm*1000, color:'blue', fillOpacity:0.1 })
                    .addTo(map);

      // habilitar/ deshabilitar
      const hayResultados = sensoresActivos.length > 0;
      btnDownloadCsv.disabled = btnDownloadZip.disabled = !hayResultados;

    }catch{
      alert('Ciudad no encontrada');
    }
  });

  /* --------- RESET --------- */
  document.getElementById('btn-reset').addEventListener('click', async () => {
    btnDownloadCsv.disabled = btnDownloadZip.disabled = true;   // desactiva primero
    await pintar();
    map.setView([40.4168, -3.7038], 5);
    if (radioCircle) map.removeLayer(radioCircle);
  });


  btnDownloadZip.addEventListener('click', downloadImagesZip);

}


/* ---------- Descargar CSV ---------- */
async function downloadCSV(){
  showLoading();
  try{
    const ciudad  = document.getElementById('ciudad').value.trim();
    const radioKm = parseFloat(document.getElementById('radio').value);
    const fIni    = document.getElementById('fechaInicio').value;
    const fFin    = document.getElementById('fechaFin').value;

    const all = await fetchSensores();
    let centro = null;
    if (ciudad){
      try{ centro = await geocode(ciudad); }
      catch{ alert('Ciudad inválida'); return; }
    }

    const list = filtrar(all, { centro, radioKm, fechaInicio: fIni, fechaFin: fFin });
    if (!list.length){ alert('No hay datos para exportar'); return; }

    const header = ['id','nombre','latitud','longitud','fechaInicio','fechaRecogida','nivelPolucion'];
    const rows   = list.map(s => [
      s.id, s.nombre, s.ubicacion.latitud, s.ubicacion.longitud,
      s.fechaInicio, s.fechaRecogida, s.nivelPolucion
    ].join(','));

    const blob = new Blob([header.join(',')+'\n'+rows.join('\n')],{type:'text/csv;charset=utf-8;'});
    const url  = URL.createObjectURL(blob);
    Object.assign(document.createElement('a'),{href:url,download:`sensores_${Date.now()}.csv`}).click();
    URL.revokeObjectURL(url);

  } finally { hideLoading(); }
}


/* ---------- Descargar ZIP de imágenes ---------- */
async function downloadImagesZip(){
  if (btnDownloadZip.disabled) return;          // por si lo pulsan doble

  /* ←–– 1. si no hay sensores filtrados, avisa y sale */
  if (!sensoresActivos.length){
    alert('No hay sensores tras el filtro.');
    return;
  }

  showLoading();
  try{
    /* ←–– 2. ids de TODOS los sensores filtrados */
    const ids = sensoresActivos.map(s => s.id).join(',');
    const resp = await fetch(`/api/imagenes?ids=${ids}`);
    if (!resp.ok){
      alert('Error obteniendo imágenes'); return;
    }
    const lista = await resp.json();            // [{ id, base64 }, …]

    /* ←–– 3. Generar ZIP con JSZip */
    const zip = new JSZip();
    lista.forEach(({ id, base64 }) => {
      const blob = b64ToBlob(base64, 'image/jpeg');
      zip.file(`${id}.jpg`, blob);
    });

    const zipBlob = await zip.generateAsync({ type:'blob' });
    const url = URL.createObjectURL(zipBlob);
    Object.assign(document.createElement('a'), {
      href: url,
      download: `sensores_${Date.now()}.zip`
    }).click();
    URL.revokeObjectURL(url);

  }catch(err){
    console.error('ZIP error', err);
    alert('Problema al generar el ZIP (ver consola)');
  }finally{
    hideLoading();
  }
}

/* helper: base64 → Blob (sin cambios) */
function b64ToBlob(b64, mime){
  const byteStr = atob(b64);
  const len = byteStr.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = byteStr.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}






/* ---------- Boot ---------- */
document.addEventListener('DOMContentLoaded', initMap);
