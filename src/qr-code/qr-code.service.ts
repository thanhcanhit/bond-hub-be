import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { QrCodeGateway } from './qr-code.gateway';
import { QrCodeStatus, FriendStatus } from '@prisma/client';
import { AuthService } from '../auth/auth.service';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class QrCodeService {
  constructor(
    private prisma: PrismaService,
    private qrCodeGateway: QrCodeGateway,
    private authService: AuthService,
  ) {}

  async generateQrCode() {
    const qrToken = Math.random().toString(36).substring(2, 15);
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

    const qrCode = await this.prisma.qrCode.create({
      data: {
        qrToken,
        status: QrCodeStatus.PENDING,
        expiresAt,
      },
    });

    return { qrToken: qrCode.qrToken, expires_in: 300 };
  }

  async getQrStatus(qrToken: string) {
    const qrCode = await this.findAndValidateQrCode(qrToken);
    return { status: qrCode.status };
  }

  async scanQrCode(qrToken: string, userId: string) {
    // Validate the QR token exists and is valid
    const qrCode = await this.findAndValidateQrCode(qrToken);

    if (qrCode.status !== QrCodeStatus.PENDING) {
      throw new BadRequestException('QR Code has already been used');
    }

    console.log('User id', userId);
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { userInfo: true },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Make sure we're using the qrToken from the validated qrCode object
    console.log(
      'Updating QR code status to SCANNED for token:',
      qrCode.qrToken,
    );
    try {
      const updatedQrCode = await this.prisma.qrCode.update({
        where: { id: qrCode.id },
        data: { status: QrCodeStatus.SCANNED, userId },
      });
      console.log('QR code updated successfully:', updatedQrCode);
    } catch (error) {
      console.error('Error updating QR code status:', error);
      throw new Error(`Failed to update QR code status: ${error.message}`);
    }

    console.log('SCANNED: User info', user.userInfo);

    const userData = {
      id: user.id,
      email: user.email,
      phoneNumber: user.phoneNumber,
      fullName: user.userInfo?.fullName,
      profilePictureUrl: user.userInfo?.profilePictureUrl,
    };

    this.qrCodeGateway.sendQrStatus(
      qrCode.qrToken,
      QrCodeStatus.SCANNED,
      userData,
    );

    return {
      status: QrCodeStatus.SCANNED,
      user: userData,
    };
  }

  async confirmQrCode(qrToken: string, userId: string) {
    const qrCode = await this.findAndValidateQrCode(qrToken);

    if (qrCode.status !== QrCodeStatus.SCANNED) {
      throw new BadRequestException('QR Code has not been scanned');
    }

    if (qrCode.userId !== userId) {
      throw new BadRequestException('Unauthorized to confirm this QR Code');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { userInfo: true },
    });

    const { accessToken, refreshToken } = await this.authService.generateTokens(
      user.id,
      {
        deviceType: 'WEB',
        deviceName: 'QR Code Login',
      },
    );

    const deviceInfo = {
      id: uuidv4(),
      name: 'QR Code Login',
      type: 'WEB',
    };

    console.log(
      'Updating QR code status to CONFIRMED for token:',
      qrCode.qrToken,
    );
    try {
      const updatedQrCode = await this.prisma.qrCode.update({
        where: { id: qrCode.id },
        data: { status: QrCodeStatus.CONFIRMED },
      });
      console.log('QR code updated successfully to CONFIRMED:', updatedQrCode);
    } catch (error) {
      console.error('Error updating QR code status to CONFIRMED:', error);
      throw new Error(
        `Failed to update QR code status to CONFIRMED: ${error.message}`,
      );
    }

    const loginData = {
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        phoneNumber: user.phoneNumber,
        fullName: user.userInfo?.fullName,
        profilePictureUrl: user.userInfo?.profilePictureUrl,
      },
      device: deviceInfo,
    };

    this.qrCodeGateway.sendQrStatus(
      qrCode.qrToken,
      QrCodeStatus.CONFIRMED,
      undefined,
      loginData,
    );

    await this.deleteQrCode(qrCode.qrToken);
    return { status: QrCodeStatus.CONFIRMED };
  }

  async cancelQrCode(qrToken: string) {
    const qrCode = await this.findAndValidateQrCode(qrToken);

    console.log(
      'Updating QR code status to CANCELLED for token:',
      qrCode.qrToken,
    );
    try {
      const updatedQrCode = await this.prisma.qrCode.update({
        where: { id: qrCode.id },
        data: { status: QrCodeStatus.CANCELLED },
      });
      console.log('QR code updated successfully to CANCELLED:', updatedQrCode);
    } catch (error) {
      console.error('Error updating QR code status to CANCELLED:', error);
      throw new Error(
        `Failed to update QR code status to CANCELLED: ${error.message}`,
      );
    }

    this.qrCodeGateway.sendQrStatus(qrCode.qrToken, QrCodeStatus.CANCELLED);
    await this.deleteQrCode(qrCode.qrToken);

    return { status: QrCodeStatus.CANCELLED };
  }

  private async findAndValidateQrCode(qrToken: string) {
    console.log('Searching for QR token:', qrToken); // Debug log

    // Check if qrToken is undefined or empty
    if (!qrToken) {
      throw new BadRequestException('QR token is required');
    }

    try {
      // Use findFirst instead of findUnique to avoid Prisma validation errors
      const qrCode = await this.prisma.qrCode.findFirst({
        where: {
          qrToken: qrToken,
        },
      });

      console.log('Found QR code:', qrCode); // Debug log

      if (!qrCode) {
        throw new NotFoundException('QR Code not found');
      }

      // Kiểm tra thời hạn QR code, trừ QR code kết bạn
      if (
        new Date() > qrCode.expiresAt &&
        qrCode.status !== QrCodeStatus.FRIEND_REQUEST
      ) {
        throw new BadRequestException('QR Code has expired');
      }

      return qrCode;
    } catch (error) {
      console.error('Error finding QR code:', error);
      if (
        error instanceof NotFoundException ||
        error instanceof BadRequestException
      ) {
        throw error; // Re-throw application exceptions
      }
      throw new NotFoundException(`QR Code not found: ${error.message}`);
    }
  }

  private async deleteQrCode(qrToken: string) {
    console.log('Attempting to delete QR code with token:', qrToken);

    if (!qrToken) {
      console.warn('Attempted to delete QR code with undefined token');
      return;
    }

    try {
      // First find the QR code
      const qrCode = await this.prisma.qrCode.findFirst({
        where: { qrToken },
      });

      if (!qrCode) {
        console.warn(`QR code with token ${qrToken} not found for deletion`);
        return;
      }

      // Then delete it by ID which is the primary key
      const deletedQrCode = await this.prisma.qrCode.delete({
        where: { id: qrCode.id },
      });
      console.log('Successfully deleted QR code:', deletedQrCode);
    } catch (error) {
      console.error('Error deleting QR code:', error);
      // Don't throw the error as this is a cleanup operation
    }
  }

  // Tạo QR code kết bạn
  async generateFriendQrCode(userId: string) {
    // Kiểm tra người dùng có tồn tại không
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { userInfo: true },
    });

    if (!user) {
      throw new NotFoundException('Người dùng không tồn tại');
    }

    // Tạo QR token
    const qrToken = `friend-${Math.random().toString(36).substring(2, 15)}`;
    // QR code kết bạn không có thời hạn, nhưng để tương thích với hệ thống hiện tại,
    // đặt thời hạn rất dài (10 năm)
    const expiresAt = new Date(Date.now() + 10 * 365 * 24 * 60 * 60 * 1000);

    // Tạo QR code
    const qrCode = await this.prisma.qrCode.create({
      data: {
        qrToken,
        userId,
        status: QrCodeStatus.FRIEND_REQUEST,
        expiresAt,
      },
    });

    return {
      qrToken: qrCode.qrToken,
      userId: user.id,
      userInfo: {
        fullName: user.userInfo?.fullName,
        profilePictureUrl: user.userInfo?.profilePictureUrl,
      },
    };
  }

  // Quét QR code kết bạn
  async scanFriendQrCode(qrToken: string, scannerUserId: string) {
    // Kiểm tra QR code có tồn tại và hợp lệ không
    const qrCode = await this.findAndValidateQrCode(qrToken);

    // Kiểm tra QR code có phải là QR code kết bạn không
    if (qrCode.status !== QrCodeStatus.FRIEND_REQUEST) {
      throw new BadRequestException('QR code không phải là QR code kết bạn');
    }

    // Kiểm tra người quét có phải là chủ QR code không
    if (qrCode.userId === scannerUserId) {
      throw new BadRequestException('Không thể quét QR code của chính mình');
    }

    // Lấy thông tin người dùng sở hữu QR code
    const qrOwner = await this.prisma.user.findUnique({
      where: { id: qrCode.userId },
      include: { userInfo: true },
    });

    if (!qrOwner) {
      throw new NotFoundException('Không tìm thấy người dùng sở hữu QR code');
    }

    // Kiểm tra xem người dùng có chặn tìm kiếm từ người lạ không
    if (qrOwner.userInfo?.blockStrangers) {
      throw new ForbiddenException('Người dùng đã chặn tìm kiếm từ người lạ');
    }

    // Trả về thông tin người dùng sở hữu QR code
    return {
      qrOwnerId: qrOwner.id,
      email: qrOwner.email,
      phoneNumber: qrOwner.phoneNumber,
      userInfo: {
        fullName: qrOwner.userInfo?.fullName,
        profilePictureUrl: qrOwner.userInfo?.profilePictureUrl,
        backgroundImgUrl: qrOwner.userInfo?.coverImgUrl,
        bio: qrOwner.userInfo?.bio,
      },
    };
  }

  // Gửi lời mời kết bạn qua QR code
  async sendFriendRequestViaQr(qrToken: string, senderId: string) {
    // Kiểm tra QR code có tồn tại và hợp lệ không
    const qrCode = await this.findAndValidateQrCode(qrToken);

    // Kiểm tra QR code có phải là QR code kết bạn không
    if (qrCode.status !== QrCodeStatus.FRIEND_REQUEST) {
      throw new BadRequestException('QR code không phải là QR code kết bạn');
    }

    // Kiểm tra người gửi có phải là chủ QR code không
    if (qrCode.userId === senderId) {
      throw new BadRequestException(
        'Không thể gửi lời mời kết bạn cho chính mình',
      );
    }

    // Kiểm tra người dùng có tồn tại không
    const [sender, receiver] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: senderId },
        include: { userInfo: true },
      }),
      this.prisma.user.findUnique({
        where: { id: qrCode.userId },
        include: { userInfo: true },
      }),
    ]);

    if (!sender || !receiver) {
      throw new NotFoundException('Người dùng không tồn tại');
    }

    // Kiểm tra xem đã có mối quan hệ bạn bè nào giữa hai người dùng chưa
    const existingFriendship = await this.prisma.friend.findFirst({
      where: {
        OR: [
          {
            senderId,
            receiverId: qrCode.userId,
          },
          {
            senderId: qrCode.userId,
            receiverId: senderId,
          },
        ],
      },
    });

    // Nếu đã có mối quan hệ bạn bè
    if (existingFriendship) {
      // Nếu đã là bạn bè
      if (existingFriendship.status === FriendStatus.ACCEPTED) {
        throw new BadRequestException('Hai người dùng đã là bạn bè');
      }

      // Nếu đã bị block
      if (existingFriendship.status === FriendStatus.BLOCKED) {
        throw new ForbiddenException('Không thể gửi lời mời kết bạn');
      }

      // Nếu đã bị từ chối, kiểm tra thời gian
      if (existingFriendship.status === FriendStatus.DECLINED) {
        const declinedTime = existingFriendship.updatedAt;
        const currentTime = new Date();
        const hoursDifference =
          (currentTime.getTime() - declinedTime.getTime()) / (1000 * 60 * 60);

        // Nếu chưa đủ 48 giờ
        if (hoursDifference < 48) {
          throw new ForbiddenException(
            `Bạn có thể gửi lại lời mời kết bạn sau ${Math.ceil(
              48 - hoursDifference,
            )} giờ nữa`,
          );
        }

        // Nếu đã đủ 48 giờ, cập nhật lại trạng thái
        const updatedFriendship = await this.prisma.friend.update({
          where: { id: existingFriendship.id },
          data: {
            status: FriendStatus.PENDING,
            updatedAt: new Date(),
          },
          include: {
            sender: {
              select: {
                id: true,
                email: true,
                phoneNumber: true,
                userInfo: {
                  select: {
                    fullName: true,
                    profilePictureUrl: true,
                  },
                },
              },
            },
            receiver: {
              select: {
                id: true,
                email: true,
                phoneNumber: true,
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

        // Cập nhật trạng thái QR code
        await this.prisma.qrCode.update({
          where: { id: qrCode.id },
          data: { status: QrCodeStatus.FRIEND_CONFIRMED },
        });

        return updatedFriendship;
      }

      // Nếu đang chờ xác nhận
      if (existingFriendship.status === FriendStatus.PENDING) {
        // Nếu người gửi hiện tại là người nhận trước đó, tự động chấp nhận
        if (existingFriendship.receiverId === senderId) {
          const acceptedFriendship = await this.prisma.friend.update({
            where: { id: existingFriendship.id },
            data: {
              status: FriendStatus.ACCEPTED,
              updatedAt: new Date(),
            },
            include: {
              sender: {
                select: {
                  id: true,
                  email: true,
                  phoneNumber: true,
                  userInfo: {
                    select: {
                      fullName: true,
                      profilePictureUrl: true,
                    },
                  },
                },
              },
              receiver: {
                select: {
                  id: true,
                  email: true,
                  phoneNumber: true,
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

          // Cập nhật trạng thái QR code
          await this.prisma.qrCode.update({
            where: { id: qrCode.id },
            data: { status: QrCodeStatus.FRIEND_CONFIRMED },
          });

          return acceptedFriendship;
        } else {
          throw new BadRequestException(
            'Lời mời kết bạn đã được gửi và đang chờ xác nhận',
          );
        }
      }
    }

    // Tạo mới lời mời kết bạn
    const newFriendship = await this.prisma.friend.create({
      data: {
        senderId,
        receiverId: qrCode.userId,
        status: FriendStatus.PENDING,
      },
      include: {
        sender: {
          select: {
            id: true,
            email: true,
            phoneNumber: true,
            userInfo: {
              select: {
                fullName: true,
                profilePictureUrl: true,
              },
            },
          },
        },
        receiver: {
          select: {
            id: true,
            email: true,
            phoneNumber: true,
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

    return newFriendship;
  }
}
