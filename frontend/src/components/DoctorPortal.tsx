import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { 
  Stethoscope, Clock, ShieldAlert, Sparkles, User, FileText, 
  History, Pill, Plus, Trash2, CheckCircle2, AlertTriangle, ArrowRight, X 
} from 'lucide-react';
import { User as UserType } from '../App';

interface DoctorPortalProps {
  user: UserType;
}

interface PrescriptionItem {
  medication: string;
  dosage: string;
  frequency: string;
  duration: string;
}

export default function DoctorPortal({ user }: DoctorPortalProps) {
  const [appointments, setAppointments] = useState<any[]>([]);
  const [selectedAppt, setSelectedAppt] = useState<any | null>(null);
  
  // Historical Patient Timeline
  const [patientTimeline, setPatientTimeline] = useState<any[]>([]);
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [historyPatientName, setHistoryPatientName] = useState('');

  // Post-Visit Form
  const [clinicalNotes, setClinicalNotes] = useState('');
  const [prescriptions, setPrescriptions] = useState<PrescriptionItem[]>([]);
  
  // New Prescription fields
  const [medName, setMedName] = useState('');
  const [medDosage, setMedDosage] = useState('');
  const [medFrequency, setMedFrequency] = useState('Daily');
  const [medDuration, setMedDuration] = useState('7 days');

  // Loading & Messages
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    fetchTodaySchedule();
  }, []);

  const fetchTodaySchedule = async () => {
    try {
      const res = await axios.get('/api/appointments/today');
      setAppointments(res.data);
      if (res.data.length > 0 && !selectedAppt) {
        setSelectedAppt(res.data[0]);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const loadPatientHistory = async (patientId: string, fullName: string) => {
    setHistoryPatientName(fullName);
    try {
      const res = await axios.get(`/api/appointments/patient-history/${patientId}`);
      setPatientTimeline(res.data);
      setShowHistoryModal(true);
    } catch (err) {
      console.error(err);
    }
  };

  const handleAddPrescription = () => {
    if (!medName || !medDosage) return;
    setPrescriptions([
      ...prescriptions,
      {
        medication: medName,
        dosage: medDosage,
        frequency: medFrequency,
        duration: medDuration
      }
    ]);
    // Reset inputs
    setMedName('');
    setMedDosage('');
    setMedFrequency('Daily');
    setMedDuration('7 days');
  };

  const handleRemovePrescription = (index: number) => {
    setPrescriptions(prescriptions.filter((_, i) => i !== index));
  };

  const handleSubmitVisit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAppt || !clinicalNotes) return;

    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      await axios.post(`/api/appointments/${selectedAppt.id}/notes`, {
        clinicalNotes,
        prescriptions
      });

      setSuccess('Visit summaries and prescriptions submitted successfully!');
      
      // Reset form
      setClinicalNotes('');
      setPrescriptions([]);
      setSelectedAppt(null);

      // Refresh today's appointments
      const res = await axios.get('/api/appointments/today');
      setAppointments(res.data);
      if (res.data.length > 0) {
        setSelectedAppt(res.data[0]);
      } else {
        setSelectedAppt(null);
      }
    } catch (err: any) {
      console.error(err);
      setError(err.response?.data?.error || 'Failed to submit visit notes.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Messages */}
      {(error || success) && (
        <div className="lg:col-span-3">
          {error && (
            <div className="p-4 bg-red-50 border border-red-200 text-red-700 rounded-xl text-sm flex items-center gap-2.5">
              <AlertTriangle className="h-5 w-5 shrink-0" />
              <span>{error}</span>
            </div>
          )}
          {success && (
            <div className="p-4 bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-xl text-sm flex items-center gap-2.5">
              <CheckCircle2 className="h-5 w-5 shrink-0" />
              <span>{success}</span>
            </div>
          )}
        </div>
      )}

      {/* Today's appointments schedule list */}
      <div className="lg:col-span-1 bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-4">
        <div>
          <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
            <Clock className="h-5 w-5 text-brand-600" /> Today's Consultation Queue
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">Chronological agenda of patient appointments</p>
        </div>

        <div className="divide-y divide-slate-100 max-h-[500px] overflow-y-auto pr-1">
          {appointments.length === 0 ? (
            <div className="py-12 text-center text-slate-400 font-medium">No appointments scheduled for today.</div>
          ) : (
            appointments.map((appt) => {
              const isSelected = selectedAppt?.id === appt.id;
              const hasHighUrgency = appt.symptomSummary?.urgency === 'HIGH';

              return (
                <button
                  key={appt.id}
                  onClick={() => {
                    setSelectedAppt(appt);
                    setClinicalNotes('');
                    setPrescriptions([]);
                  }}
                  className={`w-full text-left py-3 px-3.5 rounded-xl transition-all border flex flex-col mt-1.5 ${
                    isSelected
                      ? 'bg-brand-50 border-brand-200 text-brand-900 ring-1 ring-brand-100'
                      : hasHighUrgency
                      ? 'bg-red-50/50 border-red-100 text-slate-700 hover:bg-red-50'
                      : 'bg-white hover:bg-slate-50 border-slate-200/60 text-slate-700'
                  }`}
                >
                  <div className="flex items-center justify-between w-full">
                    <span className="text-[10px] font-bold text-slate-400">
                      {new Date(appt.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                    
                    {appt.symptomSummary && (
                      <span className={`px-2 py-0.5 rounded-full text-[8px] font-extrabold border uppercase ${
                        hasHighUrgency
                          ? 'bg-red-100 text-red-700 border-red-200 animate-pulse'
                          : appt.symptomSummary.urgency === 'MEDIUM'
                          ? 'bg-amber-50 text-amber-700 border-amber-200'
                          : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                      }`}>
                        {appt.symptomSummary.urgency}
                      </span>
                    )}
                  </div>

                  <h3 className="text-xs font-bold text-slate-800 mt-1">
                    {appt.patient.firstName} {appt.patient.lastName}
                  </h3>
                  
                  {appt.symptomSummary?.chiefComplaint && (
                    <p className="text-[10px] text-slate-500 font-semibold mt-0.5 truncate w-full">
                      {appt.symptomSummary.chiefComplaint}
                    </p>
                  )}
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* Diagnostic details & Notes submission */}
      <div className="lg:col-span-2 bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-6">
        {selectedAppt ? (
          <>
            {/* Patient Header Details */}
            <div className="flex flex-col sm:flex-row justify-between sm:items-center border-b border-slate-100 pb-4 gap-4">
              <div>
                <h2 className="text-base font-extrabold text-slate-900">
                  {selectedAppt.patient.firstName} {selectedAppt.patient.lastName}
                </h2>
                <p className="text-xs text-slate-400 font-semibold mt-0.5">{selectedAppt.patient.email}</p>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => loadPatientHistory(selectedAppt.patientId, `${selectedAppt.patient.firstName} ${selectedAppt.patient.lastName}`)}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 border border-slate-200 hover:bg-slate-50 rounded-xl text-xs font-semibold text-slate-600 transition-colors shadow-sm"
                >
                  <History className="h-4 w-4 text-slate-400" /> Patient Medical History
                </button>
              </div>
            </div>

            {/* AI Urgency Same-day Open Slot Suggester */}
            {selectedAppt.earlierSlotSuggestion && (
              <div className="p-4 bg-amber-50 border border-amber-200 text-amber-900 rounded-xl text-xs flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <ShieldAlert className="h-5 w-5 text-amber-600 shrink-0" />
                  <span>
                    <strong>Urgent Case:</strong> Suggested same-day slot is open at{' '}
                    <strong>
                      {new Date(selectedAppt.earlierSlotSuggestion.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </strong>.
                  </span>
                </div>
                <span className="text-[10px] text-amber-700 font-bold uppercase tracking-wider">Inform patient to reschedule</span>
              </div>
            )}

            {/* AI Pre-Visit Diagnostic Symptoms Analysis */}
            {selectedAppt.symptomSummary && (
              <div className="p-5 bg-brand-50/20 border border-brand-100/50 rounded-2xl space-y-3">
                <div className="flex items-center gap-1.5 text-brand-900 font-bold text-xs">
                  <Sparkles className="h-4 w-4 text-brand-500" /> AI Pre-visit Symptom Summary
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
                  <div className="md:col-span-2 space-y-1">
                    <p className="font-bold text-slate-500">Chief Complaint / AI Diagnosis:</p>
                    <p className="text-slate-700 font-medium bg-white/70 px-3 py-2 border border-slate-100 rounded-xl">
                      {selectedAppt.symptomSummary.chiefComplaint}
                    </p>
                  </div>
                  <div>
                    <p className="font-bold text-slate-500 mb-1">Raw Symptoms Log:</p>
                    <p className="text-slate-600 italic bg-white/40 px-3 py-2 border border-slate-100 rounded-xl truncate" title={selectedAppt.symptoms}>
                      {selectedAppt.symptoms || 'None'}
                    </p>
                  </div>
                </div>

                <div className="pt-2">
                  <p className="text-xs font-bold text-slate-500 mb-2">Suggested Consultation Questions:</p>
                  <ul className="space-y-1.5 text-xs text-slate-700">
                    {selectedAppt.symptomSummary.questions.map((q: string, idx: number) => (
                      <li key={idx} className="flex gap-2 items-start bg-white/70 px-3 py-2 border border-slate-100 rounded-xl">
                        <span className="text-brand-500 font-extrabold">{idx + 1}.</span>
                        <span className="font-medium text-slate-700">{q}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}

            {/* Post-Visit Clinical Form */}
            <form onSubmit={handleSubmitVisit} className="space-y-6">
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-2 flex items-center gap-1">
                  <FileText className="h-4 w-4 text-slate-400" /> Clinical Notes & Diagnosis
                </label>
                <textarea
                  required
                  value={clinicalNotes}
                  onChange={(e) => setClinicalNotes(e.target.value)}
                  placeholder="Input detailed diagnostic summaries, notes, and observations. An AI patient-friendly summary will be compiled automatically."
                  rows={4}
                  className="w-full px-3.5 py-2.5 border border-slate-200 focus:outline-brand-500 rounded-xl text-sm placeholder:text-slate-400 bg-white"
                ></textarea>
              </div>

              {/* Prescription Issuance */}
              <div className="border border-slate-200 rounded-2xl p-5 space-y-4">
                <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wide flex items-center gap-1.5">
                  <Pill className="h-4 w-4 text-brand-600" /> Prescribe Medications
                </h3>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 items-end">
                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1.5">Medication Name</label>
                    <input
                      type="text"
                      value={medName}
                      onChange={(e) => setMedName(e.target.value)}
                      placeholder="e.g. Amoxicillin"
                      className="w-full px-2.5 py-1.5 border border-slate-200 rounded-xl text-xs focus:outline-brand-500"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1.5">Dosage</label>
                    <input
                      type="text"
                      value={medDosage}
                      onChange={(e) => setMedDosage(e.target.value)}
                      placeholder="e.g. 500mg"
                      className="w-full px-2.5 py-1.5 border border-slate-200 rounded-xl text-xs focus:outline-brand-500"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1.5">Frequency</label>
                    <select
                      value={medFrequency}
                      onChange={(e) => setMedFrequency(e.target.value)}
                      className="w-full px-2.5 py-1.5 border border-slate-200 rounded-xl text-xs focus:outline-brand-500 bg-white"
                    >
                      <option value="Daily">Daily</option>
                      <option value="Every 12 hours">Twice a day (Every 12h)</option>
                      <option value="Every 8 hours">Three times a day (Every 8h)</option>
                      <option value="Every 6 hours">Four times a day (Every 6h)</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1.5">Duration</label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={medDuration}
                        onChange={(e) => setMedDuration(e.target.value)}
                        placeholder="e.g. 7 days"
                        className="w-full px-2.5 py-1.5 border border-slate-200 rounded-xl text-xs focus:outline-brand-500"
                      />
                      <button
                        type="button"
                        onClick={handleAddPrescription}
                        className="px-3 py-1.5 bg-brand-600 hover:bg-brand-700 text-white rounded-xl text-xs font-semibold shrink-0"
                      >
                        Add
                      </button>
                    </div>
                  </div>
                </div>

                {/* Prescription List */}
                {prescriptions.length > 0 && (
                  <div className="divide-y divide-slate-100 bg-slate-50 border border-slate-100 rounded-xl px-4 py-2 text-xs">
                    {prescriptions.map((rx, idx) => (
                      <div key={idx} className="flex justify-between items-center py-2">
                        <div>
                          <span className="font-bold text-slate-800">{rx.medication}</span>{' '}
                          <span className="text-slate-500">
                            - {rx.dosage} | {rx.frequency} | {rx.duration}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleRemovePrescription(idx)}
                          className="text-red-500 hover:text-red-700 transition-colors p-1"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Submit triggers */}
              <div className="pt-2 flex justify-end">
                <button
                  type="submit"
                  disabled={loading}
                  className="px-5 py-2.5 bg-brand-600 hover:bg-brand-700 text-white rounded-xl text-xs font-extrabold shadow-md shadow-brand-100 transition-colors flex items-center gap-1.5"
                >
                  {loading ? 'Submitting notes...' : 'Complete Consultation'}
                </button>
              </div>
            </form>
          </>
        ) : (
          <div className="py-24 text-center text-slate-400 font-medium border border-dashed border-slate-200 rounded-3xl">
            Select a patient from today's schedule to evaluate pre-visit diagnostics and submit notes.
          </div>
        )}
      </div>

      {/* --- PATIENT TIMELINE / HISTORY MODAL --- */}
      {showHistoryModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm px-4">
          <div className="bg-white rounded-3xl border border-slate-100 w-full max-w-4xl shadow-2xl p-6 relative max-h-[85vh] flex flex-col">
            
            <button
              onClick={() => setShowHistoryModal(false)}
              className="absolute top-4 right-4 p-2 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-50 border border-slate-200"
            >
              <X className="h-5 w-5" />
            </button>

            <div className="border-b border-slate-100 pb-4 mb-5 pr-12">
              <h2 className="text-lg font-bold text-slate-900">Longitudinal Medical History</h2>
              <p className="text-xs text-brand-600 font-semibold mt-0.5">{historyPatientName}</p>
            </div>

            {/* Timeline Content */}
            <div className="flex-1 overflow-y-auto pl-3 pr-2 py-2 space-y-6 relative border-l-2 border-slate-100 ml-4">
              {patientTimeline.length === 0 ? (
                <div className="py-12 text-center text-slate-400 font-medium pl-6">
                  No historical completed consultation records found for this patient.
                </div>
              ) : (
                patientTimeline.map((visit) => (
                  <div key={visit.id} className="relative pl-7">
                    {/* Timeline bullet */}
                    <span className="absolute -left-[9px] top-1.5 bg-white border-2 border-brand-500 rounded-full h-4 w-4"></span>

                    <div className="space-y-3">
                      <div>
                        <span className="text-xs text-slate-400 font-medium">
                          {new Date(visit.startTime).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}
                        </span>
                        <h3 className="text-sm font-bold text-slate-900 mt-0.5">
                          Consultation with Dr. {visit.doctor.user.firstName} {visit.doctor.user.lastName}
                        </h3>
                        <p className="text-xs text-slate-500 font-semibold">{visit.doctor.specialization}</p>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {/* Notes */}
                        <div className="space-y-2">
                          {visit.symptoms && (
                            <div className="bg-slate-50 border border-slate-100 rounded-xl p-3 text-xs">
                              <p className="font-bold text-slate-500 mb-0.5">Chief Complaint / Symptoms:</p>
                              <p className="text-slate-600 leading-relaxed">{visit.symptoms}</p>
                            </div>
                          )}

                          {visit.visitNote?.clinicalNotes && (
                            <div className="bg-slate-50 border border-slate-100 rounded-xl p-3 text-xs">
                              <p className="font-bold text-slate-500 mb-0.5">Clinical Notes:</p>
                              <p className="text-slate-600 leading-relaxed whitespace-pre-line">
                                {visit.visitNote.clinicalNotes}
                              </p>
                            </div>
                          )}
                        </div>

                        {/* AI Summary and prescriptions */}
                        <div className="space-y-3">
                          {visit.visitNote?.patientFriendlySummary && (
                            <div className="bg-brand-50/20 border border-brand-100/50 rounded-xl p-3 text-xs space-y-1">
                              <h4 className="font-extrabold text-brand-900 flex items-center gap-1">
                                <Sparkles className="h-4 w-4 text-brand-500" /> Patient-Friendly Summary
                              </h4>
                              <p className="text-slate-700 leading-relaxed whitespace-pre-line">
                                {visit.visitNote.patientFriendlySummary}
                              </p>
                            </div>
                          )}

                          <div className="bg-slate-50 border border-slate-100 rounded-xl p-3 text-xs space-y-2">
                            <h4 className="font-bold text-slate-500 flex items-center gap-1">
                              <Pill className="h-4 w-4 text-brand-600" /> Prescribed Medications
                            </h4>
                            {visit.prescriptions?.length === 0 ? (
                              <p className="text-slate-400 italic">No prescriptions issued.</p>
                            ) : (
                              <div className="divide-y divide-slate-200/50">
                                {visit.prescriptions.map((rx: any) => (
                                  <div key={rx.id} className="py-1.5 first:pt-0 last:pb-0">
                                    <p className="font-bold text-slate-800">{rx.medication}</p>
                                    <p className="text-[10px] text-slate-500 mt-0.5">
                                      Dosage: {rx.dosage} | Frequency: {rx.frequency} | Duration: {rx.duration}
                                    </p>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
            
            <div className="border-t border-slate-100 pt-4 flex justify-end">
              <button
                onClick={() => setShowHistoryModal(false)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-900 text-white rounded-xl text-xs font-semibold transition-colors"
              >
                Close History
              </button>
            </div>

          </div>
        </div>
      )}
    </div>
  );
}
