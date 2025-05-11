import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import * as mediasoup from 'mediasoup';
import {
  Worker,
  Router,
  WebRtcTransport,
  Producer,
  Consumer,
} from 'mediasoup/node/lib/types';
import { ConfigService } from '@nestjs/config';
import * as os from 'os';

@Injectable()
export class MediasoupService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MediasoupService.name);
  private workers: Worker[] = [];
  private nextWorkerIndex = 0;
  private readonly routers: Map<string, Router> = new Map();
  private readonly transports: Map<string, WebRtcTransport> = new Map();
  private readonly producers: Map<string, Producer> = new Map();
  private readonly consumers: Map<string, Consumer> = new Map();

  // Default mediasoup settings
  private readonly config = {
    // Number of mediasoup workers to create (usually one per CPU core)
    numWorkers: os.cpus().length,
    // mediasoup Worker settings
    worker: {
      logLevel: 'warn',
      logTags: ['info', 'ice', 'dtls', 'rtp', 'srtp', 'rtcp'],
      rtcMinPort: 10000,
      rtcMaxPort: 59999,
    },
    // mediasoup Router settings
    router: {
      mediaCodecs: [
        {
          kind: 'audio',
          mimeType: 'audio/opus',
          clockRate: 48000,
          channels: 2,
        },
        {
          kind: 'video',
          mimeType: 'video/VP8',
          clockRate: 90000,
          parameters: {
            'x-google-start-bitrate': 1000,
          },
        },
        {
          kind: 'video',
          mimeType: 'video/VP9',
          clockRate: 90000,
          parameters: {
            'profile-id': 2,
            'x-google-start-bitrate': 1000,
          },
        },
        {
          kind: 'video',
          mimeType: 'video/h264',
          clockRate: 90000,
          parameters: {
            'packetization-mode': 1,
            'profile-level-id': '4d0032',
            'level-asymmetry-allowed': 1,
            'x-google-start-bitrate': 1000,
          },
        },
        {
          kind: 'video',
          mimeType: 'video/h264',
          clockRate: 90000,
          parameters: {
            'packetization-mode': 1,
            'profile-level-id': '42e01f',
            'level-asymmetry-allowed': 1,
            'x-google-start-bitrate': 1000,
          },
        },
      ],
    },
    // WebRtcTransport settings
    webRtcTransport: {
      listenIps: [
        {
          ip: '0.0.0.0',
          announcedIp: process.env.MEDIASOUP_ANNOUNCED_IP || '127.0.0.1', // Replace with your public IP or use env variable
        },
      ],
      initialAvailableOutgoingBitrate: 1000000,
      maxIncomingBitrate: 1500000,
      maxSctpMessageSize: 262144,
    },
  };

  constructor(private configService: ConfigService) {}

  async onModuleInit() {
    await this.createWorkers();
  }

  async onModuleDestroy() {
    this.closeWorkers();
  }

  private async createWorkers() {
    const { numWorkers, worker: workerSettings } = this.config;

    this.logger.log(`Creating ${numWorkers} mediasoup workers...`);

    for (let i = 0; i < numWorkers; i++) {
      try {
        const worker = await mediasoup.createWorker({
          logLevel: workerSettings.logLevel as mediasoup.types.WorkerLogLevel,
          logTags: workerSettings.logTags as mediasoup.types.WorkerLogTag[],
          rtcMinPort: workerSettings.rtcMinPort,
          rtcMaxPort: workerSettings.rtcMaxPort,
        });

        worker.on('died', () => {
          this.logger.error(
            `Worker ${worker.pid} died, exiting in 2 seconds...`,
          );
          setTimeout(() => process.exit(1), 2000);
        });

        this.workers.push(worker);
        this.logger.log(
          `Worker ${i + 1}/${numWorkers} created with pid ${worker.pid}`,
        );
      } catch (error) {
        this.logger.error(`Failed to create worker: ${error.message}`);
        throw error;
      }
    }
  }

  private closeWorkers() {
    for (const worker of this.workers) {
      worker.close();
    }
    this.workers = [];
  }

  /**
   * Get the next available worker using round-robin
   */
  private getNextWorker(): Worker {
    const worker = this.workers[this.nextWorkerIndex];
    this.nextWorkerIndex = (this.nextWorkerIndex + 1) % this.workers.length;
    return worker;
  }

  /**
   * Create a new router for a room
   * @param roomId The room ID
   */
  async createRouter(roomId: string): Promise<Router> {
    if (this.routers.has(roomId)) {
      return this.routers.get(roomId);
    }

    const worker = this.getNextWorker();
    const router = await worker.createRouter({
      mediaCodecs: this.config.router
        .mediaCodecs as mediasoup.types.RtpCodecCapability[],
    });

    this.routers.set(roomId, router);
    this.logger.log(`Router created for room ${roomId}`);

    return router;
  }

  /**
   * Get a router by room ID
   * @param roomId The room ID
   */
  getRouter(roomId: string): Router | undefined {
    return this.routers.get(roomId);
  }

  /**
   * Create a WebRTC transport
   * @param roomId The room ID
   * @param userId The user ID
   * @param direction 'send' or 'recv'
   */
  async createWebRtcTransport(
    roomId: string,
    userId: string,
    direction: 'send' | 'recv',
  ): Promise<{
    transport: WebRtcTransport;
    params: {
      id: string;
      iceParameters: mediasoup.types.IceParameters;
      iceCandidates: mediasoup.types.IceCandidate[];
      dtlsParameters: mediasoup.types.DtlsParameters;
    };
  }> {
    const router = this.getRouter(roomId);
    if (!router) {
      throw new Error(`Router not found for room ${roomId}`);
    }

    const transport = await router.createWebRtcTransport({
      listenInfos: [
        {
          protocol: 'udp',
          ip: this.config.webRtcTransport.listenIps[0].ip,
          announcedAddress:
            this.config.webRtcTransport.listenIps[0].announcedIp,
        },
        {
          protocol: 'tcp',
          ip: this.config.webRtcTransport.listenIps[0].ip,
          announcedAddress:
            this.config.webRtcTransport.listenIps[0].announcedIp,
        },
      ],
      initialAvailableOutgoingBitrate:
        this.config.webRtcTransport.initialAvailableOutgoingBitrate,
      enableUdp: true,
      enableTcp: true,
      preferUdp: true,
    });

    const transportId = `${roomId}:${userId}:${direction}`;
    this.transports.set(transportId, transport);

    transport.on('dtlsstatechange', (dtlsState) => {
      if (dtlsState === 'closed') {
        this.transports.delete(transportId);
      }
    });

    transport.observer.on('close', () => {
      this.transports.delete(transportId);
    });

    return {
      transport,
      params: {
        id: transport.id,
        iceParameters: transport.iceParameters,
        iceCandidates: transport.iceCandidates,
        dtlsParameters: transport.dtlsParameters,
      },
    };
  }

  /**
   * Connect a WebRTC transport
   * @param transportId The transport ID
   * @param dtlsParameters The DTLS parameters
   */
  async connectWebRtcTransport(
    roomId: string,
    userId: string,
    direction: 'send' | 'recv',
    dtlsParameters: mediasoup.types.DtlsParameters,
  ): Promise<void> {
    const transportId = `${roomId}:${userId}:${direction}`;
    const transport = this.transports.get(transportId);

    if (!transport) {
      throw new Error(`Transport not found with ID ${transportId}`);
    }

    await transport.connect({ dtlsParameters });
    this.logger.log(`Transport ${transportId} connected`);
  }

  /**
   * Create a producer
   * @param roomId The room ID
   * @param userId The user ID
   * @param producerOptions The producer options
   */
  async createProducer(
    roomId: string,
    userId: string,
    producerOptions: {
      kind: mediasoup.types.MediaKind;
      rtpParameters: mediasoup.types.RtpParameters;
      appData?: any;
    },
  ): Promise<{
    id: string;
    kind: mediasoup.types.MediaKind;
    rtpParameters: mediasoup.types.RtpParameters;
  }> {
    const transportId = `${roomId}:${userId}:send`;
    const transport = this.transports.get(transportId);

    if (!transport) {
      throw new Error(`Transport not found with ID ${transportId}`);
    }

    const producer = await transport.produce({
      kind: producerOptions.kind,
      rtpParameters: producerOptions.rtpParameters,
      appData: { ...producerOptions.appData, userId, roomId },
    });

    this.producers.set(producer.id, producer);

    producer.on('transportclose', () => {
      this.producers.delete(producer.id);
    });

    producer.observer.on('close', () => {
      this.producers.delete(producer.id);
    });

    return {
      id: producer.id,
      kind: producer.kind,
      rtpParameters: producer.rtpParameters,
    };
  }

  /**
   * Create a consumer
   * @param roomId The room ID
   * @param consumerId The consumer ID (usually the user ID)
   * @param producerId The producer ID to consume
   * @param rtpCapabilities The RTP capabilities of the consumer
   */
  async createConsumer(
    roomId: string,
    consumerId: string,
    producerId: string,
    rtpCapabilities: mediasoup.types.RtpCapabilities,
  ): Promise<{
    id: string;
    producerId: string;
    kind: mediasoup.types.MediaKind;
    rtpParameters: mediasoup.types.RtpParameters;
  }> {
    const router = this.getRouter(roomId);
    if (!router) {
      throw new Error(`Router not found for room ${roomId}`);
    }

    // Check if the client can consume this producer
    if (!router.canConsume({ producerId, rtpCapabilities })) {
      throw new Error(`Client cannot consume producer ${producerId}`);
    }

    const transportId = `${roomId}:${consumerId}:recv`;
    const transport = this.transports.get(transportId);

    if (!transport) {
      throw new Error(`Transport not found with ID ${transportId}`);
    }

    const consumer = await transport.consume({
      producerId,
      rtpCapabilities,
      paused: true, // Start paused, client will resume
    });

    this.consumers.set(consumer.id, consumer);

    consumer.on('transportclose', () => {
      this.consumers.delete(consumer.id);
    });

    consumer.on('producerclose', () => {
      this.consumers.delete(consumer.id);
    });

    consumer.observer.on('close', () => {
      this.consumers.delete(consumer.id);
    });

    return {
      id: consumer.id,
      producerId: consumer.producerId,
      kind: consumer.kind,
      rtpParameters: consumer.rtpParameters,
    };
  }

  /**
   * Resume a consumer
   * @param consumerId The consumer ID
   */
  async resumeConsumer(consumerId: string): Promise<void> {
    const consumer = this.consumers.get(consumerId);
    if (!consumer) {
      throw new Error(`Consumer not found with ID ${consumerId}`);
    }

    await consumer.resume();
  }

  /**
   * Close a producer
   * @param producerId The producer ID
   */
  closeProducer(producerId: string): void {
    const producer = this.producers.get(producerId);
    if (producer) {
      producer.close();
      this.producers.delete(producerId);
    }
  }

  /**
   * Close a consumer
   * @param consumerId The consumer ID
   */
  closeConsumer(consumerId: string): void {
    const consumer = this.consumers.get(consumerId);
    if (consumer) {
      consumer.close();
      this.consumers.delete(consumerId);
    }
  }

  /**
   * Close a transport
   * @param roomId The room ID
   * @param userId The user ID
   * @param direction 'send' or 'recv'
   */
  closeTransport(
    roomId: string,
    userId: string,
    direction: 'send' | 'recv',
  ): void {
    const transportId = `${roomId}:${userId}:${direction}`;
    const transport = this.transports.get(transportId);
    if (transport) {
      transport.close();
      this.transports.delete(transportId);
    }
  }

  /**
   * Close a router (and all associated transports, producers, consumers)
   * @param roomId The room ID
   */
  closeRouter(roomId: string): void {
    const router = this.routers.get(roomId);
    if (router) {
      router.close();
      this.routers.delete(roomId);
    }
  }

  /**
   * Get router RTP capabilities
   * @param roomId The room ID
   */
  async getRtpCapabilities(
    roomId: string,
  ): Promise<mediasoup.types.RtpCapabilities> {
    let router = this.getRouter(roomId);

    if (!router) {
      router = await this.createRouter(roomId);
    }

    return router.rtpCapabilities;
  }
}
