import { IsString, IsArray, IsOptional, IsMongoId } from 'class-validator';
import { Types } from 'mongoose';

export class CreateGroupChatDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsMongoId()
  creator?: string;

  @IsOptional()
  @IsArray()
  @IsMongoId({ each: true })
  members?: Types.ObjectId[];

  @IsMongoId()
  course: string;

  @IsOptional()
  @IsString()
  avatar?: string;
}

export class AddMemberDto {
  @IsMongoId()
  groupChatId: string;

  @IsMongoId()
  userId: string;
}

export class RemoveMemberDto {
  @IsMongoId()
  groupChatId: string;

  @IsMongoId()
  userId: string;
}

export class SendGroupMessageDto {
  @IsMongoId()
  groupChatId: string;

  @IsString()
  message: string;

  @IsMongoId()
  sender: string;
}
