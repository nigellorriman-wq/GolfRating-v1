import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import { MapContainer, TileLayer, CircleMarker, Polyline, Circle, useMap, Polygon } from 'react-leaflet';
import * as L from 'leaflet';
import { Ruler, RotateCcw, AlertTriangle, Info, X, FlaskConical, Trash2, CheckCircle2, Map as MapIcon, Zap } from 'lucide-react';

/** --- TYPES --- **/
type AppMode = 'Trk' | 'Grn';
type UnitSystem = 'Metres' | 'Yards';
type PointType = 'green' | 'bunker';
type MapStyle = 'Street' | 'Satellite';

interface GeoPoint {
  lat: number;
  lng: number;
  alt: number | null;
  accuracy: number;
  altAccuracy: number | null;
  timestamp: number;
  speed?: number | null;
  type?: PointType;
}

interface SavedRecord {
  id: string;
  type: AppMode;
  date: number;
  primaryValue: string;
  secondaryValue?: string;
  points: GeoPoint[];
}

interface TrackingState {
  isActive: boolean;
  startPoint: GeoPoint | null;
  initialAltitude: number | null;
  currentAltitude: number | null;
  currentSpeed: number;
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

const formatDist = (m: number, u: UnitSystem) => (m * (u === 'Metres' ? 1 : 1.09361)).toFixed(1);
const formatAlt = (m: number, u: UnitSystem) => (m * (u === 'Metres' ? 1 : 3.28084)).toFixed(1);
const formatSpeed = (ms: number, u: UnitSystem) => (ms * (u === 'Metres' ? 3.6 : 2.23694)).toFixed(1);

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
  if (acc < 2.5) return '#10b981'; 
  if (acc <= 6) return '#f59e0b';
  return '#ef4444';
};

/** --- MAP COMPONENTS --- **/
const MapController: React.FC<{ 
  mode: AppMode, 
  pos: GeoPoint | null, 
  active: boolean,
  historyPoints: GeoPoint[] | null
}> = ({ mode, pos, active, historyPoints }) => {
  const map = useMap();
  const centeredOnce = useRef(false);

  useEffect(() => {
    const interval = setInterval(() => map.invalidateSize(), 1000);
    return () => clearInterval(interval);
  }, [map]);

  useEffect(() => {
    if (historyPoints && historyPoints.length > 0) {
      const bounds = L.latLngBounds(historyPoints.map(p => [p.lat, p.lng]));
      map.fitBounds(bounds, { padding: [60, 60], animate: true });
      return;
    }

    if (pos) {
      if (!centeredOnce.current || active) {
        const zoom = active ? (mode === 'Trk' ? 19 : 20) : 18;
        map.setView([pos.lat, pos.lng], zoom, { animate: true });
        centeredOnce.current = true;
      }
    }
  }, [pos, active, mode, map, historyPoints]);

  return null;
};

