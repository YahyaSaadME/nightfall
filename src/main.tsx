import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';

// No StrictMode: the 3D engine is a single long-lived instance and must not be created twice.
createRoot(document.getElementById('root')!).render(<App />);
