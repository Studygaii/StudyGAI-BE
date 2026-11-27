import { Injectable, Logger } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, VerifyCallback } from 'passport-google-oauth20';
import { AuthService } from './auth.service';

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  private readonly logger = new Logger(GoogleStrategy.name);

  constructor(private readonly authService: AuthService) {
    const clientID = process.env.GOOGLE_CLIENT_ID || 'disabled-in-local-dev';
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET || 'disabled-in-local-dev';
    super({
      clientID,
      clientSecret,
      callbackURL: process.env.GOOGLE_CALLBACK_URL || 'http://localhost:4001/api/v1/auth/google/redirect',
      scope: ['email', 'profile'],
    });

    if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
      this.logger.warn('Google OAuth not configured (GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET unset); email/password auth active');
    }
  }

  async validate(
    accessToken: string, 
    refreshToken: string, 
    profile: any, 
    done: VerifyCallback
  ): Promise<any> {
    try {
      const user = await this.authService.findOrCreateGoogleUser(profile);
      done(null, user);
    } catch (error) {
      done(error, false);
    }
  }
}