import CodeBlock from '@tiptap/extension-code-block'
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react'
import { lazy, Suspense } from 'react'
import type { ReactNodeViewProps } from '@tiptap/react'

// Monaco is large, so it only loads once a note actually contains a code block.
const CodeBlockView = lazy(() => import('./CodeBlockView'))

function LazyCodeBlock(props: ReactNodeViewProps) {
  return <Suspense fallback={<NodeViewWrapper className="note-code" contentEditable={false}><pre className="note-code-loading">{props.node.textContent}</pre></NodeViewWrapper>}><CodeBlockView {...props} /></Suspense>
}

// Same node as the built-in code block (so saved notes still load), but edited with Monaco.
export const MonacoCodeBlock = CodeBlock.extend({
  // The text is edited inside Monaco, not by ProseMirror, so the block is selected as a whole.
  atom: true,
  addNodeView() {
    return ReactNodeViewRenderer(LazyCodeBlock, {
      className: 'note-code-node',
      // Monaco handles its own keys, mouse and DOM; ProseMirror must stay out of it.
      stopEvent: () => true,
      ignoreMutation: () => true
    })
  }
}).configure({ defaultLanguage: 'plaintext', enableTabIndentation: false })
