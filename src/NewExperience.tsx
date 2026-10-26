import { useEffect, useRef, useState, type ChangeEvent } from "react"
import { locationSample, requestPosition, type LocationSample } from "./privateLocation"
import { relativePlace } from "./placeGeometry"
import type { PlaceDraft, PlaceMemory, DraftPhoto } from "./placeMemoriesApi"
import type { PlaceScene } from "./placeScene"

type CameraState = "web" | "starting" | "ar" | "vr"
type PhotoView = { memory: PlaceMemory; index: number }
type SensorEvent = DeviceOrientationEvent & { webkitCompassHeading?: number }

export function NewExperience({ view = "nearby", onCreate }: { view?: "nearby" | "mine"; onCreate?: () => void }) {
  const personal = view === "mine"
  const [compact, setCompact] = useState(() => window.matchMedia("(max-width: 720px)").matches)
  const [page, setPage] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const ownRequest = useRef(0)
  const root = useRef<HTMLElement>(null)
  const layer = useRef<HTMLDivElement>(null)
  const picker = useRef<HTMLInputElement>(null)
  const draftDialog = useRef<HTMLDialogElement>(null)
  const photoDialog = useRef<HTMLDialogElement>(null)
  const session = useRef<XRSession | null>(null)
  const scene = useRef<PlaceScene | null>(null)
  const generation = useRef(0)
  const mounted = useRef(true)
  const busy = useRef(false)
  const draftRef = useRef<PlaceDraft | null>(null)
  const memoriesRef = useRef<PlaceMemory[]>([])
  const locationRef = useRef<LocationSample | null>(null)
  const orientationCleanup = useRef<(() => void) | null>(null)
  const [camera, setCamera] = useState<CameraState>("web")
  const [arSupported, setArSupported] = useState(false)
  const [vrSupported, setVrSupported] = useState(false)
  const [status, setStatus] = useState("")
  const [error, setError] = useState("")
  const [working, setWorking] = useState(false)
  const [draft, setDraft] = useState<PlaceDraft | null>(null)
  const [consent, setConsent] = useState(false)
  const [memories, setMemories] = useState<PlaceMemory[]>([])
  const [located, setLocated] = useState(false)
  const [ring, setRing] = useState<PlaceMemory | null>(null)
  const [photo, setPhoto] = useState<PhotoView | null>(null)
  const [oriented, setOriented] = useState(false)
  const [rename, setRename] = useState(false)
  const [newTitle, setNewTitle] = useState("")
  const [confirmDelete, setConfirmDelete] = useState(false)
  const cameraActive = camera !== "starting"

  const showError = (cause: unknown) => { if (mounted.current) { setStatus(""); setError(cause instanceof Error ? cause.message : "処理できませんでした。もう一度お試しください。") } }
  const release = () => {
    generation.current++
    orientationCleanup.current?.(); orientationCleanup.current = null
    scene.current?.dispose(); scene.current = null
    const active = session.current; session.current = null
    if (active) void active.end().catch(() => {})
  }
  const replaceDraft = (value: PlaceDraft | null) => { draftRef.current = value; setDraft(value) }
  const discardDraft = () => {
    if (busy.current) return
    draftRef.current?.photos.forEach(p => URL.revokeObjectURL(p.url))
    replaceDraft(null); setConsent(false)
  }
  const replaceMemories = (list: PlaceMemory[], origin?: LocationSample) => {
    memoriesRef.current = list; locationRef.current = origin ?? null
    setMemories(list); setLocated(Boolean(origin))
    scene.current?.setMemories(list, origin)
  }
  useEffect(() => {
    mounted.current = true
    void navigator.xr?.isSessionSupported("immersive-ar").then(value => { if (mounted.current) setArSupported(value) }).catch(() => {})
    void navigator.xr?.isSessionSupported("immersive-vr").then(value => { if (mounted.current) setVrSupported(value) }).catch(() => {})
    return () => {
      mounted.current = false; release()
      draftRef.current?.photos.forEach(p => URL.revokeObjectURL(p.url))
    }
  }, [])
  useEffect(() => {
    const element = root.current
    const prevent = (event: Event) => { if ((event.target as Element | null)?.closest("button, input, dialog, details")) event.preventDefault() }
    element?.addEventListener("beforexrselect", prevent)
    return () => element?.removeEventListener("beforexrselect", prevent)
  }, [])
  useEffect(() => {
    const dialog = draftDialog.current
    if (draft && dialog && !dialog.open) dialog.showModal()
    return () => { if (dialog?.open) dialog.close() }
  }, [Boolean(draft)])
  useEffect(() => {
    const dialog = photoDialog.current
    if (photo && dialog && !dialog.open) dialog.showModal()
    return () => { if (dialog?.open) dialog.close() }
  }, [Boolean(photo)])

  const makeScene = async (activeSession?: XRSession, vr = false) => {
    const { createPlaceScene } = await import("./placeScene")
    if (!layer.current || !mounted.current) return
    const view = await createPlaceScene(layer.current, { session: activeSession, backdrop: vr ? "cloud-dome" : undefined, layout: personal ? "mine" : "nearby", compact,
      onRing: (value) => { if (mounted.current) { setRing(value); setRename(false); setConfirmDelete(false) } },
      onPhoto: (memory, index) => { if (mounted.current) setPhoto({ memory, index }) },
      onError: message => { if (mounted.current) setError(message) },
    })
    return view
  }
  useEffect(() => {
    const query = window.matchMedia("(max-width: 720px)")
    const update = () => { setCompact(query.matches); setPage(0) }
    query.addEventListener("change", update)
    return () => query.removeEventListener("change", update)
  }, [])
  useEffect(() => {
    if (camera !== "web") return
    let cancelled = false
    let current: PlaceScene | undefined
    void makeScene().then(value => {
      current = value
      if (cancelled) { value?.dispose(); return }
      scene.current = value ?? null
      value?.setMemories(memoriesRef.current, locationRef.current ?? undefined)
    }).catch(cause => { if (!cancelled) showError(cause) })
    return () => { cancelled = true; current?.dispose(); if (scene.current === current) scene.current = null }
  }, [camera, personal, compact])
  const loadOwn = async () => {
    const request = ++ownRequest.current
    setWorking(true); setError(""); setStatus("自分の思い出を読み込んでいます…")
    try {
      const { findOwnMemories } = await import("./placeMemoriesApi")
      const result = await findOwnMemories(page, compact ? 3 : 9)
      if (!mounted.current || request !== ownRequest.current) return
      replaceMemories(result.memories); setHasMore(result.hasMore); setStatus("")
    } catch (cause) { if (mounted.current && request === ownRequest.current) showError(cause) }
    finally { if (mounted.current && request === ownRequest.current) setWorking(false) }
  }
  useEffect(() => {
    if (personal) void loadOwn()
    return () => { ownRequest.current++ }
  }, [personal, page, compact])
  const startXR = async (mode: "ar" | "vr") => {
    if (!navigator.xr || !root.current || camera === "starting") return
    release(); setCamera("starting"); setError(""); setRing(null); setPhoto(null)
    const request = generation.current
    let active: XRSession | undefined
    // Nearby memories belong to a real place, so VR there shows the headset's passthrough when it has one.
    const domeVR = mode === "vr" && (personal || !arSupported)
    try {
      active = domeVR ? await navigator.xr.requestSession("immersive-vr")
        : await navigator.xr.requestSession("immersive-ar", { optionalFeatures: ["dom-overlay"], domOverlay: { root: root.current } })
      session.current = active
      const view = await makeScene(active, domeVR)
      if (!mounted.current || request !== generation.current) { view?.dispose(); await active.end(); return }
      scene.current = view ?? null
      view?.setMemories(memoriesRef.current, locationRef.current ?? undefined)
      active.addEventListener("end", () => {
        if (session.current === active) { session.current = null; scene.current?.dispose(); scene.current = null; if (mounted.current) { setCamera("web"); setRing(null) } }
      }, { once: true })
      setCamera(mode); setOriented(false)
      setStatus(personal || mode === "vr" ? "思い出を見回して、泡を選んでください。" : "北を向いて「正面を北に合わせる」を押してください。")
    } catch {
      if (active) void active.end().catch(() => {})
      if (mounted.current && request === generation.current) { release(); setCamera("web"); showError(new Error("WebXRを開始できませんでした。対応端末・ブラウザーでお試しください。")) }
    }
  }
  const orient = async () => {
    try {
      const Sensor = DeviceOrientationEvent as typeof DeviceOrientationEvent & { requestPermission?: () => Promise<string> }
      if (Sensor.requestPermission && await Sensor.requestPermission() !== "granted") throw new Error("方位センサーが許可されていません。北を向いて手動で合わせることもできます。")
      orientationCleanup.current?.()
      const onOrientation = (event: SensorEvent) => {
        const heading = typeof event.webkitCompassHeading === "number" ? event.webkitCompassHeading
          : event.absolute && event.alpha !== null ? 360 - event.alpha : null
        if (heading !== null && Number.isFinite(heading)) {
          scene.current?.setHeading(heading, ((event.beta ?? 90) - 90) * Math.PI / 180)
          setOriented(true)
        }
      }
      window.addEventListener("deviceorientationabsolute", onOrientation)
      window.addEventListener("deviceorientation", onOrientation)
      orientationCleanup.current = () => { window.removeEventListener("deviceorientationabsolute", onOrientation); window.removeEventListener("deviceorientation", onOrientation) }
      setStatus("方位センサーを待っています。対応しない端末では、北を向いて手動で合わせてください。")
    } catch (cause) { showError(cause) }
  }
  const refresh = async () => {
    if (personal) { await loadOwn(); return }
    if (busy.current) return
    busy.current = true; setWorking(true); setError(""); setStatus("周辺の思い出を確認しています…")
    try {
      const api = await import("./placeMemoriesApi")
      await api.preparePlaces()
      if (!mounted.current) return
      const origin = locationSample(await requestPosition())
      if (!mounted.current) return
      if (origin.accuracy_m > 50) throw new Error("現在地の誤差が大きいため、屋外で更新してください（目安50m以内）。")
      const list = await api.findNearby(origin)
      if (!mounted.current) return
      replaceMemories(list, origin)
      setStatus(list.length ? `${list.length}個の思い出が見つかりました。` : "この近くには、まだ思い出がありません。最初のひとつを残しませんか。")
    } catch (cause) { showError(cause) }
    finally { busy.current = false; if (mounted.current) setWorking(false) }
  }
  const stagePhotos = async (produce: () => Promise<DraftPhoto[]>) => {
    if (busy.current) return
    busy.current = true; setWorking(true); setError("")
    let photos: DraftPhoto[] = []
    try {
      photos = await produce()
      if (!mounted.current) { photos.forEach(p => URL.revokeObjectURL(p.url)); return }
      const existing = draftRef.current
      if ((existing?.photos.length ?? 0) + photos.length > 10) throw new Error("ひとつの思い出に残せる写真は10枚までです。")
      const at = locationSample(await requestPosition())
      if (!mounted.current) { photos.forEach(p => URL.revokeObjectURL(p.url)); return }
      if (at.accuracy_m > 50) throw new Error("撮影地点の誤差が大きいため、屋外で撮り直してください（目安50m以内）。")
      if (existing && relativePlace(existing.location, at).distance > 15) throw new Error("場所が変わっています。先に今の思い出を残すか、撮り直してください。")
      replaceDraft({ id: existing?.id ?? crypto.randomUUID(), title: existing?.title ?? "", location: at,
        photos: [...(existing?.photos ?? []), ...photos] })
      setConsent(false); setStatus("")
    } catch (cause) { photos.forEach(p => URL.revokeObjectURL(p.url)); showError(cause) }
    finally { busy.current = false; if (mounted.current) setWorking(false) }
  }
  const selectPhotos = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []); event.target.value = ""
    if (!files.length) return
    void stagePhotos(async () => {
      if (files.length > 10) throw new Error("一度に選べる写真は10枚までです。")
      const { preparePlacePhoto } = await import("./placePhotos")
      const photos: DraftPhoto[] = []
      try { for (const file of files) photos.push(await preparePlacePhoto(file)); return photos }
      catch (cause) { photos.forEach(p => URL.revokeObjectURL(p.url)); throw cause }
    })
  }
  const publish = async () => {
    const value = draftRef.current
    if (!value || !consent || busy.current) return
    busy.current = true; setWorking(true); setError(""); setStatus("この場所に思い出を残しています…")
    try {
      const age = Date.now() - Date.parse(value.location.captured_at)
      if (age > 300000) throw new Error("撮影位置を取得してから時間が経ちました。写真を追加し、現在地を確認し直してください。")
      const api = await import("./placeMemoriesApi")
      const memory = await api.publishPlace(value)
      if (!mounted.current) return
      const list = [...memoriesRef.current.filter(m => m.id !== memory.id), memory]
      replaceMemories(list, value.location)
      value.photos.forEach(p => URL.revokeObjectURL(p.url))
      replaceDraft(null); setConsent(false); setStatus("この場所に思い出を残しました。近くを訪れる人も見ることができます。")
    } catch (cause) { showError(cause) }
    finally { busy.current = false; if (mounted.current) setWorking(false) }
  }
  const forgetLocation = async () => {
    if (busy.current) return
    busy.current = true; setWorking(true); setError("")
    try {
      const { deletePrivateLocation } = await import("./privateLocationApi")
      await deletePrivateLocation()
      if (!mounted.current) return
      if (locationRef.current) scene.current?.setMemories([], locationRef.current)
      locationRef.current = null; memoriesRef.current = []
      setLocated(false); setMemories([]); setRing(null)
      setStatus("本人用の現在地を削除しました。公開した思い出の撮影地点は残ります。")
    } catch (cause) { showError(cause) }
    finally { busy.current = false; if (mounted.current) setWorking(false) }
  }
  const remove = async () => {
    if (!ring?.owned || !confirmDelete || busy.current) return
    busy.current = true; setWorking(true); setError("")
    try {
      const { deletePlace } = await import("./placeMemoriesApi")
      await deletePlace(ring.id)
      if (!mounted.current) return
      replaceMemories(memoriesRef.current.filter(m => m.id !== ring.id), locationRef.current ?? undefined)
      setRing(null); setConfirmDelete(false); setStatus("この場所から思い出と写真を削除しました。")
    } catch (cause) { showError(cause) }
    finally { busy.current = false; if (mounted.current) setWorking(false) }
  }
  const saveTitle = async () => {
    if (!ring?.owned || busy.current) return
    busy.current = true; setWorking(true); setError("")
    try {
      const { renamePlace } = await import("./placeMemoriesApi")
      await renamePlace(ring.id, newTitle)
      if (!mounted.current) return
      const title = newTitle.trim() || "この場所の思い出"
      memoriesRef.current = memoriesRef.current.map(m => m.id === ring.id ? { ...m, title } : m)
      scene.current?.updateTitle(ring.id, title); setMemories(memoriesRef.current); setRing({ ...ring, title }); setRename(false)
    } catch (cause) { showError(cause) }
    finally { busy.current = false; if (mounted.current) setWorking(false) }
  }
  const errorBox = error && <p role="alert" className="place-error">{error}</p>
  return <main ref={root} className="place-experience" data-camera={camera}>
    <div ref={layer} className="place-canvas" />
    <header className="ov-top">
      <span className="ov-brand"><img className="ov-logo" src="/brand/memoria-logo.png" alt="memoria" width={1972} height={468} /></span>
      <span />
      <span className="ov-chip" data-on={personal || located}><span aria-hidden="true" />{personal ? `自分の思い出 ${memories.length}個` : located ? `近くの思い出 ${memories.length}個` : "場所の思い出"}</span>
    </header>
    {camera === "web" && memories.length === 0 && !working && <section className="place-intro" aria-labelledby="place-heading">
      <p className="place-kicker">写真と、場所と、思い出。</p>
      <h1 id="place-heading">{personal ? <>思い出が、<br /><span>ここに集まる。</span></> : <>この場所に、<br /><span>思い出を浮かべよう。</span></>}</h1>
      <p>{personal ? <>自分が残した写真を、シャボン玉の中に。<br />泡を選んで、あの日の時間へ。</> : <>写真を選んで、この場所に残す。<br />また訪れた日も、はじめて来た誰かにも。</>}</p>
      <button className="ov-pill ov-hero-start" onClick={() => personal ? onCreate?.() : void refresh()}>{personal ? "この場所に思い出を残す" : "近くの思い出を探す"}</button>
      <small>{personal ? "このブラウザーで残した思い出を表示します。" : "公開するまで、写真は端末の中に。"}</small>
    </section>}
    {camera === "starting" && <p className="place-loading" role="status">WebXRを準備しています…</p>}
    {cameraActive && <aside className="place-tools" aria-label="表示と場所の操作">
      <button className="ov-pill" disabled={working || Boolean(ring)} onClick={() => void refresh()}>{working ? "確認しています…" : personal ? "思い出を更新" : "周辺を更新"}</button>
      {camera === "ar" && !personal && <>
        <button className="ov-pill" onClick={() => void orient()}>{oriented ? "方位センサー使用中" : "方位センサーを使う"}</button>
        <button className="ov-pill" onClick={() => { scene.current?.alignNorth(); setOriented(true); setStatus("正面を北に合わせました。") }}>正面を北に合わせる</button>
      </>}
      {camera === "web" ? <button className="ov-pill" disabled={!arSupported || working || Boolean(ring)} onClick={() => void startXR("ar")}>{arSupported ? "WebXRで見る" : "WebXR非対応"}</button>
        : <button className="ov-pill" onClick={() => { release(); setCamera("web"); setRing(null); setPhoto(null); setStatus("") }}>Web表示に戻る</button>}
      {!personal && <details className="place-privacy"><summary>位置情報と公開について</summary><p>周辺更新時の現在地は、本人用に最新1件だけ保存します。公開した思い出の撮影地点は、現在地を削除しても残ります。</p><button className="place-text" disabled={working} onClick={() => void forgetLocation()}>保存した現在地を削除</button></details>}
    </aside>}
    <div className="place-notices" aria-live="polite">
      {status && <p className="place-status" role="status">{status}</p>}
      {!draft && !photo && errorBox}
      {camera === "ar" && !personal && !oriented && <p className="place-subtle">北を向いて正面を合わせてください。</p>}
      {camera === "web" && memories.length > 0 && <p className="place-subtle">カーソルを合わせて見る · 押して思い出の中へ · ドラッグで見回す</p>}
    </div>
    {cameraActive && !ring && <div className="ov-dock place-dock">
      <div className="ov-row">
        {personal ? <div className="ov-composer place-gallery-controls">
          <button className="ov-pill" disabled={working || page === 0} onClick={() => setPage(value => value - 1)}>前へ</button>
          <span className="place-prompt">自分の思い出 · {page + 1}ページ</span>
          <button className="ov-pill" disabled={working || !hasMore} onClick={() => setPage(value => value + 1)}>次へ</button>
        </div> : <div className="ov-composer"><button className="ov-icon" aria-label="写真を選ぶ" disabled={working} onClick={() => picker.current?.click()}>＋</button>
          <span className="ov-composer-prompt place-prompt">この場所に、思い出を残す</span>
          <button className="ov-pill place-shutter" disabled={working} onClick={() => picker.current?.click()}>写真を選ぶ</button></div>}
        {camera === "web" && <div className="ov-vr" data-ready={vrSupported}>
          <button type="button" disabled={!vrSupported || working} onClick={() => void startXR("vr")}>{vrSupported ? "VRで見る" : "VR非対応"}</button>
        </div>}
      </div>
      <p className="ov-foot">{personal ? "このブラウザーで残した思い出 · 泡を押して写真を見る" : "周辺50mの思い出 · 周囲の環境はWebXRで表示"}</p>
    </div>}
    {ring && <section className="place-ring-toolbar" aria-label="思い出の操作">
      <p>{ring.title} · {ring.photos.length}枚の写真{locationRef.current ? ` · 約${Math.round(relativePlace(locationRef.current, ring).distance)}m` : ""}</p>
      <button className="ov-pill" onClick={() => { setPhoto(null); scene.current?.back() }}>戻る</button>
      {ring.owned && !rename && !confirmDelete && <><button className="ov-pill" onClick={() => { setNewTitle(ring.title); setRename(true) }}>タイトルを編集</button><button className="place-text" onClick={() => setConfirmDelete(true)}>削除</button></>}
      {rename && <form onSubmit={event => { event.preventDefault(); void saveTitle() }}><input aria-label="思い出のタイトル" maxLength={80} value={newTitle} onChange={e => setNewTitle(e.target.value)} /><button className="ov-pill" disabled={working}>保存</button><button className="place-text" type="button" disabled={working} onClick={() => setRename(false)}>やめる</button></form>}
      {confirmDelete && <><p>この場所から写真と位置情報を削除します。</p><button className="ov-pill" disabled={working} onClick={() => void remove()}>思い出を削除する</button><button className="place-text" disabled={working} onClick={() => setConfirmDelete(false)}>やめる</button></>}
    </section>}
    <input ref={picker} type="file" aria-label="場所に残す写真を選ぶ" accept="image/jpeg,image/png,image/webp" multiple className="place-file-input" onChange={selectPhotos} />
    {draft && <dialog ref={draftDialog} className="memory-draft place-draft" aria-labelledby="place-draft-title" onCancel={event => { event.preventDefault(); discardDraft() }}>
      <h2 id="place-draft-title">この場所に残す</h2>
      <p className="place-draft-note">写真と撮影地点は、公開後にこの場所を訪れる人が見られます。</p>
      <div className="place-photo-grid">{draft.photos.map(p => <figure key={p.id}><img src={p.url} alt="公開前の写真" /><button type="button" className="place-photo-remove" disabled={working || draft.photos.length === 1} aria-label="この写真を外す" onClick={() => { URL.revokeObjectURL(p.url); replaceDraft({ ...draft, photos: draft.photos.filter(x => x.id !== p.id) }); setConsent(false) }}>×</button></figure>)}</div>
      <label className="place-title-label">思い出のタイトル<input autoFocus maxLength={80} placeholder="この場所で、どんな時間を過ごしましたか" value={draft.title} disabled={working} onChange={e => replaceDraft({ ...draft, title: e.target.value })} /></label>
      <p className="place-location-note">撮影地点 {draft.location.latitude.toFixed(5)}, {draft.location.longitude.toFixed(5)} · 取得精度 約{Math.round(draft.location.accuracy_m)}m</p>
      <label className="place-consent"><input type="checkbox" checked={consent} disabled={working} onChange={e => setConsent(e.target.checked)} />写真と撮影地点を、この場所を訪れる人に公開する</label>
      <small>匿名ユーザーとして保存します。ブラウザーのデータを消すと、編集・削除するためのアクセスを失う場合があります。</small>
      {errorBox}
      <div className="place-dialog-actions"><button className="place-text" disabled={working} onClick={discardDraft}>撮り直す</button><button className="ov-pill" disabled={working || draft.photos.length >= 10} onClick={() => picker.current?.click()}>写真を追加</button><button className="ov-pill place-shutter" disabled={!consent || working} onClick={() => void publish()}>{working ? "残しています…" : "この場所に残す"}</button></div>
    </dialog>}
    {photo && <dialog ref={photoDialog} className="place-photo-view" aria-label={photo.memory.title} onCancel={() => setPhoto(null)}>
      <button className="ov-pill place-photo-close" onClick={() => setPhoto(null)}>戻る</button>
      <img src={photo.memory.photos[photo.index]} alt={`${photo.memory.title} 写真${photo.index + 1}`} onError={() => setError("写真の表示期限が切れました。一度戻って周辺を更新してください。 ")} />
      <p>{photo.memory.title} · {photo.index + 1}/{photo.memory.photos.length}</p>
      <div className="place-photo-nav"><button className="ov-pill" disabled={photo.index === 0} onClick={() => setPhoto({ ...photo, index: photo.index - 1 })}>前の写真</button><button className="ov-pill" disabled={photo.index === photo.memory.photos.length - 1} onClick={() => setPhoto({ ...photo, index: photo.index + 1 })}>次の写真</button></div>
      {errorBox}
    </dialog>}
  </main>
}
