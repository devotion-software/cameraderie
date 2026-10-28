<script lang="ts">
  import 'leaflet/dist/leaflet.css';
  import { onMount, onDestroy } from 'svelte';

  export interface MapMarker {
    id: string;
    lat: number;
    lng: number;
    href?: string;
    popupHtml?: string;
  }

  interface Props {
    markers: MapMarker[];
    height?: string;
    zoom?: number;
  }
  const { markers, height = '320px', zoom }: Props = $props();

  const TILE_LAYERS = {
    street: {
      label: 'Street',
      url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19,
    },
    satellite: {
      label: 'Satellite',
      url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      attribution: '&copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics',
      maxZoom: 19,
    },
    terrain: {
      label: 'Terrain',
      url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
      attribution: '&copy; OpenStreetMap contributors, SRTM &mdash; style: OpenTopoMap (CC-BY-SA)',
      maxZoom: 17,
    },
  } as const;
  type LayerKey = keyof typeof TILE_LAYERS;

  let container = $state<HTMLDivElement | null>(null);
  let layerKey = $state<LayerKey>('street');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let map: any = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let tileLayer: any = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let leaflet: any = null;

  function setLayer(key: LayerKey) {
    layerKey = key;
    if (!leaflet || !map) return;
    if (tileLayer) map.removeLayer(tileLayer);
    const def = TILE_LAYERS[key];
    tileLayer = leaflet
      .tileLayer(def.url, { attribution: def.attribution, maxZoom: def.maxZoom })
      .addTo(map);
  }

  onMount(async () => {
    const L = await import('leaflet');
    leaflet = L;
    if (!container || markers.length === 0) return;

    map = L.map(container, { scrollWheelZoom: false });
    setLayer(layerKey);

    const layerGroup = L.layerGroup().addTo(map);
    for (const m of markers) {
      const marker = L.circleMarker([m.lat, m.lng], {
        radius: 8,
        color: '#ffffff',
        weight: 2,
        fillColor: '#6a5bf2',
        fillOpacity: 1,
      });
      if (m.popupHtml) marker.bindPopup(m.popupHtml);
      if (m.href) {
        marker.on('click', () => {
          window.location.href = m.href!;
        });
      }
      marker.addTo(layerGroup);
    }

    if (markers.length === 1) {
      map.setView([markers[0]!.lat, markers[0]!.lng], zoom ?? 13);
    } else {
      const bounds = L.latLngBounds(markers.map((m) => [m.lat, m.lng] as [number, number]));
      map.fitBounds(bounds, { padding: [24, 24] });
    }
  });

  onDestroy(() => {
    map?.remove();
  });
</script>

<div class="map-wrap">
  <div class="map" style:height bind:this={container}></div>
  <div class="layer-switcher">
    {#each Object.entries(TILE_LAYERS) as [key, def] (key)}
      <button
        type="button"
        class="layer-btn"
        class:active={layerKey === key}
        onclick={() => setLayer(key as LayerKey)}
      >
        {def.label}
      </button>
    {/each}
  </div>
</div>

<style>
  .map-wrap {
    position: relative;
  }
  .layer-switcher {
    position: absolute;
    top: 10px;
    right: 10px;
    z-index: 1000;
    display: flex;
    gap: 2px;
    padding: 3px;
    border-radius: 999px;
    background: rgba(10, 10, 26, 0.55);
    backdrop-filter: blur(6px);
  }
  .layer-btn {
    border: none;
    background: transparent;
    color: white;
    font-size: 12px;
    padding: 5px 10px;
    border-radius: 999px;
    cursor: pointer;
    transition: background-color var(--dur-fast) ease;
  }
  .layer-btn:hover {
    background: rgba(255, 255, 255, 0.15);
  }
  .layer-btn.active {
    background: var(--accent);
    color: white;
  }
  .map {
    width: 100%;
    border-radius: var(--radius-sm);
    overflow: hidden;
    background: var(--surface-2);
  }
  .map :global(.leaflet-popup-content) {
    font-family: var(--font-body);
  }
</style>
