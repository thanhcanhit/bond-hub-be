import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePostDto, UpdatePostDto } from './dto/post.dto';

@Injectable()
export class PostService {
  constructor(private prisma: PrismaService) {}

  async createPost(userId: string, createPostDto: CreatePostDto) {
    return this.prisma.post.create({
      data: {
        userId,
        content: createPostDto.content,
        media: createPostDto.media,
        privacyLevel: createPostDto.privacyLevel || 'public',
      },
      include: {
        user: {
          select: {
            id: true,
            userInfo: {
              select: {
                fullName: true,
                profilePictureUrl: true,
              },
            },
          },
        },
      },
    });
  }

  async getAllPosts(page: number, limit: number) {
    const skip = (page - 1) * limit;
    const [posts, total] = await Promise.all([
      this.prisma.post.findMany({
        skip,
        take: limit,
        orderBy: {
          createdAt: 'desc',
        },
        include: {
          user: {
            select: {
              id: true,
              userInfo: {
                select: {
                  fullName: true,
                  profilePictureUrl: true,
                },
              },
            },
          },
          _count: {
            select: {
              reactions: true,
              comments: true,
            },
          },
        },
      }),
      this.prisma.post.count(),
    ]);

    return {
      data: posts,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getPostById(id: string) {
    const post = await this.prisma.post.findUnique({
      where: { id },
      include: {
        user: {
          select: {
            id: true,
            userInfo: {
              select: {
                fullName: true,
                profilePictureUrl: true,
              },
            },
          },
        },
        _count: {
          select: {
            reactions: true,
            comments: true,
          },
        },
      },
    });

    if (!post) {
      throw new NotFoundException(`Post with ID ${id} not found`);
    }

    return post;
  }

  async updatePost(id: string, updatePostDto: UpdatePostDto) {
    return this.prisma.post.update({
      where: { id },
      data: {
        content: updatePostDto.content,
        media: updatePostDto.media,
        privacyLevel: updatePostDto.privacyLevel,
      },
      include: {
        user: {
          select: {
            id: true,
            userInfo: {
              select: {
                fullName: true,
                profilePictureUrl: true,
              },
            },
          },
        },
      },
    });
  }

  async deletePost(id: string) {
    return this.prisma.post.delete({
      where: { id },
    });
  }

  async getUserPosts(userId: string, page: number, limit: number) {
    const skip = (page - 1) * limit;
    const [posts, total] = await Promise.all([
      this.prisma.post.findMany({
        where: { userId },
        skip,
        take: limit,
        orderBy: {
          createdAt: 'desc',
        },
        include: {
          user: {
            select: {
              id: true,
              userInfo: {
                select: {
                  fullName: true,
                  profilePictureUrl: true,
                },
              },
            },
          },
          _count: {
            select: {
              reactions: true,
              comments: true,
            },
          },
        },
      }),
      this.prisma.post.count({ where: { userId } }),
    ]);

    return {
      data: posts,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }
}
