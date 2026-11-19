import { DownloadOutlined } from '@ant-design/icons'
import { Button, Table, Tag, Tooltip, type TableColumnsType } from 'antd'
import { formatSize } from './format'
import type { DownloadOption } from './types'

type FormatTableProps = {
  kind: 'video' | 'audio'
  options: DownloadOption[]
  ffmpegAvailable: boolean
  /** The format currently (or last) downloaded, highlighted in the table. */
  activeId?: string
  disabled: boolean
  onDownload: (id: string) => void
}

type Row = DownloadOption & { height: number | null; fps: number | null; bitrate: number | null; hasAudio: boolean }

// History saved before structured fields existed only has the label, so read the details back from it.
function rowFrom(option: DownloadOption): Row {
  return {
    ...option,
    height: option.height ?? (Number(option.label.match(/^(\d+)p/)?.[1]) || null),
    fps: option.fps ?? (Number(option.label.match(/(\d+) fps/)?.[1]) || null),
    bitrate: option.bitrate ?? (Number(option.label.match(/(\d+) kbps/)?.[1]) || null),
    hasAudio: option.hasAudio ?? (option.kind === 'audio' || option.label.includes('with audio'))
  }
}

const bySize = (a: Row, b: Row) => (a.size ?? 0) - (b.size ?? 0)

export function FormatTable({ kind, options, ffmpegAvailable, activeId, disabled, onDownload }: FormatTableProps) {
  const rows = options.map(rowFrom)
  const unavailable = (row: Row) => row.requiresFfmpeg && !ffmpegAvailable
  const sizeColumn = { title: 'Size', dataIndex: 'size', align: 'right' as const, sorter: bySize, render: (size: number | null) => size ? formatSize(size) : <span className="youtube-format-muted">Unknown</span> }
  const formatColumn = { title: 'Format', dataIndex: 'extension', render: (extension: string) => <Tag>{(extension || '—').toUpperCase()}</Tag> }
  const downloadColumn = { key: 'download', width: 120, align: 'right' as const, render: (_: unknown, row: Row) =>
    <Button size="small" type={row.id === activeId ? 'primary' : 'default'} icon={<DownloadOutlined />} disabled={disabled || unavailable(row)}
      aria-label={`Download ${row.label}`} onClick={() => onDownload(row.id)}>Download</Button> }

  const columns: TableColumnsType<Row> = kind === 'video'
    ? [
      { title: 'Quality', dataIndex: 'height', sorter: (a, b) => (a.height ?? 0) - (b.height ?? 0), defaultSortOrder: 'descend',
        render: (height: number | null, row) => <span className="youtube-format-quality">{height ? `${height}p` : 'Video'}{row.fps && row.fps > 30 ? <Tag color="purple">{row.fps} fps</Tag> : null}</span> },
      formatColumn,
      { title: 'Audio', dataIndex: 'hasAudio', render: (hasAudio: boolean, row) => hasAudio
        ? <span>Included</span>
        : unavailable(row)
          ? <Tooltip title="Install ffmpeg to merge this video with the best audio"><span className="youtube-format-muted">Needs ffmpeg</span></Tooltip>
          : <span>Best audio added</span> },
      sizeColumn,
      downloadColumn
    ]
    : [
      formatColumn,
      { title: 'Bitrate', dataIndex: 'bitrate', sorter: (a, b) => (a.bitrate ?? 0) - (b.bitrate ?? 0), defaultSortOrder: 'descend',
        render: (bitrate: number | null) => bitrate ? `${bitrate} kbps` : <span className="youtube-format-muted">—</span> },
      sizeColumn,
      downloadColumn
    ]

  return <Table<Row>
    className="youtube-format-table"
    size="small"
    rowKey="id"
    pagination={false}
    scroll={{ y: 320 }}
    dataSource={rows}
    columns={columns}
    locale={{ emptyText: `No ${kind} formats are available.` }}
    rowClassName={(row) => [row.id === activeId ? 'is-selected' : '', unavailable(row) ? 'is-unavailable' : ''].join(' ')}
  />
}
