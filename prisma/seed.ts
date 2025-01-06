import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const users = [
    { name: 'Lê Hoàng Khang', email: 'hoangkhang.dev@gmail.com' },
    { name: 'Trần Đình Kiên', email: 'dinhkien.dev@gmail.com' },
    { name: 'Nguyễn Thanh Cảnh', email: 'thanhcanh.dev@gmail.com' },
    { name: 'Hồ Thị Như Tâm', email: 'nhutam.dev@gmail.com' },
  ];

  for (const user of users) {
    await prisma.user.upsert({
      where: { email: user.email },
      update: {},
      create: { ...user, createdAt: new Date() },
    });
  }

  console.log('Users seeded successfully!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
