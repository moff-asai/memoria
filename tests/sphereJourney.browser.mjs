import assert from "node:assert/strict"
import { readdir, writeFile } from "node:fs/promises"
import { resolve } from "node:path"

// Run against the existing preview and a Chromium remote-debugging endpoint.
const preview = process.env.MEMORIA_URL ?? "http://localhost:3000"
const cdp = process.env.CDP_URL ?? "http://localhost:9222"
const target = await fetch(`${cdp}/json/new?about:blank`, {
  method: "PUT",
}).then((response) => response.json())
const socket = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((done) =>
  socket.addEventListener("open", done, { once: true }),
)
let id = 0
const pending = new Map()
const errors = []
socket.addEventListener("message", ({ data }) => {
  const message = JSON.parse(data)
  if (message.id) {
    const handler = pending.get(message.id)
    pending.delete(message.id)
    if (message.error) handler.reject(new Error(JSON.stringify(message.error)))
    else handler.resolve(message.result)
  } else if (message.method === "Runtime.exceptionThrown") {
    errors.push(
      message.params.exceptionDetails.exception?.description ??
        message.params.exceptionDetails.text,
    )
  } else if (
    message.method === "Runtime.consoleAPICalled" &&
    message.params.type === "error"
  ) {
    errors.push(
      message.params.args.map((arg) => arg.value ?? arg.description).join(" "),
    )
  }
})
const call = (method, params = {}) =>
  new Promise((done, reject) => {
    pending.set(++id, { resolve: done, reject })
    socket.send(JSON.stringify({ id, method, params }))
  })
const evaluate = async (expression) => {
  const result = await call("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  })
  if (result.exceptionDetails) {
    throw new Error(
      result.exceptionDetails.exception?.description ??
        result.exceptionDetails.text,
    )
  }
  return result.result.value
}
const waitFor = async (expression) => {
  const start = Date.now()
  while (Date.now() - start < 45000) {
    if (await evaluate(expression)) return
    await new Promise((done) => setTimeout(done, 150))
  }
  throw new Error(`Timed out: ${expression}`)
}
const clickAt = async (point) => {
  assert(point, "click target exists")
  await call("Input.dispatchMouseEvent", {
    type: "mousePressed",
    ...point,
    button: "left",
    clickCount: 1,
  })
  await call("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    ...point,
    button: "left",
    clickCount: 1,
  })
}
const camera = `window.__scene.getObjectByName("MemoryCamera")`
const project = (objectExpression) =>
  evaluate(`(() => {
    const scene = window.__scene;
    scene.updateMatrixWorld(true);
    const object = ${objectExpression};
    if (!object) return null;
    const point = object.getWorldPosition(object.position.clone()).project(${camera});
    return {x: (point.x + 1) * innerWidth / 2, y: (1 - point.y) * innerHeight / 2};
  })()`)
const pause = (ms) => new Promise((done) => setTimeout(done, ms))
const clickObject = async (objectExpression) =>
  clickAt(await project(objectExpression))
// Ring fragments and 3D tabs ease in; retry until the click lands.
const clickUntil = async (objectExpression, condition, press = clickAt) => {
  for (let attempt = 0; attempt < 15; attempt++) {
    const point = await project(objectExpression)
    if (point) await press(point)
    // Software-rendered frames can be slow; let the click land before retrying.
    for (const started = Date.now(); Date.now() - started < 2500; ) {
      if (await evaluate(condition)) return
      await new Promise((done) => setTimeout(done, 150))
    }
  }
  throw new Error(`Click never satisfied: ${condition}`)
}
const clickButton = (selector) =>
  evaluate(`(() => {
  const button = document.querySelector(${JSON.stringify(selector)});
  if (!button) throw new Error("Missing button: " + ${JSON.stringify(selector)});
  button.click();
})()`)
const mode = (name) =>
  `document.querySelector(".app")?.dataset.mode === "${name}"`
const dockInert = 'document.querySelector(".ov-dock")?.inert === true'
const shown = (name) => `(() => {
  let object = window.__scene.getObjectByName(${JSON.stringify(name)});
  if (!object) return false;
  for (; object; object = object.parent) if (!object.visible) return false;
  return true;
})()`
// 3D tabs only accept picks once they have faded in.
const tabReady = (name) =>
  `${shown(name)} && window.__scene.getObjectByName(${JSON.stringify(name)}).material.opacity > 0.9`
const ring = `window.__scene.getObjectByName("MemoryRing")`
const ringPhotos = `${ring}.children.filter(m => m.name.startsWith("MemoryPhoto-"))`
const collection = (folder) =>
  `window.__scene.getObjectByName("MemoryCollection-${folder}")`
const photoCircles = (folder) =>
  `${collection(folder)}.children.filter(m => m.isMesh && m.visible && m.children.some(c => c.isSprite))`
const visibleBubbles = (folder) =>
  `${collection(folder)}.children.filter(m => m.isMesh && m.visible && m.geometry.type === "SphereGeometry")`
// The central bubble keeps its identity even when focus shrinks it.
const mainCircle = (folder) =>
  `${collection(folder)}.children.find(mesh => mesh.name === "MemoryCore")`
const label = (folder) =>
  `window.__scene.getObjectByName("MemoryLabel-${folder}")`
const cancelButton = 'document.querySelector(".journey-cancel")'
const folders = ["assets-2", "assets-1", "assets-3"]
// The default memories are titled in their left-to-right order.
const titleOf = (folder) =>
  `記憶 ${String(folders.indexOf(folder) + 1).padStart(2, "0")}`
const crumbsNav = 'document.querySelector(".journey-crumbs")'
// The breadcrumb's crumbs, joined the way they read on screen.
const trail = `[...document.querySelectorAll(".journey-crumbs .journey-crumb-label")].map(e => e.textContent).join(" › ")`
const trailShown = `${crumbsNav}.dataset.shown === "true"`
const trailGone = `getComputedStyle(${crumbsNav}).visibility === "hidden"`
const trailSettled = `${trailShown} && getComputedStyle(${crumbsNav}).opacity === "1"`
const expectTrail = async (expectedTrail, message) => {
  const state = await evaluate(`({
    shown: ${trailShown},
    trail: ${trail},
    separators: [...document.querySelectorAll(".journey-crumbs .journey-crumb-sep")].map(e => e.textContent),
  })`)
  assert(state.shown, `${message}: the breadcrumb shows`)
  assert.equal(state.trail, expectedTrail, message)
  assert.deepEqual(
    state.separators,
    expectedTrail.split(" › ").slice(1).map(() => "›"),
    `${message}: crumbs are separated by ›`,
  )
}
const spaceFooter =
  "球体を押すと、記憶のなかへ · ドラッグで見回し、WASD・ホイール・ピンチで歩けます · 写真はみんなの空間に公開されます"
// Nothing on screen is in English except key names and VR (the logo is an
// image), and every way back — to the eye and to assistive tech — is 戻る.
const assertOnlyBack = async (where) => {
  const text = await evaluate('document.querySelector(".app").innerText')
  const latin = text.replace(/Esc|WASD|VR|HTTPS/g, "").match(/[A-Za-z]+/g)
  assert.equal(latin, null, `${where}: no English labels on screen`)
  for (const word of ["close", "memory in", "もう一度押すと", "閉じ", "やめ"]) {
    assert(!text.toLowerCase().includes(word), `${where}: no "${word}" on screen`)
  }
  const names = await evaluate(`[...document.querySelectorAll(".journey-back button")].map(button => {
    const copy = button.cloneNode(true);
    copy.querySelectorAll('[aria-hidden="true"]').forEach(node => node.remove());
    return button.getAttribute("aria-label") ?? copy.textContent.trim();
  })`)
  assert(
    names.length === 2 && names.every((name) => name === "戻る"),
    `${where}: every back button is named 戻る (${names})`,
  )
}
// The breadcrumb's pill against the logo and the VR chip.
const headerBoxes = () =>
  evaluate(`(() => {
    const box = (selector) => document.querySelector(selector).getBoundingClientRect().toJSON();
    return { crumbs: box(".journey-crumbs ol"), logo: box(".ov-brand"), chip: box(".ov-chip"), width: innerWidth };
  })()`)
const home = [0, 1.5, 0]
const atHome = `${camera}.position.distanceTo(${camera}.position.clone().fromArray(${JSON.stringify(home)})) < 1e-6`
const expected = {}
// Each memory's photos in the order the scene loads them (sorted by path).
const order = {}
for (const folder of folders) {
  order[folder] = (await readdir(`public/${folder}`))
    .filter((name) => /\.(avif|jpe?g|png|webp|gif|svg)$/i.test(name))
    .sort((left, right) => left.localeCompare(right))
  expected[folder] = order[folder].length
}
// Texture on a circle, read before it is pressed.
const circleTexture = (circle) =>
  evaluate(`${circle}.children.find(c => c.isSprite).material.map.uuid`)
