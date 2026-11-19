import { FileImageFilled, VideoCameraFilled } from '@ant-design/icons'
import type { LibraryFile } from '../../../../library/types'

export function FileTypeIcon({ kind }: { kind: LibraryFile['kind'] }) {
  return kind === 'image'
    ? <FileImageFilled className="drive-type-icon drive-type-image" />
    : <VideoCameraFilled className="drive-type-icon drive-type-video" />
}
