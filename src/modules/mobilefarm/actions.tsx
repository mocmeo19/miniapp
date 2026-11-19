import { AppstoreOutlined, ArrowLeftOutlined, BellOutlined, CameraOutlined, HomeOutlined, PoweroffOutlined, RotateRightOutlined } from '@ant-design/icons'
import type { ReactNode } from 'react'

// Device actions shared by the device list and the mirror wall tiles; the main process runs them.
export const deviceActions: { action: string; label: string; icon: ReactNode }[] = [
  { action: 'back', label: 'Back', icon: <ArrowLeftOutlined /> },
  { action: 'home', label: 'Home', icon: <HomeOutlined /> },
  { action: 'recents', label: 'Recent apps', icon: <AppstoreOutlined /> },
  { action: 'power', label: 'Power / screen', icon: <PoweroffOutlined /> },
  { action: 'volume-up', label: 'Volume up', icon: '+' },
  { action: 'volume-down', label: 'Volume down', icon: '−' },
  { action: 'notifications', label: 'Notifications', icon: <BellOutlined /> },
  { action: 'rotate', label: 'Rotate', icon: <RotateRightOutlined /> },
  { action: 'screenshot', label: 'Screenshot (saved to Downloads)', icon: <CameraOutlined /> }
]