/** --- MAIN APPLICATION --- **/
const App: React.FC = () => {
  const [mode, setMode] = useState<AppMode>('Trk');
  const [units, setUnits] = useState<UnitSystem>('Yards');
  const [mapStyle, setMapStyle] = useState<MapStyle>('Satellite');
  const [pos, setPos] = useState<GeoPoint | null>(null);
  const [showTrkConfirm, setShowTrkConfirm] = useState(false);
  const [showGrnConfirm, setShowGrnConfirm] = useState(false);
  const [showAbout, setShowAbout] = useState(false);
  const [history, setHistory] = useState<SavedRecord[]>([]);
  const [viewingHistoryId, setViewingHistoryId] = useState<string | null>(null);

  const [trk, setTrk] = useState<TrackingState>({ isActive: false, startPoint: null, initialAltitude: null, currentAltitude: null, currentSpeed: 0 });
  const [grn, setGrn] = useState<MappingState>({ isActive: false, isBunkerActive: false, points: [], isClosed: false });

  const isBunkerActiveRef = useRef(false);

  // Load History
  useEffect(() => {
    const saved = localStorage.getItem('golf_history_v2');
    if (saved) setHistory(JSON.parse(saved));
  }, []);

  // Save Record Utility
  const saveToHistory = useCallback((record: Omit<SavedRecord, 'id' | 'date'>) => {
    const newRecord: SavedRecord = {
      ...record,
      id: Math.random().toString(36).substr(2, 9),
      date: Date.now()
    };
    const updated = [newRecord, ...history].slice(0, 8);
    setHistory(updated);
    localStorage.setItem('golf_history_v2', JSON.stringify(updated));
  }, [history]);

  const deleteHistoryItem = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const updated = history.filter(item => item.id !== id);
    setHistory(updated);
    localStorage.setItem('golf_history_v2', JSON.stringify(updated));
    if (viewingHistoryId === id) setViewingHistoryId(null);
  };

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
          timestamp: Date.now(),
          speed: p.coords.speed
        };
        setPos(pt);
        if (trk.isActive) {
          setTrk(prev => ({ ...prev, currentAltitude: pt.alt, currentSpeed: pt.speed || 0 }));
        }
        if (grn.isActive && !grn.isClosed) {
          setGrn(prev => {
            const last = prev.points[prev.points.length - 1];
            // Path smoothing filter: only add points if we've moved significantly
            if (!last || calculateDistance(last, pt) >= 0.5) {
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
    return distToStart <= 6.0;
  }, [grn.isActive, grn.isClosed, grn.points, pos]);

  const performNewTrack = () => {
    setTrk({ isActive: true, startPoint: pos, initialAltitude: pos?.alt ?? null, currentAltitude: pos?.alt ?? null, currentSpeed: 0 });
    setShowTrkConfirm(false);
    setViewingHistoryId(null);
  };

  const performNewGreen = () => {
    setGrn({ isActive: true, isBunkerActive: false, points: pos ? [{...pos, type:'green'}] : [], isClosed: false });
    setShowGrnConfirm(false);
    setViewingHistoryId(null);
  };

  const handleNewTrackClick = () => {
    if (trk.startPoint || trk.isActive) setShowTrkConfirm(true);
    else performNewTrack();
  };

  const handleNewGreenClick = () => {
    if (grn.points.length > 0 && !grn.isActive) setShowGrnConfirm(true);
    else if (!grn.isActive) performNewGreen();
  };

  const finaliseTrack = () => {
    if (trk.startPoint && pos) {
      saveToHistory({
        type: 'Trk',
        primaryValue: formatDist(currentTrackDist, units) + (units === 'Yards' ? 'yd' : 'm'),
        secondaryValue: (elevDelta >= 0 ? '+' : '') + formatAlt(elevDelta, units) + (units === 'Yards' ? 'ft' : 'm'),
        points: [trk.startPoint, pos]
      });
      setTrk({ isActive: false, startPoint: null, initialAltitude: null, currentAltitude: null, currentSpeed: 0 });
    }
  };

  const finaliseGreen = () => {
    if (grnStats) {
      saveToHistory({
        type: 'Grn',
        primaryValue: Math.round(grnStats.area * (units === 'Yards' ? 1.196 : 1)).toString() + (units === 'Yards' ? 'yd²' : 'm²'),
        secondaryValue: `Bunker: ${grnStats.bunkerPct}%`,
        points: grn.points
      });
      setGrn({ isActive: false, isBunkerActive: false, points: [], isClosed: false });
    }
  };

  const selectedHistory = viewingHistoryId ? history.find(h => h.id === viewingHistoryId) : null;

  return (
    <div className="flex flex-col h-full w-full bg-[#020617] text-white overflow-hidden touch-none absolute inset-0 select-none">
      <div className="h-[env(safe-area-inset-top)] bg-[#0f172a] shrink-0"></div>
      
      {showTrkConfirm && <ConfirmDialogue title="Reset Track?" message="Wipe current distance tracking and start fresh?" onConfirm={performNewTrack} onCancel={() => setShowTrkConfirm(false)} />}
      {showGrnConfirm && <ConfirmDialogue title="New Green?" message="Wipe current green mapping data?" onConfirm={performNewGreen} onCancel={() => setShowGrnConfirm(false)} />}
      {showAbout && <AboutModal onClose={() => setShowAbout(false)} />}

      <header className="px-3 py-1.5 flex flex-col border-b border-white/5 bg-[#0f172a]/95 backdrop-blur-xl z-[1000] shrink-0 gap-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="flex bg-slate-800/50 p-1 rounded-xl border border-white/5">
              <button onClick={() => setMode('Trk')} className={`px-4 py-1.5 rounded-lg text-[9px] font-black tracking-widest transition-all ${mode === 'Trk' ? 'bg-blue-600 text-white shadow-lg' : 'text-slate-500'}`}>TRACK</button>
              <button onClick={() => setMode('Grn')} className={`px-4 py-1.5 rounded-lg text-[9px] font-black tracking-widest transition-all ${mode === 'Grn' ? 'bg-emerald-600 text-white shadow-lg' : 'text-slate-500'}`}>GREEN</button>
            </div>
            <button 
              onClick={() => setMapStyle(s => s === 'Street' ? 'Satellite' : 'Street')} 
              className={`p-2 rounded-xl border transition-all ${mapStyle === 'Satellite' ? 'bg-indigo-600 border-indigo-400' : 'bg-slate-800 border-white/10'}`}
            >
              <MapIcon size={16} className={mapStyle === 'Satellite' ? 'text-white' : 'text-slate-400'} />
            </button>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setShowAbout(true)} className="p-2 bg-slate-800/80 rounded-xl border border-white/10 active:scale-95">
              <Info size={16} className="text-blue-400" />
            </button>
            <button onClick={() => setUnits(u => u === 'Metres' ? 'Yards' : 'Metres')} className="px-3 py-1.5 bg-slate-800/80 rounded-xl border border-white/10 text-[10px] font-black text-blue-400 tracking-widest uppercase">
              {units}
            </button>
          </div>
        </div>

        {history.length > 0 && (
          <div className="flex items-center gap-2 overflow-x-auto custom-scrollbar py-1">
             {history.map((record) => (
               <div key={record.id} className="relative group shrink-0">
                 <button 
                  onClick={() => setViewingHistoryId(record.id === viewingHistoryId ? null : record.id)}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border transition-all ${viewingHistoryId === record.id ? 'bg-blue-600 border-blue-400' : 'bg-slate-800/50 border-white/5'}`}
                 >
                   <span className={`text-[7px] font-black uppercase tracking-widest ${viewingHistoryId === record.id ? 'text-white' : (record.type === 'Trk' ? 'text-blue-400' : 'text-emerald-400')}`}>
                    {record.type}
                   </span>
                   <span className="text-[10px] font-black tabular-nums">{record.primaryValue}</span>
                 </button>
                 <button 
                  onClick={(e) => deleteHistoryItem(record.id, e)}
                  className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full flex items-center justify-center text-white border border-[#020617] opacity-0 group-hover:opacity-100 transition-opacity"
                 >
                   <X size={10} strokeWidth={4} />
                 </button>
               </div>
             ))}
          </div>
        )}
      </header>

      <main className="flex-1 relative overflow-hidden bg-slate-950 flex flex-col">
        <div className="absolute inset-0 z-0 h-full w-full">
          <MapContainer center={[0, 0]} zoom={2} className="h-full w-full" zoomControl={false} attributionControl={false}>
            {mapStyle === 'Street' ? (
              <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" maxZoom={22} maxNativeZoom={19} />
            ) : (
              <TileLayer url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}" maxZoom={22} maxNativeZoom={19} />
            )}
            <MapController mode={mode} pos={pos} active={trk.isActive || grn.isActive} historyPoints={selectedHistory?.points ?? null} />
            
            {pos && (
              <>
                <Circle center={[pos.lat, pos.lng]} radius={pos.accuracy} pathOptions={{ fillColor: getAccuracyColor(pos.accuracy), fillOpacity: 0.1, weight: 1, color: getAccuracyColor(pos.accuracy), opacity: 0.3 }} />
                <CircleMarker center={[pos.lat, pos.lng]} radius={6} pathOptions={{ color: '#ffffff', fillColor: '#10b981', fillOpacity: 1, weight: 2, stroke: true }} />
              </>
            )}

            {/* Tracking Mode Visuals */}
            {(mode === 'Trk' || (selectedHistory?.type === 'Trk')) && (
              <>
                {trk.startPoint && pos && (
                  <>
                    <CircleMarker center={[trk.startPoint.lat, trk.startPoint.lng]} radius={6} pathOptions={{ color: '#ffffff', fillColor: '#3b82f6', fillOpacity: 1, weight: 2 }} />
                    <Polyline positions={[[trk.startPoint.lat, trk.startPoint.lng], [pos.lat, pos.lng]]} color="#3b82f6" weight={4} dashArray="8,10" />
                  </>
                )}
                {selectedHistory?.type === 'Trk' && (
                   <>
                    <CircleMarker center={[selectedHistory.points[0].lat, selectedHistory.points[0].lng]} radius={6} pathOptions={{ color: '#ffffff', fillColor: '#3b82f6', fillOpacity: 1, weight: 2 }} />
                    <Polyline positions={selectedHistory.points.map(p => [p.lat, p.lng])} color="#3b82f6" weight={5} />
                   </>
                )}
              </>
            )}

            {/* Green Mode Visuals */}
            {(mode === 'Grn' || (selectedHistory?.type === 'Grn')) && (
              <>
                {(grn.points.length > 1 || selectedHistory?.type === 'Grn') && (
                  <>
                    {(selectedHistory?.points || grn.points).map((p, i, arr) => {
                      if (i === 0) return null;
                      const prev = arr[i - 1];
                      const isBunker = p.type === 'bunker';
                      return (
                        <Polyline 
                          key={i} 
                          positions={[[prev.lat, prev.lng], [p.lat, p.lng]]} 
                          pathOptions={{
                            color: isBunker ? '#f59e0b' : '#10b981',
                            weight: isBunker ? 6 : 4,
                            className: isBunker ? 'bunker-glow' : ''
                          }}
                        />
                      );
                    })}
                    {(grn.isClosed || selectedHistory?.type === 'Grn') && <Polygon positions={(selectedHistory?.points || grn.points).map(p => [p.lat, p.lng])} fillColor="#10b981" fillOpacity={0.2} weight={0} />}
                  </>
                )}
              </>
            )}
          </MapContainer>
        </div>

        {/* Floating HUD Panels */}
        <div className="absolute inset-0 z-10 pointer-events-none p-3 flex flex-col justify-between">
          <div>
            <div className="bg-slate-950/70 backdrop-blur-2xl p-2 rounded-[2.5rem] border border-white/10 shadow-[0_20px_50px_rgba(0,0,0,0.5)] relative flex flex-col items-center">
              {mode === 'Trk' ? (
                <div className="w-full">
                  <div className="flex items-center justify-around py-2">
                    <div className="flex flex-col items-center flex-1">
                      <span className="text-slate-500 text-[8px] font-black uppercase tracking-widest mb-1 opacity-70">Distance</span>
                      <div className="text-[52px] font-black tabular-nums glow-text leading-none tracking-tighter text-blue-400">
                        {viewingHistoryId && selectedHistory?.type === 'Trk' ? selectedHistory.primaryValue : formatDist(currentTrackDist, units)}
                        <span className="text-[10px] ml-1 font-bold opacity-50 uppercase text-slate-300">{units === 'Yards' ? 'yd' : 'm'}</span>
                      </div>
                    </div>
                    <div className="h-12 w-[1px] bg-white/10 mx-2"></div>
                    <div className="flex flex-col items-center flex-1">
                      <span className="text-slate-500 text-[8px] font-black uppercase tracking-widest mb-1 opacity-70">Elevation</span>
                      <div className="text-[36px] font-black tabular-nums text-amber-400 leading-none tracking-tighter">
                        {viewingHistoryId && selectedHistory?.type === 'Trk' ? selectedHistory.secondaryValue : `${trk.isActive ? (elevDelta >= 0 ? '+' : '') : ''}${formatAlt(elevDelta, units)}`}
                        <span className="text-[10px] ml-1 font-bold opacity-50 uppercase text-slate-300">{units === 'Yards' ? 'ft' : 'm'}</span>
                      </div>
                    </div>
                  </div>
                  {trk.isActive && (
                    <div className="flex items-center justify-center gap-4 py-1.5 border-t border-white/5 bg-white/[0.02] rounded-b-[2rem]">
                      <div className="flex items-center gap-1.5">
                        <Zap size={10} className="text-emerald-400" />
                        <span className="text-[10px] font-black tabular-nums text-emerald-400">
                          {formatSpeed(trk.currentSpeed, units)}
                          <span className="text-[8px] ml-0.5 opacity-60 uppercase">{units === 'Yards' ? 'mph' : 'kmh'}</span>
                        </span>
                      </div>
                      <div className="h-2 w-[1px] bg-white/10"></div>
                      <span className="text-[8px] font-black text-slate-500 uppercase tracking-widest">Walk Pace</span>
                    </div>
                  )}
                </div>
              ) : (
                <div className="w-full p-1.5 grid grid-cols-2 gap-1.5">
                  <ExpStat label="PERIMETER" value={selectedHistory?.type === 'Grn' ? '--' : (grnStats ? formatDist(grnStats.perimeter, units) : '--')} color="text-emerald-400" unit={units === 'Yards' ? 'yd' : 'm'} />
                  <ExpStat label="BUNKER %" value={selectedHistory?.type === 'Grn' ? selectedHistory.secondaryValue?.split(':')[1].trim() ?? '--' : (grnStats ? `${grnStats.bunkerPct}%` : '--')} color="text-amber-500" unit="" />
                  <div className="col-span-2 bg-indigo-600/10 rounded-2xl p-3 flex items-center justify-between border border-indigo-500/20">
                     <div className="flex flex-col">
                        <span className="text-slate-500 text-[8px] font-black uppercase tracking-widest opacity-70 mb-1">Surface Area</span>
                        <div className="flex items-baseline gap-1.5">
                          <span className="text-[36px] font-black text-blue-400 tabular-nums leading-none tracking-tighter">
                            {selectedHistory?.type === 'Grn' ? selectedHistory.primaryValue : (grnStats ? Math.round(grnStats.area * (units === 'Yards' ? 1.196 : 1)) : '0')}
                          </span>
                          <span className="text-[10px] font-black text-slate-500 uppercase">{units === 'Yards' ? 'yd²' : 'm²'}</span>
                        </div>
                     </div>
                     <div className="w-10 h-10 bg-indigo-500/10 rounded-full flex items-center justify-center border border-indigo-500/20">
                        <Ruler size={16} className="text-indigo-400" />
                     </div>
                  </div>
                </div>
              )}
            </div>
            
            {/* Multi-Signal Health Panel */}
            <div className="mt-3 flex justify-center gap-2">
              <div className="px-3 py-1.5 bg-slate-950/80 backdrop-blur-xl rounded-full border border-white/10 flex items-center gap-3">
                <div className="flex items-center gap-1.5">
                  <div className={`w-1.5 h-1.5 rounded-full ${pos ? getAccuracyColor(pos.accuracy) : 'bg-slate-700'} animate-pulse`}></div>
                  <span className="text-[8px] font-black text-slate-400 tracking-widest uppercase">HORIZ ±{pos ? formatDist(pos.accuracy, units) : '--'}{units === 'Yards' ? 'yd' : 'm'}</span>
                </div>
                <div className="h-2 w-[1px] bg-white/10"></div>
                <div className="flex items-center gap-1.5">
                  <span className="text-[8px] font-black text-slate-500 tracking-widest uppercase">VERT ±{pos?.altAccuracy ? formatAlt(pos.altAccuracy, units) : '--'}{units === 'Yards' ? 'ft' : 'm'}</span>
                </div>
              </div>
            </div>
          </div>

          <div className="pb-6 pointer-events-auto flex flex-col items-center gap-3 px-3">
            {mode === 'Trk' ? (
              <div className="flex gap-2 w-full max-w-[340px]">
                <button onClick={handleNewTrackClick} className="flex-1 h-14 bg-blue-600 rounded-3xl font-black text-[10px] tracking-[0.2em] uppercase shadow-2xl shadow-blue-600/30 active:scale-95 transition-all border border-white/10 flex items-center justify-center gap-2">
                  <RotateCcw size={16} /> NEW TRACK
                </button>
                {trk.isActive && (
                  <button onClick={finaliseTrack} className="flex-1 h-14 bg-emerald-600 rounded-3xl font-black text-[10px] tracking-[0.2em] uppercase shadow-2xl shadow-emerald-600/30 active:scale-95 transition-all border border-white/10 flex items-center justify-center gap-2">
                    <CheckCircle2 size={16} /> FINISH
                  </button>
                )}
              </div>
            ) : (
              <div className="w-full max-w-[380px] flex flex-col gap-2">
                <div className="flex gap-2">
                   <button onClick={handleNewGreenClick} className={`flex-[1.5] h-14 rounded-3xl font-black text-[10px] tracking-widest uppercase shadow-lg transition-all border border-white/5 ${grn.isActive && !grn.isClosed ? 'bg-emerald-900 text-emerald-400' : 'bg-emerald-600 text-white active:scale-95'}`}>
                    {grn.isActive && !grn.isClosed ? 'MAPPING...' : 'NEW GREEN'}
                   </button>
                   <button onClick={() => setGrn(p => ({ ...p, isClosed: true }))} disabled={!closeLoopPossible} className="flex-1 h-14 rounded-3xl bg-blue-600 font-black text-[10px] tracking-widest uppercase shadow-lg disabled:opacity-20 disabled:bg-slate-800 transition-all border border-white/5">
                    CLOSE LOOP
                   </button>
                   {grn.isClosed && (
                    <button onClick={finaliseGreen} className="p-4 bg-emerald-500 rounded-3xl text-white active:scale-95 transition-all border border-white/10">
                      <CheckCircle2 size={24} />
                    </button>
                   )}
                </div>
                <button 
                  disabled={!grn.isActive || grn.isClosed}
                  onPointerDown={() => { isBunkerActiveRef.current = true; setGrn(p => ({ ...p, isBunkerActive: true })) }} 
                  onPointerUp={() => { isBunkerActiveRef.current = false; setGrn(p => ({ ...p, isBunkerActive: false })) }}
                  onPointerLeave={() => { isBunkerActiveRef.current = false; setGrn(p => ({ ...p, isBunkerActive: false })) }}
                  className={`w-full h-16 rounded-[2rem] font-black text-[12px] tracking-widest uppercase transition-all flex items-center justify-center gap-3 disabled:opacity-20 disabled:bg-slate-800 border border-white/5 ${grn.isBunkerActive ? 'bg-red-600 text-white shadow-[0_0_50px_rgba(239,68,68,0.9)] border-red-400' : 'bg-amber-400 text-slate-900 shadow-xl'}`}
                >
                  {grn.isBunkerActive ? 'RECORDING BUNKER...' : 'HOLD FOR BUNKER'}
                </button>
              </div>
            )}
          </div>
        </div>
      </main>

      <div className="h-[env(safe-area-inset-bottom)] bg-[#020617] shrink-0"></div>
      
      <style>{`
        .bunker-glow {
          filter: drop-shadow(0 0 4px #f59e0b);
        }
      `}</style>
    </div>
  );
};

const ExpStat: React.FC<{ label: string, value: string, color: string, unit: string }> = ({ label, value, color, unit }) => (
  <div className="bg-white/[0.04] rounded-2xl p-2.5 border border-white/5 flex flex-col items-center">
    <p className="text-slate-500 text-[7px] font-black uppercase tracking-widest opacity-60 mb-0.5">{label}</p>
    <div className="flex items-baseline gap-1">
      <span className={`text-[26px] font-black ${color} tabular-nums leading-none tracking-tighter`}>{value}</span>
      <span className="text-[8px] font-bold text-slate-500 uppercase">{unit}</span>
    </div>
  </div>
);

const AboutModal: React.FC<{ onClose: () => void }> = ({ onClose }) => (
  <div className="fixed inset-0 z-[10001] flex items-center justify-center p-6 bg-black/80 backdrop-blur-md">
    <div className="bg-[#1e293b] w-full max-w-sm rounded-[2.5rem] border border-white/10 shadow-2xl animate-in fade-in zoom-in-95 duration-200 flex flex-col max-h-[85vh]">
      <div className="p-6 border-b border-white/5 flex items-center justify-between">
        <h3 className="text-sm font-black tracking-[0.2em] uppercase text-white">V2.0 Experimental</h3>
        <button onClick={onClose} className="p-2 hover:bg-white/5 rounded-full transition-colors"><X size={20} className="text-slate-400" /></button>
      </div>
      <div className="p-6 overflow-y-auto custom-scrollbar space-y-6">
        <section className="bg-indigo-500/10 p-4 rounded-3xl border border-indigo-500/20">
          <div className="flex items-center gap-2 mb-2">
            <MapIcon size={14} className="text-indigo-400" />
            <h4 className="text-[10px] font-black text-indigo-400 uppercase tracking-widest">Satellite Imaging</h4>
          </div>
          <p className="text-slate-400 text-[11px] leading-relaxed">Toggle satellite view in the header to see bunkers and green features clearly. Best for mapping accuracy.</p>
        </section>
        <section>
          <div className="flex items-center gap-2 mb-2">
            <Zap size={14} className="text-emerald-400" />
            <h4 className="text-[10px] font-black text-emerald-400 uppercase tracking-widest">Shot Pacing</h4>
          </div>
          <p className="text-slate-400 text-[11px] leading-relaxed">Watch your walking speed during an active track to ensure the GPS is responding to your movement.</p>
        </section>
        <section>
          <div className="flex items-center gap-2 mb-2">
            <Trash2 size={14} className="text-red-400" />
            <h4 className="text-[10px] font-black text-red-400 uppercase tracking-widest">History Deletion</h4>
          </div>
          <p className="text-slate-400 text-[11px] leading-relaxed">Hover over a history record to reveal the delete button. You can now prune individual session data.</p>
        </section>
      </div>
    </div>
  </div>
);

const ConfirmDialogue: React.FC<{ title: string, message: string, onConfirm: () => void, onCancel: () => void }> = ({ title, message, onConfirm, onCancel }) => (
  <div className="fixed inset-0 z-[10000] flex items-center justify-center p-6 bg-black/80 backdrop-blur-md">
    <div className="bg-[#1e293b] w-full max-w-sm rounded-[2.5rem] border border-white/10 p-6 shadow-2xl animate-in fade-in zoom-in-95 duration-200 text-center">
      <div className="w-12 h-12 bg-amber-500/10 rounded-full flex items-center justify-center mx-auto mb-4 border border-amber-500/20">
        <AlertTriangle size={24} className="text-amber-500" />
      </div>
      <h3 className="text-base font-black mb-1 tracking-tight text-white uppercase">{title}</h3>
      <p className="text-slate-400 text-[10px] mb-6 leading-relaxed">{message}</p>
      <div className="flex gap-3">
        <button onClick={onConfirm} className="flex-1 py-3 bg-blue-600 rounded-xl font-black text-[10px] tracking-widest uppercase text-white active:scale-95 transition-all">Proceed</button>
        <button onClick={onCancel} className="flex-1 py-3 bg-slate-800 rounded-xl font-black text-[10px] tracking-widest uppercase text-slate-400 active:scale-95 transition-all">Cancel</button>
      </div>
    </div>
  </div>
);

const container = document.getElementById('root');
if (container) {
  createRoot(container).render(<App />);
}
