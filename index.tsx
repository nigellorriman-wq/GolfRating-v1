import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import { MapContainer, TileLayer, CircleMarker, Polyline, Circle, useMap, Polygon } from 'react-leaflet';
import * as L from 'leaflet';
import { Ruler, RotateCcw, AlertTriangle } from 'lucide-react';

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
  const result = Math.abs(area) / 2;
  // Requirement: If green area is less than 1m2, report it as zero.
  return result < 1 ? 0 : result;
};

const getAccuracyColor = (acc: number) => {
  if (acc < 2) return '#10b981';
  if (acc <= 7) return '#f59e0b';
  return '#ef4444';
};

const getElevationSource = (altAcc: number | null) => {
  if (altAcc === null) return "GNSS";
  if (altAcc < 2.5) return "BARO";
  return "GNSS";
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
        const zoom = active ? (mode === 'Trk' ? 19 : 20) : 18;
        map.setView([pos.lat, pos.lng], zoom, { animate: true });
        centeredOnce.current = true;
      }
    }
  }, [pos, active, mode, map]);

  return null;
};

const ConfirmDialogue: React.FC<{ title: string, message: string, onConfirm: () => void, onCancel: () => void }> = ({ title, message, onConfirm, onCancel }) => (
  <div className="fixed inset-0 z-[10000] flex items-center justify-center p-6 bg-black/80 backdrop-blur-md">
    <div className="bg-[#1e293b] w-full max-w-sm rounded-[1.5rem] border border-white/10 p-5 shadow-2xl animate-in fade-in zoom-in-95 duration-200">
      <div className="flex justify-center mb-3">
        <div className="p-2 bg-amber-500/10 rounded-full">
          <AlertTriangle size={32} className="text-amber-500" />
        </div>
      </div>
      <h3 className="text-base font-black text-center mb-1 tracking-tight text-white uppercase">{title}</h3>
      <p className="text-slate-400 text-center text-[10px] mb-5 leading-relaxed">{message}</p>
      <div className="flex flex-col gap-2">
        <button onClick={onConfirm} className="w-full py-2.5 bg-blue-600 rounded-xl font-black text-[10px] tracking-widest uppercase text-white shadow-lg active:scale-95 transition-transform">
          Yes, Proceed
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
  const [showTrkConfirm, setShowTrkConfirm] = useState(false);
  const [showGrnConfirm, setShowGrnConfirm] = useState(false);

  const [trk, setTrk] = useState<TrackingState>({ isActive: false, startPoint: null, initialAltitude: null, currentAltitude: null });
  const [grn, setGrn] = useState<MappingState>({ isActive: false, isBunkerActive: false, points: [], isClosed: false });

  // Use a ref for isBunkerActive to avoid stale closure issues in the watchPosition effect
  const isBunkerActiveRef = useRef(false);
  useEffect(() => {
    isBunkerActiveRef.current = grn.isBunkerActive;
  }, [grn.isBunkerActive]);

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
            // Only add points if moved more than 0.4 meters
            if (!last || calculateDistance(last, pt) >= 0.4) {
              return { 
                ...prev, 
                points: [...prev.points, { ...pt, type: isBunkerActiveRef.current ? 'bunker' : 'green' }] 
              };
            }
            return prev;
          });
        }
      },
      (e) => console.warn("GPS Signal Loss", e),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 }
    );
    return () => navigator.geolocation.clearWatch(watch);
  }, [trk.isActive, grn.isActive, grn.isClosed]);

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
    const area = calculateArea(grn.points);
    return { perimeter, bunkerLen, area, bunkerPct: perimeter > 0 ? Math.round((bunkerLen / perimeter) * 100) : 0 };
  }, [grn.points, grn.isClosed]);

  const closeLoopPossible = useMemo(() => {
    if (!grn.isActive || grn.isClosed || grn.points.length < 3 || !pos) return false;
    const distToStart = calculateDistance(pos, grn.points[0]);
    return distToStart <= 5.0;
  }, [grn.isActive, grn.isClosed, grn.points, pos]);

  const handleNewTrackClick = () => {
    if (trk.startPoint || trk.isActive) setShowTrkConfirm(true);
    else performNewTrack();
  };

  const handleNewGreenClick = () => {
    if (grn.points.length > 0 && !grn.isActive) setShowGrnConfirm(true);
    else if (!grn.isActive) performNewGreen();
  };

  const performNewTrack = () => {
    setTrk({ isActive: true, startPoint: pos, initialAltitude: pos?.alt ?? null, currentAltitude: pos?.alt ?? null });
    setShowTrkConfirm(false);
  };

  const performNewGreen = () => {
    setGrn({ isActive: true, isBunkerActive: false, points: pos ? [{...pos, type:'green'}] : [], isClosed: false });
    setShowGrnConfirm(false);
  };

  const startBunker = useCallback(() => {
    if (grn.isActive && !grn.isClosed) {
      setGrn(p => ({ ...p, isBunkerActive: true }));
    }
  }, [grn.isActive, grn.isClosed]);

  const stopBunker = useCallback(() => {
    setGrn(p => ({ ...p, isBunkerActive: false }));
  }, []);

  return (
    <div className="flex flex-col h-full w-full bg-[#020617] text-white overflow-hidden touch-none absolute inset-0 select-none">
      <div className="h-[env(safe-area-inset-top)] bg-[#0f172a] shrink-0"></div>
      
      {showTrkConfirm && <ConfirmDialogue title="Reset Track?" message="Wipe current distance tracking and start fresh?" onConfirm={performNewTrack} onCancel={() => setShowTrkConfirm(false)} />}
      {showGrnConfirm && <ConfirmDialogue title="New Green?" message="Wipe current green mapping data?" onConfirm={performNewGreen} onCancel={() => setShowGrnConfirm(false)} />}

      <header className="px-3 py-1 flex items-center justify-between border-b border-white/5 bg-[#0f172a]/95 backdrop-blur-xl z-[1000] shrink-0">
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
            <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" maxZoom={22} maxNativeZoom={19} />
            <MapController mode={mode} pos={pos} active={trk.isActive || grn.isActive} />
            {pos && (
              <>
                <Circle center={[pos.lat, pos.lng]} radius={pos.accuracy} pathOptions={{ fillColor: getAccuracyColor(pos.accuracy), fillOpacity: 0.1, weight: 1, color: getAccuracyColor(pos.accuracy), opacity: 0.3 }} />
                <CircleMarker center={[pos.lat, pos.lng]} radius={5} pathOptions={{ color: '#ffffff', fillColor: '#10b981', fillOpacity: 1, weight: 2, stroke: true }} />
              </>
            )}
            {mode === 'Trk' && trk.startPoint && pos && (
              <>
                <CircleMarker center={[trk.startPoint.lat, trk.startPoint.lng]} radius={6} pathOptions={{ color: '#ffffff', fillColor: '#3b82f6', fillOpacity: 1, weight: 2 }} />
                <Polyline positions={[[trk.startPoint.lat, trk.startPoint.lng], [pos.lat, pos.lng]]} color="#ff0000" weight={4} />
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

        <div className="absolute inset-0 z-10 pointer-events-none p-1 flex flex-col justify-between">
          <div className="pointer-events-auto">
            <div className="bg-slate-950/95 backdrop-blur-3xl p-1 rounded-[1.5rem] border border-white/10 shadow-2xl relative flex flex-col items-center">
              {mode === 'Trk' ? (
                <div className="w-full flex items-center justify-around py-1 px-1">
                  <div className="flex flex-col items-center flex-1 overflow-hidden">
                    <div className="flex items-center gap-2 w-full px-2 justify-between">
                       <span className="text-slate-500 text-[9px] font-black uppercase tracking-widest shrink-0">DIST</span>
                       <div className="text-[48px] font-black tabular-nums glow-text leading-none tracking-tighter">
                        {formatDist(currentTrackDist, units)}
                        <span className="text-[12px] ml-1 font-bold opacity-50 uppercase">{units === 'Yards' ? 'yd' : 'm'}</span>
                      </div>
                    </div>
                    <div className="w-full flex justify-between px-2 items-center mt-1">
                      <span className="text-slate-500 text-[8px] font-black uppercase tracking-widest">GNSS</span>
                      <div className="text-[10px] font-black text-slate-400 flex items-center gap-1">
                        <span className={`w-1 h-1 rounded-full ${pos ? getAccuracyColor(pos.accuracy) : 'bg-slate-700'}`}></span>
                        ±{pos ? formatDist(pos.accuracy, units) : '--'}{units === 'Yards' ? 'yd' : 'm'}
                      </div>
                    </div>
                  </div>
                  <div className="h-16 w-[1px] bg-white/10 mx-1"></div>
                  <div className="flex flex-col items-center flex-1 overflow-hidden">
                    <div className="flex items-center gap-2 w-full px-2 justify-between">
                       <span className="text-slate-500 text-[9px] font-black uppercase tracking-widest shrink-0">ELEV</span>
                       <div className="text-[42px] font-black tabular-nums text-amber-400 leading-none tracking-tighter">
                        {trk.isActive ? `${elevDelta >= 0 ? '+' : ''}${formatAlt(elevDelta, units)}` : '0.0'}
                        <span className="text-[12px] ml-1 font-bold opacity-50 uppercase">{units === 'Yards' ? 'ft' : 'm'}</span>
                      </div>
                    </div>
                    <div className="w-full flex justify-between px-2 items-center mt-1">
                      <span className="text-slate-500 text-[8px] font-black uppercase tracking-widest">
                        {getElevationSource(pos?.altAccuracy ?? null)}
                      </span>
                      <div className="text-[10px] font-black text-slate-400 uppercase">
                        ±{pos?.altAccuracy ? formatAlt(pos.altAccuracy, units) : '--'}{units === 'Yards' ? 'ft' : 'm'}
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="w-full px-0.5 py-0.5">
                  {grn.isActive && !grn.isClosed && (
                    <div className="absolute -top-6 left-1/2 -translate-x-1/2 px-4 py-1.5 bg-emerald-600 rounded-full flex items-center gap-2 shadow-lg animate-pulse z-20">
                      <div className="w-2 h-2 bg-white rounded-full"></div>
                      <span className="text-[9px] font-black tracking-[0.2em] uppercase">WALK THE GREEN</span>
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-0.5 w-full">
                    <Stat label="PERIMETER" value={grnStats ? formatDist(grnStats.perimeter, units) : '--'} color="text-emerald-400" unit={units === 'Yards' ? 'yd' : 'm'} />
                    <Stat label="BUNKER LEN" value={grnStats ? formatDist(grnStats.bunkerLen, units) : '--'} color="text-amber-400" unit={units === 'Yards' ? 'yd' : 'm'} />
                    <Stat label="BUNKER %" value={grnStats ? `${grnStats.bunkerPct}` : '--'} color="text-amber-500" unit="%" />
                    <Stat label="GREEN AREA" value={grnStats ? (grnStats.area * (units === 'Yards' ? 1.196 : 1)).toExponential(2) : '--'} color="text-blue-400" unit={units === 'Yards' ? 'Yd²' : 'm²'} />
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="pb-4 pointer-events-auto flex flex-col items-center gap-3 px-3">
            {mode === 'Trk' ? (
              <button onClick={handleNewTrackClick} className="w-full max-w-[180px] h-11 rounded-2xl font-black text-[10px] tracking-[0.2em] uppercase transition-all shadow-xl flex items-center justify-center gap-3 bg-blue-600 shadow-blue-600/20 active:scale-95 border border-white/10 select-none">
                <RotateCcw size={14} className={trk.isActive ? 'animate-spin' : ''} />
                NEW TRACK
              </button>
            ) : (
              <div className="w-full max-w-[360px] flex flex-col gap-2">
                <div className="flex gap-2">
                   <button 
                    onClick={handleNewGreenClick} 
                    className={`flex-1 h-12 rounded-2xl font-black text-[10px] tracking-widest uppercase shadow-lg transition-all border border-white/5 select-none ${grn.isActive && !grn.isClosed ? 'bg-emerald-900 text-emerald-400' : 'bg-emerald-600 text-white active:scale-95'}`}
                   >
                    {grn.isActive && !grn.isClosed ? 'MAPPING...' : 'NEW GREEN'}
                   </button>
                   <button 
                    onClick={() => setGrn(p => ({ ...p, isClosed: true }))} 
                    disabled={!closeLoopPossible} 
                    className="flex-1 h-12 rounded-2xl bg-blue-600 font-black text-[10px] tracking-widest uppercase shadow-lg disabled:opacity-20 disabled:bg-slate-800 disabled:text-slate-500 active:scale-95 transition-all border border-white/5 select-none"
                   >
                    CLOSE LOOP
                   </button>
                </div>
                <button 
                  disabled={!grn.isActive || grn.isClosed}
                  onPointerDown={startBunker} 
                  onPointerUp={stopBunker}
                  onPointerLeave={stopBunker}
                  onPointerCancel={stopBunker}
                  className={`w-full h-14 rounded-2xl font-black text-[12px] tracking-widest uppercase transition-all flex items-center justify-center gap-3 disabled:opacity-20 disabled:bg-slate-800 disabled:text-slate-500 border border-white/5 select-none ${grn.isBunkerActive ? 'bg-red-600 text-white shadow-[0_0_30px_rgba(239,68,68,0.6)]' : 'bg-amber-400 text-slate-900 shadow-lg'}`}
                >
                  {grn.isBunkerActive ? 'RECORDING BUNKER' : 'HOLD FOR BUNKER'}
                </button>
              </div>
            )}
          </div>
        </div>
      </main>

      <div className="h-[env(safe-area-inset-bottom)] bg-[#020617] shrink-0"></div>
    </div>
  );
};

const Stat: React.FC<{ label: string, value: string, color: string, unit: string }> = ({ label, value, color, unit }) => {
  const renderUnit = () => {
    if (unit === 'Yd²') return <span>Yd<sup>2</sup></span>;
    if (unit === 'm²') return <span>m<sup>2</sup></span>;
    return <span>{unit}</span>;
  };

  return (
    <div className="px-2 py-1 flex items-center justify-between gap-1 overflow-hidden border-b border-white/5 last:border-0 bg-white/[0.02] rounded-lg mb-0.5">
      <p className="text-slate-500 text-[8px] font-black uppercase tracking-tighter leading-none shrink-0">{label}</p>
      <div className="flex items-baseline gap-1.5">
        <span className={`text-[40px] font-black ${color} tabular-nums leading-none tracking-tighter -mb-1`}>
          {value}
        </span>
        <span className="text-[11px] opacity-70 font-black text-slate-400 leading-none uppercase">
          {renderUnit()}
        </span>
      </div>
    </div>
  );
};

/** --- BOOTSTRAP --- **/
const container = document.getElementById('root');
if (container) {
  createRoot(container).render(<App />);
}
