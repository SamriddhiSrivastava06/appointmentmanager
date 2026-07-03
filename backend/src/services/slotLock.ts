import prisma from './db';

/**
 * Attempts to acquire a 5-minute hold on a doctor's time slot for a patient.
 */
export async function acquireHold(
  doctorId: string,
  startTime: Date,
  endTime: Date,
  heldById: string
): Promise<boolean> {
  const now = new Date();
  
  await prisma.auditLog.create({
    data: {
      action: 'HOLD_ATTEMPT',
      details: `User ${heldById} attempting to hold slot for doctor profile ${doctorId} at ${startTime.toISOString()}`,
      userId: heldById
    }
  });

  try {
    return await prisma.$transaction(async (tx) => {
      // 1. Check if the doctor is on leave
      const leaveDay = await tx.leaveDay.findFirst({
        where: {
          doctorProfileId: doctorId,
          date: {
            gte: new Date(startTime.getFullYear(), startTime.getMonth(), startTime.getDate()),
            lt: new Date(startTime.getFullYear(), startTime.getMonth(), startTime.getDate() + 1)
          }
        }
      });

      if (leaveDay) {
        await tx.auditLog.create({
          data: {
            action: 'HOLD_REJECTED',
            details: `Doctor is on leave on this date: ${startTime.toDateString()}`,
            userId: heldById
          }
        });
        return false;
      }

      // 2. Check if there is an active booked appointment
      const existingBooking = await tx.appointment.findFirst({
        where: {
          doctorId,
          startTime,
          status: 'BOOKED'
        }
      });
      if (existingBooking) {
        await tx.auditLog.create({
          data: {
            action: 'HOLD_REJECTED',
            details: `Slot already booked by appointment ${existingBooking.id}`,
            userId: heldById
          }
        });
        return false;
      }

      // 3. Clear expired or resolved holds for this slot to avoid conflict with the unique index
      await tx.slotHold.deleteMany({
        where: {
          doctorId,
          startTime,
          OR: [
            { expiresAt: { lte: now } },
            { resolved: true }
          ]
        }
      });

      // 4. Check for active holds by another user
      const activeHold = await tx.slotHold.findFirst({
        where: {
          doctorId,
          startTime,
          expiresAt: { gt: now },
          resolved: false
        }
      });

      if (activeHold) {
        if (activeHold.heldById === heldById) {
          // If current user already holds it, extend it
          await tx.slotHold.update({
            where: { id: activeHold.id },
            data: { expiresAt: new Date(now.getTime() + 5 * 60 * 1000) }
          });
          return true;
        }
        await tx.auditLog.create({
          data: {
            action: 'HOLD_CONFLICT',
            details: `Slot active hold exists by user ${activeHold.heldById}`,
            userId: heldById
          }
        });
        return false;
      }

      // 5. Create the new hold
      await tx.slotHold.create({
        data: {
          doctorId,
          startTime,
          endTime,
          heldById,
          expiresAt: new Date(now.getTime() + 5 * 60 * 1000) // 5 min hold
        }
      });

      await tx.auditLog.create({
        data: {
          action: 'HOLD_SUCCESS',
          details: `Slot hold secured for user ${heldById} until ${new Date(now.getTime() + 5 * 60 * 1000).toISOString()}`,
          userId: heldById
        }
      });

      return true;
    });
  } catch (error: any) {
    console.error('Error acquiring hold:', error);
    await prisma.auditLog.create({
      data: {
        action: 'HOLD_FAILED',
        details: `Slot hold failed due to concurrent lock: ${error.message || error}`,
        userId: heldById
      }
    });
    return false;
  }
}

/**
 * Releases a slot hold (e.g. if the patient decides to cancel the booking flow before 5 minutes).
 */
export async function releaseHold(doctorId: string, startTime: Date, heldById: string): Promise<boolean> {
  try {
    const deleted = await prisma.slotHold.deleteMany({
      where: {
        doctorId,
        startTime,
        heldById
      }
    });
    
    if (deleted.count > 0) {
      await prisma.auditLog.create({
        data: {
          action: 'HOLD_RELEASED',
          details: `Slot hold manually released by user ${heldById}`,
          userId: heldById
        }
      });
      return true;
    }
    return false;
  } catch (error: any) {
    console.error('Error releasing hold:', error);
    return false;
  }
}

/**
 * Resolves a slot hold when booking is successfully confirmed.
 */
export async function resolveHold(doctorId: string, startTime: Date, heldById: string): Promise<boolean> {
  try {
    const updated = await prisma.slotHold.updateMany({
      where: {
        doctorId,
        startTime,
        heldById,
        resolved: false
      },
      data: {
        resolved: true
      }
    });
    
    if (updated.count > 0) {
      await prisma.auditLog.create({
        data: {
          action: 'HOLD_RESOLVED',
          details: `Slot hold successfully resolved to confirmed booking for user ${heldById}`,
          userId: heldById
        }
      });
      return true;
    }
    return false;
  } catch (error: any) {
    console.error('Error resolving hold:', error);
    return false;
  }
}

/**
 * Background cleanup task for expired holds.
 */
export async function cleanupExpiredHolds(): Promise<number> {
  const now = new Date();
  try {
    const expiredHolds = await prisma.slotHold.findMany({
      where: {
        expiresAt: { lte: now },
        resolved: false
      }
    });

    if (expiredHolds.length === 0) return 0;

    const deleted = await prisma.slotHold.deleteMany({
      where: {
        expiresAt: { lte: now },
        resolved: false
      }
    });

    for (const hold of expiredHolds) {
      await prisma.auditLog.create({
        data: {
          action: 'HOLD_EXPIRED',
          details: `Slot hold for user ${hold.heldById} at ${hold.startTime.toISOString()} expired and cleaned up`,
          userId: hold.heldById
        }
      });
    }

    return deleted.count;
  } catch (error: any) {
    console.error('Error cleaning up expired holds:', error);
    return 0;
  }
}
