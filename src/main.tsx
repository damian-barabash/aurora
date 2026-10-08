import './styles/base.css'
import './styles/shell.css'
import './styles/pages.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { SessionProvider } from './app/session'
import { FeedbackProvider } from './components/ui'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
        <SessionProvider>
          <FeedbackProvider>
            <App />
          </FeedbackProvider>
        </SessionProvider>
    </BrowserRouter>
  </StrictMode>,
)
