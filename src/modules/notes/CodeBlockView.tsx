import Editor, { loader, type OnMount } from '@monaco-editor/react'
import { NodeViewWrapper, type ReactNodeViewProps } from '@tiptap/react'
import { Select } from 'antd'
import { useEffect, useRef, useState } from 'react'
import { useTheme } from '../../renderer/src/theme/ThemeProvider'
import * as monaco from 'monaco-editor'
import EditorWorker from 'monaco-editor/editor/editor.worker?worker'
import JsonWorker from 'monaco-editor/language/json/json.worker?worker'
import CssWorker from 'monaco-editor/language/css/css.worker?worker'
import HtmlWorker from 'monaco-editor/language/html/html.worker?worker'
import TsWorker from 'monaco-editor/language/typescript/ts.worker?worker'

// Use the bundled copy of Monaco instead of the CDN, so code blocks work offline.
self.MonacoEnvironment = {
  getWorker(_id, label) {
    if (label === 'json') return new JsonWorker()
    if (label === 'css' || label === 'scss' || label === 'less') return new CssWorker()
    if (label === 'html' || label === 'handlebars' || label === 'razor') return new HtmlWorker()
    if (label === 'typescript' || label === 'javascript') return new TsWorker()
    return new EditorWorker()
  }
}

loader.config({ monaco })

type MonacoEditor = Parameters<OnMount>[0]

const languages: { value: string; label: string }[] = [
  { value: 'plaintext', label: 'Plain text' }, { value: 'javascript', label: 'JavaScript' }, { value: 'typescript', label: 'TypeScript' },
  { value: 'json', label: 'JSON' }, { value: 'html', label: 'HTML' }, { value: 'css', label: 'CSS' }, { value: 'scss', label: 'SCSS' },
  { value: 'markdown', label: 'Markdown' }, { value: 'python', label: 'Python' }, { value: 'java', label: 'Java' }, { value: 'kotlin', label: 'Kotlin' },
  { value: 'csharp', label: 'C#' }, { value: 'cpp', label: 'C++' }, { value: 'c', label: 'C' }, { value: 'go', label: 'Go' }, { value: 'rust', label: 'Rust' },
  { value: 'php', label: 'PHP' }, { value: 'ruby', label: 'Ruby' }, { value: 'swift', label: 'Swift' }, { value: 'dart', label: 'Dart' },
  { value: 'sql', label: 'SQL' }, { value: 'shell', label: 'Shell' }, { value: 'powershell', label: 'PowerShell' }, { value: 'yaml', label: 'YAML' },
  { value: 'xml', label: 'XML' }, { value: 'dockerfile', label: 'Dockerfile' }, { value: 'graphql', label: 'GraphQL' }
]

// Names people type after ``` that Monaco knows under another id.
const aliases: Record<string, string> = {
  js: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript', py: 'python', sh: 'shell', bash: 'shell', zsh: 'shell',
  yml: 'yaml', md: 'markdown', 'c++': 'cpp', cs: 'csharp', kt: 'kotlin', rb: 'ruby', golang: 'go', rs: 'rust', text: 'plaintext', txt: 'plaintext'
}

function monacoLanguage(value: unknown): string {
  const name = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if (!name) return 'plaintext'
  return aliases[name] ?? name
}

const lineHeight = 19
const maxHeight = 560

export default function CodeBlockView({ node, editor, getPos, updateAttributes, selected }: ReactNodeViewProps) {
  const { mode } = useTheme()
  const code = node.textContent
  const language = monacoLanguage(node.attrs.language)
  const [height, setHeight] = useState(() => Math.min(Math.max(code.split('\n').length, 1) * lineHeight + 20, maxHeight))
  const monacoRef = useRef<MonacoEditor | null>(null)

  // Arrowing onto the block from the surrounding text selects it; move the cursor into Monaco.
  useEffect(() => { if (selected) monacoRef.current?.focus() }, [selected])

  function writeBack(text: string) {
    const pos = getPos()
    if (typeof pos !== 'number' || editor.isDestroyed) return
    const current = editor.state.doc.nodeAt(pos)
    if (!current || current.textContent === text) return
    const { tr, schema } = editor.state
    tr.replaceWith(pos + 1, pos + 1 + current.content.size, text ? schema.text(text) : [])
    editor.view.dispatch(tr)
  }

  // Leave the code block and put the cursor back in the note, before or after it.
  function leave(after: boolean) {
    const pos = getPos()
    if (typeof pos !== 'number') return
    const target = after ? pos + node.nodeSize : pos
    const chain = editor.chain()
    if (after && target >= editor.state.doc.content.size) chain.insertContentAt(target, { type: 'paragraph' })
    chain.focus(after ? target + 1 : Math.max(target - 1, 0)).run()
  }

  const onMount: OnMount = (instance, monaco) => {
    monacoRef.current = instance
    instance.onDidContentSizeChange(({ contentHeight }) => setHeight(Math.min(contentHeight, maxHeight)))
    instance.onKeyDown((event) => {
      const model = instance.getModel()
      const position = instance.getPosition()
      if (!model || !position) return
      const lastLine = model.getLineCount()
      if (event.keyCode === monaco.KeyCode.UpArrow && position.lineNumber === 1) { event.preventDefault(); leave(false) }
      else if (event.keyCode === monaco.KeyCode.DownArrow && position.lineNumber === lastLine) { event.preventDefault(); leave(true) }
      else if (event.keyCode === monaco.KeyCode.Escape) { event.preventDefault(); leave(true) }
      else if (event.keyCode === monaco.KeyCode.Backspace && model.getValueLength() === 0) {
        event.preventDefault()
        const pos = getPos()
        if (typeof pos === 'number') editor.chain().focus().deleteRange({ from: pos, to: pos + node.nodeSize }).run()
      }
    })
    if (selected) instance.focus()
  }

  return <NodeViewWrapper className="note-code" data-language={language} contentEditable={false}>
    <div className="note-code-head">
      <Select size="small" variant="borderless" showSearch popupMatchSelectWidth={false} value={languages.some((item) => item.value === language) ? language : 'plaintext'}
        options={languages} onChange={(value: string) => updateAttributes({ language: value })} className="note-code-language" aria-label="Code language" />
      <button type="button" className="note-code-copy" onClick={() => void navigator.clipboard.writeText(code)}>Copy</button>
    </div>
    <Editor height={height} language={language} value={code} theme={mode === 'dark' ? 'vs-dark' : 'vs'} onMount={onMount}
      onChange={(value) => writeBack(value ?? '')} loading={<pre className="note-code-loading">{code}</pre>}
      options={{
        minimap: { enabled: false }, scrollBeyondLastLine: false, automaticLayout: true, wordWrap: 'on', fontSize: 12.5, lineHeight,
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', padding: { top: 10, bottom: 10 }, renderLineHighlight: 'none',
        overviewRulerLanes: 0, hideCursorInOverviewRuler: true, folding: false, lineNumbersMinChars: 3, tabSize: 2, readOnly: !editor.isEditable,
        scrollbar: { alwaysConsumeMouseWheel: false, verticalScrollbarSize: 8, horizontalScrollbarSize: 8 }, contextmenu: true, stickyScroll: { enabled: false }
      }} />
  </NodeViewWrapper>
}
