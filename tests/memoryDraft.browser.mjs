import assert from "node:assert/strict"
import { writeFile } from "node:fs/promises"
import { resolve } from "node:path"

// Uses the existing preview and a Chromium remote-debugging endpoint.
// All memory requests are intercepted; no shared data is read or written.
const preview = process.env.MEMORIA_URL ?? "http://localhost:3000"
const cdp = process.env.CDP_URL ?? "http://localhost:9222"
const target = await fetch(`${cdp}/json/new?about:blank`, {
  method: "PUT",
}).then((r) => r.json())
const socket = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((done) =>
  socket.addEventListener("open", done, { once: true }),
)
let id = 0
const pending = new Map()
const errors = []
let onFileChooser = null
socket.addEventListener("message", ({ data }) => {
  const message = JSON.parse(data)
  if (message.id) {
    const handler = pending.get(message.id)
    pending.delete(message.id)
    if (message.error) handler.reject(new Error(JSON.stringify(message.error)))
    else handler.resolve(message.result)
  } else if (message.method === "Page.fileChooserOpened") {
    onFileChooser?.(message.params)
  } else if (message.method === "Runtime.exceptionThrown") {
    errors.push(
      message.params.exceptionDetails.exception?.description ??
        message.params.exceptionDetails.text,
    )
  }
})
const call = (method, params = {}) =>
  new Promise((resolve, reject) => {
    pending.set(++id, { resolve, reject })
    socket.send(JSON.stringify({ id, method, params }))
  })
