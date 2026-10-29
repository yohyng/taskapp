import { createRoot } from 'react-dom/client';
import AuthGate from 'taskspace-existing-auth-gate';
import { ProductOutline } from './product-outline.jsx';
import '../../../src/index.css';
createRoot(document.getElementById('root')).render(<AuthGate><ProductOutline /></AuthGate>);
