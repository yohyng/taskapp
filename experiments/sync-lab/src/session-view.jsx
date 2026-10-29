import { createRoot } from 'react-dom/client';
import AuthGate from 'taskspace-existing-auth-gate';
import { SessionOutline } from './session-outline.jsx';

createRoot(document.getElementById('session-root')).render(<AuthGate><SessionOutline /></AuthGate>);
