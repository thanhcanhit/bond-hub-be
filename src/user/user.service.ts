import { Injectable, NotFoundException } from '@nestjs/common';
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

  async searchUserByEmailOrPhone(email?: string, phoneNumber?: string) {
    // Kiểm tra xem có ít nhất một trong hai tham số được cung cấp
    if (!email && !phoneNumber) {
      throw new NotFoundException(
        'Vui lòng cung cấp email hoặc số điện thoại để tìm kiếm',
      );
    }

    // Tìm kiếm người dùng theo email hoặc số điện thoại
    const user = await this.prisma.user.findFirst({
      where: {
        OR: [
          { email: email || undefined },
          { phoneNumber: phoneNumber || undefined },
        ],
      },
      include: {
        userInfo: true,
      },
    });

    // Nếu không tìm thấy người dùng hoặc người dùng đã chặn tìm kiếm từ người lạ
    if (!user || user.userInfo?.blockStrangers) {
      // Tạo thông báo lỗi dựa trên loại tìm kiếm (email hoặc số điện thoại)
      if (email) {
        throw new NotFoundException(
          'Email chưa đăng ký tài khoản hoặc không cho phép tìm kiếm',
        );
      } else {
        throw new NotFoundException(
          'Số điện thoại chưa đăng ký tài khoản hoặc không cho phép tìm kiếm',
        );
      }
    }

    // Trả về thông tin người dùng
    return {
      id: user.id,
      email: user.email,
      phoneNumber: user.phoneNumber,
      userInfo: {
        fullName: user.userInfo?.fullName,
        profilePictureUrl: user.userInfo?.profilePictureUrl,
        coverImgUrl: user.userInfo?.coverImgUrl,
        bio: user.userInfo?.bio,
      },
    };
  }
}
