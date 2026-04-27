import { useEffect, useRef, useState } from "react";
import { APIProvider, Map, Marker, useMap, useMapsLibrary } from "@vis.gl/react-google-maps";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MapPin, Search, Satellite, Map as MapIcon } from "lucide-react";

const API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY ?? "";

function PlaceAutocomplete({ onPick }: { onPick: (lat: number, lng: number) => void }) {
  const places = useMapsLibrary("places");
  const inputRef = useRef<HTMLInputElement>(null);
  const [autocomplete, setAutocomplete] = useState<google.maps.places.Autocomplete | null>(null);

  useEffect(() => {
    if (!places || !inputRef.current) return;
    const ac = new places.Autocomplete(inputRef.current, {
      fields: ["geometry", "name", "formatted_address"],
      componentRestrictions: { country: "br" },
    });
    ac.addListener("place_changed", () => {
      const place = ac.getPlace();
      const loc = place.geometry?.location;
      if (loc) onPick(+loc.lat().toFixed(6), +loc.lng().toFixed(6));
    });
    setAutocomplete(ac);
    return () => {
      google.maps.event.clearInstanceListeners(ac);
    };
  }, [places, onPick]);

  return (
    <Input
      ref={inputRef}
      placeholder={autocomplete ? "Buscar (cidade, endereço, fazenda)…" : "Carregando busca…"}
      className="h-8 text-xs flex-1"
      disabled={!autocomplete}
    />
  );
}

function MapRecenter({ lat, lng }: { lat: number; lng: number }) {
  const map = useMap();
  useEffect(() => {
    if (!map) return;
    map.panTo({ lat, lng });
    if ((map.getZoom() ?? 0) < 12) map.setZoom(17);
  }, [lat, lng, map]);
  return null;
}

export function GoogleMapPicker({
  lat, lng, onChange,
}: {
  lat: number | null;
  lng: number | null;
  onChange: (lat: number | null, lng: number | null) => void;
}) {
  const [satellite, setSatellite] = useState(true);
  const initialLat = lat ?? -15.78;
  const initialLng = lng ?? -47.93;
  const initialZoom = lat !== null && lng !== null ? 17 : 4;

  if (!API_KEY) {
    return (
      <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-200/80">
        Google Maps API key não configurada. Configure <code className="font-mono">VITE_GOOGLE_MAPS_API_KEY</code> no .env e refaça o build.
      </div>
    );
  }

  return (
    <APIProvider apiKey={API_KEY} libraries={["places"]}>
      <div className="space-y-2">
        <div className="flex gap-2 items-center">
          <PlaceAutocomplete onPick={(la, ln) => onChange(la, ln)} />
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
          <Map
            defaultCenter={{ lat: initialLat, lng: initialLng }}
            defaultZoom={initialZoom}
            mapTypeId={satellite ? "hybrid" : "roadmap"}
            gestureHandling="greedy"
            disableDefaultUI={false}
            mapTypeControl={false}
            streetViewControl={false}
            fullscreenControl={false}
            clickableIcons={false}
            onClick={(e) => {
              if (!e.detail.latLng) return;
              onChange(+e.detail.latLng.lat.toFixed(6), +e.detail.latLng.lng.toFixed(6));
            }}
          >
            {lat !== null && lng !== null && (
              <>
                <Marker
                  position={{ lat, lng }}
                  draggable
                  onDragEnd={(e) => {
                    if (!e.latLng) return;
                    onChange(+e.latLng.lat().toFixed(6), +e.latLng.lng().toFixed(6));
                  }}
                />
                <MapRecenter lat={lat} lng={lng} />
              </>
            )}
          </Map>
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
          <MapPin className="w-3 h-3" /> Clique no mapa, arraste o pino, ou busque pelo nome/endereço.
          Imagens © Google.
        </p>
      </div>
    </APIProvider>
  );
}
