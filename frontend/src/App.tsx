import { useState, useEffect } from 'react';
import axios from 'axios';
import Login from './components/Login';
import Register from './components/Register';
import AdminPortal from './components/AdminPortal';
import PatientPortal from './components/PatientPortal';
import DoctorPortal from './components/DoctorPortal';
import Rebook from './components/Rebook';
import GoogleCallback from './components/GoogleCallback';
import NavBar from './components/NavBar';

// Set default backend api url
axios.defaults.baseURL = 'http://localhost:5000';

export interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: 'PATIENT' | 'DOCTOR' | 'ADMIN';
  doctorProfileId?: string;
  hasGoogleCalendar?: boolean;
}

export default function App() {
  const [token, setToken] = useState<string | null>(localStorage.getItem('authToken'));
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'login' | 'register'>('login');
  
  // Custom router state
  const [currentPath, setCurrentPath] = useState(window.location.pathname);

  useEffect(() => {
    const handleLocationChange = () => {
      setCurrentPath(window.location.pathname);
    };

    window.addEventListener('popstate', handleLocationChange);
    return () => window.removeEventListener('popstate', handleLocationChange);
  }, []);

  useEffect(() => {
    if (token) {
      axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;
      localStorage.setItem('authToken', token);
      
      // Fetch user profile
      axios
        .get('/api/auth/me')
        .then((res) => {
          setUser(res.data.user);
        })
        .catch((err) => {
          console.error('Failed to fetch user:', err);
          logout();
        })
        .finally(() => {
          setLoading(false);
        });
    } else {
      delete axios.defaults.headers.common['Authorization'];
      localStorage.removeItem('authToken');
      setUser(null);
      setLoading(false);
    }
  }, [token]);

  const logout = () => {
    setToken(null);
    setUser(null);
    localStorage.removeItem('authToken');
    window.history.pushState({}, '', '/');
    setCurrentPath('/');
  };

  // Helper to change path programmatically
  const navigate = (path: string) => {
    window.history.pushState({}, '', path);
    setCurrentPath(path);
  };

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-50">
        <div className="text-center">
          <div className="h-12 w-12 animate-spin rounded-full border-4 border-brand-500 border-t-transparent mx-auto"></div>
          <p className="mt-4 text-slate-600 font-medium">Loading your portal...</p>
        </div>
      </div>
    );
  }

  // --- Router Routing ---
  if (currentPath === '/rebook') {
    return <Rebook navigate={navigate} />;
  }

  if (currentPath === '/oauth-success') {
    return <GoogleCallback navigate={navigate} />;
  }

  // If not logged in, render registration/login forms
  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-brand-50 via-slate-50 to-emerald-50 px-4">
        {view === 'login' ? (
          <Login setToken={setToken} setView={setView} />
        ) : (
          <Register setToken={setToken} setView={setView} />
        )}
      </div>
    );
  }

  // Logged in rendering
  return (
    <div className="min-h-screen flex flex-col bg-slate-50">
      <NavBar user={user} logout={logout} />
      
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 lg:p-8">
        {user.role === 'ADMIN' && <AdminPortal user={user} />}
        {user.role === 'PATIENT' && <PatientPortal user={user} logout={logout} />}
        {user.role === 'DOCTOR' && <DoctorPortal user={user} />}
      </main>

      <footer className="border-t border-slate-200 bg-white py-4 text-center text-xs text-slate-500">
        &copy; {new Date().getFullYear()} Healthcare Appointment & AI Follow-up Manager. All rights reserved.
      </footer>
    </div>
  );
}
