# Scottish Golf Course Rating Toolkit v2

A high-precision measurement tool designed for personal golf course assessment.

## Features

### 1. Distance Tracker (with Pivots)
- **Real-time GNSS Tracking**: Measures horizontal distance and elevation change.
- **Pivot Points**: Support for up to 3 pivot points to measure dog-legs or multi-stage holes.
- **Elevation Delta**: Tracks vertical movement from start to finish.

### 2. Green Mapper
- **Area Calculation**: Walk the perimeter of a green to calculate its total square footage/yardage.
- **Bunker Integration**: Hold the "Bunker" button while walking specific sections to track bunker length and percentage of the total perimeter.
- **Automatic Closing**: The tool detects when you've returned to the starting point to finalize the shape.

## Tech Stack
- **React / TypeScript**
- **Leaflet**: High-performance mapping and satellite overlays.
- **Tailwind CSS**: Modern, mobile-first UI.
- **Lucide**: Clean iconography.

## Deployment
This is a single-page application (SPA) that stores history locally on the device using `localStorage`.
