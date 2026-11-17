import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { reportCaughtError } from './widgets/WidgetBoundary';
import { installStaleBuildRecovery } from './stale-build';
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
import './style-workflow.css';

// A page that outlived an update reloads into the new build when it misses one of the old chunks (#711).
installStaleBuildRecovery();

// Widget boundaries log their own errors once (#318); React's default logging covers any other boundary.
createRoot(document.getElementById('root')!, { onCaughtError: reportCaughtError }).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
