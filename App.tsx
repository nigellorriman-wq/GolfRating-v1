import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { 
  AppMode, 
  MapProvider, 
  UnitSystem, 
  GeoPoint, 
  TrackingState, 
  MappingState,
  PointType
} from './types';
import { calculateDistance, toDisplayDistance, toDisplayElevation, calculatePolygonArea, getAccuracyColor } from './utils/geoUtils';
import { MapContainer, TileLayer, Marker, Polyline, Circle, useMap, Polygon } from 'react-leaflet';
import * as L from 'leaflet';
import { Ruler, Map as MapIcon, RotateCcw, Loader2 } from 'lucide-react';

const log = (window as any).progolfLog || console.log;

// Setup Leaflet icons properly
const DefaultIcon = L.icon({
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
  iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34], shadowSize: [41, 41]
});
L.Marker.prototype.options.icon = DefaultIcon;

const blueIcon = new L.Icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-blue.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
  iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34], shadowSize: [41, 41]
});

/**
 * Component to handle map centering and dimension recalculation.
 * Using requestAnimationFrame ensures the layout is fully resolved before measuring.
 */
const MapController: React.FC<{ 
  points: GeoPoint[], 
  currentPos: GeoPoint | null, 
  mode: AppMode, 
  isTracking: boolean 
}> = ({ points, currentPos, mode, isTracking }) => {
  const map = useMap();
  
  // Fix the "Map offset/blank area" issue
  useEffect(() => {
    let frameId: number;
    const updateSize = () => {
      map.invalidateSize();
      log("Map: invalidateSize executed via RAF.");
    };
    
    // We do it immediately and then one frame later for total safety
    updateSize();
    frameId = requestAnimationFrame(updateSize);
    
    return () => cancelAnimationFrame(frameId);
  }, [map, mode]);

  useEffect(() => {
    try {
      if (mode === 'Trk') {
        if (isTracking && points.length > 1) {
          const bounds = L.latLngBounds(points.map(p => [p.lat, p.lng]));
          if (currentPos) bounds.extend([currentPos.lat, currentPos.lng]);
          map.fitBounds(bounds, { padding: [40, 40], animate: true });
        } else if (currentPos) {
          map.setView([currentPos.lat, currentPos.lng], 19);
        }
      } else if (mode === 'Grn') {
         if (points.length > 0) {
          const bounds = L.latLngBounds(points.map(p => [p.lat, p.lng]));
          if (currentPos) bounds.extend([currentPos.lat, currentPos.lng]);
          map.fitBounds(bounds, { padding: [30, 30], animate: true });
        } else if (currentPos) {
          map.setView([currentPos.lat, currentPos.lng], 21);
        }
      }
    } catch (e) {
      log("MapController fitting error: " + String(e), 'WARN');
    }
  }, [points, currentPos, mode, isTracking, map]);

  return null;
};