// Center of `circle` on screen, once no other circle of the memory covers it.
// Bubbles overlap the main sphere, so a press at a projected center can
// otherwise land on a neighbour.
const clearPoint = (folder, circle) =>
  evaluate(`(() => {
  const scene = window.__scene;
  scene.updateMatrixWorld(true);
  const eye = ${camera};
  const focal = innerHeight / 2 / Math.tan((eye.fov * Math.PI) / 360);
  const disc = (mesh) => {
    const center = mesh.getWorldPosition(mesh.position.clone());
    const depth = -center.clone().applyMatrix4(eye.matrixWorldInverse).z;
    const point = center.clone().project(eye);
    return {
      x: (point.x + 1) * innerWidth / 2,
      y: (1 - point.y) * innerHeight / 2,
      r: (0.15 * mesh.getWorldScale(center.clone()).x * focal) / depth,
    };
  };
  const target = ${circle};
  const own = disc(target);
  const clear = ${photoCircles(folder)}
    .filter((mesh) => mesh !== target)
    .every((mesh) => {
      const other = disc(mesh);
      return Math.hypot(other.x - own.x, other.y - own.y) > other.r + 10;
    });
  return clear ? { x: own.x, y: own.y } : null;
})()`)
const clickClear = async (folder, circle, condition) => {
  await pressClear(folder, circle, condition, clickAt)
}
const tapAt = async ({ x, y }) => {
  await call("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x, y }],
  })
  await call("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] })
}
const waitForClear = async (folder, circle) => {
  let point = null
  for (const started = Date.now(); !point && Date.now() - started < 20000; ) {
    point = await clearPoint(folder, circle)
    if (!point) await pause(100)
  }
  assert(point, "the circle comes clear of its neighbours")
  return point
}
const pressClear = async (folder, circle, condition, press) => {
  for (let attempt = 0; attempt < 15; attempt++) {
    await press(await waitForClear(folder, circle))
    for (const started = Date.now(); Date.now() - started < 2500; ) {
      if (await evaluate(condition)) return
      await pause(150)
    }
  }
  throw new Error(`Press never satisfied: ${condition}`)
}
// Satellites orbit slowly, so a fixed one can sit behind a neighbour for the
// whole wait; take whichever satellite is clear now.
const clearSatellite = async (folder) => {
  for (const started = Date.now(); Date.now() - started < 20000; ) {
    for (let index = 0; index < Math.min(5, expected[folder]); index++) {
      const circle = `${photoCircles(folder)}[${index}]`
      if (await evaluate(`${circle}.name === "MemoryCore"`)) continue
      if (await clearPoint(folder, circle)) return circle
    }
    await pause(100)
  }
  throw new Error(`No ${folder} satellite comes clear of its neighbours`)
}
// Texture on the ring fragment that unfolded where the sphere was.
const leadTexture = (folder) =>
  evaluate(`(() => {
  const eye = ${camera}.position;
  const angle = (point) => Math.atan2(point.z - eye.z, point.x - eye.x);
  const origin = angle(${collection(folder)}.position);
  const gap = (a) => Math.abs(Math.atan2(Math.sin(a - origin), Math.cos(a - origin)));
  const lead = ${ringPhotos}.reduce((best, mesh) =>
    gap(angle(mesh.position)) < gap(angle(best.position)) ? mesh : best);
  return lead.children.find(c => c.isSprite)?.material.map.uuid ?? null;
})()`)
const ringIsOpen = `${mode("ring")} && Boolean(${ring}) && ${ringPhotos}.every(m => m.visible)`
// One press starts the camera glide and the surrounding cloud at the same time.
const enterInitial = async (
  folder,
  { animated = true, circle, duringApproach } = {},
) => {
  const target = circle ?? mainCircle(folder)
  const picked = await circleTexture(target)
  const tint = await evaluate(`${target}.material.color.getHexString()`)
  const previewCount = await evaluate(`${photoCircles(folder)}.length`)
  assert(previewCount >= Math.min(5, expected[folder]) && previewCount <= Math.min(7, expected[folder]))
  const origin = await evaluate(`${camera}.position.toArray()`)
  await clickClear(folder, target, `!(${mode("space")})`)
  if (animated) {
    await waitFor(`${mode("transition")} && Boolean(${ring}) &&
      ${camera}.position.distanceTo(${camera}.position.clone().fromArray(${JSON.stringify(origin)})) > 1e-4`)
    assert(await evaluate(dockInert), "the dock is inert while gliding")
    assert(await evaluate(`${ring}.userData.center.distanceTo(${camera}.position) < 1e-6`),
      "the surrounding bubbles are centered on the user during approach")
    await duringApproach?.()
  } else {
    assert(await evaluate(`Boolean(${ring})`), "reduced motion opens on the first press")
  }
  await waitFor(ringIsOpen)
  const distance = await evaluate(`${camera}.position.distanceTo(${collection(folder)}.position)`)
  assert(distance < 0.35, `viewer steps into the dispersed bubble cluster (${distance})`)
  const photos = await evaluate(`${ringPhotos}.map(m => ({
    count: m.children.filter(c => c.isSprite).length,
    texture: m.children.find(c => c.isSprite).material.map.uuid
  }))`)
  assert.equal(photos.length, expected[folder], "every photo rides the ring")
  assert(photos.every((photo) => photo.count === 1))
  assert.equal(new Set(photos.map((photo) => photo.texture)).size, photos.length)
  assert(await evaluate(`${ring}.children.filter(mesh => mesh.isMesh).every(mesh =>
    mesh.material.color.getHexString() === ${JSON.stringify(tint)})`),
    "all ring fragments keep their memory's bubble color")
  // The small previews become a floating cloud around the viewer, not a flat ring.
  await waitFor(`${ringPhotos}.every(m => {
    const eye = ${camera}.position;
    const radius = m.position.distanceTo(eye);
    const target = ${ring}.userData.entryRadius;
    return radius > target * 0.8 && radius < target * 1.2;
  })`)
  const cloud = await evaluate(`(() => {
    const center = ${camera}.position;
    const meshes = ${ring}.children.filter(mesh => mesh.isMesh);
    return {
      count: meshes.length,
      heights: meshes.map(mesh => mesh.position.y - center.y),
      radii: meshes.map(mesh => mesh.position.distanceTo(center)),
      scales: meshes.map(mesh => Math.max(mesh.scale.x, mesh.scale.y, mesh.scale.z)),
      targetRadius: ${ring}.userData.entryRadius,
    };
  })()`)
  assert.equal(cloud.count, Math.max(7, expected[folder]))
  assert(Math.max(...cloud.heights) - Math.min(...cloud.heights) > cloud.targetRadius * 0.3, "bubbles float above and below eye level")
  assert(cloud.targetRadius <= 0.6, "the cloud remains at a nearby viewing distance")
  assert(cloud.scales.every(scale => scale < 0.7), "the surrounding cloud contains only small-to-medium bubbles")
  await pause(250)
  const heldRadii = await evaluate(`${ring}.children.filter(mesh => mesh.isMesh)
    .map(mesh => mesh.position.distanceTo(${camera}.position))`)
  heldRadii.forEach((radius, index) => assert(Math.abs(radius - cloud.radii[index]) < 0.005,
    "the bubbles do not drift outward after the approach"))
  const cloudScreenshot = await call("Page.captureScreenshot", { format: "png" })
  await writeFile("/tmp/memoria-surrounding-bubbles.png", Buffer.from(cloudScreenshot.data, "base64"))
  await waitForOtherSpheres(folder, false)
  return picked
}
const waitForOtherSpheres = (folder, visible) =>
  waitFor(`${JSON.stringify(folders)}
    .filter(name => name !== ${JSON.stringify(folder)})
    .every(name => {
      const group = window.__scene.getObjectByName("MemoryCollection-" + name);
      // Hidden while the ring is open; fully grown back once it closes.
      return ${visible} ? group.visible && group.scale.x > 0.999 : !group.visible;
    })`)
