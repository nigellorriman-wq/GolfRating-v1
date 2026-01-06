import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import ReactDOM from 'react-dom/client';
import { MapContainer, TileLayer, Marker, Polyline, Circle, useMap, Polygon } from 'react-leaflet';
import * as L from 'leaflet';
import { Ruler, RotateCcw, Navigation, Target } from 'lucide-react';

/** --- TYPES --- **/
type AppMode = 'Trk' | 'Grn';
type UnitSystem = 'Meters' | 'Yards';
type PointType = 'green' | 'bunker';

interface GeoPoint {
  lat: number;
  lng: number;
  alt: number | null;
  accuracy: number;
  timestamp: number;
  type?: PointType;
}

interface TrackingState {
  isActive: boolean;
  startPoint: GeoPoint | null;
  path: GeoPoint[];
  initialAltitude: number | null;
  currentAltitude: number | null;
}

interface MappingState {
  isActive: boolean;
  isBunkerActive: boolean;
  points: GeoPoint[];
  isClosed: boolean;
}

/** --- UTILS --- **/
const calculateDistance = (p1: GeoPoint, p2: GeoPoint): number => {
  const R = 6371e3; // metres
  const φ1 = p1.lat * Math.PI / 180;
  const φ2 = p2.lat * Math.PI / 180;
  const Δφ = (p2.lat - p1.lat) * Math.PI / 180;
  const Δλ = (p2.lng - p1.lng) * Math.PI / 180;
  const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) *
    Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

const toDisplayDistance = (meters: number, unit: UnitSystem): string => {
  const value = unit === 'Meters' ? meters : meters * 1.09361;
  return value.toFixed(1);
};

const toDisplayElevation = (meters: number, unit: UnitSystem): string => {
  const value = unit === 'Meters' ? meters : meters * 3.28084;
  return value.toFixed(1);
};

const calculatePolygonArea = (points: GeoPoint[]): number => {
  if (points.length < 3) return 0;
  const R = 6371e3;
  const lat0 = points[0].lat * Math.PI / 180;
  const coords = points.map(p => ({
    x: p.lng * Math.PI / 180 * R * Math.cos(lat0),
    y: p.lat * Math.PI / 180 * R
  }));
  let area = 0;
  for (let i = 0; i < coords.length; i++) {
    const j = (i + 1) % coords.length;
    area += coords[i].x * coords[j].y;
    area -= coords[j].x * coords[i].y;
  }
  return Math.abs(area) / 2;
};

const getAccuracyColor = (accuracy: number): string => {
  if (accuracy < 5) return 'rgba(34, 197, 94, 0.4)';
  if (accuracy <= 12) return 'rgba(234, 179, 8, 0.4)';
  return 'rgba(239, 68, 68, 0.4)';
};

const blueIcon = new L.Icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-blue.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
  iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34], shadowSize: [41, 41]
});

/** --- COMPONENTS --- **/
const MapController: React.FC<{ 
  points: GeoPoint[], 
  currentPos: GeoPoint | null, 
  mode: AppMode, 
  isTracking: boolean 
}> = ({ points, currentPos, mode, isTracking }) => {
  const map = useMap();
  const hasCenteredOnce = useRef(false);
  
  useEffect(() => {
    const timer = setTimeout(() => map.invalidateSize(), 500);
    return () => clearTimeout(timer);
  }, [map, mode]);

  useEffect(() => {
    if (mode === 'Trk') {
      if (isTracking && points.length > 1) {
        const bounds = L.latLngBounds(points.map(p => [p.lat, p.lng]));
        if (currentPos) bounds.extend([currentPos.lat, currentPos.lng]);
        map.fitBounds(bounds, { padding: [50, 50], animate: true });
      } else if (currentPos && (!hasCenteredOnce.current || !isTracking)) {
        map.setView([currentPos.lat, currentPos.lng], 18);
        hasCenteredOnce.current = true;
      }
    } else if (mode === 'Grn') {
      if (points.length > 0) {
        const bounds = L.latLngBounds(points.map(p => [p.lat, p.lng]));
        if (currentPos) bounds.extend([currentPos.lat, currentPos.lng]);
        map.fitBounds(bounds, { padding: [40, 40], animate: true });
      } else if (currentPos && !hasCenteredOnce.current) {
        map.setView([currentPos.lat, currentPos.lng], 20);
        hasCenteredOnce.current = true;
      }
    }
  }, [points, currentPos, mode, isTracking, map]);

  return null;
};

