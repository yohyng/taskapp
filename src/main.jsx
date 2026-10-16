import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import AuthGate from './AuthGate.jsx'
import { OutlineProvider } from './Outliner.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AuthGate>
      <OutlineProvider>
        <App />
      </OutlineProvider>
    </AuthGate>
  </StrictMode>,
)
