import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { QrCodeGateway } from './qr-code.gateway';
import { QrCodeStatus } from '@prisma/client';
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
        deviceType: 'OTHER',
        deviceName: 'QR Code Login',
      },
    );

    const deviceInfo = {
      id: uuidv4(),
      name: 'QR Code Login',
      type: 'OTHER',
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

      if (new Date() > qrCode.expiresAt) {
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
}
