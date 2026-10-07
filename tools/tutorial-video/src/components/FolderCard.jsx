// tools/tutorial-video/src/components/FolderCard.jsx
import React from 'react';

export const FolderCard = ({
  x = 0,
  y = 0,
  isDragging = false,
  scale = 1,
  opacity = 1,
}) => {
  return (
    <div
      style={{
        position: 'absolute',
        left: x,
        top: y,
        transform: `scale(${scale}) rotate(${isDragging ? '4deg' : '0deg'})`,
        opacity,
        zIndex: isDragging ? 9000 : 4000,
        pointerEvents: 'none',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 6,
        transition: 'transform 0.05s linear',
      }}
    >
      {/* Folder Visual */}
      <div
        style={{
          width: 110,
          height: 85,
          position: 'relative',
          filter: isDragging
            ? 'drop-shadow(0 20px 30px rgba(0, 0, 0, 0.45))'
            : 'drop-shadow(0 8px 16px rgba(0, 0, 0, 0.25))',
        }}
      >
        {/* Back folder tab */}
        <div
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            width: 45,
            height: 18,
            borderRadius: '6px 6px 0 0',
            background: '#eab308',
          }}
        />
        {/* Back folder body */}
        <div
          style={{
            position: 'absolute',
            inset: '10px 0 0 0',
            borderRadius: 8,
            background: '#ca8a04',
          }}
        />
        {/* Paper sheet inside folder */}
        <div
          style={{
            position: 'absolute',
            inset: '6px 12px 14px 12px',
            borderRadius: 4,
            background: '#f8fafc',
            border: '1px solid #e2e8f0',
            display: 'flex',
            flexDirection: 'column',
            gap: 3,
            padding: 4,
          }}
        >
          <div style={{ height: 3, background: '#cbd5e1', borderRadius: 2 }} />
          <div style={{ height: 3, background: '#cbd5e1', borderRadius: 2, width: '70%' }} />
        </div>
        {/* Front folder flap */}
        <div
          style={{
            position: 'absolute',
            inset: '18px 0 0 0',
            borderRadius: '4px 4px 8px 8px',
            background: '#facc15',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.4)',
          }}
        >
          {/* Folder Pill on flap */}
          <div
            style={{
              padding: '3px 8px',
              borderRadius: 6,
              background: 'rgba(255, 255, 255, 0.92)',
              fontSize: 10.5,
              fontWeight: 800,
              color: '#0077ff',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
              fontFamily: 'SFMono-Regular, Menlo, Monaco, Consolas, monospace',
            }}
          >
            <span>🧩</span> extension
          </div>
        </div>
      </div>

      {/* Label Badge */}
      <div
        style={{
          background: isDragging ? '#0077ff' : 'rgba(15, 23, 42, 0.92)',
          color: '#ffffff',
          padding: '4px 12px',
          borderRadius: 6,
          fontSize: 13,
          fontWeight: 800,
          whiteSpace: 'nowrap',
          boxShadow: '0 4px 10px rgba(0,0,0,0.3)',
          fontFamily: 'SFMono-Regular, Menlo, Monaco, Consolas, monospace',
          transition: 'background 0.2s ease',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          lineHeight: 1.2,
        }}
      >
        <span>📁 extension</span>
        <span
          style={{
            fontSize: 10,
            fontWeight: 600,
            opacity: 0.9,
            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
          }}
        >
          Папка расширения
        </span>
      </div>
    </div>
  );
};
