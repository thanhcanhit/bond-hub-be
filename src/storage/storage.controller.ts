import {
  Controller,
  Post,
  Put,
  Delete,
  UseInterceptors,
  UploadedFiles,
  UploadedFile,
  Body,
  Param,
  UseGuards,
} from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { StorageService } from './storage.service';
import { AuthGuard } from '../auth/auth.guard';
import { FileMetadata } from './interfaces/file-metadata.interface';
import { Public } from 'src/auth/public.decorator';

@Controller('storage')
@UseGuards(AuthGuard)
@Public()
export class StorageController {
  constructor(private readonly storageService: StorageService) {}

  @Post('upload/:bucket')
  @UseInterceptors(FilesInterceptor('files'))
  async uploadFiles(
    @UploadedFiles() files: Express.Multer.File[],
    @Param('bucket') bucketName: string,
    @Body('path') path?: string,
  ): Promise<FileMetadata[]> {
    return this.storageService.uploadFiles(files, bucketName, path);
  }

  @Put('update/:bucket/:path(*)')
  @UseInterceptors(FileInterceptor('file'))
  async updateFile(
    @UploadedFile() file: Express.Multer.File,
    @Param('bucket') bucketName: string,
    @Param('path') filePath: string,
  ): Promise<FileMetadata> {
    return this.storageService.updateFile(file, filePath, bucketName);
  }

  @Delete('delete/:bucket/:path(*)')
  async deleteFile(
    @Param('bucket') bucketName: string,
    @Param('path') filePath: string,
  ) {
    return this.storageService.deleteFile(filePath, bucketName);
  }

  @Delete('delete-multiple/:bucket')
  async deleteFiles(
    @Param('bucket') bucketName: string,
    @Body('paths') paths: string[],
  ) {
    return this.storageService.deleteFiles(paths, bucketName);
  }
}
