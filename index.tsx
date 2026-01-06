import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import { MapContainer, TileLayer, CircleMarker, Polyline, Circle, useMap, Polygon } from 'react-leaflet';
import * as L from 'leaflet';
import { Ruler, RotateCcw, Target, Trash2, AlertTriangle } from 'lucide-react';

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

/** --- GEOSPATIAL UTILITIES --- **/
const calculateDistance = (p1: GeoPoint, p2: GeoPoint): number => {
  const R = 6371e3;
  const φ1 = p1.lat * Math.PI / 180;
  const φ2 = p2.lat * Math.PI / 180;
  const Δφ = (p2.lat - p1.lat) * Math.PI / 180;
  const Δλ = (p2.lng - p1.lng) * Math.PI / 180;
  const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ/2) * Math.sin(Δλ/2);
  return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)));
};

const formatDist = (m: number, u: UnitSystem) => (m * (u === 'Meters' ? 1 : 1.09361)).toFixed(1);
const formatAlt = (m: number, u: UnitSystem) => (m * (u === 'Meters' ? 1 : 3.28084)).toFixed(1);

const calculateArea = (points: GeoPoint[]): number => {
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
    area += coords[i].x * coords[j].y - coords[j].x * coords[i].y;
  }
  return Math.abs(area) / 2;
};

// Accuracy Color Thresholds: Green (<2m), Yellow (2m-5m), Red (>5m)
const getAccuracyColor = (acc: number) => {
  if (acc < 2) return '#10b981'; 
  if (acc <= 5) return '#f59e0b';
  return '#ef4444';
};

/** --- MAP COMPONENTS --- **/
const MapView: React.FC<{ mode: AppMode, pos: GeoPoint | null, active: boolean }> = ({ mode, pos, active }) => {
  const map = useMap();
  const centeredOnce = useRef(false);

  // Immediate fix for Leaflet size calculation
  useEffect(() => {
    const interval = setInterval(() => map.invalidateSize(), 500);
    return () => clearInterval(interval);
  }, [map]);

  useEffect(() => {
    if (pos) {
      if (!centeredOnce.current || active) {
        const zoom = active ? (mode === 'Trk' ? 18 : 20) : 18;
        map.setView([pos.lat, pos.lng], zoom, { animate: true });
        centeredOnce.current = true;
      }
    }
  }, [pos, active, mode, map]);

  return null;
};

/** --- MODAL COMPONENT --- **/
const ConfirmModal: React.FC<{ onConfirm: () => void, onCancel: () => void }> = ({ onConfirm, onCancel }) => (
  <div className="fixed inset-0 z-[10000] flex items-center justify-center p-6 bg-slate-950/90 backdrop-blur-xl">
    <div className="bg-[#1e293b] w-full max-w-sm rounded-[2.5rem] border border-white/10 p-8 shadow-2xl animate-in zoom-in-95 duration-200 pointer-events-auto">
      <div className="flex justify-center mb-6">
        <div className="p-4 bg-amber-500/10 rounded-full">
          <AlertTriangle size={48} className="text-amber-500" />
        </div>
      </div>
      <h3 className="text-xl font-black text-center mb-2 tracking-tight">START NEW TRACK?</h3>
      <p className="text-slate-400 text-center text-sm mb-8 leading-relaxed">
        This will clear all current path and elevation data for a fresh start.
      </p>
      <div className="flex flex-col gap-3">
        <button onClick={onConfirm} className="w-full py-4 bg-blue-600 rounded-2xl font-black text-xs tracking-widest uppercase shadow-lg shadow-blue-600/20 active:scale-95 transition-transform">
          YES, NEW TRACK
        </button>
        <button onClick={onCancel} className="w-full py-4 bg-slate-800 rounded-2xl font-black text-xs tracking-widest uppercase text-slate-400 active:scale-95 transition-transform">
          CANCEL
        </button>
      </div>
    </div>
  </div>
);

