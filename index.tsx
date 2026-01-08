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
  AlertCircle,
  Ruler,
  Eye
} from 'lucide-react';

/** --- TYPES --- **/
type AppView = 'landing' | 'track' | 'green';
type UnitSystem = 'Yards' | 'Metres';

interface GeoPoint {
  lat: number;
  lng: number;
  alt: number | null;
  accuracy: number;
  altAccuracy: number | null;
  timestamp: number;
  type?: 'green' | 'bunker';
}

interface SavedRecord {
  id: string;
  type: 'Track' | 'Green';
  date: number;
  primaryValue: string;
  secondaryValue?: string;
  points: GeoPoint[];
}

/** --- UTILITIES --- **/
const calculateDistance = (p1: {lat: number, lng: number}, p2: {lat: number, lng: number}): number => {
  const R = 6371e3;
  const lat1 = p1.lat * Math.PI / 180;
  const lat2 = p2.lat * Math.PI / 180;
  const Δφ = (p2.lat - p1.lat) * Math.PI / 180;
  const Δλ = (p2.lng - p1.lng) * Math.PI / 180;
  const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(lat1) * Math.cos(lat2) *
    Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
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

/** --- COMPONENTS --- **/

const FitText: React.FC<{ children: React.ReactNode; className?: string; maxFontSize: number }> = ({ children, className, maxFontSize }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const [fontSize, setFontSize] = useState(maxFontSize);

  const adjustSize = useCallback(() => {
    if (!containerRef.current || !textRef.current) return;
    
    let currentSize = maxFontSize;
    textRef.current.style.fontSize = `${currentSize}px`;
    
    const maxWidth = containerRef.current.clientWidth;
    while (textRef.current.scrollWidth > maxWidth && currentSize > 8) {
      currentSize -= 1;
      textRef.current.style.fontSize = `${currentSize}px`;
    }
    setFontSize(currentSize);
  }, [maxFontSize, children]);

  useEffect(() => {
    adjustSize();
    window.addEventListener('resize', adjustSize);
    return () => window.removeEventListener('resize', adjustSize);
  }, [adjustSize]);

  return (
    <div ref={containerRef} className="w-full flex justify-center items-center overflow-hidden">
      <div 
        ref={textRef} 
        className={className} 
        style={{ fontSize: `${fontSize}px`, whiteSpace: 'nowrap' }}
      >
        {children}
      </div>
    </div>
  );
};

const MapController: React.FC<{ 
  pos: GeoPoint | null, 
  active: boolean, 
  mapPoints: GeoPoint[], 
  completed: boolean,
  viewingRecord: SavedRecord | null
}> = ({ pos, active, mapPoints, completed, viewingRecord }) => {
  const map = useMap();
  const centeredOnce = useRef(false);
  const fittedCompleted = useRef(false);

  useEffect(() => {
    const interval = setInterval(() => map.invalidateSize(), 1000);
    return () => clearInterval(interval);
  }, [map]);

  useEffect(() => {
    if (active) {
      fittedCompleted.current = false;
    }
  }, [active]);

  useEffect(() => {
    if (viewingRecord && viewingRecord.points.length > 0) {
      const bounds = L.latLngBounds(viewingRecord.points.map(p => [p.lat, p.lng]));
      map.fitBounds(bounds, { padding: [50, 50], animate: true });
      return;
    }

    if (completed && mapPoints.length > 2) {
      if (!fittedCompleted.current) {
        const bounds = L.latLngBounds(mapPoints.map(p => [p.lat, p.lng]));
        map.fitBounds(bounds, { padding: [50, 50], animate: true });
        fittedCompleted.current = true;
      }
      return; 
    }

    if (pos && active && !completed) {
      map.setView([pos.lat, pos.lng], 19, { animate: true });
      centeredOnce.current = true;
    } else if (pos && !centeredOnce.current && !completed) {
      map.setView([pos.lat, pos.lng], 19, { animate: true });
      centeredOnce.current = true;
    }
  }, [pos, active, map, completed, mapPoints, viewingRecord]);

  return null;
};

const ConfirmDialogue: React.FC<{ 
  title: string, 
  message: string, 
  onConfirm: () => void, 
  onCancel: () => void,
  confirmLabel?: string
}> = ({ title, message, onConfirm, onCancel, confirmLabel = "Confirm" }) => (
  <div className="fixed inset-0 z-[2000] flex items-center justify-center p-6 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
    <div className="bg-[#0f172a] w-full max-w-xs rounded-[2rem] border border-white/10 p-6 shadow-2xl animate-in zoom-in-95 duration-200 text-center">
      <div className="w-12 h-12 bg-amber-500/10 rounded-full flex items-center justify-center mx-auto mb-4 border border-amber-500/20">
        <AlertCircle size={24} className="text-amber-500" />
      </div>
      <h3 className="text-lg font-black uppercase italic mb-2 tracking-tight text-white">{title}</h3>
      <p className="text-slate-400 text-xs leading-relaxed mb-6 font-medium">{message}</p>
      <div className="flex flex-col gap-2 text-white">
        <button onClick={onConfirm} className="w-full py-3.5 bg-blue-600 rounded-2xl font-black text-[10px] tracking-[0.2em] uppercase shadow-lg active:scale-95 transition-all">{confirmLabel}</button>
        <button onClick={onCancel} className="w-full py-3.5 bg-slate-800 rounded-2xl font-black text-[10px] tracking-[0.2em] uppercase text-slate-400 active:scale-95 transition-all">Cancel</button>
      </div>
    </div>
  </div>
);

/** --- MAIN APP --- **/
const App: React.FC = () => {
  const [view, setView] = useState<AppView>('landing');
  const [units, setUnits] = useState<UnitSystem>('Yards');
  const [mapStyle, setMapStyle] = useState<'Street' | 'Satellite'>('Satellite');
  const [pos, setPos] = useState<GeoPoint | null>(null);
  const [history, setHistory] = useState<SavedRecord[]>([]);
  const [viewingRecord, setViewingRecord] = useState<SavedRecord | null>(null);

  const [trkActive, setTrkActive] = useState(false);
  const [trkStart, setTrkStart] = useState<GeoPoint | null>(null);
  const [showEndConfirm, setShowEndConfirm] = useState(false);

  const [mapActive, setMapActive] = useState(false);
  const [mapCompleted, setMapCompleted] = useState(false);
  const [mapPoints, setMapPoints] = useState<GeoPoint[]>([]);
  const [isBunker, setIsBunker] = useState(false);
  const [showMapRestartConfirm, setShowMapRestartConfirm] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem('golf_pro_caddy_final');
    if (saved) {
      try {
        setHistory(JSON.parse(saved));
      } catch (e) {
        console.error("Failed to load history", e);
      }
    }

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
      },
      (e) => console.warn("GPS Signal Loss", e),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 }
    );
    return () => navigator.geolocation.clearWatch(watch);
  }, []);

  const areaMetrics = useMemo(() => {
    if (mapPoints.length < 2) return null;
    let perimeter = 0;
    let bunkerLength = 0;

    for (let i = 0; i < mapPoints.length - 1; i++) {
      const dist = calculateDistance(mapPoints[i], mapPoints[i+1]);
      perimeter += dist;
      if (mapPoints[i+1].type === 'bunker') {
        bunkerLength += dist;
      }
    }

    const isClosed = mapCompleted || calculateDistance(mapPoints[mapPoints.length - 1], mapPoints[0]) < 1.0;
    if (isClosed && mapPoints.length > 2) {
      perimeter += calculateDistance(mapPoints[mapPoints.length-1], mapPoints[0]);
    }

    const bunkerPct = perimeter > 0 ? Math.round((bunkerLength / perimeter) * 100) : 0;

    return { area: calculateArea(mapPoints), perimeter, bunkerLength, bunkerPct };
  }, [mapPoints, mapCompleted]);

  const saveRecord = useCallback((record: Omit<SavedRecord, 'id' | 'date'>) => {
    const newRecord: SavedRecord = { ...record, id: Math.random().toString(36).substr(2, 9), date: Date.now() };
    const updated = [newRecord, ...history]; // Removed .slice(0, 10) to make history unlimited
    setHistory(updated);
    localStorage.setItem('golf_pro_caddy_final', JSON.stringify(updated));
  }, [history]);

  const finalizeMapping = useCallback(() => {
    if (areaMetrics) {
      saveRecord({
        type: 'Green',
        primaryValue: Math.round(areaMetrics.area * (units === 'Yards' ? 1.196 : 1)) + (units === 'Yards' ? 'yd²' : 'm²'),
        secondaryValue: `Bunker: ${areaMetrics.bunkerPct}%`,
        points: mapPoints
      });
    }
    setMapActive(false);
    setMapCompleted(true);
  }, [areaMetrics, mapPoints, units, saveRecord]);

  useEffect(() => {
    if (mapActive && pos) {
      setMapPoints(prev => {
        const last = prev[prev.length - 1];
        if (!last || calculateDistance(last, pos) >= 0.5) {
          return [...prev, { ...pos, type: isBunker ? 'bunker' : 'green' }];
        }
        return prev;
      });

      if (mapPoints.length > 5 && areaMetrics && areaMetrics.perimeter > 5) {
        const distToStart = calculateDistance(pos, mapPoints[0]);
        if (distToStart < 1.0) {
          finalizeMapping();
        }
      }
    }
  }, [pos, mapActive, isBunker, areaMetrics, finalizeMapping]);

  const deleteHistory = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const updated = history.filter(h => h.id !== id);
    setHistory(updated);
    localStorage.setItem('golf_pro_caddy_final', JSON.stringify(updated));
    if (viewingRecord?.id === id) setViewingRecord(null);
  };

  const currentShotDist = (trkStart && pos) ? calculateDistance(trkStart, pos) : 0;
  const elevDelta = (pos && trkStart && pos.alt !== null && trkStart.alt !== null) 
    ? (pos.alt - trkStart.alt) 
    : 0;

  const confirmEndTrack = () => {
    if (trkStart && pos) {
      saveRecord({
        type: 'Track',
        primaryValue: formatDist(currentShotDist, units) + (units === 'Yards' ? 'yd' : 'm'),
        secondaryValue: `Elev: ${(elevDelta >= 0 ? '+' : '') + formatAlt(elevDelta, units) + (units === 'Yards' ? 'ft' : 'm')}`,
        points: [trkStart, pos]
      });
    }
    setTrkActive(false);
    setTrkStart(null);
    setShowEndConfirm(false);
  };

  const handleHistoryClick = (record: SavedRecord) => {
    setViewingRecord(record);
    setView(record.type === 'Track' ? 'track' : 'green');
  };

  return (
    <div className="flex flex-col h-full w-full bg-[#020617] text-white overflow-hidden touch-none absolute inset-0 select-none">
      <div className="h-[env(safe-area-inset-top)] bg-[#0f172a] shrink-0"></div>

      {showEndConfirm && (
        <ConfirmDialogue 
          title="End Track?" 
          message="This will stop tracking and save the current distance measurement to your history."
          onConfirm={confirmEndTrack}
          onCancel={() => setShowEndConfirm(false)}
          confirmLabel="Confirm & Save"
        />
      )}

      {showMapRestartConfirm && (
        <ConfirmDialogue 
          title="Restart Mapper?" 
          message="This will clear all currently walked points."
          onConfirm={() => {
            setMapPoints([]);
            setShowMapRestartConfirm(false);
          }}
          onCancel={() => setShowMapRestartConfirm(false)}
          confirmLabel="Clear Points"
        />
      )}

      {view === 'landing' ? (
        <div className="flex-1 flex flex-col p-6 animate-in fade-in duration-500 overflow-y-auto no-scrollbar">
          <header className="mb-10 mt-6 text-center">
            <h1 className="text-4xl font-black tracking-tighter" style={{ color: '#2563EB' }}>Scottish Golf</h1>
            <p className="text-white text-[9px] font-black tracking-[0.4em] uppercase mt-2">Course Rating Toolkit</p>
          </header>

          <div className="flex flex-col gap-4">
            <button 
              onClick={() => { setView('track'); setViewingRecord(null); }}
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
              onClick={() => { setView('green'); setMapCompleted(false); setMapPoints([]); setViewingRecord(null); }}
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
                  <span className="text-[9px] font-black tracking-[0.2em] text-slate-500 uppercase">Session History</span>
                </div>
                <div className="flex gap-3 overflow-x-auto pb-4 no-scrollbar">
                  {history.map(item => (
                    <div key={item.id} className="relative shrink-0 group">
                      <button 
                        onClick={() => handleHistoryClick(item)}
                        className="bg-slate-900/50 border border-white/5 px-5 py-4 rounded-2xl flex flex-col min-w-[170px] shadow-sm active:bg-slate-800 transition-all text-left"
                      >
                        <div className="flex justify-between items-start mb-1">
                          <span className="text-[7px] font-black text-slate-500 uppercase tracking-[0.2em]">
                            {item.type === 'Track' ? 'TRACK' : 'GREEN'}
                          </span>
                          <Eye size={10} className="text-slate-600 opacity-0 group-hover:opacity-100 transition-opacity" />
                        </div>
                        <span className="text-lg font-black tabular-nums leading-tight text-white mb-0.5">{item.primaryValue}</span>
                        {item.secondaryValue && (
                          <span className="text-[10px] font-bold text-slate-400 opacity-90">{item.secondaryValue}</span>
                        )}
                      </button>
                      <button onClick={(e) => deleteHistory(item.id, e)} className="absolute -top-2 -right-2 w-7 h-7 bg-red-500 rounded-full flex items-center justify-center border-2 border-[#020617] text-white shadow-lg active:scale-90 transition-all z-10">
                        <Trash2 size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </footer>
        </div>
      ) : (
        <div className="flex-1 flex flex-col relative animate-in slide-in-from-right duration-300">
          <div className="absolute top-0 left-0 right-0 z-[1000] p-4 pointer-events-none">
            <div className="flex justify-between items-start">
              <button 
                onClick={() => { setView('landing'); setTrkActive(false); setMapActive(false); setMapCompleted(false); setShowEndConfirm(false); setViewingRecord(null); }}
                className="pointer-events-auto bg-[#0f172a]/95 backdrop-blur-xl border border-white/10 px-5 py-3 rounded-full flex items-center gap-3 shadow-2xl active:scale-95 transition-all"
              >
                <ChevronLeft size={20} className="text-emerald-400" />
                <span className="text-[11px] font-black uppercase tracking-[0.2em]">Home</span>
              </button>

              <div className="flex gap-2">
                <button 
                  onClick={() => setUnits(u => u === 'Yards' ? 'Metres' : 'Yards')}
                  className="pointer-events-auto bg-[#0f172a]/95 backdrop-blur-xl border border-white/10 p-3.5 rounded-full shadow-2xl active:scale-95 transition-all"
                >
                  <Ruler size={22} className="text-emerald-400" />
                </button>
                <button 
                  onClick={() => setMapStyle(s => s === 'Street' ? 'Satellite' : 'Street')}
                  className="pointer-events-auto bg-[#0f172a]/95 backdrop-blur-xl border border-white/10 p-3.5 rounded-full shadow-2xl active:scale-95 transition-all"
                >
                  <Layers size={22} className={mapStyle === 'Satellite' ? 'text-blue-400' : 'text-slate-400'} />
                </button>
              </div>
            </div>
          </div>

          <main className="flex-1">
            <MapContainer center={[0, 0]} zoom={2} className="h-full w-full" zoomControl={false} attributionControl={false}>
              <TileLayer 
                url={mapStyle === 'Street' ? "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" : "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"} 
                maxZoom={22} 
                maxNativeZoom={19} 
              />
              <MapController 
                pos={pos} 
                active={trkActive || mapActive} 
                mapPoints={mapPoints} 
                completed={mapCompleted}
                viewingRecord={viewingRecord}
              />
              
              {pos && (view !== 'green' || !mapCompleted) && !viewingRecord && (
                <>
                  <Circle center={[pos.lat, pos.lng]} radius={pos.accuracy} pathOptions={{ color: getAccuracyColor(pos.accuracy), fillOpacity: 0.1, weight: 1, opacity: 0.2 }} />
                  <CircleMarker center={[pos.lat, pos.lng]} radius={7} pathOptions={{ color: '#fff', fillColor: '#10b981', fillOpacity: 1, weight: 2.5 }} />
                </>
              )}

              {viewingRecord && viewingRecord.type === 'Track' && viewingRecord.points.length >= 2 && (
                <>
                   <CircleMarker center={[viewingRecord.points[0].lat, viewingRecord.points[0].lng]} radius={6} pathOptions={{ color: '#fff', fillColor: '#3b82f6', fillOpacity: 1 }} />
                   <CircleMarker center={[viewingRecord.points[viewingRecord.points.length-1].lat, viewingRecord.points[viewingRecord.points.length-1].lng]} radius={6} pathOptions={{ color: '#fff', fillColor: '#10b981', fillOpacity: 1 }} />
                   <Polyline positions={viewingRecord.points.map(p => [p.lat, p.lng])} color="#3b82f6" weight={5} />
                </>
              )}

              {view === 'track' && trkStart && pos && !viewingRecord && (
                <>
                  <CircleMarker center={[trkStart.lat, trkStart.lng]} radius={6} pathOptions={{ color: '#fff', fillColor: '#3b82f6', fillOpacity: 1 }} />
                  <Polyline positions={[[trkStart.lat, trkStart.lng], [pos.lat, pos.lng]]} color="#3b82f6" weight={5} dashArray="10, 15" />
                </>
              )}

              {viewingRecord && viewingRecord.type === 'Green' && viewingRecord.points.length >= 3 && (
                <>
                  {viewingRecord.points.map((p, i, arr) => {
                    if (i === 0) return null;
                    const prev = arr[i - 1];
                    return <Polyline key={i} positions={[[prev.lat, prev.lng], [p.lat, p.lng]]} color={p.type === 'bunker' ? '#f59e0b' : '#10b981'} weight={p.type === 'bunker' ? 7 : 5} />;
                  })}
                  <Polygon positions={viewingRecord.points.map(p => [p.lat, p.lng])} fillColor="#10b981" fillOpacity={0.2} weight={0} />
                </>
              )}

              {view === 'green' && mapPoints.length > 1 && !viewingRecord && (
                <>
                  {mapPoints.map((p, i, arr) => {
                    if (i === 0) return null;
                    const prev = arr[i - 1];
                    return <Polyline key={i} positions={[[prev.lat, prev.lng], [p.lat, p.lng]]} color={p.type === 'bunker' ? '#f59e0b' : '#10b981'} weight={p.type === 'bunker' ? 7 : 5} />;
                  })}
                  {mapPoints.length > 2 && (mapCompleted || !mapActive) && (
                    <Polygon positions={mapPoints.map(p => [p.lat, p.lng])} fillColor="#10b981" fillOpacity={0.2} weight={0} />
                  )}
                </>
              )}
            </MapContainer>
          </main>

          <div className="absolute inset-x-0 bottom-0 z-[1000] p-4 pointer-events-none flex flex-col gap-4 items-center">
            <div className="flex flex-col gap-4 w-full max-w-sm">
              {view === 'track' ? (
                <>
                  <div className="pointer-events-auto flex justify-center">
                    <button 
                      onClick={() => {
                        setViewingRecord(null);
                        if (!trkActive) {
                          setTrkActive(true);
                          setTrkStart(pos);
                        } else {
                          setShowEndConfirm(true);
                        }
                      }}
                      className={`w-full h-16 rounded-3xl font-black text-[10px] tracking-[0.3em] uppercase border border-white/10 shadow-2xl transition-all flex items-center justify-center gap-4 ${trkActive ? 'bg-blue-600 animate-pulse text-white' : 'bg-emerald-600 text-white active:scale-95'}`}
                    >
                      <Navigation2 size={18} /> {viewingRecord ? 'Start live track' : (trkActive ? 'End Tracking' : 'Start new track')}
                    </button>
                  </div>
                  <div className="pointer-events-auto bg-[#0f172a]/95 backdrop-blur-2xl border border-white/10 rounded-[2.5rem] p-3.5 w-full shadow-2xl">
                    <div className="flex items-center justify-around gap-2">
                      <div className="flex-1 min-w-0 text-center flex flex-col items-center">
                        <FitText maxFontSize={11} className="font-black text-white uppercase tracking-tighter mb-1">
                          {viewingRecord ? 'ARCHIVED LOG' : `GNSS ±${(pos?.accuracy ? pos.accuracy * (units === 'Yards' ? 1.09 : 1) : 0).toFixed(1)}${units === 'Yards' ? 'yd' : 'm'}`}
                        </FitText>
                        <span className="text-[10px] font-black text-white uppercase tracking-widest block mb-1 opacity-40">Hz Distance</span>
                        <FitText maxFontSize={28} className="font-black text-emerald-400 tabular-nums leading-none tracking-tighter text-glow-emerald">
                          {viewingRecord ? viewingRecord.primaryValue.replace(/[a-z²]/gi, '') : formatDist(currentShotDist, units)}
                          <span className="text-[12px] ml-1 font-bold opacity-40 uppercase">{units === 'Yards' ? 'yd' : 'm'}</span>
                        </FitText>
                      </div>
                      <div className="h-20 w-px bg-white/10 shrink-0"></div>
                      <div className="flex-1 min-w-0 text-center flex flex-col items-center">
                        <FitText maxFontSize={11} className="font-black text-white uppercase tracking-tighter mb-1">
                          {viewingRecord ? 'ALTITUDE DATA' : `WGS84 ±${(pos?.altAccuracy ? pos.altAccuracy * (units === 'Yards' ? 3.28 : 1) : 0).toFixed(1)}${units === 'Yards' ? 'ft' : 'm'}`}
                        </FitText>
                        <span className="text-[10px] font-black text-white uppercase tracking-widest block mb-1 opacity-40">Elev change</span>
                        <FitText maxFontSize={28} className="font-black text-amber-400 tabular-nums leading-none tracking-tighter">
                          {viewingRecord ? viewingRecord.secondaryValue?.replace('Elev: ', '').replace(/[a-z²]/gi, '') : ((elevDelta >= 0 ? '+' : '') + formatAlt(elevDelta, units))}
                          <span className="text-[12px] ml-1 font-bold opacity-40 uppercase">{units === 'Yards' ? 'ft' : 'm'}</span>
                        </FitText>
                      </div>
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <div className="pointer-events-auto">
                    <div className="flex gap-2 w-full">
                      <button 
                        onClick={() => {
                          setViewingRecord(null);
                          if (mapCompleted) {
                            setMapPoints([]);
                            setMapCompleted(false);
                            setMapActive(false);
                            return;
                          }

                          if (!mapActive) {
                            setMapPoints(pos ? [pos] : []);
                            setMapActive(true);
                            setMapCompleted(false);
                          } else {
                            finalizeMapping();
                          }
                        }}
                        className={`flex-1 h-20 rounded-[2.2rem] font-black text-[10px] tracking-widest uppercase border border-white/10 transition-all flex items-center justify-center gap-2 ${mapActive ? 'bg-blue-600 text-white' : 'bg-emerald-600 text-white active:scale-95'} ${mapCompleted ? 'bg-slate-800' : ''}`}
                      >
                        {viewingRecord ? 'NEW GREEN' : (mapCompleted ? 'NEW GREEN' : (mapActive ? 'CLOSE GREEN' : 'START GREEN'))}
                      </button>
                      
                      {!mapCompleted && !viewingRecord && (
                        <button 
                          disabled={!mapActive}
                          onPointerDown={() => setIsBunker(true)} 
                          onPointerUp={() => setIsBunker(false)}
                          className={`flex-1 h-20 rounded-[2.2rem] font-black text-[10px] tracking-widest uppercase transition-all disabled:opacity-30 border border-white/5 flex items-center justify-center gap-2 ${isBunker ? 'bg-orange-600 text-white shadow-orange-600/50' : 'bg-orange-400 text-slate-950'}`}
                        >
                          {isBunker ? 'RECORDING' : 'BUNKER (HOLD)'}
                        </button>
                      )}

                      {mapActive && !viewingRecord && (
                        <button onClick={() => setShowMapRestartConfirm(true)} className="w-16 h-20 bg-slate-800 rounded-[2.2rem] flex items-center justify-center border border-white/10 text-slate-400 shrink-0">
                          <RotateCcw size={20} />
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="pointer-events-auto bg-[#0f172a]/95 backdrop-blur-2xl border border-white/10 rounded-[2.5rem] p-1 w-full shadow-2xl overflow-hidden">
                    <div className="grid grid-cols-2 gap-1 mb-1">
                      <div className="bg-white/[0.03] p-1.5 rounded-3xl border border-white/5 text-center">
                        <span className="text-slate-500 text-[8px] font-black uppercase block mb-0.5 tracking-widest">AREA</span>
                        <div className="text-2xl font-black text-emerald-400 tabular-nums leading-none">
                          {viewingRecord ? viewingRecord.primaryValue.replace(/[a-z²]/gi, '') : (areaMetrics ? Math.round(areaMetrics.area * (units === 'Yards' ? 1.196 : 1)) : '--')}
                          <span className="text-[9px] ml-0.5 opacity-50 uppercase">{units === 'Yards' ? 'yd²' : 'm²'}</span>
                        </div>
                      </div>
                      <div className="bg-white/[0.03] p-1.5 rounded-3xl border border-white/5 text-center">
                        <span className="text-slate-500 text-[8px] font-black uppercase block mb-0.5 tracking-widest">WALKED</span>
                        <div className="text-2xl font-black text-blue-400 tabular-nums leading-none">
                          {viewingRecord ? '--' : (areaMetrics ? formatDist(areaMetrics.perimeter, units) : '--')}
                          <span className="text-[9px] ml-0.5 opacity-50 uppercase">{units === 'Yards' ? 'yd' : 'm'}</span>
                        </div>
                      </div>
                      <div className="bg-white/[0.03] p-1.5 rounded-3xl border border-white/5 text-center">
                        <span className="text-slate-500 text-[8px] font-black uppercase block mb-0.5 tracking-widest">BUNKER LEN</span>
                        <div className="text-2xl font-black text-orange-400 tabular-nums leading-none">
                          {viewingRecord ? '--' : (areaMetrics ? formatDist(areaMetrics.perimeter, units) : '--')}
                          <span className="text-[9px] ml-0.5 opacity-50 uppercase">{units === 'Yards' ? 'yd' : 'm'}</span>
                        </div>
                      </div>
                      <div className="bg-white/[0.03] p-1.5 rounded-3xl border border-white/5 text-center">
                        <span className="text-slate-500 text-[8px] font-black uppercase block mb-0.5 tracking-widest">BUNKER %</span>
                        <div className="text-2xl font-black text-amber-500 tabular-nums leading-none">
                          {viewingRecord ? viewingRecord.secondaryValue?.split(':')[1].trim().replace('%', '') : (areaMetrics ? areaMetrics.bunkerPct : '--')}
                          <span className="text-[12px] ml-0.5 opacity-50">%</span>
                        </div>
                      </div>
                    </div>
                    
                    <div className="flex items-center justify-center gap-3 py-2 bg-white/[0.02] border-t border-white/5">
                      {viewingRecord ? (
                        <span className="text-[8px] font-black text-blue-400 uppercase tracking-[0.2em]">VIEWING ARCHIVED RECORD</span>
                      ) : (
                        <>
                          <div className={`w-1.5 h-1.5 rounded-full ${pos ? getAccuracyColor(pos.accuracy) : 'bg-red-500 animate-pulse'} shadow-sm`}></div>
                          <span className="text-[8px] font-black text-slate-500 uppercase tracking-[0.2em]">
                            Hz Accuracy: {pos ? `±${(pos.accuracy * (units === 'Yards' ? 1.09 : 1)).toFixed(1)}${units === 'Yards' ? 'yd' : 'm'}` : 'SEARCHING...'}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
      <div className="h-[env(safe-area-inset-bottom)] bg-[#020617] shrink-0"></div>
      
      <style>{`
        .no-scrollbar::-webkit-scrollbar { display: none; }
        .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
        .text-glow-emerald { text-shadow: 0 0 15px rgba(16, 185, 129, 0.4); }
      `}</style>
    </div>
  );
};

const container = document.getElementById('root');
if (container) {
  createRoot(container).render(<App />);
}
