/** Same scale and horizontal rhythm as the demo; gallery slots never alter GPS. */
export function ownMemoryPosition(index: number, count: number, compact = false) {
  const columns = compact ? 1 : Math.min(3, Math.max(1, count))
  const rows = Math.ceil(count / columns)
  const row = Math.floor(index / columns)
  const rowCount = Math.min(columns, count - row * columns)
  const x = (index % columns - (rowCount - 1) / 2) * 0.6325
  return { x, y: ((rows - 1) / 2 - row) * 0.54, z: -1.5 - Math.abs(x) * 0.06 }
}
