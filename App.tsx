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
import L from 'leaflet';
import { Ruler, Map as MapIcon, RotateCcw, Activity, Trees, Info, ShieldAlert, AlertTriangle } from 'lucide-react';

// Fix for default marker icons in Leaflet when using ESM
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

const redIcon = new L.Icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41]
});

const blueIcon = new L.Icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-blue.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41]
});

const MapRefresher: React.FC<{ 
  points: GeoPoint[], 
  currentPos: GeoPoint | null, 
  mode: AppMode, 
  isTracking: boolean 
}> = ({ points, currentPos, mode, isTracking }) => {
  const map = useMap();

  useEffect(() => {
    if (mode === 'Trk') {
      if (isTracking && points.length > 1) {
        const bounds = L.latLngBounds(points.map(p => [p.lat, p.lng]));
        if (currentPos) bounds.extend([currentPos.lat, currentPos.lng]);
        map.fitBounds(bounds, { padding: [50, 50], maxZoom: 21 });
      } else if (currentPos) {
        map.setView([currentPos.lat, currentPos.lng], 21);
      }
    } else if (mode === 'Grn') {
       if (points.length > 0) {
        const bounds = L.latLngBounds(points.map(p => [p.lat, p.lng]));
        if (currentPos) bounds.extend([currentPos.lat, currentPos.lng]);
        map.fitBounds(bounds, { padding: [30, 30], maxZoom: 22 });
      } else if (currentPos) {
        map.setView([currentPos.lat, currentPos.lng], 22);
      }
    }
  }, [points, currentPos, mode, isTracking, map]);

  return null;
};

