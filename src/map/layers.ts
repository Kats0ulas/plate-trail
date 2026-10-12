import type { GeoJSONSource, Map as MapLibreMap } from 'maplibre-gl';
import { LngLatBounds, Marker } from 'maplibre-gl';
import type { Feature, FeatureCollection, LineString, Point, Polygon } from 'geojson';
import { presetById } from '../config/retention';
import { haversineM } from '../engine/geo';
import { ageFraction, lowerBound, upperBound, windowStart } from '../engine/retention';
import { effectiveTimeZone, store, type AppState } from '../state';
import { LABEL_COLORS, LABEL_NAMES, formatDistance, labelIcon } from '../ui/format';
import { formatDateTime } from '../engine/time';
import type { Camera, Detection, Place, TrackPoint } from '../types';

/**
 * All data layers on the map, kept in sync with the store:
 * the (dimmed) real path, cameras that light up while they hold a visible read, a pulse at
 * the moment of a read, inferred places with uncertainty circles, and the truth overlay.
 */

const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] };
const ACTIVE = '#D55E00';
const IDLE = '#6b7280';

export const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

let track: TrackPoint[] = [];
export function setMapTrack(points: TrackPoint[]): void {
  track = points;
}

function circlePolygon(lat: number, lon: number, radiusM: number, steps = 64): Polygon {
  const ring: [number, number][] = [];
  const dLat = radiusM / 111_195;
  const dLon = radiusM / (111_195 * Math.cos((lat * Math.PI) / 180));
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * 2 * Math.PI;
    ring.push([lon + dLon * Math.sin(a), lat + dLat * Math.cos(a)]);
  }
  return { type: 'Polygon', coordinates: [ring] };
}

export function installLayers(map: MapLibreMap): void {
  const add = (id: string, promoteId?: string) =>
    map.addSource(id, { type: 'geojson', data: EMPTY, ...(promoteId ? { promoteId } : {}) });
  add('track');
  add('me');
  add('cameras', 'id');
  add('pulses');
  add('inferred-areas');
  add('truth-links');

  map.addLayer({
    id: 'track',
    type: 'line',
    source: 'track',
    layout: { 'line-join': 'round', 'line-cap': 'round', visibility: 'none' },
    paint: {
      'line-color': '#334155',
      'line-opacity': 0.35,
      'line-width': ['interpolate', ['linear'], ['zoom'], 9, 1, 15, 3],
    },
  });
  map.addLayer({
    id: 'inferred-areas-fill',
    type: 'fill',
    source: 'inferred-areas',
    paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.14 },
  });
  map.addLayer({
    id: 'inferred-areas-line',
    type: 'line',
    source: 'inferred-areas',
    paint: { 'line-color': ['get', 'color'], 'line-width': 1.5, 'line-opacity': 0.9 },
  });
  map.addLayer({
    id: 'truth-links',
    type: 'line',
    source: 'truth-links',
    paint: { 'line-color': '#111827', 'line-width': 1.5, 'line-dasharray': [2, 2] },
  });
  const isActive = ['boolean', ['feature-state', 'active'], false];
  const age = ['coalesce', ['feature-state', 'age'], 1];
  map.addLayer({
    id: 'cameras-real',
    type: 'circle',
    source: 'cameras',
    filter: ['==', ['get', 'simulated'], false],
    paint: {
      'circle-radius': [
        'interpolate',
        ['linear'],
        ['zoom'],
        9,
        ['case', isActive, 3.5, 1.8],
        15,
        ['case', isActive, 8, 4.5],
      ],
      'circle-color': ['case', isActive, ACTIVE, IDLE],
      'circle-opacity': ['case', isActive, ['interpolate', ['linear'], age, 0, 1, 1, 0.35], 0.55],
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': ['case', isActive, 1.2, 0.5],
    },
  } as never);
  map.addLayer({
    id: 'cameras-sim',
    type: 'circle',
    source: 'cameras',
    filter: ['==', ['get', 'simulated'], true],
    paint: {
      'circle-radius': [
        'interpolate',
        ['linear'],
        ['zoom'],
        9,
        ['case', isActive, 3.5, 2],
        15,
        ['case', isActive, 8, 5],
      ],
      'circle-color': ACTIVE,
      'circle-opacity': ['case', isActive, ['interpolate', ['linear'], age, 0, 0.75, 1, 0.2], 0],
      'circle-stroke-color': ['case', isActive, ACTIVE, IDLE],
      'circle-stroke-width': ['case', isActive, 1.6, 1],
      'circle-stroke-opacity': ['case', isActive, 1, 0.6],
    },
  } as never);
  map.addLayer({
    id: 'pulses',
    type: 'circle',
    source: 'pulses',
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['get', 'age'], 0, 6, 1, 26],
      'circle-color': ACTIVE,
      'circle-opacity': ['interpolate', ['linear'], ['get', 'age'], 0, 0.35, 1, 0],
      'circle-stroke-color': ACTIVE,
      'circle-stroke-width': 1.5,
      'circle-stroke-opacity': ['interpolate', ['linear'], ['get', 'age'], 0, 0.9, 1, 0],
    },
  });
  map.addLayer({
    id: 'me',
    type: 'circle',
    source: 'me',
    layout: { visibility: 'none' },
    paint: {
      'circle-radius': 5,
      'circle-color': '#111827',
      'circle-stroke-color': '#fff',
      'circle-stroke-width': 2,
    },
  });

  wire(map);
}

