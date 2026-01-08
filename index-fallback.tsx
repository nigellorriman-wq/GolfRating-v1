import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import { MapContainer, TileLayer, CircleMarker, Polyline, Circle, useMap, Polygon } from 'react-leaflet';
import * as L from 'leaflet';
import { 
  ChevronLeft,
  Navigation2,
  Layers,
  RotateCcw,
  Target,
  History as HistoryIcon,
  Trash2,
  Zap
} from 'lucide-react';

/** --- TYPES --- **/
type AppView = 'landing' | 'shot' | 'map';
type UnitSystem = 'Yards' | 'Metres';

interface GeoPoint {
  lat: number;
  lng: number;
  alt: number | null;
  accuracy: number;
  timestamp: number;
  type?: 'green' | 'bunker';
}

interface SavedRecord {
  id: string;
  type: 'Shot' | 'Map';
  date: number;
  primaryValue: string;
  secondaryValue?: string;
  points: GeoPoint[];
}

/** --- UTILITIES --- **/
const calculateDistance = (p1: {lat: number, lng: number}, p2: {lat: number, lng: number}): number => {
  const R = 6371e3;
  const φ1 = p1.lat * Math.PI / 180;
  const φ2 = p2.lat * Math.PI / 180;
  const Δφ = (p2.lat - p1.lat) * Math.PI / 180;
  const Δλ = (p2.lng - p1.lng) * Math.PI / 180;
  const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) *
    Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
};

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

const formatDist = (m: number, u: UnitSystem) => (m * (u === 'Metres' ? 1 : 1.09361)).toFixed(1);
const formatAlt = (m: number, u: UnitSystem) => (m * (u === 'Metres' ? 1 : 3.28084)).toFixed(1);

const getAccuracyColor = (acc: number) => {
  if (acc < 3.5) return '#10b981'; 
  if (acc <= 8) return '#f59e0b';
  return '#ef4444';
};

/** --- MAP CONTROLLER --- **/
const MapController: React.FC<{ pos: GeoPoint | null, active: boolean }> = ({ pos, active }) => {
  const map = useMap();
  const centeredOnce = useRef(false);

  useEffect(() => {
    const interval = setInterval(() => map.invalidateSize(), 1000);
    return () => clearInterval(interval);
  }, [map]);

  useEffect(() => {
    if (pos) {
      if (!centeredOnce.current || active) {
        map.setView([pos.lat, pos.lng], 19, { animate: true });
        centeredOnce.current = true;
      }
    }
  }, [pos, active, map]);

  return null;
};