// The ring wraps around the viewer; pick the photo nearest the view center.
const centerPhoto = `(() => {
  const scene = window.__scene;
  scene.updateMatrixWorld(true);
  const offset = (mesh) => {
    const point = mesh.getWorldPosition(mesh.position.clone()).project(${camera});
    return point.z > 1 ? Infinity : Math.hypot(point.x, point.y);
  };
  return ${ringPhotos}.reduce((best, mesh) => offset(mesh) < offset(best) ? mesh : best);
})()`
// A single press on a photo fragment opens it on the curved screen.
const enterPhoto = async () => {
  await clickUntil(centerPhoto, mode("photo"))
  await waitFor(shown("MemoryImmersionScreen"))
  assert(await evaluate(`(() => {
    const camera = ${camera};
    const room = window.__scene.getObjectByName("MemoryImmersion");
    const forward = new camera.position.constructor(0, 0, -1).applyQuaternion(room.quaternion);
    return forward.dot(camera.getWorldDirection(camera.position.clone())) > 0.999;
  })()`), "the photo opens along the viewing direction, including upward or downward pitch")
}
const backHome = async (folder) => {
  await waitFor(`${mode("space")} && !${ring} && ${atHome}`)
  await waitForOtherSpheres(folder, true)
  assert(
    await evaluate('document.querySelector(".ov-dock")?.inert === false'),
    "the dock accepts input again in the space",
  )
  await waitFor(trailGone)
}
// One press starts the approach; Esc or the lone 戻る button calls it off and
// the viewer glides home while the already-unfolding cloud gathers and fuses.
const cancelApproach = async (folder, cancel) => {
  await clickClear(folder, mainCircle(folder), `!(${mode("space")})`)
  // The glide lasts ~1s, so check the overlay and cancel in as few round
  // trips as possible.
  for (const started = Date.now(); ; ) {
    if (await evaluate(`${cancelButton}.dataset.shown === "true"`)) break
    assert(Date.now() - started < 5000, "the back button shows mid-approach")
    await pause(20)
  }
  const state = await evaluate(`({
    approaching: ${mode("transition")} && Boolean(${ring}),
    onlyBack: !${cancelButton}.inert && ${dockInert} &&
      document.querySelector(".journey-toolbar").inert,
    trailShown: ${trailShown},
    trail: ${trail},
  })`)
  await cancel()
  assert(state.approaching, "the back button shows while approaching")
  assert(state.onlyBack, "only the lone back button accepts input mid-approach")
  assert(state.trailShown, "the breadcrumb shows as soon as the approach starts")
  assert.equal(state.trail, `空間 › ${titleOf(folder)}`, "approaching a memory reads 空間 › title")
  await waitFor(`${cancelButton}.dataset.shown !== "true"`)
  assert(await evaluate(`${mode("transition")} && !${shown("MemoryImmersionScreen")}`),
    "cancelling retracts the cloud rather than entering a photo")
  await backHome(folder)
}
// Click the back button the way a person would: once it has faded in enough
// to see and is the element under the pointer.
const clickCancelButton = async () => {
  for (const started = Date.now(); ; ) {
    const point = await evaluate(`(() => {
      const button = ${cancelButton}.querySelector("button");
      const bounds = button.getBoundingClientRect();
      const x = bounds.left + bounds.width / 2;
      const y = bounds.top + bounds.height / 2;
      const seen = Number(getComputedStyle(${cancelButton}).opacity) > 0.5;
      return seen && button.contains(document.elementFromPoint(x, y)) ? { x, y } : null;
    })()`)
    if (point) return clickAt(point)
    assert(Date.now() - started < 3000, "the back button fades in and takes clicks")
    await pause(20)
  }
}
const escape = async () => {
  await call("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "Escape",
    code: "Escape",
    windowsVirtualKeyCode: 27,
  })
  await call("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "Escape",
    code: "Escape",
    windowsVirtualKeyCode: 27,
  })
}
const dragBy = async (dx, dy) => {
  await call("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: 700,
    y: 420,
    button: "left",
    clickCount: 1,
  })
  await call("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x: 700 + dx,
    y: 420 + dy,
    buttons: 1,
    button: "left",
  })
  await call("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: 700 + dx,
    y: 420 + dy,
    button: "left",
    clickCount: 1,
  })
}
const drag = async () => {
  const before = await evaluate(`${camera}.quaternion.toArray()`)
  const position = await evaluate(`${camera}.position.toArray()`)
  await dragBy(110, 20)
  await waitFor(
    `${camera}.quaternion.angleTo(${camera}.quaternion.clone().fromArray(${JSON.stringify(before)})) > 1e-3`,
  )
  assert.deepEqual(
    await evaluate(`${camera}.position.toArray()`),
    position,
    "dragging only looks around",
  )
}
const pressKey = async (key, code, windowsVirtualKeyCode, holdMs = 0) => {
  await call("Input.dispatchKeyEvent", { type: "keyDown", key, code, windowsVirtualKeyCode })
  if (holdMs) await pause(holdMs)
  await call("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode })
}
const wheelAt = (x, y) =>
  call("Input.dispatchMouseEvent", { type: "mouseWheel", x, y, deltaX: 0, deltaY: -400 })
// Two fingers spreading apart, the gesture that walks forward in the space.
const pinchOut = async (x, y) => {
  await call("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: x - 50, y, id: 0 }, { x: x + 50, y, id: 1 }],
  })
  for (const spread of [70, 90]) {
    await call("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: x - spread, y, id: 0 }, { x: x + spread, y, id: 1 }],
    })
  }
  await call("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] })
}
// Where the VR-only ring's 戻る sits relative to the tracked viewer.
const ringTab = `(() => {
  const scene = window.__scene;
  scene.updateMatrixWorld(true);
  const head = window.__renderer.xr.getCamera();
  const eye = head.position;
  const mesh = scene.getObjectByName("MemoryRingTab-back");
  const offset = mesh.getWorldPosition(eye.clone()).sub(eye);
  const forward = new eye.constructor(0, 0, -1).applyQuaternion(head.quaternion);
  forward.y = 0;
  forward.normalize();
  return {
    drop: -offset.y,
    ahead: offset.x * forward.x + offset.z * forward.z,
    side: Math.abs(offset.x * forward.z - offset.z * forward.x),
    facing: mesh.getWorldDirection(eye.clone()).dot(offset.clone().negate().normalize()),
  };
})()`
const atFeet = (tab) =>
  Math.abs(tab.drop - 1.0) < 0.02 &&
  Math.abs(tab.ahead - 0.7) < 0.02 &&
  tab.side < 0.02 &&
  tab.facing > 0.999
const waitForTabAtFeet = async (message) => {
  let tab
  for (const started = Date.now(); Date.now() - started < 8000; await pause(100)) {
    tab = await evaluate(ringTab)
    if (atFeet(tab)) return
  }
  assert.fail(`${message} (${JSON.stringify(tab)})`)
}
// The 3D 戻る rests 55° below the horizon; look down until it sits mid-screen.
const lookDown = async () => {
  const pitch = await evaluate(`${camera}.rotation.x`)
  await dragBy(0, -220)
  await waitFor(`${camera}.rotation.x < ${pitch - 0.8}`)
}
// The curved screen, the photo on it, and how far it has faded and unrolled.
const screen = 'window.__scene.getObjectByName("MemoryImmersionScreen")'
const screenState = `(() => {
  const { userData, material } = ${screen};
  return {
    src: userData.src ?? null,
    opacity: material.uniforms.opacity.value,
    reveal: material.uniforms.reveal.value,
  };
})()`
const shownIndex = async (folder) => {
  const { src } = await evaluate(screenState)
  return order[folder].findIndex((name) => src?.includes(name))
}
// `index` is on screen, fully unrolled at full opacity.
const showing = (folder, index) => `(() => {
  const { userData, material } = ${screen};
  return Boolean(userData.src?.includes(${JSON.stringify(order[folder][index])})) &&
    material.uniforms.reveal.value >= 1 && material.uniforms.opacity.value > 0.999;
})()`
// Web arrows reflect the photo bounds; all 3D controls stay hidden.
const waitForNav = (folder, index) =>
  waitFor(`(() => {
    const button = (side) => document.querySelector('.photo-nav-button[data-side="' + side + '"]');
    const previous = ${index} > 0;
    const next = ${index} < ${expected[folder] - 1};
    return getComputedStyle(document.querySelector(".photo-nav")).visibility === "visible" &&
      button("previous").disabled === !previous && button("next").disabled === !next &&
      !(${shown("MemoryTab-previous")}) && !(${shown("MemoryTab-next")}) &&
      !(${shown("MemoryTab-back")}) && !(${shown("MemoryRingTab-back")});
  })()`)
const arrowKey = (step) =>
  step > 0
    ? pressKey("ArrowRight", "ArrowRight", 39)
    : pressKey("ArrowLeft", "ArrowLeft", 37)
// A real click on an edge arrow, which must be the element under the pointer.
const clickNavButton = async (side) => {
  const point = await evaluate(`(() => {
    const button = document.querySelector('.photo-nav-button[data-side="${side}"]');
    const bounds = button.getBoundingClientRect();
    const x = bounds.left + bounds.width / 2;
    const y = bounds.top + bounds.height / 2;
    return button.contains(document.elementFromPoint(x, y)) ? { x, y } : null;
  })()`)
  assert(point, `the ${side} arrow sits on top at the screen's edge`)
  await clickAt(point)
}
// Every frame of one switch, from the press until the next photo has unrolled.
const recordSwitch = async (press, folder, index) => {
  await evaluate(`(() => {
    const frames = (window.__switchFrames = []);
    const tick = () => {
      frames.push({ at: performance.now(), ...${screenState} });
      window.__switchRecording = requestAnimationFrame(tick);
    };
    window.__switchRecording = requestAnimationFrame(tick);
  })()`)
  await press()
  await waitFor(showing(folder, index))
  return evaluate(`(() => {
    cancelAnimationFrame(window.__switchRecording);
    return window.__switchFrames;
  })()`)
}
// Horizontal angle between where the viewer looks and the ring's photo `index`.
const photoOffAhead = (index) =>
  evaluate(`(() => {
    const scene = window.__scene;
    scene.updateMatrixWorld(true);
    const eye = ${camera}.position;
    const forward = new eye.constructor(0, 0, -1).applyQuaternion(${camera}.quaternion);
    forward.y = 0;
    const to = ${ring}.getObjectByName("MemoryPhoto-${index}").getWorldPosition(eye.clone()).sub(eye);
    to.y = 0;
    return forward.angleTo(to);
  })()`)