function src(map: MapLibreMap, id: string): GeoJSONSource {
  return map.getSource(id) as GeoJSONSource;
}

function wire(map: MapLibreMap): void {
  // Error labels only once zoomed in enough to tell places apart.
  const zoomClass = () => map.getContainer().classList.toggle('far', map.getZoom() < 10.5);
  map.on('zoomend', zoomClass);
  zoomClass();

  // Real path
  store.on(['dataset'], () => {
    const data: Feature<LineString> = {
      type: 'Feature',
      properties: {},
      geometry: { type: 'LineString', coordinates: track.map((p) => [p.lon, p.lat]) },
    };
    src(map, 'track').setData(track.length > 1 ? data : EMPTY);
    if (track.length > 1) {
      const b = new LngLatBounds();
      for (let i = 0; i < track.length; i += Math.max(1, Math.floor(track.length / 2000)))
        b.extend([track[i]!.lon, track[i]!.lat]);
      map.fitBounds(b, { padding: fitPadding(), duration: reducedMotion() ? 0 : 900, maxZoom: 13 });
    }
  });
  store.on(
    ['showTrack'],
    (s) => {
      const v = s.showTrack ? 'visible' : 'none';
      map.setLayoutProperty('track', 'visibility', v);
      map.setLayoutProperty('me', 'visibility', v);
    },
    true,
  );

  // Cameras
  let cameraIds = new Set<string>();
  store.on(['cameras'], (s) => {
    const fc: FeatureCollection<Point> = {
      type: 'FeatureCollection',
      features: s.cameras.map((c) => ({
        type: 'Feature',
        properties: { id: c.id, label: c.label, simulated: c.simulated },
        geometry: { type: 'Point', coordinates: [c.lon, c.lat] },
      })),
    };
    src(map, 'cameras').setData(fc);
    cameraIds = new Set(s.cameras.map((c) => c.id));
    activeState.clear();
  });

  // Reads in the retention window light their camera; a pulse marks the moment of a read.
  const activeState = new Map<string, number>(); // camera id → age bucket currently set
  let lastPulseKey = '';
  const updateReads = (s: AppState) => {
    const hours = presetById(s.retentionId).hours;
    const dets = s.detections;
    const from = windowStart(s.T, hours);
    const i0 = from === -Infinity ? 0 : lowerBound(dets, from);
    const i1 = upperBound(dets, s.T);
    const newest = new Map<string, number>();
    for (let i = i0; i < i1; i++) newest.set(dets[i]!.cameraId, dets[i]!.t);
    for (const [id, t] of newest) {
      if (!cameraIds.has(id)) continue;
      const bucket = Math.round(ageFraction(t, s.T, hours) * 20) / 20;
      if (activeState.get(id) !== bucket) {
        map.setFeatureState({ source: 'cameras', id }, { active: true, age: bucket });
        activeState.set(id, bucket);
      }
    }
    for (const id of [...activeState.keys()]) {
      if (!newest.has(id)) {
        map.setFeatureState({ source: 'cameras', id }, { active: false, age: 1 });
        activeState.delete(id);
      }
    }
    // Pulses: reads during the last ~0.7 s of replay (or the last 20 simulated minutes when paused).
    const pulseSpan = reducedMotion() ? 0 : Math.max(20 * 60_000, (s.playing ? s.speed : 0) * 0.7);
    const p0 = lowerBound(dets, s.T - pulseSpan);
    const key = `${p0}-${i1}-${Math.round(s.T / 30_000)}`;
    if (key !== lastPulseKey) {
      lastPulseKey = key;
      const features: Feature<Point>[] = [];
      if (pulseSpan > 0)
        for (let i = p0; i < i1; i++) {
          const d = dets[i]!;
          features.push({
            type: 'Feature',
            properties: { age: (s.T - d.t) / pulseSpan },
            geometry: { type: 'Point', coordinates: [d.lon, d.lat] },
          });
        }
      src(map, 'pulses').setData({ type: 'FeatureCollection', features });
    }
    // Where the person really is (only with "Show my real path").
    if (s.showTrack && track.length) {
      const k = Math.min(track.length - 1, Math.max(0, upperBound(track, s.T) - 1));
      const p = track[k]!;
      src(map, 'me').setData({
        type: 'Feature',
        properties: {},
        geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
      });
    }
  };
  store.on(['T', 'detections', 'retentionId', 'cameras', 'showTrack', 'playing'], updateReads);

  // Inferred places + truth overlay
  let markers: Marker[] = [];
  const renderPlaces = (s: AppState) => {
    for (const m of markers) m.remove();
    markers = [];
    const places = s.inference?.places ?? [];
    src(map, 'inferred-areas').setData({
      type: 'FeatureCollection',
      features: places.map((p) => ({
        type: 'Feature',
        properties: { color: LABEL_COLORS[p.label] },
        geometry: circlePolygon(p.lat, p.lon, p.radiusM),
      })),
    });
    for (const p of places) markers.push(placeMarker(map, p, 'inferred'));

    const links: Feature<LineString>[] = [];
    if (s.revealTruth && s.truth) {
      for (const t of s.truth.places) {
        const m = new Marker({
          element: truthMarkerEl(t.label, t.name, !!t.sensitive),
          anchor: 'center',
        })
          .setLngLat([t.lon, t.lat])
          .addTo(map);
        markers.push(m);
      }
      const byId = new Map(s.truth.places.map((t) => [t.id, t]));
      for (const sc of s.scores ?? []) {
        const inf = places.find((p) => p.id === sc.inferredId);
        const tr = sc.truthId ? byId.get(sc.truthId) : undefined;
        if (!inf || !tr || sc.errorM === null || sc.errorM > 5000) continue;
        links.push({
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'LineString',
            coordinates: [
              [inf.lon, inf.lat],
              [tr.lon, tr.lat],
            ],
          },
        });
        const mid: [number, number] = [(inf.lon + tr.lon) / 2, (inf.lat + tr.lat) / 2];
        const tag = document.createElement('div');
        tag.className = `error-tag ${sc.hit ? 'hit' : 'miss'}`;
        tag.textContent = `${formatDistance(haversineM(inf, tr))}${sc.hit ? '' : ' · miss'}`;
        markers.push(
          new Marker({ element: tag, anchor: 'bottom', offset: [0, -4] }).setLngLat(mid).addTo(map),
        );
      }
    }
    src(map, 'truth-links').setData({ type: 'FeatureCollection', features: links });
  };
  store.on(['inference', 'revealTruth', 'truth', 'scores'], renderPlaces);
}

