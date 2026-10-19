import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { SupabaseProvider } from './lib/supabaseContext'
import { supabase } from './lib/supabaseClient'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SupabaseProvider client={supabase}>
      <App />
    </SupabaseProvider>
  </StrictMode>,
)
