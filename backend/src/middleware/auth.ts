import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import prisma from '../services/db';

export interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    email: string;
    role: 'PATIENT' | 'DOCTOR' | 'ADMIN';
    doctorProfileId?: string; // Cache doctorProfileId if user is DOCTOR
  };
}

export async function authenticateJWT(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return res.status(401).json({ error: 'Access token is missing' });
  }

  const token = authHeader.split(' ')[1];
  if (!token) {
    return res.status(401).json({ error: 'Invalid authorization header format' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'supersecretjwtkey') as {
      id: string;
      email: string;
      role: 'PATIENT' | 'DOCTOR' | 'ADMIN';
    };

    let doctorProfileId: string | undefined = undefined;

    if (decoded.role === 'DOCTOR') {
      const doc = await prisma.doctorProfile.findUnique({
        where: { userId: decoded.id }
      });
      if (doc) {
        doctorProfileId = doc.id;
      }
    }

    req.user = {
      ...decoded,
      doctorProfileId
    };

    next();
  } catch (error) {
    return res.status(403).json({ error: 'Invalid or expired token' });
  }
}

export function requireRole(allowedRoles: ('PATIENT' | 'DOCTOR' | 'ADMIN')[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden: Insufficient privileges' });
    }

    next();
  };
}
