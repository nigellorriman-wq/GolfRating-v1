import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { 
  AppMode, 
  UnitSystem, 
  GeoPoint, 
  TrackingState, 
  MappingState
} from './types.ts';
import { 
  calculateDistance, 
  toDisplayDistance, 
  toDisplayElevation, 
  calculatePolygonArea, 
  getAccuracyColor 
} from './utils/geoUtils.ts';
import { MapContainer, TileLayer, Marker, Polyline, Circle, useMap, Polygon } from 'react-leaflet';
import * as L from 'leaflet';
import { Ruler, RotateCcw, Navigation, Target, Activity } from 'lucide-react';

// Leaflet Fixes
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

const MapController: React.FC<{ 
  points: GeoPoint[], 
  currentPos: GeoPoint | null, 
  mode: AppMode, 
  isTracking: boolean 
}> = ({ points, currentPos, mode, isTracking }) => {
  const map = useMap();
  
  useEffect(() => {
    const updateSize = () => map.invalidateSize();
    updateSize();
    const timer = setTimeout(updateSize, 300);
    return () => clearTimeout(timer);
  }, [map, mode]);

  useEffect(() => {
    if (mode === 'Trk') {
      if (isTracking && points.length > 1) {
        const bounds = L.latLngBounds(points.map(p => [p.lat, p.lng]));
        if (currentPos) bounds.extend([currentPos.lat, currentPos.lng]);
        map.fitBounds(bounds, { padding: [50, 50], animate: true });
      } else if (currentPos) {
        map.setView([currentPos.lat, currentPos.lng], 19);
      }
    } else if (mode === 'Grn') {
      if (points.length > 0) {
        const bounds = L.latLngBounds(points.map(p => [p.lat, p.lng]));
        if (currentPos) bounds.extend([currentPos.lat, currentPos.lng]);
        map.fitBounds(bounds, { padding: [40, 40], animate: true });
      } else if (currentPos) {
        map.setView([currentPos.lat, currentPos.lng], 21);
      }
    }
  }, [points, currentPos, mode, isTracking, map]);

  return null;
};

