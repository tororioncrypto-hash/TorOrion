import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { IMAGERY_URL, NOMINATIM_URL } from './config.js';

export class MapPicker {
  constructor(el, onPick) {
    this.onPick = onPick;
    this.map = L.map(el, { zoomControl: false, worldCopyJump: true }).setView([-15.78, -47.93], 4);
    L.control.zoom({ position: 'bottomright' }).addTo(this.map);
    L.tileLayer(IMAGERY_URL, { maxZoom: 19, attribution: 'Esri, Maxar, Earthstar Geographics' }).addTo(this.map);
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, opacity: 0.9 }).addTo(this.map);
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, opacity: 0.6 }).addTo(this.map);
    const icon = L.divIcon({ className: '', html: '<div style="font-size:34px;transform:translate(-12px,-34px);filter:drop-shadow(0 0 6px #000)">⚡</div>' });
    this.marker = L.marker([0, 0], { icon, draggable: true });
    this.map.on('click', (e) => this.pick(e.latlng.lat, e.latlng.lng));
    this.marker.on('dragend', () => { const p = this.marker.getLatLng(); this.pick(p.lat, p.lng); });
  }
  invalidate() { setTimeout(() => this.map.invalidateSize(), 50); }
  async pick(lat, lon, label) {
    this.marker.setLatLng([lat, lon]).addTo(this.map);
    this.onPick({ lat, lon, label: label || `${lat.toFixed(5)}, ${lon.toFixed(5)}` });
    if (!label) {
      try {
        const r = await fetch(`${NOMINATIM_URL}/reverse?format=jsonv2&zoom=18&accept-language=pt-BR&lat=${lat}&lon=${lon}`);
        const j = await r.json();
        if (j && j.display_name) this.onPick({ lat, lon, label: j.display_name });
      } catch {}
    }
  }
  flyTo(lat, lon, zoom = 18) {
    const sz = this.map.getSize();
    try {
      if (sz.x > 0 && sz.y > 0) this.map.flyTo([lat, lon], zoom, { duration: 1.5 });
      else this.map.setView([lat, lon], zoom, { animate: false });
    } catch { this.map.setView([lat, lon], zoom, { animate: false }); }
  }
  async search(q) {
    const r = await fetch(`${NOMINATIM_URL}/search?format=jsonv2&limit=1&accept-language=pt-BR&q=${encodeURIComponent(q)}`);
    const j = await r.json();
    if (!j.length) throw new Error('Lugar não encontrado');
    const { lat, lon, display_name } = j[0];
    this.pick(+lat, +lon, display_name);
    this.flyTo(+lat, +lon, 18);
  }
}
