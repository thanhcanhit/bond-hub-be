import {
  PrismaClient,
  Gender,
  FriendStatus,
  GroupRole,
  MessageType,
  ReactionType,
  DeviceType,
} from '@prisma/client';
import { hash } from 'bcrypt';

const prisma = new PrismaClient();

// Hàm tạo ngày hết hạn sau một số ngày
function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

// Hàm tạo ngày hết hạn sau một số giờ
function addHours(date: Date, hours: number): Date {
  const result = new Date(date);
  result.setTime(result.getTime() + hours * 60 * 60 * 1000);
  return result;
}

async function main() {
  // Tạo mật khẩu mặc định
  const passwordHash = await hash('sapassword', 10);

  // Tạo người dùng
  const users = await createUsers(passwordHash);

  // Tạo mối quan hệ bạn bè
  await createFriendships(users);

  // Tạo bài đăng và phản ứng
  await createPostsAndReactions(users);

  // Tạo nhóm và thành viên
  await createGroupsAndMembers(users);

  // Tạo tin nhắn
  await createMessages(users);

  // Tạo thông báo
  await createNotifications(users);

  // Tạo cloud storage
  await createCloudStorage(users);

  // Tạo stories
  await createStories(users);

  // Tạo cài đặt người dùng
  await createUserSettings(users);

  console.log('Seed data đã được tạo thành công!');
}

async function createUsers(passwordHash: string) {
  // Xóa dữ liệu hiện có để tránh lỗi unique constraint
  await prisma.refreshToken.deleteMany({});
  await prisma.userInfo.deleteMany({});
  await prisma.user.deleteMany({});

  const userData = [
    {
      email: 'tuan.nguyen@example.com',
      phoneNumber: '0901234567',
      fullName: 'Nguyễn Minh Tuấn',
      dateOfBirth: new Date('1990-05-15'),
      gender: Gender.MALE,
      bio: 'Senior Developer tại MindX Technology. Đam mê công nghệ và luôn tìm tòi những giải pháp mới. Ngoài lập trình, tôi thích khám phá ẩm thực và đi phượt vào cuối tuần. Người ta nói tôi hơi "lầy" nhưng thực ra tôi chỉ thích vui vẻ thôi!',
      profilePictureUrl: 'https://example.com/avatars/tuan_nguyen.jpg',
      statusMessage: 'Code today, coffee tomorrow, bugs forever! 💻☕',
    },
    {
      email: 'linh.tran@example.com',
      phoneNumber: '0912345678',
      fullName: 'Trần Thùy Linh',
      dateOfBirth: new Date('1992-08-25'),
      gender: Gender.FEMALE,
      bio: 'Digital Marketing Manager với 6 năm kinh nghiệm. Mê mẩn âm nhạc indie và thích sưu tầm vinyl. Có một tài khoản Instagram riêng để chụp ảnh đồ ăn vì tin rằng "ăn ngon mới sống khỏe". Đang học thêm nhiếp ảnh để nâng tầm visual.',
      profilePictureUrl: 'https://example.com/avatars/linh_tran.jpg',
      statusMessage: 'Sống như cà phê - đắng nhưng làm người ta tỉnh táo 🌿',
    },
    {
      email: 'hung.pham@example.com',
      phoneNumber: '0923456789',
      fullName: 'Phạm Việt Hưng',
      dateOfBirth: new Date('1988-12-10'),
      gender: Gender.MALE,
      bio: 'Tech Lead tại Rikkeisoft Hà Nội. Mê cờ vua từ nhỏ và có hẳn một bộ sưu tập 15 bộ cờ từ các nước. Dành thời gian cuối tuần để dạy lập trình cho trẻ em có hoàn cảnh khó khăn. Thích nghe podcast về khởi nghiệp và đọc sách về tâm lý học.',
      profilePictureUrl: 'https://example.com/avatars/hung_pham.jpg',
      statusMessage: 'Vươn cao, vượt xa và luôn mỉm cười! 🚀',
    },
    {
      email: 'mai.nguyen@example.com',
      phoneNumber: '0934567890',
      fullName: 'Nguyễn Thanh Mai',
      dateOfBirth: new Date('1995-03-20'),
      gender: Gender.FEMALE,
      bio: 'Giáo viên tiếng Anh tại VUS. Mê phim điện ảnh Hàn Quốc và có thể kể vanh vách về từng chi tiết trong phim Parasite. Thích nấu ăn và đang viết một cuốn sách dạy nấu món Việt cho người nước ngoài. Đang học thêm tiếng Tây Ban Nha.',
      profilePictureUrl: 'https://example.com/avatars/mai_nguyen.jpg',
      statusMessage:
        'Dạy học là nghệ thuật truyền cảm hứng, không phải truyền kiến thức ✨',
    },
    {
      email: 'minh.hoang@example.com',
      phoneNumber: '0945678901',
      fullName: 'Hoàng Đức Minh',
      dateOfBirth: new Date('1993-07-05'),
      gender: Gender.MALE,
      bio: 'Nhiếp ảnh gia tự do với niềm đam mê chụp ảnh phong cảnh Việt Nam. Từng đi qua 63 tỉnh thành và có bộ sưu tập ảnh "Việt Nam từ trên cao". Thích cà phê đen không đường và có thể uống 5 ly một ngày. Mơ ước mở gallery ảnh riêng vào năm 30 tuổi.',
      profilePictureUrl: 'https://example.com/avatars/minh_hoang.jpg',
      statusMessage: 'Sống để chụp, chụp để sống 📸',
    },
  ];

  const createdUsers = [];

  for (const user of userData) {
    const createdUser = await prisma.user.create({
      data: {
        email: user.email,
        phoneNumber: user.phoneNumber,
        passwordHash,
        userInfo: {
          create: {
            fullName: user.fullName,
            dateOfBirth: user.dateOfBirth,
            gender: user.gender,
            bio: user.bio,
            profilePictureUrl: user.profilePictureUrl,
            statusMessage: user.statusMessage,
            lastSeen: new Date(),
          },
        },
        refreshTokens: {
          create: {
            token: `token-${user.email.split('@')[0]}`,
            expiresAt: addDays(new Date(), 30),
            deviceType: DeviceType.DESKTOP,
            ipAddress: '127.0.0.1',
            userAgent:
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          },
        },
      },
    });

    createdUsers.push(createdUser);
  }

  return createdUsers;
}

