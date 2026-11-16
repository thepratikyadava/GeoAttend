import { useEffect } from "react";
import {
  MapContainer,
  TileLayer,
  Circle,
  Polygon,
  Marker,
  Popup,
  useMap,
  useMapEvents
} from "react-leaflet";
import L from "leaflet";


// Custom SVG divIcons so Leaflet markers always render cleanly without broken asset paths
const userLocationIcon = L.divIcon({
  className: "geoattend-user-marker",
  html: `<div style="width:18px;height:18px;border-radius:9999px;background:#2563eb;border:3px solid #ffffff;box-shadow:0 0 0 4px rgba(37,99,235,0.28);"></div>`,
  iconSize: [18, 18],
  iconAnchor: [9, 9]
});

const centerPinIcon = L.divIcon({
  className: "geoattend-center-marker",
  html: `<div style="width:16px;height:16px;border-radius:9999px;background:#059669;border:3px solid #ffffff;box-shadow:0 2px 6px rgba(0,0,0,0.3);"></div>`,
  iconSize: [16, 16],
  iconAnchor: [8, 8]
});

const osmTileUrl = [
  "https:",
  "",
  "{s}.tile.openstreetmap.org",
  "{z}",
  "{x}",
  "{y}.png"
].join("/");


function MapViewportController({ center }) {
  const map = useMap();

  useEffect(() => {
    if (
      center &&
      typeof center.lat === "number" &&
      typeof center.lng === "number" &&
      !Number.isNaN(center.lat) &&
      !Number.isNaN(center.lng)
    ) {
      map.setView([center.lat, center.lng], map.getZoom(), {
        animate: true
      });
    }
  }, [center?.lat, center?.lng, map]);

  return null;
}


function MapClickCollector({ onMapClick }) {
  useMapEvents({
    click(e) {
      if (onMapClick) {
        onMapClick({
          lat: Number(e.latlng.lat.toFixed(6)),
          lng: Number(e.latlng.lng.toFixed(6))
        });
      }
    }
  });
  return null;
}


