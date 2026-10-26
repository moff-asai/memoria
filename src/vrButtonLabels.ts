// three.js's VRButton writes English labels as the session state changes;
// the page speaks Japanese, so swap each one as soon as it is written.
const LABELS: Record<string, string> = {
  "ENTER VR": "VRで見る",
  "EXIT VR": "VRを終了",
  "VR NOT SUPPORTED": "VR非対応",
  "VR NOT ALLOWED": "VRを利用できません",
  "WEBXR NEEDS HTTPS": "VRにはHTTPS接続が必要です",
  "WEBXR NOT AVAILABLE": "このブラウザーはVR非対応",
}

/**
 * Keeps a VRButton element's label in Japanese. Mutation callbacks run before
 * the next paint, so the English label is never shown. Returns a disposer.
 */
export function localizeVRButton(element: HTMLElement) {
  const translate = () => {
    const label = LABELS[element.textContent?.trim() ?? ""]
    if (label) element.textContent = label
  }
  translate()
  const observer = new MutationObserver(translate)
  observer.observe(element, {
    childList: true,
    characterData: true,
    subtree: true,
  })
  return () => observer.disconnect()
}