async function createFriendships(users: any[]) {
  await prisma.friend.deleteMany({});

  // Các tình huống bạn bè khác nhau
  const friendships = [
    {
      userOneId: users[0].id,
      userTwoId: users[1].id,
      status: FriendStatus.ACCEPTED,
    },
    {
      userOneId: users[0].id,
      userTwoId: users[2].id,
      status: FriendStatus.PENDING,
    },
    {
      userOneId: users[1].id,
      userTwoId: users[3].id,
      status: FriendStatus.ACCEPTED,
    },
    {
      userOneId: users[2].id,
      userTwoId: users[4].id,
      status: FriendStatus.ACCEPTED,
    },
    {
      userOneId: users[3].id,
      userTwoId: users[0].id,
      status: FriendStatus.PENDING,
    },
    {
      userOneId: users[4].id,
      userTwoId: users[1].id,
      status: FriendStatus.BLOCKED,
    },
  ];

  for (const friendship of friendships) {
    await prisma.friend.create({
      data: friendship,
    });
  }
}

async function createPostsAndReactions(users: any[]) {
  await prisma.comment.deleteMany({});
  await prisma.postReaction.deleteMany({});
  await prisma.hiddenPost.deleteMany({});
  await prisma.post.deleteMany({});

  const posts = [
    {
      userId: users[0].id,
      content:
        'Vừa tham gia hackathon tại Landmark 81 - vừa mệt vừa high! 48 giờ không ngủ và team mình đã đạt giải nhì với sản phẩm AI phát hiện rác thải nhựa. Đêm nay nhất định phải ngủ bù 😴 #hackathon #techlife #landmark81',
      media: {
        images: [
          'https://example.com/images/hackathon_1.jpg',
          'https://example.com/images/hackathon_2.jpg',
        ],
      },
      privacyLevel: 'public',
    },
    {
      userId: users[1].id,
      content:
        'Hội An về đêm đẹp như một giấc mơ! Vừa thử đi ăn ở quán "Mậu Dịch Quán" - thực sự là ngon xuất sắc mà giá cả phải chăng. Ai đến Hội An nhớ ghé thử nhé, đặc biệt là món cơm gà và cao lầu siêu authentic! 🏮🍜 #hoian #foodie #vietnamtravel',
      media: { images: ['https://example.com/images/hoian_night.jpg'] },
      privacyLevel: 'friends',
    },
    {
      userId: users[2].id,
      content:
        'Đang tìm người cùng tham gia dự án mã nguồn mở xây dựng hệ thống quản lý cho các quán cafe nhỏ tại Việt Nam. Stack: Node.js, React Native, PostgreSQL. Mình cần 2 frontend dev và 1 designer. Ai quan tâm comment hoặc inbox mình nhé! 💻👨‍💻👩‍💻 #opensource #reactnative #vietnamdev',
      privacyLevel: 'public',
    },
    {
      userId: users[3].id,
      content:
        'Vừa hoàn thành khóa IELTS 8.0 và đạt đúng mục tiêu! Cảm ơn thầy Đặng Trần Tùng đã hướng dẫn tận tình suốt 6 tháng qua. Cho mình xin 1 like để ăn mừng và nếu ai cần tư vấn học IELTS, mình sẵn sàng chia sẻ kinh nghiệm nha! 🎓🎉 #ielts #englishlearning #8band',
      privacyLevel: 'public',
    },
    {
      userId: users[4].id,
      content:
        'Chuyến phượt Hà Giang 3 ngày 2 đêm vừa rồi để lại quá nhiều kỷ niệm. Đèo Mã Pí Lèng đẹp ngỡ ngàng, homestay ở Đồng Văn cực chill và đồ ăn thì ngon xuất sắc (nhớ nhất là thắng cố và rượu ngô 😝). Share một vài tấm ảnh để mọi người ngắm và cảm nhận vẻ đẹp của miền Bắc Việt Nam mình. Ai chưa đi Hà Giang thì nên đi 1 lần trong đời! 🏍️🌄 #hagiang #vietnamtravel #mapilengsummit',
      media: {
        images: [
          'https://example.com/images/hagiang_1.jpg',
          'https://example.com/images/hagiang_2.jpg',
          'https://example.com/images/hagiang_3.jpg',
        ],
      },
      privacyLevel: 'public',
    },
  ];

  for (const post of posts) {
    const createdPost = await prisma.post.create({
      data: post,
    });

    // Tạo phản ứng cho bài đăng
    const reactions = [
      {
        postId: createdPost.id,
        userId: users[Math.floor(Math.random() * users.length)].id,
        reactionType: ReactionType.LIKE,
        reactedAt: new Date(),
      },
      {
        postId: createdPost.id,
        userId: users[Math.floor(Math.random() * users.length)].id,
        reactionType: ReactionType.LOVE,
        reactedAt: new Date(),
      },
    ];

    for (const reaction of reactions) {
      await prisma.postReaction.create({
        data: reaction,
      });
    }

    // Tạo bình luận cho bài đăng
    const commentsData = [
      [
        {
          postId: createdPost.id,
          userId: users[1].id,
          content:
            'Chúc mừng team bạn! Giải pháp AI phát hiện rác thải nhựa nghe rất ý nghĩa. Có demo link không bạn?',
          reactions: [
            { type: 'LIKE', userId: users[0].id },
            { type: 'LIKE', userId: users[2].id },
          ],
        },
        {
          postId: createdPost.id,
          userId: users[0].id,
          content:
            'Cảm ơn bạn! Mình sẽ share demo link sau khi team polish sản phẩm thêm chút nữa nhé.',
          reactions: [],
        },
      ],
      [
        {
          postId: createdPost.id,
          userId: users[2].id,
          content:
            'Hội An là một trong những nơi mình yêu thích nhất ở Việt Nam! Lần sau nhớ thử qua "Bánh Mì Phượng" nhé, ngon xuất sắc luôn đó.',
          reactions: [{ type: 'LOVE', userId: users[1].id }],
        },
        {
          postId: createdPost.id,
          userId: users[3].id,
          content: 'Ảnh đẹp quá! Cho mình xin tên máy ảnh với.',
          reactions: [],
        },
      ],
    ];

    // Chọn ngẫu nhiên một cặp bình luận từ mảng commentsData
    const selectedComments =
      commentsData[Math.floor(Math.random() * commentsData.length)];

    for (const comment of selectedComments) {
      await prisma.comment.create({
        data: {
          postId: comment.postId,
          userId: comment.userId,
          content: comment.content,
          reactions: comment.reactions,
        },
      });
    }
  }

  // Tạo ẩn bài đăng
  await prisma.hiddenPost.create({
    data: {
      userId: users[1].id,
      postId: (await prisma.post.findFirst({ where: { userId: users[0].id } }))!
        .id,
    },
  });
}