const App: React.FC = () => {
  log("App: Logic starting.");

  const [mode, setMode] = useState<AppMode>('Trk');
  const [mapProvider, setMapProvider] = useState<MapProvider>('OSM');
  const [units, setUnits] = useState<UnitSystem>('Yards');
  const [currentPos, setCurrentPos] = useState<GeoPoint | null>(null);
  const [isGpsInitializing, setIsGpsInitializing] = useState(true);

  const [tracking, setTracking] = useState<TrackingState>({
    isActive: false, startPoint: null, path: [], initialAltitude: null, currentAltitude: null, altSource: 'GPS'
  });

  const [mapping, setMapping] = useState<MappingState>({
    isActive: false, isBunkerActive: false, points: [], isClosed: false
  });

  const watchId = useRef<number | null>(null);
  const lastUpdateRef = useRef<number>(0);

  useEffect(() => {
    log("App: Mounted successfully.");
    const splash = document.getElementById('splash');
    if (splash) {
      splash.style.opacity = '0';
      setTimeout(() => { splash.style.display = 'none'; }, 500);
    }
  }, []);

  const handlePositionUpdate = useCallback((pos: GeolocationPosition) => {
    const now = Date.now();
    if (now - lastUpdateRef.current < 500) return;
    lastUpdateRef.current = now;

    const newPoint: GeoPoint = {
      lat: pos.coords.latitude, 
      lng: pos.coords.longitude, 
      alt: pos.coords.altitude, 
      accuracy: pos.coords.accuracy, 
      timestamp: now
    };

    if (isGpsInitializing) {
      log(`App: GPS ready (${pos.coords.accuracy.toFixed(1)}m accuracy)`);
      setIsGpsInitializing(false);
    }

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
        const dist = calculateDistance(lastPoint, newPoint);
        if (dist >= 0.5) {
          const type: PointType = prev.isBunkerActive ? 'bunker' : 'green';
          return { ...prev, points: [...prev.points, { ...newPoint, type }] };
        }
        return prev;
      });
    }
  }, [tracking.isActive, mapping.isActive, mapping.isClosed, isGpsInitializing]);

  useEffect(() => {
    if (navigator.geolocation) {
      watchId.current = navigator.geolocation.watchPosition(
        handlePositionUpdate, 
        (err) => { log("App: GPS watcher error - " + err.message, 'ERROR'); },
        { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 }
      );
    }
    return () => { 
      if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current);
    };
  }, [handlePositionUpdate]);

  const totalDistance = tracking.isActive && tracking.path.length > 1
    ? calculateDistance(tracking.path[0], tracking.path[tracking.path.length - 1]) : 0;

  const elevationChange = (tracking.currentAltitude ?? 0) - (tracking.initialAltitude ?? 0);

  const mapMetrics = useMemo(() => {
    if (mapping.points.length < 2) return null;
    let totalLen = 0; let bunkerLen = 0;
    for (let i = 0; i < mapping.points.length - 1; i++) {
      const d = calculateDistance(mapping.points[i], mapping.points[i+1]);
      totalLen += d; if (mapping.points[i+1].type === 'bunker') bunkerLen += d;
    }
    if (mapping.isClosed) totalLen += calculateDistance(mapping.points[mapping.points.length - 1], mapping.points[0]);
    const area = calculatePolygonArea(mapping.points);
    const bunkerPct = totalLen > 0 ? Math.round((bunkerLen / totalLen) * 100) : 0;
    return { totalLen, bunkerLen, area, bunkerPct };
  }, [mapping.points, mapping.isClosed]);

  return (
    <div className="flex flex-col h-full w-full bg-slate-900 text-white overflow-hidden relative">
      <div className="h-[env(safe-area-inset-top)] w-full bg-slate-800 shrink-0"></div>

      <header className="p-3 flex items-center justify-between border-b border-slate-700 bg-slate-800/95 z-[1000] shrink-0 shadow-lg">
        <div className="flex items-center gap-2">
          <button onClick={() => setMode('Trk')} className={`px-5 py-2 rounded-xl font-black text-xs transition-all ${mode === 'Trk' ? 'bg-blue-600 shadow-blue-900/40' : 'bg-slate-700 text-slate-400'}`}>TRK</button>
          <button onClick={() => { setMode('Grn'); setTracking(prev => ({ ...prev, isActive: false })); }} className={`px-5 py-2 rounded-xl font-black text-xs transition-all ${mode === 'Grn' ? 'bg-emerald-600 shadow-emerald-900/40' : 'bg-slate-700 text-slate-400'}`}>GRN</button>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setUnits(u => u === 'Meters' ? 'Yards' : 'Meters')} className="px-3 py-2 bg-slate-700 rounded-xl flex items-center gap-1.5 border border-slate-600 text-[10px] font-black uppercase"><Ruler size={12} />{units}</button>
        </div>
      </header>

      <main className="flex-1 relative overflow-hidden flex flex-col bg-slate-900">
        <div className="absolute inset-0 z-0 bg-slate-900">
          <MapContainer center={[0,0]} zoom={3} className="w-full h-full" zoomControl={false} attributionControl={false}>
            <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" maxZoom={20} />
            <MapController points={mode === 'Trk' ? tracking.path : mapping.points} currentPos={currentPos} mode={mode} isTracking={tracking.isActive} />
            {currentPos && (
              <>
                <Marker position={[currentPos.lat, currentPos.lng]} icon={blueIcon} />
                <Circle center={[currentPos.lat, currentPos.lng]} radius={currentPos.accuracy} pathOptions={{ fillColor: getAccuracyColor(currentPos.accuracy), color: 'transparent', fillOpacity: 0.3 }} />
              </>
            )}
            {mode === 'Trk' && tracking.path.length > 1 && <Polyline positions={tracking.path.map(p => [p.lat, p.lng])} color="#ef4444" weight={5} />}
            {mode === 'Grn' && mapping.points.length > 1 && (
              <>
                {mapping.points.map((p, idx) => {
                  if (idx === 0) return null;
                  const prev = mapping.points[idx - 1];
                  return <Polyline key={`seg-${idx}`} positions={[[prev.lat, prev.lng], [p.lat, p.lng]]} color={p.type === 'bunker' ? '#fbbf24' : '#10b981'} weight={6} />;
                })}
                {mapping.isClosed && <Polygon positions={mapping.points.map(p => [p.lat, p.lng])} pathOptions={{ color: '#10b981', weight: 2, fillColor: '#10b981', fillOpacity: 0.2 }} />}
              </>
            )}
          </MapContainer>
        </div>

        <div className="relative h-full w-full pointer-events-none z-10 flex flex-col">
          {isGpsInitializing && (
            <div className="flex-1 flex flex-col items-center justify-center p-8 pointer-events-auto">
              <div className="w-64 bg-slate-900/90 backdrop-blur-xl p-8 rounded-3xl border border-slate-700 shadow-2xl flex flex-col items-center text-center">
                <Loader2 className="animate-spin text-blue-500 mb-6" size={40} />
                <h2 className="text-xl font-black tracking-widest uppercase mb-1">GPS LINK</h2>
                <p className="text-slate-500 text-[10px] uppercase font-bold">Waiting for Lock...</p>
              </div>
            </div>
          )}

          {!isGpsInitializing && (
            <div className="p-4 pointer-events-none">
              {mode === 'Trk' ? (
                <div className="bg-slate-900/95 backdrop-blur-lg p-5 rounded-2xl border border-slate-700 shadow-2xl flex justify-between pointer-events-auto">
                  <div className="text-center flex-1 border-r border-slate-800">
                    <p className="text-[10px] text-slate-500 font-black uppercase mb-1">Distance</p>
                    <p className="text-4xl font-black text-blue-400">{toDisplayDistance(totalDistance, units)}<span className="text-xs ml-1 opacity-60 uppercase">{units === 'Yards' ? 'yd' : 'm'}</span></p>
                  </div>
                  <div className="text-center flex-1">
                    <p className="text-[10px] text-slate-500 font-black uppercase mb-1">Elevation Δ</p>
                    <p className="text-4xl font-black text-amber-400">{toDisplayElevation(elevationChange, units)}<span className="text-xs ml-1 opacity-60 uppercase">{units === 'Yards' ? 'ft' : 'm'}</span></p>
                  </div>
                </div>
              ) : mapMetrics && (
                <div className="bg-slate-900/95 backdrop-blur-lg p-3 rounded-2xl border border-slate-700 shadow-2xl grid grid-cols-2 gap-2 pointer-events-auto">
                  <div className="bg-slate-800/80 p-2.5 rounded-xl border border-slate-700/50 text-center"><p className="text-[9px] text-slate-500 font-bold uppercase mb-0.5">Perimeter</p><p className="text-xl font-black text-emerald-400">{toDisplayDistance(mapMetrics.totalLen, units)}{units === 'Yards' ? 'yd' : 'm'}</p></div>
                  <div className="bg-slate-800/80 p-2.5 rounded-xl border border-slate-700/50 text-center"><p className="text-[9px] text-slate-500 font-bold uppercase mb-0.5">Bunker</p><p className="text-xl font-black text-amber-400">{toDisplayDistance(mapMetrics.bunkerLen, units)}{units === 'Yards' ? 'yd' : 'm'}</p></div>
                  <div className="bg-slate-800/80 p-2.5 rounded-xl border border-slate-700/50 text-center"><p className="text-[9px] text-slate-500 font-bold uppercase mb-0.5">Area</p><p className="text-xl font-black text-blue-400">{(mapMetrics.area * (units === 'Yards' ? 1.196 : 1)).toFixed(0)} <small className="text-[9px] uppercase">{units === 'Yards' ? 'sqyd' : 'm²'}</small></p></div>
                  <div className="bg-slate-800/80 p-2.5 rounded-xl border border-slate-700/50 text-center"><p className="text-[9px] text-slate-500 font-bold uppercase mb-0.5">Bunk Ratio</p><p className="text-xl font-black text-red-400">{mapMetrics.bunkerPct}%</p></div>
                </div>
              )}
            </div>
          )}

          <div className="mt-auto p-4 pb-8 flex justify-center gap-3 pointer-events-auto">
            {!isGpsInitializing && (
              <>
                {mode === 'Trk' ? (
                  <button 
                    onClick={() => setTracking({ isActive: true, startPoint: currentPos, path: currentPos ? [currentPos] : [], initialAltitude: currentPos?.alt || null, currentAltitude: currentPos?.alt || null, altSource: 'GPS' })} 
                    disabled={!currentPos} 
                    className={`px-12 py-5 text-white rounded-3xl font-black shadow-2xl flex items-center gap-4 active:scale-95 transition-all ${currentPos ? 'bg-red-600 shadow-red-900/40' : 'bg-slate-700 opacity-50'}`}
                  >
                    <RotateCcw size={22} className={tracking.isActive ? 'animate-spin' : ''} /> 
                    {tracking.isActive ? 'RESTART' : 'START TRACK'}
                  </button>
                ) : (
                  <div className="flex gap-2 w-full max-w-lg">
                    <button onClick={() => setMapping({ isActive: true, points: currentPos ? [{ ...currentPos, type: 'green' }] : [], isBunkerActive: false, isClosed: false })} className="flex-1 py-5 bg-emerald-600 rounded-2xl font-black text-xs uppercase shadow-xl active:scale-95 transition-transform">New Green</button>
                    <button 
                      onPointerDown={() => setMapping(p => ({ ...p, isBunkerActive: true }))} 
                      onPointerUp={() => setMapping(p => ({ ...p, isBunkerActive: false }))} 
                      className={`flex-1 py-5 rounded-2xl font-black text-xs uppercase shadow-xl border active:scale-95 transition-all ${mapping.isBunkerActive ? 'bg-amber-400 text-black border-amber-200' : 'bg-slate-700 border-slate-600'}`}
                    >Bunker</button>
                    <button onClick={() => setMapping(p => ({ ...p, isClosed: true }))} className="flex-1 py-5 bg-blue-600 rounded-2xl font-black text-xs uppercase shadow-xl active:scale-95 transition-transform">Close</button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </main>
      
      <div className="h-[env(safe-area-inset-bottom)] w-full bg-slate-900 shrink-0"></div>
    </div>
  );
};

export default App;