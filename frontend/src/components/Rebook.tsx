import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { CalendarCheck, AlertTriangle, ArrowRight, Activity, CalendarDays } from 'lucide-react';

interface RebookProps {
  navigate: (path: string) => void;
}

export default function Rebook({ navigate }: RebookProps) {
  const [token, setToken] = useState<string | null>(null);
  const [decodedDetails, setDecodedDetails] = useState<any>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tk = params.get('token');
    setToken(tk);

    if (tk) {
      try {
        // Decode token payload locally to show details to the patient
        const base64Url = tk.split('.')[1];
        const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
        const jsonPayload = decodeURIComponent(
          atob(base64)
            .split('')
            .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
            .join('')
        );
        const decoded = JSON.parse(jsonPayload);
        setDecodedDetails(decoded);
      } catch (err) {
        console.error('Failed to decode token details:', err);
        setStatus('error');
        setErrorMessage('The rebooking link is invalid or corrupted.');
      }
    } else {
      setStatus('error');
      setErrorMessage('No rebooking token provided in the URL.');
    }
  }, []);

  const handleConfirmRebook = async () => {
    if (!token) return;
    setStatus('loading');
    setErrorMessage('');

    try {
      await axios.post('/api/appointments/rebook', { token });
      setStatus('success');
    } catch (err: any) {
      console.error(err);
      setStatus('error');
      setErrorMessage(
        err.response?.data?.error ||
        'Failed to confirm the rebooking. The suggested slot may have been booked by someone else in the meantime.'
      );
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-brand-50/50 px-4 py-12">
      <div className="max-w-md w-full bg-white rounded-3xl shadow-xl border border-slate-100 p-8 text-center">
        {/* Header */}
        <div className="flex justify-center mb-6">
          <div className="bg-brand-50 text-brand-600 p-3 rounded-2xl">
            <Activity className="h-7 w-7" />
          </div>
        </div>

        <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight">Confirm Rebooking</h1>
        <p className="text-sm text-slate-500 mt-2">
          Your doctor was marked on leave. We've reserved the nearest open slot for you.
        </p>

        {status === 'idle' && decodedDetails && (
          <div className="mt-8 space-y-6">
            <div className="bg-slate-50 border border-slate-100 rounded-2xl p-5 text-left space-y-4">
              <div className="flex items-center gap-3">
                <CalendarDays className="h-5 w-5 text-slate-400 shrink-0" />
                <div>
                  <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">New Appointment Slot</p>
                  <p className="text-sm font-bold text-slate-800 mt-0.5">
                    {new Date(decodedDetails.startTime).toLocaleString([], {
                      weekday: 'short',
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit'
                    })}
                  </p>
                </div>
              </div>
            </div>

            <button
              onClick={handleConfirmRebook}
              className="w-full py-3.5 px-4 rounded-xl bg-brand-600 hover:bg-brand-700 text-white font-semibold text-sm transition-colors flex items-center justify-center gap-2 shadow-lg shadow-brand-100"
            >
              Accept New Slot <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        )}

        {status === 'loading' && (
          <div className="mt-12 py-6">
            <div className="h-10 w-10 animate-spin rounded-full border-4 border-brand-500 border-t-transparent mx-auto"></div>
            <p className="mt-4 text-slate-600 font-medium text-sm">Locking slot and updating calendar...</p>
          </div>
        )}

        {status === 'success' && (
          <div className="mt-8 space-y-6">
            <div className="flex justify-center">
              <div className="bg-emerald-50 text-emerald-500 p-3 rounded-full">
                <CalendarCheck className="h-10 w-10" />
              </div>
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-800">Appointment Confirmed!</h2>
              <p className="text-xs text-slate-500 mt-2">
                We've updated your schedule and sent confirmation details to your email and calendar.
              </p>
            </div>
            <button
              onClick={() => navigate('/')}
              className="w-full py-3 rounded-xl bg-slate-800 hover:bg-slate-900 text-white font-medium text-xs transition-colors"
            >
              Go to Portal Dashboard
            </button>
          </div>
        )}

        {status === 'error' && (
          <div className="mt-8 space-y-6">
            <div className="flex justify-center">
              <div className="bg-red-50 text-red-500 p-3 rounded-full">
                <AlertTriangle className="h-10 w-10" />
              </div>
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-800">Rebooking Failed</h2>
              <p className="text-xs text-slate-500 mt-2 leading-relaxed">{errorMessage}</p>
            </div>
            <button
              onClick={() => navigate('/')}
              className="w-full py-3 rounded-xl bg-brand-600 hover:bg-brand-700 text-white font-medium text-xs transition-colors"
            >
              Back to Portal
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
