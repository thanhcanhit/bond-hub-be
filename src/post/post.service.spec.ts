import { Test, TestingModule } from '@nestjs/testing';
import { PostService } from './post.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePostDto, UpdatePostDto } from './dto/post.dto';
import { NotFoundException } from '@nestjs/common';

describe('PostService', () => {
  let service: PostService;
  let prisma: PrismaService;

  const mockPrismaService = {
    post: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PostService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
      ],
    }).compile();

    service = module.get<PostService>(PostService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createPost', () => {
    it('should create a post', async () => {
      const createPostDto: CreatePostDto = {
        content: 'Test post',
        privacyLevel: 'public',
      };
      const userId = 'test-user-id';
      const expectedPost = {
        id: 'test-post-id',
        userId,
        content: createPostDto.content,
        privacyLevel: createPostDto.privacyLevel,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockPrismaService.post.create.mockResolvedValue(expectedPost);

      const result = await service.createPost(userId, createPostDto);
      expect(result).toEqual(expectedPost);
      expect(mockPrismaService.post.create).toHaveBeenCalledWith({
        data: {
          userId,
          content: createPostDto.content,
          media: undefined,
          privacyLevel: createPostDto.privacyLevel,
        },
        include: expect.any(Object),
      });
    });
  });

  describe('getPostById', () => {
    it('should return a post if it exists', async () => {
      const postId = 'test-post-id';
      const expectedPost = {
        id: postId,
        content: 'Test post',
        userId: 'test-user-id',
      };

      mockPrismaService.post.findUnique.mockResolvedValue(expectedPost);

      const result = await service.getPostById(postId);
      expect(result).toEqual(expectedPost);
    });

    it('should throw NotFoundException if post does not exist', async () => {
      const postId = 'non-existent-id';
      mockPrismaService.post.findUnique.mockResolvedValue(null);

      await expect(service.getPostById(postId)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('updatePost', () => {
    it('should update a post', async () => {
      const postId = 'test-post-id';
      const updatePostDto: UpdatePostDto = {
        content: 'Updated content',
      };
      const expectedPost = {
        id: postId,
        content: updatePostDto.content,
      };

      mockPrismaService.post.update.mockResolvedValue(expectedPost);

      const result = await service.updatePost(postId, updatePostDto);
      expect(result).toEqual(expectedPost);
      expect(mockPrismaService.post.update).toHaveBeenCalledWith({
        where: { id: postId },
        data: updatePostDto,
        include: expect.any(Object),
      });
    });
  });

  describe('deletePost', () => {
    it('should delete a post', async () => {
      const postId = 'test-post-id';
      const expectedPost = {
        id: postId,
        content: 'Deleted post',
      };

      mockPrismaService.post.delete.mockResolvedValue(expectedPost);

      const result = await service.deletePost(postId);
      expect(result).toEqual(expectedPost);
      expect(mockPrismaService.post.delete).toHaveBeenCalledWith({
        where: { id: postId },
      });
    });
  });

  describe('getAllPosts', () => {
    it('should return paginated posts', async () => {
      const page = 1;
      const limit = 10;
      const mockPosts = [
        { id: '1', content: 'Post 1' },
        { id: '2', content: 'Post 2' },
      ];
      const totalPosts = 20;

      mockPrismaService.post.findMany.mockResolvedValue(mockPosts);
      mockPrismaService.post.count.mockResolvedValue(totalPosts);

      const result = await service.getAllPosts(page, limit);

      expect(result).toEqual({
        data: mockPosts,
        meta: {
          total: totalPosts,
          page,
          limit,
          totalPages: Math.ceil(totalPosts / limit),
        },
      });
    });
  });
});
