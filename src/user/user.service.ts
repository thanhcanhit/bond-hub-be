import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';

@Injectable()
export class UserService {
  constructor(private prisma: PrismaService) {}

  async getAllUsers() {
    return this.prisma.user.findMany();
  }

  async getUserById(id: string) {
    return this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        phoneNumber: true,
        createdAt: true,
        updatedAt: true,
        userInfo: {
          select: {
            fullName: true,
            dateOfBirth: true,
            gender: true,
            bio: true,
            profilePictureUrl: true,
            statusMessage: true,
            lastSeen: true,
            coverImgUrl: true,
          },
        },
      },
    });
  }

  async getUserBasicInfo(id: string) {
    return this.prisma.userInfo.findUnique({
      where: { id },
      select: {
        fullName: true,
        dateOfBirth: true,
        gender: true,
        bio: true,
        profilePictureUrl: true,
        statusMessage: true,
        coverImgUrl: true,
      },
    });
  }
}