const evaluate = async (expression) => {
  const result = await call("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  })
  if (result.exceptionDetails)
    throw new Error(
      result.exceptionDetails.exception?.description ??
        result.exceptionDetails.text,
    )
  return result.result.value
}
const waitFor = async (expression) => {
  for (const start = Date.now(); Date.now() - start < 20000; ) {
    if (await evaluate(expression)) return
    await new Promise((done) => setTimeout(done, 100))
  }
  throw new Error(`Timed out: ${expression}`)
}
const click = (selector) =>
  evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`)
const openPicker = async (selector) => {
  let timer
  const opened = new Promise((resolve, reject) => {
    onFileChooser = resolve
    timer = setTimeout(
      () => reject(new Error(`Picker did not open: ${selector}`)),
      5000,
    )
  })
  try {
    const point = await evaluate(`(() => {
      const rect = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
      return {x: rect.x + rect.width / 2, y: rect.y + rect.height / 2};
    })()`)
    for (const type of ["mousePressed", "mouseReleased"]) {
      await call("Input.dispatchMouseEvent", {
        type,
        ...point,
        button: "left",
        clickCount: 1,
      })
    }
    assert.equal((await opened).mode, "selectMultiple")
  } finally {
    clearTimeout(timer)
    onFileChooser = null
  }
}
const choose = async (...paths) => {
  const { root } = await call("DOM.getDocument")
  const { nodeId } = await call("DOM.querySelector", {
    nodeId: root.nodeId,
    selector: 'input[type="file"]',
  })
  await call("DOM.setFileInputFiles", {
    nodeId,
    files: paths.map((path) => resolve(path)),
  })
}
const first = "public/assets-1/35372467_m.jpg"
const second = "src/assets/osaka-castle.png"
const thumbnails = 'document.querySelectorAll(".draft-thumbnail").length'
const sendEscape = async () => {
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
const screenshot = async (name) => {
  const { data } = await call("Page.captureScreenshot", { format: "png" })
  await writeFile(`/tmp/${name}.png`, Buffer.from(data, "base64"))
}

try {
  await call("Runtime.enable")
  await call("Page.enable")
  await call("Page.setInterceptFileChooserDialog", { enabled: true })
  await call("Page.addScriptToEvaluateOnNewDocument", {
    source: `
      window.__saves = [];
      window.__failSave = true;
      const originalFetch = window.fetch;
      window.fetch = async (input, options) => {
        const url = typeof input === "string" ? input : input.url;
        if (!url?.includes("/make-server-da91c8fa/memories")) return originalFetch(input, options);
        if (options?.method !== "POST") return new Response(JSON.stringify({memories: []}));
        const body = options.body;
        const saved = {
          id: body.get("id"), title: body.get("title"), createdAt: new Date().toISOString(),
          photos: body.getAll("photos").map(photo => URL.createObjectURL(photo))
        };
        window.__saves.push({id: saved.id, title: saved.title, count: saved.photos.length});
        if (window.__failSave) return new Response(JSON.stringify({error: "Offline fixture"}), {status: 503});
        await new Promise(resolve => {window.__finishSave = resolve});
        return new Response(JSON.stringify({memory: saved}));
      };
    `,
  })
  await call("Emulation.setDeviceMetricsOverride", {
    width: 1400,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  })
  await call("Page.navigate", { url: preview })
  await waitFor('Boolean(document.querySelector(".ov-help"))')
  await waitFor('!document.querySelector("dialog[open]")')
  assert.equal(
    await evaluate(
      'document.querySelectorAll(".ov-composer input:not([type=file])").length',
    ),
    0,
    "title is not requested before selection",
  )
  const initialHeight = await evaluate(
    'document.querySelector(".ov-composer").getBoundingClientRect().height',
  )
  assert.equal(initialHeight, 66, "the initial composer retains its height")
  await openPicker(".ov-composer .ov-pill")
  await choose(first)
  await waitFor(
    'Boolean(document.querySelector(".memory-draft[open] .draft-preview img"))',
  )
  assert.equal(await evaluate(thumbnails), 1)
  assert.equal(
    await evaluate("window.__saves.length"),
    0,
    "selection never publishes",
  )
  await openPicker(".draft-add")
  await choose(second)
  await waitFor(`${thumbnails} === 2`)
  assert.equal(
    await evaluate("window.__saves.length"),
    0,
    "additional selections never publish",
  )
  await click('.draft-thumbnail[aria-label^="写真 2"]')
  assert.match(
    await evaluate('document.querySelector(".draft-preview img").alt'),
    /osaka-castle/,
  )
  await choose(first)
  assert.equal(
    await evaluate(thumbnails),
    2,
    "reselecting a photo does not duplicate it",
  )
  await click('.draft-remove[aria-label="写真 1を削除"]')
  assert.equal(await evaluate(thumbnails), 1)
  await choose(first)
  await waitFor(`${thumbnails} === 2`)
  await evaluate(`(() => {
    const input = document.querySelector("#draft-memory-title");
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, "  海辺の記憶  ");
    input.dispatchEvent(new Event("input", {bubbles: true}));
  })()`)
  await screenshot("memory-draft-desktop")
  await click(".draft-publish button")
  await waitFor(
    'Boolean(document.querySelector(".draft-publish [role=alert]"))',
  )
  assert.equal(
    await evaluate(thumbnails),
    2,
    "failed publication retains all photos",
  )
  assert.equal(
    await evaluate('document.querySelector("#draft-memory-title").value'),
    "  海辺の記憶  ",
  )
  assert.deepEqual(
    await evaluate("window.__saves.map(({title, count}) => ({title, count}))"),
    [{ title: "海辺の記憶", count: 2 }],
  )
  await evaluate("window.__failSave = false")
  await click(".draft-publish button")
  await waitFor("Boolean(window.__finishSave)")
  assert(
    await evaluate('document.querySelector(".draft-publish button").disabled'),
  )
  assert(await evaluate('document.querySelector(".draft-remove").disabled'))
  await click(".draft-publish button")
  await sendEscape()
  assert(
    await evaluate('Boolean(document.querySelector(".memory-draft[open]"))'),
    `Escape cannot interrupt publication: ${await evaluate(`JSON.stringify({
      dialog: document.querySelector(".memory-draft")?.outerHTML.slice(0, 500),
      saves: window.__saves,
      error: document.querySelector(".draft-publish [role=alert]")?.textContent
    })`)}`,
  )
  assert.equal(
    await evaluate("window.__saves.length"),
    2,
    "double submit is prevented",
  )
  assert(
    await evaluate("window.__saves[0].id === window.__saves[1].id"),
    "retries reuse the same memory id",
  )
  await evaluate("window.__finishSave()")
  await waitFor('!document.querySelector(".memory-draft")')
  await waitFor('document.activeElement.textContent.includes("写真を選ぶ")')
  assert.match(
    await evaluate('document.querySelector(".xr-toast").textContent'),
    /公開しました/,
  )
  console.log(
    "PASS: choose, append, preview, remove, title, failure retention, retry, single publication, focus return",
  )

  await call("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true,
  })
  await choose(first, second)
  await waitFor(`${thumbnails} === 2`)
  await screenshot("memory-draft-mobile")
  assert(
    await evaluate(`(() => {
    const dialog = document.querySelector(".memory-draft");
    const rect = dialog.getBoundingClientRect();
    return rect.x >= 0 && rect.right <= innerWidth && rect.y >= 0 && rect.bottom <= innerHeight && dialog.scrollWidth <= dialog.clientWidth;
  })()`),
    "the mobile modal stays within the viewport without horizontal overflow",
  )
  await sendEscape()
  await waitFor('Boolean(document.querySelector(".draft-discard"))')
  assert(
    await evaluate('document.querySelector(".draft-body").inert'),
    "discard confirmation disables the editor",
  )
  await click(".draft-discard-actions button:first-child")
  await waitFor('!document.querySelector(".draft-discard")')
  assert.equal(
    await evaluate(thumbnails),
    2,
    "continuing editing retains photos",
  )
  await click('.draft-remove[aria-label="写真 2を削除"]')
  await click('.draft-remove[aria-label="写真 1を削除"]')
  assert(
    await evaluate('document.querySelector(".draft-publish button").disabled'),
    "an empty draft cannot publish",
  )
  await choose(first)
  await evaluate(`(() => {
    const files = new DataTransfer();
    for (let i = 0; i < 12; i++) files.items.add(new File(["photo"], "extra-" + i + ".jpg", {type: "image/jpeg", lastModified: i}));
    document.querySelector(".memory-draft").dispatchEvent(new DragEvent("drop", {bubbles: true, cancelable: true, dataTransfer: files}));
  })()`)
  await waitFor(`${thumbnails} === 10`)
  assert(
    await evaluate('document.querySelector(".draft-add").disabled'),
    "ten photos is the total limit",
  )
  assert.match(
    await evaluate('document.querySelector(".draft-notice").textContent'),
    /10枚/,
  )
  await sendEscape()
  await click(".draft-discard-actions button:last-child")
  await waitFor('!document.querySelector(".memory-draft")')
  assert.equal(
    await evaluate("window.__saves.length"),
    2,
    "dropping, editing and discarding never publish",
  )
  assert.deepEqual(errors, [], "no uncaught browser exceptions")
  console.log(
    "PASS: mobile layout, discard confirmation, empty draft, drag-and-drop, total limit, no unintended uploads",
  )
} finally {
  socket.close()
  await fetch(`${cdp}/json/close/${target.id}`)
}
