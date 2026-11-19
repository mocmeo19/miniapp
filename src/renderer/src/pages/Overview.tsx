import { AppstoreOutlined, ArrowRightOutlined, BlockOutlined, DownloadOutlined, FolderOpenOutlined, PictureOutlined, PlusOutlined, TagOutlined } from '@ant-design/icons'
import { Avatar, Badge, Button, Card, Empty, Flex, Steps, Tag, Typography } from 'antd'
import { Link, useNavigate } from 'react-router-dom'
import { getModules, modulePath } from '../../../modules/core/renderer'
import type { InstalledModule } from '../../../modules/core/types'
import { useTheme } from '../theme/ThemeProvider'
import collectionArtwork from '../assets/studio-collection.svg'

const { Title, Text, Paragraph } = Typography
const shortcuts = [
  // The three accents of the Google Drive logo: green, yellow and blue.
  { path: '/library', title: 'Media library', label: 'YOUR COLLECTION', description: 'A home for your photos, videos, and audio.', action: 'Explore library', icon: <PictureOutlined />, light: 'bg-green-50 text-green-700', dark: 'bg-green-950 text-green-300' },
  { path: '/downloads', title: 'Downloads', label: 'SAVE SOMETHING GOOD', description: 'Bring files from the web into your workspace.', action: 'Open downloads', icon: <DownloadOutlined />, light: 'bg-amber-50 text-amber-600', dark: 'bg-amber-950 text-amber-300' },
  { path: '/modules', title: 'Make it your own', label: 'YOUR TOOLKIT', description: 'Add and manage tools that fit your workflow.', action: 'Manage modules', icon: <BlockOutlined />, light: 'bg-blue-50 text-blue-600', dark: 'bg-blue-950 text-blue-300' }
]
const focusRing = 'focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-(--accent)'
const eyebrow = 'text-[9px] font-semibold tracking-[.16em]'

