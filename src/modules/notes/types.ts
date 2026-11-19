export type NoteSummary = {
  id: string
  title: string
  /** First characters of the note's plain text. */
  preview: string
  pinned: boolean
  updatedAt: number
}

export type Note = NoteSummary & {
  /** Tiptap document as JSON text; empty for a new note. */
  content: string
  createdAt: number
}

export type NoteUpdate = { id: string; title?: string; content?: string; text?: string; pinned?: boolean }

/** Images pasted into a note are served from this scheme. */
export const notesImageScheme = 'miniapp-notes'