async function createGroupsAndMembers(users: any[]) {
  await prisma.message.deleteMany({ where: { groupId: { not: null } } });
  await prisma.groupMember.deleteMany({});
  await prisma.group.deleteMany({});

  const groups = [
    {
      name: 'Cộng Đồng IT Việt Nam',
      creatorId: users[0].id,
      avatarUrl: 'https://example.com/groups/it_vietnam.jpg',
    },
    {
      name: 'Phượt Thủ Sài Gòn',
      creatorId: users[1].id,
      avatarUrl: 'https://example.com/groups/saigon_travellers.jpg',
    },
    {
      name: 'CLB Sách & Cà Phê Hà Nội',
      creatorId: users[3].id,
      avatarUrl: 'https://example.com/groups/hanoi_books_coffee.jpg',
    },
  ];

  for (const group of groups) {
    const createdGroup = await prisma.group.create({
      data: group,
    });

    // Thêm creator là leader
    await prisma.groupMember.create({
      data: {
        groupId: createdGroup.id,
        userId: group.creatorId,
        role: GroupRole.LEADER,
        addedById: group.creatorId,
      },
    });

    // Thêm các thành viên khác
    for (const user of users) {
      if (user.id !== group.creatorId) {
        const role =
          Math.random() > 0.8 ? GroupRole.CO_LEADER : GroupRole.MEMBER;

        await prisma.groupMember.create({
          data: {
            groupId: createdGroup.id,
            userId: user.id,
            role,
            addedById: group.creatorId,
          },
        });
      }
    }
  }
}

