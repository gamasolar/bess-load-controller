import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import { MapContainer, TileLayer, Marker, useMap, useMapEvents } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MapPin, Search, Satellite, Map as MapIcon } from "lucide-react";

// Fix do bug clássico de ícones do Leaflet em bundlers (paths default 404).
delete (L.Icon.Default.prototype as { _getIconUrl?: unknown })._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png",
  iconUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png",
  shadowUrl: "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png",
});

const SATELLITE_TILE = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
const SATELLITE_ATTR = "Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics, USDA FSA, USGS, Aerogrid, IGN, IGP, swisstopo, and the GIS User Community";
const STREET_TILE = "https://{s}.tile.openstreetmap.org/{z}/{y}/{x}.png";
const STREET_ATTR = "© OpenStreetMap contributors";

function MapClickHandler({ onPick }: { onPick: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(e) {
      onPick(+e.latlng.lat.toFixed(6), +e.latlng.lng.toFixed(6));
    },
  });
  return null;
}

function MapRecenter({ lat, lng }: { lat: number; lng: number }) {
  const map = useMap();
  useEffect(() => {
    map.setView([lat, lng], map.getZoom());
  }, [lat, lng, map]);
  return null;
}

export function LocationPicker({
  lat, lng, onChange,
}: {
  lat: number | null;
  lng: number | null;
  onChange: (lat: number | null, lng: number | null) => void;
}) {
  // Default: centro do Brasil (Brasília) caso não haja coordenada salva
  const initialLat = lat ?? -15.78;
  const initialLng = lng ?? -47.93;
  const initialZoom = lat !== null && lng !== null ? 17 : 4;

  const [satellite, setSatellite] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const markerRef = useRef<L.Marker>(null);

  async function handleSearch(e?: React.FormEvent) {
    e?.preventDefault();
    if (!searchQuery.trim()) return;
    setSearching(true);
    try {
      // Nominatim — search free, sem API key. Limit 1 req/s.
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=br&q=${encodeURIComponent(searchQuery)}`,
        { headers: { "Accept-Language": "pt-BR" } },
      );
      const json: Array<{ lat: string; lon: string }> = await res.json();
      if (json.length > 0) {
        onChange(+(+json[0].lat).toFixed(6), +(+json[0].lon).toFixed(6));
      }
    } catch {
      // silencia
    } finally {
      setSearching(false);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-2 items-center">
        <form onSubmit={handleSearch} className="flex-1 flex gap-1">
          <Input
            placeholder="Buscar (cidade, endereço, nome do local)…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-8 text-xs"
          />
          <Button type="submit" size="sm" variant="outline" disabled={searching} className="h-8 px-2">
            <Search className="w-3.5 h-3.5" />
          </Button>
        </form>
        <Button
          type="button" size="sm" variant="outline"
          onClick={() => setSatellite((s) => !s)}
          className="h-8 gap-1 px-2"
          title={satellite ? "Trocar pra mapa" : "Trocar pra satélite"}
        >
          {satellite ? <MapIcon className="w-3.5 h-3.5" /> : <Satellite className="w-3.5 h-3.5" />}
          <span className="text-[11px]">{satellite ? "Mapa" : "Satélite"}</span>
        </Button>
      </div>

      <div className="rounded-md overflow-hidden border border-white/10" style={{ height: 320 }}>
        <MapContainer
          center={[initialLat, initialLng]}
          zoom={initialZoom}
          style={{ height: "100%", width: "100%" }}
          scrollWheelZoom
        >
          {satellite ? (
            <TileLayer url={SATELLITE_TILE} attribution={SATELLITE_ATTR} />
          ) : (
            <TileLayer url={STREET_TILE} attribution={STREET_ATTR} />
          )}
          <MapClickHandler onPick={(la, ln) => onChange(la, ln)} />
          {lat !== null && lng !== null && (
            <>
              <Marker
                position={[lat, lng]}
                draggable
                ref={markerRef}
                eventHandlers={{
                  dragend: () => {
                    const m = markerRef.current;
                    if (!m) return;
                    const p = m.getLatLng();
                    onChange(+p.lat.toFixed(6), +p.lng.toFixed(6));
                  },
                }}
              />
              <MapRecenter lat={lat} lng={lng} />
            </>
          )}
        </MapContainer>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Input
          placeholder="-19.918"
          type="number" step="0.000001"
          value={lat ?? ""}
          onChange={(e) => onChange(e.target.value === "" ? null : +e.target.value, lng)}
          className="font-mono text-xs h-8"
        />
        <Input
          placeholder="-44.123"
          type="number" step="0.000001"
          value={lng ?? ""}
          onChange={(e) => onChange(lat, e.target.value === "" ? null : +e.target.value)}
          className="font-mono text-xs h-8"
        />
      </div>

      <p className="text-[10px] text-muted-foreground flex items-center gap-1">
        <MapPin className="w-3 h-3" /> Clique no mapa, arraste o pino, ou digite endereço.
        Tiles satélite ESRI · Busca Nominatim/OSM.
      </p>
    </div>
  );
}
