import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth';
import prisma from '../services/db';

/**
 * Get all doctor profiles.
 */
export async function getDoctors(req: AuthenticatedRequest, res: Response) {
  const { specialization } = req.query;

  try {
    const where: any = {};
    if (specialization) {
      where.specialization = {
        contains: specialization as string,
        mode: 'insensitive'
      };
    }

    const doctors = await prisma.doctorProfile.findMany({
      where,
      include: {
        user: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true
          }
        }
      }
    });

    const formatted = doctors.map((d) => ({
      profileId: d.id,
      userId: d.user.id,
      email: d.user.email,
      firstName: d.user.firstName,
      lastName: d.user.lastName,
      specialization: d.specialization,
      workingHours: typeof d.workingHours === 'string' ? JSON.parse(d.workingHours) : d.workingHours,
      slotDuration: d.slotDuration
    }));

    return res.json(formatted);
  } catch (error: any) {
    console.error('[DOCTORS] Get doctors error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * Get distinct specializations.
 */
export async function getSpecializations(req: AuthenticatedRequest, res: Response) {
  try {
    const specializations = await prisma.doctorProfile.findMany({
      select: { specialization: true },
      distinct: ['specialization']
    });

    const list = specializations.map((s) => s.specialization);
    return res.json(list);
  } catch (error: any) {
    console.error('[DOCTORS] Distinct specializations error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * Calculate available slots for a doctor on a specific date.
 */
export async function getAvailableSlots(req: AuthenticatedRequest, res: Response) {
  const { id } = req.params; // doctorProfileId
  const { date } = req.query; // format: YYYY-MM-DD

  if (!date) {
    return res.status(400).json({ error: 'date query parameter is required' });
  }

  try {
    const queryDate = new Date(date as string);
    queryDate.setHours(0, 0, 0, 0);

    const doctor = await prisma.doctorProfile.findUnique({
      where: { id },
      include: { leaveDays: true }
    });

    if (!doctor) {
      return res.status(404).json({ error: 'Doctor profile not found' });
    }

    // 1. Check if the doctor is on leave today
    const onLeave = doctor.leaveDays.some(
      (ld) => ld.date.toDateString() === queryDate.toDateString()
    );

    if (onLeave) {
      return res.json([]); // Return empty if on leave
    }

    // 2. Check if weekend (Saturday or Sunday) - default weekends closed
    const dayOfWeek = queryDate.getDay();
    if (dayOfWeek === 0 || dayOfWeek === 6) {
      return res.json([]); // Empty on weekends
    }

    const workingHours = typeof doctor.workingHours === 'string' ? JSON.parse(doctor.workingHours) : (doctor.workingHours || { start: '09:00', end: '17:00' });
    const slotDuration = doctor.slotDuration;

    const [startH, startM] = workingHours.start.split(':').map(Number);
    const [endH, endM] = workingHours.end.split(':').map(Number);

    const dayStart = new Date(queryDate);
    dayStart.setHours(startH, startM, 0, 0);

    const dayEnd = new Date(queryDate);
    dayEnd.setHours(endH, endM, 0, 0);

    // 3. Query all booked appointments
    const bookings = await prisma.appointment.findMany({
      where: {
        doctorId: id,
        startTime: { gte: dayStart, lt: dayEnd },
        status: 'BOOKED'
      }
    });

    // 4. Query all active slot holds
    const holds = await prisma.slotHold.findMany({
      where: {
        doctorId: id,
        startTime: { gte: dayStart, lt: dayEnd },
        expiresAt: { gt: new Date() },
        resolved: false
      }
    });

    const slots: any[] = [];
    let currentSlotStart = new Date(dayStart);

    while (currentSlotStart < dayEnd) {
      const currentSlotEnd = new Date(currentSlotStart.getTime() + slotDuration * 60 * 1000);
      
      const isBooked = bookings.some((b) => b.startTime.getTime() === currentSlotStart.getTime());
      const isHeld = holds.some((h) => h.startTime.getTime() === currentSlotStart.getTime());

      // If the slot is in the past, don't show it as available
      const isPast = currentSlotStart.getTime() < Date.now();

      slots.push({
        time: currentSlotStart.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }),
        startTime: currentSlotStart.toISOString(),
        endTime: currentSlotEnd.toISOString(),
        available: !isBooked && !isHeld && !isPast,
        heldByMe: isHeld && holds.some((h) => h.startTime.getTime() === currentSlotStart.getTime() && h.heldById === req.user?.id)
      });

      currentSlotStart = currentSlotEnd;
    }

    return res.json(slots);
  } catch (error: any) {
    console.error('[DOCTORS] Calculate available slots error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
