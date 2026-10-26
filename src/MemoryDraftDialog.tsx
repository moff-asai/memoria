import {
  createElement,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type SyntheticEvent,
} from "react"
import { ActionButton } from "./SphereControls"
import { MAX_DRAFT_PHOTOS, type MemoryDraft } from "./memoryDraft"

type DraftPreview = {
  file: File
  url: string
}

export function MemoryDraftDialog({
  draft,
  publishing,
  error,
  onTitleChange,
  onRemove,
  onAdd,
  onPublish,
  onDiscard,
  onDrop,
}: {
  draft: MemoryDraft
  publishing: boolean
  error: string
  onTitleChange: (title: string) => void
  onRemove: (index: number) => void
  onAdd: () => void
  onPublish: () => void
  onDiscard: () => void
  onDrop: (files: FileList) => void
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [previews, setPreviews] = useState<DraftPreview[]>([])
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const [dragging, setDragging] = useState(false)
  const selected = Math.min(selectedIndex, Math.max(0, draft.files.length - 1))
  // Only use previews belonging to the current files while the effect catches up.
  const photo = previews.find(({ file }) => file === draft.files[selected])

  useEffect(() => {
    const dialog = dialogRef.current!
    dialog.showModal()
    return () => dialog.close()
  }, [])

  useEffect(() => {
    const next = draft.files.map((file) => ({
      file,
      url: URL.createObjectURL(file),
    }))
    setPreviews(next)
    return () => next.forEach(({ url }) => URL.revokeObjectURL(url))
  }, [draft.files])

  useEffect(() => {
    // Disabling the focused control can send focus outside the modal.
    if (publishing) dialogRef.current?.focus()
  }, [publishing])

  const requestClose = () => {
    if (publishing) return
    if (!draft.files.length && !draft.title.trim()) onDiscard()
    else setConfirmDiscard(true)
  }
  const cancelDraft = () => {
    if (confirmDiscard) setConfirmDiscard(false)
    else requestClose()
  }

  return createElement(
    "dialog",
    {
      ref: dialogRef,
      className: "ov-hero memory-draft",
      tabIndex: -1,
      "aria-labelledby": "draft-title",
      "aria-describedby": "draft-description",
      "aria-busy": publishing,
      "data-dragging": dragging,
      onCancel: (event: SyntheticEvent<HTMLDialogElement>) => {
        event.preventDefault()
        cancelDraft()
      },
      onKeyDown: (event: KeyboardEvent<HTMLDialogElement>) => {
        event.stopPropagation()
        if (event.key === "Escape") {
          // Handle Escape before the browser's native dialog-close action.
          event.preventDefault()
          cancelDraft()
        }
      },
      onDragOver: (event) => {
        event.preventDefault()
        event.stopPropagation()
        if (!publishing && event.dataTransfer.types.includes("Files"))
          setDragging(true)
      },
      onDragLeave: (event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null))
          setDragging(false)
      },
      onDrop: (event) => {
        event.preventDefault()
        event.stopPropagation()
        setDragging(false)
        if (!publishing && !confirmDiscard) onDrop(event.dataTransfer.files)
      },
    },
    <header className="draft-header">
      <div>
        <p className="draft-eyebrow">写真から、ひとつの記憶へ</p>
        {createElement(
          "h2",
          { id: "draft-title", className: "ov-hero-title" },
          "記憶をつくる",
        )}
      </div>
      <span className="draft-badge">未公開</span>
      <ActionButton
        className="ov-icon"
        aria-label="作成を閉じる"
        disabled={publishing}
        onClick={requestClose}
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <path d="m6 6 12 12M18 6 6 18" />
        </svg>
      </ActionButton>
    </header>,
    <p id="draft-description" className="draft-description">
      写真を追加して、内容を確かめてから公開できます。
    </p>,
    <div className="draft-body" inert={confirmDiscard}>
      <section className="draft-photos" aria-label="公開する写真">
        <figure className="draft-preview">
          {photo ? (
            <>
              <img
                src={photo.url}
                alt={`公開前の写真 ${selected + 1}：${photo.file.name}`}
              />
              <figcaption>
                {selected + 1} / {draft.files.length}
              </figcaption>
            </>
          ) : (
            <div className="draft-empty">
              <p>この記憶に残す写真を選びましょう</p>
              <ActionButton
                className="ov-pill"
                onClick={onAdd}
                disabled={publishing}
              >
                写真を選ぶ
              </ActionButton>
            </div>
          )}
        </figure>
        <div className="draft-photo-heading">
          <span aria-live="polite">
            写真 {draft.files.length} / {MAX_DRAFT_PHOTOS}枚
          </span>
          <span>選ぶと大きく表示</span>
        </div>
        <ol className="draft-thumbnails">
          {draft.files.map((file, index) => {
            const preview = previews.find((item) => item.file === file)
            return (
              <li
                key={`${file.name}-${file.size}-${file.lastModified}-${file.type}`}
              >
                <ActionButton
                  className="draft-thumbnail"
                  aria-label={`写真 ${index + 1}を確認：${file.name}`}
                  aria-pressed={selected === index}
                  onClick={() => setSelectedIndex(index)}
                >
                  {preview && <img src={preview.url} alt="" />}
                  <span className="draft-photo-number" aria-hidden="true">
                    {index + 1}
                  </span>
                </ActionButton>
                <ActionButton
                  className="draft-remove"
                  aria-label={`写真 ${index + 1}を削除`}
                  disabled={publishing}
                  onClick={() => onRemove(index)}
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    aria-hidden="true"
                  >
                    <path d="m6 6 12 12M18 6 6 18" />
                  </svg>
                </ActionButton>
              </li>
            )
          })}
        </ol>
        <ActionButton
          className="ov-pill draft-add"
          onClick={onAdd}
          disabled={publishing || draft.files.length >= MAX_DRAFT_PHOTOS}
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="M12 5v14M5 12h14" />
          </svg>
          写真を追加
        </ActionButton>
        <p className="draft-help">JPEG・PNG・WebP · ドロップでも追加できます</p>
        {draft.notice && (
          <p className="draft-notice" role="status">
            {draft.notice}
          </p>
        )}
      </section>
      <form
        className="draft-details"
        onSubmit={(event) => {
          event.preventDefault()
          if (draft.files.length && !publishing) onPublish()
        }}
      >
        <div className="draft-title-label">
          {createElement(
            "label",
            { htmlFor: "draft-memory-title" },
            "記憶のタイトル",
          )}
          <span>任意</span>
        </div>
        {createElement("input", {
          id: "draft-memory-title",
          className: "draft-title-input",
          value: draft.title,
          onChange: (event: ChangeEvent<HTMLInputElement>) =>
            onTitleChange(event.target.value),
          placeholder: "例：夏の終わり、海辺で",
          maxLength: 80,
          disabled: publishing,
          "aria-describedby": "draft-title-help",
        })}
        <p id="draft-title-help" className="draft-help">
          タイトルは、写真を見ながらゆっくりと。
        </p>
        <div className="draft-sharing">
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="9" />
            <ellipse cx="12" cy="12" rx="4" ry="9" />
            <path d="M3 12h18" />
          </svg>
          <div>
            <strong>みんなの空間に公開</strong>
            <p>
              選んだ写真が、ひとつの記憶になります。「公開する」を押すまで、写真は送信されません。
            </p>
            <p>公開後は写真を追加できません。</p>
          </div>
        </div>
        <div className="draft-publish">
          {error && (
            <p className="draft-notice" role="alert">
              {error}
            </p>
          )}
          <ActionButton
            type="submit"
            className="ov-pill ov-hero-start"
            disabled={publishing || !draft.files.length}
          >
            {publishing
              ? "公開しています…"
              : `${draft.files.length}枚の写真を公開する`}
          </ActionButton>
          <p className="draft-help" role="status">
            {publishing
              ? "このまま少しお待ちください"
              : "公開前なら、何度でも追加・削除できます"}
          </p>
        </div>
      </form>
    </div>,
    confirmDiscard && (
      <section className="draft-discard" aria-labelledby="draft-discard-title">
        {createElement(
          "h3",
          { id: "draft-discard-title" },
          "作成中の記憶を破棄しますか？",
        )}
        <p>選んだ写真とタイトルは保存されません。</p>
        <div className="draft-discard-actions">
          <ActionButton
            className="ov-pill"
            autoFocus
            onClick={() => setConfirmDiscard(false)}
          >
            編集を続ける
          </ActionButton>
          <ActionButton className="ov-pill ov-hero-start" onClick={onDiscard}>
            破棄する
          </ActionButton>
        </div>
      </section>
    ),
  )
}
