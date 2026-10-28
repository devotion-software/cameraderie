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

  let container = $state<HTMLDivElement | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let map: any = null;

  onMount(async () => {
    const L = await import('leaflet');
    if (!container || markers.length === 0) return;

    map = L.map(container, { scrollWheelZoom: false });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(map);

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

<div class="map" style:height bind:this={container}></div>

<style>
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
