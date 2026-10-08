import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles.css'
import './design.css'
import { initSplash, trackWindowActivity } from './lib/splash'

initSplash()
trackWindowActivity()

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
