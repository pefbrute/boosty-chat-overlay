// tools/tutorial-video/src/components/FileManagerWindow.jsx
import React from 'react';

export const FileManagerWindow = ({
  width = 380,
  height = 420,
  showOriginalFolder = true,
  isFolderSelected = false,
  folderScale = 1,
  onFolderHover = false,
}) => {
  return (
    <div
      style={{
        width,
        height,
        background: '#ffffff',
        borderRadius: 14,
        overflow: 'hidden',
        boxShadow: '0 25px 60px -15px rgba(0, 0, 0, 0.55), 0 0 0 1px rgba(255, 255, 255, 0.1)',
        display: 'flex',
        flexDirection: 'column',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        position: 'relative',
      }}
    >
      {/* Window Header / Titlebar */}
      <div
        style={{
          background: '#f1f5f9',
          height: 40,
          display: 'flex',
          alignItems: 'center',
          padding: '0 14px',
          borderBottom: '1px solid #e2e8f0',
          gap: 12,
        }}
      >
        <div style={{ display: 'flex', gap: 7 }}>
          <div style={{ width: 11, height: 11, borderRadius: '50%', background: '#ff5f56' }} />
          <div style={{ width: 11, height: 11, borderRadius: '50%', background: '#ffbd2e' }} />
          <div style={{ width: 11, height: 11, borderRadius: '50%', background: '#27c93f' }} />
        </div>

        <div
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: '#334155',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <span>📁</span>
          <span>Папка расширения</span>
        </div>
      </div>

      {/* Path Bar showing hierarchy */}
      <div
        style={{
          background: '#ffffff',
          height: 36,
          display: 'flex',
          alignItems: 'center',
          padding: '0 14px',
          borderBottom: '1px solid #f1f5f9',
          gap: 6,
          fontSize: 12,
          color: '#64748b',
          fontFamily: 'SFMono-Regular, Menlo, Monaco, Consolas, monospace',
        }}
      >
        <span>📂 boosty-chat-overlay/</span>
        <span>›</span>
        <span style={{ fontWeight: 700, color: '#0077ff', background: '#eff6ff', padding: '2px 6px', borderRadius: 4 }}>
          extension/
        </span>
      </div>

      {/* Main Files Area */}
      <div
        style={{
          flex: 1,
          padding: '16px 20px',
          background: '#f8fafc',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          position: 'relative',
        }}
      >
        {/* Parent Directory Tree Header */}
        <div
          style={{
            position: 'absolute',
            top: 14,
            left: 18,
            right: 18,
            background: '#f1f5f9',
            borderRadius: 8,
            padding: '7px 12px',
            border: '1px solid #e2e8f0',
            fontFamily: 'SFMono-Regular, Menlo, Monaco, Consolas, monospace',
            fontSize: 11.5,
            color: '#475569',
            display: 'flex',
            flexDirection: 'column',
            gap: 3,
          }}
        >
          <div style={{ fontWeight: 600, color: '#334155' }}>📂 boosty-chat-overlay/</div>
          <div style={{ paddingLeft: 16, fontWeight: 700, color: '#0077ff' }}>└── 📁 extension/</div>
        </div>

        {/* The single highlighted target folder: extension */}
        <div
          style={{
            width: 184,
            height: 158,
            marginTop: 28,
            borderRadius: 12,
            border: isFolderSelected ? '2px dashed #0077ff' : onFolderHover ? '2px solid #0077ff' : '1.5px solid #cbd5e1',
            background: isFolderSelected ? 'rgba(0, 119, 255, 0.08)' : onFolderHover ? 'rgba(239, 246, 255, 0.95)' : '#ffffff',
            boxShadow: isFolderSelected ? '0 0 16px rgba(0, 119, 255, 0.2)' : '0 2px 6px rgba(0, 0, 0, 0.05)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            transition: 'all 0.15s ease',
            position: 'relative',
          }}
        >
          {showOriginalFolder ? (
            <>
              {/* Folder Icon Illustration */}
              <div
                style={{
                  width: 74,
                  height: 56,
                  position: 'relative',
                  transform: `scale(${folderScale})`,
                  transition: 'transform 0.15s ease',
                  filter: 'drop-shadow(0 4px 8px rgba(0, 0, 0, 0.15))',
                }}
              >
                {/* Back flap */}
                <div
                  style={{
                    position: 'absolute',
                    left: 0,
                    top: 0,
                    width: 30,
                    height: 12,
                    borderRadius: '4px 4px 0 0',
                    background: '#eab308',
                  }}
                />
                <div
                  style={{
                    position: 'absolute',
                    inset: '6px 0 0 0',
                    borderRadius: 6,
                    background: '#ca8a04',
                  }}
                />
                {/* Inner paper */}
                <div
                  style={{
                    position: 'absolute',
                    inset: '4px 8px 8px 8px',
                    borderRadius: 3,
                    background: '#ffffff',
                    border: '1px solid #e2e8f0',
                  }}
                />
                {/* Front flap */}
                <div
                  style={{
                    position: 'absolute',
                    inset: '12px 0 0 0',
                    borderRadius: '3px 3px 6px 6px',
                    background: '#facc15',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    boxShadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.5)',
                  }}
                >
                  <span style={{ fontSize: 12, fontWeight: 800, color: '#78350f' }}>🧩</span>
                </div>
              </div>

              {/* Folder Exact Name */}
              <div
                style={{
                  fontSize: 15,
                  fontWeight: 800,
                  color: '#0f172a',
                  textAlign: 'center',
                  lineHeight: 1.15,
                  fontFamily: 'SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                  background: '#eff6ff',
                  border: '1px solid #bfdbfe',
                  padding: '2px 10px',
                  borderRadius: 6,
                }}
              >
                📁 extension
              </div>

              {/* Second Line Subtitle */}
              <div
                style={{
                  fontSize: 11.5,
                  fontWeight: 600,
                  color: '#475569',
                  textAlign: 'center',
                }}
              >
                Папка расширения
              </div>
            </>
          ) : (
            // Placeholder ghost when folder extension is dragged away
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 6,
                opacity: 0.5,
              }}
            >
              <span style={{ fontSize: 28 }}>📂</span>
              <span
                style={{
                  fontSize: 13,
                  fontWeight: 700,
                  color: '#0077ff',
                  fontFamily: 'SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                }}
              >
                extension
              </span>
              <span style={{ fontSize: 11, fontWeight: 600, color: '#64748b' }}>
                Перетаскивается…
              </span>
            </div>
          )}
        </div>

        {/* Informative helper hint */}
        <div
          style={{
            position: 'absolute',
            bottom: 12,
            fontSize: 11.5,
            fontWeight: 600,
            color: '#64748b',
            textAlign: 'center',
          }}
        >
          Зажмите папку <strong style={{ color: '#0f172a' }}>extension</strong> мышью
        </div>
      </div>
    </div>
  );
};
