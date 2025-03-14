const axios = require('axios');
const io = require('socket.io-client');
const { prompt } = require('inquirer'); // Updated import

const API_URL = 'http://localhost:3000';
const SOCKET_URL = 'http://localhost:3000';

const sessions = new Map();

// Create axios instance
const createAxiosInstance = () => {
  return axios.create({
    baseURL: API_URL,
    headers: {
      'Content-Type': 'application/json',
      'x-device-name': 'Test Device',
    },
  });
};

// Connect WebSocket for a session
const connectWebSocket = (sessionName, token) => {
  console.log(`[${sessionName}] Đang kết nối WebSocket...`);

  const socket = io(SOCKET_URL, {
    auth: { token },
  });

  socket.on('connect', () => {
    console.log(`[${sessionName}] WebSocket đã kết nối!`);
  });

  socket.on('forceLogout', (data) => {
    console.log(`\n[${sessionName}] Nhận được yêu cầu đăng xuất bắt buộc!`);
    console.log(
      `[${sessionName}] Thiết bị này đã bị đăng xuất bởi một đăng nhập mới!`,
    );
    socket.disconnect();
    sessions.delete(sessionName);
    showMainMenu();
  });

  socket.on('disconnect', () => {
    console.log(`[${sessionName}] WebSocket đã ngắt kết nối!`);
  });

  socket.on('error', (error) => {
    console.error(`[${sessionName}] Lỗi WebSocket: ${error}`);
  });

  return socket;
};

// Device type selection
const selectDeviceType = async () => {
  const { deviceType } = await prompt([
    // Changed from inquirer.prompt
    {
      type: 'list',
      name: 'deviceType',
      message: 'Chọn loại thiết bị:',
      choices: [
        { name: '📱 Mobile', value: 'MOBILE' },
        { name: '📟 Tablet', value: 'TABLET' },
        { name: '💻 Desktop', value: 'DESKTOP' },
        { name: '🔧 Other', value: 'OTHER' },
      ],
    },
  ]);
  return deviceType;
};

// Login method selection
const selectLoginMethod = async () => {
  const { method } = await prompt([
    // Changed from inquirer.prompt
    {
      type: 'list',
      name: 'method',
      message: 'Chọn phương thức đăng nhập:',
      choices: [
        { name: '📧 Email', value: 'email' },
        { name: '📱 Số điện thoại', value: 'phone' },
      ],
    },
  ]);
  return method;
};

// Get login credentials
const getLoginCredentials = async (method) => {
  const questions = [
    {
      type: 'password',
      name: 'password',
      message: 'Nhập mật khẩu:',
      mask: '*',
    },
  ];

  if (method === 'email') {
    questions.unshift({
      type: 'input',
      name: 'email',
      message: 'Nhập email:',
      validate: (value) => {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailRegex.test(value) || 'Vui lòng nhập email hợp lệ';
      },
    });
  } else {
    questions.unshift({
      type: 'input',
      name: 'phoneNumber',
      message: 'Nhập số điện thoại (10 số):',
      validate: (value) => {
        return (
          /^[0-9]{10}$/.test(value) || 'Số điện thoại phải có đúng 10 chữ số'
        );
      },
    });
  }

  return prompt(questions); // Changed from inquirer.prompt
};

