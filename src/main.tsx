import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import PocApp from './three/PocApp.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PocApp />
  </StrictMode>,
)
