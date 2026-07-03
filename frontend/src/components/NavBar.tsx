import React from 'react';
import { LogOut, User, Shield, Stethoscope, Activity } from 'lucide-react';
import { User as UserType } from '../App';

interface NavBarProps {
  user: UserType;
  logout: () => void;
}

export default function NavBar({ user, logout }: NavBarProps) {
  return (
    <header className="sticky top-0 z-50 w-full border-b border-slate-200 bg-white/80 backdrop-blur-md">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        
        {/* Brand Logo */}
        <div className="flex items-center gap-2.5">
          <div className="bg-brand-600 text-white p-2 rounded-xl shadow-md shadow-brand-200">
            <Activity className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-slate-900 leading-tight">CareSync</h1>
            <p className="text-[10px] text-slate-500 font-medium tracking-wide uppercase">AI Health Manager</p>
          </div>
        </div>

        {/* User Stats & Logout */}
        <div className="flex items-center gap-4">
          <div className="hidden sm:flex flex-col items-end text-right">
            <span className="text-sm font-semibold text-slate-900">
              {user.firstName} {user.lastName}
            </span>
            
            {/* Role Badge */}
            <div className="flex items-center gap-1 mt-0.5">
              {user.role === 'ADMIN' && (
                <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[10px] font-medium bg-purple-50 text-purple-700 border border-purple-200">
                  <Shield className="h-3 w-3" /> Admin Portal
                </span>
              )}
              {user.role === 'DOCTOR' && (
                <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[10px] font-medium bg-blue-50 text-blue-700 border border-blue-200">
                  <Stethoscope className="h-3 w-3" /> Doctor Portal
                </span>
              )}
              {user.role === 'PATIENT' && (
                <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
                  <User className="h-3 w-3" /> Patient Portal
                </span>
              )}
            </div>
          </div>

          {/* Logout Button */}
          <button
            onClick={logout}
            className="inline-flex items-center justify-center p-2 rounded-xl text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-all duration-200 border border-slate-200"
            title="Log Out"
          >
            <LogOut className="h-5 w-5" />
          </button>
        </div>
      </div>
    </header>
  );
}
