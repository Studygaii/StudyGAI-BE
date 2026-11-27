import { IsNotEmpty, IsString, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateCourseDto {
  @ApiProperty({ example: 'Introduction to NestJS' })
  @IsNotEmpty()
  @IsString()
  title: string;

  @ApiPropertyOptional({ example: 'A short description' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ example: '646b...userId (derived from JWT automatically)' })
  @IsOptional()
  @IsString()
  creator?: string;

  @ApiPropertyOptional({ type: [Object] })
  @IsOptional()
  files?: any[];
}
