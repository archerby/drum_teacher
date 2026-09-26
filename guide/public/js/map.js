/* Карта маршрута на Leaflet (лежит локально в vendor/) с подложкой CARTO на данных OSM. */
let leafletPromise = null;
let map = null;
let markers = {};

function loadLeaflet() {
  if (window.L) return Promise.resolve(window.L);
  if (!leafletPromise) {
    leafletPromise = new Promise((resolve, reject) => {
      const css = document.createElement('link');
      css.rel = 'stylesheet';
      css.href = 'vendor/leaflet/leaflet.css';
      document.head.appendChild(css);
      const s = document.createElement('script');
      s.src = 'vendor/leaflet/leaflet.js';
      s.onload = () => resolve(window.L);
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }
  return leafletPromise;
}

const dark = () => window.matchMedia?.('(prefers-color-scheme: dark)').matches;

function pinIcon(L, label, cls) {
  return L.divIcon({
    className: '',
    html: `<div class="pin ${cls}"><span>${label}</span></div>`,
    iconSize: [30, 30],
    iconAnchor: cls.includes('start') ? [11, 11] : [15, 30],
  });
}

/**
 * route: результат buildRoute; visited: Set(id); onPick(index) — тап по метке.
 */
export async function drawMap(el, route, visited, onPick, startLabel) {
  const L = await loadLeaflet();
  if (map) { map.remove(); map = null; }
  markers = {};
  map = L.map(el, { zoomControl: false, scrollWheelZoom: false, tap: true });
  L.control.zoom({ position: 'bottomright' }).addTo(map);
  const style = dark() ? 'dark_all' : 'rastertiles/voyager';
  L.tileLayer(`https://{s}.basemaps.cartocdn.com/${style}/{z}/{x}/{y}{r}.png`, {
    maxZoom: 19,
    subdomains: 'abcd',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
  }).addTo(map);

  const pts = [[route.start.lat, route.start.lng]];
  L.marker(pts[0], { icon: pinIcon(L, '★', 'start'), title: startLabel, keyboard: false }).addTo(map);
  route.stops.forEach((s, i) => {
    const ll = [s.poi.lat, s.poi.lng];
    pts.push(ll);
    const cls = visited.has(s.id) ? 'done' : s.rest ? 'rest' : '';
    const m = L.marker(ll, { icon: pinIcon(L, i + 1, cls) }).addTo(map);
    m.on('click', () => onPick(i));
    markers[s.id] = { m, i, rest: !!s.rest };
  });
  L.polyline(pts, { color: dark() ? '#ff5a6e' : '#d7263d', weight: 4, opacity: .75, dashArray: '2 9', lineCap: 'round' }).addTo(map);
  map.fitBounds(L.latLngBounds(pts), { padding: [28, 28], maxZoom: 16 });
  setTimeout(() => map && map.invalidateSize(), 60);
}

export function markVisited(id, done) {
  const L = window.L;
  const rec = markers[id];
  if (!L || !rec) return;
  rec.m.setIcon(pinIcon(L, rec.i + 1, done ? 'done' : rec.rest ? 'rest' : ''));
}

export function focusStop(lat, lng) {
  if (map) map.setView([lat, lng], Math.max(map.getZoom(), 16), { animate: true });
}

export function resizeMap() {
  if (map) setTimeout(() => map.invalidateSize(), 30);
}
