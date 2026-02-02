import { createClient } from "redis";
import prisma from "../../db.ts";
import "dotenv/config";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import sharp from "sharp";

const __filename = fileURLToPath(import.meta.url);
const __cur_dirname = path.dirname(__filename);
const __dirname = path.dirname(__cur_dirname);

const subscriber = createClient({
  username: process.env.REDIS_USERNAME || "",
  password: process.env.REDIS_PASSWORD || "",
  socket: {
    host: process.env.REDIS_HOST || "",
    port: Number(process.env.REDIS_PORT || ""),
  },
});

async function thumbnailServiceRun() {
  await subscriber.connect();
  const publisher = subscriber.duplicate();
  await publisher.connect();
  console.log("Thumbnail Service Listening...");

  subscriber.subscribe("image_uploaded", async (message) => {
    const data = JSON.parse(message);
    const inputPath = path.join(__dirname, data.imagePath);
    console.log(inputPath);
    const thumbName = `thumb_${path.basename(data.imagePath)}`;
    const relativeThumbPath = `uploads/thumbs/${thumbName}`;
    const outputPath = path.join(__dirname, relativeThumbPath);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    await sharp(inputPath).resize(300, 300).toFile(outputPath);

    await new Promise((res) => setTimeout(res, 10000));
    console.log(`[Worker_3][Thumbnail] Resizing ${data.imagePath}...`);
    await prisma.user.upsert({
      where: {
        id: parseInt(data.userId),
      },
      update: {
        thumbnailImage: relativeThumbPath,
      },
      create: {
        id: parseInt(data.userId),
        profileImage: data.imagePath,
        thumbnailImage: relativeThumbPath,
      },
    });
    await publisher.publish(
      `finished:${data.userId}`,
      JSON.stringify({
        status: "done",
        url: `thumbs/${data.userId}.jpg`,
      })
    );
  });
}

export default thumbnailServiceRun;
