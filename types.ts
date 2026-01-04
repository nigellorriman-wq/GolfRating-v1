
export type AppMode = 'Trk' | 'Grn';
export type MapProvider = 'Google' | 'OSM';
export type UnitSystem = 'Meters' | 'Yards';
export type PointType = 'green' | 'bunker';

export interface GeoPoint {
  lat: number;
  lng: number;
  alt: number | null;
  accuracy: number;
  timestamp: number;
  type?: PointType;
}

export interface TrackingState {
  isActive: boolean;
  startPoint: GeoPoint | null;
  path: GeoPoint[];
  initialAltitude: number | null;
  currentAltitude: number | null;
  altSource: string;
}

export interface MappingState {
  isActive: boolean;
  isBunkerActive: boolean;
  points: GeoPoint[];
  isClosed: boolean;
}
