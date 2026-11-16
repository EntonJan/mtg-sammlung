import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './theme.css'
import App from './App.jsx'
import SharedView from './components/SharedView'
import { isNativeApp } from './util'

if (isNativeApp()) document.body.classList.add('native')

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {new URLSearchParams(location.search).get('s') ? <SharedView id={new URLSearchParams(location.search).get('s')} /> : <App />}
  </StrictMode>,
)
