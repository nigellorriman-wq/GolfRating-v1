import { GeoPoint, UnitSystem } from '../types.ts';

export const calculateDistance = (p1: GeoPoint, p2: GeoPoint): number => {
  const R = 6371e3; // metres
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

export const toDisplayDistance = (meters: number, unit: UnitSystem): string => {
  const value = unit === 'Meters' ? meters : meters * 1.09361;
  return value.toFixed(1);
};

export const toDisplayElevation = (meters: number, unit: UnitSystem): string => {
  // Requirement: Elevation in Feet or Meters
  const value = unit === 'Meters' ? meters : meters * 3.28084;
  return value.toFixed(1);
};

export const calculatePolygonArea = (points: GeoPoint[]): number => {
  if (points.length < 3) return 0;
  
  // Shoelace formula for area on planar projection (suitable for small golf greens)
  // Converting lat/lng to approximate meters relative to the first point
  const R = 6371e3;
  const lat0 = points[0].lat * Math.PI / 180;
  
  const coords = points.map(p => ({
    x: p.lng * Math.PI / 180 * R * Math.cos(lat0),
    y: p.lat * Math.PI / 180 * R
  }));

  let area = 0;
  for (let i = 0; i < coords.length; i++) {
    const j = (i + 1) % coords.length;
    area += coords[i].x * coords[j].y;
    area -= coords[j].x * coords[i].y;
  }
  return Math.abs(area) / 2;
};

export const getAccuracyColor = (accuracy: number): string => {
  if (accuracy < 2) return 'rgba(34, 197, 94, 0.4)'; // Green
  if (accuracy <= 5) return 'rgba(234, 179, 8, 0.4)'; // Yellow
  return 'rgba(239, 68, 68, 0.4)'; // Red
};