const App: React.FC = () => {
  const [mode, setMode] = useState<AppMode>('Trk');
  const [mapProvider, setMapProvider] = useState<MapProvider>('Google');
  const [units, setUnits] = useState<UnitSystem>('Yards');
  const [elevAccuracy, setElevAccuracy] = useState<number | null>(null);
  const [gpsError, setGpsError] = useState<string | null>(null);
  
  const [currentPos, setCurrentPos] = useState<GeoPoint | null>(null);
  const [tracking, setTracking] = useState<TrackingState>({
    isActive: false,
    startPoint: null,
    path: [],
    initialAltitude: null,
    currentAltitude: null,
    altSource: 'GPS'
  });

  const [mapping, setMapping] = useState<MappingState>({
    isActive: false,
    isBunkerActive: false,
    points: [],
    isClosed: false
  });

  const watchId = useRef<number | null>(null);

  useEffect(() => {
    if ('PressureSensor' in window) {
      try {
        const sensor = new (window as any).PressureSensor({ frequency: 2 });
        sensor.addEventListener('reading', () => {
          setTracking(prev => ({ ...prev, altSource: 'Barometer' }));
          setElevAccuracy(0.5); 
        });
        sensor.start();
      } catch (e) {
        console.warn('Barometer access failed', e);
      }
    }
  }, []);

  const handlePositionUpdate = useCallback((pos: GeolocationPosition) => {
    const newPoint: GeoPoint = {
      lat: pos.coords.latitude,
      lng: pos.coords.longitude,
      alt: pos.coords.altitude,
      accuracy: pos.coords.accuracy,
      timestamp: Date.now()
    };

    setGpsError(null);
    setCurrentPos(newPoint);
    
    if (tracking.altSource !== 'Barometer') {
      setElevAccuracy(pos.coords.altitudeAccuracy || null);
    }

    if (tracking.isActive) {
      setTracking(prev => {
        const lastInPath = prev.path[prev.path.length - 1];
        if (lastInPath && calculateDistance(lastInPath, newPoint) < 0.05) return prev;
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
        if (!lastPoint) {
           return { ...prev, points: [{ ...newPoint, type: 'green' }] };
        }
        const dist = calculateDistance(lastPoint, newPoint);
        if (dist >= 0.5) {
          const type: PointType = prev.isBunkerActive ? 'bunker' : 'green';
          return { ...prev, points: [...prev.points, { ...newPoint, type }] };
        }
        return prev;
      });
    }
  }, [tracking.isActive, tracking.altSource, mapping.isActive, mapping.isClosed]);

  useEffect(() => {
    if (!navigator.geolocation) {
      setGpsError("GPS Not Supported");
      return;
    }

    const handleError = (error: GeolocationPositionError) => {
      let errorMessage = "GPS Error";
      switch (error.code) {
        case error.PERMISSION_DENIED:
          errorMessage = "GPS Permission Denied";
          break;
        case error.POSITION_UNAVAILABLE:
          errorMessage = "GPS Signal Lost";
          break;
        case error.TIMEOUT:
          errorMessage = "GPS Request Timeout";
          break;
      }
      setGpsError(errorMessage);
    };

    watchId.current = navigator.geolocation.watchPosition(
      handlePositionUpdate,
      handleError,
      { 
        enableHighAccuracy: true, 
        maximumAge: 0, 
        timeout: 15000 
      }
    );

    return () => {
      if (watchId.current !== null) {
        navigator.geolocation.clearWatch(watchId.current);
      }
    };
  }, [handlePositionUpdate]);

  const startNewTracking = () => {
    if (!currentPos) return;
    setTracking({
      isActive: true,
      startPoint: currentPos,
      path: [currentPos],
      initialAltitude: currentPos.alt,
      currentAltitude: currentPos.alt,
      altSource: tracking.altSource
    });
  };

  const startNewGreen = () => {
    if (!currentPos) return;
    setMapping({
      isActive: true,
      isBunkerActive: false,
      points: [{ ...currentPos, type: 'green' }],
      isClosed: false
    });
  };

  const toggleBunker = (active: boolean) => {
    if (!mapping.isActive || mapping.isClosed) return;
    
    setMapping(prev => {
      if (prev.isBunkerActive === active) return prev;
      const type: PointType = active ? 'bunker' : 'green';
      const latestPoints = currentPos ? [...prev.points, { ...currentPos, type }] : prev.points;
      return { 
        ...prev, 
        isBunkerActive: active,
        points: latestPoints
      };
    });
  };

  const closeMapping = () => {
    setMapping(prev => ({ ...prev, isClosed: true }));
  };

  const totalDistance = tracking.isActive && tracking.path.length > 1
    ? calculateDistance(tracking.path[0], tracking.path[tracking.path.length - 1])
    : 0;

  const elevationChange = (tracking.currentAltitude ?? 0) - (tracking.initialAltitude ?? 0);

  const mapMetrics = useMemo(() => {
    if (mapping.points.length < 2) return null;
    let totalLen = 0;
    let bunkerLen = 0;
    for (let i = 0; i < mapping.points.length - 1; i++) {
      const d = calculateDistance(mapping.points[i], mapping.points[i+1]);
      totalLen += d;
      if (mapping.points[i+1].type === 'bunker') {
        bunkerLen += d;
      }
    }
    if (mapping.isClosed) {
      totalLen += calculateDistance(mapping.points[mapping.points.length - 1], mapping.points[0]);
    }
    const area = calculatePolygonArea(mapping.points);
    const bunkerPct = totalLen > 0 ? Math.round((bunkerLen / totalLen) * 100) : 0;
    return { totalLen, bunkerLen, area, bunkerPct };
  }, [mapping.points, mapping.isClosed]);

  const accuracyDescription = currentPos 
    ? (currentPos.accuracy < 2 ? "Better than 2m" : currentPos.accuracy <= 5 ? "2m-5m" : ">5m") 
    : (gpsError || "Locating...");

  return (
    <div className="flex flex-col h-screen w-screen select-none bg-slate-900 font-sans text-white overflow-hidden">
      <header className="p-3 flex items-center justify-between gap-2 border-b border-slate-700 bg-slate-800/95 backdrop-blur-md z-[1000] shrink-0">
        <div className="flex items-center gap-1">
          <button 
            onClick={() => setMode('Trk')}
            className={`px-4 py-2 rounded-xl font-black text-sm transition-all ${mode === 'Trk' ? 'bg-blue-600 shadow-[0_0_15px_rgba(37,99,235,0.4)]' : 'bg-slate-700 text-slate-400'}`}
          >
            Trk
          </button>
          <button 
            onClick={() => {
              setMode('Grn');
              setTracking(prev => ({ ...prev, isActive: false }));
            }}
            className={`px-4 py-2 rounded-xl font-black text-sm transition-all ${mode === 'Grn' ? 'bg-emerald-600 shadow-[0_0_15px_rgba(16,185,129,0.4)]' : 'bg-slate-700 text-slate-400'}`}
          >
            Grn
          </button>
        </div>

        <div className="flex items-center gap-1">
          <button 
            onClick={() => setMapProvider(p => p === 'Google' ? 'OSM' : 'Google')}
            className="px-3 py-2 bg-slate-700 rounded-xl flex items-center gap-1.5 border border-slate-600"
          >
            <MapIcon size={12} />
            <span className="text-[10px] uppercase font-black">{mapProvider}</span>
          </button>
          <button 
            onClick={() => setUnits(u => u === 'Meters' ? 'Yards' : 'Meters')}
            className="px-3 py-2 bg-slate-700 rounded-xl flex items-center gap-1.5 border border-slate-600"
          >
            <Ruler size={12} />
            <span className="text-[10px] uppercase font-black">{units}</span>
          </button>
        </div>
      </header>

      <main className="flex-1 relative overflow-hidden flex flex-col min-h-0">
        <MapContainer 
          center={currentPos ? [currentPos.lat, currentPos.lng] : [0,0]} 
          zoom={currentPos ? 21 : 2} 
          className="w-full h-full absolute inset-0"
          zoomControl={false}
          attributionControl={false}
        >
          {mapProvider === 'OSM' ? (
            <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" maxZoom={20} />
          ) : (
            <TileLayer url="https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}" maxZoom={22} />
          )}

          <MapRefresher 
            points={mode === 'Trk' ? tracking.path : mapping.points} 
            currentPos={currentPos} 
            mode={mode}
            isTracking={tracking.isActive}
          />

          {currentPos && (
            <>
              <Marker position={[currentPos.lat, currentPos.lng]} icon={blueIcon} />
              <Circle 
                center={[currentPos.lat, currentPos.lng]} 
                radius={currentPos.accuracy} 
                pathOptions={{ 
                  fillColor: getAccuracyColor(currentPos.accuracy), 
                  color: 'transparent', 
                  fillOpacity: 0.3 
                }}
              />
            </>
          )}

          {mode === 'Trk' && (
            <>
              {tracking.startPoint && (
                <Marker position={[tracking.startPoint.lat, tracking.startPoint.lng]} icon={redIcon} />
              )}
              {tracking.path.length > 1 && (
                <Polyline positions={tracking.path.map(p => [p.lat, p.lng])} color="#ef4444" weight={5} />
              )}
            </>
          )}

          {mode === 'Grn' && (
            <>
              {mapping.points.length > 1 && (
                <>
                  {mapping.points.map((p, idx) => {
                    if (idx === 0) return null;
                    const prev = mapping.points[idx - 1];
                    const segmentColor = p.type === 'bunker' ? '#fbbf24' : '#10b981';
                    return (
                      <Polyline 
                        key={`seg-${idx}`} 
                        positions={[[prev.lat, prev.lng], [p.lat, p.lng]]} 
                        color={segmentColor} 
                        weight={6} 
                      />
                    );
                  })}
                  {mapping.isClosed && (
                    <Polygon 
                      positions={mapping.points.map(p => [p.lat, p.lng])} 
                      pathOptions={{ color: '#10b981', weight: 2, fillColor: '#10b981', fillOpacity: 0.2 }} 
                    />
                  )}
                </>
              )}
            </>
          )}
        </MapContainer>

        {gpsError && (
          <div className="absolute top-2 left-1/2 -translate-x-1/2 bg-red-600/95 backdrop-blur-md text-white px-4 py-2 rounded-full flex items-center gap-2 z-[2000] shadow-xl text-[10px] font-black uppercase tracking-wider border border-white/20">
            <AlertTriangle size={14} />
            {gpsError}
          </div>
        )}

        <div className="absolute top-4 left-4 right-4 pointer-events-none flex flex-col gap-3 z-[1001]">
          {mode === 'Trk' && (
            <div className="bg-slate-900/90 backdrop-blur-lg p-3 rounded-2xl border border-slate-700 shadow-2xl flex justify-between items-center">
              <div className="text-center flex-1 border-r border-slate-800">
                <p className="text-[9px] text-slate-500 font-black uppercase tracking-widest mb-0.5">Distance</p>
                <p className="text-2xl font-black text-blue-400 tabular-nums">
                  {toDisplayDistance(totalDistance, units)}<span className="text-[10px] ml-1 opacity-60 uppercase">{units === 'Yards' ? 'yd' : 'm'}</span>
                </p>
              </div>
              <div className="text-center flex-1">
                <p className="text-[9px] text-slate-500 font-black uppercase tracking-widest mb-0.5">Elev Δ</p>
                <p className="text-2xl font-black text-amber-400 tabular-nums">
                  {toDisplayElevation(elevationChange, units)}<span className="text-[10px] ml-1 opacity-60 uppercase">{units === 'Yards' ? 'ft' : 'm'}</span>
                </p>
              </div>
            </div>
          )}

          {mode === 'Grn' && mapMetrics && (
             <div className="bg-slate-900/90 backdrop-blur-lg p-3 rounded-2xl border border-slate-700 shadow-2xl grid grid-cols-2 gap-2">
               <div className="bg-slate-800/60 p-2 rounded-xl border border-white/5">
                 <p className="text-[8px] text-slate-500 font-black uppercase">Perimeter</p>
                 <p className="text-base font-black text-emerald-400 tabular-nums truncate">{toDisplayDistance(mapMetrics.totalLen, units)} {units === 'Yards' ? 'yd' : 'm'}</p>
               </div>
               <div className="bg-slate-800/60 p-2 rounded-xl border border-white/5">
                 <p className="text-[8px] text-slate-500 font-black uppercase">Bunker</p>
                 <p className="text-base font-black text-amber-400 tabular-nums truncate">{toDisplayDistance(mapMetrics.bunkerLen, units)} {units === 'Yards' ? 'yd' : 'm'}</p>
               </div>
               <div className="bg-slate-800/60 p-2 rounded-xl border border-white/5">
                 <p className="text-[8px] text-slate-500 font-black uppercase">Area</p>
                 <p className="text-base font-black text-blue-400 tabular-nums">
                   {units === 'Yards' ? (mapMetrics.area * 1.196).toFixed(0) : mapMetrics.area.toFixed(0)} 
                   <span className="text-[9px] ml-0.5 opacity-60 uppercase">{units === 'Yards' ? 'sqyd' : 'm²'}</span>
                 </p>
               </div>
               <div className="bg-slate-800/60 p-2 rounded-xl border border-white/5">
                 <p className="text-[8px] text-slate-500 font-black uppercase">Ratio</p>
                 <p className="text-base font-black text-red-400 tabular-nums">{mapMetrics.bunkerPct}%</p>
               </div>
             </div>
          )}
        </div>

        <div className="absolute bottom-28 right-4 bg-slate-900/90 p-3 rounded-2xl border border-slate-700 backdrop-blur-lg text-[9px] flex flex-col gap-1.5 z-[1001] shadow-2xl min-w-[120px]">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1">
              <Activity size={10} className="text-blue-400" />
              <span className="text-slate-500 font-bold uppercase">Sensor:</span>
            </div>
            <span className="text-white font-black">{tracking.altSource}</span>
          </div>
          
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1">
              <Info size={10} className="text-amber-400" />
              <span className="text-slate-500 font-bold uppercase">Accur:</span>
            </div>
            <span className="text-white font-black">{elevAccuracy ? `${elevAccuracy.toFixed(1)}m` : 'N/A'}</span>
          </div>

          <div className="border-t border-slate-800 mt-0.5 pt-1.5 flex items-center justify-between">
            <div className={`w-1.5 h-1.5 rounded-full animate-pulse ${currentPos && currentPos.accuracy < 2 ? 'bg-emerald-500' : currentPos && currentPos.accuracy <= 5 ? 'bg-yellow-500' : 'bg-red-500'}`} />
            <span className="text-slate-300 font-black tracking-tight ml-1.5">{accuracyDescription}</span>
          </div>
        </div>

        <div className="absolute bottom-8 left-4 right-4 flex justify-center gap-3 z-[1001] pointer-events-auto">
          {mode === 'Trk' ? (
            <button 
              onClick={startNewTracking}
              disabled={!currentPos}
              className={`flex items-center gap-3 px-10 py-4 ${currentPos ? 'bg-red-600 active:bg-red-700 border-red-800' : 'bg-slate-700 cursor-not-allowed border-slate-800'} text-white rounded-2xl font-black text-lg shadow-xl active:translate-y-1 transition-all border-b-4`}
            >
              <RotateCcw size={20} />
              START NEW
            </button>
          ) : (
            <div className="flex gap-2 w-full max-w-sm">
              <button 
                onClick={startNewGreen}
                disabled={!currentPos}
                className={`flex-1 flex flex-col items-center justify-center gap-1 py-3.5 ${currentPos ? 'bg-emerald-600 border-emerald-800 shadow-emerald-900/20' : 'bg-slate-700 border-slate-800 cursor-not-allowed'} text-white rounded-2xl font-black shadow-lg active:translate-y-1 transition-all border-b-4`}
              >
                <Trees size={18} />
                <span className="text-[9px] uppercase tracking-tighter">New Green</span>
              </button>
              <button 
                onMouseDown={() => toggleBunker(true)}
                onMouseUp={() => toggleBunker(false)}
                onTouchStart={(e) => { e.preventDefault(); toggleBunker(true); }}
                onTouchEnd={(e) => { e.preventDefault(); toggleBunker(false); }}
                className={`flex-1 flex flex-col items-center justify-center gap-1 py-3.5 ${mapping.isBunkerActive ? 'bg-amber-400 text-black border-amber-600' : 'bg-slate-700 text-white border-slate-900'} rounded-2xl font-black shadow-lg transition-all border-b-4`}
              >
                <ShieldAlert size={18} />
                <span className="text-[9px] uppercase tracking-tighter">Bunker</span>
              </button>
              <button 
                onClick={closeMapping}
                className="flex-1 flex flex-col items-center justify-center gap-1 py-3.5 bg-blue-600 text-white rounded-2xl font-black shadow-lg active:translate-y-1 transition-all border-b-4 border-blue-800"
              >
                <div className="w-4 h-4 border-2 border-white rounded-sm" />
                <span className="text-[9px] uppercase tracking-tighter">Close</span>
              </button>
            </div>
          )}
        </div>
      </main>
    </div>
  );
};

export default App;