const App: React.FC = () => {
  const [mode, setMode] = useState<AppMode>('Trk');
  const [units, setUnits] = useState<UnitSystem>('Yards');
  const [currentPos, setCurrentPos] = useState<GeoPoint | null>(null);

  const [tracking, setTracking] = useState<TrackingState>({
    isActive: false, startPoint: null, path: [], initialAltitude: null, currentAltitude: null
  });

  const [mapping, setMapping] = useState<MappingState>({
    isActive: false, isBunkerActive: false, points: [], isClosed: false
  });

  const handlePositionUpdate = useCallback((pos: GeolocationPosition) => {
    const newPoint: GeoPoint = {
      lat: pos.coords.latitude, 
      lng: pos.coords.longitude, 
      alt: pos.coords.altitude, 
      accuracy: pos.coords.accuracy, 
      timestamp: Date.now()
    };
    setCurrentPos(newPoint);

    if (tracking.isActive) {
      setTracking(prev => {
        const lastInPath = prev.path[prev.path.length - 1];
        if (lastInPath && calculateDistance(lastInPath, newPoint) < 0.2) return prev;
        return {
          ...prev, 
          path: [...prev.path, newPoint], 
          currentAltitude: newPoint.alt,
          initialAltitude: prev.initialAltitude === null ? newPoint.alt : prev.initialAltitude
        };
      });
    }

    if (mapping.isActive && !mapping.isClosed) {
      setMapping(prev => {
        const lastPoint = prev.points[prev.points.length - 1];
        if (!lastPoint) return { ...prev, points: [{ ...newPoint, type: 'green' }] };
        if (calculateDistance(lastPoint, newPoint) >= 0.4) {
          return { ...prev, points: [...prev.points, { ...newPoint, type: prev.isBunkerActive ? 'bunker' : 'green' }] };
        }
        return prev;
      });
    }
  }, [tracking.isActive, mapping.isActive, mapping.isClosed]);

  useEffect(() => {
    if (navigator.geolocation) {
      const watchId = navigator.geolocation.watchPosition(
        handlePositionUpdate, 
        (err) => console.warn("GPS Warning:", err),
        { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 }
      );
      return () => navigator.geolocation.clearWatch(watchId);
    }
  }, [handlePositionUpdate]);

  const totalDistance = tracking.isActive && tracking.path.length > 1
    ? calculateDistance(tracking.path[0], tracking.path[tracking.path.length - 1]) : 0;

  const elevationChange = (tracking.currentAltitude !== null && tracking.initialAltitude !== null)
    ? tracking.currentAltitude - tracking.initialAltitude : 0;

  const mapMetrics = useMemo(() => {
    if (mapping.points.length < 2) return null;
    let totalLen = 0; let bunkerLen = 0;
    for (let i = 0; i < mapping.points.length - 1; i++) {
      const d = calculateDistance(mapping.points[i], mapping.points[i+1]);
      totalLen += d; if (mapping.points[i+1].type === 'bunker') bunkerLen += d;
    }
    if (mapping.isClosed) totalLen += calculateDistance(mapping.points[mapping.points.length - 1], mapping.points[0]);
    const area = calculatePolygonArea(mapping.points);
    return { totalLen, bunkerLen, area, bunkerPct: totalLen > 0 ? Math.round((bunkerLen / totalLen) * 100) : 0 };
  }, [mapping.points, mapping.isClosed]);

  return (
    <div className="flex flex-col h-full w-full bg-[#0f172a] text-white overflow-hidden select-none">
      <div className="h-[env(safe-area-inset-top)] w-full bg-[#1e293b] shrink-0"></div>

      <header className="px-4 py-3 flex items-center justify-between border-b border-slate-700/50 bg-[#1e293b]/95 backdrop-blur-xl z-[1000]">
        <div className="flex bg-slate-800/80 p-1 rounded-2xl border border-slate-700/50">
          <button onClick={() => setMode('Trk')} className={`px-6 py-2 rounded-xl text-[10px] font-black tracking-widest transition-all ${mode === 'Trk' ? 'bg-blue-600 text-white shadow-lg' : 'text-slate-500'}`}>TRACK</button>
          <button onClick={() => setMode('Grn')} className={`px-6 py-2 rounded-xl text-[10px] font-black tracking-widest transition-all ${mode === 'Grn' ? 'bg-emerald-600 text-white shadow-lg' : 'text-slate-500'}`}>GREEN</button>
        </div>
        <button onClick={() => setUnits(u => u === 'Meters' ? 'Yards' : 'Meters')} className="p-2.5 bg-slate-800/80 rounded-xl border border-slate-700/50">
          <Ruler size={16} className="text-blue-400" />
        </button>
      </header>

      <main className="flex-1 relative bg-slate-950 overflow-hidden">
        <div className="absolute inset-0 z-0">
          <MapContainer center={[0, 0]} zoom={2} className="w-full h-full" zoomControl={false} attributionControl={false}>
            <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" maxZoom={20} />
            <MapController points={mode === 'Trk' ? tracking.path : mapping.points} currentPos={currentPos} mode={mode} isTracking={tracking.isActive} />
            {currentPos && (
              <>
                <Marker position={[currentPos.lat, currentPos.lng]} icon={blueIcon} />
                <Circle center={[currentPos.lat, currentPos.lng]} radius={currentPos.accuracy} fillColor={getAccuracyColor(currentPos.accuracy)} color="transparent" fillOpacity={0.15} />
              </>
            )}
            {mode === 'Trk' && tracking.path.length > 1 && <Polyline positions={tracking.path.map(p => [p.lat, p.lng])} color="#3b82f6" weight={4} dashArray="8, 12" />}
            {mode === 'Grn' && mapping.points.length > 1 && (
              <>
                {mapping.points.map((p, idx) => {
                  if (idx === 0) return null;
                  const prev = mapping.points[idx - 1];
                  return <Polyline key={`s-${idx}`} positions={[[prev.lat, prev.lng], [p.lat, p.lng]]} color={p.type === 'bunker' ? '#f59e0b' : '#10b981'} weight={5} />;
                })}
                {mapping.isClosed && <Polygon positions={mapping.points.map(p => [p.lat, p.lng])} color="#10b981" weight={1} fillColor="#10b981" fillOpacity={0.1} />}
              </>
            )}
          </MapContainer>
        </div>

        <div className="relative h-full w-full pointer-events-none z-10 flex flex-col p-4 justify-between">
          <div>
            <div className="bg-[#0f172a]/95 backdrop-blur-2xl p-5 rounded-3xl border border-slate-700/50 shadow-2xl pointer-events-auto relative">
              <div className="absolute top-2 right-4 flex items-center gap-1.5 px-2 py-1 bg-slate-900/40 rounded-lg border border-slate-800/50">
                <div className={`w-1.5 h-1.5 rounded-full ${currentPos ? (currentPos.accuracy < 10 ? 'bg-emerald-500' : 'bg-amber-500') : 'bg-red-500 animate-pulse'}`}></div>
                <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">
                  {currentPos ? `±${currentPos.accuracy.toFixed(1)}m` : '±...'}
                </span>
              </div>
              
              {mode === 'Trk' ? (
                <div className="flex items-center justify-around pt-2">
                  <div className="text-center">
                    <p className="text-slate-500 text-[10px] font-black uppercase mb-1 tracking-widest">DISTANCE</p>
                    <div className="text-5xl font-black glow-blue tabular-nums">
                      {currentPos ? toDisplayDistance(totalDistance, units) : '0.0'}
                      <span className="text-xs ml-1 font-bold opacity-40 uppercase">{units === 'Yards' ? 'yd' : 'm'}</span>
                    </div>
                  </div>
                  <div className="h-10 w-px bg-slate-800 mx-4"></div>
                  <div className="text-center">
                    <p className="text-slate-500 text-[10px] font-black uppercase mb-1 tracking-widest">ELEVATION</p>
                    <div className="text-4xl font-black glow-amber tabular-nums">
                      {currentPos ? `${elevationChange >= 0 ? '+' : ''}${toDisplayElevation(elevationChange, units)}` : '0.0'}
                      <span className="text-xs ml-1 font-bold opacity-40 uppercase">{units === 'Yards' ? 'ft' : 'm'}</span>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-slate-800/40 p-3 rounded-2xl border border-slate-700/30">
                    <p className="text-[9px] text-slate-500 font-black uppercase mb-1">Perimeter</p>
                    <p className="text-xl font-black text-emerald-400">{mapMetrics ? toDisplayDistance(mapMetrics.totalLen, units) : '--'} <span className="text-[10px] opacity-50">{units === 'Yards' ? 'yd' : 'm'}</span></p>
                  </div>
                  <div className="bg-slate-800/40 p-3 rounded-2xl border border-slate-700/30">
                    <p className="text-[9px] text-slate-500 font-black uppercase mb-1">Bunker %</p>
                    <p className="text-xl font-black text-amber-400">{mapMetrics ? `${mapMetrics.bunkerPct}%` : '--'}</p>
                  </div>
                  <div className="bg-slate-800/40 p-3 rounded-2xl border border-slate-700/30 col-span-2">
                    <p className="text-[9px] text-slate-500 font-black uppercase mb-1">Green Area</p>
                    <p className="text-xl font-black text-blue-400">{mapMetrics ? (mapMetrics.area * (units === 'Yards' ? 1.196 : 1)).toFixed(0) : '--'} <span className="text-[10px] opacity-50">{units === 'Yards' ? 'sqyd' : 'm²'}</span></p>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="pb-12 pointer-events-auto flex flex-col items-center gap-3">
            {mode === 'Trk' ? (
              <button onClick={() => setTracking(p => ({ ...p, isActive: !p.isActive, initialAltitude: currentPos?.alt ?? null, path: currentPos ? [currentPos] : [] }))} className={`w-full max-w-[280px] py-5 rounded-[2rem] font-black text-xs tracking-widest uppercase shadow-xl flex items-center justify-center gap-4 transition-all ${tracking.isActive ? 'bg-red-600' : 'bg-blue-600'}`}>
                <RotateCcw size={18} className={tracking.isActive ? 'animate-spin' : ''} />
                {tracking.isActive ? 'STOP TRACKING' : 'START TRACKING'}
              </button>
            ) : (
              <div className="w-full flex flex-col gap-3">
                <div className="flex gap-2">
                  <button onClick={() => setMapping({ isActive: true, points: currentPos ? [{...currentPos, type:'green'}] : [], isBunkerActive: false, isClosed: false })} className="flex-1 py-5 rounded-3xl font-black text-[10px] tracking-widest bg-emerald-600">NEW GREEN</button>
                  <button onClick={() => setMapping(p => ({ ...p, isClosed: true }))} className="flex-1 py-5 rounded-3xl font-black text-[10px] tracking-widest bg-blue-600">CLOSE LOOP</button>
                </div>
                <button onPointerDown={() => setMapping(p => ({ ...p, isBunkerActive: true }))} onPointerUp={() => setMapping(p => ({ ...p, isBunkerActive: false }))} className={`w-full py-5 rounded-3xl font-black text-xs tracking-widest transition-all ${mapping.isBunkerActive ? 'bg-amber-400 text-black' : 'bg-slate-800 text-slate-400 border border-slate-700'}`}>
                  HOLD FOR BUNKER
                </button>
              </div>
            )}
          </div>
        </div>
      </main>
      
      <div className="h-[env(safe-area-inset-bottom)] w-full bg-[#0f172a] shrink-0"></div>
    </div>
  );
};

/** --- RENDER ROOT --- **/
const rootElement = document.getElementById('root');
if (rootElement) {
  const root = ReactDOM.createRoot(rootElement);
  root.render(<App />);
  
  // Cleanup splash once React renders
  const cleanup = () => {
    const splash = document.getElementById('splash');
    if (splash) {
      splash.style.opacity = '0';
      setTimeout(() => splash.remove(), 500);
    }
  };
  setTimeout(cleanup, 1000);
}