const App: React.FC = () => {
  const [mode, setMode] = useState<AppMode>('Trk');
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

  const handlePositionUpdate = useCallback((pos: GeolocationPosition) => {
    const now = Date.now();
    const newPoint: GeoPoint = {
      lat: pos.coords.latitude, 
      lng: pos.coords.longitude, 
      alt: pos.coords.altitude, 
      accuracy: pos.coords.accuracy, 
      timestamp: now
    };

    if (isGpsInitializing) setIsGpsInitializing(false);
    setCurrentPos(newPoint);

    if (tracking.isActive) {
      setTracking(prev => {
        const lastInPath = prev.path[prev.path.length - 1];
        if (lastInPath && calculateDistance(lastInPath, newPoint) < 0.3) return prev;
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
          return { ...prev, points: [...prev.points, { ...newPoint, type: prev.isBunkerActive ? 'bunker' : 'green' }] };
        }
        return prev;
      });
    }
  }, [tracking.isActive, mapping.isActive, mapping.isClosed, isGpsInitializing]);

  useEffect(() => {
    if (navigator.geolocation) {
      watchId.current = navigator.geolocation.watchPosition(
        handlePositionUpdate, 
        (err) => console.error(err),
        { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 }
      );
    }
    return () => { if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current); };
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
    return { totalLen, bunkerLen, area, bunkerPct: totalLen > 0 ? Math.round((bunkerLen / totalLen) * 100) : 0 };
  }, [mapping.points, mapping.isClosed]);

  const startTrack = () => {
    setTracking({
      isActive: true,
      startPoint: currentPos,
      path: currentPos ? [currentPos] : [],
      initialAltitude: currentPos?.alt || null,
      currentAltitude: currentPos?.alt || null,
      altSource: 'GPS'
    });
  };

  const startMapping = () => {
    setMapping({
      isActive: true,
      points: currentPos ? [{ ...currentPos, type: 'green' }] : [],
      isBunkerActive: false,
      isClosed: false
    });
  };

  return (
    <div className="flex flex-col h-full w-full bg-[#0f172a] text-white overflow-hidden select-none">
      <div className="h-[env(safe-area-inset-top)] w-full bg-[#1e293b] shrink-0"></div>

      <header className="px-4 py-3 flex items-center justify-between border-b border-slate-700/50 bg-[#1e293b]/95 backdrop-blur-xl z-[1000] shrink-0">
        <div className="flex bg-slate-800/80 p-1 rounded-2xl border border-slate-700/50">
          <button onClick={() => setMode('Trk')} className={`px-6 py-2 rounded-xl text-[10px] font-black tracking-widest transition-all ${mode === 'Trk' ? 'bg-blue-600 text-white shadow-lg' : 'text-slate-500 hover:text-slate-300'}`}>TRACK</button>
          <button onClick={() => { setMode('Grn'); setTracking(p => ({ ...p, isActive: false })); }} className={`px-6 py-2 rounded-xl text-[10px] font-black tracking-widest transition-all ${mode === 'Grn' ? 'bg-emerald-600 text-white shadow-lg' : 'text-slate-500 hover:text-slate-300'}`}>GREEN</button>
        </div>
        <button onClick={() => setUnits(u => u === 'Meters' ? 'Yards' : 'Meters')} className="p-2.5 bg-slate-800/80 rounded-xl border border-slate-700/50 active:scale-95 transition-transform">
          <Ruler size={16} className="text-blue-400" />
        </button>
      </header>

      <main className="flex-1 relative flex flex-col bg-slate-950">
        <div className="absolute inset-0 z-0 opacity-80">
          <MapContainer center={[0,0]} zoom={3} className="w-full h-full" zoomControl={false} attributionControl={false}>
            <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" maxZoom={20} />
            <MapController points={mode === 'Trk' ? tracking.path : mapping.points} currentPos={currentPos} mode={mode} isTracking={tracking.isActive} />
            {currentPos && (
              <>
                <Marker position={[currentPos.lat, currentPos.lng]} icon={blueIcon} />
                {/* Fix: use direct style props instead of pathOptions to match the project's react-leaflet version/types */}
                <Circle 
                  center={[currentPos.lat, currentPos.lng]} 
                  radius={currentPos.accuracy} 
                  fillColor={getAccuracyColor(currentPos.accuracy)} 
                  color="transparent" 
                  fillOpacity={0.15} 
                />
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
                {/* Fix: use direct style props instead of pathOptions to match the project's react-leaflet version/types */}
                {mapping.isClosed && (
                  <Polygon 
                    positions={mapping.points.map(p => [p.lat, p.lng])} 
                    color="#10b981" 
                    weight={1} 
                    fillColor="#10b981" 
                    fillOpacity={0.1} 
                  />
                )}
              </>
            )}
          </MapContainer>
        </div>

        <div className="relative h-full w-full pointer-events-none z-10 flex flex-col p-4 justify-between">
          <div className="space-y-4">
            {isGpsInitializing ? (
               <div className="bg-slate-900/90 backdrop-blur-2xl p-6 rounded-[2rem] border border-blue-500/20 shadow-2xl flex flex-col items-center pointer-events-auto max-w-xs mx-auto mt-10">
                 <Activity className="animate-pulse text-blue-500 mb-3" size={32} />
                 <h2 className="text-xs font-black tracking-[0.2em] text-blue-400">GPS SEARCHING</h2>
                 <p className="text-[10px] text-slate-500 font-bold mt-1 uppercase">Link Status: Pending</p>
               </div>
            ) : (
              <div className="bg-[#0f172a]/95 backdrop-blur-2xl p-5 rounded-3xl border border-slate-700/50 shadow-2xl pointer-events-auto">
                {mode === 'Trk' ? (
                  <div className="flex items-center justify-around gap-4">
                    <div className="text-center">
                      <div className="flex items-center justify-center gap-1 text-slate-500 text-[10px] font-black uppercase mb-1 tracking-widest"><Navigation size={10} /> DISTANCE</div>
                      <div className="text-5xl font-black glow-blue tabular-nums">{toDisplayDistance(totalDistance, units)}<span className="text-xs ml-1 font-bold opacity-40 uppercase tracking-tighter">{units === 'Yards' ? 'yd' : 'm'}</span></div>
                    </div>
                    <div className="h-10 w-px bg-slate-800"></div>
                    <div className="text-center">
                      <div className="flex items-center justify-center gap-1 text-slate-500 text-[10px] font-black uppercase mb-1 tracking-widest"><Target size={10} /> ELEVATION</div>
                      <div className="text-4xl font-black glow-amber tabular-nums">
                        {elevationChange >= 0 ? '+' : ''}{toDisplayElevation(elevationChange, units)}
                        <span className="text-xs ml-1 font-bold opacity-40 uppercase tracking-tighter">{units === 'Yards' ? 'ft' : 'm'}</span>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-3">
                    <MetricCard label="Perimeter" value={mapMetrics ? toDisplayDistance(mapMetrics.totalLen, units) : '--'} unit={units === 'Yards' ? 'yd' : 'm'} color="text-emerald-400" />
                    <MetricCard label="Bunker Ratio" value={mapMetrics ? `${mapMetrics.bunkerPct}%` : '--'} unit="" color="text-amber-400" />
                    <MetricCard label="Green Area" value={mapMetrics ? (mapMetrics.area * (units === 'Yards' ? 1.196 : 1)).toFixed(0) : '--'} unit={units === 'Yards' ? 'sqyd' : 'm²'} color="text-blue-400" />
                    <div className="bg-slate-800/40 p-3 rounded-2xl flex items-center justify-center gap-2 border border-slate-700/30">
                       <div className={`w-3 h-3 rounded-full ${currentPos && currentPos.accuracy < 5 ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'}`}></div>
                       <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">GPS LOCK</span>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="pb-12 space-y-4">
            {!isGpsInitializing && (
              <div className="flex flex-col items-center gap-3 pointer-events-auto">
                {mode === 'Trk' ? (
                  <button onClick={startTrack} className="w-full max-w-[280px] py-5 bg-blue-600 hover:bg-blue-500 rounded-[2rem] font-black text-xs tracking-[0.3em] uppercase shadow-[0_20px_40px_-15px_rgba(37,99,235,0.4)] flex items-center justify-center gap-4 active:scale-95 transition-all">
                    <RotateCcw size={18} className={tracking.isActive ? 'animate-spin' : ''} />
                    {tracking.isActive ? 'RESET TRACK' : 'START TRACKING'}
                  </button>
                ) : (
                  <div className="w-full flex flex-col gap-3">
                    <div className="flex gap-2">
                       <button onClick={startMapping} className="flex-1 py-5 bg-emerald-600 rounded-3xl font-black text-[10px] tracking-widest uppercase shadow-xl active:scale-95 transition-all">NEW GREEN</button>
                       <button onClick={() => setMapping(p => ({ ...p, isClosed: true }))} className="flex-1 py-5 bg-blue-600 rounded-3xl font-black text-[10px] tracking-widest uppercase shadow-xl active:scale-95 transition-all">CLOSE LOOP</button>
                    </div>
                    <button 
                      onPointerDown={() => setMapping(p => ({ ...p, isBunkerActive: true }))} 
                      onPointerUp={() => setMapping(p => ({ ...p, isBunkerActive: false }))} 
                      className={`w-full py-5 rounded-3xl font-black text-xs tracking-[0.2em] uppercase transition-all flex items-center justify-center gap-3 ${mapping.isBunkerActive ? 'bg-amber-400 text-black shadow-[0_0_30px_rgba(245,158,11,0.4)]' : 'bg-slate-800 text-slate-400 border border-slate-700'}`}
                    >
                      <div className={`w-2 h-2 rounded-full ${mapping.isBunkerActive ? 'bg-black animate-ping' : 'bg-slate-600'}`}></div>
                      HOLD FOR BUNKER
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </main>
      
      <div className="h-[env(safe-area-inset-bottom)] w-full bg-[#0f172a] shrink-0"></div>
    </div>
  );
};

const MetricCard: React.FC<{ label: string, value: string, unit: string, color: string }> = ({ label, value, unit, color }) => (
  <div className="bg-slate-800/40 p-3 rounded-2xl border border-slate-700/30">
    <p className="text-[9px] text-slate-500 font-black uppercase mb-1 tracking-tighter">{label}</p>
    <p className={`text-xl font-black ${color} tabular-nums leading-none`}>
      {value}<span className="text-[10px] ml-1 opacity-50 lowercase">{unit}</span>
    </p>
  </div>
);

export default App;