// Perform login
const performLogin = async () => {
  const { sessionName } = await prompt([
    {
      type: 'input',
      name: 'sessionName',
      message: 'Đặt tên cho phiên đăng nhập này:',
      validate: (value) => {
        if (value.trim()) {
          if (sessions.has(value)) {
            return 'Tên phiên này đã tồn tại, vui lòng chọn tên khác';
          }
          return true;
        }
        return 'Vui lòng nhập tên phiên';
      },
    },
  ]);

  const deviceType = await selectDeviceType();
  const loginMethod = await selectLoginMethod();
  const credentials = await getLoginCredentials(loginMethod);

  const loginData = {
    ...credentials,
    deviceType,
  };

  try {
    console.log('\nĐang đăng nhập...');
    console.log('Dữ liệu gửi đi:', JSON.stringify(loginData, null, 2));

    const response = await createAxiosInstance().post('/auth/login', loginData);
    const { accessToken, refreshToken } = response.data;

    const socket = connectWebSocket(sessionName, accessToken);
    sessions.set(sessionName, {
      accessToken,
      refreshToken,
      socket,
      deviceType,
    });

    console.log(
      `\n[${sessionName}] Đăng nhập thành công với thiết bị ${deviceType}`,
    );
    console.log(`[${sessionName}] Đang lắng nghe sự kiện force logout...`);
  } catch (error) {
    console.error('\nLỗi đăng nhập:');
    if (error.response?.data) {
      console.error('- Message:', error.response.data.message);
      console.error('- Status:', error.response.status);
      console.error('- Error:', JSON.stringify(error.response.data, null, 2));
    } else {
      console.error('- Error:', error.message);
    }
  }

  await showMainMenu();
};

// Show active sessions
const showActiveSessions = async () => {
  console.log('\nDanh sách phiên đang hoạt động:');
  if (sessions.size === 0) {
    console.log('Không có phiên nào đang hoạt động');
  } else {
    sessions.forEach((session, name) => {
      const deviceIcon = {
        MOBILE: '📱',
        TABLET: '📟',
        DESKTOP: '💻',
        OTHER: '🔧',
      }[session.deviceType];
      console.log(`- ${deviceIcon} ${name} (${session.deviceType})`);
    });
  }
  await showMainMenu();
};

// Logout session
const logoutSession = async () => {
  if (sessions.size === 0) {
    console.log('\nKhông có phiên nào để đăng xuất');
    return showMainMenu();
  }

  const sessionChoices = Array.from(sessions.entries()).map(
    ([name, session]) => ({
      name: `${name} (${session.deviceType})`,
      value: name,
    }),
  );

  const { sessionName } = await prompt([
    // Changed from inquirer.prompt
    {
      type: 'list',
      name: 'sessionName',
      message: 'Chọn phiên để đăng xuất:',
      choices: sessionChoices,
    },
  ]);

  const session = sessions.get(sessionName);
  try {
    console.log(`\nĐang đăng xuất phiên ${sessionName}...`);
    await createAxiosInstance().post('/auth/logout', null, {
      headers: {
        'refresh-token': session.refreshToken,
      },
    });

    session.socket.disconnect();
    sessions.delete(sessionName);
    console.log(`[${sessionName}] Đã đăng xuất thành công`);
  } catch (error) {
    console.error(
      `[${sessionName}] Đăng xuất thất bại: ${error.response?.data || error.message}`,
    );
  }

  await showMainMenu();
};

// Main menu
const showMainMenu = async () => {
  const { action } = await prompt([
    // Changed from inquirer.prompt
    {
      type: 'list',
      name: 'action',
      message: 'Chọn hành động:',
      choices: [
        { name: '🔑 Đăng nhập phiên mới', value: 'login' },
        { name: '📋 Xem phiên đang hoạt động', value: 'list' },
        { name: '🚪 Đăng xuất phiên', value: 'logout' },
        { name: '❌ Thoát', value: 'exit' },
      ],
    },
  ]);

  switch (action) {
    case 'login':
      await performLogin();
      break;
    case 'list':
      await showActiveSessions();
      break;
    case 'logout':
      await logoutSession();
      break;
    case 'exit':
      console.log('\nĐóng tất cả kết nối...');
      sessions.forEach((session, name) => {
        session.socket.disconnect();
        console.log(`[${name}] Đã đóng kết nối`);
      });
      process.exit(0);
  }
};

// Start program
console.log('=== CHƯƠNG TRÌNH TEST AUTHENTICATION ===');
showMainMenu().catch(console.error);

// Handle program exit
process.on('SIGINT', () => {
  console.log('\n\nĐóng tất cả kết nối...');
  sessions.forEach((session, name) => {
    session.socket.disconnect();
    console.log(`[${name}] Đã đóng kết nối`);
  });
  process.exit(0);
});
