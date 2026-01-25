import { 
  Injectable, 
  BadRequestException, 
  NotFoundException,
  InternalServerErrorException 
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { UserDocument } from '../schemas/user.schema';
import * as bcrypt from 'bcryptjs';
import * as jwt from 'jsonwebtoken';
import { randomBytes } from 'crypto';
import { getServerAddress } from '../utils/util';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { IAppResponse } from '../interfaces/app-response.interface';

interface AuthUser {
  id: string;
  username: string;
  avatar: string;
  email: string;
}

interface GoogleProfile {
  id: string;
  displayName?: string;
  emails?: { value: string }[];
  photos?: { value: string }[];
}

@Injectable()
export class AuthService {
  private readonly jwtSecret: string;

  constructor(@InjectModel('users') private userModel: Model<UserDocument>) {
    if (!process.env.JWTKey) {
      throw new Error('JWTKey must be defined in environment variables');
    }
    this.jwtSecret = process.env.JWTKey;
  }

  async register(body: RegisterDto, req?: any): Promise<IAppResponse<{ token: string; user: AuthUser }>> {
    const avatar = (req && req.protocol)
      ? getServerAddress(req) + '/images/user_placeholder.png'
      : '/images/user_placeholder.png';

    const newUser = new this.userModel({
      username: body.username,
      email: body.email,
      password: body.password,
      avatar,
    });

    const salt = await bcrypt.genSalt(10);
    newUser.password = await bcrypt.hash(newUser.password, salt);

    try {
      const user = await newUser.save();
      const payload = { 
        id: user.id, 
        username: user.username, 
        avatar: user.avatar, 
        email: user.email 
      };
      const token = jwt.sign(payload, this.jwtSecret, { expiresIn: 604800 });
      
      return { 
        success: true,
        message: 'Registration successful',
        data: { 
          token:  token, 
          user: payload 
        }
      };
    } catch (error) {
      if (error.code === 11000) {
        if (error.keyPattern && error.keyPattern.email) {
          throw new BadRequestException('Email already exists');
        }
        if (error.keyPattern && error.keyPattern.username) {
          throw new BadRequestException('Username already exists');
        }
      }
      throw new InternalServerErrorException('Failed to register user');
    }
  }

  async login(body: LoginDto): Promise<IAppResponse<{ token: string; user: AuthUser }>> {
    const { email, password } = body;
    
    const user = await this.userModel.findOne({ email });
    if (!user) {
      throw new NotFoundException('Email not found');
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      throw new BadRequestException('Password not correct');
    }

    const payload = { 
      id: user.id, 
      username: user.username, 
      avatar: user.avatar, 
      email: user.email 
    };
    const token = jwt.sign(payload, this.jwtSecret, { expiresIn: 604800 });
    
    return { 
      success: true,
      message: 'Login successful',
      data: { 
        token: token, 
        user: payload 
      }
    };
  }

  async findOrCreateGoogleUser(profile: GoogleProfile): Promise<IAppResponse<{ token: string; user: AuthUser }>> {
    try {
      const email = profile?.emails?.[0]?.value;
      const googleId = profile?.id;
      const displayName = profile?.displayName || email?.split('@')[0];
      const avatar = profile?.photos?.[0]?.value || '/images/user_placeholder.png';

      if (!email) {
        throw new BadRequestException('Google profile did not include email');
      }

      // Try find by googleId first
      let user = await this.userModel.findOne({ googleId });
      
      if (!user) {
        // Try find by email
        user = await this.userModel.findOne({ email });
      }

      if (user) {
        // Ensure googleId is set for future logins
        if (!user.googleId) {
          user.googleId = googleId;
          await user.save();
        }
      } else {
        // Create a new user with strong random password (not used for Google auth)
        const newUser = new this.userModel({
          username: displayName,
          email,
          password: randomBytes(32).toString('hex'),
          avatar,
          googleId,
        });
        user = await newUser.save();
      }

      const payload = { 
        id: user.id, 
        username: user.username, 
        avatar: user.avatar, 
        email: user.email 
      };
      const token = jwt.sign(payload, this.jwtSecret, { expiresIn: 604800 });
      
      return { 
        success: true,
        message: 'Google authentication successful',
        data: { 
          token: token, 
          user: payload 
        }
      };
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new InternalServerErrorException('Failed to authenticate with Google');
    }
  }
}