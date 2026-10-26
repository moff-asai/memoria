import { useEffect, useRef, useState } from "react"

/** The "?" beside the logo opens the usage guide on every page. */
export function HelpGuide() {
  const [open, setOpen] = useState(false)
  const dialogRef = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = dialogRef.current
    if (!open || !dialog) return
    // Native modal behavior keeps focus inside and makes the scene behind it inert.
    dialog.showModal()
    return () => dialog.close()
  }, [open])
  return (
    <>
      <button type="button" className="ov-help" aria-label="はじめての使い方" aria-haspopup="dialog" onClick={() => setOpen(true)}>
        ?
      </button>
      {open && (
        <dialog
          ref={dialogRef}
          className="ov-hero"
          aria-labelledby="welcome-title"
          onCancel={(event) => {
            event.preventDefault()
            setOpen(false)
          }}
          onKeyDown={(event) => event.stopPropagation()}
        >
          <h2 id="welcome-title" className="ov-hero-title">はじめての使い方</h2>
          <ol className="ov-hero-steps">
            <li><span><strong>見る</strong>：球体にカーソルを合わせる</span></li>
            <li><span><strong>入る</strong>：押すと記憶のなかへ</span></li>
            <li><span><strong>戻る</strong>：いつでも1つ前に戻れる</span></li>
          </ol>
          <button type="button" className="ov-pill ov-hero-start" onClick={() => setOpen(false)} autoFocus>
            閉じる
          </button>
        </dialog>
      )}
    </>
  )
}