function placeMarker(map: MapLibreMap, p: Place, kind: 'inferred'): Marker {
  const tz = effectiveTimeZone();
  const el = document.createElement('button');
  el.type = 'button';
  el.className = `place-marker ${kind} label-${p.label}`;
  el.innerHTML = labelIcon(p.label, 16);
  const title = `${LABEL_NAMES[p.label]} (observer's guess, ${p.confidence.toLowerCase()} confidence, ± ${formatDistance(p.radiusM)}). Last seen ${formatDateTime(p.lastSeen, tz)}.`;
  el.title = title;
  el.setAttribute('aria-label', title);
  el.addEventListener('click', () => {
    document
      .getElementById(`card-${p.id}`)
      ?.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'center' });
    document.getElementById(`card-${p.id}`)?.classList.add('flash');
    setTimeout(() => document.getElementById(`card-${p.id}`)?.classList.remove('flash'), 1200);
    store.set({ sheet: 'notebook', sheetOpen: true });
  });
  return new Marker({ element: el, anchor: 'center' }).setLngLat([p.lon, p.lat]).addTo(map);
}

function truthMarkerEl(label: Place['label'], name: string, sensitive: boolean): HTMLElement {
  const el = document.createElement('div');
  el.className = `place-marker truth label-${label}${sensitive ? ' sensitive' : ''}`;
  el.innerHTML = labelIcon(label, 13);
  el.title = `Truth: ${name}`;
  el.setAttribute('role', 'img');
  el.setAttribute('aria-label', `True place: ${name}`);
  return el;
}

function fitPadding() {
  const wide = window.innerWidth >= 900;
  return wide
    ? { top: 60, bottom: 150, left: 360, right: 400 }
    : { top: 40, bottom: 260, left: 30, right: 30 };
}

/** Keep a reference for flyTo from the notebook. */
export function flyToPlace(map: MapLibreMap, p: { lat: number; lon: number }): void {
  map.flyTo({
    center: [p.lon, p.lat],
    zoom: Math.max(map.getZoom(), 14),
    duration: reducedMotion() ? 0 : 800,
  });
}

export function cameraById(cams: readonly Camera[]): Map<string, Camera> {
  return new Map(cams.map((c) => [c.id, c]));
}

export type { Detection };