/** --- MAIN APP --- **/
const App: React.FC = () => {
  const [view, setView] = useState<AppView>('landing');
  const [units, setUnits] = useState<UnitSystem>('Yards');
  const [mapStyle, setMapStyle] = useState<'Street' | 'Satellite'>('Satellite');
  const [pos, setPos] = useState<GeoPoint | null>(null);
  const [history, setHistory] = useState<SavedRecord[]>([]);

  // Shot Tracking State
  const [trkActive, setTrkActive] = useState(false);
  const [trkStart, setTrkStart] = useState<GeoPoint | null>(null);

  // Mapping State
  const [mapActive, setMapActive] = useState(false);
  const [mapPoints, setMapPoints] = useState<GeoPoint[]>([]);
  const [isBunker, setIsBunker] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem('golf_pro_caddy_final');
    if (saved) setHistory(JSON.parse(saved));

    if (!navigator.geolocation) return;
    const watch = navigator.geolocation.watchPosition(
      (p) => {
        const pt: GeoPoint = {
          lat: p.coords.latitude, 
          lng: p.coords.longitude, 
          alt: p.coords.altitude, 
          accuracy: p.coords.accuracy, 
          timestamp: Date.now()
        };
        setPos(pt);
      },
      (e) => console.warn("GPS Signal Loss", e),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 }
    );
    return () => navigator.geolocation.clearWatch(watch);
  }, []);

  useEffect(() => {
    if (mapActive && pos) {
      setMapPoints(prev => {
        const last = prev[prev.length - 1];
        if (!last || calculateDistance(last, pos) >= 0.5) {
          return [...prev, { ...pos, type: isBunker ? 'bunker' : 'green' }];
        }
        return prev;
      });
    }
  }, [pos, mapActive, isBunker]);

  const saveRecord = useCallback((record: Omit<SavedRecord, 'id' | 'date'>) => {
    const newRecord: SavedRecord = { ...record, id: Math.random().toString(36).substr(2, 9), date: Date.now() };
    const updated = [newRecord, ...history].slice(0, 10);
    setHistory(updated);
    localStorage.setItem('golf_pro_caddy_final', JSON.stringify(updated));
  }, [history]);

  const deleteHistory = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const updated = history.filter(h => h.id !== id);
    setHistory(updated);
    localStorage.setItem('golf_pro_caddy_final', JSON.stringify(updated));
  };

  const currentShotDist = (trkStart && pos) ? calculateDistance(trkStart, pos) : 0;
  const elevDelta = (pos && trkStart && pos.alt !== null && trkStart.alt !== null) 
    ? (pos.alt - trkStart.alt) 
    : 0;

  const areaMetrics = useMemo(() => {
    if (mapPoints.length < 3) return null;
    let perimeter = 0;
    for (let i = 0; i < mapPoints.length - 1; i++) {
      perimeter += calculateDistance(mapPoints[i], mapPoints[i+1]);
    }
    perimeter += calculateDistance(mapPoints[mapPoints.length-1], mapPoints[0]);
    return { area: calculateArea(mapPoints), perimeter };
  }, [mapPoints]);

  return (
    <div className="flex flex-col h-full w-full bg-[#020617] text-white overflow-hidden touch-none absolute inset-0 select-none">
      <div className="h-[env(safe-area-inset-top)] bg-[#0f172a] shrink-0"></div>

      {view === 'landing' ? (
        <div className="flex-1 flex flex-col p-6 animate-in fade-in duration-500 overflow-y-auto no-scrollbar">
          <header className="mb-10 mt-6 text-center">
            <h1 className="text-4xl font-black tracking-tighter" style={{ color: '#2563EB' }}>Scottish Golf</h1>
            <p className="text-white text-[9px] font-black tracking-[0.4em] uppercase mt-2">Course Rating Toolkit</p>
          </header>

          <div className="flex flex-col gap-4">
            <button 
              onClick={() => setView('shot')}
              className="group relative bg-slate-900 border border-white/5 rounded-[2.5rem] p-10 flex flex-col items-center justify-center text-center overflow-hidden active:scale-95 transition-all shadow-2xl"
            >
              <div className="absolute top-0 right-0 p-8 opacity-5 group-hover:opacity-10 transition-opacity">
                <Navigation2 size={160} />
              </div>
              <div className="w-20 h-20 bg-blue-600 rounded-full flex items-center justify-center mb-6 shadow-xl shadow-blue-600/30">
                <Navigation2 size={32} />
              </div>
              <h2 className="text-2xl font-black mb-2 uppercase italic" style={{ color: '#2563EB' }}>Distance tracker</h2>
              <p className="text-white text-[11px] font-medium max-w-[200px] leading-relaxed">Realtime horizontal distance and elevation change</p>
            </button>

            <button 
              onClick={() => setView('map')}
              className="group relative bg-slate-900 border border-white/5 rounded-[2.5rem] p-10 flex flex-col items-center justify-center text-center overflow-hidden active:scale-95 transition-all shadow-2xl"
            >
              <div className="absolute top-0 right-0 p-8 opacity-5 group-hover:opacity-10 transition-opacity">
                <Target size={160} />
              </div>
              <div className="w-20 h-20 bg-emerald-600 rounded-full flex items-center justify-center mb-6 shadow-xl shadow-emerald-600/30">
                <Target size={32} />
              </div>
              <h2 className="text-2xl font-black mb-2 uppercase italic" style={{ color: '#059669' }}>Green Mapper</h2>
              <p className="text-white text-[11px] font-medium max-w-[200px] leading-relaxed">green area and bunker coverage mapping</p>
            </button>
          </div>

          <footer className="mt-8 pb-4">
            {history.length > 0 && (
              <div className="mb-6">
                <div className="flex items-center gap-2 mb-3 px-2">
                  <HistoryIcon size={14} className="text-slate-600" />
                  <span className="text-[9px] font-black tracking-[0.2em] text-slate-500 uppercase">Recent Stats</span>
                </div>
                <div className="flex gap-3 overflow-x-auto pb-2 no-scrollbar">
                  {history.map(item => (
                    <div key={item.id} className="relative shrink-0">
                      <div className="bg-slate-900/50 border border-white/5 px-5 py-3.5 rounded-2xl flex flex-col min-w-[140px] shadow-sm">
                        <span className="text-[7px] font-black text-slate-500 uppercase mb-1">{item.type}</span>
                        <span className="text-base font-black tabular-nums">{item.primaryValue}</span>
                      </div>
                      <button onClick={(e) => deleteHistory(item.id, e)} className="absolute -top-2 -right-2 w-6 h-6 bg-red-500 rounded-full flex items-center justify-center border-2 border-[#020617] text-white"><Trash2 size={12} /></button>
                    </div>
                  ))}
                </div>
              </div>
            )}
            
            <div className="flex justify-between items-center px-4 py-5 bg-slate-900/50 border border-white/5 rounded-3xl">
              <button 
                onClick={() => setUnits(u => u === 'Yards' ? 'Metres' : 'Yards')} 
                className="text-[10px] font-black text-emerald-400 uppercase tracking-widest bg-emerald-400/10 px-4 py-2 rounded-xl"
              >
                {units}
              </button>
              <div className="flex items-center gap-3">
                 <div className={`w-2 h-2 rounded-full ${pos ? getAccuracyColor(pos.accuracy) : 'bg-red-500 animate-pulse'} shadow-[0_0_10px_rgba(16,185,129,0.5)]`}></div>
                 <span className="text-[10px] font-black text-slate-400 uppercase tracking-tighter">GPS: {pos ? `±${(pos.accuracy * (units === 'Yards' ? 1.09 : 1)).toFixed(1)}${units === 'Yards' ? 'yd' : 'm'}` : 'SEARCHING'}</span>
              </div>
            </div>
          </footer>
        </div>
      ) : (
        <div className="flex-1 flex flex-col relative animate-in slide-in-from-right duration-300">
          <div className="absolute top-0 left-0 right-0 z-[1000] p-4 pointer-events-none">
            <div className="flex justify-between items-start">
              <button 
                onClick={() => { setView('landing'); setTrkActive(false); setMapActive(false); }}
                className="pointer-events-auto bg-[#0f172a]/95 backdrop-blur-xl border border-white/10 px-5 py-3 rounded-full flex items-center gap-3 shadow-2xl active:scale-95 transition-all"
              >
                <ChevronLeft size={20} className="text-emerald-400" />
                <span className="text-[11px] font-black uppercase tracking-[0.2em]">Home</span>
              </button>

              <button 
                onClick={() => setMapStyle(s => s === 'Street' ? 'Satellite' : 'Street')}
                className="pointer-events-auto bg-[#0f172a]/95 backdrop-blur-xl border border-white/10 p-3.5 rounded-full shadow-2xl active:scale-95 transition-all"
              >
                <Layers size={22} className={mapStyle === 'Satellite' ? 'text-blue-400' : 'text-slate-400'} />
              </button>
            </div>
          </div>

          <main className="flex-1">
            <MapContainer center={[0, 0]} zoom={2} className="h-full w-full" zoomControl={false} attributionControl={false}>
              <TileLayer 
                url={mapStyle === 'Street' ? "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" : "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"} 
                maxZoom={22} 
                maxNativeZoom={19} 
              />
              <MapController pos={pos} active={trkActive || mapActive} />
              
              {pos && (
                <>
                  <Circle center={[pos.lat, pos.lng]} radius={pos.accuracy} pathOptions={{ color: getAccuracyColor(pos.accuracy), fillOpacity: 0.1, weight: 1, opacity: 0.2 }} />
                  <CircleMarker center={[pos.lat, pos.lng]} radius={7} pathOptions={{ color: '#fff', fillColor: '#10b981', fillOpacity: 1, weight: 2.5 }} />
                </>
              )}

              {view === 'shot' && trkStart && pos && (
                <>
                  <CircleMarker center={[trkStart.lat, trkStart.lng]} radius={6} pathOptions={{ color: '#fff', fillColor: '#3b82f6', fillOpacity: 1 }} />
                  <Polyline positions={[[trkStart.lat, trkStart.lng], [pos.lat, pos.lng]]} color="#3b82f6" weight={5} dashArray="10, 15" />
                </>
              )}

              {view === 'map' && mapPoints.length > 1 && (
                <>
                  {mapPoints.map((p, i, arr) => {
                    if (i === 0) return null;
                    const prev = arr[i - 1];
                    return <Polyline key={i} positions={[[prev.lat, prev.lng], [p.lat, p.lng]]} color={p.type === 'bunker' ? '#f59e0b' : '#10b981'} weight={p.type === 'bunker' ? 7 : 5} />;
                  })}
                  {mapPoints.length > 2 && !mapActive && <Polygon positions={mapPoints.map(p => [p.lat, p.lng])} fillColor="#10b981" fillOpacity={0.2} weight={0} />}
                </>
              )}
            </MapContainer>
          </main>

          <div className="absolute inset-x-0 bottom-0 z-[1000] p-4 pointer-events-none flex flex-col gap-4 items-center">
            <div className="pointer-events-auto bg-[#0f172a]/95 backdrop-blur-2xl border border-white/10 rounded-[2.5rem] p-6 w-full max-w-sm shadow-2xl">
              {view === 'shot' ? (
                <div className="flex items-center justify-around">
                  <div className="text-center">
                    <span className="text-slate-500 text-[9px] font-black uppercase tracking-widest block mb-1">Hz Distance</span>
                    <div className="text-[52px] font-black text-emerald-400 tabular-nums leading-none tracking-tighter text-glow-emerald">
                      {formatDist(currentShotDist, units)}
                      <span className="text-[12px] ml-1 font-bold opacity-40 uppercase">{units === 'Yards' ? 'yd' : 'm'}</span>
                    </div>
                  </div>
                  <div className="h-12 w-px bg-white/10 mx-2"></div>
                  <div className="text-center">
                    <span className="text-slate-500 text-[9px] font-black uppercase tracking-widest block mb-1">Elev change</span>
                    <div className="text-[32px] font-black text-amber-400 tabular-nums leading-none tracking-tighter">
                      {(elevDelta >= 0 ? '+' : '') + formatAlt(elevDelta, units)}
                      <span className="text-[12px] ml-1 font-bold opacity-40 uppercase">{units === 'Yards' ? 'ft' : 'm'}</span>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-white/[0.03] p-4 rounded-3xl border border-white/5 text-center">
                    <span className="text-slate-500 text-[9px] font-black uppercase block mb-1 tracking-widest">AREA</span>
                    <div className="text-3xl font-black text-emerald-400 tabular-nums">
                      {areaMetrics ? Math.round(areaMetrics.area * (units === 'Yards' ? 1.196 : 1)) : '--'}
                      <span className="text-[10px] ml-1 opacity-50 uppercase">{units === 'Yards' ? 'yd²' : 'm²'}</span>
                    </div>
                  </div>
                  <div className="bg-white/[0.03] p-4 rounded-3xl border border-white/5 text-center">
                    <span className="text-slate-500 text-[9px] font-black uppercase block mb-1 tracking-widest">WALKED</span>
                    <div className="text-3xl font-black text-blue-400 tabular-nums">
                      {areaMetrics ? formatDist(areaMetrics.perimeter, units) : '--'}
                      <span className="text-[10px] ml-1 opacity-50 uppercase">{units === 'Yards' ? 'yd' : 'm'}</span>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="pointer-events-auto flex flex-col gap-3 w-full max-w-sm pb-10">
              {view === 'shot' ? (
                <button 
                  onClick={() => {
                    if (!trkActive) {
                      setTrkActive(true);
                      setTrkStart(pos);
                    } else {
                      saveRecord({
                        type: 'Shot',
                        primaryValue: formatDist(currentShotDist, units) + (units === 'Yards' ? 'yd' : 'm'),
                        secondaryValue: (elevDelta >= 0 ? '+' : '') + formatAlt(elevDelta, units) + (units === 'Yards' ? 'ft' : 'm'),
                        points: [trkStart!, pos!]
                      });
                      setTrkActive(false);
                      setTrkStart(null);
                    }
                  }}
                  className={`flex-1 h-16 rounded-[2.2rem] font-black text-xs tracking-[0.3em] uppercase border border-white/10 shadow-2xl transition-all flex items-center justify-center gap-4 ${trkActive ? 'bg-blue-600 animate-pulse text-white' : 'bg-emerald-600 text-white active:scale-95'}`}
                >
                  <Navigation2 size={24} /> {trkActive ? 'End Tracking' : 'Record Shot'}
                </button>
              ) : (
                <div className="flex flex-col gap-3 w-full">
                  <div className="flex gap-3">
                    <button 
                      onClick={() => {
                        if (!mapActive) {
                          setMapPoints(pos ? [pos] : []);
                          setMapActive(true);
                        } else {
                          if (areaMetrics) {
                            saveRecord({
                              type: 'Map',
                              primaryValue: Math.round(areaMetrics.area * (units === 'Yards' ? 1.196 : 1)) + (units === 'Yards' ? 'yd²' : 'm²'),
                              secondaryValue: formatDist(areaMetrics.perimeter, units) + (units === 'Yards' ? 'yd' : 'm'),
                              points: mapPoints
                            });
                          }
                          setMapActive(false);
                        }
                      }}
                      className={`flex-[2] h-16 rounded-[2.2rem] font-black text-xs tracking-[0.3em] uppercase border border-white/10 transition-all flex items-center justify-center gap-4 ${mapActive ? 'bg-blue-600 text-white' : 'bg-emerald-600 text-white active:scale-95'}`}
                    >
                      {mapActive ? 'End Mapping' : 'Start Feature'}
                    </button>
                    {mapActive && (
                      <button onClick={() => setMapPoints([])} className="w-16 h-16 bg-slate-800 rounded-[2.2rem] flex items-center justify-center border border-white/10 text-slate-400">
                        <RotateCcw size={22} />
                      </button>
                    )}
                  </div>
                  <button 
                    disabled={!mapActive}
                    onPointerDown={() => setIsBunker(true)} 
                    onPointerUp={() => setIsBunker(false)}
                    className={`h-16 rounded-[2.2rem] font-black text-xs tracking-[0.3em] uppercase transition-all disabled:opacity-30 border border-white/5 flex items-center justify-center gap-4 ${isBunker ? 'bg-orange-600 text-white shadow-orange-600/50' : 'bg-orange-400 text-slate-950'}`}
                  >
                    <Zap size={22} /> {isBunker ? 'Bunker Recorded' : 'Hold for Bunker'}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      <div className="h-[env(safe-area-inset-bottom)] bg-[#020617] shrink-0"></div>
      
      <style>{`
        .no-scrollbar::-webkit-scrollbar { display: none; }
        .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
      `}</style>
    </div>
  );
};

const container = document.getElementById('root');
if (container) {
  createRoot(container).render(<App />);
}