/** --- MAIN APPLICATION --- **/
const App: React.FC = () => {
  const [mode, setMode] = useState<AppMode>('Trk');
  const [units, setUnits] = useState<UnitSystem>('Yards');
  const [pos, setPos] = useState<GeoPoint | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);

  const [trk, setTrk] = useState<TrackingState>({ isActive: false, path: [], initialAltitude: null, currentAltitude: null });
  const [grn, setGrn] = useState<MappingState>({ isActive: false, isBunkerActive: false, points: [], isClosed: false });

  // Location Watcher
  useEffect(() => {
    if (!navigator.geolocation) return;
    const watch = navigator.geolocation.watchPosition(
      (p) => {
        const pt: GeoPoint = {
          lat: p.coords.latitude, lng: p.coords.longitude, 
          alt: p.coords.altitude, accuracy: p.coords.accuracy, 
          timestamp: Date.now()
        };
        setPos(pt);

        if (trk.isActive) {
          setTrk(prev => {
            const last = prev.path[prev.path.length - 1];
            if (last && calculateDistance(last, pt) < 0.2) return prev;
            return {
              ...prev, 
              path: [...prev.path, pt], 
              currentAltitude: pt.alt,
              initialAltitude: prev.initialAltitude === null ? pt.alt : prev.initialAltitude
            };
          });
        }

        if (grn.isActive && !grn.isClosed) {
          setGrn(prev => {
            const last = prev.points[prev.points.length - 1];
            if (!last || calculateDistance(last, pt) >= 0.4) {
              return { ...prev, points: [...prev.points, { ...pt, type: prev.isBunkerActive ? 'bunker' : 'green' }] };
            }
            return prev;
          });
        }
      },
      (e) => console.warn("GPS Warning", e),
      { enableHighAccuracy: true, maximumAge: 0 }
    );
    return () => navigator.geolocation.clearWatch(watch);
  }, [trk.isActive, grn.isActive, grn.isBunkerActive, grn.isClosed]);

  const totalDist = trk.path.length > 1 ? calculateDistance(trk.path[0], trk.path[trk.path.length-1]) : 0;
  const elevDelta = (trk.currentAltitude !== null && trk.initialAltitude !== null) ? trk.currentAltitude - trk.initialAltitude : 0;
  
  const grnStats = useMemo(() => {
    if (grn.points.length < 2) return null;
    let perimeter = 0; let bunkerLen = 0;
    for (let i=0; i < grn.points.length - 1; i++) {
      const d = calculateDistance(grn.points[i], grn.points[i+1]);
      perimeter += d; if (grn.points[i+1].type === 'bunker') bunkerLen += d;
    }
    if (grn.isClosed) perimeter += calculateDistance(grn.points[grn.points.length-1], grn.points[0]);
    return { 
      perimeter, 
      area: calculateArea(grn.points), 
      bunkerPct: perimeter > 0 ? Math.round((bunkerLen / perimeter) * 100) : 0 
    };
  }, [grn.points, grn.isClosed]);

  const handleNewTrackClick = () => {
    if (trk.isActive || trk.path.length > 0) {
      setShowConfirm(true);
    } else {
      performNewTrack();
    }
  };

  const performNewTrack = () => {
    setTrk({ isActive: true, path: pos ? [pos] : [], initialAltitude: pos?.alt ?? null, currentAltitude: pos?.alt ?? null });
    setShowConfirm(false);
  };

  // Splash Cleanup
  useEffect(() => {
    const splash = document.getElementById('splash');
    if (splash) {
      const timer = setTimeout(() => {
        splash.style.opacity = '0';
        setTimeout(() => splash.remove(), 600);
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, []);

  return (
    <div className="flex flex-col h-full w-full bg-[#020617] text-white overflow-hidden touch-none absolute inset-0">
      <div className="h-[env(safe-area-inset-top)] bg-[#0f172a] shrink-0"></div>
      
      {showConfirm && <ConfirmModal onConfirm={performNewTrack} onCancel={() => setShowConfirm(false)} />}

      {/* HEADER */}
      <header className="px-5 py-3 flex items-center justify-between border-b border-white/5 bg-[#0f172a]/95 backdrop-blur-xl z-[1000] shrink-0">
        <div className="flex bg-slate-800/50 p-1 rounded-2xl border border-white/5">
          <button onClick={() => setMode('Trk')} className={`px-5 py-2 rounded-xl text-[10px] font-black tracking-widest transition-all ${mode === 'Trk' ? 'bg-blue-600 text-white shadow-lg' : 'text-slate-500'}`}>TRACK</button>
          <button onClick={() => setMode('Grn')} className={`px-5 py-2 rounded-xl text-[10px] font-black tracking-widest transition-all ${mode === 'Grn' ? 'bg-emerald-600 text-white shadow-lg' : 'text-slate-500'}`}>GREEN</button>
        </div>
        <button onClick={() => setUnits(u => u === 'Meters' ? 'Yards' : 'Meters')} className="p-2.5 bg-slate-800/80 rounded-xl border border-white/10 active:scale-95">
          <Ruler size={18} className="text-blue-400" />
        </button>
      </header>

      {/* MAP AREA */}
      <main className="flex-1 relative overflow-hidden bg-slate-950 flex flex-col">
        <div className="absolute inset-0 z-0 h-full w-full">
          <MapContainer 
            center={[0,0]} 
            zoom={2} 
            className="h-full w-full" 
            zoomControl={false} 
            attributionControl={false}
            style={{ height: '100%', width: '100%' }}
          >
            <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" maxZoom={20} />
            <MapView mode={mode} pos={pos} active={trk.isActive || grn.isActive} />
            
            {pos && (
              <>
                {/* Accuracy Circle - Always visible when position is determined */}
                <Circle 
                  center={[pos.lat, pos.lng]} 
                  radius={pos.accuracy} 
                  pathOptions={{ 
                    fillColor: getAccuracyColor(pos.accuracy), 
                    fillOpacity: 0.2, 
                    weight: 2, 
                    color: getAccuracyColor(pos.accuracy), 
                    opacity: 0.5 
                  }} 
                />
                <CircleMarker center={[pos.lat, pos.lng]} radius={7} pathOptions={{ color: '#ffffff', fillColor: '#3b82f6', fillOpacity: 1, weight: 2, stroke: true }} />
              </>
            )}

            {trk.path.length > 1 && <Polyline positions={trk.path.map(p => [p.lat, p.lng])} color="#3b82f6" weight={4} dashArray="10,12" />}
            
            {mode === 'Grn' && grn.points.length > 1 && (
              <>
                {grn.points.map((p, i) => {
                  if (i === 0) return null;
                  const prev = grn.points[i-1];
                  return <Polyline key={i} positions={[[prev.lat, prev.lng], [p.lat, p.lng]]} color={p.type === 'bunker' ? '#f59e0b' : '#10b981'} weight={6} />;
                })}
                {grn.isClosed && <Polygon positions={grn.points.map(p => [p.lat, p.lng])} fillColor="#10b981" fillOpacity={0.15} weight={0} />}
              </>
            )}
          </MapContainer>
        </div>

        {/* OVERLAY UI */}
        <div className="absolute inset-0 z-10 pointer-events-none p-5 flex flex-col justify-between">
          <div className="pointer-events-auto">
            <div className="bg-[#0f172a]/95 backdrop-blur-2xl p-6 rounded-[2.5rem] border border-white/5 shadow-2xl relative">
              <div className="absolute top-3 right-6 flex items-center gap-2">
                 <div className={`w-2.5 h-2.5 rounded-full ${pos ? getAccuracyColor(pos.accuracy) === '#10b981' ? 'bg-emerald-500' : getAccuracyColor(pos.accuracy) === '#f59e0b' ? 'bg-amber-500' : 'bg-red-500' : 'bg-slate-700 animate-pulse'}`}></div>
                 <span className="text-[10px] font-black text-slate-400 opacity-80 uppercase tracking-tighter">
                   {pos ? `±${pos.accuracy.toFixed(1)}m` : 'SEARCHING...'}
                 </span>
              </div>

              {mode === 'Trk' ? (
                <div className="flex items-center justify-around py-2">
                  <div className="text-center">
                    <p className="text-slate-500 text-[9px] font-black uppercase tracking-widest mb-1">DISTANCE</p>
                    <div className="text-5xl font-black tabular-nums glow-text">
                      {formatDist(totalDist, units)}
                      <span className="text-[10px] ml-1.5 opacity-40 lowercase font-bold tracking-normal">{units === 'Yards' ? 'yd' : 'm'}</span>
                    </div>
                  </div>
                  <div className="h-10 w-[1px] bg-white/5"></div>
                  <div className="text-center">
                    <p className="text-slate-500 text-[9px] font-black uppercase tracking-widest mb-1">ELEVATION</p>
                    <div className="text-4xl font-black tabular-nums text-amber-400">
                      {trk.isActive || trk.path.length > 0 ? `${elevDelta >= 0 ? '+' : ''}${formatAlt(elevDelta, units)}` : '0.0'}
                      <span className="text-[10px] ml-1 opacity-40 lowercase font-bold tracking-normal">{units === 'Yards' ? 'ft' : 'm'}</span>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-4">
                  <Stat label="Perimeter" value={grnStats ? formatDist(grnStats.perimeter, units) : '--'} color="text-emerald-400" unit={units === 'Yards' ? 'yd' : 'm'} />
                  <Stat label="Bunker %" value={grnStats ? `${grnStats.bunkerPct}%` : '--'} color="text-amber-400" unit="" />
                  <Stat label="Area" value={grnStats ? (grnStats.area * (units === 'Yards' ? 1.196 : 1)).toFixed(0) : '--'} color="text-blue-400" unit={units === 'Yards' ? 'sqyd' : 'm²'} fullWidth />
                </div>
              )}
            </div>
          </div>

          <div className="pb-10 pointer-events-auto flex flex-col items-center gap-4">
            {mode === 'Trk' ? (
              <button 
                onClick={handleNewTrackClick}
                className="w-full max-w-[300px] h-20 rounded-[2.5rem] font-black text-sm tracking-[0.3em] uppercase transition-all shadow-2xl flex items-center justify-center gap-4 bg-blue-600 shadow-blue-600/30 active:scale-95"
              >
                <RotateCcw size={20} className={trk.isActive ? 'animate-spin' : ''} />
                NEW TRACK
              </button>
            ) : (
              <div className="w-full max-w-[340px] flex flex-col gap-3">
                <div className="flex gap-3">
                   <button onClick={() => setGrn({ isActive: true, isBunkerActive: false, points: pos ? [{...pos, type:'green'}] : [], isClosed: false })} className="flex-1 h-16 rounded-3xl bg-emerald-600 font-black text-[10px] tracking-widest uppercase shadow-lg active:scale-95 transition-transform">NEW GREEN</button>
                   <button onClick={() => setGrn(p => ({ ...p, isClosed: true }))} disabled={grn.points.length < 3} className="flex-1 h-16 rounded-3xl bg-blue-600 font-black text-[10px] tracking-widest uppercase shadow-lg disabled:opacity-30 active:scale-95 transition-transform">CLOSE LOOP</button>
                </div>
                <div className="flex gap-3">
                  <button 
                    onPointerDown={() => setGrn(p => ({ ...p, isBunkerActive: true }))} 
                    onPointerUp={() => setGrn(p => ({ ...p, isBunkerActive: false }))} 
                    className={`flex-[2] h-16 rounded-3xl font-black text-[11px] tracking-widest uppercase transition-all flex items-center justify-center gap-3 ${grn.isBunkerActive ? 'bg-amber-400 text-slate-900 shadow-[0_0_40px_rgba(245,158,11,0.5)]' : 'bg-slate-800 text-slate-400'}`}
                  >
                    HOLD FOR BUNKER
                  </button>
                  <button onClick={() => setGrn({ isActive: false, isBunkerActive: false, points: [], isClosed: false })} className="flex-1 h-16 rounded-3xl bg-slate-900 border border-white/10 flex items-center justify-center text-slate-500 active:scale-95 transition-transform">
                    <Trash2 size={20} />
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </main>

      <div className="h-[env(safe-area-inset-bottom)] bg-[#020617] shrink-0"></div>
    </div>
  );
};

const Stat: React.FC<{ label: string, value: string, color: string, unit: string, fullWidth?: boolean }> = ({ label, value, color, unit, fullWidth }) => (
  <div className={`bg-slate-800/30 p-4 rounded-3xl border border-white/5 ${fullWidth ? 'col-span-2' : ''}`}>
    <p className="text-slate-500 text-[8px] font-black uppercase tracking-widest mb-1">{label}</p>
    <p className={`text-2xl font-black ${color} tabular-nums leading-none`}>
      {value}<span className="text-[10px] ml-1 opacity-50 lowercase font-bold">{unit}</span>
    </p>
  </div>
);

/** --- BOOTSTRAP --- **/
const container = document.getElementById('root');
if (container) {
  createRoot(container).render(<App />);
}
