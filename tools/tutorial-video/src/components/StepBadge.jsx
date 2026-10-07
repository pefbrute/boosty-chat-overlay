// tools/tutorial-video/src/components/StepBadge.jsx
import React from 'react';

export const StepBadge = ({ stepNumber, title, subtitle, isComplete = false }) => {
  return (
    <div
      style={{
        position: 'absolute',
        top: 24,
        left: '50%',
        transform: 'translateX(-50%)',
        background: isComplete ? 'rgba(34, 197, 94, 0.95)' : 'rgba(15, 23, 42, 0.92)',
        color: '#ffffff',
        padding: '12px 28px',
        borderRadius: 30,
        boxShadow: '0 8px 30px rgba(0, 0, 0, 0.35)',
        border: `1px solid ${isComplete ? '#4ade80' : 'rgba(255, 255, 255, 0.15)'}`,
        backdropFilter: 'blur(12px)',
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        zIndex: 5000,
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      }}
    >
      <div
        style={{
          width: 32,
          height: 32,
          borderRadius: '50%',
          background: isComplete ? '#ffffff' : '#0077ff',
          color: isComplete ? '#16a34a' : '#ffffff',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontWeight: 700,
          fontSize: 16,
          boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
        }}
      >
        {isComplete ? '✓' : stepNumber}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <span style={{ fontSize: 18, fontWeight: 700, letterSpacing: '-0.2px' }}>
          {title}
        </span>
        {subtitle && (
          <span style={{ fontSize: 13, color: isComplete ? '#f0fdf4' : '#94a3b8', fontWeight: 500 }}>
            {subtitle}
          </span>
        )}
      </div>
    </div>
  );
};

export const StepProgressBar = ({ activeStep = 1 }) => {
  return (
    <div
      style={{
        position: 'absolute',
        bottom: 20,
        left: '50%',
        transform: 'translateX(-50%)',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        background: 'rgba(15, 23, 42, 0.85)',
        padding: '8px 20px',
        borderRadius: 20,
        border: '1px solid rgba(255, 255, 255, 0.1)',
        backdropFilter: 'blur(8px)',
        zIndex: 5000,
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      }}
    >
      {[
        { num: 1, label: 'Расширения' },
        { num: 2, label: 'Режим разработчика' },
        { num: 3, label: 'Перетащить папку' },
      ].map((s) => {
        const isActive = activeStep === s.num;
        const isPassed = activeStep > s.num;
        return (
          <div
            key={s.num}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              opacity: isActive ? 1 : isPassed ? 0.9 : 0.45,
              color: isActive ? '#38bdf8' : isPassed ? '#22c55e' : '#94a3b8',
              fontSize: 13,
              fontWeight: isActive ? 700 : 500,
            }}
          >
            <span
              style={{
                width: 18,
                height: 18,
                borderRadius: '50%',
                background: isActive ? '#0077ff' : isPassed ? '#22c55e' : 'rgba(255,255,255,0.15)',
                color: '#fff',
                fontSize: 11,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontWeight: 700,
              }}
            >
              {isPassed ? '✓' : s.num}
            </span>
            <span>{s.label}</span>
            {s.num < 3 && <span style={{ opacity: 0.3, margin: '0 4px' }}>→</span>}
          </div>
        );
      })}
    </div>
  );
};
