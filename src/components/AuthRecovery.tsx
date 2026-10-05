import { CircleX, LogOut, RefreshCw } from 'lucide-react';
import AppIcon from './AppIcon';
export default function AuthRecovery({ error, retry, signOut }: { error: string; retry: () => Promise<void>; signOut: () => Promise<void> }) {
  return <div className="dk-panel m-8 space-y-3" role="alert">
    <p className="icon-label"><AppIcon icon={CircleX} /><span>{error}</span></p>
    <button className="icon-button dk-btn-primary" onClick={() => void retry()}><AppIcon icon={RefreshCw} size={17} />Retry account loading</button>
    <button className="icon-button dk-btn-ghost ml-2" onClick={() => void signOut()}><AppIcon icon={LogOut} size={17} />Sign out</button>
  </div>;
}