async function createMessages(users: any[]) {
  await prisma.message.deleteMany({ where: { groupId: null } });

  // Tin nhắn giữa người dùng
  const directMessages = [
    {
      senderId: users[0].id,
      receiverId: users[1].id,
      content: {
        text: 'Ê Linh, cuối tuần này đi cafe ở Tổng Đản không? Mới mở quán mới, nghe nói view đẹp lắm!',
      },
      messageType: MessageType.USER,
      readBy: [users[0].id],
      recalled: false,
      deletedBy: [],
      reactions: [],
    },
    {
      senderId: users[1].id,
      receiverId: users[0].id,
      content: {
        text: 'OK anh! Mình rảnh chiều thứ 7. Để mình rủ thêm Mai đi cùng nhé?',
      },
      messageType: MessageType.USER,
      readBy: [users[0].id, users[1].id],
      recalled: false,
      deletedBy: [],
      reactions: [],
    },
    {
      senderId: users[0].id,
      receiverId: users[1].id,
      content: { text: 'Có ai đi cùng càng vui. 2h chiều thứ 7 nhé!' },
      messageType: MessageType.USER,
      readBy: [users[0].id],
      recalled: false,
      deletedBy: [],
      reactions: [],
    },
    {
      senderId: users[2].id,
      receiverId: users[3].id,
      content: {
        text: 'Chị Mai ơi, em có thể xin tài liệu luyện speaking IELTS không ạ? Em đang chuẩn bị thi tháng sau.',
      },
      messageType: MessageType.USER,
      readBy: [users[2].id, users[3].id],
      recalled: false,
      deletedBy: [],
      reactions: [],
    },
    {
      senderId: users[3].id,
      receiverId: users[2].id,
      content: {
        text: 'Có em nè. Chị gửi em bộ tài liệu mới nhất chị vừa cập nhật. Nhớ tập trung vào phần Task 2 nhé, chọn đề về môi trường và công nghệ mà luyện sẽ dễ điểm cao.',
        link: 'https://example.com/ielts-speaking-materials.pdf',
      },
      messageType: MessageType.USER,
      readBy: [users[2].id, users[3].id],
      recalled: false,
      deletedBy: [],
      reactions: [],
    },
  ];

  for (const message of directMessages) {
    await prisma.message.create({
      data: message,
    });
  }

  // Tin nhắn trong nhóm
  const groups = await prisma.group.findMany();

  for (const group of groups) {
    const members = await prisma.groupMember.findMany({
      where: { groupId: group.id },
      select: { userId: true },
    });

    const groupMessagesData = {
      'Cộng Đồng IT Việt Nam': [
        {
          senderId: members[0].userId,
          groupId: group.id,
          content: {
            text: `Xin chào tất cả thành viên của ${group.name}! Rất vui khi thấy cộng đồng ngày càng phát triển. Mình đang tổ chức một workshop về "Microservices với Kubernetes" vào tháng tới, ai quan tâm để lại comment nhé!`,
          },
          messageType: MessageType.GROUP,
          readBy: members.map((m) => m.userId),
          recalled: false,
          deletedBy: [],
          reactions: [],
        },
        {
          senderId: members[1].userId,
          groupId: group.id,
          content: {
            text: 'Em đăng ký tham gia ạ! Em đang tìm hiểu về Kubernetes và mong muốn được học hỏi thêm.',
          },
          messageType: MessageType.GROUP,
          readBy: [members[0].userId, members[1].userId],
          recalled: false,
          deletedBy: [],
          reactions: [],
        },
        {
          senderId: members[0].userId,
          groupId: group.id,
          content: {
            text: 'Tuyệt vời! Mình sẽ gửi form đăng ký chính thức vào tuần tới. Workshop sẽ có hands-on lab nên mọi người nhớ mang laptop nhé!',
          },
          messageType: MessageType.GROUP,
          readBy: members.slice(0, 3).map((m) => m.userId),
          recalled: false,
          deletedBy: [],
          reactions: [],
        },
      ],
      'Phượt Thủ Sài Gòn': [
        {
          senderId: members[0].userId,
          groupId: group.id,
          content: {
            text: `Hello cả nhà ${group.name}! Mình đang lên kế hoạch phượt Đà Lạt đầu tháng sau, lịch trình 3 ngày 2 đêm. Ai muốn tham gia không?`,
          },
          messageType: MessageType.GROUP,
          readBy: members.map((m) => m.userId),
          recalled: false,
          deletedBy: [],
          reactions: [],
        },
        {
          senderId: members[1].userId,
          groupId: group.id,
          content: {
            text: 'Mình quan tâm nè! Chi phí dự kiến bao nhiêu vậy bạn?',
          },
          messageType: MessageType.GROUP,
          readBy: [members[0].userId, members[1].userId],
          recalled: false,
          deletedBy: [],
          reactions: [],
        },
        {
          senderId: members[0].userId,
          groupId: group.id,
          content: {
            text: 'Dự kiến khoảng 2tr5/người bao gồm xe máy, xăng, homestay và ăn uống. Mình sẽ đặt homestay ở gần hồ Tuyền Lâm. Ai đăng ký thì chuyển khoản đặt cọc 500k nhé!',
          },
          messageType: MessageType.GROUP,
          readBy: members.slice(0, 3).map((m) => m.userId),
          recalled: false,
          deletedBy: [],
          reactions: [],
        },
      ],
      'CLB Sách & Cà Phê Hà Nội': [
        {
          senderId: members[0].userId,
          groupId: group.id,
          content: {
            text: `Chào các thành viên ${group.name}! Tuần này chúng ta sẽ thảo luận về cuốn "Sapiens: Lược sử loài người" của Yuval Noah Harari. Buổi offline sẽ diễn ra vào 7h tối thứ 6 tại Tranquil Books & Coffee số 5 Nguyễn Quang Bích.`,
          },
          messageType: MessageType.GROUP,
          readBy: members.map((m) => m.userId),
          recalled: false,
          deletedBy: [],
          reactions: [],
        },
        {
          senderId: members[1].userId,
          groupId: group.id,
          content: {
            text: 'Mình đã đọc xong cuốn này rồi. Thực sự là một cuốn sách tuyệt vời về lịch sử loài người! Mình sẽ tham gia buổi thảo luận.',
          },
          messageType: MessageType.GROUP,
          readBy: [members[0].userId, members[1].userId],
          recalled: false,
          deletedBy: [],
          reactions: [],
        },
        {
          senderId: members[0].userId,
          groupId: group.id,
          content: {
            text: 'Tuyệt vời! Ai chưa đọc xong có thể đọc đến hết chương 6 là đủ cho buổi thảo luận này nhé. Nhà hàng có menu đồ ăn nhẹ và đồ uống, mọi người có thể gọi tùy ý.',
          },
          messageType: MessageType.GROUP,
          readBy: members.slice(0, 3).map((m) => m.userId),
          recalled: false,
          deletedBy: [],
          reactions: [],
        },
      ],
    };

    // Lấy tin nhắn phù hợp với tên nhóm
    const groupMessages =
      groupMessagesData[group.name as keyof typeof groupMessagesData] ||
      groupMessagesData['Cộng Đồng IT Việt Nam'];

    for (const message of groupMessages) {
      await prisma.message.create({
        data: message,
      });
    }
  }
}

