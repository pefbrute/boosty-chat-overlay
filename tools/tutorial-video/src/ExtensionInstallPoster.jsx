// tools/tutorial-video/src/ExtensionInstallPoster.jsx
import React from 'react';
import { BrowserFrame } from './components/BrowserFrame';
import { FileManagerWindow } from './components/FileManagerWindow';

export const ExtensionInstallPoster = () => {
  return (
    <div
      style={{
        width: 1280,
        height: 720,
        background: 'linear-gradient(135deg, #0f172a 0%, #1e1b4b 100%)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '36px 48px',
        boxSizing: 'border-box',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Title */}
      <div style={{ textAlign: 'center', marginBottom: 28 }}>
        <h1 style={{ color: '#ffffff', fontSize: 32, fontWeight: 800, margin: 0, letterSpacing: '-0.5px' }}>
          Установка расширения в 3 простых шага
        </h1>
        <p style={{ color: '#94a3b8', fontSize: 16, marginTop: 6, fontWeight: 500 }}>
          Яндекс Браузер • Папка <span style={{ color: '#38bdf8', fontWeight: 700, fontFamily: 'monospace' }}>extension</span> внутри <span style={{ color: '#cbd5e1', fontFamily: 'monospace' }}>boosty-chat-overlay</span>
        </p>
      </div>

      {/* 3 Step Cards Triptych */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
          gap: 24,
          width: 1184,
          height: 520,
        }}
      >
        {/* Step 1 Card: Address Bar Input */}
        <div
          style={{
            minWidth: 0,
            background: 'rgba(30, 41, 59, 0.8)',
            border: '1px solid rgba(255, 255, 255, 0.12)',
            borderRadius: 16,
            padding: 20,
            display: 'flex',
            flexDirection: 'column',
            boxShadow: '0 12px 32px rgba(0,0,0,0.35)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
            <div
              style={{
                width: 34,
                height: 34,
                borderRadius: '50%',
                background: '#0077ff',
                color: '#fff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontWeight: 800,
                fontSize: 16,
                flexShrink: 0,
              }}
            >
              1
            </div>
            <div>
              <div style={{ color: '#ffffff', fontWeight: 700, fontSize: 17 }}>
                Откройте расширения
              </div>
              <div style={{ color: '#38bdf8', fontSize: 13, fontWeight: 600, fontFamily: 'monospace' }}>
                browser://extensions ↵
              </div>
            </div>
          </div>

          <div
            style={{
              flex: 1,
              background: '#090d16',
              borderRadius: 12,
              overflow: 'hidden',
              position: 'relative',
              border: '1px solid rgba(255,255,255,0.06)',
            }}
          >
            <div
              style={{
                position: 'absolute',
                left: '50%',
                top: '50%',
                transform: 'translate(-50%, -50%) scale(0.28)',
                transformOrigin: 'center center',
              }}
            >
              <BrowserFrame
                highlightAddressBar={true}
                addressText="browser://extensions"
                showEnterHint={true}
                pageLoaded={true}
                scale={1}
              />
            </div>
          </div>
        </div>

        {/* Step 2 Card: Dev Mode Toggle */}
        <div
          style={{
            minWidth: 0,
            background: 'rgba(30, 41, 59, 0.8)',
            border: '1px solid rgba(255, 255, 255, 0.12)',
            borderRadius: 16,
            padding: 20,
            display: 'flex',
            flexDirection: 'column',
            boxShadow: '0 12px 32px rgba(0,0,0,0.35)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
            <div
              style={{
                width: 34,
                height: 34,
                borderRadius: '50%',
                background: '#0077ff',
                color: '#fff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontWeight: 800,
                fontSize: 16,
                flexShrink: 0,
              }}
            >
              2
            </div>
            <div>
              <div style={{ color: '#ffffff', fontWeight: 700, fontSize: 17 }}>
                Режим разработчика
              </div>
              <div style={{ color: '#94a3b8', fontSize: 13, fontWeight: 500 }}>
                Включите переключатель вверху
              </div>
            </div>
          </div>

          <div
            style={{
              flex: 1,
              background: '#090d16',
              borderRadius: 12,
              overflow: 'hidden',
              position: 'relative',
              border: '1px solid rgba(255,255,255,0.06)',
            }}
          >
            <div
              style={{
                position: 'absolute',
                left: '50%',
                top: '50%',
                transform: 'translate(-50%, -50%) scale(0.28)',
                transformOrigin: 'center center',
              }}
            >
              <BrowserFrame
                devModeChecked={true}
                devModeHighlighted={true}
                pageLoaded={true}
                scale={1}
              />
            </div>
          </div>
        </div>

        {/* Step 3 Card: File Manager (extension) -> Drag & Drop */}
        <div
          style={{
            minWidth: 0,
            background: 'rgba(30, 41, 59, 0.85)',
            border: '1.5px solid #22c55e',
            borderRadius: 16,
            padding: 20,
            display: 'flex',
            flexDirection: 'column',
            boxShadow: '0 12px 32px rgba(0,0,0,0.35)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
            <div
              style={{
                width: 34,
                height: 34,
                borderRadius: '50%',
                background: '#22c55e',
                color: '#fff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontWeight: 800,
                fontSize: 16,
                flexShrink: 0,
              }}
            >
              3
            </div>
            <div>
              <div style={{ color: '#ffffff', fontWeight: 700, fontSize: 17 }}>
                Перетащите папку extension
              </div>
              <div style={{ color: '#4ade80', fontSize: 12.5, fontWeight: 600, fontFamily: 'monospace' }}>
                boosty-chat-overlay/extension ➔ Браузер
              </div>
            </div>
          </div>

          <div
            style={{
              flex: 1,
              background: '#090d16',
              borderRadius: 12,
              overflow: 'hidden',
              position: 'relative',
              border: '1px solid rgba(255,255,255,0.06)',
            }}
          >
            {/* Left: Scaled File Manager showing boosty-chat-overlay/ -> extension */}
            <div
              style={{
                position: 'absolute',
                left: 12,
                top: '50%',
                transform: 'translateY(-50%) scale(0.38)',
                transformOrigin: 'left center',
              }}
            >
              <FileManagerWindow width={340} height={460} isFolderSelected={true} />
            </div>

            {/* Center: Drag Arrow Badge */}
            <div
              style={{
                position: 'absolute',
                left: 146,
                top: '50%',
                transform: 'translateY(-50%)',
                background: '#0077ff',
                color: '#ffffff',
                width: 30,
                height: 30,
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 16,
                fontWeight: 800,
                zIndex: 20,
                boxShadow: '0 4px 12px rgba(0, 119, 255, 0.5)',
              }}
            >
              ➔
            </div>

            {/* Right: Scaled Browser with Drop Zone */}
            <div
              style={{
                position: 'absolute',
                right: 10,
                top: '50%',
                transform: 'translateY(-50%) scale(0.145)',
                transformOrigin: 'right center',
              }}
            >
              <BrowserFrame
                devModeChecked={true}
                showDropZone={true}
                hasBoostyInstalled={true}
                scale={1}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
