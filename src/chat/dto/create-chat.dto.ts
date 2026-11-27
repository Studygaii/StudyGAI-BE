import { IsNotEmpty, IsString, IsOptional, IsArray } from 'class-validator';
import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';

export class CreateChatDto {
  @ApiPropertyOptional({ example: 'Chat title' })
  @IsOptional()
  @IsString()
  title?: string;

  @ApiPropertyOptional({ example: '646b...userId (derived from JWT automatically)' })
  @IsOptional()
  @IsString()
  creator?: string;

  @ApiProperty({ example: '646b...courseId' })
  @IsNotEmpty()
  @IsString()
  course: string;

  @ApiPropertyOptional({ type: [Object] })
  @IsOptional()
  @IsArray()
  messages?: any[];
}
