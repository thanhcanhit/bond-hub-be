import { Test, TestingModule } from '@nestjs/testing';
import { QrCodeGateway } from './qr-code.gateway';
import { QrCodeService } from './qr-code.service';

describe('QrCodeGateway', () => {
  let gateway: QrCodeGateway;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [QrCodeGateway, QrCodeService],
    }).compile();

    gateway = module.get<QrCodeGateway>(QrCodeGateway);
  });

  it('should be defined', () => {
    expect(gateway).toBeDefined();
  });
});
