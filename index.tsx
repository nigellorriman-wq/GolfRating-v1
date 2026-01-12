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
  Eye,
  Anchor,
  Undo2,
  Download,
  Activity,
  Cpu
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
  pivots?: GeoPoint[];
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

const getFormattedTimestamp = () => {
  const now = new Date();
  const pad = (n: number) => n.toString().padStart(2, '0');
  const y = now.getFullYear();
  const m = pad(now.getMonth() + 1);
  const d = pad(now.getDate());
  const h = pad(now.getHours());
  const min = pad(now.getMinutes());
  const s = pad(now.getSeconds());
  return `${y}${m}${d}-${h}${min}${s}`;
};

const exportToKML = (history: SavedRecord[]) => {
  if (history.length === 0) return;

  const kmlHeader = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>Golf Toolkit Export - ${new Date().toLocaleDateString()}</name>
    <Style id="trackStyle">
      <LineStyle><color>ffff0000</color><width>4</width></LineStyle>
    </Style>
    <Style id="greenStyle">
      <PolyStyle><color>4d00ff00</color><fill>1</fill><outline>1</outline></PolyStyle>
      <LineStyle><color>ff00ff00</color><width>2</width></LineStyle>
    </Style>`;

  const kmlFooter = `
  </Document>
</kml>`;

  const placemarks = history.map(item => {
    const dateStr = new Date(item.date).toLocaleString();
    if (item.type === 'Track') {
      const allPoints = [item.points[0], ...(item.pivots || []), item.points[1]];
      const coords = allPoints.map(p => `${p.lng},${p.lat},${p.alt || 0}`).join(' ');
      return `
    <Placemark>
      <name>Track: ${item.primaryValue}</name>
      <description>Date: ${dateStr}\n${item.secondaryValue}</description>
      <styleUrl>#trackStyle</styleUrl>
      <LineString>
        <altitudeMode>clampToGround</altitudeMode>
        <coordinates>${coords}</coordinates>
      </LineString>
    </Placemark>`;
    } else {
      const coords = [...item.points, item.points[0]].map(p => `${p.lng},${p.lat},${p.alt || 0}`).join(' ');
      return `
    <Placemark>
      <name>Green: ${item.primaryValue}</name>
      <description>Date: ${dateStr}\n${item.secondaryValue}</description>
      <styleUrl>#greenStyle</styleUrl>
      <Polygon>
        <altitudeMode>clampToGround</altitudeMode>
        <outerBoundaryIs>
          <LinearRing>
            <coordinates>${coords}</coordinates>
          </LinearRing>
        </outerBoundaryIs>
      </Polygon>
    </Placemark>`;
    }
  }).join('');

  const kmlContent = kmlHeader + placemarks + kmlFooter;
  const blob = new Blob([kmlContent], { type: 'application/vnd.google-earth.kml+xml' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `golf-export-${getFormattedTimestamp()}.kml`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
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
  trkStart: GeoPoint | null,
  trkPivots: GeoPoint[],
  mapPoints: GeoPoint[], 
  completed: boolean,
  viewingRecord: SavedRecord | null,
  mode: AppView
}> = ({ pos, active, trkStart, trkPivots, mapPoints, completed, viewingRecord, mode }) => {
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
      if (viewingRecord.pivots) {
        viewingRecord.pivots.forEach(pv => bounds.extend([pv.lat, pv.lng]));
      }
      map.fitBounds(bounds, { padding: [50, 50], animate: true });
      return;
    }

    if (completed && mode === 'green' && mapPoints.length > 2) {
      if (!fittedCompleted.current) {
        const bounds = L.latLngBounds(mapPoints.map(p => [p.lat, p.lng]));
        map.fitBounds(bounds, { padding: [50, 50], animate: true });
        fittedCompleted.current = true;
      }
      return; 
    }

    if (mode === 'track' && active && trkStart && pos) {
      const bounds = L.latLngBounds([trkStart.lat, trkStart.lng], [pos.lat, pos.lng]);
      trkPivots.forEach(p => bounds.extend([p.lat, p.lng]));
      const dist = calculateDistance(trkStart, pos);
      if (dist > 20) {
        map.fitBounds(bounds, { padding: [80, 80], animate: true, maxZoom: 19 });
      } else {
        map.setView([pos.lat, pos.lng], 19, { animate: true });
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
  }, [pos, active, map, completed, mapPoints, viewingRecord, mode, trkStart, trkPivots]);

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
  const [trkPivots, setTrkPivots] = useState<GeoPoint[]>([]);
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
    
    if (typeof (DeviceMotionEvent as any).requestPermission === 'function') {
      (DeviceMotionEvent as any).requestPermission()
        .then((permissionState: string) => {
          if (permissionState === 'granted') {
            console.debug("Sensor permission granted");
          }
        })
        .catch(console.error);
    }

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
      const d = calculateDistance(mapPoints[i], mapPoints[i+1]);
      perimeter += d;
      if (mapPoints[i+1].type === 'bunker') {
        bunkerLength += d;
      }
    }

    const isClosed = mapCompleted || (mapPoints.length > 2 && calculateDistance(mapPoints[mapPoints.length - 1], mapPoints[0]) < 1.0);
    if (isClosed && mapPoints.length > 2) {
      perimeter += calculateDistance(mapPoints[mapPoints.length-1], mapPoints[0]);
    }

    const bunkerPct = perimeter > 0 ? Math.round((bunkerLength / perimeter) * 100) : 0;

    return { area: calculateArea(mapPoints), perimeter, bunkerLength, bunkerPct };
  }, [mapPoints, mapCompleted]);

  const saveRecord = useCallback((record: Omit<SavedRecord, 'id' | 'date'>) => {
    const newRecord: SavedRecord = { ...record, id: Math.random().toString(36).substr(2, 9), date: Date.now() };
    const updated = [newRecord, ...history];
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

  const currentLegDist = useMemo(() => {
    if (!pos || !trkStart) return 0;
    const lastPivot = trkPivots[trkPivots.length - 1];
    const origin = lastPivot || trkStart;
    return calculateDistance(origin, pos);
  }, [pos, trkStart, trkPivots]);

  const accumulatedDist = useMemo(() => {
    if (!trkStart || !pos) return 0;
    let total = 0;
    let lastPoint = trkStart;
    
    trkPivots.forEach(pivot => {
      total += calculateDistance(lastPoint, pivot);
      lastPoint = pivot;
    });
    
    total += calculateDistance(lastPoint, pos);
    return total;
  }, [trkStart, trkPivots, pos]);

  const elevDelta = (pos && trkStart && pos.alt !== null && trkStart.alt !== null) 
    ? (pos.alt - trkStart.alt) 
    : 0;

  const confirmEndTrack = () => {
    if (trkStart && pos) {
      saveRecord({
        type: 'Track',
        primaryValue: formatDist(accumulatedDist, units) + (units === 'Yards' ? 'yd' : 'm'),
        secondaryValue: `Elev: ${(elevDelta >= 0 ? '+' : '') + formatAlt(elevDelta, units) + (units === 'Yards' ? 'ft' : 'm')}`,
        points: [trkStart, pos],
        pivots: trkPivots
      });
    }
    setTrkActive(false);
    setTrkStart(null);
    setTrkPivots([]);
    setShowEndConfirm(false);
  };

  const handleHistoryClick = (record: SavedRecord) => {
    setViewingRecord(record);
    setView(record.type === 'Track' ? 'track' : 'green');
  };

  const addPivot = () => {
    if (pos && trkPivots.length < 3) {
      setTrkPivots([...trkPivots, pos]);
    }
  };

  const undoPivot = () => {
    setTrkPivots(trkPivots.slice(0, -1));
  };

  // REFINED SENSOR DIAGNOSTICS
  const altPrecision = pos?.altAccuracy ?? null;
  const isBarometerActive = altPrecision !== null && altPrecision > 0 && altPrecision < 5.0;
  const isGNSS3D = altPrecision !== null && altPrecision >= 5.0;
  
  const verticalAccuracyDisplay = useMemo(() => {
    if (!pos) return 'SEARCHING...';
    if (altPrecision === null || altPrecision === 0) return 'ESTIMATE';
    // Convert current precision based on units for the UI
    const precisionVal = altPrecision * (units === 'Yards' ? 3.28084 : 1);
    return `±${precisionVal.toFixed(1)}${units === 'Yards' ? 'ft' : 'm'}`;
  }, [pos, units, altPrecision]);

  const sensorLabel = useMemo(() => {
    if (isBarometerActive) return 'BAROMETRIC';
    if (isGNSS3D) return 'GNSS 3D';
    return 'ESTIMATED';
  }, [isBarometerActive, isGNSS3D]);

  return (
    <div className="flex flex-col h-full w-full bg-[#020617] text-white overflow-hidden touch-none absolute inset-0 select-none">
      <div className="h-[env(safe-area-inset-top)] bg-[#0f172a] shrink-0"></div>

      {showEndConfirm && (
        <ConfirmDialogue 
          title="End Track?" 
          message="This will stop tracking and save the total accumulated distance to your history."
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
            <p className="text-white text-[9px] font-black tracking-[0.4em] uppercase mt-2">Course rating toolkit v2</p>
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
              <p className="text-white text-[11px] font-medium max-w-[200px] leading-relaxed">Realtime accumulated distance with pivot capability</p>
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
                <div className="flex items-center justify-between mb-3 px-2">
                  <div className="flex items-center gap-2">
                    <HistoryIcon size={14} className="text-slate-600" />
                    <span className="text-[9px] font-black tracking-[0.2em] text-slate-500 uppercase">Session History</span>
                  </div>
                  <button 
                    onClick={() => exportToKML(history)}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600/10 border border-blue-600/20 rounded-full active:scale-95 transition-all"
                  >
                    <Download size={12} className="text-blue-400" />
                    <span className="text-[8px] font-black text-blue-400 uppercase tracking-widest">Export KML</span>
                  </button>
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
                onClick={() => { setView('landing'); setTrkActive(false); setMapActive(false); setMapCompleted(false); setShowEndConfirm(false); setViewingRecord(null); setTrkPivots([]); }}
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
            <MapContainer center={[0, 0]} zoom={2} className="h-full w-full custom-map-container" zoomControl={false} attributionControl={false}>
              <TileLayer 
                url={mapStyle === 'Street' ? "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" : "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"} 
                maxZoom={22} 
                maxNativeZoom={19} 
                className="opaque-tile-layer"
              />
              <MapController 
                pos={pos} 
                active={trkActive || mapActive} 
                trkStart={trkStart}
                trkPivots={trkPivots}
                mapPoints={mapPoints} 
                completed={mapCompleted}
                viewingRecord={viewingRecord}
                mode={view}
              />
              
              {pos && (view !== 'green' || !mapCompleted) && !viewingRecord && (
                <>
                  <Circle center={[pos.lat, pos.lng]} radius={pos.accuracy} pathOptions={{ color: getAccuracyColor(pos.accuracy), fillOpacity: 0.1, weight: 1, opacity: 0.2 }} />
                  <CircleMarker center={[pos.lat, pos.lng]} radius={7} pathOptions={{ color: '#fff', fillColor: '#10b981', fillOpacity: 1, weight: 2.5 }} />
                </>
              )}

              {/* TRACKING MAP ELEMENTS */}
              {view === 'track' && (
                <>
                  {/* Archived Track */}
                  {viewingRecord && viewingRecord.type === 'Track' && viewingRecord.points.length >= 2 && (
                    <>
                      <CircleMarker center={[viewingRecord.points[0].lat, viewingRecord.points[0].lng]} radius={6} pathOptions={{ color: '#fff', fillColor: '#3b82f6', fillOpacity: 1 }} />
                      {viewingRecord.pivots?.map((pv, idx) => (
                        <CircleMarker key={idx} center={[pv.lat, pv.lng]} radius={6} pathOptions={{ color: '#fff', fillColor: '#f59e0b', fillOpacity: 1 }} />
                      ))}
                      <CircleMarker center={[viewingRecord.points[viewingRecord.points.length-1].lat, viewingRecord.points[viewingRecord.points.length-1].lng]} radius={6} pathOptions={{ color: '#fff', fillColor: '#10b981', fillOpacity: 1 }} />
                      
                      <Polyline positions={[
                        [viewingRecord.points[0].lat, viewingRecord.points[0].lng],
                        ...(viewingRecord.pivots?.map(p => [p.lat, p.lng]) || []),
                        [viewingRecord.points[viewingRecord.points.length-1].lat, viewingRecord.points[viewingRecord.points.length-1].lng]
                      ]} color="#3b82f6" weight={5} />
                    </>
                  )}

                  {/* Live Track */}
                  {trkStart && pos && !viewingRecord && (
                    <>
                      <CircleMarker center={[trkStart.lat, trkStart.lng]} radius={6} pathOptions={{ color: '#fff', fillColor: '#3b82f6', fillOpacity: 1 }} />
                      {trkPivots.map((pv, idx) => (
                        <CircleMarker key={idx} center={[pv.lat, pv.lng]} radius={6} pathOptions={{ color: '#fff', fillColor: '#f59e0b', fillOpacity: 1 }} />
                      ))}
                      <Polyline positions={[
                        [trkStart.lat, trkStart.lng],
                        ...trkPivots.map(p => [p.lat, p.lng]),
                        [pos.lat, pos.lng]
                      ]} color="#3b82f6" weight={5} />
                    </>
                  )}
                </>
              )}

              {/* GREEN MAP ELEMENTS */}
              {view === 'green' && (
                <>
                  {viewingRecord && viewingRecord.type === 'Green' && viewingRecord.points.length >= 3 && (
                    <>
                      {viewingRecord.points.map((p, i, arr) => {
                        if (i === 0) return null;
                        const prev = arr[i - 1];
                        return <Polyline key={i} positions={[[prev.lat, prev.lng], [p.lat, p.lng]]} color={p.type === 'bunker' ? '#f59e0b' : '#10b981'} weight={p.type === 'bunker' ? 7 : 5} />;
                      })}
                      <Polyline 
                        positions={[[viewingRecord.points[viewingRecord.points.length-1].lat, viewingRecord.points[viewingRecord.points.length-1].lng], [viewingRecord.points[0].lat, viewingRecord.points[0].lng]]} 
                        color={viewingRecord.points[0].type === 'bunker' ? '#f59e0b' : '#10b981'} 
                        weight={5} 
                      />
                      <Polygon positions={viewingRecord.points.map(p => [p.lat, p.lng])} fillColor="#10b981" fillOpacity={0.2} weight={0} />
                    </>
                  )}

                  {mapPoints.length > 1 && !viewingRecord && (
                    <>
                      {mapPoints.map((p, i, arr) => {
                        if (i === 0) return null;
                        const prev = arr[i - 1];
                        return <Polyline key={i} positions={[[prev.lat, prev.lng], [p.lat, p.lng]]} color={p.type === 'bunker' ? '#f59e0b' : '#10b981'} weight={p.type === 'bunker' ? 7 : 5} />;
                      })}
                      {mapPoints.length > 2 && (mapCompleted || calculateDistance(mapPoints[mapPoints.length - 1], mapPoints[0]) < 1.0) && (
                        <Polyline 
                          positions={[[mapPoints[mapPoints.length - 1].lat, mapPoints[mapPoints.length - 1].lng], [mapPoints[0].lat, mapPoints[0].lng]]} 
                          color={mapPoints[0].type === 'bunker' ? '#f59e0b' : '#10b981'} 
                          weight={5} 
                        />
                      )}
                      {mapPoints.length > 2 && (mapCompleted || !mapActive) && (
                        <Polygon positions={mapPoints.map(p => [p.lat, p.lng])} fillColor="#10b981" fillOpacity={0.2} weight={0} />
                      )}
                    </>
                  )}
                </>
              )}
            </MapContainer>
          </main>

          <div className="absolute inset-x-0 bottom-0 z-[1000] p-4 pointer-events-none flex flex-col gap-4 items-center">
            <div className="flex flex-col gap-4 w-full max-w-sm">
              {view === 'track' ? (
                <>
                  <div className="pointer-events-auto flex gap-2 w-full">
                    <button 
                      onClick={() => {
                        setViewingRecord(null);
                        if (!trkActive) {
                          setTrkActive(true);
                          setTrkStart(pos);
                          setTrkPivots([]);
                        } else {
                          setShowEndConfirm(true);
                        }
                      }}
                      className={`flex-1 h-14 rounded-3xl font-black text-[9px] tracking-widest uppercase border border-white/10 shadow-2xl transition-all flex items-center justify-center gap-2 ${trkActive ? 'bg-red-600 text-white' : 'bg-emerald-600 text-white active:scale-95'}`}
                    >
                      <Navigation2 size={18} /> {viewingRecord ? 'LIVE' : (trkActive ? 'FINISH' : 'START')}
                    </button>

                    {trkActive && (
                      <div className="flex-[1.5] flex gap-2">
                        {trkPivots.length > 0 && (
                          <button 
                            onClick={undoPivot}
                            className="flex-1 h-14 rounded-3xl bg-slate-800 border border-white/10 text-amber-400 font-black text-[9px] tracking-widest uppercase flex items-center justify-center gap-2 active:scale-95 transition-all shadow-xl"
                          >
                            <Undo2 size={16} /> UNDO
                          </button>
                        )}
                        <button 
                          onClick={addPivot}
                          disabled={trkPivots.length >= 3}
                          className={`flex-[1.2] h-14 rounded-3xl font-black text-[9px] tracking-widest uppercase border border-white/10 shadow-xl transition-all flex items-center justify-center gap-2 ${trkPivots.length >= 3 ? 'bg-slate-800 text-slate-500' : 'bg-blue-600 text-white active:scale-95'}`}
                        >
                          <Anchor size={16} /> 
                          {trkPivots.length >= 3 ? 'MAX' : `PIVOT ${trkPivots.length + 1}/3`}
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="pointer-events-auto bg-[#0f172a]/95 backdrop-blur-2xl border border-white/10 rounded-[2.5rem] p-3.5 w-full shadow-2xl">
                    <div className="flex items-center justify-around gap-2">
                      <div className="flex-1 min-w-0 text-center flex flex-col items-center">
                        <FitText maxFontSize={11} className="font-black text-white uppercase tracking-tighter mb-1">
                          {viewingRecord ? 'ARCHIVED LOG' : `HORIZ ±${(pos?.accuracy ? pos.accuracy * (units === 'Yards' ? 1.09 : 1) : 0).toFixed(1)}${units === 'Yards' ? 'yd' : 'm'}`}
                        </FitText>
                        <span className="text-[10px] font-black text-white uppercase tracking-widest block mb-1 opacity-40">Total Distance</span>
                        <FitText maxFontSize={32} className="font-black text-emerald-400 tabular-nums leading-none tracking-tighter text-glow-emerald">
                          {viewingRecord ? viewingRecord.primaryValue.replace(/[a-z²]/gi, '') : formatDist(accumulatedDist, units)}
                          <span className="text-[12px] ml-1 font-bold opacity-40 uppercase">{units === 'Yards' ? 'yd' : 'm'}</span>
                        </FitText>
                        {(trkPivots.length > 0 || viewingRecord?.pivots?.length) && (
                          <span className="text-[10px] font-black text-amber-400 uppercase tracking-widest mt-1">
                            LEG: {formatDist(currentLegDist, units)}{units === 'Yards' ? 'yd' : 'm'}
                          </span>
                        )}
                      </div>
                      <div className="h-20 w-px bg-white/10 shrink-0 mx-2"></div>
                      <div className="flex-1 min-w-0 text-center flex flex-col items-center">
                        <FitText maxFontSize={11} className="font-black text-white uppercase tracking-tighter mb-1">
                          {viewingRecord ? 'ALTITUDE DATA' : `VERT ${verticalAccuracyDisplay}`}
                        </FitText>
                        <span className="text-[10px] font-black text-white uppercase tracking-widest block mb-1 opacity-40">Elev change</span>
                        <FitText maxFontSize={32} className="font-black text-amber-400 tabular-nums leading-none tracking-tighter">
                          {viewingRecord ? viewingRecord.secondaryValue?.replace('Elev: ', '').replace(/[a-z²]/gi, '') : ((elevDelta >= 0 ? '+' : '') + formatAlt(elevDelta, units))}
                          <span className="text-[12px] ml-1 font-bold opacity-40 uppercase">{units === 'Yards' ? 'ft' : 'm'}</span>
                        </FitText>
                        {!viewingRecord && (
                          <div className="flex items-center gap-1 mt-1">
                            <Cpu size={10} className={isBarometerActive ? 'text-blue-400' : 'text-slate-500'} />
                            <span className={`text-[8px] font-black uppercase tracking-widest ${isBarometerActive ? 'text-blue-400' : 'text-slate-500'}`}>
                              {sensorLabel}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                    {!viewingRecord && (
                      <div className="mt-3 flex items-center justify-center gap-2 border-t border-white/5 pt-2">
                        <Activity size={10} className={isBarometerActive ? 'text-blue-400' : (isGNSS3D ? 'text-emerald-400' : 'text-amber-500')} />
                        <span className={`text-[8px] font-black uppercase tracking-[0.2em] ${isBarometerActive ? 'text-blue-400' : (isGNSS3D ? 'text-emerald-400' : 'text-amber-500')}`}>
                          {isBarometerActive ? 'Barometer Lock Active' : (isGNSS3D ? 'GNSS 3D Fix Active' : 'Vertical Fix Searching')}
                        </span>
                      </div>
                    )}
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
                          {viewingRecord ? '--' : (areaMetrics ? formatDist(areaMetrics.bunkerLength, units) : '--')}
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
        
        .custom-map-container {
          background-color: #d1fae5 !important;
          background-image: 
            linear-gradient(rgba(0,0,0,0.03) 1px, transparent 1px),
            linear-gradient(90deg, rgba(0,0,0,0.03) 1px, transparent 1px);
          background-size: 100px 100px;
          position: relative;
        }

        .custom-map-container::before {
          content: "NO MAPPING DATA";
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%) rotate(-30deg);
          font-family: system-ui, sans-serif;
          font-weight: 900;
          font-size: 8vw;
          color: rgba(0, 0, 0, 0.04);
          letter-spacing: 0.5em;
          pointer-events: none;
          white-space: nowrap;
          z-index: 0;
          text-align: center;
        }

        .opaque-tile-layer {
          z-index: 50;
        }

        .leaflet-pane {
          z-index: 400 !important;
        }
        .leaflet-tile-pane {
          z-index: 200 !important;
        }
      `}</style>
    </div>
  );
};

const container = document.getElementById('root');
if (container) {
  createRoot(container).render(<App />);
}
