import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.jsx'
import { PanelProvider } from './components/ui/panel.jsx'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <PanelProvider>
        <App />
      </PanelProvider>
    </BrowserRouter>
  </React.StrictMode>,
)
