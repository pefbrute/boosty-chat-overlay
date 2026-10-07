// tools/tutorial-video/src/components/BrowserFrame.jsx
import React from 'react';

export const BrowserFrame = ({
  devModeChecked = false,
  devModeHighlighted = false,
  showDropZone = false,
  hasBoostyInstalled = false,
  highlightAddressBar = false,
  addressText = 'browser://extensions',
  showCaret = false,
  showEnterHint = false,
  pageLoaded = true,
  scale = 1,
  originX = 50,
  originY = 50,
  opacity = 1,
}) => {
  return (
    <div
      style={{
        width: 1140,
        height: 640,
        background: '#ffffff',
        borderRadius: 14,
        overflow: 'hidden',
        boxShadow: '0 25px 60px -15px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.1)',
        display: 'flex',
        flexDirection: 'column',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        transform: `scale(${scale})`,
        transformOrigin: `${originX}% ${originY}%`,
        opacity,
        position: 'relative',
        transition: 'transform 0.15s ease-out',
      }}
    >
      {/* Browser Tab & Titlebar */}
      <div
        style={{
          background: '#e9ebed',
          height: 42,
          display: 'flex',
          alignItems: 'center',
          padding: '0 16px',
          borderBottom: '1px solid #dcdfe4',
          gap: 12,
        }}
      >
        <div style={{ display: 'flex', gap: 7, marginRight: 8 }}>
          <div style={{ width: 11, height: 11, borderRadius: '50%', background: '#ff5f56' }} />
          <div style={{ width: 11, height: 11, borderRadius: '50%', background: '#ffbd2e' }} />
          <div style={{ width: 11, height: 11, borderRadius: '50%', background: '#27c93f' }} />
        </div>

        {/* Tab */}
        <div
          style={{
            background: '#ffffff',
            borderRadius: '8px 8px 0 0',
            padding: '6px 16px',
            fontSize: 13,
            fontWeight: 500,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            color: '#1e293b',
            boxShadow: '0 -1px 3px rgba(0,0,0,0.04)',
            marginTop: 6,
          }}
        >
          <span style={{ fontSize: 14 }}>{pageLoaded ? '🧩' : '🌐'}</span>
          <span>{pageLoaded ? 'Расширения' : 'Новая вкладка'}</span>
        </div>
      </div>

      {/* Browser Navigation / Address Bar */}
      <div
        style={{
          background: '#ffffff',
          height: 48,
          display: 'flex',
          alignItems: 'center',
          padding: '0 16px',
          borderBottom: '1px solid #e2e8f0',
          gap: 16,
        }}
      >
        <div style={{ display: 'flex', gap: 10, color: '#64748b', fontSize: 16 }}>
          <span>←</span>
          <span>→</span>
          <span>🔄</span>
        </div>

        {/* Address Bar */}
        <div
          id="browser-address-bar"
          style={{
            flex: 1,
            height: 32,
            background: highlightAddressBar ? '#ffffff' : '#f1f5f9',
            borderRadius: 16,
            display: 'flex',
            alignItems: 'center',
            padding: '0 14px',
            fontSize: 13,
            color: '#334155',
            gap: 8,
            border: highlightAddressBar ? '2px solid #0077ff' : '1px solid #e2e8f0',
            boxShadow: highlightAddressBar ? '0 0 12px rgba(0, 119, 255, 0.4)' : 'none',
            transition: 'border 0.2s, box-shadow 0.2s, background 0.2s',
          }}
        >
          <span style={{ fontSize: 13, color: '#64748b' }}>🔒</span>
          <span
            style={{
              fontWeight: 600,
              color: '#0f172a',
              display: 'flex',
              alignItems: 'center',
              fontFamily: 'SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
              fontSize: 12.5,
            }}
          >
            <span>{addressText}</span>
            {showCaret && (
              <span
                style={{
                  display: 'inline-block',
                  width: 2,
                  height: 16,
                  background: '#0077ff',
                  marginLeft: 2,
                  borderRadius: 1,
                }}
              />
            )}
          </span>

          {showEnterHint && (
            <div
              style={{
                marginLeft: 'auto',
                background: '#0f172a',
                color: '#ffffff',
                padding: '3px 9px',
                borderRadius: 5,
                fontSize: 11,
                fontWeight: 700,
                boxShadow: '0 2px 8px rgba(0, 0, 0, 0.25)',
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                border: '1px solid rgba(255, 255, 255, 0.2)',
                animation: 'popIn 0.2s ease',
              }}
            >
              <span style={{ fontSize: 12 }}>↵</span>
              <span>Enter</span>
            </div>
          )}
        </div>

        {/* Developer Mode Switch */}
        <div
          id="devmode-box"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '4px 10px',
            borderRadius: 8,
            background: devModeHighlighted ? 'rgba(0, 119, 255, 0.12)' : 'transparent',
            outline: devModeHighlighted ? '2px solid #0077ff' : 'none',
            boxShadow: devModeHighlighted ? '0 0 14px rgba(0, 119, 255, 0.45)' : 'none',
            transition: 'all 0.2s ease',
          }}
        >
          <span style={{ fontSize: 13, fontWeight: 600, color: '#1e293b' }}>
            Режим разработчика
          </span>
          <div
            id="devmode-toggle-switch"
            style={{
              width: 36,
              height: 20,
              borderRadius: 20,
              background: devModeChecked ? '#0077ff' : '#cbd5e1',
              padding: 2,
              display: 'flex',
              alignItems: 'center',
              justifyContent: devModeChecked ? 'flex-end' : 'flex-start',
              transition: 'background 0.2s ease',
              boxSizing: 'border-box',
            }}
          >
            <div
              style={{
                width: 16,
                height: 16,
                borderRadius: '50%',
                background: '#ffffff',
                boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
              }}
            />
          </div>
        </div>
      </div>

      {/* Dev Mode Subtoolbar (appears after toggle switch is turned on) */}
      {devModeChecked && (
        <div
          style={{
            background: '#f8fafc',
            borderBottom: '1px solid #e2e8f0',
            padding: '8px 20px',
            display: 'flex',
            gap: 10,
            alignItems: 'center',
            animation: 'fadeIn 0.25s ease',
          }}
        >
          <div
            style={{
              padding: '6px 14px',
              borderRadius: 6,
              background: '#0077ff',
              color: '#ffffff',
              fontSize: 12,
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <span>📁</span> Загрузить распакованное расширение
          </div>
          <div
            style={{
              padding: '6px 12px',
              borderRadius: 6,
              background: '#ffffff',
              border: '1px solid #cbd5e1',
              color: '#475569',
              fontSize: 12,
              fontWeight: 500,
            }}
          >
            Упаковать расширение…
          </div>
          <div
            style={{
              padding: '6px 12px',
              borderRadius: 6,
              background: '#ffffff',
              border: '1px solid #cbd5e1',
              color: '#475569',
              fontSize: 12,
              fontWeight: 500,
            }}
          >
            🔄 Обновить
          </div>
        </div>
      )}


      {/* Page Body Grid */}
      <div
        style={{
          flex: 1,
          padding: 24,
          background: '#f8fafc',
          overflowY: 'hidden',
          position: 'relative',
        }}
      >
        {!pageLoaded ? (
          <div
            style={{
              height: '100%',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 16,
              opacity: 0.8,
            }}
          >
            <div
              style={{
                fontSize: 36,
                fontWeight: 800,
                color: '#fc3f1d',
                fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
              }}
            >
              Яндекс
            </div>
            <div
              style={{
                width: 480,
                height: 44,
                background: '#ffffff',
                borderRadius: 22,
                border: '1px solid #cbd5e1',
                boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
                display: 'flex',
                alignItems: 'center',
                padding: '0 18px',
                fontSize: 14,
                color: '#94a3b8',
                gap: 10,
              }}
            >
              <span>🔍</span>
              <span>Найдётся всё</span>
            </div>
          </div>
        ) : (
          <>
            <div
              style={{
                fontSize: 13,
                fontWeight: 700,
                color: '#64748b',
                textTransform: 'uppercase',
                letterSpacing: 0.5,
                marginBottom: 16,
              }}
            >
              Установленные расширения
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16 }}>

          {/* Mock Ext 1 */}
          <div
            style={{
              background: '#ffffff',
              borderRadius: 10,
              border: '1px solid #e2e8f0',
              padding: 14,
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
            }}
          >
            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <div
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 8,
                  background: '#fef08a',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 20,
                }}
              >
                🎵
              </div>
              <div>
                <div style={{ fontWeight: 600, fontSize: 14, color: '#0f172a' }}>
                  Яндекс Музыка <span style={{ fontSize: 11, color: '#94a3b8' }}>1.4.2</span>
                </div>
                <div style={{ fontSize: 12, color: '#64748b' }}>
                  Быстрый доступ к любимым трекам
                </div>
              </div>
            </div>
          </div>

          {/* Mock Ext 2 */}
          <div
            style={{
              background: '#ffffff',
              borderRadius: 10,
              border: '1px solid #e2e8f0',
              padding: 14,
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
            }}
          >
            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <div
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 8,
                  background: '#e2e8f0',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 20,
                }}
              >
                🛡️
              </div>
              <div>
                <div style={{ fontWeight: 600, fontSize: 14, color: '#0f172a' }}>
                  Блокировка рекламы <span style={{ fontSize: 11, color: '#94a3b8' }}>2.0.1</span>
                </div>
                <div style={{ fontSize: 12, color: '#64748b' }}>
                  Защита от навязчивой рекламы
                </div>
              </div>
            </div>
          </div>

          {/* Boosty Chat Overlay Ext Card (appears after drop) */}
          {hasBoostyInstalled && (
            <div
              style={{
                gridColumn: '1 / -1',
                background: '#ffffff',
                borderRadius: 10,
                border: '2px solid #22c55e',
                padding: 16,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                boxShadow: '0 8px 24px rgba(34, 197, 94, 0.18)',
                animation: 'popIn 0.3s ease',
              }}
            >
              <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
                <div
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: 10,
                    background: 'linear-gradient(135deg, #ff5e3a 0%, #ff2a6d 100%)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#ffffff',
                    fontSize: 22,
                    boxShadow: '0 4px 12px rgba(255, 42, 109, 0.3)',
                  }}
                >
                  💬
                </div>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 15, color: '#0f172a', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span>Boosty Chat Overlay</span>
                    <span style={{ fontSize: 11, fontWeight: 700, color: '#15803d', background: '#dcfce7', padding: '2px 8px', borderRadius: 12 }}>
                      ✓ Расширение установлено
                    </span>
                  </div>
                  <div style={{ fontSize: 13, color: '#64748b', marginTop: 2 }}>
                    Передача сообщений чата Boosty в приложение и OBS Studio
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: '#22c55e' }}>Включено</span>
                <div
                  style={{
                    width: 36,
                    height: 20,
                    borderRadius: 20,
                    background: '#22c55e',
                    padding: 2,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'flex-end',
                  }}
                >
                  <div style={{ width: 16, height: 16, borderRadius: '50%', background: '#fff' }} />
                </div>
              </div>
            </div>
          )}
        </div>
        </>
      )}

        {/* Drag & Drop Target Overlay */}
        {showDropZone && (
          <div
            style={{
              position: 'absolute',
              inset: 12,
              background: 'rgba(0, 119, 255, 0.08)',
              border: '3px dashed #0077ff',
              borderRadius: 12,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 12,
              backdropFilter: 'blur(3px)',
              zIndex: 100,
            }}
          >
            <div
              style={{
                background: '#ffffff',
                padding: '24px 40px',
                borderRadius: 14,
                boxShadow: '0 10px 25px rgba(0, 119, 255, 0.2)',
                textAlign: 'center',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <span style={{ fontSize: 40 }}>📥</span>
              <span style={{ fontSize: 18, fontWeight: 700, color: '#0077ff' }}>
                Отпустите папку extension здесь
              </span>
              <span style={{ fontSize: 13, color: '#64748b' }}>
                Расширение Boosty Chat Overlay установится автоматически
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