async function createNotifications(users: any[]) {
  await prisma.notification.deleteMany({});

  const notifications = [
    {
      userId: users[0].id,
      type: 'FRIEND_REQUEST',
      content: {
        message: 'Nguyễn Thanh Mai đã gửi lời mời kết bạn cho bạn',
        user: { id: users[3].id, name: 'Nguyễn Thanh Mai' },
      },
      reference: {
        type: 'FRIEND',
        id: (
          await prisma.friend.findFirst({
            where: { userOneId: users[3].id, userTwoId: users[0].id },
          })
        )?.id,
      },
      read: false,
      createdAt: new Date(),
    },
    {
      userId: users[1].id,
      type: 'POST_REACTION',
      content: {
        message:
          'Nguyễn Minh Tuấn đã thích bài viết của bạn về "Hội An về đêm"',
        user: { id: users[0].id, name: 'Nguyễn Minh Tuấn' },
      },
      reference: {
        type: 'POST',
        id: (
          await prisma.post.findFirst({
            where: { userId: users[1].id },
          })
        )?.id,
      },
      read: true,
      createdAt: new Date(),
    },
    {
      userId: users[2].id,
      type: 'GROUP_INVITE',
      content: {
        message: 'Bạn đã được thêm vào nhóm "Cộng Đồng IT Việt Nam"',
        group: {
          id: (
            await prisma.group.findFirst({
              where: { name: 'Cộng Đồng IT Việt Nam' },
            })
          )?.id,
          name: 'Cộng Đồng IT Việt Nam',
        },
      },
      reference: {
        type: 'GROUP',
        id: (
          await prisma.group.findFirst({
            where: { name: 'Cộng Đồng IT Việt Nam' },
          })
        )?.id,
      },
      read: false,
      createdAt: new Date(),
    },
    {
      userId: users[4].id,
      type: 'COMMENT_ON_POST',
      content: {
        message:
          'Trần Thùy Linh đã bình luận về bài viết của bạn: "Ảnh đẹp quá! Hà Giang đúng là thiên đường của dân phượt."',
        user: { id: users[1].id, name: 'Trần Thùy Linh' },
      },
      reference: {
        type: 'POST',
        id: (
          await prisma.post.findFirst({
            where: { userId: users[4].id },
          })
        )?.id,
      },
      read: false,
      createdAt: new Date(),
    },
    {
      userId: users[3].id,
      type: 'EVENT_REMINDER',
      content: {
        message: 'Sự kiện "Workshop IELTS Speaking" sẽ diễn ra trong 2 giờ nữa',
        event: {
          id: 'event-123',
          name: 'Workshop IELTS Speaking',
          location: 'The Coffee House - 15 Thái Hà, Hà Nội',
        },
      },
      reference: {
        type: 'EVENT',
        id: 'event-123',
      },
      read: true,
      createdAt: new Date(),
    },
  ];

  for (const notification of notifications) {
    await prisma.notification.create({
      data: {
        userId: notification.userId,
        type: notification.type,
        content: notification.content,
        reference: notification.reference,
        read: notification.read !== undefined ? notification.read : false,
        createdAt: notification.createdAt || new Date(),
      },
    });
  }
}

