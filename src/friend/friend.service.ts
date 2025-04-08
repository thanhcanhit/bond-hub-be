import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { FriendStatus, Prisma } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { SendFriendRequestDto } from './dto/send-friend-request.dto';
import { RespondFriendRequestDto } from './dto/respond-friend-request.dto';

@Injectable()
export class FriendService {
  constructor(private prisma: PrismaService) {}

  // Gửi lời mời kết bạn
  async sendFriendRequest(senderId: string, dto: SendFriendRequestDto) {
    const { receiverId, introducedBy } = dto;

    // Kiểm tra người gửi và người nhận có tồn tại không
    const [sender, receiver] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: senderId },
        include: { userInfo: true },
      }),
      this.prisma.user.findUnique({
        where: { id: receiverId },
        include: { userInfo: true },
      }),
    ]);

    if (!sender || !receiver) {
      throw new NotFoundException('Người dùng không tồn tại');
    }

    // Kiểm tra xem người dùng có tự gửi lời mời kết bạn cho chính mình không
    if (senderId === receiverId) {
      throw new BadRequestException(
        'Không thể gửi lời mời kết bạn cho chính mình',
      );
    }

    // Kiểm tra xem đã có mối quan hệ bạn bè nào giữa hai người dùng chưa
    const existingFriendship = await this.prisma.friend.findFirst({
      where: {
        OR: [
          {
            senderId,
            receiverId,
          },
          {
            senderId: receiverId,
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
        return this.prisma.friend.update({
          where: { id: existingFriendship.id },
          data: {
            status: FriendStatus.PENDING,
            updatedAt: new Date(),
            introducedBy: introducedBy || null,
          },
        });
      }

      // Nếu đang chờ xác nhận
      if (existingFriendship.status === FriendStatus.PENDING) {
        // Nếu người gửi hiện tại là người nhận trước đó, tự động chấp nhận
        if (existingFriendship.receiverId === senderId) {
          return this.prisma.friend.update({
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
        } else {
          throw new BadRequestException(
            'Lời mời kết bạn đã được gửi và đang chờ xác nhận',
          );
        }
      }
    }

    // Tạo mới lời mời kết bạn
    return this.prisma.friend.create({
      data: {
        senderId,
        receiverId,
        status: FriendStatus.PENDING,
        introducedBy: introducedBy || null,
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
  }

  // Phản hồi lời mời kết bạn (chấp nhận, từ chối, block)
  async respondToFriendRequest(userId: string, dto: RespondFriendRequestDto) {
    const { requestId, status } = dto;

    // Kiểm tra lời mời kết bạn có tồn tại không
    const friendRequest = await this.prisma.friend.findUnique({
      where: { id: requestId },
    });

    if (!friendRequest) {
      throw new NotFoundException('Lời mời kết bạn không tồn tại');
    }

    // Kiểm tra xem người dùng có phải là người nhận lời mời không
    if (friendRequest.receiverId !== userId) {
      throw new ForbiddenException(
        'Bạn không có quyền phản hồi lời mời kết bạn này',
      );
    }

    // Kiểm tra trạng thái hiện tại của lời mời
    if (friendRequest.status !== FriendStatus.PENDING) {
      throw new BadRequestException('Lời mời kết bạn này đã được phản hồi');
    }

    // Cập nhật trạng thái lời mời
    return this.prisma.friend.update({
      where: { id: requestId },
      data: {
        status,
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
  }

  // Block người dùng
  async blockUser(userId: string, targetId: string) {
    // Kiểm tra người dùng có tồn tại không
    const [user, target] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: userId } }),
      this.prisma.user.findUnique({ where: { id: targetId } }),
    ]);

    if (!user || !target) {
      throw new NotFoundException('Người dùng không tồn tại');
    }

    // Kiểm tra xem người dùng có tự block chính mình không
    if (userId === targetId) {
      throw new BadRequestException('Không thể block chính mình');
    }

    // Kiểm tra xem đã có mối quan hệ bạn bè nào giữa hai người dùng chưa
    const existingFriendship = await this.prisma.friend.findFirst({
      where: {
        OR: [
          {
            senderId: userId,
            receiverId: targetId,
          },
          {
            senderId: targetId,
            receiverId: userId,
          },
        ],
      },
    });

    if (existingFriendship) {
      // Nếu người dùng hiện tại là người gửi
      if (existingFriendship.senderId === userId) {
        return this.prisma.friend.update({
          where: { id: existingFriendship.id },
          data: {
            status: FriendStatus.BLOCKED,
            updatedAt: new Date(),
          },
        });
      } else {
        // Nếu người dùng hiện tại là người nhận, đảo ngược mối quan hệ
        await this.prisma.friend.delete({
          where: { id: existingFriendship.id },
        });
      }
    }

    // Tạo mới mối quan hệ block
    return this.prisma.friend.create({
      data: {
        senderId: userId,
        receiverId: targetId,
        status: FriendStatus.BLOCKED,
      },
    });
  }

  // Lấy danh sách lời mời kết bạn đã nhận
  async getReceivedFriendRequests(userId: string) {
    return this.prisma.friend.findMany({
      where: {
        receiverId: userId,
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
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  // Lấy danh sách lời mời kết bạn đã gửi
  async getSentFriendRequests(userId: string) {
    return this.prisma.friend.findMany({
      where: {
        senderId: userId,
        status: FriendStatus.PENDING,
      },
      include: {
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
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  // Lấy danh sách bạn bè
  async getFriendList(userId: string) {
    const friends = await this.prisma.friend.findMany({
      where: {
        OR: [
          {
            senderId: userId,
            status: FriendStatus.ACCEPTED,
          },
          {
            receiverId: userId,
            status: FriendStatus.ACCEPTED,
          },
        ],
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
                statusMessage: true,
                lastSeen: true,
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
                statusMessage: true,
                lastSeen: true,
              },
            },
          },
        },
      },
      orderBy: {
        updatedAt: 'desc',
      },
    });

    // Chuyển đổi kết quả để trả về thông tin bạn bè (không phải người dùng hiện tại)
    return friends.map((friend) => {
      const isSender = friend.senderId === userId;
      const friendUser = isSender ? friend.receiver : friend.sender;

      return {
        friendshipId: friend.id,
        friend: friendUser,
        since: friend.updatedAt,
      };
    });
  }

  // Lấy danh sách người dùng đã block
  async getBlockedUsers(userId: string) {
    return this.prisma.friend.findMany({
      where: {
        senderId: userId,
        status: FriendStatus.BLOCKED,
      },
      include: {
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
      orderBy: {
        updatedAt: 'desc',
      },
    });
  }

  // Hủy block người dùng
  async unblockUser(userId: string, targetId: string) {
    const blockedRelation = await this.prisma.friend.findFirst({
      where: {
        senderId: userId,
        receiverId: targetId,
        status: FriendStatus.BLOCKED,
      },
    });

    if (!blockedRelation) {
      throw new NotFoundException('Không tìm thấy mối quan hệ block');
    }

    return this.prisma.friend.delete({
      where: { id: blockedRelation.id },
    });
  }

  // Hủy kết bạn
  async unfriend(userId: string, friendId: string) {
    const friendship = await this.prisma.friend.findFirst({
      where: {
        OR: [
          {
            senderId: userId,
            receiverId: friendId,
            status: FriendStatus.ACCEPTED,
          },
          {
            senderId: friendId,
            receiverId: userId,
            status: FriendStatus.ACCEPTED,
          },
        ],
      },
    });

    if (!friendship) {
      throw new NotFoundException('Không tìm thấy mối quan hệ bạn bè');
    }

    return this.prisma.friend.delete({
      where: { id: friendship.id },
    });
  }

  // Hủy lời mời kết bạn đã gửi
  async cancelFriendRequest(userId: string, requestId: string) {
    const friendRequest = await this.prisma.friend.findFirst({
      where: {
        id: requestId,
        senderId: userId,
        status: FriendStatus.PENDING,
      },
    });

    if (!friendRequest) {
      throw new NotFoundException('Không tìm thấy lời mời kết bạn');
    }

    return this.prisma.friend.delete({
      where: { id: requestId },
    });
  }
}
