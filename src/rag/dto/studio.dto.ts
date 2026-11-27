import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { AudioOverviewStyle } from '../studio.service';

export class GenerateConceptGraphDto {
  @ApiProperty({ required: false, default: false })
  @IsOptional()
  @IsBoolean()
  force?: boolean;

  @ApiProperty({ required: false, type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  sourceIds?: string[];
}

export class GenerateAudioOverviewDto {
  @ApiProperty({
    required: false,
    enum: ['deep_dive', 'brief', 'debate', 'exam_cram'],
    default: 'deep_dive',
  })
  @IsOptional()
  @IsIn(['deep_dive', 'brief', 'debate', 'exam_cram'])
  style?: AudioOverviewStyle;

  @ApiProperty({ required: false, example: 'Chain Rule and Backpropagation' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  focusTopic?: string;

  @ApiProperty({ required: false, type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  sourceIds?: string[];
}

export class GenerateExamPredictorDto {
  @ApiProperty({ required: false, type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  sourceIds?: string[];
}
