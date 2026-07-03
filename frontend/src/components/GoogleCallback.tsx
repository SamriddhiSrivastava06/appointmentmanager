import React, { useEffect } from 'react';
import { CheckCircle, Calendar } from 'lucide-react';

interface GoogleCallbackProps {
  navigate: (path: string) => void;
}

export default function GoogleCallback({ navigate }: GoogleCallbackProps) {
  useEffect(() => {
    // Redirect back to home after 3 seconds
    const timer = setTimeout(() => {
      navigate('/');
    }, 3000);
    return () => clearTimeout(timer);
  }, [navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-brand-50/50 px-4">
      <div className="max-w-md w-full bg-white rounded-3xl shadow-xl border border-slate-100 p-8 text-center">
        <div className="flex justify-center mb-6">
          <div className="bg-emerald-50 text-emerald-500 p-3 rounded-full flex items-center justify-center">
            <CheckCircle className="h-12 w-12" />
          </div>
        </div>

        <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight">Calendar Connected!</h1>
        <p className="text-sm text-slate-500 mt-2">
          Your Google Calendar has been successfully authorized and integrated.
        </p>

        <div className="mt-8 p-4 bg-slate-50 rounded-2xl flex items-center gap-3 justify-center text-slate-600 text-xs font-semibold">
          <Calendar className="h-4 w-4 text-brand-500" />
          <span>Syncing booking slots automatically...</span>
        </div>

        <p className="mt-8 text-xs text-slate-400">
          Redirecting you back to your portal dashboard shortly...
        </p>
      </div>
    </div>
  );
}
