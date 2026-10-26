import { lazy, Suspense, useEffect, useState } from "react"
import { HelpGuide } from "./HelpGuide"
import { NewExperience } from "./NewExperience"
import "./workspace.css"

const DemoModel = lazy(() => import("./App"))

type WorkspaceView = "create" | "mine" | "demo"
const currentView = (): WorkspaceView => location.hash === "#mine" ? "mine" : location.hash === "#demo" ? "demo" : "create"
export function Workspace() {
  const [mode, setView] = useState<WorkspaceView>(currentView)
  const setMode = (next: WorkspaceView) => { setView(next); location.hash = next }
  useEffect(() => {
    const sync = () => setView(currentView())
    window.addEventListener("hashchange", sync)
    return () => window.removeEventListener("hashchange", sync)
  }, [])
  return <div className="workspace" data-workspace={mode}>
    <nav className="experience-switch" aria-label="画面切替">
      <button type="button" aria-pressed={mode === "create"} onClick={() => setMode("create")}>場所の思い出</button>
      <button type="button" aria-pressed={mode === "mine"} onClick={() => setMode("mine")}>自分の思い出</button>
      <button type="button" aria-pressed={mode === "demo"} onClick={() => setMode("demo")}>デモモデル</button>
      <HelpGuide />
    </nav>
    {mode === "create" ? <NewExperience key={mode} view="nearby" />
      : <Suspense fallback={<p className="workspace-loading" role="status">デモを読み込んでいます…</p>}><DemoModel key={mode} personal={mode === "mine"} /></Suspense>}
  </div>
}
