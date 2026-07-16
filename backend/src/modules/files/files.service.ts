import { randomUUID } from "node:crypto";
import { BadRequestException, Injectable, OnModuleInit, ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Client } from "minio";
import { AVATAR_CONTENT_TYPES, CERTIFICATION_CONTENT_TYPES, CreateUploadUrlDto, UploadPurpose } from "./dto/files.dto";

const MAX_CERTIFICATION_SIZE = 10 * 1024 * 1024;
const MAX_AVATAR_SIZE = 5 * 1024 * 1024;

@Injectable()
export class FilesService implements OnModuleInit {
  private readonly client: Client;
  private readonly publicClient: Client;
  private readonly bucket: string;
  private readonly region: string;
  private readonly publicOrigin: string;

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
    const publicEndpoint = config.get("MINIO_PUBLIC_ENDPOINT") || "127.0.0.1";
    const publicPort = Number(config.get("MINIO_PUBLIC_PORT") || 4003);
    const publicUseSSL = config.get("MINIO_PUBLIC_USE_SSL") === "true";
    this.publicOrigin = `${publicUseSSL ? "https" : "http"}://${publicEndpoint}:${publicPort}`;
    this.publicClient = new Client({
      endPoint: publicEndpoint,
      port: publicPort,
      useSSL: publicUseSSL,
      region: this.region,
      accessKey,
      secretKey
    });
  }

  async onModuleInit() {
    try {
      if (!(await this.client.bucketExists(this.bucket))) await this.client.makeBucket(this.bucket, this.region);
      await this.client.setBucketPolicy(this.bucket, JSON.stringify({
        Version: "2012-10-17",
        Statement: [{
          Effect: "Allow",
          Principal: { AWS: ["*"] },
          Action: ["s3:GetObject"],
          Resource: [`arn:aws:s3:::${this.bucket}/avatars/*`]
        }]
      }));
    } catch (error) {
      console.error("MinIO initialization failed", error);
    }
  }

  async createUploadUrl(accountId: string, dto: CreateUploadUrlDto) {
    const avatar = dto.purpose === UploadPurpose.AVATAR;
    const allowedTypes = avatar ? AVATAR_CONTENT_TYPES : CERTIFICATION_CONTENT_TYPES;
    const maxSize = avatar ? MAX_AVATAR_SIZE : MAX_CERTIFICATION_SIZE;
    if (!(allowedTypes as readonly string[]).includes(dto.contentType)) {
      throw new BadRequestException(avatar ? "头像仅支持 JPG 或 PNG" : "认证材料仅支持 JPG、PNG 或 PDF");
    }
    if (dto.size > maxSize) {
      throw new BadRequestException(avatar ? "头像不能超过 5MB" : "认证材料不能超过 10MB");
    }
    const extension = dto.fileName.includes(".") ? dto.fileName.slice(dto.fileName.lastIndexOf(".")).toLowerCase() : "";
    const objectKey = avatar
      ? `avatars/${accountId}/${randomUUID()}${extension}`
      : `private/${accountId}/${new Date().toISOString().slice(0, 10)}/${randomUUID()}${extension}`;
    try {
      const uploadUrl = await this.publicClient.presignedUrl(
        "PUT",
        this.bucket,
        objectKey,
        10 * 60,
        { "Content-Type": dto.contentType }
      );
      return {
        objectKey,
        uploadUrl,
        expiresIn: 600,
        contentType: dto.contentType,
        requiredHeaders: { "Content-Type": dto.contentType },
        declaredSize: dto.size,
        purpose: dto.purpose,
        maxSize
      };
    } catch {
      throw new ServiceUnavailableException("文件服务暂时不可用");
    }
  }

  async assertAvatarObject(accountId: string, objectKey: string) {
    if (!objectKey.startsWith(`avatars/${accountId}/`)) {
      throw new BadRequestException("不能使用其他账号上传的头像");
    }
    const verified = await this.assertObject(objectKey, AVATAR_CONTENT_TYPES, MAX_AVATAR_SIZE, "头像");
    return {
      ...verified,
      publicUrl: `/media/${this.bucket}/${objectKey.split("/").map(encodeURIComponent).join("/")}`
    };
  }

  async assertCertificationObject(accountId: string, objectKey: string) {
    if (!objectKey.startsWith(`private/${accountId}/`)) {
      throw new BadRequestException("不能使用其他账号上传的文件");
    }

    return this.assertObject(objectKey, CERTIFICATION_CONTENT_TYPES, MAX_CERTIFICATION_SIZE, "认证材料");
  }

  private async assertObject(
    objectKey: string,
    allowedTypes: readonly string[],
    maxSize: number,
    label: string
  ) {
    let stat: Awaited<ReturnType<Client["statObject"]>>;
    try {
      stat = await this.client.statObject(this.bucket, objectKey);
    } catch (error) {
      const code = typeof error === "object" && error !== null && "code" in error
        ? String((error as { code?: unknown }).code)
        : "";
      if (["NoSuchKey", "NotFound", "NoSuchObject"].includes(code)) {
        throw new BadRequestException("上传文件不存在或已失效，请重新上传");
      }
      throw new ServiceUnavailableException("暂时无法校验上传文件，请稍后重试");
    }

    if (stat.size <= 0 || stat.size > maxSize) {
      throw new BadRequestException(`${label}必须大于 0 字节且不能超过 ${Math.round(maxSize / 1024 / 1024)}MB`);
    }
    const contentTypeEntry = Object.entries(stat.metaData || {}).find(([key]) => key.toLowerCase() === "content-type");
    const contentType = String(contentTypeEntry?.[1] || "").split(";", 1)[0].trim().toLowerCase();
    if (!allowedTypes.includes(contentType)) {
      throw new BadRequestException(`${label}的上传类型不受支持或与签名不一致`);
    }
    const detectedContentType = await this.detectObjectContentType(objectKey);
    if (detectedContentType !== contentType) {
      throw new BadRequestException(`${label}的实际文件格式与上传类型不一致`);
    }
    return { size: stat.size, contentType, detectedContentType };
  }

  resolveLegacyObjectKey(accountId: string, fileUrl: string) {
    let url: URL;
    try {
      url = new URL(fileUrl);
    } catch {
      throw new BadRequestException("旧版文件地址无效，请重新上传认证材料");
    }
    if (url.origin !== new URL(this.publicOrigin).origin) {
      throw new BadRequestException("只允许登记本平台文件服务中的认证材料");
    }
    const bucketPrefix = `/${this.bucket}/`;
    if (!url.pathname.startsWith(bucketPrefix)) {
      throw new BadRequestException("旧版文件地址不属于当前文件存储桶，请重新上传");
    }
    let objectKey: string;
    try {
      objectKey = decodeURIComponent(url.pathname.slice(bucketPrefix.length));
    } catch {
      throw new BadRequestException("旧版文件地址编码无效，请重新上传");
    }
    if (!objectKey.startsWith(`private/${accountId}/`)) {
      throw new BadRequestException("不能使用其他账号上传的文件");
    }
    return objectKey;
  }

  private async detectObjectContentType(objectKey: string) {
    let stream: Awaited<ReturnType<Client["getPartialObject"]>> | undefined;
    try {
      stream = await this.client.getPartialObject(this.bucket, objectKey, 0, 16);
      const chunks: Buffer[] = [];
      for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      const header = Buffer.concat(chunks);
      if (header.length >= 3 && header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff) return "image/jpeg";
      if (header.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
      if (header.subarray(0, 5).equals(Buffer.from("%PDF-", "ascii"))) return "application/pdf";
      return null;
    } catch {
      throw new ServiceUnavailableException("暂时无法读取上传文件，请稍后重试");
    } finally {
      stream?.destroy();
    }
  }
}
