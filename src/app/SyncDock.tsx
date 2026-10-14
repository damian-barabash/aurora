import { Check, CloudOff, RotateCw, TriangleAlert, Wifi } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button, cx, Modal, Spinner } from '../components/ui'
import { dismissFailure, useSync } from '../lib/sync'

/**
 * Mały znacznik w prawym dolnym rogu: „Zapisuję… 2/3” z paskiem postępu, potem na chwilę „Zapisano”.
 * Przy błędzie — okno, co się nie udało i dlaczego. Bez internetu — stały komunikat.
 */
export function SyncDock() {
  const s = useSync()
  const [, tick] = useState(0)
  const justSaved = s.running === 0 && Date.now() - s.savedAt < 1600
  // „Zapisano” znika samo
  useEffect(() => {
    if (!justSaved) return
    const t = setTimeout(() => tick((n) => n + 1), 1650)
    return () => clearTimeout(t)
  }, [justSaved, s.savedAt])
  // komunikat „wróciło połączenie” na moment po odzyskaniu sieci
  const [back, setBack] = useState(false)
  const [wasOffline, setWasOffline] = useState(!s.online)
  useEffect(() => {
    if (!s.online) return setWasOffline(true)
    if (!wasOffline) return
    setWasOffline(false)
    setBack(true)
    const t = setTimeout(() => setBack(false), 2500)
    return () => clearTimeout(t)
  }, [s.online, wasOffline])

  const f = s.failure
  const progress = s.total ? (s.done + 0.35) / s.total : 0
  const visible = !s.online || back || s.running > 0 || justSaved

  return (
    <>
      <div className={cx('sync', visible && 'is-on', !s.online && 'is-offline')} role="status" aria-live="polite">
        {!s.online ? (
          <><CloudOff size={14} /><span>Brak internetu — zmiany nie zapisują się</span></>
        ) : back ? (
          <><Wifi size={14} /><span>Połączenie wróciło</span></>
        ) : s.running > 0 ? (
          <>
            <Spinner size={12} />
            <span className="truncate">{s.label || 'Zapisuję'}…{s.total > 1 ? ` ${s.done}/${s.total}` : ''}</span>
            <i className="sync__bar"><i style={{ width: `${Math.min(100, progress * 100)}%` }} /></i>
          </>
        ) : (
          <><Check size={14} /><span>Zapisano</span></>
        )}
      </div>

      <Modal open={!!f} onClose={dismissFailure} width={460}
        title={f?.reason === 'offline' ? 'Brak połączenia' : 'Nie udało się zapisać'}
        footer={<>
          <Button onClick={dismissFailure}>Zamknij</Button>
          {f?.retry && <Button variant="primary" icon={<RotateCw size={16} />} onClick={() => { const r = f.retry!; dismissFailure(); r() }}>Spróbuj ponownie</Button>}
        </>}>
        {f && (
          <div className="syncerr">
            <span className="syncerr__icon">{f.reason === 'offline' ? <CloudOff size={22} /> : <TriangleAlert size={22} />}</span>
            <div>
              <b>{f.what}</b>
              <p>{f.why}</p>
              {f.detail && <small>{f.detail}</small>}
            </div>
          </div>
        )}
      </Modal>
    </>
  )
}
