export class CreatePostDto {
  content?: string;
  media?: any;
  privacyLevel?: string;
}

export class UpdatePostDto {
  content?: string;
  media?: any;
  privacyLevel?: string;
}

export class PostResponseDto {
  id: string;
  userId: string;
  content: string;
  media: any;
  privacyLevel: string;
  createdAt: Date;
  updatedAt: Date;
}
