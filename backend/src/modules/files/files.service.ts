import { randomUUID } from "node:crypto";
import { Injectable, OnModuleInit, ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Client } from "minio";
import { CreateUploadUrlDto } from "./dto/files.dto";

@Injectable()
export class FilesService implements OnModuleInit {
  private readonly client: Client;
  private readonly publicClient: Client;
  private readonly bucket: string;
  private readonly region: string;

  constructor(config: ConfigService) {
    this.bucket = config.get("MINIO_BUCKET") || "tutor-link";
    this.region = config.get("MINIO_REGION") || "cn-south-1";
    const accessKey = config.get("MINIO_ROOT_USER") || "minioadmin";
    const secretKey = config.get("MINIO_ROOT_PASSWORD") || "minioadmin123";
    this.client = new Client({
      endPoint: config.get("MINIO_ENDPOINT") || "minio",
      port: Number(config.get("MINIO_PORT") || 9000),
      useSSL: config.get("MINIO_USE_SSL") === "true",
      region: this.region,
      accessKey,
      secretKey
    });
    this.publicClient = new Client({
      endPoint: config.get("MINIO_PUBLIC_ENDPOINT") || "127.0.0.1",
      port: Number(config.get("MINIO_PUBLIC_PORT") || 9000),
      useSSL: config.get("MINIO_PUBLIC_USE_SSL") === "true",
      region: this.region,
      accessKey,
      secretKey
    });
  }

  async onModuleInit() {
    try {
      if (!(await this.client.bucketExists(this.bucket))) await this.client.makeBucket(this.bucket, this.region);
    } catch (error) {
      console.error("MinIO initialization failed", error);
    }
  }

  async createUploadUrl(accountId: string, dto: CreateUploadUrlDto) {
    const extension = dto.fileName.includes(".") ? dto.fileName.slice(dto.fileName.lastIndexOf(".")).toLowerCase() : "";
    const objectKey = `private/${accountId}/${new Date().toISOString().slice(0, 10)}/${randomUUID()}${extension}`;
    try {
      const uploadUrl = await this.publicClient.presignedPutObject(this.bucket, objectKey, 10 * 60);
      return { objectKey, uploadUrl, expiresIn: 600, contentType: dto.contentType, maxSize: dto.size };
    } catch {
      throw new ServiceUnavailableException("文件服务暂时不可用");
    }
  }
}
