import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  UseGuards,
  Request,
  UnauthorizedException,
  Query,
} from '@nestjs/common';
import { PostService } from './post.service';
import { AuthGuard } from '../auth/auth.guard';
import { CreatePostDto, UpdatePostDto } from './dto/post.dto';

@Controller('posts')
@UseGuards(AuthGuard)
export class PostController {
  constructor(private readonly postService: PostService) {}

  @Post()
  async createPost(@Request() req, @Body() createPostDto: CreatePostDto) {
    return this.postService.createPost(req.user.sub, createPostDto);
  }

  @Get()
  async getAllPosts(@Query('page') page = 1, @Query('limit') limit = 10) {
    return this.postService.getAllPosts(page, limit);
  }

  @Get(':id')
  async getPostById(@Param('id') id: string) {
    return this.postService.getPostById(id);
  }

  @Put(':id')
  async updatePost(
    @Request() req,
    @Param('id') id: string,
    @Body() updatePostDto: UpdatePostDto,
  ) {
    const post = await this.postService.getPostById(id);
    if (post.userId !== req.user.sub) {
      throw new UnauthorizedException('You can only update your own posts');
    }
    return this.postService.updatePost(id, updatePostDto);
  }

  @Delete(':id')
  async deletePost(@Request() req, @Param('id') id: string) {
    const post = await this.postService.getPostById(id);
    if (post.userId !== req.user.sub) {
      throw new UnauthorizedException('You can only delete your own posts');
    }
    return this.postService.deletePost(id);
  }

  @Get('user/:userId')
  async getUserPosts(
    @Param('userId') userId: string,
    @Query('page') page = 1,
    @Query('limit') limit = 10,
  ) {
    return this.postService.getUserPosts(userId, page, limit);
  }
}
