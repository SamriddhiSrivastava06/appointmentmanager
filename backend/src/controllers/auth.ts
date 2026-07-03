import { Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { AuthenticatedRequest } from '../middleware/auth';
import prisma from '../services/db';
import { getAuthUrl, exchangeCodeAndSave } from '../services/calendar';

const JWT_SECRET = process.env.JWT_SECRET || 'supersecretjwtkey';

export async function register(req: AuthenticatedRequest, res: Response) {
  const { email, password, firstName, lastName } = req.body;

  if (!email || !password || !firstName || !lastName) {
    return res.status(400).json({ error: 'All fields are required' });
  }

  try {
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return res.status(400).json({ error: 'Email already exists' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash,
        firstName,
        lastName,
        role: 'PATIENT' // Register only allows creating patients
      }
    });

    const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, JWT_SECRET, {
      expiresIn: '24h'
    });

    return res.status(201).json({
      token,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role
      }
    });
  } catch (error: any) {
    console.error('[AUTH] Registration error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

export async function login(req: AuthenticatedRequest, res: Response) {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  try {
    const user = await prisma.user.findUnique({
      where: { email },
      include: { doctorProfile: true }
    });

    if (!user) {
      return res.status(400).json({ error: 'Invalid email or password' });
    }

    const matches = await bcrypt.compare(password, user.passwordHash);
    if (!matches) {
      return res.status(400).json({ error: 'Invalid email or password' });
    }

    const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, JWT_SECRET, {
      expiresIn: '24h'
    });

    return res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        doctorProfileId: user.doctorProfile?.id
      }
    });
  } catch (error: any) {
    console.error('[AUTH] Login error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

export async function getMe(req: AuthenticatedRequest, res: Response) {
  if (!req.user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      include: {
        doctorProfile: true,
        googleTokens: {
          select: { id: true }
        }
      }
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    return res.json({
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        doctorProfileId: user.doctorProfile?.id,
        hasGoogleCalendar: !!user.googleTokens
      }
    });
  } catch (error: any) {
    console.error('[AUTH] GetMe error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

export function getGoogleUrl(req: AuthenticatedRequest, res: Response) {
  if (!req.user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const url = getAuthUrl(req.user.id);
  return res.json({ url });
}

export async function googleCallback(req: AuthenticatedRequest, res: Response) {
  const { code, state } = req.query;

  if (!code || !state) {
    return res.status(400).send('Google OAuth code or state parameter is missing.');
  }

  const userId = state as string;

  try {
    await exchangeCodeAndSave(userId, code as string);
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    // Redirect user back to the front-end page (which handles visual success)
    return res.redirect(`${frontendUrl}/oauth-success`);
  } catch (error: any) {
    console.error('[CALENDAR] OAuth exchange failed:', error);
    return res.status(500).send('Failed to authenticate Google Calendar OAuth.');
  }
}