async function createCloudStorage(users: any[]) {
  await prisma.cloudStorage.deleteMany({});

  const files = [
    {
      userId: users[0].id,
      fileName: 'Microservices_Architecture_Overview.pptx',
      fileUrl: 'https://example.com/files/microservices_arch.pptx',
      fileType:
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      fileSize: 3500000,
    },
    {
      userId: users[1].id,
      fileName: 'Hoi_An_Trip_2023.zip',
      fileUrl: 'https://example.com/files/hoian_trip_2023.zip',
      fileType: 'application/zip',
      fileSize: 25000000,
    },
    {
      userId: users[2].id,
      fileName: 'React_Native_Project_Proposal.pdf',
      fileUrl: 'https://example.com/files/react_native_proposal.pdf',
      fileType: 'application/pdf',
      fileSize: 1450000,
    },
    {
      userId: users[3].id,
      fileName: 'IELTS_Speaking_Tips_and_Tricks.docx',
      fileUrl: 'https://example.com/files/ielts_speaking_tips.docx',
      fileType:
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      fileSize: 980000,
    },
    {
      userId: users[4].id,
      fileName: 'Ha_Giang_Photo_Collection.raw',
      fileUrl: 'https://example.com/files/hagiang_photos.raw',
      fileType: 'image/raw',
      fileSize: 45000000,
    },
  ];

  for (const file of files) {
    await prisma.cloudStorage.create({
      data: file,
    });
  }
}

