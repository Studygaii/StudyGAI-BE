import { Types } from 'mongoose';

export class UserEntity {
  _id?: Types.ObjectId;
  email: string;
  username: string;
  password: string;
  courses?: Types.ObjectId[];
  avatar: string;
  googleId?: string;
  date?: Date;
  createdAt?: Date;
  updatedAt?: Date;
}

export default UserEntity;
