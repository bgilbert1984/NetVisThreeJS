import React from 'react';
import ReactDOM from 'react-dom/client';
import { NetworkVisualization } from './components/NetworkVisualization';
import './index.css';

const App = () => {
  return (
    <div style={{ width: '100vw', height: '100vh' }}>
      <NetworkVisualization />
    </div>
  );
};

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);