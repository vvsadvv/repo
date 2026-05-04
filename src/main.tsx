import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { RepositoryAuthProvider } from '@/contexts/RepositoryAuthContext';
import App from './App';
import './index.css';

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Root element not found');
}

createRoot(rootElement).render(
  <StrictMode>
    <BrowserRouter>
      <RepositoryAuthProvider>
        <App />
      </RepositoryAuthProvider>
    </BrowserRouter>
  </StrictMode>
);
