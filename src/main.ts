import './ui/styles.css';
import { createMap } from './map/basemap';

const app = document.getElementById('app');
if (!app) throw new Error('#app missing');

const mapEl = document.createElement('div');
mapEl.id = 'map';
app.append(mapEl);
createMap(mapEl);
