export type Memory = {
  id: string
  title: string
  createdAt: string
  photos: string[]
}

// The demo uses bundled sample photos. Shared posts belong to the camera experience.
export const fetchMemories = async (): Promise<Memory[]> => []

// Downscale before display and upload: the scene only needs modest resolution,
// and camera originals can exhaust GPU memory on phones and headsets.
export const shrinkPhoto = (file: File, maxSide = 1600) =>
  new Promise<Blob>((resolve) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight))
      const canvas = document.createElement("canvas")
      canvas.width = Math.round(img.naturalWidth * scale)
      canvas.height = Math.round(img.naturalHeight * scale)
      canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height)
      canvas.toBlob((blob) => resolve(blob ?? file), "image/jpeg", 0.86)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      resolve(file)
    }
    img.src = url
  })

export const saveMemory = async (
  _id: string,
  _title: string,
  _blobs: Blob[],
): Promise<Memory> => {
  throw new Error("写真を場所に残すには「場所の思い出」タブを使用してください。デモからのDB公開は停止しています。")
}
