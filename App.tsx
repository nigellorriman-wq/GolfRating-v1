
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
import { Ruler, Map as MapIcon, RotateCcw, Activity, Trees } from 'lucide-react';

// Fix for default marker icons in Leaflet when using ESM
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

// Custom red icon for start marker
const redIcon = new L.Icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41]
});

// Custom blue icon for current position
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
        map.setView([currentPos.lat, currentPos.lng], 21);
      }
    }
  }, [points, currentPos, mode, isTracking, map]);

  return null;
};

const App: React.FC = () => {
  const [mode, setMode] = useState<AppMode>('Trk');
  const [mapProvider, setMapProvider] = useState<MapProvider>('Google');
  const [units, setUnits] = useState<UnitSystem>('Yards');
  
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

    setCurrentPos(newPoint);

    if (tracking.isActive) {
      setTracking(prev => {
        const lastInPath = prev.path[prev.path.length - 1];
        if (lastInPath && calculateDistance(lastInPath, newPoint) < 0.1) return prev;
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
  }, [tracking.isActive, mapping.isActive, mapping.isClosed]);

  useEffect(() => {
    watchId.current = navigator.geolocation.watchPosition(
      handlePositionUpdate,
      (err) => console.error(err),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 5000 }
    );
    return () => {
      if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current);
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
      altSource: tracking.altSource === 'Barometer' ? 'Barometer' : 'GPS'
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
    setMapping(prev => ({ ...prev, isBunkerActive: active }));
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
    : "No Signal";

  return (
    <div className="flex flex-col h-screen w-full select-none bg-slate-900 font-sans">
      <header className="p-4 flex flex-wrap items-center justify-between gap-2 border-b border-slate-700 bg-slate-800/80 backdrop-blur-md sticky top-0 z-[1000]">
        <div className="flex items-center gap-2">
          <button 
            onClick={() => setMode('Trk')}
            className={`px-4 py-2 rounded-lg font-bold transition-all ${mode === 'Trk' ? 'bg-blue-600 text-white shadow-lg' : 'bg-slate-700 text-slate-300'}`}
          >
            Trk
          </button>
          <button 
            onClick={() => {
              setMode('Grn');
              setTracking(prev => ({ ...prev, isActive: false }));
            }}
            className={`px-4 py-2 rounded-lg font-bold transition-all ${mode === 'Grn' ? 'bg-emerald-600 text-white shadow-lg' : 'bg-slate-700 text-slate-300'}`}
          >
            Grn
          </button>
        </div>

        <div className="flex items-center gap-2">
          <button 
            onClick={() => setMapProvider(p => p === 'Google' ? 'OSM' : 'Google')}
            className="p-2 bg-slate-700 rounded-lg hover:bg-slate-600 flex items-center gap-2 transition-colors"
          >
            <MapIcon size={18} />
            <span className="text-xs uppercase font-bold">{mapProvider}</span>
          </button>
          <button 
            onClick={() => setUnits(u => u === 'Meters' ? 'Yards' : 'Meters')}
            className="p-2 bg-slate-700 rounded-lg hover:bg-slate-600 flex items-center gap-2 transition-colors"
          >
            <Ruler size={18} />
            <span className="text-xs uppercase font-bold">{units}</span>
          </button>
        </div>
      </header>

      <main className="flex-1 relative overflow-hidden">
        <MapContainer 
          center={currentPos ? [currentPos.lat, currentPos.lng] : [0,0]} 
          zoom={21} 
          className="h-full w-full"
          zoomControl={false}
          attributionControl={false}
        >
          {mapProvider === 'OSM' ? (
            <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
          ) : (
            <TileLayer url="https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}" />
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
                <Polyline positions={tracking.path.map(p => [p.lat, p.lng])} color="red" weight={4} />
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
                        weight={5} 
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

        <div className="absolute top-4 left-4 right-4 pointer-events-none flex flex-col gap-4 z-[1001]">
          {mode === 'Trk' && (
            <div className="bg-slate-900/90 backdrop-blur-md p-4 rounded-2xl border border-slate-700/50 shadow-2xl flex justify-between">
              <div className="text-center flex-1 border-r border-slate-700/50">
                <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mb-1">Distance</p>
                <p className="text-3xl font-black text-blue-400">
                  {toDisplayDistance(totalDistance, units)} <span className="text-sm font-bold opacity-70">{units === 'Yards' ? 'yd' : 'm'}</span>
                </p>
              </div>
              <div className="text-center flex-1">
                <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mb-1">Elev Δ</p>
                <p className="text-3xl font-black text-amber-400">
                  {toDisplayElevation(elevationChange, units)} <span className="text-sm font-bold opacity-70">{units === 'Yards' ? 'ft' : 'm'}</span>
                </p>
              </div>
            </div>
          )}

          {mode === 'Grn' && mapMetrics && (
             <div className="bg-slate-900/90 backdrop-blur-md p-4 rounded-2xl border border-slate-700/50 shadow-2xl grid grid-cols-2 gap-4">
               <div className="bg-slate-800/50 p-2 rounded-xl border border-slate-700/30">
                 <p className="text-[10px] text-slate-400 font-bold uppercase">Total Perimeter</p>
                 <p className="text-xl font-black text-emerald-400">{toDisplayDistance(mapMetrics.totalLen, units)} {units === 'Yards' ? 'yd' : 'm'}</p>
               </div>
               <div className="bg-slate-800/50 p-2 rounded-xl border border-slate-700/30">
                 <p className="text-[10px] text-slate-400 font-bold uppercase">Bunker Length</p>
                 <p className="text-xl font-black text-amber-400">{toDisplayDistance(mapMetrics.bunkerLen, units)} {units === 'Yards' ? 'yd' : 'm'}</p>
               </div>
               <div className="bg-slate-800/50 p-2 rounded-xl border border-slate-700/30">
                 <p className="text-[10px] text-slate-400 font-bold uppercase">Area Inside</p>
                 <p className="text-xl font-black text-blue-400">
                   {units === 'Yards' ? (mapMetrics.area * 1.196).toFixed(0) : mapMetrics.area.toFixed(0)} 
                   <span className="text-xs font-bold opacity-70"> {units === 'Yards' ? 'sq yd' : 'm²'}</span>
                 </p>
               </div>
               <div className="bg-slate-800/50 p-2 rounded-xl border border-slate-700/30">
                 <p className="text-[10px] text-slate-400 font-bold uppercase">Bunker Ratio</p>
                 <p className="text-xl font-black text-red-400">{mapMetrics.bunkerPct.toString()}%</p>
               </div>
             </div>
          )}
        </div>

        <div className="absolute bottom-28 right-4 bg-slate-900/80 p-3 rounded-2xl border border-slate-700/50 backdrop-blur-md text-[10px] flex flex-col gap-2 z-[1001] shadow-xl">
          <div className="flex items-center gap-2">
            <Activity size={12} className="text-blue-400" />
            <span className="text-slate-300 font-bold">Source: {tracking.altSource}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${currentPos && currentPos.accuracy < 2 ? 'bg-emerald-500' : currentPos && currentPos.accuracy <= 5 ? 'bg-yellow-500' : 'bg-red-500'}`} />
            <span className="text-slate-200 font-bold">{accuracyDescription}</span>
          </div>
          <div className="border-t border-slate-700/50 pt-1 mt-1 text-slate-400">
            Acc: {currentPos ? currentPos.accuracy.toFixed(1) : '0.0'}m
          </div>
        </div>

        <div className="absolute bottom-8 left-4 right-4 flex justify-center gap-4 z-[1001]">
          {mode === 'Trk' ? (
            <button 
              onClick={startNewTracking}
              className="group flex items-center gap-3 px-10 py-5 bg-red-600 hover:bg-red-500 text-white rounded-full font-black text-lg shadow-[0_0_30px_rgba(220,38,38,0.4)] transition-all active:scale-95"
            >
              <RotateCcw size={24} />
              START NEW
            </button>
          ) : (
            <div className="flex gap-2 w-full max-w-lg">
              <button 
                onClick={startNewGreen}
                className="flex-1 flex flex-col items-center justify-center gap-1 px-4 py-4 bg-emerald-600 text-white rounded-2xl font-bold shadow-xl active:scale-95 transition-all"
              >
                <Trees size={24} />
                <span className="text-sm">NEW GREEN</span>
              </button>
              <button 
                onMouseDown={() => toggleBunker(true)}
                onMouseUp={() => toggleBunker(false)}
                onTouchStart={() => toggleBunker(true)}
                onTouchEnd={() => toggleBunker(false)}
                className={`flex-1 flex flex-col items-center justify-center gap-1 px-4 py-4 ${mapping.isBunkerActive ? 'bg-amber-400 text-black' : 'bg-slate-700 text-white'} rounded-2xl font-bold shadow-xl transition-all`}
              >
                <div className="w-6 h-6 rounded-full border-2 border-current" />
                <span className="text-sm">BUNKER</span>
              </button>
              <button 
                onClick={closeMapping}
                className="flex-1 flex flex-col items-center justify-center gap-1 px-4 py-4 bg-blue-600 text-white rounded-2xl font-bold shadow-xl active:scale-95 transition-all"
              >
                <div className="w-6 h-6 border-2 border-white rounded-sm" />
                <span className="text-sm">CLOSE</span>
              </button>
            </div>
          )}
        </div>
      </main>
    </div>
  );
};

export default App;
