import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsIn, IsOptional, IsString } from 'class-validator';
import { SendMessagesDto } from './send-messages.dto';
import { RagMode } from '../../rag/rag-orchestrator.service';

export class SendMessagesWithCourseDto extends SendMessagesDto {
  @ApiProperty({ example: '507f1f77bcf86cd799439011', required: false })
  @IsOptional()
  @IsString()
  courseId?: string;

  @ApiProperty({
    description: 'Optional subset of CourseSource IDs to ground the answer in (NotebookLM checkboxes)',
    example: ['673c5e8f9a1b2c3d4e5f6789'],
    required: false,
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  sourceIds?: string[];

  @ApiProperty({
    description: 'Grounding mode: default, tutor (Socratic hints), summary (synthesis), or strict',
    enum: ['default', 'tutor', 'summary', 'strict'],
    required: false,
  })
  @IsOptional()
  @IsIn(['default', 'tutor', 'summary', 'strict'])
  mode?: RagMode;
}
