// @ts-nocheck
'use client'

import { useEffect, useState, useCallback } from 'react'

type PermissionState = 'granted' | 'denied' | 'prompt' | 'checking' | 'unsupported'

export function useLocationPermission() {
  const [state, setState] = useState<PermissionState>('checking')
  const [error, setError] = useState('')

  const check = useCallback(async () => {
    if (!('geolocation' in navigator)) {
      setState('unsupported')
      return
    }
    try {
      if ('permissions' in navigator && (navigator as any).permissions?.query) {
        const res = await (navigator as any).permissions.query({ name: 'geolocation' })
        setState(res.state as PermissionState)
        res.onchange = () => setState(res.state as PermissionState)
        return
      }
    } catch { }
    setState('prompt')
  }, [])

  const request = useCallback(async () => {
    setError('')
    if (!('geolocation' in navigator)) {
      setState('unsupported')
      setError('Geolocation not supported in this browser')
      return false
    }
    return new Promise<boolean>((resolve) => {
      navigator.geolocation.getCurrentPosition(
        () => {
          setState('granted')
          resolve(true)
        },
        (err) => {
          setError(err.message || 'Permission denied')
          setState(err.code === 1 ? 'denied' : 'prompt')
          resolve(false)
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
      )
    })
  }, [])

  useEffect(() => {
    void check()
  }, [check])

  return { state, error, request, check }
}

export default function LocationGate({
  children,
  onGranted,
}: {
  children: React.ReactNode
  onGranted?: () => void
}) {
  const { state, error, request } = useLocationPermission()
  const [requesting, setRequesting] = useState(false)
  const [showModal, setShowModal] = useState(false)
  const [showPleaseAllow, setShowPleaseAllow] = useState(false)
  const [showTips, setShowTips] = useState(false)

  const handleRequest = async () => {
    setRequesting(true)
    const ok = await request()
    setRequesting(false)
    if (ok) {
      setShowModal(false)
      setShowPleaseAllow(false)
      onGranted?.()
    } else {
      setShowPleaseAllow(true)
    }
  }

  useEffect(() => {
    if (state === 'granted') {
      setShowModal(false)
      setShowPleaseAllow(false)
    } else if (state === 'denied' || state === 'unsupported') {
      setShowModal(true)
    }
    // don't auto-show modal during 'prompt' — let user click to trigger
  }, [state])

  if (state === 'granted') return <>{children}</>

  const handleDisabledClick = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setShowModal(true)
    setShowPleaseAllow(true)
  }

  return (
    <>
      {state === 'checking' ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, gap: 10, color: 'var(--text)' }}>
          <div style={{ width: 18, height: 18, border: '2px solid var(--border)', borderTopColor: 'var(--accent)', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
          Checking location permission…
        </div>
      ) : (
        <div onClickCapture={handleDisabledClick} style={{ opacity: 0.6 }}>
          <div style={{ pointerEvents: 'none', opacity: 0.6 }}>{children}</div>
          {state !== 'granted' && (
            <p style={{ fontSize: 12, color: '#e5484d', textAlign: 'center', marginTop: 8 }}>
              Location permission required — click to allow
            </p>
          )}
        </div>
      )}

      {showModal && (
        <div className="location-modal-backdrop" onClick={() => setShowModal(false)}>
          <div className="location-modal" onClick={(e) => e.stopPropagation()}>
            <button className="location-modal-close" onClick={() => setShowModal(false)} aria-label="Close">
              ×
            </button>
            <h3 style={{ margin: '0 0 8px' }}>Location Permission Required</h3>
            {showPleaseAllow && (
              <p style={{ fontSize: 13, color: '#e5484d', fontWeight: 600, marginBottom: 8 }}>
                Please allow location first
              </p>
            )}
            <p style={{ fontSize: 14, color: 'var(--text)', marginBottom: 12 }}>
              Attendance needs your real-time location. Please allow location access to continue.
              {state === 'denied' && (
                <span style={{ display: 'block', marginTop: 6, color: '#e5484d' }}>
                  Permission denied. Please enable location manually.
                </span>
              )}
              {state === 'unsupported' && (
                <span style={{ display: 'block', marginTop: 6, color: '#e5484d' }}>Geolocation not supported</span>
              )}
            </p>

            {state === 'denied' && (
              <div style={{ textAlign: 'center', marginBottom: 12 }}>
                <button className="btn" onClick={() => setShowTips(true)} style={{ fontSize: 13 }}>
                  Tips
                </button>
              </div>
            )}

            {showTips && state === 'denied' && (
              <div className="location-modal-backdrop" style={{ zIndex: 101 }} onClick={() => setShowTips(false)}>
                <div className="location-modal" style={{ width: '80%', maxWidth: 520 }} onClick={(e) => e.stopPropagation()}>
                  <button className="location-modal-close" onClick={() => setShowTips(false)} aria-label="Close">
                    ×
                  </button>
                  <h3 style={{ margin: '0 0 10px' }}>How to manually enable location</h3>
                  <div style={{ textAlign: 'left', background: 'var(--code-bg)', border: '1px solid var(--border)', borderRadius: 10, padding: 12, fontSize: 13, lineHeight: 1.5 }}>
                    <div style={{ marginBottom: 10 }}>
                      <strong>1. Browser:</strong><br />
                      Chrome/Edge - Click <strong>Lock icon</strong> in address bar - <strong>Site settings</strong> - <strong>Location - Allow</strong> - Reload page
                    </div>
                    <div style={{ marginBottom: 10 }}>
                      <strong>2. Windows (if OS location is off):</strong><br />
                      <strong>Settings - Privacy &amp; security - Location</strong> - <strong>Location services - ON</strong> - <strong>Let apps access your location - ON</strong> - Enable for your browser
                    </div>
                    <div style={{ marginBottom: 12 }}>
                      <strong>3. Phone:</strong><br />
                      Settings - Privacy - Location Services - ON - Allow for Browser/Chrome
                    </div>
                    <button
                      className="btn primary"
                      style={{ width: '100%' }}
                      onClick={() => {
                        setShowTips(false)
                        window.location.reload()
                      }}
                    >
                      Reload and try again
                    </button>
                  </div>
                  <div style={{ textAlign: 'center', marginTop: 10 }}>
                    <button className="btn" onClick={() => setShowTips(false)}>
                      Close Tips
                    </button>
                  </div>
                </div>
              </div>
            )}

            {error && <p className="login-error" style={{ marginBottom: 10 }}>{error}</p>}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
              <button className="btn" onClick={() => setShowModal(false)}>
                Close
              </button>
              <button className="btn primary" onClick={handleRequest} disabled={requesting || state === 'unsupported'}>
                {requesting ? 'Requesting...' : state === 'denied' ? 'Retry' : 'Allow Location'}
              </button>
            </div>
            <p style={{ fontSize: 12, color: 'var(--text)', marginTop: 10 }}>
              You must allow location to login and submit attendance. Location is only used for attendance verification.
            </p>
          </div>
        </div>
      )}

      <style>{`
        .location-modal-backdrop {
          position: fixed;
          inset: 0;
          background: rgba(0,0,0,0.5);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 100;
        }
        .location-modal {
          background: var(--bg);
          border: 1px solid var(--border);
          border-radius: 14px;
          padding: 24px;
          max-width: 460px;
          width: 90%;
          position: relative;
          box-shadow: var(--shadow);
          text-align: center;
        }
        .location-modal-close {
          position: absolute;
          top: 12px;
          right: 12px;
          background: none;
          border: none;
          font-size: 22px;
          cursor: pointer;
          color: var(--text);
          width: 32px;
          height: 32px;
          border-radius: 8px;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .location-modal-close:hover {
          background: var(--social-bg);
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </>
  )
}
