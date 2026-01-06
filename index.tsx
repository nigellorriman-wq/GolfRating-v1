import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import { MapContainer, TileLayer, CircleMarker, Polyline, Circle, useMap, Polygon } from 'react-leaflet';
import * as L from 'leaflet';
import { Ruler, RotateCcw, Trash2, AlertTriangle, Cpu } from 'lucide-react';

/** --- TYPES --- **/
type AppMode = 'Trk' | 'Grn';
type UnitSystem = 'Meters' | 'Yards';
type PointType = 'green' | 'bunker';

interface GeoPoint {
  lat: number;
  lng: number;
  alt: number | null;
  accuracy: number;
  altAccuracy: number | null;
  timestamp: number;
  type?: PointType;
}

interface TrackingState {
  isActive: boolean;
  startPoint: GeoPoint | null;
  initialAltitude: number | null;
  currentAltitude: number | null;
}

interface MappingState {
  isActive: boolean;
  isBunkerActive: boolean;
  points: GeoPoint[];
  isClosed: boolean;
}

/** --- UTILITIES --- **/
const calculateDistance = (p1: GeoPoint, p2: GeoPoint): number => {
  const R = 6371e3;
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

const getAccuracyColor = (acc: number) => {
  if (acc < 2) return '#10b981';
  if (acc <= 5) return '#f59e0b';
  return '#ef4444';
};

/** --- MAP COMPONENTS --- **/
const MapController: React.FC<{ 
  mode: AppMode, 
  pos: GeoPoint | null, 
  active: boolean 
}> = ({ mode, pos, active }) => {
  const map = useMap();
  const centeredOnce = useRef(false);

  useEffect(() => {
    const interval = setInterval(() => map.invalidateSize(), 1000);
    return () => clearInterval(interval);
  }, [map]);

  useEffect(() => {
    if (pos) {
      if (!centeredOnce.current || active) {
        const zoom = active ? (mode === 'Trk' ? 19 : 21) : 18;
        map.setView([pos.lat, pos.lng], zoom, { animate: true });
        centeredOnce.current = true;
      }
    }
  }, [pos, active, mode, map]);

  return null;
};

const ConfirmDialogue: React.FC<{ onConfirm: () => void, onCancel: () => void }> = ({ onConfirm, onCancel }) => (
  <div className="fixed inset-0 z-[10000] flex items-center justify-center p-6 bg-black/80 backdrop-blur-md">
    <div className="bg-[#1e293b] w-full max-w-sm rounded-[1.5rem] border border-white/10 p-5 shadow-2xl animate-in fade-in zoom-in-95 duration-200">
      <div className="flex justify-center mb-3">
        <div className="p-2 bg-amber-500/10 rounded-full">
          <AlertTriangle size={32} className="text-amber-500" />
        </div>
      </div>
      <h3 className="text-base font-black text-center mb-1 tracking-tight text-white uppercase">Reset Tracking?</h3>
      <p className="text-slate-400 text-center text-[10px] mb-5 leading-relaxed">
        Start a new track? Current measurements will be cleared.
      </p>
      <div className="flex flex-col gap-2">
        <button onClick={onConfirm} className="w-full py-2.5 bg-blue-600 rounded-xl font-black text-[10px] tracking-widest uppercase text-white shadow-lg active:scale-95 transition-transform">
          Yes, New Track
        </button>
        <button onClick={onCancel} className="w-full py-2.5 bg-slate-800 rounded-xl font-black text-[10px] tracking-widest uppercase text-slate-400 active:scale-95 transition-transform">
          Cancel
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

  const [trk, setTrk] = useState<TrackingState>({ isActive: false, startPoint: null, initialAltitude: null, currentAltitude: null });
  const [grn, setGrn] = useState<MappingState>({ isActive: false, isBunkerActive: false, points: [], isClosed: false });

  useEffect(() => {
    if (!navigator.geolocation) return;
    const watch = navigator.geolocation.watchPosition(
      (p) => {
        const pt: GeoPoint = {
          lat: p.coords.latitude, 
          lng: p.coords.longitude, 
          alt: p.coords.altitude, 
          accuracy: p.coords.accuracy, 
          altAccuracy: p.coords.altitudeAccuracy,
          timestamp: Date.now()
        };
        setPos(pt);
        if (trk.isActive) {
          setTrk(prev => ({ ...prev, currentAltitude: pt.alt }));
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
      (e) => console.warn("GPS Signal Loss", e),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 }
    );
    return () => navigator.geolocation.clearWatch(watch);
  }, [trk.isActive, grn.isActive, grn.isBunkerActive, grn.isClosed]);

  const currentTrackDist = (trk.startPoint && pos) ? calculateDistance(trk.startPoint, pos) : 0;
  const elevDelta = (trk.currentAltitude !== null && trk.initialAltitude !== null) ? trk.currentAltitude - trk.initialAltitude : 0;
  
  const grnStats = useMemo(() => {
    if (grn.points.length < 2) return null;
    let perimeter = 0; let bunkerLen = 0;
    for (let i = 0; i < grn.points.length - 1; i++) {
      const d = calculateDistance(grn.points[i], grn.points[i + 1]);
      perimeter += d; if (grn.points[i+1].type === 'bunker') bunkerLen += d;
    }
    if (grn.isClosed) perimeter += calculateDistance(grn.points[grn.points.length - 1], grn.points[0]);
    return { perimeter, area: calculateArea(grn.points), bunkerPct: perimeter > 0 ? Math.round((bunkerLen / perimeter) * 100) : 0 };
  }, [grn.points, grn.isClosed]);

  const handleNewTrackClick = () => {
    if (trk.startPoint || trk.isActive) {
      setShowConfirm(true);
    } else {
      performNewTrack();
    }
  };

  const performNewTrack = () => {
    setTrk({ isActive: true, startPoint: pos, initialAltitude: pos?.alt ?? null, currentAltitude: pos?.alt ?? null });
    setShowConfirm(false);
  };

  return (
    <div className="flex flex-col h-full w-full bg-[#020617] text-white overflow-hidden touch-none absolute inset-0">
      <div className="h-[env(safe-area-inset-top)] bg-[#0f172a] shrink-0"></div>
      
      {showConfirm && <ConfirmDialogue onConfirm={performNewTrack} onCancel={() => setShowConfirm(false)} />}

      <header className="px-3 py-1.5 flex items-center justify-between border-b border-white/5 bg-[#0f172a]/95 backdrop-blur-xl z-[1000] shrink-0">
        <div className="flex bg-slate-800/50 p-1 rounded-xl border border-white/5">
          <button onClick={() => setMode('Trk')} className={`px-4 py-1.5 rounded-lg text-[9px] font-black tracking-widest transition-all ${mode === 'Trk' ? 'bg-blue-600 text-white shadow-lg' : 'text-slate-500'}`}>TRACK</button>
          <button onClick={() => setMode('Grn')} className={`px-4 py-1.5 rounded-lg text-[9px] font-black tracking-widest transition-all ${mode === 'Grn' ? 'bg-emerald-600 text-white shadow-lg' : 'text-slate-500'}`}>GREEN</button>
        </div>
        <button onClick={() => setUnits(u => u === 'Meters' ? 'Yards' : 'Meters')} className="p-2 bg-slate-800/80 rounded-lg border border-white/10 active:scale-95 transition-transform">
          <Ruler size={14} className="text-blue-400" />
        </button>
      </header>

      <main className="flex-1 relative overflow-hidden bg-slate-950 flex flex-col">
        <div className="absolute inset-0 z-0 h-full w-full">
          <MapContainer center={[0, 0]} zoom={2} className="h-full w-full" zoomControl={false} attributionControl={false}>
            <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" maxZoom={20} />
            <MapController mode={mode} pos={pos} active={trk.isActive || grn.isActive} />
            {pos && (
              <>
                <Circle center={[pos.lat, pos.lng]} radius={pos.accuracy} pathOptions={{ fillColor: getAccuracyColor(pos.accuracy), fillOpacity: 0.1, weight: 1, color: getAccuracyColor(pos.accuracy), opacity: 0.3 }} />
                <CircleMarker center={[pos.lat, pos.lng]} radius={5} pathOptions={{ color: '#ffffff', fillColor: '#3b82f6', fillOpacity: 1, weight: 2, stroke: true }} />
              </>
            )}
            {mode === 'Trk' && trk.startPoint && pos && (
              <>
                <CircleMarker center={[trk.startPoint.lat, trk.startPoint.lng]} radius={6} pathOptions={{ color: '#ffffff', fillColor: '#3b82f6', fillOpacity: 1, weight: 2 }} />
                <Polyline positions={[[trk.startPoint.lat, trk.startPoint.lng], [pos.lat, pos.lng]]} color="#ff0000" weight={3} dashArray="8, 8" />
              </>
            )}
            {mode === 'Grn' && grn.points.length > 1 && (
              <>
                {grn.points.map((p, i) => {
                  if (i === 0) return null;
                  const prev = grn.points[i - 1];
                  return <Polyline key={i} positions={[[prev.lat, prev.lng], [p.lat, p.lng]]} color={p.type === 'bunker' ? '#f59e0b' : '#10b981'} weight={4} />;
                })}
                {grn.isClosed && <Polygon positions={grn.points.map(p => [p.lat, p.lng])} fillColor="#10b981" fillOpacity={0.15} weight={0} />}
              </>
            )}
          </MapContainer>
        </div>

        <div className="absolute inset-0 z-10 pointer-events-none p-2 flex flex-col justify-between">
          <div className="pointer-events-auto">
            <div className="bg-[#0f172a]/95 backdrop-blur-2xl p-2 rounded-[1.2rem] border border-white/5 shadow-2xl relative flex flex-col items-center">
              {mode === 'Trk' ? (
                <div className="w-full flex items-center justify-around py-1">
                  <div className="text-center flex flex-col items-center">
                    <p className="text-slate-500 text-[8px] font-black uppercase tracking-widest leading-none mb-0.5">DISTANCE</p>
                    <div className="flex items-baseline justify-center gap-1.5 leading-none">
                      <div className="text-4xl font-black tabular-nums glow-text">
                        {formatDist(currentTrackDist, units)}
                        <span className="text-[10px] ml-0.5 font-bold opacity-40 lowercase">{units === 'Yards' ? 'yd' : 'm'}</span>
                      </div>
                      <div className="text-[11px] font-black text-slate-500 tabular-nums">±{pos ? pos.accuracy.toFixed(1) : '--'}</div>
                    </div>
                    <p className="text-[8px] font-black text-slate-400/60 uppercase tracking-tighter mt-1 flex items-center gap-1">
                      <div className={`w-1.5 h-1.5 rounded-full ${pos ? getAccuracyColor(pos.accuracy) : 'bg-slate-700'}`} style={{backgroundColor: pos ? getAccuracyColor(pos.accuracy) : undefined}}></div>
                      GPS / GNSS
                    </p>
                  </div>
                  
                  <div className="h-10 w-[1px] bg-white/5"></div>
                  
                  <div className="text-center flex flex-col items-center">
                    <p className="text-slate-500 text-[8px] font-black uppercase tracking-widest leading-none mb-0.5">ELEVATION</p>
                    <div className="flex items-baseline justify-center gap-1.5 leading-none">
                      <div className="text-3xl font-black tabular-nums text-amber-400">
                        {trk.isActive ? `${elevDelta >= 0 ? '+' : ''}${formatAlt(elevDelta, units)}` : '0.0'}
                        <span className="text-[10px] ml-0.5 font-bold opacity-40 lowercase">{units === 'Yards' ? 'ft' : 'm'}</span>
                      </div>
                      <div className="text-[11px] font-black text-slate-500 tabular-nums">
                        ±{pos?.altAccuracy ? formatAlt(pos.altAccuracy, units) : '--'}
                      </div>
                    </div>
                    <p className="text-[8px] font-black text-slate-400/60 uppercase tracking-tighter mt-1">ALTIMETER</p>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2 w-full">
                  <Stat label="Perimeter" value={grnStats ? formatDist(grnStats.perimeter, units) : '--'} color="text-emerald-400" unit={units === 'Yards' ? 'yd' : 'm'} />
                  <Stat label="Bunker %" value={grnStats ? `${grnStats.bunkerPct}%` : '--'} color="text-amber-400" unit="" />
                  <Stat label="Area" value={grnStats ? (grnStats.area * (units === 'Yards' ? 1.196 : 1)).toFixed(0) : '--'} color="text-blue-400" unit={units === 'Yards' ? 'sqyd' : 'm²'} fullWidth />
                </div>
              )}
            </div>
          </div>

          <div className="pb-2 pointer-events-auto flex flex-col items-center gap-2">
            {mode === 'Trk' ? (
              <button 
                onClick={handleNewTrackClick}
                className="w-full max-w-[140px] h-9 rounded-xl font-black text-[9px] tracking-[0.1em] uppercase transition-all shadow-lg flex items-center justify-center gap-2 bg-blue-600 shadow-blue-600/20 active:scale-95"
              >
                <RotateCcw size={12} className={trk.isActive ? 'animate-spin' : ''} />
                NEW TRACK
              </button>
            ) : (
              <div className="w-full max-w-[300px] flex flex-col gap-1.5">
                <div className="flex gap-1.5">
                   <button onClick={() => setGrn({ isActive: true, isBunkerActive: false, points: pos ? [{...pos, type:'green'}] : [], isClosed: false })} className="flex-1 h-10 rounded-xl bg-emerald-600 font-black text-[9px] tracking-widest uppercase shadow-lg active:scale-95 transition-transform">NEW GREEN</button>
                   <button onClick={() => setGrn(p => ({ ...p, isClosed: true }))} disabled={grn.points.length < 3} className="flex-1 h-10 rounded-xl bg-blue-600 font-black text-[9px] tracking-widest uppercase shadow-lg disabled:opacity-30 active:scale-95 transition-transform">CLOSE LOOP</button>
                </div>
                <div className="flex gap-1.5">
                  <button 
                    onPointerDown={() => setGrn(p => ({ ...p, isBunkerActive: true }))} 
                    onPointerUp={() => setGrn(p => ({ ...p, isBunkerActive: false }))} 
                    className={`flex-[2] h-10 rounded-xl font-black text-[10px] tracking-widest uppercase transition-all flex items-center justify-center gap-2 ${grn.isBunkerActive ? 'bg-amber-400 text-slate-900 shadow-[0_0_15px_rgba(245,158,11,0.4)]' : 'bg-slate-800 text-slate-400'}`}
                  >
                    HOLD FOR BUNKER
                  </button>
                  <button onClick={() => setGrn({ isActive: false, isBunkerActive: false, points: [], isClosed: false })} className="flex-1 h-10 rounded-xl bg-slate-900 border border-white/10 flex items-center justify-center text-slate-500 active:scale-95 transition-transform">
                    <Trash2 size={14} />
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
  <div className={`bg-slate-800/30 p-1.5 rounded-lg border border-white/5 ${fullWidth ? 'col-span-2' : ''}`}>
    <p className="text-slate-500 text-[7px] font-black uppercase tracking-widest mb-0.5">{label}</p>
    <p className={`text-base font-black ${color} tabular-nums leading-none`}>
      {value}<span className="text-[8px] ml-0.5 opacity-50 lowercase font-bold">{unit}</span>
    </p>
  </div>
);

/** --- BOOTSTRAP --- **/
const container = document.getElementById('root');
if (container) {
  createRoot(container).render(<App />);
}
