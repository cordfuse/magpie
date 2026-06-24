import Home from '../../_Home'
import { loadQuillConfig } from '@/lib/config'

// Dynamic route /c/<convId>. Passes the URL's conv id as initialConvId
// so a hard refresh (or shared link) on a conv URL restores that
// conversation. Soft in-app navigation updates the URL via
// history.replaceState — that doesn't re-mount Home, so drafts and
// sidebar state survive between conv switches.
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { config } = loadQuillConfig()
  return <Home initialConvId={id} appName={config.name} />
}
