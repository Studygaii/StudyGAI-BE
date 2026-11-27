import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsNotEmpty, IsOptional, IsString, IsUrl, MaxLength } from 'class-validator';

export class IngestUrlDto {
  @ApiProperty({ example: 'https://en.wikipedia.org/wiki/Chain_rule' })
  @IsNotEmpty()
  @IsUrl({ require_protocol: true })
  url: string;

  @ApiProperty({ example: 'Chain Rule Reference', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;
}

export class IngestNoteDto {
  @ApiProperty({ example: 'Lecture 4 Personal Notes' })
  @IsNotEmpty()
  @IsString()
  @MaxLength(200)
  title: string;

  @ApiProperty({ example: 'Key formula: d/dx[f(g(x))] = f\'(g(x)) * g\'(x)' })
  @IsNotEmpty()
  @IsString()
  content: string;
}

export class PresignUploadDto {
  @ApiProperty({ example: 'calculus_chapter3.pdf' })
  @IsNotEmpty()
  @IsString()
  fileName: string;

  @ApiProperty({ example: 'application/pdf' })
  @IsNotEmpty()
  @IsString()
  mimeType: string;

  @ApiProperty({ example: 'a3b1...64-char-hex-sha256' })
  @IsNotEmpty()
  @IsString()
  sha256: string;

  @ApiProperty({ example: 1048576, required: false })
  @IsOptional()
  byteSize?: number;
}

export class ToggleSourceDto {
  @ApiProperty({ example: true })
  @IsBoolean()
  enabled: boolean;
}
