import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { reportCaughtError } from './widgets/WidgetBoundary';
import './styles.css';
import './widgets.css';
import './palette.css';
import './studio.css';
import './reminders.css';
import './grid-editor.css';
import './freesize.css';
import './widget-controls.css';
import './motion.css';
import './motion-widgets.css';
import './motion-editor.css';

// Widget boundaries log their own errors once (#318); React's default logging covers any other boundary.
createRoot(document.getElementById('root')!, { onCaughtError: reportCaughtError }).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
