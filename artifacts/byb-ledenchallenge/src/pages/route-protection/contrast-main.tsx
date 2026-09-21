import { createRoot } from 'react-dom/client';
import App from '../../App';
import '../../index.css';

window.history.replaceState(null, '', '/dashboard');

createRoot(document.getElementById('root')!).render(<App />);