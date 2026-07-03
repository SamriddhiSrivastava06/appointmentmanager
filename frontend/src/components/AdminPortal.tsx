import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { 
  UserPlus, Edit2, Trash2, Calendar, ShieldAlert, Clock, 
  MapPin, Plus, ListFilter, AlertTriangle, Eye, CheckCircle2 
} from 'lucide-react';

interface AdminPortalProps {
  user: any;
}

interface Doctor {
  profileId: string;
  userId: string;
  email: string;
  firstName: string;
  lastName: string;
  specialization: string;
  workingHours: { start: string; end: string };
  slotDuration: number;
}

interface AuditLog {
  id: string;
  action: string;
  details: string;
  userId: string | null;
  createdAt: string;
}

export default function AdminPortal({ user }: AdminPortalProps) {
  const [activeTab, setActiveTab] = useState<'doctors' | 'leaves' | 'heatmap' | 'audit'>('doctors');
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  
  // Loading & Error States
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Doctor Form State
  const [showDocModal, setShowDocModal] = useState(false);
  const [editingDoc, setEditingDoc] = useState<Doctor | null>(null);
  const [docEmail, setDocEmail] = useState('');
  const [docPassword, setDocPassword] = useState('');
  const [docFirstName, setDocFirstName] = useState('');
  const [docLastName, setDocLastName] = useState('');
  const [docSpecialization, setDocSpecialization] = useState('');
  const [docStartHour, setDocStartHour] = useState('09:00');
  const [docEndHour, setDocEndHour] = useState('17:00');
  const [docDuration, setDocDuration] = useState('30');

  // Leave Form State
  const [selectedDocId, setSelectedDocId] = useState('');
  const [leaveDate, setLeaveDate] = useState('');
  const [leavesList, setLeavesList] = useState<any[]>([]);

  // Heatmap State
  const [heatmapDocId, setHeatmapDocId] = useState('');
  const [heatmapStartDate, setHeatmapStartDate] = useState(
    new Date(Date.now() - (new Date().getDay() - 1) * 24 * 60 * 60 * 1000).toISOString().split('T')[0] // current week Monday
  );
  const [heatmapData, setHeatmapData] = useState<any[]>([]);

  useEffect(() => {
    fetchDoctors();
    fetchAuditLogs();
  }, []);

  useEffect(() => {
    if (selectedDocId && activeTab === 'leaves') {
      fetchDoctorLeaves(selectedDocId);
    }
  }, [selectedDocId, activeTab]);

  useEffect(() => {
    if (heatmapDocId && heatmapStartDate && activeTab === 'heatmap') {
      fetchHeatmap();
    }
  }, [heatmapDocId, heatmapStartDate, activeTab]);

  const fetchDoctors = async () => {
    try {
      const res = await axios.get('/api/admin/doctors');
      setDoctors(res.data);
      if (res.data.length > 0) {
        if (!selectedDocId) setSelectedDocId(res.data[0].profileId);
        if (!heatmapDocId) setHeatmapDocId(res.data[0].profileId);
      }
    } catch (err) {
      console.error(err);
      setError('Failed to fetch doctors list.');
    }
  };

  const fetchAuditLogs = async () => {
    try {
      const res = await axios.get('/api/admin/audit-logs');
      setAuditLogs(res.data);
    } catch (err) {
      console.error(err);
    }
  };

  const fetchDoctorLeaves = async (docId: string) => {
    try {
      const res = await axios.get(`/api/admin/doctors/${docId}/leave`);
      setLeavesList(res.data);
    } catch (err) {
      console.error(err);
    }
  };

  const fetchHeatmap = async () => {
    setLoading(true);
    try {
      const res = await axios.get(`/api/admin/doctors/${heatmapDocId}/heatmap?startDate=${heatmapStartDate}`);
      setHeatmapData(res.data);
    } catch (err) {
      console.error(err);
      setError('Failed to load utilization heatmap.');
    } finally {
      setLoading(false);
    }
  };

  // Create or Update Doctor
  const handleSaveDoctor = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMsg(null);

    const payload = {
      email: docEmail,
      password: docPassword,
      firstName: docFirstName,
      lastName: docLastName,
      specialization: docSpecialization,
      workingHours: { start: docStartHour, end: docEndHour },
      slotDuration: parseInt(docDuration)
    };

    try {
      if (editingDoc) {
        // Edit doctor (doesn't change email/password)
        await axios.put(`/api/admin/doctors/${editingDoc.profileId}`, {
          firstName: docFirstName,
          lastName: docLastName,
          specialization: docSpecialization,
          workingHours: { start: docStartHour, end: docEndHour },
          slotDuration: parseInt(docDuration)
        });
        setSuccessMsg('Doctor profile updated successfully');
      } else {
        // Create new doctor
        await axios.post('/api/admin/doctors', payload);
        setSuccessMsg('New doctor profile created successfully');
      }
      setShowDocModal(false);
      resetDocForm();
      fetchDoctors();
      fetchAuditLogs();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to save doctor.');
    }
  };

  const resetDocForm = () => {
    setEditingDoc(null);
    setDocEmail('');
    setDocPassword('');
    setDocFirstName('');
    setDocLastName('');
    setDocSpecialization('');
    setDocStartHour('09:00');
    setDocEndHour('17:00');
    setDocDuration('30');
  };

  const handleEditDoctor = (doc: Doctor) => {
    setEditingDoc(doc);
    setDocEmail(doc.email);
    setDocPassword('********'); // mask
    setDocFirstName(doc.firstName);
    setDocLastName(doc.lastName);
    setDocSpecialization(doc.specialization);
    setDocStartHour(doc.workingHours?.start || '09:00');
    setDocEndHour(doc.workingHours?.end || '17:00');
    setDocDuration(String(doc.slotDuration || 30));
    setShowDocModal(true);
  };

  const handleDeleteDoctor = async (docId: string) => {
    if (!window.confirm('Are you sure you want to delete this doctor? All active appointments will be cancelled.')) return;
    setError(null);
    setSuccessMsg(null);
    try {
      await axios.delete(`/api/admin/doctors/${docId}`);
      setSuccessMsg('Doctor profile deleted successfully');
      fetchDoctors();
      fetchAuditLogs();
    } catch (err) {
      setError('Failed to delete doctor profile.');
    }
  };

  // Add Leave Date
  const handleAddLeave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedDocId || !leaveDate) return;
    setError(null);
    setSuccessMsg(null);

    if (!window.confirm('Adding leave day will cancel all existing booked appointments for this date. Affected patients will be notified. Proceed?')) return;

    try {
      const res = await axios.post(`/api/admin/doctors/${selectedDocId}/leave`, { date: leaveDate });
      setSuccessMsg(`Leave day added successfully. ${res.data.cancelledCount} conflicting appointments cancelled.`);
      fetchDoctorLeaves(selectedDocId);
      fetchAuditLogs();
      setLeaveDate('');
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to set doctor leave day.');
    }
  };

  return (
    <div className="space-y-6">
      {/* Navigation Tabs */}
      <div className="flex border-b border-slate-200 bg-white p-2 rounded-2xl shadow-sm gap-2">
        <button
          onClick={() => { setActiveTab('doctors'); setError(null); setSuccessMsg(null); }}
          className={`flex-1 py-2.5 text-sm font-semibold rounded-xl transition-all ${
            activeTab === 'doctors' ? 'bg-brand-600 text-white shadow-sm' : 'text-slate-500 hover:text-slate-900 hover:bg-slate-50'
          }`}
        >
          Doctors Directory
        </button>
        <button
          onClick={() => { setActiveTab('leaves'); setError(null); setSuccessMsg(null); }}
          className={`flex-1 py-2.5 text-sm font-semibold rounded-xl transition-all ${
            activeTab === 'leaves' ? 'bg-brand-600 text-white shadow-sm' : 'text-slate-500 hover:text-slate-900 hover:bg-slate-50'
          }`}
        >
          Doctor Leave Manager
        </button>
        <button
          onClick={() => { setActiveTab('heatmap'); setError(null); setSuccessMsg(null); }}
          className={`flex-1 py-2.5 text-sm font-semibold rounded-xl transition-all ${
            activeTab === 'heatmap' ? 'bg-brand-600 text-white shadow-sm' : 'text-slate-500 hover:text-slate-900 hover:bg-slate-50'
          }`}
        >
          Slot Heatmaps
        </button>
        <button
          onClick={() => { setActiveTab('audit'); setError(null); setSuccessMsg(null); }}
          className={`flex-1 py-2.5 text-sm font-semibold rounded-xl transition-all ${
            activeTab === 'audit' ? 'bg-brand-600 text-white shadow-sm' : 'text-slate-500 hover:text-slate-900 hover:bg-slate-50'
          }`}
        >
          Audit Logs
        </button>
      </div>

      {/* Messages */}
      {error && (
        <div className="p-4 bg-red-50 border border-red-200 text-red-700 rounded-xl text-sm flex items-center gap-2.5">
          <AlertTriangle className="h-5 w-5 shrink-0" />
          <span>{error}</span>
        </div>
      )}
      {successMsg && (
        <div className="p-4 bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-xl text-sm flex items-center gap-2.5">
          <CheckCircle2 className="h-5 w-5 shrink-0" />
          <span>{successMsg}</span>
        </div>
      )}

      {/* --- TAB: DOCTORS DIRECTORY --- */}
      {activeTab === 'doctors' && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="p-5 border-b border-slate-100 flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold text-slate-900">Manage Medical Staff</h2>
              <p className="text-xs text-slate-500 mt-0.5">Register, update, and manage doctor credentials</p>
            </div>
            <button
              onClick={() => { resetDocForm(); setShowDocModal(true); }}
              className="inline-flex items-center gap-1 px-4 py-2 rounded-xl bg-brand-600 hover:bg-brand-700 text-white font-semibold text-xs shadow-md shadow-brand-100 transition-colors"
            >
              <Plus className="h-4 w-4" /> Add Doctor
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 text-slate-400 text-xs font-semibold uppercase tracking-wider border-b border-slate-100">
                  <th className="px-6 py-4">Name</th>
                  <th className="px-6 py-4">Specialization</th>
                  <th className="px-6 py-4">Email</th>
                  <th className="px-6 py-4">Hours & Duration</th>
                  <th className="px-6 py-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {doctors.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="text-center py-12 text-slate-400 font-medium">No doctors registered yet.</td>
                  </tr>
                ) : (
                  doctors.map((doc) => (
                    <tr key={doc.profileId} className="hover:bg-slate-50/50 transition-colors">
                      <td className="px-6 py-4 font-bold text-slate-800">Dr. {doc.firstName} {doc.lastName}</td>
                      <td className="px-6 py-4 text-brand-600 font-semibold">{doc.specialization}</td>
                      <td className="px-6 py-4 text-slate-500">{doc.email}</td>
                      <td className="px-6 py-4 text-slate-500 font-medium">
                        {doc.workingHours?.start} - {doc.workingHours?.end} ({doc.slotDuration} min)
                      </td>
                      <td className="px-6 py-4 text-right space-x-2">
                        <button
                          onClick={() => handleEditDoctor(doc)}
                          className="p-1.5 rounded-lg border border-slate-200 hover:bg-slate-100 text-slate-600 transition-colors inline-flex"
                          title="Edit"
                        >
                          <Edit2 className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => handleDeleteDoctor(doc.profileId)}
                          className="p-1.5 rounded-lg border border-red-200 hover:bg-red-50 text-red-500 transition-colors inline-flex"
                          title="Delete"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* --- TAB: LEAVE MANAGER --- */}
      {activeTab === 'leaves' && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Add Leave Form */}
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm h-fit">
            <h2 className="text-base font-bold text-slate-900 mb-1">Set Leave Day</h2>
            <p className="text-xs text-slate-500 mb-6 leading-relaxed">
              Mark a doctor on leave. All bookings on this day will be cancelled automatically, and patients will get one-click rebooking links.
            </p>

            <form onSubmit={handleAddLeave} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Select Doctor</label>
                <select
                  required
                  value={selectedDocId}
                  onChange={(e) => setSelectedDocId(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-brand-500 focus:ring-brand-500 bg-white"
                >
                  <option value="">-- Select Doctor --</option>
                  {doctors.map((doc) => (
                    <option key={doc.profileId} value={doc.profileId}>
                      Dr. {doc.firstName} {doc.lastName} ({doc.specialization})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Leave Date</label>
                <input
                  type="date"
                  required
                  value={leaveDate}
                  onChange={(e) => setLeaveDate(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-brand-500"
                />
              </div>

              <button
                type="submit"
                className="w-full py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white font-semibold text-xs shadow-md shadow-red-100 transition-colors flex items-center justify-center gap-2"
              >
                <ShieldAlert className="h-4 w-4" /> Save Leave Day
              </button>
            </form>
          </div>

          {/* Active Leave Records */}
          <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm md:col-span-2">
            <h2 className="text-base font-bold text-slate-900 mb-1">Scheduled Leaves</h2>
            <p className="text-xs text-slate-500 mb-5">Existing active leave periods for the selected doctor</p>

            <div className="overflow-hidden rounded-xl border border-slate-100">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 text-slate-400 text-xs font-semibold uppercase border-b border-slate-100">
                    <th className="px-6 py-3">Leave Date</th>
                    <th className="px-6 py-3">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-sm">
                  {leavesList.length === 0 ? (
                    <tr>
                      <td colSpan={2} className="text-center py-8 text-slate-400 font-medium">No leave days scheduled for this doctor.</td>
                    </tr>
                  ) : (
                    leavesList.map((leave) => (
                      <tr key={leave.id}>
                        <td className="px-6 py-4 font-bold text-slate-800">
                          {new Date(leave.date).toLocaleDateString([], { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' })}
                        </td>
                        <td className="px-6 py-4">
                          <span className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
                            ON LEAVE
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* --- TAB: SLOT HEATMAPS --- */}
      {activeTab === 'heatmap' && (
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
          <div className="flex flex-col sm:flex-row gap-4 items-end justify-between mb-6">
            <div>
              <h2 className="text-base font-bold text-slate-900">Weekly Slot Utilization</h2>
              <p className="text-xs text-slate-500 mt-0.5">Visual slot-by-slot utilization density tracker</p>
            </div>
            
            <div className="flex flex-wrap gap-3 items-end">
              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1.5">Doctor</label>
                <select
                  value={heatmapDocId}
                  onChange={(e) => setHeatmapDocId(e.target.value)}
                  className="px-3 py-1.5 border border-slate-200 rounded-xl text-xs focus:outline-brand-500 bg-white"
                >
                  {doctors.map((d) => (
                    <option key={d.profileId} value={d.profileId}>Dr. {d.firstName} {d.lastName}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1.5">Start Date (Monday)</label>
                <input
                  type="date"
                  value={heatmapStartDate}
                  onChange={(e) => setHeatmapStartDate(e.target.value)}
                  className="px-3 py-1.5 border border-slate-200 rounded-xl text-xs focus:outline-brand-500"
                />
              </div>
            </div>
          </div>

          {loading ? (
            <div className="py-20 flex justify-center">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand-500 border-t-transparent"></div>
            </div>
          ) : heatmapData.length === 0 ? (
            <div className="py-12 text-center text-slate-400 font-medium">Select a doctor and start date to evaluate weekly schedules.</div>
          ) : (
            <div className="space-y-6">
              {/* Daily Statistics Cards */}
              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
                {heatmapData.map((day) => (
                  <div key={day.date} className="border border-slate-100 rounded-xl p-3 bg-slate-50 flex flex-col justify-between">
                    <div>
                      <p className="text-[10px] font-bold text-slate-400 uppercase">{day.dayName.substring(0,3)}</p>
                      <p className="text-xs font-semibold text-slate-500">{new Date(day.date).toLocaleDateString([], { month: 'short', day: 'numeric' })}</p>
                    </div>
                    
                    {day.status === 'working' ? (
                      <div className="mt-3">
                        <p className="text-sm font-extrabold text-slate-800">{day.utilization}%</p>
                        <div className="w-full bg-slate-200 rounded-full h-1.5 mt-1">
                          <div 
                            className="bg-brand-500 h-1.5 rounded-full" 
                            style={{ width: `${day.utilization}%` }}
                          ></div>
                        </div>
                        <p className="text-[9px] text-slate-400 font-medium mt-1">
                          {day.bookedSlots}/{day.totalSlots} slots
                        </p>
                      </div>
                    ) : (
                      <div className="mt-4 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                        {day.status}
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* Detailed Grid Map */}
              <div className="border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
                <div className="bg-slate-50 p-3 border-b border-slate-100 text-xs font-bold text-slate-400 uppercase tracking-wider">
                  Weekly Hour Grid
                </div>
                
                <div className="p-4 overflow-x-auto">
                  <div className="min-w-[650px] grid grid-cols-7 gap-3">
                    {heatmapData.map((day) => (
                      <div key={day.date} className="space-y-2">
                        <div className="text-center py-1 bg-slate-100 rounded-lg text-xs font-bold text-slate-700">
                          {day.dayName.substring(0,3)}
                        </div>

                        <div className="space-y-1.5">
                          {day.status !== 'working' ? (
                            <div className="text-center py-12 text-[10px] text-slate-400 font-semibold border border-dashed border-slate-200 rounded-xl uppercase">
                              {day.status}
                            </div>
                          ) : day.slots.length === 0 ? (
                            <div className="text-center py-4 text-[9px] text-slate-400 font-semibold">No working hours</div>
                          ) : (
                            day.slots.map((slot: any) => {
                              let bgClass = 'bg-emerald-50 text-emerald-700 border-emerald-200';
                              if (slot.status === 'booked') bgClass = 'bg-red-50 text-red-700 border-red-200';
                              if (slot.status === 'held') bgClass = 'bg-amber-50 text-amber-700 border-amber-200';

                              return (
                                <div
                                  key={slot.time}
                                  className={`px-2 py-1.5 border rounded-lg text-center text-[10px] font-bold ${bgClass}`}
                                >
                                  <div>{slot.time}</div>
                                  <div className="text-[8px] font-medium opacity-80 uppercase mt-0.5">{slot.status}</div>
                                </div>
                              );
                            })
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* --- TAB: AUDIT LOGS --- */}
      {activeTab === 'audit' && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="p-5 border-b border-slate-100">
            <h2 className="text-base font-bold text-slate-900">System Concurrency Audit Logs</h2>
            <p className="text-xs text-slate-500 mt-0.5">Chronological record of slot holds, expirations, locks, and cancellations</p>
          </div>

          <div className="overflow-x-auto max-h-[500px]">
            <table className="w-full text-left border-collapse">
              <thead className="sticky top-0 bg-slate-50 border-b border-slate-100 text-slate-400 text-xs font-semibold uppercase tracking-wider">
                <tr>
                  <th className="px-6 py-3.5">Timestamp</th>
                  <th className="px-6 py-3.5">Action</th>
                  <th className="px-6 py-3.5">Details</th>
                  <th className="px-6 py-3.5">User ID</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs font-medium text-slate-600">
                {auditLogs.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="text-center py-12 text-slate-400 font-medium">No audit events generated yet.</td>
                  </tr>
                ) : (
                  auditLogs.map((log) => {
                    let actionBadge = 'bg-slate-50 text-slate-600 border-slate-200';
                    if (log.action.includes('SUCCESS')) actionBadge = 'bg-emerald-50 text-emerald-700 border-emerald-200';
                    if (log.action.includes('FAIL') || log.action.includes('CONFLICT')) actionBadge = 'bg-red-50 text-red-700 border-red-200';
                    if (log.action.includes('EXPIRE') || log.action.includes('RELEASE')) actionBadge = 'bg-amber-50 text-amber-700 border-amber-200';

                    return (
                      <tr key={log.id} className="hover:bg-slate-50/20">
                        <td className="px-6 py-3 text-slate-400">{new Date(log.createdAt).toLocaleString()}</td>
                        <td className="px-6 py-3">
                          <span className={`px-2 py-0.5 border rounded-full text-[9px] font-bold ${actionBadge}`}>
                            {log.action}
                          </span>
                        </td>
                        <td className="px-6 py-3 font-semibold text-slate-800">{log.details}</td>
                        <td className="px-6 py-3 text-slate-400 font-mono">{log.userId || 'SYSTEM'}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* --- DOCTOR REGISTER MODAL --- */}
      {showDocModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm px-4">
          <div className="bg-white rounded-3xl border border-slate-100 w-full max-w-lg shadow-2xl p-6 relative">
            <h2 className="text-lg font-bold text-slate-900 mb-1">
              {editingDoc ? 'Edit Doctor Profile' : 'Add New Medical Doctor'}
            </h2>
            <p className="text-xs text-slate-500 mb-6">Fill in working parameters and account credentials</p>

            <form onSubmit={handleSaveDoctor} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">First Name</label>
                  <input
                    type="text"
                    required
                    value={docFirstName}
                    onChange={(e) => setDocFirstName(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-brand-500"
                    placeholder="Sarah"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Last Name</label>
                  <input
                    type="text"
                    required
                    value={docLastName}
                    onChange={(e) => setDocLastName(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-brand-500"
                    placeholder="Jenkins"
                  />
                </div>
              </div>

              {!editingDoc && (
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Email Address</label>
                    <input
                      type="email"
                      required
                      value={docEmail}
                      onChange={(e) => setDocEmail(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-brand-500"
                      placeholder="jenkins@clinic.com"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Password</label>
                    <input
                      type="password"
                      required
                      value={docPassword}
                      onChange={(e) => setDocPassword(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-brand-500"
                      placeholder="••••••••"
                    />
                  </div>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Medical Specialization</label>
                <input
                  type="text"
                  required
                  value={docSpecialization}
                  onChange={(e) => setDocSpecialization(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-brand-500"
                  placeholder="e.g. Cardiology, Pediatrics, Dermatology"
                />
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Start Hour</label>
                  <input
                    type="text"
                    required
                    value={docStartHour}
                    onChange={(e) => setDocStartHour(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-brand-500 text-center"
                    placeholder="09:00"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">End Hour</label>
                  <input
                    type="text"
                    required
                    value={docEndHour}
                    onChange={(e) => setDocEndHour(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-brand-500 text-center"
                    placeholder="17:00"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Slot (mins)</label>
                  <input
                    type="number"
                    required
                    value={docDuration}
                    onChange={(e) => setDocDuration(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-brand-500 text-center"
                    placeholder="30"
                  />
                </div>
              </div>

              <div className="pt-4 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowDocModal(false)}
                  className="px-4 py-2 border border-slate-200 rounded-xl text-slate-500 font-semibold text-xs transition-colors hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white font-semibold text-xs shadow-md shadow-brand-100 transition-colors rounded-xl"
                >
                  {editingDoc ? 'Save Changes' : 'Create Account'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
