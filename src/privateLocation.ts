export type LocationSample = {
  latitude: number
  longitude: number
  accuracy_m: number
  captured_at: string
}

export function locationSample(position: Pick<GeolocationPosition, "coords" | "timestamp">): LocationSample {
  const { latitude, longitude, accuracy } = position.coords
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
    !Number.isFinite(longitude) || longitude < -180 || longitude > 180 ||
    !Number.isFinite(accuracy) || accuracy < 0 || accuracy > 100000 ||
    !Number.isFinite(position.timestamp) || position.timestamp <= 0) {
    throw new Error("取得した位置情報を確認できませんでした。もう一度お試しください。")
  }
  return { latitude, longitude, accuracy_m: accuracy, captured_at: new Date(position.timestamp).toISOString() }
}

export const requestPosition = () => new Promise<GeolocationPosition>((resolve, reject) => {
  if (!window.isSecureContext || !navigator.geolocation) {
    reject(new Error("位置情報はHTTPSまたはlocalhostの対応ブラウザーで利用できます。"))
    return
  }
  navigator.geolocation.getCurrentPosition(resolve, (error) => reject(new Error(
    error.code === 1 ? "位置情報が許可されていません。ブラウザーの設定を確認してください。"
      : error.code === 3 ? "現在地の取得に時間がかかっています。場所を変えて再度お試しください。"
      : "現在地を取得できませんでした。")),
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 })
})
