export const DISCOVERY_RADIUS_M = 50
export type GeoPoint = { latitude: number; longitude: number }
export function relativePlace(origin: GeoPoint, place: GeoPoint) {
  const radians = Math.PI / 180
  const latitude = (place.latitude - origin.latitude) * radians
  const longitude = ((place.longitude - origin.longitude + 540) % 360 - 180) * radians
  const a = Math.sin(latitude / 2) ** 2 + Math.cos(origin.latitude * radians) *
    Math.cos(place.latitude * radians) * Math.sin(longitude / 2) ** 2
  const distance = 6371008.8 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)))
  const bearing = Math.atan2(Math.sin(longitude) * Math.cos(place.latitude * radians),
    Math.cos(origin.latitude * radians) * Math.sin(place.latitude * radians) -
    Math.sin(origin.latitude * radians) * Math.cos(place.latitude * radians) * Math.cos(longitude))
  return { distance, bearing }
}
export const isFreshLocation = (capturedAt: string, now = Date.now()) => {
  const age = now - Date.parse(capturedAt)
  return Number.isFinite(age) && age >= -30000 && age <= 120000
}
