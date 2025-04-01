import React, { useState } from 'react';

interface TestTrafficControlsProps {
  onStartTest: () => void;
  onStopTest: () => void;
  isRunning: boolean;
}

const TestTrafficControls: React.FC<TestTrafficControlsProps> = ({
  onStartTest,
  onStopTest,
  isRunning
}) => {
  return (
    <div style={{
      position: 'absolute',
      bottom: 16,
      left: 16,
      background: 'rgba(0, 0, 0, 0.8)',
      color: 'white',
      padding: '16px',
      borderRadius: '4px',
      zIndex: 1000
    }}>
      <h3 style={{ marginTop: 0, marginBottom: 8 }}>Test Controls</h3>
      <div style={{ marginBottom: 8 }}>
        {isRunning ? (
          <button 
            onClick={onStopTest}
            style={{
              background: '#ff4444',
              color: 'white',
              border: 'none',
              padding: '8px 16px',
              borderRadius: '4px',
              cursor: 'pointer'
            }}
          >
            Stop Test Traffic
          </button>
        ) : (
          <button 
            onClick={onStartTest}
            style={{
              background: '#44cc44',
              color: 'white',
              border: 'none',
              padding: '8px 16px',
              borderRadius: '4px',
              cursor: 'pointer'
            }}
          >
            Generate Test Traffic
          </button>
        )}
      </div>
    </div>
  );
};

export default TestTrafficControls;