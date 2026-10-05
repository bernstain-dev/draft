import { CircleX, RefreshCw } from 'lucide-react';
import AppIcon from './AppIcon';
export default function QueryState({ query, label = 'clinic data' }: { query: { loading: boolean; error: string | null; retry: () => void; retrying?: boolean }; label?: string }) {
  if (query.loading) return <p role="status" className="dk-panel icon-label"><AppIcon icon={RefreshCw} className="animate-spin" />{query.retrying ? 'Retrying' : 'Loading'} {label}…</p>;
  if (query.error) return <div role="alert" className="dk-panel space-y-2"><p className="icon-label"><AppIcon icon={CircleX} /><span>{query.error}</span></p><button className="dk-btn-primary icon-button" onClick={query.retry}><AppIcon icon={RefreshCw} size={17} />Retry</button></div>;
  return null;
}
