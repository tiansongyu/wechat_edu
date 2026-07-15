import "reflect-metadata";
import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, NestFastifyApplication } from "@nestjs/platform-fastify";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import helmet from "@fastify/helmet";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ trustProxy: true, logger: true })
  );

  await app.register(helmet, { contentSecurityPolicy: false });
  app.enableCors({
    origin: (process.env.CORS_ORIGINS || "http://localhost:4000")
      .split(",")
      .map((item) => item.trim()),
    credentials: true
  });
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: { enableImplicitConversion: true }
  }));
  app.enableShutdownHooks();

  const config = new DocumentBuilder()
    .setTitle("家教直聘 API")
    .setDescription("家长端、老师端和管理后台的统一业务 API")
    .setVersion("1.0")
    .addBearerAuth()
    .build();
  SwaggerModule.setup("docs", app, SwaggerModule.createDocument(app, config));

  await app.listen(Number(process.env.PORT || 3000), "0.0.0.0");
}

bootstrap();
