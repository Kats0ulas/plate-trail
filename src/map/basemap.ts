import {
  AttributionControl,
  Map as MapLibreMap,
  NavigationControl,
  ScaleControl,
  setWorkerUrl,
} from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
// MapLibre 6 locates its worker relative to its own module URL, which breaks once Vite
// bundles it. Point it at the worker file explicitly; it is served from our own origin,
// so the CSP needs no blob: workers for it.
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';

/** OpenFreeMap: free, no API key. Positron is muted so the data layers stand out. */
export const BASEMAP_STYLE_URL = 'https://tiles.openfreemap.org/styles/positron';

setWorkerUrl(maplibreWorkerUrl);

export function createMap(container: HTMLElement): MapLibreMap {
  const map = new MapLibreMap({
    container,
    style: BASEMAP_STYLE_URL,
    center: [-30, 38],
    zoom: 1.6,
    attributionControl: false,
  });
  map.addControl(
    new AttributionControl({
      compact: false,
      customAttribution:
        '<a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> · Cameras &amp; roads © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors (ODbL)',
    }),
    'bottom-right',
  );
  map.addControl(new NavigationControl({ showCompass: false }), 'top-right');
  map.addControl(new ScaleControl({ unit: 'metric' }), 'bottom-left');
  return map;
}
