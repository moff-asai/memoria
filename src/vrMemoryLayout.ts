import * as THREE from "three"

/** Keep the web layout, but anchor it once to the first tracked VR head pose. */
export function createVRMemoryLayout() {
  const transform = new THREE.Matrix4()
  const webOrigin = new THREE.Matrix4().makeTranslation(0, -1.5, 0)
  const heading = new THREE.Euler(0, 0, 0, "YXZ")
  const rotation = new THREE.Quaternion()
  const scale = new THREE.Vector3(1, 1, 1)
  let pending = false

  return {
    get pending() {
      return pending
    },
    begin() {
      transform.identity()
      pending = true
    },
    /** Called only with a valid tracked pose; later head motion leaves it fixed. */
    capture(position: THREE.Vector3, orientation: THREE.Quaternion) {
      if (!pending) return
      heading.setFromQuaternion(orientation, "YXZ")
      rotation.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, heading.y)
      transform.compose(position, rotation, scale).multiply(webOrigin)
      pending = false
    },
    position(home: THREE.Vector3, target: THREE.Vector3) {
      return target.copy(home).applyMatrix4(transform)
    },
    reset() {
      pending = false
      transform.identity()
    },
  }
}
