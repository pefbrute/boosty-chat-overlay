// tools/tutorial-video/src/components/Cursor.jsx
import React from 'react';

export const Cursor = ({
  x,
  y,
  clicking = false,
  grabbing = false,
}) => {
  // 5-8% scale down during mouse-down per ТЗ section 10
  const isDown = clicking || grabbing;
  const currentScale = isDown ? 0.93 : 1.0;

  return (
    <div
      style={{
        position: 'absolute',
        left: x,
        top: y,
        transform: `translate(-3px, -3px) scale(${currentScale})`,
        transition: 'transform 0.08s cubic-bezier(0.2, 0.8, 0.2, 1)',
        zIndex: 9999,
        pointerEvents: 'none',
        filter: 'drop-shadow(0 3px 6px rgba(0, 0, 0, 0.45))',
      }}
    >
      {/* Click Ripple / Press Feedback */}
      {clicking && (
        <div
          style={{
            position: 'absolute',
            left: 3,
            top: 3,
            width: 32,
            height: 32,
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(0, 119, 255, 0.45) 0%, rgba(0, 119, 255, 0) 70%)',
            border: '2px solid rgba(56, 189, 248, 0.8)',
            transform: 'translate(-50%, -50%)',
            pointerEvents: 'none',
            animation: 'pulse 0.3s ease-out',
          }}
        />
      )}

      {grabbing ? (
        <svg
          width="28"
          height="28"
          viewBox="0 0 24 24"
          fill="#ffffff"
          stroke="#0f172a"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {/* Fist / Grabbing Hand icon */}
          <path d="M18 11V6a2 2 0 0 0-4 0v5M14 10V4a2 2 0 0 0-4 0v7M10 10.5V6a2 2 0 0 0-4 0v8a5 5 0 0 0 10 0v-3a2 2 0 0 0-2-2z" />
          <path d="M6 14a4 4 0 0 0 8 0" stroke="#0f172a" fill="none" strokeWidth="1.2" />
        </svg>
      ) : (
        <svg
          width="28"
          height="28"
          viewBox="0 0 24 24"
          fill="none"
        >
          {/* Crisp Desktop Arrow Cursor with distinct border */}
          <path
            d="M5.5 3.5L18.5 13.5L12 14.5L9.5 20.5L5.5 3.5Z"
            fill="#ffffff"
            stroke="#0f172a"
            strokeWidth="1.8"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </div>
  );
};