async function createStories(users: any[]) {
  await prisma.story.deleteMany({});

  const stories = [
    {
      userId: users[0].id,
      mediaUrl: 'https://example.com/stories/tuan_hackathon_story.jpg',
      expiresAt: addHours(new Date(), 24),
    },
    {
      userId: users[1].id,
      mediaUrl: 'https://example.com/stories/linh_coffee_review.mp4',
      expiresAt: addHours(new Date(), 24),
    },
    {
      userId: users[3].id,
      mediaUrl: 'https://example.com/stories/mai_teaching_ielts.jpg',
      expiresAt: addHours(new Date(), 24),
    },
    {
      userId: users[4].id,
      mediaUrl: 'https://example.com/stories/minh_sunset_hagiang.mp4',
      expiresAt: addHours(new Date(), 24),
    },
  ];

  for (const story of stories) {
    await prisma.story.create({
      data: story,
    });
  }
}

async function createUserSettings(users: any[]) {
  await prisma.userSetting.deleteMany({});

  const settings = [
    {
      userId: users[0].id,
      notificationEnabled: true,
      darkMode: true,
    },
    {
      userId: users[1].id,
      notificationEnabled: true,
      darkMode: false,
    },
    {
      userId: users[2].id,
      notificationEnabled: false,
      darkMode: true,
    },
    {
      userId: users[3].id,
      notificationEnabled: true,
      darkMode: true,
    },
    {
      userId: users[4].id,
      notificationEnabled: true,
      darkMode: false,
    },
  ];

  for (const setting of settings) {
    await prisma.userSetting.create({
      data: setting,
    });
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
