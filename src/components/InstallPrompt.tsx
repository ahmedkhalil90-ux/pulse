import { useEffect, useState } from 'react';
import { Download, Share, X } from 'lucide-react';
import { t } from '../lib/i18n';

type BIP = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
const KEY = 'pulse.installDismissed';
const standalone = () => window.matchMedia?.('(display-mode: standalone)').matches || (navigator as any).standalone === true;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent);

/** "Add Pulse to your home screen": one tap on Android, short instructions on iPhone. */
export function InstallPrompt() {
  const [evt, setEvt] = useState<BIP | null>(null);
  const [hidden, setHidden] = useState(() => { try { return standalone() || !!localStorage.getItem(KEY); } catch { return standalone(); } });
  useEffect(() => {
    const onPrompt = (e: Event) => { e.preventDefault(); setEvt(e as BIP); };
    window.addEventListener('beforeinstallprompt', onPrompt);
    return () => window.removeEventListener('beforeinstallprompt', onPrompt);
  }, []);
  if (hidden || (!evt && !isIOS())) return null;
  const dismiss = () => { setHidden(true); try { localStorage.setItem(KEY, '1'); } catch { /* ignore */ } };
  return (
    <div className="mb-4 rounded-2xl border border-white/10 bg-zinc-900/60 p-4 flex items-start gap-3" data-testid="install-prompt">
      <Download className="w-5 h-5 text-white shrink-0 mt-0.5" />
      <div className="flex-1 space-y-2">
        <p className="text-sm font-bold">{t("Add Pulse to your home screen")}</p>
        {evt ? (
          <button onClick={async () => { await evt.prompt(); await evt.userChoice.catch(() => null); dismiss(); }}
            className="px-4 py-2 rounded-xl bg-white text-black text-xs font-bold">{t("Install")}</button>
        ) : (
          <p className="text-xs text-zinc-400 flex items-center gap-1 flex-wrap">{t("Tap")} <Share className="w-3.5 h-3.5 inline" /> {t("then \"Add to Home Screen\".")}</p>
        )}
      </div>
      <button onClick={dismiss} aria-label={t("Close")} className="text-zinc-500 hover:text-white"><X className="w-4 h-4" /></button>
    </div>
  );
}
