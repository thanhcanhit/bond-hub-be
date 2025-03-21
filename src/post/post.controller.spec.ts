import { Test, TestingModule } from '@nestjs/testing';
import { PostController } from './post.controller';
import { PostService } from './post.service';
import { CreatePostDto, UpdatePostDto } from './dto/post.dto';
import { UnauthorizedException } from '@nestjs/common';

describe('PostController', () => {
  let controller: PostController;
  let service: PostService;

  const mockPostService = {
    createPost: jest.fn(),
    getAllPosts: jest.fn(),
    getPostById: jest.fn(),
    updatePost: jest.fn(),
    deletePost: jest.fn(),
    getUserPosts: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [PostController],
      providers: [
        {
          provide: PostService,
          useValue: mockPostService,
        },
      ],
    }).compile();

    controller = module.get<PostController>(PostController);
    service = module.get<PostService>(PostService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('createPost', () => {
    it('should create a post', async () => {
      const createPostDto: CreatePostDto = {
        content: 'Test post',
        privacyLevel: 'public',
      };
      const req = { user: { sub: 'test-user-id' } };
      const expectedPost = {
        id: 'test-post-id',
        userId: req.user.sub,
        content: createPostDto.content,
        privacyLevel: createPostDto.privacyLevel,
      };

      mockPostService.createPost.mockResolvedValue(expectedPost);

      const result = await controller.createPost(req, createPostDto);
      expect(result).toEqual(expectedPost);
      expect(mockPostService.createPost).toHaveBeenCalledWith(
        req.user.sub,
        createPostDto,
      );
    });
  });

  describe('updatePost', () => {
    it('should update a post if user is the owner', async () => {
      const postId = 'test-post-id';
      const userId = 'test-user-id';
      const updatePostDto: UpdatePostDto = {
        content: 'Updated content',
      };
      const req = { user: { sub: userId } };
      const existingPost = {
        id: postId,
        userId,
        content: 'Original content',
      };
      const updatedPost = {
        ...existingPost,
        content: updatePostDto.content,
      };

      mockPostService.getPostById.mockResolvedValue(existingPost);
      mockPostService.updatePost.mockResolvedValue(updatedPost);

      const result = await controller.updatePost(req, postId, updatePostDto);
      expect(result).toEqual(updatedPost);
    });

    it('should throw UnauthorizedException if user is not the owner', async () => {
      const postId = 'test-post-id';
      const updatePostDto: UpdatePostDto = {
        content: 'Updated content',
      };
      const req = { user: { sub: 'different-user-id' } };
      const existingPost = {
        id: postId,
        userId: 'original-user-id',
        content: 'Original content',
      };

      mockPostService.getPostById.mockResolvedValue(existingPost);

      await expect(
        controller.updatePost(req, postId, updatePostDto),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('deletePost', () => {
    it('should delete a post if user is the owner', async () => {
      const postId = 'test-post-id';
      const userId = 'test-user-id';
      const req = { user: { sub: userId } };
      const existingPost = {
        id: postId,
        userId,
        content: 'Post to delete',
      };

      mockPostService.getPostById.mockResolvedValue(existingPost);
      mockPostService.deletePost.mockResolvedValue(existingPost);

      const result = await controller.deletePost(req, postId);
      expect(result).toEqual(existingPost);
    });

    it('should throw UnauthorizedException if user is not the owner', async () => {
      const postId = 'test-post-id';
      const req = { user: { sub: 'different-user-id' } };
      const existingPost = {
        id: postId,
        userId: 'original-user-id',
        content: 'Post to delete',
      };

      mockPostService.getPostById.mockResolvedValue(existingPost);

      await expect(controller.deletePost(req, postId)).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('getAllPosts', () => {
    it('should return paginated posts', async () => {
      const page = 1;
      const limit = 10;
      const expectedResponse = {
        data: [
          { id: '1', content: 'Post 1' },
          { id: '2', content: 'Post 2' },
        ],
        meta: {
          total: 20,
          page,
          limit,
          totalPages: 2,
        },
      };

      mockPostService.getAllPosts.mockResolvedValue(expectedResponse);

      const result = await controller.getAllPosts(page, limit);
      expect(result).toEqual(expectedResponse);
      expect(mockPostService.getAllPosts).toHaveBeenCalledWith(page, limit);
    });
  });
});