export function Overview({ installed }: { installed: InstalledModule[] }) {
  const navigate = useNavigate()
  const { mode } = useTheme()
  const dark = mode === 'dark'
  const registry = getModules()
  const enabled = installed.filter((item) => item.enabled && (item.source !== 'built-in' || registry.some((module) => module.id === item.id)))

  return <div className="mx-auto max-w-[1500px] px-[38px] pt-[34px] pb-6 max-[1150px]:px-6 max-[1150px]:pt-7">
    <Flex component="header" align="center" justify="space-between" gap={20} className="mb-7">
      <div>
        <Text type="secondary" className={eyebrow}>YOUR CREATIVE WORKSPACE</Text>
        <Title level={1} className="mt-2 mb-2 text-[clamp(23px,2.3vw,32px)] leading-tight tracking-[-1.1px]">Welcome to Miniapp Studio<Text className="[font-size:inherit] text-(--accent)">.</Text></Title>
        <Paragraph type="secondary" className="mb-0 text-xs">A little more organized. A lot more possible.</Paragraph>
      </div>
      <Badge status="success" text={<Text type="secondary" className="text-[10px]">Your personal workspace</Text>} className="shrink-0 max-[1150px]:hidden" />
    </Flex>

    <section aria-labelledby="studio-hero-title">
      <Card className={`overflow-hidden rounded-[20px] ${dark ? 'border-green-900/40 bg-gradient-to-r from-[#15261c] to-[#1d3a29]' : 'border-green-100 bg-gradient-to-r from-[#f1f8f3] to-[#dcefe3]'}`} classNames={{ body: 'p-0' }}>
        <div className="grid min-h-[230px] grid-cols-[minmax(0,1.4fr)_minmax(220px,1fr)] max-[1150px]:grid-cols-[minmax(0,1.4fr)_minmax(180px,1fr)]">
          <div className="relative z-1 self-center py-[22px] pl-7 max-[1150px]:pl-[22px]">
            <Text className={`flex items-center gap-2 text-[9px] font-bold tracking-[.13em] ${dark ? 'text-green-200' : 'text-green-900/60'}`}><span className="text-base">✦</span> LESS SEARCHING. MORE CREATING.</Text>
            <Title id="studio-hero-title" level={2} className={`my-2.5 text-[28px] leading-[1.15] tracking-[-.8px] max-[1150px]:text-[25px] ${dark ? 'text-green-50' : 'text-[#15301f]'}`}>Everything you collect.<br /><Text className={`[font-size:inherit] ${dark ? 'text-green-300' : 'text-(--accent)'}`}>All together.</Text></Title>
            <Paragraph className={`mb-3.5 max-w-[390px] text-[11px] leading-[1.65] ${dark ? 'text-green-100/80' : 'text-[#56675b]'}`}>Give your media a place to belong. Organize your collection and find the right tools for your next idea.</Paragraph>
            <Button type="primary" icon={<FolderOpenOutlined />} onClick={() => navigate('/library')} className="text-[11px]">Open your library <ArrowRightOutlined /></Button>
          </div>
          <div className="relative min-w-0"><img src={collectionArtwork} alt="" className="absolute inset-0 m-auto h-full max-h-[250px] w-full object-contain" /></div>
        </div>
      </Card>
    </section>

    <section aria-labelledby="overview-shortcuts-title" className="mt-[30px]">
      <Flex align="center" justify="space-between" gap={12} className="mb-[17px]">
        <div><Title id="overview-shortcuts-title" level={2} className="m-0 text-base tracking-tight">Where would you like to start?</Title><Paragraph type="secondary" className="mt-1 mb-0 text-[11px]">Your everyday essentials, one click away.</Paragraph></div>
        <Text type="secondary" className="text-[8px] tracking-[.13em] max-[1150px]:hidden">EXPLORE YOUR WORKSPACE</Text>
      </Flex>
      <div className="grid grid-cols-3 gap-[15px]">
        {shortcuts.map((item) => <Link to={item.path} key={item.path} className={`group min-w-0 rounded-[14px] ${focusRing}`}>
          <Card hoverable className="h-full motion-reduce:transition-none" classNames={{ body: 'flex h-full flex-col p-[21px] max-[1150px]:p-[17px]' }}>
            <Flex align="center" justify="space-between" className="mb-5"><Avatar shape="square" size={41} icon={item.icon} className={`rounded-xl ${dark ? item.dark : item.light}`} /><ArrowRightOutlined className="-rotate-40 text-[13px] text-(--muted) transition-transform group-hover:rotate-0 motion-reduce:transition-none" /></Flex>
            <Text type="secondary" className="text-[8px] font-semibold tracking-[.12em]">{item.label}</Text>
            <Title level={3} className="my-[7px] text-[17px] tracking-tight">{item.title}</Title>
            <Paragraph type="secondary" className="mb-0 flex-1 text-[11px] leading-[1.7]">{item.description}</Paragraph>
            <Text className="mt-5 flex items-center gap-2 text-[10px] font-semibold text-(--accent)">{item.action}<ArrowRightOutlined /></Text>
          </Card>
        </Link>)}
      </div>
    </section>

    <div className="mt-6 grid grid-cols-[1.35fr_1fr] gap-5 max-[1150px]:grid-cols-1">
      <section aria-labelledby="overview-tools-title" className="min-w-0">
        <Card className="h-full" classNames={{ body: 'p-[23px]' }}>
          <Flex align="center" justify="space-between" gap={12} className="mb-[17px]">
            <Flex align="center" gap={10}><Title id="overview-tools-title" level={2} className="m-0 text-base">Your tools</Title><Tag variant="filled" className="m-0 text-[9px]">{enabled.length} enabled</Tag></Flex>
            <Button type="link" size="small" onClick={() => navigate('/modules')} className="text-[10px]">Manage <ArrowRightOutlined /></Button>
          </Flex>
          {enabled.length > 0 ? <div className="grid grid-cols-2 gap-x-3.5 gap-y-[7px]">{enabled.map((item) => {
            const module = registry.find((entry) => entry.id === item.id)
            return <Link key={item.id} to={modulePath(item.id)} className={`flex min-w-0 items-center gap-2.5 rounded-lg px-2 py-[13px] text-(--text) transition-colors hover:bg-(--canvas) motion-reduce:transition-none ${focusRing}`}>
              <Avatar shape="square" size={33} icon={module?.icon ?? <AppstoreOutlined />} className="shrink-0 border border-(--border) bg-transparent text-(--muted)" />
              <div className="min-w-0 flex-1"><Text strong className="block truncate text-[11px]">{module?.label ?? item.name}</Text><Text type="secondary" className="mt-1 block truncate text-[9px]">{item.description || (item.source === 'built-in' ? 'Built-in tool' : 'Installed module')}</Text></div>
              <ArrowRightOutlined className="text-[10px] text-(--muted)" />
            </Link>
          })}</div> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={<><Text strong>Room for your next favorite tool.</Text><Paragraph type="secondary" className="mt-2 text-xs">Enable an installed module or add a new one to get started.</Paragraph></>}><Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/modules')}>Explore modules</Button></Empty>}
        </Card>
      </section>

      <section aria-labelledby="overview-guide-title">
        <Card className={`h-full ${dark ? 'bg-(--accent-soft)' : 'bg-[#eef6f0]'}`} classNames={{ body: 'px-[26px] py-6' }}>
          <Text type="secondary" className={eyebrow}>A SIMPLE WORKFLOW</Text>
          <Title id="overview-guide-title" level={2} className="mt-2 mb-1 text-lg tracking-tight">From scattered to sorted.</Title>
          <Paragraph type="secondary" className="mb-4 text-[10px]">A little organization goes a long way.</Paragraph>
          <Steps orientation="vertical" size="small" current={-1} className="mb-3" items={[
            { title: <Text strong className="text-[11px]">Bring it all in</Text>, content: <Text type="secondary" className="text-[10px]">Add your media folders to the library.</Text>, icon: <FolderOpenOutlined /> },
            { title: <Text strong className="text-[11px]">Make it easy to find</Text>, content: <Text type="secondary" className="text-[10px]">Use tags to organize your collection.</Text>, icon: <TagOutlined /> },
            { title: <Text strong className="text-[11px]">Find your flow</Text>, content: <Text type="secondary" className="text-[10px]">Open a tool and make something happen.</Text>, icon: <AppstoreOutlined /> }
          ]} />
          <Button type="link" size="small" onClick={() => navigate('/library')} className="px-0 text-[10px]">Start with your library <ArrowRightOutlined /></Button>
        </Card>
      </section>
    </div>
    <Flex component="footer" align="center" justify="center" gap={7} className="pt-6"><Text type="secondary">✦</Text><Text type="secondary" className="text-[9px]">A space for your media. Room for your ideas.</Text></Flex>
  </div>
}
