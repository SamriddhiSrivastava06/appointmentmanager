import React, { useState } from 'react';
import axios from 'axios';
import { LogIn, Key, Mail, AlertCircle, Shield, User, Stethoscope } from 'lucide-react';

interface LoginProps {
  setToken: (token: string) => void;
  setView: (view: 'login' | 'register') => void;
}

export default function Login({ setToken, setView }: LoginProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) return;

    setLoading(true);
    setError(null);

    try {
      const response = await axios.post('/api/auth/login', { email, password });
      setToken(response.data.token);
    } catch (err: any) {
      console.error(err);
      setError(err.response?.data?.error || 'Invalid credentials or connection failure.');
    } finally {
      setLoading(false);
    }
  };

  // Quick fill helper logins
  const quickLogin = (role: 'admin' | 'doctor' | 'patient') => {
    if (role === 'admin') {
      setEmail('admin@clinic.com');
      setPassword('password123');
    } else if (role === 'doctor') {
      setEmail('sarah.jenkins@clinic.com');
      setPassword('password123');
    } else {
      setEmail('alice.smith@gmail.com');
      setPassword('password123');
    }
  };

  return (
    <div className="w-full max-w-md bg-white p-8 rounded-2xl shadow-xl border border-slate-100">
      <div className="text-center mb-8">
        <h2 className="text-2xl font-extrabold text-slate-900 tracking-tight">Welcome Back</h2>
        <p className="text-sm text-slate-500 mt-1.5">Sign in to your Healthcare Portal</p>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl flex items-start gap-2.5 text-red-700 text-sm">
          <AlertCircle className="h-5 w-5 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-5">
        <div>
          <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Email Address</label>
          <div className="relative">
            <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center text-slate-400">
              <Mail className="h-4 w-4" />
            </span>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full pl-10 pr-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 text-sm placeholder:text-slate-400"
              placeholder="e.g. alice@gmail.com"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Password</label>
          <div className="relative">
            <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center text-slate-400">
              <Key className="h-4 w-4" />
            </span>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full pl-10 pr-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500 text-sm placeholder:text-slate-400"
              placeholder="••••••••"
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full py-3 px-4 rounded-xl bg-brand-600 hover:bg-brand-700 text-white font-medium text-sm transition-colors flex items-center justify-center gap-2 shadow-lg shadow-brand-100 disabled:bg-slate-400 disabled:shadow-none"
        >
          {loading ? (
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent"></div>
          ) : (
            <>
              <LogIn className="h-4 w-4" /> Sign In
            </>
          )}
        </button>
      </form>

      {/* Quick Access */}
      <div className="mt-8 pt-6 border-t border-slate-100 text-center">
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Quick Demo Sign In</p>
        <div className="grid grid-cols-3 gap-2">
          <button
            onClick={() => quickLogin('admin')}
            className="px-2 py-2 rounded-lg bg-purple-50 hover:bg-purple-100 border border-purple-200 text-purple-700 text-[10px] font-semibold flex flex-col items-center gap-1 transition-colors"
          >
            <Shield className="h-3.5 w-3.5" /> Admin
          </button>
          <button
            onClick={() => quickLogin('doctor')}
            className="px-2 py-2 rounded-lg bg-blue-50 hover:bg-blue-100 border border-blue-200 text-blue-700 text-[10px] font-semibold flex flex-col items-center gap-1 transition-colors"
          >
            <Stethoscope className="h-3.5 w-3.5" /> Doctor
          </button>
          <button
            onClick={() => quickLogin('patient')}
            className="px-2 py-2 rounded-lg bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 text-emerald-700 text-[10px] font-semibold flex flex-col items-center gap-1 transition-colors"
          >
            <User className="h-3.5 w-3.5" /> Patient
          </button>
        </div>
      </div>

      <div className="mt-6 text-center text-xs text-slate-500">
        Don't have an account?{' '}
        <button
          onClick={() => setView('register')}
          className="text-brand-600 font-semibold hover:underline"
        >
          Register as Patient
        </button>
      </div>
    </div>
  );
}