// A one-finger horizontal gesture lasting `seconds`. Explicit timestamps keep
// its pace independent of how slowly a software-rendered page acks input.
const swipeAcross = async (fromX, toX, y, seconds = 0.15) => {
  const startedAt = Date.now() / 1000
  await call("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: fromX, y }],
    timestamp: startedAt,
  })
  for (const part of [1 / 3, 2 / 3, 1]) {
    await call("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: fromX + (toX - fromX) * part, y }],
      timestamp: startedAt + seconds * 0.8 * part,
    })
  }
  await call("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
    timestamp: startedAt + seconds,
  })
}
const xr = "window.__renderer.xr"
const panel = 'window.__scene.getObjectByName("VRGuidePanel")'
const vrToast = 'window.__scene.getObjectByName("VRGuideToast")'
const panelGuide = () => evaluate(`${panel}.userData.guide`)
// No headset here: present by hand, hold the head still, and aim
// controller 0 with a ray straight at the target before pulling its trigger.
const setHead = (yaw, { position = [0, 1.5, 0], pitch = 0 } = {}) =>
  evaluate(`(() => {
    const head = ${xr}.getCamera();
    head.position.fromArray(${JSON.stringify(position)});
    head.rotation.order = "YXZ";
    head.rotation.set(${pitch}, ${yaw}, 0);
    head.updateMatrixWorld(true);
  })()`)
const triggerAt = (targetExpression) =>
  evaluate(`(() => {
    const scene = window.__scene;
    scene.updateMatrixWorld(true);
    const target = ${targetExpression};
    if (!target) return null;
    const controller = ${xr}.getController(0);
    const V = controller.position.constructor;
    controller.position.set(0.15, 1.3, -0.1);
    const ray = target.getWorldPosition(new V()).sub(controller.position).normalize();
    controller.quaternion.setFromUnitVectors(new V(0, 0, -1), ray);
    // XR controllers take their matrix from the pose, never auto-updating.
    controller.updateMatrix();
    controller.updateMatrixWorld(true);
    controller.dispatchEvent({ type: "selectstart" });
    return true;
  })()`)
const triggerUntil = (targetExpression, condition) =>
  clickUntil(targetExpression, condition, () => triggerAt(targetExpression))
// three.js's renderer listens first and hands its loop to the XR session,
// which never comes without a headset; only the app's listeners run here.
const startSession = (before = "") =>
  evaluate(`(() => {
    ${before}
    const xr = ${xr};
    xr.getReferenceSpace = () => ({});
    xr.isPresenting = true;
    xr._listeners.sessionstart.slice(1).forEach((listener) =>
      listener.call(xr, { type: "sessionstart", target: xr }));
    return ${JSON.stringify(folders)}.map(folder =>
      window.__scene.getObjectByName("MemoryCollection-" + folder).visible);
  })()`)
