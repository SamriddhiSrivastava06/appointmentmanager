import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { 
  Search, Calendar, Clock, Activity, CalendarDays, History, AlertCircle, 
  CheckCircle2, Pill, Plus, ArrowRight, ShieldAlert, Sparkles, X, Star, CalendarPlus
} from 'lucide-react';
import { User } from '../App';

interface PatientPortalProps {
  user: User;
  logout: () => void;
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

export default function PatientPortal({ user, logout }: PatientPortalProps) {
  const [activeTab, setActiveTab] = useState<'book' | 'my-appointments' | 'history' | 'waitlist'>('book');
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [specializations, setSpecializations] = useState<string[]>([]);
  const [selectedSpecialization, setSelectedSpecialization] = useState('');
  
  // Search & Filter
  const [searchQuery, setSearchQuery] = useState('');

  // Booking Flow State
  const [selectedDoctor, setSelectedDoctor] = useState<Doctor | null>(null);
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [availableSlots, setAvailableSlots] = useState<any[]>([]);
  const [selectedSlot, setSelectedSlot] = useState<any | null>(null);
  const [symptoms, setSymptoms] = useState('');
  
  // Slot Hold Concurrency Lock Timer
  const [holdTimer, setHoldTimer] = useState<number | null>(null); // in seconds
  const [holdActive, setHoldActive] = useState(false);
  const timerRef = useRef<any | null>(null);

  // Suggested Slot Alert (High Urgency)
  const [urgencyNotice, setUrgencyNotice] = useState<{
    appointmentId: string;
    urgency: 'LOW' | 'MEDIUM' | 'HIGH';
    suggestedSlot: { start: string; end: string } | null;
  } | null>(null);

  // General Status Messages
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Timeline / History Lists
  const [myAppointments, setMyAppointments] = useState<any[]>([]);
  const [timeline, setTimeline] = useState<any[]>([]);
  const [waitlists, setWaitlists] = useState<any[]>([]);

  useEffect(() => {
    fetchDoctors();
    fetchSpecializations();
    fetchPatientData();
  }, [activeTab]);

  useEffect(() => {
    if (selectedDoctor && selectedDate) {
      fetchAvailableSlots();
    }
  }, [selectedDoctor, selectedDate]);

  // Hold Timer Effect
  useEffect(() => {
    if (holdActive && holdTimer !== null) {
      if (holdTimer <= 0) {
        // Hold expired
        setHoldActive(false);
        setHoldTimer(null);
        setSelectedSlot(null);
        setError('Your 5-minute slot hold has expired. The slot has been released.');
        fetchAvailableSlots();
      } else {
        timerRef.current = setTimeout(() => {
          setHoldTimer(holdTimer - 1);
        }, 1000);
      }
    }
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [holdTimer, holdActive]);

  const fetchDoctors = async () => {
    try {
      const res = await axios.get('/api/doctors');
      setDoctors(res.data);
    } catch (err) {
      console.error(err);
    }
  };

  const fetchSpecializations = async () => {
    try {
      const res = await axios.get('/api/doctors/specializations');
      setSpecializations(res.data);
    } catch (err) {
      console.error(err);
    }
  };

  const fetchAvailableSlots = async () => {
    if (!selectedDoctor) return;
    try {
      const res = await axios.get(`/api/doctors/${selectedDoctor.profileId}/available-slots?date=${selectedDate}`);
      setAvailableSlots(res.data);
    } catch (err) {
      console.error(err);
    }
  };

  const fetchPatientData = async () => {
    try {
      const resAppt = await axios.get('/api/appointments/my-appointments');
      setMyAppointments(resAppt.data);
      
      const resTimeline = await axios.get(`/api/appointments/patient-history/${user.id}`);
      setTimeline(resTimeline.data);

      const resWait = await axios.get('/api/waitlist');
      setWaitlists(resWait.data);
    } catch (err) {
      console.error(err);
    }
  };

  // Connect Google Calendar
  const handleConnectGoogle = async () => {
    try {
      const res = await axios.get('/api/auth/google/url');
      window.location.href = res.data.url;
    } catch (err) {
      console.error(err);
      setError('Failed to initiate Google Calendar link.');
    }
  };

  // Secure 5-Minute Hold on Slot
  const handleSelectSlot = async (slot: any) => {
    setError(null);
    setSuccess(null);
    if (holdActive && selectedSlot) {
      // Release old slot hold first
      await axios.post('/api/appointments/release', {
        doctorId: selectedDoctor?.profileId,
        startTime: selectedSlot.startTime
      });
    }

    try {
      const res = await axios.post('/api/appointments/hold', {
        doctorId: selectedDoctor?.profileId,
        startTime: slot.startTime,
        endTime: slot.endTime
      });

      if (res.data.success) {
        setSelectedSlot(slot);
        setHoldTimer(300); // 5 minutes in seconds
        setHoldActive(true);
      }
    } catch (err: any) {
      console.error(err);
      setError(err.response?.data?.error || 'Failed to hold slot. It might be locked by another user.');
      fetchAvailableSlots();
    }
  };

  // Cancel / Release Hold Manually
  const handleCancelHold = async () => {
    if (!selectedSlot || !selectedDoctor) return;
    
    setHoldActive(false);
    setHoldTimer(null);
    setSelectedSlot(null);
    setSymptoms('');

    try {
      await axios.post('/api/appointments/release', {
        doctorId: selectedDoctor.profileId,
        startTime: selectedSlot.startTime
      });
      fetchAvailableSlots();
    } catch (err) {
      console.error(err);
    }
  };

  // Book Appointment
  const handleBookAppointment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSlot || !selectedDoctor) return;

    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const res = await axios.post('/api/appointments', {
        doctorId: selectedDoctor.profileId,
        startTime: selectedSlot.startTime,
        endTime: selectedSlot.endTime,
        symptoms
      });

      // Reset Hold
      setHoldActive(false);
      setHoldTimer(null);
      setSelectedSlot(null);
      setSymptoms('');

      setSuccess('Appointment booked successfully!');
      
      // Check for High Urgency Suggester
      if (res.data.urgency === 'HIGH' && res.data.suggestedEarlierSlot) {
        setUrgencyNotice({
          appointmentId: res.data.appointmentId,
          urgency: 'HIGH',
          suggestedSlot: res.data.suggestedEarlierSlot
        });
      }

      fetchAvailableSlots();
      fetchPatientData();
    } catch (err: any) {
      console.error(err);
      setError(err.response?.data?.error || 'Failed to complete booking.');
    } finally {
      setLoading(false);
    }
  };

  // Join Waitlist
  const handleJoinWaitlist = async () => {
    if (!selectedDoctor || !selectedDate) return;
    setError(null);
    setSuccess(null);

    try {
      await axios.post('/api/waitlist', {
        doctorId: selectedDoctor.profileId,
        date: selectedDate
      });
      setSuccess(`Successfully joined the waitlist for Dr. ${selectedDoctor.firstName} on ${new Date(selectedDate).toDateString()}`);
      fetchPatientData();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to join waitlist.');
    }
  };

  // Leave Waitlist
  const handleLeaveWaitlist = async (id: string) => {
    try {
      await axios.delete(`/api/waitlist/${id}`);
      fetchPatientData();
    } catch (err) {
      console.error(err);
    }
  };

  // Cancel Appointment
  const handleCancelAppointment = async (id: string) => {
    if (!window.confirm('Are you sure you want to cancel this appointment? This cannot be undone.')) return;
    setError(null);
    setSuccess(null);

    try {
      await axios.delete(`/api/appointments/${id}`);
      setSuccess('Appointment cancelled successfully.');
      fetchPatientData();
      if (selectedDoctor) fetchAvailableSlots();
    } catch (err) {
      console.error(err);
      setError('Failed to cancel appointment.');
    }
  };

  // Suggestion: Reschedule to Earlier Slot
  const handleAcceptEarlierSlot = async () => {
    if (!urgencyNotice || !urgencyNotice.suggestedSlot) return;
    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      // 1. Cancel original
      await axios.delete(`/api/appointments/${urgencyNotice.appointmentId}`);

      // 2. Book new
      await axios.post('/api/appointments', {
        doctorId: selectedDoctor?.profileId,
        startTime: urgencyNotice.suggestedSlot.start,
        endTime: urgencyNotice.suggestedSlot.end,
        symptoms: 'Rescheduled High Urgency Case'
      });

      setSuccess('Successfully rescheduled to the earlier same-day slot!');
      setUrgencyNotice(null);
      fetchPatientData();
    } catch (err: any) {
      console.error(err);
      setError('Rescheduling slot timed out or became unavailable.');
    } finally {
      setLoading(false);
    }
  };

  // Format timer
  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  // Filter Doctors
  const filteredDoctors = doctors.filter((doc) => {
    const nameMatch = `${doc.firstName} ${doc.lastName}`.toLowerCase().includes(searchQuery.toLowerCase());
    const specMatch = selectedSpecialization === '' || doc.specialization === selectedSpecialization;
    return nameMatch && specMatch;
  });

  return (
    <div className="space-y-6">
      {/* Google Calendar Integrator Alert */}
      <div className="bg-gradient-to-r from-brand-600 to-indigo-600 text-white rounded-2xl p-5 shadow-lg flex flex-col sm:flex-row items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-extrabold tracking-tight flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-amber-300 animate-pulse" /> Google Calendar Integration
          </h2>
          <p className="text-xs text-brand-100 mt-1">
            Connect your primary Google Calendar to automatically inject and synchronize booked medical visits.
          </p>
        </div>
        <button
          onClick={handleConnectGoogle}
          className="px-4 py-2 bg-white hover:bg-slate-100 text-brand-700 font-bold text-xs rounded-xl shadow-md transition-colors shrink-0"
        >
          {user.hasGoogleCalendar ? 'Reconnect Google Account' : 'Link Google Calendar'}
        </button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-200 bg-white p-2 rounded-2xl shadow-sm gap-2">
        <button
          onClick={() => { setActiveTab('book'); setError(null); setSuccess(null); }}
          className={`flex-1 py-2.5 text-sm font-semibold rounded-xl transition-all ${
            activeTab === 'book' ? 'bg-brand-600 text-white shadow-sm' : 'text-slate-500 hover:text-slate-900 hover:bg-slate-50'
          }`}
        >
          Book Consultation
        </button>
        <button
          onClick={() => { setActiveTab('my-appointments'); setError(null); setSuccess(null); }}
          className={`flex-1 py-2.5 text-sm font-semibold rounded-xl transition-all ${
            activeTab === 'my-appointments' ? 'bg-brand-600 text-white shadow-sm' : 'text-slate-500 hover:text-slate-900 hover:bg-slate-50'
          }`}
        >
          Upcoming Bookings
        </button>
        <button
          onClick={() => { setActiveTab('history'); setError(null); setSuccess(null); }}
          className={`flex-1 py-2.5 text-sm font-semibold rounded-xl transition-all ${
            activeTab === 'history' ? 'bg-brand-600 text-white shadow-sm' : 'text-slate-500 hover:text-slate-900 hover:bg-slate-50'
          }`}
        >
          Medical Timeline
        </button>
        <button
          onClick={() => { setActiveTab('waitlist'); setError(null); setSuccess(null); }}
          className={`flex-1 py-2.5 text-sm font-semibold rounded-xl transition-all ${
            activeTab === 'waitlist' ? 'bg-brand-600 text-white shadow-sm' : 'text-slate-500 hover:text-slate-900 hover:bg-slate-50'
          }`}
        >
          Active Waitlists ({waitlists.length})
        </button>
      </div>

      {/* Message feedback */}
      {error && (
        <div className="p-4 bg-red-50 border border-red-200 text-red-700 rounded-xl text-sm flex items-center gap-2.5">
          <AlertCircle className="h-5 w-5 shrink-0" />
          <span>{error}</span>
        </div>
      )}
      {success && (
        <div className="p-4 bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-xl text-sm flex items-center gap-2.5">
          <CheckCircle2 className="h-5 w-5 shrink-0" />
          <span>{success}</span>
        </div>
      )}

      {/* --- HIGH URGENCY RESCHEDULE SUGGESTION POPUP --- */}
      {urgencyNotice && urgencyNotice.suggestedSlot && (
        <div className="pulse-border-red p-5 bg-red-50 border-red-500 text-red-950 rounded-2xl shadow-md space-y-3">
          <div className="flex gap-2.5 items-start">
            <ShieldAlert className="h-6 w-6 text-red-600 shrink-0 mt-0.5" />
            <div>
              <h3 className="text-sm font-bold">⚠️ High Urgency Level Detected!</h3>
              <p className="text-xs text-red-700 mt-1 leading-relaxed">
                Our AI pre-visit system flagged your symptoms as potentially urgent. An earlier slot is available today.
                We suggest moving your booking to address your health sooner.
              </p>
              <div className="bg-white/80 border border-red-100 rounded-xl p-3 mt-3 text-xs flex items-center gap-2 w-fit">
                <Clock className="h-4 w-4 text-red-500" />
                <span className="font-bold">
                  Earlier Same-Day Time: {new Date(urgencyNotice.suggestedSlot.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            </div>
          </div>
          <div className="pt-2 flex justify-end gap-2">
            <button
              onClick={() => setUrgencyNotice(null)}
              className="px-3.5 py-1.5 border border-red-200 text-red-700 hover:bg-red-100 rounded-xl text-xs font-semibold"
            >
              Keep Current Time
            </button>
            <button
              onClick={handleAcceptEarlierSlot}
              className="px-3.5 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-bold flex items-center gap-1 shadow"
            >
              Reschedule Now <ArrowRight className="h-3 w-3" />
            </button>
          </div>
        </div>
      )}

      {/* --- TAB: BOOK CONSULTATION --- */}
      {activeTab === 'book' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Doctors directory list */}
          <div className="lg:col-span-1 bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-4">
            <h2 className="text-base font-bold text-slate-900">Find a Specialist</h2>
            
            <div className="space-y-3">
              <div className="relative">
                <Search className="absolute inset-y-0 left-3 h-4 w-4 text-slate-400 my-auto" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search doctor..."
                  className="w-full pl-9 pr-4 py-2 border border-slate-200 rounded-xl text-xs focus:outline-brand-500 bg-slate-50"
                />
              </div>

              <div>
                <select
                  value={selectedSpecialization}
                  onChange={(e) => setSelectedSpecialization(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs focus:outline-brand-500 bg-white"
                >
                  <option value="">All Specializations</option>
                  {specializations.map((spec) => (
                    <option key={spec} value={spec}>{spec}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="divide-y divide-slate-100 max-h-[350px] overflow-y-auto pr-1">
              {filteredDoctors.map((doc) => (
                <button
                  key={doc.profileId}
                  onClick={() => { setSelectedDoctor(doc); setSelectedSlot(null); }}
                  className={`w-full text-left py-3 px-3.5 rounded-xl transition-colors flex items-center justify-between mt-1 ${
                    selectedDoctor?.profileId === doc.profileId ? 'bg-brand-50 border border-brand-100 text-brand-900' : 'hover:bg-slate-50 text-slate-700'
                  }`}
                >
                  <div>
                    <h3 className="text-xs font-bold">Dr. {doc.firstName} {doc.lastName}</h3>
                    <p className="text-[10px] opacity-75 font-semibold mt-0.5">{doc.specialization}</p>
                  </div>
                  <Star className={`h-4.5 w-4.5 ${selectedDoctor?.profileId === doc.profileId ? 'fill-brand-500 text-brand-500' : 'text-slate-300'}`} />
                </button>
              ))}
            </div>
          </div>

          {/* Date and Slot availability picker */}
          <div className="lg:col-span-2 bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-6">
            {selectedDoctor ? (
              <>
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between border-b border-slate-100 pb-4 gap-2">
                  <div>
                    <h2 className="text-base font-bold text-slate-800">
                      Book with Dr. {selectedDoctor.firstName} {selectedDoctor.lastName}
                    </h2>
                    <p className="text-xs text-brand-600 font-semibold mt-0.5">{selectedDoctor.specialization}</p>
                  </div>

                  <div>
                    <input
                      type="date"
                      value={selectedDate}
                      min={new Date().toISOString().split('T')[0]}
                      onChange={(e) => setSelectedDate(e.target.value)}
                      className="px-3 py-1.5 border border-slate-200 rounded-xl text-xs focus:outline-brand-500"
                    />
                  </div>
                </div>

                {/* Available Slots */}
                <div>
                  <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Available Slots</h3>
                  {availableSlots.length === 0 ? (
                    <div className="p-6 bg-slate-50 border border-dashed border-slate-200 rounded-xl text-center">
                      <p className="text-xs text-slate-500 font-medium">No available working hours or doctor on leave today.</p>
                      <button
                        onClick={handleJoinWaitlist}
                        className="mt-3 inline-flex items-center gap-1 px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white rounded-xl text-xs font-bold shadow-md shadow-brand-100 transition-colors"
                      >
                        <CalendarPlus className="h-4 w-4" /> Join Waitlist
                      </button>
                    </div>
                  ) : (
                    <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
                      {availableSlots.map((slot) => (
                        <button
                          key={slot.time}
                          disabled={!slot.available && !slot.heldByMe}
                          onClick={() => handleSelectSlot(slot)}
                          className={`py-2 rounded-xl text-xs font-bold transition-all border text-center ${
                            slot.heldByMe || selectedSlot?.time === slot.time
                              ? 'bg-brand-600 text-white border-brand-600 ring-2 ring-brand-200'
                              : slot.available
                              ? 'bg-white hover:bg-slate-50 border-slate-200 text-slate-700'
                              : 'bg-slate-50 border-slate-100 text-slate-300 cursor-not-allowed'
                          }`}
                        >
                          {slot.time}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Hold Countdown and Symptom Form */}
                {selectedSlot && (
                  <div className="border border-brand-100 bg-brand-50/20 p-5 rounded-2xl space-y-4">
                    <div className="flex items-center justify-between border-b border-brand-100/50 pb-3">
                      <div>
                        <h4 className="text-xs font-bold text-brand-900 uppercase tracking-wider">Slot Held Securely</h4>
                        <p className="text-xs text-slate-600 mt-0.5">
                          Date: {new Date(selectedDate).toDateString()} at {selectedSlot.time}
                        </p>
                      </div>
                      <div className="px-3.5 py-1.5 bg-brand-600 text-white rounded-xl text-xs font-mono font-bold flex items-center gap-1.5 shadow-sm">
                        <Clock className="h-3.5 w-3.5 animate-pulse" /> {formatTime(holdTimer || 0)}
                      </div>
                    </div>

                    <form onSubmit={handleBookAppointment} className="space-y-4">
                      <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-2">
                          Symptom Intake Form
                        </label>
                        <textarea
                          required
                          value={symptoms}
                          onChange={(e) => setSymptoms(e.target.value)}
                          placeholder="Please describe your clinical symptoms or complaints in detail (e.g. severity, duration). This compiles an AI symptom diagnostic summary."
                          rows={4}
                          className="w-full px-3.5 py-2.5 border border-slate-200 focus:outline-brand-500 rounded-xl text-sm placeholder:text-slate-400 bg-white"
                        ></textarea>
                      </div>

                      <div className="flex gap-2 justify-end">
                        <button
                          type="button"
                          onClick={handleCancelHold}
                          className="px-4 py-2 border border-slate-200 hover:bg-slate-50 rounded-xl text-slate-500 font-semibold text-xs transition-colors"
                        >
                          Release Slot
                        </button>
                        <button
                          type="submit"
                          disabled={loading}
                          className="px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white rounded-xl text-xs font-bold flex items-center gap-1 shadow-md shadow-brand-100 transition-colors"
                        >
                          {loading ? 'Processing...' : 'Confirm Appointment'}
                        </button>
                      </div>
                    </form>
                  </div>
                )}
              </>
            ) : (
              <div className="py-20 text-center text-slate-400 font-medium border border-dashed border-slate-200 rounded-2xl">
                Please select a specialist from the directory to review available booking slots.
              </div>
            )}
          </div>
        </div>
      )}

      {/* --- TAB: UPCOMING APPOINTMENTS --- */}
      {activeTab === 'my-appointments' && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="p-5 border-b border-slate-100">
            <h2 className="text-base font-bold text-slate-900">Your Upcoming Appointments</h2>
            <p className="text-xs text-slate-500 mt-0.5">List of active booked consultations</p>
          </div>

          <div className="divide-y divide-slate-100">
            {myAppointments.filter(a => a.status === 'BOOKED').length === 0 ? (
              <div className="p-12 text-center text-slate-400 font-medium">No active upcoming appointments scheduled.</div>
            ) : (
              myAppointments.filter(a => a.status === 'BOOKED').map((appt) => (
                <div key={appt.id} className="p-5 flex flex-col sm:flex-row justify-between sm:items-center gap-4 hover:bg-slate-50/50 transition-colors">
                  <div className="space-y-1">
                    <h3 className="text-sm font-bold text-slate-800">
                      Dr. {appt.doctor.user.firstName} {appt.doctor.user.lastName}
                    </h3>
                    <p className="text-xs text-brand-600 font-semibold">{appt.doctor.specialization}</p>
                    
                    <div className="flex flex-wrap gap-x-4 gap-y-1 pt-1.5 text-xs text-slate-500 font-medium">
                      <span className="flex items-center gap-1">
                        <Calendar className="h-4 w-4 text-slate-400" />
                        {new Date(appt.startTime).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock className="h-4 w-4 text-slate-400" />
                        {new Date(appt.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} - {new Date(appt.endTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>

                    {appt.symptoms && (
                      <p className="text-xs text-slate-400 pt-2 leading-relaxed bg-slate-50 p-2.5 rounded-xl border border-slate-100 max-w-xl">
                        <span className="font-bold text-slate-500">Your Symptoms:</span> {appt.symptoms}
                      </p>
                    )}
                  </div>

                  <div className="flex sm:flex-col items-start sm:items-end justify-between sm:justify-center gap-2">
                    {appt.symptomSummary && (
                      <span className={`px-2 py-0.5 rounded-full text-[9px] font-extrabold border ${
                        appt.symptomSummary.urgency === 'HIGH' 
                          ? 'bg-red-50 text-red-700 border-red-200 pulse-border-red' 
                          : appt.symptomSummary.urgency === 'MEDIUM' 
                          ? 'bg-amber-50 text-amber-700 border-amber-200' 
                          : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                      }`}>
                        AI Urgency: {appt.symptomSummary.urgency}
                      </span>
                    )}

                    <button
                      onClick={() => handleCancelAppointment(appt.id)}
                      className="px-3.5 py-1.5 border border-red-200 hover:bg-red-50 text-red-600 rounded-xl text-xs font-semibold transition-colors mt-1"
                    >
                      Cancel Consultation
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* --- TAB: MEDICAL TIMELINE --- */}
      {activeTab === 'history' && (
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-6">
          <div>
            <h2 className="text-base font-bold text-slate-900">Your Longitudinal Medical Timeline</h2>
            <p className="text-xs text-slate-500 mt-0.5">Historical archive of diagnoses, medications, and clinical summaries</p>
          </div>

          <div className="relative border-l-2 border-slate-100 ml-4 space-y-8 py-2">
            {timeline.length === 0 ? (
              <div className="p-6 text-center text-slate-400 font-medium">No completed consultation history on record.</div>
            ) : (
              timeline.map((visit) => (
                <div key={visit.id} className="relative pl-7">
                  {/* Timeline bullet */}
                  <span className="absolute -left-[9px] top-1.5 bg-white border-2 border-brand-500 rounded-full h-4 w-4"></span>
                  
                  <div className="space-y-3">
                    {/* Visit Header */}
                    <div>
                      <span className="text-xs text-slate-400 font-medium">
                        {new Date(visit.startTime).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}
                      </span>
                      <h3 className="text-sm font-bold text-slate-900 mt-0.5">
                        Consultation with Dr. {visit.doctor.user.firstName} {visit.doctor.user.lastName}
                      </h3>
                      <p className="text-xs text-brand-600 font-semibold">{visit.doctor.specialization}</p>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {/* Left Column: Symptoms & Clinical Summary */}
                      <div className="space-y-3">
                        {visit.symptoms && (
                          <div className="bg-slate-50 border border-slate-100 rounded-xl p-3 text-xs">
                            <p className="font-bold text-slate-500 mb-1">Chief Complaint / Symptoms:</p>
                            <p className="text-slate-600 leading-relaxed">{visit.symptoms}</p>
                          </div>
                        )}

                        {visit.visitNote?.patientFriendlySummary && (
                          <div className="bg-brand-50/20 border border-brand-100/50 rounded-xl p-4 text-xs space-y-2">
                            <h4 className="font-extrabold text-brand-900 flex items-center gap-1">
                              <Sparkles className="h-4 w-4 text-brand-500" /> Patient-Friendly Visit Summary
                            </h4>
                            <p className="text-slate-700 leading-relaxed whitespace-pre-line">
                              {visit.visitNote.patientFriendlySummary}
                            </p>
                          </div>
                        )}
                      </div>

                      {/* Right Column: Prescriptions */}
                      <div className="space-y-3">
                        <div className="bg-slate-50 border border-slate-100 rounded-xl p-4 text-xs space-y-3">
                          <h4 className="font-bold text-slate-500 flex items-center gap-1">
                            <Pill className="h-4 w-4 text-brand-600" /> Prescribed Medications
                          </h4>
                          {visit.prescriptions?.length === 0 ? (
                            <p className="text-slate-400 italic">No prescriptions issued for this visit.</p>
                          ) : (
                            <div className="divide-y divide-slate-200/50">
                              {visit.prescriptions.map((rx: any) => (
                                <div key={rx.id} className="py-2 first:pt-0 last:pb-0">
                                  <p className="font-bold text-slate-800">{rx.medication}</p>
                                  <p className="text-[11px] text-slate-500 font-medium mt-0.5">
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
        </div>
      )}

      {/* --- TAB: ACTIVE WAITLIST --- */}
      {activeTab === 'waitlist' && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="p-5 border-b border-slate-100">
            <h2 className="text-base font-bold text-slate-900">Your Active Waitlists</h2>
            <p className="text-xs text-slate-500 mt-0.5">Queue list for dates that were previously fully booked</p>
          </div>

          <div className="divide-y divide-slate-100">
            {waitlists.length === 0 ? (
              <div className="p-12 text-center text-slate-400 font-medium">You are not currently on any doctor waitlists.</div>
            ) : (
              waitlists.map((entry) => (
                <div key={entry.id} className="p-5 flex items-center justify-between hover:bg-slate-50/50 transition-colors">
                  <div className="space-y-1">
                    <h3 className="text-sm font-bold text-slate-800">
                      Dr. {entry.doctorProfile.user.firstName} {entry.doctorProfile.user.lastName}
                    </h3>
                    <p className="text-xs text-brand-600 font-semibold">{entry.doctorProfile.specialization}</p>
                    <div className="flex items-center gap-1 pt-1.5 text-xs text-slate-500 font-medium">
                      <Calendar className="h-4 w-4 text-slate-400" />
                      <span>Preferred Date: {new Date(entry.preferredDate).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}</span>
                    </div>
                  </div>

                  <button
                    onClick={() => handleLeaveWaitlist(entry.id)}
                    className="px-3.5 py-1.5 border border-slate-200 hover:bg-slate-100 text-slate-600 rounded-xl text-xs font-semibold transition-colors"
                  >
                    Leave Queue
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
