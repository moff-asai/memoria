const imageFiles = import.meta.glob<string>(
  "/public/assets-{1,2,3}/**/*.{avif,jpg,jpeg,png,webp,gif,svg,AVIF,JPG,JPEG,PNG,WEBP,GIF,SVG}",
  { eager: true, query: "?url", import: "default" },
)

export function getSphereImageSources(
  directory: "assets-1" | "assets-2" | "assets-3",
) {
  return Object.entries(imageFiles)
    .filter(([path]) => path.startsWith(`/public/${directory}/`))
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, url]) => url)
}