export default function GeofenceMap({
  locations = [],
  selectedLocation = null,
  draftCircle = null,
  draftPolygonPoints = [],
  userPosition = null,
  onMapClick = null,
  height = "380px"
}) {
  // Determine initial map center (IIITV-ICD Diu campus default if none provided)
  let initialCenter = { lat: 20.7197, lng: 70.9398 };

  if (userPosition?.latitude && userPosition?.longitude) {
    initialCenter = {
      lat: Number(userPosition.latitude),
      lng: Number(userPosition.longitude)
    };
  } else if (draftCircle?.lat && draftCircle?.lng) {
    initialCenter = {
      lat: Number(draftCircle.lat),
      lng: Number(draftCircle.lng)
    };
  } else if (selectedLocation) {
    if (
      selectedLocation.geofence_type === "circle" &&
      selectedLocation.center_latitude != null
    ) {
      initialCenter = {
        lat: Number(selectedLocation.center_latitude),
        lng: Number(selectedLocation.center_longitude)
      };
    } else if (
      selectedLocation.geofence_type === "polygon" &&
      selectedLocation.boundary_geojson?.coordinates?.[0]?.length
    ) {
      const firstPt = selectedLocation.boundary_geojson.coordinates[0][0];
      initialCenter = {
        lat: Number(firstPt[1]),
        lng: Number(firstPt[0])
      };
    }
  } else if (locations.length > 0) {
    const first = locations[0];
    if (first.geofence_type === "circle" && first.center_latitude != null) {
      initialCenter = {
        lat: Number(first.center_latitude),
        lng: Number(first.center_longitude)
      };
    } else if (
      first.geofence_type === "polygon" &&
      first.boundary_geojson?.coordinates?.[0]?.length
    ) {
      const pt = first.boundary_geojson.coordinates[0][0];
      initialCenter = { lat: Number(pt[1]), lng: Number(pt[0]) };
    }
  }

  return (
    <div
      className="overflow-hidden rounded-2xl border border-slate-200"
      style={{ height }}
    >
      <MapContainer
        center={[initialCenter.lat, initialCenter.lng]}
        zoom={17}
        scrollWheelZoom={true}
        style={{ height: "100%", width: "100%" }}
      >
        <TileLayer
          attribution="&copy; OpenStreetMap contributors"
          url={osmTileUrl}
        />

        <MapViewportController center={initialCenter} />

        {onMapClick && <MapClickCollector onMapClick={onMapClick} />}

        {/* Saved locations */}
        {locations.map((loc) => {
          const isSelected = selectedLocation?.id === loc.id;
          const color = !loc.is_active
            ? "#94a3b8"
            : isSelected
            ? "#059669"
            : "#2563eb";

          if (
            loc.geofence_type === "circle" &&
            loc.center_latitude != null &&
            loc.center_longitude != null &&
            loc.radius_meters != null
          ) {
            return (
              <Circle
                key={loc.id}
                center={[
                  Number(loc.center_latitude),
                  Number(loc.center_longitude)
                ]}
                radius={Number(loc.radius_meters)}
                pathOptions={{
                  color,
                  fillColor: color,
                  fillOpacity: isSelected ? 0.25 : 0.14,
                  weight: isSelected ? 3 : 2
                }}
              >
                <Popup>
                  <div className="text-xs">
                    <p className="font-bold text-slate-900">{loc.name}</p>
                    <p className="text-slate-600">
                      Circle · Radius: {loc.radius_meters}m
                    </p>
                  </div>
                </Popup>
              </Circle>
            );
          }

          if (
            loc.geofence_type === "polygon" &&
            loc.boundary_geojson?.coordinates?.[0]
          ) {
            const positions = loc.boundary_geojson.coordinates[0].map((pt) => [
              Number(pt[1]),
              Number(pt[0])
            ]);
            return (
              <Polygon
                key={loc.id}
                positions={positions}
                pathOptions={{
                  color,
                  fillColor: color,
                  fillOpacity: isSelected ? 0.25 : 0.14,
                  weight: isSelected ? 3 : 2
                }}
              >
                <Popup>
                  <div className="text-xs">
                    <p className="font-bold text-slate-900">{loc.name}</p>
                    <p className="text-slate-600">Polygon Geofence</p>
                  </div>
                </Popup>
              </Polygon>
            );
          }

          return null;
        })}

        {/* Draft circle being created/edited by admin */}
        {draftCircle &&
          typeof draftCircle.lat === "number" &&
          typeof draftCircle.lng === "number" &&
          !Number.isNaN(draftCircle.lat) &&
          !Number.isNaN(draftCircle.lng) && (
            <>
              <Marker
                position={[draftCircle.lat, draftCircle.lng]}
                icon={centerPinIcon}
              >
                <Popup>Draft Geofence Center</Popup>
              </Marker>
              <Circle
                center={[draftCircle.lat, draftCircle.lng]}
                radius={Number(draftCircle.radius || 100)}
                pathOptions={{
                  color: "#059669",
                  fillColor: "#10b981",
                  fillOpacity: 0.22,
                  dashArray: "6 4"
                }}
              />
            </>
          )}

        {/* Draft polygon vertices being drawn by admin */}
        {draftPolygonPoints.length > 0 && (
          <>
            {draftPolygonPoints.map((pt, idx) => (
              <Marker
                key={`${pt.lat}-${pt.lng}-${idx}`}
                position={[pt.lat, pt.lng]}
                icon={centerPinIcon}
              >
                <Popup>Vertex #{idx + 1}</Popup>
              </Marker>
            ))}
            {draftPolygonPoints.length >= 3 && (
              <Polygon
                positions={draftPolygonPoints.map((p) => [p.lat, p.lng])}
                pathOptions={{
                  color: "#059669",
                  fillColor: "#10b981",
                  fillOpacity: 0.22,
                  dashArray: "6 4"
                }}
              />
            )}
          </>
        )}

        {/* User's live GPS location */}
        {userPosition?.latitude != null && userPosition?.longitude != null && (
          <>
            <Marker
              position={[
                Number(userPosition.latitude),
                Number(userPosition.longitude)
              ]}
              icon={userLocationIcon}
            >
              <Popup>
                <div className="text-xs">
                  <p className="font-bold text-blue-700">Your GPS Position</p>
                  <p className="text-slate-600">
                    {Number(userPosition.latitude).toFixed(5)},{" "}
                    {Number(userPosition.longitude).toFixed(5)}
                  </p>
                  {userPosition.accuracy != null && (
                    <p className="text-slate-500">
                      Accuracy: ±{Math.round(userPosition.accuracy)}m
                    </p>
                  )}
                </div>
              </Popup>
            </Marker>

            {userPosition.accuracy != null && userPosition.accuracy > 0 && (
              <Circle
                center={[
                  Number(userPosition.latitude),
                  Number(userPosition.longitude)
                ]}
                radius={Number(userPosition.accuracy)}
                pathOptions={{
                  color: "#3b82f6",
                  fillColor: "#60a5fa",
                  fillOpacity: 0.1,
                  weight: 1
                }}
              />
            )}
          </>
        )}
      </MapContainer>
    </div>
  );
}