const vrMode = (name) => `${mode(name)} && ${panel}.userData.guide.lines[0] !== "移動中…"`
try {
  await call("Runtime.enable")
  await call("Page.enable")
  await call("Page.addScriptToEvaluateOnNewDocument", {
    source: `
      window.__THREE_DEVTOOLS__ = new EventTarget();
      window.__THREE_DEVTOOLS__.addEventListener("observe", event => {
        if (event.detail.isScene) window.__scene = event.detail;
        if (event.detail.isWebGLRenderer) {
          const renderer = window.__renderer = event.detail;
          const setLoop = renderer.setAnimationLoop.bind(renderer);
          renderer.setAnimationLoop = callback => setLoop(callback && ((time, frame) => {
            if (renderer.xr.isPresenting && !frame) {
              frame = { getViewerPose: () => window.__tracking === false ? null : {
                transform: {
                  position: renderer.xr.getCamera().position,
                  orientation: renderer.xr.getCamera().quaternion
                }
              }};
            }
            callback(time, frame);
            if (window.__splitFrames) {
              const group = window.__scene?.getObjectByName("MemoryCollection-assets-1");
              const core = group?.children.find(mesh => mesh.name === "MemoryCore");
              const surface = group?.getObjectByName("MemoryMembranes")?.children.find(mesh => mesh.visible);
              const bud = group?.children.find(mesh => mesh.name === "MemoryPreview-5");
              if (core && bud) {
                window.__splitFrames.push({
                  fluid: Boolean(surface),
                  vertices: surface?.geometry.drawRange.count ?? 0,
                  shellOpacity: core.material.opacity,
                  coreScale: core.scale.x,
                  budScale: bud.scale.x,
                  budDistance: bud.position.length(),
                });
                if (surface && bud.scale.x > 0.05 && core.material.opacity < 0.1 && !window.__midSplitImage) {
                  window.__midSplitImage = renderer.domElement.toDataURL("image/png");
                }
              }
            }
          }));
        }
      });
      const originalFetch = window.fetch;
      window.fetch = (input, options) => {
        const url = typeof input === "string" ? input : input.url;
        if (url?.includes("/make-server-da91c8fa/memories")) {
          const fixture = {
            id: "browser-fixture", title: "Browser fixture", createdAt: "2026-01-01",
            photos: ["/assets-1/35372467_m.jpg", "/assets-2/photo-1541336528065-8f1fdc435835.avif"]
          };
          const memory = options?.method === "POST" ? {
            id: options.body.get("id"),
            title: options.body.get("title"),
            createdAt: new Date().toISOString(),
            photos: options.body.getAll("photos").map(photo => URL.createObjectURL(photo)),
          } : fixture;
          const response = new Response(JSON.stringify({memories: [fixture], memory}), {
            status: 200, headers: {"Content-Type": "application/json"}
          });
          if (window.__deferSave && options?.method === "POST") {
            return new Promise(resolve => { window.__completeSave = () => resolve(response); });
          }
          return Promise.resolve(response);
        }
        return originalFetch(input, options);
      };
      window.__worldLabels = [];
      const fillText = CanvasRenderingContext2D.prototype.fillText;
      CanvasRenderingContext2D.prototype.fillText = function(text, ...args) {
        window.__worldLabels.push(text);
        return fillText.call(this, text, ...args);
      };
    `,
  })
  await call("Emulation.setDeviceMetricsOverride", {
    width: 1400,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  })
  await call("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-motion", value: "no-preference" }],
  })
  await call("Page.navigate", { url: preview })
  await call("Page.bringToFront")
  await waitFor(`window.__scene &&
    ${JSON.stringify(folders)}.every(folder =>
      window.__scene.getObjectByName("MemoryCollection-" + folder)?.visible)`)
  // Welcome guidance appears on every visit; dismiss it before exercising the scene.
  await evaluate('document.querySelector(".ov-hero-start")?.click()')
  await waitFor('!document.querySelector(".ov-hero")')
  assert.deepEqual(
    await evaluate(`${JSON.stringify(folders)}.map(folder => {
      const { x, z } = window.__scene.getObjectByName("MemoryCollection-" + folder).position;
      return [x, z];
    })`),
    [
      [-0.6325, -1.5],
      [0, -1.5],
      [0.6325, -1.5],
    ],
    "the three default memories sit left to right as assets-2, assets-1, assets-3",
  )
  // The space shows no breadcrumb; its footer and VR button read Japanese.
  await waitFor(`document.querySelector(".ov-foot").textContent === ${JSON.stringify(spaceFooter)}`)
  await waitFor(`document.querySelector(".ov-vr").textContent.trim() !== ""`)
  assert(await evaluate(trailGone), "the space shows no breadcrumb")
  assert.match(
    await evaluate('document.querySelector(".ov-vr").textContent'),
    /^(VRで見る|VRを終了|VR非対応|VRを利用できません|VRにはHTTPS接続が必要です|このブラウザーはVR非対応)$/,
    "the VR button reads Japanese",
  )
  await assertOnlyBack("space")
  for (const folder of folders) {
    const circles = await evaluate(`${photoCircles(folder)}.map(m =>
      m.children.find(c => c.isSprite).material.map.uuid)`)
    assert.equal(circles.length, Math.min(5, expected[folder]), `${folder}: at most five photo previews`)
    assert.equal(
      await evaluate(`${visibleBubbles(folder)}.length`),
      5,
      `${folder}: the reference silhouette always has five bubbles`,
    )
    assert.equal(new Set(circles).size, circles.length)
    assert(await evaluate(`(() => {
      const group = ${collection(folder)};
      const films = group.getObjectByName("MemoryMembranes")?.children.filter(surface => surface.visible);
      const shells = ${visibleBubbles(folder)};
      return films?.length === 1 && shells.every(mesh => mesh.material.opacity < 0.001);
    })()`), `${folder}: resting overlaps use one continuous film, without individual inner shells`)
    assert(await evaluate(`(() => {
      const meshes = ${collection(folder)}.children.filter(mesh => mesh.isMesh);
      return meshes.every(mesh => mesh.material.color.equals(meshes[0].material.color));
    })()`), `${folder}: central bubble, satellites, and fusion share one tint`)
  }
  const bubbleColors = await evaluate(`${JSON.stringify(folders)}.map(folder =>
    window.__scene.getObjectByName("MemoryCollection-" + folder).children
      .find(mesh => mesh.isMesh).material.color.getHexString())`)
  assert.equal(new Set(bubbleColors).size, folders.length, "the default memories have different colors")
  const clusterScreenshot = await call("Page.captureScreenshot", { format: "png" })
  await writeFile(
    "/tmp/memoria-clusters.png",
    Buffer.from(clusterScreenshot.data, "base64"),
  )

  // Hover disperses the large core into a seven-bubble, small-to-medium cluster.
  await evaluate("window.__splitFrames = []; window.__midSplitImage = null")
  await call("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    ...(await waitForClear("assets-1", mainCircle("assets-1"))),
  })
  await waitFor(`${collection("assets-1")}.scale.x > 1.0799 &&
    ${label("assets-1")}.material.opacity > 0.999`)
  const hover = await evaluate(`(() => {
    const group = ${collection("assets-1")};
    const tag = ${label("assets-1")};
    const eye = ${camera}.position;
    // The resting place is (0, ·, -1.5); bobbing only moves it vertically.
    const lean = new eye.constructor(group.position.x, 0, group.position.z + 1.5);
    const toEye = new eye.constructor(eye.x, 0, eye.z + 1.5).normalize();
    return {
      scale: group.scale.x,
      lean: lean.length(),
      toward: lean.clone().normalize().dot(toEye),
      below: group.position.y - tag.position.y,
      labelShown: tag.visible,
      others: ${JSON.stringify(folders)}.filter(f => f !== "assets-1").every(f =>
        window.__scene.getObjectByName("MemoryCollection-" + f).scale.x < 1.0001 &&
        !window.__scene.getObjectByName("MemoryLabel-" + f).visible),
      inSpace: ${mode("space")},
      bubbles: ${visibleBubbles("assets-1")}.map(mesh =>
        Math.max(mesh.scale.x, mesh.scale.y, mesh.scale.z)),
    };
  })()`)
  assert(Math.abs(hover.scale - 1.08) < 1e-3, `hovered memory grows 1.08× (${hover.scale})`)
  assert(
    hover.lean > 0.045 && hover.lean < 0.0501 && hover.toward > 0.99,
    `hovered memory leans 5cm toward the viewer (${JSON.stringify(hover)})`,
  )
  assert(hover.labelShown && hover.below > 0.3, "the label sits under the memory")
  assert(hover.others, "only the hovered memory reacts")
  assert(hover.inSpace, "hovering never selects or enters")
  assert.equal(hover.bubbles.length, 7, "hover shows seven bubbles")
  assert(hover.bubbles.every(scale => scale < 0.65), "hover leaves no large bubble")
  const splitFrames = await evaluate("window.__splitFrames")
  assert(splitFrames.some(frame => frame.fluid && frame.vertices > 0 && frame.shellOpacity < 0.1),
    "splitting uses a continuous fluid membrane, not separately scaled circles")
  assert(splitFrames.some(frame => frame.fluid && frame.coreScale > 0.8 && frame.budScale > 0.05 && frame.budDistance < 0.08),
    "small bubbles grow within the large parent before detaching")
  const splitImage = await evaluate("window.__midSplitImage")
  assert(splitImage, "the splitting membrane was rendered")
  await writeFile("/tmp/memoria-splitting-membrane.png", Buffer.from(splitImage.split(",")[1], "base64"))
  await evaluate("window.__splitFrames = null")
  assert(
    await evaluate(`window.__worldLabels.includes("記憶 02") &&
      window.__worldLabels.includes("${expected["assets-1"]}枚の写真")`),
    "the label reads the title, then the photo count",
  )
  const dispersedScreenshot = await call("Page.captureScreenshot", { format: "png" })
  await writeFile("/tmp/memoria-hover-dispersed.png", Buffer.from(dispersedScreenshot.data, "base64"))
  // Moving into a gap inside the focused cluster must not collapse it.
  const gapPoint = await evaluate(`(() => {
    const group = ${collection("assets-1")};
    const point = group.localToWorld(new group.position.constructor(0.12, 0, 0)).project(${camera});
    return {x: (point.x + 1) * innerWidth / 2, y: (1 - point.y) * innerHeight / 2};
  })()`)
  await call("Input.dispatchMouseEvent", { type: "mouseMoved", ...gapPoint })
  await waitFor(`${collection("assets-1")}.scale.x > 1.0799 && ${visibleBubbles("assets-1")}.length === 7`)
  await evaluate("window.__splitFrames = []")
  await call("Input.dispatchMouseEvent", { type: "mouseMoved", x: 700, y: 120 })
  await waitFor(`${collection("assets-1")}.scale.x < 1.0001 && !${label("assets-1")}.visible`)
  const mergeFrames = await evaluate("window.__splitFrames")
  assert(mergeFrames.some(frame => frame.fluid && frame.vertices > 0 && frame.shellOpacity < 0.1),
    "returning fuses through the same continuous membrane")
  await evaluate("window.__splitFrames = null")
  assert.equal(await evaluate(`${visibleBubbles("assets-1")}.length`), 5, "leaving restores five resting bubbles")
  assert(await evaluate(`${mainCircle("assets-1")}.scale.x > 0.98`), "leaving restores the large core")
  console.log("PASS: hover disperses into seven small-to-medium bubbles, holds focus across gaps, and restores on leave")

  await cancelApproach("assets-1", escape)
  // A real click at the button, so it must be visible and on top.
  await cancelApproach("assets-2", clickCancelButton)
  console.log("PASS: Esc and the lone 戻る button call an approach off and glide home")

  const picked = await enterInitial("assets-1", {
    async duringApproach() {
      // Looking around mid-glide carries into the pose the viewer arrives at.
      await dragBy(110, 0)
      assert(await evaluate(`Boolean(${ring})`), "bubbles unfold during the approach, not afterward")
      assert(await evaluate(mode("transition")), "dragging does not cancel the approach")
      assert(await evaluate(`(() => {
        const before = ${camera}.position.clone();
        document.querySelector(".xr-canvas canvas").dispatchEvent(new WheelEvent("wheel", {deltaY: -400, cancelable: true}));
        return ${camera}.position.distanceTo(before) === 0;
      })()`), "wheel input never adds movement to the automatic approach")
    },
  })
  const offset = await evaluate(`(() => {
    const eye = ${camera}.position;
    const forward = new eye.constructor(0, 0, -1).applyQuaternion(${camera}.quaternion);
    const toMemory = ${collection("assets-1")}.getWorldPosition(eye.clone()).sub(eye).normalize();
    return forward.angleTo(toMemory);
  })()`)
  assert(offset >= 0.25, `the mid-glide drag is kept on arrival (${offset})`)
  assert.equal(await leadTexture("assets-1"), picked, "the picked photo leads the ring")
  await expectTrail(`空間 › ${titleOf("assets-1")}`, "the ring reads 空間 › title")
  await waitFor(trailSettled)
  const desktop = await headerBoxes()
  assert(
    Math.abs(desktop.crumbs.left + desktop.crumbs.width / 2 - desktop.width / 2) < 1 &&
      desktop.crumbs.left > desktop.logo.right &&
      desktop.crumbs.right < desktop.chip.left &&
      desktop.crumbs.top < desktop.logo.bottom &&
      desktop.crumbs.bottom > desktop.logo.top,
    `the breadcrumb sits top center, between the logo and the chip (${JSON.stringify(desktop)})`,
  )
  await assertOnlyBack("ring")

  // Pressing empty space in the ring does nothing.
  const emptyPoint = await evaluate(`(() => {
    window.__scene.updateMatrixWorld(true);
    const eye = ${camera};
    const focal = innerHeight / 2 / Math.tan(eye.fov * Math.PI / 360);
    const discs = ${ringPhotos}.flatMap(mesh => {
      const world = mesh.getWorldPosition(mesh.position.clone());
      const depth = -world.clone().applyMatrix4(eye.matrixWorldInverse).z;
      if (depth <= 0) return [];
      const point = world.project(eye);
      const scale = mesh.getWorldScale(mesh.scale.clone());
      return [{x: (point.x + 1) * innerWidth / 2, y: (1 - point.y) * innerHeight / 2,
        radius: 0.15 * Math.max(scale.x, scale.y, scale.z) * focal / depth}];
    });
    for (const x of [0.12, 0.35, 0.65, 0.88]) for (const y of [0.18, 0.5, 0.72]) {
      const point = {x: x * innerWidth, y: y * innerHeight};
      if (document.elementFromPoint(point.x, point.y)?.tagName === "CANVAS" &&
        discs.every(d => Math.hypot(d.x - point.x, d.y - point.y) > d.radius + 32)) return point;
    }
    return null;
  })()`)
  assert(emptyPoint, "there is an actual empty spot between the floating bubbles")
  await clickAt(emptyPoint)
  await pause(600)
  assert(await evaluate(`${mode("ring")} && !${shown("MemoryImmersionScreen")}`), "empty press stays in the ring")

  await enterPhoto()
  assert(
    await evaluate(`(() => {
      const scene = window.__scene;
      scene.updateMatrixWorld(true);
      const room = scene.getObjectByName("MemoryImmersion");
      return room.getWorldPosition(room.position.clone()).distanceTo(${camera}.position) < 1e-6;
    })()`),
    "the immersive screen is centered on the viewer",
  )
  assert.equal(
    await evaluate('document.querySelector(".ov-immersion-hint").textContent'),
    "← → で写真を切り替え · 戻るでリングへ",
    "the photo layer's caption",
  )
  await drag()
  const screenshot = await call("Page.captureScreenshot", { format: "png" })
  await writeFile(
    "/tmp/memoria-immersion.png",
    Buffer.from(screenshot.data, "base64"),
  )

  // Step through every photo of the memory without leaving the photo layer.
  const last = expected["assets-1"] - 1
  const opened = await shownIndex("assets-1")
  assert(opened >= 0, "the opened photo is one of the memory's photos")
  await waitForNav("assets-1", opened)
  const photoTrail = (index) =>
    `空間 › ${titleOf("assets-1")} › 写真 ${index + 1}/${expected["assets-1"]}`
  await expectTrail(photoTrail(opened), "a photo reads 空間 › title › 写真 n/N")
  await assertOnlyBack("photo")
  // Quick presses retarget the switch: only the final photo unrolls.
  for (let index = opened; index > 0; index--) await arrowKey(-1)
  await waitFor(showing("assets-1", 0))
  await waitForNav("assets-1", 0)
  // Nothing comes before the first photo: ←, the faded HTML arrow and the
  // faded 3D arrow all do nothing.
  await arrowKey(-1)
  await clickNavButton("previous")
  await pause(700)
  assert(await evaluate(showing("assets-1", 0)), "no photo before the first one")
  const seen = [0]
  for (let index = 1; index <= last; index++) {
    const press = [
      () => arrowKey(1),
      () => clickNavButton("next"),
      () => clickNavButton("next"),
    ][index % 3]
    if (index === 1) {
      const frames = await recordSwitch(press, "assets-1", index)
      const from = frames[0].src
      const leaving = frames.filter((frame) => frame.src === from)
      const arriving = frames.filter((frame) => frame.src !== from)
      const fadeStart = leaving.find((frame) => frame.opacity < 0.999)
      assert(fadeStart && arriving.length, "the photo fades out, then the next arrives")
      assert(
        leaving.every((frame, i) => i === 0 || frame.opacity <= leaving[i - 1].opacity + 1e-9),
        "the current photo only fades out",
      )
      assert(
        arriving[0].reveal < 0.5 &&
          arriving.every((frame, i) => frame.opacity > 0.999 &&
            (i === 0 || frame.reveal >= arriving[i - 1].reveal - 1e-9)),
        "the next photo unrolls from the center at full opacity",
      )
      const fadeSeconds = (arriving[0].at - fadeStart.at) / 1000
      const revealSeconds =
        (arriving.find((frame) => frame.reveal >= 1).at - arriving[0].at) / 1000
      assert(fadeSeconds > 0.2, `fading out takes about 0.3s (${fadeSeconds})`)
      assert(revealSeconds > 0.45, `unrolling takes about 0.6s (${revealSeconds})`)
    } else {
      await press()
      await waitFor(showing("assets-1", index))
    }
    seen.push(await shownIndex("assets-1"))
    assert(await evaluate(mode("photo")), "switching photos stays in the photo layer")
    await waitForNav("assets-1", index)
    await expectTrail(photoTrail(index), "the breadcrumb counts along with each photo")
  }
  assert.deepEqual(
    seen,
    order["assets-1"].map((_, index) => index),
    "every photo can be seen in order without returning to the ring",
  )
  // Nothing comes after the last photo either.
  await arrowKey(1)
  await clickNavButton("next")
  await pause(700)
  assert(await evaluate(showing("assets-1", last)), "no photo after the last one")

  await escape()
  await waitFor(ringIsOpen)
  await waitFor(`!${shown("MemoryImmersionScreen")}`)
  await expectTrail(`空間 › ${titleOf("assets-1")}`, "back in the ring, the photo crumb is gone")
  // The ring comes back with the last photo's fragment straight ahead.
  const offAhead = await photoOffAhead(last)
  assert(offAhead < 0.05, `the last photo's fragment faces the viewer (${offAhead})`)
  assert(!await evaluate(shown("MemoryRingTab-back")), "Web never shows the VR ring button")
  assert.equal(
    await evaluate('document.querySelector(".journey-caption").textContent'),
    "写真を選ぶと、記憶にひたれます",
    "the ring's caption is one line",
  )
  assert(
    await evaluate(`(() => {
      const bounds = document.querySelector(".journey-caption").getBoundingClientRect();
      const hit = document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2);
      return hit?.tagName === "CANVAS";
    })()`),
    "the caption lets presses through to the scene",
  )
  // Looking around works in the ring; WASD and the wheel do not walk.
  const ringPosition = await evaluate(`${camera}.position.toArray()`)
  await pressKey("w", "KeyW", 87, 400)
  await wheelAt(700, 420)
  await pause(300)
  assert.deepEqual(
    await evaluate(`${camera}.position.toArray()`),
    ringPosition,
    "WASD and the wheel do not walk in the ring",
  )
  // Turning well away never introduces duplicate 3D UI on Web.
  await dragBy(400, 0)
  assert(!await evaluate(shown("MemoryRingTab-back")), "turning keeps the VR ring button hidden")
  assert(await evaluate(mode("ring")), "looking around stays in the ring")
  await lookDown()
  const ringScreenshot = await call("Page.captureScreenshot", { format: "png" })
  await writeFile(
    "/tmp/memoria-ring.png",
    Buffer.from(ringScreenshot.data, "base64"),
  )
  await escape()
  await waitFor(`${mode("transition")} && Boolean(${ring})`)
  assert(await evaluate(dockInert), "the dock stays inert while the ring gathers")
  await backHome("assets-1")
  console.log(
    "PASS: one press enters, drag mid-approach, Esc/wheel while unfolding, empty press, photo layer, ring back tab, Esc one layer at a time",
  )

  await enterInitial("assets-2")
  await enterPhoto()
  assert(!await evaluate(shown("MemoryTab-back")), "Web never shows the VR photo button")
  await clickButton(".journey-toolbar button")
  await waitFor(ringIsOpen)
  await clickButton(".journey-toolbar button")
  await backHome("assets-2")
  const satellite = await clearSatellite("assets-3")
  const pickedSatellite = await enterInitial("assets-3", { circle: satellite })
  assert.equal(
    await leadTexture("assets-3"),
    pickedSatellite,
    "a picked satellite's photo leads the ring",
  )
  await clickButton(".journey-toolbar button")
  await backHome("assets-3")
  console.log(
    "PASS: all three folders open their own ring; the fixed Web back button steps back one layer",
  )

  await call("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-motion", value: "reduce" }],
  })
  await enterInitial("assets-1", { animated: false })
  await clickButton(".journey-toolbar button")
  await backHome("assets-1")
  await call("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-motion", value: "no-preference" }],
  })
  console.log("PASS: reduced motion opens on the first press and steps back")

  await call("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true,
  })
  await waitFor(`Math.abs(${camera}.aspect - innerWidth / innerHeight) < 1e-6`)
  await call("Emulation.setTouchEmulationEnabled", {
    enabled: true,
    maxTouchPoints: 2,
  })
  // Touch has no hover: a single tap starts the approach straight away.
  await pressClear("assets-1", mainCircle("assets-1"), `!(${mode("space")})`, tapAt)
  assert(
    await evaluate(`${collection("assets-1")}.scale.x < 1.0001 && !${label("assets-1")}.visible`),
    "a tap never hovers",
  )
  await waitFor(ringIsOpen)
  const fits = (selector) =>
    evaluate(`(() => {
      const bounds = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
      return bounds.left >= 0 && bounds.right <= innerWidth;
    })()`)
  assert(await fits(".journey-toolbar"), "ring toolbar fits a mobile viewport")
  await waitFor(trailSettled)
  await expectTrail(`空間 › ${titleOf("assets-1")}`, "the mobile ring reads 空間 › title")
  const mobile = await headerBoxes()
  assert(
    (await fits(".journey-crumbs ol")) &&
      Math.abs(mobile.crumbs.left + mobile.crumbs.width / 2 - mobile.width / 2) < 1 &&
      mobile.crumbs.top >= Math.max(mobile.logo.bottom, mobile.chip.bottom),
    `on mobile the breadcrumb takes its own centered row under the header (${JSON.stringify(mobile)})`,
  )
  assert(
    await evaluate(`(() => {
      const caption = document.querySelector(".journey-caption");
      return caption.getClientRects().length === 1 &&
        caption.getBoundingClientRect().height < 2 * parseFloat(getComputedStyle(caption).fontSize);
    })()`),
    "the ring's caption stays on one line on mobile",
  )
  const mobileRingPosition = await evaluate(`${camera}.position.toArray()`)
  await pinchOut(195, 420)
  await pause(300)
  assert.deepEqual(
    await evaluate(`${camera}.position.toArray()`),
    mobileRingPosition,
    "pinching does not walk in the ring",
  )
  assert(await evaluate(mode("ring")), "a pinch never picks a fragment")
  // A tap opens a photo; a quick sideways swipe steps to its neighbour.
  await clickUntil(centerPhoto, mode("photo"), tapAt)
  const tapped = await shownIndex("assets-1")
  await waitFor(showing("assets-1", tapped))
  assert(
    (await fits('.photo-nav-button[data-side="previous"]')) &&
      (await fits('.photo-nav-button[data-side="next"]')),
    "the photo arrows fit a mobile viewport",
  )
  await waitFor(`(() => {
    const hint = document.querySelector(".ov-immersion-hint").getBoundingClientRect();
    const back = document.querySelector(".journey-toolbar button").getBoundingClientRect();
    const toolbar = getComputedStyle(document.querySelector(".journey-toolbar"));
    return hint.bottom < back.top && toolbar.visibility === "visible" && toolbar.opacity === "1";
  })()`)
  const swipeTo = tapped < expected["assets-1"] - 1 ? tapped + 1 : tapped - 1
  const beforeSwipe = await evaluate(`${camera}.quaternion.toArray()`)
  // Flicking left shows the next photo, right the previous one.
  if (swipeTo > tapped) await swipeAcross(300, 120, 420)
  else await swipeAcross(90, 270, 420)
  await waitFor(showing("assets-1", swipeTo))
  assert(await evaluate(mode("photo")), "a swipe stays in the photo layer")
  // The swipe steps photos rather than looking: the view eases back.
  await waitFor(
    `${camera}.quaternion.angleTo(${camera}.quaternion.clone().fromArray(${JSON.stringify(beforeSwipe)})) < 1e-3`,
  )
  // The same distance dragged slowly only looks around.
  if (swipeTo > tapped) await swipeAcross(90, 270, 420, 0.9)
  else await swipeAcross(300, 120, 420, 0.9)
  await pause(700)
  assert(await evaluate(showing("assets-1", swipeTo)), "a slow drag never steps photos")
  assert(
    await evaluate(
      `${camera}.quaternion.angleTo(${camera}.quaternion.clone().fromArray(${JSON.stringify(beforeSwipe)})) > 0.3`,
    ),
    "a slow drag looks around",
  )
  await escape()
  await waitFor(ringIsOpen)
  const swipedAhead = await photoOffAhead(swipeTo)
  assert(swipedAhead < 0.05, `the swiped-to photo faces the viewer in the ring (${swipedAhead})`)
  await escape()
  await backHome("assets-1")
  // The same pinch still walks in the space.
  await pinchOut(195, 420)
  await waitFor(`!(${atHome})`)
  await call("Emulation.setTouchEmulationEnabled", { enabled: false })

  const documentNode = await call("DOM.getDocument")
  const input = await call("DOM.querySelector", {
    nodeId: documentNode.root.nodeId,
    selector: 'input[type="file"]',
  })
  await call("DOM.setFileInputFiles", {
    nodeId: input.nodeId,
    files: [resolve("public/assets-1/35372467_m.jpg")],
  })
  await waitFor('Boolean(document.querySelector(".memory-draft[open]"))')
  assert(
    await evaluate('!window.__scene.getObjectByName("MemoryCollection-upload-1")'),
    "a selected photo remains a private draft until publication",
  )
  await clickButton(".draft-publish button")
  await waitFor(
    'window.__scene.getObjectByName("MemoryCollection-upload-1")?.children.some(m => m.children.some(c => c.isSprite))',
  )
  await waitFor('Boolean(window.__scene.getObjectByName("MemoryLabel-upload-1"))')
  assert(
    await evaluate('window.__worldLabels.includes("記憶") && window.__worldLabels.includes("1枚の写真")'),
    "an untitled memory is labelled 記憶",
  )
  assert(
    await evaluate('!document.querySelector(".ov-dock img")'),
    "uploaded photos are not listed under the composer",
  )
  console.log(
    "PASS: a tap enters on mobile, controls fit, a swipe steps photos, Escape closes the ring, untitled uploads read 記憶",
  )
  // The wheel still walks in the space.
  const spacePosition = await evaluate(`${camera}.position.toArray()`)
  await wheelAt(195, 420)
  await waitFor(
    `${camera}.position.distanceTo(${camera}.position.clone().fromArray(${JSON.stringify(spacePosition)})) > 0.1`,
  )
  console.log(
    "PASS: WASD, the wheel and pinch never walk in the ring; the wheel and pinch still walk in the space",
  )
  assert(
    await evaluate(
      `window.__worldLabels.includes("戻る") &&
        !window.__worldLabels.some(text => ["memory in", "close", "SELECTED", "INSIDE YOUR MEMORY"].includes(text))`,
    ),
    "3D tabs read 戻る, never memory in or close",
  )
  // VR, by hand: no headset here.
  // Start a save on the web, finish it in VR: no HTML is needed to read its status.
  await evaluate("window.__deferSave = true")
  await call("DOM.setFileInputFiles", {
    nodeId: input.nodeId,
    files: [resolve("public/assets-1/35372467_m.jpg")],
  })
  await waitFor('Boolean(document.querySelector(".memory-draft[open]"))')
  await clickButton(".draft-publish button")
  await waitFor("Boolean(window.__completeSave)")
  await waitFor('document.querySelector(".ov-foot").textContent === "みんなの空間に保存しています…"')
  const webView = await evaluate(`${camera}.position.toArray()`)
  const webRotation = await evaluate(`${camera}.quaternion.toArray()`)
  // Entering VR: the panel appears 1.2m ahead, 0.35m below the eyes.
  // Tracking can arrive later than sessionstart; no stale placement is shown.
  await setHead(1.1, { position: [0.4, 1.05, -0.2], pitch: -0.7 })
  await evaluate("window.__tracking = false")
  const pendingVisibility = await startSession('document.body.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyW", bubbles: true }));')
  assert(pendingVisibility.every(visible => !visible), "the Web layout hides synchronously before the first VR frame")
  await pause(300)
  assert(!await evaluate(shown("MemoryCollection-assets-1")), "no sphere before a valid VR pose")
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".web-ui")).display'), "none")
  assert(await evaluate('document.querySelector(".web-ui").inert'), "Web controls are inert in VR")
  await evaluate("window.__tracking = true")
  await waitFor(shown("MemoryCollection-assets-1"))
  const anchored = await evaluate(`${collection("assets-1")}.position.toArray()`)
  assert(Math.abs(anchored[0] - (0.4 - Math.sin(1.1) * 1.5)) < 1e-6, "starts ahead in the headset's yaw")
  assert(Math.abs(anchored[2] - (-0.2 - Math.cos(1.1) * 1.5)) < 1e-6, "keeps the original viewing distance")
  assert(Math.abs(anchored[1] - 1.05) <= 0.071, "starts at seated eye height, ignoring downward pitch")
  await setHead(0)
  await pause(300)
  const still = await evaluate(`${collection("assets-1")}.position.toArray()`)
  assert(Math.hypot(still[0] - anchored[0], still[2] - anchored[2]) < 1e-6, "head movement never drags the spheres")
  console.log("PASS: VR waits for tracking, anchors horizontally at eye height, then stays world-fixed")
  // Restart at the default head pose for the existing controller scenarios.
  await startSession()
  await waitFor(`${shown("VRGuidePanel")} && ${panel}.material.opacity > 0.99 &&
    (() => { const p = window.__scene.getObjectByName("VRGuide").position;
      return Math.hypot(p.x, p.y - 1.15, p.z + 1.2) < 1e-3; })()`)
  assert.deepEqual(await panelGuide(), {
    trail: [],
    lines: [
      "球体にレイを向けてトリガーを引くと、記憶のなかへ",
      "写真はみんなの空間に公開されます",
    ],
    note: "みんなの空間に保存しています…",
  })
  const at = await evaluate('window.__scene.getObjectByName("VRGuide").position.toArray()')
  assert(Math.hypot(at[0], at[1] - 1.15, at[2] + 1.2) < 1e-3, `panel ahead and below: ${at}`)
  console.log("PASS: VR shows the space's guidance 1.2m ahead, 0.35m below the eyes")

  await evaluate("window.__completeSave()")
  await waitFor(`${shown("VRGuideToast")} && ${vrToast}.material.opacity > 0.99`)
  assert.equal(
    await evaluate(`${vrToast}.userData.text`),
    await evaluate('document.querySelector(".xr-toast").textContent'),
    "the 3D toast has exactly the HTML toast's message",
  )
  await waitFor(`${panel}.userData.guide.note === ""`)
  // Exact timing is covered by sceneGuide.test.mjs. Slow software-rendered
  // frames and CDP round trips can outlast the toast's remaining lifetime.
  await waitFor(`!${shown("VRGuideToast")}`)
  console.log("PASS: VR mirrors saving status and the HTML toast, then hides the toast")

  const controllerVisibility = await evaluate(`[0, 1].map(index => {
    const controller = ${xr}.getController(index);
    const visible = controller.visible;
    controller.visible = false;
    return visible;
  })`)
  await setHead(0)
  await waitFor(`${mainCircle("assets-1")}.scale.x < 0.54 && ${visibleBubbles("assets-1")}.length === 7`)
  assert(await evaluate(`${visibleBubbles("assets-1")}.every(mesh =>
    Math.max(mesh.scale.x, mesh.scale.y, mesh.scale.z) < 0.65)`), "head gaze leaves no large bubble")
  assert(await evaluate(mode("space")), "gazing only focuses; it never automatically enters")
  await setHead(0.9)
  await waitFor(`${mainCircle("assets-1")}.scale.x > 0.98 && ${visibleBubbles("assets-1")}.length === 5`)
  await setHead(0)
  await waitFor(`${mainCircle("assets-1")}.scale.x < 0.54 && ${visibleBubbles("assets-1")}.length === 7`)
  await evaluate(`${JSON.stringify(controllerVisibility)}.forEach((visible, index) => {
    ${xr}.getController(index).visible = visible;
  })`)
  console.log("PASS: VR head gaze disperses into seven small-to-medium bubbles; looking away restores the core")

  // The trigger enters a memory; the panel reads the ring's breadcrumb.
  await triggerUntil(mainCircle("assets-1"), vrMode("ring"))
  assert.deepEqual(await panelGuide(), {
    trail: ["空間", "記憶 02"],
    lines: ["写真をトリガーで選ぶと、記憶にひたれます", "足元の「戻る」で空間へ"],
    note: "",
  })
  // A photo, then the next one.
  await triggerUntil(`${ringPhotos}[0]`, vrMode("photo"))
  const first = await panelGuide()
  assert.deepEqual(first.lines, ["スティックか左右の矢印で写真を切り替え", "画面下の「戻る」でリングへ"])
  const [, count] = first.trail[2].match(/^写真 \d+\/(\d+)$/)
  const index = Number(first.trail[2].match(/^写真 (\d+)/)[1])
  const nextTab = index < Number(count) ? "next" : "previous"
  await waitFor(tabReady(`MemoryTab-${nextTab}`))
  const expectedNext = `写真 ${nextTab === "next" ? index + 1 : index - 1}/${count}`
  await triggerUntil(
    `window.__scene.getObjectByName("MemoryTab-${nextTab}")`,
    `${panel}.userData.guide.trail[2] === ${JSON.stringify(expectedNext)}`,
  )
  console.log(`PASS: VR enters a memory and steps ${first.trail[2]} → ${expectedNext} with the trigger`)
  // The thumbstick also steps once per tilt, not once per rendered frame.
  const afterArrow = nextTab === "next" ? index : index - 2
  await waitFor(showing("assets-1", afterArrow))
  const stickDirection = afterArrow < Number(count) - 2 ? 1 : -1
  const afterStick = afterArrow + stickDirection
  await evaluate(`(() => {
    window.__realGetSession = ${xr}.getSession;
    window.__vrInput = { gamepad: { axes: [0, 0, 0, 0] } };
    ${xr}.getSession = () => ({ inputSources: [window.__vrInput] });
  })()`)
  await pause(200)
  await evaluate(`window.__vrInput.gamepad.axes[2] = ${stickDirection}`)
  await waitFor(`${panel}.userData.guide.trail[2] === "写真 ${afterStick + 1}/${count}"`)
  await waitFor(showing("assets-1", afterStick))
  await pause(400)
  assert.equal((await panelGuide()).trail[2], `写真 ${afterStick + 1}/${count}`, "holding a stick never repeats")
  await evaluate(`${xr}.getSession = window.__realGetSession`)
  console.log("PASS: VR steps photos once per thumbstick tilt")
  // Each 戻る goes up a layer, and the panel follows along.
  await waitFor(tabReady("MemoryTab-back"))
  await triggerUntil('window.__scene.getObjectByName("MemoryTab-back")', vrMode("ring"))
  await waitFor(tabReady("MemoryRingTab-back"))
  await waitForTabAtFeet("VR ring back stays at the viewer's feet")
  await triggerUntil('window.__scene.getObjectByName("MemoryRingTab-back")', vrMode("space"))
  assert.deepEqual((await panelGuide()).trail, [])
  console.log("PASS: VR goes back photo → ring → space, the panel's breadcrumb following")

  // Turning the head: the panel eases after it rather than jumping.
  await setHead(Math.PI / 2)
  await pause(50)
  const easing = await evaluate('window.__scene.getObjectByName("VRGuide").position.toArray()')
  assert(Math.hypot(easing[0] + 1.2, easing[2]) > 0.05, `the panel trails the head: ${easing}`)
  await waitFor(`(() => { const p = window.__scene.getObjectByName("VRGuide").position; return Math.hypot(p.x + 1.2, p.y - 1.15, p.z) < 0.01 })()`)
  console.log("PASS: the panel follows the head with a lag")
  await setHead(0)

  // Starting a session over closes an open ring at once.
  await triggerUntil(mainCircle("assets-1"), vrMode("ring"))
  await startSession()
  await waitFor(`!${ring} && ${mode("space")} && !${shown("MemoryRingTab-back")}`)
  // Leaving VR on a photo closes the screen and the ring before the view resets.
  await triggerUntil(mainCircle("assets-1"), vrMode("ring"))
  await triggerUntil(`${ringPhotos}[0]`, vrMode("photo"))
  await evaluate(`${xr}.isPresenting = false; ${xr}.dispatchEvent({ type: "sessionend" })`)
  await waitFor(`!${ring} && ${mode("space")} && !${shown("MemoryImmersionScreen")} && !${shown("VRGuide")} && ${camera}.position.distanceTo(${camera}.position.clone().fromArray(${JSON.stringify(webView)})) < 1e-6`)
  await pause(400)
  assert(await evaluate(`${camera}.position.distanceTo(${camera}.position.clone().fromArray(${JSON.stringify(webView)})) < 1e-6`), "a pre-VR held key cannot walk after exit")
  assert(await evaluate(`${camera}.quaternion.angleTo(${camera}.quaternion.clone().fromArray(${JSON.stringify(webRotation)})) < 1e-6`), "the web orientation is restored")
  assert.equal(await evaluate(`${camera}.fov`), 70, "the web field of view is restored")
  assert.notEqual(await evaluate('getComputedStyle(document.querySelector(".web-ui")).display'), "none")
  assert(!await evaluate('document.querySelector(".web-ui").inert'), "Web controls reactivate after VR")
  const restored = await evaluate(`${collection("assets-1")}.position.toArray()`)
  assert(Math.hypot(restored[0], restored[2] + 1.5) < 1e-6, "VR exit restores the Web sphere layout")
  await evaluate('document.body.dispatchEvent(new KeyboardEvent("keyup", { code: "KeyW", bubbles: true }))')
  console.log("PASS: entering or leaving VR closes the ring and the photo, then resets the view")
  assert.deepEqual(errors, [], "no runtime errors")
} catch (error) {
  const screenshot = await call("Page.captureScreenshot", { format: "png" })
  await writeFile(
    "/tmp/memoria-journey-failure.png",
    Buffer.from(screenshot.data, "base64"),
  )
  console.error(
    await evaluate(`({
    mode: document.querySelector(".app")?.dataset.mode,
    width: innerWidth, height: innerHeight,
    position: ${camera}?.position.toArray(),
    ring: Boolean(window.__scene?.getObjectByName("MemoryRing")),
    errors: ${JSON.stringify(errors)}
  })`),
  )
  throw error
} finally {
  socket.close()
  await fetch(`${cdp}/json/close/${target.id}`)
}
